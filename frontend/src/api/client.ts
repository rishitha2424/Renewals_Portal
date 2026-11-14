import axios from 'axios'
import { useAppStore, FilterSpec } from '../store/appStore'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: {
    indexes: null,
  },
})

// Static hosts can return index.html for /api requests when their proxy is missing.
// Treat that as a connection error instead of accepting it as empty application data.
api.interceptors.response.use((response) => {
  if (typeof response.data === 'string' &&
      (String(response.headers['content-type'] || '').includes('text/html') ||
       /^\s*(<!doctype html|<html)/i.test(response.data))) {
    throw new Error('The app cannot reach the API. Check that the backend is running and /api is routed to it.')
  }
  return response
})

// Upload/commit/validate endpoints are body-only — they must NOT receive extra query params.
const FILTER_EXCLUDED_PATHS = ['/snapshots/validate', '/snapshots/commit', '/snapshots/upload']

api.interceptors.request.use((config) => {
  const state = useAppStore.getState()
  if (state.adminToken) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${state.adminToken}`
  }

  const url = config.url || ''
  const isExcluded = FILTER_EXCLUDED_PATHS.some((p) => url.includes(p))
  if (isExcluded) return config

  config.params = config.params || {}
  if (config.params.include_deleted_lost === undefined && state.includeDeletedLost !== undefined) {
    config.params.include_deleted_lost = state.includeDeletedLost
  }
  if (config.params.types === undefined && state.globalFilters?.types !== undefined) {
    config.params.types = state.globalFilters.types
  }
  return config
})

// ── Snapshots ────────────────────────────────────────────────────────────────

export const getSnapshots = () =>
  api.get('/snapshots').then(r => r.data)

export const getSnapshot = (snapshotId: string) =>
  api.get(`/snapshots/${snapshotId}`).then(r => r.data)

export const getActiveSnapshot = () =>
  api.get('/snapshots/active').then(r => r.data)

export const getUploadHistory = () =>
  api.get('/snapshots/history').then(r => r.data)

export const validateUpload = (form: FormData) =>
  api.post('/snapshots/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)

export const commitUpload = (sessionId: string, replace = false, makeActive?: boolean) =>
  api.post('/snapshots/commit', { session_id: sessionId, replace, make_active: makeActive }).then(r => r.data)

export const getSnapshotChecks = (snapshotId: string) =>
  api.get(`/snapshots/${snapshotId}/checks`).then(r => r.data)

export const deleteSnapshot = (snapshotId: string) =>
  api.delete(`/snapshots/${snapshotId}`).then(r => r.data)

export const setActiveSnapshot = (snapshotId: string) =>
  api.post(`/snapshots/${snapshotId}/set-active`).then(r => r.data)

export const adminLogin = (password: string, name?: string) =>
  api.post('/admin/login', { password, name: name || 'Admin' }).then(r => r.data)

export const adminLogout = () =>
  api.post('/admin/logout').then(r => r.data)

export const getAdminStatus = () =>
  api.get('/admin/status').then(r => r.data)

export const uploadFiles = (form: FormData) =>
  api.post('/snapshots/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)

// ── Analytics ────────────────────────────────────────────────────────────────

export const getKpis = (snapshotId?: string) =>
  api.get('/analytics/kpis', { params: { snapshot_id: snapshotId } }).then(r => r.data)

export const getForecastSummary = (snapshotId?: string, compareTo?: string) =>
  api.get('/analytics/forecast-summary', {
    params: { snapshot_id: snapshotId, compare_to: compareTo },
  }).then(r => r.data)

export const getApprovalStatus = (snapshotId?: string, compareTo?: string) =>
  api.get('/analytics/approval-status', { params: { snapshot_id: snapshotId, compare_to: compareTo } }).then(r => r.data)

export const getApprovalByBu = (snapshotId?: string, mode?: string) =>
  api.get('/analytics/approval-by-bu', { params: { snapshot_id: snapshotId, mode } }).then(r => r.data)

export const getTopRegions = (snapshotId?: string, topN = 10) =>
  api.get('/analytics/top-regions', { params: { snapshot_id: snapshotId, top_n: topN } }).then(r => r.data)

export const getTopRegionsBu = (snapshotId?: string, topN = 10) =>
  api.get('/analytics/top-regions-bu', { params: { snapshot_id: snapshotId, top_n: topN } }).then(r => r.data)

export const getForecastMovement = (snapshotId?: string, compareTo?: string) =>
  api.get('/analytics/forecast-movement', {
    params: { snapshot_id: snapshotId, compare_to: compareTo },
  }).then(r => r.data)

export const getAcvChanges = (snapshotId?: string, compareTo?: string) =>
  api.get('/analytics/acv-changes', {
    params: { snapshot_id: snapshotId, compare_to: compareTo },
  }).then(r => r.data)

export const getExpiryQuarters = (snapshotId?: string) =>
  api.get('/analytics/expiry-quarters', { params: { snapshot_id: snapshotId } }).then(r => r.data)

export const getClosingYearTrend = (snapshotId?: string) =>
  api.get('/analytics/closing-year-trend', { params: { snapshot_id: snapshotId } }).then(r => r.data)

export const getTrendSparklines = (metric = 'total_acv', days = 30) =>
  api.get('/analytics/trend-sparklines', { params: { metric, days } }).then(r => r.data)

export const getComparison = (fromDate: string, toDate: string) =>
  api.get('/compare', { params: { from: fromDate, to: toDate } }).then(r => r.data)

export const getRegionsOverview = (snapshotId?: string, compareTo?: string, mode: string = 'as_in_excel') =>
  api.get('/analytics/regions', {
    params: { snapshot_id: snapshotId, compare_to: compareTo, mode },
  }).then(r => r.data)

export const getHistoryOverview = () =>
  api.get('/analytics/history-overview').then(r => r.data)

export function buildFilterParams(filters: Record<string, any> = {}): Record<string, any> {
  const state = useAppStore.getState()
  const { compare, ...rest } = filters
  const params: Record<string, any> = { ...rest }
  if (!params.as_of && state.activeSnapshotId) {
    params.as_of = state.activeSnapshotId
  }
  if (compare === 'yesterday' || compare === 'last_week' || compare === 'period_start') {
    params.compare = compare
  }
  if (params.types === undefined && state.globalFilters?.types !== undefined) {
    params.types = state.globalFilters.types
  }
  return params
}

// ── V2 Overview (Tab 1) ───────────────────────────────────────────────────────

export const getV2OverviewSummary = (filterSpec?: Partial<FilterSpec>) => {
  const state = useAppStore.getState()
  const as_of = filterSpec?.as_of || state.activeSnapshotId || state.globalFilters?.as_of || undefined
  const fs = buildFilterParams({ ...state.globalFilters, ...filterSpec, as_of })
  return api.get('/v2/overview/summary', { params: fs }).then(r => r.data)
}



export const getV2OverviewMovements = (compare: 'yesterday' | 'last_week' = 'yesterday', filterSpec?: Partial<FilterSpec>) => {
  const state = useAppStore.getState()
  const as_of = filterSpec?.as_of || state.activeSnapshotId || state.globalFilters?.as_of || undefined
  const fs = buildFilterParams({ ...state.globalFilters, ...filterSpec, as_of, compare })
  return api.get('/v2/overview/movements', { params: fs }).then(r => r.data)
}

export const getV2RegionalBreakdown = (filterSpec?: Partial<FilterSpec>) => {
  const state = useAppStore.getState()
  const as_of = filterSpec?.as_of || state.activeSnapshotId || state.globalFilters?.as_of || undefined
  const fs = buildFilterParams({ ...state.globalFilters, ...filterSpec, as_of })
  return api.get('/v2/overview/regional-breakdown', { params: fs }).then(r => r.data)
}

export const getV2OverviewDeals = (params: {
  category?: string
  region?: string
  approval_status?: string
  bu?: string
  ageing?: string
  start_year?: number
  expiry_year?: number
  split_key?: string
  review_type?: string
  kind?: string
  compare?: string
  as_of?: string
  exclude_deleted?: boolean
  deal_ids?: string
  filterSpec?: Partial<FilterSpec>
} = {}): Promise<{
  count: number
  acv: number
  filters_applied: Record<string, any>
  delta_groups?: {
    added: { name: string; count: number; acv: number; deals: any[] }
    left: { name: string; count: number; acv: number; deals: any[] }
    amount_changed: { name: string; count: number; acv: number; deals: any[] }
    net: { count: number; acv: number }
  }
  deals: any[]
}> => {
  const state = useAppStore.getState()
  const { filterSpec, compare, ...rest } = params
  const baseFilters: any = { ...state.globalFilters, ...filterSpec, ...rest }
  if (compare) {
    baseFilters.compare = compare
  } else {
    delete baseFilters.compare
  }
  const merged = buildFilterParams(baseFilters)
  if (!compare) {
    delete merged.compare
  }
  return api.get('/v2/overview/deals', { params: merged }).then(r => r.data)
}


// ── Opportunities ─────────────────────────────────────────────────────────────

export interface OppFilters {
  snapshotId?: string
  forecastCategory?: string[]
  approvalStatus?: string[]
  subRegion?: string[]
  businessUnit?: string[]
  businessUnitRaw?: string[]
  serviceExpiryPeriod?: string[]
  closingYear?: number[]
  minAcv?: number
  maxAcv?: number
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export const getOpportunities = (filters: OppFilters = {}) =>
  api.get('/opportunities', {
    params: {
      snapshot_id: filters.snapshotId,
      forecast_category: filters.forecastCategory,
      approval_status: filters.approvalStatus,
      sub_region: filters.subRegion,
      business_unit: filters.businessUnit,
      business_unit_raw: filters.businessUnitRaw,
      service_expiry_period: filters.serviceExpiryPeriod,
      closing_year: filters.closingYear,
      min_acv: filters.minAcv,
      max_acv: filters.maxAcv,
      search: filters.search,
      sort_by: filters.sortBy,
      sort_dir: filters.sortDir,
      page: filters.page ?? 1,
      page_size: filters.pageSize ?? 50,
    },
  }).then(r => r.data)

export const exportOpportunitiesUrl = (filters: OppFilters = {}) => {
  const state = useAppStore.getState()
  const params = new URLSearchParams()
  if (filters.snapshotId) params.append('snapshot_id', filters.snapshotId)
  if (state.includeDeletedLost) params.append('include_deleted_lost', 'true')
  filters.forecastCategory?.forEach(v => params.append('forecast_category', v))
  filters.approvalStatus?.forEach(v => params.append('approval_status', v))
  filters.subRegion?.forEach(v => params.append('sub_region', v))
  filters.businessUnit?.forEach(v => params.append('business_unit', v))
  filters.serviceExpiryPeriod?.forEach(v => params.append('service_expiry_period', v))
  filters.closingYear?.forEach(v => params.append('closing_year', String(v)))
  if (filters.minAcv != null) params.append('min_acv', String(filters.minAcv))
  if (filters.maxAcv != null) params.append('max_acv', String(filters.maxAcv))
  if (filters.search) params.append('search', filters.search)
  return `/api/opportunities/export?${params.toString()}`
}

export const getOpportunity = (oppId: string, snapshotId?: string) =>
  api.get(`/opportunities/${oppId}`, { params: { snapshot_id: snapshotId } }).then(r => r.data)

export const getOpportunityHistory = (oppId: string) =>
  api.get(`/opportunities/${oppId}/history`).then(r => r.data)

export const getOpportunityChangelog = (oppId: string) =>
  api.get(`/opportunities/${oppId}/changelog`).then(r => r.data)

export const getOpportunityFilterOptions = (snapshotId?: string) =>
  api.get('/opportunities/filter-options', { params: { snapshot_id: snapshotId } }).then(r => r.data)


// ── Reports & Exports ────────────────────────────────────────────────────────

export const downloadReport = async (
  format: 'pptx' | 'xlsx',
  snapshotId?: string | null,
  compareTo?: string | null,
  scope: string = 'renewals',
  includeDeletedLost?: boolean | null
): Promise<{ filename: string }> => {
  const state = useAppStore.getState()
  const endpoint = format === 'pptx' ? '/export/pptx' : '/export/excel'
  const params: Record<string, string> = {}
  if (snapshotId) params.snapshot_id = snapshotId
  if (compareTo) params.compare_to = compareTo
  params.scope = scope || 'renewals'
  const incl = includeDeletedLost !== undefined && includeDeletedLost !== null ? includeDeletedLost : (state.includeDeletedLost ?? false)
  params.include_deleted_lost = incl ? 'true' : 'false'
  if (state.globalFilters?.types && state.globalFilters.types.length > 0) {
    params.types = state.globalFilters.types.join(',')
  }

  const response = await api.get(endpoint, {
    params,
    responseType: 'blob',
  })

  let filename = `Mobileum_Renewals_Daily_Update.${format}`
  const disposition = response.headers['content-disposition']
  if (disposition) {
    const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1].replace(/['"]/g, '')
    }
  }

  const blob = new Blob([response.data], {
    type:
      format === 'pptx'
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.URL.revokeObjectURL(url)

  return { filename }
}


export default api


// ── V2 Expiry ─────────────────────────────────────────────────────────────
export const getV2ExpirySummary = async (params: {
  as_of?: string | null
  compare?: string | null
  exclude_deleted_lost?: boolean
  period_type?: string
  filterSpec?: Partial<FilterSpec>
} = {}) => {
  const state = useAppStore.getState()
  const p: any = buildFilterParams({ ...state.globalFilters, ...params.filterSpec })
  if (params.as_of) p.as_of = params.as_of
  if (params.compare === 'yesterday' || params.compare === 'last_week') p.compare = params.compare
  if (params.exclude_deleted_lost !== undefined) p.include_deleted_lost = !params.exclude_deleted_lost
  if (params.period_type) p.period_type = params.period_type
  const res = await api.get('/v2/expiry/summary', { params: p })
  return res.data
}

export const getV2ExpiryDeals = async (params: {
  quarter?: string
  category?: string
  as_of?: string | null
  exclude_deleted_lost?: boolean
  slippage?: boolean
  period_type?: string
  kind?: string
  filterSpec?: Partial<FilterSpec>
} = {}) => {
  const state = useAppStore.getState()
  const p: any = buildFilterParams({ ...state.globalFilters, ...params.filterSpec })
  if (params.quarter) p.quarter = params.quarter
  if (params.category) p.category = params.category
  if (params.as_of) p.as_of = params.as_of
  if (params.slippage !== undefined) p.slippage = params.slippage
  if (params.kind) p.kind = params.kind
  p.period_type = params.period_type || 'fiscal'
  if (params.exclude_deleted_lost !== undefined) p.include_deleted_lost = !params.exclude_deleted_lost
  const res = await api.get('/v2/expiry/deals', { params: p })
  return res.data
}

export const getApprovalsDistribution = async (as_of?: string, compare: string | null = null, include_deleted_lost?: boolean, filterSpec?: Partial<FilterSpec>) => {
  const state = useAppStore.getState()
  const params: any = buildFilterParams({ ...state.globalFilters, ...filterSpec })
  if (as_of) params.as_of = as_of
  if (compare === 'yesterday' || compare === 'last_week') params.compare = compare
  if (include_deleted_lost !== undefined) params.include_deleted_lost = include_deleted_lost
  return api.get('/v2/approvals/distribution', { params }).then(r => r.data)
}

export const getApprovalsDeals = async (
  as_of?: string,
  status?: string,
  category?: string,
  include_deleted_lost?: boolean,
  region?: string,
  business_unit?: string,
  filterSpec?: Partial<FilterSpec>,
  min_acv?: number,
  max_acv?: number,
  deal_ids?: string,
  kind?: string
) => {
  const state = useAppStore.getState()
  const params: any = buildFilterParams({ ...state.globalFilters, ...filterSpec })
  if (as_of) params.as_of = as_of
  if (status) params.status = status
  if (category) params.category = category
  if (region) params.region = region
  if (business_unit) params.business_unit = business_unit
  if (min_acv !== undefined && min_acv !== null) params.min_acv = min_acv
  if (max_acv !== undefined && max_acv !== null) params.max_acv = max_acv
  if (deal_ids) params.deal_ids = deal_ids
  if (kind) params.kind = kind
  if (include_deleted_lost !== undefined) params.include_deleted_lost = include_deleted_lost
  return api.get('/v2/approvals/deals', { params }).then(r => r.data)
}

// ── V2 Regions, BU, Delayed ─────────────────────────────────────────────
export const getV2RegionsSummary = async (params: { as_of?: string | null; compare?: string } = {}) => {
  const state = useAppStore.getState()
  const p: any = buildFilterParams({ ...state.globalFilters, ...params })
  const res = await api.get('/v2/regions/summary', { params: p })
  return res.data
}

export const getV2BusinessUnitsSummary = async (params: { as_of?: string | null; compare?: string } = {}) => {
  const state = useAppStore.getState()
  const p: any = buildFilterParams({ ...state.globalFilters, ...params })
  const res = await api.get('/v2/business-units/summary', { params: p })
  return res.data
}

export const getV2DelayedSummary = async (params: { as_of?: string | null; compare?: string } = {}) => {
  const state = useAppStore.getState()
  const p: any = buildFilterParams({ ...state.globalFilters, ...params })
  const res = await api.get('/v2/delayed/summary', { params: p })
  return res.data
}

// ── V2 Filters Options ───────────────────────────────────────────────────
export const getFilterOptions = async (asOf?: string | null) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  const res = await api.get('/v2/filters/options', { params })
  return res.data
}

// ── V2 Data Explorer ───────────────────────────────────────────────────
export const getExplorerColumns = async (asOf?: string | null) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  const res = await api.get('/v2/explorer/columns', { params })
  return res.data
}

export const getExplorerRows = async (payload: any, asOf?: string | null) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  const res = await api.post('/v2/explorer/rows', payload, { params })
  return res.data
}

export const exportExplorerData = async (payload: any, asOf?: string | null) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  const res = await api.post('/v2/explorer/export', payload, {
    params,
    responseType: 'blob',
  })
  return res
}

export const getExplorerReconcile = async (asOf?: string | null, payload?: any) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  if (payload) {
    const res = await api.post('/v2/explorer/reconcile', payload, { params })
    return res.data
  }
  const res = await api.get('/v2/explorer/reconcile', { params })
  return res.data
}

export const getExplorerQuickFilters = async (asOf?: string | null) => {
  const params: any = {}
  if (asOf) params.as_of = asOf
  const res = await api.get('/v2/explorer/quick-filters', { params })
  return res.data
}

// ── Health ───────────────────────────────────────────────────────────────
export const getHealth = async () => {
  const res = await api.get('/health')
  return res.data
}

// ── Custom Columns & Deal Annotations ────────────────────────────────────
export interface CustomColumnItem {
  id: string
  key: string
  label: string
  type: string
  dropdown_options: string[]
  sort_order: number
  source_header?: string | null
  is_deleted: boolean
  values_count?: number
  created_by: string
  created_at: string
}

export interface DealAnnotationItem {
  id?: string
  opportunity_id_18: string
  column_key: string
  value: string | null
  source: 'excel' | 'app'
  updated_by: string
  updated_at: string
  version: number
}

export interface AnnotationAuditItem {
  id: string
  entity_type?: string
  entity_id?: string
  column_key?: string | null
  opportunity_id_18?: string | null
  action: string
  old_value?: string | null
  new_value?: string | null
  user_id?: string
  changed_by?: string
  timestamp?: string
  created_at?: string
  extra_info?: any
}

export const getCustomColumns = async (includeDeleted: boolean = false): Promise<CustomColumnItem[]> => {
  const res = await api.get('/custom-columns', { params: { include_deleted: includeDeleted } })
  return res.data.columns || []
}

export const createCustomColumn = async (data: {
  label: string
  type: string
  dropdown_options?: string[]
  sort_order?: number
}): Promise<CustomColumnItem> => {
  const res = await api.post('/custom-columns', data)
  return res.data.column
}

export const bulkCreateCustomColumns = async (
  columns: { label: string; type: string; dropdown_options?: string[] }[]
): Promise<CustomColumnItem[]> => {
  const res = await api.post('/custom-columns/bulk', { columns })
  return res.data.columns || []
}

export const updateCustomColumn = async (
  columnId: string,
  data: {
    label?: string
    type?: string
    dropdown_options?: string[]
    sort_order?: number
  }
): Promise<CustomColumnItem> => {
  const res = await api.patch(`/custom-columns/${columnId}`, data)
  return res.data.column
}

export const renameCustomColumn = async (columnId: string, label: string): Promise<CustomColumnItem> => {
  const res = await api.post(`/custom-columns/${columnId}/rename`, { label })
  return res.data.column
}

export const moveCustomColumn = async (columnId: string, direction: 'left' | 'right'): Promise<CustomColumnItem[]> => {
  const res = await api.post(`/custom-columns/${columnId}/move`, { direction })
  return res.data.columns || []
}

export const restoreCustomColumn = async (columnId: string): Promise<CustomColumnItem> => {
  const res = await api.post(`/custom-columns/${columnId}/restore`)
  return res.data.column
}

export const deleteCustomColumn = async (columnId: string): Promise<{ deleted: boolean; column: CustomColumnItem; values_count: number }> => {
  const res = await api.delete(`/custom-columns/${columnId}`)
  return res.data
}

export const getGlobalAuditLog = async (params: {
  user?: string
  column?: string
  deal?: string
  date_from?: string
  date_to?: string
  limit?: number
}): Promise<{ audit: AnnotationAuditItem[]; count: number }> => {
  const res = await api.get('/custom-columns/audit', { params })
  return res.data
}

export const downloadGlobalAuditLog = async (params: {
  user?: string
  column?: string
  deal?: string
  date_from?: string
  date_to?: string
}): Promise<{ data: Blob; filename: string }> => {
  const res = await api.get('/custom-columns/audit/export', {
    params,
    responseType: 'blob',
  })
  return { data: res.data, filename: 'change_log.csv' }
}

export const downloadExplorerData = async (params: {
  as_of?: string | null
  format: 'xlsx' | 'csv'
  rows: 'all' | 'filtered'
  payload: any
}): Promise<{ data: Blob; filename: string }> => {
  const queryParams: any = {
    format: params.format,
    rows: params.rows,
  }
  if (params.as_of) queryParams.as_of = params.as_of
  const res = await api.post('/v2/explorer/download', params.payload, {
    params: queryParams,
    responseType: 'blob',
  })
  let filename = `Renewals_Export.${params.format}`
  const disp = res.headers['content-disposition']
  if (disp && disp.includes('filename=')) {
    const match = disp.match(/filename=["']?([^"';]+)["']?/)
    if (match && match[1]) filename = match[1]
  }
  return { data: res.data, filename }
}

export const getDealAnnotations = async (
  opportunityId: string
): Promise<Record<string, DealAnnotationItem>> => {
  const res = await api.get(`/custom-columns/deals/${opportunityId}/annotations`)
  return res.data.annotations || {}
}

export const setDealAnnotation = async (
  opportunityId: string,
  columnKey: string,
  value: any,
  expectedVersion?: number
): Promise<any> => {
  const res = await api.put(`/custom-columns/deals/${opportunityId}/annotations/${columnKey}`, {
    value,
    expected_version: expectedVersion,
  })
  return res.data
}

export const deleteDealAnnotation = async (
  opportunityId: string,
  columnKey: string
): Promise<any> => {
  const res = await api.delete(`/custom-columns/deals/${opportunityId}/annotations/${columnKey}`)
  return res.data
}

export const getDealAudit = async (opportunityId: string): Promise<AnnotationAuditItem[]> => {
  const res = await api.get(`/custom-columns/deals/${opportunityId}/audit`)
  return res.data.audit || []
}

export const exportAnnotationsBackup = async (): Promise<any> => {
  const res = await api.get('/custom-columns/backup/export')
  return res.data
}

export const downloadFullExcel = async (snapshotId?: string | null): Promise<{ data: Blob; filename: string }> => {
  const params: any = {}
  if (snapshotId) params.snapshot_id = snapshotId
  const res = await api.get('/custom-columns/export-full-excel', {
    params,
    responseType: 'blob',
  })
  let filename = 'Renewals_Full_Export.xlsx'
  const disp = res.headers['content-disposition']
  if (disp && disp.includes('filename=')) {
    const match = disp.match(/filename=["']?([^"';]+)["']?/)
    if (match && match[1]) filename = match[1]
  }
  return { data: res.data, filename }
}


