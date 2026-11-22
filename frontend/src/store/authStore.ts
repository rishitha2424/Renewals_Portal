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
  must_change_password?: boolean
  last_login?: string
}

interface AuthState {
  currentUser: UserProfile | null
  isAuthenticated: boolean
  isLoading: boolean
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
      error: null,

      checkAuth: async () => {
        try {
          set({ isLoading: true, error: null })
          const res = await getAuthMe()
          const user = res?.user || (res?.id ? res : null)
          if (user) {
            set({ currentUser: user, isAuthenticated: true, isLoading: false })
            return user
          }
          set({ currentUser: null, isAuthenticated: false, isLoading: false })
          return null
        } catch {
          // If check fails (e.g. 401), clear auth
          set({ currentUser: null, isAuthenticated: false, isLoading: false })
          return null
        }
      },

      login: async (email: string, password: string, rememberMe = true) => {
        set({ isLoading: true, error: null })
        try {
          const res = await authLogin(email, password, rememberMe)
          const user = res.user
          set({ currentUser: user, isAuthenticated: true, isLoading: false, error: null })
          return user
        } catch (err: any) {
          const msg = err?.response?.data?.detail || err?.message || 'Login failed'
          set({ error: msg, isLoading: false, isAuthenticated: false, currentUser: null })
          throw new Error(msg)
        }
      },

      logout: async () => {
        try {
          await authLogout()
        } catch {
          // Ignore network errors on logout
        } finally {
          set({ currentUser: null, isAuthenticated: false, error: null, isLoading: false })
          // If in browser, redirect to login
          if (typeof window !== 'undefined') {
            window.location.href = '/login'
          }
        }
      },

      setCurrentUser: (user) => set({ currentUser: user, isAuthenticated: !!user }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'horizon_auth_state',
      partialize: (state) => ({ currentUser: state.currentUser, isAuthenticated: state.isAuthenticated }),
    }
  )
)

