import { Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import api, { getSnapshots } from '@/api/client'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import CommandPalette from './CommandPalette'
import OpportunityDrawer from '@/components/overview/OpportunityDrawer'
import ErrorBoundary from '@/components/common/ErrorBoundary'
import FloatingPageControls from '@/components/common/FloatingPageControls'
import { useAppStore } from '@/store/appStore'
import { formatDate } from '@/utils/format'
import { useEffect, useState, useRef } from 'react'

export default function Shell() {
  const storeSnapshots = useAppStore(s => s.snapshots)
  const activeSnapshotId = useAppStore(s => s.activeSnapshotId)
  const [scrollProgress, setScrollProgress] = useState(0)
  const mainRef = useRef<HTMLElement>(null)

  const { data: fetchedSnapshots = [] } = useQuery({
    queryKey: ['snapshots'],
    queryFn: getSnapshots,
  })

  const snapshots = storeSnapshots.length > 0 ? storeSnapshots : fetchedSnapshots
  const activeSnapshot = snapshots.find((snap: any) => snap.id === activeSnapshotId) ?? snapshots[0]
  const asOf = activeSnapshot?.snapshot_date ? formatDate(activeSnapshot.snapshot_date) : 'N/A'
  const setOpen = useAppStore(s => s.setCommandPaletteOpen)
  const selectedOppId = useAppStore(s => s.selectedOppId)
  const setSelectedOppId = useAppStore(s => s.setSelectedOppId)

  const { data: dbHealth } = useQuery({
    queryKey: ['dbHealth'],
    queryFn: async () => {
      try {
        const res = await api.get('/health/db')
        return res.data
      } catch (e) {
        return null
      }
    },
    staleTime: 60000 * 5, // 5 minutes
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setOpen])

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {dbHealth?.status === 'error' && (
          <div className="bg-rose-600 text-white px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 border-b border-rose-700 z-50 shadow-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Database Warning ({dbHealth?.dialect || 'unknown'}): {dbHealth?.error || `Schema revision (${dbHealth?.alembic_revision ?? 'none'}) is behind Alembic head (${dbHealth?.alembic_head ?? 'unknown'})`}
            </span>
          </div>
        )}
        {dbHealth?.status !== 'error' && dbHealth?.is_legacy && (
          <div className="bg-amber-100 text-amber-900 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 border-b border-amber-200 z-50">
            <AlertTriangle className="w-4 h-4" />
            Warning: The connected database was created by an older version of the app. Please re-upload the latest Excel snapshots for full compatibility.
          </div>
        )}
        <header className="relative z-30 flex-shrink-0">
          <Topbar />
          {/* Thin scroll progress bar under top bar */}
          <div className="h-[2px] bg-transparent w-full relative z-30 overflow-hidden">
            <div
              className="h-full bg-[#00A3AD] transition-all duration-75"
              style={{ width: `${scrollProgress}%` }}
            />
          </div>
        </header>
        <main
          ref={mainRef}
          onScroll={(e) => {
            const el = e.currentTarget
            const max = el.scrollHeight - el.clientHeight
            if (max > 0) {
              setScrollProgress(Math.min(100, Math.max(0, (el.scrollTop / max) * 100)))
            } else {
              setScrollProgress(0)
            }
          }}
          className="flex-1 overflow-y-auto relative z-10"
        >
          <div className="w-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
            <footer className="mt-8 text-center text-xs text-slate-400 font-medium py-4">
              Mobileum Horizon · Renewals Intelligence Platform · Data as of {asOf}
            </footer>
          </div>
        </main>
      </div>
      <FloatingPageControls scrollContainerRef={mainRef} />
      <CommandPalette />
      <OpportunityDrawer oppId={selectedOppId} onClose={() => setSelectedOppId(null)} />
    </div>
  )
}

