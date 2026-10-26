import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  PieChart,
  Lightbulb,
  ExternalLink
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

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')

type MetricMode = 'Amount' | 'Count' | 'Both'

const ALL_FC = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
const FUNNEL_STAGES = ['Approved', 'Pending Approval', 'Blank']

function RegionsContent() {
  const { activeSnapshotId } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode

  const [compare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')
  const [selectedRegion, setSelectedRegion] = useState<string>('All')
  
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

  // Fetch Selected Region details if not "All"
  const { data: regionDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ['v2-regions-detail', activeSnapshotId, selectedRegion],
    queryFn: async () => {
      const res = await api.get(`/v2/regions/${selectedRegion}/summary`, {
        params: { as_of: activeSnapshotId ?? undefined }
      })
      return res.data
    },
    enabled: selectedRegion !== 'All'
  })

  // Fetch Movements for selected region
  const { data: movementsData } = useQuery({
    queryKey: ['v2-regions-movements', activeSnapshotId, selectedRegion, moveCompare],
    queryFn: async () => {
      const res = await api.get(`/v2/regions/${selectedRegion}/movements`, {
        params: { as_of: activeSnapshotId ?? undefined, compare: moveCompare }
      })
      return res.data
    },
    enabled: selectedRegion !== 'All'
  })

  // Fetch Top Opps for selected region
  const { data: topOppsData } = useQuery({
    queryKey: ['v2-regions-top', activeSnapshotId, selectedRegion],
    queryFn: async () => {
      const res = await api.get(`/v2/regions/${selectedRegion}/top-opportunities`, {
        params: { as_of: activeSnapshotId ?? undefined }
      })
      return res.data
    },
    enabled: selectedRegion !== 'All'
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
    const list = [...summary.regions]
    list.sort((a: any, b: any) => {
      let vA: any = a[sortCol]
      let vB: any = b[sortCol]
      if (sortCol === 'delta_yesterday') {
        vA = a.delta_yesterday?.acv ?? 0
        vB = b.delta_yesterday?.acv ?? 0
      }
      if (typeof vA === 'string') {
        return sortDir === 'asc' ? vA.localeCompare(vB) : vB.localeCompare(vA)
      }
      return sortDir === 'asc' ? (vA || 0) - (vB || 0) : (vB || 0) - (vA || 0)
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

  const renderDelta = (countDelta: number, acvDelta: number, compareLabel: string) => {
    const val = metricMode === 'Count' ? countDelta : acvDelta
    const label = compareLabel.toLowerCase().includes('last') || compareLabel.toLowerCase().includes('wk')
      ? 'vs last week'
      : 'vs yesterday'

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
  const presentRegions = (regions || []).map((r: any) => r.region)
  const otherRegions = presentRegions.filter((r: string) => !knownRegions.includes(r) && r !== 'Other' && r !== 'Other / Unmapped')
  const unmappedRegions = presentRegions.filter((r: string) => r === 'Other' || r === 'Other / Unmapped')
  const tileOrder = [...knownRegions, ...otherRegions, ...unmappedRegions]
  // Generate Insight Lines
  const getInsightLines = () => {
    if (!summary || !summary.regions || summary.regions.length === 0) return []
    const lines = []
    
    const deltaKey = compare === 'yesterday' ? 'delta_yesterday' : 'delta_lastweek'
    const sorted = [...summary.regions].filter(r => r.region !== 'Other').sort((a, b) => {
      const aVal = metricMode === 'Count' ? a[deltaKey].count : a[deltaKey].acv
      const bVal = metricMode === 'Count' ? b[deltaKey].count : b[deltaKey].acv
      return bVal - aVal
    })
    
    if (sorted.length > 0) {
      const best = sorted[0]
      const bestVal = metricMode === 'Count' ? best[deltaKey].count : best[deltaKey].acv
      if (bestVal > 0) {
        const valStr = metricMode === 'Amount' ? '+' + formatACV(bestVal) : metricMode === 'Count' ? '+' + formatCount(bestVal) : `+${formatCount(best[deltaKey].count)} · +${formatACV(best[deltaKey].acv)}`
        lines.push(`${best.region} gained ${valStr} vs ${compare === 'yesterday' ? yDayStr : lwStr}, the largest regional gain`)
      }
    }
    return lines
  }
  
  const insightLines = getInsightLines()

  const regionsSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (regions && regions.length > 0) {
      list.push({ id: 'regions-tiles', title: 'Regional Overview' })
    }
    if (selectedRegion !== 'All') {
      list.push({ id: 'regions-deep-dive', title: `${selectedRegion} Deep Dive` })
    }
    if (summary?.regions && summary.regions.length > 0) {
      list.push({ id: 'regions-matrix', title: 'Comparison Matrix' })
    }
    return list
  }, [regions, selectedRegion, summary?.regions])

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

      {/* Tiles */}
      <div id="regions-tiles" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 scroll-mt-24">
        <button
          onClick={() => setSelectedRegion('All')}
          className={cn(
            "card p-4 text-left flex flex-col justify-between gap-2.5 transition-colors cursor-pointer",
            selectedRegion === 'All'
              ? "border-[var(--brand-teal)] ring-1 ring-[var(--brand-teal)]"
              : "hover:border-[var(--brand-teal)]"
          )}
        >
          <div className="space-y-1.5 w-full">
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-muted)] truncate" title="All Regions">All Regions</span>
              <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">{formatCount(summary.total.count)} deals</span>
            </div>
            <div 
              className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight cursor-pointer hover:underline"
              onClick={(e) => {
                e.stopPropagation()
                handleDrill(`All Regions (${data_slice})`, {})
              }}
            >
              {metricMode === 'Count' ? formatCount(summary.total.count) : 
               metricMode === 'Amount' ? formatACV(summary.total.acv) : 
               `${formatCount(summary.total.count)} · ${formatACV(summary.total.acv)}`}
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1 w-full">
            {renderDelta(summary.total.delta_yesterday.count, summary.total.delta_yesterday.acv, yDayStr)}
            {renderDelta(summary.total.delta_lastweek.count, summary.total.delta_lastweek.acv, lwStr)}
          </div>
        </button>

        {tileOrder.map(rname => {
          const reg = regions.find((r: any) => r.region === rname)
          if (!reg) return null
          
          return (
            <button
              key={rname}
              onClick={() => setSelectedRegion(rname)}
              className={cn(
                "card p-4 text-left flex flex-col justify-between gap-2.5 transition-colors cursor-pointer",
                selectedRegion === rname
                  ? "border-[var(--brand-teal)] ring-1 ring-[var(--brand-teal)]"
                  : "hover:border-[var(--brand-teal)]"
              )}
            >
              <div className="space-y-1.5 w-full">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-muted)] truncate" title={rname}>{rname}</span>
                  {metricMode !== 'Count' ? (
                    <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                      {reg.pct_acv}%
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
                      {formatCount(reg.count)} deals
                    </span>
                  )}
                </div>
                <div 
                  className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight cursor-pointer hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDrill(`${rname} Deals`, { region: rname })
                  }}
                >
                  {metricMode === 'Count' ? formatCount(reg.count) : 
                   metricMode === 'Amount' ? formatACV(reg.acv) : 
                   `${formatCount(reg.count)} · ${formatACV(reg.acv)}`}
                </div>
              </div>
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1 w-full">
                {renderDelta(reg.delta_yesterday.count, reg.delta_yesterday.acv, yDayStr)}
                {renderDelta(reg.delta_lastweek.count, reg.delta_lastweek.acv, lwStr)}
              </div>
            </button>
          )
        })}
      </div>

      {/* SELECTED REGION DEEP DIVE */}
      {selectedRegion !== 'All' && (
        <div id="regions-deep-dive" className="space-y-6 scroll-mt-24">
          <Card className="p-6 border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
            {/* Header with Title and Quick Exit */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800 gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                  <Globe2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedRegion} Deep Dive
                  </h2>
                  <p className="text-xs text-gray-500">Comprehensive regional breakdown and performance indicators</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedRegion('All')}
                className="text-xs font-medium text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1 self-start sm:self-auto"
              >
                <span>← Back to all regions</span>
              </button>
            </div>

            {/* Top Stat Cards */}
            {regionDetail && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* 1. Region ACV & Deals */}
                <div 
                  onClick={() => handleDrill(`${selectedRegion} Deals`, { region: selectedRegion })}
                  className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium">Total ACV & Deals</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500" />
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">
                    {formatACV(regionDetail.acv)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {formatCount(regionDetail.count)} deals ({regionDetail.pct_acv}% of portfolio)
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-200/60 dark:border-gray-800">
                    {renderDelta(regionDetail.delta_yesterday?.count || 0, regionDetail.delta_yesterday?.acv || 0, yDayStr)}
                  </div>
                </div>

                {/* 2. Commit Coverage & Portfolio Gap */}
                <div 
                  onClick={() => handleDrill(`${selectedRegion} Commit Coverage Deals`, { region: selectedRegion, categories: 'Commit,Closed' })}
                  className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-500" /> Commit Coverage
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500" />
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 transition-colors">
                    {regionDetail.commit_pct}%
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <span>Portfolio: {regionDetail.commit_coverage?.portfolio_pct}%</span>
                    <span className={cn(
                      "font-semibold",
                      (regionDetail.commit_coverage?.gap || 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                    )}>
                      ({(regionDetail.commit_coverage?.gap || 0) >= 0 ? '+' : ''}{regionDetail.commit_coverage?.gap} pts)
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Closed + Commit ACV</div>
                </div>

                {/* 3. Approved % & Portfolio Gap */}
                <div 
                  onClick={() => handleDrill(`${selectedRegion} Approved Deals`, { region: selectedRegion, status: 'Approved' })}
                  className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" /> Approved Status
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-emerald-600 transition-colors">
                    {regionDetail.approved_pct}%
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <span>Portfolio: {regionDetail.approved_pct_detail?.portfolio_pct}%</span>
                    <span className={cn(
                      "font-semibold",
                      (regionDetail.approved_pct_detail?.gap || 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                    )}>
                      ({(regionDetail.approved_pct_detail?.gap || 0) >= 0 ? '+' : ''}{regionDetail.approved_pct_detail?.gap} pts)
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Formal opportunity approvals</div>
                </div>

                {/* 4. Overdue / Delayed Deals */}
                <div 
                  onClick={() => handleDrill(`${selectedRegion} Delayed Deals`, { region: selectedRegion, delayed: true })}
                  className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:border-red-300 dark:hover:border-red-700 transition-all group"
                >
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span className="font-medium flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-red-500" /> Overdue Deals
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-red-500" />
                  </div>
                  <div className={cn(
                    "text-xl font-bold transition-colors",
                    (regionDetail.delayed_deals?.count || 0) > 0 ? "text-red-600 dark:text-red-400 group-hover:text-red-500" : "text-gray-900 dark:text-white"
                  )}>
                    {formatACV(regionDetail.delayed_deals?.acv || 0)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {regionDetail.delayed_deals?.count || 0} overdue deals
                  </div>
                  <div className="mt-2 text-xs text-gray-400">Past close date & unclosed</div>
                </div>
              </div>
            )}

            {/* Plain-Language Insights Box */}
            {regionDetail && regionDetail.insights && regionDetail.insights.length > 0 && (
              <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/60 dark:from-blue-950/20 dark:to-indigo-950/10 border border-blue-200/60 dark:border-blue-900/40 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-blue-600 dark:text-blue-400" />
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

            {/* 2-Column Main Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              {/* LEFT COLUMN: Forecast Split, Approval Split, Expiry Quarters */}
              <div className="space-y-6">
                {/* 1. Forecast Category Split Table */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/80 shadow-sm">
                  <div className="p-3.5 bg-gray-50/80 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <PieChart className="w-4 h-4 text-blue-500" /> Forecast Category Breakdown
                    </h3>
                    <span className="text-xs text-gray-500">% of {selectedRegion} ACV</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/50 dark:bg-gray-900/20 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3.5">Category</th>
                          <th className="py-2.5 px-3 text-right">Deals</th>
                          <th className="py-2.5 px-3 text-right">ACV</th>
                          <th className="py-2.5 px-3.5 text-right">% Region ACV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {regionDetail?.forecast_categories?.map((fc: any) => (
                          <tr 
                            key={fc.category}
                            onClick={() => handleDrill(`${selectedRegion} - ${fc.category}`, { region: selectedRegion, category: fc.category })}
                            className="hover:bg-blue-50/60 dark:hover:bg-blue-900/20 cursor-pointer transition-colors group"
                          >
                            <td className="py-2.5 px-3.5 font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600">
                              {fc.category}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 dark:text-gray-400">
                              {formatCount(fc.count)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-white">
                              {formatACV(fc.acv)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-medium text-blue-600 dark:text-blue-400">
                              {fc.pct_acv}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {regionDetail && (
                        <tfoot className="bg-gray-50 dark:bg-gray-900/50 font-bold border-t border-gray-200 dark:border-gray-700">
                          <tr>
                            <td className="py-2.5 px-3.5 text-gray-900 dark:text-white">Total</td>
                            <td className="py-2.5 px-3 text-right">{formatCount(regionDetail.count)}</td>
                            <td className="py-2.5 px-3 text-right">{formatACV(regionDetail.acv)}</td>
                            <td className="py-2.5 px-3.5 text-right">100.0%</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* 2. Approval Status Split Table */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/80 shadow-sm">
                  <div className="p-3.5 bg-gray-50/80 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-500" /> Approval Status Breakdown
                    </h3>
                    <span className="text-xs text-gray-500">Governance flow</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/50 dark:bg-gray-900/20 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3.5">Approval Status</th>
                          <th className="py-2.5 px-3 text-right">Deals</th>
                          <th className="py-2.5 px-3 text-right">ACV</th>
                          <th className="py-2.5 px-3.5 text-right">% Region ACV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {regionDetail?.approval_statuses?.map((st: any) => (
                          <tr 
                            key={st.status}
                            onClick={() => handleDrill(`${selectedRegion} - ${st.status}`, { region: selectedRegion, status: st.status })}
                            className="hover:bg-blue-50/60 dark:hover:bg-blue-900/20 cursor-pointer transition-colors group"
                          >
                            <td className="py-2.5 px-3.5 font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600">
                              {st.status}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 dark:text-gray-400">
                              {formatCount(st.count)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-white">
                              {formatACV(st.acv)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-medium text-blue-600 dark:text-blue-400">
                              {st.pct_acv}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 3. Expiry by Quarter */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/80 shadow-sm">
                  <div className="p-3.5 bg-gray-50/80 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-purple-500" /> Expiry Schedule by Quarter
                    </h3>
                    <span className="text-xs text-gray-500">Service period schedule</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/50 dark:bg-gray-900/20 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3.5">Quarter</th>
                          <th className="py-2.5 px-3 text-right">Deals</th>
                          <th className="py-2.5 px-3 text-right">ACV</th>
                          <th className="py-2.5 px-3.5 text-right">% Region ACV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {regionDetail?.expiry_quarters?.map((eq: any) => (
                          <tr 
                            key={eq.quarter}
                            onClick={() => handleDrill(`${selectedRegion} - ${eq.quarter}`, { region: selectedRegion, quarter: eq.quarter })}
                            className="hover:bg-blue-50/60 dark:hover:bg-blue-900/20 cursor-pointer transition-colors group"
                          >
                            <td className="py-2.5 px-3.5 font-medium text-gray-800 dark:text-gray-200 group-hover:text-blue-600">
                              {eq.quarter}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 dark:text-gray-400">
                              {formatCount(eq.count)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-white">
                              {formatACV(eq.acv)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-medium text-blue-600 dark:text-blue-400">
                              {eq.pct_acv}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Top Accounts, Top BUs, Delayed Deals, Movements */}
              <div className="space-y-6">
                {/* 1. Top 10 Accounts by ACV */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/80 shadow-sm">
                  <div className="p-3.5 bg-gray-50/80 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-500" /> Top 10 Accounts by ACV
                    </h3>
                    <span className="text-xs text-gray-500">Account concentration</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50/50 dark:bg-gray-900/20 text-gray-500 font-medium border-b border-gray-100 dark:border-gray-800">
                        <tr>
                          <th className="py-2.5 px-3 w-8">#</th>
                          <th className="py-2.5 px-3">Account</th>
                          <th className="py-2.5 px-3 text-right">Deals</th>
                          <th className="py-2.5 px-3 text-right">ACV</th>
                          <th className="py-2.5 px-3.5 text-right">% Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {regionDetail?.top_accounts?.map((acc: any, i: number) => (
                          <tr 
                            key={acc.account_name}
                            onClick={() => handleDrill(`${selectedRegion} - ${acc.account_name}`, { region: selectedRegion, account_name: acc.account_name })}
                            className="hover:bg-blue-50/60 dark:hover:bg-blue-900/20 cursor-pointer transition-colors group"
                          >
                            <td className="py-2.5 px-3 text-gray-400 font-bold">{i + 1}</td>
                            <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-white truncate max-w-[180px] group-hover:text-blue-600">
                              {acc.account_name}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-600 dark:text-gray-400">
                              {formatCount(acc.count)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-white">
                              {formatACV(acc.acv)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-medium text-blue-600 dark:text-blue-400">
                              {acc.pct_acv}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. Top Business Units with Share */}
                {regionDetail?.business_units && regionDetail.business_units.length > 0 && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800/80 shadow-sm space-y-3">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-indigo-500" /> Business Unit Mix & Share
                      </span>
                      <span className="text-xs font-normal text-gray-500">By contribution</span>
                    </h3>
                    <div className="space-y-2.5">
                      {regionDetail.business_units.map((bu: any) => {
                        const pct = bu.share_pct ?? (regionDetail.acv > 0 ? Math.round((bu.acv / regionDetail.acv) * 100) : 0)
                        return (
                          <div 
                            key={bu.bu}
                            className="cursor-pointer group p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                            onClick={() => handleDrill(`${selectedRegion} - ${bu.bu}`, { region: selectedRegion, bu: bu.bu })}
                          >
                            <div className="flex justify-between text-xs mb-1">
                              <span className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-blue-600 transition-colors">
                                {bu.bu}
                              </span>
                              <span className="text-gray-500 font-medium">
                                {formatCount(bu.count)} deals • {formatACV(bu.acv)} ({pct}%)
                              </span>
                            </div>
                            <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all group-hover:from-blue-400 group-hover:to-indigo-400"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 3. Delayed/Overdue Deals Table */}
                {regionDetail?.delayed_deals?.deals && regionDetail.delayed_deals.deals.length > 0 && (
                  <div className="rounded-xl border border-red-200 dark:border-red-900/40 overflow-hidden bg-white dark:bg-gray-800/80 shadow-sm">
                    <div className="p-3.5 bg-red-50/80 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/30 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-red-900 dark:text-red-300 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-red-500" /> Overdue Deals in {selectedRegion}
                      </h3>
                      <button
                        onClick={() => handleDrill(`${selectedRegion} Delayed Deals`, { region: selectedRegion, delayed: true })}
                        className="text-xs text-red-600 dark:text-red-400 font-semibold hover:underline"
                      >
                        View all ({regionDetail.delayed_deals.count}) →
                      </button>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-56 overflow-y-auto">
                      {regionDetail.delayed_deals.deals.slice(0, 5).map((d: any) => (
                        <div 
                          key={d.opportunity_id_18}
                          onClick={() => setSelectedOppId(d.opportunity_id_18)}
                          className="p-3 hover:bg-gray-50 dark:hover:bg-gray-900/40 cursor-pointer transition-colors flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-gray-900 dark:text-white truncate hover:text-blue-500">
                              {d.opportunity_name}
                            </div>
                            <div className="text-gray-500 truncate flex items-center gap-2 mt-0.5">
                              <span>{d.account_name}</span>
                              <span>•</span>
                              <span className="text-red-500 font-medium">{d.days_overdue}d overdue</span>
                              <span>•</span>
                              <span>{d.owner}</span>
                            </div>
                          </div>
                          <div className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
                            {formatACV(d.acv)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. What Changed (Movements) */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">What Changed vs Prior Snapshot</h3>
                    <div className="flex bg-gray-100 dark:bg-gray-800 p-0.5 rounded-lg">
                      <button
                        onClick={() => setMoveCompare('yesterday')}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                          moveCompare === 'yesterday' ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-700"
                        )}
                      >
                        Vs YDay
                      </button>
                      <button
                        onClick={() => setMoveCompare('last_week')}
                        className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                          moveCompare === 'last_week' ? "bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-700"
                        )}
                      >
                        Vs 7d
                      </button>
                    </div>
                  </div>

                  {!movementsData ? (
                    <div className="h-24 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {movementsData.category_moves.map((m: any, i: number) => (
                        <div 
                          key={`c-${i}`} 
                          className="flex justify-between items-center p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700 text-xs"
                          onClick={() => handleDrill(`Moved ${m.from_category} → ${m.to_category}`, { region: selectedRegion, deals: m.deals })}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded">{m.from_category}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded">{m.to_category}</span>
                          </div>
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {formatACV(m.acv)} ({formatCount(m.count)})
                          </div>
                        </div>
                      ))}
                      {movementsData.approval_moves.map((m: any, i: number) => (
                        <div 
                          key={`a-${i}`} 
                          className="flex justify-between items-center p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700 text-xs"
                          onClick={() => handleDrill(`Moved ${m.from_status} → ${m.to_status}`, { region: selectedRegion, deals: m.deals })}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded">{m.from_status}</span>
                            <span className="text-gray-400">→</span>
                            <span className="font-medium px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded">{m.to_status}</span>
                          </div>
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {formatACV(m.acv)} ({formatCount(m.count)})
                          </div>
                        </div>
                      ))}
                      {movementsData.new_to_slice?.count > 0 && (
                        <div 
                          className="flex justify-between items-center p-2.5 rounded-lg bg-green-50 dark:bg-green-900/10 hover:bg-green-100 dark:hover:bg-green-900/20 cursor-pointer transition-colors border border-green-200/60 dark:border-green-900/30 text-green-700 dark:text-green-400 text-xs"
                          onClick={() => handleDrill(`Newly In-Scope Deals`, { region: selectedRegion, deals: movementsData.new_to_slice.deals })}
                        >
                          <span className="font-semibold flex items-center gap-1">
                            <ArrowUpRight className="w-3.5 h-3.5" /> Newly In-Scope
                          </span>
                          <span className="font-bold">
                            {formatACV(movementsData.new_to_slice.acv)} ({formatCount(movementsData.new_to_slice.count)})
                          </span>
                        </div>
                      )}
                      {movementsData.slipped_out?.count > 0 && (
                        <div 
                          className="flex justify-between items-center p-2.5 rounded-lg bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 cursor-pointer transition-colors border border-red-200/60 dark:border-red-900/30 text-red-700 dark:text-red-400 text-xs"
                          onClick={() => handleDrill(`Slipped Out Deals`, { region: selectedRegion, deals: movementsData.slipped_out.deals })}
                        >
                          <span className="font-semibold flex items-center gap-1">
                            <ArrowDownRight className="w-3.5 h-3.5" /> Slipped Out of Quarter
                          </span>
                          <span className="font-bold">
                            {formatACV(movementsData.slipped_out.acv)} ({formatCount(movementsData.slipped_out.count)})
                          </span>
                        </div>
                      )}
                      {movementsData.category_moves.length === 0 && movementsData.approval_moves.length === 0 && (!movementsData.new_to_slice?.count) && (!movementsData.slipped_out?.count) && (
                        <div className="text-xs text-gray-500 italic p-3 text-center">No deal movements recorded vs {moveCompare === 'yesterday' ? yDayStr : lwStr}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* 5. Top Opportunities Search */}
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">Top Deals Search</h3>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search deals..."
                        value={topSearch}
                        onChange={(e) => setTopSearch(e.target.value)}
                        className="pl-8 pr-3 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-40"
                      />
                    </div>
                  </div>

                  {!topOppsData ? (
                    <div className="h-28 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {topOppsData
                        .filter((o: any) => o.opportunity_name.toLowerCase().includes(topSearch.toLowerCase()) || o.account_name.toLowerCase().includes(topSearch.toLowerCase()))
                        .map((opp: any, idx: number) => (
                          <div 
                            key={opp.id}
                            onClick={() => setSelectedOppId(opp.id)}
                            className="p-2.5 bg-gray-50 dark:bg-gray-900/40 rounded-lg hover:bg-blue-50/50 dark:hover:bg-blue-900/20 cursor-pointer border border-transparent hover:border-blue-200 dark:hover:border-blue-800 transition-all flex items-center gap-2.5 text-xs"
                          >
                            <span className="w-5 text-center text-gray-400 font-bold">{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-gray-900 dark:text-white truncate">
                                {opp.opportunity_name}
                              </div>
                              <div className="text-gray-500 truncate flex items-center gap-1.5 mt-0.5">
                                <span>{opp.account_name}</span>
                                <span>•</span>
                                <span className="text-blue-600 dark:text-blue-400 font-medium">{opp.forecast_category}</span>
                              </div>
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white whitespace-nowrap">
                              {formatACV(opp.forecast_acv_amount)}
                            </span>
                          </div>
                        ))}
                      {topOppsData.length === 0 && (
                        <div className="text-center py-6 text-gray-500 text-xs">No opportunities found</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
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
                    <span>Delayed ACV</span>
                    <ArrowUpDown className={cn("w-3.5 h-3.5", sortCol === 'delayed_acv' ? "text-blue-500" : "text-gray-400")} />
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
              {sortedRegions.map((r: any) => {
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

                    {/* Delayed ACV */}
                    <td 
                      onClick={() => handleDrill(`${r.region} Delayed Deals`, { region: r.region, delayed: true })}
                      className={cn(
                        "py-3 px-3.5 text-right font-medium cursor-pointer hover:underline",
                        (r.delayed_count || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"
                      )}
                    >
                      {(r.delayed_count || 0) > 0 ? `${formatACV(r.delayed_acv)} (${r.delayed_count})` : '-'}
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
              })}
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
                  onClick={() => handleDrill(`All Delayed Deals`, { delayed: true })}
                  className={cn(
                    "py-3 px-3.5 text-right cursor-pointer hover:underline",
                    (summary.total.delayed_count || 0) > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"
                  )}
                >
                  {(summary.total.delayed_count || 0) > 0 ? `${formatACV(summary.total.delayed_acv)} (${summary.total.delayed_count})` : '-'}
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
      <Card className="p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Region Matrix</h2>
            <p className="text-xs text-gray-500 mt-0.5">Two-dimensional cross tabs by forecast category and approval status</p>
          </div>
          <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
            {['Value', 'Yesterday', 'LastWeek'].map(hm => (
              <button
                key={hm}
                onClick={() => setHeatMode(hm as any)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                  heatMode === hm
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                {hm === 'Yesterday' ? 'vs YDay' : hm === 'LastWeek' ? 'vs 7d' : hm}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Forecast Category</h3>
            {(() => {
              const rawFc = summary.categories && summary.categories.length > 0 ? summary.categories : Object.keys(summary.totals?.categories || {})
              const displayFc = rawFc.filter((fc: string) => {
                const s = summary.totals?.categories?.[fc]
                return s ? (s.count > 0 || (s.acv != null && s.acv !== 0)) : true
              })
              return (
                <CompactGrid
                  title="Regions (Forecast Category)"
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
                />
              )
            })()}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Approval Status</h3>
            <CompactGrid
              title="Regions (Approval Status)"
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
            />
          </div>
        </div>
      </Card>
      
      {/* Insight Line */}
      {insightLines.map((l, i) => (
        <SummaryLine key={i} primaryText={l} />
      ))}

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
