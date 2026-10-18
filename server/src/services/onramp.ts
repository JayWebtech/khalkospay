import { randomBytes } from 'node:crypto'
import { LedgerKind, OnrampOrder, OnrampStatus, Prisma, PrismaClient } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { BachsError, BachsEvent, bachsConfigured, createCheckout, getCheckout } from './bachs'
import { getNimPrice } from './fx'
import {
  broadcastTransaction,
  buildTreasuryTransaction,
  canSendFromTreasury,
  formatNim,
  getBalanceLuna,
  getTransaction,
  LUNA_PER_NIM,
  normalizeAddress,
  NotPayableError,
  parseNimToLuna,
  resolvePayoutAddress,
  treasuryAddress,
} from './nimiq'

/**
 * Buy NIM with local currency: quote → Bachs checkout → payment confirmed against the Bachs API → NIM paid
 * from the treasury. Orders only sell NIM the treasury can spare beyond what it already owes.
 */

export const ONRAMP_REFERENCE_PREFIX = 'khalkos-buy-'
const SIGNED_TX_VALIDITY_MS = 150 * 60_000
const INVENTORY_LOCK = 7_314_002 // pg advisory lock id: serializes "is there enough NIM?" + reserve

export interface OnrampCurrency {
  code: string
  name: string
  country: string
  decimals: number
  /** Bachs payment corridors offered, so the customer pays in exactly this currency. */
  methods: string[]
  methodLabel: string
}

export const ONRAMP_CURRENCIES: OnrampCurrency[] = [
  { code: 'NGN', name: 'Nigerian naira', country: 'Nigeria', decimals: 2, methods: ['NGN_BANK_TRANSFER', 'NGN_CARD'], methodLabel: 'Bank transfer or card' },
  { code: 'GHS', name: 'Ghanaian cedi', country: 'Ghana', decimals: 2, methods: ['MOMO_GHS'], methodLabel: 'Mobile money' },
  { code: 'KES', name: 'Kenyan shilling', country: 'Kenya', decimals: 2, methods: ['MOMO_KES'], methodLabel: 'Mobile money' },
  { code: 'UGX', name: 'Ugandan shilling', country: 'Uganda', decimals: 0, methods: ['MOMO_UGX'], methodLabel: 'Mobile money' },
  { code: 'TZS', name: 'Tanzanian shilling', country: 'Tanzania', decimals: 2, methods: ['MOMO_TZS'], methodLabel: 'Mobile money' },
  { code: 'RWF', name: 'Rwandan franc', country: 'Rwanda', decimals: 0, methods: ['MOMO_RWF'], methodLabel: 'Mobile money' },
  { code: 'XAF', name: 'Central African CFA franc', country: 'Central Africa', decimals: 0, methods: ['MOMO_XAF'], methodLabel: 'Mobile money' },
  { code: 'XOF', name: 'West African CFA franc', country: 'West Africa', decimals: 0, methods: ['MOMO_XOF'], methodLabel: 'Mobile money' },
  { code: 'ZMW', name: 'Zambian kwacha', country: 'Zambia', decimals: 2, methods: ['MOMO_ZMW'], methodLabel: 'Mobile money' },
  { code: 'MWK', name: 'Malawian kwacha', country: 'Malawi', decimals: 2, methods: ['MOMO_MWK'], methodLabel: 'Mobile money' },
  { code: 'USD', name: 'US dollar', country: 'Card, worldwide', decimals: 2, methods: ['USD_CARD'], methodLabel: 'Card' },
]

function currencyOf(code: unknown): OnrampCurrency {
  const c = ONRAMP_CURRENCIES.find((x) => x.code === String(code ?? '').toUpperCase())
  if (!c) throw new HttpError(400, 'That currency is not supported for buying NIM', 'INVALID_CURRENCY')
  return c
}

function parseFiat(currency: OnrampCurrency, raw: unknown): { text: string; value: number } {
  const str = String(raw ?? '').trim().replace(/,/g, '')
  const pattern = currency.decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${currency.decimals}})?$`)
  if (!pattern.test(str) || Number(str) <= 0) {
    throw new HttpError(400, currency.decimals === 0 ? `Enter a whole amount of ${currency.code}` : `Enter an amount of ${currency.code}`, 'INVALID_AMOUNT')
  }
  const value = Number(str)
  return { text: value.toFixed(currency.decimals), value }
}

const toMinor = (value: number, decimals: number) => BigInt(Math.round(value * 10 ** decimals))

type Db = PrismaClient | Prisma.TransactionClient

/**
 * NIM the treasury already owes: escrowed gifts, pending refunds, cash-outs in flight, and other open buys.
 * Paid buys held for review stay reserved until an operator settles them (settleOrder), since the buyer may still be owed the NIM.
 */
async function owedLuna(db: Db, now = new Date()): Promise<bigint> {
  // Gifts sit in their own escrow; only older ones, paid into the treasury before it existed, are owed from here.
  const giftsInTreasury: Prisma.GiftCardWhereInput[] = [{ escrowAddress: null }, ...(treasuryAddress ? [{ escrowAddress: treasuryAddress }] : [])]
  const [gifts, revivals, cashouts, buys] = await Promise.all([
    db.giftCard.aggregate({ _sum: { receivedLuna: true }, where: { status: { in: ['ACTIVE', 'CLAIMING', 'REFUNDING'] }, OR: giftsInTreasury } }),
    db.petRevival.aggregate({ _sum: { receivedLuna: true }, where: { status: 'REFUNDING' } }),
    db.offrampOrder.aggregate({ _sum: { receivedLuna: true }, where: { status: { in: ['PAYING_OUT', 'PAYOUT_FAILED', 'REFUNDING'] } } }),
    db.onrampOrder.aggregate({
      _sum: { nimLuna: true },
      where: { OR: [{ status: 'AWAITING_PAYMENT', checkoutExpiresAt: { gt: now } }, { status: { in: ['PAID', 'SENDING', 'NEEDS_REVIEW'] } }] },
    }),
  ])
  return (gifts._sum.receivedLuna ?? 0n) + (revivals._sum.receivedLuna ?? 0n) + (cashouts._sum.receivedLuna ?? 0n) + (buys._sum.nimLuna ?? 0n)
}

/** NIM that can be sold right now. Never negative. */
export async function availableLuna(db: Db = prisma, balance?: bigint): Promise<bigint> {
  if (!treasuryAddress) return 0n
  const held = balance ?? (await getBalanceLuna(treasuryAddress))
  const free = held - (await owedLuna(db)) - parseNimToLuna(config.onramp.reserveNim)
  return free > 0n ? free : 0n
}

/** Testnet NIM is worth nothing, so it is never sold for money. */
const salesNetworkAllowed = () => config.nimiq.network === 'mainnet'

export function onrampEnabled() {
  return salesNetworkAllowed() && Boolean(treasuryAddress && canSendFromTreasury && bachsConfigured())
}

export async function quote(currencyCode: unknown, amountRaw: unknown) {
  const currency = currencyOf(currencyCode)
  const amount = parseFiat(currency, amountRaw)
  const { fiatPerNim, usdPerNim } = await getNimPrice(currency.code)
  const keep = (10_000 - config.onramp.feeBps) / 10_000
  // The epsilon keeps float noise (e.g. 306249999.99999994) from shaving a luna off a round amount.
  const nimLuna = BigInt(Math.floor((amount.value / fiatPerNim) * keep * Number(LUNA_PER_NIM) + 1e-6))
  const usd = (amount.value / fiatPerNim) * usdPerNim
  const fiatFor = (usdAmount: number) => (usdAmount / usdPerNim) * fiatPerNim
  const available = onrampEnabled() ? await availableLuna() : 0n
  // Most fiat this customer could spend given the NIM on hand, after the fee.
  const maxByStock = (Number(available) / Number(LUNA_PER_NIM)) * fiatPerNim / keep
  return {
    currency,
    amount,
    nimLuna,
    fiatPerNim,
    usdPerNim,
    feeFiat: amount.value * (config.onramp.feeBps / 10_000),
    minFiat: fiatFor(config.onramp.minUsd),
    maxFiat: Math.min(fiatFor(config.onramp.maxUsd), maxByStock),
    availableLuna: available,
    belowMinimum: usd < config.onramp.minUsd,
    aboveMaximum: usd > config.onramp.maxUsd,
    exceedsStock: nimLuna > available,
  }
}

// Small tolerances so float noise (1600.0000000000002) doesn't turn a round limit into 1600.01.
const roundUp = (n: number, decimals: number) => Math.ceil(n * 10 ** decimals - 1e-6) / 10 ** decimals
const roundDown = (n: number, decimals: number) => Math.floor(n * 10 ** decimals + 1e-6) / 10 ** decimals

export function quoteDto(q: Awaited<ReturnType<typeof quote>>) {
  const d = q.currency.decimals
  return {
    currency: q.currency.code,
    amount: q.amount.text,
    nimAmount: formatNim(q.nimLuna),
    fiatPerNim: q.fiatPerNim,
    feePercent: config.onramp.feeBps / 100,
    feeAmount: q.feeFiat.toFixed(d),
    minAmount: roundUp(q.minFiat, d).toFixed(d),
    maxAmount: roundDown(Math.max(0, q.maxFiat), d).toFixed(d),
    availableNim: formatNim(q.availableLuna),
    belowMinimum: q.belowMinimum,
    aboveMaximum: q.aboveMaximum,
    exceedsStock: q.exceedsStock,
  }
}

function requireOnramp() {
  if (!salesNetworkAllowed()) throw new HttpError(503, 'Buying NIM only works on mainnet. Testnet NIM has no value.', 'ONRAMP_MAINNET_ONLY')
  if (!onrampEnabled()) throw new HttpError(503, "Buying NIM isn't available on this server yet", 'ONRAMP_NOT_CONFIGURED')
}

function successUrl(orderId: string) {
  return config.miniAppUrl ? `https://${config.miniAppUrl}/buy/${orderId}` : undefined
}

export async function createOrder(input: { address: unknown; currency: unknown; amount: unknown }): Promise<OnrampOrder> {
  requireOnramp()
  let walletAddress: string
  try {
    walletAddress = normalizeAddress(String(input.address ?? ''))
  } catch {
    throw new HttpError(400, 'Connect your wallet first', 'INVALID_ADDRESS')
  }
  let payoutAddress: string
  try {
    payoutAddress = await resolvePayoutAddress(walletAddress)
  } catch (e) {
    if (e instanceof NotPayableError) throw new HttpError(400, "That account can't receive NIM. Pick another account in your wallet.", 'NOT_PAYABLE')
    throw new HttpError(503, "We couldn't check your wallet address right now. Try again in a moment.", 'RPC_UNAVAILABLE')
  }
  const q = await quote(input.currency, input.amount)
  if (q.belowMinimum) throw new HttpError(400, `The minimum is ${roundUp(q.minFiat, q.currency.decimals).toFixed(q.currency.decimals)} ${q.currency.code}`, 'BELOW_MINIMUM')
  if (q.aboveMaximum) throw new HttpError(400, `The maximum per purchase is about ${config.onramp.maxUsd} USD`, 'ABOVE_MAXIMUM')
  if (q.nimLuna <= 0n) throw new HttpError(400, 'That amount is too small to buy any NIM', 'BELOW_MINIMUM')

  const balance = await getBalanceLuna(treasuryAddress!);
  console.log("treasuryAddress", treasuryAddress);
  console.log("balance", balance);
  const reference = `${ONRAMP_REFERENCE_PREFIX}${randomBytes(8).toString('hex')}`
  const expiresAt = new Date(Date.now() + config.onramp.checkoutTtlMinutes * 60_000)

  // Check stock and reserve it in one serialized step, so two buyers can never be sold the same NIM.
  const order = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVENTORY_LOCK})`
    const available = await availableLuna(tx, balance)
    console.log(available)
    if (q.nimLuna > available) {
      throw new HttpError(409, `KhalkosPay can sell up to ${formatNim(available)} NIM right now. Try a smaller amount.`, 'NOT_ENOUGH_NIM')
    }
    return tx.onrampOrder.create({
      data: {
        reference,
        walletAddress,
        payoutAddress,
        fiatCurrency: q.currency.code,
        fiatAmount: new Prisma.Decimal(q.amount.text),
        fiatPerNim: new Prisma.Decimal(q.fiatPerNim.toFixed(12)),
        usdPerNim: new Prisma.Decimal(q.usdPerNim.toFixed(12)),
        feeBps: config.onramp.feeBps,
        nimLuna: q.nimLuna,
        checkoutExpiresAt: expiresAt,
      },
    })
  })

  try {
    const checkout = await createCheckout({
      reference,
      currency: q.currency.code,
      amount: q.amount.text,
      paymentMethodTypes: q.currency.methods,
      expiresInMinutes: config.onramp.checkoutTtlMinutes,
      successUrl: successUrl(order.id),
      cancelUrl: successUrl(order.id),
      metadata: { order_id: order.id, nim_amount: formatNim(q.nimLuna) },
    })
    return await prisma.onrampOrder.update({
      where: { id: order.id },
      data: { checkoutId: checkout.checkout_id, checkoutUrl: checkout.checkout_url ?? null, checkoutExpiresAt: new Date(checkout.expires_at) },
    })
  } catch (e) {
    // No checkout means no payment can arrive: release the reserved NIM straight away.
    await prisma.onrampOrder.update({
      where: { id: order.id },
      data: { status: 'EXPIRED', failureReason: e instanceof Error ? e.message.slice(0, 300) : 'Checkout could not be created' },
    })
    if (e instanceof BachsError && e.code === 'DEPOSIT_LIMIT_EXCEEDED') {
      const max = e.details?.max_allowed_amount
      throw new HttpError(400, max ? `The most you can pay in one go is ${max} ${q.currency.code}` : 'That amount is above the payment limit', 'DEPOSIT_LIMIT_EXCEEDED')
    }
    if (e instanceof BachsError && e.status >= 400 && e.status < 500) throw new HttpError(400, e.message, 'PAYMENT_REJECTED')
    throw new HttpError(502, 'Our payment partner is unavailable right now. Please try again shortly.', 'BACHS_UNAVAILABLE')
  }
}

export async function getOrder(id: string): Promise<OnrampOrder> {
  const order = await prisma.onrampOrder.findUnique({ where: { id } })
  if (!order) throw new HttpError(404, 'Purchase not found', 'ORDER_NOT_FOUND')
  return order
}

export async function listOrders(address: unknown) {
  let walletAddress: string
  try {
    walletAddress = normalizeAddress(String(address ?? ''))
  } catch {
    throw new HttpError(400, 'Invalid Nimiq address', 'INVALID_ADDRESS')
  }
  return prisma.onrampOrder.findMany({
    where: { walletAddress, NOT: { status: 'EXPIRED', paidAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
}

interface LedgerInput {
  kind: LedgerKind
  asset: string
  amount: bigint
  debit: string
  credit: string
  externalRef: string
}

async function transition(
  order: OnrampOrder,
  to: OnrampStatus,
  data: Prisma.OnrampOrderUpdateManyMutationInput = {},
  ledger?: LedgerInput,
  guard: Prisma.OnrampOrderWhereInput = {},
): Promise<OnrampOrder | null> {
  const moved = await prisma.$transaction(async (db) => {
    const res = await db.onrampOrder.updateMany({ where: { ...guard, id: order.id, status: order.status }, data: { ...data, status: to } })
    if (res.count === 0) return false
    if (ledger) await db.ledgerEntry.create({ data: { ...ledger, onrampOrderId: order.id } })
    return true
  })
  return moved ? prisma.onrampOrder.findUniqueOrThrow({ where: { id: order.id } }) : null
}

const PAID_CHARGE = ['succeeded', 'accepted', 'overpaid']

/**
 * Asks Bachs what happened to the checkout. Webhooks only trigger this; the API answer is what moves money,
 * so a forged or replayed event can never release NIM on its own.
 */
async function reconcile(order: OnrampOrder) {
  if (!order.checkoutId) return
  const checkout = await getCheckout(order.checkoutId)
  const chargeStatus = String(checkout.charge?.status ?? '').toLowerCase()
  const decimals = currencyOf(order.fiatCurrency).decimals
  const checkoutId = order.checkoutId
  const deposit = (currency: string, paid: number, paymentId: string | undefined): LedgerInput => ({
    kind: 'DEPOSIT',
    asset: currency,
    amount: toMinor(paid, decimals),
    debit: `${currency.toLowerCase()}:customer`,
    credit: `${currency.toLowerCase()}:bachs-balance`,
    externalRef: paymentId ?? checkoutId,
  })
  // Money arrived, but short (Bachs reports this for crypto-style partial payments): a person must decide.
  if (checkout.charge && chargeStatus === 'underpaid') {
    const charge = checkout.charge
    const currency = (charge.currency ?? order.fiatCurrency).toUpperCase()
    const paid = Number(charge.amount_paid ?? 0)
    await transition(
      order,
      'NEEDS_REVIEW',
      {
        chargeId: charge.payment_id ?? null,
        paidAmount: new Prisma.Decimal(paid.toFixed(4)),
        paidAt: new Date(),
        failureReason: `Received ${paid} ${currency} but this purchase needs ${Number(order.fiatAmount)} ${order.fiatCurrency}`,
      },
      // On the ledger too, so a pro-rata payout or a refund can be settled against it later.
      paid > 0 ? deposit(currency, paid, charge.payment_id) : undefined,
    )
    return
  }
  if (checkout.status === 'completed' || PAID_CHARGE.includes(chargeStatus)) {
    const charge = checkout.charge
    if (!charge || !PAID_CHARGE.includes(chargeStatus)) return
    const currency = (charge.currency ?? order.fiatCurrency).toUpperCase()
    const paid = Number(charge.amount_paid ?? charge.amount ?? 0)
    const due = Number(order.fiatAmount)
    const data = { chargeId: charge.payment_id ?? null, paidAmount: new Prisma.Decimal(paid.toFixed(4)), paidAt: new Date() }
    const ledger = deposit(currency, paid, charge.payment_id)
    if (currency !== order.fiatCurrency || paid + 10 ** -decimals / 2 < due) {
      await transition(order, 'NEEDS_REVIEW', { ...data, failureReason: `Received ${paid} ${currency} but this purchase needs ${due} ${order.fiatCurrency}` }, ledger)
      return
    }
    const moved = await transition(order, 'PAID', data, ledger)
    if (moved) await startPayout(moved)
    return
  }
  if ((checkout.status === 'expired' || checkout.status === 'cancelled') && order.status === 'AWAITING_PAYMENT') {
    await transition(order, 'EXPIRED', { failureReason: checkout.status === 'cancelled' ? 'The payment was cancelled' : null })
  }
}

async function startPayout(order: OnrampOrder) {
  if (!canSendFromTreasury) return
  if (!salesNetworkAllowed()) {
    await transition(order, 'NEEDS_REVIEW', { failureReason: 'Buying NIM only works on mainnet, so no NIM was sent. Refund this payment.' })
    return
  }
  // Stock was reserved at order time; this only trips if the treasury was emptied by hand meanwhile.
  const balance = await getBalanceLuna(treasuryAddress!)
  if (balance < order.nimLuna) {
    await transition(order, 'NEEDS_REVIEW', { failureReason: 'The treasury is short of NIM for this payout' })
    return
  }
  const sending = await transition(order, 'SENDING')
  if (sending) await sendPayout(sending)
}

/** Signs and persists before broadcasting, with a compare-and-swap on the previous hash (never two payouts). */
async function sendPayout(order: OnrampOrder) {
  if (!salesNetworkAllowed()) throw new Error('Buying NIM only pays out on mainnet')
  const target = await resolvePayoutAddress(order.payoutAddress)
  const { hash, hex } = await buildTreasuryTransaction(target, order.nimLuna, `KhalkosPay buy ${order.reference}`)
  const saved = await prisma.onrampOrder.updateMany({
    where: { id: order.id, status: 'SENDING', payoutTxHash: order.payoutTxHash },
    data: { payoutTxHash: hash, payoutTxHex: hex, payoutSentAt: new Date(), ...(target !== order.payoutAddress ? { payoutAddress: target } : {}) },
  })
  if (saved.count === 0) return
  lastPoll.set(`payout:${order.id}`, Date.now())
  await broadcastTransaction(hex).catch((e) => console.error(`[onramp] payout broadcast for ${order.id} failed:`, e.message))
}

async function advancePayout(order: OnrampOrder) {
  if (!order.payoutTxHash || !order.payoutTxHex || !order.payoutSentAt) return sendPayout(order)
  const tx = await getTransaction(order.payoutTxHash)
  if (tx?.success && tx.confirmations >= 1) {
    await transition(
      order,
      'COMPLETED',
      { completedAt: new Date(), failureReason: null },
      { kind: 'PAYOUT', asset: 'NIM', amount: order.nimLuna, debit: `nim:${treasuryAddress}`, credit: `nim:${tx.to}`, externalRef: tx.hash },
      { payoutTxHash: tx.hash },
    )
    return
  }
  const stale = Date.now() - order.payoutSentAt.getTime() > SIGNED_TX_VALIDITY_MS
  if (stale || (tx && !tx.success)) {
    if (!throttled(`payout:${order.id}`, 60_000)) await sendPayout(order)
    return
  }
  if (!tx && !throttled(`payout:${order.id}`, 60_000)) await broadcastTransaction(order.payoutTxHex).catch(() => { })
}

const inFlight = new Set<string>()
const recheck = new Set<string>()
const lastPoll = new Map<string, number>()

function throttled(key: string, ms: number) {
  const last = lastPoll.get(key) ?? 0
  if (Date.now() - last < ms) return true
  lastPoll.set(key, Date.now())
  return false
}

/** `force` re-checks with Bachs now (a webhook arrived) instead of waiting for the next poll. */
export async function processOrder(id: string, force = false): Promise<void> {
  if (inFlight.has(id)) {
    // A webhook arrived while another pass was reading Bachs: look again as soon as that pass ends.
    if (force) recheck.add(id)
    return
  }
  inFlight.add(id)
  try {
    const order = await prisma.onrampOrder.findUnique({ where: { id } })
    if (!order) return
    switch (order.status) {
      case 'AWAITING_PAYMENT':
        if (force || !throttled(`reconcile:${id}`, 20_000)) await reconcile(order)
        return
      case 'EXPIRED':
        // A bank transfer can land after our window closed; only a webhook makes us look again.
        if (force) await reconcile(order)
        return
      case 'PAID':
        return await startPayout(order)
      case 'SENDING':
        return await advancePayout(order)
    }
  } catch (e) {
    console.error(`[onramp] order ${id} step failed:`, e instanceof Error ? e.message : e)
  } finally {
    inFlight.delete(id)
  }
  if (recheck.delete(id)) await processOrder(id, true)
}

/** Webhook entry point: find the order, then let the Bachs API decide what happened. */
export async function handleBachsEvent(event: BachsEvent) {
  const { reference, checkout_id: checkoutId } = event.data ?? {}
  const order = reference?.startsWith(ONRAMP_REFERENCE_PREFIX)
    ? await prisma.onrampOrder.findUnique({ where: { reference } })
    : checkoutId
      ? await prisma.onrampOrder.findUnique({ where: { checkoutId } })
      : null
  if (!order) return
  await processOrder(order.id, true)
}

export function startOnrampWorker(intervalMs = 5_000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      // An order whose checkout never got created can't be paid; free its NIM.
      await prisma.onrampOrder.updateMany({
        where: { status: 'AWAITING_PAYMENT', checkoutId: null, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        data: { status: 'EXPIRED', failureReason: 'Checkout was never created' },
      })
      const statuses: OnrampStatus[] = ['AWAITING_PAYMENT']
      if (canSendFromTreasury) statuses.push('PAID', 'SENDING')
      const pending = await prisma.onrampOrder.findMany({
        where: { status: { in: statuses }, checkoutId: { not: null } },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 50,
      })
      for (const { id } of pending) await processOrder(id)
    } catch (e) {
      console.error('[onramp] worker tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

type OrderWithLedger = Prisma.OnrampOrderGetPayload<{ include: { ledger: true } }>

const withLedger = { ledger: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.OnrampOrderInclude

/** For the operator: purchases newest first, optionally in one status, with their ledger. */
export async function adminListOrders(status: unknown) {
  const statuses = Object.values(OnrampStatus) as string[]
  const wanted = String(status ?? '').trim().toUpperCase()
  if (wanted && !statuses.includes(wanted)) throw new HttpError(400, `status must be one of ${statuses.join(', ')}`, 'INVALID_STATUS')
  const orders = await prisma.onrampOrder.findMany({
    where: wanted ? { status: wanted as OnrampStatus } : {},
    include: withLedger,
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return orders.map(adminOrderDto)
}

/** The quoted NIM scaled by how much of the price arrived. Only when it arrived in the price's own currency. */
function proRataLuna(order: OrderWithLedger): bigint | null {
  const deposit = order.ledger.find((l) => l.kind === 'DEPOSIT')
  if (!deposit || deposit.asset !== order.fiatCurrency || order.paidAmount === null) return null
  const units = (d: Prisma.Decimal) => BigInt(d.mul(10_000).toFixed(0))
  const due = units(order.fiatAmount)
  const paid = units(order.paidAmount)
  return (order.nimLuna * (paid < due ? paid : due)) / due
}

export interface SettleInput {
  action?: unknown
  mode?: unknown
  note?: unknown
  refundRef?: unknown
}

/**
 * Settles a purchase held for review, by hand. "send" pays the full or pro-rata NIM through the usual
 * SENDING → payout path; "close" records that the buyer was refunded outside KhalkosPay, which frees its NIM.
 * Either one leaves NEEDS_REVIEW with a compare-and-swap, so a repeated or concurrent call can't settle twice.
 * reviewedBy records who did it, in the same update: the admin's email, or "admin-token" for the static ADMIN_TOKEN.
 */
export async function settleOrder(id: string, input: SettleInput, reviewedBy: string) {
  const { action, mode } = input
  if (action !== 'send' && action !== 'close') throw new HttpError(400, 'action must be "send" or "close"', 'INVALID_ACTION')
  if (action === 'send' && mode !== 'full' && mode !== 'pro-rata') throw new HttpError(400, 'mode must be "full" or "pro-rata"', 'INVALID_MODE')
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > 500) throw new HttpError(400, 'Keep the note under 500 characters', 'INVALID_NOTE')
  if (action === 'close' && !note) throw new HttpError(400, 'Say in note how the buyer was refunded', 'NOTE_REQUIRED')

  const order = await prisma.onrampOrder.findUnique({ where: { id }, include: withLedger })
  if (!order) throw new HttpError(404, 'Purchase not found', 'ORDER_NOT_FOUND')
  const notInReview = () => new HttpError(409, `This purchase is ${order.status === 'NEEDS_REVIEW' ? 'already being settled' : order.status}, not waiting for review`, 'NOT_IN_REVIEW')
  if (order.status !== 'NEEDS_REVIEW') throw notInReview()
  const reviewedAt = new Date()

  if (action === 'close') {
    const deposit = order.ledger.find((l) => l.kind === 'DEPOSIT')
    const refundRef = typeof input.refundRef === 'string' && input.refundRef.trim() ? input.refundRef.trim().slice(0, 200) : `manual:${order.reference}`
    // The refund reverses the deposit: what Bachs received goes back to the customer.
    const refund: LedgerInput | undefined = deposit && {
      kind: 'REFUND',
      asset: deposit.asset,
      amount: deposit.amount,
      debit: deposit.credit,
      credit: deposit.debit,
      externalRef: refundRef,
    }
    if (!(await transition(order, 'RESOLVED', { reviewedAt, reviewedBy, reviewNote: note }, refund))) throw notInReview()
  } else {
    if (!canSendFromTreasury) throw new HttpError(503, "This server can't send from the treasury (no private key)", 'TREASURY_READ_ONLY')
    if (!salesNetworkAllowed()) throw new HttpError(409, 'This server runs on testnet, where purchases are never paid in NIM. Close it as refunded instead.', 'ONRAMP_MAINNET_ONLY')
    let luna = order.nimLuna
    let summary = `Sent the full ${formatNim(luna)} NIM`
    if (mode === 'pro-rata') {
      const share = proRataLuna(order)
      if (share === null) throw new HttpError(400, `Pro-rata needs a payment in ${order.fiatCurrency}. Send the full amount or close it instead.`, 'PRO_RATA_UNAVAILABLE')
      if (share <= 0n) throw new HttpError(400, 'Too little arrived to send any NIM', 'NOTHING_TO_SEND')
      summary = `Sent ${formatNim(share)} of ${formatNim(luna)} NIM pro-rata`
      luna = share
    }
    const balance = await getBalanceLuna(treasuryAddress!)
    if (balance < luna) throw new HttpError(409, `The treasury holds ${formatNim(balance)} NIM. Top it up before sending ${formatNim(luna)} NIM.`, 'TREASURY_SHORT')
    // A pro-rata payout lowers nimLuna, which releases the rest of the reservation straight away.
    const sending = await transition(
      order,
      'SENDING',
      { nimLuna: luna, reviewedAt, reviewedBy, reviewNote: note ? `${summary}. ${note}` : summary },
      undefined,
      { payoutTxHash: null },
    )
    if (!sending) throw notInReview()
    // From here it's an ordinary payout: the worker retries and confirms it, and books the PAYOUT on the ledger.
    await sendPayout(sending).catch((e) => console.error(`[onramp] settled payout for ${id} failed, the worker will retry:`, e instanceof Error ? e.message : e))
  }
  return adminOrderDto(await prisma.onrampOrder.findUniqueOrThrow({ where: { id }, include: withLedger }))
}

export function onrampConfigDto() {
  return {
    enabled: onrampEnabled(),
    network: config.nimiq.network,
    feePercent: config.onramp.feeBps / 100,
    checkoutTtlMinutes: config.onramp.checkoutTtlMinutes,
    currencies: ONRAMP_CURRENCIES.map(({ code, name, country, decimals, methodLabel }) => ({ code, name, country, decimals, methodLabel })),
  }
}

export function orderDto(order: OnrampOrder) {
  const open = order.status === 'AWAITING_PAYMENT' && order.checkoutExpiresAt.getTime() > Date.now()
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    currency: order.fiatCurrency,
    amount: order.fiatAmount.toFixed(currencyOf(order.fiatCurrency).decimals),
    nimAmount: formatNim(order.nimLuna),
    fiatPerNim: Number(order.fiatPerNim),
    feePercent: order.feeBps / 100,
    walletAddress: order.walletAddress,
    payoutAddress: order.payoutAddress,
    checkoutUrl: open ? order.checkoutUrl : null,
    checkoutExpiresAt: order.checkoutExpiresAt.toISOString(),
    paidAmount: order.paidAmount === null ? null : order.paidAmount.toFixed(currencyOf(order.fiatCurrency).decimals),
    paidAt: order.paidAt?.toISOString() ?? null,
    payoutTxHash: order.payoutTxHash,
    completedAt: order.completedAt?.toISOString() ?? null,
    failureReason: order.failureReason,
    createdAt: order.createdAt.toISOString(),
  }
}

export type OnrampOrderDto = ReturnType<typeof orderDto>

export function adminOrderDto(order: OrderWithLedger) {
  const share = order.status === 'NEEDS_REVIEW' ? proRataLuna(order) : null
  return {
    ...orderDto(order),
    checkoutId: order.checkoutId,
    chargeId: order.chargeId,
    /** What "send" with mode "pro-rata" would pay; null when that isn't possible (e.g. paid in another currency). */
    proRataNimAmount: share === null ? null : formatNim(share),
    reviewedAt: order.reviewedAt?.toISOString() ?? null,
    reviewedBy: order.reviewedBy,
    reviewNote: order.reviewNote,
    ledger: order.ledger.map((l) => ({
      kind: l.kind,
      asset: l.asset,
      /** Smallest unit: luna for NIM, the currency's minor unit (e.g. kobo) otherwise. */
      amount: l.amount.toString(),
      debit: l.debit,
      credit: l.credit,
      externalRef: l.externalRef,
      createdAt: l.createdAt.toISOString(),
    })),
  }
}
