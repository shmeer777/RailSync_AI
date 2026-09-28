import { useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  ShieldCheck,
} from 'lucide-react'
import type { MaintenanceBundle, BundleTask } from '../../services/maintenanceBundles'
import { useIsDarkMode } from '../network/NetworkOverviewCard'

interface MaintenanceBundlesSectionProps {
  bundles: MaintenanceBundle[]
  blocks?: { id: number; code: string; name: string }[]
  loading?: boolean
  optimizing?: boolean
  error?: string | null
  onOptimize: (blockCode?: string, windowPref?: string) => Promise<void>
  onFilterChange?: (blockCode?: string) => void
}

function formatTime(isoStr?: string | null, fallbackMin?: number): string {
  if (!isoStr) return fallbackMin !== undefined ? `${fallbackMin}m` : '—'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return fallbackMin !== undefined ? `${fallbackMin}m` : isoStr
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return fallbackMin !== undefined ? `${fallbackMin}m` : isoStr
  }
}

export default function MaintenanceBundlesSection({
  bundles,
  blocks = [],
  loading = false,
  optimizing = false,
  error = null,
  onOptimize,
  onFilterChange,
}: MaintenanceBundlesSectionProps) {
  const isDark = useIsDarkMode()
  const [selectedBlock, setSelectedBlock] = useState<string>('ALL')
  const [selectedWindow, setSelectedWindow] = useState<string>('night')
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Track expanded state for each bundle independently
  const [expandedBundles, setExpandedBundles] = useState<Record<string, boolean>>(() => {
    if (bundles.length === 1) {
      return { [bundles[0].bundle_id]: true }
    }
    return {}
  })

  const toggleExpand = (bundleId: string) => {
    setExpandedBundles((prev) => ({
      ...prev,
      [bundleId]: !prev[bundleId],
    }))
  }

  const handleOptimizeClick = async () => {
    setActionSuccess(null)
    setActionError(null)
    try {
      const code = selectedBlock === 'ALL' ? undefined : selectedBlock
      await onOptimize(code, selectedWindow)
      setActionSuccess('Multi-department bundles optimized & synchronized successfully.')
      setTimeout(() => setActionSuccess(null), 5000)
    } catch (err: any) {
      setActionError(err.message || 'Optimization request failed.')
    }
  }

  const handleBlockSelect = (code: string) => {
    setSelectedBlock(code)
    onFilterChange?.(code === 'ALL' ? undefined : code)
  }

  return (
    <section
      style={{
        marginBottom: '24px',
        border: '1px solid var(--border-light, #D9E1E8)',
        borderRadius: '12px',
        background: 'var(--bg-card, #FFFFFF)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
      }}
    >
      {/* SECTION HEADER */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          padding: '18px 22px',
          borderBottom: '1px solid var(--border-light, #D9E1E8)',
          background: 'var(--bg-elevated, #FFFFFF)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
            <Boxes size={22} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                Multi-Department Maintenance Bundles
              </h2>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  background: 'rgba(31, 106, 165, 0.1)',
                  color: '#1F6AA5',
                  border: '1px solid rgba(31, 106, 165, 0.25)',
                }}
              >
                OR-Tools CP-SAT
              </span>
            </div>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary, #5B6B79)', fontSize: '12px' }}>
              Intelligently coordinates multi-department tasks on the same railway block into a unified maintenance window.
            </p>
          </div>
        </div>

        {/* CONTROLS BAR: Block Filter, Window Selector, Optimize Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Block Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Filter size={14} style={{ color: 'var(--text-secondary, #5B6B79)' }} />
            <select
              value={selectedBlock}
              onChange={(e) => handleBlockSelect(e.target.value)}
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
              <option value="ALL">All Blocks</option>
              {blocks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} ({b.name})
                </option>
              ))}
            </select>
          </div>

          {/* Planning Window Selector */}
          <select
            value={selectedWindow}
            onChange={(e) => setSelectedWindow(e.target.value)}
            style={{
              height: '36px',
              padding: '0 10px',
              borderRadius: '7px',
              background: 'var(--bg-card, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
              color: 'var(--text-primary, #172B3A)',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="night">Night Corridor (21:00 - 06:00)</option>
            <option value="evening">Evening Off-Peak (18:00 - 23:00)</option>
            <option value="daytime">Daytime Window (10:00 - 16:00)</option>
            <option value="earliest">Earliest Feasible Safe Window</option>
          </select>

          {/* Optimize Button */}
          <button
            type="button"
            onClick={handleOptimizeClick}
            disabled={optimizing || loading}
            style={{
              height: '36px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '0 16px',
              border: '1px solid #1F6AA5',
              borderRadius: '7px',
              background: '#1F6AA5',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 750,
              cursor: optimizing || loading ? 'not-allowed' : 'pointer',
              opacity: optimizing || loading ? 0.7 : 1,
              boxShadow: '0 1px 3px rgba(31, 106, 165, 0.2)',
            }}
          >
            {optimizing ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Layers size={15} />
            )}
            {optimizing ? 'Optimizing CP-SAT...' : 'Optimize Bundle'}
          </button>
        </div>
      </div>

      {/* DECISION-SUPPORT SAFEGUARD BANNER */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 22px',
          background: isDark ? 'rgba(217, 119, 6, 0.12)' : '#FFFBEB',
          borderBottom: isDark ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid #FDE68A',
          color: isDark ? '#FDE68A' : '#92400E',
          fontSize: '11.5px',
          lineHeight: 1.4,
        }}
      >
        <ShieldCheck size={16} style={{ flexShrink: 0, color: isDark ? '#FBBF24' : '#D97706' }} />
        <span>
          <strong style={{ color: isDark ? '#FDE68A' : '#92400E' }}>Decision-Support Safeguard:</strong> Bundled block plans are automated optimization schedules generated using OR-Tools CP-SAT to maximize Indian Railways track availability. Human Section Controllers & Station Masters retain final authority to review, approve, and execute block closures.
        </span>
      </div>

      {/* FEEDBACK BANNERS */}
      {actionSuccess && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 22px',
            background: isDark ? 'rgba(16, 185, 129, 0.15)' : '#F0FDF4',
            borderBottom: isDark ? '1px solid rgba(52, 211, 153, 0.35)' : '1px solid #BBF7D0',
            color: isDark ? '#34D399' : '#166534',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <CheckCircle2 size={15} /> {actionSuccess}
        </div>
      )}

      {(actionError || error) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '10px 22px',
            background: isDark ? 'rgba(239, 68, 68, 0.15)' : '#FEF2F2',
            borderBottom: isDark ? '1px solid rgba(248, 113, 113, 0.35)' : '1px solid #FECACA',
            color: isDark ? '#F87171' : '#991B1B',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={15} />
            <span>{actionError || error}</span>
          </div>
          <button
            type="button"
            onClick={handleOptimizeClick}
            disabled={optimizing}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid #FECACA',
              background: '#FFFFFF',
              color: '#991B1B',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Retry Optimization
          </button>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary, #5B6B79)' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', color: '#1F6AA5' }} />
            <p style={{ margin: 0, fontSize: '13px' }}>Evaluating block schedules with OR-Tools CP-SAT...</p>
          </div>
        ) : bundles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary, #5B6B79)' }}>
            <Boxes size={36} style={{ margin: '0 auto 12px', opacity: 0.4, color: '#1F6AA5' }} />
            <h3 style={{ margin: '0 0 6px', color: 'var(--text-primary, #172B3A)', fontSize: '15px' }}>No Active Bundles Found</h3>
            <p style={{ margin: '0 0 16px', fontSize: '12px' }}>
              No multi-task combinations currently detected on active blocks. Select a specific block or run optimizer.
            </p>
            <button
              type="button"
              onClick={handleOptimizeClick}
              disabled={optimizing}
              style={{
                padding: '8px 18px',
                background: '#1F6AA5',
                color: '#FFFFFF',
                borderRadius: '7px',
                border: 'none',
                fontWeight: 750,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Scan & Plan Bundles
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {bundles.map((bundle) => (
              <SingleBundleCard
                key={bundle.bundle_id}
                bundle={bundle}
                isExpanded={Boolean(expandedBundles[bundle.bundle_id])}
                onToggle={() => toggleExpand(bundle.bundle_id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function SingleBundleCard({
  bundle,
  isExpanded,
  onToggle,
}: {
  bundle: MaintenanceBundle
  isExpanded: boolean
  onToggle: () => void
}) {
  const isDark = useIsDarkMode()
  const windowTimeStr =
    bundle.start_time && bundle.end_time
      ? `${formatTime(bundle.start_time)}–${formatTime(bundle.end_time)}`
      : `${bundle.total_window_minutes} min`

  // Sort tasks by sequence_order or start_minute
  const sortedTasks = [...bundle.tasks].sort((a, b) => {
    if (a.sequence_order !== b.sequence_order) return a.sequence_order - b.sequence_order
    return a.start_minute - b.start_minute
  })

  // Quick lookup of task by ID
  const taskMap = new Map<number, BundleTask>()
  bundle.tasks.forEach((t) => taskMap.set(t.id, t))

  return (
    <article
      style={{
        border: '1px solid var(--border-light, #D9E1E8)',
        borderRadius: '10px',
        background: 'var(--bg-card, #FFFFFF)',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
      }}
    >
      {/* 1. CARD TOP SUMMARY HEADER (Always Visible) */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '16px 20px',
          background: 'var(--bg-elevated, #F8FAFC)',
          borderBottom: isExpanded ? '1px solid var(--border-light, #D9E1E8)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#1F6AA5', fontFamily: 'monospace' }}>
                {bundle.bundle_id}
              </span>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-primary, #172B3A)' }}>
                {bundle.block_name || bundle.block_code}
              </h3>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary, #5B6B79)', marginTop: '2px' }}>
              Corridor Section: <strong>{bundle.block_code}</strong> • {bundle.total_tasks} Tasks Bundled
            </div>
          </div>

          {/* Department Chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {bundle.departments.map((dept) => (
              <span
                key={dept}
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: '#EBF3FA',
                  color: '#1F6AA5',
                  fontSize: '11px',
                  fontWeight: 700,
                  border: '1px solid #BFDBFE',
                }}
              >
                {dept}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              background: '#FEF3C7',
              border: '1px solid #FDE68A',
              color: '#92400E',
              fontSize: '10.5px',
              fontWeight: 800,
            }}
          >
            Approval Required
          </span>

          {/* VIEW DETAILS / HIDE DETAILS TOGGLE BUTTON */}
          <button
            type="button"
            onClick={onToggle}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '6px',
              background: isExpanded ? 'var(--accent-blue-subtle, #EBF3FA)' : 'var(--bg-card, #FFFFFF)',
              border: '1px solid #1F6AA5',
              color: '#1F6AA5',
              fontSize: '12px',
              fontWeight: 750,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {isExpanded ? 'Hide Details' : 'View Details'}
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* 2. HIGH-LEVEL BEFORE VS AFTER SUMMARY ROW (WHITE CARDS) */}
      <div style={{ padding: '16px 20px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          {/* BEFORE */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: '8px',
              background: isDark ? 'rgba(225, 29, 72, 0.12)' : '#FFF1F2',
              border: isDark ? '1px solid rgba(244, 63, 94, 0.35)' : '1px solid #FECDD3',
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, color: isDark ? '#FB7185' : '#9F1239', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              BEFORE (Separate Closures)
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary, #F5F5F5)', margin: '4px 0 2px' }}>
              {bundle.unbundled_total_minutes} min
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.4 }}>
              {bundle.total_tasks} separate closures • {bundle.train_conflicts_before ?? 0} train conflicts
            </div>
          </div>

          {/* AFTER */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: '8px',
              background: isDark ? 'rgba(2, 132, 199, 0.12)' : '#F0F9FF',
              border: isDark ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid #BAE6FD',
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, color: isDark ? '#38BDF8' : '#0369A1', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              AFTER (Coordinated Window)
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: isDark ? '#38BDF8' : '#0369A1', margin: '4px 0 2px' }}>
              {bundle.total_window_minutes} min
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.4 }}>
              1 unified window ({windowTimeStr}) • {bundle.train_conflicts_after ?? 0} conflicts
            </div>
          </div>

          {/* TIME SAVED */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: '8px',
              background: isDark ? 'rgba(16, 185, 129, 0.12)' : '#F0FDF4',
              border: isDark ? '1px solid rgba(52, 211, 153, 0.35)' : '1px solid #BBF7D0',
            }}
          >
            <div style={{ fontSize: '10px', fontWeight: 800, color: isDark ? '#34D399' : '#166534', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              SAVINGS & GAINS
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: isDark ? '#34D399' : '#10B981', margin: '4px 0 2px' }}>
              +{bundle.time_saved_minutes} min ({bundle.percent_time_saved}% saved)
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary, #B9BDC4)', lineHeight: 1.4 }}>
              {bundle.block_closures_avoided ?? 0} closures avoided • Conflicts: {bundle.train_conflicts_before ?? 0} → {bundle.train_conflicts_after ?? 0}
            </div>
          </div>
        </div>
      </div>

      {/* 3. EXPANDED DETAILED BUNDLE VIEW */}
      {isExpanded && (
        <div
          style={{
            padding: '0 20px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            borderTop: '1px solid #D9E1E8',
            paddingTop: '20px',
          }}
        >
          {/* SECTION A: BUNDLE OVERVIEW (WHITE CARD) */}
          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              background: 'var(--bg-card, #F8FAFC)',
              border: '1px solid var(--border-light, #E2E8F0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <Info size={16} style={{ color: '#1F6AA5' }} />
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#1F6AA5', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Bundle Overview
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '12px',
              }}
            >
              <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary, #5B6B79)', textTransform: 'uppercase' }}>Bundle ID</span>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#1F6AA5', fontFamily: 'monospace', marginTop: '2px' }}>
                  {bundle.bundle_id}
                </div>
              </div>

              <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary, #5B6B79)', textTransform: 'uppercase' }}>Block Code & Name</span>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', marginTop: '2px' }}>
                  {bundle.block_code}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)' }}>{bundle.block_name}</div>
              </div>

              <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary, #5B6B79)', textTransform: 'uppercase' }}>Planning Window</span>
                <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary, #172B3A)', marginTop: '2px' }}>
                  {bundle.planning_window || 'Night Corridor (21:00 - 06:00)'}
                </div>
              </div>

              <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary, #5B6B79)', textTransform: 'uppercase' }}>Scheduled Span</span>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#10B981', fontFamily: 'monospace', marginTop: '2px' }}>
                  {windowTimeStr}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)' }}>Total: {bundle.total_window_minutes} min</div>
              </div>

              <div style={{ padding: '10px 12px', background: 'var(--bg-elevated, #FFFFFF)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary, #5B6B79)', textTransform: 'uppercase' }}>Optimization Status</span>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#10B981', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <CheckCircle2 size={14} /> {bundle.optimization_status}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION B: LIGHT TASK EXECUTION TIMELINE */}
          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              background: 'var(--bg-card, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={16} style={{ color: '#1F6AA5' }} />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  Task Execution Timeline (Light Coordinated View)
                </span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', fontFamily: 'monospace' }}>
                Coordinated Window: {windowTimeStr} ({bundle.total_window_minutes} min)
              </span>
            </div>

            {/* Time axis ruler */}
            <div style={{ position: 'relative', marginBottom: '18px', padding: '0 4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary, #5B6B79)', marginBottom: '6px' }}>
                <span>{formatTime(bundle.start_time, 0)} (0m)</span>
                <span>22:00 (60m)</span>
                <span>23:00 (120m)</span>
                <span>{formatTime(bundle.end_time, bundle.total_window_minutes)} ({bundle.total_window_minutes}m)</span>
              </div>
              <div style={{ height: '4px', background: '#E2E8F0', borderRadius: '2px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '0%', top: '-4px', width: '2px', height: '12px', background: '#1F6AA5' }} />
                <div style={{ position: 'absolute', left: '40%', top: '-4px', width: '2px', height: '12px', background: '#1F6AA5' }} />
                <div style={{ position: 'absolute', left: '80%', top: '-4px', width: '2px', height: '12px', background: '#1F6AA5' }} />
                <div style={{ position: 'absolute', left: '100%', top: '-4px', width: '2px', height: '12px', background: '#1F6AA5', transform: 'translateX(-2px)' }} />
              </div>
            </div>

            {/* Timeline Bars per task */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sortedTasks.map((task) => {
                const maxMinutes = bundle.total_window_minutes || 150
                const leftPercent = Math.max(0, Math.min(100, (task.start_minute / maxMinutes) * 100))
                const widthPercent = Math.max(15, Math.min(100 - leftPercent, (task.duration_minutes / maxMinutes) * 100))

                const isElec = task.department === 'Electrical'
                const isSig = task.department === 'S&T'
                const deptTheme = isElec
                  ? { border: isDark ? 'rgba(56, 189, 248, 0.5)' : '#0284C7', bg: isDark ? 'rgba(2, 132, 199, 0.22)' : '#E0F2FE', text: isDark ? '#7DD3FC' : '#0369A1', label: 'Electrical' }
                  : isSig
                  ? { border: isDark ? 'rgba(192, 132, 252, 0.5)' : '#7E22CE', bg: isDark ? 'rgba(126, 34, 206, 0.22)' : '#F3E8FF', text: isDark ? '#D8B4FE' : '#6B21A8', label: 'S&T' }
                  : { border: isDark ? 'rgba(251, 191, 36, 0.5)' : '#D97706', bg: isDark ? 'rgba(217, 119, 6, 0.22)' : '#FEF3C7', text: isDark ? '#FDE68A' : '#B45309', label: 'Engineering' }

                return (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                    {/* Left Task Label */}
                    <div style={{ width: '200px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: 'var(--text-primary, #172B3A)', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#1F6AA5', fontFamily: 'monospace' }}>#{task.id}</span>
                        <span>{task.maintenance_type}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ fontSize: '10px', color: deptTheme.text, fontWeight: 700 }}>
                          {task.department}
                        </span>
                        <span style={{ fontSize: '10px', color: '#8292A1' }}>•</span>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            background: 'var(--bg-elevated, #F1F5F9)',
                            color: 'var(--text-secondary, #475569)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {task.bundle_role}
                        </span>
                      </div>
                    </div>

                    {/* Timeline Bar Track */}
                    <div style={{ flex: 1, minWidth: '240px', position: 'relative', height: '34px', background: 'var(--bg-table-row, #F8FAFC)', borderRadius: '6px', border: '1px solid var(--border-light, #E2E8F0)' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          height: '100%',
                          borderRadius: '5px',
                          background: deptTheme.bg,
                          border: `1px solid ${deptTheme.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: deptTheme.text,
                        }}
                      >
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {task.assigned_crew_name || task.crew_type}
                        </span>
                        <span style={{ fontFamily: 'monospace', fontSize: '10.5px', color: deptTheme.text, flexShrink: 0, marginLeft: '6px' }}>
                          {formatTime(task.planned_start, task.start_minute)}–{formatTime(task.planned_end, task.end_minute)} ({task.duration_minutes}m)
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* SECTION C: TASK DETAILS (WHITE CARDS) */}
          <div
            style={{
              padding: '16px',
              borderRadius: '10px',
              background: 'var(--bg-card, #FFFFFF)',
              border: '1px solid var(--border-light, #D9E1E8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={16} style={{ color: '#1F6AA5' }} />
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                  Complete Task Details ({bundle.tasks.length} Tasks)
                </span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)' }}>
                All tasks scheduled in unified corridor
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '12px' }}>
              {sortedTasks.map((task) => {
                const priorityColor =
                  task.priority.toLowerCase() === 'critical'
                    ? '#DC2626'
                    : task.priority.toLowerCase() === 'high'
                    ? '#D97706'
                    : '#0284C7'

                return (
                  <div
                    key={task.id}
                    style={{
                      padding: '14px',
                      borderRadius: '8px',
                      background: 'var(--bg-table-row, #F8FAFC)',
                      border: '1px solid var(--border-light, #E2E8F0)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#1F6AA5', fontFamily: 'monospace' }}>
                            ID: {task.id}
                          </span>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary, #172B3A)' }}>
                            {task.maintenance_type}
                          </strong>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary, #5B6B79)', marginTop: '2px' }}>
                          Department: <strong>{task.department}</strong>
                        </div>
                      </div>

                      <span
                        style={{
                          padding: '2px 7px',
                          borderRadius: '4px',
                          background: `${priorityColor}15`,
                          border: `1px solid ${priorityColor}35`,
                          color: priorityColor,
                          fontSize: '10px',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                        }}
                      >
                        {task.priority}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: '6px',
                        padding: '10px',
                        borderRadius: '6px',
                        background: 'var(--bg-card, #FFFFFF)',
                        border: '1px solid var(--border-light, #E2E8F0)',
                        fontSize: '11px',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--text-secondary, #5B6B79)' }}>Crew:</span>
                        <div style={{ color: 'var(--text-primary, #172B3A)', fontWeight: 600 }}>{task.assigned_crew_name || task.crew_type}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary, #5B6B79)' }}>Duration:</span>
                        <div style={{ color: 'var(--text-primary, #172B3A)', fontWeight: 700 }}>{task.duration_minutes} min</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary, #5B6B79)' }}>Planned Start:</span>
                        <div style={{ color: '#1F6AA5', fontFamily: 'monospace' }}>{formatTime(task.planned_start, task.start_minute)}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-secondary, #5B6B79)' }}>Planned End:</span>
                        <div style={{ color: '#1F6AA5', fontFamily: 'monospace' }}>{formatTime(task.planned_end, task.end_minute)}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* SECTION D: WHY WAS THIS SCHEDULE SELECTED? */}
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '8px',
              background: isDark ? 'rgba(2, 132, 199, 0.12)' : '#F0F9FF',
              border: isDark ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid #BAE6FD',
              borderLeft: '4px solid #1F6AA5',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <HelpCircle size={16} style={{ color: isDark ? '#38BDF8' : '#1F6AA5' }} />
              <span style={{ fontSize: '12px', fontWeight: 800, color: isDark ? '#38BDF8' : '#1F6AA5', letterSpacing: '0.8px', textTransform: 'uppercase' }}>
                Why was this schedule selected?
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-primary, #F5F5F5)', lineHeight: 1.5 }}>
              {bundle.explanation}
            </p>
          </div>
        </div>
      )}
    </article>
  )
}
