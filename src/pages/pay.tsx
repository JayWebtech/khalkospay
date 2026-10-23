import { BadgeCheck, CalendarDays, CircleAlert, CircleCheck, MapPin, Phone, ShieldAlert, TriangleAlert, Wallet } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { CopyButton } from '@/components/copy-button'
import { MerchantAvatar } from '@/components/merchant-avatar'
import { PageHeader } from '@/components/page-header'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { Merchant, MerchantPayment } from '@/lib/api'
import { formatNgn, formatNim, lunaToNim, shortAddress, shortHash } from '@/lib/format'
import { createMerchantPayment, normalizeMerchantCode, reportPaymentTx, useMerchantLookup } from '@/lib/merchants'
import { parseNimiqAddress } from '@/lib/nimiq-address'
import { useRate } from '@/lib/offramp'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const CANCELLED = 'Payment cancelled. Nothing left your wallet.'
const AMOUNT_INPUT = /^\d*(\.\d{0,5})?$/
/** Nimiq transaction messages hold 64 bytes. */
const MAX_MESSAGE_BYTES = 64

const since = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' })

function startingAmount(raw: string | null) {
  return raw && AMOUNT_INPUT.test(raw) && Number(raw) > 0 ? raw : ''
}

/** /pay/:code — a KhalkosPay shop, from its banner QR or typed code. */
export function PayMerchantPage() {
  const { code: raw = '' } = useParams<{ code: string }>()
  const [params] = useSearchParams()
  const code = normalizeMerchantCode(raw)
  const { merchant, error } = useMerchantLookup(code ? { code } : null)

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Pay" back="/scan" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {code && merchant === undefined && !error && <MerchantSkeleton />}
        {(!code || merchant === null) && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Shop not found</AlertTitle>
            <AlertDescription>There's no KhalkosPay shop with code {raw.toUpperCase()}. Check the code on the banner and try again.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {merchant && <MerchantPayForm merchant={merchant} initialAmount={startingAmount(params.get('amount'))} />}
      </div>
    </div>
  )
}

/** /pay/address/:address — a plain address or nimiq: link. A shop paid at its own wallet is shown as that shop. */
export function PayAddressPage() {
  const { address: raw = '' } = useParams<{ address: string }>()
  const [params] = useSearchParams()
  const address = parseNimiqAddress(raw)
  const { merchant, error } = useMerchantLookup(address ? { address } : null)
  const amount = startingAmount(params.get('amount'))

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Pay" back="/scan" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {!address && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>That address isn't valid</AlertTitle>
            <AlertDescription>Scan the code again, or ask for the address and check it letter by letter.</AlertDescription>
          </Alert>
        )}
        {address && merchant === undefined && !error && <MerchantSkeleton />}
        {address && merchant && <MerchantPayForm merchant={merchant} initialAmount={amount} />}
        {/* Can't tell whether it's a shop: still payable, just without the shop's details. */}
        {address && (merchant === null || error) && <AddressPayForm address={address} initialAmount={amount} initialMessage={params.get('message') ?? ''} />}
      </div>
    </div>
  )
}

function MerchantSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-48 rounded-3xl" />
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-11 rounded-xl" />
    </div>
  )
}

function Detail({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function MerchantCard({ merchant }: { merchant: Merchant }) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="merchant-name">
      <div className="flex items-center gap-4">
        <MerchantAvatar name={merchant.name} logo={merchant.logo} className="size-16 text-xl" />
        <div className="min-w-0 flex-1">
          <h2 id="merchant-name" className="text-xl font-semibold tracking-tight text-balance">
            {merchant.name}
          </h2>
          <p className="text-sm text-muted-foreground">{merchant.category}</p>
        </div>
      </div>
      {merchant.description && <p className="text-sm text-pretty">{merchant.description}</p>}
      <ul className="flex flex-col gap-2.5" aria-label="What KhalkosPay knows about this shop">
        {merchant.payoutVerified ? (
          <Detail icon={<BadgeCheck className="text-success" />}>
            <span className="font-medium">Verified shop.</span> It signed in with the wallet you're paying, <span className="font-mono">{shortAddress(merchant.payoutAddress)}</span>.
          </Detail>
        ) : (
          <Detail icon={<ShieldAlert className="text-amber-600 dark:text-amber-400" />}>
            <span className="font-medium">Paid to an address the shop entered,</span> <span className="font-mono">{shortAddress(merchant.payoutAddress)}</span>. KhalkosPay hasn't checked who
            owns it.
          </Detail>
        )}
        {merchant.location && <Detail icon={<MapPin />}>{merchant.location}</Detail>}
        {merchant.phone && (
          <Detail icon={<Phone />}>
            <a href={`tel:${merchant.phone.replace(/[^\d+]/g, '')}`} className="-my-3 inline-block py-3 tabular-nums underline-offset-4 hover:underline">
              {merchant.phone}
            </a>
          </Detail>
        )}
        <Detail icon={<CalendarDays />}>
          On KhalkosPay since {since.format(new Date(merchant.since))} · code <span className="font-mono">{merchant.code}</span>
        </Detail>
      </ul>
    </section>
  )
}

/** The amount field, with the wallet balance and a naira estimate underneath. */
function AmountField({ amount, setAmount, overBalance, balanceNim }: { amount: string; setAmount: (v: string) => void; overBalance: boolean; balanceNim: number | null }) {
  const rate = useRate()
  const n = Number(amount)
  return (
    <Field data-invalid={overBalance ? true : undefined}>
      <FieldLabel htmlFor="pay-amount">Amount</FieldLabel>
      <InputGroup className="h-14">
        <InputGroupInput
          id="pay-amount"
          inputMode="decimal"
          placeholder="0"
          value={amount}
          onChange={(e) => AMOUNT_INPUT.test(e.target.value) && setAmount(e.target.value)}
          aria-invalid={overBalance ? true : undefined}
          className="text-2xl font-semibold tabular-nums"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-base font-medium">NIM</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {overBalance ? (
        <FieldError>You have {formatNim(balanceNim ?? 0)} available</FieldError>
      ) : (
        <FieldDescription className="tabular-nums">
          {[n > 0 && rate ? `≈ ${formatNgn(Math.round(n * rate))}` : null, balanceNim !== null ? `${formatNim(balanceNim)} available` : null].filter(Boolean).join(' · ') || ' '}
        </FieldDescription>
      )}
    </Field>
  )
}

type Phase = 'idle' | 'creating' | 'approving' | 'reporting'

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  creating: 'Getting the payment ready…',
  approving: 'Confirm in Nimiq Pay…',
  reporting: 'Sending…',
}

function NetworkMismatch({ network }: { network: 'mainnet' | 'testnet' }) {
  const wallet = useWallet()
  if (!wallet.provider || wallet.network === network) return null
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>Switch Nimiq Pay to {network}</AlertTitle>
      <AlertDescription>This shop takes NIM on {network}, but your wallet is on {wallet.network}. NIM sent on the wrong network won't reach them.</AlertDescription>
    </Alert>
  )
}

function MerchantPayForm({ merchant, initialAmount }: { merchant: Merchant; initialAmount: string }) {
  const wallet = useWallet()
  const navigate = useNavigate()
  const [amount, setAmount] = useState(initialAmount)
  const [note, setNote] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  // After a cancelled approval, paying again reuses the same payment (and memo) unless something changed.
  const [locked, setLocked] = useState<MerchantPayment | null>(null)
  useEffect(() => setLocked(null), [amount, note])

  const balanceNim = wallet.balanceLuna === null ? null : lunaToNim(wallet.balanceLuna)
  const overBalance = balanceNim !== null && Number(amount) > balanceNim
  const mismatch = Boolean(wallet.provider && wallet.network !== merchant.network)
  const ready = Number(amount) > 0 && !overBalance && wallet.status === 'connected' && !mismatch

  async function pay() {
    setError(null)
    try {
      let payment = locked
      if (!payment?.payment || new Date(payment.expiresAt).getTime() < Date.now() + 60_000) {
        setPhase('creating')
        payment = await createMerchantPayment(merchant.code, { amountNim: amount, note: note.trim(), payerAddress: wallet.address })
        setLocked(payment)
      }
      if (!payment.payment) throw new Error('This payment is no longer open. Try again.')
      setPhase('approving')
      const tx = await wallet.pay(payment.payment)
      setPhase('reporting')
      // If reporting fails, the server still finds the payment on chain by its memo.
      await reportPaymentTx(payment.id, tx).catch(() => {})
      navigate(`/receipt/${payment.id}`, { replace: true })
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <>
      <MerchantCard merchant={merchant} />
      <NetworkMismatch network={merchant.network} />
      <WalletNotice purpose="paying" />
      <FieldGroup>
        <AmountField amount={amount} setAmount={setAmount} overBalance={overBalance} balanceNim={balanceNim} />
        <Field>
          <FieldLabel htmlFor="pay-note">Note for the shop (optional)</FieldLabel>
          <Input id="pay-note" maxLength={140} placeholder="Table 4, order #12…" value={note} onChange={(e) => setNote(e.target.value)} />
          <FieldDescription>Only {merchant.name} sees it. It isn't written on the blockchain.</FieldDescription>
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant={error === CANCELLED ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button size="xl" onClick={() => void pay()} disabled={!ready || phase !== 'idle'} className={cn(phase !== 'idle' && 'cursor-progress')}>
        {phase === 'idle' ? <Wallet data-icon="inline-start" /> : <Spinner data-icon="inline-start" />}
        {phase === 'idle' ? (Number(amount) > 0 ? `Pay ${formatNim(amount, 5)}` : 'Pay') : PHASE_LABEL[phase]}
      </Button>
      <p className="text-center text-sm text-muted-foreground">Your NIM goes straight to {merchant.name}. KhalkosPay never holds it.</p>
    </>
  )
}

/** Paying an address that isn't a KhalkosPay shop: no receipt on our side, so the result is shown here. */
function AddressPayForm({ address, initialAmount, initialMessage }: { address: string; initialAmount: string; initialMessage: string }) {
  const wallet = useWallet()
  const [amount, setAmount] = useState(initialAmount)
  const [message, setMessage] = useState(() => initialMessage.slice(0, MAX_MESSAGE_BYTES))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ tx: string; amount: string } | null>(null)

  const balanceNim = wallet.balanceLuna === null ? null : lunaToNim(wallet.balanceLuna)
  const overBalance = balanceNim !== null && Number(amount) > balanceNim
  const ready = Number(amount) > 0 && !overBalance && wallet.status === 'connected'

  async function pay() {
    setError(null)
    setBusy(true)
    try {
      const valueLuna = Math.round(Number(amount) * 100_000)
      const tx = await wallet.pay({ recipient: address, valueLuna, data: message.trim() })
      setSent({ tx, amount })
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <section className="flex flex-col items-center rounded-3xl bg-card px-5 py-6 text-center ring-1 ring-foreground/10" aria-live="polite">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/12 text-success">
          <CircleCheck className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Sent {formatNim(sent.amount, 5)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          To <span className="font-mono">{shortAddress(address)}</span>. It confirms on the Nimiq network in a few seconds.
        </p>
        <div className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-muted/60 py-1 pr-1 pl-4 text-left">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Transaction</p>
            <p className="truncate font-mono text-sm">{shortHash(sent.tx)}</p>
          </div>
          <CopyButton value={sent.tx} label="Copy transaction hash" />
        </div>
        <ButtonLink to="/" size="xl" className="mt-4 w-full">
          Done
        </ButtonLink>
      </section>
    )
  }

  const bytes = new TextEncoder().encode(message).length
  return (
    <>
      <section className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="address-heading">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/10">
            <Wallet className="size-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="address-heading" className="font-semibold">
              Nimiq address
            </h2>
            <p className="text-sm text-muted-foreground">Not a KhalkosPay shop</p>
          </div>
        </div>
        <p className="font-mono text-sm break-words select-all">{address}</p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          Check with the person you're paying that this is their address. Payments can't be undone.
        </p>
      </section>
      <WalletNotice purpose="paying" />
      <FieldGroup>
        <AmountField amount={amount} setAmount={setAmount} overBalance={overBalance} balanceNim={balanceNim} />
        <Field data-invalid={bytes > MAX_MESSAGE_BYTES ? true : undefined}>
          <FieldLabel htmlFor="pay-message">Message (optional)</FieldLabel>
          <Input id="pay-message" value={message} onChange={(e) => new TextEncoder().encode(e.target.value).length <= MAX_MESSAGE_BYTES && setMessage(e.target.value)} />
          <FieldDescription>Saved on the blockchain with the payment, where anyone can read it.</FieldDescription>
        </Field>
      </FieldGroup>
      {error && (
        <Alert variant={error === CANCELLED ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button size="xl" onClick={() => void pay()} disabled={!ready || busy}>
        {busy ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
        {busy ? 'Confirm in Nimiq Pay…' : Number(amount) > 0 ? `Pay ${formatNim(amount, 5)}` : 'Pay'}
      </Button>
    </>
  )
}
