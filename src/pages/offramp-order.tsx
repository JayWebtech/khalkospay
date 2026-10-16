import { CircleAlert, CircleCheck, CircleX, Clock, Landmark, LoaderCircle, TimerOff, Undo2, Wallet, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { CopyButton } from '@/components/copy-button'
import { OrderTimeline, shortBankName, StatusBadge } from '@/components/order-status'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { LedgerLine, Order, OrderStatus } from '@/lib/api'
import { formatNgn, formatNim, shortAddress, shortHash } from '@/lib/format'
import { isTerminal, reportDeposit, useOrder } from '@/lib/offramp'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const HERO: Record<OrderStatus, { icon: LucideIcon; tone: string; title: (o: Order) => string; body: (o: Order) => string }> = {
  AWAITING_DEPOSIT: {
    icon: Clock,
    tone: 'bg-accent text-accent-foreground',
    title: () => 'Waiting for your approval',
    body: () => 'Approve the NIM payment in Nimiq Pay to continue.',
  },
  CONFIRMING: {
    icon: LoaderCircle,
    tone: 'bg-accent text-accent-foreground',
    title: () => 'Confirming your NIM',
    body: () => 'This usually takes under a minute. You can leave this screen.',
  },
  PAYING_OUT: {
    icon: Landmark,
    tone: 'bg-accent text-accent-foreground',
    title: (o) => `Sending ${formatNgn(o.payoutNgn)}`,
    body: (o) => `Your NIM arrived. Paystack is paying ${o.accountName}.`,
  },
  COMPLETED: {
    icon: CircleCheck,
    tone: 'bg-success/12 text-success',
    title: (o) => `${formatNgn(o.payoutNgn)} sent`,
    body: (o) => `Paid to ${o.accountName} at ${shortBankName(o.bankName)}.`,
  },
  PAYOUT_FAILED: {
    icon: CircleAlert,
    tone: 'bg-destructive/10 text-destructive',
    title: () => 'Bank payout failed',
    body: (o) => `${o.failureReason ?? 'The transfer did not go through.'} Your NIM is safe and will be refunded.`,
  },
  REFUNDING: {
    icon: Undo2,
    tone: 'bg-accent text-accent-foreground',
    title: () => 'Refunding your NIM',
    body: (o) => `${o.failureReason ?? 'The bank transfer failed'}. We're sending your NIM back.`,
  },
  REFUNDED: {
    icon: Undo2,
    tone: 'bg-muted text-foreground',
    title: () => 'NIM refunded',
    body: (o) => `${o.failureReason ?? 'The bank transfer failed'}. Your NIM is back in your wallet.`,
  },
  REJECTED: {
    icon: CircleX,
    tone: 'bg-destructive/10 text-destructive',
    title: () => 'Payment not verified',
    body: (o) => o.failureReason ?? "We couldn't match a payment to this cash-out.",
  },
  EXPIRED: {
    icon: TimerOff,
    tone: 'bg-muted text-foreground',
    title: () => 'Quote expired',
    body: () => 'No NIM was taken. Start a new cash-out for a fresh rate.',
  },
}

export function OfframpOrderPage() {
  const { id } = useParams<{ id: string }>()
  const { order, error } = useOrder(id)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Cash-out" back="/" action={order && <StatusBadge status={order.status} />} />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {!order && !error && (
          <>
            <Skeleton className="h-36 rounded-3xl" />
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

function OrderDetails({ order }: { order: Order }) {
  const hero = HERO[order.status]
  const Icon = hero.icon
  const canPay = order.status === 'AWAITING_DEPOSIT' && order.deposit && new Date(order.expiresAt).getTime() > Date.now()

  return (
    <>
      <section className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center ring-1 ring-foreground/10" aria-live="polite">
        <span className={cn('flex size-14 items-center justify-center rounded-full', hero.tone)}>
          <Icon className={cn('size-7', order.status === 'CONFIRMING' && 'motion-safe:animate-spin')} aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{hero.title(order)}</h2>
        <p className="mt-1 max-w-[34ch] text-sm text-muted-foreground">{hero.body(order)}</p>
        {canPay && <PayAgain order={order} />}
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="progress-heading">
        <h2 id="progress-heading" className="mb-4 text-sm font-semibold">
          Progress
        </h2>
        <OrderTimeline order={order} />
      </section>

      <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="receipt-heading">
        <h2 id="receipt-heading" className="mb-3 text-sm font-semibold">
          Receipt
        </h2>
        <dl className="flex flex-col gap-2.5 text-sm">
          <Row label="You send" value={formatNim(order.nimAmount, 5)} />
          <Row label="Rate" value={`1 NIM = ₦${order.rateNgnPerNim.toFixed(4)}`} />
          <Row label="Fees" value={formatNgn(order.feeNgn)} />
          <Row label="You receive" value={formatNgn(order.payoutNgn)} strong />
          <Separator className="my-1" />
          <Row label="To" value={order.accountName} />
          <Row label="Bank" value={`${shortBankName(order.bankName)} ${order.accountNumber}`} />
          <Row label="Reference" value={order.reference} copy={order.reference} mono />
          {order.depositTxHash && <Row label="Nimiq payment" value={shortHash(order.depositTxHash)} copy={order.depositTxHash} mono />}
          {order.refundTxHash && <Row label="Refund" value={shortHash(order.refundTxHash)} copy={order.refundTxHash} mono />}
        </dl>
      </section>

      {order.ledger && order.ledger.length > 0 && (
        <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="movement-heading">
          <h2 id="movement-heading" className="text-sm font-semibold">
            Money movement
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">Every debit and credit for this cash-out.</p>
          <ul className="flex flex-col gap-3">
            {order.ledger.map((line) => (
              <LedgerRow key={line.kind} line={line} />
            ))}
          </ul>
        </section>
      )}

      <div className={cn('grid gap-2', isTerminal(order.status) && 'grid-cols-2')}>
        <ButtonLink to="/" size="xl" variant="default">
          Done
        </ButtonLink>
        {isTerminal(order.status) && (
          <ButtonLink to="/cash-out" size="xl">
            New cash-out
          </ButtonLink>
        )}
      </div>
    </>
  )
}

function PayAgain({ order }: { order: Order }) {
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (wallet.status !== 'connected') return null

  async function pay() {
    if (!order.deposit) return
    setBusy(true)
    setError(null)
    try {
      const tx = await wallet.pay(order.deposit)
      await reportDeposit(order.id, tx).catch(() => { })
    } catch (e) {
      setError(isUserRejection(e) ? 'Payment cancelled. Nothing left your wallet.' : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex w-full flex-col gap-2">
      <Button size="xl" onClick={() => void pay()} disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
        Approve {formatNim(order.nimAmount, 5)}
      </Button>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </div>
  )
}

const LEDGER_COPY: Record<LedgerLine['kind'], { label: string; flow: (line: LedgerLine) => string }> = {
  DEPOSIT: { label: 'NIM debited from your wallet', flow: (l) => `${shortAddress(l.debit.slice(4))} → KhalkosPay` },
  PAYOUT: { label: 'Naira credited to your bank', flow: (l) => `Paystack → ${l.credit}` },
  REFUND: { label: 'NIM refunded to your wallet', flow: (l) => `KhalkosPay → ${shortAddress(l.credit.slice(4))}` },
}

function LedgerRow({ line }: { line: LedgerLine }) {
  const copy = LEDGER_COPY[line.kind]
  const amount = line.asset === 'NIM' ? formatNim(line.amount, 5) : formatNgn(Number(line.amount))
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{copy.label}</p>
        <p className="truncate text-muted-foreground">{copy.flow(line)}</p>
      </div>
      <span className={cn('shrink-0 font-semibold tabular-nums', line.kind === 'PAYOUT' && 'text-success')}>
        {line.kind === 'PAYOUT' ? '+' : ''}
        {amount}
      </span>
    </li>
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
