import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCw,
  TrainFront,
  Wrench,
} from 'lucide-react'

import { API_BASE_URL } from '../lib/api'

interface ReportsPageProps {
  divisionName?: string
  divisionFullName?: string
}

export default function ReportsPage({
  divisionName = 'Northern Railway',
  divisionFullName = 'Northern Railway Infrastructure Division',
}: ReportsPageProps = {}) {
  const [loading, setLoading] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [trainsCount, setTrainsCount] = useState(24)
  const [maintenanceCount, setMaintenanceCount] = useState(10)

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE_URL}/trains/`).catch(() => null),
      fetch(`${API_BASE_URL}/maintenance/`).catch(() => null),
    ])
      .then(async ([tRes, mRes]) => {
        if (tRes && tRes.ok) {
          const data = await tRes.json()
          if (Array.isArray(data)) setTrainsCount(data.length)
        }
        if (mRes && mRes.ok) {
          const data = await mRes.json()
          if (Array.isArray(data)) setMaintenanceCount(data.length)
        }
      })
      .catch(() => {})
  }, [])

  const notify = (msg: string) => {
    setDownloadStatus(msg)
    window.setTimeout(() => setDownloadStatus(null), 4000)
  }

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 1. Download Train Manifest as CSV
  const handleDownloadTrainManifest = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/trains/`)
      const trains = res.ok ? await res.json() : []

      const headers = [
        'ID',
        'Train Number',
        'Name',
        'Type',
        'Source Station',
        'Destination Station',
        'Current Station',
        'Status',
        'Delay (min)',
        'Speed (km/h)',
        'Direction',
        'Priority',
      ]

      const rows = trains.map((t: any) => [
        t.id,
        `"${t.train_number || ''}"`,
        `"${t.name || ''}"`,
        `"${t.train_type || ''}"`,
        `"${t.source_station_code || ''}"`,
        `"${t.destination_station_code || ''}"`,
        `"${t.current_station_code || ''}"`,
        `"${t.status || ''}"`,
        t.delay_minutes || 0,
        t.speed_kmph || 0,
        `"${t.direction || ''}"`,
        `"${t.priority || ''}"`,
      ])

      const csvContent = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n')
      downloadBlob(csvContent, `RailSync_Train_Manifest_${Date.now()}.csv`, 'text/csv;charset=utf-8;')
      notify('Train Manifest CSV downloaded successfully!')
    } catch (err) {
      notify('Failed to generate train manifest.')
    } finally {
      setLoading(false)
    }
  }

  // 2. Download Maintenance Schedule CSV
  const handleDownloadMaintenance = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/maintenance/`)
      const items = res.ok ? await res.json() : []

      const headers = [
        'ID',
        'Location Type',
        'Block / Station Code',
        'Maintenance Type',
        'Priority',
        'Status',
        'Scheduled Start',
        'Scheduled End',
        'Estimated Duration (min)',
        'Description',
      ]

      const rows = items.map((m: any) => [
        m.id,
        `"${m.location_type || ''}"`,
        `"${m.block_code || m.station_code || ''}"`,
        `"${m.maintenance_type || ''}"`,
        `"${m.priority || ''}"`,
        `"${m.status || ''}"`,
        `"${m.scheduled_start || ''}"`,
        `"${m.scheduled_end || ''}"`,
        m.estimated_duration_minutes || 0,
        `"${(m.description || '').replace(/"/g, '""')}"`,
      ])

      const csvContent = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n')
      downloadBlob(csvContent, `RailSync_Maintenance_Log_${Date.now()}.csv`, 'text/csv;charset=utf-8;')
      notify('Maintenance Log CSV downloaded successfully!')
    } catch (err) {
      notify('Failed to generate maintenance log.')
    } finally {
      setLoading(false)
    }
  }

  // 3. Download AI Risk & Conflict Report as JSON
  const handleDownloadSafetyReport = async () => {
    setLoading(true)
    try {
      const [riskRes, conflictRes] = await Promise.all([
        fetch(`${API_BASE_URL}/ai/train-risk`).catch(() => null),
        fetch(`${API_BASE_URL}/ai/train-block-conflicts`).catch(() => null),
      ])

      const riskData = riskRes && riskRes.ok ? await riskRes.json() : null
      const conflictData = conflictRes && conflictRes.ok ? await conflictRes.json() : null

      const fullReport = {
        generatedAt: new Date().toISOString(),
        author: 'RailSync AI Automated Dispatch System',
        trainRiskEvaluation: riskData,
        trainBlockConflicts: conflictData,
      }

      downloadBlob(
        JSON.stringify(fullReport, null, 2),
        `RailSync_Safety_AI_Assessment_${Date.now()}.json`,
        'application/json'
      )
      notify('Safety & Conflict Assessment JSON downloaded successfully!')
    } catch (err) {
      notify('Failed to generate safety assessment.')
    } finally {
      setLoading(false)
    }
  }

  // 4. Print / PDF Summary
  const handlePrintSummary = () => {
    window.print()
  }

  return (
    <div className="min-h-full px-4 py-5 sm:px-6 lg:px-8" style={{ color: 'var(--text-primary)' }}>
      <div className="mx-auto max-w-[1500px] space-y-6">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>
              <FileSpreadsheet className="h-4 w-4" />
              Compliance & Audit / Operational Reports
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Export & Compliance Reports
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Export verified train manifests, maintenance task records, safety audits, and operational telemetry.
            </p>
          </div>

          <button
            type="button"
            onClick={handlePrintSummary}
            className="btn-secondary-white"
            style={{ padding: '8px 16px', borderRadius: '8px' }}
          >
            <Printer size={15} style={{ color: 'var(--accent-blue)' }} />
            Print Dispatch Sheet
          </button>
        </header>

        {downloadStatus && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 shadow-lg">
            <CheckCircle2 className="h-4 w-4" />
            {downloadStatus}
          </div>
        )}

        {/* Report Cards Grid */}
        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Card 1: Train Manifest */}
          <div
            className="enterprise-card p-6"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--accent-blue-subtle, rgba(59, 130, 196, 0.14))', color: 'var(--accent-blue)', display: 'grid', placeItems: 'center' }}>
                <TrainFront className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Train Manifest Report</h3>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                Full list of all active, en-route, and delayed trains across {divisionName} corridors including speeds,
                assigned priorities, and source-to-destination stations.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <FileCheck className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
                <span>{trainsCount} records ready for export (CSV)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadTrainManifest}
              disabled={loading}
              className="btn-primary-railway"
              style={{ marginTop: '24px', width: '100%', justifyContent: 'center', padding: '10px' }}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Train Manifest (.CSV)
            </button>
          </div>

          {/* Card 2: Maintenance Log */}
          <div
            className="enterprise-card p-6"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--status-warning-bg, rgba(217, 165, 46, 0.16))', color: 'var(--status-warning-text, #D9A52E)', display: 'grid', placeItems: 'center' }}>
                <Wrench className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Maintenance Log & Schedules</h3>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                Detailed maintenance tasks across all blocks and stations. Includes critical priorities, start/end
                times, track engineering descriptions, and status.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <FileCheck className="h-4 w-4" style={{ color: 'var(--status-warning-text, #D9A52E)' }} />
                <span>{maintenanceCount} tasks recorded (CSV)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadMaintenance}
              disabled={loading}
              className="btn-secondary-white"
              style={{ marginTop: '24px', width: '100%', justifyContent: 'center', padding: '10px' }}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Maintenance Log (.CSV)
            </button>
          </div>

          {/* Card 3: Safety Assessment & Conflict Audit */}
          <div
            className="enterprise-card p-6"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: 'var(--bg-card, #151719)',
              border: '1px solid var(--border-light, #2A2D32)',
              borderRadius: '10px',
            }}
          >
            <div>
              <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--accent-blue-subtle, rgba(59, 130, 196, 0.14))', color: 'var(--accent-blue)', display: 'grid', placeItems: 'center' }}>
                <FileText className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Safety Assessment & Conflict Audit</h3>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                Track conflict evaluations, automated block recommendations, and risk
                weight factors exported in structured JSON format.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <FileCheck className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
                <span>Real-time safety & conflict telemetry (JSON format)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDownloadSafetyReport}
              disabled={loading}
              className="btn-primary-railway"
              style={{ marginTop: '24px', width: '100%', justifyContent: 'center', padding: '10px' }}
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Safety Audit (.JSON)
            </button>
          </div>
        </section>

        {/* Section 2: Recent Generated Logs */}
        <section
          className="enterprise-card p-6"
          style={{
            background: 'var(--bg-card, #151719)',
            border: '1px solid var(--border-light, #2A2D32)',
            borderRadius: '10px',
          }}
        >
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)', margin: 0 }}>Recent System Audit Logs</h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Archive of automated operational exports and safety snapshots</p>

          <div className="mt-4 flex flex-col gap-2.5 text-xs">
            <div
              className="flex items-center justify-between p-3.5 rounded-lg"
              style={{
                background: 'var(--bg-table-row, #16181B)',
                border: '1px solid var(--border-light, #2A2D32)',
              }}
            >
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Daily Railway Operations Summary</strong>
                  <span className="block" style={{ color: 'var(--text-secondary)' }}>Generated for {divisionName} Control Room</span>
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>Today, 08:00 AM</span>
            </div>

            <div
              className="flex items-center justify-between p-3.5 rounded-lg"
              style={{
                background: 'var(--bg-table-row, #16181B)',
                border: '1px solid var(--border-light, #2A2D32)',
              }}
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-4 w-4" style={{ color: 'var(--status-warning-text, #D9A52E)' }} />
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Weekly Track Maintenance & Block Closure Audit</strong>
                  <span className="block" style={{ color: 'var(--text-secondary)' }}>{divisionFullName}</span>
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>Yesterday, 18:30 PM</span>
            </div>

            <div
              className="flex items-center justify-between p-3.5 rounded-lg"
              style={{
                background: 'var(--bg-table-row, #16181B)',
                border: '1px solid var(--border-light, #2A2D32)',
              }}
            >
              <div className="flex items-center gap-3">
                <FileCheck className="h-4 w-4" style={{ color: 'var(--accent-blue)' }} />
                <div>
                  <strong style={{ color: 'var(--text-primary)' }}>Safety Assessment & Conflict Audit Log</strong>
                  <span className="block" style={{ color: 'var(--text-secondary)' }}>Certified by RailSync Automated Optimizer</span>
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)' }}>2 days ago</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
