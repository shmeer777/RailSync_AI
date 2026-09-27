import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Search,
  TriangleAlert,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react'
import RailwayNetworkMap from '../components/network/RailwayNetworkMap'

import { API_BASE_URL } from '../lib/api'

type Station = {
  id: number
  code: string
  name: string
  latitude: number
  longitude: number
}

type Block = {
  id: number
  code: string
  name: string
  start_station_code: string
  end_station_code: string
  distance_km: number
}

type Maintenance = {
  id: number
  block_code: string
  maintenance_type: string
  description: string
  priority: string
  status: string
  scheduled_start?: string | null
  scheduled_end?: string | null
  estimated_duration_minutes?: number | null
}

type NetworkStatus = 'healthy' | 'attention' | 'critical'

function statusClasses(status: NetworkStatus) {
  if (status === 'critical') {
    return {
      dot: 'bg-rose-400',
    }
  }

  if (status === 'attention') {
    return {
      dot: 'bg-amber-400',
    }
  }

  return {
    dot: 'bg-emerald-400',
  }
}

function maintenanceStatus(status: string): NetworkStatus {
  const value = status.toLowerCase()

  if (
    value.includes('critical') ||
    value.includes('failed') ||
    value.includes('overdue')
  ) {
    return 'critical'
  }

  if (
    value.includes('pending') ||
    value.includes('scheduled') ||
    value.includes('progress') ||
    value.includes('attention')
  ) {
    return 'attention'
  }

  return 'healthy'
}

function formatTime(value?: string | null) {
  if (!value) return 'No schedule'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Network() {
  const [stations, setStations] = useState<Station[]>([])
  const [blocks, setBlocks] = useState<Block[]>([])
  const [maintenance, setMaintenance] = useState<Maintenance[]>([])

  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [trains, setTrains] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadNetwork = useCallback(async (showRefresh = false) => {
    try {
      setError('')

      if (showRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      const [stationsResponse, blocksResponse, maintenanceResponse, trainsResponse] =
        await Promise.all([
          fetch(`${API_BASE_URL}/stations/`),
          fetch(`${API_BASE_URL}/blocks/`),
          fetch(`${API_BASE_URL}/maintenance/`),
          fetch(`${API_BASE_URL}/trains/`).catch(() => null),
        ])

      if (!stationsResponse.ok) {
        throw new Error('Unable to load stations.')
      }

      if (!blocksResponse.ok) {
        throw new Error('Unable to load blocks.')
      }

      if (!maintenanceResponse.ok) {
        throw new Error('Unable to load maintenance data.')
      }

      const stationData: Station[] = await stationsResponse.json()
      const blockData: Block[] = await blocksResponse.json()
      const maintenanceData: Maintenance[] = await maintenanceResponse.json()

      setStations(stationData)
      setBlocks(blockData)
      setMaintenance(maintenanceData)

      if (trainsResponse && trainsResponse.ok) {
        const trainData = await trainsResponse.json()
        setTrains(trainData)
      }

      setSelectedBlockId((current) => {
        if (current && blockData.some((block) => block.id === current)) {
          return current
        }

        return blockData.length > 0 ? blockData[0].id : null
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to the RailSync backend.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadNetwork()
  }, [loadNetwork])

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId],
  )

  const filteredBlocks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    if (!query) {
      return blocks
    }

    return blocks.filter(
      (block) =>
        block.code.toLowerCase().includes(query) ||
        block.name.toLowerCase().includes(query) ||
        block.start_station_code.toLowerCase().includes(query) ||
        block.end_station_code.toLowerCase().includes(query),
    )
  }, [blocks, searchTerm])

  const selectedMaintenance = useMemo(() => {
    if (!selectedBlock) return []

    return maintenance.filter(
      (item) => item.block_code === selectedBlock.code,
    )
  }, [maintenance, selectedBlock])

  const criticalCount = maintenance.filter(
    (item) => maintenanceStatus(item.status) === 'critical',
  ).length

  const attentionCount = maintenance.filter(
    (item) => maintenanceStatus(item.status) === 'attention',
  ).length

  const healthyCount = Math.max(
    blocks.length - criticalCount - attentionCount,
    0,
  )

  const networkStats = [
    {
      label: 'Stations',
      value: String(stations.length),
      icon: MapPin,
    },
    {
      label: 'Active Blocks',
      value: String(blocks.length),
      icon: Activity,
    },
    {
      label: 'Healthy',
      value: String(healthyCount),
      icon: CheckCircle2,
    },
    {
      label: 'Attention',
      value: String(attentionCount),
      icon: TriangleAlert,
    },
    {
      label: 'Critical',
      value: String(criticalCount),
      icon: XCircle,
    },
  ]

  const getBlockStatus = (block: Block): NetworkStatus => {
    const records = maintenance.filter(
      (item) => item.block_code === block.code,
    )

    if (
      records.some((item) => maintenanceStatus(item.status) === 'critical')
    ) {
      return 'critical'
    }

    if (
      records.some((item) => maintenanceStatus(item.status) === 'attention')
    ) {
      return 'attention'
    }

    return 'healthy'
  }



  const getStationName = (code: string) =>
    stations.find((station) => station.code === code)?.name ?? code

  const selectBlock = (block: Block) => {
    setSelectedBlockId(block.id)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#1F5F9C]">
            <Wifi className="h-3.5 w-3.5" />
            LIVE NETWORK MONITORING
          </div>

          <h3 className="text-2xl font-bold tracking-tight text-[#172B3A] sm:text-3xl">
            Railway Network
          </h3>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5B6773]">
            Monitor infrastructure, railway blocks, stations and maintenance
            status across the operational network.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/10 bg-emerald-400/5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />

            <span className="text-xs font-medium text-emerald-300">
              Backend Connected
            </span>
          </div>

          <button
            type="button"
            onClick={() => void loadNetwork(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl enterprise-card px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-700 hover:text-[#172B3A] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-400" />

            <div>
              <p className="text-sm font-semibold text-rose-300">
                Network data unavailable
              </p>

              <p className="mt-1 text-xs text-[#5B6773]">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {networkStats.map((stat) => {
          const Icon = stat.icon

          return (
            <div
              key={stat.label}
              className="rounded-2xl enterprise-card p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {stat.label}
                </span>

                <Icon className="h-4 w-4 text-slate-500" />
              </div>

              <p
                className={[
                  'mt-3 text-2xl font-bold',
                  stat.label === 'Healthy'
                    ? 'text-emerald-400'
                    : stat.label === 'Attention'
                      ? 'text-amber-400'
                      : stat.label === 'Critical'
                        ? 'text-rose-400'
                        : stat.label === 'Active Blocks'
                          ? 'text-[#1F5F9C]'
                          : 'text-[#172B3A]',
                ].join(' ')}
              >
                {loading ? '—' : stat.value}
              </p>
            </div>
          )
        })}
      </section>

      {/* Map and selected block */}
      <section className="grid gap-6 xl:grid-cols-[1.55fr_0.75fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-2xl enterprise-card">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h4 className="text-sm font-semibold text-[#172B3A]">
                Live Network Map
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Real stations and blocks from RailSync backend
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />

              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search block..."
                className="w-44 rounded-lg border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#1F5F9C]"
              />
            </div>
          </div>

          <div className="relative overflow-hidden bg-[#071524]">
            <RailwayNetworkMap
              stations={stations}
              blocks={filteredBlocks}
              maintenance={maintenance}
              trains={trains}
              selectedBlockId={selectedBlockId}
              onSelectBlock={(block) => selectBlock(block)}
              onSelectStation={(station) => {
                const connected = blocks.find(
                  (b) =>
                    b.start_station_code === station.code ||
                    b.end_station_code === station.code,
                )
                if (connected) selectBlock(connected)
              }}
            />
          </div>
        </div>

        {/* Selected block */}
        <div className="rounded-2xl enterprise-card">
          <div className="border-b border-slate-800 px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#1F5F9C]">
              Selected Block
            </p>

            <div className="mt-1 flex items-center justify-between">
              <h4 className="text-lg font-bold text-[#172B3A]">
                {selectedBlock?.code ?? '—'}
              </h4>

              <div className="rounded-xl bg-[#1F5F9C]/10 p-2.5">
                <Zap className="h-5 w-5 text-[#1F5F9C]" />
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            {selectedBlock ? (
              <>
                <div className="rounded-xl border border-cyan-400/15 bg-[#1F5F9C]/5 p-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'h-2 w-2 rounded-full',
                        statusClasses(getBlockStatus(selectedBlock)).dot,
                      ].join(' ')}
                    />

                    <span className="text-xs font-bold text-cyan-300">
                      {getBlockStatus(selectedBlock) === 'critical'
                        ? 'Critical condition'
                        : getBlockStatus(selectedBlock) === 'attention'
                          ? 'Requires attention'
                          : 'Healthy condition'}
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-[#5B6773]">
                    {selectedBlock.name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">
                      Distance
                    </p>

                    <p className="mt-1 text-base font-bold text-[#172B3A]">
                      {selectedBlock.distance_km} km
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">
                      Maintenance
                    </p>

                    <p className="mt-1 text-base font-bold text-[#1F5F9C]">
                      {selectedMaintenance.length}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">
                      Block ID
                    </p>

                    <p className="mt-1 text-base font-bold text-[#172B3A]">
                      #{selectedBlock.id}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500">
                      Status
                    </p>

                    <p className="mt-1 text-base font-bold capitalize text-emerald-400">
                      {getBlockStatus(selectedBlock)}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Start station
                    </span>

                    <span className="text-xs font-semibold text-slate-300">
                      {getStationName(selectedBlock.start_station_code)} (
                      {selectedBlock.start_station_code})
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      End station
                    </span>

                    <span className="text-xs font-semibold text-slate-300">
                      {getStationName(selectedBlock.end_station_code)} (
                      {selectedBlock.end_station_code})
                    </span>
                  </div>
                </div>

                {selectedMaintenance.length > 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      Latest maintenance
                    </p>

                    <p className="mt-2 text-xs font-semibold text-slate-200">
                      {selectedMaintenance[0].maintenance_type}
                    </p>

                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {selectedMaintenance[0].description}
                    </p>

                    <p className="mt-2 text-[10px] text-slate-600">
                      {formatTime(selectedMaintenance[0].scheduled_start)}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    window.alert(
                      `${selectedBlock.code}\n\n${selectedBlock.name}\nDistance: ${selectedBlock.distance_km} km`,
                    )
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F5F9C] px-4 py-3 text-xs font-bold text-slate-950 transition hover:bg-cyan-300"
                >
                  View Block Details
                  <Zap className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="py-10 text-center">
                <MapPin className="mx-auto h-8 w-8 text-slate-700" />

                <p className="mt-3 text-sm font-semibold text-[#5B6773]">
                  No block selected
                </p>

                <p className="mt-1 text-xs text-slate-600">
                  Create a block in the backend to see its details here.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Blocks and alerts */}
      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.8fr]">
        {/* Blocks */}
        <div className="overflow-hidden rounded-2xl enterprise-card">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold text-[#172B3A]">
                Railway Blocks
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Blocks currently available from the backend
              </p>
            </div>

            <Activity className="h-5 w-5 text-[#1F5F9C]" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-slate-800 bg-slate-900/30">
                <tr>
                  {['Block', 'Start', 'End', 'Distance', 'Status'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-3.5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500 lg:px-4"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody>
                {filteredBlocks.map((block) => {
                  const status = getBlockStatus(block)

                  return (
                    <tr
                      key={block.id}
                      onClick={() => selectBlock(block)}
                      className={[
                        'cursor-pointer border-b border-slate-800/70 transition last:border-0 hover:bg-slate-900/40',
                        selectedBlockId === block.id
                          ? 'bg-[#1F5F9C]/5'
                          : '',
                      ].join(' ')}
                    >
                      <td className="px-3.5 py-3 lg:px-4 lg:py-3.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={[
                              'h-2 w-2 rounded-full',
                              statusClasses(status).dot,
                            ].join(' ')}
                          />

                          <span className="text-xs font-semibold text-[#172B3A] whitespace-nowrap">
                            {block.code}
                          </span>
                        </div>
                      </td>

                      <td className="px-3.5 py-3 text-xs text-[#5B6773] whitespace-nowrap lg:px-4 lg:py-3.5">
                        {block.start_station_code}
                      </td>

                      <td className="px-3.5 py-3 text-xs text-[#5B6773] whitespace-nowrap lg:px-4 lg:py-3.5">
                        {block.end_station_code}
                      </td>

                      <td className="px-3.5 py-3 text-xs text-[#5B6773] whitespace-nowrap lg:px-4 lg:py-3.5">
                        {block.distance_km} km
                      </td>

                      <td className="px-3.5 py-3 whitespace-nowrap lg:px-4 lg:py-3.5">
                        <span
                          className={[
                            'rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize',
                            status === 'critical'
                              ? 'bg-rose-400/10 text-rose-400'
                              : status === 'attention'
                                ? 'bg-amber-400/10 text-amber-400'
                                : 'bg-emerald-400/10 text-emerald-400',
                          ].join(' ')}
                        >
                          {status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {!loading && filteredBlocks.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm font-semibold text-[#5B6773]">
                  No railway blocks found
                </p>

                <p className="mt-1 text-xs text-slate-600">
                  The backend currently returned no matching blocks.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-2xl enterprise-card">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold text-[#172B3A]">
                Network Alerts
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Latest maintenance events
              </p>
            </div>

            <Activity className="h-5 w-5 text-slate-500" />
          </div>

          {maintenance.length > 0 ? (
            <div className="divide-y divide-slate-800">
              {maintenance.slice(0, 5).map((item) => {
                const status = maintenanceStatus(item.status)

                return (
                  <div key={item.id} className="p-5">
                    <div className="flex gap-3">
                      <span
                        className={[
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          statusClasses(status).dot,
                        ].join(' ')}
                      />

                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-xs font-semibold text-slate-200">
                            {item.block_code} · {item.maintenance_type}
                          </p>

                          <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                        </div>

                        <p className="mt-1.5 text-xs leading-5 text-slate-500">
                          {item.description}
                        </p>

                        <p className="mt-2 text-[10px] capitalize text-slate-600">
                          {item.status} · {formatTime(item.scheduled_start)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-400/70" />

              <p className="mt-3 text-sm font-semibold text-slate-300">
                No maintenance alerts
              </p>

              <p className="mt-1 max-w-xs text-xs leading-5 text-slate-600">
                The backend currently has no maintenance records for the
                network.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}