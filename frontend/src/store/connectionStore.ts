import { create } from 'zustand'
import { POLL_CONFIG } from '@/config/polling'

interface ConnectionState {
  inFlightCount: number
  slowRequestIds: Record<string, boolean>
  slowActive: boolean
  retryingMessage: string | null
  beginRequest: (id: string) => void
  endRequest: (id: string, timedOutOrRetrying?: boolean) => void
  clearWatchdog: () => void
}

const requestTimers = new Map<string, ReturnType<typeof setTimeout>>()
let retryBannerTimer: ReturnType<typeof setTimeout> | null = null

export const useConnectionStore = create<ConnectionState>((set) => ({
  inFlightCount: 0,
  slowRequestIds: {},
  slowActive: false,
  retryingMessage: null,

  beginRequest: (id: string) => {
    if (typeof setTimeout !== 'undefined') {
      const existing = requestTimers.get(id)
      if (existing) clearTimeout(existing)
      const t = setTimeout(() => {
        requestTimers.delete(id)
        set((state) => {
          const nextSlow = { ...state.slowRequestIds, [id]: true }
          return {
            slowRequestIds: nextSlow,
            slowActive: true,
            retryingMessage: state.retryingMessage || 'Still loading from server...',
          }
        })
      }, POLL_CONFIG.SLOW_THRESHOLD_MS)
      requestTimers.set(id, t)
    }
    set((state) => ({ inFlightCount: state.inFlightCount + 1 }))
  },

  endRequest: (id: string, timedOutOrRetrying = false) => {
    const t = requestTimers.get(id)
    if (t) {
      clearTimeout(t)
      requestTimers.delete(id)
    }
    set((state) => {
      const nextSlow = { ...state.slowRequestIds }
      delete nextSlow[id]
      const stillSlow = Object.keys(nextSlow).length > 0
      const nextCount = Math.max(0, state.inFlightCount - 1)

      let nextMsg = state.retryingMessage
      if (timedOutOrRetrying) {
        nextMsg = 'Connection is slow, retrying...'
        if (retryBannerTimer) clearTimeout(retryBannerTimer)
        retryBannerTimer = setTimeout(() => {
          useConnectionStore.setState({ retryingMessage: null })
        }, 4500)
      } else if (!stillSlow && nextCount === 0) {
        nextMsg = null
      }

      return {
        inFlightCount: nextCount,
        slowRequestIds: nextSlow,
        slowActive: stillSlow || Boolean(timedOutOrRetrying),
        retryingMessage: nextMsg,
      }
    })
  },

  clearWatchdog: () => {
    requestTimers.forEach((t) => clearTimeout(t))
    requestTimers.clear()
    if (retryBannerTimer) {
      clearTimeout(retryBannerTimer)
      retryBannerTimer = null
    }
    set({ inFlightCount: 0, slowRequestIds: {}, slowActive: false, retryingMessage: null })
  },
}))

