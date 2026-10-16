import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, Upload, AlertTriangle, TrendingUp, TrendingDown,
  ChevronRight, X, CheckCircle2, ArrowRight, BarChart3, Users, Globe2,
  ShieldCheck,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import {
  getV2OverviewSummary,
  getV2OverviewMovements,
  getV2RegionalBreakdown,
  getV2OverviewDeals,
} from '@/api/client'
import { getForecastCategoryLabel, formatCurrency, formatNumber, getQuarterFromDate } from '@/utils/format'
import { formatDate } from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import EmptyState from '@/components/ui/EmptyState'
import { PageNoSnapshotState } from '@/components/ui/PageNoSnapshotState'
import { PageErrorState } from '@/components/ui/PageErrorState'
import DealListModal from '@/components/common/DealListModal'
import FilterBar from '@/components/common/FilterBar'
import { MovementsSummary } from '@/components/common/MovementsSummary'

// Region display order (Sections 6 & 7)
const REGION_ORDER = [
  'North America', 'LATAM', 'Middle East and North Africa', 'APAC', 'Europe', 'Africa',
]

function acvM(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return '$0'
  const abs = Math.abs(v)
  if (abs === 0) return '$0'
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function DeltaBadge({ val, label }: { val: number | null | undefined; label?: string }) {
  if (val == null) return null
  const up = val >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-sm ${
      up ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
         : 'bg-red-500/10 text-red-700 dark:text-red-400'
    }`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{val}{label ? ` ${label}` : ''}
    </span>
  )
}

function AcvDelta({ val }: { val: number | null | undefined }) {
  if (val == null) return null
  const up = val >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-sm ${
      up ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
         : 'bg-red-500/10 text-red-700 dark:text-red-400'
    }`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}{acvM(val)}
    </span>
  )
}

function Pill({ children, color = 'teal' }: { children: React.ReactNode; color?: string }) {
  const cls: Record<string, string> = {
    teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20',
    violet: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/20',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20',
    slate: 'bg-slate-200/70 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border border-slate-300/40 dark:border-slate-600/40',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-sm ${cls[color] ?? cls.teal}`}>
      {children}
    </span>
  )
}

function DealModal({ title, deals, onSelectOpp, onClose }: {
  title: string; deals: any[]; onSelectOpp: (id: string) => void; onClose: () => void
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
          className="card w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <h3 className="font-bold text-sm">{title}</h3>
            <button onClick={onClose}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
          </div>
          <div className="overflow-y-auto flex-1">
            {deals.length === 0
              ? <p className="text-center text-sm text-[var(--text-muted)] py-8">No deals.</p>
              : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--bg-secondary)]">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-muted)]">Opportunity</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-muted)]">Region</th>
                      <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-muted)]">ACV</th>
                      <th className="w-6" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {deals.map((d: any, i: number) => (
                      <tr
                        key={d.opportunity_id_18 || i}
                        className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                        onClick={() => d.opportunity_id_18 && onSelectOpp(d.opportunity_id_18)}
                      >
                        <td className="px-4 py-2.5 font-medium">{d.opportunity_name || d.opportunity_id_18}</td>
                        <td className="px-4 py-2.5 text-[var(--text-muted)]">{d.region || d.canonical_region || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold">{acvM(d.acv ?? d.forecast_acv_amount)}</td>
                        <td className="pr-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { snapshots = [], activeSnapshotId } = useAppStore()
  const activeSnapshot = snapshots.find((s: any) => s.id === activeSnapshotId)
  const navigate = useNavigate()

  const [movCompare, setMovCompare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [modal, setModal] = useState<{ title: string; deals: any[]; deltaGroups?: any } | null>(null)
  const [modalInitialFilters, setModalInitialFilters] = useState<any>(undefined)

  const openDealsQuery = async (
    title: string,
    params: { category?: string; region?: string; approval_status?: string; kind?: string; compare?: string; deal_ids?: string; as_of?: string },
    initialFilters?: any
  ) => {
    try {
      const res = await getV2OverviewDeals({
        ...params,
        as_of: activeSnapshotId || undefined,
      })
      setModalInitialFilters(initialFilters)
      setModal({
        title,
        deals: res.deals || [],
        deltaGroups: res.delta_groups,
      })
    } catch (err) {
      console.error('Failed to load deals', err)
    }
  }


  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  const { globalFilters } = useAppStore()

  const effectiveFilters = useMemo(() => ({
    ...globalFilters,
    as_of: activeSnapshotId || globalFilters?.as_of || undefined,
  }), [globalFilters, activeSnapshotId])

  const { data: summary, isLoading: sumLoading, isError: sumErr, refetch: refetchSum } = useQuery({
    queryKey: ['v2-summary', activeSnapshotId, effectiveFilters],
    queryFn: () => getV2OverviewSummary(effectiveFilters),
    enabled: !!activeSnapshotId,
  })

  const { data: movYesterday, isLoading: movYLoading, isError: movYErr, refetch: refetchMovY } = useQuery({
    queryKey: ['v2-movements-yesterday', activeSnapshotId, effectiveFilters],
    queryFn: () => getV2OverviewMovements('yesterday', effectiveFilters),
    enabled: !!activeSnapshotId,
  })

  const { data: movLastWeek, isLoading: movLWLoading, isError: movLWErr, refetch: refetchMovLW } = useQuery({
    queryKey: ['v2-movements-lastweek', activeSnapshotId, effectiveFilters],
    queryFn: () => getV2OverviewMovements('last_week', effectiveFilters),
    enabled: !!activeSnapshotId,
  })

  const movements = movCompare === 'yesterday' ? movYesterday : movLastWeek
  const movLoading = movCompare === 'yesterday' ? movYLoading : movLWLoading

  const { data: regional, isLoading: regLoading, isError: regErr, refetch: refetchReg } = useQuery({
    queryKey: ['v2-regional', activeSnapshotId, effectiveFilters],
    queryFn: () => getV2RegionalBreakdown(effectiveFilters),
    enabled: !!activeSnapshotId,
  })

  const isLoading = sumLoading || movYLoading || movLWLoading || regLoading
  const refetchAll = () => { refetchSum(); refetchMovY(); refetchMovLW(); refetchReg() }


  const isError = Boolean(sumErr || movYErr || movLWErr || regErr || summary?.error || movements?.error || regional?.error)
  const errorMessage = (summary?.error || movements?.error || regional?.error) || "Couldn’t load this page. Try again"

  if (snapshots.length === 0 && !isLoading) {
    return <PageNoSnapshotState />
  }

  if (isError) {
    return <PageErrorState message={errorMessage} onRetry={refetchAll} />
  }

  if (!isLoading && (!summary || !summary.total)) {
    return <PageNoSnapshotState />
  }

  const otherCount  = summary?.other_region_count ?? 0
  const cats        = summary?.categories ?? {}
  const standingSlip= summary?.slippage_to_2027 ?? { count: 0, acv: 0 }
  const total       = summary?.total ?? { count: 0, acv: 0 }

  const pos: any[]  = movements?.positive ?? []
  const neg: any[]  = movements?.negative ?? []
  const apv: any[]  = movements?.approval ?? []
  const movSlip     = movements?.slippage_to_2027 ?? { count: 0, acv: 0, deals: [] }
  const slipLater   = movements?.slipped_later_quarter ?? { count: 0, acv: 0, deals: [] }
  const slipEarlier = movements?.slipped_earlier ?? { count: 0, acv: 0, deals: [] }
  const compareDate = movements?.compare_date

  const posTotal = pos.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)
  const negTotal = neg.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)
  const apvTotal = apv.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)

  const propConf   = regional?.proposal_confirmation ?? []
  const propTotals = regional?.proposal_confirmation_totals ?? {}
  const regTrend   = regional?.regional_trend ?? []
  const regTotals  = regional?.regional_trend_totals ?? {}

  const orderRegions = (rows: any[]) => {
    if (!rows || rows.length === 0) return []
    const known = REGION_ORDER.map(r => rows.find((x: any) => x.region === r)).filter(Boolean)
    const knownNames = new Set(REGION_ORDER)
    const otherInRows = rows.filter((x: any) => !knownNames.has(x.region) && x.region !== 'Other / Unmapped' && x.region !== 'Other')
    const unmapped = rows.filter((x: any) => x.region === 'Other / Unmapped' || x.region === 'Other')
    return [...known, ...otherInRows, ...unmapped]
  }

  const propRows  = orderRegions(propConf)
  const trendRows = orderRegions(regTrend)

  const FC_COLS = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank'] as const

  return (
    <div className="space-y-6 pb-16 w-full">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-extrabold text-2xl md:text-3xl tracking-tight text-[var(--text-primary)]">
              Renewals Overview
            </h1>
            <Pill color="teal">{summary?.data_slice || 'Overview'}</Pill>
            {summary?.source_checks && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-sm border ${
                  summary.source_checks.badge === 'green'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : summary.source_checks.badge === 'red'
                    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
                }`}
                title={
                  summary.source_checks.failed > 0
                    ? `Mismatches: ${summary.source_checks.failed_items?.join(', ') || `${summary.source_checks.failed} failed`}`
                    : `${summary.source_checks.passed}/${summary.source_checks.total} control checks matched Excel summary sheets`
                }
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Source check:{' '}
                {summary.source_checks.badge === 'green'
                  ? `yes (${summary.source_checks.passed} checks)`
                  : `${summary.source_checks.failed} mismatches${summary.source_checks.failed_items?.length ? `: ${summary.source_checks.failed_items.slice(0, 2).join(', ')}` : ''}`}
              </span>
            )}
          </div>
          {summary?.snapshot_date && (
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Data as of: <strong>{formatDate(summary.snapshot_date)}</strong>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => navigate('/data-uploads')}
            className="h-9 px-3 rounded-md border border-[var(--border)] bg-teal-500/10 hover:bg-teal-500/20 text-xs font-semibold text-teal-600 dark:text-teal-400 transition-colors inline-flex items-center gap-1.5 focus:outline-none"
            id="overview-upload-data-btn"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Excel
          </button>
          <button
            type="button" onClick={refetchAll}
            className="h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1.5 focus:outline-none"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-teal-500' : ''}`} /> Refresh
          </button>
        </div>
      </div>


      {/* ── SECTION 0 – Regional notice banner ──────────────────────────────── */}
      {otherCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-400/40 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-xs font-medium"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>
            <strong>{otherCount} deal{otherCount !== 1 ? 's' : ''}</strong> cannot be assigned to a
            canonical region — check <em>revised_sub_region</em> values in source Excel.
          </span>
        </motion.div>
      )}

      {/* ── SECTION 1 – Total Renewal ACV Value ──────────────────────────── */}
      <div className="card p-6">
        <div>
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
            TOTAL {summary?.data_slice ? summary.data_slice.toUpperCase() : 'RENEWAL ACV'} ACV VALUE
          </p>
          <div className="flex flex-wrap items-baseline gap-3">
            {sumLoading ? (
              <div className="h-12 w-52 rounded-lg skeleton-shimmer" />
            ) : (
              <span
                className="font-extrabold text-4xl md:text-5xl text-[var(--text-primary)] tabular-nums cursor-pointer hover:underline"
                onClick={() => openDealsQuery(`Total Renewal ${summary?.data_slice || ''} Deals (${total.count ?? 0} Contracts · ${formatCurrency(total.acv ?? 0)})`, {})}
                title={`Click to view all ${summary?.data_slice || 'renewal'} deals`}
              >
                {acvM(total.acv ?? 0)}
              </span>
            )}
            <Pill color="teal">
              <Users className="w-3 h-3" />
              {total.count ?? 0} Contracts
            </Pill>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-2">
            Fiscal Period = {summary?.data_slice || 'Selected Period'} · Click to view all {total.count ?? 0} contracts
          </p>

          {/* Trend rows BELOW the total ACV and contract count */}
          <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row gap-4 sm:gap-8">
            {[
              { label: 'vs Yesterday', delta: total.delta_yesterday, kind: 'delta_yesterday', date: summary?.yesterday_date },
              { label: 'vs Last Week', delta: total.delta_lastweek, kind: 'delta_lastweek', date: summary?.lastweek_date },
            ].map(({ label, delta, kind, date }) => {
              const acvVal = delta?.acv ?? 0
              const countVal = delta?.count ?? 0
              const isAcvNeutral = acvVal === 0
              const isCountNeutral = countVal === 0

              const acvColor = isAcvNeutral
                ? 'text-[var(--text-muted)]'
                : acvVal > 0
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-red-600 dark:text-red-400 font-bold'

              const countColor = isCountNeutral
                ? 'text-[var(--text-muted)]'
                : countVal > 0
                ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                : 'text-red-600 dark:text-red-400 font-bold'

              const acvSign = acvVal > 0 ? '+' : ''
              const countSign = countVal > 0 ? '+' : ''

              return (
                <div
                  key={label}
                  className="flex items-center gap-2 text-xs cursor-pointer group hover:opacity-80 transition-opacity"
                  onClick={() => delta && openDealsQuery(`${label} Movement Deals (${delta.count ?? 0} deals · ${acvM(delta.acv ?? 0)})`, { kind })}
                  title={`Click to view deals with changes ${label}`}
                >
                  <span className="text-[var(--text-muted)] font-medium">
                    {label} {date ? `(${formatDate(date).split(',')[0]})` : ''}:
                  </span>
                  {delta ? (
                    <span className="font-mono text-xs flex items-center gap-1.5">
                      <span className={acvColor}>
                        {isAcvNeutral ? '$0' : `${acvSign}${acvM(acvVal)}`}
                      </span>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className={countColor}>
                        {isCountNeutral ? '0 deals' : `${countSign}${countVal} deals`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── B8 Coverage Line: Commit + Best Case % of Total ACV ── */}
        {summary?.coverage && (
          <div
            className="mt-5 pt-4 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3 cursor-pointer group hover:bg-[var(--bg-secondary)]/50 p-2.5 rounded-lg transition-colors"
            onClick={() => {
              const cov = summary.coverage
              openDealsQuery(
                `Coverage Deals (Commit + Best Case) · ${formatNumber(cov.count)} contracts · ${formatCurrency(cov.acv)}`,
                { kind: 'coverage' }
              )
            }}
            title="Click to view Commit + Best Case deals"
          >
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider group-hover:text-[var(--brand-teal)] transition-colors">
                  Coverage (Commit + Best Case):
                </span>
              </div>
              <span className="text-sm sm:text-base font-black font-mono text-[var(--text-primary)] tabular-nums group-hover:underline">
                {summary.coverage.pct != null ? `${summary.coverage.pct}%` : '—'}
              </span>
              <span className="text-xs text-[var(--text-muted)] font-mono">
                of total ACV ({formatCurrency(summary.coverage.acv)} · {formatNumber(summary.coverage.count)} contracts)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5" title="Percentage-point change vs yesterday">
                <span className="text-[11px] text-[var(--text-muted)]">vs Yesterday:</span>
                {summary.coverage.delta_yesterday_pp != null ? (
                  <span
                    className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                      summary.coverage.delta_yesterday_pp >= 0
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {summary.coverage.delta_yesterday_pp >= 0 ? '+' : ''}
                    {summary.coverage.delta_yesterday_pp.toFixed(2)} pp
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>

              <div className="flex items-center gap-1.5" title="Percentage-point change vs last week">
                <span className="text-[11px] text-[var(--text-muted)]">vs Last Week:</span>
                {summary.coverage.delta_lastweek_pp != null ? (
                  <span
                    className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                      summary.coverage.delta_lastweek_pp >= 0
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {summary.coverage.delta_lastweek_pp >= 0 ? '+' : ''}
                    {summary.coverage.delta_lastweek_pp.toFixed(2)} pp
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-0.5">
                View deals →
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 2 – Category cards in one row ──────────────────────── */}
      {(() => {
        const categoryCards = [
          { key: 'Closed', label: 'Closed', dataKey: 'Closed' },
          { key: 'Commit', label: 'Commit', dataKey: 'Commit' },
          { key: 'Best Case', label: 'Best Case', dataKey: 'Best Case' },
          { key: 'Pipeline', label: 'Pipeline', dataKey: 'Pipeline' },
        ] as const

        return (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {categoryCards.map(({ key, label, dataKey }) => {
                const cat = cats[dataKey] ?? { count: 0, acv: 0, delta_yesterday: null, delta_lastweek: null }
                const color = FORECAST_COLORS[dataKey] || '#64748b'

                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="card p-5 flex flex-col justify-between gap-3 cursor-pointer hover:border-[var(--brand-teal)] transition-all"
                    style={{ borderTop: `3px solid ${color}` }}
                    onClick={() => openDealsQuery(`${label} Deals (${cat.count} deals · ${acvM(cat.acv)})`, { category: dataKey }, { forecast_category: dataKey })}
                    title={`Click to view ${label} deals`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
                        <Pill color="slate"><Users className="w-3 h-3" />{cat.count} deals</Pill>
                      </div>
                      {sumLoading
                        ? <div className="h-8 w-28 skeleton-shimmer rounded" />
                        : <span className="font-extrabold text-2xl tabular-nums block hover:underline" style={{ color }}>{acvM(cat.acv)}</span>}
                      
                      <hr className="border-[var(--border-subtle)]" />
                      
                      <div className="flex flex-col gap-1">
                        {[
                          { l: 'vs Yesterday', d: cat.delta_yesterday, kind: 'delta_yesterday' },
                          { l: 'vs Last Week', d: cat.delta_lastweek, kind: 'delta_lastweek' },
                        ].map(({ l, d, kind }) => d ? (
                          <div
                            key={l}
                            className="flex items-center justify-between text-[11px] p-1 -mx-1 rounded hover:bg-[var(--bg-secondary)] cursor-pointer group/trend"
                            onClick={(e) => {
                              e.stopPropagation()
                              openDealsQuery(`${label} Deals (${l}) · ${d.count ?? 0} deals · ${acvM(d.acv ?? 0)}`, { category: dataKey, kind })
                            }}
                            title={`Click to view ${label} deals that changed ${l}`}
                          >
                            <span className="text-[var(--text-muted)] group-hover/trend:text-[var(--text-primary)]">{l}</span>
                            <div className="flex gap-1"><DeltaBadge val={d.count} /><AcvDelta val={d.acv} /></div>
                          </div>
                        ) : (
                          <div key={l} className="flex items-center justify-between text-[11px] text-[var(--text-muted)] opacity-60">
                            <span>{l}</span>
                            <span>—</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── SECTION 3 – Slippage & Delayed Renewals ─────────────── */}
      <div className="card p-6" style={{ borderLeft: '4px solid #F59E0B' }}>
        <div className="flex flex-col gap-6">
          {/* Top Header & Overall Slippage Total */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Slippage & Delayed Renewals
                </p>
              </div>
              <p className="text-xs text-[var(--text-muted)] max-w-2xl">
                {summary?.slippage?.rule_text || "Open deals whose fiscal period is before the current quarter (including previous fiscal year) count as delayed."}
              </p>
            </div>

            {/* Overall Slippage Total */}
            {(() => {
              const overall = summary?.slippage?.overall ?? { count: null, acv: null }
              const isFuture = summary?.slippage?.is_future
              const isNA = isFuture || overall.count === null
              const cnt = overall.count ?? 0
              const acvVal = overall.acv ?? 0
              return (
                <div
                  className={`px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 transition-all flex items-center gap-4 ${isNA ? 'cursor-default' : 'cursor-pointer hover:border-amber-500/50'}`}
                  onClick={() => !isNA && openDealsQuery(`Overall Slippage & Delayed Renewals · ${cnt} deals · ${acvM(acvVal)}`, { kind: 'delayed_all' })}
                  title={isNA ? "Not applicable for selected period" : "Click to view all slipped and delayed deals"}
                >
                  <div>
                    <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider block">
                      Total Slipped / Delayed
                    </span>
                    <div className={`font-extrabold text-2xl text-amber-600 dark:text-amber-400 tabular-nums ${!isNA ? 'hover:underline' : ''}`}>
                      {isNA ? 'n/a' : acvM(acvVal)}
                    </div>
                  </div>
                  <Pill color="amber"><AlertTriangle className="w-3.5 h-3.5" />{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                </div>
              )
            })()}
          </div>

          {/* 3 Slippage Categories */}
          {(() => {
            const isFuture = summary?.slippage?.is_future
            const slipCat = summary?.slippage?.categories?.slipped ?? { count: null, acv: null }
            const overdueCat = summary?.slippage?.categories?.overdue ?? { count: null, acv: null }
            const laterCat = summary?.slippage?.categories?.later_close ?? { count: null, acv: null }

            const yDate = movYesterday?.compare_date || summary?.slippage?.yesterday_date
            const lwDate = movLastWeek?.compare_date || summary?.slippage?.lastweek_date

            const slipCategories = [
              {
                id: 'slipped',
                title: 'Slipped to Next Year / Quarter',
                count: isFuture ? null : slipCat.count,
                acv: isFuture ? null : slipCat.acv,
                baselineLabel: isFuture ? 'n/a' : (slipCat.baseline_label || summary?.slippage?.period_start_baseline_label || 'Since start of period'),
                mainDrawerKind: 'delayed_slipped',
                mainCompare: 'period_start',
                isOverdue: false,
                yDelta: isFuture ? null : (slipCat.delta_yesterday ?? null),
                lwDelta: isFuture ? null : (slipCat.delta_lastweek ?? null),
              },
              {
                id: 'overdue',
                title: 'Overdue Deals',
                count: isFuture ? null : overdueCat.count,
                acv: isFuture ? null : overdueCat.acv,
                baselineLabel: isFuture ? 'n/a' : (overdueCat.baseline_label || 'Current'),
                mainDrawerKind: 'delayed_overdue',
                mainCompare: undefined,
                isOverdue: true,
                yDelta: isFuture ? null : (overdueCat.delta_yesterday ?? null),
                lwDelta: isFuture ? null : (overdueCat.delta_lastweek ?? null),
              },
              {
                id: 'later_close',
                title: 'Later Close Date (Postponed)',
                count: isFuture ? null : laterCat.count,
                acv: isFuture ? null : laterCat.acv,
                baselineLabel: isFuture ? 'n/a' : (laterCat.baseline_label || summary?.slippage?.period_start_baseline_label || 'Since start of period'),
                mainDrawerKind: 'delayed_later_close',
                mainCompare: 'period_start',
                isOverdue: false,
                yDelta: isFuture ? null : (laterCat.delta_yesterday ?? null),
                lwDelta: isFuture ? null : (laterCat.delta_lastweek ?? null),
              },
            ]

            const renderTrendBox = (
              label: string,
              delta: { count: number; acv: number } | null | undefined,
              comparePeriod: 'yesterday' | 'last_week',
              dateStr: string | null | undefined,
              cat: typeof slipCategories[0]
            ) => {
              if (delta === null || delta === undefined || isFuture) {
                return (
                  <div className="p-2 rounded-lg bg-slate-500/5 border border-slate-500/10 opacity-70 cursor-default">
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
                    <div className="font-bold text-sm text-[var(--text-muted)] tabular-nums">n/a</div>
                    <div className="text-[10px] text-[var(--text-muted)]">n/a</div>
                  </div>
                )
              }

              if (cat.isOverdue) {
                // Signed net change for overdue
                const isUp = delta.count > 0 || delta.acv > 0
                const isDown = delta.count < 0 || delta.acv < 0

                const colorClasses = isUp
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:border-amber-500/50'
                  : isDown
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/50'
                  : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400 hover:border-slate-500/50'

                let acvText = '$0'
                if (delta.acv > 0) {
                  acvText = `+${acvM(delta.acv)}`
                } else if (delta.acv < 0) {
                  acvText = `-${acvM(Math.abs(delta.acv))}`
                }

                let countText = '0 deals'
                if (delta.count > 0) {
                  countText = `+${delta.count} deals`
                } else if (delta.count < 0) {
                  countText = `${delta.count} deals`
                }

                const dateSub = dateStr ? ` (${formatDate(dateStr)})` : ''
                const drawerTitle = `${cat.title} (${label}${dateSub}) · Net ${countText} · ${acvText}`

                return (
                  <div
                    className={`p-2 rounded-lg border cursor-pointer transition-all ${colorClasses}`}
                    onClick={() =>
                      openDealsQuery(drawerTitle, {
                        kind: `delayed_${cat.id}_delta`,
                        compare: comparePeriod,
                      })
                    }
                    title={`Click to view ${cat.title} ${label} net movement`}
                  >
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
                    <div className="font-bold text-sm tabular-nums">{acvText}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{countText}</div>
                  </div>
                )
              } else {
                // Event transitions for Slipped and Later Close
                const hasDeals = (delta.count || 0) > 0 || (delta.acv || 0) > 0
                const colorClasses = hasDeals
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:border-amber-500/50'
                  : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400 hover:border-slate-500/50'

                const acvText = acvM(delta.acv || 0)
                const countText = `${delta.count || 0} deals`
                const dateSub = dateStr ? ` (${formatDate(dateStr)})` : ''
                const drawerTitle = `${cat.title} (${label}${dateSub}) · ${countText} · ${acvText}`

                return (
                  <div
                    className={`p-2 rounded-lg border cursor-pointer transition-all ${colorClasses}`}
                    onClick={() =>
                      openDealsQuery(drawerTitle, {
                        kind: `delayed_${cat.id}`,
                        compare: comparePeriod,
                      })
                    }
                    title={`Click to view ${cat.title} ${label}`}
                  >
                    <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
                    <div className="font-bold text-sm tabular-nums">{acvText}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{countText}</div>
                  </div>
                )
              }
            }

            return (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {slipCategories.map(cat => {
                  const isNA = isFuture || cat.count === null
                  const cnt = cat.count ?? 0
                  const acvVal = cat.acv ?? 0
                  return (
                    <div
                      key={cat.id}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] flex flex-col justify-between"
                    >
                      {/* Main figure for the period */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-[var(--text-secondary)]">
                            {cat.title}
                          </span>
                          <Pill color="amber">{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                        </div>
                        <div
                          className={`font-extrabold text-2xl text-[var(--text-primary)] tabular-nums ${isNA ? 'cursor-default' : 'cursor-pointer hover:underline'}`}
                          onClick={() => !isNA && openDealsQuery(`${cat.title} (${cnt} deals · ${acvM(acvVal)})`, { kind: cat.mainDrawerKind, compare: cat.mainCompare })}
                          title={isNA ? "Not applicable for selected period" : `Click to view ${cat.title}`}
                        >
                          {isNA ? 'n/a' : acvM(acvVal)}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-1 font-medium">
                          {cat.baselineLabel}
                        </div>
                      </div>

                      {/* Trends below it: Since yesterday and Since last week */}
                      <div className="mt-4 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-2">
                        {renderTrendBox('Since yesterday', cat.yDelta, 'yesterday', yDate, cat)}
                        {renderTrendBox('Since last week', cat.lwDelta, 'last_week', lwDate, cat)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Sub-line for Not yet proposed */}
          {(() => {
            const blankCat = cats['Blank'] ?? { count: 0, acv: 0 }
            return (
              <div
                className="pt-2 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => openDealsQuery(`Not yet proposed Deals (${blankCat.count} deals · ${acvM(blankCat.acv)})`, { category: 'Blank' }, { forecast_category: 'Blank' })}
                title="Click to view Not yet proposed deals"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">Not yet proposed:</span>
                  <span className="text-xs font-bold font-mono text-[var(--text-primary)]">{acvM(blankCat.acv)}</span>
                  <span className="text-xs text-[var(--text-muted)]">({blankCat.count} deals)</span>
                </div>
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline">
                  View not yet proposed deals →
                </span>
              </div>
            )
          })()}
        </div>
      </div>


      {/* ── SECTION 4 – Forecast Category & Approval Movement ───────────────── */}
      <div className="card p-6">
        <MovementsSummary
          movements={movements}
          compareMode={movCompare}
          onCompareChange={setMovCompare}
          onSelectDeals={(title, deals) => setModal({ title, deals })}
        />
      </div>

      {/* ── SECTION 6 – Proposal Confirmation ───────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base text-[var(--text-primary)]">Proposal Confirmation</h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Unit: Opportunity Count (#)</p>
          </div>
          <Globe2 className="w-5 h-5 text-[var(--text-muted)]" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">Region</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)]">Total Opportunity Approval in the System</th>
                <th className="text-right px-4 py-3 font-semibold text-emerald-600 dark:text-emerald-400">Approved</th>
                <th className="text-right px-4 py-3 font-semibold text-amber-600 dark:text-amber-400">Pending Approval</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)]">Not submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {propRows.map((row: any) => (
                <tr key={row.region} className="hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-4 py-3 font-medium cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} Deals`, { region: row.region }, { sub_region: row.region })}>{row.region}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold cursor-pointer hover:underline text-[var(--brand-teal)]" onClick={() => openDealsQuery(`${row.region} · All Approvals`, { region: row.region }, { sub_region: row.region })}>
                    {(row.approved_count ?? 0) + (row.pending_count ?? 0) + (row.blank_count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 font-bold cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} · Approved Deals`, { region: row.region, approval_status: 'Approved' }, { sub_region: row.region, approval_status: 'Approved' })}>{row.approved_count ?? 0}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700 dark:text-amber-400 font-bold cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} · Pending Approval Deals`, { region: row.region, approval_status: 'Pending Approval' }, { sub_region: row.region, approval_status: 'Pending Approval' })}>{row.pending_count ?? 0}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--text-secondary)] cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} · Not submitted`, { region: row.region, approval_status: 'Blank' }, { sub_region: row.region, approval_status: 'Blank' })}>{row.blank_count ?? 0}</td>
                </tr>
              ))}
              <tr className="bg-[var(--bg-secondary)] font-bold border-t-2 border-[var(--border)]">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right font-mono cursor-pointer hover:underline text-[var(--brand-teal)]" onClick={() => openDealsQuery(`Total Opportunity Approvals (${(propTotals.approved_count ?? 0) + (propTotals.pending_count ?? 0) + (propTotals.blank_count ?? 0)} deals)`, {})}>
                  {(propTotals.approved_count ?? 0) + (propTotals.pending_count ?? 0) + (propTotals.blank_count ?? 0)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-700 dark:text-emerald-400 cursor-pointer hover:underline" onClick={() => openDealsQuery(`All Approved Deals (${propTotals.approved_count ?? 0} deals)`, { approval_status: 'Approved' }, { approval_status: 'Approved' })}>{propTotals.approved_count ?? 0}</td>
                <td className="px-4 py-3 text-right font-mono text-amber-700 dark:text-amber-400 cursor-pointer hover:underline" onClick={() => openDealsQuery(`All Pending Approval Deals (${propTotals.pending_count ?? 0} deals)`, { approval_status: 'Pending Approval' }, { approval_status: 'Pending Approval' })}>{propTotals.pending_count ?? 0}</td>
                <td className="px-4 py-3 text-right font-mono cursor-pointer hover:underline" onClick={() => openDealsQuery(`All Not submitted Deals (${propTotals.blank_count ?? 0} deals)`, { approval_status: 'Blank' }, { approval_status: 'Blank' })}>{propTotals.blank_count ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 7 – Regional Trend ───────────────────────────────────────── */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base text-[var(--text-primary)]">Regional Trend</h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">ACV values in $M</p>
          </div>
          <BarChart3 className="w-5 h-5 text-[var(--text-muted)]" />
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">Region</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)]">Total ACV Value</th>
                {FC_COLS.map(fc => (
                  <th key={fc} className="text-right px-4 py-3 font-semibold" style={{ color: FORECAST_COLORS[fc] }}>{getForecastCategoryLabel(fc)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {trendRows.map((row: any) => (
                <tr key={row.region} className="hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-4 py-3 font-medium cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} Deals (${acvM(row.total_acv)})`, { region: row.region }, { sub_region: row.region })}>{row.region}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold cursor-pointer hover:underline text-[var(--brand-teal)]" onClick={() => openDealsQuery(`${row.region} Total (${acvM(row.total_acv)})`, { region: row.region }, { sub_region: row.region })}>{acvM(row.total_acv)}</td>
                  {FC_COLS.map(fc => {
                    const k = fc.toLowerCase().replace(' ', '_') + '_acv'
                    const val = row[k] ?? 0
                    return (
                      <td
                        key={fc}
                        className="px-4 py-3 text-right font-mono cursor-pointer hover:underline"
                        style={{ color: FORECAST_COLORS[fc] }}
                        onClick={() => openDealsQuery(`${row.region} · ${getForecastCategoryLabel(fc)} (${acvM(val)})`, { region: row.region, category: fc }, { sub_region: row.region, forecast_category: fc })}
                      >
                        {acvM(val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="bg-[var(--bg-secondary)] font-bold border-t-2 border-[var(--border)]">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right font-mono cursor-pointer hover:underline text-[var(--brand-teal)]" onClick={() => openDealsQuery(`Total Renewal ACV (${acvM(regTotals.total_acv)})`, {})}>{acvM(regTotals.total_acv)}</td>
                {FC_COLS.map(fc => {
                  const k = fc.toLowerCase().replace(' ', '_') + '_acv'
                  const val = regTotals[k] ?? 0
                  return (
                    <td
                      key={fc}
                      className="px-4 py-3 text-right font-mono cursor-pointer hover:underline"
                      style={{ color: FORECAST_COLORS[fc] }}
                      onClick={() => openDealsQuery(`Total · ${getForecastCategoryLabel(fc)} (${acvM(val)})`, { category: fc }, { forecast_category: fc })}
                    >
                      {acvM(val)}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {regional?.total_acv_check_passes != null && (
          <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${
            regional.total_acv_check_passes
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/10 text-red-700 dark:text-red-400'
          }`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            {regional.total_acv_check_passes
              ? `Regional Trend Total matches Overview Total Renewal ${summary?.data_slice || ''} ACV ✓`
              : '⚠️ Regional Trend Total does NOT match — check for unmapped regions'}
          </div>
        )}
      </div>

      {/* ── B7 SECTION: Needs Attention Panel (Last section of Overview) ── */}
      {summary?.needs_attention?.items?.length > 0 && (
        <div className="card p-5 border border-amber-500/30 bg-gradient-to-br from-[var(--bg-card)] via-[var(--bg-secondary)]/30 to-[var(--bg-card)] shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-extrabold text-[var(--text-primary)] tracking-tight">
                Needs attention
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Actionable exceptions for {summary.data_slice || 'selected period'} · Click any line to inspect deals
              </p>
            </div>
            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 font-mono">
              {summary.needs_attention.items.length} {summary.needs_attention.items.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {summary.needs_attention.items.map((item: any, idx: number) => {
              const isSingleDeal = item.category_key === 'biggest_drop'

              let headline = ''
              if (item.category_key === 'commit_not_approved') {
                headline = `${item.category_count} Commit deals not approved · ${acvM(item.category_acv)}`
              } else if (item.category_key === 'overdue') {
                headline = `${item.category_count} Overdue deals · ${acvM(item.category_acv)}`
              } else if (item.category_key === 'closing_14d_unapproved') {
                headline = `${item.category_count} ${item.category_label || 'Deals closing without approval'} · ${acvM(item.category_acv)}`
              } else if (item.category_key === 'biggest_drop') {
                headline = `Biggest drop vs yesterday · -${acvM(item.acv)}`
              } else {
                headline = `${item.category_count} ${item.category_label} · ${acvM(item.category_acv)}`
              }

              const exampleText = isSingleDeal
                ? `${item.opportunity_name}${item.account_name ? ` (${item.account_name})` : ''} · ${item.detail}`
                : `Largest: ${item.opportunity_name}${item.account_name ? ` (${item.account_name})` : ''} · ${acvM(item.acv)}${item.badge ? ` · ${item.badge}` : ''}`

              const rightVal = isSingleDeal ? `-${acvM(item.acv)}` : acvM(item.category_acv)
              const rightCount = isSingleDeal ? '1 deal' : `${formatNumber(item.category_count)} deals`

              return (
                <div
                  key={`${item.category_key}-${item.opportunity_id_18}-${idx}`}
                  className="py-3 px-3 rounded-lg hover:bg-[var(--bg-secondary)]/80 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
                  onClick={() => {
                    const drawerTitle = isSingleDeal
                      ? `Biggest Drop: ${item.opportunity_name} (-${acvM(item.acv)})`
                      : `${headline.split('·')[0].trim()} (${formatNumber(item.category_count)} deals · ${acvM(item.category_acv)})`

                    openDealsQuery(
                      drawerTitle,
                      {
                        kind: item.kind,
                        deal_ids: isSingleDeal ? item.opportunity_id_18 : (item.deal_ids && item.deal_ids.length > 0 ? item.deal_ids.join(',') : undefined),
                      }
                    )
                  }}
                  title="Click to view matching deals drawer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--brand-teal)] transition-colors">
                      {headline}
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
                      {exampleText}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-auto flex-shrink-0">
                    <div className="text-right font-mono">
                      <div className="text-xs font-black text-[var(--text-primary)] tabular-nums group-hover:underline">
                        {rightVal}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] font-medium">
                        {rightCount}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Deal modal */}
      {modal && (
        <DealListModal
          title={modal.title}
          deals={modal.deals}
          initialFilters={modalInitialFilters}
          deltaGroups={modal.deltaGroups}
          onSelectOpp={(id) => { setModal(null); setSelectedOppId(id) }}
          onClose={() => { setModal(null); setModalInitialFilters(undefined) }}
        />
      )}


      {/* Opportunity drawer */}
      <OpportunityDrawer oppId={selectedOppId} onClose={() => setSelectedOppId(null)} />
    </div>
  )
}
