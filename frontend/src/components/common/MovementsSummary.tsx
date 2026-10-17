import React from 'react'
import { TrendingUp, TrendingDown, ArrowRight, AlertTriangle, Users } from 'lucide-react'
import { formatCurrency, formatDate, getApprovalStatusLabel } from '@/utils/format'

interface MovementsSummaryProps {
  movements: any
  onSelectDeals?: (title: string, deals: any[]) => void
  compareMode?: 'yesterday' | 'last_week'
  onCompareChange?: (mode: 'yesterday' | 'last_week') => void
  title?: string
  showApprovals?: boolean
  className?: string
}

const acvM = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '$0.00M'
  return `$${(v / 1_000_000).toFixed(2)}M`
}

export const MovementsSummary: React.FC<MovementsSummaryProps> = ({
  movements,
  onSelectDeals,
  compareMode,
  onCompareChange,
  title = 'Forecast Category & Approval Movement',
  showApprovals = true,
  className = '',
}) => {
  const pos: any[] = movements?.positive ?? []
  const neg: any[] = movements?.negative ?? []
  const apv: any[] = movements?.approval ?? []
  const compareDate = movements?.compare_date

  const posTotal = pos.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)
  const negTotal = neg.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)
  const apvTotal = apv.reduce((s: number, r: any) => s + (r.acv ?? 0), 0)

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Header and Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-bold text-base text-[var(--text-primary)]">
            {title}
          </h2>
          {compareDate && (
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Comparing with {formatDate(compareDate)}
            </p>
          )}
        </div>

        {compareMode && onCompareChange && (
          <div className="flex items-center rounded-xl overflow-hidden border border-[var(--border)] text-xs font-semibold">
            {(['yesterday', 'last_week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onCompareChange(v)}
                className={`px-4 py-2 transition-colors ${
                  compareMode === v
                    ? 'bg-[var(--brand-teal)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {v === 'yesterday' ? 'vs Yesterday' : 'vs Last Week'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Positive / Negative tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* GREEN – Positive */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-900/10 overflow-hidden">
          <div className="px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/20">
            <h3 className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Positive Movements
            </h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="text-left px-4 py-2.5 font-semibold">Movement</th>
                <th className="text-right px-4 py-2.5 font-semibold">Count</th>
                <th className="text-right px-4 py-2.5 font-semibold">ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-500/10">
              {pos.map((row: any, i: number) => (
                <tr
                  key={i}
                  className="hover:bg-emerald-500/10 cursor-pointer transition-colors"
                  onClick={() =>
                    row.deals?.length &&
                    onSelectDeals?.(
                      row.label ?? `${row.from_category} → ${row.to_category}`,
                      row.deals
                    )
                  }
                >
                  <td className="px-4 py-2.5 font-medium flex items-center gap-1.5">
                    {row.label ? (
                      <span className="font-bold">{row.label}</span>
                    ) : (
                      <>
                        <span className="text-[var(--text-muted)]">{row.from_category}</span>
                        <ArrowRight className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                        <span className="font-bold">{row.to_category}</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {row.count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{acvM(row.acv)}</td>
                </tr>
              ))}
              <tr className="bg-emerald-500/10 border-t-2 border-emerald-500/30 font-bold">
                <td className="px-4 py-2.5 text-emerald-700 dark:text-emerald-400">Total</td>
                <td className="px-4 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {pos.reduce((s: number, r: any) => s + (r.count ?? 0), 0)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400">
                  {acvM(posTotal)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-2 bg-emerald-500/5 border-t border-emerald-500/10 min-h-[34px] flex items-center justify-center text-center text-[11px] text-[var(--text-muted)] italic">
            {pos.reduce((s: number, r: any) => s + (r.count ?? 0), 0) === 0 ? (
              <span>No upgrades since {compareDate ? formatDate(compareDate) : 'previous snapshot'}</span>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        </div>

        {/* RED – Negative */}
        <div className="rounded-xl border border-red-500/20 bg-red-50/40 dark:bg-red-900/10 overflow-hidden">
          <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/20">
            <h3 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider flex items-center gap-2">
              <TrendingDown className="w-4 h-4" /> Negative Movements
            </h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[var(--text-muted)]">
                <th className="text-left px-4 py-2.5 font-semibold">Movement</th>
                <th className="text-right px-4 py-2.5 font-semibold">Count</th>
                <th className="text-right px-4 py-2.5 font-semibold">ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-red-500/10">
              {neg.map((row: any, i: number) => (
                <tr
                  key={i}
                  className="hover:bg-red-500/10 cursor-pointer transition-colors"
                  onClick={() =>
                    row.deals?.length &&
                    onSelectDeals?.(
                      row.label ?? `${row.from_category} → ${row.to_category}`,
                      row.deals
                    )
                  }
                >
                  <td className="px-4 py-2.5 font-medium">
                    {row.label ? (
                      <span className="flex items-center gap-1.5">
                        {row.label.toLowerCase().includes('slip') && (
                          <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        )}
                        <span
                          className={
                            row.label.toLowerCase().includes('slip')
                              ? 'font-bold text-amber-700 dark:text-amber-400'
                              : 'font-bold'
                          }
                        >
                          {row.label}
                        </span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="text-[var(--text-muted)]">{row.from_category}</span>
                        <ArrowRight className="w-3 h-3 text-red-500 flex-shrink-0" />
                        <span className="font-bold">{row.to_category}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-red-700 dark:text-red-400">
                    {row.count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{acvM(row.acv)}</td>
                </tr>
              ))}
              <tr className="bg-red-500/10 border-t-2 border-red-500/30 font-bold">
                <td className="px-4 py-2.5 text-red-700 dark:text-red-400">Total</td>
                <td className="px-4 py-2.5 text-right font-mono text-red-700 dark:text-red-400">
                  {neg.reduce((s: number, r: any) => s + (r.count ?? 0), 0)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-red-700 dark:text-red-400">
                  {acvM(negTotal)}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="px-4 py-2 bg-red-500/5 border-t border-red-500/10 min-h-[34px] flex items-center justify-center text-center text-[11px] text-[var(--text-muted)] italic">
            {neg.reduce((s: number, r: any) => s + (r.count ?? 0), 0) === 0 ? (
              <span>No downgrades since {compareDate ? formatDate(compareDate) : 'previous snapshot'}</span>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        </div>
      </div>

      {/* Approval Movement Table */}
      {showApprovals && apv.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
              Approval Movement Table
            </h3>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
              <Users className="w-3 h-3" />
              {apv.reduce((s: number, r: any) => s + (r.count ?? 0), 0)} Status Changes ({acvM(apvTotal)})
            </span>
          </div>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-secondary)]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-muted)]">
                    From Approval Status
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-[var(--text-muted)]">
                    To Approval Status
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-muted)]">
                    Opportunity Count
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-[var(--text-muted)]">
                    ACV Value ($M)
                  </th>
                  <th className="px-4 py-2.5 font-semibold text-[var(--text-muted)]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {apv.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{getApprovalStatusLabel(row.from_status)}</td>
                    <td className="px-4 py-2.5 font-semibold">{getApprovalStatusLabel(row.to_status)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{row.count}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{acvM(row.acv)}</td>
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          row.deals?.length &&
                          onSelectDeals?.(
                            `${getApprovalStatusLabel(row.from_status)} → ${getApprovalStatusLabel(row.to_status)}`,
                            row.deals
                          )
                        }
                        className="text-[10px] font-bold text-[var(--brand-teal)] hover:underline"
                      >
                        View Deals
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-[var(--bg-secondary)] font-bold border-t-2 border-[var(--border)]">
                  <td className="px-4 py-2.5 text-[var(--text-muted)]" colSpan={2}>
                    Total Approval Movements
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {apv.reduce((s: number, r: any) => s + (r.count ?? 0), 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{acvM(apvTotal)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
