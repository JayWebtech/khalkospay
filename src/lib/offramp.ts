import { useEffect, useState } from 'react'
import { api, ApiError, type Bank, type OfframpConfig, type Order, type OrderStatus, type Quote } from './api'

const TERMINAL: OrderStatus[] = ['COMPLETED', 'REFUNDED', 'REJECTED', 'EXPIRED']

export function isTerminal(status: OrderStatus) {
  return TERMINAL.includes(status)
}

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

const onceCache = new Map<string, Promise<unknown>>()

function useOnce<T>(key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let alive = true
    if (!onceCache.has(key)) onceCache.set(key, load())
    ;(onceCache.get(key) as Promise<T>).then(
      (data) => alive && setState({ data, error: null }),
      (e) => {
        onceCache.delete(key)
        if (alive) setState({ data: null, error: messageOf(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [key])
  return state
}

export const useOfframpConfig = () => useOnce('config', () => api<OfframpConfig>('/api/offramp/config'))
export const useBanks = () => useOnce('banks', () => api<Bank[]>('/api/offramp/banks'))

export function useRate() {
  const [rate, setRate] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      api<{ ngnPerNim: number }>('/api/offramp/rate')
        .then((r) => alive && setRate(r.ngnPerNim))
        .catch(() => {})
    void load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return rate
}

export function useQuote(nimInput: string) {
  const [state, setState] = useState<{ quote: Quote | null; loading: boolean; error: string | null }>({
    quote: null,
    loading: false,
    error: null,
  })
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setRefresh((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!nimInput || !(Number(nimInput) > 0)) {
      setState({ quote: null, loading: false, error: null })
      return
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(() => {
      api<Quote>(`/api/offramp/quote?nim=${encodeURIComponent(nimInput)}`, { signal: controller.signal })
        .then((quote) => setState({ quote, loading: false, error: null }))
        .catch((e) => {
          if (!controller.signal.aborted) setState({ quote: null, loading: false, error: messageOf(e) })
        })
    }, 350)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [nimInput, refresh])

  return state
}

export function useAccountName(bankCode: string | null, accountNumber: string) {
  const [state, setState] = useState<{ name: string | null; loading: boolean; error: string | null }>({
    name: null,
    loading: false,
    error: null,
  })

  useEffect(() => {
    if (!bankCode || !/^\d{10}$/.test(accountNumber)) {
      setState({ name: null, loading: false, error: null })
      return
    }
    const controller = new AbortController()
    setState({ name: null, loading: true, error: null })
    const timer = setTimeout(() => {
      api<{ accountName: string }>('/api/offramp/resolve-account', {
        json: { bankCode, accountNumber },
        signal: controller.signal,
      })
        .then((r) => setState({ name: r.accountName, loading: false, error: null }))
        .catch((e) => {
          if (!controller.signal.aborted) setState({ name: null, loading: false, error: messageOf(e) })
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [bankCode, accountNumber])

  return state
}

export function useOrder(id: string | undefined) {
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const next = await api<Order>(`/api/offramp/orders/${id}`)
        if (!alive) return
        setOrder(next)
        setError(null)
        if (!isTerminal(next.status)) timer = setTimeout(load, 3_000)
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

export function useOrders(address: string | null) {
  const [orders, setOrders] = useState<Order[] | null>(null)

  useEffect(() => {
    if (!address) {
      setOrders(null)
      return
    }
    let alive = true
    const load = () =>
      api<Order[]>(`/api/offramp/orders?address=${encodeURIComponent(address)}`)
        .then((list) => alive && setOrders(list))
        .catch(() => alive && setOrders((prev) => prev ?? []))
    void load()
    const timer = setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [address])

  return orders
}

export function createOrder(input: { userAddress: string; nimAmount: string; bankCode: string; accountNumber: string }) {
  return api<Order>('/api/offramp/orders', { json: input })
}

const PENDING_KEY = 'khalkospay.pendingDeposits'

function readPending(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}')
  } catch {
    return {}
  }
}

function writePending(pending: Record<string, string>) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // The server also scans the deposit address, so a lost record is recoverable.
  }
}

/** Records the wallet's tx locally first so a dropped connection can be retried on next launch. */
export async function reportDeposit(orderId: string, tx: string): Promise<Order> {
  writePending({ ...readPending(), [orderId]: tx })
  const order = await api<Order>(`/api/offramp/orders/${orderId}/deposit`, { json: { tx } })
  const { [orderId]: _, ...rest } = readPending()
  writePending(rest)
  return order
}

export async function flushPendingDeposits() {
  for (const [orderId, tx] of Object.entries(readPending())) {
    try {
      await reportDeposit(orderId, tx)
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const { [orderId]: _, ...rest } = readPending()
        writePending(rest)
      }
    }
  }
}
