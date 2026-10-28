import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  History,
  Download,
  Search,
  Calendar,
  User,
  Filter,
  RotateCcw,
  Loader2,
} from 'lucide-react'
import { getGlobalAuditLog, downloadGlobalAuditLog, AnnotationAuditItem } from '@/api/client'
import showToast from '@/components/ui/Toast'

interface ChangeLogModalProps {
  isOpen: boolean
  onClose: () => void
}

export const ChangeLogModal: React.FC<ChangeLogModalProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<AnnotationAuditItem[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterColumn, setFilterColumn] = useState('')
  const [filterDeal, setFilterDeal] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  const fetchLog = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getGlobalAuditLog({
        user: filterUser.trim() || undefined,
        column: filterColumn.trim() || undefined,
        deal: filterDeal.trim() || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined,
        limit: 500,
      })
      setEntries(res.audit || [])
    } catch {
      showToast.error('Failed to load change log')
    } finally {
      setLoading(false)
    }
  }, [filterUser, filterColumn, filterDeal, filterDateFrom, filterDateTo])

  useEffect(() => {
    if (isOpen) {
      fetchLog()
    }
  }, [isOpen, fetchLog])

  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const { data, filename } = await downloadGlobalAuditLog({
        user: filterUser.trim() || undefined,
        column: filterColumn.trim() || undefined,
        deal: filterDeal.trim() || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined,
      })
      const blob = new Blob([data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename || 'change_log.csv')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showToast.success('Downloaded change log CSV')
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const handleClearFilters = () => {
    setFilterUser('')
    setFilterColumn('')
    setFilterDeal('')
    setFilterDateFrom('')
    setFilterDateTo('')
  }

  const formatTimestamp = (utcStr?: string) => {
    if (!utcStr) return '—'
    try {
      const d = new Date(utcStr)
      if (isNaN(d.getTime())) return utcStr
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return utcStr
    }
  }

  const getActionBadgeClass = (action: string) => {
    const act = (action || '').toLowerCase()
    if (act.includes('added') || act.includes('restored')) {
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
    }
    if (act.includes('deleted') || act.includes('cleared')) {
      return 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
    }
    if (act.includes('renamed') || act.includes('moved') || act.includes('edited')) {
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
    }
    return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }

  if (!isOpen) return null

  const hasActiveFilters = Boolean(
    filterUser || filterColumn || filterDeal || filterDateFrom || filterDateTo
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Admin Change Log
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Audited history of custom columns and deal value edits. Times shown in your browser's local timezone.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || entries.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50 transition-colors"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download CSV
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-4 bg-slate-50/60 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
            {/* User Filter */}
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Filter by user..."
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Column Filter */}
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Filter by column..."
                value={filterColumn}
                onChange={(e) => setFilterColumn(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Deal Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Deal, account or opp..."
                value={filterDeal}
                onChange={(e) => setFilterDeal(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Date From */}
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="date"
                title="Date From"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* Date To */}
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="date"
                title="Date To"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 dark:border-slate-700 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {entries.length} audit {entries.length === 1 ? 'record' : 'records'} (newest first)
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-600 font-medium"
              >
                <RotateCcw className="w-3 h-3" />
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Change Log Table */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-slate-500 text-xs">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              Loading change log...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
              No change log records matching criteria.
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      Date & Time (Local)
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      User
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      Action
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      Deal (Account & Name)
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      Column
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      Old Value
                    </th>
                    <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                      New Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map((entry) => {
                    const acc = (entry as any).account_name
                    const opp = (entry as any).opportunity_name
                    const colLabel = (entry as any).column_label || entry.column_key || '—'
                    const dealLabel = acc && opp ? `${acc} — ${opp}` : entry.opportunity_id_18 || '—'

                    return (
                      <tr
                        key={entry.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400 whitespace-nowrap font-mono text-[11px]">
                          {formatTimestamp(entry.timestamp || (entry as any).created_at)}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {entry.user_id || entry.changed_by || 'admin'}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${getActionBadgeClass(
                              entry.action
                            )}`}
                          >
                            {entry.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 max-w-xs truncate text-slate-700 dark:text-slate-300" title={dealLabel}>
                          {dealLabel}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {colLabel}
                        </td>
                        <td className="py-2 px-3 max-w-[140px] truncate text-slate-400 italic" title={entry.old_value || 'None'}>
                          {entry.old_value || '—'}
                        </td>
                        <td className="py-2 px-3 max-w-[160px] truncate text-slate-900 dark:text-slate-100 font-medium" title={entry.new_value || 'None'}>
                          {entry.new_value || '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChangeLogModal
