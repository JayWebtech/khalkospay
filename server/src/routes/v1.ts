import { createHash, randomUUID } from 'node:crypto'
import express, { ErrorRequestHandler, Request, RequestHandler, Response, Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { OfframpStatus, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { formatNim, normalizeAddress, resolveTxHash, WrongNetworkError } from '../services/nimiq'
import {
  banksFor,
  createOrder,
  expireSandboxOrder,
  offrampEnabled,
  parseAmount,
  quoteDto,
  quoteLuna,
  simulateSandboxDeposit,
  submitDeposit,
  verifyBankAccount,
} from '../services/offramp'
import { API_STATUSES, apiOfframpDto } from '../services/partner-dto'
import { listWebhookEvents, parseEventType, sendTestEvent } from '../services/partner-webhooks'
import { authenticateApiKey, PartnerIdentity } from '../services/partners'
import { PaystackError } from '../services/paystack'
import { getNimNgnRate } from '../services/rates'
import { openApiSpec } from './v1-openapi'

/**
 * The public off-ramp API for partners (wallets, exchanges, other mini apps), server to server. Every request needs
 * `Authorization: Bearer kp_test_…|kp_live_…`; reads only ever see the calling partner's orders in the key's mode.
 * Errors are `{ error: { code, message } }`. Every POST needs an Idempotency-Key header.
 */
export const v1Router = Router()

const identity = (res: Response) => res.locals.partnerIdentity as PartnerIdentity

// ------------------------------------------------------------------------------------------- errors

function toApiError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof HttpError) return { status: err.status, code: (err.code ?? 'error').toLowerCase(), message: err.message }
  if (err instanceof WrongNetworkError) {
    return { status: 503, code: 'nimiq_unavailable', message: 'NIM deposits are paused for maintenance. Try again later.' }
  }
  if (err instanceof PaystackError) {
    console.error('[v1] paystack', err.httpStatus, err.message)
    return { status: 502, code: 'bank_provider_unavailable', message: 'Our bank partner is unavailable right now. Try again shortly.' }
  }
  const e = err as { type?: string; status?: number; message?: string } | null
  if (e?.type === 'entity.parse.failed') return { status: 400, code: 'invalid_json', message: 'The request body is not valid JSON' }
  if (e?.type === 'entity.too.large') return { status: 413, code: 'payload_too_large', message: 'The request body is too large' }
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) return { status: e.status, code: 'bad_request', message: e.message ?? 'Bad request' }
  console.error('[v1]', err)
  return { status: 500, code: 'internal_error', message: 'Something went wrong on our side' }
}

const errorBody = (code: string, message: string) => ({ error: { code, message } })

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const { status, code, message } = toApiError(err)
  res.status(status).json(errorBody(code, message))
}

const limiter = (limit: number, keyGenerator: (req: Request, res: Response) => string) =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator,
    handler: (_req, res) => {
      res.status(429).json(errorBody('rate_limited', 'Too many requests. Slow down and retry after the time in the RateLimit header.'))
    },
  })

const BAD_KEY_WINDOW_MS = 15 * 60_000
const BAD_KEY_LIMIT = 100
const badKeys = new Map<string, { count: number; resetAt: number }>()

/** Counts a rejected key for this IP; true once the IP is over the limit. Valid keys are never held back by it. */
function tooManyBadKeys(ip: string) {
  const now = Date.now()
  if (badKeys.size > 10_000) for (const [k, v] of badKeys) if (v.resetAt <= now) badKeys.delete(k)
  let entry = badKeys.get(ip)
  if (!entry || entry.resetAt <= now) badKeys.set(ip, (entry = { count: 0, resetAt: now + BAD_KEY_WINDOW_MS }))
  return ++entry.count > BAD_KEY_LIMIT
}

const perKeyLimit = limiter(config.partnerApi.rateLimitPerMinute, (_req, res) => identity(res).key.id)
const resolveLimit = limiter(config.partnerApi.resolveLimitPerMinute, (_req, res) => `resolve:${identity(res).key.id}`)

// ------------------------------------------------------------------------------------------- request parsing

type Body = Record<string, unknown>

function readBody(req: Request, allowed: string[]): Body {
  const body: unknown = req.body ?? {}
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object', 'INVALID_REQUEST')
  }
  const unknown = Object.keys(body).find((k) => !allowed.includes(k))
  if (unknown) throw new HttpError(400, `Unknown parameter: ${unknown}`, 'UNKNOWN_PARAMETER')
  return body as Body
}

function requiredString(body: Body, key: string, max = 200): string {
  const v = body[key]
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${key} is required and must be a string`, 'INVALID_REQUEST')
  if (v.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`, 'INVALID_REQUEST')
  return v.trim()
}

function optionalString(body: Body, key: string, max: number): string | null {
  if (body[key] === undefined || body[key] === null) return null
  return requiredString(body, key, max)
}

function nimAmountOf(body: Body, key = 'nimAmount', required = true): bigint | null {
  const v = body[key]
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${key} is required, e.g. "250.5"`, 'INVALID_REQUEST')
    return null
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${key} must be a string like "250.5"`, 'INVALID_AMOUNT')
  return parseAmount(v)
}

const METADATA_MAX_KEYS = 20

function parseMetadata(v: unknown): Prisma.InputJsonObject | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'metadata must be an object of keys and values', 'INVALID_METADATA')
  const entries = Object.entries(v)
  if (entries.length > METADATA_MAX_KEYS) throw new HttpError(400, `metadata can have at most ${METADATA_MAX_KEYS} keys`, 'INVALID_METADATA')
  for (const [k, value] of entries) {
    if (k.length === 0 || k.length > 40) throw new HttpError(400, 'metadata keys must be 1 to 40 characters', 'INVALID_METADATA')
    const ok = (typeof value === 'string' && value.length <= 500) || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    if (!ok) throw new HttpError(400, `metadata.${k} must be a string (up to 500 characters), number or boolean`, 'INVALID_METADATA')
  }
  return Object.fromEntries(entries) as Prisma.InputJsonObject
}

/** Stable JSON: object keys sorted, so the same request in a different key order matches its Idempotency-Key. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Body)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

// ------------------------------------------------------------------------------------------- idempotency

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/
/** A first request still "in progress" after this long died mid-way, so its key may be used again. */
const ABANDONED_AFTER_MS = 120_000

interface Result {
  status: number
  body: unknown
}

/**
 * Runs a POST once per Idempotency-Key. A retry with the same key and request gets the first response back
 * (with `Idempotent-Replayed: true`); the same key with a different request is refused. 5xx and 429 answers
 * aren't kept, so those can be retried with the same key. Keys are forgotten after 24 hours.
 */
async function idempotent(req: Request, res: Response, run: () => Promise<Result>) {
  const { partner, livemode } = identity(res)
  const key = req.get('idempotency-key')
  if (!key) {
    throw new HttpError(400, 'Every POST needs an Idempotency-Key header: a unique string, such as a UUID, per operation', 'IDEMPOTENCY_KEY_REQUIRED')
  }
  if (!IDEMPOTENCY_KEY.test(key)) throw new HttpError(400, 'Idempotency-Key must be 1 to 255 printable characters without spaces', 'INVALID_IDEMPOTENCY_KEY')
  const requestHash = createHash('sha256')
    .update(canonical([req.method, req.baseUrl + req.path, req.body ?? {}]))
    .digest('hex')
  const where = { partnerId_livemode_key: { partnerId: partner.id, livemode, key } }

  let recordId: string | null = null
  for (let tries = 0; recordId === null; tries++) {
    try {
      recordId = (await prisma.partnerIdempotencyKey.create({ data: { partnerId: partner.id, livemode, key, requestHash } })).id
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
      const existing = await prisma.partnerIdempotencyKey.findUnique({ where })
      if (!existing) continue
      if (existing.requestHash !== requestHash) {
        throw new HttpError(422, 'This Idempotency-Key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED')
      }
      if (existing.statusCode !== null) {
        res.set('Idempotent-Replayed', 'true')
        res.status(existing.statusCode).json(JSON.parse(existing.response ?? 'null'))
        return
      }
      if (tries === 0 && Date.now() - existing.createdAt.getTime() > ABANDONED_AFTER_MS) {
        await prisma.partnerIdempotencyKey.deleteMany({ where: { id: existing.id, statusCode: null } })
        continue
      }
      throw new HttpError(409, 'A request with this Idempotency-Key is still being processed', 'IDEMPOTENCY_KEY_IN_USE')
    }
  }

  let result: Result
  try {
    result = await run()
  } catch (e) {
    const err = toApiError(e)
    result = { status: err.status, body: errorBody(err.code, err.message) }
  }
  if (result.status >= 500 || result.status === 429) {
    await prisma.partnerIdempotencyKey.delete({ where: { id: recordId } }).catch(() => {})
  } else {
    await prisma.partnerIdempotencyKey.update({ where: { id: recordId }, data: { statusCode: result.status, response: JSON.stringify(result.body) } })
  }
  res.status(result.status).json(result.body)
}

// ------------------------------------------------------------------------------------------- helpers

async function findOrder(res: Response, id: string) {
  const { partner, livemode } = identity(res)
  const order = await prisma.offrampOrder.findFirst({ where: { id, partnerId: partner.id, livemode } })
  if (!order) throw new HttpError(404, 'No off-ramp with this id for your account in this mode', 'OFFRAMP_NOT_FOUND')
  return order
}

function requireTestKey(res: Response) {
  if (identity(res).livemode) throw new HttpError(403, 'Sandbox endpoints need a test key (kp_test_…)', 'SANDBOX_ONLY')
}

const encodeCursor = (o: { createdAt: Date; id: string }) => Buffer.from(`${o.createdAt.toISOString()}|${o.id}`).toString('base64url')

function decodeCursor(raw: string) {
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(at ?? '')
  if (!id || Number.isNaN(createdAt.getTime())) throw new HttpError(400, 'cursor is not valid. Pass nextCursor from the previous page.', 'INVALID_CURSOR')
  return { createdAt, id }
}

function limitOf(query: Request['query'], fallback = 20, max = 100) {
  if (query.limit === undefined) return fallback
  const limit = Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new HttpError(400, `limit must be a whole number from 1 to ${max}`, 'INVALID_LIMIT')
  return limit
}

const queryString = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// ------------------------------------------------------------------------------------------- routes

v1Router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  res.set('Request-Id', randomUUID())
  next()
})
v1Router.use(express.json({ limit: '100kb' }))

/** PUBLIC_API_URL, else this request's own origin. Hosts like Railway end TLS in front of us, so trust their X-Forwarded-Proto. */
function publicOrigin(req: Request) {
  if (config.partnerApi.publicUrl) return config.partnerApi.publicUrl
  const forwarded = req.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : req.protocol
  return `${protocol}://${req.get('host')}`
}

v1Router.get('/openapi.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(openApiSpec(publicOrigin(req)))
})

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14'

/** Swagger UI for the spec above: browse every endpoint and try them with a test key. */
v1Router.get('/docs', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KhalkosPay off-ramp API</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
    <style>body { margin: 0; background: #fafafa; } .swagger-ui .topbar { display: none; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '${req.baseUrl}/openapi.json', dom_id: '#swagger-ui', deepLinking: true, displayRequestDuration: true })
    </script>
  </body>
</html>`)
})

const authenticate: RequestHandler = async (req, res, next) => {
  try {
    res.locals.partnerIdentity = await authenticateApiKey(req.get('authorization'))
  } catch (e) {
    if (e instanceof HttpError && e.status === 401 && tooManyBadKeys(req.ip ?? '')) {
      throw new HttpError(429, 'Too many requests with invalid API keys from your address. Check the key you are sending.', 'RATE_LIMITED')
    }
    throw e
  }
  next()
}

v1Router.use(authenticate, perKeyLimit)

v1Router.get('/rates', async (_req, res) => {
  const { livemode } = identity(res)
  const rate = await getNimNgnRate()
  res.json({
    object: 'rate',
    livemode,
    base: 'NIM',
    quote: 'NGN',
    rate: rate.ngnPerNim,
    updatedAt: new Date(rate.fetchedAt).toISOString(),
    serviceFeePercent: config.offramp.feeBps / 100,
    minPayoutNgn: config.offramp.minPayoutNgn,
    maxPayoutNgn: config.offramp.maxPayoutNgn,
    quoteTtlSeconds: config.offramp.quoteTtlSeconds,
    available: livemode ? offrampEnabled() : true,
  })
})

v1Router.get('/banks', async (_req, res) => {
  const banks = await banksFor(identity(res).livemode)
  res.json({ object: 'list', data: banks.map((b) => ({ code: b.code, name: b.name, popular: b.popular })) })
})

v1Router.post('/bank-accounts/resolve', resolveLimit, async (req, res) => {
  await idempotent(req, res, async () => {
    const body = readBody(req, ['bankCode', 'accountNumber'])
    const { bank, accountNumber, accountName } = await verifyBankAccount(
      requiredString(body, 'bankCode', 20),
      requiredString(body, 'accountNumber', 20),
      identity(res).livemode,
    )
    return { status: 200, body: { object: 'bank_account', bankCode: bank.code, bankName: bank.name, accountNumber, accountName } }
  })
})

v1Router.post('/quotes', async (req, res) => {
  await idempotent(req, res, async () => {
    const body = readBody(req, ['nimAmount'])
    const quote = quoteDto(await quoteLuna(nimAmountOf(body)!))
    return { status: 200, body: { object: 'quote', livemode: identity(res).livemode, ...quote } }
  })
})

v1Router.post('/offramps', async (req, res) => {
  await idempotent(req, res, async () => {
    const body = readBody(req, ['nimAmount', 'bankCode', 'accountNumber', 'reference', 'metadata', 'refundAddress'])
    const { partner, livemode } = identity(res)
    const nimLuna = nimAmountOf(body)!
    const order = await createOrder({
      nimAmount: formatNim(nimLuna),
      bankCode: requiredString(body, 'bankCode', 20),
      accountNumber: requiredString(body, 'accountNumber', 20),
      source: 'api',
      partner: {
        id: partner.id,
        livemode,
        reference: optionalString(body, 'reference', 100),
        metadata: parseMetadata(body.metadata),
        refundAddress: optionalString(body, 'refundAddress', 60),
      },
    })
    return { status: 201, body: apiOfframpDto(order) }
  })
})

v1Router.get('/offramps', async (req, res) => {
  const { partner, livemode } = identity(res)
  const limit = limitOf(req.query)
  const status = queryString(req.query.status).toLowerCase()
  if (status && !API_STATUSES.includes(status)) throw new HttpError(400, `status must be one of ${API_STATUSES.join(', ')}`, 'INVALID_STATUS')
  const reference = queryString(req.query.reference)
  const cursor = queryString(req.query.cursor)
  const after = cursor ? decodeCursor(cursor) : null
  const rows = await prisma.offrampOrder.findMany({
    where: {
      partnerId: partner.id,
      livemode,
      ...(status ? { status: status.toUpperCase() as OfframpStatus } : {}),
      ...(reference ? { partnerReference: reference } : {}),
      ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  res.json({ object: 'list', data: page.map(apiOfframpDto), hasMore, nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null })
})

v1Router.get('/offramps/:id', async (req, res) => {
  res.json(apiOfframpDto(await findOrder(res, req.params.id)))
})

v1Router.post('/offramps/:id/deposit', async (req, res) => {
  await idempotent(req, res, async () => {
    const body = readBody(req, ['txHash'])
    const order = await findOrder(res, req.params.id)
    let hash: string
    try {
      hash = resolveTxHash(requiredString(body, 'txHash', 4_000))
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(400, 'txHash is not a Nimiq transaction hash', 'INVALID_TX')
    }
    if (order.livemode) return { status: 200, body: apiOfframpDto(await submitDeposit(order.id, hash)) }
    // In the sandbox a reported hash stands for a deposit of the exact amount, paid out in full.
    const updated = order.depositTxHash === hash ? order : await simulateSandboxDeposit(order, { txHash: hash })
    return { status: 200, body: apiOfframpDto(updated) }
  })
})

// ----------------------------------------------------------------------------------- sandbox (test keys)

v1Router.post('/sandbox/offramps/:id/deposit', async (req, res) => {
  requireTestKey(res)
  await idempotent(req, res, async () => {
    const body = readBody(req, ['nimAmount', 'payout', 'from'])
    const order = await findOrder(res, req.params.id)
    const payout = body.payout ?? 'success'
    if (payout !== 'success' && payout !== 'failed') throw new HttpError(400, 'payout must be "success" or "failed"', 'INVALID_REQUEST')
    let from: string | undefined
    if (body.from !== undefined) {
      try {
        from = normalizeAddress(requiredString(body, 'from', 60))
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw new HttpError(400, 'from is not a valid Nimiq address', 'INVALID_ADDRESS')
      }
    }
    const updated = await simulateSandboxDeposit(order, {
      nimLuna: nimAmountOf(body, 'nimAmount', false) ?? undefined,
      payoutFails: payout === 'failed',
      from,
    })
    return { status: 200, body: apiOfframpDto(updated) }
  })
})

v1Router.post('/sandbox/offramps/:id/expire', async (req, res) => {
  requireTestKey(res)
  await idempotent(req, res, async () => {
    readBody(req, [])
    return { status: 200, body: apiOfframpDto(await expireSandboxOrder(await findOrder(res, req.params.id))) }
  })
})

// ------------------------------------------------------------------------------------------- webhooks

v1Router.post('/webhooks/test', async (req, res) => {
  await idempotent(req, res, async () => {
    const body = readBody(req, ['type'])
    const { partner, livemode } = identity(res)
    return { status: 200, body: await sendTestEvent(partner, livemode, parseEventType(body.type)) }
  })
})

v1Router.get('/webhooks/events', async (req, res) => {
  const { partner, livemode } = identity(res)
  const cursor = queryString(req.query.cursor) || null
  const where = { partnerId: partner.id, livemode, ...(queryString(req.query.offrampId) ? { orderId: queryString(req.query.offrampId) } : {}) }
  if (cursor && !(await prisma.partnerWebhookEvent.findFirst({ where: { id: cursor, partnerId: partner.id, livemode }, select: { id: true } }))) {
    throw new HttpError(400, 'cursor is not valid. Pass nextCursor from the previous page.', 'INVALID_CURSOR')
  }
  const { items, nextCursor } = await listWebhookEvents(where, { limit: limitOf(req.query, 20, 100), cursor })
  res.json({ object: 'list', data: items, hasMore: nextCursor !== null, nextCursor })
})

v1Router.use((_req, res) => {
  res.status(404).json(errorBody('not_found', 'No such endpoint. See /v1/docs for the API.'))
})

v1Router.use(errorHandler)
