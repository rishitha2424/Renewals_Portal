import React, { useState, useMemo, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { acquireBodyScrollLock, releaseBodyScrollLock, registerOverlayCloser } from '@/utils/overlayManager'
import { X, Search, ArrowUpDown, ArrowUp, ArrowDown, Download, FilterX, MessageSquare } from 'lucide-react'
import { formatCurrency, formatNumber, formatDate, getForecastCategoryLabel, getApprovalStatusLabel } from '@/utils/format'
import { FORECAST_COLORS } from '@/design/tokens'
import { useAppStore } from '@/store/appStore'
import DealCommentPanel, { CommentTargetDeal } from '@/components/common/DealCommentPanel'

export const getDealStage = (d: any): string => {
  if (!d) return ''
  const val = (
    d.stage ||
    d.stage_number ||
    d.stage_name ||
    d.Stage ||
    d.Stage_Number ||
    d.Stage_Name ||
    d['Stage Number'] ||
    d['Stage Name'] ||
    d.extra_attributes?.['Stage Number'] ||
    d.extra_attributes?.['Stage'] ||
    d.extra_attributes?.stage ||
    d.extra_attributes?.stage_number ||
    d.extra_attributes?.stage_name ||
    d.extra_attributes?.Stage ||
    ''
  )
  return String(val === null || val === undefined ? '' : val).trim()
}

export const getDealOwner = (d: any): string => {
  if (!d) return ''
  const val = (
    d.owner ||
    d.opportunity_owner ||
    d.Owner ||
    d['Opportunity Owner'] ||
    d.extra_attributes?.['Opportunity Owner'] ||
    d.extra_attributes?.['Owner'] ||
    d.extra_attributes?.opportunity_owner ||
    d.extra_attributes?.owner ||
    ''
  )
  return String(val === null || val === undefined ? '' : val).trim()
}

interface Deal {
  id: string
  opportunity_id_18: string
  opportunity_name: string
  account_name: string
  forecast_category: string
  forecast_acv_amount: number
  approval_status: string
  reason_for_approval?: string
  sub_region?: string
  region?: string
  business_unit_primary?: string
  business_unit?: string
  close_date?: string
  owner?: string
  stage?: string
  delta_group?: string
  delta_acv_change?: number
  from_category?: string
  to_category?: string
  from_status?: string
  to_status?: string
  acv?: number
  service_expiry_date?: string
  service_start_date?: string
  group?: string
  why_here?: string
  also_delayed?: boolean
}

interface DealListModalProps {
  title: string
  deals: Deal[]
  expectedCount?: number
  isLoading?: boolean
  initialFilters?: {
    forecast_category?: string | null
    approval_status?: string | null
    stage?: string | null
    sub_region?: string | null
    business_unit_primary?: string | null
    owner?: string | null
  }
  deltaGroups?: {
    added: { name: string; count: number; acv: number; deals: any[] }
    left: { name: string; count: number; acv: number; deals: any[] }
    amount_changed: { name: string; count: number; acv: number; deals: any[] }
    net: { count: number; acv: number }
  }
  onSelectOpp: (id: string) => void
  onClose: () => void
}

export default function DealListModal({ title, deals, expectedCount, isLoading, initialFilters, deltaGroups, onSelectOpp, onClose }: DealListModalProps) {
  const [selectedGroup, setSelectedGroup] = useState<'All' | 'added' | 'left' | 'amount_changed'>('All')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<keyof Deal | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const effectiveExpected = useMemo(() => {
    if (expectedCount !== undefined && expectedCount !== null) return expectedCount
    const m = title.match(/\((\d+)\s+deals?/i)
    return m ? parseInt(m[1], 10) : undefined
  }, [expectedCount, title])

  const hasCountMismatch = effectiveExpected !== undefined && (deals?.length ?? 0) !== effectiveExpected

  React.useEffect(() => {
    if (hasCountMismatch) {
      console.warn('Count differs from card', { title, expected: effectiveExpected, actual: deals?.length })
    }
  }, [hasCountMismatch, effectiveExpected, deals?.length, title])

  // Close on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  
  const initFC = initialFilters?.forecast_category || (initialFilters as any)?.category || 'All'
  const initStatus = initialFilters?.approval_status || (initialFilters as any)?.status || 'All'
  const initStage = initialFilters?.stage || (initialFilters as any)?.stage_number || 'All'
  const initRegion = initialFilters?.sub_region || (initialFilters as any)?.region || 'All'
  const initBU = initialFilters?.business_unit_primary || (initialFilters as any)?.bu || (initialFilters as any)?.business_unit || 'All'
  const initOwner = initialFilters?.owner || (initialFilters as any)?.opportunity_owner || 'All'

  const [filterFC, setFilterFC] = useState<string>(initFC)
  const [filterStatus, setFilterStatus] = useState<string>(initStatus)
  const [filterStage, setFilterStage] = useState<string>(initStage)
  const [filterRegion, setFilterRegion] = useState<string>(initRegion)
  const [filterBU, setFilterBU] = useState<string>(initBU)
  const [filterOwner, setFilterOwner] = useState<string>(initOwner)

  // Selection & Comment Panel State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCommentPanel, setShowCommentPanel] = useState<boolean>(false)
  const [commentTargetDeals, setCommentTargetDeals] = useState<CommentTargetDeal[]>([])

  React.useEffect(() => {
    if (initialFilters) {
      if (initialFilters.forecast_category || (initialFilters as any).category) {
        setFilterFC(initialFilters.forecast_category || (initialFilters as any).category)
      }
      if (initialFilters.approval_status || (initialFilters as any).status) {
        setFilterStatus(initialFilters.approval_status || (initialFilters as any).status)
      }
      if (initialFilters.stage || (initialFilters as any).stage_number) {
        setFilterStage(initialFilters.stage || (initialFilters as any).stage_number)
      }
      if (initialFilters.sub_region || (initialFilters as any).region) {
        setFilterRegion(initialFilters.sub_region || (initialFilters as any).region)
      }
      if (initialFilters.business_unit_primary || (initialFilters as any).bu || (initialFilters as any).business_unit) {
        setFilterBU(initialFilters.business_unit_primary || (initialFilters as any).bu || (initialFilters as any).business_unit)
      }
      if (initialFilters.owner || (initialFilters as any).opportunity_owner) {
        setFilterOwner(initialFilters.owner || (initialFilters as any).opportunity_owner)
      }
    }
  }, [initialFilters])

  const uniqueValues = (primaryField: keyof Deal, fallbackField?: keyof Deal) => {
    const vals = new Set(
      (deals || [])
        .map(d => (d[primaryField] || (fallbackField ? d[fallbackField] : '')) as string)
        .filter(v => v && typeof v === 'string' && v.trim().length > 0)
    )
    return ['All', ...Array.from(vals)].sort()
  }

  const fcOptions = ['All', 'Closed', 'Commit', 'Best Case', 'Pipeline', 'Not yet proposed']
  const statusOptions = uniqueValues('approval_status')
  const stageOptions = useMemo(() => {
    const vals = new Set((deals || []).map(d => getDealStage(d)).filter(Boolean))
    return ['All', ...Array.from(vals)].sort()
  }, [deals])
  const regionOptions = uniqueValues('sub_region', 'region' as keyof Deal)
  const buOptions = useMemo(() => {
    const vals = new Set(
      (deals || [])
        .map(d => (d.business_unit_primary || (d as any).business_unit || (d as any).business_unit_raw || '') as string)
        .filter(v => Boolean(v && v.trim()))
    )
    return ['All', ...Array.from(vals)].sort()
  }, [deals])
  const ownerOptions = useMemo(() => {
    const vals = new Set((deals || []).map(d => getDealOwner(d)).filter(Boolean))
    return ['All', ...Array.from(vals)].sort()
  }, [deals])

  const handleSort = (field: keyof Deal) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const filteredDeals = useMemo(() => {
    let result = (deals || []).filter(d => {
      if (deltaGroups && selectedGroup !== 'All') {
        if (selectedGroup === 'added' && !(d.delta_group?.startsWith('Added to') || d.delta_group === 'Added to Q4')) return false
        if (selectedGroup === 'left' && !(d.delta_group?.startsWith('Left') || d.delta_group === 'Left Q4 – moved or lost')) return false
        if (selectedGroup === 'amount_changed' && d.delta_group !== 'Amount changed') return false
      }
      if (filterFC !== 'All') {
        const fcNorm = getForecastCategoryLabel(d.forecast_category)
        if (fcNorm !== filterFC && d.forecast_category !== filterFC) return false
      }
      if (filterStatus !== 'All') {
        if (filterStatus === 'not_approved' || filterStatus === 'unapproved' || filterStatus === 'Not approved') {
          if (d.approval_status === 'Approved' || (d as any).approval_status_key === 'Approved') return false
        } else {
          const stNorm = getApprovalStatusLabel(d.approval_status)
          if (stNorm !== filterStatus && d.approval_status !== filterStatus && (d as any).approval_status_key !== filterStatus) return false
        }
      }
      if (filterStage !== 'All' && getDealStage(d) !== filterStage) return false
      if (filterRegion !== 'All' && d.sub_region !== filterRegion && (d as any).region !== filterRegion) return false
      if (filterBU !== 'All') {
        const buPrimary = (d.business_unit_primary || (d as any).business_unit || '').toLowerCase().trim()
        const buRaw = ((d as any).business_unit_raw || '').toLowerCase().trim()
        const target = filterBU.toLowerCase().trim()
        const match =
          buPrimary === target ||
          buRaw === target ||
          buRaw.includes(target) ||
          target.includes(buPrimary) ||
          (buPrimary && target.split(/[;,]/).some(part => part.trim() === buPrimary))
        if (!match) return false
      }
      if (filterOwner !== 'All' && getDealOwner(d) !== filterOwner) return false

      // min_acv / max_acv
      const acvVal = d.forecast_acv_amount ?? (d as any).acv ?? 0
      if ((initialFilters as any)?.min_acv !== undefined && (initialFilters as any)?.min_acv !== null) {
        if (acvVal < (initialFilters as any).min_acv) return false
      }
      if ((initialFilters as any)?.max_acv !== undefined && (initialFilters as any)?.max_acv !== null) {
        if (acvVal >= (initialFilters as any).max_acv) return false
      }

      // opp_id / deal_ids
      if ((initialFilters as any)?.opp_id) {
        const targetId = String((initialFilters as any).opp_id).trim()
        if (String(d.opportunity_id_18).trim() !== targetId && String(d.id).trim() !== targetId) return false
      }
      if ((initialFilters as any)?.deal_ids) {
        const rawIds = (initialFilters as any).deal_ids
        const idList = (Array.isArray(rawIds) ? rawIds : String(rawIds).split(',')).map((s: any) => String(s).trim()).filter(Boolean)
        if (idList.length > 0) {
          const dId18 = String(d.opportunity_id_18 || '').trim()
          const dId = String(d.id || '').trim()
          if (!idList.includes(dId18) && !idList.includes(dId)) return false
        }
      }
      
      if (search) {
        const q = search.toLowerCase()
        const st = getDealStage(d).toLowerCase()
        const ow = getDealOwner(d).toLowerCase()
        if (!d.opportunity_name?.toLowerCase().includes(q) &&
            !d.account_name?.toLowerCase().includes(q) &&
            !d.opportunity_id_18?.toLowerCase().includes(q) &&
            !ow.includes(q) &&
            !st.includes(q)) {
          return false
        }
      }
      return true
    })
    
    if (sortField) {
      result.sort((a, b) => {
        if (sortField === 'stage') {
          const valA = getDealStage(a)
          const valB = getDealStage(b)
          if (valA < valB) return sortDir === 'asc' ? -1 : 1
          if (valA > valB) return sortDir === 'asc' ? 1 : -1
          return 0
        }
        if (sortField === 'owner') {
          const valA = getDealOwner(a)
          const valB = getDealOwner(b)
          if (valA < valB) return sortDir === 'asc' ? -1 : 1
          if (valA > valB) return sortDir === 'asc' ? 1 : -1
          return 0
        }
        const valA = a[sortField] || ''
        const valB = b[sortField] || ''
        if (valA < valB) return sortDir === 'asc' ? -1 : 1
        if (valA > valB) return sortDir === 'asc' ? 1 : -1
        return 0
      })
    }
    return result
  }, [deals, search, filterFC, filterStatus, filterStage, filterRegion, filterBU, filterOwner, sortField, sortDir, deltaGroups, selectedGroup])

  React.useEffect(() => {
    setSelectedIds(new Set())
  }, [deals, filterFC, filterStatus, filterStage, filterRegion, filterBU, filterOwner, search])

  const allFilteredSelected = filteredDeals.length > 0 && filteredDeals.every(d => selectedIds.has(d.opportunity_id_18))
  const someFilteredSelected = filteredDeals.some(d => selectedIds.has(d.opportunity_id_18))

  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredDeals.forEach(d => next.delete(d.opportunity_id_18))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredDeals.forEach(d => next.add(d.opportunity_id_18))
        return next
      })
    }
  }

  const toggleSelect = (id: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isFCMovement = useMemo(() => deals.some(d => d.from_category && d.to_category), [deals])
  const isAPMovement = useMemo(() => deals.some(d => d.from_status && d.to_status), [deals])

  const totalAcv = filteredDeals.reduce((sum, d) => sum + (d.forecast_acv_amount ?? (d as any).acv ?? 0), 0)

  const handleExport = () => {
    const headers = ['Opportunity ID', 'Opportunity Name', 'Account', 'Forecast Category', 'Approval Status', 'ACV', 'Close Date', 'Stage', 'Region', 'BU', 'Owner']
    const csvContent = [
      headers.join(','),
      ...filteredDeals.map(d => [
        `"${d.opportunity_id_18 || ''}"`,
        `"${(d.opportunity_name || '').replace(/"/g, '""')}"`,
        `"${(d.account_name || '').replace(/"/g, '""')}"`,
        `"${d.forecast_category || ''}"`,
        `"${d.approval_status || ''}"`,
        d.forecast_acv_amount || 0,
        `"${d.close_date || ''}"`,
        `"${getDealStage(d).replace(/"/g, '""')}"`,
        `"${d.sub_region || (d as any).region || ''}"`,
        `"${d.business_unit_primary || (d as any).business_unit || ''}"`,
        `"${getDealOwner(d).replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `deals_export_${new Date().getTime()}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const clearFilters = () => {
    setFilterFC(initFC)
    setFilterStatus(initStatus)
    setFilterStage(initStage)
    setFilterRegion(initRegion)
    setFilterBU(initBU)
    setFilterOwner(initOwner)
    setSelectedGroup('All')
    setSearch('')
  }

  const hasActiveFilters = 
    filterFC !== initFC ||
    filterStatus !== initStatus ||
    filterStage !== initStage ||
    filterRegion !== initRegion ||
    filterBU !== initBU ||
    filterOwner !== initOwner ||
    selectedGroup !== 'All' ||
    search !== ''

  const { globalFilters } = useAppStore()

  const activeChips = []
  // Inherited active global filters
  if (globalFilters.period && globalFilters.period !== 'current_quarter') {
    activeChips.push({ label: 'Period', value: globalFilters.period })
  }
  if (globalFilters.sales_types?.length > 0 && !(globalFilters.sales_types.length === 1 && globalFilters.sales_types[0] === 'Renewals')) {
    activeChips.push({ label: 'Sales Type', value: globalFilters.sales_types.join(', ') })
  }
  if (globalFilters.include_deleted_lost) {
    activeChips.push({ label: 'Deleted/Lost', value: 'Included' })
  }
  globalFilters.regions?.forEach(r => activeChips.push({ label: 'Region Filter', value: r }))
  globalFilters.business_units?.forEach(bu => activeChips.push({ label: 'BU Filter', value: bu }))

  // Local modal filters
  if (selectedGroup !== 'All') activeChips.push({ label: 'Group', value: selectedGroup === 'added' ? 'Added' : selectedGroup === 'left' ? 'Left' : 'Amount changed', onRemove: () => setSelectedGroup('All') })
  if (filterFC !== 'All') activeChips.push({ label: 'Category', value: filterFC, onRemove: () => setFilterFC('All') })
  if (filterStatus !== 'All') activeChips.push({ label: 'Status', value: filterStatus === 'not_approved' ? 'Awaiting approval' : getApprovalStatusLabel(filterStatus), onRemove: () => setFilterStatus('All') })
  if (filterStage !== 'All') activeChips.push({ label: 'Stage', value: filterStage, onRemove: () => setFilterStage('All') })
  if (filterRegion !== 'All') activeChips.push({ label: 'Region', value: filterRegion, onRemove: () => setFilterRegion('All') })
  if (filterBU !== 'All') activeChips.push({ label: 'BU', value: filterBU, onRemove: () => setFilterBU('All') })
  if (filterOwner !== 'All') activeChips.push({ label: 'Owner', value: filterOwner, onRemove: () => setFilterOwner('All') })
  if ((initialFilters as any)?.min_acv !== undefined && (initialFilters as any)?.min_acv !== null) {
    activeChips.push({ label: 'Deal Size', value: `≥ ${formatCurrency((initialFilters as any).min_acv)}` })
  }
  if ((initialFilters as any)?.max_acv !== undefined && (initialFilters as any)?.max_acv !== null) {
    activeChips.push({ label: 'Deal Size', value: `< ${formatCurrency((initialFilters as any).max_acv)}` })
  }

  const lockId = useId()
  useEffect(() => {
    acquireBodyScrollLock(lockId)
    const unregister = registerOverlayCloser(lockId, onClose)
    return () => {
      unregister()
      releaseBodyScrollLock(lockId)
    }
  }, [lockId, onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60"
        onClick={onClose}
      >
        <div
          style={{ width: 'min(1100px, 92vw)', maxWidth: 'min(1100px, 92vw)' }}
          className="w-full max-h-[85vh] flex flex-col bg-[var(--bg-primary)] rounded-2xl shadow-xl overflow-hidden border border-[var(--border)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header - sticky top */}
          <div className="sticky top-0 z-20 flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-[var(--border)] gap-3 bg-[var(--bg-secondary)]">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="font-semibold text-base text-[var(--text-primary)] flex items-center gap-2">
                  {title}
                </h3>
                {hasCountMismatch && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                    Count differs from card
                  </span>
                )}
              </div>
              <p className="text-[var(--text-muted)] text-xs mt-0.5 font-normal">
                Showing {formatNumber(filteredDeals.length)} {filteredDeals.length === 1 ? 'deal' : 'deals'} · <span className="font-semibold text-[var(--text-primary)] tabular-nums">{formatCurrency(totalAcv)}</span>
              </p>
              {deltaGroups && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-teal-700 dark:text-teal-300 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-sm tabular-nums">
                    Net: {deltaGroups.net.count >= 0 ? `+${deltaGroups.net.count}` : deltaGroups.net.count} deals / {deltaGroups.net.acv >= 0 ? `+$${(deltaGroups.net.acv / 1000).toFixed(1)}K` : `-$${(Math.abs(deltaGroups.net.acv) / 1000).toFixed(1)}K`} ({formatCurrency(deltaGroups.net.acv)})
                  </span>
                  <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-primary)] p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setSelectedGroup('All')}
                      className={`px-2.5 py-1 rounded-sm transition-colors ${selectedGroup === 'All' ? 'bg-[#12284C] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                    >
                      All ({deals.length})
                    </button>
                    <button
                      onClick={() => setSelectedGroup('added')}
                      className={`px-2.5 py-1 rounded-sm transition-colors ${selectedGroup === 'added' ? 'bg-emerald-600 text-white' : 'text-emerald-700 dark:text-emerald-300 hover:text-emerald-800'}`}
                    >
                      {deltaGroups.added.name || `Added to Q4 (${deltaGroups.added.count})`}
                    </button>
                    <button
                      onClick={() => setSelectedGroup('left')}
                      className={`px-2.5 py-1 rounded-sm transition-colors ${selectedGroup === 'left' ? 'bg-rose-600 text-white' : 'text-rose-700 dark:text-rose-300 hover:text-rose-800'}`}
                    >
                      {deltaGroups.left.name || `Left Q4 – moved or lost (${deltaGroups.left.count})`}
                    </button>
                    <button
                      onClick={() => setSelectedGroup('amount_changed')}
                      className={`px-2.5 py-1 rounded-sm transition-colors ${selectedGroup === 'amount_changed' ? 'bg-amber-600 text-white' : 'text-amber-700 dark:text-amber-300 hover:text-amber-800'}`}
                    >
                      Amount changed ({deltaGroups.amount_changed.count})
                    </button>
                  </div>
                </div>
              )}
              {activeChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {activeChips.map(chip => (
                    <div key={chip.label} className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-[var(--bg-primary)] border border-[var(--border)] text-[11px] font-medium text-[var(--text-primary)]">
                      <span className="text-[var(--text-muted)]">{chip.label}:</span> {chip.value}
                      <button onClick={chip.onRemove} className="text-[var(--text-muted)] hover:text-red-500"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--bg-secondary)] transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
              <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filters Area */}
          <div className="p-3.5 border-b border-[var(--border)] bg-[var(--bg-primary)] flex flex-wrap gap-2 items-center">
            <div className="relative flex-grow min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input 
                type="text" 
                placeholder="Search deals..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md focus:outline-none focus:border-[#00A3AD] text-[var(--text-primary)] transition-colors"
              />
            </div>
            
            <select value={filterFC} onChange={e => setFilterFC(e.target.value)} className="text-xs py-1.5 px-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer">
              {fcOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All Categories' : getForecastCategoryLabel(o)}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs py-1.5 px-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer">
              {filterStatus === 'not_approved' && <option value="not_approved">Awaiting Approval</option>}
              {filterStatus !== 'All' && filterStatus !== 'not_approved' && !statusOptions.includes(filterStatus) && <option value={filterStatus}>{getApprovalStatusLabel(filterStatus)}</option>}
              {statusOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All Statuses' : getApprovalStatusLabel(o)}</option>)}
            </select>
            <select value={filterStage} onChange={e => setFilterStage(e.target.value)} className="text-xs py-1.5 px-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer">
              {filterStage !== 'All' && !stageOptions.includes(filterStage) && <option value={filterStage}>{filterStage}</option>}
              {stageOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All Stages' : o}</option>)}
            </select>
            <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} className="text-xs py-1.5 px-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer">
              {filterRegion !== 'All' && !regionOptions.includes(filterRegion) && <option value={filterRegion}>{filterRegion}</option>}
              {regionOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All Regions' : o}</option>)}
            </select>
            <select value={filterBU} onChange={e => setFilterBU(e.target.value)} className="text-xs py-1.5 px-2.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none cursor-pointer">
              {filterBU !== 'All' && !buOptions.includes(filterBU) && <option value={filterBU}>{filterBU}</option>}
              {buOptions.map(o => <option key={o} value={o}>{o === 'All' ? 'All BUs' : o}</option>)}
            </select>
            
            {(hasActiveFilters) && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium hover:underline ml-auto whitespace-nowrap">
                <FilterX className="w-3.5 h-3.5" /> Reset filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-y-auto flex-1 bg-[var(--bg-primary)]">
            {isLoading ? (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2.5 text-xs text-[var(--text-muted)] mb-4">
                  <div className="w-4 h-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin shrink-0" />
                  <span className="font-medium">Loading deals from snapshot...</span>
                </div>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-10 bg-[var(--bg-secondary)] rounded-md animate-pulse border border-[var(--border)]" />
                ))}
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-12 h-12 rounded-sm bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center mb-3">
                  <Search className="w-5 h-5 text-[var(--text-muted)] opacity-60" />
                </div>
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">No deals found</h4>
                <p className="text-xs text-[var(--text-muted)] max-w-sm">Try adjusting your filters or search query to find what you're looking for.</p>
              </div>
            ) : (() => {
              const hasServiceExpiry = filteredDeals.some(d => Boolean(d.service_expiry_date))
              const hasWhyHere = filteredDeals.some(d => Boolean(d.why_here))

              return (
              <table className="data-table w-full text-xs text-left whitespace-nowrap">
                <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border)] z-10">
                  <tr>
                    <th className="w-10 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        ref={(input) => {
                          if (input) input.indeterminate = someFilteredSelected && !allFilteredSelected
                        }}
                        onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 rounded border-[var(--border)] text-teal-600 focus:ring-teal-500 cursor-pointer"
                        title="Select all (filtered)"
                        aria-label="Select all filtered deals"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] group col-main" onClick={() => handleSort('opportunity_name')}>
                      <div className="flex items-center gap-1">Opportunity {sortField === 'opportunity_name' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                    </th>
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)]">Account / Group</th>
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-right cursor-pointer hover:text-[var(--text-primary)] group col-num" onClick={() => handleSort('forecast_acv_amount')}>
                      <div className="flex items-center justify-end gap-1">ACV {sortField === 'forecast_acv_amount' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                    </th>
                    {hasServiceExpiry && (
                      <th className="px-3 py-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] group" onClick={() => handleSort('service_expiry_date' as any)}>
                        <div className="flex items-center gap-1">Service Expiry {sortField === ('service_expiry_date' as any) ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                      </th>
                    )}
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] group" onClick={() => handleSort('stage' as any)}>
                      <div className="flex items-center gap-1">Stage {sortField === ('stage' as any) ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                    </th>
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] group" onClick={() => handleSort('owner' as any)}>
                      <div className="flex items-center gap-1">Owner {sortField === ('owner' as any) ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                    </th>
                    <th className="px-3 py-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)] group" onClick={() => handleSort('close_date')}>
                      <div className="flex items-center gap-1">Close Date {sortField === 'close_date' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}</div>
                    </th>
                    {isFCMovement ? (
                      <>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">From Category</th>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">To Category</th>
                      </>
                    ) : isAPMovement ? (
                      <>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">From Status</th>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">To Status</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">Forecast</th>
                        <th className="px-3 py-2 font-medium text-[var(--text-muted)] text-center">Approval</th>
                      </>
                    )}
                    {hasWhyHere && (
                      <th className="px-3 py-2 font-medium text-[var(--text-muted)]">Why it is here</th>
                    )}
                    <th className="w-10 px-2 py-2 text-center font-medium text-[var(--text-muted)]" title="Comment"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredDeals.map(d => (
                    <tr
                      key={d.opportunity_id_18}
                      className="hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                      onClick={() => {
                        onSelectOpp(d.opportunity_id_18)
                        onClose()
                      }}
                    >
                      <td className="w-10 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(d.opportunity_id_18)}
                          onChange={(e) => toggleSelect(d.opportunity_id_18, e)}
                          className="w-3.5 h-3.5 rounded border-[var(--border)] text-teal-600 focus:ring-teal-500 cursor-pointer"
                          aria-label={`Select ${d.opportunity_name || d.opportunity_id_18}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-[var(--text-primary)] max-w-xs truncate" title={d.opportunity_name || d.opportunity_id_18}>
                            {d.opportunity_name || d.opportunity_id_18}
                          </span>
                          {d.also_delayed && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/25">
                              also delayed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5 font-mono">{d.opportunity_id_18}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-normal text-[var(--text-primary)] max-w-[150px] truncate" title={d.account_name}>{d.account_name || '—'}</div>
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5 max-w-[150px] truncate">
                          {d.group ? <span className="font-medium text-slate-700 dark:text-slate-300">Excel group (from file): {d.group}</span> : (d.business_unit_primary || '—')}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right col-num font-semibold text-[var(--text-primary)] tabular-nums">
                        {formatCurrency(d.forecast_acv_amount ?? (d as any).acv ?? 0)}
                      </td>
                      {hasServiceExpiry && (
                        <td className="px-3 py-2 text-[var(--text-secondary)] font-normal tabular-nums">
                          {formatDate(d.service_expiry_date)}
                        </td>
                      )}
                      <td className="px-3 py-2 text-[var(--text-secondary)] font-normal text-xs max-w-[120px] truncate" title={getDealStage(d)}>
                        {getDealStage(d) || '—'}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)] font-normal text-xs max-w-[120px] truncate" title={getDealOwner(d)}>
                        {getDealOwner(d) || '—'}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)] font-normal tabular-nums">
                        {formatDate(d.close_date)}
                      </td>
                      {isFCMovement ? (
                        <>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium"
                              style={{
                                backgroundColor: `${FORECAST_COLORS[d.from_category as keyof typeof FORECAST_COLORS] || '#cbd5e1'}20`,
                                color: FORECAST_COLORS[d.from_category as keyof typeof FORECAST_COLORS] || '#64748b'
                              }}
                            >
                              {getForecastCategoryLabel(d.from_category)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium"
                              style={{
                                backgroundColor: `${FORECAST_COLORS[(d.to_category || d.forecast_category) as keyof typeof FORECAST_COLORS] || '#cbd5e1'}20`,
                                color: FORECAST_COLORS[(d.to_category || d.forecast_category) as keyof typeof FORECAST_COLORS] || '#64748b'
                              }}
                            >
                              {getForecastCategoryLabel(d.to_category || d.forecast_category)}
                            </span>
                          </td>
                        </>
                      ) : isAPMovement ? (
                        <>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium border bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20">
                              {getApprovalStatusLabel(d.from_status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium border ${
                              (d.to_status || d.approval_status) === 'Approved' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' :
                              (d.to_status || d.approval_status) === 'Pending Approval' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20' :
                              'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20'
                            }`}>
                              {getApprovalStatusLabel(d.to_status || d.approval_status)}
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium"
                              style={{
                                backgroundColor: `${FORECAST_COLORS[d.forecast_category as keyof typeof FORECAST_COLORS] || '#cbd5e1'}20`,
                                color: FORECAST_COLORS[d.forecast_category as keyof typeof FORECAST_COLORS] || '#64748b'
                              }}
                            >
                              {getForecastCategoryLabel(d.forecast_category)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-sm text-[10px] font-medium border ${
                              d.approval_status === 'Approved' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' :
                              d.approval_status === 'Pending Approval' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20' :
                              'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20'
                            }`}>
                              {getApprovalStatusLabel(d.approval_status)}
                            </span>
                          </td>
                        </>
                      )}
                      {hasWhyHere && (
                        <td className="px-3 py-2 text-xs text-[var(--text-secondary)] max-w-xs whitespace-normal">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20">
                            {d.why_here || '—'}
                          </span>
                        </td>
                      )}
                      <td className="w-10 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setCommentTargetDeals([
                              {
                                id: d.opportunity_id_18,
                                name: d.opportunity_name || d.opportunity_id_18,
                                account: d.account_name,
                                owner: getDealOwner(d),
                                acv: d.forecast_acv_amount,
                              },
                            ])
                            setShowCommentPanel(true)
                          }}
                          className="p-1 rounded-md text-[var(--text-muted)] hover:text-teal-600 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer inline-flex items-center justify-center"
                          title="Add comment"
                          aria-label={`Comment on ${d.opportunity_name || d.opportunity_id_18}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )})()}
          </div>

          {/* Slim Selection Bottom Bar */}
          {selectedIds.size > 0 && (
            <div className="sticky bottom-0 z-20 flex items-center justify-between px-4 py-2.5 bg-[#12284C] text-white border-t border-[var(--border)] shadow-lg text-xs shrink-0 animate-in slide-in-from-bottom duration-150">
              <div className="flex items-center gap-2">
                <span className="font-bold">
                  {selectedIds.size} {selectedIds.size === 1 ? 'deal' : 'deals'} selected
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const targets: CommentTargetDeal[] = deals
                      .filter((d) => selectedIds.has(d.opportunity_id_18))
                      .map((d) => ({
                        id: d.opportunity_id_18,
                        name: d.opportunity_name || d.opportunity_id_18,
                        account: d.account_name,
                        owner: getDealOwner(d),
                        acv: d.forecast_acv_amount,
                      }))
                    setCommentTargetDeals(targets)
                    setShowCommentPanel(true)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#00A3AD] hover:bg-[#008f98] text-white font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Add comment</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-slate-300 hover:text-white underline font-medium cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comment Panel */}
      <DealCommentPanel
        isOpen={showCommentPanel}
        deals={commentTargetDeals}
        onRemoveDeal={(id) => {
          setCommentTargetDeals((prev) => prev.filter((d) => d.id !== id))
          setSelectedIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }}
        onClose={() => {
          setShowCommentPanel(false)
          setCommentTargetDeals([])
        }}
        onSuccess={() => {
          setSelectedIds(new Set())
        }}
      />
    </>,
    document.body
  )
}
