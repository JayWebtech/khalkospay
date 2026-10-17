import { CircleAlert, Landmark, Mic, MicOff, Phone, PhoneOff, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { shortBankName, StatusBadge } from '@/components/order-status'
import { PageHeader } from '@/components/page-header'
import { VoiceOrb } from '@/components/voice-orb'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Order } from '@/lib/api'
import { formatDuration, formatNgn, formatNim } from '@/lib/format'
import { reportDeposit } from '@/lib/offramp'
import { useVoiceCall } from '@/lib/use-voice-call'
import { cn } from '@/lib/utils'
import { voiceCallUnsupportedReason } from '@/lib/voice-call'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const STEPS = [
  { icon: Mic, text: 'Say how much NIM you want to cash out' },
  { icon: Landmark, text: 'Give your bank and account number. Khalkos reads the name back.' },
  { icon: Wallet, text: 'Approve the payment in Nimiq Pay. Naira lands in your bank.' },
]

export function VoiceOfframpPage() {
  const wallet = useWallet()
  const call = useVoiceCall(wallet.address)
  const unsupported = useMemo(() => voiceCallUnsupportedReason(), [])
  const inCall = call.phase === 'connecting' || call.phase === 'live' || call.phase === 'ending'

  if (inCall) return <LiveCall call={call} />

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Voice cash-out" description="Talk to Khalkos, get naira" />
      <div className="flex flex-1 flex-col gap-5 px-4 pt-2 pb-6">
        {call.phase === 'ended' ? (
          <CallSummary order={call.order} startedAt={call.startedAt} />
        ) : (
          <section className="flex flex-col items-center rounded-3xl bg-hero px-5 pt-4 pb-6 text-center text-hero-foreground">
            <VoiceOrb levels={call.levels} active={false} thinking={false} />
            <h2 className="-mt-2 text-2xl font-semibold tracking-tight">Cash out by talking</h2>
            <p className="mt-1 max-w-[32ch] text-sm text-hero-muted">
              A live call with Khalkos, our AI assistant. It handles the details; you approve the payment.
            </p>
          </section>
        )}

        {call.phase === 'error' && call.error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>The call couldn't continue</AlertTitle>
            <AlertDescription>{call.error}</AlertDescription>
          </Alert>
        )}

        {call.phase !== 'ended' && (
          <ol className="flex flex-col gap-3">
            {STEPS.map(({ icon: Icon, text }, i) => (
              <li key={text} className="flex items-start gap-3 text-sm">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="pt-2">
                  <span className="sr-only">Step {i + 1}: </span>
                  {text}
                </span>
              </li>
            ))}
          </ol>
        )}

        <WalletNotice purpose="paying during the call" />

        {unsupported ? (
          <Alert>
            <CircleAlert />
            <AlertTitle>Voice isn't available here</AlertTitle>
            <AlertDescription>
              {unsupported}{' '}
              <Link to="/cash-out" className="font-medium text-foreground underline underline-offset-4">
                Use the cash-out form instead.
              </Link>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="mt-auto flex flex-col gap-2">
            <Button size="xl" onClick={call.start}>
              <Phone data-icon="inline-start" />
              {call.phase === 'idle' ? 'Start call' : 'Call again'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">Uses your microphone only while the call is on.</p>
          </div>
        )}
      </div>
    </div>
  )
}

type Call = ReturnType<typeof useVoiceCall>

const ACTIVITY_LABEL = { listening: 'Listening', thinking: 'Thinking…', speaking: 'Speaking' } as const

function LiveCall({ call }: { call: Call }) {
  const [now, setNow] = useState(Date.now())
  const captionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    captionsRef.current?.scrollTo({ top: captionsRef.current.scrollHeight })
  }, [call.lines])

  const connecting = call.phase === 'connecting'
  const status = connecting ? 'Connecting…' : call.phase === 'ending' ? 'Ending call…' : ACTIVITY_LABEL[call.activity]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-hero text-hero-foreground">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Khalkos</p>
            <p className="text-sm text-hero-muted">KhalkosPay voice cash-out</p>
          </div>
          <span className="flex items-center gap-2 rounded-full bg-hero-foreground/10 px-3 py-1.5 text-sm tabular-nums">
            <span className={cn('size-2 rounded-full', connecting ? 'bg-hero-muted' : 'bg-success motion-safe:animate-pulse')} aria-hidden="true" />
            {connecting || !call.startedAt ? 'Connecting' : formatDuration((now - call.startedAt) / 1000)}
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center">
          <VoiceOrb levels={call.levels} active={!connecting} thinking={call.activity === 'thinking'} compact={Boolean(call.walletRequest)} />
          <p className="mt-1 text-base font-medium" aria-live="polite">
            {status}
            {call.muted && !connecting ? ' · You are muted' : ''}
          </p>
          {call.quote && !call.order && (
            <p className="mt-3 rounded-full bg-hero-foreground/10 px-3 py-1.5 text-sm tabular-nums">
              {formatNim(call.quote.nimAmount)} → {formatNgn(call.quote.payoutNgn)}
            </p>
          )}
          {call.order && call.order.status !== 'AWAITING_DEPOSIT' && (
            <div className="mt-3 flex items-center gap-2 rounded-full bg-card py-1 pr-3 pl-1 text-sm text-card-foreground">
              <StatusBadge status={call.order.status} />
              <span className="tabular-nums">{formatNgn(call.order.payoutNgn)}</span>
            </div>
          )}
        </div>

        <div
          ref={captionsRef}
          className="mask-t-from-60% max-h-36 overflow-y-auto overscroll-contain py-2 text-[0.9375rem]"
          aria-label="Live captions"
          aria-live="polite"
        >
          {call.lines.map((line) => (
            <p key={line.id} className={cn('py-1', line.role === 'user' ? 'text-right text-hero-muted' : 'text-hero-foreground')}>
              <span className="sr-only">{line.role === 'user' ? 'You: ' : 'Khalkos: '}</span>
              {line.text}
            </p>
          ))}
        </div>

        {call.walletRequest && <ApprovalCard order={call.walletRequest} onResult={call.sendWalletResult} />}

        <div className="mt-4 flex items-center justify-center gap-6">
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="hero"
              size="icon-xl"
              className="size-14 rounded-full"
              aria-pressed={call.muted}
              aria-label={call.muted ? 'Unmute' : 'Mute'}
              onClick={call.toggleMute}
              disabled={connecting}
            >
              {call.muted ? <MicOff /> : <Mic />}
            </Button>
            <span className="text-xs text-hero-muted">{call.muted ? 'Unmute' : 'Mute'}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Button variant="destructive-solid" size="icon-xl" className="size-16 rounded-full" aria-label="End call" onClick={call.hangUp}>
              <PhoneOff />
            </Button>
            <span className="text-xs text-hero-muted">End</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ApprovalCard({ order, onResult }: { order: Order; onResult: Call['sendWalletResult'] }) {
  const pay = useWallet((s) => s.pay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    if (!order.deposit) return
    setBusy(true)
    setError(null)
    try {
      const tx = await pay(order.deposit)
      await reportDeposit(order.id, tx).catch(() => { })
      onResult({ ok: true, tx })
    } catch (e) {
      if (isUserRejection(e)) onResult({ ok: false })
      else setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="approve-heading"
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 rounded-3xl bg-card p-4 text-card-foreground shadow-xl duration-300"
    >
      <h2 id="approve-heading" className="text-sm text-muted-foreground">
        Approve cash-out
      </h2>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{formatNgn(order.payoutNgn)}</p>
      <p className="text-sm text-muted-foreground">
        to {order.accountName} · {shortBankName(order.bankName)} {order.accountNumber}
      </p>
      <p className="mt-2 flex gap-1.5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        You pay {formatNim(order.nimAmount, 5)}. Refunded automatically if the bank transfer fails.
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <Button size="xl" onClick={() => void approve()} disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
          {busy ? 'Waiting for approval…' : 'Approve in Nimiq Pay'}
        </Button>
        <Button size="xl" variant="ghost" onClick={() => onResult({ ok: false })} disabled={busy}>
          Not now
        </Button>
      </div>
    </section>
  )
}

function CallSummary({ order, startedAt }: { order: Order | null; startedAt: number | null }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-live="polite">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Call ended</h2>
        <p className="text-sm text-muted-foreground">{startedAt ? `Lasted ${formatDuration((Date.now() - startedAt) / 1000)}` : 'The call ended.'}</p>
      </div>
      {order ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatNgn(order.payoutNgn)} to {shortBankName(order.bankName)}
            </p>
            <StatusBadge status={order.status} />
          </div>
          <ButtonLink to={`/cash-out/${order.id}`} variant="outline" size="lg">
            View receipt
          </ButtonLink>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No cash-out was started on this call.</p>
      )}
    </section>
  )
}
