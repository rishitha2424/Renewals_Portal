import React from 'react'
import clsx from 'clsx'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'subtle'
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

export function Card({
  variant = 'default',
  hover = false,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  const paddingStyles = {
    none: 'p-0',
    sm: 'p-3',
    md: 'p-5', // 20px card internal padding standard
    lg: 'p-6',
  }[padding]

  const variantStyles = {
    default: 'bg-[var(--bg-card)] border border-[var(--border)] shadow-[var(--card-shadow)]',
    subtle: 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-[var(--card-shadow)]',
  }[variant]

  return (
    <div
      className={clsx(
        'rounded-xl transition-colors relative overflow-hidden',
        variantStyles,
        paddingStyles,
        hover && 'hover:border-[var(--brand-teal)] transition-colors duration-fast',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface DeltaItem {
  count?: number | null
  acv?: number | null
  text?: string
  date?: string
}

function formatDeltaValue(item: DeltaItem | null | undefined): { text: string; colorClass: string } {
  if (!item) return { text: '—', colorClass: 'text-[var(--text-muted)]' }
  if (item.text) {
    return { text: item.text, colorClass: 'text-[var(--text-primary)]' }
  }

  const parts: string[] = []
  let isPositive = false
  let isNegative = false

  if (item.acv != null) {
    const v = item.acv
    if (v > 0) isPositive = true
    if (v < 0) isNegative = true
    const sign = v > 0 ? '+' : v < 0 ? '-' : ''
    const abs = Math.abs(v)
    const formatted = abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1_000
      ? `$${(abs / 1_000).toFixed(1)}K`
      : `$${abs.toFixed(0)}`
    parts.push(`${sign}${formatted}`)
  }

  if (item.count != null) {
    const c = item.count
    if (c > 0) isPositive = true
    if (c < 0) isNegative = true
    const sign = c > 0 ? '+' : c < 0 ? '-' : ''
    const abs = Math.abs(c)
    parts.push(`${sign}${abs} ${abs === 1 ? 'deal' : 'deals'}`)
  }

  if (parts.length === 0) {
    return { text: '—', colorClass: 'text-[var(--text-muted)]' }
  }

  const text = parts.join(' · ')
  const colorClass = isPositive
    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
    : isNegative
    ? 'text-rose-600 dark:text-rose-400 font-medium'
    : 'text-[var(--text-muted)]'

  return { text, colorClass }
}

export function DeltaRow({
  yesterday,
  lastWeek,
  onYesterdayClick,
  onLastWeekClick,
  className,
}: {
  yesterday?: DeltaItem | null
  lastWeek?: DeltaItem | null
  onYesterdayClick?: (e: React.MouseEvent) => void
  onLastWeekClick?: (e: React.MouseEvent) => void
  className?: string
}) {
  const yFormatted = formatDeltaValue(yesterday)
  const lwFormatted = formatDeltaValue(lastWeek)

  return (
    <div className={clsx('flex flex-col gap-1 pt-2 border-t border-[var(--border-subtle)] text-xs', className)}>
      <div
        className={clsx(
          'flex items-center justify-between gap-2',
          onYesterdayClick && 'cursor-pointer hover:opacity-80 transition-opacity'
        )}
        onClick={onYesterdayClick}
      >
        <span className="text-[var(--text-muted)] font-normal text-xs">vs yesterday</span>
        <span className={clsx('text-xs tabular-nums text-right', yFormatted.colorClass)}>
          {yFormatted.text}
        </span>
      </div>
      <div
        className={clsx(
          'flex items-center justify-between gap-2',
          onLastWeekClick && 'cursor-pointer hover:opacity-80 transition-opacity'
        )}
        onClick={onLastWeekClick}
      >
        <span className="text-[var(--text-muted)] font-normal text-xs">vs last week</span>
        <span className={clsx('text-xs tabular-nums text-right', lwFormatted.colorClass)}>
          {lwFormatted.text}
        </span>
      </div>
    </div>
  )
}

export interface KpiTileCardProps {
  label: string
  count?: number | string | null
  countUnit?: string
  value: React.ReactNode
  color?: string
  accentTop?: string
  accentLeft?: string
  deltaYesterday?: DeltaItem | null
  deltaLastWeek?: DeltaItem | null
  onDeltaYesterdayClick?: (e: React.MouseEvent) => void
  onDeltaLastWeekClick?: (e: React.MouseEvent) => void
  onClick?: () => void
  title?: string
  loading?: boolean
  className?: string
  children?: React.ReactNode
}

export function KpiTileCard({
  label,
  count,
  countUnit = 'deals',
  value,
  color,
  accentTop,
  accentLeft,
  deltaYesterday,
  deltaLastWeek,
  onDeltaYesterdayClick,
  onDeltaLastWeekClick,
  onClick,
  title,
  loading = false,
  className,
  children,
}: KpiTileCardProps) {
  const countText = count != null
    ? typeof count === 'number'
      ? `${count.toLocaleString('en-US')} ${countUnit}`
      : `${count} ${countUnit}`
    : null

  return (
    <div
      onClick={onClick}
      title={title}
      className={clsx(
        'card p-4 flex flex-col justify-between gap-2.5 transition-colors',
        onClick && 'cursor-pointer hover:border-[var(--brand-teal)] hover:shadow-md',
        accentLeft && `border-l-4 ${accentLeft}`,
        className
      )}
      style={{
        borderTop: accentTop ? `3px solid ${accentTop}` : undefined,
      }}
    >
      <div className="space-y-1.5">
        {/* Header row: label left, optional count right */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-xs font-medium text-[var(--text-muted)] truncate"
            title={label}
          >
            {label}
          </span>
          {countText && (
            <span className="text-xs font-medium text-[var(--text-muted)] flex-shrink-0">
              {countText}
            </span>
          )}
        </div>

        {/* Value row */}
        {loading ? (
          <div className="h-8 w-28 skeleton-shimmer rounded" />
        ) : (
          <div
            className="text-2xl font-bold tabular-nums text-[var(--text-primary)] tracking-tight leading-tight"
            style={{ color: color || undefined }}
          >
            {value}
          </div>
        )}

        {children}
      </div>

      {/* Footer row: Deltas */}
      {(deltaYesterday !== undefined || deltaLastWeek !== undefined) && (
        <DeltaRow
          yesterday={deltaYesterday}
          lastWeek={deltaLastWeek}
          onYesterdayClick={onDeltaYesterdayClick}
          onLastWeekClick={onDeltaLastWeekClick}
        />
      )}
    </div>
  )
}

export default Card
