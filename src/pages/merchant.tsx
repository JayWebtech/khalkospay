import { ArrowDownLeft, CircleAlert, Image as ImageIcon, KeyRound, MapPin, Pencil, Phone, QrCode as QrIcon, ShieldCheck, Store } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { CopyButton } from '@/components/copy-button'
import { MerchantAvatar } from '@/components/merchant-avatar'
import { PageHeader } from '@/components/page-header'
import { QrCode } from '@/components/qr-code'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { OwnMerchant, ReceivedPayment } from '@/lib/api'
import { formatNim, shortAddress, timeAgo } from '@/lib/format'
import { merchantPayLink, useOwnMerchant, useReceivedPayments } from '@/lib/merchants'
import { errorMessage, isUserRejection, sameAddress, useWallet } from '@/lib/wallet'
import { useSession, useWalletSession, type Session } from '@/lib/wallet-session'

/** The shop owner's home: set up the shop, get the banner, ask for an amount, and see what came in. */
export function MerchantPage() {
  const wallet = useWallet()
  const session = useSession()
  // A sign-in for another account doesn't count: the shop belongs to the wallet the app pays from.
  const own = session && sameAddress(session.address, wallet.address) ? session : null
  const { merchant, error } = useOwnMerchant(own)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Your shop"
        description="Take NIM with a QR code"
        back="/"
        action={
          merchant && (
            <ButtonLink to="/merchant/profile" size="lg" variant="outline" className="h-11">
              <Pencil data-icon="inline-start" />
              Edit
            </ButtonLink>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-6">
        <WalletNotice purpose="accepting NIM in your shop" />
        {wallet.status === 'connected' && !own && <SignInCard />}

        {own && merchant === undefined && !error && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-40 rounded-3xl" />
          </div>
        )}
        {own && merchant === undefined && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {own && merchant === null && (
          <Empty className="rounded-3xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon" className="size-12 rounded-2xl bg-accent text-accent-foreground [&_svg]:size-6">
                <Store />
              </EmptyMedia>
              <EmptyTitle>Accept NIM in your shop</EmptyTitle>
              <EmptyDescription>
                Add your business details and get a QR banner to print. Customers scan it and pay you straight from Nimiq Pay. KhalkosPay never holds
                the money.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <ButtonLink to="/merchant/profile" size="xl">
                Set up your shop
              </ButtonLink>
            </EmptyContent>
          </Empty>
        )}

        {own && merchant && (
          <>
            <ShopCard merchant={merchant} />
            <BannerCard merchant={merchant} />
            <PaymentsReceived session={own} />
          </>
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
    <section className="flex flex-col items-start gap-2 rounded-3xl p-5 ring-1 ring-foreground/10" aria-labelledby="shop-signin-heading">
      <h2 id="shop-signin-heading" className="font-semibold">
        Sign in to manage your shop
      </h2>
      <p className="text-sm text-muted-foreground">
        Your shop belongs to your wallet. Sign a message in Nimiq Pay to prove it's yours. It doesn't move any NIM.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="xl" onClick={() => void go()} disabled={signingIn} className="mt-1">
        {signingIn ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
        {signingIn ? 'Confirm in Nimiq Pay…' : 'Sign in with wallet'}
      </Button>
    </section>
  )
}

function ShopCard({ merchant }: { merchant: OwnMerchant }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-label="Shop details">
      <div className="flex items-center gap-3">
        <MerchantAvatar name={merchant.name} logo={merchant.logo} className="size-14 text-lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{merchant.name}</h2>
          <p className="truncate text-sm text-muted-foreground">{merchant.category}</p>
        </div>
      </div>
      {merchant.description && <p className="text-sm text-pretty">{merchant.description}</p>}
      <dl className="flex flex-col gap-2 text-sm">
        {merchant.location && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Location</dt>
            <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <dd className="min-w-0 truncate">{merchant.location}</dd>
          </div>
        )}
        {merchant.phone && (
          <div className="flex items-center gap-2">
            <dt className="sr-only">Phone</dt>
            <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <dd className="tabular-nums">{merchant.phone}</dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <dt className="sr-only">Payments go to</dt>
          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <dd className="min-w-0">
            Paid to <span className="font-mono">{shortAddress(merchant.payoutAddress)}</span>
            {merchant.payoutVerified ? ' (this wallet)' : ''}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function BannerCard({ merchant }: { merchant: OwnMerchant }) {
  const link = merchantPayLink(merchant.code)
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-hero p-5 text-hero-foreground" aria-labelledby="banner-heading">
      <div className="flex items-center gap-4">
        <QrCode value={link} label={`QR code for ${merchant.name}`} className="size-24 shrink-0 p-1" />
        <div className="min-w-0">
          <h2 id="banner-heading" className="font-semibold">
            Your QR banner
          </h2>
          <p className="text-sm text-hero-muted">Print it and put it up where customers pay. Shop code {merchant.code}.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ButtonLink to="/merchant/banner" size="xl">
          <ImageIcon data-icon="inline-start" />
          Get banner
        </ButtonLink>
        <RequestAmount merchant={merchant} />
      </div>
    </section>
  )
}

/** A one-off QR with the amount in it, shown on the merchant's phone for the customer to scan. */
function RequestAmount({ merchant }: { merchant: OwnMerchant }) {
  const [amount, setAmount] = useState('')
  const valid = /^\d+(\.\d{1,5})?$/.test(amount) && Number(amount) > 0
  const link = merchantPayLink(merchant.code, valid ? amount : null)

  return (
    <Drawer>
      <DrawerTrigger render={<Button size="xl" variant="hero" />}>
        <QrIcon data-icon="inline-start" />
        Ask amount
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-lg font-semibold">Ask for an amount</DrawerTitle>
          <DrawerDescription>Type the total, then let your customer scan this screen. The amount fills in for them.</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col items-center gap-4 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <Field className="w-full">
            <FieldLabel htmlFor="request-amount">Amount</FieldLabel>
            <Input
              id="request-amount"
              inputMode="decimal"
              placeholder="0 NIM"
              value={amount}
              onChange={(e) => /^\d*(\.\d{0,5})?$/.test(e.target.value) && setAmount(e.target.value)}
              className="tabular-nums"
            />
            <FieldDescription>Leave it empty and they type the amount themselves.</FieldDescription>
          </Field>
          <QrCode value={link} label={valid ? `QR code to pay ${formatNim(amount, 5)} to ${merchant.name}` : `QR code to pay ${merchant.name}`} className="size-64 p-2 ring-1 ring-foreground/10" />
          <p className="text-center text-sm font-medium" aria-live="polite">
            {valid ? `${formatNim(amount, 5)} to ${merchant.name}` : `Pay ${merchant.name}`}
          </p>
          <div className="flex w-full items-center gap-3 rounded-2xl bg-muted/60 py-1 pr-1 pl-4">
            <p className="min-w-0 flex-1 truncate font-mono text-sm select-all">{link}</p>
            <CopyButton value={link} label="Copy payment link" />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function PaymentsReceived({ session }: { session: Session }) {
  const { payments, totals, error } = useReceivedPayments(session, true)
  const today = useMemo(() => {
    const confirmed = (payments ?? []).filter((p) => p.status === 'CONFIRMED' && isToday(p.confirmedAt ?? p.createdAt))
    return { nim: confirmed.reduce((sum, p) => sum + Number(p.nimAmount), 0), count: confirmed.length }
  }, [payments])

  return (
    <section className="flex flex-col gap-3" aria-labelledby="received-heading">
      <h2 id="received-heading" className="text-base font-semibold">
        Payments received
      </h2>
      {totals && (
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
            <dt className="text-sm text-muted-foreground">Today</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{formatNim(today.nim, 5)}</dd>
            <dd className="text-xs text-muted-foreground tabular-nums">
              {today.count} {today.count === 1 ? 'payment' : 'payments'}
            </dd>
          </div>
          <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
            <dt className="text-sm text-muted-foreground">All time</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{formatNim(totals.receivedNim, 5)}</dd>
            <dd className="text-xs text-muted-foreground tabular-nums">
              {totals.receivedCount} {totals.receivedCount === 1 ? 'payment' : 'payments'}
            </dd>
          </div>
        </dl>
      )}
      {payments === null && !error && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </div>
      )}
      {payments === null && error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {payments?.length === 0 && (
        <Empty className="rounded-2xl border border-dashed py-8">
          <EmptyHeader>
            <EmptyTitle>No payments yet</EmptyTitle>
            <EmptyDescription>When a customer pays, it shows up here within seconds, even if they close the app right after paying.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {payments && payments.length > 0 && (
        <ItemGroup className="gap-1" aria-live="polite">
          {payments.map((p) => (
            <ReceivedRow key={p.id} payment={p} />
          ))}
        </ItemGroup>
      )}
      <p className="text-sm text-muted-foreground">
        Every payment is checked on the Nimiq network before it shows as received. The NIM lands in your wallet directly.{' '}
        <Link to="/scan" className="-my-3 inline-block py-3 font-medium text-foreground underline underline-offset-4">
          Paying someone instead?
        </Link>
      </p>
    </section>
  )
}

function ReceivedRow({ payment: p }: { payment: ReceivedPayment }) {
  const confirmed = p.status === 'CONFIRMED'
  return (
    <Item className="rounded-xl px-2 py-2.5">
      <ItemMedia className="size-10 rounded-full bg-success/12 text-success">
        <ArrowDownLeft className="size-[1.125rem]" aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0 items-baseline">
          <span className="shrink-0 tabular-nums">+{formatNim(p.nimAmount, 5)}</span>
          <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">{timeAgo(p.confirmedAt ?? p.createdAt)}</span>
        </ItemTitle>
        <ItemDescription className="truncate">{p.note ? `“${p.note}”` : p.payerAddress ? `From ${shortAddress(p.payerAddress)}` : 'No note'}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {confirmed ? (
          <Badge variant={p.underpaid ? 'pending' : 'success'}>{p.underpaid ? `Asked ${formatNim(p.requestedNim, 5)}` : 'Received'}</Badge>
        ) : (
          <Badge variant="pending">
            <Spinner data-icon="inline-start" />
            Confirming
          </Badge>
        )}
      </ItemActions>
    </Item>
  )
}
