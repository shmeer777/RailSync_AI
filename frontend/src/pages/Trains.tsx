import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  TrainFront,
  X,
  Zap,
} from 'lucide-react'

import { API_BASE_URL } from '../lib/api'

type Train = {
  id: number
  train_number: string
  name: string
  train_type: string
  source_station_code: string
  destination_station_code: string
  current_station_code: string | null
  status: string
  delay_minutes: number
  speed_kmph: number
  direction: string
  priority: string
}

type Station = {
  id: number
  code: string
  name: string
  latitude: number | null
  longitude: number | null
}

type TrainForm = {
  train_number: string
  name: string
  train_type: string
  source_station_code: string
  destination_station_code: string
  current_station_code: string
  status: string
  delay_minutes: string
  speed_kmph: string
  direction: string
  priority: string
}

const initialForm: TrainForm = {
  train_number: '',
  name: '',
  train_type: 'Express',
  source_station_code: '',
  destination_station_code: '',
  current_station_code: '',
  status: 'Running',
  delay_minutes: '0',
  speed_kmph: '0',
  direction: 'Forward',
  priority: 'Normal',
}

function statusStyle(status: string) {
  const value = status.toLowerCase()

  if (
    value.includes('critical') ||
    value.includes('stopped') ||
    value.includes('cancel')
  ) {
    return {
      bg: '#FEE2E2',
      color: '#DC2626',
      border: '1px solid #FECACA',
      dot: '#DC2626',
    }
  }

  if (
    value.includes('delay') ||
    value.includes('hold') ||
    value.includes('attention')
  ) {
    return {
      bg: '#FEF3C7',
      color: '#D97706',
      border: '1px solid #FDE68A',
      dot: '#D97706',
    }
  }

  return {
    bg: '#DEF7EC',
    color: '#059669',
    border: '1px solid #A7F3D0',
    dot: '#10B981',
  }
}

function priorityStyle(priority: string) {
  const value = priority.toLowerCase()

  if (value === 'high' || value === 'critical') {
    return '#DC2626'
  }

  if (value === 'medium') {
    return '#D97706'
  }

  return '#5B6773'
}

function formatRoute(train: Train) {
  return `${train.source_station_code} → ${train.destination_station_code}`
}

export default function TrainsPage({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const [trains, setTrains] = useState<Train[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [form, setForm] = useState<TrainForm>(initialForm)

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError('')

      const [trainsResponse, stationsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/trains/`),
        fetch(`${API_BASE_URL}/stations/`),
      ])

      if (!trainsResponse.ok) {
        throw new Error('Failed to load trains.')
      }

      if (!stationsResponse.ok) {
        throw new Error('Failed to load stations.')
      }

      const trainData: Train[] = await trainsResponse.json()
      const stationData: Station[] = await stationsResponse.json()

      setTrains(trainData)
      setStations(stationData)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to RailSync AI backend.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const statusOptions = useMemo(() => {
    const values = Array.from(
      new Set(trains.map((train) => train.status)),
    )

    return ['All', ...values]
  }, [trains])

  const filteredTrains = useMemo(() => {
    const query = search.trim().toLowerCase()

    return trains.filter((train) => {
      const matchesSearch =
        !query ||
        train.train_number.toLowerCase().includes(query) ||
        train.name.toLowerCase().includes(query) ||
        train.train_type.toLowerCase().includes(query) ||
        train.source_station_code.toLowerCase().includes(query) ||
        train.destination_station_code.toLowerCase().includes(query) ||
        (train.current_station_code ?? '').toLowerCase().includes(query)

      const matchesStatus =
        statusFilter === 'All' || train.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [trains, search, statusFilter])

  const stats = useMemo(() => {
    const running = trains.filter(
      (train) => train.status.toLowerCase() === 'running',
    ).length

    const delayed = trains.filter(
      (train) =>
        train.delay_minutes > 0 ||
        train.status.toLowerCase().includes('delay'),
    ).length

    const highPriority = trains.filter(
      (train) =>
        train.priority.toLowerCase() === 'high' ||
        train.priority.toLowerCase() === 'critical',
    ).length

    const stopped = trains.filter((train) =>
      ['stopped', 'cancelled', 'canceled'].includes(
        train.status.toLowerCase(),
      ),
    ).length

    return {
      total: trains.length,
      running,
      delayed,
      highPriority,
      stopped,
    }
  }, [trains])

  function openAddModal() {
    setForm(initialForm)
    setFormError('')
    setShowModal(true)
  }

  function closeModal() {
    if (!saving) {
      setShowModal(false)
      setFormError('')
    }
  }

  function updateForm<K extends keyof TrainForm>(
    field: K,
    value: TrainForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!form.train_number.trim()) {
      setFormError('Train number is required.')
      return
    }

    if (!form.name.trim()) {
      setFormError('Train name is required.')
      return
    }

    if (!form.source_station_code) {
      setFormError('Select a source station.')
      return
    }

    if (!form.destination_station_code) {
      setFormError('Select a destination station.')
      return
    }

    try {
      setSaving(true)
      setFormError('')

      const response = await fetch(`${API_BASE_URL}/trains/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          train_number: form.train_number.trim(),
          name: form.name.trim(),
          train_type: form.train_type,
          source_station_code: form.source_station_code,
          destination_station_code: form.destination_station_code,
          current_station_code:
            form.current_station_code || null,
          status: form.status,
          delay_minutes: Number(form.delay_minutes) || 0,
          speed_kmph: Number(form.speed_kmph) || 0,
          direction: form.direction,
          priority: form.priority,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to create train.')
      }

      setTrains((current) => [...current, data])
      setShowModal(false)
      setForm(initialForm)
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Unable to create train.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full px-4 py-5 sm:px-6 lg:px-8" style={{ color: 'var(--text-primary)' }}>
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-slate-400">
              <TrainFront className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
              <button
                type="button"
                onClick={() => (onNavigate ? onNavigate('Dashboard') : window.history.back())}
                style={{ background: 'transparent', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', padding: 0 }}
                title="Go to Dashboard"
              >
                Operations
              </button>
              <span>/</span>
              <span style={{ color: 'var(--text-secondary)' }}>Trains</span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => (onNavigate ? onNavigate('Dashboard') : window.history.back())}
                className="btn-secondary-white"
                style={{ padding: '6px 12px', fontSize: '12px' }}
                title="Back to Dashboard"
              >
                <ArrowLeft size={13} />
                Back to Dashboard
              </button>

              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)', margin: 0 }}>
                Train Operations
              </h1>
            </div>

            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Monitor active trains, movement status, delays, speed and priority.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
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
              onClick={openAddModal}
              className="btn-primary-railway"
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 700 }}
            >
              <Plus size={15} />
              Add Train
            </button>
          </div>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Unable to load train data</p>
              <p className="mt-1 text-rose-200/70">{error}</p>
            </div>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            label="Total Trains"
            value={stats.total}
            icon={<TrainFront className="h-5 w-5" />}
          />

          <StatCard
            label="Running"
            value={stats.running}
            icon={<Activity className="h-5 w-5" />}
          />

          <StatCard
            label="Delayed"
            value={stats.delayed}
            icon={<Clock3 className="h-5 w-5" />}
          />

          <StatCard
            label="High Priority"
            value={stats.highPriority}
            icon={<Zap className="h-5 w-5" />}
          />

          <StatCard
            label="Stopped"
            value={stats.stopped}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        </section>

        {/* Filters Bar: Clean White Enterprise Card */}
        <div className="enterprise-card" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flex: 1, minWidth: '240px' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#5B6773', pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search trains..."
                style={{
                  height: '36px',
                  width: '100%',
                  paddingLeft: '32px',
                  paddingRight: '12px',
                  borderRadius: '6px',
                  background: 'var(--bg-input, #FFFFFF)',
                  border: '1px solid var(--border-light, #D8E0E8)',
                  color: 'var(--text-primary, #172B3A)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '6px',
                background: 'var(--bg-input, #FFFFFF)',
                border: '1px solid var(--border-light, #D8E0E8)',
                color: 'var(--text-primary, #172B3A)',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All Statuses' : status}
                </option>
              ))}
            </select>
          </div>

          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #5B6773)', fontWeight: 600 }}>
            Showing <strong>{filteredTrains.length}</strong> of <strong>{trains.length}</strong> active trains
          </div>
        </div>

        {/* Main Train Movement Table: Enterprise Control Table */}
        <section
          style={{
            background: 'var(--bg-table, #FFFFFF)',
            border: '1px solid var(--border-light, #D9E1E8)',
            borderRadius: '10px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 20px',
              background: 'var(--bg-elevated, #FFFFFF)',
              borderBottom: '1px solid var(--border-light, #D9E1E8)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 750,
                color: 'var(--text-primary, #172B3A)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Activity size={16} color="#1F6AA5" />
              Live Train Movements Monitoring
            </h2>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#1F6AA5',
                background: '#EBF3FA',
                border: '1px solid #BFDBFE',
                padding: '3px 8px',
                borderRadius: '4px',
              }}
            >
              Section Controller Live Feed
            </span>
          </div>

          {loading ? (
            <div className="flex min-h-64 items-center justify-center text-sm" style={{ color: '#5B6773' }}>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[#1F6AA5]" />
              Loading train operations...
            </div>
          ) : filteredTrains.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
              <TrainFront className="h-10 w-10 text-slate-400" />
              <h3 className="mt-3 text-sm font-semibold text-[#172B3A]">
                No trains found
              </h3>
              <p className="mt-1 max-w-md text-xs text-[#5B6773]">
                {trains.length === 0
                  ? 'Add a train to begin monitoring railway operations.'
                  : 'Try changing your search or status filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left" style={{ borderCollapse: 'collapse', background: 'var(--bg-table, #FFFFFF)' }}>
                <thead
                  style={{
                    background: 'var(--bg-elevated, #F1F5F8)',
                    borderBottom: '1px solid var(--border-light, #D9E1E8)',
                    color: 'var(--text-secondary, #5B6773)',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                  }}
                >
                  <tr>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Train</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Route</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Current Station</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Status</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Speed</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Delay</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Priority</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700 }}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredTrains.map((train, idx) => {
                    const status = statusStyle(train.status)
                    const isEven = idx % 2 === 0

                    return (
                      <tr
                        key={train.id}
                        style={{
                          background: isEven ? 'var(--bg-card, #FFFFFF)' : 'var(--bg-table-row, #F8FAFC)',
                          borderBottom: '1px solid var(--border-light, #D9E1E8)',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bg-table-row-hover, #EEF5FA)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isEven ? 'var(--bg-card, #FFFFFF)' : 'var(--bg-table-row, #F8FAFC)'
                        }}
                      >
                        <td className="px-3.5 py-3 lg:px-4 lg:py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                flex: '0 0 32px',
                                borderRadius: '8px',
                                background: '#EBF3FA',
                                color: '#1F6AA5',
                                display: 'grid',
                                placeItems: 'center',
                              }}
                            >
                              <TrainFront className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  color: '#172B3A',
                                  margin: 0,
                                }}
                                className="truncate max-w-[170px] sm:max-w-[210px] xl:max-w-none"
                              >
                                {train.name}
                              </p>
                              <p
                                style={{
                                  fontSize: '11px',
                                  color: '#5B6773',
                                  margin: '2px 0 0',
                                }}
                                className="whitespace-nowrap"
                              >
                                #{train.train_number} · {train.train_type}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#172B3A',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatRoute(train)}
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            fontSize: '13px',
                            color: '#172B3A',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 shrink-0 text-[#1F6AA5]" />
                            <span style={{ fontWeight: 600 }}>{train.current_station_code || 'En route'}</span>
                          </div>
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '2px 8px',
                              borderRadius: '20px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: status.bg,
                              color: status.color,
                              border: status.border,
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: status.dot,
                              }}
                            />
                            {train.status}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#172B3A',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {train.speed_kmph.toFixed(0)} km/h
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            fontSize: '13px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            color: train.delay_minutes > 0 ? '#D97706' : '#059669',
                          }}
                        >
                          {train.delay_minutes > 0
                            ? `+${train.delay_minutes} min`
                            : 'On time'}
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: '0.6px',
                              color: priorityStyle(train.priority),
                            }}
                          >
                            {train.priority}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: '12px 16px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedTrain(train)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '6px',
                              background: 'var(--bg-card, #FFFFFF)',
                              border: '1px solid var(--accent-blue, #1F6AA5)',
                              color: 'var(--accent-blue, #1F6AA5)',
                              fontSize: '11.5px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--accent-blue-subtle, #EBF3FA)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'var(--bg-card, #FFFFFF)'
                            }}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {selectedTrain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl shadow-2xl" style={{ background: 'var(--bg-elevated, #FFFFFF)', border: '1px solid var(--border-light, #D8E0E8)', color: 'var(--text-primary, #172B3A)' }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-light, #D8E0E8)' }}>
              <div>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary, #5B6773)' }}>
                  Train Details
                </p>
                <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary, #172B3A)' }}>
                  {selectedTrain.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTrain(null)}
                className="rounded-lg p-2 transition"
                style={{ color: 'var(--text-secondary, #5B6773)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Detail label="Train Number" value={selectedTrain.train_number} />
              <Detail label="Train Type" value={selectedTrain.train_type} />
              <Detail label="Route" value={formatRoute(selectedTrain)} />
              <Detail
                label="Current Station"
                value={selectedTrain.current_station_code || 'En route'}
              />
              <Detail label="Status" value={selectedTrain.status} />
              <Detail
                label="Speed"
                value={`${selectedTrain.speed_kmph.toFixed(0)} km/h`}
              />
              <Detail
                label="Delay"
                value={
                  selectedTrain.delay_minutes > 0
                    ? `${selectedTrain.delay_minutes} minutes`
                    : 'On time'
                }
              />
              <Detail label="Direction" value={selectedTrain.direction} />
              <Detail label="Priority" value={selectedTrain.priority} />
            </div>

            <div className="p-5" style={{ borderTop: '1px solid var(--border-light, #D8E0E8)' }}>
              <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Train data is connected to the RailSync AI backend.
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl shadow-2xl" style={{ background: 'var(--bg-elevated, #FFFFFF)', border: '1px solid var(--border-light, #D8E0E8)', color: 'var(--text-primary, #172B3A)' }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-light, #D8E0E8)' }}>
              <div>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary, #5B6773)' }}>
                  Train Operations
                </p>
                <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary, #172B3A)' }}>
                  Add Train
                </h2>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg p-2 transition disabled:opacity-50"
                style={{ color: 'var(--text-secondary, #5B6773)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 p-5">
              {formError && (
                <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">
                  {formError}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Train Number" required>
                  <input
                    value={form.train_number}
                    onChange={(event) =>
                      updateForm('train_number', event.target.value)
                    }
                    placeholder="e.g. 12951"
                    className={inputClass}
                  />
                </Field>

                <Field label="Train Name" required>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      updateForm('name', event.target.value)
                    }
                    placeholder="e.g. Mumbai Rajdhani"
                    className={inputClass}
                  />
                </Field>

                <Field label="Train Type" required>
                  <select
                    value={form.train_type}
                    onChange={(event) =>
                      updateForm('train_type', event.target.value)
                    }
                    className={inputClass}
                  >
                    <option>Express</option>
                    <option>Superfast</option>
                    <option>Rajdhani Express</option>
                    <option>Shatabdi Express</option>
                    <option>Vande Bharat</option>
                    <option>Passenger</option>
                    <option>Freight</option>
                  </select>
                </Field>

                <Field label="Status" required>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      updateForm('status', event.target.value)
                    }
                    className={inputClass}
                  >
                    <option>Running</option>
                    <option>Delayed</option>
                    <option>Stopped</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                  </select>
                </Field>

                <Field label="Source Station" required>
                  <select
                    value={form.source_station_code}
                    onChange={(event) =>
                      updateForm(
                        'source_station_code',
                        event.target.value,
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Select station</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.code}>
                        {station.code} — {station.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Destination Station" required>
                  <select
                    value={form.destination_station_code}
                    onChange={(event) =>
                      updateForm(
                        'destination_station_code',
                        event.target.value,
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Select station</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.code}>
                        {station.code} — {station.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Current Station">
                  <select
                    value={form.current_station_code}
                    onChange={(event) =>
                      updateForm(
                        'current_station_code',
                        event.target.value,
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">En route / not set</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.code}>
                        {station.code} — {station.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Direction">
                  <select
                    value={form.direction}
                    onChange={(event) =>
                      updateForm('direction', event.target.value)
                    }
                    className={inputClass}
                  >
                    <option>Forward</option>
                    <option>Reverse</option>
                  </select>
                </Field>

                <Field label="Speed (km/h)">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.speed_kmph}
                    onChange={(event) =>
                      updateForm('speed_kmph', event.target.value)
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Delay (minutes)">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.delay_minutes}
                    onChange={(event) =>
                      updateForm('delay_minutes', event.target.value)
                    }
                    className={inputClass}
                  />
                </Field>

                <Field label="Priority">
                  <select
                    value={form.priority}
                    onChange={(event) =>
                      updateForm('priority', event.target.value)
                    }
                    className={inputClass}
                  >
                    <option>Normal</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Critical</option>
                  </select>
                </Field>
              </div>

              <div className="flex justify-end gap-3 border-t border-[#D8E0E8] pt-5">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="btn-secondary-white"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary-railway"
                >
                  {saving && (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  )}
                  {saving ? 'Adding...' : 'Add Train'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-[var(--border-light,#D8E0E8)] bg-[var(--bg-input,#F8FAFC)] px-3 py-2.5 text-sm text-[var(--text-primary,#172B3A)] outline-none placeholder:text-[var(--text-muted,#94A3B8)] focus:border-[#1F5F9C]'

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <div className="enterprise-card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 650, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          {label}
        </div>
        <div style={{ color: 'var(--accent-blue)' }}>{icon}</div>
      </div>
      <div style={{ marginTop: '8px', fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-[var(--border-light,#D8E0E8)] bg-[var(--bg-card,#F8FAFC)] p-4">
      <p className="text-xs text-[var(--text-secondary,#5B6773)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--text-primary,#172B3A)]">{value}</p>
    </div>
  )
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary,#5B6773)]">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}
