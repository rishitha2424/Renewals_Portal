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
  Briefcase
} from 'lucide-react'
import { getMessageThreads, getDealMessages, replyDealMessage, markMessageRead } from '@/api/client'
import { formatCurrency, formatDate } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'

export default function MessagesHub() {
  const { currentUser } = useAuthStore()
  const queryClient = useQueryClient()

  const [activeOppId, setActiveOppId] = useState<string | null>(null)
  const [selectedDrawerOppId, setSelectedDrawerOppId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [search, setSearch] = useState('')

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
      setActiveOppId(rawThreads[0].opportunity_id_18)
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
          markMessageRead(m.id).catch(() => {})
        }
      })
    }
  }, [messages, currentUser])

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!activeOppId || !replyText.trim()) return
      return await replyDealMessage(activeOppId, replyText.trim())
    },
    onSuccess: () => {
      setReplyText('')
      queryClient.invalidateQueries({ queryKey: ['deal-messages', activeOppId] })
      queryClient.invalidateQueries({ queryKey: ['message-threads'] })
    },
  })

  const filteredThreads = rawThreads.filter((t: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      t.opportunity_name?.toLowerCase().includes(q) ||
      t.account_name?.toLowerCase().includes(q) ||
      t.opportunity_id_18?.toLowerCase().includes(q) ||
      t.latest_message?.toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 max-w-7xl mx-auto h-[calc(100vh-100px)] flex flex-col">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border)] mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2.5">
            <MessageSquare className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            <span>Deal Communications Hub</span>
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Collaborative inquiry threads between Opportunity Owners (KAMs) and Management / Leadership
          </p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 min-h-0 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
        {/* Left column: Thread list */}
        <div className="md:col-span-5 lg:col-span-4 border-r border-[var(--border)] flex flex-col min-h-0 bg-[var(--bg-card)]">
          <div className="p-3.5 border-b border-[var(--border)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search deals or accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-all"
              />
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
                <p className="font-semibold text-[var(--text-primary)] mb-1">No message threads</p>
                <p>Inquiries sent from deal drawers will appear here.</p>
              </div>
            ) : (
              filteredThreads.map((t: any) => {
                const isSelected = t.opportunity_id_18 === activeOppId
                return (
                  <div
                    key={t.opportunity_id_18}
                    onClick={() => setActiveOppId(t.opportunity_id_18)}
                    className={`p-3.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[var(--bg-secondary)] border-l-4 border-teal-500'
                        : 'hover:bg-[var(--bg-secondary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-xs text-[var(--text-primary)] truncate max-w-[200px]" title={t.opportunity_name}>
                        {t.opportunity_name}
                      </span>
                      {t.unread_count > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-teal-500 text-white shrink-0">
                          {t.unread_count} new
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1.5">
                      <span className="truncate max-w-[160px]">{t.account_name}</span>
                      <span className="tabular-nums shrink-0">{t.last_activity ? formatDate(t.last_activity) : ''}</span>
                    </div>
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
                  <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
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
                    placeholder="Type an inquiry or status update on this deal..."
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

      {/* Opportunity Drawer */}
      <OpportunityDrawer
        oppId={selectedDrawerOppId}
        onClose={() => setSelectedDrawerOppId(null)}
      />
    </div>
  )
}

