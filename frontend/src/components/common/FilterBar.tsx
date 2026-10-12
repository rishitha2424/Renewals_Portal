import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  GitCompare,
  Filter,
  RotateCcw,
  ChevronDown,
  X,
  Bookmark,
  Check,
  Save,
  Trash2,
} from 'lucide-react'
import { useAppStore, FilterSpec, DEFAULT_FILTER_SPEC } from '@/store/appStore'
import { getFilterOptions } from '@/api/client'

interface FilterBarProps {
  isPageOverride?: boolean
  localFilters?: FilterSpec
  onFiltersChange?: (filters: FilterSpec) => void
  onReset?: () => void
  className?: string
}

export default function FilterBar({
  isPageOverride = false,
  localFilters,
  onFiltersChange,
  onReset,
  className = '',
}: FilterBarProps) {
  const {
    globalFilters,
    setGlobalFilters,
    resetGlobalFilters,
    snapshots,
  } = useAppStore()

  // If localFilters is passed, we operate in page override mode; otherwise global
  const activeFilters = isPageOverride && localFilters ? localFilters : globalFilters
  const setFilters = (f: Partial<FilterSpec>) => {
    if (isPageOverride && onFiltersChange) {
      onFiltersChange({ ...activeFilters, ...f })
    } else {
      setGlobalFilters(f)
    }
  }

  const [moreOpen, setMoreOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [savedViews, setSavedViews] = useState<{ id: string; name: string; filters: FilterSpec }[]>([])
  const moreRef = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<HTMLDivElement>(null)

  // Fetch dynamic filter options from active snapshot
  const { data: filterOpts } = useQuery({
    queryKey: ['filter-options', activeFilters.as_of],
    queryFn: () => getFilterOptions(activeFilters.as_of ?? undefined),
    staleTime: 60_000,
  })

  // Load saved views from localStorage
  useEffect(() => {
    try {
      const v = localStorage.getItem('mobileum_saved_filter_views')
      if (v) setSavedViews(JSON.parse(v))
    } catch (e) {
      // ignore
    }
  }, [])

  // Close popovers on click outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
      if (viewsRef.current && !viewsRef.current.contains(e.target as Node)) {
        setViewsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const handleSaveView = () => {
    if (!newViewName.trim()) return
    const updated = [
      ...savedViews,
      { id: Date.now().toString(), name: newViewName.trim(), filters: { ...activeFilters } },
    ]
    setSavedViews(updated)
    localStorage.setItem('mobileum_saved_filter_views', JSON.stringify(updated))
    setNewViewName('')
  }

  const handleDeleteView = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = savedViews.filter((v) => v.id !== id)
    setSavedViews(updated)
    localStorage.setItem('mobileum_saved_filter_views', JSON.stringify(updated))
  }

  const handleApplyView = (viewFilters: FilterSpec) => {
    setFilters(viewFilters)
    setViewsOpen(false)
  }

  // Toggle helpers for multi-select
  const toggleArrayFilter = (
    field: 'regions' | 'business_units' | 'forecast_categories' | 'approval_statuses',
    value: string
  ) => {
    const current = activeFilters[field] || []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setFilters({ [field]: next } as any)
  }

  // Calculate chip representations for removable active filters
  const chips: { key: string; label: string; onRemove: () => void }[] = []

  if (activeFilters.period !== 'current_quarter') {
    const pLabel =
      filterOpts?.quarters?.find((q: any) => q.value === activeFilters.period)?.label ||
      activeFilters.period
    chips.push({
      key: `period-${activeFilters.period}`,
      label: `Period: ${pLabel}`,
      onRemove: () => setFilters({ period: 'current_quarter' }),
    })
  }

  if (activeFilters.sales_types.length > 0 && !(activeFilters.sales_types.length === 1 && activeFilters.sales_types[0] === 'Renewals')) {
    chips.push({
      key: 'sales_types',
      label: `Sales: ${activeFilters.sales_types.join(', ')}`,
      onRemove: () => setFilters({ sales_types: ['Renewals'] }),
    })
  }

  if (!activeFilters.include_deleted_lost) {
    chips.push({
      key: 'include_deleted_lost',
      label: 'Exclude Deleted/Lost',
      onRemove: () => setFilters({ include_deleted_lost: true }),
    })
  }

  activeFilters.regions?.forEach((r) => {
    chips.push({
      key: `region-${r}`,
      label: `Region: ${r}`,
      onRemove: () => toggleArrayFilter('regions', r),
    })
  })

  activeFilters.business_units?.forEach((bu) => {
    chips.push({
      key: `bu-${bu}`,
      label: `BU: ${bu}`,
      onRemove: () => toggleArrayFilter('business_units', bu),
    })
  })

  activeFilters.forecast_categories?.forEach((fc) => {
    chips.push({
      key: `fc-${fc}`,
      label: `Category: ${fc}`,
      onRemove: () => toggleArrayFilter('forecast_categories', fc),
    })
  })

  activeFilters.approval_statuses?.forEach((st) => {
    chips.push({
      key: `st-${st}`,
      label: `Approval: ${st}`,
      onRemove: () => toggleArrayFilter('approval_statuses', st),
    })
  })

  const hasActiveOverrides = chips.length > 0 || (isPageOverride && Boolean(localFilters))

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Top Filter Bar Controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Page Override Badge if applicable */}
        {isPageOverride && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            Page Override
          </span>
        )}

        {/* 1. Period Dropdown */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
          <span className="font-medium text-[var(--text-muted)]">Period:</span>
          <select
            value={activeFilters.period}
            onChange={(e) => setFilters({ period: e.target.value })}
            className="bg-transparent font-semibold text-[var(--text-primary)] outline-none cursor-pointer text-xs"
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

        {/* 2. Sales Type Dropdown */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm">
          <span className="font-medium text-[var(--text-muted)]">Sales:</span>
          <select
            value={activeFilters.sales_types.length === 1 ? activeFilters.sales_types[0] : 'all'}
            onChange={(e) => {
              const val = e.target.value
              setFilters({ sales_types: val === 'all' ? ['all'] : [val] })
            }}
            className="bg-transparent font-semibold text-[var(--text-primary)] outline-none cursor-pointer text-xs"
            id="filter-sales-type-select"
          >
            <option value="Renewals">Renewals</option>
            <option value="all">All Opportunities</option>
            {filterOpts?.sales_types?.filter((st: any) => st.key !== 'Renewals').map((st: any) => (
              <option key={st.key} value={st.key}>
                {st.label} ({st.count})
              </option>
            ))}
          </select>
        </div>

        {/* 3. Include Deleted & Lost Checkbox */}
        <label
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm cursor-pointer hover:bg-[var(--bg-card)] transition-colors select-none"
          title="Toggle inclusion of Deleted and Lost pipeline opportunities"
        >
          <input
            type="checkbox"
            checked={activeFilters.include_deleted_lost}
            onChange={(e) => setFilters({ include_deleted_lost: e.target.checked })}
            className="rounded border-[var(--border)] text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            id="filter-include-deleted-lost"
          />
          <span className="font-medium text-[var(--text-primary)]">Include Deleted & Lost</span>
        </label>

        {/* 4. "More Filters" Popover */}
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-semibold shadow-sm hover:bg-[var(--bg-card)] transition-colors"
            id="filter-more-btn"
          >
            <Filter className="w-3.5 h-3.5 text-teal-500" />
            <span>More Filters</span>
            {(activeFilters.regions.length > 0 ||
              activeFilters.business_units.length > 0 ||
              activeFilters.forecast_categories.length > 0 ||
              activeFilters.approval_statuses.length > 0) && (
              <span className="w-4 h-4 rounded-full bg-teal-500 text-white flex items-center justify-center text-[10px]">
                {activeFilters.regions.length +
                  activeFilters.business_units.length +
                  activeFilters.forecast_categories.length +
                  activeFilters.approval_statuses.length}
              </span>
            )}
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>

          {moreOpen && (
            <div className="absolute left-0 mt-2 w-80 md:w-96 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl p-4 z-50 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b pb-2 border-[var(--border)]">
                <span className="font-bold text-sm text-[var(--text-primary)]">Filter Dimensions</span>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Regions Multi-Select */}
              <div>
                <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                  Regions
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1 border rounded-xl border-[var(--border)] bg-[var(--bg-secondary)]">
                  {filterOpts?.regions?.map((r: any) => {
                    const sel = activeFilters.regions.includes(r.key)
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => toggleArrayFilter('regions', r.key)}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors ${
                          sel
                            ? 'bg-teal-500 text-white border-teal-600'
                            : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {r.label} ({r.count})
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Business Units Multi-Select */}
              <div>
                <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                  Business Units
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1 border rounded-xl border-[var(--border)] bg-[var(--bg-secondary)]">
                  {filterOpts?.business_units?.map((bu: any) => {
                    const sel = activeFilters.business_units.includes(bu.key)
                    return (
                      <button
                        key={bu.key}
                        type="button"
                        onClick={() => toggleArrayFilter('business_units', bu.key)}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors ${
                          sel
                            ? 'bg-teal-500 text-white border-teal-600'
                            : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {bu.label} ({bu.count})
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Forecast Categories (5 Canonical) */}
              <div>
                <label className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block mb-1.5">
                  Forecast Categories
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {filterOpts?.forecast_categories?.map((fc: any) => {
                    const sel = activeFilters.forecast_categories.includes(fc.key)
                    return (
                      <button
                        key={fc.key}
                        type="button"
                        onClick={() => toggleArrayFilter('forecast_categories', fc.key)}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors ${
                          sel
                            ? 'bg-teal-500 text-white border-teal-600'
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
                    const sel = activeFilters.approval_statuses.includes(st.key)
                    return (
                      <button
                        key={st.key}
                        type="button"
                        onClick={() => toggleArrayFilter('approval_statuses', st.key)}
                        className={`px-2 py-0.5 rounded-lg text-xs font-medium border transition-colors ${
                          sel
                            ? 'bg-teal-500 text-white border-teal-600'
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

        {/* 5. Saved Views Dropdown */}
        <div className="relative" ref={viewsRef}>
          <button
            type="button"
            onClick={() => setViewsOpen(!viewsOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] font-semibold shadow-sm hover:bg-[var(--bg-card)] transition-colors"
            id="filter-saved-views-btn"
          >
            <Bookmark className="w-3.5 h-3.5 text-teal-500" />
            <span>Saved Views</span>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
          </button>

          {viewsOpen && (
            <div className="absolute left-0 mt-2 w-64 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-3 z-50 flex flex-col gap-2">
              <span className="font-bold text-xs text-[var(--text-primary)]">Custom Filter Views</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="px-2 py-1 rounded-lg border text-xs bg-[var(--bg-secondary)] border-[var(--border)] flex-1 text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleSaveView}
                  disabled={!newViewName.trim()}
                  className="px-2 py-1 rounded-lg bg-teal-500 text-white text-xs font-semibold hover:bg-teal-600 disabled:opacity-50"
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
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer text-xs group"
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

        {/* 6. Reset Filters Button */}
        {hasActiveOverrides && (
          <button
            type="button"
            onClick={() => {
              if (isPageOverride && onReset) {
                onReset()
              } else {
                resetGlobalFilters()
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors font-semibold"
            id="filter-reset-btn"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Removable Chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20 font-medium"
            >
              <span>{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                className="hover:text-red-500 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
