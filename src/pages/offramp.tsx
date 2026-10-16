import { ArrowDown, BadgeCheck, CircleAlert, Phone, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BankPicker } from '@/components/bank-picker'
import { shortBankName } from '@/components/order-status'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { Bank, Order, Quote } from '@/lib/api'
import { formatNgn, formatNim, lunaToNim } from '@/lib/format'
import { createOrder, reportDeposit, useAccountName, useBanks, useOfframpConfig, useQuote } from '@/lib/offramp'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

export function OfframpPage() {
  const navigate = useNavigate()
  const wallet = useWallet()
  const { data: config, error: configError } = useOfframpConfig()
  const { data: banks, error: banksError } = useBanks()
  const [amount, setAmount] = useState('')
  const [bank, setBank] = useState<Bank | null>(null)
  const [accountNumber, setAccountNumber] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [lockedOrder, setLockedOrder] = useState<Order | null>(null)
  const { quote, loading: quoting, error: quoteError } = useQuote(amount)
  const account = useAccountName(bank?.code ?? null, accountNumber)

  useEffect(() => setLockedOrder(null), [amount, bank, accountNumber])

  const balanceNim = wallet.balanceLuna === null ? null : lunaToNim(wallet.balanceLuna)
  const overBalance = balanceNim !== null && Number(amount) > balanceNim
  const networkMismatch = Boolean(config && wallet.provider && config.network !== wallet.network)

  const amountError = overBalance
    ? `You have ${formatNim(balanceNim ?? 0)} available`
    : quote?.belowMinimum
      ? `The minimum is ${formatNim(quote.minNim, 0)} (₦${config?.minPayoutNgn ?? 100} payout)`
      : quote?.aboveMaximum
        ? `The maximum is ${formatNim(quote.maxNim, 0)} per cash-out`
        : null

  const ready =
    Boolean(quote && !amountError && account.name && bank) &&
    wallet.status === 'connected' &&
    Boolean(config?.enabled) &&
    !networkMismatch

  function onAmountChange(raw: string) {
    const clean = raw.replace(/,/g, '.').replace(/[^\d.]/g, '')
    if (/^\d{0,9}(\.\d{0,5})?$/.test(clean)) setAmount(clean.replace(/^0+(?=\d)/, ''))
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Cash out"
        description="Naira straight to your bank"

        action={
          <ButtonLink to="/call" variant="default" size="lg">
            <Phone data-icon="inline-start" />
            Use voice
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-4 px-4 pt-2">
        <WalletNotice purpose="cashing out" />
        {networkMismatch && config && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Switch Nimiq Pay to {config.network}</AlertTitle>
            <AlertDescription>
              Your wallet is on {wallet.network}, but KhalkosPay pays out from {config.network}. NIM sent on the wrong network can't be matched to your
              cash-out.
            </AlertDescription>
          </Alert>
        )}
        {(configError || (config && !config.enabled)) && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Cash-out is unavailable right now</AlertTitle>
            <AlertDescription>{configError ?? "Bank payouts aren't switched on for this server yet. You can still check rates."}</AlertDescription>
          </Alert>
        )}

        <section aria-label="Amount" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
          <Field data-invalid={amountError ? true : undefined} className="gap-1">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="amount" className="text-sm font-normal text-muted-foreground">
                You send
              </FieldLabel>
              {balanceNim !== null && (
                <button
                  type="button"
                  className="-my-3 py-3 text-sm text-muted-foreground tabular-nums"
                  onClick={() => setAmount(String(Math.floor(balanceNim)))}
                >
                  {formatNim(balanceNim)} · <span className="font-medium text-primary">Use max</span>
                </button>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <input
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? 'amount-error' : undefined}
                className="w-full min-w-0 bg-transparent text-[2.75rem] leading-tight font-semibold tracking-tight tabular-nums outline-none placeholder:text-muted-foreground/40"
              />
              <span className="text-xl font-semibold text-muted-foreground">NIM</span>
            </div>
            {amountError && <FieldError id="amount-error">{amountError}</FieldError>}
          </Field>

          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <Separator className="flex-1" />
            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <ArrowDown className="size-4" />
            </span>
            <Separator className="flex-1" />
          </div>

          <div aria-live="polite">
            <p className="text-sm text-muted-foreground">You receive</p>
            {quoting && !quote ? (
              <Skeleton className="mt-2 h-12 w-40" />
            ) : (
              <p className={cn('text-[2.75rem] leading-tight font-semibold tracking-tight tabular-nums', !quote && 'text-muted-foreground/40')}>
                {quote ? formatNgn(quote.payoutNgn) : '₦0'}
              </p>
            )}
            {quote && (
              <p className="text-sm text-muted-foreground tabular-nums">
                1 NIM = ₦{quote.rateNgnPerNim.toFixed(4)} · Fees {formatNgn(quote.feeNgn)}
              </p>
            )}
            {quoteError && <p className="text-sm text-destructive">{quoteError}</p>}
          </div>
        </section>

        <section aria-label="Bank account" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="bank">Bank</FieldLabel>
              <BankPicker id="bank" banks={banks} value={bank?.code ?? null} onChange={setBank} />
              {banksError && <FieldError>{banksError}</FieldError>}
            </Field>
            <Field data-invalid={account.error ? true : undefined}>
              <FieldLabel htmlFor="account">Account number</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="account"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="10-digit NUBAN"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  aria-invalid={account.error ? true : undefined}
                  aria-describedby="account-status"
                  className="tracking-wider tabular-nums"
                />
                <InputGroupAddon align="inline-end">
                  {account.loading && <Spinner aria-label="Checking account" />}
                  {account.name && <BadgeCheck className="text-success" aria-hidden="true" />}
                </InputGroupAddon>
              </InputGroup>
              <div id="account-status" aria-live="polite">
                {account.error ? (
                  <FieldError>{account.error}</FieldError>
                ) : account.name ? (
                  <div className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-sm">
                    <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{account.name}</span>
                      <span className="text-muted-foreground">Verified with {bank ? shortBankName(bank.name) : 'your bank'}</span>
                    </span>
                  </div>
                ) : (
                  <FieldDescription>We check the account name with your bank before you pay.</FieldDescription>
                )}
              </div>
            </Field>
          </FieldGroup>
        </section>
      </div>

      <Drawer open={reviewOpen} onOpenChange={(open) => !reviewBusy && setReviewOpen(open)}>
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-auto bg-gradient-to-t from-background from-60% to-transparent px-4 pt-6 pb-3">
          <DrawerTrigger render={<Button size="xl" className="w-full" disabled={!ready} />}>Review cash-out</DrawerTrigger>
        </div>
        {quote && bank && account.name && wallet.address && (
          <ReviewSheet
            onBusyChange={setReviewBusy}
            quote={quote}
            bank={bank}
            accountName={account.name}
            accountNumber={accountNumber}
            amount={amount}
            userAddress={wallet.address}
            quoteTtlMinutes={Math.round((config?.quoteTtlSeconds ?? 600) / 60)}
            feePercent={config?.feePercent ?? 1}
            lockedOrder={lockedOrder}
            onLocked={setLockedOrder}
            onPaid={(order) => navigate(`/cash-out/${order.id}`)}
          />
        )}
      </Drawer>
    </div>
  )
}

type ReviewPhase = 'idle' | 'locking' | 'approving' | 'reporting'

const PHASE_LABEL: Record<ReviewPhase, string> = {
  idle: 'Approve in Nimiq Pay',
  locking: 'Locking your rate…',
  approving: 'Waiting for approval…',
  reporting: 'Confirming payment…',
}

function ReviewSheet(props: {
  onBusyChange: (busy: boolean) => void
  quote: Quote
  bank: Bank
  accountName: string
  accountNumber: string
  amount: string
  userAddress: string
  quoteTtlMinutes: number
  feePercent: number
  lockedOrder: Order | null
  onLocked: (order: Order) => void
  onPaid: (order: Order) => void
}) {
  const pay = useWallet((s) => s.pay)
  const [phase, setPhase] = useState<ReviewPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const { quote, bank, onBusyChange } = props

  useEffect(() => onBusyChange(phase !== 'idle'), [phase, onBusyChange])

  async function confirm() {
    setError(null)
    try {
      let order = props.lockedOrder
      if (!order || order.status !== 'AWAITING_DEPOSIT' || new Date(order.expiresAt).getTime() < Date.now() + 30_000) {
        setPhase('locking')
        order = await createOrder({
          userAddress: props.userAddress,
          nimAmount: props.amount,
          bankCode: bank.code,
          accountNumber: props.accountNumber,
        })
        props.onLocked(order)
      }
      if (!order.deposit) throw new Error('This cash-out is no longer waiting for payment')
      setPhase('approving')
      const tx = await pay(order.deposit)
      setPhase('reporting')
      const reported = await reportDeposit(order.id, tx).catch(() => order)
      props.onPaid(reported)
    } catch (e) {
      setPhase('idle')
      setError(isUserRejection(e) ? 'Payment cancelled. Nothing left your wallet.' : errorMessage(e))
    }
  }

  const locked = props.lockedOrder
  const payout = locked?.payoutNgn ?? quote.payoutNgn
  const fee = locked?.feeNgn ?? quote.feeNgn
  const rate = locked?.rateNgnPerNim ?? quote.rateNgnPerNim

  return (
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle className="text-lg font-semibold">Review cash-out</DrawerTitle>
        <DrawerDescription>
          {locked ? 'Your rate is locked.' : `Your rate locks for ${props.quoteTtlMinutes} minutes when you continue.`}
        </DrawerDescription>
      </DrawerHeader>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
        <div>
          <p className="text-sm text-muted-foreground">You receive</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{formatNgn(payout)}</p>
          <p className="text-sm text-muted-foreground tabular-nums">for {formatNim(props.amount, 5)}</p>
        </div>
        <dl className="flex flex-col gap-2.5 rounded-2xl bg-muted/60 p-4 text-sm">
          <Row label="Rate" value={`1 NIM = ₦${rate.toFixed(4)}`} />
          <Row label={`Fees (${props.feePercent}% + bank transfer)`} value={formatNgn(fee)} />
          <Separator />
          <Row label="To" value={props.accountName} />
          <Row label="Bank" value={`${shortBankName(bank.name)} ••${props.accountNumber.slice(-4)}`} />
        </dl>
        <p className="flex gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          Your NIM goes to KhalkosPay's deposit address, then Paystack pays your bank. If the bank transfer fails, your NIM is refunded automatically.
        </p>
        {error && (
          <Alert variant={error.startsWith('Payment cancelled') ? 'default' : 'destructive'}>
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DrawerFooter className="pb-[max(env(safe-area-inset-bottom),1rem)]">
        <Button size="xl" onClick={() => void confirm()} disabled={phase !== 'idle'}>
          {phase !== 'idle' && <Spinner data-icon="inline-start" />}
          {PHASE_LABEL[phase]}
        </Button>
        <DrawerClose render={<Button size="xl" variant="ghost" disabled={phase !== 'idle'} />}>Edit details</DrawerClose>
      </DrawerFooter>
    </DrawerContent>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}
