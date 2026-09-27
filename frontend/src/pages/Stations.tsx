import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'

import { API_BASE_URL } from '../lib/api'

type Station = {
  id: number
  code: string
  name: string
  latitude: number
  longitude: number
}

type StationForm = {
  code: string
  name: string
  latitude: string
  longitude: string
}

const emptyForm: StationForm = {
  code: '',
  name: '',
  latitude: '',
  longitude: '',
}

function Stations() {
  const [stations, setStations] = useState<Station[]>([])
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<StationForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const loadStations = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      setError('')

      const response = await fetch(`${API_BASE_URL}/stations/`)

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`)
      }

      const data: Station[] = await response.json()
      setStations(data)

      setSelectedStation((current) => {
        if (!current) {
          return data[0] ?? null
        }

        return data.find((station) => station.id === current.id) ?? data[0] ?? null
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load station data.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadStations()
  }, [loadStations])

  const filteredStations = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return stations
    }

    return stations.filter((station) =>
      `${station.code} ${station.name} ${station.latitude} ${station.longitude}`
        .toLowerCase()
        .includes(query),
    )
  }, [search, stations])

  const handleCreateStation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setFormError('')
    setSuccessMessage('')

    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    const latitude = Number(form.latitude)
    const longitude = Number(form.longitude)

    if (!code || !name || !form.latitude || !form.longitude) {
      setFormError('Please fill in all station fields.')
      return
    }

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      setFormError('Latitude must be a number between -90 and 90.')
      return
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setFormError('Longitude must be a number between -180 and 180.')
      return
    }

    try {
      setSaving(true)

      const response = await fetch(`${API_BASE_URL}/stations/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code,
          name,
          latitude,
          longitude,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          data?.detail ?? `Unable to create station (${response.status}).`,
        )
      }

      const createdStation = data as Station

      setStations((current) => [...current, createdStation])
      setSelectedStation(createdStation)
      setForm(emptyForm)
      setShowForm(false)
      setSuccessMessage(`${createdStation.code} station created successfully.`)

      window.setTimeout(() => {
        setSuccessMessage('')
      }, 3500)
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : 'Unable to create station.',
      )
    } finally {
      setSaving(false)
    }
  }

  const formatCoordinate = (value: number) => value.toFixed(4)

  return (
    <div className="min-h-[calc(100vh-80px)] bg-transparent px-5 py-7 text-[#172B3A] md:px-7 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-[#1F5F9C]">
              <MapPin size={15} />
              RAILWAY INFRASTRUCTURE
            </div>

            <h2 className="text-3xl font-semibold tracking-tight text-[#172B3A] md:text-4xl">
              Station Control
            </h2>

            <p className="mt-2 max-w-2xl text-sm text-[#5B6773] md:text-base">
              Manage railway stations and geographic infrastructure connected
              to the RailSync AI backend.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void loadStations(true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-[#0b1b2b] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-500/50 hover:bg-[#102638] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                size={17}
                className={refreshing ? 'animate-spin' : ''}
              />
              Refresh
            </button>

            <button
              type="button"
              onClick={() => {
                setForm(emptyForm)
                setFormError('')
                setShowForm(true)
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1F5F9C] px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400"
            >
              <Plus size={18} />
              Add Station
            </button>
          </div>
        </section>

        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            <CheckCircle2 size={18} />
            {successMessage}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-300">
            <AlertTriangle size={19} className="mt-0.5 shrink-0" />
            <div>
              <strong className="block text-rose-200">
                Station data unavailable
              </strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={Building2}
            label="Total Stations"
            value={stations.length}
            tone="cyan"
          />

          <StatCard
            icon={MapPin}
            label="Mapped Stations"
            value={stations.filter(
              (station) =>
                Number.isFinite(station.latitude) &&
                Number.isFinite(station.longitude),
            ).length}
            tone="green"
          />

          <StatCard
            icon={CheckCircle2}
            label="Backend Status"
            value={error ? 'Offline' : 'Connected'}
            tone={error ? 'red' : 'green'}
          />
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.85fr)]">
          <section className="overflow-hidden rounded-2xl enterprise-card shadow-2xl shadow-black/10">
            <div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[#172B3A]">
                  Railway Stations
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Live records from the RailSync AI backend
                </p>
              </div>

              <div className="relative w-full md:w-72">
                <Search
                  size={17}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search stations..."
                  className="w-full rounded-xl border border-slate-700 bg-[#071522] py-2.5 pl-10 pr-4 text-sm text-[#172B3A] outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
                />
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-[320px] items-center justify-center">
                <div className="flex items-center gap-3 text-sm text-[#5B6773]">
                  <RefreshCw size={18} className="animate-spin text-[#1F5F9C]" />
                  Loading stations...
                </div>
              </div>
            ) : filteredStations.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 rounded-full border border-slate-700 bg-slate-900/70 p-4">
                  <MapPin size={30} className="text-slate-500" />
                </div>

                <h4 className="text-lg font-semibold text-slate-300">
                  {search ? 'No stations found' : 'No stations available'}
                </h4>

                <p className="mt-2 max-w-md text-sm text-slate-500">
                  {search
                    ? 'Try another station name or code.'
                    : 'Create a station to start building the railway network.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-800 bg-[#091624] text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-3.5 py-3 lg:px-4 lg:py-3.5">Station</th>
                      <th className="px-3.5 py-3 lg:px-4 lg:py-3.5">Code</th>
                      <th className="px-3.5 py-3 lg:px-4 lg:py-3.5">Latitude</th>
                      <th className="px-3.5 py-3 lg:px-4 lg:py-3.5">Longitude</th>
                      <th className="px-3.5 py-3 lg:px-4 lg:py-3.5">Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredStations.map((station) => {
                      const selected = selectedStation?.id === station.id

                      return (
                        <tr
                          key={station.id}
                          onClick={() => setSelectedStation(station)}
                          className={`cursor-pointer border-b border-slate-800/80 transition ${
                            selected
                              ? 'bg-[#1F5F9C]/[0.08]'
                              : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <td className="px-3.5 py-3 lg:px-4 lg:py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-[#1F5F9C]/10 text-[#1F5F9C]">
                                <Building2 size={16} />
                              </div>

                              <div className="min-w-0">
                                <div className="font-semibold text-[#172B3A] truncate max-w-[150px] sm:max-w-[190px] xl:max-w-[220px]">
                                  {station.name}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500 whitespace-nowrap">
                                  ID #{station.id}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-3.5 py-3 font-semibold text-cyan-300 whitespace-nowrap lg:px-4 lg:py-3.5">
                            {station.code}
                          </td>

                          <td className="px-3.5 py-3 text-sm text-[#5B6773] whitespace-nowrap lg:px-4 lg:py-3.5">
                            {formatCoordinate(station.latitude)}
                          </td>

                          <td className="px-3.5 py-3 text-sm text-[#5B6773] whitespace-nowrap lg:px-4 lg:py-3.5">
                            {formatCoordinate(station.longitude)}
                          </td>

                          <td className="px-3.5 py-3 whitespace-nowrap lg:px-4 lg:py-3.5">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Operational
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="rounded-2xl enterprise-card">
            <div className="border-b border-slate-800 px-5 py-5">
              <div className="text-[11px] font-bold tracking-[0.16em] text-[#1F5F9C]">
                SELECTED STATION
              </div>

              <h3 className="mt-2 text-xl font-semibold text-[#172B3A]">
                {selectedStation?.code ?? '—'}
              </h3>
            </div>

            {selectedStation ? (
              <div className="space-y-5 p-5">
                <div className="rounded-xl border border-cyan-500/20 bg-[#1F5F9C]/[0.07] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#1F5F9C]/10 text-[#1F5F9C]">
                      <MapPin size={21} />
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Station Name</div>
                      <div className="font-semibold text-[#172B3A]">
                        {selectedStation.name}
                      </div>
                    </div>
                  </div>
                </div>

                <DetailRow
                  label="Station ID"
                  value={`#${selectedStation.id}`}
                />

                <DetailRow
                  label="Station Code"
                  value={selectedStation.code}
                />

                <DetailRow
                  label="Latitude"
                  value={formatCoordinate(selectedStation.latitude)}
                />

                <DetailRow
                  label="Longitude"
                  value={formatCoordinate(selectedStation.longitude)}
                />

                <div className="border-t border-slate-800 pt-5">
                  <div className="mb-2 text-xs font-semibold text-slate-500">
                    LOCATION
                  </div>

                  <div className="rounded-xl enterprise-card p-4">
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <MapPin size={16} className="text-[#1F5F9C]" />
                      Geographic coordinates available
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      {selectedStation.latitude.toFixed(4)},{' '}
                      {selectedStation.longitude.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
                <MapPin size={34} className="mb-4 text-slate-600" />
                <h4 className="font-semibold text-[#5B6773]">
                  No station selected
                </h4>
                <p className="mt-2 text-sm text-slate-600">
                  Select a station from the table to view its details.
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1929] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <div className="text-[11px] font-bold tracking-[0.16em] text-[#1F5F9C]">
                  STATION MANAGEMENT
                </div>
                <h3 className="mt-1 text-xl font-semibold text-[#172B3A]">
                  Add Railway Station
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-700 p-2 text-[#5B6773] transition hover:border-slate-600 hover:text-[#172B3A]"
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleCreateStation} className="p-6">
              {formError && (
                <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <FormField
                  label="Station Code"
                  placeholder="e.g. NDLS"
                  value={form.code}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      code: value.toUpperCase(),
                    }))
                  }
                  required
                />

                <FormField
                  label="Station Name"
                  placeholder="e.g. New Delhi"
                  value={form.name}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      name: value,
                    }))
                  }
                  required
                />

                <FormField
                  label="Latitude"
                  type="number"
                  placeholder="e.g. 28.6139"
                  value={form.latitude}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      latitude: value,
                    }))
                  }
                  required
                />

                <FormField
                  label="Longitude"
                  type="number"
                  placeholder="e.g. 77.2090"
                  value={form.longitude}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      longitude: value,
                    }))
                  }
                  required
                />
              </div>

              <div className="mt-7 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1F5F9C] px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <RefreshCw size={17} className="animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus size={17} />
                      Create Station
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Building2
  label: string
  value: number | string
  tone: 'cyan' | 'green' | 'red'
}) {
  const toneClasses = {
    cyan: 'border-cyan-500/20 text-[#1F5F9C] bg-[#1F5F9C]/10',
    green: 'border-emerald-500/20 text-emerald-400 bg-emerald-500/10',
    red: 'border-rose-500/20 text-rose-400 bg-rose-500/10',
  }

  return (
    <article className="rounded-2xl enterprise-card p-5">
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl border ${toneClasses[tone]}`}
        >
          <Icon size={21} />
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </div>
          <div className="mt-1 text-2xl font-bold text-[#172B3A]">
            {value}
          </div>
        </div>
      </div>
    </article>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-500">{label}</span>
      <strong className="text-sm text-slate-200">{value}</strong>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-[#5B6773]">
        {label}
        {required && <span className="ml-1 text-[#1F5F9C]">*</span>}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        step={type === 'number' ? 'any' : undefined}
        className="w-full rounded-xl border border-slate-700 bg-[#071522] px-4 py-3 text-sm text-[#172B3A] outline-none placeholder:text-slate-600 focus:border-cyan-500/60"
      />
    </label>
  )
}

export default Stations

