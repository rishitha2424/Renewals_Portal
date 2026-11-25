import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Calendar,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Flame,
  Globe,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react'
import { getKamOverview } from '@/api/client'
import {
  formatCurrency,
  formatDate,
  getForecastCategoryLabel,
  getApprovalStatusLabel,
  formatACV,
  formatDealsCount,
} from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import DealListModal from '@/components/common/DealListModal'
import ChartCard, { ChartDatum } from '@/components/common/ChartCard'
import { Tile } from '@/components/common/Tile'

export default function KamOverview() {
  const { currentUser } = useAuthStore()
  const { snapshots, activeSnapshotId, compareSnapshotId, globalFilters, setGlobalFilters } = useAppStore()
  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId)
  const compareSnap = snapshots.find((s: any) => s.id === compareSnapshotId)

  // Drawer & Modal State
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [modalDeals, setModalDeals] = useState<any[] | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')
  const [activeActionTab, setActiveActionTab] = useState<'immediate' | 'delayed' | 'not_submitted' | 'slippage' | 'needs_review'>('immediate')

  // Auto-set KAM default period to "all_open"
  useEffect(() => {
    if (currentUser?.role === 'kam' && (!globalFilters.period || globalFilters.period === 'current_quarter')) {
      setGlobalFilters({ period: 'all_open' })
    }
  }, [currentUser?.role])

  const typesStr = globalFilters.types?.length ? globalFilters.types.join(',') : undefined

  // Fetch overview data
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-[var(--bg-secondary)] rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error || !data || data.error) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Failed to load KAM overview</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          {(error as any)?.message || data?.error || 'Could not retrieve your renewal opportunity portfolio.'}
        </p>
      </div>
    )
  }

  const kpis = data.kpis || {
    total_acv: 0,
    total_count: 0,
    commit_coverage_acv: 0,
    commit_coverage_count: 0,
    commit_acv: 0,
    commit_count: 0,
    closed_acv: 0,
    closed_count: 0,
    best_case_acv: 0,
    best_case_count: 0,
    pipeline_acv: 0,
    pipeline_count: 0,
    approved_acv: 0,
    approved_count: 0,
    approved_2nd_count: 0,
    approved_2nd_acv: 0,
    approved_2nd_breakdown: null,
    pending_approval_acv: 0,
    pending_approval_count: 0,
    not_submitted_acv: 0,
    not_submitted_count: 0,
    delayed_acv: 0,
    delayed_count: 0,
    slippage_acv: 0,
    slippage_count: 0,
    needs_review_acv: 0,
    needs_review_count: 0,
    unread_messages: 0,
  }

  const allDeals = data.deals || []
  const movements = data.movements || {}
  const deltaCompare = movements.delta_compare || { count: 0, acv: 0.0, available: false, label: 'n/a' }
  const deltaY = movements.delta_yesterday || { count: 0, acv: 0.0, available: false, label: 'n/a' }
  const deltaW = movements.delta_lastweek || { count: 0, acv: 0.0, available: false, label: 'n/a' }
  const compareDateFormatted = movements.compare_date_formatted || (compareSnap ? formatDate(compareSnap.snapshot_date) : 'previous')

  const regionLine = data.region_line || { single_region: false, summary_sentence: '', regions: [] }
  const charts = data.charts || {}
  const actionLists = data.action_lists || {}
  const insightCards = data.insight_cards || []
  const periodInfo = data.period_info || {}

  const openDeals = (title: string, deals: any[]) => {
    setModalTitle(title)
    setModalDeals(deals)
  }

  const openDrawer = (oppId: string) => {
    setSelectedOppId(oppId)
  }

  // Filter deals for quick clicks
  const getDealsByForecast = (cat: string) => allDeals.filter((d: any) => d.forecast_category === cat)
  const getDealsByApproval = (st: string) => {
    if (st === 'Approved') {
      return allDeals.filter((d: any) => d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd')
    }
    return allDeals.filter((d: any) => (d.approval_status || 'Not submitted') === st)
  }

  // Chart 1: Forecast Category Split
  const forecastChartData: ChartDatum[] = (charts.forecast_category || []).map((c: any) => {
    const deals = c.deals || getDealsByForecast(c.category)
    return {
      label: getForecastCategoryLabel(c.category),
      value: c.acv,
      formattedValue: formatACV(c.acv),
      dealsCount: c.count,
      color: FORECAST_COLORS[c.category as keyof typeof FORECAST_COLORS] || '#64748B',
      onClick: () => openDeals(`${getForecastCategoryLabel(c.category)} Deals (${c.count})`, deals),
    }
  })

  // Chart 2: Approval Status Distribution
  const approvalChartData: ChartDatum[] = (charts.approval_status || []).map((s: any) => {
    const deals = s.deals || getDealsByApproval(s.status)
    const color = s.status === 'Approved' ? '#16A34A' : s.status === 'Pending Approval' ? '#D97706' : '#64748B'
    const footnote = (s.status === 'Approved' && s.approved_2nd_count > 0)
      ? `incl. ${s.approved_2nd_count} Approved 2nd`
      : undefined
    return {
      label: getApprovalStatusLabel(s.status),
      value: s.acv,
      formattedValue: formatACV(s.acv),
      dealsCount: s.count,
      color,
      footnote,
      onClick: () => openDeals(`${getApprovalStatusLabel(s.status)} Deals (${s.count})`, deals),
    }
  })

  // Chart 3: Business Units
  const buChartData: ChartDatum[] = (charts.business_units || []).map((b: any) => ({
    label: b.business_unit || b.bu || 'Unassigned',
    value: b.acv,
    formattedValue: formatACV(b.acv),
    dealsCount: b.count,
    onClick: () => openDeals(`BU: ${b.business_unit || b.bu} (${b.count})`, b.deals || []),
  }))

  // Chart 4: Top Accounts
  const accountsChartData: ChartDatum[] = (charts.top_accounts || []).map((a: any) => ({
    label: a.account_name,
    value: a.acv,
    formattedValue: formatACV(a.acv),
    dealsCount: a.count,
    onClick: () => openDeals(`Account: ${a.account_name} (${a.count})`, a.deals || []),
  }))

  const coveragePct = kpis.total_acv > 0
    ? Math.round((kpis.commit_coverage_acv / kpis.total_acv) * 100)
    : 0

  // Action Center Filtered List (Excludes Closed Deals)
  const isDealClosedCheck = (d: any) => {
    const fc = (d.forecast_category || '').toLowerCase()
    const st = (d.stage_number || d.stage || '').toLowerCase()
    return fc === 'closed' || st.includes('closed') || st.includes('won') || st.includes('lost') || st.includes('delete')
  }

  const immediateDeals = (actionLists.immediate_attention || []).filter((d: any) => !isDealClosedCheck(d))
  const delayedDeals = actionLists.delayed_deals || []
  const notSubmittedDeals = (actionLists.not_submitted_deals || []).filter((d: any) => !isDealClosedCheck(d))
  const slippageDeals = actionLists.slippage_deals || []
  const needsReviewDeals = actionLists.needs_review_deals || actionLists.missing_service_dates || []

  const availableActionTabs = [
    { key: 'immediate', label: 'Immediate attention', count: immediateDeals.length, deals: immediateDeals },
    { key: 'delayed', label: 'Delayed renewals', count: delayedDeals.length, deals: delayedDeals },
    { key: 'not_submitted', label: 'Not submitted', count: notSubmittedDeals.length, deals: notSubmittedDeals },
    { key: 'slippage', label: 'Slippage', count: slippageDeals.length, deals: slippageDeals },
    { key: 'needs_review', label: 'Needs review', count: needsReviewDeals.length, deals: needsReviewDeals },
  ].filter((tab) => tab.count > 0)

  // Auto-select valid tab if current has 0
  const currentActionList = (() => {
    const found = availableActionTabs.find((t) => t.key === activeActionTab)
    if (found) return found.deals
    return availableActionTabs[0]?.deals || []
  })()

  const countShowing = periodInfo.showing_count ?? kpis.total_count ?? 0
  const acvShowing = periodInfo.showing_acv ?? kpis.total_acv ?? 0
  const periodLabel = periodInfo.period_label || data.resolved_quarter || globalFilters.period || 'current period'
  const otherCount = periodInfo.other_periods_count ?? 0
  const otherAcv = periodInfo.other_periods_acv ?? 0

  return (
    <div className="space-y-6 pb-16 w-full">
      {/* 1. Page Header (First-Edition Design) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              My Portfolio Overview
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#12284C] text-white">
              {data.period || data.resolved_quarter || 'All open deals'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Logged in as <span className="font-semibold text-[var(--text-primary)]">{currentUser?.name}</span> ({data.owner_name || currentUser?.owner_name || 'Opportunity Owner'}) · Snapshot: {formatDate(data.as_of)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/kam/deals"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm"
          >
            <span>View All My Deals ({kpis.total_count})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to="/messages"
            className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Messages</span>
            {kpis.unread_messages > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-teal-500 text-white">
                {kpis.unread_messages}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* 2. Scope / Period Information Line */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#00A3AD] shrink-0" />
          <span>
            Showing <strong className="text-[var(--text-primary)] font-bold">{countShowing} {countShowing === 1 ? 'deal' : 'deals'} ({formatCurrency(acvShowing)})</strong> for <strong>{periodLabel}</strong>.
            {otherCount > 0 ? (
              <>
                {' '}<span className="text-[var(--text-muted)]">{otherCount} more {otherCount === 1 ? 'deal' : 'deals'} ({formatCurrency(otherAcv)}) in other periods.</span>
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
            <span>Switch to All open deals ({periodInfo.total_all_count || countShowing + otherCount})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* 2b. Renewal Progress Slim Strip */}
      {data.renewal_progress && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="font-semibold text-[var(--text-primary)]">
              {data.renewal_progress.summary_sentence}
            </span>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-64">
            <div className="flex-1 h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, data.renewal_progress.closed_pct || 0))}%` }}
              />
            </div>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
              {data.renewal_progress.closed_pct}%
            </span>
          </div>
        </div>
      )}

      {/* 3. Movements & Changes Banner (vs Yesterday, vs Last Week, vs Compare to Date) */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-[var(--text-primary)]">Movements & Changes</div>
            <div className="text-[11px] text-[var(--text-muted)]">Portfolio changes compared to previous snapshots</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-medium">vs {compareDateFormatted}:</span>
            {deltaCompare.available ? (
              <span className={`font-semibold tabular-nums ${deltaCompare.acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {deltaCompare.label}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">n/a</span>
            )}
          </div>
          <div className="hidden sm:block h-4 w-px bg-[var(--border)]" />
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-medium">vs Yesterday:</span>
            {deltaY.available ? (
              <span className={`font-semibold tabular-nums ${deltaY.acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {deltaY.label || `${deltaY.acv >= 0 ? '+' : ''}${formatCurrency(deltaY.acv)} (${deltaY.count >= 0 ? '+' : ''}${deltaY.count} ${Math.abs(deltaY.count) === 1 ? 'deal' : 'deals'})`}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">n/a</span>
            )}
          </div>
          <div className="hidden sm:block h-4 w-px bg-[var(--border)]" />
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-medium">vs Last Week:</span>
            {deltaW.available ? (
              <span className={`font-semibold tabular-nums ${deltaW.acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {deltaW.label || `${deltaW.acv >= 0 ? '+' : ''}${formatCurrency(deltaW.acv)} (${deltaW.count >= 0 ? '+' : ''}${deltaW.count} ${Math.abs(deltaW.count) === 1 ? 'deal' : 'deals'})`}
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">n/a</span>
            )}
          </div>
        </div>
      </div>

      {/* 4. 3 Plain Language Insight Cards (Teal Left Borders) */}
      {insightCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {insightCards.slice(0, 3).map((text: string, idx: number) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl bg-gradient-to-r from-teal-500/5 via-transparent to-transparent border-l-4 border-teal-500 border-y border-r border-[var(--border)] shadow-xs flex items-start gap-2.5"
            >
              <Flame className="w-4 h-4 text-teal-600 dark:text-teal-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--text-primary)] font-medium leading-relaxed">
                {text}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 5. Restored 8 Coloured Tiles Exactly in Order */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Row 1 */}
        {/* Tile 1: Total Portfolio */}
        <Tile
          title="MY PORTFOLIO"
          amount={formatACV(kpis.total_acv)}
          count={kpis.total_count}
          dealsLabel={kpis.total_count === 1 ? 'deal' : 'deals'}
          tone="total"
          subtitle="Total active renewal scope"
          onClick={() => openDeals(`My Complete Portfolio (${kpis.total_count})`, allDeals)}
        />

        {/* Tile 2: Commit Coverage */}
        <Tile
          title="COMMIT COVERAGE"
          amount={formatACV(kpis.commit_coverage_acv)}
          count={kpis.commit_coverage_count}
          dealsLabel={kpis.commit_coverage_count === 1 ? 'deal' : 'deals'}
          tone="coverage"
          subtitle={`${coveragePct}% of portfolio (Closed + Commit)`}
          onClick={() => openDeals(
            `Commit Coverage Deals (${kpis.commit_coverage_count})`,
            allDeals.filter((d: any) => ['Closed', 'Commit'].includes(d.forecast_category))
          )}
        />

        {/* Tile 3: Approved */}
        <Tile
          title="APPROVED"
          amount={formatACV(kpis.approved_acv)}
          count={kpis.approved_count}
          dealsLabel={kpis.approved_count === 1 ? 'deal' : 'deals'}
          tone="approved"
          subtitle="Ready to execute / approved"
          breakdown={kpis.approved_2nd_count > 0 ? `incl. ${kpis.approved_2nd_count} Approved 2nd (${formatACV(kpis.approved_2nd_acv)})` : undefined}
          onClick={() => openDeals(
            `Approved Deals (${kpis.approved_count})`,
            allDeals.filter((d: any) => d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd')
          )}
        />

        {/* Tile 4: Pending Approval */}
        <Tile
          title="PENDING APPROVAL"
          amount={formatACV(kpis.pending_approval_acv)}
          count={kpis.pending_approval_count}
          dealsLabel={kpis.pending_approval_count === 1 ? 'deal' : 'deals'}
          tone="pending"
          subtitle="Awaiting management sign-off"
          onClick={() => openDeals(
            `Pending Approval Deals (${kpis.pending_approval_count})`,
            allDeals.filter((d: any) => d.approval_status === 'Pending Approval')
          )}
        />

        {/* Row 2 */}
        {/* Tile 5: Not Submitted */}
        <Tile
          title="NOT SUBMITTED"
          amount={formatACV(kpis.not_submitted_acv)}
          count={kpis.not_submitted_count}
          dealsLabel={kpis.not_submitted_count === 1 ? 'deal' : 'deals'}
          tone="not_submitted"
          subtitle="Approval request required"
          onClick={() => openDeals(
            `Not Submitted Deals (${kpis.not_submitted_count})`,
            actionLists.not_submitted_deals || allDeals.filter((d: any) => (d.approval_status || 'Not submitted') === 'Not submitted')
          )}
        />

        {/* Tile 6: Delayed Renewals */}
        <Tile
          title="DELAYED RENEWALS"
          amount={formatACV(kpis.delayed_acv)}
          count={kpis.delayed_count}
          dealsLabel={kpis.delayed_count === 1 ? 'deal' : 'deals'}
          tone="delayed"
          subtitle="Past close date or scheduled delay"
          onClick={() => openDeals(
            `Delayed Renewals (${kpis.delayed_count})`,
            actionLists.delayed_deals || []
          )}
        />

        {/* Tile 7: Slippage */}
        <Tile
          title="SLIPPAGE"
          amount={formatACV(kpis.slippage_acv)}
          count={kpis.slippage_count}
          dealsLabel={kpis.slippage_count === 1 ? 'deal' : 'deals'}
          tone="slippage"
          subtitle="Close date pushed to later period"
          onClick={() => openDeals(
            `Slippage Deals (${kpis.slippage_count})`,
            actionLists.slippage_deals || []
          )}
        />

        {/* Tile 8: Needs Review */}
        <Tile
          title="NEEDS REVIEW"
          amount={formatACV(kpis.needs_review_acv)}
          count={kpis.needs_review_count}
          dealsLabel={kpis.needs_review_count === 1 ? 'deal' : 'deals'}
          tone="neutral"
          subtitle="Missing dates or negative ACV"
          onClick={() => openDeals(
            `Needs Review Deals (${kpis.needs_review_count})`,
            needsReviewDeals
          )}
        />
      </div>

      {/* 6. Regional Reach Line */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-3.5">
        <div className="flex items-center space-x-2 text-xs font-semibold text-[var(--text-secondary)] mb-2">
          <Globe className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span>REGIONAL REACH</span>
        </div>
        {regionLine.single_region && regionLine.summary_sentence ? (
          <button
            onClick={() => openDeals('Regional Deals', regionLine.regions[0]?.deals || allDeals)}
            className="text-left text-xs text-[var(--text-primary)] font-medium hover:text-teal-600 dark:hover:text-teal-400 transition-colors flex items-center space-x-1.5"
          >
            <span>{regionLine.summary_sentence}</span>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(regionLine.regions || []).map((reg: any, idx: number) => (
              <button
                key={idx}
                onClick={() => openDeals(`${reg.region} Deals (${reg.count})`, reg.deals || [])}
                className="flex flex-col text-left px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] hover:border-teal-500 transition-all text-xs"
              >
                <span className="font-semibold text-[var(--text-primary)]">{reg.label}</span>
                {reg.countries?.length > 1 && (
                  <span className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {reg.countries.map((c: any) => `${c.country} ${c.count}`).join(', ')}
                  </span>
                )}
              </button>
            ))}
            {(!regionLine.regions || regionLine.regions.length === 0) && (
              <span className="text-xs text-[var(--text-muted)]">No region data available.</span>
            )}
          </div>
        )}
      </div>

      {/* 7. Forecast Category Split & Approval Status Distribution Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Forecast Category Split"
          subtitle="Distribution of deals and ACV across pipeline stages"
          data={forecastChartData}
        />
        <ChartCard
          title="Approval Status Distribution"
          subtitle="Management sign-off tracking (Approved, Pending, Not submitted)"
          data={approvalChartData}
        />
      </div>

      {/* 8. Business Unit Split & Top Accounts by ACV Side-by-Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Business Unit Split"
          subtitle="Breakdown across product and service business units"
          data={buChartData}
        />
        <ChartCard
          title="Top Accounts by ACV"
          subtitle="Key customer accounts ranked by renewal value"
          data={accountsChartData}
        />
      </div>

      {/* 9. Portfolio Action Center with Tabs */}
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Portfolio Action Center</h3>
            <p className="text-xs text-[var(--text-muted)]">Opportunities requiring attention or sign-off</p>
          </div>

          {/* Action Tabs (0-item tabs hidden) */}
          <div className="flex flex-wrap gap-1.5">
            {availableActionTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveActionTab(tab.key as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                  activeActionTab === tab.key
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 font-bold">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* If all tabs are 0 */}
        {availableActionTabs.length === 0 ? (
          <div className="p-8 text-center bg-[var(--bg-primary)] rounded-xl border border-[var(--border)]">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Nothing needs attention</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              All Commit deals are approved and no renewal risks were flagged.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-primary)]">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Deal Name</th>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Forecast</th>
                  <th className="px-4 py-3 font-semibold">Approval Status</th>
                  <th className="px-4 py-3 font-semibold text-right">ACV</th>
                  <th className="px-4 py-3 font-semibold text-right">Close Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {currentActionList.slice(0, 10).map((deal: any, idx: number) => (
                  <tr
                    key={idx}
                    onClick={() => openDrawer(deal.id || deal.opportunity_id_18)}
                    className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{deal.opportunity_name || deal.id}</span>
                        {deal.review_reasons?.map((r: string, ri: number) => (
                          <span key={ri} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 shrink-0">
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] max-w-xs truncate">
                      {deal.account_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400">
                        {deal.forecast_category || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        deal.approval_status === 'Approved' || deal.approval_status === 'Approved - 2nd'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : deal.approval_status === 'Pending Approval'
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-slate-500/10 text-slate-400'
                      }`}>
                        {deal.approval_status || 'Not submitted'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-right text-[var(--text-primary)]">
                      {formatCurrency(deal.forecast_acv_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--text-muted)] font-mono text-[11px]">
                      {deal.close_date ? formatDate(deal.close_date) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 10. Messages & Management Comments Summary */}
      {data.messages_and_comments_summary && (
        <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-[var(--text-primary)]">Communication & Management Feedback</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {data.messages_and_comments_summary.open_threads} open thread{data.messages_and_comments_summary.open_threads === 1 ? '' : 's'} · {data.messages_and_comments_summary.unread_count} unread
                {data.messages_and_comments_summary.latest_shared_comments?.length > 0 && (
                  <span> · Latest feedback from {data.messages_and_comments_summary.latest_shared_comments[0].author}: "{data.messages_and_comments_summary.latest_shared_comments[0].text.slice(0, 45)}..."</span>
                )}
              </div>
            </div>
          </div>
          <Link
            to="/messages"
            className="px-3 py-1.5 rounded-lg font-semibold text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 transition-colors shrink-0 flex items-center gap-1"
          >
            <span>Open Messages Hub</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* 11. Data Notes Footer */}
      {data.data_notes?.note_text && (
        <div className="text-center text-xs text-[var(--text-muted)] py-3 border-t border-[var(--border)]">
          {data.data_notes.note_text}
        </div>
      )}

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
