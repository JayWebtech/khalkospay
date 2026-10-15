import { ArrowUpRight, Gift, Phone, Salad, Wallet } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/brand-mark'
import { OrderList } from '@/components/order-list'
import { Badge } from '@/components/ui/badge'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { formatNgn, lunaToNim, shortAddress } from '@/lib/format'
import { useOrders, useRate } from '@/lib/offramp'
import { useWallet } from '@/lib/wallet'

function BalanceBlock() {
  const { status, balanceLuna, connect } = useWallet()
  const rate = useRate()

  if (status === 'detecting') {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <Skeleton className="h-10 w-48 bg-hero-foreground/10" />
        <Skeleton className="h-4 w-32 bg-hero-foreground/10" />
      </div>
    )
  }
  if (status === 'unavailable') {
    return <p className="mt-2 max-w-[28ch] text-[0.9375rem] text-hero-foreground">Open KhalkosPay inside Nimiq Pay to see your balance and cash out.</p>
  }
  if (status === 'disconnected' || status === 'connecting') {
    return (
      <div className="mt-3 flex flex-col items-start gap-3">
        <p className="text-[0.9375rem] text-hero-foreground">Connect your wallet to see your NIM.</p>
        <Button variant="hero" size="lg" onClick={() => void connect()} disabled={status === 'connecting'}>
          {status === 'connecting' ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
          Connect wallet
        </Button>
      </div>
    )
  }

  const nim = balanceLuna === null ? null : lunaToNim(balanceLuna)
  return (
    <>
      <p className="mt-1 text-[2.5rem] leading-tight font-semibold tracking-tight tabular-nums">
        {nim === null ? '—' : nim.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        <span className="ml-1.5 text-lg font-medium text-hero-muted">NIM</span>
      </p>
      <p className="text-sm text-hero-muted tabular-nums">
        {nim !== null && rate !== null ? `≈ ${formatNgn(Math.floor(nim * rate))} · 1 NIM = ₦${rate.toFixed(4)}` : ' '}
      </p>
    </>
  )
}

export function HomePage() {
  const { address, refreshBalance } = useWallet()
  const orders = useOrders(address)

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  return (
    <div className="flex flex-col gap-7 pb-6">
      <header className="flex min-h-16 items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div className="flex items-center gap-2">
          <BrandMark />
          <span className="text-lg font-semibold tracking-tight">KhalkosPay</span>
        </div>
        {address && (
          <Badge variant="outline" className="h-7 px-2.5 font-mono text-[0.6875rem]">
            {shortAddress(address)}
          </Badge>
        )}
      </header>

      <section className="px-4" aria-label="Wallet">
        <div className="relative isolate overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground shadow-[0_16px_40px_-20px_oklch(0.23_0.02_50/0.7)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-28 -right-20 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,var(--color-hero-accent),transparent)] opacity-30"
          />
          <p className="text-sm text-hero-muted">Wallet balance</p>
          <BalanceBlock />
          <div className="mt-5 grid grid-cols-2 gap-2">
            <ButtonLink to="/cash-out" size="xl">
              <ArrowUpRight data-icon="inline-start" />
              Cash out
            </ButtonLink>
            <ButtonLink to="/call" size="xl" variant="hero">
              <Phone data-icon="inline-start" />
              Call
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2 px-4" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="text-base font-semibold">
          Recent cash-outs
        </h2>
        {!address ? (
          <p className="text-sm text-muted-foreground">Your cash-outs show up here once your wallet is connected.</p>
        ) : orders === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : orders.length === 0 ? (
          <Empty className="rounded-2xl border border-dashed py-8">
            <EmptyHeader>
              <EmptyTitle>No cash-outs yet</EmptyTitle>
              <EmptyDescription>Send NIM and get naira in your Nigerian bank account, usually within a minute.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <OrderList orders={orders.slice(0, 5)} />
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 px-4" aria-label="More from KhalkosPay">
        <FeatureLink to="/bitebuddy" icon={<Salad />} title="BiteBuddy" description="Eat well, grow your pet, earn points" />
        <FeatureLink to="/gifts" icon={<Gift />} title="Gift cards" description="Send NIM wrapped with a message" />
      </section>
    </div>
  )
}

function FeatureLink({ to, icon, title, description }: { to: string; icon: ReactNode; title: string; description: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-[scale,background-color] duration-150 ease-out hover:bg-muted/50 motion-safe:active:scale-[0.96]"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-5">{icon}</span>
      <span className="mt-3 text-sm font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  )
}
