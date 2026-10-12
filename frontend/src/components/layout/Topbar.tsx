import React, { useEffect, useState, useRef } from 'react'
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
  Check,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { getSnapshots, downloadReport } from '@/api/client'
import { formatDate } from '@/utils/format'
import { showToast } from '@/components/ui/Toast'

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
    scope,
    setScope,
    includeDeletedLost,
    setIncludeDeletedLost,
  } = useAppStore()

  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)
  const downloadRef = useRef<HTMLDivElement>(null)

  const { data: fetchedSnapshots = [], isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: async () => {
      const res = await getSnapshots()
      setSnapshots(res)
      return res
    },
  })

  // Close download dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Auto-init active and compare snapshots if null or stale
  useEffect(() => {
    if (snapshots.length > 0) {
      const exists = snapshots.some((s: any) => s.id === activeSnapshotId)
      if (!activeSnapshotId || !exists) {
        const todaySnap = snapshots.find((s: any) => s.is_active_today) ?? snapshots[0]
        setActiveSnapshotId(todaySnap.id)
      }
      const compareExists = snapshots.some((s: any) => s.id === compareSnapshotId)
      if ((!compareSnapshotId || !compareExists) && snapshots.length > 1) {
        // Default compare to second snapshot (yesterday)
        setCompareSnapshotId(snapshots[1].id)
      }
    }
  }, [snapshots, activeSnapshotId, compareSnapshotId, setActiveSnapshotId, setCompareSnapshotId])

  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId) ?? snapshots[0]
  const compareSnap = snapshots.find((s: any) => s.id === compareSnapshotId)

  // Determine comparison label (e.g. "vs Fri 2 Oct")
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

  const handleDownload = async (type: 'pptx' | 'xlsx') => {
    if (downloadingFormat) return
    setDownloadingFormat(type)
    setDownloadOpen(false)
    try {
      const { filename } = await downloadReport(type, activeSnapshotId, compareSnapshotId)
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

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b flex-shrink-0 bg-[var(--bg-card)] border-[var(--border)] shadow-sm z-20">
      {/* Left: Mobileum Logo & Command Palette Quick Search */}
      <div className="flex items-center gap-4">


        {/* Global Scope Selector */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs shadow-sm">
          <span className="font-semibold text-teal-600 dark:text-teal-400">Scope:</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as any)}
            className="bg-transparent font-bold text-[var(--text-primary)] outline-none cursor-pointer text-xs"
            id="topbar-scope-select"
          >
            <option value="renewals">Renewals (Default)</option>
            <option value="all">All Opportunities</option>
            <option value="fy2026">Fiscal 2026</option>
            <option value="fy2027">Fiscal 2027</option>
            <option value="q4_2026">Fiscal Q4</option>
          </select>
        </div>

        {/* Include Deleted & Lost Checkbox */}
        <label
          className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none px-2 py-1 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors border border-transparent hover:border-[var(--border)]"
          title="Toggle inclusion of Deleted and Lost pipeline opportunities"
        >
          <input
            type="checkbox"
            checked={includeDeletedLost}
            onChange={(e) => setIncludeDeletedLost(e.target.checked)}
            className="rounded border-[var(--border)] text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            id="topbar-include-deleted-lost"
          />
          <span className="text-[11px] font-medium hidden lg:inline">Include Deleted & Lost</span>
          <span className="text-[11px] font-medium lg:hidden">Del/Lost</span>
        </label>

        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden xl:flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-all shadow-sm focus:outline-none"
          id="topbar-search-btn"
        >
          <Search className="w-3.5 h-3.5 text-teal-500" />
          <span>Search...</span>
          <kbd className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[var(--text-muted)]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Date Pickers, Compare Selector, Download Menu, Theme Toggle */}
      <div className="flex items-center gap-2.5">
        {/* "View as of" Date Picker */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-teal-500 flex-shrink-0" />
          <span className="font-medium text-[var(--text-muted)] hidden md:inline">
            As of:
          </span>
          <select
            value={activeSnap?.id ?? ''}
            onChange={(e) => setActiveSnapshotId(e.target.value || null)}
            className="bg-transparent font-semibold text-[var(--text-primary)] outline-none cursor-pointer text-xs"
            id="topbar-view-as-of-select"
          >
            {isLoading && <option>Loading dates...</option>}
            {snapshots.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.label} ({formatDate(s.snapshot_date)})
              </option>
            ))}
          </select>
        </div>

        {/* "Compare with" Selector */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs shadow-sm whitespace-nowrap" title={getCompareLabel()}>
          <GitCompare className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
          <span className="font-medium text-[var(--text-muted)] hidden md:inline">
            vs:
          </span>
          <select
            value={compareSnapshotId ?? ''}
            onChange={(e) => setCompareSnapshotId(e.target.value || null)}
            className="bg-transparent font-semibold text-[var(--text-primary)] outline-none cursor-pointer text-xs"
            id="topbar-compare-with-select"
          >
            {snapshots
              .filter((s: any) => s.id !== activeSnap?.id)
              .map((s: any) => {
                const isWorkingDayYesterday = activeSnap?.yesterday_date === s.snapshot_date
                return (
                  <option key={s.id} value={s.id}>
                    {s.label} ({formatDate(s.snapshot_date)}){isWorkingDayYesterday ? ' ⚡' : ''}
                  </option>
                )
              })}
          </select>
          {compareSnap && (
            <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium hidden 2xl:inline ml-1">
              ({getCompareLabel()})
            </span>
          )}
        </div>

        {/* Download Report Menu */}
        <div className="relative" ref={downloadRef}>
          <button
            type="button"
            disabled={!!downloadingFormat}
            onClick={() => setDownloadOpen(!downloadOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-teal-500 to-teal-600 text-white hover:from-teal-600 hover:to-teal-700 shadow-sm transition-all focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            id="topbar-download-btn"
          >
            {downloadingFormat ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">
              {downloadingFormat
                ? downloadingFormat === 'pptx'
                  ? 'Generating PPTX...'
                  : 'Generating Excel...'
                : 'Download report'}
            </span>
            <ChevronDown className="w-3 h-3 opacity-80" />
          </button>

          {downloadOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl p-1.5 z-50 divide-y divide-[var(--border-subtle)]">
              <div className="py-1">
                <button
                  type="button"
                  disabled={!!downloadingFormat}
                  onClick={() => handleDownload('pptx')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  id="topbar-download-pptx-btn"
                >
                  {downloadingFormat === 'pptx' ? (
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                  ) : (
                    <Presentation className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold flex items-center justify-between">
                      PowerPoint (.pptx)
                      {downloadingFormat === 'pptx' && (
                        <span className="text-[10px] text-amber-500 font-medium">Generating...</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Daily update deck with pivots & charts
                    </p>
                  </div>
                </button>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  disabled={!!downloadingFormat}
                  onClick={() => handleDownload('xlsx')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  id="topbar-download-excel-btn"
                >
                  {downloadingFormat === 'xlsx' ? (
                    <Loader2 className="w-4 h-4 text-emerald-500 animate-spin flex-shrink-0" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="font-semibold flex items-center justify-between">
                      Excel (.xlsx)
                      {downloadingFormat === 'xlsx' && (
                        <span className="text-[10px] text-emerald-500 font-medium">Generating...</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      10 sheets with formatted summaries
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>


        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border)] transition-all hover:scale-105 focus:outline-none shadow-sm"
          id="topbar-theme-toggle"
          title={darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {darkMode ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-indigo-600" />
          )}
        </button>
      </div>
    </header>
  )
}
