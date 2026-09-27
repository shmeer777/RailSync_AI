import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../lib/api'
import {
  Activity,
  BarChart3,
  Clock,
  Download,
  Gauge,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const hourlyData24h = [
  { hour: '00:00', departures: 12, arrivals: 10, delayed: 1 },
  { hour: '02:00', departures: 8, arrivals: 7, delayed: 0 },
  { hour: '04:00', departures: 15, arrivals: 12, delayed: 1 },
  { hour: '06:00', departures: 28, arrivals: 24, delayed: 3 },
  { hour: '08:00', departures: 42, arrivals: 38, delayed: 6 },
  { hour: '10:00', departures: 36, arrivals: 35, delayed: 4 },
  { hour: '12:00', departures: 30, arrivals: 31, delayed: 2 },
  { hour: '14:00', departures: 34, arrivals: 32, delayed: 5 },
  { hour: '16:00', departures: 45, arrivals: 40, delayed: 7 },
  { hour: '18:00', departures: 48, arrivals: 44, delayed: 8 },
  { hour: '20:00', departures: 38, arrivals: 36, delayed: 4 },
  { hour: '22:00', departures: 22, arrivals: 20, delayed: 2 },
]

const priorityDelayData = [
  { priority: 'Rajdhani / Express', onTime: 92, avgDelayMin: 4 },
  { priority: 'Vande Bharat', onTime: 96, avgDelayMin: 2 },
  { priority: 'Superfast', onTime: 88, avgDelayMin: 9 },
  { priority: 'Passenger', onTime: 79, avgDelayMin: 18 },
  { priority: 'Freight', onTime: 74, avgDelayMin: 24 },
]

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<'6h' | '24h' | '7d'>('24h')
  const [liveTrainsCount, setLiveTrainsCount] = useState(24)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/trains/`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setLiveTrainsCount(data.length)
        }
      })
      .catch(() => {})
  }, [])

  const handleExportAnalytics = () => {
    const reportData = {
      generatedAt: new Date().toISOString(),
      timeRange,
      totalMonitoredTrains: liveTrainsCount,
      onTimePerformance: '89.4%',
      networkHealthIndex: '94.2%',
      hourlyOperations: hourlyData24h,
      priorityMetrics: priorityDelayData,
    }

    const blob = new Blob([JSON.stringify(reportData, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `railsync_analytics_${timeRange}_${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setExportMessage('Analytics report exported as JSON successfully!')
    window.setTimeout(() => setExportMessage(null), 3500)
  }

  return (
    <div className="min-h-full bg-transparent px-4 py-5 text-[#172B3A] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-cyan-400">
              <BarChart3 className="h-4 w-4" />
              Intelligence / Performance Analytics
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#172B3A]">
              Railway Operations Analytics
            </h1>
            <p className="mt-1 text-sm text-[#5B6773]">
              Train movement volumes, schedule adherence, delay trends, and capacity telemetry.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-xl border border-slate-700 bg-slate-900 p-1">
              {(['6h', '24h', '7d'] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    timeRange === range
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-[#172B3A]'
                  }`}
                >
                  {range === '6h' ? 'Last 6h' : range === '24h' ? '24 Hours' : '7 Days'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportAnalytics}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-[#172B3A] transition hover:bg-cyan-500"
            >
              <Download className="h-4 w-4" />
              Export Analytics
            </button>
          </div>
        </header>

        {exportMessage && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-300">
            {exportMessage}
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-cyan-400">
              <span className="text-xs font-bold uppercase tracking-wider">On-Time Performance</span>
              <Gauge className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">89.4%</p>
            <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
              <TrendingUp className="h-3.5 w-3.5" />
              +2.1% from previous week
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-emerald-400">
              <span className="text-xs font-bold uppercase tracking-wider">Avg Delay (Delayed Only)</span>
              <Clock className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">8.6 min</p>
            <div className="mt-1 flex items-center gap-1 text-xs text-emerald-400">
              <TrendingDown className="h-3.5 w-3.5" />
              -1.4 min recovery
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-indigo-400">
              <span className="text-xs font-bold uppercase tracking-wider">Block Throughput</span>
              <Activity className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">361 trains/day</p>
            <div className="mt-1 text-xs text-indigo-300">Peak hour capacity: 91%</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-amber-400">
              <span className="text-xs font-bold uppercase tracking-wider">Active Services</span>
              <Zap className="h-5 w-5" />
            </div>
            <p className="mt-2 text-3xl font-bold text-[#172B3A]">{liveTrainsCount}</p>
            <div className="mt-1 text-xs text-[#5B6773]">Monitored live on network</div>
          </div>
        </section>

        {/* Charts Section */}
        <section className="grid gap-6 lg:grid-cols-2">
          {/* Movement Volume Area Chart */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#172B3A]">Train Movements (24h)</h3>
                <p className="text-xs text-[#5B6773]">Departures vs Arrivals across major junction blocks</p>
              </div>
              <span className="rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300">
                Live Stream
              </span>
            </div>

            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourlyData24h} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="depColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="arrColor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Area
                    type="monotone"
                    dataKey="departures"
                    name="Departures"
                    stroke="#06b6d4"
                    fillOpacity={1}
                    fill="url(#depColor)"
                  />
                  <Area
                    type="monotone"
                    dataKey="arrivals"
                    name="Arrivals"
                    stroke="#6366f1"
                    fillOpacity={1}
                    fill="url(#arrColor)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Adherence by Train Type */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#172B3A]">Adherence by Train Class</h3>
                <p className="text-xs text-[#5B6773]">On-time rate percentage vs average delay</p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                Punctuality
              </span>
            </div>

            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={priorityDelayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="priority" stroke="#64748b" fontSize={10} interval={0} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="onTime" name="On-Time %" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="avgDelayMin" name="Avg Delay (min)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Operational Bottleneck Highlights */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="text-base font-semibold text-[#172B3A]">Operational Bottleneck Analysis</h3>
          <p className="mt-1 text-xs text-[#5B6773]">
            Identified by network optimization algorithms across track blocks and junction switches.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400">BLOCK NDLS-GZB-1</span>
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  94% Load
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#172B3A]">New Delhi → Ghaziabad Trunk</p>
              <p className="mt-1 text-xs text-[#5B6773]">
                High suburban passenger density causes 4.2 min spacing buffer during peak hours.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400">BLOCK CNB-PRYJ-2</span>
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  Optimal
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#172B3A]">Kanpur → Prayagraj Fast Line</p>
              <p className="mt-1 text-xs text-[#5B6773]">
                Automated block signaling functioning at target 130 km/h cruising throughput.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400">STATION BSB JUNCTION</span>
                <span className="rounded-md bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                  Maintenance
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-[#172B3A]">Varanasi Platform 3 & 4</p>
              <p className="mt-1 text-xs text-[#5B6773]">
                Overhead catenary replacement in progress; incoming trains routed through loop lines.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
