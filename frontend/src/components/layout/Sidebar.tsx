import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  X,
  Shield,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { getNotifications } from '@/api/client'
import { NAV_ITEMS, KAM_NAV_ITEMS, ADMIN_NAV_ITEMS } from '@/config/nav'
import { POLL_CONFIG, usePageVisible, getPollingInterval } from '@/config/polling'
import clsx from 'clsx'

export default function Sidebar() {
  const {
    sidebarCollapsed,
    toggleSidebarCollapsed,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    isAdmin,
  } = useAppStore()
  const { currentUser, isAuthenticated } = useAuthStore()
  const location = useLocation()
  const isPageVisible = usePageVisible()

  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: ({ signal }) => getNotifications('all', 50, signal),
    enabled: Boolean(isAuthenticated && currentUser),
    refetchInterval: (query) =>
      getPollingInterval(POLL_CONFIG.NOTIFICATIONS_MS, isPageVisible, query.state.fetchFailureCount),
    refetchIntervalInBackground: false,
    staleTime: 25_000,
  })
  const unreadByCategory = notifData?.unread_by_category || { messages: 0, comments: 0, alerts: 0, total: 0 }

  // Track viewport breakpoint: compact (< 1280px e.g. tablets, 720p/768p/900p laptops, zoomed displays)
  const [isCompactScreen, setIsCompactScreen] = useState(false)
  const [userToggled, setUserToggled] = useState<boolean | null>(null)

  useEffect(() => {
    const checkWidth = () => {
      const w = window.innerWidth
      setIsCompactScreen(w >= 640 && w < 1280)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Auto-close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname, location.hash, setMobileSidebarOpen])

  // If user explicitly toggled, honor it; otherwise default to collapsed on compact screens (<1280px)
  const effectiveCollapsed = userToggled !== null ? userToggled : (isCompactScreen ? true : sidebarCollapsed)
  const effectiveWidth = effectiveCollapsed ? 56 : 232

  const handleToggle = () => {
    const next = !effectiveCollapsed
    setUserToggled(next)
    toggleSidebarCollapsed()
  }

  const isKamUser = currentUser?.role === 'kam'
  const isAdminUser = currentUser?.role === 'admin' || isAdmin

  const primaryItems = isKamUser ? KAM_NAV_ITEMS : NAV_ITEMS
  const adminItems = isAdminUser ? ADMIN_NAV_ITEMS : []

  const renderNavLinks = (items: typeof NAV_ITEMS, isMobile = false) => {
    return items.map(({ to, icon: Icon, label }) => {
      if (to === '/executive') {
        return (
          <a
            key={to}
            href="/executive"
            target="_blank"
            rel="noopener noreferrer"
            onClick={isMobile ? () => setMobileSidebarOpen(false) : undefined}
            title={effectiveCollapsed && !isMobile ? label : undefined}
            className="flex items-center gap-3 px-2.5 py-2.5 min-h-[40px] rounded-sm text-xs font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors group relative"
          >
            <Icon
              className="w-[18px] h-[18px] flex-shrink-0 text-slate-400 group-hover:text-slate-200"
              strokeWidth={1.75}
            />
            {(!effectiveCollapsed || isMobile) && (
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

      const badgeCount =
        basePath === '/messages'
          ? unreadByCategory.messages || 0
          : basePath === '/comments-log'
            ? unreadByCategory.comments || 0
            : 0

      return (
        <NavLink
          key={to}
          to={to}
          onClick={isMobile ? () => setMobileSidebarOpen(false) : undefined}
          title={effectiveCollapsed && !isMobile ? label : undefined}
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

          <div className="relative flex-shrink-0">
            <Icon
              className={clsx(
                'w-[18px] h-[18px]',
                isActive ? 'text-[#00A3AD]' : 'text-slate-400 group-hover:text-slate-200'
              )}
              strokeWidth={1.75}
            />
            {effectiveCollapsed && !isMobile && badgeCount > 0 && (
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-teal-400" />
            )}
          </div>

          {(!effectiveCollapsed || isMobile) && (
            <span className="truncate whitespace-nowrap flex-1">{label}</span>
          )}
          {(!effectiveCollapsed || isMobile) && badgeCount > 0 && (
            <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#00A3AD] text-white tabular-nums">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </NavLink>
      )
    })
  }

  return (
    <>
      {/* ── 1. Desktop & Tablet Persistent Sidebar ── */}
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
                {isKamUser ? 'KAM Renewals Portal' : 'Renewals Intelligence'}
              </p>
            </div>
          )}
        </div>

        {/* Nav List */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {renderNavLinks(primaryItems)}

          {adminItems.length > 0 && (
            <div className="pt-3 mt-3 border-t border-white/10 space-y-1">
              {!effectiveCollapsed && (
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-teal-400" />
                  <span>Administration</span>
                </div>
              )}
              {renderNavLinks(adminItems)}
            </div>
          )}
        </nav>

        {/* Bottom Footer: Collapse toggle */}
        <div className="p-3 border-t border-white/10 flex-shrink-0">
          <button
            type="button"
            onClick={handleToggle}
            className="w-full min-h-[40px] flex items-center justify-center gap-2 py-2 rounded-md text-slate-400 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors focus:outline-none"
            title={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {effectiveCollapsed ? (
              <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" strokeWidth={1.75} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </motion.aside>

      {/* ── 2. Mobile Drawer / Sheet (Phone < 640px) ── */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {mobileSidebarOpen && (
            <div className="fixed inset-0 z-[100] sm:hidden flex">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileSidebarOpen(false)}
                className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              />

              {/* Slide-out drawer */}
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 250 }}
                className="relative w-64 max-w-[80vw] h-full flex flex-col z-10 overflow-hidden"
                style={{ background: '#12284C' }}
              >
                {/* Header */}
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
                        {isKamUser ? 'KAM Renewals' : 'Renewals intelligence'}
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
                  {renderNavLinks(primaryItems, true)}
                  {adminItems.length > 0 && (
                    <div className="pt-3 mt-3 border-t border-white/10 space-y-1.5">
                      <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Shield className="w-3 h-3 text-teal-400" />
                        <span>Administration</span>
                      </div>
                      {renderNavLinks(adminItems, true)}
                    </div>
                  )}
                </nav>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
