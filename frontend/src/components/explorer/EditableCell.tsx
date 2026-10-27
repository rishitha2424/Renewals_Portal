import React, { useState, useEffect, useRef } from 'react'
import { Loader2, AlertCircle, Edit3, Check, X, FileText } from 'lucide-react'
import { DealAnnotationItem, setDealAnnotation, deleteDealAnnotation } from '@/api/client'
import showToast from '@/components/ui/Toast'

interface EditableCellProps {
  opportunityId: string
  columnKey: string
  columnLabel: string
  columnType: string
  dropdownOptions?: string[]
  currentAnnotation?: DealAnnotationItem
  isAdmin: boolean
  onAnnotationUpdated?: (updated: any) => void
}

export const EditableCell: React.FC<EditableCellProps> = ({
  opportunityId,
  columnKey,
  columnLabel,
  columnType,
  dropdownOptions = [],
  currentAnnotation,
  isAdmin,
  onAnnotationUpdated,
}) => {
  const isAutoColumn = columnType.startsWith('auto:')
  const initialVal = currentAnnotation?.value ?? ''
  const [val, setVal] = useState<string>(initialVal)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    setVal(currentAnnotation?.value ?? '')
  }, [currentAnnotation?.value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleSave = async (newVal: string) => {
    if (!isAdmin || isAutoColumn) return
    const trimmed = newVal.trim()
    if (trimmed === (currentAnnotation?.value ?? '').trim()) {
      setIsEditing(false)
      setShowPopover(false)
      return
    }

    setIsSaving(true)
    setErrorMsg(null)

    try {
      if (trimmed === '') {
        await deleteDealAnnotation(opportunityId, columnKey)
        setVal('')
        onAnnotationUpdated?.({
          opportunity_id_18: opportunityId,
          column_key: columnKey,
          value: null,
          version: (currentAnnotation?.version || 1) + 1,
        })
        showToast.success(`Cleared ${columnLabel}`)
      } else {
        const res = await setDealAnnotation(
          opportunityId,
          columnKey,
          trimmed,
          currentAnnotation?.version
        )
        setVal(trimmed)
        onAnnotationUpdated?.(res)
        showToast.success(`Updated ${columnLabel}`)
      }
      setIsEditing(false)
      setShowPopover(false)
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setErrorMsg('This value changed, reload')
        showToast.error('This value changed, reload')
      } else {
        const msg = err?.response?.data?.detail || 'Failed to save value'
        setErrorMsg(msg)
        showToast.error(msg)
      }
    } finally {
      setIsSaving(false)
    }
  }

  // 1. Read-only if user is not admin or auto-column
  if (!isAdmin || isAutoColumn) {
    if (columnType === 'checkbox') {
      const isChecked = val === 'true' || val === '1'
      return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${isChecked ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : 'text-slate-400'}`}>
          {isChecked ? 'Yes' : 'No'}
        </span>
      )
    }
    return (
      <span className="truncate block text-slate-700 dark:text-slate-300" title={val}>
        {val || <span className="text-slate-400 italic text-xs">—</span>}
      </span>
    )
  }

  // 2. Checkbox type (immediate toggle)
  if (columnType === 'checkbox') {
    const isChecked = val === 'true' || val === '1'
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={isChecked}
          disabled={isSaving}
          onChange={(e) => handleSave(e.target.checked ? 'true' : 'false')}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer h-4 w-4"
        />
        {isSaving && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
        {errorMsg && (
          <span title={errorMsg} className="text-rose-500 cursor-help">
            <AlertCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    )
  }

  // 3. Long text with popover
  if (columnType === 'long text') {
    return (
      <div className="relative">
        <div
          onClick={() => setShowPopover(true)}
          className="group flex items-center justify-between gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded transition-colors"
          title={val ? `Click to edit:\n${val}` : 'Click to add note'}
        >
          <span className="truncate block text-slate-700 dark:text-slate-300 text-xs max-w-[140px]">
            {val || <span className="text-slate-400 italic">—</span>}
          </span>
          <FileText className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 shrink-0 opacity-60 group-hover:opacity-100" />
        </div>

        {showPopover && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-4 w-full max-w-lg space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Edit {columnLabel}
                </h4>
                <button
                  type="button"
                  onClick={() => setShowPopover(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={`Enter ${columnLabel}...`}
                rows={5}
                maxLength={5000}
                className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-800 dark:text-white"
              />
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{val.length}/5,000 characters</span>
                {errorMsg && <span className="text-rose-500 font-medium">{errorMsg}</span>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPopover(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => handleSave(val)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // 4. Dropdown type
  if (columnType === 'dropdown') {
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <select
            ref={inputRef as any}
            value={val}
            disabled={isSaving}
            onChange={(e) => {
              setVal(e.target.value)
              handleSave(e.target.value)
            }}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setIsEditing(false)
            }}
            className="text-xs py-0.5 px-1 border border-blue-500 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none"
          >
            <option value="">(None)</option>
            {dropdownOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {isSaving && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
        </div>
      )
    }

    return (
      <div
        onClick={() => setIsEditing(true)}
        className="group cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30 p-1 rounded transition-colors flex items-center justify-between gap-1"
        title="Click to select"
      >
        <span className="truncate block text-slate-700 dark:text-slate-300 text-xs">
          {val || <span className="text-slate-400 italic">—</span>}
        </span>
        <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100" />
      </div>
    )
  }

  // 5. Text / Number / Date inline editing
  if (isEditing) {
    return (
      <div className="flex items-center gap-1 relative">
        <input
          ref={inputRef as any}
          type={columnType === 'number' ? 'number' : columnType === 'date' ? 'date' : 'text'}
          value={val}
          disabled={isSaving}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => handleSave(val)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave(val)
            if (e.key === 'Escape') {
              setVal(currentAnnotation?.value ?? '')
              setIsEditing(false)
            }
          }}
          className="w-full text-xs py-0.5 px-1 border border-blue-500 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none"
        />
        {isSaving && <Loader2 className="w-3 h-3 animate-spin text-blue-500 shrink-0" />}
        {errorMsg && (
          <span title={errorMsg} className="text-rose-500 shrink-0">
            <AlertCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className="group cursor-pointer hover:bg-blue-50/50 dark:hover:bg-blue-950/30 p-1 rounded transition-colors flex items-center justify-between gap-1"
      title="Click to edit inline"
    >
      <span className="truncate block text-slate-700 dark:text-slate-300 text-xs">
        {val || <span className="text-slate-400 italic">—</span>}
      </span>
      <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 shrink-0" />
    </div>
  )
}

export default EditableCell
