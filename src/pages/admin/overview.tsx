import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/admin/status-badge'
import { TrendColumns } from '@/components/admin/trend-columns'
import { AdminPageHeader } from '@/components/admin/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { type AdminOverview, type AdminTreasury, useAdminQuery } from '@/lib/admin'
import { formatFiat, formatNgn, formatNim, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function AdminOverviewPage() {
  const { data, error, loading, reload } = useAdminQuery<AdminOverview>('/api/admin/overview')

  return (
    <>
      <AdminPageHeader title="Overview" description="Everything happening in KhalkosPay. Daily trends are in UTC.">
        <div className="flex items-center gap-3">
          {data && <span className="text-xs text-muted-foreground">Updated {timeAgo(data.generatedAt)}</span>}
          <Button variant="outline" onClick={reload} disabled={loading}>
            <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </AdminPageHeader>

      {error && (
        <Alert variant="destructive" className="mb-5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!data ? (
        <OverviewSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          {data.buys.needsReview > 0 && (
            <Alert>
              <CircleAlert aria-hidden="true" />
              <AlertTitle>
                {data.buys.needsReview} Buy NIM {data.buys.needsReview === 1 ? 'purchase is' : 'purchases are'} waiting for review
              </AlertTitle>
              <AlertDescription>
                <Link to="/admin/buys?status=NEEDS_REVIEW" className="font-medium text-foreground underline underline-offset-4">
                  Review and settle them
                </Link>
              </AlertDescription>
            </Alert>
          )}

          <section aria-label="Headline numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Wallets" value={data.wallets.total.toLocaleString()} note={`${data.wallets.new7d.toLocaleString()} new in 7 days`} />
            <TreasuryStat />
            <Stat label="NIM sold" value={formatNim(data.buys.nimSent)} note={plural(data.buys.completed, 'completed buy', 'completed buys')} />
            <Stat label="Paid to banks" value={formatNgn(data.cashouts.ngnPaidOut)} note={`${plural(data.cashouts.completed, 'cash-out', 'cash-outs')} · ${formatNgn(data.cashouts.ngnFees)} fees`} />
            <Stat label="Gifted" value={formatNim(data.gifts.fundedNim)} note={`${data.gifts.funded.toLocaleString()} funded · ${formatNim(data.gifts.claimedNim)} claimed`} />
            <Stat
              label="Pets alive"
              value={`${(data.pets.byStatus.ALIVE ?? 0).toLocaleString()} of ${data.pets.total.toLocaleString()}`}
              note={plural(data.pets.mealsFed, 'meal logged', 'meals logged')}
            />
          </section>

          <section aria-label="Features" className="grid gap-4 lg:grid-cols-2">
            <FeatureCard
              title="Buy NIM"
              href="/admin/buys"
              chartTitle="Purchases started per day"
              noun={['purchase', 'purchases']}
              data={data}
              series="buys"
              week={data.buys}
              statuses={data.buys.byStatus}
              facts={[
                ['NIM sent', formatNim(data.buys.nimSent)],
                ['Orders', data.buys.total.toLocaleString()],
                ...data.buys.paidByCurrency.map((c): [string, string] => [`Paid in ${c.currency}`, `${formatFiat(c.amount, c.currency)} · ${c.orders}`]),
              ]}
            />
            <FeatureCard
              title="Cash-outs"
              href="/admin/cash-outs"
              chartTitle="Cash-outs started per day"
              noun={['cash-out', 'cash-outs']}
              data={data}
              series="cashouts"
              week={data.cashouts}
              statuses={data.cashouts.byStatus}
              facts={[
                ['NIM received', formatNim(data.cashouts.nimReceived)],
                ['Paid out', formatNgn(data.cashouts.ngnPaidOut)],
                ['Fees earned', formatNgn(data.cashouts.ngnFees)],
                ['Started by voice call', data.cashouts.viaVoice.toLocaleString()],
              ]}
            />
            <FeatureCard
              title="Gifts"
              href="/admin/gifts"
              chartTitle="Gifts created per day"
              noun={['gift', 'gifts']}
              data={data}
              series="gifts"
              week={data.gifts}
              statuses={data.gifts.byStatus}
              facts={[
                ['Funded', formatNim(data.gifts.fundedNim)],
                ['Claimed', formatNim(data.gifts.claimedNim)],
                ['In escrow now', formatNim(data.gifts.inEscrowNim)],
                ['Emails sent', data.gifts.emailsSent.toLocaleString()],
              ]}
            />
            <FeatureCard
              title="BiteBuddy"
              href="/admin/bitebuddy"
              chartTitle="Meals logged per day"
              noun={['meal', 'meals']}
              data={data}
              series="meals"
              week={data.pets}
              statuses={{ ...data.pets.byStatus, ...prefixed('Revival', data.pets.revivals) }}
              facts={[
                ['Pets adopted', data.pets.total.toLocaleString()],
                ['Meals fed', data.pets.mealsFed.toLocaleString()],
                ['Meals missed', data.pets.mealsMissed.toLocaleString()],
                ['Revival payments', formatNim(data.pets.revivalNim)],
              ]}
            />
          </section>

          <section aria-label="Books" className="grid gap-4 md:grid-cols-2">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Ledger</CardTitle>
              </CardHeader>
              <CardContent>
                <Facts
                  facts={[
                    ['Entries', data.ledger.total.toLocaleString()],
                    ...Object.entries(data.ledger.byKind).map(([k, n]): [string, string] => [k.charAt(0) + k.slice(1).toLowerCase(), n.toLocaleString()]),
                  ]}
                />
                <Link to="/admin/ledger" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Open the ledger <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>System</CardTitle>
              </CardHeader>
              <CardContent>
                <Facts
                  facts={[
                    ['Network', data.network],
                    ['Treasury address', data.treasuryAddress ?? 'Not configured'],
                    ['Admin accounts', data.admins.toLocaleString()],
                    ['Legacy meal logs', data.legacyMealLogs.toLocaleString()],
                  ]}
                />
              </CardContent>
            </Card>
          </section>
        </div>
      )}
    </>
  )
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function TreasuryStat() {
  const { data, loading } = useAdminQuery<AdminTreasury>('/api/admin/treasury')
  if (!data) return <Stat label="Treasury" value={loading ? '…' : '—'} note={loading ? 'Checking the balance' : 'Unavailable'} />
  return (
    <Stat
      label="Treasury"
      value={data.balanceNim === null ? '—' : formatNim(data.balanceNim)}
      note={data.availableForSaleNim === null ? (data.error ?? 'Unavailable') : `${formatNim(data.availableForSaleNim)} free to sell`}
    />
  )
}

const prefixed = (prefix: string, counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).map(([k, n]) => [`${prefix}:${k}`, n]))

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card size="sm" className="gap-1 px-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-heading text-lg font-semibold tabular-nums" title={value}>
        {value}
      </span>
      <span className="text-xs text-pretty text-muted-foreground">{note}</span>
    </Card>
  )
}

function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="flex flex-col divide-y text-sm">
      {facts.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cn('min-w-0 text-right font-medium break-words tabular-nums', /^NQ\d\d /.test(v) && 'font-mono text-xs')}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Delta({ now, before }: { now: number; before: number }) {
  const diff = now - before
  const Icon = diff >= 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      {diff !== 0 && <Icon className="size-3.5" aria-hidden="true" />}
      {diff === 0 ? 'same as' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString()} vs`} the 7 days before
    </span>
  )
}

function FeatureCard({
  title,
  href,
  chartTitle,
  noun,
  data,
  series,
  week,
  statuses,
  facts,
}: {
  title: string
  href: string
  chartTitle: string
  noun: [string, string]
  data: AdminOverview
  series: keyof AdminOverview['trend']['series']
  week: { last7d: number; prior7d: number }
  statuses: Record<string, number>
  facts: [string, string][]
}) {
  const present = Object.entries(statuses).filter(([, n]) => n > 0)
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-base">{title}</CardTitle>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-semibold tabular-nums">{week.last7d.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">{noun[week.last7d === 1 ? 0 : 1]} in the last 7 days</span>
          </div>
          <Delta now={week.last7d} before={week.prior7d} />
        </div>
        <Link to={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
          View all <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">{chartTitle}, last 30 days</h3>
          <TrendColumns days={data.trend.days} values={data.trend.series[series]} noun={noun} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Facts facts={facts} />
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">By status</h3>
            {present.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {present.map(([status, n]) => {
                  const [group, name] = status.includes(':') ? status.split(':') : [null, status]
                  return (
                    <li key={status} className="flex items-center gap-1 text-xs tabular-nums">
                      {group && <span className="text-muted-foreground">{group}</span>}
                      <StatusBadge status={name} />
                      <span className="font-medium">{n.toLocaleString()}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
