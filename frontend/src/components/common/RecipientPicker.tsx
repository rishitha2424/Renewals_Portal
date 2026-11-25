import React, { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users, Shield, UserCheck, Check, User as UserIcon } from 'lucide-react'
import { getMessageRecipients, RecipientUser, RecipientOptions } from '@/api/client'

interface RecipientPickerProps {
  dealId?: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
  contextType?: 'message' | 'reply' | 'comment'
  commentVisibility?: 'internal' | 'shared_with_owner'
  className?: string
}

export default function RecipientPicker({
  dealId,
  selectedIds,
  onChange,
  contextType = 'message',
  commentVisibility = 'internal',
  className = '',
}: RecipientPickerProps) {
  const { data, isLoading } = useQuery<RecipientOptions>({
    queryKey: ['message-recipients', dealId],
    queryFn: () => getMessageRecipients(dealId),
    staleTime: 60_000,
  })

  // Initialize defaults on initial load if none selected
  useEffect(() => {
    if (data && selectedIds.length === 0 && data.defaults?.length) {
      if (contextType === 'comment' && commentVisibility === 'internal') {
        // Exclude deal owner from internal comments
        const ownerId = data.deal_owner?.id
        const filtered = data.defaults.filter(id => id !== ownerId)
        onChange(filtered)
      } else {
        onChange(data.defaults)
      }
    }
  }, [data, selectedIds.length, contextType, commentVisibility])

  const dealOwner = data?.deal_owner
  const managementUsers = data?.management || []
  const adminUsers = data?.admins || []

  // Checkbox toggle handler
  const toggleUser = (userId: string) => {
    if (selectedIds.includes(userId)) {
      onChange(selectedIds.filter(id => id !== userId))
    } else {
      onChange([...selectedIds, userId])
    }
  }

  // Toggle group helper
  const toggleGroup = (users: RecipientUser[]) => {
    const userIds = users.map(u => u.id)
    const allSelected = userIds.every(id => selectedIds.includes(id))
    if (allSelected) {
      onChange(selectedIds.filter(id => !userIds.includes(id)))
    } else {
      const merged = Array.from(new Set([...selectedIds, ...userIds]))
      onChange(merged)
    }
  }

  // Compute selected names for "Visible to:" line
  const selectedNames = useMemo(() => {
    if (!data) return []
    const allUsers: RecipientUser[] = [
      ...(dealOwner ? [dealOwner] : []),
      ...managementUsers,
      ...adminUsers,
    ]
    return allUsers
      .filter(u => selectedIds.includes(u.id))
      .map(u => u.name)
  }, [data, selectedIds, dealOwner, managementUsers, adminUsers])

  const showDealOwner = contextType !== 'comment' || commentVisibility === 'shared_with_owner'

  if (isLoading) {
    return (
      <div className={`p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-muted)] animate-pulse ${className}`}>
        Loading recipients...
      </div>
    )
  }

  return (
    <div className={`space-y-3 p-3.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs ${className}`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span>Recipients</span>
        </span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {selectedIds.length} recipient{selectedIds.length === 1 ? '' : 's'} selected
        </span>
      </div>

      <div className="space-y-2.5">
        {/* Deal Owner Group */}
        {showDealOwner && dealOwner && (
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Deal Owner
            </div>
            <label
              key={dealOwner.id}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-card)] cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(dealOwner.id)}
                onChange={() => toggleUser(dealOwner.id)}
                className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500 border-[var(--border)]"
              />
              <span className="font-medium text-[var(--text-primary)]">{dealOwner.name}</span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                Owner
              </span>
            </label>
          </div>
        )}

        {/* Management Accounts */}
        {managementUsers.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Management
              </span>
              <button
                type="button"
                onClick={() => toggleGroup(managementUsers)}
                className="text-teal-600 dark:text-teal-400 hover:underline cursor-pointer font-medium"
              >
                {managementUsers.every(u => selectedIds.includes(u.id)) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {managementUsers.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-card)] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500 border-[var(--border)]"
                  />
                  <span className="font-medium text-[var(--text-primary)] truncate">{u.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Admin Accounts */}
        {adminUsers.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Administrators
              </span>
              <button
                type="button"
                onClick={() => toggleGroup(adminUsers)}
                className="text-teal-600 dark:text-teal-400 hover:underline cursor-pointer font-medium"
              >
                {adminUsers.every(u => selectedIds.includes(u.id)) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {adminUsers.map((u) => (
                <label
                  key={u.id}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-card)] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500 border-[var(--border)]"
                  />
                  <span className="font-medium text-[var(--text-primary)] truncate">{u.name}</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-500/15 text-blue-700 dark:text-blue-300">
                    Admin
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary Visibility Line */}
      <div className="pt-2 border-t border-[var(--border)] text-[11px] text-[var(--text-secondary)]">
        {selectedNames.length > 0 ? (
          <p>
            <strong className="text-[var(--text-primary)]">Visible to:</strong>{' '}
            {selectedNames.join(', ')}.{' '}
            <span className="text-[var(--text-muted)]">Admins can audit all messages.</span>
          </p>
        ) : (
          <p className="text-amber-600 dark:text-amber-400 font-medium">
            No recipients selected. Please select at least one recipient.
          </p>
        )}
      </div>
    </div>
  )
}

