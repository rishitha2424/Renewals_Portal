import React, { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer, Presentation, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, Calendar, ArrowLeft, ArrowUp } from 'lucide-react'
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
import ExcludedTypesNote from '@/components/common/ExcludedTypesNote'

export default function ExecutiveView() {
  const { activeSnapshotId, setActiveSnapshotId, compareSnapshotId, snapshots: storeSnapshots } = useAppStore()
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)
  const navigate = useNavigate()
  const [scrollProgress, setScrollProgress] = useState(0)
  const [showScrollTop, setShowScrollTop] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight
      if (totalHeight > 0) {
        setScrollProgress(Math.min(100, Math.max(0, (window.scrollY / totalHeight) * 100)))
      }
      setShowScrollTop(window.scrollY > 300)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
    if (regionsQuery.data?.regions?.length) list.push({ id: 'exec-regions', title: regionsQuery.data.regions.length > 10 ? 'Top 10 Regions' : 'Regions by ACV' })
    if (buQuery.data?.rows?.length) list.push({ id: 'exec-bu', title: 'Business Units' })
    if (delayedQuery.data?.delayed_renewals || delayedQuery.data?.slippage) list.push({ id: 'exec-delayed', title: 'Delayed & Slippage to 2027' })
    return list
  }, [overviewQuery.data, approvalsQuery.data, expiryQuery.data, regionsQuery.data, buQuery.data, delayedQuery.data])

  const currentSnapshotDate = overviewQuery.data?.snapshot_date || ''

  useEffect(() => {
    const prevTitle = document.title
    if (currentSnapshotDate) {
      document.title = `Renewals Executive Summary - ${formatDate(currentSnapshotDate)}`
    }
    return () => {
      document.title = prevTitle
    }
  }, [currentSnapshotDate])

  if (isLoading) {
    return (
      <div className="min-h-full bg-white flex flex-col items-center justify-center p-8 text-center" id="executive-loading">
        <Loader2 className="w-9 h-9 text-[#12284C] animate-spin mb-3" />
        <h2 className="text-lg font-bold text-slate-800">Loading report…</h2>
        <p className="text-xs text-slate-500 mt-1">Retrieving Mobileum Renewals Intelligence executive data</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="min-h-full bg-white flex flex-col items-center justify-center p-8 text-center" id="executive-error">
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
  const deltaYesterday = total.delta_yesterday || null
  const deltaLastWeek = total.delta_lastweek || null

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
  const regionsTitle = allRegions.length > 10 ? '5. Top 10 Regions by ACV' : '5. Regions by ACV'

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
  const slippageTotal = slippage.total || delayed.slippage_total || { count: 0, acv: 0 }
  const slippedFromList = slippage.slipped_from || []
  const slippageCategories = slippage.categories || {}

  const lost = delayed.lost_card || delayed.lost || { count: 0, acv: 0 }

  const delayedRowsSumCount = overdue.count + delayedAhead.count
  const delayedRowsSumAcv = overdue.acv + delayedAhead.acv

  const slippageRowsSumCount = slippedFromList.reduce((acc: number, r: any) => acc + (r.count || 0), 0)
  const slippageRowsSumAcv = slippedFromList.reduce((acc: number, r: any) => acc + (r.acv || 0), 0)

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
    mismatchErrors.push(`Slippage to 2027 table rows (${slippageRowsSumCount} deals / ${formatCurrency(slippageRowsSumAcv)}) do not reconcile to Slippage to 2027 total (${slippageTotal.count} deals / ${formatCurrency(slippageTotal.acv)})`)
  }

  const hasReconciliationMismatch = mismatchErrors.length > 0

  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })

  return (
    <div className="min-h-full bg-white text-slate-900 font-sans p-6 sm:p-10 max-w-[1000px] mx-auto space-y-7" id="executive-report-view">
      {/* Print CSS styles */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          body {
            background: #ffffff !important;
            color: #0f172a !important;
            font-size: 10pt !important;
            line-height: 1.4 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print, nav, aside, header.app-header, header.topbar, #app-sidebar, [role="navigation"] {
            display: none !important;
          }
          #executive-report-header,
          .print-header {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-bottom: 1.5rem !important;
            padding-bottom: 1rem !important;
            border-bottom: 2px solid #1e293b !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #executive-report-header img {
            display: inline-block !important;
            visibility: visible !important;
            width: 40px !important;
            height: 40px !important;
            object-fit: contain !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #exec-headline {
            display: flex !important;
            visibility: visible !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            background-color: #f8fafc !important;
            border: 1px solid #cbd5e1 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .page-break-avoid, .card {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          table {
            page-break-inside: auto;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Scroll Progress Bar (Screen only) */}
      <div className="fixed top-0 left-0 right-0 h-[3px] bg-slate-200 z-50 no-print">
        <div
          className="h-full bg-[#00A3AD] transition-all duration-75"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Floating Quick Scroll to Top (Screen only) */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 p-2.5 rounded-full bg-[#12284C] text-white shadow-lg hover:bg-[#00A3AD] transition-all duration-200 z-40 no-print flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          title="Scroll to top"
          id="exec-floating-top-btn"
        >
          <ArrowUp size={16} />
          <span className="hidden sm:inline">Top</span>
        </button>
      )}

      {/* Action Bar (hidden in print) */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              try {
                if (window.history.length > 1) {
                  navigate(-1)
                } else {
                  navigate('/')
                }
              } catch {
                navigate('/')
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition cursor-pointer"
            id="exec-back-btn"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} className="mr-1 text-emerald-600" /> Standalone Print Report
          </span>
          <span className="text-xs text-slate-500 hidden sm:inline">Opens in new tab · Optimized for A4 / PDF export</span>
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

      {/* Report Header (Print & Screen) */}
      <div id="executive-report-header" className="print-header mb-6 pb-4 border-b-2 border-slate-800 block">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/assets/logo.png"
              alt="Mobileum"
              className="w-10 h-10 object-contain flex-shrink-0"
              style={{ display: 'inline-block', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
            />
            <div>
              <h1 className="font-extrabold text-2xl tracking-tight text-[#12284C]">
                Mobileum Renewals Intelligence · Executive Summary
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Executive Portfolio Update · As of <span className="font-semibold text-slate-800">{formatDate(snapshotDate)}</span> · Period: <span className="font-semibold text-slate-800">{period}</span> · Scope: <span className="font-semibold text-slate-800">Renewals</span>
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <p className="font-semibold text-slate-600">Confidential &amp; Proprietary</p>
            <p>{formatDate(snapshotDate)}</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <ExcludedTypesNote excluded={overview?.other_types_excluded} />
      </div>

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
          <div className="px-4 py-2.5 bg-blue-50/60 border-b border-slate-200 border-l-4 border-l-blue-600 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-blue-900">
              1. Forecast Category Summary
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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
          <div className="px-4 py-2.5 bg-teal-50/60 border-b border-slate-200 border-l-4 border-l-[#00A3AD] flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-teal-900">
              2. Movement vs. Historical Baselines
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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
                  <td className="px-4 py-2 text-slate-500">{deltaYesterday ? formatDate(deltaYesterday.snapshot_date || '') : '—'}</td>
                  {deltaYesterday ? (
                    <>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaYesterday.count < 0 ? 'text-rose-600' : deltaYesterday.count > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {deltaYesterday.count > 0 ? `+${deltaYesterday.count}` : deltaYesterday.count}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaYesterday.acv < 0 ? 'text-rose-600' : deltaYesterday.acv > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {deltaYesterday.acv >= 0 ? `+${formatCurrency(deltaYesterday.acv)}` : `-${formatCurrency(Math.abs(deltaYesterday.acv))}`}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-right text-slate-400 font-normal">n/a</td>
                      <td className="px-4 py-2 text-right text-slate-400 font-normal">n/a</td>
                    </>
                  )}
                </tr>
                <tr className="hover:bg-slate-50/50">
                  <td className="px-4 py-2 font-medium text-slate-800">Movement vs. Last Week</td>
                  <td className="px-4 py-2 text-slate-500">{deltaLastWeek ? formatDate(deltaLastWeek.snapshot_date || '') : '—'}</td>
                  {deltaLastWeek ? (
                    <>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaLastWeek.count < 0 ? 'text-rose-600' : deltaLastWeek.count > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {deltaLastWeek.count > 0 ? `+${deltaLastWeek.count}` : deltaLastWeek.count}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${deltaLastWeek.acv < 0 ? 'text-rose-600' : deltaLastWeek.acv > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {deltaLastWeek.acv >= 0 ? `+${formatCurrency(deltaLastWeek.acv)}` : `-${formatCurrency(Math.abs(deltaLastWeek.acv))}`}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-right text-slate-400 font-normal">n/a</td>
                      <td className="px-4 py-2 text-right text-slate-400 font-normal">n/a</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Approval Status Summary table */}
      <section id="exec-approvals" className="scroll-mt-24 mb-6 page-break-avoid">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-emerald-50/60 border-b border-slate-200 border-l-4 border-l-emerald-600 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-emerald-900">
              3. Approval Status Summary
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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
          <div className="px-4 py-2.5 bg-indigo-50/60 border-b border-slate-200 border-l-4 border-l-indigo-600 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-indigo-900">
              4. Expiry Quarter × Forecast Category
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 border-l-4 border-l-[#12284C] flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-[#12284C]">
              {regionsTitle}
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
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
                    <td className="px-3 py-2 font-medium text-slate-800">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 mr-2 tabular-nums">{i + 1}</span>
                      {reg.region}
                    </td>
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
          <div className="px-4 py-2.5 bg-blue-50/60 border-b border-slate-200 border-l-4 border-l-blue-600 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-blue-900">
              6. Business Unit Breakdown
            </h2>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
          </div>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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

      {/* 7. Delayed Renewals & Slippage to 2027 (Separated per Item 1) */}
      <section id="exec-delayed" className="scroll-mt-24 mb-6 space-y-6 page-break-avoid">
        {/* 7a. Delayed Renewals Summary */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-rose-50/60 border-b border-slate-200 border-l-4 border-l-rose-600 flex items-center justify-between">
            <h2 className="font-bold text-xs uppercase tracking-wider text-rose-900">
              7a. Delayed Renewals Summary
            </h2>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                {totalAcv > 0 ? `${((delayedRenewalsTotal.acv / totalAcv) * 100).toFixed(1)}%` : '—'} of Quarter Total
              </span>
              <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-[11px] font-medium text-slate-500 hover:text-[#00A3AD] transition-colors no-print cursor-pointer">↑ Top</button>
            </div>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            Total Delayed = Overdue + Delayed, close date ahead. Open renewals matching the delayed group setting.
          </p>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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

        {/* 7b. Slippage to 2027 */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-amber-50/60 border-b border-slate-200 border-l-4 border-l-amber-500 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-xs uppercase tracking-wider text-amber-900">
                7b. Slippage to 2027
              </h2>
              {slippage.type_filter_note && (
                <span className="text-[10px] text-slate-500 font-normal">
                  ({slippage.type_filter_note})
                </span>
              )}
            </div>
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              {formatNumber(slippageTotal.count)} deals · {formatCurrency(slippageTotal.acv)}
            </span>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            {slippage.rule_caption || 'Renewals whose service ended this year or earlier but are now expected to close in 2027.'}
          </p>

          {/* Category breakdown */}
          {Object.keys(slippageCategories).length > 0 && (
            <div className="px-4 py-2 bg-slate-50/30 border-b border-slate-100 flex flex-wrap gap-4 text-xs">
              {['Commit', 'Best Case', 'Pipeline', 'Blank'].map(cat => {
                const cVal = slippageCategories[cat] || { count: 0, acv: 0 }
                if (!cVal.count && !cVal.acv) return null
                const label = cat === 'Blank' ? 'Not yet proposed' : cat
                return (
                  <div key={cat} className="text-[11px] text-slate-600">
                    <span className="font-medium text-slate-800">{label}:</span>{' '}
                    <span className="tabular-nums font-semibold">{formatNumber(cVal.count)}</span> ({formatCurrency(cVal.acv)})
                  </div>
                )
              })}
            </div>
          )}

          {/* Slipped from table */}
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="px-4 py-2">Service start year</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">ACV (USD)</th>
                  <th className="px-4 py-2">Expected Close Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {slippedFromList.map((sf: any) => (
                  <tr key={sf.expiry_year} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-amber-900">From {sf.expiry_year}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatNumber(sf.count)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-800">{formatCurrency(sf.acv)}</td>
                    <td className="px-4 py-2 text-slate-500">Closing in {slippage.next_year || '2027'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/80 font-bold border-t-2 border-slate-300 text-slate-900">
                  <td className="px-4 py-2.5">Total Slippage to 2027</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(slippageTotal.count)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-amber-900">{formatCurrency(slippageTotal.acv)}</td>
                  <td className="px-4 py-2.5 text-slate-500">Expected to close in {slippage.next_year || '2027'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* 7c. Lost since start of quarter (Outside both totals) */}
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-none">
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 border-l-4 border-l-slate-500">
            <h2 className="font-bold text-xs uppercase tracking-wider text-slate-800">
              7c. Lost since start of quarter
            </h2>
          </div>
          <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-slate-50/50 border-b border-slate-100">
            Deals deleted or lost since the start of quarter baseline (excluded from delayed totals).
          </p>
          <div className="overflow-x-auto">
            <table className="exec-table text-xs text-left">
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
          <p className="text-[10px] text-slate-400">Mobileum Horizon Renewals Intelligence · Executive Summary</p>
        </div>
      </footer>
    </div>
  )
}
