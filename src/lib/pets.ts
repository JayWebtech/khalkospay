import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api, ApiError, type MealSlot, type Pet, type PetConfig, type PetRevival } from './api'

export const SLOT_LABEL: Record<MealSlot, string> = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', DINNER: 'Dinner' }

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong'
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

let configPromise: Promise<PetConfig> | null = null

export function usePetConfig() {
  const [state, setState] = useState<{ data: PetConfig | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let alive = true
    configPromise ??= api<PetConfig>('/api/bitebuddy/config')
    configPromise.then(
      (data) => alive && setState({ data, error: null }),
      (e) => {
        configPromise = null
        if (alive) setState({ data: null, error: messageOf(e) })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

type PetState = 'idle' | 'loading' | 'ready' | 'none' | 'error'

interface PetStore {
  address: string | null
  pet: Pet | null
  state: PetState
  error: string | null
  load: (address: string | null) => Promise<void>
  set: (pet: Pet) => void
}

/** One copy of the pet for the whole app, so the BiteBuddy page and meal reminders never disagree. */
export const usePetStore = create<PetStore>((set, get) => ({
  address: null,
  pet: null,
  state: 'idle',
  error: null,

  load: async (address) => {
    if (!address) {
      set({ address: null, pet: null, state: 'idle', error: null })
      return
    }
    if (get().address !== address) set({ address, pet: null, state: 'loading', error: null })
    try {
      const pet = await api<Pet>(`/api/bitebuddy/pet?address=${encodeURIComponent(address)}`)
      if (get().address === address) set({ pet, state: 'ready', error: null })
    } catch (e) {
      if (get().address !== address) return
      if (e instanceof ApiError && e.status === 404) set({ pet: null, state: 'none', error: null })
      else set((s) => ({ state: s.pet ? 'ready' : 'error', error: messageOf(e) }))
    }
  },

  set: (pet) => set({ pet, state: 'ready', error: null }),
}))

/** Keeps the store fresh: on wallet change, every minute, when the app comes back, and right as a meal window opens or closes. */
export function usePetSync(address: string | null) {
  const load = usePetStore((s) => s.load)
  const pet = usePetStore((s) => s.pet)

  useEffect(() => {
    void load(address)
    if (!address) return
    const refresh = () => document.visibilityState === 'visible' && void load(address)
    const timer = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [address, load])

  const boundary = pet ? (pet.current?.closesAt ?? pet.next.opensAt) : null
  useEffect(() => {
    if (!address || !boundary) return
    const ms = new Date(boundary).getTime() - Date.now() + 1_500
    if (ms > 2 ** 31 - 1) return
    const timer = setTimeout(() => void load(address), Math.max(1_000, ms))
    return () => clearTimeout(timer)
  }, [address, boundary, load])
}

export function adoptPet(input: { address: string; species: string; name: string }) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return api<Pet>('/api/bitebuddy/pet', { json: { ...input, timezone } })
}

export function changeBuddy(input: { address: string; species: string; name: string }) {
  return api<Pet>('/api/bitebuddy/pet', { method: 'PATCH', json: input })
}

/** Phone photos can be several MB; the meal check only needs a modest JPEG. */
export function shrinkPhoto(file: File, maxSide = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("That photo couldn't be opened. Try another one."))
    }
    img.src = url
  })
}

export function feedPet(address: string, image: string) {
  return api<{ pet: Pet; mealId: string }>('/api/bitebuddy/pet/feed', { json: { address, image } })
}

export function startRevival(address: string) {
  return api<PetRevival>('/api/bitebuddy/pet/revive', { json: { address } })
}

export function getRevival(id: string) {
  return api<PetRevival>(`/api/bitebuddy/revivals/${id}`)
}

const PENDING_KEY = 'khalkospay.pendingRevivePayments'

function readPending(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}')
  } catch {
    return {}
  }
}

function writePending(pending: Record<string, string>) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // The server also scans the deposit address, so a lost record is recoverable.
  }
}

/** Records the wallet's tx locally first so a dropped connection can be retried on next launch. */
export async function reportRevivalPayment(revivalId: string, tx: string): Promise<PetRevival> {
  writePending({ ...readPending(), [revivalId]: tx })
  const revival = await api<PetRevival>(`/api/bitebuddy/revivals/${revivalId}/payment`, { json: { tx } })
  const { [revivalId]: _, ...rest } = readPending()
  writePending(rest)
  return revival
}

export async function flushPendingRevivals() {
  for (const [revivalId, tx] of Object.entries(readPending())) {
    try {
      await reportRevivalPayment(revivalId, tx)
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        const { [revivalId]: _, ...rest } = readPending()
        writePending(rest)
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Meal reminders. Nimiq Pay's mini-app SDK has no push API, so reminders fire while KhalkosPay is
// open: as a system notification where the host allows them, and always as an in-app banner.

const REMINDERS_KEY = 'khalkospay.mealReminders'
const REMINDED_KEY = 'khalkospay.mealReminded'

export type ReminderDelivery = 'system' | 'in-app'

function readFlag(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeFlag(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Reminders just stay off without storage.
  }
}

export function systemNotificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function reminderDelivery(): ReminderDelivery {
  return systemNotificationsSupported() && Notification.permission === 'granted' ? 'system' : 'in-app'
}

interface ReminderStore {
  enabled: boolean
  delivery: ReminderDelivery
  banner: { key: string; title: string; body: string } | null
  enable: () => Promise<ReminderDelivery>
  disable: () => void
  show: (key: string, title: string, body: string) => void
  dismiss: () => void
}

export const useReminders = create<ReminderStore>((set) => ({
  enabled: readFlag(REMINDERS_KEY) === 'on',
  delivery: reminderDelivery(),
  banner: null,

  // Must run from a tap: browsers only show the permission prompt for a user gesture.
  enable: async () => {
    writeFlag(REMINDERS_KEY, 'on')
    if (systemNotificationsSupported() && Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        // Some webviews expose Notification but reject the request; in-app reminders still work.
      }
    }
    const delivery = reminderDelivery()
    set({ enabled: true, delivery })
    return delivery
  },

  disable: () => {
    writeFlag(REMINDERS_KEY, null)
    set({ enabled: false, banner: null })
  },

  show: (key, title, body) => {
    if (readFlag(REMINDED_KEY) === key) return
    writeFlag(REMINDED_KEY, key)
    let sent = false
    if (reminderDelivery() === 'system') {
      try {
        new Notification(title, { body, icon: '/favicon.svg', tag: 'khalkospay-meal' })
        sent = true
      } catch {
        // Android Chrome only allows notifications from a service worker; fall back to the banner.
      }
    }
    set({ banner: { key, title, body }, delivery: sent ? 'system' : 'in-app' })
  },

  dismiss: () => set({ banner: null }),
}))

/** Reminds once when a meal is open and unfed, and gives a last call an hour before it closes. */
export function useMealReminderSchedule() {
  const pet = usePetStore((s) => s.pet)
  const enabled = useReminders((s) => s.enabled)
  const show = useReminders((s) => s.show)

  useEffect(() => {
    if (!enabled || !pet || pet.status !== 'ALIVE') return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (iso: string, fn: () => void) => {
      const ms = new Date(iso).getTime() - Date.now()
      if (ms <= 0) fn()
      else if (ms < 2 ** 31 - 1) timers.push(setTimeout(fn, ms))
    }

    // Keys use the window's start time, so a reminder fired by a timer isn't repeated after a refresh.
    if (pet.current) {
      const { slot, closesAt } = pet.current
      const opened = pet.today.windows.find((w) => w.slot === slot)?.start ?? closesAt
      const meal = SLOT_LABEL[slot].toLowerCase()
      const lastCall = new Date(new Date(closesAt).getTime() - 60 * 60_000).toISOString()
      if (Date.now() < new Date(lastCall).getTime()) {
        show(`${opened}:open`, `${SLOT_LABEL[slot]} time for ${pet.name}`, `Scan your ${meal} before ${formatClock(closesAt)} to keep ${pet.name} strong.`)
      }
      at(lastCall, () =>
        show(
          `${opened}:last`,
          `Last call for ${meal}`,
          `${pet.name} hasn't eaten. ${SLOT_LABEL[slot]} closes at ${formatClock(closesAt)}.`,
        ),
      )
    }
    // When nothing is open, usePetSync reloads the pet the moment the next meal opens, which lands in the branch above.
    return () => timers.forEach(clearTimeout)
  }, [enabled, pet, show])
}
