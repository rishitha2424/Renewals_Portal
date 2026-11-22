import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Users, 
  UserPlus, 
  Upload, 
  ShieldCheck, 
  ShieldAlert, 
  Copy, 
  Check, 
  Trash2, 
  KeyRound, 
  AlertCircle, 
  Edit3, 
  Search,
  CheckCircle2,
  X,
  FileSpreadsheet
} from 'lucide-react'
import { 
  getAdminUsers, 
  createAdminUser, 
  updateAdminUser, 
  toggleAdminUserStatus, 
  deleteAdminUser, 
  getUserInviteLink, 
  getUserResetLink, 
  addUserAlias, 
  deleteUserAlias, 
  uploadKamRoster, 
  getKamSyncAlerts, 
  resolveKamSyncAlert,
  AdminUserItem 
} from '@/api/client'
import { formatDate } from '@/utils/format'
import { useAuthStore } from '@/store/authStore'

export default function UserManagement() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { currentUser } = useAuthStore()
  const isCurrentUserOwner = !!currentUser?.is_owner || currentUser?.email?.toLowerCase() === 'rishithathoka@gmail.com'

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All')

  // Modals
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState<{ title: string; link: string; expiresIn?: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Invite Form State
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'management' | 'kam'>('kam')
  const [inviteOwnerName, setInviteOwnerName] = useState('')
  const [inviteAliases, setInviteAliases] = useState('')

  // Edit User Form State
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editRole, setEditRole] = useState<'admin' | 'management' | 'kam'>('kam')
  const [editStatus, setEditStatus] = useState<'active' | 'disabled' | 'invited'>('active')
  const [editOwnerName, setEditOwnerName] = useState('')
  const [editAliases, setEditAliases] = useState<string[]>([])
  const [editNewAlias, setEditNewAlias] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState<string | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  const openEditModal = (u: AdminUserItem) => {
    setEditingUser(u)
    setEditName(u.name || '')
    setEditEmail(u.email || '')
    setEditRole(u.role)
    setEditStatus((u.status as any) || 'active')
    setEditOwnerName(u.owner_name || '')
    setEditAliases(u.aliases ? [...u.aliases] : [])
    setEditNewAlias('')
    setEditError(null)
    setEditSuccess(null)
  }

  const handleSaveEditUser = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setEditError(null)
    setEditSuccess(null)

    if (!editName.trim()) {
      setEditError('Name is required.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!editEmail.trim() || !emailRegex.test(editEmail.trim())) {
      setEditError('Please enter a valid email address.')
      return
    }

    if (!editingUser) return
    setEditSaving(true)

    try {
      await updateAdminUser(editingUser.id, {
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
        status: editStatus,
        owner_name: editRole === 'kam' ? editOwnerName.trim() : undefined,
        aliases: editRole === 'kam' ? editAliases : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setEditSuccess('User saved successfully.')
      setTimeout(() => {
        setEditingUser(null)
      }, 1200)
    } catch (err: any) {
      setEditError(err.response?.data?.detail || err.message || 'Failed to update user.')
    } finally {
      setEditSaving(false)
    }
  }

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
  })

  const { data: alertsData } = useQuery({
    queryKey: ['kam-sync-alerts'],
    queryFn: getKamSyncAlerts,
  })

  const users = usersData?.users || []
  const alerts = alertsData?.alerts || []

  // Create/Invite Mutation
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const aliasArr = inviteAliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return await createAdminUser({
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        role: inviteRole,
        owner_name: inviteRole === 'kam' ? inviteOwnerName.trim() : undefined,
        aliases: aliasArr,
      })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setShowInviteModal(false)
      setInviteName('')
      setInviteEmail('')
      setInviteRole('kam')
      setInviteOwnerName('')
      setInviteAliases('')
      if (res?.invite_link) {
        setShowLinkModal({
          title: 'User Invitation Link Generated',
          link: res.invite_link,
        })
      } else {
        setSuccessMsg('User successfully created and invitation prepared.')
      }
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail || 'Failed to create user.')
    },
  })

  // Status toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: 'active' | 'disabled' }) => {
      return await toggleAdminUserStatus(userId, status)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail || 'Cannot modify this user.')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await deleteAdminUser(userId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setSuccessMsg('User successfully removed.')
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.detail || 'Cannot delete this user.')
    },
  })

  // Handle roster upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const res = await uploadKamRoster(file)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['kam-sync-alerts'] })
      setSuccessMsg(`Roster processed: ${res.synced_count || 0} users synced, ${res.alert_count || 0} alerts.`)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to parse KAM roster.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleCopyLink = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'All' && u.role !== roleFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.owner_name && u.owner_name.toLowerCase().includes(q))
      )
    }
    return true
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2.5">
            <Users className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            <span>User &amp; Access Governance</span>
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Manage administrative privileges, management review accounts, and Opportunity Owner (KAM) mapping
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Upload KAM Roster</span>
          </button>
          <button
            onClick={() => setShowInviteModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add / Invite User</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="hover:text-red-800"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="hover:text-emerald-800"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* KAM Sync Alerts Banner */}
      {alerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2 font-bold mb-1">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <span>KAM Roster Discrepancies ({alerts.length})</span>
          </div>
          <p className="mb-2">The following opportunity owners in the deals file do not have an active user account or alias:</p>
          <div className="flex flex-wrap gap-2">
            {alerts.slice(0, 8).map((al: any) => (
              <span key={al.id} className="px-2 py-0.5 rounded-md bg-[var(--bg-card)] border border-[var(--border)] font-semibold text-[11px]">
                {al.owner_name} ({al.deal_count} deals)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="p-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search users, emails, or owner names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD] transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] font-medium">Role:</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs py-1.5 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer"
          >
            <option value="All">All Roles</option>
            <option value="admin">Admin</option>
            <option value="management">Management</option>
            <option value="kam">KAM (Opportunity Owner)</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-[var(--bg-secondary)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead className="bg-[var(--bg-secondary)] border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
                <tr>
                  <th className="px-4 py-3">User &amp; Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Opportunity Owner Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Login</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--bg-secondary)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--text-primary)]">{u.name}</span>
                        {u.is_owner && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25">
                            Owner
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        u.role === 'admin'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                          : u.role === 'management'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.owner_name ? (
                        <div>
                          <span className="font-medium text-[var(--text-primary)]">{u.owner_name}</span>
                          {u.aliases && u.aliases.length > 0 && (
                            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                              Aliases: {u.aliases.join(', ')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        u.status === 'active'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : u.status === 'invited'
                          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                          : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                      }`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--text-secondary)]">
                      {u.last_login ? formatDate(u.last_login) : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={async () => {
                            try {
                              const res = await getUserResetLink(u.id)
                              setShowLinkModal({
                                title: `Password Reset / Setup Link for ${u.name}`,
                                link: res.reset_url || res.invite_url || '',
                                expiresIn: res.expires_in_hours || 24,
                              })
                            } catch (e: any) {
                              setErrorMsg(e.response?.data?.detail || e.message || 'Failed to get reset link.')
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          title="Generate Password Reset Link"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          title="Edit User"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {!u.is_owner && (
                          <>
                            <button
                              onClick={() => toggleMutation.mutate({ userId: u.id, status: u.status === 'disabled' ? 'active' : 'disabled' })}
                              className={`p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-xs font-semibold ${
                                u.status === 'disabled' ? 'text-emerald-600' : 'text-slate-500'
                              }`}
                              title={u.status === 'disabled' ? 'Enable User' : 'Disable User'}
                            >
                              {u.status === 'disabled' ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete user ${u.name}?`)) {
                                  deleteMutation.mutate(u.id)
                                }
                              }}
                              className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] text-rose-500 hover:text-rose-700"
                              title="Delete User"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)]">Invite New User</h3>
              <button onClick={() => setShowInviteModal(false)}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                inviteMutation.mutate()
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="e.g. john.doe@mobileum.com"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e: any) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none cursor-pointer"
                >
                  <option value="kam">Opportunity Owner (KAM) - Own Deals Only</option>
                  <option value="management">Management - Full Read-Only Analytics &amp; Messaging</option>
                  <option value="admin">Administrator - Full Platform Control</option>
                </select>
              </div>
              {inviteRole === 'kam' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Excel Opportunity Owner Name
                    </label>
                    <input
                      type="text"
                      value={inviteOwnerName}
                      onChange={(e) => setInviteOwnerName(e.target.value)}
                      placeholder="Exact name from SFDC / Excel report"
                      className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                      Aliases (Comma-separated)
                    </label>
                    <input
                      type="text"
                      value={inviteAliases}
                      onChange={(e) => setInviteAliases(e.target.value)}
                      placeholder="e.g. J. Doe, Johnny Doe"
                      className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                    />
                  </div>
                </>
              )}
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="px-4 py-2 text-xs font-semibold bg-[#12284C] text-white rounded-xl hover:bg-[#1a386b] disabled:opacity-50 transition-all"
                >
                  {inviteMutation.isPending ? 'Inviting...' : 'Create & Generate Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Display Modal (Invite/Reset) */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <h3 className="font-bold text-sm text-[var(--text-primary)]">{showLinkModal.title}</h3>
              <button onClick={() => setShowLinkModal(null)}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Copy this link and send it directly to the user so they can set their password:
              {showLinkModal.expiresIn && (
                <span className="block mt-1 font-semibold text-[var(--text-primary)]">
                  Expires in {showLinkModal.expiresIn} hours (single-use).
                </span>
              )}
            </p>
            <div className="p-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] flex items-center gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={showLinkModal.link}
                className="w-full bg-transparent text-xs font-mono text-[var(--text-primary)] focus:outline-none"
              />
              <button
                onClick={() => handleCopyLink(showLinkModal.link)}
                className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-teal-600 hover:text-teal-700 shrink-0"
                title="Copy link to clipboard"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowLinkModal(null)}
                className="px-4 py-2 text-xs font-semibold bg-[#12284C] text-white rounded-xl hover:bg-[#1a386b]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal (Redesigned by Role) */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)] mb-4">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">
                  Edit User: {editingUser.name}
                </h3>
              </div>
              <button onClick={() => setEditingUser(null)}>
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>

            {/* In-Dialog Alerts */}
            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}
            {editSuccess && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{editSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditUser} className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>

              {/* Email Address */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="e.g. jane.doe@mobileum.com"
                  className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Role
                </label>
                {editingUser.is_owner ? (
                  <div className="px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-muted)] flex items-center justify-between">
                    <span>Admin (Owner Account)</span>
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Protected</span>
                  </div>
                ) : editingUser.role === 'admin' && !isCurrentUserOwner ? (
                  <div className="px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-muted)] flex items-center justify-between">
                    <span>Administrator</span>
                    <span className="text-[10px] text-[var(--text-muted)]">Only owner can change</span>
                  </div>
                ) : (
                  <select
                    value={editRole}
                    onChange={(e: any) => setEditRole(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none cursor-pointer"
                  >
                    {isCurrentUserOwner && <option value="admin">Administrator - Full Platform Control</option>}
                    <option value="management">Management - Full Analytics &amp; Messaging</option>
                    <option value="kam">KAM (Opportunity Owner) - Own Deals Only</option>
                  </select>
                )}
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Status
                </label>
                {editingUser.is_owner ? (
                  <div className="px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-muted)] flex items-center justify-between">
                    <span>Active</span>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">Permanent</span>
                  </div>
                ) : (
                  <select
                    value={editStatus}
                    onChange={(e: any) => setEditStatus(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none cursor-pointer"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="invited">Invited (Pending Activation)</option>
                  </select>
                )}
              </div>

              {/* KAM ONLY: Opportunity Owner Name & Aliases */}
              {editRole === 'kam' && (
                <div className="pt-2 border-t border-[var(--border)] space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-0.5">
                      Opportunity Owner Name
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">
                      Owner name: the exact name as written in the Excel report. Used to link this user to their deals.
                    </p>
                    <input
                      type="text"
                      value={editOwnerName}
                      onChange={(e) => setEditOwnerName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-[#00A3AD]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-0.5">
                      Aliases
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] mb-1.5">
                      Aliases: other spellings of the same name in the Excel, so the deals still match.
                    </p>

                    {editAliases.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {editAliases.map((al) => (
                          <span
                            key={al}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[11px] font-medium"
                          >
                            <span>{al}</span>
                            <button
                              type="button"
                              onClick={() => setEditAliases(editAliases.filter((a) => a !== al))}
                              className="text-red-500 hover:text-red-700 font-bold ml-0.5"
                              title={`Remove alias ${al}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editNewAlias}
                        onChange={(e) => setEditNewAlias(e.target.value)}
                        placeholder="Add alternative spelling..."
                        className="flex-1 px-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!editNewAlias.trim()) return
                          if (!editAliases.includes(editNewAlias.trim())) {
                            setEditAliases([...editAliases, editNewAlias.trim()])
                          }
                          setEditNewAlias('')
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl hover:bg-[var(--bg-card)] transition-colors"
                      >
                        Add Alias
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-4 py-2 text-xs font-semibold bg-[#12284C] text-white rounded-xl hover:bg-[#1a386b] disabled:opacity-50 transition-all shadow-sm"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

