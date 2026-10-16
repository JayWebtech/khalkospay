import { CircleAlert, CircleCheck, CircleX, Clock, Link2, LoaderCircle, Share2, TimerOff, Undo2, Wallet, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { CopyButton } from '@/components/copy-button'
import { GiftCardArt } from '@/components/gift-card-art'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { GiftCard } from '@/lib/api'
import { formatNim } from '@/lib/format'
import { hasPendingFunding, reclaimGift, reportFunding, useGiftCard } from '@/lib/gifts'
import { cn } from '@/lib/utils'
import { useWalletSession } from '@/lib/wallet-session'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const CANCELLED = 'Payment cancelled. Nothing left your wallet.'

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
      if (hasPendingFunding(card.id)) {
        return {
          icon: Clock,
          tone: 'bg-accent text-accent-foreground',
          title: 'Looking for your payment',
          body: "We're waiting to see your NIM on the Nimiq network.",
          shareable: true,
        }
      }
      return {
        icon: Wallet,
        tone: 'bg-accent text-accent-foreground',
        title: 'Waiting for payment',
        body: `Approve ${amount} in Nimiq Pay to fund this gift. Unpaid gifts expire on their own and cost nothing.`,
        shareable: false,
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
      return card.reclaimed
        ? {
            icon: Undo2,
            tone: 'bg-accent text-accent-foreground',
            title: 'Taking the gift back',
            body: `${amount} is on its way back to your wallet. The gift link no longer works.`,
            shareable: false,
          }
        : {
            icon: Undo2,
            tone: 'bg-accent text-accent-foreground',
            title: 'Refunding your NIM',
            body: `${card.failureReason ?? "The payment didn't cover this gift"}. We're sending it back to your wallet.`,
            shareable: false,
          }
    case 'REFUNDED':
      return card.reclaimed
        ? { icon: Undo2, tone: 'bg-muted text-foreground', title: 'Gift taken back', body: `${amount} is back in your wallet.`, shareable: false }
        : {
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

/** The sender's view of one gift: live status, the link to share, and the ways to pay for it or take it back. */
export function SentGiftPage() {
  const { id } = useParams<{ id: string }>()
  const { card, error, update } = useGiftCard(id)
  const link = `${location.origin}/gift/${id}`
  const status = card ? senderStatus(card) : null
  const Icon = status?.icon
  const canPay = card?.status === 'AWAITING_FUNDING' && card.funding && !card.confirming && !hasPendingFunding(card.id)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Your gift" back="/gifts" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {card ? <GiftCardArt template={card.template} amount={card.nimAmount} message={card.message} /> : !error && <Skeleton className="aspect-[1.6] rounded-3xl" />}

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
            {canPay && <PayForGift card={card} onReported={update} />}
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

        {card?.status === 'ACTIVE' && <TakeBack card={card} onDone={update} />}

        <ButtonLink to="/gifts" size="xl" variant="outline">
          Done
        </ButtonLink>
      </div>
    </div>
  )
}

function PayForGift({ card, onReported }: { card: GiftCard; onReported: (card: GiftCard) => void }) {
  const wallet = useWallet()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once a payment is signed, never offer another button for it: the server attaches it by memo even if reporting fails.
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
        {card.failureReason ? `Pay ${formatNim(card.nimAmount, 5)} again` : `Pay ${formatNim(card.nimAmount, 5)}`}
      </Button>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </div>
  )
}

type TakeBackPhase = 'idle' | 'signing' | 'reclaiming'

function TakeBack({ card, onDone }: { card: GiftCard; onDone: (card: GiftCard) => void }) {
  const wallet = useWallet()
  const signIn = useWalletSession((s) => s.signIn)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<TakeBackPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const amount = formatNim(card.nimAmount, 5)

  async function takeBack() {
    setError(null)
    try {
      setPhase('signing')
      const session = await signIn()
      setPhase('reclaiming')
      const next = await reclaimGift(session, card.id)
      setOpen(false)
      onDone(next)
    } catch (e) {
      setError(isUserRejection(e) ? 'Cancelled. The gift is still waiting to be claimed.' : errorMessage(e))
      // Whatever happened, show the card's real state (it may have just been claimed).
      onDone({ ...card })
    } finally {
      setPhase('idle')
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => phase === 'idle' && setOpen(next)}>
      <DrawerTrigger render={<Button size="xl" variant="ghost" className="text-destructive" disabled={wallet.status !== 'connected'} />}>
        <Undo2 data-icon="inline-start" />
        Take gift back
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-lg font-semibold">Take back {amount}?</DrawerTitle>
          <DrawerDescription>
            The NIM goes back to the wallet that paid for this gift and the link stops working. If they claim it first, it can't be taken back.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-3 px-4 py-2">
          <p className="text-sm text-muted-foreground">Nimiq Pay asks you to sign a message first. It proves this wallet sent the gift and doesn't move any NIM.</p>
          {error && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DrawerFooter className="pb-[max(env(safe-area-inset-bottom),1rem)]">
          <Button size="xl" variant="destructive" onClick={() => void takeBack()} disabled={phase !== 'idle'}>
            {phase !== 'idle' ? <Spinner data-icon="inline-start" /> : <Undo2 data-icon="inline-start" />}
            {phase === 'signing' ? 'Confirm in Nimiq Pay…' : phase === 'reclaiming' ? 'Taking it back…' : `Take back ${amount}`}
          </Button>
          <DrawerClose render={<Button size="xl" variant="ghost" disabled={phase !== 'idle'} />}>Keep the gift</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
