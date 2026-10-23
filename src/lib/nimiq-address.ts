/** Nimiq's base32 alphabet: no I, O, W or Z. */
const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

function ibanCheck(text: string) {
  const digits = [...text.toUpperCase()].map((c) => (c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c)).join('')
  let rest = 0
  for (let i = 0; i < digits.length; i += 6) rest = Number(String(rest) + digits.slice(i, i + 6)) % 97
  return rest
}

/** A user-friendly Nimiq address (NQ.. with a valid checksum) in its usual groups of four, or null. */
export function parseNimiqAddress(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  if (!/^NQ\d{2}[0-9A-Z]{32}$/.test(compact) || !compact.slice(4).split('').every((c) => ALPHABET.includes(c))) return null
  if (ibanCheck(compact.slice(4) + compact.slice(0, 4)) !== 1) return null
  return compact.replace(/(.{4})(?=.)/g, '$1 ')
}
