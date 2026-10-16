import { CircleAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GiftCardArt } from '@/components/gift-card-art'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { GiftCard } from '@/lib/api'
import { formatNim, lunaToNim } from '@/lib/format'
import { GIFT_TEMPLATES } from '@/lib/gift-templates'
import { createGiftCard, reportFunding, useGiftConfig } from '@/lib/gifts'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

type Phase = 'idle' | 'creating' | 'approving' | 'reporting'

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Create gift and pay',
  creating: 'Creating your gift…',
  approving: 'Waiting for approval…',
  reporting: 'Confirming payment…',
}

const CANCELLED = 'Payment cancelled. Nothing left your wallet.'

export function GiftCardCreatePage() {
  const wallet = useWallet()
  const { data: config, error: configError } = useGiftConfig()
  const [template, setTemplate] = useState<string>('default')
  const [amount, setAmount] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lockedCard, setLockedCard] = useState<GiftCard | null>(null)
  const navigate = useNavigate()

  // Editing after a cancelled payment creates a fresh card; the unpaid one simply expires.
  useEffect(() => setLockedCard(null), [template, amount, code, message, email, anonymous])

  const minCodeLength = config?.minCodeLength ?? 6
  const balanceNim = wallet.balanceLuna === null ? null : lunaToNim(wallet.balanceLuna)
  const overBalance = balanceNim !== null && Number(amount) > balanceNim
  const networkMismatch = Boolean(config && wallet.provider && config.network !== wallet.network)
  const ready =
    Number(amount) > 0 &&
    !overBalance &&
    code.trim().length >= minCodeLength &&
    wallet.status === 'connected' &&
    Boolean(config?.enabled) &&
    !networkMismatch

  async function createAndPay() {
    if (!wallet.address) return
    setError(null)
    try {
      let card = lockedCard
      if (!card?.funding || new Date(card.expiresAt).getTime() < Date.now() + 30_000) {
        setPhase('creating')
        card = await createGiftCard({
          senderAddress: wallet.address,
          nimAmount: amount,
          redeemCode: code.trim(),
          message,
          template,
          recipientEmail: email || undefined,
          anonymous,
        })
        setLockedCard(card)
      }
      if (!card.funding) throw new Error('This gift is no longer waiting for payment')
      setPhase('approving')
      const tx = await wallet.pay(card.funding)
      setPhase('reporting')
      // If reporting fails, the server still finds the payment by its memo.
      await reportFunding(card.id, tx).catch(() => {})
      navigate(`/gifts/${card.id}`, { replace: true })
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="New gift card" back="/gifts" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        <WalletNotice purpose="sending a gift" />
        {networkMismatch && config && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Switch Nimiq Pay to {config.network}</AlertTitle>
            <AlertDescription>
              Your wallet is on {wallet.network}, but KhalkosPay holds gifts on {config.network}. NIM sent on the wrong network can't fund this gift.
            </AlertDescription>
          </Alert>
        )}
        {(configError || (config && !config.enabled)) && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Gift cards are unavailable right now</AlertTitle>
            <AlertDescription>{configError ?? "This server can't hold gift NIM yet, so no payment will be requested."}</AlertDescription>
          </Alert>
        )}

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
          <Field data-invalid={overBalance ? true : undefined}>
            <FieldLabel htmlFor="gift-amount">Amount</FieldLabel>
            <Input
              id="gift-amount"
              inputMode="decimal"
              placeholder="0 NIM"
              value={amount}
              onChange={(e) => /^\d*(\.\d{0,5})?$/.test(e.target.value) && setAmount(e.target.value)}
              aria-invalid={overBalance ? true : undefined}
              className="tabular-nums"
            />
            {overBalance ? (
              <FieldError>You have {formatNim(balanceNim ?? 0)} available</FieldError>
            ) : (
              balanceNim !== null && <FieldDescription className="tabular-nums">{formatNim(balanceNim)} available</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="gift-code">Secret code</FieldLabel>
            <Input
              id="gift-code"
              autoComplete="off"
              placeholder={`At least ${minCodeLength} characters`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <FieldDescription>Share this separately from the link. Anyone with both can claim the gift.</FieldDescription>
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

        <p className="flex gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          Your NIM goes to KhalkosPay's deposit address and stays there until someone claims the gift with your code.
        </p>

        {error && (
          <Alert variant={error === CANCELLED ? 'default' : 'destructive'}>
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button size="xl" disabled={!ready || phase !== 'idle'} onClick={() => void createAndPay()} className={cn(phase !== 'idle' && 'cursor-progress')}>
          {phase !== 'idle' && <Spinner data-icon="inline-start" />}
          {PHASE_LABEL[phase]}
        </Button>
      </div>
    </div>
  )
}
