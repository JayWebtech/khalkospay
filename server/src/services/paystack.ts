import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config'
import { HttpError } from '../lib/http-error'

const BASE_URL = config.paystackBaseUrl

const POPULAR_BANK_CODES = ['999992', '50515', '058', '044', '057', '033', '011', '50211', '999991', '035']

export interface Bank {
  code: string
  name: string
  popular: boolean
}

export type TransferStatus =
  | 'pending'
  | 'received'
  | 'queued'
  | 'processing'
  | 'otp'
  | 'success'
  | 'failed'
  | 'reversed'
  | 'abandoned'
  | 'blocked'
  | 'rejected'

export class PaystackError extends Error {
  constructor(
    public httpStatus: number,
    message: string,
  ) {
    super(message)
  }

  get isDefinitive() {
    return this.httpStatus >= 400 && this.httpStatus < 500
  }
}

async function request<T>(path: string, init: RequestInit = {}, requireKey = true): Promise<T> {
  if (requireKey && !config.paystackSecretKey) {
    throw new HttpError(503, 'Bank payouts are not configured on this server', 'PAYSTACK_NOT_CONFIGURED')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.paystackSecretKey) headers.Authorization = `Bearer ${config.paystackSecretKey}`
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) })
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T }
  if (!res.ok || !body.status) throw new PaystackError(res.status, body.message || `Paystack HTTP ${res.status}`)
  return body.data as T
}

let bankCache: { banks: Bank[]; at: number } | null = null

export async function listBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 12 * 3600_000) return bankCache.banks
  const raw = await request<
    { code: string; name: string; active: boolean; supports_transfer: boolean; is_deleted: boolean; type: string; currency: string }[]
  >('/bank?country=nigeria&currency=NGN&perPage=500', {}, false)
  const byCode = new Map<string, Bank>()
  for (const b of raw) {
    if (!b.active || b.is_deleted || !b.supports_transfer || b.type !== 'nuban' || byCode.has(b.code)) continue
    byCode.set(b.code, { code: b.code, name: b.name, popular: POPULAR_BANK_CODES.includes(b.code) })
  }
  const banks = [...byCode.values()].sort((a, b) => {
    if (a.popular !== b.popular) return a.popular ? -1 : 1
    if (a.popular) return POPULAR_BANK_CODES.indexOf(a.code) - POPULAR_BANK_CODES.indexOf(b.code)
    return a.name.localeCompare(b.name)
  })
  bankCache = { banks, at: Date.now() }
  return banks
}

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<string> {
  try {
    const data = await request<{ account_name: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    )
    return data.account_name
  } catch (e) {
    if (e instanceof PaystackError && e.isDefinitive) {
      throw new HttpError(400, 'We could not verify this account number with the selected bank', 'ACCOUNT_NOT_FOUND')
    }
    throw e
  }
}

export async function createRecipient(name: string, accountNumber: string, bankCode: string): Promise<string> {
  const data = await request<{ recipient_code: string }>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({ type: 'nuban', name, account_number: accountNumber, bank_code: bankCode, currency: 'NGN' }),
  })
  return data.recipient_code
}

export interface TransferResult {
  transferCode: string
  status: TransferStatus
}

export async function verifyTransfer(reference: string): Promise<TransferResult> {
  const data = await request<{ transfer_code: string; status: TransferStatus }>(
    `/transfer/verify/${encodeURIComponent(reference)}`,
  )
  return { transferCode: data.transfer_code, status: data.status }
}

export async function initiateTransfer(params: {
  amountKobo: bigint
  recipientCode: string
  reference: string
  reason: string
}): Promise<TransferResult> {
  try {
    const data = await request<{ transfer_code: string; status: TransferStatus }>('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: Number(params.amountKobo),
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
        currency: 'NGN',
      }),
    })
    return { transferCode: data.transfer_code, status: data.status }
  } catch (e) {
    // The reference is our idempotency key: if a previous attempt already created the transfer, adopt it.
    if (e instanceof PaystackError) {
      const existing = await verifyTransfer(params.reference).catch(() => null)
      if (existing) return existing
    }
    throw e
  }
}

export function isValidWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!config.paystackSecretKey || !signature) return false
  const expected = createHmac('sha512', config.paystackSecretKey).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
