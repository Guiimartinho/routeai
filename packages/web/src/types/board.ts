/** PCB board data types matching the backend board model */

export interface Point {
  x: number;
  y: number;
}

export interface BoardData {
  metadata: BoardMetadata;
  layers: Layer[];
  traces: Trace[];
  pads: Pad[];
  vias: Via[];
  zones: Zone[];
  components: Component[];
  nets: Net[];
  outline: OutlineSegment[];
  silkscreen: SilkscreenItem[];
  drillHoles: DrillHole[];
  designRules: DesignRules;
}

export interface BoardMetadata {
  title: string;
  revision: string;
  date: string;
  format: 'kicad' | 'eagle' | 'altium' | 'gerber' | 'odb';
  units: 'mm' | 'mil' | 'inch';
  boardWidth: number;
  boardHeight: number;
  layerCount: number;
  componentCount: number;
  netCount: number;
  viaCount: number;
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  color: string;
  visible: boolean;
  opacity: number;
  zIndex: number;
}

export type LayerType =
  | 'copper'
  | 'mask'
  | 'paste'
  | 'silkscreen'
  | 'courtyard'
  | 'fabrication'
  | 'edge'
  | 'user';

export interface Trace {
  id: string;
  netId: string;
  layer: string;
  width: number;
  points: Point[];
}

export interface Pad {
  id: string;
  componentId: string;
  netId: string;
  layer: string;
  shape: PadShape;
  position: Point;
  size: { width: number; height: number };
  rotation: number;
  drillSize?: number;
  thermalRelief?: boolean;
}

export type PadShape = 'circle' | 'rect' | 'oval' | 'roundrect' | 'trapezoid' | 'custom';

export interface Via {
  id: string;
  netId: string;
  position: Point;
  size: number;
  drillSize: number;
  startLayer: string;
  endLayer: string;
  type: 'through' | 'blind' | 'buried' | 'micro';
}

export interface Zone {
  id: string;
  netId: string;
  layer: string;
  priority: number;
  fillType: 'solid' | 'hatched' | 'none';
  outline: Point[];
  filledPolygons: Point[][];
  thermalRelief: boolean;
  clearance: number;
  minWidth: number;
}

export interface Component {
  id: string;
  reference: string;
  value: string;
  footprint: string;
  layer: string;
  position: Point;
  rotation: number;
  pads: string[];
  courtyard?: Point[];
  description?: string;
}

export interface Net {
  id: string;
  name: string;
  class: string;
  padIds: string[];
  traceIds: string[];
  viaIds: string[];
  zoneIds: string[];
}

export interface OutlineSegment {
  type: 'line' | 'arc' | 'circle';
  start: Point;
  end: Point;
  center?: Point;
  radius?: number;
}

export interface SilkscreenItem {
  id: string;
  layer: string;
  type: 'text' | 'line' | 'arc' | 'circle' | 'polygon';
  text?: string;
  position: Point;
  size?: number;
  rotation?: number;
  points?: Point[];
  thickness?: number;
}

export interface DrillHole {
  id: string;
  position: Point;
  size: number;
  plated: boolean;
  associatedPadId?: string;
  associatedViaId?: string;
}

export interface DesignRules {
  minTraceWidth: number;
  minClearance: number;
  minViaDrill: number;
  minViaAnnular: number;
  minHoleClearance: number;
  copperToEdge: number;
}
