import { BrandMark } from '@/components/brand-mark'
import { giftTemplate } from '@/lib/gift-templates'

// Card text sits on photographic artwork, so a soft scrim and text shadow keep it readable on light and busy designs.
const legible = '[text-shadow:0_1px_10px_rgb(0_0_0/0.45)]'

export function GiftCardArt({ template, amount, message, from }: { template: string; amount: string; message?: string; from?: string }) {
  const t = giftTemplate(template)
  return (
    <div className="relative isolate flex aspect-[1.6] flex-col justify-between overflow-hidden rounded-3xl bg-neutral-900 p-5 text-white shadow-lg">
      <img src={t.image} alt="" decoding="async" className="absolute inset-0 -z-20 size-full object-cover" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-black/40 via-black/5 to-black/60" />
      <div className="flex items-start justify-between">
        {t.emoji ? (
          <span className="text-4xl drop-shadow-md" aria-hidden="true">
            {t.emoji}
          </span>
        ) : (
          <span />
        )}
        <span className={`flex items-center gap-1.5 text-sm font-medium text-white/90 ${legible}`}>
          <BrandMark className="size-5" />
          KhalkosPay
        </span>
      </div>
      <div className={`min-w-0 ${legible}`}>
        {message && <p className="mb-1 line-clamp-2 text-sm text-white/95 italic">“{message}”</p>}
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {amount || '0'} <span className="text-lg font-medium text-white/85">NIM</span>
        </p>
        {from && <p className="truncate text-sm text-white/85">From {from}</p>}
      </div>
    </div>
  )
}
