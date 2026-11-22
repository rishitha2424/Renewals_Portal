import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import clsx from 'clsx'

interface DrawerProps {
  open?: boolean
  isOpen?: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  position?: 'right' | 'left'
}

export function Drawer({
  open,
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width,
  size = 'md',
  position = 'right',
}: DrawerProps) {
  const isDrawerOpen = open ?? isOpen ?? false

  const sizeWidthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-xl',
    xl: 'max-w-3xl',
  }

  const effectiveWidth = width || sizeWidthMap[size] || 'max-w-md'

  // Lock body scroll when open
  useEffect(() => {
    if (isDrawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isDrawerOpen])

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawerOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDrawerOpen, onClose])

  const slideX = position === 'right' ? '100%' : '-100%'

  const content = (
    <AnimatePresence>
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[100] overflow-hidden flex">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: slideX }}
            animate={{ x: 0 }}
            exit={{ x: slideX }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{ width: 'min(960px, 94vw)', maxWidth: 'min(960px, 94vw)' }}
            className={clsx(
              'relative z-10 w-full bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col h-full',
              'max-sm:max-w-full max-sm:rounded-none',
              position === 'right' ? 'sm:rounded-l-2xl' : 'sm:rounded-r-2xl',
              position === 'right' ? 'ml-auto' : 'mr-auto'
            )}
          >
            {/* Sticky Header with prominent title, subtitle, and close button */}
            <div
              className={clsx(
                'sticky top-0 z-30 flex items-center justify-between px-6 sm:px-8 py-5 border-b border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm shrink-0',
                position === 'right' ? 'sm:rounded-tl-2xl' : 'sm:rounded-tr-2xl'
              )}
            >
              <div className="min-w-0 pr-4">
                {title && (
                  <h3 className="font-extrabold text-base sm:text-lg text-[var(--text-primary)] truncate leading-tight" title={title}>
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p className="text-xs sm:text-sm font-semibold text-teal-600 dark:text-teal-400 mt-1 truncate font-mono">
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors focus:outline-none flex-shrink-0 cursor-pointer border border-[var(--border)] shadow-xs"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]/30">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return null
  const target = document.getElementById('root') || document.body
  return createPortal(content, target)
}

export default Drawer
