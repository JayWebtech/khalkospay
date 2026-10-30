import { ArrowLeft, ChevronRight, Eye, EyeOff, KeyRound, RefreshCw, Send } from 'lucide-react'
import { Fragment, type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActivityList } from '@/components/admin/activity-list'
import { Muted } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { StatusBadge } from '@/components/admin/status-badge'
import { CopyButton } from '@/components/copy-button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  adminApi,
  type AdminApiKey,
  type AdminPartner,
  type AdminWebhookEvent,
  type ApiMode,
  createApiKey,
  type NewApiKey,
  type Page,
  retryWebhookEvent,
  revokeApiKey,
  rotateApiKey,
  rotateWebhookSecret,
  sendTestWebhook,
  updatePartner,
  useAdminQuery,
  WEBHOOK_EVENT_TYPES,
} from '@/lib/admin'
import { cn } from '@/lib/utils'
import { type AdminCashout, CASHOUT_STATUSES, cashoutColumns } from '@/pages/admin/cashouts'

const MODES: ApiMode[] = ['test', 'live']
const modeLabel = (mode: ApiMode) => (mode === 'live' ? 'Live' : 'Test')
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

const GRACE_OPTIONS = [
  { value: '0', label: 'Stop it now' },
  { value: '1', label: '1 hour' },
  { value: '24', label: '24 hours' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
]

export function AdminPartnerPage() {
  const { id = '' } = useParams()
  const { data: partner, error, reload } = useAdminQuery<AdminPartner>(`/api/admin/partners/${encodeURIComponent(id)}`)
  const [deliveriesTick, setDeliveriesTick] = useState(0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link to="/admin/partners" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Partners
        </Link>
        {error && !partner && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {partner ? <PartnerHeader partner={partner} onChange={reload} /> : !error && <Skeleton className="h-8 w-64" />}
      </div>

      {partner && (
        <>
          <KeysCard partner={partner} onChange={reload} />
          <Card>
            <CardHeader>
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>
                Off-ramp events are signed with the mode’s secret in the KhalkosPay-Signature header. Test-key orders only ever go to the test URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {MODES.map((mode) => (
                <WebhookPanel
                  key={`${mode}:${partner.webhooks[mode].url ?? ''}`}
                  partner={partner}
                  mode={mode}
                  onChange={reload}
                  onSent={() => setDeliveriesTick((t) => t + 1)}
                />
              ))}
            </CardContent>
          </Card>
          <DeliveriesCard partnerId={partner.id} tick={deliveriesTick} />
          <OrdersCard partner={partner} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------- header + details

function PartnerHeader({ partner, onChange }: { partner: AdminPartner; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setDisabled(disabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      await updatePartner(partner.id, { disabled })
      setConfirmDisable(false)
      onChange()
    } catch (e) {
      setError(errorText(e, 'Could not change the partner'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-tight">{partner.name}</h1>
            {partner.disabled ? <Badge variant="destructive">Disabled</Badge> : <Badge variant="success">Active</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {partner.contactEmail ?? 'No contact email'} · added <Time iso={partner.createdAt} /> · {(partner.orders?.live ?? 0).toLocaleString()} live and{' '}
            {(partner.orders?.test ?? 0).toLocaleString()} sandbox orders
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            Edit details
          </Button>
          {partner.disabled ? (
            <Button variant="outline" onClick={() => setDisabled(false)} disabled={busy}>
              {busy && <Spinner />}
              Enable
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => setConfirmDisable(true)} disabled={confirmDisable}>
              Disable
            </Button>
          )}
        </div>
      </div>
      {confirmDisable && (
        <ConfirmRow
          message={`Disable ${partner.name}? Every key stops working at once. Orders that already have a deposit still finish.`}
          action="Disable"
          destructive
          busy={busy}
          onConfirm={() => setDisabled(true)}
          onCancel={() => setConfirmDisable(false)}
        />
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {editing && (
        <DetailsForm
          partner={partner}
          onSaved={() => {
            setEditing(false)
            onChange()
          }}
        />
      )}
    </div>
  )
}

function DetailsForm({ partner, onSaved }: { partner: AdminPartner; onSaved: () => void }) {
  const [name, setName] = useState(partner.name)
  const [email, setEmail] = useState(partner.contactEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updatePartner(partner.id, { name, contactEmail: email })
      onSaved()
    } catch (err) {
      setError(errorText(err, 'Could not save'))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="Partner details" className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="edit-name">Name</FieldLabel>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="h-9 rounded-lg" />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-email">Contact email</FieldLabel>
          <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className="h-9 rounded-lg" />
        </Field>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Spinner />}
          Save details
        </Button>
      </div>
    </form>
  )
}

function ConfirmRow({
  message,
  action,
  destructive,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  message: string
  action: string
  destructive?: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
      <p className="mr-auto min-w-0 basis-64 text-sm font-medium text-pretty">{message}</p>
      {children}
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button variant={destructive ? 'destructive-solid' : 'default'} onClick={onConfirm} disabled={busy}>
        {busy && <Spinner />}
        {action}
      </Button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------- API keys

const KEY_STATUS: Record<AdminApiKey['status'], { label: string; variant: 'success' | 'pending' | 'secondary' }> = {
  active: { label: 'Active', variant: 'success' },
  expiring: { label: 'Expiring', variant: 'pending' },
  expired: { label: 'Expired', variant: 'secondary' },
  revoked: { label: 'Revoked', variant: 'secondary' },
}

function KeysCard({ partner, onChange }: { partner: AdminPartner; onChange: () => void }) {
  const [mode, setMode] = useState<ApiMode>('test')
  const [label, setLabel] = useState('')
  const [revealed, setRevealed] = useState<(NewApiKey & { rotated: boolean }) | null>(null)
  const [pending, setPending] = useState<{ kind: 'rotate' | 'revoke'; key: AdminApiKey } | null>(null)
  const [grace, setGrace] = useState('24')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChange()
    } catch (e) {
      setError(errorText(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      setRevealed({ ...(await createApiKey(partner.id, mode, label)), rotated: false })
      setLabel('')
    }, 'Could not create the key')
  }

  const confirm = () => {
    if (!pending) return
    const { kind, key } = pending
    void run(async () => {
      if (kind === 'rotate') setRevealed({ ...(await rotateApiKey(partner.id, key.id, Number(grace))), rotated: true })
      else await revokeApiKey(partner.id, key.id)
      setPending(null)
    }, kind === 'rotate' ? 'Could not rotate the key' : 'Could not revoke the key')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Test keys (kp_test_…) only reach the sandbox; live keys (kp_live_…) move real NIM and naira. Only a hash is kept, so a key is shown once, when it’s made.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {revealed && (
          <Alert>
            <KeyRound aria-hidden="true" />
            <AlertTitle>
              Copy the new {modeLabel(revealed.apiKey.mode).toLowerCase()} key now. It won’t be shown again.
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              {revealed.rotated && <span>The old key keeps working until its expiry time below, then stops.</span>}
              <div className="flex items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground">{revealed.secret}</code>
                <CopyButton value={revealed.secret} label="Copy key" />
              </div>
              <div>
                <Button variant="outline" onClick={() => setRevealed(null)}>
                  I’ve saved it
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={create} aria-label="Create an API key" className="flex flex-wrap items-end gap-2">
          <Field className="w-auto">
            <FieldLabel htmlFor="key-mode">Mode</FieldLabel>
            <Select value={mode} onValueChange={(v) => setMode(v === 'live' ? 'live' : 'test')} items={MODES.map((m) => ({ value: m, label: modeLabel(m) }))}>
              <SelectTrigger id="key-mode" className="h-9 min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {modeLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-auto min-w-0 flex-1 basis-48">
            <FieldLabel htmlFor="key-label">Label (optional)</FieldLabel>
            <Input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. production server" className="h-9 rounded-lg" />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy && !pending && <Spinner />}
            Create key
          </Button>
        </form>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {pending && (
          <ConfirmRow
            message={
              pending.kind === 'rotate'
                ? `Rotate ${pending.key.prefix}…? You get a new key; the old one keeps working for:`
                : `Revoke ${pending.key.prefix}…? Requests with it fail at once.`
            }
            action={pending.kind === 'rotate' ? 'Rotate' : 'Revoke'}
            destructive={pending.kind === 'revoke'}
            busy={busy}
            onConfirm={confirm}
            onCancel={() => setPending(null)}
          >
            {pending.kind === 'rotate' && (
              <Select value={grace} onValueChange={(v) => setGrace(String(v ?? '24'))} items={GRACE_OPTIONS}>
                <SelectTrigger className="h-8 min-w-32" aria-label="Old key keeps working for">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRACE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </ConfirmRow>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {['Key', 'Mode', 'Label', 'Status', 'Last used', 'Created', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partner.apiKeys.map((k) => {
                const usable = k.status === 'active' || k.status === 'expiring'
                return (
                  <tr key={k.id} className={cn('border-t', !usable && 'text-muted-foreground')}>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{k.prefix}…</td>
                    <td className="px-3 py-2">
                      <Badge variant={k.mode === 'live' ? 'default' : 'outline'}>{modeLabel(k.mode)}</Badge>
                    </td>
                    <td className="px-3 py-2">{k.label || <Muted>—</Muted>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge variant={KEY_STATUS[k.status].variant}>{KEY_STATUS[k.status].label}</Badge>
                      {k.status === 'expiring' && k.expiresAt && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          until <Time iso={k.expiresAt} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Time iso={k.lastUsedAt} />
                    </td>
                    <td className="px-3 py-2">
                      <Time iso={k.createdAt} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {usable && (
                        <div className="flex justify-end gap-1">
                          {k.status === 'active' && !k.replacedById && (
                            <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'rotate', key: k })} disabled={busy}>
                              Rotate
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setPending({ kind: 'revoke', key: k })} disabled={busy}>
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {partner.apiKeys.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No keys yet. Start with a test key so they can build against the sandbox.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------------------------------------- webhooks

function WebhookPanel({ partner, mode, onChange, onSent }: { partner: AdminPartner; mode: ApiMode; onChange: () => void; onSent: () => void }) {
  const saved = partner.webhooks[mode]
  const [url, setUrl] = useState(saved.url ?? '')
  const [showSecret, setShowSecret] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [type, setType] = useState<string>('offramp.paid')
  const [result, setResult] = useState<AdminWebhookEvent | null>(null)
  const [busy, setBusy] = useState<'save' | 'rotate' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const field = mode === 'live' ? 'webhookUrlLive' : 'webhookUrlTest'

  async function run(kind: 'save' | 'rotate' | 'test', work: () => Promise<void>, fallback: string) {
    setBusy(kind)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(errorText(e, fallback))
    } finally {
      setBusy(null)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run('save', async () => {
      await updatePartner(partner.id, { [field]: url.trim() })
      onChange()
    }, 'Could not save the URL')
  }

  const delivery = result?.deliveries[0]

  return (
    <section aria-label={`${modeLabel(mode)} webhooks`} className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant={mode === 'live' ? 'default' : 'outline'}>{modeLabel(mode)}</Badge>
        <h3 className="text-sm font-semibold">{mode === 'live' ? 'Live keys' : 'Test keys (sandbox)'}</h3>
      </div>

      <form onSubmit={save} className="flex flex-col gap-1.5">
        <FieldLabel htmlFor={`hook-${mode}`}>Endpoint URL</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={`hook-${mode}`}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/khalkospay"
            maxLength={500}
            className="h-9 min-w-0 flex-1 rounded-lg font-mono text-xs"
          />
          <Button type="submit" variant="outline" size="lg" disabled={busy !== null || url.trim() === (saved.url ?? '')}>
            {busy === 'save' && <Spinner />}
            Save
          </Button>
        </div>
        <FieldDescription>https, or http on localhost for local testing. Leave empty to stop sending; events are still kept.</FieldDescription>
      </form>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Signing secret</span>
        <div className="flex items-center gap-1 rounded-lg bg-muted py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">{showSecret ? saved.secret : `${saved.secret.slice(0, 9)}${'•'.repeat(16)}`}</code>
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setShowSecret((v) => !v)} aria-label={showSecret ? 'Hide secret' : 'Show secret'}>
            {showSecret ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
          <CopyButton value={saved.secret} label="Copy secret" />
        </div>
        {confirmRotate ? (
          <ConfirmRow
            message="Rotate this secret? Deliveries are signed with the new one at once, so the partner must update theirs."
            action="Rotate secret"
            destructive
            busy={busy === 'rotate'}
            onConfirm={() =>
              void run('rotate', async () => {
                await rotateWebhookSecret(partner.id, mode)
                setConfirmRotate(false)
                onChange()
              }, 'Could not rotate the secret')
            }
            onCancel={() => setConfirmRotate(false)}
          />
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRotate(true)}>
              <RefreshCw aria-hidden="true" />
              Rotate secret
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Send a test event</span>
        <div className="flex flex-wrap gap-2">
          <Select value={type} onValueChange={(v) => setType(String(v ?? 'offramp.paid'))} items={WEBHOOK_EVENT_TYPES.map((t) => ({ value: t, label: t }))}>
            <SelectTrigger className="h-9 min-w-0 flex-1 basis-52 font-mono text-xs" aria-label="Event type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBHOOK_EVENT_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="font-mono text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="lg"
            disabled={busy !== null || !saved.url}
            title={saved.url ? undefined : 'Save an endpoint URL first'}
            onClick={() =>
              void run('test', async () => {
                setResult(await sendTestWebhook(partner.id, mode, type))
                onSent()
              }, 'Could not send the test event')
            }
          >
            {busy === 'test' ? <Spinner /> : <Send aria-hidden="true" />}
            Send
          </Button>
        </div>
        {result && delivery && (
          <p role="status" className={cn('text-sm', result.status === 'delivered' ? 'text-success' : 'text-destructive')}>
            {result.status === 'delivered' ? 'Delivered' : 'Not delivered'}
            {delivery.statusCode !== null ? ` · HTTP ${delivery.statusCode}` : ''} · {delivery.durationMs} ms
            {delivery.error ? ` · ${delivery.error}` : ''}
          </p>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

function DeliveriesCard({ partnerId, tick }: { partnerId: string; tick: number }) {
  const [mode, setMode] = useState<'' | ApiMode>('')
  const [items, setItems] = useState<AdminWebhookEvent[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  const url = useCallback(
    (cursor: string | null) =>
      `/api/admin/partners/${encodeURIComponent(partnerId)}/webhook-events?limit=25${mode ? `&mode=${mode}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    [partnerId, mode],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    adminApi<Page<AdminWebhookEvent>>(url(null), { signal: controller.signal })
      .then((page) => {
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorText(e, 'Could not load deliveries'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, tick, reloads])

  async function loadMore() {
    if (!nextCursor) return
    try {
      const page = await adminApi<Page<AdminWebhookEvent>>(url(nextCursor))
      setItems((prev) => [...prev, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (e) {
      setError(errorText(e, 'Could not load more'))
    }
  }

  async function retry(event: AdminWebhookEvent) {
    setRetrying(event.id)
    try {
      await retryWebhookEvent(partnerId, event.id)
      // The attempt runs in the background; give it a moment before showing the result.
      setTimeout(() => setReloads((n) => n + 1), 1_500)
    } catch (e) {
      setError(errorText(e, 'Could not retry'))
    } finally {
      setRetrying(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Webhook deliveries</CardTitle>
          <CardDescription>Every event and each attempt to deliver it. Failed attempts are retried with backoff for about two days.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Select
            value={mode || 'all'}
            onValueChange={(v) => setMode(v === 'test' || v === 'live' ? v : '')}
            items={[{ value: 'all', label: 'Both modes' }, ...MODES.map((m) => ({ value: m, label: modeLabel(m) }))]}
          >
            <SelectTrigger className="h-9 min-w-32" aria-label="Mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both modes</SelectItem>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {modeLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="lg" onClick={() => setReloads((n) => n + 1)} disabled={loading} aria-label="Refresh deliveries">
            <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-9" aria-label="Details" />
                {['Created', 'Event', 'Mode', 'Status', 'Attempts', 'Last result'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const expanded = open === e.id
                const last = e.deliveries.at(-1)
                return (
                  <Fragment key={e.id}>
                    <tr className={cn('cursor-pointer border-t hover:bg-muted/50', expanded && 'bg-muted/40')} onClick={() => setOpen(expanded ? null : e.id)}>
                      <td className="pl-2">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Hide attempts' : 'Show attempts'}
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <Time iso={e.createdAt} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {e.type}
                        {!e.orderId && <Muted> · test</Muted>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={e.livemode ? 'default' : 'outline'}>{e.livemode ? 'Live' : 'Test'}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={e.status.toUpperCase()} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{e.attempts}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {last ? (last.statusCode !== null ? `HTTP ${last.statusCode}` : (last.error ?? '—')) : (e.lastError ?? <Muted>—</Muted>)}
                        {e.status === 'pending' && e.nextAttemptAt && (
                          <Muted>
                            {' '}
                            · next <Time iso={e.nextAttemptAt} />
                          </Muted>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={7} className="px-4 py-3">
                          <EventDetail event={e} retrying={retrying === e.id} onRetry={() => void retry(e)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No events yet.
                  </td>
                </tr>
              )}
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div>
            <Button variant="outline" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function EventDetail({ event, retrying, onRetry }: { event: AdminWebhookEvent; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Event <span className="font-mono text-foreground">{event.id}</span>
        </span>
        {event.orderId && (
          <span>
            Order <span className="font-mono text-foreground">{event.orderId}</span>
          </span>
        )}
        {event.lastError && <span className="text-destructive">{event.lastError}</span>}
        {event.orderId && event.status !== 'delivered' && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} className="ml-auto">
            {retrying && <Spinner />}
            Retry now
          </Button>
        )}
      </div>
      {event.deliveries.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {['#', 'Sent', 'Result', 'Time', 'Response', 'URL'].map((h) => (
                  <th key={h} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {event.deliveries.map((d) => (
                <tr key={d.attempt} className="border-t">
                  <td className="px-2.5 py-1.5 tabular-nums">{d.attempt}</td>
                  <td className="px-2.5 py-1.5">
                    <Time iso={d.createdAt} />
                  </td>
                  <td className={cn('px-2.5 py-1.5 whitespace-nowrap', d.statusCode !== null && d.statusCode < 300 ? 'text-success' : 'text-destructive')}>
                    {d.statusCode !== null ? `HTTP ${d.statusCode}` : (d.error ?? 'No response')}
                  </td>
                  <td className="px-2.5 py-1.5 tabular-nums">{d.durationMs} ms</td>
                  <td className="max-w-64 truncate px-2.5 py-1.5 font-mono" title={d.responseBody ?? undefined}>
                    {d.responseBody ?? '—'}
                  </td>
                  <td className="max-w-64 truncate px-2.5 py-1.5 font-mono" title={d.url}>
                    {d.url}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No delivery attempts{event.status === 'skipped' ? ': there was no webhook URL for this mode.' : ' yet.'}</p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Payload</summary>
        <pre className="mt-1.5 max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono">{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </div>
  )
}

// ------------------------------------------------------------------------------------------- orders

function OrdersCard({ partner }: { partner: AdminPartner }) {
  const [mode, setMode] = useState<ApiMode>('live')
  return (
    <section aria-label="Cash-outs" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-semibold">Cash-outs</h2>
          <p className="text-sm text-muted-foreground">Orders this partner made through the API. Sandbox ones are simulated and stay out of every total.</p>
        </div>
        <div role="group" aria-label="Mode" className="flex w-fit gap-1 rounded-lg bg-muted p-[3px]">
          {MODES.slice()
            .reverse()
            .map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className="rounded-md px-3 py-1 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {m === 'live' ? 'Live' : 'Sandbox'}
              </button>
            ))}
        </div>
      </div>
      <ActivityList<AdminCashout>
        key={mode}
        endpoint={`/api/admin/cashouts?partnerId=${encodeURIComponent(partner.id)}&mode=${mode}`}
        statuses={CASHOUT_STATUSES}
        noun={['cash-out', 'cash-outs']}
        searchPlaceholder="Search reference, their reference or account"
        columns={[...cashoutColumns, { header: 'Their reference', cell: (o) => (o.partnerReference ? <span className="font-mono text-xs">{o.partnerReference}</span> : <Muted>—</Muted>) }]}
      />
    </section>
  )
}
