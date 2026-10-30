import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { Partner, PartnerApiKey, Prisma } from '@prisma/client'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'

/**
 * Partners of the off-ramp API and their secret keys. A key is `kp_test_…` or `kp_live_…` plus 40 random base62
 * characters. Only its SHA-256 and its first 16 characters (the prefix, used to find it) are stored, so the full key
 * is shown once, when it's made. Rotating makes a new key and lets the old one keep working for a grace period.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const SECRET_LENGTH = 40
const PREFIX_LENGTH = 16
const KEY_PATTERN = /^kp_(test|live)_[0-9A-Za-z]{40}$/
const LAST_USED_RESOLUTION_MS = 60_000
export const MAX_ROTATION_GRACE_HOURS = 7 * 24

const base62 = (length: number) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`

export interface PartnerIdentity {
  partner: Partner
  key: PartnerApiKey
  livemode: boolean
}

/** The partner behind a bearer key, or a 401/403 with an error code partners can act on. */
export async function authenticateApiKey(header: string | undefined): Promise<PartnerIdentity> {
  if (!header) throw new HttpError(401, 'Send your secret key as "Authorization: Bearer kp_test_…"', 'MISSING_API_KEY')
  const token = /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? ''
  if (!KEY_PATTERN.test(token)) throw new HttpError(401, 'That is not a KhalkosPay API key', 'INVALID_API_KEY')
  const key = await prisma.partnerApiKey.findUnique({ where: { prefix: token.slice(0, PREFIX_LENGTH) }, include: { partner: true } })
  const expected = Buffer.from(key?.keyHash ?? sha256('decoy'), 'hex')
  const matches = timingSafeEqual(Buffer.from(sha256(token), 'hex'), expected)
  if (!key || !matches) throw new HttpError(401, 'This API key is not valid', 'INVALID_API_KEY')
  if (key.revokedAt) throw new HttpError(401, 'This API key was revoked', 'API_KEY_REVOKED')
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'This API key was rotated and has expired', 'API_KEY_EXPIRED')
  if (key.partner.disabledAt) throw new HttpError(403, 'This partner account is disabled. Contact KhalkosPay.', 'PARTNER_DISABLED')
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.partnerApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  const { partner, ...rest } = key
  return { partner, key: rest, livemode: key.livemode }
}

// ------------------------------------------------------------------------------------------- admin

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function parseName(v: unknown) {
  const name = str(v).replace(/\s+/g, ' ')
  if (!name || name.length > 80) throw new HttpError(400, 'Give the partner a name of up to 80 characters', 'INVALID_REQUEST')
  return name
}

function parseEmail(v: unknown) {
  const email = str(v).toLowerCase()
  if (!email) return null
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'That contact email doesn’t look right', 'INVALID_EMAIL')
  return email
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https only, except for a local test receiver; no credentials in the URL. */
export function parseWebhookUrl(v: unknown): string | null {
  const raw = str(v)
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new HttpError(400, 'The webhook URL must be a full URL, like https://example.com/webhooks/khalkospay', 'INVALID_WEBHOOK_URL')
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new HttpError(400, 'The webhook URL must use https', 'INVALID_WEBHOOK_URL')
  }
  if (url.username || url.password) throw new HttpError(400, 'Leave credentials out of the webhook URL', 'INVALID_WEBHOOK_URL')
  if (raw.length > 500) throw new HttpError(400, 'Keep the webhook URL under 500 characters', 'INVALID_WEBHOOK_URL')
  return url.toString()
}

export function apiKeyDto(k: PartnerApiKey) {
  const now = Date.now()
  const status = k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt.getTime() <= now ? 'expired' : k.expiresAt ? 'expiring' : 'active'
  return {
    id: k.id,
    mode: k.livemode ? ('live' as const) : ('test' as const),
    prefix: k.prefix,
    label: k.label,
    status,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    replacedById: k.replacedById,
    createdAt: k.createdAt.toISOString(),
  }
}

type PartnerWithKeys = Partner & { apiKeys: PartnerApiKey[] }

function partnerDto(p: PartnerWithKeys, counts?: { test: number; live: number }) {
  return {
    id: p.id,
    name: p.name,
    contactEmail: p.contactEmail,
    disabled: p.disabledAt !== null,
    disabledAt: p.disabledAt?.toISOString() ?? null,
    webhooks: {
      test: { url: p.webhookUrlTest, secret: p.webhookSecretTest },
      live: { url: p.webhookUrlLive, secret: p.webhookSecretLive },
    },
    apiKeys: p.apiKeys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(apiKeyDto),
    orders: counts ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

export type AdminPartner = ReturnType<typeof partnerDto>

async function orderCounts(partnerIds: string[]) {
  const rows = await prisma.offrampOrder.groupBy({ by: ['partnerId', 'livemode'], _count: { _all: true }, where: { partnerId: { in: partnerIds } } })
  return (id: string) => ({
    test: rows.find((r) => r.partnerId === id && !r.livemode)?._count._all ?? 0,
    live: rows.find((r) => r.partnerId === id && r.livemode)?._count._all ?? 0,
  })
}

export async function listPartners() {
  const partners = await prisma.partner.findMany({ include: { apiKeys: true }, orderBy: { createdAt: 'desc' } })
  const count = await orderCounts(partners.map((p) => p.id))
  return partners.map((p) => partnerDto(p, count(p.id)))
}

async function findPartner(id: string) {
  const partner = await prisma.partner.findUnique({ where: { id }, include: { apiKeys: true } })
  if (!partner) throw new HttpError(404, 'Partner not found', 'PARTNER_NOT_FOUND')
  return partner
}

export async function getPartner(id: string) {
  const partner = await findPartner(id)
  return partnerDto(partner, (await orderCounts([id]))(id))
}

export async function createPartner(body: Record<string, unknown>) {
  const partner = await prisma.partner.create({
    data: {
      name: parseName(body.name),
      contactEmail: parseEmail(body.contactEmail),
      webhookUrlTest: parseWebhookUrl(body.webhookUrlTest),
      webhookUrlLive: parseWebhookUrl(body.webhookUrlLive),
      webhookSecretTest: newWebhookSecret(),
      webhookSecretLive: newWebhookSecret(),
    },
    include: { apiKeys: true },
  })
  return partnerDto(partner, { test: 0, live: 0 })
}

/** Changes only the fields sent. `disabled: true` stops every key at once. */
export async function updatePartner(id: string, body: Record<string, unknown>) {
  await findPartner(id)
  const data: Prisma.PartnerUpdateInput = {}
  if ('name' in body) data.name = parseName(body.name)
  if ('contactEmail' in body) data.contactEmail = parseEmail(body.contactEmail)
  if ('webhookUrlTest' in body) data.webhookUrlTest = parseWebhookUrl(body.webhookUrlTest)
  if ('webhookUrlLive' in body) data.webhookUrlLive = parseWebhookUrl(body.webhookUrlLive)
  if ('disabled' in body) {
    if (typeof body.disabled !== 'boolean') throw new HttpError(400, 'disabled must be true or false', 'INVALID_REQUEST')
    data.disabledAt = body.disabled ? new Date() : null
  }
  await prisma.partner.update({ where: { id }, data })
  return getPartner(id)
}

export async function rotateWebhookSecret(id: string, mode: unknown) {
  const livemode = parseMode(mode)
  await findPartner(id)
  await prisma.partner.update({ where: { id }, data: livemode ? { webhookSecretLive: newWebhookSecret() } : { webhookSecretTest: newWebhookSecret() } })
  return getPartner(id)
}

export function parseMode(v: unknown): boolean {
  if (v === 'live') return true
  if (v === 'test') return false
  throw new HttpError(400, 'mode must be "test" or "live"', 'INVALID_MODE')
}

async function insertKey(db: Prisma.TransactionClient, partnerId: string, livemode: boolean, label: string) {
  for (let i = 0; ; i++) {
    const key = `kp_${livemode ? 'live' : 'test'}_${base62(SECRET_LENGTH)}`
    try {
      const row = await db.partnerApiKey.create({ data: { partnerId, livemode, prefix: key.slice(0, PREFIX_LENGTH), keyHash: sha256(key), label } })
      return { key, apiKey: row }
    } catch (e) {
      // Two keys sharing their first 8 random characters: astronomically rare, so just draw again.
      if (i < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
      throw e
    }
  }
}

function parseLabel(v: unknown) {
  const label = str(v)
  if (label.length > 60) throw new HttpError(400, 'Keep the label under 60 characters', 'INVALID_REQUEST')
  return label
}

/** The full key is in the response, and nowhere else, ever again. */
export async function createApiKey(partnerId: string, body: Record<string, unknown>) {
  const livemode = parseMode(body.mode)
  await findPartner(partnerId)
  const { key, apiKey } = await prisma.$transaction((db) => insertKey(db, partnerId, livemode, parseLabel(body.label)))
  return { secret: key, apiKey: apiKeyDto(apiKey) }
}

async function findKey(partnerId: string, keyId: string) {
  const key = await prisma.partnerApiKey.findFirst({ where: { id: keyId, partnerId } })
  if (!key) throw new HttpError(404, 'API key not found', 'API_KEY_NOT_FOUND')
  return key
}

/** A new key with the same mode and label; the old one keeps working for `graceHours` (0 ends it now). */
export async function rotateApiKey(partnerId: string, keyId: string, body: Record<string, unknown>) {
  const old = await findKey(partnerId, keyId)
  if (old.revokedAt || (old.expiresAt && old.expiresAt.getTime() <= Date.now())) {
    throw new HttpError(409, 'This key no longer works, so create a new one instead', 'API_KEY_INACTIVE')
  }
  const graceHours = body.graceHours === undefined ? 24 : Number(body.graceHours)
  if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > MAX_ROTATION_GRACE_HOURS) {
    throw new HttpError(400, `graceHours must be between 0 and ${MAX_ROTATION_GRACE_HOURS}`, 'INVALID_REQUEST')
  }
  const expiresAt = new Date(Date.now() + graceHours * 3_600_000)
  const { key, apiKey } = await prisma.$transaction(async (db) => {
    const created = await insertKey(db, partnerId, old.livemode, old.label)
    const moved = await db.partnerApiKey.updateMany({
      where: { id: old.id, revokedAt: null, replacedById: null },
      data: { replacedById: created.apiKey.id, expiresAt: old.expiresAt && old.expiresAt < expiresAt ? old.expiresAt : expiresAt },
    })
    if (moved.count === 0) throw new HttpError(409, 'This key was already rotated or revoked', 'API_KEY_INACTIVE')
    return created
  })
  return { secret: key, apiKey: apiKeyDto(apiKey) }
}

export async function revokeApiKey(partnerId: string, keyId: string) {
  const key = await findKey(partnerId, keyId)
  if (key.revokedAt) return apiKeyDto(key)
  return apiKeyDto(await prisma.partnerApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } }))
}
