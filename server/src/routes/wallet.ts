import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { getWalletBalanceLuna, isValidAddress, normalizeAddress } from '../services/nimiq'

export const walletRouter = Router()

const limit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false })
// The app asks every 30 seconds while open; a short cache keeps that to a few node calls per wallet.
const CACHE_MS = 10_000
const cache = new Map<string, { at: number; luna: bigint }>()

/** The balance Nimiq Pay shows for an address, HTLCs included, on this server's network. Balances are public on chain. */
walletRouter.get('/balance', limit, async (req, res) => {
  const raw = String(req.query.address ?? '')
  if (!isValidAddress(raw)) throw new HttpError(400, 'Invalid Nimiq address', 'INVALID_ADDRESS')
  const address = normalizeAddress(raw)
  let hit = cache.get(address)
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    if (cache.size > 5_000) cache.clear()
    hit = { at: Date.now(), luna: await getWalletBalanceLuna(address) }
    cache.set(address, hit)
  }
  res.json({ address, network: config.nimiq.network, balanceLuna: Number(hit.luna) })
})
