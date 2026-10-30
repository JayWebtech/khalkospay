import { createHmac, randomUUID } from 'node:crypto'
import { OfframpOrder, OfframpStatus, Partner, PartnerWebhookDelivery, PartnerWebhookEvent, Prisma } from '@prisma/client'
import { config } from '../config'
import { HttpError } from '../lib/http-error'
import { prisma } from '../lib/prisma'
import { apiOfframpDto, ApiOfframp } from './partner-dto'

/**
 * Partner webhooks. The off-ramp engine writes events into PartnerWebhookEvent in the same transaction as the
 * status change (recordOrderEvents), so a crash can't lose one; this worker then delivers them, signed, with
 * retries on a backoff and a row per attempt in PartnerWebhookDelivery.
 */

export const EVENT_TYPES = [
  'offramp.deposit_confirmed',
  'offramp.paid',
  'offramp.payout_failed',
  'offramp.refunded',
  'offramp.expired',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const SIGNATURE_HEADER = 'KhalkosPay-Signature'

/** A claimed event is skipped by other ticks (and other instances) for this long; longer than any one attempt. */
const LEASE_MS = 60_000
const RESPONSE_SNIPPET = 1_000
const IDEMPOTENCY_TTL_MS = 24 * 3_600_000

/** Which events an order change produces. A deposit that arrives short or late is confirmed and fails in one step. */
function eventsFor(from: OfframpStatus, order: OfframpOrder): EventType[] {
  switch (order.status) {
    case 'PAYING_OUT':
      return from === 'CONFIRMING' ? ['offramp.deposit_confirmed'] : []
    case 'PAYOUT_FAILED':
      return from === 'CONFIRMING' ? ['offramp.deposit_confirmed', 'offramp.payout_failed'] : ['offramp.payout_failed']
    case 'COMPLETED':
      return ['offramp.paid']
    case 'REFUNDED':
      return ['offramp.refunded']
    case 'EXPIRED':
      return ['offramp.expired']
    default:
      return []
  }
}

function eventBody(id: string, type: EventType, livemode: boolean, data: ApiOfframp, createdAt: Date, sample = false) {
  return JSON.stringify({ id, object: 'event', type, livemode, createdAt: createdAt.toISOString(), ...(sample ? { sample: true } : {}), data })
}

/** Called by the engine inside its transition transaction. Each event type is written at most once per order. */
export async function recordOrderEvents(db: Prisma.TransactionClient, from: OfframpStatus, order: OfframpOrder): Promise<number> {
  if (!order.partnerId) return 0
  const types = eventsFor(from, order)
  if (types.length === 0) return 0
  const data = apiOfframpDto(order)
  const now = Date.now()
  const { count } = await db.partnerWebhookEvent.createMany({
    data: types.map((type, i) => {
      const id = randomUUID()
      // A millisecond apart, so the deposit is delivered before the failure it caused.
      const createdAt = new Date(now + i)
      return { id, partnerId: order.partnerId!, livemode: order.livemode, type, orderId: order.id, payload: eventBody(id, type, order.livemode, data, createdAt), createdAt }
    }),
    skipDuplicates: true,
  })
  return count
}

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, keyed with the whole whsec_… secret. */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

const webhookUrl = (p: Partner, livemode: boolean) => (livemode ? p.webhookUrlLive : p.webhookUrlTest)
const webhookSecret = (p: Partner, livemode: boolean) => (livemode ? p.webhookSecretLive : p.webhookSecretTest)

async function attempt(event: PartnerWebhookEvent, url: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const started = Date.now()
  let statusCode: number | null = null
  let error: string | null = null
  let responseBody: string | null = null
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'KhalkosPay-Webhooks/1.0',
        [SIGNATURE_HEADER]: signWebhook(secret, timestamp, event.payload),
        'KhalkosPay-Event-Id': event.id,
        'KhalkosPay-Event-Type': event.type,
      },
      body: event.payload,
      signal: AbortSignal.timeout(config.partnerApi.webhookTimeoutMs),
    })
    statusCode = res.status
    responseBody = (await res.text().catch(() => '')).slice(0, RESPONSE_SNIPPET) || null
  } catch (e) {
    const err = e as Error & { cause?: Error }
    error = err.name === 'TimeoutError' ? `Timed out after ${config.partnerApi.webhookTimeoutMs} ms` : (err.cause?.message ?? err.message)
  }
  const ok = statusCode !== null && statusCode >= 200 && statusCode < 300
  const delivery = await prisma.partnerWebhookDelivery.create({
    data: { eventId: event.id, attempt: event.attempts + 1, url, statusCode, error, responseBody, durationMs: Date.now() - started },
  })
  return { ok, delivery, error: ok ? null : (error ?? `Responded with HTTP ${statusCode}`) }
}

async function deliverDue(event: PartnerWebhookEvent & { partner: Partner }) {
  const claimed = await prisma.partnerWebhookEvent.updateMany({
    where: { id: event.id, status: 'PENDING', nextAttemptAt: event.nextAttemptAt },
    data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
  })
  if (claimed.count === 0) return
  const url = webhookUrl(event.partner, event.livemode)
  if (!url) {
    await prisma.partnerWebhookEvent.update({
      where: { id: event.id },
      data: { status: 'SKIPPED', nextAttemptAt: null, lastError: `No ${event.livemode ? 'live' : 'test'} webhook URL was set` },
    })
    return
  }
  const result = await attempt(event, url, webhookSecret(event.partner, event.livemode))
  const attempts = event.attempts + 1
  if (result.ok) {
    await prisma.partnerWebhookEvent.update({
      where: { id: event.id },
      data: { status: 'DELIVERED', attempts, deliveredAt: new Date(), nextAttemptAt: null, lastError: null },
    })
    return
  }
  const delay = config.partnerApi.webhookRetrySeconds[attempts - 1]
  await prisma.partnerWebhookEvent.update({
    where: { id: event.id },
    data:
      delay === undefined
        ? { status: 'FAILED', attempts, nextAttemptAt: null, lastError: result.error }
        : { attempts, nextAttemptAt: new Date(Date.now() + delay * 1000), lastError: result.error },
  })
}

async function dispatchDue() {
  const due = await prisma.partnerWebhookEvent.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    include: { partner: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  // In order per partner, partners side by side, so one slow endpoint doesn't hold up everyone else's.
  const byPartner = new Map<string, typeof due>()
  for (const e of due) byPartner.set(e.partnerId, [...(byPartner.get(e.partnerId) ?? []), e])
  await Promise.all(
    [...byPartner.values()].map(async (events) => {
      for (const e of events) await deliverDue(e).catch((err) => console.error(`[webhooks] event ${e.id} failed:`, err.message))
    }),
  )
}

let kick: (() => void) | null = null

/** Delivers new events now instead of on the next tick. The engine calls it after committing a change. */
export const notifyWebhooks = () => kick?.()

/** Delivers due webhooks and, hourly, forgets idempotency keys older than a day. */
export function startPartnerApiWorker(intervalMs = 2_000) {
  let running = false
  let again = false
  let lastPrune = 0
  const tick = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        await dispatchDue()
      } while (again)
      if (Date.now() - lastPrune > 3_600_000) {
        lastPrune = Date.now()
        await prisma.partnerIdempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_TTL_MS) } } })
      }
    } catch (e) {
      console.error('[webhooks] tick failed:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }
  kick = () => void tick()
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

// ------------------------------------------------------------------------------------------- test events

const SAMPLE_STATUS: Record<EventType, OfframpStatus> = {
  'offramp.deposit_confirmed': 'PAYING_OUT',
  'offramp.paid': 'COMPLETED',
  'offramp.payout_failed': 'PAYOUT_FAILED',
  'offramp.refunded': 'REFUNDED',
  'offramp.expired': 'EXPIRED',
}

function sampleOrder(type: EventType, livemode: boolean, now: Date): OfframpOrder {
  const status = SAMPLE_STATUS[type]
  const deposited = type !== 'offramp.expired'
  const created = new Date(now.getTime() - 5 * 60_000)
  return {
    id: '00000000-0000-4000-8000-000000000000',
    reference: livemode ? 'khalkos-0000000000000000' : 'khalkos-test-0000000000000000',
    source: 'api',
    userAddress: null,
    livemode,
    partnerId: null,
    partnerReference: 'sample_withdrawal_123',
    metadata: { userId: 'sample_user_42' },
    refundAddress: null,
    sandboxPayoutFails: false,
    nimLuna: 100_000_000n,
    rateNgnPerNim: new Prisma.Decimal('1.6'),
    grossKobo: 160_000n,
    feeKobo: 3_600n,
    payoutKobo: 156_400n,
    bankCode: '058',
    bankName: 'Guaranty Trust Bank',
    accountNumber: '0123456789',
    accountName: 'Sample Account',
    status,
    depositTxHash: deposited ? 'a'.repeat(64) : null,
    depositSubmittedAt: deposited ? created : null,
    depositConfirmedAt: deposited ? now : null,
    depositFrom: deposited ? 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000' : null,
    receivedLuna: deposited ? 100_000_000n : null,
    paystackRecipientCode: null,
    paystackTransferCode: null,
    paidAt: status === 'COMPLETED' ? now : null,
    refundTxHash: status === 'REFUNDED' ? 'b'.repeat(64) : null,
    refundTxHex: null,
    refundSentAt: status === 'REFUNDED' ? now : null,
    failureReason: status === 'PAYOUT_FAILED' || status === 'REFUNDED' ? 'Your bank transfer was failed' : null,
    expiresAt: new Date(created.getTime() + config.offramp.quoteTtlSeconds * 1000),
    createdAt: created,
    updatedAt: now,
  }
}

export function parseEventType(value: unknown): EventType {
  if (value === undefined || value === null || value === '') return 'offramp.paid'
  if (typeof value !== 'string' || !(EVENT_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, `type must be one of ${EVENT_TYPES.join(', ')}`, 'INVALID_EVENT_TYPE')
  }
  return value as EventType
}

/** Sends one signed sample event right away and reports how the endpoint answered. Never retried. */
export async function sendTestEvent(partner: Partner, livemode: boolean, type: EventType) {
  const url = webhookUrl(partner, livemode)
  if (!url) throw new HttpError(400, `Set a ${livemode ? 'live' : 'test'} webhook URL first`, 'WEBHOOK_URL_MISSING')
  const id = randomUUID()
  const now = new Date()
  const event = await prisma.partnerWebhookEvent.create({
    data: { id, partnerId: partner.id, livemode, type, payload: eventBody(id, type, livemode, apiOfframpDto(sampleOrder(type, livemode, now)), now, true), nextAttemptAt: null, createdAt: now },
  })
  const result = await attempt(event, url, webhookSecret(partner, livemode))
  const updated = await prisma.partnerWebhookEvent.update({
    where: { id },
    data: { attempts: 1, status: result.ok ? 'DELIVERED' : 'FAILED', deliveredAt: result.ok ? new Date() : null, lastError: result.error },
    include: { deliveries: true },
  })
  return webhookEventDto(updated)
}

// ------------------------------------------------------------------------------------------- delivery log

export function webhookEventDto(e: PartnerWebhookEvent & { deliveries?: PartnerWebhookDelivery[] }) {
  return {
    id: e.id,
    type: e.type,
    livemode: e.livemode,
    orderId: e.orderId,
    status: e.status.toLowerCase(),
    attempts: e.attempts,
    nextAttemptAt: e.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: e.deliveredAt?.toISOString() ?? null,
    lastError: e.lastError,
    createdAt: e.createdAt.toISOString(),
    payload: JSON.parse(e.payload) as unknown,
    deliveries: e.deliveries
      ?.sort((a, b) => a.attempt - b.attempt)
      .map((d) => ({
        attempt: d.attempt,
        url: d.url,
        statusCode: d.statusCode,
        error: d.error,
        responseBody: d.responseBody,
        durationMs: d.durationMs,
        createdAt: d.createdAt.toISOString(),
      })),
  }
}

/** Newest first. `cursor` is the last id of the previous page. */
export async function listWebhookEvents(
  where: Prisma.PartnerWebhookEventWhereInput,
  { limit = 25, cursor = null }: { limit?: number; cursor?: string | null },
) {
  const rows = await prisma.partnerWebhookEvent.findMany({
    where,
    include: { deliveries: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const more = rows.length > limit
  const items = more ? rows.slice(0, limit) : rows
  return { items: items.map(webhookEventDto), nextCursor: more ? items[items.length - 1].id : null }
}

/** Queues one more attempt now, for an event that failed, was skipped, or is waiting on its backoff. */
export async function retryWebhookEvent(partnerId: string, eventId: string) {
  const event = await prisma.partnerWebhookEvent.findFirst({ where: { id: eventId, partnerId } })
  if (!event) throw new HttpError(404, 'Webhook event not found', 'EVENT_NOT_FOUND')
  if (event.status === 'DELIVERED') throw new HttpError(409, 'This event was already delivered', 'ALREADY_DELIVERED')
  if (!event.orderId) throw new HttpError(409, 'Test events are sent once. Send a new test event instead.', 'TEST_EVENT')
  await prisma.partnerWebhookEvent.update({ where: { id: event.id }, data: { status: 'PENDING', nextAttemptAt: new Date() } })
  notifyWebhooks()
  const updated = await prisma.partnerWebhookEvent.findUniqueOrThrow({ where: { id: event.id }, include: { deliveries: true } })
  return webhookEventDto(updated)
}
