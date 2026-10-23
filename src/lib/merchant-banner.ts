import type { Merchant } from './api'
import { BRAND_MARK } from './brand'
import { shortAddress } from './format'
import { merchantPayLink } from './merchants'
import { finderOrigins, qrMatrix } from './qr'

/**
 * The printable shop banner: business details, a large QR code and "Scan to pay with NIM · KhalkosPay", drawn on a
 * canvas at print resolution (2000 × 2828, the A-paper ratio: A5 at 340 dpi, A4 at 240 dpi).
 */
export const BANNER_WIDTH = 2000
export const BANNER_HEIGHT = 2828

// The app's copper/ink tokens as hex: canvas in older WebViews can't paint oklch().
const C = {
  paper: '#fcfaf7',
  ink: '#1a1511',
  muted: '#645c56',
  copper: '#a6501a',
  accent: '#feeadb',
  border: '#e4e0dc',
  hero: '#251a15',
  heroFg: '#f9f4ef',
  heroMuted: '#bdaa9b',
  glow: '#f1a366',
}
const FONT = '"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

type Ctx = CanvasRenderingContext2D

function font(ctx: Ctx, weight: number, size: number) {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** The largest size from `size` down to `min` at which the text fits on one line. */
function fitSize(ctx: Ctx, text: string, weight: number, size: number, min: number, maxWidth: number) {
  for (let s = size; s > min; s -= 2) {
    font(ctx, weight, s)
    if (ctx.measureText(text).width <= maxWidth) return s
  }
  font(ctx, weight, min)
  return min
}

/** Greedy word wrap at the current font, ellipsizing the last line. */
function wrap(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next
      continue
    }
    lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.trimEnd()}…`
  return kept
}

/** By hand rather than ctx.roundRect, which iOS 15 WebViews don't have. */
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo failed to load'))
    img.src = src
  })
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase()
}

function drawBrandMark(ctx: Ctx, x: number, y: number, size: number, hexColor: string, letterColor: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 32, size / 32)
  ctx.fillStyle = hexColor
  ctx.fill(new Path2D(BRAND_MARK.hexagon))
  ctx.fillStyle = letterColor
  ctx.fill(new Path2D(BRAND_MARK.letter))
  ctx.restore()
}

function drawLogo(ctx: Ctx, m: Merchant, logo: HTMLImageElement | null, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  if (logo) {
    ctx.clip()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    // Cover-crop into the circle.
    const scale = Math.max((r * 2) / logo.naturalWidth, (r * 2) / logo.naturalHeight)
    const w = logo.naturalWidth * scale
    const h = logo.naturalHeight * scale
    ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h)
  } else {
    ctx.fillStyle = C.accent
    ctx.fill()
    ctx.fillStyle = C.copper
    font(ctx, 700, r * 0.82)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(m.name) || '•', cx, cy + r * 0.04)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.lineWidth = 6
  ctx.strokeStyle = C.border
  ctx.stroke()
}

/** Square data modules and rounded finder squares: rounding only the finders keeps every decoder happy. */
function drawQr(ctx: Ctx, text: string, x: number, y: number, size: number) {
  const qr = qrMatrix(text)
  const cell = size / qr.size
  ctx.fillStyle = C.ink
  ctx.beginPath()
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      // A hair of overlap so neighbouring modules print as one solid shape.
      if (qr.data[row][col] && !qr.finder[row][col]) ctx.rect(x + col * cell - 0.5, y + row * cell - 0.5, cell + 1, cell + 1)
    }
  }
  ctx.fill()
  for (const [fx, fy] of finderOrigins(qr.size)) {
    const ox = x + fx * cell
    const oy = y + fy * cell
    ctx.fillStyle = C.ink
    roundRect(ctx, ox, oy, cell * 7, cell * 7, cell * 1.9)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, ox + cell, oy + cell, cell * 5, cell * 5, cell * 1.2)
    ctx.fill()
    ctx.fillStyle = C.ink
    roundRect(ctx, ox + cell * 2, oy + cell * 2, cell * 3, cell * 3, cell * 0.9)
    ctx.fill()
  }
}

/** Draws the banner. Fonts and the logo load first, so the canvas is complete when this resolves. */
export async function renderMerchantBanner(m: Merchant): Promise<HTMLCanvasElement> {
  await Promise.all([500, 600, 700].map((w) => document.fonts?.load(`${w} 64px "Geist Variable"`))).catch(() => {})
  const logo = m.logo ? await loadImage(m.logo).catch(() => null) : null

  const W = BANNER_WIDTH
  const H = BANNER_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This device can't draw the banner")
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, W, H)

  // Ink header with a copper glow, like the app's balance card.
  const bandH = 900
  ctx.fillStyle = C.hero
  ctx.fillRect(0, 0, W, bandH)
  const glow = ctx.createRadialGradient(W - 260, 40, 0, W - 260, 40, 1100)
  glow.addColorStop(0, 'rgba(241, 163, 102, 0.42)')
  glow.addColorStop(1, 'rgba(241, 163, 102, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, bandH)

  drawBrandMark(ctx, 150, 118, 132, C.copper, C.heroFg)
  ctx.fillStyle = C.heroFg
  font(ctx, 600, 78)
  ctx.textAlign = 'left'
  ctx.fillText('KhalkosPay', 312, 210)

  // "NIM accepted here" pill on the right of the brand row.
  font(ctx, 600, 50)
  const pill = 'NIM accepted here'
  const pillW = ctx.measureText(pill).width + 96
  ctx.fillStyle = 'rgba(249, 244, 239, 0.12)'
  roundRect(ctx, W - 150 - pillW, 132, pillW, 104, 52)
  ctx.fill()
  ctx.fillStyle = C.heroFg
  ctx.textAlign = 'center'
  ctx.fillText(pill, W - 150 - pillW / 2, 202)

  ctx.textAlign = 'left'
  ctx.fillStyle = C.heroFg
  font(ctx, 700, fitSize(ctx, 'Scan to pay', 700, 232, 160, W - 300))
  ctx.fillText('Scan to pay', 150, 520)
  font(ctx, 600, 104)
  const withNim = 'with NIM '
  ctx.fillStyle = C.heroMuted
  ctx.fillText(withNim, 150, 664)
  ctx.fillStyle = C.glow
  ctx.fillText('· KhalkosPay', 150 + ctx.measureText(withNim).width, 664)

  // The card: shop identity, then the QR with a clean quiet zone around it.
  const cardX = 150
  const cardY = 760
  const cardW = W - 300
  const cardH = 1790
  ctx.save()
  ctx.shadowColor = 'rgba(37, 26, 21, 0.18)'
  ctx.shadowBlur = 80
  ctx.shadowOffsetY = 28
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, cardX, cardY, cardW, cardH, 80)
  ctx.fill()
  ctx.restore()
  ctx.lineWidth = 4
  ctx.strokeStyle = C.border
  roundRect(ctx, cardX, cardY, cardW, cardH, 80)
  ctx.stroke()

  const logoR = 112
  const logoCx = cardX + 110 + logoR
  const logoCy = cardY + 100 + logoR
  drawLogo(ctx, m, logo, logoCx, logoCy, logoR)

  const textX = logoCx + logoR + 64
  const textW = cardX + cardW - 110 - textX
  ctx.textAlign = 'left'
  ctx.fillStyle = C.ink
  const nameSize = fitSize(ctx, m.name, 700, 104, 76, textW)
  const nameLines = nameSize > 76 ? [m.name] : wrap(ctx, m.name, textW, 2)
  const sub = [m.category, m.location].filter(Boolean).join(' · ')
  const lineH = nameSize * 1.08
  const blockH = nameLines.length * lineH + (sub ? 76 : 0)
  let ty = logoCy - blockH / 2 + nameSize * 0.82
  for (const line of nameLines) {
    ctx.fillText(line, textX, ty)
    ty += lineH
  }
  if (sub) {
    ctx.fillStyle = C.muted
    font(ctx, 500, fitSize(ctx, sub, 500, 54, 40, textW))
    ctx.fillText(wrap(ctx, sub, textW, 1)[0], textX, ty - lineH + nameSize * 0.18 + 76)
  }

  // At least four modules of white on every side (the QR quiet zone), even for a long host name.
  const qrSize = 1080
  const qrX = (W - qrSize) / 2
  const qrY = cardY + 450
  drawQr(ctx, merchantPayLink(m.code), qrX, qrY, qrSize)

  ctx.textAlign = 'center'
  font(ctx, 500, 52)
  ctx.fillStyle = C.muted
  const codeLabel = 'Shop code  '
  font(ctx, 700, 60)
  const codeW = ctx.measureText(m.code).width
  font(ctx, 500, 52)
  const labelW = ctx.measureText(codeLabel).width
  const codeY = qrY + qrSize + 170
  const startX = W / 2 - (labelW + codeW) / 2
  ctx.textAlign = 'left'
  ctx.fillText(codeLabel, startX, codeY)
  ctx.fillStyle = C.ink
  font(ctx, 700, 60)
  ctx.fillText(m.code, startX + labelW, codeY)

  // Footer: how to pay without the camera, and where the NIM goes.
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  font(ctx, 600, 50)
  ctx.fillText('Open Nimiq Pay › KhalkosPay › Scan', W / 2, cardY + cardH + 118)
  ctx.fillStyle = C.muted
  font(ctx, 500, 42)
  const footer = [m.phone, `Paid straight to ${shortAddress(m.payoutAddress)}`].filter(Boolean).join('  ·  ')
  ctx.fillText(wrap(ctx, footer, W - 300, 1)[0], W / 2, cardY + cardH + 190)

  return canvas
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), 'image/png'))
}

export function bannerFileName(m: Merchant) {
  const slug = m.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `khalkospay-${slug || 'shop'}-banner.png`
}
