import React from 'react'
import { TrendingUp, TrendingDown, ArrowRight, AlertTriangle, Users } from 'lucide-react'
import { formatCurrency, formatDate, getApprovalStatusLabel } from '@/utils/format'
import { CONCEPT_COLORS } from '@/design/conceptColors'

function getCategoryChip(cat: string) {
  if (!cat) return null
  const lower = cat.trim().toLowerCase()
  let color = '#64748B'
  if (lower.includes('closed')) color = CONCEPT_COLORS.closed.hex
  else if (lower.includes('commit')) color = CONCEPT_COLORS.commit.hex
  else if (lower.includes('best case') || lower.includes('bestcase')) color = CONCEPT_COLORS.best_case.hex
  else if (lower.includes('pipeline')) color = CONCEPT_COLORS.pipeline.hex
  else if (lower.includes('lost') || lower.includes('removed')) color = CONCEPT_COLORS.lost.hex

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: `${color}18`, color: color, border: `1px solid ${color}33` }}
    >
      {cat}
    </span>
  )
}

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
        <div className="rounded-xl border border-emerald-500/20 bg-[var(--bg-card)] overflow-hidden shadow-xs">
          <div className="px-4 py-2.5 bg-emerald-600 text-white flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-white" /> Positive Movements
            </h3>
            <span className="text-[11px] font-semibold text-emerald-100 font-mono">
              +{acvM(posTotal)}
            </span>
          </div>
          <table className="w-full text-xs table-fixed">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[24%]" />
              <col className="w-[32%]" />
            </colgroup>
            <thead className="bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-emerald-500/10">
              <tr className="text-[var(--text-muted)]">
                <th className="text-left px-3.5 py-2 font-semibold">Movement</th>
                <th className="text-center px-3 py-2 font-semibold">Count</th>
                <th className="text-right px-3.5 py-2 font-semibold">ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-500/10">
              {pos.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-xs text-[var(--text-muted)] italic">
                    No positive movements {compareDate ? `since ${formatDate(compareDate)}` : ''}
                  </td>
                </tr>
              ) : (
                pos.map((row: any, i: number) => (
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
                    <td className="px-3.5 py-2.5 font-medium flex items-center gap-1.5 flex-wrap">
                      {row.label ? (
                        <span className="font-bold text-[var(--text-primary)]">{row.label}</span>
                      ) : (
                        <>
                          {getCategoryChip(row.from_category)}
                          <ArrowRight className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                          {getCategoryChip(row.to_category)}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {row.count}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      +{acvM(row.acv)}
                    </td>
                  </tr>
                ))
              )}
              {pos.length > 0 && (
                <tr className="bg-emerald-500/10 border-t-2 border-emerald-500/30 font-bold">
                  <td className="px-3.5 py-2 text-emerald-700 dark:text-emerald-400">Total</td>
                  <td className="px-3 py-2 text-center font-mono text-emerald-700 dark:text-emerald-400">
                    {pos.reduce((s: number, r: any) => s + (r.count ?? 0), 0)}
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">
                    +{acvM(posTotal)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* RED – Negative */}
        <div className="rounded-xl border border-rose-500/20 bg-[var(--bg-card)] overflow-hidden shadow-xs">
          <div className="px-4 py-2.5 bg-rose-600 text-white flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-white" /> Negative Movements
            </h3>
            <span className="text-[11px] font-semibold text-rose-100 font-mono">
              -{acvM(negTotal)}
            </span>
          </div>
          <table className="w-full text-xs table-fixed">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[24%]" />
              <col className="w-[32%]" />
            </colgroup>
            <thead className="bg-rose-50/50 dark:bg-rose-950/20 border-b border-rose-500/10">
              <tr className="text-[var(--text-muted)]">
                <th className="text-left px-3.5 py-2 font-semibold">Movement</th>
                <th className="text-center px-3 py-2 font-semibold">Count</th>
                <th className="text-right px-3.5 py-2 font-semibold">ACV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rose-500/10">
              {neg.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-4 text-center text-xs text-[var(--text-muted)] italic">
                    No negative movements {compareDate ? `since ${formatDate(compareDate)}` : ''}
                  </td>
                </tr>
              ) : (
                neg.map((row: any, i: number) => (
                  <tr
                    key={i}
                    className="hover:bg-rose-500/10 cursor-pointer transition-colors"
                    onClick={() =>
                      row.deals?.length &&
                      onSelectDeals?.(
                        row.label ?? `${row.from_category} → ${row.to_category}`,
                        row.deals
                      )
                    }
                  >
                    <td className="px-3.5 py-2.5 font-medium flex items-center gap-1.5 flex-wrap">
                      {row.label ? (
                        <span className="flex items-center gap-1.5">
                          {row.label.toLowerCase().includes('slip') && (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                          )}
                          <span
                            className={
                              row.label.toLowerCase().includes('slip')
                                ? 'font-bold text-amber-700 dark:text-amber-400'
                                : 'font-bold text-[var(--text-primary)]'
                            }
                          >
                            {row.label}
                          </span>
                        </span>
                      ) : (
                        <>
                          {getCategoryChip(row.from_category)}
                          <ArrowRight className="w-3 h-3 text-rose-500 flex-shrink-0" />
                          {getCategoryChip(row.to_category)}
                        </>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-center font-mono font-bold text-rose-700 dark:text-rose-400">
                      {row.count}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                      -{acvM(row.acv)}
                    </td>
                  </tr>
                ))
              )}
              {neg.length > 0 && (
                <tr className="bg-rose-500/10 border-t-2 border-rose-500/30 font-bold">
                  <td className="px-3.5 py-2 text-rose-700 dark:text-rose-400">Total</td>
                  <td className="px-3.5 py-2 text-center font-mono text-rose-700 dark:text-rose-400">
                    {neg.reduce((s: number, r: any) => s + (r.count ?? 0), 0)}
                  </td>
                  <td className="px-3.5 py-2 text-right font-mono text-rose-700 dark:text-rose-400">
                    -{acvM(negTotal)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
              {apv.reduce((s: number, r: any) => s + (r.count ?? 0), 0)} Status Changes ({acvM(apvTotal)})
            </span>
          </div>
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[28%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[12%]" />
              </colgroup>
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
                  <th className="text-center px-4 py-2.5 font-semibold text-[var(--text-muted)]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {apv.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] font-medium">
                      <span className="px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)]">
                        {getApprovalStatusLabel(row.from_status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-emerald-600 dark:text-emerald-400">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        {getApprovalStatusLabel(row.to_status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{row.count}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{acvM(row.acv)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() =>
                          row.deals?.length &&
                          onSelectDeals?.(
                            `${getApprovalStatusLabel(row.from_status)} → ${getApprovalStatusLabel(row.to_status)}`,
                            row.deals
                          )
                        }
                        className="text-[10px] font-bold text-[var(--brand-teal)] hover:underline inline-flex items-center gap-1"
                      >
                        View Deals →
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
