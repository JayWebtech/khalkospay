import { CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { ActivityList } from '@/components/admin/activity-list'
import { Address, Amount, Muted, Reference } from '@/components/admin/cells'
import { DetailList, Time } from '@/components/admin/detail-list'
import { StatusBadge } from '@/components/admin/status-badge'
import { AdminPageHeader } from '@/components/admin/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { type AdminOnrampOrder, type SettleBody, settleBuy } from '@/lib/admin'
import { formatFiat, formatNim, shortAddress } from '@/lib/format'

const STATUSES = ['AWAITING_PAYMENT', 'PAID', 'SENDING', 'COMPLETED', 'EXPIRED', 'NEEDS_REVIEW', 'RESOLVED'] as const

export function AdminBuysPage() {
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <>
      <AdminPageHeader
        title="Buy NIM"
        description="Purchases of NIM with local currency through Bachs. Purchases held for review can be settled from their details."
      />
      {notice && (
        <Alert className="mb-4">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <ActivityList<AdminOnrampOrder>
        endpoint="/api/admin/onramp"
        statuses={STATUSES}
        noun={['purchase', 'purchases']}
        searchPlaceholder="Search reference, wallet or checkout"
        unpaged={{
          search: (o, q) =>
            [o.id, o.reference, o.walletAddress, o.payoutAddress, o.checkoutId ?? '', o.chargeId ?? ''].some((v) => v.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, ''))),
        }}
        columns={[
          { header: 'Created', cell: (o) => <Time iso={o.createdAt} /> },
          { header: 'Reference', cell: (o) => <Reference value={o.reference} /> },
          { header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
          {
            header: 'Price',
            cell: (o) => (
              <Amount>
                {formatFiat(o.amount, o.currency)}
                {o.paidAmount !== null && o.paidAmount !== o.amount && <Muted> · paid {formatFiat(o.paidAmount, o.currency)}</Muted>}
              </Amount>
            ),
          },
          { header: 'NIM', cell: (o) => <Amount>{formatNim(o.nimAmount)}</Amount> },
          { header: 'Wallet', cell: (o) => <Address value={o.walletAddress} /> },
        ]}
        renderDetail={(o, reload) => (
          <div className="flex flex-col gap-5">
            {o.status === 'NEEDS_REVIEW' && (
              <SettlePanel
                order={o}
                onSettled={(message) => {
                  setNotice(message)
                  reload()
                }}
              />
            )}
            <DetailList data={o} omit={['checkoutUrl']} />
          </div>
        )}
      />
    </>
  )
}

function SettlePanel({ order, onSettled }: { order: AdminOnrampOrder; onSettled: (message: string) => void }) {
  const [note, setNote] = useState('')
  const [refundRef, setRefundRef] = useState('')
  const [pending, setPending] = useState<SettleBody | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendAmount = (body: SettleBody) => (body.action === 'send' && body.mode === 'pro-rata' ? order.proRataNimAmount! : order.nimAmount)
  const describe = (body: SettleBody) =>
    body.action === 'send'
      ? `Send ${formatNim(sendAmount(body), 5)} to ${shortAddress(order.payoutAddress)} from the treasury.`
      : `Close ${order.reference} as refunded outside KhalkosPay. No NIM is sent and the reserved NIM goes back on sale.`

  async function confirm() {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const updated = await settleBuy(order.id, pending)
      onSettled(
        pending.action === 'send'
          ? `${order.reference}: sending ${formatNim(sendAmount(pending), 5)}. It shows as Completed once the payment confirms.`
          : `${updated.reference} is closed as refunded. Its NIM is back on sale.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not settle this purchase')
      setPending(null)
    } finally {
      setBusy(false)
    }
  }

  const trimmedNote = note.trim()
  const withNote = <T extends SettleBody>(body: T): T => (trimmedNote ? { ...body, note: trimmedNote } : body)

  return (
    <section aria-label="Settle this purchase" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold">Held for review</h3>
        <p className="text-sm text-pretty text-muted-foreground">
          {order.failureReason ?? 'This purchase needs an operator decision.'}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`note-${order.id}`}>Note</FieldLabel>
          <Textarea id={`note-${order.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Why, and what you did" />
          <FieldDescription>Required to close. Kept on the order, never shown to the buyer.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`ref-${order.id}`}>Refund reference (optional)</FieldLabel>
          <Input id={`ref-${order.id}`} value={refundRef} onChange={(e) => setRefundRef(e.target.value)} maxLength={120} className="h-9 rounded-lg" />
          <FieldDescription>Only used when closing as refunded, e.g. the Bachs refund id.</FieldDescription>
        </Field>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {pending ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/60 p-3">
          <p className="mr-auto text-sm font-medium text-pretty">{describe(pending)} This can’t be undone.</p>
          <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={pending.action === 'close' ? 'destructive-solid' : 'default'} onClick={confirm} disabled={busy}>
            {busy && <Spinner />}
            Confirm
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPending(withNote({ action: 'send', mode: 'full' }))}>Send full {formatNim(order.nimAmount)}</Button>
          <Button
            variant="outline"
            disabled={order.proRataNimAmount === null}
            title={order.proRataNimAmount === null ? 'Only possible when the buyer paid in the order’s own currency' : undefined}
            onClick={() => setPending(withNote({ action: 'send', mode: 'pro-rata' }))}
          >
            Send pro-rata{order.proRataNimAmount !== null && ` ${formatNim(order.proRataNimAmount)}`}
          </Button>
          <Button
            variant="destructive"
            disabled={!trimmedNote}
            title={trimmedNote ? undefined : 'Add a note first'}
            onClick={() => setPending({ action: 'close', note: trimmedNote, ...(refundRef.trim() ? { refundRef: refundRef.trim() } : {}) })}
          >
            Close as refunded
          </Button>
        </div>
      )}
    </section>
  )
}
