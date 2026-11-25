import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  MessageSquare,
  MessageCircle,
  AlertTriangle,
  Check,
  CheckCheck,
  Search,
  Clock,
  Inbox,
  Filter,
} from 'lucide-react'
import { getNotifications, markNotificationRead, markAllNotificationsRead, NotificationItem } from '@/api/client'
import { formatDate } from '@/utils/format'

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'message' | 'comment' | 'alert'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-page', activeTab],
    queryFn: () => getNotifications(activeTab, 100),
  })

  const notifications = data?.notifications || []
  const unreadCount = data?.unread_count || 0

  const readMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const filtered = notifications.filter((n) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      n.title.toLowerCase().includes(q) ||
      n.message.toLowerCase().includes(q) ||
      (n.deal_name && n.deal_name.toLowerCase().includes(q))
    )
  })

  const handleNotificationClick = (notif: NotificationItem) => {
    if (!notif.is_read) {
      readMutation.mutate(notif.id)
    }
    if (notif.target_type === 'deal_message' || notif.category === 'message' || notif.category === 'reply') {
      if (notif.deal_id) {
        navigate(`/messages?deal_id=${notif.deal_id}`)
      } else {
        navigate('/messages')
      }
    } else if (notif.deal_id) {
      navigate(`/opportunities?deal_id=${notif.deal_id}&tab=comments`)
    }
  }

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'message':
      case 'reply':
        return <MessageSquare className="w-4 h-4 text-teal-600 dark:text-teal-400" />
      case 'comment':
        return <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      case 'alert':
      case 'email_failure':
        return <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      default:
        return <Bell className="w-4 h-4 text-slate-500" />
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Notification Centre
            </h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-500 text-white">
                {unreadCount} unread
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Real-time notifications for messages, comments, and critical renewal alerts
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => readAllMutation.mutate()}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark all as read</span>
          </button>
        )}
      </div>

      {/* Controls Bar: Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xs">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          {(['all', 'unread', 'message', 'comment', 'alert'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-xl font-semibold capitalize whitespace-nowrap transition-all ${
                activeTab === tab
                  ? 'bg-[#12284C] text-white shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              {tab === 'all' ? 'All' : tab}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[200px] sm:w-64">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search notifications..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-teal-500"
          />
        </div>
      </div>

      {/* Notifications List */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm divide-y divide-[var(--border)] overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-[var(--text-muted)]">Loading notifications...</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center space-y-3">
            <Inbox className="w-10 h-10 opacity-40 text-[var(--text-muted)]" />
            <p className="font-semibold text-sm text-[var(--text-primary)]">No notifications found</p>
            <p>You have no notifications matching the current filter.</p>
          </div>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              onClick={() => handleNotificationClick(n)}
              className={`p-4 text-xs cursor-pointer transition-colors flex items-start gap-4 hover:bg-[var(--bg-secondary)] group ${
                !n.is_read ? 'bg-teal-500/5' : ''
              }`}
            >
              <div className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] shrink-0 mt-0.5">
                {getCategoryIcon(n.category)}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm text-[var(--text-primary)] group-hover:text-teal-600 transition-colors ${!n.is_read ? 'font-bold' : 'font-semibold'}`}>
                    {n.title}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(n.created_at)}</span>
                    </span>
                    {!n.is_read && (
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-500 shrink-0" />
                    )}
                  </div>
                </div>
                <p className="text-[var(--text-secondary)] leading-relaxed text-xs">
                  {n.message}
                </p>
                {n.deal_name && (
                  <div className="text-xs text-teal-600 dark:text-teal-400 font-medium">
                    Deal: <span className="underline">{n.deal_name}</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

