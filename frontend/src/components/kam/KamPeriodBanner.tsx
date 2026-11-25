import React from 'react'
import { Calendar, ArrowRight } from 'lucide-react'
import { formatCurrency } from '@/utils/format'

export const openPeriodSelector = () => {
  const el = document.getElementById('filter-period-select') as HTMLSelectElement | null
  if (el) {
    el.focus()
    try {
      if (typeof el.showPicker === 'function') {
        el.showPicker()
      } else {
        el.click()
      }
    } catch (_) {
      el.click()
    }
  } else {
    const mobileBtn = document.getElementById('topbar-filters-drawer-btn')
    if (mobileBtn) mobileBtn.click()
  }
}

interface KamPeriodBannerProps {
  periodInfo?: {
    period_label?: string
    showing_count?: number
    showing_acv?: number
    other_periods_count?: number
    other_periods_acv?: number
    total_all_count?: number
  }
  defaultPeriod?: string
  fallbackCount?: number
  fallbackAcv?: number
}

export const KamPeriodBanner: React.FC<KamPeriodBannerProps> = ({
  periodInfo,
  defaultPeriod,
  fallbackCount = 0,
  fallbackAcv = 0,
}) => {
  const count = periodInfo?.showing_count ?? fallbackCount
  const acv = periodInfo?.showing_acv ?? fallbackAcv
  const otherCount = periodInfo?.other_periods_count ?? 0
  const periodLabel = periodInfo?.period_label || defaultPeriod || 'Current quarter'

  const dealNoun = count === 1 ? 'deal' : 'deals'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
      <div className="flex items-center gap-2 flex-wrap">
        <Calendar className="w-4 h-4 text-[#00A3AD] shrink-0" />
        <span>
          Showing <strong className="text-[var(--text-primary)] font-bold">{periodLabel}</strong>: {count} {dealNoun}, {formatCurrency(acv)}.{' '}
          {count === 0 ? (
            <>
              No deals in this period —{' '}
              <button
                type="button"
                onClick={openPeriodSelector}
                className="font-semibold text-[#00A3AD] hover:underline cursor-pointer inline-flex items-center gap-0.5"
              >
                change the period above
              </button>{' '}
              to see other deals{otherCount > 0 ? ` (${otherCount} more in other periods)` : ''}.
            </>
          ) : otherCount > 0 ? (
            <>
              <button
                type="button"
                onClick={openPeriodSelector}
                className="font-semibold text-[#00A3AD] hover:underline cursor-pointer inline-flex items-center gap-0.5"
              >
                Change the period above
              </button>{' '}
              to see other deals ({otherCount} more in other periods).
            </>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              All active renewal deals are currently displayed.
            </span>
          )}
        </span>
      </div>

      {otherCount > 0 && (
        <button
          type="button"
          onClick={openPeriodSelector}
          className="font-semibold text-[#00A3AD] hover:underline cursor-pointer flex items-center gap-1 shrink-0 ml-auto"
        >
          <span>Change period</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

export default KamPeriodBanner

