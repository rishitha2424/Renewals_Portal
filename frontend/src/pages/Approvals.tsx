import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Clock,
  FileQuestion,
  Sigma,
  Activity,
  TrendingUp,
  AlertOctagon,
  Info,
  ArrowRight,
  Layers,
  BarChart3,
  Users,
  Globe,
  Building2,
  ChevronRight,
  AlertTriangle,
  ShieldCheck,
  Calendar,
  DollarSign
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { getApprovalsDistribution, getApprovalsDeals } from '@/api/client'
import { formatCurrency, formatNumber, acvM, formatDate, getApprovalStatusLabel, getForecastCategoryLabel } from '@/utils/format'
import { DEFINITIONS } from '@/config/definitions'
import EmptyState from '@/components/ui/EmptyState'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import Tile from '@/components/common/Tile'
import { PageErrorState } from '@/components/ui/PageErrorState'
import MetricToggle from '@/components/common/MetricToggle'
import CompactGrid from '@/components/common/CompactGrid'
import DealListModal from '@/components/common/DealListModal'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import Card from '@/components/ui/Card'
import SectionNav from '@/components/common/SectionNav'
import ExcludedTypesNote from '@/components/common/ExcludedTypesNote'
import CardRow from '@/components/common/CardRow'
import InsightCard from '@/components/common/InsightCard'
import ChartCard from '@/components/common/ChartCard'
import ScrollList from '@/components/common/ScrollList'
import { getApprovalsInsights } from '@/insights/generators'

function formatDelta(val: number, isCount: boolean) {
  if (val == null) return null
  const sign = val > 0 ? '+' : ''
  const color = val > 0 ? 'text-emerald-600 dark:text-emerald-400' : val < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-muted)]'
  const text = isCount ? `${sign}${val}` : `${sign}${acvM(val)}`
  return <span className={color}>{text}</span>
}

function StatChip({ label, data, icon: Icon, metricMode, compareDate, compareSetting, tooltip, pctOfPeriod, tone }: any) {
  const isCount = metricMode === 'Count'
  const isBoth = metricMode === 'Both'
  const isAmount = metricMode === 'Amount'

  return (
    <Tile
      tone={tone}
      title={label}
      amount={isBoth || isAmount ? acvM(data.acv) : `${formatNumber(data.count)} deals`}
      count={data.count}
      deltaYesterday={data.delta_yesterday}
      deltaLastWeek={data.delta_lastweek}
      subtitle={pctOfPeriod != null ? `${pctOfPeriod.toFixed(1)}% of period ACV` : undefined}
    />
  )
}

export default function Approvals() {
  const { activeSnapshotId, compareSnapshotId, includeDeletedLost, snapshots, metricMode, selectedOppId, setSelectedOppId } = useAppStore()
  
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<any>({})
  const [coverageTab, setCoverageTab] = useState<'category' | 'region' | 'bu'>('category')
  const [movementsMode, setMovementsMode] = useState<'yesterday' | 'lastweek'>('yesterday')
  const [commitFilter, setCommitFilter] = useState<'All' | 'Not submitted' | 'Waiting for approval'>('All')

  const activeSnapshot = snapshots.find(s => s.id === activeSnapshotId)
  const compareSnapshot = snapshots.find(s => s.id === compareSnapshotId)

  const effectiveAsOf = activeSnapshot?.snapshot_date || activeSnapshotId || undefined

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals_v2', activeSnapshotId, effectiveAsOf, compareSnapshotId, includeDeletedLost],
    queryFn: async () => {
      if (!activeSnapshotId) return null
      return getApprovalsDistribution(effectiveAsOf, compareSnapshot?.snapshot_date, includeDeletedLost)
    },
    enabled: !!activeSnapshotId,
  })

  const { data: dealsData } = useQuery({
    queryKey: ['approvals_deals_v2', activeSnapshotId, effectiveAsOf, modalFilters, includeDeletedLost],
    queryFn: () => getApprovalsDeals(
      effectiveAsOf || '', 
      modalFilters.approval_status || undefined, 
      modalFilters.forecast_category || undefined, 
      includeDeletedLost,
      modalFilters.sub_region || undefined,
      modalFilters.business_unit_primary || undefined,
      undefined,
      modalFilters.min_acv,
      modalFilters.max_acv,
      modalFilters.deal_ids,
      modalFilters.kind
    ),
    enabled: modalOpen && !!activeSnapshotId,
  })

  const approvalsSections = React.useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (data?.total?.count != null) {
      list.push({ id: 'approvals-summary', title: 'Approval Status' })
    }
    if (data?.matrix && Object.keys(data.matrix).length > 0) {
      list.push({ id: 'approvals-matrix', title: 'Status vs Category' })
    }
    if (data?.deal_size_split?.statuses?.length > 0) {
      list.push({ id: 'approvals-deal-size', title: 'Deal-Size Split' })
    }
    if (data?.approval_coverage) {
      list.push({ id: 'approvals-coverage', title: 'Approval Coverage' })
    }
    if ((data?.commit_not_approved?.count ?? 0) > 0 || (data?.pending_ageing?.count ?? 0) > 0) {
      list.push({ id: 'approvals-commit-risk', title: 'Commit Risks & Ageing' })
    }
    if (data?.approved_trend && data.approved_trend.length > 0) {
      list.push({ id: 'approvals-trend', title: 'Approved Share Over Time' })
    }
    if ((data?.movements_yesterday && data.movements_yesterday.length > 0) || (data?.movements_lastweek && data.movements_lastweek.length > 0) || (data?.movements_custom && data.movements_custom.length > 0)) {
      list.push({ id: 'approvals-movements', title: 'Status Movements' })
    }
    return list
  }, [data])

  if (!activeSnapshotId || snapshots.length === 0) return <PageNoSnapshotState />
  if (isLoading) return <div className="p-8 text-center text-slate-500 animate-pulse">Loading approval data...</div>
  if (error || data?.error) return <PageErrorState message={(error as any)?.message || data?.error || "Couldn’t load this page. Try again"} onRetry={() => refetch()} />
  if (!data || !data.total) return <PageNoSnapshotState />

  const total = data.total || { count: 0, acv: 0 }
  const statuses = data.statuses || []
  const matrix = data.matrix || {}
  const categories = data.categories || []
  const movements_yesterday = data.movements_yesterday || []
  const movements_lastweek = data.movements_lastweek || []
  const movements_custom = data.movements_custom || []
  const pending_deals = data.pending_deals || []
  const data_slice = data.data_slice || ''
  const data_slice_key = data.data_slice_key || ''
  const yesterday_date = data.yesterday_date
  const lastweek_date = data.lastweek_date

  // New rich sections from backend
  const funnel = data.funnel || []
  const deal_size_split = data.deal_size_split || { threshold_label: '', statuses: [] }
  const approval_coverage = data.approval_coverage || { portfolio_average_pct: 0, by_category: [], by_region: [], by_bu: [] }
  const commit_not_approved = data.commit_not_approved || { count: 0, acv: 0, deals: [] }
  const pending_ageing = data.pending_ageing || { count: 0, acv: 0, deals: [] }
  const approved_trend = data.approved_trend || []
  
  const getStatus = (name: string) => statuses.find((s: any) => s.status === name) || { count: 0, acv: 0, delta_yesterday: {}, delta_lastweek: {}, delta_custom: {} }
  const attachDates = (obj: any) => ({ ...obj, yesterday_date, lastweek_date })

  const handleCellClick = (filters: any, title?: string) => {
    setModalFilters(filters)
    setModalTitle(title || `Deals`)
    setModalOpen(true)
  }

  const colSums = categories.reduce((acc: any, c: string) => {
    acc[c] = { count: 0, acv: 0 }
    Object.values(matrix).forEach((row: any) => {
      acc[c].count += row[c]?.count || 0
      acc[c].acv += row[c]?.acv || 0
    })
    return acc
  }, {})

  const rowsForGrid = Object.entries(matrix).map(([st, cells]: [string, any]) => ({
    id: st,
    label: st,
    cells: cells || {},
    total: getStatus(st)
  }))

  const deltasForGrid = {
    yesterday: {
      rows: statuses.reduce((acc: any, s: any) => ({ ...acc, [s.status]: s.delta_yesterday }), {}),
      grand: total.delta_yesterday
    },
    lastweek: {
      rows: statuses.reduce((acc: any, s: any) => ({ ...acc, [s.status]: s.delta_lastweek }), {}),
      grand: total.delta_lastweek
    },
    custom: {
      rows: statuses.reduce((acc: any, s: any) => ({ ...acc, [s.status]: s.delta_custom }), {}),
      grand: total.delta_custom
    }
  }

  // Donut chart logic
  let cumulativePct = 0
  const donutSegments = statuses.map((r: any) => {
    const pct = total.acv ? (r.acv / total.acv) * 100 : 0
    const startPct = cumulativePct
    cumulativePct += pct
    const color = r.status === 'Approved' ? '#10B981' : r.status === 'Pending Approval' ? '#F59E0B' : r.status === 'Blank' ? '#94A3B8' : '#ef4444'
    return { ...r, pct, startPct, color }
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-20"
    >
      <SectionNav sections={approvalsSections} />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tight">Approval Funnel</h1>
          <p className="text-[var(--text-muted)] mt-1 flex items-center gap-2 text-sm font-medium">
            <span className="px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">{data_slice}</span>
            <span className="px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">{data_slice_key}</span>
            <span>As of {activeSnapshot?.snapshot_date}</span>
          </p>
        </div>
        <MetricToggle />
      </div>

      <ExcludedTypesNote
        excluded={data?.other_types_excluded}
        onViewDeals={() => handleCellClick({ kind: 'other_types' }, 'Other Types Excluded')}
      />

      {(!isLoading && (total?.count ?? 0) === 0) && (
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]">
          No deals for this selection
        </div>
      )}

      {/* Slim Stat Chips */}
      <div id="approvals-summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 scroll-mt-24">
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Approved' }, 'Approved Deals')}>
          <StatChip
            tone="approved"
            label="Approved"
            data={attachDates(getStatus('Approved'))}
            icon={CheckCircle2}
            metricMode={metricMode}
            compareDate={compareSnapshot?.snapshot_date}
            compareSetting={movementsMode}
            tooltip={DEFINITIONS.approvals_approved}
            pctOfPeriod={total.acv ? (getStatus('Approved').acv / total.acv) * 100 : 0}
          />
        </div>
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'Pending Deals')}>
          <StatChip
            tone="pending"
            label="Pending approval"
            data={attachDates(getStatus('Pending Approval'))}
            icon={Clock}
            metricMode={metricMode}
            compareDate={compareSnapshot?.snapshot_date}
            compareSetting={movementsMode}
            tooltip={DEFINITIONS.approvals_pending}
            pctOfPeriod={total.acv ? (getStatus('Pending Approval').acv / total.acv) * 100 : 0}
          />
        </div>
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Blank' }, 'Not Submitted Deals')}>
          <StatChip
            tone="not_submitted"
            label="Not submitted"
            data={attachDates(getStatus('Blank'))}
            icon={FileQuestion}
            metricMode={metricMode}
            compareDate={compareSnapshot?.snapshot_date}
            compareSetting={movementsMode}
            tooltip={DEFINITIONS.approvals_not_submitted}
            pctOfPeriod={total.acv ? (getStatus('Blank').acv / total.acv) * 100 : 0}
          />
        </div>
        <div className="cursor-pointer" onClick={() => handleCellClick({}, 'All Deals')}>
          <StatChip
            tone="total"
            label="Total"
            data={attachDates(total)}
            icon={Sigma}
            metricMode={metricMode}
            compareDate={compareSnapshot?.snapshot_date}
            compareSetting={movementsMode}
            tooltip={DEFINITIONS.approvals_total}
            pctOfPeriod={100}
          />
        </div>
      </div>

      {/* Overview Reconciliation Banner */}
      {data.overview_reconciliation && (
        <div className={`p-3 rounded-xl border text-xs flex items-center justify-between shadow-xs ${
          data.overview_reconciliation.matches
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
        }`}>
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>
              <strong>Overview Reconciliation:</strong> Approvals total matches Overview ({formatNumber(data.overview_reconciliation.approvals_count)} deals · {formatCurrency(data.overview_reconciliation.approvals_acv)})
            </span>
          </div>
          <span className="text-[11px] opacity-80 font-medium">
            Portfolio Scope: {data_slice}
          </span>
        </div>
      )}

      {/* Grid: Donut Chart, Status vs FC Matrix & Approval Insights */}
      <CardRow template="minmax(280px, 320px) max-content minmax(280px, 1fr)" id="approvals-matrix">
        {/* Left: Donut Chart */}
        <Card className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors h-full">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-3 cursor-pointer" onClick={() => handleCellClick({}, 'All Approvals')}>
              Status Share
            </h2>
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-36 h-36 flex-shrink-0 flex items-center justify-center cursor-pointer" onClick={() => handleCellClick({}, 'All Approvals')}>
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--bg-secondary)" strokeWidth="14" />
                  {donutSegments.map((seg: any) => {
                    const circumference = 2 * Math.PI * 40
                    const strokeDasharray = `${(seg.pct / 100) * circumference} ${circumference}`
                    const strokeDashoffset = -((seg.startPct / 100) * circumference)
                    if (seg.pct === 0) return null
                    return (
                      <circle
                        key={seg.status}
                        cx="50" cy="50" r="40"
                        fill="transparent"
                        stroke={seg.color}
                        strokeWidth="14"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all hover:opacity-80"
                        onClick={(e) => { e.stopPropagation(); handleCellClick({ approval_status: seg.status }, `${getApprovalStatusLabel(seg.status)} Deals`) }}
                      >
                        <title>
                          {metricMode === 'Both'
                            ? `${getApprovalStatusLabel(seg.status)}: ${formatNumber(seg.count)} deals · ${formatCurrency(seg.acv)} (${seg.pct.toFixed(1)}%)`
                            : metricMode === 'Amount'
                            ? `${getApprovalStatusLabel(seg.status)}: ${formatCurrency(seg.acv)} (${seg.pct.toFixed(1)}%)`
                            : `${getApprovalStatusLabel(seg.status)}: ${formatNumber(seg.count)} deals (${((seg.count / (total.count || 1)) * 100).toFixed(1)}%)`
                          }
                        </title>
                      </circle>
                    )
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-2">
                  {metricMode === 'Both' ? (
                    <>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Total</span>
                      <span className="text-base font-black text-[var(--text-primary)] font-mono tabular-nums leading-tight" title={formatCurrency(total?.acv ?? 0)}>
                        {acvM(total?.acv ?? 0)}
                      </span>
                      <span className="text-xs font-black text-[var(--text-primary)] font-mono tabular-nums leading-tight">
                        {formatNumber(total?.count ?? 0)} deals
                      </span>
                    </>
                  ) : metricMode === 'Amount' ? (
                    <>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">ACV</span>
                      <span className="text-xl font-black text-[var(--text-primary)] font-mono tabular-nums" title={formatCurrency(total?.acv ?? 0)}>
                        {acvM(total?.acv ?? 0)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Deals</span>
                      <span className="text-xl font-black text-[var(--text-primary)] font-mono tabular-nums">
                        {formatNumber(total?.count ?? 0)} deals
                      </span>
                    </>
                  )}
                </div>
              </div>
              
              {/* Legend */}
              <div className="w-full space-y-1.5">
                {donutSegments.map((seg: any) => {
                  const displayStatus = getApprovalStatusLabel(seg.status)
                  const pctOfDeals = total.count > 0 ? ((seg.count / total.count) * 100).toFixed(0) : '0'
                  const pctOfAcv = seg.pct.toFixed(0)

                  return (
                    <div
                      key={seg.status}
                      className="flex items-center justify-between bg-[var(--bg-secondary)] px-2.5 py-1.5 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors text-xs"
                      onClick={() => handleCellClick({ approval_status: seg.status }, `${displayStatus} Deals`)}
                    >
                      <div className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }}></div>
                        <span className="truncate max-w-[110px]">{displayStatus}</span>
                      </div>
                      {metricMode === 'Both' ? (
                        <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                          <span className="font-bold text-[var(--text-primary)]">{formatNumber(seg.count)}</span>
                          <span className="text-[var(--text-muted)]">·</span>
                          <span className="font-bold text-[var(--text-primary)]" title={formatCurrency(seg.acv)}>{acvM(seg.acv)}</span>
                          <span className="text-[10px] text-[var(--text-muted)] font-sans">({pctOfAcv}%)</span>
                        </div>
                      ) : metricMode === 'Amount' ? (
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)]" title={formatCurrency(seg.acv)}>
                          {acvM(seg.acv)} ({pctOfAcv}%)
                        </span>
                      ) : (
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                          {formatNumber(seg.count)} ({pctOfDeals}%)
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* Middle: Compact Grid */}
        <div className="h-full flex flex-col justify-between">
          {(() => {
            const rawCategories = categories && categories.length > 0 ? categories : Object.keys(colSums || {})
            const displayCategories = rawCategories.filter((c: string) => {
              const s = colSums[c]
              return s ? (s.count > 0 || (s.acv != null && s.acv !== 0)) : true
            })
            return (
              <CompactGrid
                title="Status vs. Forecast Category"
                columns={displayCategories}
                columnLabels={{ 'Blank': 'Deleted / lost in snapshot' }}
                rows={rowsForGrid}
                totals={{ category: colSums, grand: { count: total.count, acv: total.acv } }}
                deltas={deltasForGrid}
                metricMode={metricMode}
                onCellClick={(r, c, title) => handleCellClick({ approval_status: r === 'Total' ? null : r, forecast_category: c === 'Total' ? null : c }, title)}
                rowLabelName="Status"
                compareDate={compareSnapshot?.snapshot_date}
              />
            )
          })()}
        </div>

        {/* Right: Approval Insights */}
        <div className="h-full">
          <InsightCard
            title="Approval Insights"
            subtitle="Pipeline risks and readiness"
            insights={getApprovalsInsights(data, (title, p) => handleCellClick(p, title))}
          />
        </div>
      </CardRow>

      {/* 2. Deal-Size Split Card & Chart */}
      {deal_size_split.statuses?.length > 0 && (
        <CardRow template="max-content minmax(320px, 1fr)" id="approvals-deal-size">
          <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors h-full flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-indigo-500" />
                    <span>Deal-Size Split ({deal_size_split.threshold_label} Threshold)</span>
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Deals partitioned by size threshold (≥ {deal_size_split.threshold_label} vs &lt; {deal_size_split.threshold_label}) per approval status
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                  Click any count or amount to inspect deals
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="data-table text-xs text-left" style={{ width: 'max-content', maxWidth: '100%' }}>
                  <thead>
                    {metricMode === 'Both' ? (
                      <>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          <th className="py-2.5 px-3" rowSpan={2}>Status</th>
                          <th className="py-1.5 px-3 text-center border-l border-[var(--border)]" colSpan={3}>
                            Large Deals (≥ {deal_size_split.threshold_label})
                          </th>
                          <th className="py-1.5 px-3 text-center border-l border-[var(--border)]" colSpan={3}>
                            Small Deals (&lt; {deal_size_split.threshold_label})
                          </th>
                          <th className="py-1.5 px-3 text-center border-l border-[var(--border)]" colSpan={3}>
                            Total Status
                          </th>
                        </tr>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/30 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          <th className="py-1.5 px-2.5 text-right border-l border-[var(--border)]">Deals</th>
                          <th className="py-1.5 px-2.5 text-right">ACV</th>
                          <th className="py-1.5 px-2.5 text-right">% Share</th>
                          <th className="py-1.5 px-2.5 text-right border-l border-[var(--border)]">Deals</th>
                          <th className="py-1.5 px-2.5 text-right">ACV</th>
                          <th className="py-1.5 px-2.5 text-right">% Share</th>
                          <th className="py-1.5 px-2.5 text-right border-l border-[var(--border)]">Deals</th>
                          <th className="py-1.5 px-2.5 text-right">ACV</th>
                          <th className="py-1.5 px-2.5 text-right">% of Total</th>
                        </tr>
                      </>
                    ) : metricMode === 'Amount' ? (
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Large ACV (≥ {deal_size_split.threshold_label})</th>
                        <th className="py-2.5 px-3 text-right">Large % Share</th>
                        <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Small ACV (&lt; {deal_size_split.threshold_label})</th>
                        <th className="py-2.5 px-3 text-right">Small % Share</th>
                        <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Total ACV</th>
                        <th className="py-2.5 px-3 text-right">% of Total</th>
                      </tr>
                    ) : (
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Large Deals (≥ {deal_size_split.threshold_label})</th>
                        <th className="py-2.5 px-3 text-right">Large % Share</th>
                        <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Small Deals (&lt; {deal_size_split.threshold_label})</th>
                        <th className="py-2.5 px-3 text-right">Small % Share</th>
                        <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Total Deals</th>
                        <th className="py-2.5 px-3 text-right">% of Total</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono">
                    {deal_size_split.statuses.map((st: any) => {
                      const isTotal = st.status === 'Total'
                      const displayStatus = getApprovalStatusLabel(st.status)
                      const largeCountPct = st.total.count > 0 ? ((st.large.count / st.total.count) * 100).toFixed(1) : '0.0'
                      const smallCountPct = st.total.count > 0 ? ((st.small.count / st.total.count) * 100).toFixed(1) : '0.0'
                      const totalCountPct = total.count > 0 ? ((st.total.count / total.count) * 100).toFixed(1) : '0.0'
                      const totalAcvPct = total.acv > 0 ? ((st.total.acv / total.acv) * 100).toFixed(1) : '0.0'

                      if (metricMode === 'Both') {
                        return (
                          <tr
                            key={st.status}
                            className={`hover:bg-[var(--bg-secondary)]/70 transition-colors ${isTotal ? 'font-black bg-[var(--bg-secondary)]/30' : ''}`}
                          >
                            <td className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)]">
                              {displayStatus}
                            </td>
                            <td
                              className="py-2 px-2.5 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, min_acv: deal_size_split.threshold }, `${displayStatus} Large Deals (≥ ${deal_size_split.threshold_label})`)}
                            >
                              {formatNumber(st.large.count)}
                            </td>
                            <td
                              className="py-2 px-2.5 text-right cursor-pointer hover:text-[var(--primary)] font-bold text-emerald-600 dark:text-emerald-400 transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, min_acv: deal_size_split.threshold }, `${displayStatus} Large Deals (≥ ${deal_size_split.threshold_label})`)}
                            >
                              {formatCurrency(st.large.acv)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-[var(--text-muted)] font-sans">
                              {st.large.pct_acv}%
                            </td>
                            <td
                              className="py-2 px-2.5 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, max_acv: deal_size_split.threshold }, `${displayStatus} Small Deals (< ${deal_size_split.threshold_label})`)}
                            >
                              {formatNumber(st.small.count)}
                            </td>
                            <td
                              className="py-2 px-2.5 text-right cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, max_acv: deal_size_split.threshold }, `${displayStatus} Small Deals (< ${deal_size_split.threshold_label})`)}
                            >
                              {formatCurrency(st.small.acv)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-[var(--text-muted)] font-sans">
                              {st.small.pct_acv}%
                            </td>
                            <td
                              className="py-2 px-2.5 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined }, `${displayStatus} All Deals`)}
                            >
                              {formatNumber(st.total.count)}
                            </td>
                            <td
                              className="py-2 px-2.5 text-right cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined }, `${displayStatus} All Deals`)}
                            >
                              {formatCurrency(st.total.acv)}
                            </td>
                            <td className="py-2 px-2.5 text-right text-[var(--text-muted)] font-sans">
                              {totalAcvPct}%
                            </td>
                          </tr>
                        )
                      }

                      if (metricMode === 'Amount') {
                        return (
                          <tr
                            key={st.status}
                            className={`hover:bg-[var(--bg-secondary)]/70 transition-colors ${isTotal ? 'font-black bg-[var(--bg-secondary)]/30' : ''}`}
                          >
                            <td className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)]">
                              {displayStatus}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] font-bold text-emerald-600 dark:text-emerald-400 transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, min_acv: deal_size_split.threshold }, `${displayStatus} Large Deals (≥ ${deal_size_split.threshold_label})`)}
                            >
                              {formatCurrency(st.large.acv)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                              {st.large.pct_acv}%
                            </td>
                            <td
                              className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined, max_acv: deal_size_split.threshold }, `${displayStatus} Small Deals (< ${deal_size_split.threshold_label})`)}
                            >
                              {formatCurrency(st.small.acv)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                              {st.small.pct_acv}%
                            </td>
                            <td
                              className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                              onClick={() => handleCellClick({ approval_status: st.status_key || undefined }, `${displayStatus} All Deals`)}
                            >
                              {formatCurrency(st.total.acv)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                              {totalAcvPct}%
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <tr
                          key={st.status}
                          className={`hover:bg-[var(--bg-secondary)]/70 transition-colors ${isTotal ? 'font-black bg-[var(--bg-secondary)]/30' : ''}`}
                        >
                          <td className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)]">
                            {displayStatus}
                          </td>
                          <td
                            className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                            onClick={() => handleCellClick({ approval_status: st.status_key || undefined, min_acv: deal_size_split.threshold }, `${displayStatus} Large Deals (≥ ${deal_size_split.threshold_label})`)}
                          >
                            {formatNumber(st.large.count)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                            {largeCountPct}%
                          </td>
                          <td
                            className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                            onClick={() => handleCellClick({ approval_status: st.status_key || undefined, max_acv: deal_size_split.threshold }, `${displayStatus} Small Deals (< ${deal_size_split.threshold_label})`)}
                          >
                            {formatNumber(st.small.count)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                            {smallCountPct}%
                          </td>
                          <td
                            className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] font-bold text-[var(--text-primary)] transition-colors"
                            onClick={() => handleCellClick({ approval_status: st.status_key || undefined }, `${displayStatus} All Deals`)}
                          >
                            {formatNumber(st.total.count)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans">
                            {totalCountPct}%
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <ChartCard
            title="Deal-Size Distribution"
            subtitle={`Large (≥ ${deal_size_split.threshold_label}) vs Small (< ${deal_size_split.threshold_label})`}
            type="horizontal-bars"
            data={deal_size_split.statuses
              .filter((s: any) => s.status !== 'Total')
              .flatMap((st: any) => {
                const isApproved = st.status === 'Approved'
                const isPending = st.status === 'Pending Approval'
                const colorLarge = isApproved ? '#10B981' : isPending ? '#F59E0B' : '#64748B'
                const colorSmall = isApproved ? '#34D399' : isPending ? '#FBBF24' : '#94A3B8'
                return [
                  {
                    label: `${getApprovalStatusLabel(st.status)} Large`,
                    value: st.large?.acv || 0,
                    formattedValue: `${formatCurrency(st.large?.acv || 0)} (${st.large?.count || 0})`,
                    color: colorLarge,
                  },
                  {
                    label: `${getApprovalStatusLabel(st.status)} Small`,
                    value: st.small?.acv || 0,
                    formattedValue: `${formatCurrency(st.small?.acv || 0)} (${st.small?.count || 0})`,
                    color: colorSmall,
                  },
                ]
              })}
            footer={
              <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
                <span>Threshold: ≥ {deal_size_split.threshold_label}</span>
                <span>Click cells to inspect deals</span>
              </div>
            }
          />
        </CardRow>
      )}

      {/* 3. Approval Coverage per FC, Region, BU Card & Benchmark Chart */}
      <CardRow template="max-content minmax(320px, 1fr)" id="approvals-coverage">
        <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors h-full flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <h2 className="text-base font-bold text-[var(--text-primary)]">
                    Approval Coverage
                  </h2>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {metricMode === 'Both' ? (
                    <>
                      Portfolio Average:{' '}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {approval_coverage.portfolio_average_pct}% by ACV
                      </span>{' '}
                      ({formatCurrency(approval_coverage.portfolio_approved_acv)} of {formatCurrency(approval_coverage.portfolio_total_acv)}) ·{' '}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {approval_coverage.portfolio_average_count_pct}% by Deals
                      </span>{' '}
                      ({formatNumber(getStatus('Approved').count)} of {formatNumber(total.count)} deals)
                    </>
                  ) : metricMode === 'Amount' ? (
                    <>
                      Portfolio Average:{' '}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {approval_coverage.portfolio_average_pct}% approved
                      </span>{' '}
                      ({formatCurrency(approval_coverage.portfolio_approved_acv)} of {formatCurrency(approval_coverage.portfolio_total_acv)})
                    </>
                  ) : (
                    <>
                      Portfolio Average:{' '}
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {approval_coverage.portfolio_average_count_pct}% approved
                      </span>{' '}
                      ({formatNumber(getStatus('Approved').count)} of {formatNumber(total.count)} deals)
                    </>
                  )}
                </p>
              </div>

              <div className="flex bg-[var(--bg-secondary)] rounded-lg p-0.5 border border-[var(--border)] text-xs font-semibold">
                <button
                  className={`px-3 py-1 rounded-md transition-colors ${coverageTab === 'category' ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  onClick={() => setCoverageTab('category')}
                >
                  Forecast Category
                </button>
                <button
                  className={`px-3 py-1 rounded-md transition-colors ${coverageTab === 'region' ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  onClick={() => setCoverageTab('region')}
                >
                  Region
                </button>
                <button
                  className={`px-3 py-1 rounded-md transition-colors ${coverageTab === 'bu' ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-xs' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                  onClick={() => setCoverageTab('bu')}
                >
                  Business Unit
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="data-table text-xs text-left" style={{ width: 'max-content', maxWidth: '100%' }}>
                <thead>
                  {metricMode === 'Both' ? (
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="py-2.5 px-3">{coverageTab === 'category' ? 'Forecast Category' : coverageTab === 'region' ? 'Region' : 'Business Unit'}</th>
                      <th className="py-2.5 px-3 text-right">Approved Deals</th>
                      <th className="py-2.5 px-3 text-right">Approved ACV</th>
                      <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Total Deals</th>
                      <th className="py-2.5 px-3 text-right">Total ACV</th>
                      <th className="py-2.5 px-3 text-center border-l border-[var(--border)]">Approval %</th>
                      <th className="py-2.5 px-3 text-right">Gap to Benchmark</th>
                    </tr>
                  ) : metricMode === 'Amount' ? (
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="py-2.5 px-3">{coverageTab === 'category' ? 'Forecast Category' : coverageTab === 'region' ? 'Region' : 'Business Unit'}</th>
                      <th className="py-2.5 px-3 text-right">Approved ACV</th>
                      <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Total ACV</th>
                      <th className="py-2.5 px-3 text-center border-l border-[var(--border)]">Approval %</th>
                      <th className="py-2.5 px-3 text-right">Gap to Benchmark</th>
                    </tr>
                  ) : (
                    <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <th className="py-2.5 px-3">{coverageTab === 'category' ? 'Forecast Category' : coverageTab === 'region' ? 'Region' : 'Business Unit'}</th>
                      <th className="py-2.5 px-3 text-right">Approved Deals</th>
                      <th className="py-2.5 px-3 text-right border-l border-[var(--border)]">Total Deals</th>
                      <th className="py-2.5 px-3 text-center border-l border-[var(--border)]">Approval %</th>
                      <th className="py-2.5 px-3 text-right">Gap to Benchmark</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-[var(--border)] font-mono">
                  {(() => {
                    const list =
                      coverageTab === 'category'
                        ? approval_coverage.by_category
                        : coverageTab === 'region'
                        ? approval_coverage.by_region
                        : approval_coverage.by_bu

                    if (!list || list.length === 0) {
                      const colCount = metricMode === 'Both' ? 7 : 5
                      return (
                        <tr>
                          <td colSpan={colCount} className="py-6 text-center text-[var(--text-muted)] italic">
                            No coverage data available
                          </td>
                        </tr>
                      )
                    }

                    return list.map((item: any) => {
                      const displayName = coverageTab === 'category' ? getForecastCategoryLabel(item.name) : item.name
                      const isPositive = item.gap >= 0
                      const gapBadge = isPositive
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'

                      const dealApprovalPct = item.total_count > 0 ? Number(((item.approved_count / item.total_count) * 100).toFixed(1)) : 0
                      const countGap = Number((dealApprovalPct - (approval_coverage.portfolio_average_count_pct || 0)).toFixed(1))
                      const isCountPositive = countGap >= 0
                      const countGapBadge = isCountPositive
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'

                      const filterParam =
                        coverageTab === 'category'
                          ? { forecast_category: item.name }
                          : coverageTab === 'region'
                          ? { sub_region: item.name }
                          : { business_unit_primary: item.name }

                      if (metricMode === 'Both') {
                        return (
                          <tr
                            key={item.name}
                            className="hover:bg-[var(--bg-secondary)]/70 transition-colors"
                          >
                            <td
                              className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--primary)]"
                              onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                            >
                              {displayName}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right font-bold cursor-pointer hover:text-[var(--primary)] text-emerald-600 dark:text-emerald-400 transition-colors"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              {formatNumber(item.approved_count)}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right font-bold cursor-pointer hover:text-[var(--primary)] text-emerald-600 dark:text-emerald-400 transition-colors"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              {formatCurrency(item.approved_acv)}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] text-[var(--text-secondary)] transition-colors"
                              onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                            >
                              {formatNumber(item.total_count)}
                            </td>
                            <td
                              className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] text-[var(--text-secondary)] transition-colors"
                              onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                            >
                              {formatCurrency(item.total_acv)}
                            </td>
                            <td
                              className="py-2 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              <span className="font-bold text-[var(--text-primary)] tabular-nums">{item.coverage_pct}%</span>
                            </td>
                            <td
                              className="py-2 px-3 text-right cursor-pointer hover:text-[var(--primary)] transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${gapBadge}`}>
                                {item.gap > 0 ? `+${item.gap}%` : `${item.gap}%`}
                              </span>
                            </td>
                          </tr>
                        )
                      }

                      if (metricMode === 'Amount') {
                        return (
                          <tr
                            key={item.name}
                            className="hover:bg-[var(--bg-secondary)]/70 transition-colors"
                          >
                            <td
                              className="py-2 px-3 font-sans font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--primary)] col-label"
                              onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                            >
                              {displayName}
                            </td>
                            <td
                              className="py-2 px-3 text-right font-bold cursor-pointer hover:text-[var(--primary)] text-emerald-600 dark:text-emerald-400 transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              {formatCurrency(item.approved_acv)}
                            </td>
                            <td
                              className="py-2 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] text-[var(--text-secondary)] transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                            >
                              {formatCurrency(item.total_acv)}
                            </td>
                            <td
                              className="py-2 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              <span className="font-bold text-[var(--text-primary)] tabular-nums">{item.coverage_pct}%</span>
                            </td>
                            <td
                              className="py-2 px-3 text-right cursor-pointer hover:text-[var(--primary)] transition-colors col-num"
                              onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                            >
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${gapBadge}`}>
                                {item.gap > 0 ? `+${item.gap}%` : `${item.gap}%`}
                              </span>
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <tr
                          key={item.name}
                          className="hover:bg-[var(--bg-secondary)]/70 transition-colors"
                        >
                          <td
                            className="py-2 px-3 font-sans font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--primary)] col-label"
                            onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                          >
                            {displayName}
                          </td>
                          <td
                            className="py-2 px-3 text-right font-bold cursor-pointer hover:text-[var(--primary)] text-emerald-600 dark:text-emerald-400 transition-colors col-num"
                            onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                          >
                            {formatNumber(item.approved_count)}
                          </td>
                          <td
                            className="py-2 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] text-[var(--text-secondary)] transition-colors col-num"
                            onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                          >
                            {formatNumber(item.total_count)}
                          </td>
                          <td
                            className="py-2 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors col-num"
                            onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                          >
                            <span className="font-bold text-[var(--text-primary)] tabular-nums">{dealApprovalPct}%</span>
                          </td>
                          <td
                            className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] transition-colors"
                            onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                          >
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${countGapBadge}`}>
                              {countGap > 0 ? `+${countGap}%` : `${countGap}%`}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <ChartCard
          title="Coverage Benchmark Gap"
          subtitle={`Variance vs ${metricMode === 'Count' ? approval_coverage.portfolio_average_count_pct : approval_coverage.portfolio_average_pct}% portfolio benchmark`}
          type="horizontal-bars"
          data={(() => {
            const list =
              coverageTab === 'category'
                ? approval_coverage.by_category
                : coverageTab === 'region'
                ? approval_coverage.by_region
                : approval_coverage.by_bu

            return (list || []).map((item: any) => {
              const displayName = coverageTab === 'category' ? getForecastCategoryLabel(item.name) : item.name
              const dealApprovalPct = item.total_count > 0 ? Number(((item.approved_count / item.total_count) * 100).toFixed(1)) : 0
              const countGap = Number((dealApprovalPct - (approval_coverage.portfolio_average_count_pct || 0)).toFixed(1))
              const gapVal = metricMode === 'Count' ? countGap : (item.gap || 0)
              const isPositive = gapVal >= 0
              return {
                label: displayName,
                value: Math.abs(gapVal),
                formattedValue: `${isPositive ? '+' : ''}${gapVal}%`,
                color: isPositive ? '#10B981' : '#F43F5E',
              }
            })
          })()}
          footer={
            <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
              <span>Green: Above portfolio average</span>
              <span>Rose: Below portfolio average</span>
            </div>
          }
        />
      </CardRow>

      {/* Row: Commit Not Approved & Pending Ageing */}
      {(() => {
        const commitDeals = commit_not_approved.deals || []
        const commitNotSubmitted = commitDeals.filter((d: any) => d.approval_status_key === 'Blank' || d.approval_status === 'Not submitted' || !d.approval_status || d.approval_status === 'Blank')
        const commitWaiting = commitDeals.filter((d: any) => d.approval_status_key === 'Pending Approval' || d.approval_status === 'Pending Approval')
        const commitNotSubmittedAcv = commitNotSubmitted.reduce((s: number, d: any) => s + (d.forecast_acv_amount || 0), 0)
        const commitWaitingAcv = commitWaiting.reduce((s: number, d: any) => s + (d.forecast_acv_amount || 0), 0)

        const filteredCommitDeals = commitDeals.filter((d: any) => {
          if (commitFilter === 'Not submitted') {
            return d.approval_status_key === 'Blank' || d.approval_status === 'Not submitted' || !d.approval_status || d.approval_status === 'Blank'
          }
          if (commitFilter === 'Waiting for approval') {
            return d.approval_status_key === 'Pending Approval' || d.approval_status === 'Pending Approval'
          }
          return true
        })

        return (
          <CardRow template="minmax(420px, 1.3fr) minmax(320px, 1fr)" id="approvals-commit-risk">
            {/* 4. Commit But Not Approved Table */}
            <Card className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors h-full">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-2 text-[var(--text-primary)]">
                    <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-bold text-base">Commit deals still to be approved</h3>
                      <p className="text-xs text-[var(--text-muted)]">
                        Deals we expect to close (Commit) whose approval is not done yet: either not sent for approval or waiting for approval.
                      </p>
                      <div className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-1">
                        = {commitNotSubmitted.length} not submitted ({formatCurrency(commitNotSubmittedAcv)}) + {commitWaiting.length} waiting for approval ({formatCurrency(commitWaitingAcv)})
                      </div>
                    </div>
                  </div>
                  <button
                    className="text-xs font-bold px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors self-start sm:self-auto font-mono flex-shrink-0"
                    onClick={() => handleCellClick({ forecast_category: 'Commit', approval_status: 'not_approved' }, 'All Commit Deals Still To Be Approved')}
                  >
                    {commit_not_approved.count} Deals · {formatCurrency(commit_not_approved.acv)}
                  </button>
                </div>

                {/* Sub-filter tabs */}
                <div className="flex items-center gap-1.5 mb-2.5">
                  {(['All', 'Not submitted', 'Waiting for approval'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setCommitFilter(f)}
                      className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${
                        commitFilter === f
                          ? 'bg-[#12284C] text-white shadow-sm'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] border border-[var(--border)]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>

                <ScrollList maxHeight="320px">
                  <table className="data-table w-full text-xs text-left">
                    <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2 px-2.5">Opportunity</th>
                        <th className="py-2 px-2.5">Account</th>
                        <th className="py-2 px-2.5 text-right">ACV</th>
                        <th className="py-2 px-2.5">Approval</th>
                        <th className="py-2 px-2.5">Owner</th>
                        <th className="py-2 px-2.5">Region</th>
                        <th className="py-2 px-2.5 text-right">Close Date</th>
                        <th className="py-2 px-2.5 text-right">Days to close</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] font-mono text-[11px]">
                      {filteredCommitDeals.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-[var(--text-muted)] italic font-sans">
                            No matching Commit deals.
                          </td>
                        </tr>
                      ) : (
                        filteredCommitDeals.map((d: any) => (
                          <tr
                            key={d.opportunity_id_18}
                            className="hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
                            onClick={() => setSelectedOppId(d.opportunity_id_18)}
                          >
                            <td className="py-2 px-2.5 font-sans font-semibold text-[var(--text-primary)] max-w-[160px] truncate" title={d.opportunity_name}>
                              {d.opportunity_name}
                            </td>
                            <td className="py-2 px-2.5 font-sans text-[var(--text-secondary)] max-w-[120px] truncate" title={d.account_name}>
                              {d.account_name}
                            </td>
                            <td className="py-2 px-2.5 text-right font-bold text-rose-600 dark:text-rose-400">
                              {formatCurrency(d.forecast_acv_amount)}
                            </td>
                            <td className="py-2 px-2.5 font-sans">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                d.approval_status_key === 'Pending Approval' || d.approval_status === 'Pending Approval' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-600'
                              }`}>
                                {getApprovalStatusLabel(d.approval_status)}
                              </span>
                            </td>
                            <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                              {d.owner || d.opportunity_owner}
                            </td>
                            <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                              {d.region || d.sub_region}
                            </td>
                            <td className="py-2 px-2.5 text-right text-[var(--text-muted)]">
                              {d.close_date || '—'}
                            </td>
                            <td className="py-2 px-2.5 text-right">
                              {d.days_to_close != null ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  d.days_to_close < 0 ? 'bg-red-500/10 text-red-600' : d.days_to_close <= 14 ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-600'
                                }`}>
                                  {d.days_to_close < 0 ? 'Past due' : `${d.days_to_close}d`}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ScrollList>
              </div>
            </Card>

            {/* 5. Pending Ageing Card */}
            <Card className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors h-full">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-2 text-[var(--text-primary)]">
                    <Clock className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-bold text-base">How long approvals have been waiting</h3>
                      <p className="text-xs text-[var(--text-muted)]">
                        Deals sent for approval and still waiting, oldest first. 'Waiting since' is the first snapshot date we saw the deal waiting.
                      </p>
                    </div>
                  </div>
                  <button
                    className="text-xs font-bold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors self-start sm:self-auto font-mono flex-shrink-0"
                    onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'All Deals Waiting for Approval')}
                  >
                    {pending_ageing.count} Pending · {formatCurrency(pending_ageing.acv)}
                  </button>
                </div>

                <ScrollList maxHeight="320px">
                  <table className="data-table w-full text-xs text-left">
                    <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2 px-2.5">Deal</th>
                        <th className="py-2 px-2.5 text-right">ACV</th>
                        <th className="py-2 px-2.5 text-right">Ageing</th>
                        <th className="py-2 px-2.5">Waiting Since</th>
                        <th className="py-2 px-2.5">Owner</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] font-mono text-[11px]">
                      {pending_ageing.deals?.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-[var(--text-muted)] italic font-sans">
                            No pending approvals recorded.
                          </td>
                        </tr>
                      ) : (
                        pending_ageing.deals.map((d: any) => (
                          <tr
                            key={d.opportunity_id_18}
                            className="hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
                            onClick={() => setSelectedOppId(d.opportunity_id_18)}
                          >
                            <td className="py-2 px-2.5 font-sans font-semibold text-[var(--text-primary)] max-w-[150px] truncate" title={d.opportunity_name}>
                              <div>{d.opportunity_name}</div>
                              <div className="text-[10px] text-[var(--text-muted)] truncate">{d.account_name}</div>
                            </td>
                            <td className="py-2 px-2.5 text-right font-bold text-amber-600 dark:text-amber-400">
                              {formatCurrency(d.forecast_acv_amount)}
                            </td>
                            <td className="py-2 px-2.5 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                d.days_pending >= 14 ? 'bg-rose-500/10 text-rose-600' : 'bg-amber-500/10 text-amber-600'
                              }`}>
                                {d.days_pending}d pending
                              </span>
                            </td>
                            <td className="py-2 px-2.5 text-[var(--text-muted)]">
                              {d.pending_since ? formatDate(d.pending_since) : '—'}
                            </td>
                            <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                              {d.owner || d.opportunity_owner}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ScrollList>
              </div>
            </Card>
          </CardRow>
        )
      })()}

      {/* 6. Trend of Approved % over recent snapshots Card */}
      {approved_trend.length > 0 && (
        <Card id="approvals-trend" className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors scroll-mt-24">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <span>Approved share over time</span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Trajectory of Approved % over time (labeled in <strong className="font-semibold text-[var(--text-primary)]">% of ACV</strong> and <strong className="font-semibold text-[var(--text-primary)]">% of Deals</strong>)
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {approved_trend.map((ts: any) => (
              <div
                key={ts.snapshot_date}
                className="bg-[var(--bg-secondary)]/60 p-3 rounded-lg border border-[var(--border)] flex flex-col justify-between"
              >
                <div className="text-[11px] font-semibold text-[var(--text-muted)]">
                  {ts.snapshot_date}
                </div>
                <div className="my-2">
                  <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                    {ts.approved_pct_acv}%
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wider">
                    {ts.unit_acv}
                  </div>
                </div>
                <div className="pt-2 border-t border-[var(--border)] flex justify-between items-center text-[10px] font-mono">
                  <span className="text-[var(--text-muted)]">{ts.approved_pct_count}% ({ts.unit_count})</span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1 truncate">
                  {formatCurrency(ts.approved_acv)} / {formatCurrency(ts.total_acv)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Row: Status movements table and Net Movement Summary */}
      <CardRow template="minmax(420px, 1.2fr) minmax(320px, 1fr)" id="approvals-movements">
        {/* Approval status changes table */}
        <Card className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors h-full">
          {(() => {
            const rawMoves = compareSnapshotId ? movements_custom : (movementsMode === 'yesterday' ? movements_yesterday : movements_lastweek);
            const moves = (rawMoves || []).map((m: any) => ({
              ...m,
              from_status: m.from_status === 'Pending-Approval' ? 'Pending Approval' : m.from_status,
              to_status: m.to_status === 'Pending-Approval' ? 'Pending Approval' : m.to_status,
            })).filter((m: any) => m.from_status !== m.to_status);

            const newlyAppr = moves.filter((m: any) => m.to_status === 'Approved');
            const newlyPend = moves.filter((m: any) => m.to_status === 'Pending Approval');
            const otherChanges = moves.filter((m: any) => m.to_status !== 'Approved' && m.to_status !== 'Pending Approval');

            const totalDeals = moves.reduce((sum: number, m: any) => sum + (m.count || 0), 0);
            const totalACV = moves.reduce((sum: number, m: any) => sum + (m.acv || 0), 0);

            const compareDateStr = compareSnapshot?.snapshot_date 
              ? formatDate(compareSnapshot.snapshot_date)
              : (movementsMode === 'yesterday' 
                  ? (yesterday_date ? formatDate(yesterday_date) : 'yesterday')
                  : (lastweek_date ? formatDate(lastweek_date) : 'last week'));

            const renderStatus = (st: string) => {
              const isNewly = st === 'Newly in this period' || st === 'New to slice'
              const isNotSubmitted = st === 'Not submitted' || st === 'Blank'
              const label = isNewly ? 'Newly in this period' : (isNotSubmitted ? 'Not submitted' : st)
              const tooltip = isNewly
                ? DEFINITIONS.newly_in_period
                : isNotSubmitted
                ? DEFINITIONS.not_submitted
                : undefined

              return (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[11px] text-[var(--text-primary)]" title={tooltip}>
                  <span className={isNewly ? 'text-teal-600 dark:text-teal-400 font-bold' : ''}>{label}</span>
                  {tooltip && (
                    <span
                      className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-slate-200 dark:bg-slate-700 text-[8px] font-bold text-slate-600 dark:text-slate-300 cursor-help"
                      title={tooltip}
                    >
                      i
                    </span>
                  )}
                </span>
              );
            };

            const renderGroup = (title: string, helper: string, items: any[], badgeColor: string) => {
              const grpCount = items.reduce((s: number, m: any) => s + (m.count || 0), 0);
              const grpACV = items.reduce((s: number, m: any) => s + (m.acv || 0), 0);

              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between pt-2 pb-1 border-b border-[var(--border)]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${badgeColor}`}>
                          {title}
                        </span>
                        <span className="text-[10px] font-bold text-[var(--text-muted)]">
                          ({grpCount} {grpCount === 1 ? 'deal' : 'deals'})
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{helper}</p>
                    </div>
                    {items.length > 0 && (
                      <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                        {formatCurrency(grpACV)}
                      </span>
                    )}
                  </div>

                  {items.length === 0 ? (
                    <div className="text-[11px] text-[var(--text-muted)] italic py-1.5 px-2">
                      No status movements in this group
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border)]">
                      {items.map((m: any, idx: number) => (
                        <div 
                          key={idx}
                          className="grid grid-cols-12 items-center py-1.5 px-2 rounded-md hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer text-xs"
                          onClick={() => {
                            if (m.deal_ids && m.deal_ids.length > 0) {
                              handleCellClick({ approval_status: m.to_status }, `${title}: From ${m.from_status} → ${m.to_status}`);
                            }
                          }}
                        >
                          <div className="col-span-4 flex items-center">
                            {renderStatus(m.from_status)}
                          </div>
                          <div className="col-span-1 flex items-center justify-center text-[var(--text-muted)] font-bold">
                            →
                          </div>
                          <div className="col-span-4 flex items-center">
                            {renderStatus(m.to_status)}
                          </div>
                          <div className="col-span-1 text-right font-bold font-mono text-[var(--text-primary)]">
                            {m.count}
                          </div>
                          <div className="col-span-2 text-right font-bold font-mono text-[var(--text-primary)]">
                            {formatCurrency(m.acv)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 text-[var(--text-primary)]">
                    <Activity className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <h3 className="font-bold text-base">Approval status changes since {compareDateStr}</h3>
                  </div>
                  {!compareSnapshotId && (
                    <div className="flex bg-[var(--bg-secondary)] rounded-lg p-0.5 border border-[var(--border)] self-start sm:self-auto">
                      <button 
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${movementsMode === 'yesterday' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`} 
                        onClick={() => setMovementsMode('yesterday')}
                      >
                        Yesterday
                      </button>
                      <button 
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${movementsMode === 'lastweek' ? 'bg-[var(--bg-primary)] shadow-sm text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`} 
                        onClick={() => setMovementsMode('lastweek')}
                      >
                        Last Week
                      </button>
                    </div>
                  )}
                </div>

                {/* Table Header */}
                <div className="grid grid-cols-12 py-2 px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 rounded-t-lg">
                  <div className="col-span-4">From status</div>
                  <div className="col-span-1 text-center"></div>
                  <div className="col-span-4">To status</div>
                  <div className="col-span-1 text-right">Deals</div>
                  <div className="col-span-2 text-right">ACV</div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 py-1">
                  {moves.length === 0 ? (
                    <div className="text-center py-8 text-[var(--text-muted)] text-xs italic">
                      No approval status changes recorded since {compareDateStr}.
                    </div>
                  ) : (
                    <>
                      {renderGroup(
                        'Newly approved',
                        'Deals that transitioned into Approved status',
                        newlyAppr,
                        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                      )}
                      {renderGroup(
                        'Newly pending',
                        'Deals submitted and awaiting management approval',
                        newlyPend,
                        'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      )}
                      {renderGroup(
                        'Other changes',
                        'Deals with other status movements or adjustments',
                        otherChanges,
                        'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
                      )}
                    </>
                  )}
                </div>

                {/* Totals Row */}
                <div className="mt-3 pt-2.5 border-t-2 border-[var(--border)] grid grid-cols-12 items-center px-2 text-xs font-black text-[var(--text-primary)] bg-[var(--bg-secondary)]/30 rounded-b-lg">
                  <div className="col-span-9">Total Changes</div>
                  <div className="col-span-1 text-right font-mono">{totalDeals}</div>
                  <div className="col-span-2 text-right font-mono">{formatCurrency(totalACV)}</div>
                </div>
              </>
            );
          })()}
        </Card>

        {/* Net Movement Summary Card (replaces duplicate Approved Deals card) */}
        <Card className="p-5 flex flex-col justify-between hover:border-[var(--primary)] transition-colors h-full">
          {(() => {
            const rawMoves = compareSnapshotId ? movements_custom : (movementsMode === 'yesterday' ? movements_yesterday : movements_lastweek);
            const moves = (rawMoves || []).map((m: any) => ({
              ...m,
              from_status: m.from_status === 'Pending-Approval' ? 'Pending Approval' : m.from_status,
              to_status: m.to_status === 'Pending-Approval' ? 'Pending Approval' : m.to_status,
            })).filter((m: any) => m.from_status !== m.to_status);

            const newlyAppr = moves.filter((m: any) => m.to_status === 'Approved');
            const newlyPend = moves.filter((m: any) => m.to_status === 'Pending Approval');
            const otherChanges = moves.filter((m: any) => m.to_status !== 'Approved' && m.to_status !== 'Pending Approval');

            const newlyApprCount = newlyAppr.reduce((s: number, m: any) => s + (m.count || 0), 0);
            const newlyApprAcv = newlyAppr.reduce((s: number, m: any) => s + (m.acv || 0), 0);
            const newlyPendCount = newlyPend.reduce((s: number, m: any) => s + (m.count || 0), 0);
            const newlyPendAcv = newlyPend.reduce((s: number, m: any) => s + (m.acv || 0), 0);
            const otherCount = otherChanges.reduce((s: number, m: any) => s + (m.count || 0), 0);
            const otherAcv = otherChanges.reduce((s: number, m: any) => s + (m.acv || 0), 0);

            const compareDateStr = compareSnapshot?.snapshot_date 
              ? formatDate(compareSnapshot.snapshot_date)
              : (movementsMode === 'yesterday' 
                  ? (yesterday_date ? formatDate(yesterday_date) : 'yesterday')
                  : (lastweek_date ? formatDate(lastweek_date) : 'last week'));

            return (
              <div className="space-y-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center gap-2 text-[var(--text-primary)] mb-1">
                    <TrendingUp className="w-5 h-5 text-emerald-500" />
                    <h3 className="font-bold text-base">Net Movement Summary</h3>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Approval pipeline status shifts recorded since {compareDateStr}.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Newly Approved */}
                  <div
                    onClick={() => handleCellClick({ approval_status: 'Approved' }, 'Newly Approved Deals')}
                    className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors cursor-pointer flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      <span>Newly Approved</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="my-2">
                      <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                        {formatCurrency(newlyApprAcv)}
                      </div>
                      <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 mt-0.5">
                        {newlyApprCount} {newlyApprCount === 1 ? 'deal' : 'deals'}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Finalized & ready to book
                    </div>
                  </div>

                  {/* Newly Pending */}
                  <div
                    onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'Newly Pending Deals')}
                    className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 transition-colors cursor-pointer flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      <span>Newly Pending</span>
                      <Clock className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="my-2">
                      <div className="text-xl font-black text-amber-600 dark:text-amber-400 font-mono tabular-nums">
                        {formatCurrency(newlyPendAcv)}
                      </div>
                      <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 mt-0.5">
                        {newlyPendCount} {newlyPendCount === 1 ? 'deal' : 'deals'}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Awaiting sign-off
                    </div>
                  </div>

                  {/* Other Changes */}
                  <div
                    className="p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/60 transition-colors flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      <span>Other Shifts</span>
                      <Activity className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="my-2">
                      <div className="text-xl font-black text-slate-800 dark:text-slate-200 font-mono tabular-nums">
                        {formatCurrency(otherAcv)}
                      </div>
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mt-0.5">
                        {otherCount} {otherCount === 1 ? 'deal' : 'deals'}
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">
                      Category or status shifts
                    </div>
                  </div>
                </div>

                {/* Insight line */}
                <div className="p-3 rounded-xl bg-[var(--bg-secondary)]/70 border border-[var(--border)] text-xs text-[var(--text-secondary)] leading-relaxed">
                  <span className="font-semibold text-[var(--text-primary)]">Movement Insight: </span>
                  {newlyApprCount > 0 ? (
                    <span>
                      <strong>{newlyApprCount} deals ({formatCurrency(newlyApprAcv)})</strong> progressed into Approved status.
                    </span>
                  ) : (
                    <span>No contracts achieved approval in this interval.</span>
                  )}
                  {newlyPendCount > 0 && (
                    <span>
                      {' '}Additionally, <strong>{newlyPendCount} contracts ({formatCurrency(newlyPendAcv)})</strong> entered the approval pipeline.
                    </span>
                  )}
                </div>
              </div>
            );
          })()}
        </Card>
      </CardRow>

      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={(dealsData?.deals || []).map((d: any) => ({ ...d, owner: d.opportunity_owner || d.owner }))}
          initialFilters={modalFilters}
          onSelectOpp={setSelectedOppId}
          onClose={() => setModalOpen(false)}
        />
      )}
      <OpportunityDrawer oppId={selectedOppId} onClose={() => setSelectedOppId(null)} />
    </motion.div>
  )
}
