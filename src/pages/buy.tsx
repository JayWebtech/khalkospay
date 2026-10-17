import { ArrowDown, ChevronRight, CircleAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { OnrampOrder } from '@/lib/api'
import { formatFiat, formatNim, formatRate, timeAgo } from '@/lib/format'
import { createBuyOrder, CURRENCY_FLAG, defaultBuyCurrency, rememberBuyCurrency, useBuyOrders, useOnrampConfig, useOnrampQuote } from '@/lib/onramp'
import { cn } from '@/lib/utils'
import { errorMessage, useWallet } from '@/lib/wallet'

export function BuyPage() {
  const navigate = useNavigate()
  const wallet = useWallet()
  const { data: config, error: configError } = useOnrampConfig()
  const currencies = config?.currencies ?? []
  const [currency, setCurrency] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { quote, loading: quoting, error: quoteError } = useOnrampQuote(currency, amount)
  const selected = currencies.find((c) => c.code === currency)

  useEffect(() => {
    if (config && !currency) setCurrency(defaultBuyCurrency(config.currencies.map((c) => c.code)))
  }, [config, currency])

  const networkMismatch = Boolean(config && wallet.provider && config.network !== wallet.network)
  const amountError = quote?.belowMinimum
    ? `The minimum is ${formatFiat(quote.minAmount, currency)}`
    : quote?.aboveMaximum
      ? `The maximum per purchase is ${formatFiat(quote.maxAmount, currency)}`
      : quote?.exceedsStock
        ? `KhalkosPay can sell up to ${formatNim(quote.availableNim, 0)} right now (about ${formatFiat(quote.maxAmount, currency)})`
        : null
  const ready = Boolean(quote && !amountError) && wallet.status === 'connected' && Boolean(config?.enabled) && !networkMismatch && !busy

  function onAmountChange(raw: string) {
    const clean = raw.replace(/,/g, '').replace(/[^\d.]/g, '')
    const decimals = selected?.decimals ?? 2
    const pattern = decimals === 0 ? /^\d{0,12}$/ : new RegExp(`^\\d{0,12}(\\.\\d{0,${decimals}})?$`)
    if (pattern.test(clean)) setAmount(clean.replace(/^0+(?=\d)/, ''))
  }

  async function pay() {
    if (!wallet.address) return
    setBusy(true)
    setError(null)
    try {
      const order = await createBuyOrder({ address: wallet.address, currency, amount })
      rememberBuyCurrency(currency)
      // Keep the purchase in history, so coming back from the checkout lands on its status page.
      navigate(`/buy/${order.id}`)
      if (order.checkoutUrl) window.location.assign(order.checkoutUrl)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Buy NIM" description="Pay with mobile money, bank or card" back="/" />

      <div className="flex flex-col gap-4 px-4 pt-2">
        <WalletNotice purpose="buying NIM" />
        {networkMismatch && config && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Switch Nimiq Pay to {config.network}</AlertTitle>
            <AlertDescription>Your wallet is on {wallet.network}, but KhalkosPay sells NIM on {config.network}.</AlertDescription>
          </Alert>
        )}
        {(configError || (config && !config.enabled)) && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Buying NIM is unavailable right now</AlertTitle>
            <AlertDescription>{configError ?? "Payments aren't switched on for this server yet."}</AlertDescription>
          </Alert>
        )}

        <section aria-label="Amount" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
          <Field data-invalid={amountError ? true : undefined} className="gap-1">
            <FieldLabel htmlFor="buy-amount" className="text-sm font-normal text-muted-foreground">
              You pay
            </FieldLabel>
            <div className="flex items-center gap-2">
              <input
                id="buy-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? 'buy-amount-error' : undefined}
                className="w-full min-w-0 bg-transparent text-[2.75rem] leading-tight font-semibold tracking-tight tabular-nums outline-none placeholder:text-muted-foreground/40"
              />
              {currencies.length > 0 ? (
                <Select
                  value={currency}
                  onValueChange={(v) => {
                    setCurrency(String(v))
                    setAmount('')
                  }}
                  items={currencies.map((c) => ({ value: c.code, label: `${CURRENCY_FLAG[c.code] ?? ''} ${c.code}` }))}
                >
                  <SelectTrigger aria-label="Currency" className="h-11 shrink-0 rounded-full px-3 text-base font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end" alignItemWithTrigger={false} className="w-60 max-w-[calc(100vw-2rem)]">
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code} className="min-h-10">
                        <span aria-hidden="true">{CURRENCY_FLAG[c.code]}</span>
                        <span className="font-medium">{c.code}</span>
                        <span className="truncate text-muted-foreground">{c.country}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Skeleton className="h-11 w-24 shrink-0 rounded-full" />
              )}
            </div>
            {amountError && <FieldError id="buy-amount-error">{amountError}</FieldError>}
          </Field>

          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <Separator className="flex-1" />
            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ArrowDown className="size-4" />
            </span>
            <Separator className="flex-1" />
          </div>

          <div aria-live="polite">
            <p className="text-sm text-muted-foreground">You get</p>
            {quoting && !quote ? (
              <Skeleton className="mt-2 h-12 w-40" />
            ) : (
              <p className={cn('text-[2.75rem] leading-tight font-semibold tracking-tight tabular-nums', !quote && 'text-muted-foreground/40')}>
                {quote ? Number(quote.nimAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0'}
                <span className="ml-1.5 text-xl font-semibold text-muted-foreground">NIM</span>
              </p>
            )}
            {quote && (
              <p className="text-sm text-muted-foreground tabular-nums">
                1 NIM = {formatRate(quote.fiatPerNim, currency)} · Fee {formatFiat(quote.feeAmount, currency)} ({quote.feePercent}%)
              </p>
            )}
            {quoteError && <p className="text-sm text-destructive">{quoteError}</p>}
          </div>
        </section>

        <p className="flex gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          {selected ? `You'll pay by ${selected.methodLabel.toLowerCase()} on a secure Bachs checkout.` : 'You pay on a secure Bachs checkout.'} Once your payment
          is confirmed, KhalkosPay sends the NIM straight to your Nimiq Pay wallet.
        </p>

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <RecentPurchases address={wallet.address} />
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-auto bg-gradient-to-t from-background from-60% to-transparent px-4 pt-6 pb-3">
        <Button size="xl" className="w-full" disabled={!ready} onClick={() => void pay()}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ? 'Opening checkout…' : quote && !amountError ? `Pay ${formatFiat(quote.amount, currency)}` : 'Buy NIM'}
        </Button>
      </div>
    </div>
  )
}

const STATUS_BADGE: Record<OnrampOrder['status'], { label: string; tone: 'success' | 'pending' | 'secondary' | 'destructive' }> = {
  AWAITING_PAYMENT: { label: 'Awaiting payment', tone: 'pending' },
  PAID: { label: 'Paid', tone: 'pending' },
  SENDING: { label: 'Sending NIM', tone: 'pending' },
  COMPLETED: { label: 'Done', tone: 'success' },
  EXPIRED: { label: 'Expired', tone: 'secondary' },
  NEEDS_REVIEW: { label: 'Under review', tone: 'destructive' },
  RESOLVED: { label: 'Refunded', tone: 'secondary' },
}

function RecentPurchases({ address }: { address: string | null }) {
  const orders = useBuyOrders(address)
  if (!orders || orders.length === 0) return null
  return (
    <section aria-labelledby="recent-buys" className="flex flex-col gap-2 pb-4">
      <h2 id="recent-buys" className="text-sm font-semibold">
        Recent purchases
      </h2>
      <ul className="flex flex-col gap-2">
        {orders.slice(0, 5).map((o) => (
          <li key={o.id}>
            <Link to={`/buy/${o.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl bg-card px-4 py-2 ring-1 ring-foreground/10 motion-safe:active:scale-[0.98]">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold tabular-nums">{formatNim(o.nimAmount, 2)}</span>
                <span className="block truncate text-sm text-muted-foreground tabular-nums">
                  {formatFiat(o.amount, o.currency)} · {timeAgo(o.createdAt)}
                </span>
              </span>
              <Badge variant={STATUS_BADGE[o.status].tone}>{STATUS_BADGE[o.status].label}</Badge>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
