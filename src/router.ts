import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/offramp',
      name: 'offramp',
      component: () => import('@/views/OfframpView.vue'),
    },
    {
      path: '/bitebuddy',
      name: 'bitebuddy',
      component: () => import('@/views/BiteBuddyView.vue'),
    },
    {
      path: '/giftcards',
      name: 'giftcards',
      component: () => import('@/views/GiftCardsView.vue'),
    },
    {
      path: '/giftcards/create',
      name: 'giftcards-create',
      component: () => import('@/views/GiftCardCreateView.vue'),
    },
    {
      path: '/gift/:id',
      name: 'gift-redeem',
      component: () => import('@/views/GiftRedeemView.vue'),
    },
    {
      path: '/voice',
      name: 'voice',
      component: () => import('@/views/VoiceOfframpView.vue'),
    },
  ],
})

export default router
