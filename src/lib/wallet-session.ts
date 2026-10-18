import { create } from 'zustand'
import { api, ApiError } from './api'
import { errorMessage, isUserRejection, sameAddress, useWallet } from './wallet'

const SESSION_KEY = 'khalkospay.walletSession'

export interface Session {
  address: string
  token: string
  expiresAt: string
}

const live = (s: Session | null): s is Session => s !== null && new Date(s.expiresAt).getTime() > Date.now() + 60_000

function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null
    return live(s) ? s : null
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


/**
 * Has Nimiq Pay sign a one-time challenge. The signature names the account Nimiq Pay signs and pays from, which becomes
 * the app's only account, and signs it in whenever the server can check the signature.
 */
async function signChallenge(): Promise<{ address: string; session: Session | null; error: ApiError | null }> {
  const challenge = await api<{ challengeId: string; message: string }>('/api/auth/challenge', { json: {} })
  const signed = await useWallet.getState().sign(challenge.message)
  try {
    const session = await api<Session>('/api/auth/verify', { json: { challengeId: challenge.challengeId, ...signed } })
    return { address: session.address, session, error: null }
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) throw e
    // Still the account Nimiq Pay signed with, even if this server can't check the signature: connect it, just without a sign-in.
    const { address } = await api<{ address: string }>('/api/auth/address', { json: { publicKey: signed.publicKey } })
    return { address, session: null, error: e }
  }
}

interface SessionStore {
  session: Session | null
  signingIn: boolean
  /** Connects the wallet, or reconnects after the user switched accounts in Nimiq Pay: one signature. Must run from a tap. */
  connect: () => Promise<void>
  /** A valid sign-in for the wallet's account, signing a fresh challenge when there isn't one. Must run from a tap. */
  signIn: () => Promise<Session>
  signOut: () => void
  /** Forgets the account and its sign-in. */
  disconnect: () => void
}

export const useWalletSession = create<SessionStore>((set, get) => {
  /** Signs, takes the signer as the wallet's account, and keeps its sign-in (dropping one for another account). */
  async function signAndConnect() {
    set({ signingIn: true })
    try {
      const result = await signChallenge()
      writeSession(result.session)
      set({ session: result.session })
      useWallet.getState().setSigner(result.address)
      return result
    } finally {
      set({ signingIn: false })
    }
  }

  return {
    session: readSession(),
    signingIn: false,

    connect: async () => {
      const wallet = useWallet.getState()
      if (!wallet.provider) return
      // Reconnecting keeps the current account on screen until Nimiq Pay answers.
      useWallet.setState({ status: wallet.status === 'connected' ? 'connected' : 'connecting', error: null })
      try {
        await signAndConnect()
      } catch (e) {
        useWallet.setState({ status: useWallet.getState().address ? 'connected' : 'disconnected', error: isUserRejection(e) ? null : errorMessage(e) })
      }
    },

    signIn: async () => {
      const existing = get().session
      if (live(existing) && sameAddress(existing.address, useWallet.getState().address)) return existing
      const { session, error } = await signAndConnect()
      if (!session) throw error ?? new Error("Your wallet's signature couldn't be checked")
      return session
    },

    signOut: () => {
      writeSession(null)
      set({ session: null })
    },

    disconnect: () => {
      get().signOut()
      useWallet.getState().disconnect()
    },
  }
})

/** The signed-in session for the wallet's account, while it's still valid. */
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
