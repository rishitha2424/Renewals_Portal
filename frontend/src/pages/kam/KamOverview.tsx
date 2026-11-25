import React, { useState, useEffect, useMemo } from 'react'
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
import CardRow from '@/components/common/CardRow'
import EmptyState from '@/components/ui/EmptyState'

export default function KamOverview() {
  const { currentUser } = useAuthStore()
  const { snapshots, activeSnapshotId, globalFilters, setGlobalFilters } = useAppStore()
  const activeSnap = snapshots.find((s: any) => s.id === activeSnapshotId)

  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [modalDeals, setModalDeals] = useState<any[] | null>(null)
  const [modalTitle, setModalTitle] = useState<string>('')
  const [activeActionTab, setActiveActionTab] = useState<'immediate' | 'delayed' | 'not_submitted' | 'slippage' | 'missing_dates'>('immediate')

  useEffect(() => {
    if (currentUser?.role === 'kam' && (!globalFilters.period || globalFilters.period === 'current_quarter')) {
      setGlobalFilters({ period: 'all_open' })
    }
  }, [currentUser?.role])

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

  // ── 1. Renewal Timeline Groups ──────────────────────────────────────────
  const monthlyTimelineGroups = useMemo(() => {
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
  }, [allDeals])

  // ── 2. Deal Board by Stage ──────────────────────────────────────────────
  const stageColumns = useMemo(() => {
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
  }, [allDeals])

  // ── 3. Approval Tracker per Deal ────────────────────────────────────────
  const approvalTrackerDeals = useMemo(() => {
    return [...allDeals].sort((a, b) => {
      const aNeed = (a.approval_status !== 'Approved' && a.approval_status !== 'Approved - 2nd') ? 1 : 0
      const bNeed = (b.approval_status !== 'Approved' && b.approval_status !== 'Approved - 2nd') ? 1 : 0
      if (aNeed !== bNeed) return bNeed - aNeed
      return (parseFloat(b.forecast_acv_amount) || 0) - (parseFloat(a.forecast_acv_amount) || 0)
    })
  }, [allDeals])

  // ── 4. Accounts Section ─────────────────────────────────────────────────
  const accountCards = useMemo(() => {
    const map = new Map<string, any[]>()
    allDeals.forEach((d: any) => {
      const acc = (d.account_name || 'Unknown Account').trim() || 'Unknown Account'
      if (!map.has(acc)) map.set(acc, [])
      map.get(acc)!.push(d)
    })
    return Array.from(map.entries())
      .map(([accountName, deals]) => {
        const totalAcv = deals.reduce((sum, d) => sum + (parseFloat(d.forecast_acv_amount) || 0), 0)
        const sortedDates = deals.map(d => d.close_date).filter(Boolean).sort()
        const nearestClose = sortedDates[0] || null
        const approvedCount = deals.filter(d => d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd').length
        const pendingCount = deals.filter(d => d.approval_status === 'Pending Approval').length
        const notSubmittedCount = deals.length - approvedCount - pendingCount
        return {
          accountName,
          dealsCount: deals.length,
          totalAcv,
          nearestClose,
          approvedCount,
          pendingCount,
          notSubmittedCount,
          deals,
        }
      })
      .sort((a, b) => b.totalAcv - a.totalAcv)
  }, [allDeals])

  // ── 5. What to Do Next Action List ──────────────────────────────────────
  const prioritizedActions = useMemo(() => {
    const items: {
      id: string
      oppId: string
      title: string
      description: string
      priority: 'high' | 'medium' | 'normal'
      actionLabel: string
      deal: any
    }[] = []

    allDeals.forEach((d: any) => {
      const amt = parseFloat(d.forecast_acv_amount) || 0
      const isApproved = d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd'
      const isPending = d.approval_status === 'Pending Approval'
      const isCommit = d.forecast_category === 'Commit'
      const hasClose = !!d.close_date
      const isPastClose = hasClose && d.close_date < (activeSnap?.snapshot_date || '') && d.forecast_category !== 'Closed'
      const missingDates = !d.service_start_date || !d.service_expiry_date

      if (isCommit && !isApproved && !isPending) {
        items.push({
          id: `submit_${d.opportunity_id_18}`,
          oppId: d.opportunity_id_18,
          title: `Submit approval request for ${d.opportunity_name}`,
          description: `Commit deal (${formatCurrency(amt)}) has not yet been submitted for management review.`,
          priority: 'high',
          actionLabel: 'Submit & Review',
          deal: d,
        })
      } else if (isPending) {
        items.push({
          id: `pending_${d.opportunity_id_18}`,
          oppId: d.opportunity_id_18,
          title: `Follow up on pending approval for ${d.opportunity_name}`,
          description: `Awaiting management sign-off on ${formatCurrency(amt)} renewal.`,
          priority: 'medium',
          actionLabel: 'Review Inquiries',
          deal: d,
        })
      } else if (isPastClose) {
        items.push({
          id: `delayed_${d.opportunity_id_18}`,
          oppId: d.opportunity_id_18,
          title: `Update close date on delayed renewal ${d.opportunity_name}`,
          description: `Target close date was ${formatDate(d.close_date)} (${formatCurrency(amt)}). Update date or log slippage.`,
          priority: 'high',
          actionLabel: 'Update Opportunity',
          deal: d,
        })
      } else if (missingDates) {
        items.push({
          id: `dates_${d.opportunity_id_18}`,
          oppId: d.opportunity_id_18,
          title: `Missing service dates on ${d.opportunity_name}`,
          description: `Service start or expiry date is unrecorded. Verify customer contract terms.`,
          priority: 'normal',
          actionLabel: 'Add Dates',
          deal: d,
        })
      }
    })

    return items.slice(0, 8)
  }, [allDeals, activeSnap?.snapshot_date])

  // ── 6. Key Dates Strip ──────────────────────────────────────────────────
  const keyDatesList = useMemo(() => {
    const events: {
      date: string
      type: 'Renewal Close' | 'Service Expiry'
      dealName: string
      accountName: string
      acv: number
      oppId: string
    }[] = []

    allDeals.forEach((d: any) => {
      const amt = parseFloat(d.forecast_acv_amount) || 0
      if (d.close_date) {
        events.push({
          date: d.close_date,
          type: 'Renewal Close',
          dealName: d.opportunity_name,
          accountName: d.account_name,
          acv: amt,
          oppId: d.opportunity_id_18,
        })
      }
      if (d.service_expiry_date) {
        events.push({
          date: d.service_expiry_date,
          type: 'Service Expiry',
          dealName: d.opportunity_name,
          accountName: d.account_name,
          acv: amt,
          oppId: d.opportunity_id_18,
        })
      }
    })

    return events
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10)
  }, [allDeals])

  // ── 7. Conditional Small Charts (>= 2 active categories only) ─────────────
  const activeForecastCats = forecastChartData.filter(d => d.value > 0)
  const activeApprovalStats = approvalChartData.filter(d => d.value > 0)
  const activeBUs = buChartData.filter(d => d.value > 0).map(d => ({
    ...d,
    label: d.label && d.label !== 'None' && d.label !== 'null' ? d.label : 'Unassigned',
  }))
  const activeRegions = regionChartData.filter(d => d.value > 0)

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

      {/* Scope / Period Information Line (Round 24) */}
      {(() => {
        const pInfo = data?.period_info
        const count = pInfo?.showing_count ?? kpis.total_count ?? 0
        const acv = pInfo?.showing_acv ?? kpis.total_acv ?? 0
        const periodLbl = pInfo?.period_label || data.resolved_quarter || globalFilters.period || 'current period'
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
          breakdown={kpis.approved_2nd_breakdown || (kpis.approved_2nd_count > 0 ? `incl. ${kpis.approved_2nd_count} Approved 2nd (${formatACV(kpis.approved_2nd_acv)})` : undefined)}
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
          {/* ══════════════════════════════════════════════════════════════
              SECTION 1: WHAT TO DO NEXT (PRIORITIZED ACTION LIST)
              Plain-language actionable items with direct drill-downs
              ══════════════════════════════════════════════════════════════ */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500 fill-amber-500/20" />
                  <span>What to Do Next</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Prioritized recommendations to secure management approval and advance renewals
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                {prioritizedActions.length} action item{prioritizedActions.length === 1 ? '' : 's'}
              </span>
            </div>

            {prioritizedActions.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 opacity-80" />
                <p className="font-semibold text-[var(--text-primary)]">All clear</p>
                <p>All deals in your portfolio are on track. No immediate actions required.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {prioritizedActions.map((action) => (
                  <div
                    key={action.id}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)] hover:border-teal-500/30 transition-all flex flex-col justify-between gap-3 shadow-2xs group"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                          action.priority === 'high'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : action.priority === 'medium'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                        }`}>
                          {action.priority} Priority
                        </span>
                        <span className="text-[11px] font-bold text-[var(--text-primary)] tabular-nums">
                          {formatCurrency(action.deal.forecast_acv_amount)}
                        </span>
                      </div>
                      <h4 className="font-bold text-xs text-[var(--text-primary)] line-clamp-1 group-hover:text-teal-600 transition-colors" title={action.title}>
                        {action.title}
                      </h4>
                      <p className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                        {action.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[var(--border)]/60 flex items-center justify-between text-xs">
                      <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[150px]">
                        {action.deal.account_name}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedOppId(action.oppId)}
                        className="text-teal-600 dark:text-teal-400 font-bold hover:underline inline-flex items-center gap-1 cursor-pointer text-xs"
                      >
                        <span>{action.actionLabel}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 2: RENEWAL TIMELINE (HORIZONTAL PROGRESSION)
              Deals plotted along target close periods without label overlap
              ══════════════════════════════════════════════════════════════ */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  <span>Renewal Timeline Progression</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Portfolio deals mapped across scheduled target close months
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {monthlyTimelineGroups.length} time bucket{monthlyTimelineGroups.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {monthlyTimelineGroups.map((group) => (
                <div
                  key={group.month}
                  className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/40 flex flex-col space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                    <div>
                      <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                        {group.month === 'Unscheduled' ? 'No Close Date' : formatDate(group.month)}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] block">
                        {formatDealsCount(group.deals.length)}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-teal-600 dark:text-teal-400 tabular-nums">
                      {formatACV(group.totalAcv)}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {group.deals.map((d: any) => (
                      <div
                        key={d.opportunity_id_18}
                        onClick={() => setSelectedOppId(d.opportunity_id_18)}
                        className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:border-teal-500/40 hover:shadow-xs transition-all cursor-pointer space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[160px]" title={d.opportunity_name}>
                            {d.opportunity_name}
                          </p>
                          <span className="text-xs font-semibold text-[var(--text-primary)] tabular-nums shrink-0">
                            {formatACV(d.forecast_acv_amount)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                          <span className="truncate max-w-[130px]">{d.account_name}</span>
                          <span className={`px-1.5 py-0.2 rounded font-semibold ${
                            d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : d.approval_status === 'Pending Approval'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          }`}>
                            {d.approval_status || 'Not submitted'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 3: DEAL BOARD BY CRM STAGE
              Kanban-style board grouping deals across active sales stages
              ══════════════════════════════════════════════════════════════ */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                  <span>Deal Board by CRM Stage</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Opportunities arranged across sales cycle progression stages
                </p>
              </div>
              <span className="text-xs text-[var(--text-muted)]">
                {stageColumns.length} active stage{stageColumns.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {stageColumns.map((col) => (
                <div
                  key={col.stage}
                  className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/30 flex flex-col space-y-3"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
                    <span className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[120px]" title={col.stage}>
                      {col.stage}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                      {col.deals.length}
                    </span>
                  </div>
                  <div className="text-[11px] font-bold text-teal-600 dark:text-teal-400 tabular-nums">
                    {formatCurrency(col.totalAcv)}
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {col.deals.map((d: any) => (
                      <div
                        key={d.opportunity_id_18}
                        onClick={() => setSelectedOppId(d.opportunity_id_18)}
                        className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:border-teal-500/40 hover:shadow-xs transition-all cursor-pointer space-y-1.5"
                      >
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate" title={d.opportunity_name}>
                          {d.opportunity_name}
                        </p>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-primary)] tabular-nums">
                            {formatCurrency(d.forecast_acv_amount)}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[90px]">
                            {d.account_name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[var(--border)]/50">
                          <span className="text-[var(--text-muted)] font-mono">
                            {d.close_date ? formatDate(d.close_date) : 'No Date'}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded font-semibold ${
                            d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : d.approval_status === 'Pending Approval'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          }`}>
                            {d.approval_status || 'Not submitted'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 4: APPROVAL TRACKER PER DEAL
              Step progress tracker: Not Submitted -> Pending Approval -> Approved
              ══════════════════════════════════════════════════════════════ */}
          <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Approval Sign-off Tracker</span>
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Multi-stage management sign-off progress for each portfolio renewal
                </p>
              </div>
              <span className="text-xs font-semibold text-[var(--text-muted)]">
                {formatDealsCount(approvalTrackerDeals.length)} tracked
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                    <th className="pb-2.5 px-3">Opportunity</th>
                    <th className="pb-2.5 px-3">Account</th>
                    <th className="pb-2.5 px-3 text-right">ACV Amount</th>
                    <th className="pb-2.5 px-4 text-center">Approval Progress</th>
                    <th className="pb-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {approvalTrackerDeals.map((d: any) => {
                    const isApproved = d.approval_status === 'Approved' || d.approval_status === 'Approved - 2nd'
                    const isPending = d.approval_status === 'Pending Approval'
                    const stepNumber = isApproved ? 3 : isPending ? 2 : 1

                    return (
                      <tr
                        key={d.opportunity_id_18}
                        onClick={() => setSelectedOppId(d.opportunity_id_18)}
                        className="hover:bg-[var(--bg-secondary)]/50 transition-colors cursor-pointer group"
                      >
                        <td className="py-3 px-3 max-w-[220px]">
                          <p className="font-bold text-[var(--text-primary)] truncate group-hover:text-teal-600 transition-colors" title={d.opportunity_name}>
                            {d.opportunity_name}
                          </p>
                          <span className="text-[10px] text-[var(--text-muted)] font-mono">{d.opportunity_id_18}</span>
                        </td>
                        <td className="py-3 px-3 max-w-[140px] truncate text-[var(--text-secondary)]">
                          {d.account_name}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-[var(--text-primary)] tabular-nums">
                          {formatCurrency(d.forecast_acv_amount)}
                        </td>
                        <td className="py-3 px-4">
                          {/* 3-Step Visual Progress Indicator */}
                          <div className="flex items-center justify-center gap-1.5 max-w-xs mx-auto">
                            {/* Step 1: Not Submitted */}
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                              stepNumber >= 1
                                ? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/20'
                                : 'opacity-40'
                            }`}>
                              <span>1. Pipeline</span>
                            </div>
                            <span className="text-[var(--text-muted)]">→</span>

                            {/* Step 2: Pending Approval */}
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                              stepNumber === 2
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 ring-1 ring-amber-500/40 animate-pulse'
                                : stepNumber > 2
                                ? 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border border-slate-500/20'
                                : 'opacity-30'
                            }`}>
                              <span>2. In Review</span>
                            </div>
                            <span className="text-[var(--text-muted)]">→</span>

                            {/* Step 3: Approved */}
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                              stepNumber === 3
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-bold'
                                : 'opacity-30'
                            }`}>
                              <Check className="w-2.5 h-2.5 shrink-0" />
                              <span>{d.approval_status === 'Approved - 2nd' ? 'Approved 2nd' : 'Approved'}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedOppId(d.opportunity_id_18)
                            }}
                            className="text-teal-600 dark:text-teal-400 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════
              SECTION 5: KEY DATES & DEADLINES STRIP
              Chronological upcoming milestones (Close Dates & Service Expirations)
              ══════════════════════════════════════════════════════════════ */}
          {keyDatesList.length > 0 && (
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Clock className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Key Dates &amp; Milestone Schedule</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Upcoming renewal target close dates and contract service end dates
                  </p>
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {keyDatesList.length} date milestone{keyDatesList.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {keyDatesList.map((evt, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedOppId(evt.oppId)}
                    className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/40 hover:bg-[var(--bg-secondary)] hover:border-teal-500/40 transition-all cursor-pointer space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-teal-600 dark:text-teal-400 font-mono">
                        {formatDate(evt.date)}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                        evt.type === 'Renewal Close'
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                      }`}>
                        {evt.type}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate" title={evt.dealName}>
                      {evt.dealName}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]/50">
                      <span className="truncate max-w-[100px]">{evt.accountName}</span>
                      <span className="font-bold text-[var(--text-primary)] tabular-nums">{formatACV(evt.acv)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              SECTION 6: TOP ACCOUNTS SECTION
              Card per customer account with value, deal count, and nearest close
              ══════════════════════════════════════════════════════════════ */}
          {accountCards.length > 0 && (
            <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Customer Accounts Distribution</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Account-level exposure, renewal volume, and pending sign-offs
                  </p>
                </div>
                <span className="text-xs text-[var(--text-muted)]">
                  {accountCards.length} account{accountCards.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {accountCards.map((acc) => (
                  <div
                    key={acc.accountName}
                    onClick={() => openDeals(`${acc.accountName} Deals (${acc.dealsCount})`, acc.deals)}
                    className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/30 hover:bg-[var(--bg-secondary)] hover:border-teal-500/30 transition-all cursor-pointer space-y-2 shadow-2xs group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <h4 className="font-bold text-xs text-[var(--text-primary)] group-hover:text-teal-600 transition-colors truncate max-w-[190px]" title={acc.accountName}>
                          {acc.accountName}
                        </h4>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {formatDealsCount(acc.dealsCount)}
                        </span>
                      </div>
                      <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                        {formatCurrency(acc.totalAcv)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]/60 text-[10px]">
                      <span className="text-[var(--text-muted)]">
                        Nearest: <strong className="text-[var(--text-secondary)]">{acc.nearestClose ? formatDate(acc.nearestClose) : '—'}</strong>
                      </span>
                      <div className="flex items-center gap-1 font-semibold">
                        {acc.approvedCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            {acc.approvedCount} Appr
                          </span>
                        )}
                        {acc.pendingCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            {acc.pendingCount} Pend
                          </span>
                        )}
                        {acc.notSubmittedCount > 0 && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300">
                            {acc.notSubmittedCount} Open
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              SECTION 7: SMALL CHARTS (ONLY WHEN >= 2 ACTIVE CATEGORIES)
              Removes look-alike bar charts; renders compact charts only when meaningful
              ══════════════════════════════════════════════════════════════ */}
          {(activeForecastCats.length >= 2 || activeApprovalStats.length >= 2 || activeBUs.length >= 2 || activeRegions.length >= 2) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                    <span>Portfolio Concentration Analytics</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Categorical breakdowns displaying 2 or more distinct pipeline distributions
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {activeForecastCats.length >= 2 && (
                  <ChartCard
                    title="Forecast Category Split"
                    subtitle="Breakdown of ACV by pipeline stage"
                    type="horizontal-bars"
                    data={activeForecastCats}
                    total={kpis.total_acv}
                  />
                )}
                {activeApprovalStats.length >= 2 && (
                  <ChartCard
                    title="Approval Status Distribution"
                    subtitle="Management approval compliance"
                    type="horizontal-bars"
                    data={activeApprovalStats}
                    total={kpis.total_acv}
                  />
                )}
                {activeBUs.length >= 2 && (
                  <ChartCard
                    title="Business Unit Split"
                    subtitle="ACV distribution across business units"
                    type="horizontal-bars"
                    data={activeBUs}
                    total={kpis.total_acv}
                  />
                )}
                {activeRegions.length >= 2 && (
                  <ChartCard
                    title="Regional Distribution"
                    subtitle="ACV by geographical territory"
                    type="horizontal-bars"
                    data={activeRegions}
                    total={kpis.total_acv}
                  />
                )}
              </div>
            </div>
          )}
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
