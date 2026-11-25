import {
  LayoutDashboard,
  CheckCircle2,
  Globe2,
  Building2,
  Clock,
  Calendar,
  CalendarDays,
  Table2,
  Upload,
  Printer,
  MessageSquare,
  Users,
  Mail,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/executive', icon: Printer, label: 'Executive Summary' },
  { to: '/regions', icon: Globe2, label: 'Regions' },
  { to: '/business-units', icon: Building2, label: 'Business Units' },
  { to: '/approvals', icon: CheckCircle2, label: 'Approvals' },
  { to: '/delayed', icon: Clock, label: 'Delayed Renewals' },
  { to: '/expiry', icon: Calendar, label: 'Expiry' },
  { to: '/opportunities', icon: Table2, label: 'Data Explorer' },
  { to: '/messages', icon: MessageSquare, label: 'Messages Hub' },
]

export const KAM_NAV_ITEMS: NavItem[] = [
  { to: '/kam/overview', icon: LayoutDashboard, label: 'My Overview' },
  { to: '/kam/tracker', icon: CalendarDays, label: 'Deal Tracker' },
  { to: '/kam/deals', icon: Table2, label: 'My Opportunities' },
  { to: '/messages', icon: MessageSquare, label: 'Messages Hub' },
]

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/admin/users', icon: Users, label: 'User Governance' },
  { to: '/admin/email-outbox', icon: Mail, label: 'Email Dispatch' },
  { to: '/data-uploads', icon: Upload, label: 'Data Uploads' },
]
