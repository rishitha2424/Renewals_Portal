/**
 * Unified formatting and label module for Horizon Renewals Intelligence.
 * Strictly adheres to design system rules across all pages.
 */

export const MISSING_FORECAST_CATEGORY = 'Not yet proposed'
export const MISSING_APPROVAL_STATUS = 'Not submitted'

/** Format a USD ACV number: $120.51M, $500.00K, $999, $0 */
export function formatACV(val: number | null | undefined, showSign = false): string {
  if (val == null) return '—'
  if (Math.abs(val) < 0.001) return '$0'
  const sign = showSign ? (val >= 0 ? '+' : '') : ''
  const abs = Math.abs(val)
  if (abs >= 1_000_000) return `${sign}${val < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}${val < 0 ? '-' : ''}$${(abs / 1_000).toFixed(2)}K`
  return `${sign}${val < 0 ? '-' : ''}$${abs.toFixed(0)}`
}

export function acvM(v: number | null | undefined): string {
  if (v == null) return '—'
  if (Math.abs(v) < 0.001) return '$0'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

/** Format count with thousands separator: 1234567 → "1,234,567", 0 → "0" */
export function formatCount(val: number | null | undefined): string {
  if (val == null) return '—'
  return val.toLocaleString('en-US')
}

/** Format percentage: always one decimal (e.g. 52.4%) */
export function formatPct(val: number | null | undefined): string {
  if (val == null) return '—'
  return `${val.toFixed(1)}%`
}

/** Format date string to standard "Nov 13, 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const dateStr = iso.length === 10 ? iso + 'T00:00:00' : iso
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Short date for top bar dropdown chips: "Nov 13" */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const dateStr = iso.length === 10 ? iso + 'T00:00:00' : iso
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Get arrow prefix for delta */
export function deltaArrow(val: number | null | undefined): string {
  if (val == null || Math.abs(val) < 0.0001) return ''
  return val > 0 ? '↑ ' : '↓ '
}

/** Determine CSS class for delta.
 * isRiskMetric: true for Delayed, Slippage, Past Close Date, Lost, etc. where an increase is bad (red)
 */
export function deltaColorClass(val: number | null | undefined, isRiskMetric = false): string {
  if (val == null || Math.abs(val) < 0.0001) return 'text-slate-400 dark:text-slate-500'
  if (val > 0) {
    return isRiskMetric ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'
  }
  return isRiskMetric ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 dark:text-rose-400 font-medium'
}

export type MetricPolarity = 'good_when_higher' | 'bad_when_higher' | 'neutral'

export function getMetricPolarity(metricName: string): MetricPolarity {
  const m = metricName.toLowerCase()
  if (m.includes('jan 1') || m.includes('jan1')) {
    return 'neutral'
  }
  if (
    m.includes('pending') ||
    m.includes('delay') ||
    m.includes('overdue') ||
    m.includes('slip') ||
    m.includes('lost') ||
    m.includes('removed') ||
    m.includes('not submitted') ||
    m.includes('not yet proposed')
  ) {
    return 'bad_when_higher'
  }
  return 'good_when_higher'
}

export function getDeltaTextColor(val: number | null | undefined, polarity: MetricPolarity = 'good_when_higher'): string {
  if (val == null || Math.abs(val) < 0.0001 || polarity === 'neutral') {
    return 'text-slate-400 dark:text-slate-500 font-normal'
  }
  if (polarity === 'bad_when_higher') {
    return val > 0 ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-emerald-600 dark:text-emerald-400 font-medium'
  }
  return val > 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-rose-600 dark:text-rose-400 font-medium'
}

/** Legacy delta class compatibility */
export function deltaClass(val: number): string {
  if (val > 0) return 'delta-positive'
  if (val < 0) return 'delta-negative'
  return 'delta-neutral'
}

export function deltaIcon(val: number): string {
  return deltaArrow(val)
}

/** Format delta value with sign and units */
export function formatDelta(
  val: number | null | undefined,
  isCurrency = true,
  countDelta?: number | null
): string {
  if (val == null) return 'n/a'
  const arrow = deltaArrow(val)
  const sign = val >= 0 ? '+' : '-'
  const abs = Math.abs(val)
  const base = isCurrency ? formatACV(abs) : formatCount(abs)
  const formatted = `${arrow}${sign}${base}`
  if (countDelta != null) {
    const cSign = countDelta >= 0 ? '+' : ''
    return `${formatted} (${cSign}${countDelta} deals)`
  }
  return formatted
}

/** Format exact currency with standard USD locale formatting. Zero shows "$0" */
export function formatCurrency(val: number | null | undefined): string {
  if (val == null) return '—'
  if (Math.abs(val) < 0.001) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(val)
}

/** Format number with commas: 12345 → "12,345" */
export function formatNumber(val: number | null | undefined): string {
  if (val == null) return '—'
  return val.toLocaleString('en-US')
}

/** Display label for forecast category (Blank/null/empty/nan -> "Not yet proposed") */
export function getForecastCategoryLabel(cat: string | null | undefined): string {
  if (!cat) return MISSING_FORECAST_CATEGORY
  const trimmed = cat.trim()
  const lower = trimmed.toLowerCase()
  if (['blank', '(blank)', 'none', 'unassigned', 'null', 'nan', ''].includes(lower)) {
    return MISSING_FORECAST_CATEGORY
  }
  if (lower === 'not yet proposed') return MISSING_FORECAST_CATEGORY
  if (lower === 'closed') return 'Closed'
  if (lower === 'commit' || lower === 'committed') return 'Commit'
  if (lower === 'best case' || lower === 'bestcase') return 'Best Case'
  if (lower === 'pipeline') return 'Pipeline'
  return trimmed
}

/** Display label for approval status (Blank/null/empty/draft/nan -> "Not submitted") */
export function getApprovalStatusLabel(status: string | null | undefined): string {
  if (!status) return MISSING_APPROVAL_STATUS
  const trimmed = status.trim()
  const lower = trimmed.toLowerCase()
  if (['blank', '(blank)', 'none', 'unassigned', 'draft', 'null', 'nan', ''].includes(lower)) {
    return MISSING_APPROVAL_STATUS
  }
  if (lower === 'not submitted') return MISSING_APPROVAL_STATUS
  if (lower === 'approved' || lower === 'approve') return 'Approved'
  if (lower === 'pending approval' || lower === 'pending' || lower === 'pending_approval' || lower === 'pending-approval') {
    return 'Pending Approval'
  }
  if (lower === 'rejected' || lower === 'reject') return 'Rejected'
  return trimmed
}

/** Derive quarter from date string (e.g. YYYY-MM-DD -> Qx-YYYY) */
export function getQuarterFromDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr)
  if (isNaN(d.getTime())) return ''
  const month = d.getMonth() + 1
  const q = Math.ceil(month / 3)
  return `Q${q}-${d.getFullYear()}`
}
