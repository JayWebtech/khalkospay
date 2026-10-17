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

export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: { ...(init.json === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
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

export type GiftStatus = 'AWAITING_FUNDING' | 'ACTIVE' | 'CLAIMING' | 'CLAIMED' | 'EXPIRED' | 'REFUNDING' | 'REFUNDED'

export interface GiftCard {
  id: string
  /** Short code a recipient can type into the app, e.g. K7QM-3XPD. */
  shareCode: string | null
  /** Null for anonymous gifts. */
  senderName: string | null
  /** Whether the recipient was emailed the gift link; null when no email was given. */
  email: 'sent' | 'pending' | 'failed' | null
  status: GiftStatus
  nimAmount: string
  message: string
  template: string
  senderAddress: string | null
  network: 'mainnet' | 'testnet'
  confirming: boolean
  funding: { recipient: string; valueLuna: number; data: string } | null
  fundingTxHash: string | null
  claimerAddress: string | null
  claimTxHash: string | null
  refundTxHash: string | null
  failureReason: string | null
  expiresAt: string
  createdAt: string
  fundedAt: string | null
  claimedAt: string | null
  reclaimed: boolean
}

/** A gift in "Gifts you've sent". The extra fields only come with the signed-in, cross-device list. */
export interface SentGift extends GiftCard {
  anonymous?: boolean
  recipientEmail?: string | null
  reclaimedAt?: string | null
}

export interface GiftConfig {
  enabled: boolean
  network: 'mainnet' | 'testnet'
  minCodeLength: number
  fundingTtlSeconds: number
}

export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'DINNER'
export type PetMood = 'thriving' | 'happy' | 'hungry' | 'weak' | 'sleeping' | 'dead'

export interface PetSpecies {
  id: string
  name: string
  kind: string
  title: string
  description: string
  ability: { name: string; description: string }
  bestAt: string
  watchOut: string
  stats: { metabolism: number; toughness: number; growth: number }
  missPenalty: Record<MealSlot, number>
}

export interface PetConfig {
  network: 'mainnet' | 'testnet'
  reviveEnabled: boolean
  revivePriceNim: string
  windows: { slot: MealSlot; startHour: number; endHour: number }[]
  species: PetSpecies[]
}

export interface PetMeal {
  id: string
  day: string
  slot: MealSlot
  fed: boolean
  name: string | null
  score: number | null
  strengthDelta: number
  xpDelta: number
  nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number } | null
  createdAt: string
}

export interface PetWindow {
  slot: MealSlot
  start: string
  end: string
  state: 'fed' | 'missed' | 'open' | 'upcoming' | 'skipped'
  meal: PetMeal | null
}

export interface Pet {
  id: string
  name: string
  species: string
  status: 'ALIVE' | 'DEAD'
  mood: PetMood
  strength: number
  xp: number
  level: number
  levelXp: number
  levelSize: number
  timezone: string
  adoptedAt: string
  aliveSince: string
  diedAt: string | null
  deathReason: string | null
  revivals: number
  lastStandAvailable: boolean
  today: { day: string; windows: PetWindow[] }
  current: { slot: MealSlot; closesAt: string } | null
  next: { slot: MealSlot; opensAt: string }
  recentMeals: PetMeal[]
}

export interface PetRevival {
  id: string
  status: 'AWAITING_PAYMENT' | 'PAID' | 'EXPIRED' | 'REFUNDING' | 'REFUNDED'
  priceNim: string
  receivedNim: string | null
  confirming: boolean
  payment: { recipient: string; valueLuna: number; data: string } | null
  txHash: string | null
  refundTxHash: string | null
  failureReason: string | null
  expiresAt: string
}

export interface OnrampCurrency {
  code: string
  name: string
  country: string
  decimals: number
  methodLabel: string
}

export interface OnrampConfig {
  enabled: boolean
  network: 'mainnet' | 'testnet'
  feePercent: number
  checkoutTtlMinutes: number
  currencies: OnrampCurrency[]
}

export interface OnrampQuote {
  currency: string
  amount: string
  nimAmount: string
  fiatPerNim: number
  feePercent: number
  feeAmount: string
  minAmount: string
  maxAmount: string
  availableNim: string
  belowMinimum: boolean
  aboveMaximum: boolean
  exceedsStock: boolean
}

export type OnrampStatus = 'AWAITING_PAYMENT' | 'PAID' | 'SENDING' | 'COMPLETED' | 'EXPIRED' | 'NEEDS_REVIEW' | 'RESOLVED'

export interface OnrampOrder {
  id: string
  reference: string
  status: OnrampStatus
  currency: string
  amount: string
  nimAmount: string
  fiatPerNim: number
  feePercent: number
  walletAddress: string
  payoutAddress: string
  checkoutUrl: string | null
  checkoutExpiresAt: string
  paidAmount: string | null
  paidAt: string | null
  payoutTxHash: string | null
  completedAt: string | null
  failureReason: string | null
  createdAt: string
}
