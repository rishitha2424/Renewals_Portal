import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { AlertTriangle, TrendingUp, BarChart2, ListTodo, Activity } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { getV2ExpirySummary, getV2ExpiryDeals, getV2OverviewMovements, getV2OverviewDeals } from '@/api/client'
import { formatDate, acvM, formatCurrency } from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import { PageErrorState } from '@/components/ui/PageErrorState'
import MetricToggle from '@/components/common/MetricToggle'
import CompactGrid from '@/components/common/CompactGrid'
import SummaryLine from '@/components/common/SummaryLine'
import DealListModal from '@/components/common/DealListModal'
import { MovementsSummary } from '@/components/common/MovementsSummary'
import FilterBar from '@/components/common/FilterBar'
import Card from '@/components/ui/Card'
import clsx from 'clsx'

export default function Expiry() {
  const {
    activeSnapshotId,
    compareSnapshotId,
    snapshots,
    includeDeletedLost,
    selectedOppId,
    setSelectedOppId,
    metricMode
  } = useAppStore()

  const activeSnapshot = snapshots.find(s => s.id === activeSnapshotId)
  const compareSnapshot = snapshots.find(s => s.id === compareSnapshotId)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalParams, setModalParams] = useState<{ quarter: string | null; category: string | null; slippage?: boolean; period_type?: string }>({ quarter: null, category: null, period_type: 'fiscal' })
  const [drillDeals, setDrillDeals] = useState<any[] | null>(null)
  
  const [heatMode, setHeatMode] = useState<'Value'|'Yesterday'|'LastWeek'>('Value')
  const [periodMode, setPeriodMode] = useState<'fiscal' | 'service_expiry'>('fiscal')

  const { data: sum, isLoading, isError, refetch: refetchSum } = useQuery({
    queryKey: ['v2ExpirySummary', activeSnapshotId, compareSnapshotId, includeDeletedLost, periodMode],
    queryFn: () => getV2ExpirySummary({
      as_of: activeSnapshot?.snapshot_date,
      compare: compareSnapshot?.snapshot_date,
      exclude_deleted_lost: !includeDeletedLost,
      period_type: periodMode,
    }),
    enabled: !!activeSnapshotId,
  })

  const { data: dealsData } = useQuery({
    queryKey: ['v2ExpiryDeals', activeSnapshotId, modalParams.quarter, modalParams.category, modalParams.slippage, modalParams.period_type, includeDeletedLost],
    queryFn: () => getV2ExpiryDeals({
      quarter: modalParams.quarter || undefined,
      category: modalParams.category || undefined,
      slippage: modalParams.slippage,
      period_type: modalParams.period_type || periodMode,
      as_of: activeSnapshot?.snapshot_date,
      exclude_deleted_lost: !includeDeletedLost
    }),
    enabled: modalOpen && !!activeSnapshotId,
  })

  const { data: movementsData } = useQuery({
    queryKey: ['v2ExpiryMovements', activeSnapshotId],
    queryFn: () => getV2OverviewMovements('yesterday', { as_of: activeSnapshotId }),
    enabled: !!activeSnapshotId,
  })

  const { data: openDealsData } = useQuery({
    queryKey: ['v2ExpiryOpenDeals', activeSnapshotId, includeDeletedLost],
    queryFn: () => getV2OverviewDeals({
      as_of: activeSnapshotId || undefined,
      exclude_deleted: !includeDeletedLost,
      filterSpec: {
        forecast_categories: ['Commit', 'Best Case', 'Pipeline'],
        include_deleted_lost: includeDeletedLost,
      }
    }),
    enabled: !!activeSnapshotId,
  })

  const changedDeals = React.useMemo(() => {
    const list: any[] = []
    movementsData?.positive?.forEach((p: any) => {
      p.deals?.forEach((d: any) => list.push({ ...d, direction: 'positive' }))
    })
    movementsData?.negative?.forEach((n: any) => {
      n.deals?.forEach((d: any) => {
        if (d.opportunity_name) {
          list.push({ ...d, direction: 'negative' })
        }
      })
    })
    return list
  }, [movementsData])

  const topOpenDeals = React.useMemo(() => {
    return (openDealsData?.deals || []).slice(0, 5)
  }, [openDealsData])


  if (!activeSnapshotId || snapshots.length === 0) {
    return <PageNoSnapshotState />
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-[var(--bg-secondary)] animate-pulse rounded-md"></div>
        <div className="h-48 w-full bg-[var(--bg-secondary)] animate-pulse rounded-xl"></div>
        <div className="h-48 w-full bg-[var(--bg-secondary)] animate-pulse rounded-xl"></div>
      </div>
    )
  }

  if (isError || !sum || sum.error) {
    return <PageErrorState message={sum?.error || "Couldn’t load this page. Try again"} onRetry={() => refetchSum()} />
  }
  if (!sum.grand_total) {
    return <PageNoSnapshotState />
  }

  const handleCellClick = (quarter: string | null, category: string | null, title: string, isSlippage = false, periodType?: string) => {
    setDrillDeals(null)
    setModalParams({ quarter, category, slippage: isSlippage, period_type: periodType || periodMode })
    setModalTitle(title)
    setModalOpen(true)
  }

  const fy1 = sum.fiscal_years?.[0]?.label || '2026'
  const fy2 = sum.fiscal_years?.[1]?.label || '2027'
  const grid1 = sum.grids?.[fy1]
  const grid2 = sum.grids?.[fy2]
  const deltas1 = sum.deltas?.[fy1]
  const deltas2 = sum.deltas?.[fy2]

  const grandTotal = sum.grand_total || { count: 0, acv: 0 }
  const yestGrand = deltas1?.yesterday?.grand
  const lastGrand = deltas1?.lastweek?.grand

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-12"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)]">Expiry</h1>
          <p className="text-[var(--text-muted)] mt-1 text-sm font-medium">
            As of {formatDate(sum.snapshot_date)} {sum.compare_date && ` vs ${formatDate(sum.compare_date)}`}
          </p>
        </div>
        <div className="flex items-center gap-3 bg-[var(--bg-secondary)] p-1.5 rounded-xl border border-[var(--border)] shadow-sm">
          <div className="flex items-center gap-1 bg-[var(--bg-primary)] p-1 rounded-lg border border-[var(--border)] shadow-inner">
             <span className="px-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Heat by</span>
             <button onClick={() => setHeatMode('Value')} className={clsx("px-2.5 py-1 rounded-md text-xs font-bold transition-all", heatMode === 'Value' ? "bg-indigo-500 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]")}>Value</button>
             <button onClick={() => setHeatMode('Yesterday')} className={clsx("px-2.5 py-1 rounded-md text-xs font-bold transition-all", heatMode === 'Yesterday' ? "bg-indigo-500 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]")}>vs Yesterday</button>
             <button onClick={() => setHeatMode('LastWeek')} className={clsx("px-2.5 py-1 rounded-md text-xs font-bold transition-all", heatMode === 'LastWeek' ? "bg-indigo-500 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]")}>vs Last Week</button>
          </div>
          <MetricToggle />
        </div>
      </div>

      {/* View by Toggle with definitions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-secondary)] p-3 rounded-xl border border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-[var(--text-secondary)] whitespace-nowrap">View by:</span>
          <div className="inline-flex p-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border)] shadow-xs">
            <button
              id="view-by-fiscal"
              onClick={() => setPeriodMode('fiscal')}
              className={clsx(
                "px-3 py-1 rounded-md text-xs font-bold transition-all",
                periodMode === 'fiscal'
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              Fiscal period
            </button>
            <button
              id="view-by-service-expiry"
              onClick={() => setPeriodMode('service_expiry')}
              className={clsx(
                "px-3 py-1 rounded-md text-xs font-bold transition-all",
                periodMode === 'service_expiry'
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              Service end date
            </button>
          </div>
        </div>
        <div className="text-xs text-[var(--text-muted)] italic">
          {periodMode === 'fiscal'
            ? 'Fiscal period: Deals closing in each fiscal quarter (matches Overview & Executive numbers).'
            : 'Service end date: Groups deals by when contract service ends; totals will differ from the Overview.'}
        </div>
      </div>

      {/* Service end date info note */}
      {periodMode === 'service_expiry' && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-medium">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Includes services that end in this quarter regardless of close date; totals will differ from the Overview.</span>
        </div>
      )}

      {/* Grand Total & Slippage KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors cursor-pointer border-l-4 border-l-indigo-500"
          onClick={() => handleCellClick(null, null, `All Expiry Deals (FY${fy1} + FY${fy2})`)}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                FY{fy1} All-Years Total Expiry ({periodMode === 'fiscal' ? 'Fiscal Period' : 'Service End Date'})
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                {grandTotal.count} deals
              </span>
            </div>
            <div className="text-3xl font-black text-[var(--text-primary)] mt-2">
              {formatCurrency(grandTotal.acv)}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            <span>
              vs Yesterday: <strong className={yestGrand?.acv && yestGrand.acv > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {yestGrand ? `${yestGrand.count >= 0 ? '+' : ''}${yestGrand.count} deals / ${formatCurrency(yestGrand.acv)}` : '—'}
              </strong>
            </span>
            <span>
              vs Last Week: <strong className={lastGrand?.acv && lastGrand.acv > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
                {lastGrand ? `${lastGrand.count >= 0 ? '+' : ''}${lastGrand.count} deals / ${formatCurrency(lastGrand.acv)}` : '—'}
              </strong>
            </span>
          </div>
        </Card>

        <Card
          className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors cursor-pointer border-l-4 border-l-amber-500"
          onClick={() => handleCellClick(null, null, `Slippage to FY${fy2} (${sum.slippage?.count || 0} deals)`, true)}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Slippage to FY{fy2}
              </span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {sum.slippage?.count ?? 0} deals
              </span>
            </div>
            <div className="text-3xl font-black text-amber-600 dark:text-amber-400 mt-2">
              {formatCurrency(sum.slippage?.acv ?? 0)}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)] flex items-center justify-between">
            <span>Close date after FY{fy1} year end</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold hover:underline">Click to view slippage deals →</span>
          </div>
        </Card>
      </div>

      {sum.fiscal_years?.map((fyObj: any) => {
        const yLabel = fyObj.label
        const grid = sum.grids?.[yLabel]
        if (!grid) return null
        const deltas = sum.deltas?.[yLabel]
        return (
          <div key={yLabel} className="space-y-1">
            <CompactGrid
              title={`FY ${yLabel} Expiry (${periodMode === 'fiscal' ? 'Fiscal Period' : 'Service End Date'})`}
              columns={['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']}
              rows={grid.rows.map((r: any) => ({ id: r.quarter, label: r.label, cells: r.cells, total: r.total }))}
              totals={grid.totals}
              deltas={deltas}
              metricMode={metricMode}
              heatMode={heatMode}
              onCellClick={(quarter, cat, title) => handleCellClick(quarter, cat === 'Total' ? null : cat, title)}
              rowLabelName="Quarter"
              compareDate={sum.compare_date}
            />
            <SummaryLine
              primaryText={`FY${yLabel} expiry: ${acvM(sum.acv_by_year?.[yLabel]?.acv)} · ${sum.acv_by_year?.[yLabel]?.count} deals`}
              secondaryText={yLabel === fy1 && sum.slippage?.count > 0 ? `Slippage to ${fy2}: ${acvM(sum.slippage?.acv)} · ${sum.slippage?.count} deals` : undefined}
              details={yLabel === fy1 && sum.slippage?.by_quarter?.length > 0 ? sum.slippage.by_quarter : undefined}
              onDetailClick={(q) => handleCellClick(q, null, `Slippage Deals in ${q}`, true)}
            />
          </div>
        )
      })}


      {/* Expiry Profile Stacked Column Chart Section */}
      <Card className="p-5 mt-6 hover:border-[var(--primary)] transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-indigo-500" />
              <h2 className="text-base sm:text-lg font-bold text-[var(--text-primary)]">Expiry Profile</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                {periodMode === 'fiscal' ? 'Fiscal Period · Renewals' : 'Service End Date · Renewals'}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {periodMode === 'fiscal'
                ? 'Quarterly expiry profile stacked by forecast category, tied directly to Overview and Executive metrics.'
                : 'Quarterly expiry profile stacked by forecast category based on service end date.'}
            </p>
          </div>

          {/* Fixed Color Legend */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] bg-[var(--bg-secondary)] px-3 py-1.5 rounded-xl border border-[var(--border)]">
            {[
              { label: 'Closed', color: '#0E7490' },
              { label: 'Commit', color: '#1D4ED8' },
              { label: 'Best Case', color: '#3B82F6' },
              { label: 'Pipeline', color: '#D97706' },
              { label: 'Not yet proposed', color: '#64748B' },
            ].map((cat) => (
              <div key={cat.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs shadow-xs" style={{ backgroundColor: cat.color }} />
                <span className="font-semibold text-[var(--text-secondary)]">{cat.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stacked Column Chart */}
        {(() => {
          const chartData: any[] = sum.profile_chart || []
          if (!chartData || chartData.length === 0) {
            return (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                No expiry profile quarters found for the active snapshot.
              </div>
            )
          }

          const maxAcv = Math.max(...chartData.map((d: any) => d.total_acv || 0), 1)
          const chartHeightPx = 180

          return (
            <div className="pt-4 pb-2">
              <div className="flex items-end justify-between gap-2 sm:gap-4 overflow-x-auto pb-2">
                {chartData.map((col: any) => {
                  const total = col.total_acv || 0
                  const heightPct = Math.max((total / maxAcv) * 100, total > 0 ? 8 : 2)
                  const heightPx = Math.round((heightPct / 100) * chartHeightPx)
                  const isCurrent = col.is_current

                  // Order of stack from bottom to top: Closed, Commit, Best Case, Pipeline, Not yet proposed
                  const catList = [
                    { name: 'Closed', data: col.categories?.['Closed'], color: '#0E7490' },
                    { name: 'Commit', data: col.categories?.['Commit'], color: '#1D4ED8' },
                    { name: 'Best Case', data: col.categories?.['Best Case'], color: '#3B82F6' },
                    { name: 'Pipeline', data: col.categories?.['Pipeline'], color: '#D97706' },
                    { name: 'Not yet proposed', data: col.categories?.['Not yet proposed'], color: '#64748B' },
                  ]

                  return (
                    <div
                      key={col.quarter}
                      className={clsx(
                        "flex-1 min-w-[95px] max-w-[140px] flex flex-col items-center group relative rounded-xl p-2 transition-all",
                        isCurrent
                          ? "bg-indigo-500/5 dark:bg-indigo-500/10 border-2 border-indigo-500 shadow-sm"
                          : "hover:bg-[var(--bg-secondary)]/60 border border-transparent"
                      )}
                    >
                      {/* Total ACV above column */}
                      <div
                        className="text-center mb-2 cursor-pointer transition-transform group-hover:scale-105"
                        onClick={() => handleCellClick(col.quarter, null, `${col.label} · All Deals`, false, periodMode)}
                        title={`Click to view all ${col.deal_count} deals in ${col.label}`}
                      >
                        <div className="text-xs sm:text-sm font-black font-mono text-[var(--text-primary)]">
                          {total > 0 ? acvM(total) : '$0'}
                        </div>
                      </div>

                      {/* Stacked Bar Body */}
                      <div
                        className="w-full flex items-end justify-center"
                        style={{ height: `${chartHeightPx}px` }}
                      >
                        {total > 0 ? (
                          <div
                            style={{ height: `${heightPx}px` }}
                            className="w-12 sm:w-14 rounded-lg overflow-hidden flex flex-col-reverse shadow-sm border border-[var(--border)] bg-slate-100 dark:bg-slate-800 transition-all group-hover:shadow-md"
                          >
                            {catList.map((cat) => {
                              const catAcv = cat.data?.acv || 0
                              if (catAcv <= 0) return null
                              const segPct = (catAcv / total) * 100
                              return (
                                <div
                                  key={cat.name}
                                  style={{
                                    height: `${segPct}%`,
                                    backgroundColor: cat.color,
                                  }}
                                  className="w-full cursor-pointer hover:opacity-85 transition-opacity relative"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleCellClick(
                                      col.quarter,
                                      cat.data?.raw_category || cat.name,
                                      `${col.label} · ${cat.name} Deals`,
                                      false,
                                      periodMode
                                    )
                                  }}
                                  title={`${col.label} · ${cat.name}: ${formatCurrency(catAcv)} (${segPct.toFixed(1)}%) · ${cat.data?.count || 0} deals (Click to view)`}
                                />
                              )
                            })}
                          </div>
                        ) : (
                          <div
                            style={{ height: '8px' }}
                            className="w-12 sm:w-14 rounded bg-slate-200 dark:bg-slate-700 border border-dashed border-slate-300 dark:border-slate-600"
                            title={`${col.label}: No renewal deals`}
                          />
                        )}
                      </div>

                      {/* Quarter Label & Metrics Below Column */}
                      <div className="mt-3 text-center w-full pt-2 border-t border-[var(--border)] space-y-0.5">
                        <div className="flex items-center justify-center gap-1">
                          <span className={clsx("font-bold text-xs", isCurrent ? "text-indigo-600 dark:text-indigo-400" : "text-[var(--text-primary)]")}>
                            {col.label}
                          </span>
                        </div>
                        {isCurrent && (
                          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-indigo-500 text-white shadow-xs">
                            Current
                          </span>
                        )}
                        <div className="text-[11px] font-mono text-[var(--text-muted)] font-semibold">
                          {col.deal_count} deals
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                          {col.commit_coverage_pct > 0 ? `${col.commit_coverage_pct}% commit` : (total > 0 ? '0% commit' : '—')}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </Card>

      {/* Insights Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">

        <Card className="p-4 flex flex-col hover:border-[var(--primary)] transition-colors">
          <div className="flex items-center justify-between gap-2 mb-3 text-[var(--text-primary)]">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              <h3 className="font-bold">Closure Progress</h3>
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">By Quarter</span>
          </div>
          <div className="flex-1 flex flex-col justify-between min-h-[160px] overflow-y-auto">
            <div className="space-y-2.5 flex-1">
              {grid1?.rows?.map((r: any) => {
                const closed = r.cells['Closed']?.acv || 0
                const tot = r.total?.acv || 0
                if (tot === 0) return null
                const pct = Math.round((closed / tot) * 100)
                return (
                  <div key={r.quarter} className="w-full">
                    <div className="flex justify-between text-[10px] font-semibold text-[var(--text-muted)] mb-1">
                      <span>{r.label}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">{pct}% Closed ({acvM(closed)})</span>
                    </div>
                    <div className="flex w-full h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div style={{ width: `${pct}%` }} className="h-full bg-emerald-500 transition-all duration-500" />
                      <div style={{ width: `${100 - pct}%` }} className="h-full bg-slate-300 dark:bg-slate-600" />
                    </div>
                  </div>
                )
              })}
            </div>
            {(() => {
              const totalClosed = grid1?.rows?.reduce((s: number, r: any) => s + (r.cells['Closed']?.acv || 0), 0) || 0
              const totalAll = grid1?.rows?.reduce((s: number, r: any) => s + (r.total?.acv || 0), 0) || 0
              const overallPct = totalAll > 0 ? Math.round((totalClosed / totalAll) * 100) : 0
              return (
                <div className="pt-2.5 mt-3 border-t border-[var(--border)] flex items-center justify-between text-[11px] font-bold text-[var(--text-primary)]">
                  <span>Portfolio Total</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {acvM(totalClosed)} / {acvM(totalAll)} ({overallPct}%)
                  </span>
                </div>
              )
            })()}
          </div>
        </Card>

        <Card className="p-4 flex flex-col hover:border-[var(--primary)] transition-colors">
          <div className="flex items-center justify-between gap-2 mb-3 text-[var(--text-primary)]">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-sky-500" />
              <h3 className="font-bold">What Changed Today</h3>
            </div>
            {changedDeals.length > 0 && (
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">
                {changedDeals.length} moves
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-[160px] text-xs space-y-2">
            {changedDeals.length === 0 ? (
              <p className="text-[var(--text-muted)] text-[11px] italic py-8 text-center">
                No changes since {movementsData?.compare_date ? formatDate(movementsData.compare_date) : 'yesterday'}
              </p>
            ) : (
              changedDeals.slice(0, 5).map((d: any, idx: number) => (
                <div
                  key={d.opportunity_id_18 || idx}
                  className="bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors"
                  onClick={() => d.opportunity_id_18 && setSelectedOppId(d.opportunity_id_18)}
                  title="Click to view opportunity details"
                >
                  <div className="flex justify-between font-bold text-[var(--text-primary)]">
                    <span className="truncate pr-2">{d.opportunity_name}</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">{acvM(d.acv || d.forecast_acv_amount)}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                    <span>{d.from_category || d.from_status || 'Previous'}</span>
                    <span className={d.direction === 'positive' ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>→</span>
                    <span className="font-semibold text-[var(--text-primary)]">{d.to_category || d.to_status || 'Current'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4 flex flex-col hover:border-[var(--primary)] transition-colors">
          <div className="flex items-center justify-between gap-2 mb-3 text-[var(--text-primary)]">
            <div className="flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold">Largest Open</h3>
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">Top ACV</span>
          </div>
          <div className="flex-1 overflow-y-auto min-h-[160px] text-xs space-y-2">
            {topOpenDeals.length === 0 ? (
              <p className="text-[var(--text-muted)] text-[11px] italic py-8 text-center">No open deals found</p>
            ) : (
              topOpenDeals.map((d: any, idx: number) => (
                <div
                  key={d.opportunity_id_18 || idx}
                  className="bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors"
                  onClick={() => d.opportunity_id_18 && setSelectedOppId(d.opportunity_id_18)}
                  title="Click to view opportunity details"
                >
                  <div className="flex justify-between font-bold text-[var(--text-primary)]">
                    <span className="truncate pr-2">{d.opportunity_name}</span>
                    <span className="font-mono text-amber-600 dark:text-amber-400">{acvM(d.forecast_acv_amount || d.acv)}</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center justify-between">
                    <span className="font-semibold text-[var(--text-secondary)]">{d.forecast_category}</span>
                    <span className="text-[var(--text-muted)] truncate max-w-[120px]">{d.sub_region || d.account_name || ''}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Shared Movement Section */}
      <Card className="p-6 mt-8">
        <MovementsSummary
          movements={movementsData}
          onSelectDeals={(title, deals) => {
            setModalTitle(title)
            setDrillDeals(deals)
            setModalOpen(true)
          }}
        />
      </Card>

      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={drillDeals || dealsData || []}
          onSelectOpp={setSelectedOppId}
          onClose={() => {
            setModalOpen(false)
            setDrillDeals(null)
          }}
        />
      )}
      <OpportunityDrawer oppId={selectedOppId} onClose={() => setSelectedOppId(null)} />
    </motion.div>
  )
}