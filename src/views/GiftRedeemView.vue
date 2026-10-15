<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const giftId = route.params.id as string

const step = ref<'loading' | 'enter_code' | 'claiming' | 'claimed' | 'error' | 'already_claimed'>('loading')
const redeemCodeInput = ref('')
const errorMsg = ref('')

const card = ref<{
  amount: number
  message: string
  template: string
  senderName?: string
} | null>(null)

const templates: Record<string, { emoji: string; bg: string }> = {
  default: { emoji: '🎁', bg: 'from-indigo-500 to-purple-600' },
  birthday: { emoji: '🎂', bg: 'from-pink-500 to-rose-600' },
  love: { emoji: '❤️', bg: 'from-red-500 to-pink-600' },
  thank_you: { emoji: '🙏', bg: 'from-amber-500 to-orange-600' },
  congrats: { emoji: '🎉', bg: 'from-green-500 to-emerald-600' },
  holiday: { emoji: '🎄', bg: 'from-red-600 to-green-600' },
}

onMounted(async () => {
  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/giftcards/${giftId}`)
    if (!res.ok) throw new Error('Gift card not found')
    const data = await res.json()

    if (data.claimed) {
      step.value = 'already_claimed'
      return
    }

    card.value = data
    step.value = 'enter_code'
  }
  catch {
    errorMsg.value = 'Gift card not found or expired'
    step.value = 'error'
  }
})

async function claimGift() {
  if (!redeemCodeInput.value) return
  step.value = 'claiming'

  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/giftcards/${giftId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redeemCode: redeemCodeInput.value }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Invalid redeem code')
    }

    step.value = 'claimed'
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    step.value = 'enter_code'
  }
}

function getTemplate() {
  return templates[card.value?.template || 'default'] || templates.default
}
</script>

<template>
  <div class="min-h-dvh flex flex-col items-center justify-center px-4 py-8">
    <!-- Loading -->
    <template v-if="step === 'loading'">
      <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </template>

    <!-- Enter Code -->
    <template v-if="step === 'enter_code' && card">
      <div
        class="w-full max-w-sm rounded-2xl p-6 text-white bg-gradient-to-br mb-6"
        :class="getTemplate().bg"
      >
        <div class="text-4xl mb-2">{{ getTemplate().emoji }}</div>
        <p class="text-xs opacity-80">KhalkosPay Gift Card</p>
        <p class="text-3xl font-bold mt-1">{{ card.amount }} NIM</p>
        <p v-if="card.message" class="text-sm mt-3 opacity-90 italic">"{{ card.message }}"</p>
        <p v-if="card.senderName" class="text-xs mt-2 opacity-70">From {{ card.senderName }}</p>
      </div>

      <div class="w-full max-w-sm space-y-4">
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Enter Redeem Code</label>
          <input
            v-model="redeemCodeInput"
            type="text"
            placeholder="Enter the secret code"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm text-center font-mono tracking-widest focus:outline-none focus:border-primary"
          />
        </div>
        <p v-if="errorMsg" class="text-xs text-error text-center">{{ errorMsg }}</p>
        <button
          :disabled="!redeemCodeInput"
          class="w-full h-12 rounded-xl bg-primary text-white font-semibold text-sm disabled:opacity-40 active:scale-[0.98]"
          @click="claimGift"
        >
          Claim Gift
        </button>
      </div>
    </template>

    <!-- Claiming -->
    <template v-if="step === 'claiming'">
      <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
      <p class="text-sm font-medium">Claiming your gift...</p>
    </template>

    <!-- Claimed -->
    <template v-if="step === 'claimed'">
      <div class="text-5xl mb-3">🎉</div>
      <h2 class="text-xl font-bold mb-1">Gift Claimed!</h2>
      <p class="text-sm text-text-secondary mb-2">{{ card?.amount }} NIM has been sent to your wallet</p>
      <p class="text-xs text-text-secondary">Open Nimiq Pay to see your balance</p>
    </template>

    <!-- Already Claimed -->
    <template v-if="step === 'already_claimed'">
      <div class="text-5xl mb-3">😅</div>
      <h2 class="text-lg font-bold mb-1">Already Claimed</h2>
      <p class="text-sm text-text-secondary">This gift card has already been redeemed</p>
    </template>

    <!-- Error -->
    <template v-if="step === 'error'">
      <div class="text-5xl mb-3">❌</div>
      <h2 class="text-lg font-bold mb-1">Not Found</h2>
      <p class="text-sm text-text-secondary">{{ errorMsg }}</p>
    </template>
  </div>
</template>
