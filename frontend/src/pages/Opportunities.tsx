import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  X,
  Filter,
  Download,
  SlidersHorizontal,
  Bookmark,
  Plus,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Check,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { getOpportunities, getFilterOptions, exportOpportunitiesUrl } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { formatACV, formatDate, formatCount } from '@/utils/format'
import { ForecastBadge, ApprovalBadge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'

const ALL_COLUMNS = [
  { id: 'opportunity_id_18', label: 'ID', default: true },
  { id: 'opportunity_name', label: 'Opportunity Name', default: true },
  { id: 'account_name', label: 'Account', default: true },
  { id: 'sub_region', label: 'Region', default: true },
  { id: 'business_unit', label: 'Business Unit', default: true },
  { id: 'forecast_category', label: 'Forecast', default: true },
  { id: 'forecast_acv_amount', label: 'ACV', default: true },
  { id: 'approval_status', label: 'Approval', default: true },
  { id: 'service_expiry_period', label: 'Expiry', default: true },
  { id: 'close_date', label: 'Close Date', default: false },
  { id: 'probability_pct', label: 'Prob %', default: false },
  { id: 'opportunity_owner', label: 'Owner', default: false },
]

interface SavedView {
  id: string
  name: string
  filters: {
    forecastCategory: string[]
    approvalStatus: string[]
    subRegion: string[]
    businessUnit: string[]
    serviceExpiryPeriod: string[]
    minAcv?: number
    maxAcv?: number
    search?: string
  }
}

const DEFAULT_VIEWS: SavedView[] = [
  {
    id: 'all',
    name: 'All Deals',
    filters: {
      forecastCategory: [],
      approvalStatus: [],
      subRegion: [],
      businessUnit: [],
      serviceExpiryPeriod: [],
    },
  },
  {
    id: 'commit_deals',
    name: 'Commit Deals',
    filters: {
      forecastCategory: ['Commit'],
      approvalStatus: [],
      subRegion: [],
      businessUnit: [],
      serviceExpiryPeriod: [],
    },
  },
  {
    id: 'high_value',
    name: 'High Value (>$1M)',
    filters: {
      forecastCategory: [],
      approvalStatus: [],
      subRegion: [],
      businessUnit: [],
      serviceExpiryPeriod: [],
      minAcv: 1000000,
    },
  },
  {
    id: 'pending_approval',
    name: 'Pending Approvals',
    filters: {
      forecastCategory: [],
      approvalStatus: ['Pending Approval', 'Pending-Approval'],
      subRegion: [],
      businessUnit: [],
      serviceExpiryPeriod: [],
    },
  },
]

export default function Opportunities() {
  const activeSnapshotId = useAppStore((s) => s.activeSnapshotId)
  const setSelectedOppId = useAppStore((s) => s.setSelectedOppId)
  const { filters, setFilters, clearFilters } = useAppStore()

  // Local filter states for advanced fields
  const [expiryPeriod, setExpiryPeriod] = useState<string[]>([])
  const [minAcv, setMinAcv] = useState<string>('')
  const [maxAcv, setMaxAcv] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState(filters.search || '')

  // Sorting and pagination
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortBy, setSortBy] = useState<string>('acv')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // UI state
  const [showFilters, setShowFilters] = useState(true)
  const [showColChooser, setShowColChooser] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [showSaveViewModal, setShowSaveViewModal] = useState(false)

  // Visible columns persistence
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('mobileum_explore_columns')
      if (saved) return JSON.parse(saved)
    } catch (_) {}
    return ALL_COLUMNS.filter((c) => c.default).map((c) => c.id)
  })

  // Saved views persistence
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try {
      const saved = localStorage.getItem('mobileum_saved_views')
      if (saved) {
        const parsed = JSON.parse(saved)
        return [...DEFAULT_VIEWS, ...parsed]
      }
    } catch (_) {}
    return DEFAULT_VIEWS
  })
  const [activeViewId, setActiveViewId] = useState<string>('all')

  const toggleColumn = (colId: string) => {
    setVisibleCols((prev) => {
      const next = prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
      localStorage.setItem('mobileum_explore_columns', JSON.stringify(next))
      return next
    })
  }

  // Fetch filter options
  const { data: filterOpts } = useQuery({
    queryKey: ['filter-options', activeSnapshotId],
    queryFn: () => getFilterOptions(activeSnapshotId ?? undefined),
  })

  // Synchronize search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery !== filters.search) {
        setFilters({ search: searchQuery })
        setPage(1)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [searchQuery, filters.search, setFilters])

  // Parse numerical min/max ACV
  const parsedMinAcv = minAcv ? parseFloat(minAcv) : undefined
  const parsedMaxAcv = maxAcv ? parseFloat(maxAcv) : undefined

  // Fetch opportunities
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'opportunities',
      activeSnapshotId,
      filters.forecastCategory,
      filters.approvalStatus,
      filters.subRegion,
      filters.businessUnit,
      expiryPeriod,
      parsedMinAcv,
      parsedMaxAcv,
      filters.search,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
    queryFn: () =>
      getOpportunities({
        snapshotId: activeSnapshotId ?? undefined,
        forecastCategory: filters.forecastCategory.length ? filters.forecastCategory : undefined,
        approvalStatus: filters.approvalStatus.length ? filters.approvalStatus : undefined,
        subRegion: filters.subRegion.length ? filters.subRegion : undefined,
        businessUnit: filters.businessUnit.length ? filters.businessUnit : undefined,
        serviceExpiryPeriod: expiryPeriod.length ? expiryPeriod : undefined,
        minAcv: parsedMinAcv,
        maxAcv: parsedMaxAcv,
        search: filters.search || undefined,
        sortBy,
        sortDir,
        page,
        pageSize,
      }),
  })

  const items: any[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const totalPages: number = data?.pages ?? 1

  // Handle Sort Toggle
  const handleSort = (colId: string) => {
    let apiSort = colId
    if (colId === 'forecast_acv_amount') apiSort = 'acv'
    if (colId === 'business_unit') apiSort = 'business_unit'

    if (sortBy === apiSort) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(apiSort)
      setSortDir('desc')
    }
    setPage(1)
  }

  // Apply Saved View
  const applyView = (view: SavedView) => {
    setActiveViewId(view.id)
    setFilters({
      forecastCategory: view.filters.forecastCategory || [],
      approvalStatus: view.filters.approvalStatus || [],
      subRegion: view.filters.subRegion || [],
      businessUnit: view.filters.businessUnit || [],
      search: view.filters.search || '',
    })
    setExpiryPeriod(view.filters.serviceExpiryPeriod || [])
    setMinAcv(view.filters.minAcv != null ? String(view.filters.minAcv) : '')
    setMaxAcv(view.filters.maxAcv != null ? String(view.filters.maxAcv) : '')
    setSearchQuery(view.filters.search || '')
    setPage(1)
  }

  // Save Current Filter as New View
  const handleSaveView = () => {
    if (!newViewName.trim()) return
    const newView: SavedView = {
      id: `view_${Date.now()}`,
      name: newViewName.trim(),
      filters: {
        forecastCategory: filters.forecastCategory,
        approvalStatus: filters.approvalStatus,
        subRegion: filters.subRegion,
        businessUnit: filters.businessUnit,
        serviceExpiryPeriod: expiryPeriod,
        minAcv: parsedMinAcv,
        maxAcv: parsedMaxAcv,
        search: searchQuery,
      },
    }
    const updatedCustom = [...savedViews.filter((v) => !DEFAULT_VIEWS.some((d) => d.id === v.id)), newView]
    localStorage.setItem('mobileum_saved_views', JSON.stringify(updatedCustom))
    setSavedViews([...DEFAULT_VIEWS, ...updatedCustom])
    setActiveViewId(newView.id)
    setNewViewName('')
    setShowSaveViewModal(false)
  }

  // Reset Filters
  const handleResetFilters = () => {
    clearFilters()
    setExpiryPeriod([])
    setMinAcv('')
    setMaxAcv('')
    setSearchQuery('')
    setActiveViewId('all')
    setPage(1)
  }

  const hasActiveFilters =
    filters.forecastCategory.length > 0 ||
    filters.approvalStatus.length > 0 ||
    filters.subRegion.length > 0 ||
    filters.businessUnit.length > 0 ||
    expiryPeriod.length > 0 ||
    minAcv !== '' ||
    maxAcv !== '' ||
    !!searchQuery

  // CSV Export URL
  const csvUrl = exportOpportunitiesUrl({
    snapshotId: activeSnapshotId ?? undefined,
    forecastCategory: filters.forecastCategory.length ? filters.forecastCategory : undefined,
    approvalStatus: filters.approvalStatus.length ? filters.approvalStatus : undefined,
    subRegion: filters.subRegion.length ? filters.subRegion : undefined,
    businessUnit: filters.businessUnit.length ? filters.businessUnit : undefined,
    serviceExpiryPeriod: expiryPeriod.length ? expiryPeriod : undefined,
    minAcv: parsedMinAcv,
    maxAcv: parsedMaxAcv,
    search: filters.search || undefined,
  })

  return (
    <div className="space-y-5 max-w-full">
      {/* Page Title & Top Actions Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border)]">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">
            Explore Opportunities
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Full deal table with multi-dimensional filtering, custom columns, saved views, and CSV export
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Column Chooser Toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowColChooser((c) => !c)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                showColChooser
                  ? 'bg-teal-500/10 border-teal-500 text-teal-600 dark:text-teal-400'
                  : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-teal-500/40'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Columns ({visibleCols.length})
            </button>

            {/* Column chooser dropdown */}
            <AnimatePresence>
              {showColChooser && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 5 }}
                  className="absolute right-0 mt-2 w-56 p-3 rounded-md bg-[var(--bg-card)] border border-[var(--border)] shadow-xl z-50 space-y-1.5"
                >
                  <p className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    Visible Columns
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {ALL_COLUMNS.map((col) => {
                      const isVis = visibleCols.includes(col.id)
                      return (
                        <label
                          key={col.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer hover:bg-[var(--bg-secondary)]"
                        >
                          <input
                            type="checkbox"
                            checked={isVis}
                            onChange={() => toggleColumn(col.id)}
                            className="rounded border-[var(--border)] text-teal-600 focus:ring-teal-500"
                          />
                          <span className={isVis ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                            {col.label}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Filter Panel Toggle */}
          <button
            type="button"
            onClick={() => setShowFilters((f) => !f)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              showFilters
                ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-teal-500/40'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-0.5" />
            )}
          </button>

          {/* Export CSV Button */}
          <a
            href={csvUrl}
            download="opportunities_export.csv"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] hover:border-teal-500 hover:text-teal-600 transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-teal-500" />
            Export CSV ({total})
          </a>
        </div>
      </div>

      {/* Saved Views Bar */}
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1 mr-1">
          <Bookmark className="w-3.5 h-3.5 text-teal-500" /> Views:
        </span>
        {savedViews.map((view) => {
          const isActive = activeViewId === view.id
          const isCustom = !DEFAULT_VIEWS.some((d) => d.id === view.id)
          return (
            <div
              key={view.id}
              className={`flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-sm text-xs font-medium transition-colors border ${
                isActive
                  ? 'bg-[#12284C] text-white border-[#12284C]'
                  : 'bg-[var(--bg-card)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text-primary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => applyView(view)}
                className="cursor-pointer outline-none"
              >
                {view.name}
              </button>
              {isCustom && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const next = savedViews.filter((v) => v.id !== view.id)
                    localStorage.setItem(
                      'mobileum_saved_views',
                      JSON.stringify(next.filter((v) => !DEFAULT_VIEWS.some((d) => d.id === v.id)))
                    )
                    setSavedViews(next)
                    if (activeViewId === view.id) setActiveViewId('all')
                  }}
                  className="hover:text-red-500 p-0.5"
                  title="Delete view"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => setShowSaveViewModal(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 border border-dashed border-teal-500/40 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Save View
        </button>
      </div>

      {/* Save View Modal Modal */}
      {showSaveViewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="p-5 rounded-md bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl max-w-sm w-full space-y-3">
            <h3 className="font-bold text-sm text-[var(--text-primary)]">
              Save Current Filters as View
            </h3>
            <input
              type="text"
              placeholder="e.g. Q1 High Priority Deals"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-teal-500"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveViewModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveView}
                disabled={!newViewName.trim()}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar & Fast Query Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by opportunity name, account, owner, ID..."
          className="w-full pl-10 pr-9 py-2.5 rounded-xl text-xs bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-teal-500 transition-all shadow-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Collapsible Filter Matrix */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="card p-4 space-y-4 border border-[var(--border)] bg-[var(--bg-card)] shadow-sm"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
              <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-teal-500" />
                Filter Dimensions
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-500 hover:text-rose-600 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset all filters
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              {/* Region Filter */}
              <div className="space-y-1.5">
                <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                  Sub-Region
                </label>
                <select
                  multiple
                  value={filters.subRegion}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => o.value)
                    setFilters({ subRegion: selected })
                    setPage(1)
                  }}
                  className="w-full h-24 p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-teal-500"
                >
                  {filterOpts?.sub_regions?.map((r: string) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-[var(--text-muted)] block">
                  Hold Ctrl/Cmd to select multiple
                </span>
              </div>

              {/* Business Unit Filter */}
              <div className="space-y-1.5">
                <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                  Business Unit
                </label>
                <select
                  multiple
                  value={filters.businessUnit}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (o) => o.value)
                    setFilters({ businessUnit: selected })
                    setPage(1)
                  }}
                  className="w-full h-24 p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-teal-500"
                >
                  {filterOpts?.business_units?.map((bu: string) => (
                    <option key={bu} value={bu}>
                      {bu}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-[var(--text-muted)] block">
                  Primary or raw BU match
                </span>
              </div>

              {/* Forecast & Approval Filter */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                    Forecast Category
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank'].map((cat) => {
                      const isSel = filters.forecastCategory.includes(cat)
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            const next = isSel
                              ? filters.forecastCategory.filter((c) => c !== cat)
                              : [...filters.forecastCategory, cat]
                            setFilters({ forecastCategory: next })
                            setPage(1)
                          }}
                          className={`px-2 py-0.5 rounded-sm text-[11px] font-semibold border transition-all ${
                            isSel
                              ? 'bg-teal-500 text-white border-teal-500'
                              : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {cat}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                    Approval Status
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {['Approved', 'Approved - 2nd', 'Pending Approval', 'Rejected', 'Blank'].map((st) => {
                      const isSel = filters.approvalStatus.includes(st)
                      return (
                        <button
                          key={st}
                          type="button"
                          onClick={() => {
                            const next = isSel
                              ? filters.approvalStatus.filter((s) => s !== st)
                              : [...filters.approvalStatus, st]
                            setFilters({ approvalStatus: next })
                            setPage(1)
                          }}
                          className={`px-2 py-0.5 rounded-sm text-[11px] font-semibold border transition-all ${
                            isSel
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {st}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Expiry Quarter & ACV Range */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                    Expiry Quarter
                  </label>
                  <select
                    value={expiryPeriod[0] || ''}
                    onChange={(e) => {
                      setExpiryPeriod(e.target.value ? [e.target.value] : [])
                      setPage(1)
                    }}
                    className="w-full p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="">All Periods</option>
                    {filterOpts?.service_expiry_periods?.map((p: string) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                    ACV Range ($)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      placeholder="Min $"
                      value={minAcv}
                      onChange={(e) => {
                        setMinAcv(e.target.value)
                        setPage(1)
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none"
                    />
                    <span className="text-[var(--text-muted)]">-</span>
                    <input
                      type="number"
                      placeholder="Max $"
                      value={maxAcv}
                      onChange={(e) => {
                        setMaxAcv(e.target.value)
                        setPage(1)
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results Header Strip */}
      <div className="flex items-center justify-between text-xs px-1">
        <p className="font-medium text-[var(--text-muted)]">
          Showing{' '}
          <strong className="text-[var(--text-primary)]">
            {total > 0 ? (page - 1) * pageSize + 1 : 0}
          </strong>{' '}
          to{' '}
          <strong className="text-[var(--text-primary)]">
            {Math.min(page * pageSize, total)}
          </strong>{' '}
          of <strong className="text-[var(--text-primary)]">{total.toLocaleString()}</strong> opportunities
          {isFetching && <span className="ml-2 text-teal-500 animate-pulse font-semibold">Updating...</span>}
        </p>

        <div className="flex items-center gap-2">
          <span className="text-[var(--text-muted)]">Page size:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            className="px-2 py-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-primary)]"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Main Opportunities Table */}
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] select-none">
                {visibleCols.includes('opportunity_id_18') && (
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px]">
                    ID
                  </th>
                )}
                {visibleCols.includes('opportunity_name') && (
                  <th
                    onClick={() => handleSort('opportunity_name')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Opportunity Name</span>
                      {sortBy === 'opportunity_name' ? (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('account_name') && (
                  <th
                    onClick={() => handleSort('account_name')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Account</span>
                      {sortBy === 'account_name' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('sub_region') && (
                  <th
                    onClick={() => handleSort('sub_region')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Region</span>
                      {sortBy === 'sub_region' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('business_unit') && (
                  <th
                    onClick={() => handleSort('business_unit')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Business Unit</span>
                      {sortBy === 'business_unit' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('forecast_category') && (
                  <th
                    onClick={() => handleSort('forecast_category')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Forecast</span>
                      {sortBy === 'forecast_category' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('forecast_acv_amount') && (
                  <th
                    onClick={() => handleSort('acv')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-right cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Forecast ACV</span>
                      {sortBy === 'acv' ? (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('approval_status') && (
                  <th
                    onClick={() => handleSort('approval_status')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Approval</span>
                      {sortBy === 'approval_status' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('service_expiry_period') && (
                  <th
                    onClick={() => handleSort('service_expiry_period')}
                    className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Expiry</span>
                      {sortBy === 'service_expiry_period' && (
                        sortDir === 'asc' ? <ArrowUp className="w-3 h-3 text-teal-500" /> : <ArrowDown className="w-3 h-3 text-teal-500" />
                      )}
                    </div>
                  </th>
                )}
                {visibleCols.includes('close_date') && (
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px]">
                    Close Date
                  </th>
                )}
                {visibleCols.includes('probability_pct') && (
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px] text-right">
                    Prob %
                  </th>
                )}
                {visibleCols.includes('opportunity_owner') && (
                  <th className="py-3 px-3.5 font-bold uppercase tracking-wider text-[10px]">
                    Owner
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={visibleCols.length} className="py-3 px-4">
                      <Skeleton variant="text" height="20px" width="100%" />
                    </td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="py-12 text-center text-xs text-[var(--text-muted)]"
                  >
                    No opportunities match the selected criteria.
                  </td>
                </tr>
              ) : (
                items.map((opp) => (
                  <tr
                    key={opp.id}
                    onClick={() => setSelectedOppId(opp.opportunity_id_18)}
                    className="hover:bg-teal-500/5 transition-colors cursor-pointer group"
                  >
                    {visibleCols.includes('opportunity_id_18') && (
                      <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--text-muted)]">
                        {opp.opportunity_id_18}
                      </td>
                    )}
                    {visibleCols.includes('opportunity_name') && (
                      <td className="py-2.5 px-3.5 font-semibold text-[var(--text-primary)] group-hover:text-teal-600 dark:group-hover:text-teal-400 max-w-[280px] truncate">
                        {opp.opportunity_name}
                      </td>
                    )}
                    {visibleCols.includes('account_name') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-secondary)] max-w-[180px] truncate">
                        {opp.account_name || 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('sub_region') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-secondary)] whitespace-nowrap">
                        {opp.sub_region || 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('business_unit') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-secondary)] max-w-[180px] truncate">
                        {opp.business_unit_primary || opp.business_unit_raw || 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('forecast_category') && (
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <ForecastBadge category={opp.forecast_category} />
                      </td>
                    )}
                    {visibleCols.includes('forecast_acv_amount') && (
                      <td className="py-2.5 px-3.5 text-right font-extrabold text-[var(--text-primary)] tabular-nums whitespace-nowrap">
                        {formatACV(opp.forecast_acv_amount ?? 0)}
                      </td>
                    )}
                    {visibleCols.includes('approval_status') && (
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <ApprovalBadge status={opp.approval_status} />
                      </td>
                    )}
                    {visibleCols.includes('service_expiry_period') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-muted)] whitespace-nowrap">
                        {opp.service_expiry_period || 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('close_date') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-muted)] whitespace-nowrap">
                        {opp.close_date ? formatDate(opp.close_date) : 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('probability_pct') && (
                      <td className="py-2.5 px-3.5 text-right text-[var(--text-muted)] tabular-nums">
                        {opp.probability_pct != null ? `${opp.probability_pct}%` : 'N/A'}
                      </td>
                    )}
                    {visibleCols.includes('opportunity_owner') && (
                      <td className="py-2.5 px-3.5 text-[var(--text-muted)] truncate max-w-[140px]">
                        {opp.opportunity_owner || 'N/A'}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Navigation Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3.5 border-t border-[var(--border)] bg-[var(--bg-secondary)] text-xs">
            <span className="text-[var(--text-muted)]">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-secondary)]"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg-secondary)]"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
