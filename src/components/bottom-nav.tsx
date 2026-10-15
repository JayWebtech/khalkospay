import { ArrowUpRight, Gift, House, Phone, Salad } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/cash-out', label: 'Cash out', icon: ArrowUpRight },
  { to: '/call', label: 'Call', icon: Phone, raised: true },
  { to: '/bitebuddy', label: 'BiteBuddy', icon: Salad },
  { to: '/gifts', label: 'Gifts', icon: Gift },
]

export function BottomNav() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-safe backdrop-blur-lg">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
        {tabs.map(({ to, label, icon: Icon, end, raised }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className="group relative flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors duration-150 aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
            >
              {raised ? (
                <span className="-mt-6 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_-4px_var(--color-primary)] ring-4 ring-background">
                  <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
                </span>
              ) : (
                <>
                  <span className="absolute top-0 h-0.5 w-6 rounded-full bg-primary opacity-0 group-aria-[current=page]:opacity-100" />
                  <Icon className="size-[1.375rem] stroke-[1.75] group-aria-[current=page]:stroke-[2.25]" aria-hidden="true" />
                </>
              )}
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
