import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { 
  DollarSign, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  MessageSquare, 
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  Search,
  ExternalLink
} from 'lucide-react'
import { getKamOverview } from '@/api/client'
import { formatCurrency, formatNumber, formatDate, getForecastCategoryLabel, getApprovalStatusLabel } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import CardRow from '@/components/common/CardRow'

export default function KamOverview() {
  const { currentUser } = useAuthStore()
  const [selectedOppId, setSelectedOppId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['kam-overview', currentUser?.id],
    queryFn: async () => {
      return await getKamOverview()
    },
  })

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-[var(--bg-secondary)] rounded-md animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-[var(--bg-secondary)] rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Failed to load KAM overview</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          {(error as any)?.message || 'Could not retrieve your renewal opportunity portfolio.'}
        </p>
      </div>
    )
  }

  const kpis = data.kpis || {
    total_acv: 0,
    total_count: 0,
    commit_acv: 0,
    commit_count: 0,
    closed_acv: 0,
    closed_count: 0,
    best_case_acv: 0,
    best_case_count: 0,
    pipeline_acv: 0,
    pipeline_count: 0,
    unapproved_commit_count: 0,
    unapproved_commit_acv: 0,
    delayed_count: 0,
    delayed_acv: 0,
    unread_messages: 0,
  }

  const categoryBreakdown = data.category_breakdown || []
  const urgentDeals = data.urgent_deals || []
  const delayedDeals = data.delayed_deals || []

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            My Portfolio Overview
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Logged in as <span className="font-semibold text-[var(--text-primary)]">{currentUser?.name}</span> ({currentUser?.owner_name || 'Opportunity Owner'})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/kam/deals"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm"
          >
            <span>View All My Deals ({kpis.total_count})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            to="/messages"
            className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Messages</span>
            {kpis.unread_messages > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-teal-500 text-white">
                {kpis.unread_messages}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total ACV */}
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-medium mb-1">
            <span>MY TOTAL PORTFOLIO</span>
            <DollarSign className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
            {formatCurrency(kpis.total_acv)}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {kpis.total_count} renewal {kpis.total_count === 1 ? 'deal' : 'deals'}
          </div>
        </div>

        {/* Commit Coverage */}
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-medium mb-1">
            <span>COMMIT COVERAGE</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {formatCurrency(kpis.closed_acv + kpis.commit_acv)}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            Closed: {formatCurrency(kpis.closed_acv)} ({kpis.closed_count}) · Commit: {formatCurrency(kpis.commit_acv)} ({kpis.commit_count})
          </div>
        </div>

        {/* Unapproved Commit */}
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-medium mb-1">
            <span>UNAPPROVED COMMIT</span>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
            {formatCurrency(kpis.unapproved_commit_acv)}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {kpis.unapproved_commit_count} deals pending management approval
          </div>
        </div>

        {/* Delayed Renewals */}
        <div className="p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)] font-medium mb-1">
            <span>DELAYED RENEWALS</span>
            <Clock className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
            {formatCurrency(kpis.delayed_acv)}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {kpis.delayed_count} deals past close date or scheduled delay
          </div>
        </div>
      </div>

      {/* Main Grid: Forecast Category Distribution & Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Forecast Categories Breakdown */}
        <div className="lg:col-span-1 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm flex flex-col">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            Forecast Category Split
          </h3>
          <div className="space-y-3 flex-1">
            {categoryBreakdown.map((cat: any) => {
              const pct = kpis.total_acv > 0 ? (cat.acv / kpis.total_acv) * 100 : 0
              return (
                <div key={cat.category} className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-[var(--text-primary)]">
                      {getForecastCategoryLabel(cat.category)}
                    </span>
                    <span className="font-bold text-[var(--text-primary)] tabular-nums">
                      {formatCurrency(cat.acv)}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-teal-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mt-1">
                    <span>{cat.count} {cat.count === 1 ? 'deal' : 'deals'}</span>
                    <span>{pct.toFixed(1)}% of ACV</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Action Items / High Priority Deals */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Immediate Attention Required
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Commit deals awaiting approval or closing within 30 days
              </p>
            </div>
            <Link
              to="/kam/deals"
              className="text-xs text-teal-600 dark:text-teal-400 font-semibold hover:underline flex items-center gap-1"
            >
              See all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {urgentDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-12 text-center text-xs text-[var(--text-muted)]">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 opacity-80" />
              <p className="font-medium text-[var(--text-primary)]">All clear!</p>
              <p>No unapproved Commit deals or urgent closing deadlines.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
                    <th className="pb-2.5">Opportunity</th>
                    <th className="pb-2.5">Account</th>
                    <th className="pb-2.5 text-right">ACV</th>
                    <th className="pb-2.5">Approval</th>
                    <th className="pb-2.5">Close Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {urgentDeals.slice(0, 7).map((d: any) => (
                    <tr
                      key={d.opportunity_id_18}
                      onClick={() => setSelectedOppId(d.opportunity_id_18)}
                      className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors group"
                    >
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-[var(--text-primary)] max-w-xs truncate group-hover:text-teal-600 transition-colors">
                          {d.opportunity_name}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">{d.opportunity_id_18}</div>
                      </td>
                      <td className="py-2.5 pr-2 max-w-[140px] truncate text-[var(--text-secondary)]">
                        {d.account_name}
                      </td>
                      <td className="py-2.5 pr-2 text-right font-bold text-[var(--text-primary)] tabular-nums">
                        {formatCurrency(d.forecast_acv_amount)}
                      </td>
                      <td className="py-2.5 pr-2">
                        <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-semibold ${
                          d.approval_status === 'Approved'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        }`}>
                          {getApprovalStatusLabel(d.approval_status)}
                        </span>
                      </td>
                      <td className="py-2.5 tabular-nums text-[var(--text-secondary)]">
                        {formatDate(d.close_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Opportunity Detail Drawer */}
      <OpportunityDrawer
        oppId={selectedOppId}
        onClose={() => setSelectedOppId(null)}
      />
    </div>
  )
}

