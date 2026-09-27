import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  TrendingUp,
  UserCheck,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { API_BASE_URL } from '../../lib/api'
import { useIsDarkMode } from '../network/NetworkOverviewCard'

type Crew = {
  id: number
  name: string
  crew_type: string
  department: string
  capacity: number
  status: string
  current_workload: number
}

type CrewQueueTask = {
  task_id: number
  maintenance_type: string
  location_type: string
  location_code: string | null
  block_code: string | null
  station_code: string | null
  department: string
  crew_type: string
  crew_size: number
  required_crew_size: number
  assigned_crew_id: number | null
  assigned_crew_name: string | null
  available_capacity: number | null
  priority: string
  status: string
  queue_state: string
  position: number
  original_position: number
  optimized_position: number
  priority_override: boolean
  override_reason: string | null
  duration_minutes: number
  start_minute: number
  end_minute: number
  planned_start: string | null
  planned_end: string | null
  depends_on_maintenance_id: number | null
  depends_on: number[]
  blocked_tasks_unlocked: number[]
  dependent_task_count: number
  dependency_impact_score: number
  bundle_id: string | null
  bundle_role: string | null
  is_prerequisite: boolean
}

type QueueChange = {
  task_id: number
  task_name: string
  original_position: number
  optimized_position: number
  priority: string
  priority_override: boolean
  override_reason: string
  blocked_tasks_unlocked: number[]
}

type DependencyEffect = {
  task_id: number
  task_name: string
  unlocks_task_ids: number[]
  bundle_id: string | null
  impact_description: string
}

type CrewWorkloadSummary = {
  total_assigned_tasks: number
  total_duration_minutes: number
  active_tasks: number
  queued_tasks: number
  critical_tasks: number
  reprioritized_tasks: number
}

type CrewQueueResponse = {
  crew_id: number
  crew_name: string
  crew_type: string
  department: string
  capacity: number
  current_status: string
  current_workload: number
  workload: CrewWorkloadSummary
  original_queue: CrewQueueTask[]
  optimized_queue: CrewQueueTask[]
  changes: QueueChange[]
  dependency_effects: DependencyEffect[]
  optimization_status: string
  explanation: string
  human_approval_required: boolean
  decision_support_note: string
}

interface DynamicCrewQueueSectionProps {
  onQueueApplied?: () => void
}

export default function DynamicCrewQueueSection({
  onQueueApplied,
}: DynamicCrewQueueSectionProps) {
  const isDark = useIsDarkMode()
  const [crews, setCrews] = useState<Crew[]>([])
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null)
  const [queueData, setQueueData] = useState<CrewQueueResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Apply Modal state
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [reviewerName, setReviewerName] = useState('')
  const [reviewerNotes, setReviewerNotes] = useState('')
  const [applying, setApplying] = useState(false)
  const [applySuccessMessage, setApplySuccessMessage] = useState('')
  const [applyError, setApplyError] = useState('')

  // 1. Fetch available crews on mount
  useEffect(() => {
    async function loadCrews() {
      try {
        setLoading(true)
        setError('')
        const res = await fetch(`${API_BASE_URL}/ai/crew-queues`)
        if (!res.ok) {
          throw new Error(`Failed to fetch crew queues (${res.status})`)
        }
        const data: CrewQueueResponse[] = await res.json()
        const crewList: Crew[] = data.map((d) => ({
          id: d.crew_id,
          name: d.crew_name,
          crew_type: d.crew_type,
          department: d.department,
          capacity: d.capacity,
          status: d.current_status,
          current_workload: d.current_workload,
        }))
        setCrews(crewList)

        // Default to Electrical Team B or the first crew
        const defaultCrew =
          crewList.find((c) => c.name.toLowerCase().includes('electrical team b')) ||
          crewList[0]
        if (defaultCrew) {
          setSelectedCrewId(defaultCrew.id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading crews.')
      } finally {
        setLoading(false)
      }
    }
    void loadCrews()
  }, [])

  // 2. Fetch queue data when selected crew changes
  const loadQueueForCrew = useCallback(
    async (crewId: number, isRefresh = false) => {
      try {
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
        setError('')
        setApplySuccessMessage('')
        const res = await fetch(`${API_BASE_URL}/ai/crew-queues/${crewId}`)
        if (!res.ok) {
          throw new Error(`Failed to fetch crew queue (${res.status})`)
        }
        const data: CrewQueueResponse = await res.json()
        setQueueData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading crew queue.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (selectedCrewId) {
      void loadQueueForCrew(selectedCrewId)
    }
  }, [selectedCrewId, loadQueueForCrew])

  // 3. Handle applying the optimized queue with human approval
  const handleApplyQueue = async () => {
    if (!queueData || !selectedCrewId) return
    if (!reviewerName.trim()) {
      setApplyError('Please enter authorized controller name for approval.')
      return
    }

    try {
      setApplying(true)
      setApplyError('')
      const payload = {
        crew_id: selectedCrewId,
        task_positions: queueData.optimized_queue.map((t) => ({
          task_id: t.task_id,
          queue_position: t.optimized_position,
          planned_start: t.planned_start,
          planned_end: t.planned_end,
        })),
        approved_by: reviewerName.trim(),
        notes: reviewerNotes.trim() || undefined,
      }

      const res = await fetch(`${API_BASE_URL}/ai/crew-queues/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.detail || 'Failed to apply optimized queue.')
      }

      setApplySuccessMessage(result.message)
      setShowApplyModal(false)
      setReviewerName('')
      setReviewerNotes('')

      // Reload queue to reflect persisted queue positions
      await loadQueueForCrew(selectedCrewId, true)
      if (onQueueApplied) {
        onQueueApplied()
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply queue.')
    } finally {
      setApplying(false)
    }
  }

  const selectedCrew = crews.find((c) => c.id === selectedCrewId)

  // Filter tasks by categorized states for distinct panels
  const reprioritizedTasks =
    queueData?.optimized_queue.filter((t) => t.priority_override) || []
  const waitingTasks =
    queueData?.optimized_queue.filter(
      (t) => t.queue_state === 'Waiting for Dependency' || t.depends_on_maintenance_id,
    ) || []
  const queuedTasks =
    queueData?.optimized_queue.filter((t) => !t.priority_override) || []

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* 1. HEADER & CONTROLS (WHITE CARD) */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: '18px 22px',
          borderRadius: '12px',
          background: 'var(--bg-card, #FFFFFF)',
          border: '1px solid var(--border-light, #D9E1E8)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(31, 106, 165, 0.1)',
              border: '1px solid rgba(31, 106, 165, 0.25)',
              display: 'grid',
              placeItems: 'center',
              color: '#1F6AA5',
            }}
          >
            <Workflow size={22} />
          </div>
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: 800,
                color: 'var(--text-primary, #172B3A)',
                letterSpacing: '-0.3px',
              }}
            >
              Dynamic Crew Priority & Work Queue
            </h2>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: '13px',
                color: 'var(--text-secondary, #5B6B79)',
              }}
            >
              Temporarily reprioritizes critical prerequisites while preserving existing scheduled jobs.
            </p>
          </div>
        </div>

        {/* Crew Selector & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary, #5B6B79)', fontWeight: 700 }}>
              Select Crew:
            </span>
            <select
              value={selectedCrewId || ''}
              onChange={(e) => setSelectedCrewId(Number(e.target.value))}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input, #FFFFFF)',
                border: '1px solid #D9E1E8',
                color: 'var(--text-primary, #172B3A)',
                fontSize: '13px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.department} • Cap: {c.capacity})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => selectedCrewId && void loadQueueForCrew(selectedCrewId, true)}
            disabled={refreshing || loading}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              background: 'var(--bg-modal, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
              color: 'var(--text-primary, #172B3A)',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: refreshing ? 'spin 1s linear infinite' : undefined,
              }}
            />
            Re-Optimize
          </button>

          <button
            type="button"
            onClick={() => {
              setApplyError('')
              setShowApplyModal(true)
            }}
            disabled={!queueData || queueData.optimized_queue.length === 0}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              background: '#1F6AA5',
              border: '1px solid #1F6AA5',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 3px rgba(31, 106, 165, 0.2)',
            }}
          >
            <UserCheck size={16} />
            Review & Apply Queue
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {applySuccessMessage && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
            borderRadius: '8px',
            background: '#F0FDF4',
            border: '1px solid #BBF7D0',
            color: '#166534',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <CheckCircle2 size={18} />
          {applySuccessMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 18px',
            borderRadius: '8px',
            background: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
            border: isDark ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid #FECACA',
            color: isDark ? '#F87171' : '#991B1B',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {/* 2. CREW STATUS & WORKLOAD SUMMARY (4 WHITE CARDS) */}
      {selectedCrew && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          <div style={statCardStyle}>
            <div style={statIconStyle('#10B981')}>
              <Users size={18} />
            </div>
            <div>
              <div style={statLabelStyle}>CREW STATUS</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#10B981', marginTop: '2px' }}>
                {selectedCrew.status}
              </div>
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statIconStyle('#8B5CF6')}>
              <Layers size={18} />
            </div>
            <div>
              <div style={statLabelStyle}>CAPACITY</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', marginTop: '2px' }}>
                {selectedCrew.capacity} personnel
              </div>
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statIconStyle('#F59E0B')}>
              <Clock size={18} />
            </div>
            <div>
              <div style={statLabelStyle}>CURRENT WORKLOAD</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', marginTop: '2px' }}>
                {queueData?.workload.total_duration_minutes || selectedCrew.current_workload || 0} min
              </div>
            </div>
          </div>

          <div style={statCardStyle}>
            <div style={statIconStyle('#DC2626')}>
              <Zap size={18} />
            </div>
            <div>
              <div style={statLabelStyle}>REPRIORITIZED TASKS</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#DC2626', marginTop: '2px' }}>
                {queueData?.workload.reprioritized_tasks || 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. OPERATOR REVIEW REQUIRED BANNER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '12px 18px',
          borderRadius: '10px',
          background: isDark ? 'rgba(217, 119, 6, 0.12)' : '#FFFBEB',
          border: isDark ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #FDE68A',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <UserCheck size={20} color={isDark ? '#FBBF24' : '#D97706'} />
          <div>
            <strong style={{ fontSize: '13px', color: isDark ? '#FDE68A' : '#92400E' }}>
              Optimized Queue Plan — Operator Review Required
            </strong>
            <span style={{ display: 'block', fontSize: '12px', color: isDark ? '#FCD34D' : '#78350F' }}>
              Authorized railway section personnel remain responsible for reviewing and confirming schedule adjustments.
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            padding: '4px 10px',
            borderRadius: '6px',
            background: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7',
            color: isDark ? '#FDE68A' : '#B45309',
            border: isDark ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #FCD34D',
          }}
        >
          Decision-Support Prototype
        </span>
      </div>

      {/* 4. "WHY WAS THIS TASK MOVED?" EXPLANATION CALLOUT */}
      {queueData && queueData.changes.length > 0 && (
        <div
          style={{
            padding: '18px 22px',
            borderRadius: '12px',
            background: 'var(--bg-card, #151719)',
            border: '1px solid var(--border-light, #2A2D32)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Workflow size={18} color="#1F6AA5" />
            <strong style={{ fontSize: '15px', color: 'var(--text-primary, #F5F5F5)', letterSpacing: '-0.2px' }}>
              Why was this queue reprioritized?
            </strong>
          </div>
          <div style={{ display: 'grid', gap: '10px' }}>
            {queueData.changes.map((ch) => (
              <div
                key={ch.task_id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: ch.priority_override
                    ? (isDark ? 'rgba(220, 38, 38, 0.15)' : '#FEF2F2')
                    : (isDark ? 'var(--bg-subtle, #16181B)' : '#F8FAFC'),
                  border: ch.priority_override
                    ? (isDark ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid #FECACA')
                    : (isDark ? '1px solid var(--border-light, #2A2D32)' : '1px solid #E2E8F0'),
                }}
              >
                <div
                  style={{
                    padding: '4px 8px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: 800,
                    background: ch.priority_override ? '#DC2626' : '#1F6AA5',
                    color: '#FFFFFF',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Pos {ch.original_position} → {ch.optimized_position}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)' }}>
                      {ch.task_name}
                    </strong>
                    {ch.priority_override && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: isDark ? 'rgba(239, 68, 68, 0.22)' : '#FEE2E2',
                          color: isDark ? '#FCA5A5' : '#DC2626',
                          border: isDark ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #FCA5A5',
                        }}
                      >
                        🔴 PRIORITY OVERRIDE
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.4 }}>
                    {ch.override_reason}
                  </p>
                  {ch.blocked_tasks_unlocked.length > 0 && (
                    <div
                      style={{
                        marginTop: '6px',
                        fontSize: '11px',
                        color: isDark ? '#34D399' : '#059669',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontWeight: 700,
                      }}
                    >
                      <CheckCircle2 size={13} />
                      {ch.blocked_tasks_unlocked.length} dependent task(s) will be unlocked
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. QUEUE COMPARISON: BEFORE vs AFTER (BOTH WHITE CARDS) */}
      {queueData && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
            gap: '18px',
          }}
        >
          {/* ORIGINAL QUEUE (BEFORE) - WHITE CARD */}
          <div
            style={{
              padding: '20px 22px',
              borderRadius: '12px',
              background: 'var(--bg-modal, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={panelHeaderStyle}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary, #5B6B79)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  BEFORE
                </span>
                <h3 style={{ margin: '2px 0 0', fontSize: '16px', color: 'var(--text-primary, #172B3A)', fontWeight: 800 }}>
                  Original Queue Order
                </h3>
              </div>
              <span style={badgeStyle('#64748b')}>
                {queueData.original_queue.length} tasks
              </span>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              {queueData.original_queue.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#8292A1', fontSize: '13px' }}>
                  No pending tasks in original queue.
                </div>
              ) : (
                queueData.original_queue.map((task) => (
                  <div
                    key={task.task_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      background: 'var(--bg-table-row, #F8FAFC)',
                      border: '1px solid var(--border-light, #E2E8F0)',
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: 'var(--bg-card, #E2E8F0)',
                        border: '1px solid var(--border-light, #CBD5E1)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: '13px',
                        fontWeight: 800,
                        color: '#475569',
                      }}
                    >
                      {task.original_position}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong
                          style={{
                            fontSize: '13px',
                            color: 'var(--text-primary, #172B3A)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {task.maintenance_type}
                        </strong>
                        <span style={getPriorityBadgeStyle(task.priority)}>
                          {task.priority}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', marginTop: '3px' }}>
                        {task.location_code ? `${task.location_type.toUpperCase()}: ${task.location_code}` : 'Network'} • {task.duration_minutes} min
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* OPTIMIZED QUEUE (AFTER) */}
          <div
            style={{
              padding: '20px 22px',
              borderRadius: '12px',
              background: 'var(--bg-elevated, #1B1D20)',
              border: isDark ? '2px solid rgba(56, 189, 248, 0.4)' : '2px solid var(--accent-blue, #1F6AA5)',
              boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.4)' : '0 2px 8px rgba(31, 106, 165, 0.1)',
            }}
          >
            <div style={panelHeaderStyle}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: isDark ? '#38BDF8' : '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  AFTER (OR-TOOLS CP-SAT)
                </span>
                <h3 style={{ margin: '2px 0 0', fontSize: '16px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 800 }}>
                  Optimized Work Queue
                </h3>
              </div>
              <span style={badgeStyle('#1F6AA5')}>
                {queueData.optimization_status}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '8px' }}>
              {queueData.optimized_queue.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#8292A1', fontSize: '13px' }}>
                  No tasks to schedule.
                </div>
              ) : (
                queueData.optimized_queue.map((task) => {
                  const hasOverride = task.priority_override
                  return (
                    <div
                      key={task.task_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        background: hasOverride
                          ? (isDark ? 'rgba(220, 38, 38, 0.15)' : '#FEF2F2')
                          : (isDark ? 'var(--bg-table-row, #16181B)' : '#F8FAFC'),
                        border: hasOverride
                          ? (isDark ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid #FECACA')
                          : (isDark ? '1px solid var(--border-light, #2A2D32)' : '1px solid #E2E8F0'),
                      }}
                    >
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          background: hasOverride ? '#DC2626' : '#1F6AA5',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '13px',
                          fontWeight: 800,
                          color: '#FFFFFF',
                        }}
                      >
                        {task.optimized_position}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)' }}>
                            {task.maintenance_type}
                          </strong>
                          <span style={getPriorityBadgeStyle(task.priority, isDark)}>
                            {task.priority}
                          </span>
                          {hasOverride && (
                            <span
                              style={{
                                fontSize: '10px',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: isDark ? 'rgba(239, 68, 68, 0.22)' : '#FEE2E2',
                                color: isDark ? '#FCA5A5' : '#DC2626',
                                border: isDark ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #FCA5A5',
                              }}
                            >
                              PRIORITY OVERRIDE
                            </span>
                          )}
                          {task.original_position !== task.optimized_position && (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', fontWeight: 600 }}>
                              (was #{task.original_position})
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            fontSize: '11px',
                            color: 'var(--text-secondary, #B9BDC4)',
                            marginTop: '3px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontWeight: 600, color: isDark ? '#38BDF8' : '#1F6AA5' }}>
                            {task.location_code ? `${task.location_type.toUpperCase()}: ${task.location_code}` : 'Network'}
                          </span>
                          <span>•</span>
                          <span>{task.duration_minutes} min</span>
                          {task.bundle_id && (
                            <>
                              <span>•</span>
                              <span style={{ color: '#0284C7', fontWeight: 700 }}>
                                <Boxes size={11} style={{ display: 'inline', marginRight: '3px' }} />
                                {task.bundle_id}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. OPERATIONAL WORK QUEUE STATES (WHITE CARD & WHITE STATE CARDS) */}
      {queueData && queueData.optimized_queue.length > 0 && (
        <div
          style={{
            padding: '20px 22px',
            borderRadius: '12px',
            background: 'var(--bg-card, #FFFFFF)',
            border: '1px solid var(--border-light, #D9E1E8)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              OPERATIONAL WORK QUEUE STATES
            </span>
            <h3 style={{ margin: '3px 0 0', fontSize: '16px', color: 'var(--text-primary, #172B3A)', fontWeight: 800 }}>
              Active, Waiting & Queued Tasks Breakdown
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            {/* Current Task */}
            <div style={taskStateCardStyle(isDark ? 'rgba(2, 132, 199, 0.12)' : '#F0F9FF', isDark ? 'rgba(56, 189, 248, 0.35)' : '#BAE6FD')}>
              <div style={taskStateHeaderStyle(isDark ? '#38BDF8' : '#0369A1')}>
                <span>CURRENT TASK</span>
                <span style={badgeStyle(isDark ? '#38BDF8' : '#0369A1')}>Pos #1</span>
              </div>
              {queueData.optimized_queue[0] ? (
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)', display: 'block' }}>
                    {queueData.optimized_queue[0].maintenance_type}
                  </strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '4px' }}>
                    {queueData.optimized_queue[0].location_code || 'Network'} • {queueData.optimized_queue[0].duration_minutes} min
                  </div>
                  {queueData.optimized_queue[0].priority_override && (
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: '6px',
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: isDark ? 'rgba(239, 68, 68, 0.22)' : '#FEE2E2',
                        color: isDark ? '#FCA5A5' : '#DC2626',
                        border: isDark ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #FECACA',
                      }}
                    >
                      🔴 PRIORITY OVERRIDE
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#8292A1' }}>No current task</div>
              )}
            </div>

            {/* Next Task */}
            <div style={taskStateCardStyle(isDark ? 'var(--bg-card, #151719)' : '#F8FAFC', isDark ? 'var(--border-light, #2A2D32)' : '#E2E8F0')}>
              <div style={taskStateHeaderStyle(isDark ? '#38BDF8' : '#1F6AA5')}>
                <span>NEXT TASK</span>
                <span style={badgeStyle(isDark ? '#38BDF8' : '#1F6AA5')}>Pos #2</span>
              </div>
              {queueData.optimized_queue.length > 1 ? (
                <div>
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)', display: 'block' }}>
                    {queueData.optimized_queue[1].maintenance_type}
                  </strong>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '4px' }}>
                    {queueData.optimized_queue[1].location_code || 'Network'} • {queueData.optimized_queue[1].duration_minutes} min
                  </div>
                  <span style={{ ...getPriorityBadgeStyle(queueData.optimized_queue[1].priority, isDark), marginTop: '6px', display: 'inline-block' }}>
                    {queueData.optimized_queue[1].priority}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#8292A1' }}>No queued next task</div>
              )}
            </div>

            {/* Reprioritized Tasks */}
            <div style={taskStateCardStyle(isDark ? 'rgba(220, 38, 38, 0.12)' : '#FEF2F2', isDark ? 'rgba(248, 113, 113, 0.35)' : '#FECACA')}>
              <div style={taskStateHeaderStyle(isDark ? '#F87171' : '#DC2626')}>
                <span>REPRIORITIZED</span>
                <span style={badgeStyle(isDark ? '#F87171' : '#DC2626')}>{reprioritizedTasks.length}</span>
              </div>
              {reprioritizedTasks.length > 0 ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {reprioritizedTasks.map((t) => (
                    <div key={t.task_id} style={{ fontSize: '12px' }}>
                      <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{t.maintenance_type}</strong>
                      <span style={{ color: isDark ? '#FCA5A5' : '#DC2626', display: 'block', fontSize: '11px', marginTop: '2px' }}>
                        Pos #{t.original_position} → #{t.optimized_position} (Urgent Prerequisite)
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#8292A1' }}>No reprioritized tasks</div>
              )}
            </div>

            {/* Waiting for Dependency */}
            <div style={taskStateCardStyle(isDark ? 'rgba(217, 119, 6, 0.12)' : '#FFFBEB', isDark ? 'rgba(245, 158, 11, 0.35)' : '#FDE68A')}>
              <div style={taskStateHeaderStyle(isDark ? '#FBBF24' : '#D97706')}>
                <span>WAITING FOR DEPENDENCY</span>
                <span style={badgeStyle(isDark ? '#FBBF24' : '#D97706')}>{waitingTasks.length}</span>
              </div>
              {waitingTasks.length > 0 ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {waitingTasks.map((t) => (
                    <div key={t.task_id} style={{ fontSize: '12px' }}>
                      <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{t.maintenance_type}</strong>
                      <span style={{ color: isDark ? '#FDE68A' : '#B45309', display: 'block', fontSize: '11px', marginTop: '2px' }}>
                        Waits for Task #{t.depends_on_maintenance_id}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#8292A1' }}>No blocked dependencies</div>
              )}
            </div>

            {/* Queued Work */}
            <div style={taskStateCardStyle(isDark ? 'var(--bg-card, #151719)' : '#F8FAFC', isDark ? 'var(--border-light, #2A2D32)' : '#E2E8F0')}>
              <div style={taskStateHeaderStyle(isDark ? '#94A3B8' : '#475569')}>
                <span>QUEUED (RESUMES WORK)</span>
                <span style={badgeStyle(isDark ? '#94A3B8' : '#475569')}>{queuedTasks.length}</span>
              </div>
              {queuedTasks.length > 0 ? (
                <div style={{ display: 'grid', gap: '6px' }}>
                  {queuedTasks.slice(0, 3).map((t) => (
                    <div key={t.task_id} style={{ fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-primary, #F5F5F5)' }}>#{t.optimized_position}: {t.maintenance_type}</span>
                    </div>
                  ))}
                  {queuedTasks.length > 3 && (
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>
                      +{queuedTasks.length - 3} more queued
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#8292A1' }}>No queued tasks</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 7. CONNECTION TO BUNDLING & PREDICTIVE MAINTENANCE */}
      {queueData && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {/* Bundling Link Card */}
          <div
            style={{
              padding: '18px 20px',
              borderRadius: '12px',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <Boxes size={18} color="#1F6AA5" />
              <strong style={{ fontSize: '14px', color: 'var(--text-primary, #F5F5F5)' }}>
                Multi-Department Bundling Link
              </strong>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.5 }}>
              This work queue coordinates with multi-department bundles on shared block closures. Prerequisite tasks are
              prioritized first to unlock subsequent department workloads.
            </p>
          </div>

          {/* Predictive Maintenance Link Card */}
          <div
            style={{
              padding: '18px 20px',
              borderRadius: '12px',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
              <TrendingUp size={18} color="#10B981" />
              <strong style={{ fontSize: '14px', color: 'var(--text-primary, #F5F5F5)' }}>
                Predictive Maintenance Telemetry
              </strong>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.5 }}>
              High-risk failure predictions from the telemetry pipeline are automatically flagged with critical priority,
              triggering automatic queue front-loading.
            </p>
          </div>
        </div>
      )}

      {/* 8. APPLY MODAL (WHITE CARD) */}
      {showApplyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '520px',
              borderRadius: '12px',
              background: 'var(--bg-modal, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-light, #E2E8F0)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={18} color="#1F6AA5" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#172B3A' }}>
                  Authorize Work Queue Reprioritization
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary, #5B6B79)',
                  cursor: 'pointer',
                  fontSize: '16px',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #5B6B79)', lineHeight: 1.5 }}>
                You are about to commit the optimized queue sequence for <strong>{selectedCrew?.name}</strong> to live
                operational records.
              </p>

              {applyError && (
                <div style={{ padding: '10px 14px', borderRadius: '6px', background: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2', border: isDark ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid #FECACA', color: isDark ? '#F87171' : '#991B1B', fontSize: '12px' }}>
                  {applyError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-primary, #172B3A)', marginBottom: '6px' }}>
                  Authorized Controller / Station Master Name *
                </label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="e.g. S. Ramanathan, Chief Controller"
                  style={{
                    width: '100%',
                    height: '38px',
                    padding: '0 12px',
                    borderRadius: '7px',
                    background: 'var(--bg-input, #FFFFFF)',
                    border: '1px solid var(--border-light, #D9E1E8)',
                    color: 'var(--text-primary, #172B3A)',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-primary, #172B3A)', marginBottom: '6px' }}>
                  Operational Instructions / Notes
                </label>
                <textarea
                  value={reviewerNotes}
                  onChange={(e) => setReviewerNotes(e.target.value)}
                  placeholder="e.g. Approved with priority for electrical overhead inspection."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '7px',
                    background: 'var(--bg-input, #FFFFFF)',
                    border: '1px solid var(--border-light, #D9E1E8)',
                    color: 'var(--text-primary, #172B3A)',
                    fontSize: '12px',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                padding: '14px 20px',
                background: 'var(--bg-elevated, #F8FAFC)',
                borderTop: '1px solid var(--border-light, #E2E8F0)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '7px',
                  background: 'var(--bg-card, #FFFFFF)',
                  border: '1px solid var(--border-light, #D9E1E8)',
                  color: 'var(--text-secondary, #5B6B79)',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyQueue}
                disabled={applying}
                style={{
                  padding: '8px 18px',
                  borderRadius: '7px',
                  background: '#1F6AA5',
                  border: '1px solid #1F6AA5',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm & Apply Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// STYLES & HELPERS (CLEAN WHITE ENTERPRISE STYLE)
// ------------------------------------------------------------

const statCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  padding: '16px 18px',
  borderRadius: '10px',
  background: 'var(--bg-card, #FFFFFF)',
  border: '1px solid var(--border-light, #D9E1E8)',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
}

function statIconStyle(accent: string): CSSProperties {
  return {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    display: 'grid',
    placeItems: 'center',
    color: accent,
    background: `${accent}15`,
    border: `1px solid ${accent}30`,
  }
}

const statLabelStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text-secondary, #5B6B79)',
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
}

const panelHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '16px',
}

function badgeStyle(accent: string): CSSProperties {
  return {
    fontSize: '11px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.7px',
    padding: '3px 8px',
    borderRadius: '5px',
    background: `${accent}15`,
    color: accent,
    border: `1px solid ${accent}35`,
  }
}

function getPriorityBadgeStyle(priority: string, isDark: boolean = false): CSSProperties {
  switch (priority.toLowerCase()) {
    case 'critical':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 7px',
        borderRadius: '4px',
        background: isDark ? 'rgba(239, 68, 68, 0.2)' : '#FEE2E2',
        color: isDark ? '#FCA5A5' : '#DC2626',
        border: isDark ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid #FECACA',
      }
    case 'high':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 7px',
        borderRadius: '4px',
        background: isDark ? 'rgba(245, 158, 11, 0.2)' : '#FEF3C7',
        color: isDark ? '#FDE68A' : '#D97706',
        border: isDark ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid #FDE68A',
      }
    case 'medium':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 7px',
        borderRadius: '4px',
        background: isDark ? 'rgba(2, 132, 199, 0.2)' : '#E0F2FE',
        color: isDark ? '#7DD3FC' : '#0284C7',
        border: isDark ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid #BAE6FD',
      }
    default:
      return {
        fontSize: '10px',
        fontWeight: 700,
        padding: '2px 7px',
        borderRadius: '4px',
        background: isDark ? 'rgba(148, 163, 184, 0.15)' : 'var(--bg-elevated, #F1F5F9)',
        color: isDark ? '#CBD5E1' : 'var(--text-secondary, #475569)',
        border: isDark ? '1px solid rgba(148, 163, 184, 0.35)' : '1px solid var(--border-light, #E2E8F0)',
      }
  }
}

function taskStateCardStyle(bg: string, border: string): CSSProperties {
  return {
    padding: '14px 16px',
    borderRadius: '10px',
    background: bg,
    border: `1px solid ${border}`,
  }
}

function taskStateHeaderStyle(accent: string): CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    fontSize: '11px',
    fontWeight: 800,
    color: accent,
    letterSpacing: '0.6px',
  }
}
