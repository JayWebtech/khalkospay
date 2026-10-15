<script setup lang="ts">
import { computed, ref } from 'vue'

interface MealLog {
  id: string
  type: 'breakfast' | 'lunch' | 'dinner'
  name: string
  score: number
  nutrients: { calories: number; protein: number; carbs: number; fat: number; fiber: number }
  timestamp: Date
}

const petName = ref('Nibbles')
const petHealth = ref(70)
const totalPoints = ref(0)
const mealLogs = ref<MealLog[]>([])
const isScanning = ref(false)
const scanResult = ref<MealLog | null>(null)
const imagePreview = ref<string | null>(null)
const selectedMealType = ref<'breakfast' | 'lunch' | 'dinner'>('breakfast')
const showCamera = ref(false)

const petMood = computed(() => {
  if (petHealth.value >= 80) return { emoji: '😸', label: 'Thriving!', color: 'text-success' }
  if (petHealth.value >= 60) return { emoji: '😺', label: 'Happy', color: 'text-green-500' }
  if (petHealth.value >= 40) return { emoji: '😿', label: 'Meh...', color: 'text-warning' }
  return { emoji: '🙀', label: 'Hungry!', color: 'text-error' }
})

const petSize = computed(() => {
  if (petHealth.value >= 80) return 'scale-110'
  if (petHealth.value >= 60) return 'scale-100'
  if (petHealth.value >= 40) return 'scale-90'
  return 'scale-75'
})

function openCamera() {
  showCamera.value = true
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return

  const file = input.files[0]
  const reader = new FileReader()
  reader.onload = () => {
    imagePreview.value = reader.result as string
    showCamera.value = false
    analyzeMeal(reader.result as string)
  }
  reader.readAsDataURL(file)
}

async function analyzeMeal(imageData: string) {
  isScanning.value = true
  scanResult.value = null

  try {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'
    const res = await fetch(`${API_BASE}/api/bitebuddy/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageData,
        mealType: selectedMealType.value,
      }),
    })

    if (!res.ok) throw new Error('Analysis failed')

    const data = await res.json()
    const meal: MealLog = {
      id: crypto.randomUUID?.() || Date.now().toString(),
      type: selectedMealType.value,
      name: data.name,
      score: data.score,
      nutrients: data.nutrients,
      timestamp: new Date(),
    }

    scanResult.value = meal
    mealLogs.value.unshift(meal)
    totalPoints.value += meal.score

    const healthDelta = meal.score >= 70 ? 5 : meal.score >= 40 ? 0 : -5
    petHealth.value = Math.max(0, Math.min(100, petHealth.value + healthDelta))
  }
  catch {
    scanResult.value = {
      id: Date.now().toString(),
      type: selectedMealType.value,
      name: 'Sample Meal (Demo)',
      score: 65,
      nutrients: { calories: 450, protein: 25, carbs: 55, fat: 15, fiber: 8 },
      timestamp: new Date(),
    }
    mealLogs.value.unshift(scanResult.value)
    totalPoints.value += 65
  }
  finally {
    isScanning.value = false
  }
}

function scoreColor(score: number) {
  if (score >= 70) return 'text-success'
  if (score >= 40) return 'text-warning'
  return 'text-error'
}

function mealIcon(type: string) {
  if (type === 'breakfast') return '🌅'
  if (type === 'lunch') return '☀️'
  return '🌙'
}
</script>

<template>
  <div class="px-4 pt-6">
    <div class="flex items-center gap-3 mb-6">
      <router-link to="/" class="w-8 h-8 flex items-center justify-center rounded-full bg-surface-alt">
        <svg class="w-4 h-4 text-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </router-link>
      <h1 class="text-lg font-bold text-text">BiteBuddy</h1>
    </div>

    <!-- Pet Card -->
    <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-5 mb-5 text-center">
      <div class="text-5xl mb-2 transition-transform duration-500" :class="petSize">
        {{ petMood.emoji }}
      </div>
      <h2 class="text-base font-bold">{{ petName }}</h2>
      <p class="text-xs mb-3" :class="petMood.color">{{ petMood.label }}</p>

      <!-- Health Bar -->
      <div class="bg-white/60 rounded-full h-3 mb-2 overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-700"
          :class="petHealth >= 60 ? 'bg-success' : petHealth >= 30 ? 'bg-warning' : 'bg-error'"
          :style="{ width: `${petHealth}%` }"
        />
      </div>
      <div class="flex justify-between text-[10px] text-text-secondary">
        <span>Health: {{ petHealth }}%</span>
        <span>Points: {{ totalPoints }}</span>
      </div>
    </div>

    <!-- Meal Type Selector -->
    <div class="flex gap-2 mb-4">
      <button
        v-for="mt in (['breakfast', 'lunch', 'dinner'] as const)"
        :key="mt"
        class="flex-1 h-10 rounded-xl text-xs font-medium capitalize transition-all active:scale-[0.97]"
        :class="selectedMealType === mt ? 'bg-primary text-white' : 'bg-surface-alt text-text-secondary'"
        @click="selectedMealType = mt"
      >
        {{ mealIcon(mt) }} {{ mt }}
      </button>
    </div>

    <!-- Scan Button -->
    <button
      class="w-full h-14 rounded-2xl bg-primary text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] mb-5"
      :disabled="isScanning"
      @click="openCamera"
    >
      <svg v-if="!isScanning" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <div v-else class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      {{ isScanning ? 'Analyzing meal...' : 'Scan Your Meal' }}
    </button>

    <!-- Camera Input (hidden file input) -->
    <input
      v-show="showCamera"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      ref="fileInput"
      @change="handleFileSelect"
    />
    <div v-if="showCamera" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" @click.self="showCamera = false">
      <div class="bg-white rounded-2xl p-5 w-full max-w-sm">
        <h3 class="text-base font-bold mb-3">Scan your {{ selectedMealType }}</h3>
        <div class="space-y-3">
          <label class="block w-full h-12 rounded-xl bg-primary text-white font-medium text-sm flex items-center justify-center cursor-pointer active:scale-[0.98]">
            <input type="file" accept="image/*" capture="environment" class="hidden" @change="handleFileSelect" />
            Take Photo
          </label>
          <label class="block w-full h-12 rounded-xl border border-border text-sm font-medium flex items-center justify-center cursor-pointer active:scale-[0.98]">
            <input type="file" accept="image/*" class="hidden" @change="handleFileSelect" />
            Choose from Gallery
          </label>
          <button class="w-full h-10 text-sm text-text-secondary" @click="showCamera = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Scan Result -->
    <div v-if="scanResult" class="bg-surface-alt rounded-2xl p-4 mb-5">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="text-sm font-bold">{{ scanResult.name }}</h3>
          <p class="text-xs text-text-secondary">{{ mealIcon(scanResult.type) }} {{ scanResult.type }}</p>
        </div>
        <div class="text-right">
          <span class="text-xl font-bold" :class="scoreColor(scanResult.score)">{{ scanResult.score }}</span>
          <p class="text-[10px] text-text-secondary">points</p>
        </div>
      </div>
      <div class="grid grid-cols-5 gap-2 text-center">
        <div v-for="(val, key) in scanResult.nutrients" :key="key">
          <p class="text-xs font-bold">{{ val }}{{ key === 'calories' ? '' : 'g' }}</p>
          <p class="text-[9px] text-text-secondary capitalize">{{ key }}</p>
        </div>
      </div>
    </div>

    <!-- Meal History -->
    <div v-if="mealLogs.length > 1">
      <h3 class="text-xs font-semibold text-text-secondary mb-2 uppercase tracking-wide">History</h3>
      <div class="space-y-2">
        <div
          v-for="log in mealLogs.slice(1, 6)"
          :key="log.id"
          class="flex items-center justify-between rounded-xl bg-surface-alt p-3"
        >
          <div class="flex items-center gap-2">
            <span class="text-base">{{ mealIcon(log.type) }}</span>
            <div>
              <p class="text-xs font-medium">{{ log.name }}</p>
              <p class="text-[10px] text-text-secondary">{{ log.nutrients.calories }} cal</p>
            </div>
          </div>
          <span class="text-sm font-bold" :class="scoreColor(log.score)">+{{ log.score }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
