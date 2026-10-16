import { MealSlot } from '@prisma/client'

export interface SpeciesRules {
  /** Multiplier on strength gained from okay and healthy meals. */
  gain: number
  /** Extra multiplier on breakfast gains. */
  breakfastGain: number
  /** Multiplier on strength lost to junk food (0 = immune). */
  junk: number
  /** Multiplier on strength lost to missed meals. */
  miss: number
  /** Extra multiplier on the missed-breakfast penalty. */
  missBreakfast: number
  /** Multiplier on XP from healthy meals. */
  healthyXp: number
  /** Survives the first day without food once per life. */
  lastStand: boolean
}

export interface Species {
  id: string
  name: string
  kind: string
  title: string
  description: string
  ability: { name: string; description: string }
  bestAt: string
  watchOut: string
  /** 0-100 display bars, kept in line with `rules`. */
  stats: { metabolism: number; toughness: number; growth: number }
  rules: SpeciesRules
}

const BASE: SpeciesRules = { gain: 1, breakfastGain: 1, junk: 1, miss: 1, missBreakfast: 1, healthyXp: 1, lastStand: false }

export const SPECIES: Species[] = [
  {
    id: 'sunny',
    name: 'Sunny',
    kind: 'Egg chick',
    title: 'The Early Riser',
    description: 'Hatched at dawn and wakes up starving. Breakfast is everything.',
    ability: { name: 'Early Bird', description: 'Breakfast gives double strength.' },
    bestAt: 'Healthy breakfasts',
    watchOut: 'Missed breakfasts hurt even more',
    stats: { metabolism: 70, toughness: 35, growth: 50 },
    rules: { ...BASE, breakfastGain: 2, missBreakfast: 1.25 },
  },
  {
    id: 'mochi',
    name: 'Mochi',
    kind: 'Rice-cake bunny',
    title: 'The Soft Sleeper',
    description: 'Squishy, calm and hard to upset. Bounces back from a skipped meal.',
    ability: { name: 'Soft Landing', description: 'Missed meals cost half the strength.' },
    bestAt: 'Busy days',
    watchOut: 'Grows at an easy pace',
    stats: { metabolism: 45, toughness: 90, growth: 40 },
    rules: { ...BASE, gain: 0.9, miss: 0.5 },
  },
  {
    id: 'jalapup',
    name: 'Jalapup',
    kind: 'Jalapeño pup',
    title: 'The Hot Streak',
    description: 'All fire and zoomies. Good food makes it unstoppable, junk makes it sulk.',
    ability: { name: 'Spicy Metabolism', description: 'Healthy meals give 50% more strength. Junk food hurts double.' },
    bestAt: 'Clean eating',
    watchOut: 'Junk food',
    stats: { metabolism: 90, toughness: 25, growth: 55 },
    rules: { ...BASE, gain: 1.5, junk: 2 },
  },
  {
    id: 'peasley',
    name: 'Peasley',
    kind: 'Pea-pod sprout',
    title: 'The Little Grower',
    description: 'Soaks up every vegetable and shoots up fast.',
    ability: { name: 'Green Thumb', description: 'Healthy meals earn 50% more XP.' },
    bestAt: 'Levelling up',
    watchOut: 'Average toughness',
    stats: { metabolism: 50, toughness: 50, growth: 90 },
    rules: { ...BASE, healthyXp: 1.5 },
  },
  {
    id: 'puddin',
    name: 'Puddin',
    kind: 'Caramel pudding',
    title: 'The Iron Tummy',
    description: 'Wobbly outside, unshakeable inside. Nothing it eats can upset it.',
    ability: { name: 'Iron Stomach', description: 'Junk food never lowers its strength.' },
    bestAt: 'Treat days',
    watchOut: 'Slow metabolism',
    stats: { metabolism: 35, toughness: 75, growth: 50 },
    rules: { ...BASE, gain: 0.8, junk: 0 },
  },
  {
    id: 'takko',
    name: 'Takko',
    kind: 'Takoyaki octopus',
    title: 'The Lucky One',
    description: 'Eight arms, one big appetite, and a little luck when it counts.',
    ability: { name: 'Last Stand', description: 'Survives its first day without food, once per life, at 10 strength.' },
    bestAt: 'Second chances',
    watchOut: 'The luck only works once',
    stats: { metabolism: 50, toughness: 65, growth: 50 },
    rules: { ...BASE },
  },
]

export function findSpecies(id: string): Species | undefined {
  return SPECIES.find((s) => s.id === id)
}

export const START_STRENGTH = 70
export const REVIVE_STRENGTH = 50
export const LAST_STAND_STRENGTH = 10
export const XP_PER_LEVEL = 300

const MISS_PENALTY: Record<MealSlot, number> = { BREAKFAST: 20, LUNCH: 12, DINNER: 12 }

/** Strength change for a fed meal; healthy ≥ 70, okay 40-69, junk < 40. */
export function mealStrengthDelta(score: number, slot: MealSlot, rules: SpeciesRules): number {
  if (score < 40) return -Math.round(8 * rules.junk)
  const base = score >= 70 ? 12 : 5
  const healthy = score >= 70 ? rules.gain : Math.min(rules.gain, 1)
  return Math.round(base * healthy * (slot === 'BREAKFAST' ? rules.breakfastGain : 1))
}

export function missPenalty(slot: MealSlot, rules: SpeciesRules): number {
  return Math.round(MISS_PENALTY[slot] * rules.miss * (slot === 'BREAKFAST' ? rules.missBreakfast : 1))
}

/** A weak pet grows slower: XP scales from 50% at 0 strength to 100% at full strength. */
export function mealXp(score: number, strength: number, rules: SpeciesRules): number {
  return Math.round(score * (score >= 70 ? rules.healthyXp : 1) * (0.5 + strength / 200))
}
