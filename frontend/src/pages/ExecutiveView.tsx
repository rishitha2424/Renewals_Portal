import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, Presentation, FileSpreadsheet, Loader2 } from 'lucide-react'
import { getKpis, getApprovalStatus, getTopRegions, getForecastSummary, downloadReport } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { showToast } from '@/components/ui/Toast'
import { formatACV, formatCount, formatDate } from '@/utils/format'
import { FORECAST_COLORS, FORECAST_ORDER, APPROVAL_COLORS } from '@/design/tokens'
import ApprovalStatusPie from '@/components/charts/ApprovalStatusPie'
import ExpiryQuarterBar from '@/components/charts/ExpiryQuarterBar'
import RegionBarChart from '@/components/charts/RegionBarChart'

export default function ExecutiveView() {
  const { activeSnapshotId, compareSnapshotId } = useAppStore()
  const [downloadingFormat, setDownloadingFormat] = useState<'pptx' | 'xlsx' | null>(null)

  const { data: kpis } = useQuery({ queryKey: ['kpis'], queryFn: () => getKpis() })
  const { data: approval } = useQuery({ queryKey: ['approval-status'], queryFn: () => getApprovalStatus() })
  const { data: regions } = useQuery({ queryKey: ['top-regions'], queryFn: () => getTopRegions() })
  const { data: forecast } = useQuery({ queryKey: ['forecast-summary'], queryFn: () => getForecastSummary() })

  const today: any[] = forecast?.today ?? []
  const quarters = [...new Set(today.map((r: any) => r.service_expiry_period).filter(Boolean))].sort()

  const handleDownload = async (type: 'pptx' | 'xlsx') => {
    if (downloadingFormat) return
    setDownloadingFormat(type)
    try {
      const { filename } = await downloadReport(type, activeSnapshotId, compareSnapshotId)
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

  return (
    <div className="min-h-screen bg-white text-gray-900 p-8 max-w-6xl mx-auto" id="executive-view">
      {/* No-print header for screen */}
      <div className="no-print flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <img src="/assets/logo.png" alt="Mobileum" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="font-black text-xl text-navy">Mobileum Horizon</h1>
            <p className="text-sm text-gray-500">Executive View — {formatDate(kpis?.snapshot_date)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleDownload('pptx')}
            disabled={!!downloadingFormat}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            id="exec-download-pptx-btn"
          >
            {downloadingFormat === 'pptx' ? (
              <Loader2 size={16} className="animate-spin text-amber-600" />
            ) : (
              <Presentation size={16} className="text-amber-600" />
            )}
            <span>{downloadingFormat === 'pptx' ? 'Generating PPTX...' : 'PowerPoint (.pptx)'}</span>
          </button>

          <button
            onClick={() => handleDownload('xlsx')}
            disabled={!!downloadingFormat}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            id="exec-download-excel-btn"
          >
            {downloadingFormat === 'xlsx' ? (
              <Loader2 size={16} className="animate-spin text-emerald-600" />
            ) : (
              <FileSpreadsheet size={16} className="text-emerald-600" />
            )}
            <span>{downloadingFormat === 'xlsx' ? 'Generating Excel...' : 'Excel (.xlsx)'}</span>
          </button>

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
              <p className="text-sm text-gray-500">Snapshot: {kpis?.label} — {formatDate(kpis?.snapshot_date)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">Generated {new Date().toLocaleString()}</p>
        </div>
        <div className="h-1 mt-4 rounded" style={{ background: 'linear-gradient(90deg, #12284C, #00A3AD, #8080FF)' }} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Pipeline ACV', value: formatACV(kpis?.total_acv), color: '#00A3AD' },
          { label: 'Opportunities', value: formatCount(kpis?.total_count), color: '#8080FF' },
          { label: 'Commit ACV', value: formatACV(kpis?.commit_acv), color: '#F59E0B' },
          { label: 'Closed ACV', value: formatACV(kpis?.closed_acv), color: '#22C55E' },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-md p-4 border border-gray-100" style={{ background: '#F8FAFC' }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{kpi.label}</p>
            <p className="text-2xl font-black mt-1" style={{ color: kpi.color }}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Approval status table */}
      <div className="mb-6 rounded-md border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100" style={{ background: '#F8FAFC' }}>
          <h2 className="font-bold text-sm" style={{ color: '#12284C' }}>Approval Status Summary</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#F1F5F9' }}>
              <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400">Status</th>
              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400">Count</th>
              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400">ACV</th>
            </tr>
          </thead>
          <tbody>
            {(approval?.rows ?? []).map((r: any) => (
              <tr key={r.approval_status} className="border-t border-gray-100">
                <td className="px-5 py-2.5 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: APPROVAL_COLORS[r.approval_status] ?? '#94A3B8' }} />
                  <span className="font-medium text-gray-800">{r.approval_status}</span>
                </td>
                <td className="px-5 py-2.5 text-right font-semibold text-gray-700">{formatCount(r.count)}</td>
                <td className="px-5 py-2.5 text-right font-semibold" style={{ color: '#00A3AD' }}>{formatACV(r.acv)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #E2E8F0', background: '#F8FAFC' }}>
              <td className="px-5 py-2.5 font-bold text-gray-800">Total</td>
              <td className="px-5 py-2.5 text-right font-bold text-gray-800">{formatCount(approval?.total_count)}</td>
              <td className="px-5 py-2.5 text-right font-bold" style={{ color: '#12284C' }}>{formatACV(approval?.total_acv)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Expiry × Forecast pivot */}
      <div className="mb-6 rounded-md border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100" style={{ background: '#F8FAFC' }}>
          <h2 className="font-bold text-sm" style={{ color: '#12284C' }}>Expiry Quarter × Forecast Category</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#F1F5F9' }}>
                <th className="px-4 py-2 text-left font-semibold text-gray-400">Quarter</th>
                {FORECAST_ORDER.map(cat => (
                  <th key={cat} className="px-4 py-2 text-right font-semibold" style={{ color: FORECAST_COLORS[cat] }}>
                    {cat === 'Blank' ? 'Not yet proposed' : cat}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-semibold text-gray-400">Total</th>
              </tr>
            </thead>
            <tbody>
              {quarters.map((q: string, qi: number) => {
                const catMap = Object.fromEntries(
                  today.filter((r: any) => r.service_expiry_period === q)
                    .map((r: any) => [r.forecast_category, r.acv])
                )
                const total = Object.values(catMap).reduce((s: number, v: any) => s + v, 0)
                return (
                  <tr key={q} style={{ borderTop: '1px solid #E2E8F0', background: qi % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                    <td className="px-4 py-2 font-semibold text-gray-800">{q}</td>
                    {FORECAST_ORDER.map(cat => (
                      <td key={cat} className="px-4 py-2 text-right" style={{ color: FORECAST_COLORS[cat] }}>
                        {catMap[cat] ? formatACV(catMap[cat]) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-bold text-gray-800">{formatACV(total as number)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top regions */}
      <div className="rounded-md border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100" style={{ background: '#F8FAFC' }}>
          <h2 className="font-bold text-sm" style={{ color: '#12284C' }}>Top 10 Regions by ACV</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: '#F1F5F9' }}>
              <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400">#</th>
              <th className="px-5 py-2 text-left text-xs font-semibold text-gray-400">Region</th>
              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400">Count</th>
              <th className="px-5 py-2 text-right text-xs font-semibold text-gray-400">ACV</th>
            </tr>
          </thead>
          <tbody>
            {(regions?.rows ?? []).map((r: any, i: number) => (
              <tr key={r.sub_region} className="border-t border-gray-100">
                <td className="px-5 py-2.5 text-gray-400 font-medium">{i + 1}</td>
                <td className="px-5 py-2.5 font-medium text-gray-800">{r.sub_region}</td>
                <td className="px-5 py-2.5 text-right text-gray-600">{formatCount(r.count)}</td>
                <td className="px-5 py-2.5 text-right font-semibold" style={{ color: '#00A3AD' }}>{formatACV(r.acv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 text-center text-xs text-gray-300 no-print">
        Mobileum Horizon · Confidential
      </div>
    </div>
  )
}
