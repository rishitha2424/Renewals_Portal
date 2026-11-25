import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  LayoutDashboard,
  Clock,
  Calendar,
  CheckCircle2,
  Building2,
  Globe2,
  Table2,
  Upload,
  Printer,
  SunMoon,
  Briefcase,
  MessageSquare,
  Users,
  Mail,
  X,
  Loader2,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { useAuthStore } from '@/store/authStore'
import { searchGlobal } from '@/api/client'
import { formatCurrency } from '@/utils/format'

interface CommandItem {
  id: string
  label: string
  subtitle?: string
  category: 'Deals' | 'Accounts' | 'Regions' | 'Navigation' | 'Actions'
  icon: any
  to?: string
  action?: () => void
}

export default function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, toggleDarkMode, darkMode, setSelectedOppId } =
    useAppStore()
  const { currentUser } = useAuthStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [searchResults, setSearchResults] = useState<{
    deals: any[]
    accounts: any[]
    regions: any[]
  }>({ deals: [], accounts: [], regions: [] })
  const [isSearching, setIsSearching] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Base navigation commands based on user role
  const isKam = currentUser?.role === 'kam'
  const BASE_COMMANDS: CommandItem[] = isKam
    ? [
        { id: 'kam-overview', label: 'My Portfolio Overview', category: 'Navigation', icon: LayoutDashboard, to: '/kam/overview' },
        { id: 'kam-deals', label: 'My Deals List', category: 'Navigation', icon: Table2, to: '/kam/deals' },
        { id: 'messages', label: 'Messages Hub', category: 'Navigation', icon: MessageSquare, to: '/messages' },
        {
          id: 'theme',
          label: darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme',
          category: 'Actions',
          icon: SunMoon,
          action: toggleDarkMode,
        },
      ]
    : [
        { id: 'overview', label: 'Overview Dashboard', category: 'Navigation', icon: LayoutDashboard, to: '/' },
        { id: 'executive', label: 'Executive Summary', category: 'Navigation', icon: Printer, to: '/executive' },
        { id: 'regions', label: 'Regions', category: 'Navigation', icon: Globe2, to: '/regions' },
        { id: 'bu', label: 'Business Units', category: 'Navigation', icon: Building2, to: '/business-units' },
        { id: 'approvals', label: 'Approvals', category: 'Navigation', icon: CheckCircle2, to: '/approvals' },
        { id: 'delayed', label: 'Delayed Renewals', category: 'Navigation', icon: Clock, to: '/delayed' },
        { id: 'expiry', label: 'Expiry Timeline', category: 'Navigation', icon: Calendar, to: '/expiry' },
        { id: 'explore', label: 'Data Explorer', category: 'Navigation', icon: Table2, to: '/opportunities' },
        { id: 'messages', label: 'Messages Hub', category: 'Navigation', icon: MessageSquare, to: '/messages' },
        ...(currentUser?.role === 'admin'
          ? [
              { id: 'users', label: 'User Governance', category: 'Navigation' as const, icon: Users, to: '/admin/users' },
              { id: 'email-outbox', label: 'Email Outbox', category: 'Navigation' as const, icon: Mail, to: '/admin/email-outbox' },
              { id: 'data-uploads', label: 'Data Uploads', category: 'Navigation' as const, icon: Upload, to: '/data-uploads' },
            ]
          : []),
        {
          id: 'theme',
          label: darkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme',
          category: 'Actions',
          icon: SunMoon,
          action: toggleDarkMode,
        },
      ]

  // Debounced API search when query changes
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults({ deals: [], accounts: [], regions: [] })
      setIsSearching(false)
      return
    }

    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await searchGlobal({ q: query.trim(), limit: 8 })
        setSearchResults({
          deals: res?.deals || [],
          accounts: res?.accounts || [],
          regions: res?.regions || [],
        })
      } catch {
        setSearchResults({ deals: [], accounts: [], regions: [] })
      } finally {
        setIsSearching(false)
      }
    }, 150)

    return () => clearTimeout(timer)
  }, [query])

  // Build combined items
  const combinedItems: CommandItem[] = []

  // 1. Matching deals
  searchResults.deals.forEach((d) => {
    combinedItems.push({
      id: `deal-${d.opportunity_id_18}`,
      label: d.opportunity_name || d.opportunity_id_18,
      subtitle: `${d.account_name} · ${d.opportunity_owner} · ${formatCurrency(d.forecast_acv_amount)}`,
      category: 'Deals',
      icon: Briefcase,
      action: () => setSelectedOppId(d.opportunity_id_18),
    })
  })

  // 2. Matching accounts
  searchResults.accounts.forEach((a) => {
    combinedItems.push({
      id: `acc-${a.id}`,
      label: a.title,
      subtitle: 'Filter Explorer by Account',
      category: 'Accounts',
      icon: Building2,
      action: () => {
        navigate(`/opportunities?search=${encodeURIComponent(a.title)}`)
      },
    })
  })

  // 3. Matching regions
  searchResults.regions.forEach((r) => {
    combinedItems.push({
      id: `reg-${r.id}`,
      label: r.title,
      subtitle: 'View Region in Dashboard',
      category: 'Regions',
      icon: Globe2,
      action: () => {
        navigate('/regions')
      },
    })
  })

  // 4. Matching navigation & actions
  const filteredNav = BASE_COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase())
  )
  combinedItems.push(...filteredNav)

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('')
      setSelected(0)
      setSearchResults({ deals: [], accounts: [], regions: [] })
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
        return
      }

      if (!commandPaletteOpen) return

      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, combinedItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter' && combinedItems[selected]) {
        e.preventDefault()
        const cmd = combinedItems[selected]
        if (cmd.action) {
          cmd.action()
        } else if (cmd.to) {
          navigate(cmd.to)
        }
        setCommandPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, combinedItems, selected, navigate, setCommandPaletteOpen])

  return (
    <AnimatePresence>
      {commandPaletteOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-start justify-center pt-20 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setCommandPaletteOpen(false)}
          />

          {/* Palette Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -16 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl bg-[var(--bg-card)] border border-[var(--border)]"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]/40">
              <Search className="w-5 h-5 text-teal-500 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(0)
                }}
                placeholder={
                  isKam
                    ? 'Search my deals, accounts, views... (⌘K)'
                    : 'Search deals, accounts, regions, pages... (⌘K)'
                }
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
                id="command-palette-input"
              />
              {isSearching && <Loader2 className="w-4 h-4 text-teal-500 animate-spin shrink-0" />}
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results List */}
            <ul className="py-2 max-h-96 overflow-y-auto divide-y divide-[var(--border)]/40">
              {combinedItems.map((cmd, i) => {
                const Icon = cmd.icon
                const isSel = i === selected
                return (
                  <li key={cmd.id}>
                    <button
                      type="button"
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-xs text-left transition-colors ${
                        isSel
                          ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400 font-semibold'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                      }`}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => {
                        if (cmd.action) cmd.action()
                        else if (cmd.to) navigate(cmd.to)
                        setCommandPaletteOpen(false)
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          cmd.category === 'Deals'
                            ? 'bg-teal-500/10 text-teal-600'
                            : cmd.category === 'Accounts'
                            ? 'bg-amber-500/10 text-amber-600'
                            : cmd.category === 'Regions'
                            ? 'bg-blue-500/10 text-blue-600'
                            : 'bg-slate-500/10 text-slate-500'
                        }`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate text-[var(--text-primary)]">
                            {cmd.label}
                          </p>
                          {cmd.subtitle && (
                            <p className="text-[11px] text-[var(--text-muted)] truncate font-normal">
                              {cmd.subtitle}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider shrink-0 px-2 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)]">
                        {cmd.category}
                      </span>
                    </button>
                  </li>
                )
              })}
              {combinedItems.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                  {query ? `No matching items found for "${query}"` : 'Type to search...'}
                </li>
              )}
            </ul>

            {/* Keyboard Footer */}
            <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--bg-secondary)]/50 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[10px]">
                    ↑↓
                  </kbd>{' '}
                  Navigate
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[10px]">
                    ↵
                  </kbd>{' '}
                  Select
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border)] font-mono text-[10px]">
                    ESC
                  </kbd>{' '}
                  Close
                </span>
              </div>
              <span className="font-semibold text-teal-600 dark:text-teal-400">Mobileum Horizon</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
