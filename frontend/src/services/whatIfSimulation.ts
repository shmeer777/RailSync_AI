/**
 * What-If Maintenance Simulation Service for RailSync AI.
 * Communicates with backend endpoints on http://127.0.0.1:8001/ai/maintenance-what-if
 */

import { API_BASE_URL } from '../lib/api'

export interface TaskOverride {
  task_id: number
  delay_minutes?: number | null
  duration_minutes?: number | null
  crew_id?: number | null
  priority?: string | null
  bundled?: boolean | null
}

export interface WhatIfScenarioRequest {
  block_code: string
  name?: string
  start_time?: string | null
  planning_window?: string | null
  task_overrides?: TaskOverride[]
  traffic_assumptions?: Record<string, any> | null
}

export interface WhatIfApplyRequest {
  block_code: string
  scenario_id: string
  human_approved: boolean
  approved_by?: string
  notes?: string | null
}

export interface WhatIfApplyResponse {
  message: string
  block_code: string
  scenario_id: string
  human_approved: boolean
  approved_by: string
  applied_at: string
  updated_records_count: number
}

export interface PlanMetrics {
  start_time: string | null
  end_time: string | null
  total_window_minutes: number
  unbundled_total_minutes: number
  time_saved_minutes: number
  percent_time_saved: number
  train_conflicts: number
  train_conflicts_before: number
  block_closures: number
  bundle_count: number
  departments: string[]
  crews: string[]
  tasks: Array<{
    id: number
    maintenance_type: string
    department: string
    crew_type: string
    crew_size: number
    required_crew_size?: number
    assigned_crew_id?: number | null
    assigned_crew_name?: string
    assigned_crew_type?: string
    available_capacity?: number
    priority: string
    status: string
    duration_minutes: number
    start_minute: number
    end_minute: number
    planned_start: string
    planned_end: string
    execution_mode: string
    sequence_order: number
    original_position?: number
    optimized_position?: number
    priority_override?: boolean
    override_reason?: string | null
    depends_on_maintenance_id: number | null
    depends_on?: number[]
    precedes?: number[]
    overlaps_with?: number[]
    bundle_role: string
    is_parallel: boolean
  }>
  optimization_status: string
}

export interface ImpactMetrics {
  time_difference_minutes: number
  conflict_difference: number
  block_closure_difference: number
  bundle_difference: number
  crew_changes: Array<{
    task_id: number
    maintenance_type: string
    baseline_crew: string
    what_if_crew: string
  }>
  task_timing_changes: Array<{
    task_id: number
    maintenance_type: string
    baseline_start: string
    baseline_end: string
    what_if_start: string
    what_if_end: string
    duration_change_minutes: number
  }>
  task_order_changes: Array<{
    task_id: number
    maintenance_type: string
    baseline_position: number
    what_if_position: number
  }>
  dependency_status: string
  traffic_level_change: string
}

export interface WhatIfScenarioResponse {
  scenario_id: string
  name: string
  block_code: string
  block_name: string
  optimization_status: string
  feasible: boolean
  explanation: string
  infeasibility_reason?: string | null
  baseline: PlanMetrics
  what_if?: PlanMetrics | null
  impact?: ImpactMetrics | null
  human_approval_required: boolean
  decision_support_note: string
}

/**
 * Executes a What-If Maintenance Simulation without mutating live database records.
 */
export async function simulateWhatIfScenario(
  payload: WhatIfScenarioRequest
): Promise<WhatIfScenarioResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-what-if`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(
      errData.detail || `Simulation failed: ${res.statusText} (${res.status})`
    )
  }

  const data: WhatIfScenarioResponse = await res.json()
  saveScenarioHistory(data)
  return data
}

/**
 * Applies a verified What-If scenario to the live schedule. Requires explicit human approval.
 */
export async function applySimulatedPlan(
  payload: WhatIfApplyRequest
): Promise<WhatIfApplyResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-what-if/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(
      errData.detail || `Apply plan failed: ${res.statusText} (${res.status})`
    )
  }

  return res.json()
}

const STORAGE_KEY = 'railsync_what_if_scenarios'

/**
 * Saves a simulation result to local storage for quick recall.
 */
export function saveScenarioHistory(scenario: WhatIfScenarioResponse): void {
  try {
    const existing = getScenarioHistory()
    const filtered = existing.filter((s) => s.scenario_id !== scenario.scenario_id)
    const updated = [scenario, ...filtered].slice(0, 8)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch (err) {
    console.warn('Unable to persist scenario history to localStorage', err)
  }
}

/**
 * Retrieves past simulated scenarios from local storage.
 */
export function getScenarioHistory(): WhatIfScenarioResponse[] {
  try {
    const item = localStorage.getItem(STORAGE_KEY)
    return item ? JSON.parse(item) : []
  } catch {
    return []
  }
}

/**
 * Clears saved simulation history.
 */
export function clearScenarioHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore
  }
}
