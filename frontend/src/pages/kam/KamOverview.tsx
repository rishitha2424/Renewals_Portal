import React, { useState, useEffect } from 'react'
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
  Check,
  Tag,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { getKamOverview } from '@/api/client'
import { formatCurrency, formatNumber, formatDate, getForecastCategoryLabel, getApprovalStatusLabel, formatACV, formatDealsCount, acvM } from '@/utils/format'
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

  // Tab State: 'overview' | 'deal_tracker'
  const [activeTab, setActiveTab] = useState<'overview' | 'deal_tracker'>('overview')

  // Drawer & Modal State
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [modalDeals, setModalDeals] = useState<any[] | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')
  const [activeActionTab, setActiveActionTab] = useState<'immediate' | 'delayed' | 'not_submitted' | 'slippage' | 'missing_dates'>('immediate')

  // Pagination / Show more state for Deal Tracker
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const toggleExpanded = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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
  const whatChanged = data.what_changed || { has_changes: false, total_changes: 0 }
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
  const getDealsByApproval = (st: string) => allDeals.filter((d: any) => (d.approval_status || 'Not submitted') === st)

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
    const color = s.status === 'Approved' ? '#10B981' : s.status === 'Pending Approval' ? '#F59E0B' : '#EF4444'
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

  // ── Deal Tracker Operations Data ──────────────────────────────────────────

  // Timeline monthly groups
  const monthlyTimelineGroups = (() => {
    const map = new Map<string, any[]>()
    allDeals.forEach((d: any) => {
      const cd = d.close_date || ''
      const monthKey = cd.length >= 7 ? cd.slice(0, 7) : 'Unscheduled'
      if (!map.has(monthKey)) map.set(monthKey, [])
      map.get(monthKey)!.push(d)
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === 'Unscheduled' ? 1 : b === 'Unscheduled' ? -1 : a.localeCompare(b)))
      .map(([month, deals]) => ({
        month,
        totalAcv: deals.reduce((sum, d) => sum + (parseFloat(d.forecast_acv_amount) || 0), 0),
        deals: deals.sort((a, b) => (a.close_date || '').localeCompare(b.close_date || '')),
      }))
  })()

  // Deal Board Stage Columns
  const stageColumns = (() => {
    const map = new Map<string, any[]>()
    allDeals.forEach((d: any) => {
      const st = (d.stage_number || d.stage || 'Unassigned').trim() || 'Unassigned'
      if (!map.has(st)) map.set(st, [])
      map.get(st)!.push(d)
    })
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([stage, deals]) => ({
        stage,
        totalAcv: deals.reduce((sum, d) => sum + (parseFloat(d.forecast_acv_amount) || 0), 0),
        deals: deals.sort((a, b) => (parseFloat(b.forecast_acv_amount) || 0) - (parseFloat(a.forecast_acv_amount) || 0)),
      }))
  })()

  // Approval Tracker Deals
  const approvalTrackerDeals = [...allDeals].sort((a, b) => {
    const aNeed = (a.approval_status !== 'Approved' && a.approval_status !== 'Approved - 2nd') ? 1 : 0
    const bNeed = (b.approval_status !== 'Approved' && b.approval_status !== 'Approved - 2nd') ? 1 : 0
    if (aNeed !== bNeed) return bNeed - aNeed
    return (parseFloat(b.forecast_acv_amount) || 0) - (parseFloat(a.forecast_acv_amount) || 0)
  })

  // Action Center Filtered List
  const immediateDeals = actionLists.immediate_attention || []
  const delayedDeals = actionLists.delayed_deals || []
  const notSubmittedDeals = actionLists.not_submitted_deals || []
  const slippageDeals = actionLists.slippage_deals || []
  const missingDatesDeals = actionLists.missing_service_dates || []

  const availableActionTabs = [
    { key: 'immediate', label: 'Immediate attention', count: immediateDeals.length, deals: immediateDeals },
    { key: 'delayed', label: 'Delayed renewals', count: delayedDeals.length, deals: delayedDeals },
    { key: 'not_submitted', label: 'Not submitted', count: notSubmittedDeals.length, deals: notSubmittedDeals },
    { key: 'slippage', label: 'Slippage', count: slippageDeals.length, deals: slippageDeals },
    { key: 'missing_dates', label: 'Missing dates', count: missingDatesDeals.length, deals: missingDatesDeals },
  ].filter((tab) => tab.count > 0)

  // Auto-select valid tab if current has 0
  const currentActionList = (() => {
    const found = availableActionTabs.find((t) => t.key === activeActionTab)
    if (found) return found.deals
    return availableActionTabs[0]?.deals || []
  })()

  const allUnapprovedDeals = allDeals.filter(
    (d: any) => d.approval_status !== 'Approved' && d.approval_status !== 'Approved - 2nd'
  )

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Title & Scope Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">My Overview</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Personal renewal portfolio metrics and actionable opportunities for{' '}
            <span className="font-semibold text-[var(--text-primary)]">{data.owner_name}</span>.
          </p>
        </div>

        {/* Other periods notice */}
        {periodInfo.other_periods_count > 0 && (
          <div className="text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] flex items-center space-x-2">
            <span>
              Showing {periodInfo.showing_count} deals ({formatCurrency(periodInfo.showing_acv)}) for {periodInfo.period_label}.
            </span>
            <button
              onClick={() => setGlobalFilters({ period: 'all_open' })}
              className="text-teal-600 dark:text-teal-400 font-semibold hover:underline"
            >
              +{periodInfo.other_periods_count} more in other periods
            </button>
          </div>
        )}
      </div>

      {/* Two Tabs Switcher */}
      <div className="flex items-center space-x-2 border-b border-[var(--border-subtle)] pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
            activeTab === 'overview'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('deal_tracker')}
          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center space-x-2 ${
            activeTab === 'deal_tracker'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
          }`}
        >
          <span>Deal Tracker</span>
          {whatChanged.has_changes && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
              {whatChanged.total_changes} new
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: OVERVIEW TAB ─────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Zero Deals Edge Case Banner */}
          {allDeals.length === 0 && (
            <div className="p-8 text-center bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)]">
              <div className="w-12 h-12 rounded-full bg-teal-500/10 text-teal-600 mx-auto flex items-center justify-center mb-3">
                <Calendar className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                No deals found for this period
              </h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                There are no renewal opportunities scheduled in the selected period.
              </p>
              <button
                onClick={() => setGlobalFilters({ period: 'all_open' })}
                className="px-4 py-2 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors shadow-sm"
              >
                Switch to All periods
              </button>
            </div>
          )}

          {/* 1. Top 8 Summary Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile
              title="TOTAL PORTFOLIO"
              amount={formatACV(kpis.total_acv)}
              count={kpis.total_count}
              accentColor="cyan"
              onClick={() => openDeals(`Total Portfolio Deals (${kpis.total_count})`, allDeals)}
            />
            <Tile
              title="COMMIT COVERAGE"
              amount={formatACV(kpis.commit_coverage_acv)}
              count={kpis.commit_coverage_count}
              subtitle={`${coveragePct}% of portfolio`}
              accentColor="emerald"
              onClick={() => openDeals(
                `Commit Coverage Deals (${kpis.commit_coverage_count})`,
                allDeals.filter((d: any) => d.forecast_category === 'Commit' || d.forecast_category === 'Closed')
              )}
            />
            <Tile
              title="COMMIT"
              amount={formatACV(kpis.commit_acv)}
              count={kpis.commit_count}
              accentColor="blue"
              onClick={() => openDeals('Commit Deals', getDealsByForecast('Commit'))}
            />
            <Tile
              title="CLOSED"
              amount={formatACV(kpis.closed_acv)}
              count={kpis.closed_count}
              accentColor="emerald"
              onClick={() => openDeals('Closed Deals', getDealsByForecast('Closed'))}
            />
            <Tile
              title="BEST CASE"
              amount={formatACV(kpis.best_case_acv)}
              count={kpis.best_case_count}
              accentColor="blue"
              onClick={() => openDeals('Best Case Deals', getDealsByForecast('Best Case'))}
            />
            <Tile
              title="PIPELINE"
              amount={formatACV(kpis.pipeline_acv)}
              count={kpis.pipeline_count}
              accentColor="slate"
              onClick={() => openDeals('Pipeline Deals', getDealsByForecast('Pipeline'))}
            />
            <Tile
              title="DELAYED RENEWALS"
              amount={formatACV(kpis.delayed_acv)}
              count={kpis.delayed_count}
              accentColor="rose"
              onClick={() => openDeals(`Delayed Renewal Deals (${kpis.delayed_count})`, delayedDeals)}
            />
            <Tile
              title="APPROVALS NEEDED"
              amount={formatACV(kpis.pending_approval_acv + kpis.not_submitted_acv)}
              count={kpis.pending_approval_count + kpis.not_submitted_count}
              subtitle={kpis.approved_2nd_breakdown || 'Awaiting sign-off'}
              accentColor="amber"
              onClick={() => openDeals('Unapproved Deals', allUnapprovedDeals)}
            />
          </div>

          {/* 2. Movements & Changes Strip (Addendum A) */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between text-xs text-[var(--text-secondary)] gap-2 shadow-sm">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-[var(--text-primary)]">Movements:</span>
              <span>
                vs {compareDateFormatted}:{' '}
                <span className={deltaCompare.available ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                  {deltaCompare.available ? deltaCompare.label : 'n/a'}
                </span>
              </span>
            </div>
            <div className="hidden sm:inline text-[var(--border-subtle)]">·</div>
            <div>
              vs yesterday:{' '}
              <span className={deltaY.available ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                {deltaY.available ? deltaY.label : 'n/a'}
              </span>
            </div>
            <div className="hidden sm:inline text-[var(--border-subtle)]">·</div>
            <div>
              vs last week:{' '}
              <span className={deltaW.available ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                {deltaW.available ? deltaW.label : 'n/a'}
              </span>
            </div>
          </div>

          {/* 3. 3 Plain Language Insight Sentences */}
          {insightCards.length > 0 && (
            <div className="bg-gradient-to-r from-teal-500/10 via-blue-500/5 to-transparent border border-teal-500/20 rounded-xl p-4">
              <div className="flex items-center space-x-2 text-teal-600 dark:text-teal-400 font-semibold text-xs mb-2">
                <Sparkles className="w-4 h-4" />
                <span>PORTFOLIO INSIGHTS</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-[var(--text-primary)]">
                {insightCards.slice(0, 3).map((text: string, idx: number) => (
                  <div key={idx} className="flex items-start space-x-2 bg-[var(--bg-primary)] p-3 rounded-lg border border-[var(--border-subtle)]">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1.5 flex-shrink-0" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. Region Line (Item 1a) */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl p-3.5">
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
                    className="flex flex-col text-left px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-teal-500 transition-all text-xs"
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

          {/* 5. Forecast Category Split & Approval Status Distribution Side-by-Side */}
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

          {/* 6. Business Unit Split & Top Accounts by ACV Side-by-Side */}
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

          {/* 7. Portfolio Action Center with Tabs */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
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
                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]'
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
              <div className="p-8 text-center bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)]">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">Nothing needs attention</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  All Commit deals are approved and no renewal risks were flagged.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                <table className="w-full text-xs text-left">
                  <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Deal Name</th>
                      <th className="px-4 py-3 font-semibold">Account</th>
                      <th className="px-4 py-3 font-semibold">Forecast</th>
                      <th className="px-4 py-3 font-semibold">Approval Status</th>
                      <th className="px-4 py-3 font-semibold text-right">ACV</th>
                      <th className="px-4 py-3 font-semibold text-right">Close Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {currentActionList.slice(0, 10).map((deal: any, idx: number) => (
                      <tr
                        key={idx}
                        onClick={() => openDrawer(deal.id || deal.opportunity_id_18)}
                        className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                          {deal.opportunity_name || deal.id}
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
                            deal.approval_status === 'Approved'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : deal.approval_status === 'Pending Approval'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-rose-500/10 text-rose-400'
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
        </div>
      )}

      {/* ── TAB 2: DEAL TRACKER TAB ─────────────────────────────────────── */}
      {activeTab === 'deal_tracker' && (
        <div className="space-y-6">
          {/* 1. What Changed Section (Addendum B) - Hidden if no changes */}
          {whatChanged.has_changes && (
            <div className="bg-[var(--bg-secondary)] border border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[var(--text-primary)]">
                      What Changed Since {compareDateFormatted}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      {whatChanged.total_changes} portfolio movements and modifications detected
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* New Deals */}
                {(whatChanged.new_deals || []).length > 0 && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-emerald-500">
                      <span>New Deals Added</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-[10px]">{whatChanged.new_deals.length}</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {whatChanged.new_deals.map((nd: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => openDrawer(nd.id)}
                          className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-emerald-500/5 cursor-pointer text-xs"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">{nd.opportunity_name}</div>
                          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-0.5">
                            <span>{nd.account_name}</span>
                            <span className="font-semibold text-emerald-500">+{formatCurrency(nd.acv)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ACV Changes */}
                {(whatChanged.acv_changes || []).length > 0 && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-blue-500">
                      <span>ACV Value Changes</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 text-[10px]">{whatChanged.acv_changes.length}</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {whatChanged.acv_changes.map((ca: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => openDrawer(ca.id)}
                          className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-blue-500/5 cursor-pointer text-xs"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">{ca.opportunity_name}</div>
                          <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-0.5">
                            <span>{formatCurrency(ca.old_acv)} → {formatCurrency(ca.new_acv)}</span>
                            <span className={`font-semibold ${ca.diff_acv > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {ca.diff_acv > 0 ? '+' : ''}{formatCurrency(ca.diff_acv)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stage Changes */}
                {(whatChanged.stage_changes || []).length > 0 && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-amber-500">
                      <span>Stage Movements</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-[10px]">{whatChanged.stage_changes.length}</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {whatChanged.stage_changes.map((st: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => openDrawer(st.id)}
                          className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-amber-500/5 cursor-pointer text-xs"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">{st.opportunity_name}</div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {st.old_stage} → <span className="font-medium text-[var(--text-primary)]">{st.new_stage}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Category Changes */}
                {(whatChanged.category_changes || []).length > 0 && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-purple-500">
                      <span>Forecast Category Changes</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-purple-500/20 text-[10px]">{whatChanged.category_changes.length}</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {whatChanged.category_changes.map((cat: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => openDrawer(cat.id)}
                          className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-purple-500/5 cursor-pointer text-xs"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">{cat.opportunity_name}</div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {cat.old_category} → <span className="font-medium text-[var(--text-primary)]">{cat.new_category}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approval Changes */}
                {(whatChanged.approval_changes || []).length > 0 && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-teal-500">
                      <span>Approval Status Updates</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-teal-500/20 text-[10px]">{whatChanged.approval_changes.length}</span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {whatChanged.approval_changes.map((ap: any, i: number) => (
                        <div
                          key={i}
                          onClick={() => openDrawer(ap.id)}
                          className="p-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-teal-500/5 cursor-pointer text-xs"
                        >
                          <div className="font-medium text-[var(--text-primary)] truncate">{ap.opportunity_name}</div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {ap.old_status} → <span className="font-medium text-[var(--text-primary)]">{ap.new_status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Closed Won or Removed */}
                {((whatChanged.closed_won || []).length > 0 || (whatChanged.removed_deals || []).length > 0) && (
                  <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-subtle)] space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                      <span>Closed / Removed Deals</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-500/20 text-[10px]">
                        {(whatChanged.closed_won?.length || 0) + (whatChanged.removed_deals?.length || 0)}
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {(whatChanged.closed_won || []).map((cw: any, i: number) => (
                        <div key={`cw-${i}`} onClick={() => openDrawer(cw.id)} className="p-2 rounded-lg bg-[var(--bg-secondary)] cursor-pointer text-xs">
                          <span className="text-emerald-400 font-semibold text-[10px]">WON · </span>
                          <span className="font-medium text-[var(--text-primary)]">{cw.opportunity_name}</span>
                        </div>
                      ))}
                      {(whatChanged.removed_deals || []).map((rm: any, i: number) => (
                        <div key={`rm-${i}`} className="p-2 rounded-lg bg-[var(--bg-secondary)] text-xs">
                          <span className="text-rose-400 font-semibold text-[10px]">REMOVED · </span>
                          <span className="font-medium text-[var(--text-primary)]">{rm.opportunity_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. Renewal Timeline (Horizontal markers) */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Renewal Timeline</h3>
                <p className="text-xs text-[var(--text-muted)]">Opportunities organized by close month</p>
              </div>
            </div>

            <div className="space-y-4">
              {monthlyTimelineGroups.map((grp) => (
                <div key={grp.month} className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold border-b border-[var(--border-subtle)] pb-2">
                    <span className="text-[var(--text-primary)]">{grp.month}</span>
                    <span className="text-teal-600 dark:text-teal-400">
                      {grp.deals.length} deals · {formatACV(grp.totalAcv)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {grp.deals.map((d: any) => {
                      const isNegative = (parseFloat(d.forecast_acv_amount) || 0) < 0
                      return (
                        <button
                          key={d.id || d.opportunity_id_18}
                          onClick={() => openDrawer(d.id || d.opportunity_id_18)}
                          className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-teal-500/10 border border-[var(--border-subtle)] hover:border-teal-500 transition-all text-xs flex items-center space-x-2"
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FORECAST_COLORS[d.forecast_category as keyof typeof FORECAST_COLORS] || '#64748B' }} />
                          <span className="font-medium text-[var(--text-primary)] max-w-[140px] truncate">{d.account_name}</span>
                          <span className="font-semibold text-[var(--text-secondary)]">{formatACV(d.forecast_acv_amount)}</span>
                          {isNegative && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400">
                              Negative ACV
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Deal Board by Stage (Kanban columns with 15-item pagination) */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Deal Board by Stage</h3>
                <p className="text-xs text-[var(--text-muted)]">Active renewals grouped across opportunity stages</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {stageColumns.map((col) => {
                const isExpanded = !!expandedSections[`stage-${col.stage}`]
                const displayedDeals = isExpanded ? col.deals : col.deals.slice(0, 15)
                const hasMore = col.deals.length > 15

                return (
                  <div key={col.stage} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-3 flex flex-col space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold border-b border-[var(--border-subtle)] pb-2">
                      <span className="text-[var(--text-primary)] truncate max-w-[140px]">{col.stage}</span>
                      <span className="text-teal-600 dark:text-teal-400 text-[11px] font-bold">
                        {col.deals.length} · {formatACV(col.totalAcv)}
                      </span>
                    </div>

                    <div className="space-y-2 flex-1">
                      {displayedDeals.map((deal: any) => {
                        const isNegative = (parseFloat(deal.forecast_acv_amount) || 0) < 0
                        return (
                          <div
                            key={deal.id || deal.opportunity_id_18}
                            onClick={() => openDrawer(deal.id || deal.opportunity_id_18)}
                            className="p-2.5 rounded-lg bg-[var(--bg-secondary)] hover:bg-teal-500/10 border border-[var(--border-subtle)] hover:border-teal-500 cursor-pointer transition-all space-y-1.5"
                          >
                            <div className="font-semibold text-xs text-[var(--text-primary)] line-clamp-1">
                              {deal.opportunity_name || deal.id}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] truncate">{deal.account_name}</div>
                            <div className="flex items-center justify-between text-xs pt-1">
                              <span className="font-bold text-[var(--text-primary)]">{formatCurrency(deal.forecast_acv_amount)}</span>
                              {isNegative && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400">
                                  Negative ACV
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {hasMore && (
                      <button
                        onClick={() => toggleExpanded(`stage-${col.stage}`)}
                        className="w-full py-1.5 text-center text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline"
                      >
                        {isExpanded ? 'Show fewer' : `Show all ${col.deals.length} deals`}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 4. Approval Sign-Off Tracker */}
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">Approval Sign-Off Tracker</h3>
                <p className="text-xs text-[var(--text-muted)]">Step-by-step progress towards management approval</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Deal Name</th>
                    <th className="px-4 py-3 font-semibold">Account</th>
                    <th className="px-4 py-3 font-semibold">Workflow Status</th>
                    <th className="px-4 py-3 font-semibold">Progress</th>
                    <th className="px-4 py-3 font-semibold text-right">ACV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {(expandedSections['approval-tracker'] ? approvalTrackerDeals : approvalTrackerDeals.slice(0, 15)).map((deal: any) => {
                    const status = deal.approval_status || 'Not submitted'
                    const isApproved = status === 'Approved' || status === 'Approved - 2nd'
                    const isPending = status === 'Pending Approval'

                    return (
                      <tr
                        key={deal.id || deal.opportunity_id_18}
                        onClick={() => openDrawer(deal.id || deal.opportunity_id_18)}
                        className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)] max-w-xs truncate">
                          {deal.opportunity_name || deal.id}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">{deal.account_name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isApproved
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : isPending
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 min-w-[140px]">
                          <div className="flex items-center space-x-1 w-full bg-[var(--bg-secondary)] h-2 rounded-full overflow-hidden">
                            <div className={`h-full ${isApproved ? 'w-full bg-emerald-500' : isPending ? 'w-2/3 bg-amber-500' : 'w-1/3 bg-rose-500'}`} />
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-right text-[var(--text-primary)]">
                          {formatCurrency(deal.forecast_acv_amount)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {approvalTrackerDeals.length > 15 && (
              <button
                onClick={() => toggleExpanded('approval-tracker')}
                className="w-full py-2 text-center text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
              >
                {expandedSections['approval-tracker'] ? 'Show fewer' : `Show all ${approvalTrackerDeals.length} deals`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Opportunity Detail Drawer */}
      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />

      {/* Deal List Modal */}
      {modalDeals && (
        <DealListModal
          title={modalTitle}
          deals={modalDeals}
          onSelectOpp={(id: string) => {
            setModalDeals(null)
            openDrawer(id)
          }}
          onClose={() => setModalDeals(null)}
        />
      )}
    </div>
  )
}
