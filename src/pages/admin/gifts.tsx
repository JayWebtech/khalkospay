import { ActivityList } from '@/components/admin/activity-list'
import { Address, Amount, Muted, Reference } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { StatusBadge } from '@/components/admin/status-badge'
import { AdminPageHeader } from '@/components/admin/page-header'
import { formatNim } from '@/lib/format'

const STATUSES = ['AWAITING_FUNDING', 'ACTIVE', 'CLAIMING', 'CLAIMED', 'EXPIRED', 'REFUNDING', 'REFUNDED'] as const

export interface AdminGift {
  id: string
  reference: string
  shareCode: string | null
  status: string
  amountNim: string
  receivedNim: string | null
  senderAddress: string
  senderName: string | null
  anonymous: boolean
  recipientEmail: string | null
  emailSentAt: string | null
  claimerAddress: string | null
  reclaimedAt: string | null
  createdAt: string
}

const shareCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

export function AdminGiftsPage() {
  return (
    <>
      <AdminPageHeader title="Gifts" description="NIM gift cards held in escrow until the recipient claims them or the sender takes them back." />
      <ActivityList<AdminGift>
        endpoint="/api/admin/gifts"
        statuses={STATUSES}
        noun={['gift', 'gifts']}
        searchPlaceholder="Search reference, code, sender, email or claimer"
        columns={[
          { header: 'Created', cell: (g) => <Time iso={g.createdAt} /> },
          {
            header: 'Gift',
            cell: (g) => (g.shareCode ? <span className="font-mono text-xs">{shareCode(g.shareCode)}</span> : <Reference value={g.reference} />),
          },
          {
            header: 'Status',
            cell: (g) => (
              <span className="flex flex-col items-start gap-0.5">
                <StatusBadge status={g.status} />
                {g.reclaimedAt && <Muted>Taken back by sender</Muted>}
              </span>
            ),
          },
          { header: 'Amount', cell: (g) => <Amount>{formatNim(g.receivedNim ?? g.amountNim)}</Amount> },
          {
            header: 'From',
            cell: (g) => (
              <span className="flex flex-col">
                <span className="whitespace-nowrap">{g.senderName ?? <Muted>{g.anonymous ? 'Anonymous' : 'No name'}</Muted>}</span>
                <Address value={g.senderAddress} />
              </span>
            ),
          },
          {
            header: 'Recipient email',
            cell: (g) =>
              g.recipientEmail ? (
                <span className="whitespace-nowrap">
                  {g.recipientEmail} <Muted>· {g.emailSentAt ? 'sent' : 'not sent'}</Muted>
                </span>
              ) : (
                <Muted>—</Muted>
              ),
          },
          { header: 'Claimed by', cell: (g) => <Address value={g.claimerAddress} /> },
        ]}
      />
    </>
  )
}
