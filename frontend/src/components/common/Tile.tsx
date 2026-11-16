import React from 'react'
import { formatCount, formatACV, getMetricPolarity, getDeltaTextColor, MetricPolarity } from '@/utils/format'

export interface DeltaValue {
  count?: number | null
  acv?: number | null
  label?: string
}

export interface TileProps {
  id?: string
  title: string
  amount: React.ReactNode
  count?: number | string | null
  dealsLabel?: string
  badge?: React.ReactNode
  subtitle?: React.ReactNode
  deltaYesterday?: DeltaValue | null | React.ReactNode
  deltaLastWeek?: DeltaValue | null | React.ReactNode
  polarity?: MetricPolarity
  accentColor?: string
  isSelected?: boolean
  isNA?: boolean
  onClick?: () => void
  onDealsClick?: (e: React.MouseEvent) => void
  viewDealsText?: string
  footer?: React.ReactNode
  className?: string
}

export const Tile: React.FC<TileProps> = ({
  id,
  title,
  amount,
  count,
  dealsLabel = 'deals',
  badge,
  subtitle,
  deltaYesterday,
  deltaLastWeek,
  polarity,
  accentColor,
  isSelected,
  isNA,
  onClick,
  onDealsClick,
  viewDealsText,
  footer,
  className = '',
}) => {
  const resolvedPolarity: MetricPolarity = polarity || getMetricPolarity(title)

  const renderDeltaItem = (
    label: string,
    delta: DeltaValue | null | undefined | React.ReactNode
  ) => {
    if (React.isValidElement(delta)) {
      return delta
    }

    const d = delta as DeltaValue | null | undefined
    if (!d || (d.count == null && d.acv == null)) {
      return (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] opacity-60">
          <span>{label}</span>
          <span className="tabular-nums text-slate-400 dark:text-slate-500 font-normal">n/a</span>
        </div>
      )
    }

    const countVal = d.count ?? 0
    const acvVal = d.acv ?? 0
    const primaryVal = d.acv != null ? d.acv : d.count

    if (countVal === 0 && acvVal === 0) {
      return (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)] opacity-60">
          <span>{label}</span>
          <span className="tabular-nums">—</span>
        </div>
      )
    }

    const colorClass = getDeltaTextColor(primaryVal, resolvedPolarity)
    const sign = (v: number) => (v > 0 ? `+` : '')

    let text = ''
    if (d.acv != null && d.count != null) {
      text = `${sign(countVal)}${formatCount(countVal)} · ${sign(acvVal)}${formatACV(acvVal)}`
    } else if (d.acv != null) {
      text = `${sign(acvVal)}${formatACV(acvVal)}`
    } else {
      text = `${sign(countVal)}${formatCount(countVal)}`
    }

    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)] font-normal">{label}</span>
        <span className={`tabular-nums ${colorClass}`}>{text}</span>
      </div>
    )
  }

  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      id={id}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : undefined}
      className={`card p-3.5 text-left flex flex-col justify-between gap-2.5 transition-all rounded-xl border border-[var(--border)] bg-[var(--bg-card)] ${
        onClick ? 'cursor-pointer hover:border-[var(--brand-teal)]' : ''
      } ${
        isSelected
          ? 'border-[var(--brand-teal)] ring-1 ring-[var(--brand-teal)] bg-[var(--brand-teal)]/5'
          : ''
      } ${className}`}
    >
      <div className="space-y-1.5 w-full">
        {/* Title and Deals Badge Row */}
        <div className="flex justify-between items-center gap-2">
          <span className="text-xs font-semibold text-[var(--text-muted)] truncate" title={title}>
            {title}
          </span>
          {badge ? (
            <div className="flex-shrink-0">{badge}</div>
          ) : count != null ? (
            <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
              {typeof count === 'number' ? `${formatCount(count)} ${dealsLabel}` : count}
            </span>
          ) : null}
        </div>

        {/* Big Bold Amount */}
        <div className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight">
          {isNA ? <span className="text-slate-400 font-normal text-xl">n/a</span> : amount}
        </div>

        {/* Subtitle / View Deals */}
        {(subtitle || viewDealsText || onDealsClick) && (
          <div className="flex items-center justify-between pt-0.5 min-h-[18px]">
            {subtitle && (
              <div className="text-[11px] text-[var(--text-muted)] truncate">
                {subtitle}
              </div>
            )}
            {onDealsClick && (
              <span
                role="button"
                tabIndex={0}
                className="text-[11px] text-[var(--brand-teal)] hover:underline font-medium cursor-pointer ml-auto flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onDealsClick(e)
                }}
              >
                {viewDealsText || 'View deals →'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Deltas / Comparison Footer */}
      {(deltaYesterday !== undefined || deltaLastWeek !== undefined || footer) && (
        <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1 w-full">
          {footer}
          {deltaYesterday !== undefined && renderDeltaItem('vs yesterday', deltaYesterday)}
          {deltaLastWeek !== undefined && renderDeltaItem('vs last week', deltaLastWeek)}
        </div>
      )}
    </Component>
  )
}

export default Tile
