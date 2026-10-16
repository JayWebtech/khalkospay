import { randomBytes } from 'node:crypto'
import { MealSlot, Pet, PetMeal, PetRevival, PetRevivalStatus, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { analyzeMeal, MealAnalysis } from './meal-analysis'
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
import {
  findSpecies,
  LAST_STAND_STRENGTH,
  mealStrengthDelta,
  mealXp,
  missPenalty,
  REVIVE_STRENGTH,
  SPECIES,
  START_STRENGTH,
  XP_PER_LEVEL,
} from './pet-species'
import {
  currentWindow,
  formatLocalDay,
  formatLocalTime,
  isValidTimeZone,
  localDay,
  MEAL_WINDOWS,
  MealWindow,
  nextWindow,
  windowsClosedBetween,
  windowsForDay,
} from './pet-time'

/** Revive payment memo prefix; the treasury scan routes payments with this memo here. */
export const REVIVE_REFERENCE_PREFIX = 'khalkos-revive-'

const NAME_MAX = 20
const SIGNED_TX_VALIDITY_MS = 150 * 60_000
const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner' }

type Tx = Prisma.TransactionClient

function ownerAddressOf(address: unknown): string {
  try {
    return normalizeAddress(String(address ?? ''))
  } catch {
    throw new HttpError(400, 'Connect your wallet to see your buddy', 'INVALID_ADDRESS')
  }
}

function speciesOf(pet: Pet) {
  return findSpecies(pet.species) ?? SPECIES[0]
}

function cleanName(name: unknown, fallback: string): string {
  const value = typeof name === 'string' ? name.normalize('NFKC').replace(/\s+/g, ' ').trim() : ''
  if (value.length > NAME_MAX) throw new HttpError(400, `Names can be at most ${NAME_MAX} characters`, 'INVALID_NAME')
  return value || fallback
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

/** Serializes every state change of one pet; settling, feeding and reviving all go through this. */
function withPetLock<T>(petId: string, fn: (tx: Tx, pet: Pet) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Pet" WHERE id = ${petId} FOR UPDATE`
    return fn(tx, await tx.pet.findUniqueOrThrow({ where: { id: petId } }))
  })
}

/**
 * Scores every meal window that closed since the last visit, in order. A missed meal costs strength
 * (breakfast the most); a day whose counted windows were all missed kills the pet. Windows that opened
 * before adoption or the last revive never count.
 */
async function settle(tx: Tx, pet: Pet, now: Date): Promise<Pet> {
  if (pet.status !== 'ALIVE' || now <= pet.settledUntil) return pet
  const closed = windowsClosedBetween(pet.settledUntil, now, pet.timezone)
  if (closed.length === 0) return pet

  const { rules } = speciesOf(pet)
  const counts = (w: MealWindow) => w.start >= pet.aliveSince
  const fedRows = await tx.petMeal.findMany({
    where: { petId: pet.id, day: { in: [...new Set(closed.map((w) => w.day))] }, fed: true },
    select: { day: true, slot: true },
  })
  const fed = new Set(fedRows.map((m) => `${m.day}:${m.slot}`))
  const missed: Prisma.PetMealCreateManyInput[] = []
  let strength = pet.strength
  let lastStandUsed = pet.lastStandUsed
  let death: { at: Date; reason: string } | null = null

  for (const w of closed) {
    if (counts(w) && !fed.has(`${w.day}:${w.slot}`)) {
      const before = strength
      strength = clamp(strength - missPenalty(w.slot, rules))
      missed.push({ petId: pet.id, day: w.day, slot: w.slot, fed: false, strengthDelta: strength - before })
    }
    if (w.slot !== 'DINNER') continue
    const counted = windowsForDay(w.day, pet.timezone).filter(counts)
    if (counted.length === 0 || counted.some((d) => fed.has(`${d.day}:${d.slot}`))) continue
    if (rules.lastStand && !lastStandUsed) {
      lastStandUsed = true
      strength = Math.max(strength, LAST_STAND_STRENGTH)
      continue
    }
    death = { at: w.end, reason: `${pet.name} went all of ${formatLocalDay(w.day)} without a single meal.` }
    break
  }

  if (missed.length) await tx.petMeal.createMany({ data: missed, skipDuplicates: true })
  return tx.pet.update({
    where: { id: pet.id },
    data: {
      strength,
      lastStandUsed,
      settledUntil: death ? death.at : now,
      ...(death ? { status: 'DEAD' as const, diedAt: death.at, deathReason: death.reason } : {}),
    },
  })
}

async function findPet(ownerAddress: string) {
  const pet = await prisma.pet.findUnique({ where: { ownerAddress } })
  if (!pet) throw new HttpError(404, "You haven't adopted a buddy yet", 'NO_PET')
  return pet
}

export async function getPet(address: unknown, now = new Date()) {
  const pet = await findPet(ownerAddressOf(address))
  return withPetLock(pet.id, (tx, locked) => settle(tx, locked, now))
}

export async function adoptPet(input: { address: unknown; species: unknown; name?: unknown; timezone: unknown }, now = new Date()) {
  const ownerAddress = ownerAddressOf(input.address)
  const species = findSpecies(String(input.species ?? ''))
  if (!species) throw new HttpError(400, 'Pick one of the buddies', 'INVALID_SPECIES')
  const timezone = String(input.timezone ?? '')
  if (!isValidTimeZone(timezone)) throw new HttpError(400, "We couldn't read your timezone", 'INVALID_TIMEZONE')
  try {
    return await prisma.pet.create({
      data: {
        ownerAddress,
        species: species.id,
        name: cleanName(input.name, species.name),
        timezone,
        strength: START_STRENGTH,
        aliveSince: now,
        settledUntil: now,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'You already have a buddy', 'PET_EXISTS')
    }
    throw e
  }
}

/** Switching buddies keeps strength and XP, so it can't be used to dodge a death or a bad day. */
export async function changeBuddy(input: { address: unknown; species: unknown; name?: unknown }, now = new Date()) {
  const pet = await findPet(ownerAddressOf(input.address))
  const species = findSpecies(String(input.species ?? ''))
  if (!species) throw new HttpError(400, 'Pick one of the buddies', 'INVALID_SPECIES')
  return withPetLock(pet.id, async (tx, locked) => {
    const settled = await settle(tx, locked, now)
    if (settled.status === 'DEAD') throw new HttpError(409, `Revive ${settled.name} before changing buddies`, 'PET_DEAD')
    const keepName = settled.name === speciesOf(settled).name ? species.name : settled.name
    return tx.pet.update({ where: { id: pet.id }, data: { species: species.id, name: cleanName(input.name, keepName) } })
  })
}

async function assertCanFeed(tx: Tx, pet: Pet, now: Date): Promise<MealWindow> {
  if (pet.status === 'DEAD') throw new HttpError(409, `${pet.name} has died. Revive it to feed it again.`, 'PET_DEAD')
  const window = currentWindow(now, pet.timezone)
  const next = nextWindow(now, pet.timezone)
  const nextText = `${SLOT_LABEL[next.slot]} opens at ${formatLocalTime(next.start, pet.timezone)}.`
  if (!window) throw new HttpError(409, `${pet.name} is asleep. ${nextText}`, 'NOT_MEAL_TIME')
  const existing = await tx.petMeal.findUnique({ where: { petId_day_slot: { petId: pet.id, day: window.day, slot: window.slot } } })
  if (existing?.fed) {
    throw new HttpError(409, `${pet.name} already had ${SLOT_LABEL[window.slot].toLowerCase()} today. ${nextText}`, 'ALREADY_FED')
  }
  if (existing) throw new HttpError(409, `${SLOT_LABEL[window.slot]} time is over. ${nextText}`, 'MEAL_CLOSED')
  return window
}

/** Feeds the meal that is open right now; any other meal is refused, so the clock can't be gamed from the app. */
export async function feedPet(address: unknown, image: unknown, now = new Date()) {
  if (typeof image !== 'string' || !image.startsWith('data:image/')) throw new HttpError(400, 'Add a photo of your meal', 'INVALID_IMAGE')
  const pet = await findPet(ownerAddressOf(address))
  const window = await withPetLock(pet.id, async (tx, locked) => assertCanFeed(tx, await settle(tx, locked, now), now))
  const meal = await analyzeMeal(image, window.slot)
  return recordMeal(pet.id, window, meal, now)
}

/** Records a fed meal for `window`; `requestedAt` is when the user asked, so a slow photo check can't close the window on them. */
export async function recordMeal(petId: string, window: MealWindow, meal: MealAnalysis, requestedAt: Date) {
  return withPetLock(petId, async (tx, locked) => {
    const pet = await settle(tx, locked, requestedAt)
    const open = await assertCanFeed(tx, pet, requestedAt)
    if (open.day !== window.day || open.slot !== window.slot) {
      throw new HttpError(409, `${SLOT_LABEL[window.slot]} time is over.`, 'MEAL_CLOSED')
    }
    const { rules } = speciesOf(pet)
    const strength = clamp(pet.strength + mealStrengthDelta(meal.score, window.slot, rules))
    const xpDelta = mealXp(meal.score, pet.strength, rules)
    const row = await tx.petMeal.create({
      data: {
        petId,
        day: window.day,
        slot: window.slot,
        fed: true,
        name: meal.name,
        score: meal.score,
        ...meal.nutrients,
        strengthDelta: strength - pet.strength,
        xpDelta,
      },
    })
    const updated = await tx.pet.update({ where: { id: petId }, data: { strength, xp: { increment: xpDelta } } })
    return { pet: updated, meal: row }
  })
}

// ---------------------------------------------------------------------------------------------
// Revive: a NIM payment to the treasury, verified on-chain exactly like gift funding.

function requireReviveEnabled(): string {
  if (!treasuryAddress || !canSendFromTreasury) {
    throw new HttpError(503, 'Reviving is not available on this server yet', 'REVIVE_NOT_CONFIGURED')
  }
  return treasuryAddress
}

function revivePriceLuna(): bigint {
  return parseNimToLuna(config.pets.revivePriceNim)
}

export async function startRevival(address: unknown, now = new Date()): Promise<PetRevival> {
  requireReviveEnabled()
  const pet = await getPet(address, now)
  if (pet.status !== 'DEAD') throw new HttpError(409, `${pet.name} is alive and well`, 'PET_ALIVE')
  const open = await prisma.petRevival.findFirst({
    where: { petId: pet.id, status: 'AWAITING_PAYMENT', OR: [{ txHash: { not: null } }, { expiresAt: { gt: new Date(now.getTime() + 60_000) } }] },
    orderBy: { createdAt: 'desc' },
  })
  if (open) return open
  return prisma.petRevival.create({
    data: {
      petId: pet.id,
      reference: `${REVIVE_REFERENCE_PREFIX}${randomBytes(8).toString('hex')}`,
      priceLuna: revivePriceLuna(),
      expiresAt: new Date(now.getTime() + config.pets.revivePaymentTtlSeconds * 1000),
    },
  })
}

export async function getRevival(id: string): Promise<PetRevival> {
  const revival = await prisma.petRevival.findUnique({ where: { id } })
  if (!revival) throw new HttpError(404, 'Revive payment not found', 'REVIVAL_NOT_FOUND')
  return revival
}

const PAYMENT_ATTACHABLE: PetRevivalStatus[] = ['AWAITING_PAYMENT', 'EXPIRED']

export async function submitRevivalPayment(id: string, hashOrSerializedTx: string): Promise<PetRevival> {
  let hash: string
  try {
    hash = resolveTxHash(hashOrSerializedTx)
  } catch {
    throw new HttpError(400, 'That is not a valid Nimiq transaction', 'INVALID_TX')
  }
  const revival = await getRevival(id)
  if (revival.txHash === hash) return revival
  return attachPayment(revival, hash)
}

async function attachPayment(revival: PetRevival, hash: string): Promise<PetRevival> {
  if (!PAYMENT_ATTACHABLE.includes(revival.status) || revival.txHash) {
    throw new HttpError(409, 'This revive is no longer waiting for payment', 'REVIVAL_NOT_AWAITING_PAYMENT')
  }
  try {
    const res = await prisma.petRevival.updateMany({
      where: { id: revival.id, status: revival.status, txHash: null },
      data: { status: 'AWAITING_PAYMENT', txHash: hash, txSubmittedAt: new Date(), failureReason: null },
    })
    if (res.count === 0) throw new HttpError(409, 'This revive changed, please refresh', 'REVIVAL_CONFLICT')
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'This transaction is already attached to another payment', 'TX_ALREADY_USED')
    }
    throw e
  }
  void processRevival(revival.id)
  return getRevival(revival.id)
}

/** Treasury scan hook for revive payments the app never reported. */
export async function attachScannedRevivalPayment(tx: ChainTransaction) {
  if (!tx.success) return
  const revival = await prisma.petRevival.findUnique({ where: { reference: tx.data.trim() } })
  if (!revival || revival.txHash || !PAYMENT_ATTACHABLE.includes(revival.status)) return
  if (await prisma.petRevival.findUnique({ where: { txHash: tx.hash } })) return
  await attachPayment(revival, tx.hash).catch((e) => console.error(`[pets] auto-attach ${revival.id} failed:`, e.message))
}

const inFlight = new Set<string>()
const lastPoll = new Map<string, number>()

function throttled(key: string, ms: number) {
  const last = lastPoll.get(key) ?? 0
  if (Date.now() - last < ms) return true
  lastPoll.set(key, Date.now())
  return false
}

export async function processRevival(id: string) {
  if (inFlight.has(id)) return
  inFlight.add(id)
  try {
    const revival = await prisma.petRevival.findUnique({ where: { id } })
    if (!revival) return
    if (revival.status === 'AWAITING_PAYMENT' && revival.txHash) await confirmPayment(revival)
    else if (revival.status === 'REFUNDING') await advanceRefund(revival)
  } catch (e) {
    console.error(`[pets] revival ${id} step failed:`, e instanceof Error ? e.message : e)
  } finally {
    inFlight.delete(id)
  }
}

async function confirmPayment(revival: PetRevival) {
  const hash = revival.txHash!
  const reject = (failureReason: string) =>
    prisma.petRevival.updateMany({
      where: { id: revival.id, status: 'AWAITING_PAYMENT', txHash: hash },
      data: { txHash: null, txSubmittedAt: null, failureReason },
    })

  const tx = await getTransaction(hash)
  if (!tx) {
    const waited = Date.now() - (revival.txSubmittedAt?.getTime() ?? Date.now())
    if (waited > config.pets.revivePaymentLookupTimeoutSeconds * 1000) await reject('Your NIM transaction was not found on the Nimiq network')
    return
  }
  if (tx.to !== treasuryAddress) return void (await reject('That transaction was not sent to the KhalkosPay deposit address'))
  if (!tx.success) return void (await reject('That transaction failed on the Nimiq network'))
  if (tx.data.trim() !== revival.reference) return void (await reject('That transaction belongs to a different payment'))
  if (tx.confirmations < config.nimiq.minConfirmations) return

  const now = new Date()
  const outcome = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Pet" WHERE id = ${revival.petId} FOR UPDATE`
    const pet = await db.pet.findUniqueOrThrow({ where: { id: revival.petId } })
    const short = tx.valueLuna < revival.priceLuna
    const failureReason = short
      ? `Received ${formatNim(tx.valueLuna)} NIM but reviving costs ${formatNim(revival.priceLuna)} NIM`
      : pet.status === 'ALIVE'
        ? `${pet.name} was already revived, so this payment is being returned`
        : null
    const to: PetRevivalStatus = failureReason ? 'REFUNDING' : 'PAID'
    const res = await db.petRevival.updateMany({
      where: { id: revival.id, status: 'AWAITING_PAYMENT', txHash: hash },
      data: { status: to, paidAt: now, payer: tx.from, receivedLuna: tx.valueLuna, failureReason },
    })
    if (res.count === 0) return null
    await db.ledgerEntry.create({
      data: {
        revivalId: revival.id,
        kind: 'DEPOSIT',
        asset: 'NIM',
        amount: tx.valueLuna,
        debit: `nim:${tx.from}`,
        credit: `nim:${treasuryAddress}`,
        externalRef: hash,
      },
    })
    if (to === 'PAID') {
      await db.pet.update({
        where: { id: pet.id },
        data: {
          status: 'ALIVE',
          strength: REVIVE_STRENGTH,
          aliveSince: now,
          settledUntil: now,
          diedAt: null,
          deathReason: null,
          lastStandUsed: false,
          revivals: { increment: 1 },
        },
      })
    }
    return to
  })
  if (outcome === 'REFUNDING') await advanceRefund(await getRevival(revival.id))
}

async function sendRefund(revival: PetRevival) {
  if (!revival.payer || !revival.receivedLuna) throw new Error(`revival ${revival.id} has nothing to refund`)
  const { hash, hex } = await buildTreasuryTransaction(revival.payer, revival.receivedLuna, `refund ${revival.reference}`)
  // Compare-and-swap on the previous hash so two workers never broadcast two different refunds.
  const saved = await prisma.petRevival.updateMany({
    where: { id: revival.id, status: 'REFUNDING', refundTxHash: revival.refundTxHash },
    data: { refundTxHash: hash, refundTxHex: hex, refundSentAt: new Date() },
  })
  if (saved.count === 0) return
  lastPoll.set(`refund:${revival.id}`, Date.now())
  await broadcastTransaction(hex).catch((e) => console.error(`[pets] refund broadcast for ${revival.id} failed:`, e.message))
}

async function advanceRefund(revival: PetRevival) {
  if (!revival.refundTxHash || !revival.refundTxHex || !revival.refundSentAt) return sendRefund(revival)
  const tx = await getTransaction(revival.refundTxHash)
  if (tx?.success && tx.confirmations >= 1) {
    await prisma.$transaction(async (db) => {
      const res = await db.petRevival.updateMany({
        where: { id: revival.id, status: 'REFUNDING', refundTxHash: tx.hash },
        data: { status: 'REFUNDED' },
      })
      if (res.count === 0) return
      await db.ledgerEntry.create({
        data: {
          revivalId: revival.id,
          kind: 'REFUND',
          asset: 'NIM',
          amount: revival.receivedLuna!,
          debit: `nim:${treasuryAddress}`,
          credit: `nim:${revival.payer}`,
          externalRef: tx.hash,
        },
      })
    })
    return
  }
  const stale = Date.now() - revival.refundSentAt.getTime() > SIGNED_TX_VALIDITY_MS
  if (stale || (tx && !tx.success)) {
    if (!throttled(`refund:${revival.id}`, 60_000)) await sendRefund(revival)
    return
  }
  if (!tx && !throttled(`refund:${revival.id}`, 60_000)) await broadcastTransaction(revival.refundTxHex).catch(() => {})
}

export function startPetWorker(intervalMs = 5_000) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await prisma.petRevival.updateMany({
        where: { status: 'AWAITING_PAYMENT', txHash: null, expiresAt: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      })
      const work: Prisma.PetRevivalWhereInput[] = [{ status: 'AWAITING_PAYMENT', txHash: { not: null } }]
      if (canSendFromTreasury) work.push({ status: 'REFUNDING' })
      const pending = await prisma.petRevival.findMany({ where: { OR: work }, select: { id: true }, orderBy: { updatedAt: 'asc' }, take: 50 })
      for (const { id } of pending) await processRevival(id)
    } catch (e) {
      console.error('[pets] worker tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

// ---------------------------------------------------------------------------------------------
// DTOs

export type Mood = 'thriving' | 'happy' | 'hungry' | 'weak' | 'sleeping' | 'dead'
type WindowState = 'fed' | 'missed' | 'open' | 'upcoming' | 'skipped'

function moodOf(pet: Pet, mealDue: boolean, asleep: boolean): Mood {
  if (pet.status === 'DEAD') return 'dead'
  if (pet.strength < 30) return 'weak'
  if (asleep) return 'sleeping'
  if (mealDue && pet.strength < 80) return 'hungry'
  if (pet.strength >= 80) return 'thriving'
  if (pet.strength >= 55) return 'happy'
  return 'hungry'
}

function mealDto(m: PetMeal) {
  return {
    id: m.id,
    day: m.day,
    slot: m.slot,
    fed: m.fed,
    name: m.name,
    score: m.score,
    strengthDelta: m.strengthDelta,
    xpDelta: m.xpDelta,
    nutrients: m.fed
      ? { calories: m.calories ?? 0, protein: m.protein ?? 0, carbs: m.carbs ?? 0, fat: m.fat ?? 0, fiber: m.fiber ?? 0 }
      : null,
    createdAt: m.createdAt.toISOString(),
  }
}

export async function petDto(pet: Pet, now = new Date()) {
  const today = localDay(now, pet.timezone)
  const [todayRows, recent] = await Promise.all([
    prisma.petMeal.findMany({ where: { petId: pet.id, day: today } }),
    prisma.petMeal.findMany({ where: { petId: pet.id }, orderBy: [{ day: 'desc' }, { createdAt: 'desc' }], take: 8 }),
  ])
  const rows = new Map(todayRows.map((r) => [r.slot, r]))
  const alive = pet.status === 'ALIVE'
  const windows = windowsForDay(today, pet.timezone).map((w) => {
    const row = rows.get(w.slot)
    const state: WindowState = row
      ? row.fed
        ? 'fed'
        : 'missed'
      : now < w.start
        ? 'upcoming'
        : now < w.end && alive
          ? 'open'
          : 'skipped'
    return { slot: w.slot, start: w.start.toISOString(), end: w.end.toISOString(), state, meal: row?.fed ? mealDto(row) : null }
  })
  const open = alive ? windows.find((w) => w.state === 'open') : undefined
  const next = nextWindow(now, pet.timezone)
  const species = speciesOf(pet)
  return {
    id: pet.id,
    name: pet.name,
    species: species.id,
    status: pet.status,
    mood: moodOf(pet, Boolean(open), alive && !currentWindow(now, pet.timezone)),
    strength: pet.strength,
    xp: pet.xp,
    level: 1 + Math.floor(pet.xp / XP_PER_LEVEL),
    levelXp: pet.xp % XP_PER_LEVEL,
    levelSize: XP_PER_LEVEL,
    timezone: pet.timezone,
    adoptedAt: pet.createdAt.toISOString(),
    aliveSince: pet.aliveSince.toISOString(),
    diedAt: pet.diedAt?.toISOString() ?? null,
    deathReason: pet.deathReason,
    revivals: pet.revivals,
    lastStandAvailable: species.rules.lastStand && !pet.lastStandUsed,
    today: { day: today, windows },
    current: open ? { slot: open.slot, closesAt: open.end } : null,
    next: { slot: next.slot, opensAt: next.start.toISOString() },
    recentMeals: recent.map(mealDto),
  }
}

export function revivalDto(r: PetRevival) {
  return {
    id: r.id,
    status: r.status,
    priceNim: formatNim(r.priceLuna),
    receivedNim: r.receivedLuna === null ? null : formatNim(r.receivedLuna),
    confirming: r.status === 'AWAITING_PAYMENT' && r.txHash !== null,
    payment:
      r.status === 'AWAITING_PAYMENT' && !r.txHash && treasuryAddress
        ? { recipient: treasuryAddress, valueLuna: Number(r.priceLuna), data: r.reference }
        : null,
    txHash: r.txHash,
    refundTxHash: r.status === 'REFUNDING' || r.status === 'REFUNDED' ? r.refundTxHash : null,
    failureReason: r.failureReason,
    expiresAt: r.expiresAt.toISOString(),
  }
}

export function petConfigDto() {
  return {
    network: config.nimiq.network,
    reviveEnabled: Boolean(treasuryAddress && canSendFromTreasury),
    revivePriceNim: formatNim(revivePriceLuna()),
    windows: MEAL_WINDOWS,
    species: SPECIES.map(({ rules, ...s }) => ({
      ...s,
      missPenalty: { BREAKFAST: missPenalty('BREAKFAST', rules), LUNCH: missPenalty('LUNCH', rules), DINNER: missPenalty('DINNER', rules) },
    })),
  }
}
