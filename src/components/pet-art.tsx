import type { ReactNode } from 'react'
import type { PetMood } from '@/lib/api'
import { cn } from '@/lib/utils'

// Pet artwork is decorative content, so each buddy carries its own palette rather than UI tokens.

interface Art {
  /** Centre of the face, in the 160×160 viewBox. */
  face: { x: number; y: number }
  /** Highest point of the body; the halo and sleep Zs sit above it. */
  top: number
  body: ReactNode
}

const ART: Record<string, Art> = {
  sunny: {
    face: { x: 80, y: 98 },
    top: 46,
    body: (
      <>
        <path d="M22 122C14 102 34 86 54 90C60 74 98 70 110 86C130 82 148 98 140 118C136 138 110 144 80 142C50 144 26 140 22 122Z" fill="#FFF7E8" />
        <path d="M30 126C46 136 116 138 132 124" stroke="#EBDDC2" strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse cx="44" cy="104" rx="9" ry="13" fill="#FFB020" transform="rotate(-20 44 104)" />
        <ellipse cx="116" cy="104" rx="9" ry="13" fill="#FFB020" transform="rotate(20 116 104)" />
        <circle cx="80" cy="98" r="38" fill="#FFC83D" />
        <ellipse cx="64" cy="80" rx="12" ry="7" fill="#FFE38F" transform="rotate(-30 64 80)" />
        <path d="M72 62C69 50 78 45 80 56C82 44 93 47 88 61" stroke="#FF9F1C" strokeWidth="5" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  mochi: {
    face: { x: 80, y: 106 },
    top: 14,
    body: (
      <>
        <g transform="rotate(-14 62 56)">
          <ellipse cx="62" cy="42" rx="11" ry="30" fill="#FFF1F5" />
          <ellipse cx="62" cy="45" rx="5.5" ry="21" fill="#FFC2D2" />
        </g>
        <g transform="rotate(14 98 56)">
          <ellipse cx="98" cy="42" rx="11" ry="30" fill="#FFF1F5" />
          <ellipse cx="98" cy="45" rx="5.5" ry="21" fill="#FFC2D2" />
        </g>
        <path d="M30 112C30 82 52 66 80 66C108 66 130 82 130 112C130 134 110 142 80 142C50 142 30 134 30 112Z" fill="#FFF1F5" />
        <path d="M31 118C44 146 116 146 129 118C122 140 38 140 31 118Z" fill="#8CC152" />
        <path d="M42 130C62 137 98 137 118 130" stroke="#6E9F36" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="58" cy="86" rx="12" ry="7" fill="#FFFFFF" opacity="0.75" transform="rotate(-25 58 86)" />
        <g transform="translate(106 76)">
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 5} cy={Math.sin((a * Math.PI) / 180) * 5} r="4" fill="#FF8FAB" />
          ))}
          <circle r="2.6" fill="#FFD84D" />
        </g>
      </>
    ),
  },
  jalapup: {
    face: { x: 80, y: 96 },
    top: 30,
    body: (
      <>
        <path d="M52 70C30 70 25 102 38 109C47 113 52 96 57 80Z" fill="#2E8C3C" />
        <path d="M108 70C130 70 135 102 122 109C113 113 108 96 103 80Z" fill="#2E8C3C" />
        <path d="M80 52C112 52 122 80 118 106C114 130 98 142 80 142C62 142 46 130 42 106C38 80 48 52 80 52Z" fill="#43A94F" />
        <ellipse cx="60" cy="82" rx="7" ry="16" fill="#86D985" opacity="0.6" transform="rotate(20 60 82)" />
        <path d="M62 57C68 46 92 46 98 57C90 61 70 61 62 57Z" fill="#2B6A2D" />
        <path d="M80 51C80 39 88 31 98 33" stroke="#2B6A2D" strokeWidth="6" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  peasley: {
    face: { x: 80, y: 106 },
    top: 34,
    body: (
      <>
        <path d="M80 74V48" stroke="#4E9F3D" strokeWidth="4" strokeLinecap="round" />
        <path d="M80 52C66 37 51 43 54 51C60 57 74 55 80 52Z" fill="#6CC04A" />
        <path d="M80 48C92 32 109 36 106 46C100 53 86 51 80 48Z" fill="#7ED957" />
        <path d="M20 106C34 70 126 70 140 106C126 140 34 140 20 106Z" fill="#8BC34A" />
        <path d="M30 118C46 130 114 130 130 118" stroke="#6E9F2F" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
        <circle cx="46" cy="92" r="6" fill="#A8DB6C" />
        <circle cx="114" cy="92" r="6" fill="#A8DB6C" />
        <path d="M21 105C14 103 10 97 12 91" stroke="#6E9F2F" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M139 105C146 103 150 97 148 91" stroke="#6E9F2F" strokeWidth="3" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  puddin: {
    face: { x: 80, y: 112 },
    top: 44,
    body: (
      <>
        <ellipse cx="80" cy="138" rx="58" ry="9" fill="#EDE6DC" />
        <path d="M42 134L50 80C52 66 108 66 110 80L118 134C100 140 60 140 42 134Z" fill="#FFD36E" />
        <path d="M53 126L57 100" stroke="#FFE9AE" strokeWidth="6" strokeLinecap="round" />
        <path
          d="M50 80C52 64 108 64 110 80V86C106 92 102 86 100 92C98 100 92 100 90 90C86 86 82 94 76 92C70 98 64 100 62 90C58 86 54 92 50 88Z"
          fill="#B5651D"
        />
        <path d="M80 62C80 54 84 48 92 44" stroke="#5D8A3A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="80" cy="62" r="8" fill="#E5383B" />
        <circle cx="77" cy="59" r="2.5" fill="#FFFFFF" opacity="0.7" />
      </>
    ),
  },
  takko: {
    face: { x: 80, y: 106 },
    top: 52,
    body: (
      <>
        {['M50 126C42 138 48 146 56 140', 'M68 132C64 146 72 150 76 142', 'M92 132C96 146 88 150 84 142', 'M110 126C118 138 112 146 104 140'].map((d) => (
          <path key={d} d={d} stroke="#F28482" strokeWidth="9" fill="none" strokeLinecap="round" />
        ))}
        <circle cx="80" cy="96" r="42" fill="#D9A066" />
        <path d="M44 110C54 136 106 136 116 110C110 128 50 128 44 110Z" fill="#B97E45" opacity="0.6" />
        <path d="M44 86C46 62 114 62 116 86C110 90 106 82 100 90C94 96 88 86 80 90C72 96 66 86 60 92C54 96 48 86 44 90Z" fill="#5A2D0C" />
        <path d="M52 76L60 67L68 77L76 65L84 77L92 65L100 77L108 69" stroke="#FFF5E1" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {[
          [58, 84],
          [70, 72],
          [90, 82],
          [104, 76],
          [82, 68],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" fill="#5E9C36" />
        ))}
      </>
    ),
  },
}

const INK = '#2B1B17'
const MOUTH = '#5B2333'
const WATER = '#8FD3FF'

const MOTION: Record<PetMood, string> = {
  thriving: 'motion-safe:animate-pet-bounce',
  happy: 'motion-safe:animate-pet-bob',
  hungry: 'motion-safe:animate-pet-wobble',
  weak: 'motion-safe:animate-pet-sway',
  sleeping: 'motion-safe:animate-pet-breathe',
  dead: 'motion-safe:animate-pet-ghost',
}

const own = '[transform-box:fill-box] origin-center'

function Eyes({ x, y, mood }: { x: number; y: number; mood: PetMood }) {
  const eyes = [x - 15, x + 15]
  const ey = y - 3
  if (mood === 'dead') {
    return (
      <g stroke={INK} strokeWidth="2.8" strokeLinecap="round">
        {eyes.map((ex) => (
          <path key={ex} d={`M${ex - 5} ${ey - 5}L${ex + 5} ${ey + 5}M${ex + 5} ${ey - 5}L${ex - 5} ${ey + 5}`} />
        ))}
      </g>
    )
  }
  if (mood === 'sleeping') {
    return (
      <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none">
        {eyes.map((ex) => (
          <path key={ex} d={`M${ex - 6} ${ey}Q${ex} ${ey + 5} ${ex + 6} ${ey}`} />
        ))}
      </g>
    )
  }
  if (mood === 'weak') {
    return (
      <g>
        {eyes.map((ex) => (
          <g key={ex}>
            <path d={`M${ex - 6} ${ey}A6 6 0 0 0 ${ex + 6} ${ey}Z`} fill={INK} />
            <path d={`M${ex - 7} ${ey - 1.5}L${ex + 7} ${ey + 0.5}`} stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          </g>
        ))}
      </g>
    )
  }
  const r = mood === 'thriving' ? 6.5 : 5.5
  const lookUp = mood === 'hungry' ? -1.5 : 0
  return (
    <g className={cn(own, 'motion-safe:animate-pet-blink')}>
      {eyes.map((ex) => (
        <g key={ex}>
          <circle cx={ex} cy={ey} r={r} fill={INK} />
          <circle cx={ex - 1.8} cy={ey - 2 + lookUp} r={r * 0.36} fill="#FFFFFF" />
          {mood === 'thriving' && <circle cx={ex + 2} cy={ey + 2} r="1.2" fill="#FFFFFF" />}
        </g>
      ))}
    </g>
  )
}

function Mouth({ x, y, mood }: { x: number; y: number; mood: PetMood }) {
  const line = { stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  switch (mood) {
    case 'thriving':
      return (
        <g>
          <path d={`M${x - 9} ${y + 6}Q${x} ${y + 20} ${x + 9} ${y + 6}Z`} fill={MOUTH} />
          <ellipse cx={x} cy={y + 12.5} rx="4" ry="2.4" fill="#FF8FA3" />
        </g>
      )
    case 'happy':
      return <path d={`M${x - 7} ${y + 7}Q${x - 3.5} ${y + 11.5} ${x} ${y + 7}Q${x + 3.5} ${y + 11.5} ${x + 7} ${y + 7}`} {...line} />
    case 'hungry':
      return <ellipse cx={x} cy={y + 9} rx="3.6" ry="4.6" fill={MOUTH} />
    case 'weak':
      return <path d={`M${x - 8} ${y + 10}q4 -3.5 8 0q4 3.5 8 0`} {...line} />
    case 'sleeping':
      return <ellipse cx={x} cy={y + 9} rx="2.4" ry="2.8" fill={MOUTH} />
    case 'dead':
      return <path d={`M${x - 6} ${y + 9}H${x + 6}`} {...line} />
  }
}

function Sparkle({ x, y, size, delay }: { x: number; y: number; size: number; delay: string }) {
  const s = size
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d={`M0 ${-s}L${s * 0.26} ${-s * 0.26}L${s} 0L${s * 0.26} ${s * 0.26}L0 ${s}L${-s * 0.26} ${s * 0.26}L${-s} 0L${-s * 0.26} ${-s * 0.26}Z`}
        fill="#FFD54F"
        className={cn(own, 'motion-safe:animate-pet-twinkle')}
        style={{ animationDelay: delay }}
      />
    </g>
  )
}

export function PetArt({ species, mood, label, className }: { species: string; mood: PetMood; label?: string; className?: string }) {
  const art = ART[species] ?? ART.sunny
  const { x, y } = art.face
  const dead = mood === 'dead'

  return (
    <svg viewBox="0 0 160 160" role="img" aria-label={label} aria-hidden={label ? undefined : true} className={cn('overflow-visible', className)}>
      <ellipse cx="80" cy="147" rx={dead ? 24 : 44} ry={dead ? 4 : 6} fill="#000000" opacity={dead ? 0.12 : 0.22} />

      <g className={cn('[transform-box:fill-box] origin-bottom', MOTION[mood])}>
        <g style={dead ? { filter: 'grayscale(1) brightness(1.2)', opacity: 0.8 } : undefined}>
          {art.body}
          {!dead && (
            <g fill="#FF6B81" opacity={mood === 'thriving' ? 0.55 : mood === 'weak' ? 0.18 : 0.35}>
              <ellipse cx={x - 25} cy={y + 7} rx="6.5" ry="3.8" />
              <ellipse cx={x + 25} cy={y + 7} rx="6.5" ry="3.8" />
            </g>
          )}
          <Eyes x={x} y={y} mood={mood} />
          <Mouth x={x} y={y} mood={mood} />
        </g>

        {mood === 'hungry' && (
          <path
            d={`M${x + 6} ${y + 13}c0 0 3.5 4.5 3.5 7a3.5 3.5 0 0 1-7 0c0-2.5 3.5-7 3.5-7Z`}
            fill={WATER}
            className={cn(own, 'motion-safe:animate-pet-drip')}
          />
        )}
        {mood === 'weak' && <path d={`M${x + 30} ${y - 22}c0 0 5 6 5 9.5a5 5 0 0 1-10 0c0-3.5 5-9.5 5-9.5Z`} fill={WATER} opacity="0.9" />}
        {dead && (
          <ellipse
            cx="80"
            cy={art.top - 8}
            rx="20"
            ry="5.5"
            fill="none"
            stroke="#FFD54F"
            strokeWidth="3.5"
            className={cn(own, 'motion-safe:animate-pet-halo')}
          />
        )}
      </g>

      {mood === 'thriving' && (
        <>
          <Sparkle x={26} y={art.top + 10} size={7} delay="0s" />
          <Sparkle x={136} y={art.top + 24} size={6} delay="0.6s" />
          <Sparkle x={130} y={art.top - 6} size={4} delay="1.2s" />
        </>
      )}
      {mood === 'sleeping' &&
        [
          { dx: 0, size: 13, delay: '0s' },
          { dx: 10, size: 10, delay: '1.05s' },
          { dx: 18, size: 8, delay: '2.1s' },
        ].map((z) => (
          <text
            key={z.delay}
            x={112 + z.dx}
            y={Math.max(18, art.top + 8)}
            fontSize={z.size}
            fontWeight="800"
            fill="#A5B4FC"
            className={cn(own, 'motion-safe:animate-pet-zzz')}
            style={{ animationDelay: z.delay }}
          >
            z
          </text>
        ))}
    </svg>
  )
}

/** Decorative tint per buddy for chips and glows. */
export const SPECIES_TINT: Record<string, { chip: string; glow: string }> = {
  sunny: { chip: 'bg-amber-400/15 text-amber-700 dark:text-amber-300', glow: 'from-amber-300/25' },
  mochi: { chip: 'bg-pink-400/15 text-pink-700 dark:text-pink-300', glow: 'from-pink-300/25' },
  jalapup: { chip: 'bg-green-500/15 text-green-700 dark:text-green-300', glow: 'from-green-400/25' },
  peasley: { chip: 'bg-lime-500/15 text-lime-700 dark:text-lime-300', glow: 'from-lime-400/25' },
  puddin: { chip: 'bg-orange-400/15 text-orange-800 dark:text-orange-300', glow: 'from-orange-300/25' },
  takko: { chip: 'bg-rose-400/15 text-rose-700 dark:text-rose-300', glow: 'from-rose-300/25' },
}
