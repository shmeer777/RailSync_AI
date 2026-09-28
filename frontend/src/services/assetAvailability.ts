/**
 * Asset Availability Optimization Service for RailSync AI.
 * Communicates with backend endpoints on http://127.0.0.1:8001/ai/asset-availability
 */

import { API_BASE_URL } from '../lib/api'

export interface RestrictedBlockInfo {
  block_code: string
  block_name: string
  start_time: string | null
  end_time: string | null
  start_minute: number
  end_minute: number
  duration_minutes: number
  maintenance_tasks_count: number
  departments: string[]
  crews: string[]
  route_criticality: number
  train_conflicts: number
  tasks: Array<Record<string, any>>
}

export interface TimeSlotAvailability {
  slot_index: number
  time_label: string
  start_minute: number
  end_minute: number
  total_assets: number
  available_assets: number
  restricted_assets: number
  availability_percentage: number
  restricted_blocks: string[]
  is_peak: boolean
  is_bottleneck: boolean
}

export interface AvailabilityMetrics {
  total_assets: number
  available_assets: number
  restricted_assets: number
  availability_percentage: number
  peak_available_assets: number
  minimum_available_assets: number
  maintenance_tasks_completed: number
  maintenance_window_minutes: number
  train_conflicts: number
  block_closures: number
  restricted_blocks: RestrictedBlockInfo[]
}

export interface AvailabilityImpact {
  availability_change_percentage_points: number
  restricted_asset_change: number
  train_conflict_change: number
  block_closure_change: number
  time_saved_minutes: number
}

export interface AssetAvailabilityResponse {
  total_assets: number
  planning_window: string
  horizon_minutes: number
  baseline: AvailabilityMetrics
  optimized: AvailabilityMetrics
  impact: AvailabilityImpact
  timeline: TimeSlotAvailability[]
  optimization_status: string
  explanation: string
  human_approval_required: boolean
  decision_support_note: string
}

export interface AssetAvailabilityOptimizeRequest {
  planning_window?: string
  target_block_codes?: string[] | null
  start_time?: string | null
  stagger_multi_blocks?: boolean
}

/**
 * Fetch CP-SAT optimized asset availability and baseline comparison.
 */
export async function fetchAssetAvailability(
  planningWindow: string = 'night',
  staggerMultiBlocks: boolean = true,
  startTime?: string | null,
  timeoutMs: number = 30000
): Promise<AssetAvailabilityResponse> {
  const queryParams = new URLSearchParams()
  if (planningWindow) queryParams.set('planning_window', planningWindow)
  queryParams.set('stagger_multi_blocks', String(staggerMultiBlocks))
  if (startTime) queryParams.set('start_time', startTime)

  const url = `${API_BASE_URL}/ai/asset-availability?${queryParams.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.detail || `Failed to fetch asset availability (${response.status})`
      )
    }

    return response.json()
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(
        'Optimization request timed out. The OR-Tools CP-SAT solver is taking longer than expected. Please retry calculation.'
      )
    }
    throw err
  }
}

/**
 * Execute CP-SAT optimization with custom parameters.
 */
export async function optimizeAssetAvailability(
  payload: AssetAvailabilityOptimizeRequest,
  timeoutMs: number = 35000
): Promise<AssetAvailabilityResponse> {
  const url = `${API_BASE_URL}/ai/asset-availability/optimize`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        errorData.detail || `Failed to optimize asset availability (${response.status})`
      )
    }

    return response.json()
  } catch (err: any) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      throw new Error(
        'Optimization request timed out. The OR-Tools CP-SAT solver is taking longer than expected. Please retry.'
      )
    }
    throw err
  }
}
