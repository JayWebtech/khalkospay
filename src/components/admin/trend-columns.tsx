import { useState } from 'react'
import { cn } from '@/lib/utils'

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * Daily counts as a column chart: one series, so no legend (the caller's title names it). Hover or focus
 * a day for its value; the axis carries the peak.
 */
export function TrendColumns({ days, values, noun }: { days: string[]; values: number[]; noun: [one: string, many: string] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...values, 0)
  const total = values.reduce((a, b) => a + b, 0)
  const peak = values.indexOf(max)
  const label = (i: number) => `${dayLabel(days[i])}: ${values[i].toLocaleString()} ${values[i] === 1 ? noun[0] : noun[1]}`
  const shift = (i: number) => (i < 4 ? 'translate-x-0' : i > values.length - 5 ? '-translate-x-full' : '-translate-x-1/2')

  return (
    <figure className="flex flex-col gap-1.5">
      <div
        role="img"
        aria-label={`${total.toLocaleString()} ${noun[1]} in the last ${days.length} days (UTC)${max ? `, most on ${dayLabel(days[peak])} with ${max}` : ''}`}
        className="relative h-20"
        onMouseLeave={() => setActive(null)}
      >
        <div className="absolute inset-x-0 top-0 border-t border-border" aria-hidden="true" />
        <span className="absolute -top-2 left-0 bg-card pr-1 text-[0.6875rem] leading-none text-muted-foreground tabular-nums" aria-hidden="true">
          {max}
        </span>
        {total === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground" aria-hidden="true">
            Nothing in the last {days.length} days
          </span>
        )}
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-border" aria-hidden="true">
          {values.map((v, i) => (
            <div key={days[i]} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setActive(i)}>
              {v > 0 && (
                <div
                  className={cn('w-full max-w-6 rounded-t-[3px] bg-primary transition-opacity', active !== null && active !== i && 'opacity-45')}
                  style={{ height: `max(${(v / max) * 100}%, 2px)` }}
                />
              )}
            </div>
          ))}
        </div>
        {active !== null && (
          <div
            className={cn(
              'pointer-events-none absolute -top-8 z-10 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-sm',
              shift(active),
            )}
            style={{ left: `${((active + 0.5) / values.length) * 100}%` }}
          >
            {label(active)}
          </div>
        )}
      </div>
      <figcaption className="flex justify-between text-[0.6875rem] text-muted-foreground" aria-hidden="true">
        <span>{dayLabel(days[0])}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  )
}
