<script setup lang="ts">
import { ref } from 'vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const isListening = ref(false)
const isProcessing = ref(false)
const messages = ref<Message[]>([
  { role: 'assistant', content: 'Hi! I can help you off-ramp your NIM to Naira. Just tell me the amount, your bank and account details, and I\'ll handle the rest. You can speak or type.' },
])
const textInput = ref('')
const chatContainer = ref<HTMLElement | null>(null)

function scrollToBottom() {
  setTimeout(() => {
    chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' })
  }, 50)
}

async function sendMessage(content: string) {
  if (!content.trim()) return

  messages.value.push({ role: 'user', content: content.trim() })
  textInput.value = ''
  isProcessing.value = true
  scrollToBottom()

  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/voice/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content.trim(),
        history: messages.value.slice(0, -1),
        walletAddress: wallet.accounts[0] || null,
      }),
    })

    if (!res.ok) throw new Error('Failed to process')

    const data = await res.json()
    messages.value.push({ role: 'assistant', content: data.reply })

    if (data.action === 'execute_offramp' && data.params) {
      messages.value.push({
        role: 'assistant',
        content: `Initiating off-ramp: ${data.params.amount} NIM → ${data.params.ngnAmount} NGN to ${data.params.bankName} ${data.params.accountNumber}. Please approve the transaction in Nimiq Pay.`,
      })

      try {
        const recipientAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'
        const hash = await wallet.sendNim(recipientAddress, data.params.amount)
        messages.value.push({
          role: 'assistant',
          content: `Transaction sent! Hash: ${hash}. Your ${data.params.ngnAmount} NGN will arrive shortly.`,
        })
      }
      catch (txErr) {
        messages.value.push({
          role: 'assistant',
          content: `Transaction failed: ${txErr instanceof Error ? txErr.message : String(txErr)}. Would you like to try again?`,
        })
      }
    }
  }
  catch {
    messages.value.push({
      role: 'assistant',
      content: 'Sorry, I had trouble processing that. Could you try again?',
    })
  }
  finally {
    isProcessing.value = false
    scrollToBottom()
  }
}

async function startListening() {
  isListening.value = true

  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream)
    const chunks: Blob[] = []

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: 'audio/webm' })

      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')

      try {
        const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) throw new Error('Transcription failed')
        const data = await res.json()
        if (data.transcript) {
          sendMessage(data.transcript)
        }
      }
      catch {
        messages.value.push({
          role: 'assistant',
          content: 'Could not transcribe audio. Try typing your request instead.',
        })
      }
    }

    mediaRecorder.start()
    setTimeout(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
        isListening.value = false
      }
    }, 10_000)

    const stopBtn = () => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop()
      }
      isListening.value = false
    }

    window.addEventListener('pointerup', stopBtn, { once: true })
  }
  catch {
    isListening.value = false
    messages.value.push({
      role: 'assistant',
      content: 'Microphone access is needed for voice commands. You can also type your request below.',
    })
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage(textInput.value)
  }
}
</script>

<template>
  <div class="flex flex-col h-[calc(100dvh-5rem)]">
    <!-- Header -->
    <div class="flex items-center gap-3 px-4 pt-6 pb-3">
      <router-link to="/" class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-alt">
        <svg class="w-4 h-4 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </router-link>
      <div>
        <h1 class="text-lg font-bold text-text">Voice Off-Ramp</h1>
        <p class="text-[10px] text-text-secondary">Speak or type to off-ramp NIM</p>
      </div>
    </div>

    <!-- Chat Messages -->
    <div ref="chatContainer" class="flex-1 overflow-y-auto px-4 space-y-3 pb-4">
      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="flex"
        :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm"
          :class="msg.role === 'user' ? 'bg-primary text-white rounded-br-md' : 'bg-surface-alt text-text rounded-bl-md'"
        >
          {{ msg.content }}
        </div>
      </div>
      <div v-if="isProcessing" class="flex justify-start">
        <div class="bg-surface-alt rounded-2xl rounded-bl-md px-4 py-3 flex gap-1">
          <div class="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" style="animation-delay: 0ms" />
          <div class="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" style="animation-delay: 150ms" />
          <div class="w-2 h-2 bg-text-secondary/40 rounded-full animate-bounce" style="animation-delay: 300ms" />
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="border-t border-border px-4 py-3 flex items-center gap-2">
      <button
        class="w-11 h-11 rounded-full flex items-center justify-center transition-colors active:scale-[0.95] flex-shrink-0"
        :class="isListening ? 'bg-error text-white animate-pulse' : 'bg-surface-alt text-text-secondary'"
        @pointerdown="startListening"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
      <input
        v-model="textInput"
        type="text"
        placeholder="Type a message..."
        class="flex-1 h-11 px-4 rounded-full border border-border text-sm focus:outline-none focus:border-primary"
        @keydown="handleKeydown"
      />
      <button
        :disabled="!textInput.trim()"
        class="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 active:scale-[0.95] flex-shrink-0"
        @click="sendMessage(textInput)"
      >
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
      </button>
    </div>
  </div>
</template>
