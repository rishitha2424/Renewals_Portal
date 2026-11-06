import React from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useAppStore } from '@/store/appStore'
import ErrorBoundary from '@/components/common/ErrorBoundary'

// Import all pages
import Dashboard from '@/pages/Dashboard'
import Expiry from '@/pages/Expiry'
import Approvals from '@/pages/Approvals'
import BusinessUnits from '@/pages/BusinessUnits'
import Regions from '@/pages/Regions'
import Delayed from '@/pages/Delayed'
import Opportunities from '@/pages/Opportunities'
import DataUploads from '@/pages/DataUploads'
import ExecutiveView from '@/pages/ExecutiveView'
import Shell from '@/components/layout/Shell'

// Mock Recharts ResponsiveContainer to avoid 0x0 container size issues in JSDOM
vi.mock('recharts', async () => {
  const actual: any = await vi.importActual('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="mock-responsive-container" style={{ width: 800, height: 400 }}>
        {children}
      </div>
    ),
  }
})

// Polyfill window methods for JSDOM
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
})

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
})

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  configurable: true,
  value: vi.fn(),
})

window.matchMedia =
  window.matchMedia ||
  function (query: string) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  }

// Fixtures
const SNAPSHOTS_FIXTURE = [
  {
    id: 'snap-1',
    label: 'Oct 23, 2026',
    snapshot_date: '2026-10-23',
    yesterday_date: '2026-10-22',
    period: 'Q4-2026',
    row_count: 3086,
    active_row_count: 1128,
    is_active_today: true,
  },
  {
    id: 'snap-2',
    label: 'Oct 21, 2026',
    snapshot_date: '2026-10-21',
    yesterday_date: '2026-10-20',
    period: 'Q4-2026',
    row_count: 3086,
    active_row_count: 1128,
    is_active_today: false,
  },
]

const OVERVIEW_FIXTURE = {
  total: {
    count: 348,
    acv: 40068990.09,
    delta_yesterday: { count: 2, acv: 476219.18 },
    delta_lastweek: { count: 14, acv: 904132.33 },
  },
  categories: {
    Commit: { count: 308, acv: 30349636.71 },
    'Best Case': { count: 34, acv: 9456843.36 },
    Pipeline: { count: 1, acv: 49737.62 },
    Blank: { count: 5, acv: 212772.4 },
    Closed: { count: 0, acv: 0.0 },
  },
  movements: {
    commit_to_closed: { count: 0, acv: 0 },
    best_case_to_commit: { count: 0, acv: 0 },
    slippage_out: { count: 0, acv: 0 },
    new_deals: { count: 0, acv: 0 },
    deal_value_increase: { count: 0, acv: 0 },
    deal_value_decrease: { count: 0, acv: 0 },
    pushed_out: { count: 0, acv: 0 },
  },
}

const APPROVALS_FIXTURE = {
  groups: [
    { status: 'Approved', count: 96, acv: 12000000.0 },
    { status: 'Pending Approval', count: 6, acv: 1500000.0 },
    { status: 'Blank', count: 246, acv: 26568990.09 },
  ],
  rows: [],
  total: { count: 348, acv: 40068990.09 },
  pending_by_age: [
    { bucket: '< 7 days', count: 4, acv: 1000000.0 },
    { bucket: '7-14 days', count: 2, acv: 500000.0 },
  ],
}

const EXPIRY_FIXTURE = {
  snapshot_date: '2026-10-23',
  compare_date: '2026-10-21',
  data_slice: 'Renewals',
  data_slice_key: 'renewals',
  fiscal_years: [{ label: 'FY2026' }, { label: 'FY2027' }],
  categories: ['Commit', 'Best Case', 'Pipeline', 'Blank'],
  grids: {
    FY2026: {
      Q1: { Commit: { count: 10, acv: 1000000.0 } },
      Q2: { Commit: { count: 20, acv: 2000000.0 } },
      Q3: { Commit: { count: 30, acv: 3000000.0 } },
      Q4: { Commit: { count: 308, acv: 30349636.71 } },
    },
    FY2027: {
      Q1: { Commit: { count: 5, acv: 500000.0 } },
    },
  },
  acv_by_year: {
    FY2026: 36349636.71,
    FY2027: 500000.0,
  },
  grand_total: {
    count: 373,
    acv: 36849636.71,
  },
  slippage: {
    count: 10,
    acv: 1200000.0,
    by_quarter: [{ quarter: 'Q4-2026', count: 10, acv: 1200000.0 }],
  },
  deltas: {
    FY2026: {
      yesterday: { count: 2, acv: 476219.18 },
      lastweek: { count: 14, acv: 904132.33 },
    },
  },
}

const BUSINESS_UNITS_FIXTURE = {
  rows: [
    {
      bu: 'Digital Identity',
      count: 100,
      acv: 15000000.0,
      categories: { Commit: { count: 90, acv: 14000000.0 } },
    },
    {
      bu: 'Network Security',
      count: 80,
      acv: 10000000.0,
      categories: { Commit: { count: 75, acv: 9000000.0 } },
    },
  ],
  total: { count: 180, acv: 25000000.0 },
}

const REGIONS_FIXTURE = {
  regions: [
    {
      region: 'Europe',
      count: 158,
      acv: 15000000.0,
      categories: { Commit: { count: 140, acv: 13000000.0 } },
    },
    {
      region: 'Middle East and North Africa',
      count: 50,
      acv: 8000000.0,
      categories: { Commit: { count: 45, acv: 7000000.0 } },
    },
  ],
  total: { count: 208, acv: 23000000.0 },
}

const DELAYED_FIXTURE = {
  total: { count: 25, acv: 3500000.0 },
  delayed_start_of_quarter: { count: 15, acv: 2000000.0 },
  slippage_since_start_of_quarter: { count: 5, acv: 800000.0 },
  lost_since_start_of_quarter: { count: 5, acv: 700000.0 },
  rows: [
    {
      opportunity_name: 'Delayed Deal 1',
      account_name: 'Telco Alpha',
      forecast_acv_amount: 500000.0,
      sub_category: 'delayed_start_of_quarter',
      close_date: '2026-10-30',
    },
  ],
}

const OPPORTUNITIES_FIXTURE = {
  opportunities: [
    {
      id: 'opp-1',
      opportunity_id_18: '006000000001',
      opportunity_name: 'Renewal Deal Alpha',
      account_name: 'Acme Telecom',
      forecast_acv_amount: 150000.0,
      forecast_category: 'Commit',
      approval_status: 'Approved',
      revised_sub_region: 'Europe',
      business_unit: 'Digital Identity',
      fiscal_period: 'Q4-2026',
      close_date: '2026-11-15',
    },
  ],
  total_count: 1,
  total_acv: 150000.0,
  page: 1,
  limit: 50,
  total_pages: 1,
}

const FILTER_OPTIONS_FIXTURE = {
  regions: ['Europe', 'Middle East and North Africa'],
  business_units: ['Digital Identity', 'Network Security'],
  forecast_categories: ['Commit', 'Best Case', 'Pipeline', 'Blank'],
  approval_statuses: ['Approved', 'Pending Approval', 'Blank'],
}

// Empty data fixture
const EMPTY_OVERVIEW = {
  total: {
    count: 0,
    acv: 0,
    delta_yesterday: { count: 0, acv: 0 },
    delta_lastweek: { count: 0, acv: 0 },
  },
  categories: {},
  movements: {},
}

const EMPTY_APPROVALS = {
  groups: [],
  rows: [],
  total: { count: 0, acv: 0 },
  pending_by_age: [],
}

const EMPTY_EXPIRY = {
  snapshot_date: '2026-10-23',
  compare_date: '2026-10-21',
  data_slice: 'Renewals',
  data_slice_key: 'renewals',
  fiscal_years: [],
  categories: [],
  grids: {},
  acv_by_year: {},
  grand_total: { count: 0, acv: 0 },
  slippage: { count: 0, acv: 0, by_quarter: [] },
  deltas: {},
}

const EMPTY_BUSINESS_UNITS = {
  rows: [],
  total: { count: 0, acv: 0 },
}

const EMPTY_REGIONS = {
  regions: [],
  total: { count: 0, acv: 0 },
}

const EMPTY_DELAYED = {
  total: { count: 0, acv: 0 },
  delayed_start_of_quarter: { count: 0, acv: 0 },
  slippage_since_start_of_quarter: { count: 0, acv: 0 },
  lost_since_start_of_quarter: { count: 0, acv: 0 },
  rows: [],
}

const EMPTY_OPPORTUNITIES = {
  opportunities: [],
  total_count: 0,
  total_acv: 0,
  page: 1,
  limit: 50,
  total_pages: 0,
}

// Current API mock state
let mockMode: 'loading' | 'loaded' | 'empty' = 'loaded'

vi.mock('@/api/client', () => {
  return {
    default: {
      get: vi.fn((url: string) => {
        if (url.includes('/health/db')) {
          return Promise.resolve({ data: { status: 'ok', dialect: 'sqlite' } })
        }
        return Promise.resolve({ data: {} })
      }),
      post: vi.fn(() => Promise.resolve({ data: {} })),
      put: vi.fn(() => Promise.resolve({ data: {} })),
      delete: vi.fn(() => Promise.resolve({ data: {} })),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    },
    getSnapshots: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve(SNAPSHOTS_FIXTURE)
    }),
    getSnapshot: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve(SNAPSHOTS_FIXTURE[0])
    }),
    getActiveSnapshot: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve(SNAPSHOTS_FIXTURE[0])
    }),
    getUploadHistory: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve([])
    }),
    getAdminStatus: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve({ is_admin: false })
    }),
    getV2OverviewSummary: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_OVERVIEW)
      return Promise.resolve(OVERVIEW_FIXTURE)
    }),
    getApprovalsDistribution: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_APPROVALS)
      return Promise.resolve(APPROVALS_FIXTURE)
    }),
    getV2ExpirySummary: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_EXPIRY)
      return Promise.resolve(EXPIRY_FIXTURE)
    }),
    getV2ExpiryDeals: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve([])
      return Promise.resolve([])
    }),
    getV2BusinessUnitsSummary: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_BUSINESS_UNITS)
      return Promise.resolve(BUSINESS_UNITS_FIXTURE)
    }),
    getV2RegionsSummary: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_REGIONS)
      return Promise.resolve(REGIONS_FIXTURE)
    }),
    getV2DelayedSummary: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_DELAYED)
      return Promise.resolve(DELAYED_FIXTURE)
    }),
    getExplorerReconcile: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve({ reconciles: true, differences: [] })
    }),
    getOpportunities: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve(EMPTY_OPPORTUNITIES)
      return Promise.resolve(OPPORTUNITIES_FIXTURE)
    }),
    getOpportunitiesMetrics: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      if (mockMode === 'empty') return Promise.resolve({ total_count: 0, total_acv: 0 })
      return Promise.resolve({ total_count: 1, total_acv: 150000.0 })
    }),
    getOpportunitiesFilterOptions: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve(FILTER_OPTIONS_FIXTURE)
    }),
    getHealth: vi.fn(() => {
      if (mockMode === 'loading') return new Promise(() => {})
      return Promise.resolve({ status: 'healthy', database: 'connected' })
    }),
    getSnapshotChecks: vi.fn(() => Promise.resolve([])),
    deleteSnapshot: vi.fn(() => Promise.resolve({})),
    setActiveSnapshot: vi.fn(() => Promise.resolve({})),
    validateUpload: vi.fn(() => Promise.resolve({ can_commit: true, session_id: 'test-sess' })),
    commitUpload: vi.fn(() => Promise.resolve({ row_count: 10, active_row_count: 10, is_active_today: true })),
    downloadReport: vi.fn(() => Promise.resolve()),
  }
})

describe('Comprehensive Page Smoke Tests (Item 4)', () => {
  let consoleErrors: string[] = []
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    consoleErrors = []
    originalConsoleError = console.error
    console.error = (...args: any[]) => {
      const msg = args.map((a) => (typeof a === 'string' ? a : a?.message || JSON.stringify(a))).join(' ')
      // Filter out known React act() or benign warnings if any, but capture error boundaries and exceptions
      if (
        msg.includes('[ErrorBoundary caught error]') ||
        msg.includes('Minified React error') ||
        msg.includes('Rendered more hooks') ||
        msg.includes('Rendered fewer hooks') ||
        msg.includes('Uncaught')
      ) {
        consoleErrors.push(msg)
      }
      originalConsoleError(...args)
    }

    useAppStore.setState({
      activeSnapshotId: 'snap-1',
      compareSnapshotId: 'snap-2',
      snapshots: SNAPSHOTS_FIXTURE,
      includeDeletedLost: true,
      globalFilters: {
        as_of: 'snap-1',
        compare: 'yesterday',
        period: 'current_quarter',
        sales_types: ['Renewals'],
        regions: [],
        business_units: [],
        forecast_categories: [],
        approval_statuses: [],
        include_deleted_lost: true,
      },
    })
  })

  afterEach(() => {
    cleanup()
    console.error = originalConsoleError
  })

  const setViewport = (width: number, height = 800) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height })
    window.dispatchEvent(new Event('resize'))
  }

  const renderWithProviders = (ui: React.ReactElement, initialRoute = '/') => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
        },
      },
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <ErrorBoundary>{ui}</ErrorBoundary>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  const pagesToTest = [
    { name: 'Overview (Dashboard)', path: '/', component: <Dashboard /> },
    { name: 'Expiry', path: '/expiry', component: <Expiry /> },
    { name: 'Approvals', path: '/approvals', component: <Approvals /> },
    { name: 'Business Units', path: '/business-units', component: <BusinessUnits /> },
    { name: 'Regions', path: '/regions', component: <Regions /> },
    { name: 'Delayed', path: '/delayed', component: <Delayed /> },
    { name: 'Data Explorer (Opportunities)', path: '/opportunities', component: <Opportunities /> },
    { name: 'Data Uploads', path: '/data-uploads', component: <DataUploads /> },
    { name: 'Executive View', path: '/executive', component: <ExecutiveView /> },
  ]

  const widths = [390, 1440]

  widths.forEach((width) => {
    describe(`Viewport width: ${width}px`, () => {
      beforeEach(() => {
        setViewport(width)
      })

      pagesToTest.forEach(({ name, path, component }) => {
        it(`${name} (${path}) passes in all states with no error boundary and no console errors`, async () => {
          // 1. Initial Loading State
          mockMode = 'loading'
          let rendered = renderWithProviders(component, path)
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])
          cleanup()

          // 2. Data Loaded State
          mockMode = 'loaded'
          rendered = renderWithProviders(component, path)
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // 3. Switching As-of date (to snap-2)
          act(() => {
            useAppStore.getState().setActiveSnapshotId('snap-2')
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // 4. Switching vs picker
          act(() => {
            useAppStore.getState().setCompareSnapshotId('snap-1')
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // 5. Switching Period:
          // a. Current quarter
          act(() => {
            useAppStore.getState().setGlobalFilters({ period: 'current_quarter' })
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // b. Past quarter
          act(() => {
            useAppStore.getState().setGlobalFilters({ period: 'Q3-2026' })
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // c. Future quarter
          act(() => {
            useAppStore.getState().setGlobalFilters({ period: 'Q1-2027' })
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // d. All periods
          act(() => {
            useAppStore.getState().setGlobalFilters({ period: 'all' })
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          // 6. Toggling Include Deleted & Lost
          act(() => {
            useAppStore.getState().setIncludeDeletedLost(false)
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          act(() => {
            useAppStore.getState().setIncludeDeletedLost(true)
          })
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])

          cleanup()

          // 7. Snapshot with empty data
          mockMode = 'empty'
          rendered = renderWithProviders(component, path)
          expect(document.body.textContent).not.toContain('This page could not be displayed')
          expect(consoleErrors).toEqual([])
        })
      })

      it(`Shell with layout (Topbar, Sidebar, SectionNav) renders without error boundary at ${width}px`, () => {
        mockMode = 'loaded'
        renderWithProviders(
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Dashboard />} />
            </Route>
          </Routes>,
          '/'
        )
        expect(document.body.textContent).not.toContain('This page could not be displayed')
        expect(consoleErrors).toEqual([])
      })
    })
  })
})
