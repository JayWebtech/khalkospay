import {
  ArrowLeftRight,
  BellRing,
  Camera,
  CircleAlert,
  Clock,
  Coins,
  HeartCrack,
  LoaderCircle,
  Moon,
  Sparkles,
  Star,
  Sun,
  Sunrise,
  ThumbsUp,
  TriangleAlert,
  Undo2,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { PetArt, SPECIES_TINT } from '@/components/pet-art'
import { WalletNotice } from '@/components/wallet-notice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { MealSlot, Pet, PetConfig, PetMeal, PetMood, PetRevival, PetSpecies, PetWindow } from '@/lib/api'
import { formatNim } from '@/lib/format'
import {
  adoptPet,
  changeBuddy,
  feedPet,
  formatClock,
  getRevival,
  reportRevivalPayment,
  shrinkPhoto,
  SLOT_LABEL,
  startRevival,
  usePetConfig,
  usePetStore,
  useReminders,
} from '@/lib/pets'
import { cn } from '@/lib/utils'
import { errorMessage, isUserRejection, useWallet } from '@/lib/wallet'

const CANCELLED = 'Payment cancelled. Nothing left your wallet.'

const SLOT_ICON: Record<MealSlot, LucideIcon> = { BREAKFAST: Sunrise, LUNCH: Sun, DINNER: Moon }

const MOOD: Record<PetMood, { label: string; tone: 'success' | 'pending' | 'destructive' | 'secondary'; line: (name: string) => string }> = {
  thriving: { label: 'Thriving', tone: 'success', line: (n) => `${n} is bursting with energy.` },
  happy: { label: 'Happy', tone: 'success', line: (n) => `${n} is doing well.` },
  hungry: { label: 'Hungry', tone: 'pending', line: (n) => `${n} is hungry.` },
  weak: { label: 'Weak', tone: 'destructive', line: (n) => `${n} is weak from missed meals. Good food brings the strength back.` },
  sleeping: { label: 'Asleep', tone: 'secondary', line: (n) => `${n} is asleep until breakfast.` },
  dead: { label: 'Passed away', tone: 'secondary', line: (n) => `${n} has passed away.` },
}

function useNow(ms: number) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const timer = setInterval(tick, ms)
    return () => clearInterval(timer)
  }, [ms])
  return Date.now()
}

function timeLeft(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

function hourLabel(hour: number) {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' })
}

export function BiteBuddyPage() {
  const wallet = useWallet()
  const { data: config, error: configError } = usePetConfig()
  const pet = usePetStore((s) => s.pet)
  const state = usePetStore((s) => s.state)
  const loadError = usePetStore((s) => s.error)
  const [changing, setChanging] = useState(false)

  if (!config || (wallet.status === 'connected' && (state === 'idle' || state === 'loading'))) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="BiteBuddy" description="Eat well and your buddy grows strong" back="/" />
        <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
          {configError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{configError}</AlertDescription>
            </Alert>
          ) : (
            <>
              <Skeleton className="h-72 rounded-3xl" />
              <Skeleton className="h-40 rounded-3xl" />
            </>
          )}
        </div>
      </div>
    )
  }

  if (wallet.status === 'connected' && state === 'error' && !pet) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="BiteBuddy" back="/" />
        <div className="px-4 pt-2">
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>We couldn't load your buddy</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-3">
              {loadError}
              <Button size="lg" variant="outline" onClick={() => void usePetStore.getState().load(wallet.address)}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  if (!pet || wallet.status !== 'connected') return <BuddyPicker config={config} />
  if (changing) return <BuddyPicker config={config} pet={pet} onDone={() => setChanging(false)} />
  return <BuddyHome pet={pet} config={config} onChangeBuddy={() => setChanging(true)} />
}

function BuddyPicker({ config, pet, onDone }: { config: PetConfig; pet?: Pet; onDone?: () => void }) {
  const wallet = useWallet()
  const setPet = usePetStore((s) => s.set)
  const changing = Boolean(pet)
  const [selected, setSelected] = useState(pet?.species ?? config.species[0].id)
  const currentSpecies = config.species.find((s) => s.id === pet?.species)
  const [name, setName] = useState(pet && pet.name !== currentSpecies?.name ? pet.name : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const species = config.species.find((s) => s.id === selected) ?? config.species[0]
  const finalName = name.trim() || species.name
  const windowRange = (slot: MealSlot) => {
    const w = config.windows.find((x) => x.slot === slot)!
    return `${hourLabel(w.startHour)}–${hourLabel(w.endHour)}`
  }

  async function submit() {
    if (!wallet.address) return
    setBusy(true)
    setError(null)
    try {
      const input = { address: wallet.address, species: selected, name: name.trim() }
      setPet(changing ? await changeBuddy(input) : await adoptPet(input))
      onDone?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={changing ? 'Change buddy' : 'Choose your buddy'}
        back={changing ? undefined : '/'}
        action={
          changing && (
            <Button variant="ghost" size="lg" onClick={onDone}>
              Cancel
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        {!changing && <WalletNotice purpose="adopting a buddy" />}

        <SpeciesCard species={species} />

        <ToggleGroup
          value={[selected]}
          onValueChange={(v) => v[0] && setSelected(v[0])}
          className="grid w-full grid-cols-3 gap-2"
          aria-label="Buddies"
        >
          {config.species.map((s) => (
            <ToggleGroupItem
              key={s.id}
              value={s.id}
              variant="outline"
              className="h-auto flex-col gap-0 rounded-2xl px-1 pt-2 pb-3 text-sm font-medium aria-pressed:ring-2 aria-pressed:ring-primary data-[pressed]:ring-2 data-[pressed]:ring-primary"
            >
              <PetArt species={s.id} mood={s.id === selected ? 'thriving' : 'happy'} className="size-20" />
              {s.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Field>
          <FieldLabel htmlFor="buddy-name">Name</FieldLabel>
          <Input id="buddy-name" maxLength={20} autoComplete="off" placeholder={species.name} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        {changing ? (
          <p className="text-sm text-muted-foreground">Strength, level and today's meals carry over to your new buddy.</p>
        ) : (
          <ul className="flex flex-col gap-3 rounded-3xl bg-card p-5 text-sm ring-1 ring-foreground/10">
            <li className="flex gap-3">
              <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>
                Feed it breakfast {windowRange('BREAKFAST')}, lunch {windowRange('LUNCH')} and dinner {windowRange('DINNER')}. Each meal only counts in its own window.
              </span>
            </li>
            <li className="flex gap-3">
              <HeartCrack className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                A missed meal costs strength, breakfast the most (−{species.missPenalty.BREAKFAST} for {species.name}). A whole day without food is
                fatal.
              </span>
            </li>
            <li className="flex gap-3">
              <Coins className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Bringing a buddy back costs {formatNim(config.revivePriceNim, 5)}.</span>
            </li>
          </ul>
        )}

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          size="xl"
          disabled={wallet.status !== 'connected' || busy || (changing && selected === pet?.species && finalName === pet?.name)}
          onClick={() => void submit()}
        >
          {busy && <Spinner data-icon="inline-start" />}
          {changing ? `Switch to ${finalName}` : `Adopt ${finalName}`}
        </Button>
      </div>
    </div>
  )
}

function SpeciesCard({ species }: { species: PetSpecies }) {
  const tint = SPECIES_TINT[species.id] ?? SPECIES_TINT.sunny
  return (
    <section className="relative overflow-hidden rounded-3xl bg-card px-5 pt-4 pb-5 text-center ring-1 ring-foreground/10" aria-live="polite">
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-0 h-56 bg-radial-[at_50%_20%] to-transparent to-70%', tint.glow)} />
      <div className="relative">
        <PetArt species={species.id} mood="happy" label={`${species.name}, the ${species.kind.toLowerCase()}`} className="mx-auto size-40" />
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{species.name}</h2>
        <span className={cn('mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold', tint.chip)}>{species.kind}</span>
        <p className="mt-3 font-semibold text-primary">{species.title}</p>
        <p className="mx-auto mt-1 max-w-[34ch] text-sm text-muted-foreground">{species.description}</p>

        <div className="mt-4 rounded-2xl bg-muted/60 p-3 text-left">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            {species.ability.name}
          </p>
          <p className="text-sm text-muted-foreground">{species.ability.description}</p>
        </div>

        <div className="mt-3 flex flex-col gap-1 text-left text-sm">
          <p className="flex items-center gap-2">
            <ThumbsUp className="size-4 shrink-0 text-success" aria-hidden="true" />
            <span>
              <span className="text-muted-foreground">Best at</span> {species.bestAt.toLowerCase()}
            </span>
          </p>
          <p className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>
              <span className="text-muted-foreground">Watch out for</span> {species.watchOut.toLowerCase()}
            </span>
          </p>
        </div>

        <dl className="mt-4 flex flex-col gap-2.5 text-left">
          <Meter label="Metabolism" value={species.stats.metabolism} barClass="bg-orange-400" />
          <Meter label="Toughness" value={species.stats.toughness} barClass="bg-sky-400" />
          <Meter label="Growth" value={species.stats.growth} barClass="bg-emerald-400" />
        </dl>
      </div>
    </section>
  )
}

function Meter({
  label,
  value,
  max = 100,
  barClass,
  icon: Icon,
  display,
}: {
  label: string
  value: number
  max?: number
  barClass: string
  icon?: LucideIcon
  display?: string
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-4" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="contents">
        <span
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <span className={cn('block h-full rounded-full transition-[width] duration-500', barClass)} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
        </span>
        <span className="min-w-8 text-right font-semibold tabular-nums">{display ?? value}</span>
      </dd>
    </div>
  )
}

function BuddyHome({ pet, config, onChangeBuddy }: { pet: Pet; config: PetConfig; onChangeBuddy: () => void }) {
  const wallet = useWallet()
  const setPet = usePetStore((s) => s.set)
  const species = config.species.find((s) => s.id === pet.species) ?? config.species[0]
  const tint = SPECIES_TINT[species.id] ?? SPECIES_TINT.sunny
  const now = useNow(30_000)
  const [feeding, setFeeding] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [fedMealId, setFedMealId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dead = pet.status === 'DEAD'
  const open = pet.current
  const mood = MOOD[pet.mood]
  const strengthBar = pet.strength >= 55 ? 'bg-emerald-400' : pet.strength >= 30 ? 'bg-amber-400' : 'bg-red-400'
  const justFed = pet.recentMeals.find((m) => m.id === fedMealId)

  async function onPhoto(file: File) {
    if (!wallet.address) return
    setFeeding(true)
    setFeedError(null)
    try {
      const { pet: next, mealId } = await feedPet(wallet.address, await shrinkPhoto(file))
      setPet(next)
      setFedMealId(mealId)
    } catch (e) {
      setFeedError(errorMessage(e))
      void usePetStore.getState().load(wallet.address)
    } finally {
      setFeeding(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="BiteBuddy"
        description="Eat well and your buddy grows strong"
        back="/"
        action={
          !dead && (
            <Button variant="outline" size="lg" onClick={onChangeBuddy}>
              <ArrowLeftRight data-icon="inline-start" />
              Change
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        <section className="relative overflow-hidden rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="buddy-name">
          <div aria-hidden="true" className={cn('pointer-events-none absolute -top-10 -left-10 size-64 bg-radial to-transparent to-70%', dead ? 'from-slate-400/20' : tint.glow)} />
          <div className="relative flex items-center gap-3">
            <PetArt
              species={pet.species}
              mood={pet.mood}
              label={`${pet.name} looks ${mood.label.toLowerCase()}`}
              className="size-36 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Your buddy</p>
              <h2 id="buddy-name" className="truncate text-2xl font-semibold tracking-tight">
                {pet.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', tint.chip)}>{species.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">Lv {pet.level}</span>
              </div>
              <Badge variant={mood.tone} className="mt-2">
                {mood.label}
              </Badge>
            </div>
          </div>

          <p className="relative mt-3 text-sm text-muted-foreground" aria-live="polite">
            {dead
              ? pet.deathReason
              : open
                ? `${mood.line(pet.name)} ${SLOT_LABEL[open.slot]} is open for ${timeLeft(open.closesAt, now)}.`
                : mood.line(pet.name)}
          </p>

          <dl className="relative mt-4 flex flex-col gap-3">
            <Meter label="Strength" icon={Zap} value={pet.strength} barClass={dead ? 'bg-muted-foreground/40' : strengthBar} />
            <Meter
              label={`Level ${pet.level}`}
              icon={Star}
              value={pet.levelXp}
              max={pet.levelSize}
              barClass="bg-violet-400"
              display={`${pet.levelXp}/${pet.levelSize}`}
            />
          </dl>

          {!dead && (
            <div className="relative mt-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void onPhoto(e.target.files[0])}
              />
              <Button size="xl" className="w-full" disabled={!open || feeding} onClick={() => fileRef.current?.click()}>
                {feeding ? <Spinner data-icon="inline-start" /> : open ? <Camera data-icon="inline-start" /> : <Clock data-icon="inline-start" />}
                {feeding
                  ? 'Checking your meal…'
                  : open
                    ? `Feed ${SLOT_LABEL[open.slot].toLowerCase()}`
                    : `${SLOT_LABEL[pet.next.slot]} opens at ${formatClock(pet.next.opensAt)}`}
              </Button>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                {open ? `Snap what you're eating. Closes at ${formatClock(open.closesAt)}.` : 'Meals can only be fed in their own time window.'}
              </p>
            </div>
          )}
        </section>

        {feedError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{feedError}</AlertDescription>
          </Alert>
        )}

        {dead && <RevivePanel pet={pet} config={config} />}

        {justFed && <LatestMeal meal={justFed} />}

        <TodaySchedule pet={pet} species={species} now={now} />

        {!dead && <ReminderSettings />}

        <MealHistory meals={pet.recentMeals} />
      </div>
    </div>
  )
}

const WINDOW_BADGE: Record<PetWindow['state'], { label: (w: PetWindow) => string; variant: 'success' | 'destructive' | 'pending' | 'secondary' | 'outline' }> = {
  fed: { label: (w) => `Fed · ${signed(w.meal?.strengthDelta ?? 0)}`, variant: 'success' },
  missed: { label: () => 'Missed', variant: 'destructive' },
  open: { label: () => 'Open now', variant: 'pending' },
  upcoming: { label: () => 'Later', variant: 'secondary' },
  skipped: { label: () => 'Not counted', variant: 'outline' },
}

function signed(n: number) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0'
}

function TodaySchedule({ pet, species, now }: { pet: Pet; species: PetSpecies; now: number }) {
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const p = species.missPenalty
  return (
    <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="today-heading">
      <h2 id="today-heading" className="text-sm font-semibold">
        Today's meals
      </h2>
      <ol className="mt-3 flex flex-col gap-2">
        {pet.today.windows.map((w) => {
          const Icon = SLOT_ICON[w.slot]
          const badge = WINDOW_BADGE[w.state]
          const missedBy = pet.recentMeals.find((m) => !m.fed && m.slot === w.slot && m.day === pet.today.day)
          return (
            <li
              key={w.slot}
              className={cn('flex min-h-14 items-center gap-3 rounded-2xl bg-muted/50 px-3 py-2', w.state === 'open' && 'bg-accent ring-1 ring-primary/40')}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{SLOT_LABEL[w.slot]}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {w.state === 'open' ? `Until ${formatClock(w.end)} · ${timeLeft(w.end, now)} left` : `${formatClock(w.start)} – ${formatClock(w.end)}`}
                </p>
              </div>
              <Badge variant={badge.variant} className="tabular-nums">
                {w.state === 'missed' && missedBy ? `Missed · ${signed(missedBy.strengthDelta)}` : badge.label(w)}
              </Badge>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">
        Missing a meal costs {species.name} strength: breakfast −{p.BREAKFAST}, lunch −{p.LUNCH}, dinner −{p.DINNER}. A whole day without food is fatal
        {pet.lastStandAvailable ? `, though ${species.name}'s Last Stand can save it once` : ''}.
      </p>
      {deviceZone !== pet.timezone && <p className="mt-2 text-sm text-muted-foreground">Meal times follow {pet.timezone}, where you adopted {pet.name}.</p>}
    </section>
  )
}

function ReminderSettings() {
  const enabled = useReminders((s) => s.enabled)
  const delivery = useReminders((s) => s.delivery)
  const enable = useReminders((s) => s.enable)
  const disable = useReminders((s) => s.disable)
  return (
    <section className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <Field orientation="horizontal">
        <BellRing className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <FieldContent>
          <FieldLabel htmlFor="meal-reminders">Meal reminders</FieldLabel>
          <FieldDescription>
            {!enabled
              ? 'Get a nudge when each meal opens, and a last call an hour before it closes.'
              : delivery === 'system'
                ? "You'll get a notification when each meal opens and an hour before it closes, while KhalkosPay is open."
                : "Notifications aren't allowed here, so reminders appear inside KhalkosPay while it's open."}
          </FieldDescription>
        </FieldContent>
        <Switch id="meal-reminders" checked={enabled} onCheckedChange={(on) => (on ? void enable() : disable())} />
      </Field>
    </section>
  )
}

function LatestMeal({ meal }: { meal: PetMeal }) {
  const score = meal.score ?? 0
  const verdict = score >= 70 ? { label: 'Healthy', className: 'text-success' } : score >= 40 ? { label: 'Okay', className: 'text-foreground' } : { label: 'Junk', className: 'text-destructive' }
  return (
    <section aria-label="Latest meal" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{SLOT_LABEL[meal.slot]}</p>
          <h2 className="text-lg font-semibold">{meal.name}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {signed(meal.strengthDelta)} strength · +{meal.xpDelta} XP
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-3xl font-semibold tabular-nums', verdict.className)}>{score}</p>
          <p className="text-sm text-muted-foreground">{verdict.label}</p>
        </div>
      </div>
      {meal.nutrients && (
        <dl className="mt-4 grid grid-cols-5 gap-2 text-center">
          {Object.entries(meal.nutrients).map(([key, value]) => (
            <div key={key} className="flex flex-col-reverse rounded-xl bg-muted/60 py-2">
              <dt className="text-[0.6875rem] text-muted-foreground capitalize">{key === 'calories' ? 'kcal' : key}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {Math.round(value)}
                {key === 'calories' ? '' : 'g'}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function MealHistory({ meals }: { meals: PetMeal[] }) {
  if (meals.length === 0) return null
  return (
    <section aria-labelledby="history-heading" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
      <h2 id="history-heading" className="mb-3 text-sm font-semibold">
        Recent meals
      </h2>
      <ul className="flex flex-col gap-3">
        {meals.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className={cn('truncate font-medium', !m.fed && 'text-destructive')}>{m.fed ? m.name : `Missed ${SLOT_LABEL[m.slot].toLowerCase()}`}</p>
              <p className="text-muted-foreground">
                {SLOT_LABEL[m.slot]} · {new Date(`${m.day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            </div>
            <span className={cn('shrink-0 font-semibold tabular-nums', m.strengthDelta < 0 ? 'text-destructive' : 'text-success')}>{signed(m.strengthDelta)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

type RevivePhase = 'idle' | 'preparing' | 'approving' | 'reporting'

const REVIVE_LABEL: Record<RevivePhase, string> = {
  idle: '',
  preparing: 'Preparing payment…',
  approving: 'Waiting for approval…',
  reporting: 'Confirming payment…',
}

function RevivePanel({ pet, config }: { pet: Pet; config: PetConfig }) {
  const wallet = useWallet()
  const load = usePetStore((s) => s.load)
  const [phase, setPhase] = useState<RevivePhase>('idle')
  const [revival, setRevival] = useState<PetRevival | null>(null)
  const [error, setError] = useState<string | null>(null)
  const networkMismatch = Boolean(wallet.provider && config.network !== wallet.network)
  const waiting = Boolean(revival && (revival.confirming || revival.status === 'REFUNDING'))

  useEffect(() => {
    if (!revival || !waiting) return
    const timer = setTimeout(async () => {
      try {
        const next = await getRevival(revival.id)
        setRevival(next)
        if (next.status === 'PAID') void load(wallet.address)
      } catch {
        setRevival({ ...revival })
      }
    }, 3_000)
    return () => clearTimeout(timer)
  }, [revival, waiting, load, wallet.address])

  async function revive() {
    if (!wallet.address) return
    setError(null)
    try {
      setPhase('preparing')
      const order = await startRevival(wallet.address)
      setRevival(order)
      if (!order.payment) return
      setPhase('approving')
      const tx = await wallet.pay(order.payment)
      setPhase('reporting')
      // If reporting fails, the server still finds the payment by its memo.
      setRevival(await reportRevivalPayment(order.id, tx).catch(() => ({ ...order, payment: null, confirming: true })))
    } catch (e) {
      setError(isUserRejection(e) ? CANCELLED : errorMessage(e))
    } finally {
      setPhase('idle')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-card p-5 ring-1 ring-foreground/10" aria-labelledby="revive-heading" aria-live="polite">
      <h2 id="revive-heading" className="text-lg font-semibold tracking-tight">
        Bring {pet.name} back
      </h2>
      <p className="text-sm text-muted-foreground">
        Reviving costs {formatNim(config.revivePriceNim, 5)}, paid to KhalkosPay from your wallet. {pet.name} returns with 50 strength and keeps its level and
        XP.
      </p>
      <WalletNotice purpose="reviving your buddy" />
      {networkMismatch && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Switch Nimiq Pay to {config.network}</AlertTitle>
          <AlertDescription>Your wallet is on {wallet.network}. A payment on the wrong network can't revive {pet.name}.</AlertDescription>
        </Alert>
      )}
      {revival?.confirming && (
        <Alert>
          <LoaderCircle className="motion-safe:animate-spin" />
          <AlertTitle>Confirming your payment</AlertTitle>
          <AlertDescription>
            {pet.name} wakes up as soon as your {revival.priceNim} NIM confirms on the Nimiq network. This usually takes under a minute.
          </AlertDescription>
        </Alert>
      )}
      {revival && (revival.status === 'REFUNDING' || revival.status === 'REFUNDED') && (
        <Alert>
          <Undo2 />
          <AlertTitle>{revival.status === 'REFUNDED' ? 'Payment returned' : 'Returning your payment'}</AlertTitle>
          <AlertDescription>{revival.failureReason}</AlertDescription>
        </Alert>
      )}
      {revival?.status === 'AWAITING_PAYMENT' && !revival.confirming && revival.failureReason && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{revival.failureReason}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant={error === CANCELLED ? 'default' : 'destructive'}>
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!config.reviveEnabled && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>Reviving isn't switched on for this server yet.</AlertDescription>
        </Alert>
      )}
      <Button
        size="xl"
        onClick={() => void revive()}
        disabled={phase !== 'idle' || waiting || wallet.status !== 'connected' || networkMismatch || !config.reviveEnabled}
      >
        {phase !== 'idle' || waiting ? <Spinner data-icon="inline-start" /> : <Wallet data-icon="inline-start" />}
        {phase !== 'idle' ? REVIVE_LABEL[phase] : waiting ? 'Waiting for confirmation…' : `Revive for ${formatNim(config.revivePriceNim, 5)}`}
      </Button>
    </section>
  )
}
