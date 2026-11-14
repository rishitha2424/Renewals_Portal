import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  Clock,
  Calendar,
  CheckCircle2,
  Building2,
  Globe2,
  Table2,
  Printer,
  ChevronLeft,
  ChevronRight,
  Upload,
  X,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { NAV_ITEMS } from '@/config/nav'
import clsx from 'clsx'

export default function Sidebar() {
  const {
    sidebarCollapsed,
    toggleSidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
  } = useAppStore()
  const location = useLocation()

  // Track viewport breakpoint: tablet is 640-1024, desktop is >1024
  const [isTablet, setIsTablet] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      const w = window.innerWidth
      setIsTablet(w >= 640 && w < 1024)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Auto-close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname, location.hash, setMobileSidebarOpen])

  const effectiveCollapsed = isTablet ? true : sidebarCollapsed
  const effectiveWidth = effectiveCollapsed ? 56 : 232

  return (
    <>
      {/* ── 1. Desktop & Tablet Persistent Sidebar (hidden on phone < 640px) ── */}
      <motion.aside
        animate={{ width: effectiveWidth }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="hidden sm:flex flex-shrink-0 flex-col overflow-hidden select-none border-r z-30 transition-colors"
        style={{
          background: '#12284C',
          borderColor: 'rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-3.5 h-14 border-b border-white/10 flex-shrink-0">
          <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0 bg-white/10 p-1 flex items-center justify-center">
            <img
              src="/assets/logo.png"
              alt="Mobileum"
              className="w-full h-full object-contain"
            />
          </div>
          {!effectiveCollapsed && (
            <div className="overflow-hidden whitespace-nowrap leading-tight flex flex-col justify-center">
              <p className="text-white font-semibold text-sm tracking-tight leading-none mb-1">
                Horizon
              </p>
              <p className="text-slate-400 text-[11px] font-normal tracking-tight leading-none">
                Renewals intelligence
              </p>
            </div>
          )}
        </div>

        {/* Nav List */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            if (to === '/executive') {
              return (
                <a
                  key={to}
                  href="/executive"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={effectiveCollapsed ? label : undefined}
                  className="flex items-center gap-3 px-2.5 py-2.5 min-h-[40px] rounded-sm text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors group relative"
                >
                  <Icon
                    className="w-[18px] h-[18px] flex-shrink-0 text-slate-400 group-hover:text-slate-200"
                    strokeWidth={1.75}
                  />
                  {!effectiveCollapsed && (
                    <span className="truncate whitespace-nowrap">{label}</span>
                  )}
                </a>
              )
            }

            const isHash = to.includes('#')
            const basePath = to.split('#')[0]
            const hash = to.split('#')[1]
            const isActive = isHash
              ? location.pathname === basePath && location.hash === `#${hash}`
              : location.pathname === to

            return (
              <NavLink
                key={to}
                to={to}
                title={effectiveCollapsed ? label : undefined}
                className={clsx(
                  'flex items-center gap-3 px-2.5 py-2.5 min-h-[40px] rounded-sm text-xs font-medium transition-colors group relative',
                  isActive
                    ? 'bg-white/10 text-white'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-[#00A3AD] rounded-r-sm" />
                )}

                <Icon
                  className={clsx(
                    'w-[18px] h-[18px] flex-shrink-0',
                    isActive ? 'text-[#00A3AD]' : 'text-slate-400 group-hover:text-slate-200'
                  )}
                  strokeWidth={1.75}
                />

                {!effectiveCollapsed && (
                  <span className="truncate whitespace-nowrap">{label}</span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom Footer: Collapse toggle (visible on desktop > 1024px) */}
        {!isTablet && (
          <div className="p-3 border-t border-white/10 flex-shrink-0">
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="w-full min-h-[40px] flex items-center justify-center gap-2 py-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors focus:outline-none"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
              ) : (
                <>
                  <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </div>
        )}
      </motion.aside>

      {/* ── 2. Mobile Drawer / Sheet (Phone < 640px) ── */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 sm:hidden flex">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/60"
            />

            {/* Slide-out drawer sheet */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative z-10 w-72 max-w-[80vw] h-full flex flex-col shadow-2xl select-none"
              style={{ background: '#12284C' }}
            >
              {/* Brand Header with Close Button */}
              <div className="flex items-center justify-between px-4 h-14 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md overflow-hidden flex-shrink-0 bg-white/10 p-1 flex items-center justify-center">
                    <img
                      src="/assets/logo.png"
                      alt="Mobileum"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm tracking-tight leading-none mb-1">
                      Horizon
                    </p>
                    <p className="text-slate-400 text-[11px] font-normal tracking-tight leading-none">
                      Renewals intelligence
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="w-10 h-10 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close navigation"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Nav items list */}
              <nav className="flex-1 px-3 py-3 space-y-1.5 overflow-y-auto">
                {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
                  if (to === '/executive') {
                    return (
                      <a
                        key={to}
                        href="/executive"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileSidebarOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-md text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Icon className="w-5 h-5 text-slate-400" strokeWidth={1.75} />
                        <span>{label}</span>
                      </a>
                    )
                  }

                  const isHash = to.includes('#')
                  const basePath = to.split('#')[0]
                  const hash = to.split('#')[1]
                  const isActive = isHash
                    ? location.pathname === basePath && location.hash === `#${hash}`
                    : location.pathname === to

                  return (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMobileSidebarOpen(false)}
                      className={clsx(
                        'flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-md text-sm font-medium transition-colors relative',
                        isActive
                          ? 'bg-white/15 text-white font-semibold'
                          : 'text-slate-300 hover:text-white hover:bg-white/5'
                      )}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-[#00A3AD] rounded-r-sm" />
                      )}
                      <Icon
                        className={clsx(
                          'w-5 h-5 flex-shrink-0',
                          isActive ? 'text-[#00A3AD]' : 'text-slate-400'
                        )}
                        strokeWidth={1.75}
                      />
                      <span>{label}</span>
                    </NavLink>
                  )
                })}
              </nav>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
