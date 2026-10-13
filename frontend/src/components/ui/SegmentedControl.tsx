import React from 'react'
import { motion } from 'framer-motion'
import clsx from 'clsx'

export interface SegmentOption<T extends string = string> {
  value: T
  label: string
  icon?: React.ReactNode
  badge?: string | number
}

interface SegmentedControlProps<T extends string = string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const sizeClasses = {
    sm: 'p-0.5 text-xs',
    md: 'p-1 text-sm',
    lg: 'p-1.5 text-base',
  }[size]

  const itemPadding = {
    sm: 'px-2.5 py-1',
    md: 'px-3.5 py-1.5',
    lg: 'px-4 py-2',
  }[size]

  return (
    <div
      className={clsx(
        'inline-flex items-center rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] p-1 relative',
        sizeClasses,
        className
      )}
    >
      {options.map((option) => {
        const isSelected = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={clsx(
              'relative z-10 font-medium rounded-lg transition-colors flex items-center gap-1.5 select-none focus:outline-none',
              itemPadding,
              isSelected
                ? 'text-[var(--text-primary)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            {isSelected && (
              <motion.div
                layoutId="segmented-indicator"
                className="absolute inset-0 rounded-lg bg-[var(--bg-card)] shadow-sm border border-[var(--border)]"
                transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.label}
              {option.badge != null && (
                <span
                  className={clsx(
                    'text-[10px] px-1.5 py-0.2 rounded-sm tabular-nums',
                    isSelected
                      ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold'
                      : 'bg-black/5 dark:bg-white/5 text-[var(--text-muted)]'
                  )}
                >
                  {option.badge}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
