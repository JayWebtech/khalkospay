import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, ScanLine, TimerOff, Wallet, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { CopyButton } from '@/components/copy-button'
import { MerchantAvatar } from '@/components/merchant-avatar'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { MerchantPayment } from '@/lib/api'
import { formatNim, shortAddress, shortHash } from '@/lib/format'
import { reportPaymentTx, usePayment, wasSigned } from '@/lib/merchants'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const CANCELLED = 'Payment cancelled. Nothing left your wallet.'
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

interface Status {
  icon: LucideIcon
  tone: string
  title: string
  body: string
  spin?: boolean
}

function statusOf(p: MerchantPayment): Status {
  const amount = formatNim(p.nimAmount, 5)
  switch (p.status) {
    case 'CONFIRMED':
      return {
        icon: CircleCheck,
        tone: 'bg-success/12 text-success',
        title: `Paid ${amount}`,
        body: p.underpaid ? `${p.merchant.name} asked for ${formatNim(p.requestedNim, 5)}, so you may still owe the difference.` : `${p.merchant.name} has your payment.`,
      }
    case 'CONFIRMING':
      return { icon: LoaderCircle, tone: 'bg-accent text-accent-foreground', title: 'Confirming your payment', body: 'This usually takes a few seconds on the Nimiq network.', spin: true }
    case 'AWAITING_PAYMENT':
      if (p.failureReason) return { icon: CircleX, tone: 'bg-destructive/10 text-destructive', title: 'Payment not verified', body: `${p.failureReason}.` }
      if (wasSigned(p.id)) return { icon: Clock, tone: 'bg-accent text-accent-foreground', title: 'Looking for your payment', body: "Nimiq Pay sent it. We're waiting to see it on the Nimiq network." }
      return { icon: Wallet, tone: 'bg-accent text-accent-foreground', title: 'Waiting for your approval', body: `Approve ${amount} to ${p.merchant.name} in Nimiq Pay.` }
    case 'EXPIRED':
      return { icon: TimerOff, tone: 'bg-muted text-foreground', title: 'This payment expired', body: "It wasn't paid in time. Nothing left your wallet." }
  }
}

/** The payer's receipt, live until the network confirms it. */
export function PayReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const { payment, error, update } = usePayment(id)
  const status = payment ? statusOf(payment) : null
  const Icon = status?.icon
  // Never offer to pay again for a payment this phone already sent, unless the server said that transaction didn't count.
  const canPay = payment?.status === 'AWAITING_PAYMENT' && payment.payment && (!wasSigned(payment.id) || payment.failureReason)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Receipt" back="/scan" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {!payment && !error && <Skeleton className="h-80 rounded-3xl" />}
        {!payment && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {payment && status && Icon && (
          <section className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center ring-1 ring-foreground/10" aria-live="polite">
            <span className={cn('flex size-14 items-center justify-center rounded-full', status.tone)}>
              <Icon className={cn('size-7', status.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
            </span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{status.title}</h2>
            <p className="mt-1 max-w-[34ch] text-sm text-muted-foreground">{status.body}</p>
            {canPay && <PayAgain payment={payment} onReported={update} />}

            <div className="mt-5 flex w-full items-center gap-3 border-t pt-5 text-left">
              <MerchantAvatar name={payment.merchant.name} logo={payment.merchant.logo} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{payment.merchant.name}</p>
                <p className="truncate text-sm text-muted-foreground">{[payment.merchant.category, payment.merchant.location].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </section>
        )}

        {payment && (
          <dl className="flex flex-col gap-3 rounded-3xl bg-card p-5 text-sm ring-1 ring-foreground/10">
            <Row label="Amount" value={payment.receivedNim && payment.underpaid ? `${formatNim(payment.receivedNim, 5)} of ${formatNim(payment.requestedNim, 5)}` : formatNim(payment.nimAmount, 5)} />
            <Row label={payment.confirmedAt ? 'Paid' : 'Started'} value={when.format(new Date(payment.confirmedAt ?? payment.createdAt))} />
            {payment.note && <Row label="Note" value={`“${payment.note}”`} />}
            <Row label="To" value={shortAddress(payment.recipient)} mono copy={payment.recipient} copyLabel="Copy shop address" />
            {payment.paidFrom && <Row label="From" value={shortAddress(payment.paidFrom)} mono />}
            {payment.txHash && <Row label="Transaction" value={shortHash(payment.txHash)} mono copy={payment.txHash} copyLabel="Copy transaction hash" />}
            <Row label="Reference" value={payment.reference} mono copy={payment.reference} copyLabel="Copy reference" />
          </dl>
        )}

        <div className="grid grid-cols-2 gap-2">
          <ButtonLink to="/scan" size="xl" variant="outline">
            <ScanLine data-icon="inline-start" />
            Scan again
          </ButtonLink>
          <ButtonLink to="/" size="xl">
            Done
          </ButtonLink>
        </div>
        {payment?.status === 'EXPIRED' && (
          <ButtonLink to={`/pay/${payment.merchant.code}`} size="xl" variant="ghost">
            Start a new payment to {payment.merchant.name}
          </ButtonLink>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono, copy, copyLabel }: { label: string; value: string; mono?: boolean; copy?: string; copyLabel?: string }) {
  return (
    <div className={cn('flex items-center gap-3', copy && '-my-1.5')}>
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 flex-1 truncate tabular-nums', mono && 'font-mono')}>{value}</dd>
      {copy && <CopyButton value={copy} label={copyLabel ?? `Copy ${label.toLowerCase()}`} />}
    </div>
  )
}

function PayAgain({ payment, onReported }: { payment: MerchantPayment; onReported: (p: MerchantPayment) => void }) {
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once Nimiq Pay sends it, never offer another button: the server attaches it by memo even if reporting fails.
  if (sent) return <p className="mt-4 text-sm text-muted-foreground">Payment sent. Checking it on the Nimiq network…</p>
  if (wallet.status !== 'connected' || !payment.payment) return null
  const request = payment.payment

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const tx = await wallet.pay(request)
      setSent(true)
      onReported(await reportPaymentTx(payment.id, tx).catch(() => payment))
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex w-full flex-col gap-2">
      <Button size="xl" onClick={() => void pay()} disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
        {busy ? 'Confirm in Nimiq Pay…' : `${payment.failureReason ? 'Pay again' : 'Pay'} ${formatNim(payment.nimAmount, 5)}`}
      </Button>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </div>
  )
}
