import { useState, useEffect, useCallback } from 'react'
import {
  AlertCircle,
  Building,
  CheckCircle2,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { API_BASE_URL } from '../../lib/api'

interface Block {
  id: number
  code: string
  name: string
  start_station_code: string
  end_station_code: string
  distance_km: number
}

interface MaintenanceRecord {
  id: number
  location_type: 'block' | 'station'
  block_code: string | null
  station_code: string | null
  maintenance_type: string
  description: string | null
  priority: string
  status: string
  scheduled_start: string | null
  scheduled_end: string | null
  estimated_duration_minutes: number | null
  department?: string
  crew_type?: string
}

interface MaintenanceBundle {
  bundle_id: string
  block_code: string
  block_name?: string
  total_tasks?: number
  departments?: string[]
  crews?: string[]
  total_window_minutes?: number
}

interface ImpactSummary {
  affected_blocks: number
  affected_stations: number
  affected_trains: number
  train_conflicts: number
  departments: number
  crews: number
  dependent_tasks: number
  restricted_assets: number
  maintenance_window_minutes: number
  traffic_level: string
  impact_level: string
}

interface AffectedBlockItem {
  block_code: string
  block_name: string
  distance_km: number
  start_station_code: string
  end_station_code: string
  restriction_start: string | null
  restriction_end: string | null
  duration_minutes: number
  maintenance_task_ids: number[]
}

interface AffectedStationItem {
  station_code: string
  station_name: string | null
  connected_blocks: string[]
}

interface TrainConflictItem {
  train_id?: number | null
  train_number: string
  train_name: string
  train_type?: string | null
  source_station?: string | null
  destination_station?: string | null
  current_station?: string | null
  direction?: string | null
  affected_block: string
  conflict_type: string
  priority?: string | null
  status?: string | null
  eta_minute: number
  depart_minute: number
  delay_minutes?: number | null
  conflict_severity: string
  recommendation?: string | null
}

interface CrewMemberImpact {
  crew_id?: number | null
  name: string
  crew_type: string
  department: string
  required_crew_size: number
  available_capacity: number
  tasks_assigned_count: number
  assigned_task_ids?: number[]
  location?: string | null
  availability?: string | null
  scheduled_window?: string | null
  workload_notes?: string | null
}

interface DependencyLink {
  prerequisite_id: number
  prerequisite_title?: string | null
  dependent_id: number
  dependent_title?: string | null
  relation_type: string
}

interface SpeedRestrictionItem {
  block_code: string
  section_name: string
  restriction_speed_kmph: number
  normal_speed_kmph: number
  restriction_window: string
  reason: string
  affected_trains_count: number
}

interface PowerBlockItem {
  location: string
  power_block_type: string
  window: string
  department: string
  affected_assets: string
  operational_effect: string
}

interface SignallingImpactItem {
  signalling_asset: string
  location: string
  restriction: string
  window: string
  dependent_maintenance: string
  operational_effect: string
}

interface DepartmentImpactItem {
  department: string
  task_count: number
  crews_involved: string[]
  affected_assets: string[]
  planned_window: string
  coordination_requirement: string
}

interface RestrictedAssetItem {
  asset_code: string
  asset_name: string
  asset_type: string
  restriction_type: string
  restriction_window: string
  reason: string
  status: string
  affected_operations: string
}

interface BaselineVsOptimized {
  affected_trains_before?: number | null
  affected_trains_after?: number | null
  train_conflicts_before?: number | null
  train_conflicts_after?: number | null
  restricted_blocks_before?: number | null
  restricted_blocks_after?: number | null
  available_assets_before?: number | null
  available_assets_after?: number | null
  maintenance_duration_before?: number | null
  maintenance_duration_after?: number | null
}

interface MaintenanceImpactResponse {
  target_type: string
  target_id: string
  block_code: string
  maintenance_types: string[]
  window_start: string | null
  window_end: string | null
  duration_minutes: number
  impact_level: string
  impact_level_explanation: string
  impact_summary: ImpactSummary
  block_impact: {
    block_code: string
    block_name: string
    distance_km: number
    start_station_code: string
    end_station_code: string
    restriction_start: string | null
    restriction_end: string | null
    duration_minutes: number
    maintenance_task_ids: number[]
    affected_blocks: AffectedBlockItem[]
    affected_blocks_count: number
    affected_stations: AffectedStationItem[]
    affected_stations_count: number
  }
  train_impact: {
    total_conflicts: number
    affected_trains_count: number
    train_conflicts_before?: number | null
    train_conflicts_after?: number | null
    trains: TrainConflictItem[]
  }
  crew_impact: {
    total_crews_involved: number
    crews: CrewMemberImpact[]
    departments: string[]
    department_count: number
  }
  dependency_impact: {
    has_prerequisites: boolean
    prerequisite_tasks_count: number
    blocks_downstream: boolean
    downstream_tasks_count: number
    dependency_notes: string[]
    dependency_chain: DependencyLink[]
  }
  asset_impact: {
    total_network_assets: number
    restricted_assets: number
    available_assets: number
    availability_percentage: number
    baseline_availability_percentage?: number
    availability_delta?: number
    note?: string | null
  }
  traffic_impact: {
    overall_traffic_level: string
    total_traffic_score: number
    slot_traffic: number[]
    peak_slot_index: number
    planning_window?: string | null
    operational_impact_indicators: string[]
  }
  maintenance_window_impact: {
    planned_start: string | null
    planned_end: string | null
    duration_minutes: number
    restricted_period: string
    is_coordinated_bundle: boolean
  }
  speed_restrictions?: SpeedRestrictionItem[]
  power_blocks?: PowerBlockItem[]
  signalling_impacts?: SignallingImpactItem[]
  departments_detail?: DepartmentImpactItem[]
  restricted_assets_detail?: RestrictedAssetItem[]
  baseline_vs_optimized?: BaselineVsOptimized | null
  explanation: string
  human_approval_required?: boolean
  human_approval_disclaimer?: string
  decision_support_note?: string
}

interface MaintenanceImpactSectionProps {
  blocks: Block[]
  records: MaintenanceRecord[]
  bundles: MaintenanceBundle[]
}

type ImpactCategoryTab =
  | 'blocks'
  | 'trains'
  | 'crews'
  | 'departments'
  | 'restricted_assets'
  | 'speed_restrictions'
  | 'power_blocks'
  | 'signaling'
  | 'dependencies'

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return isoString
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return isoString
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function MaintenanceImpactSection({
  blocks,
  records,
  bundles,
}: MaintenanceImpactSectionProps) {
  const [analysisType, setAnalysisType] = useState<'task' | 'bundle' | 'what-if'>('task')
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<ImpactCategoryTab>('blocks')
  const [selectedTaskId, setSelectedTaskId] = useState<string>('')
  const [selectedBundleId, setSelectedBundleId] = useState<string>('')
  const [whatIfBlock, setWhatIfBlock] = useState<string>('')
  const [whatIfWindow, setWhatIfWindow] = useState<string>('night')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [impactData, setImpactData] = useState<MaintenanceImpactResponse | null>(null)

  // Initialize selections with valid active records
  useEffect(() => {
    if (records.length > 0 && !selectedTaskId) {
      setSelectedTaskId(String(records[0].id))
    }
    if (bundles.length > 0 && !selectedBundleId) {
      setSelectedBundleId(bundles[0].bundle_id)
    }
    if (blocks.length > 0 && !whatIfBlock) {
      setWhatIfBlock(blocks[0].code)
    }
  }, [records, bundles, blocks, selectedTaskId, selectedBundleId, whatIfBlock])

  const handleAnalyze = useCallback(
    async (
      overrideType?: 'task' | 'bundle' | 'what-if',
      overrideId?: string,
      overrideWindow?: string
    ) => {
      const type = overrideType || analysisType
      const activeWindow = overrideWindow || whatIfWindow
      setLoading(true)
      setError(null)

      try {
        let url = ''
        let options: RequestInit = {}

        if (type === 'task') {
          const id = overrideId || selectedTaskId || (records[0] ? String(records[0].id) : '')
          if (!id) {
            throw new Error('No maintenance tasks available to analyze. Please create a task first.')
          }
          url = `${API_BASE_URL}/ai/maintenance-impact/${encodeURIComponent(id)}`
          options = { method: 'GET' }
        } else if (type === 'bundle') {
          const bid = overrideId || selectedBundleId || (bundles[0] ? bundles[0].bundle_id : '')
          if (!bid) {
            throw new Error('No coordinated maintenance bundles found to analyze.')
          }
          url = `${API_BASE_URL}/ai/maintenance-impact/bundle/${encodeURIComponent(bid)}`
          options = { method: 'GET' }
        } else {
          const blk = overrideId || whatIfBlock || (blocks[0] ? blocks[0].code : '')
          if (!blk) {
            throw new Error('No railway block available for What-If scenario simulation.')
          }
          url = `${API_BASE_URL}/ai/maintenance-impact/what-if`
          options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              block_code: blk,
              name: `What-If Analysis (${blk} - ${activeWindow})`,
              planning_window: activeWindow,
            }),
          }
        }

        const res = await fetch(url, options)
        if (!res.ok) {
          const errData = await res.json().catch(() => null)
          throw new Error(errData?.detail || `Impact analysis failed with status ${res.status}`)
        }

        const data: MaintenanceImpactResponse = await res.json()
        setImpactData(data)
      } catch (err: any) {
        setError(err.message || 'Failed to analyze maintenance impact.')
        setImpactData(null)
      } finally {
        setLoading(false)
      }
    },
    [analysisType, selectedTaskId, selectedBundleId, whatIfBlock, whatIfWindow, records, bundles, blocks]
  )

  // Initial analysis on mount when records are ready
  useEffect(() => {
    if (!impactData && (selectedTaskId || records.length > 0)) {
      const initialId = selectedTaskId || (records[0] ? String(records[0].id) : '')
      if (initialId) {
        void handleAnalyze('task', initialId)
      }
    }
  }, [records, selectedTaskId, impactData, handleAnalyze])

  // Mode switcher handler with automatic evaluation
  const handleModeChange = (mode: 'task' | 'bundle' | 'what-if') => {
    setAnalysisType(mode)
    setError(null)
    if (mode === 'task') {
      const id = selectedTaskId || (records[0] ? String(records[0].id) : '')
      if (id) void handleAnalyze('task', id)
    } else if (mode === 'bundle') {
      const bid = selectedBundleId || (bundles[0] ? bundles[0].bundle_id : '')
      if (bid) void handleAnalyze('bundle', bid)
    } else {
      const blk = whatIfBlock || (blocks[0] ? blocks[0].code : '')
      if (blk) void handleAnalyze('what-if', blk)
    }
  }

  // KPI calculations: strictly aligned with returned data counts, defaulting to 0
  const kpiBlocks = impactData ? (impactData.impact_summary?.affected_blocks ?? 0) : 0
  const kpiTrains = impactData ? (impactData.impact_summary?.affected_trains ?? 0) : 0
  const kpiCrews = impactData ? (impactData.impact_summary?.crews ?? 0) : 0
  const kpiDepts = impactData ? (impactData.impact_summary?.departments ?? 0) : 0
  const kpiRestrictedAssets = impactData ? (impactData.impact_summary?.restricted_assets ?? 0) : 0
  const kpiWindow = impactData?.maintenance_window_impact?.restricted_period || (impactData?.duration_minutes ? `${impactData.duration_minutes} min` : '—')
  const kpiTrafficImpact = impactData?.impact_summary?.traffic_level || impactData?.traffic_impact?.overall_traffic_level || '—'
  const kpiDependentTask = impactData ? (impactData.impact_summary?.dependent_tasks ?? 0) : 0

  const tabCounts = {
    blocks: impactData?.block_impact?.affected_blocks?.length ?? kpiBlocks,
    trains: impactData?.train_impact?.affected_trains_count ?? kpiTrains,
    crews: impactData?.crew_impact?.total_crews_involved ?? kpiCrews,
    departments: impactData?.departments_detail?.length ?? kpiDepts,
    restricted_assets: impactData?.restricted_assets_detail?.length ?? kpiRestrictedAssets,
    speed_restrictions: impactData?.speed_restrictions?.length ?? 0,
    power_blocks: impactData?.power_blocks?.length ?? 0,
    signaling: impactData?.signalling_impacts?.length ?? 0,
    dependencies: impactData?.dependency_impact?.downstream_tasks_count ?? kpiDependentTask,
  }

  const emptyBoxStyle = {
    padding: '36px 20px',
    textAlign: 'center' as const,
    color: 'var(--text-secondary, #94A3B8)',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
  }

  const isStationBasedTask =
    impactData?.target_type === 'task' &&
    (!impactData?.block_impact?.affected_blocks || impactData.block_impact.affected_blocks.length === 0) &&
    (impactData?.block_impact?.affected_stations?.length ?? 0) > 0

  return (
    <div className="enterprise-container" style={{ marginBottom: '24px' }}>
      {/* 1. ENTERPRISE PAGE HEADER */}
      <div className="enterprise-page-header">
        <div className="enterprise-title-group">
          <h2>Maintenance Impact Analysis</h2>
          <p className="enterprise-subtitle">
            Cross-functional operational impact matrix evaluating track possession, train movements, and infrastructure restrictions.
          </p>
        </div>

        {/* Input Selector Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--bg-elevated, #F1F5F9)', padding: '3px', borderRadius: '6px', border: '1px solid var(--border-light, #CBD5E1)' }}>
            <button
              type="button"
              onClick={() => handleModeChange('task')}
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11.5px',
                fontWeight: 700,
                background: analysisType === 'task' ? 'var(--bg-card, #FFFFFF)' : 'transparent',
                color: analysisType === 'task' ? 'var(--text-primary, #102A43)' : 'var(--text-secondary, #64748B)',
                boxShadow: analysisType === 'task' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Task
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('bundle')}
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11.5px',
                fontWeight: 700,
                background: analysisType === 'bundle' ? 'var(--bg-card, #FFFFFF)' : 'transparent',
                color: analysisType === 'bundle' ? 'var(--text-primary, #102A43)' : 'var(--text-secondary, #64748B)',
                boxShadow: analysisType === 'bundle' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Bundle
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('what-if')}
              style={{
                padding: '5px 12px',
                borderRadius: '4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: '11.5px',
                fontWeight: 700,
                background: analysisType === 'what-if' ? 'var(--bg-card, #FFFFFF)' : 'transparent',
                color: analysisType === 'what-if' ? 'var(--text-primary, #102A43)' : 'var(--text-secondary, #64748B)',
                boxShadow: analysisType === 'what-if' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              What-If
            </button>
          </div>

          {/* TASK MODE SELECTION */}
          {analysisType === 'task' && records.length > 0 && (
            <select
              value={selectedTaskId}
              onChange={(e) => {
                setSelectedTaskId(e.target.value)
                void handleAnalyze('task', e.target.value)
              }}
              className="enterprise-select"
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} - {r.maintenance_type} ({r.block_code || r.station_code || 'Yard'})
                </option>
              ))}
            </select>
          )}

          {analysisType === 'task' && records.length === 0 && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #94A3B8)' }}>
              No maintenance tasks in database
            </span>
          )}

          {/* BUNDLE MODE SELECTION */}
          {analysisType === 'bundle' && (
            <select
              value={selectedBundleId}
              onChange={(e) => {
                setSelectedBundleId(e.target.value)
                void handleAnalyze('bundle', e.target.value)
              }}
              className="enterprise-select"
            >
              {bundles.map((b) => (
                <option key={b.bundle_id} value={b.bundle_id}>
                  {b.bundle_id} ({b.block_code}{b.block_name ? ` - ${b.block_name}` : ''}) • {b.total_tasks || 0} tasks
                </option>
              ))}
              {bundles.length === 0 && <option value="">No coordinated bundles available</option>}
            </select>
          )}

          {/* WHAT-IF MODE SELECTION */}
          {analysisType === 'what-if' && (
            <>
              <select
                value={whatIfBlock}
                onChange={(e) => {
                  setWhatIfBlock(e.target.value)
                  void handleAnalyze('what-if', e.target.value, whatIfWindow)
                }}
                className="enterprise-select"
              >
                {blocks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} ({b.name})
                  </option>
                ))}
                {blocks.length === 0 && <option value="">No blocks available</option>}
              </select>

              <select
                value={whatIfWindow}
                onChange={(e) => {
                  setWhatIfWindow(e.target.value)
                  void handleAnalyze('what-if', whatIfBlock, e.target.value)
                }}
                className="enterprise-select"
                style={{ width: '130px' }}
              >
                <option value="night">Night Slot</option>
                <option value="daytime">Day Slot</option>
                <option value="any">Any Slot</option>
              </select>
            </>
          )}

          <button
            type="button"
            onClick={() => handleAnalyze()}
            disabled={loading}
            className="enterprise-btn-primary"
          >
            {loading ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            <span>{loading ? 'Analyzing Impact...' : 'Analyze Impact'}</span>
          </button>
        </div>
      </div>

      {/* Decision Support Notice & Human Approval Banner */}
      <div style={{
        padding: '10px 14px',
        borderRadius: '6px',
        background: 'rgba(30, 58, 138, 0.12)',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '12px',
        color: 'var(--text-primary, #E2E8F0)',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert size={16} style={{ color: '#38BDF8', flexShrink: 0 }} />
          <span>
            <strong>Decision-Support System:</strong> {impactData?.decision_support_note || 'Impact analysis evaluates modeled train conflicts, crew workload, and network asset availability to inform section controllers.'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239, 68, 68, 0.15)', padding: '4px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.4)' }}>
          <ShieldCheck size={14} style={{ color: '#F87171' }} />
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#FCA5A5' }}>
            Human Approval Required
          </span>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: '6px', background: 'var(--bg-error, #211416)', border: '1px solid var(--border-error, #6B2A32)', color: 'var(--text-error, #F5A0A8)', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => handleAnalyze()}
            disabled={loading}
            className="enterprise-btn-secondary"
            style={{ height: '28px', padding: '0 10px', fontSize: '11.5px', whiteSpace: 'nowrap' }}
          >
            <RefreshCw size={12} />
            Retry Analysis
          </button>
        </div>
      )}

      {/* LOADING BANNER */}
      {loading && (
        <div style={{ padding: '10px 14px', borderRadius: '6px', background: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.3)', color: '#38BDF8', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
          <span>Analyzing operational impact across railway topology and timetables...</span>
        </div>
      )}

      {/* 2. CATEGORY TAB PILLS (ALL 9 FUNCTIONAL SECTIONS) */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {[
          { key: 'blocks', label: 'Blocks', count: tabCounts.blocks },
          { key: 'trains', label: 'Trains', count: tabCounts.trains },
          { key: 'crews', label: 'Crews', count: tabCounts.crews },
          { key: 'departments', label: 'Departments', count: tabCounts.departments },
          { key: 'restricted_assets', label: 'Restricted Assets', count: tabCounts.restricted_assets },
          { key: 'speed_restrictions', label: 'Speed Restrictions', count: tabCounts.speed_restrictions },
          { key: 'power_blocks', label: 'Power Blocks', count: tabCounts.power_blocks },
          { key: 'signaling', label: 'Signalling', count: tabCounts.signaling },
          { key: 'dependencies', label: 'Dependencies', count: tabCounts.dependencies },
        ].map((tab) => {
          const active = selectedCategoryTab === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSelectedCategoryTab(tab.key as ImpactCategoryTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                border: active ? '1px solid var(--accent-blue, #3B82C4)' : '1px solid var(--border-light, #2A2D32)',
                background: active ? 'var(--accent-blue, #3B82C4)' : 'var(--bg-card, #151719)',
                color: active ? '#FFFFFF' : 'var(--text-secondary, #B9BDC4)',
                transition: 'all 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '1px 6px',
                  borderRadius: '10px',
                  background: active ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                  color: active ? '#FFFFFF' : 'var(--text-secondary, #94A3B8)',
                }}
              >
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* 3. 8 KPI SUMMARY TILES (MATCHING DETAIL COUNTS STRICTLY, 0 INSTEAD OF FAKE DATA) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: '10px' }}>
        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Blocks</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiBlocks}</div>
          <div style={{ fontSize: '10px', color: '#2E8B57', marginTop: '2px', fontWeight: 600 }}>Possessed</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Trains</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiTrains}</div>
          <div style={{ fontSize: '10px', color: '#D97706', marginTop: '2px', fontWeight: 600 }}>Affected</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Crews</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiCrews}</div>
          <div style={{ fontSize: '10px', color: '#1F5F9C', marginTop: '2px', fontWeight: 600 }}>Assigned</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Departments</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiDepts}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '2px', fontWeight: 600 }}>Involved</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Restricted Assets</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiRestrictedAssets}</div>
          <div style={{ fontSize: '10px', color: '#DC2626', marginTop: '2px', fontWeight: 600 }}>Assets</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Window</div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={kpiWindow}>
            {kpiWindow}
          </div>
          <div style={{ fontSize: '10px', color: '#1F5F9C', marginTop: '2px', fontWeight: 600 }}>Planned Slot</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Traffic Impact</div>
          <div style={{ fontSize: '13px', fontWeight: 800, color: String(kpiTrafficImpact).toLowerCase().includes('high') ? '#EF4444' : '#2E8B57', marginTop: '5px' }}>
            {kpiTrafficImpact}
          </div>
          <div style={{ fontSize: '10px', color: '#94A3B8', marginTop: '2px', fontWeight: 600 }}>Level</div>
        </div>

        <div className="enterprise-card" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
          <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #B9BDC4)', textTransform: 'uppercase', fontWeight: 700 }}>Dependent Task</div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '3px' }}>{kpiDependentTask}</div>
          <div style={{ fontSize: '10px', color: '#D97706', marginTop: '2px', fontWeight: 600 }}>Downstream</div>
        </div>
      </div>

      {/* 4. DETAILED IMPACT TABLE & CARDS (ALL 9 DOMAINS) */}
      <div className="enterprise-card" style={{ background: 'var(--bg-table, #121416)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px', overflow: 'hidden' }}>
        
        {/* TAB 1: BLOCKS & STATIONS */}
        {selectedCategoryTab === 'blocks' && (
          <>
            <div className="enterprise-card-header">
              <div>
                <h3 className="enterprise-card-title">Affected Railway Blocks & Station Yards</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                  {impactData?.block_impact?.affected_blocks?.length || 0} Block(s) Restricted • {impactData?.block_impact?.affected_stations?.length || 0} Station(s) Affected
                </span>
              </div>
              {isStationBasedTask && (
                <span className="status-chip medium" style={{ fontSize: '11px' }}>
                  Station-Based Possession
                </span>
              )}
            </div>

            {/* Block section table */}
            {(!impactData?.block_impact?.affected_blocks || impactData.block_impact.affected_blocks.length === 0) ? (
              <div style={emptyBoxStyle}>
                <Info size={24} style={{ color: '#38BDF8' }} />
                <span>No affected railway blocks for this analysis.</span>
                {isStationBasedTask && (
                  <span style={{ fontSize: '11.5px', color: '#94A3B8' }}>
                    This maintenance task is located inside station yard limits rather than an open block section.
                  </span>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Block Code</th>
                      <th>Route Section</th>
                      <th>Distance</th>
                      <th>Restriction Window</th>
                      <th>Connected Stations</th>
                      <th>Status</th>
                      <th>Task IDs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.block_impact.affected_blocks.map((b, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{b.block_code}</strong></td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{b.block_name}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{b.distance_km} km</td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>
                          {formatTime(b.restriction_start)} – {formatTime(b.restriction_end)} ({b.duration_minutes}m)
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>
                          {b.start_station_code} ➔ {b.end_station_code}
                        </td>
                        <td>
                          <span className="status-chip critical">Possessed (Closed)</span>
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)', fontSize: '11.5px' }}>
                          Task #{b.maintenance_task_ids.join(', #') || impactData.target_id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Station impact table */}
            {impactData?.block_impact?.affected_stations && impactData.block_impact.affected_stations.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-light, #2A2D32)', padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <Building size={16} style={{ color: '#38BDF8' }} />
                  <strong style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)' }}>
                    Station Impact & Terminal Clearances
                  </strong>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="enterprise-table">
                    <thead>
                      <tr>
                        <th>Station Code</th>
                        <th>Station Name</th>
                        <th>Connected Corridors</th>
                        <th>Operational Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactData.block_impact.affected_stations.map((s, idx) => (
                        <tr key={idx}>
                          <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{s.station_code}</strong></td>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{s.station_name || `Station ${s.station_code}`}</td>
                          <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>
                            {s.connected_blocks.join(', ') || 'Direct Station Yard'}
                          </td>
                          <td>
                            <span className="status-chip warning">
                              {isStationBasedTask ? 'Platform / Yard Work Possession' : 'Boundary Station / Traffic Holding'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* TAB 2: TRAINS (ACTUAL CONFLICTS ONLY) */}
        {selectedCategoryTab === 'trains' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Impacted Train Movements & Timetable Conflicts</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.train_impact?.affected_trains_count || 0} Affected Train(s) • {impactData?.train_impact?.total_conflicts || 0} Conflict(s)
              </span>
            </div>
            {(!impactData?.train_impact?.trains || impactData.train_impact.trains.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>0 train conflicts modeled for this maintenance window.</strong>
                <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Timetable analysis shows no scheduled train services intersect this block corridor during the planned possession slot.
                </span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Train No.</th>
                      <th>Train Name</th>
                      <th>Type</th>
                      <th>Source ➔ Dest</th>
                      <th>Current Station</th>
                      <th>Direction</th>
                      <th>Priority</th>
                      <th>Impact / Conflict</th>
                      <th>Severity</th>
                      <th>Recommended Handling / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.train_impact.trains.map((t, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{t.train_number}</strong></td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{t.train_name}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)', fontSize: '11px' }}>{t.train_type || 'Express'}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)', fontSize: '11.5px' }}>
                          {t.source_station || 'N/A'} ➔ {t.destination_station || 'N/A'}
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{t.current_station || 'In Transit'}</td>
                        <td><span className="status-chip normal">{t.direction || 'UP'}</span></td>
                        <td>
                          <span className={`status-chip ${String(t.priority).toLowerCase() === 'high' || String(t.priority).toLowerCase() === 'critical' ? 'critical' : 'normal'}`}>
                            {t.priority || 'Normal'}
                          </span>
                        </td>
                        <td style={{ color: '#D97706', fontWeight: 600, fontSize: '11.5px' }}>{t.conflict_type}</td>
                        <td>
                          <span className={`status-chip ${String(t.conflict_severity).toLowerCase() === 'high' ? 'critical' : 'warning'}`}>
                            {t.conflict_severity}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>
                          {t.recommendation || 'Hold at previous station or route via alternate line.'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 3: CREWS (ACTUAL ASSIGNED CREWS ONLY) */}
        {selectedCategoryTab === 'crews' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Assigned Crews & Department Logistics</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.crew_impact?.total_crews_involved || 0} Crew(s) Mobilized
              </span>
            </div>
            {(!impactData?.crew_impact?.crews || impactData.crew_impact.crews.length === 0) ? (
              <div style={emptyBoxStyle}>
                <Info size={24} style={{ color: '#38BDF8' }} />
                <span>No crew impact data available for this task.</span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Crew Name / ID</th>
                      <th>Department</th>
                      <th>Crew Type / Specialization</th>
                      <th>Crew Size / Capacity</th>
                      <th>Assigned Task</th>
                      <th>Location</th>
                      <th>Availability</th>
                      <th>Scheduled Window</th>
                      <th>Workload Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.crew_impact.crews.map((c, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{c.name}</strong>
                          {c.crew_id && <span style={{ fontSize: '10.5px', color: 'var(--text-secondary, #94A3B8)', marginLeft: '6px' }}>#{c.crew_id}</span>}
                        </td>
                        <td><span className="status-chip normal">{c.department}</span></td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{c.crew_type}</td>
                        <td style={{ color: 'var(--text-primary, #F5F5F5)', fontWeight: 600 }}>
                          {c.required_crew_size} req / {c.available_capacity} cap
                        </td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>
                          Task #{c.assigned_task_ids?.join(', #') || impactData.target_id}
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{c.location || impactData.block_code}</td>
                        <td>
                          <span className={`status-chip ${String(c.availability).toLowerCase().includes('avail') ? 'completed' : 'medium'}`}>
                            {c.availability || 'Assigned'}
                          </span>
                        </td>
                        <td style={{ color: '#38BDF8', fontSize: '11.5px' }}>
                          {c.scheduled_window || impactData.maintenance_window_impact?.restricted_period || 'Scheduled'}
                        </td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)', fontSize: '11.5px' }}>
                          {c.workload_notes || `Assigned to ${c.tasks_assigned_count || 1} task(s)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 4: DEPARTMENTS */}
        {selectedCategoryTab === 'departments' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Participating Railway Departments</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.departments_detail?.length || impactData?.crew_impact?.departments?.length || 0} Department(s) Involved
              </span>
            </div>
            {(!impactData?.departments_detail || impactData.departments_detail.length === 0) ? (
              <div style={emptyBoxStyle}>
                <Info size={24} style={{ color: '#38BDF8' }} />
                <span>No department coordination requirements modeled.</span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>No. of Tasks</th>
                      <th>Crew Involvement</th>
                      <th>Affected Assets</th>
                      <th>Planned Window</th>
                      <th>Coordination Requirement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.departments_detail.map((d, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{d.department}</strong></td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{d.task_count} task(s)</td>
                        <td style={{ color: '#38BDF8' }}>{d.crews_involved?.join(', ') || 'Department Personnel'}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{d.affected_assets?.join(', ') || impactData.block_code}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{d.planned_window}</td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>{d.coordination_requirement}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 5: RESTRICTED ASSETS & ASSET AVAILABILITY */}
        {selectedCategoryTab === 'restricted_assets' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Restricted Infrastructure Assets & Network Availability</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.restricted_assets_detail?.length || 0} Restricted Asset(s)
              </span>
            </div>

            {/* Asset Availability High-Level Metrics */}
            {impactData?.asset_impact && (
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light, #2A2D32)', background: 'rgba(255, 255, 255, 0.02)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Total Network Assets</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                      {impactData.asset_impact.total_network_assets}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Restricted Assets</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#DC2626', marginTop: '2px' }}>
                      {impactData.asset_impact.restricted_assets}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Operational Assets</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#10B981', marginTop: '2px' }}>
                      {impactData.asset_impact.available_assets}
                    </div>
                  </div>
                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Network Availability</div>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#38BDF8', marginTop: '2px' }}>
                      {impactData.asset_impact.availability_percentage}%
                    </div>
                    {impactData.asset_impact.availability_delta !== undefined && impactData.asset_impact.availability_delta !== 0 && (
                      <div style={{ fontSize: '10px', color: '#D97706', marginTop: '2px' }}>
                        Delta: {impactData.asset_impact.availability_delta > 0 ? `+${impactData.asset_impact.availability_delta}%` : `${impactData.asset_impact.availability_delta}%`}
                      </div>
                    )}
                  </div>
                </div>
                {impactData.asset_impact.note && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary, #CBD5E1)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Info size={14} style={{ color: '#38BDF8' }} />
                    <span>{impactData.asset_impact.note}</span>
                  </div>
                )}
              </div>
            )}

            {/* Restricted assets table */}
            {(!impactData?.restricted_assets_detail || impactData.restricted_assets_detail.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <span>No restricted infrastructure assets for this analysis.</span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Asset Code</th>
                      <th>Asset Name</th>
                      <th>Asset Type</th>
                      <th>Restriction Type</th>
                      <th>Restriction Window</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Affected Operations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.restricted_assets_detail.map((a, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{a.asset_code}</strong></td>
                        <td style={{ fontWeight: 600, color: 'var(--text-primary, #F5F5F5)' }}>{a.asset_name}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{a.asset_type}</td>
                        <td><span className="status-chip warning">{a.restriction_type}</span></td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>{a.restriction_window}</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{a.reason}</td>
                        <td><span className="status-chip critical">{a.status}</span></td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>{a.affected_operations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 6: SPEED RESTRICTIONS */}
        {selectedCategoryTab === 'speed_restrictions' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Imposed Caution Orders & Speed Restrictions</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.speed_restrictions?.length || 0} Caution Order(s)
              </span>
            </div>
            {(!impactData?.speed_restrictions || impactData.speed_restrictions.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>Speed restriction data is not available for this analysis.</strong>
                <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                  No post-work caution orders or speed limits are mandated for this maintenance activity.
                </span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Affected Block / Section</th>
                      <th>Restriction Speed</th>
                      <th>Normal MPS</th>
                      <th>Restriction Window</th>
                      <th>Reason</th>
                      <th>Affected Trains</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.speed_restrictions.map((s, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{s.block_code}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>{s.section_name}</div>
                        </td>
                        <td style={{ color: '#DC2626', fontWeight: 800 }}>{s.restriction_speed_kmph} km/h</td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{s.normal_speed_kmph} km/h</td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>{s.restriction_window}</td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>{s.reason}</td>
                        <td style={{ color: '#D97706', fontWeight: 600 }}>{s.affected_trains_count} train(s) regulated</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 7: POWER BLOCKS */}
        {selectedCategoryTab === 'power_blocks' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">OHE Traction Power Blocks & Isolations</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.power_blocks?.length || 0} Power Block Isolation(s)
              </span>
            </div>
            {(!impactData?.power_blocks || impactData.power_blocks.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>No power-block impact data available for this analysis.</strong>
                <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Traction power de-energization (OHE isolation) is not required for this maintenance task.
                </span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Power Block Type</th>
                      <th>Window</th>
                      <th>Department</th>
                      <th>Affected Assets</th>
                      <th>Operational Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.power_blocks.map((p, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{p.location}</strong></td>
                        <td><span className="status-chip warning">{p.power_block_type}</span></td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>{p.window}</td>
                        <td><span className="status-chip normal">{p.department}</span></td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{p.affected_assets}</td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>{p.operational_effect}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 8: SIGNALLING */}
        {selectedCategoryTab === 'signaling' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Signalling Interlocking & Route Disconnection Impact</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.signalling_impacts?.length || 0} Signalling Restriction(s)
              </span>
            </div>
            {(!impactData?.signalling_impacts || impactData.signalling_impacts.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>No signaling impact data available for this analysis.</strong>
                <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Track circuits, axle counters, and route interlockings operate normally during this window.
                </span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Affected Signalling Asset</th>
                      <th>Location</th>
                      <th>Restriction</th>
                      <th>Window</th>
                      <th>Dependent Maintenance</th>
                      <th>Operational Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.signalling_impacts.map((sig, idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>{sig.signalling_asset}</strong></td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>{sig.location}</td>
                        <td><span className="status-chip critical">{sig.restriction}</span></td>
                        <td style={{ color: '#38BDF8', fontWeight: 600 }}>{sig.window}</td>
                        <td style={{ color: '#38BDF8' }}>{sig.dependent_maintenance}</td>
                        <td style={{ color: 'var(--text-secondary, #CBD5E1)', fontSize: '11.5px' }}>{sig.operational_effect}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* TAB 9: DEPENDENCIES */}
        {selectedCategoryTab === 'dependencies' && (
          <>
            <div className="enterprise-card-header">
              <h3 className="enterprise-card-title">Dependent Maintenance Tasks & Succession Chain</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)' }}>
                {impactData?.dependency_impact?.dependency_chain?.length || 0} Task Link(s)
              </span>
            </div>

            {/* Dependency High-Level Summary */}
            {impactData?.dependency_impact && (
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light, #2A2D32)', background: 'rgba(255, 255, 255, 0.02)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Prerequisites Status</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: impactData.dependency_impact.has_prerequisites ? '#D97706' : '#10B981', marginTop: '2px' }}>
                      {impactData.dependency_impact.has_prerequisites
                        ? `${impactData.dependency_impact.prerequisite_tasks_count} Prerequisite Task(s) Required`
                        : 'No Prerequisites (Independent Task)'}
                    </div>
                  </div>

                  <div style={{ padding: '10px', background: 'var(--bg-card, #151719)', borderRadius: '6px', border: '1px solid var(--border-light, #2A2D32)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Downstream Impact</div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: impactData.dependency_impact.blocks_downstream ? '#EF4444' : '#10B981', marginTop: '2px' }}>
                      {impactData.dependency_impact.blocks_downstream
                        ? `Blocks ${impactData.dependency_impact.downstream_tasks_count} Downstream Task(s)`
                        : 'No Downstream Tasks Blocked'}
                    </div>
                  </div>
                </div>

                {impactData.dependency_impact.dependency_notes && impactData.dependency_impact.dependency_notes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                    {impactData.dependency_impact.dependency_notes.map((note, nIdx) => (
                      <div key={nIdx} style={{ fontSize: '12px', color: 'var(--text-secondary, #CBD5E1)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Info size={14} style={{ color: '#38BDF8', flexShrink: 0 }} />
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Dependency chain table */}
            {(!impactData?.dependency_impact?.dependency_chain || impactData.dependency_impact.dependency_chain.length === 0) ? (
              <div style={emptyBoxStyle}>
                <CheckCircle2 size={24} style={{ color: '#10B981' }} />
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>No modeled dependencies for this maintenance activity.</strong>
                <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                  This task can be executed independently without waiting for or blocking other railway maintenance activities.
                </span>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="enterprise-table">
                  <thead>
                    <tr>
                      <th>Prerequisite Task</th>
                      <th>Dependent Task</th>
                      <th>Dependency Relationship</th>
                      <th>Sequence Step</th>
                      <th>Status / Requirement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impactData.dependency_impact.dependency_chain.map((d, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>Task #{d.prerequisite_id}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>{d.prerequisite_title}</div>
                        </td>
                        <td>
                          <strong style={{ color: '#38BDF8' }}>Task #{d.dependent_id}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>{d.dependent_title}</div>
                        </td>
                        <td><span className="status-chip normal">{d.relation_type}</span></td>
                        <td style={{ color: 'var(--text-secondary, #B9BDC4)' }}>Step {idx + 1}</td>
                        <td>
                          <span className="status-chip warning">
                            Prerequisite must complete before dependent task starts
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

      </div>

      {/* 5. OPERATIONAL OVERVIEW, TRAFFIC & WINDOW CONTEXT */}
      {impactData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px', marginTop: '16px' }}>
          
          {/* Operational Explanation Card */}
          <div className="enterprise-card" style={{ padding: '16px', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Operational Summary & Derivation
              </div>
              <span className={`status-chip ${impactData.impact_level === 'High' ? 'critical' : impactData.impact_level === 'Moderate' ? 'warning' : 'completed'}`}>
                {impactData.impact_level} Impact
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-primary, #E2E8F0)', lineHeight: '1.5', margin: '0 0 10px 0' }}>
              {impactData.explanation}
            </p>
            {impactData.impact_level_explanation && (
              <div style={{ fontSize: '11.5px', color: 'var(--text-secondary, #94A3B8)', background: 'rgba(255, 255, 255, 0.03)', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                {impactData.impact_level_explanation}
              </div>
            )}
          </div>

          {/* Traffic Load & Maintenance Window Details */}
          <div className="enterprise-card" style={{ padding: '16px', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
              Route Traffic & Maintenance Window
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '10px' }}>
              <div style={{ padding: '8px 10px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #94A3B8)' }}>Route Traffic Level</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                  {impactData.traffic_impact?.overall_traffic_level || 'Low'} (Score: {impactData.traffic_impact?.total_traffic_score || 0})
                </div>
              </div>

              <div style={{ padding: '8px 10px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                <div style={{ fontSize: '10.5px', color: 'var(--text-secondary, #94A3B8)' }}>Possession Duration</div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#38BDF8', marginTop: '2px' }}>
                  {impactData.maintenance_window_impact?.duration_minutes || impactData.duration_minutes || 0} minutes
                </div>
              </div>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #CBD5E1)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>Planned Slot: </strong>
                {formatDateTime(impactData.maintenance_window_impact?.planned_start)} to {formatDateTime(impactData.maintenance_window_impact?.planned_end)}
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary, #F5F5F5)' }}>Window Type: </strong>
                {impactData.maintenance_window_impact?.is_coordinated_bundle ? 'Coordinated Multi-Department Bundle' : 'Single Corridor Possession'}
              </div>
              {impactData.traffic_impact?.operational_impact_indicators && impactData.traffic_impact.operational_impact_indicators.length > 0 && (
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#94A3B8' }}>
                  Indicators: {impactData.traffic_impact.operational_impact_indicators.join(' • ')}
                </div>
              )}
            </div>
          </div>

          {/* Baseline vs Optimized Comparison (when available) */}
          {impactData.baseline_vs_optimized && (
            <div className="enterprise-card" style={{ padding: '16px', background: 'var(--bg-card, #151719)', border: '1px solid var(--border-light, #2A2D32)', borderRadius: '8px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#38BDF8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                Optimization Benefit (Baseline vs Coordinated Window)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                <div style={{ padding: '8px 12px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Train Conflicts</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                    {impactData.baseline_vs_optimized.train_conflicts_before ?? '—'} ➔ <span style={{ color: '#10B981' }}>{impactData.baseline_vs_optimized.train_conflicts_after ?? '0'}</span>
                  </div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Possession Duration</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                    {impactData.baseline_vs_optimized.maintenance_duration_before ?? '—'}m ➔ <span style={{ color: '#10B981' }}>{impactData.baseline_vs_optimized.maintenance_duration_after ?? '—'}m</span>
                  </div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Block Closures</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                    {impactData.baseline_vs_optimized.restricted_blocks_before ?? '—'} ➔ <span style={{ color: '#10B981' }}>{impactData.baseline_vs_optimized.restricted_blocks_after ?? '1'}</span>
                  </div>
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--bg-table, #121416)', borderRadius: '4px', border: '1px solid var(--border-light, #2A2D32)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary, #94A3B8)' }}>Available Network Assets</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', marginTop: '2px' }}>
                    {impactData.baseline_vs_optimized.available_assets_before ?? '—'} ➔ <span style={{ color: '#10B981' }}>{impactData.baseline_vs_optimized.available_assets_after ?? '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* 6. DATA SOURCE TRANSPARENCY FOOTNOTE */}
      <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-light, #2A2D32)', fontSize: '11.5px', color: 'var(--text-secondary, #94A3B8)', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Info size={14} style={{ color: '#38BDF8', flexShrink: 0 }} />
        <span>
          Impact metrics are calculated from available RailSync AI database records and modeled operational constraints. Predictive maintenance indicators reflect ML degradation models; train conflicts and block possessions reflect actual scheduled timetable data.
        </span>
      </div>

    </div>
  )
}
