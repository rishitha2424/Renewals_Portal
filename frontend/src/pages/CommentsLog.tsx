import React, { useState, useMemo } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  MessageSquare,
  Search,
  Calendar,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  User,
  Shield,
  Clock,
  RotateCcw,
  ExternalLink,
  Mail,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  Edit2,
  Trash2,
  History,
  X,
  Check,
  Layers,
} from 'lucide-react'
import {
  getCommentsLog,
  updateDealComment,
  deleteDealComment,
  getCommentHistoryById,
  CommentLogItem,
  CommentsLogResponse,
  CommentMessageHistoryItem,
} from '@/api/client'
import { formatDateTime } from '@/utils/format'
import { showToast } from '@/components/ui/Toast'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import Card from '@/components/ui/Card'
import clsx from 'clsx'

export default function CommentsLog() {
  const { globalFilters, activeSnapshotId, selectedOppId, setSelectedOppId } = useAppStore()
  const { currentUser } = useAuthStore()
  const queryClient = useQueryClient()

  const isAdmin = currentUser?.role === 'admin'
  const isMgmtOrAdmin = currentUser?.role === 'admin' || currentUser?.role === 'management'
  const isKam = currentUser?.role === 'kam'

  // Page state
  const [tab, setTab] = useState<'my' | 'all'>('my')
  const [page, setPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)
  const [search, setSearch] = useState<string>('')
  const [visibility, setVisibility] = useState<string>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [authorFilter, setAuthorFilter] = useState<string>('')
  const [authorRoleFilter, setAuthorRoleFilter] = useState<string>('all')
  const [limitToPeriod, setLimitToPeriod] = useState<boolean>(false)

  // Expandable row state
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [editingItem, setEditingItem] = useState<CommentLogItem | null>(null)
  const [editingText, setEditingText] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [unsendItem, setUnsendItem] = useState<CommentLogItem | null>(null)
  const [isUnsending, setIsUnsending] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<{ id: string; title: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<CommentMessageHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const handleSaveEdit = async () => {
    if (!editingItem || !editingText.trim() || isSavingEdit) return
    setIsSavingEdit(true)
    try {
      await updateDealComment(editingItem.deal_id, editingItem.id, editingText.trim())
      setEditingItem(null)
      setEditingText('')
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['deal-comments', editingItem.deal_id] })
      showToast.success('Comment updated')
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to update comment')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleConfirmUnsend = async () => {
    if (!unsendItem || isUnsending) return
    setIsUnsending(true)
    try {
      await deleteDealComment(unsendItem.deal_id, unsendItem.id)
      setUnsendItem(null)
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['deal-comments', unsendItem.deal_id] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
      showToast.info('Comment removed')
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to remove comment')
    } finally {
      setIsUnsending(false)
    }
  }

  const openHistoryModal = async (item: CommentLogItem) => {
    setHistoryTarget({ id: item.id, title: `${item.deal_name} · ${item.author}` })
    setHistoryLoading(true)
    try {
      const items = await getCommentHistoryById(item.id)
      setHistoryItems(items || [])
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Could not load version history')
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }

  // Fetch comments
  const { data, isLoading, isError, refetch } = useQuery<CommentsLogResponse>({
    queryKey: [
      'comments-log',
      tab,
      page,
      pageSize,
      search,
      visibility,
      startDate,
      endDate,
      authorFilter,
      authorRoleFilter,
      limitToPeriod,
      limitToPeriod ? globalFilters.period : null,
      limitToPeriod ? activeSnapshotId : null,
      currentUser?.id,
    ],
    queryFn: () =>
      getCommentsLog({
        page,
        page_size: pageSize,
        tab,
        search: search.trim() || undefined,
        visibility: visibility !== 'all' ? visibility : undefined,
        author: tab === 'all' && authorFilter.trim() ? authorFilter.trim() : undefined,
        author_role: tab === 'all' && authorRoleFilter !== 'all' ? authorRoleFilter : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        limit_to_period: limitToPeriod,
        period: globalFilters.period,
        as_of: activeSnapshotId,
      }),
    placeholderData: keepPreviousData,
  })

  const comments = data?.items || []
  const total = data?.total || 0
  const totalPages = data?.total_pages || 1

  const resetFilters = () => {
    setSearch('')
    setVisibility('all')
    setStartDate('')
    setEndDate('')
    setAuthorFilter('')
    setAuthorRoleFilter('all')
    setPage(1)
  }

  const hasActiveFilters =
    Boolean(search) ||
    visibility !== 'all' ||
    Boolean(startDate) ||
    Boolean(endDate) ||
    Boolean(authorFilter) ||
    authorRoleFilter !== 'all'

  return (
    <div className="space-y-6 pb-16 w-full">
      {/* 1. Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center border border-teal-500/20">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                Comments Log
              </h1>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Audit and review opportunity comments, visibility permissions, and email dispatch status.
              </p>
            </div>
          </div>
        </div>

        {/* Limit to period toggle */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer bg-[var(--bg-card)] border border-[var(--border)] px-3.5 py-2 rounded-xl text-xs text-[var(--text-secondary)] shadow-xs hover:border-[var(--border-hover)] transition-colors select-none">
            <input
              type="checkbox"
              checked={limitToPeriod}
              onChange={(e) => {
                setLimitToPeriod(e.target.checked)
                setPage(1)
              }}
              className="w-4 h-4 rounded text-[#00A3AD] focus:ring-[#00A3AD] border-[var(--border)] cursor-pointer"
              id="comment-log-period-toggle"
            />
            <div>
              <span className="font-semibold text-[var(--text-primary)]">Limit to selected period</span>
              <span className="text-[11px] text-[var(--text-muted)] block sm:inline sm:ml-1">
                ({globalFilters.period || 'Current quarter'})
              </span>
            </div>
          </label>
        </div>
      </div>

      {/* 2. Role Tab Selector (Admin & Management) */}
      {isMgmtOrAdmin && (
        <div className="flex items-center gap-2 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={() => {
              setTab('my')
              setPage(1)
            }}
            className={clsx(
              'pb-3 px-4 text-xs font-bold transition-colors relative cursor-pointer',
              tab === 'my'
                ? 'text-[#00A3AD] border-b-2 border-[#00A3AD]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-b-2 border-transparent'
            )}
            id="tab-comments-my"
          >
            My Comments
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('all')
              setPage(1)
            }}
            className={clsx(
              'pb-3 px-4 text-xs font-bold transition-colors relative cursor-pointer',
              tab === 'all'
                ? 'text-[#00A3AD] border-b-2 border-[#00A3AD]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border-b-2 border-transparent'
            )}
            id="tab-comments-all"
          >
            {isAdmin ? 'All Comments (Admin View)' : 'All Comments'}
          </button>
        </div>
      )}

      {/* 3. Filter Toolbar */}
      <Card padding="md" className="space-y-3 bg-[var(--bg-card)] shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Free Search */}
          <div className="flex-1 min-w-[220px] relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search comments, deal name, or account..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
              id="comment-search-input"
            />
          </div>

          {/* Visibility Filter */}
          {!isKam && (
            <div className="w-36">
              <select
                value={visibility}
                onChange={(e) => {
                  setVisibility(e.target.value)
                  setPage(1)
                }}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD] cursor-pointer"
                id="comment-visibility-select"
              >
                <option value="all">All Visibility</option>
                <option value="shared">👥 Shared</option>
                <option value="internal">🔒 Internal</option>
              </select>
            </div>
          )}

          {/* Author & Role Filters */}
          {isMgmtOrAdmin && tab === 'all' && (
            <>
              <div className="w-40">
                <input
                  type="text"
                  placeholder="Filter by author..."
                  value={authorFilter}
                  onChange={(e) => {
                    setAuthorFilter(e.target.value)
                    setPage(1)
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
                />
              </div>

              <div className="w-32">
                <select
                  value={authorRoleFilter}
                  onChange={(e) => {
                    setAuthorRoleFilter(e.target.value)
                    setPage(1)
                  }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD] cursor-pointer"
                >
                  <option value="all">All Roles</option>
                  <option value="admin">Admin</option>
                  <option value="management">Management</option>
                  <option value="kam">KAM</option>
                </select>
              </div>
            </>
          )}

          {/* Date Range: From / To */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)] font-medium">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setPage(1)
              }}
              className="px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-muted)] font-medium">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPage(1)
              }}
              className="px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
            />
          </div>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1 cursor-pointer font-medium"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </Card>

      {/* 4. Comments Table */}
      <Card padding="none" className="overflow-hidden bg-[var(--bg-card)] shadow-xs border border-[var(--border)]">
        {isLoading ? (
          <div className="p-16 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#00A3AD]" />
            <span>Loading comments log...</span>
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-xs text-rose-500">
            Failed to load comments log. Please try again.
          </div>
        ) : comments.length === 0 ? (
          <div className="p-16 text-center text-xs text-[var(--text-muted)] space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-400 mx-auto opacity-40 mb-2" />
            <p className="font-semibold text-sm text-[var(--text-primary)]">No comments found</p>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
              {hasActiveFilters
                ? 'No comments match your search criteria. Try clearing or widening your filters.'
                : 'No comments have been logged yet. Open any opportunity drawer to add notes and comments.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-2 text-xs font-semibold text-[#00A3AD] hover:underline cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]/70 text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4 min-w-[220px]">Opportunity & Account</th>
                  <th className="py-3 px-4 min-w-[300px]">Comment</th>
                  {isMgmtOrAdmin && tab === 'all' && <th className="py-3 px-3 min-w-[120px]">Author</th>}
                  <th className="py-3 px-3 min-w-[100px]">Visibility</th>
                  <th className="py-3 px-4 min-w-[180px]">Sent To</th>
                  <th className="py-3 px-4 min-w-[150px]">Date & Time</th>
                  <th className="py-3 px-3 min-w-[95px] text-center">Email</th>
                  <th className="py-3 px-3 min-w-[90px] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {comments.map((item: CommentLogItem) => {
                  const isExpanded = Boolean(expandedRows[item.id])
                  const isLongText = item.text.length > 120 || item.text.includes('\n')
                  const isAuthor = Boolean(
                    currentUser &&
                    ((item.author_id && String(item.author_id) === String(currentUser.id)) ||
                      (item.author && item.author === currentUser.name))
                  )

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedOppId(item.deal_id)}
                      className="hover:bg-[var(--bg-hover)] cursor-pointer transition-colors group"
                      title="Click to open opportunity details & comment drawer"
                    >
                      {/* Deal & Account */}
                      <td className="py-3 px-4 align-top">
                        <div className="font-bold text-[var(--text-primary)] group-hover:text-[#00A3AD] transition-colors leading-snug line-clamp-2">
                          {item.deal_name}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5 font-medium truncate">
                          {item.account_name}
                        </div>
                        {item.batch_id && (
                          <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                            <Layers className="w-2.5 h-2.5" />
                            Batch
                          </span>
                        )}
                      </td>

                      {/* Comment text */}
                      <td className="py-3 px-4 align-top" onClick={(e) => editingItem?.id === item.id && e.stopPropagation()}>
                        {item.is_deleted ? (
                          <p className="italic text-[var(--text-muted)]">This message was removed</p>
                        ) : editingItem?.id === item.id ? (
                          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              rows={2}
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full p-2 text-xs rounded-lg border border-[#00A3AD] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none resize-none"
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => { setEditingItem(null); setEditingText('') }}
                                className="px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] rounded"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={isSavingEdit || !editingText.trim()}
                                onClick={handleSaveEdit}
                                className="px-2.5 py-1 text-[11px] font-bold bg-[#00A3AD] text-white rounded flex items-center gap-1 disabled:opacity-50"
                              >
                                <Check className="w-3 h-3" />
                                {isSavingEdit ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="text-[var(--text-secondary)] leading-relaxed">
                              {isExpanded || !isLongText ? (
                                <p className="whitespace-pre-wrap">{item.text}</p>
                              ) : (
                                <p className="line-clamp-2">{item.text}</p>
                              )}
                            </div>
                            {isLongText && (
                              <button
                                type="button"
                                onClick={(e) => toggleExpand(item.id, e)}
                                className="mt-1 text-[11px] font-semibold text-[#00A3AD] hover:underline cursor-pointer inline-flex items-center gap-0.5"
                              >
                                <span>{isExpanded ? 'Show less' : 'Expand comment'}</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </>
                        )}
                      </td>

                      {/* Author (All tab) */}
                      {isMgmtOrAdmin && tab === 'all' && (
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          <span className="font-semibold text-[var(--text-primary)] block">
                            {item.author}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)] uppercase font-mono">
                            {item.author_role}
                          </span>
                        </td>
                      )}

                      {/* Visibility Chip */}
                      <td className="py-3 px-3 align-top whitespace-nowrap">
                        {item.visibility === 'shared' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span>👥 Shared</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <span>🔒 Internal</span>
                          </span>
                        )}
                      </td>

                      {/* Sent To (Names only, Admins as 'Admin' for non-admins) */}
                      <td className="py-3 px-4 align-top">
                        <div className="flex flex-wrap gap-1">
                          {item.recipients.map((rName, idx) => (
                            <span
                              key={idx}
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] whitespace-nowrap"
                            >
                              {rName}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Date & Time */}
                      <td className="py-3 px-4 align-top whitespace-nowrap text-[11px] text-[var(--text-muted)]">
                        <div className="font-medium text-[var(--text-secondary)]">
                          {item.created_at ? formatDateTime(item.created_at, currentUser?.timezone) : item.created_at_formatted}
                        </div>
                        {!item.is_deleted && item.edited_at && (
                          <div className="text-[10px] italic text-[var(--text-muted)] mt-0.5">
                            edited {formatDateTime(item.edited_at, currentUser?.timezone)}
                          </div>
                        )}
                      </td>

                      {/* Email Status Chip */}
                      <td className="py-3 px-3 align-top text-center whitespace-nowrap">
                        {item.email_status === 'emailed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>emailed</span>
                          </span>
                        ) : item.email_status === 'failed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            <span>failed</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span>queued</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 align-top text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => openHistoryModal(item)}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-indigo-500 hover:bg-indigo-500/10 cursor-pointer"
                              title="View edit/delete history (Admin)"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!item.is_deleted && isAuthor && (
                            <button
                              type="button"
                              onClick={() => { setEditingItem(item); setEditingText(item.text) }}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-teal-500 hover:bg-teal-500/10 cursor-pointer"
                              title="Edit comment"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!item.is_deleted && (isAuthor || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => setUnsendItem(item)}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="Unsend / remove comment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 5. Pagination Bar */}
        {comments.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-secondary)]/40 text-xs">
            <div className="text-[var(--text-muted)]">
              Showing <span className="font-semibold text-[var(--text-primary)]">{(page - 1) * pageSize + 1}</span> to{' '}
              <span className="font-semibold text-[var(--text-primary)]">{Math.min(page * pageSize, total)}</span> of{' '}
              <span className="font-semibold text-[var(--text-primary)]">{total}</span> {total === 1 ? 'comment' : 'comments'}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1"
                id="comment-prev-page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-medium text-[var(--text-muted)]">
                Page {page} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center gap-1"
                id="comment-next-page"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Unsend Confirm Modal */}
      {unsendItem && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-sm font-bold text-[var(--text-primary)]">Unsend Comment?</h4>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Unsending removes it from the portal; emails already sent stay in inboxes.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isUnsending}
                onClick={() => setUnsendItem(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnsending}
                onClick={handleConfirmUnsend}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
              >
                {isUnsending ? 'Removing...' : 'Unsend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin History Modal */}
      {historyTarget && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-lg w-full p-5 space-y-3 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
              <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-500" />
                <span>Version History — {historyTarget.title}</span>
              </h4>
              <button
                type="button"
                onClick={() => setHistoryTarget(null)}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2.5">
              {historyLoading ? (
                <p className="text-xs text-[var(--text-muted)] py-6 text-center">Loading history...</p>
              ) : historyItems.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-6 text-center">No edits or deletions recorded.</p>
              ) : (
                historyItems.map((h) => (
                  <div key={h.id} className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)]">
                        {h.action}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {h.actor_name} · {formatDateTime(h.created_at, currentUser?.timezone)}
                      </span>
                    </div>
                    {h.previous_text != null && (
                      <div>
                        <span className="text-[10px] font-semibold text-[var(--text-muted)]">Previous:</span>
                        <p className="whitespace-pre-wrap text-[var(--text-secondary)] mt-0.5">{h.previous_text}</p>
                      </div>
                    )}
                    {h.new_text != null && h.action === 'edit' && (
                      <div>
                        <span className="text-[10px] font-semibold text-[var(--text-muted)]">New:</span>
                        <p className="whitespace-pre-wrap text-[var(--text-primary)] mt-0.5">{h.new_text}</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}