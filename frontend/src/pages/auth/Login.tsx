import React, { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { forgotPassword } from '@/api/client'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, error: authError, clearError, isAuthenticated, currentUser } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Forgot password modal
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  // Redirect if already authenticated
  if (isAuthenticated && currentUser) {
    const landing = currentUser.role === 'kam' ? '/kam/overview' : '/'
    return <Navigate to={landing} replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    clearError()
    setLoading(true)

    try {
      const user = await login(email.trim(), password, rememberMe)
      const from = (location.state as any)?.from?.pathname
      if (user.role === 'kam') {
        if (from && from.startsWith('/kam')) {
          navigate(from, { replace: true })
        } else {
          navigate('/kam/overview', { replace: true })
        }
      } else {
        if (from && from !== '/login') {
          navigate(from, { replace: true })
        } else {
          navigate('/', { replace: true })
        }
      }
    } catch (err: any) {
      setLocalError(err.message || 'Authentication failed. Please verify your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) return
    setForgotLoading(true)
    try {
      await forgotPassword(forgotEmail.trim())
      setForgotSuccess(true)
    } catch {
      // Show success anyway to prevent enumeration
      setForgotSuccess(true)
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#12284C] shadow-lg mb-4">
          <img src="/assets/logo.png" alt="Mobileum" className="w-8 h-8 object-contain" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
          Mobileum Horizon
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)] font-medium">
          Renewals Intelligence &amp; Opportunity Portal
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-[var(--bg-card)] py-8 px-6 sm:px-10 shadow-xl rounded-2xl border border-[var(--border)]">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {(localError || authError) && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{localError || authError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1.5 uppercase tracking-wide">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--text-muted)]">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@mobileum.com"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-teal-500 text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => { setShowForgotModal(true); setForgotSuccess(false); setForgotEmail(email) }}
                  className="text-xs text-teal-600 dark:text-teal-400 hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--text-muted)]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-teal-500 text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--border)] text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
                <span className="text-xs text-[var(--text-secondary)] font-medium">Keep me signed in</span>
              </label>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-white font-bold text-xs sm:text-sm bg-[#12284C] hover:bg-[#1b3a6d] shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-[var(--border)] text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)]">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Role-Based Access · Enterprise Security</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-[var(--bg-card)] rounded-2xl p-6 border border-[var(--border)] shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-[var(--text-primary)]">
              Reset Your Password
            </h3>
            {forgotSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  Reset Instructions Sent
                </div>
                <p>
                  If an account exists for <strong className="font-semibold">{forgotEmail}</strong>, an email with reset instructions has been generated. If email delivery is disabled, please contact your Administrator Rishitha for a manual reset link.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Enter your Mobileum login email address and we'll send you a secure link to reset your password.
                </p>
                <div>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@mobileum.com"
                    className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-teal-500 text-[var(--text-primary)]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="px-3 py-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-secondary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || !forgotEmail.trim()}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#12284C] text-white hover:bg-[#1a3866] disabled:opacity-50"
                  >
                    {forgotLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

