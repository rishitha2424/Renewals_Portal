import React, { useState, useEffect, useMemo } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload as UploadIcon,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowRight,
  Database,
  Layers,
  Sparkles,
  Info,
  Calendar,
  ShieldCheck,
  RefreshCw,
  FileCheck2,
  AlertCircle,
  HelpCircle,
  CheckSquare,
  Square,
  Repeat,
} from 'lucide-react'
import { validateUpload, commitUpload, getUploadHistory, getSnapshotChecks, deleteSnapshot } from '@/api/client'
import { formatCurrency, formatNumber, formatDate } from '@/utils/format'
import { showToast } from '@/components/ui/Toast'
import { useAppStore } from '@/store/appStore'

export type FileSlot = 'comparison_tool' | 'fiscal_2026' | 'fiscal_2027' | 'fiscal_q4' | string

interface UploadSlotState {
  file: File | null
  name: string
  size: number
}

const SLOT_DEFINITIONS: Record<
  FileSlot,
  {
    key: FileSlot
    title: string
    subtitle: string
    expected: string
    required: boolean
    badgeColor: string
  }
> = {
  comparison_tool: {
    key: 'comparison_tool',
    title: 'Renewal Comparison Tool',
    subtitle: 'Mandatory · All sales types',
    expected: "Sheets: 'today' & 'yesterday'",
    required: true,
    badgeColor: 'teal',
  },
  fiscal_2026: {
    key: 'fiscal_2026',
    title: 'Renewals Summary - Fiscal 2026',
    subtitle: 'Optional · Renewals only',
    expected: "Sheets: 'Today_Data', 'Yesterday', 'Lastweek'",
    required: false,
    badgeColor: 'blue',
  },
  fiscal_2027: {
    key: 'fiscal_2027',
    title: 'Renewals Summary - Fiscal 2027',
    subtitle: 'Optional · Renewals only',
    expected: 'Closing Year = 2027',
    required: false,
    badgeColor: 'purple',
  },
  fiscal_q4: {
    key: 'fiscal_q4',
    title: 'Renewals Summary - Fiscal Q4',
    subtitle: 'Optional · Renewals only',
    expected: 'Fiscal Period = Q4-2026',
    required: false,
    badgeColor: 'amber',
  },
}

function formatLocalDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function getAutoYesterdayDate(asOfStr: string): string {
  if (!asOfStr) return ''
  const d = new Date(asOfStr + 'T00:00:00')
  const day = d.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  let daysBack = 1
  if (day === 1) {
    daysBack = 3 // Monday -> Friday
  } else if (day === 0) {
    daysBack = 2 // Sunday -> Friday
  } else if (day === 6) {
    daysBack = 1 // Saturday -> Friday
  }
  const y = new Date(d)
  y.setDate(d.getDate() - daysBack)
  return formatLocalDate(y)
}

function detectSlotForFile(filename: string): FileSlot {
  const fn = filename.toLowerCase()
  if (fn.includes('comparison')) return 'comparison_tool'
  if (fn.includes('q4') || fn.includes('fiscal q4')) return 'fiscal_q4'
  if (fn.includes('2027') || fn.includes('fiscal 2027')) return 'fiscal_2027'
  if (fn.includes('2026') || fn.includes('fiscal 2026')) return 'fiscal_2026'
  return 'comparison_tool'
}

export default function Upload() {
  const qc = useQueryClient()

  // Dates
  const [dataAsOf, setDataAsOf] = useState(formatLocalDate(new Date()))
  const [yesterdayDate, setYesterdayDate] = useState(getAutoYesterdayDate(formatLocalDate(new Date())))
  const [manualYesterdayEdited, setManualYesterdayEdited] = useState(false)

  // 4 Slots
  const [slots, setSlots] = useState<Record<FileSlot, UploadSlotState>>({
    comparison_tool: { file: null, name: '', size: 0 },
    fiscal_2026: { file: null, name: '', size: 0 },
    fiscal_2027: { file: null, name: '', size: 0 },
    fiscal_q4: { file: null, name: '', size: 0 },
  })

  // Validation / Preview state
  const [isValidating, setIsValidating] = useState(false)
  const [previewData, setPreviewData] = useState<any>(null)
  const [isCommitting, setIsCommitting] = useState(false)
  
  // Admin state from appStore (Addendum D)
  const { isAdmin } = useAppStore()

  // Reconciliation checks modal state (Addendum B)
  const [selectedHistoryCheckSnap, setSelectedHistoryCheckSnap] = useState<any | null>(null)
  const [checksModalData, setChecksModalData] = useState<any[] | null>(null)
  const [loadingChecks, setLoadingChecks] = useState(false)

  // Backfill and replace safety states
  const [makeActiveChecked, setMakeActiveChecked] = useState(true)
  const [userConfirmReplace, setUserConfirmReplace] = useState(false)

  // Auto-fill yesterday date when dataAsOf changes (unless user manually modified)
  useEffect(() => {
    if (!manualYesterdayEdited) {
      setYesterdayDate(getAutoYesterdayDate(dataAsOf))
    }
  }, [dataAsOf, manualYesterdayEdited])

  // Weekday and quarter calculation
  const asOfDateObj = useMemo(() => new Date(dataAsOf + 'T00:00:00'), [dataAsOf])
  const weekdayName = useMemo(() => {
    return asOfDateObj.toLocaleDateString('en-US', { weekday: 'long' })
  }, [asOfDateObj])
  const isWeekend = asOfDateObj.getDay() === 0 || asOfDateObj.getDay() === 6
  const isMonday = asOfDateObj.getDay() === 1

  // Last 10 uploads query
  const { data: uploadHistory = [], refetch: refetchHistory } = useQuery({
    queryKey: ['uploadHistory'],
    queryFn: getUploadHistory,
  })

  // Detect whether dataAsOf is older than the newest date in history (out-of-order backfill)
  const isBackfillDate = useMemo(() => {
    if (!uploadHistory || uploadHistory.length === 0) return false
    const latestHistoryDate = uploadHistory[0]?.snapshot_date
    if (!latestHistoryDate) return false
    return dataAsOf < latestHistoryDate
  }, [dataAsOf, uploadHistory])

  // Auto-set default makeActive checkbox based on backfill check
  useEffect(() => {
    setMakeActiveChecked(!isBackfillDate)
  }, [isBackfillDate])

  // Content / Name based auto-assignment for multi-file drop
  const assignFileToSlot = (file: File) => {
    const targetSlot = detectSlotForFile(file.name)
    setSlots((prev) => ({
      ...prev,
      [targetSlot]: { file, name: file.name, size: file.size },
    }))
  }

  // Multi-dropzone for entire batch
  const { getRootProps: getBatchRootProps, getInputProps: getBatchInputProps, isDragActive: isBatchDragActive } =
    useDropzone({
      accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
      onDrop: (acceptedFiles) => {
        acceptedFiles.forEach((f) => assignFileToSlot(f))
        setPreviewData(null)
        setUserConfirmReplace(false)
      },
    })

  // Handle single slot drop
  const handleSlotDrop = (slot: FileSlot, file: File) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { file, name: file.name, size: file.size },
    }))
    setPreviewData(null)
    setUserConfirmReplace(false)
  }

  const handleClearSlot = (slot: FileSlot) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { file: null, name: '', size: 0 },
    }))
    setPreviewData(null)
    setUserConfirmReplace(false)
  }

  const handleMoveSlot = (currentSlot: FileSlot, targetSlot: FileSlot) => {
    if (currentSlot === targetSlot) return
    const fileState = slots[currentSlot]
    setSlots((prev) => ({
      ...prev,
      [currentSlot]: { file: null, name: '', size: 0 },
      [targetSlot]: fileState,
    }))
    setPreviewData(null)
    setUserConfirmReplace(false)
  }

  // Validation Call
  const handleValidate = async () => {
    if (!slots.comparison_tool.file) {
      showToast.error('Validation error', 'Renewal Comparison Tool is required.')
      return
    }

    setIsValidating(true)
    setPreviewData(null)
    setUserConfirmReplace(false)

    try {
      const formData = new FormData()
      formData.append('data_as_of_date', dataAsOf)
      formData.append('yesterday_date', yesterdayDate)
      formData.append('comparison_tool', slots.comparison_tool.file)

      if (slots.fiscal_2026.file) {
        formData.append('fiscal_2026', slots.fiscal_2026.file)
      }
      if (slots.fiscal_2027.file) {
        formData.append('fiscal_2027', slots.fiscal_2027.file)
      }
      if (slots.fiscal_q4.file) {
        formData.append('fiscal_q4', slots.fiscal_q4.file)
      }

      const res = await validateUpload(formData)
      setPreviewData(res)

      if (res.can_commit) {
        showToast.success('Validation complete', 'Files parsed cleanly. Review the preview below.')
      } else {
        showToast.error('Validation failed', 'One or more blocking errors were found.')
      }
    } catch (err: any) {
      showToast.error('Validation error', err?.response?.data?.detail || err.message)
    } finally {
      setIsValidating(false)
    }
  }

  // Commit Call
  const handleCommit = async (replace = false) => {
    if (!previewData?.session_id) return
    setIsCommitting(true)
    try {
      const res = await commitUpload(previewData.session_id, replace, makeActiveChecked)
      showToast.success(
        'Snapshot committed',
        `Saved ${res.row_count} total (${res.active_row_count} active) opportunities. Active today: ${
          res.is_active_today ? 'Yes' : 'No'
        }.`
      )
      setPreviewData(null)
      setUserConfirmReplace(false)
      // Reset slots
      setSlots({
        comparison_tool: { file: null, name: '', size: 0 },
        fiscal_2026: { file: null, name: '', size: 0 },
        fiscal_2027: { file: null, name: '', size: 0 },
        fiscal_q4: { file: null, name: '', size: 0 },
      })
      qc.invalidateQueries()
      refetchHistory()
    } catch (err: any) {
      showToast.error('Commit failed', err?.response?.data?.detail || err.message)
    } finally {
      setIsCommitting(false)
    }
  }

  const suggestedDateMismatch =
    previewData?.suggested_date && previewData.suggested_date !== dataAsOf

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
            <UploadIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)] tracking-tight">
              Daily 4-File Upload & Ingestion
            </h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              Multi-scope ingestion pipeline with atomic commit, pre-validation preview, and duplicate detection.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Date Configuration Strip */}
      <div className="card p-5 border border-[var(--border)] shadow-sm space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
          <Calendar className="w-4 h-4 text-teal-500" />
          Snapshot Date & Resolution Parameters
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Data as of Date</label>
              <span className="text-[11px] font-bold text-teal-600 dark:text-teal-400">
                {weekdayName}
              </span>
            </div>
            <input
              type="date"
              value={dataAsOf}
              onChange={(e) => {
                setDataAsOf(e.target.value)
                setManualYesterdayEdited(false)
                setPreviewData(null)
              }}
              className="mt-1.5 w-full px-3 py-2 rounded-xl text-sm border outline-none bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-primary)] focus:ring-2 focus:ring-teal-500"
              id="upload-data-as-of"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[var(--text-secondary)]">
                Yesterday Date (Prev Working Day)
              </label>
              {manualYesterdayEdited && (
                <button
                  type="button"
                  onClick={() => {
                    setManualYesterdayEdited(false)
                    setYesterdayDate(getAutoYesterdayDate(dataAsOf))
                    setPreviewData(null)
                  }}
                  className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
                >
                  Reset Auto
                </button>
              )}
            </div>
            <input
              type="date"
              value={yesterdayDate}
              onChange={(e) => {
                setYesterdayDate(e.target.value)
                setManualYesterdayEdited(true)
                setPreviewData(null)
              }}
              className="mt-1.5 w-full px-3 py-2 rounded-xl text-sm border outline-none bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-primary)] focus:ring-2 focus:ring-teal-500"
              id="upload-yesterday-date"
            />
          </div>

          <div className="text-xs text-[var(--text-muted)] p-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            {isMonday && (
              <span className="font-semibold text-teal-600 dark:text-teal-400 block mb-0.5">
                ⚡ Monday rule: auto-set to Friday 3 days earlier
              </span>
            )}
            {isWeekend && (
              <span className="font-semibold text-amber-500 block mb-0.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Weekend date selected (warning will be flagged)
              </span>
            )}
            {!isMonday && !isWeekend && (
              <span>Previous calendar business day auto-computed. Editable for public holidays.</span>
            )}
          </div>
        </div>

        {/* Date Suggestion Warning Banner */}
        {suggestedDateMismatch && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>
                Detected snapshot date from file content is{' '}
                <strong className="underline">{previewData.suggested_date}</strong>, but entered date is{' '}
                <strong>{dataAsOf}</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDataAsOf(previewData.suggested_date)
                setYesterdayDate(getAutoYesterdayDate(previewData.suggested_date))
                setPreviewData(null)
              }}
              className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] transition-all"
            >
              Use Detected Date ({previewData.suggested_date})
            </button>
          </div>
        )}
      </div>

      {/* Multi-Drop Zone Banner */}
      <div
        {...getBatchRootProps()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          isBatchDragActive
            ? 'border-teal-500 bg-teal-500/5 scale-[1.01]'
            : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-teal-400 hover:bg-[var(--bg-secondary)]/50'
        }`}
      >
        <input {...getBatchInputProps()} id="upload-batch-input" />
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <UploadIcon className="w-6 h-6" />
          </div>
          <p className="font-bold text-sm text-[var(--text-primary)]">
            Drag & drop all 4 Excel files here at once
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-md">
            Our content signature detection automatically classifies each file into its matching scope slot (Renewal Comparison Tool, Renewals Summary - Fiscal 2026, Fiscal 2027, or Fiscal Q4).
          </p>
        </div>
      </div>

      {/* 4 Dedicated File Slots */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.keys(SLOT_DEFINITIONS) as FileSlot[]).map((slotKey) => {
          const def = SLOT_DEFINITIONS[slotKey]
          return (
            <SlotCard
              key={slotKey}
              slotKey={slotKey}
              title={def.title}
              subtitle={def.subtitle}
              expected={def.expected}
              required={def.required}
              state={slots[slotKey]}
              onDrop={(f) => handleSlotDrop(slotKey, f)}
              onClear={() => handleClearSlot(slotKey)}
              onMove={(target) => handleMoveSlot(slotKey, target)}
              badgeColor={def.badgeColor}
              id={`slot-${slotKey.replace('_', '-')}`}
            />
          )
        })}
      </div>

      {/* Admin Notice if not logged in */}
      {!isAdmin && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span>
              <strong>Admin Authentication Required:</strong> You are in read-only mode. Uploading, replacing, and committing snapshots requires an Admin token.
            </span>
          </div>
          <span className="font-semibold text-amber-700 dark:text-amber-400">
            Sign in via the top-bar Admin button
          </span>
        </div>
      )}

      {/* Validate & Preview Action Button */}
      <div className="flex items-center justify-between card p-4 border border-[var(--border)]">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Info className="w-4 h-4 text-teal-500 flex-shrink-0" />
          <span>
            Validation reads and verifies all sheets without writing to the database. You will see active vs raw rows, detected columns, and reconciliation reports before confirming.
          </span>
        </div>
        <button
          type="button"
          onClick={handleValidate}
          disabled={!slots.comparison_tool.file || isValidating || isCommitting || !isAdmin}
          className="px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0 transition-all"
          id="validate-preview-btn"
          title={!isAdmin ? 'Admin sign-in required' : undefined}
        >
          {isValidating ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Validating Files...
            </>
          ) : (
            <>
              <ShieldCheck className="w-4 h-4" />
              {!isAdmin ? 'Admin Required to Validate' : 'Validate & Preview'}
            </>
          )}
        </button>
      </div>

      {/* Preview Section */}
      <AnimatePresence>
        {previewData && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="card p-6 border-2 border-teal-500/30 space-y-6 bg-[var(--bg-card)] shadow-lg"
            id="upload-preview-container"
          >
            {/* Preview Header & Date / Quarter Summary */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-4 border-b border-[var(--border)] gap-4">
              <div>
                <h3 className="text-lg font-black text-[var(--text-primary)] flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-teal-500" />
                  Pre-Commit Validation Preview
                </h3>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
                  <span className="font-bold text-[var(--text-primary)]">
                    As-of: {previewData.data_as_of_date} ({previewData.weekday})
                  </span>
                  <span>·</span>
                  <span className="px-2 py-0.5 rounded bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold">
                    Quarter: {previewData.quarter_label}
                  </span>
                </div>
              </div>

              {/* Commit Button */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleCommit(previewData.snapshot_exists)}
                  disabled={
                    isCommitting ||
                    !previewData.can_commit ||
                    (previewData.errors && previewData.errors.length > 0) ||
                    (previewData.snapshot_exists && !userConfirmReplace)
                  }
                  className={`px-6 py-2.5 rounded-xl font-black text-xs shadow-md flex items-center gap-2 transition-all text-white ${
                    previewData.snapshot_exists
                      ? 'bg-amber-600 hover:bg-amber-700 disabled:bg-slate-500'
                      : 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-500'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  id="confirm-commit-btn"
                >
                  {isCommitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Committing Transaction...
                    </>
                  ) : !previewData.can_commit ? (
                    <>
                      <XCircle className="w-4 h-4" />
                      Blocked — Fix Errors First
                    </>
                  ) : previewData.snapshot_exists ? (
                    <>
                      <Database className="w-4 h-4" />
                      Replace Existing Snapshot &amp; Commit
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4" />
                      Confirm &amp; Commit to Database
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Backfill Active Setting & Baseline Comparison Strip */}
            <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-xs space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={makeActiveChecked}
                      onChange={(e) => setMakeActiveChecked(e.target.checked)}
                      className="rounded border-[var(--border)] text-teal-600 focus:ring-teal-500"
                      id="upload-make-active-checkbox"
                    />
                    <span>Set as Active Today's Snapshot</span>
                  </label>
                  {isBackfillDate && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                      Out-of-order backfill (newer date already exists in DB)
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-[var(--text-muted)]">
                  {makeActiveChecked
                    ? 'This snapshot will be displayed as the default view across all dashboards.'
                    : 'This snapshot will be saved to history without altering the currently active dashboard date.'}
                </div>
              </div>

              {/* Yesterday & Last Week Resolution Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-[var(--border-subtle)] text-[11px]">
                <div className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <span className="font-bold text-[var(--text-primary)] block">
                    Yesterday Baseline ({previewData.yesterday_date}):
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Resolved {previewData.yesterday_source_desc}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)]">
                  <span className="font-bold text-[var(--text-primary)] block">
                    Last Week Baseline ({previewData.last_week_date}):
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Resolved {previewData.last_week_source_desc}
                  </span>
                </div>
              </div>
            </div>

            {/* Snapshot Exists Safety Confirmation Banner */}
            {previewData.snapshot_exists && (
              <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 text-amber-800 dark:text-amber-300 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Replace Existing Snapshot Warning
                </div>
                <p className="leading-relaxed">
                  A snapshot for <strong>{previewData.data_as_of_date}</strong> already exists in the database
                  {previewData.existing_snapshot?.uploaded_at && (
                    <> (uploaded on {new Date(previewData.existing_snapshot.uploaded_at).toLocaleString()}</>
                  )}
                  {previewData.existing_snapshot?.uploaded_by && (
                    <> by <strong>{previewData.existing_snapshot.uploaded_by}</strong></>
                  )}
                  {previewData.existing_snapshot?.row_count !== undefined && (
                    <>, containing <strong>{formatNumber(previewData.existing_snapshot.row_count)}</strong> deals / <strong>{formatCurrency(previewData.existing_snapshot.total_acv || 0)}</strong></>
                  )}
                  ). Overwriting will replace existing opportunities and change logs for this date in a single atomic transaction.
                </p>

                <label className="flex items-center gap-2.5 font-bold cursor-pointer pt-1 text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={userConfirmReplace}
                    onChange={(e) => setUserConfirmReplace(e.target.checked)}
                    className="w-4 h-4 rounded border-[var(--border)] text-amber-600 focus:ring-amber-500"
                    id="upload-confirm-replace-checkbox"
                  />
                  <span>Yes, I confirm replacing the existing snapshot for {previewData.data_as_of_date}</span>
                </label>
              </div>
            )}

            {/* Missing Required Columns (Blocking Error Banner) */}
            {previewData.missing_columns && previewData.missing_columns.length > 0 && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 space-y-2 text-xs">
                <div className="font-bold flex items-center gap-1.5 text-sm">
                  <XCircle className="w-4 h-4" /> Missing Required Columns:
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {previewData.missing_columns.map((col: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-700 dark:text-rose-300 font-mono text-[11px]"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Unmapped Regions (Warning Banner) */}
            {previewData.unmapped_regions && previewData.unmapped_regions.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 space-y-2 text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Unmapped Sub-Regions Flagged:
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  The following raw sub-region values did not match the standard region lookup table:
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {previewData.unmapped_regions.map((reg: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-mono text-[11px]"
                    >
                      {reg || 'Blank'}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Schema Drift Warnings (Addendum C) */}
            {previewData.schema_drift_warnings && previewData.schema_drift_warnings.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 space-y-2 text-xs">
                <div className="font-bold flex items-center gap-1.5 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Schema Drift Detected (Both Ways):
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  {previewData.schema_drift_warnings.map((w: string, idx: number) => (
                    <li key={idx} className="font-mono text-[11px]">{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Source Reconciliation Checks (Addendum B) */}
            {previewData.source_checks && (
              <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                        previewData.source_checks.badge === 'green'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                          : previewData.source_checks.badge === 'red'
                          ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Source Check: {previewData.source_checks.badge === 'green' ? 'All Match' : `${previewData.source_checks.failed} Mismatch(es)`} ({previewData.source_checks.passed}/{previewData.source_checks.total})
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Reconciled live against Excel's own control sheets
                    </span>
                  </div>
                </div>

                {previewData.source_checks.items && previewData.source_checks.items.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] max-h-60 overflow-y-auto">
                    <table className="w-full text-[11px] text-left">
                      <thead className="bg-[var(--bg-card)] text-[var(--text-muted)] font-semibold border-b border-[var(--border-subtle)] sticky top-0">
                        <tr>
                          <th className="py-2 px-2.5">Status</th>
                          <th className="py-2 px-2.5">Workbook</th>
                          <th className="py-2 px-2.5">Sheet</th>
                          <th className="py-2 px-2.5">Cell / Row</th>
                          <th className="py-2 px-2.5">Metric</th>
                          <th className="py-2 px-2.5 text-right">Excel Value</th>
                          <th className="py-2 px-2.5 text-right">Website Value</th>
                          <th className="py-2 px-2.5 text-right">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {previewData.source_checks.items.map((chk: any, idx: number) => (
                          <tr
                            key={idx}
                            className={chk.status === 'fail' ? 'bg-rose-500/10 font-bold' : 'hover:bg-[var(--bg-card)]/50'}
                          >
                            <td className="py-1.5 px-2.5">
                              {chk.status === 'pass' ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">MATCH</span>
                              ) : (
                                <span className="text-rose-600 dark:text-rose-400 font-bold">MISMATCH</span>
                              )}
                            </td>
                            <td className="py-1.5 px-2.5 text-[var(--text-secondary)]">{chk.workbook_name}</td>
                            <td className="py-1.5 px-2.5 font-medium">{chk.sheet_name}</td>
                            <td className="py-1.5 px-2.5 font-mono text-[10px]">{chk.cell_or_row}</td>
                            <td className="py-1.5 px-2.5">{chk.metric_name}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-semibold">{chk.excel_value}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-semibold">{chk.website_value}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono">
                              {chk.diff_value != null ? Number(chk.diff_value).toFixed(2) : '0.00'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* General Warnings & Reconciliation Notices */}
            {previewData.warnings && previewData.warnings.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 space-y-1.5 text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> Reconciliation & Advisory Notices:
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  {previewData.warnings.map((w: string, idx: number) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* General Errors */}
            {previewData.errors && previewData.errors.length > 0 && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 space-y-1.5 text-xs">
                <div className="font-bold flex items-center gap-1.5">
                  <XCircle className="w-4 h-4" /> Blocking Errors:
                </div>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  {previewData.errors.map((e: string, idx: number) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Scope Cards Matrix */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Scope Summary Matrix (Active vs Raw)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <ScopePreviewCard
                  title="Renewals (Standard)"
                  scopeKey="renewals"
                  data={previewData.scopes?.renewals}
                  badge="Comparison Tool"
                  color="teal"
                />
                <ScopePreviewCard
                  title="All Opportunities"
                  scopeKey="all"
                  data={previewData.scopes?.all}
                  badge="Comparison Tool"
                  color="slate"
                />
                <ScopePreviewCard
                  title={`Current Quarter (${previewData.quarter_label})`}
                  scopeKey="current_quarter"
                  data={previewData.scopes?.current_quarter}
                  badge="Fiscal Period Slice"
                  color="amber"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload History Table (Last 10 Uploads) */}
      <div className="card p-6 border border-[var(--border)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-black text-base text-[var(--text-primary)] flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-500" />
              Recent Upload History
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Auditable log of snapshots and source file archives.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetchHistory()}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Refresh history"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-xs text-left">
            <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-semibold border-b border-[var(--border)]">
              <tr>
                <th className="py-2.5 px-3">Snapshot Date</th>
                <th className="py-2.5 px-3">Yesterday Date</th>
                <th className="py-2.5 px-3">Active Deals</th>
                <th className="py-2.5 px-3">Raw Deals</th>
                <th className="py-2.5 px-3">Source Checks</th>
                <th className="py-2.5 px-3">Last Week Source</th>
                <th className="py-2.5 px-3">Uploaded At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {uploadHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[var(--text-muted)]">
                    No historical snapshots recorded yet.
                  </td>
                </tr>
              ) : (
                uploadHistory.map((h: any) => (
                  <tr key={h.id} className="hover:bg-[var(--bg-secondary)]/50 transition-colors">
                    <td className="py-2.5 px-3 font-bold text-[var(--text-primary)]">
                      {h.snapshot_date}
                      {h.is_active_today && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-teal-500/10 text-teal-600 dark:text-teal-400 font-semibold">
                          Active Today
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)] font-medium">
                      {h.yesterday_date ?? '—'}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-teal-600 dark:text-teal-400">
                      {formatNumber(h.active_row_count ?? h.row_count)}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-muted)]">
                      {formatNumber(h.row_count)}
                    </td>
                    <td className="py-2.5 px-3">
                      {h.source_checks ? (
                        <button
                          type="button"
                          onClick={async () => {
                            setSelectedHistoryCheckSnap(h)
                            setLoadingChecks(true)
                            try {
                              const res = await getSnapshotChecks(h.id)
                              setChecksModalData(res.checks || [])
                            } catch {
                              setChecksModalData([])
                            } finally {
                              setLoadingChecks(false)
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
                            h.source_checks.badge === 'green'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : h.source_checks.badge === 'red'
                              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                          }`}
                          title="Click to view full reconciliation details"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {h.source_checks.badge === 'green'
                            ? `Pass (${h.source_checks.passed})`
                            : `${h.source_checks.failed} Fail`}
                        </button>
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {h.last_week_source === 'real_snapshot' ? (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Stored Snapshot (-7d)
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          Summary Union (Partial)
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-muted)]">
                      {h.uploaded_at ? new Date(h.uploaded_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconciliation Details Modal */}
      {selectedHistoryCheckSnap && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedHistoryCheckSnap(null)}
        >
          <div
            className="card p-6 border border-[var(--border)] max-w-4xl w-full max-h-[80vh] flex flex-col space-y-4 shadow-2xl bg-[var(--bg-card)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div>
                <h3 className="font-black text-base text-[var(--text-primary)] flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-teal-500" />
                  Excel Source Reconciliation Checks — {selectedHistoryCheckSnap.snapshot_date}
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Comparison between database aggregations and control summary sheets in the uploaded workbook.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryCheckSnap(null)}
                className="p-1 rounded-lg hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingChecks ? (
                <div className="py-12 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                  <RefreshCw className="w-4 h-4 animate-spin text-teal-500" />
                  Loading reconciliation checks...
                </div>
              ) : !checksModalData || checksModalData.length === 0 ? (
                <p className="text-center py-10 text-xs text-[var(--text-muted)]">
                  No detailed check records found for this snapshot.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[var(--bg-secondary)] text-[var(--text-muted)] font-semibold border-b border-[var(--border)] sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Workbook</th>
                        <th className="py-2.5 px-3">Sheet</th>
                        <th className="py-2.5 px-3">Cell / Row</th>
                        <th className="py-2.5 px-3">Metric</th>
                        <th className="py-2.5 px-3 text-right">Excel Value</th>
                        <th className="py-2.5 px-3 text-right">Website Value</th>
                        <th className="py-2.5 px-3 text-right">Diff</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {checksModalData.map((chk: any) => (
                        <tr
                          key={chk.id}
                          className={chk.status === 'fail' ? 'bg-rose-500/10 font-bold' : 'hover:bg-[var(--bg-secondary)]/50'}
                        >
                          <td className="py-2 px-3">
                            {chk.status === 'pass' ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                MATCH
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                MISMATCH
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">{chk.workbook_name}</td>
                          <td className="py-2 px-3 font-semibold">{chk.sheet_name}</td>
                          <td className="py-2 px-3 font-mono text-[11px]">{chk.cell_or_row}</td>
                          <td className="py-2 px-3">{chk.metric_name}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{chk.excel_value}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{chk.website_value}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {chk.diff_value != null ? Number(chk.diff_value).toFixed(2) : '0.00'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SlotCard({
  slotKey,
  title,
  subtitle,
  expected,
  required = false,
  state,
  onDrop,
  onClear,
  onMove,
  badgeColor,
  id,
}: {
  slotKey: FileSlot
  title: string
  subtitle: string
  expected: string
  required?: boolean
  state: UploadSlotState
  onDrop: (file: File) => void
  onClear: () => void
  onMove: (target: FileSlot) => void
  badgeColor: string
  id: string
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
    maxFiles: 1,
    onDrop: ([f]) => f && onDrop(f),
  })

  return (
    <div
      className={`card p-4 border rounded-2xl flex flex-col justify-between transition-all ${
        state.file
          ? 'border-teal-500/50 bg-teal-500/5'
          : isDragActive
          ? 'border-teal-400 bg-teal-500/10'
          : 'border-[var(--border)] hover:border-teal-400/50'
      }`}
      id={id}
    >
      <div>
        <div className="flex items-center justify-between mb-2">
          <span
            className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              required
                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'bg-slate-500/10 text-slate-600 dark:text-slate-400'
            }`}
          >
            {required ? 'Required' : 'Optional'}
          </span>
          {state.file && (
            <span className="text-emerald-500 text-xs flex items-center gap-1 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ready
            </span>
          )}
        </div>

        <h4 className="font-extrabold text-xs text-[var(--text-primary)] leading-tight">{title}</h4>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>
        <p className="text-[10px] text-[var(--text-muted)] opacity-80 mt-1 italic font-mono">{expected}</p>
      </div>

      <div className="mt-4 space-y-2">
        {state.file ? (
          <div>
            <div className="p-2 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-between">
              <div className="overflow-hidden pr-2">
                <p className="text-xs font-bold text-[var(--text-primary)] truncate">{state.name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{(state.size / (1024 * 1024)).toFixed(2)} MB</p>
              </div>
              <button
                type="button"
                onClick={onClear}
                className="p-1 rounded-md hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-rose-500 transition-colors"
                title="Remove file"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Slot re-assign dropdown */}
            <div className="pt-1.5 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>Re-assign:</span>
              <select
                value={slotKey}
                onChange={(e) => onMove(e.target.value as FileSlot)}
                className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] outline-none"
              >
                <option value="comparison_tool">Renewal Comparison Tool</option>
                <option value="fiscal_2026">Renewals Summary - Fiscal 2026</option>
                <option value="fiscal_2027">Renewals Summary - Fiscal 2027</option>
                <option value="fiscal_q4">Renewals Summary - Fiscal Q4</option>
              </select>
            </div>
          </div>
        ) : (
          <div
            {...getRootProps()}
            className="p-3 border border-dashed rounded-xl border-[var(--border)] text-center cursor-pointer hover:border-teal-400 transition-all bg-[var(--bg-secondary)]/50"
          >
            <input {...getInputProps()} />
            <FileSpreadsheet className="w-5 h-5 mx-auto text-[var(--text-muted)] mb-1 opacity-70" />
            <p className="text-[11px] font-semibold text-teal-600 dark:text-teal-400">Click or Drop</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ScopePreviewCard({
  title,
  scopeKey,
  data,
  badge,
  color,
}: {
  title: string
  scopeKey: string
  data?: {
    raw_count: number
    raw_acv: number
    active_count: number
    active_acv: number
    deleted_lost_count: number
    available: boolean
  }
  badge: string
  color: string
}) {
  if (!data || !data.available) {
    return (
      <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] opacity-60">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{badge}</p>
        <h5 className="font-bold text-xs text-[var(--text-primary)]">{title}</h5>
        <p className="text-xs text-[var(--text-muted)] mt-2 italic">Scope not available</p>
      </div>
    )
  }

  return (
    <div className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col justify-between">
      <div>
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{badge}</span>
        <h5 className="font-extrabold text-xs text-[var(--text-primary)] leading-tight">{title}</h5>
      </div>

      <div className="mt-3 space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
        <div>
          <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold uppercase block">
            Active ACV
          </span>
          <span className="text-sm font-black text-[var(--text-primary)]">
            {formatCurrency(data.active_acv)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] block">
            {formatNumber(data.active_count)} active deals
          </span>
        </div>

        <div className="pt-1 text-[10px] text-[var(--text-muted)]">
          <span>Raw: {formatCurrency(data.raw_acv)}</span> ({data.raw_count})
          <span className="block text-rose-500/80">-{data.deleted_lost_count} Del/Lost</span>
        </div>
      </div>
    </div>
  )
}
