import { useMemo } from 'react'
import { finderOrigins, qrDataPath, qrMatrix } from '@/lib/qr'
import { cn } from '@/lib/utils'

/** A QR code as SVG, styled like the printed banner: square data modules, rounded finder squares. */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const m = useMemo(() => qrMatrix(value), [value])
  const d = useMemo(() => qrDataPath(m), [m])
  // Four modules of quiet zone, which scanners need to find the code.
  const q = 4
  return (
    <svg viewBox={`${-q} ${-q} ${m.size + q * 2} ${m.size + q * 2}`} role="img" aria-label={label} className={cn('rounded-2xl bg-white', className)} shapeRendering="crispEdges">
      <path d={d} fill="#1a1511" />
      {finderOrigins(m.size).map(([x, y]) => (
        <g key={`${x}-${y}`} fill="#1a1511" shapeRendering="geometricPrecision">
          <path fillRule="evenodd" d={`M${x + 1.9} ${y}h3.2a1.9 1.9 0 0 1 1.9 1.9v3.2a1.9 1.9 0 0 1-1.9 1.9h-3.2a1.9 1.9 0 0 1-1.9-1.9v-3.2a1.9 1.9 0 0 1 1.9-1.9zM${x + 2.2} ${y + 1}h2.6a1.2 1.2 0 0 1 1.2 1.2v2.6a1.2 1.2 0 0 1-1.2 1.2h-2.6a1.2 1.2 0 0 1-1.2-1.2v-2.6a1.2 1.2 0 0 1 1.2-1.2z`} />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} />
        </g>
      ))}
    </svg>
  )
}
