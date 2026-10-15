<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'

const router = useRouter()
const wallet = useWalletStore()

const amount = ref('')
const message = ref('')
const redeemCode = ref('')
const recipientEmail = ref('')
const anonymous = ref(false)
const selectedTemplate = ref('default')
const step = ref<'form' | 'preview' | 'processing' | 'done'>('form')
const createdCardId = ref('')
const createdCardLink = ref('')
const errorMsg = ref('')

const templates = [
  { id: 'default', emoji: '🎁', label: 'Gift', bg: 'from-indigo-500 to-purple-600' },
  { id: 'birthday', emoji: '🎂', label: 'Birthday', bg: 'from-pink-500 to-rose-600' },
  { id: 'love', emoji: '❤️', label: 'Love', bg: 'from-red-500 to-pink-600' },
  { id: 'thank_you', emoji: '🙏', label: 'Thanks', bg: 'from-amber-500 to-orange-600' },
  { id: 'congrats', emoji: '🎉', label: 'Congrats', bg: 'from-green-500 to-emerald-600' },
  { id: 'holiday', emoji: '🎄', label: 'Holiday', bg: 'from-red-600 to-green-600' },
]

const currentTemplate = () => templates.find(t => t.id === selectedTemplate.value) || templates[0]

function canProceed() {
  return parseFloat(amount.value) > 0 && redeemCode.value.length >= 4
}

async function createGiftCard() {
  if (!canProceed()) return
  step.value = 'processing'
  errorMsg.value = ''

  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/giftcards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(amount.value),
        message: message.value,
        redeemCode: redeemCode.value,
        template: selectedTemplate.value,
        recipientEmail: recipientEmail.value || undefined,
        anonymous: anonymous.value,
        senderAddress: wallet.accounts[0] || undefined,
      }),
    })

    if (!res.ok) throw new Error('Failed to create gift card')

    const data = await res.json()
    createdCardId.value = data.id
    createdCardLink.value = `${window.location.origin}/gift/${data.id}`
    step.value = 'done'
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    step.value = 'form'
  }
}

function copyLink() {
  navigator.clipboard?.writeText(createdCardLink.value)
}
</script>

<template>
  <div class="px-4 pt-6">
    <div class="flex items-center gap-3 mb-6">
      <button class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-alt" @click="router.back()">
        <svg class="w-4 h-4 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-lg font-bold text-text">Create Gift Card</h1>
    </div>

    <template v-if="step === 'form' || step === 'preview'">
      <!-- Preview Card -->
      <div
        class="rounded-2xl p-5 mb-5 text-white bg-gradient-to-br"
        :class="currentTemplate().bg"
      >
        <div class="text-3xl mb-2">{{ currentTemplate().emoji }}</div>
        <p class="text-xs opacity-80">KhalkosPay Gift Card</p>
        <p class="text-2xl font-bold mt-1">{{ amount || '0' }} NIM</p>
        <p v-if="message" class="text-xs mt-2 opacity-90 italic">"{{ message }}"</p>
      </div>

      <!-- Template Selector -->
      <div class="mb-4">
        <label class="block text-xs font-medium text-text-secondary mb-2">Template</label>
        <div class="flex gap-2 overflow-x-auto pb-2">
          <button
            v-for="t in templates"
            :key="t.id"
            class="flex-shrink-0 w-16 h-16 rounded-xl flex flex-col items-center justify-center gap-1 transition-all active:scale-[0.95]"
            :class="selectedTemplate === t.id ? 'ring-2 ring-primary bg-surface-alt' : 'bg-surface-alt'"
            @click="selectedTemplate = t.id"
          >
            <span class="text-xl">{{ t.emoji }}</span>
            <span class="text-[9px]">{{ t.label }}</span>
          </button>
        </div>
      </div>

      <!-- Form Fields -->
      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Amount (NIM)</label>
          <input
            v-model="amount"
            type="number"
            inputmode="decimal"
            placeholder="Enter amount"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Redeem Code (min 4 chars)</label>
          <input
            v-model="redeemCode"
            type="text"
            placeholder="Enter a secret code"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Message (optional)</label>
          <textarea
            v-model="message"
            placeholder="Add a personal message..."
            rows="2"
            class="w-full px-4 py-3 rounded-xl border border-border text-sm focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Send via Email (optional)</label>
          <input
            v-model="recipientEmail"
            type="email"
            placeholder="recipient@email.com"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <label class="flex items-center gap-3 cursor-pointer">
          <div
            class="w-10 h-6 rounded-full transition-colors flex items-center px-0.5"
            :class="anonymous ? 'bg-primary' : 'bg-gray-200'"
          >
            <div
              class="w-5 h-5 bg-white rounded-full shadow transition-transform"
              :class="anonymous ? 'translate-x-4' : ''"
            />
          </div>
          <span class="text-sm">Send anonymously</span>
        </label>

        <p v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</p>

        <button
          :disabled="!canProceed()"
          class="w-full h-12 rounded-xl bg-primary text-white font-semibold text-sm disabled:opacity-40 active:scale-[0.98]"
          @click="createGiftCard"
        >
          Create Gift Card
        </button>
      </div>
    </template>

    <!-- Processing -->
    <template v-if="step === 'processing'">
      <div class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
        <p class="text-sm font-medium">Creating gift card...</p>
      </div>
    </template>

    <!-- Done -->
    <template v-if="step === 'done'">
      <div class="flex flex-col items-center justify-center py-10">
        <div class="text-5xl mb-3">🎁</div>
        <h2 class="text-lg font-bold mb-1">Gift Card Created!</h2>
        <p class="text-xs text-text-secondary mb-5 text-center">Share the link with your loved one</p>

        <div class="w-full bg-surface-alt rounded-xl p-3 mb-4">
          <p class="text-xs font-mono break-all text-text-secondary">{{ createdCardLink }}</p>
        </div>

        <div class="flex gap-3 w-full">
          <button
            class="flex-1 h-12 rounded-xl bg-primary text-white font-semibold text-sm active:scale-[0.98]"
            @click="copyLink"
          >
            Copy Link
          </button>
          <router-link
            to="/giftcards"
            class="flex-1 h-12 rounded-xl border border-border font-medium text-sm flex items-center justify-center active:scale-[0.98] no-underline text-text"
          >
            Done
          </router-link>
        </div>
      </div>
    </template>
  </div>
</template>
