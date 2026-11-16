import React from 'react'
import { clsx } from 'clsx'

export interface ScrollListProps {
  maxHeight?: string | number
  height?: string | number
  className?: string
  children: React.ReactNode
}

/**
 * ScrollList provides a fixed/max-height inner scroll container with visible thin scrollbar,
 * preventing uneven vertical expansion of row cards.
 */
export default function ScrollList({
  maxHeight = '360px',
  height,
  className = '',
  children,
}: ScrollListProps) {
  return (
    <div
      className={clsx('overflow-y-auto pr-1.5 space-y-2', className)}
      style={{
        maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    >
      {children}
    </div>
  )
}

