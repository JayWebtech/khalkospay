import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Request } from 'express'
import { PublicKey, Signature } from '@nimiq/core'
import { config } from '../config'
import { HttpError } from '../lib/http-error'

/**
 * Proves a caller owns a Nimiq address: the app signs a one-time challenge with the wallet
 * (mini-app SDK `sign()`), and we hand back a short-lived session token for later requests.
 */

/** Nimiq's message-signing prefix (Keyguard SignMessagePrefix.SIGNED_MESSAGE); the first byte is the prefix length. */
const SIGNED_MESSAGE_PREFIX = '\x16Nimiq Signed Message:\n'
const CHALLENGE_TTL_MS = 5 * 60_000
const SESSION_TTL_MS = 24 * 60 * 60_000
const MAX_OPEN_CHALLENGES = 10_000

interface Challenge {
  message: string
  expiresAt: number
}

const challenges = new Map<string, Challenge>()

// Sessions survive restarts when AUTH_SECRET is set; otherwise derive one from the treasury key, or fall back to per-process.
const secret = config.authSecret
  ? Buffer.from(config.authSecret)
  : config.nimiq.treasuryPrivateKey
    ? createHmac('sha256', config.nimiq.treasuryPrivateKey).update('khalkospay wallet sessions v1').digest()
    : randomBytes(32)

function pruneChallenges(now: number) {
  for (const [id, c] of challenges) if (c.expiresAt <= now) challenges.delete(id)
}

/**
 * The challenge names no wallet: Nimiq Pay signs with whichever account is active there, which can differ
 * from the one the app last listed, so the signature itself tells us who signed in.
 */
export function createChallenge() {
  const now = Date.now()
  pruneChallenges(now)
  if (challenges.size >= MAX_OPEN_CHALLENGES) throw new HttpError(503, 'Too many sign-ins right now. Try again in a minute.', 'AUTH_BUSY')
  const id = randomBytes(16).toString('hex')
  const expiresAt = now + CHALLENGE_TTL_MS
  const message = [
    'Sign in to KhalkosPay',
    '',
    `Nonce: ${randomBytes(12).toString('hex')}`,
    `Expires: ${new Date(expiresAt).toISOString()}`,
    '',
    'This proves the wallet is yours. It does not move any NIM.',
  ].join('\n')
  challenges.set(id, { message, expiresAt })
  return { challengeId: id, message, expiresAt: new Date(expiresAt).toISOString() }
}

function prefixedHash(message: Uint8Array): Uint8Array {
  return createHash('sha256')
    .update(SIGNED_MESSAGE_PREFIX)
    .update(String(message.byteLength))
    .update(message)
    .digest()
}

/**
 * The address a public key controls. It proves nothing on its own: the app uses it to name the account Nimiq Pay
 * signed with when a signature's format can't be checked here, never to sign anyone in.
 */
export function addressOfPublicKey(publicKeyHex: unknown): string {
  try {
    return PublicKey.fromHex(String(publicKeyHex ?? '').replace(/^0x/, '')).toAddress().toUserFriendlyAddress()
  } catch {
    throw new HttpError(400, 'That is not a Nimiq public key', 'INVALID_PUBLIC_KEY')
  }
}

/** Checks the Nimiq signed-message scheme first, then a raw signature over the message bytes. */
export function verifySignedMessage(message: string, publicKeyHex: string, signatureHex: string): string | null {
  try {
    const publicKey = PublicKey.fromHex(publicKeyHex.replace(/^0x/, ''))
    const signature = Signature.fromHex(signatureHex.replace(/^0x/, ''))
    const bytes = new TextEncoder().encode(message)
    const valid = publicKey.verify(signature, prefixedHash(bytes)) || publicKey.verify(signature, bytes)
    return valid ? publicKey.toAddress().toUserFriendlyAddress() : null
  } catch {
    return null
  }
}

function sign(payload: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueSession(address: string, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS
  const payload = Buffer.from(JSON.stringify({ a: address, e: expiresAt })).toString('base64url')
  return { token: `${payload}.${sign(payload)}`, address, expiresAt: new Date(expiresAt).toISOString() }
}

export function verifyChallenge(input: { challengeId: unknown; publicKey: unknown; signature: unknown }) {
  const id = String(input.challengeId ?? '')
  const challenge = challenges.get(id)
  challenges.delete(id) // one attempt per challenge, success or not
  if (!challenge || challenge.expiresAt <= Date.now()) {
    throw new HttpError(401, 'That sign-in request expired. Please try again.', 'CHALLENGE_EXPIRED')
  }
  const signer = verifySignedMessage(challenge.message, String(input.publicKey ?? ''), String(input.signature ?? ''))
  if (!signer) throw new HttpError(401, "That signature doesn't match the sign-in request", 'BAD_SIGNATURE')
  return issueSession(signer)
}

/** The wallet address a request has proven it owns, or a 401. */
export function requireWallet(req: Request): string {
  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const [payload, mac] = token.split('.')
  if (!payload || !mac) throw new HttpError(401, 'Sign in with your wallet to continue', 'AUTH_REQUIRED')
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new HttpError(401, 'Sign in with your wallet to continue', 'AUTH_REQUIRED')
  }
  let session: { a?: unknown; e?: unknown }
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new HttpError(401, 'Sign in with your wallet to continue', 'AUTH_REQUIRED')
  }
  if (typeof session.a !== 'string' || typeof session.e !== 'number' || session.e <= Date.now()) {
    throw new HttpError(401, 'Your sign-in expired. Please sign in again.', 'AUTH_EXPIRED')
  }
  return session.a
}
