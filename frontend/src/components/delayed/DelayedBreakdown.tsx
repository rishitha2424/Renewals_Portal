import React from 'react'
import { acvM } from '@/utils/format'
import { getMetricPolarity, getDeltaTextColor } from '@/utils/format'

export interface DelayedBreakdownProps {
  delRenewals: any
  summary: any
  yDateStr: string
  lwDateStr: string
  isFuture: boolean
  onDealsClick: (title: string, params: Record<string, any>) => void
  onClose?: () => void
}

export default function DelayedBreakdown({
  delRenewals,
  summary,
  yDateStr,
  lwDateStr,
  isFuture,
  onDealsClick,
  onClose,
}: DelayedBreakdownProps) {
  const overdueCat =
    delRenewals?.overdue || summary?.overdue || summary?.slippage?.categories?.overdue
  const laterCat =
    delRenewals?.ahead ||
    delRenewals?.later_close ||
    summary?.ahead ||
    summary?.later_close ||
    summary?.slippage?.categories?.ahead ||
    summary?.slippage?.categories?.later_close

  const delayedCards = [
    {
      id: 'overdue',
      title: 'Overdue Deals',
      data: overdueCat,
      isOverdue: true,
      kind: 'overdue',
      deltaKind: 'delayed_overdue_delta',
      baselineLabel: 'Current',
    },
    {
      id: 'delayed_ahead',
      title: 'Delayed, close date ahead',
      data: laterCat,
      isOverdue: false,
      kind: 'delayed_ahead',
      deltaKind: 'delayed_ahead',
      baselineLabel: 'Since start of period',
    },
  ]

  const renderSubBox = (
    label: string,
    delta: { count: number; acv: number } | null | undefined,
    dateLabel: string,
    onBoxClick: () => void,
    drawerTitle: string,
    metricOrPolarity: string
  ) => {
    if (delta === null || delta === undefined || delta.count === null || isFuture) {
      return (
        <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] opacity-60 cursor-default">
          <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
          <div className="font-bold text-xs text-slate-400 dark:text-slate-500 tabular-nums">n/a</div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500">n/a</div>
        </div>
      )
    }

    const polarity = getMetricPolarity(metricOrPolarity)
    const absCount = Math.abs(delta.count || 0)
    const absAcv = Math.abs(delta.acv || 0)
    const hasDeals = absCount > 0 || absAcv > 0

    let acvText = '$0'
    let countText = '0 deals'
    let acvColor = 'text-slate-400 dark:text-slate-500 font-normal'
    let countColor = 'text-slate-400 dark:text-slate-500 font-normal'
    let arrow = ''

    if (hasDeals) {
      acvColor = getDeltaTextColor(delta.acv, polarity)
      countColor = getDeltaTextColor(delta.count, polarity)

      const acvSign = (delta.acv || 0) > 0 ? '+' : (delta.acv || 0) < 0 ? '-' : ''
      acvText = `${acvSign}${acvM(absAcv)}`

      const cntSign = (delta.count || 0) > 0 ? '+' : (delta.count || 0) < 0 ? '-' : ''
      countText = `${cntSign}${absCount} ${absCount === 1 ? 'deal' : 'deals'}`

      if (polarity !== 'neutral') {
        if (delta.acv > 0 || delta.count > 0) arrow = '↑ '
        else if (delta.acv < 0 || delta.count < 0) arrow = '↓ '
      }
    }

    return (
      <div
        className={`p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] transition-colors ${
          hasDeals ? 'cursor-pointer hover:border-[var(--brand-teal)]' : 'cursor-default opacity-70'
        }`}
        onClick={() => hasDeals && onBoxClick()}
        title={hasDeals ? `Click to view deals changed (${drawerTitle})` : `No deals changed ${dateLabel}`}
      >
        <div className="text-[10px] font-semibold text-[var(--text-muted)] truncate">{label}</div>
        <div className={`font-bold text-xs tabular-nums ${acvColor}`}>
          {arrow}{acvText}
        </div>
        <div className={`text-[10px] tabular-nums ${countColor}`}>{countText}</div>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Delayed Renewals Breakdown
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Close breakdown ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {delayedCards.map((c) => {
          const cnt = c.data?.count ?? 0
          const acvVal = c.data?.acv ?? 0
          const isNA = isFuture || c.data?.count === null
          const hasDeals = cnt > 0 || acvVal > 0
          const mainTitle = `${c.title} (${cnt} ${cnt === 1 ? 'deal' : 'deals'} · ${acvM(acvVal)})`

          const yDelta = c.data?.delayed_vs_yesterday ?? c.data?.delta_yesterday
          const lwDelta = c.data?.delayed_vs_lastweek ?? c.data?.delta_lastweek
          const yCnt = Math.abs(yDelta?.count || 0)
          const yAcv = Math.abs(yDelta?.acv || 0)
          const lwCnt = Math.abs(lwDelta?.count || 0)
          const lwAcv = Math.abs(lwDelta?.acv || 0)

          const yTitle = `${c.title} · vs yesterday (${yCnt} ${yCnt === 1 ? 'deal' : 'deals'} · ${acvM(yAcv)})`
          const lwTitle = `${c.title} · vs last week (${lwCnt} ${lwCnt === 1 ? 'deal' : 'deals'} · ${acvM(lwAcv)})`

          return (
            <div
              key={c.id}
              className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-secondary)]">{c.title}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20 tabular-nums">
                    {isNA ? 'n/a' : `${cnt} deals`}
                  </span>
                </div>
                <div
                  className={`font-extrabold text-2xl text-[var(--text-primary)] tabular-nums ${
                    hasDeals && !isNA ? 'cursor-pointer hover:underline' : 'cursor-default'
                  }`}
                  onClick={() =>
                    hasDeals &&
                    !isNA &&
                    onDealsClick(mainTitle, {
                      kind: c.kind,
                      compare: c.isOverdue ? undefined : 'period_start',
                    })
                  }
                  title={hasDeals ? `Click to view ${c.title}` : '0 deals'}
                >
                  {isNA ? 'n/a' : acvM(acvVal)}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 font-medium">
                  {c.baselineLabel}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--border)] grid grid-cols-2 gap-2">
                {renderSubBox(
                  'vs yesterday',
                  yDelta,
                  yDateStr,
                  () => onDealsClick(yTitle, { kind: c.deltaKind, compare: 'yesterday' }),
                  yTitle,
                  c.isOverdue ? 'Overdue' : 'Delayed'
                )}
                {renderSubBox(
                  'vs last week',
                  lwDelta,
                  lwDateStr,
                  () => onDealsClick(lwTitle, { kind: c.deltaKind, compare: 'last_week' }),
                  lwTitle,
                  c.isOverdue ? 'Overdue' : 'Delayed'
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
