<script setup lang="ts">
import { ref } from 'vue'

interface GiftCard {
  id: string
  amount: number
  message: string
  template: string
  redeemCode: string
  claimed: boolean
  createdAt: Date
}

const giftCards = ref<GiftCard[]>([])
const loading = ref(false)

function templateEmoji(t: string) {
  const map: Record<string, string> = {
    birthday: '🎂', love: '❤️', thank_you: '🙏', holiday: '🎄', congrats: '🎉', default: '🎁',
  }
  return map[t] || map.default
}

function copyLink(card: GiftCard) {
  const baseUrl = window.location.origin
  const url = `${baseUrl}/gift/${card.id}`
  navigator.clipboard?.writeText(url)
}
</script>

<template>
  <div class="px-4 pt-6">
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <router-link to="/" class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-alt">
          <svg class="w-4 h-4 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </router-link>
        <h1 class="text-lg font-bold text-text">Gift Cards</h1>
      </div>
      <router-link
        to="/giftcards/create"
        class="h-9 px-4 rounded-xl bg-primary text-white text-xs font-semibold flex items-center gap-1 active:scale-[0.98] no-underline"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        Create
      </router-link>
    </div>

    <!-- Empty State -->
    <div v-if="!giftCards.length && !loading" class="flex flex-col items-center justify-center py-16">
      <div class="text-5xl mb-3">🎁</div>
      <h2 class="text-base font-bold mb-1">No Gift Cards Yet</h2>
      <p class="text-xs text-text-secondary mb-5 text-center px-8">
        Create NIM gift cards and share them with your loved ones
      </p>
      <router-link
        to="/giftcards/create"
        class="h-12 px-6 rounded-xl bg-primary text-white font-semibold text-sm flex items-center gap-2 active:scale-[0.98] no-underline"
      >
        Create Gift Card
      </router-link>
    </div>

    <!-- Gift Cards List -->
    <div v-else class="space-y-3">
      <div
        v-for="card in giftCards"
        :key="card.id"
        class="rounded-2xl border border-border p-4"
      >
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="text-2xl">{{ templateEmoji(card.template) }}</span>
            <div>
              <p class="text-sm font-bold">{{ card.amount }} NIM</p>
              <p class="text-[10px] text-text-secondary">{{ card.createdAt.toLocaleDateString() }}</p>
            </div>
          </div>
          <span
            class="text-[10px] font-medium px-2 py-0.5 rounded-full"
            :class="card.claimed ? 'bg-green-100 text-success' : 'bg-amber-100 text-warning'"
          >
            {{ card.claimed ? 'Claimed' : 'Pending' }}
          </span>
        </div>
        <p v-if="card.message" class="text-xs text-text-secondary mb-3 italic">"{{ card.message }}"</p>
        <div class="flex gap-2">
          <button
            class="flex-1 h-9 rounded-lg border border-border text-xs font-medium active:scale-[0.98]"
            @click="copyLink(card)"
          >
            Copy Link
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
