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
import SectionNav from '@/components/common/SectionNav'
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
        params: { ...filters, ...modalFilters, as_of: activeSnapshotId ?? undefined, compare: modalFilters?.compare || compare },
      })
      return res.data
    },
    enabled: modalOpen,
  })

  const delayedSections = React.useMemo(() => {
    const list: { id: string; title: string }[] = []
    const delCount = summary?.delayed_renewals?.total?.count ?? summary?.total?.count
    if (delCount != null) {
      list.push({ id: 'delayed-renewals-group', title: 'Delayed Renewals' })
    }
    if (summary?.slipped_to_later_year?.total?.count != null) {
      list.push({ id: 'delayed-slipped-later-year', title: 'Slipped to a later year' })
    }
    const slipCount = summary?.slippage?.total?.count ?? summary?.slipped?.count
    if (slipCount != null) {
      list.push({ id: 'delayed-slippage-group', title: 'Slippage' })
    }
    if (summary?.lost) {
      list.push({ id: 'delayed-lost-group', title: 'Lost since start of quarter' })
    }
    if (summary?.ageing_breakdown?.length) {
      list.push({ id: 'delayed-ageing', title: 'Overdue Ageing' })
    }
    if (summary?.trend?.length || summary?.newly_delayed) {
      list.push({ id: 'delayed-trends', title: 'Trends' })
    }
    if (summary?.by_region?.length || summary?.by_bu?.length) {
      list.push({ id: 'delayed-breakdowns', title: 'Region & BU Grids' })
    }
    if (summary?.top_deals?.length) {
      list.push({ id: 'delayed-top-deals', title: 'Top Delayed Deals' })
    }
    if (summary?.reconciliation?.sheets?.length) {
      list.push({ id: 'delayed-reconciliation', title: 'Reconciliation vs Manual Sheets' })
    }
    if (summary?.needs_review?.has_exceptions && summary?.needs_review?.types?.some((t: any) => t.count > 0)) {
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
    setModalTitle(title)
    setModalFilters({ ...filters, compare, as_of: activeSnapshotId ?? undefined })
    setModalOpen(true)
  }

  const yDateStr = summary.yesterday_date ? format(parseISO(summary.yesterday_date), 'dd MMM') : 'Yday'
  const wDateStr = summary.lastweek_date ? format(parseISO(summary.lastweek_date), 'dd MMM') : 'Wk'

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
    const isFuture = summary?.is_future

    const renderBox = (
      label: string,
      delta: { count: number; acv: number } | null | undefined,
      compPeriod: 'yesterday' | 'last_week',
      dateLabel: string
    ) => {
      if (delta === null || delta === undefined || isFuture) {
        return (
          <div className="p-2 rounded-lg bg-slate-500/5 border border-slate-500/10 opacity-70 cursor-default flex-1">
            <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
            <div className="font-bold text-xs text-[var(--text-muted)] tabular-nums">n/a</div>
            <div className="text-[10px] text-[var(--text-muted)]">n/a</div>
          </div>
        )
      }

      const count = Math.abs(delta.count || 0)
      const acvVal = Math.abs(delta.acv || 0)
      const hasDeals = count > 0 || acvVal > 0

      if (isOverdue) {
        const isUp = delta.count > 0 || delta.acv > 0
        const isDown = delta.count < 0 || delta.acv < 0

        const colorClasses = isUp
          ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 hover:border-rose-500/50'
          : isDown
          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/50'
          : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'

        let acvText = '$0'
        if (delta.acv > 0) acvText = `+${formatACV(delta.acv)}`
        else if (delta.acv < 0) acvText = `-${formatACV(Math.abs(delta.acv))}`

        let countText = '0 deals'
        if (delta.count > 0) countText = `+${delta.count} deals`
        else if (delta.count < 0) countText = `${delta.count} deals`

        const periodName = compPeriod === 'yesterday' ? 'yesterday' : 'last week'
        const drawerTitle = `${catTitle} · since ${periodName} (${count} ${count === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

        return (
          <div
            className={cn('p-2 rounded-lg border transition-all flex-1', colorClasses, hasDeals ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
            onClick={(e) => {
              e.stopPropagation()
              if (!hasDeals) return
              handleDrill(drawerTitle, {
                kind: `${catKind}_delta`,
                compare: compPeriod,
              })
            }}
            title={hasDeals ? `Click to view deals changed since ${dateLabel}` : `No deals changed since ${dateLabel}`}
          >
            <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
            <div className="font-bold text-xs tabular-nums">{acvText}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{countText}</div>
          </div>
        )
      } else {
        const colorClasses = hasDeals
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:border-amber-500/50'
          : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'

        const acvText = formatACV(delta.acv || 0)
        const countText = `${count} ${count === 1 ? 'deal' : 'deals'}`
        const periodName = compPeriod === 'yesterday' ? 'yesterday' : 'last week'
        const drawerTitle = `${catTitle} · since ${periodName} (${count} ${count === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

        return (
          <div
            className={cn('p-2 rounded-lg border transition-all flex-1', colorClasses, hasDeals ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}
            onClick={(e) => {
              e.stopPropagation()
              if (!hasDeals) return
              handleDrill(drawerTitle, {
                kind: catKind,
                compare: compPeriod,
              })
            }}
            title={hasDeals ? `Click to view events since ${dateLabel}` : `No deals changed since ${dateLabel}`}
          >
            <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
            <div className="font-bold text-xs tabular-nums">{acvText}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{countText}</div>
          </div>
        )
      }
    }

    return (
      <div className="grid grid-cols-2 gap-2 mt-2">
        {renderBox('Since yesterday', data?.delayed_vs_yesterday, 'yesterday', yDateStr)}
        {renderBox('Since last week', data?.delayed_vs_lastweek, 'last_week', wDateStr)}
      </div>
    )
  }

  // 4px left accent bar + 32px rounded-lg tinted icon tile
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

  const delTot = summary.delayed_renewals?.total || summary.total
  const slipTot = summary.slippage?.total || summary.slipped
  const isFuture = summary?.is_future

  return (
    <div className="space-y-8">
      <SectionNav sections={delayedSections} />

      {/* Aligned Section Header with integrated controls (no combined banner) */}
      <SectionHeader
        title="Delayed Renewals & Slippage"
        subtitle={`Renewals in ${summary.data_slice} tracked for timing delays, slippage, and removals.`}
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

      {/* ────────────────── SECTION 1: DELAYED RENEWALS ────────────────── */}
      <div id="delayed-renewals-group" className="space-y-4 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Delayed Renewals</span>
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Total Delayed = Overdue + Delayed, close date ahead. Open renewals matching the delayed group setting.
            </p>
          </div>
          {summary.delayed_pct_of_quarter != null && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 whitespace-nowrap">
              {summary.delayed_pct_of_quarter}% of Quarter Total ({formatACV(delTot?.acv || 0)} of {formatACV(summary.quarter_total_acv || 0)})
            </span>
          )}
        </div>

        {/* Fallback Notice */}
        {Boolean(summary.fallback_used || summary.delayed_renewals?.fallback_used) && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25 text-sky-800 dark:text-sky-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span><strong>Notice:</strong> Group column missing or matched no deals. Fallback rule active: showing open renewals with Service Expiry before start of the quarter.</span>
          </div>
        )}

        {/* Data Quality Line */}
        {(() => {
          const dq = summary.delayed_renewals?.data_quality || summary.data_quality
          if (!dq || dq.count <= 0) return null
          return (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  <strong>{dq.count} {dq.count === 1 ? 'deal' : 'deals'}</strong> expired before the quarter but have no delayed Group ({formatACV(dq.acv)})
                </span>
              </div>
              <button
                onClick={() => handleDrill('Deals expired before quarter without delayed Group', { kind: 'data_quality_expired_not_delayed' })}
                className="underline hover:text-amber-900 dark:hover:text-amber-100 font-semibold cursor-pointer text-xs ml-3 whitespace-nowrap"
              >
                view deals →
              </button>
            </div>
          )
        })()}

        {/* Delayed Renewals Total Bar */}
        {(() => {
          const isNA = isFuture || delTot?.count === null
          const cnt = delTot?.count ?? 0
          const acvVal = delTot?.acv ?? 0
          const hasDeals = cnt > 0 || acvVal > 0
          const drawerTitle = `Delayed Renewals · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

          return (
            <div className="rounded-xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 p-4 flex flex-wrap items-center justify-between gap-4">
              <div
                className={cn(hasDeals && !isNA ? 'cursor-pointer' : 'cursor-not-allowed opacity-75')}
                onClick={() => hasDeals && !isNA && handleDrill(drawerTitle, { kind: 'delayed_total' })}
                title={hasDeals ? 'Click to view all delayed renewals' : '0 deals'}
              >
                <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider mb-1">
                  Delayed Renewals Total
                </div>
                <div className="flex items-baseline gap-3">
                  <span className={cn('text-2xl font-black text-[var(--text-primary)] tabular-nums', hasDeals && !isNA && 'hover:underline')}>
                    {isNA ? 'n/a' : formatACV(acvVal)}
                  </span>
                  <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                    {isNA ? 'n/a' : `${formatCount(cnt)} deals`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(() => {
                  const renderTotBox = (label: string, delta: any, comp: 'yesterday' | 'last_week', dateStr: string) => {
                    if (delta === null || delta === undefined || isFuture) {
                      return (
                        <div className="p-2 rounded-lg bg-slate-500/5 border border-slate-500/10 min-w-[120px]">
                          <div className="text-[10px] font-semibold text-[var(--text-muted)]">{label}</div>
                          <div className="font-bold text-xs text-[var(--text-muted)]">n/a</div>
                          <div className="text-[10px] text-[var(--text-muted)]">n/a</div>
                        </div>
                      )
                    }
                    const count = Math.abs(delta.count || 0)
                    const acv = Math.abs(delta.acv || 0)
                    const hasBoxDeals = count > 0 || acv > 0
                    const isUp = delta.count > 0 || delta.acv > 0
                    const isDown = delta.count < 0 || delta.acv < 0
                    const colorCls = isUp
                      ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
                      : isDown
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'
                    const acvTxt = delta.acv > 0 ? `+${formatACV(delta.acv)}` : delta.acv < 0 ? `-${formatACV(Math.abs(delta.acv))}` : '$0'
                    const cntTxt = delta.count > 0 ? `+${delta.count} deals` : delta.count < 0 ? `${delta.count} deals` : '0 deals'
                    const periodName = comp === 'yesterday' ? 'yesterday' : 'last week'
                    const boxDrawerTitle = `Delayed Renewals · since ${periodName} (${count} ${count === 1 ? 'deal' : 'deals'} · ${formatACV(acv)})`

                    return (
                      <div
                        className={cn('p-2 rounded-lg border min-w-[120px] transition-all', colorCls, hasBoxDeals ? 'cursor-pointer hover:border-rose-500/50' : 'cursor-not-allowed opacity-60')}
                        onClick={() => hasBoxDeals && handleDrill(boxDrawerTitle, { kind: 'delayed_total_delta', compare: comp })}
                        title={hasBoxDeals ? `Click to view deals changed since ${dateStr}` : `No deals changed since ${dateStr}`}
                      >
                        <div className="text-[10px] font-semibold text-[var(--text-muted)]">{label}</div>
                        <div className="font-bold text-xs tabular-nums">{acvTxt}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{cntTxt}</div>
                      </div>
                    )
                  }

                  return (
                    <>
                      {renderTotBox('Since yesterday', delTot?.delayed_vs_yesterday, 'yesterday', yDateStr)}
                      {renderTotBox('Since last week', delTot?.delayed_vs_lastweek, 'last_week', wDateStr)}
                    </>
                  )
                })()}
              </div>
            </div>
          )
        })()}

        {/* 2 Delayed KPI Cards: Overdue & Delayed, close date ahead */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          <DelayedKpiCard
            title="Overdue"
            definition="Active renewals past expected close date and not yet closed as of snapshot date."
            data={summary.delayed_renewals?.overdue || summary.overdue}
            icon={AlertCircle}
            accent="rose"
            kind="overdue"
            isOverdue={true}
          />
          <DelayedAheadCard
            title="Delayed, close date ahead"
            definition="Delayed renewals whose close date is still ahead (not yet overdue as of snapshot date)."
            data={summary.delayed_renewals?.ahead || summary.ahead || summary.delayed_renewals?.later_close || summary.later_close}
            kind="delayed_ahead"
            onDrillSplit={(label: string, splitKey: string) => handleDrill(label, { kind: 'delayed_ahead_split', split_key: splitKey })}
          />
        </div>
      </div>

      {/* ────────────────── SECTION 2: SLIPPED TO A LATER YEAR ────────────────── */}
      {summary.slipped_to_later_year && (
        <div id="delayed-slipped-later-year" className="space-y-4 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  Slipped to a later year (by service expiry)
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
                  {summary.slipped_to_later_year.total.count} deals · {formatACV(summary.slipped_to_later_year.total.acv)}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Open renewals whose Service Expiry date is on or before the last day of the selected period's year and whose Close Date is after that day.
              </p>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                Deals in both sections tagged <strong>also delayed</strong> · Totals never combined
              </span>
            </div>
          </div>

          {/* Negative ACV line if any */}
          {summary.slipped_to_later_year.excluded_adjustments?.count > 0 && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Negative-ACV adjustments (excluded): <strong>{summary.slipped_to_later_year.excluded_adjustments.count} {summary.slipped_to_later_year.excluded_adjustments.count === 1 ? 'deal' : 'deals'}</strong> / {formatACV(summary.slipped_to_later_year.excluded_adjustments.acv)}
                </span>
              </div>
              <button
                onClick={() => handleDrill('Negative-ACV adjustments (excluded)', { kind: 'slipped_excluded_adjustments' })}
                className="underline font-semibold hover:text-amber-900 dark:hover:text-amber-200 cursor-pointer text-xs"
              >
                view deals →
              </button>
            </div>
          )}

          {/* 3 Buckets */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(summary.slipped_to_later_year.buckets || {}).map(([bKey, bData]: [string, any]) => {
              const bCount = bData.count || 0
              const bAcv = bData.acv || 0
              const hasBDeals = bCount > 0 || bAcv > 0
              return (
                <div
                  key={bKey}
                  className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] border-l-4 border-l-indigo-500 p-4 flex flex-col justify-between"
                >
                  <div>
                    <span className="text-xs font-semibold text-[var(--text-secondary)] line-clamp-1" title={bData.label}>
                      {bData.label}
                    </span>
                    <div
                      className={cn('mt-2 mb-2', hasBDeals ? 'cursor-pointer group' : 'cursor-default opacity-75')}
                      onClick={() => hasBDeals && handleDrill(`Bucket: ${bData.label}`, { kind: 'slipped_bucket', bucket_key: bKey })}
                    >
                      <div className="text-2xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums group-hover:underline">
                        {formatACV(bAcv)}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] font-medium tabular-nums">
                        {formatCount(bCount)} deals
                      </div>
                    </div>
                  </div>
                  {/* Category breakdown pills */}
                  {bData.categories && (
                    <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-wrap gap-1.5 mt-2">
                      {Object.entries(bData.categories).map(([catName, catVal]: [string, any]) => (
                        catVal.count > 0 ? (
                          <span
                            key={catName}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] tabular-nums"
                            title={`${catName}: ${catVal.count} deals · ${formatACV(catVal.acv)}`}
                          >
                            {catName}: {catVal.count}
                          </span>
                        ) : null
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* From Year x to Year Matrix */}
          {summary.slipped_to_later_year.matrix && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-[var(--card-shadow)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    Service Expiry Year to Close Year Matrix
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Rows = service expiry year; Columns = expected close year. Click any cell to view deals.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 font-medium">
                    ⚠️ check date: close date &gt; 5 years ahead
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="table-enterprise text-xs">
                  <thead>
                    <tr>
                      <th className="text-left font-semibold text-[var(--text-secondary)]">Expiry Year</th>
                      {(summary.slipped_to_later_year.matrix.close_years || []).map((yr: string) => {
                        const targetTot = summary.slipped_to_later_year.matrix.target_year_totals?.[yr]
                        const isFar = targetTot?.far_ahead
                        return (
                          <th key={yr} className="text-right font-semibold text-[var(--text-secondary)]">
                            <div className="flex items-center justify-end gap-1">
                              <span>{yr}</span>
                              {isFar && (
                                <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold" title="Close date far ahead">
                                  check date
                                </span>
                              )}
                            </div>
                          </th>
                        )
                      })}
                      <th className="text-right font-bold text-[var(--text-primary)] bg-[var(--bg-secondary)]/50">Total Slipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.slipped_to_later_year.matrix.rows || []).map((row: any) => (
                      <tr key={row.expiry_year} className="hover:bg-[var(--bg-secondary)]/40 transition-colors">
                        <td className="font-semibold text-[var(--text-primary)]">{row.expiry_year}</td>
                        {(summary.slipped_to_later_year.matrix.close_years || []).map((yr: string) => {
                          const cell = row.close_years?.[yr] || { count: 0, acv: 0.0 }
                          const hasCell = cell.count > 0 || cell.acv > 0
                          return (
                            <td
                              key={yr}
                              className={cn(
                                'text-right tabular-nums transition-colors',
                                hasCell ? 'cursor-pointer hover:bg-indigo-500/10 font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)] opacity-50'
                              )}
                              onClick={() => hasCell && handleDrill(`Service Expiry ${row.expiry_year} → Closing in ${yr}`, {
                                kind: 'slipped_matrix_cell',
                                expiry_year: row.expiry_year,
                                close_year: yr,
                              })}
                              title={hasCell ? `Click to view ${cell.count} deals (${formatACV(cell.acv)})` : '0 deals'}
                            >
                              {hasCell ? (
                                <div>
                                  <div className="font-semibold">{formatACV(cell.acv)}</div>
                                  <div className="text-[10px] text-[var(--text-muted)]">{cell.count} {cell.count === 1 ? 'deal' : 'deals'}</div>
                                </div>
                              ) : '—'}
                            </td>
                          )
                        })}
                        <td
                          className="text-right font-bold tabular-nums text-[var(--text-primary)] bg-[var(--bg-secondary)]/40 cursor-pointer hover:underline"
                          onClick={() => row.total?.count > 0 && handleDrill(`Service Expiry ${row.expiry_year} → All Later Years`, {
                            kind: 'slipped_matrix_cell',
                            expiry_year: row.expiry_year,
                          })}
                        >
                          <div>{formatACV(row.total?.acv || 0)}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-normal">{row.total?.count || 0} deals</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg-secondary)] font-bold border-t-2 border-[var(--border)]">
                      <td className="text-left text-[var(--text-primary)]">Total Slipped into Year</td>
                      {(summary.slipped_to_later_year.matrix.close_years || []).map((yr: string) => {
                        const targetTot = summary.slipped_to_later_year.matrix.target_year_totals?.[yr] || { count: 0, acv: 0.0 }
                        const hasTot = targetTot.count > 0 || targetTot.acv > 0
                        return (
                          <td
                            key={yr}
                            className={cn('text-right tabular-nums', hasTot ? 'cursor-pointer hover:underline text-indigo-600 dark:text-indigo-400' : 'text-[var(--text-muted)]')}
                            onClick={() => hasTot && handleDrill(`All Deals Slipped into ${yr}`, {
                              kind: 'slipped_target_year',
                              close_year: yr,
                            })}
                            title={hasTot ? `Click to view all deals closing in ${yr}` : '0 deals'}
                          >
                            <div>{formatACV(targetTot.acv)}</div>
                            <div className="text-[10px] font-normal">{targetTot.count} deals</div>
                          </td>
                        )
                      })}
                      <td className="text-right tabular-nums text-indigo-700 dark:text-indigo-300">
                        <div>{formatACV(summary.slipped_to_later_year.matrix.total?.acv || 0)}</div>
                        <div className="text-[10px] font-normal">{summary.slipped_to_later_year.matrix.total?.count || 0} deals</div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ────────────────── SECTION 2: SLIPPAGE ────────────────── */}
      <div id="delayed-slippage-group" className="space-y-4 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span>Slippage</span>
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Deals that moved OUT of the selected quarter into a later one, split by destination.
            </p>
          </div>
          {summary.slippage_pct_of_quarter != null && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 whitespace-nowrap">
              {summary.slippage_pct_of_quarter}% of Quarter Total ({formatACV(slipTot?.acv || 0)} of {formatACV(summary.quarter_total_acv || 0)})
            </span>
          )}
        </div>

        {/* Slippage Total Bar */}
        {(() => {
          const isNA = isFuture || slipTot?.count === null
          const cnt = slipTot?.count ?? 0
          const acvVal = slipTot?.acv ?? 0
          const hasDeals = cnt > 0 || acvVal > 0
          const drawerTitle = `Slippage · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${formatACV(acvVal)})`

          return (
            <div className="rounded-xl bg-amber-500/5 dark:bg-amber-950/20 border border-amber-500/20 p-4 flex flex-wrap items-center justify-between gap-4">
              <div
                className={cn(hasDeals && !isNA ? 'cursor-pointer' : 'cursor-not-allowed opacity-75')}
                onClick={() => hasDeals && !isNA && handleDrill(drawerTitle, { kind: 'slippage_total' })}
                title={hasDeals ? 'Click to view all slipped deals' : '0 deals'}
              >
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">
                  Slippage Total
                </div>
                <div className="flex items-baseline gap-3">
                  <span className={cn('text-2xl font-black text-[var(--text-primary)] tabular-nums', hasDeals && !isNA && 'hover:underline')}>
                    {isNA ? 'n/a' : formatACV(acvVal)}
                  </span>
                  <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                    {isNA ? 'n/a' : `${formatCount(cnt)} deals`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(() => {
                  const renderTotBox = (label: string, delta: any, comp: 'yesterday' | 'last_week', dateStr: string) => {
                    if (delta === null || delta === undefined || isFuture) {
                      return (
                        <div className="p-2 rounded-lg bg-slate-500/5 border border-slate-500/10 min-w-[120px]">
                          <div className="text-[10px] font-semibold text-[var(--text-muted)]">{label}</div>
                          <div className="font-bold text-xs text-[var(--text-muted)]">n/a</div>
                          <div className="text-[10px] text-[var(--text-muted)]">n/a</div>
                        </div>
                      )
                    }
                    const count = Math.abs(delta.count || 0)
                    const acv = Math.abs(delta.acv || 0)
                    const hasBoxDeals = count > 0 || acv > 0
                    const colorCls = hasBoxDeals
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'
                    const acvTxt = formatACV(delta.acv || 0)
                    const cntTxt = `${count} ${count === 1 ? 'deal' : 'deals'}`
                    const periodName = comp === 'yesterday' ? 'yesterday' : 'last week'
                    const boxDrawerTitle = `Slippage · since ${periodName} (${count} ${count === 1 ? 'deal' : 'deals'} · ${formatACV(acv)})`

                    return (
                      <div
                        className={cn('p-2 rounded-lg border min-w-[120px] transition-all', colorCls, hasBoxDeals ? 'cursor-pointer hover:border-amber-500/50' : 'cursor-not-allowed opacity-60')}
                        onClick={() => hasBoxDeals && handleDrill(boxDrawerTitle, { kind: 'slipped', compare: comp })}
                        title={hasBoxDeals ? `Click to view deals changed since ${dateStr}` : `No deals changed since ${dateStr}`}
                      >
                        <div className="text-[10px] font-semibold text-[var(--text-muted)]">{label}</div>
                        <div className="font-bold text-xs tabular-nums">{acvTxt}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{cntTxt}</div>
                      </div>
                    )
                  }

                  return (
                    <>
                      {renderTotBox('Since yesterday', slipTot?.delayed_vs_yesterday, 'yesterday', yDateStr)}
                      {renderTotBox('Since last week', slipTot?.delayed_vs_lastweek, 'last_week', wDateStr)}
                    </>
                  )
                })()}
              </div>
            </div>
          )
        })()}

        {/* 3 Slippage Destination Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          <DelayedKpiCard
            title="Slipped to next fiscal year"
            definition="The new fiscal year is later than the selected quarter's year (including Q4 moving to Q1)."
            data={summary.slippage?.slipped_next_year || summary.slipped_next_year}
            icon={CalendarX2}
            accent="amber"
            kind="slipped_next_year"
            comparePeriod="period_start"
          />
          <DelayedKpiCard
            title="Slipped to next quarter"
            definition="The new period is the immediately following quarter in the same fiscal year."
            data={summary.slippage?.slipped_next_quarter || summary.slipped_next_quarter}
            icon={CalendarX2}
            accent="amber"
            kind="slipped_next_quarter"
            comparePeriod="period_start"
          />
          <DelayedKpiCard
            title="Slipped to a later quarter, same year"
            definition="Any other later quarter in the same fiscal year."
            data={summary.slippage?.slipped_later_quarter || summary.slipped_later_quarter}
            icon={CalendarX2}
            accent="amber"
            kind="slipped_later_quarter"
            comparePeriod="period_start"
          />
        </div>
      </div>

      {/* ────────────────── SECTION 3: LOST SINCE START OF QUARTER ────────────────── */}
      <div id="delayed-lost-group" className="space-y-4 scroll-mt-24">
        <div className="border-b border-[var(--border)] pb-2">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            <span>Lost since start of quarter</span>
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Deals deleted or lost since the start of quarter baseline (excluded from delayed totals).
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          <DelayedKpiCard
            title="Lost since start of quarter"
            definition="Deals deleted or lost since the start of quarter baseline (excluded from delayed totals)."
            data={summary.lost}
            icon={AlertTriangle}
            accent="slate"
            kind="lost"
            comparePeriod="period_start"
          />
        </div>
      </div>

      {/* Overdue Ageing Breakdown */}
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

      {/* Historical Trend and Newly Delayed */}
      <div id="delayed-trends" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-24">
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
      <div id="delayed-breakdowns" className="grid grid-cols-1 lg:grid-cols-2 gap-4 scroll-mt-24">
        <Card className="flex flex-col h-[400px]" padding="none">
          <div className="overflow-x-auto h-full p-4">
            <CompactGrid
              title="By Region"
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
        </Card>

        <Card className="flex flex-col h-[400px]" padding="none">
          <div className="overflow-x-auto h-full p-4">
            <CompactGrid
              title="By Business Unit"
              rowLabelName="Business Unit"
              columns={buGrid.categories}
              columnLabels={{ 'Blank': 'Deleted / lost in snapshot' }}
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
      <Card id="delayed-top-deals" padding="none" className="scroll-mt-24">
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
            <table className="table-enterprise text-xs">
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

      {/* ────────────────── BOTTOM SECTION: NEEDS REVIEW ────────────────── */}
      {summary.needs_review?.has_exceptions && summary.needs_review?.types?.some((t: any) => t.count > 0) && (
        <div id="delayed-needs-review" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 scroll-mt-24 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-amber-500/20 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  Needs review
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-500/20 text-amber-800 dark:text-amber-300">
                  {summary.needs_review.total_count} {summary.needs_review.total_count === 1 ? 'deal' : 'deals'}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Deals requiring inspection. None of these deals count in any headline totals above.
              </p>
            </div>
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              Total Exception ACV: {formatACV(summary.needs_review.total_acv)}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table-enterprise text-xs">
              <thead>
                <tr>
                  <th className="text-left font-semibold">Review Type</th>
                  <th className="text-right font-semibold">Deals</th>
                  <th className="text-right font-semibold">ACV</th>
                  <th className="text-left font-semibold">Explanation</th>
                  <th className="text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summary.needs_review.types?.filter((t: any) => t.count > 0).map((t: any) => (
                  <tr key={t.type_id} className="hover:bg-amber-500/10 transition-colors">
                    <td className="font-bold text-[var(--text-primary)]">{t.title}</td>
                    <td className="text-right font-semibold tabular-nums">{t.count}</td>
                    <td className="text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatACV(t.acv)}</td>
                    <td className="text-[var(--text-secondary)] text-[11px] max-w-md">{t.explanation}</td>
                    <td className="text-right">
                      <button
                        onClick={() => handleDrill(t.title, { kind: 'needs_review', review_type: t.type_id })}
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
      )}

      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={dealsData?.deals || []}
          initialFilters={modalFilters.kind ? {} : {
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
