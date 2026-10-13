import React from 'react'
import { formatACV, formatCount } from '@/utils/format'
import { clsx } from 'clsx'

export interface DeltaChipProps {
  value: number | null | undefined
  previousValue?: number | null
  label?: string
  showIcon?: boolean
  isCurrency?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export default function DeltaChip({
  value,
  previousValue,
  label,
  showIcon = true,
  isCurrency = false,
  size = 'md',
  className,
}: DeltaChipProps) {
  if (value == null) return null
  const isZero = value === 0
  const positive = value > 0

  const formattedValue = isCurrency
    ? formatACV(Math.abs(value))
    : formatCount(Math.abs(value))

  const pct =
    previousValue != null && previousValue !== 0
      ? ((Math.abs(value) / Math.abs(previousValue)) * 100).toFixed(1)
      : null

  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium rounded-sm select-none tabular-nums transition-colors',
        sizeClasses,
        isZero
          ? 'text-[var(--text-muted)] bg-[var(--border)]'
          : positive
          ? 'text-green-700 dark:text-green-400 bg-green-500/10'
          : 'text-red-700 dark:text-red-400 bg-red-500/10',
        className
      )}
    >
      {showIcon && !isZero && <span>{positive ? '▲' : '▼'}</span>}
      <span>{positive ? '+' : isZero ? '' : '-'}{formattedValue}</span>
      {pct && <span className="opacity-75 font-normal">({pct}%)</span>}
      {label && <span className="opacity-70">{label}</span>}
    </span>
  )
}
