import React from 'react'
import { formatCurrency, formatNumber, acvM } from '@/utils/format'

export type MetricMode = 'Amount' | 'Count' | 'Both'

interface ApprovalsMetricDisplayProps {
  count?: number | null
  acv?: number | null
  mode: MetricMode
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl'
  compact?: boolean
  countSuffix?: string
  layout?: 'stacked' | 'inline'
  className?: string
  lineClassName?: string
}

const sizeClasses = {
  xs: 'text-[11px] leading-tight',
  sm: 'text-xs leading-tight',
  base: 'text-sm leading-tight',
  lg: 'text-base leading-snug',
  xl: 'text-lg font-black leading-snug',
  '2xl': 'text-2xl font-black leading-none',
  '3xl': 'text-3xl font-black leading-none',
}

export function formatMetricValue(
  count: number | null | undefined,
  acv: number | null | undefined,
  mode: MetricMode,
  options: { compact?: boolean; countSuffix?: string } = {}
): string {
  const c = count ?? 0
  const a = acv ?? 0
  const suffix = options.countSuffix !== undefined ? options.countSuffix : ' deals'
  const countStr = `${formatNumber(c)}${suffix}`
  const acvStr = options.compact ? acvM(a) : formatCurrency(a)

  if (mode === 'Amount') return acvStr
  if (mode === 'Count') return countStr
  return `${acvStr} · ${countStr}`
}

export default function ApprovalsMetricDisplay({
  count = 0,
  acv = 0,
  mode,
  size = 'base',
  compact = false,
  countSuffix = ' deals',
  layout = 'stacked',
  className = '',
  lineClassName = '',
}: ApprovalsMetricDisplayProps) {
  const c = count ?? 0
  const a = acv ?? 0
  const countText = `${formatNumber(c)}${countSuffix}`
  const acvText = compact ? acvM(a) : formatCurrency(a)

  const textStyle = `${sizeClasses[size]} font-mono tabular-nums ${lineClassName}`

  if (mode === 'Amount') {
    return (
      <div className={`${textStyle} ${className}`} data-testid="approvals-metric-amount">
        {acvText}
      </div>
    )
  }

  if (mode === 'Count') {
    return (
      <div className={`${textStyle} ${className}`} data-testid="approvals-metric-count">
        {countText}
      </div>
    )
  }

  // mode === 'Both': Equal prominence, two lines (or inline if specified), same size, no tiny grey count
  if (layout === 'inline') {
    return (
      <div className={`flex items-center gap-2 ${className}`} data-testid="approvals-metric-both">
        <span className={textStyle}>{acvText}</span>
        <span className="text-[var(--text-muted)] font-bold">/</span>
        <span className={textStyle}>{countText}</span>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-0.5 ${className}`} data-testid="approvals-metric-both">
      <span className={textStyle}>{acvText}</span>
      <span className={textStyle}>{countText}</span>
    </div>
  )
}
