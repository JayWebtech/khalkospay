import { CircleAlert, Link2, Share2 } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { GiftCardArt } from '@/components/gift-card-art'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { GIFT_TEMPLATES } from '@/lib/gift-templates'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'

export function GiftCardCreatePage() {
  const address = useWallet((s) => s.address)
  const [template, setTemplate] = useState<string>('default')
  const [amount, setAmount] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)

  const valid = Number(amount) > 0 && code.trim().length >= 4

  async function create() {
    setSaving(true)
    setError(null)
    try {
      const card = await api<{ id: string }>('/api/giftcards', {
        json: {
          amount: Number(amount),
          message,
          redeemCode: code.trim(),
          template,
          recipientEmail: email || undefined,
          anonymous,
          senderAddress: address ?? undefined,
        },
      })
      setLink(`${location.origin}/gift/${card.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the gift card")
    } finally {
      setSaving(false)
    }
  }

  if (link) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Gift card ready" back="/gifts" />
        <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
          <GiftCardArt template={template} amount={amount} message={message} />
          <p className="text-sm text-muted-foreground">
            Share the link, then tell them the secret code separately. Anyone with both can claim the gift.
          </p>
          <div className="flex items-center gap-2 rounded-2xl bg-muted/60 py-1 pr-1 pl-4">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{link}</span>
            <CopyButton value={link} label="Copy gift link" />
          </div>
          {typeof navigator.share === 'function' && (
            <Button size="xl" onClick={() => void navigator.share({ title: 'A KhalkosPay gift for you', url: link }).catch(() => {})}>
              <Share2 data-icon="inline-start" />
              Share link
            </Button>
          )}
          <ButtonLink to="/gifts" size="xl" variant="outline">
            Done
          </ButtonLink>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="New gift card" back="/gifts" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        <GiftCardArt template={template} amount={amount} message={message} />

        <ToggleGroup
          value={[template]}
          onValueChange={(v) => v[0] && setTemplate(v[0])}
          className="grid w-full grid-cols-3 gap-2"
          aria-label="Design"
        >
          {GIFT_TEMPLATES.map((t) => (
            <ToggleGroupItem key={t.id} value={t.id} variant="outline" className="h-14 flex-col gap-0.5 rounded-xl text-xs">
              <span className="text-lg leading-none" aria-hidden="true">
                {t.emoji}
              </span>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="gift-amount">Amount</FieldLabel>
            <Input
              id="gift-amount"
              inputMode="decimal"
              placeholder="0 NIM"
              value={amount}
              onChange={(e) => /^\d*(\.\d{0,5})?$/.test(e.target.value) && setAmount(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="gift-code">Secret code</FieldLabel>
            <Input id="gift-code" autoComplete="off" placeholder="At least 4 characters" value={code} onChange={(e) => setCode(e.target.value)} />
            <FieldDescription>Share this separately from the link.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="gift-message">Message</FieldLabel>
            <Textarea id="gift-message" placeholder="Happy birthday!" rows={2} maxLength={140} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="gift-email">Recipient email (optional)</FieldLabel>
            <Input id="gift-email" type="email" inputMode="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field orientation="horizontal" className="min-h-11">
            <FieldContent>
              <FieldLabel htmlFor="gift-anon">Send anonymously</FieldLabel>
              <FieldDescription>Hide your wallet address from the recipient.</FieldDescription>
            </FieldContent>
            <Switch id="gift-anon" checked={anonymous} onCheckedChange={setAnonymous} />
          </Field>
        </FieldGroup>

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button size="xl" disabled={!valid || saving} onClick={() => void create()} className={cn(saving && 'cursor-progress')}>
          {saving && <Spinner data-icon="inline-start" />}
          Create gift card
        </Button>
      </div>
    </div>
  )
}
