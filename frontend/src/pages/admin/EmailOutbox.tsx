import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { 
  Mail, 
  Send, 
  RotateCw, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  X,
  Server,
  Trash2,
  Ban,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  FileText
} from 'lucide-react'
import { 
  getEmailOutbox, 
  getEmailLog,
  sendTestEmail, 
  resendPendingEmails,
  cancelOutboxEmail,
  deleteOutboxEmail,
  sendOutboxEmailNow,
  retryOutboxEmail,
  retryFailedEmails,
  EmailOutboxItem,
  EmailLogItem,
  MailDiagnostics
} from '@/api/client'
import { formatDateTime } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'
import { POLL_CONFIG, usePageVisible, getPollingInterval } from '@/config/polling'

export default function EmailOutbox() {
  const { currentUser } = useAuthStore()
  const queryClient = useQueryClient()
  const isPageVisible = usePageVisible()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showTestModal, setShowTestModal] = useState(false)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [retryLoading, setRetryLoading] = useState(false)
  const [confirmRetryItem, setConfirmRetryItem] = useState<EmailOutboxItem | null>(null)
  const [showBulkRetryModal, setShowBulkRetryModal] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({})
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['email-outbox'],
    queryFn: ({ signal }) => getEmailOutbox({}, signal),
    refetchInterval: (query) =>
      getPollingInterval(POLL_CONFIG.EMAIL_OUTBOX_MS, isPageVisible, query.state.fetchFailureCount),
    refetchIntervalInBackground: false,
  })

  const { data: emailLogData, refetch: refetchEmailLog } = useQuery({
    queryKey: ['admin-email-log'],
    queryFn: ({ signal }) => getEmailLog(150, signal),
    refetchInterval: (query) =>
      getPollingInterval(POLL_CONFIG.EMAIL_OUTBOX_MS, isPageVisible, query.state.fetchFailureCount),
    refetchIntervalInBackground: false,
  })

  const emails: EmailOutboxItem[] = data?.emails || data?.outbox || []
  const smtpConfigured = data?.smtp_configured ?? false
  const inactiveReason = data?.inactive_reason || data?.diagnostics?.inactive_reason || ''
  const diagnostics: MailDiagnostics | undefined = data?.diagnostics || data?.config

  const pendingCount = emails.filter((e) => ['pending', 'pending – email not configured'].includes(e.status)).length
  const failedEmails = emails.filter((e) => e.status === 'failed')
  const failedCount = failedEmails.length

  const handleConfirmRetrySingle = async () => {
    if (!confirmRetryItem) return
    setRetryLoading(true)
    try {
      const res = await retryOutboxEmail(confirmRetryItem.id)
      setNotification({
        type: res.delivered || res.status === 'success' ? 'success' : 'error',
        message: res.delivered || res.status === 'success'
          ? `Email successfully retried and delivered to ${confirmRetryItem.recipient_name || 'recipient'}.`
          : (res.detail || 'Failed to redeliver email on retry.'),
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
      queryClient.invalidateQueries({ queryKey: ['admin-email-log'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to retry email delivery.',
      })
    } finally {
      setRetryLoading(false)
      setConfirmRetryItem(null)
    }
  }

  const handleConfirmRetryBulk = async () => {
    setRetryLoading(true)
    try {
      const res = await retryFailedEmails()
      setNotification({
        type: res.failed_count === 0 ? 'success' : 'error',
        message: `Retried ${res.retried_count || 0} failed emails. Successfully sent: ${res.sent_count || 0}${res.failed_count ? `, Failed: ${res.failed_count}` : ''}.`,
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to bulk retry failed emails.',
      })
    } finally {
      setRetryLoading(false)
      setShowBulkRetryModal(false)
    }
  }

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testEmailTo.trim()) return
    setTestLoading(true)
    try {
      const res = await sendTestEmail(testEmailTo.trim())
      if (res.delivered || res.status === 'success') {
        setNotification({
          type: 'success',
          message: res.detail || `Test email delivered to ${testEmailTo} via SMTP.`,
        })
      } else {
        setNotification({
          type: 'error',
          message: res.detail || 'Failed to dispatch test email.',
        })
      }
      setShowTestModal(false)
      setTestEmailTo('')
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || err.message || 'Failed to dispatch test email.',
      })
    } finally {
      setTestLoading(false)
    }
  }

  const handleSendPending = async () => {
    setResendLoading(true)
    try {
      const res = await resendPendingEmails()
      setNotification({
        type: res.failed_count === 0 ? 'success' : 'error',
        message: `Attempted retry on ${res.retried_count || 0} queued emails. Sent: ${res.sent_count || 0}${res.failed_count ? `, Failed: ${res.failed_count}` : ''}.`,
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to send pending emails.',
      })
    } finally {
      setResendLoading(false)
    }
  }

  const handleCancelItem = async (itemId: string) => {
    setActionLoadingId(itemId)
    try {
      await cancelOutboxEmail(itemId)
      setNotification({
        type: 'success',
        message: 'Outbox email cancelled. It will not be sent during dispatch.',
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to cancel outbox item.',
      })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!window.confirm('Are you sure you want to delete this outbox email record?')) return
    setActionLoadingId(itemId)
    try {
      await deleteOutboxEmail(itemId)
      setNotification({
        type: 'success',
        message: 'Outbox email deleted permanently.',
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to delete outbox item.',
      })
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleSendNowItem = async (itemId: string) => {
    setActionLoadingId(itemId)
    try {
      const res = await sendOutboxEmailNow(itemId)
      if (res.delivered || res.status === 'success') {
        setNotification({
          type: 'success',
          message: 'Email delivered successfully.',
        })
      } else {
        setNotification({
          type: 'error',
          message: res.detail || 'Failed to deliver email.',
        })
      }
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to dispatch email.',
      })
    } finally {
      setActionLoadingId(null)
    }
  }

  const filteredEmails = emails.filter((em: EmailOutboxItem) => {
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending' && !['pending', 'pending – email not configured'].includes(em.status)) return false
      if (statusFilter === 'sent' && em.status !== 'sent') return false
      if (statusFilter === 'failed' && em.status !== 'failed') return false
      if (statusFilter === 'cancelled' && em.status !== 'cancelled') return false
    }
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (em.recipient_name || '').toLowerCase().includes(q) ||
      (em.subject || '').toLowerCase().includes(q) ||
      (em.template || em.template_type || '').toLowerCase().includes(q) ||
      (em.status || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2.5">
            <Mail className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            <span>Email Dispatch &amp; Outbox</span>
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Audit outbound notifications, invite dispatches, manage background delivery, and inspect SMTP transport
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh outbox and reload config"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50 transition-all shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link
            to="/messages"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all shadow-sm"
          >
            <Mail className="w-3.5 h-3.5 text-teal-600" />
            <span>Delivery Event Log</span>
          </Link>
          <button
            onClick={handleSendPending}
            disabled={resendLoading || pendingCount === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50 transition-all shadow-sm"
          >
            <RotateCw className={`w-3.5 h-3.5 ${resendLoading ? 'animate-spin' : ''}`} />
            <span>Send Pending ({pendingCount})</span>
          </button>
          <button
            onClick={() => setShowBulkRetryModal(true)}
            disabled={retryLoading || failedCount === 0}
            title="Retry sending failed emails (requires confirmation)"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 transition-all shadow-sm"
          >
            <RotateCw className={`w-3.5 h-3.5 ${retryLoading ? 'animate-spin' : ''}`} />
            <span>Retry Failed ({failedCount})</span>
          </button>
          <button
            onClick={() => setShowTestModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Test Email</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
          notification.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
        }`}>
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span className="font-medium">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Server Status Banner */}
      <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className={`w-3 h-3 rounded-full mt-1 sm:mt-0 shrink-0 ${smtpConfigured ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  {smtpConfigured ? 'Live SMTP Transport Active' : 'Local DB Outbox Fallback Mode'}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                  smtpConfigured 
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' 
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}>
                  {smtpConfigured ? 'Connected' : 'Fallback'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                {smtpConfigured ? (
                  <>
                    <span>Emails are transmitted directly via configured corporate SMTP credentials.</span>
                    <span className="ml-1 text-[var(--text-secondary)] font-medium">Status: {inactiveReason || 'Mail is active and configured.'}</span>
                  </>
                ) : (
                  <>
                    <span>SMTP credentials are not active in environment.</span>
                    <span className="ml-1 font-semibold text-amber-600 dark:text-amber-400">Reason: {inactiveReason || 'MAIL_ENABLED is false'}.</span>
                    <span className="ml-1">All invitations and messages are queued in this database outbox.</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border)] transition-all shrink-0 self-start sm:self-auto"
          >
            <Server className="w-3.5 h-3.5 text-teal-600" />
            <span>Diagnostics</span>
            {showDiagnostics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Diagnostics Drawer / Panel */}
        {showDiagnostics && diagnostics && (
          <div className="pt-3 border-t border-[var(--border)] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-[var(--text-muted)] gap-2 bg-[var(--bg-secondary)]/50 p-3 rounded-xl border border-[var(--border)]">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-4 h-4 text-teal-600 shrink-0" />
                <span className="font-mono text-[11px] truncate">
                  Config loaded from: <strong className="text-[var(--text-primary)]">{diagnostics.env_file_path}</strong>
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${diagnostics.env_file_exists ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
                  File {diagnostics.env_file_exists ? 'Exists' : 'Not Found'}
                </span>
                <span className="text-[11px]">
                  Reason: <strong className="text-[var(--text-primary)]">{diagnostics.inactive_reason}</strong>
                </span>
              </div>
            </div>

            {/* Variable Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {diagnostics.variables && Object.entries(diagnostics.variables).map(([name, info]) => (
                <div key={name} className="p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] font-bold text-[var(--text-primary)]">{name}</span>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${info.set ? 'bg-emerald-500/15 text-emerald-600' : 'bg-zinc-500/15 text-zinc-500'}`}>
                      {info.set ? 'SET' : 'UNSET'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono truncate text-[var(--text-muted)]" title={String(info.value)}>
                    {String(info.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Grouped Email Delivery Log (One row per comment / message event) */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]/50 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Email Delivery Log (By Event)</h2>
            <p className="text-[11px] text-[var(--text-muted)]">
              One row per comment or message event. Message text and recipient breakdown are shown only to the sender and selected recipients.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetchEmailLog()}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Refresh Log
          </button>
        </div>
        {!emailLogData?.log || emailLogData.log.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">
            No email delivery events recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
                <tr>
                  <th className="px-4 py-2.5">Date &amp; Time</th>
                  <th className="px-4 py-2.5">Author</th>
                  <th className="px-4 py-2.5">Subject &amp; Deal</th>
                  <th className="px-4 py-2.5">Recipients</th>
                  <th className="px-4 py-2.5">Sent / Failed / Skipped</th>
                  <th className="px-4 py-2.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {emailLogData.log.map((ev: EmailLogItem) => {
                  const dt = ev.created_at || ev.sent_at
                  const isExp = Boolean(expandedEventIds[ev.id])
                  return (
                    <React.Fragment key={ev.id}>
                      <tr className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                        <td className="px-4 py-2.5 tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                          {dt ? formatDateTime(dt, currentUser?.timezone) : '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-[var(--text-primary)]">
                          {ev.author_name || ev.sender_name}
                        </td>
                        <td className="px-4 py-2.5 max-w-[260px]">
                          <div className="font-semibold text-[var(--text-primary)] truncate" title={ev.subject || ''}>
                            {ev.subject || ev.template_type}
                          </div>
                          {ev.deal_name && (
                            <div className="text-[10px] text-[var(--text-muted)] truncate">{ev.deal_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                          {ev.recipient_summary || ev.recipient_name || '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                              {ev.sent_count ?? 0} sent
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300">
                              {ev.failed_count ?? 0} failed
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              {ev.skipped_count ?? 0} skipped
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {ev.details_redacted ? (
                            <span className="text-[10px] italic text-[var(--text-muted)]">Restricted</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setExpandedEventIds((p) => ({ ...p, [ev.id]: !p[ev.id] }))}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer"
                            >
                              <span>{isExp ? 'Hide' : 'View'}</span>
                              {isExp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExp && !ev.details_redacted && (
                        <tr className="bg-[var(--bg-secondary)]/30">
                          <td colSpan={6} className="p-3 space-y-2">
                            {ev.body_preview && (
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                                <span className="text-[10px] font-bold uppercase text-[var(--text-muted)] block mb-1">
                                  Body Preview
                                </span>
                                <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{ev.body_preview}</p>
                              </div>
                            )}
                            {ev.recipients && ev.recipients.length > 0 && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                {ev.recipients.map((rec) => (
                                  <div
                                    key={rec.id}
                                    className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-between gap-2 text-[11px]"
                                  >
                                    <div className="min-w-0">
                                      <span className="font-semibold text-[var(--text-primary)] truncate block">{rec.name}</span>
                                      {rec.reason && (
                                        <span className="text-[10px] text-rose-500 block truncate" title={rec.reason}>
                                          {rec.reason}
                                        </span>
                                      )}
                                    </div>
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[var(--bg-secondary)]">
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

      {/* Search & Filter */}
      <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-sm">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search outbox by recipient, subject, or status..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {['all', 'pending', 'sent', 'failed', 'cancelled'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 rounded-xl text-xs font-semibold capitalize transition-all ${
                statusFilter === st
                  ? 'bg-[#12284C] text-white shadow-xs'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Outbox Table */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="p-12 text-center text-xs text-[var(--text-muted)]">
            <Mail className="w-8 h-8 text-teal-600 mb-2 mx-auto opacity-50" />
            <p className="font-semibold text-[var(--text-primary)] mb-1">Outbox is empty</p>
            <p>No outbound emails match the current criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
                <tr>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Logged Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredEmails.map((em: EmailOutboxItem) => (
                  <tr key={em.id} className="hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                      <div>{em.recipient_name || 'Recipient'}</div>
                      {em.recipient_role && (
                        <div className="text-[10px] text-[var(--text-muted)] uppercase font-normal">{em.recipient_role}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-sm truncate text-[var(--text-secondary)]" title={em.subject}>
                      {em.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)]">
                        {em.template || em.template_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          em.status === 'sent'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : ['pending', 'pending – email not configured'].includes(em.status)
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : em.status === 'cancelled'
                            ? 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        }`}>
                          {em.status}
                        </span>
                      </div>
                      {em.error_message && (
                        <div className="text-[10px] text-rose-500 mt-0.5 max-w-xs truncate" title={em.error_message}>
                          {em.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">
                      {em.attempts ?? em.retry_count ?? 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-secondary)]">
                      {em.created_at ? formatDateTime(em.created_at, currentUser?.timezone) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {em.status === 'failed' && (
                          <button
                            onClick={() => setConfirmRetryItem(em)}
                            disabled={actionLoadingId === em.id || retryLoading}
                            title="Retry failed email (requires confirmation)"
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        )}
                        {['pending', 'pending – email not configured'].includes(em.status) && (
                          <>
                            <button
                              onClick={() => handleSendNowItem(em.id)}
                              disabled={actionLoadingId === em.id}
                              title="Send immediately via SMTP"
                              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-teal-600 dark:text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 disabled:opacity-50"
                            >
                              Send Now
                            </button>
                            <button
                              onClick={() => handleCancelItem(em.id)}
                              disabled={actionLoadingId === em.id}
                              title="Cancel email delivery"
                              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleDeleteItem(em.id)}
                          disabled={actionLoadingId === em.id}
                          title="Delete outbox record"
                          className="p-1 rounded-lg text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Test Modal */}
      {showTestModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                <Send className="w-4 h-4 text-teal-600" />
                <span>Send SMTP Test Email</span>
              </h3>
              <button onClick={() => setShowTestModal(false)}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
            </div>
            <form onSubmit={handleSendTest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Recipient Email
                </label>
                <input
                  type="email"
                  required
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  placeholder="e.g. admin@mobileum.com"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sends an immediate diagnostic test message to verify corporate SMTP connectivity and authentication credentials.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={testLoading}
                  className="px-4 py-1.5 text-xs font-semibold bg-[#12284C] text-white rounded-xl hover:bg-[#1a386b] disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  {testLoading ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Transmitting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Send Test</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Single Item Retry Confirmation Modal */}
      {confirmRetryItem && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-rose-500" />
                <span>Confirm Email Redelivery</span>
              </h3>
              <button onClick={() => setConfirmRetryItem(null)}>
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)]">
              Are you sure you want to resend this failed email? The system will attempt immediate transmission through corporate SMTP.
            </p>

            <div className="p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)] font-medium">Recipient Name:</span>
                <span className="font-semibold text-[var(--text-primary)]">{confirmRetryItem.recipient_name || 'Recipient'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)] font-medium">Subject:</span>
                <span className="font-medium text-[var(--text-secondary)] truncate max-w-[220px]" title={confirmRetryItem.subject}>
                  {confirmRetryItem.subject}
                </span>
              </div>
              {confirmRetryItem.error_message && (
                <div className="pt-2 border-t border-[var(--border)]">
                  <span className="text-[var(--text-muted)] block mb-1">Previous Failure Reason:</span>
                  <p className="font-mono text-[10px] text-rose-500 bg-rose-500/10 p-2 rounded-lg">
                    {confirmRetryItem.error_message}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRetryItem(null)}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRetrySingle}
                disabled={retryLoading}
                className="px-4 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl disabled:opacity-50 flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {retryLoading ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Redelivering...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Confirm Redelivery</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Bulk Retry Failed Confirmation Modal */}
      {showBulkRetryModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] shrink-0">
              <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
                <RotateCw className="w-4 h-4 text-rose-500" />
                <span>Retry All Failed Emails ({failedCount})</span>
              </h3>
              <button onClick={() => setShowBulkRetryModal(false)}>
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-secondary)] shrink-0">
              Please review the recipients below. Once confirmed, each failed message will be redelivered via SMTP.
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 border border-[var(--border)] rounded-xl p-3 bg-[var(--bg-secondary)]/50 divide-y divide-[var(--border)]">
              {failedEmails.map((fe) => (
                <div key={fe.id} className="pt-2 first:pt-0 flex items-center justify-between text-xs gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">
                      {fe.recipient_name || 'Recipient'}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">
                      {fe.subject}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-rose-500/10 text-rose-600 shrink-0">
                    Failed ({fe.attempts ?? fe.retry_count ?? 1}x)
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)] shrink-0">
              <button
                type="button"
                onClick={() => setShowBulkRetryModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRetryBulk}
                disabled={retryLoading}
                className="px-4 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl disabled:opacity-50 flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {retryLoading ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Retrying All...</span>
                  </>
                ) : (
                  <>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Confirm Redeliver All ({failedCount})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

