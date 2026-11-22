import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Mail, 
  Send, 
  RotateCw, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Search, 
  X,
  Server
} from 'lucide-react'
import { getEmailOutbox, sendTestEmail, resendPendingEmails } from '@/api/client'
import { formatDate } from '@/utils/format'

export default function EmailOutbox() {
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [showTestModal, setShowTestModal] = useState(false)
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['email-outbox'],
    queryFn: () => getEmailOutbox(),
    refetchInterval: 15000,
  })

  const emails = data?.emails || []
  const smtpConfigured = data?.smtp_configured ?? false

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testEmailTo.trim()) return
    setTestLoading(true)
    try {
      const res = await sendTestEmail(testEmailTo.trim())
      setNotification({
        type: res.delivered ? 'success' : 'success',
        message: res.delivered
          ? `Test email delivered to ${testEmailTo} via SMTP.`
          : `Test email logged to DB outbox fallback (SMTP is not configured in environment).`,
      })
      setShowTestModal(false)
      setTestEmailTo('')
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to dispatch test email.',
      })
    } finally {
      setTestLoading(false)
    }
  }

  const handleResendAll = async () => {
    setResendLoading(true)
    try {
      const res = await resendPendingEmails()
      setNotification({
        type: 'success',
        message: `Attempted retry on ${res.retried_count || 0} queued emails. Sent: ${res.sent_count || 0}.`,
      })
      queryClient.invalidateQueries({ queryKey: ['email-outbox'] })
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: err.response?.data?.detail || 'Failed to resend pending emails.',
      })
    } finally {
      setResendLoading(false)
    }
  }

  const filteredEmails = emails.filter((em: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      em.recipient_email?.toLowerCase().includes(q) ||
      em.subject?.toLowerCase().includes(q) ||
      em.template?.toLowerCase().includes(q) ||
      em.status?.toLowerCase().includes(q)
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
            Audit outbound notifications, invite dispatches, and manage background delivery retries
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleResendAll}
            disabled={resendLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] disabled:opacity-50 transition-all shadow-sm"
          >
            <RotateCw className={`w-3.5 h-3.5 ${resendLoading ? 'animate-spin' : ''}`} />
            <span>Retry Pending ({emails.filter((e: any) => e.status !== 'sent').length})</span>
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
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Server Status Banner */}
      <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${smtpConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <div>
            <span className="text-xs font-bold text-[var(--text-primary)]">
              {smtpConfigured ? 'Live SMTP Transport Configured' : 'Local DB Outbox Fallback Mode'}
            </span>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {smtpConfigured
                ? 'Emails are transmitted directly via configured corporate SMTP credentials.'
                : 'SMTP credentials are not active. All invitations and notifications are stored in this database outbox and links can be copied manually from the admin panel.'}
            </p>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-between gap-3 shadow-sm">
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
            <p>No outbound emails have been logged yet.</p>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredEmails.map((em: any) => (
                  <tr key={em.id} className="hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                      {em.recipient_email}
                    </td>
                    <td className="px-4 py-3 max-w-sm truncate text-[var(--text-secondary)]" title={em.subject}>
                      {em.subject}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)]">
                        {em.template}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        em.status === 'sent'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : em.status === 'pending'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      }`}>
                        {em.status}
                      </span>
                      {em.error_message && (
                        <span className="text-[10px] text-rose-500 ml-2" title={em.error_message}>
                          (Error)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-muted)]">
                      {em.attempts || 0}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-secondary)]">
                      {em.created_at ? formatDate(em.created_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Send Test Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)]">Send Test Email</h3>
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
                  placeholder="e.g. test@mobileum.com"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sends an immediate diagnostic test message verifying transport connectivity.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={testLoading}
                  className="px-4 py-1.5 text-xs font-semibold bg-[#12284C] text-white rounded-xl hover:bg-[#1a386b] disabled:opacity-50"
                >
                  {testLoading ? 'Sending...' : 'Send Test'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

