import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Shell from '@/components/layout/Shell'
import Dashboard from '@/pages/Dashboard'
import Expiry from '@/pages/Expiry'
import ExpiryLegacy from '@/pages/ExpiryLegacy'
import Approvals from '@/pages/Approvals'
import ApprovalsLegacy from '@/pages/ApprovalsLegacy'
import BusinessUnits from '@/pages/BusinessUnits'
import BusinessUnitsLegacy from '@/pages/BusinessUnitsLegacy'
import Regions from '@/pages/Regions'
import RegionsLegacy from '@/pages/RegionsLegacy'
import Delayed from '@/pages/Delayed'
import Opportunities from '@/pages/Opportunities'
import History from '@/pages/History'
import ExecutiveView from '@/pages/ExecutiveView'
import Upload from '@/pages/Upload'
import LoadingScreen from '@/pages/LoadingScreen'
import DesignSystem from '@/pages/DesignSystem'
import { useAppStore } from '@/store/appStore'

export default function App() {
  const darkMode = useAppStore(s => s.darkMode)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

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
        <Route path="/executive" element={<ExecutiveView />} />
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/expiry" element={<Expiry />} />
          <Route path="/expiry-legacy" element={<ExpiryLegacy />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/approvals-legacy" element={<ApprovalsLegacy />} />
          <Route path="/business-units" element={<BusinessUnits />} />
          <Route path="/business-units-legacy" element={<BusinessUnitsLegacy />} />
          <Route path="/bu" element={<BusinessUnits />} />
          <Route path="/regions" element={<Regions />} />
          <Route path="/regions-legacy" element={<RegionsLegacy />} />
          <Route path="/delayed" element={<Delayed />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/explore" element={<Opportunities />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/history" element={<History />} />
          <Route path="/design" element={<DesignSystem />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}


