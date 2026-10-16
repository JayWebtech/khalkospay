import { MealSlot } from '@prisma/client'

/** Local wall-clock hours, [start, end). Outside all three the pet is asleep and can't eat. */
export const MEAL_WINDOWS: { slot: MealSlot; startHour: number; endHour: number }[] = [
  { slot: 'BREAKFAST', startHour: 5, endHour: 12 },
  { slot: 'LUNCH', startHour: 12, endHour: 17 },
  { slot: 'DINNER', startHour: 17, endHour: 23 },
]

export interface MealWindow {
  slot: MealSlot
  /** Local day in the pet's timezone, YYYY-MM-DD. */
  day: string
  start: Date
  end: Date
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string) {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(tz, f)
  }
  return f
}

/** Wall-clock fields of `date` in `tz`. */
export function localParts(date: Date, tz: string) {
  const parts = formatter(tz).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

function offsetMs(date: Date, tz: string) {
  const p = localParts(date, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** The instant when the wall clock in `tz` shows `day` at `hour`:00 (two passes settle DST shifts). */
export function zonedTime(day: string, hour: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, hour)
  let ts = wall - offsetMs(new Date(wall), tz)
  ts = wall - offsetMs(new Date(ts), tz)
  return new Date(ts)
}

export function localDay(date: Date, tz: string): string {
  const p = localParts(date, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function windowsForDay(day: string, tz: string): MealWindow[] {
  return MEAL_WINDOWS.map((w) => ({ slot: w.slot, day, start: zonedTime(day, w.startHour, tz), end: zonedTime(day, w.endHour, tz) }))
}

export function currentWindow(now: Date, tz: string): MealWindow | null {
  return windowsForDay(localDay(now, tz), tz).find((w) => w.start <= now && now < w.end) ?? null
}

export function nextWindow(now: Date, tz: string): MealWindow {
  const today = localDay(now, tz)
  return [...windowsForDay(today, tz), ...windowsForDay(addDays(today, 1), tz)].find((w) => w.start > now)!
}

/** Windows whose end falls in (from, to], oldest first. */
export function windowsClosedBetween(from: Date, to: Date, tz: string): MealWindow[] {
  const out: MealWindow[] = []
  const last = localDay(to, tz)
  for (let day = addDays(localDay(from, tz), -1); day <= last; day = addDays(day, 1)) {
    for (const w of windowsForDay(day, tz)) if (w.end > from && w.end <= to) out.push(w)
  }
  return out
}

export function formatLocalTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatLocalDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)))
}
