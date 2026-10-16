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
    if (existing && new Date(existing.expiresAt).getTime() > Date.now() + 60_000) return existing
    set({ signingIn: true })
    try {
      const challenge = await api<{ challengeId: string; message: string }>('/api/auth/challenge', { json: {} })
      const signed = await sign(challenge.message)
      const session = await api<Session>('/api/auth/verify', { json: { challengeId: challenge.challengeId, ...signed } })
      writeSession(session)
      set({ session })
      // Nimiq Pay may sign with a different account than the one shown here (often the first one). The
      // session belongs to that signer; the account the user picked for balances and payments stays as it is.
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

/** The signed-in session, whichever account signed it, while it's still valid. */
export function useSession() {
  const session = useWalletSession((s) => s.session)
  return session && new Date(session.expiresAt).getTime() > Date.now() ? session : null
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
