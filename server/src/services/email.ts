import { config } from '../config'

export class EmailError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }

  /** Resend rejected the request itself (bad address, unverified sender); retrying won't help. */
  get isDefinitive() {
    return this.status >= 400 && this.status < 500 && this.status !== 429
  }
}

export function emailConfigured() {
  return Boolean(config.resend.apiKey && config.resend.from)
}

/** Sends through Resend. The idempotency key makes a retried request a no-op for 24 hours. */
export async function sendEmail(email: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<string> {
  if (!emailConfigured()) throw new EmailError(503, 'Email is not configured on this server')
  let res: Response
  try {
    res = await fetch(`${config.resend.baseUrl.replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resend.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey,
      },
      body: JSON.stringify({ from: config.resend.from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    throw new EmailError(0, `Could not reach Resend: ${e instanceof Error ? e.message : e}`)
  }
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
  if (!res.ok) throw new EmailError(res.status, body?.message ?? `Resend responded with HTTP ${res.status}`)
  return body?.id ?? ''
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
