import type { AdminLedgerLine } from '@/lib/admin'
import { cn } from '@/lib/utils'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const UPPER = new Set(['nim', 'ngn', 'id', 'url', 'xp', 'tx'])

/** nimAmount → "NIM amount". */
export function fieldLabel(key: string) {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
  const label = words.map((w) => (UPPER.has(w) ? w.toUpperCase() : w)).join(' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && ISO_DATE.test(value)) return new Date(value).toLocaleString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function Time({ iso, className }: { iso: string | null; className?: string }) {
  if (!iso) return <span className="text-muted-foreground">—</span>
  const d = new Date(iso)
  return (
    <time dateTime={iso} title={d.toLocaleString()} className={cn('whitespace-nowrap tabular-nums', className)}>
      {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
      <span className="text-muted-foreground">{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
    </time>
  )
}

/** Every field of a record, for the expanded row. Ledger arrays render as their own small table. */
export function DetailList({ data, omit = [] }: { data: object; omit?: string[] }) {
  const entries = Object.entries(data).filter(([k]) => !omit.includes(k))
  const ledger = entries.find(([k]) => k === 'ledger')?.[1] as AdminLedgerLine[] | undefined
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {entries
          .filter(([k]) => k !== 'ledger')
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{fieldLabel(k)}</dt>
              <dd className="font-mono text-xs break-all">{formatValue(v)}</dd>
            </div>
          ))}
      </dl>
      {ledger && <LedgerLines lines={ledger} />}
    </div>
  )
}

export function LedgerLines({ lines }: { lines: AdminLedgerLine[] }) {
  if (lines.length === 0) return <p className="text-xs text-muted-foreground">No ledger entries yet.</p>
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">Ledger</h4>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              {['Kind', 'Amount', 'Debit', 'Credit', 'External ref', 'Booked'].map((h) => (
                <th key={h} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id ?? i} className="border-t">
                <td className="px-2.5 py-1.5">{l.kind}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums">
                  {l.displayAmount ?? l.amount} {l.asset}
                </td>
                <td className="px-2.5 py-1.5 font-mono break-all">{l.debit}</td>
                <td className="px-2.5 py-1.5 font-mono break-all">{l.credit}</td>
                <td className="px-2.5 py-1.5 font-mono break-all">{l.externalRef}</td>
                <td className="px-2.5 py-1.5">
                  <Time iso={l.createdAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
