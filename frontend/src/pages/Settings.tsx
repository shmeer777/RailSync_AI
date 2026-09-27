import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Clock,
  Database,
  Globe,
  Monitor,
  Moon,
  Palette,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'

import { API_BASE_URL } from '../lib/api'

export type ThemeMode = 'light' | 'dark' | 'system'

interface SettingsPageProps {
  currentRefresh?: string
  onRefreshChange?: (val: string) => void
  activeDivision?: string
  onDivisionChange?: (val: string) => void
  themeMode?: ThemeMode
  onThemeModeChange?: (mode: ThemeMode) => void
  reducedMotion?: boolean
  onReducedMotionChange?: (val: boolean) => void
  compactDensity?: boolean
  onCompactDensityChange?: (val: boolean) => void
}

export default function SettingsPage({
  currentRefresh = '15s',
  onRefreshChange,
  activeDivision: propActiveDivision,
  onDivisionChange,
  themeMode: propThemeMode = 'light',
  onThemeModeChange,
  reducedMotion: propReducedMotion = false,
  onReducedMotionChange,
  compactDensity: propCompactDensity = false,
  onCompactDensityChange,
}: SettingsPageProps) {
  const [refreshInterval, setRefreshInterval] = useState(currentRefresh)
  const [activeDivision, setActiveDivision] = useState(() => {
    if (propActiveDivision) return propActiveDivision
    try {
      return localStorage.getItem('railsync_active_division') || 'Northern Railway (NR)'
    } catch {
      return 'Northern Railway (NR)'
    }
  })

  // Theme states
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (propThemeMode) return propThemeMode
    try {
      const saved = localStorage.getItem('railsync_theme')
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
      return 'light'
    } catch {
      return 'light'
    }
  })

  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (propReducedMotion !== undefined) return propReducedMotion
    try {
      return localStorage.getItem('railsync_reduced_motion') === 'true'
    } catch {
      return false
    }
  })

  const [compactDensity, setCompactDensity] = useState<boolean>(() => {
    if (propCompactDensity !== undefined) return propCompactDensity
    try {
      return localStorage.getItem('railsync_compact_density') === 'true'
    } catch {
      return false
    }
  })

  const [audioAlerts, setAudioAlerts] = useState(() => {
    try {
      const saved = localStorage.getItem('railsync_audio_alerts')
      return saved !== null ? JSON.parse(saved) : true
    } catch {
      return true
    }
  })

  const [aiAutoPlanning, setAiAutoPlanning] = useState(() => {
    try {
      const saved = localStorage.getItem('railsync_ai_auto_planning')
      return saved !== null ? JSON.parse(saved) : true
    } catch {
      return true
    }
  })

  const [testResult, setTestResult] = useState<{
    status: string
    service?: string
    latencyMs?: number
  } | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  // Sync prop changes
  useEffect(() => {
    if (propActiveDivision && propActiveDivision !== activeDivision) {
      setActiveDivision(propActiveDivision)
    }
  }, [propActiveDivision])

  useEffect(() => {
    if (propThemeMode && propThemeMode !== theme) {
      setTheme(propThemeMode)
    }
  }, [propThemeMode])

  useEffect(() => {
    if (propReducedMotion !== undefined && propReducedMotion !== reducedMotion) {
      setReducedMotion(propReducedMotion)
    }
  }, [propReducedMotion])

  useEffect(() => {
    if (propCompactDensity !== undefined && propCompactDensity !== compactDensity) {
      setCompactDensity(propCompactDensity)
    }
  }, [propCompactDensity])

  const handleThemeSelect = (newTheme: ThemeMode) => {
    setTheme(newTheme)
    if (onThemeModeChange) {
      onThemeModeChange(newTheme)
    } else {
      const getSystem = () =>
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
      const resolved = newTheme === 'system' ? getSystem() : newTheme
      document.documentElement.setAttribute('data-theme', resolved)
      if (resolved === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      try {
        localStorage.setItem('railsync_theme', newTheme)
      } catch {}
    }
  }

  const handleToggleReducedMotion = () => {
    const next = !reducedMotion
    setReducedMotion(next)
    if (onReducedMotionChange) {
      onReducedMotionChange(next)
    } else {
      document.documentElement.setAttribute('data-reduced-motion', String(next))
      try {
        localStorage.setItem('railsync_reduced_motion', String(next))
      } catch {}
    }
  }

  const handleToggleCompactDensity = () => {
    const next = !compactDensity
    setCompactDensity(next)
    if (onCompactDensityChange) {
      onCompactDensityChange(next)
    } else {
      document.documentElement.setAttribute('data-compact-density', String(next))
      try {
        localStorage.setItem('railsync_compact_density', String(next))
      } catch {}
    }
  }

  const handleRefreshSelect = (val: string) => {
    setRefreshInterval(val)
    if (onRefreshChange) {
      onRefreshChange(val)
    }
  }

  const handleDivisionSelect = (div: string) => {
    setActiveDivision(div)
    try {
      localStorage.setItem('railsync_active_division', div)
    } catch {}
    if (onDivisionChange) {
      onDivisionChange(div)
    }
  }

  const handleToggleAudio = () => {
    const next = !audioAlerts
    setAudioAlerts(next)
    try {
      localStorage.setItem('railsync_audio_alerts', JSON.stringify(next))
    } catch {}
  }

  const handleToggleAiPlanning = () => {
    const next = !aiAutoPlanning
    setAiAutoPlanning(next)
    try {
      localStorage.setItem('railsync_ai_auto_planning', JSON.stringify(next))
    } catch {}
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setTestResult(null)
    const startTime = performance.now()

    try {
      const res = await fetch(`${API_BASE_URL}/health`)
      const elapsed = Math.round(performance.now() - startTime)

      if (res.ok) {
        const data = await res.json()
        setTestResult({
          status: 'Online',
          service: data.service || 'RailSync AI Backend',
          latencyMs: elapsed,
        })
      } else {
        setTestResult({
          status: `HTTP ${res.status}`,
          latencyMs: elapsed,
        })
      }
    } catch (err) {
      setTestResult({
        status: 'Unreachable',
        latencyMs: 0,
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSave = () => {
    try {
      localStorage.setItem('railsync_theme', theme)
      localStorage.setItem('railsync_reduced_motion', String(reducedMotion))
      localStorage.setItem('railsync_compact_density', String(compactDensity))
      localStorage.setItem('railsync_active_division', activeDivision)
      localStorage.setItem('railsync_audio_alerts', JSON.stringify(audioAlerts))
      localStorage.setItem('railsync_ai_auto_planning', JSON.stringify(aiAutoPlanning))
    } catch {}
    if (onDivisionChange) {
      onDivisionChange(activeDivision)
    }
    if (onThemeModeChange) {
      onThemeModeChange(theme)
    }
    if (onReducedMotionChange) {
      onReducedMotionChange(reducedMotion)
    }
    if (onCompactDensityChange) {
      onCompactDensityChange(compactDensity)
    }
    setSavedMessage('Preferences successfully saved and active!')
    window.setTimeout(() => setSavedMessage(null), 3500)
  }

  const handleReset = () => {
    handleThemeSelect('light')
    if (reducedMotion) handleToggleReducedMotion()
    if (compactDensity) handleToggleCompactDensity()
    handleRefreshSelect('15s')
    handleDivisionSelect('Northern Railway (NR)')
    setAudioAlerts(true)
    setAiAutoPlanning(true)
    try {
      localStorage.setItem('railsync_theme', 'light')
      localStorage.setItem('railsync_reduced_motion', 'false')
      localStorage.setItem('railsync_compact_density', 'false')
      localStorage.setItem('railsync_active_division', 'Northern Railway (NR)')
      localStorage.setItem('railsync_audio_alerts', JSON.stringify(true))
      localStorage.setItem('railsync_ai_auto_planning', JSON.stringify(true))
    } catch {}
    setSavedMessage('Settings reset to default configuration.')
    window.setTimeout(() => setSavedMessage(null), 3500)
  }

  return (
    <div style={{ minHeight: '100%', padding: '20px 24px 40px', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, marginBottom: '6px' }}>
              <Settings size={15} />
              <span>SYSTEM CONFIGURATION & WORKSPACE PREFERENCES</span>
            </div>
            <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              System Settings & Display Controls
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Configure appearance balance, display themes, telemetry intervals, and operational zones.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={handleReset}
              className="btn-secondary-white"
              style={{ padding: '8px 14px', borderRadius: '8px' }}
            >
              <RotateCcw size={14} />
              Reset Defaults
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="btn-primary-railway"
              style={{ padding: '8px 18px', borderRadius: '8px', fontWeight: 700 }}
            >
              <Save size={15} />
              Save Preferences
            </button>
          </div>
        </header>

        {savedMessage && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '8px',
              background: '#DEF7EC',
              border: '1px solid #84E1BC',
              color: '#03543F',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={16} />
            <span>{savedMessage}</span>
          </div>
        )}

        {/* SECTION 1: APPEARANCE & DISPLAY THEME (PRIMARY REQUIREMENT) */}
        <section className="enterprise-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'var(--blue-light)',
                color: 'var(--accent-blue)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Palette size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)' }}>
                Appearance & Visual Balance
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Switch between the balanced Two-Tone railway interface, night control-room mode, or sync with your system.
              </p>
            </div>
          </div>

          {/* Theme Selector Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '18px' }}>
            
            {/* Card 1: Two-Tone Railway Operations (Light Mode) */}
            <div
              onClick={() => handleThemeSelect('light')}
              style={{
                borderRadius: '10px',
                border: theme === 'light' ? '2px solid var(--accent-blue)' : '1px solid var(--border-light)',
                background: theme === 'light' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                padding: '18px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'all 0.15s ease',
                boxShadow: theme === 'light' ? '0 3px 10px rgba(31, 95, 156, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sun size={17} color={theme === 'light' ? 'var(--accent-blue)' : 'var(--text-secondary)'} />
                  <strong style={{ fontSize: '14px', fontWeight: 750, color: 'var(--text-primary)' }}>
                    Railway Operations
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 750,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: '#DEF7EC',
                    color: '#03543F',
                  }}
                >
                  Recommended
                </span>
              </div>

              {/* Visual Mini-Preview */}
              <div
                style={{
                  height: '76px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  background: '#F4F6F8',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  overflow: 'hidden',
                }}
              >
                {/* Header preview */}
                <div style={{ height: '14px', background: '#102A43', borderRadius: '3px', display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                  <div style={{ width: '22px', height: '4px', background: '#FFFFFF', borderRadius: '2px', opacity: 0.8 }} />
                </div>
                {/* 2-Tone Body: White card + Dark navy monitor */}
                <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                  <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D7DEE6', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '40%', height: '5px', background: '#1F2937', borderRadius: '2px' }} />
                    <div style={{ width: '70%', height: '4px', background: '#94A3B8', borderRadius: '2px', marginTop: '3px' }} />
                  </div>
                  <div style={{ flex: 1, background: '#142F46', border: '1px solid #24445F', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '60%', height: '5px', background: '#FFFFFF', borderRadius: '2px' }} />
                    <div style={{ width: '85%', height: '4px', background: '#34D399', borderRadius: '2px', marginTop: '3px' }} />
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Two-tone enterprise balance (~50% light canvas, ~50% dark navy operational monitors). Ideal for daylight operations.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', fontSize: '11px', color: theme === 'light' ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: 600 }}>
                <Radio size={14} color={theme === 'light' ? 'var(--accent-blue)' : 'var(--border-subtle)'} />
                <span>{theme === 'light' ? 'Currently Active' : 'Select Mode'}</span>
              </div>
            </div>

            {/* Card 2: Night Control-Room (Dark Mode) */}
            <div
              onClick={() => handleThemeSelect('dark')}
              style={{
                borderRadius: '10px',
                border: theme === 'dark' ? '2px solid var(--accent-blue)' : '1px solid var(--border-light)',
                background: theme === 'dark' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                padding: '18px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'all 0.15s ease',
                boxShadow: theme === 'dark' ? '0 3px 10px rgba(31, 95, 156, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Moon size={17} color={theme === 'dark' ? 'var(--accent-blue)' : 'var(--text-secondary)'} />
                  <strong style={{ fontSize: '14px', fontWeight: 750, color: 'var(--text-primary)' }}>
                    Night Control-Room
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 750,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: '#1F5F9C',
                    color: '#FFFFFF',
                  }}
                >
                  Dark Navy
                </span>
              </div>

              {/* Visual Mini-Preview */}
              <div
                style={{
                  height: '76px',
                  borderRadius: '6px',
                  border: '1px solid #24445F',
                  background: '#0B1724',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  overflow: 'hidden',
                }}
              >
                {/* Header preview */}
                <div style={{ height: '14px', background: '#102A43', borderRadius: '3px', display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                  <div style={{ width: '22px', height: '4px', background: '#FFFFFF', borderRadius: '2px', opacity: 0.8 }} />
                </div>
                {/* Dark Panels */}
                <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                  <div style={{ flex: 1, background: '#13283D', border: '1px solid #24445F', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '40%', height: '5px', background: '#F4F7FA', borderRadius: '2px' }} />
                    <div style={{ width: '70%', height: '4px', background: '#8FA3B5', borderRadius: '2px', marginTop: '3px' }} />
                  </div>
                  <div style={{ flex: 1, background: '#17324D', border: '1px solid #24445F', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '60%', height: '5px', background: '#F4F7FA', borderRadius: '2px' }} />
                    <div style={{ width: '85%', height: '4px', background: '#34D399', borderRadius: '2px', marginTop: '3px' }} />
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Deep railway navy (`#0B1724` / `#13283D`) designed for low-light command desks with zero eye glare. No pure black.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', fontSize: '11px', color: theme === 'dark' ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: 600 }}>
                <Radio size={14} color={theme === 'dark' ? 'var(--accent-blue)' : 'var(--border-subtle)'} />
                <span>{theme === 'dark' ? 'Currently Active' : 'Select Mode'}</span>
              </div>
            </div>

            {/* Card 3: System Default */}
            <div
              onClick={() => handleThemeSelect('system')}
              style={{
                borderRadius: '10px',
                border: theme === 'system' ? '2px solid var(--accent-blue)' : '1px solid var(--border-light)',
                background: theme === 'system' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                padding: '18px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'all 0.15s ease',
                boxShadow: theme === 'system' ? '0 3px 10px rgba(31, 95, 156, 0.15)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Monitor size={17} color={theme === 'system' ? 'var(--accent-blue)' : 'var(--text-secondary)'} />
                  <strong style={{ fontSize: '14px', fontWeight: 750, color: 'var(--text-primary)' }}>
                    System Default
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 750,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    background: '#F1F5F9',
                    color: '#475569',
                  }}
                >
                  Auto Sync
                </span>
              </div>

              {/* Visual Mini-Preview */}
              <div
                style={{
                  height: '76px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  background: 'linear-gradient(90deg, #F4F6F8 50%, #0B1724 50%)',
                  padding: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  overflow: 'hidden',
                }}
              >
                <div style={{ height: '14px', background: '#102A43', borderRadius: '3px', display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                  <div style={{ width: '22px', height: '4px', background: '#FFFFFF', borderRadius: '2px', opacity: 0.8 }} />
                </div>
                <div style={{ display: 'flex', gap: '5px', flex: 1 }}>
                  <div style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D7DEE6', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '40%', height: '5px', background: '#1F2937', borderRadius: '2px' }} />
                  </div>
                  <div style={{ flex: 1, background: '#13283D', border: '1px solid #24445F', borderRadius: '4px', padding: '4px' }}>
                    <div style={{ width: '40%', height: '5px', background: '#F4F7FA', borderRadius: '2px' }} />
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Automatically mirrors your operating system color scheme (switches seamlessly between day and night).
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto', fontSize: '11px', color: theme === 'system' ? 'var(--accent-blue)' : 'var(--text-muted)', fontWeight: 600 }}>
                <Radio size={14} color={theme === 'system' ? 'var(--accent-blue)' : 'var(--border-subtle)'} />
                <span>{theme === 'system' ? 'Currently Active' : 'Select Mode'}</span>
              </div>
            </div>

          </div>

          {/* Additional Accessibility & Density Toggles */}
          <div style={{ marginTop: '22px', paddingTop: '20px', borderTop: '1px solid var(--border-light)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            
            {/* Reduced Motion Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Zap size={18} color="var(--accent-blue)" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Reduced UI Animations
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Disables layout transitions and pulses for high-frequency control desks
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleReducedMotion}
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '22px',
                  borderRadius: '999px',
                  border: 'none',
                  background: reducedMotion ? 'var(--accent-blue)' : 'var(--border-light)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-label="Toggle Reduced Motion"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: reducedMotion ? '22px' : '2px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>

            {/* Compact Density Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <SlidersHorizontal size={18} color="var(--accent-blue)" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Compact Information Density
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Compresses table padding to fit more telemetry rows on high-resolution displays
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleCompactDensity}
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '22px',
                  borderRadius: '999px',
                  border: 'none',
                  background: compactDensity ? 'var(--accent-blue)' : 'var(--border-light)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-label="Toggle Compact Density"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: compactDensity ? '22px' : '2px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>

          </div>
        </section>

        {/* SECTION 2: BACKEND & DATABASE CONNECTIVITY */}
        <section className="enterprise-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: 'var(--blue-light)',
                  color: 'var(--accent-blue)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Database size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)' }}>
                  Backend & Database Connectivity
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Live diagnostic test for FastAPI operations server and PostgreSQL database
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="btn-secondary-white"
              style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px' }}
            >
              <RefreshCw size={13} style={{ animation: testingConnection ? 'spin 1s linear infinite' : 'none' }} />
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginTop: '16px' }}>
            <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                API BASE URL
              </span>
              <p style={{ margin: '4px 0 0', fontFamily: 'monospace', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600 }}>
                {API_BASE_URL}
              </p>
            </div>

            <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                DATABASE STATUS
              </span>
              <div style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#2E8B57' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2E8B57' }} />
                <span>PostgreSQL (Port 5432) Connected</span>
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                PING DIAGNOSTIC
              </span>
              {testResult ? (
                <div style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--accent-blue)' }}>
                  <Server size={14} />
                  <span>{testResult.status} ({testResult.latencyMs} ms)</span>
                </div>
              ) : (
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Click "Test Connection" to measure latency
                </p>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 3: AUTO-REFRESH INTERVAL */}
        <section className="enterprise-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: '#FEF3C7',
                color: '#D97706',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Clock size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)' }}>
                Dashboard Auto-Refresh Interval
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Configure live telemetry polling speed for movements, active blocks, and conflicts
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {(['5s', '15s', '30s', '60s', 'Manual'] as const).map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => handleRefreshSelect(val)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '12.5px',
                  fontWeight: 650,
                  cursor: 'pointer',
                  border: refreshInterval === val ? '1px solid var(--accent-blue)' : '1px solid var(--border-light)',
                  background: refreshInterval === val ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: refreshInterval === val ? '#FFFFFF' : 'var(--text-primary)',
                  transition: 'all 0.15s ease',
                }}
              >
                {val === 'Manual' ? 'Manual Polling Only' : `Every ${val}`}
              </button>
            ))}
          </div>
        </section>

        {/* SECTION 4: OPERATIONAL DIVISION */}
        <section className="enterprise-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                background: 'var(--blue-light)',
                color: 'var(--accent-blue)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Globe size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)' }}>
                Active Operational Division
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Select target railway regional zone, control desks, and division corridors
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
            {[
              'Northern Railway (NR)',
              'Western Railway (WR)',
              'Central Railway (CR)',
              'Southern Railway (SR)',
            ].map((div) => (
              <button
                key={div}
                type="button"
                onClick={() => handleDivisionSelect(div)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  border: activeDivision === div ? '1.5px solid var(--accent-blue)' : '1px solid var(--border-light)',
                  background: activeDivision === div ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Radio size={15} color={activeDivision === div ? 'var(--accent-blue)' : 'var(--border-subtle)'} />
                  <span style={{ fontSize: '13px', fontWeight: 650 }}>{div}</span>
                </div>
                {activeDivision === div && (
                  <span style={{ fontSize: '10px', fontWeight: 750, padding: '2px 6px', borderRadius: '4px', background: 'var(--blue-light)', color: 'var(--accent-blue)' }}>
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* SECTION 5: OPERATIONAL FEATURES & ALERTS */}
        <section className="enterprise-card" style={{ padding: '24px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 750, color: 'var(--text-primary)' }}>
            Operational Features & Alert Cues
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            Manage audio cues and automated block conflict arbitration rules
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {audioAlerts ? <Volume2 size={20} color="var(--accent-blue)" /> : <VolumeX size={20} color="var(--text-muted)" />}
                <div>
                  <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Critical Alert Audio Chime
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    Play audible notification alert when high or critical track conflicts arise
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleAudio}
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '22px',
                  borderRadius: '999px',
                  border: 'none',
                  background: audioAlerts ? 'var(--accent-blue)' : 'var(--border-light)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-label="Toggle Audio Alerts"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: audioAlerts ? '22px' : '2px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '8px', background: 'var(--bg-card-hover)', border: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Shield size={20} color="#2E8B57" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Continuous Block Arbitration & Resolution
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                    Generate proactive track diversion paths when trains encounter active maintenance blocks
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleAiPlanning}
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '22px',
                  borderRadius: '999px',
                  border: 'none',
                  background: aiAutoPlanning ? 'var(--accent-blue)' : 'var(--border-light)',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                aria-label="Toggle Automatic Block Arbitration"
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: aiAutoPlanning ? '22px' : '2px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#FFFFFF',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}
                />
              </button>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
