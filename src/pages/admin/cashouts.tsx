import { ActivityList } from '@/components/admin/activity-list'
import { Address, Amount, Muted, Reference } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { StatusBadge } from '@/components/admin/status-badge'
import { AdminPageHeader } from '@/components/admin/page-header'
import type { AdminLedgerLine } from '@/lib/admin'
import { formatNgn, formatNim } from '@/lib/format'

const STATUSES = ['AWAITING_DEPOSIT', 'CONFIRMING', 'PAYING_OUT', 'COMPLETED', 'PAYOUT_FAILED', 'REFUNDING', 'REFUNDED', 'REJECTED', 'EXPIRED'] as const

export interface AdminCashout {
  id: string
  reference: string
  source: string
  status: string
  userAddress: string
  nimAmount: string
  receivedNim: string | null
  rateNgnPerNim: number
  grossNgn: number
  feeNgn: number
  payoutNgn: number
  bankName: string
  accountName: string
  accountNumber: string
  depositTxHash: string | null
  paystackTransferCode: string | null
  failureReason: string | null
  createdAt: string
  ledger: AdminLedgerLine[]
}

export function AdminCashoutsPage() {
  return (
    <>
      <AdminPageHeader title="Cash-outs" description="NIM sold for naira, paid to Nigerian bank accounts through Paystack. Includes cash-outs started on a voice call." />
      <ActivityList<AdminCashout>
        endpoint="/api/admin/cashouts"
        statuses={STATUSES}
        noun={['cash-out', 'cash-outs']}
        searchPlaceholder="Search reference, wallet, account or transfer code"
        columns={[
          { header: 'Created', cell: (o) => <Time iso={o.createdAt} /> },
          { header: 'Reference', cell: (o) => <Reference value={o.reference} /> },
          { header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
          { header: 'NIM', cell: (o) => <Amount>{formatNim(o.receivedNim ?? o.nimAmount)}</Amount> },
          { header: 'Payout', cell: (o) => <Amount>{formatNgn(o.payoutNgn)}</Amount> },
          {
            header: 'Bank account',
            cell: (o) => (
              <span className="whitespace-nowrap">
                {o.accountName} <Muted>· {o.bankName}</Muted>
              </span>
            ),
          },
          { header: 'Via', cell: (o) => (o.source === 'voice' ? 'Voice call' : 'App') },
          { header: 'Wallet', cell: (o) => <Address value={o.userAddress} /> },
        ]}
      />
    </>
  )
}
