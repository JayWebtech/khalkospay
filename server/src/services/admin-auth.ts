import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { AdminSession, AdminUser } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'

/**
 * Email + password sign-in for the admin dashboard. A sign-in hands out a random bearer token; only its
 * SHA-256 is stored, so a leaked session table can't be replayed. Tokens carry SESSION_PREFIX so the admin
 * router can tell them apart from the static ADMIN_TOKEN.
 */

export const SESSION_PREFIX = 'kps_adm_'
export const MIN_PASSWORD_LENGTH = 12

// N = 2^15 costs ~32 MiB and tens of milliseconds per attempt: slow to brute-force, fine for a few operators.
const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 }
const LAST_USED_RESOLUTION_MS = 5 * 60_000

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keyLength)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await derive(password, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p), expected.length)
  return timingSafeEqual(key, expected)
}

// Unknown emails still pay for one scrypt run, so response time doesn't reveal which emails are admins.
const decoyHash = hashPassword(randomBytes(16).toString('hex'))

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

export interface AdminIdentity {
  via: 'session' | 'token'
  admin: { id: string; email: string; name: string } | null
  sessionId: string | null
  expiresAt: string | null
}

const adminDto = (a: AdminUser) => ({ id: a.id, email: a.email, name: a.name })

export async function login(input: { email?: unknown; password?: unknown }, meta: { ip?: string; userAgent?: string }) {
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!email || !password || email.length > 254 || password.length > 1024) {
    throw new HttpError(400, 'Enter your email and password', 'INVALID_REQUEST')
  }
  const admin = await prisma.adminUser.findUnique({ where: { email } })
  const ok = await verifyPassword(password, admin?.passwordHash ?? (await decoyHash))
  if (!admin || !ok) throw new HttpError(401, 'That email and password don’t match an admin account', 'INVALID_CREDENTIALS')

  const token = `${SESSION_PREFIX}${randomBytes(32).toString('base64url')}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + config.adminSessionHours * 3_600_000)
  const [session] = await prisma.$transaction([
    prisma.adminSession.create({
      data: {
        adminId: admin.id,
        tokenHash: tokenHash(token),
        expiresAt,
        lastUsedAt: now,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 256) ?? null,
      },
    }),
    prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: now } }),
    // Housekeeping: drop this admin's sessions that ended more than a day ago.
    prisma.adminSession.deleteMany({
      where: { adminId: admin.id, OR: [{ expiresAt: { lt: new Date(now.getTime() - 86_400_000) } }, { revokedAt: { not: null } }] },
    }),
  ])
  return { token, expiresAt: session.expiresAt.toISOString(), admin: adminDto(admin) }
}

/** The signed-in admin behind a session token, or a 401. */
export async function authenticateSession(token: string): Promise<AdminIdentity> {
  const session = await prisma.adminSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { admin: true } })
  const now = Date.now()
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) {
    throw new HttpError(401, 'Your admin session has ended. Sign in again.', 'SESSION_EXPIRED')
  }
  if (now - session.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) await touch(session)
  return { via: 'session', admin: adminDto(session.admin), sessionId: session.id, expiresAt: session.expiresAt.toISOString() }
}

async function touch(session: AdminSession) {
  await prisma.adminSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
}

export async function logout(sessionId: string) {
  await prisma.adminSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } })
}

/** Creates the admin, or resets the password of an existing one (which also signs out its sessions). */
export async function upsertAdmin(input: { email: string; password: string; name?: string }) {
  const email = normalizeEmail(input.email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL must be an email address')
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
  const passwordHash = await hashPassword(input.password)
  const existing = await prisma.adminUser.findUnique({ where: { email } })
  if (!existing) {
    return { created: true, admin: await prisma.adminUser.create({ data: { email, passwordHash, name: input.name ?? '' } }) }
  }
  const [admin] = await prisma.$transaction([
    prisma.adminUser.update({ where: { id: existing.id }, data: { passwordHash, ...(input.name ? { name: input.name } : {}) } }),
    prisma.adminSession.updateMany({ where: { adminId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ])
  return { created: false, admin }
}
