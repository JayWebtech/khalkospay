import { CircleAlert, ImagePlus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { MerchantAvatar } from '@/components/merchant-avatar'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { OwnMerchant } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { saveMerchant, useOwnMerchant, type MerchantInput } from '@/lib/merchants'
import { parseNimiqAddress } from '@/lib/nimiq-address'
import { cn } from '@/lib/utils'
import { errorMessage, sameAddress, useWallet } from '@/lib/wallet'
import { useSession } from '@/lib/wallet-session'

const CATEGORIES = ['Food & drinks', 'Groceries', 'Fashion', 'Beauty', 'Electronics', 'Services', 'Transport']
const LOGO_SIZE = 256
const MAX_LOGO_LENGTH = 200_000

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That image couldn't be opened. Try a PNG or JPEG."))
    img.src = url
  })
}

/** Crops the picked image to a 256 px square on the device, so the upload stays small whatever the camera shot. */
async function logoFromFile(file: File): Promise<string> {
  const img = await loadImage(file)
  URL.revokeObjectURL(img.src)
  const canvas = document.createElement('canvas')
  canvas.width = LOGO_SIZE
  canvas.height = LOGO_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("This device can't resize the image")
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE)
  // WebP keeps transparency and stays small; Safari can't encode it and hands back PNG instead.
  let url = canvas.toDataURL('image/webp', 0.86)
  if (!url.startsWith('data:image/webp') || url.length > MAX_LOGO_LENGTH) url = canvas.toDataURL('image/png')
  if (url.length > MAX_LOGO_LENGTH) {
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE)
    url = canvas.toDataURL('image/jpeg', 0.85)
  }
  return url
}

export function MerchantProfilePage() {
  const wallet = useWallet()
  const session = useSession()
  const own = session && sameAddress(session.address, wallet.address) ? session : null
  const { merchant, error } = useOwnMerchant(own)

  // The wallet's account is only known once detection finishes; don't bounce a reload before then.
  if (wallet.status === 'detecting') return <Skeleton className="mx-4 mt-20 h-96 rounded-3xl" />
  if (!own) return <Navigate to="/merchant" replace />
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={merchant ? 'Edit your shop' : 'Set up your shop'} back="/merchant" />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        {merchant === undefined && !error && <Skeleton className="h-96 rounded-3xl" />}
        {merchant === undefined && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {merchant !== undefined && <ProfileForm merchant={merchant} walletAddress={own.address} />}
      </div>
    </div>
  )
}

function ProfileForm({ merchant, walletAddress }: { merchant: OwnMerchant | null; walletAddress: string }) {
  const navigate = useNavigate()
  const session = useSession()
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<MerchantInput>(() => ({
    name: merchant?.name ?? '',
    category: merchant?.category ?? '',
    description: merchant?.description ?? '',
    phone: merchant?.phone ?? '',
    location: merchant?.location ?? '',
    logo: merchant?.logo ?? null,
    payoutAddress: merchant && !merchant.payoutVerified ? merchant.payoutAddress : '',
  }))
  const [otherAddress, setOtherAddress] = useState(Boolean(merchant && !merchant.payoutVerified))
  const [logoError, setLogoError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => setError(null), [form])

  const set = <K extends keyof MerchantInput>(key: K, value: MerchantInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const address = otherAddress ? parseNimiqAddress(form.payoutAddress) : null
  const addressInvalid = otherAddress && form.payoutAddress.trim() !== '' && !address
  const missing = { name: !form.name.trim(), category: !form.category.trim(), address: otherAddress && !address }

  async function pickLogo(file: File | undefined) {
    if (!file) return
    setLogoError(null)
    try {
      set('logo', await logoFromFile(file))
    } catch (e) {
      setLogoError(errorMessage(e))
    }
  }

  async function save() {
    setTouched(true)
    if (!session || missing.name || missing.category || missing.address) return
    setSaving(true)
    try {
      await saveMerchant(session, { ...form, payoutAddress: otherAddress && address ? address : '' })
      navigate('/merchant', { replace: true })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="flex items-center gap-4">
        <MerchantAvatar name={form.name.trim() || null} logo={form.logo} className="size-20 text-2xl" />
        <div className="flex flex-col items-start gap-1">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pickLogo(e.target.files?.[0])} />
          <Button type="button" size="lg" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
            <ImagePlus data-icon="inline-start" />
            {form.logo ? 'Change logo' : 'Add logo'}
          </Button>
          {form.logo ? (
            <Button type="button" size="lg" variant="ghost" className="h-11 text-destructive" onClick={() => set('logo', null)}>
              <Trash2 data-icon="inline-start" />
              Remove logo
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Optional. Square images look best.</p>
          )}
          {logoError && <p className="text-sm text-destructive">{logoError}</p>}
        </div>
      </div>

      <FieldGroup>
        <Field data-invalid={touched && missing.name ? true : undefined}>
          <FieldLabel htmlFor="shop-name">Business name</FieldLabel>
          <Input id="shop-name" autoComplete="organization" maxLength={60} placeholder="Mama Put Kitchen" value={form.name} onChange={(e) => set('name', e.target.value)} aria-invalid={touched && missing.name ? true : undefined} />
          {touched && missing.name && <FieldError>Add the name customers know you by</FieldError>}
        </Field>
        <Field data-invalid={touched && missing.category ? true : undefined}>
          <FieldLabel htmlFor="shop-category">Category</FieldLabel>
          <Input id="shop-category" maxLength={40} placeholder="What do you sell?" value={form.category} onChange={(e) => set('category', e.target.value)} aria-invalid={touched && missing.category ? true : undefined} />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Common categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('category', c)}
                aria-pressed={form.category === c}
                className={cn(
                  'h-11 shrink-0 rounded-full px-4 text-sm font-medium ring-1 ring-foreground/10 transition-colors motion-safe:active:scale-[0.96]',
                  form.category === c ? 'bg-primary text-primary-foreground ring-primary' : 'bg-card text-foreground hover:bg-muted',
                )}
              >
                {c}
              </button>
            ))}
          </div>
          {touched && missing.category && <FieldError>Pick or type a category</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="shop-description">Short description (optional)</FieldLabel>
          <Textarea id="shop-description" rows={2} maxLength={160} placeholder="Jollof, suya and cold zobo" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="shop-location">Location (optional)</FieldLabel>
          <Input id="shop-location" autoComplete="address-level2" maxLength={80} placeholder="Yaba, Lagos" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="shop-phone">Phone (optional)</FieldLabel>
          <Input id="shop-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="+234 801 234 5678" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          <FieldDescription>Shown on your banner and pay page so customers can reach you.</FieldDescription>
        </Field>
        <Field orientation="horizontal" className="min-h-11">
          <FieldContent>
            <FieldLabel htmlFor="shop-other-address">Receive at another address</FieldLabel>
            <FieldDescription>
              {otherAddress ? 'Payments go to the address below.' : `Payments go to this wallet, ${shortAddress(walletAddress)}.`}
            </FieldDescription>
          </FieldContent>
          <Switch id="shop-other-address" checked={otherAddress} onCheckedChange={setOtherAddress} />
        </Field>
        {otherAddress && (
          <Field data-invalid={addressInvalid || (touched && missing.address) ? true : undefined}>
            <FieldLabel htmlFor="shop-address">Nimiq address for payments</FieldLabel>
            <Input
              id="shop-address"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="NQ.. .... .... ...."
              value={form.payoutAddress}
              onChange={(e) => set('payoutAddress', e.target.value.toUpperCase())}
              aria-invalid={addressInvalid || (touched && missing.address) ? true : undefined}
              className="font-mono"
            />
            {addressInvalid || (touched && missing.address) ? (
              <FieldError>That isn't a valid Nimiq address. Check it letter by letter.</FieldError>
            ) : (
              <FieldDescription>Customers see that this address isn't the wallet you signed in with, so prefer your own.</FieldDescription>
            )}
          </Field>
        )}
      </FieldGroup>

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="xl" disabled={saving}>
        {saving && <Spinner data-icon="inline-start" />}
        {saving ? 'Saving…' : merchant ? 'Save changes' : 'Create shop'}
      </Button>
    </form>
  )
}
