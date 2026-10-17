const ngnFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatNgn(amount: number) {
  return ngnFormatter.format(amount)
}

/** Any ISO currency, at its own precision (no decimals for UGX, XOF…). */
export function formatFiat(amount: string | number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount))
  } catch {
    return `${amount} ${currency}`
  }
}

/** A per-NIM price, which can be a small fraction (0.129 KES), so 4 significant digits instead of 2 decimals. */
export function formatRate(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumSignificantDigits: 4 }).format(amount)
  } catch {
    return `${amount.toPrecision(4)} ${currency}`
  }
}

export function formatNim(amount: number | string, maxDecimals = 2) {
  return `${Number(amount).toLocaleString('en-US', { maximumFractionDigits: maxDecimals })} NIM`
}

export function lunaToNim(luna: number) {
  return luna / 100_000
}

export function shortAddress(address: string) {
  const groups = address.split(' ')
  return groups.length >= 9 ? `${groups[1]} … ${groups[8]}` : address
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return relative.format(Math.round(seconds), 'second')
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86_400), 'day')
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
