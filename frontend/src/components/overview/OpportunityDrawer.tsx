import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  History,
  FileText,
  DollarSign,
  Calendar,
  User,
  Building,
  Globe,
  Tag,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react'
import { getOpportunity, getOpportunityHistory, getOpportunityChangelog } from '@/api/client'
import { formatACV, formatDate } from '@/utils/format'
import Badge, { ForecastBadge, ApprovalBadge } from '@/components/ui/Badge'
import Drawer from '@/components/ui/Drawer'
import { Skeleton } from '@/components/ui/Skeleton'
import showToast from '@/components/ui/Toast'
import { useAppStore } from '@/store/appStore'
import clsx from 'clsx'

export interface DealComment {
  id: string
  oppId: string
  oppName?: string
  author: string
  text: string
  createdAt: string
}

interface OpportunityDrawerProps {
  oppId: string | null
  onClose: () => void
}

export default function OpportunityDrawer({ oppId, onClose }: OpportunityDrawerProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'changelog' | 'details' | 'comments'>('timeline')
  const activeSnapshotId = useAppStore((s) => s.activeSnapshotId)
  const adminName = useAppStore((s) => s.adminName)

  // Comments & Audit logging state
  const [comments, setComments] = useState<DealComment[]>([])
  const [commentAuthor, setCommentAuthor] = useState<string>(() => {
    return localStorage.getItem('deal_commenter_name') || 'Reviewer'
  })
  const [commentText, setCommentText] = useState('')

  useEffect(() => {
    if (!oppId) {
      setComments([])
      return
    }
    try {
      const raw = localStorage.getItem(`deal_comments_${oppId}`)
      if (raw) {
        setComments(JSON.parse(raw))
      } else {
        setComments([])
      }
    } catch {
      setComments([])
    }
  }, [oppId])

  const handleAddComment = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = commentText.trim()
    if (!trimmed || !oppId) return

    const author = commentAuthor.trim() || adminName || 'Reviewer'
    localStorage.setItem('deal_commenter_name', author)

    const newComment: DealComment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      oppId,
      oppName: opp?.opportunity_name || 'Opportunity',
      author,
      text: trimmed,
      createdAt: new Date().toISOString(),
    }

    const updated = [newComment, ...comments]
    setComments(updated)
    try {
      localStorage.setItem(`deal_comments_${oppId}`, JSON.stringify(updated))

      // Also append to global deal comments audit log for Data Explorer
      const globalRaw = localStorage.getItem('global_deal_comments_log')
      const globalList = globalRaw ? JSON.parse(globalRaw) : []
      globalList.unshift(newComment)
      localStorage.setItem('global_deal_comments_log', JSON.stringify(globalList))
    } catch {
      // ignore
    }

    setCommentText('')
    showToast.success('Comment saved and logged')
  }

  const handleDeleteComment = (commentId: string) => {
    if (!oppId) return
    const updated = comments.filter((c) => c.id !== commentId)
    setComments(updated)
    try {
      localStorage.setItem(`deal_comments_${oppId}`, JSON.stringify(updated))

      const globalRaw = localStorage.getItem('global_deal_comments_log')
      if (globalRaw) {
        const globalList = JSON.parse(globalRaw).filter((c: any) => c.id !== commentId)
        localStorage.setItem('global_deal_comments_log', JSON.stringify(globalList))
      }
    } catch {
      // ignore
    }
    showToast.info('Comment removed')
  }

  const { data: opp, isLoading: oppLoading } = useQuery({
    queryKey: ['opportunity', oppId, activeSnapshotId],
    queryFn: () => (oppId ? getOpportunity(oppId, activeSnapshotId ?? undefined) : null),
    enabled: !!oppId,
  })

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['opportunity-history', oppId],
    queryFn: () => (oppId ? getOpportunityHistory(oppId) : []),
    enabled: !!oppId,
  })

  const { data: changelog = [], isLoading: changelogLoading } = useQuery({
    queryKey: ['opportunity-changelog', oppId],
    queryFn: () => (oppId ? getOpportunityChangelog(oppId) : []),
    enabled: !!oppId,
  })

  return (
    <Drawer
      isOpen={!!oppId}
      onClose={onClose}
      title={opp?.opportunity_name || 'Opportunity Details'}
      subtitle={`ID: ${oppId ?? ''}`}
      size="lg"
    >
      {oppLoading ? (
        <div className="space-y-4">
          <Skeleton variant="text" width="60%" height="28px" />
          <Skeleton variant="card" height="120px" />
          <Skeleton variant="card" height="240px" />
        </div>
      ) : !opp ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">
          Opportunity not found or inactive in this snapshot.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Metric Summary Header */}
          <div className="p-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Account Name
                </p>
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  {opp.account_name || 'N/A'}
                </h3>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Forecast ACV
                </p>
                <p className="font-black text-xl text-teal-600 dark:text-teal-400 tabular-nums">
                  {formatACV(opp.forecast_acv_amount ?? 0)}
                </p>
              </div>
            </div>

            {/* Badges Strip */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border)] text-xs">
              <ForecastBadge category={opp.forecast_category ?? 'Blank'} />
              <ApprovalBadge status={opp.approval_status ?? 'Blank'} />
              {opp.service_expiry_period && (
                <span className="px-2.5 py-0.5 rounded-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                  Expires: {opp.service_expiry_period}
                </span>
              )}
              {opp.probability_pct != null && (
                <span className="px-2.5 py-0.5 rounded-sm font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                  Prob: {opp.probability_pct}%
                </span>
              )}
            </div>
          </div>

          {/* Deal Risk Score & "Why is this risky?" Breakdown */}
          {opp.risk_score !== undefined && (
            <div className="p-4 rounded-md bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className={clsx(
                      'w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm  shadow-sm',
                      opp.risk_score >= 65
                        ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
                        : opp.risk_score >= 35
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    )}
                  >
                    {opp.risk_score}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">
                      Deal Risk Score
                    </h4>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {opp.risk_level?.toUpperCase()} RISK · {opp.risk_score}/100 POINTS
                    </p>
                  </div>
                </div>
                <span
                  className={clsx(
                    'text-xs px-2.5 py-1 rounded-sm font-bold uppercase tracking-wide',
                    opp.risk_score >= 65
                      ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20'
                      : opp.risk_score >= 35
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  )}
                >
                  {opp.risk_level}
                </span>
              </div>

              {/* Factors list: "Why is this risky?" */}
              {opp.risk_factors && opp.risk_factors.length > 0 && (
                <div className="pt-2 border-t border-[var(--border)] space-y-2">
                  <p className="text-xs font-bold text-[var(--text-secondary)] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                    Why is this risky? (Contributing Factors)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {opp.risk_factors.map((f: any, idx: number) => (
                      <div
                        key={idx}
                        className={clsx(
                          'p-2.5 rounded-xl border flex flex-col justify-between transition-colors',
                          f.points > 0
                            ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 text-[var(--text-primary)]'
                            : 'bg-[var(--bg-secondary)]/50 border-[var(--border)] text-[var(--text-muted)]'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs text-[var(--text-primary)]">{f.name}</span>
                          <span
                            className={clsx(
                              'font-bold px-1.5 py-0.5 rounded text-[10px]',
                              f.points > 0 ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-slate-500/10 text-slate-400'
                            )}
                          >
                            +{f.points} pts
                          </span>
                        </div>
                        <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
                          {f.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="flex border-b border-[var(--border)]">
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'timeline'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Snapshot Timeline ({history.length})
              {activeTab === 'timeline' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('changelog')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'changelog'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Change Log ({changelog.length})
              {activeTab === 'changelog' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('details')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'details'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              Opportunity Fields
              {activeTab === 'details' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('comments')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 ${
                activeTab === 'comments'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Comments & Notes ({comments.length})
              {activeTab === 'comments' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
          </div>

          {/* TAB 1: Snapshot Timeline */}
          {activeTab === 'timeline' && (
            <div className="space-y-3">
              {historyLoading ? (
                <div className="space-y-3">
                  <Skeleton variant="card" height="80px" />
                  <Skeleton variant="card" height="80px" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-6 text-center">
                  No snapshot history recorded for this deal.
                </p>
              ) : (
                <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--border)]">
                  {history.map((step: any, idx: number) => {
                    const prevStep = idx > 0 ? history[idx - 1] : null
                    const acvChanged =
                      prevStep && prevStep.forecast_acv_amount !== step.forecast_acv_amount
                    const catChanged =
                      prevStep && prevStep.forecast_category !== step.forecast_category
                    const appChanged =
                      prevStep && prevStep.approval_status !== step.approval_status

                    return (
                      <div key={step.snapshot_date} className="relative group">
                        {/* Dot indicator */}
                        <div
                          className={`absolute -left-[23px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-card)] transition-colors ${
                            idx === history.length - 1
                              ? 'bg-teal-500 ring-4 ring-teal-500/20'
                              : 'bg-[var(--border)] group-hover:bg-teal-400'
                          }`}
                        />

                        <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-teal-500/40 transition-all shadow-sm">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs text-[var(--text-primary)]">
                                {step.snapshot_label || 'Snapshot'}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {formatDate(step.snapshot_date)}
                              </span>
                            </div>
                            <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                              {formatACV(step.forecast_acv_amount ?? 0)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <ForecastBadge category={step.forecast_category ?? 'Blank'} />
                            <ApprovalBadge status={step.approval_status ?? 'Blank'} />
                            {step.service_expiry_period && (
                              <span className="text-[11px] text-[var(--text-muted)] px-2 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)]">
                                {step.service_expiry_period}
                              </span>
                            )}
                          </div>

                          {/* Delta notes */}
                          {(acvChanged || catChanged || appChanged) && (
                            <div className="mt-2.5 pt-2 border-t border-[var(--border)] text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
                              {acvChanged && (
                                <p>
                                  ACV changed:{' '}
                                  <span className="line-through text-[var(--text-muted)]">
                                    {formatACV(prevStep.forecast_acv_amount ?? 0)}
                                  </span>{' '}
                                  → {formatACV(step.forecast_acv_amount ?? 0)}
                                </p>
                              )}
                              {catChanged && (
                                <p>
                                  Category changed: {prevStep.forecast_category} →{' '}
                                  {step.forecast_category}
                                </p>
                              )}
                              {appChanged && (
                                <p>
                                  Approval changed: {prevStep.approval_status} →{' '}
                                  {step.approval_status}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Change Log Audit */}
          {activeTab === 'changelog' && (
            <div className="space-y-2">
              {changelogLoading ? (
                <Skeleton variant="card" height="140px" />
              ) : changelog.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                  No automated field changes recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {changelog.map((entry: any, i: number) => (
                    <div
                      key={entry.id || i}
                      className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-teal-600 dark:text-teal-400">
                          {entry.change_type || 'Field Change'}
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {entry.computed_at ? formatDate(entry.computed_at) : 'Snapshot diff'}
                        </span>
                      </div>
                      <p className="font-medium text-[var(--text-primary)]">
                        Column: <span className="font-mono text-xs">{entry.changed_column}</span>
                      </p>
                      <div className="flex items-center gap-2 text-[11px] p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                        <span className="text-red-500 line-through truncate max-w-[150px]">
                          {entry.old_value || '(empty)'}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                        <span className="text-emerald-500 font-semibold truncate max-w-[150px]">
                          {entry.new_value || '(empty)'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Opportunity Fields */}
          {activeTab === 'details' && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Owner
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.opportunity_owner || 'Unassigned'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Business Unit
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.business_unit_primary || opp.business_unit_raw || 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Sub-Region
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.sub_region || 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Country / Territory
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.country_territory || 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Close Date
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.close_date ? formatDate(opp.close_date) : 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Closing Year
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.closing_year || 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Renewal Category
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.renewal_category || 'N/A'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <span className="text-[var(--text-muted)] block text-[10px] uppercase font-semibold">
                  Months Delayed
                </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {opp.months_delayed != null ? `${opp.months_delayed} mo` : 'N/A'}
                </span>
              </div>
            </div>
          )}

          {/* TAB 4: Comments & Deal Notes */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              {/* Add Comment Card */}
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Add Deal Comment & Log
                  </h4>
                  <span className="text-[11px] text-[var(--text-muted)]">Logged with timestamp</span>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--text-muted)] shrink-0 flex items-center gap-1">
                      <User className="w-3 h-3" /> Commenter:
                    </span>
                    <input
                      type="text"
                      value={commentAuthor}
                      onChange={(e) => setCommentAuthor(e.target.value)}
                      placeholder="Your name or role (e.g. Sales Lead, Finance, Exec)"
                      className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </div>

                  <textarea
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault()
                        handleAddComment()
                      }
                    }}
                    placeholder="Enter deal notes, next actions, discount approval details, risk mitigation..."
                    className="w-full p-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-[var(--text-muted)]">
                      Tip: Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[9px] font-mono">Ctrl+Enter</kbd> to save
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddComment()}
                      disabled={!commentText.trim()}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      <Send className="w-3 h-3" />
                      Save Comment
                    </button>
                  </div>
                </div>
              </div>

              {/* Comment Thread */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="font-semibold text-[var(--text-secondary)]">
                    Comment Activity Log ({comments.length})
                  </span>
                </div>

                {comments.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-xl p-6 bg-[var(--bg-card)]">
                    <MessageSquare className="w-6 h-6 mx-auto mb-2 text-[var(--text-muted)] opacity-50" />
                    <p className="font-medium">No comments recorded yet for this deal.</p>
                    <p className="text-[11px] mt-1 text-[var(--text-muted)]">
                      Use the box above to add notes, status updates, or approval rationale.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {comments.map((c) => (
                      <div
                        key={c.id}
                        className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-xs flex flex-col gap-2 hover:border-teal-500/30 transition-all shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-300 font-bold flex items-center justify-center text-[10px]">
                              {c.author.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <span className="font-bold text-[var(--text-primary)] text-xs">
                                {c.author}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)] ml-2">
                                {formatDate(c.createdAt)} {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(c.id)}
                            className="p-1 text-[var(--text-muted)] hover:text-rose-500 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Delete comment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed pl-8">
                          {c.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
