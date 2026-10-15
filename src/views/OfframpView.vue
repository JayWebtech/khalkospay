<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()

const amount = ref('')
const bankName = ref('')
const accountNumber = ref('')
const accountName = ref('')
const step = ref<'form' | 'confirm' | 'processing' | 'success' | 'error'>('form')
const txHash = ref('')
const errorMsg = ref('')

const NIM_TO_NGN_RATE = 2.5

const nairaAmount = computed(() => {
  const nim = parseFloat(amount.value)
  if (isNaN(nim) || nim <= 0) return 0
  return nim * NIM_TO_NGN_RATE
})

const banks = [
  'Access Bank', 'First Bank', 'GTBank', 'UBA', 'Zenith Bank',
  'Kuda', 'Opay', 'Palmpay', 'Moniepoint', 'Wema Bank',
  'Stanbic IBTC', 'Sterling Bank', 'Fidelity Bank', 'FCMB', 'Union Bank',
]

function canProceed() {
  return parseFloat(amount.value) > 0 && bankName.value && accountNumber.value.length === 10 && accountName.value
}

function goToConfirm() {
  if (!canProceed()) return
  step.value = 'confirm'
}

async function executeOfframp() {
  step.value = 'processing'
  try {
    const recipientAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
    const hash = await wallet.sendNim(
      recipientAddress,
      parseFloat(amount.value),
      `OFFRAMP:${accountNumber.value}`,
    )
    txHash.value = hash

    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/offramp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txHash: hash,
        nimAmount: parseFloat(amount.value),
        ngnAmount: nairaAmount.value,
        bankCode: bankName.value,
        accountNumber: accountNumber.value,
        accountName: accountName.value,
        senderAddress: wallet.accounts[0],
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.message || 'Off-ramp failed')
    }

    step.value = 'success'
  }
  catch (e) {
    errorMsg.value = e instanceof Error ? e.message : String(e)
    step.value = 'error'
  }
}

function reset() {
  step.value = 'form'
  amount.value = ''
  bankName.value = ''
  accountNumber.value = ''
  accountName.value = ''
  txHash.value = ''
  errorMsg.value = ''
}
</script>

<template>
  <div class="px-4 pt-6">
    <div class="flex items-center gap-3 mb-6">
      <router-link to="/" class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-alt">
        <svg class="w-4 h-4 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </router-link>
      <h1 class="text-lg font-bold text-text">Off-Ramp</h1>
    </div>

    <!-- Form Step -->
    <template v-if="step === 'form'">
      <div class="bg-blue-50 rounded-2xl p-4 mb-5">
        <p class="text-xs text-blue-600 font-medium mb-1">Exchange Rate</p>
        <p class="text-lg font-bold text-blue-900">1 NIM = {{ NIM_TO_NGN_RATE }} NGN</p>
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Amount (NIM)</label>
          <input
            v-model="amount"
            type="number"
            inputmode="decimal"
            placeholder="Enter NIM amount"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
          <p v-if="nairaAmount > 0" class="text-xs text-text-secondary mt-1">
            You receive: <span class="font-semibold text-success">{{ nairaAmount.toLocaleString() }} NGN</span>
          </p>
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Bank</label>
          <select
            v-model="bankName"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary bg-white"
          >
            <option value="">Select bank</option>
            <option v-for="b in banks" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Account Number</label>
          <input
            v-model="accountNumber"
            type="text"
            inputmode="numeric"
            maxlength="10"
            placeholder="10-digit account number"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Account Name</label>
          <input
            v-model="accountName"
            type="text"
            placeholder="Account holder name"
            class="w-full h-12 px-4 rounded-xl border border-border text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <button
          :disabled="!canProceed()"
          class="w-full h-12 rounded-xl bg-primary text-white font-semibold text-sm disabled:opacity-40 transition-opacity active:scale-[0.98]"
          @click="goToConfirm"
        >
          Continue
        </button>
      </div>
    </template>

    <!-- Confirm Step -->
    <template v-if="step === 'confirm'">
      <div class="bg-surface-alt rounded-2xl p-5 space-y-3 mb-5">
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Send</span>
          <span class="font-semibold">{{ parseFloat(amount).toLocaleString() }} NIM</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Receive</span>
          <span class="font-semibold text-success">{{ nairaAmount.toLocaleString() }} NGN</span>
        </div>
        <hr class="border-border" />
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Bank</span>
          <span class="font-medium">{{ bankName }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Account</span>
          <span class="font-medium">{{ accountNumber }}</span>
        </div>
        <div class="flex justify-between text-sm">
          <span class="text-text-secondary">Name</span>
          <span class="font-medium">{{ accountName }}</span>
        </div>
      </div>

      <div class="flex gap-3">
        <button
          class="flex-1 h-12 rounded-xl border border-border text-sm font-medium active:scale-[0.98]"
          @click="step = 'form'"
        >
          Back
        </button>
        <button
          class="flex-1 h-12 rounded-xl bg-primary text-white font-semibold text-sm active:scale-[0.98]"
          @click="executeOfframp"
        >
          Confirm & Send
        </button>
      </div>
    </template>

    <!-- Processing -->
    <template v-if="step === 'processing'">
      <div class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
        <p class="text-sm font-medium text-text">Processing off-ramp...</p>
        <p class="text-xs text-text-secondary mt-1">Please approve the transaction in Nimiq Pay</p>
      </div>
    </template>

    <!-- Success -->
    <template v-if="step === 'success'">
      <div class="flex flex-col items-center justify-center py-12">
        <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <h2 class="text-lg font-bold mb-1">Off-ramp Successful!</h2>
        <p class="text-sm text-text-secondary mb-2">{{ nairaAmount.toLocaleString() }} NGN is on its way to your account</p>
        <p class="text-xs text-text-secondary font-mono break-all px-4">Tx: {{ txHash }}</p>
        <button
          class="mt-6 h-12 px-8 rounded-xl bg-primary text-white font-semibold text-sm active:scale-[0.98]"
          @click="reset"
        >
          Done
        </button>
      </div>
    </template>

    <!-- Error -->
    <template v-if="step === 'error'">
      <div class="flex flex-col items-center justify-center py-12">
        <div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
        <h2 class="text-lg font-bold mb-1">Off-ramp Failed</h2>
        <p class="text-sm text-text-secondary mb-4">{{ errorMsg }}</p>
        <button
          class="h-12 px-8 rounded-xl bg-primary text-white font-semibold text-sm active:scale-[0.98]"
          @click="step = 'form'"
        >
          Try Again
        </button>
      </div>
    </template>
  </div>
</template>
