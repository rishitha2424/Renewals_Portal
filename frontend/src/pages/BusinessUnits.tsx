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
import DealListModal from '@/components/common/DealListModal'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import CompactGrid from '@/components/common/CompactGrid'
import MetricToggle from '@/components/common/MetricToggle'
import SummaryLine from '@/components/common/SummaryLine'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import SectionNav from '@/components/common/SectionNav'
import ExcludedTypesNote from '@/components/common/ExcludedTypesNote'
import Tile from '@/components/common/Tile'
import CardRow from '@/components/common/CardRow'
import ScrollList from '@/components/common/ScrollList'
import InsightCard from '@/components/common/InsightCard'
import ChartCard from '@/components/common/ChartCard'
import { getBusinessUnitsInsights, getBuTopDealsInsights } from '@/insights/generators'
import { CONCEPT_COLORS } from '@/design/conceptColors'

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

  // Modal state for drill-through
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<{ bu?: string; category?: string }>({})

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

  // Fetch Deals for Modal
  const { data: dealsData } = useQuery({
    queryKey: ['v2-bu-deals', activeSnapshotId, modalFilters, globalFilters?.period, globalFilters?.include_deleted_lost],
    queryFn: async () => {
      const res = await api.get('/v2/business-units/deals', {
        params: {
          as_of: activeSnapshotId ?? undefined,
          period: globalFilters?.period,
          exclude_deleted_lost: globalFilters?.include_deleted_lost === false ? true : undefined,
          ...modalFilters,
        }
      })
      return res.data
    },
    enabled: modalOpen
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

    setModalTitle(formattedTitle)
    setModalFilters({ bu, category })
    setModalOpen(true)
  }

  const handleBuShareClick = (bu: string) => {
    handleCellClick(bu, null, `${bu} · All Categories`)
  }

  const buSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (summary?.total?.count != null) {
      list.push({ id: 'bu-kpi-summary', title: 'KPI Summary' })
    }
    if (summary?.rows && summary.rows.length > 0) {
      list.push({ id: 'bu-heatmap-share', title: 'Heatmap & BU Share' })
      list.push({ id: 'bu-coverage-table', title: 'Portfolio Coverage' })
    }
    if (topOppsData?.deals && topOppsData.deals.length > 0) {
      list.push({ id: 'bu-top-opps', title: 'Top Opportunities' })
    }
    return list
  }, [summary, topOppsData])

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
    if (!d || d.count === undefined) return <span className="text-slate-400 dark:text-slate-500 font-normal">n/a</span>
    const v = isCount ? d.count : d.acv
    if (!v) return <span className="text-[var(--text-muted)]">0</span>
    const color = v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
    return <span className={`font-mono font-semibold tabular-nums ${color}`}>{fmtD(v, isCount)}</span>
  }

  // Stat metrics
  const sortedRowsByAcv = [...rows].sort((a: any, b: any) => (b.acv || 0) - (a.acv || 0))
  const largestBu = sortedRowsByAcv[0] || null
  const numBUs = rows.length
  const totalCommit = totals?.categories?.['Commit']?.acv || 0
  const commitCov = total.acv > 0 ? ((totalCommit / total.acv) * 100).toFixed(1) : '0.0'
  const largestBuPct = total.acv > 0 && largestBu ? ((largestBu.acv / total.acv) * 100).toFixed(1) : '0.0'

  // Heatmap rows - build categories dynamically from snapshot response, omitting categories with no deals
  const rawCategories = categories && categories.length > 0 ? categories : Object.keys(totals?.categories || {})
  const displayCategories = rawCategories.filter((c: string) => {
    const catTotal = totals?.categories?.[c]
    return catTotal ? (catTotal.count > 0 || (catTotal.acv != null && catTotal.acv !== 0)) : true
  })
  const nonCommitCategories = displayCategories.filter((c: string) => c !== 'Commit')
  const gridRows = rows.map((r: any) => ({
    id: r.bu,
    label: r.bu,
    cells: r.cells || {},
    total: { count: r.count, acv: r.acv }
  }))
  const gridDeltas = {
    category: totals?.categories || {},
    grand: totals?.grand || {},
    rows: Object.fromEntries(rows.map((r: any) => [r.bu, {
      delta_yesterday: r.delta_yesterday,
      delta_lastweek: r.delta_lastweek,
      cells: Object.fromEntries((categories || []).map((c: string) => [c, {
        delta_yesterday: r.cells?.[c]?.delta_yesterday,
        delta_lastweek: r.cells?.[c]?.delta_lastweek,
      }]))
    }]))
  }

  // Filter top opportunities
  const topDeals = topOppsData?.deals || []
  const filteredTopDeals = topDeals.filter((d: any) =>
    d.opportunity_name?.toLowerCase().includes(topSearch.toLowerCase()) ||
    d.account_name?.toLowerCase().includes(topSearch.toLowerCase())
  )

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
              {summary?.source_check && (() => {
                const total = summary.source_check.total_cells_checked || 0
                const diffCount = summary.source_check.diffs?.length || (summary.source_check.status === 'reconciles' ? 0 : 1)
                const passed = Math.max(0, total - diffCount)
                const isAllPassed = summary.source_check.status === 'reconciles' && diffCount === 0
                return (
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                      isAllPassed
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                    }`}
                    title={
                      isAllPassed
                        ? `${total} of ${total} checks passed against raw snapshot rows`
                        : `Checks failed: ${summary.source_check.diffs?.map((d: any) => `${d.cell}: exp ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`).join('; ') || summary.source_check.message}`
                    }
                  >
                    {isAllPassed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>{total} of {total} checks passed</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span>{passed} of {total} checks passed, {diffCount} failed</span>
                      </>
                    )}
                  </div>
                )
              })()}
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

      <ExcludedTypesNote
        excluded={summary?.other_types_excluded}
        onViewDeals={() => {
          setModalTitle('Other Types Excluded')
          setModalFilters({ kind: 'other_types' } as any)
          setModalOpen(true)
        }}
      />

      {(!isLoading && (total?.count ?? 0) === 0) && (
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]">
          No deals for this selection
        </div>
      )}

      {/* 2. KPI Strip: 4 equal cards on 12-col grid */}
      {(() => {
        const top3BUs = sortedRowsByAcv.slice(0, 3)
        const top3SumAcv = top3BUs.reduce((sum: number, r: any) => sum + (r.acv || 0), 0)
        const top3Share = total.acv > 0 ? ((top3SumAcv / total.acv) * 100).toFixed(1) : '0.0'
        const top3Summary = top3BUs.map((r: any) => `${r.bu} ${total.acv > 0 ? ((r.acv / total.acv) * 100).toFixed(0) : 0}%`).join(' · ')

        return (
          <div id="bu-kpi-summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 scroll-mt-24">
            {/* Card 1: Total Portfolio ACV */}
            <Tile
              tone="total"
              title="Total Portfolio ACV"
              amount={formatACV(total.acv)}
              count={total.count}
              subtitle={data_slice}
              deltaYesterday={{ count: totals?.grand?.delta_yesterday?.count, acv: totals?.grand?.delta_yesterday?.acv }}
              deltaLastWeek={{ count: totals?.grand?.delta_lastweek?.count, acv: totals?.grand?.delta_lastweek?.acv }}
            />

            {/* Card 2: Active Business Units */}
            <Tile
              tone="active_units"
              title="Active Business Units"
              amount={numBUs}
              badge={<span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">{numBUs} unit groups</span>}
              subtitle={
                <span title="Deals with several business units are counted as their own group" className="cursor-help">
                  Tracked individually ℹ
                </span>
              }
              footer={
                <div className="space-y-1 text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                  <div className="truncate" title={`Top: ${top3Summary}`}>
                    <span className="font-semibold text-[var(--text-secondary)]">Top:</span> {top3Summary}
                  </div>
                  <div className="font-semibold text-[var(--text-primary)] font-mono">
                    Share of top 3: {top3Share}%
                  </div>
                </div>
              }
            />

            {/* Card 3: Largest Business Unit */}
            <Tile
              tone="largest_bu"
              title="Largest Business Unit"
              amount={largestBu?.bu || '—'}
              badge={<span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">{largestBuPct}% of total</span>}
              subtitle={formatACV(largestBu?.acv || 0)}
              deltaYesterday={{ count: largestBu?.delta_yesterday?.count, acv: largestBu?.delta_yesterday?.acv }}
              deltaLastWeek={{ count: largestBu?.delta_lastweek?.count, acv: largestBu?.delta_lastweek?.acv }}
            />

            {/* Card 4: Commit Coverage */}
            <Tile
              tone="coverage"
              title="Commit Coverage"
              amount={`${commitCov}%`}
              badge={<span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">{formatACV(totalCommit)} Commit</span>}
              subtitle="Commit / Total ACV"
              deltaYesterday={{ count: totals?.categories?.['Commit']?.delta_yesterday?.count, acv: totals?.categories?.['Commit']?.delta_yesterday?.acv }}
              deltaLastWeek={{ count: totals?.categories?.['Commit']?.delta_lastweek?.count, acv: totals?.categories?.['Commit']?.delta_lastweek?.acv }}
            />
          </div>
        )
      })()}

      {/* 3. Equal-Height Grid: Heatmap (max-content) + BU Signals & Commit Coverage (1fr) + BU Share Donut (340px) */}
      <div id="bu-heatmap-share" className="scroll-mt-24">
        <CardRow cols="max-content minmax(0, 1fr) minmax(300px, 340px)" gap="gap-6">
          {/* Heatmap Card (max-content) */}
          <div className="card p-5 border border-[var(--border)] shadow-xs flex flex-col justify-between h-full w-full max-w-full">
            <div className="flex-1 min-h-0 flex flex-col">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 shrink-0">
                BU x Forecast Category Heatmap
              </h3>
              <div className="flex-1 min-h-0 overflow-x-auto">
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
                  hideCardWrapper={true}
                />
              </div>
            </div>

            {/* Stat strip below the table pinned to bottom */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 mt-auto border-t border-[var(--border-subtle)] text-[11px] shrink-0">
              <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                <span className="text-[var(--text-muted)] block text-[10px]">Business Units</span>
                <span className="font-bold text-[var(--text-primary)] font-mono">{numBUs} units</span>
              </div>
              <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                <span className="text-[var(--text-muted)] block text-[10px]">Total Deals</span>
                <span className="font-bold text-[var(--text-primary)] font-mono">{formatCount(total.count)} deals</span>
              </div>
              <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                <span className="text-[var(--text-muted)] block text-[10px]">Top BU Share</span>
                <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">{largestBuPct}% ({largestBu?.bu || '—'})</span>
              </div>
              <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                <span className="text-[var(--text-muted)] block text-[10px]">Commit Coverage</span>
                <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">{commitCov}%</span>
              </div>
            </div>
          </div>

          {/* Middle: BU Signals */}
          <div className="h-full min-w-0">
            <InsightCard
              title="Business unit signals"
              subtitle="Key signals and commitment trajectory"
              insights={getBusinessUnitsInsights(summary, (title, p) => handleCellClick(p?.bu, p?.category, title))}
            />
          </div>

          {/* Right: Ranked BU Share Donut Chart with scrollable legend */}
          <ChartCard
            type="donut"
            title="BU Share of Total ACV"
            subtitle="Ranked portfolio weight"
            total={total.acv}
            data={sortedRowsByAcv.map((r: any, idx: number) => {
              const pct = total.acv > 0 ? (r.acv / total.acv) * 100 : 0
              const colors = ['#00A3AD', '#1B365D', '#4B6B94', '#2563EB', '#6366F1', '#8B5CF6', '#EC4899', '#F58220', '#10B981', '#64748B']
              return {
                label: r.bu,
                value: r.acv || 0,
                formattedValue: formatACV(r.acv),
                percentage: pct,
                color: colors[idx % colors.length],
                onClick: () => handleBuShareClick(r.bu),
              }
            })}
            className="w-full max-w-[340px] min-w-0"
          />
        </CardRow>
      </div>

      {/* 4. Portfolio Coverage & Movement Table */}
      <div id="bu-coverage-table" className="space-y-4 scroll-mt-24">
        <ChartCard
          type="vertical-bars"
          title="Commit coverage by BU"
          subtitle="Percentage of renewals in Closed + Commit"
          data={sortedRowsByAcv.slice(0, 8).map((r: any) => {
            const cAcv = r.cells?.['Commit']?.acv || 0
            const clAcv = r.cells?.['Closed']?.acv || 0
            const cov = r.acv > 0 ? ((cAcv + clAcv) / r.acv) * 100 : 0
            return {
              label: r.bu,
              value: cAcv + clAcv,
              formattedValue: `${cov.toFixed(1)}%`,
              percentage: cov,
              sublabel: r.count ? `${formatCount(r.count)} ${r.count === 1 ? 'deal' : 'deals'}` : undefined,
              dealsCount: r.count,
              color: '#2563EB',
              onClick: () => handleCellClick(r.bu, 'Commit', `${r.bu} · Commit Deals`),
            }
          })}
          className="min-h-[180px]"
        />

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs overflow-hidden">
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
            <span>Click any row to view deals</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table w-full text-xs text-left whitespace-nowrap">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 bg-[var(--bg-secondary)] z-20 py-2.5 px-4 font-semibold border-r border-[var(--border)] shadow-xs">Business Unit</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total ACV</th>
                <th className="py-2.5 px-3 font-semibold text-right">% Share</th>
                <th className="py-2.5 px-3 font-semibold text-right">Commit ACV</th>
                <th className="py-2.5 px-3 font-semibold text-right">Commit Cov %</th>
                {nonCommitCategories.map((c: string) => (
                  <th key={c} className="py-2.5 px-3 font-semibold text-right">
                    {c === 'Blank' ? 'Deleted / lost in snapshot' : c}
                  </th>
                ))}
                <th className="py-2.5 px-3 font-semibold text-right">Δ vs Yesterday</th>
                <th className="py-2.5 px-3 font-semibold text-right">Δ vs Last Week</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sortedRowsByAcv.map((r: any) => {
                const sharePct = total.acv > 0 ? (r.acv / total.acv) * 100 : 0
                const commitAcv = r.cells?.['Commit']?.acv || 0
                const commitCovPct = r.acv > 0 ? (commitAcv / r.acv) * 100 : 0

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
                    {nonCommitCategories.map((c: string) => (
                      <td key={c} className="py-2.5 px-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                        {formatCurrency(r.cells?.[c]?.acv || 0)}
                      </td>
                    ))}
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
                {nonCommitCategories.map((c: string) => (
                  <td key={c} className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)]">
                    {formatCurrency(totals.categories[c]?.acv || 0)}
                  </td>
                ))}
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
    </div>

      {/* 5. Top Opportunities Section */}
      <div id="bu-top-opps" className="scroll-mt-24">
        <CardRow cols="max-content minmax(320px, 1fr)" gap="gap-6">
          {/* Opportunities Table Card (max-content) */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xs p-5 flex flex-col justify-between h-full w-full max-w-full">
            <div>
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
              <div className="overflow-x-auto rounded-lg border border-[var(--border)] table-compact-container">
                <table className="data-table text-left text-xs whitespace-nowrap">
                  <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] border-b border-[var(--border)] sticky top-0">
                    <tr>
                      <th className="sticky left-0 bg-[var(--bg-secondary)] z-20 py-2 px-3 font-semibold border-r border-[var(--border)] shadow-xs col-opp">Opportunity</th>
                      <th className="py-2 px-3 font-semibold col-account">Account</th>
                      <th className="py-2 px-3 font-semibold text-right col-stat">ACV</th>
                      <th className="py-2 px-3 font-semibold text-center col-meta">Forecast</th>
                      <th className="py-2 px-3 font-semibold text-right col-date">Close Date</th>
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
                          <td className="sticky left-0 bg-[var(--bg-card)] group-hover:bg-[var(--bg-hover)] z-10 py-2 px-3 font-medium text-[var(--text-primary)] col-opp group-hover:text-indigo-600 dark:group-hover:text-indigo-400 border-r border-[var(--border)] shadow-xs" title={d.opportunity_name}>
                            {d.opportunity_name}
                          </td>
                          <td className="py-2 px-3 text-[var(--text-secondary)] col-account" title={d.account_name}>{d.account_name}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-[var(--text-primary)] col-stat">
                            {formatCurrency(d.forecast_acv_amount)}
                          </td>
                          <td className="py-2 px-3 text-center col-meta">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${getCategoryBadgeStyle(d.forecast_category)}`}>
                              {d.forecast_category}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-[var(--text-muted)] font-mono text-right col-date">
                            {d.close_date ? new Date(d.close_date).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right: Highlights Card + Top deals by category chart (D) */}
          {(() => {
            const deals = filteredTopDeals || []
            const catMap: Record<string, number> = {}
            deals.forEach((d: any) => {
              const c = d.forecast_category || 'Other'
              catMap[c] = (catMap[c] || 0) + (d.forecast_acv_amount || 0)
            })
            const catData = Object.entries(catMap).map(([c, val]) => ({
              label: c,
              value: val,
              formattedValue: formatACV(val),
              color: c === 'Commit' ? '#10B981' : c === 'Best Case' ? '#F59E0B' : '#64748B',
            }))

            return (
              <div className="h-full flex flex-col gap-3 min-w-0">
                <InsightCard
                  title="BU opportunity signals"
                  subtitle="Deal concentration and key upside signals"
                  insights={getBuTopDealsInsights(topOppsData?.deals || [], total.acv, (id) => setSelectedOppId(id))}
                />
                {catData.length > 0 && (
                  <ChartCard
                    title="Top deals by category"
                    subtitle="ACV distribution among listed opportunities"
                    type="horizontal-bars"
                    data={catData}
                    className="min-h-[140px]"
                  />
                )}
              </div>
            )
          })()}
        </CardRow>
      </div>

      {/* 6. Click-Through Deals Slide-Out Drawer */}
      {/* 6. Click-Through Deals Centered Modal */}
      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={dealsData?.deals || []}
          initialFilters={{
            business_unit_primary: modalFilters?.bu || undefined,
            forecast_category: modalFilters?.category || undefined,
          }}
          onSelectOpp={(id) => {
            setSelectedOppId(id)
          }}
          onClose={() => setModalOpen(false)}
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

export default function BusinessUnits() {
  return (
    <ErrorBoundary>
      <BusinessUnitsContent />
    </ErrorBoundary>
  )
}
