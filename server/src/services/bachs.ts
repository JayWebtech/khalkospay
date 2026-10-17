import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config'

/** Bachs (bachs.io) hosted checkout: create a checkout, read it back, and verify signed webhooks. */

export class BachsError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function bachsConfigured() {
  return Boolean(config.bachs.secretKey)
}

async function request<T>(path: string, init: { method?: string; json?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  if (!config.bachs.secretKey) throw new BachsError(503, 'Bachs is not configured', 'NOT_CONFIGURED')
  let res: Response
  try {
    res = await fetch(`${config.bachs.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: {
        Authorization: `Bearer ${config.bachs.secretKey}`,
        Accept: 'application/json',
        ...(init.json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    throw new BachsError(0, `Could not reach Bachs: ${e instanceof Error ? e.message : e}`)
  }
  const body = (await res.json().catch(() => null)) as (T & { detail?: string; error_code?: string; details?: Record<string, unknown> }) | null
  if (!res.ok) throw new BachsError(res.status, body?.detail ?? `Bachs responded with HTTP ${res.status}`, body?.error_code, body?.details)
  return body as T
}

export interface BachsCheckout {
  checkout_id: string
  checkout_url?: string
  status: 'open' | 'completed' | 'expired' | 'cancelled' | string
  expires_at: string
  reference?: string | null
  /** Present on GET once the customer has paid or tried to. */
  charge?: {
    payment_id?: string
    status?: string
    amount?: string
    amount_paid?: string
    currency?: string
  } | null
}

/** A checkout priced in exactly one fiat currency, payable only through that currency's local methods. */
export function createCheckout(input: {
  reference: string
  currency: string
  amount: string
  paymentMethodTypes: string[]
  expiresInMinutes: number
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, string>
}) {
  return request<BachsCheckout>('/v1/checkout-sessions', {
    idempotencyKey: input.reference,
    json: {
      pricing: { currency: input.currency, amount: input.amount },
      reference: input.reference,
      payment_method_types: input.paymentMethodTypes,
      expires_in_minutes: input.expiresInMinutes,
      ...(input.successUrl ? { success_url: input.successUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  })
}

export function getCheckout(checkoutId: string) {
  return request<BachsCheckout>(`/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`)
}

export interface BachsEvent {
  id: string
  type: string
  created_at: string
  data: {
    checkout_id?: string | null
    charge_id?: string | null
    reference?: string | null
    status?: string
    amount?: string
    currency?: string
  }
}

const TOLERANCE_SECONDS = 300

/**
 * Checks a delivery against `X-Bachs-Signature-V2` (`t=…,v1=…`, any v1 may match during a secret rotation)
 * or the older `X-Bachs-Timestamp` + `X-Bachs-Signature` pair: HMAC-SHA256 of "{timestamp}.{raw body}".
 */
export function verifyWebhook(rawBody: Buffer, headers: { v2?: string; timestamp?: string; signature?: string }, now = Date.now()): boolean {
  const secret = config.bachs.webhookSecret
  if (!secret) return false
  let timestamp: string | undefined
  let signatures: string[] = []
  if (headers.v2) {
    for (const part of headers.v2.split(',')) {
      const [k, v] = part.split('=', 2).map((x) => x?.trim())
      if (k === 't') timestamp = v
      if (k === 'v1' && v) signatures.push(v)
    }
  } else if (headers.timestamp && headers.signature) {
    timestamp = headers.timestamp
    signatures = [headers.signature]
  }
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'))
  return signatures.some((s) => {
    const given = Buffer.from(s)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
