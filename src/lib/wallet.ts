import { getHostNetwork, init, NimiqProviderError } from '@nimiq/mini-app-sdk'
import { create } from 'zustand'

type Provider = Awaited<ReturnType<typeof init>>

export type WalletStatus = 'detecting' | 'unavailable' | 'disconnected' | 'connecting' | 'connected'

const ADDRESS_KEY = 'khalkospay.address'

function readStoredAddress() {
  try {
    return localStorage.getItem(ADDRESS_KEY)
  } catch {
    return null
  }
}

function storeAddress(address: string | null) {
  try {
    if (address) localStorage.setItem(ADDRESS_KEY, address)
    else localStorage.removeItem(ADDRESS_KEY)
  } catch {
    // Storage can be unavailable in private mode; the session still works.
  }
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export function isUserRejection(e: unknown) {
  if (NimiqProviderError.is(e)) return e.type === 'PERMISSION_DENIED' || e.type === 'USER_REJECTED' || e.code === 4001
  return /reject|denied|cancel/i.test(errorMessage(e))
}

interface WalletState {
  status: WalletStatus
  provider: Provider | null
  address: string | null
  balanceLuna: number | null
  network: 'mainnet' | 'testnet'
  error: string | null
  detect: () => Promise<void>
  connect: () => Promise<void>
  refreshBalance: () => Promise<void>
  pay: (payment: { recipient: string; valueLuna: number; data: string }) => Promise<string>
  sign: (message: string) => Promise<{ publicKey: string; signature: string }>
  disconnect: () => void
}

export const useWallet = create<WalletState>((set, get) => ({
  status: 'detecting',
  provider: null,
  address: null,
  balanceLuna: null,
  network: 'mainnet',
  error: null,

  detect: async () => {
    try {
      const provider = await init({ timeout: 8_000 })
      const address = readStoredAddress()
      set({ provider, network: getHostNetwork() ?? 'mainnet', address, status: address ? 'connected' : 'disconnected' })
      if (address) void get().refreshBalance()
    } catch {
      set({ status: 'unavailable' })
    }
  },

  connect: async () => {
    const { provider } = get()
    if (!provider) return
    set({ status: 'connecting', error: null })
    try {
      const [address] = await provider.listAccounts()
      if (!address) throw new Error('No Nimiq account found in this wallet')
      storeAddress(address)
      set({ address, status: 'connected' })
      void get().refreshBalance()
    } catch (e) {
      set({ status: 'disconnected', error: isUserRejection(e) ? null : errorMessage(e) })
    }
  },

  refreshBalance: async () => {
    const { provider, address } = get()
    if (!provider || !address || typeof provider.getBalance !== 'function') return
    try {
      set({ balanceLuna: await provider.getBalance(address) })
    } catch {
      // Keep showing the last known balance; a transient lookup failure shouldn't blank it.
    }
  },

  pay: async ({ recipient, valueLuna, data }) => {
    const { provider } = get()
    if (!provider) throw new Error('Open KhalkosPay inside Nimiq Pay to pay')
    const tx = await provider.sendBasicTransactionWithData({ recipient, value: valueLuna, data })
    setTimeout(() => void get().refreshBalance(), 4_000)
    return tx
  },

  sign: async (message) => {
    const { provider } = get()
    if (!provider) throw new Error('Open KhalkosPay inside Nimiq Pay to sign in')
    return provider.sign(message)
  },

  disconnect: () => {
    storeAddress(null)
    set({ address: null, balanceLuna: null, status: get().provider ? 'disconnected' : 'unavailable' })
  },
}))
