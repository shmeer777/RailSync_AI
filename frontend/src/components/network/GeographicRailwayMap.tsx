import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  TrainFront,
  Plus,
  Minus,
  Navigation,
  Activity,
  X,
} from 'lucide-react'

export type Station = {
  id: number
  code: string
  name: string
  latitude: number
  longitude: number
  zone?: string
  is_major?: boolean
}

export type Block = {
  id: number
  code: string
  name: string
  start_station_code: string
  end_station_code: string
  distance_km: number
  status?: string
}

export type MaintenanceItem = {
  id: number
  block_code?: string | null
  station_code?: string | null
  priority: string
  status: string
  maintenance_type?: string
  description?: string | null
  scheduled_start?: string | null
  scheduled_end?: string | null
}

export type LiveTrain = {
  id: number
  train_number: string
  name: string
  current_station_code?: string | null
  source_station_code?: string | null
  destination_station_code?: string | null
  status?: string
  delay_minutes?: number
  speed_kmph?: number
  direction?: string
}

export interface GeographicRailwayMapProps {
  stations?: Station[]
  blocks?: Block[]
  maintenance?: MaintenanceItem[]
  trains?: LiveTrain[]
  selectedBlockId?: number | null
  onSelectBlock?: (block: Block) => void
  onSelectStation?: (station: Station) => void
  height?: string | number
  className?: string
}

// -------------------------------------------------------------
// AUTHORITATIVE VERIFIED GEOGRAPHIC COORDINATES FOR KEY CORRIDORS
// (Survey of India / Official IR Geographic Reference)
// -------------------------------------------------------------
export const VERIFIED_CORRIDOR_STATIONS: Record<
  string,
  { name: string; lat: number; lon: number; zone: string; major: boolean }
> = {
  // Mumbai – Delhi Western Mainline Corridor
  MMCT: { name: 'Mumbai Central', lat: 18.9690, lon: 72.8193, zone: 'WR', major: true },
  BVI:  { name: 'Borivali', lat: 19.2300, lon: 72.8567, zone: 'WR', major: false },
  ST:   { name: 'Surat', lat: 21.1702, lon: 72.8311, zone: 'WR', major: true },
  BRC:  { name: 'Vadodara Jn', lat: 22.3072, lon: 73.1812, zone: 'WR', major: true },
  RTM:  { name: 'Ratlam Jn', lat: 23.3300, lon: 75.0400, zone: 'WR', major: true },
  NAD:  { name: 'Nagda Jn', lat: 23.4500, lon: 75.4200, zone: 'WR', major: false },
  KOTA: { name: 'Kota Jn', lat: 25.2138, lon: 75.8648, zone: 'WCR', major: true },
  SWM:  { name: 'Sawai Madhopur', lat: 26.0173, lon: 76.3500, zone: 'WCR', major: false },
  GGC:  { name: 'Gangapur City', lat: 26.4715, lon: 76.7322, zone: 'WCR', major: false },
  MTJ:  { name: 'Mathura Jn', lat: 27.4924, lon: 77.6737, zone: 'NCR', major: true },
  NZM:  { name: 'Hazrat Nizamuddin', lat: 28.5889, lon: 77.2500, zone: 'NR', major: true },
  NDLS: { name: 'New Delhi', lat: 28.6431, lon: 77.2197, zone: 'NR', major: true },

  // Andhra Pradesh Coastal & Rayalaseema Corridors
  NLR:  { name: 'Nellore', lat: 14.4426, lon: 79.9865, zone: 'SCR', major: true },
  OGL:  { name: 'Ongole', lat: 15.5057, lon: 80.0499, zone: 'SCR', major: true },
  CLX:  { name: 'Chirala', lat: 15.8246, lon: 80.3521, zone: 'SCR', major: false },
  TEL:  { name: 'Tenali Jn', lat: 16.2426, lon: 80.6407, zone: 'SCR', major: true },
  GNT:  { name: 'Guntur Jn', lat: 16.3067, lon: 80.4365, zone: 'SCR', major: true },
  BZA:  { name: 'Vijayawada Jn', lat: 16.5193, lon: 80.6305, zone: 'SCR', major: true },
  EE:   { name: 'Eluru', lat: 16.7094, lon: 81.0955, zone: 'SCR', major: false },
  TDD:  { name: 'Tadepalligudem', lat: 16.8140, lon: 81.5278, zone: 'SCR', major: false },
  NDD:  { name: 'Nidadavolu Jn', lat: 16.9167, lon: 81.6833, zone: 'SCR', major: false },
  RJY:  { name: 'Rajahmundry', lat: 16.9891, lon: 81.7840, zone: 'SCR', major: true },

  // Tirupati Branch Corridor
  RU:   { name: 'Renigunta Jn', lat: 13.6410, lon: 79.5130, zone: 'SCR', major: true },
  TPTY: { name: 'Tirupati', lat: 13.6288, lon: 79.4192, zone: 'SCR', major: true },

  // Key Interconnecting Hubs in Backend
  SC:   { name: 'Secunderabad Jn', lat: 17.4334, lon: 78.5042, zone: 'SCR', major: true },
  HYB:  { name: 'Hyderabad Deccan', lat: 17.3920, lon: 78.4690, zone: 'SCR', major: true },
  KZJ:  { name: 'Kazipet Jn', lat: 17.9780, lon: 79.5080, zone: 'SCR', major: true },
  MAS:  { name: 'Chennai Central', lat: 13.0827, lon: 80.2707, zone: 'SR', major: true },
  SBC:  { name: 'KSR Bengaluru', lat: 12.9784, lon: 77.5684, zone: 'SWR', major: true },
  HWH:  { name: 'Howrah Jn (Kolkata)', lat: 22.5839, lon: 88.3433, zone: 'ER', major: true },
}

// Key Corridors Sequential Definitions
export const CORRIDOR_CONNECTIONS: [string, string, number][] = [
  // Mumbai – Delhi Prototype Corridor
  ['MMCT', 'BVI', 30.0],
  ['BVI', 'ST', 250.0],
  ['ST', 'BRC', 130.0],
  ['BRC', 'RTM', 270.0],
  ['RTM', 'NAD', 60.0],
  ['NAD', 'KOTA', 280.0],
  ['KOTA', 'SWM', 110.0],
  ['SWM', 'GGC', 75.0],
  ['GGC', 'MTJ', 180.0],
  ['MTJ', 'NZM', 150.0],
  ['NZM', 'NDLS', 12.0],

  // Andhra Pradesh Mainline Corridor
  ['NLR', 'OGL', 130.0],
  ['OGL', 'CLX', 85.0],
  ['CLX', 'TEL', 110.0],
  ['TEL', 'GNT', 35.0],
  ['GNT', 'BZA', 32.0],
  ['BZA', 'EE', 60.0],
  ['EE', 'TDD', 48.0],
  ['TDD', 'NDD', 20.0],
  ['NDD', 'RJY', 23.0],

  // Tirupati Branch
  ['NLR', 'RU', 115.0],
  ['RU', 'TPTY', 10.0],
]


export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return (
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.documentElement.classList.contains('dark')
    )
  })

  useEffect(() => {
    const checkDark = () => {
      const dark =
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        document.documentElement.classList.contains('dark')
      setIsDark(dark)
    }

    const observer = new MutationObserver(checkDark)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    window.addEventListener('storage', checkDark)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', checkDark)
    }
  }, [])

  return isDark
}

export default function GeographicRailwayMap({
  stations = [],
  blocks = [],
  maintenance = [],
  trains = [],
  selectedBlockId = null,
  onSelectBlock,
  onSelectStation,
  height = 520,
  className = '',
}: GeographicRailwayMapProps) {
  const isDark = useIsDarkMode()
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const referenceLayerRef = useRef<L.TileLayer | null>(null)
  const initialFitDoneRef = useRef(false)

  // Filters State
  const [timeRange, setTimeRange] = useState<'Live' | '24H' | '7D' | '30D'>('Live')
  const [selectedZone, setSelectedZone] = useState<string>('All')
  const [selectedStatus, setSelectedStatus] = useState<string>('All')
  const [selectedCorridor, setSelectedCorridor] = useState<string>('all')

  // Inspector State
  const [activeInspector, setActiveInspector] = useState<{
    type: 'station' | 'block' | 'train'
    data: any
  } | null>(null)

  // 1. Resolve Complete Station List with Real Geographical Coordinates
  const stationMap = useMemo(() => {
    const map = new Map<string, Station & { zone: string; major: boolean }>()
    let autoId = 1

    // Prepopulate verified reference stations
    Object.entries(VERIFIED_CORRIDOR_STATIONS).forEach(([code, ref]) => {
      map.set(code, {
        id: autoId++,
        code,
        name: ref.name,
        latitude: ref.lat,
        longitude: ref.lon,
        zone: ref.zone,
        major: ref.major,
      })
    })

    // Merge backend stations
    stations.forEach((st) => {
      if (st.code && st.latitude && st.longitude) {
        const existing = map.get(st.code)
        map.set(st.code, {
          id: Number(st.id ?? existing?.id ?? autoId++),
          code: st.code,
          name: st.name || existing?.name || st.code,
          latitude: Number(st.latitude),
          longitude: Number(st.longitude),
          zone: existing?.zone || 'IR',
          major: existing?.major ?? ['NDLS', 'MMCT', 'BZA', 'KOTA', 'BRC', 'GNT', 'RJY', 'TPTY', 'SC', 'MAS'].includes(st.code),
        })
      }
    })

    return map
  }, [stations])

  // 2. Resolve Complete Blocks with Status from Maintenance Data
  const blockList = useMemo(() => {
    const list: (Block & {
      status: 'Normal' | 'Restricted' | 'Maintenance' | 'Unavailable'
      activeMaintenance?: MaintenanceItem
      startCoords?: [number, number]
      endCoords?: [number, number]
    })[] = []

    const seenCodes = new Set<string>()

    // Helper to evaluate block status from maintenance
    const evaluateStatus = (
      blockCode: string,
    ): {
      status: 'Normal' | 'Restricted' | 'Maintenance' | 'Unavailable'
      maint?: MaintenanceItem
    } => {
      const active = maintenance.find(
        (m) =>
          m.block_code === blockCode &&
          !['Completed', 'Cancelled'].includes(m.status),
      )
      if (!active) return { status: 'Normal' }
      if (active.priority === 'Critical' || active.status === 'In Progress') {
        return { status: 'Maintenance', maint: active }
      }
      return { status: 'Restricted', maint: active }
    }

    // Process blocks from backend
    blocks.forEach((b) => {
      seenCodes.add(b.code)
      const st1 = stationMap.get(b.start_station_code)
      const st2 = stationMap.get(b.end_station_code)
      const evaluated = evaluateStatus(b.code)

      list.push({
        id: Number(b.id),
        code: b.code,
        name: b.name || `${b.start_station_code} - ${b.end_station_code} Section`,
        start_station_code: b.start_station_code,
        end_station_code: b.end_station_code,
        distance_km: Number(b.distance_km || 0),
        status: evaluated.status,
        activeMaintenance: evaluated.maint,
        startCoords: st1 ? [st1.latitude, st1.longitude] : undefined,
        endCoords: st2 ? [st2.latitude, st2.longitude] : undefined,
      })
    })

    // Ensure all required corridor connections exist
    CORRIDOR_CONNECTIONS.forEach(([startCode, endCode, dist], idx) => {
      const blockCode = `${startCode}-${endCode}-01`
      if (!seenCodes.has(blockCode)) {
        const st1 = stationMap.get(startCode)
        const st2 = stationMap.get(endCode)
        const evaluated = evaluateStatus(blockCode)

        list.push({
          id: 5000 + idx,
          code: blockCode,
          name: `${startCode} – ${endCode} Mainline Section`,
          start_station_code: startCode,
          end_station_code: endCode,
          distance_km: dist,
          status: evaluated.status,
          activeMaintenance: evaluated.maint,
          startCoords: st1 ? [st1.latitude, st1.longitude] : undefined,
          endCoords: st2 ? [st2.latitude, st2.longitude] : undefined,
        })
      }
    })

    return list
  }, [blocks, maintenance, stationMap])

  // 3. Filtered Routes & Stations
  const filteredBlocks = useMemo(() => {
    return blockList.filter((b) => {
      if (selectedStatus !== 'All') {
        if (selectedStatus === 'Normal' && b.status !== 'Normal') return false
        if (selectedStatus === 'Restricted' && b.status !== 'Restricted') return false
        if (selectedStatus === 'Maintenance' && b.status !== 'Maintenance') return false
        if (selectedStatus === 'Unavailable' && b.status !== 'Unavailable') return false
      }

      if (selectedZone !== 'All') {
        const st1 = stationMap.get(b.start_station_code)
        const st2 = stationMap.get(b.end_station_code)
        const matchZone = st1?.zone === selectedZone || st2?.zone === selectedZone
        if (!matchZone) return false
      }

      if (selectedCorridor === 'mumbai_delhi') {
        const isMumbaiDelhi = [
          'MMCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'SWM', 'GGC', 'MTJ', 'NZM', 'NDLS'
        ].includes(b.start_station_code) && [
          'MMCT', 'BVI', 'ST', 'BRC', 'RTM', 'NAD', 'KOTA', 'SWM', 'GGC', 'MTJ', 'NZM', 'NDLS'
        ].includes(b.end_station_code)
        if (!isMumbaiDelhi) return false
      } else if (selectedCorridor === 'andhra') {
        const isAndhra = [
          'NLR', 'OGL', 'CLX', 'TEL', 'GNT', 'BZA', 'EE', 'TDD', 'NDD', 'RJY', 'RU', 'TPTY'
        ].includes(b.start_station_code) && [
          'NLR', 'OGL', 'CLX', 'TEL', 'GNT', 'BZA', 'EE', 'TDD', 'NDD', 'RJY', 'RU', 'TPTY'
        ].includes(b.end_station_code)
        if (!isAndhra) return false
      } else if (selectedCorridor === 'tirupati') {
        const isTirupati = ['NLR', 'RU', 'TPTY'].includes(b.start_station_code) &&
          ['NLR', 'RU', 'TPTY'].includes(b.end_station_code)
        if (!isTirupati) return false
      }

      return true
    })
  }, [blockList, selectedStatus, selectedZone, selectedCorridor, stationMap])

  // Status Color Mapping Helper
  const getStatusColor = (status: string, isDarkMode = isDark) => {
    if (isDarkMode) {
      switch (status) {
        case 'Normal':
          return '#35B879'
        case 'Restricted':
        case 'Congested/Restricted':
          return '#E0A52E'
        case 'Maintenance':
          return '#E05A5A'
        case 'Unavailable':
        default:
          return '#7C858F'
      }
    }
    switch (status) {
      case 'Normal':
        return '#10B981'
      case 'Restricted':
      case 'Congested/Restricted':
        return '#F59E0B'
      case 'Maintenance':
        return '#EF4444'
      case 'Unavailable':
      default:
        return '#64748B'
    }
  }

// Strict India bounds: North (Ladakh/J&K ~36.5°N), South (Kanyakumari ~7.5°N), West (Gujarat ~68°E), East (Arunachal ~97.5°E)
const INDIA_BOUNDS = L.latLngBounds(
  L.latLng(7.0, 68.0),
  L.latLng(36.5, 97.5),
)

const INDIA_MAX_BOUNDS = L.latLngBounds(
  L.latLng(5.0, 65.0),
  L.latLng(38.0, 99.0),
)

  // 4. Initialize Leaflet Map with Authoritative Watermark-Free Esri Light Gray Canvas Base
  useEffect(() => {
    if (!mapContainerRef.current) return

    // Prevent duplicate initialization
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [22.0, 79.0],
        zoom: 5,
        minZoom: 4.5,
        maxZoom: 15,
        maxBounds: INDIA_MAX_BOUNDS,
        maxBoundsViscosity: 1.0,
        zoomControl: false,
        attributionControl: false,
      })

      const layerGroup = L.layerGroup().addTo(map)
      layerGroupRef.current = layerGroup
      mapInstanceRef.current = map

      // Invalidate size once DOM layout completes
      setTimeout(() => {
        map.invalidateSize()
      }, 250)
    }

    return () => {
      // Cleanup on unmount
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
        layerGroupRef.current = null
      }
    }
  }, [])


  // Dynamic Basemap Tile Switcher (Dark Matter / Esri Light)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current)
      tileLayerRef.current = null
    }
    if (referenceLayerRef.current) {
      map.removeLayer(referenceLayerRef.current)
      referenceLayerRef.current = null
    }

    if (isDark) {
      // Esri World Dark Gray Canvas Base + Reference (Genuine dark GIS basemap, no watermarks, full geographic detail)
      const darkBase = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ &bull; RailSync Dark GIS',
          crossOrigin: true,
        },
      )

      let darkErrorCount = 0
      darkBase.on('tileerror', () => {
        darkErrorCount++
        if (darkErrorCount === 4 && mapInstanceRef.current) {
          console.warn('Esri dark tiles warning, activating OpenStreetMap fallback.')
          if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current)
          const fallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors',
            crossOrigin: true,
          }).addTo(mapInstanceRef.current)
          tileLayerRef.current = fallback
        }
      })

      darkBase.addTo(map)
      tileLayerRef.current = darkBase

      const darkRef = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          crossOrigin: true,
          opacity: 0.85,
        },
      ).addTo(map)
      referenceLayerRef.current = darkRef
    } else {
      // Esri Light Gray Canvas for approved light mode
      const lightBase = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
          crossOrigin: true,
        },
      )

      let lightErrorCount = 0
      lightBase.on('tileerror', () => {
        lightErrorCount++
        if (lightErrorCount === 4 && mapInstanceRef.current) {
          console.warn('Esri light tiles warning, activating OpenStreetMap fallback.')
          if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current)
          const fallback = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors',
            crossOrigin: true,
          }).addTo(mapInstanceRef.current)
          tileLayerRef.current = fallback
        }
      })

      lightBase.addTo(map)
      tileLayerRef.current = lightBase

      const lightRef = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 16,
          crossOrigin: true,
          opacity: 0.65,
        },
      ).addTo(map)
      referenceLayerRef.current = lightRef
    }
  }, [isDark])

  // 5. Fit Network Bounds
  const handleFitNetwork = useCallback(() => {
    if (!mapInstanceRef.current) return
    const latLngs: L.LatLngTuple[] = []

    filteredBlocks.forEach((b) => {
      if (b.startCoords) latLngs.push(b.startCoords)
      if (b.endCoords) latLngs.push(b.endCoords)
    })

    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs)
      mapInstanceRef.current.fitBounds(bounds, {
        padding: [35, 35],
        maxZoom: 8,
      })
    } else {
      mapInstanceRef.current.fitBounds(INDIA_BOUNDS, { padding: [15, 15] })
    }
  }, [filteredBlocks])

  // Automatically fit network on first render
  useEffect(() => {
    if (!initialFitDoneRef.current && filteredBlocks.length > 0 && mapInstanceRef.current) {
      initialFitDoneRef.current = true
      setTimeout(() => {
        handleFitNetwork()
      }, 350)
    }
  }, [filteredBlocks, handleFitNetwork])

  // 6. Draw Routes, Stations, and Live Trains on Leaflet
  useEffect(() => {
    const map = mapInstanceRef.current
    const layerGroup = layerGroupRef.current
    if (!map || !layerGroup) return

    layerGroup.clearLayers()

    const activeStationsInView = new Set<string>()

    // A. Draw Railway Route Polylines
    filteredBlocks.forEach((block) => {
      if (!block.startCoords || !block.endCoords) return
      activeStationsInView.add(block.start_station_code)
      activeStationsInView.add(block.end_station_code)

      const color = getStatusColor(block.status)
      const isSelected = selectedBlockId === block.id
      const isMaint = block.status === 'Maintenance'

      // Underlay border for crisp contrast against geographic canvas
      const underlay = L.polyline([block.startCoords, block.endCoords], {
        color: isDark ? '#090A0C' : '#FFFFFF',
        weight: isSelected ? 8 : 6,
        opacity: isDark ? 0.85 : 0.95,
        lineCap: 'round',
      }).addTo(layerGroup)

      // Main operational track line
      const track = L.polyline([block.startCoords, block.endCoords], {
        color: color,
        weight: isSelected ? 5.5 : 4,
        opacity: isMaint ? 0.95 : 0.88,
        dashArray: isMaint ? '6, 6' : undefined,
        lineCap: 'round',
      }).addTo(layerGroup)

      // Interactive hover tooltip
      track.bindTooltip(
        `<div style="font-family: inherit; font-size: 11.5px; padding: 2px 4px;">
          <div style="font-weight: 700; color: #1E293B;">${block.name}</div>
          <div style="color: #64748B; font-size: 10.5px;">Code: <b>${block.code}</b> &bull; ${block.distance_km} km</div>
          <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: ${color};">
            <span style="display:inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${color};"></span>
            Status: ${block.status}
          </div>
          ${
            block.activeMaintenance
              ? `<div style="margin-top: 3px; font-size: 10px; color: #DC2626;">Task: ${block.activeMaintenance.maintenance_type || 'Active Maintenance'} (${block.activeMaintenance.priority})</div>`
              : ''
          }
        </div>`,
        { sticky: true, opacity: 0.98, className: 'leaflet-custom-tooltip' },
      )

      track.on('mouseover', () => {
        track.setStyle({ weight: 7, opacity: 1 })
      })

      track.on('mouseout', () => {
        track.setStyle({
          weight: isSelected ? 5.5 : 4,
          opacity: isMaint ? 0.95 : 0.88,
        })
      })

      track.on('click', () => {
        setActiveInspector({ type: 'block', data: block })
        if (onSelectBlock) onSelectBlock(block)
      })

      underlay.on('click', () => {
        setActiveInspector({ type: 'block', data: block })
        if (onSelectBlock) onSelectBlock(block)
      })
    })

    // B. Draw Station Markers
    activeStationsInView.forEach((code) => {
      const st = stationMap.get(code)
      if (!st) return

      // Determine station operational health
      const connectedBlocks = blockList.filter(
        (b) => b.start_station_code === code || b.end_station_code === code,
      )
      const hasMaintenance = connectedBlocks.some((b) => b.status === 'Maintenance')
      const hasRestricted = connectedBlocks.some((b) => b.status === 'Restricted')
      const stationStatus = hasMaintenance
        ? 'Maintenance'
        : hasRestricted
        ? 'Restricted'
        : 'Normal'

      const statusColor = getStatusColor(stationStatus)
      const isMajor = st.major

      // Station Marker as CircleMarker with double ring styling
      const marker = L.circleMarker([st.latitude, st.longitude], {
        radius: isMajor ? 7 : 5,
        fillColor: statusColor,
        color: isDark ? '#17191C' : '#FFFFFF',
        weight: isMajor ? 2.5 : 1.8,
        opacity: 1,
        fillOpacity: 0.95,
      }).addTo(layerGroup)

      // Add Station Code text label next to marker
      const labelIcon = L.divIcon({
        className: 'station-map-label',
        html: `<span style="
          font-family: inherit;
          font-size: ${isMajor ? '11px' : '9.5px'};
          font-weight: ${isMajor ? '750' : '600'};
          color: ${isDark ? '#F5F5F5' : '#172B3A'};
          background: ${isDark ? 'rgba(23, 25, 28, 0.95)' : 'rgba(255, 255, 255, 0.92)'};
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid ${isDark ? '#2A2D32' : '#D8E0E8'};
          box-shadow: 0 2px 6px ${isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.08)'};
          white-space: nowrap;
          pointer-events: none;
        ">${st.code}</span>`,
        iconAnchor: [-8, 6],
      })
      L.marker([st.latitude, st.longitude], { icon: labelIcon, interactive: false }).addTo(layerGroup)

      // Station Tooltip
      const activeTrainsHere = trains.filter((t) => t.current_station_code === code)

      marker.bindTooltip(
        `<div style="font-family: inherit; font-size: 11.5px; padding: 2px 4px;">
          <div style="font-weight: 750; color: #1E293B;">${st.name} (${st.code})</div>
          <div style="color: #64748B; font-size: 10.5px;">Zone: <b>${st.zone}</b> &bull; ${st.latitude.toFixed(4)}°N, ${st.longitude.toFixed(4)}°E</div>
          <div style="margin-top: 4px; color: ${statusColor}; font-weight: 600;">Status: ${stationStatus}</div>
          <div style="color: #0369A1; font-size: 10.5px; margin-top: 2px;">Active Trains: <b>${activeTrainsHere.length}</b> &bull; Connected Tracks: <b>${connectedBlocks.length}</b></div>
        </div>`,
        { sticky: true, opacity: 0.98, className: 'leaflet-custom-tooltip' },
      )

      marker.on('click', () => {
        setActiveInspector({
          type: 'station',
          data: {
            ...st,
            status: stationStatus,
            connectedBlocks,
            activeTrains: activeTrainsHere,
          },
        })
        if (onSelectStation) onSelectStation(st)
      })
    })

    // C. Draw Live Trains with Refined Sleek Beacon Markers (Clean, Uncluttered)
    const stationTrainCount = new Map<string, number>()

    trains.forEach((train) => {
      const stCode = train.current_station_code
      if (!stCode) return
      const st = stationMap.get(stCode)
      if (!st) return

      // Slight geographic offset if multiple trains are at the same station
      const count = stationTrainCount.get(stCode) || 0
      stationTrainCount.set(stCode, count + 1)

      const angle = (count * 45 * Math.PI) / 180
      const radius = 0.035
      const trainLat = st.latitude + Math.sin(angle) * radius
      const trainLon = st.longitude + Math.cos(angle) * radius

      const isDelayed = (train.delay_minutes || 0) > 0

      const trainIcon = L.divIcon({
        className: 'leaflet-train-div-icon',
        html: `
          <div style="
            position: relative;
            width: 14px;
            height: 14px;
            background: #1E3A8A;
            border: 2px solid #FFFFFF;
            border-radius: 50%;
            box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            display: grid;
            place-items: center;
            cursor: pointer;
            transform: translate(-50%, -50%);
          ">
            <span style="
              width: 5px;
              height: 5px;
              border-radius: 50%;
              background: ${isDelayed ? '#F59E0B' : '#10B981'};
            "></span>
          </div>
        `,
        iconSize: [0, 0],
      })

      const trainMarker = L.marker([trainLat, trainLon], { icon: trainIcon }).addTo(layerGroup)

      trainMarker.bindTooltip(
        `<div style="font-family: inherit; font-size: 11.5px; padding: 2px 4px;">
          <div style="font-weight: 750; color: #1E293B;">Train #${train.train_number} - ${train.name}</div>
          <div style="color: #64748B; font-size: 10.5px;">At: <b>${st.name} (${stCode})</b></div>
          <div style="color: #475569; font-size: 10.5px;">Route: ${train.source_station_code || '—'} &rarr; ${train.destination_station_code || '—'}</div>
          <div style="margin-top: 4px; display: flex; gap: 8px;">
            <span style="font-weight: 600; color: ${isDelayed ? '#D97706' : '#16A34A'};">
              Delay: ${train.delay_minutes ? `+${train.delay_minutes} min` : 'On Time'}
            </span>
            <span style="color: #0284C7; font-weight: 600;">Speed: ${train.speed_kmph || 0} km/h</span>
          </div>
        </div>`,
        { sticky: true, opacity: 0.98, className: 'leaflet-custom-tooltip' },
      )

      trainMarker.on('click', () => {
        setActiveInspector({
          type: 'train',
          data: {
            ...train,
            stationName: st.name,
          },
        })
      })
    })
  }, [filteredBlocks, stationMap, trains, selectedBlockId, onSelectBlock, onSelectStation])

  return (
    <div className={`geographic-railway-map-root ${className}`} style={{ width: '100%', position: 'relative' }}>
      {/* 1. TOP CONTROLS & FILTER BAR */}
      <div
        className="map-filters-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 16px',
          background: 'var(--bg-elevated, #FFFFFF)',
          borderBottom: '1px solid var(--border-light, #D9E1E8)',
          borderTopLeftRadius: '12px',
          borderTopRightRadius: '12px',
        }}
      >
        {/* Left Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Corridor Selection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>Corridor:</span>
            <select
              value={selectedCorridor}
              onChange={(e) => setSelectedCorridor(e.target.value)}
              style={{
                height: '30px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-light, #D8E0E8)',
                background: 'var(--bg-input, #FFFFFF)',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-primary, #1E293B)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Corridors (Pan-India)</option>
              <option value="mumbai_delhi">Mumbai – Delhi Corridor (WR / NR)</option>
              <option value="andhra">Andhra Pradesh Network (SCR)</option>
              <option value="tirupati">Tirupati Branch (RU – TPTY)</option>
            </select>
          </div>

          {/* Zone Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>Zone:</span>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              style={{
                height: '30px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-light, #D8E0E8)',
                background: 'var(--bg-input, #FFFFFF)',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-primary, #1E293B)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="All">All Zones</option>
              <option value="WR">Western Railway (WR)</option>
              <option value="NR">Northern Railway (NR)</option>
              <option value="SCR">South Central Railway (SCR)</option>
              <option value="WCR">West Central Railway (WCR)</option>
              <option value="NCR">North Central Railway (NCR)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#475569' }}>Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{
                height: '30px',
                padding: '0 8px',
                borderRadius: '6px',
                border: '1px solid var(--border-light, #D8E0E8)',
                background: 'var(--bg-input, #FFFFFF)',
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--text-primary, #1E293B)',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="All">All Status</option>
              <option value="Normal">Normal</option>
              <option value="Restricted">Restricted</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Unavailable">Unavailable</option>
            </select>
          </div>
        </div>

        {/* Right Time Range Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: '#F1F5F9',
              borderRadius: '6px',
              padding: '2px',
              border: '1px solid #E2E8F0',
            }}
          >
            {(['Live', '24H', '7D', '30D'] as const).map((range) => {
              const active = timeRange === range
              return (
                <button
                  key={range}
                  type="button"
                  onClick={() => setTimeRange(range)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: active ? 700 : 500,
                    background: active ? '#1F6AA5' : 'transparent',
                    color: active ? '#FFFFFF' : '#475569',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {range}
                </button>
              )
            })}
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#059669',
              padding: '4px 8px',
              background: '#ECFDF5',
              borderRadius: '6px',
              border: '1px solid #A7F3D0',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#10B981',
              }}
            />
            <span>Live Telemetry</span>
          </div>
        </div>
      </div>

      {/* 2. LEAFLET MAP CANVAS CONTAINER */}
      <div style={{ position: 'relative', width: '100%', height }}>
        <div
          ref={mapContainerRef}
          style={{
            width: '100%',
            height: '100%',
            background: '#F8FAFC',
          }}
        />

        {/* Floating Zoom & Fit Network Controls (Top-Left) */}
        <div
          style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-elevated, #FFFFFF)',
              borderRadius: '8px',
              border: '1px solid var(--border-light, #D9E1E8)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              title="Zoom In"
              onClick={() => mapInstanceRef.current?.zoomIn()}
              style={{
                width: '32px',
                height: '32px',
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #F1F5F9',
                cursor: 'pointer',
                color: 'var(--text-primary, #334155)',
              }}
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              title="Zoom Out"
              onClick={() => mapInstanceRef.current?.zoomOut()}
              style={{
                width: '32px',
                height: '32px',
                display: 'grid',
                placeItems: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-primary, #334155)',
              }}
            >
              <Minus size={16} />
            </button>
          </div>

          <button
            type="button"
            title="Reset & Fit Entire Network"
            onClick={handleFitNetwork}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              background: 'var(--bg-elevated, #FFFFFF)',
              borderRadius: '8px',
              border: '1px solid var(--border-light, #D9E1E8)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              fontSize: '11px',
              fontWeight: 600,
              color: '#1F6AA5',
              cursor: 'pointer',
            }}
          >
            <Navigation size={13} />
            <span>Fit Network</span>
          </button>
        </div>

        {/* Floating Enterprise Legend (Bottom-Left) */}
        <div
          style={{
            position: 'absolute',
            bottom: '14px',
            left: '14px',
            zIndex: 1000,
            background: 'var(--bg-elevated, rgba(255, 255, 255, 0.95))',
            backdropFilter: 'blur(4px)',
            borderRadius: '8px',
            border: '1px solid var(--border-light, #D9E1E8)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            fontSize: '11px',
            color: 'var(--text-primary, #334155)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981' }} />
            <span style={{ fontWeight: 500 }}>Normal</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F59E0B' }} />
            <span style={{ fontWeight: 500 }}>Congested / Restricted</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444' }} />
            <span style={{ fontWeight: 500 }}>Maintenance</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#64748B' }} />
            <span style={{ fontWeight: 500 }}>Unavailable</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                border: '2px solid var(--accent-blue, #1F6AA5)',
                background: 'var(--bg-card, #FFFFFF)',
              }}
            />
            <span style={{ fontWeight: 500 }}>Major Station</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#1E3A8A',
                border: '2px solid #FFFFFF',
                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                display: 'inline-block',
              }}
            />
            <span style={{ fontWeight: 500 }}>Live Train</span>
          </div>
        </div>

        {/* Floating Inspector Panel (When a Station, Block, or Train is clicked) */}
        {activeInspector && (
          <div
            style={{
              position: 'absolute',
              top: '14px',
              right: '14px',
              zIndex: 1000,
              width: '280px',
              background: 'var(--bg-card, #FFFFFF)',
              borderRadius: '10px',
              border: '1px solid var(--border-light, #CBD5E1)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
              padding: '12px 14px',
              fontSize: '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
                borderBottom: '1px solid var(--border-light, #F1F5F9)',
                paddingBottom: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                {activeInspector.type === 'station' && <Navigation size={15} color="#1F6AA5" />}
                {activeInspector.type === 'block' && <Activity size={15} color="#D97706" />}
                {activeInspector.type === 'train' && <TrainFront size={15} color="#059669" />}
                <span>
                  {activeInspector.type === 'station' && 'Station Inspection'}
                  {activeInspector.type === 'block' && 'Track Block Details'}
                  {activeInspector.type === 'train' && 'Live Train Details'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveInspector(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94A3B8',
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Inspector Content */}
            {activeInspector.type === 'station' && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 750, color: '#1E293B' }}>
                  {activeInspector.data.name} ({activeInspector.data.code})
                </div>
                <div style={{ color: '#64748B', fontSize: '11px', marginTop: '2px' }}>
                  Zone: <b>{activeInspector.data.zone || 'IR'}</b> &bull; Coordinates:{' '}
                  {activeInspector.data.latitude?.toFixed(4)}°N, {activeInspector.data.longitude?.toFixed(4)}°E
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                  <span
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background: activeInspector.data.status === 'Normal' ? '#DCFCE7' : '#FEF3C7',
                      color: activeInspector.data.status === 'Normal' ? '#166534' : '#92400E',
                    }}
                  >
                    Status: {activeInspector.data.status}
                  </span>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11.5px', color: 'var(--text-primary, #334155)' }}>
                  Connected Corridors: <b>{activeInspector.data.connectedBlocks?.length || 0} tracks</b>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-primary, #334155)' }}>
                  Active Trains At Station: <b>{activeInspector.data.activeTrains?.length || 0} trains</b>
                </div>
              </div>
            )}

            {activeInspector.type === 'block' && (
              <div>
                <div style={{ fontSize: '13px', fontWeight: 750, color: '#1E293B' }}>
                  {activeInspector.data.name}
                </div>
                <div style={{ color: '#64748B', fontSize: '11px', marginTop: '2px' }}>
                  Block Code: <b>{activeInspector.data.code}</b>
                </div>
                <div style={{ marginTop: '6px', fontSize: '11.5px', color: 'var(--text-primary, #334155)' }}>
                  Span: <b>{activeInspector.data.start_station_code} &rarr; {activeInspector.data.end_station_code}</b>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-primary, #334155)' }}>
                  Distance: <b>{activeInspector.data.distance_km} km</b>
                </div>
                <div style={{ marginTop: '6px' }}>
                  <span
                    style={{
                      padding: '2px 7px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 700,
                      background:
                        activeInspector.data.status === 'Normal'
                          ? '#DCFCE7'
                          : activeInspector.data.status === 'Maintenance'
                          ? '#FEE2E2'
                          : '#FEF3C7',
                      color:
                        activeInspector.data.status === 'Normal'
                          ? '#166534'
                          : activeInspector.data.status === 'Maintenance'
                          ? '#991B1B'
                          : '#92400E',
                    }}
                  >
                    Block Status: {activeInspector.data.status}
                  </span>
                </div>
                {activeInspector.data.activeMaintenance && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      background: '#FFF1F2',
                      border: '1px solid #FECDD3',
                      fontSize: '11px',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#9F1239' }}>Active Maintenance:</div>
                    <div style={{ color: '#881337', marginTop: '2px' }}>
                      {activeInspector.data.activeMaintenance.maintenance_type || 'Track Inspection'} (
                      {activeInspector.data.activeMaintenance.priority})
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeInspector.type === 'train' && (
              <div>
                <div style={{ fontSize: '13px', fontWeight: 750, color: '#1E293B' }}>
                  Train #{activeInspector.data.train_number}
                </div>
                <div style={{ color: '#475569', fontSize: '11.5px', fontWeight: 600 }}>
                  {activeInspector.data.name}
                </div>
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#64748B' }}>
                  Current Position: <b>{activeInspector.data.stationName} ({activeInspector.data.current_station_code})</b>
                </div>
                <div style={{ fontSize: '11px', color: '#64748B' }}>
                  Route: {activeInspector.data.source_station_code || '—'} &rarr;{' '}
                  {activeInspector.data.destination_station_code || '—'}
                </div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      background: (activeInspector.data.delay_minutes || 0) > 0 ? '#FEF3C7' : '#DCFCE7',
                      color: (activeInspector.data.delay_minutes || 0) > 0 ? '#92400E' : '#166534',
                    }}
                  >
                    {(activeInspector.data.delay_minutes || 0) > 0
                      ? `Delayed +${activeInspector.data.delay_minutes} min`
                      : 'On Schedule'}
                  </span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      background: '#E0F2FE',
                      color: '#0369A1',
                    }}
                  >
                    {activeInspector.data.speed_kmph || 0} km/h
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
