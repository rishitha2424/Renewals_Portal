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
import FilterBar from '@/components/common/FilterBar'
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
    <header className="h-12 flex items-center justify-between px-4 border-b flex-shrink-0 bg-[var(--bg-card)] border-[var(--border)] z-20">
      {/* Left: Global Filter Bar */}
      <div className="flex items-center gap-3 flex-1">
        <FilterBar />

        {/* Search trigger */}
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden 2xl:flex items-center gap-2 px-2.5 py-1 rounded-sm text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors focus:outline-none"
          id="topbar-search-btn"
        >
          <Search className="w-3.5 h-3.5 text-[#00A3AD]" />
          <span>Search...</span>
          <kbd className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[var(--text-muted)]">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Date Pickers, Compare Selector, Download Menu, Theme Toggle */}
      <div className="flex items-center gap-2">
        {/* "View as of" Date Picker */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[var(--border)] bg-[var(--bg-secondary)] text-xs">
          <Calendar className="w-3.5 h-3.5 text-[#00A3AD] flex-shrink-0" />
          <span className="font-medium text-[var(--text-muted)] hidden md:inline text-[11px]">
            As of:
          </span>
          <select
            value={activeSnap?.id ?? ''}
            onChange={(e) => setActiveSnapshotId(e.target.value || null)}
            className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs"
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
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[var(--border)] bg-[var(--bg-secondary)] text-xs whitespace-nowrap" title={getCompareLabel()}>
          <GitCompare className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          <span className="font-medium text-[var(--text-muted)] hidden md:inline text-[11px]">
            vs:
          </span>
          <select
            value={compareSnapshotId ?? ''}
            onChange={(e) => setCompareSnapshotId(e.target.value || null)}
            className="bg-transparent font-medium text-[var(--text-primary)] outline-none cursor-pointer text-xs"
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
            <span className="text-[10px] text-[var(--text-muted)] font-medium hidden 2xl:inline ml-1">
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
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium bg-[#12284C] text-white hover:bg-[#1B365D] border border-transparent transition-colors focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
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
            <div className="absolute right-0 mt-1 w-60 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] shadow-lg p-1 z-50 divide-y divide-[var(--border)]">
              <div className="py-0.5">
                <button
                  type="button"
                  disabled={!!downloadingFormat}
                  onClick={() => handleDownload('pptx')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  id="topbar-download-pptx-btn"
                >
                  {downloadingFormat === 'pptx' ? (
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                  ) : (
                    <Presentation className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium flex items-center justify-between">
                      PowerPoint (.pptx)
                      {downloadingFormat === 'pptx' && (
                        <span className="text-[10px] text-amber-500">Generating...</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Daily update deck with pivots & charts
                    </p>
                  </div>
                </button>
              </div>

              <div className="py-0.5">
                <button
                  type="button"
                  disabled={!!downloadingFormat}
                  onClick={() => handleDownload('xlsx')}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  id="topbar-download-excel-btn"
                >
                  {downloadingFormat === 'xlsx' ? (
                    <Loader2 className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium flex items-center justify-between">
                      Excel (.xlsx)
                      {downloadingFormat === 'xlsx' && (
                        <span className="text-[10px] text-emerald-600">Generating...</span>
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

        {/* Admin Sign In (Addendum D) */}
        <AdminAuthModal />

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="w-8 h-8 rounded-sm flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border)] transition-colors focus:outline-none"
          id="topbar-theme-toggle"
          title={darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {darkMode ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-slate-600" />
          )}
        </button>
      </div>
    </header>
  )
}
