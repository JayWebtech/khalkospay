import { Store } from 'lucide-react'
import { cn } from '@/lib/utils'

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase()
}

/** A shop's logo, or its initials on copper when it has none. */
export function MerchantAvatar({ name, logo, className }: { name: string | null; logo: string | null; className?: string }) {
  return (
    <span className={cn('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-accent-foreground ring-1 ring-foreground/10', className)}>
      {logo ? (
        <img src={logo} alt="" className="size-full bg-white object-cover" />
      ) : name ? (
        <span aria-hidden="true">{initials(name)}</span>
      ) : (
        <Store className="size-1/2" aria-hidden="true" />
      )}
    </span>
  )
}
