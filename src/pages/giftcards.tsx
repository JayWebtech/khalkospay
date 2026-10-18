import { ChevronRight, CircleAlert, Gift, KeyRound, PackageOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { SentGift } from '@/lib/api'
import { formatNim, shortAddress, timeAgo } from '@/lib/format'
import { giftTemplate } from '@/lib/gift-templates'
import { giftKeyFrom, useMyGifts } from '@/lib/gifts'
import { useSession, useWalletSession } from '@/lib/wallet-session'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

type Tone = 'success' | 'pending' | 'secondary' | 'destructive'

function sentStatus(g: SentGift): { label: string; tone: Tone } {
  switch (g.status) {
    case 'AWAITING_FUNDING':
      return g.confirming ? { label: 'Confirming', tone: 'pending' } : { label: 'Unpaid', tone: 'secondary' }
    case 'ACTIVE':
      return { label: 'Unclaimed', tone: 'pending' }
    case 'CLAIMING':
      return { label: 'Being claimed', tone: 'pending' }
    case 'CLAIMED':
      return { label: 'Claimed', tone: 'success' }
    case 'REFUNDING':
      return { label: g.reclaimed ? 'Taking back' : 'Refunding', tone: 'pending' }
    case 'REFUNDED':
      return { label: g.reclaimed ? 'Taken back' : 'Refunded', tone: 'secondary' }
    case 'EXPIRED':
      return { label: 'Expired', tone: 'secondary' }
  }
}

export function GiftCardsPage() {
  const wallet = useWallet()
  const session = useSession()
  const signOut = useWalletSession((s) => s.signOut)
  const { gifts, error } = useMyGifts(session)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Gift cards"
        description="Wrap NIM with a message"
        action={
          <ButtonLink to="/gifts/new" size="lg">
            <Plus data-icon="inline-start" />
            New
          </ButtonLink>
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-6">
        <RedeemBox />

        {gifts === null && !error && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}
        {error && !gifts && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {gifts && gifts.length > 0 && (
          <section aria-labelledby="sent-heading" className="flex flex-col gap-2">
            <h2 id="sent-heading" className="text-sm font-semibold">
              Gifts you've sent
            </h2>
            <ul className="flex flex-col gap-2">
              {gifts.map((g) => (
                <li key={g.id}>
                  <SentGiftRow gift={g} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {gifts && gifts.length === 0 && (
          <Empty className="rounded-3xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-accent text-accent-foreground [&_svg]:size-6">
                <Gift />
              </EmptyMedia>
              <EmptyTitle>Send your first gift</EmptyTitle>
              <EmptyDescription>Pick a design, add NIM and a note, then share the link. They claim it with your secret code.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ButtonLink to="/gifts/new" size="xl">
                Create gift card
              </ButtonLink>
            </EmptyContent>
          </Empty>
        )}

        {session ? (
          <p className="text-sm text-muted-foreground">
            Also showing gifts sent by {shortAddress(session.address)} from other devices.{' '}
            <button type="button" onClick={signOut} className="-my-2 py-2 font-medium text-foreground underline underline-offset-4">
              Sign out
            </button>
          </p>
        ) : (
          wallet.status === 'connected' && <OtherDevicesCard />
        )}
      </div>
    </div>
  )
}

/** Optional: gifts made on this phone already show above; signing only finds ones sent from other devices. */
function OtherDevicesCard() {
  const signIn = useWalletSession((s) => s.signIn)
  const signingIn = useWalletSession((s) => s.signingIn)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setError(null)
    try {
      await signIn()
    } catch (e) {
      if (!isUserRejection(e)) setError(errorMessage(e))
    }
  }

  return (
    <section className="flex flex-col items-start gap-2 rounded-3xl p-5 ring-1 ring-foreground/10" aria-labelledby="other-devices-heading">
      <h2 id="other-devices-heading" className="text-sm font-semibold">
        Sent gifts from another phone?
      </h2>
      <p className="text-sm text-muted-foreground">
        Sign a message in Nimiq Pay to find them. It proves the wallet is yours and doesn't move any NIM.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="lg" variant="outline" onClick={() => void go()} disabled={signingIn}>
        {signingIn ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        Find my other gifts
      </Button>
    </section>
  )
}

function SentGiftRow({ gift }: { gift: SentGift }) {
  const t = giftTemplate(gift.template)
  const status = sentStatus(gift)
  return (
    <Link
      to={`/gifts/${gift.id}`}
      className="flex min-h-18 items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 transition-[scale] motion-safe:active:scale-[0.98]"
    >
      <img src={t.image} alt="" loading="lazy" decoding="async" className="aspect-[1.6] w-16 shrink-0 rounded-lg object-cover ring-1 ring-foreground/10" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="shrink-0 font-semibold whitespace-nowrap tabular-nums">{formatNim(gift.nimAmount, 5)}</span>
          <span className="min-w-0 truncate text-sm text-muted-foreground">{timeAgo(gift.createdAt)}</span>
        </span>
        <span className="block truncate text-sm text-muted-foreground">{gift.message ? `“${gift.message}”` : (gift.recipientEmail ?? 'No message')}</span>
      </span>
      <Badge variant={status.tone} className="shrink-0">
        {status.label}
      </Badge>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

/** Recipients redeem inside the app: paste the link or type the 8-character gift code from the sender. */
function RedeemBox() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10"
      aria-labelledby="redeem-heading"
      onSubmit={(e) => {
        e.preventDefault()
        const key = giftKeyFrom(value)
        if (!key) {
          setError('Enter the 8-character gift code, like K7QM-3XPD, or paste the gift link.')
          return
        }
        navigate(`/gift/${key}`)
      }}
    >
      <div className="flex items-center gap-2">
        <PackageOpen className="size-5 text-primary" aria-hidden="true" />
        <h2 id="redeem-heading" className="font-semibold">
          Got a gift?
        </h2>
      </div>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="gift-key" className="sr-only">
          Gift code or link
        </FieldLabel>
        <Input
          id="gift-key"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Gift code or link"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          aria-invalid={error ? true : undefined}
          className="font-mono"
        />
        {error ? <FieldError>{error}</FieldError> : <FieldDescription>You'll enter the secret code on the next screen.</FieldDescription>}
      </Field>
      <Button type="submit" size="xl" disabled={!value.trim()}>
        Open gift
      </Button>
    </form>
  )
}
