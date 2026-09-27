import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Clock,
  Layers,
  Loader2,
  Network,
  ShieldCheck,
  Train,
  Users,
  X,
  Zap,
} from 'lucide-react'

import {
  fetchTaskImpact,
  fetchBundleImpact,
  type MaintenanceImpactResponse,
} from '../../services/maintenancePlanning'

interface MaintenanceImpactModalProps {
  taskId?: number | null
  bundleId?: string | null
  onClose: () => void
}

export default function MaintenanceImpactModal({
  taskId,
  bundleId,
  onClose,
}: MaintenanceImpactModalProps) {
  const [impact, setImpact] = useState<MaintenanceImpactResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadImpact() {
      try {
        setLoading(true)
        setError(null)
        if (taskId) {
          const data = await fetchTaskImpact(taskId)
          setImpact(data)
        } else if (bundleId) {
          const data = await fetchBundleImpact(bundleId)
          setImpact(data)
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load maintenance impact.')
      } finally {
        setLoading(false)
      }
    }
    void loadImpact()
  }, [taskId, bundleId])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: '20px',
        background: 'rgba(1, 8, 15, 0.82)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          width: 'min(860px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '16px',
          background: 'var(--bg-modal, #17191C)',
          border: '1px solid var(--border-light, #2A2D32)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-light, #2A2D32)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'rgba(9, 200, 255, 0.15)',
                display: 'grid',
                placeItems: 'center',
                color: '#09c8ff',
              }}
            >
              <Zap size={20} />
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#09c8ff', letterSpacing: '1px' }}>
                MAINTENANCE IMPACT ANALYSIS
              </div>
              <h3 style={{ margin: '2px 0 0', fontSize: '18px', color: 'var(--text-primary, #F5F5F5)' }}>
                {taskId ? `Task #${taskId} Operational Impact` : `Bundle ${bundleId} Operational Impact`}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              color: 'var(--text-secondary, #B9BDC4)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* CONTENT */}
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '10px', color: '#7fa2b6' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#09c8ff' }} />
              <span style={{ fontSize: '13px' }}>Evaluating operational impact across railway network...</span>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {error && (
            <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(255, 85, 117, 0.1)', border: '1px solid rgba(255, 85, 117, 0.3)', color: '#ff8298', fontSize: '13px' }}>
              <AlertTriangle size={16} style={{ display: 'inline', marginRight: '8px' }} />
              {error}
            </div>
          )}

          {impact && (
            <>
              {/* HUMAN APPROVAL BADGE */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'rgba(9, 200, 255, 0.08)',
                  border: '1px solid rgba(9, 200, 255, 0.25)',
                  fontSize: '12px',
                  color: '#9ec7dd',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={16} style={{ color: '#09c8ff' }} />
                  <span>Inspect operational impacts prior to approving schedule.</span>
                </div>
                <span style={{ fontWeight: 700, color: '#09c8ff' }}>Human Approval Required</span>
              </div>

              {/* 6 IMPACT CARDS GRID */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '14px',
                }}
              >
                {/* 1. BLOCK IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Network size={16} style={{ color: '#09c8ff' }} />
                    <strong style={cardTitleStyle}>1. Block Impact</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Section:</strong> {impact.block_impact.block_code}</div>
                    <div style={{ fontSize: '11px', color: '#9ec7dd' }}>{impact.block_impact.block_name}</div>
                    <div><strong>Duration:</strong> {impact.block_impact.duration_minutes} min</div>
                    <div><strong>Distance:</strong> {impact.block_impact.distance_km} km</div>
                  </div>
                </div>

                {/* 2. TRAIN IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Train size={16} style={{ color: '#ff9a52' }} />
                    <strong style={cardTitleStyle}>2. Train Impact</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Modeled Conflicts:</strong> {impact.train_impact.total_conflicts}</div>
                    <div><strong>Affected Trains:</strong> {impact.train_impact.affected_trains_count}</div>
                    {impact.train_impact.trains.length > 0 ? (
                      <div style={{ fontSize: '11px', color: '#ff9a52', marginTop: '4px' }}>
                        Trains: {impact.train_impact.trains.map(t => `${t.train_number || t.name}`).join(', ')}
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: '#10b981' }}>Zero conflicts during proposed window.</div>
                    )}
                  </div>
                </div>

                {/* 3. CREW IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Users size={16} style={{ color: '#10b981' }} />
                    <strong style={cardTitleStyle}>3. Crew Impact</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Crews Involved:</strong> {impact.crew_impact.total_crews_involved}</div>
                    <div><strong>Departments:</strong> {impact.crew_impact.departments.join(', ') || 'Engineering'}</div>
                    <div style={{ fontSize: '11px', color: '#9ec7dd', marginTop: '4px' }}>
                      {impact.crew_impact.crews.map(c => c.name).join(', ') || 'Assigned automatically'}
                    </div>
                  </div>
                </div>

                {/* 4. DEPENDENCY IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Layers size={16} style={{ color: '#c084fc' }} />
                    <strong style={cardTitleStyle}>4. Dependency Impact</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Prerequisites:</strong> {impact.dependency_impact.prerequisite_tasks_count}</div>
                    <div><strong>Downstream Blocked:</strong> {impact.dependency_impact.downstream_tasks_count}</div>
                    {impact.dependency_impact.dependency_notes.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#d8b4fe', marginTop: '4px' }}>
                        {impact.dependency_impact.dependency_notes.join(' ')}
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. ASSET AVAILABILITY IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Boxes size={16} style={{ color: '#00d4ff' }} />
                    <strong style={cardTitleStyle}>5. Asset Availability</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Restricted:</strong> {impact.asset_impact.restricted_assets} / {impact.asset_impact.total_network_assets} blocks</div>
                    <div><strong>Network Availability:</strong> {impact.asset_impact.availability_percentage}%</div>
                    <div style={{ fontSize: '11px', color: '#67e8f9' }}>
                      {impact.asset_impact.available_assets} sections remain operational.
                    </div>
                  </div>
                </div>

                {/* 6. TRAFFIC IMPACT */}
                <div style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <Clock size={16} style={{ color: '#f59e0b' }} />
                    <strong style={cardTitleStyle}>6. Traffic Load</strong>
                  </div>
                  <div style={cardContentStyle}>
                    <div><strong>Overall Traffic Level:</strong> {impact.traffic_impact.overall_traffic_level}</div>
                    <div><strong>Traffic Load Score:</strong> {impact.traffic_impact.total_traffic_score}</div>
                    <div style={{ fontSize: '11px', color: '#fde68a' }}>
                      Peak Slot Index: #{impact.traffic_impact.peak_slot_index}
                    </div>
                  </div>
                </div>
              </div>

              {/* DETERMINISTIC EXPLANATION */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(75, 137, 172, 0.18)',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#09c8ff', marginBottom: '6px' }}>
                  OPERATIONAL SUMMARY
                </div>
                <div style={{ fontSize: '13px', color: '#dff5ff', lineHeight: 1.5 }}>
                  {impact.explanation}
                </div>
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '16px 24px',
            borderTop: '1px solid var(--border-light, #2A2D32)',
            background: 'var(--bg-elevated, #1B1D20)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              height: '38px',
              padding: '0 20px',
              borderRadius: '8px',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              color: 'var(--text-primary, #F5F5F5)',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const cardStyle = {
  borderRadius: '10px',
  background: 'var(--bg-card, #151719)',
  border: '1px solid var(--border-light, #2A2D32)',
  padding: '14px',
}

const cardHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '10px',
  paddingBottom: '6px',
  borderBottom: '1px solid var(--border-light, #2A2D32)',
}

const cardTitleStyle = {
  fontSize: '13px',
  color: 'var(--text-primary, #F5F5F5)',
}

const cardContentStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '4px',
  fontSize: '12px',
  color: 'var(--text-secondary, #B9BDC4)',
}
