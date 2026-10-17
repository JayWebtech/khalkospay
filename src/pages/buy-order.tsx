import { Circle, CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, TimerOff, Undo2, Wallet, type LucideIcon } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { CopyButton } from '@/components/copy-button'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import type { OnrampOrder } from '@/lib/api'
import { formatFiat, formatNim, formatRate, shortAddress, shortHash } from '@/lib/format'
import { isFinalBuy, useBuyOrder } from '@/lib/onramp'
import { cn } from '@/lib/utils'

interface Hero {
  icon: LucideIcon
  tone: string
  title: string
  body: string
  spin?: boolean
}

/** Keeps "NQ12 … AB34" on one line. */
const unbroken = (text: string) => text.replace(/ /g, '\u00a0')

function heroFor(o: OnrampOrder): Hero {
  const nim = formatNim(o.nimAmount, 5)
  const to = unbroken(shortAddress(o.payoutAddress))
  const pay = formatFiat(o.amount, o.currency)
  switch (o.status) {
    case 'AWAITING_PAYMENT':
      return o.checkoutUrl
        ? {
            icon: Clock,
            tone: 'bg-accent text-accent-foreground',
            title: 'Waiting for your payment',
            body: `Pay ${pay} on the checkout. Your rate is held until ${new Date(o.checkoutExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
          }
        : { icon: LoaderCircle, tone: 'bg-accent text-accent-foreground', title: 'Checking your payment', body: 'This usually takes under a minute.', spin: true }
    case 'PAID':
      return { icon: LoaderCircle, tone: 'bg-accent text-accent-foreground', title: 'Payment received', body: `Sending ${nim} to your wallet now.`, spin: true }
    case 'SENDING':
      return { icon: LoaderCircle, tone: 'bg-accent text-accent-foreground', title: 'Sending your NIM', body: `${nim} is on its way to ${to}.`, spin: true }
    case 'COMPLETED':
      return { icon: CircleCheck, tone: 'bg-success/12 text-success', title: `${nim} is in your wallet`, body: `Sent to ${to} on the Nimiq network.` }
    case 'EXPIRED':
      return {
        icon: TimerOff,
        tone: 'bg-muted text-foreground',
        title: 'Purchase expired',
        body: o.failureReason === 'The payment was cancelled' ? 'You cancelled the payment. Nothing was charged.' : 'No payment arrived in time. Nothing was charged.',
      }
    case 'NEEDS_REVIEW':
      return {
        icon: CircleAlert,
        tone: 'bg-destructive/10 text-destructive',
        title: "We're checking your payment",
        body: `${o.failureReason ?? 'Something about this payment needs a closer look'}. We'll sort it out; keep the reference below.`,
      }
    case 'RESOLVED':
      return {
        icon: Undo2,
        tone: 'bg-muted text-foreground',
        title: 'Payment refunded',
        body: 'We returned your payment outside the app, so no NIM was sent. Keep the reference below.',
      }
  }
}

type StepState = 'done' | 'active' | 'todo' | 'failed'

const STEP_ICON: Record<StepState, { icon: LucideIcon; className: string }> = {
  done: { icon: CircleCheck, className: 'text-success' },
  active: { icon: LoaderCircle, className: 'text-primary motion-safe:animate-spin' },
  todo: { icon: Circle, className: 'text-muted-foreground/50' },
  failed: { icon: CircleX, className: 'text-destructive' },
}

function stepsFor(o: OnrampOrder): { label: string; detail: string; state: StepState }[] {
  const s = o.status
  const paid = ['PAID', 'SENDING', 'COMPLETED'].includes(s)
  return [
    { label: 'Rate locked', detail: `1 NIM = ${formatRate(o.fiatPerNim, o.currency)}`, state: 'done' },
    {
      label: 'Payment',
      detail: paid
        ? `${formatFiat(o.paidAmount ?? o.amount, o.currency)} received`
        : s === 'EXPIRED'
          ? 'No payment arrived'
          : s === 'NEEDS_REVIEW'
            ? o.paidAmount
              ? `${formatFiat(o.paidAmount, o.currency)} received, held for review`
              : 'Held for review'
            : s === 'RESOLVED'
              ? 'Refunded to you'
              : 'Waiting for you to pay',
      state: paid ? 'done' : s === 'AWAITING_PAYMENT' ? 'active' : 'failed',
    },
    {
      label: 'NIM sent',
      detail:
        s === 'COMPLETED'
          ? 'Confirmed on the Nimiq network'
          : s === 'SENDING' || s === 'PAID'
            ? 'Sending from KhalkosPay'
            : s === 'EXPIRED' || s === 'RESOLVED'
              ? 'Nothing to send'
              : s === 'NEEDS_REVIEW'
                ? 'On hold until the review is done'
                : 'Starts once you pay',
      state: s === 'COMPLETED' ? 'done' : s === 'SENDING' || s === 'PAID' ? 'active' : 'todo',
    },
  ]
}

export function BuyOrderPage() {
  const { id } = useParams<{ id: string }>()
  const { order, error } = useBuyOrder(id)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Buy NIM" back="/buy" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {!order && !error && (
          <>
            <Skeleton className="h-40 rounded-3xl" />
            <Skeleton className="h-48 rounded-3xl" />
          </>
        )}
        {!order && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {order && <OrderDetails order={order} />}
      </div>
    </div>
  )
}

function OrderDetails({ order }: { order: OnrampOrder }) {
  const hero = heroFor(order)
  const Icon = hero.icon
  const steps = stepsFor(order)

  return (
    <>
      <section className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center ring-1 ring-foreground/10" aria-live="polite">
        <span className={cn('flex size-14 items-center justify-center rounded-full', hero.tone)}>
          <Icon className={cn('size-7', hero.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{hero.title}</h2>
        <p className="mt-1 max-w-[34ch] text-sm text-muted-foreground">{hero.body}</p>
        {order.status === 'AWAITING_PAYMENT' && order.checkoutUrl && (
          <Button size="xl" className="mt-4 w-full" onClick={() => window.location.assign(order.checkoutUrl!)}>
            <Wallet data-icon="inline-start" />
            Pay {formatFiat(order.amount, order.currency)}
          </Button>
        )}
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="buy-progress">
        <h2 id="buy-progress" className="mb-4 text-sm font-semibold">
          Progress
        </h2>
        <ol className="flex flex-col">
          {steps.map((step, i) => {
            const { icon: StepIcon, className } = STEP_ICON[step.state]
            return (
              <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className={cn('absolute top-6 bottom-0 left-[0.6875rem] w-px', step.state === 'done' ? 'bg-success/40' : 'bg-border')} />
                )}
                <StepIcon className={cn('mt-0.5 size-[1.375rem] shrink-0', className)} aria-hidden="true" />
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', step.state === 'todo' && 'text-muted-foreground')}>{step.label}</p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="buy-receipt">
        <h2 id="buy-receipt" className="mb-3 text-sm font-semibold">
          Receipt
        </h2>
        <dl className="flex flex-col gap-2.5 text-sm">
          <Row label="You pay" value={formatFiat(order.amount, order.currency)} />
          <Row label="You get" value={formatNim(order.nimAmount, 5)} strong />
          <Row label="Fee" value={`${order.feePercent}%`} />
          <Separator className="my-1" />
          <Row label="To" value={shortAddress(order.payoutAddress)} mono />
          <Row label="Reference" value={order.reference} copy={order.reference} mono />
          {order.payoutTxHash && <Row label="Nimiq payment" value={shortHash(order.payoutTxHash)} copy={order.payoutTxHash} mono />}
        </dl>
      </section>

      <div className={cn('grid gap-2', isFinalBuy(order.status) && 'grid-cols-2')}>
        <ButtonLink to="/" size="xl" variant="outline">
          Done
        </ButtonLink>
        {isFinalBuy(order.status) && (
          <ButtonLink to="/buy" size="xl">
            Buy more
          </ButtonLink>
        )}
      </div>
    </>
  )
}

function Row({ label, value, strong, copy, mono }: { label: string; value: string; strong?: boolean; copy?: string; mono?: boolean }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('flex min-w-0 items-center justify-end gap-1 text-right tabular-nums', strong ? 'font-semibold' : 'font-medium')}>
        <span className={cn('truncate', mono && 'font-mono text-[0.8125rem]')}>{value}</span>
        {copy && (
          <span className="-my-3 -mr-3">
            <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} />
          </span>
        )}
      </dd>
    </div>
  )
}
