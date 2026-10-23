import { randomBytes } from 'node:crypto'
import { Merchant, MerchantPayment, MerchantPaymentStatus, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import {
  ChainTransaction,
  formatNim,
  getTransaction,
  giftEscrowAddress,
  listTransactions,
  normalizeAddress,
  NotPayableError,
  parseNimToLuna,
  resolvePayoutAddress,
  resolveTxHash,
  treasuryAddress,
} from './nimiq'

/**
 * Scan-to-pay for shops. A merchant's banner QR opens their pay page; the payer's wallet pays the merchant
 * directly with a memo that names the payment, so KhalkosPay only records and confirms it, never holds NIM.
 */

/** Payment memo prefix, like the gift and revive memos, so a payment nobody reported is still found on chain. */
export const MERCHANT_PAYMENT_PREFIX = 'khalkos-pay-'

const MAX_NAME_LENGTH = 60
const MAX_CATEGORY_LENGTH = 40
const MAX_DESCRIPTION_LENGTH = 160
const MAX_LOCATION_LENGTH = 80
const MAX_NOTE_LENGTH = 140
/** The app resizes logos to 256 px before upload; this leaves room for a detailed PNG. */
const MAX_LOGO_LENGTH = 200_000
/** More NIM than will ever exist, and still exact as a JavaScript number of Luna. */
const MAX_PAYMENT_LUNA = 21_000_000_000n * 100_000n

const PAYABLE: MerchantPaymentStatus[] = ['AWAITING_PAYMENT', 'EXPIRED']

// Same alphabet as gift codes: no 0/O, 1/I/L or U, so a code read off a banner can't be mistyped into another.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const CODE_LENGTH = 8
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function newCode(): string {
  return Array.from(randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Accepts `k7qm-3xpd`, `K7QM 3XPD` or `K7QM3XPD`. */
export function normalizeMerchantCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null
}

export function formatMerchantCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function text(value: unknown, field: string, max: number, required: true): string
function text(value: unknown, field: string, max: number, required?: false): string | null
function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`, 'INVALID_REQUEST')
    return null
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`, 'INVALID_REQUEST')
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`, 'INVALID_REQUEST')
  if (!trimmed && required) throw new HttpError(400, `${field} is required`, 'INVALID_REQUEST')
  return trimmed || null
}

function phoneOf(value: unknown): string | null {
  const phone = text(value, 'Phone', 24)
  if (phone && !/^\+?[\d\s().-]{6,24}$/.test(phone)) throw new HttpError(400, 'Phone can only have digits, spaces and + ( ) -', 'INVALID_REQUEST')
  return phone
}

function logoOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
    throw new HttpError(400, 'The logo must be a PNG, JPEG or WebP image', 'INVALID_LOGO')
  }
  if (value.length > MAX_LOGO_LENGTH) throw new HttpError(400, 'The logo is too large. Pick a smaller image.', 'INVALID_LOGO')
  return value
}

/**
 * Where a merchant gets paid. The signed-in wallet is a key's own account, so it can always receive. Another
 * address is checked on chain: a plain transfer to a contract (such as a Nimiq Pay HTLC wallet) is mined but
 * fails, so it's swapped for the account that owns the contract.
 */
async function payoutAddressOf(value: unknown, owner: string): Promise<string> {
  if (value === undefined || value === null || value === '') return owner
  let address: string
  try {
    address = normalizeAddress(String(value))
  } catch {
    throw new HttpError(400, "That isn't a valid Nimiq address", 'INVALID_ADDRESS')
  }
  if (address === treasuryAddress || address === giftEscrowAddress) {
    throw new HttpError(400, 'Use your own wallet address to receive payments', 'INVALID_ADDRESS')
  }
  if (address === owner) return owner
  try {
    return await resolvePayoutAddress(address)
  } catch (e) {
    if (e instanceof NotPayableError) throw new HttpError(400, "That address can't receive NIM. Use your wallet's own address.", 'NOT_PAYABLE')
    throw new HttpError(503, "We couldn't check that address right now. Try again in a moment.", 'RPC_UNAVAILABLE')
  }
}

export async function findMerchantByOwner(owner: string): Promise<Merchant | null> {
  return prisma.merchant.findUnique({ where: { ownerAddress: owner } })
}

export async function getMerchantByOwner(owner: string): Promise<Merchant> {
  const merchant = await findMerchantByOwner(owner)
  if (!merchant) throw new HttpError(404, "You haven't set up a shop yet", 'NO_MERCHANT')
  return merchant
}

/** Creates the signed-in wallet's shop, or updates it. The code (and so every printed banner) never changes. */
export async function saveMerchant(owner: string, input: Record<string, unknown>): Promise<Merchant> {
  const data = {
    name: text(input.name, 'Business name', MAX_NAME_LENGTH, true),
    category: text(input.category, 'Category', MAX_CATEGORY_LENGTH, true),
    description: text(input.description, 'Description', MAX_DESCRIPTION_LENGTH) ?? '',
    phone: phoneOf(input.phone),
    location: text(input.location, 'Location', MAX_LOCATION_LENGTH),
    logo: logoOf(input.logo),
    payoutAddress: await payoutAddressOf(input.payoutAddress, owner),
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.merchant.upsert({ where: { ownerAddress: owner }, update: data, create: { ...data, ownerAddress: owner, code: newCode() } })
    } catch (e) {
      // A code collision is astronomically rare; retry with a fresh one.
      const collided = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('code')
      if (!collided || attempt >= 4) throw e
    }
  }
}

export async function getMerchantByCode(input: string): Promise<Merchant> {
  const code = normalizeMerchantCode(input)
  const merchant = code ? await prisma.merchant.findUnique({ where: { code } }) : null
  if (!merchant) throw new HttpError(404, "We couldn't find a shop with that code", 'MERCHANT_NOT_FOUND')
  return merchant
}

/**
 * The shop behind a plain Nimiq address, for QR codes that only carry an address. Only a shop paid at its owner's
 * own signed-in wallet counts, so nobody can put their name on someone else's address.
 */
export async function getMerchantByAddress(input: string): Promise<Merchant> {
  let address: string
  try {
    address = normalizeAddress(input)
  } catch {
    throw new HttpError(400, "That isn't a valid Nimiq address", 'INVALID_ADDRESS')
  }
  const merchant = await prisma.merchant.findFirst({ where: { ownerAddress: address, payoutAddress: address } })
  if (!merchant) throw new HttpError(404, 'No KhalkosPay shop uses this address', 'MERCHANT_NOT_FOUND')
  return merchant
}

/** Starts a payment when the payer taps Pay: what they'll approve in Nimiq Pay, with a memo naming this payment. */
export async function createPayment(code: string, input: { amountNim: unknown; note?: unknown; payerAddress?: unknown }) {
  const merchant = await getMerchantByCode(code)
  let amountLuna: bigint
  try {
    amountLuna = parseNimToLuna(String(input.amountNim ?? ''))
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Invalid amount', 'INVALID_AMOUNT')
  }
  if (amountLuna <= 0n) throw new HttpError(400, 'Amount must be greater than zero', 'INVALID_AMOUNT')
  if (amountLuna > MAX_PAYMENT_LUNA) throw new HttpError(400, 'That amount is more NIM than exists', 'INVALID_AMOUNT')
  let payerAddress: string | null = null
  if (input.payerAddress !== undefined && input.payerAddress !== null && input.payerAddress !== '') {
    try {
      payerAddress = normalizeAddress(String(input.payerAddress))
    } catch {
      throw new HttpError(400, 'Connect your wallet before paying', 'INVALID_ADDRESS')
    }
  }
  const payment = await prisma.merchantPayment.create({
    data: {
      merchantId: merchant.id,
      reference: `${MERCHANT_PAYMENT_PREFIX}${randomBytes(8).toString('hex')}`,
      recipient: merchant.payoutAddress,
      amountLuna,
      note: text(input.note, 'Note', MAX_NOTE_LENGTH) ?? '',
      payerAddress,
      expiresAt: new Date(Date.now() + config.merchants.paymentTtlSeconds * 1000),
    },
    include: { merchant: true },
  })
  return payment
}

export type PaymentWithMerchant = MerchantPayment & { merchant: Merchant }

/** By id only: ids are unguessable, so the link to a receipt is what lets someone see it. */
export async function getPayment(id: string): Promise<PaymentWithMerchant> {
  const payment = UUID.test(id) ? await prisma.merchantPayment.findUnique({ where: { id }, include: { merchant: true } }) : null
  if (!payment) throw new HttpError(404, "We couldn't find that payment", 'PAYMENT_NOT_FOUND')
  return payment
}

/** The app reports the transaction Nimiq Pay sent; the server checks it on chain before calling it paid. */
export async function submitPaymentTx(id: string, hashOrSerializedTx: string): Promise<PaymentWithMerchant> {
  let hash: string
  try {
    hash = resolveTxHash(hashOrSerializedTx)
  } catch {
    throw new HttpError(400, 'That is not a valid Nimiq transaction', 'INVALID_TX')
  }
  const payment = await getPayment(id)
  if (payment.txHash === hash) return payment
  await attachTx(payment, hash)
  // Answer right away with "confirming"; the receipt page polls while the network confirms it.
  void processPayment(payment.id)
  return getPayment(id)
}

async function attachTx(payment: MerchantPayment, hash: string) {
  if (!PAYABLE.includes(payment.status) || payment.txHash) {
    throw new HttpError(409, 'This payment already has a transaction', 'PAYMENT_ALREADY_PAID')
  }
  try {
    const res = await prisma.merchantPayment.updateMany({
      where: { id: payment.id, status: payment.status, txHash: null },
      data: { status: 'CONFIRMING', txHash: hash, txSubmittedAt: new Date(), failureReason: null },
    })
    if (res.count === 0) throw new HttpError(409, 'This payment changed, please refresh', 'PAYMENT_CONFLICT')
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'This transaction is already attached to another payment', 'TX_ALREADY_USED')
    }
    throw e
  }
}

/** Address scan hook: attaches a payment whose memo names a payment the app never reported. */
export async function attachScannedPayment(tx: ChainTransaction) {
  if (!tx.success) return
  const payment = await prisma.merchantPayment.findUnique({ where: { reference: tx.data.trim() } })
  if (!payment || tx.to !== payment.recipient || payment.txHash || !PAYABLE.includes(payment.status)) return
  if (await prisma.merchantPayment.findUnique({ where: { txHash: tx.hash } })) return
  try {
    await attachTx(payment, tx.hash)
    await processPayment(payment.id)
  } catch (e) {
    console.error(`[merchants] auto-attach ${payment.id} failed:`, e instanceof Error ? e.message : e)
  }
}

const inFlight = new Set<string>()
const lastRun = new Map<string, number>()

function throttled(key: string, ms: number) {
  const last = lastRun.get(key) ?? 0
  if (Date.now() - last < ms) return true
  lastRun.set(key, Date.now())
  return false
}

export async function processPayment(id: string) {
  if (inFlight.has(id)) return
  inFlight.add(id)
  try {
    const payment = await prisma.merchantPayment.findUnique({ where: { id } })
    if (payment?.status === 'CONFIRMING' && payment.txHash) await confirmPayment(payment)
  } catch (e) {
    console.error(`[merchants] payment ${id} check failed:`, e instanceof Error ? e.message : e)
  } finally {
    inFlight.delete(id)
  }
}

/** A receipt someone is watching is checked on chain right away, not on the worker's next tick. */
export function refreshPayment(payment: MerchantPayment) {
  if (payment.status === 'CONFIRMING' && !throttled(`check:${payment.id}`, 2_000)) void processPayment(payment.id)
}

/** Same checks as gift funding and cash-out deposits: right recipient, executed, our memo, enough confirmations. */
async function confirmPayment(payment: MerchantPayment) {
  const hash = payment.txHash!
  // A transaction that doesn't check out is detached, so the real payment (or a scan) can still attach.
  const reject = (failureReason: string) =>
    prisma.merchantPayment.updateMany({
      where: { id: payment.id, status: 'CONFIRMING', txHash: hash },
      data: { status: payment.expiresAt < new Date() ? 'EXPIRED' : 'AWAITING_PAYMENT', txHash: null, txSubmittedAt: null, failureReason },
    })

  const tx = await getTransaction(hash)
  if (!tx) {
    const waited = Date.now() - (payment.txSubmittedAt?.getTime() ?? Date.now())
    if (waited > config.merchants.paymentLookupTimeoutSeconds * 1000) await reject('Your NIM transaction was not found on the Nimiq network')
    return
  }
  if (tx.to !== payment.recipient) return void (await reject("That transaction wasn't sent to this shop"))
  if (!tx.success) return void (await reject('That transaction failed on the Nimiq network'))
  if (tx.data.trim() !== payment.reference) return void (await reject('That transaction belongs to a different payment'))
  if (tx.confirmations < config.nimiq.minConfirmations) return

  await prisma.merchantPayment.updateMany({
    where: { id: payment.id, status: 'CONFIRMING', txHash: hash },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), paidFrom: tx.from, receivedLuna: tx.valueLuna, failureReason: null },
  })
}

/**
 * Safety net for payments the app never reported (closed mid-payment, lost connection): looks for our memos in the
 * recent history of each address that has unpaid payments. Addresses with a payment still open are checked every
 * 15 seconds; ones whose payments all expired, every two minutes for the lookback window.
 */
async function scanMerchantAddresses() {
  const since = new Date(Date.now() - config.merchants.scanLookbackHours * 3_600_000)
  const open = await prisma.merchantPayment.groupBy({
    by: ['recipient', 'status'],
    where: { status: { in: PAYABLE }, txHash: null, createdAt: { gte: since } },
  })
  const waiting = new Set(open.filter((r) => r.status === 'AWAITING_PAYMENT').map((r) => r.recipient))
  for (const recipient of new Set(open.map((r) => r.recipient))) {
    await scanAddress(recipient, waiting.has(recipient) ? 15_000 : 120_000).catch((e) =>
      console.error(`[merchants] scan of ${recipient} failed:`, e.message),
    )
  }
}

async function scanAddress(address: string, everyMs = 15_000) {
  if (throttled(`scan:${address}`, everyMs)) return
  const incoming = (await listTransactions(address)).filter((tx) => tx.to === address && tx.data.trim().startsWith(MERCHANT_PAYMENT_PREFIX))
  for (const tx of incoming) await attachScannedPayment(tx)
}

/** Payments a shop received, newest first. Unpaid ones are left out; the shop's addresses get a fresh scan. */
export async function listMerchantPayments(merchant: Merchant) {
  const recipients = await prisma.merchantPayment.findMany({
    where: { merchantId: merchant.id, status: { in: PAYABLE }, txHash: null },
    distinct: ['recipient'],
    select: { recipient: true },
  })
  for (const { recipient } of recipients) void scanAddress(recipient).catch((e) => console.error(`[merchants] scan of ${recipient} failed:`, e.message))

  const where: Prisma.MerchantPaymentWhereInput = { merchantId: merchant.id, status: { in: ['CONFIRMING', 'CONFIRMED'] } }
  const [payments, totals] = await Promise.all([
    prisma.merchantPayment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.merchantPayment.aggregate({ where: { merchantId: merchant.id, status: 'CONFIRMED' }, _sum: { receivedLuna: true }, _count: true }),
  ])
  return { payments, receivedLuna: totals._sum.receivedLuna ?? 0n, receivedCount: totals._count }
}

export function startMerchantWorker(intervalMs = 5_000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await scanMerchantAddresses().catch((e) => console.error('[merchants] address scan failed:', e.message))
      await prisma.merchantPayment.updateMany({
        where: { status: 'AWAITING_PAYMENT', txHash: null, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      })
      const confirming = await prisma.merchantPayment.findMany({
        where: { status: 'CONFIRMING' },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })
      for (const { id } of confirming) await processPayment(id)
    } catch (e) {
      console.error('[merchants] worker tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

/** What a payer sees before paying: who the shop is, and what KhalkosPay has checked about it. */
export function merchantDto(m: Merchant) {
  return {
    code: formatMerchantCode(m.code),
    name: m.name,
    category: m.category,
    description: m.description,
    phone: m.phone,
    location: m.location,
    logo: m.logo,
    payoutAddress: m.payoutAddress,
    /** Payments go to the wallet that signed in to create this shop, so whoever runs it controls that wallet. */
    payoutVerified: m.payoutAddress === m.ownerAddress,
    network: config.nimiq.network,
    since: m.createdAt.toISOString(),
  }
}

/** The shop owner's view of their profile. */
export function ownMerchantDto(m: Merchant) {
  return { ...merchantDto(m), ownerAddress: m.ownerAddress, updatedAt: m.updatedAt.toISOString() }
}

function amounts(p: MerchantPayment) {
  const received = p.status === 'CONFIRMED' && p.receivedLuna !== null ? p.receivedLuna : null
  return {
    nimAmount: formatNim(received ?? p.amountLuna),
    requestedNim: formatNim(p.amountLuna),
    receivedNim: received === null ? null : formatNim(received),
    /** Paid less than asked. The NIM still reached the shop; there's nothing to refund since KhalkosPay never held it. */
    underpaid: received !== null && received < p.amountLuna,
  }
}

/** The payer's receipt, served by the unguessable payment id. */
export function paymentDto(p: PaymentWithMerchant) {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    ...amounts(p),
    note: p.note,
    payerAddress: p.payerAddress,
    recipient: p.recipient,
    txHash: p.txHash,
    paidFrom: p.paidFrom,
    failureReason: p.failureReason,
    network: config.nimiq.network,
    // What to approve in Nimiq Pay, only while the payment still waits for one.
    payment:
      p.status === 'AWAITING_PAYMENT' && !p.txHash && p.expiresAt > new Date()
        ? { recipient: p.recipient, valueLuna: Number(p.amountLuna), data: p.reference }
        : null,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    merchant: merchantDto(p.merchant),
  }
}

/** One row in the shop's list of payments received. */
export function receivedPaymentDto(p: MerchantPayment) {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    ...amounts(p),
    note: p.note,
    payerAddress: p.paidFrom ?? p.payerAddress,
    txHash: p.txHash,
    createdAt: p.createdAt.toISOString(),
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
  }
}
