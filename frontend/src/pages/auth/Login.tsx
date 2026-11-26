import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, KeyRound } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { forgotPassword, getSSOConfig, SSOPublicConfig } from '@/api/client'

// Microsoft 4-color square logo SVG
function MicrosoftLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, error: authError, clearError, isAuthenticated, currentUser } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // SSO public config
  const [ssoConfig, setSsoConfig] = useState<SSOPublicConfig | null>(null)
  const [ssoLoading, setSsoLoading] = useState<boolean>(true)
  const [showPasswordLogin, setShowPasswordLogin] = useState<boolean>(false)

  // Forgot password modal
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const searchParams = new URLSearchParams(location.search)
  const isExpired = searchParams.get('expired') === '1'
  const ssoError = searchParams.get('error')
  const ssoEmail = searchParams.get('email')

  // Fetch SSO public configuration on load
  useEffect(() => {
    getSSOConfig()
      .then((cfg) => {
        setSsoConfig(cfg)
        if (cfg.sso_enabled && !cfg.sso_password_login_for_users) {
          setShowPasswordLogin(false)
        } else {
          setShowPasswordLogin(true)
        }
      })
      .catch(() => {
        // Fallback to local login if SSO config call fails
        setShowPasswordLogin(true)
      })
      .finally(() => setSsoLoading(false))
  }, [])

  // Format friendly SSO error message
  const getSsoErrorMessage = (code: string | null): string | null => {
    if (!code) return null
    switch (code) {
      case 'no_access':
        return ssoEmail
          ? `You do not have access to Mobileum Horizon (${ssoEmail}). An access request has been recorded for your account. Please ask the administrator to approve your account and assign your role.`
          : 'You do not have access to Mobileum Horizon. An access request has been recorded. Please ask the administrator to approve your account and assign your role.'
      case 'tenant_mismatch':
        return 'Sign-in was from an unauthorized Microsoft tenant. Please sign in with your approved Mobileum work account.'
      case 'domain_not_allowed':
        return 'Your email domain is not authorized for this portal. Please sign in with an authorized corporate account or contact the administrator.'
      case 'account_disabled':
        return 'Your account has been deactivated. Please contact your administrator to re-enable access.'
      case 'sso_cancelled':
        return 'Microsoft sign-in was cancelled.'
      case 'sso_state_invalid':
        return 'Security verification expired or invalid. Please try signing in again.'
      case 'sso_token_invalid':
        return 'Microsoft authentication token could not be verified. Please try again.'
      case 'sso_failed':
      default:
        return 'Microsoft sign-in could not be completed. Please try again or contact your administrator.'
    }
  }

  // Redirect if already authenticated (unless redirected here with expired session)
  if (isAuthenticated && currentUser && !isExpired) {
    const landing = currentUser.role === 'kam' ? '/kam/overview' : '/'
    return <Navigate to={landing} replace />
  }

  const handleMicrosoftLogin = () => {
    window.location.href = ssoConfig?.login_url || '/api/auth/sso/login'
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

  const friendlySsoError = getSsoErrorMessage(ssoError)

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
        <div className="bg-[var(--bg-card)] py-8 px-6 sm:px-10 shadow-xl rounded-2xl border border-[var(--border)] space-y-6">
          {/* Expired Session Banner */}
          {isExpired && !localError && !authError && !friendlySsoError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Your session has expired. Please sign in again to continue.</span>
            </div>
          )}

          {/* SSO Friendly Error Banner */}
          {friendlySsoError && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border ${
              ssoError === 'no_access'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
            }`}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">
                  {ssoError === 'no_access' ? 'Access Pending Approval' : 'Sign-In Failed'}
                </span>
                <span className="leading-relaxed block">{friendlySsoError}</span>
              </div>
            </div>
          )}

          {/* Local Password Auth Error */}
          {(localError || authError) && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{localError || authError}</span>
            </div>
          )}

          {/* Primary SSO Button */}
          {ssoConfig?.sso_enabled && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleMicrosoftLogin}
                id="sso-microsoft-login-btn"
                className="w-full py-3 px-4 rounded-xl text-[var(--text-primary)] font-bold text-xs sm:text-sm bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] border-2 border-[var(--border)] hover:border-[#00A4EF]/50 shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-3 cursor-pointer group"
              >
                <MicrosoftLogo className="w-5 h-5 shrink-0 group-hover:scale-105 transition-transform" />
                <span>{ssoConfig.button_label || 'Sign in with Microsoft'}</span>
              </button>
              <p className="text-[11px] text-center text-[var(--text-muted)]">
                Single sign-on using your Mobileum work credentials
              </p>
            </div>
          )}

          {/* Break-glass or Alternate Password Login Section */}
          {ssoConfig?.sso_enabled ? (
            ssoConfig.sso_password_login_for_users ? (
              // Users can also use password
              <div className="space-y-5 pt-3">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--border)]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-[var(--bg-card)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] font-semibold">
                      or continue with password
                    </span>
                  </div>
                </div>

                <form className="space-y-4" onSubmit={handleSubmit}>
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
              </div>
            ) : ssoConfig.sso_local_login_enabled ? (
              // Break-glass owner password login (collapsible)
              <div className="pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowPasswordLogin(!showPasswordLogin)}
                  id="breakglass-login-toggle-btn"
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] font-medium py-1 transition-colors cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Owner / Break-Glass sign-in with password</span>
                  {showPasswordLogin ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
                </button>

                {showPasswordLogin && (
                  <form className="space-y-4 mt-4 pt-4 border-t border-[var(--border-subtle)]" onSubmit={handleSubmit}>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1 uppercase tracking-wide">
                        Owner Email
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="owner@mobileum.com"
                        className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-teal-500 text-[var(--text-primary)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1 uppercase tracking-wide">
                        Password
                      </label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full px-3 py-2 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-teal-500 text-[var(--text-primary)]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2 px-4 rounded-xl text-white font-bold text-xs bg-slate-800 hover:bg-slate-700 transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {loading ? 'Authenticating...' : 'Sign In as Owner'}
                    </button>
                  </form>
                )}
              </div>
            ) : null
          ) : (
            // SSO disabled: default standard login form
            <form className="space-y-5" onSubmit={handleSubmit}>
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
          )}

          <div className="pt-3 border-t border-[var(--border)] text-center">
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
                  If an account exists for <strong className="font-semibold">{forgotEmail}</strong>, an email with reset instructions has been generated. If email delivery is disabled, please contact your system administrator for a manual reset link.
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


