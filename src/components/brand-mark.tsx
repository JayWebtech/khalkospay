import { BRAND_MARK } from '@/lib/brand'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <path className="fill-primary" d={BRAND_MARK.hexagon} />
      <path className="fill-primary-foreground" d={BRAND_MARK.letter} />
    </svg>
  )
}
