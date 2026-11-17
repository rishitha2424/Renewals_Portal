import React, { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Clock,
  CalendarX2,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  Settings,
  Check,
  RotateCcw,
  X,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import api from '@/api/client'
import { formatACV, formatCount, getMetricPolarity, getDeltaTextColor, formatDate } from '@/utils/format'
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
import SectionNav from '@/components/common/SectionNav'
import ExcludedTypesNote from '@/components/common/ExcludedTypesNote'
import SectionHeading from '@/components/common/SectionHeading'
import Tile from '@/components/common/Tile'
import CardRow from '@/components/common/CardRow'
import InsightCard from '@/components/common/InsightCard'
import ChartCard from '@/components/common/ChartCard'
import ScrollList from '@/components/common/ScrollList'
import { getDelayedInsights, getTopDelayedDealsSignals } from '@/insights/generators'
import { format, parseISO } from 'date-fns'
import clsx from 'clsx'
import { useRuleDeals } from '@/hooks/useRuleDeals'
import SlippageBreakdown from '@/components/delayed/SlippageBreakdown'

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')
type MetricMode = 'Amount' | 'Count' | 'Both'

function DelayedContent() {
  const queryClient = useQueryClient()
  const { activeSnapshotId, globalFilters } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode

  const [compare, setCompare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')
  const [reviewGraphView, setReviewGraphView] = useState<'donut' | 'flow'>('donut')
  const { modalState, openRuleDeals, closeRuleDeals } = useRuleDeals()
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

  // Fetch Lost deals to build lost tables by region & BU
  const { data: lostDealsData } = useQuery({
    queryKey: ['v2-delayed-lost-deals', activeSnapshotId, filters],
    queryFn: async () => {
      const res = await api.get('/v2/delayed/deals', {
        params: { ...filters, as_of: activeSnapshotId ?? undefined, kind: 'lost' },
      })
      return res.data
    },
    enabled: Boolean(summary?.lost?.count)
  })

  const { lostByRegion, lostByBu } = React.useMemo(() => {
    const deals = lostDealsData?.deals || []
    const totalAcv = summary?.lost?.acv || 1

    const regMap: Record<string, { count: number; acv: number }> = {}
    const buMap: Record<string, { count: number; acv: number }> = {}

    deals.forEach((d: any) => {
      const r = d.region || 'Unknown'
      const b = d.business_unit_primary || d.business_unit || d.bu || 'Unknown'
      const acv = d.forecast_acv_amount || 0

      if (!regMap[r]) regMap[r] = { count: 0, acv: 0 }
      regMap[r].count += 1
      regMap[r].acv += acv

      if (!buMap[b]) buMap[b] = { count: 0, acv: 0 }
      buMap[b].count += 1
      buMap[b].acv += acv
    })

    const lostByRegion = Object.entries(regMap)
      .map(([name, val]) => ({ name, count: val.count, acv: val.acv, pct: (val.acv / totalAcv) * 100 }))
      .sort((a, b) => b.acv - a.acv)

    const lostByBu = Object.entries(buMap)
      .map(([name, val]) => ({ name, count: val.count, acv: val.acv, pct: (val.acv / totalAcv) * 100 }))
      .sort((a, b) => b.acv - a.acv)

    return { lostByRegion, lostByBu }
  }, [lostDealsData?.deals, summary?.lost?.acv])

  const delayedSections = React.useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (summary?.by_region?.length || summary?.by_bu?.length) {
      list.push({ id: 'delayed-breakdowns', title: 'Delayed by Region & BU' })
    }
    const slipCount = summary?.slippage?.total?.count ?? summary?.slippage?.count ?? summary?.slipped?.count
    if (slipCount != null) {
      list.push({ id: 'delayed-slippage-group', title: 'Slippage to 2027' })
    }
    if (summary?.top_deals?.length) {
      list.push({ id: 'delayed-top-deals', title: 'Top 10 Delayed Deals' })
    }
    const pName = summary?.period_label || summary?.data_slice || 'quarter'
    if (summary?.lost) {
      list.push({ id: 'delayed-lost-group', title: `Lost since start of ${pName}` })
    }
    const overdueCount = summary?.delayed_renewals?.overdue?.count ?? summary?.overdue?.count ?? 0
    if (overdueCount > 0 && summary?.ageing_breakdown?.length) {
      list.push({ id: 'delayed-ageing', title: 'Overdue Ageing' })
    }
    if (summary?.reconciliation?.sheets?.length) {
      list.push({ id: 'delayed-reconciliation', title: 'Reconciliation vs Manual Sheets' })
    }
    if (summary?.needs_review?.items?.length || (summary?.needs_review?.has_exceptions && summary?.needs_review?.types?.some((t: any) => t.count > 0))) {
      list.push({ id: 'delayed-needs-review', title: 'Needs review' })
    }
    return list
  }, [summary])

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
    openRuleDeals(title, filters)
  }

  const yDateStr = summary.yesterday_date ? format(parseISO(summary.yesterday_date), 'dd MMM') : 'Yday'
  const wDateStr = summary.lastweek_date ? format(parseISO(summary.lastweek_date), 'dd MMM') : 'Wk'

  const isFuture = summary?.is_future || summary?.slippage?.is_future
  const delRenewals = summary?.delayed_renewals
  const delTot = summary?.delayed_renewals_total || delRenewals?.total
  const overdue = delRenewals?.overdue || summary?.overdue
  const delayedAhead = delRenewals?.ahead || summary?.ahead || delRenewals?.later_close || summary?.later_close
  const slipTot = summary?.slippage_total || summary?.slippage?.total || summary?.slippage?.overall

  const DualBoxDisplay = ({
    data,
    isOverdue,
    catTitle,
    catKind,
  }: {
    data: any
    isOverdue: boolean
    catTitle: string
    catKind: string
  }) => {
    const isFuturePeriod = summary?.is_future

    const renderBox = (
      label: string,
      delta: { count: number; acv: number } | null | undefined,
      compPeriod: 'yesterday' | 'last_week',
      dateLabel: string
    ) => {
      if (delta === null || delta === undefined || isFuturePeriod) {
        return (
          <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] opacity-60 cursor-default flex-1">
            <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
            <div className="font-bold text-xs text-slate-400 dark:text-slate-500 tabular-nums">n/a</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">n/a</div>
          </div>
        )
      }

      const count = Math.abs(delta.count || 0)
      const acvVal = Math.abs(delta.acv || 0)
      const hasDeals = count > 0 || acvVal > 0
      const polarity = 'bad_when_higher'

      const acvColor = hasDeals ? getDeltaTextColor(delta.acv, polarity) : 'text-slate-400 dark:text-slate-500 font-normal'
      const cntColor = hasDeals ? getDeltaTextColor(delta.count, polarity) : 'text-slate-400 dark:text-slate-500 font-normal'
      const arrow = (delta.acv > 0 || delta.count > 0) ? '↑ ' : (delta.acv < 0 || delta.count < 0) ? '↓ ' : ''
      const acvTxt = delta.acv > 0 ? `+${formatACV(delta.acv)}` : delta.acv < 0 ? `-${formatACV(Math.abs(delta.acv))}` : '$0'
      const cntTxt = delta.count > 0 ? `+${delta.count} deals` : delta.count < 0 ? `${delta.count} deals` : '0 deals'

      const periodName = compPeriod === 'yesterday' ? 'yesterday' : 'last week'
      const drawerTitle = `${catTitle} · since ${periodName} (${count} ${count === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

      return (
        <div
          className={cn('p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] transition-all flex-1', hasDeals ? 'cursor-pointer hover:border-[var(--brand-teal)]' : 'cursor-default opacity-70')}
          onClick={(e) => {
            e.stopPropagation()
            if (!hasDeals) return
            handleDrill(drawerTitle, {
              kind: isOverdue ? `${catKind}_delta` : catKind,
              compare: compPeriod,
            })
          }}
          title={hasDeals ? `Click to view deals changed since ${dateLabel}` : `No deals changed since ${dateLabel}`}
        >
          <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
          <div className={cn('font-bold text-xs tabular-nums', acvColor)}>{arrow}{acvTxt}</div>
          <div className={cn('text-[10px] tabular-nums', cntColor)}>{cntTxt}</div>
        </div>
      )
    }

    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {renderBox('vs yesterday', data?.delayed_vs_yesterday, 'yesterday', yDateStr)}
        {renderBox('vs last week', data?.delayed_vs_lastweek, 'last_week', wDateStr)}
      </div>
    )
  }


  const DelayedKpiCard = ({
    title,
    definition,
    data,
    icon: Icon,
    accent,
    kind,
    isOverdue = false,
    comparePeriod = 'period_start',
  }: any) => {
    const isFuture = summary?.is_future
    const isNA = isFuture || data?.count === null
    const cnt = data?.count ?? 0
    const acvVal = data?.acv ?? 0
    const hasDeals = cnt > 0 || acvVal > 0

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

    const drawerTitle = `${title} · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

    return (
      <div
        className={cn(
          'rounded-xl bg-[var(--bg-card)] border border-[var(--border)] border-l-4 shadow-[var(--card-shadow)]',
          accentBorder,
          'p-4 flex flex-col justify-between h-full items-stretch transition-colors select-none'
        )}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={title}>
              {title}
            </span>
          </div>
          {definition && (
            <p className="text-[11px] text-[var(--text-muted)] leading-tight mb-2 min-h-[28px] line-clamp-2">
              {definition}
            </p>
          )}
          <div
            className={cn('space-y-0.5 mb-2.5', !isNA && hasDeals ? 'cursor-pointer group' : 'cursor-not-allowed opacity-75')}
            onClick={() => {
              if (!isNA && hasDeals) {
                handleDrill(drawerTitle, {
                  kind,
                  compare: isOverdue ? undefined : comparePeriod,
                })
              }
            }}
            title={hasDeals ? `Click to view all deals for ${title}` : `0 deals`}
          >
            <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums group-hover:underline">
              {isNA ? 'n/a' : formatACV(acvVal)}
            </div>
            <div className="text-xs font-medium text-[var(--text-muted)] tabular-nums flex items-center justify-between">
              <span>{isNA ? 'n/a' : `${formatCount(cnt)} deals`}</span>
              <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                {isFuture ? 'n/a' : (data?.baseline_label || 'Current')}
              </span>
            </div>
          </div>
        </div>
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <DualBoxDisplay
            data={data}
            isOverdue={isOverdue}
            catTitle={title}
            catKind={kind}
          />
        </div>
      </div>
    )
  }

  const DelayedAheadCard = ({
    title,
    definition,
    data,
    kind,
    onDrillSplit,
  }: any) => {
    const isFuture = summary?.is_future
    const isNA = isFuture || data?.count === null
    const cnt = data?.count ?? 0
    const acvVal = data?.acv ?? 0
    const hasDeals = cnt > 0 || acvVal > 0
    const drawerTitle = `${title} · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

    return (
      <div
        className={cn(
          'rounded-xl bg-[var(--bg-card)] border border-[var(--border)] border-l-4 border-l-amber-500 shadow-[var(--card-shadow)]',
          'p-4 flex flex-col justify-between h-full items-stretch transition-colors select-none'
        )}
      >
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={title}>
              {title}
            </span>
          </div>
          {definition && (
            <p className="text-[11px] text-[var(--text-muted)] leading-tight mb-2 min-h-[28px] line-clamp-2">
              {definition}
            </p>
          )}
          <div
            className={cn('space-y-0.5 mb-2.5', !isNA && hasDeals ? 'cursor-pointer group' : 'cursor-not-allowed opacity-75')}
            onClick={() => {
              if (!isNA && hasDeals) {
                handleDrill(drawerTitle, {
                  kind,
                  compare: 'period_start',
                })
              }
            }}
            title={hasDeals ? `Click to view all deals for ${title}` : '0 deals'}
          >
            <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums group-hover:underline">
              {isNA ? 'n/a' : formatACV(acvVal)}
            </div>
            <div className="text-xs font-medium text-[var(--text-muted)] tabular-nums flex items-center justify-between">
              <span>{isNA ? 'n/a' : `${formatCount(cnt)} deals`}</span>
              <span className="text-[10px] font-semibold text-[var(--text-muted)]">
                {isFuture ? 'n/a' : (data?.baseline_label || 'Current')}
              </span>
            </div>
          </div>
        </div>

        {/* Data-driven split by when close date falls */}
        {data?.splits && (
          <div className="my-2 pt-2 border-t border-[var(--border-subtle)]">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
              Close Date Breakdown
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(data.splits).map(([sKey, sVal]: [string, any]) => {
                const sCnt = sVal.count || 0
                const sAcv = sVal.acv || 0
                const hasS = sCnt > 0 || sAcv > 0
                return (
                  <div
                    key={sKey}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (hasS) onDrillSplit(sVal.label, sKey)
                    }}
                    className={cn(
                      'p-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]/50 transition-colors',
                      hasS ? 'cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5' : 'opacity-60 cursor-default'
                    )}
                    title={hasS ? `Click to view ${sVal.label}` : '0 deals'}
                  >
                    <div className="text-[10px] font-medium text-[var(--text-secondary)] truncate" title={sVal.label}>
                      {sVal.label}
                    </div>
                    <div className="font-bold text-xs tabular-nums text-[var(--text-primary)]">
                      {formatACV(sAcv)}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] tabular-nums">
                      {sCnt} {sCnt === 1 ? 'deal' : 'deals'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <DualBoxDisplay
            data={data}
            isOverdue={false}
            catTitle={title}
            catKind={kind}
          />
        </div>
      </div>
    )
  }

  const buildGrid = (byField: 'by_region' | 'by_bu', clickKey: 'region' | 'bu') => {
    const rawCategories: string[] = Array.from(new Set<string>((summary[byField] || []).flatMap((row: any) => Object.keys(row.categories || {}))))
    const totals = { category: {} as any, grand: { count: 0, acv: 0 } }
    const gridDeltas: any = {}

    summary[byField]?.forEach((row: any) => {
      totals.grand.count += row.count
      totals.grand.acv += row.acv
      rawCategories.forEach((cat: string) => {
        if (!totals.category[cat]) totals.category[cat] = { count: 0, acv: 0 }
        totals.category[cat].count += row.categories?.[cat]?.count || 0
        totals.category[cat].acv += row.categories?.[cat]?.acv || 0
      })
    })

    const categories: string[] = rawCategories.filter((cat: string) => (totals.category[cat]?.count || 0) > 0 || (totals.category[cat]?.acv || 0) !== 0)

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

  const buStackedData = buGrid.rows.map((r: any) => {
    const commitVal = r.cells?.['Commit']?.acv || 0
    const bestCaseVal = r.cells?.['Best Case']?.acv || 0
    const pipelineVal = r.cells?.['Pipeline']?.acv || 0
    const otherVal = Object.entries(r.cells || {}).reduce((sum: number, [cat, cell]: [string, any]) => {
      if (!['Commit', 'Best Case', 'Pipeline'].includes(cat)) {
        return sum + (cell?.acv || 0)
      }
      return sum
    }, 0)

    const series = [
      { name: 'Commit', value: commitVal, color: '#10B981', formattedValue: formatACV(commitVal) },
      { name: 'Best Case', value: bestCaseVal, color: '#F59E0B', formattedValue: formatACV(bestCaseVal) },
      { name: 'Pipeline', value: pipelineVal, color: '#64748B', formattedValue: formatACV(pipelineVal) },
    ]
    if (otherVal > 0) {
      series.push({ name: 'Other', value: otherVal, color: '#94A3B8', formattedValue: formatACV(otherVal) })
    }

    return {
      label: r.label || r.id,
      value: r.total?.acv || 0,
      formattedValue: formatACV(r.total?.acv || 0),
      series,
      onClick: () => handleDrill(`Delayed Deals · ${r.label || r.id}`, { kind: 'all', bu: r.id }),
    }
  })

  return (
    <div className="space-y-8">
      <SectionNav sections={delayedSections} />

      {/* Aligned Section Header with integrated controls (no combined banner) */}
      <SectionHeader
        title="Delayed Renewals & Slippage to 2027"
        subtitle={`Renewals in ${summary.data_slice} tracked for timing delays, slippage to 2027, and removals.`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
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

      <ExcludedTypesNote
        excluded={summary?.other_types_excluded}
        onViewDeals={() => handleDrill('Other Types Excluded', { kind: 'other_types' })}
      />

      {(!isLoading && (summary?.total?.count ?? 0) === 0 && (summary?.slippage_to_2027?.count ?? 0) === 0) && (
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]">
          No deals for this selection
        </div>
      )}

      {/* ── TOP KPI ROW (TWO TILES ONLY) ── */}
      {(() => {
        const overdueCount = overdue?.count ?? 0
        const aheadCount = delayedAhead?.count ?? 0
        const delayedQuietLine = `Overdue ${overdueCount} · Close date ahead ${aheadCount}`

        const slipCats = summary.slippage?.categories || (Array.isArray(summary.slippage?.by_category) ? Object.fromEntries(summary.slippage.by_category.map((x: any) => [x.category, x])) : summary.slippage?.by_category) || {}
        const slipQuietParts: string[] = []
        ;['Commit', 'Best Case', 'Pipeline'].forEach((cat) => {
          const c = slipCats[cat]?.count
          if (c !== undefined) {
            slipQuietParts.push(`${cat} ${c}`)
          }
        })
        const slippageQuietLine = slipQuietParts.length > 0 ? slipQuietParts.join(' · ') : undefined

        return (
          <div id="delayed-top-kpis" className="grid grid-cols-1 md:grid-cols-2 gap-4 scroll-mt-24 mb-6">
            {/* 1. Delayed Tile */}
            <Tile
              tone="delayed"
              title="Delayed Total"
              amount={formatACV(delTot?.acv || 0)}
              count={delTot?.count || 0}
              subtitle={delayedQuietLine}
              polarity="bad_when_higher"
              onClick={() => handleDrill(`Delayed Renewals Total (${formatCount(delTot?.count || 0)} deals · ${formatACV(delTot?.acv || 0)})`, { kind: 'delayed_total' })}
              deltaYesterday={delTot?.delayed_vs_yesterday}
              deltaLastWeek={delTot?.delayed_vs_lastweek}
            />

            {/* 2. Slippage Tile */}
            <Tile
              tone="slippage"
              title="Slippage to 2027 Total"
              amount={formatACV(slipTot?.acv || 0)}
              count={slipTot?.count || 0}
              subtitle={slippageQuietLine || 'Slipped to 2027'}
              polarity="bad_when_higher"
              onClick={() => handleDrill(`Slippage to 2027 Total · ${formatCount(slipTot?.count || 0)} deals · ${formatACV(slipTot?.acv || 0)}`, { kind: 'slippage' })}
              deltaYesterday={slipTot?.delta_yesterday || slipTot?.delayed_vs_yesterday}
              deltaLastWeek={slipTot?.delta_lastweek || slipTot?.delayed_vs_lastweek}
            />
          </div>
        )
      })()}

      {/* ────────────────── SECTION 1: DELAYED RENEWALS BY REGION & BU ────────────────── */}
      <div id="delayed-breakdowns" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title="Delayed renewals by region and by business unit"
          subtitle="Service has ended, renewal not closed yet (depends on snapshot as-of date, not selected period)."
          badge={
            delTot?.count != null ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">
                {delTot.count} deals · {formatACV(delTot.acv)}
              </span>
            ) : undefined
          }
          action={
            summary.delayed_pct_of_quarter != null ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 whitespace-nowrap">
                {summary.delayed_pct_of_quarter}% of Quarter Total ({formatACV(delTot?.acv || 0)} of {formatACV(summary.quarter_total_acv || 0)})
              </span>
            ) : undefined
          }
        />

        {/* Fallback Notice */}
        {Boolean(summary.fallback_used || summary.delayed_renewals?.fallback_used) && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-800 dark:text-sky-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span><strong>Notice:</strong> Group column missing or matched no deals. Fallback rule active: showing open renewals with Service Expiry before start of the quarter.</span>
          </div>
        )}

        {/* Other types excluded notice */}
        {(() => {
          const othItem = summary.needs_review?.items?.find((i: any) => i.type === 'other_types')
          if (!othItem || othItem.count <= 0) return null
          return (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-700 dark:text-slate-300 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  Other types excluded: <strong>{othItem.count} {othItem.count === 1 ? 'deal' : 'deals'} / {formatACV(othItem.acv)}</strong> (shown in Needs review)
                </span>
              </div>
              <button
                onClick={() => handleDrill('Other types excluded from Delayed', { kind: 'needs_review', review_type: 'other_types' })}
                className="underline hover:text-slate-900 dark:hover:text-white font-semibold cursor-pointer text-xs ml-3 whitespace-nowrap"
              >
                view deals →
              </button>
            </div>
          )
        })()}

        {/* Grid Breakdowns & Insights (no outer wrapper cards) */}
        <CardRow template="max-content minmax(0, 1fr) minmax(0, 1fr)">
          <Card className="p-4 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border-subtle)] shrink-0">
                <h3 className="font-semibold text-sm text-[var(--text-primary)]">Delayed ACV by region</h3>
                <span className="text-xs text-[var(--text-muted)] font-mono">
                  {metricMode === 'Amount' ? 'ACV' : metricMode === 'Count' ? 'Deals' : 'ACV & Deals'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <CompactGrid
                  title=""
                  hideCardWrapper={true}
                  rowLabelName="Region"
                  columns={regionGrid.categories}
                  columnLabels={{ 'Blank': 'Deleted / lost in snapshot' }}
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

              {/* StatStrip pinned to bottom to match middle chart and right insights */}
              <div className="grid grid-cols-2 gap-2 mt-auto pt-3 border-t border-[var(--border-subtle)] text-xs shrink-0">
                <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Top Delayed Region</span>
                  <span className="font-bold text-[var(--text-primary)] truncate block" title={regionGrid.rows[0]?.label}>
                    {regionGrid.rows[0]?.label || '—'} ({formatACV(regionGrid.rows[0]?.total?.acv || 0)})
                  </span>
                </div>
                <div className="p-2 rounded bg-[var(--bg-secondary)]/50 text-right">
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Overdue Volume</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">
                    {summary.overdue?.count ?? 0} ({formatACV(summary.overdue?.acv ?? 0)})
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <div className="h-full flex flex-col min-w-0">
            <ChartCard
              title="Delayed ACV by business unit"
              subtitle="Commit, Best Case, and Pipeline delayed volume"
              tone="delayed"
              type="stacked-columns"
              data={buStackedData}
              footer={
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shrink-0" />
                    <span className="text-[var(--text-secondary)] font-medium">Commit</span>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                      ({formatACV(buGrid.totals?.category?.['Commit']?.acv || 0)})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] shrink-0" />
                    <span className="text-[var(--text-secondary)] font-medium">Best Case</span>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                      ({formatACV(buGrid.totals?.category?.['Best Case']?.acv || 0)})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#64748B] shrink-0" />
                    <span className="text-[var(--text-secondary)] font-medium">Pipeline</span>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">
                      ({formatACV(buGrid.totals?.category?.['Pipeline']?.acv || 0)})
                    </span>
                  </div>
                </div>
              }
            />
          </div>

          <div className="h-full min-w-0">
            <InsightCard
              title="Delay summary"
              subtitle="Portfolio delay observations"
              insights={getDelayedInsights(summary, (title, p) => handleDrill(title, p))}
            />
          </div>
        </CardRow>
      </div>

      {/* Overdue Ageing Breakdown */}
      {((summary.delayed_renewals?.overdue?.count ?? summary.overdue?.count ?? 0) > 0) && summary.ageing_breakdown && summary.ageing_breakdown.length > 0 && (
        <Card id="delayed-ageing" padding="md" className="scroll-mt-24">
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
      )}

      {/* ────────────────── SECTION 2: SLIPPAGE TO 2027 ────────────────── */}
      <div id="delayed-slippage-group" className="space-y-4 scroll-mt-24">
        <SectionHeading
          title="Slippage to 2027"
          subtitle={summary.slippage?.rule_caption || 'Renewals whose service started in past or current year, but close date slipped to 2027.'}
          badge={
            summary.slippage?.total?.count != null ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                {summary.slippage.total.count} deals · {formatACV(summary.slippage.total.acv)}
              </span>
            ) : undefined
          }
          action={
            summary.slippage_pct_of_quarter != null ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 whitespace-nowrap">
                {summary.slippage_pct_of_quarter}% of Quarter Total ({formatACV(summary.slippage?.total?.acv || 0)} of {formatACV(summary.quarter_total_acv || 0)})
              </span>
            ) : undefined
          }
        />

        {/* Forecast Category Split & Slipped From Table */}
        <SlippageBreakdown
          slippageSec={summary.slippage}
          slipTot={summary.slippage_total || summary.slippage?.total}
          onDealsClick={handleDrill}
        />
      </div>

      {/* ────────────────── SECTION 3: TOP 10 DELAYED DEALS & HIGHLIGHTS ────────────────── */}
      {(() => {
        const topDeals = summary.top_deals || []

        const ownerMap: Record<string, { count: number; acv: number }> = {}
        topDeals.forEach((d: any) => {
          const o = d.owner || d.opportunity_owner || 'Unassigned'
          if (!ownerMap[o]) ownerMap[o] = { count: 0, acv: 0 }
          ownerMap[o].count += 1
          ownerMap[o].acv += d.forecast_acv_amount || 0
        })
        const topOwnersChartData = Object.entries(ownerMap)
          .sort((a, b) => b[1].acv - a[1].acv)
          .slice(0, 4)
          .map(([owner, val]) => ({
            label: owner,
            value: val.acv,
            formattedValue: `${formatACV(val.acv)} (${val.count})`,
            color: '#00A3AD',
          }))

        return (
          <CardRow template="max-content minmax(0, 1fr)" id="delayed-top-deals">
            <Card padding="none" className="h-full flex flex-col justify-between">
              <div>
                <div className="p-3.5 border-b border-[var(--border)] flex items-center justify-between">
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
                  <table className="data-table text-xs text-left" style={{ width: 'max-content', maxWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th className="text-left col-label">Opportunity & Account</th>
                        <th className="text-left col-label">Region</th>
                        <th className="text-left col-label">Owner</th>
                        <th className="text-left col-label">Status</th>
                        <th className="text-right col-num">Timing</th>
                        <th className="text-right col-num">ACV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.top_deals?.map((deal: any) => (
                        <tr
                          key={deal.opportunity_id_18}
                          className="hover:bg-[var(--bg-secondary)]/60 cursor-pointer transition-colors"
                          onClick={() => setSelectedOppId(deal.opportunity_id_18)}
                        >
                          <td className="col-label font-medium text-[var(--brand-teal)] truncate" title={deal.opportunity_name}>
                            <div className="truncate max-w-[200px]">{deal.opportunity_name}</div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[180px]">{deal.account_name}</div>
                          </td>
                          <td className="text-[var(--text-secondary)] col-label truncate max-w-[90px]">{deal.region}</td>
                          <td className="text-[var(--text-secondary)] col-label truncate max-w-[90px]">{deal.owner || deal.opportunity_owner || '—'}</td>
                          <td className="col-label">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded-sm text-[10px] font-medium border',
                                deal.reason === 'Overdue'
                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-900/30'
                                  : 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border-teal-200 dark:border-teal-900/30'
                              )}
                            >
                              {deal.reason || (deal.days_overdue > 0 ? 'Overdue' : 'Close date ahead')}
                            </span>
                          </td>
                          <td className="text-right tabular-nums col-num">
                            {deal.days_overdue > 0 ? (
                              <span className="font-semibold text-rose-600 dark:text-rose-400">
                                {deal.days_overdue}d overdue
                              </span>
                            ) : deal.days_to_close > 0 ? (
                              <span className="font-medium text-teal-600 dark:text-teal-400">
                                {deal.days_to_close}d to close
                              </span>
                            ) : (
                              <span className="text-[var(--text-muted)]">—</span>
                            )}
                          </td>
                          <td className="text-right font-medium text-[var(--text-primary)] tabular-nums col-num">
                            {formatACV(deal.forecast_acv_amount)}
                          </td>
                        </tr>
                      ))}
                      {(!summary.top_deals || summary.top_deals.length === 0) && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">
                            No delayed deals found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            <div className="h-full flex flex-col gap-3 min-w-0">
              <InsightCard
                title="Top delayed deals: signals"
                subtitle="Exposure concentration & critical dates"
                insights={getTopDelayedDealsSignals(summary, setSelectedOppId)}
              />
              {topOwnersChartData.length > 0 && (
                <ChartCard
                  title="Delayed ACV by owner (top 4)"
                  subtitle="Owner concentration among top delayed contracts"
                  type="horizontal-bars"
                  data={topOwnersChartData}
                  className="min-h-[140px]"
                />
              )}
            </div>
          </CardRow>
        )
      })()}

      {/* ────────────────── SECTION 4: LOST SINCE START OF QUARTER ────────────────── */}
      {summary.lost && (
        <div id="delayed-lost-group" className="scroll-mt-24 space-y-4">
          <SectionHeading
            title={`Lost since start of ${summary.period_label || summary.data_slice || 'quarter'}`}
            subtitle="Deals deleted or lost since start of baseline (excluded from delayed totals)."
            badge={
              summary.lost.count != null ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-500/10 text-slate-700 dark:text-slate-300 border border-slate-500/20">
                  {summary.lost.count} deals · {formatACV(summary.lost.acv)}
                </span>
              ) : undefined
            }
          />
          <div className="rounded-xl bg-slate-500/5 dark:bg-slate-950/20 border border-slate-500/20 p-4 flex flex-wrap items-center justify-between gap-4">
            <div
              className={cn((summary.lost.count || 0) > 0 ? 'cursor-pointer group' : 'cursor-default')}
              onClick={() => (summary.lost.count || 0) > 0 && handleDrill(`Lost since start of ${summary.period_label || summary.data_slice || 'quarter'}`, { kind: 'lost', compare: 'period_start' })}
              title={(summary.lost.count || 0) > 0 ? `Click to view deals lost since start of ${summary.period_label || summary.data_slice || 'quarter'}` : '0 deals'}
            >
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1 flex items-center gap-2">
                <span>Lost Deals Total</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className={cn('text-2xl font-black text-[var(--text-primary)] tabular-nums', (summary.lost.count || 0) > 0 && 'group-hover:underline')}>
                  {formatACV(summary.lost.acv || 0)}
                </span>
                <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                  {formatCount(summary.lost.count || 0)} deals
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  (Excluded from delayed totals)
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <DualBoxDisplay
                data={summary.lost}
                isOverdue={false}
                catTitle={`Lost since start of ${summary.period_label || summary.data_slice || 'quarter'}`}
                catKind="lost"
              />
            </div>
          </div>

          <CardRow template="max-content minmax(0, 1fr)">
            <Card padding="none" className="overflow-hidden h-full flex flex-col justify-between">
              <div>
                <div className="p-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/30 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Lost deals by region</h3>
                  <span className="text-[11px] text-[var(--text-muted)] font-mono">{lostByRegion.length} regions</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table text-xs text-left" style={{ width: 'max-content', maxWidth: '100%' }}>
                    <thead>
                      <tr>
                        <th className="text-left col-label">Region</th>
                        <th className="text-right col-num">Deals</th>
                        <th className="text-right col-money">ACV</th>
                        <th className="text-right col-pct">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lostByRegion.map((r) => (
                        <tr
                          key={r.name}
                          className="hover:bg-[var(--bg-secondary)]/50 cursor-pointer transition-colors"
                          onClick={() => handleDrill(`Lost Deals · ${r.name}`, { kind: 'lost', region: r.name })}
                        >
                          <td className="col-label font-medium text-[var(--text-primary)] truncate" title={r.name}>{r.name}</td>
                          <td className="text-right tabular-nums col-num">{r.count}</td>
                          <td className="text-right tabular-nums font-semibold col-money">{formatACV(r.acv)}</td>
                          <td className="text-right tabular-nums text-[var(--text-muted)] col-pct">{r.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                      {lostByRegion.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-[var(--text-muted)]">No lost deals</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Top Lost Region</span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {lostByRegion[0]?.name || '—'} ({formatACV(lostByRegion[0]?.acv || 0)})
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Regional Concentration</span>
                  <span className="font-bold text-[var(--text-primary)]">
                    {lostByRegion[0]?.pct ? `${lostByRegion[0].pct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              </div>
            </Card>

            <ChartCard
              title="Lost deals by business unit"
              subtitle="Distribution of lost renewal ACV across business units"
              type="vertical-bars"
              tone="neutral"
              data={lostByBu.map((bu) => ({
                label: bu.name,
                value: bu.acv,
                formattedValue: formatACV(bu.acv),
                percentage: bu.pct,
                sublabel: `${bu.count} ${bu.count === 1 ? 'deal' : 'deals'}`,
                dealsCount: bu.count,
                color: '#64748B',
                onClick: () => handleDrill(`Lost Deals · ${bu.name}`, { kind: 'lost', business_unit: bu.name }),
              }))}
              footer={
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase font-medium">
                    Top Lost BU: <strong className="text-[var(--text-primary)]">{lostByBu[0]?.name || '—'}</strong> ({formatACV(lostByBu[0]?.acv || 0)})
                  </span>
                  <span className="font-bold text-[var(--text-primary)] tabular-nums">
                    {lostByBu[0]?.pct ? `${lostByBu[0].pct.toFixed(1)}% share` : '—'}
                  </span>
                </div>
              }
            />
          </CardRow>
        </div>
      )}

      {/* ────────────────── SECTION 5: NEEDS REVIEW ────────────────── */}
      {(() => {
        const rawItems = (summary.needs_review?.items || summary.needs_review?.types || [])
        const reviewList = rawItems.filter((t: any) => t.count > 0 && t.type !== 'expired_no_group')
        if (reviewList.length === 0) return null
        const totalAcv = summary.needs_review?.total_acv ?? reviewList.reduce((acc: number, x: any) => acc + (x.acv || 0), 0)
        const totalCount = summary.needs_review?.total_count || reviewList.reduce((acc: number, x: any) => acc + (x.count || 0), 0)

        return (
          <CardRow template="max-content minmax(0, 1fr)" id="delayed-needs-review">
            <Card padding="none" className="h-full flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-[var(--border)] p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-[var(--text-primary)]">
                        Needs review
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-800 dark:text-amber-300">
                        {totalCount} deals
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Deals requiring inspection. Exceptions and data-quality checks tracked alongside renewals.
                    </p>
                  </div>
                  <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    Total Exception ACV: {formatACV(totalAcv)}
                  </div>
                </div>

                <div className="overflow-x-auto p-4">
                  <table className="data-table text-xs text-left" style={{ width: 'max-content', maxWidth: '100%' }}>
                    <thead>
                      <tr className="bg-[var(--bg-secondary)]/50 text-[var(--text-secondary)]">
                        <th className="text-left font-semibold">Review Type</th>
                        <th className="text-right font-semibold">Deals</th>
                        <th className="text-right font-semibold">ACV</th>
                        <th className="text-left font-semibold">Explanation</th>
                        <th className="text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {reviewList.map((t: any) => (
                        <tr key={t.type || t.type_id || t.title} className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                          <td className="font-bold text-[var(--text-primary)]">{t.title}</td>
                          <td className="text-right font-semibold tabular-nums">{t.count}</td>
                          <td className="text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatACV(t.acv)}</td>
                          <td className="text-[var(--text-secondary)] text-[11px] max-w-md">{t.description || t.explanation}</td>
                          <td className="text-right">
                            <button
                              onClick={() => handleDrill(t.title, { kind: 'needs_review', review_type: t.type || t.type_id })}
                              className="px-2.5 py-1 rounded bg-[var(--bg-primary)] border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold hover:bg-amber-500/20 transition-colors cursor-pointer text-xs"
                            >
                              View deals →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Total Exceptions</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400 tabular-nums">{totalCount} deals</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Exception Value</span>
                  <span className="font-bold text-[var(--text-primary)] tabular-nums">{formatACV(totalAcv)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Flagged Categories</span>
                  <span className="font-bold text-[var(--text-primary)] tabular-nums">{reviewList.length} categories</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Primary Flag</span>
                  <span className="font-bold text-[var(--text-primary)] truncate block" title={reviewList[0]?.title}>{reviewList[0]?.title || '—'}</span>
                </div>
              </div>
            </Card>

            <ChartCard
              title="Why Deals Need Review"
              subtitle="Exception distribution by type"
              type={reviewGraphView === 'donut' ? 'donut' : 'stacked-bar'}
              total={totalAcv}
              action={
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border)] text-xs">
                  <button
                    type="button"
                    onClick={() => setReviewGraphView('donut')}
                    className={clsx(
                      'px-2 py-0.5 rounded font-semibold transition-colors',
                      reviewGraphView === 'donut'
                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    Donut
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewGraphView('flow')}
                    className={clsx(
                      'px-2 py-0.5 rounded font-semibold transition-colors',
                      reviewGraphView === 'flow'
                        ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    Flow
                  </button>
                </div>
              }
              data={reviewList.map((t: any, idx: number) => {
                const colors = ['#F59E0B', '#F43F5E', '#8B5CF6', '#3B82F6', '#10B981', '#64748B']
                const pct = totalAcv > 0 ? ((t.acv || 0) / totalAcv) * 100 : 0
                return {
                  label: t.title,
                  value: t.acv || 0,
                  formattedValue: formatACV(t.acv || 0),
                  percentage: pct,
                  sublabel: `${t.count} ${t.count === 1 ? 'deal' : 'deals'}`,
                  dealsCount: t.count,
                  color: colors[idx % colors.length],
                  onClick: () => handleDrill(t.title, { kind: 'needs_review', review_type: t.type || t.type_id }),
                }
              })}
              footer={
                <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                  <span>{totalCount} total exceptions ({formatACV(totalAcv)})</span>
                  <span>Click slices or cards to inspect</span>
                </div>
              }
            />
          </CardRow>
        )
      })()}

      {/* ────────────────── ADMIN: RECONCILIATION VS MANUAL SHEETS ────────────────── */}
      {summary.reconciliation?.sheets?.length > 0 && (
        <div id="delayed-reconciliation" className="rounded-xl border border-slate-500/30 bg-slate-500/5 p-4 scroll-mt-24 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-500/20 pb-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <span>Admin: Reconciliation vs Manual Sheets</span>
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Comparison of dynamically calculated deals vs manual reference sheets in workbook. Manual sheets are never used as numbers source.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table table-enterprise w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">Manual Sheet</th>
                  <th className="text-right">Rule Deals</th>
                  <th className="text-right">Sheet Deals</th>
                  <th className="text-right">Matched</th>
                  <th className="text-right">Missing in Rule</th>
                  <th className="text-right">Extra in Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summary.reconciliation.sheets.map((sh: any) => (
                  <tr key={sh.sheet_name}>
                    <td className="font-semibold text-[var(--text-primary)]">{sh.sheet_name}</td>
                    <td className="text-right tabular-nums">{sh.rule_deals_count}</td>
                    <td className="text-right tabular-nums">{sh.sheet_deals_count}</td>
                    <td className="text-right tabular-nums font-semibold text-emerald-600">{sh.matched_count}</td>
                    <td className="text-right tabular-nums font-semibold text-rose-600">
                      {sh.missing_in_rule?.length || 0}
                    </td>
                    <td className="text-right tabular-nums font-semibold text-amber-600">
                      {sh.extra_in_rule?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalState.isOpen && (
        <DealListModal
          title={modalState.title}
          deals={modalState.deals}
          expectedCount={modalState.expectedCount}
          deltaGroups={modalState.deltaGroups}
          initialFilters={modalState.initialFilters || {}}
          onSelectOpp={setSelectedOppId}
          onClose={closeRuleDeals}
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
