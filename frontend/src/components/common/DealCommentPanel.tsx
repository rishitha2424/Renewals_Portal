import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  MessageSquare,
  X,
  Send,
  AlertTriangle,
  Loader2,
  Users,
  Building,
  CheckCircle2,
  DollarSign,
} from 'lucide-react'
import { addBatchComment } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import RecipientPicker from '@/components/common/RecipientPicker'
import showToast from '@/components/ui/Toast'
import { formatACV } from '@/utils/format'
import clsx from 'clsx'

export interface CommentTargetDeal {
  id: string
  name: string
  account?: string
  owner?: string
  acv?: number | null
}

interface DealCommentPanelProps {
  isOpen: boolean
  deals: CommentTargetDeal[]
  onRemoveDeal?: (dealId: string) => void
  onClose: () => void
  onSuccess: () => void
  maxBatchSize?: number
}

export default function DealCommentPanel({
  isOpen,
  deals,
  onRemoveDeal,
  onClose,
  onSuccess,
  maxBatchSize = 50,
}: DealCommentPanelProps) {
  const { currentUser } = useAuthStore()
  const isKam = currentUser?.role === 'kam'
  const isNonAdmin = currentUser?.role !== 'admin'

  const [text, setText] = useState('')
  const [visibility, setVisibility] = useState<'internal' | 'shared_with_owner'>(
    isKam ? 'shared_with_owner' : 'internal'
  )
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  // Reset form when opened or deal list changes
  useEffect(() => {
    if (isOpen) {
      setText('')
      setVisibility(isKam ? 'shared_with_owner' : 'internal')
      setRecipientIds([])
      setShowConfirmModal(false)
    }
  }, [isOpen, isKam])

  if (!isOpen || deals.length === 0) return null

  const isBatch = deals.length > 1
  const isOverMax = deals.length > maxBatchSize
  const needsConfirmation = deals.length > 10

  const handleSaveClick = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) {
      showToast.error('Please enter comment text.')
      return
    }
    if (isOverMax) {
      showToast.error(`Maximum batch size is ${maxBatchSize} deals. Please remove some deals.`)
      return
    }

    if (needsConfirmation && !showConfirmModal) {
      setShowConfirmModal(true)
      return
    }

    executeSubmit()
  }

  const executeSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed) return

    setIsSubmitting(true)
    setShowConfirmModal(false)

    try {
      const res = await addBatchComment({
        deal_ids: deals.map((d) => d.id),
        text: trimmed,
        visibility: isKam ? 'shared_with_owner' : visibility,
        recipient_ids: recipientIds.length > 0 ? recipientIds : undefined,
      })

      if (res.success) {
        showToast.success(
          deals.length === 1
            ? 'Comment saved successfully.'
            : `Comment saved across ${res.comments_created} deals.`
        )
        onSuccess()
        onClose()
      } else {
        showToast.error('Failed to save comment.')
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Failed to save comment.'
      showToast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[110] overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-card)] h-full shadow-2xl flex flex-col border-l border-[var(--border)] animate-in slide-in-from-right duration-200 overflow-hidden"
        id="deal-comment-panel"
      >
        {/* Panel Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                {isBatch ? 'Batch Comment' : 'Deal Comment'}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                Author: <strong className="text-[var(--text-primary)]">{currentUser?.name || (isNonAdmin ? 'You' : 'Admin')}</strong>
              </span>
            </div>

            <h3 className="text-base font-bold text-[var(--text-primary)] truncate">
              {isBatch ? `Commenting on ${deals.length} deals` : `Commenting on: ${deals[0]?.name}`}
            </h3>
            {!isBatch && deals[0]?.account && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                Account: <span className="font-semibold text-[var(--text-secondary)]">{deals[0].account}</span>
                {deals[0].acv != null && (
                  <span className="ml-2 font-mono text-teal-600 dark:text-teal-400">
                    {formatACV(deals[0].acv)}
                  </span>
                )}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            aria-label="Close comment panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Panel Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Over-max warning */}
          {isOverMax && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                You have selected <strong>{deals.length}</strong> deals, which exceeds the maximum limit of{' '}
                <strong>{maxBatchSize}</strong>. Please remove deals to proceed.
              </span>
            </div>
          )}

          {/* Target Deals Chips (When batch or multi-deal) */}
          {isBatch && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  Target Deals ({deals.length}):
                </span>
                <span className="text-[10px]">Click (×) to remove</span>
              </div>
              <div className="max-h-36 overflow-y-auto p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] flex flex-wrap gap-1.5">
                {deals.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] shadow-2xs max-w-[240px] truncate"
                    title={d.name}
                  >
                    <span className="truncate">{d.name}</span>
                    {onRemoveDeal && deals.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemoveDeal(d.id)
                        }}
                        className="hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer shrink-0"
                        title="Remove from batch"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Comment Text Box */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--text-primary)]">
              Comment Text:
            </label>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type your comment, context, customer updates, or action items..."
              className="w-full p-3 text-xs rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none transition-colors"
              autoFocus
            />
          </div>

          {/* Visibility Selector */}
          <div className="space-y-1.5 pt-1">
            <label className="block text-xs font-semibold text-[var(--text-primary)]">
              Visibility:
            </label>
            {!isKam ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label
                  className={clsx(
                    'flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all',
                    visibility === 'internal'
                      ? 'border-teal-500 bg-teal-500/10 text-[var(--text-primary)] font-semibold'
                      : 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  <input
                    type="radio"
                    name="batch_comment_vis"
                    value="internal"
                    checked={visibility === 'internal'}
                    onChange={() => setVisibility('internal')}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <span>🔒 Internal</span>
                </label>

                <label
                  className={clsx(
                    'flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-all',
                    visibility === 'shared_with_owner'
                      ? 'border-teal-500 bg-teal-500/10 text-[var(--text-primary)] font-semibold'
                      : 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  <input
                    type="radio"
                    name="batch_comment_vis"
                    value="shared_with_owner"
                    checked={visibility === 'shared_with_owner'}
                    onChange={() => setVisibility('shared_with_owner')}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <span>👥 Shared with owner</span>
                </label>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <span>👥 Visible to opportunity owner, management &amp; admin</span>
              </div>
            )}
          </div>

          {/* Recipient Picker */}
          <div className="space-y-1.5 pt-1">
            <label className="block text-xs font-semibold text-[var(--text-primary)]">
              Send Email &amp; In-App Notification To:
            </label>
            <RecipientPicker
              dealId={deals.length === 1 ? deals[0].id : undefined}
              selectedIds={recipientIds}
              onChange={setRecipientIds}
              contextType="comment"
              commentVisibility={visibility}
            />
          </div>
        </div>

        {/* Panel Footer */}
        <div className="p-4 sm:p-5 border-t border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSaveClick}
            disabled={isSubmitting || !text.trim() || isOverMax}
            className="px-5 py-2 rounded-xl bg-[#00A3AD] hover:bg-[#008f98] text-white text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>{isBatch ? `Save on ${deals.length} deals` : 'Save Comment'}</span>
              </>
            )}
          </button>
        </div>

        {/* Confirmation Modal when > 10 deals */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
            <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-sm w-full p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">
                    Confirm Batch Comment
                  </h4>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    You are commenting on <strong>{deals.length} deals</strong> at once.
                  </p>
                </div>
              </div>

              <p className="text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] p-3 rounded-xl border border-[var(--border)]">
                A separate comment record will be created on each of the {deals.length} selected deals. Grouped notifications will be sent to the selected recipients.
              </p>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeSubmit}
                  className="px-4 py-1.5 rounded-lg bg-[#00A3AD] text-white text-xs font-bold hover:bg-[#008f98] shadow-xs"
                >
                  Yes, Post Comments
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

