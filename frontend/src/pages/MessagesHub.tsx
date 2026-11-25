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
} from 'lucide-react'
import { getMessageThreads, getDealMessages, replyDealMessage, markMessageRead, sendDealMessage, searchGlobal, getEmailLog, EmailLogItem } from '@/api/client'
import { formatCurrency, formatDate } from '@/utils/format'
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
        if (!m.is_read && m.sender_id !== currentUser.id) {
          markMessageRead(m.id)
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['message-threads'] })
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
    },
    onError: (err: any) => {
      showToast.error(err?.response?.data?.detail || 'Failed to send reply')
    },
  })

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
                        <div>
                          <div className={`flex items-center gap-2 mb-1 text-[11px] ${isMe ? 'justify-end' : ''}`}>
                            <span className="font-semibold text-[var(--text-primary)]">
                              {m.sender_name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] uppercase">
                              {m.sender_role}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {m.created_at ? formatDate(m.created_at) : ''}
                            </span>
                          </div>
                          <div className={`p-3.5 rounded-2xl text-xs ${
                            isMe
                              ? 'bg-[#12284C] text-white rounded-tr-none'
                              : 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border)] rounded-tl-none shadow-sm'
                          }`}>
                            <p className="whitespace-pre-wrap">{m.body}</p>
                          </div>
                          {m.delivery_status && (
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
                      <th className="pb-2.5 px-3">Type</th>
                      <th className="pb-2.5 px-3">Deal / Opportunity</th>
                      <th className="pb-2.5 px-3">Sender</th>
                      <th className="pb-2.5 px-3">Recipient</th>
                      <th className="pb-2.5 px-3">Delivery Status</th>
                      <th className="pb-2.5 px-3 text-right">Attempts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {emailLogData.log.map((item) => {
                      const dt = item.sent_at || item.created_at
                      return (
                        <tr key={item.id} className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                          <td className="py-3 px-3 text-[var(--text-secondary)] whitespace-nowrap tabular-nums">
                            {dt ? `${formatDate(dt)} ${new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="capitalize px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                              {item.template_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-3 max-w-[200px]">
                            <div className="font-semibold text-[var(--text-primary)] truncate" title={item.deal_name || item.deal_id || 'Deal'}>
                              {item.deal_name || item.deal_id || '—'}
                            </div>
                            {item.deal_id && (
                              <button
                                type="button"
                                onClick={() => setSelectedDrawerOppId(item.deal_id || null)}
                                className="text-[10px] font-mono text-teal-600 dark:text-teal-400 hover:underline block truncate"
                              >
                                {item.deal_id}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="font-semibold text-[var(--text-primary)]">{item.sender_name}</span>
                            <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded font-bold uppercase bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                              {item.sender_role}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {/* Privacy: ONLY recipient name and role, ZERO email addresses */}
                            <span className="font-semibold text-[var(--text-primary)]">{item.recipient_name}</span>
                            <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded font-bold uppercase bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                              {item.recipient_role}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              item.status === 'sent'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : item.status === 'failed'
                                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}>
                              {item.status === 'sent' ? '✓ Delivered' : item.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[var(--text-muted)] font-medium">
                            {item.attempts}
                          </td>
                        </tr>
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
                  dealId={selectedDealForNewMsg.opportunity_id_18 || selectedDealForNewMsg.id}
                  selectedIds={newMsgRecipients}
                  onChange={setNewMsgRecipients}
                  contextType="message"
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
    </div>
  )
}
