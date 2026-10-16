import { BellRing, X } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { ButtonLink } from '@/components/button-link'
import { Button } from '@/components/ui/button'
import { useMealReminderSchedule, usePetStore, usePetSync, useReminders } from '@/lib/pets'
import { useWallet } from '@/lib/wallet'

/** Keeps the buddy in sync app-wide and shows meal reminders on any screen except BiteBuddy itself. */
export function MealReminders() {
  const address = useWallet((s) => s.address)
  const pet = usePetStore((s) => s.pet)
  const banner = useReminders((s) => s.banner)
  const dismiss = useReminders((s) => s.dismiss)
  const { pathname } = useLocation()
  const onBiteBuddy = pathname === '/bitebuddy'

  usePetSync(address)
  useMealReminderSchedule()

  // Once the meal is eaten, or the user is already on BiteBuddy, the nudge has done its job.
  useEffect(() => {
    if (banner && (onBiteBuddy || !pet?.current)) dismiss()
  }, [banner, onBiteBuddy, pet, dismiss])

  if (!banner || onBiteBuddy) return null

  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="flex items-start gap-3 rounded-2xl bg-card py-3 pr-1 pl-4 shadow-lg ring-1 ring-foreground/10">
        <BellRing className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{banner.title}</p>
          <p className="text-sm text-muted-foreground">{banner.body}</p>
          <ButtonLink to="/bitebuddy" size="lg" className="mt-2" onClick={dismiss}>
            Feed now
          </ButtonLink>
        </div>
        <Button variant="ghost" size="icon" className="size-11" aria-label="Dismiss reminder" onClick={dismiss}>
          <X />
        </Button>
      </div>
    </div>
  )
}
