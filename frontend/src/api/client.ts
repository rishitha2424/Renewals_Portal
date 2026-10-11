import axios from 'axios'
import { useAppStore } from '../store/appStore'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Automatically attach current global scope and include_deleted_lost to analytics/read endpoints.
// Upload/commit/validate endpoints are body-only — they must NOT receive scope as a query param.
const SCOPE_EXCLUDED_PATHS = ['/snapshots/validate', '/snapshots/commit', '/snapshots/upload']

api.interceptors.request.use((config) => {
  const url = config.url || ''
  const isExcluded = SCOPE_EXCLUDED_PATHS.some((p) => url.includes(p))
  if (isExcluded) return config

  const state = useAppStore.getState()
  config.params = config.params || {}
  if (!config.params.scope && state.scope) {
    config.params.scope = state.scope
  }
  if (config.params.include_deleted_lost === undefined && state.includeDeletedLost !== undefined) {
    config.params.include_deleted_lost = state.includeDeletedLost
  }
  return config
})

// ── Snapshots ────────────────────────────────────────────────────────────────

export const getSnapshots = () =>
  api.get('/snapshots').then(r => r.data)

export const getActiveSnapshot = () =>
  api.get('/snapshots/active').then(r => r.data)

export const getUploadHistory = () =>
  api.get('/snapshots/history').then(r => r.data)

export const validateUpload = (form: FormData) =>
  api.post('/snapshots/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)

export const commitUpload = (sessionId: string, replace = false) =>
  api.post('/snapshots/commit', { session_id: sessionId, replace }).then(r => r.data)

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

// ── V2 Overview (Tab 1) ───────────────────────────────────────────────────────

export const getV2OverviewSummary = (excludeDeleted = false) =>
  api.get('/v2/overview/summary', { params: { exclude_deleted: excludeDeleted } }).then(r => r.data)

export const getV2OverviewMovements = (compare: 'yesterday' | 'last_week' = 'yesterday', excludeDeleted = false) =>
  api.get('/v2/overview/movements', { params: { compare, exclude_deleted: excludeDeleted } }).then(r => r.data)

export const getV2RegionalBreakdown = (excludeDeleted = false) =>
  api.get('/v2/overview/regional-breakdown', { params: { exclude_deleted: excludeDeleted } }).then(r => r.data)

export const getV2OverviewDeals = (params: {
  category?: string
  region?: string
  approval_status?: string
  kind?: string
  as_of?: string
  exclude_deleted?: boolean
} = {}) =>
  api.get('/v2/overview/deals', { params }).then(r => r.data)

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
  if (state.scope) params.append('scope', state.scope)
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

export const getFilterOptions = (snapshotId?: string) =>
  api.get('/opportunities/filter-options', { params: { snapshot_id: snapshotId } }).then(r => r.data)


// ── AI ───────────────────────────────────────────────────────────────────────

export const askAI = (question: string) =>
  api.post('/ai/ask', { question }).then(r => r.data)

export const getDailyBrief = () =>
  api.get('/ai/daily-brief').then(r => r.data)

export const getPredictiveInsights = () =>
  api.get('/ai/predictive-insights').then(r => r.data)

export const getAIConfig = () =>
  api.get('/ai/config').then(r => r.data)

export interface StreamChatParams {
  question: string
  conversation?: any[]
  sessionId?: string
  onTextChunk?: (text: string) => void
  onToolCall?: (toolCall: any) => void
  onMeta?: (meta: any) => void
  onError?: (err: string) => void
  onDone?: () => void
}

export async function streamAIChat({
  question,
  conversation,
  sessionId = 'default_session',
  onTextChunk,
  onToolCall,
  onMeta,
  onError,
  onDone,
}: StreamChatParams) {
  try {
    const state = useAppStore.getState()
    const res = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        conversation,
        session_id: sessionId,
        scope: state.scope,
        include_deleted_lost: state.includeDeletedLost,
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      onError?.(errText || `Server responded with ${res.status}`)
      onDone?.()
      return
    }
    const reader = res.body?.getReader()
    if (!reader) {
      onError?.('No response stream available')
      onDone?.()
      return
    }
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let eventType = 'message'
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim()
          if (!dataStr) continue
          try {
            const parsed = JSON.parse(dataStr)
            if (eventType === 'text_chunk') {
              onTextChunk?.(parsed.text)
            } else if (eventType === 'tool_call') {
              onToolCall?.(parsed)
            } else if (eventType === 'meta') {
              onMeta?.(parsed)
            } else if (eventType === 'error') {
              onError?.(parsed.error)
            } else if (eventType === 'done') {
              onDone?.()
            }
          } catch {
            // ignore json parse error
          }
        }
      }
    }
    onDone?.()
  } catch (err: any) {
    onError?.(err.message || 'Stream connection failed')
    onDone?.()
  }
}

// ── Reports & Exports ────────────────────────────────────────────────────────

export const downloadReport = async (
  format: 'pptx' | 'xlsx',
  snapshotId?: string | null,
  compareTo?: string | null
): Promise<{ filename: string }> => {
  const state = useAppStore.getState()
  const endpoint = format === 'pptx' ? '/export/pptx' : '/export/excel'
  const params: Record<string, string> = {}
  if (snapshotId) params.snapshot_id = snapshotId
  if (compareTo) params.compare_to = compareTo
  if (state.scope) params.scope = state.scope
  if (state.includeDeletedLost) params.include_deleted_lost = 'true'

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

export const getInsights = (snapshotId?: string) =>
  api.get('/insights', { params: { snapshot_id: snapshotId } }).then(r => r.data)

export default api


// ── V2 Expiry ─────────────────────────────────────────────────────────────
export const getV2ExpirySummary = async (params: {
  as_of?: string | null
  compare?: string | null
  exclude_deleted_lost?: boolean
}) => {
  const p: any = {}
  if (params.as_of) p.as_of = params.as_of
  if (params.compare) p.compare = params.compare
  p.exclude_deleted_lost = params.exclude_deleted_lost
  const res = await api.get('/v2/expiry/summary', { params: p })
  return res.data
}

export const getV2ExpiryDeals = async (params: {
  quarter?: string
  category?: string
  as_of?: string | null
  exclude_deleted_lost?: boolean
  slippage?: boolean
}) => {
  const p: any = {}
  if (params.quarter) p.quarter = params.quarter
  if (params.category) p.category = params.category
  if (params.as_of) p.as_of = params.as_of
  if (params.slippage !== undefined) p.slippage = params.slippage
  p.exclude_deleted_lost = params.exclude_deleted_lost
  const res = await api.get('/v2/expiry/deals', { params: p })
  return res.data
}

export const getApprovalsDistribution = async (as_of: string, compare: string | null = null, exclude_deleted_lost: boolean = false) => {
  const params: any = { as_of, exclude_deleted_lost }
  if (compare) params.compare = compare
  return api.get('/v2/approvals/distribution', { params }).then(r => r.data)
}

export const getApprovalsDeals = async (as_of: string, status?: string, category?: string, exclude_deleted_lost: boolean = false, region?: string, business_unit?: string) => {
  const params: any = { as_of, exclude_deleted_lost }
  if (status) params.status = status
  if (category) params.category = category
  if (region) params.region = region
  if (business_unit) params.business_unit = business_unit
  return api.get('/v2/approvals/deals', { params }).then(r => r.data)
}
