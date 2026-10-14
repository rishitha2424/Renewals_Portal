import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, Presentation, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import {
  getV2OverviewSummary,
  getApprovalsDistribution,
  getV2ExpirySummary,
  getV2RegionsSummary,
  getV2BusinessUnitsSummary,
  getV2DelayedSummary,
  getExplorerReconcile,
  downloadReport,
} from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { showToast } from '@/components/ui/Toast'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  getForecastCategoryLabel,
  getApprovalStatusLabel,
  getQuarterFromDate,
} from '@/utils/format'

export default function ExecutiveView() {
  const { activeSnapshotId, compareSnapshotId } = useAppStore()
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)

  // 1. Overview Summary (Headline, Forecast categories, Movements)
  const overviewQuery = useQuery({
    queryKey: ['exec-v2-overview'],
    queryFn: () => getV2OverviewSummary({ sales_types: ['Renewals'], period: 'current_quarter' }),
  })

  // 2. Approvals Distribution
  const approvalsQuery = useQuery({
    queryKey: ['exec-v2-approvals'],
    queryFn: () => getApprovalsDistribution(undefined, 'yesterday', false, { sales_types: ['Renewals'], period: 'current_quarter' }),
  })

  // 3. Expiry Summary
  const expiryQuery = useQuery({
    queryKey: ['exec-v2-expiry'],
    queryFn: () => getV2ExpirySummary({ filterSpec: { sales_types: ['Renewals'] } }),
  })

  // 4. Regions Summary
  const regionsQuery = useQuery({
    queryKey: ['exec-v2-regions'],
    queryFn: () => getV2RegionsSummary({ compare: 'yesterday' }),
  })

  // 5. Business Units Summary
  const buQuery = useQuery({
    queryKey: ['exec-v2-bu'],
    queryFn: () => getV2BusinessUnitsSummary({ compare: 'yesterday' }),
  })

  // 6. Delayed Summary
  const delayedQuery = useQuery({
    queryKey: ['exec-v2-delayed'],
    queryFn: () => getV2DelayedSummary({ compare: 'yesterday' }),
  })

  // 7. Reconcile check
  const reconcileQuery = useQuery({
    queryKey: ['exec-v2-reconcile'],
    queryFn: () => getExplorerReconcile(),
  })

  const isLoading =
    overviewQuery.isLoading ||
    approvalsQuery.isLoading ||
    expiryQuery.isLoading ||
    regionsQuery.isLoading ||
    buQuery.isLoading ||
    delayedQuery.isLoading ||
    reconcileQuery.isLoading

  const isError =
    overviewQuery.isError ||
    approvalsQuery.isError ||
    expiryQuery.isError ||
    regionsQuery.isError ||
    buQuery.isError ||
    delayedQuery.isError

  const error =
    overviewQuery.error ||
    approvalsQuery.error ||
    expiryQuery.error ||
    regionsQuery.error ||
    buQuery.error ||
    delayedQuery.error

  const handleDownload = async (type: 'pptx' | 'xlsx') => {
    if (downloadingFormat) return
    setDownloadingFormat(type)
    try {
      const { filename } = await downloadReport(type, activeSnapshotId, compareSnapshotId, 'renewals', true)
      showToast.success('Report downloaded', filename)
    } catch (err: any) {
      showToast.error(
        'Download failed',
        err?.response?.data?.detail || err?.message || 'Failed to generate report'
      )
    } finally {
      setDownloadingFormat(null)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center" id="executive-loading">
        <Loader2 className="w-9 h-9 text-[#12284C] animate-spin mb-3" />
        <h2 className="text-lg font-bold text-slate-800">Loading report…</h2>
        <p className="text-xs text-slate-500 mt-1">Retrieving Mobileum Renewals Intelligence executive data</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center" id="executive-error">
        <div className="max-w-md w-full bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <h2 className="text-base font-bold text-red-900 mb-1">Failed to load report</h2>
          <p className="text-xs text-red-700 mb-4">
            {(error as any)?.message || 'An error occurred while loading the executive report data.'}
          </p>
          <button
            onClick={() => {
              overviewQuery.refetch()
              approvalsQuery.refetch()
              expiryQuery.refetch()
              regionsQuery.refetch()
              buQuery.refetch()
              delayedQuery.refetch()
              reconcileQuery.refetch()
            }}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const overview = overviewQuery.data || {}
  const approvals = approvalsQuery.data || {}
  const expiry = expiryQuery.data || {}
  const regions = regionsQuery.data || {}
  const bu = buQuery.data || {}
  const delayed = delayedQuery.data || {}
  const reconcile = reconcileQuery.data || {}

  const snapshotDate = overview.snapshot_date || '2026-10-07'
  const period = getQuarterFromDate(snapshotDate)
  const total = overview.total || { count: 348, acv: 40068990.09 }
  const totalCount = total.count || 0
  const totalAcv = total.acv || 0

  // Category summary
  const categories = overview.categories || {}
  const catOrder = ['Commit', 'Best Case', 'Pipeline', 'Blank']
  const catRows = catOrder.map(catKey => {
    const d = categories[catKey] || { count: 0, acv: 0 }
    const label = getForecastCategoryLabel(catKey)
    const pct = totalAcv > 0 ? (d.acv / totalAcv) * 100 : 0
    return { key: catKey, label, count: d.count, acv: d.acv, pct }
  })

  // Movements vs yesterday & vs last week
  const deltaYesterday = total.delta_yesterday || { count: 0, acv: 0, snapshot_date: '' }
  const deltaLastWeek = total.delta_lastweek || { count: 0, acv: 0, snapshot_date: '' }

  // Approvals
  const approvalStatuses = approvals.statuses || []

  // Expiry quarters
  const expiryRows: any[] = []
  if (expiry.grids) {
    Object.keys(expiry.grids).sort().forEach(yearKey => {
      const yearRows = expiry.grids[yearKey]?.rows || []
      yearRows.forEach((r: any) => {
        if (r.total?.count > 0 || r.total?.acv > 0) {
          expiryRows.push(r)
        }
      })
    })
  }

  // Top 10 Regions
  const allRegions = regions.regions || []
  const top10Regions = allRegions.slice(0, 10)

  // Business Units
  const buRows = bu.rows || []

  // Delayed summary
  const overdue = delayed.overdue || { count: 0, acv: 0 }
  const slipped = delayed.slipped || { count: 0, acv: 0 }
  const lost = delayed.lost || { count: 0, acv: 0 }
  const delayedTotal = delayed.total || { count: overdue.count + slipped.count + lost.count, acv: overdue.acv + slipped.acv + lost.acv }

  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans p-6 sm:p-10 max-w-5xl mx-auto" id="executive-report-view">
      {/* Print CSS styles */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 15mm;
          }
          body {
            background: #ffffff !important;
            color: #0f172a !important;
            font-size: 11pt !important;
            line-height: 1.4 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .page-break-avoid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Action Bar (hidden in print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} className="mr-1 text-emerald-600" /> Standalone Print Report
          </span>
          <span className="text-xs text-slate-500">Opens in new tab · Optimized for A4 / PDF export</span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleDownload('pptx')}
            disabled={!!downloadingFormat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 transition shadow-sm disabled:opacity-50"
            id="exec-download-pptx-btn"
            title="Download Daily PowerPoint Update"
          >
            {downloadingFormat === 'pptx' ? <Loader2 size={14} className="animate-spin text-amber-600" /> : <Presentation size={14} className="text-amber-600" />}
            <span>{downloadingFormat === 'pptx' ? 'Generating PPTX...' : 'PowerPoint (.pptx)'}</span>
          </button>

          <button
            onClick={() => handleDownload('xlsx')}
            disabled={!!downloadingFormat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 transition shadow-sm disabled:opacity-50"
            id="exec-download-excel-btn"
            title="Download Daily Excel Workbook"
          >
            {downloadingFormat === 'xlsx' ? <Loader2 size={14} className="animate-spin text-emerald-600" /> : <FileSpreadsheet size={14} className="text-emerald-600" />}
            <span>{downloadingFormat === 'xlsx' ? 'Generating Excel...' : 'Excel (.xlsx)'}</span>
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow hover:opacity-95 transition"
            style={{ background: 'linear-gradient(135deg, #12284C, #00A3AD)' }}
            id="exec-print-btn"
          >
            <Printer size={14} /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Report Header */}
      <header className="mb-6 pb-4 border-b-2 border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="Mobileum" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="font-extrabold text-2xl tracking-tight text-[#12284C]">
                Mobileum Renewals Intelligence
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Executive Portfolio Update · As of <span className="font-semibold text-slate-800">{formatDate(snapshotDate)}</span> · Period: <span className="font-semibold text-slate-800">{period}</span> · Scope: <span className="font-semibold text-slate-800">Renewals</span>
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <p>Confidential & Proprietary</p>
            <p>{formatDate(snapshotDate)}</p>
          </div>
        </div>
      </header>

      {/* Headline Summary Line */}
      <div className="mb-6 p-4 rounded-lg bg-slate-50 border border-slate-300 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Portfolio Headline</span>
          <span className="font-bold text-slate-800 text-base">
            Total Active Renewals: <span className="text-[#12284C] font-mono text-lg">{formatNumber(totalCount)} deals</span> &nbsp;|&nbsp; <span className="text-[#00A3AD] font-mono text-lg">{formatCurrency(totalAcv)} Total ACV</span>
          </span>
        </div>
        <div className="text-right text-xs">
          <span className="text-slate-500 block">Current Quarter Filter:</span>
          <span className="font-semibold text-slate-700">{period} (Renewals Sales Type)</span>
        </div>
      </div>

      {/* Forecast Category Summary table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              1. Forecast Category Summary
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-4 py-2">Forecast Category</th>
                <th className="px-4 py-2 text-right">Deals</th>
                <th className="px-4 py-2 text-right">ACV (USD)</th>
                <th className="px-4 py-2 text-right">% of Total ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {catRows.map(r => (
                <tr key={r.key} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-slate-800">{r.label}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(r.count)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(r.acv)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600">{r.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                <td className="px-4 py-2.5">Total Renewals</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatNumber(totalCount)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[#12284C]">{formatCurrency(totalAcv)}</td>
                <td className="px-4 py-2.5 text-right font-mono">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Movement vs yesterday and vs last week */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              2. Movement vs. Historical Baselines
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-4 py-2">Baseline Comparison</th>
                <th className="px-4 py-2">Prior Snapshot Date</th>
                <th className="px-4 py-2 text-right">Deals Change</th>
                <th className="px-4 py-2 text-right">ACV Change (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-slate-800">Movement vs. Yesterday</td>
                <td className="px-4 py-2 text-slate-500">{formatDate(deltaYesterday.snapshot_date || '2026-10-06')}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">
                  {deltaYesterday.count >= 0 ? `+${deltaYesterday.count}` : deltaYesterday.count}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">
                  {deltaYesterday.acv >= 0 ? `+${formatCurrency(deltaYesterday.acv)}` : `-${formatCurrency(Math.abs(deltaYesterday.acv))}`}
                </td>
              </tr>
              <tr className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-slate-800">Movement vs. Last Week</td>
                <td className="px-4 py-2 text-slate-500">{formatDate(deltaLastWeek.snapshot_date || '2026-09-30')}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">
                  {deltaLastWeek.count >= 0 ? `+${deltaLastWeek.count}` : deltaLastWeek.count}
                </td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">
                  {deltaLastWeek.acv >= 0 ? `+${formatCurrency(deltaLastWeek.acv)}` : `-${formatCurrency(Math.abs(deltaLastWeek.acv))}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Approval Status Summary table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              3. Approval Status Summary
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-4 py-2">Approval Status</th>
                <th className="px-4 py-2 text-right">Deals</th>
                <th className="px-4 py-2 text-right">ACV (USD)</th>
                <th className="px-4 py-2 text-right">% of Total ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {approvalStatuses.map((s: any) => {
                const label = getApprovalStatusLabel(s.status)
                const pct = totalAcv > 0 ? (s.acv / totalAcv) * 100 : 0
                return (
                  <tr key={s.status} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-slate-800">{label}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(s.count)}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(s.acv)}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-600">{pct.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {formatNumber(approvalStatuses.reduce((acc: number, s: any) => acc + s.count, 0))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[#12284C]">
                  {formatCurrency(approvalStatuses.reduce((acc: number, s: any) => acc + s.acv, 0))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Expiry Quarter × Forecast Category table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              4. Expiry Quarter × Forecast Category
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="px-3 py-2">Quarter</th>
                  <th className="px-3 py-2 text-right text-emerald-700">Commit</th>
                  <th className="px-3 py-2 text-right text-amber-700">Best Case</th>
                  <th className="px-3 py-2 text-right text-blue-700">Pipeline</th>
                  <th className="px-3 py-2 text-right text-slate-600">Not Proposed</th>
                  <th className="px-3 py-2 text-right font-bold">Total ACV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expiryRows.map((r: any) => {
                  const cells = r.cells || {}
                  const commitAcv = cells.Commit?.acv || 0
                  const bestCaseAcv = cells['Best Case']?.acv || 0
                  const pipelineAcv = cells.Pipeline?.acv || 0
                  const blankAcv = cells.Blank?.acv || 0
                  const rowTotalAcv = r.total?.acv || 0

                  return (
                    <tr key={r.quarter} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-semibold text-slate-800">{r.label || r.quarter}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {commitAcv > 0 ? formatCurrency(commitAcv) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {bestCaseAcv > 0 ? formatCurrency(bestCaseAcv) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {pipelineAcv > 0 ? formatCurrency(pipelineAcv) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">
                        {blankAcv > 0 ? formatCurrency(blankAcv) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(rowTotalAcv)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Top 10 Regions by ACV table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              5. Top 10 Regions by ACV
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-3 py-2 w-8 text-center">#</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2 text-right">Deals</th>
                <th className="px-3 py-2 text-right">ACV (USD)</th>
                <th className="px-3 py-2 text-right">% of Total</th>
                <th className="px-3 py-2 text-right">Commit %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {top10Regions.map((reg: any, i: number) => (
                <tr key={reg.region} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-center text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{reg.region}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{formatNumber(reg.count)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(reg.acv)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    {reg.pct_acv != null ? `${reg.pct_acv.toFixed(1)}%` : totalAcv > 0 ? `${((reg.acv / totalAcv) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    {reg.commit_pct != null ? `${reg.commit_pct.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Business Unit table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              6. Business Unit Breakdown
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-4 py-2">Business Unit</th>
                <th className="px-4 py-2 text-right">Deals</th>
                <th className="px-4 py-2 text-right">ACV (USD)</th>
                <th className="px-4 py-2 text-right">% of Total ACV</th>
                <th className="px-4 py-2 text-right">Commit %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {buRows.map((b: any) => (
                <tr key={b.bu} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-slate-800">{b.bu}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{formatNumber(b.count)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-slate-900">{formatCurrency(b.acv)}</td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600">
                    {b.pct_acv != null ? `${b.pct_acv.toFixed(1)}%` : totalAcv > 0 ? `${((b.acv / totalAcv) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-600">
                    {b.commit_pct != null ? `${b.commit_pct.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {formatNumber(buRows.reduce((acc: number, b: any) => acc + b.count, 0))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-[#12284C]">
                  {formatCurrency(buRows.reduce((acc: number, b: any) => acc + b.acv, 0))}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">100.0%</td>
                <td className="px-4 py-2.5 text-right font-mono">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Delayed Renewals summary table */}
      <section className="mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              7. Delayed Renewals Summary
            </h2>
          </div>
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2 text-right">Deals</th>
                <th className="px-4 py-2 text-right">ACV (USD)</th>
                <th className="px-4 py-2">Risk Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-amber-900">Overdue Renewals</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-amber-800">{formatNumber(overdue.count)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-amber-800">{formatCurrency(overdue.acv)}</td>
                <td className="px-4 py-2 text-slate-500">Service expiry date has passed current snapshot date</td>
              </tr>
              <tr className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-orange-900">Slipped to Next Fiscal Year</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-orange-800">{formatNumber(slipped.count)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-orange-800">{formatCurrency(slipped.acv)}</td>
                <td className="px-4 py-2 text-slate-500">Expected close pushed into subsequent fiscal year</td>
              </tr>
              <tr className="hover:bg-slate-50/50">
                <td className="px-4 py-2 font-medium text-rose-900">Lost / Terminated</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-rose-800">{formatNumber(lost.count)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold text-rose-800">{formatCurrency(lost.acv)}</td>
                <td className="px-4 py-2 text-slate-500">Cancelled or competitor loss records</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                <td className="px-4 py-2.5">Total Delayed / At Risk</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatNumber(delayedTotal.count)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-amber-900">{formatCurrency(delayedTotal.acv)}</td>
                <td className="px-4 py-2.5 text-slate-500">Monitored renewal contracts requiring escalation</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-slate-300 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 page-break-avoid">
        <div className="flex items-center gap-2">
          {reconcile.status === 'reconciled' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 font-semibold border border-emerald-300">
              <CheckCircle2 size={13} className="text-emerald-600" />
              Source check: reconciles to Excel
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 text-amber-800 font-semibold border border-amber-300">
              <AlertCircle size={13} className="text-amber-600" />
              Source check: pending verification
            </span>
          )}
          <span className="text-slate-400">· Full snapshot: 3,093 deals / $451.99M</span>
        </div>

        <div className="text-right">
          <p>Generated: <span className="font-mono text-slate-700">{generatedAt}</span></p>
          <p className="text-[10px] text-slate-400">Mobileum Horizon Renewals Intelligence · Executive Report</p>
        </div>
      </footer>
    </div>
  )
}
