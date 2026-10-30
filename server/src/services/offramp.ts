import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { LedgerEntry, LedgerKind, OfframpOrder, OfframpStatus, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { attachScannedFunding, GIFT_REFERENCE_PREFIX } from './giftcards'
import { notifyWebhooks, recordOrderEvents } from './partner-webhooks'
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
  NotPayableError,
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
import { randomSandboxAddress, randomSandboxHash, SANDBOX_BANKS, sandboxResolveAccount } from './sandbox'

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

/** Banks that can be paid. The sandbox (livemode false) gets a fixed list and never calls Paystack. */
export const banksFor = (livemode: boolean) => (livemode ? listBanks() : Promise.resolve(SANDBOX_BANKS))

export async function verifyBankAccount(bankCode: string, rawAccountNumber: string, livemode = true) {
  const accountNumber = String(rawAccountNumber).replace(/\D/g, '')
  if (accountNumber.length !== 10) throw new HttpError(400, 'Account number must be 10 digits', 'INVALID_ACCOUNT_NUMBER')
  const bank = (await banksFor(livemode)).find((b) => b.code === bankCode)
  if (!bank) throw new HttpError(400, 'This bank is not supported', 'INVALID_BANK')
  const accountName = livemode ? await resolveAccount(accountNumber, bank.code) : sandboxResolveAccount(accountNumber, bank.code)
  return { bank, accountNumber, accountName }
}

/** A partner's refund address: a valid Nimiq address that isn't ours. Live ones must also be able to receive NIM. */
async function parseRefundAddress(raw: string, livemode: boolean) {
  let address: string
  try {
    address = normalizeAddress(raw)
  } catch {
    throw new HttpError(400, 'refundAddress is not a valid Nimiq address', 'INVALID_REFUND_ADDRESS')
  }
  if (address === treasuryAddress) throw new HttpError(400, 'refundAddress can’t be the KhalkosPay deposit address', 'INVALID_REFUND_ADDRESS')
  if (livemode) {
    await resolvePayoutAddress(address).catch((e) => {
      if (e instanceof NotPayableError) throw new HttpError(400, `refundAddress can’t receive NIM: ${e.message}`, 'INVALID_REFUND_ADDRESS')
      throw e
    })
  }
  return address
}

export interface PartnerOrderInput {
  id: string
  livemode: boolean
  reference: string | null
  metadata: Prisma.InputJsonObject | null
  refundAddress: string | null
}

export async function createOrder(input: {
  userAddress?: string
  nimAmount: string | number
  bankCode: string
  accountNumber: string
  source?: 'app' | 'voice' | 'api'
  /** Set for orders made through /v1. A test-key order (livemode false) is simulated and never needs the treasury. */
  partner?: PartnerOrderInput
}): Promise<OfframpOrder> {
  const livemode = input.partner?.livemode ?? true
  if (livemode) requireTreasury()
  let userAddress: string | null = null
  if (input.userAddress !== undefined || !input.partner) {
    try {
      userAddress = normalizeAddress(input.userAddress ?? '')
    } catch {
      throw new HttpError(400, 'Invalid Nimiq address', 'INVALID_ADDRESS')
    }
  }
  const refundAddress = input.partner?.refundAddress ? await parseRefundAddress(input.partner.refundAddress, livemode) : null
  const nimLuna = parseAmount(input.nimAmount)
  const q = await quoteLuna(nimLuna)
  const limits = quoteDto(q)
  if (limits.belowMinimum) {
    throw new HttpError(400, `Minimum payout is ₦${config.offramp.minPayoutNgn.toLocaleString()} (about ${limits.minNim.toLocaleString()} NIM)`, 'BELOW_MINIMUM')
  }
  if (limits.aboveMaximum) {
    throw new HttpError(400, `Maximum payout is ₦${config.offramp.maxPayoutNgn.toLocaleString()} per order`, 'ABOVE_MAXIMUM')
  }
  const { bank, accountNumber, accountName } = await verifyBankAccount(input.bankCode, input.accountNumber, livemode)

  const order = await prisma.offrampOrder.create({
    data: {
      // Sandbox memos look different, and the treasury scan ignores their orders even if real NIM arrives with one.
      reference: `khalkos-${livemode ? '' : 'test-'}${randomBytes(8).toString('hex')}`,
      source: input.source ?? 'app',
      userAddress,
      livemode,
      partnerId: input.partner?.id ?? null,
      partnerReference: input.partner?.reference ?? null,
      metadata: input.partner?.metadata ?? undefined,
      refundAddress,
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
  if (!order.livemode) throw new HttpError(409, 'Sandbox orders only take simulated deposits', 'SANDBOX_ORDER')
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
    if (res.count === 0) return null
    if (ledger) await db.ledgerEntry.create({ data: { ...ledger, orderId: order.id } })
    const updated = await db.offrampOrder.findUniqueOrThrow({ where: { id: order.id } })
    // Partner webhooks are written with the change itself, so none is lost if the process dies right after.
    const events = await recordOrderEvents(db, order.status, updated)
    return { updated, events }
  })
  if (!moved) return null
  orderEvents.emit('updated', moved.updated)
  if (moved.events > 0) notifyWebhooks()
  return moved.updated
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
    if (!order.livemode) return await advanceSandbox(order)
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
        reason: `Khalkos: ${formatNim(order.nimLuna)}`,
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
  if (!order?.livemode) return

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
  if (!canSendFromTreasury || !order.receivedLuna || !(order.refundAddress || order.depositFrom)) return
  const claimed = await transition(order, 'REFUNDING')
  if (claimed) await sendRefund(claimed)
}

async function sendRefund(order: OfframpOrder) {
  // A partner's refundAddress wins: exchanges and custodial wallets send from addresses that can't take NIM back.
  // A Nimiq Pay deposit comes from its HTLC wallet, which can't receive a transfer; refund the wallet that owns it.
  const target = await resolvePayoutAddress(order.refundAddress ?? order.depositFrom!)
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
    await broadcastTransaction(order.refundTxHex).catch(() => { })
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
    if (!order?.livemode || order.depositTxHash || !DEPOSIT_ATTACHABLE.includes(order.status)) continue
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
        where: {
          OR: [
            { livemode: true, status: { in: statuses } },
            // Sandbox orders advance on timers; this picks up any a restart left behind.
            { livemode: false, status: { in: SANDBOX_ACTIVE }, updatedAt: { lt: new Date(Date.now() - config.partnerApi.sandboxStepMs) } },
          ],
        },
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

// ------------------------------------------------------------------------------------------- sandbox
// Orders made with a partner's test key go through the same states, transitions and webhooks as live ones, but every
// chain and bank step is simulated: nothing here talks to the Nimiq network or Paystack, and nothing is booked in the ledger.

const SANDBOX_ACTIVE: OfframpStatus[] = ['CONFIRMING', 'PAYING_OUT', 'PAYOUT_FAILED', 'REFUNDING']

function scheduleSandboxStep(id: string) {
  setTimeout(() => void processOrder(id), config.partnerApi.sandboxStepMs).unref()
}

function requireSandbox(order: OfframpOrder) {
  if (order.livemode) throw new HttpError(403, 'Only orders made with a test key can be simulated', 'SANDBOX_ONLY')
}

/** One simulated step, once the order has sat in its state for sandboxStepMs. */
async function advanceSandbox(order: OfframpOrder) {
  if (!SANDBOX_ACTIVE.includes(order.status)) return
  if (Date.now() - order.updatedAt.getTime() < config.partnerApi.sandboxStepMs - 50) return
  let next: OfframpOrder | null = null
  switch (order.status) {
    case 'CONFIRMING': {
      const received = order.receivedLuna ?? 0n
      const late = (order.depositSubmittedAt?.getTime() ?? Date.now()) > order.expiresAt.getTime() + config.offramp.depositGraceSeconds * 1000
      const failureReason =
        received < order.nimLuna
          ? `Received ${formatNim(received)} NIM but this order needs ${formatNim(order.nimLuna)} NIM`
          : late
            ? 'Your quote expired before the NIM arrived'
            : null
      next = await transition(order, failureReason ? 'PAYOUT_FAILED' : 'PAYING_OUT', { depositConfirmedAt: new Date(), failureReason })
      break
    }
    case 'PAYING_OUT':
      next = order.sandboxPayoutFails
        ? await transition(order, 'PAYOUT_FAILED', { failureReason: 'Your bank transfer was failed' })
        : await transition(order, 'COMPLETED', { paidAt: new Date(), failureReason: null })
      break
    case 'PAYOUT_FAILED':
      next = await transition(order, 'REFUNDING', { refundTxHash: randomSandboxHash(), refundSentAt: new Date() })
      break
    case 'REFUNDING':
      next = await transition(order, 'REFUNDED')
      break
  }
  if (next && SANDBOX_ACTIVE.includes(next.status)) scheduleSandboxStep(next.id)
}

/**
 * A pretend deposit for a sandbox order: by default the exact amount from a random sender, paid out in full.
 * A smaller amount, a payout failure, or a deposit after the order expired each end in a (simulated) refund.
 */
export async function simulateSandboxDeposit(
  order: OfframpOrder,
  input: { nimLuna?: bigint; from?: string; payoutFails?: boolean; txHash?: string },
): Promise<OfframpOrder> {
  requireSandbox(order)
  if (!DEPOSIT_ATTACHABLE.includes(order.status) || order.depositTxHash) {
    throw new HttpError(409, 'This order is no longer waiting for a deposit', 'ORDER_NOT_AWAITING_DEPOSIT')
  }
  try {
    const res = await prisma.offrampOrder.updateMany({
      where: { id: order.id, status: order.status, depositTxHash: null },
      data: {
        status: 'CONFIRMING',
        depositTxHash: input.txHash ?? randomSandboxHash(),
        depositSubmittedAt: new Date(),
        depositFrom: input.from ?? randomSandboxAddress(),
        receivedLuna: input.nimLuna ?? order.nimLuna,
        sandboxPayoutFails: input.payoutFails ?? false,
        failureReason: null,
      },
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
  scheduleSandboxStep(updated.id)
  return updated
}

/** Expires a sandbox order now, as if its quote ran out with no deposit. A deposit simulated after this is late. */
export async function expireSandboxOrder(order: OfframpOrder): Promise<OfframpOrder> {
  requireSandbox(order)
  if (order.status !== 'AWAITING_DEPOSIT') throw new HttpError(409, 'Only an order waiting for its deposit can expire', 'ORDER_NOT_AWAITING_DEPOSIT')
  const expiresAt = new Date(Date.now() - config.offramp.depositGraceSeconds * 1000 - 1000)
  const expired = await transition(order, 'EXPIRED', { expiresAt })
  if (!expired) throw new HttpError(409, 'This order changed, please refresh', 'ORDER_CONFLICT')
  return expired
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
