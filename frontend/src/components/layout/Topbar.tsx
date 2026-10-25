import React, { useEffect, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Sun,
  Moon,
  Search,
  Download,
  Calendar,
  GitCompare,
  FileSpreadsheet,
  Presentation,
  Filter,
  Bookmark,
  RotateCcw,
  ChevronDown,
  Loader2,
  X,
  Menu,
  Save,
  Trash2,
  Info,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, FilterSpec } from '@/store/appStore'
import { getSnapshots, getFilterOptions, downloadReport } from '@/api/client'
import { formatDate } from '@/utils/format'
import { showToast } from '@/components/ui/Toast'
import AdminAuthModal from '@/components/common/AdminAuthModal'

export default function Topbar() {
  const {
    darkMode,
    toggleDarkMode,
    setCommandPaletteOpen,
    activeSnapshotId,
    setActiveSnapshotId,
    compareSnapshotId,
    setCompareSnapshotId,
    snapshots,
    setSnapshots,
    globalFilters,
    setGlobalFilters,
    resetGlobalFilters,
    setMobileSidebarOpen,
  } = useAppStore()

  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [savedViewsOpen, setSavedViewsOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [savedViews, setSavedViews] = useState<{ id: string; name: string; filters: FilterSpec }[]>([])

  const downloadRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<HTMLDivElement>(null)

  const location = useLocation()
  const isExplorer = location.pathname.startsWith('/opportunities') || location.pathname.startsWith('/explore')

  const { data: fetchedSnapshots = [], isLoading: snapshotsLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: async () => {
      const res = await getSnapshots()
      setSnapshots(res)
      return res
    },
  })

  // Dynamic filter options
  const { data: filterOpts } = useQuery({
    queryKey: ['filter-options', globalFilters.as_of],
    queryFn: () => getFilterOptions(globalFilters.as_of ?? undefined),
    staleTime: 60_000,
  })

  // Load saved views
  useEffect(() => {
    try {
      const v = localStorage.getItem('mobileum_saved_filter_views')
      if (v) setSavedViews(JSON.parse(v))
    } catch (_) {}
  }, [])

  // Close popovers on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (downloadRef.current && !downloadRef.current.contains(target)) {
        setDownloadOpen(false)
      }
      if (moreRef.current && !moreRef.current.contains(target)) {
        setMoreFiltersOpen(false)
      }
      if (viewsRef.current && !viewsRef.current.contains(target)) {
        setSavedViewsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Auto-init active and compare snapshots
  useEffect(() => {
    if (snapshots.length > 0) {
      const exists = snapshots.some((s: any) => s.id === activeSnapshotId)
      if (!activeSnapshotId || !exists) {
        const todaySnap = snapshots.find((s: any) => s.is_active_today) ?? snapshots[0]
        setActiveSnapshotId(todaySnap.id)
      }
      const compareExists = snapshots.some((s: any) => s.id === compareSnapshotId)
      if ((!compareSnapshotId || !compareExists) && snapshots.length > 1) {
        setCompareSnapshotId(snapshots[1].id)
      }
    }
  }, [snapshots, activeSnapshotId, compareSnapshotId, setActiveSnapshotId, setCompareSnapshotId])

  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId) ?? snapshots[0]
  const compareSnap = snapshots.find((s: any) => s.id === compareSnapshotId)

  // Determine comparison tooltip label (e.g. "vs Fri 2 Oct")
  const getCompareLabel = () => {
    if (!compareSnap) return ''
    const d = new Date(compareSnap.snapshot_date + 'T00:00:00')
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
    const dayNum = d.getDate()
    const monthName = d.toLocaleDateString('en-US', { month: 'short' })
    const isWorkingDayYesterday = activeSnap?.yesterday_date === compareSnap.snapshot_date
    const isMonday = activeSnap ? new Date(activeSnap.snapshot_date + 'T00:00:00').getDay() === 1 : false
    if (isMonday && isWorkingDayYesterday) {
      return `vs ${dayName} ${dayNum} ${monthName} (Prev Working Day)`
    }
    return `vs ${dayName} ${dayNum} ${monthName}`
  }

  const getDynamicReportNote = (scope: string = 'renewals') => {
    const scopeName = scope === 'full' ? 'Full sheet' : 'Renewals'
    const snapDateStr = activeSnap?.snapshot_date
    if (!snapDateStr) return `${scopeName} · Active Snapshot`
    const formattedDate = formatDate(snapDateStr)
    const d = new Date(snapDateStr + 'T00:00:00')
    const m = d.getMonth()
    const y = d.getFullYear()
    const yy = String(y).slice(-2)
    const qNum = Math.floor(m / 3) + 1
    const qLabel = `Q${qNum} FY${yy}`
    return `${scopeName} · ${qLabel} · as of ${formattedDate}`
  }

  const handleDownload = async (type: 'pptx' | 'xlsx', scope: string = 'renewals') => {
    if (downloadingFormat) return
    setDownloadingFormat(type)
    setDownloadOpen(false)
    try {
      const { filename } = await downloadReport(type, activeSnapshotId, compareSnapshotId, scope)
      showToast.success('Report downloaded', filename)
    } catch (err: any) {
      showToast.error(
        'Download failed',
        err?.response?.data?.detail || err?.message || 'Failed to generate report'
      )
    } finally {
      setDownloadingFormat(null)
    }
  }

  const toggleArrayFilter = (
    field: 'regions' | 'business_units' | 'forecast_categories' | 'approval_statuses',
    value: string
  ) => {
    const current = globalFilters[field] || []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setGlobalFilters({ [field]: next } as any)
  }

  const handleSaveView = () => {
    if (!newViewName.trim()) return
    const updated = [
      ...savedViews,
      { id: Date.now().toString(), name: newViewName.trim(), filters: { ...globalFilters } },
    ]
    setSavedViews(updated)
    localStorage.setItem('mobileum_saved_filter_views', JSON.stringify(updated))
    setNewViewName('')
    showToast.success(`View "${newViewName.trim()}" saved`)
  }

  const handleDeleteView = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = savedViews.filter((v) => v.id !== id)
    setSavedViews(updated)
    localStorage.setItem('mobileum_saved_filter_views', JSON.stringify(updated))
  }

  const handleApplyView = (viewFilters: FilterSpec) => {
    setGlobalFilters(viewFilters)
    setSavedViewsOpen(false)
    setMobileFiltersOpen(false)
    showToast.success('Custom view applied')
  }

  // Active filter chips
  const chips: { key: string; label: string; onRemove: () => void }[] = []
  if (globalFilters.period !== 'current_quarter') {
    const pLabel =
      filterOpts?.quarters?.find((q: any) => q.value === globalFilters.period)?.label ||
      globalFilters.period
    chips.push({
      key: `period-${globalFilters.period}`,
      label: `Period: ${pLabel}`,
      onRemove: () => setGlobalFilters({ period: 'current_quarter' }),
    })
  }
  if (!globalFilters.include_deleted_lost) {
    chips.push({
      key: 'include_deleted_lost',
      label: 'Exclude Deleted/Lost',
      onRemove: () => setGlobalFilters({ include_deleted_lost: true }),
    })
  }
  globalFilters.regions?.forEach((r) => {
    chips.push({
      key: `region-${r}`,
      label: `Region: ${r}`,
      onRemove: () => toggleArrayFilter('regions', r),
    })
  })
  globalFilters.business_units?.forEach((bu) => {
    chips.push({
      key: `bu-${bu}`,
      label: `BU: ${bu}`,
      onRemove: () => toggleArrayFilter('business_units', bu),
    })
  })
  globalFilters.forecast_categories?.forEach((fc) => {
    chips.push({
      key: `fc-${fc}`,
      label: `Category: ${fc}`,
      onRemove: () => toggleArrayFilter('forecast_categories', fc),
    })
  })
  globalFilters.approval_statuses?.forEach((st) => {
    chips.push({
      key: `st-${st}`,
      label: `Approval: ${st}`,
      onRemove: () => toggleArrayFilter('approval_statuses', st),
    })
  })

  const moreFiltersActiveCount =
    globalFilters.regions.length +
    globalFilters.business_units.length +
    globalFilters.forecast_categories.length +
    globalFilters.approval_statuses.length

  const totalActiveFiltersCount = chips.length

  return (
    <div className="sticky top-0 z-30 flex flex-col bg-[var(--bg-card)] border-b border-[var(--border)] shadow-xs">
      {/* ── Single Unified Row ────────────────────────────────────────────── */}
      <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex items-center gap-2 lg:gap-3">
          {/* Mobile Hamburger Drawer Button (<640px) */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="sm:hidden w-10 h-10 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* 1. Search (shrinks and flexes to fill free space) */}
          <div className="flex-1 min-w-[140px] max-w-sm">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="w-full h-10 px-3 rounded-md text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors inline-flex items-center justify-between focus:outline-none"
              id="topbar-search-btn"
              title="Global search (⌘K)"
            >
              <div className="inline-flex items-center gap-2 truncate">
                <Search className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
                <span className="truncate hidden sm:inline">Search opportunities, regions, accounts...</span>
                <span className="truncate sm:hidden">Search...</span>
              </div>
              <kbd className="hidden sm:inline-block ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[var(--text-muted)] flex-shrink-0">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* 2. As of (hidden on phone, accessible via Filters button) */}
          <div className="hidden sm:inline-flex h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs items-center gap-1.5 transition-colors flex-shrink-0">
            <Calendar className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
            <span className="font-medium text-[var(--text-muted)] hidden md:inline">
              As of:
            </span>
            <select
              value={activeSnap?.id ?? ''}
              onChange={(e) => setActiveSnapshotId(e.target.value || null)}
              className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1"
              id="topbar-view-as-of-select"
            >
              {snapshotsLoading && <option>Loading dates...</option>}
              {snapshots.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({formatDate(s.snapshot_date)})
                </option>
              ))}
            </select>
          </div>

          {/* 3. vs (compare selector with helper in tooltip) */}
          <div
            className="hidden sm:inline-flex h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs whitespace-nowrap items-center gap-1.5 transition-colors flex-shrink-0"
            title={getCompareLabel()}
          >
            <GitCompare className="w-4 h-4 text-slate-500 flex-shrink-0" />
            <span className="font-medium text-[var(--text-muted)] hidden md:inline">
              vs:
            </span>
            <select
              value={compareSnapshotId ?? ''}
              onChange={(e) => setCompareSnapshotId(e.target.value || null)}
              className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1"
              id="topbar-compare-with-select"
            >
              {snapshots
                .filter((s: any) => s.id !== activeSnap?.id)
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({formatDate(s.snapshot_date)})
                  </option>
                ))}
            </select>
          </div>

          {/* 4. Period (visible >= md) */}
          <div className="hidden md:inline-flex h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs items-center gap-1.5 transition-colors flex-shrink-0">
            <Calendar className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
            <span className="font-medium text-[var(--text-muted)] hidden lg:inline">
              Period:
            </span>
            <select
              value={globalFilters.period}
              onChange={(e) => setGlobalFilters({ period: e.target.value })}
              className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1"
              id="filter-period-select"
            >
              <option value="current_quarter">Current Quarter (Default)</option>
              <option value="previous_quarter">Previous Quarter</option>
              <option value="next_quarter">Next Quarter</option>
              <option value="all_periods">All Periods</option>
              {filterOpts?.quarters?.map((q: any) => (
                <option key={q.key} value={q.key}>
                  {q.label} ({q.count})
                </option>
              ))}
              {filterOpts?.fiscal_years?.map((fy: any) => (
                <option key={fy.key} value={fy.key}>
                  {fy.label} ({fy.count})
                </option>
              ))}
            </select>
          </div>

          {/* 5. Include Deleted & Lost (visible >= xl) */}
          <label
            className="hidden xl:inline-flex h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] cursor-pointer transition-colors items-center gap-2 select-none flex-shrink-0"
            title="Toggle inclusion of Deleted and Lost pipeline opportunities"
          >
            <input
              type="checkbox"
              checked={globalFilters.include_deleted_lost}
              onChange={(e) => setGlobalFilters({ include_deleted_lost: e.target.checked })}
              className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
              id="filter-include-deleted-lost"
            />
            <span className="font-medium text-[var(--text-primary)] text-xs whitespace-nowrap">
              Include Deleted & Lost
            </span>
          </label>

          {/* 6. More Filters (visible >= lg) */}
          <div className="relative hidden lg:block flex-shrink-0" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreFiltersOpen(!moreFiltersOpen)}
              className="h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1.5 focus:outline-none text-xs"
              id="filter-more-btn"
            >
              <Filter className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
              <span className="whitespace-nowrap">More Filters</span>
              {moreFiltersActiveCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-sm bg-[#00A3AD] text-white flex items-center justify-center text-[10px] font-semibold leading-none">
                  {moreFiltersActiveCount}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 ml-0.5" />
            </button>

            {/* More Filters popover */}
            {moreFiltersOpen && (
              <div className="absolute left-0 mt-1 w-80 md:w-96 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-50 flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b pb-2 border-[var(--border)]">
                  <span className="font-semibold text-xs text-[var(--text-primary)]">Filter Dimensions</span>
                  <button
                    type="button"
                    onClick={() => setMoreFiltersOpen(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Regions */}
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                    Regions
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 border rounded-sm border-[var(--border)] bg-[var(--bg-secondary)]">
                    {filterOpts?.regions?.map((r: any) => {
                      const sel = globalFilters.regions.includes(r.key)
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleArrayFilter('regions', r.key)}
                          className={`px-2 py-0.5 rounded-sm text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {r.label} ({r.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Business Units */}
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                    Business Units
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 border rounded-sm border-[var(--border)] bg-[var(--bg-secondary)]">
                    {filterOpts?.business_units?.map((bu: any) => {
                      const sel = globalFilters.business_units.includes(bu.key)
                      return (
                        <button
                          key={bu.key}
                          type="button"
                          onClick={() => toggleArrayFilter('business_units', bu.key)}
                          className={`px-2 py-0.5 rounded-sm text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {bu.label} ({bu.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Forecast Categories */}
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                    Forecast Categories
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {filterOpts?.forecast_categories?.map((fc: any) => {
                      const sel = globalFilters.forecast_categories.includes(fc.key)
                      return (
                        <button
                          key={fc.key}
                          type="button"
                          onClick={() => toggleArrayFilter('forecast_categories', fc.key)}
                          className={`px-2 py-0.5 rounded-sm text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {fc.label} ({fc.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Approval Statuses */}
                <div>
                  <label className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block mb-1">
                    Approval Statuses
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {filterOpts?.approval_statuses?.map((st: any) => {
                      const sel = globalFilters.approval_statuses.includes(st.key)
                      return (
                        <button
                          key={st.key}
                          type="button"
                          onClick={() => toggleArrayFilter('approval_statuses', st.key)}
                          className={`px-2 py-0.5 rounded-sm text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {st.label} ({st.count})
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 7. Saved Views (visible >= xl) */}
          <div className="relative hidden xl:block flex-shrink-0" ref={viewsRef}>
            <button
              type="button"
              onClick={() => setSavedViewsOpen(!savedViewsOpen)}
              className="h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1.5 focus:outline-none text-xs"
              id="filter-saved-views-btn"
            >
              <Bookmark className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
              <span className="whitespace-nowrap">Saved Views</span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 ml-0.5" />
            </button>

            {savedViewsOpen && (
              <div className="absolute left-0 mt-1 w-64 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-50 flex flex-col gap-2">
                <span className="font-semibold text-xs text-[var(--text-primary)]">Custom Filter Views</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="View name..."
                    value={newViewName}
                    onChange={(e) => setNewViewName(e.target.value)}
                    className="px-2 py-1 rounded-md border text-xs bg-[var(--bg-secondary)] border-[var(--border)] flex-1 text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveView}
                    disabled={!newViewName.trim()}
                    className="px-2.5 py-1 rounded-md bg-[#12284C] text-white text-xs font-medium hover:bg-[#1B365D] disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                  </button>
                </div>

                {savedViews.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border-t border-[var(--border)] pt-2 mt-1">
                    {savedViews.map((v) => (
                      <div
                        key={v.id}
                        onClick={() => handleApplyView(v.filters)}
                        className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer text-xs group"
                      >
                        <span className="font-medium text-[var(--text-primary)] truncate">{v.name}</span>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteView(v.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Unified "Filters" panel toggle button for narrower screens (< xl or phone) */}
          <div className="inline-flex xl:hidden flex-shrink-0">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors focus:outline-none"
              id="topbar-filters-drawer-btn"
              title="Filter settings"
            >
              <Filter className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
              <span className="hidden sm:inline">Filters</span>
              {totalActiveFiltersCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-sm bg-[#00A3AD] text-white text-[10px] font-semibold leading-none">
                  {totalActiveFiltersCount}
                </span>
              )}
            </button>
          </div>

          {/* 8. Download report Menu */}
          <div className="relative flex-shrink-0" ref={downloadRef}>
            <button
              type="button"
              disabled={!!downloadingFormat}
              onClick={() => setDownloadOpen(!downloadOpen)}
              className="h-10 px-3 rounded-md text-xs font-medium bg-[#12284C] text-white hover:bg-[#1B365D] border border-transparent transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              id="topbar-download-btn"
              title="Download report"
            >
              {downloadingFormat ? (
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              ) : (
                <Download className="w-4 h-4 flex-shrink-0" />
              )}
              <span className="hidden md:inline whitespace-nowrap">
                {downloadingFormat
                  ? downloadingFormat === 'pptx'
                    ? 'Generating PPTX...'
                    : 'Generating Excel...'
                  : 'Download report'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 opacity-80 flex-shrink-0" />
            </button>

            {downloadOpen && (
              <div className="absolute right-0 mt-1 w-64 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-1.5 z-50 divide-y divide-[var(--border)]">
                <div className="py-1">
                  <p className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Renewals Scope (Default)
                  </p>
                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('pptx', 'renewals')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    id="topbar-download-pptx-btn"
                  >
                    {downloadingFormat === 'pptx' ? (
                      <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                    ) : (
                      <Presentation className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">PowerPoint (.pptx)</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Renewals deck (24 slides)</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('xlsx', 'renewals')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    id="topbar-download-excel-btn"
                  >
                    {downloadingFormat === 'xlsx' ? (
                      <Loader2 className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">Excel (.xlsx)</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Renewals summaries (10 sheets)</p>
                    </div>
                  </button>
                </div>

                <div className="py-1">
                  <p className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Full Sheet (All Sales Types)
                  </p>
                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('pptx', 'full')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    id="topbar-download-pptx-full-btn"
                  >
                    <Presentation className="w-4 h-4 text-amber-500/80 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">PowerPoint (Full Sheet)</p>
                      <p className="text-[10px] text-[var(--text-muted)]">All sales types</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('xlsx', 'full')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    id="topbar-download-excel-full-btn"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600/80 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Excel (Full Sheet)</p>
                      <p className="text-[10px] text-[var(--text-muted)]">All sales types</p>
                    </div>
                  </button>
                </div>

                <div className="px-2.5 py-1.5 bg-[var(--bg-secondary)]/50 rounded-b-lg">
                  <p className="text-[10px] font-medium text-[var(--text-muted)] text-center">
                    {getDynamicReportNote()}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 9. Admin sign in */}
          <div className="hidden sm:inline-flex flex-shrink-0">
            <AdminAuthModal />
          </div>

          {/* 10. Theme toggle */}
          <button
            type="button"
            onClick={toggleDarkMode}
            className="w-10 h-10 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] border border-[var(--border)] transition-colors focus:outline-none flex-shrink-0"
            id="topbar-theme-toggle"
            title={darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-600" />
            )}
          </button>
        </div>
      </div>

      {/* Explorer Scope Note if on Data Explorer */}
      {isExplorer && (
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center gap-2 text-xs border-t border-[var(--border)] bg-[var(--bg-secondary)]/30" id="filter-bar-explorer-scope-note">
          <Info className="w-3.5 h-3.5 text-[#00A3AD] flex-shrink-0" />
          <span className="font-medium text-[var(--text-secondary)]">
            Showing the full Excel sheet. Use the filters below.
          </span>
        </div>
      )}

      {/* Active Filter Chips strip if any filters active */}
      {!isExplorer && chips.length > 0 && (
        <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] text-xs">
          <span className="font-bold text-[10px] uppercase tracking-wider text-[var(--text-muted)] mr-1">
            Active:
          </span>
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border)] font-medium"
            >
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                className="hover:text-red-500 transition-colors p-0.5"
                aria-label={`Remove filter ${chip.label}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={resetGlobalFilters}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-rose-500 hover:text-rose-600 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset filters</span>
          </button>
        </div>
      )}

      {/* ── Slide-over Filter Panel for Mobile (< 640px) and Tablet (< xl) ── */}
      <AnimatePresence>
        {mobileFiltersOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileFiltersOpen(false)}
              className="fixed inset-0 bg-black/60"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-md bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col h-full max-sm:max-w-full"
            >
              {/* Panel Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-[#00A3AD]" />
                  <h3 className="font-bold text-sm text-[var(--text-primary)]">Filters & Settings</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="w-10 h-10 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors"
                  aria-label="Close filters panel"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Panel Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* As of Date */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    As of Snapshot
                  </label>
                  <select
                    value={activeSnap?.id ?? ''}
                    onChange={(e) => setActiveSnapshotId(e.target.value || null)}
                    className="w-full h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] outline-none font-medium"
                  >
                    {snapshots.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.label} ({formatDate(s.snapshot_date)})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Compare With */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Compare With (vs)
                  </label>
                  <select
                    value={compareSnapshotId ?? ''}
                    onChange={(e) => setCompareSnapshotId(e.target.value || null)}
                    className="w-full h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] outline-none font-medium"
                  >
                    {snapshots
                      .filter((s: any) => s.id !== activeSnap?.id)
                      .map((s: any) => (
                        <option key={s.id} value={s.id}>
                          {s.label} ({formatDate(s.snapshot_date)})
                        </option>
                      ))}
                  </select>
                  {compareSnap && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">{getCompareLabel()}</p>
                  )}
                </div>

                {/* Period */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Period Scope
                  </label>
                  <select
                    value={globalFilters.period}
                    onChange={(e) => setGlobalFilters({ period: e.target.value })}
                    className="w-full h-10 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] outline-none font-medium"
                  >
                    <option value="current_quarter">Current Quarter (Default)</option>
                    <option value="previous_quarter">Previous Quarter</option>
                    <option value="next_quarter">Next Quarter</option>
                    <option value="all_periods">All Periods</option>
                    {filterOpts?.quarters?.map((q: any) => (
                      <option key={q.key} value={q.key}>
                        {q.label} ({q.count})
                      </option>
                    ))}
                    {filterOpts?.fiscal_years?.map((fy: any) => (
                      <option key={fy.key} value={fy.key}>
                        {fy.label} ({fy.count})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Include Deleted & Lost */}
                <div className="pt-2">
                  <label className="flex items-center gap-2.5 p-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={globalFilters.include_deleted_lost}
                      onChange={(e) => setGlobalFilters({ include_deleted_lost: e.target.checked })}
                      className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-medium text-xs text-[var(--text-primary)]">
                      Include Deleted & Lost opportunities
                    </span>
                  </label>
                </div>

                {/* Regions */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Regions
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 border rounded-md border-[var(--border)] bg-[var(--bg-secondary)]">
                    {filterOpts?.regions?.map((r: any) => {
                      const sel = globalFilters.regions.includes(r.key)
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleArrayFilter('regions', r.key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {r.label} ({r.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Business Units */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Business Units
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 border rounded-md border-[var(--border)] bg-[var(--bg-secondary)]">
                    {filterOpts?.business_units?.map((bu: any) => {
                      const sel = globalFilters.business_units.includes(bu.key)
                      return (
                        <button
                          key={bu.key}
                          type="button"
                          onClick={() => toggleArrayFilter('business_units', bu.key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {bu.label} ({bu.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Forecast Categories */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Forecast Categories
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {filterOpts?.forecast_categories?.map((fc: any) => {
                      const sel = globalFilters.forecast_categories.includes(fc.key)
                      return (
                        <button
                          key={fc.key}
                          type="button"
                          onClick={() => toggleArrayFilter('forecast_categories', fc.key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            sel
                              ? 'bg-[#12284C] text-white border-[#12284C]'
                              : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          {fc.label} ({fc.count})
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Mobile Admin Sign in button */}
                <div className="pt-2 sm:hidden border-t border-[var(--border)]">
                  <AdminAuthModal />
                </div>
              </div>

              {/* Panel Footer */}
              <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    resetGlobalFilters()
                    setMobileFiltersOpen(false)
                  }}
                  className="px-3.5 py-2 rounded-md border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition-colors"
                >
                  Reset all filters
                </button>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="px-4 py-2 rounded-md bg-[#12284C] hover:bg-[#1B365D] text-white text-xs font-medium transition-colors"
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
