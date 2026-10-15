import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/** Breathes with whoever is talking; driven per frame through a CSS variable so React never re-renders. */
export function VoiceOrb({ levels, active, thinking }: { levels: () => { mic: number; agent: number }; active: boolean; thinking: boolean }) {
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
    <div ref={ref} aria-hidden="true" className="relative flex size-60 items-center justify-center [--level:0]">
      <div className="absolute inset-0 rounded-full bg-hero-accent/10 [scale:calc(0.85+var(--level)*0.45)]" />
      <div className="absolute inset-7 rounded-full bg-hero-accent/15 [scale:calc(0.9+var(--level)*0.3)]" />
      <div
        className={cn(
          'relative size-36 rounded-full bg-[radial-gradient(circle_at_32%_28%,var(--color-hero-accent),var(--color-primary)_55%,oklch(0.3_0.06_45))] shadow-[0_24px_60px_-20px_var(--color-hero-accent)] [scale:calc(1+var(--level)*0.12)]',
          thinking && 'motion-safe:animate-pulse',
        )}
      />
    </div>
  )
}
