<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()

onMounted(async () => {
  if (wallet.isReady) {
    await wallet.fetchAccounts()
    await wallet.fetchBalance()
  }
})

watch(() => wallet.isReady, async (ready) => {
  if (ready) {
    await wallet.fetchAccounts()
    await wallet.fetchBalance()
  }
})

function shortAddress(addr: string) {
  if (!addr) return ''
  return `${addr.slice(0, 9)}...${addr.slice(-4)}`
}

const features = [
  {
    title: 'Off-Ramp',
    desc: 'Convert NIM to Naira instantly',
    route: '/offramp',
    color: 'bg-blue-50 text-blue-600',
    icon: 'exchange',
  },
  {
    title: 'BiteBuddy',
    desc: 'Feed your pet with healthy meals',
    route: '/bitebuddy',
    color: 'bg-green-50 text-green-600',
    icon: 'pet',
  },
  {
    title: 'Gift Cards',
    desc: 'Create & share NIM gift cards',
    route: '/giftcards',
    color: 'bg-purple-50 text-purple-600',
    icon: 'gift',
  },
  {
    title: 'Voice Off-Ramp',
    desc: 'Off-ramp via voice command',
    route: '/voice',
    color: 'bg-orange-50 text-orange-600',
    icon: 'mic',
  },
]
</script>

<template>
  <div class="px-4 pt-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-xl font-bold text-primary">KhalkosPay</h1>
        <p class="text-xs text-text-secondary">Nimiq Mini App</p>
      </div>
      <div
        v-if="wallet.isReady && wallet.accounts.length"
        class="bg-surface-alt rounded-full px-3 py-1.5 text-xs font-mono text-text-secondary"
      >
        {{ shortAddress(wallet.accounts[0]) }}
      </div>
    </div>

    <!-- Balance Card -->
    <div class="bg-primary rounded-2xl p-5 mb-6 text-white">
      <p class="text-xs opacity-70 mb-1">NIM Balance</p>
      <div v-if="wallet.isConnecting" class="text-2xl font-bold">
        Connecting...
      </div>
      <div v-else-if="!wallet.isReady" class="text-sm opacity-80">
        Open inside Nimiq Pay to connect
      </div>
      <div v-else>
        <p class="text-3xl font-bold tracking-tight">
          {{ wallet.balance !== null ? wallet.balance.toLocaleString() : '...' }}
          <span class="text-base font-normal opacity-70">NIM</span>
        </p>
      </div>
      <p v-if="wallet.error" class="text-xs text-red-300 mt-2">{{ wallet.error }}</p>
    </div>

    <!-- Features Grid -->
    <h2 class="text-sm font-semibold text-text-secondary mb-3 uppercase tracking-wide">Features</h2>
    <div class="grid grid-cols-2 gap-3">
      <router-link
        v-for="f in features"
        :key="f.route"
        :to="f.route"
        class="rounded-2xl p-4 border border-border hover:border-primary/20 transition-all active:scale-[0.98] no-underline"
      >
        <div
          class="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
          :class="f.color"
        >
          <svg v-if="f.icon === 'exchange'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          <svg v-else-if="f.icon === 'pet'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="4" r="2" />
            <circle cx="18" cy="8" r="2" />
            <circle cx="20" cy="16" r="2" />
            <path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" />
          </svg>
          <svg v-else-if="f.icon === 'gift'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
          <svg v-else-if="f.icon === 'mic'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <h3 class="text-sm font-semibold text-text mb-1">{{ f.title }}</h3>
        <p class="text-[11px] text-text-secondary leading-tight">{{ f.desc }}</p>
      </router-link>
    </div>
  </div>
</template>
