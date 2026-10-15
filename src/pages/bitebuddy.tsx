import { Camera, CircleAlert, Moon, Sun, Sunrise } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

type MealType = 'breakfast' | 'lunch' | 'dinner'

interface Meal {
  id: string
  type: MealType
  name: string
  score: number
  nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number }
}

const MEALS: { value: MealType; label: string; icon: typeof Sun }[] = [
  { value: 'breakfast', label: 'Breakfast', icon: Sunrise },
  { value: 'lunch', label: 'Lunch', icon: Sun },
  { value: 'dinner', label: 'Dinner', icon: Moon },
]

function verdict(score: number) {
  if (score >= 70) return { label: 'Great', className: 'text-success' }
  if (score >= 40) return { label: 'Okay', className: 'text-foreground' }
  return { label: 'Junk', className: 'text-destructive' }
}

export function BiteBuddyPage() {
  const [health, setHealth] = useState(70)
  const [points, setPoints] = useState(0)
  const [meals, setMeals] = useState<Meal[]>([])
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pet = useMemo(() => {
    if (health >= 80) return { emoji: '😸', mood: 'Thriving' }
    if (health >= 60) return { emoji: '😺', mood: 'Happy' }
    if (health >= 40) return { emoji: '😿', mood: 'Peckish' }
    return { emoji: '🙀', mood: 'Starving' }
  }, [health])

  function analyze(file: File) {
    setScanning(true)
    setError(null)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const data = await api<Omit<Meal, 'id' | 'type'>>('/api/bitebuddy/analyze', { json: { image: reader.result, mealType } })
        const meal: Meal = { ...data, id: crypto.randomUUID?.() ?? String(Date.now()), type: mealType }
        setMeals((prev) => [meal, ...prev])
        setPoints((p) => p + meal.score)
        setHealth((h) => Math.max(0, Math.min(100, h + (meal.score >= 70 ? 6 : meal.score >= 40 ? 1 : -8))))
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't analyse that photo")
      } finally {
        setScanning(false)
        if (fileRef.current) fileRef.current.value = ''
      }
    }
    reader.readAsDataURL(file)
  }

  const latest = meals[0]
  const mealLabel = MEALS.find((m) => m.value === mealType)!.label.toLowerCase()

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title="BiteBuddy" description="Eat well and Nibbles grows strong" back="/" />
      <div className="flex flex-col gap-4 px-4 pt-2 pb-6">
        <section aria-label="Your pet" className="flex items-center gap-4 rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
          <span
            className="flex size-24 shrink-0 items-center justify-center rounded-full bg-accent text-5xl motion-safe:transition-[scale] motion-safe:duration-300"
            style={{ scale: String(0.8 + health * 0.002) }}
            role="img"
            aria-label={`Nibbles looks ${pet.mood.toLowerCase()}`}
          >
            {pet.emoji}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Nibbles</h2>
              <Badge variant={health >= 60 ? 'success' : health >= 40 ? 'secondary' : 'destructive'}>{pet.mood}</Badge>
            </div>
            <Progress value={health} aria-label="Nibbles' health" />
            <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
              <span>Health {health}%</span>
              <span>{points} pts</span>
            </div>
          </div>
        </section>

        <ToggleGroup
          value={[mealType]}
          onValueChange={(v) => v[0] && setMealType(v[0] as MealType)}
          className="grid w-full grid-cols-3 gap-2"
          aria-label="Meal"
        >
          {MEALS.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} className="h-12 rounded-xl" variant="outline">
              <Icon data-icon="inline-start" />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])}
        />
        <Button size="xl" disabled={scanning} onClick={() => fileRef.current?.click()}>
          {scanning ? <Spinner data-icon="inline-start" /> : <Camera data-icon="inline-start" />}
          {scanning ? 'Checking your meal…' : `Scan your ${mealLabel}`}
        </Button>

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {latest && (
          <section aria-label="Latest meal" className="rounded-3xl bg-card p-5 ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground capitalize">{latest.type}</p>
                <h2 className="text-lg font-semibold">{latest.name}</h2>
              </div>
              <div className="text-right">
                <p className={cn('text-3xl font-semibold tabular-nums', verdict(latest.score).className)}>+{latest.score}</p>
                <p className="text-sm text-muted-foreground">{verdict(latest.score).label}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-5 gap-2 text-center">
              {Object.entries(latest.nutrients).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-muted/60 py-2">
                  <dd className="text-sm font-semibold tabular-nums">
                    {Math.round(value)}
                    {key === 'calories' ? '' : 'g'}
                  </dd>
                  <dt className="text-[0.6875rem] text-muted-foreground capitalize">{key === 'calories' ? 'kcal' : key}</dt>
                </div>
              ))}
            </dl>
          </section>
        )}

        {meals.length > 1 && (
          <section aria-labelledby="history-heading" className="flex flex-col gap-1">
            <h2 id="history-heading" className="text-base font-semibold">
              Earlier today
            </h2>
            <ItemGroup>
              {meals.slice(1, 8).map((meal) => (
                <Item key={meal.id} className="px-0">
                  <ItemContent>
                    <ItemTitle>{meal.name}</ItemTitle>
                    <ItemDescription className="capitalize">
                      {meal.type} · {Math.round(meal.nutrients.calories)} kcal
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className={cn('font-semibold tabular-nums', verdict(meal.score).className)}>+{meal.score}</ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </div>
    </div>
  )
}
