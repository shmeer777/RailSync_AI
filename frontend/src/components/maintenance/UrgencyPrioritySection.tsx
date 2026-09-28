import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import { API_BASE_URL } from '../../lib/api'

type UrgencyFactors = {
  priority_weight: number
  risk_factor: number
  dependency_impact: number
  deadline_pressure: number
  operational_impact: number
  duration_penalty: number
}

type RecommendedWindow = {
  start: string
  end: string
  window_type: string
  notes?: string | null
}

type MaintenanceUrgencyItem = {
  maintenance_id: number
  location_type: string
  block_code: string | null
  station_code: string | null
  maintenance_type: string
  department: string
  crew_type: string
  priority: string
  risk_score: number
  model_confidence: number | null
  urgency_score: number
  urgency_level: 'Critical' | 'High' | 'Medium' | 'Low'
  dependent_task_count: number
  blocked_task_ids: number[]
  deadline: string | null
  deadline_status: string
  deadline_pressure: string
  operational_impact: string
  recommended_window: RecommendedWindow | null
  recommended_scheduling_window: string
  contributing_factors: string[]
  factors: UrgencyFactors
  explanation: string
  human_approval_required: boolean
  earliest_feasible_window_reason: string | null
}

type MaintenanceUrgencyResponse = {
  total_tasks: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  average_urgency_score: number
  items: MaintenanceUrgencyItem[]
  decision_support_note: string
}

type UrgencyScheduleComparison = {
  critical_tasks_scheduled_earlier: number
  average_urgency_wait_reduction_minutes: number
  dependency_delays_prevented: number
  deadline_violations_prevented: number
}

type ScheduleItem = {
  maintenance_id: number
  maintenance_type: string
  location_type: string
  block_code: string | null
  station_code: string | null
  priority: string
  urgency_level: string
  urgency_score: number
  risk_score: number
  model_confidence: number | null
  dependent_task_count: number
  start_minute: number
  end_minute: number
  duration_minutes: number
  scheduled_start: string
  scheduled_end: string
  assigned_crew_id: number | null
  assigned_crew_name: string | null
  timing_reason: string
}

type UrgencyScheduleResponse = {
  optimization_status: string
  scheduled_tasks_count: number
  comparison: UrgencyScheduleComparison
  schedule_items: ScheduleItem[]
  explanation: string
  human_approval_required: boolean
}

export default function UrgencyPrioritySection() {
  const [data, setData] = useState<MaintenanceUrgencyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleResult, setScheduleResult] = useState<UrgencyScheduleResponse | null>(null)
  const [error, setError] = useState('')
  const [selectedTask, setSelectedTask] = useState<MaintenanceUrgencyItem | null>(null)
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [approvedSchedule, setApprovedSchedule] = useState(false)

  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError('')

      const res = await fetch(`${API_BASE_URL}/ai/maintenance-urgency`)
      if (!res.ok) {
        throw new Error(`Failed to load urgency data (HTTP ${res.status})`)
      }
      const json: MaintenanceUrgencyResponse = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch urgency data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const handleScheduleByUrgency = async () => {
    try {
      setScheduling(true)
      setError('')
      const res = await fetch(`${API_BASE_URL}/ai/maintenance-urgency/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ human_approved: true }),
      })
      if (!res.ok) {
        throw new Error(`Scheduling failed (HTTP ${res.status})`)
      }
      const json: UrgencyScheduleResponse = await res.json()
      setScheduleResult(json)
      setApprovedSchedule(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scheduling failed')
    } finally {
      setScheduling(false)
    }
  }

  const filteredItems = useMemo(() => {
    if (!data) return []
    return data.items.filter((item) => {
      const matchesLevel =
        filterLevel === 'all' || item.urgency_level.toLowerCase() === filterLevel.toLowerCase()
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !query ||
        item.maintenance_type.toLowerCase().includes(query) ||
        (item.block_code && item.block_code.toLowerCase().includes(query)) ||
        (item.station_code && item.station_code.toLowerCase().includes(query)) ||
        item.department.toLowerCase().includes(query)
      return matchesLevel && matchesSearch
    })
  }, [data, filterLevel, searchQuery])

  const getUrgencyBadgeColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'critical':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          border: 'rgba(239, 68, 68, 0.4)',
          text: '#f87171',
          dot: '#ef4444',
        }
      case 'high':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          border: 'rgba(245, 158, 11, 0.4)',
          text: '#fbbf24',
          dot: '#f59e0b',
        }
      case 'medium':
        return {
          bg: 'rgba(59, 130, 246, 0.15)',
          border: 'rgba(59, 130, 246, 0.4)',
          text: '#60a5fa',
          dot: '#3b82f6',
        }
      default:
        return {
          bg: 'rgba(107, 114, 128, 0.15)',
          border: 'rgba(107, 114, 128, 0.4)',
          text: '#9ca3af',
          dot: '#6b7280',
        }
    }
  }

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'critical':
        return { bg: 'rgba(255, 85, 117, 0.12)', text: '#ff5575', border: 'rgba(255, 85, 117, 0.3)' }
      case 'high':
        return { bg: 'rgba(255, 154, 82, 0.12)', text: '#ff9a52', border: 'rgba(255, 154, 82, 0.3)' }
      case 'medium':
        return { bg: 'rgba(255, 194, 51, 0.12)', text: '#ffc233', border: 'rgba(255, 194, 51, 0.3)' }
      default:
        return { bg: 'rgba(127, 184, 207, 0.12)', text: '#7fb8cf', border: 'rgba(127, 184, 207, 0.3)' }
    }
  }

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* DECISION SUPPORT HERO BANNER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '18px 24px',
          borderRadius: '14px',
          background: 'var(--bg-card, #FFFFFF)',
          border: '1px solid var(--border-light, #D8E0E8)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: 'rgba(31, 95, 156, 0.08)',
              border: '1px solid rgba(31, 95, 156, 0.2)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--accent-blue, #1F5F9C)',
            }}
          >
            <Zap size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                Advanced Urgency-Aware Scheduling
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: 'rgba(9, 200, 255, 0.18)',
                  color: 'var(--accent-blue, #1F5F9C)',
                  border: '1px solid rgba(9, 200, 255, 0.3)',
                }}
              >
                OR-Tools CP-SAT
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #5B6773)' }}>
              Answers: <strong style={{ color: 'var(--accent-blue, #1F5F9C)' }}>&quot;How urgently should this maintenance be scheduled?&quot;</strong> by
              combining risk, priority, downstream dependency impact, deadlines, and traffic.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#fbbf24',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            <ShieldAlert size={15} />
            <span>Human Approval Required</span>
          </div>

          <button
            type="button"
            onClick={() => void fetchData(true)}
            disabled={refreshing}
            style={{
              height: '38px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-light, #D8E0E8)', background: 'var(--bg-card, #FFFFFF)', color: 'var(--text-primary, #172B3A)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <RefreshCw
              size={14}
              style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}
            />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void handleScheduleByUrgency()}
            disabled={scheduling || loading}
            style={{
              height: '38px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '0 18px',
              borderRadius: '8px',
              border: '1px solid #00c6ff',
              background: 'linear-gradient(180deg, #09c8ff 0%, #0284c7 100%)',
              color: 'var(--text-primary, #172B3A)',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 0 16px rgba(9, 200, 255, 0.35)',
            }}
          >
            {scheduling ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Optimizing CP-SAT...
              </>
            ) : (
              <>
                <Zap size={16} />
                Schedule by Urgency
              </>
            )}
          </button>
        </div>
      </div>

      {/* ERROR ALERT */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 18px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#dc2626',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchData(true)}
            className="btn-secondary-white"
            style={{ padding: '5px 12px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Retry
          </button>
        </div>
      )}

      {/* SUMMARY STAT CARDS */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
        }}
      >
        <StatCard
          label="TOTAL ACTIVE TASKS"
          value={data ? data.total_tasks : '—'}
          accent="#09c8ff"
          icon={<Wrench size={20} />}
        />
        <StatCard
          label="CRITICAL URGENCY"
          value={data ? data.critical_count : '—'}
          accent="#ef4444"
          icon={<Flame size={20} />}
          badge="Earliest Window"
        />
        <StatCard
          label="HIGH URGENCY"
          value={data ? data.high_count : '—'}
          accent="#f59e0b"
          icon={<Clock size={20} />}
          badge="Upcoming Safe"
        />
        <StatCard
          label="MEDIUM URGENCY"
          value={data ? data.medium_count : '—'}
          accent="#3b82f6"
          icon={<Layers size={20} />}
          badge="Off-Peak"
        />
        <StatCard
          label="LOW (DEFERRABLE)"
          value={data ? data.low_count : '—'}
          accent="#6b7280"
          icon={<CheckCircle2 size={20} />}
          badge="Routine"
        />
        <StatCard
          label="AVG URGENCY SCORE"
          value={data ? `${data.average_urgency_score}/100` : '—'}
          accent="#10b981"
          icon={<Activity size={20} />}
        />
      </div>

      {/* BEFORE / AFTER COMPARISON CARD (SHOWS REAL OPTIMIZER RESULTS) */}
      {scheduleResult && (
        <div
          style={{
            padding: '20px 24px',
            borderRadius: '14px',
            background: 'var(--bg-card, #FFFFFF)',
          border: '1px solid var(--border-light, #D8E0E8)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <div
                style={{
                  color: '#10b981',
                  fontSize: '11px',
                  fontWeight: 800,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}
              >
                OR-Tools CP-SAT Result
              </div>
              <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                Urgency-Aware Scheduling Optimization ({scheduleResult.optimization_status})
              </h3>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setApprovedSchedule(true)}
                disabled={approvedSchedule}
                style={{
                  height: '36px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  border: approvedSchedule ? '1px solid #10b981' : '1px solid rgba(16, 185, 129, 0.4)',
                  background: approvedSchedule
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'linear-gradient(180deg, #10b981 0%, #059669 100%)',
                  color: 'var(--text-primary, #172B3A)',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: approvedSchedule ? 'default' : 'pointer',
                }}
              >
                {approvedSchedule ? (
                  <>
                    <ShieldCheck size={16} />
                    Approved by Controller
                  </>
                ) : (
                  <>
                    <UserCheck size={16} />
                    Approve Schedule
                  </>
                )}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'var(--bg-card, #F8FAFC)', border: '1px solid var(--border-light, #D8E0E8)',
              }}
            >
              <div style={{ color: 'var(--text-secondary, #5B6773)', fontSize: '11px', fontWeight: 700 }}>
                CRITICAL TASKS EXPEDITED
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                {scheduleResult.comparison.critical_tasks_scheduled_earlier}
              </div>
              <div style={{ fontSize: '11px', color: '#68899a', marginTop: '2px' }}>
                Scheduled at earliest feasible window
              </div>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'var(--bg-card, #F8FAFC)', border: '1px solid var(--border-light, #D8E0E8)',
              }}
            >
              <div style={{ color: 'var(--text-secondary, #5B6773)', fontSize: '11px', fontWeight: 700 }}>
                AVG WAIT REDUCTION
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--accent-blue, #1F5F9C)', marginTop: '4px' }}>
                {scheduleResult.comparison.average_urgency_wait_reduction_minutes} min
              </div>
              <div style={{ fontSize: '11px', color: '#68899a', marginTop: '2px' }}>
                For Critical & High tasks
              </div>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'var(--bg-card, #F8FAFC)', border: '1px solid var(--border-light, #D8E0E8)',
              }}
            >
              <div style={{ color: 'var(--text-secondary, #5B6773)', fontSize: '11px', fontWeight: 700 }}>
                DEPENDENCY DELAYS PREVENTED
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>
                {scheduleResult.comparison.dependency_delays_prevented}
              </div>
              <div style={{ fontSize: '11px', color: '#68899a', marginTop: '2px' }}>
                Downstream tasks unblocked sooner
              </div>
            </div>

            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                background: 'var(--bg-card, #F8FAFC)', border: '1px solid var(--border-light, #D8E0E8)',
              }}
            >
              <div style={{ color: 'var(--text-secondary, #5B6773)', fontSize: '11px', fontWeight: 700 }}>
                DEADLINE VIOLATIONS PREVENTED
              </div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#a78bfa', marginTop: '4px' }}>
                {scheduleResult.comparison.deadline_violations_prevented}
              </div>
              <div style={{ fontSize: '11px', color: '#68899a', marginTop: '2px' }}>
                Due-by deadlines respected
              </div>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: '13px', color: '#172B3A', lineHeight: 1.5 }}>
            <strong>Why this plan?</strong> {scheduleResult.explanation}
          </p>
        </div>
      )}

      {/* TOOLBAR: FILTER & SEARCH */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#7ba0b8' }}>Filter Urgency:</span>
          {['all', 'critical', 'high', 'medium', 'low'].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setFilterLevel(level)}
              style={{
                padding: '6px 12px',
                borderRadius: '7px',
                fontSize: '11px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                cursor: 'pointer',
                border:
                  filterLevel === level
                    ? '1px solid #09c8ff'
                    : '1px solid rgba(75, 137, 172, 0.22)',
                background: filterLevel === level ? 'var(--accent-blue, #1F5F9C)' : 'var(--bg-card, #FFFFFF)',
                color: filterLevel === level ? '#FFFFFF' : 'var(--text-secondary, #5B6773)',
              }}
            >
              {level}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', minWidth: '260px' }}>
          <Search
            size={15}
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#62879c',
            }}
          />
          <input
            type="text"
            placeholder="Search task, block, department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              height: '36px',
              padding: '0 12px 0 34px',
              borderRadius: '8px',
              background: 'var(--bg-input, #FFFFFF)',
              color: 'var(--text-primary, #172B3A)',
              border: '1px solid var(--border-light, #D8E0E8)',
              fontSize: '12px',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* TASK PRIORITY & URGENCY TABLE */}
      <div
        style={{
          borderRadius: '13px',
          border: '1px solid var(--border-light, #D8E0E8)',
          background: 'var(--bg-card, #FFFFFF)',
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border-light, rgba(75, 137, 172, 0.15))',
                  background: 'var(--bg-surface, #F8FAFC)',
                }}
              >
                <th style={thStyle}>TASK & LOCATION</th>
                <th style={thStyle}>PRIORITY</th>
                <th style={thStyle}>RISK</th>
                <th style={thStyle}>ML CONFIDENCE</th>
                <th style={thStyle}>URGENCY SCORE</th>
                <th style={thStyle}>DEPENDENCY IMPACT</th>
                <th style={thStyle}>DEADLINE PRESSURE</th>
                <th style={thStyle}>RECOMMENDED WINDOW</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-secondary, #5B6773)' }}>
                    <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                    Evaluating multi-factor maintenance urgencies...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '36px', textAlign: 'center', color: '#68899a' }}>
                    <div>{error ? error : 'No maintenance tasks match the selected criteria.'}</div>
                    {error && (
                      <button
                        type="button"
                        onClick={() => void fetchData(true)}
                        className="btn-primary-railway"
                        style={{ marginTop: '10px', padding: '6px 14px', fontSize: '12px' }}
                      >
                        <RefreshCw size={13} />
                        Retry Loading Urgencies
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredItems.map((task) => {
                  const uColors = getUrgencyBadgeColor(task.urgency_level)
                  const pColors = getPriorityBadgeColor(task.priority)
                  const loc = task.location_type === 'block' ? task.block_code : task.station_code

                  return (
                    <tr
                      key={task.maintenance_id}
                      style={{
                        borderBottom: '1px solid rgba(75, 137, 172, 0.08)',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(9, 200, 255, 0.04)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {/* Task & Location */}
                      <td style={tdStyle}>
                        <div>
                          <strong style={{ color: 'var(--text-primary, #172B3A)', fontSize: '13px' }}>
                            {task.maintenance_type}
                          </strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 800,
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: 'rgba(255, 255, 255, 0.06)',
                                color: 'var(--accent-blue, #1F5F9C)',
                              }}
                            >
                              {loc || 'Network'}
                            </span>
                            <span style={{ fontSize: '11px', color: '#68899a' }}>
                              {task.department} • {task.crew_type}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Priority */}
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: pColors.bg,
                            color: pColors.text,
                            border: `1px solid ${pColors.border}`,
                          }}
                        >
                          {task.priority}
                        </span>
                      </td>

                      {/* Risk Score */}
                      <td style={tdStyle}>
                        <div style={{ display: 'grid', gap: '4px', minWidth: '70px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#dff5ff' }}>
                            {task.risk_score}
                            <span style={{ color: '#68899a', fontSize: '10px' }}>/100</span>
                          </span>
                          <div
                            style={{
                              width: '100%',
                              height: '4px',
                              borderRadius: '2px',
                              background: 'rgba(255, 255, 255, 0.08)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${task.risk_score}%`,
                                height: '100%',
                                background:
                                  task.risk_score >= 75
                                    ? '#ef4444'
                                    : task.risk_score >= 50
                                    ? '#f59e0b'
                                    : '#3b82f6',
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Model Confidence */}
                      <td style={tdStyle}>
                        {task.model_confidence !== null ? (
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: '#a78bfa',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Clock size={13} />
                            {task.model_confidence}%
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#587383' }}>—</span>
                        )}
                      </td>

                      {/* Urgency Score & Badge */}
                      <td style={tdStyle}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '4px 9px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 800,
                              background: uColors.bg,
                              color: uColors.text,
                              border: `1px solid ${uColors.border}`,
                            }}
                          >
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                background: uColors.dot,
                              }}
                            />
                            {task.urgency_level}
                          </span>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary, #172B3A)' }}>
                            {task.urgency_score}
                          </strong>
                        </div>
                      </td>

                      {/* Dependency Impact */}
                      <td style={tdStyle}>
                        {task.dependent_task_count > 0 ? (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 700,
                              color: '#fbbf24',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Layers size={13} />
                            Blocks {task.dependent_task_count} task(s)
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#68899a' }}>Independent</span>
                        )}
                      </td>

                      {/* Deadline Pressure */}
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: '11px',
                            color:
                              task.deadline_pressure === 'Overdue' ||
                              task.deadline_pressure === 'Urgent (<24h)'
                                ? '#f87171'
                                : task.deadline_pressure === 'Approaching (<72h)'
                                ? '#fbbf24'
                                : '#88a8bc',
                            fontWeight: task.deadline_pressure.includes('Urgent') ? 700 : 500,
                          }}
                        >
                          {task.deadline_status}
                        </span>
                      </td>

                      {/* Recommended Window */}
                      <td style={{ ...tdStyle, maxWidth: '240px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            color: task.urgency_level === 'Critical' ? '#09c8ff' : '#9bb5c4',
                            fontWeight: task.urgency_level === 'Critical' ? 700 : 500,
                          }}
                        >
                          {task.recommended_scheduling_window}
                        </span>
                      </td>

                      {/* Action */}
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => setSelectedTask(task)}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid rgba(9, 200, 255, 0.3)',
                            background: 'rgba(9, 200, 255, 0.08)',
                            color: 'var(--accent-blue, #1F5F9C)',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Why Urgent?
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* WHY URGENT MODAL */}
      {selectedTask && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              width: 'min(640px, 100%)',
              borderRadius: '16px',
              background: 'var(--bg-elevated, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
            }}
          >
            {/* MODAL HEADER */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '18px 22px',
                borderBottom: '1px solid var(--border-light, #E2E8F0)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    background: 'rgba(31, 106, 165, 0.08)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--accent-blue, #1F6AA5)',
                  }}
                >
                  <Zap size={20} />
                </div>
                <div>
                  <div style={{ color: 'var(--accent-blue, #1F6AA5)', fontSize: '10px', fontWeight: 800, letterSpacing: '1px' }}>
                    URGENCY EXPLANATION
                  </div>
                  <h3 style={{ margin: '2px 0 0', fontSize: '17px', color: 'var(--text-primary, #172B3A)' }}>
                    Why is this task urgent?
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '7px',
                  border: '1px solid var(--border-light, #D9E1E8)',
                  background: 'var(--bg-card, #FFFFFF)',
                  color: 'var(--text-secondary, #5B6B79)',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* MODAL CONTENT */}
            <div style={{ padding: '22px' }}>
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                  {selectedTask.maintenance_type} (ID #{selectedTask.maintenance_id})
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary, #5B6B79)', marginTop: '3px' }}>
                  Location: {selectedTask.block_code || selectedTask.station_code} • Department:{' '}
                  {selectedTask.department} • Priority: {selectedTask.priority}
                </div>
              </div>

              {/* FACTOR BREAKDOWN CARDS */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '10px',
                  marginBottom: '18px',
                }}
              >
                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>PRIORITY WEIGHT</div>
                  <div style={factorValueStyle}>+{selectedTask.factors.priority_weight} pts</div>
                  <div style={factorSubStyle}>Nominal {selectedTask.priority}</div>
                </div>

                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>RISK CONTRIBUTION</div>
                  <div style={factorValueStyle}>+{selectedTask.factors.risk_factor} pts</div>
                  <div style={factorSubStyle}>Risk: {selectedTask.risk_score}/100</div>
                </div>

                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>DEPENDENCY IMPACT</div>
                  <div style={factorValueStyle}>+{selectedTask.factors.dependency_impact} pts</div>
                  <div style={factorSubStyle}>Blocks {selectedTask.dependent_task_count} task(s)</div>
                </div>

                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>DEADLINE PRESSURE</div>
                  <div style={factorValueStyle}>+{selectedTask.factors.deadline_pressure} pts</div>
                  <div style={factorSubStyle}>{selectedTask.deadline_status}</div>
                </div>

                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>ROUTE TRAFFIC</div>
                  <div style={factorValueStyle}>+{selectedTask.factors.operational_impact} pts</div>
                  <div style={factorSubStyle}>{selectedTask.operational_impact}</div>
                </div>

                <div style={factorBoxStyle}>
                  <div style={factorLabelStyle}>TOTAL URGENCY</div>
                  <div style={{ ...factorValueStyle, color: 'var(--accent-blue, #1F6AA5)' }}>
                    {selectedTask.urgency_score}/100
                  </div>
                  <div style={factorSubStyle}>{selectedTask.urgency_level} level</div>
                </div>
              </div>

              {/* CONTRIBUTING FACTORS LIST */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  background: 'var(--bg-surface, #F8FAFC)',
                  border: '1px solid var(--border-light, #E2E8F0)',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 800,
                    color: '#1F6AA5',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    marginBottom: '8px',
                  }}
                >
                  Contributing Factors:
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px' }}>
                  {selectedTask.contributing_factors.map((f, i) => (
                    <li key={i} style={{ fontSize: '12px', color: '#172B3A' }}>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

              {/* EXPLANATION */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '9px',
                  background: '#F0F9FF',
                  border: '1px solid #BAE6FD',
                  fontSize: '12px',
                  color: '#172B3A',
                  lineHeight: 1.5,
                }}
              >
                <strong>Summary:</strong> {selectedTask.explanation}
              </div>
            </div>

            {/* MODAL FOOTER */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '14px 22px',
                borderTop: '1px solid #E2E8F0',
                background: 'var(--bg-elevated, #F8FAFC)',
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                style={{
                  padding: '7px 18px',
                  borderRadius: '7px',
                  border: '1px solid var(--border-light, #D8E0E8)', background: 'var(--bg-card, #FFFFFF)', color: 'var(--text-primary, #172B3A)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
  icon,
  badge,
}: {
  label: string
  value: string | number
  accent: string
  icon: React.ReactNode
  badge?: string
}) {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '12px',
        background: 'var(--bg-card, #FFFFFF)',
        border: '1px solid var(--border-light, #D9E1E8)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
      }}
    >
      <div
        style={{
          width: '42px',
          height: '42px',
          flex: '0 0 42px',
          borderRadius: '10px',
          background: `${accent}15`,
          border: `1px solid ${accent}30`,
          color: accent,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary, #5B6B79)', letterSpacing: '0.5px' }}>
          {label}
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', lineHeight: 1.2, marginTop: '2px' }}>
          {value}
        </div>
        {badge && (
          <div style={{ fontSize: '11px', fontWeight: 700, color: accent, marginTop: '2px' }}>
            {badge}
          </div>
        )}
      </div>
    </div>
  )
}

const thStyle: CSSProperties = {
  padding: '12px 14px',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text-secondary, #5B6B79)',
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
}

const tdStyle: CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
  fontSize: '12px',
}

const factorBoxStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: '8px',
  background: 'var(--bg-surface, #F8FAFC)',
  border: '1px solid var(--border-light, #E2E8F0)',
}

const factorLabelStyle: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: 'var(--text-secondary, #5B6B79)',
  letterSpacing: '0.5px',
}

const factorValueStyle: CSSProperties = {
  fontSize: '15px',
  fontWeight: 800,
  color: 'var(--text-primary, #172B3A)',
  marginTop: '3px',
}

const factorSubStyle: CSSProperties = {
  fontSize: '10px',
  color: 'var(--text-secondary, #5B6B79)',
  marginTop: '1px',
}
