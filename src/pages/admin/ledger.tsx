import { ActivityList } from '@/components/admin/activity-list'
import { Amount, Muted, Reference } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { AdminPageHeader } from '@/components/admin/page-header'
import type { AdminLedgerLine } from '@/lib/admin'

const SOURCE_LABEL = { CASHOUT: 'Cash-out', GIFT: 'Gift', REVIVAL: 'Pet revival', BUY: 'Buy NIM' } as const

export function AdminLedgerPage() {
  return (
    <>
      <AdminPageHeader
        title="Ledger"
        description="Every booked money movement: deposits in, payouts out and refunds, across all features. Amounts are in each asset’s own unit."
      />
      <ActivityList<AdminLedgerLine & { id: string }>
        endpoint="/api/admin/ledger"
        statuses={['DEPOSIT', 'PAYOUT', 'REFUND']}
        allLabel="All kinds"
        noun={['entry', 'entries']}
        searchPlaceholder="Search external ref, account or asset"
        columns={[
          { header: 'Booked', cell: (l) => <Time iso={l.createdAt} /> },
          { header: 'Kind', cell: (l) => l.kind.charAt(0) + l.kind.slice(1).toLowerCase() },
          {
            header: 'For',
            cell: (l) =>
              l.source ? (
                <span className="flex flex-col">
                  <span className="whitespace-nowrap">{SOURCE_LABEL[l.source.type]}</span>
                  {l.source.reference && <Reference value={l.source.reference} />}
                </span>
              ) : (
                <Muted>—</Muted>
              ),
          },
          {
            header: 'Amount',
            className: 'text-right',
            cell: (l) => (
              <Amount>
                {l.displayAmount ?? l.amount} <Muted>{l.asset}</Muted>
              </Amount>
            ),
          },
          { header: 'Debit → credit', cell: (l) => <span className="font-mono text-xs break-all">{l.debit} → {l.credit}</span> },
          { header: 'External ref', cell: (l) => <Reference value={l.externalRef} /> },
        ]}
      />
    </>
  )
}
