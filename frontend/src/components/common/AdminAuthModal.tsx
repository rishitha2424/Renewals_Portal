import React, { useState } from 'react'
import { Lock, LogIn, LogOut, ShieldCheck, X, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { adminLogin, adminLogout } from '@/api/client'
import { showToast } from '@/components/ui/Toast'

export default function AdminAuthModal() {
  const { isAdmin, setIsAdmin } = useAppStore()
  const [isOpen, setIsOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await adminLogin(password)
      setIsAdmin(true, res.token)
      setPassword('')
      setIsOpen(false)
      showToast.success('Admin Signed In', 'Full upload and management permissions unlocked.')
    } catch (err: any) {
      const msg = err.response?.data?.detail || 'Invalid admin credentials or server configuration.'
      setError(msg)
      showToast.error('Sign In Failed', msg)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await adminLogout()
    } catch (_) {}
    setIsAdmin(false, null)
    showToast.info('Signed Out', 'Returned to read-only viewer mode.')
  }

  return (
    <>
      {isAdmin ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Admin</span>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out as administrator"
            className="ml-1 hover:text-red-500 transition-colors"
            id="admin-sign-out-btn"
          >
            <LogOut className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-card)] border border-[var(--border)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-sm"
          id="admin-sign-in-btn"
          title="Sign in as administrator to upload or manage snapshots"
        >
          <Lock className="w-3.5 h-3.5 text-amber-500" />
          <span>Admin sign in</span>
        </button>
      )}

      {/* Admin Sign-In Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] shadow-2xl p-6 relative">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[var(--text-primary)]">Admin Authentication</h3>
                <p className="text-[11px] text-[var(--text-muted)]">Uploads & backfills require admin credentials</p>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                  Admin Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter ADMIN_PASSWORD..."
                  className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  autoFocus
                  required
                  id="admin-password-input"
                />
              </div>

              {error && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-amber-500 text-white font-semibold text-xs hover:bg-amber-600 transition-colors disabled:opacity-50"
                  id="admin-submit-login-btn"
                >
                  {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Sign In</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
