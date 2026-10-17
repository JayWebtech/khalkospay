import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { getNimNgnRate } from './rates'

/**
 * NIM prices in the on-ramp currencies. CoinGecko gives NIM in USD (and NGN, which the off-ramp already uses);
 * a daily FX feed turns USD into the other local currencies.
 */

const USD_FRESH_MS = 60_000
const USD_MAX_STALE_MS = 10 * 60_000
const FX_FRESH_MS = 60 * 60_000
const FX_MAX_STALE_MS = 24 * 60 * 60_000

let usdCache: { value: number; at: number } | null = null
let fxCache: { rates: Record<string, number>; at: number } | null = null

export async function getUsdPerNim(): Promise<number> {
  if (config.onramp.usdPerNimOverride) return Number(config.onramp.usdPerNimOverride)
  if (usdCache && Date.now() - usdCache.at < USD_FRESH_MS) return usdCache.value
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key'] = process.env.COINGECKO_API_KEY
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd', { headers, signal: AbortSignal.timeout(8_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const usd = ((await res.json()) as { 'nimiq-2'?: { usd?: number } })['nimiq-2']?.usd
    if (!usd || usd <= 0) throw new Error('price missing from response')
    usdCache = { value: usd, at: Date.now() }
    return usd
  } catch (e) {
    if (usdCache && Date.now() - usdCache.at < USD_MAX_STALE_MS) return usdCache.value
    console.error('[fx] NIM/USD price fetch failed:', e instanceof Error ? e.message : e)
    throw new HttpError(503, 'Live NIM price is unavailable right now. Please try again in a minute.', 'RATE_UNAVAILABLE')
  }
}

export async function getFiatPerUsd(currency: string): Promise<number> {
  if (currency === 'USD') return 1
  if (!fxCache || Date.now() - fxCache.at > FX_FRESH_MS) {
    try {
      const res = await fetch(config.onramp.fxUrl, { signal: AbortSignal.timeout(8_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { rates?: Record<string, number> }
      if (!body.rates || typeof body.rates !== 'object') throw new Error('rates missing from response')
      fxCache = { rates: body.rates, at: Date.now() }
    } catch (e) {
      console.error('[fx] exchange rate fetch failed:', e instanceof Error ? e.message : e)
      if (!fxCache || Date.now() - fxCache.at > FX_MAX_STALE_MS) {
        throw new HttpError(503, 'Exchange rates are unavailable right now. Please try again in a minute.', 'RATE_UNAVAILABLE')
      }
    }
  }
  const rate = fxCache!.rates[currency]
  if (!rate || rate <= 0) throw new HttpError(503, `No exchange rate for ${currency} right now`, 'RATE_UNAVAILABLE')
  return rate
}

/** Price of 1 NIM in `currency`, plus its USD price for limits. NGN uses the same rate as the off-ramp. */
export async function getNimPrice(currency: string): Promise<{ fiatPerNim: number; usdPerNim: number }> {
  const usdPerNim = await getUsdPerNim()
  if (currency === 'NGN') return { fiatPerNim: (await getNimNgnRate()).ngnPerNim, usdPerNim }
  return { fiatPerNim: usdPerNim * (await getFiatPerUsd(currency)), usdPerNim }
}
