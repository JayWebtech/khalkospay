import { CircleAlert, Clock, LoaderCircle, PartyPopper, TimerOff, Undo2, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CopyButton } from '@/components/copy-button'
import { GiftCardArt } from '@/components/gift-card-art'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ApiError, type GiftCard } from '@/lib/api'
import { formatNim, shortAddress, shortHash } from '@/lib/format'
import { claimGiftCard, isGiftId, sameAddress, useGiftCard } from '@/lib/gifts'
import { useWallet } from '@/lib/wallet'

const TITLE: Record<GiftCard['status'], string> = {
  AWAITING_FUNDING: 'A gift is on its way',
  ACTIVE: 'You got a gift',
  CLAIMING: 'Sending your gift',
  CLAIMED: 'Gift claimed',
  EXPIRED: 'This gift expired',
  REFUNDING: 'This gift was cancelled',
  REFUNDED: 'This gift was cancelled',
}

export function GiftRedeemPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { card, error, update } = useGiftCard(id)

  // Opened by gift code: once found, switch to the gift's id so polling doesn't count against code lookups.
  useEffect(() => {
    if (card && id && !isGiftId(id) && card.id !== id) navigate(`/gift/${card.id}`, { replace: true })
  }, [card, id, navigate])

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Redeem gift" back="/gifts" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {!card && !error && <Skeleton className="aspect-[1.6] rounded-3xl" />}

        {!card && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Gift not found</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {card && (
          <>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{TITLE[card.status]}</h2>
              <p className="text-sm text-muted-foreground">
                {card.senderName ? `From ${card.senderName}` : card.senderAddress ? `From ${shortAddress(card.senderAddress)}` : 'From someone who cares'}
              </p>
            </div>
            <GiftCardArt template={card.template} amount={card.nimAmount} message={card.message} />
            <div aria-live="polite" className="flex flex-col gap-3">
              <GiftState card={card} onChange={update} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function GiftState({ card, onChange }: { card: GiftCard; onChange: (card: GiftCard) => void }) {
  const address = useWallet((s) => s.address)
  const amount = formatNim(card.nimAmount, 5)
  const claimedByMe = sameAddress(card.claimerAddress, address)

  switch (card.status) {
    case 'AWAITING_FUNDING':
      return (
        <Alert>
          <Clock />
          <AlertTitle>{card.confirming ? 'Almost ready' : 'Not funded yet'}</AlertTitle>
          <AlertDescription>
            {card.confirming
              ? "The sender's NIM is confirming on the Nimiq network. You can claim it in about a minute."
              : "The sender hasn't paid for this gift yet. This page updates once they do."}
          </AlertDescription>
        </Alert>
      )
    case 'ACTIVE':
      return <ClaimForm card={card} onClaimed={onChange} />
    case 'CLAIMING':
      return (
        <>
          <Alert>
            <LoaderCircle className="motion-safe:animate-spin" />
            <AlertTitle>Sending {amount}</AlertTitle>
            <AlertDescription>
              {card.claimerAddress ? `To ${shortAddress(card.claimerAddress)}. ` : ''}This usually takes under a minute. You can close this page.
            </AlertDescription>
          </Alert>
          {card.claimTxHash && <TxRow label="Nimiq payment" hash={card.claimTxHash} />}
        </>
      )
    case 'CLAIMED':
      return claimedByMe ? (
        <>
          <Alert>
            <PartyPopper />
            <AlertTitle>{amount} is in your wallet</AlertTitle>
            <AlertDescription>Sent to {shortAddress(card.claimerAddress!)} on the Nimiq network. Enjoy your gift.</AlertDescription>
          </Alert>
          {card.claimTxHash && <TxRow label="Nimiq payment" hash={card.claimTxHash} />}
        </>
      ) : (
        <Alert>
          <CircleAlert />
          <AlertTitle>Already claimed</AlertTitle>
          <AlertDescription>This gift has already been claimed with its secret code.</AlertDescription>
        </Alert>
      )
    case 'EXPIRED':
      return (
        <Alert>
          <TimerOff />
          <AlertTitle>Nothing to claim</AlertTitle>
          <AlertDescription>The sender didn't pay for this gift in time, so no NIM is waiting here. Ask them to send a new one.</AlertDescription>
        </Alert>
      )
    case 'REFUNDING':
    case 'REFUNDED':
      return (
        <Alert>
          <Undo2 />
          <AlertTitle>{card.reclaimed ? 'The sender took this gift back' : 'Nothing to claim'}</AlertTitle>
          <AlertDescription>
            {card.reclaimed
              ? 'They cancelled it before anyone claimed it, so the NIM went back to them.'
              : "The sender's payment didn't cover this gift, so KhalkosPay returned their NIM. Ask them to send a new one."}
          </AlertDescription>
        </Alert>
      )
  }
}

function ClaimForm({ card, onClaimed }: { card: GiftCard; onClaimed: (card: GiftCard) => void }) {
  const wallet = useWallet()
  const [code, setCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const connected = wallet.status === 'connected' && wallet.address
  const networkMismatch = Boolean(wallet.provider && card.network !== wallet.network)

  async function claim() {
    if (!wallet.address) return
    setClaiming(true)
    setClaimError(null)
    try {
      onClaimed(await claimGiftCard(card.id, { redeemCode: code.trim(), claimerAddress: wallet.address }))
    } catch (e) {
      // Someone else got there first, or the card changed: show its real state instead of an error.
      if (e instanceof ApiError && e.status === 409) {
        onClaimed({ ...card })
        return
      }
      setClaimError(e instanceof Error ? e.message : "Couldn't claim this gift")
    } finally {
      setClaiming(false)
    }
  }

  return (
    <>
      <WalletNotice purpose="claiming this gift" />
      {networkMismatch && (
        <Alert>
          <CircleAlert />
          <AlertTitle>This gift is on {card.network}</AlertTitle>
          <AlertDescription>
            Your wallet is on {wallet.network}. The NIM still goes to your address, but you'll only see it after switching Nimiq Pay to {card.network}.
          </AlertDescription>
        </Alert>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void claim()
        }}
      >
        <Field data-invalid={claimError ? true : undefined}>
          <FieldLabel htmlFor="redeem-code">Secret code</FieldLabel>
          <Input
            id="redeem-code"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Ask the sender for it"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-invalid={claimError ? true : undefined}
            className="font-mono tracking-widest"
          />
          {claimError ? (
            <FieldError>{claimError}</FieldError>
          ) : (
            connected && (
              <FieldDescription className="flex items-center gap-1.5">
                <Wallet className="size-3.5 shrink-0" aria-hidden="true" />
                Pays {shortAddress(wallet.address!)}
              </FieldDescription>
            )
          )}
        </Field>
        <Button type="submit" size="xl" disabled={!connected || !code.trim() || claiming}>
          {claiming && <Spinner data-icon="inline-start" />}
          Claim {formatNim(card.nimAmount, 5)}
        </Button>
      </form>
    </>
  )
}

function TxRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-muted/60 py-1 pr-1 pl-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-[0.8125rem]">{shortHash(hash)}</span>
        <CopyButton value={hash} label={`Copy ${label.toLowerCase()} hash`} />
      </span>
    </div>
  )
}
