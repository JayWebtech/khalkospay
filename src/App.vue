<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import BottomNav from '@/components/BottomNav.vue'
import { useWalletStore } from '@/stores/wallet'

const wallet = useWalletStore()
const route = useRoute()

onMounted(() => {
  wallet.connect()
})

function showNav() {
  return !route.path.startsWith('/gift/')
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-surface">
    <main class="flex-1 pb-20">
      <router-view />
    </main>
    <BottomNav v-if="showNav()" />
  </div>
</template>
