import { shortAddress } from '@/lib/format'

/** Table cells shared by the admin lists. Full values stay in the title and the expanded row. */

export function Reference({ value }: { value: string }) {
  return (
    <span className="font-mono text-xs whitespace-nowrap" title={value}>
      {value.length > 22 ? `${value.slice(0, 22)}…` : value}
    </span>
  )
}

export function Address({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className="font-mono text-xs whitespace-nowrap" title={value}>
      {shortAddress(value)}
    </span>
  )
}

export function Amount({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap tabular-nums">{children}</span>
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}
