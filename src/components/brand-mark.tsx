import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-7 shrink-0', className)}>
      <path
        className="fill-primary"
        d="M10.2 3.5h11.6a3 3 0 0 1 2.6 1.5l5.8 10a3 3 0 0 1 0 3l-5.8 10a3 3 0 0 1-2.6 1.5H10.2a3 3 0 0 1-2.6-1.5l-5.8-10a3 3 0 0 1 0-3l5.8-10a3 3 0 0 1 2.6-1.5z"
      />
      <path className="fill-primary-foreground" d="M12 10h2.6v5.1L19.3 10h3.2l-5.2 5.6 5.5 6.4h-3.3l-4.1-4.9-.8.8V22H12z" />
    </svg>
  )
}
