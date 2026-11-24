import React, { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Download, FilterX, ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, Calendar, ArrowRight } from 'lucide-react'
import { getKamDeals } from '@/api/client'
import { formatCurrency, formatNumber, formatDate, getForecastCategoryLabel, getApprovalStatusLabel } from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import { getDealStage } from '@/components/common/DealListModal'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'

export default function KamDeals() {
  const { globalFilters, setGlobalFilters } = useAppStore()
  const { currentUser } = useAuthStore()
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterFC, setFilterFC] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterStage, setFilterStage] = useState('All')
  const [sortField, setSortField] = useState<string>('forecast_acv_amount')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    if (currentUser?.role === 'kam' && (!globalFilters.period || globalFilters.period === 'current_quarter')) {
      setGlobalFilters({ period: 'all_open' })
    }
  }, [currentUser?.role])

  const typesStr = globalFilters.types?.length ? globalFilters.types.join(',') : undefined

  const { data, isLoading } = useQuery({
    queryKey: ['kam-deals', currentUser?.id, globalFilters.period, globalFilters.as_of, typesStr],
    queryFn: async () => {
      return await getKamDeals({
        period: globalFilters.period,
        as_of: globalFilters.as_of,
        types: typesStr,
      })
    },
  })

  const rawDeals = data?.deals || []

  // Dynamic filter options
  const stageOptions = useMemo(() => {
    const s = new Set<string>()
    rawDeals.forEach((d: any) => {
      const st = getDealStage(d)
      if (st) s.add(st)
    })
    return ['All', ...Array.from(s)].sort()
  }, [rawDeals])

  const statusOptions = useMemo(() => {
    const s = new Set<string>()
    rawDeals.forEach((d: any) => {
      if (d.approval_status) s.add(d.approval_status)
    })
    return ['All', ...Array.from(s)].sort()
  }, [rawDeals])

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const filteredDeals = useMemo(() => {
    let result = rawDeals.filter((d: any) => {
      if (filterFC !== 'All' && d.forecast_category !== filterFC && getForecastCategoryLabel(d.forecast_category) !== filterFC) {
        return false
      }
      if (filterStatus !== 'All' && d.approval_status !== filterStatus && getApprovalStatusLabel(d.approval_status) !== filterStatus) {
        return false
      }
      if (filterStage !== 'All' && getDealStage(d) !== filterStage) {
        return false
      }
      if (search) {
        const q = search.toLowerCase()
        const name = (d.opportunity_name || '').toLowerCase()
        const acc = (d.account_name || '').toLowerCase()
        const id = (d.opportunity_id_18 || '').toLowerCase()
        if (!name.includes(q) && !acc.includes(q) && !id.includes(q)) {
          return false
        }
      }
      return true
    })

    if (sortField) {
      result.sort((a: any, b: any) => {
        let valA = a[sortField] ?? ''
        let valB = b[sortField] ?? ''
        if (sortField === 'stage') {
          valA = getDealStage(a)
          valB = getDealStage(b)
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDir === 'asc' ? valA - valB : valB - valA
        }
        return sortDir === 'asc'
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA))
      })
    }

    return result
  }, [rawDeals, search, filterFC, filterStatus, filterStage, sortField, sortDir])

  const totalAcv = filteredDeals.reduce((sum: number, d: any) => sum + (d.forecast_acv_amount || 0), 0)

  const handleExport = () => {
    const headers = ['Opportunity ID', 'Opportunity Name', 'Account', 'Forecast Category', 'Approval Status', 'ACV', 'Close Date', 'Stage', 'BU']
    const csvContent = [
      headers.join(','),
      ...filteredDeals.map((d: any) => [
        `"${d.opportunity_id_18 || ''}"`,
        `"${(d.opportunity_name || '').replace(/"/g, '""')}"`,
        `"${(d.account_name || '').replace(/"/g, '""')}"`,
        `"${d.forecast_category || ''}"`,
        `"${d.approval_status || ''}"`,
        d.forecast_acv_amount || 0,
        `"${d.close_date || ''}"`,
        `"${getDealStage(d).replace(/"/g, '""')}"`,
        `"${d.business_unit_primary || d.business_unit || ''}"`,
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `my_deals_${new Date().toISOString().slice(0, 10)}.csv`)
    link.click()
  }

  const hasActiveFilters = filterFC !== 'All' || filterStatus !== 'All' || filterStage !== 'All' || search !== ''

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            My Opportunities
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Showing {formatNumber(filteredDeals.length)} deals · <span className="font-semibold text-[var(--text-primary)] tabular-nums">{formatCurrency(totalAcv)}</span>
          </p>
        </div>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all shadow-sm self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Scope / Period Information Line (Round 24) */}
      {(() => {
        const pInfo = data?.period_info
        const count = pInfo?.showing_count ?? filteredDeals.length ?? 0
        const acv = pInfo?.showing_acv ?? totalAcv ?? 0
        const periodLbl = pInfo?.period_label || data?.period || globalFilters.period || 'current period'
        const otherCount = pInfo?.other_periods_count ?? 0
        const otherAcv = pInfo?.other_periods_acv ?? 0

        return (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#00A3AD] shrink-0" />
              <span>
                Showing <strong className="text-[var(--text-primary)] font-bold">{count} deals ({formatCurrency(acv)})</strong> for <strong>{periodLbl}</strong>.
                {otherCount > 0 ? (
                  <>
                    {' '}<span className="text-[var(--text-muted)]">{otherCount} more deals ({formatCurrency(otherAcv)}) in other periods.</span>
                  </>
                ) : (
                  <>
                    {' '}<span className="text-emerald-600 dark:text-emerald-400 font-medium">All active renewal deals are currently displayed.</span>
                  </>
                )}
              </span>
            </div>
            {otherCount > 0 && (
              <button
                type="button"
                onClick={() => setGlobalFilters({ period: 'all_open' })}
                className="font-semibold text-[#00A3AD] hover:underline cursor-pointer flex items-center gap-1 shrink-0"
              >
                <span>Switch to All open deals ({pInfo?.total_all_count || count + otherCount})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      })()}

      {/* Filter Bar */}
      <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-wrap items-center gap-2.5 shadow-sm">
        <div className="relative flex-grow min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search opportunity name or account..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-colors"
          />
        </div>

        <select
          value={filterFC}
          onChange={(e) => setFilterFC(e.target.value)}
          className="text-xs py-1.5 px-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer"
        >
          <option value="All">All Categories</option>
          <option value="Closed">Closed</option>
          <option value="Commit">Commit</option>
          <option value="Best Case">Best Case</option>
          <option value="Pipeline">Pipeline</option>
          <option value="Not yet proposed">Not yet proposed</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-xs py-1.5 px-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer"
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s === 'All' ? 'All Statuses' : getApprovalStatusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="text-xs py-1.5 px-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer"
        >
          {stageOptions.map((st) => (
            <option key={st} value={st}>
              {st === 'All' ? 'All Stages' : st}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={() => {
              setFilterFC('All')
              setFilterStatus('All')
              setFilterStage('All')
              setSearch('')
            }}
            className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium hover:underline ml-auto"
          >
            <FilterX className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      {/* Deals Table */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="py-16 text-center text-xs text-[var(--text-muted)]">
            <p className="font-semibold text-sm text-[var(--text-primary)] mb-1">No deals found</p>
            <p>Try adjusting your search query or filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
                <tr>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => handleSort('opportunity_name')}
                  >
                    <div className="flex items-center gap-1">
                      Opportunity
                      {sortField === 'opportunity_name' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="px-4 py-3">Account</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => handleSort('forecast_acv_amount')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      ACV
                      {sortField === 'forecast_acv_amount' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => handleSort('stage')}
                  >
                    <div className="flex items-center gap-1">
                      Stage
                      {sortField === 'stage' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center">Category</th>
                  <th className="px-4 py-3 text-center">Approval</th>
                  <th
                    className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)]"
                    onClick={() => handleSort('close_date')}
                  >
                    <div className="flex items-center gap-1">
                      Close Date
                      {sortField === 'close_date' && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="px-4 py-3">BU</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredDeals.map((d: any) => (
                  <tr
                    key={d.opportunity_id_18}
                    onClick={() => setSelectedOppId(d.opportunity_id_18)}
                    className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--text-primary)] max-w-xs truncate" title={d.opportunity_name}>
                        {d.opportunity_name}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-mono">{d.opportunity_id_18}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] max-w-[150px] truncate" title={d.account_name}>
                      {d.account_name}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--text-primary)] tabular-nums">
                      {formatCurrency(d.forecast_acv_amount)}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {getDealStage(d) || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold"
                        style={{
                          backgroundColor: `${FORECAST_COLORS[d.forecast_category as keyof typeof FORECAST_COLORS] || '#cbd5e1'}20`,
                          color: FORECAST_COLORS[d.forecast_category as keyof typeof FORECAST_COLORS] || '#64748b'
                        }}
                      >
                        {getForecastCategoryLabel(d.forecast_category)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold ${
                        d.approval_status === 'Approved'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }`}>
                        {getApprovalStatusLabel(d.approval_status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-secondary)]">
                      {formatDate(d.close_date)}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-[11px]">
                      {d.business_unit_primary || d.business_unit || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Opportunity Detail Drawer */}
      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />
    </div>
  )
}

