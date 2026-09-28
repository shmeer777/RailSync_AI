import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type {
  CSSProperties,
  FormEvent,
  ReactNode,
} from 'react'

import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Activity,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import AssetAvailabilitySection from '../components/maintenance/AssetAvailabilitySection'
import DynamicCrewQueueSection from '../components/maintenance/DynamicCrewQueueSection'
import MaintenanceBundlesSection from '../components/maintenance/MaintenanceBundlesSection'
import MaintenanceImpactSection from '../components/maintenance/MaintenanceImpactSection'
import MaintenancePlanningSection from '../components/maintenance/MaintenancePlanningSection'
import PredictiveMaintenanceSection from '../components/maintenance/PredictiveMaintenanceSection'
import UrgencyPrioritySection from '../components/maintenance/UrgencyPrioritySection'
import WhatIfSimulationSection from '../components/maintenance/WhatIfSimulationSection'
import {
  fetchMaintenanceBundles,
  optimizeMaintenanceBundles,
  type MaintenanceBundle,
} from '../services/maintenanceBundles'

import { API_BASE_URL } from '../lib/api'

type Block = {
  id: number
  code: string
  name: string
  start_station_code: string
  end_station_code: string
  distance_km: number
}

type Station = {
  id: number
  code: string
  name: string
  latitude: number
  longitude: number
}

type MaintenanceRecord = {
  id: number
  location_type: 'block' | 'station'
  block_code: string | null
  station_code: string | null
  maintenance_type: string
  description: string | null
  priority: string
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  estimated_duration_minutes: number | null
  department?: string
  crew_type?: string
  crew_size?: number
  depends_on_maintenance_id?: number | null
  execution_mode?: string
  sequence_order?: number
  bundle_id?: string | null
  bundled?: boolean
  bundle_role?: string | null
  planned_start?: string | null
  planned_end?: string | null
}


type MaintenanceForm = {
  location_type: 'block' | 'station'
  block_code: string
  station_code: string
  maintenance_type: string
  description: string
  priority: string
  status: string
  scheduled_start: string
  scheduled_end: string
  estimated_duration_minutes: string
}

const EMPTY_FORM: MaintenanceForm = {
  location_type: 'block',
  block_code: '',
  station_code: '',
  maintenance_type: 'Track Inspection',
  description: '',
  priority: 'Medium',
  status: 'Planned',
  scheduled_start: '',
  scheduled_end: '',
  estimated_duration_minutes: '',
}

const maintenanceTypes = [
  'Track Inspection',
  'Track Repair',
  'Signal Maintenance',
  'Electrical Maintenance',
  'Bridge Inspection',
  'Equipment Maintenance',
  'Other',
]

const priorities = [
  'Low',
  'Medium',
  'High',
  'Critical',
]

const statuses = [
  'Planned',
  'In Progress',
  'Completed',
  'Cancelled',
]

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not scheduled'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(minutes: number | null) {
  if (
    minutes === null ||
    Number.isNaN(minutes)
  ) {
    return '—'
  }

  if (minutes < 60) {
    return `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = Math.round(minutes % 60)

  if (remainingMinutes === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainingMinutes} min`
}

function getPriorityClass(priority: string) {
  switch (priority.toLowerCase()) {
    case 'critical':
      return 'maintenance-priority critical'

    case 'high':
      return 'maintenance-priority high'

    case 'medium':
      return 'maintenance-priority medium'

    default:
      return 'maintenance-priority low'
  }
}

function getStatusClass(status: string) {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'maintenance-status completed'

    case 'in progress':
      return 'maintenance-status progress'

    case 'cancelled':
      return 'maintenance-status cancelled'

    default:
      return 'maintenance-status planned'
  }
}

function getDeptClass(department?: string | null) {
  const d = (department || '').toLowerCase()
  if (d.includes('s&t') || d.includes('signal') || d.includes('telecom')) {
    return 'st'
  }
  if (d.includes('elect') || d.includes('traction') || d.includes('power')) {
    return 'electrical'
  }
  if (d.includes('track') || d.includes('civil') || d.includes('eng')) {
    return 'engineering'
  }
  return 'other'
}

export type MaintenanceTab = 'tasks' | 'predictive' | 'bundles' | 'simulation' | 'crew_queue' | 'asset_availability' | 'planning' | 'urgency' | 'impact'

const HUB_TABS = [
  {
    id: 'tasks' as const,
    label: 'Maintenance Tasks',
    description: 'Manage & view scheduled maintenance records across blocks & stations',
    icon: Wrench,
  },
  {
    id: 'predictive' as const,
    label: 'Predictive Maintenance',
    description: 'Component failure predictions, risk & condition monitoring',
    icon: Activity,
  },
  {
    id: 'bundles' as const,
    label: 'Multi-Department Bundles',
    description: 'Group & bundle tasks across departments for joint execution',
    icon: Boxes,
  },
  {
    id: 'crew_queue' as const,
    label: 'Dynamic Crew Work Queue',
    description: 'Dispatch & track maintenance crew workloads & rosters',
    icon: Network,
  },
  {
    id: 'asset_availability' as const,
    label: 'Asset Availability',
    description: 'Track block possession windows & network infrastructure readiness',
    icon: Clock3,
  },
  {
    id: 'planning' as const,
    label: 'Weekly / Monthly Planning',
    description: 'Plan maintenance schedules across weekly and monthly planning horizons',
    icon: CalendarDays,
  },
  {
    id: 'urgency' as const,
    label: 'Urgency & Priority',
    description: 'Risk-based priority scoring & real-time work queue triage',
    icon: ShieldAlert,
  },
  {
    id: 'impact' as const,
    label: 'Maintenance Impact Analysis',
    description: 'Modeled operational impact on blocks, trains & crews before approval',
    icon: Workflow,
  },
]

function getInitialTab(): MaintenanceTab {
  if (typeof window === 'undefined') return 'tasks'
  const hash = window.location.hash.toLowerCase()
  if (hash.includes('/impact') || hash.includes('tab=impact')) return 'impact'
  if (hash.includes('/urgency') || hash.includes('tab=urgency')) return 'urgency'
  if (hash.includes('/planning') || hash.includes('tab=planning')) return 'planning'
  if (hash.includes('/asset-availability') || hash.includes('/availability') || hash.includes('tab=asset_availability')) return 'asset_availability'
  if (hash.includes('/crew-queue') || hash.includes('/queue') || hash.includes('tab=crew_queue')) return 'crew_queue'
  if (hash.includes('/simulation') || hash.includes('tab=simulation') || hash.includes('what-if')) return 'simulation'
  if (hash.includes('/predictive') || hash.includes('tab=predictive')) return 'predictive'
  if (hash.includes('/bundles') || hash.includes('tab=bundles')) return 'bundles'
  if (hash.includes('/tasks') || hash.includes('tab=tasks')) return 'tasks'
  return 'tasks'
}

export interface MaintenanceProps {
  initialTab?: MaintenanceTab
}

export default function Maintenance({ initialTab }: MaintenanceProps = {}) {
  const [activeTab, setActiveTab] = useState<MaintenanceTab>(() => initialTab || getInitialTab())

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  const [records, setRecords] = useState<
    MaintenanceRecord[]
  >([])

  const [blocks, setBlocks] = useState<Block[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [bundles, setBundles] = useState<MaintenanceBundle[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [optimizingBundles, setOptimizingBundles] = useState(false)
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')

  const [form, setForm] =
    useState<MaintenanceForm>(EMPTY_FORM)

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getInitialTab())
    }
    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('popstate', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('popstate', handleHashChange)
    }
  }, [])

  const handleTabChange = (tab: MaintenanceTab) => {
    setActiveTab(tab)
    const targetHash =
      tab === 'tasks'
        ? '#/Maintenance/tasks'
        : tab === 'predictive'
          ? '#/Maintenance/predictive'
          : tab === 'bundles'
            ? '#/Maintenance/bundles'
            : tab === 'simulation'
              ? '#/Maintenance/simulation'
              : tab === 'crew_queue'
                ? '#/Maintenance/crew-queue'
                : tab === 'asset_availability'
                  ? '#/Maintenance/asset-availability'
                  : tab === 'urgency'
                    ? '#/Maintenance/urgency'
                    : tab === 'impact'
                      ? '#/Maintenance/impact'
                      : '#/Maintenance/planning'
    window.history.pushState({ page: 'Maintenance', tab }, '', targetHash)
  }

  const loadData = useCallback(
    async (showRefresh = false) => {
      try {
        if (showRefresh) {
          setRefreshing(true)
        } else {
          setLoading(true)
        }

        setError('')

        const [
          maintenanceResponse,
          blocksResponse,
          stationsResponse,
          bundlesResponse,
        ] = await Promise.all([
          fetch(`${API_BASE_URL}/maintenance/`),
          fetch(`${API_BASE_URL}/blocks/`),
          fetch(`${API_BASE_URL}/stations/`),
          fetch(`${API_BASE_URL}/maintenance/bundles`),
        ])

        if (!maintenanceResponse.ok) {
          throw new Error(
            `Maintenance API returned ${maintenanceResponse.status}`,
          )
        }

        if (!blocksResponse.ok) {
          throw new Error(
            `Blocks API returned ${blocksResponse.status}`,
          )
        }

        if (!stationsResponse.ok) {
          throw new Error(
            `Stations API returned ${stationsResponse.status}`,
          )
        }

        const maintenanceData =
          (await maintenanceResponse.json()) as MaintenanceRecord[]

        const blocksData =
          (await blocksResponse.json()) as Block[]

        const stationsData =
          (await stationsResponse.json()) as Station[]

        if (bundlesResponse.ok) {
          const bundlesData = await bundlesResponse.json()
          setBundles(bundlesData.bundles || [])
        }

        setRecords(maintenanceData)
        setBlocks(blocksData)
        setStations(stationsData)

        setForm((current) => ({
          ...current,
          block_code:
            current.block_code ||
            (blocksData.length > 0
              ? blocksData[0].code
              : ''),
          station_code:
            current.station_code ||
            (stationsData.length > 0
              ? stationsData[0].code
              : ''),
        }))
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load maintenance data.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return records
    }

    return records.filter((record) =>
      [
        record.block_code ?? '',
        record.station_code ?? '',
        record.location_type,
        record.maintenance_type,
        record.description ?? '',
        record.priority,
        record.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [records, search])

  const statistics = useMemo(
    () => ({
      total: records.length,

      planned: records.filter(
        (record) => record.status === 'Planned',
      ).length,

      inProgress: records.filter(
        (record) => record.status === 'In Progress',
      ).length,

      highPriority: records.filter(
        (record) =>
          record.priority === 'High' ||
          record.priority === 'Critical',
      ).length,

      completed: records.filter(
        (record) => record.status === 'Completed',
      ).length,
    }),
    [records],
  )

  const updateForm = (
    field: keyof MaintenanceForm,
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleLocationTypeChange = (
    locationType: 'block' | 'station',
  ) => {
    setForm((current) => ({
      ...current,
      location_type: locationType,
      block_code:
        locationType === 'block'
          ? current.block_code ||
          (blocks.length > 0
            ? blocks[0].code
            : '')
          : '',
      station_code:
        locationType === 'station'
          ? current.station_code ||
          (stations.length > 0
            ? stations[0].code
            : '')
          : '',
    }))
  }

  const submitMaintenance = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()

    setFormError('')

    if (
      form.location_type === 'block' &&
      !form.block_code
    ) {
      setFormError(
        'Please select a railway block.',
      )
      return
    }

    if (
      form.location_type === 'station' &&
      !form.station_code
    ) {
      setFormError(
        'Please select a station.',
      )
      return
    }

    if (!form.maintenance_type) {
      setFormError(
        'Please select a maintenance type.',
      )
      return
    }

    if (
      form.estimated_duration_minutes &&
      Number(form.estimated_duration_minutes) < 0
    ) {
      setFormError(
        'Estimated duration cannot be negative.',
      )
      return
    }

    if (
      form.scheduled_start &&
      form.scheduled_end &&
      new Date(form.scheduled_end) <
      new Date(form.scheduled_start)
    ) {
      setFormError(
        'Scheduled end cannot be before scheduled start.',
      )
      return
    }

    try {
      setSaving(true)

      const payload = {
        location_type: form.location_type,

        block_code:
          form.location_type === 'block'
            ? form.block_code
            : null,

        station_code:
          form.location_type === 'station'
            ? form.station_code
            : null,

        maintenance_type:
          form.maintenance_type,

        description:
          form.description.trim() || null,

        priority: form.priority,
        status: form.status,

        scheduled_start:
          form.scheduled_start
            ? new Date(
              form.scheduled_start,
            ).toISOString()
            : null,

        scheduled_end:
          form.scheduled_end
            ? new Date(
              form.scheduled_end,
            ).toISOString()
            : null,

        estimated_duration_minutes:
          form.estimated_duration_minutes
            ? Number(
              form.estimated_duration_minutes,
            )
            : null,
      }

      const response = await fetch(
        `${API_BASE_URL}/maintenance/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(
          data?.detail ||
          `Unable to create maintenance record (${response.status}).`,
        )
      }

      setRecords((current) => [
        ...current,
        data as MaintenanceRecord,
      ])

      setForm({
        ...EMPTY_FORM,
        block_code:
          blocks.length > 0
            ? blocks[0].code
            : '',
        station_code:
          stations.length > 0
            ? stations[0].code
            : '',
      })

      setShowForm(false)
      setFormError('')
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Unable to create maintenance record.',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleFilterChange = async (blockCode?: string) => {
    try {
      const data = await fetchMaintenanceBundles(blockCode)
      setBundles(data.bundles || [])
    } catch (err) {
      console.error('Failed to filter bundles:', err)
    }
  }

  const handleOptimizeBundles = async (blockCode?: string, windowPref?: string) => {
    try {
      setOptimizingBundles(true)
      const data = await optimizeMaintenanceBundles(blockCode, windowPref)
      setBundles(data.bundles || [])
      await loadData(true)
    } catch (err) {
      console.error('Failed to optimize bundles:', err)
      throw err
    } finally {
      setOptimizingBundles(false)
    }
  }

  const getLocationDisplay = (
    record: MaintenanceRecord,
  ) => {
    if (record.location_type === 'station') {
      const station = stations.find(
        (item) => item.code === record.station_code,
      )

      return {
        code: record.station_code ?? 'Unknown',
        name: station?.name ?? 'Station',
        type: 'STATION',
      }
    }

    const block = blocks.find(
      (item) => item.code === record.block_code,
    )

    return {
      code: record.block_code ?? 'Unknown',
      name: block?.name ?? 'Railway Block',
      type: 'BLOCK',
    }
  }

  return (
    <div
      style={{
        minHeight: '100%',
        padding: '24px',
        color: 'var(--text-primary)',
      }}
    >
      {/* PAGE HEADER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '15px',
          marginBottom: '22px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              color: 'var(--accent-blue)',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '1.2px',
              marginBottom: '6px',
            }}
          >
            RAILSYNC OPERATIONS / INFRASTRUCTURE
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: '26px',
              fontWeight: 800,
              lineHeight: 1.1,
              color: 'var(--text-primary)',
            }}
          >
            Maintenance Management
          </h1>

          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--text-secondary)',
              fontSize: '13px',
            }}
          >
            Schedule and monitor railway asset maintenance across blocks and stations.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className="btn-secondary-white"
            style={{ padding: '8px 14px', fontSize: '13px' }}
          >
            <RefreshCw
              size={14}
              className={refreshing ? 'animate-spin' : ''}
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              setFormError('')
              setForm({
                ...EMPTY_FORM,
                block_code:
                  blocks.length > 0
                    ? blocks[0].code
                    : '',
                station_code:
                  stations.length > 0
                    ? stations[0].code
                    : '',
              })
              setShowForm(true)
            }}
            className="btn-primary-railway"
            style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 700 }}
          >
            <Plus size={15} />
            Add Task
          </button>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '15px',
            padding: '11px 16px',
            border: '1px solid rgba(255,85,117,.3)',
            borderRadius: '9px',
            background: 'rgba(255,85,117,.07)',
            color: '#DC2626',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadData(true)}
            className="btn-secondary-white"
            style={{ padding: '5px 12px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Retry
          </button>
        </div>
      )}
      {/* MAINTENANCE HUB SELECTOR TABS */}
      <div
        role="tablist"
        aria-label="Maintenance Hub Navigation"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          marginBottom: '24px',
        }}
      >
        {HUB_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className="hub-tab-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '14px',
                padding: '14px 16px',
                borderRadius: '10px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                background: isActive ? 'var(--bg-elevated, #1B1D20)' : 'var(--bg-card, #151719)',
                border: isActive
                  ? '2px solid var(--accent-blue, #3B82C4)'
                  : '1px solid var(--border-light, #2A2D32)',
                boxShadow: isActive
                  ? '0 2px 8px rgba(59, 130, 196, 0.16)'
                  : '0 1px 3px rgba(0, 0, 0, 0.04)',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  flex: '0 0 40px',
                  borderRadius: '8px',
                  display: 'grid',
                  placeItems: 'center',
                  color: isActive ? '#FFFFFF' : 'var(--accent-blue, #3B82C4)',
                  background: isActive ? 'var(--accent-blue, #3B82C4)' : 'var(--bg-surface, #121416)',
                  border: isActive ? '1px solid var(--accent-blue, #3B82C4)' : '1px solid var(--border-light, #2A2D32)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Icon size={19} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: isActive ? '#1F6AA5' : '#172B3A',
                      letterSpacing: '-0.2px',
                    }}
                  >
                    {tab.label}
                  </strong>
                  {isActive && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.6px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(31, 106, 165, 0.10)',
                        color: '#1F6AA5',
                        border: '1px solid rgba(31, 106, 165, 0.25)',
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <p
                  style={{
                    margin: '3px 0 0',
                    fontSize: '12px',
                    color: '#5B6B79',
                    lineHeight: 1.35,
                  }}
                >
                  {tab.description}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* 1. MAINTENANCE TASKS SECTION */}
      {activeTab === 'tasks' && (
        <div id="panel-maintenance-tasks" role="tabpanel" aria-labelledby="tab-maintenance-tasks">
          {/* STATISTICS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(5,minmax(0,1fr))',
              gap: '12px',
              marginBottom: '18px',
            }}
          >
            <StatCard
              label="TOTAL TASKS"
              value={statistics.total}
              icon={<Wrench size={20} />}
              accent="#09c8ff"
            />

            <StatCard
              label="PLANNED"
              value={statistics.planned}
              icon={<CalendarDays size={20} />}
              accent="#9175ff"
            />

            <StatCard
              label="IN PROGRESS"
              value={statistics.inProgress}
              icon={<Zap size={20} />}
              accent="#ffc233"
            />

            <StatCard
              label="HIGH PRIORITY"
              value={statistics.highPriority}
              icon={<AlertTriangle size={20} />}
              accent="#ff9a52"
            />

            <StatCard
              label="COMPLETED"
              value={statistics.completed}
              icon={<CheckCircle2 size={20} />}
              accent="#18d6a4"
            />
          </div>

          {/* TABLE SECTION */}
          <section
            className="enterprise-card"
            style={{
              overflow: 'hidden',
              marginBottom: '32px',
              background: 'var(--bg-table, #121416)',
              border: '1px solid var(--border-light, #2A2D32)',
              borderRadius: '10px',
            }}>
            {/* TOOLBAR */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-light, #2A2D32)',
                background: 'var(--bg-elevated, #1B1D20)',
              }}
            >
              <div>
                <strong
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    color: 'var(--text-primary, #F5F5F5)',
                  }}> 
                  Maintenance Tasks
                </strong>

                <div
                  style={{
                    marginTop: '3px',
                    color: 'var(--text-secondary, #B9BDC4)',
                    fontSize: '12px',
                  }}>
                  {filteredRecords.length} visible task
                  {filteredRecords.length === 1
                    ? ''
                    : 's'}
                </div>
              </div>

              <div
                style={{
                  position: 'relative',
                  width: 'min(280px,100%)',
                }}
              >
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted, #858A91)',
                  }}
                />

                <input
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search maintenance..."
                  style={{
                    ...inputStyle,
                    minHeight: '36px',
                    paddingLeft: '32px',
                    background: 'var(--bg-input, #121416)',
                    border: '1px solid var(--border-light, #2A2D32)',
                    color: 'var(--text-primary, #F5F5F5)',
                  }}
                />
              </div>
            </div>

            {/* TABLE */}
            {loading ? (
              <div
                style={{
                  minHeight: '350px',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#7897ab',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '9px',
                    fontSize: '12px',
                  }}
                >
                  <Loader2
                    size={20}
                    style={{
                      animation:
                        'maintenance-spin 1s linear infinite',
                    }}
                  />
                  Loading maintenance records...
                </div>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div
                style={{
                  minHeight: '350px',
                  display: 'grid',
                  placeItems: 'center',
                  padding: '40px',
                  textAlign: 'center',
                }}
              >
                <div>
                  <div
                    style={{
                      width: '62px',
                      height: '62px',
                      margin: '0 auto 16px',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '16px',
                      color: '#09c8ff',
                      background:
                        'rgba(0,200,255,.07)',
                      border:
                        '1px solid rgba(0,200,255,.15)',
                    }}
                  >
                    <Wrench size={29} />
                  </div>

                  <h3
                    style={{
                      margin: 0,
                      fontSize: '16px',
                    }}
                  >
                    {error
                      ? 'Unable to load maintenance records'
                      : search
                      ? 'No maintenance matches found'
                      : 'No maintenance scheduled'}
                  </h3>

                  <p
                    style={{
                      margin: '7px 0 18px',
                      color: '#557487',
                      fontSize: '11px',
                    }}
                  >
                    {error
                      ? error
                      : search
                      ? 'Try a different search term.'
                      : 'Create the first maintenance task for a railway block or station.'}
                  </p>

                  {error ? (
                    <button
                      type="button"
                      onClick={() => void loadData(true)}
                      className="btn-primary-railway"
                      style={{ padding: '8px 16px', fontSize: '12px' }}
                    >
                      <RefreshCw size={13} />
                      Retry Loading Records
                    </button>
                  ) : !search && (
                    <button
                      type="button"
                      onClick={() => {
                        setFormError('')
                        setShowForm(true)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '7px',
                        padding: '10px 14px',
                        border:
                          '1px solid #00a8d8',
                        borderRadius: '8px',
                        background:
                          'rgba(0,168,216,.08)',
                        color: '#09c8ff',
                        fontWeight: 700,
                        fontSize: '11px',
                      }}
                    >
                      <Plus size={15} />
                      Schedule First Task
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr>
                      <TableHeader>
                        LOCATION
                      </TableHeader>

                      <TableHeader>
                        MAINTENANCE
                      </TableHeader>

                      <TableHeader>
                        DEPARTMENT
                      </TableHeader>

                      <TableHeader>
                        CREW
                      </TableHeader>

                      <TableHeader>
                        PRIORITY
                      </TableHeader>

                      <TableHeader>
                        STATUS
                      </TableHeader>

                      <TableHeader>
                        SCHEDULE
                      </TableHeader>

                      <TableHeader>
                        DURATION
                      </TableHeader>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRecords.map((record) => {
                        const location = getLocationDisplay(record)

                        return (
                          <tr
                            key={record.id}
                            style={{
                              borderTop: '1px solid var(--border-light, #2A2D32)',
                              background: 'var(--bg-table-row, #16181B)',
                              transition: 'background 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--bg-table-row-hover, #1D2024)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--bg-table-row, #16181B)'
                            }}
                          >
                            <td style={cellStyle}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                }}
                              >
                                <div
                                  style={{
                                    width: '36px',
                                    height: '36px',
                                    display: 'grid',
                                    placeItems: 'center',
                                    borderRadius: '8px',
                                    color: '#0284C7',
                                    background: 'rgba(2, 132, 199, 0.1)',
                                    border: '1px solid rgba(2, 132, 199, 0.25)',
                                    flexShrink: 0,
                                  }}
                                >
                                  <Wrench size={16} />
                                </div>

                                <div>
                                  <strong
                                    style={{
                                      display: 'block',
                                      fontSize: '13px',
                                      fontWeight: 750,
                                      color: 'var(--text-primary, #0F172A)',
                                    }}
                                  >
                                    {location.code}
                                  </strong>

                                  <span
                                    style={{
                                      display: 'inline-block',
                                      marginTop: '3px',
                                      color: '#0284C7',
                                      background: 'rgba(2, 132, 199, 0.08)',
                                      padding: '2px 7px',
                                      borderRadius: '4px',
                                      fontSize: '10.5px',
                                      letterSpacing: '.5px',
                                      fontWeight: 800,
                                    }}
                                  >
                                    {location.type}
                                  </span>

                                  <span
                                    style={{
                                      display: 'block',
                                      marginTop: '3px',
                                      color: 'var(--text-secondary, #475569)',
                                      fontSize: '12px',
                                      fontWeight: 500,
                                    }}
                                  >
                                    {location.name}
                                  </span>

                                  <span
                                    style={{
                                      display: 'block',
                                      marginTop: '2px',
                                      color: 'var(--text-muted, #64748B)',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                    }}
                                  >
                                    ID #{record.id}
                                  </span>
                                </div>
                              </div>
                            </td>

                            <td style={cellStyle}>
                              <strong
                                style={{
                                  display: 'block',
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  color: 'var(--text-primary, #0F172A)',
                                }}
                              >
                                {record.maintenance_type}
                              </strong>

                              <span
                                style={{
                                  display: 'block',
                                  maxWidth: '260px',
                                  marginTop: '4px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  color: 'var(--text-secondary, #475569)',
                                  fontSize: '12px',
                                }}
                              >
                                {record.description || 'No description provided'}
                              </span>
                            </td>

                            <td style={cellStyle}>
                              <span className={`maintenance-dept-pill ${getDeptClass(record.department)}`}>
                                {record.department || 'Engineering'}
                              </span>
                            </td>

                            <td style={cellStyle}>
                              <div>
                                <span
                                  style={{
                                    display: 'block',
                                    color: 'var(--text-primary, #0F172A)',
                                    fontSize: '12.5px',
                                    fontWeight: 650,
                                  }}
                                >
                                  {record.crew_type || 'Track Crew'}
                                </span>
                                <span
                                  style={{
                                    display: 'block',
                                    color: 'var(--text-secondary, #475569)',
                                    fontSize: '11px',
                                    marginTop: '2px',
                                    fontWeight: 500,
                                  }}
                                >
                                  {record.crew_size ? `${record.crew_size} personnel` : 'Standard crew'}
                                </span>
                              </div>
                            </td>

                            <td style={cellStyle}>
                              <span className={getPriorityClass(record.priority)}>
                                {record.priority}
                              </span>
                            </td>

                            <td style={cellStyle}>
                              <span className={getStatusClass(record.status)}>
                                {record.status}
                              </span>
                            </td>

                            <td style={cellStyle}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '7px',
                                  color: 'var(--text-primary, #1E293B)',
                                  fontSize: '12px',
                                  fontWeight: 550,
                                }}
                              >
                                <Clock3 size={15} color="#0284C7" />
                                <span>{formatDateTime(record.scheduled_start)}</span>
                              </div>
                            </td>

                            <td style={cellStyle}>
                              <span
                                style={{
                                  color: '#0369A1',
                                  background: 'rgba(2, 132, 199, 0.08)',
                                  border: '1px solid rgba(2, 132, 199, 0.22)',
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  display: 'inline-block',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {formatDuration(record.estimated_duration_minutes)}
                              </span>
                            </td>
                          </tr>
                        )
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 2. PREDICTIVE MAINTENANCE ENGINE SECTION */}
      {activeTab === 'predictive' && (
        <div id="panel-predictive-maintenance" role="tabpanel" aria-labelledby="tab-predictive-maintenance">
          <PredictiveMaintenanceSection
            blocks={blocks}
            onPlanSuccess={() => {
              void loadData(true)
              void handleFilterChange()
            }}
          />
        </div>
      )}

      {/* 3. MULTI-DEPARTMENT MAINTENANCE BUNDLES SECTION */}
      {activeTab === 'bundles' && (
        <div id="panel-multi-department-bundles" role="tabpanel" aria-labelledby="tab-multi-department-bundles">
          <MaintenanceBundlesSection
            bundles={bundles}
            blocks={blocks}
            loading={loading}
            optimizing={optimizingBundles}
            onOptimize={handleOptimizeBundles}
            onFilterChange={handleFilterChange}
          />
        </div>
      )}

      {/* 4. WHAT-IF MAINTENANCE SIMULATION SECTION */}
      <div
        id="panel-what-if-simulation"
        role="tabpanel"
        aria-labelledby="tab-what-if-simulation"
        style={{ display: activeTab === 'simulation' ? 'block' : 'none' }}
      >
        <WhatIfSimulationSection
          blocks={blocks}
          onPlanApplied={() => {
            void loadData(true)
            void handleFilterChange()
          }}
        />
      </div>

      {/* 5. DYNAMIC CREW WORK QUEUE SECTION */}
      {activeTab === 'crew_queue' && (
        <div
          id="panel-dynamic-crew-queue"
          role="tabpanel"
          aria-labelledby="tab-dynamic-crew-queue"
        >
          <DynamicCrewQueueSection
            onQueueApplied={() => {
              void loadData(true)
              void handleFilterChange()
            }}
          />
        </div>
      )}

      {/* 6. ASSET AVAILABILITY OPTIMIZATION SECTION */}
      {activeTab === 'asset_availability' && (
        <div
          id="panel-asset-availability"
          role="tabpanel"
          aria-labelledby="tab-asset-availability"
        >
          <AssetAvailabilitySection
            blocks={blocks}
            onPlanApproved={() => {
              void loadData(true)
              void handleFilterChange()
            }}
          />
        </div>
      )}

      {/* 7. WEEKLY / MONTHLY MAINTENANCE PLANNING SECTION */}
      {activeTab === 'planning' && (
        <div
          id="panel-maintenance-planning"
          role="tabpanel"
          aria-labelledby="tab-maintenance-planning"
        >
          <MaintenancePlanningSection
            onPlanApplied={() => {
              void loadData(true)
              void handleFilterChange()
            }}
          />
        </div>
      )}

      {/* 8. ADVANCED URGENCY-AWARE SCHEDULING SECTION */}
      {activeTab === 'urgency' && (
        <div
          id="panel-maintenance-urgency"
          role="tabpanel"
          aria-labelledby="tab-maintenance-urgency"
        >
          <UrgencyPrioritySection />
        </div>
      )}

      {/* 9. MAINTENANCE IMPACT ANALYSIS SECTION */}
      {activeTab === 'impact' && (
        <div
          id="panel-maintenance-impact"
          role="tabpanel"
          aria-labelledby="tab-maintenance-impact"
        >
          <MaintenanceImpactSection
            blocks={blocks}
            records={records}
            bundles={bundles}
          />
        </div>
      )}

      {/* CREATE MAINTENANCE MODAL */}
      {showForm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
            background:
              'rgba(1,8,15,.78)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              width: 'min(720px,100%)',
              maxHeight: '90vh',
              overflowY: 'auto',
              border:
                '1px solid rgba(0,198,255,.28)',
              borderRadius: '16px',
              background:
                'linear-gradient(180deg,#092238,#061724)',
              boxShadow:
                '0 30px 80px rgba(0,0,0,.5)',
            }}
          >
            {/* MODAL HEADER */}
            <div
              style={{
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'center',
                padding: '18px 20px',
                borderBottom:
                  '1px solid rgba(75,137,172,.13)',
              }}
            >
              <div>
                <div
                  style={{
                    color: '#09c8ff',
                    fontSize: '9px',
                    fontWeight: 800,
                    letterSpacing:
                      '1.3px',
                  }}
                >
                  MAINTENANCE PLANNER
                </div>

                <h3
                  style={{
                    margin: '5px 0 0',
                    fontSize: '18px',
                  }}
                >
                  Schedule Maintenance
                </h3>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setShowForm(false)
                  }
                }}
                style={{
                  width: '36px',
                  height: '36px',
                  display: 'grid',
                  placeItems: 'center',
                  border:
                    '1px solid rgba(75,137,172,.2)',
                  borderRadius: '8px',
                  background: '#081d2d',
                  color: '#7e9bab',
                }}
              >
                <X size={17} />
              </button>
            </div>

            {/* FORM */}
            <form
              onSubmit={submitMaintenance}
              style={{
                padding: '20px',
              }}
            >
              {formError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems:
                      'center',
                    gap: '8px',
                    marginBottom: '15px',
                    padding:
                      '11px 13px',
                    border:
                      '1px solid rgba(255,85,117,.3)',
                    borderRadius: '9px',
                    background:
                      'rgba(255,85,117,.07)',
                    color: '#ff8298',
                    fontSize: '11px',
                  }}
                >
                  <AlertTriangle
                    size={16}
                  />

                  {formError}
                </div>
              )}

              <div
                className="maintenance-form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    '1fr 1fr',
                  gap: '15px',
                }}
              >
                {/* LOCATION TYPE */}
                <FormField
                  label="Maintenance Location"
                  required
                >
                  <select
                    value={form.location_type}
                    onChange={(event) =>
                      handleLocationTypeChange(
                        event.target
                          .value as
                        | 'block'
                        | 'station',
                      )
                    }
                    style={inputStyle}
                  >
                    <option value="block">
                      Railway Block
                    </option>

                    <option value="station">
                      Station
                    </option>
                  </select>
                </FormField>

                {/* LOCATION */}
                <FormField
                  label={
                    form.location_type ===
                      'block'
                      ? 'Railway Block'
                      : 'Station'
                  }
                  required
                >
                  {form.location_type ===
                    'block' ? (
                    <select
                      value={
                        form.block_code
                      }
                      onChange={(
                        event,
                      ) =>
                        updateForm(
                          'block_code',
                          event.target
                            .value,
                        )
                      }
                      style={inputStyle}
                    >
                      <option value="">
                        Select block
                      </option>

                      {blocks.map(
                        (block) => (
                          <option
                            key={
                              block.id
                            }
                            value={
                              block.code
                            }
                          >
                            {block.code} —{' '}
                            {block.name}
                          </option>
                        ),
                      )}
                    </select>
                  ) : (
                    <select
                      value={
                        form.station_code
                      }
                      onChange={(
                        event,
                      ) =>
                        updateForm(
                          'station_code',
                          event.target
                            .value,
                        )
                      }
                      style={inputStyle}
                    >
                      <option value="">
                        Select station
                      </option>

                      {stations.map(
                        (station) => (
                          <option
                            key={
                              station.id
                            }
                            value={
                              station.code
                            }
                          >
                            {station.code} —{' '}
                            {station.name}
                          </option>
                        ),
                      )}
                    </select>
                  )}
                </FormField>

                {/* MAINTENANCE TYPE */}
                <FormField
                  label="Maintenance Type"
                  required
                >
                  <select
                    value={
                      form.maintenance_type
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'maintenance_type',
                        event.target
                          .value,
                      )
                    }
                    style={inputStyle}
                  >
                    {maintenanceTypes.map(
                      (type) => (
                        <option
                          key={type}
                          value={type}
                        >
                          {type}
                        </option>
                      ),
                    )}
                  </select>
                </FormField>

                {/* PRIORITY */}
                <FormField label="Priority">
                  <select
                    value={
                      form.priority
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'priority',
                        event.target
                          .value,
                      )
                    }
                    style={inputStyle}
                  >
                    {priorities.map(
                      (priority) => (
                        <option
                          key={
                            priority
                          }
                          value={
                            priority
                          }
                        >
                          {priority}
                        </option>
                      ),
                    )}
                  </select>
                </FormField>

                {/* STATUS */}
                <FormField label="Status">
                  <select
                    value={
                      form.status
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'status',
                        event.target
                          .value,
                      )
                    }
                    style={inputStyle}
                  >
                    {statuses.map(
                      (status) => (
                        <option
                          key={status}
                          value={status}
                        >
                          {status}
                        </option>
                      ),
                    )}
                  </select>
                </FormField>

                {/* START */}
                <FormField
                  label="Scheduled Start"
                >
                  <input
                    type="datetime-local"
                    value={
                      form.scheduled_start
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'scheduled_start',
                        event.target
                          .value,
                      )
                    }
                    style={inputStyle}
                  />
                </FormField>

                {/* END */}
                <FormField
                  label="Scheduled End"
                >
                  <input
                    type="datetime-local"
                    value={
                      form.scheduled_end
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'scheduled_end',
                        event.target
                          .value,
                      )
                    }
                    style={inputStyle}
                  />
                </FormField>

                {/* DURATION */}
                <FormField label="Estimated Duration (minutes)">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      form.estimated_duration_minutes
                    }
                    onChange={(
                      event,
                    ) =>
                      updateForm(
                        'estimated_duration_minutes',
                        event.target
                          .value,
                      )
                    }
                    placeholder="Example: 120"
                    style={inputStyle}
                  />
                </FormField>

                <div />

                {/* DESCRIPTION */}
                <div
                  style={{
                    gridColumn:
                      '1 / -1',
                  }}
                >
                  <FormField label="Description">
                    <textarea
                      value={
                        form.description
                      }
                      onChange={(
                        event,
                      ) =>
                        updateForm(
                          'description',
                          event.target
                            .value,
                        )
                      }
                      placeholder="Describe the maintenance work..."
                      rows={4}
                      style={{
                        ...inputStyle,
                        resize:
                          'vertical',
                        paddingTop:
                          '11px',
                      }}
                    />
                  </FormField>
                </div>
              </div>

              {/* EMPTY LOCATION WARNING */}
              {(
                form.location_type ===
                  'block'
                  ? blocks.length === 0
                  : stations.length === 0
              ) && (
                  <div
                    style={{
                      marginTop: '15px',
                      padding:
                        '11px 13px',
                      border:
                        '1px solid rgba(255,194,51,.25)',
                      borderRadius: '9px',
                      background:
                        'rgba(255,194,51,.05)',
                      color: '#bda461',
                      fontSize: '10px',
                    }}
                  >
                    {form.location_type ===
                      'block'
                      ? 'No railway blocks are currently available in the backend.'
                      : 'No stations are currently available in the backend.'}
                  </div>
                )}

              {/* FORM BUTTONS */}
              <div
                style={{
                  display: 'flex',
                  justifyContent:
                    'flex-end',
                  gap: '9px',
                  marginTop: '20px',
                  paddingTop: '17px',
                  borderTop:
                    '1px solid rgba(75,137,172,.12)',
                }}
              >
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setShowForm(false)
                  }
                  style={{
                    height: '42px',
                    padding:
                      '0 16px',
                    border:
                      '1px solid rgba(75,137,172,.25)',
                    borderRadius: '8px',
                    background: '#081c2c',
                    color: '#89a6b5',
                  }}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    (form.location_type ===
                      'block'
                      ? blocks.length === 0
                      : stations.length === 0)
                  }
                  style={{
                    height: '42px',
                    display:
                      'inline-flex',
                    alignItems:
                      'center',
                    gap: '8px',
                    padding:
                      '0 17px',
                    border:
                      '1px solid #00a8d8',
                    borderRadius: '8px',
                    background:
                      'linear-gradient(180deg,#0797ca,#05749e)',
                    color: '#fff',
                    fontWeight: 750,
                    opacity:
                      saving ||
                        (form.location_type ===
                          'block'
                          ? blocks.length === 0
                          : stations.length === 0)
                        ? 0.55
                        : 1,
                  }}
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={16}
                        style={{
                          animation:
                            'maintenance-spin 1s linear infinite',
                        }}
                      />

                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus size={16} />

                      Create Maintenance
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PAGE STYLES */}
      <style>
        {`
          @keyframes maintenance-spin {
            from {
              transform: rotate(0deg);
            }

            to {
              transform: rotate(360deg);
            }
          }

          .maintenance-priority,
          .maintenance-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 5px 12px;
            border-radius: 999px;
            font-size: 11.5px;
            font-weight: 750;
            letter-spacing: 0.02em;
            white-space: nowrap;
          }

          .maintenance-dept-pill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11.5px;
            font-weight: 750;
            letter-spacing: 0.02em;
            white-space: nowrap;
          }

          /* Light Mode Badges - Crisp, neat, vibrant */
          .maintenance-priority.low {
            color: #0284c7;
            background: #e0f2fe;
            border: 1px solid #7dd3fc;
          }

          .maintenance-priority.medium {
            color: #b45309;
            background: #fef3c7;
            border: 1px solid #fde68a;
          }

          .maintenance-priority.high {
            color: #c2410c;
            background: #ffedd5;
            border: 1px solid #fdba74;
          }

          .maintenance-priority.critical {
            color: #b91c1c;
            background: #fee2e2;
            border: 1px solid #fca5a5;
          }

          .maintenance-status.planned {
            color: #6d28d9;
            background: #f3e8ff;
            border: 1px solid #d8b4fe;
          }

          .maintenance-status.progress {
            color: #b45309;
            background: #fef3c7;
            border: 1px solid #fcd34d;
          }

          .maintenance-status.completed {
            color: #15803d;
            background: #dcfce7;
            border: 1px solid #86efac;
          }

          .maintenance-status.cancelled {
            color: #b91c1c;
            background: #fee2e2;
            border: 1px solid #fca5a5;
          }

          .maintenance-dept-pill.engineering {
            color: #1d4ed8;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
          }

          .maintenance-dept-pill.st {
            color: #047857;
            background: #ecfdf5;
            border: 1px solid #a7f3d0;
          }

          .maintenance-dept-pill.electrical {
            color: #b45309;
            background: #fffbeb;
            border: 1px solid #fde68a;
          }

          .maintenance-dept-pill.other {
            color: #475569;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
          }

          /* Dark Mode Overrides */
          [data-theme='dark'] .maintenance-priority.low,
          .dark .maintenance-priority.low {
            color: #38bdf8;
            border: 1px solid rgba(56, 189, 248, 0.4);
            background: rgba(56, 189, 248, 0.16);
          }

          [data-theme='dark'] .maintenance-priority.medium,
          .dark .maintenance-priority.medium {
            color: #fbbf24;
            border: 1px solid rgba(251, 191, 36, 0.4);
            background: rgba(251, 191, 36, 0.16);
          }

          [data-theme='dark'] .maintenance-priority.high,
          .dark .maintenance-priority.high {
            color: #fb923c;
            border: 1px solid rgba(251, 146, 60, 0.4);
            background: rgba(251, 146, 60, 0.16);
          }

          [data-theme='dark'] .maintenance-priority.critical,
          .dark .maintenance-priority.critical {
            color: #f87171;
            border: 1px solid rgba(248, 113, 113, 0.45);
            background: rgba(248, 113, 113, 0.2);
          }

          [data-theme='dark'] .maintenance-status.planned,
          .dark .maintenance-status.planned {
            color: #c084fc;
            border: 1px solid rgba(192, 132, 252, 0.4);
            background: rgba(192, 132, 252, 0.16);
          }

          [data-theme='dark'] .maintenance-status.progress,
          .dark .maintenance-status.progress {
            color: #fbbf24;
            border: 1px solid rgba(251, 191, 36, 0.4);
            background: rgba(251, 191, 36, 0.16);
          }

          [data-theme='dark'] .maintenance-status.completed,
          .dark .maintenance-status.completed {
            color: #34d399;
            border: 1px solid rgba(52, 211, 153, 0.4);
            background: rgba(52, 211, 153, 0.16);
          }

          [data-theme='dark'] .maintenance-status.cancelled,
          .dark .maintenance-status.cancelled {
            color: #f87171;
            border: 1px solid rgba(248, 113, 113, 0.45);
            background: rgba(248, 113, 113, 0.2);
          }

          [data-theme='dark'] .maintenance-dept-pill.engineering,
          .dark .maintenance-dept-pill.engineering {
            color: #60a5fa;
            background: rgba(59, 130, 246, 0.18);
            border: 1px solid rgba(96, 165, 250, 0.4);
          }

          [data-theme='dark'] .maintenance-dept-pill.st,
          .dark .maintenance-dept-pill.st {
            color: #34d399;
            background: rgba(16, 185, 129, 0.18);
            border: 1px solid rgba(52, 211, 153, 0.4);
          }

          [data-theme='dark'] .maintenance-dept-pill.electrical,
          .dark .maintenance-dept-pill.electrical {
            color: #fbbf24;
            background: rgba(245, 158, 11, 0.18);
            border: 1px solid rgba(251, 191, 36, 0.4);
          }

          [data-theme='dark'] .maintenance-dept-pill.other,
          .dark .maintenance-dept-pill.other {
            color: #cbd5e1;
            background: rgba(148, 163, 184, 0.18);
            border: 1px solid rgba(203, 213, 225, 0.4);
          }

          @media (max-width: 1100px) {
            .maintenance-form-grid {
              grid-template-columns: 1fr 1fr !important;
            }
          }

          @media (max-width: 700px) {
            .maintenance-form-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}
      </style>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: number
  icon: ReactNode
  accent: string
}) {
  return (
    <div
      className="enterprise-card stat-card"
      style={{
        minHeight: '92px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '16px 18px',
        background: 'var(--bg-card, #151719)',
        border: '1px solid var(--border-light, #2A2D32)',
        borderRadius: '10px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
      }}
    >
      <div
        style={{
          width: '42px',
          height: '42px',
          flex: '0 0 42px',
          display: 'grid',
          placeItems: 'center',
          borderRadius: '8px',
          color: accent,
          background: `${accent}15`,
          border: `1px solid ${accent}30`,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          display: 'grid',
          gap: '3px',
        }}
      >
        <strong
          style={{
            fontSize: '24px',
            fontWeight: 800,
            lineHeight: 1,
            color: 'var(--text-primary, #F5F5F5)',
          }}
        >
          {value}
        </strong>

        <span
          style={{
            color: 'var(--text-secondary, #B9BDC4)',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.6px',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

function TableHeader({
  children,
}: {
  children: ReactNode
}) {
  return (
    <th
      style={{
        padding: '13px 14px',
        color: 'var(--text-secondary, #475569)',
        fontSize: '11px',
        fontWeight: 800,
        textAlign: 'left',
        letterSpacing: '0.6px',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid var(--border-light, #CBD5E1)',
        background: 'var(--bg-subtle, #F1F5F9)',
      }}
    >
      {children}
    </th>
  )
}

function FormField({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label
      style={{
        display: 'grid',
        gap: '7px',
      }}
    >
      <span
        style={{
          color: 'var(--text-secondary, #475569)',
          fontSize: '12px',
          fontWeight: 700,
        }}
      >
        {label}

        {required && (
          <span
            style={{
              color: 'var(--accent-blue, #3B82C4)',
            }}
          >
            {' '}
            *
          </span>
        )}
      </span>

      {children}
    </label>
  )
}

const inputStyle: CSSProperties = {
  width: '100%',
  minHeight: '42px',
  padding: '0 12px',
  border:
    '1px solid var(--border-light, #CBD5E1)',
  borderRadius: '8px',
  outline: 'none',
  background: 'var(--bg-input, #FFFFFF)',
  color: 'var(--text-primary, #0F172A)',
  fontSize: '13px',
}

const cellStyle: CSSProperties = {
  padding: '13px 14px',
  color: 'var(--text-primary, #0F172A)',
  verticalAlign: 'middle',
  fontSize: '12px',
}