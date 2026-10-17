import {
  GiftCard,
  GiftCardStatus,
  LedgerEntry,
  LedgerKind,
  MealSlot,
  OfframpOrder,
  OfframpStatus,
  OnrampStatus,
  PetRevivalStatus,
  PetStatus,
  Prisma,
} from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { formatNim, getBalanceLuna, treasuryAddress } from './nimiq'
import { availableLuna, ONRAMP_CURRENCIES } from './onramp'
import { XP_PER_LEVEL } from './pet-species'

/** Read-only views for the admin dashboard: headline stats and an activity list per feature. */

const TREND_DAYS = 30
const DAY_MS = 86_400_000
const BALANCE_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------------------------- list paging

export interface ListParams<S extends string> {
  take: number
  cursor: string | null
  status: S | null
  q: string
}

/** `?status=&q=&limit=&cursor=` → validated params. Lists are newest first; `cursor` is the last id of the previous page. */
export function listParams<S extends string>(query: Record<string, unknown>, statuses: readonly S[] = []): ListParams<S> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const limit = Number(str(query.limit) || 50)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new HttpError(400, 'limit must be a whole number from 1 to 200', 'INVALID_LIMIT')
  const status = str(query.status).toUpperCase()
  if (status && !(statuses as readonly string[]).includes(status)) {
    throw new HttpError(400, `status must be one of ${statuses.join(', ')}`, 'INVALID_STATUS')
  }
  const q = str(query.q)
  if (q.length > 120) throw new HttpError(400, 'Keep the search under 120 characters', 'INVALID_QUERY')
  return { take: limit, cursor: str(query.cursor) || null, status: (status || null) as S | null, q }
}

const pageArgs = (p: ListParams<string>) => ({
  take: p.take + 1,
  ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
})

function page<T extends { id: string }, D>(rows: T[], p: ListParams<string>, dto: (row: T) => D) {
  const more = rows.length > p.take
  const items = more ? rows.slice(0, p.take) : rows
  return { items: items.map(dto), nextCursor: more ? items[items.length - 1].id : null }
}

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const })
const iso = (d: Date | null) => d?.toISOString() ?? null
const nim = (luna: bigint | null) => (luna === null ? null : formatNim(luna))
const ngn = (kobo: bigint) => Number(kobo) / 100

// ---------------------------------------------------------------------------------------------- overview

type CountRow<K extends string> = { status: K; _count: { _all: number } }
const countsBy = <K extends string>(rows: CountRow<K>[], keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.status === k)?._count._all ?? 0])) as Record<K, number>

const sum = (rows: CountRow<string>[]) => rows.reduce((n, r) => n + r._count._all, 0)

/** Separate from overview(), so a slow Nimiq RPC never holds up the rest of the dashboard. */
export async function treasurySnapshot() {
  if (!treasuryAddress) return { address: null, balanceNim: null, availableForSaleNim: null, error: 'Treasury not configured' }
  try {
    const balance = await Promise.race([
      getBalanceLuna(treasuryAddress),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Nimiq RPC timed out')), BALANCE_TIMEOUT_MS)),
    ])
    return { address: treasuryAddress, balanceNim: formatNim(balance), availableForSaleNim: formatNim(await availableLuna(prisma, balance)), error: null }
  } catch (e) {
    return { address: treasuryAddress, balanceNim: null, availableForSaleNim: null, error: e instanceof Error ? e.message : 'Balance unavailable' }
  }
}

/** Rows per UTC day for the last TREND_DAYS days. Table names come from the fixed list below, never from input. */
async function dailyCounts(table: string, since: Date, where = Prisma.empty) {
  const rows = await prisma.$queryRaw<{ day: string; n: number }[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*)::int AS n
    FROM ${Prisma.raw(`"${table}"`)}
    WHERE "createdAt" >= ${since} ${where}
    GROUP BY 1`
  return new Map(rows.map((r) => [r.day, r.n]))
}

/** Every wallet that used any feature, and how many of them showed up for the first time in the last 7 days. */
async function walletCounts(since: Date) {
  const [row] = await prisma.$queryRaw<{ total: number; new7d: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE first_seen >= ${since})::int AS new7d
    FROM (
      SELECT address, min(at) AS first_seen FROM (
        SELECT "userAddress" AS address, "createdAt" AS at FROM "OfframpOrder"
        UNION ALL SELECT "senderAddress", "createdAt" FROM "GiftCard"
        UNION ALL SELECT "claimerAddress", "claimedAt" FROM "GiftCard" WHERE "claimerAddress" IS NOT NULL AND "claimedAt" IS NOT NULL
        UNION ALL SELECT "ownerAddress", "createdAt" FROM "Pet"
        UNION ALL SELECT "walletAddress", "createdAt" FROM "OnrampOrder"
      ) seen
      GROUP BY address
    ) wallets`
  return row ?? { total: 0, new7d: 0 }
}

export async function overview(now = new Date()) {
  const week = new Date(now.getTime() - 7 * DAY_MS)
  const fortnight = new Date(now.getTime() - 14 * DAY_MS)
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (TREND_DAYS - 1) * DAY_MS)
  const recent = { createdAt: { gte: week } }
  const prior = { createdAt: { gte: fortnight, lt: week } }

  const [
    wallets,
    giftStatus,
    giftFunded,
    giftClaimed,
    giftEscrow,
    giftEmails,
    giftWeek,
    giftPrior,
    cashStatus,
    cashReceived,
    cashPaid,
    cashVoice,
    cashWeek,
    cashPrior,
    buyStatus,
    buySent,
    buyFiat,
    buyWeek,
    buyPrior,
    petStatus,
    mealsFed,
    mealsMissed,
    mealsWeek,
    mealsPrior,
    revivalStatus,
    revivalPaid,
    ledgerKinds,
    legacyMealLogs,
    admins,
  ] = await Promise.all([
    walletCounts(week),
    prisma.giftCard.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.giftCard.aggregate({ _sum: { receivedLuna: true }, _count: { _all: true }, where: { fundedAt: { not: null } } }),
    prisma.giftCard.aggregate({ _sum: { receivedLuna: true }, where: { status: 'CLAIMED' } }),
    prisma.giftCard.aggregate({ _sum: { receivedLuna: true }, where: { status: { in: ['ACTIVE', 'CLAIMING'] } } }),
    prisma.giftCard.count({ where: { emailSentAt: { not: null } } }),
    prisma.giftCard.count({ where: recent }),
    prisma.giftCard.count({ where: prior }),
    prisma.offrampOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.offrampOrder.aggregate({ _sum: { receivedLuna: true }, where: { receivedLuna: { not: null } } }),
    prisma.offrampOrder.aggregate({ _sum: { payoutKobo: true, feeKobo: true, nimLuna: true }, _count: { _all: true }, where: { status: 'COMPLETED' } }),
    prisma.offrampOrder.count({ where: { source: 'voice' } }),
    prisma.offrampOrder.count({ where: recent }),
    prisma.offrampOrder.count({ where: prior }),
    prisma.onrampOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.onrampOrder.aggregate({ _sum: { nimLuna: true }, _count: { _all: true }, where: { status: 'COMPLETED' } }),
    prisma.onrampOrder.groupBy({ by: ['fiatCurrency'], _sum: { paidAmount: true }, _count: { _all: true }, where: { paidAt: { not: null } } }),
    prisma.onrampOrder.count({ where: recent }),
    prisma.onrampOrder.count({ where: prior }),
    prisma.pet.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.petMeal.count({ where: { fed: true } }),
    prisma.petMeal.count({ where: { fed: false } }),
    prisma.petMeal.count({ where: { fed: true, ...recent } }),
    prisma.petMeal.count({ where: { fed: true, ...prior } }),
    prisma.petRevival.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.petRevival.aggregate({ _sum: { receivedLuna: true }, where: { status: 'PAID' } }),
    prisma.ledgerEntry.groupBy({ by: ['kind'], _count: { _all: true } }),
    prisma.mealLog.count(),
    prisma.adminUser.count(),
  ])

  const [tGifts, tCash, tBuys, tMeals, tPets] = await Promise.all([
    dailyCounts('GiftCard', trendStart),
    dailyCounts('OfframpOrder', trendStart),
    dailyCounts('OnrampOrder', trendStart),
    dailyCounts('PetMeal', trendStart, Prisma.sql`AND "fed" = true`),
    dailyCounts('Pet', trendStart),
  ])
  const days = Array.from({ length: TREND_DAYS }, (_, i) => new Date(trendStart.getTime() + i * DAY_MS).toISOString().slice(0, 10))
  const series = (m: Map<string, number>) => days.map((d) => m.get(d) ?? 0)

  const decimals = (code: string) => ONRAMP_CURRENCIES.find((c) => c.code === code)?.decimals ?? 2
  const kinds = Object.values(LedgerKind)

  return {
    generatedAt: now.toISOString(),
    network: config.nimiq.network,
    treasuryAddress,
    wallets,
    admins,
    gifts: {
      total: sum(giftStatus),
      byStatus: countsBy(giftStatus, Object.values(GiftCardStatus)),
      funded: giftFunded._count._all,
      fundedNim: formatNim(giftFunded._sum.receivedLuna ?? 0n),
      claimedNim: formatNim(giftClaimed._sum.receivedLuna ?? 0n),
      inEscrowNim: formatNim(giftEscrow._sum.receivedLuna ?? 0n),
      emailsSent: giftEmails,
      last7d: giftWeek,
      prior7d: giftPrior,
    },
    cashouts: {
      total: sum(cashStatus),
      byStatus: countsBy(cashStatus, Object.values(OfframpStatus)),
      completed: cashPaid._count._all,
      nimReceived: formatNim(cashReceived._sum.receivedLuna ?? 0n),
      ngnPaidOut: ngn(cashPaid._sum.payoutKobo ?? 0n),
      ngnFees: ngn(cashPaid._sum.feeKobo ?? 0n),
      viaVoice: cashVoice,
      last7d: cashWeek,
      prior7d: cashPrior,
    },
    buys: {
      total: sum(buyStatus),
      byStatus: countsBy(buyStatus, Object.values(OnrampStatus)),
      completed: buySent._count._all,
      nimSent: formatNim(buySent._sum.nimLuna ?? 0n),
      paidByCurrency: buyFiat
        .map((r) => ({ currency: r.fiatCurrency, orders: r._count._all, amount: (r._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(decimals(r.fiatCurrency)) }))
        .sort((a, b) => b.orders - a.orders),
      needsReview: buyStatus.find((r) => r.status === 'NEEDS_REVIEW')?._count._all ?? 0,
      last7d: buyWeek,
      prior7d: buyPrior,
    },
    pets: {
      total: sum(petStatus),
      byStatus: countsBy(petStatus, Object.values(PetStatus)),
      mealsFed,
      mealsMissed,
      revivals: countsBy(revivalStatus, Object.values(PetRevivalStatus)),
      revivalNim: formatNim(revivalPaid._sum.receivedLuna ?? 0n),
      last7d: mealsWeek,
      prior7d: mealsPrior,
    },
    ledger: {
      total: ledgerKinds.reduce((n, r) => n + r._count._all, 0),
      byKind: Object.fromEntries(kinds.map((k) => [k, ledgerKinds.find((r) => r.kind === k)?._count._all ?? 0])) as Record<LedgerKind, number>,
    },
    legacyMealLogs,
    trend: {
      days,
      series: { gifts: series(tGifts), cashouts: series(tCash), buys: series(tBuys), meals: series(tMeals), pets: series(tPets) },
    },
  }
}

// ---------------------------------------------------------------------------------------------- activity lists

function giftDto(g: GiftCard) {
  return {
    id: g.id,
    reference: g.reference,
    shareCode: g.shareCode,
    status: g.status,
    amountNim: formatNim(g.amountLuna),
    receivedNim: nim(g.receivedLuna),
    template: g.template,
    message: g.message,
    senderAddress: g.senderAddress,
    senderName: g.senderName,
    anonymous: g.anonymous,
    recipientEmail: g.recipientEmail,
    emailSentAt: iso(g.emailSentAt),
    emailAttempts: g.emailAttempts,
    emailError: g.emailError,
    fundingTxHash: g.fundingTxHash,
    fundedFrom: g.fundedFrom,
    fundedAt: iso(g.fundedAt),
    claimerAddress: g.claimerAddress,
    claimTxHash: g.claimTxHash,
    claimedAt: iso(g.claimedAt),
    reclaimedAt: iso(g.reclaimedAt),
    refundTxHash: g.refundTxHash,
    failureReason: g.failureReason,
    expiresAt: g.expiresAt.toISOString(),
    createdAt: g.createdAt.toISOString(),
  }
}

export async function listGifts(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(GiftCardStatus))
  const where: Prisma.GiftCardWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.q
      ? {
          OR: [
            { id: p.q },
            { reference: contains(p.q) },
            { shareCode: contains(p.q.replace(/-/g, '')) },
            { senderAddress: contains(p.q) },
            { senderName: contains(p.q) },
            { recipientEmail: contains(p.q) },
            { claimerAddress: contains(p.q) },
          ],
        }
      : {}),
  }
  return page(await prisma.giftCard.findMany({ where, ...pageArgs(p) }), p, giftDto)
}

function cashoutDto(o: OfframpOrder & { ledger: LedgerEntry[] }) {
  return {
    id: o.id,
    reference: o.reference,
    source: o.source,
    status: o.status,
    userAddress: o.userAddress,
    nimAmount: formatNim(o.nimLuna),
    receivedNim: nim(o.receivedLuna),
    rateNgnPerNim: Number(o.rateNgnPerNim),
    grossNgn: ngn(o.grossKobo),
    feeNgn: ngn(o.feeKobo),
    payoutNgn: ngn(o.payoutKobo),
    bankName: o.bankName,
    accountName: o.accountName,
    accountNumber: o.accountNumber,
    depositTxHash: o.depositTxHash,
    depositFrom: o.depositFrom,
    depositConfirmedAt: iso(o.depositConfirmedAt),
    paystackTransferCode: o.paystackTransferCode,
    paidAt: iso(o.paidAt),
    refundTxHash: o.refundTxHash,
    refundSentAt: iso(o.refundSentAt),
    failureReason: o.failureReason,
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    ledger: o.ledger.map(ledgerLine),
  }
}

export async function listCashouts(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(OfframpStatus))
  const where: Prisma.OfframpOrderWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.q
      ? {
          OR: [
            { id: p.q },
            { reference: contains(p.q) },
            { userAddress: contains(p.q) },
            { accountName: contains(p.q) },
            { accountNumber: contains(p.q) },
            { depositTxHash: contains(p.q) },
            { paystackTransferCode: contains(p.q) },
          ],
        }
      : {}),
  }
  return page(await prisma.offrampOrder.findMany({ where, include: { ledger: { orderBy: { createdAt: 'asc' } } }, ...pageArgs(p) }), p, cashoutDto)
}

export async function listPets(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(PetStatus))
  const where: Prisma.PetWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: [{ id: p.q }, { name: contains(p.q) }, { ownerAddress: contains(p.q) }, { species: contains(p.q) }] } : {}),
  }
  const rows = await prisma.pet.findMany({ where, ...pageArgs(p) })
  const ids = rows.map((r) => r.id)
  const [meals, lastMeals] = await Promise.all([
    prisma.petMeal.groupBy({ by: ['petId', 'fed'], _count: { _all: true }, where: { petId: { in: ids } } }),
    prisma.petMeal.groupBy({ by: ['petId'], _max: { createdAt: true }, where: { petId: { in: ids }, fed: true } }),
  ])
  const mealCount = (petId: string, fed: boolean) => meals.find((m) => m.petId === petId && m.fed === fed)?._count._all ?? 0
  return page(rows, p, (pet) => ({
    id: pet.id,
    name: pet.name,
    species: pet.species,
    ownerAddress: pet.ownerAddress,
    timezone: pet.timezone,
    status: pet.status,
    strength: pet.strength,
    xp: pet.xp,
    level: 1 + Math.floor(pet.xp / XP_PER_LEVEL),
    revivals: pet.revivals,
    mealsFed: mealCount(pet.id, true),
    mealsMissed: mealCount(pet.id, false),
    lastFedAt: iso(lastMeals.find((m) => m.petId === pet.id)?._max.createdAt ?? null),
    diedAt: iso(pet.diedAt),
    deathReason: pet.deathReason,
    createdAt: pet.createdAt.toISOString(),
  }))
}

export async function listMeals(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(MealSlot))
  const where: Prisma.PetMealWhereInput = {
    ...(p.status ? { slot: p.status } : {}),
    ...(p.q ? { OR: [{ petId: p.q }, { name: contains(p.q) }, { pet: { name: contains(p.q) } }, { pet: { ownerAddress: contains(p.q) } }] } : {}),
  }
  const rows = await prisma.petMeal.findMany({ where, include: { pet: { select: { name: true, ownerAddress: true } } }, ...pageArgs(p) })
  return page(rows, p, (m) => ({
    id: m.id,
    petId: m.petId,
    petName: m.pet.name,
    ownerAddress: m.pet.ownerAddress,
    day: m.day,
    slot: m.slot,
    fed: m.fed,
    name: m.name,
    score: m.score,
    calories: m.calories,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    fiber: m.fiber,
    strengthDelta: m.strengthDelta,
    xpDelta: m.xpDelta,
    createdAt: m.createdAt.toISOString(),
  }))
}

export async function listRevivals(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(PetRevivalStatus))
  const where: Prisma.PetRevivalWhereInput = {
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: [{ id: p.q }, { reference: contains(p.q) }, { payer: contains(p.q) }, { txHash: contains(p.q) }, { pet: { ownerAddress: contains(p.q) } }] } : {}),
  }
  const rows = await prisma.petRevival.findMany({ where, include: { pet: { select: { name: true, ownerAddress: true } } }, ...pageArgs(p) })
  return page(rows, p, (r) => ({
    id: r.id,
    reference: r.reference,
    petId: r.petId,
    petName: r.pet.name,
    ownerAddress: r.pet.ownerAddress,
    status: r.status,
    priceNim: formatNim(r.priceLuna),
    receivedNim: nim(r.receivedLuna),
    payer: r.payer,
    txHash: r.txHash,
    paidAt: iso(r.paidAt),
    refundTxHash: r.refundTxHash,
    failureReason: r.failureReason,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }))
}

/** BiteBuddy's meal analyses from before pets existed. Nothing writes these any more. */
export async function listMealLogs(query: Record<string, unknown>) {
  const p = listParams(query)
  const where: Prisma.MealLogWhereInput = p.q ? { OR: [{ userId: contains(p.q) }, { name: contains(p.q) }, { mealType: contains(p.q) }] } : {}
  return page(await prisma.mealLog.findMany({ where, ...pageArgs(p) }), p, (m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
}

/** Minor units → display amount: luna for NIM, otherwise the currency's own minor unit (kobo for NGN). */
function ledgerAmount(asset: string, amount: bigint) {
  if (asset === 'NIM') return formatNim(amount)
  const decimals = ONRAMP_CURRENCIES.find((c) => c.code === asset)?.decimals ?? 2
  return (Number(amount) / 10 ** decimals).toFixed(decimals)
}

function ledgerLine(l: LedgerEntry) {
  return {
    id: l.id,
    kind: l.kind,
    asset: l.asset,
    amount: l.amount.toString(),
    displayAmount: ledgerAmount(l.asset, l.amount),
    debit: l.debit,
    credit: l.credit,
    externalRef: l.externalRef,
    createdAt: l.createdAt.toISOString(),
  }
}

const LEDGER_SOURCES = ['CASHOUT', 'GIFT', 'REVIVAL', 'BUY'] as const

export async function listLedger(query: Record<string, unknown>) {
  const p = listParams(query, Object.values(LedgerKind))
  const source = String(query.source ?? '').trim().toUpperCase()
  if (source && !(LEDGER_SOURCES as readonly string[]).includes(source)) {
    throw new HttpError(400, `source must be one of ${LEDGER_SOURCES.join(', ')}`, 'INVALID_SOURCE')
  }
  const where: Prisma.LedgerEntryWhereInput = {
    ...(p.status ? { kind: p.status } : {}),
    ...(source === 'CASHOUT' ? { orderId: { not: null } } : {}),
    ...(source === 'GIFT' ? { giftCardId: { not: null } } : {}),
    ...(source === 'REVIVAL' ? { revivalId: { not: null } } : {}),
    ...(source === 'BUY' ? { onrampOrderId: { not: null } } : {}),
    ...(p.q ? { OR: [{ externalRef: contains(p.q) }, { debit: contains(p.q) }, { credit: contains(p.q) }, { asset: contains(p.q) }] } : {}),
  }
  const rows = await prisma.ledgerEntry.findMany({
    where,
    include: {
      order: { select: { reference: true } },
      giftCard: { select: { reference: true } },
      revival: { select: { reference: true } },
      onrampOrder: { select: { reference: true } },
    },
    ...pageArgs(p),
  })
  return page(rows, p, (l) => ({
    ...ledgerLine(l),
    source: l.orderId
      ? { type: 'CASHOUT' as const, id: l.orderId, reference: l.order?.reference ?? null }
      : l.giftCardId
        ? { type: 'GIFT' as const, id: l.giftCardId, reference: l.giftCard?.reference ?? null }
        : l.revivalId
          ? { type: 'REVIVAL' as const, id: l.revivalId, reference: l.revival?.reference ?? null }
          : l.onrampOrderId
            ? { type: 'BUY' as const, id: l.onrampOrderId, reference: l.onrampOrder?.reference ?? null }
            : null,
  }))
}
