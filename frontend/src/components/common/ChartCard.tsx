import React from 'react'
import { clsx } from 'clsx'
import { BarChart3 } from 'lucide-react'
import { ConceptTone, CONCEPT_COLORS } from '@/design/conceptColors'

export interface ChartDatum {
  label: string
  value: number
  formattedValue?: string
  percentage?: number
  color?: string
  sublabel?: string
  onClick?: () => void
}

export interface ChartCardProps {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  tone?: ConceptTone
  type?: 'horizontal-bars' | 'stacked-bar' | 'vertical-bars' | 'donut'
  data: ChartDatum[]
  total?: number
  action?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  emptyText?: string
}

/**
 * ChartCard: Lightweight, pure CSS/SVG chart container supporting horizontal bars,
 * stacked bars, and vertical columns in concept colours without heavy dependencies.
 */
export default function ChartCard({
  title,
  subtitle,
  icon: Icon = BarChart3,
  tone = 'total',
  type = 'horizontal-bars',
  data = [],
  total,
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
      <div>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <div className={clsx('p-1.5 rounded-lg shrink-0', toneDef.badgeBgClass)}>
              <Icon className={clsx('w-4 h-4', toneDef.titleClass)} />
            </div>
            <div>
              <h3 className={clsx('text-xs font-bold uppercase tracking-wider', toneDef.titleClass)}>
                {title}
              </h3>
              {subtitle && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {action && <div>{action}</div>}
        </div>

        {/* Content */}
        {data.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-4 text-center">{emptyText}</p>
        ) : type === 'horizontal-bars' ? (
          <div className="space-y-2.5 my-2">
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
        ) : type === 'stacked-bar' ? (
          <div className="space-y-3 my-2">
            <div className="h-3.5 w-full rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-700">
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
                      'flex items-center justify-between p-1 rounded hover:bg-[var(--bg-secondary)]',
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
        ) : type === 'vertical-bars' ? (
          <div className="flex items-end justify-between gap-2 h-44 pt-4 pb-2 my-2 border-b border-[var(--border-subtle)]">
            {(() => {
              const maxVal = Math.max(...data.map((d) => d.value), 1)
              return data.map((d) => {
                const heightPct = Math.max(8, (d.value / maxVal) * 100)
                return (
                  <div
                    key={d.label}
                    onClick={d.onClick}
                    className={clsx('flex-1 flex flex-col items-center justify-end h-full gap-1.5 group', d.onClick && 'cursor-pointer')}
                  >
                    <span className="text-[10px] font-bold text-[var(--text-primary)] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.formattedValue ?? d.value}
                    </span>
                    <div
                      className="w-full max-w-[40px] rounded-t-md transition-all group-hover:opacity-85"
                      style={{ height: `${heightPct}%`, backgroundColor: d.color || toneDef.hex }}
                    />
                    <span className="text-[11px] font-semibold text-[var(--text-secondary)] truncate text-center w-full">
                      {d.label}
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] py-4 text-center">Chart rendered</p>
        )}
      </div>

      {footer && <div className="pt-2 border-t border-[var(--border-subtle)] mt-2">{footer}</div>}
    </div>
  )
}

