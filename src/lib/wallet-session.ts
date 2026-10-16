import { create } from 'zustand'
import { api, ApiError } from './api'
import { useWallet } from './wallet'

const SESSION_KEY = 'khalkospay.walletSession'

export interface Session {
  address: string
  token: string
  expiresAt: string
}

function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null
    return s && new Date(s.expiresAt).getTime() > Date.now() + 60_000 ? s : null
  } catch {
    return null
  }
}

function writeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Without storage the user simply signs again next time.
  }
}

const sameAddress = (a: string, b: string) => a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase()

interface SessionStore {
  session: Session | null
  signingIn: boolean
  /** Signs a one-time challenge in Nimiq Pay. Must run from a tap: the wallet asks the user to confirm. */
  signIn: () => Promise<Session>
  signOut: () => void
}

export const useWalletSession = create<SessionStore>((set, get) => ({
  session: readSession(),
  signingIn: false,

  signIn: async () => {
    const { address, sign } = useWallet.getState()
    if (!address) throw new Error('Connect your wallet first')
    const existing = get().session
    if (existing && sameAddress(existing.address, address) && new Date(existing.expiresAt).getTime() > Date.now() + 60_000) return existing
    set({ signingIn: true })
    try {
      const challenge = await api<{ challengeId: string; message: string }>('/api/auth/challenge', { json: {} })
      const signed = await sign(challenge.message)
      const session = await api<Session>('/api/auth/verify', { json: { challengeId: challenge.challengeId, ...signed } })
      writeSession(session)
      set({ session })
      // Nimiq Pay signs with its active account. If that isn't the one shown here, follow it so balances,
      // payments and this session all refer to the same wallet.
      if (!sameAddress(session.address, address)) useWallet.getState().chooseAccount(session.address)
      return session
    } finally {
      set({ signingIn: false })
    }
  },

  signOut: () => {
    writeSession(null)
    set({ session: null })
  },
}))

/** The session for the connected wallet, if it has signed in. */
export function useSessionFor(address: string | null) {
  const session = useWalletSession((s) => s.session)
  return session && address && sameAddress(session.address, address) && new Date(session.expiresAt).getTime() > Date.now() ? session : null
}

/** Calls an endpoint that needs a signed-in wallet; an expired session is dropped so the UI asks again. */
export async function authedApi<T>(session: Session, path: string, init: { method?: string; json?: unknown } = {}) {
  try {
    return await api<T>(path, { ...init, headers: { Authorization: `Bearer ${session.token}` } })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) useWalletSession.getState().signOut()
    throw e
  }
}
