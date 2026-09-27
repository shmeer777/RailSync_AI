/**
 * Predictive Maintenance Service for RailSync AI.
 * Communicates with backend ML endpoints on http://127.0.0.1:8001
 */

import { API_BASE_URL } from '../lib/api'

export interface PredictionExplanationFeature {
  feature: string
  feature_label?: string
  value?: number
  importance: number
  influence_level?: 'High' | 'Moderate' | 'Low'
  direction: 'increases_probability' | 'decreases_probability' | string
  human_explanation: string
}

export interface MaintenancePrediction {
  block_code: string
  block_name: string
  start_station_code: string
  end_station_code: string
  distance_km: number | null
  predicted_maintenance: string
  confidence: number
  model_probability?: number
  urgency: 'Critical' | 'High' | 'Medium' | 'Low'
  risk_score: number
  contributing_factors: string[]
  top_contributing_features?: PredictionExplanationFeature[]
  prediction_explanation?: PredictionExplanationFeature[]
  ai_explanation_summary?: string
  recommended_action: string
  recommended_task_details: {
    department: string
    crew_type: string
    estimated_duration_minutes: number
    default_priority: string
  }
  model_info: {
    model_name: string
    model_version: string
    accuracy: number
    is_synthetic_training_data: boolean
  }
  features: Record<string, number>
  human_review_notice: string
}

export interface ModelMetrics {
  model_name: string
  model_version: string
  trained_at: string
  total_samples: number
  train_samples: number
  test_samples: number
  classes: string[]
  accuracy: number
  precision_weighted: number
  recall_weighted: number
  f1_weighted: number
  precision_macro: number
  recall_macro: number
  f1_macro: number
  confusion_matrix: number[][]
  feature_importances: Record<string, number>
  is_synthetic_training_data: boolean
  disclosure: string
}

export interface PredictionsApiResponse {
  total_predictions: number
  predictions: MaintenancePrediction[]
}

export interface PlanPredictionPayload {
  block_code: string
  maintenance_type: string
  department: string
  crew_type: string
  priority: string
  estimated_duration_minutes: number
  window_preference?: string
  human_approved?: boolean
}

export interface PlanPredictionResponse {
  message: string
  block_code: string
  recommended_maintenance: string
  human_approved: boolean
  bundles: any[]
}

export async function fetchMaintenancePredictions(
  blockCode?: string
): Promise<PredictionsApiResponse> {
  const url = new URL(`${API_BASE_URL}/ai/maintenance-predictions`)
  if (blockCode && blockCode !== 'ALL') {
    url.searchParams.set('block_code', blockCode)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Failed to fetch predictions: ${res.statusText} (${res.status})`)
  }
  return res.json()
}

export async function fetchBlockMaintenancePrediction(
  blockCode: string
): Promise<MaintenancePrediction> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-predictions/${encodeURIComponent(blockCode)}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch prediction for ${blockCode}: ${res.statusText} (${res.status})`)
  }
  return res.json()
}

export async function fetchModelMetrics(): Promise<ModelMetrics> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-predictions/model-metrics`)
  if (!res.ok) {
    throw new Error(`Failed to fetch model metrics: ${res.statusText} (${res.status})`)
  }
  return res.json()
}

export async function planFromPrediction(
  payload: PlanPredictionPayload
): Promise<PlanPredictionResponse> {
  const res = await fetch(`${API_BASE_URL}/ai/maintenance-predictions/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`Failed to plan from prediction: ${res.statusText} (${res.status})`)
  }
  return res.json()
}
