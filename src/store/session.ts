import { create } from 'zustand'
import type { CheckInMode } from '@shared/checkin'

const KEY = 'gs-checkin-mode'

function load(): CheckInMode {
  try {
    return localStorage.getItem(KEY) === 'offline' ? 'offline' : 'online'
  } catch {
    return 'online'
  }
}

interface SessionState {
  mode: CheckInMode
  setMode: (m: CheckInMode) => void
}

export const useSession = create<SessionState>((set) => ({
  mode: load(),
  setMode: (mode) => {
    try {
      localStorage.setItem(KEY, mode)
    } catch {
      /* ignore */
    }
    set({ mode })
  }
}))
