import { ArrowDownLeft, ArrowUpRight, ChevronDown, Gift, Salad, ScanLine, Store, Wallet } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AccountSheet } from '@/components/account-sheet'
import { BrandMark } from '@/components/brand-mark'
import { OrderList } from '@/components/order-list'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { formatNgn, lunaToNim, shortAddress } from '@/lib/format'
import { useOrders, useRate } from '@/lib/offramp'
import { cn } from '@/lib/utils'
import { useWallet } from '@/lib/wallet'
import { useWalletSession } from '@/lib/wallet-session'

function BalanceBlock({ onOpenWallet }: { onOpenWallet: () => void }) {
  const { status, balanceLuna, syncing, address, network } = useWallet()
  const connect = useWalletSession((s) => s.connect)
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
      <p className="text-sm text-hero-muted tabular-nums" aria-live="polite">
        {syncing && nim === null
          ? 'Nimiq Pay is still syncing. Your balance appears in a moment.'
          : nim !== null && rate !== null
            ? `≈ ${formatNgn(Math.floor(nim * rate))} · 1 NIM = ₦${rate.toFixed(4)}`
            : ' '}
      </p>
      {nim === 0 && address && (
        <p className="mt-2 text-sm text-hero-muted">
          No NIM in {shortAddress(address)} on {network}.{' '}
          <button type="button" onClick={onOpenWallet} className="-my-2 py-2 font-medium text-hero-foreground underline underline-offset-4">
            Use another account
          </button>
        </p>
      )}
    </>
  )
}

export function HomePage() {
  const { address, network, refreshBalance } = useWallet()
  const orders = useOrders(address)
  const [walletOpen, setWalletOpen] = useState(false)

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
          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            aria-label={`Wallet ${shortAddress(address)} on ${network}. Wallet options`}
            className="-mr-1 flex h-11 items-center rounded-full px-1 text-[0.6875rem] motion-safe:active:scale-[0.96]"
          >
            <span className="flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5">
              <span aria-hidden="true" className={cn('size-1.5 rounded-full', network === 'testnet' ? 'bg-amber-400' : 'bg-success')} />
              {network === 'testnet' && <span className="font-medium">Testnet</span>}
              <span className="font-mono">{shortAddress(address)}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </span>
          </button>
        )}
      </header>
      <AccountSheet open={walletOpen} onOpenChange={setWalletOpen} />

      <section className="px-4" aria-label="Wallet">
        <div className="relative isolate overflow-hidden rounded-3xl bg-hero p-5 text-hero-foreground shadow-[0_16px_40px_-20px_oklch(0.23_0.02_50/0.7)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-28 -right-20 -z-10 size-72 rounded-full bg-[radial-gradient(closest-side,var(--color-hero-accent),transparent)] opacity-30"
          />
          <div className="flex items-center justify-between">
            <p className="text-sm text-hero-muted">Wallet balance</p>
            {/* Negative margins keep the 44px target without pushing the balance down. */}
            <ButtonLink to="/scan" variant="hero" size="lg" className="-my-3 -mr-2 h-11 rounded-full px-3.5">
              <ScanLine data-icon="inline-start" />
              Scan to pay
            </ButtonLink>
          </div>
          <BalanceBlock onOpenWallet={() => setWalletOpen(true)} />
          <div className="mt-5 grid grid-cols-2 gap-2">
            <ButtonLink to="/buy" size="xl">
              <ArrowDownLeft data-icon="inline-start" />
              Buy NIM
            </ButtonLink>
            <ButtonLink to="/cash-out" size="xl" variant="hero">
              <ArrowUpRight data-icon="inline-start" />
              Cash out
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
        <FeatureLink to="/scan" icon={<ScanLine />} title="Scan to pay" description="Pay shops with NIM by QR code" />
        <FeatureLink to="/merchant" icon={<Store />} title="Your shop" description="Get a QR banner and take NIM" />
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
