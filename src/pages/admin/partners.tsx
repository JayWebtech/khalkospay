import { BookOpen, Plus, RefreshCw } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Muted } from '@/components/admin/cells'
import { Time } from '@/components/admin/detail-list'
import { AdminPageHeader } from '@/components/admin/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { type AdminPartner, createPartner, useAdminQuery } from '@/lib/admin'
import { cn } from '@/lib/utils'

const activeKeys = (p: AdminPartner, mode: 'test' | 'live') => p.apiKeys.filter((k) => k.mode === mode && (k.status === 'active' || k.status === 'expiring')).length

/** Developers using the off-ramp API (/v1): who they are, their keys and webhooks at a glance. */
export function AdminPartnersPage() {
  const { data, error, loading, reload } = useAdminQuery<AdminPartner[]>('/api/admin/partners')
  const [creating, setCreating] = useState(false)

  return (
    <>
      <AdminPageHeader
        title="Partners"
        description="Wallets, exchanges and mini apps cashing out NIM through the off-ramp API. Each has test and live keys, webhook URLs and a delivery log."
      >
        <div className="flex flex-wrap gap-2">
          <a href="/developers" target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            <BookOpen aria-hidden="true" />
            API docs
          </a>
          <Button variant="outline" size="lg" onClick={reload} disabled={loading} aria-label="Refresh">
            <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
            <span className="max-sm:sr-only">Refresh</span>
          </Button>
          {!creating && (
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              New partner
            </Button>
          )}
        </div>
      </AdminPageHeader>

      {creating && <NewPartnerForm onCancel={() => setCreating(false)} />}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              {['Partner', 'Status', 'Active keys', 'Webhooks', 'Orders', 'Created'].map((h) => (
                <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data && loading
              ? Array.from({ length: 3 }, (_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td colSpan={6} className="px-3 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ))
              : data?.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2.5">
                      <Link to={`/admin/partners/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                        {p.name}
                      </Link>
                      {p.contactEmail && <div className="text-xs text-muted-foreground">{p.contactEmail}</div>}
                    </td>
                    <td className="px-3 py-2.5">{p.disabled ? <Badge variant="destructive">Disabled</Badge> : <Badge variant="success">Active</Badge>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {activeKeys(p, 'test')} test <Muted>·</Muted> {activeKeys(p, 'live')} live
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <WebhookSet label="Test" url={p.webhooks.test.url} /> <WebhookSet label="Live" url={p.webhooks.live.url} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {(p.orders?.live ?? 0).toLocaleString()} live <Muted>· {(p.orders?.test ?? 0).toLocaleString()} sandbox</Muted>
                    </td>
                    <td className="px-3 py-2.5">
                      <Time iso={p.createdAt} />
                    </td>
                  </tr>
                ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  No partners yet. Add one to hand out API keys.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function WebhookSet({ label, url }: { label: string; url: string | null }) {
  return (
    <Badge variant={url ? 'outline' : 'secondary'} title={url ?? `No ${label.toLowerCase()} webhook URL`}>
      {label} {url ? 'set' : 'none'}
    </Badge>
  )
}

function NewPartnerForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const partner = await createPartner({ name, ...(email.trim() ? { contactEmail: email } : {}) })
      navigate(`/admin/partners/${partner.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the partner')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="New partner" className="mb-5 flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="partner-name">Name</FieldLabel>
          <Input id="partner-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus className="h-9 rounded-lg" />
          <FieldDescription>The company or app, as you’ll recognise it here.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="partner-email">Contact email (optional)</FieldLabel>
          <Input id="partner-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className="h-9 rounded-lg" />
          <FieldDescription>Who to reach about their integration.</FieldDescription>
        </Field>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy && <Spinner />}
          Add partner
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
