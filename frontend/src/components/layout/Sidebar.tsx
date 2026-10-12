import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Clock,
  TrendingUp,
  Calendar,
  CheckCircle2,
  Building2,
  Globe2,
  Table2,
  History,
  Sparkles,
  Printer,
  ChevronLeft,
  ChevronRight,
  Palette,
  ShieldAlert,
  Upload,
  Activity,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import clsx from 'clsx'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/expiry', icon: Calendar, label: 'Expiry' },
  { to: '/approvals', icon: CheckCircle2, label: 'Approvals' },
  { to: '/business-units', icon: Building2, label: 'Business Units' },
  { to: '/regions', icon: Globe2, label: 'Regions' },
  { to: '/delayed', icon: Clock, label: 'Delayed Renewals' },
  { to: '/opportunities', icon: Table2, label: 'Data Explorer' },
  { to: '/upload', icon: Upload, label: 'Upload' },
  { to: '/history', icon: History, label: 'History' },
  { to: '/executive', icon: Printer, label: 'Executive', newTab: true },
]

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebarCollapsed } = useAppStore()
  const location = useLocation()

  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 72 : 240 }}
      transition={{ type: 'spring', damping: 26, stiffness: 320 }}
      className="flex-shrink-0 flex flex-col overflow-hidden select-none border-r z-30 transition-colors"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10 h-16 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-white/10 p-1 shadow-md">
          <img
            src="/assets/logo.png"
            alt="Mobileum"
            className="w-full h-full object-contain"
          />
        </div>
        {!sidebarCollapsed && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="overflow-hidden whitespace-nowrap"
          >
            <p className="text-white font-extrabold text-sm leading-tight tracking-wide font-display">
              Mobileum Horizon
            </p>
            <p className="text-teal-400 text-[10px] font-medium tracking-tight opacity-90">
              Renewals Intelligence Platform
            </p>
          </motion.div>
        )}
      </div>

      {/* Nav List */}
      <nav className="flex-1 px-2.5 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map(({ to, icon: Icon, label, newTab }) => {
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
              target={newTab ? '_blank' : undefined}
              title={sidebarCollapsed ? label : undefined}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group relative',
                isActive
                  ? 'bg-teal-500/20 text-teal-300 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              )}
            >
              {/* Active glow accent bar */}
              {isActive && (
                <motion.div
                  layoutId="active-nav-indicator"
                  className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-teal-400 rounded-r-full"
                  transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                />
              )}

              <Icon
                className={clsx(
                  'w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-105',
                  isActive ? 'text-teal-400' : 'text-slate-400 group-hover:text-white'
                )}
                strokeWidth={isActive ? 2.2 : 1.8}
              />

              {!sidebarCollapsed && (
                <span className="truncate whitespace-nowrap">{label}</span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Bottom Footer: Design System link + Collapse toggle */}
      <div className="p-3 border-t border-white/10 space-y-2 flex-shrink-0">
        {!sidebarCollapsed && (
          <NavLink
            to="/design"
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-teal-300 hover:bg-white/5 transition-colors"
          >
            <Palette className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <span className="truncate">Design System</span>
          </NavLink>
        )}

        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 text-xs transition-colors"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  )
}
