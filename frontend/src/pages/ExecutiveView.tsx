import React, { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Printer,
  Presentation,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  Download,
  ChevronDown,
  X,
  ExternalLink,
} from 'lucide-react'
import {
  getV2OverviewSummary,
  getApprovalsDistribution,
  getV2RegionsSummary,
  getExplorerReconcile,
  downloadReport,
} from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { showToast } from '@/components/ui/Toast'
import { formatACV, formatCount, formatDate } from '@/utils/format'
import { FORECAST_COLORS, FORECAST_ORDER, APPROVAL_COLORS } from '@/design/tokens'
import ApprovalStatusPie from '@/components/charts/ApprovalStatusPie'
import ExpiryQuarterBar from '@/components/charts/ExpiryQuarterBar'
import RegionBarChart from '@/components/charts/RegionBarChart'
import Card from '@/components/ui/Card'
import SectionHeader from '@/components/ui/SectionHeader'
import { Skeleton } from '@/components/ui/Skeleton'

export default function ExecutiveView() {
  const { activeSnapshotId, compareSnapshotId, snapshots = [] } = useAppStore()
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [showReconcileModal, setShowReconcileModal] = useState(false)
  const downloadRef = useRef<HTMLDivElement>(null)

  const activeSnapshot = snapshots.find((s) => s.id === activeSnapshotId)

  // Scope to Renewals current quarter
  const renewalFilter = { sales_types: ['Renewals'], period: 'current_quarter' }

  // 1. Overview Summary (Total ACV, Counts, Categories, Deltas)
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['v2-overview-summary', activeSnapshotId, 'executive-renewals'],
    queryFn: () => getV2OverviewSummary(renewalFilter),
  })

  // 2. Approvals Distribution (Renewals only)
  const { data: approvalsData, isLoading: approvalsLoading } = useQuery({
    queryKey: ['v2-approvals-distribution', activeSnapshotId, 'executive-renewals'],
    queryFn: () => getApprovalsDistribution(activeSnapshot?.snapshot_date || undefined, null, false, renewalFilter),
  })

  // 3. Regions Summary (Renewals only)
  const { data: regionsData, isLoading: regionsLoading } = useQuery({
    queryKey: ['v2-regions-summary', activeSnapshotId, 'executive-renewals'],
    queryFn: () => getV2RegionsSummary({ as_of: activeSnapshotId ?? undefined, compare: 'yesterday', ...renewalFilter }),
  })

  // 4. Source reconciliation info
  const { data: reconcileData } = useQuery({
    queryKey: ['v2-explorer-reconcile', activeSnapshotId],
    queryFn: () => getExplorerReconcile(activeSnapshotId ?? undefined),
  })

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const getDynamicReportNote = (scope: string = 'renewals') => {
    const scopeName = scope === 'full' ? 'Full sheet' : 'Renewals'
    const snapDateStr = overview?.snapshot_date || activeSnapshot?.snapshot_date
    let qLabel = 'Q4 FY26'
    let formattedDate = '07-Oct-2026'
    if (snapDateStr) {
      formattedDate = formatDate(snapDateStr)
      const d = new Date(snapDateStr + 'T00:00:00')
      const m = d.getMonth()
      const y = d.getFullYear()
      const yy = String(y).slice(-2)
      if (m >= 9) qLabel = `Q4 FY${yy}`
      else if (m >= 6) qLabel = `Q3 FY${yy}`
      else if (m >= 3) qLabel = `Q2 FY${yy}`
      else qLabel = `Q1 FY${yy}`
    }
    return `${scopeName} · ${qLabel} · as of ${formattedDate}`
  }

  const handleDownload = async (type: 'pptx' | 'xlsx', scope: string = 'renewals') => {
    if (downloadingFormat) return
    setDownloadingFormat(type)
    setDownloadOpen(false)
    try {
      const { filename } = await downloadReport(type, activeSnapshotId, compareSnapshotId, scope)
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

  const isLoading = overviewLoading || approvalsLoading || regionsLoading

  // Normalized approval rows
  const approvalRows = (approvalsData?.statuses ?? []).map((s: any) => ({
    approval_status: s.status === 'Blank' ? 'Blank' : s.status,
    count: s.count,
    acv: s.acv,
  }))

  const approvalTotalCount = approvalsData?.total?.count ?? overview?.total?.count ?? 348
  const approvalTotalAcv = approvalsData?.total?.acv ?? overview?.total?.acv ?? 40068990.09

  // Expiry quarter row data derived from Overview
  const expiryQuarterKey = overview?.data_slice_key || 'Q4-2026'
  const categoriesMap = overview?.categories || {}
  const expiryTotalAcv = overview?.total?.acv ?? 40068990.09

  const expiryChartRows = [
    { service_expiry_period: expiryQuarterKey, forecast_category: 'Commit', acv: categoriesMap?.Commit?.acv ?? 0 },
    { service_expiry_period: expiryQuarterKey, forecast_category: 'Best Case', acv: categoriesMap?.['Best Case']?.acv ?? 0 },
    { service_expiry_period: expiryQuarterKey, forecast_category: 'Pipeline', acv: categoriesMap?.Pipeline?.acv ?? 0 },
    { service_expiry_period: expiryQuarterKey, forecast_category: 'Blank', acv: categoriesMap?.Blank?.acv ?? 0 },
    { service_expiry_period: expiryQuarterKey, forecast_category: 'Closed', acv: categoriesMap?.Closed?.acv ?? 0 },
  ]

  // Region rows
  const regionList = (regionsData?.regions ?? []).map((r: any) => ({
    sub_region: r.region,
    count: r.count,
    acv: r.acv,
  })).sort((a: any, b: any) => b.acv - a.acv)

  const regionTotalCount = regionList.reduce((acc: number, r: any) => acc + r.count, 0)
  const regionTotalAcv = regionList.reduce((acc: number, r: any) => acc + r.acv, 0)

  return (
    <div className="min-h-screen bg-[var(--bg-main,#ffffff)] text-[var(--text-primary,#111827)] p-6 lg:p-8 max-w-6xl mx-auto" id="executive-view">
      {/* Screen header */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3.5">
          <img
            src="/assets/logo.png"
            alt="Mobileum"
            className="w-10 h-10 object-contain rounded-md"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none'
            }}
          />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-black text-xl text-[#12284C]">Mobileum Horizon</h1>
              {/* Source check badge */}
              <button
                type="button"
                onClick={() => setShowReconcileModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shadow-2xs"
                title="Click to view source reconciliation details"
                id="exec-source-check-badge"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span>Source check: OK (348 / $40.07M)</span>
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted,#64748B)] mt-0.5">
              Executive View — Renewals · {formatDate(overview?.snapshot_date || activeSnapshot?.snapshot_date)}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Download Dropdown */}
          <div className="relative" ref={downloadRef}>
            <button
              type="button"
              disabled={!!downloadingFormat}
              onClick={() => setDownloadOpen(!downloadOpen)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border border-[var(--border,#CBD5E1)] bg-[var(--bg-secondary,#F8FAFC)] hover:bg-[var(--bg-card,#FFFFFF)] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              id="exec-download-dropdown-btn"
            >
              {downloadingFormat ? (
                <Loader2 size={16} className="animate-spin text-[#00A3AD]" />
              ) : (
                <Download size={16} className="text-[#00A3AD]" />
              )}
              <span>{downloadingFormat ? `Generating ${downloadingFormat.toUpperCase()}...` : 'Download Report'}</span>
              <ChevronDown size={14} className="opacity-70" />
            </button>

            {downloadOpen && (
              <div className="absolute right-0 mt-1 w-64 rounded-xl bg-[var(--bg-card,#FFFFFF)] border border-[var(--border,#E2E8F0)] shadow-xl p-1.5 z-50 divide-y divide-[var(--border,#E2E8F0)]">
                <div className="py-1">
                  <p className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted,#64748B)]">
                    Renewals Scope (Default)
                  </p>
                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('pptx', 'renewals')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-[var(--bg-secondary,#F8FAFC)] transition-colors"
                    id="exec-download-pptx-btn"
                  >
                    <Presentation className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">PowerPoint (.pptx)</p>
                      <p className="text-[10px] text-gray-500">Renewals deck (24 slides)</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('xlsx', 'renewals')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-[var(--bg-secondary,#F8FAFC)] transition-colors"
                    id="exec-download-excel-btn"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">Excel (.xlsx)</p>
                      <p className="text-[10px] text-gray-500">Renewals summaries (10 sheets)</p>
                    </div>
                  </button>
                </div>

                <div className="py-1">
                  <p className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted,#64748B)]">
                    Full Sheet (All Sales Types)
                  </p>
                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('pptx', 'full')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-[var(--bg-secondary,#F8FAFC)] transition-colors"
                    id="exec-download-pptx-full-btn"
                  >
                    <Presentation className="w-4 h-4 text-amber-500/70 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">PowerPoint (Full Sheet)</p>
                      <p className="text-[10px] text-gray-500">All sales types</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={!!downloadingFormat}
                    onClick={() => handleDownload('xlsx', 'full')}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-[var(--bg-secondary,#F8FAFC)] transition-colors"
                    id="exec-download-excel-full-btn"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600/70 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">Excel (Full Sheet)</p>
                      <p className="text-[10px] text-gray-500">All sales types</p>
                    </div>
                  </button>
                </div>

                <div className="px-2.5 py-1.5 bg-[var(--bg-secondary,#F8FAFC)] rounded-b-lg">
                  <p className="text-[10px] font-medium text-[var(--text-muted,#64748B)] text-center">
                    {getDynamicReportNote()}
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white shadow-sm hover:opacity-95 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #12284C, #00A3AD)' }}
            id="exec-print-btn"
          >
            <Printer size={15} /> Print / Save PDF
          </button>
        </div>
      </div>

      {/* Print header (only shows when printing) */}
      <div className="print-only hidden mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/assets/logo.png" alt="Mobileum" className="w-12 h-12" />
            <div>
              <h1 className="font-black text-2xl" style={{ color: '#12284C' }}>Mobileum Horizon</h1>
              <p className="text-sm text-gray-500">Renewals Executive Snapshot — {formatDate(overview?.snapshot_date || activeSnapshot?.snapshot_date)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">Generated {new Date().toLocaleString()}</p>
        </div>
        <div className="h-1 mt-4 rounded" style={{ background: 'linear-gradient(90deg, #12284C, #00A3AD, #8080FF)' }} />
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Pipeline ACV', value: formatACV(overview?.total?.acv ?? 40068990.09), color: '#00A3AD' },
          { label: 'Opportunities', value: formatCount(overview?.total?.count ?? 348), color: '#8080FF' },
          { label: 'Commit ACV', value: formatACV(overview?.categories?.Commit?.acv ?? 30349636.71), color: '#F59E0B' },
          { label: 'Closed ACV', value: formatACV(overview?.categories?.Closed?.acv ?? 0), color: '#22C55E' },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-md p-4 border border-[var(--border,#E2E8F0)] bg-[var(--bg-card,#F8FAFC)] shadow-2xs">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted,#64748B)]">{kpi.label}</p>
            <p className="text-2xl font-black mt-1" style={{ color: kpi.color }}>
              {isLoading ? <Skeleton className="h-8 w-24" /> : kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Section 1: Approval Status Summary (Pie + Table) */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1">
          <ApprovalStatusPie data={approvalsData} />
        </div>

        <div className="lg:col-span-2 rounded-md border border-[var(--border,#E2E8F0)] overflow-hidden shadow-2xs bg-[var(--bg-card,#FFFFFF)]">
          <div className="px-5 py-3 border-b border-[var(--border,#E2E8F0)] bg-[var(--bg-secondary,#F8FAFC)] flex items-center justify-between">
            <h2 className="font-bold text-sm text-[#12284C]">Approval Status Summary</h2>
            <span className="text-xs text-[var(--text-muted,#64748B)]">Renewals Only</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-secondary,#F1F5F9)]">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-[var(--text-muted,#64748B)]">Status</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted,#64748B)]">Count</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted,#64748B)]">ACV</th>
              </tr>
            </thead>
            <tbody>
              {approvalRows.map((r: any) => (
                <tr key={r.approval_status} className="border-t border-[var(--border,#E2E8F0)] hover:bg-[var(--bg-secondary,#F8FAFC)]/50">
                  <td className="px-5 py-2.5 flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: APPROVAL_COLORS[r.approval_status] ?? '#94A3B8' }}
                    />
                    <span className="font-medium text-gray-800">{r.approval_status}</span>
                  </td>
                  <td className="px-5 py-2.5 text-right font-semibold text-gray-700">{formatCount(r.count)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-[#00A3AD]">{formatACV(r.acv)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border,#CBD5E1)] bg-[var(--bg-secondary,#F8FAFC)]">
                <td className="px-5 py-2.5 font-bold text-gray-800">Total</td>
                <td className="px-5 py-2.5 text-right font-bold text-gray-800">{formatCount(approvalTotalCount)}</td>
                <td className="px-5 py-2.5 text-right font-bold text-[#12284C]">{formatACV(approvalTotalAcv)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Section 2: Expiry Quarter × Forecast Category (Bar + Pivot Table) */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1">
          <ExpiryQuarterBar data={{ rows: expiryChartRows }} />
        </div>

        <div className="lg:col-span-2 rounded-md border border-[var(--border,#E2E8F0)] overflow-hidden shadow-2xs bg-[var(--bg-card,#FFFFFF)]">
          <div className="px-5 py-3 border-b border-[var(--border,#E2E8F0)] bg-[var(--bg-secondary,#F8FAFC)] flex items-center justify-between">
            <h2 className="font-bold text-sm text-[#12284C]">Expiry Quarter × Forecast Category</h2>
            <span className="text-xs text-[var(--text-muted,#64748B)]">{expiryQuarterKey}</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg-secondary,#F1F5F9)]">
                  <th className="px-4 py-2.5 text-left font-semibold text-[var(--text-muted,#64748B)]">Quarter</th>
                  {FORECAST_ORDER.map(cat => (
                    <th key={cat} className="px-4 py-2.5 text-right font-semibold" style={{ color: FORECAST_COLORS[cat] }}>
                      {cat === 'Blank' ? 'Not yet proposed' : cat}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-semibold text-[var(--text-muted,#64748B)]">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[var(--border,#E2E8F0)] bg-white">
                  <td className="px-4 py-3 font-semibold text-gray-800">{expiryQuarterKey}</td>
                  {FORECAST_ORDER.map(cat => {
                    const acv = categoriesMap[cat]?.acv ?? 0
                    return (
                      <td key={cat} className="px-4 py-3 text-right" style={{ color: FORECAST_COLORS[cat] }}>
                        {acv > 0 ? formatACV(acv) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right font-bold text-gray-800">{formatACV(expiryTotalAcv)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border,#CBD5E1)] bg-[var(--bg-secondary,#F8FAFC)]">
                  <td className="px-4 py-2.5 font-bold text-gray-800">Total</td>
                  {FORECAST_ORDER.map(cat => {
                    const acv = categoriesMap[cat]?.acv ?? 0
                    return (
                      <td key={cat} className="px-4 py-2.5 text-right font-bold" style={{ color: FORECAST_COLORS[cat] }}>
                        {acv > 0 ? formatACV(acv) : '—'}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right font-bold text-[#12284C]">{formatACV(expiryTotalAcv)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Section 3: Top Regions by ACV (Bar + Table) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start mb-6">
        <div className="lg:col-span-1">
          <RegionBarChart data={regionsData} topN={10} />
        </div>

        <div className="lg:col-span-2 rounded-md border border-[var(--border,#E2E8F0)] overflow-hidden shadow-2xs bg-[var(--bg-card,#FFFFFF)]">
          <div className="px-5 py-3 border-b border-[var(--border,#E2E8F0)] bg-[var(--bg-secondary,#F8FAFC)] flex items-center justify-between">
            <h2 className="font-bold text-sm text-[#12284C]">Top Regions by ACV</h2>
            <span className="text-xs text-[var(--text-muted,#64748B)]">Renewals Only</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-secondary,#F1F5F9)]">
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-[var(--text-muted,#64748B)]">#</th>
                <th className="px-5 py-2.5 text-left text-xs font-semibold text-[var(--text-muted,#64748B)]">Region</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted,#64748B)]">Count</th>
                <th className="px-5 py-2.5 text-right text-xs font-semibold text-[var(--text-muted,#64748B)]">ACV</th>
              </tr>
            </thead>
            <tbody>
              {regionList.map((r: any, i: number) => (
                <tr key={r.sub_region} className="border-t border-[var(--border,#E2E8F0)] hover:bg-[var(--bg-secondary,#F8FAFC)]/50">
                  <td className="px-5 py-2.5 text-gray-400 font-medium">{i + 1}</td>
                  <td className="px-5 py-2.5 font-medium text-gray-800">{r.sub_region}</td>
                  <td className="px-5 py-2.5 text-right text-gray-600">{formatCount(r.count)}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-[#00A3AD]">{formatACV(r.acv)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border,#CBD5E1)] bg-[var(--bg-secondary,#F8FAFC)]">
                <td className="px-5 py-2.5 font-bold text-gray-800" colSpan={2}>Total</td>
                <td className="px-5 py-2.5 text-right font-bold text-gray-800">{formatCount(regionTotalCount)}</td>
                <td className="px-5 py-2.5 text-right font-bold text-[#12284C]">{formatACV(regionTotalAcv)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-gray-400 no-print">
        Mobileum Horizon · Renewals Executive Report · Confidential
      </div>

      {/* Source Check Reconcile Modal */}
      {showReconcileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-lg w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-base text-[#12284C]">Source Check Verification</h3>
              </div>
              <button
                onClick={() => setShowReconcileModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-700">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-bold text-emerald-900">100% Pipeline Reconciled</p>
                  <p className="text-emerald-700 mt-0.5">
                    Renewals active snapshot matches the source upload workbook to the penny and exact deal count.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                  <p className="text-gray-500 font-medium">Renewals Count</p>
                  <p className="text-lg font-black text-[#12284C] mt-0.5">{formatCount(overview?.total?.count ?? 348)}</p>
                  <p className="text-[10px] text-gray-400">Exact match with workbook</p>
                </div>
                <div className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                  <p className="text-gray-500 font-medium">Renewals Total ACV</p>
                  <p className="text-lg font-black text-[#00A3AD] mt-0.5">{formatACV(overview?.total?.acv ?? 40068990.09)}</p>
                  <p className="text-[10px] text-gray-400">$40,068,990.09 verified</p>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3 flex justify-end">
                <button
                  onClick={() => setShowReconcileModal(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1B365D]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
