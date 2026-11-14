import React from 'react'
import { formatACV, formatCount } from '@/utils/format'
import { clsx } from 'clsx'

export interface DeltaChipProps {
  value: number | null | undefined
  previousValue?: number | null
  label?: string
  showIcon?: boolean
  isCurrency?: boolean
  isBadDirectionIncrease?: boolean // if true, increase is bad (e.g. delays/slippage)
  size?: 'sm' | 'md'
  className?: string
}

export default function DeltaChip({
  value,
  previousValue,
  label,
  showIcon = true,
  isCurrency = false,
  isBadDirectionIncrease = false,
  size = 'md',
  className,
}: DeltaChipProps) {
  if (value == null) return null
  const isZero = value === 0
  const isPositive = value > 0

  const formattedValue = isCurrency
    ? formatACV(Math.abs(value))
    : formatCount(Math.abs(value))

  const pct =
    previousValue != null && previousValue !== 0
      ? ((Math.abs(value) / Math.abs(previousValue)) * 100).toFixed(1)
      : null

  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'

  // Neutral background with text-only polarity coloring
  let colorClasses = 'bg-[var(--bg-secondary)] border border-[var(--border)] text-slate-500 dark:text-slate-400'
  if (!isZero) {
    if (isBadDirectionIncrease) {
      // bad direction: increase -> rose text; decrease -> emerald text
      colorClasses = isPositive
        ? 'bg-[var(--bg-secondary)] border border-[var(--border)] text-rose-600 dark:text-rose-400 font-medium'
        : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-emerald-600 dark:text-emerald-400 font-medium'
    } else {
      // standard: increase -> emerald text; decrease -> rose text
      colorClasses = isPositive
        ? 'bg-[var(--bg-secondary)] border border-[var(--border)] text-emerald-600 dark:text-emerald-400 font-medium'
        : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-rose-600 dark:text-rose-400 font-medium'
    }
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 font-medium rounded-sm select-none tabular-nums transition-colors',
        sizeClasses,
        colorClasses,
        className
      )}
    >
      <span>{isPositive ? '+' : isZero ? '' : '-'}{formattedValue}</span>
      {pct && <span className="opacity-75 font-normal">({pct}%)</span>}
      {label && <span className="opacity-70">{label}</span>}
    </span>
  )
}
