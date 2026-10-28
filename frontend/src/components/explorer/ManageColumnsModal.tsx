import React, { useState, useEffect, useCallback } from 'react'
import {
  X,
  Trash2,
  ArrowUp,
  ArrowDown,
  Edit2,
  Check,
  AlertTriangle,
  RotateCcw,
  Sliders,
  Archive,
  Loader2,
} from 'lucide-react'
import {
  CustomColumnItem,
  getCustomColumns,
  updateCustomColumn,
  deleteCustomColumn,
  restoreCustomColumn,
} from '@/api/client'
import showToast from '@/components/ui/Toast'
import { useAppStore } from '@/store/appStore'

interface ManageColumnsModalProps {
  isOpen: boolean
  onClose: () => void
  snapshotId?: string | null
  onColumnsChanged: () => void
}

export const ManageColumnsModal: React.FC<ManageColumnsModalProps> = ({
  isOpen,
  onClose,
  onColumnsChanged,
}) => {
  const isAdmin = useAppStore((s) => s.isAdmin)
  const [activeTab, setActiveTab] = useState<'active' | 'deleted'>('active')
  const [allColumns, setAllColumns] = useState<CustomColumnItem[]>([])
  const [loading, setLoading] = useState(false)

  // Editing column label
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  // Delete confirmation
  const [deletingCol, setDeletingCol] = useState<CustomColumnItem | null>(null)
  const [confirmNameInput, setConfirmNameInput] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Include deleted columns so we can show both active and deleted tabs
      const cols = await getCustomColumns(true)
      setAllColumns(cols)
    } catch {
      showToast.error('Failed to load columns data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      loadData()
      setDeletingCol(null)
      setConfirmNameInput('')
      setEditingId(null)
    }
  }, [isOpen, loadData])

  const activeColumns = allColumns.filter((c) => !c.is_deleted)
  const deletedColumns = allColumns.filter((c) => c.is_deleted)

  const handleMove = async (col: CustomColumnItem, direction: 'up' | 'down') => {
    const idx = activeColumns.findIndex((c) => c.id === col.id)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= activeColumns.length) return

    const otherCol = activeColumns[targetIdx]
    const currentOrder = col.sort_order
    const targetOrder = otherCol.sort_order

    try {
      await Promise.all([
        updateCustomColumn(col.id, { sort_order: targetOrder }),
        updateCustomColumn(otherCol.id, { sort_order: currentOrder }),
      ])
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to reorder columns')
    }
  }

  const handleSaveRename = async (colId: string) => {
    if (!editLabel.trim()) return
    try {
      await updateCustomColumn(colId, { label: editLabel.trim() })
      showToast.success('Column renamed')
      setEditingId(null)
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to rename column')
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingCol) return
    const valuesCount = deletingCol.values_count || 0
    if (valuesCount > 0 && confirmNameInput.trim() !== deletingCol.label.trim()) {
      showToast.error('Column name does not match')
      return
    }

    setIsDeleting(true)
    try {
      await deleteCustomColumn(deletingCol.id)
      showToast.success(`Column "${deletingCol.label}" deleted`)
      setDeletingCol(null)
      setConfirmNameInput('')
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to delete column')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRestore = async (col: CustomColumnItem) => {
    setIsRestoring(true)
    try {
      await restoreCustomColumn(col.id)
      showToast.success(`Column "${col.label}" restored`)
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to restore column')
    } finally {
      setIsRestoring(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Manage Custom Columns
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                View, rename, reorder, delete or restore app-created columns. Excel columns cannot be modified.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'active'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Active Columns ({activeColumns.length})
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('deleted')}
              className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
                activeTab === 'deleted'
                  ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Archive className="w-4 h-4" />
              Deleted Columns ({deletedColumns.length})
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading columns configuration...
            </div>
          ) : activeTab === 'active' ? (
            <div className="space-y-3">
              {activeColumns.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                  No active custom columns. Use "+ Add columns" in the toolbar to create one.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {activeColumns.map((col, idx) => (
                    <div
                      key={col.id}
                      className="p-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Reorder Buttons */}
                        {isAdmin && (
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMove(col, 'up')}
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === activeColumns.length - 1}
                              onClick={() => handleMove(col, 'down')}
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        {/* Column Title / Rename */}
                        {editingId === col.id ? (
                          <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                            <input
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className="text-xs px-2.5 py-1 border border-purple-500 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none flex-1"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(col.id)}
                              className="p-1 bg-purple-600 text-white rounded hover:bg-purple-700"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                {col.label}
                              </span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(col.id)
                                    setEditLabel(col.label)
                                  }}
                                  className="text-slate-400 hover:text-purple-600 p-0.5"
                                  title="Rename"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                              <span>Key: {col.key}</span>
                              {col.values_count !== undefined && (
                                <span className="text-slate-500 font-medium">
                                  • {col.values_count} entered value{col.values_count === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Column Type & Delete */}
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {col.type}
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingCol(col)
                              setConfirmNameInput('')
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                            title="Delete Column"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Deleted Columns Tab */
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Soft-deleted columns and their stored values are preserved in audit history and daily backups. You can restore them at any time.
              </p>
              {deletedColumns.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                  No deleted columns.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {deletedColumns.map((col) => (
                    <div
                      key={col.id}
                      className="p-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white line-through opacity-70">
                          {col.label}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Type: {col.type} • Key: {col.key}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={() => handleRestore(col)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg shadow-sm"
          >
            Done
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deletingCol && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-5 w-full max-w-md space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-50 dark:bg-rose-950 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Delete Column?
              </h4>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Delete column <strong>"{deletingCol.label}"</strong>? It has{' '}
              <strong className="text-rose-600 dark:text-rose-400">
                {deletingCol.values_count || 0} values
              </strong>{' '}
              entered in the app. The Excel data is not affected.
            </p>

            {(deletingCol.values_count || 0) > 0 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Type <strong className="text-slate-900 dark:text-white">{deletingCol.label}</strong> to confirm:
                </label>
                <input
                  type="text"
                  placeholder={deletingCol.label}
                  value={confirmNameInput}
                  onChange={(e) => setConfirmNameInput(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-rose-300 dark:border-rose-800 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeletingCol(null)
                  setConfirmNameInput('')
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  isDeleting ||
                  ((deletingCol.values_count || 0) > 0 &&
                    confirmNameInput.trim() !== deletingCol.label.trim())
                }
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Delete Column
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManageColumnsModal
