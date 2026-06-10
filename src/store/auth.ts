import { create } from 'zustand'
import type { User } from '@shared/types'
import { api } from '@/lib/api'

interface AuthState {
  user: User | null
  ready: boolean
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  init: async () => {
    try {
      const user = await api.auth.current()
      set({ user, ready: true })
    } catch {
      // Never hang on the splash screen if the session check fails.
      set({ user: null, ready: true })
    }
  },
  login: async (username, password) => {
    const res = await api.auth.login(username, password)
    if (res.ok && res.user) set({ user: res.user })
    return { ok: res.ok, error: res.error }
  },
  logout: async () => {
    await api.auth.logout()
    set({ user: null })
  }
}))
