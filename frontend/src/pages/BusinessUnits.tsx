import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2,
  Search,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  ChevronRight,
  Sparkles,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertCircle
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import api from '@/api/client'
import { formatACV, formatCount, formatCurrency, getForecastCategoryLabel } from '@/utils/format'
import Card from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import { PageErrorState } from '@/components/ui/PageErrorState'
import Drawer from '@/components/ui/Drawer'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import CompactGrid from '@/components/common/CompactGrid'
import MetricToggle from '@/components/common/MetricToggle'
import SummaryLine from '@/components/common/SummaryLine'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import SectionNav from '@/components/common/SectionNav'

type MetricMode = 'Amount' | 'Count' | 'Both'

function getCategoryBadgeStyle(cat: string) {
  switch (cat) {
    case 'Closed':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
    case 'Commit':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20'
    case 'Best Case':
      return 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20'
    case 'Pipeline':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
    case 'Blank':
    case 'Not yet proposed':
    default:
      return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
  }
}

function BusinessUnitsContent() {
  const { activeSnapshotId, globalFilters, setGlobalFilters } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode

  const [compare, setCompare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')

  // Drawer state for drill-through
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTitle, setDrawerTitle] = useState('')
  const [drawerSubtitle, setDrawerSubtitle] = useState('')
  const [drawerFilters, setDrawerFilters] = useState<{ bu?: string; category?: string }>({})
  const [drawerSearch, setDrawerSearch] = useState('')

  // Opportunity Detail drawer
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  // Top opportunities table filters
  const [topSearch, setTopSearch] = useState('')
  const [topBuFilter, setTopBuFilter] = useState('All')

  // Fetch summary
  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ['v2-bu-summary', activeSnapshotId, compare, globalFilters?.period, globalFilters?.include_deleted_lost],
    queryFn: async () => {
      const res = await api.get('/v2/business-units/summary', {
        params: {
          as_of: activeSnapshotId ?? undefined,
          compare,
          period: globalFilters?.period,
          exclude_deleted_lost: globalFilters?.include_deleted_lost === false ? true : undefined,
        }
      })
      return res.data
    },
  })

  // Fetch Deals for Drawer
  const { data: dealsData, isLoading: isDealsLoading } = useQuery({
    queryKey: ['v2-bu-deals', activeSnapshotId, drawerFilters, globalFilters?.period, globalFilters?.include_deleted_lost],
    queryFn: async () => {
      const res = await api.get('/v2/business-units/deals', {
        params: {
          as_of: activeSnapshotId ?? undefined,
          period: globalFilters?.period,
          exclude_deleted_lost: globalFilters?.include_deleted_lost === false ? true : undefined,
          ...drawerFilters,
        }
      })
      return res.data
    },
    enabled: drawerOpen
  })

  // Fetch Top Opportunities
  const { data: topOppsData, isLoading: isTopLoading } = useQuery({
    queryKey: ['v2-bu-top', activeSnapshotId, topBuFilter, globalFilters?.period, globalFilters?.include_deleted_lost],
    queryFn: async () => {
      const res = await api.get('/v2/business-units/top-opportunities', {
        params: {
          as_of: activeSnapshotId ?? undefined,
          bu: topBuFilter === 'All' ? undefined : topBuFilter,
          period: globalFilters?.period,
          exclude_deleted_lost: globalFilters?.include_deleted_lost === false ? true : undefined,
        }
      })
      return res.data
    }
  })

  // Handle drill-through from any cell, row, total, or BU share item
  const handleCellClick = (rowId: string | null, colId: string | null, title: string) => {
    const isRowTotal = !rowId || rowId === 'Total' || rowId === 'All' || rowId === 'Grand Total'
    const isColTotal = !colId || colId === 'Total' || colId === 'All' || colId === 'Grand Total'

    const bu = isRowTotal ? undefined : rowId
    const category = isColTotal ? undefined : colId

    let formattedTitle = title
    if (!bu && !category) {
      formattedTitle = 'All Business Units · All Categories'
    } else if (bu && !category) {
      formattedTitle = `${bu} · All Categories`
    } else if (!bu && category) {
      formattedTitle = `All Business Units · ${category === 'Blank' ? 'Not yet proposed' : category}`
    } else if (bu && category) {
      formattedTitle = `${bu} · ${category === 'Blank' ? 'Not yet proposed' : category}`
    }

    setDrawerTitle(formattedTitle)
    setDrawerSubtitle('Loading deals...')
    setDrawerFilters({ bu, category })
    setDrawerSearch('')
    setDrawerOpen(true)
  }

  const handleBuShareClick = (bu: string) => {
    handleCellClick(bu, null, `${bu} · All Categories`)
  }

  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || (summary && summary.error)) {
    return <PageErrorState message={error?.toString() || summary?.error || "Couldn't load this page. Try again"} onRetry={() => refetch()} />
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }

  if (!summary || !summary.total) {
    return <PageNoSnapshotState />
  }

  const { data_slice, total, rows, totals, categories } = summary

  const deltaKey = compare === 'yesterday' ? 'delta_yesterday' : 'delta_lastweek'
  const prevDate = compare === 'yesterday' ? rows[0]?.yesterday_date : rows[0]?.lastweek_date

  // Formatting helpers for deltas
  const fmtD = (val: number, isCount: boolean) => {
    if (!val) return '0'
    const sign = val > 0 ? '+' : ''
    if (isCount) return `${sign}${val}`
    const abs = Math.abs(val)
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
    return `${sign}$${val.toFixed(0)}`
  }

  const deltaSpan = (d: any, isCount: boolean) => {
    if (!d) return <span className="text-[var(--text-muted)]">—</span>
    const v = isCount ? d.count : d.acv
    if (!v) return <span className="text-[var(--text-muted)]">0</span>
    const color = v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    return <span className={`font-mono font-semibold tabular-nums ${color}`}>{fmtD(v, isCount)}</span>
  }

  // Stat metrics
  const sortedRowsByAcv = [...rows].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
  const largestBu = sortedRowsByAcv[0] || null
  const numBUs = rows.length
  const totalCommit = totals.categories['Commit']?.acv || 0
  const commitCov = total.acv > 0 ? ((totalCommit / total.acv) * 100).toFixed(1) : '0.0'
  const largestBuPct = total.acv > 0 && largestBu ? ((largestBu.acv / total.acv) * 100).toFixed(1) : '0.0'

  // Heatmap rows
  const displayCategories = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
  const gridRows = rows.map((r: any) => ({
    id: r.bu,
    label: r.bu,
    cells: r.cells,
    total: { count: r.count, acv: r.acv }
  }))
  const gridDeltas = {
    category: totals.categories,
    grand: totals.grand,
    rows: Object.fromEntries(rows.map((r: any) => [r.bu, {
      delta_yesterday: r.delta_yesterday,
      delta_lastweek: r.delta_lastweek,
      cells: Object.fromEntries(categories.map((c: string) => [c, {
        delta_yesterday: r.cells[c]?.delta_yesterday,
        delta_lastweek: r.cells[c]?.delta_lastweek,
      }]))
    }]))
  }

  // Filter drawer deals
  const drawerDeals = dealsData?.deals || []
  const filteredDrawerDeals = drawerDeals.filter((d: any) => {
    if (!drawerSearch.trim()) return true
    const q = drawerSearch.toLowerCase()
    return (
      d.opportunity_name?.toLowerCase().includes(q) ||
      d.account_name?.toLowerCase().includes(q) ||
      d.owner_name?.toLowerCase().includes(q)
    )
  })

  // Filter top opportunities
  const topDeals = topOppsData?.deals || []
  const filteredTopDeals = topDeals.filter((d: any) =>
    d.opportunity_name?.toLowerCase().includes(topSearch.toLowerCase()) ||
    d.account_name?.toLowerCase().includes(topSearch.toLowerCase())
  )

  const buSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (total?.count != null) {
      list.push({ id: 'bu-kpi-summary', title: 'KPI Summary' })
    }
    if (rows && rows.length > 0) {
      list.push({ id: 'bu-heatmap-share', title: 'Heatmap & BU Share' })
      list.push({ id: 'bu-coverage-table', title: 'Portfolio Coverage' })
    }
    if (topDeals && topDeals.length > 0) {
      list.push({ id: 'bu-top-opps', title: 'Top Opportunities' })
    }
    return list
  }, [total, rows, topDeals])

  return (
    <div className="space-y-6 w-full pb-12">
      <SectionNav sections={buSections} />

      {/* 1. Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                Business Units
              </h1>
              <span className="px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] text-xs font-mono font-medium">
                {data_slice}
              </span>
              {/* Source Check Badge */}
              {summary?.source_check && (
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                    summary.source_check.status === 'reconciles'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                  }`}
                  title={
                    summary.source_check.status === 'reconciles'
                      ? `Source check: reconciles (${summary.source_check.total_cells_checked} cells verified against raw snapshot rows)`
                      : `Source check: ${summary.source_check.diffs?.map((d: any) => `${d.cell}: exp ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`).join('; ')}`
                  }
                >
                  {summary.source_check.status === 'reconciles' ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>Source check: reconciles</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>Source check: {summary.source_check.message}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Portfolio distribution, category coverage, and multi-unit performance
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
          {/* Period Scope Toggle */}
          <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setGlobalFilters({ period: 'current_quarter' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                globalFilters?.period !== 'all' && globalFilters?.period !== 'all_periods'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              Current Quarter
            </button>
            <button
              onClick={() => setGlobalFilters({ period: 'all_periods' })}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                globalFilters?.period === 'all' || globalFilters?.period === 'all_periods'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              All Periods
            </button>
          </div>

          {/* Compare toggle */}
          <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setCompare('yesterday')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                compare === 'yesterday'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              vs Yesterday
            </button>
            <button
              onClick={() => setCompare('last_week')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                compare === 'last_week'
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              vs Last Week
            </button>
          </div>

          <MetricToggle />
        </div>
      </div>

      {/* 2. KPI Strip: 4 equal cards on 12-col grid */}
      <div id="bu-kpi-summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 scroll-mt-24">
        {/* Card 1: Total Portfolio ACV */}
        <div className="card p-4 flex flex-col justify-between gap-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] truncate" title="Total Portfolio ACV">
                Total Portfolio ACV
              </span>
              <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                {formatCount(total.count)} deals
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight">
              {formatACV(total.acv)}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {data_slice}
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs yesterday</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(totals.grand.delta_yesterday, false)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs last week</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(totals.grand.delta_lastweek, false)}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Active Business Units */}
        <div className="card p-4 flex flex-col justify-between gap-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] truncate" title="Active Business Units">
                Active Business Units
              </span>
              <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                {numBUs} units
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight">
              {numBUs}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Tracked individually
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs yesterday</span>
              <span className="text-xs text-[var(--text-muted)]">—</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs last week</span>
              <span className="text-xs text-[var(--text-muted)]">—</span>
            </div>
          </div>
        </div>

        {/* Card 3: Largest Business Unit */}
        <div className="card p-4 flex flex-col justify-between gap-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] truncate" title="Largest Business Unit">
                Largest Business Unit
              </span>
              <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                {largestBuPct}% of total
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight truncate" title={largestBu?.bu || '—'}>
              {largestBu?.bu || '—'}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {formatACV(largestBu?.acv || 0)}
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs yesterday</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(largestBu?.delta_yesterday, false)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs last week</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(largestBu?.delta_lastweek, false)}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Commit Coverage */}
        <div className="card p-4 flex flex-col justify-between gap-2.5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] truncate" title="Commit Coverage">
                Commit Coverage
              </span>
              <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                {formatACV(totalCommit)} Commit
              </span>
            </div>
            <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight">
              {commitCov}%
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Commit / Total ACV
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs yesterday</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(totals.categories['Commit']?.delta_yesterday, false)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] font-normal text-xs">vs last week</span>
              <span className="text-xs tabular-nums text-right">{deltaSpan(totals.categories['Commit']?.delta_lastweek, false)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Equal-Height 12-Column Grid: Heatmap (8 cols) + BU Share (4 cols) */}
      <div id="bu-heatmap-share" className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch scroll-mt-24">
        {/* Heatmap Card (8 cols) */}
        <div className="xl:col-span-8 flex flex-col">
          <CompactGrid
            title="BU x Forecast Category Heatmap"
            rowLabelName="Business Unit"
            columns={displayCategories}
            rows={gridRows}
            totals={{ category: totals.categories, grand: totals.grand }}
            deltas={gridDeltas}
            metricMode={metricMode}
            onCellClick={handleCellClick}
            compareDate={prevDate}
            yesterdayDate={summary.yesterday_date}
            lastweekDate={summary.lastweek_date}
            heatMode={heatMode}
          />
        </div>

        {/* Ranked Bar: BU Share Card (4 cols) - Matches Heatmap Height */}
        <div className="xl:col-span-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  BU Share of Total ACV
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Ranked portfolio weight
                </p>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                {formatACV(total.acv)}
              </span>
            </div>

            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {sortedRowsByAcv.map((r: any) => {
                const pct = total.acv > 0 ? (r.acv / total.acv) * 100 : 0
                return (
                  <div
                    key={r.bu}
                    onClick={() => handleBuShareClick(r.bu)}
                    className="group cursor-pointer hover:bg-[var(--bg-muted)]/70 p-2 rounded-lg transition-colors border border-transparent hover:border-[var(--border)]"
                    title={`${r.bu}: ${formatCurrency(r.acv)} (${pct.toFixed(1)}% of total ACV) · Click to view deals`}
                  >
                    <div className="flex justify-between items-baseline text-xs mb-1.5">
                      <span className="font-medium text-[var(--text-primary)] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate max-w-[170px]">
                        {r.bu}
                      </span>
                      <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0">
                        <span className="font-bold text-[var(--text-primary)]">{pct.toFixed(1)}%</span>
                        <span className="text-[11px] text-[var(--text-muted)]">({formatACV(r.acv)})</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-[var(--bg-muted)] rounded-full overflow-hidden border border-[var(--border)]/50">
                      <div
                        className="h-full bg-indigo-500 group-hover:bg-indigo-600 transition-all rounded-full"
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
            <span>{rows.length} units · Multi-value distinct</span>
            <span className="text-indigo-600 dark:text-indigo-400 font-medium inline-flex items-center gap-1">
              Click row to view deals <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>

      {/* 4. Portfolio Coverage & Movement Table (Analytical Breakdown replacing duplicate heatmap) */}
      <div id="bu-coverage-table" className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden scroll-mt-24">
        <div className="p-4 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Portfolio Coverage & Movement by Business Unit
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Category commitments, pipeline reserves, and delta trajectory per unit
            </p>
          </div>
          <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            <span>Click any row to open deals drawer</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 bg-[var(--bg-secondary)] z-20 py-2.5 px-4 font-semibold border-r border-[var(--border)] shadow-xs">Business Unit</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total ACV</th>
                <th className="py-2.5 px-3 font-semibold text-right">% Share</th>
                <th className="py-2.5 px-3 font-semibold text-right">Commit ACV</th>
                <th className="py-2.5 px-3 font-semibold text-right">Commit Cov %</th>
                <th className="py-2.5 px-3 font-semibold text-right">Best Case</th>
                <th className="py-2.5 px-3 font-semibold text-right">Pipeline</th>
                <th className="py-2.5 px-3 font-semibold text-right">Not Yet Proposed</th>
                <th className="py-2.5 px-3 font-semibold text-right">Δ vs Yesterday</th>
                <th className="py-2.5 px-3 font-semibold text-right">Δ vs Last Week</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sortedRowsByAcv.map((r: any) => {
                const sharePct = total.acv > 0 ? (r.acv / total.acv) * 100 : 0
                const commitAcv = r.cells?.['Commit']?.acv || 0
                const commitCovPct = r.acv > 0 ? (commitAcv / r.acv) * 100 : 0
                const bestCaseAcv = r.cells?.['Best Case']?.acv || 0
                const pipelineAcv = r.cells?.['Pipeline']?.acv || 0
                const blankAcv = r.cells?.['Blank']?.acv || 0

                return (
                  <tr
                    key={r.bu}
                    onClick={() => handleCellClick(r.bu, null, `${r.bu} · All Categories`)}
                    className="hover:bg-[var(--bg-muted)]/60 cursor-pointer transition-colors group"
                  >
                    <td className="sticky left-0 bg-[var(--bg-card)] group-hover:bg-[var(--bg-hover)] z-10 py-2.5 px-4 font-semibold text-[var(--text-primary)] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 border-r border-[var(--border)] shadow-xs">
                      {r.bu}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                      {formatCurrency(r.acv)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {sharePct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-sky-600 dark:text-sky-400 font-semibold">
                      {formatCurrency(commitAcv)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] ${
                        commitCovPct >= 50
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                          : 'text-[var(--text-secondary)]'
                      }`}>
                        {commitCovPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-violet-600 dark:text-violet-400">
                      {formatCurrency(bestCaseAcv)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {formatCurrency(pipelineAcv)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatCurrency(blankAcv)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {deltaSpan(r.delta_yesterday, false)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {deltaSpan(r.delta_lastweek, false)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-[var(--bg-secondary)] border-t-2 border-[var(--border)] font-bold">
              <tr
                onClick={() => handleCellClick(null, null, 'All Business Units · All Categories')}
                className="hover:bg-[var(--bg-muted)]/80 cursor-pointer"
              >
                <td className="sticky left-0 bg-[var(--bg-secondary)] z-10 py-2.5 px-4 font-bold text-[var(--text-primary)] border-r border-[var(--border)] shadow-xs">TOTAL</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                  {formatCurrency(total.acv)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                  100.0%
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-sky-600 dark:text-sky-400">
                  {formatCurrency(totalCommit)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                  {commitCov}%
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-violet-600 dark:text-violet-400">
                  {formatCurrency(totals.categories['Best Case']?.acv || 0)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {formatCurrency(totals.categories['Pipeline']?.acv || 0)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-slate-500 dark:text-slate-400">
                  {formatCurrency(totals.categories['Blank']?.acv || 0)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums">
                  {deltaSpan(totals.grand.delta_yesterday, false)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums">
                  {deltaSpan(totals.grand.delta_lastweek, false)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 5. Top Opportunities Section */}
      <div id="bu-top-opps" className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs p-5 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Top Opportunities by Business Unit
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              High-value renewals sorted by ACV
            </p>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by deal or account..."
              value={topSearch}
              onChange={e => setTopSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-indigo-500 w-64"
            />
          </div>
        </div>

        {/* BU Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-3 mb-3 scrollbar-thin">
          <button
            onClick={() => setTopBuFilter('All')}
            className={`px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors border ${
              topBuFilter === 'All'
                ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-muted)]'
            }`}
          >
            All Units
          </button>
          {rows.map((r: any) => (
            <button
              key={r.bu}
              onClick={() => setTopBuFilter(r.bu)}
              className={`px-3 py-1 text-xs font-medium rounded-lg whitespace-nowrap transition-colors border ${
                topBuFilter === r.bu
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-muted)]'
              }`}
            >
              {r.bu}
            </button>
          ))}
        </div>

        {/* Opportunities Table */}
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)] sticky top-0">
              <tr>
                <th className="sticky left-0 bg-[var(--bg-secondary)] z-20 py-2.5 px-3 font-semibold border-r border-[var(--border)] shadow-xs">Opportunity</th>
                <th className="py-2.5 px-3 font-semibold">Account</th>
                <th className="py-2.5 px-3 font-semibold text-right">ACV</th>
                <th className="py-2.5 px-3 font-semibold text-center">Category</th>
                <th className="py-2.5 px-3 font-semibold">Close Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filteredTopDeals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--text-muted)]">
                    No opportunities found
                  </td>
                </tr>
              ) : (
                filteredTopDeals.map((d: any) => (
                  <tr
                    key={d.opportunity_id_18}
                    onClick={() => setSelectedOppId(d.opportunity_id_18)}
                    className="hover:bg-[var(--bg-muted)]/60 cursor-pointer transition-colors group"
                  >
                    <td className="sticky left-0 bg-[var(--bg-card)] group-hover:bg-[var(--bg-hover)] z-10 py-2.5 px-3 font-medium text-[var(--text-primary)] truncate max-w-[260px] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 border-r border-[var(--border)] shadow-xs" title={d.opportunity_name}>
                      {d.opportunity_name}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)] truncate max-w-[180px]">{d.account_name}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                      {formatCurrency(d.forecast_acv_amount)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getCategoryBadgeStyle(d.forecast_category)}`}>
                        {d.forecast_category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-muted)] font-mono">
                      {d.close_date ? new Date(d.close_date).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. Click-Through Deals Slide-Out Drawer */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={drawerTitle}
        subtitle={
          isDealsLoading
            ? 'Loading deals...'
            : `${dealsData?.count ?? 0} deals · ${formatCurrency(dealsData?.acv ?? 0)} total ACV`
        }
        size="xl"
      >
        <div className="space-y-4">
          {/* Drawer Search & Summary */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search deals in this segment..."
                value={drawerSearch}
                onChange={e => setDrawerSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="text-xs text-[var(--text-muted)] shrink-0 font-mono">
              Showing <span className="font-semibold text-[var(--text-primary)]">{filteredDrawerDeals.length}</span> of {dealsData?.count ?? 0} deals
            </div>
          </div>

          {/* Deals Table */}
          {isDealsLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
            </div>
          ) : filteredDrawerDeals.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-xl">
              <p className="text-sm font-medium">No deals match your search criteria</p>
              <p className="text-xs mt-1">Try clearing the search filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)] sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Opportunity Name</th>
                    <th className="py-2.5 px-3 font-semibold">Account</th>
                    <th className="py-2.5 px-3 font-semibold text-right">ACV</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Category</th>
                    <th className="py-2.5 px-3 font-semibold">Stage</th>
                    <th className="py-2.5 px-3 font-semibold">Close Date</th>
                    <th className="py-2.5 px-3 font-semibold">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredDrawerDeals.map((deal: any) => (
                    <tr
                      key={deal.opportunity_id_18}
                      onClick={() => setSelectedOppId(deal.opportunity_id_18)}
                      className="hover:bg-[var(--bg-muted)]/60 cursor-pointer transition-colors group"
                    >
                      <td className="py-2.5 px-3 font-medium text-[var(--text-primary)] max-w-[200px] truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400" title={deal.opportunity_name}>
                        {deal.opportunity_name}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)] max-w-[150px] truncate" title={deal.account_name}>
                        {deal.account_name}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                        {formatCurrency(deal.forecast_acv_amount)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${getCategoryBadgeStyle(deal.forecast_category)}`}>
                          {deal.forecast_category || 'Blank'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)] text-[11px] max-w-[120px] truncate" title={deal.stage}>
                        {deal.stage || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-muted)] text-[11px] font-mono">
                        {deal.close_date ? new Date(deal.close_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-muted)] text-[11px] max-w-[120px] truncate" title={deal.owner_name}>
                        {deal.owner_name || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Drawer Footer Metrics */}
          <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Click any deal row to open details</span>
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              Exact Cell ACV: {formatCurrency(dealsData?.acv ?? 0)}
            </span>
          </div>
        </div>
      </Drawer>

      {/* Opportunity Detail Drawer */}
      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />
    </div>
  )
}

export default function BusinessUnits() {
  return (
    <ErrorBoundary>
      <BusinessUnitsContent />
    </ErrorBoundary>
  )
}
