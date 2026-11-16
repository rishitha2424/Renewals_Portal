import React from 'react'
import { clsx } from 'clsx'
import { ArrowRight } from 'lucide-react'
import { ConceptTone, CONCEPT_COLORS } from '@/design/conceptColors'

export interface InsightItem {
  id: string
  icon?: React.ComponentType<{ className?: string }>
  text: React.ReactNode
  linkText?: string
  onLinkClick?: () => void
}

export interface InsightCardProps {
  title: string
  subtitle?: string
  icon?: React.ComponentType<{ className?: string }>
  tone?: ConceptTone
  badge?: React.ReactNode
  action?: React.ReactNode
  insights: InsightItem[]
  footer?: React.ReactNode
  className?: string
  emptyText?: string
}

/**
 * InsightCard: Renders 3-8 plain-language insight lines generated from live data,
 * filling card height evenly with space-between distribution and no decorative icons (F1, F4, F8).
 */
export default function InsightCard({
  title,
  subtitle,
  tone = 'total',
  badge,
  action,
  insights,
  footer,
  className = '',
  emptyText = 'No specific signals detected for this view.',
}: InsightCardProps) {
  const toneDef = CONCEPT_COLORS[tone] || CONCEPT_COLORS.total

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
          <div className="flex items-center gap-2">
            {badge}
            {action}
          </div>
        </div>

        {/* Insight Lines - Top-aligned with fixed 10px gap, NO spreading (Phase 1 Item D) */}
        <div className="flex-1 min-h-0 flex flex-col justify-start gap-2.5 my-1 overflow-y-auto">
          {insights.length > 0 ? (
            insights.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--bg-secondary)]/40 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] leading-relaxed"
              >
                <div className="flex-1">
                  <span>{item.text}</span>
                  {item.linkText && item.onLinkClick && (
                    <button
                      type="button"
                      onClick={item.onLinkClick}
                      className="inline-flex items-center gap-0.5 ml-2 text-[11px] font-semibold text-[var(--brand-teal)] hover:underline cursor-pointer"
                    >
                      <span>{item.linkText}</span>
                      <ArrowRight className="w-3 h-3 inline" />
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-[var(--text-muted)] py-4 text-center my-auto">{emptyText}</p>
          )}
        </div>
      </div>

      {footer && <div className="pt-2 border-t border-[var(--border-subtle)] mt-2 shrink-0">{footer}</div>}
    </div>
  )
}
