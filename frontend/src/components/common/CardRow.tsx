import React from 'react'
import { clsx } from 'clsx'

export interface CardRowProps {
  cols?: string
  template?: string
  gap?: string
  minHeight?: string
  className?: string
  children: React.ReactNode
}

/**
 * CardRow helper implementing Principles R1 & R2:
 * R1: Every row of cards is a CSS grid row with equal-height cards (align-items: stretch)
 *     and its column widths add up to the full container width.
 * R2: Supports compact max-content columns with flexible row-mates.
 * Responsive: Stacks to 1 column below 1100px.
 */
export default function CardRow({
  cols,
  template,
  gap = 'gap-4',
  minHeight,
  className = '',
  children,
}: CardRowProps) {
  const colDef = template || cols || '1fr 1fr'

  return (
    <div
      className={clsx('card-row-grid', gap, className)}
      style={{
        ['--card-row-cols' as any]: colDef,
        minHeight,
      }}
    >
      {children}
    </div>
  )
}

