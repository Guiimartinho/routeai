// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

// ─── Schematic Types ─────────────────────────────────────────────────────────

export type PinType = 'input' | 'output' | 'bidirectional' | 'power' | 'passive';

export interface SchPin {
  id: string;
  name: string;
  number: string;
  x: number;
  y: number;
  type: PinType;
  netId?: string;
}

export interface SchComponent {
  id: string;
  type: string;
  ref: string;
  value: string;
  x: number;
  y: number;
  rotation: number;
  pins: SchPin[];
  symbol: string;
  footprint: string;
  kicadSymbol?: import('../components/SymbolLibrary').KiCadSymbolData;
}

export interface SchWire {
  id: string;
  points: Point[];
  netId?: string;
}

export type LabelType = 'local' | 'global' | 'power';

export interface SchLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  type: LabelType;
}

export interface SchNet {
  id: string;
  name: string;
  pins: string[];
  wires: string[];
}

// ─── Board Types ─────────────────────────────────────────────────────────────

export type PadShape = 'circle' | 'rect' | 'oval' | 'roundrect';

export interface BrdPad {
  id: string;
  number: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: PadShape;
  drill?: number;
  layers: string[];
  netId?: string;
}

export interface BrdComponent {
  id: string;
  ref: string;
  value: string;
  footprint: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  pads: BrdPad[];
}

export interface BrdTrace {
  id: string;
  points: Point[];
  width: number;
  layer: string;
  netId: string;
}

export type ViaType = 'through' | 'blind' | 'buried' | 'micro';

export interface BrdVia {
  id: string;
  x: number;
  y: number;
  drill: number;
  size: number;
  layers: string[];
  netId: string;
  viaType: ViaType;       // through, blind, buried, micro
  startLayer: string;     // e.g. "F.Cu"
  endLayer: string;       // e.g. "B.Cu" for through, "In1.Cu" for blind
}

export type KeepoutType = 'no_copper' | 'no_trace' | 'no_via' | 'no_component';

export interface BrdZone {
  id: string;
  points: Point[];
  layer: string;
  netId: string;
  isKeepout?: boolean;
  keepoutType?: KeepoutType;
}

export interface BoardOutline {
  points: Point[];
}

// ─── Hierarchical Sheet ─────────────────────────────────────────────────────

export interface SchSheet {
  id: string;
  name: string;
  components: SchComponent[];
  wires: SchWire[];
  labels: SchLabel[];
}

// ─── Aggregate State ─────────────────────────────────────────────────────────

export interface BusWire {
  id: string;
  points: Point[];
}

export interface SchematicState {
  components: SchComponent[];   // active sheet's components (backward compat)
  wires: SchWire[];             // active sheet's wires
  labels: SchLabel[];           // active sheet's labels
  nets: SchNet[];

  // Bus wires and NoConnect markers (persisted)
  busWires: BusWire[];
  noConnects: Point[];

  // Hierarchical multi-sheet support
  sheets: SchSheet[];           // all sheets
  activeSheetId: string;        // currently active sheet id
}

export interface BoardState {
  components: BrdComponent[];
  traces: BrdTrace[];
  vias: BrdVia[];
  zones: BrdZone[];
  outline: BoardOutline;
  layers: string[];
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface Project {
  name: string;
  schematic: SchematicState;
  board: BoardState;
}

// ─── Editor ──────────────────────────────────────────────────────────────────

export type EditorTab = 'schematic' | 'board' | '3d' | 'ai-review' | 'ai-placement' | 'ai-routing' | 'drc' | 'erc' | 'bom' | 'emc' | 'simulation' | 'export';

export type SchTool =
  | 'select'
  | 'wire'
  | 'component'
  | 'label'
  | 'power'
  | 'bus'
  | 'noconnect'
  | 'measure';

export type BrdTool =
  | 'select'
  | 'trace'
  | 'via'
  | 'zone'
  | 'keepout'
  | 'component'
  | 'dimension'
  | 'measure'
  | 'diffpair'
  | 'lengthtune';

export type ActiveTool = SchTool | BrdTool;

// ─── Component Library ───────────────────────────────────────────────────────

export interface LibPin {
  name: string;
  number: string;
  x: number;
  y: number;
  type: PinType;
}

export interface LibComponent {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  symbol: string;       // SVG path data
  footprint: string;
  pins: LibPin[];
  description: string;
  datasheetUrl: string;
  mpn: string;
  manufacturer: string;
  kicadSymbol?: import('../components/SymbolLibrary').KiCadSymbolData;
}
