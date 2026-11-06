import React from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'
import Card from '@/components/ui/Card'

interface PageErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function PageErrorState({
  message = "Couldn’t load this page. Try again",
  onRetry,
}: PageErrorStateProps) {
  return (
    <div className="p-8 flex items-center justify-center min-h-[320px]">
      <Card className="max-w-md w-full p-6 text-center shadow-md border-rose-500/20 bg-rose-500/5">
        <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-4 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-[var(--text-primary)] mb-2">
          {message}
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-6">
          We encountered an issue communicating with the backend server.
        </p>
        <button
          type="button"
          onClick={() => {
            if (onRetry) {
              onRetry()
            } else {
              window.location.reload()
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#12284C] dark:bg-[#00A3AD] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </Card>
    </div>
  )
}

export default PageErrorState
