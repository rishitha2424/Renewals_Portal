import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface SnapshotItem {
  id: string
  label: string
  snapshot_date: string
  yesterday_date?: string | null
  row_count: number
  active_row_count?: number
  is_active_today: boolean
  uploaded_at?: string
  source_file_summary?: string | null
  source_file_comparison?: string | null
  last_week_source?: string | null
  last_week_is_partial?: boolean
}

export type ScopeType = 'renewals' | 'all' | 'fy2026' | 'fy2027' | 'q4_2026'

interface AppState {
  // Theme (persisted)
  darkMode: boolean
  toggleDarkMode: () => void

  // Sidebar collapsed state (persisted)
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void

  // Global Scope & Deleted/Lost filter (persisted)
  scope: ScopeType
  setScope: (scope: ScopeType) => void
  includeDeletedLost: boolean
  setIncludeDeletedLost: (val: boolean) => void

  // Metric Toggle Mode (persisted)
  metricMode: 'Amount' | 'Count' | 'Both'
  setMetricMode: (mode: 'Amount' | 'Count' | 'Both') => void

  // Active snapshot ("View as of")
  activeSnapshotId: string | null
  setActiveSnapshotId: (id: string | null) => void

  // Compare snapshot ("Compare with")
  compareSnapshotId: string | null
  setCompareSnapshotId: (id: string | null) => void

  // All available snapshots
  snapshots: SnapshotItem[]
  setSnapshots: (snapshots: SnapshotItem[]) => void

  // Command palette
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void

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

      scope: 'renewals',
      setScope: (scope) => set({ scope }),

      includeDeletedLost: true,
      setIncludeDeletedLost: (includeDeletedLost) => set({ includeDeletedLost }),

      metricMode: 'Amount',
      setMetricMode: (metricMode) => set({ metricMode }),

      activeSnapshotId: null,
      setActiveSnapshotId: (id) => set({ activeSnapshotId: id }),

      compareSnapshotId: null,
      setCompareSnapshotId: (id) => set({ compareSnapshotId: id }),

      snapshots: [],
      setSnapshots: (snapshots) => set({ snapshots }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

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
        scope: s.scope,
        includeDeletedLost: s.includeDeletedLost,
        metricMode: s.metricMode,
        activeSnapshotId: s.activeSnapshotId,
        compareSnapshotId: s.compareSnapshotId,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    }
  )
)
