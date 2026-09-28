import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
  Wrench,
  Zap,
} from 'lucide-react'

import {
  applyMaintenancePlan,
  fetchMaintenancePlan,
  optimizeMaintenancePlan,
  type MaintenancePlanResponse,
  type PlannedMaintenanceItem,
} from '../../services/maintenancePlanning'
import MaintenanceImpactModal from './MaintenanceImpactModal'

interface MaintenancePlanningSectionProps {
  onPlanApplied?: () => void
}

export default function MaintenancePlanningSection({
  onPlanApplied,
}: MaintenancePlanningSectionProps) {
  const [horizon, setHorizon] = useState<'week' | 'month'>('week')
  const [startDate, setStartDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [selectedDept, setSelectedDept] = useState<string>('all')
  const [selectedPriority, setSelectedPriority] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const [plan, setPlan] = useState<MaintenancePlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inspection modal
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  // Approval modal
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [reviewerName, setReviewerName] = useState('Chief Section Controller')
  const [applyNotes, setApplyNotes] = useState('')
  const [applying, setApplying] = useState(false)
  const [applySuccess, setApplySuccess] = useState<string | null>(null)

  const loadPlan = useCallback(async (isRefresh = false) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    try {
      if (isRefresh) setOptimizing(true);
      else setLoading(true);
      setError(null);
      setApplySuccess(null);

      const res = await fetchMaintenancePlan(horizon, startDate, { signal: controller.signal });
      setPlan(res);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out while fetching maintenance plan.');
      } else {
        setError(err.message || 'Failed to load maintenance plan.');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setOptimizing(false);
    }
  }, [horizon, startDate])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  const handleReoptimize = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
    try {
      setOptimizing(true);
      setError(null);
      setApplySuccess(null);

      const payload = {
        horizon,
        start_date: startDate,
        target_departments: selectedDept !== 'all' ? [selectedDept] : null,
      };
      const res = await optimizeMaintenancePlan(payload, { signal: controller.signal });
      setPlan(res);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out while optimizing maintenance plan.');
      } else {
        setError(err.message || 'Failed to optimize maintenance plan.');
      }
    } finally {
      clearTimeout(timeoutId);
      setOptimizing(false);
    }
  }

  const handleApplyApprovedPlan = async () => {
    if (!plan) return
    try {
      setApplying(true)
      setError(null)

      const res = await applyMaintenancePlan({
        plan_id: plan.plan_id,
        human_approved: true,
        approved_by: reviewerName,
        notes: applyNotes || undefined,
      })

      setApplySuccess(res.message)
      setShowApplyModal(false)
      onPlanApplied?.()
      await loadPlan(true)
    } catch (err: any) {
      setError(err.message || 'Failed to apply maintenance plan.')
    } finally {
      setApplying(false)
    }
  }

  // Filter tasks based on department, priority, search
  const filterTask = useCallback((t: PlannedMaintenanceItem) => {
    if (selectedDept !== 'all' && t.department.toLowerCase() !== selectedDept.toLowerCase()) return false
    if (selectedPriority !== 'all' && t.priority.toLowerCase() !== selectedPriority.toLowerCase()) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const match =
        t.maintenance_type.toLowerCase().includes(q) ||
        t.block_code.toLowerCase().includes(q) ||
        t.block_name.toLowerCase().includes(q) ||
        t.department.toLowerCase().includes(q) ||
        t.crew_name.toLowerCase().includes(q)
      if (!match) return false
    }
    return true
  }, [selectedDept, selectedPriority, searchQuery])

  // Extract all scheduled tasks across days
  const allScheduledTasks = useMemo(() => {
    if (!plan?.days) return []
    const list: PlannedMaintenanceItem[] = []
    plan.days.forEach((day) => {
      day.tasks.forEach((task) => list.push(task))
    })
    return list
  }, [plan])

  // 8 Planning Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalTasks = plan?.total_tasks_planned ?? allScheduledTasks.length
    const scheduled = allScheduledTasks.length
    const unscheduled = Math.max(0, totalTasks - scheduled)

    const criticalTasks = allScheduledTasks.filter(
      (t) => t.priority.toLowerCase() === 'critical' || t.urgency_level?.toLowerCase() === 'critical'
    ).length

    const highPriorityTasks = allScheduledTasks.filter(
      (t) => t.priority.toLowerCase() === 'high' || t.urgency_level?.toLowerCase() === 'high'
    ).length

    const totalMinutes = allScheduledTasks.reduce((acc, t) => acc + (t.duration_minutes || 0), 0)
    const plannedHours = (totalMinutes / 60).toFixed(1)

    // Total crew personnel capacity
    const totalCrewCapacity = plan?.crew_workloads
      ? plan.crew_workloads.reduce((acc, c) => acc + (c.capacity || 4), 0)
      : 17

    const networkImpact = `${plan?.average_availability_percentage ?? 98.1}% Avail`

    return {
      totalTasks,
      scheduled,
      unscheduled,
      criticalTasks,
      highPriorityTasks,
      plannedHours,
      totalCrewCapacity,
      networkImpact,
    }
  }, [plan, allScheduledTasks])

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          background: 'var(--bg-card, #FFFFFF)',
          borderRadius: '12px',
          border: '1px solid var(--border-light, #D9E1E8)',
          color: 'var(--text-secondary, #5B6B79)',
          gap: '12px',
        }}
      >
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#1F6AA5' }} />
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #172B3A)' }}>
          Generating Multi-Day Maintenance Schedule via OR-Tools CP-SAT...
        </span>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error && !plan) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          background: 'var(--bg-card, #FFFFFF)',
          borderRadius: '12px',
          border: '1px solid #FECACA',
          color: '#DC2626',
          gap: '14px',
          textAlign: 'center',
        }}
      >
        <AlertTriangle size={36} color="#DC2626" />
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: '#991B1B' }}>
            Unable to Generate Maintenance Schedule
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#B91C1C', maxWidth: '520px' }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPlan()}
          className="btn-primary-railway"
          style={{ padding: '8px 18px', fontSize: '13px' }}
        >
          <RefreshCw size={14} />
          Retry Schedule Optimization
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. HEADER & DECISION SUPPORT BANNER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          padding: '18px 22px',
          borderRadius: '12px',
          background: 'var(--bg-card, #FFFFFF)',
          border: '1px solid #D9E1E8',
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
            <Calendar size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                Weekly / Monthly Planning
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  background: 'rgba(31, 106, 165, 0.1)',
                  color: '#1F6AA5',
                  border: '1px solid rgba(31, 106, 165, 0.25)',
                }}
              >
                Solver: {plan?.optimization_status || 'OPTIMAL'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary, #5B6B79)' }}>
              Plan maintenance schedules across weekly and monthly planning horizons.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setShowApplyModal(true)}
            style={{
              height: '38px',
              padding: '0 18px',
              borderRadius: '8px',
              background: '#10B981',
              border: '1px solid #059669',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 1px 3px rgba(16, 185, 129, 0.2)',
            }}
          >
            <CheckCircle2 size={16} />
            Apply Approved Plan
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {applySuccess && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '8px',
            background: '#F0FDF4',
            border: '1px solid #BBF7D0',
            color: '#166534',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 600,
          }}
        >
          <CheckCircle2 size={16} />
          {applySuccess}
        </div>
      )}
      {error && (
        <div
          style={{
            padding: '12px 18px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(248, 113, 113, 0.35)',
            color: '#F87171',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontWeight: 600,
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* 2. CONTROLS: HORIZON TOGGLE, DATE SELECTOR & FILTERS */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          padding: '16px 20px',
          borderRadius: '12px',
          background: 'var(--bg-card, #151719)',
          border: '1px solid var(--border-light, #2A2D32)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* PLANNING HORIZON TOGGLE */}
          <div
            style={{
              display: 'flex',
              borderRadius: '8px',
              background: 'var(--bg-subtle, #16181B)',
              padding: '3px',
              border: '1px solid var(--border-light, #2A2D32)',
            }}
          >
            <button
              type="button"
              onClick={() => setHorizon('week')}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                border: 'none',
                background: horizon === 'week' ? '#1F6AA5' : 'transparent',
                color: horizon === 'week' ? '#FFFFFF' : '#5B6B79',
                fontSize: '12px',
                fontWeight: 750,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Weekly (7 Days)
            </button>
            <button
              type="button"
              onClick={() => setHorizon('month')}
              style={{
                padding: '7px 16px',
                borderRadius: '6px',
                border: 'none',
                background: horizon === 'month' ? '#1F6AA5' : 'transparent',
                color: horizon === 'month' ? '#FFFFFF' : '#5B6B79',
                fontSize: '12px',
                fontWeight: 750,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Monthly (30 Days)
            </button>
          </div>

          {/* DATE PICKER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #5B6B79)', fontWeight: 600 }}>Start Date:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                height: '36px',
                padding: '0 10px',
                borderRadius: '7px',
                background: 'var(--bg-input, #FFFFFF)',
                border: '1px solid var(--border-light, #D9E1E8)',
                color: 'var(--text-primary, #172B3A)',
                fontSize: '12px',
                fontWeight: 600,
                outline: 'none',
              }}
            />
          </div>

          {/* DEPARTMENT FILTER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} style={{ color: 'var(--text-secondary, #5B6B79)' }} />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              style={{
                height: '36px',
                padding: '0 10px',
                borderRadius: '7px',
                background: 'var(--bg-input, #FFFFFF)',
                border: '1px solid var(--border-light, #D9E1E8)',
                color: 'var(--text-primary, #172B3A)',
                fontSize: '12px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Departments</option>
              <option value="Engineering">Engineering</option>
              <option value="Electrical">Electrical</option>
              <option value="S&T">S&T (Signals)</option>
              <option value="Mechanical">Mechanical</option>
            </select>
          </div>

          {/* PRIORITY FILTER */}
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            style={{
              height: '36px',
              padding: '0 10px',
              borderRadius: '7px',
              background: 'var(--bg-input, #FFFFFF)',
              border: '1px solid #D9E1E8',
              color: 'var(--text-primary, #172B3A)',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>

        {/* SEARCH AND REFRESH BUTTON */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary, #5B6B79)' }} />
            <input
              type="text"
              placeholder="Search task, block..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                height: '36px',
                padding: '0 10px 0 32px',
                borderRadius: '7px',
                background: 'var(--bg-input, #FFFFFF)',
                border: '1px solid var(--border-light, #D9E1E8)',
                color: 'var(--text-primary, #172B3A)',
                fontSize: '12px',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="button"
            onClick={handleReoptimize}
            disabled={optimizing}
            style={{
              height: '36px',
              padding: '0 16px',
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
              opacity: optimizing ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: optimizing ? 'spin 1s linear infinite' : undefined }} />
            {optimizing ? 'Generating...' : 'Generate / Refresh Plan'}
          </button>
        </div>
      </div>

      {/* 3. PLANNING SUMMARY (8 WHITE CARDS) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '12px',
        }}
      >
        <SummaryTile
          label="Total Tasks"
          value={summaryMetrics.totalTasks}
          subtext="Maintenance scope"
          accent="#1F6AA5"
          icon={<Wrench size={18} />}
        />
        <SummaryTile
          label="Scheduled Tasks"
          value={summaryMetrics.scheduled}
          subtext="Allocated in horizon"
          accent="#10B981"
          icon={<CheckCircle2 size={18} />}
        />
        <SummaryTile
          label="Unscheduled Tasks"
          value={summaryMetrics.unscheduled}
          subtext={summaryMetrics.unscheduled === 0 ? 'All scheduled' : 'Pending slots'}
          accent={summaryMetrics.unscheduled > 0 ? '#DC2626' : '#5B6B79'}
          icon={<Clock size={18} />}
        />
        <SummaryTile
          label="Critical Tasks"
          value={summaryMetrics.criticalTasks}
          subtext="Earliest slots"
          accent="#DC2626"
          icon={<ShieldAlert size={18} />}
        />
        <SummaryTile
          label="High Priority Tasks"
          value={summaryMetrics.highPriorityTasks}
          subtext="Pre-empted window"
          accent="#D97706"
          icon={<Zap size={18} />}
        />
        <SummaryTile
          label="Planned Hours"
          value={`${summaryMetrics.plannedHours}h`}
          subtext="Corridor occupancy"
          accent="#0284C7"
          icon={<Clock size={18} />}
        />
        <SummaryTile
          label="Crew Capacity"
          value={`${summaryMetrics.totalCrewCapacity} staff`}
          subtext="Active departments"
          accent="#8B5CF6"
          icon={<Users size={18} />}
        />
        <SummaryTile
          label="Network Impact"
          value={summaryMetrics.networkImpact}
          subtext={`${plan?.total_train_conflicts ?? 0} train conflicts`}
          accent="#059669"
          icon={<TrendingUp size={18} />}
        />
      </div>

      {/* 4. PLANNING CALENDAR / TIMELINE (LIGHT / WHITE) */}
      <div
        style={{
          borderRadius: '12px',
          background: 'var(--bg-card, #FFFFFF)',
          border: '1px solid var(--border-light, #D9E1E8)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          padding: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            marginBottom: '18px',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
              {horizon === 'week' ? 'Weekly Timeline' : 'Monthly Horizon Overview'}
            </div>
            <h3 style={{ margin: '3px 0 0', fontSize: '16px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
              {horizon === 'week' ? '7-Day Weekly Maintenance Schedule' : '30-Day Monthly Maintenance Schedule'}
            </h3>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary, #5B6B79)' }}>
            Click any task card to inspect <strong>Maintenance Impact Analysis</strong>
          </div>
        </div>

        {/* WEEK VIEW: MONDAY - SUNDAY OR CONSECUTIVE 7 DAYS */}
        {horizon === 'week' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
            }}
          >
            {plan?.days.map((day) => {
              const filteredTasks = day.tasks.filter(filterTask)
              const hasTasks = filteredTasks.length > 0

              return (
                <div
                  key={day.date_str}
                  style={{
                    borderRadius: '10px',
                    background: 'var(--bg-table-row, #F8FAFC)',
                    border: hasTasks ? '1px solid var(--accent-blue, #CBD5E1)' : '1px solid var(--border-light, #E2E8F0)',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    minHeight: '280px',
                  }}
                >
                  {/* DAY HEADER */}
                  <div style={{ borderBottom: '1px solid #E2E8F0', paddingBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: '14px', color: 'var(--text-primary, #172B3A)', fontWeight: 800 }}>
                        {day.day_name}
                      </strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', fontWeight: 600 }}>
                        {day.date_str}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: '#DEF7EC',
                          color: '#03543F',
                        }}
                      >
                        {day.availability_percentage}% Avail
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', fontWeight: 600 }}>
                        {day.tasks_count} tasks • {day.total_window_minutes}m
                      </span>
                    </div>
                  </div>

                  {/* TASKS IN THIS DAY */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    {filteredTasks.map((t) => (
                      <TaskCard
                        key={t.task_id}
                        task={t}
                        onClick={() => setSelectedTaskId(t.task_id)}
                      />
                    ))}

                    {!hasTasks && (
                      <div
                        style={{
                          flex: 1,
                          display: 'grid',
                          placeItems: 'center',
                          padding: '24px 10px',
                          color: '#8292A1',
                          fontSize: '11.5px',
                          textAlign: 'center',
                          border: '1px dashed #CBD5E1',
                          borderRadius: '8px',
                          background: 'var(--bg-card, #FFFFFF)',
                        }}
                      >
                        <span>No maintenance scheduled</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* MONTH VIEW: 30-DAY MONTH-BASED PLANNING OVERVIEW */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '12px',
              }}
            >
              {plan?.days.map((day) => {
                const filteredTasks = day.tasks.filter(filterTask)
                const hasTasks = filteredTasks.length > 0

                return (
                  <div
                    key={day.date_str}
                    style={{
                      borderRadius: '10px',
                      background: hasTasks ? 'var(--bg-card, #FFFFFF)' : 'var(--bg-table-row, #F8FAFC)',
                      border: hasTasks ? '1px solid #1F6AA5' : '1px solid #E2E8F0',
                      boxShadow: hasTasks ? '0 1px 4px rgba(31, 106, 165, 0.08)' : 'none',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: '13px', color: 'var(--text-primary, #172B3A)' }}>
                          {day.day_name.slice(0, 3)}, {day.date_str}
                        </strong>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: hasTasks ? 'rgba(31, 106, 165, 0.1)' : '#F1F5F9',
                          color: hasTasks ? '#1F6AA5' : '#5B6B79',
                        }}
                      >
                        {day.tasks_count} tasks
                      </span>
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)' }}>
                      Window: {day.total_window_minutes} min • {day.availability_percentage}% Network Open
                    </div>

                    {hasTasks ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                        {filteredTasks.map((t) => (
                          <div
                            key={t.task_id}
                            onClick={() => setSelectedTaskId(t.task_id)}
                            style={{
                              padding: '8px 10px',
                              borderRadius: '6px',
                              background: 'var(--bg-table-row, #F8FAFC)',
                              border: '1px solid var(--border-light, #E2E8F0)',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '11.5px',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--text-primary, #172B3A)', display: 'block' }}>{t.maintenance_type}</strong>
                              <span style={{ color: '#1F6AA5', fontWeight: 600 }}>{t.block_code}</span> • <span style={{ color: 'var(--text-secondary, #5B6B79)' }}>{t.crew_name}</span>
                            </div>
                            <span style={getPriorityBadgeStyle(t.priority)}>{t.priority}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: '#8292A1', padding: '6px 0' }}>
                        Clear corridor — 100% throughput
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 5. CREW CAPACITY & WORKLOAD DISTRIBUTION (WHITE CARD) */}
      {plan?.crew_workloads && plan.crew_workloads.length > 0 && (
        <div
          style={{
            borderRadius: '12px',
            background: 'var(--bg-card, #FFFFFF)',
            border: '1px solid var(--border-light, #D9E1E8)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            padding: '20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Users size={18} color="#1F6AA5" />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
              Crew Workload & Department Allocation
            </h3>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            {plan.crew_workloads.map((cw, i) => (
              <div
                key={cw.crew_id ?? i}
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: 'var(--bg-elevated, #F8FAFC)',
                  border: '1px solid var(--border-light, #E2E8F0)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: 'var(--text-primary, #172B3A)' }}>{cw.crew_name}</strong>
                    <div style={{ fontSize: '11px', color: '#1F6AA5', fontWeight: 600 }}>{cw.department}</div>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: '#EBF3FA',
                      color: '#1F6AA5',
                    }}
                  >
                    Cap: {cw.capacity}
                  </span>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary, #5B6B79)' }}>
                  <span>Tasks: <strong>{cw.total_tasks_assigned}</strong></span>
                  <span>Hours: <strong>{cw.total_hours_allocated}h</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. INSPECTION MODAL (MAINTENANCE IMPACT) */}
      {selectedTaskId && (
        <MaintenanceImpactModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {/* 7. APPROVAL MODAL */}
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
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserCheck size={18} color="#10B981" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                  Confirm & Apply Maintenance Plan
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
                You are about to commit the <strong>{horizon === 'week' ? '7-Day Weekly' : '30-Day Monthly'}</strong> plan
                containing <strong>{plan?.total_tasks_planned} maintenance tasks</strong> to operational railway dispatch records.
              </p>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-primary, #172B3A)', marginBottom: '6px' }}>
                  Approving Section Controller Name
                </label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
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
                  Operational Notes & Corridor Instructions
                </label>
                <textarea
                  value={applyNotes}
                  onChange={(e) => setApplyNotes(e.target.value)}
                  placeholder="e.g. Approved with speed restrictions on GNT-BZA corridor."
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
                onClick={handleApplyApprovedPlan}
                disabled={applying}
                style={{
                  padding: '8px 18px',
                  borderRadius: '7px',
                  background: '#10B981',
                  border: '1px solid #059669',
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
                Confirm & Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  subtext,
  accent,
  icon,
}: {
  label: string
  value: string | number
  subtext: string
  accent: string
  icon: React.ReactNode
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: '10px',
        background: 'var(--bg-card, #FFFFFF)',
        border: '1px solid var(--border-light, #D9E1E8)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '8px',
          background: `${accent}15`,
          color: accent,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', marginTop: '2px' }}>{value}</div>
        <div style={{ fontSize: '10px', color: '#8292A1', marginTop: '1px' }}>{subtext}</div>
      </div>
    </div>
  )
}

function TaskCard({
  task,
  onClick,
}: {
  task: PlannedMaintenanceItem
  onClick: () => void
}) {
  const formatHour = (isoStr: string) => {
    try {
      const d = new Date(isoStr)
      if (isNaN(d.getTime())) return isoStr
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    } catch {
      return isoStr
    }
  }

  const deptBadgeStyle = (dept: string) => {
    switch (dept.toLowerCase()) {
      case 'electrical':
        return { background: '#E0F2FE', color: '#0369A1' }
      case 's&t':
        return { background: '#F3E8FF', color: '#7E22CE' }
      case 'mechanical':
        return { background: '#FEF3C7', color: '#B45309' }
      default:
        return { background: '#E0E7FF', color: '#3730A3' }
    }
  }

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px',
        borderRadius: '8px',
        background: 'var(--bg-card, #FFFFFF)',
        border: '1px solid var(--border-light, #D9E1E8)',
        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#1F6AA5'
        e.currentTarget.style.boxShadow = '0 2px 6px rgba(31, 106, 165, 0.12)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#D9E1E8'
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
        <strong style={{ fontSize: '13px', color: 'var(--text-primary, #172B3A)', fontWeight: 700, lineHeight: 1.3 }}>
          {task.maintenance_type}
        </strong>
        <span style={getPriorityBadgeStyle(task.priority)}>{task.priority}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11px' }}>
        <span style={{ fontWeight: 700, color: '#1F6AA5' }}>{task.block_code}</span>
        <span style={{ color: '#8292A1' }}>•</span>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: '4px',
            ...deptBadgeStyle(task.department),
          }}
        >
          {task.department}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', marginTop: '2px' }}>
        <span>👤 {task.crew_name || 'Unassigned'}</span>
        <span>{task.duration_minutes}m</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px', color: '#1F6AA5', fontWeight: 600, borderTop: '1px dashed #E2E8F0', paddingTop: '5px', marginTop: '2px' }}>
        <span>🕒 {formatHour(task.planned_start)}–{formatHour(task.planned_end)}</span>
        <span style={{ color: '#059669', fontWeight: 700 }}>Scheduled</span>
      </div>
    </div>
  )
}

function getPriorityBadgeStyle(priority: string): CSSProperties {
  switch (priority.toLowerCase()) {
    case 'critical':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 6px',
        borderRadius: '4px',
        background: '#FEE2E2',
        color: '#DC2626',
        border: '1px solid #FECACA',
      }
    case 'high':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 6px',
        borderRadius: '4px',
        background: '#FEF3C7',
        color: '#D97706',
        border: '1px solid #FDE68A',
      }
    case 'medium':
      return {
        fontSize: '10px',
        fontWeight: 800,
        padding: '2px 6px',
        borderRadius: '4px',
        background: '#E0F2FE',
        color: '#0284C7',
        border: '1px solid #BAE6FD',
      }
    default:
      return {
        fontSize: '10px',
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: '4px',
        background: 'var(--bg-elevated, #F1F5F9)',
        color: 'var(--text-secondary, #475569)',
        border: '1px solid var(--border-light, #E2E8F0)',
      }
  }
}
