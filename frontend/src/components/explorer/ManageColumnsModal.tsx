import React, { useState, useEffect } from 'react'
import {
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Edit2,
  Check,
  AlertTriangle,
  FileSpreadsheet,
  Columns,
  Loader2,
  Sliders,
} from 'lucide-react'
import {
  CustomColumnItem,
  getCustomColumns,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  getDetectedHeaders,
} from '@/api/client'
import showToast from '@/components/ui/Toast'

interface ManageColumnsModalProps {
  isOpen: boolean
  onClose: () => void
  snapshotId?: string | null
  onColumnsChanged: () => void
}

const COLUMN_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'long text', label: 'Long Text (Popover / Notes)' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown Menu' },
  { value: 'checkbox', label: 'Checkbox (Yes / No)' },
  { value: 'auto: edited by', label: 'Auto: Edited By (Username)' },
  { value: 'auto: edited on', label: 'Auto: Edited On (Timestamp)' },
]

export const ManageColumnsModal: React.FC<ManageColumnsModalProps> = ({
  isOpen,
  onClose,
  snapshotId,
  onColumnsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'custom' | 'detected'>('custom')
  const [customColumns, setCustomColumns] = useState<CustomColumnItem[]>([])
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  // New column state
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('text')
  const [newOptionsStr, setNewOptionsStr] = useState('')
  const [creating, setCreating] = useState(false)

  // Editing column state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')

  // Delete confirmation
  const [deletingCol, setDeletingCol] = useState<CustomColumnItem | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen, snapshotId])

  const loadData = async () => {
    setLoading(true)
    try {
      const [cols, headers] = await Promise.all([
        getCustomColumns(false),
        getDetectedHeaders(snapshotId),
      ])
      setCustomColumns(cols)
      setDetectedHeaders(headers)
    } catch (err: any) {
      showToast.error('Failed to load columns data')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateColumn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newLabel.trim()) {
      showToast.error('Please enter a column name')
      return
    }

    setCreating(true)
    try {
      const opts =
        newType === 'dropdown'
          ? newOptionsStr
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined

      await createCustomColumn({
        label: newLabel.trim(),
        type: newType,
        dropdown_options: opts,
      })

      showToast.success(`Added column "${newLabel.trim()}"`)
      setNewLabel('')
      setNewType('text')
      setNewOptionsStr('')
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to create column')
    } finally {
      setCreating(false)
    }
  }

  const handleMakeEditableHeader = async (header: string, currentlyLinkedCol?: CustomColumnItem) => {
    if (currentlyLinkedCol) {
      // Unlink / Delete
      setDeletingCol(currentlyLinkedCol)
      return
    }

    // Infer type from header name
    const hLow = header.toLowerCase()
    let inferred = 'text'
    if (hLow.includes('date')) inferred = 'date'
    else if (hLow.includes('amount') || hLow.includes('acv') || hLow.includes('count') || hLow.includes('pct')) {
      inferred = 'number'
    }

    try {
      await createCustomColumn({
        label: header,
        type: inferred,
        source_header: header,
      })
      showToast.success(`Made "${header}" editable`)
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to link column')
    }
  }

  const handleMove = async (col: CustomColumnItem, direction: 'up' | 'down') => {
    const idx = customColumns.findIndex((c) => c.id === col.id)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= customColumns.length) return

    const otherCol = customColumns[targetIdx]
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
      showToast.error('Failed to reorder columns')
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
    try {
      await deleteCustomColumn(deletingCol.id)
      showToast.success(`Column "${deletingCol.label}" deleted`)
      setDeletingCol(null)
      await loadData()
      onColumnsChanged()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to delete column')
    }
  }

  if (!isOpen) return null

  // Header linkage map
  const linkedHeadersMap = new Map<string, CustomColumnItem>()
  for (const c of customColumns) {
    if (c.source_header) {
      linkedHeadersMap.set(c.source_header.trim().toLowerCase(), c)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <Columns className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Manage Custom Columns & Notes
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Configure editable notes and extra columns keyed to Opportunity ID.
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
            onClick={() => setActiveTab('custom')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'custom'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Custom Columns ({customColumns.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('detected')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-colors ${
              activeTab === 'detected'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Detected File Headers ({detectedHeaders.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading columns configuration...
            </div>
          ) : activeTab === 'custom' ? (
            <div className="space-y-6">
              {/* Add New Column Form */}
              <form
                onSubmit={handleCreateColumn}
                className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3"
              >
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Add New Column
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5 space-y-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Column Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Deal Notes, Status, Risk Tag..."
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full text-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="md:col-span-4 space-y-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Type
                    </label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      className="w-full text-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {COLUMN_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <button
                      type="submit"
                      disabled={creating || !newLabel.trim()}
                      className="w-full py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Add Column
                    </button>
                  </div>
                </div>

                {newType === 'dropdown' && (
                  <div className="space-y-1 pt-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      Dropdown Options (comma-separated)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. High, Medium, Low, Needs Follow-up"
                      value={newOptionsStr}
                      onChange={(e) => setNewOptionsStr(e.target.value)}
                      className="w-full text-xs px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </form>

              {/* Columns Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Active Custom Columns ({customColumns.length})
                </h4>

                {customColumns.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs italic bg-slate-50 dark:bg-slate-800/30 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                    No custom columns configured yet. Add one above or make an uploaded file header editable.
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {customColumns.map((col, idx) => (
                      <div
                        key={col.id}
                        className="p-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Reorder Buttons */}
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
                              disabled={idx === customColumns.length - 1}
                              onClick={() => handleMove(col, 'down')}
                              className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Column Title / Rename */}
                          {editingId === col.id ? (
                            <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                              <input
                                type="text"
                                value={editLabel}
                                onChange={(e) => setEditLabel(e.target.value)}
                                className="text-xs px-2 py-1 border border-blue-500 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRename(col.id)}
                                className="p-1 bg-blue-600 text-white rounded hover:bg-blue-700"
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
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(col.id)
                                    setEditLabel(col.label)
                                  }}
                                  className="text-slate-400 hover:text-blue-500 p-0.5"
                                  title="Rename"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                <span>Key: {col.key}</span>
                                {col.source_header && (
                                  <span className="text-blue-500">
                                    • Linked to Excel: "{col.source_header}"
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
                          <button
                            type="button"
                            onClick={() => setDeletingCol(col)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                            title="Delete Column"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Detected Headers Tab */
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tick "Make editable" to turn an Excel column into an editable custom column. Original file values will load as defaults, and your app edits will be preserved across future uploads.
              </p>
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto bg-white dark:bg-slate-900">
                {detectedHeaders.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs italic">
                    No headers detected in uploaded file.
                  </div>
                ) : (
                  detectedHeaders.map((header) => {
                    const linkedCol = linkedHeadersMap.get(header.trim().toLowerCase())
                    const isEditable = Boolean(linkedCol)

                    return (
                      <div
                        key={header}
                        className="px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="min-w-0 flex-1 pr-4">
                          <span className="text-xs font-medium text-slate-900 dark:text-white block truncate">
                            {header}
                          </span>
                          {isEditable && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                              <Check className="w-3 h-3" /> Editable in app (Key: {linkedCol?.key})
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleMakeEditableHeader(header, linkedCol)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                            isEditable
                              ? 'bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-400'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-400'
                          }`}
                        >
                          {isEditable ? 'Remove Editable' : 'Make Editable'}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg shadow-sm"
          >
            Done
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deletingCol && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-50 dark:bg-rose-950 rounded-lg">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Delete Column?
              </h4>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900 dark:text-white">"{deletingCol.label}"</strong>? This will soft-delete the column and its values, and record this action in the audit log.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingCol(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManageColumnsModal
