import React, { useEffect, useState, useRef, useMemo } from 'react'
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
  AlertTriangle,
  Tag,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore, FilterSpec, DEFAULT_FILTER_SPEC } from '@/store/appStore'
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
    isAdmin,
    securityWarnings,
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
  const typeFilterRef = useRef<HTMLDivElement>(null)
  const [typeFilterOpen, setTypeFilterOpen] = useState(false)

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
      if (typeFilterRef.current && !typeFilterRef.current.contains(target)) {
        setTypeFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Helper to parse date string YYYY-MM-DD into UTC date for exact difference
  const parseISODate = (str: string | undefined | null): Date | null => {
    if (!str) return null
    const parts = str.split('T')[0].split('-').map(Number)
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
    }
    return null
  }

  const diffDays = (d1: Date, d2: Date): number => {
    return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24))
  }

  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId) ?? snapshots[0]
  const compareSnap = snapshots.find((s: any) => s.id === compareSnapshotId)

  // Current date resolved from server/timezone (fallback to client local date)
  const currentDateStr = filterOpts?.current_date || new Date().toISOString().split('T')[0]
  const currentDate = parseISODate(currentDateStr)

  // Dynamic As of options (Section C)
  const asOfOptions = useMemo(() => {
    return snapshots.map((s: any) => {
      const snapDate = parseISODate(s.snapshot_date)
      let label = formatDate(s.snapshot_date)
      if (currentDate && snapDate) {
        const delta = diffDays(currentDate, snapDate)
        if (delta === 0) {
          label = `Today (${formatDate(s.snapshot_date)})`
        } else if (delta === 1) {
          label = `Yesterday (${formatDate(s.snapshot_date)})`
        } else if (delta === 7) {
          label = `Last week (${formatDate(s.snapshot_date)})`
        } else {
          label = formatDate(s.snapshot_date)
        }
      }
      return { id: s.id, date: s.snapshot_date, label }
    })
  }, [snapshots, currentDate])

  // Dynamic vs options (Section C: relative to selected as-of date)
  const asOfDate = parseISODate(activeSnap?.snapshot_date)
  const vsOptions = useMemo(() => {
    if (!asOfDate) return []
    // Exclude selected as-of date itself
    const otherSnaps = snapshots.filter((s: any) => s.id !== activeSnap?.id)
    
    // Check if as-of minus 1 exists
    const hasYesterday = otherSnaps.some((s: any) => {
      const d = parseISODate(s.snapshot_date)
      return d && diffDays(asOfDate, d) === 1
    })

    // Find latest earlier snapshot
    const earlierSnaps = otherSnaps.filter((s: any) => {
      const d = parseISODate(s.snapshot_date)
      return d && d.getTime() < asOfDate.getTime()
    }).sort((a: any, b: any) => {
      const dA = parseISODate(a.snapshot_date)?.getTime() || 0
      const dB = parseISODate(b.snapshot_date)?.getTime() || 0
      return dB - dA
    })
    const latestEarlierSnap = earlierSnaps[0]

    return otherSnaps.map((s: any) => {
      const snapDate = parseISODate(s.snapshot_date)
      let label = formatDate(s.snapshot_date)
      if (snapDate) {
        const delta = diffDays(asOfDate, snapDate)
        if (delta === 1) {
          label = `Yesterday (${formatDate(s.snapshot_date)})`
        } else if (delta === 7) {
          label = `Last week (${formatDate(s.snapshot_date)})`
        } else if (!hasYesterday && latestEarlierSnap && s.id === latestEarlierSnap.id) {
          label = `${formatDate(s.snapshot_date)} (previous upload)`
        } else {
          label = formatDate(s.snapshot_date)
        }
      }
      return {
        id: s.id,
        date: s.snapshot_date,
        label,
        isDefaultEarlier: !hasYesterday && latestEarlierSnap && s.id === latestEarlierSnap.id,
      }
    })
  }, [snapshots, activeSnap?.id, asOfDate])

  // Auto-init active and compare snapshots
  useEffect(() => {
    if (snapshots.length > 0) {
      const exists = snapshots.some((s: any) => s.id === activeSnapshotId)
      if (!activeSnapshotId || !exists) {
        const todaySnap = snapshots.find((s: any) => s.is_active_today) ?? snapshots[0]
        setActiveSnapshotId(todaySnap.id)
      }
      const vsValid = vsOptions.some((v: any) => v.id === compareSnapshotId)
      if ((!compareSnapshotId || !vsValid) && vsOptions.length > 0) {
        const preferred = vsOptions.find((v: any) => v.isDefaultEarlier) || vsOptions[0]
        setCompareSnapshotId(preferred.id)
      }
    }
  }, [snapshots, activeSnapshotId, compareSnapshotId, vsOptions, setActiveSnapshotId, setCompareSnapshotId])

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

  // Deal Types filter state
  const defaultTypes: string[] = filterOpts?.default_types || ['All']
  const allAvailableTypes: { code: string; label: string; deal_count: number }[] = useMemo(() => {
    return (filterOpts?.types || []).map((t: any) => {
      if (typeof t === 'string') {
        return { code: t, label: t, deal_count: 0 }
      }
      return {
        code: String(t.code || t.key || t.value || t.label || ''),
        label: String(t.label || t.code || t.key || t.value || ''),
        deal_count: Number(t.deal_count ?? t.count ?? 0),
      }
    })
  }, [filterOpts?.types])
  const allCodes = allAvailableTypes.map((t) => t.code).filter(Boolean)
  const currentTypes = globalFilters.types || defaultTypes
  const isAllTypes = currentTypes.includes('all') || (allCodes.length > 0 && allCodes.every((c: string) => currentTypes.includes(c)))

  const toggleTypeFilter = (code: string) => {
    let next: string[]
    if (isAllTypes) {
      next = allCodes.filter((c: string) => c !== code)
    } else {
      next = currentTypes.includes(code)
        ? currentTypes.filter((c: string) => c !== code)
        : [...currentTypes, code]
    }
    setGlobalFilters({ types: next })
  }

  // Active filter chips (only filters user changed from default)
  const chips: { key: string; label: string; onRemove: () => void }[] = []
  
  // Type filter chip - only show if user narrowed types
  if (!isAllTypes) {
    chips.push({
      key: 'type-filter',
      label: currentTypes.length === 0 ? 'Type: None' : `Type: ${currentTypes.join(', ')}`,
      onRemove: () => setGlobalFilters({ types: defaultTypes }),
    })
  }

  // Period chip - only show if user changed from default
  if (globalFilters.period !== DEFAULT_FILTER_SPEC.period) {
    const pLabel =
      filterOpts?.quarters?.find((q: any) => q.value === globalFilters.period)?.label ||
      globalFilters.period
    chips.push({
      key: `period-${globalFilters.period}`,
      label: `Period: ${pLabel}`,
      onRemove: () => setGlobalFilters({ period: DEFAULT_FILTER_SPEC.period }),
    })
  }

  // Include Deleted & Lost chip - only show if turned ON (default OFF)
  if (globalFilters.include_deleted_lost !== DEFAULT_FILTER_SPEC.include_deleted_lost) {
    chips.push({
      key: 'include_deleted_lost',
      label: 'Including Deleted & Lost',
      onRemove: () => setGlobalFilters({ include_deleted_lost: DEFAULT_FILTER_SPEC.include_deleted_lost }),
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
    <div className="sticky top-0 z-40 flex flex-col bg-[var(--bg-card)] border-b border-[var(--border)] shadow-xs">
      {/* Admin Security Warning Banner */}
      {isAdmin && securityWarnings && securityWarnings.length > 0 && (
        <div
          id="admin-security-banner"
          className="bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-2 max-w-[1920px] mx-auto w-full">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1">
              <span className="font-bold uppercase tracking-wider text-[10px] text-amber-700 dark:text-amber-300 mr-2">
                Security Warning:
              </span>
              <span>{securityWarnings.join(' • ')}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Single Unified Responsive Row ─────────────────────────────────── */}
      <div className="w-full max-w-[1920px] mx-auto px-2.5 sm:px-4 lg:px-6 py-1.5 sm:py-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          {/* ── Left & Center Filters Group ── */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 lg:gap-2 min-w-0 flex-1">
            {/* Mobile Hamburger Drawer Button (<640px) */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="sm:hidden w-9 h-9 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] flex items-center justify-center flex-shrink-0 transition-colors focus:outline-none"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* 1. Search (shrinks and flexes to fill free space) */}
            <div className="min-w-[80px] sm:min-w-[110px] max-w-[125px] sm:max-w-[140px] lg:max-w-[160px] xl:max-w-[180px] min-[1800px]:max-w-xs flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="w-full h-9 sm:h-10 px-2 sm:px-2.5 rounded-md text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors inline-flex items-center justify-between focus:outline-none"
                id="topbar-search-btn"
                title="Global search (⌘K)"
              >
                <div className="inline-flex items-center gap-1.5 sm:gap-2 truncate">
                  <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00A3AD] flex-shrink-0" />
                  <span className="truncate hidden min-[1800px]:inline">Search opportunities, regions, accounts...</span>
                  <span className="truncate min-[1800px]:hidden">Search...</span>
                </div>
                <kbd className="hidden sm:inline-block ml-1 px-1 py-0.5 rounded text-[10px] bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[var(--text-muted)] flex-shrink-0">
                  ⌘K
                </kbd>
              </button>
            </div>

            {/* 2. As of (hidden on phone, accessible via Filters button) */}
            <div className="hidden sm:inline-flex h-9 sm:h-10 px-2 sm:px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs items-center gap-1 sm:gap-1.5 transition-colors flex-shrink-0">
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00A3AD] flex-shrink-0" />
              <span className="font-medium text-[var(--text-muted)] hidden xl:inline">
                As of:
              </span>
              <select
                value={activeSnap?.id ?? ''}
                onChange={(e) => setActiveSnapshotId(e.target.value || null)}
                className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1 max-w-[95px] sm:max-w-[120px] xl:max-w-[140px] truncate"
                id="topbar-view-as-of-select"
              >
                {snapshotsLoading && <option>Loading dates...</option>}
                {asOfOptions.map((opt: any) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. vs (compare selector with helper in tooltip) */}
            <div
              className="hidden lg:inline-flex h-9 sm:h-10 px-2 sm:px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs whitespace-nowrap items-center gap-1 sm:gap-1.5 transition-colors flex-shrink-0"
              title={getCompareLabel()}
            >
              <GitCompare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500 flex-shrink-0" />
              <span className="font-medium text-[var(--text-muted)] hidden xl:inline">
                vs:
              </span>
              <select
                value={compareSnapshotId ?? ''}
                onChange={(e) => setCompareSnapshotId(e.target.value || null)}
                className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1 max-w-[95px] sm:max-w-[120px] xl:max-w-[140px] truncate"
                id="topbar-compare-with-select"
              >
                {vsOptions.map((opt: any) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Period (visible >= xl) */}
            <div className="hidden xl:inline-flex h-9 sm:h-10 px-2 sm:px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs items-center gap-1 sm:gap-1.5 transition-colors flex-shrink-0">
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00A3AD] flex-shrink-0" />
              <span className="font-medium text-[var(--text-muted)] hidden 2xl:inline">
                Period:
              </span>
              <select
                value={globalFilters.period}
                onChange={(e) => setGlobalFilters({ period: e.target.value })}
                className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs pr-1 max-w-[100px] xl:max-w-[135px] truncate"
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

            {/* 5. Type Filter (Multi-select dropdown, visible >= 2xl) */}
            <div className="relative hidden 2xl:inline-flex flex-shrink-0" ref={typeFilterRef}>
              <button
                type="button"
                onClick={() => setTypeFilterOpen(!typeFilterOpen)}
                className="h-9 sm:h-10 px-2 sm:px-2.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1 sm:gap-1.5 focus:outline-none text-xs"
                id="filter-type-btn"
                title="Filter by Deal Type"
              >
                <Tag className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00A3AD] flex-shrink-0" />
                <span className="font-medium text-[var(--text-muted)] hidden min-[1800px]:inline">Type:</span>
                <span className="font-medium truncate max-w-[50px] xl:max-w-[80px]">
                  {isAllTypes ? 'All' : (currentTypes.length === 0 ? 'None' : currentTypes.join(', '))}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 ml-0.5" />
              </button>

              {/* Type Popover */}
              {typeFilterOpen && (
                <div className="absolute left-0 mt-1 top-full w-72 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-[100] flex flex-col gap-2.5">
                  <div className="flex items-center justify-between border-b pb-2 border-[var(--border)]">
                    <span className="font-semibold text-xs text-[var(--text-primary)]">Deal Type Filter</span>
                    <button
                      type="button"
                      onClick={() => setTypeFilterOpen(false)}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGlobalFilters({ types: allCodes.length > 0 ? allCodes : ['all'] })}
                      className="flex-1 py-1 px-2 text-[11px] font-medium rounded border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                      id="btn-select-all-types"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setGlobalFilters({ types: defaultTypes })}
                      className="flex-1 py-1 px-2 text-[11px] font-medium rounded border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                      id="btn-reset-default-types"
                    >
                      Default ({defaultTypes.join(', ') || 'All'})
                    </button>
                  </div>

                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto p-1 border rounded-md border-[var(--border)] bg-[var(--bg-secondary)]">
                    {allAvailableTypes.map((t: any) => {
                      const code = t.code || t.label
                      const count = t.deal_count ?? 0
                      const checked = isAllTypes || currentTypes.includes(code)
                      return (
                        <label
                          key={code}
                          className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer text-xs select-none"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTypeFilter(code)}
                              className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                            />
                            <span className="font-medium text-[var(--text-primary)]">{t.label || code}</span>
                          </div>
                          {count > 0 && <span className="text-[10px] text-[var(--text-muted)]">{count} deals</span>}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* More Filters (visible >= 1800px) */}
            <div className="relative hidden min-[1800px]:block flex-shrink-0" ref={moreRef}>
              <button
                type="button"
                onClick={() => setMoreFiltersOpen(!moreFiltersOpen)}
                className="h-9 sm:h-10 px-2.5 sm:px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1.5 focus:outline-none text-xs"
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
                <div className="absolute left-0 mt-1 w-80 md:w-96 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-[100] flex flex-col gap-3 max-h-[80vh] overflow-y-auto">
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

                  {/* Optional switch: Include Deleted & Lost stages (default OFF, resets with Reset filters) */}
                  <div className="pt-2 border-t border-[var(--border)]">
                    <label className="flex items-center justify-between p-2 rounded-md hover:bg-[var(--bg-secondary)] cursor-pointer select-none">
                      <div>
                        <div className="font-semibold text-xs text-[var(--text-primary)]">Include Deleted & Lost stages</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Includes deals in Deleted and Lost stages (default: excluded)</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={globalFilters.include_deleted_lost}
                        onChange={(e) => setGlobalFilters({ include_deleted_lost: e.target.checked })}
                        className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-4 h-4 cursor-pointer"
                        id="more-filters-include-deleted-lost"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* 8. Saved Views (visible >= 1800px) */}
            <div className="relative hidden min-[1800px]:block flex-shrink-0" ref={viewsRef}>
              <button
                type="button"
                onClick={() => setSavedViewsOpen(!savedViewsOpen)}
                className="h-9 sm:h-10 px-2.5 sm:px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-card)] transition-colors inline-flex items-center gap-1.5 focus:outline-none text-xs"
                id="filter-saved-views-btn"
              >
                <Bookmark className="w-4 h-4 text-[#00A3AD] flex-shrink-0" />
                <span className="whitespace-nowrap">Saved Views</span>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-70 ml-0.5" />
              </button>

              {savedViewsOpen && (
                <div className="absolute left-0 mt-1 w-64 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-[100] flex flex-col gap-2">
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

            {/* Unified "Filters" panel toggle button for narrower screens (< 1800px or phone) */}
            <div className="inline-flex min-[1800px]:hidden flex-shrink-0">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="h-9 sm:h-10 px-2 sm:px-2.5 xl:px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-xs font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors focus:outline-none"
                id="topbar-filters-drawer-btn"
                title="Filter settings & dimensions"
              >
                <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#00A3AD] flex-shrink-0" />
                <span className="hidden sm:inline">Filters</span>
                {totalActiveFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-sm bg-[#00A3AD] text-white text-[10px] font-semibold leading-none">
                    {totalActiveFiltersCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* ── Right Utility Controls (Always visible, never pushed off-screen) ── */}
          <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 flex-shrink-0 ml-auto">
            {/* Download report Menu */}
            <div className="relative flex-shrink-0" ref={downloadRef}>
              <button
                type="button"
                disabled={!!downloadingFormat}
                onClick={() => setDownloadOpen(!downloadOpen)}
                className="h-9 sm:h-10 px-2 sm:px-2.5 xl:px-3 rounded-md text-xs font-medium bg-[#12284C] text-white hover:bg-[#1B365D] border border-transparent transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                id="topbar-download-btn"
                title="Download report"
              >
                {downloadingFormat ? (
                  <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin flex-shrink-0" />
                ) : (
                  <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                )}
                <span className="hidden xl:inline whitespace-nowrap">
                  {downloadingFormat
                    ? downloadingFormat === 'pptx'
                      ? 'Generating PPTX...'
                      : 'Generating Excel...'
                    : 'Download report'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 opacity-80 flex-shrink-0 hidden sm:inline" />
              </button>

              {downloadOpen && (
                <div className="absolute right-0 mt-1 w-64 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-1.5 z-[100] divide-y divide-[var(--border)]">
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

            {/* Admin sign in (Always visible!) */}
            <div className="flex-shrink-0">
              <AdminAuthModal />
            </div>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={toggleDarkMode}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] border border-[var(--border)] transition-colors focus:outline-none flex-shrink-0"
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

                {/* Deal Type (Mobile) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                      Deal Type
                    </label>
                    <div className="flex gap-2 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setGlobalFilters({ types: allCodes.length > 0 ? allCodes : ['all'] })}
                        className="text-[#00A3AD] font-semibold hover:underline"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setGlobalFilters({ types: defaultTypes })}
                        className="text-[var(--text-muted)] hover:underline"
                      >
                        Default
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-2 border rounded-md border-[var(--border)] bg-[var(--bg-secondary)]">
                    {allAvailableTypes.map((t: any) => {
                      const code = t.code || t.key || t.value
                      const count = t.deal_count ?? t.count ?? 0
                      const checked = isAllTypes || currentTypes.includes(code)
                      return (
                        <label
                          key={code}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] cursor-pointer text-xs select-none"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleTypeFilter(code)}
                            className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="font-medium text-[var(--text-primary)]">{code}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">({count})</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {/* Include Deleted & Lost */}
                <div className="pt-2">
                  <label className="flex items-center justify-between p-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] cursor-pointer select-none">
                    <div>
                      <div className="font-medium text-xs text-[var(--text-primary)]">
                        Include Deleted & Lost stages
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        Default: excluded
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={globalFilters.include_deleted_lost}
                      onChange={(e) => setGlobalFilters({ include_deleted_lost: e.target.checked })}
                      className="rounded border-[var(--border)] text-[#00A3AD] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
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

                {/* Approval Statuses */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Approval Statuses
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {filterOpts?.approval_statuses?.map((st: any) => {
                      const sel = globalFilters.approval_statuses.includes(st.key)
                      return (
                        <button
                          key={st.key}
                          type="button"
                          onClick={() => toggleArrayFilter('approval_statuses', st.key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
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

                {/* Custom Filter Views (Saved Views) */}
                <div>
                  <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                    Saved Views
                  </label>
                  <div className="flex gap-1.5 mb-2">
                    <input
                      type="text"
                      placeholder="View name..."
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      className="px-2.5 py-1.5 rounded-md border text-xs bg-[var(--bg-secondary)] border-[var(--border)] flex-1 text-[var(--text-primary)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveView}
                      disabled={!newViewName.trim()}
                      className="px-3 py-1.5 rounded-md bg-[#12284C] text-white text-xs font-medium hover:bg-[#1B365D] disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save</span>
                    </button>
                  </div>
                  {savedViews.length > 0 && (
                    <div className="flex flex-col gap-1 max-h-36 overflow-y-auto border rounded-md border-[var(--border)] p-1.5 bg-[var(--bg-secondary)]">
                      {savedViews.map((v) => (
                        <div
                          key={v.id}
                          onClick={() => handleApplyView(v.filters)}
                          className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[var(--bg-card)] cursor-pointer text-xs"
                        >
                          <span className="font-medium text-[var(--text-primary)] truncate">{v.name}</span>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteView(v.id, e)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
