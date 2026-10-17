import { LogOut } from 'lucide-react'
import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { adminLogout, useAdminSession } from '@/lib/admin'
import { AdminBiteBuddyPage } from '@/pages/admin/bitebuddy'
import { AdminBuysPage } from '@/pages/admin/buys'
import { AdminCashoutsPage } from '@/pages/admin/cashouts'
import { AdminGiftsPage } from '@/pages/admin/gifts'
import { AdminLedgerPage } from '@/pages/admin/ledger'
import { AdminLoginPage } from '@/pages/admin/login'
import { AdminOverviewPage } from '@/pages/admin/overview'

const sections = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/buys', label: 'Buy NIM' },
  { to: '/admin/cash-outs', label: 'Cash-outs' },
  { to: '/admin/gifts', label: 'Gifts' },
  { to: '/admin/bitebuddy', label: 'BiteBuddy' },
  { to: '/admin/ledger', label: 'Ledger' },
]

/** The operator dashboard at /admin. Lives outside the mini app's shell: no bottom nav, no wallet. */
export function AdminApp() {
  const session = useAdminSession((s) => s.session)

  useEffect(() => {
    const previous = document.title
    document.title = 'KhalkosPay admin'
    return () => {
      document.title = previous
    }
  }, [])

  if (!session) return <AdminLoginPage />

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 pt-3 sm:px-6">
          <BrandMark className="size-6" />
          <span className="font-heading text-[0.9375rem] font-semibold">KhalkosPay admin</span>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="truncate text-xs text-muted-foreground max-sm:hidden">{session.admin.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void adminLogout()}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
        <nav aria-label="Admin sections" className="mx-auto max-w-7xl overflow-x-auto px-2 sm:px-4">
          <ul className="flex gap-1">
            {sections.map(({ to, label, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className="relative flex h-10 items-center px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-2.5 aria-[current=page]:after:bottom-0 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-primary"
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Routes>
          <Route index element={<AdminOverviewPage />} />
          <Route path="buys" element={<AdminBuysPage />} />
          <Route path="cash-outs" element={<AdminCashoutsPage />} />
          <Route path="gifts" element={<AdminGiftsPage />} />
          <Route path="bitebuddy/*" element={<AdminBiteBuddyPage />} />
          <Route path="ledger" element={<AdminLedgerPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  )
}
