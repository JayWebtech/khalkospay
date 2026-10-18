import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { api, ApiError, type OnrampOrder } from '@/lib/api'

/** Admin dashboard: the signed-in session, an authenticated fetch, and the API's response shapes. */

const SESSION_KEY = 'khalkos.admin.session'

export interface AdminSession {
  token: string
  expiresAt: string
  admin: { id: string; email: string; name: string }
}

function loadSession(): AdminSession | null {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as AdminSession | null
    return saved && new Date(saved.expiresAt).getTime() > Date.now() ? saved : null
  } catch {
    return null
  }
}

function saveSession(session: AdminSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Private mode: the session lasts for this page only.
  }
}

export const useAdminSession = create<{ session: AdminSession | null; endedReason: string | null }>(() => ({
  session: loadSession(),
  endedReason: null,
}))

function endSession(reason: string | null) {
  saveSession(null)
  useAdminSession.setState({ session: null, endedReason: reason })
}

export async function adminLogin(email: string, password: string) {
  const session = await api<AdminSession>('/api/admin/auth/login', { json: { email, password } })
  saveSession(session)
  useAdminSession.setState({ session, endedReason: null })
}

export async function adminLogout() {
  try {
    await adminApi('/api/admin/auth/logout', { method: 'POST' })
  } catch {
    // Signed out locally either way; the server session expires on its own.
  }
  endSession(null)
}

/** Fetch with the session token. A 401 means the session ended, so it signs out and the login screen shows. */
export async function adminApi<T>(path: string, init: { method?: string; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = useAdminSession.getState().session?.token
  if (!token) throw new ApiError(401, 'Sign in to the admin dashboard first', 'UNAUTHORIZED')
  try {
    return await api<T>(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && useAdminSession.getState().session?.token === token) {
      endSession(e.message)
    }
    throw e
  }
}

export function useAdminQuery<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (path === null) return
    const controller = new AbortController()
    setLoading(true)
    adminApi<T>(path, { signal: controller.signal })
      .then((body) => {
        setData(body)
        setError(null)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Something went wrong')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [path, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

// ------------------------------------------------------------------------------------------------- types

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface AdminLedgerLine {
  id?: string
  kind: 'DEPOSIT' | 'PAYOUT' | 'REFUND'
  asset: string
  amount: string
  displayAmount?: string
  debit: string
  credit: string
  externalRef: string
  createdAt: string
  source?: { type: 'CASHOUT' | 'GIFT' | 'REVIVAL' | 'BUY'; id: string; reference: string | null } | null
}

type Counts<K extends string> = Record<K, number>

export interface AdminOverview {
  generatedAt: string
  network: string
  treasuryAddress: string | null
  wallets: { total: number; new7d: number }
  admins: number
  gifts: {
    total: number
    byStatus: Counts<string>
    funded: number
    fundedNim: string
    claimedNim: string
    inEscrowNim: string
    emailsSent: number
    last7d: number
    prior7d: number
  }
  cashouts: {
    total: number
    byStatus: Counts<string>
    completed: number
    nimReceived: string
    ngnPaidOut: number
    ngnFees: number
    viaVoice: number
    last7d: number
    prior7d: number
  }
  buys: {
    total: number
    byStatus: Counts<string>
    completed: number
    nimSent: string
    paidByCurrency: { currency: string; orders: number; amount: string }[]
    needsReview: number
    last7d: number
    prior7d: number
  }
  pets: {
    total: number
    byStatus: Counts<string>
    mealsFed: number
    mealsMissed: number
    revivals: Counts<string>
    revivalNim: string
    last7d: number
    prior7d: number
  }
  ledger: { total: number; byKind: Counts<string> }
  legacyMealLogs: number
  trend: { days: string[]; series: Record<'gifts' | 'cashouts' | 'buys' | 'meals' | 'pets', number[]> }
}

export interface AdminTreasury {
  address: string | null
  balanceNim: string | null
  availableForSaleNim: string | null
  error: string | null
  /** Gift NIM, held apart from the treasury. */
  giftEscrow: { address: string | null; balanceNim: string | null }
}

export interface AdminOnrampOrder extends OnrampOrder {
  checkoutId: string | null
  chargeId: string | null
  proRataNimAmount: string | null
  reviewedAt: string | null
  /** The admin's email, or "admin-token" when settled with the static ADMIN_TOKEN. */
  reviewedBy: string | null
  reviewNote: string | null
  ledger: AdminLedgerLine[]
}

export type SettleBody = { action: 'send'; mode: 'full' | 'pro-rata'; note?: string } | { action: 'close'; note: string; refundRef?: string }

export function settleBuy(id: string, body: SettleBody) {
  return adminApi<AdminOnrampOrder>(`/api/admin/onramp/${encodeURIComponent(id)}/settle`, { json: body })
}
