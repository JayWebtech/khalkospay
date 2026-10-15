import { useCallback, useEffect, useRef, useState } from 'react'
import type { Order, Quote } from './api'
import { VoiceCall, type AgentActivity, type CallPhase, type TranscriptLine } from './voice-call'

export function useVoiceCall(userAddress: string | null) {
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<AgentActivity>('listening')
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [walletRequest, setWalletRequest] = useState<Order | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const callRef = useRef<VoiceCall | null>(null)

  const start = useCallback(() => {
    callRef.current?.hangUp()
    setError(null)
    setLines([])
    setWalletRequest(null)
    setOrder(null)
    setQuote(null)
    setMuted(false)
    setStartedAt(null)
    setActivity('listening')

    const call = new VoiceCall(
      {
        phase: (next, message) => {
          setPhase(next)
          if (next === 'live') setStartedAt((t) => t ?? Date.now())
          if (next === 'error') setError(message ?? 'The call dropped.')
        },
        activity: setActivity,
        transcript: (line) => setLines((prev) => [...prev, line].slice(-40)),
        walletRequest: (next) => {
          setWalletRequest(next)
          setOrder(next)
        },
        orderUpdate: (next) => {
          setOrder(next)
          if (next.status !== 'AWAITING_DEPOSIT') setWalletRequest(null)
        },
        quote: setQuote,
      },
      userAddress,
    )
    callRef.current = call
    void call.start()
  }, [userAddress])

  const hangUp = useCallback(() => callRef.current?.hangUp(), [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      callRef.current?.setMuted(!m)
      return !m
    })
  }, [])

  const sendWalletResult = useCallback((result: { ok: true; tx: string } | { ok: false }) => {
    callRef.current?.sendWalletResult(result)
    if (!result.ok) setWalletRequest(null)
  }, [])

  const levels = useCallback(() => callRef.current?.levels() ?? { mic: 0, agent: 0 }, [])

  useEffect(() => () => callRef.current?.hangUp(), [])

  return { phase, error, activity, lines, walletRequest, order, quote, muted, startedAt, start, hangUp, toggleMute, sendWalletResult, levels }
}
