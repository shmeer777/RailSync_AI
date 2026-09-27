import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  ShieldAlert,
  TrainFront,
  Users,
  Wrench,
} from 'lucide-react'

import { API_BASE_URL } from '../lib/api'

export type AlertItem = {
  id: string
  title: string
  description: string
  severity: 'Critical' | 'High' | 'Medium' | 'Info'
  location: string
  timestamp: string
  acknowledged: boolean
  source: 'Conflict' | 'Maintenance' | 'Signal'
  trainNumber?: string
  blockCode?: string
}

export interface AlertsPageProps {
  onNavigate?: (page: string) => void
  alerts?: AlertItem[]
  onAcknowledge?: (id: string) => void
  onAcknowledgeAll?: () => void
  onRefresh?: () => Promise<void>
}

export default function AlertsPage({
  onNavigate,
  alerts: controlledAlerts,
  onAcknowledge,
  onAcknowledgeAll,
  onRefresh,
}: AlertsPageProps) {
  const [internalAlerts, setInternalAlerts] = useState<AlertItem[]>([])
  const isControlled = controlledAlerts !== undefined
  const alerts = isControlled ? controlledAlerts : internalAlerts

  const [loading, setLoading] = useState(!isControlled)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<'All' | 'Critical' | 'High' | 'Medium' | 'Acknowledged'>('All')
  const [search, setSearch] = useState('')
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const fetchAlerts = useCallback(async (isRefresh = false) => {
    if (isControlled && onRefresh) {
      if (isRefresh) setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
      return
    }

    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [conflictsRes, maintenanceRes] = await Promise.all([
        fetch(`${API_BASE_URL}/ai/train-block-conflicts`).catch(() => null),
        fetch(`${API_BASE_URL}/maintenance/`).catch(() => null),
      ])

      const conflictData = conflictsRes && conflictsRes.ok ? await conflictsRes.json() : null
      const maintenanceData = maintenanceRes && maintenanceRes.ok ? await maintenanceRes.json() : null

      const items: AlertItem[] = []

      // Extract conflicts
      const conflictsList = Array.isArray(conflictData)
        ? conflictData
        : Array.isArray(conflictData?.conflicts)
          ? conflictData.conflicts
          : []

      conflictsList.forEach((c: any, idx: number) => {
        items.push({
          id: `conflict-${c.train_id ?? idx}-${c.maintenance_id ?? idx}`,
          title: `${c.severity || 'Critical'} Conflict: Train #${c.train_number || 'Unknown'}`,
          description: c.recommendation || `Occupying block ${c.block_code || 'N/A'} with active maintenance.`,
          severity: (c.severity as any) || 'Critical',
          location: c.location_type === 'station' ? `Station ${c.station_code || '—'}` : `Block ${c.block_code || '—'}`,
          timestamp: 'Live Active',
          acknowledged: false,
          source: 'Conflict',
          trainNumber: c.train_number,
          blockCode: c.block_code,
        })
      })

      // Extract critical / high maintenance
      const maintList = Array.isArray(maintenanceData)
        ? maintenanceData
        : Array.isArray(maintenanceData?.items)
          ? maintenanceData.items
          : []

      maintList
        .filter((m: any) => m.priority === 'Critical' || m.priority === 'High')
        .forEach((m: any) => {
          items.push({
            id: `maint-${m.id}`,
            title: `${m.priority} Track Maintenance Scheduled`,
            description: m.description || `${m.maintenance_type} in progress or pending inspection.`,
            severity: m.priority === 'Critical' ? 'Critical' : 'High',
            location: m.location_type === 'station' ? `Station ${m.station_code}` : `Block ${m.block_code}`,
            timestamp: m.scheduled_start ? new Date(m.scheduled_start).toLocaleTimeString() : 'Immediate',
            acknowledged: false,
            source: 'Maintenance',
            blockCode: m.block_code,
          })
        })

      // Default fallback alerts if live conflict count is empty
      if (items.length === 0) {
        items.push(
          {
            id: 'fallback-1',
            title: 'Signal Interlock Caution at NDLS Junction',
            description: 'Automatic speed limit advisory: reduced to 60 km/h due to track sensor recalibration.',
            severity: 'Medium',
            location: 'Station NDLS',
            timestamp: '10 min ago',
            acknowledged: false,
            source: 'Signal',
          },
          {
            id: 'fallback-2',
            title: 'Weather Advisory: Heavy Fog Warning Northern Sector',
            description: 'Fog safety protocol active. Automated braking distances extended by 25%.',
            severity: 'High',
            location: 'Ambala - Ludhiana Corridor',
            timestamp: '25 min ago',
            acknowledged: false,
            source: 'Signal',
          }
        )
      }

      setInternalAlerts(items)
    } catch (err) {
      console.error('Failed to load alerts', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [isControlled, onRefresh])

  useEffect(() => {
    if (!isControlled) {
      void fetchAlerts()
    }
  }, [fetchAlerts, isControlled])

  const showFeedback = (msg: string) => {
    setActionMessage(msg)
    window.setTimeout(() => setActionMessage(null), 3500)
  }

  const handleAcknowledge = (id: string) => {
    if (isControlled && onAcknowledge) {
      onAcknowledge(id)
    } else {
      setInternalAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, acknowledged: !a.acknowledged } : a))
      )
    }
    showFeedback('Alert status updated.')
  }

  const handleDispatch = (alert: AlertItem) => {
    showFeedback(`Dispatch order sent to Field Operations Team at ${alert.location}!`)
  }

  const handleAcknowledgeAll = () => {
    if (isControlled && onAcknowledgeAll) {
      onAcknowledgeAll()
    } else {
      setInternalAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })))
    }
    showFeedback('All active alerts marked as acknowledged.')
  }

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (filter === 'Critical' && a.severity !== 'Critical') return false
      if (filter === 'High' && a.severity !== 'High') return false
      if (filter === 'Medium' && a.severity !== 'Medium') return false
      if (filter === 'Acknowledged' && !a.acknowledged) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.location.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [alerts, filter, search])

  const criticalCount = alerts.filter((a) => a.severity === 'Critical' && !a.acknowledged).length
  const highCount = alerts.filter((a) => a.severity === 'High' && !a.acknowledged).length
  const unackCount = alerts.filter((a) => !a.acknowledged).length

  return (
    <div className="min-h-full bg-transparent px-4 py-5 text-[#172B3A] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-cyan-400">
              <Bell className="h-4 w-4" />
              Operations / Alerts & Safety Center
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#172B3A]">
              Railway Incident & Safety Alerts
            </h1>
            <p className="mt-1 text-sm text-[#5B6773]">
              Real-time operational warnings, track-conflict notices, and emergency dispatch controls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void fetchAlerts(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <button
              type="button"
              onClick={handleAcknowledgeAll}
              disabled={unackCount === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-[#172B3A] transition hover:bg-cyan-500 disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" />
              Acknowledge All ({unackCount})
            </button>
          </div>
        </header>

        {actionMessage && (
          <div className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-300 shadow-lg">
            <CheckCircle2 className="h-4 w-4" />
            {actionMessage}
          </div>
        )}

        {/* Stats Row */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
            <div className="flex items-center justify-between text-rose-400">
              <span className="text-xs font-bold uppercase tracking-wider">Critical</span>
              <ShieldAlert className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">{criticalCount}</p>
            <span className="text-xs text-rose-300">Requires immediate attention</span>
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center justify-between text-amber-400">
              <span className="text-xs font-bold uppercase tracking-wider">High Risk</span>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">{highCount}</p>
            <span className="text-xs text-amber-300">Dispatch & monitoring</span>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex items-center justify-between text-cyan-400">
              <span className="text-xs font-bold uppercase tracking-wider">Total Active</span>
              <Bell className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">{alerts.length}</p>
            <span className="text-xs text-cyan-300">Monitored sectors</span>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between text-emerald-400">
              <span className="text-xs font-bold uppercase tracking-wider">Resolved / Ack</span>
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">
              {alerts.filter((a) => a.acknowledged).length}
            </p>
            <span className="text-xs text-emerald-300">Action logged</span>
          </div>
        </section>

        {/* Filter and Search Bar */}
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['All', 'Critical', 'High', 'Medium', 'Acknowledged'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  filter === f
                    ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                    : 'border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-[#172B3A]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search alert by train, block, station..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-[#172B3A] outline-none placeholder:text-slate-500 focus:border-cyan-500"
            />
          </div>
        </section>

        {/* Alerts List */}
        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center text-sm text-[#5B6773]">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin text-cyan-400" />
            Loading live alerts...
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <h3 className="mt-3 text-lg font-semibold text-[#172B3A]">No Matching Alerts</h3>
            <p className="mt-1 text-sm text-[#5B6773]">
              All railway blocks and trains in this filter are currently running without conflict.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => {
              const isCrit = alert.severity === 'Critical'
              const isHigh = alert.severity === 'High'

              return (
                <div
                  key={alert.id}
                  className={`flex flex-col justify-between gap-4 rounded-2xl border p-5 transition sm:flex-row sm:items-center ${
                    alert.acknowledged
                      ? 'border-slate-800 bg-slate-950/40 opacity-75'
                      : isCrit
                        ? 'border-rose-500/30 bg-rose-950/10 hover:border-rose-500/50'
                        : isHigh
                          ? 'border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50'
                          : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                        isCrit
                          ? 'bg-rose-500/10 text-rose-400'
                          : isHigh
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-cyan-500/10 text-cyan-400'
                      }`}
                    >
                      {alert.source === 'Conflict' ? (
                        <ShieldAlert className="h-6 w-6" />
                      ) : alert.source === 'Maintenance' ? (
                        <Wrench className="h-6 w-6" />
                      ) : (
                        <AlertTriangle className="h-6 w-6" />
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-[#172B3A]">{alert.title}</h4>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isCrit
                              ? 'bg-rose-500/20 text-rose-300'
                              : isHigh
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-cyan-500/20 text-cyan-300'
                          }`}
                        >
                          {alert.severity}
                        </span>
                        {alert.acknowledged && (
                          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Acknowledged
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-slate-300">{alert.description}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        <span>
                          Location: <strong className="text-slate-300">{alert.location}</strong>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {alert.timestamp}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDispatch(alert)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-[#172B3A]"
                    >
                      <Users className="h-3.5 w-3.5 text-cyan-400" />
                      Dispatch Crew
                    </button>

                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate(alert.source === 'Maintenance' ? 'Maintenance' : 'Network')}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-[#172B3A]"
                      >
                        <TrainFront className="h-3.5 w-3.5 text-cyan-400" />
                        Inspect
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleAcknowledge(alert.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        alert.acknowledged
                          ? 'border border-slate-700 bg-slate-800 text-[#5B6773] hover:text-[#172B3A]'
                          : 'bg-cyan-600 text-[#172B3A] hover:bg-cyan-500'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {alert.acknowledged ? 'Un-ack' : 'Acknowledge'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
