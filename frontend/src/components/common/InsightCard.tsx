import React from 'react'
import { clsx } from 'clsx'
import { Sparkles, ArrowRight } from 'lucide-react'
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
 * InsightCard: Renders 3-5 plain-language insight lines generated from live data,
 * with optional drilldown link, styled in the concept tone palette.
 */
export default function InsightCard({
  title,
  subtitle,
  icon: Icon = Sparkles,
  tone = 'total',
  badge,
  action,
  insights,
  footer,
  className = '',
  emptyText = 'No specific insights detected for this view.',
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
      <div>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-[var(--border-subtle)]">
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
          <div className="flex items-center gap-2">
            {badge}
            {action}
          </div>
        </div>

        {/* Insight Lines */}
        <div className="space-y-2.5 my-2">
          {insights.length > 0 ? (
            insights.slice(0, 5).map((item) => {
              const ItemIcon = item.icon || Sparkles
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 p-2 rounded-lg bg-[var(--bg-secondary)]/40 border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] leading-relaxed"
                >
                  <ItemIcon className="w-3.5 h-3.5 text-[var(--brand-teal)] shrink-0 mt-0.5" />
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
              )
            })
          ) : (
            <p className="text-xs text-[var(--text-muted)] py-3 text-center">{emptyText}</p>
          )}
        </div>
      </div>

      {footer && <div className="pt-2 border-t border-[var(--border-subtle)] mt-2">{footer}</div>}
    </div>
  )
}

