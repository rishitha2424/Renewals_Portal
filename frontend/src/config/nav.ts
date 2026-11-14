import {
  LayoutDashboard,
  CheckCircle2,
  Globe2,
  Building2,
  Clock,
  Calendar,
  Table2,
  Upload,
  Printer,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: LucideIcon
  label: string
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/approvals', icon: CheckCircle2, label: 'Approvals' },
  { to: '/regions', icon: Globe2, label: 'Regions' },
  { to: '/business-units', icon: Building2, label: 'Business Units' },
  { to: '/delayed', icon: Clock, label: 'Delayed Renewals' },
  { to: '/expiry', icon: Calendar, label: 'Expiry' },
  { to: '/opportunities', icon: Table2, label: 'Data Explorer' },
  { to: '/data-uploads', icon: Upload, label: 'Data Uploads' },
  { to: '/executive', icon: Printer, label: 'Executive Summary' },
]
