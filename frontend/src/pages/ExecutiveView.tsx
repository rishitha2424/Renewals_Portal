import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, Presentation, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, Calendar } from 'lucide-react'
import {
  getV2OverviewSummary,
  getApprovalsDistribution,
  getV2ExpirySummary,
  getV2RegionsSummary,
  getV2BusinessUnitsSummary,
  getV2DelayedSummary,
  getExplorerReconcile,
  getSnapshots,
  downloadReport,
} from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { showToast } from '@/components/ui/Toast'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  getForecastCategoryLabel,
  getQuarterFromDate,
} from '@/utils/format'
import SectionNav from '@/components/common/SectionNav'

export default function ExecutiveView() {
  const { activeSnapshotId, setActiveSnapshotId, compareSnapshotId, snapshots: storeSnapshots } = useAppStore()
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)

  const { data: fetchedSnapshots = [] } = useQuery({
    queryKey: ['snapshots'],
    queryFn: getSnapshots,
  })

  const allSnapshots = fetchedSnapshots.length > 0 ? fetchedSnapshots : storeSnapshots
  const activeSnap = allSnapshots.find((s: any) => s.id === activeSnapshotId)
  const defaultSnap = allSnapshots.find((s: any) => s.is_active_today) || allSnapshots[0]
  const effectiveSnapshotId = activeSnap?.id || activeSnapshotId || defaultSnap?.id

  // 1. Overview Summary (Headline, Forecast categories, Movements)
  const overviewQuery = useQuery({
    queryKey: ['exec-v2-overview', effectiveSnapshotId],
    queryFn: () => getV2OverviewSummary({ as_of: effectiveSnapshotId, sales_types: ['Renewals'], period: 'current_quarter' }),
    enabled: !!effectiveSnapshotId,
  })

  // 2. Approvals Distribution
  const approvalsQuery = useQuery({
    queryKey: ['exec-v2-approvals', effectiveSnapshotId],
    queryFn: () => getApprovalsDistribution(effectiveSnapshotId ?? undefined, 'yesterday', false, { as_of: effectiveSnapshotId, sales_types: ['Renewals'], period: 'current_quarter' }),
    enabled: !!effectiveSnapshotId,
  })

  // 3. Expiry Summary
  const expiryQuery = useQuery({
    queryKey: ['exec-v2-expiry', effectiveSnapshotId],
    queryFn: () => getV2ExpirySummary({ as_of: effectiveSnapshotId, compare: 'yesterday', filterSpec: { as_of: effectiveSnapshotId, sales_types: ['Renewals'] } }),
    enabled: !!effectiveSnapshotId,
  })

  // 4. Regions Summary
  const regionsQuery = useQuery({
    queryKey: ['exec-v2-regions', effectiveSnapshotId],
    queryFn: () => getV2RegionsSummary({ as_of: effectiveSnapshotId, compare: 'yesterday' }),
    enabled: !!effectiveSnapshotId,
  })

  // 5. Business Units Summary
  const buQuery = useQuery({
    queryKey: ['exec-v2-bu', effectiveSnapshotId],
    queryFn: () => getV2BusinessUnitsSummary({ as_of: effectiveSnapshotId, compare: 'yesterday' }),
    enabled: !!effectiveSnapshotId,
  })

  // 6. Delayed Summary
  const delayedQuery = useQuery({
    queryKey: ['exec-v2-delayed', effectiveSnapshotId],
    queryFn: () => getV2DelayedSummary({ as_of: effectiveSnapshotId, compare: 'yesterday' }),
    enabled: !!effectiveSnapshotId,
  })

  // 7. Reconcile check
  const reconcileQuery = useQuery({
    queryKey: ['exec-v2-reconcile', effectiveSnapshotId],
    queryFn: () => getExplorerReconcile(effectiveSnapshotId),
    enabled: !!effectiveSnapshotId,
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
    delayedQuery.isError ||
    (overviewQuery.isSuccess && (!overviewQuery.data || !overviewQuery.data.total))

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
      const { filename } = await downloadReport(type, effectiveSnapshotId, compareSnapshotId, 'renewals', true)
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

  const executiveSections = useMemo(() => {
    const list: { id: string; title: string }[] = []
    if (overviewQuery.data?.total?.count || overviewQuery.data?.total?.acv) list.push({ id: 'exec-headline', title: 'Headline' })
    if (overviewQuery.data?.categories) list.push({ id: 'exec-forecast', title: 'Forecast Category' })
    list.push({ id: 'exec-movement', title: 'Baselines' })
    if (approvalsQuery.data?.statuses?.length) list.push({ id: 'exec-approvals', title: 'Approval Status' })
    if (expiryQuery.data?.grids) list.push({ id: 'exec-expiry', title: 'Expiry Quarter' })
    if (regionsQuery.data?.regions?.length) list.push({ id: 'exec-regions', title: 'Top Regions' })
    if (buQuery.data?.rows?.length) list.push({ id: 'exec-bu', title: 'Business Units' })
    if (delayedQuery.data?.delayed_renewals || delayedQuery.data?.slippage) list.push({ id: 'exec-delayed', title: 'Delayed & Slippage' })
    return list
  }, [overviewQuery.data, approvalsQuery.data, expiryQuery.data, regionsQuery.data, buQuery.data, delayedQuery.data])

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
            {(error as any)?.message || 'Overview data is unavailable for the selected snapshot.'}
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

  const snapshotDate = overview.snapshot_date || ''
  const period = getQuarterFromDate(snapshotDate)
  const total = overview.total || { count: 0, acv: 0 }
  const totalCount = total.count || 0
  const totalAcv = total.acv || 0

  // Snapshot date consistency check
  const responseDates = [
    { name: 'Overview', date: overview.snapshot_date },
    { name: 'Approvals', date: approvals.snapshot_date },
    { name: 'Expiry', date: expiry.snapshot_date },
    { name: 'Regions', date: regions.snapshot_date },
    { name: 'Business Units', date: bu.snapshot_date },
    { name: 'Delayed', date: delayed.snapshot_date },
    { name: 'Reconcile', date: reconcile.snapshot_date },
  ].filter(x => !!x.date)

  const distinctDates = Array.from(new Set(responseDates.map(x => x.date)))
  const hasSnapshotDateMismatch = distinctDates.length > 1

  // Category summary — dynamically build rows only from categories present in the snapshot response, using backend order
  const categories = overview.categories || {}
  const catRows = Object.keys(categories)
    .filter(catKey => {
      const d = categories[catKey]
      return d && (d.count > 0 || (d.acv != null && d.acv !== 0))
    })
    .map(catKey => {
      const d = categories[catKey]
      const isBlank = catKey === 'Blank' || catKey === 'blank' || catKey === ''
      const label = isBlank ? 'Deleted / lost in snapshot' : getForecastCategoryLabel(catKey)
      const hint = isBlank ? 'Deals marked deleted or lost in this snapshot file (counted in snapshot total)' : undefined
      const pct = totalAcv > 0 ? (d.acv / totalAcv) * 100 : 0
      return { key: catKey, label, hint, count: d.count, acv: d.acv, pct }
    })

  // Movements vs yesterday & vs last week
  const deltaYesterday = total.delta_yesterday || { count: 0, acv: 0, snapshot_date: '' }
  const deltaLastWeek = total.delta_lastweek || { count: 0, acv: 0, snapshot_date: '' }

  // Approval Status Summary - normalized and merged to prevent duplicate or conflicting statuses
  const rawApprovalStatuses = approvals.statuses || []
  const approvalMap: Record<string, { count: number; acv: number }> = {}
  rawApprovalStatuses.forEach((s: any) => {
    let key = s.status || 'Blank'
    if (key === 'Pending-Approval' || key === 'Pending Approval' || key === 'Pending') {
      key = 'Pending Approval'
    } else if (key === 'Approved' || key === 'Approved - 2nd') {
      key = 'Approved'
    } else if (key === 'Blank' || key === 'blank' || key === 'Not submitted' || key === 'Not Submitted') {
      key = 'Not submitted'
    }
    if (!approvalMap[key]) {
      approvalMap[key] = { count: 0, acv: 0 }
    }
    approvalMap[key].count += s.count || 0
    approvalMap[key].acv += s.acv || 0
  })

  const approvalOrder = ['Approved', 'Pending Approval', 'Not submitted']
  Object.keys(approvalMap).forEach(k => {
    if (!approvalOrder.includes(k)) approvalOrder.push(k)
  })

  const approvalRows = approvalOrder
    .filter(k => approvalMap[k] !== undefined)
    .map(k => {
      const d = approvalMap[k]
      const pct = totalAcv > 0 ? (d.acv / totalAcv) * 100 : 0
      return {
        status: k,
        label: k,
        count: d.count,
        acv: d.acv,
        pct,
      }
    })

  const approvalSumCount = approvalRows.reduce((acc, r) => acc + r.count, 0)
  const approvalSumAcv = approvalRows.reduce((acc, r) => acc + r.acv, 0)

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
  const buSumCount = buRows.reduce((acc: number, b: any) => acc + b.count, 0)
  const buSumAcv = buRows.reduce((acc: number, b: any) => acc + b.acv, 0)

  // Delayed summary (Delayed Renewals: Overdue + Delayed, close date ahead; Slippage: Slipped by destination; Lost: separate)
  const delayedRenewals = delayed.delayed_renewals || {}
  const overdue = delayedRenewals.overdue || delayed.overdue || { count: 0, acv: 0 }
  const delayedAhead = delayedRenewals.ahead || delayedRenewals.later_close || delayed.ahead || delayed.later_close || { count: 0, acv: 0 }
  const delayedRenewalsTotal = delayed.delayed_renewals_total || delayedRenewals.total || delayed.total || {
    count: overdue.count + delayedAhead.count,
    acv: overdue.acv + delayedAhead.acv,
  }

  const slippage = delayed.slippage || {}
  const slippedNextYear = slippage.slipped_next_year || delayed.slipped_next_year || delayed.slipped || { count: 0, acv: 0 }
  const slippedNextQuarter = slippage.slipped_next_quarter || delayed.slipped_next_quarter || { count: 0, acv: 0 }
  const slippedLaterQuarter = slippage.slipped_later_quarter || delayed.slipped_later_quarter || { count: 0, acv: 0 }
  const slippageTotal = delayed.slippage_total || slippage.total || {
    count: slippedNextYear.count + slippedNextQuarter.count + slippedLaterQuarter.count,
    acv: slippedNextYear.acv + slippedNextQuarter.acv + slippedLaterQuarter.acv,
  }

  const slippedToLaterYear = delayed.slipped_to_later_year

  const lost = delayed.lost_card || delayed.lost || { count: 0, acv: 0 }

  const delayedRowsSumCount = overdue.count + delayedAhead.count
  const delayedRowsSumAcv = overdue.acv + delayedAhead.acv

  const slippageRowsSumCount = slippedNextYear.count + slippedNextQuarter.count + slippedLaterQuarter.count
  const slippageRowsSumAcv = slippedNextYear.acv + slippedNextQuarter.acv + slippedLaterQuarter.acv

  // Runtime reconciliation checks on all tables
  const mismatchErrors: string[] = []
  const catSumCount = catRows.reduce((acc, r) => acc + r.count, 0)
  const catSumAcv = catRows.reduce((acc, r) => acc + r.acv, 0)
  if (totalCount > 0 && (catSumCount !== totalCount || Math.abs(catSumAcv - totalAcv) > 0.05)) {
    mismatchErrors.push(`Forecast Category table (${catSumCount} deals / ${formatCurrency(catSumAcv)}) does not reconcile to Portfolio Headline (${totalCount} deals / ${formatCurrency(totalAcv)})`)
  }

  if (totalCount > 0 && (approvalSumCount !== totalCount || Math.abs(approvalSumAcv - totalAcv) > 0.05)) {
    mismatchErrors.push(`Approval Status table (${approvalSumCount} deals / ${formatCurrency(approvalSumAcv)}) does not reconcile to Portfolio Headline (${totalCount} deals / ${formatCurrency(totalAcv)})`)
  }

  if (delayedRowsSumCount !== delayedRenewalsTotal.count || Math.abs(delayedRowsSumAcv - delayedRenewalsTotal.acv) > 0.05) {
    mismatchErrors.push(`Delayed Renewals table rows (${delayedRowsSumCount} deals / ${formatCurrency(delayedRowsSumAcv)}) do not reconcile to Delayed Renewals total (${delayedRenewalsTotal.count} deals / ${formatCurrency(delayedRenewalsTotal.acv)})`)
  }

  if (slippageRowsSumCount !== slippageTotal.count || Math.abs(slippageRowsSumAcv - slippageTotal.acv) > 0.05) {
    mismatchErrors.push(`Slippage table rows (${slippageRowsSumCount} deals / ${formatCurrency(slippageRowsSumAcv)}) do not reconcile to Slippage total (${slippageTotal.count} deals / ${formatCurrency(slippageTotal.acv)})`)
  }

  const hasReconciliationMismatch = mismatchErrors.length > 0

  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans p-6 sm:p-10 max-w-6xl mx-auto" id="executive-report-view">
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
          <div className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white text-xs inline-flex items-center gap-1.5 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-[#00A3AD] flex-shrink-0" />
            <span className="font-medium text-slate-500 text-xs">As of:</span>
            <select
              value={effectiveSnapshotId ?? ''}
              onChange={(e) => setActiveSnapshotId(e.target.value || null)}
              className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer text-xs pr-1"
              id="exec-as-of-select"
            >
              {allSnapshots.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({formatDate(s.snapshot_date)})
                </option>
              ))}
            </select>
          </div>

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

      {/* Dynamic Section Navigation (Screen only) */}
      <SectionNav sections={executiveSections} className="no-print mb-6" />

      {/* Snapshot Date Mismatch Warning */}
      {hasSnapshotDateMismatch && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border-2 border-red-500 text-red-900 flex items-start gap-3" id="executive-snapshot-mismatch-warning">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-sm text-red-900">Snapshot Date Inconsistency Detected</h3>
            <p className="text-xs text-red-800 mt-1">
              Data responses carry differing snapshot dates ({responseDates.map(x => `${x.name}: ${x.date}`).join(', ')}). All sections must reflect the same snapshot.
            </p>
          </div>
        </div>
      )}

      {/* Reconciliation Warning Banner */}
      {hasReconciliationMismatch && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border-2 border-amber-500 text-amber-900 flex items-start gap-3" id="executive-reconciliation-warning">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-sm text-amber-900">Totals do not reconcile</h3>
            <ul className="text-xs text-amber-800 mt-1 list-disc list-inside space-y-0.5">
              {mismatchErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
      <div id="exec-headline" className="scroll-mt-24 mb-6 p-4 rounded-lg bg-slate-50 border border-slate-300 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Portfolio Headline</span>
          <span className="font-bold text-slate-800 text-base">
            Total Active Renewals: <span className="text-[#12284C] tabular-nums text-lg">{formatNumber(totalCount)} deals</span> &nbsp;|&nbsp; <span className="text-[#00A3AD] tabular-nums text-lg">{formatCurrency(totalAcv)} Total ACV</span>
          </span>
        </div>
        <div className="text-right text-xs">
          <span className="text-slate-500 block">Current Quarter Filter:</span>
          <span className="font-semibold text-slate-700">{period} (Renewals Sales Type)</span>
        </div>
      </div>

      {/* Forecast Category Summary table */}
      <section id="exec-forecast" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              1. Forecast Category Summary
            </h2>
          </div>
          <div className="overflow-x-auto">
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
                    <td className="px-4 py-2 font-medium text-slate-800">
                      <div>{r.label}</div>
                      {r.hint && <div className="text-[10px] text-slate-500 font-normal mt-0.5">{r.hint}</div>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(r.count)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(r.acv)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total Renewals</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(catSumCount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#12284C]">{formatCurrency(catSumAcv)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* Movement vs yesterday and vs last week */}
      <section id="exec-movement" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              2. Movement vs. Historical Baselines
            </h2>
          </div>
          <div className="overflow-x-auto">
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
                  <td className="px-4 py-2 text-slate-500">{formatDate(deltaYesterday.snapshot_date || '')}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaYesterday.count < 0 ? 'text-rose-600' : deltaYesterday.count > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {deltaYesterday.count > 0 ? `+${deltaYesterday.count}` : deltaYesterday.count}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaYesterday.acv < 0 ? 'text-rose-600' : deltaYesterday.acv > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {deltaYesterday.acv >= 0 ? `+${formatCurrency(deltaYesterday.acv)}` : `-${formatCurrency(Math.abs(deltaYesterday.acv))}`}
                  </td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-slate-800">Movement vs. Last Week</td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(deltaLastWeek.snapshot_date || '')}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaLastWeek.count < 0 ? 'text-rose-600' : deltaLastWeek.count > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {deltaLastWeek.count > 0 ? `+${deltaLastWeek.count}` : deltaLastWeek.count}
                  </td>
                  <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaLastWeek.acv < 0 ? 'text-rose-600' : deltaLastWeek.acv > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                    {deltaLastWeek.acv >= 0 ? `+${formatCurrency(deltaLastWeek.acv)}` : `-${formatCurrency(Math.abs(deltaLastWeek.acv))}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Approval Status Summary table */}
      <section id="exec-approvals" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              3. Approval Status Summary
            </h2>
          </div>
          <div className="overflow-x-auto">
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
                {approvalRows.map(r => (
                  <tr key={r.status} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.label}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(r.count)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(r.acv)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatNumber(approvalSumCount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#12284C]">
                    {formatCurrency(approvalSumAcv)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100.0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* Expiry Quarter × Forecast Category table */}
      <section id="exec-expiry" className="scroll-mt-24 mb-6 page-break-avoid">
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
                  {catRows.map(cat => (
                    <th key={cat.key} className="px-3 py-2 text-right">
                      {cat.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-bold">Total ACV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expiryRows.map((r: any) => {
                  const cells = r.cells || {}
                  const rowTotalAcv = r.total?.acv || 0

                  return (
                    <tr key={r.quarter} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-semibold text-slate-800">{r.label || r.quarter}</td>
                      {catRows.map(cat => {
                        const cellAcv = cells[cat.key]?.acv || 0
                        return (
                          <td key={cat.key} className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {cellAcv > 0 ? formatCurrency(cellAcv) : '—'}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">
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
      <section id="exec-regions" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              5. Top 10 Regions by ACV
            </h2>
          </div>
          <div className="overflow-x-auto">
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
                    <td className="px-3 py-2 text-center text-slate-400 tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{reg.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(reg.count)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(reg.acv)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {reg.pct_acv != null ? `${reg.pct_acv.toFixed(1)}%` : totalAcv > 0 ? `${((reg.acv / totalAcv) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {reg.commit_pct != null ? `${reg.commit_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Business Unit table */}
      <section id="exec-bu" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              6. Business Unit Breakdown
            </h2>
          </div>
          <div className="overflow-x-auto">
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
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{formatNumber(b.count)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(b.acv)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {b.pct_acv != null ? `${b.pct_acv.toFixed(1)}%` : totalAcv > 0 ? `${((b.acv / totalAcv) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                      {b.commit_pct != null ? `${b.commit_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatNumber(buSumCount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#12284C]">
                    {formatCurrency(buSumAcv)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100.0%</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* 7. Delayed Renewals & Slippage (Separated per Item 1) */}
      <section id="exec-delayed" className="scroll-mt-24 mb-6 space-y-6 page-break-avoid">
        {/* 7a. Delayed Renewals Summary */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              7a. Delayed Renewals Summary
            </h2>
            <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              {totalAcv > 0 ? `${((delayedRenewalsTotal.acv / totalAcv) * 100).toFixed(1)}%` : '—'} of Quarter Total
            </span>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            Total Delayed = Overdue + Delayed, close date ahead. Open renewals matching the delayed group setting.
          </p>
          <div className="overflow-x-auto">
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
                  <td className="px-4 py-2 font-medium text-rose-900">Overdue Renewals</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-rose-800">{formatNumber(overdue.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-rose-800">{formatCurrency(overdue.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">Service expiry date has passed snapshot date and not yet closed</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-amber-900">Delayed, close date ahead</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatNumber(delayedAhead.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatCurrency(delayedAhead.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">Delayed renewals whose close date is still ahead (not yet overdue)</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total Delayed Renewals</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(delayedRenewalsTotal.count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-rose-900">{formatCurrency(delayedRenewalsTotal.acv)}</td>
                  <td className="px-4 py-2.5 text-slate-500">Deals staying in quarter but delayed</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 7b. Slippage Summary */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              7b. Slippage Summary
            </h2>
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              {totalAcv > 0 ? `${((slippageTotal.acv / totalAcv) * 100).toFixed(1)}%` : '—'} of Quarter Total
            </span>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            Deals that moved OUT of the selected quarter into a later one, split by destination.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="px-4 py-2">Destination</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">ACV (USD)</th>
                  <th className="px-4 py-2">Destination Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-amber-900">Slipped to next fiscal year</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatNumber(slippedNextYear.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatCurrency(slippedNextYear.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">New fiscal year is later than selected quarter year</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-amber-900">Slipped to next quarter</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatNumber(slippedNextQuarter.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatCurrency(slippedNextQuarter.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">Immediately following quarter in the same fiscal year</td>
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-amber-900">Slipped to a later quarter, same year</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatNumber(slippedLaterQuarter.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatCurrency(slippedLaterQuarter.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">Any other later quarter in the same fiscal year</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total Slippage</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(slippageTotal.count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-900">{formatCurrency(slippageTotal.acv)}</td>
                  <td className="px-4 py-2.5 text-slate-500">All renewals moving into later quarters/years</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 7c. Lost since start of quarter (Outside both totals) */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              7c. Lost since start of quarter
            </h2>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            Deals deleted or lost since the start of quarter baseline (excluded from delayed totals).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">ACV (USD)</th>
                  <th className="px-4 py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-slate-800">
                    <div>Lost since start of quarter</div>
                    <div className="text-[10px] text-slate-500 font-normal mt-0.5">Deals deleted or lost since the start of quarter baseline (excluded from delayed totals).</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{formatNumber(lost.count)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{formatCurrency(lost.acv)}</td>
                  <td className="px-4 py-2 text-slate-500">Deals deleted or lost since the start of quarter baseline (excluded from delayed totals).</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 7d. Slipped to a later year (by service expiry) */}
        {slippedToLaterYear && (
          <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
                7d. Slipped to a later year (by service expiry)
              </h2>
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                {formatNumber(slippedToLaterYear.total.count)} deals · {formatCurrency(slippedToLaterYear.total.acv)}
              </span>
            </div>
            <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
              Open renewals with Service Expiry on or before active year end closing in later years. Deals in both sections tagged also delayed (totals never combined).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="px-4 py-2">Bucket</th>
                    <th className="px-4 py-2 text-right">Deals</th>
                    <th className="px-4 py-2 text-right">ACV (USD)</th>
                    <th className="px-4 py-2">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(slippedToLaterYear.buckets || {}).map(([bKey, bVal]: [string, any]) => (
                    <tr key={bKey} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2 font-medium text-slate-800">{bVal.label}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{formatNumber(bVal.count)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">{formatCurrency(bVal.acv)}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {bKey === 'expired_before_quarter' ? 'Service expired prior to selected quarter' :
                         bKey === 'expiring_later_this_year' ? 'Expiring later in active year' : 'Expiring on last day of active year'}
                      </td>
                    </tr>
                  ))}
                  {slippedToLaterYear.excluded_adjustments?.count > 0 && (
                    <tr className="bg-amber-50/40 text-amber-900">
                      <td className="px-4 py-2 font-medium">Negative-ACV adjustments (excluded)</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatNumber(slippedToLaterYear.excluded_adjustments.count)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatCurrency(slippedToLaterYear.excluded_adjustments.acv)}</td>
                      <td className="px-4 py-2 text-amber-700">Excluded from headline totals by rule</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                    <td className="px-4 py-2.5">Total Slipped to Later Year</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(slippedToLaterYear.total.count)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-indigo-900">{formatCurrency(slippedToLaterYear.total.acv)}</td>
                    <td className="px-4 py-2.5 text-slate-500">Open renewals moving to later fiscal years</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="mt-8 pt-4 border-t border-slate-300 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 page-break-avoid">
        <div className="flex items-center gap-2">
          {reconcile.status === 'reconciled' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-50 text-emerald-800 font-semibold border border-emerald-300" id="executive-reconcile-badge">
              <CheckCircle2 size={13} className="text-emerald-600" />
              Source check: reconciles to Excel
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-50 text-rose-800 font-semibold border border-rose-300" id="executive-reconcile-badge">
              <AlertCircle size={13} className="text-rose-600" />
              Source check: {reconcile.error || reconcile.detail || 'mismatch against Excel control sheet'}
            </span>
          )}
          <span className="text-slate-400">
            · Full snapshot: {reconcile?.whole_snapshot?.total_rows != null && reconcile?.whole_snapshot?.total_acv != null ? `${formatNumber(reconcile.whole_snapshot.total_rows)} deals / ${formatCurrency(reconcile.whole_snapshot.total_acv)}` : 'Not available'}
          </span>
        </div>

        <div className="text-right">
          <p>Generated: <span className="tabular-nums text-slate-700">{generatedAt}</span></p>
          <p className="text-[10px] text-slate-400">Mobileum Horizon Renewals Intelligence · Executive Report</p>
        </div>
      </footer>
    </div>
  )
}
