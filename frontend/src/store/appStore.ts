import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SnapshotItem {
  id: string
  label: string
  snapshot_date: string
  yesterday_date?: string | null
  period?: string
  row_count: number
  active_row_count?: number
  is_active_today: boolean
  uploaded_at?: string
  source_file_summary?: string | null
  source_file_comparison?: string | null
  last_week_source?: string | null
  last_week_is_partial?: boolean
}

export interface FilterSpec {
  as_of?: string | null
  compare?: string
  period: string
  sales_types: string[]
  regions: string[]
  business_units: string[]
  forecast_categories: string[]
  approval_statuses: string[]
  types?: string[]
  include_deleted_lost: boolean
}

export const DEFAULT_FILTER_SPEC: FilterSpec = {
  as_of: null,
  compare: 'yesterday',
  period: 'current_quarter',
  sales_types: ['Renewals'],
  regions: [],
  business_units: [],
  forecast_categories: [],
  approval_statuses: [],
  types: ['all'],
  include_deleted_lost: false,
}

interface AppState {
  // Theme (persisted)
  darkMode: boolean
  toggleDarkMode: () => void

  // Sidebar collapsed state (persisted)
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void

  // Global FilterSpec (replaces static scope)
  globalFilters: FilterSpec
  setGlobalFilters: (filters: Partial<FilterSpec>) => void
  resetGlobalFilters: () => void

  // Backwards compatibility helpers
  includeDeletedLost: boolean
  setIncludeDeletedLost: (val: boolean) => void

  // Metric Toggle Mode (persisted)
  metricMode: 'Amount' | 'Count' | 'Both'
  setMetricMode: (mode: 'Amount' | 'Count' | 'Both') => void

  // Active snapshot ("View as of")
  activeSnapshotId: string | null
  setActiveSnapshotId: (id: string | null) => void

  // Admin state stays in memory; restored from the server's HttpOnly cookie on load.
  isAdmin: boolean
  adminName: string | null
  adminToken: string | null
  securityWarnings: string[]
  setIsAdmin: (isAdmin: boolean, token?: string | null, name?: string | null, warnings?: string[]) => void

  // Compare snapshot ("Compare with")
  compareSnapshotId: string | null
  setCompareSnapshotId: (id: string | null) => void

  // All available snapshots
  snapshots: SnapshotItem[]
  setSnapshots: (snapshots: SnapshotItem[]) => void

  // Command palette
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void

  // Mobile Sidebar Drawer
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void

  // Opportunity drawer
  selectedOppId: string | null
  setSelectedOppId: (id: string | null) => void

  // Opportunity filters
  filters: {
    forecastCategory: string[]
    approvalStatus: string[]
    subRegion: string[]
    businessUnit: string[]
    search: string
  }
  setFilters: (filters: Partial<AppState['filters']>) => void
  clearFilters: () => void
}

const DEFAULT_FILTERS = {
  forecastCategory: [],
  approvalStatus: [],
  subRegion: [],
  businessUnit: [],
  search: '',
}

const SESSION_STORAGE_KEY = 'horizon_session_kam_filters'

export const getSessionFilters = () => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch (_) {}
  return null
}

export const saveSessionFilters = (data: Record<string, any>) => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const current = getSessionFilters() || {}
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...current, ...data }))
    }
  } catch (_) {}
}

export const clearSessionFilters = () => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch (_) {}
}

const getInitialFilterSpec = (): FilterSpec => {
  const session = getSessionFilters()
  if (session) {
    return {
      ...DEFAULT_FILTER_SPEC,
      period: session.period || DEFAULT_FILTER_SPEC.period,
      types: session.types || DEFAULT_FILTER_SPEC.types,
      as_of: session.as_of ?? session.activeSnapshotId ?? DEFAULT_FILTER_SPEC.as_of,
      compare: session.compare ?? session.compareSnapshotId ?? DEFAULT_FILTER_SPEC.compare,
    }
  }
  return DEFAULT_FILTER_SPEC
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      darkMode: false,
      toggleDarkMode: () =>
        set((s) => {
          const next = !s.darkMode
          document.documentElement.classList.toggle('dark', next)
          return { darkMode: next }
        }),

      sidebarCollapsed: false,
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      globalFilters: getInitialFilterSpec(),
      setGlobalFilters: (f) =>
        set((s) => {
          const next = { ...s.globalFilters, ...f, sales_types: ['Renewals'] }
          saveSessionFilters({
            period: next.period,
            types: next.types,
            as_of: next.as_of,
            compare: next.compare,
          })
          return {
            globalFilters: next,
            includeDeletedLost: f.include_deleted_lost !== undefined ? f.include_deleted_lost : s.includeDeletedLost,
          }
        }),
      resetGlobalFilters: () => {
        clearSessionFilters()
        set({ globalFilters: DEFAULT_FILTER_SPEC, includeDeletedLost: false, activeSnapshotId: null, compareSnapshotId: null })
      },

      includeDeletedLost: false,
      setIncludeDeletedLost: (includeDeletedLost) =>
        set((s) => ({
          includeDeletedLost,
          globalFilters: { ...s.globalFilters, include_deleted_lost: includeDeletedLost },
        })),

      metricMode: 'Amount',
      setMetricMode: (metricMode) => set({ metricMode }),

      activeSnapshotId: getSessionFilters()?.activeSnapshotId ?? null,
      setActiveSnapshotId: (id) =>
        set((s) => {
          saveSessionFilters({ activeSnapshotId: id, as_of: id })
          return {
            activeSnapshotId: id,
            globalFilters: { ...s.globalFilters, as_of: id },
          }
        }),

      isAdmin: false,
      adminName: null,
      adminToken: null,
      securityWarnings: [],
      setIsAdmin: (isAdmin, token = null, name = null, warnings = []) =>
        set({ isAdmin, adminToken: token, adminName: name, securityWarnings: warnings }),

      compareSnapshotId: getSessionFilters()?.compareSnapshotId ?? null,
      setCompareSnapshotId: (id) =>
        set((s) => {
          saveSessionFilters({ compareSnapshotId: id, compare: id })
          return {
            compareSnapshotId: id,
            globalFilters: { ...s.globalFilters, compare: id || 'yesterday' },
          }
        }),

      snapshots: [],
      setSnapshots: (snapshots) => set({ snapshots }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      mobileSidebarOpen: false,
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),

      selectedOppId: null,
      setSelectedOppId: (id) => set({ selectedOppId: id }),

      filters: DEFAULT_FILTERS,
      setFilters: (f) =>
        set((s) => ({ filters: { ...s.filters, ...f } })),
      clearFilters: () => set({ filters: DEFAULT_FILTERS }),
    }),
    {
      name: 'mobileum-app-v2',
      partialize: (s) => ({
        darkMode: s.darkMode,
        globalFilters: s.globalFilters,
        includeDeletedLost: s.includeDeletedLost,
        metricMode: s.metricMode,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
)
