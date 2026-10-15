const API_URL = (
  (import.meta.env.VITE_API_URL as string | undefined) || `${location.protocol}//${location.hostname}:3101`
).replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: init.json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: init.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, "Can't reach KhalkosPay. Check your connection and try again.", 'NETWORK')
  }
  const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.code)
  return body as T
}

export function wsUrl(path: string) {
  return `${API_URL.replace(/^http/, 'ws')}${path}`
}

export type OrderStatus =
  | 'AWAITING_DEPOSIT'
  | 'CONFIRMING'
  | 'PAYING_OUT'
  | 'COMPLETED'
  | 'PAYOUT_FAILED'
  | 'REFUNDING'
  | 'REFUNDED'
  | 'REJECTED'
  | 'EXPIRED'

export interface LedgerLine {
  kind: 'DEPOSIT' | 'PAYOUT' | 'REFUND'
  asset: 'NIM' | 'NGN'
  amount: string
  debit: string
  credit: string
  externalRef: string
  createdAt: string
}

export interface Order {
  id: string
  reference: string
  source: 'app' | 'voice'
  status: OrderStatus
  nimAmount: string
  receivedNim: string | null
  payoutStarted: boolean
  rateNgnPerNim: number
  grossNgn: number
  feeNgn: number
  payoutNgn: number
  bankName: string
  accountName: string
  accountNumber: string
  depositTxHash: string | null
  refundTxHash: string | null
  failureReason: string | null
  expiresAt: string
  createdAt: string
  paidAt: string | null
  deposit: { recipient: string; valueLuna: number; data: string } | null
  ledger?: LedgerLine[]
}

export interface Quote {
  nimAmount: string
  rateNgnPerNim: number
  grossNgn: number
  serviceFeeNgn: number
  transferFeeNgn: number
  feeNgn: number
  payoutNgn: number
  minNim: number
  maxNim: number
  belowMinimum: boolean
  aboveMaximum: boolean
}

export interface Bank {
  code: string
  name: string
  popular: boolean
}

export interface OfframpConfig {
  enabled: boolean
  network: 'mainnet' | 'testnet'
  depositAddress: string | null
  minPayoutNgn: number
  maxPayoutNgn: number
  feePercent: number
  quoteTtlSeconds: number
}
