import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/** Breathes with whoever is talking; driven per frame through a CSS variable so React never re-renders. */
export function VoiceOrb({
  levels,
  active,
  thinking,
  compact = false,
}: {
  levels: () => { mic: number; agent: number }
  active: boolean
  thinking: boolean
  compact?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el?.style.setProperty('--level', '0')
      return
    }
    let frame = 0
    let smooth = 0
    const tick = () => {
      const { mic, agent } = levels()
      smooth += (Math.max(mic, agent) - smooth) * 0.2
      el.style.setProperty('--level', smooth.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, levels])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn('relative flex items-center justify-center motion-safe:transition-[width,height] motion-safe:duration-300 motion-safe:ease-out [--level:0]', compact ? 'size-32' : 'size-60')}
    >
      <div className="absolute inset-0 rounded-full bg-hero-accent/10 [scale:calc(0.85+var(--level)*0.45)]" />
      <div className="absolute inset-[12%] rounded-full bg-hero-accent/15 [scale:calc(0.9+var(--level)*0.3)]" />
      <div
        className={cn(
          'relative size-[60%] rounded-full bg-[radial-gradient(circle_at_32%_28%,var(--color-hero-accent),var(--color-primary)_55%,oklch(0.3_0.06_45))] shadow-[0_24px_60px_-20px_var(--color-hero-accent)] [scale:calc(1+var(--level)*0.12)]',
          thinking && 'motion-safe:animate-pulse',
        )}
      />
    </div>
  )
}
