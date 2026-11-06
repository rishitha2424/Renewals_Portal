import React from 'react'
import { AlertCircle } from 'lucide-react'
import { formatCurrency } from '@/utils/format'

interface ExcludedTypesNoteProps {
  excluded?: {
    count: number
    acv: number
    note?: string
    deals?: any[]
  } | null
  onViewDeals?: () => void
  className?: string
}

export default function ExcludedTypesNote({ excluded, onViewDeals, className = '' }: ExcludedTypesNoteProps) {
  if (!excluded || excluded.count <= 0) return null

  return (
    <div
      className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-700 dark:text-slate-300 text-xs ${className}`}
      id="excluded-types-note"
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-slate-500 shrink-0" />
        <span>
          Other types excluded: <strong>{excluded.count} {excluded.count === 1 ? 'deal' : 'deals'} / {formatCurrency(excluded.acv)}</strong>
        </span>
      </div>
      {onViewDeals && (
        <button
          type="button"
          onClick={onViewDeals}
          className="underline hover:text-slate-900 dark:hover:text-white font-semibold cursor-pointer text-xs ml-3 whitespace-nowrap"
          id="btn-view-excluded-deals"
        >
          view deals →
        </button>
      )}
    </div>
  )
}
