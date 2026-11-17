import React from 'react'
import { clsx } from 'clsx'

export interface CardRowProps {
  id?: string
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
  id,
  cols,
  template,
  gap = 'gap-4',
  minHeight,
  className = '',
  children,
}: CardRowProps) {
  const colDef = template || cols || '1fr 1fr'
  // Split on whitespace not inside parentheses to count columns accurately
  const segments = colDef.trim().split(/\s+(?![^(]*\))/)
  const isThreeOrMore = segments.length >= 3

  return (
    <div
      id={id}
      className={clsx(
        'card-row-grid',
        isThreeOrMore ? 'card-row-three-col' : 'card-row-two-col',
        gap,
        className
      )}
      style={{
        ['--card-row-cols' as any]: colDef,
        minHeight,
      }}
    >
      {children}
    </div>
  )
}

