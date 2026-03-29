/**
 * Zustand store for schematic editor state management.
 *
 * Manages components, wires, labels, nets, sheets, tool modes, selection,
 * clipboard, and undo/redo history for the schematic editor.
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchematicPoint {
  x: number;
  y: number;
}

export interface SchematicPin {
  id: string;
  number: string;
  name: string;
  position: SchematicPoint;
  orientation: 'left' | 'right' | 'up' | 'down';
  type: 'input' | 'output' | 'bidirectional' | 'passive' | 'power' | 'open_collector' | 'open_emitter' | 'unconnected';
  connectedNetId: string | null;
}

export type SymbolType =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'ic'
  | 'connector'
  | 'diode'
  | 'led'
  | 'transistor_npn'
  | 'transistor_pnp'
  | 'opamp'
  | 'crystal'
  | 'fuse'
  | 'ground'
  | 'vcc'
  | 'vdd'
  | 'generic';

export interface SchematicComponent {
  id: string;
  symbolType: SymbolType;
  reference: string;
  value: string;
  footprint: string;
  position: SchematicPoint;
  rotation: number; // degrees: 0, 90, 180, 270
  mirror: boolean;
  pins: SchematicPin[];
  properties: Record<string, string>;
  description: string;
  datasheet: string;
  libraryId: string;
  selected: boolean;
}

export interface WireSegment {
  start: SchematicPoint;
  end: SchematicPoint;
}

export interface SchematicWire {
  id: string;
  segments: WireSegment[];
  netId: string | null;
  selected: boolean;
}

export interface SchematicJunction {
  id: string;
  position: SchematicPoint;
  netId: string | null;
}

export interface SchematicLabel {
  id: string;
  text: string;
  position: SchematicPoint;
  rotation: number;
  type: 'net' | 'global' | 'hierarchical';
  netId: string | null;
  selected: boolean;
}

export interface SchematicBus {
  id: string;
  name: string;
  segments: WireSegment[];
  members: string[]; // net names in the bus
  selected: boolean;
}

export interface PowerSymbol {
  id: string;
  type: 'vcc' | 'vdd' | 'vee' | 'gnd' | 'gnda' | 'custom';
  name: string;
  position: SchematicPoint;
  rotation: number;
  netId: string | null;
  selected: boolean;
}

export interface SchematicNet {
  id: string;
  name: string;
  class: string;
  wireIds: string[];
  pinIds: string[];
  labelIds: string[];
}

export interface SchematicSheet {
  id: string;
  name: string;
  number: number;
  components: string[];
  wires: string[];
  labels: string[];
  buses: string[];
  powerSymbols: string[];
}

export interface DesignIntent {
  id: string;
  description: string;
  componentIds: string[];
  generatedConstraints: GeneratedConstraint[];
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedConstraint {
  type: 'impedance' | 'length_match' | 'spacing' | 'width' | 'guard_trace' | 'copper_pour' | 'thermal_relief' | 'diff_pair';
  parameter: string;
  value: string;
  unit: string;
  rationale: string;
}

export type ToolMode = 'select' | 'wire' | 'component' | 'label' | 'bus' | 'power';

interface HistoryEntry {
  components: Map<string, SchematicComponent>;
  wires: Map<string, SchematicWire>;
  labels: Map<string, SchematicLabel>;
  buses: Map<string, SchematicBus>;
  powerSymbols: Map<string, PowerSymbol>;
  junctions: Map<string, SchematicJunction>;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

interface ClipboardData {
  components: SchematicComponent[];
  wires: SchematicWire[];
  labels: SchematicLabel[];
  powerSymbols: PowerSymbol[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface SchematicState {
  // Data
  components: Map<string, SchematicComponent>;
  wires: Map<string, SchematicWire>;
  junctions: Map<string, SchematicJunction>;
  labels: Map<string, SchematicLabel>;
  buses: Map<string, SchematicBus>;
  powerSymbols: Map<string, PowerSymbol>;
  nets: Map<string, SchematicNet>;
  sheets: Map<string, SchematicSheet>;
  activeSheetId: string;

  // Design intents
  designIntents: Map<string, DesignIntent>;

  // Editor state
  toolMode: ToolMode;
  selectedIds: Set<string>;
  hoveredId: string | null;
  gridSize: number;
  snapToGrid: boolean;
  showGrid: boolean;

  // Viewport
  viewportOffset: SchematicPoint;
  viewportZoom: number;

  // Wire drawing state
  wireDrawing: boolean;
  wireStartPoint: SchematicPoint | null;
  wirePreviewSegments: WireSegment[];

  // Component placement state
  placingComponent: SchematicComponent | null;
  placingPosition: SchematicPoint | null;

  // Clipboard
  clipboard: ClipboardData | null;

  // Undo/Redo
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  maxHistorySize: number;

  // Actions
  setToolMode: (mode: ToolMode) => void;
  setGridSize: (size: number) => void;
  setSnapToGrid: (snap: boolean) => void;
  setShowGrid: (show: boolean) => void;

  // Viewport
  pan: (dx: number, dy: number) => void;
  zoom: (factor: number, center: SchematicPoint) => void;
  fitToView: () => void;
  setViewport: (offset: SchematicPoint, zoom: number) => void;

  // Component operations
  addComponent: (component: SchematicComponent) => void;
  moveComponent: (id: string, position: SchematicPoint) => void;
  rotateComponent: (id: string) => void;
  mirrorComponent: (id: string) => void;
  updateComponentProperty: (id: string, key: string, value: string) => void;
  updateComponentProperties: (id: string, properties: Partial<Pick<SchematicComponent, 'reference' | 'value' | 'footprint' | 'description' | 'datasheet'>>) => void;
  removeComponent: (id: string) => void;
  startPlacingComponent: (component: SchematicComponent) => void;
  updatePlacingPosition: (position: SchematicPoint) => void;
  finalizePlacement: () => void;
  cancelPlacement: () => void;

  // Wire operations
  addWire: (wire: SchematicWire) => void;
  startWireDrawing: (point: SchematicPoint) => void;
  updateWirePreview: (point: SchematicPoint) => void;
  finalizeWireSegment: (point: SchematicPoint) => void;
  cancelWireDrawing: () => void;
  finishWireDrawing: () => void;
  removeWire: (id: string) => void;

  // Label operations
  addLabel: (label: SchematicLabel) => void;
  updateLabel: (id: string, text: string) => void;
  moveLabel: (id: string, position: SchematicPoint) => void;
  removeLabel: (id: string) => void;

  // Bus operations
  addBus: (bus: SchematicBus) => void;
  removeBus: (id: string) => void;

  // Power symbol operations
  addPowerSymbol: (symbol: PowerSymbol) => void;
  movePowerSymbol: (id: string, position: SchematicPoint) => void;
  removePowerSymbol: (id: string) => void;

  // Junction operations
  addJunction: (junction: SchematicJunction) => void;
  removeJunction: (id: string) => void;
  autoDetectJunctions: () => void;

  // Net operations
  rebuildNets: () => void;

  // Selection
  select: (id: string, additive?: boolean) => void;
  selectAll: () => void;
  selectInRect: (topLeft: SchematicPoint, bottomRight: SchematicPoint, additive?: boolean) => void;
  deselect: (id: string) => void;
  deselectAll: () => void;
  setHovered: (id: string | null) => void;

  // Bulk operations
  deleteSelected: () => void;
  moveSelected: (dx: number, dy: number) => void;

  // Clipboard
  copySelected: () => void;
  cutSelected: () => void;
  paste: (position: SchematicPoint) => void;

  // History
  undo: () => void;
  redo: () => void;
  pushHistory: () => void;

  // Sheet operations
  addSheet: (name: string) => void;
  removeSheet: (id: string) => void;
  setActiveSheet: (id: string) => void;

  // Design intent operations
  addDesignIntent: (intent: DesignIntent) => void;
  updateDesignIntent: (id: string, updates: Partial<DesignIntent>) => void;
  removeDesignIntent: (id: string) => void;

  // Serialization
  exportSchematic: () => object;
  importSchematic: (data: object) => void;

  // Snapping helper
  snapPoint: (point: SchematicPoint) => SchematicPoint;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${_nextId++}`;
}

function cloneMap<K, V>(map: Map<K, V>): Map<K, V> {
  return new Map(JSON.parse(JSON.stringify(Array.from(map.entries()))));
}

function snappedValue(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function captureHistoryEntry(state: SchematicState): HistoryEntry {
  return {
    components: cloneMap(state.components),
    wires: cloneMap(state.wires),
    labels: cloneMap(state.labels),
    buses: cloneMap(state.buses),
    powerSymbols: cloneMap(state.powerSymbols),
    junctions: cloneMap(state.junctions),
  };
}

function segmentsIntersect(
  a1: SchematicPoint,
  a2: SchematicPoint,
  b1: SchematicPoint,
  b2: SchematicPoint,
): SchematicPoint | null {
  // Only handle orthogonal segments (horizontal/vertical)
  const aHorizontal = a1.y === a2.y;
  const bHorizontal = b1.y === b2.y;

  if (aHorizontal === bHorizontal) return null; // parallel

  const hSeg = aHorizontal ? { s: a1, e: a2, fixed: a1.y } : { s: b1, e: b2, fixed: b1.y };
  const vSeg = aHorizontal ? { s: b1, e: b2, fixed: 0 } : { s: a1, e: a2, fixed: 0 };
  const vX = aHorizontal ? b1.x : a1.x;
  const hMinX = Math.min(hSeg.s.x, hSeg.e.x);
  const hMaxX = Math.max(hSeg.s.x, hSeg.e.x);
  const vMinY = Math.min(vSeg.s.y, vSeg.e.y);
  const vMaxY = Math.max(vSeg.s.y, vSeg.e.y);

  if (vX >= hMinX && vX <= hMaxX && hSeg.fixed >= vMinY && hSeg.fixed <= vMaxY) {
    return { x: vX, y: hSeg.fixed };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const defaultSheet: SchematicSheet = {
  id: 'sheet_1',
  name: 'Sheet 1',
  number: 1,
  components: [],
  wires: [],
  labels: [],
  buses: [],
  powerSymbols: [],
};

export const useSchematicStore = create<SchematicState>((set, get) => ({
  // Data
  components: new Map(),
  wires: new Map(),
  junctions: new Map(),
  labels: new Map(),
  buses: new Map(),
  powerSymbols: new Map(),
  nets: new Map(),
  sheets: new Map([['sheet_1', defaultSheet]]),
  activeSheetId: 'sheet_1',

  // Design intents
  designIntents: new Map(),

  // Editor state
  toolMode: 'select',
  selectedIds: new Set(),
  hoveredId: null,
  gridSize: 10,
  snapToGrid: true,
  showGrid: true,

  // Viewport
  viewportOffset: { x: 0, y: 0 },
  viewportZoom: 1,

  // Wire drawing
  wireDrawing: false,
  wireStartPoint: null,
  wirePreviewSegments: [],

  // Component placement
  placingComponent: null,
  placingPosition: null,

  // Clipboard
  clipboard: null,

  // History
  undoStack: [],
  redoStack: [],
  maxHistorySize: 100,

  // -----------------------------------------------------------------------
  // Basic setters
  // -----------------------------------------------------------------------

  setToolMode: (mode) => {
    const state = get();
    // Cancel any in-progress drawing when switching tools
    if (state.wireDrawing) {
      set({ wireDrawing: false, wireStartPoint: null, wirePreviewSegments: [] });
    }
    if (state.placingComponent) {
      set({ placingComponent: null, placingPosition: null });
    }
    set({ toolMode: mode });
  },

  setGridSize: (size) => set({ gridSize: Math.max(1, Math.min(100, size)) }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),
  setShowGrid: (show) => set({ showGrid: show }),

  // -----------------------------------------------------------------------
  // Viewport
  // -----------------------------------------------------------------------

  pan: (dx, dy) => set((s) => ({
    viewportOffset: { x: s.viewportOffset.x + dx, y: s.viewportOffset.y + dy },
  })),

  zoom: (factor, center) => set((s) => {
    const newZoom = Math.max(0.1, Math.min(10, s.viewportZoom * factor));
    const ratio = newZoom / s.viewportZoom;
    return {
      viewportZoom: newZoom,
      viewportOffset: {
        x: center.x - (center.x - s.viewportOffset.x) * ratio,
        y: center.y - (center.y - s.viewportOffset.y) * ratio,
      },
    };
  }),

  fitToView: () => {
    const state = get();
    if (state.components.size === 0 && state.wires.size === 0) {
      set({ viewportOffset: { x: 0, y: 0 }, viewportZoom: 1 });
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    state.components.forEach((c) => {
      minX = Math.min(minX, c.position.x - 40);
      minY = Math.min(minY, c.position.y - 40);
      maxX = Math.max(maxX, c.position.x + 40);
      maxY = Math.max(maxY, c.position.y + 40);
    });

    state.wires.forEach((w) => {
      w.segments.forEach((seg) => {
        minX = Math.min(minX, seg.start.x, seg.end.x);
        minY = Math.min(minY, seg.start.y, seg.end.y);
        maxX = Math.max(maxX, seg.start.x, seg.end.x);
        maxY = Math.max(maxY, seg.start.y, seg.end.y);
      });
    });

    if (!isFinite(minX)) {
      set({ viewportOffset: { x: 0, y: 0 }, viewportZoom: 1 });
      return;
    }

    const padding = 80;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    const zoom = Math.min(1, 800 / width, 600 / height);

    set({
      viewportOffset: { x: -cx * zoom + 400, y: -cy * zoom + 300 },
      viewportZoom: zoom,
    });
  },

  setViewport: (offset, zoom) => set({ viewportOffset: offset, viewportZoom: zoom }),

  // -----------------------------------------------------------------------
  // Snapping helper
  // -----------------------------------------------------------------------

  snapPoint: (point) => {
    const state = get();
    if (!state.snapToGrid) return point;
    return {
      x: snappedValue(point.x, state.gridSize),
      y: snappedValue(point.y, state.gridSize),
    };
  },

  // -----------------------------------------------------------------------
  // Component operations
  // -----------------------------------------------------------------------

  addComponent: (component) => {
    get().pushHistory();
    set((s) => {
      const comps = new Map(s.components);
      comps.set(component.id, component);
      const sheet = s.sheets.get(s.activeSheetId);
      if (sheet) {
        const sheets = new Map(s.sheets);
        sheets.set(s.activeSheetId, {
          ...sheet,
          components: [...sheet.components, component.id],
        });
        return { components: comps, sheets };
      }
      return { components: comps };
    });
  },

  moveComponent: (id, position) => {
    set((s) => {
      const comp = s.components.get(id);
      if (!comp) return s;
      const snapped = s.snapToGrid
        ? { x: snappedValue(position.x, s.gridSize), y: snappedValue(position.y, s.gridSize) }
        : position;
      const comps = new Map(s.components);
      comps.set(id, { ...comp, position: snapped });
      return { components: comps };
    });
  },

  rotateComponent: (id) => {
    get().pushHistory();
    set((s) => {
      const comp = s.components.get(id);
      if (!comp) return s;
      const newRotation = (comp.rotation + 90) % 360;
      const rotatedPins = comp.pins.map((pin) => {
        // Rotate pin positions 90 degrees around origin
        const cos = Math.cos(Math.PI / 2);
        const sin = Math.sin(Math.PI / 2);
        const rx = pin.position.x * cos - pin.position.y * sin;
        const ry = pin.position.x * sin + pin.position.y * cos;
        const orientations: Record<string, 'left' | 'right' | 'up' | 'down'> = {
          left: 'down', down: 'right', right: 'up', up: 'left',
        };
        return {
          ...pin,
          position: { x: Math.round(rx), y: Math.round(ry) },
          orientation: orientations[pin.orientation] || pin.orientation,
        };
      });
      const comps = new Map(s.components);
      comps.set(id, { ...comp, rotation: newRotation, pins: rotatedPins });
      return { components: comps };
    });
  },

  mirrorComponent: (id) => {
    get().pushHistory();
    set((s) => {
      const comp = s.components.get(id);
      if (!comp) return s;
      const mirroredPins = comp.pins.map((pin) => {
        const orientations: Record<string, 'left' | 'right' | 'up' | 'down'> = {
          left: 'right', right: 'left', up: 'up', down: 'down',
        };
        return {
          ...pin,
          position: { x: -pin.position.x, y: pin.position.y },
          orientation: orientations[pin.orientation] || pin.orientation,
        };
      });
      const comps = new Map(s.components);
      comps.set(id, { ...comp, mirror: !comp.mirror, pins: mirroredPins });
      return { components: comps };
    });
  },

  updateComponentProperty: (id, key, value) => {
    get().pushHistory();
    set((s) => {
      const comp = s.components.get(id);
      if (!comp) return s;
      const comps = new Map(s.components);
      comps.set(id, {
        ...comp,
        properties: { ...comp.properties, [key]: value },
      });
      return { components: comps };
    });
  },

  updateComponentProperties: (id, properties) => {
    get().pushHistory();
    set((s) => {
      const comp = s.components.get(id);
      if (!comp) return s;
      const comps = new Map(s.components);
      comps.set(id, { ...comp, ...properties });
      return { components: comps };
    });
  },

  removeComponent: (id) => {
    get().pushHistory();
    set((s) => {
      const comps = new Map(s.components);
      comps.delete(id);
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(id);
      return { components: comps, selectedIds };
    });
  },

  startPlacingComponent: (component) => {
    set({ placingComponent: component, placingPosition: null, toolMode: 'component' });
  },

  updatePlacingPosition: (position) => {
    const state = get();
    const snapped = state.snapToGrid
      ? { x: snappedValue(position.x, state.gridSize), y: snappedValue(position.y, state.gridSize) }
      : position;
    set({ placingPosition: snapped });
  },

  finalizePlacement: () => {
    const state = get();
    if (!state.placingComponent || !state.placingPosition) return;
    const finalComponent: SchematicComponent = {
      ...state.placingComponent,
      id: generateId('comp'),
      position: state.placingPosition,
    };
    get().addComponent(finalComponent);
    // Stay in component mode for rapid placement; update with new ID
    set({
      placingComponent: { ...state.placingComponent, id: generateId('comp') },
      placingPosition: null,
    });
  },

  cancelPlacement: () => {
    set({ placingComponent: null, placingPosition: null, toolMode: 'select' });
  },

  // -----------------------------------------------------------------------
  // Wire operations
  // -----------------------------------------------------------------------

  addWire: (wire) => {
    get().pushHistory();
    set((s) => {
      const wires = new Map(s.wires);
      wires.set(wire.id, wire);
      return { wires };
    });
  },

  startWireDrawing: (point) => {
    const snapped = get().snapPoint(point);
    set({
      wireDrawing: true,
      wireStartPoint: snapped,
      wirePreviewSegments: [],
    });
  },

  updateWirePreview: (point) => {
    const state = get();
    if (!state.wireDrawing || !state.wireStartPoint) return;
    const snapped = state.snapPoint(point);
    const start = state.wirePreviewSegments.length > 0
      ? state.wirePreviewSegments[state.wirePreviewSegments.length - 1].end
      : state.wireStartPoint;

    // Route with an L-shaped bend: horizontal first, then vertical
    const segments: WireSegment[] = [];
    if (start.x !== snapped.x) {
      segments.push({ start, end: { x: snapped.x, y: start.y } });
    }
    if (start.y !== snapped.y) {
      const bendPoint = segments.length > 0
        ? segments[segments.length - 1].end
        : start;
      segments.push({ start: bendPoint, end: snapped });
    }

    // We keep accumulated segments plus the new preview
    set({ wirePreviewSegments: [...state.wirePreviewSegments.slice(0, -2), ...segments] });
  },

  finalizeWireSegment: (point) => {
    const state = get();
    if (!state.wireDrawing || !state.wireStartPoint) return;
    const snapped = state.snapPoint(point);
    const start = state.wirePreviewSegments.length > 0
      ? state.wirePreviewSegments[state.wirePreviewSegments.length - 1].end
      : state.wireStartPoint;

    const newSegments: WireSegment[] = [];
    if (start.x !== snapped.x) {
      newSegments.push({ start, end: { x: snapped.x, y: start.y } });
    }
    if (start.y !== snapped.y) {
      const bendPoint = newSegments.length > 0
        ? newSegments[newSegments.length - 1].end
        : start;
      newSegments.push({ start: bendPoint, end: snapped });
    }
    if (newSegments.length === 0 && (start.x !== snapped.x || start.y !== snapped.y)) {
      newSegments.push({ start, end: snapped });
    }

    set({ wirePreviewSegments: [...state.wirePreviewSegments, ...newSegments] });
  },

  cancelWireDrawing: () => {
    set({ wireDrawing: false, wireStartPoint: null, wirePreviewSegments: [] });
  },

  finishWireDrawing: () => {
    const state = get();
    if (!state.wireDrawing || state.wirePreviewSegments.length === 0) {
      set({ wireDrawing: false, wireStartPoint: null, wirePreviewSegments: [] });
      return;
    }

    const wire: SchematicWire = {
      id: generateId('wire'),
      segments: [...state.wirePreviewSegments],
      netId: null,
      selected: false,
    };

    get().addWire(wire);
    set({ wireDrawing: false, wireStartPoint: null, wirePreviewSegments: [] });
    get().autoDetectJunctions();
    get().rebuildNets();
  },

  removeWire: (id) => {
    get().pushHistory();
    set((s) => {
      const wires = new Map(s.wires);
      wires.delete(id);
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(id);
      return { wires, selectedIds };
    });
  },

  // -----------------------------------------------------------------------
  // Label operations
  // -----------------------------------------------------------------------

  addLabel: (label) => {
    get().pushHistory();
    set((s) => {
      const labels = new Map(s.labels);
      labels.set(label.id, label);
      return { labels };
    });
    get().rebuildNets();
  },

  updateLabel: (id, text) => {
    get().pushHistory();
    set((s) => {
      const label = s.labels.get(id);
      if (!label) return s;
      const labels = new Map(s.labels);
      labels.set(id, { ...label, text });
      return { labels };
    });
    get().rebuildNets();
  },

  moveLabel: (id, position) => {
    set((s) => {
      const label = s.labels.get(id);
      if (!label) return s;
      const snapped = s.snapToGrid
        ? { x: snappedValue(position.x, s.gridSize), y: snappedValue(position.y, s.gridSize) }
        : position;
      const labels = new Map(s.labels);
      labels.set(id, { ...label, position: snapped });
      return { labels };
    });
  },

  removeLabel: (id) => {
    get().pushHistory();
    set((s) => {
      const labels = new Map(s.labels);
      labels.delete(id);
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(id);
      return { labels, selectedIds };
    });
    get().rebuildNets();
  },

  // -----------------------------------------------------------------------
  // Bus operations
  // -----------------------------------------------------------------------

  addBus: (bus) => {
    get().pushHistory();
    set((s) => {
      const buses = new Map(s.buses);
      buses.set(bus.id, bus);
      return { buses };
    });
  },

  removeBus: (id) => {
    get().pushHistory();
    set((s) => {
      const buses = new Map(s.buses);
      buses.delete(id);
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(id);
      return { buses, selectedIds };
    });
  },

  // -----------------------------------------------------------------------
  // Power symbol operations
  // -----------------------------------------------------------------------

  addPowerSymbol: (symbol) => {
    get().pushHistory();
    set((s) => {
      const ps = new Map(s.powerSymbols);
      ps.set(symbol.id, symbol);
      return { powerSymbols: ps };
    });
    get().rebuildNets();
  },

  movePowerSymbol: (id, position) => {
    set((s) => {
      const sym = s.powerSymbols.get(id);
      if (!sym) return s;
      const snapped = s.snapToGrid
        ? { x: snappedValue(position.x, s.gridSize), y: snappedValue(position.y, s.gridSize) }
        : position;
      const ps = new Map(s.powerSymbols);
      ps.set(id, { ...sym, position: snapped });
      return { powerSymbols: ps };
    });
  },

  removePowerSymbol: (id) => {
    get().pushHistory();
    set((s) => {
      const ps = new Map(s.powerSymbols);
      ps.delete(id);
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(id);
      return { powerSymbols: ps, selectedIds };
    });
    get().rebuildNets();
  },

  // -----------------------------------------------------------------------
  // Junction operations
  // -----------------------------------------------------------------------

  addJunction: (junction) => {
    set((s) => {
      const juncs = new Map(s.junctions);
      juncs.set(junction.id, junction);
      return { junctions: juncs };
    });
  },

  removeJunction: (id) => {
    set((s) => {
      const juncs = new Map(s.junctions);
      juncs.delete(id);
      return { junctions: juncs };
    });
  },

  autoDetectJunctions: () => {
    const state = get();
    const newJunctions = new Map<string, SchematicJunction>();
    const allSegments: { wireId: string; seg: WireSegment }[] = [];

    state.wires.forEach((wire) => {
      wire.segments.forEach((seg) => {
        allSegments.push({ wireId: wire.id, seg });
      });
    });

    // Check each pair of segments from different wires
    for (let i = 0; i < allSegments.length; i++) {
      for (let j = i + 1; j < allSegments.length; j++) {
        if (allSegments[i].wireId === allSegments[j].wireId) continue;
        const pt = segmentsIntersect(
          allSegments[i].seg.start, allSegments[i].seg.end,
          allSegments[j].seg.start, allSegments[j].seg.end,
        );
        if (pt) {
          const key = `${pt.x},${pt.y}`;
          if (!newJunctions.has(key)) {
            newJunctions.set(key, {
              id: generateId('junc'),
              position: pt,
              netId: null,
            });
          }
        }
      }
    }

    // Also add junctions at wire endpoints that touch other wires midway
    state.wires.forEach((wire) => {
      wire.segments.forEach((seg) => {
        [seg.start, seg.end].forEach((endpoint) => {
          state.wires.forEach((otherWire) => {
            if (otherWire.id === wire.id) return;
            otherWire.segments.forEach((otherSeg) => {
              // Check if endpoint lies on the other segment (not at its endpoints)
              const onSegment = pointOnSegment(endpoint, otherSeg.start, otherSeg.end);
              if (onSegment && !pointEquals(endpoint, otherSeg.start) && !pointEquals(endpoint, otherSeg.end)) {
                const key = `${endpoint.x},${endpoint.y}`;
                if (!newJunctions.has(key)) {
                  newJunctions.set(key, {
                    id: generateId('junc'),
                    position: endpoint,
                    netId: null,
                  });
                }
              }
            });
          });
        });
      });
    });

    set({ junctions: newJunctions });
  },

  // -----------------------------------------------------------------------
  // Net operations
  // -----------------------------------------------------------------------

  rebuildNets: () => {
    const state = get();
    const nets = new Map<string, SchematicNet>();

    // Build connectivity graph using union-find
    const parent = new Map<string, string>();
    function find(a: string): string {
      if (!parent.has(a)) parent.set(a, a);
      let root = a;
      while (parent.get(root) !== root) root = parent.get(root)!;
      // Path compression
      let current = a;
      while (current !== root) {
        const next = parent.get(current)!;
        parent.set(current, root);
        current = next;
      }
      return root;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    // Assign point keys for wire endpoints
    function ptKey(p: SchematicPoint): string {
      return `${p.x},${p.y}`;
    }

    // Connect all wire segment endpoints
    state.wires.forEach((wire) => {
      const points = wire.segments.flatMap((seg) => [ptKey(seg.start), ptKey(seg.end)]);
      for (let i = 1; i < points.length; i++) {
        union(points[0], points[i]);
      }
    });

    // Connect component pins to wire endpoints at same position
    state.components.forEach((comp) => {
      comp.pins.forEach((pin) => {
        const absPinPos = {
          x: comp.position.x + pin.position.x,
          y: comp.position.y + pin.position.y,
        };
        const key = ptKey(absPinPos);
        // Check if any wire endpoint matches
        state.wires.forEach((wire) => {
          wire.segments.forEach((seg) => {
            if (ptKey(seg.start) === key || ptKey(seg.end) === key) {
              union(key, ptKey(seg.start));
            }
          });
        });
      });
    });

    // Group by root
    const groups = new Map<string, Set<string>>();
    parent.forEach((_, key) => {
      const root = find(key);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(key);
    });

    // Build nets
    let netIdx = 0;
    groups.forEach((pointKeys, root) => {
      netIdx++;
      // Find label name if any
      let netName = `Net${netIdx}`;
      state.labels.forEach((label) => {
        const key = ptKey(label.position);
        if (pointKeys.has(key)) {
          netName = label.text;
        }
      });

      // Find power symbols
      state.powerSymbols.forEach((ps) => {
        const key = ptKey(ps.position);
        if (pointKeys.has(key)) {
          netName = ps.name;
        }
      });

      const wireIds: string[] = [];
      state.wires.forEach((wire) => {
        const inNet = wire.segments.some(
          (seg) => pointKeys.has(ptKey(seg.start)) || pointKeys.has(ptKey(seg.end)),
        );
        if (inNet) wireIds.push(wire.id);
      });

      const pinIds: string[] = [];
      state.components.forEach((comp) => {
        comp.pins.forEach((pin) => {
          const absPinPos = {
            x: comp.position.x + pin.position.x,
            y: comp.position.y + pin.position.y,
          };
          if (pointKeys.has(ptKey(absPinPos))) {
            pinIds.push(pin.id);
          }
        });
      });

      const labelIds: string[] = [];
      state.labels.forEach((label) => {
        if (pointKeys.has(ptKey(label.position))) {
          labelIds.push(label.id);
        }
      });

      const netId = generateId('net');
      nets.set(netId, {
        id: netId,
        name: netName,
        class: 'default',
        wireIds,
        pinIds,
        labelIds,
      });

      // Update wire netIds
      wireIds.forEach((wId) => {
        const w = state.wires.get(wId);
        if (w) state.wires.set(wId, { ...w, netId });
      });
    });

    set({ nets });
  },

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  select: (id, additive = false) => set((s) => {
    const selected = additive ? new Set(s.selectedIds) : new Set<string>();
    selected.add(id);
    // Mark items as selected
    const comps = new Map(s.components);
    comps.forEach((c, cid) => comps.set(cid, { ...c, selected: selected.has(cid) }));
    const wires = new Map(s.wires);
    wires.forEach((w, wid) => wires.set(wid, { ...w, selected: selected.has(wid) }));
    const labels = new Map(s.labels);
    labels.forEach((l, lid) => labels.set(lid, { ...l, selected: selected.has(lid) }));
    const ps = new Map(s.powerSymbols);
    ps.forEach((p, pid) => ps.set(pid, { ...p, selected: selected.has(pid) }));
    return { selectedIds: selected, components: comps, wires, labels, powerSymbols: ps };
  }),

  selectAll: () => set((s) => {
    const selected = new Set<string>();
    s.components.forEach((_, id) => selected.add(id));
    s.wires.forEach((_, id) => selected.add(id));
    s.labels.forEach((_, id) => selected.add(id));
    s.buses.forEach((_, id) => selected.add(id));
    s.powerSymbols.forEach((_, id) => selected.add(id));
    const comps = new Map(s.components);
    comps.forEach((c, id) => comps.set(id, { ...c, selected: true }));
    const wires = new Map(s.wires);
    wires.forEach((w, id) => wires.set(id, { ...w, selected: true }));
    const labels = new Map(s.labels);
    labels.forEach((l, id) => labels.set(id, { ...l, selected: true }));
    const ps = new Map(s.powerSymbols);
    ps.forEach((p, id) => ps.set(id, { ...p, selected: true }));
    return { selectedIds: selected, components: comps, wires, labels, powerSymbols: ps };
  }),

  selectInRect: (topLeft, bottomRight, additive = false) => set((s) => {
    const selected = additive ? new Set(s.selectedIds) : new Set<string>();

    s.components.forEach((c) => {
      if (c.position.x >= topLeft.x && c.position.x <= bottomRight.x &&
          c.position.y >= topLeft.y && c.position.y <= bottomRight.y) {
        selected.add(c.id);
      }
    });

    s.wires.forEach((w) => {
      const allInside = w.segments.every(
        (seg) =>
          seg.start.x >= topLeft.x && seg.start.x <= bottomRight.x &&
          seg.start.y >= topLeft.y && seg.start.y <= bottomRight.y &&
          seg.end.x >= topLeft.x && seg.end.x <= bottomRight.x &&
          seg.end.y >= topLeft.y && seg.end.y <= bottomRight.y,
      );
      if (allInside) selected.add(w.id);
    });

    s.labels.forEach((l) => {
      if (l.position.x >= topLeft.x && l.position.x <= bottomRight.x &&
          l.position.y >= topLeft.y && l.position.y <= bottomRight.y) {
        selected.add(l.id);
      }
    });

    s.powerSymbols.forEach((ps) => {
      if (ps.position.x >= topLeft.x && ps.position.x <= bottomRight.x &&
          ps.position.y >= topLeft.y && ps.position.y <= bottomRight.y) {
        selected.add(ps.id);
      }
    });

    const comps = new Map(s.components);
    comps.forEach((c, id) => comps.set(id, { ...c, selected: selected.has(id) }));
    const wires = new Map(s.wires);
    wires.forEach((w, id) => wires.set(id, { ...w, selected: selected.has(id) }));
    const labels = new Map(s.labels);
    labels.forEach((l, id) => labels.set(id, { ...l, selected: selected.has(id) }));
    const pSyms = new Map(s.powerSymbols);
    pSyms.forEach((p, id) => pSyms.set(id, { ...p, selected: selected.has(id) }));
    return { selectedIds: selected, components: comps, wires, labels, powerSymbols: pSyms };
  }),

  deselect: (id) => set((s) => {
    const selected = new Set(s.selectedIds);
    selected.delete(id);
    const comps = new Map(s.components);
    const c = comps.get(id);
    if (c) comps.set(id, { ...c, selected: false });
    const wires = new Map(s.wires);
    const w = wires.get(id);
    if (w) wires.set(id, { ...w, selected: false });
    const labels = new Map(s.labels);
    const l = labels.get(id);
    if (l) labels.set(id, { ...l, selected: false });
    const ps = new Map(s.powerSymbols);
    const p = ps.get(id);
    if (p) ps.set(id, { ...p, selected: false });
    return { selectedIds: selected, components: comps, wires, labels, powerSymbols: ps };
  }),

  deselectAll: () => set((s) => {
    const comps = new Map(s.components);
    comps.forEach((c, id) => comps.set(id, { ...c, selected: false }));
    const wires = new Map(s.wires);
    wires.forEach((w, id) => wires.set(id, { ...w, selected: false }));
    const labels = new Map(s.labels);
    labels.forEach((l, id) => labels.set(id, { ...l, selected: false }));
    const ps = new Map(s.powerSymbols);
    ps.forEach((p, id) => ps.set(id, { ...p, selected: false }));
    return { selectedIds: new Set(), components: comps, wires, labels, powerSymbols: ps };
  }),

  setHovered: (id) => set({ hoveredId: id }),

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  deleteSelected: () => {
    const state = get();
    if (state.selectedIds.size === 0) return;
    get().pushHistory();
    set((s) => {
      const comps = new Map(s.components);
      const wires = new Map(s.wires);
      const labels = new Map(s.labels);
      const buses = new Map(s.buses);
      const ps = new Map(s.powerSymbols);
      s.selectedIds.forEach((id) => {
        comps.delete(id);
        wires.delete(id);
        labels.delete(id);
        buses.delete(id);
        ps.delete(id);
      });
      return { components: comps, wires, labels, buses, powerSymbols: ps, selectedIds: new Set() };
    });
    get().autoDetectJunctions();
    get().rebuildNets();
  },

  moveSelected: (dx, dy) => {
    set((s) => {
      const sdx = s.snapToGrid ? snappedValue(dx, s.gridSize) : dx;
      const sdy = s.snapToGrid ? snappedValue(dy, s.gridSize) : dy;
      if (sdx === 0 && sdy === 0) return s;

      const comps = new Map(s.components);
      const wires = new Map(s.wires);
      const labels = new Map(s.labels);
      const ps = new Map(s.powerSymbols);

      s.selectedIds.forEach((id) => {
        const comp = comps.get(id);
        if (comp) {
          comps.set(id, {
            ...comp,
            position: { x: comp.position.x + sdx, y: comp.position.y + sdy },
          });
        }
        const wire = wires.get(id);
        if (wire) {
          wires.set(id, {
            ...wire,
            segments: wire.segments.map((seg) => ({
              start: { x: seg.start.x + sdx, y: seg.start.y + sdy },
              end: { x: seg.end.x + sdx, y: seg.end.y + sdy },
            })),
          });
        }
        const label = labels.get(id);
        if (label) {
          labels.set(id, {
            ...label,
            position: { x: label.position.x + sdx, y: label.position.y + sdy },
          });
        }
        const pSym = ps.get(id);
        if (pSym) {
          ps.set(id, {
            ...pSym,
            position: { x: pSym.position.x + sdx, y: pSym.position.y + sdy },
          });
        }
      });

      return { components: comps, wires, labels, powerSymbols: ps };
    });
  },

  // -----------------------------------------------------------------------
  // Clipboard
  // -----------------------------------------------------------------------

  copySelected: () => {
    const state = get();
    const components: SchematicComponent[] = [];
    const wires: SchematicWire[] = [];
    const labels: SchematicLabel[] = [];
    const powerSymbols: PowerSymbol[] = [];

    state.selectedIds.forEach((id) => {
      const c = state.components.get(id);
      if (c) components.push({ ...c });
      const w = state.wires.get(id);
      if (w) wires.push({ ...w });
      const l = state.labels.get(id);
      if (l) labels.push({ ...l });
      const p = state.powerSymbols.get(id);
      if (p) powerSymbols.push({ ...p });
    });

    set({ clipboard: { components, wires, labels, powerSymbols } });
  },

  cutSelected: () => {
    get().copySelected();
    get().deleteSelected();
  },

  paste: (position) => {
    const state = get();
    if (!state.clipboard) return;

    get().pushHistory();

    // Calculate centroid of clipboard content
    const allPositions: SchematicPoint[] = [
      ...state.clipboard.components.map((c) => c.position),
      ...state.clipboard.labels.map((l) => l.position),
      ...state.clipboard.powerSymbols.map((p) => p.position),
    ];

    state.clipboard.wires.forEach((w) => {
      w.segments.forEach((seg) => {
        allPositions.push(seg.start);
        allPositions.push(seg.end);
      });
    });

    if (allPositions.length === 0) return;

    const cx = allPositions.reduce((sum, p) => sum + p.x, 0) / allPositions.length;
    const cy = allPositions.reduce((sum, p) => sum + p.y, 0) / allPositions.length;
    const dx = position.x - cx;
    const dy = position.y - cy;

    const newSelected = new Set<string>();

    set((s) => {
      const comps = new Map(s.components);
      const wires = new Map(s.wires);
      const labels = new Map(s.labels);
      const ps = new Map(s.powerSymbols);

      // Deselect all existing
      comps.forEach((c, id) => comps.set(id, { ...c, selected: false }));
      wires.forEach((w, id) => wires.set(id, { ...w, selected: false }));
      labels.forEach((l, id) => labels.set(id, { ...l, selected: false }));
      ps.forEach((p, id) => ps.set(id, { ...p, selected: false }));

      state.clipboard!.components.forEach((c) => {
        const newId = generateId('comp');
        newSelected.add(newId);
        comps.set(newId, {
          ...c,
          id: newId,
          position: { x: c.position.x + dx, y: c.position.y + dy },
          selected: true,
        });
      });

      state.clipboard!.wires.forEach((w) => {
        const newId = generateId('wire');
        newSelected.add(newId);
        wires.set(newId, {
          ...w,
          id: newId,
          segments: w.segments.map((seg) => ({
            start: { x: seg.start.x + dx, y: seg.start.y + dy },
            end: { x: seg.end.x + dx, y: seg.end.y + dy },
          })),
          selected: true,
        });
      });

      state.clipboard!.labels.forEach((l) => {
        const newId = generateId('label');
        newSelected.add(newId);
        labels.set(newId, {
          ...l,
          id: newId,
          position: { x: l.position.x + dx, y: l.position.y + dy },
          selected: true,
        });
      });

      state.clipboard!.powerSymbols.forEach((p) => {
        const newId = generateId('power');
        newSelected.add(newId);
        ps.set(newId, {
          ...p,
          id: newId,
          position: { x: p.position.x + dx, y: p.position.y + dy },
          selected: true,
        });
      });

      return { components: comps, wires, labels, powerSymbols: ps, selectedIds: newSelected };
    });
  },

  // -----------------------------------------------------------------------
  // Undo/Redo
  // -----------------------------------------------------------------------

  pushHistory: () => {
    const state = get();
    const entry = captureHistoryEntry(state);
    set((s) => {
      const stack = [...s.undoStack, entry];
      if (stack.length > s.maxHistorySize) stack.shift();
      return { undoStack: stack, redoStack: [] };
    });
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;

    const redoEntry = captureHistoryEntry(state);
    const undoEntry = state.undoStack[state.undoStack.length - 1];

    set({
      components: undoEntry.components,
      wires: undoEntry.wires,
      labels: undoEntry.labels,
      buses: undoEntry.buses,
      powerSymbols: undoEntry.powerSymbols,
      junctions: undoEntry.junctions,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, redoEntry],
      selectedIds: new Set(),
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;

    const undoEntry = captureHistoryEntry(state);
    const redoEntry = state.redoStack[state.redoStack.length - 1];

    set({
      components: redoEntry.components,
      wires: redoEntry.wires,
      labels: redoEntry.labels,
      buses: redoEntry.buses,
      powerSymbols: redoEntry.powerSymbols,
      junctions: redoEntry.junctions,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, undoEntry],
      selectedIds: new Set(),
    });
  },

  // -----------------------------------------------------------------------
  // Sheet operations
  // -----------------------------------------------------------------------

  addSheet: (name) => {
    const id = generateId('sheet');
    set((s) => {
      const sheets = new Map(s.sheets);
      sheets.set(id, {
        id,
        name,
        number: sheets.size + 1,
        components: [],
        wires: [],
        labels: [],
        buses: [],
        powerSymbols: [],
      });
      return { sheets };
    });
  },

  removeSheet: (id) => {
    set((s) => {
      if (s.sheets.size <= 1) return s; // Cannot remove last sheet
      const sheets = new Map(s.sheets);
      sheets.delete(id);
      const newActive = s.activeSheetId === id ? sheets.keys().next().value! : s.activeSheetId;
      return { sheets, activeSheetId: newActive };
    });
  },

  setActiveSheet: (id) => set({ activeSheetId: id }),

  // -----------------------------------------------------------------------
  // Design intent operations
  // -----------------------------------------------------------------------

  addDesignIntent: (intent) => set((s) => {
    const intents = new Map(s.designIntents);
    intents.set(intent.id, intent);
    return { designIntents: intents };
  }),

  updateDesignIntent: (id, updates) => set((s) => {
    const intent = s.designIntents.get(id);
    if (!intent) return s;
    const intents = new Map(s.designIntents);
    intents.set(id, { ...intent, ...updates, updatedAt: new Date().toISOString() });
    return { designIntents: intents };
  }),

  removeDesignIntent: (id) => set((s) => {
    const intents = new Map(s.designIntents);
    intents.delete(id);
    return { designIntents: intents };
  }),

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  exportSchematic: () => {
    const state = get();
    return {
      version: '1.0.0',
      sheets: Array.from(state.sheets.values()),
      components: Array.from(state.components.values()).map((c) => ({ ...c, selected: false })),
      wires: Array.from(state.wires.values()).map((w) => ({ ...w, selected: false })),
      junctions: Array.from(state.junctions.values()),
      labels: Array.from(state.labels.values()).map((l) => ({ ...l, selected: false })),
      buses: Array.from(state.buses.values()).map((b) => ({ ...b, selected: false })),
      powerSymbols: Array.from(state.powerSymbols.values()).map((p) => ({ ...p, selected: false })),
      nets: Array.from(state.nets.values()),
      designIntents: Array.from(state.designIntents.values()),
    };
  },

  importSchematic: (data: any) => {
    const comps = new Map<string, SchematicComponent>();
    (data.components || []).forEach((c: SchematicComponent) => comps.set(c.id, c));
    const wires = new Map<string, SchematicWire>();
    (data.wires || []).forEach((w: SchematicWire) => wires.set(w.id, w));
    const juncs = new Map<string, SchematicJunction>();
    (data.junctions || []).forEach((j: SchematicJunction) => juncs.set(j.id, j));
    const labels = new Map<string, SchematicLabel>();
    (data.labels || []).forEach((l: SchematicLabel) => labels.set(l.id, l));
    const buses = new Map<string, SchematicBus>();
    (data.buses || []).forEach((b: SchematicBus) => buses.set(b.id, b));
    const ps = new Map<string, PowerSymbol>();
    (data.powerSymbols || []).forEach((p: PowerSymbol) => ps.set(p.id, p));
    const nets = new Map<string, SchematicNet>();
    (data.nets || []).forEach((n: SchematicNet) => nets.set(n.id, n));
    const sheets = new Map<string, SchematicSheet>();
    (data.sheets || []).forEach((s: SchematicSheet) => sheets.set(s.id, s));
    const intents = new Map<string, DesignIntent>();
    (data.designIntents || []).forEach((i: DesignIntent) => intents.set(i.id, i));

    set({
      components: comps,
      wires,
      junctions: juncs,
      labels,
      buses,
      powerSymbols: ps,
      nets,
      sheets: sheets.size > 0 ? sheets : new Map([['sheet_1', defaultSheet]]),
      activeSheetId: sheets.size > 0 ? sheets.keys().next().value! : 'sheet_1',
      designIntents: intents,
      selectedIds: new Set(),
      undoStack: [],
      redoStack: [],
    });
  },
}));

// ---------------------------------------------------------------------------
// Geometry helpers (module-level)
// ---------------------------------------------------------------------------

function pointEquals(a: SchematicPoint, b: SchematicPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointOnSegment(p: SchematicPoint, a: SchematicPoint, b: SchematicPoint): boolean {
  // Check collinearity and bounding box for orthogonal segments
  if (a.x === b.x && p.x === a.x) {
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return p.y >= minY && p.y <= maxY;
  }
  if (a.y === b.y && p.y === a.y) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    return p.x >= minX && p.x <= maxX;
  }
  return false;
}
