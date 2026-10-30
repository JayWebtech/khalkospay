import { createHash, timingSafeEqual } from 'node:crypto'
import { RequestHandler, Response, Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { AdminIdentity, authenticateSession, login, logout, SESSION_PREFIX } from '../services/admin-auth'
import { listCashouts, listGifts, listLedger, listMealLogs, listMeals, listPets, listRevivals, overview, treasurySnapshot } from '../services/admin-stats'
import { adminListOrders, settleOrder } from '../services/onramp'
import { listWebhookEvents, parseEventType, retryWebhookEvent, sendTestEvent } from '../services/partner-webhooks'
import {
  createApiKey,
  createPartner,
  getPartner,
  listPartners,
  parseMode,
  revokeApiKey,
  rotateApiKey,
  rotateWebhookSecret,
  updatePartner,
} from '../services/partners'

/**
 * Operator-only endpoints. Every request needs `Authorization: Bearer <token>`, where the token is either
 * a dashboard session from POST /auth/login (it starts with SESSION_PREFIX) or the static ADMIN_TOKEN, for scripts.
 */
export const adminRouter = Router()

const MIN_TOKEN_LENGTH = 32

export const adminEnabled = () => config.adminToken.length >= MIN_TOKEN_LENGTH

const digest = (s: string) => createHash('sha256').update(s).digest()

const identity = (res: Response) => res.locals.admin as AdminIdentity

// Both sides are hashed first, so the comparison is constant time and doesn't leak the token's length either.
const requireAdmin: RequestHandler = async (req, res, next) => {
  const header = req.get('authorization')
  if (header === undefined) throw new HttpError(401, 'Sign in to the admin dashboard first', 'UNAUTHORIZED')
  const token = /^Bearer (.+)$/i.exec(header)?.[1] ?? ''
  if (token.startsWith(SESSION_PREFIX)) {
    res.locals.admin = await authenticateSession(token)
    return next()
  }
  if (!adminEnabled()) throw new HttpError(503, 'The admin token is off on this server. Set ADMIN_TOKEN to turn it on, or sign in to the dashboard.', 'ADMIN_DISABLED')
  if (!timingSafeEqual(digest(token), digest(config.adminToken))) throw new HttpError(401, 'A valid admin token is required', 'UNAUTHORIZED')
  res.locals.admin = { via: 'token', admin: null, sessionId: null, expiresAt: null } satisfies AdminIdentity
  next()
}

// Per IP. Each attempt already costs a scrypt run, this caps guessing at a handful a minute.
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false })

adminRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

adminRouter.post('/auth/login', loginLimit, async (req, res) => {
  res.json(await login(req.body ?? {}, { ip: req.ip, userAgent: req.get('user-agent') }))
})

adminRouter.use(requireAdmin)

adminRouter.get('/auth/me', (_req, res) => {
  res.json(identity(res))
})

adminRouter.post('/auth/logout', async (_req, res) => {
  const { sessionId } = identity(res)
  if (sessionId) await logout(sessionId)
  res.status(204).end()
})

adminRouter.get('/overview', async (_req, res) => {
  res.json(await overview())
})

adminRouter.get('/treasury', async (_req, res) => {
  res.json(await treasurySnapshot())
})

adminRouter.get('/gifts', async (req, res) => {
  res.json(await listGifts(req.query))
})

adminRouter.get('/cashouts', async (req, res) => {
  res.json(await listCashouts(req.query))
})

adminRouter.get('/pets', async (req, res) => {
  res.json(await listPets(req.query))
})

adminRouter.get('/pets/meals', async (req, res) => {
  res.json(await listMeals(req.query))
})

adminRouter.get('/pets/revivals', async (req, res) => {
  res.json(await listRevivals(req.query))
})

adminRouter.get('/meal-logs', async (req, res) => {
  res.json(await listMealLogs(req.query))
})

adminRouter.get('/ledger', async (req, res) => {
  res.json(await listLedger(req.query))
})

adminRouter.get('/onramp', async (req, res) => {
  res.json(await adminListOrders(req.query.status))
})

adminRouter.post('/onramp/:id/settle', async (req, res) => {
  const { admin } = identity(res)
  res.json(await settleOrder(req.params.id, req.body ?? {}, admin?.email ?? 'admin-token'))
})

// ------------------------------------------------------------------------------------------- partner API

adminRouter.get('/partners', async (_req, res) => {
  res.json(await listPartners())
})

adminRouter.post('/partners', async (req, res) => {
  res.status(201).json(await createPartner(req.body ?? {}))
})

adminRouter.get('/partners/:id', async (req, res) => {
  res.json(await getPartner(req.params.id))
})

adminRouter.patch('/partners/:id', async (req, res) => {
  res.json(await updatePartner(req.params.id, req.body ?? {}))
})

/** The response holds the full secret key. It is never shown again. */
adminRouter.post('/partners/:id/keys', async (req, res) => {
  res.status(201).json(await createApiKey(req.params.id, req.body ?? {}))
})

adminRouter.post('/partners/:id/keys/:keyId/rotate', async (req, res) => {
  res.status(201).json(await rotateApiKey(req.params.id, req.params.keyId, req.body ?? {}))
})

adminRouter.post('/partners/:id/keys/:keyId/revoke', async (req, res) => {
  res.json(await revokeApiKey(req.params.id, req.params.keyId))
})

adminRouter.post('/partners/:id/webhook-secret/rotate', async (req, res) => {
  res.json(await rotateWebhookSecret(req.params.id, req.body?.mode))
})

adminRouter.post('/partners/:id/webhooks/test', async (req, res) => {
  const partner = await prisma.partner.findUnique({ where: { id: req.params.id } })
  if (!partner) throw new HttpError(404, 'Partner not found', 'PARTNER_NOT_FOUND')
  res.json(await sendTestEvent(partner, parseMode(req.body?.mode), parseEventType(req.body?.type)))
})

adminRouter.get('/partners/:id/webhook-events', async (req, res) => {
  const mode = req.query.mode
  const limit = Number(req.query.limit ?? 25)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'limit must be a whole number from 1 to 100', 'INVALID_LIMIT')
  res.json(
    await listWebhookEvents(
      { partnerId: req.params.id, ...(mode === 'test' || mode === 'live' ? { livemode: mode === 'live' } : {}) },
      { limit, cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null },
    ),
  )
})

adminRouter.post('/partners/:id/webhook-events/:eventId/retry', async (req, res) => {
  res.json(await retryWebhookEvent(req.params.id, req.params.eventId))
})
