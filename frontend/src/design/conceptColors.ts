/**
 * Centralised concept color system.
 *
 * Rules:
 * - Closed = teal (#00A3AD)
 * - Commit = blue (#2563EB)
 * - Best Case = light blue (#0284C7)
 * - Pipeline = orange (#EA580C)
 * - Approved = green (#16A34A)
 * - Pending approval = amber (#D97706)
 * - Not submitted = slate grey (#64748B)
 * - Delayed = red (#E11D48)
 * - Slippage = orange/amber (#F59E0B)
 * - Lost = slate (#64748B)
 * - Jan 1st = sky (#0284C7)
 * - Proposal Pending = indigo (#4F46E5)
 * - Total = deep teal (#12284C)
 * - Active units = indigo (#4F46E5)
 * - Largest BU = blue (#2563EB)
 * - Commit coverage = blue (#2563EB)
 */

export type ConceptTone =
  | 'closed'
  | 'commit'
  | 'best_case'
  | 'pipeline'
  | 'approved'
  | 'pending'
  | 'not_submitted'
  | 'delayed'
  | 'slippage'
  | 'lost'
  | 'jan_1st'
  | 'proposal_pending'
  | 'total'
  | 'active_units'
  | 'largest_bu'
  | 'coverage'
  | 'neutral'

export interface ConceptColorDef {
  hex: string
  borderClass: string
  titleClass: string
  badgeBgClass: string
  badgeTextClass: string
  badgeBorderClass: string
}

export const CONCEPT_COLORS: Record<ConceptTone, ConceptColorDef> = {
  closed: {
    hex: '#00A3AD',
    borderClass: 'border-l-[#00A3AD]',
    titleClass: 'text-[#00A3AD] dark:text-[#00c9d6]',
    badgeBgClass: 'bg-[#00A3AD]/10',
    badgeTextClass: 'text-[#00A3AD] dark:text-[#00c9d6]',
    badgeBorderClass: 'border-[#00A3AD]/25',
  },
  commit: {
    hex: '#2563EB',
    borderClass: 'border-l-[#2563EB]',
    titleClass: 'text-blue-600 dark:text-blue-400',
    badgeBgClass: 'bg-blue-500/10',
    badgeTextClass: 'text-blue-600 dark:text-blue-400',
    badgeBorderClass: 'border-blue-500/25',
  },
  best_case: {
    hex: '#0284C7',
    borderClass: 'border-l-[#0284C7]',
    titleClass: 'text-sky-600 dark:text-sky-400',
    badgeBgClass: 'bg-sky-500/10',
    badgeTextClass: 'text-sky-600 dark:text-sky-400',
    badgeBorderClass: 'border-sky-500/25',
  },
  pipeline: {
    hex: '#EA580C',
    borderClass: 'border-l-[#EA580C]',
    titleClass: 'text-orange-600 dark:text-orange-400',
    badgeBgClass: 'bg-orange-500/10',
    badgeTextClass: 'text-orange-600 dark:text-orange-400',
    badgeBorderClass: 'border-orange-500/25',
  },
  approved: {
    hex: '#16A34A',
    borderClass: 'border-l-[#16A34A]',
    titleClass: 'text-emerald-600 dark:text-emerald-400',
    badgeBgClass: 'bg-emerald-500/10',
    badgeTextClass: 'text-emerald-600 dark:text-emerald-400',
    badgeBorderClass: 'border-emerald-500/25',
  },
  pending: {
    hex: '#D97706',
    borderClass: 'border-l-[#D97706]',
    titleClass: 'text-amber-600 dark:text-amber-400',
    badgeBgClass: 'bg-amber-500/10',
    badgeTextClass: 'text-amber-600 dark:text-amber-400',
    badgeBorderClass: 'border-amber-500/25',
  },
  not_submitted: {
    hex: '#64748B',
    borderClass: 'border-l-[#64748B]',
    titleClass: 'text-slate-600 dark:text-slate-400',
    badgeBgClass: 'bg-slate-500/10',
    badgeTextClass: 'text-slate-600 dark:text-slate-400',
    badgeBorderClass: 'border-slate-500/25',
  },
  delayed: {
    hex: '#E11D48',
    borderClass: 'border-l-[#E11D48]',
    titleClass: 'text-rose-600 dark:text-rose-400',
    badgeBgClass: 'bg-rose-500/10',
    badgeTextClass: 'text-rose-600 dark:text-rose-400',
    badgeBorderClass: 'border-rose-500/25',
  },
  slippage: {
    hex: '#F59E0B',
    borderClass: 'border-l-[#F59E0B]',
    titleClass: 'text-amber-600 dark:text-amber-400',
    badgeBgClass: 'bg-amber-500/10',
    badgeTextClass: 'text-amber-600 dark:text-amber-400',
    badgeBorderClass: 'border-amber-500/25',
  },
  lost: {
    hex: '#64748B',
    borderClass: 'border-l-[#64748B]',
    titleClass: 'text-slate-600 dark:text-slate-400',
    badgeBgClass: 'bg-slate-500/10',
    badgeTextClass: 'text-slate-600 dark:text-slate-400',
    badgeBorderClass: 'border-slate-500/25',
  },
  jan_1st: {
    hex: '#0284C7',
    borderClass: 'border-l-[#0284C7]',
    titleClass: 'text-sky-600 dark:text-sky-400',
    badgeBgClass: 'bg-sky-500/10',
    badgeTextClass: 'text-sky-600 dark:text-sky-400',
    badgeBorderClass: 'border-sky-500/25',
  },
  proposal_pending: {
    hex: '#4F46E5',
    borderClass: 'border-l-[#4F46E5]',
    titleClass: 'text-indigo-600 dark:text-indigo-400',
    badgeBgClass: 'bg-indigo-500/10',
    badgeTextClass: 'text-indigo-600 dark:text-indigo-400',
    badgeBorderClass: 'border-indigo-500/25',
  },
  total: {
    hex: '#12284C',
    borderClass: 'border-l-[#12284C] dark:border-l-[#38BDF8]',
    titleClass: 'text-[#12284C] dark:text-[#38BDF8]',
    badgeBgClass: 'bg-[#12284C]/10 dark:bg-sky-500/10',
    badgeTextClass: 'text-[#12284C] dark:text-sky-300',
    badgeBorderClass: 'border-[#12284C]/25 dark:border-sky-500/25',
  },
  active_units: {
    hex: '#4F46E5',
    borderClass: 'border-l-[#4F46E5]',
    titleClass: 'text-indigo-600 dark:text-indigo-400',
    badgeBgClass: 'bg-indigo-500/10',
    badgeTextClass: 'text-indigo-600 dark:text-indigo-400',
    badgeBorderClass: 'border-indigo-500/25',
  },
  largest_bu: {
    hex: '#2563EB',
    borderClass: 'border-l-[#2563EB]',
    titleClass: 'text-blue-600 dark:text-blue-400',
    badgeBgClass: 'bg-blue-500/10',
    badgeTextClass: 'text-blue-600 dark:text-blue-400',
    badgeBorderClass: 'border-blue-500/25',
  },
  coverage: {
    hex: '#2563EB',
    borderClass: 'border-l-[#2563EB]',
    titleClass: 'text-blue-600 dark:text-blue-400',
    badgeBgClass: 'bg-blue-500/10',
    badgeTextClass: 'text-blue-600 dark:text-blue-400',
    badgeBorderClass: 'border-blue-500/25',
  },
  neutral: {
    hex: '#64748B',
    borderClass: 'border-l-[var(--border)]',
    titleClass: 'text-[var(--text-muted)]',
    badgeBgClass: 'bg-[var(--bg-secondary)]',
    badgeTextClass: 'text-[var(--text-muted)]',
    badgeBorderClass: 'border-[var(--border-subtle)]',
  },
}

/**
 * Resolve a concept tone from label/name.
 */
export function resolveConceptTone(label: string): ConceptTone {
  const norm = (label || '').trim().toLowerCase()
  if (norm.includes('total') || norm.includes('portfolio') || norm.includes('grand')) return 'total'
  if (norm.includes('closed') || norm === 'closed won') return 'closed'
  if (norm.includes('commit coverage') || norm === 'coverage') return 'coverage'
  if (norm.includes('commit')) return 'commit'
  if (norm.includes('best case') || norm === 'bestcase') return 'best_case'
  if (norm.includes('pipeline') || norm === 'pipe') return 'pipeline'
  if (norm.includes('approved') && !norm.includes('pending') && !norm.includes('not')) return 'approved'
  if (norm.includes('pending') || norm.includes('waiting')) return 'pending'
  if (norm.includes('not submitted') || norm.includes('blank') || norm.includes('not yet')) return 'not_submitted'
  if (norm.includes('delayed') || norm.includes('overdue')) return 'delayed'
  if (norm.includes('slip') || norm.includes('slippage')) return 'slippage'
  if (norm.includes('lost') || norm.includes('deleted')) return 'lost'
  if (norm.includes('jan 1') || norm.includes('january 1')) return 'jan_1st'
  if (norm.includes('proposal pending')) return 'proposal_pending'
  if (norm.includes('active unit') || norm.includes('active bu')) return 'active_units'
  if (norm.includes('largest bu') || norm.includes('largest unit')) return 'largest_bu'
  return 'neutral'
}

/**
 * Fixed stable palette for regions.
 * Same region = same colour on every page via deterministic string hash.
 */
export const REGION_PALETTE = [
  '#00A3AD', // teal
  '#2563EB', // blue
  '#7C3AED', // violet
  '#0284C7', // sky
  '#059669', // emerald
  '#D97706', // amber
  '#EA580C', // orange
  '#EC4899', // pink
]

export function getRegionColor(regionName: string): string {
  if (!regionName) return REGION_PALETTE[0]
  let hash = 0
  for (let i = 0; i < regionName.length; i++) {
    hash = (hash << 5) - hash + regionName.charCodeAt(i)
    hash |= 0
  }
  const idx = Math.abs(hash) % REGION_PALETTE.length
  return REGION_PALETTE[idx]
}

