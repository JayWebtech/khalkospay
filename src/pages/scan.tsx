import { Camera, ChevronRight, RotateCcw, Store } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cameraMessage, cameraProblem, cameraUnavailable, openCamera, stopStream, type CameraProblem } from '@/lib/camera'
import { parseScan, scanTargetPath } from '@/lib/merchants'
import { decodeQrImage, qrDetector } from '@/lib/qr'

type CameraState = { phase: 'starting' } | { phase: 'live' } | { phase: 'problem'; problem: CameraProblem } | { phase: 'no-scanner' }

const NOT_A_PAYMENT = "That QR code isn't a NIM payment code. Look for the KhalkosPay banner at the counter."
const RETRYABLE: CameraProblem[] = ['denied', 'timeout', 'busy', 'failed']

/** Opens the camera and reads a shop's QR code, a nimiq: payment link or a plain NQ address. */
export function ScanPage() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const unavailable = cameraUnavailable()
  const [camera, setCamera] = useState<CameraState>(unavailable ? { phase: 'problem', problem: unavailable } : { phase: 'starting' })
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [readingPhoto, setReadingPhoto] = useState(false)

  /** Goes to the pay page for a recognised code; false (and a hint) for anything else. */
  const open = useCallback(
    (raw: string) => {
      const target = parseScan(raw)
      if (!target) {
        setNotice(NOT_A_PAYMENT)
        return false
      }
      navigator.vibrate?.(30)
      navigate(scanTargetPath(target))
      return true
    },
    [navigate],
  )

  useEffect(() => {
    if (cameraUnavailable()) return
    let alive = true
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let ignored = ''
    setCamera({ phase: 'starting' })

    void (async () => {
      try {
        stream = await openCamera()
      } catch (e) {
        if (alive) setCamera({ phase: 'problem', problem: cameraProblem(e) })
        return
      }
      const video = videoRef.current
      if (!alive || !video) return stopStream(stream)
      video.srcObject = stream
      // Muted and inline, so WebViews let it play without another tap.
      await video.play().catch(() => {})
      if (!alive) return
      setCamera({ phase: 'live' })

      let qr: Awaited<ReturnType<typeof qrDetector>>
      try {
        qr = await qrDetector()
      } catch {
        if (alive) setCamera({ phase: 'no-scanner' })
        stopStream(stream)
        return
      }
      const tick = async () => {
        if (!alive) return
        if (video.readyState >= 2 && document.visibilityState === 'visible') {
          try {
            const raw = (await qr.detect(video))[0]?.rawValue
            // A code that isn't a payment stays in view; say so once rather than on every frame.
            if (alive && raw && raw !== ignored) {
              if (open(raw)) return
              ignored = raw
            }
          } catch {
            // A frame that couldn't be read; try the next one.
          }
        }
        timer = setTimeout(() => void tick(), 180)
      }
      void tick()
    })()

    // Coming back from the background (or a permission screen) can leave the camera stopped; start it again.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && stream?.getVideoTracks().every((t) => t.readyState === 'ended')) setAttempt((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      stopStream(stream)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [attempt, open])

  async function readPhoto(file: File | undefined) {
    if (!file) return
    setNotice(null)
    setReadingPhoto(true)
    try {
      const raw = await decodeQrImage(file)
      if (!raw) setNotice('No QR code found in that photo. Hold the phone closer so the code fills most of the picture.')
      else open(raw)
    } catch {
      setNotice("Couldn't read that photo. Try again, or type the shop code instead.")
    } finally {
      setReadingPhoto(false)
      if (photoRef.current) photoRef.current.value = ''
    }
  }

  const problem = camera.phase === 'problem' ? cameraMessage(camera.problem) : camera.phase === 'no-scanner' ? { title: "The scanner didn't load", body: 'Check your connection and try again, or type the shop code printed under the QR code.' } : null
  const canRetry = (camera.phase === 'problem' && RETRYABLE.includes(camera.problem)) || camera.phase === 'no-scanner'

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Scan to pay"
        description="Pay a shop with NIM"
        back="/"
        action={
          <Link to="/merchant" className="-mr-2 flex h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Store className="size-4" aria-hidden="true" />
            Your shop
          </Link>
        }
      />
      <div className="flex flex-col gap-5 px-4 pt-2 pb-6">
        <section aria-label="Camera" className="relative isolate aspect-square overflow-hidden rounded-3xl bg-hero text-hero-foreground">
          <video ref={videoRef} muted playsInline autoPlay aria-hidden="true" className={camera.phase === 'live' ? 'absolute inset-0 size-full object-cover' : 'hidden'} />
          {camera.phase === 'live' && (
            <>
              {/* Viewfinder: four corners and a soft scan line, purely decorative. */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-[14%]">
                {['top-0 left-0 border-t-4 border-l-4 rounded-tl-3xl', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-3xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-3xl'].map((c) => (
                  <span key={c} className={`absolute size-12 border-hero-accent ${c}`} />
                ))}
              </div>
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pt-10 pb-4 text-center text-sm font-medium" role="status">
                Point at the shop's QR code
              </p>
            </>
          )}
          {camera.phase === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" role="status">
              <Spinner className="size-6" />
              <p className="text-sm text-hero-muted">Starting the camera… Allow camera access if Nimiq Pay asks.</p>
            </div>
          )}
          {problem && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
              <span className="flex size-12 items-center justify-center rounded-full bg-hero-foreground/12">
                <Camera className="size-6" aria-hidden="true" />
              </span>
              <h2 className="font-semibold">{problem.title}</h2>
              <p className="max-w-[32ch] text-sm text-hero-muted">{problem.body}</p>
              {canRetry && (
                <Button size="xl" variant="hero" className="mt-1" onClick={() => setAttempt((n) => n + 1)}>
                  <RotateCcw data-icon="inline-start" />
                  Try again
                </Button>
              )}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-2">
          {/* capture opens the camera app directly, which works even where the live camera can't (no HTTPS, permission off). */}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void readPhoto(e.target.files?.[0])} />
          <Button size="xl" variant={camera.phase === 'live' ? 'outline' : 'default'} onClick={() => photoRef.current?.click()} disabled={readingPhoto}>
            {readingPhoto ? <Spinner data-icon="inline-start" /> : <Camera data-icon="inline-start" />}
            {readingPhoto ? 'Reading the photo…' : 'Take a photo of the code'}
          </Button>
          {notice && (
            <p className="text-center text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          )}
        </div>

        <ManualEntry />

        <Link
          to="/merchant"
          className="flex min-h-18 items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-[scale,background-color] duration-150 ease-out hover:bg-muted/50 motion-safe:active:scale-[0.98]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Store className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Run a shop?</span>
            <span className="block text-sm text-muted-foreground">Get your own QR banner and take NIM.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

/** For when scanning doesn't work: the shop code printed under the QR, a pasted pay link, or a Nimiq address. */
function ManualEntry() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-3"
      aria-labelledby="manual-heading"
      onSubmit={(e) => {
        e.preventDefault()
        const target = parseScan(value)
        if (!target) {
          setError('Enter the 8-character shop code, like K7QM-3XPD, a pay link, or a Nimiq address.')
          return
        }
        navigate(scanTargetPath(target))
      }}
    >
      <h2 id="manual-heading" className="text-sm font-semibold">
        Can't scan?
      </h2>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="shop-code" className="sr-only">
          Shop code, pay link or Nimiq address
        </FieldLabel>
        <div className="flex gap-2">
          <Input
            id="shop-code"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Code, link or address"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            aria-invalid={error ? true : undefined}
            className="font-mono"
          />
          <Button type="submit" size="xl" variant="secondary" className="h-11" disabled={!value.trim()}>
            Go
          </Button>
        </div>
        {error ? <FieldError>{error}</FieldError> : <FieldDescription>The shop code is printed under the QR code.</FieldDescription>}
      </Field>
    </form>
  )
}
