import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type GiftCard, type GiftConfig, type GiftStatus } from './api'

/** Statuses the server is still working on, so the card is worth polling. */
const IN_FLIGHT: GiftStatus[] = ['AWAITING_FUNDING', 'CLAIMING', 'REFUNDING']

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase())
}

export function useGiftConfig() {
  const [state, setState] = useState<{ data: GiftConfig | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let alive = true
    api<GiftConfig>('/api/giftcards/config').then(
      (data) => alive && setState({ data, error: null }),
      (e) => alive && setState({ data: null, error: messageOf(e) }),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** Polls a card while the server is moving it; `update` applies a fresh copy and resumes polling. */
export function useGiftCard(id: string | undefined) {
  const [card, setCard] = useState<GiftCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!id) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const next = await api<GiftCard>(`/api/giftcards/${id}`)
        if (!alive) return
        setCard(next)
        setError(null)
        if (IN_FLIGHT.includes(next.status)) timer = setTimeout(load, 3_000)
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

  const update = useCallback((next: GiftCard) => {
    setCard(next)
    setGeneration((n) => n + 1)
  }, [])

  return { card, error, update }
}

export function createGiftCard(input: {
  senderAddress: string
  nimAmount: string
  redeemCode: string
  message: string
  template: string
  recipientEmail?: string
  anonymous: boolean
}) {
  return api<GiftCard>('/api/giftcards', { json: input })
}

export function claimGiftCard(id: string, input: { redeemCode: string; claimerAddress: string }) {
  return api<GiftCard>(`/api/giftcards/${id}/claim`, { json: input })
}

const PENDING_KEY = 'khalkospay.pendingGiftFunding'

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
export async function reportFunding(cardId: string, tx: string): Promise<GiftCard> {
  writePending({ ...readPending(), [cardId]: tx })
  const card = await api<GiftCard>(`/api/giftcards/${cardId}/funding`, { json: { tx } })
  const { [cardId]: _, ...rest } = readPending()
  writePending(rest)
  return card
}

export async function flushPendingFunding() {
  for (const [cardId, tx] of Object.entries(readPending())) {
    try {
      await reportFunding(cardId, tx)
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const { [cardId]: _, ...rest } = readPending()
        writePending(rest)
      }
    }
  }
}
