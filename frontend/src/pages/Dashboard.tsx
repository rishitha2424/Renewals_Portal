import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw, Upload, AlertTriangle, TrendingUp, TrendingDown,
  ChevronRight, X, CheckCircle2, ArrowRight, BarChart3, Users, Globe2,
  ShieldCheck, AlertCircle, CalendarX2,
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
import SectionNav from '@/components/common/SectionNav'

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
    <span className={`inline-flex items-center text-xs font-medium tabular-nums ${
      up ? 'text-emerald-600 dark:text-emerald-400'
         : 'text-rose-600 dark:text-rose-400'
    }`}>
      {up ? '+' : ''}{val}{label ? ` ${label}` : ''}
    </span>
  )
}

function AcvDelta({ val }: { val: number | null | undefined }) {
  if (val == null) return null
  const up = val >= 0
  return (
    <span className={`inline-flex items-center text-xs font-medium tabular-nums ${
      up ? 'text-emerald-600 dark:text-emerald-400'
         : 'text-rose-600 dark:text-rose-400'
    }`}>
      {up ? '+' : ''}{acvM(val)}
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
    params: { category?: string; region?: string; approval_status?: string; kind?: string; compare?: string; deal_ids?: string; as_of?: string; expiry_year?: number; [key: string]: any },
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

  const overviewSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (summary?.total) {
      list.push({ id: 'overview-hero', title: summary?.data_slice ? `${summary.data_slice} Total` : 'Total ACV' })
    }
    if (summary?.categories && Object.keys(summary.categories).length > 0) {
      list.push({ id: 'overview-forecast-category', title: 'Forecast category' })
    }
    if (summary?.delayed_renewals || summary?.delayed_renewals_total) {
      list.push({ id: 'overview-delayed-renewals', title: 'Delayed renewals' })
    }
    if (summary?.slippage_section || summary?.slippage) {
      list.push({ id: 'overview-slippage', title: 'Slippage' })
    }
    if (movements) {
      list.push({ id: 'overview-movements', title: 'Movements & changes' })
    }
    if (regional?.proposal_confirmation?.length) {
      list.push({ id: 'overview-proposal-confirmation', title: 'Proposal confirmation' })
    }
    if (regional?.regional_trend?.length) {
      list.push({ id: 'overview-regional-trend', title: 'Regional trend' })
    }
    return list
  }, [summary, movements, regional])

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
  const trendFcCols = Object.keys(cats).filter(k => k !== 'total' && k !== 'All' && (cats[k]?.count > 0 || (cats[k]?.acv != null && cats[k]?.acv !== 0)))

  return (
    <div className="space-y-6 pb-16 w-full">
      <SectionNav sections={overviewSections} />

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
      <div id="overview-hero" className="card p-6 scroll-mt-24">
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
            <span className="text-xs font-semibold px-2.5 py-1 rounded-sm bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/20">
              {total.count ?? 0} Contracts
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Fiscal Period = {summary?.data_slice || 'Selected Period'} · Click to view all {total.count ?? 0} contracts
          </p>

          {/* Trend rows BELOW the total ACV and contract count */}
          <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-col sm:flex-row gap-4 sm:gap-8">
            {[
              { label: 'vs yesterday', delta: total.delta_yesterday, kind: 'delta_yesterday', date: summary?.yesterday_date },
              { label: 'vs last week', delta: total.delta_lastweek, kind: 'delta_lastweek', date: summary?.lastweek_date },
            ].map(({ label, delta, kind, date }) => {
              const acvVal = delta?.acv ?? 0
              const countVal = delta?.count ?? 0
              const isAcvNeutral = acvVal === 0
              const isCountNeutral = countVal === 0

              const acvColor = isAcvNeutral
                ? 'text-[var(--text-muted)]'
                : acvVal > 0
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-rose-600 dark:text-rose-400 font-medium'

              const countColor = isCountNeutral
                ? 'text-[var(--text-muted)]'
                : countVal > 0
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-rose-600 dark:text-rose-400 font-medium'

              const acvSign = acvVal > 0 ? '+' : ''
              const countSign = countVal > 0 ? '+' : ''

              return (
                <div
                  key={label}
                  className="flex items-center gap-2 text-xs cursor-pointer group hover:opacity-80 transition-opacity"
                  onClick={() => delta && openDealsQuery(`${label} Movement Deals (${delta.count ?? 0} deals · ${acvM(delta.acv ?? 0)})`, { kind })}
                  title={`Click to view deals with changes ${label}`}
                >
                  <span className="text-[var(--text-muted)] font-normal text-xs">
                    {label} {date ? `(${formatDate(date).split(',')[0]})` : ''}:
                  </span>
                  {delta ? (
                    <span className="text-xs tabular-nums flex items-center gap-1.5">
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
                <span className="text-xs font-semibold text-[var(--text-secondary)] tracking-tight group-hover:text-[var(--brand-teal)] transition-colors">
                  Coverage (Commit + Best Case):
                </span>
              </div>
              <span className="text-sm sm:text-base font-bold tabular-nums text-[var(--text-primary)] group-hover:underline">
                {summary.coverage.pct != null ? `${summary.coverage.pct}%` : '—'}
              </span>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                of total ACV ({formatCurrency(summary.coverage.acv)} · {formatNumber(summary.coverage.count)} contracts)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5" title="Percentage-point change vs yesterday">
                <span className="text-xs text-[var(--text-muted)]">vs yesterday:</span>
                {summary.coverage.delta_yesterday_pp != null ? (
                  <span
                    className={`tabular-nums font-medium text-xs ${
                      summary.coverage.delta_yesterday_pp >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
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
                <span className="text-xs text-[var(--text-muted)]">vs last week:</span>
                {summary.coverage.delta_lastweek_pp != null ? (
                  <span
                    className={`tabular-nums font-medium text-xs ${
                      summary.coverage.delta_lastweek_pp >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {summary.coverage.delta_lastweek_pp >= 0 ? '+' : ''}
                    {summary.coverage.delta_lastweek_pp.toFixed(2)} pp
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </div>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 group-hover:underline flex items-center gap-0.5">
                View deals →
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 2 – Forecast Category Group (Data-driven) ──────────────── */}
      {(() => {
        // Data-driven list of forecast categories present in the snapshot (excluding 'Blank' / 'Not yet proposed', 'total', etc.)
        const categoryKeys = Object.keys(cats).filter(
          (k) => k !== 'Blank' && k !== 'Not yet proposed' && k !== 'total' && k !== 'All'
        )

        return (
          <div id="overview-forecast-category" className="scroll-mt-24 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
                Forecast category
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {categoryKeys.map((catKey) => {
                const cat = cats[catKey] ?? { count: 0, acv: 0, delta_yesterday: null, delta_lastweek: null }
                const label = getForecastCategoryLabel(catKey)
                const color = FORECAST_COLORS[catKey] || '#64748b'

                return (
                  <motion.div
                    key={catKey}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="card p-5 flex flex-col justify-between gap-3 cursor-pointer hover:border-[var(--brand-teal)] transition-all"
                    style={{ borderTop: `3px solid ${color}` }}
                    onClick={() => openDealsQuery(`${label} Deals (${cat.count} deals · ${acvM(cat.acv)})`, { category: catKey }, { forecast_category: catKey })}
                    title={`Click to view ${label} deals`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={label}>{label}</span>
                        <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">{cat.count} deals</span>
                      </div>
                      {sumLoading
                        ? <div className="h-8 w-28 skeleton-shimmer rounded" />
                        : <span className="font-bold text-2xl tabular-nums block hover:underline" style={{ color }}>{acvM(cat.acv)}</span>}
                      
                      <hr className="border-[var(--border-subtle)]" />
                      
                      <div className="flex flex-col gap-1">
                        {[
                          { l: 'vs yesterday', d: cat.delta_yesterday, kind: 'delta_yesterday' },
                          { l: 'vs last week', d: cat.delta_lastweek, kind: 'delta_lastweek' },
                        ].map(({ l, d, kind }) => d ? (
                          <div
                            key={l}
                            className="flex items-center justify-between text-xs p-1 -mx-1 rounded hover:bg-[var(--bg-secondary)] cursor-pointer group/trend"
                            onClick={(e) => {
                              e.stopPropagation()
                              openDealsQuery(`${label} Deals (${l}) · ${d.count ?? 0} deals · ${acvM(d.acv ?? 0)}`, { category: catKey, kind })
                            }}
                            title={`Click to view ${label} deals that changed ${l}`}
                          >
                            <span className="text-[var(--text-muted)] group-hover/trend:text-[var(--text-primary)]">{l}</span>
                            <div className="flex items-center gap-1.5 tabular-nums"><DeltaBadge val={d.count} /><span className="text-[var(--text-muted)]">·</span><AcvDelta val={d.acv} /></div>
                          </div>
                        ) : (
                          <div key={l} className="flex items-center justify-between text-xs text-[var(--text-muted)] opacity-60">
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

      {/* ── SECTION 3 – Delayed Renewals & Slippage (Separated) ─────────── */}
      {(() => {
        const isFuture = summary?.is_future || summary?.slippage?.is_future
        const delRenewals = summary?.delayed_renewals
        const slippageSec = summary?.slippage_section || summary?.slippage
        const lostSec = summary?.lost_card || summary?.slippage?.categories?.lost
        const delTot = summary?.delayed_renewals_total || delRenewals?.total
        const slipTot = summary?.slippage_total || slippageSec?.total || summary?.slippage?.overall

        const yDate = movYesterday?.compare_date || summary?.yesterday_date || summary?.slippage?.yesterday_date
        const lwDate = movLastWeek?.compare_date || summary?.lastweek_date || summary?.slippage?.lastweek_date
        const yDateStr = yDate ? formatDate(yDate) : 'yesterday'
        const lwDateStr = lwDate ? formatDate(lwDate) : 'last week'

        // Helper to render Since yesterday / Since last week boxes
        const renderSubBox = (
          label: string,
          delta: { count: number; acv: number } | null | undefined,
          dateLabel: string,
          onBoxClick: () => void,
          drawerTitle: string,
          isSignedDelta = false
        ) => {
          if (delta === null || delta === undefined || isFuture) {
            return (
              <div className="p-2 rounded-lg bg-slate-500/5 border border-slate-500/10 cursor-not-allowed opacity-60">
                <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
                <div className="font-bold text-xs text-[var(--text-muted)] tabular-nums">n/a</div>
                <div className="text-[10px] text-[var(--text-muted)]">n/a</div>
              </div>
            )
          }

          const absCount = Math.abs(delta.count || 0)
          const absAcv = Math.abs(delta.acv || 0)
          const hasDeals = absCount > 0 || absAcv > 0

          let acvText = formatCurrency(delta.acv || 0)
          let countText = `${delta.count || 0} ${Math.abs(delta.count || 0) === 1 ? 'deal' : 'deals'}`
          let colorCls = 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'

          if (isSignedDelta) {
            const isUp = (delta.count || 0) > 0 || (delta.acv || 0) > 0
            const isDown = (delta.count || 0) < 0 || (delta.acv || 0) < 0
            colorCls = isUp
              ? 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
              : isDown
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'
            acvText = (delta.acv || 0) > 0 ? `+${acvM(delta.acv)}` : (delta.acv || 0) < 0 ? `-${acvM(Math.abs(delta.acv))}` : '$0'
            countText = (delta.count || 0) > 0 ? `+${delta.count} deals` : (delta.count || 0) < 0 ? `${delta.count} deals` : '0 deals'
          } else {
            colorCls = hasDeals
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
              : 'bg-slate-500/10 border-slate-500/20 text-slate-600 dark:text-slate-400'
            acvText = acvM(delta.acv || 0)
          }

          return (
            <div
              className={`p-2 rounded-lg border transition-all ${colorCls} ${hasDeals ? 'cursor-pointer hover:border-amber-500/50' : 'cursor-not-allowed opacity-60'}`}
              onClick={() => hasDeals && onBoxClick()}
              title={hasDeals ? `Click to view deals changed (${drawerTitle})` : `No deals changed since ${dateLabel}`}
            >
              <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
              <div className="font-bold text-xs tabular-nums">{acvText}</div>
              <div className="text-[10px] text-[var(--text-muted)]">{countText}</div>
            </div>
          )
        }

        return (
          <div className="space-y-6">
            {/* ── SUBSECTION 1: DELAYED RENEWALS ── */}
            <div id="overview-delayed-renewals" className="card p-6 scroll-mt-24" style={{ borderLeft: '4px solid #F43F5E' }}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <h2 className="text-sm font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                        Delayed Renewals
                      </h2>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] max-w-2xl">
                      Total Delayed = Overdue + Delayed, close date ahead. Open renewals matching the delayed group setting.
                    </p>
                  </div>
                  {summary?.delayed_pct_of_quarter != null && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 whitespace-nowrap">
                      {summary.delayed_pct_of_quarter}% of Quarter Total ({acvM(delTot?.acv || 0)} of {acvM(summary.quarter_total_acv || 0)})
                    </span>
                  )}
                </div>

                {/* Delayed Renewals Total Bar */}
                {(() => {
                  const isNA = isFuture || delTot?.count === null
                  const cnt = delTot?.count ?? 0
                  const acvVal = delTot?.acv ?? 0
                  const hasDeals = cnt > 0 || acvVal > 0
                  const mainTitle = `Delayed Renewals · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acvVal)})`

                  const yDelta = delTot?.delayed_vs_yesterday
                  const lwDelta = delTot?.delayed_vs_lastweek
                  const yCnt = Math.abs(yDelta?.count || 0)
                  const yAcv = Math.abs(yDelta?.acv || 0)
                  const lwCnt = Math.abs(lwDelta?.count || 0)
                  const lwAcv = Math.abs(lwDelta?.acv || 0)

                  const yTitle = `Delayed Renewals · since yesterday (${yCnt} ${yCnt === 1 ? 'deal' : 'deals'} · ${acvM(yAcv)})`
                  const lwTitle = `Delayed Renewals · since last week (${lwCnt} ${lwCnt === 1 ? 'deal' : 'deals'} · ${acvM(lwAcv)})`

                  return (
                    <div className="rounded-xl bg-rose-500/5 dark:bg-rose-950/20 border border-rose-500/20 p-4 flex flex-wrap items-center justify-between gap-4">
                      <div
                        className={hasDeals && !isNA ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}
                        onClick={() => hasDeals && !isNA && openDealsQuery(mainTitle, { kind: 'delayed_total' })}
                        title={hasDeals ? 'Click to view all delayed renewals' : '0 deals'}
                      >
                        <div className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider mb-1">
                          Delayed Renewals Total
                        </div>
                        <div className="flex items-baseline gap-3">
                          <span className={`text-2xl font-black text-[var(--text-primary)] tabular-nums ${hasDeals && !isNA ? 'hover:underline' : ''}`}>
                            {isNA ? 'n/a' : acvM(acvVal)}
                          </span>
                          <Pill color="rose"><AlertCircle className="w-3.5 h-3.5" />{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {renderSubBox('Since yesterday', yDelta, yDateStr, () => openDealsQuery(yTitle, { kind: 'delayed_total_delta', compare: 'yesterday' }), yTitle, true)}
                        {renderSubBox('Since last week', lwDelta, lwDateStr, () => openDealsQuery(lwTitle, { kind: 'delayed_total_delta', compare: 'last_week' }), lwTitle, true)}
                      </div>
                    </div>
                  )
                })()}

                {/* 2 Delayed Categories: Overdue & Delayed, close date ahead */}
                {(() => {
                  const overdueCat = delRenewals?.overdue || summary?.overdue || summary?.slippage?.categories?.overdue
                  const laterCat = delRenewals?.ahead || delRenewals?.later_close || summary?.ahead || summary?.later_close || summary?.slippage?.categories?.ahead || summary?.slippage?.categories?.later_close

                  const delayedCards = [
                    {
                      id: 'overdue',
                      title: 'Overdue Deals',
                      data: overdueCat,
                      isOverdue: true,
                      kind: 'overdue',
                      deltaKind: 'delayed_overdue_delta',
                      baselineLabel: 'Current',
                    },
                    {
                      id: 'delayed_ahead',
                      title: 'Delayed, close date ahead',
                      data: laterCat,
                      isOverdue: false,
                      kind: 'delayed_ahead',
                      deltaKind: 'delayed_ahead',
                      baselineLabel: 'Since start of period',
                    },
                  ]

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {delayedCards.map(c => {
                        const cnt = c.data?.count ?? 0
                        const acvVal = c.data?.acv ?? 0
                        const isNA = isFuture || c.data?.count === null
                        const hasDeals = cnt > 0 || acvVal > 0
                        const mainTitle = `${c.title} · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acvVal)})`

                        const yDelta = c.data?.delayed_vs_yesterday ?? c.data?.delta_yesterday
                        const lwDelta = c.data?.delayed_vs_lastweek ?? c.data?.delta_lastweek
                        const yCnt = Math.abs(yDelta?.count || 0)
                        const yAcv = Math.abs(yDelta?.acv || 0)
                        const lwCnt = Math.abs(lwDelta?.count || 0)
                        const lwAcv = Math.abs(lwDelta?.acv || 0)

                        const yTitle = `${c.title} · since yesterday (${yCnt} ${yCnt === 1 ? 'deal' : 'deals'} · ${acvM(yAcv)})`
                        const lwTitle = `${c.title} · since last week (${lwCnt} ${lwCnt === 1 ? 'deal' : 'deals'} · ${acvM(lwAcv)})`

                        return (
                          <div
                            key={c.id}
                            className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="text-xs font-semibold text-[var(--text-secondary)]">{c.title}</span>
                                <Pill color="rose">{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                              </div>
                              <div
                                className={`font-extrabold text-2xl text-[var(--text-primary)] tabular-nums ${hasDeals && !isNA ? 'cursor-pointer hover:underline' : 'cursor-default'}`}
                                onClick={() => hasDeals && !isNA && openDealsQuery(mainTitle, { kind: c.kind, compare: c.isOverdue ? undefined : 'period_start' })}
                                title={hasDeals ? `Click to view ${c.title}` : '0 deals'}
                              >
                                {isNA ? 'n/a' : acvM(acvVal)}
                              </div>
                              <div className="text-[11px] text-[var(--text-muted)] mt-1 font-medium">{c.baselineLabel}</div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-2">
                              {renderSubBox('Since yesterday', yDelta, yDateStr, () => openDealsQuery(yTitle, { kind: c.deltaKind, compare: 'yesterday' }), yTitle, c.isOverdue)}
                              {renderSubBox('Since last week', lwDelta, lwDateStr, () => openDealsQuery(lwTitle, { kind: c.deltaKind, compare: 'last_week' }), lwTitle, c.isOverdue)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* ── SUBSECTION 2: SLIPPAGE ── */}
            <div id="overview-slippage" className="card p-6 scroll-mt-24" style={{ borderLeft: '4px solid #F59E0B' }}>
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                      <h2 className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                        Slippage
                      </h2>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] max-w-2xl">
                      {slippageSec?.rule_caption || 'Renewals whose service ended this year or earlier but are now expected to close next year.'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {slippageSec?.type_filter_note || 'MR and R types only'}
                    </p>
                  </div>
                  {summary?.slippage_pct_of_quarter != null && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 whitespace-nowrap">
                      {summary.slippage_pct_of_quarter}% of Quarter Total ({acvM(slipTot?.acv || 0)} of {acvM(summary.quarter_total_acv || 0)})
                    </span>
                  )}
                </div>

                {/* Slippage Total Bar */}
                {(() => {
                  const isNA = isFuture || slipTot?.count === null
                  const cnt = slipTot?.count ?? 0
                  const acvVal = slipTot?.acv ?? 0
                  const hasDeals = cnt > 0 || acvVal > 0
                  const mainTitle = `Slippage · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acvVal)})`

                  const startDelta = slipTot?.delta_period_start
                  const yDelta = slipTot?.delayed_vs_yesterday
                  const lwDelta = slipTot?.delayed_vs_lastweek
                  const yCnt = Math.abs(yDelta?.count || 0)
                  const yAcv = Math.abs(yDelta?.acv || 0)
                  const lwCnt = Math.abs(lwDelta?.count || 0)
                  const lwAcv = Math.abs(lwDelta?.acv || 0)

                  const yTitle = `Slippage · since yesterday (${yCnt} ${yCnt === 1 ? 'deal' : 'deals'} · ${acvM(yAcv)})`
                  const lwTitle = `Slippage · since last week (${lwCnt} ${lwCnt === 1 ? 'deal' : 'deals'} · ${acvM(lwAcv)})`

                  return (
                    <div className="rounded-xl bg-amber-500/5 dark:bg-amber-950/20 border border-amber-500/20 p-4 flex flex-wrap items-center justify-between gap-4">
                      <div
                        className={hasDeals && !isNA ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}
                        onClick={() => hasDeals && !isNA && openDealsQuery(mainTitle, { kind: 'slippage_total' })}
                        title={hasDeals ? 'Click to view all slipped deals' : '0 deals'}
                      >
                        <div className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">
                          Slippage Total
                        </div>
                        <div className="flex items-baseline gap-3">
                          <span className={`text-2xl font-black text-[var(--text-primary)] tabular-nums ${hasDeals && !isNA ? 'hover:underline' : ''}`}>
                            {isNA ? 'n/a' : acvM(acvVal)}
                          </span>
                          <Pill color="amber"><AlertTriangle className="w-3.5 h-3.5" />{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {renderSubBox('Since start of year', startDelta, 'period start', () => openDealsQuery(mainTitle, { kind: 'slippage_total' }), mainTitle, false)}
                        {renderSubBox('Since yesterday', yDelta, yDateStr, () => openDealsQuery(yTitle, { kind: 'slippage_total', compare: 'yesterday' }), yTitle, false)}
                        {renderSubBox('Since last week', lwDelta, lwDateStr, () => openDealsQuery(lwTitle, { kind: 'slippage_total', compare: 'last_week' }), lwTitle, false)}
                      </div>
                    </div>
                  )
                })()}

                {/* Forecast Category Split */}
                {slippageSec?.categories && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {['Commit', 'Best Case', 'Pipeline', 'Blank'].map(cat => {
                      const cData = slippageSec.categories[cat] || { count: 0, acv: 0 }
                      const label = cat === 'Blank' ? 'Not yet proposed' : cat
                      const hasC = (cData.count || 0) > 0 || (cData.acv || 0) > 0
                      return (
                        <div
                          key={cat}
                          onClick={() => hasC && openDealsQuery(`Slippage · ${label}`, { kind: 'slippage', category: cat })}
                          className={`p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] transition-colors ${hasC ? 'cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5' : 'opacity-60 cursor-default'}`}
                        >
                          <div className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</div>
                          <div className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
                            {acvM(cData.acv || 0)}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] tabular-nums">
                            {cData.count || 0} {(cData.count || 0) === 1 ? 'deal' : 'deals'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Slipped From Table */}
                {slippageSec?.slipped_from && slippageSec.slipped_from.length > 0 && (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
                    <div className="px-4 py-2.5 bg-[var(--bg-secondary)]/50 border-b border-[var(--border)] flex items-center justify-between">
                      <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                        Slipped From
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Service Expiry Year Breakdown
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--bg-secondary)]/30 text-[var(--text-secondary)] font-semibold border-b border-[var(--border)]">
                            <th className="px-4 py-2">Service Expiry Year</th>
                            <th className="px-4 py-2 text-right">Deals</th>
                            <th className="px-4 py-2 text-right">ACV</th>
                            <th className="px-4 py-2">Expected Close</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {slippageSec.slipped_from.map((sf: any) => (
                            <tr
                              key={sf.expiry_year}
                              onClick={() => openDealsQuery(`Slipped from ${sf.expiry_year}`, { kind: 'slipped_from_year', expiry_year: sf.expiry_year })}
                              className="hover:bg-amber-500/5 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                                From {sf.expiry_year}
                              </td>
                              <td className="px-4 py-2 text-right font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                                {sf.count}
                              </td>
                              <td className="px-4 py-2 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                                {acvM(sf.acv)}
                              </td>
                              <td className="px-4 py-2 text-[var(--text-muted)]">
                                Closing in {slippageSec.next_year || 'next year'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── SUBSECTION 3: LOST / REMOVED (Separate Card) ── */}
            {(() => {
              const lostData = lostSec || summary?.lost || summary?.slippage?.categories?.lost
              const cnt = lostData?.count ?? 0
              const acvVal = lostData?.acv ?? 0
              const isNA = isFuture || lostData?.count === null
              const hasDeals = cnt > 0 || acvVal > 0
              const mainTitle = `Lost / Removed · quarter to date (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acvVal)})`

              const yDelta = lostData?.delayed_vs_yesterday
              const lwDelta = lostData?.delayed_vs_lastweek
              const yCnt = Math.abs(yDelta?.count || 0)
              const yAcv = Math.abs(yDelta?.acv || 0)
              const lwCnt = Math.abs(lwDelta?.count || 0)
              const lwAcv = Math.abs(lwDelta?.acv || 0)

              const yTitle = `Lost / Removed · since yesterday (${yCnt} ${yCnt === 1 ? 'deal' : 'deals'} · ${acvM(yAcv)})`
              const lwTitle = `Lost / Removed · since last week (${lwCnt} ${lwCnt === 1 ? 'deal' : 'deals'} · ${acvM(lwAcv)})`

              return (
                <div className="card p-6" style={{ borderLeft: '4px solid #64748B' }}>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                          Lost / Removed
                        </h2>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] max-w-xl">
                        Deals deleted or lost since the baseline period (kept separate outside Delayed and Slippage totals).
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div
                        className={hasDeals && !isNA ? 'cursor-pointer' : 'cursor-not-allowed opacity-75'}
                        onClick={() => hasDeals && !isNA && openDealsQuery(mainTitle, { kind: 'lost', compare: 'period_start' })}
                        title={hasDeals ? 'Click to view lost/removed deals' : '0 deals'}
                      >
                        <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                          Deals Removed
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className={`text-xl font-black text-[var(--text-primary)] tabular-nums ${hasDeals && !isNA ? 'hover:underline' : ''}`}>
                            {isNA ? 'n/a' : acvM(acvVal)}
                          </span>
                          <Pill color="slate">{isNA ? 'n/a' : `${cnt} deals`}</Pill>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {renderSubBox('Since yesterday', yDelta, yDateStr, () => openDealsQuery(yTitle, { kind: 'lost', compare: 'yesterday' }), yTitle, false)}
                        {renderSubBox('Since last week', lwDelta, lwDateStr, () => openDealsQuery(lwTitle, { kind: 'lost', compare: 'last_week' }), lwTitle, false)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Sub-line for Deleted / lost in snapshot */}
            {(() => {
              const blankCat = cats['Blank'] ?? { count: 0, acv: 0 }
              if (blankCat.count === 0 && (!blankCat.acv || blankCat.acv === 0)) return null
              return (
                <div
                  className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => openDealsQuery(`Deleted / lost in snapshot Deals (${blankCat.count} deals · ${acvM(blankCat.acv)})`, { category: 'Blank' }, { forecast_category: 'Blank' })}
                  title="Click to view Deleted / lost in snapshot deals"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--text-secondary)]">Deleted / lost in snapshot:</span>
                      <span className="text-xs font-bold font-mono text-[var(--text-primary)]">{acvM(blankCat.acv)}</span>
                      <span className="text-xs text-[var(--text-muted)]">({blankCat.count} deals)</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]">Deals marked deleted or lost in this snapshot file (counted in snapshot total)</span>
                  </div>
                  <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline">
                    View deleted / lost in snapshot deals →
                  </span>
                </div>
              )
            })()}
          </div>
        )
      })()}


      {/* ── SECTION 4 – Forecast Category & Approval Movement ───────────────── */}
      <div id="overview-movements" className="card p-6 scroll-mt-24">
        <MovementsSummary
          movements={movements}
          compareMode={movCompare}
          onCompareChange={setMovCompare}
          onSelectDeals={(title, deals) => setModal({ title, deals })}
        />
      </div>

      {/* ── SECTION 6 – Proposal Confirmation ───────────────────────────────── */}
      <div id="overview-proposal-confirmation" className="card p-6 space-y-4 scroll-mt-24">
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
      <div id="overview-regional-trend" className="card p-6 space-y-4 scroll-mt-24">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-base text-[var(--text-primary)]">Regional Trend</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">ACV values in $M</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)]">Region</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)]">Total ACV Value</th>
                {trendFcCols.map(fc => (
                  <th key={fc} className="text-right px-4 py-3 font-semibold" style={{ color: FORECAST_COLORS[fc] }}>
                    {fc === 'Blank' ? 'Deleted / lost in snapshot' : getForecastCategoryLabel(fc)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {trendRows.map((row: any) => (
                <tr key={row.region} className="hover:bg-[var(--bg-secondary)] transition-colors">
                  <td className="px-4 py-3 font-medium cursor-pointer hover:underline" onClick={() => openDealsQuery(`${row.region} Deals (${acvM(row.total_acv)})`, { region: row.region }, { sub_region: row.region })}>{row.region}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold cursor-pointer hover:underline text-[var(--brand-teal)]" onClick={() => openDealsQuery(`${row.region} Total (${acvM(row.total_acv)})`, { region: row.region }, { sub_region: row.region })}>{acvM(row.total_acv)}</td>
                  {trendFcCols.map(fc => {
                    const k = fc.toLowerCase().replace(' ', '_') + '_acv'
                    const val = row[k] ?? 0
                    return (
                      <td
                        key={fc}
                        className="px-4 py-3 text-right font-mono cursor-pointer hover:underline"
                        style={{ color: FORECAST_COLORS[fc] }}
                        onClick={() => openDealsQuery(`${row.region} · ${fc === 'Blank' ? 'Deleted / lost in snapshot' : getForecastCategoryLabel(fc)} (${acvM(val)})`, { region: row.region, category: fc }, { sub_region: row.region, forecast_category: fc })}
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
                {trendFcCols.map(fc => {
                  const k = fc.toLowerCase().replace(' ', '_') + '_acv'
                  const val = regTotals[k] ?? 0
                  return (
                    <td
                      key={fc}
                      className="px-4 py-3 text-right font-mono cursor-pointer hover:underline"
                      style={{ color: FORECAST_COLORS[fc] }}
                      onClick={() => openDealsQuery(`Total · ${fc === 'Blank' ? 'Deleted / lost in snapshot' : getForecastCategoryLabel(fc)} (${acvM(val)})`, { category: fc }, { forecast_category: fc })}
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
