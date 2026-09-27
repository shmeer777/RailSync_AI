import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  Filter,
  Loader2,
  RefreshCw,
  Wrench,
  X,
} from 'lucide-react'
import {
  fetchMaintenancePredictions,
  fetchModelMetrics,
  planFromPrediction,
  type MaintenancePrediction,
  type ModelMetrics,
} from '../../services/predictiveMaintenance'

interface PredictiveMaintenanceSectionProps {
  blocks?: { id: number; code: string; name: string }[]
  onPlanSuccess?: () => void
}

export default function PredictiveMaintenanceSection({
  blocks = [],
  onPlanSuccess,
}: PredictiveMaintenanceSectionProps) {
  const [selectedBlock, setSelectedBlock] = useState<string>('ALL')
  const [predictions, setPredictions] = useState<MaintenancePrediction[]>([])
  const [selectedPredictionCode, setSelectedPredictionCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Model Metrics Modal
  const [showMetricsModal, setShowMetricsModal] = useState(false)
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)

  // Plan Review Modal
  const [reviewPrediction, setReviewPrediction] = useState<MaintenancePrediction | null>(null)
  const [windowPreference, setWindowPreference] = useState<string>('night')
  const [humanConfirmed, setHumanConfirmed] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [planSuccess, setPlanSuccess] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  const loadPredictions = async (blockCode?: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMaintenancePredictions(blockCode)
      const list = data.predictions || []
      setPredictions(list)
      if (list.length > 0) {
        setSelectedPredictionCode((prev) => (prev && list.some(p => p.block_code === prev) ? prev : list[0].block_code))
      } else {
        setSelectedPredictionCode(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load predictive maintenance insights.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPredictions(selectedBlock === 'ALL' ? undefined : selectedBlock)
  }, [selectedBlock])

  const handleOpenMetrics = async () => {
    setShowMetricsModal(true)
    if (!metrics) {
      setLoadingMetrics(true)
      try {
        const m = await fetchModelMetrics()
        setMetrics(m)
      } catch (err: any) {
        console.error('Failed to load metrics:', err)
      } finally {
        setLoadingMetrics(false)
      }
    }
  }

  const handleOpenReview = (pred: MaintenancePrediction) => {
    setReviewPrediction(pred)
    setWindowPreference('night')
    setHumanConfirmed(true)
    setPlanError(null)
    setPlanSuccess(null)
  }

  const handleConfirmPlan = async () => {
    if (!reviewPrediction) return
    if (!humanConfirmed) {
      setPlanError('Human engineering approval is required to schedule maintenance.')
      return
    }

    setPlanning(true)
    setPlanError(null)
    setPlanSuccess(null)

    try {
      const res = await planFromPrediction({
        block_code: reviewPrediction.block_code,
        maintenance_type: reviewPrediction.predicted_maintenance,
        department: reviewPrediction.recommended_task_details.department,
        crew_type: reviewPrediction.recommended_task_details.crew_type,
        priority: reviewPrediction.recommended_task_details.default_priority,
        estimated_duration_minutes: reviewPrediction.recommended_task_details.estimated_duration_minutes,
        window_preference: windowPreference,
        human_approved: true,
      })

      setPlanSuccess(res.message || 'Maintenance recommendation scheduled successfully.')
      onPlanSuccess?.()
      setTimeout(() => {
        setReviewPrediction(null)
        setPlanSuccess(null)
      }, 2000)
    } catch (err: any) {
      setPlanError(err.message || 'Failed to schedule predictive maintenance.')
    } finally {
      setPlanning(false)
    }
  }

  const activePrediction =
    predictions.find((p) => p.block_code === selectedPredictionCode) || predictions[0] || null

  return (
    <section id="predictive-maintenance-section" className="enterprise-container" style={{ marginBottom: '24px' }}>
      {/* 1. ENTERPRISE PAGE HEADER */}
      <div className="enterprise-page-header">
        <div className="enterprise-title-group">
          <h2>Predictive Maintenance</h2>
          <p className="enterprise-subtitle">
            Machine learning driven failure risk and degradation forecasts for critical railway assets.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Asset / Block Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} color="#5B6773" />
            <select
              id="predictive-block-selector"
              value={selectedBlock}
              onChange={(e) => setSelectedBlock(e.target.value)}
              className="enterprise-select"
            >
              <option value="ALL">All Assets</option>
              {blocks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} ({b.name})
                </option>
              ))}
              {blocks.length === 0 && (
                <>
                  <option value="GNT-BZA-01">GNT-BZA-01 (Guntur - Vijayawada)</option>
                  <option value="NDK-GNT-01">NDK-GNT-01 (Nadikudi - Guntur)</option>
                  <option value="STP-NDK-01">STP-NDK-01 (Sattenapalle - Nadikudi)</option>
                </>
              )}
            </select>
          </div>

          {/* Model Performance */}
          <button
            type="button"
            onClick={handleOpenMetrics}
            className="enterprise-btn-secondary"
            title="Inspect evaluation metrics & confusion matrix"
          >
            <BarChart3 size={15} color="#1F5F9C" />
            <span>Model Metrics</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => void loadPredictions(selectedBlock === 'ALL' ? undefined : selectedBlock)}
            disabled={loading}
            className="enterprise-btn-primary"
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
            <span>{loading ? 'Refreshing...' : 'Refresh Data'}</span>
          </button>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            background: '#FEE2E2',
            border: '1px solid #FECACA',
            color: '#DC2626',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* 2. TWO-COLUMN LAYOUT MATCHING REFERENCE PANEL 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
        {/* LEFT COLUMN: PREDICTED MAINTENANCE TASKS TABLE */}
        <div className="enterprise-card" style={{ background: 'var(--bg-table, #121416)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px', overflow: 'hidden' }}>
          <div className="enterprise-card-header">
            <h3 className="enterprise-card-title">Predicted Maintenance Tasks</h3>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', fontWeight: 600 }}>
              {predictions.length} Tasks Forecasted
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Asset / Block</th>
                  <th>Task Type</th>
                  <th>Risk Level</th>
                  <th>Window</th>
                  <th>Duration</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary, #B9BDC4)' }}>
                      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 6px', color: '#1F5F9C' }} />
                      Loading predictions...
                    </td>
                  </tr>
                ) : predictions.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary, #B9BDC4)' }}>
                      No maintenance risks predicted for this section.
                    </td>
                  </tr>
                ) : (
                  predictions.map((pred) => {
                    const isSelected = selectedPredictionCode === pred.block_code
                    const urgencyClass =
                      pred.urgency === 'Critical'
                        ? 'critical'
                        : pred.urgency === 'High'
                        ? 'high'
                        : pred.urgency === 'Medium'
                        ? 'medium'
                        : 'normal'

                    return (
                      <tr
                        key={pred.block_code}
                        onClick={() => setSelectedPredictionCode(pred.block_code)}
                        className={isSelected ? 'selected' : ''}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <strong style={{ color: 'var(--text-primary, #F5F5F5)', display: 'block' }}>{pred.block_code}</strong>
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>{pred.block_name}</span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{pred.predicted_maintenance}</span>
                          <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>
                            {pred.recommended_task_details?.department || 'Engineering'}
                          </span>
                        </td>
                        <td>
                          <span className={`status-chip ${urgencyClass}`}>
                            {pred.urgency} ({pred.risk_score})
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--text-secondary, #B9BDC4)' }}>
                          {pred.urgency === 'Critical' ? 'Within 24h' : pred.urgency === 'High' ? 'Within 3d' : 'Next 7d'}
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>
                          {pred.recommended_task_details?.estimated_duration_minutes
                            ? `${pred.recommended_task_details.estimated_duration_minutes}m`
                            : '180m'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleOpenReview(pred)
                            }}
                            className="enterprise-btn-primary"
                            style={{ height: '30px', padding: '0 10px', fontSize: '11.5px' }}
                          >
                            Schedule
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

        {/* RIGHT COLUMN: PREDICTION DETAILS CARD */}
        <div className="enterprise-card" style={{ background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div className="enterprise-card-header">
            <h3 className="enterprise-card-title">Prediction Details</h3>
            {activePrediction && (
              <span className="status-chip medium" style={{ fontSize: '11px' }}>
                {activePrediction.block_code}
              </span>
            )}
          </div>

          <div className="enterprise-card-body">
            {activePrediction ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Header Information */}
                <div>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)' }}>
                    {activePrediction.predicted_maintenance}
                  </h4>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '3px' }}>
                    Section: {activePrediction.start_station_code || 'GNT'} → {activePrediction.end_station_code || 'BZA'} | Track {activePrediction.distance_km || 32} km
                  </div>
                </div>

                {/* Risk Score Progress Bar */}
                <div style={{ background: 'var(--bg-elevated, #1B1D20)', padding: '14px', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #B9BDC4)' }}>Failure Risk Score</span>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 750,
                        color: activePrediction.risk_score >= 70 ? '#DC2626' : activePrediction.risk_score >= 40 ? '#D97706' : '#2E8B57',
                      }}
                    >
                      {activePrediction.risk_score} / 100
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'var(--bg-subtle, #16181B)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${activePrediction.risk_score}%`,
                        background: activePrediction.risk_score >= 70 ? '#DC2626' : activePrediction.risk_score >= 40 ? '#F59E0B' : '#10B981',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '6px' }}>
                    <span>Model Confidence: <strong>{activePrediction.confidence}%</strong></span>
                    <span>Urgency: <strong>{activePrediction.urgency}</strong></span>
                  </div>
                </div>

                {/* Contributing Sensor & Telemetry Factors */}
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Contributing Degradation Factors
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(activePrediction.top_contributing_features || activePrediction.prediction_explanation || [
                      { feature: 'Track Vibration Level', value: '1.42 m/s²', impact: 'High', description: 'Exceeds threshold' },
                      { feature: 'Geometry Index Deviation', value: '+3.8 mm', impact: 'Moderate', description: 'Lateral alignment' },
                      { feature: 'Cumulative Axle Tonnage', value: '48.2 MGT', impact: 'High', description: 'Heavy freight route' },
                    ]).slice(0, 4).map((f: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          background: 'var(--bg-elevated, #1B1D20)',
                          border: '1px solid var(--border-light, #2A2D32)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '11.5px',
                        }}
                      >
                        <span style={{ color: 'var(--text-primary, #F5F5F5)', fontWeight: 600 }}>{f.feature_name || f.feature}</span>
                        <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{f.value !== undefined ? String(f.value) : f.impact || 'Recorded'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommended Window & Specs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 600 }}>Recommended Window</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                      Night (01:30 - 04:30)
                    </div>
                  </div>
                  <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 600 }}>Assigned Department</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                      {activePrediction.recommended_task_details?.department || 'Engineering (P-Way)'}
                    </div>
                  </div>
                </div>

                {/* Primary Action Button */}
                <button
                  type="button"
                  onClick={() => handleOpenReview(activePrediction)}
                  className="enterprise-btn-primary"
                  style={{ width: '100%', justifyContent: 'center', height: '40px', marginTop: '4px' }}
                >
                  <Wrench size={16} />
                  <span>Schedule Maintenance Block</span>
                </button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary, #B9BDC4)' }}>
                Select an asset from the table to inspect details.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. REVIEW PREDICTION MODAL */}
      {reviewPrediction && (
        <div
          id="prediction-review-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(9, 10, 12, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
          }}
        >
          <div
            className="enterprise-card"
            style={{ width: '100%', maxWidth: '560px', background: 'var(--bg-modal, #17191C)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
          >
            <div className="enterprise-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={18} color="#1F5F9C" />
                <h3 className="enterprise-card-title">Schedule Maintenance Block</h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewPrediction(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="enterprise-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.5 }}>
                Configure maintenance block parameters for{' '}
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{reviewPrediction.block_code}</strong> ({reviewPrediction.predicted_maintenance}).
              </p>

              {/* Task Details Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)', fontSize: '12px' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>Department:</span>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary, #F5F5F5)' }}>{reviewPrediction.recommended_task_details?.department || 'Engineering'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>Assigned Crew:</span>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary, #F5F5F5)' }}>{reviewPrediction.recommended_task_details?.crew_type || 'Track Machine'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>Estimated Duration:</span>
                  <div style={{ fontWeight: 700, color: '#1F5F9C' }}>{reviewPrediction.recommended_task_details?.estimated_duration_minutes || 180} min</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>Priority:</span>
                  <div style={{ fontWeight: 700, color: '#D97706' }}>{reviewPrediction.recommended_task_details?.default_priority || 'High'}</div>
                </div>
              </div>

              {/* Preferred Window */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary, #F5F5F5)', marginBottom: '6px' }}>
                  Execution Window Preference
                </label>
                <select
                  value={windowPreference}
                  onChange={(e) => setWindowPreference(e.target.value)}
                  className="enterprise-select"
                  style={{ width: '100%' }}
                >
                  <option value="night">Night Window (01:00 - 05:00) — Recommended Minimal Disruption</option>
                  <option value="day">Day Window (09:00 - 15:00) — Off-Peak Corridor</option>
                  <option value="any">Earliest Feasible Availability</option>
                </select>
              </div>

              {/* Engineering Confirmation */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={humanConfirmed}
                  onChange={(e) => setHumanConfirmed(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#1F5F9C' }}
                />
                Verified and authorized by Senior Section Engineer
              </label>

              {planError && (
                <div style={{ padding: '8px 12px', background: 'var(--bg-error, #211416)', border: '1px solid var(--border-error, #6B2A32)', borderRadius: '4px', color: 'var(--text-error, #F5A0A8)', fontSize: '11.5px' }}>
                  {planError}
                </div>
              )}
              {planSuccess && (
                <div style={{ padding: '8px 12px', background: '#E8F5E9', border: '1px solid #C8E6C9', borderRadius: '4px', color: '#2E8B57', fontSize: '11.5px' }}>
                  {planSuccess}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setReviewPrediction(null)}
                  className="enterprise-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPlan}
                  disabled={planning || !humanConfirmed}
                  className="enterprise-btn-primary"
                >
                  {planning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={14} />}
                  <span>{planning ? 'Scheduling...' : 'Authorize & Schedule'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. MODEL PERFORMANCE METRICS MODAL */}
      {showMetricsModal && (
        <div
          id="model-metrics-modal"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(9, 10, 12, 0.75)',
            backdropFilter: 'blur(3px)',
            display: 'grid',
            placeItems: 'center',
            padding: '20px',
          }}
        >
          <div
            className="enterprise-card"
            style={{ width: '100%', maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-modal, #17191C)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
          >
            <div className="enterprise-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Cpu size={18} color="#1F5F9C" />
                <h3 className="enterprise-card-title">Predictive Model Evaluation</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMetricsModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="enterprise-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingMetrics ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary, #B9BDC4)' }}>
                  <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px', color: '#1F5F9C' }} />
                  Loading model metrics...
                </div>
              ) : metrics ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    <div style={{ padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border-light, #2A2D32)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase' }}>Accuracy</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#2E8B57', marginTop: '2px' }}>
                        {(metrics.accuracy * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border-light, #2A2D32)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase' }}>Precision</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#1F5F9C', marginTop: '2px' }}>
                        {(metrics.precision_weighted * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border-light, #2A2D32)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase' }}>Recall</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                        {(metrics.recall_weighted * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', textAlign: 'center', border: '1px solid var(--border-light, #2A2D32)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase' }}>F1 Score</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: '#D97706', marginTop: '2px' }}>
                        {(metrics.f1_weighted * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: '12px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)', fontSize: '12px' }}>
                    <div><strong>Algorithm:</strong> {metrics.model_name} (Scikit-Learn)</div>
                    <div style={{ marginTop: '4px' }}><strong>Version:</strong> {metrics.model_version}</div>
                    <div style={{ marginTop: '4px' }}><strong>Evaluated Samples:</strong> {metrics.total_samples} (80% train / 20% test split)</div>
                    <div style={{ marginTop: '4px' }}><strong>Target Classes:</strong> {metrics.classes.join(', ')}</div>
                  </div>

                  {metrics.feature_importances && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginBottom: '8px' }}>
                        Feature Importance Distribution
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                        {Object.entries(metrics.feature_importances)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 6)
                          .map(([name, imp]) => (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-elevated, #1B1D20)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)', fontSize: '11px' }}>
                              <span style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{name}</span>
                              <strong style={{ color: '#1F5F9C' }}>{(imp * 100).toFixed(1)}%</strong>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowMetricsModal(false)}
                  className="enterprise-btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
