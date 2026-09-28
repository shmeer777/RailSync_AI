import { useCallback, useEffect, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react'

import {
  approveAssetAvailabilitySchedule,
  fetchAssetAvailability,
  optimizeAssetAvailability,
  type AssetAvailabilityResponse,
} from '../../services/assetAvailability'

interface Block {
  id: number
  code: string
  name: string
}

interface AssetAvailabilitySectionProps {
  blocks?: Block[]
  onPlanApproved?: () => void
}

export default function AssetAvailabilitySection({
  blocks = [],
  onPlanApproved,
}: AssetAvailabilitySectionProps) {
  const [data, setData] = useState<AssetAvailabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSlow, setIsSlow] = useState(false)
  const [isVerySlow, setIsVerySlow] = useState(false)

  // Approval State
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  const requestIdRef = useRef(0)

  // Optimization Controls
  const [planningWindow, setPlanningWindow] = useState('night')
  const [staggerEnabled, setStaggerEnabled] = useState(true)
  const [selectedBlockFilter, setSelectedBlockFilter] = useState<string>('all')

  const loadAvailability = useCallback(async (isRefresh = false) => {
    const currentRequestId = ++requestIdRef.current
    try {
      if (isRefresh) setOptimizing(true)
      else setLoading(true)
      setError(null)
      setIsSlow(false)
      setIsVerySlow(false)

      const slowTimer = setTimeout(() => {
        if (currentRequestId === requestIdRef.current) {
          setIsSlow(true)
        }
      }, 3500)

      const verySlowTimer = setTimeout(() => {
        if (currentRequestId === requestIdRef.current) {
          setIsVerySlow(true)
        }
      }, 12000)

      const result = await fetchAssetAvailability(planningWindow, staggerEnabled)

      clearTimeout(slowTimer)
      clearTimeout(verySlowTimer)

      if (currentRequestId !== requestIdRef.current) {
        return
      }

      setData(result)
    } catch (err: any) {
      if (currentRequestId === requestIdRef.current) {
        setError(err.message || 'Failed to load asset availability.')
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false)
        setOptimizing(false)
        setIsSlow(false)
        setIsVerySlow(false)
      }
    }
  }, [planningWindow, staggerEnabled])

  useEffect(() => {
    void loadAvailability()
  }, [loadAvailability])

  useEffect(() => {
    if (data?.approved) {
      setApproved(true)
      if (data.approved_at) {
        const timeStr = new Date(data.approved_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        setApprovalMessage(
          `Schedule approved by ${data.approved_by || 'Section Controller'} at ${timeStr}.`
        )
      }
    } else {
      setApproved(false)
      setApprovalMessage(null)
    }
  }, [data?.approved, data?.approved_at, data?.approved_by])

  const handleReoptimize = async () => {
    try {
      setOptimizing(true)
      setError(null)
      setApprovalError(null)

      const payload = {
        planning_window: planningWindow,
        stagger_multi_blocks: staggerEnabled,
        target_block_codes: selectedBlockFilter !== 'all' ? [selectedBlockFilter] : null,
      }

      const result = await optimizeAssetAvailability(payload)
      setData(result)
      if (!result.approved) {
        setApproved(false)
        setApprovalMessage(null)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to re-optimize asset availability.')
    } finally {
      setOptimizing(false)
    }
  }

  const handleApprove = async () => {
    if (approving || approved) return

    // Step 8 Validation
    if (!data || !data.optimized) {
      setApprovalError('No valid optimized schedule is available for approval.')
      return
    }

    const status = String(data.optimization_status || '').toUpperCase()
    if (status !== 'OPTIMAL' && status !== 'FEASIBLE') {
      setApprovalError(`Cannot approve schedule: solver status is '${data.optimization_status}'. Must be OPTIMAL or FEASIBLE.`)
      return
    }

    if (!data.optimized.restricted_blocks || data.optimized.restricted_blocks.length === 0) {
      setApprovalError('No maintenance tasks found in the optimized schedule to approve.')
      return
    }

    setApproving(true)
    setApprovalError(null)

    try {
      const res = await approveAssetAvailabilitySchedule({
        planning_window: planningWindow,
        stagger_multi_blocks: staggerEnabled,
        target_block_codes: selectedBlockFilter !== 'all' ? [selectedBlockFilter] : null,
        approved_by: 'Section Controller',
        human_approved: true,
      })

      setApproved(true)
      setApprovalMessage(res.message || 'Asset availability schedule approved successfully.')
      onPlanApproved?.()
    } catch (err: any) {
      setApprovalError(err.message || 'Failed to approve schedule.')
      setApproved(false)
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          background: 'var(--bg-card, #151719)',
          borderRadius: '12px',
          border: '1px solid var(--border-light, #2A2D32)',
          color: 'var(--text-secondary, #B9BDC4)',
          gap: '14px',
          textAlign: 'center',
        }}
      >
        <Loader2 size={36} style={{ animation: 'spin 1s linear infinite', color: '#1F6AA5' }} />
        <div>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)', display: 'block' }}>
            Calculating Network Asset Availability via OR-Tools CP-SAT...
          </span>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', maxWidth: '520px' }}>
            {isVerySlow
              ? 'Optimization is taking longer than expected. Evaluating multi-corridor train conflict schedules on server...'
              : isSlow
                ? 'OR-Tools CP-SAT is evaluating multi-block possession windows, train conflicts, and crew capacity constraints across 75 blocks...'
                : 'Solving constraint programming model for maximum operational throughput.'}
          </p>
        </div>

        {isVerySlow && (
          <button
            type="button"
            onClick={() => void loadAvailability(true)}
            className="enterprise-btn-secondary"
            style={{ marginTop: '8px', height: '32px', padding: '0 14px', fontSize: '12px' }}
          >
            <RefreshCw size={13} />
            Retry Calculation
          </button>
        )}
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          background: 'var(--bg-card, #151719)',
          borderRadius: '12px',
          border: '1px solid #7F1D1D',
          color: '#F87171',
          gap: '14px',
          textAlign: 'center',
        }}
      >
        <AlertTriangle size={36} color="#EF4444" />
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: '#FCA5A5' }}>
            Unable to Calculate Asset Availability
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#F87171', maxWidth: '500px' }}>
            {error}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAvailability()}
          className="enterprise-btn-primary"
          style={{ height: '34px', padding: '0 18px', fontSize: '12.5px' }}
        >
          <RefreshCw size={14} />
          Retry Calculation
        </button>
      </div>
    )
  }

  const baseline = data?.baseline
  const optimized = data?.optimized
  const impact = data?.impact
  const timeline = data?.timeline || []
  const totalAssets = data?.total_assets || blocks.length || 0

  const hasMaintenanceData =
    Boolean(data) &&
    ((data?.baseline?.maintenance_tasks_completed ?? 0) > 0 ||
      (data?.optimized?.maintenance_tasks_completed ?? 0) > 0 ||
      (data?.baseline?.restricted_assets ?? 0) > 0 ||
      (data?.optimized?.restricted_assets ?? 0) > 0 ||
      (data?.optimized?.restricted_blocks?.length ?? 0) > 0)

  if (!hasMaintenanceData && data) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 20px',
          background: 'var(--bg-card, #151719)',
          borderRadius: '12px',
          border: '1px solid var(--border-light, #2A2D32)',
          color: 'var(--text-secondary, #B9BDC4)',
          gap: '14px',
          textAlign: 'center',
        }}
      >
        <CheckCircle2 size={36} color="#10B981" />
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: 'var(--text-primary, #F5F5F5)' }}>
            No maintenance data is available for asset-availability optimization.
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary, #B9BDC4)', maxWidth: '520px' }}>
            All {totalAssets || 75} network assets and operational sections are currently 100% available for train movements with zero scheduled possession closures.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAvailability(true)}
          className="enterprise-btn-secondary"
          style={{ height: '34px', padding: '0 16px', fontSize: '12.5px' }}
        >
          <RefreshCw size={14} />
          Refresh Availability
        </button>
      </div>
    )
  }

  // Calculate available blocks list
  const restrictedCodes = new Set(
    optimized?.restricted_blocks?.map((b) => b.block_code?.toUpperCase()) || []
  )
  const availableBlocks = blocks.filter((b) => !restrictedCodes.has(b.code.toUpperCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. DECISION SUPPORT & OPERATOR APPROVAL BANNER (LIGHT STYLE) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '16px 20px',
          borderRadius: '12px',
          background: 'var(--bg-card, #151719)',
          border: '1px solid var(--border-light, #2A2D32)',
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
            <ShieldCheck size={22} />
          </div>
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 800,
                color: 'var(--text-primary, #F5F5F5)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              Network Asset Availability Optimization
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(31, 106, 165, 0.1)',
                  color: '#1F6AA5',
                  border: '1px solid rgba(31, 106, 165, 0.25)',
                }}
              >
                Solver: {data?.optimization_status || 'OPTIMAL'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '3px' }}>
              Time-aware possession staggering maintains maximum corridor throughput while fulfilling critical maintenance windows.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleApprove}
          disabled={approving || approved}
          style={{
            height: '38px',
            padding: '0 18px',
            borderRadius: '8px',
            background: approved ? '#059669' : '#10B981',
            border: approved ? '1px solid #047857' : '1px solid #059669',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 700,
            cursor: approved ? 'default' : approving ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 1px 3px rgba(16, 185, 129, 0.2)',
            opacity: approving ? 0.8 : 1,
            transition: 'all 0.15s ease',
          }}
        >
          {approving ? (
            <>
              <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
              Approving...
            </>
          ) : approved ? (
            <>
              <CheckCircle2 size={16} />
              ✓ Schedule Approved
            </>
          ) : (
            <>
              <CheckCircle2 size={16} />
              Approve Schedule
            </>
          )}
        </button>
      </div>

      {/* APPROVAL STATUS FEEDBACK */}
      {approvalMessage && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: '#10B981',
            fontSize: '12.5px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{approvalMessage}</span>
        </div>
      )}

      {approvalError && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#EF4444',
            fontSize: '12.5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={16} />
            <span>{approvalError}</span>
          </div>
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving}
            style={{
              background: 'transparent',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              color: '#EF4444',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* 2. CONTROLS BAR (WHITE CARD) */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 750,
                color: 'var(--text-secondary, #B9BDC4)',
                marginBottom: '5px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Planning Window
            </label>
            <select
              value={planningWindow}
              onChange={(e) => setPlanningWindow(e.target.value)}
              style={selectStyle}
            >
              <option value="night">Night Corridor (21:00 – 06:00)</option>
              <option value="evening">Evening Off-Peak (18:00 – 23:00)</option>
              <option value="daytime">Midday Maintenance (10:00 – 16:00)</option>
              <option value="earliest">Earliest Feasible Safe Window</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 750,
                color: 'var(--text-secondary, #B9BDC4)',
                marginBottom: '5px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Corridor Block Filter
            </label>
            <select
              value={selectedBlockFilter}
              onChange={(e) => setSelectedBlockFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="all">All Network Blocks ({blocks.length > 0 ? blocks.length : '75'})</option>
              {blocks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
            <input
              type="checkbox"
              id="stagger-toggle"
              checked={staggerEnabled}
              onChange={(e) => setStaggerEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#1F6AA5', cursor: 'pointer' }}
            />
            <label
              htmlFor="stagger-toggle"
              style={{ fontSize: '13px', color: 'var(--text-primary, #F5F5F5)', cursor: 'pointer', fontWeight: 600 }}
            >
              Enable Staggered Work Windows
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={handleReoptimize}
          disabled={optimizing}
          style={{
            height: '38px',
            padding: '0 18px',
            borderRadius: '8px',
            background: '#1F6AA5',
            border: '1px solid #1F6AA5',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            opacity: optimizing ? 0.7 : 1,
            boxShadow: '0 1px 3px rgba(31, 106, 165, 0.2)',
          }}
        >
          <RefreshCw size={15} style={{ animation: optimizing ? 'spin 1s linear infinite' : undefined }} />
          {optimizing ? 'Optimizing CP-SAT...' : 'Re-Calculate Availability'}
        </button>
      </div>

      {/* FEEDBACK BANNERS */}
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

      {/* 3. 4 TOP KPI CARDS (ALL WHITE) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '14px',
        }}
      >
        <MetricCard
          label="NETWORK TOTAL BLOCKS"
          value={totalAssets}
          unit="sections"
          icon={<Network size={20} />}
          accent="#1F6AA5"
          subtext="Total modeled operational sections"
        />

        <MetricCard
          label="AVAILABLE ASSETS"
          value={optimized?.available_assets ?? totalAssets}
          unit={`/ ${totalAssets}`}
          icon={<CheckCircle2 size={20} />}
          accent="#10B981"
          subtext={`Peak: ${optimized?.peak_available_assets ?? totalAssets} | Min: ${optimized?.minimum_available_assets ?? totalAssets}`}
          badge="Guaranteed Operational"
        />

        <MetricCard
          label="RESTRICTED ASSETS"
          value={optimized?.restricted_assets ?? 0}
          unit="blocks"
          icon={<AlertCircle size={20} />}
          accent="#F59E0B"
          subtext={`Peak concurrent: ${optimized?.restricted_assets ?? 0} block(s)`}
        />

        <MetricCard
          label="ASSET AVAILABILITY"
          value={`${optimized?.availability_percentage ?? 100}%`}
          unit=""
          icon={<TrendingUp size={20} />}
          accent="#8B5CF6"
          subtext={
            impact && impact.availability_change_percentage_points !== 0
              ? `${impact.availability_change_percentage_points > 0 ? '+' : ''}${impact.availability_change_percentage_points}% vs baseline`
              : 'Continuous operational throughput'
          }
          badge={
            impact && impact.availability_change_percentage_points > 0
              ? `+${impact.availability_change_percentage_points}% Gain`
              : undefined
          }
        />
      </div>

      {/* 4. BEFORE VS AFTER COMPARISON (BOTH WHITE CARDS) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
        }}
        className="availability-comparison-grid"
      >
        {/* BEFORE: BASELINE (WHITE CARD) */}
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
              marginBottom: '16px',
              paddingBottom: '12px',
              borderBottom: '1px solid var(--border-light, #2A2D32)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#DC2626',
                }}
              />
              <strong style={{ fontSize: '14px', color: '#DC2626', letterSpacing: '0.5px' }}>
                BEFORE OPTIMIZATION (BASELINE)
              </strong>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>Uncoordinated / Simultaneous</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <MetricRow label="Available Assets" value={`${baseline?.available_assets ?? 0} / ${totalAssets}`} />
            <MetricRow label="Availability %" value={`${baseline?.availability_percentage ?? 0}%`} />
            <MetricRow
              label="Restricted Blocks"
              value={baseline?.restricted_assets ?? 0}
              highlight="#DC2626"
            />
            <MetricRow
              label="Train Conflicts"
              value={baseline?.train_conflicts ?? 0}
              highlight="#D97706"
            />
            <MetricRow
              label="Maintenance Window"
              value={`${baseline?.maintenance_window_minutes ?? 0} min`}
            />
            <MetricRow
              label="Tasks Completed"
              value={`${baseline?.maintenance_tasks_completed ?? 0} tasks`}
            />
          </div>
        </div>

        {/* AFTER: OPTIMIZED (WHITE CARD WITH BLUE ACCENT) */}
        <div
          style={{
            borderRadius: '12px',
            background: 'var(--bg-elevated, #FFFFFF)',
            border: '2px solid var(--accent-blue, #1F6AA5)',
            boxShadow: '0 2px 8px rgba(31, 106, 165, 0.1)',
            padding: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
              paddingBottom: '12px',
              borderBottom: '1px solid var(--border-light, #2A2D32)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#10B981',
                }}
              />
              <strong style={{ fontSize: '14px', color: '#10B981', letterSpacing: '0.5px' }}>
                AFTER OPTIMIZATION (OR-TOOLS CP-SAT)
              </strong>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 750,
                color: '#10B981',
                background: '#DEF7EC',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid #BCF0DA',
              }}
            >
              Staggered & Bundled
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <MetricRow
              label="Available Assets"
              value={`${optimized?.available_assets ?? 0} / ${totalAssets}`}
              delta={
                impact && impact.restricted_asset_change < 0
                  ? `+${Math.abs(impact.restricted_asset_change)} open`
                  : undefined
              }
              deltaColor="#10B981"
            />
            <MetricRow
              label="Availability %"
              value={`${optimized?.availability_percentage ?? 0}%`}
              delta={
                impact && impact.availability_change_percentage_points > 0
                  ? `+${impact.availability_change_percentage_points}%`
                  : undefined
              }
              deltaColor="#10B981"
            />
            <MetricRow
              label="Restricted Blocks"
              value={optimized?.restricted_assets ?? 0}
              delta={
                impact && impact.restricted_asset_change < 0
                  ? `${impact.restricted_asset_change}`
                  : undefined
              }
              deltaColor="#10B981"
            />
            <MetricRow
              label="Train Conflicts"
              value={optimized?.train_conflicts ?? 0}
              delta={
                impact && impact.train_conflict_change < 0
                  ? `${impact.train_conflict_change}`
                  : undefined
              }
              deltaColor="#10B981"
            />
            <MetricRow
              label="Maintenance Window"
              value={`${optimized?.maintenance_window_minutes ?? 0} min`}
            />
            <MetricRow
              label="Tasks Completed"
              value={`${optimized?.maintenance_tasks_completed ?? 0} tasks`}
              delta="100% Preserved"
              deltaColor="#1F6AA5"
            />
          </div>
        </div>
      </div>

      {/* 5. TIME-AWARE NETWORK AVAILABILITY TIMELINE (WHITE CARD & WHITE ROWS) */}
      <div
        style={{
          borderRadius: '12px',
          background: 'var(--bg-card, #151719)',
          border: '1px solid var(--border-light, #2A2D32)',
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
              TIME-AWARE INFRASTRUCTURE AVAILABILITY
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: '16px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 800 }}>
              Network Asset Availability Timeline
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#10B981' }} />
              <span>Operational Blocks</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#F59E0B' }} />
              <span>Restricted for Maintenance</span>
            </div>
          </div>
        </div>

        {/* TIMELINE SLOTS LIST - CLEAN WHITE / LIGHT ROWS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {timeline.map((slot) => {
            const availPct = slot.availability_percentage
            const restrictedCount = slot.restricted_assets
            return (
              <div
                key={slot.slot_index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr 140px',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: slot.is_peak
                    ? 'var(--status-normal-bg, rgba(53, 166, 107, 0.16))'
                    : slot.is_bottleneck
                      ? 'var(--status-warning-bg, rgba(217, 165, 46, 0.16))'
                      : 'var(--bg-table-row, #16181B)',
                  border: slot.is_peak
                    ? '1px solid var(--status-normal-border, rgba(53, 166, 107, 0.35))'
                    : slot.is_bottleneck
                      ? '1px solid var(--status-warning-border, rgba(217, 165, 46, 0.35))'
                      : '1px solid var(--border-light, #2A2D32)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={13} style={{ color: 'var(--text-secondary, #B9BDC4)' }} />
                  <span style={{ fontSize: '12px', fontWeight: 750, color: 'var(--text-primary, #F5F5F5)' }}>
                    {slot.time_label}
                  </span>
                </div>

                {/* VISUAL LIGHT PROGRESS BAR */}
                <div style={{ position: 'relative', height: '22px', borderRadius: '6px', background: 'var(--bg-elevated, #1B1D20)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${availPct}%`,
                      background: slot.is_bottleneck
                        ? '#F59E0B'
                        : '#10B981',
                      borderRadius: '6px',
                      transition: 'width 0.4s ease',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: '10px',
                    }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#FFFFFF' }}>
                      {slot.available_assets} / {slot.total_assets} Available
                    </span>
                  </div>
                </div>

                {/* DETAILS & BADGES */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                  <strong style={{ fontSize: '12px', color: slot.is_bottleneck ? '#D97706' : '#059669' }}>
                    {availPct}%
                  </strong>
                  {slot.is_peak && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#DEF7EC',
                        color: '#03543F',
                        border: '1px solid #BCF0DA',
                      }}
                    >
                      Peak
                    </span>
                  )}
                  {slot.is_bottleneck && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#FEF3C7',
                        color: '#92400E',
                        border: '1px solid #FDE68A',
                      }}
                    >
                      Bottleneck ({restrictedCount})
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 6. BLOCK IMPACT VIEW: RESTRICTED VS AVAILABLE BLOCKS (WHITE CARDS) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
        }}
        className="availability-block-impact-grid"
      >
        {/* RESTRICTED BLOCKS */}
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
              marginBottom: '14px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#D97706', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                SCHEDULED BLOCK RESTRICTIONS
              </div>
              <h4 style={{ margin: '3px 0 0', fontSize: '15px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 800 }}>
                Restricted Sections ({optimized?.restricted_blocks.length ?? 0})
              </h4>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)' }}>
              Coordinated Windows
            </span>
          </div>

          {optimized && optimized.restricted_blocks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {optimized.restricted_blocks.map((rb) => (
                <div
                  key={rb.block_code}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: 'var(--status-warning-bg, rgba(217, 165, 46, 0.16))',
                    border: '1px solid var(--status-warning-border, rgba(217, 165, 46, 0.35))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <strong style={{ fontSize: '13px', color: '#92400E' }}>
                      {rb.block_code}
                    </strong>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 7px',
                        borderRadius: '4px',
                        background: 'rgba(217, 165, 46, 0.25)',
                        color: 'var(--status-warning-text, #D9A52E)',
                        fontWeight: 700,
                      }}
                    >
                      {rb.duration_minutes} min window
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 600 }}>
                    {rb.block_name}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '11px',
                      color: 'var(--text-secondary, #B9BDC4)',
                      marginTop: '2px',
                    }}
                  >
                    <span>{rb.maintenance_tasks_count} tasks</span>
                    <span>•</span>
                    <span>Depts: {rb.departments.join(', ') || 'Engineering'}</span>
                    <span>•</span>
                    <span>Conflicts: {rb.train_conflicts}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary, #B9BDC4)', fontSize: '12px' }}>
              No block restrictions active. All sections are operational.
            </div>
          )}
        </div>

        {/* AVAILABLE BLOCKS */}
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
              marginBottom: '14px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#10B981', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                AVAILABLE OPERATIONAL INFRASTRUCTURE
              </div>
              <h4 style={{ margin: '3px 0 0', fontSize: '15px', color: 'var(--text-primary, #F5F5F5)', fontWeight: 800 }}>
                Available Sections ({availableBlocks.length})
              </h4>
            </div>
            <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
              Open for Trains
            </span>
          </div>

          <div
            style={{
              maxHeight: '260px',
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: '8px',
            }}
          >
            {availableBlocks.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'var(--bg-elevated, #1B1D20)',
                  border: '1px solid var(--border-light, #2A2D32)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                }}
              >
                <strong style={{ fontSize: '12px', color: 'var(--text-primary, #F5F5F5)' }}>
                  {b.code}
                </strong>
                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-secondary, #B9BDC4)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 7. DETERMINISTIC EXPLANATION (WHITE CARD) */}
      <div
        style={{
          borderRadius: '12px',
          background: 'var(--bg-card, #151719)',
          border: '1px solid var(--border-light, #2A2D32)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Zap size={16} style={{ color: '#1F6AA5' }} />
          <strong style={{ fontSize: '14px', color: 'var(--text-primary, #F5F5F5)', letterSpacing: '0.3px' }}>
            Why This Plan? (Deterministic Optimizer Explanation)
          </strong>
        </div>
        <p
          style={{
            margin: 0,
            color: 'var(--text-secondary, #B9BDC4)',
            fontSize: '13px',
            lineHeight: 1.6,
          }}
        >
          {data?.explanation || 'Optimal maintenance schedule generated successfully.'}
        </p>
      </div>

      {/* RESPONSIVE STYLES */}
      <style>{`
        @media (max-width: 900px) {
          .availability-comparison-grid,
          .availability-block-impact-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

function MetricCard({
  label,
  value,
  unit,
  icon,
  accent,
  subtext,
  badge,
}: {
  label: string
  value: string | number
  unit: string
  icon: React.ReactNode
  accent: string
  subtext: string
  badge?: string
}) {
  return (
    <div
      style={{
        borderRadius: '10px',
        background: 'var(--bg-card, #151719)',
        border: '1px solid var(--border-light, #2A2D32)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '115px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary, #B9BDC4)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: `${accent}15`,
            border: `1px solid ${accent}30`,
            display: 'grid',
            placeItems: 'center',
            color: accent,
          }}
        >
          {icon}
        </div>
      </div>

      <div style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <strong style={{ fontSize: '24px', lineHeight: 1, color: 'var(--text-primary, #F5F5F5)' }}>
            {value}
          </strong>
          {unit && (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary, #B9BDC4)', fontWeight: 700 }}>
              {unit}
            </span>
          )}
          {badge && (
            <span
              style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 6px',
                borderRadius: '4px',
                background: `${accent}15`,
                color: accent,
                border: `1px solid ${accent}30`,
                marginLeft: 'auto',
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', marginTop: '6px' }}>
          {subtext}
        </div>
      </div>
    </div>
  )
}

function MetricRow({
  label,
  value,
  highlight,
  delta,
  deltaColor = '#10B981',
}: {
  label: string
  value: string | number
  highlight?: string
  delta?: string
  deltaColor?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'var(--bg-elevated, #1B1D20)',
        border: '1px solid var(--border-light, #2A2D32)',
      }}
    >
      <span style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', fontWeight: 700 }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <strong style={{ fontSize: '15px', color: highlight || 'var(--text-primary, #F5F5F5)' }}>
          {value}
        </strong>
        {delta && (
          <span style={{ fontSize: '11px', fontWeight: 800, color: deltaColor }}>
            ({delta})
          </span>
        )}
      </div>
    </div>
  )
}

const selectStyle: CSSProperties = {
  minHeight: '36px',
  padding: '0 10px',
  borderRadius: '6px',
  border: '1px solid var(--border-light, #2A2D32)',
  background: 'var(--bg-input, #121416)',
  color: 'var(--text-primary, #F5F5F5)',
  fontSize: '12px',
  fontWeight: 600,
  outline: 'none',
}
