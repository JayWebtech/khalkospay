import { CircleAlert, CircleCheck, CircleX, Clock, Link2, LoaderCircle, Share2, ShieldCheck, TimerOff, Undo2, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CopyButton } from '@/components/copy-button'
import { GiftCardArt } from '@/components/gift-card-art'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { GiftCard } from '@/lib/api'
import { formatNim, lunaToNim } from '@/lib/format'
import { GIFT_TEMPLATES } from '@/lib/gift-templates'
import { createGiftCard, reportFunding, useGiftCard, useGiftConfig } from '@/lib/gifts'
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
  const [paidCardId, setPaidCardId] = useState<string | null>(null)

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
      setPaidCardId(card.id)
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setPhase('idle')
    }
  }

  if (paidCardId) return <GiftResult id={paidCardId} template={template} amount={amount} message={message} />

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

interface SenderStatus {
  icon: LucideIcon
  tone: string
  title: string
  body: string
  spin?: boolean
  shareable: boolean
}

function senderStatus(card: GiftCard): SenderStatus {
  const amount = formatNim(card.nimAmount, 5)
  switch (card.status) {
    case 'AWAITING_FUNDING':
      if (card.confirming) {
        return {
          icon: LoaderCircle,
          tone: 'bg-accent text-accent-foreground',
          title: 'Confirming your payment',
          body: 'This usually takes under a minute. You can share the link now; it can be claimed once your NIM confirms.',
          spin: true,
          shareable: true,
        }
      }
      if (card.failureReason) {
        return { icon: CircleX, tone: 'bg-destructive/10 text-destructive', title: 'Payment not verified', body: card.failureReason, shareable: false }
      }
      return {
        icon: Clock,
        tone: 'bg-accent text-accent-foreground',
        title: 'Looking for your payment',
        body: "We're waiting to see your NIM on the Nimiq network.",
        shareable: true,
      }
    case 'ACTIVE':
      return {
        icon: CircleCheck,
        tone: 'bg-success/12 text-success',
        title: 'Gift funded',
        body: `KhalkosPay is holding ${amount} until they claim it with your code.`,
        shareable: true,
      }
    case 'CLAIMING':
      return { icon: LoaderCircle, tone: 'bg-accent text-accent-foreground', title: 'Being claimed', body: `${amount} is on its way to them.`, spin: true, shareable: false }
    case 'CLAIMED':
      return { icon: CircleCheck, tone: 'bg-success/12 text-success', title: 'Gift claimed', body: `${amount} reached their wallet.`, shareable: false }
    case 'REFUNDING':
      return {
        icon: Undo2,
        tone: 'bg-accent text-accent-foreground',
        title: 'Refunding your NIM',
        body: `${card.failureReason ?? "The payment didn't cover this gift"}. We're sending it back to your wallet.`,
        shareable: false,
      }
    case 'REFUNDED':
      return {
        icon: Undo2,
        tone: 'bg-muted text-foreground',
        title: 'NIM refunded',
        body: `${card.failureReason ?? "The payment didn't cover this gift"}. It's back in your wallet.`,
        shareable: false,
      }
    case 'EXPIRED':
      return { icon: TimerOff, tone: 'bg-muted text-foreground', title: 'Gift expired', body: 'No payment arrived in time. Nothing was taken.', shareable: false }
  }
}

function GiftResult(props: { id: string; template: string; amount: string; message: string }) {
  const { card, error, update } = useGiftCard(props.id)
  const link = `${location.origin}/gift/${props.id}`
  const status = card ? senderStatus(card) : null
  const Icon = status?.icon

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Your gift" back="/gifts" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        <GiftCardArt template={card?.template ?? props.template} amount={card?.nimAmount ?? props.amount} message={card?.message ?? props.message} />

        {!card && !error && <Skeleton className="h-32 rounded-3xl" />}
        {!card && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {card && status && Icon && (
          <section className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center ring-1 ring-foreground/10" aria-live="polite">
            <span className={cn('flex size-14 items-center justify-center rounded-full', status.tone)}>
              <Icon className={cn('size-7', status.spin && 'motion-safe:animate-spin')} aria-hidden="true" />
            </span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{status.title}</h2>
            <p className="mt-1 max-w-[34ch] text-sm text-muted-foreground">{status.body}</p>
            {card.status === 'AWAITING_FUNDING' && card.failureReason && card.funding && <PayAgain card={card} onReported={update} />}
          </section>
        )}

        {status?.shareable && (
          <>
            <p className="text-sm text-muted-foreground">Share the link, then tell them the secret code separately. Anyone with both can claim the gift.</p>
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
          </>
        )}
        <ButtonLink to="/gifts" size="xl" variant="outline">
          Done
        </ButtonLink>
      </div>
    </div>
  )
}

function PayAgain({ card, onReported }: { card: GiftCard; onReported: (card: GiftCard) => void }) {
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once a retry is signed, never offer another button for it: the server attaches it by memo even if reporting fails.
  if (sent) return <p className="mt-4 text-sm text-muted-foreground">Payment sent. Checking it on the Nimiq network…</p>
  if (wallet.status !== 'connected' || !card.funding) return null
  const funding = card.funding

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const tx = await wallet.pay(funding)
      setSent(true)
      onReported(await reportFunding(card.id, tx).catch(() => card))
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex w-full flex-col gap-2">
      <Button size="xl" onClick={() => void pay()} disabled={busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
        Pay {formatNim(card.nimAmount, 5)} again
      </Button>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </div>
  )
}
