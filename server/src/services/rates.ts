import { config } from '../config'
import { HttpError } from '../lib/http-error'

export interface NimNgnRate {
  ngnPerNim: number
  fetchedAt: number
  source: 'coingecko' | 'override'
}

const FRESH_MS = 60_000
const MAX_STALE_MS = 10 * 60_000

let cached: NimNgnRate | null = null

export async function getNimNgnRate(): Promise<NimNgnRate> {
  if (config.offramp.rateOverride) {
    return { ngnPerNim: Number(config.offramp.rateOverride), fetchedAt: Date.now(), source: 'override' }
  }
  if (cached && Date.now() - cached.fetchedAt < FRESH_MS) return cached

  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=ngn', {
      headers,
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { 'nimiq-2'?: { ngn?: number } }
    const ngn = body['nimiq-2']?.ngn
    if (!ngn || ngn <= 0) throw new Error('price missing from response')
    cached = { ngnPerNim: ngn, fetchedAt: Date.now(), source: 'coingecko' }
    return cached
  } catch (e) {
    if (cached && Date.now() - cached.fetchedAt < MAX_STALE_MS) return cached
    console.error('[rates] NIM/NGN price fetch failed:', e instanceof Error ? e.message : e)
    throw new HttpError(503, 'Live NIM price is unavailable right now. Please try again in a minute.', 'RATE_UNAVAILABLE')
  }
}
