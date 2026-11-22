import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { Lock, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react'
import { verifyInviteToken, setInvitePassword, resetPasswordWithToken } from '@/api/client'

export default function SetPassword() {
  const { token } = useParams<{ token: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const isInvite = location.pathname.includes('/invite')
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [userInfo, setUserInfo] = useState<{ name?: string; email?: string } | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setTokenValid(false)
      setError('Invalid or missing security token.')
      return
    }

    if (isInvite) {
      verifyInviteToken(token)
        .then((res) => {
          setTokenValid(true)
          setUserInfo({ name: res.name, email: res.email })
        })
        .catch((err) => {
          setTokenValid(false)
          setError(err.response?.data?.detail || 'This invitation link has expired or has already been used.')
        })
    } else {
      // For reset token, we consider it valid initially until submission or verify
      setTokenValid(true)
    }
  }, [token, isInvite])

  const validatePassword = () => {
    if (password.length < 8) return 'Password must be at least 8 characters long.'
    if (!/[A-Za-z]/.test(password)) return 'Password must contain at least one letter.'
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.'
    if (password !== confirmPassword) return 'Passwords do not match.'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validationErr = validatePassword()
    if (validationErr) {
      setError(validationErr)
      return
    }

    if (!token) return
    setLoading(true)

    try {
      if (isInvite) {
        await setInvitePassword(token, password)
      } else {
        await resetPasswordWithToken(token, password)
      }
      setSuccess(true)
      setTimeout(() => {
        navigate('/login', { replace: true })
      }, 2500)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to set password. Token may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#12284C] shadow-lg mb-4">
          <KeyRound className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--text-primary)] tracking-tight">
          {isInvite ? 'Activate Account' : 'Reset Password'}
        </h2>
        <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)] font-medium">
          {isInvite
            ? 'Set your password to access Mobileum Horizon portal'
            : 'Enter a strong new password for your account'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-[var(--bg-card)] py-8 px-6 sm:px-10 shadow-xl rounded-2xl border border-[var(--border)]">
          {tokenValid === false ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-500 mx-auto flex items-center justify-center mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">Link Invalid or Expired</h3>
              <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto mb-6">
                {error || 'This link is no longer valid. Please ask an administrator to send a new invitation or reset link.'}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all"
              >
                Return to Sign In
              </Link>
            </div>
          ) : success ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                Password Successfully Set!
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto mb-4">
                Your account is ready. Redirecting you to the sign in page...
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-[#12284C] text-white hover:bg-[#1a386b] transition-all"
              >
                Proceed to Sign In <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {userInfo && (
                <div className="p-3 rounded-xl bg-slate-500/10 border border-slate-500/20 text-xs text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">{userInfo.name || userInfo.email}</span>
                  <div className="text-[11px] text-[var(--text-muted)]">{userInfo.email}</div>
                </div>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1.5 uppercase tracking-wide">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--text-muted)]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#00A3AD] transition-all"
                  />
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Must be ≥ 8 chars with letters and numbers.
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1.5 uppercase tracking-wide">
                  Confirm Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--text-muted)]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full pl-9 pr-3 py-2.5 text-xs sm:text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#00A3AD] transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold text-white bg-[#12284C] hover:bg-[#1a386b] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#12284C] disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{isInvite ? 'Activate & Continue' : 'Save New Password'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

