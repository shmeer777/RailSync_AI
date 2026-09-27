import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MapPin,
  RefreshCw,
  Search,
  TrainFront,
  TriangleAlert,
  Wifi,
  XCircle,
  Zap,
} from 'lucide-react'

const networkStats = [
  { label: 'Stations', value: '42', icon: MapPin },
  { label: 'Active Blocks', value: '118', icon: Activity },
  { label: 'Healthy', value: '104', icon: CheckCircle2 },
  { label: 'Attention', value: '09', icon: TriangleAlert },
  { label: 'Critical', value: '05', icon: XCircle },
]

const stations = [
  {
    name: 'New Delhi',
    code: 'NDLS',
    left: '8%',
    top: '72%',
    status: 'healthy',
  },
  {
    name: 'B12',
    code: 'BLOCK',
    left: '27%',
    top: '59%',
    status: 'critical',
  },
  {
    name: 'B07',
    code: 'BLOCK',
    left: '45%',
    top: '51%',
    status: 'attention',
  },
  {
    name: 'B15',
    code: 'BLOCK',
    left: '64%',
    top: '42%',
    status: 'healthy',
  },
  {
    name: 'Ghaziabad',
    code: 'GZB',
    left: '82%',
    top: '31%',
    status: 'healthy',
  },
  {
    name: 'Meerut',
    code: 'MRT',
    left: '91%',
    top: '19%',
    status: 'attention',
  },
]

const trains = [
  {
    train: 'EXP-12001',
    type: 'Express',
    block: 'B07',
    speed: '82 km/h',
    status: 'Running',
  },
  {
    train: 'NDLS-2204',
    type: 'Passenger',
    block: 'B15',
    speed: '64 km/h',
    status: 'Running',
  },
  {
    train: 'FRT-8012',
    type: 'Freight',
    block: 'B12',
    speed: '42 km/h',
    status: 'Restricted',
  },
]

const alerts = [
  {
    title: 'Critical risk on B12',
    description: 'Elevated vibration levels detected.',
    time: '8 min ago',
    type: 'critical',
  },
  {
    title: 'B07 requires attention',
    description: 'Signal performance below normal range.',
    time: '21 min ago',
    type: 'warning',
  },
  {
    title: 'Network synchronization complete',
    description: 'Field telemetry synchronized successfully.',
    time: '34 min ago',
    type: 'success',
  },
]

function statusClasses(status: string) {
  if (status === 'critical') {
    return {
      dot: 'bg-rose-400',
      glow: 'shadow-[0_0_18px_rgba(251,113,133,0.8)]',
    }
  }

  if (status === 'attention') {
    return {
      dot: 'bg-amber-400',
      glow: 'shadow-[0_0_18px_rgba(251,191,36,0.7)]',
    }
  }

  return {
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_18px_rgba(52,211,153,0.7)]',
  }
}

export default function Network() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-cyan-400">
            <Wifi className="h-3.5 w-3.5" />
            LIVE NETWORK MONITORING
          </div>

          <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Railway Network
          </h3>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Monitor infrastructure, railway blocks, stations and train
            movement across the operational network.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/10 bg-emerald-400/5 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-emerald-300">
              Live Data
            </span>
          </div>

          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-[#0d1929] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-700 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </section>

      {/* Statistics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {networkStats.map((stat) => {
          const Icon = stat.icon

          return (
            <div
              key={stat.label}
              className="rounded-2xl border border-slate-800 bg-[#0d1929] p-4"
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
                          ? 'text-cyan-400'
                          : 'text-white',
                ].join(' ')}
              >
                {stat.value}
              </p>
            </div>
          )
        })}
      </section>

      {/* Main network area */}
      <section className="grid gap-6 xl:grid-cols-[1.55fr_0.75fr]">
        {/* Map */}
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1929]">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Live Network Map
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Infrastructure and block status
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />

              <input
                type="text"
                placeholder="Search block..."
                className="w-44 rounded-lg border border-slate-800 bg-slate-900/70 py-2 pl-9 pr-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/30"
              />
            </div>
          </div>

          <div className="relative h-[500px] overflow-hidden bg-[#081421]">
            {/* Grid */}
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(100,116,139,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(100,116,139,0.15)_1px,transparent_1px)] [background-size:40px_40px]" />

            {/* Railway routes */}
            <div className="absolute left-[4%] top-[72%] h-[2px] w-[91%] rotate-[-13deg] bg-slate-600" />

            <div className="absolute left-[6%] top-[53%] h-[2px] w-[88%] rotate-[7deg] bg-slate-700" />

            <div className="absolute left-[17%] top-[30%] h-[2px] w-[73%] rotate-[-24deg] bg-slate-700" />

            <div className="absolute left-[29%] top-[12%] h-[2px] w-[59%] rotate-[38deg] bg-slate-800" />

            {/* Highlighted blocks */}
            <div className="absolute left-[10%] top-[66%] h-[3px] w-[21%] rotate-[-13deg] bg-emerald-400/30" />

            <div className="absolute left-[31%] top-[57%] h-[3px] w-[20%] rotate-[-13deg] bg-rose-400/50" />

            <div className="absolute left-[51%] top-[48%] h-[3px] w-[21%] rotate-[-13deg] bg-amber-400/50" />

            <div className="absolute left-[72%] top-[38%] h-[3px] w-[18%] rotate-[-13deg] bg-emerald-400/30" />

            {/* Station nodes */}
            {stations.map((station) => {
              const classes = statusClasses(station.status)

              return (
                <div
                  key={station.code + station.name}
                  className="absolute"
                  style={{
                    left: station.left,
                    top: station.top,
                  }}
                >
                  <div
                    className={`h-4 w-4 rounded-full border-[3px] border-[#081421] ${classes.dot} ${classes.glow}`}
                  />

                  <div className="absolute left-6 top-[-6px] whitespace-nowrap">
                    <p className="text-[11px] font-semibold text-slate-200">
                      {station.name}
                    </p>

                    <p className="mt-0.5 text-[9px] text-slate-500">
                      {station.code}
                    </p>
                  </div>
                </div>
              )
            })}

            {/* Train positions */}
            <div className="absolute left-[54%] top-[46%] flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-400">
              <TrainFront className="h-4 w-4" />
            </div>

            <div className="absolute left-[74%] top-[36%] flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-400">
              <TrainFront className="h-4 w-4" />
            </div>

            <div className="absolute left-[30%] top-[54%] flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-400/10 text-rose-400">
              <TrainFront className="h-4 w-4" />
            </div>

            {/* Map controls */}
            <div className="absolute right-4 top-4 overflow-hidden rounded-xl border border-slate-800 bg-[#0b1626]/95">
              <button
                type="button"
                className="block w-9 border-b border-slate-800 py-2 text-sm text-slate-400 hover:text-white"
              >
                +
              </button>

              <button
                type="button"
                className="block w-9 py-2 text-sm text-slate-400 hover:text-white"
              >
                −
              </button>
            </div>

            {/* Legend */}
            <div className="absolute bottom-4 left-4 rounded-xl border border-slate-800 bg-[#0b1626]/95 px-4 py-3">
              <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                Network Status
              </p>

              <div className="flex flex-wrap gap-4">
                <span className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Healthy
                </span>

                <span className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Attention
                </span>

                <span className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-rose-400" />
                  Critical
                </span>

                <span className="flex items-center gap-2 text-[10px] text-slate-400">
                  <TrainFront className="h-3 w-3 text-cyan-400" />
                  Train
                </span>
              </div>
            </div>

            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-emerald-400/10 bg-[#0b1626]/95 px-3 py-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />

              <span className="text-[10px] font-medium text-emerald-300">
                Network live
              </span>
            </div>
          </div>
        </div>

        {/* Selected block */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1929]">
          <div className="border-b border-slate-800 px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
              Selected Block
            </p>

            <div className="mt-1 flex items-center justify-between">
              <h4 className="text-lg font-bold text-white">B12</h4>

              <div className="rounded-xl bg-rose-400/10 p-2.5">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="rounded-xl border border-rose-400/15 bg-rose-400/5 p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-400" />

                <span className="text-xs font-bold text-rose-300">
                  Critical condition
                </span>
              </div>

              <p className="mt-2 text-xs leading-5 text-slate-400">
                Elevated vibration patterns detected. Infrastructure requires
                inspection.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">
                  Distance
                </p>

                <p className="mt-1 text-base font-bold text-white">
                  5.8 km
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">
                  AI Risk
                </p>

                <p className="mt-1 text-base font-bold text-rose-400">
                  82%
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">
                  Trains
                </p>

                <p className="mt-1 text-base font-bold text-white">
                  03
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-500">
                  Health
                </p>

                <p className="mt-1 text-base font-bold text-amber-400">
                  64%
                </p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Infrastructure health
                </span>

                <span className="text-xs font-bold text-amber-400">
                  64%
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-[64%] rounded-full bg-amber-400" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Start station
                </span>

                <span className="text-xs font-semibold text-slate-300">
                  NDLS
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  End station
                </span>

                <span className="text-xs font-semibold text-slate-300">
                  GZB
                </span>
              </div>
            </div>

            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 text-xs font-bold text-slate-950 transition hover:bg-cyan-300"
            >
              View Block Details
              <Zap className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Trains + alerts */}
      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.8fr]">
        {/* Trains */}
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1929]">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Active Trains
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Current train movement
              </p>
            </div>

            <TrainFront className="h-5 w-5 text-cyan-400" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="border-b border-slate-800 bg-slate-900/30">
                <tr>
                  {['Train', 'Type', 'Block', 'Speed', 'Status'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>

              <tbody>
                {trains.map((train) => (
                  <tr
                    key={train.train}
                    className="border-b border-slate-800/70 last:border-0"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-cyan-400" />

                        <span className="text-xs font-semibold text-white">
                          {train.train}
                        </span>
                      </div>
                    </td>

                    <td className="px-5 py-4 text-xs text-slate-400">
                      {train.type}
                    </td>

                    <td className="px-5 py-4 text-xs font-semibold text-cyan-300">
                      {train.block}
                    </td>

                    <td className="px-5 py-4 text-xs text-slate-400">
                      {train.speed}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                          train.status === 'Restricted'
                            ? 'bg-rose-400/10 text-rose-400'
                            : 'bg-emerald-400/10 text-emerald-400'
                        }`}
                      >
                        {train.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-2xl border border-slate-800 bg-[#0d1929]">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h4 className="text-sm font-semibold text-white">
                Network Alerts
              </h4>

              <p className="mt-1 text-xs text-slate-500">
                Latest infrastructure events
              </p>
            </div>

            <Activity className="h-5 w-5 text-slate-500" />
          </div>

          <div className="divide-y divide-slate-800">
            {alerts.map((alert) => (
              <div key={alert.title} className="p-5">
                <div className="flex gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      alert.type === 'critical'
                        ? 'bg-rose-400'
                        : alert.type === 'warning'
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                  />

                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold text-slate-200">
                        {alert.title}
                      </p>

                      <Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    </div>

                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      {alert.description}
                    </p>

                    <p className="mt-2 text-[10px] text-slate-600">
                      {alert.time}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}