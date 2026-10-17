import { createHash, timingSafeEqual } from 'node:crypto'
import { RequestHandler, Router } from 'express'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { adminListOrders, settleOrder } from '../services/onramp'

/** Operator-only endpoints. Every request needs `Authorization: Bearer <ADMIN_TOKEN>`. */
export const adminRouter = Router()

const MIN_TOKEN_LENGTH = 32

export const adminEnabled = () => config.adminToken.length >= MIN_TOKEN_LENGTH

const digest = (s: string) => createHash('sha256').update(s).digest()

// Both sides are hashed first, so the comparison is constant time and doesn't leak the token's length either.
const requireAdmin: RequestHandler = (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  if (!adminEnabled()) throw new HttpError(503, 'The admin API is off on this server. Set ADMIN_TOKEN to turn it on.', 'ADMIN_DISABLED')
  const token = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? ''
  if (!timingSafeEqual(digest(token), digest(config.adminToken))) throw new HttpError(401, 'A valid admin token is required', 'UNAUTHORIZED')
  next()
}

adminRouter.use(requireAdmin)

adminRouter.get('/onramp', async (req, res) => {
  res.json(await adminListOrders(req.query.status))
})

adminRouter.post('/onramp/:id/settle', async (req, res) => {
  res.json(await settleOrder(req.params.id, req.body ?? {}))
})
