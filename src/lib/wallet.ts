import { getHostNetwork, init, NimiqProviderError } from '@nimiq/mini-app-sdk'
import { create } from 'zustand'

type Provider = Awaited<ReturnType<typeof init>>

export type WalletStatus = 'detecting' | 'unavailable' | 'disconnected' | 'connecting' | 'connected'

const ADDRESS_KEY = 'khalkospay.address'
const ACCOUNTS_KEY = 'khalkospay.accounts'

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in private mode; the session still works.
  }
}

function readStoredAccounts(): string[] {
  try {
    const parsed = JSON.parse(read(ACCOUNTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : []
  } catch {
    return []
  }
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase())
}

/** Every address in the lists, first sighting wins, without duplicates. */
function mergeAccounts(...lists: string[][]) {
  const merged: string[] = []
  for (const a of lists.flat()) if (a && !merged.some((m) => sameAddress(m, a))) merged.push(a)
  return merged
}

/** Clears the provider's cached account list, so the next listAccounts asks Nimiq Pay again instead of repeating it. */
function forgetSharedAccounts(provider: Provider | null) {
  try {
    if (typeof provider?.disconnect === 'function') provider.disconnect()
  } catch {
    // Older hosts without a cache have nothing to clear.
  }
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

export function isUserRejection(e: unknown) {
  if (NimiqProviderError.is(e)) return e.type === 'PERMISSION_DENIED' || e.type === 'USER_REJECTED' || e.code === 4001
  return /reject|denied|cancel/i.test(errorMessage(e))
}

/** Reads a balance without any prompt; null when the wallet can't answer yet (no consensus, timeout, old host). */
export async function balanceOf(provider: Provider | null, address: string): Promise<number | null> {
  if (!provider || typeof provider.getBalance !== 'function') return null
  try {
    const luna = await provider.getBalance(address)
    return typeof luna === 'number' && Number.isFinite(luna) ? luna : null
  } catch {
    return null
  }
}

async function hasConsensus(provider: Provider) {
  if (typeof provider.isConsensusEstablished !== 'function') return true
  try {
    return await provider.isConsensusEstablished()
  } catch {
    return true
  }
}

let retryTimer: ReturnType<typeof setTimeout> | undefined

interface WalletState {
  status: WalletStatus
  provider: Provider | null
  address: string | null
  /** Every account Nimiq Pay has shared on this device, newest share first. Kept until the user disconnects. */
  accounts: string[]
  balanceLuna: number | null
  /** True while Nimiq Pay is still syncing, so a balance would be stale or missing. */
  syncing: boolean
  network: 'mainnet' | 'testnet'
  error: string | null
  detect: () => Promise<void>
  connect: () => Promise<void>
  chooseAccount: (address: string) => void
  refreshBalance: () => Promise<void>
  pay: (payment: { recipient: string; valueLuna: number; data: string }) => Promise<string>
  sign: (message: string) => Promise<{ publicKey: string; signature: string }>
  disconnect: () => void
}

export const useWallet = create<WalletState>((set, get) => ({
  status: 'detecting',
  provider: null,
  address: null,
  accounts: [],
  balanceLuna: null,
  syncing: false,
  network: 'mainnet',
  error: null,

  detect: async () => {
    try {
      const provider = await init({ timeout: 8_000 })
      const address = read(ADDRESS_KEY)
      set({
        provider,
        network: getHostNetwork() ?? 'mainnet',
        address,
        accounts: readStoredAccounts(),
        status: address ? 'connected' : 'disconnected',
      })
      if (address) void get().refreshBalance()
    } catch {
      set({ status: 'unavailable' })
    }
  },

  // listAccounts asks the user to confirm, so this only ever runs from a tap.
  connect: async () => {
    const { provider } = get()
    if (!provider) return
    // Re-listing from a connected wallet (switching accounts) keeps the current one on screen meanwhile.
    set({ status: get().status === 'connected' ? 'connected' : 'connecting', error: null })
    // The provider repeats its first answer until cleared, which would never let the user share another account.
    forgetSharedAccounts(provider)
    try {
      const shared = (await provider.listAccounts()).filter(Boolean)
      if (shared.length === 0) throw new Error('No Nimiq account found in this wallet')
      // Nimiq Pay shares only the accounts picked this time; keep the ones shared before, so one holding NIM never drops off.
      const accounts = mergeAccounts(shared, get().accounts, readStoredAccounts())
      const previous = get().address ?? read(ADDRESS_KEY)
      let address = accounts.find((a) => sameAddress(a, previous)) ?? shared[0]
      // With several accounts and no earlier choice, start on the first one that actually holds NIM.
      if (accounts.length > 1 && !accounts.some((a) => sameAddress(a, previous))) {
        const balances = await Promise.all(accounts.map((a) => balanceOf(provider, a)))
        const funded = balances.findIndex((b) => b !== null && b > 0)
        if (funded >= 0) address = accounts[funded]
      }
      write(ACCOUNTS_KEY, JSON.stringify(accounts))
      write(ADDRESS_KEY, address)
      set({ address, accounts, status: 'connected', network: getHostNetwork() ?? get().network, balanceLuna: null })
      void get().refreshBalance()
    } catch (e) {
      set({ status: get().address ? 'connected' : 'disconnected', error: isUserRejection(e) ? null : errorMessage(e) })
    }
  },

  chooseAccount: (address) => {
    if (sameAddress(address, get().address)) return
    // An account learned from a signature may not be in the last listAccounts result; remember it too.
    const accounts = get().accounts.some((a) => sameAddress(a, address)) ? get().accounts : [...get().accounts, address]
    write(ACCOUNTS_KEY, JSON.stringify(accounts))
    write(ADDRESS_KEY, address)
    set({ address, accounts, balanceLuna: null })
    void get().refreshBalance()
  },

  refreshBalance: async () => {
    const { provider, address } = get()
    clearTimeout(retryTimer)
    if (!provider || !address || typeof provider.getBalance !== 'function') return
    const retry = (ms: number) => {
      retryTimer = setTimeout(() => void get().refreshBalance(), ms)
    }
    // Before consensus Nimiq Pay can't know the balance; say so instead of showing a misleading number.
    if (!(await hasConsensus(provider))) {
      set({ syncing: true })
      retry(3_000)
      return
    }
    const luna = await balanceOf(provider, address)
    if (!sameAddress(get().address, address)) return
    if (luna === null) {
      retry(10_000)
      return
    }
    set({ balanceLuna: luna, syncing: false, network: getHostNetwork() ?? get().network })
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
    clearTimeout(retryTimer)
    forgetSharedAccounts(get().provider)
    write(ADDRESS_KEY, null)
    write(ACCOUNTS_KEY, null)
    set({ address: null, accounts: [], balanceLuna: null, syncing: false, status: get().provider ? 'disconnected' : 'unavailable' })
  },
}))

/** Keeps the balance current while the app is open: every 30 seconds and whenever it comes back to the foreground. */
export function startBalanceRefresh() {
  const refresh = () => document.visibilityState === 'visible' && void useWallet.getState().refreshBalance()
  const timer = setInterval(refresh, 30_000)
  document.addEventListener('visibilitychange', refresh)
  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
  }
}
