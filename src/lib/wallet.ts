import { getHostNetwork, init, NimiqProviderError } from '@nimiq/mini-app-sdk'
import { create } from 'zustand'

type Provider = Awaited<ReturnType<typeof init>>

export type WalletStatus = 'detecting' | 'unavailable' | 'disconnected' | 'connecting' | 'connected'

/** The account Nimiq Pay signed with when the user connected, which is the one it pays from. */
const SIGNER_KEY = 'khalkospay.signer'
/** Before connecting meant signing, the app kept an account picked from a list; it may not be the one Nimiq Pay pays from. */
const LEGACY_KEYS = ['khalkospay.address', 'khalkospay.accounts']

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

export function sameAddress(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase())
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
  /** The one account the app uses: the one Nimiq Pay signed with when the user connected, so the one it pays from. */
  address: string | null
  balanceLuna: number | null
  /** True while Nimiq Pay is still syncing, so a balance would be stale or missing. */
  syncing: boolean
  network: 'mainnet' | 'testnet'
  error: string | null
  detect: () => Promise<void>
  /** Takes the account a signature came from as the wallet's account. Connecting itself lives in wallet-session. */
  setSigner: (address: string) => void
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
  syncing: false,
  network: 'mainnet',
  error: null,

  detect: async () => {
    for (const key of LEGACY_KEYS) write(key, null)
    try {
      const provider = await init({ timeout: 8_000 })
      const address = read(SIGNER_KEY)
      set({ provider, network: getHostNetwork() ?? 'mainnet', address, status: address ? 'connected' : 'disconnected' })
      if (address) void get().refreshBalance()
    } catch {
      set({ status: 'unavailable' })
    }
  },

  setSigner: (address) => {
    const changed = !sameAddress(address, get().address)
    write(SIGNER_KEY, address)
    set({ address, status: 'connected', error: null, network: getHostNetwork() ?? get().network, ...(changed ? { balanceLuna: null } : {}) })
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
    write(SIGNER_KEY, null)
    set({ address: null, balanceLuna: null, syncing: false, error: null, status: get().provider ? 'disconnected' : 'unavailable' })
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
