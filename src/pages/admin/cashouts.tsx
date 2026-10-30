import { Link } from 'react-router-dom'
import { ActivityList, type Column } from '@/components/admin/activity-list'
import { Address, Amount, Muted, Reference } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { StatusBadge } from '@/components/admin/status-badge'
import { AdminPageHeader } from '@/components/admin/page-header'
import type { AdminLedgerLine } from '@/lib/admin'
import { formatNgn, formatNim } from '@/lib/format'

export const CASHOUT_STATUSES = ['AWAITING_DEPOSIT', 'CONFIRMING', 'PAYING_OUT', 'COMPLETED', 'PAYOUT_FAILED', 'REFUNDING', 'REFUNDED', 'REJECTED', 'EXPIRED'] as const

export interface AdminCashout {
  id: string
  reference: string
  source: string
  /** False for partner sandbox (test key) orders, which only show on their partner's page. */
  livemode: boolean
  partner: { id: string; name: string } | null
  partnerReference: string | null
  status: string
  userAddress: string | null
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

const VIA: Record<string, string> = { voice: 'Voice call', app: 'App', api: 'API' }

export const cashoutColumns: Column<AdminCashout>[] = [
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
]

export function AdminCashoutsPage() {
  return (
    <>
      <AdminPageHeader
        title="Cash-outs"
        description="NIM sold for naira, paid to Nigerian bank accounts through Paystack. Includes cash-outs from voice calls and partners’ live API keys; sandbox ones are on each partner’s page."
      />
      <ActivityList<AdminCashout>
        endpoint="/api/admin/cashouts"
        statuses={CASHOUT_STATUSES}
        noun={['cash-out', 'cash-outs']}
        searchPlaceholder="Search reference, wallet, account or transfer code"
        columns={[
          ...cashoutColumns,
          {
            header: 'Via',
            cell: (o) =>
              o.partner ? (
                <Link to={`/admin/partners/${o.partner.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap underline-offset-4 hover:underline">
                  {o.partner.name}
                </Link>
              ) : (
                (VIA[o.source] ?? o.source)
              ),
          },
          { header: 'Wallet', cell: (o) => <Address value={o.userAddress} /> },
        ]}
      />
    </>
  )
}
