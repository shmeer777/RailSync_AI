/**
 * Maintenance Bundles Service for RailSync AI.
 * Communicates with backend endpoints on http://127.0.0.1:8001
 */

import { API_BASE_URL } from '../lib/api'

export interface BundleTask {
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
}

export interface MaintenanceBundle {
  bundle_id: string
  block_code: string
  block_name: string
  total_tasks: number
  departments: string[]
  crews: string[]
  planning_window?: string
  start_time: string
  end_time: string
  earliest_feasible_start?: string
  latest_allowed_end?: string
  total_window_minutes: number
  unbundled_total_minutes: number
  time_saved_minutes: number
  percent_time_saved: number
  block_closures_avoided?: number
  train_conflicts_before?: number
  train_conflicts_after?: number
  traffic_level?: string
  traffic_score?: number
  optimization_status: string
  tasks: BundleTask[]
  incompatible_tasks?: {
    task_id: number
    maintenance_type: string
    department: string
    reason: string
  }[]
  sequential_tasks: number[]
  parallel_tasks: number[]
  dependencies: { parent_id: number; dependent_id: number }[]
  explanation: string
  human_approval_required: boolean
  decision_support_note: string
}

export interface BundleApiResponse {
  total_bundles: number
  bundles: MaintenanceBundle[]
  message?: string
}

export async function fetchMaintenanceBundles(
  blockCode?: string,
  windowPreference: string = 'night'
): Promise<BundleApiResponse> {
  const url = new URL(`${API_BASE_URL}/maintenance/bundles`)
  if (blockCode && blockCode !== 'ALL') {
    url.searchParams.set('block_code', blockCode)
  }
  if (windowPreference) {
    url.searchParams.set('window_preference', windowPreference)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Failed to fetch maintenance bundles: ${res.statusText} (${res.status})`)
  }
  return res.json()
}

export async function optimizeMaintenanceBundles(
  blockCode?: string,
  windowPreference: string = 'night'
): Promise<BundleApiResponse> {
  const url = new URL(`${API_BASE_URL}/maintenance/bundles/optimize`)
  if (blockCode && blockCode !== 'ALL') {
    url.searchParams.set('block_code', blockCode)
  }
  if (windowPreference) {
    url.searchParams.set('window_preference', windowPreference)
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Optimization failed: ${res.statusText} (${res.status})`)
  }
  return res.json()
}

export async function fetchAIMaintenanceBundles(
  blockCode?: string,
  windowPreference: string = 'night'
): Promise<BundleApiResponse> {
  const url = new URL(`${API_BASE_URL}/ai/maintenance-bundles`)
  if (blockCode && blockCode !== 'ALL') {
    url.searchParams.set('block_code', blockCode)
  }
  if (windowPreference) {
    url.searchParams.set('window_preference', windowPreference)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Failed to fetch AI bundles: ${res.statusText} (${res.status})`)
  }
  return res.json()
}
