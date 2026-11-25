import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
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
} from 'lucide-react'
import { getCommentsLog, CommentLogItem, CommentsLogResponse } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import Card from '@/components/ui/Card'
import clsx from 'clsx'

export default function CommentsLog() {
  const { globalFilters, activeSnapshotId, selectedOppId, setSelectedOppId } = useAppStore()
  const { currentUser } = useAuthStore()

  const isAdmin = currentUser?.role === 'admin'
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

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }))
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
    placeholderData: (prev) => prev,
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

      {/* 2. Admin Tab Selector (if admin) */}
      {isAdmin && (
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
            All Comments (Admin View)
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

          {/* Admin Filters: Author & Role */}
          {isAdmin && tab === 'all' && (
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
                  {isAdmin && tab === 'all' && <th className="py-3 px-3 min-w-[120px]">Author</th>}
                  <th className="py-3 px-3 min-w-[100px]">Visibility</th>
                  <th className="py-3 px-4 min-w-[180px]">Sent To</th>
                  <th className="py-3 px-4 min-w-[150px]">Date & Time</th>
                  <th className="py-3 px-3 min-w-[95px] text-center">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {comments.map((item: CommentLogItem) => {
                  const isExpanded = Boolean(expandedRows[item.id])
                  const isLongText = item.text.length > 120 || item.text.includes('\n')

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
                      </td>

                      {/* Comment text */}
                      <td className="py-3 px-4 align-top">
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
                      </td>

                      {/* Author (Admin All tab) */}
                      {isAdmin && tab === 'all' && (
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
                        <div className="font-medium text-[var(--text-secondary)]">{item.created_at_formatted}</div>
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


    </div>
  )
}
