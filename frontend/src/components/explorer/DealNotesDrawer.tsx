import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  FileText,
  Clock,
  User,
  History,
  Check,
  Trash2,
  AlertTriangle,
  Loader2,
  Calendar,
  Hash,
  List,
  CheckSquare,
  Shield,
  Save,
  RotateCcw,
} from 'lucide-react'
import {
  CustomColumnItem,
  DealAnnotationItem,
  AnnotationAuditItem,
  getDealAnnotations,
  setDealAnnotation,
  deleteDealAnnotation,
  getDealAudit,
} from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { formatACV, formatDate } from '@/utils/format'
import showToast from '@/components/ui/Toast'

interface DealNotesDrawerProps {
  isOpen: boolean
  onClose: () => void
  deal: Record<string, any> | null
  columns: CustomColumnItem[]
  onAnnotationsChanged?: () => void
}

export const DealNotesDrawer: React.FC<DealNotesDrawerProps> = ({
  isOpen,
  onClose,
  deal,
  columns,
  onAnnotationsChanged,
}) => {
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [activeTab, setActiveTab] = useState<'notes' | 'audit'>('notes')
  
  // Extract Opportunity ID 18 Digit
  const oppId = deal ? (deal['Opportunity ID 18 Digit'] || deal._opp_id_18 || deal.opportunity_id_18 || '') : ''
  const oppName = deal ? (deal['Opportunity Name'] || deal.opportunity_name || 'Opportunity') : ''
  const accountName = deal ? (deal['Account Name'] || deal.account_name || '') : ''
  const acv = deal ? (deal['ACV'] || deal.acv) : null

  // Fetch deal annotations
  const {
    data: annotationsMap = {},
    isLoading: annotsLoading,
    refetch: refetchAnnots,
  } = useQuery<Record<string, DealAnnotationItem>>({
    queryKey: ['deal-annotations', oppId],
    queryFn: () => (oppId ? getDealAnnotations(oppId) : Promise.resolve({})),
    enabled: isOpen && !!oppId,
  })

  // Fetch deal audit history
  const {
    data: auditLog = [],
    isLoading: auditLoading,
    refetch: refetchAudit,
  } = useQuery<AnnotationAuditItem[]>({
    queryKey: ['deal-audit', oppId],
    queryFn: () => (oppId ? getDealAudit(oppId) : Promise.resolve([])),
    enabled: isOpen && !!oppId && activeTab === 'audit',
  })

  // State for in-drawer editing
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [confirmClearCol, setConfirmClearCol] = useState<CustomColumnItem | null>(null)

  // Sync draft values when annotations load
  useEffect(() => {
    if (deal && columns.length > 0) {
      const initial: Record<string, string> = {}
      columns.forEach((col) => {
        // Annotation directly from API or from deal record
        const directAnnot = annotationsMap[col.key]?.value
        const dealVal = deal[col.key] || deal[col.label]
        initial[col.key] = directAnnot !== undefined ? String(directAnnot ?? '') : (dealVal !== undefined ? String(dealVal ?? '') : '')
      })
      setDraftValues(initial)
    }
  }, [deal, columns, annotationsMap])

  if (!isOpen || !deal) return null

  const handleSaveField = async (col: CustomColumnItem) => {
    if (!isAdmin || col.type.startsWith('auto:')) return
    const rawVal = draftValues[col.key] ?? ''
    const currentAnnot = annotationsMap[col.key]
    const trimmed = rawVal.trim()

    // If clearing long text, prompt confirmation first
    if (trimmed === '' && col.type === 'long text' && currentAnnot?.value) {
      setConfirmClearCol(col)
      return
    }

    setSavingKey(col.key)
    try {
      if (trimmed === '') {
        await deleteDealAnnotation(oppId, col.key)
        showToast.success(`Cleared ${col.label}`)
      } else {
        await setDealAnnotation(
          oppId,
          col.key,
          trimmed,
          currentAnnot?.version
        )
        showToast.success(`Saved ${col.label}`)
      }
      refetchAnnots()
      if (activeTab === 'audit') refetchAudit()
      onAnnotationsChanged?.()
    } catch (err: any) {
      if (err?.response?.status === 409) {
        showToast.error('This value changed, reload')
        refetchAnnots()
      } else {
        showToast.error(err?.response?.data?.detail || 'Failed to save field')
      }
    } finally {
      setSavingKey(null)
    }
  }

  const handleConfirmClear = async () => {
    if (!confirmClearCol) return
    const col = confirmClearCol
    setSavingKey(col.key)
    try {
      await deleteDealAnnotation(oppId, col.key)
      setDraftValues((prev) => ({ ...prev, [col.key]: '' }))
      showToast.success(`Cleared ${col.label}`)
      refetchAnnots()
      if (activeTab === 'audit') refetchAudit()
      onAnnotationsChanged?.()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to clear field')
    } finally {
      setSavingKey(null)
      setConfirmClearCol(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      id="deal-notes-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-full sm:max-w-xl md:max-w-2xl bg-[var(--bg-card)] h-full shadow-2xl flex flex-col border-l border-[var(--border)] animate-in slide-in-from-right duration-200"
        id="deal-notes-drawer"
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20">
                Deal Notes & Extra Columns
              </span>
              {isAdmin ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Admin Editing
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                  Read Only
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-black text-[var(--text-primary)] truncate" title={oppName}>
              {oppName}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)] mt-1">
              {accountName && (
                <span>
                  Account: <strong className="text-[var(--text-secondary)]">{accountName}</strong>
                </span>
              )}
              <span>
                Opp ID: <strong className="font-mono text-[var(--text-secondary)]">{oppId}</strong>
              </span>
              {acv != null && (
                <span>
                  ACV: <strong className="text-[#00A3AD]">{formatACV(acv)}</strong>
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            id="deal-notes-drawer-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-[var(--border)] px-4 bg-[var(--bg-card)]">
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'notes'
                ? 'border-[#00A3AD] text-[#00A3AD]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            id="tab-deal-custom-values"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Custom Columns & Notes ({columns.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('audit')
              refetchAudit()
            }}
            className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'audit'
                ? 'border-[#00A3AD] text-[#00A3AD]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            id="tab-deal-audit-history"
          >
            <History className="w-3.5 h-3.5" />
            <span>Audit History {auditLog.length > 0 && `(${auditLog.length})`}</span>
          </button>
        </div>

        {/* Tab 1: Custom Values & Notes */}
        {activeTab === 'notes' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {columns.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                <FileText className="w-8 h-8 mx-auto opacity-30 mb-2" />
                <p>No custom columns created yet.</p>
                {isAdmin && (
                  <p className="mt-1 text-[var(--text-secondary)]">
                    Use "Manage Columns" in Data Explorer to add editable notes or custom fields.
                  </p>
                )}
              </div>
            ) : (
              columns.map((col) => {
                const isAuto = col.type.startsWith('auto:')
                const isSaving = savingKey === col.key
                const currentAnnot = annotationsMap[col.key]
                const val = draftValues[col.key] ?? ''
                const hasChanged = val !== (currentAnnot?.value ?? '')

                return (
                  <div
                    key={col.id || col.key}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-[var(--text-primary)]">
                          {col.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]">
                          {col.type}
                        </span>
                        {col.source_header && (
                          <span className="text-[10px] text-teal-600 dark:text-teal-400">
                            (linked to Excel: {col.source_header})
                          </span>
                        )}
                      </div>

                      {/* Last updated info if available */}
                      {currentAnnot && (
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {currentAnnot.source === 'excel' ? 'From Excel' : 'Edited in App'}
                          {currentAnnot.updated_by && ` by ${currentAnnot.updated_by}`}
                        </div>
                      )}
                    </div>

                    {/* Editor or Read-Only display */}
                    {!isAdmin || isAuto ? (
                      <div className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text-primary)] min-h-[36px] flex items-center">
                        {val ? (
                          col.type === 'checkbox' ? (
                            <span>{val === 'true' || val === '1' ? '☑ Yes' : '☐ No'}</span>
                          ) : (
                            <span className="whitespace-pre-wrap">{val}</span>
                          )
                        ) : (
                          <span className="text-[var(--text-muted)] italic opacity-60">No value</span>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {col.type === 'long text' ? (
                          <div className="space-y-1">
                            <textarea
                              rows={4}
                              value={val}
                              maxLength={5000}
                              onChange={(e) =>
                                setDraftValues((prev) => ({ ...prev, [col.key]: e.target.value }))
                              }
                              placeholder={`Enter ${col.label.toLowerCase()} (up to 5,000 characters)...`}
                              className="w-full p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD] resize-y"
                            />
                            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] px-1">
                              <span>Markdown or plain text</span>
                              <span>{val.length} / 5,000 chars</span>
                            </div>
                          </div>
                        ) : col.type === 'dropdown' ? (
                          <select
                            value={val}
                            onChange={(e) =>
                              setDraftValues((prev) => ({ ...prev, [col.key]: e.target.value }))
                            }
                            className="w-full p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
                          >
                            <option value="">— Select an option —</option>
                            {(col.dropdown_options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : col.type === 'checkbox' ? (
                          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--text-primary)]">
                            <input
                              type="checkbox"
                              checked={val === 'true' || val === '1'}
                              onChange={(e) =>
                                setDraftValues((prev) => ({
                                  ...prev,
                                  [col.key]: e.target.checked ? 'true' : 'false',
                                }))
                              }
                              className="w-4 h-4 rounded text-teal-600 focus:ring-0"
                            />
                            <span>{col.label} active</span>
                          </label>
                        ) : col.type === 'date' ? (
                          <input
                            type="date"
                            value={val}
                            onChange={(e) =>
                              setDraftValues((prev) => ({ ...prev, [col.key]: e.target.value }))
                            }
                            className="w-full p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
                          />
                        ) : col.type === 'number' ? (
                          <input
                            type="number"
                            step="any"
                            value={val}
                            onChange={(e) =>
                              setDraftValues((prev) => ({ ...prev, [col.key]: e.target.value }))
                            }
                            placeholder="Enter numeric value..."
                            className="w-full p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
                          />
                        ) : (
                          <input
                            type="text"
                            value={val}
                            maxLength={5000}
                            onChange={(e) =>
                              setDraftValues((prev) => ({ ...prev, [col.key]: e.target.value }))
                            }
                            placeholder={`Enter ${col.label.toLowerCase()}...`}
                            className="w-full p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[#00A3AD]"
                          />
                        )}

                        {/* Save & Clear Controls */}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          {val && (
                            <button
                              type="button"
                              onClick={() => {
                                if (col.type === 'long text') {
                                  setConfirmClearCol(col)
                                } else {
                                  setDraftValues((prev) => ({ ...prev, [col.key]: '' }))
                                  handleSaveField(col)
                                }
                              }}
                              disabled={isSaving}
                              className="px-2.5 py-1 text-xs rounded border border-[var(--border)] bg-[var(--bg-card)] hover:bg-rose-500/10 hover:text-rose-600 text-[var(--text-muted)] transition-colors flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Clear</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleSaveField(col)}
                            disabled={isSaving || !hasChanged}
                            className="px-3 py-1 text-xs font-semibold rounded bg-[#00A3AD] text-white hover:bg-[#008f98] disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs"
                          >
                            {isSaving ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3" />
                            )}
                            <span>Save</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Tab 2: Audit History */}
        {activeTab === 'audit' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
            {auditLoading ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)] flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#00A3AD]" />
                <span>Loading audit history...</span>
              </div>
            ) : auditLog.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--text-muted)]">
                <History className="w-8 h-8 mx-auto opacity-30 mb-2" />
                <p>No changes recorded yet for this deal.</p>
              </div>
            ) : (
              <div className="relative border-l-2 border-[var(--border)] ml-3 space-y-4 py-2">
                {auditLog.map((item: AnnotationAuditItem) => {
                  const actionColor =
                    item.action === 'create'
                      ? 'bg-emerald-500'
                      : item.action === 'delete'
                      ? 'bg-rose-500'
                      : item.action === 'import'
                      ? 'bg-teal-500'
                      : 'bg-blue-500'

                  return (
                    <div key={item.id} className="relative pl-6 text-xs group">
                      {/* Timeline dot */}
                      <span
                        className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${actionColor}`}
                      />
                      <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[var(--text-primary)]">
                            {item.column_key ? item.column_key.replace(/_/g, ' ') : 'Deal'}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {(item.created_at || item.timestamp)
                              ? new Date(item.created_at || item.timestamp || '').toLocaleString()
                              : ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span className="uppercase font-semibold text-[10px] px-1.5 py-0.2 rounded bg-[var(--bg-card)] border border-[var(--border)]">
                            {item.action}
                          </span>
                          <span>by {item.changed_by || item.user_id || 'system'}</span>
                        </div>

                        {/* Old -> New diff */}
                        <div className="pt-1 text-[11px] font-mono break-all">
                          {item.old_value != null && (
                            <div className="text-rose-600 dark:text-rose-400 line-through">
                              - {item.old_value || '""'}
                            </div>
                          )}
                          {item.new_value != null && (
                            <div className="text-emerald-600 dark:text-emerald-400">
                              + {item.new_value || '""'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Long Text Clear Confirmation Modal */}
        {confirmClearCol && (
          <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[var(--bg-card)] rounded-2xl p-5 border border-[var(--border)] shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 text-rose-600">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="font-bold text-sm text-[var(--text-primary)]">
                  Clear {confirmClearCol.label}?
                </h3>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Are you sure you want to delete this value? This long text note will be removed and
                logged in the audit history.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearCol(null)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmClear}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 shadow-xs"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DealNotesDrawer
