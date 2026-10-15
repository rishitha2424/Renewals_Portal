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
import EmptyState from '@/components/ui/EmptyState'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import { PageErrorState } from '@/components/ui/PageErrorState'
import MetricToggle from '@/components/common/MetricToggle'
import CompactGrid from '@/components/common/CompactGrid'
import DealListModal from '@/components/common/DealListModal'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import Card from '@/components/ui/Card'

function formatDelta(val: number, isCount: boolean) {
  if (val == null) return null
  const sign = val > 0 ? '+' : ''
  const color = val > 0 ? 'text-emerald-600 dark:text-emerald-400' : val < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-muted)]'
  const text = isCount ? `${sign}${val}` : `${sign}${acvM(val)}`
  return <span className={color}>{text}</span>
}

function StatChip({ label, data, icon: Icon, metricMode, compareDate }: any) {
  const isCount = metricMode === 'Count'
  const isBoth = metricMode === 'Both'
  const isAmount = metricMode === 'Amount'

  const dYes = data.delta_yesterday
  const dLast = data.delta_lastweek
  const dCust = data.delta_custom

  const renderDeltas = () => {
    if (dCust && (dCust.count || dCust.acv)) {
      const cmpStr = compareDate ? compareDate.substring(5,10) : 'vs'
      const deltaPart = isCount
        ? formatDelta(dCust.count, true)
        : isAmount
        ? formatDelta(dCust.acv, false)
        : <>{formatDelta(dCust.count, true)} · {formatDelta(dCust.acv, false)}</>
      return <span>{cmpStr} {deltaPart}</span>
    }
    return (
      <span className="flex flex-col gap-0.5 mt-1 text-[10px] text-[var(--text-muted)] font-medium">
        <span>
          vs {data.yesterday_date ? data.yesterday_date.substring(5,10) : 'Yesterday'}{' '}
          {isCount ? formatDelta(dYes?.count, true) : isAmount ? formatDelta(dYes?.acv, false) : <>{formatDelta(dYes?.count, true)} · {formatDelta(dYes?.acv, false)}</>}
        </span>
        <span>
          vs {data.lastweek_date ? data.lastweek_date.substring(5,10) : 'Last Week'}{' '}
          {isCount ? formatDelta(dLast?.count, true) : isAmount ? formatDelta(dLast?.acv, false) : <>{formatDelta(dLast?.count, true)} · {formatDelta(dLast?.acv, false)}</>}
        </span>
      </span>
    )
  }

  return (
    <div className="card px-4 py-3 flex items-center justify-between border border-[var(--border)] transition-transform hover:scale-[1.02]">
      <div className="flex items-center gap-3 w-full">
        <div className={`p-2 rounded-xl flex-shrink-0 ${
          label === 'Approved'
            ? 'bg-emerald-500/10 text-emerald-500'
            : label === 'Pending' || label === 'Pending Approval'
            ? 'bg-amber-500/10 text-amber-500'
            : label === 'Blank' || label === 'Not submitted'
            ? 'bg-slate-500/10 text-slate-500'
            : 'bg-[var(--primary)]/10 text-[var(--primary)]'
        }`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">{label}</div>
          {isBoth ? (
            <div className="flex flex-col mt-0.5">
              <span className="text-lg font-black text-[var(--text-primary)] leading-tight font-mono tabular-nums" title={formatCurrency(data.acv)}>
                {acvM(data.acv)}
              </span>
              <span className="text-lg font-black text-[var(--text-primary)] leading-tight font-mono tabular-nums">
                {formatNumber(data.count)} deals
              </span>
            </div>
          ) : isAmount ? (
            <div className="text-xl font-black text-[var(--text-primary)] leading-tight font-mono tabular-nums" title={formatCurrency(data.acv)}>
              {acvM(data.acv)}
            </div>
          ) : (
            <div className="text-xl font-black text-[var(--text-primary)] leading-tight font-mono tabular-nums">
              {formatNumber(data.count)} deals
            </div>
          )}
          <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-0.5 font-medium">{renderDeltas()}</div>
        </div>
      </div>
    </div>
  )
}

export default function Approvals() {
  const { activeSnapshotId, compareSnapshotId, includeDeletedLost, snapshots, metricMode, selectedOppId, setSelectedOppId } = useAppStore()
  
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<any>({})
  const [coverageTab, setCoverageTab] = useState<'category' | 'region' | 'bu'>('category')
  const [movementsMode, setMovementsMode] = useState<'yesterday' | 'lastweek'>('yesterday')

  const activeSnapshot = snapshots.find(s => s.id === activeSnapshotId)
  const compareSnapshot = snapshots.find(s => s.id === compareSnapshotId)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals_v2', activeSnapshotId, compareSnapshotId, includeDeletedLost],
    queryFn: async () => {
      if (!activeSnapshotId) return null
      return getApprovalsDistribution(activeSnapshot?.snapshot_date || '', compareSnapshot?.snapshot_date, includeDeletedLost)
    },
    enabled: !!activeSnapshotId,
  })

  const { data: dealsData } = useQuery({
    queryKey: ['approvals_deals_v2', activeSnapshotId, modalFilters, includeDeletedLost],
    queryFn: () => getApprovalsDeals(
      activeSnapshot?.snapshot_date || '', 
      modalFilters.approval_status || undefined, 
      modalFilters.forecast_category || undefined, 
      includeDeletedLost,
      modalFilters.sub_region || undefined,
      modalFilters.business_unit_primary || undefined,
      undefined,
      modalFilters.min_acv,
      modalFilters.max_acv,
      modalFilters.deal_ids
    ),
    enabled: modalOpen && !!activeSnapshotId,
  })

  if (!activeSnapshotId || snapshots.length === 0) return <PageNoSnapshotState />
  if (isLoading) return <div className="p-8 text-center text-slate-500 animate-pulse">Loading approval data...</div>
  if (error || data?.error) return <PageErrorState message={(error as any)?.message || data?.error || "Couldn’t load this page. Try again"} onRetry={() => refetch()} />
  if (!data || !data.total || data.total?.count === 0) return <PageNoSnapshotState />

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

      {/* Slim Stat Chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Approved' }, 'Approved Deals')}><StatChip label="Approved" data={attachDates(getStatus('Approved'))} icon={CheckCircle2} metricMode={metricMode} compareDate={compareSnapshot?.snapshot_date} /></div>
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'Pending Deals')}><StatChip label="Pending" data={attachDates(getStatus('Pending Approval'))} icon={Clock} metricMode={metricMode} compareDate={compareSnapshot?.snapshot_date} /></div>
        <div className="cursor-pointer" onClick={() => handleCellClick({ approval_status: 'Blank' }, 'Not Submitted Deals')}><StatChip label="Not submitted" data={attachDates(getStatus('Blank'))} icon={FileQuestion} metricMode={metricMode} compareDate={compareSnapshot?.snapshot_date} /></div>
        <div className="cursor-pointer" onClick={() => handleCellClick({}, 'All Deals')}><StatChip label="Total" data={attachDates(total)} icon={Sigma} metricMode={metricMode} compareDate={compareSnapshot?.snapshot_date} /></div>
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

      {/* 1. Approval Funnel Pipeline Card */}
      {funnel.length > 0 && (
        <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Layers className="w-5 h-5 text-[var(--primary)]" />
                <span>Approval Funnel Pipeline</span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Progression of deals from Not submitted → Pending Approval → Approved for {data_slice}
              </p>
            </div>
            <div className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
              {formatNumber(total.count)} deals · {formatCurrency(total.acv)} total
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 relative">
            {funnel.map((stage: any, idx: number) => {
              const badgeStyle =
                stage.status_key === 'Approved'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                  : stage.status_key === 'Pending Approval'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                  : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'

              return (
                <div
                  key={stage.stage}
                  className="group relative bg-[var(--bg-secondary)]/50 p-4 rounded-xl border border-[var(--border)] hover:border-[var(--primary)] transition-all cursor-pointer shadow-xs hover:shadow-md"
                  onClick={() => handleCellClick({ approval_status: stage.status_key }, `${stage.stage} Deals`)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badgeStyle}`}>
                      {getApprovalStatusLabel(stage.stage)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 group-hover:text-[var(--primary)] font-semibold">
                      <span>View deals</span>
                      <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>

                  {metricMode === 'Both' ? (
                    <div className="mt-3 space-y-1.5 pt-2 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">ACV</span>
                        <span className="text-xl font-black text-[var(--text-primary)] font-mono tabular-nums" title={formatCurrency(stage.acv)}>
                          {acvM(stage.acv)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Deals</span>
                        <span className="text-xl font-black text-[var(--text-primary)] font-mono tabular-nums">
                          {formatNumber(stage.count)} deals
                        </span>
                      </div>
                    </div>
                  ) : metricMode === 'Amount' ? (
                    <div className="mt-3">
                      <div className="text-2xl font-black text-[var(--text-primary)] font-mono tabular-nums" title={formatCurrency(stage.acv)}>
                        {acvM(stage.acv)}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <div className="text-2xl font-black text-[var(--text-primary)] font-mono tabular-nums">
                        {formatNumber(stage.count)} deals
                      </div>
                    </div>
                  )}

                  <div className="mt-3 space-y-1">
                    {metricMode !== 'Count' && (
                      <div className="flex justify-between text-[11px] text-[var(--text-muted)] font-medium">
                        <span>% of Period ACV</span>
                        <span className="font-bold text-[var(--text-primary)] font-mono tabular-nums">{stage.pct_acv}%</span>
                      </div>
                    )}
                    <div className="w-full bg-[var(--bg-primary)] h-1.5 rounded-full overflow-hidden border border-[var(--border)]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          stage.status_key === 'Approved' ? 'bg-emerald-500' : stage.status_key === 'Pending Approval' ? 'bg-amber-500' : 'bg-slate-400'
                        }`}
                        style={{ width: `${Math.min(100, metricMode === 'Count' ? stage.pct_count : stage.pct_acv)}%` }}
                      />
                    </div>
                    {metricMode !== 'Amount' && (
                      <div className="flex justify-between text-[10px] text-[var(--text-muted)] pt-0.5">
                        <span>% of Deals</span>
                        <span className="font-semibold">{stage.pct_count}%</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Grid: Donut Chart & Status vs FC Matrix */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left: Donut Chart */}
        <Card className="xl:col-span-5 p-5 flex flex-col hover:border-[var(--primary)] transition-colors">
          <h2 className="text-sm font-bold text-[var(--text-primary)] mb-4 cursor-pointer" onClick={() => handleCellClick({}, 'All Approvals')}>Status Share</h2>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-40 h-40 flex-shrink-0 flex items-center justify-center cursor-pointer" onClick={() => handleCellClick({}, 'All Approvals')}>
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
            <div className="flex-1 w-full space-y-2">
              {donutSegments.map((seg: any) => {
                const displayStatus = getApprovalStatusLabel(seg.status)
                const pctOfDeals = total.count > 0 ? ((seg.count / total.count) * 100).toFixed(0) : '0'
                const pctOfAcv = seg.pct.toFixed(0)

                return (
                  <div
                    key={seg.status}
                    className="flex flex-col bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors"
                    onClick={() => handleCellClick({ approval_status: seg.status }, `${displayStatus} Deals`)}
                  >
                    <div className="flex items-center justify-between font-bold text-[var(--text-primary)] text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }}></div>
                        <span>{displayStatus}</span>
                      </div>
                      {metricMode === 'Both' ? (
                        <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                          <span className="font-bold text-[var(--text-primary)]">{formatNumber(seg.count)} deals</span>
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
                          {formatNumber(seg.count)} deals ({pctOfDeals}%)
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-[9px] text-[var(--text-muted)] mt-1 font-medium pl-4">
                      <span>
                        vs {yesterday_date ? yesterday_date.substring(5,10) : '1d'}{' '}
                        {metricMode === 'Count'
                          ? formatDelta(seg.delta_yesterday?.count, true)
                          : metricMode === 'Amount'
                          ? formatDelta(seg.delta_yesterday?.acv, false)
                          : <>{formatDelta(seg.delta_yesterday?.count, true)} · {formatDelta(seg.delta_yesterday?.acv, false)}</>
                        }
                      </span>
                      <span>
                        vs {lastweek_date ? lastweek_date.substring(5,10) : '7d'}{' '}
                        {metricMode === 'Count'
                          ? formatDelta(seg.delta_lastweek?.count, true)
                          : metricMode === 'Amount'
                          ? formatDelta(seg.delta_lastweek?.acv, false)
                          : <>{formatDelta(seg.delta_lastweek?.count, true)} · {formatDelta(seg.delta_lastweek?.acv, false)}</>
                        }
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>

        {/* Right: Grid */}
        <div className="xl:col-span-7">
          {(() => {
            const displayCategories = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
            return (
              <CompactGrid
                title="Status vs. Forecast Category"
                columns={displayCategories}
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
      </div>

      {/* 2. Deal-Size Split Card */}
      {deal_size_split.statuses?.length > 0 && (
        <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors">
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
            <table className="w-full text-xs text-left">
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
        </Card>
      )}

      {/* 3. Approval Coverage per FC, Region, BU Card */}
      <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                Approval Coverage & Benchmark Gap
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
          <table className="w-full text-xs text-left">
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
                          className="py-2.5 px-3 text-center border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors"
                          onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-[var(--bg-primary)] h-1.5 rounded-full overflow-hidden border border-[var(--border)]">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, item.coverage_pct)}%` }}
                              />
                            </div>
                            <span className="font-bold text-[var(--text-primary)]">{item.coverage_pct}%</span>
                          </div>
                        </td>
                        <td
                          className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] transition-colors"
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
                          className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)] cursor-pointer hover:text-[var(--primary)]"
                          onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                        >
                          {displayName}
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
                          {formatCurrency(item.total_acv)}
                        </td>
                        <td
                          className="py-2.5 px-3 text-center border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors"
                          onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 bg-[var(--bg-primary)] h-1.5 rounded-full overflow-hidden border border-[var(--border)]">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, item.coverage_pct)}%` }}
                              />
                            </div>
                            <span className="font-bold text-[var(--text-primary)]">{item.coverage_pct}%</span>
                          </div>
                        </td>
                        <td
                          className="py-2.5 px-3 text-right cursor-pointer hover:text-[var(--primary)] transition-colors"
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
                        className="py-2.5 px-3 text-right border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] text-[var(--text-secondary)] transition-colors"
                        onClick={() => handleCellClick({ ...filterParam }, `${displayName} All Deals`)}
                      >
                        {formatNumber(item.total_count)}
                      </td>
                      <td
                        className="py-2.5 px-3 text-center border-l border-[var(--border)] cursor-pointer hover:text-[var(--primary)] transition-colors"
                        onClick={() => handleCellClick({ ...filterParam, approval_status: 'Approved' }, `${displayName} Approved Deals`)}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 bg-[var(--bg-primary)] h-1.5 rounded-full overflow-hidden border border-[var(--border)]">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, dealApprovalPct)}%` }}
                            />
                          </div>
                          <span className="font-bold text-[var(--text-primary)]">{dealApprovalPct}%</span>
                        </div>
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
      </Card>

      {/* Row: Commit Not Approved & Pending Ageing */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* 4. Commit But Not Approved Table */}
        <Card className="xl:col-span-7 p-5 flex flex-col hover:border-[var(--primary)] transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-base">Commit Deals Not Approved</h3>
                <p className="text-xs text-[var(--text-muted)]">High-conviction Commit renewals awaiting submission or approval</p>
              </div>
            </div>
            <button
              className="text-xs font-bold px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors self-start sm:self-auto font-mono"
              onClick={() => handleCellClick({ forecast_category: 'Commit', approval_status: 'not_approved' }, 'All Commit Not Approved Deals')}
            >
              {commit_not_approved.count} Deals · {formatCurrency(commit_not_approved.acv)}
            </button>
          </div>

          <div className="flex-1 overflow-x-auto max-h-[320px]">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="py-2 px-2.5">Opportunity</th>
                  <th className="py-2 px-2.5">Account</th>
                  <th className="py-2 px-2.5 text-right">ACV</th>
                  <th className="py-2 px-2.5">Status</th>
                  <th className="py-2 px-2.5">Owner</th>
                  <th className="py-2 px-2.5">Region</th>
                  <th className="py-2 px-2.5 text-right">Close Date</th>
                  <th className="py-2 px-2.5 text-right">Days Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] font-mono text-[11px]">
                {commit_not_approved.deals?.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--text-muted)] italic font-sans">
                      All Commit deals are approved!
                    </td>
                  </tr>
                ) : (
                  commit_not_approved.deals.map((d: any) => (
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
                          d.approval_status_key === 'Pending Approval' ? 'bg-amber-500/10 text-amber-600' : 'bg-slate-500/10 text-slate-600'
                        }`}>
                          {d.approval_status}
                        </span>
                      </td>
                      <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                        {d.owner}
                      </td>
                      <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                        {d.region}
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
          </div>
        </Card>

        {/* 5. Pending Ageing Card */}
        <Card className="xl:col-span-5 p-5 flex flex-col hover:border-[var(--primary)] transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <Clock className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-base">Pending Approvals Ageing</h3>
                <p className="text-xs text-[var(--text-muted)]">Ranked oldest first by continuous snapshot history</p>
              </div>
            </div>
            <button
              className="text-xs font-bold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors self-start sm:self-auto font-mono"
              onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'All Pending Deals')}
            >
              {pending_ageing.count} Pending · {formatCurrency(pending_ageing.acv)}
            </button>
          </div>

          <div className="flex-1 overflow-x-auto max-h-[320px]">
            <table className="w-full text-xs text-left">
              <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                <tr>
                  <th className="py-2 px-2.5">Deal</th>
                  <th className="py-2 px-2.5 text-right">ACV</th>
                  <th className="py-2 px-2.5 text-right">Ageing</th>
                  <th className="py-2 px-2.5">Pending Since</th>
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
                        {d.pending_since || '—'}
                      </td>
                      <td className="py-2 px-2.5 font-sans text-[var(--text-muted)] truncate max-w-[90px]">
                        {d.owner}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 6. Trend of Approved % over recent snapshots Card */}
      {approved_trend.length > 0 && (
        <Card className="p-5 border border-[var(--border)] hover:border-[var(--primary)] transition-colors">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                <span>Approval Rate Trend Across Recent Snapshots</span>
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

      {/* Insights Row: Status movements table and companion cards (kept intact) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Approval status changes table */}
        <Card className="xl:col-span-7 p-5 flex flex-col hover:border-[var(--primary)] transition-colors">
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
              const isOdd = st === 'New to slice';
              return (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[11px] text-[var(--text-primary)]">
                  <span>{st}</span>
                  {isOdd && (
                    <span 
                      className="group relative inline-flex items-center cursor-help text-sky-500 hover:text-sky-600"
                      title="New to slice: Deals that newly entered this renewals dataset or slice since the comparison date."
                    >
                      <Info className="w-3.5 h-3.5" />
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

        {/* Companion Cards */}
        <div className="xl:col-span-5 flex flex-col gap-6">
          <Card className="p-4 flex flex-col hover:border-[var(--primary)] transition-colors">
            <div className="flex items-center gap-2 mb-3 text-[var(--text-primary)]">
               <Clock className="w-5 h-5 text-amber-500" />
               <h3 className="font-bold">Submitted, waiting for approval</h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[220px] text-xs space-y-2">
               <p className="text-[var(--text-muted)] text-[11px] italic cursor-pointer hover:underline" onClick={() => handleCellClick({ approval_status: 'Pending Approval' }, 'Pending Deals')}>All {pending_deals?.length || 0} pending deals...</p>
               {(!pending_deals || pending_deals.length === 0) ? (
                  <div className="text-center py-6 text-[var(--text-muted)]">No pending deals.</div>
               ) : (
                  pending_deals.map((p: any, idx: number) => {
                    const daysToClose = p.close_date && activeSnapshot ? Math.floor((new Date(p.close_date).getTime() - new Date(activeSnapshot.snapshot_date).getTime()) / (1000 * 3600 * 24)) : 999;
                    return (
                    <div key={idx} className="bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors" onClick={() => { setSelectedOppId(p.opportunity_id_18); handleCellClick({ approval_status: 'Pending Approval' }, 'Pending Deals'); }}>
                      <div className="flex justify-between font-bold text-[var(--text-primary)]"><span className="truncate pr-2">{p.account_name || p.opportunity_name}</span> <span className="text-amber-600">{acvM(p.forecast_acv_amount)}</span></div>
                      <div className="flex justify-between items-center text-[10px] text-[var(--text-muted)] mt-1">
                        <span>{p.close_date ? p.close_date.substring(0,10) : 'No close date'}</span>
                        {daysToClose <= 30 && <span className="bg-red-500/10 text-red-600 px-1.5 py-0.5 rounded-sm font-bold border border-red-500/20">closes in {daysToClose}d</span>}
                      </div>
                    </div>
                  )})
               )}
            </div>
          </Card>

          <Card className="p-4 flex flex-col hover:border-[var(--primary)] transition-colors">
            <div className="flex items-center gap-2 mb-3 text-[var(--text-primary)]">
               <AlertOctagon className="w-5 h-5 text-rose-500" />
               <h3 className="font-bold">Not Submitted</h3>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[160px] text-xs space-y-2">
               <p className="text-[var(--text-muted)] text-[11px] italic">Commit deals with Not submitted status...</p>
               <div className="bg-[var(--bg-secondary)] p-2 rounded-lg border border-[var(--border)] cursor-pointer hover:border-[var(--primary)] transition-colors" onClick={() => handleCellClick({ approval_status: 'Blank', forecast_category: 'Commit' }, 'Not Submitted · Commit Deals')}>
                 <div className="flex justify-between font-bold text-[var(--text-primary)]"><span>Total Not Submitted Commits</span> <span className="text-rose-600">{acvM(matrix['Blank']?.['Commit']?.acv || 0)}</span></div>
                 <div className="text-[10px] text-[var(--text-muted)] mt-1">{matrix['Blank']?.['Commit']?.count || 0} deals at risk</div>
               </div>
            </div>
          </Card>
        </div>
      </div>

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
