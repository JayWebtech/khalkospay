import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type GiftCard, type GiftConfig, type GiftStatus, type SentGift } from './api'
import { authedApi, type Session } from './wallet-session'

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
        // Also keep watching a funded gift until its recipient email goes out.
        if (IN_FLIGHT.includes(next.status) || (next.status === 'ACTIVE' && next.email === 'pending')) timer = setTimeout(load, 3_000)
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
  senderName?: string
}) {
  return api<GiftCard>('/api/giftcards', { json: input })
}

/** Where KhalkosPay is hosted, e.g. khalkospay.app. Nimiq Pay deep links name the mini app by domain. */
const MINIAPP_HOST = ((import.meta.env.VITE_MINIAPP_URL as string | undefined) || location.host).replace(/^https?:\/\//, '').replace(/\/+$/, '')

/** Opens the gift inside Nimiq Pay. If Nimiq Pay drops the path, the gift code still gets them there. */
export function giftMiniAppLink(card: { id: string }) {
  return `https://nimpay.app/miniapps/open/${MINIAPP_HOST}/gift/${card.id}`
}

export function giftShareText(card: { id: string; shareCode: string | null }) {
  return [
    'You got a KhalkosPay gift! Open it in Nimiq Pay:',
    giftMiniAppLink(card),
    ...(card.shareCode ? ['', `Or open KhalkosPay in Nimiq Pay, go to Gifts and enter gift code ${card.shareCode}.`] : []),
    "I'll send you the secret code separately.",
  ].join('\n')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Turns a pasted gift link, mini-app link or typed gift code into the key the /gift/:key page understands. */
export function giftKeyFrom(input: string): string | null {
  const text = input.trim()
  const fromLink = text.match(/\/gift\/([^/?#\s]+)/)?.[1]
  const key = decodeURIComponent(fromLink ?? text)
  if (UUID.test(key)) return key.toLowerCase()
  const code = key.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : null
}

export function isGiftId(key: string) {
  return UUID.test(key)
}

export function claimGiftCard(id: string, input: { redeemCode: string; claimerAddress: string }) {
  return api<GiftCard>(`/api/giftcards/${id}/claim`, { json: input })
}

/** The signed-in wallet's sent gifts, refreshed every 20 seconds while shown. */
export function useMyGifts(session: Session | null) {
  const [state, setState] = useState<{ gifts: SentGift[] | null; error: string | null }>({ gifts: null, error: null })
  useEffect(() => {
    if (!session) {
      setState({ gifts: null, error: null })
      return
    }
    let alive = true
    const load = () =>
      authedApi<SentGift[]>(session, '/api/giftcards').then(
        (gifts) => alive && setState({ gifts, error: null }),
        (e) => alive && setState((s) => ({ gifts: s.gifts, error: messageOf(e) })),
      )
    void load()
    const timer = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [session])
  return state
}

export function reclaimGift(session: Session, id: string) {
  return authedApi<GiftCard>(session, `/api/giftcards/${id}/reclaim`, { json: {} })
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

/** True while a signed payment for this gift hasn't been accepted by the server yet; paying again could double-pay. */
export function hasPendingFunding(cardId: string) {
  return cardId in readPending()
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
