import React, { useState } from 'react'
import { X, Plus, Trash2, Columns, Loader2, Sparkles } from 'lucide-react'
import { bulkCreateCustomColumns } from '@/api/client'
import showToast from '@/components/ui/Toast'

interface AddColumnsModalProps {
  isOpen: boolean
  onClose: () => void
  onColumnsAdded: () => void
}

interface ColumnEntry {
  id: string
  label: string
  type: string
  optionsStr: string
}

const COLUMN_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'long text', label: 'Long Text (Popover / Notes)' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'dropdown', label: 'Dropdown Menu' },
  { value: 'checkbox', label: 'Checkbox (Yes / No)' },
  { value: 'auto: edited by', label: 'Auto: Edited By (Username)' },
  { value: 'auto: edited on', label: 'Auto: Edited On (Timestamp)' },
]

function inferTypeFromName(name: string): string {
  const n = name.trim().toLowerCase()
  if (n.endsWith('date') || n.includes('date')) return 'date'
  if (n.includes(' by') || n.endsWith(' by') || n.includes('user')) return 'auto: edited by'
  if (n.includes(' on') || n.endsWith(' on') || n.includes('updated')) return 'auto: edited on'
  if (n.includes('status') || n.includes('category') || n.includes('tier') || n.includes('level')) return 'dropdown'
  if (n.includes('amount') || n.includes('acv') || n.includes('count') || n.includes('score')) return 'number'
  if (n.includes('is ') || n.includes('flag') || n.includes('check')) return 'checkbox'
  if (n.includes('note') || n.includes('comment') || n.includes('details') || n.includes('description')) return 'text'
  return 'text'
}

export const AddColumnsModal: React.FC<AddColumnsModalProps> = ({
  isOpen,
  onClose,
  onColumnsAdded,
}) => {
  const [multiLineText, setMultiLineText] = useState('')
  const [entries, setEntries] = useState<ColumnEntry[]>([
    { id: '1', label: '', type: 'text', optionsStr: '' },
  ])
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  // When user pastes or types in multi-line textarea, sync to entries list
  const handleParseMultiLine = () => {
    const lines = multiLineText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    const newEntries: ColumnEntry[] = lines.map((line, idx) => ({
      id: `${Date.now()}_${idx}`,
      label: line,
      type: inferTypeFromName(line),
      optionsStr: inferTypeFromName(line) === 'dropdown' ? 'Open, In Progress, Closed' : '',
    }))
    setEntries(newEntries)
    setMultiLineText('')
  }

  const handleAddRow = () => {
    setEntries([
      ...entries,
      { id: `${Date.now()}`, label: '', type: 'text', optionsStr: '' },
    ])
  }

  const handleRemoveRow = (id: string) => {
    if (entries.length === 1) {
      setEntries([{ id: '1', label: '', type: 'text', optionsStr: '' }])
      return
    }
    setEntries(entries.filter((e) => e.id !== id))
  }

  const handleUpdateRow = (id: string, patch: Partial<ColumnEntry>) => {
    setEntries(
      entries.map((e) => {
        if (e.id !== id) return e
        const updated = { ...e, ...patch }
        // Auto-infer type if label changed and user hasn't explicitly set a custom type yet
        if (patch.label && (!e.label || e.type === 'text')) {
          const inferred = inferTypeFromName(patch.label)
          if (inferred !== 'text') {
            updated.type = inferred
          }
        }
        return updated
      })
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Filter valid entries with non-empty labels
    const valid = entries.filter((e) => e.label.trim().length > 0)
    if (valid.length === 0) {
      showToast.error('Please enter at least one column name')
      return
    }

    setSubmitting(true)
    try {
      const payload = valid.map((e) => {
        const item: { label: string; type: string; dropdown_options?: string[] } = {
          label: e.label.trim(),
          type: e.type,
        }
        if (e.type === 'dropdown') {
          item.dropdown_options = e.optionsStr
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        }
        return item
      })

      const created = await bulkCreateCustomColumns(payload)
      showToast.success(`Added ${created.length} column${created.length === 1 ? '' : 's'}`)
      onColumnsAdded()
      onClose()
    } catch (err: any) {
      showToast.error(err?.response?.data?.detail || 'Failed to add columns')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
              <Columns className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Add Custom Columns
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Type one or several column names (one per line) and pick a type for each.
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Multi-line quick paste */}
          <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-600" />
                Quick Paste / Type Multiple Column Names (one per line):
              </label>
              {multiLineText.trim() && (
                <button
                  type="button"
                  onClick={handleParseMultiLine}
                  className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-600 hover:bg-teal-700 text-white"
                >
                  Generate Rows
                </button>
              )}
            </div>
            <textarea
              rows={2}
              placeholder="e.g.&#10;Comment&#10;Comment By&#10;Comment Date&#10;Last Updated&#10;Comment Status"
              value={multiLineText}
              onChange={(e) => setMultiLineText(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
            />
          </div>

          {/* Columns Rows List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Columns to Add ({entries.filter((e) => e.label.trim()).length})
              </h4>
              <button
                type="button"
                onClick={handleAddRow}
                className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Row
              </button>
            </div>

            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {entries.map((entry, idx) => (
                <div
                  key={entry.id}
                  className="p-3 bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    <div className="sm:col-span-1 text-center font-mono text-xs text-slate-400">
                      #{idx + 1}
                    </div>

                    <div className="sm:col-span-6">
                      <input
                        type="text"
                        placeholder="Column name (e.g. Risk Level)"
                        value={entry.label}
                        onChange={(e) => handleUpdateRow(entry.id, { label: e.target.value })}
                        className="w-full text-xs px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                        autoFocus={idx === entries.length - 1 && entries.length === 1}
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <select
                        value={entry.type}
                        onChange={(e) => handleUpdateRow(entry.id, { type: e.target.value })}
                        className="w-full text-xs px-2.5 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        {COLUMN_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(entry.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {entry.type === 'dropdown' && (
                    <div className="pl-0 sm:pl-8 pt-1">
                      <input
                        type="text"
                        placeholder="Options, comma separated (e.g. High, Medium, Low)"
                        value={entry.optionsStr}
                        onChange={(e) => handleUpdateRow(entry.id, { optionsStr: e.target.value })}
                        className="w-full text-xs px-2.5 py-1 border border-slate-200 dark:border-slate-700 rounded-md bg-slate-50 dark:bg-slate-900/60 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer Submit */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || entries.every((e) => !e.label.trim())}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Columns
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddColumnsModal
