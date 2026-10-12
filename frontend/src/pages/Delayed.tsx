import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Clock, CalendarX2, ArrowRight, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, FileQuestion } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import api from '@/api/client'
import { formatACV, formatCount } from '@/utils/format'
import Card from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import DealListModal from '@/components/common/DealListModal'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import CompactGrid from '@/components/common/CompactGrid'
import MetricToggle from '@/components/common/MetricToggle'
import FilterBar from '@/components/common/FilterBar'
import SummaryLine from '@/components/common/SummaryLine'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import { format, parseISO } from 'date-fns'

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ')
type MetricMode = 'Amount' | 'Count' | 'Both'

function DelayedContent() {
  const { activeSnapshotId } = useAppStore()
  const metricMode = (useAppStore((s: any) => s.metricMode) || 'Amount') as MetricMode
  
  const [compare, setCompare] = useState<'yesterday' | 'last_week'>('yesterday')
  const [heatMode, setHeatMode] = useState<'Value' | 'Yesterday' | 'LastWeek'>('Value')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalFilters, setModalFilters] = useState<any>({})
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['v2-delayed-summary', activeSnapshotId, compare],
    queryFn: async () => {
      const res = await api.get('/v2/delayed/summary', {
        params: { as_of: activeSnapshotId ?? undefined, compare }
      })
      return res.data
    },
  })

  const { data: dealsData } = useQuery({
    queryKey: ['v2-delayed-deals', activeSnapshotId, compare, modalFilters],
    queryFn: async () => {
      const res = await api.get('/v2/delayed/deals', {
        params: { as_of: activeSnapshotId ?? undefined, compare, ...modalFilters }
      })
      return res.data
    },
    enabled: modalOpen
  })

  // The DealListModal will call the deals endpoint internally, but we can pass extra params
  // Wait, DealListModal uses useQuery internally if we pass fetchUrl
  
  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || summary?.error) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center text-red-500">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Could not load Delayed data</h2>
          <p className="text-sm opacity-80">{summary?.error || 'Server error'}</p>
        </Card>
      </div>
    )
  }

  const handleDrill = (title: string, filters: any = {}) => {
    setModalTitle(title)
    setModalFilters({ ...filters, compare, as_of: activeSnapshotId ?? undefined })
    setModalOpen(true)
  }

  const yDateStr = summary.yesterday_date ? format(parseISO(summary.yesterday_date), 'dd MMM') : 'Yday'
  const wDateStr = summary.lastweek_date ? format(parseISO(summary.lastweek_date), 'dd MMM') : 'Wk'

  const DeltaDisplay = ({ data }: { data: any }) => {
    if (!data) return null;
    const isY = compare === 'yesterday';
    const dCount = isY ? (data.delayed_vs_yesterday?.count ?? 0) : (data.delayed_vs_lastweek?.count ?? 0);
    const dAcv = isY ? (data.delayed_vs_yesterday?.acv ?? 0) : (data.delayed_vs_lastweek?.acv ?? 0);
    
    if (dCount === 0 && dAcv === 0) return <span className="text-gray-400"><Minus className="w-3 h-3 inline mr-1" />No change</span>;
    
    const isPos = dAcv > 0 || dCount > 0;
    const Icon = isPos ? ArrowUpRight : ArrowDownRight;
    const color = isPos ? 'text-red-500' : 'text-green-500'; // Delay is bad
    
    return (
      <span className={cn("inline-flex items-center text-xs font-medium px-2 py-1 rounded bg-gray-50/50 dark:bg-gray-800/50", color)}>
        <Icon className="w-3 h-3 mr-1" />
        {metricMode === 'Amount' ? formatACV(dAcv) : metricMode === 'Count' ? formatCount(dCount) : `${formatCount(dCount)} / ${formatACV(dAcv)}`}
      </span>
    )
  }

  const DualDeltaDisplay = ({ data }: { data: any }) => {
    if (!data) return null;
    const yCount = data.delayed_vs_yesterday?.count ?? 0;
    const yAcv = data.delayed_vs_yesterday?.acv ?? 0;
    const wCount = data.delayed_vs_lastweek?.count ?? 0;
    const wAcv = data.delayed_vs_lastweek?.acv ?? 0;

    const renderDelta = (count: number, acv: number, label: string) => {
      const isPos = acv > 0 || count > 0;
      const Icon = isPos ? ArrowUpRight : (acv < 0 || count < 0) ? ArrowDownRight : Minus;
      const color = isPos ? 'text-red-500' : (acv < 0 || count < 0) ? 'text-green-500' : 'text-gray-400';
      const val = (count === 0 && acv === 0) ? 'No change' : (metricMode === 'Amount' ? formatACV(acv) : metricMode === 'Count' ? formatCount(count) : `${formatCount(count)} / ${formatACV(acv)}`);
      
      return (
        <span className={cn("inline-flex items-center text-xs font-medium px-2 py-1 rounded bg-gray-50/50 dark:bg-gray-800/50", color)} title={label}>
          <Icon className="w-3 h-3 mr-1" />
          <span className="text-[10px] text-gray-500 mr-1">{label}</span>
          {val}
        </span>
      )
    }

    return (
      <div className="flex items-center space-x-2">
        {renderDelta(yCount, yAcv, `vs ${yDateStr}`)}
        {renderDelta(wCount, wAcv, `vs ${wDateStr}`)}
      </div>
    )
  }
  
  const KpiCard = ({ title, data, icon: Icon, color, kind }: any) => (
    <Card 
      className={cn("p-4 border-l-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-colors", color)}
      onClick={() => handleDrill(title, { kind })}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Icon className="w-5 h-5 text-gray-500" />
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</h3>
        </div>
      </div>
      <div className="space-y-1 mb-3">
        {(metricMode === 'Count' || metricMode === 'Both') && (
          <div className="text-2xl font-semibold">{formatCount(data?.count || 0)}</div>
        )}
        {(metricMode === 'Amount' || metricMode === 'Both') && (
          <div className="text-xl font-medium text-gray-500">{formatACV(data?.acv || 0)}</div>
        )}
      </div>
      <DualDeltaDisplay data={data} />
    </Card>
  )

  const buildGrid = (byField: 'by_region' | 'by_bu', clickKey: 'region' | 'bu') => {
    const categories = ['Closed', 'Commit', 'Best Case', 'Pipeline', 'Blank']
    const totals = { category: {} as any, grand: { count: 0, acv: 0 } }
    const gridDeltas: any = {}
    
    // Compute grand totals
    summary[byField]?.forEach((row: any) => {
      totals.grand.count += row.count
      totals.grand.acv += row.acv
      categories.forEach(cat => {
        if (!totals.category[cat]) totals.category[cat] = { count: 0, acv: 0 }
        totals.category[cat].count += (row.categories?.[cat]?.count || 0)
        totals.category[cat].acv += (row.categories?.[cat]?.acv || 0)
      })
    })

    const rows = (summary[byField] || []).map((row: any) => {
      const cells = categories.map(cat => ({
        count: row.categories?.[cat]?.count || 0,
        acv: row.categories?.[cat]?.acv || 0
      }))
      
      const isY = compare === 'yesterday'
      categories.forEach(cat => {
        const catData = row.categories?.[cat]
        const dCount = isY ? (catData?.delayed_vs_yesterday?.count ?? 0) : (catData?.delayed_vs_lastweek?.count ?? 0)
        const dAcv = isY ? (catData?.delayed_vs_yesterday?.acv ?? 0) : (catData?.delayed_vs_lastweek?.acv ?? 0)
        gridDeltas[`${row.label}-${cat}`] = { count: dCount, acv: dAcv }
      })

      const rdCount = isY ? (row.delayed_vs_yesterday?.count ?? 0) : (row.delayed_vs_lastweek?.count ?? 0)
      const rdAcv = isY ? (row.delayed_vs_yesterday?.acv ?? 0) : (row.delayed_vs_lastweek?.acv ?? 0)
      gridDeltas[`${row.label}-total`] = { count: rdCount, acv: rdAcv }

      return {
        label: row.label,
        cells,
        totals: { count: row.count, acv: row.acv }
      }
    })
    
    categories.forEach(cat => {
      let dCount = 0, dAcv = 0
      summary[byField]?.forEach((row: any) => {
        const catData = row.categories?.[cat]
        dCount += (compare === 'yesterday' ? (catData?.delayed_vs_yesterday?.count ?? 0) : (catData?.delayed_vs_lastweek?.count ?? 0))
        dAcv += (compare === 'yesterday' ? (catData?.delayed_vs_yesterday?.acv ?? 0) : (catData?.delayed_vs_lastweek?.acv ?? 0))
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
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Delayed Renewals</h1>
          <p className="text-sm text-gray-500 mt-1">
            Renewals in {summary.data_slice} that have slipped, pushed out, or are overdue.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <MetricToggle />
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setCompare('yesterday')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                compare === 'yesterday' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              )}
            >
              vs Yesterday
            </button>
            <button
              onClick={() => setCompare('last_week')}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                compare === 'last_week' ? "bg-white dark:bg-gray-700 shadow-sm" : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
              )}
            >
              vs Last Week
            </button>
          </div>
        </div>
      </div>

      {/* Local Page Filter Strip */}
      <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-sm">
        <FilterBar isPageOverride={false} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Delayed" data={summary.total} icon={Clock} color="border-orange-500" kind="all" />
        <KpiCard title="Overdue" data={summary.overdue} icon={AlertCircle} color="border-red-500" kind="overdue" />
        <KpiCard title="Slipped Quarter" data={summary.slipped} icon={CalendarX2} color="border-orange-400" kind="slipped" />
        <KpiCard title="Later Close Date" data={summary.later_close} icon={ArrowRight} color="border-yellow-500" kind="later_close" />
        <KpiCard title="Lost / Removed" data={summary.lost} icon={AlertTriangle} color="border-gray-500" kind="lost" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col h-[400px]">
          <div className="overflow-x-auto h-full">
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
        
        <Card className="flex flex-col h-[400px]">
          <div className="overflow-x-auto h-full">
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

      <Card className="p-4">
        <h2 className="font-semibold mb-4">Top Delayed Deals</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500">
                <th className="pb-2 font-medium">Opportunity</th>
                <th className="pb-2 font-medium">Region</th>
                <th className="pb-2 font-medium">Reason</th>
                <th className="pb-2 font-medium text-right">Push Out (Days)</th>
                <th className="pb-2 font-medium text-right">ACV</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_deals?.map((deal: any) => (
                <tr 
                  key={deal.opportunity_id_18} 
                  className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                  onClick={() => setSelectedOppId(deal.opportunity_id_18)}
                >
                  <td className="py-3 font-medium text-blue-600 dark:text-blue-400">{deal.opportunity_name}</td>
                  <td className="py-3">{deal.region}</td>
                  <td className="py-3">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-medium",
                      deal.reason === 'Overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                      deal.reason === 'Slipped quarter' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30' :
                      deal.reason === 'Lost/removed' ? 'bg-gray-200 text-gray-700' :
                      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30'
                    )}>
                      {deal.reason}
                    </span>
                  </td>
                  <td className="py-3 text-right text-gray-500">{deal.push_out_days > 0 ? `+${deal.push_out_days}` : '-'}</td>
                  <td className="py-3 text-right font-medium">{formatACV(deal.forecast_acv_amount)}</td>
                </tr>
              ))}
              {(!summary.top_deals || summary.top_deals.length === 0) && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">No delayed deals found.</td>
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
            business_unit_primary: modalFilters.bu
          }}
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

export default function Delayed() {
  return (
    <ErrorBoundary>
      <DelayedContent />
    </ErrorBoundary>
  )
}
