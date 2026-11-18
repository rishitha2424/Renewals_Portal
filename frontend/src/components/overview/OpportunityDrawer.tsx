import React, { useState, useEffect, useMemo } from 'react'
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
  Copy,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
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
  getDealComments,
  addDealComment,
  updateDealComment,
  deleteDealComment,
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
  // Default active tab is "details" (all rows of info + immediate comment box)
  const [activeTab, setActiveTab] = useState<'details' | 'lifecycle' | 'comments' | 'risk'>('details')
  const [showAllSnapshots, setShowAllSnapshots] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const activeSnapshotId = useAppStore((s) => s.activeSnapshotId)
  const adminName = useAppStore((s) => s.adminName)

  const { data: opp, isLoading: oppLoading } = useQuery({
    queryKey: ['opportunity', oppId, activeSnapshotId],
    queryFn: () => (oppId ? getOpportunity(oppId, activeSnapshotId ?? undefined) : null),
    enabled: !!oppId,
  })

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

  // ── Comments Server Query ───────────────────────────────────────────────
  const { data: serverComments = [], refetch: refetchComments } = useQuery({
    queryKey: ['deal-comments', oppId],
    queryFn: () => (oppId ? getDealComments(oppId) : Promise.resolve([])),
    enabled: !!oppId,
  })

  // Synchronize server comments into local state
  useEffect(() => {
    if (serverComments && serverComments.length > 0) {
      setComments(
        serverComments.map((c: any) => ({
          id: c.id,
          oppId: c.opportunity_id_18,
          oppName: opp?.opportunity_name || 'Opportunity',
          author: c.author,
          text: c.text,
          createdAt: c.created_at,
        }))
      )
    } else if (serverComments && serverComments.length === 0) {
      // Fallback check to localStorage if server has no comments yet
      try {
        const raw = localStorage.getItem(`deal_comments_${oppId}`)
        if (raw) {
          const localList: DealComment[] = JSON.parse(raw)
          setComments(localList)
          // Automatically migrate local comments to server in background
          if (oppId && localList.length > 0) {
            localList.forEach((lc) => {
              addDealComment(oppId, lc.text, lc.author).catch(() => {})
            })
            localStorage.removeItem(`deal_comments_${oppId}`)
          }
        } else {
          setComments([])
        }
      } catch {
        setComments([])
      }
    }
  }, [serverComments, oppId, opp?.opportunity_name])

  const handleCopyId = () => {
    if (!oppId) return
    navigator.clipboard.writeText(oppId)
    setCopiedId(true)
    showToast.success('Opportunity ID copied')
    setTimeout(() => setCopiedId(false), 2000)
  }

  const handleAddComment = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = commentText.trim()
    if (!trimmed || !oppId) return

    const author = commentAuthor.trim() || adminName || 'Reviewer'
    localStorage.setItem('deal_commenter_name', author)

    const tempComment: DealComment = {
      id: `comm_${Date.now()}`,
      oppId,
      oppName: opp?.opportunity_name || 'Opportunity',
      author,
      text: trimmed,
      createdAt: new Date().toISOString(),
    }

    // Optimistic update
    setComments((prev) => [tempComment, ...prev])
    setCommentText('')

    try {
      await addDealComment(oppId, trimmed, author)
      await refetchComments()
      showToast.success('Comment saved')
    } catch (err: any) {
      await refetchComments()
      const msg = err?.response?.data?.detail || 'Failed to save comment'
      showToast.error(msg)
    }
  }

  const handleStartEditComment = (c: DealComment) => {
    setEditingCommentId(c.id)
    setEditingCommentText(c.text)
  }

  const handleSaveEditComment = async () => {
    if (!editingCommentId || !editingCommentText.trim() || !oppId) return
    const trimmed = editingCommentText.trim()
    const targetId = editingCommentId

    // Optimistic update
    setComments((prev) =>
      prev.map((c) => (c.id === targetId ? { ...c, text: trimmed } : c))
    )
    setEditingCommentId(null)
    setEditingCommentText('')

    try {
      await updateDealComment(oppId, targetId, trimmed)
      await refetchComments()
      showToast.success('Comment updated')
    } catch (err: any) {
      await refetchComments()
      const msg = err?.response?.data?.detail || 'Failed to update comment'
      showToast.error(msg)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    if (!oppId) return

    // Optimistic update
    setComments((prev) => prev.filter((c) => c.id !== commentId))

    try {
      await deleteDealComment(oppId, commentId)
      await refetchComments()
      showToast.info('Comment removed')
    } catch (err: any) {
      await refetchComments()
      const msg = err?.response?.data?.detail || 'Failed to delete comment'
      showToast.error(msg)
    }
  }

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

  // ── 3 Key Milestone Dates Calculation ──────────────────────────────────────
  // 1. When it came (First seen date & starting status)
  // 2. When values changed (What changed from what to what & date)
  // 3. When it resolved / outcome (Approved date, Closed/Lost date, or active status)
  const lifecycleMilestones = useMemo(() => {
    if (!history || history.length === 0) {
      return {
        firstSeen: null,
        changeEvents: [],
        resolution: null,
      }
    }

    // 1. Date 1: Arrival / First Seen Date ("When it came")
    const firstStep = history[0]
    const firstSeen = {
      date: firstStep.snapshot_date,
      label: firstStep.snapshot_label || formatDate(firstStep.snapshot_date),
      acv: firstStep.forecast_acv_amount,
      category: firstStep.forecast_category,
      approval: firstStep.approval_status,
      stage: firstStep.stage || firstStep.stage_number || 'N/A',
    }

    // 2. Date 2: Value & Status Movements ("When values changed & What changed from what to what")
    const changeEvents: Array<{
      date: string
      label: string
      changes: Array<{ field: string; from: string; to: string; diff?: number }>
    }> = []

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]
      const curr = history[i]
      const diffs: Array<{ field: string; from: string; to: string; diff?: number }> = []

      // ACV change
      if (prev.forecast_acv_amount !== curr.forecast_acv_amount) {
        const pVal = prev.forecast_acv_amount ?? 0
        const cVal = curr.forecast_acv_amount ?? 0
        diffs.push({
          field: 'Forecast ACV',
          from: formatACV(pVal),
          to: formatACV(cVal),
          diff: cVal - pVal,
        })
      }

      // Forecast Category change
      if (prev.forecast_category !== curr.forecast_category) {
        diffs.push({
          field: 'Forecast Category',
          from: prev.forecast_category || '(blank)',
          to: curr.forecast_category || '(blank)',
        })
      }

      // Approval Status change
      if (prev.approval_status !== curr.approval_status) {
        diffs.push({
          field: 'Approval Status',
          from: prev.approval_status || '(blank)',
          to: curr.approval_status || '(blank)',
        })
      }

      // Close Date change
      if (prev.close_date !== curr.close_date && (prev.close_date || curr.close_date)) {
        diffs.push({
          field: 'Close Date',
          from: prev.close_date ? formatDate(prev.close_date) : '(none)',
          to: curr.close_date ? formatDate(curr.close_date) : '(none)',
        })
      }

      // Stage change
      const pStage = prev.stage || prev.stage_number
      const cStage = curr.stage || curr.stage_number
      if (pStage !== cStage && (pStage || cStage)) {
        diffs.push({
          field: 'Stage',
          from: pStage || '(blank)',
          to: cStage || '(blank)',
        })
      }

      if (diffs.length > 0) {
        changeEvents.push({
          date: curr.snapshot_date,
          label: curr.snapshot_label || formatDate(curr.snapshot_date),
          changes: diffs,
        })
      }
    }

    // 3. Date 3: Resolution & Exit / Current Status ("When was it gone, closed, lost, approved")
    const approvedStep = history.find(
      (s: any) =>
        s.approval_status &&
        (s.approval_status.toLowerCase().includes('approved') || s.approval_status === 'Approved')
    )

    const isClosedOrLost =
      opp?.is_deleted_or_lost ||
      (opp?.stage && (opp.stage.toLowerCase().includes('lost') || opp.stage.toLowerCase().includes('closed')))

    const latestStep = history[history.length - 1]

    let resolutionType: 'approved' | 'closed_lost' | 'active' = 'active'
    let resolutionTitle = 'Current Pipeline Standing'
    let resolutionDate = latestStep.snapshot_date
    let resolutionDetails = `Active as of ${formatDate(latestStep.snapshot_date)} (${latestStep.forecast_category || 'Commit'} · ${latestStep.approval_status || 'Approved'})`

    if (isClosedOrLost) {
      resolutionType = 'closed_lost'
      resolutionTitle = 'Closed / Lost Deal'
      resolutionDate = opp?.close_date || latestStep.snapshot_date
      resolutionDetails = `Marked ${opp?.stage || 'Closed/Lost'} on ${formatDate(resolutionDate)}`
    } else if (approvedStep) {
      resolutionType = 'approved'
      resolutionTitle = 'Approval Granted'
      resolutionDate = approvedStep.snapshot_date
      resolutionDetails = `Approved on ${formatDate(approvedStep.snapshot_date)} (${approvedStep.approval_status})`
    }

    const resolution = {
      type: resolutionType,
      title: resolutionTitle,
      date: resolutionDate,
      details: resolutionDetails,
      latestDate: latestStep.snapshot_date,
      latestStatus: `${latestStep.forecast_category || ''} · ${latestStep.approval_status || ''}`,
    }

    return { firstSeen, changeEvents, resolution }
  }, [history, opp])

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
        <div className="space-y-5">
          {/* ── Top Summary Header Card (Always Visible) ── */}
          <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] shadow-xs space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                  <Building className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  Account Name
                </div>
                <h3 className="text-lg font-bold text-[var(--text-primary)] leading-tight truncate">
                  {opp.account_name || 'N/A'}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium line-clamp-1" title={opp.opportunity_name}>
                  {opp.opportunity_name}
                </p>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Forecast ACV
                </p>
                <p className="font-black text-2xl text-teal-600 dark:text-teal-400 tabular-nums leading-tight">
                  {formatACV(opp.forecast_acv_amount ?? 0)}
                </p>
                {opp.opportunity_id_18 && (
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--text-muted)] hover:text-teal-600 dark:hover:text-teal-400 transition-colors mt-0.5 cursor-pointer"
                    title="Click to copy Opportunity ID"
                  >
                    <span>{opp.opportunity_id_18}</span>
                    {copiedId ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-70" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Badges Strip */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-[var(--border)] text-xs">
              <ForecastBadge category={opp.forecast_category ?? 'Blank'} />
              <ApprovalBadge status={opp.approval_status ?? 'Blank'} />
              {(opp.stage || opp.stage_number) && (
                <span className="px-2.5 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)]">
                  Stage: {opp.stage_number || opp.stage}
                </span>
              )}
              {opp.service_expiry_period && (
                <span className="px-2.5 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                  Expires: {opp.service_expiry_period}
                </span>
              )}
              {opp.probability_pct != null && (
                <span className="px-2.5 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                  Prob: {opp.probability_pct}%
                </span>
              )}
              {opp.months_delayed != null && opp.months_delayed > 0 && (
                <span className="px-2.5 py-0.5 rounded-md font-semibold bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                  Delayed: {opp.months_delayed} mo
                </span>
              )}

              {/* Clickable subtle Risk indicator pill jumping to the Risk tab */}
              {opp.risk_score !== undefined && (
                <button
                  type="button"
                  onClick={() => setActiveTab('risk')}
                  className={clsx(
                    'ml-auto px-2 py-0.5 rounded-md font-bold text-[11px] uppercase tracking-wide border flex items-center gap-1 transition-all cursor-pointer',
                    opp.risk_score >= 65
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                      : opp.risk_score >= 35
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  )}
                  title="Click to view detailed Risk Analysis tab"
                >
                  <AlertCircle className="w-3 h-3" />
                  {opp.risk_level?.toUpperCase()} RISK · {opp.risk_score} pts
                </button>
              )}
            </div>
          </div>

          {/* ── Navigation Tabs Bar ── */}
          <div className="flex border-b border-[var(--border)] gap-1 overflow-x-auto">
            {/* Tab 1: Deal Details & Notes (Default view showing all rows + comment box) */}
            <button
              type="button"
              onClick={() => setActiveTab('details')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'details'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Deal Details & Comments
              {activeTab === 'details' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>

            {/* Tab 2: Timeline & Changes (The 3 Milestone Dates + Change Log) */}
            <button
              type="button"
              onClick={() => setActiveTab('lifecycle')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'lifecycle'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              Timeline & Changes ({lifecycleMilestones.changeEvents.length + (changelog.length > 0 ? 1 : 0)})
              {activeTab === 'lifecycle' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>

            {/* Tab 3: Comments & Cols */}
            <button
              type="button"
              onClick={() => setActiveTab('comments')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 cursor-pointer ${
                activeTab === 'comments'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              All Comments & Activity ({comments.length + customCols.length})
              {activeTab === 'comments' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>

            {/* Tab 4: Risk Analysis (LAST OPTION) */}
            <button
              type="button"
              onClick={() => setActiveTab('risk')}
              className={`pb-2.5 px-3 font-semibold text-xs transition-colors relative flex items-center gap-1.5 shrink-0 cursor-pointer ml-auto ${
                activeTab === 'risk'
                  ? 'text-teal-600 dark:text-teal-400 font-bold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Risk Analysis ({opp.risk_score ?? 0} pts)
              {activeTab === 'risk' && (
                <motion.div
                  layoutId="tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-500 rounded-full"
                />
              )}
            </button>
          </div>

          {/* ══════════════════════════════════════════════════════════════════════════════
              TAB 1 (DEFAULT): DEAL DETAILS & COMMENTS
              Shows all rows / important info of the opportunity + immediate comment box
              ══════════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'details' && (
            <div className="space-y-5">
              {/* ── ALL ROWS / OPPORTUNITY ATTRIBUTES ── */}
              <div className="space-y-4">
                {/* Section 1: Financial & Pipeline Status */}
                <div>
                  <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Financial &amp; Pipeline Status
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Forecast ACV
                      </span>
                      <span className="font-bold text-[var(--text-primary)] tabular-nums text-sm">
                        {opp.forecast_acv_amount != null
                          ? `$${Number(opp.forecast_acv_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '$0.00'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Stage
                      </span>
                      <span className="font-semibold text-[var(--text-primary)] truncate block" title={opp.stage_number || opp.stage || 'N/A'}>
                        {opp.stage_number || opp.stage || 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Forecast Category
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.forecast_category || 'Blank'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Approval Status
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.approval_status || 'Blank'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Win Probability
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.probability_pct != null ? `${opp.probability_pct}%` : 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Months Delayed
                      </span>
                      <span className={clsx('font-semibold', opp.months_delayed && opp.months_delayed > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]')}>
                        {opp.months_delayed != null && opp.months_delayed > 0 ? `${opp.months_delayed} mo` : '0 mo (On schedule)'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Fiscal Period
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.fiscal_period || 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Sales Type
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.sales_type || opp.type || 'Renewals'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2: Key Milestone Dates */}
                <div>
                  <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Key Dates
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Close Date
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.close_date ? formatDate(opp.close_date) : 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Service Expiry Period
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.service_expiry_period || 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Service Expiry Date
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.service_expiry_date ? formatDate(opp.service_expiry_date) : 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Closing Year
                      </span>
                      <span className="font-semibold text-[var(--text-primary)]">
                        {opp.closing_year || 'N/A'}
                      </span>
                    </div>

                    {opp.service_start_date && (
                      <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                          Service Start Date
                        </span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {formatDate(opp.service_start_date)}
                        </span>
                      </div>
                    )}

                    {opp.last_modified_date && (
                      <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                          Last Modified Date
                        </span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {formatDate(opp.last_modified_date)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 3: Account, Ownership & Geography */}
                <div>
                  <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Account, Ownership &amp; Geography
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Opportunity Owner
                      </span>
                      <span className="font-semibold text-[var(--text-primary)] truncate block" title={opp.opportunity_owner || opp.owner}>
                        {opp.opportunity_owner || opp.owner || 'Unassigned'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Business Unit
                      </span>
                      <span className="font-semibold text-[var(--text-primary)] truncate block" title={opp.business_unit_primary || opp.business_unit_raw}>
                        {opp.business_unit_primary || opp.business_unit_raw || 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Sub-Region
                      </span>
                      <span className="font-semibold text-[var(--text-primary)] truncate block" title={opp.revised_sub_region || opp.sub_region}>
                        {opp.revised_sub_region || opp.sub_region || 'N/A'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                      <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                        Country / Territory
                      </span>
                      <span className="font-semibold text-[var(--text-primary)] truncate block" title={opp.country_territory}>
                        {opp.country_territory || 'N/A'}
                      </span>
                    </div>

                    {opp.renewal_category && (
                      <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                          Renewal Category
                        </span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {opp.renewal_category}
                        </span>
                      </div>
                    )}

                    {opp.business_unit_raw && opp.business_unit_raw !== opp.business_unit_primary && (
                      <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] col-span-2">
                        <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] block">
                          All Business Units (Raw)
                        </span>
                        <span className="font-semibold text-[var(--text-primary)] text-[11px] truncate block" title={opp.business_unit_raw}>
                          {opp.business_unit_raw}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Section 4: Custom Columns (Cols) */}
                {customCols.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                        Custom Deal Columns ({customCols.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowAddCol(!showAddCol)}
                        className="text-[11px] font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> Add Column
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      {customCols.map((col) => {
                        const val = draftCols[col.key] ?? ''
                        const isSaving = savingColKey === col.key
                        return (
                          <div
                            key={col.key}
                            className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-[var(--text-primary)] text-xs">
                                {col.label}
                              </span>
                              <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border)]">
                                {col.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <input
                                type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                                value={val}
                                onChange={(e) => setDraftCols({ ...draftCols, [col.key]: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveCol(col)
                                }}
                                placeholder={`Enter ${col.label}...`}
                                className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveCol(col)}
                                disabled={isSaving}
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1 shadow-xs cursor-pointer"
                              >
                                <Save className="w-3 h-3" />
                                {isSaving ? '...' : 'Save'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── IMMEDIATE COMMENT INPUT & RECENT NOTES ── */}
              <div className="pt-2 border-t border-[var(--border)] space-y-3">
                <div className="p-3.5 rounded-xl border border-teal-500/20 bg-teal-500/5 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      Add Deal Comment &amp; Notes
                    </h4>
                    <span className="text-[10px] text-[var(--text-muted)]">Logged with author &amp; timestamp</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[var(--text-muted)] shrink-0 flex items-center gap-1">
                        <User className="w-3 h-3" /> Author:
                      </span>
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder="Your name or role"
                        className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>

                    <textarea
                      rows={2}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault()
                          handleAddComment()
                        }
                      }}
                      placeholder="Type comments, deal context, customer updates, or notes..."
                      className="w-full p-2.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
                    />

                    <div className="flex items-center justify-between pt-0.5">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        Press <kbd className="px-1 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[9px] font-mono">Ctrl+Enter</kbd> to save
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAddComment()}
                        disabled={!commentText.trim()}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        <Send className="w-3 h-3" />
                        Save Comment
                      </button>
                    </div>
                  </div>
                </div>

                {/* Recent Comments Log for this deal */}
                {comments.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                      Recent Deal Comments ({comments.length})
                    </h5>
                    <div className="space-y-2">
                      {comments.slice(0, 3).map((c) => (
                        <div
                          key={c.id}
                          className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-xs flex flex-col gap-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[var(--text-primary)]">{c.author}</span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {formatDate(c.createdAt)} {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(c.id)}
                                className="p-1 text-[var(--text-muted)] hover:text-rose-500 rounded hover:bg-rose-500/10 cursor-pointer"
                                title="Delete comment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{c.text}</p>
                        </div>
                      ))}
                      {comments.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('comments')}
                          className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline pt-1 block cursor-pointer"
                        >
                          View all {comments.length} comments →
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════════════
              TAB 2: LIFECYCLE & CHANGES (THE 3 MILESTONE DATES + AUDIT LOG)
              Replaces the 14 duplicate snapshots with:
              1. Date when it came (First seen & initial status)
              2. Date when values changed (What changed from what to what)
              3. Date when it resolved (Approved date, Closed/Lost date, or active status)
              ══════════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'lifecycle' && (
            <div className="space-y-5">
              {historyLoading ? (
                <div className="space-y-3">
                  <Skeleton variant="card" height="90px" />
                  <Skeleton variant="card" height="90px" />
                  <Skeleton variant="card" height="90px" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-8 text-center">
                  No snapshot history recorded for this deal.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                        Deal Lifecycle Milestones
                      </h4>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        Key events across {history.length} snapshots: arrival, value changes, and resolution
                      </p>
                    </div>
                  </div>

                  {/* ── THE 3 KEY MILESTONE DATES ── */}
                  <div className="space-y-3 relative pl-6 before:absolute before:left-2 before:top-3 before:bottom-3 before:w-0.5 before:bg-[var(--border)]">
                    {/* MILESTONE 1: When it came */}
                    {lifecycleMilestones.firstSeen && (
                      <div className="relative group">
                        <div className="absolute -left-[23px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-card)] bg-emerald-500 ring-4 ring-emerald-500/20" />
                        <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 shadow-xs space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                1. Pipeline Arrival ("When it came")
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)]">
                                {formatDate(lifecycleMilestones.firstSeen.date)}
                              </span>
                            </div>
                            <span className="font-bold text-sm text-[var(--text-primary)] tabular-nums">
                              {formatACV(lifecycleMilestones.firstSeen.acv ?? 0)}
                            </span>
                          </div>

                          <p className="text-xs text-[var(--text-secondary)]">
                            First recorded in pipeline snapshot{' '}
                            <span className="font-semibold text-[var(--text-primary)]">
                              {lifecycleMilestones.firstSeen.label}
                            </span>
                            .
                          </p>

                          <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                            <span className="px-2 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                              Initial Cat: {lifecycleMilestones.firstSeen.category || 'Blank'}
                            </span>
                            <span className="px-2 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                              Initial Approval: {lifecycleMilestones.firstSeen.approval || 'Blank'}
                            </span>
                            <span className="px-2 py-0.5 rounded-md font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                              Stage: {lifecycleMilestones.firstSeen.stage}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* MILESTONE 2: When values changed */}
                    <div className="relative group">
                      <div className="absolute -left-[23px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-card)] bg-amber-500 ring-4 ring-amber-500/20" />
                      <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5 shadow-xs space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            2. Value &amp; Field Movements ("When values changed")
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            {lifecycleMilestones.changeEvents.length} Change Event{lifecycleMilestones.changeEvents.length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {lifecycleMilestones.changeEvents.length === 0 ? (
                          <p className="text-xs text-[var(--text-secondary)] italic">
                            No value, category, or approval changes detected across all {history.length} snapshots. Deal has remained steady.
                          </p>
                        ) : (
                          <div className="space-y-2 pt-1">
                            {lifecycleMilestones.changeEvents.map((evt, idx) => (
                              <div
                                key={idx}
                                className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                  <span className="font-bold text-[var(--text-primary)]">
                                    Changed on {formatDate(evt.date)}
                                  </span>
                                  <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                    {evt.label}
                                  </span>
                                </div>
                                {evt.changes.map((c, cIdx) => (
                                  <div key={cIdx} className="flex items-center gap-2 text-xs flex-wrap">
                                    <span className="font-semibold text-[var(--text-secondary)]">
                                      {c.field}:
                                    </span>
                                    <span className="line-through text-rose-500">
                                      {c.from}
                                    </span>
                                    <ArrowRight className="w-3 h-3 text-[var(--text-muted)]" />
                                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                      {c.to}
                                    </span>
                                    {c.diff !== undefined && c.diff !== 0 && (
                                      <span
                                        className={clsx(
                                          'text-[10px] font-bold px-1.5 py-0.2 rounded',
                                          c.diff > 0
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                        )}
                                      >
                                        {c.diff > 0 ? `+${formatACV(c.diff)}` : `-${formatACV(Math.abs(c.diff))}`}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* MILESTONE 3: Resolution & Current Status */}
                    {lifecycleMilestones.resolution && (
                      <div className="relative group">
                        <div
                          className={clsx(
                            'absolute -left-[23px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--bg-card)]',
                            lifecycleMilestones.resolution.type === 'approved'
                              ? 'bg-teal-500 ring-4 ring-teal-500/20'
                              : lifecycleMilestones.resolution.type === 'closed_lost'
                              ? 'bg-rose-500 ring-4 ring-rose-500/20'
                              : 'bg-blue-500 ring-4 ring-blue-500/20'
                          )}
                        />
                        <div
                          className={clsx(
                            'p-3.5 rounded-xl border shadow-xs space-y-2',
                            lifecycleMilestones.resolution.type === 'approved'
                              ? 'border-teal-500/20 bg-teal-500/5'
                              : lifecycleMilestones.resolution.type === 'closed_lost'
                              ? 'border-rose-500/20 bg-rose-500/5'
                              : 'border-blue-500/20 bg-blue-500/5'
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={clsx(
                                'font-bold text-xs flex items-center gap-1',
                                lifecycleMilestones.resolution.type === 'approved'
                                  ? 'text-teal-700 dark:text-teal-300'
                                  : lifecycleMilestones.resolution.type === 'closed_lost'
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-blue-700 dark:text-blue-300'
                              )}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              3. Outcome &amp; Status ("When approved / closed / lost")
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)]">
                              {formatDate(lifecycleMilestones.resolution.date)}
                            </span>
                          </div>

                          <p className="text-xs font-semibold text-[var(--text-primary)]">
                            {lifecycleMilestones.resolution.title}:{' '}
                            <span className="font-normal text-[var(--text-secondary)]">
                              {lifecycleMilestones.resolution.details}
                            </span>
                          </p>

                          <div className="flex items-center gap-2 pt-1 text-xs">
                            <span className="text-[11px] text-[var(--text-muted)]">
                              Latest snapshot: {formatDate(lifecycleMilestones.resolution.latestDate)}
                            </span>
                            <span className="px-2 py-0.5 rounded font-bold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-[11px]">
                              {lifecycleMilestones.resolution.latestStatus}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── AUTOMATED FIELD CHANGELOG AUDIT ── */}
                  {changelog.length > 0 && (
                    <div className="pt-3 border-t border-[var(--border)] space-y-2">
                      <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                        Detailed Field Audit Log ({changelog.length})
                      </h4>
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
                    </div>
                  )}

                  {/* ── ACCORDION: VIEW ALL RAW DAILY SNAPSHOTS (OPTIONAL) ── */}
                  <div className="pt-2 border-t border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setShowAllSnapshots(!showAllSnapshots)}
                      className="w-full py-2 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        {showAllSnapshots ? 'Hide raw daily snapshot records' : `View all raw daily snapshots (${history.length})`}
                      </span>
                      {showAllSnapshots ? (
                        <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                      )}
                    </button>

                    {showAllSnapshots && (
                      <div className="mt-2 space-y-2 pl-4 border-l-2 border-[var(--border)]">
                        {history.map((step: any, idx: number) => (
                          <div
                            key={step.snapshot_date || idx}
                            className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs flex items-center justify-between"
                          >
                            <div>
                              <span className="font-semibold text-[var(--text-primary)]">
                                {step.snapshot_label || formatDate(step.snapshot_date)}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)] ml-2">
                                {step.forecast_category || 'Blank'} · {step.approval_status || 'Blank'}
                              </span>
                            </div>
                            <span className="font-bold tabular-nums text-[var(--text-primary)]">
                              {formatACV(step.forecast_acv_amount ?? 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════════════
              TAB 3: ALL COMMENTS & ACTIVITY
              ══════════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              {/* Add Comment Card */}
              <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]/50 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                    Add Deal Comment &amp; Log
                  </h4>
                  <span className="text-[11px] text-[var(--text-muted)]">Logged with author &amp; timestamp</span>
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

          {/* ══════════════════════════════════════════════════════════════════════════════
              TAB 4: RISK ANALYSIS (THE LAST OPTION)
              Explains how the score is calculated and breaks down all contributing factors
              ══════════════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'risk' && (
            <div className="space-y-4">
              {opp.risk_score !== undefined ? (
                <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs space-y-4">
                  {/* Risk Score Summary Banner */}
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-3">
                      <div
                        className={clsx(
                          'w-12 h-12 rounded-xl flex items-center justify-center font-extrabold text-lg shadow-xs',
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
                        <h4 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
                          Deal Risk Score: {opp.risk_score}/100 Points
                        </h4>
                        <p className="text-xs text-[var(--text-muted)]">
                          Classification: <span className="font-bold text-[var(--text-primary)]">{opp.risk_level?.toUpperCase()} RISK</span>
                        </p>
                      </div>
                    </div>
                    <span
                      className={clsx(
                        'text-xs px-3 py-1.5 rounded-lg font-bold uppercase tracking-wide',
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

                  {/* Plain English explanation */}
                  <div className="p-3 rounded-lg bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] leading-relaxed space-y-1">
                    <p className="font-bold text-[var(--text-primary)]">
                      How is this Risk Score calculated?
                    </p>
                    <p>
                      The risk model evaluates 6 objective deal signals: win probability, schedule delay, approval status, proximity to close date, deal activity staleness, and forecast volatility. Points are accumulated when risk indicators are present (0 = lowest risk, 100 = critical risk).
                    </p>
                  </div>

                  {/* Factors list: "Why is this risky?" */}
                  {opp.risk_factors && opp.risk_factors.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-xs font-bold text-[var(--text-secondary)] flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                        Contributing Risk Signals ({opp.risk_factors.length} Factors)
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {opp.risk_factors.map((f: any, idx: number) => (
                          <div
                            key={idx}
                            className={clsx(
                              'p-3 rounded-xl border flex flex-col justify-between transition-colors shadow-xs',
                              f.points > 0
                                ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20 text-[var(--text-primary)]'
                                : 'bg-[var(--bg-secondary)]/50 border-[var(--border)] text-[var(--text-muted)]'
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-xs text-[var(--text-primary)]">{f.name}</span>
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
              ) : (
                <div className="py-12 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-xl p-4">
                  No risk calculation available for this opportunity.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}
