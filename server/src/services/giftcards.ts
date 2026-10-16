import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { GiftCard, GiftCardStatus, LedgerKind, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import {
  broadcastTransaction,
  buildTreasuryTransaction,
  canSendFromTreasury,
  ChainTransaction,
  formatNim,
  getTransaction,
  normalizeAddress,
  parseNimToLuna,
  resolveTxHash,
  treasuryAddress,
} from './nimiq'

/** Funding memo prefix; the treasury scan routes payments with this memo here instead of to the off-ramp. */
export const GIFT_REFERENCE_PREFIX = 'khalkos-gift-'
export const MIN_CODE_LENGTH = 6

const MAX_CODE_LENGTH = 64
const MAX_MESSAGE_LENGTH = 140
const SIGNED_TX_VALIDITY_MS = 150 * 60_000
const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 32 }

const FUNDING_ATTACHABLE: GiftCardStatus[] = ['AWAITING_FUNDING', 'EXPIRED']
const FUNDED: GiftCardStatus[] = ['ACTIVE', 'CLAIMING', 'CLAIMED']

interface LedgerInput {
  kind: LedgerKind
  asset: 'NIM'
  amount: bigint
  debit: string
  credit: string
  externalRef: string
}

function scryptKey(code: string, salt: Buffer, params: { N: number; r: number; p: number }, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(code, salt, keyLength, params, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/** Codes are uppercase everywhere, so the server stores and checks them that way whatever the client sends. */
function normalizeCode(code: unknown): string {
  return typeof code === 'string' ? code.normalize('NFKC').trim().toUpperCase() : ''
}

/** Stored as `scrypt$N$r$p$salt$key` so the cost can be raised later without breaking existing cards. */
async function hashRedeemCode(code: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptKey(code, salt, SCRYPT, SCRYPT.keyLength)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

async function verifyRedeemCode(code: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return false
  const expected = Buffer.from(key, 'base64')
  const actual = await scryptKey(code, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) }, expected.length)
  return timingSafeEqual(actual, expected)
}

function requireEscrow(): string {
  if (!treasuryAddress || !canSendFromTreasury) {
    throw new HttpError(503, 'Gift cards are not available on this server yet', 'GIFTS_NOT_CONFIGURED')
  }
  return treasuryAddress
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`, 'INVALID_REQUEST')
  const trimmed = value.trim()
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`, 'INVALID_REQUEST')
  return trimmed || null
}

export async function createCard(input: {
  senderAddress: unknown
  nimAmount: unknown
  redeemCode: unknown
  message?: unknown
  template?: unknown
  recipientEmail?: unknown
  anonymous?: unknown
}): Promise<GiftCard> {
  requireEscrow()
  let senderAddress: string
  try {
    senderAddress = normalizeAddress(String(input.senderAddress ?? ''))
  } catch {
    throw new HttpError(400, 'Connect your wallet before creating a gift', 'INVALID_ADDRESS')
  }
  let amountLuna: bigint
  try {
    amountLuna = parseNimToLuna(String(input.nimAmount ?? ''))
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Invalid amount', 'INVALID_AMOUNT')
  }
  if (amountLuna <= 0n) throw new HttpError(400, 'Amount must be greater than zero', 'INVALID_AMOUNT')

  const code = normalizeCode(input.redeemCode)
  if (code.length < MIN_CODE_LENGTH) {
    throw new HttpError(400, `The secret code needs at least ${MIN_CODE_LENGTH} characters`, 'WEAK_CODE')
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw new HttpError(400, `The secret code can be at most ${MAX_CODE_LENGTH} characters`, 'INVALID_REQUEST')
  }
  const template = optionalString(input.template, 'template', 32) ?? 'default'
  if (!/^[a-z0-9_-]+$/.test(template)) throw new HttpError(400, 'Unknown gift design', 'INVALID_REQUEST')
  const recipientEmail = optionalString(input.recipientEmail, 'recipientEmail', 254)
  if (recipientEmail && !/^[^\s@]+@[^\s@]+$/.test(recipientEmail)) {
    throw new HttpError(400, 'Recipient email looks invalid', 'INVALID_REQUEST')
  }

  const data = {
    reference: `${GIFT_REFERENCE_PREFIX}${randomBytes(8).toString('hex')}`,
    amountLuna,
    message: optionalString(input.message, 'message', MAX_MESSAGE_LENGTH) ?? '',
    redeemCodeHash: await hashRedeemCode(code),
    template,
    senderAddress,
    recipientEmail,
    anonymous: input.anonymous === true,
    expiresAt: new Date(Date.now() + config.gifts.fundingTtlSeconds * 1000),
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.giftCard.create({ data: { ...data, shareCode: newShareCode() } })
    } catch (e) {
      // A share-code collision is astronomically rare; retry with a fresh one.
      const collided = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('shareCode')
      if (!collided || attempt >= 4) throw e
    }
  }
}

// No 0/O, 1/I/L or U, so a code read aloud or copied by hand can't be mistyped into another one.
const SHARE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const SHARE_CODE_LENGTH = 8
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function newShareCode(): string {
  return Array.from(randomBytes(SHARE_CODE_LENGTH), (b) => SHARE_ALPHABET[b % SHARE_ALPHABET.length]).join('')
}

/** Accepts `k7qm-3xpd`, `K7QM 3XPD` or `K7QM3XPD`. */
export function normalizeShareCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length === SHARE_CODE_LENGTH && [...code].every((c) => SHARE_ALPHABET.includes(c)) ? code : null
}

export function formatShareCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Finds a gift by its id (from a link) or its share code (typed into the app). Lookup only: actions take the id. */
export async function findCard(idOrCode: string): Promise<GiftCard> {
  const key = idOrCode.trim()
  if (UUID.test(key)) return getCard(key)
  const shareCode = normalizeShareCode(key)
  const card = shareCode ? await prisma.giftCard.findUnique({ where: { shareCode } }) : null
  if (!card) throw new HttpError(404, "We couldn't find a gift with that code", 'GIFT_NOT_FOUND')
  return card
}

/**
 * By id only. Claims are rate-limited per id in the URL, so they must not accept a code that could be
 * spelled several ways to get fresh attempts.
 */
export async function getCard(id: string): Promise<GiftCard> {
  const card = UUID.test(id) ? await prisma.giftCard.findUnique({ where: { id } }) : null
  if (!card) throw new HttpError(404, "This gift link doesn't exist", 'GIFT_NOT_FOUND')
  return card
}

export async function submitFunding(id: string, hashOrSerializedTx: string): Promise<GiftCard> {
  let hash: string
  try {
    hash = resolveTxHash(hashOrSerializedTx)
  } catch {
    throw new HttpError(400, 'That is not a valid Nimiq transaction', 'INVALID_TX')
  }
  const card = await getCard(id)
  if (card.fundingTxHash === hash) return card
  return attachFunding(card, hash)
}

async function attachFunding(card: GiftCard, hash: string): Promise<GiftCard> {
  if (!FUNDING_ATTACHABLE.includes(card.status) || card.fundingTxHash) {
    throw new HttpError(409, 'This gift is no longer waiting for payment', 'GIFT_NOT_AWAITING_FUNDING')
  }
  try {
    // A late payment for an expired card still funds it: there is no rate to go stale, only NIM to hold.
    const res = await prisma.giftCard.updateMany({
      where: { id: card.id, status: card.status, fundingTxHash: null },
      data: { status: 'AWAITING_FUNDING', fundingTxHash: hash, fundingSubmittedAt: new Date(), failureReason: null },
    })
    if (res.count === 0) throw new HttpError(409, 'This gift changed, please refresh', 'GIFT_CONFLICT')
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'This transaction is already attached to another gift', 'TX_ALREADY_USED')
    }
    throw e
  }
  void processCard(card.id)
  return prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })
}

/** Treasury scan hook: attaches a confirmed-or-pending payment whose memo names a gift nobody reported. */
export async function attachScannedFunding(tx: ChainTransaction) {
  if (!tx.success) return
  const card = await prisma.giftCard.findUnique({ where: { reference: tx.data.trim() } })
  if (!card || card.fundingTxHash || !FUNDING_ATTACHABLE.includes(card.status)) return
  if (await prisma.giftCard.findUnique({ where: { fundingTxHash: tx.hash } })) return
  await attachFunding(card, tx.hash).catch((e) => console.error(`[gifts] auto-attach ${card.id} failed:`, e.message))
}

function notClaimable(card: GiftCard): HttpError {
  switch (card.status) {
    case 'AWAITING_FUNDING':
      return new HttpError(409, "This gift isn't funded yet. Ask the sender to finish paying for it.", 'GIFT_NOT_FUNDED')
    case 'EXPIRED':
      return new HttpError(409, 'This gift expired before the sender paid for it', 'GIFT_EXPIRED')
    case 'REFUNDING':
    case 'REFUNDED':
      return card.reclaimedAt
        ? new HttpError(409, 'The sender took this gift back', 'GIFT_RECLAIMED')
        : new HttpError(409, 'This gift was cancelled and the NIM returned to the sender', 'GIFT_REFUNDED')
    default:
      return new HttpError(409, 'This gift has already been claimed', 'ALREADY_CLAIMED')
  }
}

/** Every gift a wallet sent or paid for, newest first; unpaid ones that expired are left out. */
export async function listSenderCards(address: string): Promise<GiftCard[]> {
  return prisma.giftCard.findMany({
    where: { OR: [{ senderAddress: address }, { fundedFrom: address }], NOT: { status: 'EXPIRED', fundingTxHash: null } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

function notReclaimable(card: GiftCard): HttpError {
  switch (card.status) {
    case 'AWAITING_FUNDING':
      return new HttpError(409, "This gift isn't paid for yet, so there's nothing to take back. Unpaid gifts expire on their own.", 'GIFT_NOT_FUNDED')
    case 'EXPIRED':
      return new HttpError(409, 'This gift expired before it was paid for', 'GIFT_EXPIRED')
    case 'REFUNDING':
    case 'REFUNDED':
      return new HttpError(409, 'The NIM for this gift has already gone back to you', 'GIFT_REFUNDED')
    default:
      return new HttpError(409, "This gift has already been claimed, so it can't be taken back", 'ALREADY_CLAIMED')
  }
}

/**
 * The sender takes an unclaimed gift back. It is the same conditional move out of ACTIVE that a claim
 * makes, so a claim and a reclaim can never both win; the NIM always returns to the address that paid.
 */
export async function reclaimCard(id: string, address: string): Promise<GiftCard> {
  const card = await getCard(id)
  if (address !== card.senderAddress && address !== card.fundedFrom) {
    throw new HttpError(403, 'Only the wallet that sent this gift can take it back', 'NOT_SENDER')
  }
  if (card.status !== 'ACTIVE') throw notReclaimable(card)
  const reclaiming = await transition(card, 'REFUNDING', { reclaimedAt: new Date(), failureReason: null })
  if (!reclaiming) throw notReclaimable(await getCard(id))
  await processCard(reclaiming.id)
  return getCard(reclaiming.id)
}

export async function claimCard(id: string, input: { redeemCode: unknown; claimerAddress: unknown }): Promise<GiftCard> {
  const card = await getCard(id)
  if (card.status !== 'ACTIVE') throw notClaimable(card)
  let claimerAddress: string
  try {
    claimerAddress = normalizeAddress(String(input.claimerAddress ?? ''))
  } catch {
    throw new HttpError(400, 'Connect your Nimiq wallet to receive this gift', 'INVALID_ADDRESS')
  }
  if (claimerAddress === treasuryAddress) throw new HttpError(400, 'Choose your own wallet to receive this gift', 'INVALID_ADDRESS')
  const code = normalizeCode(input.redeemCode)
  if (!code || !(await verifyRedeemCode(code, card.redeemCodeHash))) {
    throw new HttpError(403, "That code doesn't match this gift", 'WRONG_CODE')
  }

  const claiming = await transition(card, 'CLAIMING', { claimerAddress, failureReason: null })
  if (!claiming) throw notClaimable(await getCard(id))
  await processCard(claiming.id)
  return getCard(claiming.id)
}

/**
 * Moves a card between states only if nobody else moved it first; `guard` pins the exact
 * transaction the decision was based on. The optional ledger entry commits atomically.
 */
async function transition(
  card: GiftCard,
  to: GiftCardStatus,
  data: Prisma.GiftCardUpdateManyMutationInput = {},
  ledger?: LedgerInput,
  guard: Prisma.GiftCardWhereInput = {},
): Promise<GiftCard | null> {
  const moved = await prisma.$transaction(async (db) => {
    const res = await db.giftCard.updateMany({ where: { ...guard, id: card.id, status: card.status }, data: { ...data, status: to } })
    if (res.count === 0) return false
    if (ledger) await db.ledgerEntry.create({ data: { ...ledger, giftCardId: card.id } })
    return true
  })
  return moved ? prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } }) : null
}

const inFlight = new Set<string>()
const lastPoll = new Map<string, number>()

function throttled(key: string, ms: number) {
  const last = lastPoll.get(key) ?? 0
  if (Date.now() - last < ms) return true
  lastPoll.set(key, Date.now())
  return false
}

export async function processCard(id: string) {
  if (inFlight.has(id)) return
  inFlight.add(id)
  try {
    const card = await prisma.giftCard.findUnique({ where: { id } })
    if (!card) return
    switch (card.status) {
      case 'AWAITING_FUNDING':
        if (card.fundingTxHash) await confirmFunding(card)
        return
      case 'CLAIMING':
        return await advancePayout(card, 'claim')
      case 'REFUNDING':
        return await advancePayout(card, 'refund')
    }
  } catch (e) {
    console.error(`[gifts] card ${id} step failed:`, e instanceof Error ? e.message : e)
  } finally {
    inFlight.delete(id)
  }
}

async function confirmFunding(card: GiftCard) {
  const hash = card.fundingTxHash!
  const reject = (failureReason: string) =>
    transition(card, 'AWAITING_FUNDING', { fundingTxHash: null, fundingSubmittedAt: null, failureReason }, undefined, { fundingTxHash: hash })

  const tx = await getTransaction(hash)
  if (!tx) {
    const waited = Date.now() - (card.fundingSubmittedAt?.getTime() ?? Date.now())
    if (waited > config.gifts.fundingLookupTimeoutSeconds * 1000) await reject('Your NIM transaction was not found on the Nimiq network')
    return
  }
  if (tx.to !== treasuryAddress) return void (await reject('That transaction was not sent to the KhalkosPay deposit address'))
  if (!tx.success) return void (await reject('That transaction failed on the Nimiq network'))
  if (tx.data.trim() !== card.reference) return void (await reject('That transaction belongs to a different gift'))
  if (tx.confirmations < config.nimiq.minConfirmations) return

  const short = tx.valueLuna < card.amountLuna
  const updated = await transition(
    card,
    short ? 'REFUNDING' : 'ACTIVE',
    {
      fundedAt: new Date(),
      fundedFrom: tx.from,
      receivedLuna: tx.valueLuna,
      failureReason: short ? `Received ${formatNim(tx.valueLuna)} NIM but this gift needs ${formatNim(card.amountLuna)} NIM` : null,
    },
    { kind: 'DEPOSIT', asset: 'NIM', amount: tx.valueLuna, debit: `nim:${tx.from}`, credit: `nim:${treasuryAddress}`, externalRef: tx.hash },
    { fundingTxHash: hash },
  )
  if (updated?.status === 'REFUNDING') await advancePayout(updated, 'refund')
}

type PayoutLeg = 'claim' | 'refund'

/** Both ways NIM leaves escrow: to the recipient on claim, or back to the payer when funding was short. */
const LEG = {
  claim: {
    from: 'CLAIMING',
    to: 'CLAIMED',
    kind: 'PAYOUT',
    recipient: (c: GiftCard) => c.claimerAddress,
    memo: (c: GiftCard) => `KhalkosPay gift ${c.reference}`,
    sent: (c: GiftCard) => ({ hash: c.claimTxHash, hex: c.claimTxHex, at: c.claimSentAt }),
    record: (hash: string | null, hex: string, at: Date) => ({ claimTxHash: hash, claimTxHex: hex, claimSentAt: at }),
    done: () => ({ claimedAt: new Date() }),
  },
  refund: {
    from: 'REFUNDING',
    to: 'REFUNDED',
    kind: 'REFUND',
    recipient: (c: GiftCard) => c.fundedFrom,
    memo: (c: GiftCard) => `refund ${c.reference}`,
    sent: (c: GiftCard) => ({ hash: c.refundTxHash, hex: c.refundTxHex, at: c.refundSentAt }),
    record: (hash: string | null, hex: string, at: Date) => ({ refundTxHash: hash, refundTxHex: hex, refundSentAt: at }),
    done: () => ({}),
  },
} as const

/**
 * Signs the payout and persists hash + hex before broadcasting. The write is a compare-and-swap on
 * the previous hash, so two workers can never each sign and broadcast a different payment.
 */
async function sendPayout(card: GiftCard, leg: PayoutLeg) {
  const l = LEG[leg]
  const recipient = l.recipient(card)
  if (!recipient || !card.receivedLuna) throw new Error(`card ${card.id} has nothing to ${leg}`)
  const { hash, hex } = await buildTreasuryTransaction(recipient, card.receivedLuna, l.memo(card))
  const previous = l.sent(card).hash
  const saved = await prisma.giftCard.updateMany({
    where: { id: card.id, status: l.from, ...(leg === 'claim' ? { claimTxHash: previous } : { refundTxHash: previous }) },
    data: l.record(hash, hex, new Date()),
  })
  if (saved.count === 0) return
  lastPoll.set(`${leg}:${card.id}`, Date.now())
  await broadcastTransaction(hex).catch((e) => console.error(`[gifts] ${leg} broadcast for ${card.id} failed:`, e.message))
}

async function advancePayout(card: GiftCard, leg: PayoutLeg) {
  const l = LEG[leg]
  const sent = l.sent(card)
  if (!sent.hash || !sent.hex || !sent.at) return sendPayout(card, leg)
  const tx = await getTransaction(sent.hash)
  if (tx?.success && tx.confirmations >= 1) {
    await transition(
      card,
      l.to,
      l.done(),
      {
        kind: l.kind,
        asset: 'NIM',
        amount: card.receivedLuna!,
        debit: `nim:${treasuryAddress}`,
        credit: `nim:${l.recipient(card)}`,
        externalRef: tx.hash,
      },
      leg === 'claim' ? { claimTxHash: tx.hash } : { refundTxHash: tx.hash },
    )
    return
  }
  // A signed tx is only valid for ~2h; past that window it can never land, so re-signing is safe.
  // A failed one already landed without moving NIM; retry at most once a minute.
  const stale = Date.now() - sent.at.getTime() > SIGNED_TX_VALIDITY_MS
  if (stale || (tx && !tx.success)) {
    if (!throttled(`${leg}:${card.id}`, 60_000)) await sendPayout(card, leg)
    return
  }
  if (!tx && !throttled(`${leg}:${card.id}`, 60_000)) {
    await broadcastTransaction(sent.hex).catch(() => {})
  }
}

export function startGiftCardWorker(intervalMs = 5_000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await prisma.giftCard.updateMany({
        where: { status: 'AWAITING_FUNDING', fundingTxHash: null, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      })
      const work: Prisma.GiftCardWhereInput[] = [{ status: 'AWAITING_FUNDING', fundingTxHash: { not: null } }]
      if (canSendFromTreasury) work.push({ status: { in: ['CLAIMING', 'REFUNDING'] } })
      const pending = await prisma.giftCard.findMany({
        where: { OR: work },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })
      for (const { id } of pending) await processCard(id)
    } catch (e) {
      console.error('[gifts] worker tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

export function giftConfigDto() {
  return {
    enabled: Boolean(treasuryAddress && canSendFromTreasury),
    network: config.nimiq.network,
    minCodeLength: MIN_CODE_LENGTH,
    fundingTtlSeconds: config.gifts.fundingTtlSeconds,
  }
}

/** Public view of a card: anyone holding the link sees this, so it never includes the code hash or email. */
export function cardDto(card: GiftCard) {
  const funded = card.receivedLuna !== null && (FUNDED.includes(card.status) || card.reclaimedAt !== null)
  return {
    id: card.id,
    shareCode: card.shareCode ? formatShareCode(card.shareCode) : null,
    status: card.status,
    nimAmount: formatNim(funded ? card.receivedLuna! : card.amountLuna),
    message: card.message,
    template: card.template,
    senderAddress: card.anonymous ? null : (card.fundedFrom ?? card.senderAddress),
    network: config.nimiq.network,
    confirming: card.status === 'AWAITING_FUNDING' && card.fundingTxHash !== null,
    funding:
      card.status === 'AWAITING_FUNDING' && !card.fundingTxHash && treasuryAddress
        ? { recipient: treasuryAddress, valueLuna: Number(card.amountLuna), data: card.reference }
        : null,
    // The funding tx names the sender on-chain, so anonymous gifts keep it private.
    fundingTxHash: card.anonymous ? null : card.fundingTxHash,
    claimerAddress: card.claimerAddress,
    claimTxHash: card.status === 'CLAIMING' || card.status === 'CLAIMED' ? card.claimTxHash : null,
    refundTxHash: card.status === 'REFUNDING' || card.status === 'REFUNDED' ? card.refundTxHash : null,
    failureReason: card.failureReason,
    expiresAt: card.expiresAt.toISOString(),
    createdAt: card.createdAt.toISOString(),
    fundedAt: card.fundedAt?.toISOString() ?? null,
    claimedAt: card.claimedAt?.toISOString() ?? null,
    reclaimed: card.reclaimedAt !== null,
  }
}

export type GiftCardDto = ReturnType<typeof cardDto>

/** The sender's own view, only served to a wallet that proved it sent or paid for the gift. */
export function senderCardDto(card: GiftCard) {
  return {
    ...cardDto(card),
    anonymous: card.anonymous,
    recipientEmail: card.recipientEmail,
    reclaimedAt: card.reclaimedAt?.toISOString() ?? null,
  }
}
