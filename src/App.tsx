import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/bottom-nav'
import { flushPendingFunding } from '@/lib/gifts'
import { flushPendingDeposits } from '@/lib/offramp'
import { useWallet } from '@/lib/wallet'
import { BiteBuddyPage } from '@/pages/bitebuddy'
import { GiftRedeemPage } from '@/pages/gift-redeem'
import { GiftCardCreatePage } from '@/pages/giftcard-create'
import { GiftCardsPage } from '@/pages/giftcards'
import { HomePage } from '@/pages/home'
import { OfframpPage } from '@/pages/offramp'
import { OfframpOrderPage } from '@/pages/offramp-order'
import { VoiceOfframpPage } from '@/pages/voice-offramp'

export function App() {
  const detect = useWallet((s) => s.detect)
  const { pathname } = useLocation()
  const standalone = pathname.startsWith('/gift/')

  useEffect(() => {
    void detect()
    void flushPendingDeposits()
    void flushPendingFunding()
  }, [detect])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <main className={standalone ? 'flex flex-1 flex-col' : 'flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]'}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/cash-out" element={<OfframpPage />} />
          <Route path="/cash-out/:id" element={<OfframpOrderPage />} />
          <Route path="/call" element={<VoiceOfframpPage />} />
          <Route path="/bitebuddy" element={<BiteBuddyPage />} />
          <Route path="/gifts" element={<GiftCardsPage />} />
          <Route path="/gifts/new" element={<GiftCardCreatePage />} />
          <Route path="/gift/:id" element={<GiftRedeemPage />} />
          <Route path="/offramp" element={<Navigate to="/cash-out" replace />} />
          <Route path="/voice" element={<Navigate to="/call" replace />} />
          <Route path="/giftcards/*" element={<Navigate to="/gifts" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!standalone && <BottomNav />}
    </div>
  )
}
