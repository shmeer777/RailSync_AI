/**
 * Maintenance Planning, Urgency, and Impact Analysis Service for RailSync AI.
 * Communicates with backend endpoints on http://127.0.0.1:8001/ai
 */

import { API_BASE_URL } from '../lib/api'

// --- URGENCY SCHEMAS ---

export interface UrgencyFactors {
  priority_weight: number
  risk_factor: number
  dependency_impact: number
  deadline_pressure: number
  operational_impact: number
  duration_penalty: number
}

export interface MaintenanceUrgencyItem {
  maintenance_id: number
  location_type: string
  block_code: string | null
  station_code: string | null
  maintenance_type: string
  department: string
  crew_type: string
  priority: string
  risk_score: number
  urgency_score: number
  urgency_level: 'Critical' | 'High' | 'Medium' | 'Low'
  dependent_task_count: number
  blocked_task_ids: number[]
  deadline: string | null
  deadline_status: string
  recommended_scheduling_window: string
  factors: UrgencyFactors
  explanation: string
}

export interface MaintenanceUrgencyResponse {
  total_tasks: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  average_urgency_score?: number
  items: MaintenanceUrgencyItem[]
  decision_support_note: string
}

// --- IMPACT SCHEMAS ---

export interface BlockImpact {
  block_code: string
  block_name: string
  distance_km: number
  start_station_code: string
  end_station_code: string
  restriction_start: string | null
  restriction_end: string | null
  duration_minutes: number
}

export interface TrainImpact {
  total_conflicts: number
  affected_trains_count: number
  trains: Array<{
    train_id?: number
    train_number?: string
    name?: string
    priority?: string
    eta_minute?: number
    depart_minute?: number
    conflict_severity?: string
    recommendation?: string
  }>
}

export interface CrewImpact {
  total_crews_involved: number
  crews: Array<{
    crew_id?: number | null
    name: string
    department: string
    crew_type: string
    capacity: number
    tasks_assigned_count: number
  }>
  departments: string[]
}

export interface DependencyImpact {
  has_prerequisites: boolean
  prerequisite_tasks_count: number
  prerequisite_task_ids: number[]
  blocks_downstream: boolean
  downstream_tasks_count: number
  downstream_task_ids: number[]
  dependency_notes: string[]
}

export interface AssetAvailabilityImpact {
  total_network_assets: number
  restricted_assets: number
  available_assets: number
  availability_percentage: number
  baseline_availability_percentage: number
  availability_delta: number
}

export interface TrafficImpact {
  overall_traffic_level: string
  total_traffic_score: number
  slot_traffic: number[]
  peak_slot_index: number
}

export interface MaintenanceImpactResponse {
  target_type: 'task' | 'bundle'
  target_id: string
  block_code: string
  maintenance_types: string[]
  window_start: string | null
  window_end: string | null
  duration_minutes: number
  block_impact: BlockImpact
  train_impact: TrainImpact
  crew_impact: CrewImpact
  dependency_impact: DependencyImpact
  asset_impact: AssetAvailabilityImpact
  traffic_impact: TrafficImpact
  explanation: string
  human_approval_required: boolean
  decision_support_note: string
}

// --- PLANNING SCHEMAS ---

export interface PlannedMaintenanceItem {
  task_id: number
  block_code: string
  block_name: string
  maintenance_type: string
  department: string
  crew_id: number | null
  crew_name: string
  priority: string
  urgency_score: number
  urgency_level: string
  duration_minutes: number
  planned_start: string
  planned_end: string
  day_index: number
  date_str: string
  bundle_id: string | null
  is_bundle_leader: boolean
  train_conflicts: number
}

export interface PlanDaySummary {
  date_str: string
  day_name: string
  day_index: number
  tasks_count: number
  total_window_minutes: number
  restricted_blocks: string[]
  available_assets: number
  restricted_assets: number
  availability_percentage: number
  train_conflicts: number
  traffic_level: string
  tasks: PlannedMaintenanceItem[]
}

export interface CrewWorkloadItem {
  crew_id: number | null
  crew_name: string
  department: string
  capacity: number
  total_tasks_assigned: number
  total_hours_allocated: number
  daily_allocations: Record<string, number>
}

export interface MaintenancePlanResponse {
  plan_id: string
  horizon: 'week' | 'month'
  start_date: string
  end_date: string
  total_tasks_planned: number
  days: PlanDaySummary[]
  crew_workloads: CrewWorkloadItem[]
  optimization_status: string
  average_availability_percentage: number
  total_train_conflicts: number
  explanation: string
  human_approval_required: boolean
  decision_support_note: string
}

export interface MaintenancePlanOptimizeRequest {
  horizon: 'week' | 'month'
  start_date?: string | null
  target_departments?: string[] | null
  target_blocks?: string[] | null
}

export interface MaintenancePlanApplyRequest {
  plan_id: string
  human_approved: boolean
  approved_by?: string
  notes?: string | null
}

export interface MaintenancePlanApplyResponse {
  message: string
  plan_id: string
  applied_tasks_count: number
  applied_at: string
  approved_by: string
}

// --- API METHODS ---

export async function fetchMaintenanceUrgency(
  forceRefresh: boolean = false,
  timeoutMs: number = 30000
): Promise<MaintenanceUrgencyResponse> {
  const url = `${API_BASE_URL}/ai/maintenance-urgency${forceRefresh ? '?force_refresh=true' : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(errorData.detail || `Failed to fetch maintenance urgency analysis (${res.status})`)
    }
    return res.json()
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(
        'Urgency evaluation timed out. The multi-factor evaluation is taking longer than expected. Please retry calculation.'
      )
    }
    throw err
  }
}

export async function fetchTaskUrgency(maintenanceId: number): Promise<MaintenanceUrgencyItem> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-urgency/${maintenanceId}`)
  if (!res.ok) throw new Error(`Failed to fetch urgency for task #${maintenanceId}`)
  return res.json()
}

export async function fetchTaskImpact(maintenanceId: number): Promise<MaintenanceImpactResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-impact/${maintenanceId}`)
  if (!res.ok) throw new Error(`Failed to fetch impact for task #${maintenanceId}`)
  return res.json()
}

export async function fetchBundleImpact(bundleId: string): Promise<MaintenanceImpactResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-impact/bundle/${bundleId}`)
  if (!res.ok) throw new Error(`Failed to fetch impact for bundle ${bundleId}`)
  return res.json()
}

export async function fetchMaintenancePlan(
  horizon: 'week' | 'month' = 'week',
  startDate?: string | null,
  forceRefresh: boolean = false,
  init?: RequestInit,
  timeoutMs: number = 35000
): Promise<MaintenancePlanResponse> {
  const params = new URLSearchParams({ horizon })
  if (startDate) params.set('start_date', startDate)
  if (forceRefresh) params.set('force_refresh', 'true')

  const url = `${API_BASE_URL}/ai/maintenance-plan?${params.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...init,
      signal: init?.signal || controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(
        errorData.detail || `Failed to fetch maintenance plan (${res.status})`
      )
    }

    return res.json()
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(
        'Optimization request timed out. The OR-Tools CP-SAT multi-day solver is taking longer than expected. Please retry calculation.'
      )
    }
    throw err
  }
}

export async function optimizeMaintenancePlan(
  payload: MaintenancePlanOptimizeRequest,
  init?: RequestInit,
  timeoutMs: number = 40000
): Promise<MaintenancePlanResponse> {
  const url = `${API_BASE_URL}/ai/maintenance-plan/optimize`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      ...init,
      signal: init?.signal || controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      throw new Error(
        errorData.detail || `Failed to optimize multi-day maintenance plan (${res.status})`
      )
    }

    return res.json()
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(
        'Optimization request timed out. The OR-Tools CP-SAT multi-day solver is taking longer than expected. Please retry calculation.'
      )
    }
    throw err
  }
}

export async function applyMaintenancePlan(
  payload: MaintenancePlanApplyRequest
): Promise<MaintenancePlanApplyResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-plan/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'Failed to apply maintenance plan.')
  }
  return res.json()
}
