import { init } from '@nimiq/mini-app-sdk'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useWalletStore = defineStore('wallet', () => {
  const nimiqProvider = ref<Awaited<ReturnType<typeof init>> | null>(null)
  const isConnecting = ref(true)
  const isReady = ref(false)
  const accounts = ref<string[]>([])
  const balance = ref<number | null>(null)
  const error = ref<string | null>(null)

  async function connect() {
    try {
      isConnecting.value = true
      error.value = null
      const nimiq = await init({ timeout: 10_000 })
      nimiqProvider.value = nimiq
      isReady.value = true
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
    finally {
      isConnecting.value = false
    }
  }

  async function fetchAccounts() {
    if (!nimiqProvider.value) return
    try {
      accounts.value = await nimiqProvider.value.listAccounts()
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function fetchBalance() {
    if (!nimiqProvider.value || !accounts.value.length) return
    try {
      if (typeof nimiqProvider.value.getBalance === 'function') {
        const luna = await nimiqProvider.value.getBalance(accounts.value[0])
        balance.value = luna / 100_000
      }
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function sendNim(recipient: string, amountNim: number, data?: string) {
    if (!nimiqProvider.value) throw new Error('Wallet not connected')
    const valueLuna = Math.round(amountNim * 100_000)
    if (data) {
      return nimiqProvider.value.sendBasicTransactionWithData({
        recipient,
        value: valueLuna,
        data,
      })
    }
    return nimiqProvider.value.sendBasicTransaction({
      recipient,
      value: valueLuna,
    })
  }

  async function signMessage(message: string) {
    if (!nimiqProvider.value) throw new Error('Wallet not connected')
    return nimiqProvider.value.sign(message)
  }

  return {
    nimiqProvider,
    isConnecting,
    isReady,
    accounts,
    balance,
    error,
    connect,
    fetchAccounts,
    fetchBalance,
    sendNim,
    signMessage,
  }
})
