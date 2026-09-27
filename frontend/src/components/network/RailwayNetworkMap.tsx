import GeographicRailwayMap from './GeographicRailwayMap'
import type {
  Station,
  Block,
  MaintenanceItem,
  LiveTrain,
} from './GeographicRailwayMap'

export type { Station, Block, MaintenanceItem, LiveTrain }

export interface RailwayNetworkMapProps {
  stations: Station[]
  blocks: Block[]
  maintenance?: MaintenanceItem[]
  trains?: LiveTrain[]
  selectedBlockId?: number | null
  onSelectBlock?: (block: Block) => void
  onSelectStation?: (station: Station) => void
  compact?: boolean
  className?: string
  height?: string | number
}

// Backward compatibility export
export const STATION_SVG_COORDS: Record<string, { x: number; y: number }> = {}

export default function RailwayNetworkMap({
  stations,
  blocks,
  maintenance = [],
  trains = [],
  selectedBlockId,
  onSelectBlock,
  onSelectStation,
  compact = false,
  className = '',
  height = compact ? 420 : 540,
}: RailwayNetworkMapProps) {
  return (
    <GeographicRailwayMap
      stations={stations}
      blocks={blocks}
      maintenance={maintenance}
      trains={trains}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
      onSelectStation={onSelectStation}
      height={height}
      className={className}
    />
  )
}
