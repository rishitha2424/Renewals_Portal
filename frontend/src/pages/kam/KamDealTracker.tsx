import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Calendar,
  Clock,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'
import { getKamOverview } from '@/api/client'
import {
  formatCurrency,
  formatDate,
  formatACV,
  formatDealsCount,
  formatYearMonth,
  getApprovalStatusLabel,
} from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import KamPeriodBanner from '@/components/kam/KamPeriodBanner'
import DealListModal from '@/components/common/DealListModal'

export default function KamDealTracker() {
  const { currentUser } = useAuthStore()
  const { snapshots, activeSnapshotId, compareSnapshotId, globalFilters, setGlobalFilters } = useAppStore()
  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId)
  const compareSnap = snapshots.find((s: any) => s.id === compareSnapshotId)

  // Drawer & Modal State
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [modalDeals, setModalDeals] = useState<any[] | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')

  // Calendar toggle: 'close_date' | 'service_expiry'
  const [calendarGrouping, setCalendarGrouping] = useState<'close_date' | 'service_expiry'>('close_date')


  const typesStr = globalFilters.types?.length ? globalFilters.types.join(',') : undefined

  // Fetch data
  const { data, isLoading, error } = useQuery({
    queryKey: ['kam-overview', currentUser?.id, activeSnap?.snapshot_date, compareSnap?.snapshot_date, globalFilters.period, typesStr],
    queryFn: () => getKamOverview({
      as_of: activeSnap?.snapshot_date,
      compare: compareSnap?.snapshot_date,
      period: globalFilters.period,
      types: typesStr,
    }),
  })

  if (isLoading) {
    return (
      <div className="space-y-6 pb-16 w-full">
        <div className="h-8 w-64 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-[var(--bg-secondary)] rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error || !data || data.error) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Failed to load Deal Tracker</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          {(error as any)?.message || data?.error || 'Could not retrieve your renewal opportunity portfolio.'}
        </p>
      </div>
    )
  }

  const allDeals: any[] = data.deals || []
  const kpis = data.kpis || {}
  const whatChanged = data.what_changed || { has_changes: false, total_changes: 0 }
  const movements = data.movements || {}
  const compareDateFormatted = movements.compare_date_formatted || (compareSnap ? formatDate(compareSnap.snapshot_date) : 'previous')

  const openDeals = (title: string, deals: any[]) => {
    setModalTitle(title)
    setModalDeals(deals)
  }

  const openDrawer = (oppId: string) => {
    setSelectedOppId(oppId)
  }

  // 1. Summary Strip Stats
  const totalCount = allDeals.length
  const totalAcv = allDeals.reduce((sum, d) => sum + (parseFloat(d.forecast_acv_amount) || 0), 0)

  // Compute next close date and days to next close
  const referenceDateStr = activeSnap?.snapshot_date || new Date().toISOString().slice(0, 10)
  const refDate = new Date(referenceDateStr)

  const upcomingDealsWithClose = allDeals
    .filter((d) => d.close_date)
    .sort((a, b) => a.close_date.localeCompare(b.close_date))

  const nextUpcoming = upcomingDealsWithClose.find((d) => d.close_date >= referenceDateStr) || upcomingDealsWithClose[0]
  const nextCloseDate = nextUpcoming ? nextUpcoming.close_date : null

  let daysToNextClose: number | null = null
  if (nextCloseDate) {
    const target = new Date(nextCloseDate)
    const diffMs = target.getTime() - refDate.getTime()
    daysToNextClose = Math.round(diffMs / (1000 * 60 * 60 * 24))
  }

  // 2. Renewal Calendar Grouping
  const dateField = calendarGrouping === 'close_date' ? 'close_date' : 'service_expiry_date'
  const monthlyGroupsMap = new Map<string, {
    key: string
    label: string
    deals: any[]
    approvedAcv: number
    pendingAcv: number
    notSubmittedAcv: number
    negativeAcv: number
    totalPositiveAcv: number
  }>()

  allDeals.forEach((d) => {
    const rawDate = (d[dateField] || d['service_end_date'] || '').trim()
    const monthKey = (rawDate.length >= 7 && rawDate !== '00:00:00') ? rawDate.slice(0, 7) : 'Unscheduled'
    if (!monthlyGroupsMap.has(monthKey)) {
      monthlyGroupsMap.set(monthKey, {
        key: monthKey,
        label: formatYearMonth(monthKey),
        deals: [],
        approvedAcv: 0,
        pendingAcv: 0,
        notSubmittedAcv: 0,
        negativeAcv: 0,
        totalPositiveAcv: 0,
      })
    }
    const grp = monthlyGroupsMap.get(monthKey)!
    grp.deals.push(d)
    const amt = parseFloat(d.forecast_acv_amount) || 0
    const st = d.approval_status || 'Not submitted'
    if (amt < 0) {
      grp.negativeAcv += amt
    } else {
      grp.totalPositiveAcv += amt
      if (st === 'Approved' || st === 'Approved - 2nd') {
        grp.approvedAcv += amt
      } else if (st === 'Pending Approval') {
        grp.pendingAcv += amt
      } else {
        grp.notSubmittedAcv += amt
      }
    }
  })

  const sortedMonths = Array.from(monthlyGroupsMap.entries())
    .sort(([a], [b]) => (a === 'Unscheduled' ? 1 : b === 'Unscheduled' ? -1 : a.localeCompare(b)))
    .map(([, v]) => v)

  const unscheduledGroup = sortedMonths.find((m) => m.key === 'Unscheduled')

  const maxMonthAcv = Math.max(...sortedMonths.map((m) => m.totalPositiveAcv), 1)
  const maxNegativeAcv = Math.abs(Math.min(...sortedMonths.map((m) => m.negativeAcv), 0))
  const currentMonthKey = referenceDateStr.slice(0, 7)

  // 3. Closing Soon & Overdue Lists (Settings window or 30 days)
  const windowDays = 30
  const closingSoonDeals = allDeals.filter((d) => {
    if (!d.close_date) return false
    const dDate = new Date(d.close_date)
    const diff = Math.round((dDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))
    return diff >= 0 && diff <= windowDays
  }).sort((a, b) => a.close_date.localeCompare(b.close_date))

  const overdueDeals = allDeals.filter((d) => {
    if (!d.close_date) return false
    const dDate = new Date(d.close_date)
    const diff = Math.round((dDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))
    // Overdue: close_date is in the past and stage is not closed
    const stage = (d.stage_number || d.stage || '').toLowerCase()
    const isClosed = stage.includes('closed') || stage.includes('won') || stage.includes('lost')
    return diff < 0 && !isClosed
  }).sort((a, b) => a.close_date.localeCompare(b.close_date))

  // 4. Stage Progress Horizontal Stacked Bar
  const stageMap = new Map<string, { stage: string; count: number; acv: number; deals: any[] }>()
  allDeals.forEach((d) => {
    const st = (d.stage_number || d.stage || 'Unassigned').trim() || 'Unassigned'
    if (!stageMap.has(st)) {
      stageMap.set(st, { stage: st, count: 0, acv: 0, deals: [] })
    }
    const item = stageMap.get(st)!
    item.count += 1
    item.acv += (parseFloat(d.forecast_acv_amount) || 0)
    item.deals.push(d)
  })

  const stageList = Array.from(stageMap.values()).sort((a, b) => a.stage.localeCompare(b.stage))
  const stageTotalPositiveAcv = Math.max(stageList.reduce((sum, s) => sum + Math.max(s.acv, 0), 0), 1)

  const STAGE_PALETTE = ['#2563EB', '#00A3AD', '#4F46E5', '#0284C7', '#D97706', '#16A34A', '#64748B']

  return (
    <div className="space-y-6 pb-16 w-full">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Deal Tracker
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#12284C] text-white">
              {data.period || data.resolved_quarter || 'All open deals'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Follow renewal opportunities over time · Track closing milestones and portfolio changes for{' '}
            <span className="font-semibold text-[var(--text-primary)]">{data.owner_name}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/kam/deals"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm"
          >
            <span>Open Full Deal List ({totalCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Scope / Period Information Line (Round 30) */}
      <KamPeriodBanner
        periodInfo={data.period_info}
        defaultPeriod={data.period || data.resolved_quarter}
        fallbackCount={totalCount}
        fallbackAcv={totalAcv}
      />

      {/* Section A: Summary Strip (4 Compact Stats) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Stat 1: Deals in View */}
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            Deals in View
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {totalCount} <span className="text-xs font-normal text-[var(--text-muted)]">{totalCount === 1 ? 'deal' : 'deals'}</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
            {data.period || 'All open periods'}
          </div>
        </div>

        {/* Stat 2: ACV in View */}
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            ACV in View
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">
            {formatACV(totalAcv)}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">
            Exact: {formatCurrency(totalAcv)}
          </div>
        </div>

        {/* Stat 3: Next Closing Date */}
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            Next Closing Date
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {nextCloseDate ? formatDate(nextCloseDate) : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1 truncate">
            {nextUpcoming ? nextUpcoming.opportunity_name : 'No upcoming closes'}
          </div>
        </div>

        {/* Stat 4: Days to Next Close */}
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            Days to Next Close
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1 tabular-nums">
            {daysToNextClose != null ? (
              daysToNextClose < 0 ? (
                <span className="text-rose-600 dark:text-rose-400">{Math.abs(daysToNextClose)}d overdue</span>
              ) : daysToNextClose === 0 ? (
                <span className="text-amber-600 dark:text-amber-400">Today</span>
              ) : (
                <span>{daysToNextClose} <span className="text-xs font-normal text-[var(--text-muted)]">days</span></span>
              )
            ) : '—'}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-1">
            {daysToNextClose != null && daysToNextClose >= 0 ? `Target: ${formatDate(nextCloseDate)}` : 'Review overdue deals'}
          </div>
        </div>
      </div>

      {/* Section B: Renewal Calendar (Monthly Column Chart) */}
      {sortedMonths.length > 0 && (
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#00A3AD]" />
                <span>Renewal Calendar by Month</span>
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Monthly ACV distribution stacked by approval status. Click any column to inspect deals.
              </p>
            </div>

            {/* Toggle: By close date vs By service expiry */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs">
              <button
                type="button"
                onClick={() => setCalendarGrouping('close_date')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  calendarGrouping === 'close_date'
                    ? 'bg-[#12284C] text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                By close date
              </button>
              <button
                type="button"
                onClick={() => setCalendarGrouping('service_expiry')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  calendarGrouping === 'service_expiry'
                    ? 'bg-[#12284C] text-white shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                By service expiry
              </button>
            </div>
          </div>

          {calendarGrouping === 'service_expiry' && (
            <div className="px-3.5 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-700 dark:text-sky-300 font-medium">
              Service expiry = end date of the current (expiring) contract. The renewal period starts the next day.
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs pt-1 border-t border-[var(--border)]">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-[#16A34A]" />
              <span className="text-[var(--text-secondary)]">Approved (incl. 2nd)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-[#D97706]" />
              <span className="text-[var(--text-secondary)]">Pending Approval</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-[#64748B]" />
              <span className="text-[var(--text-secondary)]">Not submitted</span>
            </div>
            {maxNegativeAcv > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-rose-500" />
                <span className="text-[var(--text-secondary)]">Negative ACV</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 ml-auto text-[var(--text-muted)] text-[11px]">
              <span className="w-2 h-2 rounded-full bg-teal-500 inline-block" />
              <span>Current snapshot month</span>
            </div>
          </div>

          {/* Chart Columns Area */}
          <div className="overflow-x-auto min-w-0 pt-4 pb-2">
            <div className="flex items-end gap-3 min-w-full pb-2 h-64 border-b border-[var(--border)]">
              {sortedMonths.map((m) => {
                const isCurrent = m.key === currentMonthKey
                const totalPositive = m.totalPositiveAcv
                const approvedPct = maxMonthAcv > 0 ? (m.approvedAcv / maxMonthAcv) * 100 : 0
                const pendingPct = maxMonthAcv > 0 ? (m.pendingAcv / maxMonthAcv) * 100 : 0
                const notSubPct = maxMonthAcv > 0 ? (m.notSubmittedAcv / maxMonthAcv) * 100 : 0
                const negPct = maxMonthAcv > 0 ? (Math.abs(m.negativeAcv) / maxMonthAcv) * 100 : 0

                return (
                  <div
                    key={m.key}
                    onClick={() => openDeals(`${m.label} Renewal Deals (${m.deals.length})`, m.deals)}
                    className="flex-1 min-w-[72px] max-w-[120px] h-full flex flex-col justify-end items-center cursor-pointer group"
                  >
                    {/* Deal Count Badge above column */}
                    <div className="text-[10px] font-bold text-[var(--text-muted)] group-hover:text-teal-600 mb-1 transition-colors">
                      {m.deals.length} {m.deals.length === 1 ? 'deal' : 'deals'}
                    </div>

                    {/* Stacked Bar */}
                    <div className={`w-full max-w-[48px] rounded-t-md overflow-hidden flex flex-col-reverse justify-start transition-all group-hover:opacity-90 ${
                      isCurrent ? 'ring-2 ring-teal-500 ring-offset-2 ring-offset-[var(--bg-card)]' : ''
                    }`}>
                      {approvedPct > 0 && (
                        <div
                          style={{ height: `${Math.max(approvedPct * 1.8, 6)}px` }}
                          className="w-full bg-[#16A34A] transition-all"
                          title={`Approved: ${formatCurrency(m.approvedAcv)}`}
                        />
                      )}
                      {pendingPct > 0 && (
                        <div
                          style={{ height: `${Math.max(pendingPct * 1.8, 6)}px` }}
                          className="w-full bg-[#D97706] transition-all"
                          title={`Pending: ${formatCurrency(m.pendingAcv)}`}
                        />
                      )}
                      {notSubPct > 0 && (
                        <div
                          style={{ height: `${Math.max(notSubPct * 1.8, 6)}px` }}
                          className="w-full bg-[#64748B] transition-all"
                          title={`Not submitted: ${formatCurrency(m.notSubmittedAcv)}`}
                        />
                      )}
                      {totalPositive === 0 && (
                        <div className="w-full h-1 bg-[var(--border)]" />
                      )}
                    </div>

                    {/* Negative ACV bar below baseline if present */}
                    {negPct > 0 && (
                      <div
                        style={{ height: `${Math.max(negPct * 1.5, 4)}px` }}
                        className="w-full max-w-[48px] bg-rose-500 rounded-b-sm mt-0.5"
                        title={`Negative ACV: ${formatCurrency(m.negativeAcv)}`}
                      />
                    )}

                    {/* ACV Value label */}
                    <div className="text-[11px] font-bold text-[var(--text-primary)] mt-2 tabular-nums">
                      {formatACV(totalPositive + m.negativeAcv)}
                    </div>

                    {/* Month Label */}
                    <div className={`text-xs mt-0.5 truncate text-center ${
                      isCurrent ? 'font-bold text-teal-600 dark:text-teal-400' : 'text-[var(--text-secondary)]'
                    }`}>
                      {m.label}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Explanation note when deals have no date */}
          {unscheduledGroup && unscheduledGroup.deals.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  <strong className="font-semibold">{unscheduledGroup.deals.length} {unscheduledGroup.deals.length === 1 ? 'deal has' : 'deals have'}</strong> no {calendarGrouping === 'close_date' ? 'close date' : 'service expiry date'}.
                </span>
              </div>
              <button
                type="button"
                onClick={() => openDeals(`${calendarGrouping === 'close_date' ? 'Missing Close Date' : 'Missing Service Expiry Date'} Deals (${unscheduledGroup.deals.length})`, unscheduledGroup.deals)}
                className="font-bold underline hover:no-underline cursor-pointer text-amber-700 dark:text-amber-300"
              >
                View {unscheduledGroup.deals.length} {unscheduledGroup.deals.length === 1 ? 'deal' : 'deals'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Section C: Closing Soon and Overdue Side-by-Side */}
      {(closingSoonDeals.length > 0 || overdueDeals.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Closing Soon Card */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Closing Soon (Next {windowDays} Days)
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  {closingSoonDeals.length} {closingSoonDeals.length === 1 ? 'deal' : 'deals'}
                </span>
              </div>

              {closingSoonDeals.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-xl">
                  No deals scheduled to close within the next {windowDays} days.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto pr-1">
                  {closingSoonDeals.slice(0, 6).map((deal) => {
                    const dDate = new Date(deal.close_date)
                    const diffDays = Math.round((dDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24))
                    const amt = parseFloat(deal.forecast_acv_amount) || 0

                    return (
                      <div
                        key={deal.opportunity_id_18 || deal.id}
                        onClick={() => openDrawer(deal.opportunity_id_18 || deal.id)}
                        className="py-2.5 px-1 hover:bg-[var(--bg-secondary)] rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--text-primary)] truncate">
                            {deal.opportunity_name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1.5">
                            <span>{deal.account_name}</span>
                            <span>·</span>
                            <span>Close: {formatDate(deal.close_date)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {amt < 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400">
                              Negative ACV
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            deal.approval_status === 'Approved' || deal.approval_status === 'Approved - 2nd'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : deal.approval_status === 'Pending Approval'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                          }`}>
                            {getApprovalStatusLabel(deal.approval_status)}
                          </span>
                          <span className="font-bold tabular-nums text-[var(--text-primary)]">
                            {formatCurrency(amt)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            {diffDays === 0 ? 'Today' : `${diffDays}d left`}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {closingSoonDeals.length > 0 && (
              <button
                type="button"
                onClick={() => openDeals(`Closing Soon Deals (${closingSoonDeals.length})`, closingSoonDeals)}
                className="mt-3 text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
              >
                <span>View all ({closingSoonDeals.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Overdue Card */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                  <h3 className="text-base font-bold text-[var(--text-primary)]">
                    Overdue Deals (Past Close Date)
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  {overdueDeals.length} {overdueDeals.length === 1 ? 'deal' : 'deals'}
                </span>
              </div>

              {overdueDeals.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-xl">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-1 opacity-80" />
                  <span>No overdue open opportunities. All past deals are closed.</span>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto pr-1">
                  {overdueDeals.slice(0, 6).map((deal) => {
                    const dDate = new Date(deal.close_date)
                    const diffDays = Math.abs(Math.round((dDate.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24)))
                    const amt = parseFloat(deal.forecast_acv_amount) || 0

                    return (
                      <div
                        key={deal.opportunity_id_18 || deal.id}
                        onClick={() => openDrawer(deal.opportunity_id_18 || deal.id)}
                        className="py-2.5 px-1 hover:bg-[var(--bg-secondary)] rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[var(--text-primary)] truncate">
                            {deal.opportunity_name}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1.5">
                            <span>{deal.account_name}</span>
                            <span>·</span>
                            <span>Close: {formatDate(deal.close_date)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {amt < 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400">
                              Negative ACV
                            </span>
                          )}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            deal.approval_status === 'Approved' || deal.approval_status === 'Approved - 2nd'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : deal.approval_status === 'Pending Approval'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                          }`}>
                            {getApprovalStatusLabel(deal.approval_status)}
                          </span>
                          <span className="font-bold tabular-nums text-[var(--text-primary)]">
                            {formatCurrency(amt)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-300">
                            {diffDays}d overdue
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {overdueDeals.length > 0 && (
              <button
                type="button"
                onClick={() => openDeals(`Overdue Deals (${overdueDeals.length})`, overdueDeals)}
                className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
              >
                <span>View all ({overdueDeals.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Section C2: Upcoming Service Expiry (Hidden if none) */}
      {(data.upcoming_service_expiry || []).length > 0 && (
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-500" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                Upcoming Service Expiry (Next 60 Days)
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400">
              {data.upcoming_service_expiry.length} {data.upcoming_service_expiry.length === 1 ? 'deal' : 'deals'}
            </span>
          </div>

          <div className="px-3.5 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-700 dark:text-sky-300 font-medium">
            Service expiry = end date of the current (expiring) contract. The renewal period starts the next day.
          </div>

          <div className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto pr-1">
            {data.upcoming_service_expiry.slice(0, 8).map((item: any, i: number) => {
              const d = item.deal || item
              const amt = parseFloat(d.forecast_acv_amount) || 0
              return (
                <div
                  key={i}
                  onClick={() => openDrawer(d.opportunity_id_18 || d.id)}
                  className="py-2.5 px-1 hover:bg-[var(--bg-secondary)] rounded-lg cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[var(--text-primary)] truncate">
                      {d.opportunity_name}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1.5">
                      <span>{d.account_name}</span>
                      <span>·</span>
                      <span>Expires: {formatDate(item.service_expiry_date)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold tabular-nums text-[var(--text-primary)]">
                      {formatCurrency(amt)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300">
                      {item.days_label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Section D: What Changed Since Compare to Date (Hidden if no changes) */}
      {whatChanged.has_changes && (
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                What Changed Since {compareDateFormatted}
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {whatChanged.total_changes} {whatChanged.total_changes === 1 ? 'change' : 'changes'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* New Deals */}
            {(whatChanged.new_deals || []).length > 0 && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>New Deals Added</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-[10px] font-bold">
                    {whatChanged.new_deals.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {whatChanged.new_deals.map((nd: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => openDrawer(nd.id)}
                      className="p-2 rounded-lg bg-[var(--bg-card)] hover:border-emerald-500 border border-transparent cursor-pointer text-xs transition-colors"
                    >
                      <div className="font-semibold text-[var(--text-primary)] truncate">{nd.opportunity_name}</div>
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-1">
                        <span className="truncate">{nd.account_name}</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(nd.acv)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ACV Changes */}
            {(whatChanged.acv_changes || []).length > 0 && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-blue-600 dark:text-blue-400">
                  <span>ACV Changes</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 text-[10px] font-bold">
                    {whatChanged.acv_changes.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {whatChanged.acv_changes.map((ca: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => openDrawer(ca.id)}
                      className="p-2 rounded-lg bg-[var(--bg-card)] hover:border-blue-500 border border-transparent cursor-pointer text-xs transition-colors"
                    >
                      <div className="font-semibold text-[var(--text-primary)] truncate">{ca.opportunity_name}</div>
                      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-1">
                        <span>{formatCurrency(ca.old_acv)} → {formatCurrency(ca.new_acv)}</span>
                        <span className={`font-bold ${ca.diff_acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {ca.diff_acv >= 0 ? '+' : ''}{formatCurrency(ca.diff_acv)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stage Changes */}
            {(whatChanged.stage_changes || []).length > 0 && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <span>Stage Movements</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-[10px] font-bold">
                    {whatChanged.stage_changes.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {whatChanged.stage_changes.map((st: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => openDrawer(st.id)}
                      className="p-2 rounded-lg bg-[var(--bg-card)] hover:border-amber-500 border border-transparent cursor-pointer text-xs transition-colors"
                    >
                      <div className="font-semibold text-[var(--text-primary)] truncate">{st.opportunity_name}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        {st.old_stage} → <span className="font-semibold text-[var(--text-primary)]">{st.new_stage}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category Changes */}
            {(whatChanged.category_changes || []).length > 0 && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <span>Category Changes</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-purple-500/20 text-[10px] font-bold">
                    {whatChanged.category_changes.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {whatChanged.category_changes.map((cat: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => openDrawer(cat.id)}
                      className="p-2 rounded-lg bg-[var(--bg-card)] hover:border-purple-500 border border-transparent cursor-pointer text-xs transition-colors"
                    >
                      <div className="font-semibold text-[var(--text-primary)] truncate">{cat.opportunity_name}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        {cat.old_category} → <span className="font-semibold text-[var(--text-primary)]">{cat.new_category}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approval Changes */}
            {(whatChanged.approval_changes || []).length > 0 && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-teal-600 dark:text-teal-400">
                  <span>Approval Sign-offs</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-teal-500/20 text-[10px] font-bold">
                    {whatChanged.approval_changes.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {whatChanged.approval_changes.map((ap: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => openDrawer(ap.id)}
                      className="p-2 rounded-lg bg-[var(--bg-card)] hover:border-teal-500 border border-transparent cursor-pointer text-xs transition-colors"
                    >
                      <div className="font-semibold text-[var(--text-primary)] truncate">{ap.opportunity_name}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-1">
                        {ap.old_status || 'Not submitted'} → <span className="font-semibold text-emerald-600 dark:text-emerald-400">{ap.new_status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section E: Stage Progress (One Horizontal Stacked Bar) */}
      {stageList.length > 0 && (
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Stage Progress & Pipeline Velocity</span>
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Horizontal breakdown of deals by opportunity stage. Click any segment to view deals.
              </p>
            </div>
            <div className="text-xs font-bold text-[var(--text-primary)]">
              {stageList.length} active {stageList.length === 1 ? 'stage' : 'stages'}
            </div>
          </div>

          {/* Single Multi-Segment Horizontal Stacked Bar */}
          <div className="pt-6 pb-2">
            <div className="w-full overflow-x-auto min-w-0 pb-1">
              <div className="w-full min-w-[320px] h-9 rounded-xl overflow-visible flex bg-[var(--bg-secondary)] border border-[var(--border)] p-0.5 relative">
                {stageList.map((item, idx) => {
                  const color = STAGE_PALETTE[idx % STAGE_PALETTE.length]
                  const widthPct = (Math.max(item.acv, 0) / stageTotalPositiveAcv) * 100
                  const share = stageTotalPositiveAcv > 0 ? Math.round((Math.max(item.acv, 0) / stageTotalPositiveAcv) * 100) : 0
                  const isThin = widthPct < 8

                  return (
                    <div
                      key={item.stage}
                      data-stage-segment={item.stage}
                      onClick={() => openDeals(`Stage: ${item.stage} (${item.count})`, item.deals)}
                      style={{
                        flex: `${Math.max(item.acv, 1)} 1 ${Math.max(widthPct, 5)}%`,
                        minWidth: '40px',
                        backgroundColor: color,
                      }}
                      className="h-full relative group cursor-pointer hover:brightness-105 transition-all flex items-center justify-center rounded-[6px] mx-[1px]"
                      title={`${item.stage}: ${item.count} ${item.count === 1 ? 'deal' : 'deals'} · ${formatCurrency(item.acv)} (${share}%)`}
                    >
                      {/* Count on the bar (when wide enough) */}
                      {!isThin && (
                        <span data-stage-count={item.count} className="text-[11px] font-bold text-white drop-shadow-xs truncate px-1">
                          {item.count}
                        </span>
                      )}

                      {/* Small label directly above the bar when segment is thin */}
                      {isThin && (
                        <div
                          data-stage-label={item.stage}
                          className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
                        >
                          <span data-stage-count={item.count} className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] shadow-xs leading-tight whitespace-nowrap">
                            {item.count}
                          </span>
                          <span className="w-0.5 h-1 bg-[var(--border)]" />
                        </div>
                      )}

                      {/* Tooltip with stage name, deals, ACV and percentage */}
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-30 whitespace-nowrap">
                        <div className="px-2.5 py-1.5 rounded-lg bg-[#0F172A] text-white text-[11px] shadow-lg border border-slate-700/50 flex flex-col items-center gap-0.5">
                          <span className="font-semibold text-slate-100">{item.stage}</span>
                          <span className="text-slate-300 text-[10px]">
                            {item.count} {item.count === 1 ? 'deal' : 'deals'} · {formatCurrency(item.acv)} ({share}%)
                          </span>
                        </div>
                        <div className="w-1.5 h-1.5 bg-[#0F172A] rotate-45 -mt-1 border-r border-b border-slate-700/50" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Legend and stats below bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
            {stageList.map((item, idx) => {
              const color = STAGE_PALETTE[idx % STAGE_PALETTE.length]
              const share = stageTotalPositiveAcv > 0 ? Math.round((Math.max(item.acv, 0) / stageTotalPositiveAcv) * 100) : 0

              return (
                <button
                  key={item.stage}
                  type="button"
                  onClick={() => openDeals(`Stage: ${item.stage} (${item.count})`, item.deals)}
                  className="p-2.5 rounded-xl bg-[var(--bg-secondary)] hover:border-blue-500 border border-[var(--border)] text-left transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs font-semibold text-[var(--text-primary)] truncate group-hover:text-blue-600 transition-colors">
                      {item.stage}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-1.5">
                    <span>{item.count} {item.count === 1 ? 'deal' : 'deals'} ({share}%)</span>
                    <span className="font-bold text-[var(--text-primary)] tabular-nums">{formatACV(item.acv)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Section F: Link to Full Deal List */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs">
        <span className="text-[var(--text-secondary)]">
          Need detailed tabular analysis, column filtering, or inline notes?
        </span>
        <Link
          to="/kam/deals"
          className="inline-flex items-center gap-1.5 font-bold text-teal-600 dark:text-teal-400 hover:underline"
        >
          <span>Open Full Deal List</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Drill-down DealListModal */}
      {modalDeals && (
        <DealListModal
          title={modalTitle}
          deals={modalDeals}
          onSelectOpp={(id) => {
            setModalDeals(null)
            setSelectedOppId(id)
          }}
          onClose={() => setModalDeals(null)}
        />
      )}

      {/* Opportunity Detail Drawer */}
      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />
    </div>
  )
}

