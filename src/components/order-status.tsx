import { Circle, CircleAlert, CircleCheck, CircleX, Clock, Landmark, LoaderCircle, TimerOff, Undo2, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Order, OrderStatus } from '@/lib/api'
import { formatNgn, formatNim } from '@/lib/format'
import { cn } from '@/lib/utils'

type Tone = 'pending' | 'success' | 'destructive' | 'secondary'

export const STATUS_META: Record<OrderStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  AWAITING_DEPOSIT: { label: 'Awaiting approval', tone: 'pending', icon: Clock },
  CONFIRMING: { label: 'Confirming', tone: 'pending', icon: LoaderCircle },
  PAYING_OUT: { label: 'Sending to bank', tone: 'pending', icon: Landmark },
  COMPLETED: { label: 'Paid', tone: 'success', icon: CircleCheck },
  PAYOUT_FAILED: { label: 'Payout failed', tone: 'destructive', icon: CircleAlert },
  REFUNDING: { label: 'Refunding', tone: 'pending', icon: Undo2 },
  REFUNDED: { label: 'Refunded', tone: 'secondary', icon: Undo2 },
  REJECTED: { label: 'Not verified', tone: 'destructive', icon: CircleX },
  EXPIRED: { label: 'Expired', tone: 'secondary', icon: TimerOff },
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <Badge variant={meta.tone}>
      <Icon data-icon="inline-start" className={cn(status === 'CONFIRMING' && 'motion-safe:animate-spin')} />
      {meta.label}
    </Badge>
  )
}

export function shortBankName(name: string) {
  const inParens = name.match(/\(([^)]+)\)\s*$/)
  if (inParens) return inParens[1]
  return name.replace(/\s+(of Nigeria|Nigeria|Plc|Limited|Ltd)$/i, '')
}

type StepState = 'done' | 'active' | 'todo' | 'failed'

interface Step {
  label: string
  detail: string
  state: StepState
}

function stepsFor(order: Order): Step[] {
  const s = order.status
  const received = ['PAYING_OUT', 'COMPLETED', 'PAYOUT_FAILED', 'REFUNDING', 'REFUNDED'].includes(s)
  const steps: Step[] = [
    { label: 'Rate locked', detail: `1 NIM = ₦${order.rateNgnPerNim.toFixed(4)}`, state: 'done' },
    {
      label: 'NIM received',
      detail:
        s === 'AWAITING_DEPOSIT'
          ? 'Approve the payment in Nimiq Pay'
          : s === 'CONFIRMING'
            ? 'Confirming on the Nimiq network'
            : received
              ? `${formatNim(order.receivedNim ?? order.nimAmount, 5)} from your wallet`
              : (order.failureReason ?? 'Your quote expired before payment'),
      state: s === 'AWAITING_DEPOSIT' || s === 'CONFIRMING' ? 'active' : received ? 'done' : 'failed',
    },
  ]
  if (s === 'REJECTED' || s === 'EXPIRED') return steps

  if (s === 'PAYOUT_FAILED' || s === 'REFUNDING' || s === 'REFUNDED') {
    steps.push({
      label: 'Bank transfer',
      detail: order.payoutStarted ? (order.failureReason ?? 'The transfer did not go through') : 'Cancelled, so no naira was sent',
      state: 'failed',
    })
    steps.push({
      label: 'NIM refunded',
      detail:
        s === 'REFUNDED'
          ? 'Your NIM is back in your wallet'
          : s === 'REFUNDING'
            ? 'Sending your NIM back to your wallet'
            : 'Your refund is queued for review',
      state: s === 'REFUNDED' ? 'done' : 'active',
    })
    return steps
  }

  steps.push({
    label: 'Bank transfer',
    detail: s === 'PAYING_OUT' ? `Khalkos is paying ${shortBankName(order.bankName)}` : s === 'COMPLETED' ? 'Sent by Khalkos' : 'Starts once your NIM arrives',
    state: s === 'PAYING_OUT' ? 'active' : s === 'COMPLETED' ? 'done' : 'todo',
  })
  steps.push({
    label: `${formatNgn(order.payoutNgn)} in your account`,
    detail: `${order.accountName} · ${shortBankName(order.bankName)} ${order.accountNumber}`,
    state: s === 'COMPLETED' ? 'done' : 'todo',
  })
  return steps
}

const STEP_ICON: Record<StepState, { icon: LucideIcon; className: string }> = {
  done: { icon: CircleCheck, className: 'text-success' },
  active: { icon: LoaderCircle, className: 'text-primary motion-safe:animate-spin' },
  todo: { icon: Circle, className: 'text-muted-foreground/50' },
  failed: { icon: CircleX, className: 'text-destructive' },
}

export function OrderTimeline({ order }: { order: Order }) {
  const steps = stepsFor(order)
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const { icon: Icon, className } = STEP_ICON[step.state]
        return (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn('absolute top-6 bottom-0 left-[0.6875rem] w-px', step.state === 'done' ? 'bg-success/40' : 'bg-border')}
              />
            )}
            <Icon className={cn('mt-0.5 size-[1.375rem] shrink-0', className)} aria-hidden="true" />
            <div className="min-w-0">
              <p className={cn('text-sm font-medium', step.state === 'todo' && 'text-muted-foreground')}>
                {step.label}
                <span className="sr-only">{` (${step.state === 'todo' ? 'not started' : step.state === 'active' ? 'in progress' : step.state})`}</span>
              </p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
