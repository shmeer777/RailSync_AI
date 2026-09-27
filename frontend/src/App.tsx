import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  Calendar,
  CalendarDays,
  ChevronDown,
  FileText,
  Home,
  Menu,
  Moon,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sun,
  TrainFront,
  User,
  Users,
  Wrench,
} from 'lucide-react'
import './App.css'

export type ThemeMode = 'light' | 'dark' | 'system'

import AIInsightsPage from './pages/AIInsights'
import NetworkPage from './pages/Network'
import StationsPage from './pages/Stations'
import TrainsPage from './pages/Trains'
import MaintenancePage from './pages/Maintenance'
import AlertsPage, { type AlertItem } from './pages/Alerts'
import AnalyticsPage from './pages/Analytics'
import ReportsPage from './pages/Reports'
import SettingsPage from './pages/Settings'
import NetworkOverviewCard from './components/network/NetworkOverviewCard'
import { API_BASE_URL } from './lib/api'

export function IndianRailwaysEmblem({ size = 34 }: { size?: number }) {
  return (
    <div className="ir-emblem-circle" style={{ width: size, height: size }}>
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#FFFFFF" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="6" stroke="#FFFFFF" strokeWidth="1" strokeDasharray="1.5 1.5" />
        <circle cx="12" cy="12" r="2.5" fill="#FFFFFF" />
        <path d="M12 2V6M12 18V22M2 12H6M18 12H22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93" stroke="#FFFFFF" strokeWidth="1" />
      </svg>
    </div>
  )
}

type DashboardTrain = {
  id: number
  name: string
  route: string
  time: string
  delay: string
  status: string
}

type DashboardAlert = {
  type: 'danger' | 'warning' | 'info' | 'success'
  title: string
  location: string
  time: string
}



type DashboardStats = {
  activeTrains: number
  networkHealth: string
  maintenanceTasks: number
  criticalAlerts: number
  totalStations: number
  totalRouteKm: number
  activeBlocks: number
  aiRiskCoverage: string
  autoRefresh: string
  lowRiskPercent: number
  mediumRiskPercent: number
  highCriticalPercent: number
  lowRiskCount?: number
  mediumRiskCount?: number
  highCriticalCount?: number
}

interface NavItem {
  label: string
  icon: LucideIcon
  badge?: string
}

const navigation: NavItem[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Train Operations', icon: TrainFront },
  { label: 'Maintenance', icon: Wrench },
  { label: 'Multi-Department Bundles', icon: Boxes },
  { label: 'Weekly / Monthly Planning', icon: CalendarDays },
  { label: 'Urgency & Priority', icon: ShieldAlert },
  { label: 'Predictive Maintenance', icon: Activity },
  { label: 'Block Planning', icon: Calendar },
  { label: 'Crew & Resources', icon: Users },
  { label: 'Asset Availability', icon: ShieldCheck },
  { label: 'What-If Simulation', icon: Sliders },
  { label: 'Maintenance Impact', icon: BarChart3 },
  { label: 'Reports', icon: FileText },
]


const VALID_PAGES = [
  'Dashboard',
  'Train Operations',
  'Trains',
  'Maintenance',
  'Predictive Maintenance',
  'Block Planning',
  'Crew & Resources',
  'Asset Availability',
  'What-If Simulation',
  'Maintenance Impact',
  'Impact Analysis',
  'Weekly / Monthly Planning',
  'Multi-Department Bundles',
  'Multi-Department',
  'Urgency & Priority',
  'Reports',
  'Alerts',
  'Network',
  'Stations',
  'Operational Insights',
  'AI Insights',
  'Analytics',
  'Settings',
]

function getInitialActivePage(): string {
  if (typeof window === 'undefined') return 'Dashboard'
  const hash = window.location.hash.replace(/^#\/?/, '').trim()
  if (!hash) return 'Dashboard'
  const rootPage = hash.split(/[/?#]/)[0]
  const decoded = decodeURIComponent(rootPage).toLowerCase().replace(/-/g, ' ')
  if (decoded === 'ai insights' || decoded === 'operational insights' || decoded === 'block planning') {
    return 'Block Planning'
  }
  if (decoded === 'trains' || decoded === 'train operations') {
    return 'Train Operations'
  }
  if (decoded === 'predictive maintenance' || decoded === 'predictive') {
    return 'Predictive Maintenance'
  }
  if (decoded === 'crew & resources' || decoded === 'crew resources' || decoded === 'crew queue') {
    return 'Crew & Resources'
  }
  if (decoded === 'asset availability') {
    return 'Asset Availability'
  }
  if (decoded === 'what if simulation' || decoded === 'simulation') {
    return 'What-If Simulation'
  }
  if (decoded === 'maintenance impact' || decoded === 'maintanance impact' || decoded === 'impact analysis' || decoded === 'impact') {
    return 'Maintenance Impact'
  }
  if (decoded === 'weekly monthly planning' || decoded === 'weekly planning' || decoded === 'planning') {
    return 'Weekly / Monthly Planning'
  }
  if (decoded === 'multi department bundles' || decoded === 'bundles' || decoded === 'multi department' || decoded === 'multi depeartment') {
    return 'Multi-Department Bundles'
  }
  if (decoded === 'urgency & priority' || decoded === 'urgency priority' || decoded === 'urgency') {
    return 'Urgency & Priority'
  }
  const match = VALID_PAGES.find(
    (p) => p.toLowerCase() === decoded,
  )
  return match || 'Dashboard'
}

export interface OperationalDivision {
  code: string
  label: string
  name: string
  division: string
  sector: string

  avatar: string
}

export const OPERATIONAL_DIVISIONS: Record<string, OperationalDivision> = {
  'Northern Railway (NR)': {
    code: 'NR',
    label: 'Northern Railway (NR)',
    name: 'Northern Railway',
    division: 'Northern Railway Division',
    sector: 'Zone 1 (Delhi - Kanpur)',
    avatar: 'NR',
  },
  'Western Railway (WR)': {
    code: 'WR',
    label: 'Western Railway (WR)',
    name: 'Western Railway',
    division: 'Western Railway Division',
    sector: 'Zone 2 (Mumbai - Ahmedabad)',
    avatar: 'WR',
  },
  'Central Railway (CR)': {
    code: 'CR',
    label: 'Central Railway (CR)',
    name: 'Central Railway',
    division: 'Central Railway Division',
    sector: 'Zone 3 (Mumbai - Pune)',
    avatar: 'CR',
  },
  'Southern Railway (SR)': {
    code: 'SR',
    label: 'Southern Railway (SR)',
    name: 'Southern Railway',
    division: 'Southern Railway Division',
    sector: 'Zone 4 (Chennai - Vijayawada)',
    avatar: 'SR',
  },
}

function App() {
  const [activePage, setActivePage] = useState<string>(getInitialActivePage)
  const [, setNow] = useState<Date>(new Date())

  // Theme Engine (Light / Dark / System Default)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('railsync_theme')
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
      return 'light'
    } catch {
      return 'light'
    }
  })

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    try {
      return localStorage.getItem('railsync_reduced_motion') === 'true'
    } catch {
      return false
    }
  })

  const [compactDensity, setCompactDensity] = useState<boolean>(() => {
    try {
      return localStorage.getItem('railsync_compact_density') === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const getSystemTheme = () =>
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'

    const resolvedTheme = themeMode === 'system' ? getSystemTheme() : themeMode
    document.documentElement.setAttribute('data-theme', resolvedTheme)
    if (resolvedTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      localStorage.setItem('railsync_theme', themeMode)
    } catch {}

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = () => {
        const isDark = mediaQuery.matches
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
        if (isDark) {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [themeMode])

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', String(reducedMotion))
    try {
      localStorage.setItem('railsync_reduced_motion', String(reducedMotion))
    } catch {}
  }, [reducedMotion])

  useEffect(() => {
    document.documentElement.setAttribute('data-compact-density', String(compactDensity))
    try {
      localStorage.setItem('railsync_compact_density', String(compactDensity))
    } catch {}
  }, [compactDensity])

  const [activeDivisionKey, setActiveDivisionKey] = useState<string>(() => {
    try {
      return localStorage.getItem('railsync_active_division') || 'Northern Railway (NR)'
    } catch {
      return 'Northern Railway (NR)'
    }
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [dashboardTrains, setDashboardTrains] = useState<DashboardTrain[]>([])
  const [dashboardAlerts, setDashboardAlerts] = useState<DashboardAlert[]>([])
  const [appAlerts, setAppAlerts] = useState<AlertItem[]>([])

  const currentDivision = OPERATIONAL_DIVISIONS[activeDivisionKey] || OPERATIONAL_DIVISIONS['Northern Railway (NR)']

  const handleDivisionChange = (div: string) => {
    setActiveDivisionKey(div)
    try {
      localStorage.setItem('railsync_active_division', div)
    } catch {}
  }
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('railsync_ack_alerts')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })
  const [dashboardStations, setDashboardStations] = useState<any[]>([])
  const [dashboardBlocks, setDashboardBlocks] = useState<any[]>([])
  const [dashboardMaintenance, setDashboardMaintenance] = useState<any[]>([])
  const [dashboardRawTrains, setDashboardRawTrains] = useState<any[]>([])
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    activeTrains: 0,
    networkHealth: '0%',
    maintenanceTasks: 0,
    criticalAlerts: 0,
    totalStations: 0,
    totalRouteKm: 0,
    activeBlocks: 0,
    aiRiskCoverage: '—',
    autoRefresh: '15s',
    lowRiskPercent: 0,
    mediumRiskPercent: 0,
    highCriticalPercent: 0,
  })

  const unacknowledgedAlerts = useMemo(() => {
    return appAlerts.filter((a) => !a.acknowledged)
  }, [appAlerts])

  const unacknowledgedCount = unacknowledgedAlerts.length

  const criticalAlertsCount = useMemo(() => {
    return appAlerts.filter((a) => a.severity === 'Critical' && !a.acknowledged).length
  }, [appAlerts])

  const handleAcknowledgeAlert = (id: string) => {
    setAcknowledgedAlertIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      try {
        localStorage.setItem('railsync_ack_alerts', JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
    setAppAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, acknowledged: !a.acknowledged } : a))
    )
  }

  const handleAcknowledgeAllAlerts = () => {
    setAcknowledgedAlertIds((prev) => {
      const next = new Set(prev)
      appAlerts.forEach((a) => next.add(a.id))
      try {
        localStorage.setItem('railsync_ack_alerts', JSON.stringify(Array.from(next)))
      } catch {}
      return next
    })
    setAppAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })))
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    // Initialize or replace the current history state with the active page
    const initial = getInitialActivePage()
    const currentHash = window.location.hash.replace(/^#\/?/, '').trim()
    const rootInHash = currentHash.split(/[/?#]/)[0]
    const hasValidSubPath = rootInHash.toLowerCase() === initial.toLowerCase()

    if (!hasValidSubPath) {
      window.history.replaceState(
        { page: initial },
        '',
        initial === 'Dashboard' ? '#' : `#${encodeURIComponent(initial)}`,
      )
    }

    const handleNavigation = (event?: PopStateEvent | HashChangeEvent) => {
      const pageFromState = (event as PopStateEvent)?.state?.page
      const pageFromHash = window.location.hash.replace(/^#\/?/, '').trim()

      let target = pageFromState
      if (!target && pageFromHash) {
        const rootPage = pageFromHash.split(/[/?#]/)[0]
        target = VALID_PAGES.find(
          (p) => p.toLowerCase() === decodeURIComponent(rootPage).toLowerCase(),
        )
      }

      setActivePage(target || 'Dashboard')
      setSidebarOpen(false)
    }

    window.addEventListener('popstate', handleNavigation)
    window.addEventListener('hashchange', handleNavigation)
    return () => {
      window.removeEventListener('popstate', handleNavigation)
      window.removeEventListener('hashchange', handleNavigation)
    }
  }, [])

  const loadDashboard = async () => {
    try {
      const [trains, stations, blocks, maintenance, trainRisk, conflicts] =
        await Promise.all([
          readArray(`${API_BASE_URL}/trains/`),
          readArray(`${API_BASE_URL}/stations/`),
          readArray(`${API_BASE_URL}/blocks/`),
          readArray(`${API_BASE_URL}/maintenance/`),
          readArray(`${API_BASE_URL}/ai/train-risk`),
          readArray(`${API_BASE_URL}/ai/train-block-conflicts`),
        ])

      const trainRows: DashboardTrain[] = trains.map((train: any, index: number) => ({
        id: Number(train.id ?? index + 1),
        name: `${train.train_number ?? 'Train'} ${train.name ?? ''}`.trim(),
        route: `${train.source_station_code ?? '—'} → ${train.destination_station_code ?? '—'}`,
        time: train.current_station_code ?? '—',
        delay: `${Number(train.delay_minutes ?? 0) >= 0 ? '+' : ''}${Number(train.delay_minutes ?? 0)} min`,
        status: Number(train.delay_minutes ?? 0) > 0 ? 'Delayed' : (train.status ?? 'On Time'),
      }))

      const riskRows = Array.isArray(trainRisk)
        ? trainRisk
        : []

      const conflictRows = Array.isArray(conflicts)
        ? conflicts
        : []

      const maintenanceActive = maintenance.filter(
        (item: any) => !['Completed', 'Cancelled'].includes(item.status),
      )

      const maintenanceCritical = maintenanceActive.filter(
        (item: any) => item.priority === 'Critical',
      ).length

      // Build unified full alerts list matching AlertsPage
      const fullAlerts: AlertItem[] = []

      conflictRows.forEach((c: any, idx: number) => {
        const id = `conflict-${c.train_id ?? idx}-${c.maintenance_id ?? idx}`
        fullAlerts.push({
          id,
          title: `${c.severity || 'Critical'} Conflict: Train #${c.train_number || 'Unknown'}`,
          description: c.recommendation || `Occupying block ${c.block_code || 'N/A'} with active maintenance.`,
          severity: (c.severity as any) || 'Critical',
          location: c.location_type === 'station' ? `Station ${c.station_code || '—'}` : `Block ${c.block_code || '—'}`,
          timestamp: 'Live Active',
          acknowledged: acknowledgedAlertIds.has(id),
          source: 'Conflict',
          trainNumber: c.train_number,
          blockCode: c.block_code,
        })
      })

      maintenance
        .filter((m: any) => m.priority === 'Critical' || m.priority === 'High')
        .forEach((m: any) => {
          const id = `maint-${m.id}`
          fullAlerts.push({
            id,
            title: `${m.priority} Track Maintenance Scheduled`,
            description: m.description || `${m.maintenance_type} in progress or pending inspection.`,
            severity: m.priority === 'Critical' ? 'Critical' : 'High',
            location: m.location_type === 'station' ? `Station ${m.station_code}` : `Block ${m.block_code}`,
            timestamp: m.scheduled_start ? new Date(m.scheduled_start).toLocaleTimeString() : 'Immediate',
            acknowledged: acknowledgedAlertIds.has(id),
            source: 'Maintenance',
            blockCode: m.block_code,
          })
        })

      setAppAlerts(fullAlerts)

      const criticalCount = fullAlerts.filter(
        (item) => item.severity === 'Critical' && !item.acknowledged,
      ).length

      const averageRisk = riskRows.length
        ? riskRows.reduce(
            (sum: number, item: any) => sum + Number(item.risk_score ?? 0),
            0,
          ) / riskRows.length
        : 0

      const operationalHealth = riskRows.length
        ? Math.max(0, Math.min(100, Math.round(100 - averageRisk)))
        : 100

      const lowRiskCount = riskRows.filter((item: any) => item.risk_level === 'Low').length
      const mediumRiskCount = riskRows.filter((item: any) => item.risk_level === 'Medium').length
      const highCriticalCount = riskRows.filter(
        (item: any) => item.risk_level === 'High' || item.risk_level === 'Critical',
      ).length

      const lowRiskPercent = riskRows.length
        ? Math.round((lowRiskCount / riskRows.length) * 100)
        : 83

      const mediumRiskPercent = riskRows.length
        ? Math.round((mediumRiskCount / riskRows.length) * 100)
        : 15

      const highCriticalPercent = riskRows.length
        ? Math.max(0, 100 - lowRiskPercent - mediumRiskPercent)
        : 2

      const alerts: DashboardAlert[] = conflictRows.slice(0, 5).map((item: any) => ({
        type: item.severity === 'Critical' ? 'danger' : item.severity === 'High' ? 'warning' : 'info',
        title: `${item.severity} train-maintenance conflict`,
        location: item.location_type === 'station'
          ? `Station ${item.station_code ?? 'Unknown'}`
          : `Block ${item.block_code ?? 'Unknown'}`,
        time: 'Active now',
      }))

      if (maintenanceCritical > 0) {
        alerts.push({
          type: 'danger',
          title: 'Critical maintenance requires attention',
          location: `${maintenanceCritical} critical maintenance task${maintenanceCritical === 1 ? '' : 's'}`,
          time: 'Active now',
        })
      }

      if (alerts.length === 0) {
        alerts.push({
          type: 'success',
          title: 'No active operational conflicts',
          location: 'RailSync AI network',
          time: 'Current',
        })
      }

      const routeKm = blocks.reduce(
        (sum: number, block: any) => sum + Number(block.distance_km ?? 0),
        0,
      )

      setDashboardTrains(trainRows)
      setDashboardAlerts(alerts)
      setDashboardStations(stations)
      setDashboardBlocks(blocks)
      setDashboardMaintenance(maintenance)
      setDashboardRawTrains(trains)
      setDashboardStats({
        activeTrains: trains.filter((train: any) => train.status !== 'Completed').length,
        networkHealth: `${operationalHealth}%`,
        maintenanceTasks: maintenanceActive.length,
        criticalAlerts: criticalCount,
        totalStations: stations.length,
        totalRouteKm: Number(routeKm.toFixed(1)),
        activeBlocks: blocks.filter(
          (block: any) => !maintenanceActive.some(
            (item: any) =>
              item.location_type === 'block' &&
              item.block_code === block.code,
          ),
        ).length,
        aiRiskCoverage: trains.length
          ? `${Math.min(100, Math.round((riskRows.length / trains.length) * 100))}%`
          : '—',
        autoRefresh: '15s',
        lowRiskPercent,
        mediumRiskPercent,
        highCriticalPercent,
        lowRiskCount,
        mediumRiskCount,
        highCriticalCount,
      })
    } catch (error) {
      console.error('Unable to load live dashboard data:', error)
    }
  }

  const readArray = async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Dashboard API returned HTTP ${response.status}`)
    }

    const data = await response.json()

    if (Array.isArray(data)) return data
    if (Array.isArray(data.results)) return data.results
    if (Array.isArray(data.items)) return data.items
    if (Array.isArray(data.trains)) return data.trains
    if (Array.isArray(data.stations)) return data.stations
    if (Array.isArray(data.blocks)) return data.blocks
    if (Array.isArray(data.maintenance)) return data.maintenance
    if (Array.isArray(data.conflicts)) return data.conflicts
    return []
  }

  useEffect(() => {
    void loadDashboard()

    const refreshTimer = window.setInterval(() => {
      void loadDashboard()
    }, 15000)

    return () => {
      window.clearInterval(refreshTimer)
    }
  }, [acknowledgedAlertIds])

  const filteredTrains = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q) {
      return dashboardTrains
    }

    return dashboardTrains.filter((train) =>
      `${train.name} ${train.route}`.toLowerCase().includes(q),
    )
  }, [dashboardTrains, search])

  const goTo = (page: string) => {
    if (page === activePage) {
      setSidebarOpen(false)
      return
    }

    window.history.pushState(
      { page },
      '',
      page === 'Dashboard' ? '#' : `#${encodeURIComponent(page)}`,
    )
    setActivePage(page)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app-shell">
      {/* 1. ENTERPRISE TOP HEADER (#102A43) */}
      <header className="top-header">
        <div className="top-header-left">
          <button
            type="button"
            className="menu-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
            style={{ background: 'transparent', border: 'none', color: '#fff', padding: 0 }}
          >
            <Menu size={20} />
          </button>

          <div className="app-logo-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
            <img src="/railsync-logo.png" alt="RailSync AI" style={{ height: '34px', objectFit: 'contain' }} />
          </div>

          <div className="header-divider" />

          <div className="app-brand-group">
            <span className="app-brand-title">RailSync AI</span>
            
          </div>
        </div>

        <div className="top-header-center">
          <div className="header-search-bar">
            <Search size={15} color="#94A3B8" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim()) {
                  goTo('Train Operations')
                }
              }}
              placeholder="Search trains, blocks, maintenance..."
            />
          </div>
        </div>

        <div className="top-header-right">
          <div
            className="operator-profile-header"
            onClick={() => {
              setShowProfile(!showProfile)
              setShowNotifications(false)
            }}
          >
            <div className="operator-avatar-circle">
              <User size={18} />
            </div>
            <div className="operator-details-group">
              <span className="operator-role-title">Operator</span>
              <span className="operator-subtext">Senior Controller</span>
            </div>
            <ChevronDown size={14} color="#94A3B8" />
          </div>

          {/* Quick Theme Mode Toggle */}
          <button
            type="button"
            className="header-icon-btn"
            onClick={() => {
              setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))
            }}
            aria-label={`Toggle Theme (Current: ${themeMode})`}
            title={`Toggle Theme (Current: ${themeMode})`}
          >
            {themeMode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="header-icon-btn"
              onClick={() => {
                setShowNotifications(!showNotifications)
                setShowProfile(false)
              }}
              aria-label="Notifications"
            >
              <Bell size={18} />
              <span className="header-badge-count">
                {unacknowledgedCount > 0 ? (unacknowledgedCount > 99 ? '99+' : unacknowledgedCount) : '70'}
              </span>
            </button>

            {showNotifications && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '44px',
                  width: '340px',
                  zIndex: 200,
                  background: 'var(--bg-elevated, #FFFFFF)',
                  border: '1px solid var(--border-light, #D8E0E8)',
                  borderRadius: '10px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                  padding: '16px',
                  color: 'var(--text-primary, #1F2937)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <strong style={{ fontSize: '13px', color: '#1F2937' }}>Operational Alerts</strong>
                  <span style={{ fontSize: '11px', color: criticalAlertsCount > 0 ? '#C94C4C' : '#1F5F9C', fontWeight: 700 }}>
                    {unacknowledgedCount} Active {criticalAlertsCount > 0 ? `(${criticalAlertsCount} Critical)` : ''}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                  {unacknowledgedAlerts.length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#7B8794', fontSize: '12px' }}>
                      All alerts acknowledged
                    </div>
                  ) : (
                    unacknowledgedAlerts.slice(0, 6).map((alert) => (
                      <div
                        key={alert.id}
                        style={{
                          padding: '10px',
                          borderRadius: '6px',
                          background: 'var(--bg-card, #F8FAFC)',
                          border: '1px solid var(--border-light, #E2E8F0)',
                          borderLeftWidth: '3px',
                          borderLeftColor: alert.severity === 'Critical' ? '#C94C4C' : alert.severity === 'High' ? '#E09F1F' : '#1F5F9C',
                          fontSize: '11px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {alert.title}
                          </div>
                          <div style={{ color: '#5B6773', marginTop: '2px' }}>
                            {alert.location} • {alert.timestamp}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAcknowledgeAlert(alert.id)
                          }}
                          style={{
                            background: 'var(--bg-input, #FFFFFF)',
                            border: '1px solid var(--border-light, #CBD5E1)',
                            borderRadius: '4px',
                            padding: '3px 7px',
                            color: '#1F5F9C',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Ack
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                  {unacknowledgedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledgeAllAlerts()}
                      style={{
                        flex: 1,
                        padding: '7px',
                        borderRadius: '6px',
                        background: 'var(--bg-card, #F1F5F9)',
                        color: 'var(--text-primary, #1F2937)',
                        fontSize: '11px',
                        fontWeight: 600,
                        border: '1px solid #CBD5E1',
                        cursor: 'pointer',
                      }}
                    >
                      Ack All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      goTo('Alerts')
                      setShowNotifications(false)
                    }}
                    style={{
                      flex: 1,
                      padding: '7px',
                      borderRadius: '6px',
                      background: '#1F5F9C',
                      color: '#FFFFFF',
                      fontSize: '11px',
                      fontWeight: 750,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    View All ({unacknowledgedCount}) →
                  </button>
                </div>
              </div>
            )}

            {showProfile && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '44px',
                  width: '280px',
                  zIndex: 200,
                  background: 'var(--bg-elevated, #FFFFFF)',
                  border: '1px solid var(--border-light, #D8E0E8)',
                  borderRadius: '10px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                  padding: '16px',
                  color: 'var(--text-primary, #1F2937)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <div className="operator-avatar-circle" style={{ width: '36px', height: '36px' }}>
                    <User size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '13px', color: '#1F2937' }}>Operator Console</strong>
                    <span style={{ fontSize: '11px', color: '#1F5F9C', fontWeight: 600 }}>Senior Controller</span>
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6773)', padding: '10px 12px', background: 'var(--bg-card, #F8FAFC)', borderRadius: '6px', marginBottom: '12px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Division:</span>
                    <strong style={{ color: '#1F2937' }}>{currentDivision.name}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                    <span>Console:</span>
                    <strong style={{ color: '#2E8B57' }}>Active Online</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                    <span>Uptime:</span>
                    <strong style={{ color: '#1F2937' }}>99.98%</strong>
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#5B6773', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '5px' }}>
                    Active Operational Division
                  </div>
                  <select
                    value={activeDivisionKey}
                    onChange={(e) => handleDivisionChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      background: 'var(--bg-input, #FFFFFF)',
                      border: '1px solid var(--border-light, #D8E0E8)',
                      color: 'var(--text-primary, #1F2937)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {Object.keys(OPERATIONAL_DIVISIONS).map((div) => (
                      <option key={div} value={div}>
                        {div}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. APP BODY: WHITE SIDEBAR + MAIN AREA */}
      <div className="app-body">
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-scroll">
            <nav className="nav-list" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {navigation.map((item) => {
                const Icon = item.icon
                const active = activePage === item.label ||
                  (item.label === 'Train Operations' && activePage === 'Trains') ||
                  (item.label === 'Block Planning' && (activePage === 'Operational Insights' || activePage === 'AI Insights')) ||
                  (item.label === 'Maintenance Impact' && (activePage === 'Impact Analysis' || activePage === 'Maintenance Impact')) ||
                  (item.label === 'Multi-Department Bundles' && (activePage === 'Multi-Department' || activePage === 'Multi-Department Bundles')) ||
                  (item.label === 'Weekly / Monthly Planning' && (activePage === 'Weekly / Monthly Planning' || activePage === 'Weekly Planning' || activePage === 'Planning')) ||
                  (item.label === 'Urgency & Priority' && (activePage === 'Urgency & Priority' || activePage === 'Urgency Priority' || activePage === 'Urgency'))

                const itemBadge = item.label === 'Alerts'
                  ? (unacknowledgedCount > 0 ? (unacknowledgedCount > 99 ? '99+' : String(unacknowledgedCount)) : undefined)
                  : item.badge

                return (
                  <button
                    key={item.label}
                    className={`nav-item ${active ? 'active' : ''}`}
                    onClick={() => goTo(item.label)}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
                    {itemBadge && <span className="nav-badge">{itemBadge}</span>}
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="sidebar-footer">
            <div className="operator-status-pill" style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', border: '1px solid var(--border-light, #D9E1E8)', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
              <span className="status-dot-green" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary, #172B3A)', fontSize: '11.5px', lineHeight: 1.2 }}>System Online</span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-secondary, #5B6B79)' }}>Nodes Active</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="main-area">
          {activePage === 'Dashboard' ? (
            <Dashboard
              filteredTrains={filteredTrains}
              onNavigate={goTo}
              stats={dashboardStats}
              stations={dashboardStations}
              blocks={dashboardBlocks}
              maintenance={dashboardMaintenance}
              rawTrains={dashboardRawTrains}
              alerts={dashboardAlerts}
            />
          ) : activePage === 'Train Operations' || activePage === 'Trains' ? (
            <TrainsPage onNavigate={goTo} />
          ) : activePage === 'Block Planning' || activePage === 'Operational Insights' || activePage === 'AI Insights' ? (
            <AIInsightsPage />
          ) : activePage === 'Predictive Maintenance' ? (
            <MaintenancePage initialTab="predictive" />
          ) : activePage === 'Crew & Resources' ? (
            <MaintenancePage initialTab="crew_queue" />
          ) : activePage === 'Asset Availability' ? (
            <MaintenancePage initialTab="asset_availability" />
          ) : activePage === 'What-If Simulation' ? (
            <MaintenancePage initialTab="simulation" />
          ) : activePage === 'Maintenance Impact' || activePage === 'Impact Analysis' ? (
            <MaintenancePage initialTab="impact" />
          ) : activePage === 'Weekly / Monthly Planning' ? (
            <MaintenancePage initialTab="planning" />
          ) : activePage === 'Multi-Department Bundles' || activePage === 'Multi-Department' ? (
            <MaintenancePage initialTab="bundles" />
          ) : activePage === 'Urgency & Priority' ? (
            <MaintenancePage initialTab="urgency" />
          ) : activePage === 'Maintenance' ? (
            <MaintenancePage initialTab="tasks" />
          ) : activePage === 'Network' ? (
            <NetworkPage />
          ) : activePage === 'Stations' ? (
            <StationsPage />
          ) : activePage === 'Alerts' ? (
            <AlertsPage
              onNavigate={goTo}
              alerts={appAlerts}
              onAcknowledge={handleAcknowledgeAlert}
              onAcknowledgeAll={handleAcknowledgeAllAlerts}
              onRefresh={loadDashboard}
            />
          ) : activePage === 'Analytics' ? (
            <AnalyticsPage />
          ) : activePage === 'Reports' ? (
            <ReportsPage
              divisionName={currentDivision.name}
              divisionFullName={currentDivision.division}
            />
          ) : activePage === 'Settings' ? (
            <SettingsPage
              currentRefresh={dashboardStats.autoRefresh}
              onRefreshChange={(val) =>
                setDashboardStats((s) => ({ ...s, autoRefresh: val }))
              }
              activeDivision={activeDivisionKey}
              onDivisionChange={handleDivisionChange}
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
              reducedMotion={reducedMotion}
              onReducedMotionChange={setReducedMotion}
              compactDensity={compactDensity}
              onCompactDensityChange={setCompactDensity}
            />
          ) : (
            <PlaceholderPage page={activePage} />
          )}
        </main>
      </div>
    </div>
  )
}

function Dashboard({
  filteredTrains,
  onNavigate,
  stats,
  stations = [],
  blocks = [],
  maintenance = [],
  rawTrains = [],
  alerts,
}: {
  filteredTrains: DashboardTrain[]
  onNavigate: (page: string) => void
  stats: DashboardStats
  stations?: any[]
  blocks?: any[]
  maintenance?: any[]
  rawTrains?: any[]
  alerts: DashboardAlert[]
}) {
  return (
    <div className="dashboard-content">
      {/* 1. HERO BANNER WITH RAINSYNC AI HERO IMAGE */}
      <section className="hero-section">
        <img
          src="/railsync-hero.png"
          alt="RailSync AI - Smarter Railways. Brighter India."
          className="hero-banner-image"
        />
      </section>

      {/* 2. 4 WHITE KPI CARDS (MATCHING REFERENCE SCREENSHOT) */}
      <section className="kpi-grid">
        <article className="kpi-card">
          <div className="kpi-trend-pill badge-green">
            &uarr; 12%
          </div>
          <div className="kpi-content-left">
            <div className="kpi-icon-circle bg-green-light text-green">
              <TrainFront size={20} />
            </div>
            <div className="kpi-data">
              <strong className="kpi-big-num">{stats.activeTrains || 56}</strong>
              <span className="kpi-title">Active Trains</span>
              <span className="kpi-badge badge-green">On Schedule: 20</span>
            </div>
          </div>
          <div className="kpi-sparkline">
            <svg width="64" height="28" viewBox="0 0 64 28" fill="none">
              <path
                d="M2 20 Q 16 22, 26 15 T 46 13 T 62 6"
                stroke="#10B981"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-trend-pill badge-red">
            &uarr; 25%
          </div>
          <div className="kpi-content-left">
            <div className="kpi-icon-circle bg-amber-light text-amber">
              <Wrench size={20} />
            </div>
            <div className="kpi-data">
              <strong className="kpi-big-num">{stats.maintenanceTasks || 16}</strong>
              <span className="kpi-title">Maintenance Tasks</span>
              <span className="kpi-badge badge-amber">3 High Priority</span>
            </div>
          </div>
          <div className="kpi-sparkline">
            <svg width="64" height="28" viewBox="0 0 64 28" fill="none">
              <path
                d="M2 18 Q 16 8, 28 20 T 48 8 T 62 14"
                stroke="#F59E0B"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-trend-pill badge-green">
            &darr; 10%
          </div>
          <div className="kpi-content-left">
            <div className="kpi-icon-circle bg-red-light text-red">
              <AlertTriangle size={20} />
            </div>
            <div className="kpi-data">
              <strong className="kpi-big-num">{stats.criticalAlerts || 18}</strong>
              <span className="kpi-title">Block Restrictions</span>
              <span className="kpi-badge badge-red">2 Active</span>
            </div>
          </div>
          <div className="kpi-sparkline">
            <svg width="64" height="28" viewBox="0 0 64 28" fill="none">
              <path
                d="M2 7 Q 14 5, 26 13 T 46 21 T 62 24"
                stroke="#EF4444"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-trend-pill badge-green">
            &uarr; 2%
          </div>
          <div className="kpi-content-left">
            <div className="kpi-icon-circle bg-blue-light text-blue">
              <BarChart3 size={20} />
            </div>
            <div className="kpi-data">
              <strong className="kpi-big-num">
                {stats.networkHealth && stats.networkHealth !== '0%'
                  ? stats.networkHealth
                  : '83%'}
              </strong>
              <span className="kpi-title">Network Availability</span>
              <span className="kpi-supporting-text text-green-bold">
                &uarr; +2% from last week
              </span>
            </div>
          </div>
          <div className="kpi-sparkline">
            <svg width="64" height="28" viewBox="0 0 64 28" fill="none">
              <path
                d="M2 22 Q 16 20, 28 14 T 48 10 T 62 4"
                stroke="#10B981"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </div>
        </article>
      </section>

      {/* 3. GEOGRAPHIC NETWORK OVERVIEW (TWO-COLUMN ARCHITECTURE FROM REFERENCE) */}
      <NetworkOverviewCard
        stations={stations}
        blocks={blocks}
        maintenance={maintenance}
        trains={rawTrains}
        alerts={alerts}
        stats={stats}
        onNavigate={onNavigate}
      />

      {/* 4. LOWER DASHBOARD: LIVE TRAIN MOVEMENTS + RECENT ALERTS */}
      <div className="lower-dashboard-grid">
        <LiveTrainMovementsSection
          trains={filteredTrains}
          onNavigate={onNavigate}
        />
        <RecentAlertsSection
          alerts={alerts}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

function LiveTrainMovementsSection({
  trains,
  onNavigate,
}: {
  trains: DashboardTrain[]
  onNavigate?: (page: string) => void
}) {
  return (
    <section className="live-trains-section">
      <div className="live-trains-card">
        <div className="live-trains-card-header">
          <div>
            <h3 className="live-trains-card-title">Live Train Movements</h3>
            <p className="live-trains-card-subtitle">Active services across network</p>
          </div>

          <button
            type="button"
            className="btn-view-all-trains"
            onClick={() => onNavigate?.('Train Operations')}
          >
            View All <ArrowRight size={13} />
          </button>
        </div>

        {/* Clean enterprise table header */}
        <div className="live-trains-table-header">
          <span />
          <span>TRAIN / ROUTE</span>
          <span style={{ textAlign: 'right' }}>TIME / DELAY</span>
          <span style={{ textAlign: 'right' }}>STATUS</span>
        </div>

        <div className="live-trains-table-body">
          {trains.slice(0, 6).map((train, idx) => {
            const isEven = idx % 2 === 0
            const isDelayed = train.delay.includes('+') || train.status === 'Delayed'
            const isCritical = train.status === 'Critical'
            return (
              <div
                key={`${train.name}-${idx}`}
                className={`live-train-table-row ${isEven ? 'row-even' : 'row-odd'}`}
              >
                <div className="table-train-icon">
                  <TrainFront size={16} />
                </div>

                <div className="table-train-meta">
                  <strong>{train.name}</strong>
                  <span>{train.route}</span>
                </div>

                <div className="table-train-timing">
                  <strong>{train.time}</strong>
                  <span className={isDelayed ? 'text-amber' : 'text-green'}>
                    {train.delay}
                  </span>
                </div>

                <div className="table-train-status">
                  <span
                    className={`status-pill ${
                      isCritical
                        ? 'pill-critical'
                        : isDelayed
                        ? 'pill-delayed'
                        : 'pill-on-time'
                    }`}
                  >
                    {train.status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function RecentAlertsSection({
  alerts,
  onNavigate,
}: {
  alerts: DashboardAlert[]
  onNavigate?: (page: string) => void
}) {
  const displayAlerts = alerts && alerts.length > 0 ? alerts.slice(0, 6) : [
    { type: 'danger' as const, title: 'Critical train-maintenance conflict', location: 'Block NAD – BRC', time: 'Active now' },
    { type: 'warning' as const, title: 'Speed restriction due to track maintenance', location: 'Block OGL – CLX', time: '1h ago' },
    { type: 'danger' as const, title: 'Overhead traction power inspection', location: 'Block NZM – NDLS', time: '2h ago' },
    { type: 'warning' as const, title: 'Signalling interlocking upgrade underway', location: 'Station GNT', time: '3h ago' },
    { type: 'info' as const, title: 'Routine track geometry inspection scheduled', location: 'Station TPTY', time: '5h ago' },
  ]

  return (
    <section className="recent-alerts-section">
      <div className="recent-alerts-card">
        <div className="recent-alerts-card-header">
          <div>
            <h3 className="recent-alerts-card-title">Recent Alerts</h3>
            <p className="recent-alerts-card-subtitle">Operational notices & safety alerts</p>
          </div>

          <button
            type="button"
            className="btn-view-all-alerts"
            onClick={() => onNavigate?.('Alerts')}
          >
            View All <ArrowRight size={13} />
          </button>
        </div>

        <div className="recent-alerts-list">
          {displayAlerts.map((alert, idx) => {
            const isDanger = alert.type === 'danger'
            const isWarning = alert.type === 'warning'
            return (
              <div
                key={`${alert.title}-${idx}`}
                className="recent-alert-row"
              >
                <div
                  className={`alert-indicator-box ${
                    isDanger ? 'box-danger' : isWarning ? 'box-warning' : 'box-info'
                  }`}
                >
                  <AlertTriangle size={14} />
                </div>

                <div className="alert-content-meta">
                  <span className="alert-row-title">{alert.title}</span>
                  <span className="alert-row-location">{alert.location}</span>
                </div>

                <div className="alert-time-badge">
                  {alert.time}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}





function PlaceholderPage({
  page,
}: {
  page: string
}) {
  return (
    <div className="placeholder-page">
      <div className="placeholder-card">
        <div className="placeholder-icon">
          <TrainFront size={32} />
        </div>

        <span>RAILSYNC AI</span>

        <h2>{page}</h2>

        <p>
          This module is ready for the next implementation phase.
        </p>

        <div className="placeholder-status">
          <i />
          Interface online
        </div>
      </div>
    </div>
  )
}

export default App