import { Badge } from '@/components/ui/badge'

type Tone = 'success' | 'pending' | 'destructive' | 'secondary' | 'outline'

const TONE: Record<string, Tone> = {
  COMPLETED: 'success',
  CLAIMED: 'success',
  PAID: 'success',
  ALIVE: 'success',
  ACTIVE: 'pending',
  AWAITING_DEPOSIT: 'outline',
  AWAITING_FUNDING: 'outline',
  AWAITING_PAYMENT: 'outline',
  CONFIRMING: 'pending',
  PAYING_OUT: 'pending',
  SENDING: 'pending',
  CLAIMING: 'pending',
  REFUNDING: 'pending',
  NEEDS_REVIEW: 'destructive',
  PAYOUT_FAILED: 'destructive',
  REJECTED: 'destructive',
  DEAD: 'destructive',
  REFUNDED: 'secondary',
  RESOLVED: 'secondary',
  EXPIRED: 'secondary',
}

/** AWAITING_PAYMENT → "Awaiting payment". */
export function humanize(value: string) {
  const words = value.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={TONE[status] ?? 'secondary'}>{humanize(status)}</Badge>
}
