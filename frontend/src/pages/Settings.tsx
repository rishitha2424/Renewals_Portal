import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, AlertTriangle, CheckCircle2, Save, Lock, RefreshCw, KeyRound, Info } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { getAdminStatus, getSystemSettings, updateSystemSetting } from '@/api/client'
import { showToast } from '@/components/ui/Toast'

export default function Settings() {
  const queryClient = useQueryClient()
  const { isAdmin } = useAppStore()

  // 1. Fetch admin status and security checks
  const { data: adminStatus, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['admin-status'],
    queryFn: () => getAdminStatus(),
  })

  // 2. Fetch system settings
  const { data: systemSettings, isLoading: settingsLoading, refetch: refetchSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => getSystemSettings(),
  })

  const [editValues, setEditValues] = useState<Record<string, string>>({})

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      updateSystemSetting(key, value),
    onSuccess: (_, variables) => {
      showToast.success('Setting Saved', `Updated ${variables.key} successfully.`)
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    },
    onError: (err: any) => {
      showToast.error('Save Failed', err.response?.data?.detail || 'Could not update setting.')
    },
  })

  const securityChecks = adminStatus?.security_checks || []
  const hasWarnings = securityChecks.some((c: any) => c.status === 'warning')

  const handleSettingChange = (key: string, val: string) => {
    setEditValues((prev) => ({ ...prev, [key]: val }))
  }

  const handleSaveSetting = (key: string) => {
    const val = editValues[key] !== undefined ? editValues[key] : systemSettings?.settings?.[key]?.value
    if (val !== undefined) {
      updateMutation.mutate({ key, value: typeof val === 'object' ? JSON.stringify(val) : String(val) })
    }
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 py-8 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">System Settings</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Configure global business rules, security posture, and application defaults.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              Administrator Mode Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-500/10 text-slate-500 border border-slate-500/20 text-xs font-medium">
              <Lock className="w-4 h-4" />
              Read-Only (Sign in as admin to edit)
            </span>
          )}
        </div>
      </div>

      {/* ── SECURITY STATUS CARD (Admin-only) ────────────────────────────── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]/40 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Security Status</h2>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-sm tabular-nums ${
                  hasWarnings
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                }`}
              >
                {hasWarnings
                  ? `${securityChecks.filter((c: any) => c.status === 'warning').length} checks require attention`
                  : 'All security checks passed'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => refetchStatus()}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-check
            </button>
          </div>

          <div className="p-5 divide-y divide-[var(--border)]">
            {statusLoading ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">Verifying security configuration...</div>
            ) : securityChecks.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">No security checks available.</div>
            ) : (
              securityChecks.map((check: any) => {
                const isOk = check.status === 'ok'
                return (
                  <div key={check.id} className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {isOk ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--text-primary)]">{check.name}</span>
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                              isOk
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isOk ? 'Passing' : 'Action Recommended'}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{check.message}</p>
                        {!isOk && check.fix && (
                          <div className="mt-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 bg-amber-500/10 rounded px-2 py-1 border border-amber-500/20 inline-block">
                            Fix: {check.fix}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── SYSTEM SETTINGS CARD ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)]/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[var(--text-secondary)]" />
            <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Application Rules & Defaults</h2>
          </div>
          <button
            type="button"
            onClick={() => refetchSettings()}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="p-5 space-y-5 divide-y divide-[var(--border)]">
          {settingsLoading ? (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">Loading system settings...</div>
          ) : !systemSettings?.settings ? (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">No settings found.</div>
          ) : (
            Object.entries(systemSettings.settings).map(([key, setting]: [string, any]) => {
              const currentVal = editValues[key] !== undefined ? editValues[key] : (typeof setting.value === 'object' ? JSON.stringify(setting.value) : String(setting.value ?? ''))
              const isDirty = editValues[key] !== undefined && editValues[key] !== (typeof setting.value === 'object' ? JSON.stringify(setting.value) : String(setting.value ?? ''))

              return (
                <div key={key} className="pt-4 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="md:w-1/2">
                    <label className="text-xs font-bold text-[var(--text-primary)] block">
                      {key.replace(/_/g, ' ').toUpperCase()}
                    </label>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">
                      {setting.description || 'Configurable system rule.'}
                    </p>
                  </div>

                  <div className="md:w-1/2 flex items-center gap-2">
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={currentVal}
                      onChange={(e) => handleSettingChange(key, e.target.value)}
                      className="flex-1 h-9 px-3 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)] font-mono outline-none disabled:opacity-70 disabled:cursor-not-allowed"
                    />
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={!isDirty || updateMutation.isPending}
                        onClick={() => handleSaveSetting(key)}
                        className={`h-9 px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                          isDirty
                            ? 'bg-[var(--brand-teal)] text-white hover:opacity-90 cursor-pointer shadow-xs'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

