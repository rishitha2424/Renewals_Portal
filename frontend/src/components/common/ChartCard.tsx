import React from 'react'
import { clsx } from 'clsx'
import { ConceptTone, CONCEPT_COLORS } from '@/design/conceptColors'
import { formatACV, acvM } from '@/utils/format'

export interface ChartDatum {
  label: string
  value: number
  formattedValue?: string
  percentage?: number
  color?: string
  sublabel?: string
  dealsCount?: number
  benchmark?: number
  gap?: number
  onClick?: () => void
  series?: { name: string; value: number; color?: string; formattedValue?: string }[]
}

export interface ChartCardProps {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  tone?: ConceptTone
  type?: 'horizontal-bars' | 'stacked-bar' | 'vertical-bars' | 'donut' | 'grouped-columns' | 'diverging-bars' | 'stacked-columns' | 'benchmark-bars'
  data: ChartDatum[]
  total?: number
  benchmark?: number
  benchmarkLabel?: string
  action?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  emptyText?: string
}

/**
 * ChartCard: Pure CSS/SVG charts supporting horizontal bars, vertical columns,
 * grouped columns, stacked bar, diverging bars around zero, donut, and benchmark target bars.
 * Scales dynamically to fill container height without decorative heading icons (F1, F3, F7, F8).
 */
export default function ChartCard({
  title,
  subtitle,
  tone = 'total',
  type = 'horizontal-bars',
  data = [],
  total,
  benchmark,
  benchmarkLabel,
  action,
  footer,
  className = '',
  emptyText = 'No chart data available.',
}: ChartCardProps) {
  const toneDef = CONCEPT_COLORS[tone] || CONCEPT_COLORS.total
  const calculatedTotal = total ?? data.reduce((acc, d) => acc + (d.value || 0), 0)

  return (
    <div
      className={clsx(
        'rounded-xl bg-[var(--bg-card)] border border-[var(--border)] border-l-4 shadow-[var(--card-shadow)]',
        toneDef.borderClass,
        'p-4 sm:p-5 flex flex-col justify-between h-full select-none transition-colors',
        className
      )}
    >
      <div className="flex-1 flex flex-col min-h-0">
        {/* Header - No decorative icon (F8) */}
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[var(--border-subtle)] shrink-0">
          <div>
            <h3 className={clsx('text-xs font-bold uppercase tracking-wider', toneDef.titleClass)}>
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>

        {/* Content - Scales inside absolute container (B) */}
        <div className="relative flex-1 min-h-[200px] w-full min-w-0 my-1">
          <div className="absolute inset-0 w-full h-full flex flex-col justify-start overflow-hidden">
            {data.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center my-auto">{emptyText}</p>
            ) : type === 'horizontal-bars' ? (
            <div className="flex-1 flex flex-col justify-start gap-2.5 overflow-y-auto">
              {data.map((d) => {
                const pct = d.percentage ?? (calculatedTotal > 0 ? (d.value / calculatedTotal) * 100 : 0)
                const barColor = d.color || toneDef.hex
                return (
                  <div
                    key={d.label}
                    onClick={d.onClick}
                    className={clsx(
                      'group space-y-1',
                      d.onClick ? 'cursor-pointer hover:opacity-90' : 'cursor-default'
                    )}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[var(--text-primary)] truncate max-w-[180px]" title={d.label}>
                        {d.label}
                      </span>
                      <div className="flex items-center gap-2 tabular-nums">
                        <span className="font-bold text-[var(--text-primary)]">
                          {d.formattedValue ?? d.value}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)] w-10 text-right font-medium">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : type === 'vertical-bars' ? (
            <div className="flex-1 flex flex-col h-full min-h-0 pt-1 pb-0.5 overflow-hidden">
              {(() => {
                const maxVal = Math.max(...data.map((d) => d.value), 1)
                return (
                  <>
                    {/* Upper section: values, percentage badge & bars rising from baseline */}
                    <div className="relative flex-1 flex items-end justify-between gap-2 px-1 min-h-0">
                      {/* Subtle background horizontal reference lines */}
                      <div className="absolute inset-x-1 inset-y-1 flex flex-col justify-between pointer-events-none z-0 opacity-70">
                        <div className="w-full border-b border-dashed border-slate-200/90 dark:border-slate-700/60" />
                        <div className="w-full border-b border-dashed border-slate-200/90 dark:border-slate-700/60" />
                        <div className="w-full border-b border-dashed border-slate-200/90 dark:border-slate-700/60" />
                        <div className="w-full border-b border-slate-200/90 dark:border-slate-700/60" />
                      </div>

                      {data.map((d) => {
                        const heightPct = Math.max(8, (d.value / maxVal) * 100)
                        const barColor = d.color || toneDef.hex
                        const isPctInValue = d.formattedValue?.includes('%')
                        return (
                          <div
                            key={d.label}
                            onClick={d.onClick}
                            className={clsx(
                              'relative z-10 flex-1 flex flex-col items-center justify-end h-full group min-w-0',
                              d.onClick ? 'cursor-pointer' : 'cursor-default'
                            )}
                          >
                            {/* Value & percentage badge above the bar */}
                            <div className="flex flex-col items-center gap-0.5 mb-1.5 transition-transform duration-200 group-hover:-translate-y-0.5">
                              <span className="text-[11px] sm:text-xs font-bold text-[var(--text-primary)] tabular-nums whitespace-nowrap">
                                {d.formattedValue ?? d.value}
                              </span>
                              {d.percentage != null && !isPctInValue && (
                                <span className="text-[10px] font-semibold text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors tabular-nums">
                                  {d.percentage.toFixed(1)}%
                                </span>
                              )}
                            </div>

                            {/* Bar pillar with subtle background track */}
                            <div className="w-full max-w-[50px] h-full flex items-end justify-center rounded-t-lg bg-slate-100/90 dark:bg-slate-800/60 p-0.5 transition-colors group-hover:bg-slate-200/90 dark:group-hover:bg-slate-700/60">
                              <div
                                className="w-full rounded-t-md transition-all duration-300 shadow-xs relative overflow-hidden group-hover:brightness-105"
                                style={{
                                  height: `${heightPct}%`,
                                  backgroundColor: barColor,
                                  backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.08), rgba(255,255,255,0.18))',
                                }}
                              >
                                {/* Subtle top gleam highlight */}
                                <div className="absolute top-0 inset-x-0 h-[2px] bg-white/50" />
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Baseline separator */}
                    <div className="h-px w-full bg-[var(--border)] my-1 shrink-0" />

                    {/* Lower section: Category label + Deal count badge */}
                    <div className="flex items-start justify-between gap-2 px-1 pt-0.5 shrink-0">
                      {data.map((d) => (
                        <div
                          key={d.label}
                          onClick={d.onClick}
                          className={clsx(
                            'flex-1 flex flex-col items-center text-center group min-w-0',
                            d.onClick ? 'cursor-pointer' : 'cursor-default'
                          )}
                        >
                          <span
                            className="text-[11px] font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors truncate w-full"
                            title={d.label}
                          >
                            {d.label}
                          </span>
                          {(d.sublabel || d.dealsCount != null) && (
                            <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] group-hover:border-[var(--brand-teal)] group-hover:text-[var(--brand-teal)] transition-colors tabular-nums whitespace-nowrap">
                              {d.sublabel ?? `${d.dealsCount} ${d.dealsCount === 1 ? 'deal' : 'deals'}`}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>
          ) : type === 'grouped-columns' ? (
            <div className="flex-1 flex items-end justify-between gap-3 pt-4 pb-1 border-b border-[var(--border-subtle)] min-h-[160px]">
              {(() => {
                let maxVal = 1
                data.forEach((d) => {
                  if (d.series) {
                    d.series.forEach((s) => {
                      if (s.value > maxVal) maxVal = s.value
                    })
                  } else if (d.value > maxVal) {
                    maxVal = d.value
                  }
                })

                return data.map((d) => (
                  <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <div className="flex items-end justify-center gap-1.5 w-full h-full">
                      {(d.series || [{ name: d.label, value: d.value, color: d.color, formattedValue: d.formattedValue }]).map((s) => {
                        const hPct = Math.max(6, (s.value / maxVal) * 100)
                        return (
                          <div
                            key={s.name}
                            onClick={d.onClick}
                            className="flex-1 max-w-[28px] flex flex-col items-center justify-end h-full group"
                            title={`${d.label} - ${s.name}: ${s.formattedValue ?? s.value}`}
                          >
                            <span className="text-[9px] font-bold text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                              {s.formattedValue ?? s.value}
                            </span>
                            <div
                              className="w-full rounded-t-sm transition-all group-hover:opacity-85"
                              style={{ height: `${hPct}%`, backgroundColor: s.color || toneDef.hex }}
                            />
                          </div>
                        )
                      })}
                    </div>
                    <span className="text-[10px] font-semibold text-[var(--text-secondary)] truncate text-center w-full" title={d.label}>
                      {d.label}
                    </span>
                  </div>
                ))
              })()}
            </div>
          ) : type === 'stacked-columns' ? (
            <div className="flex-1 flex items-end justify-between gap-3 pt-4 pb-1 border-b border-[var(--border-subtle)] min-h-[160px]">
              {(() => {
                const maxVal = Math.max(...data.map((d) => d.value), 1)
                return data.map((d) => {
                  const heightPct = Math.max(8, (d.value / maxVal) * 100)
                  const segments = d.series || [{ name: d.label, value: d.value, color: d.color, formattedValue: d.formattedValue }]
                  return (
                    <div
                      key={d.label}
                      onClick={d.onClick}
                      className={clsx('flex-1 flex flex-col items-center justify-end h-full gap-1 group', d.onClick && 'cursor-pointer')}
                    >
                      <span className="text-[10px] font-bold text-[var(--text-primary)] tabular-nums group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {d.formattedValue ?? d.value}
                      </span>
                      <div
                        className="w-full max-w-[44px] rounded-t-md transition-all overflow-hidden flex flex-col-reverse shadow-xs"
                        style={{ height: `${heightPct}%` }}
                      >
                        {segments.map((seg) => {
                          const segPct = d.value > 0 ? (seg.value / d.value) * 100 : 0
                          if (segPct <= 0) return null
                          return (
                            <div
                              key={seg.name}
                              style={{ height: `${segPct}%`, backgroundColor: seg.color || toneDef.hex }}
                              className="w-full transition-all hover:opacity-80"
                              title={`${d.label} - ${seg.name}: ${seg.formattedValue ?? seg.value}`}
                            />
                          )
                        })}
                      </div>
                      <span className="text-[10px] font-semibold text-[var(--text-secondary)] truncate text-center w-full" title={d.label}>
                        {d.label}
                      </span>
                    </div>
                  )
                })
              })()}
            </div>
          ) : (type === 'benchmark-bars' || (type === 'diverging-bars' && (benchmark != null || data.some((d) => d.benchmark != null)))) ? (
            <div className="flex-1 flex flex-col justify-around gap-2.5 py-1 min-h-[160px]">
              {/* Benchmark Reference Header */}
              {benchmark != null && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)]/70 border border-[var(--border-subtle)] text-[11px] mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/20" />
                    <span className="text-[var(--text-secondary)] font-medium">
                      {benchmarkLabel || 'Portfolio Benchmark'}:
                    </span>
                    <strong className="text-[var(--text-primary)] font-bold tabular-nums">{benchmark}%</strong>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono">Target reference</span>
                </div>
              )}
              {(() => {
                const bmVal = benchmark ?? 50
                return data.map((d) => {
                  const itemBm = d.benchmark ?? bmVal
                  const gapVal = d.gap !== undefined ? d.gap : Number((d.value - itemBm).toFixed(1))
                  const isAbove = gapVal >= 0
                  const barWidth = Math.min(100, Math.max(0, d.value))
                  const bmPos = Math.min(100, Math.max(0, itemBm))

                  return (
                    <div
                      key={d.label}
                      onClick={d.onClick}
                      className={clsx('group space-y-1.5', d.onClick && 'cursor-pointer')}
                    >
                      {/* Row Label & Metrics */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-bold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors truncate">
                            {d.label}
                          </span>
                          <span className="font-extrabold text-[var(--text-primary)] tabular-nums">
                            {d.formattedValue ?? `${d.value}%`}
                          </span>
                          {d.sublabel && (
                            <span className="text-[10px] text-[var(--text-muted)] truncate hidden sm:inline font-medium">
                              ({d.sublabel})
                            </span>
                          )}
                        </div>

                        {/* Gap Pill */}
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border tabular-nums whitespace-nowrap shadow-xs',
                            isAbove
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                          )}
                        >
                          {isAbove ? '▲ +' : '▼ '}{Math.abs(gapVal).toFixed(1)}% vs avg
                        </span>
                      </div>

                      {/* Benchmark Bar Track */}
                      <div className="relative h-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-visible flex items-center shadow-inner">
                        {/* Scale Reference Ticks at 25%, 50%, 75% */}
                        {[25, 50, 75].map((tick) => (
                          <div
                            key={tick}
                            className="absolute top-0 bottom-0 w-px bg-slate-200/80 dark:bg-slate-700/80 pointer-events-none"
                            style={{ left: `${tick}%` }}
                          />
                        ))}

                        {/* Actual Progress Bar with Gradient */}
                        <div
                          className={clsx(
                            'h-full rounded-full transition-all duration-300 relative overflow-hidden',
                            isAbove
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-sm'
                              : 'bg-gradient-to-r from-rose-500 to-amber-500 shadow-sm'
                          )}
                          style={{ width: `${barWidth}%` }}
                        >
                          {/* Inner subtle glow / stripe overlay */}
                          <div className="absolute inset-0 bg-white/10 dark:bg-white/5 pointer-events-none" />
                        </div>

                        {/* Benchmark Target Pin / Line */}
                        <div
                          className="absolute -top-1 -bottom-1 w-0.5 bg-indigo-600 dark:bg-indigo-400 z-10 pointer-events-none shadow-sm"
                          style={{ left: `${bmPos}%` }}
                          title={`Portfolio Benchmark: ${itemBm}%`}
                        >
                          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 ring-2 ring-white dark:ring-slate-900" />
                          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 ring-2 ring-white dark:ring-slate-900" />
                        </div>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          ) : type === 'diverging-bars' ? (
            <div className="flex-1 flex flex-col justify-between gap-2 py-1">
              {(() => {
                const maxAbs = Math.max(...data.map((d) => Math.abs(d.value)), 1)
                return data.map((d) => {
                  const isPos = d.value >= 0
                  const widthPct = Math.min(50, (Math.abs(d.value) / maxAbs) * 50)
                  return (
                    <div key={d.label} className="space-y-0.5 text-xs">
                      <div className="flex justify-between text-[11px]">
                        <span className="font-medium text-[var(--text-primary)] truncate max-w-[160px]">{d.label}</span>
                        <span className={clsx('font-bold tabular-nums', isPos ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                          {d.formattedValue ?? `${isPos ? '+' : ''}${d.value}`}
                        </span>
                      </div>
                      <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-sm flex items-center relative overflow-hidden">
                        {/* Zero center line */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400 dark:bg-slate-500 z-10" />
                        {isPos ? (
                          <div
                            className="h-full bg-emerald-500 absolute left-1/2 rounded-r-sm transition-all"
                            style={{ width: `${widthPct}%` }}
                          />
                        ) : (
                          <div
                            className="h-full bg-rose-500 absolute right-1/2 rounded-l-sm transition-all"
                            style={{ width: `${widthPct}%` }}
                          />
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          ) : type === 'donut' ? (
            <div className="flex-1 flex flex-col items-center justify-start gap-2 p-1 min-h-0 overflow-hidden">
              {/* Donut SVG - Fixed size ~150px centered at top (B) */}
              <div className="relative w-[150px] h-[150px] shrink-0 mx-auto my-1">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  {(() => {
                    let cumulative = 0
                    return data.map((d) => {
                      const pct = d.percentage ?? (calculatedTotal > 0 ? (d.value / calculatedTotal) * 100 : 0)
                      if (pct <= 0) return null
                      const strokeDasharray = `${pct * 2.512} ${251.2}`
                      const strokeDashoffset = `-${cumulative * 2.512}`
                      cumulative += pct
                      return (
                        <circle
                          key={d.label}
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke={d.color || toneDef.hex}
                          strokeWidth="16"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          className="transition-all duration-300"
                        />
                      )
                    })
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-1">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Total</span>
                  <span className="text-xs font-black text-[var(--text-primary)] tabular-nums truncate max-w-[95px]" title={String(total != null ? total : calculatedTotal)}>
                    {acvM(total != null ? total : calculatedTotal)}
                  </span>
                </div>
              </div>

              {/* Legend directly below donut */}
              <div className="w-full space-y-1 overflow-y-auto flex-1 min-h-0 pr-1">
                {data.map((d) => {
                  const pct = d.percentage ?? (calculatedTotal > 0 ? (d.value / calculatedTotal) * 100 : 0)
                  return (
                    <div
                      key={d.label}
                      onClick={d.onClick}
                      className={clsx(
                        'flex items-center justify-between p-1.5 rounded text-xs hover:bg-[var(--bg-secondary)] transition-colors border border-[var(--border-subtle)]',
                        d.onClick && 'cursor-pointer'
                      )}
                    >
                      <div className="flex items-center gap-1.5 truncate pr-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color || toneDef.hex }} />
                        <span className="font-medium text-[var(--text-secondary)] truncate max-w-[180px]" title={d.label}>{d.label}</span>
                      </div>
                      <div className="flex items-center gap-2 tabular-nums shrink-0">
                        <span className="font-bold text-[var(--text-primary)]">{d.formattedValue ?? acvM(d.value)}</span>
                        <span className="text-[10px] text-[var(--text-muted)] w-9 text-right font-semibold">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : type === 'stacked-bar' ? (
            <div className="flex-1 flex flex-col justify-between gap-3">
              <div className="h-4 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-700 shadow-inner">
                {data.map((d) => {
                  const pct = d.percentage ?? (calculatedTotal > 0 ? (d.value / calculatedTotal) * 100 : 0)
                  if (pct <= 0) return null
                  return (
                    <div
                      key={d.label}
                      onClick={d.onClick}
                      style={{ width: `${pct}%`, backgroundColor: d.color || toneDef.hex }}
                      className={clsx('h-full transition-all', d.onClick && 'cursor-pointer hover:opacity-85')}
                      title={`${d.label}: ${pct.toFixed(1)}% (${d.formattedValue ?? d.value})`}
                    />
                  )
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                {data.map((d) => {
                  const pct = d.percentage ?? (calculatedTotal > 0 ? (d.value / calculatedTotal) * 100 : 0)
                  return (
                    <div
                      key={d.label}
                      onClick={d.onClick}
                      className={clsx(
                        'flex items-center justify-between p-1.5 rounded hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)]',
                        d.onClick && 'cursor-pointer'
                      )}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color || toneDef.hex }} />
                        <span className="text-[var(--text-secondary)] font-medium truncate">{d.label}</span>
                      </div>
                      <span className="font-bold tabular-nums text-[var(--text-primary)]">{pct.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] py-4 text-center my-auto">{emptyText}</p>
          )}
          </div>
        </div>
      </div>

      {footer && <div className="pt-2 border-t border-[var(--border-subtle)] mt-2 shrink-0">{footer}</div>}
    </div>
  )
}
