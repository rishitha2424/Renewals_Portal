import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Shell from '@/components/layout/Shell'
import Dashboard from '@/pages/Dashboard'
import Expiry from '@/pages/Expiry'
import Approvals from '@/pages/Approvals'
import BusinessUnits from '@/pages/BusinessUnits'
import Regions from '@/pages/Regions'
import Delayed from '@/pages/Delayed'
import Opportunities from '@/pages/Opportunities'
import ExecutiveView from '@/pages/ExecutiveView'
import DataUploads from '@/pages/DataUploads'
import Settings from '@/pages/Settings'
import LoadingScreen from '@/pages/LoadingScreen'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import { useAppStore } from '@/store/appStore'
import { useAdminSession } from '@/hooks/useAdminSession'
import { computeScale, applyScale, getSavedDisplaySize } from '@/config/layoutScale'

export default function App() {
  useAdminSession()
  const { darkMode } = useAppStore()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // Display scaling: compute scale on start & window resize (debounced 100ms)
  useEffect(() => {
    const updateScale = () => {
      const pref = getSavedDisplaySize()
      const scale = computeScale(window.innerWidth, pref)
      applyScale(scale)
    }

    updateScale()

    let timer: any
    const handleResize = () => {
      clearTimeout(timer)
      timer = setTimeout(updateScale, 100)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('display-size-change', updateScale)

    // Reset scaling during print
    let mql: MediaQueryList | null = null
    const handlePrintChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        applyScale(1.0)
      } else {
        updateScale()
      }
    }

    if (window.matchMedia) {
      mql = window.matchMedia('print')
      try {
        mql.addEventListener('change', handlePrintChange)
      } catch (_) {
        mql.addListener(handlePrintChange)
      }
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('display-size-change', updateScale)
      clearTimeout(timer)
    }
  }, [])

  // Dynamic titles based on path
  useEffect(() => {
    const handleTitle = () => {
      const path = window.location.pathname
      const titleMap: Record<string, string> = {
        '/': 'Overview — Mobileum Horizon',
        '/expiry': 'Expiry — Mobileum Horizon',
        '/approvals': 'Approvals — Mobileum Horizon',
        '/business-units': 'Business Units — Mobileum Horizon',
        '/bu': 'Business Units — Mobileum Horizon',
        '/regions': 'Regions — Mobileum Horizon',
        '/delayed': 'Delayed Renewals — Mobileum Horizon',
        '/opportunities': 'Data Explorer — Mobileum Horizon',
        '/explore': 'Data Explorer — Mobileum Horizon',
        '/data-uploads': 'Data Uploads — Mobileum Horizon',
        '/settings': 'Settings — Mobileum Horizon',
        '/executive': 'Executive Summary — Mobileum Horizon',
      }
      document.title = titleMap[path] || 'Mobileum Horizon'
    }
    handleTitle()
    window.addEventListener('popstate', handleTitle)
    return () => window.removeEventListener('popstate', handleTitle)
  }, [])

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
          },
        }}
      />
      <Routes>
        <Route path="/loading" element={<LoadingScreen />} />
        <Route
          path="/executive"
          element={
            <ErrorBoundary>
              <ExecutiveView />
            </ErrorBoundary>
          }
        />
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/expiry" element={<Expiry />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/business-units" element={<BusinessUnits />} />
          <Route path="/bu" element={<BusinessUnits />} />
          <Route path="/regions" element={<Regions />} />
          <Route path="/delayed" element={<Delayed />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/explore" element={<Opportunities />} />
          <Route path="/data-uploads" element={<DataUploads />} />
          <Route path="/settings" element={<Settings />} />

          {/* Redirects from old routes */}
          <Route path="/upload" element={<Navigate to="/data-uploads" replace />} />
          <Route path="/history" element={<Navigate to="/data-uploads" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
