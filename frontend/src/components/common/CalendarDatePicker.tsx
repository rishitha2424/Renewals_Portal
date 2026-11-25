import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Calendar as CalendarIcon,
  GitCompare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
} from 'lucide-react'
import { formatDateShort, formatDate } from '@/utils/format'

interface SnapshotItem {
  id: string
  snapshot_date: string
  label?: string
  is_active_today?: boolean
  yesterday_date?: string | null
}

interface CalendarDatePickerProps {
  mode?: 'date' | 'compare'
  label?: string
  valueId?: string | null
  valueDate?: string | null
  snapshots: SnapshotItem[]
  onChange: (snapshotId: string, snapshotDate: string) => void
  comparePreset?: string
  onPresetChange?: (preset: 'yesterday' | 'last_week' | 'last_month' | 'previous_upload') => void
  className?: string
  disabled?: boolean
}

export default function CalendarDatePicker({
  mode = 'date',
  label = mode === 'date' ? 'Data date' : 'Compare to',
  valueId,
  valueDate,
  snapshots,
  onChange,
  comparePreset,
  onPresetChange,
  className = '',
  disabled = false,
}: CalendarDatePickerProps) {
  const [open, setOpen] = useState(false)
  const [compareTab, setCompareTab] = useState<'presets' | 'calendar'>(comparePreset ? 'presets' : 'calendar')
  const containerRef = useRef<HTMLDivElement>(null)

  // Map of date strings -> SnapshotItem
  const dateToSnap = useMemo(() => {
    const map = new Map<string, SnapshotItem>()
    for (const s of snapshots) {
      if (s.snapshot_date) {
        map.set(s.snapshot_date, s)
      }
    }
    return map
  }, [snapshots])

  // Resolve current selected snapshot
  const selectedSnap = useMemo(() => {
    if (valueId) {
      return snapshots.find((s) => s.id === valueId) || snapshots[0]
    }
    if (valueDate) {
      return dateToSnap.get(valueDate) || snapshots[0]
    }
    return snapshots[0]
  }, [valueId, valueDate, snapshots, dateToSnap])

  // Resolved date string
  const currentIsoDate = selectedSnap?.snapshot_date || new Date().toISOString().split('T')[0]

  // Month navigation state
  const [navYear, setNavYear] = useState(() => {
    const d = new Date(currentIsoDate + 'T00:00:00')
    return isNaN(d.getFullYear()) ? new Date().getFullYear() : d.getFullYear()
  })
  const [navMonth, setNavMonth] = useState(() => {
    const d = new Date(currentIsoDate + 'T00:00:00')
    return isNaN(d.getMonth()) ? new Date().getMonth() : d.getMonth()
  })

  // Close on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutside)
    }
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  // Navigate months
  const prevMonth = () => {
    if (navMonth === 0) {
      setNavMonth(11)
      setNavYear(navYear - 1)
    } else {
      setNavMonth(navMonth - 1)
    }
  }

  const nextMonth = () => {
    if (navMonth === 11) {
      setNavMonth(0)
      setNavYear(navYear + 1)
    } else {
      setNavMonth(navMonth + 1)
    }
  }

  // Days in current month grid
  const daysInMonth = useMemo(() => {
    const year = navYear
    const month = navMonth
    const firstDayIndex = new Date(year, month, 1).getDay()
    const numDays = new Date(year, month + 1, 0).getDate()

    const days: Array<{ day: number; dateStr: string; hasSnap: boolean; snap?: SnapshotItem }> = []

    for (let d = 1; d <= numDays; d++) {
      const monthStr = String(month + 1).padStart(2, '0')
      const dayStr = String(d).padStart(2, '0')
      const dateStr = `${year}-${monthStr}-${dayStr}`
      const snap = dateToSnap.get(dateStr)
      days.push({
        day: d,
        dateStr,
        hasSnap: !!snap,
        snap,
      })
    }

    return { firstDayIndex, days }
  }, [navYear, navMonth, dateToSnap])

  const monthName = new Date(navYear, navMonth, 1).toLocaleDateString('en-US', { month: 'short' })

  // Button title / text
  const displayValue = useMemo(() => {
    if (selectedSnap) {
      return formatDate(selectedSnap.snapshot_date)
    }
    return 'Select date'
  }, [selectedSnap])

  const handleSelectDate = (snap: SnapshotItem) => {
    onChange(snap.id, snap.snapshot_date)
    setOpen(false)
  }

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-secondary)] text-xs transition-all shadow-xs cursor-pointer ${
          open ? 'ring-2 ring-teal-500/30 border-teal-500' : ''
        }`}
        title={`${label}: ${displayValue}`}
      >
        {mode === 'compare' ? (
          <GitCompare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
        ) : (
          <CalendarIcon className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
        )}
        <span className="text-[var(--text-muted)] font-medium hidden sm:inline">{label}:</span>
        <span className="font-bold text-[var(--text-primary)] max-w-[90px] truncate">{displayValue}</span>
      </button>

      {/* Popover Calendar */}
      {open && (
        <div className="absolute left-0 mt-2 w-72 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl z-50 p-3.5 space-y-3 animate-in fade-in zoom-in-95 duration-100">
          {/* Compare Presets vs Calendar Tabs */}
          {mode === 'compare' && (
            <div className="flex rounded-xl bg-[var(--bg-secondary)] p-1 border border-[var(--border)] text-xs">
              <button
                type="button"
                onClick={() => setCompareTab('presets')}
                className={`flex-1 py-1 rounded-lg font-semibold transition-all ${
                  compareTab === 'presets' ? 'bg-[#12284C] text-white shadow-xs' : 'text-[var(--text-muted)]'
                }`}
              >
                Presets
              </button>
              <button
                type="button"
                onClick={() => setCompareTab('calendar')}
                className={`flex-1 py-1 rounded-lg font-semibold transition-all ${
                  compareTab === 'calendar' ? 'bg-[#12284C] text-white shadow-xs' : 'text-[var(--text-muted)]'
                }`}
              >
                Calendar
              </button>
            </div>
          )}

          {mode === 'compare' && compareTab === 'presets' ? (
            /* Presets List */
            <div className="space-y-1 text-xs">
              {[
                { key: 'yesterday', title: 'Yesterday', desc: 'Working day baseline' },
                { key: 'last_week', title: 'Last week', desc: '7 days prior snapshot' },
                { key: 'last_month', title: 'Last month', desc: '30 days prior snapshot' },
                { key: 'previous_upload', title: 'Previous upload', desc: 'Most recent upload before active' },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    if (onPresetChange) onPresetChange(p.key as any)
                    setOpen(false)
                  }}
                  className={`w-full text-left p-2 rounded-xl flex items-center justify-between hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors ${
                    comparePreset === p.key ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 font-bold' : 'text-[var(--text-primary)]'
                  }`}
                >
                  <div>
                    <div className="font-semibold">{p.title}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{p.desc}</div>
                  </div>
                  {comparePreset === p.key && <Check className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
                </button>
              ))}
            </div>
          ) : (
            /* Calendar Grid */
            <>
              {/* Month / Year Navigator */}
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
                <span className="font-bold text-xs text-[var(--text-primary)]">
                  {monthName} {navYear}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={prevMonth}
                    className="p-1 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={nextMonth}
                    className="p-1 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Day Headers */}
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-[var(--text-muted)]">
                <span>Su</span>
                <span>Mo</span>
                <span>Tu</span>
                <span>We</span>
                <span>Th</span>
                <span>Fr</span>
                <span>Sa</span>
              </div>

              {/* Day Cells */}
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {/* Empty leading slots */}
                {Array.from({ length: daysInMonth.firstDayIndex }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="h-7" />
                ))}

                {/* Days */}
                {daysInMonth.days.map(({ day, dateStr, hasSnap, snap }) => {
                  const isSelected = selectedSnap?.snapshot_date === dateStr

                  if (!hasSnap || !snap) {
                    return (
                      <div
                        key={dateStr}
                        className="h-7 flex items-center justify-center text-[var(--text-muted)] opacity-25 cursor-not-allowed text-[11px]"
                        title="No upload on this date"
                      >
                        {day}
                      </div>
                    )
                  }

                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => handleSelectDate(snap)}
                      className={`h-7 w-7 mx-auto rounded-lg font-semibold flex items-center justify-center transition-all cursor-pointer text-[11px] ${
                        isSelected
                          ? 'bg-[#12284C] text-white shadow-xs'
                          : 'bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20 font-bold border border-teal-500/30'
                      }`}
                      title={`Upload: ${snap.label || dateStr}`}
                    >
                      {day}
                    </button>
                  )
                })}
              </div>

              {/* Footer Note */}
              <div className="pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-teal-500" />
                  <span>Uploaded snapshot dates</span>
                </span>
                {snapshots[0] && (
                  <button
                    type="button"
                    onClick={() => handleSelectDate(snapshots[0])}
                    className="text-teal-600 dark:text-teal-400 hover:underline font-semibold"
                  >
                    Latest ({formatDate(snapshots[0].snapshot_date)})
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
