import { ArrowRight, ExternalLink } from 'lucide-react'
import { Fragment, type ReactNode, useEffect } from 'react'
import { BrandMark } from '@/components/brand-mark'
import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { API_URL } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Public developer docs for the off-ramp API at /developers. Its own bundle, like /admin, so the mini app never loads it.
 * The machine-readable reference is the OpenAPI spec the server serves at /v1/openapi.json.
 */

const BASE = `${API_URL}/v1`
const SPEC = `${BASE}/openapi.json`
const SWAGGER = `${BASE}/docs`

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'auth', label: 'Authentication' },
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'lifecycle', label: 'Order lifecycle' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'errors', label: 'Errors' },
  { id: 'idempotency', label: 'Idempotency' },
  { id: 'sandbox', label: 'Sandbox' },
  { id: 'limits', label: 'Rate limits' },
  { id: 'reference', label: 'Endpoints' },
]

export function DevelopersApp() {
  useEffect(() => {
    const previous = document.title
    document.title = 'KhalkosPay off-ramp API'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-2.5 px-4 sm:px-6">
          <BrandMark className="size-6" />
          <span className="font-heading text-[0.9375rem] font-semibold">KhalkosPay</span>
          <span className="text-sm text-muted-foreground">Developers</span>
          <div className="ml-auto flex items-center gap-4">
            <a href={SWAGGER} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              Swagger UI
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
            <a href={SPEC} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline max-sm:hidden">
              OpenAPI spec
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="max-lg:hidden">
          <ul className="sticky top-20 flex flex-col gap-0.5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-col gap-14 pb-16">
          <Overview />
          <Auth />
          <Quickstart />
          <Lifecycle />
          <Webhooks />
          <Errors />
          <Idempotency />
          <Sandbox />
          <Limits />
          <Reference />
        </main>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------- building blocks

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4">
      <h2 id={`${id}-title`} className="font-heading text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[70ch] text-[0.9375rem] leading-relaxed text-foreground/90">{children}</p>
}

function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem]">{children}</code>
}

function Code({ code, label }: { code: string; label: string }) {
  return (
    <figure className="relative min-w-0 overflow-hidden rounded-xl bg-hero text-hero-foreground">
      <figcaption className="flex h-9 items-center justify-between border-b border-hero-foreground/10 pr-0.5 pl-4 text-xs text-hero-muted">
        {label}
        <span className="[&_button]:size-9 [&_button]:text-hero-muted [&_button:hover]:bg-hero-foreground/10 [&_button:hover]:text-hero-foreground">
          <CopyButton value={code} label={`Copy ${label}`} />
        </span>
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  )
}

function Table({ head, rows, mono = [0] }: { head: string[]; rows: ReactNode[][]; mono?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t align-top">
              {row.map((cell, j) => (
                <td key={j} className={cn('px-3 py-2', mono.includes(j) && 'font-mono text-[0.8125rem] whitespace-nowrap')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return <div className="max-w-[70ch] rounded-xl border-l-4 border-primary bg-accent/60 px-4 py-3 text-sm text-pretty text-accent-foreground">{children}</div>
}

// ------------------------------------------------------------------------------------------- sections

function Overview() {
  return (
    <Section id="overview" title="Cash out NIM to Nigerian bank accounts">
      <P>
        The KhalkosPay off-ramp API lets wallets, exchanges and other Nimiq mini apps turn their users’ NIM into naira in any Nigerian bank account. You quote,
        create an off-ramp, and your user sends NIM with a memo. KhalkosPay confirms the deposit on chain, pays the bank through Paystack, and refunds the NIM
        automatically if the payout can’t go through. Webhooks tell your server about every step.
      </P>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Base URL', BASE],
          ['Format', 'JSON over HTTPS, server to server'],
          ['Reference', '/v1/docs (Swagger UI) · /v1/openapi.json (OpenAPI 3.1)'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-0.5 font-mono text-[0.8125rem] wrap-anywhere">{v}</div>
          </div>
        ))}
      </div>
      <P>
        To get keys, ask KhalkosPay to add you as a partner. You get a test key for the sandbox right away and a live key when you’re ready to move real money.
      </P>
    </Section>
  )
}

function Auth() {
  return (
    <Section id="auth" title="Authentication">
      <P>
        Send your secret key as a bearer token on every request. Keys starting <C>kp_test_</C> use the sandbox, where nothing touches the Nimiq network or a
        bank. Keys starting <C>kp_live_</C> move real NIM and naira. Each key only ever sees your own off-ramps, and only those made in its mode.
      </P>
      <Code label="Header" code={`Authorization: Bearer kp_test_…`} />
      <Callout>
        Keep secret keys on your server. Never ship one in a browser, a mobile app or a mini app. KhalkosPay only stores a hash, so a lost key can’t be shown
        again: ask for it to be rotated. Rotating gives you a new key while the old one keeps working for a grace period, so you can deploy without downtime.
      </Callout>
    </Section>
  )
}

const curlQuickstart = `export KHALKOS_KEY=kp_test_…   # your test key
API=${BASE}

# 1. Rate, fees and limits
curl $API/rates -H "Authorization: Bearer $KHALKOS_KEY"

# 2. Check the bank account and show the name to your user
curl -X POST $API/bank-accounts/resolve \\
  -H "Authorization: Bearer $KHALKOS_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"bankCode":"058","accountNumber":"0123456789"}'

# 3. Create the off-ramp: the rate is locked and you get deposit instructions
curl -X POST $API/offramps \\
  -H "Authorization: Bearer $KHALKOS_KEY" \\
  -H "Idempotency-Key: withdrawal-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nimAmount": "1000",
    "bankCode": "058",
    "accountNumber": "0123456789",
    "reference": "withdrawal-1001",
    "metadata": { "userId": "u_42" },
    "refundAddress": "NQ07 0000 0000 0000 0000 0000 0000 0000 0000"
  }'

# 4. Sandbox only: pretend the NIM arrived
curl -X POST $API/sandbox/offramps/$OFFRAMP_ID/deposit \\
  -H "Authorization: Bearer $KHALKOS_KEY" \\
  -H "Idempotency-Key: $(uuidgen)"

# 5. Follow it (or wait for webhooks)
curl $API/offramps/$OFFRAMP_ID -H "Authorization: Bearer $KHALKOS_KEY"`

const nodeQuickstart = `// Node 18+. npm i nothing: fetch and crypto are built in.
const API = '${BASE}'
const KEY = process.env.KHALKOS_KEY

async function khalkos(method, path, body, idempotencyKey) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: \`Bearer \${KEY}\`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw Object.assign(new Error(json.error.message), { code: json.error.code, status: res.status })
  return json
}

// One idempotency key per withdrawal: retrying after a timeout can never create two off-ramps.
export async function startCashOut(withdrawal) {
  const quote = await khalkos('POST', '/quotes', { nimAmount: withdrawal.nim }, \`quote-\${withdrawal.id}\`)
  if (quote.belowMinimum || quote.aboveMaximum) throw new Error(\`Between \${quote.minNim} and \${quote.maxNim} NIM\`)

  const offramp = await khalkos('POST', '/offramps', {
    nimAmount: withdrawal.nim,
    bankCode: withdrawal.bankCode,
    accountNumber: withdrawal.accountNumber,
    reference: withdrawal.id,
    refundAddress: withdrawal.refundAddress, // set it whenever you send from an exchange or custodial wallet
  }, \`offramp-\${withdrawal.id}\`)

  // Send exactly offramp.deposit.nimAmount NIM to offramp.deposit.address
  // with offramp.deposit.memo as the transaction message, before offramp.expiresAt.
  return offramp
}`

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart">
      <P>
        These run against the sandbox with a test key. With a live key, step 4 is replaced by your user (or your hot wallet) actually sending the NIM.
      </P>
      <Code label="curl" code={curlQuickstart} />
      <Code label="Node.js" code={nodeQuickstart} />
      <Callout>
        The deposit must carry the memo as its message: that’s how it’s matched to the off-ramp. Deposits are found on chain by their memo even if you never
        report them; <C>POST /offramps/:id/deposit</C> with the transaction hash only makes it faster.
      </Callout>
    </Section>
  )
}

const flow: { status: string; note: string }[][] = [
  [
    { status: 'awaiting_deposit', note: 'Rate locked. Waiting for NIM with the memo.' },
    { status: 'confirming', note: 'Transaction seen, waiting for confirmations.' },
    { status: 'paying_out', note: 'Deposit confirmed. Bank transfer started.' },
    { status: 'completed', note: 'Naira is in the account.' },
  ],
  [
    { status: 'payout_failed', note: 'Transfer failed, or the deposit was short or late.' },
    { status: 'refunding', note: 'NIM on its way back.' },
    { status: 'refunded', note: 'Refund confirmed on chain.' },
  ],
]

function Lifecycle() {
  return (
    <Section id="lifecycle" title="Order lifecycle">
      <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        {flow.map((row, i) => (
          <ol key={i} aria-label={i === 0 ? 'Paid out' : 'Refunded'} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
            {row.map((step, j) => (
              <Fragment key={step.status}>
                {j > 0 && <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground max-sm:rotate-90" aria-hidden="true" />}
                <li className="flex min-w-36 flex-1 flex-col gap-1 rounded-lg bg-muted/60 p-2.5">
                  <span className="font-mono text-[0.8125rem] font-medium">{step.status}</span>
                  <span className="text-xs text-muted-foreground">{step.note}</span>
                </li>
              </Fragment>
            ))}
          </ol>
        ))}
      </div>
      <Table
        head={['Status', 'Meaning', 'Webhook']}
        rows={[
          ['awaiting_deposit', 'Created. Send exactly deposit.nimAmount with deposit.memo before expiresAt.', '—'],
          ['confirming', 'A deposit was reported or found and is waiting for confirmations.', '—'],
          ['paying_out', 'The deposit is confirmed; the bank transfer is in progress.', 'offramp.deposit_confirmed'],
          ['completed', 'The bank transfer succeeded.', 'offramp.paid'],
          ['payout_failed', 'The transfer failed, or the deposit was short or arrived after the quote expired. A refund follows on its own.', 'offramp.payout_failed'],
          ['refunding', 'The refund transaction was sent: to refundAddress if you set one, otherwise to the sender.', '—'],
          ['refunded', 'The refund is confirmed on chain. refund.txHash has the transaction.', 'offramp.refunded'],
          ['expired', 'No deposit before expiresAt. A deposit that still arrives is refunded.', 'offramp.expired'],
          ['rejected', 'The reported transaction didn’t match (wrong address, memo, or failed). The off-ramp takes another deposit.', '—'],
        ]}
        mono={[0, 2]}
      />
      <Callout>
        Set <C>refundAddress</C> whenever the NIM comes from an exchange or a custodial wallet. Those send from shared hot wallets, so a refund to the sender
        would never reach your user.
      </Callout>
    </Section>
  )
}

const webhookExample = `POST /webhooks/khalkospay HTTP/1.1
Content-Type: application/json
KhalkosPay-Signature: t=1798632000,v1=5f2b…c9
KhalkosPay-Event-Id: 2f0c6a4e-…
KhalkosPay-Event-Type: offramp.paid

{
  "id": "2f0c6a4e-…",
  "object": "event",
  "type": "offramp.paid",
  "livemode": true,
  "createdAt": "2026-10-30T12:00:00.000Z",
  "data": {
    "id": "8d1e…",
    "object": "offramp",
    "status": "completed",
    "reference": "withdrawal-1001",
    "nimAmount": "1000",
    "payoutNgn": 1574,
    "deposit": { "address": "NQ…", "memo": "khalkos-…", "txHash": "…", "receivedNim": "1000" },
    "paidAt": "2026-10-30T12:00:00.000Z",
    …
  }
}`

const verifyExample = `import { createHmac, timingSafeEqual } from 'node:crypto'
import express from 'express'

const app = express()

// Keep the raw body: the signature covers the exact bytes that were sent.
app.post('/webhooks/khalkospay', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('KhalkosPay-Signature') ?? ''
  const { t, v1 } = Object.fromEntries(header.split(',').map((part) => part.split('=')))
  const expected = createHmac('sha256', process.env.KHALKOS_WEBHOOK_SECRET) // whsec_…
    .update(\`\${t}.\${req.body}\`)
    .digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300
  const valid = typeof v1 === 'string' && v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected))
  if (!fresh || !valid) return res.sendStatus(400)

  const event = JSON.parse(req.body)
  // Deduplicate on event.id, then act on event.type and event.data.status.
  res.sendStatus(200)
})`

function Webhooks() {
  return (
    <Section id="webhooks" title="Webhooks">
      <P>
        You get one URL and one signing secret (<C>whsec_…</C>) per mode. Events for test-key off-ramps only go to the test URL. Each event is a JSON POST with
        the off-ramp as it was at that moment in <C>data</C>.
      </P>
      <Table
        head={['Event', 'When']}
        rows={[
          ['offramp.deposit_confirmed', 'The deposit has enough confirmations. Sent even when it is short or late, followed by payout_failed.'],
          ['offramp.paid', 'The naira reached the bank account.'],
          ['offramp.payout_failed', 'No payout: the transfer failed, or the deposit was short or late. A refund is on its way.'],
          ['offramp.refunded', 'The NIM is back, confirmed on chain.'],
          ['offramp.expired', 'The quote ran out with no deposit.'],
        ]}
      />
      <Code label="Example delivery" code={webhookExample} />
      <h3 className="font-heading text-base font-semibold">Verify the signature</h3>
      <P>
        <C>KhalkosPay-Signature</C> is <C>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</C>, where <C>v1</C> is the HMAC-SHA256 of <C>t</C>, a dot, and the raw request
        body, keyed with your whole <C>whsec_…</C> secret. Reject anything older than five minutes.
      </P>
      <Code label="Node.js (Express)" code={verifyExample} />
      <h3 className="font-heading text-base font-semibold">Delivery and retries</h3>
      <ul className="flex max-w-[70ch] list-disc flex-col gap-1.5 pl-5 text-[0.9375rem] leading-relaxed text-foreground/90">
        <li>Answer with any 2xx within 10 seconds. Do the work afterwards.</li>
        <li>
          Anything else is retried after 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h and 24 h: ten attempts over about two days. Every retry sends the same
          body, freshly signed.
        </li>
        <li>Events can arrive more than once or out of order. Deduplicate on the event id and trust data.status, or fetch the off-ramp.</li>
        <li>
          <C>POST /webhooks/test</C> sends a signed sample of any event type (marked <C>"sample": true</C>) and tells you how your endpoint answered.{' '}
          <C>GET /webhooks/events</C> lists every event with each delivery attempt.
        </li>
      </ul>
    </Section>
  )
}

function Errors() {
  return (
    <Section id="errors" title="Errors">
      <P>Every error has the same shape, with a stable code to branch on and a message for people.</P>
      <Code label="Error body" code={`{ "error": { "code": "below_minimum", "message": "Minimum payout is ₦100 (about 70 NIM)" } }`} />
      <Table
        head={['HTTP', 'Codes', 'What to do']}
        rows={[
          ['400', 'invalid_request, unknown_parameter, invalid_json', 'Fix the request; the message names the parameter.'],
          ['400', 'invalid_amount, below_minimum, above_maximum', 'Use an amount within the limits from GET /rates or the quote.'],
          ['400', 'invalid_bank, invalid_account_number, account_not_found', 'Ask your user to check the bank and the 10-digit account number.'],
          ['400', 'invalid_refund_address, invalid_metadata', 'Send a payable Nimiq address; flat metadata only.'],
          ['400', 'idempotency_key_required, invalid_idempotency_key', 'Add an Idempotency-Key header to the POST.'],
          ['401', 'missing_api_key, invalid_api_key, api_key_revoked, api_key_expired', 'Check the key you are sending.'],
          ['403', 'partner_disabled, sandbox_only', 'Contact KhalkosPay, or use a test key for sandbox endpoints.'],
          ['404', 'offramp_not_found, not_found', 'The id isn’t yours, or belongs to the other mode.'],
          ['409', 'order_not_awaiting_deposit, tx_already_used, idempotency_key_in_use', 'Fetch the off-ramp for its current state; retry in-flight requests later.'],
          ['422', 'idempotency_key_reused', 'This key went with a different request. Use a new key.'],
          ['429', 'rate_limited', 'Back off until the time in the RateLimit header.'],
          ['502', 'bank_provider_unavailable', 'Retry with the same Idempotency-Key.'],
          ['503', 'rate_unavailable, nimiq_unavailable, offramp_not_configured', 'Temporary. Retry later with the same key.'],
        ]}
        mono={[0, 1]}
      />
    </Section>
  )
}

function Idempotency() {
  return (
    <Section id="idempotency" title="Idempotency">
      <P>
        Every POST needs an <C>Idempotency-Key</C> header: any string up to 255 characters, unique per operation. Your own withdrawal id works well. Send the
        same key with the same request and you get the first response back, marked <C>Idempotent-Replayed: true</C>, so a retry after a timeout never creates a
        second off-ramp. The same key with a different body gets <C>422 idempotency_key_reused</C>.
      </P>
      <P>
        Keys are remembered for 24 hours, separately for each mode. Answers of 500 or above and 429 are not remembered, so you can retry those with the same
        key.
      </P>
    </Section>
  )
}

function Sandbox() {
  return (
    <Section id="sandbox" title="Sandbox">
      <P>
        Test keys run the same API, states and webhooks as live, but nothing reaches the Nimiq network or a bank. Banks come from a fixed list, account names
        are made up, and you simulate what the chain and the bank would do. Each simulated step takes a few seconds, so you can watch every status go by.
      </P>
      <Table
        head={['To test', 'Do this']}
        rows={[
          ['A full payout', <>POST /sandbox/offramps/:id/deposit with an empty body. Or report any 64-character hash to POST /offramps/:id/deposit.</>],
          ['A bank transfer that fails', <>POST /sandbox/offramps/:id/deposit with {'{ "payout": "failed" }'}: payout_failed, then refunded.</>],
          ['A short deposit', <>POST /sandbox/offramps/:id/deposit with {'{ "nimAmount": "10" }'}: refunded in full.</>],
          ['An expired quote', <>POST /sandbox/offramps/:id/expire. A deposit simulated afterwards is refunded as late.</>],
          ['An account that doesn’t exist', <>Resolve or create with account number 0000000000.</>],
          ['Your webhook endpoint', <>POST /webhooks/test with {'{ "type": "offramp.refunded" }'}, or any event type.</>],
        ]}
        mono={[]}
      />
      <Callout>
        Never send real NIM to a sandbox off-ramp. Sandbox memos start with <C>khalkos-test-</C> and are never matched, so the NIM would wait for a manual
        refund.
      </Callout>
    </Section>
  )
}

function Limits() {
  return (
    <Section id="limits" title="Rate limits">
      <P>
        Each key can make 120 requests a minute, of which 30 can be bank account lookups. Responses carry <C>RateLimit</C> and <C>RateLimit-Policy</C> headers;
        over the limit you get <C>429 rate_limited</C>. Payout amounts must be between the minimum and maximum in <C>GET /rates</C>, per off-ramp.
      </P>
    </Section>
  )
}

function Reference() {
  const endpoints: [string, string, string][] = [
    ['GET', '/rates', 'Current NIM→NGN rate, service fee, payout limits and quote lifetime.'],
    ['GET', '/banks', 'Banks that can receive payouts, popular ones first.'],
    ['POST', '/bank-accounts/resolve', 'The name on a bank account.'],
    ['POST', '/quotes', 'What an amount of NIM pays out after fees.'],
    ['POST', '/offramps', 'Create an off-ramp and get its deposit instructions.'],
    ['GET', '/offramps', 'Your off-ramps, newest first. Filter by status and reference; page with cursor.'],
    ['GET', '/offramps/:id', 'One off-ramp.'],
    ['POST', '/offramps/:id/deposit', 'Report the deposit transaction hash (optional).'],
    ['POST', '/sandbox/offramps/:id/deposit', 'Test keys: simulate a deposit and its outcome.'],
    ['POST', '/sandbox/offramps/:id/expire', 'Test keys: expire an off-ramp now.'],
    ['POST', '/webhooks/test', 'Send a signed sample event to your URL now.'],
    ['GET', '/webhooks/events', 'Events sent to you, with every delivery attempt.'],
  ]
  return (
    <Section id="reference" title="Endpoints">
      <P>
        All paths are under <C>{BASE}</C>. Browse and try every endpoint in{' '}
        <a href={SWAGGER} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
          Swagger UI
        </a>{' '}
        with a test key (Authorize, then paste it). Request and response schemas are in the{' '}
        <a href={SPEC} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
          OpenAPI spec
        </a>
        , which most API clients and code generators can import.
      </P>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <tbody>
            {endpoints.map(([method, path, what]) => (
              <tr key={`${method} ${path}`} className="border-t first:border-0">
                <td className="w-16 py-2 pl-3">
                  <Badge variant={method === 'GET' ? 'secondary' : 'default'} className="font-mono">
                    {method}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-[0.8125rem] whitespace-nowrap">{path}</td>
                <td className="px-3 py-2 text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
