import React from 'react'

export interface SectionHeadingProps {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export default function SectionHeading({
  title,
  subtitle,
  badge,
  action,
  className = '',
}: SectionHeadingProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}>
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-lg font-black text-[var(--text-primary)] tracking-tight">
            {title}
          </h2>
          {badge}
        </div>
        {subtitle && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}

