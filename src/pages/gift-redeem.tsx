import { CircleAlert, PartyPopper } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BrandMark } from '@/components/brand-mark'
import { GiftCardArt } from '@/components/gift-card-art'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { api } from '@/lib/api'
import { shortAddress } from '@/lib/format'

interface PublicGiftCard {
  amount: number
  message: string
  template: string
  claimed: boolean
  senderName?: string
}

export function GiftRedeemPage() {
  const { id } = useParams<{ id: string }>()
  const [card, setCard] = useState<PublicGiftCard | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimed, setClaimed] = useState(false)

  useEffect(() => {
    api<PublicGiftCard>(`/api/giftcards/${id}`)
      .then(setCard)
      .catch(() => setLoadError("This gift link doesn't exist or has been removed."))
  }, [id])

  async function claim() {
    setClaiming(true)
    setClaimError(null)
    try {
      await api(`/api/giftcards/${id}/claim`, { json: { redeemCode: code.trim() } })
      setClaimed(true)
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Couldn't claim this gift")
    } finally {
      setClaiming(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex min-h-12 items-center gap-2">
        <BrandMark />
        <span className="text-lg font-semibold tracking-tight">KhalkosPay</span>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-5">
        {!card && !loadError && <Skeleton className="aspect-[1.6] rounded-3xl" />}

        {loadError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Gift not found</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {card && (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{claimed ? 'Gift claimed' : 'You got a gift'}</h1>
              <p className="text-sm text-muted-foreground">
                {card.senderName ? `From ${shortAddress(card.senderName)}` : 'From someone who cares'}
              </p>
            </div>
            <GiftCardArt template={card.template} amount={String(card.amount)} message={card.message} />

            {card.claimed && !claimed ? (
              <Alert>
                <CircleAlert />
                <AlertTitle>Already claimed</AlertTitle>
                <AlertDescription>This gift card has already been redeemed.</AlertDescription>
              </Alert>
            ) : claimed ? (
              <Alert>
                <PartyPopper />
                <AlertTitle>Enjoy your gift</AlertTitle>
                <AlertDescription>Your claim is recorded with KhalkosPay.</AlertDescription>
              </Alert>
            ) : (
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
                    placeholder="Ask the sender for it"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    aria-invalid={claimError ? true : undefined}
                    className="font-mono tracking-widest"
                  />
                  {claimError && <FieldError>{claimError}</FieldError>}
                </Field>
                <Button type="submit" size="xl" disabled={!code.trim() || claiming}>
                  {claiming && <Spinner data-icon="inline-start" />}
                  Claim gift
                </Button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  )
}
