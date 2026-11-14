import React from 'react'
import { acvM, formatDate } from '@/utils/format'

export interface SlippageBreakdownProps {
  slippageSec: any
  slipTot?: any
  onDealsClick: (title: string, params: Record<string, any>) => void
  onClose?: () => void
}

export default function SlippageBreakdown({
  slippageSec,
  slipTot,
  onDealsClick,
  onClose,
}: SlippageBreakdownProps) {
  if (!slippageSec) return null

  const baseDate = slippageSec?.period_start_baseline_date || slipTot?.period_start_baseline_date
  const baseDateStr = baseDate ? ` (baseline ${formatDate(baseDate)})` : ''
  const deltaPeriodStart = slipTot?.delta_period_start || slippageSec?.total?.delta_period_start

  return (
    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Slippage Breakdown & Slipped From
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Since start of year{baseDateStr}: {deltaPeriodStart && baseDate ? (
              <strong className="text-[var(--text-primary)] font-mono">
                {acvM(deltaPeriodStart.acv)} ({deltaPeriodStart.count} deals)
              </strong>
            ) : (
              <span className="text-slate-400 font-normal">n/a</span>
            )}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Close breakdown ✕
          </button>
        )}
      </div>

      {/* Forecast Category Split */}
      {slippageSec?.categories && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {['Commit', 'Best Case', 'Pipeline', 'Blank'].map((cat) => {
            const cData = slippageSec.categories[cat] || { count: 0, acv: 0 }
            const label = cat === 'Blank' ? 'Not yet proposed' : cat
            const cnt = cData.count || 0
            const acv = cData.acv || 0
            const hasC = cnt > 0 || acv > 0
            const drawerTitle = `Slippage · ${label} (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acv)})`

            return (
              <div
                key={cat}
                onClick={() => hasC && onDealsClick(drawerTitle, { kind: 'slippage', category: cat })}
                className={`p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] transition-colors ${
                  hasC ? 'cursor-pointer hover:border-[var(--brand-teal)]' : 'opacity-60 cursor-default'
                }`}
              >
                <div className="text-[11px] font-semibold text-[var(--text-secondary)]">{label}</div>
                <div className="text-lg font-bold text-[var(--text-primary)] tabular-nums mt-0.5">
                  {acvM(acv)}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] tabular-nums">
                  {cnt} {cnt === 1 ? 'deal' : 'deals'}
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
              Service start year breakdown
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-[var(--bg-secondary)]/30 text-[var(--text-secondary)] font-semibold border-b border-[var(--border)]">
                  <th className="px-4 py-2">Service start year</th>
                  <th className="px-4 py-2 text-right">Deals</th>
                  <th className="px-4 py-2 text-right">ACV</th>
                  <th className="px-4 py-2">Expected Close</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {slippageSec.slipped_from.map((sf: any) => {
                  const y = sf.start_year || sf.expiry_year
                  const rowTitle = `Slipped from ${y} (${sf.count} deals · ${acvM(sf.acv)})`
                  return (
                    <tr
                      key={y}
                      onClick={() =>
                        onDealsClick(rowTitle, {
                          kind: 'slipped_from_year',
                          start_year: y,
                          expiry_year: sf.expiry_year,
                        })
                      }
                      className="hover:bg-amber-500/5 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                        From {y}
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
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
