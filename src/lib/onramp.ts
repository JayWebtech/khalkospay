import { useEffect, useState } from 'react'
import { api, ApiError, type OnrampConfig, type OnrampOrder, type OnrampQuote, type OnrampStatus } from './api'

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export const CURRENCY_FLAG: Record<string, string> = {
  NGN: '🇳🇬',
  GHS: '🇬🇭',
  KES: '🇰🇪',
  UGX: '🇺🇬',
  TZS: '🇹🇿',
  RWF: '🇷🇼',
  XAF: '🇨🇲',
  XOF: '🇨🇮',
  ZMW: '🇿🇲',
  MWK: '🇲🇼',
  USD: '🇺🇸',
}

const ZONE_CURRENCY: Record<string, string> = {
  'Africa/Lagos': 'NGN',
  'Africa/Accra': 'GHS',
  'Africa/Nairobi': 'KES',
  'Africa/Kampala': 'UGX',
  'Africa/Dar_es_Salaam': 'TZS',
  'Africa/Kigali': 'RWF',
  'Africa/Lusaka': 'ZMW',
  'Africa/Blantyre': 'MWK',
  'Africa/Douala': 'XAF',
  'Africa/Libreville': 'XAF',
  'Africa/Malabo': 'XAF',
  'Africa/Bangui': 'XAF',
  'Africa/Brazzaville': 'XAF',
  'Africa/Ndjamena': 'XAF',
  'Africa/Abidjan': 'XOF',
  'Africa/Dakar': 'XOF',
  'Africa/Bamako': 'XOF',
  'Africa/Ouagadougou': 'XOF',
  'Africa/Niamey': 'XOF',
  'Africa/Lome': 'XOF',
  'Africa/Porto-Novo': 'XOF',
}

const CURRENCY_KEY = 'khalkospay.buyCurrency'

/** The last currency used, else a guess from the device timezone, else naira. */
export function defaultBuyCurrency(available: string[]) {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(CURRENCY_KEY)
  } catch {
    // ignore
  }
  const zone = ZONE_CURRENCY[Intl.DateTimeFormat().resolvedOptions().timeZone]
  return [saved, zone, 'NGN', available[0]].find((c): c is string => Boolean(c && available.includes(c))) ?? 'NGN'
}

export function rememberBuyCurrency(code: string) {
  try {
    localStorage.setItem(CURRENCY_KEY, code)
  } catch {
    // ignore
  }
}

let configPromise: Promise<OnrampConfig> | null = null

export function useOnrampConfig() {
  const [state, setState] = useState<{ data: OnrampConfig | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let alive = true
    configPromise ??= api<OnrampConfig>('/api/onramp/config')
    configPromise.then(
      (data) => alive && setState({ data, error: null }),
      (e) => {
        configPromise = null
        if (alive) setState({ data: null, error: messageOf(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** Live quote for an amount, debounced, refreshed every 30 seconds while shown. */
export function useOnrampQuote(currency: string, amount: string) {
  const [state, setState] = useState<{ quote: OnrampQuote | null; loading: boolean; error: string | null }>({ quote: null, loading: false, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!currency || !(Number(amount) > 0)) {
      setState({ quote: null, loading: false, error: null })
      return
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(() => {
      api<OnrampQuote>(`/api/onramp/quote?currency=${encodeURIComponent(currency)}&amount=${encodeURIComponent(amount)}`, { signal: controller.signal })
        .then((quote) => setState({ quote, loading: false, error: null }))
        .catch((e) => {
          if (!controller.signal.aborted) setState({ quote: null, loading: false, error: messageOf(e) })
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [currency, amount, tick])

  return state
}

export function createBuyOrder(input: { address: string; currency: string; amount: string }) {
  return api<OnrampOrder>('/api/onramp/orders', { json: input })
}

const FINAL: OnrampStatus[] = ['COMPLETED', 'EXPIRED', 'NEEDS_REVIEW', 'RESOLVED']

export function isFinalBuy(status: OnrampStatus) {
  return FINAL.includes(status)
}

/** Polls a purchase until it settles. */
export function useBuyOrder(id: string | undefined) {
  const [order, setOrder] = useState<OnrampOrder | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const next = await api<OnrampOrder>(`/api/onramp/orders/${id}`)
        if (!alive) return
        setOrder(next)
        setError(null)
        if (!isFinalBuy(next.status)) timer = setTimeout(load, 3_000)
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
  }, [id])

  return { order, error }
}

/** Recent purchases for the connected wallet. */
export function useBuyOrders(address: string | null) {
  const [orders, setOrders] = useState<OnrampOrder[] | null>(null)
  useEffect(() => {
    if (!address) {
      setOrders(null)
      return
    }
    let alive = true
    api<OnrampOrder[]>(`/api/onramp/orders?address=${encodeURIComponent(address)}`).then(
      (list) => alive && setOrders(list),
      () => alive && setOrders([]),
    )
    return () => {
      alive = false
    }
  }, [address])
  return orders
}
