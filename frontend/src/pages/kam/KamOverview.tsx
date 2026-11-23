import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  DollarSign,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MessageSquare,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Search,
  ExternalLink,
  ChevronRight,
  FileText,
  AlertCircle,
  HelpCircle,
  Calendar,
  Building2,
  Globe,
  BarChart3,
  Flame,
} from 'lucide-react'
import { getKamOverview } from '@/api/client'
import { formatCurrency, formatNumber, formatDate, getForecastCategoryLabel, getApprovalStatusLabel, formatACV, acvM } from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import { useAuthStore } from '@/store/authStore'
import { useAppStore } from '@/store/appStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import DealListModal from '@/components/common/DealListModal'
import ChartCard, { ChartDatum } from '@/components/common/ChartCard'
import { Tile } from '@/components/common/Tile'
import CardRow from '@/components/common/CardRow'
import EmptyState from '@/components/ui/EmptyState'

export default function KamOverview() {
  const { currentUser } = useAuthStore()
  const { snapshots, activeSnapshotId, globalFilters } = useAppStore()
  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId)

  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [modalDeals, setModalDeals] = useState<any[] | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')
  const [activeActionTab, setActiveActionTab] = useState<'immediate' | 'delayed' | 'not_submitted' | 'slippage' | 'missing_dates'>('immediate')

  const typesStr = globalFilters.types?.length ? globalFilters.types.join(',') : undefined

  const { data, isLoading, error } = useQuery({
    queryKey: ['kam-overview', currentUser?.id, activeSnap?.snapshot_date, globalFilters.period, typesStr],
    queryFn: () => getKamOverview({
      as_of: activeSnap?.snapshot_date,
      period: globalFilters.period,
      types: typesStr,
    }),
  })

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
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
  const deltaY = movements.delta_yesterday || { count: 0, acv: 0.0, available: false }
  const deltaW = movements.delta_lastweek || { count: 0, acv: 0.0, available: false }

  const charts = data.charts || {}
  const actionLists = data.action_lists || {}
  const insightCards = data.insight_cards || []

  const openDeals = (title: string, deals: any[]) => {
    setModalTitle(title)
    setModalDeals(deals)
  }

  // Filter deals for quick clicks
  const getDealsByForecast = (cat: string) => allDeals.filter((d: any) => d.forecast_category === cat)
  const getDealsByApproval = (st: string) => allDeals.filter((d: any) => (d.approval_status || 'Not submitted') === st)

  // Chart 1: Forecast Category Split
  const forecastChartData: ChartDatum[] = (charts.forecast_categories || []).map((c: any) => {
    const deals = getDealsByForecast(c.category)
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
  const approvalChartData: ChartDatum[] = (charts.approval_statuses || []).map((s: any) => {
    const deals = getDealsByApproval(s.status)
    const color = s.status === 'Approved' ? '#10B981' : s.status === 'Pending Approval' ? '#F59E0B' : '#EF4444'
    return {
      label: getApprovalStatusLabel(s.status),
      value: s.acv,
      formattedValue: formatACV(s.acv),
      dealsCount: s.count,
      color,
      onClick: () => openDeals(`${getApprovalStatusLabel(s.status)} Deals (${s.count})`, deals),
    }
  })

  // Chart 3: Stage Funnel
  const stageChartData: ChartDatum[] = (charts.stage_funnel || []).map((s: any) => ({
    label: s.stage,
    value: s.acv,
    formattedValue: formatACV(s.acv),
    dealsCount: s.count,
    onClick: () => openDeals(`Stage: ${s.stage} (${s.count})`, s.deals || []),
  }))

  // Chart 4: Business Units
  const buChartData: ChartDatum[] = (charts.business_units || []).map((b: any) => ({
    label: b.business_unit,
    value: b.acv,
    formattedValue: formatACV(b.acv),
    dealsCount: b.count,
    onClick: () => openDeals(`BU: ${b.business_unit} (${b.count})`, b.deals || []),
  }))

  // Chart 5: Regions
  const regionChartData: ChartDatum[] = (charts.regions || []).map((r: any) => ({
    label: r.region,
    value: r.acv,
    formattedValue: formatACV(r.acv),
    dealsCount: r.count,
    onClick: () => openDeals(`Region: ${r.region} (${r.count})`, r.deals || []),
  }))

  // Chart 6: Monthly Close Timeline
  const timelineChartData: ChartDatum[] = (charts.monthly_close_timeline || []).map((m: any) => {
    const deals = allDeals.filter((d: any) => (d.close_date || '').startsWith(m.month))
    return {
      label: m.month,
      value: m.acv,
      formattedValue: formatACV(m.acv),
      dealsCount: m.count,
      onClick: () => openDeals(`Close Month: ${m.month} (${m.count})`, deals),
    }
  })

  // Chart 7: Top Accounts
  const accountsChartData: ChartDatum[] = (charts.top_accounts || []).map((a: any) => {
    const deals = allDeals.filter((d: any) => d.account_name === a.account_name)
    return {
      label: a.account_name,
      value: a.acv,
      formattedValue: formatACV(a.acv),
      dealsCount: a.count,
      onClick: () => openDeals(`Account: ${a.account_name} (${a.count})`, deals),
    }
  })

  // Chart 8: Deal Size Bands
  const sizeBandsData: ChartDatum[] = (charts.size_bands || []).map((b: any) => {
    const deals = allDeals.filter((d: any) => {
      const amt = floatVal(d.forecast_acv_amount)
      return amt >= b.min && amt < b.max
    })
    return {
      label: b.band,
      value: b.acv,
      formattedValue: formatACV(b.acv),
      dealsCount: b.count,
      onClick: () => openDeals(`Size Band: ${b.band} (${b.count})`, deals),
    }
  })

  function floatVal(v: any): number {
    const n = parseFloat(v)
    return isNaN(n) ? 0 : n
  }

  const coveragePct = kpis.total_acv > 0
    ? Math.round((kpis.commit_coverage_acv / kpis.total_acv) * 100)
    : 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              My Portfolio Overview
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#12284C] text-white">
              {data.resolved_quarter || 'Q4-2026'}
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

      {/* Movements Banner (vs Yesterday & vs Last Week) */}
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

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-medium">vs Yesterday:</span>
            {deltaY.available ? (
              <span className={`font-semibold tabular-nums ${deltaY.acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {deltaY.acv >= 0 ? '+' : ''}{formatCurrency(deltaY.acv)} ({deltaY.count >= 0 ? '+' : ''}{deltaY.count} deals)
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">No baseline</span>
            )}
          </div>
          <div className="h-4 w-px bg-[var(--border)]" />
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)] font-medium">vs Last Week:</span>
            {deltaW.available ? (
              <span className={`font-semibold tabular-nums ${deltaW.acv >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {deltaW.acv >= 0 ? '+' : ''}{formatCurrency(deltaW.acv)} ({deltaW.count >= 0 ? '+' : ''}{deltaW.count} deals)
              </span>
            ) : (
              <span className="text-[var(--text-muted)]">No baseline</span>
            )}
          </div>
        </div>
      </div>

      {/* Plain Language Insight Cards */}
      {insightCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {insightCards.map((text: string, idx: number) => (
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

      {/* Primary KPI Tiles (8 Core Tiles) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Tile 1: Total Portfolio */}
        <Tile
          title="MY PORTFOLIO"
          amount={formatACV(kpis.total_acv)}
          count={kpis.total_count}
          dealsLabel="deals"
          tone="total"
          subtitle="Total active renewal scope"
          onClick={() => openDeals(`My Complete Portfolio (${kpis.total_count})`, allDeals)}
        />

        {/* Tile 2: Commit Coverage */}
        <Tile
          title="COMMIT COVERAGE"
          amount={formatACV(kpis.commit_coverage_acv)}
          count={kpis.commit_coverage_count}
          dealsLabel="deals"
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
          dealsLabel="deals"
          tone="approved"
          subtitle="Ready to execute / approved"
          onClick={() => openDeals(
            `Approved Deals (${kpis.approved_count})`,
            allDeals.filter((d: any) => d.approval_status === 'Approved')
          )}
        />

        {/* Tile 4: Pending Approval */}
        <Tile
          title="PENDING APPROVAL"
          amount={formatACV(kpis.pending_approval_acv)}
          count={kpis.pending_approval_count}
          dealsLabel="deals"
          tone="pending"
          subtitle="Awaiting management sign-off"
          onClick={() => openDeals(
            `Pending Approval Deals (${kpis.pending_approval_count})`,
            allDeals.filter((d: any) => d.approval_status === 'Pending Approval')
          )}
        />

        {/* Tile 5: Not Submitted */}
        <Tile
          title="NOT SUBMITTED"
          amount={formatACV(kpis.not_submitted_acv)}
          count={kpis.not_submitted_count}
          dealsLabel="deals"
          tone="not_submitted"
          subtitle="Approval request required"
          onClick={() => openDeals(
            `Not Submitted Deals (${kpis.not_submitted_count})`,
            actionLists.not_submitted_deals || []
          )}
        />

        {/* Tile 6: Delayed Renewals */}
        <Tile
          title="DELAYED RENEWALS"
          amount={formatACV(kpis.delayed_acv)}
          count={kpis.delayed_count}
          dealsLabel="deals"
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
          dealsLabel="deals"
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
          dealsLabel="deals"
          tone="neutral"
          subtitle="Immediate attention / missing dates"
          onClick={() => openDeals(
            `Deals Requiring Review (${kpis.needs_review_count})`,
            actionLists.immediate_attention || []
          )}
        />
      </div>

      {/* Empty State Guard */}
      {kpis.total_count === 0 ? (
        <EmptyState
          icon={<AlertCircle className="w-8 h-8 text-[var(--text-muted)]" />}
          title="No renewal opportunities found"
          description={`There are no renewal opportunities assigned to you for ${data.resolved_quarter || 'this period'}. Try changing the period, snapshot date, or sales type filter.`}
        />
      ) : (
        <>
          {/* 8 Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Chart 1: Forecast Category Split */}
            <ChartCard
              title="Forecast Category Split"
              subtitle="Breakdown of ACV by pipeline stage"
              type="horizontal-bars"
              data={forecastChartData}
              total={kpis.total_acv}
            />

            {/* Chart 2: Approval Status Distribution */}
            <ChartCard
              title="Approval Status Distribution"
              subtitle="Management approval compliance"
              type="horizontal-bars"
              data={approvalChartData}
              total={kpis.total_acv}
            />

            {/* Chart 3: Stage Funnel */}
            <ChartCard
              title="Stage Funnel"
              subtitle="Opportunities by CRM sales stage"
              type="horizontal-bars"
              data={stageChartData}
              total={kpis.total_acv}
            />

            {/* Chart 4: Business Units */}
            <ChartCard
              title="Business Unit Split"
              subtitle="ACV distribution across business units"
              type="horizontal-bars"
              data={buChartData}
              total={kpis.total_acv}
            />

            {/* Chart 5: Regional Distribution */}
            <ChartCard
              title="Regional Distribution"
              subtitle="ACV by geographical territory"
              type="horizontal-bars"
              data={regionChartData}
              total={kpis.total_acv}
            />

            {/* Chart 6: Monthly Close Timeline */}
            <ChartCard
              title="Monthly Close Timeline"
              subtitle="Expected renewal closing volume by month"
              type="vertical-bars"
              data={timelineChartData}
              total={kpis.total_acv}
            />

            {/* Chart 7: Top Accounts */}
            <ChartCard
              title="Top Accounts by ACV"
              subtitle="Highest value renewal customer accounts"
              type="horizontal-bars"
              data={accountsChartData}
              total={kpis.total_acv}
            />

            {/* Chart 8: Deal Size Bands */}
            <ChartCard
              title="Deal Size Distribution"
              subtitle="Opportunity concentration by ticket size"
              type="vertical-bars"
              data={sizeBandsData}
              total={kpis.total_acv}
            />
          </div>

          {/* Action Lists Tabs & Table */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  Portfolio Action Center
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Action lists requiring KAM attention or management follow-up
                </p>
              </div>

              {/* Action Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs">
                <button
                  type="button"
                  onClick={() => setActiveActionTab('immediate')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    activeActionTab === 'immediate'
                      ? 'bg-[#12284C] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Immediate Attention ({(actionLists.immediate_attention || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveActionTab('delayed')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    activeActionTab === 'delayed'
                      ? 'bg-[#12284C] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Delayed Renewals ({(actionLists.delayed_deals || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveActionTab('not_submitted')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    activeActionTab === 'not_submitted'
                      ? 'bg-[#12284C] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Not Submitted ({(actionLists.not_submitted_deals || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveActionTab('slippage')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    activeActionTab === 'slippage'
                      ? 'bg-[#12284C] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Slippage ({(actionLists.slippage_deals || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveActionTab('missing_dates')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                    activeActionTab === 'missing_dates'
                      ? 'bg-[#12284C] text-white shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Missing Dates ({(actionLists.missing_service_dates || []).length})
                </button>
              </div>
            </div>

            {/* Active Action List Table */}
            {(() => {
              const currentList =
                activeActionTab === 'immediate'
                  ? actionLists.immediate_attention || []
                  : activeActionTab === 'delayed'
                  ? actionLists.delayed_deals || []
                  : activeActionTab === 'not_submitted'
                  ? actionLists.not_submitted_deals || []
                  : activeActionTab === 'slippage'
                  ? actionLists.slippage_deals || []
                  : actionLists.missing_service_dates || []

              if (currentList.length === 0) {
                return (
                  <div className="py-12 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 opacity-80" />
                    <p className="font-semibold text-[var(--text-primary)]">All clear in this category</p>
                    <p>No opportunities flagged under this action category.</p>
                  </div>
                )
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                        <th className="pb-2.5">Opportunity</th>
                        <th className="pb-2.5">Account</th>
                        <th className="pb-2.5 text-right">ACV Amount</th>
                        <th className="pb-2.5">Forecast Category</th>
                        <th className="pb-2.5">Approval Status</th>
                        <th className="pb-2.5">Close Date</th>
                        <th className="pb-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {currentList.map((d: any) => (
                        <tr
                          key={d.opportunity_id_18}
                          onClick={() => setSelectedOppId(d.opportunity_id_18)}
                          className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                        >
                          <td className="py-2.5 pr-3">
                            <div className="font-bold text-[var(--text-primary)] group-hover:text-teal-600 transition-colors line-clamp-1">
                              {d.opportunity_name}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono">{d.opportunity_id_18}</div>
                          </td>
                          <td className="py-2.5 pr-3 max-w-[150px] truncate text-[var(--text-secondary)] font-medium">
                            {d.account_name}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-bold text-[var(--text-primary)] tabular-nums">
                            {formatCurrency(d.forecast_acv_amount)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="font-semibold text-[var(--text-secondary)]">
                              {getForecastCategoryLabel(d.forecast_category)}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold ${
                              d.approval_status === 'Approved'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : d.approval_status === 'Pending Approval'
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                            }`}>
                              {getApprovalStatusLabel(d.approval_status)}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums text-[var(--text-secondary)]">
                            {formatDate(d.close_date)}
                          </td>
                          <td className="py-2.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedOppId(d.opportunity_id_18)
                              }}
                              className="text-teal-600 dark:text-teal-400 font-semibold hover:underline inline-flex items-center gap-1"
                            >
                              Open <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </>
      )}

      {/* Drill-down DealListModal */}
      {modalDeals && (
        <DealListModal
          title={modalTitle}
          deals={modalDeals}
          expectedCount={modalDeals.length}
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
