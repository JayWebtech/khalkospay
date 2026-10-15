import { Address, KeyPair, PrivateKey, Transaction, TransactionBuilder } from '@nimiq/core'
import { config } from '../config'

export const LUNA_PER_NIM = 100_000n

export interface ChainTransaction {
  hash: string
  from: string
  to: string
  valueLuna: bigint
  data: string
  confirmations: number
  success: boolean
  timestamp: number
}

interface RawRpcTransaction {
  hash: string
  from: string
  to: string
  value: number
  recipientData: string
  confirmations?: number
  executionResult?: boolean
  timestamp?: number
}

class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: unknown,
  ) {
    super(data ? `${message}: ${String(data)}` : message)
  }
}

let rpcId = 0

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (!config.nimiq.rpcUrl) throw new Error('NIMIQ_RPC_URL is not configured')
  const res = await fetch(config.nimiq.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Nimiq RPC ${method} failed with HTTP ${res.status}`)
  const body = (await res.json()) as {
    result?: { data: T }
    error?: { code: number; message: string; data?: unknown }
  }
  if (body.error) throw new RpcError(body.error.code, body.error.message, body.error.data)
  if (!body.result) throw new Error(`Nimiq RPC ${method} returned no result`)
  return body.result.data
}

export function normalizeAddress(input: string): string {
  return Address.fromUserFriendlyAddress(input.trim().toUpperCase()).toUserFriendlyAddress()
}

export function isValidAddress(input: string): boolean {
  try {
    normalizeAddress(input)
    return true
  } catch {
    return false
  }
}

const treasuryKeyPair = config.nimiq.treasuryPrivateKey
  ? KeyPair.derive(PrivateKey.fromHex(config.nimiq.treasuryPrivateKey))
  : null

export const treasuryAddress: string | null = treasuryKeyPair
  ? treasuryKeyPair.toAddress().toUserFriendlyAddress()
  : config.nimiq.treasuryAddress
    ? normalizeAddress(config.nimiq.treasuryAddress)
    : null

export const canSendFromTreasury = treasuryKeyPair !== null

/**
 * Nimiq Pay may hand back either a tx hash or the serialized transaction,
 * so accept both and always derive the canonical hash.
 */
export function resolveTxHash(hashOrSerialized: string): string {
  const value = hashOrSerialized.trim().toLowerCase().replace(/^0x/, '')
  if (/^[0-9a-f]{64}$/.test(value)) return value
  if (/^[0-9a-f]+$/.test(value)) return Transaction.fromAny(value).hash()
  throw new Error('Not a transaction hash or serialized transaction')
}

function toChainTransaction(tx: RawRpcTransaction): ChainTransaction {
  return {
    hash: tx.hash,
    from: normalizeAddress(tx.from),
    to: normalizeAddress(tx.to),
    valueLuna: BigInt(tx.value),
    data: Buffer.from(tx.recipientData || '', 'hex').toString('utf8'),
    confirmations: tx.confirmations ?? 0,
    success: tx.executionResult !== false,
    timestamp: tx.timestamp ?? Date.now(),
  }
}

/** Most recent transactions touching an address, newest first. */
export async function listTransactions(address: string, max = 50): Promise<ChainTransaction[]> {
  const txs = await rpc<RawRpcTransaction[]>('getTransactionsByAddress', [address, max, null])
  return txs.map(toChainTransaction)
}

export async function getTransaction(hash: string): Promise<ChainTransaction | null> {
  try {
    return toChainTransaction(await rpc<RawRpcTransaction>('getTransactionByHash', [hash]))
  } catch (e) {
    if (e instanceof RpcError && String(e.data ?? '').startsWith('Transaction not found')) return null
    throw e
  }
}

/** Signs a payment from the treasury without broadcasting, so the hash can be persisted first. */
export async function buildTreasuryTransaction(
  recipient: string,
  valueLuna: bigint,
  data: string,
): Promise<{ hash: string; hex: string }> {
  if (!treasuryKeyPair) throw new Error('Treasury signing key is not configured')
  const height = await rpc<number>('getBlockNumber', [])
  const tx = TransactionBuilder.newBasicWithData(
    treasuryKeyPair.toAddress(),
    Address.fromUserFriendlyAddress(recipient),
    new TextEncoder().encode(data),
    valueLuna,
    0n,
    height,
    config.nimiq.networkId,
  )
  tx.sign(treasuryKeyPair, undefined)
  return { hash: tx.hash(), hex: tx.toHex() }
}

export async function broadcastTransaction(hex: string): Promise<void> {
  await rpc<string>('sendRawTransaction', [hex])
}

export function formatNim(luna: bigint): string {
  const whole = luna / LUNA_PER_NIM
  const frac = (luna % LUNA_PER_NIM).toString().padStart(5, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

export function parseNimToLuna(nim: string | number): bigint {
  const str = String(nim).trim()
  if (!/^\d+(\.\d{1,5})?$/.test(str)) throw new Error('NIM amount must be a positive number with at most 5 decimals')
  const [whole, frac = ''] = str.split('.')
  return BigInt(whole) * LUNA_PER_NIM + BigInt(frac.padEnd(5, '0'))
}
