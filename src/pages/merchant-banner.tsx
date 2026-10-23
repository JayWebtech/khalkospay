import { CircleAlert, Download, Link2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { CopyButton } from '@/components/copy-button'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { OwnMerchant } from '@/lib/api'
import { BANNER_HEIGHT, BANNER_WIDTH, bannerFileName, canvasToPng, renderMerchantBanner } from '@/lib/merchant-banner'
import { merchantPayLink, useOwnMerchant } from '@/lib/merchants'
import { errorMessage, sameAddress, useWallet } from '@/lib/wallet'
import { useSession } from '@/lib/wallet-session'

export function MerchantBannerPage() {
  const wallet = useWallet()
  const session = useSession()
  const own = session && sameAddress(session.address, wallet.address) ? session : null
  const { merchant, error } = useOwnMerchant(own)

  // The wallet's account is only known once detection finishes; don't bounce a reload before then.
  if (wallet.status === 'detecting') return <Skeleton className="mx-4 mt-20 aspect-[2000/2828] rounded-2xl" />
  if (!own || merchant === null) return <Navigate to="/merchant" replace />
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="Your QR banner" back="/merchant" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {merchant === undefined && !error && <Skeleton className="aspect-[2000/2828] rounded-2xl" />}
        {merchant === undefined && error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {merchant && <Banner merchant={merchant} />}
      </div>
    </div>
  )
}

function Banner({ merchant }: { merchant: OwnMerchant }) {
  const [image, setImage] = useState<{ url: string; file: File } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let url: string | null = null
    renderMerchantBanner(merchant)
      .then(canvasToPng)
      .then((blob) => {
        if (!alive) return
        url = URL.createObjectURL(blob)
        setImage({ url, file: new File([blob], bannerFileName(merchant), { type: 'image/png' }) })
      })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [merchant])

  // Nimiq Pay's WebView may ignore download links, so the share sheet (Save image, Print, WhatsApp…) comes first.
  const canShareFile = Boolean(image && typeof navigator.canShare === 'function' && navigator.canShare({ files: [image.file] }))

  async function share() {
    if (!image) return
    setNote(null)
    try {
      await navigator.share({ files: [image.file], title: `${merchant.name} · Pay with NIM` })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      download()
    }
  }

  function download() {
    if (!image) return
    const a = document.createElement('a')
    a.href = image.url
    a.download = image.file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setNote("If nothing downloaded, press and hold the banner above and choose Save image.")
  }

  const link = merchantPayLink(merchant.code)
  return (
    <>
      {image ? (
        <img
          src={image.url}
          width={BANNER_WIDTH}
          height={BANNER_HEIGHT}
          alt={`Banner for ${merchant.name}: a large QR code with "Scan to pay with NIM · KhalkosPay" and shop code ${merchant.code}`}
          className="h-auto w-full rounded-2xl shadow-[0_16px_40px_-24px_oklch(0.23_0.02_50/0.6)] ring-1 ring-foreground/10"
        />
      ) : error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <Skeleton className="aspect-[2000/2828] rounded-2xl" aria-label="Drawing your banner" />
      )}

      <p className="text-sm text-muted-foreground">
        A {BANNER_WIDTH} × {BANNER_HEIGHT} PNG that prints sharp on A5 or A4. Put it where customers pay, at eye level, and cover it with clear tape
        so it lasts.
      </p>

      <div className="flex flex-col gap-2">
        {canShareFile && (
          <Button size="xl" onClick={() => void share()} disabled={!image}>
            <Share2 data-icon="inline-start" />
            Share or save banner
          </Button>
        )}
        <Button size="xl" variant={canShareFile ? 'outline' : 'default'} onClick={download} disabled={!image}>
          <Download data-icon="inline-start" />
          Download PNG
        </Button>
        {note && (
          <p className="text-center text-sm text-muted-foreground" role="status">
            {note}
          </p>
        )}
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="link-heading">
        <h2 id="link-heading" className="text-sm font-semibold">
          Or share your pay link
        </h2>
        <div className="flex items-center gap-3 rounded-2xl bg-muted/60 py-1 pr-1 pl-4">
          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate font-mono text-sm select-all">{link}</p>
          <CopyButton value={link} label="Copy pay link" />
        </div>
        <p className="text-sm text-muted-foreground">
          Customers can also type shop code <span className="font-mono font-medium text-foreground">{merchant.code}</span> on the KhalkosPay Scan screen.
        </p>
      </section>
    </>
  )
}
