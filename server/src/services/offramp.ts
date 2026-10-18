import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { LedgerEntry, LedgerKind, OfframpOrder, OfframpStatus, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { attachScannedFunding, GIFT_REFERENCE_PREFIX } from './giftcards'
import { attachScannedRevivalPayment, REVIVE_REFERENCE_PREFIX } from './pets'
import {
  broadcastTransaction,
  buildTreasuryTransaction,
  canSendFromTreasury,
  formatNim,
  getTransaction,
  listTransactions,
  LUNA_PER_NIM,
  normalizeAddress,
  parseNimToLuna,
  resolvePayoutAddress,
  resolveTxHash,
  treasuryAddress,
} from './nimiq'
import {
  createRecipient,
  initiateTransfer,
  listBanks,
  PaystackError,
  resolveAccount,
  TransferResult,
  TransferStatus,
  verifyTransfer,
} from './paystack'
import { getNimNgnRate } from './rates'

/** Emits 'updated' with the fresh OfframpOrder after every committed status change. */
export const orderEvents = new EventEmitter()
orderEvents.setMaxListeners(0)

const RATE_SCALE = 100_000_000n
const REFUND_VALIDITY_MS = 150 * 60_000
const FAILED_TRANSFER_STATUSES: TransferStatus[] = ['failed', 'reversed', 'abandoned', 'blocked', 'rejected']

export interface Quote {
  nimLuna: bigint
  rateNgnPerNim: number
  grossKobo: bigint
  transferFeeKobo: bigint
  feeKobo: bigint
  payoutKobo: bigint
}

interface LedgerInput {
  kind: LedgerKind
  asset: 'NIM' | 'NGN'
  amount: bigint
  debit: string
  credit: string
  externalRef: string
}

const kobo = (ngn: number) => BigInt(Math.round(ngn * 100))
const koboToNgn = (k: bigint) => Number(k) / 100

function paystackTransferFeeKobo(amountKobo: bigint) {
  if (amountKobo <= kobo(5_000)) return kobo(10)
  if (amountKobo <= kobo(50_000)) return kobo(25)
  return kobo(50)
}

export async function quoteLuna(nimLuna: bigint): Promise<Quote> {
  const rate = await getNimNgnRate()
  const rateE8 = BigInt(Math.round(rate.ngnPerNim * 1e8))
  const grossKobo = (nimLuna * rateE8 * 100n) / (LUNA_PER_NIM * RATE_SCALE)
  const serviceFeeKobo = (grossKobo * BigInt(config.offramp.feeBps) + 9_999n) / 10_000n
  const transferFeeKobo = paystackTransferFeeKobo(grossKobo)
  const net = grossKobo - serviceFeeKobo - transferFeeKobo
  const payoutKobo = net > 0n ? (net / 100n) * 100n : 0n
  return { nimLuna, rateNgnPerNim: rate.ngnPerNim, grossKobo, transferFeeKobo, feeKobo: grossKobo - payoutKobo, payoutKobo }
}

function nimNeededForPayout(payoutNgn: number, ngnPerNim: number) {
  const fee = koboToNgn(paystackTransferFeeKobo(kobo(payoutNgn)))
  const gross = (payoutNgn + fee + 1) / (1 - config.offramp.feeBps / 10_000)
  return Math.ceil(gross / ngnPerNim)
}

export function quoteDto(q: Quote) {
  const minPayoutKobo = kobo(config.offramp.minPayoutNgn)
  const maxPayoutKobo = kobo(config.offramp.maxPayoutNgn)
  return {
    nimAmount: formatNim(q.nimLuna),
    rateNgnPerNim: q.rateNgnPerNim,
    grossNgn: koboToNgn(q.grossKobo),
    serviceFeeNgn: koboToNgn(q.feeKobo - q.transferFeeKobo),
    transferFeeNgn: koboToNgn(q.transferFeeKobo),
    feeNgn: koboToNgn(q.feeKobo),
    payoutNgn: koboToNgn(q.payoutKobo),
    minNim: nimNeededForPayout(config.offramp.minPayoutNgn, q.rateNgnPerNim),
    maxNim: Math.floor((config.offramp.maxPayoutNgn / q.rateNgnPerNim) * 0.98),
    belowMinimum: q.payoutKobo < minPayoutKobo,
    aboveMaximum: q.payoutKobo > maxPayoutKobo,
  }
}

/** Testnet NIM is worth nothing, so it is never cashed out for naira. */
export const cashoutNetworkAllowed = () => config.nimiq.network === 'mainnet'

export function offrampEnabled() {
  return cashoutNetworkAllowed() && Boolean(treasuryAddress && config.paystackSecretKey)
}

function requireTreasury(): string {
  if (!cashoutNetworkAllowed()) throw new HttpError(503, 'Cash-out only works on mainnet. Testnet NIM has no value.', 'OFFRAMP_MAINNET_ONLY')
  if (!treasuryAddress) {
    throw new HttpError(503, 'Off-ramp deposit address is not configured on this server', 'OFFRAMP_NOT_CONFIGURED')
  }
  return treasuryAddress
}

export function parseAmount(nimAmount: string | number): bigint {
  try {
    const luna = parseNimToLuna(nimAmount)
    if (luna <= 0n) throw new Error('Amount must be greater than zero')
    return luna
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : 'Invalid amount', 'INVALID_AMOUNT')
  }
}

export async function verifyBankAccount(bankCode: string, rawAccountNumber: string) {
  const accountNumber = String(rawAccountNumber).replace(/\D/g, '')
  if (accountNumber.length !== 10) throw new HttpError(400, 'Account number must be 10 digits', 'INVALID_ACCOUNT_NUMBER')
  const bank = (await listBanks()).find((b) => b.code === bankCode)
  if (!bank) throw new HttpError(400, 'This bank is not supported', 'INVALID_BANK')
  const accountName = await resolveAccount(accountNumber, bank.code)
  return { bank, accountNumber, accountName }
}

export async function createOrder(input: {
  userAddress: string
  nimAmount: string | number
  bankCode: string
  accountNumber: string
  source?: 'app' | 'voice'
}): Promise<OfframpOrder> {
  requireTreasury()
  let userAddress: string
  try {
    userAddress = normalizeAddress(input.userAddress)
  } catch {
    throw new HttpError(400, 'Invalid Nimiq address', 'INVALID_ADDRESS')
  }
  const nimLuna = parseAmount(input.nimAmount)
  const q = await quoteLuna(nimLuna)
  const limits = quoteDto(q)
  if (limits.belowMinimum) {
    throw new HttpError(400, `Minimum payout is ₦${config.offramp.minPayoutNgn.toLocaleString()} (about ${limits.minNim.toLocaleString()} NIM)`, 'BELOW_MINIMUM')
  }
  if (limits.aboveMaximum) {
    throw new HttpError(400, `Maximum payout is ₦${config.offramp.maxPayoutNgn.toLocaleString()} per order`, 'ABOVE_MAXIMUM')
  }
  const { bank, accountNumber, accountName } = await verifyBankAccount(input.bankCode, input.accountNumber)

  const order = await prisma.offrampOrder.create({
    data: {
      reference: `khalkos-${randomBytes(8).toString('hex')}`,
      source: input.source ?? 'app',
      userAddress,
      nimLuna,
      rateNgnPerNim: new Prisma.Decimal(q.rateNgnPerNim.toFixed(8)),
      grossKobo: q.grossKobo,
      feeKobo: q.feeKobo,
      payoutKobo: q.payoutKobo,
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber,
      accountName,
      expiresAt: new Date(Date.now() + config.offramp.quoteTtlSeconds * 1000),
    },
  })
  orderEvents.emit('updated', order)
  return order
}

export async function getOrder(id: string) {
  const order = await prisma.offrampOrder.findUnique({ where: { id }, include: { ledger: { orderBy: { createdAt: 'asc' } } } })
  if (!order) throw new HttpError(404, 'Order not found', 'ORDER_NOT_FOUND')
  return order
}

export async function listOrders(address: string) {
  let userAddress: string
  try {
    userAddress = normalizeAddress(address)
  } catch {
    throw new HttpError(400, 'Invalid Nimiq address', 'INVALID_ADDRESS')
  }
  return prisma.offrampOrder.findMany({
    where: { userAddress, NOT: { status: 'EXPIRED', depositTxHash: null } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

export async function submitDeposit(orderId: string, hashOrSerializedTx: string): Promise<OfframpOrder> {
  let hash: string
  try {
    hash = resolveTxHash(hashOrSerializedTx)
  } catch {
    throw new HttpError(400, 'That is not a valid Nimiq transaction', 'INVALID_TX')
  }
  const order = await getOrder(orderId)
  if (order.depositTxHash === hash) return order
  return attachDeposit(order, hash)
}

const DEPOSIT_ATTACHABLE: OfframpStatus[] = ['AWAITING_DEPOSIT', 'EXPIRED', 'REJECTED']

async function attachDeposit(order: OfframpOrder, hash: string): Promise<OfframpOrder> {
  if (!DEPOSIT_ATTACHABLE.includes(order.status) || order.depositTxHash) {
    throw new HttpError(409, 'This order is no longer waiting for a deposit', 'ORDER_NOT_AWAITING_DEPOSIT')
  }
  try {
    const res = await prisma.offrampOrder.updateMany({
      where: { id: order.id, status: order.status, depositTxHash: null },
      data: { depositTxHash: hash, depositSubmittedAt: new Date(), status: 'CONFIRMING', failureReason: null },
    })
    if (res.count === 0) throw new HttpError(409, 'This order changed, please refresh', 'ORDER_CONFLICT')
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'This transaction is already attached to another order', 'TX_ALREADY_USED')
    }
    throw e
  }
  const updated = await prisma.offrampOrder.findUniqueOrThrow({ where: { id: order.id } })
  orderEvents.emit('updated', updated)
  void processOrder(updated.id)
  return updated
}

/** Moves an order between states only if nobody else moved it first; optional ledger entry commits atomically. */
async function transition(
  order: OfframpOrder,
  to: OfframpStatus,
  data: Prisma.OfframpOrderUpdateManyMutationInput = {},
  ledger?: LedgerInput,
): Promise<OfframpOrder | null> {
  const moved = await prisma.$transaction(async (db) => {
    const res = await db.offrampOrder.updateMany({ where: { id: order.id, status: order.status }, data: { ...data, status: to } })
    if (res.count === 0) return false
    if (ledger) await db.ledgerEntry.create({ data: { ...ledger, orderId: order.id } })
    return true
  })
  if (!moved) return null
  const updated = await prisma.offrampOrder.findUniqueOrThrow({ where: { id: order.id } })
  orderEvents.emit('updated', updated)
  return updated
}

const inFlight = new Set<string>()
const lastPoll = new Map<string, number>()

function throttled(key: string, ms: number) {
  const last = lastPoll.get(key) ?? 0
  if (Date.now() - last < ms) return true
  lastPoll.set(key, Date.now())
  return false
}

export async function processOrder(id: string) {
  if (inFlight.has(id)) return
  inFlight.add(id)
  try {
    const order = await prisma.offrampOrder.findUnique({ where: { id } })
    if (!order) return
    switch (order.status) {
      case 'CONFIRMING':
        return await confirmDeposit(order)
      case 'PAYING_OUT':
        return await advancePayout(order)
      case 'PAYOUT_FAILED':
        return await startRefund(order)
      case 'REFUNDING':
        return await advanceRefund(order)
    }
  } catch (e) {
    console.error(`[offramp] order ${id} step failed:`, e instanceof Error ? e.message : e)
  } finally {
    inFlight.delete(id)
  }
}

async function confirmDeposit(order: OfframpOrder) {
  const tx = await getTransaction(order.depositTxHash!)
  if (!tx) {
    const waited = Date.now() - (order.depositSubmittedAt?.getTime() ?? Date.now())
    if (waited > config.offramp.depositLookupTimeoutSeconds * 1000) {
      await transition(order, 'REJECTED', { depositTxHash: null, failureReason: 'Your NIM transaction was not found on the Nimiq network' })
    }
    return
  }
  if (tx.to !== treasuryAddress) {
    await transition(order, 'REJECTED', { depositTxHash: null, failureReason: 'That transaction was not sent to the KhalkosPay deposit address' })
    return
  }
  if (!tx.success) {
    await transition(order, 'REJECTED', { depositTxHash: null, failureReason: 'That transaction failed on the Nimiq network' })
    return
  }
  if (tx.data.trim() !== order.reference) {
    await transition(order, 'REJECTED', { depositTxHash: null, failureReason: 'That transaction belongs to a different order' })
    return
  }
  if (tx.confirmations < config.nimiq.minConfirmations) return

  const short = tx.valueLuna < order.nimLuna
  const late = tx.timestamp > order.expiresAt.getTime() + config.offramp.depositGraceSeconds * 1000
  const failureReason = short
    ? `Received ${formatNim(tx.valueLuna)} NIM but this order needs ${formatNim(order.nimLuna)} NIM`
    : late
      ? 'Your quote expired before the NIM arrived'
      : null

  const updated = await transition(
    order,
    failureReason ? 'PAYOUT_FAILED' : 'PAYING_OUT',
    { depositConfirmedAt: new Date(), depositFrom: tx.from, receivedLuna: tx.valueLuna, failureReason },
    { kind: 'DEPOSIT', asset: 'NIM', amount: tx.valueLuna, debit: `nim:${tx.from}`, credit: `nim:${treasuryAddress}`, externalRef: tx.hash },
  )
  if (!updated) return
  if (updated.status === 'PAYING_OUT') await advancePayout(updated)
  else await startRefund(updated)
}

async function advancePayout(order: OfframpOrder) {
  // No naira for testnet NIM, even for an order made before this server ran on testnet: the NIM goes back instead.
  if (!cashoutNetworkAllowed() && !order.paystackTransferCode) {
    const failed = await transition(order, 'PAYOUT_FAILED', { failureReason: 'Cash-out only works on mainnet, so your NIM is going back to you' })
    if (failed) await startRefund(failed)
    return
  }
  if (order.paystackTransferCode && throttled(`payout:${order.id}`, 20_000)) return
  try {
    let result: TransferResult
    if (!order.paystackTransferCode) {
      let recipientCode = order.paystackRecipientCode
      if (!recipientCode) {
        recipientCode = await createRecipient(order.accountName, order.accountNumber, order.bankCode)
        await prisma.offrampOrder.update({ where: { id: order.id }, data: { paystackRecipientCode: recipientCode } })
      }
      result = await initiateTransfer({
        amountKobo: order.payoutKobo,
        recipientCode,
        reference: order.reference,
        reason: `KhalkosPay: ${formatNim(order.nimLuna)} NIM off-ramp`,
      })
      await prisma.offrampOrder.update({ where: { id: order.id }, data: { paystackTransferCode: result.transferCode } })
    } else {
      result = await verifyTransfer(order.reference)
    }
    await applyTransferStatus(order.reference, result.status)
  } catch (e) {
    if (e instanceof PaystackError && e.isDefinitive && !order.paystackTransferCode) {
      const failed = await transition(order, 'PAYOUT_FAILED', { failureReason: `Bank payout failed: ${e.message}` })
      if (failed) await startRefund(failed)
      return
    }
    throw e
  }
}

export async function applyTransferStatus(reference: string, status: TransferStatus) {
  const order = await prisma.offrampOrder.findUnique({ where: { reference } })
  if (!order) return

  if (status === 'success' && order.status === 'PAYING_OUT') {
    await transition(
      order,
      'COMPLETED',
      { paidAt: new Date(), failureReason: null },
      {
        kind: 'PAYOUT',
        asset: 'NGN',
        amount: order.payoutKobo,
        debit: 'ngn:paystack-balance',
        credit: `ngn:${order.bankCode}:${order.accountNumber}`,
        externalRef: order.paystackTransferCode ?? order.reference,
      },
    )
    return
  }

  const reversedAfterSuccess = status === 'reversed' && order.status === 'COMPLETED'
  if (FAILED_TRANSFER_STATUSES.includes(status) && (order.status === 'PAYING_OUT' || reversedAfterSuccess)) {
    const failed = await transition(order, 'PAYOUT_FAILED', { failureReason: `Your bank transfer was ${status}` })
    if (failed) await startRefund(failed)
    return
  }

  if (status === 'otp' && order.status === 'PAYING_OUT' && !order.failureReason) {
    await prisma.offrampOrder.update({
      where: { id: order.id },
      data: { failureReason: 'Payout is waiting for OTP approval in Paystack. Disable transfer OTP for automatic payouts.' },
    })
  }
}

async function startRefund(order: OfframpOrder) {
  if (!canSendFromTreasury || !order.receivedLuna || !order.depositFrom) return
  const claimed = await transition(order, 'REFUNDING')
  if (claimed) await sendRefund(claimed)
}

async function sendRefund(order: OfframpOrder) {
  // A Nimiq Pay deposit comes from its HTLC wallet, which can't receive a transfer; refund the wallet that owns it.
  const target = await resolvePayoutAddress(order.depositFrom!)
  const { hash, hex } = await buildTreasuryTransaction(target, order.receivedLuna!, `refund ${order.reference}`)
  await prisma.offrampOrder.update({ where: { id: order.id }, data: { refundTxHash: hash, refundTxHex: hex, refundSentAt: new Date() } })
  lastPoll.set(`refund:${order.id}`, Date.now())
  await broadcastTransaction(hex).catch((e) => console.error(`[offramp] refund broadcast for ${order.id} failed:`, e.message))
}

async function advanceRefund(order: OfframpOrder) {
  if (!order.refundTxHash || !order.refundTxHex || !order.refundSentAt) return sendRefund(order)
  const tx = await getTransaction(order.refundTxHash)
  if (tx?.success && tx.confirmations >= 1) {
    await transition(order, 'REFUNDED', {}, {
      kind: 'REFUND',
      asset: 'NIM',
      amount: order.receivedLuna!,
      debit: `nim:${treasuryAddress}`,
      credit: `nim:${tx.to}`,
      externalRef: tx.hash,
    })
    return
  }
  // A signed tx is only valid for ~2h; past that window it can never land, so re-sign safely.
  if ((tx && !tx.success) || Date.now() - order.refundSentAt.getTime() > REFUND_VALIDITY_MS) return sendRefund(order)
  if (!tx && !throttled(`refund:${order.id}`, 60_000)) {
    await broadcastTransaction(order.refundTxHex).catch(() => {})
  }
}

/**
 * Safety net for deposits the app never reported (closed mid-flow, network drop):
 * any treasury payment whose memo matches an open order, unfunded gift or pending revive gets attached to it.
 */
async function scanTreasuryDeposits() {
  if (!treasuryAddress || throttled('scan:treasury', 15_000)) return
  const incoming = (await listTransactions(treasuryAddress)).filter(
    (tx) => tx.to === treasuryAddress && tx.data.startsWith('khalkos-'),
  )
  for (const tx of incoming) {
    if (tx.data.trim().startsWith(GIFT_REFERENCE_PREFIX)) {
      await attachScannedFunding(tx)
      continue
    }
    if (tx.data.trim().startsWith(REVIVE_REFERENCE_PREFIX)) {
      await attachScannedRevivalPayment(tx)
      continue
    }
    const order = await prisma.offrampOrder.findUnique({ where: { reference: tx.data.trim() } })
    if (!order || order.depositTxHash || !DEPOSIT_ATTACHABLE.includes(order.status)) continue
    if (await prisma.offrampOrder.findUnique({ where: { depositTxHash: tx.hash } })) continue
    await attachDeposit(order, tx.hash).catch((e) => console.error(`[offramp] auto-attach ${order.id} failed:`, e.message))
  }
}

export function startOfframpWorker(intervalMs = 5_000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await scanTreasuryDeposits().catch((e) => console.error('[offramp] treasury scan failed:', e.message))
      const cutoff = new Date(Date.now() - config.offramp.depositGraceSeconds * 1000)
      const stale = await prisma.offrampOrder.findMany({ where: { status: 'AWAITING_DEPOSIT', expiresAt: { lt: cutoff } }, take: 100 })
      for (const order of stale) await transition(order, 'EXPIRED')

      const statuses: OfframpStatus[] = ['CONFIRMING', 'PAYING_OUT', 'REFUNDING']
      if (canSendFromTreasury) statuses.push('PAYOUT_FAILED')
      const active = await prisma.offrampOrder.findMany({
        where: { status: { in: statuses } },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })
      for (const { id } of active) await processOrder(id)
    } catch (e) {
      console.error('[offramp] worker tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

function maskAccount(accountNumber: string) {
  return `••••${accountNumber.slice(-4)}`
}

export function orderDto(order: OfframpOrder & { ledger?: LedgerEntry[] }) {
  return {
    id: order.id,
    reference: order.reference,
    source: order.source,
    status: order.status,
    nimAmount: formatNim(order.nimLuna),
    receivedNim: order.receivedLuna === null ? null : formatNim(order.receivedLuna),
    payoutStarted: Boolean(order.paystackRecipientCode || order.paystackTransferCode),
    rateNgnPerNim: Number(order.rateNgnPerNim),
    grossNgn: koboToNgn(order.grossKobo),
    feeNgn: koboToNgn(order.feeKobo),
    payoutNgn: koboToNgn(order.payoutKobo),
    bankName: order.bankName,
    accountName: order.accountName,
    accountNumber: maskAccount(order.accountNumber),
    depositTxHash: order.depositTxHash,
    refundTxHash: order.status === 'REFUNDED' || order.status === 'REFUNDING' ? order.refundTxHash : null,
    failureReason: order.failureReason,
    expiresAt: order.expiresAt.toISOString(),
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    deposit:
      order.status === 'AWAITING_DEPOSIT' && treasuryAddress
        ? { recipient: treasuryAddress, valueLuna: Number(order.nimLuna), data: order.reference }
        : null,
    ledger: order.ledger?.map((e) => ({
      kind: e.kind,
      asset: e.asset,
      amount: e.asset === 'NIM' ? formatNim(e.amount) : koboToNgn(e.amount).toFixed(2),
      debit: e.debit.startsWith('ngn:') && e.kind === 'PAYOUT' ? 'Paystack balance' : e.debit,
      credit: e.kind === 'PAYOUT' ? `${order.bankName} ${maskAccount(order.accountNumber)}` : e.credit,
      externalRef: e.externalRef,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

export type OrderDto = ReturnType<typeof orderDto>
