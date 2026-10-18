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
  /** Account type of the recipient: 0 basic, 1 vesting, 2 HTLC, 3 staking. */
  toType?: number
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

/** NIMIQ_RPC_URL serves a different chain than NIMIQ_NETWORK, so nothing is read from or sent through it. */
export class WrongNetworkError extends Error {}

/** Albatross block `network` names and the network ids transactions are signed with. */
const NETWORKS: Record<string, { id: number; label: string }> = {
  MainAlbatross: { id: 24, label: 'mainnet' },
  TestAlbatross: { id: 5, label: 'testnet' },
  DevAlbatross: { id: 6, label: 'devnet' },
}

let rpcId = 0
let networkCheck: Promise<void> | null = null

/**
 * Confirms the RPC node is on NIMIQ_NETWORK. A node answers for any address whichever chain it's on, so a
 * mainnet server pointed at a testnet node would read testnet balances and deposits and sign payouts that
 * node rejects. A mismatch sticks until restart; a lookup that fails is tried again on the next call.
 */
export function checkRpcNetwork(): Promise<void> {
  networkCheck ??= (async () => {
    const block = await rpc<{ network?: string }>('getLatestBlock', [false], false)
    const actual = NETWORKS[block.network ?? '']
    if (actual?.id === config.nimiq.networkId) return
    const where = actual ? `a ${actual.label} node` : `on an unrecognised network (${block.network ?? 'none reported'})`
    const error = new WrongNetworkError(`NIMIQ_NETWORK is ${config.nimiq.network} but NIMIQ_RPC_URL ${config.nimiq.rpcUrl} is ${where}`)
    console.error(
      `\n[nimiq] !!! WRONG NETWORK: ${error.message}.\n` +
        '[nimiq] !!! Treasury reads, sales and payouts are stopped. Point NIMIQ_RPC_URL at a ' +
        `${config.nimiq.network} node (or unset it on mainnet) and restart.\n`,
    )
    throw error
  })().catch((e) => {
    if (!(e instanceof WrongNetworkError)) networkCheck = null
    throw e
  })
  return networkCheck
}

async function rpc<T>(method: string, params: unknown[], requireNetwork = true): Promise<T> {
  if (!config.nimiq.rpcUrl) throw new Error('NIMIQ_RPC_URL is not configured')
  if (requireNetwork) await checkRpcNetwork()
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

const giftKeyPair = config.nimiq.giftPrivateKey ? KeyPair.derive(PrivateKey.fromHex(config.nimiq.giftPrivateKey)) : null

/** Where new gifts are paid in and claimed from. Null means gifts are off. */
export const giftEscrowAddress: string | null = giftKeyPair ? giftKeyPair.toAddress().toUserFriendlyAddress() : null

/** Every address this server can sign payments from, by user-friendly address. */
const signers = new Map(
  [treasuryKeyPair, giftKeyPair].filter((k) => k !== null).map((k) => [k.toAddress().toUserFriendlyAddress(), k] as const),
)

export const canSendFrom = (address: string | null) => address !== null && signers.has(address)

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

/** Spendable balance of an address in Luna (0 for an address that has never been used). */
export async function getBalanceLuna(address: string): Promise<bigint> {
  const account = await rpc<{ balance: number }>('getAccountByAddress', [normalizeAddress(address)])
  return BigInt(account.balance ?? 0)
}

/** The address is a contract nothing can be paid to (e.g. a staking contract). */
export class NotPayableError extends Error {}

interface RawAccount {
  type: 'basic' | 'vesting' | 'htlc' | 'staking' | string
  balance?: number
  /** HTLC: the party that funded it and gets it back on timeout. Nimiq Pay wallets keep funds in an HTLC whose sender is the user's own key. */
  sender?: string
  /** Vesting contract owner. */
  owner?: string
}

/**
 * Where NIM sent "to" an address can actually land. Only basic accounts accept a plain transfer; a payout to
 * a contract is mined but fails without moving NIM. Nimiq Pay keeps a user's spendable NIM in an HTLC owned
 * by their key, so we pay the contract's owner, which is that user's own basic account. Unknown addresses
 * report as basic.
 */
export async function resolvePayoutAddress(address: string): Promise<string> {
  let current = normalizeAddress(address)
  for (let hop = 0; hop < 3; hop++) {
    const account = await rpc<RawAccount>('getAccountByAddress', [current])
    if (account.type === 'basic') return current
    const owner = account.type === 'htlc' ? account.sender : account.type === 'vesting' ? account.owner : undefined
    if (!owner) throw new NotPayableError(`${current} is a ${account.type} contract and can't receive NIM`)
    current = normalizeAddress(owner)
  }
  throw new NotPayableError(`Couldn't find a wallet account behind ${address}`)
}

const HTLC_ACCOUNT_TYPE = 2

/**
 * The balance Nimiq Pay shows for a wallet: the account itself plus the HTLCs it funded that still hold NIM. Nimiq Pay
 * moves NIM that arrives into such an HTLC (sender = the wallet, refunded to it on timeout), so the account alone often
 * reads 0 while the wallet holds NIM. Only the latest 50 transactions are searched for those HTLCs.
 */
export async function getWalletBalanceLuna(address: string): Promise<bigint> {
  const owner = normalizeAddress(address)
  const [account, txs] = await Promise.all([
    rpc<RawAccount>('getAccountByAddress', [owner]),
    rpc<RawRpcTransaction[]>('getTransactionsByAddress', [owner, 50, null]),
  ])
  const funded = txs.filter((tx) => tx.toType === HTLC_ACCOUNT_TYPE && normalizeAddress(tx.from) === owner).map((tx) => normalizeAddress(tx.to))
  const held = await Promise.all(
    [...new Set(funded)].map(async (contract) => {
      const htlc = await rpc<RawAccount>('getAccountByAddress', [contract])
      return htlc.type === 'htlc' && htlc.sender && normalizeAddress(htlc.sender) === owner ? BigInt(htlc.balance ?? 0) : 0n
    }),
  )
  return held.reduce((sum, luna) => sum + luna, BigInt(account.balance ?? 0))
}

/** Signs a payment from the treasury without broadcasting, so the hash can be persisted first. */
export async function buildTreasuryTransaction(recipient: string, valueLuna: bigint, data: string) {
  if (!treasuryKeyPair) throw new Error('Treasury signing key is not configured')
  return buildTransactionFrom(treasuryKeyPair.toAddress().toUserFriendlyAddress(), recipient, valueLuna, data)
}

/** Signs a payment from one of this server's own addresses (treasury or gift escrow) without broadcasting. */
export async function buildTransactionFrom(
  sender: string,
  recipient: string,
  valueLuna: bigint,
  data: string,
): Promise<{ hash: string; hex: string }> {
  const keyPair = signers.get(sender)
  if (!keyPair) throw new Error(`This server has no signing key for ${sender}`)
  const height = await rpc<number>('getBlockNumber', [])
  const tx = TransactionBuilder.newBasicWithData(
    keyPair.toAddress(),
    Address.fromUserFriendlyAddress(recipient),
    new TextEncoder().encode(data),
    valueLuna,
    0n,
    height,
    config.nimiq.networkId,
  )
  tx.sign(keyPair, undefined)
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
