import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Clock,
  CalendarX2,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import api from '@/api/client'
import { formatACV, formatCount } from '@/utils/format'
import Card from '@/components/ui/Card'
import SectionHeader from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import { PageErrorState } from '@/components/ui/PageErrorState'
import DealListModal from '@/components/common/DealListModal'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import CompactGrid from '@/components/common/CompactGrid'
import MetricToggle from '@/components/common/MetricToggle'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import { format, parseISO } from 'date-fns'
import clsx from 'clsx'

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')
type MetricMode = 'Amount' | 'Count' | 'Both'

function DelayedContent() {
  const { activeSnapshotId, globalFilters } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode

  const [compare, setCompare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<any>({})
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  const { compare: _ignored, ...filters } = globalFilters

  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ['v2-delayed-summary', activeSnapshotId, compare, filters],
    queryFn: async () => {
      const res = await api.get('/v2/delayed/summary', {
        params: { ...filters, as_of: activeSnapshotId ?? undefined, compare },
      })
      return res.data
    },
  })

  const { data: dealsData } = useQuery({
    queryKey: ['v2-delayed-deals', activeSnapshotId, compare, filters, modalFilters],
    queryFn: async () => {
      const res = await api.get('/v2/delayed/deals', {
        params: { ...filters, ...modalFilters, as_of: activeSnapshotId ?? undefined, compare },
      })
      return res.data
    },
    enabled: modalOpen,
  })

  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || summary?.error) {
    return <PageErrorState message={summary?.error || error?.toString() || "Couldn’t load this page. Try again"} onRetry={() => refetch()} />
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!summary || !summary.total) {
    return <PageNoSnapshotState />
  }

  const handleDrill = (title: string, filters: any = {}) => {
    setModalTitle(title)
    setModalFilters({ ...filters, compare, as_of: activeSnapshotId ?? undefined })
    setModalOpen(true)
  }

  const yDateStr = summary.yesterday_date ? format(parseISO(summary.yesterday_date), 'dd MMM') : 'Yday'
  const wDateStr = summary.lastweek_date ? format(parseISO(summary.lastweek_date), 'dd MMM') : 'Wk'

  const DualDeltaDisplay = ({ data }: { data: any }) => {
    if (!data) return null
    const yCount = data.delayed_vs_yesterday?.count ?? 0
    const yAcv = data.delayed_vs_yesterday?.acv ?? 0
    const wCount = data.delayed_vs_lastweek?.count ?? 0
    const wAcv = data.delayed_vs_lastweek?.acv ?? 0

    const renderDelta = (count: number, acv: number, label: string) => {
      const isPos = acv > 0 || count > 0 // in delays, increase is bad
      const isNeg = acv < 0 || count < 0
      const isZero = count === 0 && acv === 0

      const Icon = isPos ? ArrowUpRight : isNeg ? ArrowDownRight : Minus
      const val = isZero
        ? 'No change'
        : metricMode === 'Amount'
        ? formatACV(acv)
        : metricMode === 'Count'
        ? formatCount(count)
        : `${formatCount(count)} / ${formatACV(acv)}`

      // Soft muted background with dark text of the same hue
      const chipClasses = isZero
        ? 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-[#8A9BB5]'
        : isPos
        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'

      return (
        <span
          className={cn(
            'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-sm select-none tabular-nums transition-colors',
            chipClasses
          )}
          title={label}
        >
          <Icon className="w-3 h-3 mr-0.5" />
          <span className="opacity-70 mr-1">{label}</span>
          <span>{val}</span>
        </span>
      )
    }

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {renderDelta(yCount, yAcv, `vs ${yDateStr}`)}
        {renderDelta(wCount, wAcv, `vs ${wDateStr}`)}
      </div>
    )
  }

  // 4px left accent bar + 32px rounded-lg tinted icon tile
  const DelayedKpiCard = ({ title, definition, data, icon: Icon, accent, kind }: any) => {
    const accentBorder = {
      amber: 'border-l-amber-500',
      rose: 'border-l-rose-500',
      slate: 'border-l-slate-400',
      teal: 'border-l-[#00A3AD]',
    }[accent as 'amber' | 'rose' | 'slate' | 'teal'] || 'border-l-[#00A3AD]'

    const iconTileClass = {
      amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
      teal: 'bg-[#00A3AD]/10 text-[#00A3AD]',
    }[accent as 'amber' | 'rose' | 'slate' | 'teal'] || 'bg-[#00A3AD]/10 text-[#00A3AD]'

    return (
      <div
        className={cn(
          'rounded-xl bg-[var(--bg-card)] border border-[var(--border)] border-l-4 shadow-[var(--card-shadow)]',
          accentBorder,
          'p-4 flex flex-col justify-between h-full items-stretch transition-colors select-none cursor-pointer hover:bg-[var(--bg-secondary)]/50'
        )}
        onClick={() => handleDrill(title, { kind })}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {title}
            </span>
            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', iconTileClass)}>
              <Icon className="w-4 h-4" strokeWidth={1.75} />
            </div>
          </div>
          {definition && (
            <p className="text-[11px] text-[var(--text-muted)] leading-tight mb-2 min-h-[28px] line-clamp-2">
              {definition}
            </p>
          )}
          <div className="space-y-0.5 mb-2.5">
            {(metricMode === 'Count' || metricMode === 'Both') && (
              <div className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                {formatCount(data?.count || 0)}
              </div>
            )}
            {(metricMode === 'Amount' || metricMode === 'Both') && (
              <div className="text-sm font-medium text-[var(--text-muted)] tabular-nums">
                {formatACV(data?.acv || 0)}
              </div>
            )}
          </div>
        </div>
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <DualDeltaDisplay data={data} />
        </div>
      </div>
    )
  }

  const buildGrid = (byField: 'by_region' | 'by_bu', clickKey: 'region' | 'bu') => {
    const categories = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
    const totals = { category: {} as any, grand: { count: 0, acv: 0 } }
    const gridDeltas: any = {}

    summary[byField]?.forEach((row: any) => {
      totals.grand.count += row.count
      totals.grand.acv += row.acv
      categories.forEach((cat) => {
        if (!totals.category[cat]) totals.category[cat] = { count: 0, acv: 0 }
        totals.category[cat].count += row.categories?.[cat]?.count || 0
        totals.category[cat].acv += row.categories?.[cat]?.acv || 0
      })
    })

    const rows = (summary[byField] || []).map((row: any) => {
      const cells: Record<string, { count: number; acv: number }> = {}
      categories.forEach((cat) => {
        cells[cat] = {
          count: row.categories?.[cat]?.count || 0,
          acv: row.categories?.[cat]?.acv || 0,
        }
      })

      const isY = compare === 'yesterday'
      categories.forEach((cat) => {
        const catData = row.categories?.[cat]
        const dCount = isY ? (catData?.delayed_vs_yesterday?.count ?? 0) : (catData?.delayed_vs_lastweek?.count ?? 0)
        const dAcv = isY ? (catData?.delayed_vs_yesterday?.acv ?? 0) : (catData?.delayed_vs_lastweek?.acv ?? 0)
        gridDeltas[`${row.label}-${cat}`] = { count: dCount, acv: dAcv }
      })

      const rdCount = isY ? (row.delayed_vs_yesterday?.count ?? 0) : (row.delayed_vs_lastweek?.count ?? 0)
      const rdAcv = isY ? (row.delayed_vs_yesterday?.acv ?? 0) : (row.delayed_vs_lastweek?.acv ?? 0)
      gridDeltas[`${row.label}-total`] = { count: rdCount, acv: rdAcv }

      return {
        id: row.label,
        label: row.label,
        cells,
        total: { count: row.count, acv: row.acv },
      }
    })

    categories.forEach((cat) => {
      let dCount = 0
      let dAcv = 0
      summary[byField]?.forEach((row: any) => {
        const catData = row.categories?.[cat]
        dCount += compare === 'yesterday' ? (catData?.delayed_vs_yesterday?.count ?? 0) : (catData?.delayed_vs_lastweek?.count ?? 0)
        dAcv += compare === 'yesterday' ? (catData?.delayed_vs_yesterday?.acv ?? 0) : (catData?.delayed_vs_lastweek?.acv ?? 0)
      })
      gridDeltas[`total-${cat}`] = { count: dCount, acv: dAcv }
    })

    const dTotalCount = compare === 'yesterday' ? (summary.total?.delayed_vs_yesterday?.count ?? 0) : (summary.total?.delayed_vs_lastweek?.count ?? 0)
    const dTotalAcv = compare === 'yesterday' ? (summary.total?.delayed_vs_yesterday?.acv ?? 0) : (summary.total?.delayed_vs_lastweek?.acv ?? 0)
    gridDeltas['grand-total'] = { count: dTotalCount, acv: dTotalAcv }

    const handleCellClick = (rowId: string | null, colId: string | null, title: string) => {
      const filters: any = { kind: 'all' }
      if (rowId && rowId !== 'Total') filters[clickKey] = rowId
      if (colId && colId !== 'Total') filters.category = colId
      handleDrill(title || `Delayed Deals`, filters)
    }

    return { categories, rows, totals, gridDeltas, handleCellClick }
  }

  const regionGrid = buildGrid('by_region', 'region')
  const buGrid = buildGrid('by_bu', 'bu')

  return (
    <div className="space-y-6">
      {/* Aligned Section Header with integrated controls (no second filter bar) */}
      <SectionHeader
        title="Delayed Renewals"
        subtitle={`Renewals in ${summary.data_slice} that have slipped, pushed out, or are overdue.`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {summary.delayed_pct_of_quarter != null && (
              <div
                onClick={() => handleDrill('Total Delayed Renewals', { kind: 'all' })}
                className="cursor-pointer hover:bg-[var(--bg-secondary)] px-3 py-1.5 rounded-md border border-amber-300 dark:border-amber-700/50 bg-amber-500/10 text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5 transition-colors"
                title="Click to view all delayed renewals"
              >
                <span className="font-bold tabular-nums">{summary.delayed_pct_of_quarter}%</span>
                <span>of Quarter Delayed ({formatACV(summary.total?.acv || 0)} of {formatACV(summary.quarter_total_acv || 0)})</span>
              </div>
            )}
            <MetricToggle />
            <div className="h-9 inline-flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setCompare('yesterday')}
                className={clsx(
                  'h-full px-3 rounded-sm transition-colors flex items-center justify-center',
                  compare === 'yesterday'
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                vs Yesterday
              </button>
              <button
                type="button"
                onClick={() => setCompare('last_week')}
                className={clsx(
                  'h-full px-3 rounded-sm transition-colors flex items-center justify-center',
                  compare === 'last_week'
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                vs Last Week
              </button>
            </div>
          </div>
        }
      />

      {/* 5 KPI Cards in one row: grid-cols-5 at ≥1280px, 3 at ≥768px, 1 on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4 items-stretch">
        <DelayedKpiCard
          title="Total Delayed"
          definition="All renewals in active quarter that are overdue, slipped, or postponed."
          data={summary.total}
          icon={Clock}
          accent="teal"
          kind="all"
        />
        <DelayedKpiCard
          title="Overdue"
          definition="Active renewals past expected close date and not yet closed as of snapshot date."
          data={summary.overdue}
          icon={AlertCircle}
          accent="rose"
          kind="overdue"
        />
        <DelayedKpiCard
          title="Slipped to Next Year"
          definition="Renewals whose fiscal period pushed into a future quarter or fiscal year."
          data={summary.slipped}
          icon={CalendarX2}
          accent="amber"
          kind="slipped"
        />
        <DelayedKpiCard
          title="Later Close Date"
          definition="Renewals in current quarter whose close date was postponed vs reference date."
          data={summary.later_close}
          icon={ArrowRight}
          accent="amber"
          kind="later_close"
        />
        <DelayedKpiCard
          title="Lost / Removed"
          definition="Deals previously in the renewal forecast that have been marked deleted or lost."
          data={summary.lost}
          icon={AlertTriangle}
          accent="slate"
          kind="lost"
        />
      </div>

      {/* Overdue Ageing Breakdown */}
      <Card padding="md">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Overdue Ageing Breakdown</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Distribution of active overdue renewals by days past close date
            </p>
          </div>
          <div
            onClick={() => handleDrill('All Overdue Deals', { kind: 'overdue' })}
            className="text-xs text-[var(--text-muted)] font-medium cursor-pointer hover:text-[var(--text-primary)]"
          >
            Total Overdue: <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">{formatCount(summary.overdue?.count || 0)} deals ({formatACV(summary.overdue?.acv || 0)})</span>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summary.ageing_breakdown?.map((item: any) => {
            const severityClass = {
              '0-7': 'border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300',
              '8-30': 'border-l-orange-500 bg-orange-50/40 dark:bg-orange-950/20 text-orange-800 dark:text-orange-300',
              '31-60': 'border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300',
              '60+': 'border-l-red-700 bg-red-50/50 dark:bg-red-950/30 text-red-900 dark:text-red-200',
            }[item.bracket as string] || 'border-l-slate-400 bg-slate-50 dark:bg-slate-800'

            return (
              <div
                key={item.bracket}
                onClick={() => handleDrill(`${item.label} (${item.bracket} days overdue)`, { kind: 'overdue', ageing: item.bracket })}
                className={cn(
                  'p-3.5 rounded-lg border border-[var(--border)] border-l-4 transition-all cursor-pointer hover:shadow-md select-none',
                  severityClass
                )}
              >
                <div className="flex items-center justify-between text-xs font-semibold mb-1">
                  <span>{item.label}</span>
                  <span className="text-[10px] font-normal opacity-75 uppercase tracking-wider">past close</span>
                </div>
                <div className="text-xl font-bold tabular-nums text-[var(--text-primary)]">
                  {metricMode === 'Amount' ? formatACV(item.acv) : formatCount(item.count)}
                </div>
                <div className="text-xs text-[var(--text-muted)] tabular-nums mt-0.5">
                  {metricMode === 'Amount' ? `${formatCount(item.count)} deals` : formatACV(item.acv)}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Historical Trend and Newly Delayed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Trend of Delayed ACV */}
        <Card padding="md" className="flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Delayed Renewals Trend</h2>
              <p className="text-xs text-[var(--text-muted)]">Historical trajectory across recent upload snapshots</p>
            </div>
            {summary.delayed_pct_of_quarter != null && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                {summary.delayed_pct_of_quarter}% of Quarter
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {summary.trend?.map((t: any, idx: number) => {
              const isLatest = idx === summary.trend.length - 1
              return (
                <div
                  key={t.snapshot_date}
                  className={cn(
                    'p-2.5 rounded-lg border text-center transition-colors',
                    isLatest
                      ? 'border-[var(--brand-teal)] bg-[var(--brand-teal)]/10 shadow-xs ring-1 ring-[var(--brand-teal)]/20'
                      : 'border-[var(--border)] bg-[var(--bg-secondary)]/40'
                  )}
                >
                  <div className="text-[10px] text-[var(--text-muted)] font-medium">
                    {t.snapshot_date}
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-primary)] tabular-nums mt-1">
                    {formatACV(t.acv)}
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                    {formatCount(t.count)} deals
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Newly Delayed vs Reference */}
        <Card padding="md" className="flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                Newly Delayed vs {compare === 'yesterday' ? 'Yesterday' : 'Last Week'}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Deals newly overdue or pushed out since reference snapshot
              </p>
            </div>
            <button
              onClick={() => handleDrill('Newly Delayed Deals', { newly_delayed: true })}
              className="text-xs text-[var(--brand-teal)] hover:underline font-semibold tabular-nums"
            >
              {summary.newly_delayed?.count || 0} deals ({formatACV(summary.newly_delayed?.acv || 0)})
            </button>
          </div>
          <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
            {summary.newly_delayed?.deals?.slice(0, 4).map((d: any) => (
              <div
                key={d.opportunity_id_18}
                onClick={() => setSelectedOppId(d.opportunity_id_18)}
                className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)] cursor-pointer text-xs transition-colors border border-[var(--border-subtle)]"
              >
                <div className="min-w-0 pr-2">
                  <div className="font-medium text-[var(--text-primary)] truncate">{d.opportunity_name}</div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">{d.account_name} • {d.region}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold tabular-nums text-[var(--text-primary)]">{formatACV(d.forecast_acv_amount)}</div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300 bg-amber-500/10">{d.reason}</span>
                </div>
              </div>
            ))}
            {(!summary.newly_delayed?.deals || summary.newly_delayed.deals.length === 0) && (
              <div className="text-center py-6 text-xs text-[var(--text-muted)]">
                No new renewals slipped or became overdue since {compare === 'yesterday' ? 'yesterday' : 'last week'}.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Grid Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="flex flex-col h-[400px]" padding="none">
          <div className="overflow-x-auto h-full p-4">
            <CompactGrid
              title="By Region"
              rowLabelName="Region"
              columns={regionGrid.categories}
              rows={regionGrid.rows}
              totals={regionGrid.totals}
              deltas={regionGrid.gridDeltas}
              metricMode={metricMode}
              onCellClick={regionGrid.handleCellClick}
              compareDate={compare === 'yesterday' ? summary.yesterday_date : summary.lastweek_date}
              yesterdayDate={summary.yesterday_date}
              lastweekDate={summary.lastweek_date}
              heatMode={heatMode}
            />
          </div>
        </Card>

        <Card className="flex flex-col h-[400px]" padding="none">
          <div className="overflow-x-auto h-full p-4">
            <CompactGrid
              title="By Business Unit"
              rowLabelName="Business Unit"
              columns={buGrid.categories}
              rows={buGrid.rows}
              totals={buGrid.totals}
              deltas={buGrid.gridDeltas}
              metricMode={metricMode}
              onCellClick={buGrid.handleCellClick}
              compareDate={compare === 'yesterday' ? summary.yesterday_date : summary.lastweek_date}
              yesterdayDate={summary.yesterday_date}
              lastweekDate={summary.lastweek_date}
              heatMode={heatMode}
            />
          </div>
        </Card>
      </div>

      {/* Top Delayed Deals Table: 44px rows, px-4 py-3 padding, hairline divider, right-aligned numbers */}
      <Card padding="none">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Top 10 Delayed Deals by ACV</h2>
            <p className="text-xs text-[var(--text-muted)]">Highest-value renewals requiring immediate attention</p>
          </div>
          <button
            onClick={() => handleDrill('All Delayed Deals', { kind: 'all' })}
            className="text-xs text-[var(--brand-teal)] hover:underline font-medium"
          >
            View All ({formatCount(summary.total?.count || 0)})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="table-enterprise text-xs">
            <thead>
              <tr>
                <th className="text-left">Opportunity & Account</th>
                <th className="text-left">Region</th>
                <th className="text-left">Owner</th>
                <th className="text-left">Reason</th>
                <th className="text-right">Days Overdue</th>
                <th className="text-right">Push Out (Days)</th>
                <th className="text-right">ACV</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_deals?.map((deal: any) => (
                <tr
                  key={deal.opportunity_id_18}
                  className="hover:bg-[var(--bg-secondary)]/60 cursor-pointer transition-colors"
                  onClick={() => setSelectedOppId(deal.opportunity_id_18)}
                >
                  <td className="max-w-xs">
                    <div className="font-medium text-[var(--brand-teal)] truncate">
                      {deal.opportunity_name}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {deal.account_name}
                    </div>
                  </td>
                  <td className="text-[var(--text-secondary)]">{deal.region}</td>
                  <td className="text-[var(--text-secondary)]">{deal.owner || deal.opportunity_owner || '—'}</td>
                  <td>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-sm text-[10px] font-medium border',
                        deal.reason === 'Overdue'
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-900/30'
                          : deal.reason === 'Slipped quarter'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-900/30'
                          : deal.reason === 'Lost/removed'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-900/30'
                      )}
                    >
                      {deal.reason}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {deal.days_overdue > 0 ? (
                      <span className="font-semibold text-rose-600 dark:text-rose-400">
                        {deal.days_overdue}d
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="text-right text-[var(--text-muted)] tabular-nums">
                    {deal.push_out_days > 0 ? `+${deal.push_out_days}d` : '—'}
                  </td>
                  <td className="text-right font-medium text-[var(--text-primary)] tabular-nums">
                    {formatACV(deal.forecast_acv_amount)}
                  </td>
                </tr>
              ))}
              {(!summary.top_deals || summary.top_deals.length === 0) && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">
                    No delayed deals found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={dealsData?.deals || []}
          initialFilters={{
            sub_region: modalFilters.region,
            forecast_category: modalFilters.category,
            approval_status: modalFilters.status,
            business_unit_primary: modalFilters.bu,
          }}
          onSelectOpp={setSelectedOppId}
          onClose={() => setModalOpen(false)}
        />
      )}

      <OpportunityDrawer oppId={selectedOppId} onClose={() => setSelectedOppId(null)} />
    </div>
  )
}

export default function Delayed() {
  return (
    <ErrorBoundary>
      <DelayedContent />
    </ErrorBoundary>
  )
}
