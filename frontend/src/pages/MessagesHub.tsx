import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  MessageSquare, 
  Send, 
  Search, 
  ExternalLink, 
  CheckCheck, 
  Clock, 
  User as UserIcon, 
  Shield, 
  Briefcase, 
  Plus, 
  Filter, 
  X, 
  Loader2, 
  AlertCircle, 
  Building2,
  Mail,
  RotateCw,
  Check,
  Edit2,
  Trash2,
  History,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  getMessageThreads,
  getDealMessages,
  replyDealMessage,
  markMessageRead,
  sendDealMessage,
  searchGlobal,
  getEmailLog,
  updateDealMessage,
  unsendDealMessage,
  getMessageHistory,
  EmailLogItem,
  CommentMessageHistoryItem,
} from '@/api/client'
import { formatCurrency, formatDate, formatDateTime } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import RecipientPicker from '@/components/common/RecipientPicker'
import { showToast } from '@/components/ui/Toast'

export default function MessagesHub() {
  const { currentUser } = useAuthStore()
  const queryClient = useQueryClient()

  const [activeOppId, setActiveOppId] = useState<string | null>(null)
  const [selectedDrawerOppId, setSelectedDrawerOppId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [hubTab, setHubTab] = useState<'threads' | 'email_log'>('threads')

  // New message modal state (Admin / Management)
  const [showNewMsgModal, setShowNewMsgModal] = useState(false)
  const [dealSearchQuery, setDealSearchQuery] = useState('')
  const [dealSearchResults, setDealSearchResults] = useState<any[]>([])
  const [isSearchingDeals, setIsSearchingDeals] = useState(false)
  const [selectedDealForNewMsg, setSelectedDealForNewMsg] = useState<any | null>(null)
  const [newMsgRecipients, setNewMsgRecipients] = useState<string[]>([])
  const [newMsgSubject, setNewMsgSubject] = useState('')
  const [newMsgBody, setNewMsgBody] = useState('')
  const [newMsgPriority, setNewMsgPriority] = useState('normal')
  const [isSendingNewMsg, setIsSendingNewMsg] = useState(false)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingMsgBody, setEditingMsgBody] = useState('')
  const [isSavingMsgEdit, setIsSavingMsgEdit] = useState(false)
  const [unsendMsgId, setUnsendMsgId] = useState<string | null>(null)
  const [isUnsendingMsg, setIsUnsendingMsg] = useState(false)
  const [historyMsgTarget, setHistoryMsgTarget] = useState<{ id: string; title: string } | null>(null)
  const [historyItems, setHistoryItems] = useState<CommentMessageHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({})

  const { data: emailLogData, isLoading: isEmailLogLoading, refetch: refetchEmailLog } = useQuery({
    queryKey: ['email-log'],
    queryFn: () => getEmailLog(150),
    enabled: hubTab === 'email_log',
  })

  const { data: threadsData, isLoading: isThreadsLoading } = useQuery({
    queryKey: ['message-threads'],
    queryFn: async () => {
      return await getMessageThreads()
    },
    refetchInterval: 10000,
  })

  const rawThreads = threadsData?.threads || []

  // Auto-select first thread if none selected
  useEffect(() => {
    if (!activeOppId && rawThreads.length > 0) {
      setActiveOppId(rawThreads[0].deal_id || rawThreads[0].opportunity_id_18)
    }
  }, [rawThreads, activeOppId])

  const { data: activeThreadData, isLoading: isActiveMessagesLoading } = useQuery({
    queryKey: ['deal-messages', activeOppId],
    queryFn: async () => {
      if (!activeOppId) return null
      return await getDealMessages(activeOppId)
    },
    enabled: Boolean(activeOppId),
    refetchInterval: 5000,
  })

  const messages = activeThreadData?.messages || []
  const oppSummary = activeThreadData?.opportunity

  // Mark unread messages as read when viewing thread
  useEffect(() => {
    if (messages.length > 0 && currentUser) {
      messages.forEach((m: any) => {
        if (!m.is_read && m.sender_id !== currentUser.id && !m.is_deleted) {
          markMessageRead(m.id)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['message-threads'] })
              queryClient.invalidateQueries({ queryKey: ['notifications'] })
              queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
            })
            .catch(() => {})
        }
      })
    }
  }, [messages, currentUser, queryClient])

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!activeOppId || !replyText.trim()) return
      // Use active message ID if exists, or reply directly
      const parentMsg = messages[0]?.id || activeOppId
      return await replyDealMessage(parentMsg, replyText.trim())
    },
    onSuccess: () => {
      setReplyText('')
      queryClient.invalidateQueries({ queryKey: ['deal-messages', activeOppId] })
      queryClient.invalidateQueries({ queryKey: ['message-threads'] })
      queryClient.invalidateQueries({ queryKey: ['email-log'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err: any) => {
      showToast.error(err?.response?.data?.detail || 'Failed to send reply')
    },
  })

  const handleSaveEditMessage = async () => {
    if (!editingMsgId || !editingMsgBody.trim() || isSavingMsgEdit) return
    setIsSavingMsgEdit(true)
    try {
      await updateDealMessage(editingMsgId, editingMsgBody.trim())
      setEditingMsgId(null)
      setEditingMsgBody('')
      queryClient.invalidateQueries({ queryKey: ['deal-messages', activeOppId] })
      queryClient.invalidateQueries({ queryKey: ['message-threads'] })
      showToast.success('Message updated')
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to update message')
    } finally {
      setIsSavingMsgEdit(false)
    }
  }

  const handleConfirmUnsendMessage = async () => {
    if (!unsendMsgId || isUnsendingMsg) return
    setIsUnsendingMsg(true)
    try {
      await unsendDealMessage(unsendMsgId)
      setUnsendMsgId(null)
      queryClient.invalidateQueries({ queryKey: ['deal-messages', activeOppId] })
      queryClient.invalidateQueries({ queryKey: ['message-threads'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
      showToast.info('Message removed')
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to remove message')
    } finally {
      setIsUnsendingMsg(false)
    }
  }

  const openMessageHistory = async (id: string, senderName: string) => {
    setHistoryMsgTarget({ id, title: `Message by ${senderName}` })
    setHistoryLoading(true)
    try {
      const items = await getMessageHistory(id)
      setHistoryItems(items || [])
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Could not load history')
      setHistoryItems([])
    } finally {
      setHistoryLoading(false)
    }
  }

  // Debounced deal search for Compose modal
  useEffect(() => {
    if (!dealSearchQuery.trim()) {
      setDealSearchResults([])
      setIsSearchingDeals(false)
      return
    }
    const timer = setTimeout(async () => {
      setIsSearchingDeals(true)
      try {
        const res = await searchGlobal({ q: dealSearchQuery.trim(), limit: 10 })
        setDealSearchResults(res?.deals || [])
      } catch {
        setDealSearchResults([])
      } finally {
        setIsSearchingDeals(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [dealSearchQuery])

  const handleCreateNewMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDealForNewMsg || !newMsgSubject.trim() || !newMsgBody.trim()) return

    setIsSendingNewMsg(true)
    try {
      await sendDealMessage({
        deal_id: selectedDealForNewMsg.opportunity_id_18 || selectedDealForNewMsg.id,
        subject: newMsgSubject.trim(),
        body: newMsgBody.trim(),
        priority: newMsgPriority,
        recipient_ids: newMsgRecipients.length > 0 ? newMsgRecipients : undefined,
      })
      showToast.success('Inquiry sent successfully')
      const targetDealId = selectedDealForNewMsg.opportunity_id_18 || selectedDealForNewMsg.id
      setShowNewMsgModal(false)
      setSelectedDealForNewMsg(null)
      setNewMsgRecipients([])
      setDealSearchQuery('')
      setNewMsgSubject('')
      setNewMsgBody('')
      queryClient.invalidateQueries({ queryKey: ['message-threads'] })
      queryClient.invalidateQueries({ queryKey: ['email-log'] })
      setActiveOppId(targetDealId)
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to send message')
    } finally {
      setIsSendingNewMsg(false)
    }
  }

  // Filter threads by search text, owner, sender, status, unread
  const filteredThreads = rawThreads.filter((t: any) => {
    if (statusFilter !== 'all' && t.thread_status !== statusFilter) {
      return false
    }
    if (unreadOnly && (t.unread_count || 0) === 0) {
      return false
    }
    if (!search.trim()) return true

    const q = search.toLowerCase()
    const pool = [
      t.opportunity_name,
      t.deal_name,
      t.account_name,
      t.opportunity_id_18,
      t.deal_id,
      t.opportunity_owner,
      t.sender_name,
      t.recipient_name,
      t.subject,
      t.latest_message,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return pool.includes(q)
  })

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto h-[calc(100vh-80px)] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[var(--border)] mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            <span>Deal Communications Hub</span>
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Inquiry threads &amp; status updates on renewal opportunities
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Hub Tab Switcher */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs">
            <button
              type="button"
              onClick={() => setHubTab('threads')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                hubTab === 'threads'
                  ? 'bg-[#12284C] text-white shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Threads</span>
            </button>
            <button
              type="button"
              onClick={() => setHubTab('email_log')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                hubTab === 'email_log'
                  ? 'bg-[#12284C] text-white shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{currentUser?.role === 'admin' ? 'Email Delivery Log' : 'My Email Log'}</span>
            </button>
          </div>

          {currentUser?.role !== 'kam' && hubTab === 'threads' && (
            <button
              type="button"
              onClick={() => {
                setShowNewMsgModal(true)
                setSelectedDealForNewMsg(null)
                setNewMsgRecipients([])
                setDealSearchQuery('')
                setNewMsgSubject('')
                setNewMsgBody('')
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
              id="btn-compose-deal-message"
            >
              <Plus className="w-4 h-4" />
              <span>New Message</span>
            </button>
          )}
        </div>
      </div>

      {hubTab === 'threads' ? (
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 min-h-0 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
        {/* Left column: Thread list with search & filters */}
        <div className="md:col-span-5 lg:col-span-4 border-r border-[var(--border)] flex flex-col min-h-0 bg-[var(--bg-card)]">
          <div className="p-3 border-b border-[var(--border)] space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search owner, deal, sender, text..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-all"
                id="search-message-threads"
              />
            </div>

            {/* Filter pills: status and unread */}
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-[#12284C] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('open')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  statusFilter === 'open'
                    ? 'bg-teal-600 text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('resolved')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  statusFilter === 'resolved'
                    ? 'bg-slate-600 text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Resolved
              </button>
              <button
                type="button"
                onClick={() => setUnreadOnly((prev) => !prev)}
                className={`ml-auto px-2 py-1 rounded-lg font-medium transition-colors ${
                  unreadOnly
                    ? 'bg-amber-600 text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Unread only
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {isThreadsLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-16 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                <p className="font-semibold text-[var(--text-primary)] mb-1">No message threads found</p>
                <p>Try clearing filters or search query.</p>
              </div>
            ) : (
              filteredThreads.map((t: any) => {
                const dealId = t.deal_id || t.opportunity_id_18
                const isSelected = dealId === activeOppId
                return (
                  <div
                    key={t.thread_id || dealId}
                    onClick={() => setActiveOppId(dealId)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--bg-secondary)] border-l-4 border-teal-500'
                        : 'hover:bg-[var(--bg-secondary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-xs text-[var(--text-primary)] truncate max-w-[200px]" title={t.deal_name || t.opportunity_name}>
                        {t.deal_name || t.opportunity_name}
                      </span>
                      {t.unread_count > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-teal-500 text-white shrink-0">
                          {t.unread_count} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1">
                      <span className="truncate max-w-[150px]">{t.account_name || '—'}</span>
                      <span className="tabular-nums shrink-0">{t.last_activity ? formatDate(t.last_activity) : ''}</span>
                    </div>
                    {t.opportunity_owner && (
                      <div className="text-[10px] text-teal-600 dark:text-teal-400 font-medium mb-1">
                        Owner: {t.opportunity_owner}
                      </div>
                    )}
                    {t.latest_message && (
                      <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 italic">
                        "{t.latest_message}"
                      </p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right column: Message transcript and reply */}
        <div className="md:col-span-7 lg:col-span-8 flex flex-col min-h-0 bg-[var(--bg-secondary)]/30">
          {activeOppId ? (
            <>
              {/* Header */}
              <div className="p-4 bg-[var(--bg-card)] border-b border-[var(--border)] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-sm text-[var(--text-primary)] truncate">
                      {oppSummary?.opportunity_name || activeOppId}
                    </h3>
                    {oppSummary?.forecast_acv_amount && (
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-500/10 text-[var(--text-primary)] tabular-nums">
                        {formatCurrency(oppSummary.forecast_acv_amount)}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5 flex-wrap">
                    <span>Account: {oppSummary?.account_name || '—'}</span>
                    <span>·</span>
                    <span>Owner: {oppSummary?.opportunity_owner || oppSummary?.owner || '—'}</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDrawerOppId(activeOppId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Inspect Deal</span>
                </button>
              </div>

              {/* Message transcript */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {isActiveMessagesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-[var(--bg-card)] rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-xs text-[var(--text-muted)] py-12">
                    <MessageSquare className="w-8 h-8 text-teal-600 mb-2 opacity-50" />
                    <p className="font-semibold text-[var(--text-primary)] mb-1">No messages on this deal yet</p>
                    <p className="max-w-xs">Ask a question or log an inquiry about this renewal deal below.</p>
                  </div>
                ) : (
                  messages.map((m: any) => {
                    const isMe = m.sender_id === currentUser?.id
                    const isAdminViewer = currentUser?.role === 'admin'
                    return (
                      <div
                        key={m.id}
                        className={`flex gap-3 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          m.sender_role === 'admin'
                            ? 'bg-rose-500/15 text-rose-600'
                            : m.sender_role === 'management'
                            ? 'bg-amber-500/15 text-amber-600'
                            : 'bg-teal-500/15 text-teal-600'
                        }`}>
                          {m.sender_name?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                          <div className={`flex items-center gap-2 mb-1 text-[11px] flex-wrap ${isMe ? 'justify-end' : ''}`}>
                            <span className="font-semibold text-[var(--text-primary)]">
                              {m.sender_name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] uppercase">
                              {m.sender_role}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {m.created_at ? formatDateTime(m.created_at, currentUser?.timezone) : ''}
                              {!m.is_deleted && m.edited_at && (
                                <span className="italic ml-1">· edited {formatDateTime(m.edited_at, currentUser?.timezone)}</span>
                              )}
                            </span>
                            {isAdminViewer && (
                              <button
                                type="button"
                                onClick={() => openMessageHistory(m.id, m.sender_name)}
                                className="p-0.5 text-[var(--text-muted)] hover:text-indigo-500 rounded cursor-pointer"
                                title="View edit/delete history (Admin)"
                              >
                                <History className="w-3 h-3" />
                              </button>
                            )}
                            {!m.is_deleted && isMe && editingMsgId !== m.id && (
                              <button
                                type="button"
                                onClick={() => { setEditingMsgId(m.id); setEditingMsgBody(m.body || '') }}
                                className="p-0.5 text-[var(--text-muted)] hover:text-teal-500 rounded cursor-pointer"
                                title="Edit message"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            )}
                            {!m.is_deleted && (isMe || isAdminViewer) && (
                              <button
                                type="button"
                                onClick={() => setUnsendMsgId(m.id)}
                                className="p-0.5 text-[var(--text-muted)] hover:text-rose-500 rounded cursor-pointer"
                                title="Unsend message"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {m.is_deleted ? (
                            <div className="p-3 rounded-2xl text-xs italic bg-[var(--bg-card)] text-[var(--text-muted)] border border-dashed border-[var(--border)]">
                              This message was removed
                            </div>
                          ) : editingMsgId === m.id ? (
                            <div className="p-3 rounded-2xl border border-teal-500 bg-[var(--bg-card)] space-y-2 min-w-[240px]">
                              <textarea
                                rows={2}
                                value={editingMsgBody}
                                onChange={(e) => setEditingMsgBody(e.target.value)}
                                className="w-full p-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none resize-none"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => { setEditingMsgId(null); setEditingMsgBody('') }}
                                  className="px-2.5 py-1 text-xs text-[var(--text-muted)] rounded hover:bg-[var(--bg-secondary)]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingMsgEdit || !editingMsgBody.trim()}
                                  onClick={handleSaveEditMessage}
                                  className="px-3 py-1 text-xs font-semibold bg-teal-600 text-white rounded hover:bg-teal-700 disabled:opacity-50"
                                >
                                  {isSavingMsgEdit ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className={`p-3.5 rounded-2xl text-xs ${
                              isMe
                                ? 'bg-[#12284C] text-white rounded-tr-none'
                                : 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border)] rounded-tl-none shadow-sm'
                            }`}>
                              <p className="whitespace-pre-wrap">{m.body}</p>
                            </div>
                          )}
                          {!m.is_deleted && m.delivery_status && (
                            <div className={`mt-1 flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 font-medium ${isMe ? 'justify-end' : ''}`}>
                              <Check className="w-3 h-3 shrink-0" />
                              <span>{m.delivery_status}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Reply form */}
              <div className="p-3 bg-[var(--bg-card)] border-t border-[var(--border)]">
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendMutation.mutate()
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type a response or question on this deal..."
                    className="flex-1 px-4 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim() || sendMutation.isPending}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] disabled:opacity-40 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-xs text-[var(--text-muted)]">
              <MessageSquare className="w-8 h-8 opacity-40 mb-2" />
              <p>Select a deal from the left to read or send messages.</p>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="flex-1 min-h-0 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] flex flex-col overflow-hidden shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Mail className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <span>{currentUser?.role === 'admin' ? 'System Email Delivery Log' : 'My Email Notifications Log'}</span>
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Audit record of dispatched notifications for deal messages and comments.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refetchEmailLog()}
                className="p-1.5 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors cursor-pointer text-xs flex items-center gap-1.5 font-medium"
                title="Refresh log"
              >
                <RotateCw className="w-3.5 h-3.5 text-teal-600" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isEmailLogLoading ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)] animate-pulse">
                Loading email delivery records...
              </div>
            ) : !emailLogData?.log || emailLogData.log.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-xl p-6">
                <Mail className="w-6 h-6 mx-auto mb-2 opacity-40 text-teal-600" />
                <p className="font-semibold text-[var(--text-primary)]">No email events recorded yet</p>
                <p className="mt-1">Dispatched message and comment emails will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)] font-semibold">
                      <th className="pb-2.5 px-3">Date &amp; Time</th>
                      <th className="pb-2.5 px-3">Author</th>
                      <th className="pb-2.5 px-3">Subject &amp; Deal</th>
                      <th className="pb-2.5 px-3">Recipients</th>
                      <th className="pb-2.5 px-3">Counts</th>
                      <th className="pb-2.5 px-3 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {emailLogData.log.map((item: EmailLogItem) => {
                      const dt = item.created_at || item.sent_at
                      const isExpanded = Boolean(expandedLogIds[item.id])
                      const sentCnt = item.sent_count ?? (item.status === 'sent' ? 1 : 0)
                      const failCnt = item.failed_count ?? (item.status === 'failed' ? 1 : 0)
                      const skipCnt = item.skipped_count ?? (item.status === 'skipped' ? 1 : 0)
                      return (
                        <React.Fragment key={item.id}>
                          <tr className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                            <td className="py-3 px-3 text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
                              {dt ? formatDateTime(dt, currentUser?.timezone) : '—'}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="font-semibold text-[var(--text-primary)]">{item.author_name || item.sender_name}</span>
                              <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded font-bold uppercase bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                                {item.author_role || item.sender_role}
                              </span>
                            </td>
                            <td className="py-3 px-3 max-w-[260px]">
                              <div className="font-semibold text-[var(--text-primary)] truncate" title={item.subject || item.deal_name || ''}>
                                {item.subject || `${(item.event_type || item.template_type).replace('_', ' ')}`}
                              </div>
                              {item.deal_name && (
                                <button
                                  type="button"
                                  onClick={() => item.deal_id && setSelectedDrawerOppId(item.deal_id)}
                                  className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline block truncate"
                                >
                                  {item.deal_name}
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-3 text-[var(--text-secondary)]">
                              <span className="font-medium">{item.recipient_summary || item.recipient_name || '—'}</span>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                  {sentCnt} sent
                                </span>
                                {failCnt > 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300">
                                    {failCnt} failed
                                  </span>
                                )}
                                {skipCnt > 0 && (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                    {skipCnt} skipped
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              {item.details_redacted ? (
                                <span className="text-[10px] text-[var(--text-muted)] italic">Restricted</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedLogIds((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                                >
                                  <span>{isExpanded ? 'Hide' : 'Details'}</span>
                                  {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                              )}
                            </td>
                          </tr>
                          {isExpanded && !item.details_redacted && (
                            <tr className="bg-[var(--bg-secondary)]/30">
                              <td colSpan={6} className="p-3 space-y-2">
                                {item.body_preview && (
                                  <div className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                                    <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] block mb-1">
                                      Message Preview
                                    </span>
                                    <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                                      {item.body_preview}
                                    </p>
                                  </div>
                                )}
                                {item.recipients && item.recipients.length > 0 && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                    {item.recipients.map((rec) => (
                                      <div
                                        key={rec.id}
                                        className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-between gap-2 text-[11px]"
                                      >
                                        <div className="min-w-0">
                                          <span className="font-semibold text-[var(--text-primary)] truncate block">
                                            {rec.name}
                                          </span>
                                          {rec.reason && (
                                            <span className="text-[10px] text-rose-500 block truncate" title={rec.reason}>
                                              {rec.reason}
                                            </span>
                                          )}
                                        </div>
                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                          rec.status === 'sent'
                                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                            : rec.status === 'failed'
                                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                        }`}>
                                          {rec.status}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compose New Message Modal (Admin / Management) */}
      {showNewMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl p-6">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-teal-600" />
                <span>Inquire on Deal</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowNewMsgModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNewMessage} className="space-y-4">
              {/* Deal Search Input */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Target Opportunity
                </label>
                {selectedDealForNewMsg ? (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-teal-500/10 border border-teal-500/30 text-xs">
                    <div>
                      <p className="font-bold text-[var(--text-primary)]">
                        {selectedDealForNewMsg.opportunity_name}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {selectedDealForNewMsg.account_name} · Owner: {selectedDealForNewMsg.opportunity_owner} · {formatCurrency(selectedDealForNewMsg.forecast_acv_amount)} · Close: {selectedDealForNewMsg.close_date ? formatDate(selectedDealForNewMsg.close_date) : '—'} · {selectedDealForNewMsg.period_label || selectedDealForNewMsg.fiscal_period || '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDealForNewMsg(null)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <input
                      type="text"
                      placeholder="Search by opportunity name, ID, account or owner..."
                      value={dealSearchQuery}
                      onChange={(e) => setDealSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] outline-none focus:border-teal-500"
                    />
                    {isSearchingDeals && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-teal-500 animate-spin" />
                    )}

                    {dealSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl z-20 divide-y divide-[var(--border)]">
                        {dealSearchResults.map((d) => (
                          <div
                            key={d.opportunity_id_18}
                            onClick={() => {
                              setSelectedDealForNewMsg(d)
                              setDealSearchQuery('')
                              setDealSearchResults([])
                            }}
                            className="p-2.5 hover:bg-[var(--bg-secondary)] cursor-pointer text-xs"
                          >
                            <p className="font-semibold text-[var(--text-primary)] truncate">
                              {d.opportunity_name}
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)] truncate">
                              {d.account_name} · Owner: {d.opportunity_owner} · {formatCurrency(d.forecast_acv_amount)} · Close: {d.close_date ? formatDate(d.close_date) : '—'} · {d.period_label || d.fiscal_period || '—'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Recipient Picker */}
              {selectedDealForNewMsg && (
                <RecipientPicker
                  key={selectedDealForNewMsg.opportunity_id_18 || selectedDealForNewMsg.id}
                  dealId={selectedDealForNewMsg.opportunity_id_18 || selectedDealForNewMsg.id}
                  selectedIds={newMsgRecipients}
                  onChange={setNewMsgRecipients}
                  contextType="message"
                  disabled={isSendingNewMsg}
                />
              )}

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Renewal terms confirmation for Q4"
                  value={newMsgSubject}
                  onChange={(e) => setNewMsgSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] outline-none focus:border-teal-500"
                />
              </div>

              {/* Message Body */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Message Body
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Type your message or question to the opportunity owner..."
                  value={newMsgBody}
                  onChange={(e) => setNewMsgBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] outline-none focus:border-teal-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewMsgModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedDealForNewMsg || !newMsgSubject.trim() || !newMsgBody.trim() || isSendingNewMsg}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] disabled:opacity-40 flex items-center gap-1.5"
                >
                  {isSendingNewMsg && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Send Message</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Opportunity Drawer */}
      <OpportunityDrawer
        oppId={selectedDrawerOppId}
        onClose={() => setSelectedDrawerOppId(null)}
      />

      {/* Unsend Confirm Modal */}
      {unsendMsgId && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-sm w-full p-5 space-y-4">
            <h4 className="text-sm font-bold text-[var(--text-primary)]">Unsend Message?</h4>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Unsending removes it from the portal; emails already sent stay in inboxes.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isUnsendingMsg}
                onClick={() => setUnsendMsgId(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnsendingMsg}
                onClick={handleConfirmUnsendMessage}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
              >
                {isUnsendingMsg ? 'Removing...' : 'Unsend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Version History Modal */}
      {historyMsgTarget && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-lg w-full p-5 space-y-3 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
              <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-500" />
                <span>Version History — {historyMsgTarget.title}</span>
              </h4>
              <button
                type="button"
                onClick={() => setHistoryMsgTarget(null)}
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
