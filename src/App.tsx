import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from '@/components/bottom-nav'
import { MealReminders } from '@/components/meal-reminders'
import { flushPendingFunding } from '@/lib/gifts'
import { flushPendingDeposits } from '@/lib/offramp'
import { flushPendingRevivals } from '@/lib/pets'
import { startBalanceRefresh, useWallet } from '@/lib/wallet'
import { BiteBuddyPage } from '@/pages/bitebuddy'
import { BuyPage } from '@/pages/buy'
import { BuyOrderPage } from '@/pages/buy-order'
import { GiftRedeemPage } from '@/pages/gift-redeem'
import { SentGiftPage } from '@/pages/gift-sent'
import { GiftCardCreatePage } from '@/pages/giftcard-create'
import { GiftCardsPage } from '@/pages/giftcards'
import { HomePage } from '@/pages/home'
import { OfframpPage } from '@/pages/offramp'
import { OfframpOrderPage } from '@/pages/offramp-order'
import { VoiceOfframpPage } from '@/pages/voice-offramp'

export function App() {
  const detect = useWallet((s) => s.detect)
  const { pathname } = useLocation()

  useEffect(() => startBalanceRefresh(), [])

  useEffect(() => {
    void detect()
    void flushPendingDeposits()
    void flushPendingFunding()
    void flushPendingRevivals()
  }, [detect])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <main className="flex flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/buy" element={<BuyPage />} />
          <Route path="/buy/:id" element={<BuyOrderPage />} />
          <Route path="/cash-out" element={<OfframpPage />} />
          <Route path="/cash-out/:id" element={<OfframpOrderPage />} />
          <Route path="/call" element={<VoiceOfframpPage />} />
          <Route path="/bitebuddy" element={<BiteBuddyPage />} />
          <Route path="/gifts" element={<GiftCardsPage />} />
          <Route path="/gifts/new" element={<GiftCardCreatePage />} />
          <Route path="/gifts/:id" element={<SentGiftPage />} />
          <Route path="/gift/:id" element={<GiftRedeemPage />} />
          <Route path="/offramp" element={<Navigate to="/cash-out" replace />} />
          <Route path="/voice" element={<Navigate to="/call" replace />} />
          <Route path="/giftcards/*" element={<Navigate to="/gifts" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <MealReminders />
    </div>
  )
}
