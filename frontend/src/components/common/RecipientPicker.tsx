import React, { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Lock, Users, Shield, Briefcase, UserCheck, AlertCircle } from 'lucide-react'
import { getMessageRecipients, type RecipientUser, type RecipientOptions } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import clsx from 'clsx'

interface RecipientPickerProps {
  dealId?: string
  selectedIds: string[]
  onChange: (ids: string[]) => void
  contextType?: 'message' | 'reply' | 'comment'
  commentVisibility?: 'internal' | 'shared_with_owner'
  className?: string
  disabled?: boolean
}

export const RecipientPicker: React.FC<RecipientPickerProps> = ({
  dealId,
  selectedIds,
  onChange,
  contextType = 'message',
  commentVisibility = 'shared_with_owner',
  className,
  disabled = false,
}) => {
  const user = useAuthStore((s) => s.currentUser)
  const isKam = user?.role === 'kam'
  const isAdminViewer = user?.role === 'admin'
  const isComment = contextType === 'comment'
  const isSharedComment = commentVisibility === 'shared_with_owner'

  const { data: options, isLoading } = useQuery<RecipientOptions>({
    queryKey: ['message-recipients', dealId || 'global'],
    queryFn: () => getMessageRecipients(dealId),
    staleTime: 30_000,
  })

  const initKeyRef = useRef<string>('')
  const prevVisRef = useRef<string>(commentVisibility)

  const adminCandidates = useMemo(() => {
    if (!options?.admins) return []
    return options.admins.filter((a) => a.id !== user?.id)
  }, [options?.admins, user?.id])

  const mgmtCandidates = useMemo(() => {
    if (!options?.management) return []
    return options.management.filter((m) => m.id !== user?.id)
  }, [options?.management, user?.id])

  const ownerCandidate = useMemo(() => {
    if (!options?.deal_owner) return null
    if (options.deal_owner.id === user?.id) return null
    return options.deal_owner
  }, [options?.deal_owner, user?.id])

  const adminIds = useMemo(() => adminCandidates.map((a) => a.id), [adminCandidates])
  const mgmtIds = useMemo(() => mgmtCandidates.map((m) => m.id), [mgmtCandidates])

  const hasAdminGroupToken = useMemo(
    () => selectedIds.some((id) => id === 'admin' || id === 'group:admin'),
    [selectedIds]
  )
  const hasMgmtGroupToken = useMemo(
    () => selectedIds.some((id) => id === 'management' || id === 'group:management'),
    [selectedIds]
  )

  const selectedAdminsCount = useMemo(() => {
    if (hasAdminGroupToken) return options?.admin_count ?? adminCandidates.length
    return adminCandidates.filter((a) => selectedIds.includes(a.id)).length
  }, [hasAdminGroupToken, options?.admin_count, adminCandidates, selectedIds])

  const allAdminsSelected = useMemo(() => {
    if (hasAdminGroupToken) return true
    if (adminIds.length === 0) return false
    return adminIds.every((id) => selectedIds.includes(id))
  }, [hasAdminGroupToken, adminIds, selectedIds])

  const selectedMgmtCount = useMemo(() => {
    if (hasMgmtGroupToken) return options?.management_count ?? mgmtCandidates.length
    return mgmtCandidates.filter((m) => selectedIds.includes(m.id)).length
  }, [hasMgmtGroupToken, options?.management_count, mgmtCandidates, selectedIds])

  const allMgmtSelected = useMemo(() => {
    if (hasMgmtGroupToken) return true
    if (mgmtIds.length === 0) return false
    return mgmtIds.every((id) => selectedIds.includes(id))
  }, [hasMgmtGroupToken, mgmtIds, selectedIds])

  const anyMgmtSelected = useMemo(() => {
    return hasMgmtGroupToken || mgmtIds.some((id) => selectedIds.includes(id))
  }, [hasMgmtGroupToken, mgmtIds, selectedIds])

  const ownerLocked = useMemo(() => {
    if (!ownerCandidate || isKam) return false
    if (isComment) return isSharedComment
    return true
  }, [ownerCandidate, isKam, isComment, isSharedComment])

  const adminLocked = useMemo(() => {
    // Rule: For comments, whenever Management is selected, Admin is automatically ticked and locked
    return isComment && anyMgmtSelected
  }, [isComment, anyMgmtSelected])

  const normalizeSelection = (
    raw: string[],
    opts?: RecipientOptions,
    vis: string = commentVisibility
  ): string[] => {
    const out = new Set(raw.filter(Boolean))
    const o = opts || options
    if (!o) return Array.from(out)

    const aIds = (o.admins || []).map((a) => a.id).filter((id) => id !== user?.id)
    const mIds = (o.management || []).map((m) => m.id).filter((id) => id !== user?.id)
    const oCand = o.deal_owner && o.deal_owner.id !== user?.id ? o.deal_owner : null

    const mgmtSelected =
      out.has('management') ||
      out.has('group:management') ||
      mIds.some((id) => out.has(id))

    if (isComment) {
      if (mgmtSelected || out.size === 0) {
        if (aIds.length > 0) {
          aIds.forEach((id) => out.add(id))
        } else {
          out.add('group:admin')
        }
      }
      if (vis === 'internal' && oCand) {
        out.delete(oCand.id)
        out.delete('owner')
        out.delete('group:owner')
      } else if (vis === 'shared_with_owner' && !isKam && oCand) {
        out.add(oCand.id)
      }
    } else {
      if (!isKam && oCand) {
        out.add(oCand.id)
      }
    }
    return Array.from(out)
  }

  // Initialize defaults when dealId/contextType changes or options load
  useEffect(() => {
    if (!options) return
    const currentKey = `${dealId || 'global'}:${contextType}`
    if (initKeyRef.current !== currentKey) {
      initKeyRef.current = currentKey
      prevVisRef.current = commentVisibility
      const rawDefaults = options.defaults
      const serverDefaults: string[] = Array.isArray(rawDefaults)
        ? rawDefaults
        : contextType === 'comment'
          ? (rawDefaults?.comment || [])
          : contextType === 'reply'
            ? (rawDefaults?.reply || [])
            : (rawDefaults?.message || [])

      let initial: string[] = serverDefaults ? [...serverDefaults] : []
      if (initial.length === 0) {
        if (isComment) {
          initial = adminIds.length > 0 ? [...adminIds] : ['group:admin']
          if (isKam) {
            initial.push(...(mgmtIds.length > 0 ? mgmtIds : ['group:management']))
          } else if (isSharedComment && ownerCandidate) {
            initial.push(ownerCandidate.id)
          }
        } else {
          if (isKam) {
            initial = [
              ...(adminIds.length > 0 ? adminIds : ['group:admin']),
              ...(mgmtIds.length > 0 ? mgmtIds : ['group:management']),
            ]
          } else {
            initial = [
              ...(adminIds.length > 0 ? adminIds : ['group:admin']),
              ...(ownerCandidate ? [ownerCandidate.id] : []),
            ]
          }
        }
      }
      onChange(normalizeSelection(initial, options, commentVisibility))
      return
    }

    if (prevVisRef.current !== commentVisibility) {
      prevVisRef.current = commentVisibility
      const updated = normalizeSelection(selectedIds, options, commentVisibility)
      onChange(updated)
    }
  }, [options, dealId, contextType, commentVisibility])

  const toggleId = (id: string) => {
    if (disabled) return
    if (ownerCandidate && id === ownerCandidate.id && ownerLocked) return
    const next = new Set(selectedIds)
    if (next.has(id)) {
      // Prevent unchecking an admin while adminLocked
      if (adminLocked && adminIds.includes(id)) return
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(normalizeSelection(Array.from(next)))
  }

  const toggleGroup = (group: 'admin' | 'management') => {
    if (disabled) return
    if (group === 'admin' && adminLocked) return

    const next = new Set(selectedIds)
    if (group === 'admin') {
      if (allAdminsSelected) {
        next.delete('admin')
        next.delete('group:admin')
        adminIds.forEach((id) => next.delete(id))
      } else {
        if (adminIds.length > 0) {
          adminIds.forEach((id) => next.add(id))
        } else {
          next.add('group:admin')
        }
      }
    } else {
      if (allMgmtSelected) {
        next.delete('management')
        next.delete('group:management')
        mgmtIds.forEach((id) => next.delete(id))
      } else {
        if (mgmtIds.length > 0) {
          mgmtIds.forEach((id) => next.add(id))
        } else {
          next.add('group:management')
        }
      }
    }
    onChange(normalizeSelection(Array.from(next)))
  }

  // Build live human summary (names + counts only, never emails)
  const liveSummaryText = useMemo(() => {
    const parts: string[] = []
    const totalAdmins = options?.admin_count ?? adminCandidates.length
    const totalMgmt = options?.management_count ?? mgmtCandidates.length

    if (allAdminsSelected && totalAdmins > 0) {
      parts.push(`all admins (${selectedAdminsCount || totalAdmins})`)
    } else if (selectedAdminsCount > 0) {
      if (isAdminViewer) {
        const names = adminCandidates
          .filter((a) => selectedIds.includes(a.id))
          .map((a) => a.name)
        parts.push(names.length <= 2 ? names.join(', ') : `${names.length} admins`)
      } else {
        parts.push(`Admin (${selectedAdminsCount})`)
      }
    }

    if (allMgmtSelected && totalMgmt > 0) {
      parts.push(`all management (${selectedMgmtCount || totalMgmt})`)
    } else if (selectedMgmtCount > 0) {
      const names = mgmtCandidates
        .filter((m) => selectedIds.includes(m.id))
        .map((m) => m.name)
      parts.push(names.length <= 2 ? names.join(', ') : `Management (${names.length})`)
    }

    if (ownerCandidate && (ownerLocked || selectedIds.includes(ownerCandidate.id))) {
      parts.push(`Owner (${ownerCandidate.name})`)
    }

    if (parts.length === 0) {
      return isComment ? 'Notifies all active admins by default' : 'Select at least one recipient'
    }
    return `Notifies ${parts.join(' and ')}`
  }, [
    options,
    adminCandidates,
    mgmtCandidates,
    allAdminsSelected,
    selectedAdminsCount,
    allMgmtSelected,
    selectedMgmtCount,
    selectedIds,
    isAdminViewer,
    ownerCandidate,
    ownerLocked,
    isComment,
  ])

  const visibilityHint = useMemo(() => {
    if (isComment) {
      if (isSharedComment) {
        return 'Comments on this deal are readable by Admins, Management, and the Deal Owner.'
      }
      return 'Internal comments are readable by Admins and Management only (hidden from KAM Owner).'
    }
    return 'Private thread: readable only by you, selected recipients, and the Deal Owner.'
  }, [isComment, isSharedComment])

  if (isLoading) {
    return (
      <div className={clsx('text-xs text-slate-400 animate-pulse py-1', className)}>
        Loading recipients...
      </div>
    )
  }

  const totalAdminCount = options?.admin_count ?? adminCandidates.length
  const totalMgmtCount = options?.management_count ?? mgmtCandidates.length

  return (
    <div
      className={clsx(
        'rounded-xl border border-slate-200/80 dark:border-slate-700/70 bg-slate-50/70 dark:bg-slate-900/50 p-2.5 space-y-2',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-indigo-500" />
          Recipients
        </span>
        {adminLocked && (
          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Admin locked with Management
          </span>
        )}
      </div>

      {/* Group Quick-Toggles */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled || adminLocked}
          onClick={() => toggleGroup('admin')}
          title={
            adminLocked
              ? 'Admin is automatically included whenever Management is notified on a comment'
              : 'Toggle all active Admins'
          }
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all',
            allAdminsSelected
              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
              : selectedAdminsCount > 0
                ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400/50'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400',
            (disabled || adminLocked) && 'opacity-85 cursor-not-allowed'
          )}
        >
          <Shield className="w-3 h-3" />
          <span>Admin ({totalAdminCount})</span>
          {adminLocked ? (
            <Lock className="w-3 h-3" />
          ) : allAdminsSelected ? (
            <Check className="w-3 h-3" />
          ) : null}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => toggleGroup('management')}
          title="Toggle all active Management users"
          className={clsx(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all',
            allMgmtSelected
              ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
              : selectedMgmtCount > 0
                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/50'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-400',
            disabled && 'opacity-60 cursor-not-allowed'
          )}
        >
          <Briefcase className="w-3 h-3" />
          <span>Management ({totalMgmtCount})</span>
          {allMgmtSelected && <Check className="w-3 h-3" />}
        </button>

        {ownerCandidate && (!isComment || isSharedComment) && (
          <button
            type="button"
            disabled={disabled || ownerLocked}
            onClick={() => toggleId(ownerCandidate.id)}
            title={
              ownerLocked
                ? 'Deal owner is always notified'
                : 'Toggle Deal Owner'
            }
            className={clsx(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all',
              ownerLocked || selectedIds.includes(ownerCandidate.id)
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
              (disabled || ownerLocked) && 'opacity-90 cursor-not-allowed'
            )}
          >
            <UserCheck className="w-3 h-3" />
            <span>Owner: {ownerCandidate.name}</span>
            {ownerLocked ? (
              <Lock className="w-3 h-3" />
            ) : selectedIds.includes(ownerCandidate.id) ? (
              <Check className="w-3 h-3" />
            ) : null}
          </button>
        )}
      </div>

      {/* Individual People (Admins see individuals in both groups; non-admins see individual Management only) */}
      {(mgmtCandidates.length > 0 || (isAdminViewer && adminCandidates.length > 1)) && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-200/70 dark:border-slate-700/60">
          {isAdminViewer &&
            adminCandidates.length > 0 &&
            adminCandidates.map((person: RecipientUser) => {
              const checked = hasAdminGroupToken || selectedIds.includes(person.id)
              const locked = adminLocked
              return (
                <button
                  key={person.id}
                  type="button"
                  disabled={disabled || locked}
                  onClick={() => toggleId(person.id)}
                  title={
                    person.has_email === false
                      ? `${person.name} (Admin - no email on file)`
                      : `${person.name} (Admin)`
                  }
                  className={clsx(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors',
                    checked
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700'
                      : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300',
                    (disabled || locked) && 'cursor-not-allowed opacity-80'
                  )}
                >
                  <span>{person.name}</span>
                  <span className="text-[9px] opacity-60 uppercase">Admin</span>
                  {person.has_email === false && (
                    <AlertCircle className="w-2.5 h-2.5 text-amber-500" />
                  )}
                </button>
              )
            })}

          {mgmtCandidates.map((person: RecipientUser) => {
            const checked = hasMgmtGroupToken || selectedIds.includes(person.id)
            return (
              <button
                key={person.id}
                type="button"
                disabled={disabled}
                onClick={() => toggleId(person.id)}
                title={
                  person.has_email === false
                    ? `${person.name} (Management - no email on file)`
                    : `${person.name} (Management)`
                }
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors',
                  checked
                    ? 'bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-200 border-violet-300 dark:border-violet-700'
                    : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300',
                  disabled && 'cursor-not-allowed opacity-70'
                )}
              >
                <span>{person.name}</span>
                <span className="text-[9px] opacity-60 uppercase">Mgmt</span>
                {person.has_email === false && (
                  <AlertCircle className="w-2.5 h-2.5 text-amber-500" />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Live summary + accurate visibility hint */}
      <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/60 space-y-0.5 text-[11px]">
        <div className="font-semibold text-slate-700 dark:text-slate-200">
          {liveSummaryText}
        </div>
        <div className="text-slate-500 dark:text-slate-400">{visibilityHint}</div>
      </div>
    </div>
  )
}

export default RecipientPicker
