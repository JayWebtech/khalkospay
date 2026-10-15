import { BrandMark } from '@/components/brand-mark'
import { giftTemplate } from '@/lib/gift-templates'
import { cn } from '@/lib/utils'

export function GiftCardArt({ template, amount, message, from }: { template: string; amount: string; message?: string; from?: string }) {
  const t = giftTemplate(template)
  return (
    <div className={cn('relative isolate flex aspect-[1.6] flex-col justify-between overflow-hidden rounded-3xl p-5 text-white shadow-lg', t.art)}>
      <div aria-hidden="true" className="absolute -top-16 -right-10 -z-10 size-48 rounded-full bg-white/15 blur-2xl" />
      <div className="flex items-start justify-between">
        <span className="text-4xl" aria-hidden="true">
          {t.emoji}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-white/85">
          <BrandMark className="size-5" />
          KhalkosPay
        </span>
      </div>
      <div className="min-w-0">
        {message && <p className="mb-1 line-clamp-2 text-sm text-white/90 italic">“{message}”</p>}
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {amount || '0'} <span className="text-lg font-medium text-white/80">NIM</span>
        </p>
        {from && <p className="truncate text-sm text-white/80">From {from}</p>}
      </div>
    </div>
  )
}
