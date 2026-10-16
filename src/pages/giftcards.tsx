import { ChevronRight, CircleAlert, Gift, KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { SentGift } from '@/lib/api'
import { formatNim, timeAgo } from '@/lib/format'
import { giftTemplate } from '@/lib/gift-templates'
import { useMyGifts } from '@/lib/gifts'
import { cn } from '@/lib/utils'
import { useSessionFor, useWalletSession } from '@/lib/wallet-session'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

type Tone = 'success' | 'pending' | 'secondary' | 'destructive'

function sentStatus(g: SentGift): { label: string; tone: Tone } {
  switch (g.status) {
    case 'AWAITING_FUNDING':
      return g.confirming ? { label: 'Confirming', tone: 'pending' } : { label: 'Unpaid', tone: 'secondary' }
    case 'ACTIVE':
      return { label: 'Not claimed yet', tone: 'pending' }
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
  const session = useSessionFor(wallet.address)
  const { gifts, error } = useMyGifts(session)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Gift cards"
        description="Wrap NIM with a message"
        back="/"
        action={
          <ButtonLink to="/gifts/new" size="lg">
            <Plus data-icon="inline-start" />
            New
          </ButtonLink>
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-6">
        <WalletNotice purpose="seeing the gifts you've sent" />
        {wallet.status === 'connected' && !session && <SignInCard />}

        {session && gifts === null && !error && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        )}
        {session && error && !gifts && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {gifts && gifts.length > 0 ? (
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
        ) : (
          (!session || gifts?.length === 0) && (
            <Empty className="rounded-3xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-accent text-accent-foreground [&_svg]:size-6">
                  <Gift />
                </EmptyMedia>
                <EmptyTitle>{gifts?.length === 0 ? 'No gifts sent yet' : 'Send your first gift'}</EmptyTitle>
                <EmptyDescription>Pick a design, add NIM and a note, then share the link. They claim it with your secret code.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <ButtonLink to="/gifts/new" size="xl">
                  Create gift card
                </ButtonLink>
              </EmptyContent>
            </Empty>
          )
        )}
      </div>
    </div>
  )
}

function SignInCard() {
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
    <section className="flex flex-col items-start gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="signin-heading">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" aria-hidden="true" />
        <h2 id="signin-heading" className="font-semibold">
          See the gifts you've sent
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Find your links again, check who claimed what, and take back gifts nobody has claimed. Nimiq Pay asks you to sign a message first. It proves the
        wallet is yours and doesn't move any NIM.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="lg" onClick={() => void go()} disabled={signingIn}>
        {signingIn ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        Sign in with Nimiq Pay
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
      <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl', t.art)} aria-hidden="true">
        {t.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="font-semibold tabular-nums">{formatNim(gift.nimAmount, 5)}</span>
          <span className="truncate text-sm text-muted-foreground">{timeAgo(gift.createdAt)}</span>
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
