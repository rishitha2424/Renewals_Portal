import React, { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  MessageSquare,
  MessageCircle,
  AlertTriangle,
  Check,
  CheckCheck,
  ExternalLink,
  Clock,
  Inbox,
  X,
} from 'lucide-react'
import { getNotifications, markNotificationRead, markAllNotificationsRead, NotificationItem } from '@/api/client'
import { formatDateTime } from '@/utils/format'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { POLL_CONFIG, usePageVisible, getPollingInterval } from '@/config/polling'

interface NotificationPanelProps {
  onSelectDealId?: (dealId: string) => void
}

export default function NotificationPanel({ onSelectDealId }: NotificationPanelProps) {
  const { currentUser } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'message' | 'comment' | 'alert'>('all')
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isPageVisible = usePageVisible()

  // Adaptive polling: pauses when tab hidden, backs off on error, aborts on unmount
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', activeTab],
    queryFn: ({ signal }) => getNotifications(activeTab, 50, signal),
    refetchInterval: (query) =>
      getPollingInterval(POLL_CONFIG.NOTIFICATIONS_MS, isPageVisible, query.state.fetchFailureCount),
    refetchIntervalInBackground: false,
    staleTime: 25_000,
  })

  const notifications = data?.notifications || []
  const unreadCount = data?.unread_count || 0

  // Close when clicked outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const readMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-page'] })
    },
  })

  const handleNotificationClick = async (notif: NotificationItem) => {
    if (!notif.is_read) {
      readMutation.mutate(notif.id)
    }
    setOpen(false)

    if (notif.target_type === 'deal_message' || notif.category === 'message' || notif.category === 'reply') {
      if (notif.deal_id) {
        navigate(`/messages?deal_id=${notif.deal_id}`)
      } else {
        navigate('/messages')
      }
    } else if (notif.deal_id) {
      useAppStore.getState().setSelectedOppId(notif.deal_id)
      if (onSelectDealId) onSelectDealId(notif.deal_id)
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
    <div className="relative" ref={panelRef}>
      {/* Topbar Bell Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all cursor-pointer"
        title="Notifications"
        aria-label="Open notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-xl z-50 overflow-hidden flex flex-col max-h-[500px] animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between p-3.5 border-b border-[var(--border)] bg-[var(--bg-card)]">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Notifications</h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/15 text-teal-700 dark:text-teal-300">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => readAllMutation.mutate()}
                  className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto text-[11px]">
            {(['all', 'unread', 'message', 'comment', 'alert'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 rounded-lg font-semibold capitalize whitespace-nowrap transition-all ${
                  activeTab === tab
                    ? 'bg-[#12284C] text-white shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab === 'all' ? 'All' : tab}
              </button>
            ))}
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center space-y-2">
                <Inbox className="w-8 h-8 opacity-40" />
                <p className="font-semibold text-[var(--text-primary)]">No notifications</p>
                <p>You are all caught up.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`p-3 text-xs cursor-pointer transition-colors flex items-start gap-3 hover:bg-[var(--bg-secondary)] ${
                    !n.is_read ? 'bg-teal-500/5' : ''
                  }`}
                >
                  <div className="p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] shrink-0 mt-0.5">
                    {getCategoryIcon(n.category)}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`font-semibold text-[var(--text-primary)] line-clamp-1 ${!n.is_read ? 'font-bold' : ''}`}>
                        {n.title}
                      </span>
                      {!n.is_read && (
                        <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                      {n.message}
                    </p>
                    {n.deal_name && (
                      <div className="text-[10px] text-teal-600 dark:text-teal-400 font-medium truncate">
                        Deal: {n.deal_name}
                      </div>
                    )}
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDateTime(n.created_at, currentUser?.timezone)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer View All */}
          <div className="p-2.5 border-t border-[var(--border)] bg-[var(--bg-card)] text-center">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1.5"
            >
              <span>View all notifications</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

