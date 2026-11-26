import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api, { authLogin, authLogout, getAuthMe } from '../api/client'

export type UserRole = 'admin' | 'management' | 'kam'

export interface UserProfile {
  id: string
  email: string
  name: string
  role: UserRole
  is_owner: boolean
  owner_name?: string
  aliases?: string[]
  timezone?: string
  must_change_password?: boolean
  last_login?: string
}

interface AuthState {
  currentUser: UserProfile | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitializing: boolean
  error: string | null
  checkAuth: () => Promise<UserProfile | null>
  login: (email: string, password: string, rememberMe?: boolean) => Promise<UserProfile>
  logout: () => Promise<void>
  setCurrentUser: (user: UserProfile | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      isAuthenticated: false,
      isLoading: false,
      isInitializing: true,
      error: null,

      checkAuth: async () => {
        try {
          set({ isLoading: true, error: null })
          const res = await getAuthMe()
          const user = res?.user || (res?.id ? res : null)
          if (user) {
            set({ currentUser: user, isAuthenticated: true, isLoading: false, isInitializing: false })
            return user
          }
          set({ currentUser: null, isAuthenticated: false, isLoading: false, isInitializing: false })
          return null
        } catch {
          // If check fails (e.g. 401), clear auth
          set({ currentUser: null, isAuthenticated: false, isLoading: false, isInitializing: false })
          return null
        }
      },

      login: async (email: string, password: string, rememberMe = true) => {
        set({ isLoading: true, error: null })
        try {
          const res = await authLogin(email, password, rememberMe)
          const user = res.user
          set({ currentUser: user, isAuthenticated: true, isLoading: false, isInitializing: false, error: null })
          // Ensure fresh login always defaults to latest snapshot and defaults
          try {
            const { useAppStore, clearSessionFilters } = await import('./appStore')
            clearSessionFilters()
            useAppStore.getState().resetGlobalFilters()
            useAppStore.getState().setActiveSnapshotId(null)
            useAppStore.getState().setCompareSnapshotId(null)
          } catch (_) {}
          return user
        } catch (err: any) {
          const msg = err?.response?.data?.detail || err?.message || 'Login failed'
          set({ error: msg, isLoading: false, isAuthenticated: false, currentUser: null, isInitializing: false })
          throw new Error(msg)
        }
      },

      logout: async () => {
        try {
          await authLogout()
        } catch {
          // Ignore network errors on logout
        } finally {
          set({ currentUser: null, isAuthenticated: false, error: null, isLoading: false, isInitializing: false })
          try {
            const { useAppStore, clearSessionFilters } = await import('./appStore')
            clearSessionFilters()
            useAppStore.getState().resetGlobalFilters()
            useAppStore.getState().setActiveSnapshotId(null)
            useAppStore.getState().setCompareSnapshotId(null)
          } catch (_) {}
          // If in browser, redirect to login
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
        }
      },

      setCurrentUser: (user) => set({ currentUser: user, isAuthenticated: !!user }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'horizon_auth_state',
      partialize: (state) => ({
        currentUser: state.currentUser,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

