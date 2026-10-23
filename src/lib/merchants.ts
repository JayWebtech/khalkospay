import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type Merchant, type MerchantPayment, type MerchantPaymentStatus, type OwnMerchant, type ReceivedPayment } from './api'
import { parseNimiqAddress } from './nimiq-address'
import { authedApi, type Session } from './wallet-session'

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

/**
 * Where KhalkosPay is hosted, e.g. khalkospay.vercel.app. Nimiq Pay deep links name the mini app by host, and the
 * full nimpay.app/miniapps/open/<host> link Nimiq Pay shares is accepted too.
 */
export const MINIAPP_HOST = ((import.meta.env.VITE_MINIAPP_URL as string | undefined) || location.host)
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/^(www\.)?nimpay\.app\/miniapps\/open\//, '')
  .replace(/\/+$/, '')

// Same alphabet as gift codes: no 0/O, 1/I/L or U.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

/** `k7qm3xpd`, `K7QM 3XPD` → `K7QM-3XPD`, or null. */
export function normalizeMerchantCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 8 || ![...code].every((c) => CODE_ALPHABET.includes(c))) return null
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

const AMOUNT = /^\d+(\.\d{1,5})?$/

function amountOf(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v && AMOUNT.test(v) && Number(v) > 0 ? v : null
}

/**
 * The link a shop's QR code carries. Inside Nimiq Pay's scanner, or any phone camera with Nimiq Pay installed, it
 * opens the shop's pay page in KhalkosPay; the in-app scanner reads it directly.
 */
export function merchantPayLink(code: string, amount?: string | null) {
  const compact = code.replace(/-/g, '')
  return `https://nimpay.app/miniapps/open/${MINIAPP_HOST}/pay/${compact}${amountOf(amount) ? `?amount=${amountOf(amount)}` : ''}`
}

export type ScanTarget =
  | { kind: 'merchant'; code: string; amount: string | null }
  | { kind: 'address'; address: string; amount: string | null; message: string | null }

function isOurHost(host: string) {
  return host === MINIAPP_HOST || host === location.host
}

/**
 * Reads what a QR code (or a pasted/typed value) says to pay: a KhalkosPay shop link or code, a `nimiq:` payment
 * URI (`nimiq:NQ07…?amount=1.5&message=…`), an old Nimiq Safe request link, or a bare NQ address.
 */
export function parseScan(raw: string): ScanTarget | null {
  const text = raw.trim()
  if (!text) return null

  const code = normalizeMerchantCode(text)
  if (code && text.replace(/[\s-]/g, '').length === 8) return { kind: 'merchant', code, amount: null }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      const host = url.host.toLowerCase()
      // nimpay.app/[locale/]miniapps/open/<host>/pay/<code>, or our own host's /pay/<code>.
      const viaNimiqPay = url.pathname.match(/^\/(?:[a-z]{2}\/)?miniapps\/open\/([^/]+)\/pay\/([^/]+)\/?$/i)
      const direct = url.pathname.match(/^\/pay\/([^/]+)\/?$/i)
      const linked =
        (host === 'nimpay.app' || host === 'www.nimpay.app') && viaNimiqPay && isOurHost(viaNimiqPay[1].toLowerCase())
          ? viaNimiqPay[2]
          : isOurHost(host) && direct
            ? direct[1]
            : null
      const linkedCode = linked ? normalizeMerchantCode(decodeURIComponent(linked)) : null
      if (linkedCode) return { kind: 'merchant', code: linkedCode, amount: amountOf(url.searchParams.get('amount')) }
      // Nimiq Safe request links: safe.nimiq.com/#_request/NQ07…/12.5_
      const safe = url.hash.match(/^#_request\/([A-Z0-9]+)(?:\/([\d.]+))?_?/i)
      const safeAddress = safe ? parseNimiqAddress(safe[1]) : null
      if (safeAddress) return { kind: 'address', address: safeAddress, amount: amountOf(safe?.[2]), message: null }
    } catch {
      // Not a URL after all; try the other formats.
    }
  }

  // nimiq:NQ07…?amount=…&message=…, on its own or inside a wallet link such as wallet.nimiq.com/nimiq:NQ…
  const uri = text.match(/nimiq:(?:\/\/)?([^?#]+)(?:\?([^#]*))?/i)
  if (uri) {
    const address = parseNimiqAddress(decodeURIComponent(uri[1]))
    if (address) {
      const params = new URLSearchParams(uri[2] ?? '')
      return { kind: 'address', address, amount: amountOf(params.get('amount')), message: params.get('message') || params.get('label') || null }
    }
  }

  const address = parseNimiqAddress(text)
  if (address) return { kind: 'address', address, amount: null, message: null }
  return null
}

/** The in-app page that pays what was scanned. */
export function scanTargetPath(target: ScanTarget) {
  const params = new URLSearchParams()
  if (target.amount) params.set('amount', target.amount)
  if (target.kind === 'address' && target.message) params.set('message', target.message)
  const query = params.toString() ? `?${params}` : ''
  return target.kind === 'merchant' ? `/pay/${target.code}${query}` : `/pay/address/${target.address.replace(/ /g, '')}${query}`
}

// ---- Shop owner ----

export interface MerchantInput {
  name: string
  category: string
  description: string
  phone: string
  location: string
  logo: string | null
  /** Empty means the signed-in wallet. */
  payoutAddress: string
}

/** The signed-in wallet's shop: undefined while loading, null when it has none yet. */
export function useOwnMerchant(session: Session | null) {
  const [state, setState] = useState<{ merchant: OwnMerchant | null | undefined; error: string | null }>({ merchant: undefined, error: null })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!session) {
      setState({ merchant: undefined, error: null })
      return
    }
    let alive = true
    authedApi<{ merchant: OwnMerchant | null }>(session, '/api/merchants/me').then(
      (r) => alive && setState({ merchant: r.merchant, error: null }),
      (e) => alive && setState((s) => ({ merchant: s.merchant, error: messageOf(e) })),
    )
    return () => {
      alive = false
    }
  }, [session, generation])
  const reload = useCallback(() => setGeneration((n) => n + 1), [])
  return { ...state, reload }
}

export function saveMerchant(session: Session, input: MerchantInput) {
  return authedApi<OwnMerchant>(session, '/api/merchants/me', {
    method: 'PUT',
    json: {
      ...input,
      phone: input.phone.trim() || null,
      location: input.location.trim() || null,
      payoutAddress: input.payoutAddress.trim() || null,
    },
  })
}

/** Payments the shop received, refreshed every 8 seconds while shown (each refresh also scans the chain). */
export function useReceivedPayments(session: Session | null, enabled: boolean) {
  const [state, setState] = useState<{ payments: ReceivedPayment[] | null; totals: { receivedNim: string; receivedCount: number } | null; error: string | null }>({
    payments: null,
    totals: null,
    error: null,
  })
  useEffect(() => {
    if (!session || !enabled) return
    let alive = true
    const load = async () => {
      try {
        const r = await authedApi<{ payments: ReceivedPayment[]; totals: { receivedNim: string; receivedCount: number } }>(session, '/api/merchants/me/payments')
        if (alive) setState({ payments: r.payments, totals: r.totals, error: null })
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: messageOf(e) }))
      }
    }
    void load()
    const timer = setInterval(load, 8_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [session, enabled])
  return state
}

// ---- Payer ----

/** A shop by its code or by the address a QR carried; `merchant: null` once it's clear there is no such shop. */
export function useMerchantLookup(lookup: { code: string } | { address: string } | null) {
  const key = lookup ? ('code' in lookup ? `code:${lookup.code}` : `address:${lookup.address}`) : null
  const [state, setState] = useState<{ key: string | null; merchant: Merchant | null | undefined; error: string | null }>({ key: null, merchant: undefined, error: null })
  useEffect(() => {
    if (!key) return
    let alive = true
    const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
    const path = kind === 'code' ? `/api/merchants/${encodeURIComponent(value)}` : `/api/merchants/by-address/${encodeURIComponent(value)}`
    api<Merchant>(path).then(
      (merchant) => alive && setState({ key, merchant, error: null }),
      (e) => alive && setState({ key, merchant: e instanceof ApiError && e.status === 404 ? null : undefined, error: e instanceof ApiError && e.status === 404 ? null : messageOf(e) }),
    )
    return () => {
      alive = false
    }
  }, [key])
  return state.key === key ? state : { merchant: undefined, error: null }
}

export function createMerchantPayment(code: string, input: { amountNim: string; note: string; payerAddress: string | null }) {
  return api<MerchantPayment>(`/api/merchants/${encodeURIComponent(code)}/payments`, { json: input })
}

const PENDING_KEY = 'khalkospay.pendingMerchantPayments'
const SIGNED_KEY = 'khalkospay.signedMerchantPayments'

function readMap(key: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, value: Record<string, string>) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // The server also finds payments by their memo, so a lost record is recoverable.
  }
}

/** True once this device had Nimiq Pay send a payment for it: paying again could pay twice. */
export function wasSigned(paymentId: string) {
  return paymentId in readMap(SIGNED_KEY)
}

/** Records the wallet's tx locally first, so a dropped connection is retried on next launch. */
export async function reportPaymentTx(paymentId: string, tx: string): Promise<MerchantPayment> {
  const signed = readMap(SIGNED_KEY)
  // Keep the newest 50; older payments have long been confirmed or expired.
  writeMap(SIGNED_KEY, Object.fromEntries([...Object.entries(signed).filter(([id]) => id !== paymentId), [paymentId, tx]].slice(-50)))
  writeMap(PENDING_KEY, { ...readMap(PENDING_KEY), [paymentId]: tx })
  const payment = await api<MerchantPayment>(`/api/merchants/payments/${paymentId}/tx`, { json: { tx } })
  const { [paymentId]: _, ...rest } = readMap(PENDING_KEY)
  writeMap(PENDING_KEY, rest)
  return payment
}

export async function flushPendingPaymentReports() {
  for (const [paymentId, tx] of Object.entries(readMap(PENDING_KEY))) {
    try {
      await reportPaymentTx(paymentId, tx)
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const { [paymentId]: _, ...rest } = readMap(PENDING_KEY)
        writeMap(PENDING_KEY, rest)
      }
    }
  }
}

const IN_FLIGHT: MerchantPaymentStatus[] = ['AWAITING_PAYMENT', 'CONFIRMING']

/** Polls a payment while it can still change; `update` applies a fresh copy and resumes polling. */
export function usePayment(id: string | undefined) {
  const [payment, setPayment] = useState<MerchantPayment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!id) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const next = await api<MerchantPayment>(`/api/merchants/payments/${id}`)
        if (!alive) return
        setPayment(next)
        setError(null)
        if (IN_FLIGHT.includes(next.status)) timer = setTimeout(load, next.status === 'CONFIRMING' ? 2_000 : 4_000)
      } catch (e) {
        if (!alive) return
        setError(messageOf(e))
        if (!(e instanceof ApiError && e.status === 404)) timer = setTimeout(load, 5_000)
      }
    }
    void load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [id, generation])

  const update = useCallback((next: MerchantPayment) => {
    setPayment(next)
    setGeneration((n) => n + 1)
  }, [])

  return { payment, error, update }
}
