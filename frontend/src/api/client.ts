import axios from 'axios'
import { useAppStore, FilterSpec } from '../store/appStore'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: {
    indexes: null,
  },
})

// Static hosts can return index.html for /api requests when their proxy is missing.
// Treat that as a connection error instead of accepting it as empty application data.
api.interceptors.response.use(
  (response) => {
    if (typeof response.data === 'string' &&
        (String(response.headers['content-type'] || '').includes('text/html') ||
         /^\s*(<!doctype html|<html)/i.test(response.data))) {
      throw new Error('The app cannot reach the API. Check that the backend is running and /api is routed to it.')
    }
    return response
  },
  (error) => {
    // 401 Unauthorized handling: clear auth and redirect to login
    if (error?.response?.status === 401) {
      const url = error.config?.url || ''
      // Never intercept login, logout, or initial auth check endpoint (/auth/me, /admin/status)
      if (!url.includes('/auth/login') && !url.includes('/auth/logout') && !url.includes('/auth/me') && !url.includes('/admin/status')) {
        try {
          localStorage.removeItem('horizon_auth_state')
          import('../store/authStore').then(({ useAuthStore }) => {
            useAuthStore.getState().setCurrentUser(null)
          }).catch(() => {})
        } catch (_) {}
        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
          window.location.href = '/login?expired=1'
        }
      }
    }
    return Promise.reject(error)
  }
)

// Upload/commit/validate endpoints are body-only — they must NOT receive extra query params.
const FILTER_EXCLUDED_PATHS = ['/snapshots/validate', '/snapshots/commit', '/snapshots/upload']

api.interceptors.request.use((config) => {
  const url = config.url || ''
  const isExcluded = FILTER_EXCLUDED_PATHS.some((p) => url.includes(p))
  if (isExcluded) return config

  const state = useAppStore.getState()
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

export const getSecurityChecks = () =>
  api.get('/admin/security-checks').then(r => r.data)

export const getSystemSettings = () =>
  api.get('/settings').then(r => r.data)

export const updateSystemSetting = (key: string, value: string, description?: string) =>
  api.put('/settings', { key, value, description }).then(r => r.data)

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
  includeDeletedLost?: boolean | null,
  period?: string | null,
  filterSpecOverride?: Partial<FilterSpec>
): Promise<{ filename: string }> => {
  const state = useAppStore.getState()
  const endpoint = format === 'pptx' ? '/export/pptx' : '/export/excel'
  const params: Record<string, string> = {}
  if (snapshotId) params.snapshot_id = snapshotId
  if (compareTo) params.compare_to = compareTo
  params.scope = scope || 'renewals'
  
  const fs = { ...(state.globalFilters || {}), ...filterSpecOverride }
  const incl = includeDeletedLost !== undefined && includeDeletedLost !== null 
    ? includeDeletedLost 
    : (fs.include_deleted_lost !== undefined ? fs.include_deleted_lost : (state.includeDeletedLost ?? false))
  params.include_deleted_lost = incl ? 'true' : 'false'

  const effPeriod = period || fs.period || 'current_quarter'
  params.period = effPeriod

  if (fs.types && fs.types.length > 0) {
    params.types = fs.types.join(',')
  } else if (state.globalFilters?.types && state.globalFilters.types.length > 0) {
    params.types = state.globalFilters.types.join(',')
  }
  if (fs.regions && fs.regions.length > 0) {
    params.regions = fs.regions.join(',')
  }
  if (fs.business_units && fs.business_units.length > 0) {
    params.business_units = fs.business_units.join(',')
  }
  if (fs.forecast_categories && fs.forecast_categories.length > 0) {
    params.forecast_categories = fs.forecast_categories.join(',')
  }
  if (fs.approval_statuses && fs.approval_statuses.length > 0) {
    params.approval_statuses = fs.approval_statuses.join(',')
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

export const getV2DelayedDeals = async (params: {
  as_of?: string | null
  compare?: string
  kind?: string
  region?: string
  category?: string
  status?: string
  bu?: string
  ageing?: string
  owner?: string
  expiry_year?: number
  start_year?: number
  close_year?: number
  split_key?: string
  review_type?: string
  deal_ids?: string
  filterSpec?: Partial<FilterSpec>
} = {}) => {
  const state = useAppStore.getState()
  const { filterSpec, ...rest } = params
  const p: any = buildFilterParams({ ...state.globalFilters, ...filterSpec, ...rest })
  const res = await api.get('/v2/delayed/deals', { params: p })
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
  visibility?: 'internal' | 'visible_to_owner'
  creator_role?: string
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
  visibility?: 'internal' | 'visible_to_owner'
}): Promise<CustomColumnItem> => {
  const res = await api.post('/custom-columns', data)
  return res.data.column
}

export const bulkCreateCustomColumns = async (
  columns: { label: string; type: string; dropdown_options?: string[]; visibility?: 'internal' | 'visible_to_owner' }[]
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
    visibility?: 'internal' | 'visible_to_owner'
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

export interface DealCommentItem {
  id: string
  opportunity_id_18: string
  author: string
  text: string
  is_deleted?: boolean
  created_at: string
  updated_at: string
  edited_at?: string | null
  deleted_at?: string | null
  visibility?: 'internal' | 'shared_with_owner' | 'shared'
  author_id?: string
  author_role?: string
  recipients?: string[]
  delivery_status?: string
  batch_id?: string | null
}

export interface CommentMessageHistoryItem {
  id: string
  action: 'edit' | 'unsend' | 'delete' | string
  previous_text?: string | null
  new_text?: string | null
  previous_visibility?: string | null
  new_visibility?: string | null
  actor_name: string
  actor_role: string
  created_at: string
}

export const getDealComments = async (opportunityId: string): Promise<DealCommentItem[]> => {
  const res = await api.get(`/custom-columns/deals/${opportunityId}/comments`)
  return res.data.comments || []
}

export const addDealComment = async (
  opportunityId: string,
  text: string,
  author?: string,
  visibility?: 'internal' | 'shared_with_owner',
  recipient_ids?: string[]
): Promise<DealCommentItem> => {
  const res = await api.post(`/custom-columns/deals/${opportunityId}/comments`, {
    text,
    author,
    visibility,
    recipient_ids,
  })
  return res.data.comment
}

export const updateDealComment = async (
  opportunityId: string,
  commentId: string,
  text: string,
  visibility?: 'internal' | 'shared_with_owner'
): Promise<DealCommentItem> => {
  const res = await api.put(`/custom-columns/deals/${opportunityId}/comments/${commentId}`, {
    text,
    visibility,
  })
  return res.data.comment
}

export const deleteDealComment = async (
  opportunityId: string,
  commentId: string
): Promise<boolean> => {
  const res = await api.delete(`/custom-columns/deals/${opportunityId}/comments/${commentId}`)
  return res.data.deleted ?? res.data.ok ?? true
}

export const getDealCommentHistory = async (
  opportunityId: string,
  commentId: string
): Promise<CommentMessageHistoryItem[]> => {
  const res = await api.get(`/custom-columns/deals/${opportunityId}/comments/${commentId}/history`)
  return res.data.history || []
}

export const getCommentHistoryById = async (
  commentId: string
): Promise<CommentMessageHistoryItem[]> => {
  const res = await api.get(`/comments/${commentId}/history`)
  return res.data.history || []
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUND 18: AUTHENTICATION, ROLES, KAM PORTAL, MESSAGING, EMAIL OUTBOX
// ══════════════════════════════════════════════════════════════════════════════

// ── Auth Endpoints ───────────────────────────────────────────────────────────
export const authLogin = async (email: string, password: string, remember_me = true) => {
  const res = await api.post('/auth/login', { email, password, remember_me })
  return res.data
}

export const authLogout = async () => {
  const res = await api.post('/auth/logout')
  return res.data
}

export const getAuthMe = async () => {
  const res = await api.get('/auth/me')
  return res.data
}

export const authChangePassword = async (current_password: string, new_password: string, confirm_password?: string) => {
  const res = await api.post('/auth/change-password', {
    current_password,
    new_password,
    confirm_password: confirm_password || new_password,
  })
  return res.data
}

export const forgotPassword = async (email: string) => {
  const res = await api.post('/auth/forgot-password', { email })
  return res.data
}

export const verifyInviteToken = async (token: string) => {
  const res = await api.get('/auth/invite/verify', { params: { token } })
  return res.data
}

export const setInvitePassword = async (token: string, password: string, confirmPassword?: string) => {
  const res = await api.post('/auth/invite/set-password', {
    token,
    password,
    confirm_password: confirmPassword || password,
  })
  return res.data
}

export const resetPasswordWithToken = async (token: string, password: string, confirmPassword?: string) => {
  const res = await api.post('/auth/reset-password', {
    token,
    password,
    confirm_password: confirmPassword || password,
  })
  return res.data
}

// ── Admin User Management ────────────────────────────────────────────────────
export interface AdminUserItem {
  id: string
  name: string
  email: string
  role: 'admin' | 'management' | 'kam'
  is_owner: boolean
  owner_name?: string
  status: 'active' | 'invited' | 'disabled' | 'pending_email'
  must_change_password: boolean
  last_login?: string
  created_at?: string
  aliases: string[]
}

export const getAdminUsers = async (): Promise<{ users: AdminUserItem[] }> => {
  const res = await api.get('/admin/users')
  return res.data
}

export const createAdminUser = async (data: {
  name: string
  email: string
  role: 'admin' | 'management' | 'kam'
  owner_name?: string
  aliases?: string[]
}) => {
  const res = await api.post('/admin/users', data)
  return res.data
}

export const updateAdminUser = async (
  userId: string,
  data: {
    name?: string
    email?: string
    role?: 'admin' | 'management' | 'kam'
    status?: 'active' | 'disabled' | 'invited'
    owner_name?: string
    aliases?: string[]
    admin_password?: string
  }
) => {
  const res = await api.put(`/admin/users/${userId}`, data)
  return res.data
}

export const toggleAdminUserStatus = async (userId: string, status: 'active' | 'disabled') => {
  const res = await api.post(`/admin/users/${userId}/status`, { status })
  return res.data
}

export const deleteAdminUser = async (userId: string) => {
  const res = await api.delete(`/admin/users/${userId}`)
  return res.data
}

export const getUserInviteLink = async (
  userId: string
): Promise<{ invite_url: string; expires_at: string; expires_in_hours?: number }> => {
  const res = await api.post(`/admin/users/${userId}/invite-link`)
  return res.data
}

export const getUserResetLink = async (
  userId: string
): Promise<{ reset_url: string; expires_at: string; expires_in_hours?: number; invite_url?: string }> => {
  const res = await api.post(`/admin/users/${userId}/reset-link`)
  return res.data
}

export const addUserAlias = async (userId: string, alias_name: string) => {
  const res = await api.post(`/admin/users/${userId}/aliases`, { alias_name })
  return res.data
}

export const deleteUserAlias = async (userId: string, alias_name: string) => {
  const res = await api.delete(`/admin/users/${userId}/aliases/${encodeURIComponent(alias_name)}`)
  return res.data
}

export const uploadKamRoster = async (file: File) => {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post('/admin/kam-list/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data
}

export const getKamSyncAlerts = async () => {
  const res = await api.get('/admin/kam-sync/alerts')
  return res.data
}

export const resolveKamSyncAlert = async (alertId: string, resolution: string) => {
  const res = await api.post(`/admin/kam-sync/alerts/${alertId}/resolve`, { resolution })
  return res.data
}

export const getAuditLogs = async (params: { page?: number; limit?: number; action?: string; user_id?: string } = {}) => {
  const res = await api.get('/admin/users/audit-logs', { params })
  return res.data
}

// ── Email Admin & Outbox ─────────────────────────────────────────────────────
export interface MailDiagnosticVariable {
  set: boolean
  value: string | boolean | number
}

export interface MailDiagnostics {
  env_file_path: string
  env_file_exists: boolean
  mail_enabled: boolean
  mail_active?: boolean
  is_configured: boolean
  inactive_reason: string
  timeout?: number
  timeout_seconds?: number
  variables: Record<string, MailDiagnosticVariable>
}

export interface EmailOutboxItem {
  id: string
  recipient_email?: string
  to_email?: string
  recipient_name?: string
  recipient_role?: string
  subject: string
  body_text?: string
  template?: string
  template_type?: string
  status: string
  attempts?: number
  retry_count?: number
  error_message?: string
  created_at: string
  sent_at?: string
}

export interface EmailOutboxResponse {
  emails: EmailOutboxItem[]
  outbox?: EmailOutboxItem[]
  total_count: number
  smtp_configured: boolean
  inactive_reason?: string
  config?: any
  diagnostics?: MailDiagnostics
}

export const getEmailOutbox = async (params: { status?: string; limit?: number } = {}): Promise<EmailOutboxResponse> => {
  const res = await api.get('/admin/email/outbox', { params })
  return res.data
}

export const getEmailDiagnostics = async (): Promise<MailDiagnostics> => {
  const res = await api.get('/admin/email/diagnostics')
  return res.data
}

export const sendTestEmail = async (to_email: string): Promise<{ status: string; delivered: boolean; detail: string }> => {
  const res = await api.post('/admin/email/test', { recipient_email: to_email, to_email })
  return res.data
}

export const resendPendingEmails = async (): Promise<{ status: string; dispatched: number; sent_count: number; retried_count: number; failed_count: number }> => {
  const res = await api.post('/admin/email/resend-pending')
  return res.data
}

export const cancelOutboxEmail = async (itemId: string): Promise<{ status: string; id: string; item_status: string }> => {
  const res = await api.post(`/admin/email/outbox/${itemId}/cancel`)
  return res.data
}

export const deleteOutboxEmail = async (itemId: string): Promise<{ status: string; deleted_id: string }> => {
  const res = await api.delete(`/admin/email/outbox/${itemId}`)
  return res.data
}

export const sendOutboxEmailNow = async (itemId: string): Promise<{ status: string; delivered: boolean; detail: string; item_status: string }> => {
  const res = await api.post(`/admin/email/outbox/${itemId}/send-now`)
  return res.data
}

export const retryOutboxEmail = async (itemId: string): Promise<{ status: string; delivered: boolean; detail: string; item_status: string; recipient?: any }> => {
  const res = await api.post(`/admin/email/outbox/${itemId}/retry`)
  return res.data
}

export const retryFailedEmails = async (): Promise<{ status: string; retried_count: number; sent_count: number; failed_count: number; recipients: any[] }> => {
  const res = await api.post('/admin/email/retry-failed')
  return res.data
}

// ── Messaging Hub ────────────────────────────────────────────────────────────
export interface DealMessageThreadItem {
  thread_id: string
  deal_id: string
  deal_name: string
  account_name: string
  forecast_acv_amount: number
  subject: string
  priority: string
  thread_status: string
  sender_name: string
  recipient_name: string
  message_count: number
  unread_count: number
  latest_message_at?: string
  created_at?: string
}

export interface DealMessageDetail {
  id: string
  thread_id?: string
  parent_id?: string
  sender_id?: string
  sender_name: string
  sender_role: string
  is_me: boolean
  subject: string
  body: string
  priority: string
  is_read: boolean
  is_deleted?: boolean
  created_at: string
  edited_at?: string | null
  deleted_at?: string | null
  delivery_status?: string
  recipients?: string[]
  recipient_ids?: string[]
}

export const getMessageThreads = async (params: { deal_id?: string; thread_status?: string } = {}) => {
  const res = await api.get('/messages/threads', { params })
  return res.data
}

export const getDealMessages = async (dealId: string): Promise<{ messages: DealMessageDetail[]; opportunity?: any }> => {
  const res = await api.get(`/messages/deal/${dealId}`)
  return res.data
}

export const sendDealMessage = async (data: {
  deal_id: string
  subject: string
  body: string
  priority?: string
  recipient_ids?: string[]
}) => {
  const res = await api.post('/messages', data)
  return res.data
}

export const replyDealMessage = async (messageId: string, body: string, recipient_ids?: string[]) => {
  const res = await api.post(`/messages/${messageId}/reply`, { body, recipient_ids })
  return res.data
}

export const updateDealMessage = async (messageId: string, body: string) => {
  const res = await api.put(`/messages/${messageId}`, { body })
  return res.data
}

export const unsendDealMessage = async (messageId: string) => {
  const res = await api.delete(`/messages/${messageId}`)
  return res.data
}

export const getMessageHistory = async (messageId: string): Promise<CommentMessageHistoryItem[]> => {
  const res = await api.get(`/messages/${messageId}/history`)
  return res.data.history || []
}

export const markMessageRead = async (messageId: string) => {
  const res = await api.post(`/messages/${messageId}/read`)
  return res.data
}

// ── KAM Portal Endpoints ─────────────────────────────────────────────────────
export const getKamOverview = async (params: { as_of?: string | null; period?: string | null; types?: string | null; compare?: string | null } = {}) => {
  const p: any = {}
  if (params.as_of) p.as_of = params.as_of
  if (params.period) p.period = params.period
  if (params.types) p.types = params.types
  if (params.compare) p.compare = params.compare
  const res = await api.get('/kam/overview', { params: p })
  return res.data
}

export const downloadKamReport = async (
  format: 'pptx' | 'pdf',
  params: { as_of?: string | null; period?: string | null; types?: string | null; compare?: string | null } = {}
): Promise<{ blob: Blob; filename: string }> => {
  const p: any = {}
  if (params.as_of) p.as_of = params.as_of
  if (params.period) p.period = params.period
  if (params.types) p.types = params.types
  if (params.compare) p.compare = params.compare
  const res = await api.get(`/kam/report/${format}`, {
    params: p,
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] || ''
  let filename = `KAM_Report.${format}`
  const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
  if (match && match[1]) {
    filename = match[1].replace(/['"]/g, '')
  }
  const blob = new Blob([res.data], {
    type: format === 'pptx'
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : 'application/pdf',
  })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return { blob, filename }
}

export const getKamDeals = async (params: {
  category?: string
  status?: string
  stage?: string
  search?: string
  as_of?: string | null
  period?: string | null
  types?: string | null
} = {}) => {
  const p: any = {}
  if (params.category) p.category = params.category
  if (params.status) p.status = params.status
  if (params.stage) p.stage = params.stage
  if (params.search) p.search = params.search
  if (params.as_of) p.as_of = params.as_of
  if (params.period) p.period = params.period
  if (params.types) p.types = params.types
  const res = await api.get('/kam/deals', { params: p })
  return res.data
}

export const searchGlobal = async (params: { q: string; as_of?: string; limit?: number }) => {
  const res = await api.get('/search', { params })
  return res.data
}

// ── Snapshot Calendar ────────────────────────────────────────────────────────
export const getSnapshotCalendar = async (year?: number, month?: number) => {
  const params: any = {}
  if (year != null) params.year = year
  if (month != null) params.month = month
  const res = await api.get('/snapshots/calendar', { params })
  return res.data
}

// ── Notification Centre ──────────────────────────────────────────────────────
export interface NotificationItem {
  id: string
  user_id: string
  category: 'message' | 'reply' | 'comment' | 'alert' | 'email_failure' | string
  title: string
  message: string
  deal_id?: string | null
  deal_name?: string | null
  target_type: string
  target_id?: string | null
  is_read: boolean
  created_at: string
  read_at?: string | null
}

export const getNotifications = async (
  category?: string,
  limit = 50
): Promise<{
  notifications: NotificationItem[]
  unread_count: number
  unread_by_category?: { messages: number; comments: number; alerts: number; total: number }
}> => {
  const params: any = { limit }
  if (category && category !== 'all') params.category = category
  const res = await api.get('/notifications', { params })
  return res.data
}

export const markNotificationRead = async (id: string) => {
  const res = await api.post(`/notifications/${id}/read`)
  return res.data
}

export const markAllNotificationsRead = async () => {
  const res = await api.post('/notifications/read-all')
  return res.data
}

// ── Recipients & Email Log ───────────────────────────────────────────────────
export interface RecipientUser {
  id: string
  name: string
  role: string
  is_owner?: boolean
  has_email?: boolean
  count?: number
}

export interface RecipientOptions {
  deal_owner?: RecipientUser | null
  management: RecipientUser[]
  admins: RecipientUser[]
  admin_count?: number
  management_count?: number
  defaults: string[] | { message?: string[]; reply?: string[]; comment?: string[] }
}

export const getMessageRecipients = async (deal_id?: string): Promise<RecipientOptions> => {
  const params: any = {}
  if (deal_id) params.deal_id = deal_id
  const res = await api.get('/messages/recipients', { params })
  return res.data
}

export interface EmailLogRecipientDetail {
  id: string
  name: string
  role: string
  status: string
  reason?: string | null
  attempts: number
  sent_at?: string | null
}

export interface EmailLogItem {
  id: string
  created_at?: string | null
  sent_at?: string | null
  event_type?: string
  template_type: string
  deal_id?: string | null
  deal_name?: string | null
  author_name?: string
  sender_name: string
  author_role?: string
  sender_role: string
  subject?: string
  recipient_summary?: string
  recipient_name: string
  recipient_role: string
  status: string
  attempts?: number
  error_message?: string | null
  sent_count?: number
  failed_count?: number
  skipped_count?: number
  pending_count?: number
  total_count?: number
  body_preview?: string | null
  recipients?: EmailLogRecipientDetail[]
  details_redacted?: boolean
}

export const getEmailLog = async (limit = 100): Promise<{ log: EmailLogItem[]; events?: EmailLogItem[] }> => {
  const res = await api.get('/messages/email-log', { params: { limit } })
  return res.data
}

export interface CommentLogItem {
  id: string
  deal_id: string
  deal_name: string
  account_name: string
  text: string
  is_deleted?: boolean
  visibility: 'internal' | 'shared'
  author: string
  author_id?: string | null
  author_role: string
  batch_id?: string | null
  created_at: string | null
  edited_at?: string | null
  deleted_at?: string | null
  created_at_formatted: string
  recipients: string[]
  email_status: 'emailed' | 'queued' | 'failed' | 'partial'
}

export interface CommentsLogResponse {
  items: CommentLogItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
  tab: string
}

export const getCommentsLog = async (params: {
  page?: number
  page_size?: number
  tab?: 'my' | 'all'
  search?: string
  visibility?: string
  author?: string
  author_role?: string
  deal?: string
  account?: string
  start_date?: string
  end_date?: string
  limit_to_period?: boolean
  period?: string
  as_of?: string | null
}): Promise<CommentsLogResponse> => {
  const res = await api.get('/comments/log', { params })
  return res.data
}

export interface BatchCommentPayload {
  deal_ids: string[]
  text: string
  visibility?: 'internal' | 'shared_with_owner'
  recipient_ids?: string[]
}

export interface BatchCommentResponse {
  success: boolean
  batch_id: string
  comments_created: number
  total_recipients: number
}

export const addBatchComment = async (payload: BatchCommentPayload): Promise<BatchCommentResponse> => {
  const res = await api.post('/comments/batch', payload)
  return res.data
}

// ── Microsoft SSO (Entra ID) ────────────────────────────────────────────────
export interface SSOPublicConfig {
  sso_enabled: boolean
  sso_local_login_enabled: boolean
  sso_password_login_for_users: boolean
  provider_name: string
  button_label: string
  login_url: string
}

export interface SSOAdminDiagnostics {
  sso_enabled: boolean
  tenant_id: string
  client_id: string
  client_secret_configured: boolean
  client_secret_expires: string | null
  redirect_uri: string
  allowed_domains: string[]
  email_claim: string
  local_login_enabled: boolean
  password_login_for_users: boolean
}

export interface SSOAccessRequestItem {
  id: string
  email: string
  name: string | null
  tenant_id: string | null
  status: 'pending' | 'approved' | 'dismissed'
  attempt_count: number
  created_at: string
  last_attempt_at: string
  reviewed_by: string | null
  reviewed_at: string | null
}

export const getSSOConfig = async (): Promise<SSOPublicConfig> => {
  const res = await api.get('/auth/sso/config')
  return res.data
}

export const getSSODiagnostics = async (): Promise<SSOAdminDiagnostics> => {
  const res = await api.get('/admin/sso/diagnostics')
  return res.data
}

export const testSSOConnection = async (): Promise<{ status: string; detail: string; tenant_id?: string; keys_found?: number }> => {
  const res = await api.post('/admin/sso/test-connection')
  return res.data
}

export const getSSOAccessRequests = async (status: string = 'pending'): Promise<SSOAccessRequestItem[]> => {
  const res = await api.get('/admin/sso/access-requests', { params: { status } })
  return res.data
}

export const approveSSOAccessRequest = async (
  requestId: string,
  payload: { role: string; owner_name?: string; name?: string }
): Promise<{ status: string; user_id: string; email: string; role: string }> => {
  const res = await api.post(`/admin/sso/access-requests/${requestId}/approve`, payload)
  return res.data
}

export const dismissSSOAccessRequest = async (requestId: string): Promise<{ status: string }> => {
  const res = await api.post(`/admin/sso/access-requests/${requestId}/dismiss`)
  return res.data
}





