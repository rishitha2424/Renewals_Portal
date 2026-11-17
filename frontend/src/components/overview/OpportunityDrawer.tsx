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
  Edit2,
  Check,
  Plus,
  Sliders,
  RotateCcw,
  Save,
} from 'lucide-react'
import {
  getOpportunity,
  getOpportunityHistory,
  getOpportunityChangelog,
  getCustomColumns,
  createCustomColumn,
  getDealAnnotations,
  setDealAnnotation,
  deleteDealAnnotation,
  CustomColumnItem,
  DealAnnotationItem,
} from '@/api/client'
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
  // Comments & Cols is the first, default active tab so it opens immediately
  const [activeTab, setActiveTab] = useState<'comments' | 'timeline' | 'changelog' | 'details'>('comments')
  const [commentsColsSection, setCommentsColsSection] = useState<'all' | 'comments' | 'cols'>('all')
  const activeSnapshotId = useAppStore((s) => s.activeSnapshotId)
  const adminName = useAppStore((s) => s.adminName)

  // ── Comments State ────────────────────────────────────────────────────────
  const [comments, setComments] = useState<DealComment[]>([])
  const [commentAuthor, setCommentAuthor] = useState<string>(() => {
    return localStorage.getItem('deal_commenter_name') || 'Reviewer'
  })
  const [commentText, setCommentText] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

  // ── Custom Columns & Deal Annotations Queries ────────────────────────────
  const { data: customCols = [], refetch: refetchCols } = useQuery<CustomColumnItem[]>({
    queryKey: ['custom-columns'],
    queryFn: () => getCustomColumns(),
  })

  const { data: annotationsMap = {}, refetch: refetchAnnots } = useQuery<Record<string, DealAnnotationItem>>({
    queryKey: ['deal-annotations', oppId],
    queryFn: () => (oppId ? getDealAnnotations(oppId) : Promise.resolve({})),
    enabled: !!oppId,
  })

  // Draft values for Custom Columns (Cols)
  const [draftCols, setDraftCols] = useState<Record<string, string>>({})
  const [savingColKey, setSavingColKey] = useState<string | null>(null)

  // Inline form to add new column directly from drawer
  const [showAddCol, setShowAddCol] = useState(false)
  const [newColLabel, setNewColLabel] = useState('')
  const [newColType, setNewColType] = useState('text')
  const [isCreatingCol, setIsCreatingCol] = useState(false)

  // Load comments from localStorage on oppId change
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

  const handleStartEditComment = (c: DealComment) => {
    setEditingCommentId(c.id)
    setEditingCommentText(c.text)
  }

  const handleSaveEditComment = () => {
    if (!editingCommentId || !editingCommentText.trim() || !oppId) return
    const trimmed = editingCommentText.trim()
    const updated = comments.map((c) =>
      c.id === editingCommentId ? { ...c, text: trimmed } : c
    )
    setComments(updated)
    try {
      localStorage.setItem(`deal_comments_${oppId}`, JSON.stringify(updated))
      const globalRaw = localStorage.getItem('global_deal_comments_log')
      if (globalRaw) {
        const globalList = JSON.parse(globalRaw).map((c: any) =>
          c.id === editingCommentId ? { ...c, text: trimmed } : c
        )
        localStorage.setItem('global_deal_comments_log', JSON.stringify(globalList))
      }
    } catch {
      // ignore
    }
    setEditingCommentId(null)
    setEditingCommentText('')
    showToast.success('Comment updated')
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

  // Sync draft values for custom columns
  useEffect(() => {
    if (opp && customCols.length > 0) {
      const initial: Record<string, string> = {}
      customCols.forEach((col) => {
        const directAnnot = annotationsMap[col.key]?.value
        const oppVal = (opp as any)[col.key] ?? (opp as any)[col.label]
        initial[col.key] = directAnnot !== undefined ? String(directAnnot ?? '') : (oppVal !== undefined ? String(oppVal ?? '') : '')
      })
      setDraftCols(initial)
    }
  }, [opp, customCols, annotationsMap])

  const handleSaveCol = async (col: CustomColumnItem) => {
    if (!oppId || col.type.startsWith('auto:')) return
    const rawVal = draftCols[col.key] ?? ''
    const currentAnnot = annotationsMap[col.key]
    const trimmed = rawVal.trim()

    setSavingColKey(col.key)
    try {
      if (trimmed === '') {
        await deleteDealAnnotation(oppId, col.key)
        showToast.success(`Cleared ${col.label}`)
      } else {
        await setDealAnnotation(oppId, col.key, trimmed, currentAnnot?.version)
        showToast.success(`Saved ${col.label}`)
      }
      refetchAnnots()
    } catch {
      try {
        const localKey = `deal_col_${oppId}_${col.key}`
        if (trimmed === '') {
          localStorage.removeItem(localKey)
        } else {
          localStorage.setItem(localKey, trimmed)
        }
        showToast.success(`Saved ${col.label} locally`)
      } catch {
        showToast.error(`Failed to save ${col.label}`)
      }
    } finally {
      setSavingColKey(null)
    }
  }

  const handleClearCol = async (col: CustomColumnItem) => {
    if (!oppId || col.type.startsWith('auto:')) return
    setSavingColKey(col.key)
    try {
      await deleteDealAnnotation(oppId, col.key)
      setDraftCols((prev) => ({ ...prev, [col.key]: '' }))
      refetchAnnots()
      showToast.success(`Cleared ${col.label}`)
    } catch {
      localStorage.removeItem(`deal_col_${oppId}_${col.key}`)
      setDraftCols((prev) => ({ ...prev, [col.key]: '' }))
      showToast.success(`Cleared ${col.label}`)
    } finally {
      setSavingColKey(null)
    }
  }

  const handleCreateColumn = async (labelToCreate?: string, typeToCreate?: string) => {
    const label = (labelToCreate || newColLabel).trim()
    const colType = typeToCreate || newColType
    if (!label) return

    setIsCreatingCol(true)
    try {
      await createCustomColumn({ label, type: colType })
      await refetchCols()
      setNewColLabel('')
      setShowAddCol(false)
      showToast.success(`Added custom column "${label}"`)
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to create column')
    } finally {
      setIsCreatingCol(false)
    }
  }

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
          <div className="flex border-b border-[var(--border)] overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('comments')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 ${
                activeTab === 'comments'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Comments & Cols ({comments.length + customCols.length})
              {activeTab === 'comments' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('timeline')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 ${
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
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 ${
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
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 ${
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

          {/* TAB 1: Comments & Custom Cols */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              {/* Segmented Sub-Navbar */}
              <div className="flex items-center justify-between p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setCommentsColsSection('all')}
                    className={clsx(
                      'px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer',
                      commentsColsSection === 'all'
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    All Activity
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentsColsSection('comments')}
                    className={clsx(
                      'px-3 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 cursor-pointer',
                      commentsColsSection === 'comments'
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <MessageSquare className="w-3 h-3" />
                    Comments ({comments.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentsColsSection('cols')}
                    className={clsx(
                      'px-3 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 cursor-pointer',
                      commentsColsSection === 'cols'
                        ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Sliders className="w-3 h-3" />
                    Custom Cols ({customCols.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddCol(!showAddCol)}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 flex items-center gap-1 transition-all cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add Col
                </button>
              </div>

              {/* Inline "+ Add Col" Card */}
              {showAddCol && (
                <div className="p-3.5 rounded-xl border border-teal-500/30 bg-teal-500/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      Create New Custom Column (Col)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddCol(false)}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                        Column Name
                      </label>
                      <input
                        type="text"
                        value={newColLabel}
                        onChange={(e) => setNewColLabel(e.target.value)}
                        placeholder="e.g. Action Item, Notes, Follow-up"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                        Column Type
                      </label>
                      <select
                        value={newColType}
                        onChange={(e) => setNewColType(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                      >
                        <option value="text">Text (short)</option>
                        <option value="long text">Long text (notes)</option>
                        <option value="date">Date</option>
                        <option value="number">Number</option>
                        <option value="checkbox">Checkbox</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddCol(false)}
                      className="px-3 py-1 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateColumn()}
                      disabled={isCreatingCol || !newColLabel.trim()}
                      className="px-3.5 py-1 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50 cursor-pointer"
                    >
                      {isCreatingCol ? 'Creating...' : 'Create Column'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── CUSTOM COLUMNS (COLS) SECTION ── */}
              {(commentsColsSection === 'all' || commentsColsSection === 'cols') && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                      Custom Columns (Cols) & Deal Attributes ({customCols.length})
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">Type and save values directly</span>
                  </div>

                  {customCols.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-card)] text-center space-y-2.5">
                      <p className="text-xs text-[var(--text-muted)]">No custom columns added yet.</p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCreateColumn('Deal Notes', 'long text')}
                          className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-teal-500 text-[var(--text-primary)] font-medium cursor-pointer"
                        >
                          + Add "Deal Notes"
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateColumn('Action Item', 'text')}
                          className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-teal-500 text-[var(--text-primary)] font-medium cursor-pointer"
                        >
                          + Add "Action Item"
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateColumn('Follow-up Date', 'date')}
                          className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:border-teal-500 text-[var(--text-primary)] font-medium cursor-pointer"
                        >
                          + Add "Follow-up Date"
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {customCols.map((col) => {
                        const val = draftCols[col.key] ?? ''
                        const isSaving = savingColKey === col.key
                        const annot = annotationsMap[col.key]
                        return (
                          <div
                            key={col.key}
                            className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-teal-500/30 transition-all space-y-2 shadow-xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-[var(--text-primary)]">
                                  {col.label}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                                  {col.type}
                                </span>
                              </div>
                              {annot?.updated_at && (
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  Updated {formatDate(annot.updated_at)} by {annot.updated_by || 'user'}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {col.type === 'long text' ? (
                                <textarea
                                  rows={2}
                                  value={val}
                                  onChange={(e) => setDraftCols({ ...draftCols, [col.key]: e.target.value })}
                                  placeholder={`Enter ${col.label}...`}
                                  className="flex-1 p-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                                />
                              ) : col.type === 'dropdown' && col.dropdown_options?.length ? (
                                <select
                                  value={val}
                                  onChange={(e) => setDraftCols({ ...draftCols, [col.key]: e.target.value })}
                                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                                >
                                  <option value="">(Select {col.label})</option>
                                  {col.dropdown_options.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                                  value={val}
                                  onChange={(e) => setDraftCols({ ...draftCols, [col.key]: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleSaveCol(col)
                                    }
                                  }}
                                  placeholder={`Enter ${col.label}...`}
                                  className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                                />
                              )}

                              <button
                                type="button"
                                onClick={() => handleSaveCol(col)}
                                disabled={isSaving}
                                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                                title="Save field value"
                              >
                                <Save className="w-3 h-3" />
                                {isSaving ? '...' : 'Save'}
                              </button>

                              {val && (
                                <button
                                  type="button"
                                  onClick={() => handleClearCol(col)}
                                  disabled={isSaving}
                                  className="p-1.5 text-[var(--text-muted)] hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                                  title="Clear / delete value"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── DEAL COMMENTS SECTION ── */}
              {(commentsColsSection === 'all' || commentsColsSection === 'comments') && (
                <div className="space-y-3 pt-2">
                  {/* Add Comment Card */}
                  <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                        Add Deal Comment & Log
                      </h4>
                      <span className="text-[11px] text-[var(--text-muted)]">Logged with author & timestamp</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-[var(--text-muted)] shrink-0 flex items-center gap-1">
                          <User className="w-3 h-3" /> Commenter:
                        </span>
                        <input
                          type="text"
                          value={commentAuthor}
                          onChange={(e) => setCommentAuthor(e.target.value)}
                          placeholder="Your name or role"
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
                        placeholder="Type comments, deal notes, approval updates, or risk reasons..."
                        className="w-full p-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                      />

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[9px] font-mono">Ctrl+Enter</kbd> to save
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

                  {/* Comment Activity Thread */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs px-1">
                      <span className="font-semibold text-[var(--text-secondary)]">
                        Comment Activity Log ({comments.length})
                      </span>
                    </div>

                    {comments.length === 0 ? (
                      <div className="py-6 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-xl p-4 bg-[var(--bg-card)]">
                        <MessageSquare className="w-5 h-5 mx-auto mb-1 text-[var(--text-muted)] opacity-50" />
                        <p className="font-medium">No comments recorded yet for this deal.</p>
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
                              <div className="flex items-center gap-1">
                                {editingCommentId !== c.id && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditComment(c)}
                                    className="p-1 text-[var(--text-muted)] hover:text-teal-600 rounded hover:bg-teal-500/10 transition-colors cursor-pointer"
                                    title="Edit comment"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(c.id)}
                                  className="p-1 text-[var(--text-muted)] hover:text-rose-500 rounded hover:bg-rose-500/10 transition-colors cursor-pointer"
                                  title="Delete comment"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {editingCommentId === c.id ? (
                              <div className="space-y-2 pl-8 pt-1">
                                <textarea
                                  rows={2}
                                  value={editingCommentText}
                                  onChange={(e) => setEditingCommentText(e.target.value)}
                                  className="w-full p-2 text-xs rounded-lg border border-teal-500 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none resize-none"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingCommentId(null)}
                                    className="px-2.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] rounded-md cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleSaveEditComment}
                                    className="px-3 py-1 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-md flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check className="w-3 h-3" />
                                    Save Edit
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed pl-8">
                                {c.text}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
