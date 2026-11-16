import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Globe2,
  AlertOctagon,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  ArrowUpDown,
  TrendingUp,
  Clock,
  ShieldCheck,
  Building2,
  Calendar,
  CalendarX2,
  PieChart,
  Lightbulb,
  ExternalLink,
  MousePointerClick,
  Check,
  ArrowUp
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import api from '@/api/client'
import { formatACV, formatCount } from '@/utils/format'
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
import { getRegionColor, CONCEPT_COLORS } from '@/design/conceptColors'
import CardRow from '@/components/common/CardRow'
import ScrollList from '@/components/common/ScrollList'
import InsightCard from '@/components/common/InsightCard'
import ChartCard from '@/components/common/ChartCard'
import { getRegionsMatrixInsights, getRegionDeepDiveInsights } from '@/insights/generators'

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')

type MetricMode = 'Amount' | 'Count' | 'Both'

const ALL_FC = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
const FUNNEL_STAGES = ['Approved', 'Pending Approval', 'Not submitted']

function RegionsContent() {
  const { activeSnapshotId } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode

  const [compare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  
  // Drill-through state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<any>({})
  
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)
  const [topSearch, setTopSearch] = useState('')
  const [moveCompare, setMoveCompare] = useState<'yesterday' | 'last_week'>('yesterday')

  // Sorting state for Region Comparison Table
  const [sortCol, setSortCol] = useState<string>('acv')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Fetch Summary
  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ['v2-regions-summary', activeSnapshotId, compare],
    queryFn: async () => {
      const res = await api.get('/v2/regions/summary', {
        params: { as_of: activeSnapshotId ?? undefined, compare }
      })
      return res.data
    },
  })

  // Fetch Selected Region details if a region is selected
  const { data: regionDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ['v2-regions-detail', activeSnapshotId, selectedRegion],
    queryFn: async () => {
      if (!selectedRegion) return null
      const res = await api.get(`/v2/regions/${selectedRegion}/summary`, {
        params: { as_of: activeSnapshotId ?? undefined }
      })
      return res.data
    },
    enabled: Boolean(selectedRegion)
  })

  // Fetch Movements for selected region
  const { data: movementsData } = useQuery({
    queryKey: ['v2-regions-movements', activeSnapshotId, selectedRegion, moveCompare],
    queryFn: async () => {
      if (!selectedRegion) return null
      const res = await api.get(`/v2/regions/${selectedRegion}/movements`, {
        params: { as_of: activeSnapshotId ?? undefined, compare: moveCompare }
      })
      return res.data
    },
    enabled: Boolean(selectedRegion)
  })

  // Fetch Top Opps for selected region
  const { data: topOppsData } = useQuery({
    queryKey: ['v2-regions-top', activeSnapshotId, selectedRegion],
    queryFn: async () => {
      if (!selectedRegion) return null
      const res = await api.get(`/v2/regions/${selectedRegion}/top-opportunities`, {
        params: { as_of: activeSnapshotId ?? undefined }
      })
      return res.data
    },
    enabled: Boolean(selectedRegion)
  })

  // Fetch Deals for Modal
  const { data: dealsData } = useQuery({
    queryKey: ['v2-regions-deals', activeSnapshotId, modalFilters],
    queryFn: async () => {
      const res = await api.get('/v2/regions/deals', {
        params: { as_of: activeSnapshotId ?? undefined, ...modalFilters }
      })
      return res.data
    },
    enabled: modalOpen && !modalFilters.deals
  })

  // Sorted region comparison table rows
  const sortedRegions = useMemo(() => {
    if (!summary?.regions) return []
    const list = [...summary.regions].filter(Boolean)
    list.sort((a: any, b: any) => {
      let vA: any = a?.[sortCol]
      let vB: any = b?.[sortCol]
      if (sortCol === 'delta_yesterday') {
        vA = a?.delta_yesterday?.acv ?? 0
        vB = b?.delta_yesterday?.acv ?? 0
      } else if (sortCol === 'delta_lastweek') {
        vA = a?.delta_lastweek?.acv ?? 0
        vB = b?.delta_lastweek?.acv ?? 0
      }
      if (typeof vA === 'string' || typeof vB === 'string') {
        return sortDir === 'asc' 
          ? String(vA ?? '').localeCompare(String(vB ?? '')) 
          : String(vB ?? '').localeCompare(String(vA ?? ''))
      }
      return sortDir === 'asc' ? (Number(vA) || 0) - (Number(vB) || 0) : (Number(vB) || 0) - (Number(vA) || 0)
    })
    return list
  }, [summary?.regions, sortCol, sortDir])

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  const regionsSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (summary?.regions && summary.regions.length > 0) {
      list.push({ id: 'regions-tiles', title: 'Regional Overview' })
    }
    if (selectedRegion) {
      list.push({ id: 'regions-deep-dive', title: `${selectedRegion} Deep Dive` })
    }
    if (summary?.regions && summary.regions.length > 0) {
      list.push({ id: 'regions-matrix', title: 'Comparison Matrix' })
    }
    return list
  }, [summary?.regions, selectedRegion])

  if (!activeSnapshotId) {
    return <PageNoSnapshotState />
  }

  if (error || (summary && summary.error)) {
    return <PageErrorState message={error ? error.message : (summary?.error || "Couldn't load this page. Try again")} onRetry={() => refetch()} />
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!summary || !summary.regions) {
    return <PageNoSnapshotState />
  }

  const { data_slice, yesterday_date, lastweek_date, regions, unmapped } = summary

  const handleDrill = (title: string, filters: any) => {
    setModalTitle(title)
    setModalFilters(filters)
    setModalOpen(true)
  }

  const renderDelta = (countDelta?: number | null, acvDelta?: number | null, isLastWeek: boolean = false) => {
    const label = isLastWeek ? 'vs last week' : 'vs yesterday'
    if (countDelta === null || countDelta === undefined || acvDelta === null || acvDelta === undefined) {
      return (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] opacity-60">
          <span>{label}</span>
          <span className="tabular-nums text-slate-400 dark:text-slate-500 font-normal">n/a</span>
        </div>
      )
    }

    const val = metricMode === 'Count' ? countDelta : acvDelta
    if (val === 0) {
      return (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] opacity-60">
          <span>{label}</span>
          <span className="tabular-nums">—</span>
        </div>
      )
    }

    const isPos = val > 0
    const color = isPos ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 dark:text-rose-400 font-medium'

    let text = ''
    if (metricMode === 'Amount') {
      text = (isPos ? '+' : '') + formatACV(acvDelta)
    } else if (metricMode === 'Count') {
      text = (isPos ? '+' : '') + formatCount(countDelta)
    } else {
      text = `${isPos ? '+' : ''}${formatCount(countDelta)} · ${isPos ? '+' : ''}${formatACV(acvDelta)}`
    }

    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)] font-normal">{label}</span>
        <span className={`tabular-nums ${color}`}>{text}</span>
      </div>
    )
  }

  const formatUI = (dstr: string | null, fb: string) => dstr ? new Date(dstr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fb
  const yDayStr = formatUI(yesterday_date, 'yesterday')
  const lwStr = formatUI(lastweek_date, 'last week')

  const knownRegions = ["North America", "LATAM", "Middle East and North Africa", "APAC", "Europe", "Africa"]
  const presentRegions = (regions || []).map((r: any) => r?.region).filter(Boolean)
  const otherRegions = presentRegions.filter((r: string) => !knownRegions.includes(r) && r !== 'Other' && r !== 'Other / Unmapped')
  const unmappedRegions = presentRegions.filter((r: string) => r === 'Other' || r === 'Other / Unmapped')
  const tileOrder = [...knownRegions, ...otherRegions, ...unmappedRegions]
  // Generate Insight Lines
  const getInsightLines = () => {
    if (!summary || !summary.regions || summary.regions.length === 0) return []
    const lines: string[] = []
    
    const deltaKey = compare === 'yesterday' ? 'delta_yesterday' : 'delta_lastweek'
    const validRegions = (summary.regions || []).filter((r: any) => r && r.region !== 'Other')
    if (validRegions.length === 0) return []

    const sorted = [...validRegions].sort((a: any, b: any) => {
      const aDelta = a?.[deltaKey]
      const bDelta = b?.[deltaKey]
      const aVal = metricMode === 'Count' ? (aDelta?.count ?? 0) : (aDelta?.acv ?? 0)
      const bVal = metricMode === 'Count' ? (bDelta?.count ?? 0) : (bDelta?.acv ?? 0)
      return bVal - aVal
    })
    
    if (sorted.length > 0) {
      const best = sorted[0]
      const bestDelta = best?.[deltaKey]
      if (bestDelta) {
        const bestVal = metricMode === 'Count' ? (bestDelta.count ?? 0) : (bestDelta.acv ?? 0)
        if (bestVal > 0) {
          const valStr = metricMode === 'Amount' 
            ? '+' + formatACV(bestVal) 
            : metricMode === 'Count' 
            ? '+' + formatCount(bestVal) 
            : `+${formatCount(bestDelta.count ?? 0)} · +${formatACV(bestDelta.acv ?? 0)}`
          lines.push(`${best.region || 'Region'} gained ${valStr} vs ${compare === 'yesterday' ? yDayStr : lwStr}, the largest regional gain`)
        }
      }
    }
    return lines
  }
  
  const insightLines = getInsightLines()

  return (
    <div className="space-y-6 pb-20">
      <SectionNav sections={regionsSections} />

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl border border-blue-500/20 shadow-sm">
            <Globe2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Regions</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
              <span>{data_slice}</span>
              <span>•</span>
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs font-medium">YDay: {yDayStr}</span>
              <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs font-medium">Wk: {lwStr}</span>
            </p>
          </div>
        </div>
        <MetricToggle />
      </div>

      <ExcludedTypesNote
        excluded={summary?.other_types_excluded}
        onViewDeals={() => handleDrill('Other Types Excluded', { kind: 'other_types' })}
      />

      {unmapped?.count > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-400">
            <AlertOctagon className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">
              {unmapped.count} deals have an unmapped region: {unmapped.values.join(', ')}
            </span>
          </div>
          <button 
            onClick={() => handleDrill('Unmapped Region Deals', { region: 'Other' })}
            className="text-sm font-medium text-amber-600 dark:text-amber-500 hover:underline"
          >
            View deals →
          </button>
        </div>
      )}

      {(!isLoading && (summary?.total?.count ?? 0) === 0) && (
        <div className="card p-8 text-center text-sm text-[var(--text-muted)]">
          No deals for this selection
        </div>
      )}

      {/* Top Territory Overview Bar */}
      <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div>
          <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Top Region</span>
          <span className="font-bold text-[var(--text-primary)]">
            {summary.regions?.[0]?.region || '—'} ({formatACV(summary.regions?.[0]?.acv || 0)})
          </span>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Active Territories</span>
            <span className="font-bold text-[var(--text-primary)] tabular-nums">
              {summary.regions?.length || 0} regions
            </span>
          </div>
          <div className="h-5 w-px bg-[var(--border)] hidden sm:block" />
          <button
            onClick={() => handleDrill(`All Regions (${data_slice})`, {})}
            className="text-[var(--brand-teal)] hover:underline font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
          >
            View all deals ({formatCount(summary?.total?.count ?? 0)}) →
          </button>
        </div>
      </div>

      {/* 3 Region Tiles per row */}
      <div id="regions-tiles" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 scroll-mt-24">
        {tileOrder.map(rname => {
          const reg = regions.find((r: any) => r.region === rname)
          if (!reg) return null
          const isSelected = selectedRegion === rname
          const regColor = getRegionColor(rname)
          
          return (
            <Tile
              key={rname}
              title={rname}
              accentColor={regColor}
              amount={
                metricMode === 'Count' ? formatCount(reg.count) : 
                metricMode === 'Amount' ? formatACV(reg.acv) : 
                `${formatCount(reg.count)} · ${formatACV(reg.acv)}`
              }
              count={`${reg.pct_acv}%`}
              dealsLabel="share"
              isSelected={isSelected}
              className="hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer"
              badge={isSelected ? (
                <span
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border"
                  style={{ backgroundColor: `${regColor}20`, color: regColor, borderColor: `${regColor}40` }}
                >
                  <Check className="w-3 h-3" /> Selected
                </span>
              ) : undefined}
              onClick={() => {
                if (isSelected) {
                  setSelectedRegion(null)
                } else {
                  setSelectedRegion(rname)
                  setTimeout(() => {
                    document.getElementById('regions-deep-dive')?.scrollIntoView({ behavior: 'smooth' })
                  }, 60)
                }
              }}
              onDealsClick={(e) => {
                e.stopPropagation()
                handleDrill(`${rname} Deals`, { region: rname })
              }}
              viewDealsText="View deals →"
              footer={
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="font-semibold text-xs flex items-center gap-1 text-[var(--brand-teal)]">
                    Details ↓
                  </span>
                </div>
              }
              deltaYesterday={{ count: reg.delta_yesterday?.count, acv: reg.delta_yesterday?.acv }}
              deltaLastWeek={{ count: reg.delta_lastweek?.count, acv: reg.delta_lastweek?.acv }}
            />
          )
        })}
      </div>

      {/* Callout chip with down arrow directly under the tiles row */}
      <div className="flex justify-center my-2">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-medium shadow-xs">
          <MousePointerClick className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>Click a region to see its details below</span>
          <span className="text-blue-500 font-bold">↓</span>
        </div>
      </div>

      {/* SELECTED REGION DEEP DIVE */}
      {selectedRegion && (
        <div id="regions-deep-dive" className="space-y-6 scroll-mt-24">
          <Card className="p-6 border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
            {/* Header with Title and Quick Exit */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800 gap-3">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedRegion} Deep Dive
                  </h2>
                  <p className="text-xs text-gray-500">Comprehensive regional breakdown and performance indicators</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedRegion(null)
                  document.getElementById('regions-tiles')?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[var(--text-primary)] transition-colors flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
                title="Return to regional tiles summary"
              >
                <ArrowUp className="w-3.5 h-3.5 text-[var(--brand-teal)]" />
                <span>↑ Back to regions</span>
              </button>
            </div>

            {/* Top Stat Cards */}
            {regionDetail && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {/* 1. Region ACV & Deals */}
                <Tile
                  title="Total ACV"
                  tone="total"
                  amount={formatACV(regionDetail.acv)}
                  count={regionDetail.count}
                  dealsLabel="deals"
                  subtitle={`${regionDetail.pct_acv}% of portfolio`}
                  onClick={() => handleDrill(`${selectedRegion} Deals`, { region: selectedRegion })}
                  viewDealsText="View deals →"
                  deltaYesterday={{ count: regionDetail.delta_yesterday?.count, acv: regionDetail.delta_yesterday?.acv }}
                  deltaLastWeek={{ count: regionDetail.delta_lastweek?.count, acv: regionDetail.delta_lastweek?.acv }}
                />

                {/* 2. Commit Coverage & Portfolio Gap */}
                <Tile
                  title="Commit Coverage"
                  tone="commit"
                  amount={`${regionDetail.commit_pct}%`}
                  subtitle={`Portfolio: ${regionDetail.commit_coverage?.portfolio_pct}%`}
                  badge={
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      (regionDetail.commit_coverage?.gap || 0) >= 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      {(regionDetail.commit_coverage?.gap || 0) >= 0 ? '+' : ''}{regionDetail.commit_coverage?.gap} pts
                    </span>
                  }
                  onClick={() => handleDrill(`${selectedRegion} Commit Coverage Deals`, { region: selectedRegion, categories: 'Commit,Closed' })}
                  viewDealsText="View deals →"
                  footer={<div className="text-[11px] text-[var(--text-muted)]">Closed + Commit ACV</div>}
                />

                {/* 3. Approved % & Portfolio Gap */}
                <Tile
                  title="Approved Status"
                  tone="approved"
                  amount={`${regionDetail.approved_pct}%`}
                  subtitle={`Portfolio: ${regionDetail.approved_pct_detail?.portfolio_pct}%`}
                  badge={
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      (regionDetail.approved_pct_detail?.gap || 0) >= 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}>
                      {(regionDetail.approved_pct_detail?.gap || 0) >= 0 ? '+' : ''}{regionDetail.approved_pct_detail?.gap} pts
                    </span>
                  }
                  onClick={() => handleDrill(`${selectedRegion} Approved Deals`, { region: selectedRegion, status: 'Approved' })}
                  viewDealsText="View deals →"
                  footer={<div className="text-[11px] text-[var(--text-muted)]">Formal opportunity approvals</div>}
                />

                {/* 4. Delayed Renewals Tile */}
                <Tile
                  title="Delayed"
                  tone="delayed"
                  amount={formatACV(regionDetail.delayed_acv || 0)}
                  count={regionDetail.delayed_count || 0}
                  dealsLabel="deals"
                  subtitle="Service start in past"
                  onClick={() => handleDrill(`${selectedRegion} Delayed Renewals`, { region: selectedRegion, kind: 'delayed' })}
                  viewDealsText="View deals →"
                />

                {/* 5. Slippage Tile */}
                <Tile
                  title="Slippage"
                  tone="slippage"
                  amount={formatACV(regionDetail.slippage_acv || 0)}
                  count={regionDetail.slippage_count || 0}
                  dealsLabel="deals"
                  subtitle="Close slipped to next year"
                  onClick={() => handleDrill(`${selectedRegion} Slippage Deals`, { region: selectedRegion, kind: 'slippage' })}
                  viewDealsText="View deals →"
                />
              </div>
            )}

            {/* Plain-Language Insights Box */}
            {regionDetail && regionDetail.insights && regionDetail.insights.length > 0 && (
              <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/10 border border-blue-200/60 dark:border-blue-900/40 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                    Regional Insights & Signals
                  </span>
                  {regionDetail.concentration && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium">
                      {regionDetail.concentration.summary_text}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {regionDetail.insights.map((ins: string, idx: number) => (
                    <div key={idx} className="flex items-start gap-2 bg-white/80 dark:bg-gray-900/60 p-2.5 rounded-lg border border-blue-100/60 dark:border-blue-900/30 text-xs text-gray-800 dark:text-gray-200">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                      <span>{ins}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reorganized into 4 balanced equal-height rows */}
            <div className="space-y-6 pt-2">
              {/* ROW 1: [Forecast Category Breakdown | Top 10 Accounts by ACV] */}
              <CardRow cols="1fr 1fr" gap="gap-6">
                {/* 1. Forecast Category Split Table */}
                <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        Forecast Category Breakdown
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">% of {selectedRegion} ACV</span>
                    </div>
                    <ScrollList maxHeight="280px">
                      <table className="w-full text-left text-xs data-table">
                        <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-medium border-b border-[var(--border-subtle)] sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Category</th>
                            <th className="py-2 px-3 text-right">Deals</th>
                            <th className="py-2 px-3 text-right">ACV</th>
                            <th className="py-2 px-3 text-right">% Region ACV</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {regionDetail?.forecast_categories?.map((fc: any) => (
                            <tr 
                              key={fc.category}
                              onClick={() => handleDrill(`${selectedRegion} - ${fc.category}`, { region: selectedRegion, category: fc.category })}
                              className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                            >
                              <td className="py-2 px-3 font-medium text-[var(--text-primary)] group-hover:text-blue-600">
                                {fc.category}
                              </td>
                              <td className="py-2 px-3 text-right text-[var(--text-secondary)] font-mono">
                                {formatCount(fc.count)}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)] font-mono">
                                {formatACV(fc.acv)}
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-blue-600 dark:text-blue-400 font-mono">
                                {fc.pct_acv}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {regionDetail && (
                          <tfoot className="bg-[var(--bg-secondary)] font-bold border-t border-[var(--border)] sticky bottom-0">
                            <tr>
                              <td className="py-2 px-3 text-[var(--text-primary)]">Total</td>
                              <td className="py-2 px-3 text-right font-mono">{formatCount(regionDetail.count)}</td>
                              <td className="py-2 px-3 text-right font-mono">{formatACV(regionDetail.acv)}</td>
                              <td className="py-2 px-3 text-right font-mono">100.0%</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </ScrollList>
                  </div>
                </div>

                {/* 2. Top 10 Accounts by ACV */}
                <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        Top 10 Accounts by ACV
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">Account concentration</span>
                    </div>
                    <ScrollList maxHeight="280px">
                      <table className="w-full text-left text-xs data-table">
                        <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-medium border-b border-[var(--border-subtle)] sticky top-0">
                          <tr>
                            <th className="py-2 px-2.5 w-8">#</th>
                            <th className="py-2 px-3">Account</th>
                            <th className="py-2 px-3 text-right">Deals</th>
                            <th className="py-2 px-3 text-right">ACV</th>
                            <th className="py-2 px-3 text-right">% Share</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {regionDetail?.top_accounts?.map((acc: any, i: number) => (
                            <tr 
                              key={acc.account_name}
                              onClick={() => handleDrill(`${selectedRegion} - ${acc.account_name}`, { region: selectedRegion, account_name: acc.account_name })}
                              className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                            >
                              <td className="py-2 px-2.5 text-[var(--text-muted)] font-bold">{i + 1}</td>
                              <td className="py-2 px-3 font-medium text-[var(--text-primary)] truncate max-w-[180px] group-hover:text-blue-600">
                                {acc.account_name}
                              </td>
                              <td className="py-2 px-3 text-right text-[var(--text-secondary)] font-mono">
                                {formatCount(acc.count)}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)] font-mono">
                                {formatACV(acc.acv)}
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-blue-600 dark:text-blue-400 font-mono">
                                {acc.pct_acv}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollList>
                  </div>
                </div>
              </CardRow>

              {/* ROW 2: [Approval Status Breakdown | Business Unit Mix & Share] */}
              <CardRow cols="1fr 1fr" gap="gap-6">
                {/* 3. Approval Status Split Table */}
                <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        Approval Status Breakdown
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">Governance flow</span>
                    </div>
                    <ScrollList maxHeight="280px">
                      <table className="w-full text-left text-xs data-table">
                        <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-medium border-b border-[var(--border-subtle)] sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Approval Status</th>
                            <th className="py-2 px-3 text-right">Deals</th>
                            <th className="py-2 px-3 text-right">ACV</th>
                            <th className="py-2 px-3 text-right">% Region ACV</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {regionDetail?.approval_statuses?.map((st: any) => (
                            <tr 
                              key={st.status}
                              onClick={() => handleDrill(`${selectedRegion} - ${st.status}`, { region: selectedRegion, status: st.status })}
                              className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                            >
                              <td className="py-2 px-3 font-medium text-[var(--text-primary)] group-hover:text-blue-600">
                                {st.status}
                              </td>
                              <td className="py-2 px-3 text-right text-[var(--text-secondary)] font-mono">
                                {formatCount(st.count)}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)] font-mono">
                                {formatACV(st.acv)}
                              </td>
                              <td className="py-2 px-3 text-right font-medium text-blue-600 dark:text-blue-400 font-mono">
                                {st.pct_acv}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollList>
                  </div>
                </div>

                {/* 4. Top Business Units with Share */}
                <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">
                        Business Unit Mix & Share
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">By contribution</span>
                    </div>
                    <ScrollList maxHeight="280px">
                      <div className="space-y-2.5">
                        {regionDetail?.business_units?.map((bu: any) => {
                          const pct = bu.share_pct ?? (regionDetail.acv > 0 ? Math.round((bu.acv / regionDetail.acv) * 100) : 0)
                          return (
                            <div 
                              key={bu.bu}
                              className="cursor-pointer group p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
                              onClick={() => handleDrill(`${selectedRegion} - ${bu.bu}`, { region: selectedRegion, bu: bu.bu })}
                            >
                              <div className="flex justify-between text-xs mb-1">
                                <span className="font-semibold text-[var(--text-primary)] group-hover:text-blue-600 transition-colors">
                                  {bu.bu}
                                </span>
                                <span className="text-[var(--text-muted)] font-medium font-mono">
                                  {formatCount(bu.count)} deals • {formatACV(bu.acv)} ({pct}%)
                                </span>
                              </div>
                              <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all group-hover:from-blue-400 group-hover:to-indigo-400"
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollList>
                  </div>
                </div>
              </CardRow>

              {/* ROW 3: [Expiry Schedule by Quarter | What Changed vs Prior Snapshot] (F1-F5) */}
              <CardRow cols="1fr 1fr" gap="gap-6">
                {/* 5. Expiry Schedule by Quarter */}
                {(() => {
                  const quartersShown = regionDetail?.expiry_quarters?.length || 0
                  const totalDeals = regionDetail?.expiry_quarters?.reduce((s: number, q: any) => s + (q.count || 0), 0) || regionDetail?.count || 0
                  const totalAcv = regionDetail?.expiry_quarters?.reduce((s: number, q: any) => s + (q.acv || 0), 0) || regionDetail?.acv || 0
                  const closedAcv = regionDetail?.categories?.find((c: any) => c.category === 'Closed')?.acv || 0
                  const closedShare = regionDetail?.acv > 0 ? ((closedAcv / regionDetail.acv) * 100).toFixed(1) : '0.0'
                  const commitCoverage = regionDetail?.commit_pct ?? (regionDetail?.acv > 0 ? (((closedAcv + (regionDetail?.categories?.find((c: any) => c.category === 'Commit')?.acv || 0)) / regionDetail.acv) * 100).toFixed(1) : '0.0')

                  return (
                    <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-3 shrink-0">
                          <h3 className="text-sm font-bold text-[var(--text-primary)]">
                            Expiry Schedule by Quarter
                          </h3>
                          <span className="text-xs text-[var(--text-muted)]">Service period schedule</span>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto">
                          <table className="w-full text-left text-xs data-table">
                            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-medium border-b border-[var(--border-subtle)] sticky top-0">
                              <tr>
                                <th className="py-2 px-3">Quarter</th>
                                <th className="py-2 px-3 text-right">Deals</th>
                                <th className="py-2 px-3 text-right">ACV</th>
                                <th className="py-2 px-3 text-right">% Region ACV</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border-subtle)]">
                              {regionDetail?.expiry_quarters?.map((eq: any) => (
                                <tr 
                                  key={eq.quarter}
                                  onClick={() => handleDrill(`${selectedRegion} - ${eq.quarter}`, { region: selectedRegion, quarter: eq.quarter })}
                                  className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                                >
                                  <td className="py-2 px-3 font-medium text-[var(--text-primary)] group-hover:text-blue-600">
                                    {eq.quarter}
                                  </td>
                                  <td className="py-2 px-3 text-right text-[var(--text-secondary)] font-mono">
                                    {formatCount(eq.count)}
                                  </td>
                                  <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)] font-mono">
                                    {formatACV(eq.acv)}
                                  </td>
                                  <td className="py-2 px-3 text-right font-medium text-blue-600 dark:text-blue-400 font-mono">
                                    {eq.pct_acv}%
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Stat strip under table (F2) */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 mt-2 border-t border-[var(--border-subtle)] text-[11px] shrink-0">
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Quarters / Deals</span>
                            <span className="font-bold text-[var(--text-primary)] font-mono">{quartersShown} Qtrs · {formatCount(totalDeals)}</span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Total Expiry ACV</span>
                            <span className="font-bold text-[var(--text-primary)] font-mono">{formatACV(totalAcv)}</span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Closed Share</span>
                            <span className="font-bold text-teal-600 dark:text-teal-400 font-mono">{closedShare}%</span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Commit Coverage</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400 font-mono">{commitCoverage}%</span>
                          </div>
                        </div>

                        {/* Category distribution summary (Period Category Distribution) */}
                        {regionDetail?.forecast_categories && regionDetail.forecast_categories.length > 0 && (
                          <div className="pt-2.5 mt-2 border-t border-[var(--border-subtle)] shrink-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Period Category Distribution</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {regionDetail.forecast_categories
                                .filter((c: any) => ['Closed', 'Commit', 'Best Case', 'Pipeline'].includes(c.category))
                                .map((c: any) => {
                                  const catMax = Math.max(...regionDetail.forecast_categories.map((x: any) => x.acv || 0), 1)
                                  const pct = catMax > 0 ? ((c.acv || 0) / catMax) * 100 : 0
                                  const color = c.category === 'Closed' ? '#00A3AD' : c.category === 'Commit' ? '#1B365D' : c.category === 'Best Case' ? '#4B6B94' : '#F58220'
                                  return (
                                    <div key={c.category} className="p-2 rounded bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)] flex flex-col justify-between">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                        <span className="text-[11px] font-semibold text-[var(--text-secondary)] truncate">{c.category}</span>
                                      </div>
                                      <div className="text-xs font-bold font-mono text-[var(--text-primary)] tabular-nums mb-1.5">
                                        {formatACV(c.acv)}
                                      </div>
                                      <div className="h-1.5 w-full bg-[var(--border-subtle)] rounded-full overflow-hidden">
                                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(c.acv > 0 ? 8 : 0, pct)}%`, backgroundColor: color }} />
                                      </div>
                                    </div>
                                  )
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* 6. What Changed vs Prior Snapshot */}
                {(() => {
                  const netChange = movementsData?.net_acv_change ?? ((movementsData?.positive_moves?.reduce((s: number, m: any) => s + (m.acv || 0), 0) || 0) - (movementsData?.negative_moves?.reduce((s: number, m: any) => s + (m.acv || 0), 0) || 0))
                  const newDealsCount = movementsData?.new_to_slice?.count || 0
                  const leftDealsCount = movementsData?.left_slice?.count || movementsData?.slipped_out?.count || 0
                  const catMovesCount = movementsData?.category_moves?.length || 0
                  const appMovesCount = movementsData?.approval_moves?.length || 0

                  const catMovesByCat = (movementsData?.category_moves || []).reduce((acc: any, m: any) => {
                    if (m.to_category) acc[m.to_category] = (acc[m.to_category] || 0) + (m.acv || 0)
                    if (m.from_category) acc[m.from_category] = (acc[m.from_category] || 0) - (m.acv || 0)
                    return acc
                  }, {})
                  const divergingData = Object.entries(catMovesByCat).map(([cat, val]: [string, any]) => ({
                    label: cat,
                    value: val,
                  })).filter(d => d.value !== 0)
                  const maxDivergingAbs = Math.max(...divergingData.map(d => Math.abs(d.value)), 1)

                  return (
                    <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-3 shrink-0">
                          <h3 className="text-sm font-bold text-[var(--text-primary)]">What Changed vs Prior Snapshot</h3>
                          <div className="flex bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border)]">
                            <button
                              onClick={() => setMoveCompare('yesterday')}
                              className={cn(
                                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                                moveCompare === 'yesterday' ? "bg-[var(--bg-card)] shadow-xs text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              )}
                            >
                              Vs YDay
                            </button>
                            <button
                              onClick={() => setMoveCompare('last_week')}
                              className={cn(
                                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                                moveCompare === 'last_week' ? "bg-[var(--bg-card)] shadow-xs text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                              )}
                            >
                              Vs 7d
                            </button>
                          </div>
                        </div>

                        {!movementsData ? (
                          <div className="h-24 flex items-center justify-center my-auto">
                            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                            {movementsData.category_moves.map((m: any, i: number) => (
                              <div 
                                key={`c-${i}`} 
                                className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors border border-[var(--border-subtle)] text-xs"
                                onClick={() => handleDrill(`Moved ${m.from_category} → ${m.to_category}`, { region: selectedRegion, deals: m.deals })}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium px-2 py-0.5 bg-[var(--bg-secondary)] rounded">{m.from_category}</span>
                                  <span className="text-[var(--text-muted)]">→</span>
                                  <span className="font-medium px-2 py-0.5 bg-[var(--bg-secondary)] rounded">{m.to_category}</span>
                                </div>
                                <div className="font-semibold text-[var(--text-primary)] font-mono">
                                  {formatACV(m.acv)} ({formatCount(m.count)})
                                </div>
                              </div>
                            ))}
                            {movementsData.approval_moves.map((m: any, i: number) => (
                              <div 
                                key={`a-${i}`} 
                                className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg-secondary)]/50 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors border border-[var(--border-subtle)] text-xs"
                                onClick={() => handleDrill(`Moved ${m.from_status} → ${m.to_status}`, { region: selectedRegion, deals: m.deals })}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium px-2 py-0.5 bg-[var(--bg-secondary)] rounded">{m.from_status}</span>
                                  <span className="text-[var(--text-muted)]">→</span>
                                  <span className="font-medium px-2 py-0.5 bg-[var(--bg-secondary)] rounded">{m.to_status}</span>
                                </div>
                                <div className="font-semibold text-[var(--text-primary)] font-mono">
                                  {formatACV(m.acv)} ({formatCount(m.count)})
                                </div>
                              </div>
                            ))}
                            {movementsData.new_to_slice?.count > 0 && (
                              <div 
                                className="flex justify-between items-center p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 cursor-pointer transition-colors border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs"
                                onClick={() => handleDrill(`Newly In-Scope Deals`, { region: selectedRegion, deals: movementsData.new_to_slice.deals })}
                              >
                                <span className="font-semibold flex items-center gap-1">
                                  <ArrowUpRight className="w-3.5 h-3.5" /> Newly In-Scope
                                </span>
                                <span className="font-bold font-mono">
                                  {formatACV(movementsData.new_to_slice.acv)} ({formatCount(movementsData.new_to_slice.count)})
                                </span>
                              </div>
                            )}
                            {movementsData.slipped_out?.count > 0 && (
                              <div 
                                className="flex justify-between items-center p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 cursor-pointer transition-colors border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs"
                                onClick={() => handleDrill(`Slipped Out Deals`, { region: selectedRegion, deals: movementsData.slipped_out.deals })}
                              >
                                <span className="font-semibold flex items-center gap-1">
                                  <ArrowDownRight className="w-3.5 h-3.5" /> Slipped Out of Quarter
                                </span>
                                <span className="font-bold font-mono">
                                  {formatACV(movementsData.slipped_out.acv)} ({formatCount(movementsData.slipped_out.count)})
                                </span>
                              </div>
                            )}
                            {movementsData.category_moves?.length === 0 && movementsData.approval_moves?.length === 0 && (!movementsData.new_to_slice?.count) && (!movementsData.slipped_out?.count) && (
                              <div className="text-xs text-[var(--text-muted)] italic p-4 text-center my-auto">No deal movements recorded since {moveCompare === 'yesterday' ? yDayStr : lwStr}</div>
                            )}
                          </div>
                        )}

                        {/* Stat strip (F2) */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 mt-2 border-t border-[var(--border-subtle)] text-[11px] shrink-0">
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Net ACV Change</span>
                            <span className={clsx("font-bold font-mono", netChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                              {netChange >= 0 ? `+${formatACV(netChange)}` : `-${formatACV(Math.abs(netChange))}`}
                            </span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Deals In / Out</span>
                            <span className="font-bold text-[var(--text-primary)] font-mono">+{newDealsCount} / -{leftDealsCount}</span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Category Shifts</span>
                            <span className="font-bold text-[var(--text-primary)] font-mono">{catMovesCount}</span>
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-secondary)]/50">
                            <span className="text-[var(--text-muted)] block text-[10px]">Approval Shifts</span>
                            <span className="font-bold text-[var(--text-primary)] font-mono">{appMovesCount}</span>
                          </div>
                        </div>

                        {/* Diverging bar chart of change by category (F3, F7) */}
                        {divergingData.length > 0 && (
                          <div className="pt-2 shrink-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">Category Movement Profile</div>
                            <div className="space-y-1">
                              {divergingData.map((d: any) => {
                                const isPos = d.value >= 0
                                const widthPct = Math.min(50, (Math.abs(d.value) / maxDivergingAbs) * 50)
                                return (
                                  <div key={d.label} className="text-xs space-y-0.5">
                                    <div className="flex justify-between text-[10px]">
                                      <span className="font-medium text-[var(--text-secondary)]">{d.label}</span>
                                      <span className={clsx("font-bold tabular-nums", isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                        {isPos ? `+${formatACV(d.value)}` : `-${formatACV(Math.abs(d.value))}`}
                                      </span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-sm relative overflow-hidden">
                                      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400 dark:bg-slate-500 z-10" />
                                      {isPos ? (
                                        <div className="h-full bg-emerald-500 absolute left-1/2 rounded-r-sm" style={{ width: `${widthPct}%` }} />
                                      ) : (
                                        <div className="h-full bg-rose-500 absolute right-1/2 rounded-l-sm" style={{ width: `${widthPct}%` }} />
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </CardRow>

              {/* ROW 4: [Top Deals Search | Region signals] */}
              <CardRow cols="1fr 1fr" gap="gap-6">
                {/* 7. Top Deals Search */}
                <div className="card p-5 flex flex-col justify-between h-full border border-[var(--border)] shadow-xs">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-[var(--text-primary)]">Top Deals Search</h3>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search deals..."
                          value={topSearch}
                          onChange={(e) => setTopSearch(e.target.value)}
                          className="pl-8 pr-3 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
                        />
                      </div>
                    </div>

                    {!topOppsData ? (
                      <div className="h-28 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (
                      <ScrollList maxHeight="280px">
                        <div className="space-y-1.5">
                          {topOppsData
                            .filter((o: any) => o.opportunity_name?.toLowerCase().includes(topSearch.toLowerCase()) || o.account_name?.toLowerCase().includes(topSearch.toLowerCase()))
                            .map((opp: any, idx: number) => (
                              <div 
                                key={opp.id || idx}
                                onClick={() => setSelectedOppId(opp.id)}
                                className="p-2.5 bg-[var(--bg-secondary)]/50 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer border border-transparent hover:border-[var(--brand-teal)] transition-all flex items-center gap-2.5 text-xs"
                              >
                                <span className="w-5 text-center text-[var(--text-muted)] font-bold">{idx + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-[var(--text-primary)] truncate">
                                    {opp.opportunity_name}
                                  </div>
                                  <div className="text-[var(--text-muted)] truncate flex items-center gap-1.5 mt-0.5">
                                    <span>{opp.account_name}</span>
                                    <span>•</span>
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">{opp.forecast_category}</span>
                                  </div>
                                </div>
                                <span className="font-bold text-[var(--text-primary)] whitespace-nowrap font-mono">
                                  {formatACV(opp.forecast_acv_amount)}
                                </span>
                              </div>
                            ))}
                          {topOppsData.length === 0 && (
                            <div className="text-center py-6 text-[var(--text-muted)] text-xs">No opportunities found</div>
                          )}
                        </div>
                      </ScrollList>
                    )}
                  </div>
                </div>

                {/* 8. Region signals (InsightCard) */}
                <InsightCard
                  title={`${selectedRegion} signals`}
                  subtitle="Territory dynamics & governance"
                  insights={getRegionDeepDiveInsights(selectedRegion, regionDetail, summary.total?.acv || 1, (title, p) => handleDrill(title, p))}
                  className="h-full"
                  footer={
                    regionDetail?.delayed_deals?.count > 0 ? (
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--border)]">
                        <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                          {regionDetail.delayed_deals.count} delayed deals ({formatACV(regionDetail.delayed_acv || 0)})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDrill(`${selectedRegion} Delayed Deals`, { region: selectedRegion, kind: 'delayed' })}
                          className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                        >
                          View all →
                        </button>
                      </div>
                    ) : undefined
                  }
                />
              </CardRow>
            </div>
          </Card>
        </div>
      )}

      {/* REGION COMPARISON TABLE ACROSS ALL REGIONS */}
      <Card id="regions-matrix" className="p-6 border border-gray-200 dark:border-gray-700 shadow-sm space-y-4 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-blue-500" />
              Regional Comparison Matrix
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Comprehensive performance comparison across all regions. Click column headers to sort, or click any figure to open matching deals.
            </p>
          </div>
          <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 self-start sm:self-auto">
            {regions.length} regions reporting
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300 font-semibold border-b border-gray-200 dark:border-gray-700 select-none">
              <tr>
                <th 
                  onClick={() => toggleSort('region')}
                  className="sticky left-0 bg-gray-50 dark:bg-gray-900 z-20 py-3 px-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-r border-gray-200 dark:border-gray-700 shadow-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Region</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'region' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('acv')}
                  className="py-3 px-3.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>ACV</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'acv' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('count')}
                  className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Deals</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'count' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('pct_acv')}
                  className="py-3 px-3 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Share of Total</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'pct_acv' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('commit_pct')}
                  className="py-3 px-3.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Commit %</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'commit_pct' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('approved_pct')}
                  className="py-3 px-3.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Approved %</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'approved_pct' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('delayed_acv')}
                  className="py-3 px-3.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Delayed</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'delayed_acv' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('slippage_acv')}
                  className="py-3 px-3.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Slippage</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'slippage_acv' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
                <th 
                  onClick={() => toggleSort('delta_yesterday')}
                  className="py-3 px-4 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Change vs YDay</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'delta_yesterday' ? "text-blue-500" : "text-gray-400")} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-800/80">
              {sortedRegions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-[var(--text-muted)]">
                    No deals for this selection
                  </td>
                </tr>
              ) : (
                sortedRegions.map((r: any) => {
                const isSelected = selectedRegion === r.region
                const yDelta = r.delta_yesterday?.acv || 0
                const yDeltaCount = r.delta_yesterday?.count || 0
                return (
                  <tr 
                    key={r.region}
                    className={cn(
                      "transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-900/20",
                      isSelected && "bg-blue-50/80 dark:bg-blue-900/30 font-medium"
                    )}
                  >
                    {/* Region */}
                    <td className="sticky left-0 bg-white dark:bg-gray-800 z-10 py-3 px-4 border-r border-gray-200 dark:border-gray-700 shadow-xs">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedRegion(r.region)}
                          className={cn(
                            "font-semibold text-left hover:underline",
                            isSelected ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-white"
                          )}
                        >
                          {r.region}
                        </button>
                        {isSelected && (
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
                            Selected
                          </span>
                        )}
                      </div>
                    </td>

                    {/* ACV */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Deals`, { region: r.region })}
                      className="py-3 px-3.5 text-right font-bold text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 hover:underline"
                    >
                      {formatACV(r.acv)}
                    </td>

                    {/* Deals */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Deals`, { region: r.region })}
                      className="py-3 px-3 text-right text-gray-700 dark:text-gray-300 cursor-pointer hover:text-blue-600 hover:underline"
                    >
                      {formatCount(r.count)}
                    </td>

                    {/* Share of Total */}
                    <td className="py-3 px-3 text-right text-gray-600 dark:text-gray-400">
                      {r.pct_acv}%
                    </td>

                    {/* Commit % */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Commit Coverage Deals`, { region: r.region, categories: 'Commit,Closed' })}
                      className="py-3 px-3.5 text-right font-medium text-blue-600 dark:text-blue-400 cursor-pointer hover:underline"
                    >
                      {r.commit_pct}%
                    </td>

                    {/* Approved % */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Approved Deals`, { region: r.region, status: 'Approved' })}
                      className="py-3 px-3.5 text-right font-medium text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline"
                    >
                      {r.approved_pct}%
                    </td>

                    {/* Delayed */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Delayed Renewals`, { region: r.region, kind: 'delayed' })}
                      className={cn(
                        "py-3 px-3.5 text-right font-medium cursor-pointer hover:underline",
                        (r.delayed_count || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"
                      )}
                    >
                      {(r.delayed_count || 0) > 0 ? `${formatACV(r.delayed_acv || 0)} (${r.delayed_count})` : '-'}
                    </td>

                    {/* Slippage */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Slippage Deals`, { region: r.region, kind: 'slippage' })}
                      className={cn(
                        "py-3 px-3.5 text-right font-medium cursor-pointer hover:underline",
                        (r.slippage_count || 0) > 0 ? "text-purple-600 dark:text-purple-400" : "text-gray-400"
                      )}
                    >
                      {(r.slippage_count || 0) > 0 ? `${formatACV(r.slippage_acv || 0)} (${r.slippage_count})` : '-'}
                    </td>

                    {/* Change vs YDay */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Deals`, { region: r.region })}
                      className="py-3 px-4 text-right cursor-pointer hover:underline"
                    >
                      {yDelta !== 0 || yDeltaCount !== 0 ? (
                        <span className={cn(
                          "font-medium",
                          yDelta > 0 ? "text-green-600 dark:text-green-400" : yDelta < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"
                        )}>
                          {yDelta > 0 ? '+' : ''}{formatACV(yDelta)}
                          <span className="text-[11px] text-gray-500 ml-1">
                            ({yDeltaCount > 0 ? '+' : ''}{yDeltaCount})
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                )
              }))}
            </tbody>
            {/* Total / Portfolio Row */}
            <tfoot className="bg-gray-50 dark:bg-gray-900 font-bold border-t-2 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white">
              <tr>
                <td className="sticky left-0 bg-gray-50 dark:bg-gray-900 z-10 py-3 px-4 border-r border-gray-200 dark:border-gray-700 shadow-xs">
                  <div className="flex items-center gap-2">
                    <span>Portfolio Total</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      All
                    </span>
                  </div>
                </td>
                <td 
                  onClick={() => handleDrill(`All Regions Total Deals`, {})}
                  className="py-3 px-3.5 text-right cursor-pointer hover:text-blue-500 hover:underline"
                >
                  {formatACV(summary.total.acv)}
                </td>
                <td 
                  onClick={() => handleDrill(`All Regions Total Deals`, {})}
                  className="py-3 px-3 text-right cursor-pointer hover:text-blue-500 hover:underline"
                >
                  {formatCount(summary.total.count)}
                </td>
                <td className="py-3 px-3 text-right">100.0%</td>
                <td 
                  onClick={() => handleDrill(`All Regions Commit Coverage Deals`, { categories: 'Commit,Closed' })}
                  className="py-3 px-3.5 text-right text-blue-600 dark:text-blue-400 cursor-pointer hover:underline"
                >
                  {summary.total.commit_pct}%
                </td>
                <td 
                  onClick={() => handleDrill(`All Regions Approved Deals`, { status: 'Approved' })}
                  className="py-3 px-3.5 text-right text-emerald-600 dark:text-emerald-400 cursor-pointer hover:underline"
                >
                  {summary.total.approved_pct}%
                </td>
                <td 
                  onClick={() => handleDrill(`Portfolio Delayed Renewals`, { kind: 'delayed' })}
                  className={cn(
                    "py-3 px-3.5 text-right cursor-pointer hover:underline",
                    (summary.total.delayed_count || 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"
                  )}
                >
                  {(summary.total.delayed_count || 0) > 0 ? `${formatACV(summary.total.delayed_acv)} (${summary.total.delayed_count})` : '-'}
                </td>
                <td 
                  onClick={() => handleDrill(`Portfolio Slippage Deals`, { kind: 'slippage' })}
                  className={cn(
                    "py-3 px-3.5 text-right cursor-pointer hover:underline",
                    (summary.total.slippage_count || 0) > 0 ? "text-purple-600 dark:text-purple-400" : "text-gray-400"
                  )}
                >
                  {(summary.total.slippage_count || 0) > 0 ? `${formatACV(summary.total.slippage_acv)} (${summary.total.slippage_count})` : '-'}
                </td>
                <td 
                  onClick={() => handleDrill(`All Regions Total Deals`, {})}
                  className="py-3 px-4 text-right cursor-pointer hover:underline"
                >
                  {(() => {
                    const totYAcv = summary.total.delta_yesterday?.acv || 0
                    const totYCnt = summary.total.delta_yesterday?.count || 0
                    if (totYAcv === 0 && totYCnt === 0) return <span className="text-gray-400">0</span>
                    return (
                      <span className={totYAcv > 0 ? "text-green-600 dark:text-green-400" : totYAcv < 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}>
                        {totYAcv > 0 ? '+' : ''}{formatACV(totYAcv)}
                        <span className="text-[11px] text-gray-500 ml-1">
                          ({totYCnt > 0 ? '+' : ''}{totYCnt})
                        </span>
                      </span>
                    )
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Matrices */}
      <div id="regions-matrix-section" className="space-y-4 scroll-mt-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-blue-500" />
              Region Matrix
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Two-dimensional cross tabs by forecast category and approval status across regions</p>
          </div>
          <div className="flex items-center gap-2 bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border)]">
            {['Value', 'Yesterday', 'LastWeek'].map(hm => (
              <button
                key={hm}
                onClick={() => setHeatMode(hm as any)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  heatMode === hm
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                )}
              >
                {hm === 'Yesterday' ? 'vs YDay' : hm === 'LastWeek' ? 'vs 7d' : hm}
              </button>
            ))}
          </div>
        </div>

        {/* Territory Overview Strip at top of Region Matrix */}
        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Top Region</span>
            <span className="font-bold text-[var(--text-primary)]">
              {summary.regions?.[0]?.region || '—'} ({formatACV(summary.regions?.[0]?.acv || 0)})
            </span>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <span className="text-[10px] text-[var(--text-muted)] block uppercase font-medium">Active Territories</span>
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {summary.regions?.length || 0} regions
              </span>
            </div>
            <div className="h-5 w-px bg-[var(--border)] hidden sm:block" />
            <button
              onClick={() => handleDrill(`All Regions (${data_slice})`, {})}
              className="text-[var(--brand-teal)] hover:underline font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
            >
              View all deals ({formatCount(summary?.total?.count ?? 0)}) →
            </button>
          </div>
        </div>

        <CardRow cols="max-content minmax(0, 1fr)" gap="gap-6">
          {/* Stacked left column with identical numeric column widths */}
          <div className="space-y-6 w-full max-w-full">
            <div className="card p-5 border border-[var(--border)] shadow-xs">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Forecast category by region</h3>
              {(() => {
                const rawFc = summary.categories && summary.categories.length > 0 ? summary.categories : Object.keys(summary.totals?.categories || {})
                const displayFc = rawFc.filter((fc: string) => {
                  const s = summary.totals?.categories?.[fc]
                  return s ? (s.count > 0 || (s.acv != null && s.acv !== 0)) : true
                })
                return (
                  <CompactGrid
                    title="Forecast category by region"
                    rowLabelName="Region"
                    columns={displayFc}
                    columnLabels={{ 'Blank': 'Deleted / lost in snapshot' }}
                    rows={regions.map((r: any) => ({
                      label: r.region,
                      cells: r.cells,
                      total: { count: r.count, acv: r.acv }
                    }))}
                    totals={{ category: summary.totals.categories, grand: summary.total }}
                    deltas={heatMode === 'Yesterday' ? 
                      regions.reduce((acc: any, r: any) => ({...acc, [r.region]: r.delta_yesterday}), {}) :
                      heatMode === 'LastWeek' ? 
                      regions.reduce((acc: any, r: any) => ({...acc, [r.region]: r.delta_lastweek}), {}) : {}
                    }
                    metricMode={metricMode}
                    onCellClick={(rowLabel, col) => {
                      if (!col && !rowLabel) handleDrill(`All Regions`, {})
                      else if (!col) handleDrill(`${rowLabel} Deals`, { region: rowLabel })
                      else if (!rowLabel) handleDrill(`All Regions - ${col}`, { category: col })
                      else handleDrill(`${rowLabel} - ${col}`, { region: rowLabel, category: col })
                    }}
                    compareDate={compare === 'yesterday' ? summary.yesterday_date : summary.lastweek_date}
                    yesterdayDate={summary.yesterday_date}
                    lastweekDate={summary.lastweek_date}
                    hideCardWrapper={true}
                  />
                )
              })()}
            </div>

            <div className="card p-5 border border-[var(--border)] shadow-xs">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Approval status by region</h3>
              <CompactGrid
                title="Approval status by region"
                rowLabelName="Region"
                columns={FUNNEL_STAGES}
                rows={regions.map((r: any) => ({
                  label: r.region,
                  cells: r.approval,
                  total: { count: r.count, acv: r.acv }
                }))}
                totals={{ category: summary.totals.approval, grand: summary.total }}
                deltas={heatMode === 'Yesterday' ? 
                  regions.reduce((acc: any, r: any) => ({...acc, [r.region]: r.delta_yesterday}), {}) :
                  heatMode === 'LastWeek' ? 
                  regions.reduce((acc: any, r: any) => ({...acc, [r.region]: r.delta_lastweek}), {}) : {}
                }
                metricMode={metricMode}
                onCellClick={(rowLabel, col) => {
                  if (!col && !rowLabel) handleDrill(`All Regions`, {})
                  else if (!col) handleDrill(`${rowLabel} Deals`, { region: rowLabel })
                  else if (!rowLabel) handleDrill(`All Regions - ${col}`, { status: col })
                  else handleDrill(`${rowLabel} - ${col}`, { region: rowLabel, status: col })
                }}
                compareDate={compare === 'yesterday' ? summary.yesterday_date : summary.lastweek_date}
                yesterdayDate={summary.yesterday_date}
                lastweekDate={summary.lastweek_date}
                hideCardWrapper={true}
              />
            </div>
          </div>

          {/* Right column: TOP is Regional ACV share (vertical-bars), BOTTOM is Regional signals (InsightCard) + StatStrip */}
          <div className="flex flex-col gap-6 min-w-0">
            <ChartCard
              type="vertical-bars"
              title="Regional ACV share"
              subtitle="ACV contribution by territory"
              data={(summary.regions || []).map((r: any) => ({
                label: r.region,
                value: r.acv || 0,
                formattedValue: formatACV(r.acv),
                percentage: r.pct_acv || (summary.total?.acv ? Number(((r.acv / summary.total.acv) * 100).toFixed(1)) : 0),
                color: getRegionColor(r.region),
                onClick: () => handleDrill(`${r.region} Deals`, { region: r.region }),
              }))}
              className="min-h-[220px]"
            />

            <div className="min-w-0">
              <InsightCard
                title="Regional signals"
                subtitle="Key movements and territory signals"
                insights={getRegionsMatrixInsights(summary, summary, (title, p) => handleDrill(title, p))}
              />
            </div>
          </div>
        </CardRow>
      </div>

      {modalOpen && (
        <DealListModal
          title={modalTitle}
          deals={modalFilters.deals || dealsData?.deals || []}
          onSelectOpp={setSelectedOppId}
          onClose={() => setModalOpen(false)}
        />
      )}

      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />
    </div>
  )
}

export default function Regions() {
  return (
    <ErrorBoundary>
      <RegionsContent />
    </ErrorBoundary>
  )
}
