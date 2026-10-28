import React, { useState, useRef, useEffect } from 'react'
import { MoreVertical, Edit2, ArrowLeft, ArrowRight, Trash2 } from 'lucide-react'
import { CustomColumnItem } from '@/api/client'

interface ColumnHeaderMenuProps {
  column: CustomColumnItem
  canMoveLeft: boolean
  canMoveRight: boolean
  isAdmin: boolean
  onRename: (col: CustomColumnItem) => void
  onMove: (col: CustomColumnItem, direction: 'left' | 'right') => void
  onDelete: (col: CustomColumnItem) => void
}

export const ColumnHeaderMenu: React.FC<ColumnHeaderMenuProps> = ({
  column,
  canMoveLeft,
  canMoveRight,
  isAdmin,
  onRename,
  onMove,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  if (!isAdmin) return null

  return (
    <div className="relative inline-block text-left" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
        title="Column Options"
        aria-label="Column Options"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-36 rounded-lg bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50 text-xs font-normal animate-in fade-in-50 zoom-in-95">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              onRename(column)
            }}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Rename</span>
          </button>

          <button
            type="button"
            disabled={!canMoveLeft}
            onClick={() => {
              setIsOpen(false)
              onMove(column, 'left')
            }}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
            <span>Move Left</span>
          </button>

          <button
            type="button"
            disabled={!canMoveRight}
            onClick={() => {
              setIsOpen(false)
              onMove(column, 'right')
            }}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            <span>Move Right</span>
          </button>

          <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />

          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              onDelete(column)
            }}
            className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default ColumnHeaderMenu
