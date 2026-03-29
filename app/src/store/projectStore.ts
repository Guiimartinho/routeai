// ─── Unified Project Store ──────────────────────────────────────────────────
// Single source of truth: schematic, board, netlist, metadata, undo/redo.
// This replaces the disconnected editorStore + BoardEditor local state.

import { create } from 'zustand';
import type {
  SchComponent, SchWire, SchLabel, SchNet, SchPin, SchSheet,
  BrdComponent, BrdPad, BrdTrace, BrdVia, BrdZone,
  BoardOutline, BoardState, SchematicState, BusWire,
  Point,
} from '../types';
import { lookupFootprint, type FootprintDef } from './footprintData';
import { createDefaultDesignRules, type DesignRulesConfig } from './designRules';
import { addToRecentProjects } from './recentProjects';
import { getStorage, migrateFromLocalStorage, type ProjectMeta } from './storage';
import { serializeProject, deserializeProject, downloadRouteAIFile, readRouteAIFile, validateProjectFile } from './fileFormat';

// ─── Constants ──────────────────────────────────────────────────────────────

const SNAP_DISTANCE = 3.0; // mm - max distance for pin-to-wire connectivity (increased for grid tolerance)
const MAX_UNDO_DEPTH = 80;
const AUTOSAVE_KEY = 'routeai_project_autosave';

// ─── Project data shape ─────────────────────────────────────────────────────

export interface ProjectMetadata {
  name: string;
  version: string;
  createdAt: string;
  modifiedAt: string;
  author: string;
  description: string;
}

export interface ProjectData {
  metadata: ProjectMetadata;
  schematic: SchematicState;
  board: BoardState;
  nets: SchNet[];
  designRules: DesignRulesConfig;
}

// ─── Snapshot for undo ──────────────────────────────────────────────────────

interface Snapshot {
  schematic: SchematicState;
  board: BoardState;
  nets: SchNet[];
}

// ─── Store interface ────────────────────────────────────────────────────────

export interface ProjectStore {
  // ── Metadata ──
  metadata: ProjectMetadata;
  setMetadata: (patch: Partial<ProjectMetadata>) => void;

  // ── Schematic data ──
  schematic: SchematicState;
  updateSchematic: (patch: Partial<SchematicState>) => void;
  addSchComponent: (c: SchComponent) => void;
  updateSchComponent: (id: string, patch: Partial<SchComponent>) => void;
  removeSchComponents: (ids: string[]) => void;
  moveSchComponents: (ids: string[], dx: number, dy: number) => void;
  addSchWire: (w: SchWire) => void;
  removeSchWires: (ids: string[]) => void;
  addSchLabel: (l: SchLabel) => void;
  removeSchLabels: (ids: string[]) => void;

  // ── Bus wires & NoConnect markers (persisted) ──
  addBusWire: (bw: BusWire) => void;
  removeBusWires: (ids: string[]) => void;
  addNoConnect: (pt: Point) => void;
  removeNoConnect: (pt: Point) => void;

  // ── Drag-aware move (no undo push per increment) ──
  moveSchComponentsIncremental: (ids: string[], dx: number, dy: number) => void;

  // ── Sheet management (hierarchical schematics) ──
  addSheet: (name: string) => void;
  removeSheet: (id: string) => void;
  renameSheet: (id: string, name: string) => void;
  switchSheet: (id: string) => void;
  duplicateSheet: (id: string) => void;
  reorderSheets: (orderedIds: string[]) => void;

  // ── Board data ──
  board: BoardState;
  updateBoard: (patch: Partial<BoardState>) => void;
  addBrdComponent: (c: BrdComponent) => void;
  updateBrdComponent: (id: string, patch: Partial<BrdComponent>) => void;
  removeBrdComponents: (ids: string[]) => void;
  moveBrdComponent: (id: string, x: number, y: number) => void;
  addBrdTrace: (t: BrdTrace) => void;
  removeBrdTraces: (ids: string[]) => void;
  addBrdVia: (v: BrdVia) => void;
  removeBrdVias: (ids: string[]) => void;
  addBrdZone: (z: BrdZone) => void;
  removeBrdZones: (ids: string[]) => void;
  setBoardOutline: (o: BoardOutline) => void;

  // ── Nets ──
  nets: SchNet[];

  // ── Design Rules ──
  designRules: DesignRulesConfig;
  setDesignRules: (rules: DesignRulesConfig) => void;

  // ── Netlist extraction ──
  extractNetlist: () => SchNet[];

  // ── Forward annotation ──
  syncSchematicToBoard: () => void;

  // ── Undo / Redo ──
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // ── Dirty tracking ──
  isDirty: boolean;
  markClean: () => void;

  // ── Persistence ──
  saveProject: () => ProjectData;
  loadProject: (data: ProjectData) => void;
  /** @deprecated Use saveToStorage() instead. Kept for sync fallback. */
  saveToLocalStorage: () => void;
  /** @deprecated Use loadFromStorage() instead. Kept for sync fallback. */
  loadFromLocalStorage: () => boolean;
  /** Save current project to IndexedDB (async). */
  saveToStorage: () => Promise<void>;
  /** Load autosave from IndexedDB (async). Returns true if loaded. */
  loadFromStorage: () => Promise<boolean>;
  /** List all saved projects from IndexedDB. */
  listSavedProjects: () => Promise<ProjectMeta[]>;
  /** Save a named copy of the current project to IndexedDB. */
  saveProjectAs: (name: string) => Promise<string>;
  /** Delete a saved project from IndexedDB by id. */
  deleteSavedProject: (id: string) => Promise<void>;
  /** Initialize storage engine (call once at app start). */
  initStorage: () => Promise<void>;
  downloadProject: () => void;
  uploadProject: (file: File) => Promise<void>;
  newProject: (name?: string) => void;
}

// ─── UID generator ──────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++_uidCounter).toString(36)}`;
}

// ─── Default empty state ────────────────────────────────────────────────────

const DEFAULT_SHEET_ID = 'sheet_1';

function emptySchematic(): SchematicState {
  return {
    components: [],
    wires: [],
    labels: [],
    nets: [],
    busWires: [],
    noConnects: [],
    sheets: [{ id: DEFAULT_SHEET_ID, name: 'Sheet 1', components: [], wires: [], labels: [] }],
    activeSheetId: DEFAULT_SHEET_ID,
  };
}

function emptyBoard(): BoardState {
  return {
    components: [],
    traces: [],
    vias: [],
    zones: [],
    outline: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] },
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
  };
}

function defaultMetadata(name?: string): ProjectMetadata {
  return {
    name: name || 'Untitled Project',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    author: '',
    description: '',
  };
}

// ─── Deep clone ─────────────────────────────────────────────────────────────

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ─── Distance helper ────────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ─── Point-on-segment check ─────────────────────────────────────────────────

function pointNearSegment(p: Point, a: Point, b: Point, threshold: number): boolean {
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lenSq === 0) return dist(p, a) <= threshold;
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return dist(p, proj) <= threshold;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── NETLIST EXTRACTION ─────────────────────────────────────────────────────
// This is the core EDA logic. It uses Union-Find to group connected
// pins, wire endpoints, and labels into nets.
// ═══════════════════════════════════════════════════════════════════════════

class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  makeSet(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: string): string {
    if (!this.parent.has(x)) this.makeSet(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) || 0;
    const rankB = this.rank.get(rb) || 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  /** Get all groups: root -> members[] */
  groups(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!result.has(root)) result.set(root, []);
      result.get(root)!.push(key);
    }
    return result;
  }
}

/**
 * Extract nets from schematic data by tracing connectivity through:
 * 1. Wire endpoints that overlap (within snap distance)
 * 2. Pin positions that touch wire endpoints
 * 3. Labels: all items touching a wire/pin with the same label name share a net
 * 4. Power ports: all power symbols of the same type share a net
 */
/**
 * Gather all components, wires, and labels from ALL sheets.
 * Backward compatible: if sheets array is empty/missing, uses top-level fields.
 */
function gatherAllSheetData(sch: SchematicState): {
  allComponents: SchComponent[];
  allWires: SchWire[];
  allLabels: SchLabel[];
} {
  if (sch.sheets && sch.sheets.length > 0) {
    const allComponents: SchComponent[] = [];
    const allWires: SchWire[] = [];
    const allLabels: SchLabel[] = [];
    for (const sheet of sch.sheets) {
      allComponents.push(...sheet.components);
      allWires.push(...sheet.wires);
      allLabels.push(...sheet.labels);
    }
    return { allComponents, allWires, allLabels };
  }
  // Backward compat: no sheets, use top-level data
  return {
    allComponents: sch.components,
    allWires: sch.wires,
    allLabels: sch.labels,
  };
}

function extractNetlistFromSchematic(sch: SchematicState): SchNet[] {
  const uf = new UnionFind();

  // Gather data from ALL sheets for netlist extraction
  const { allComponents, allWires, allLabels } = gatherAllSheetData(sch);

  // ── Step 1: Compute absolute pin positions ────────────────────────────
  interface AbsPin {
    pinId: string;
    compId: string;
    compRef: string;
    pos: Point;
    name: string;
    type: string;
  }

  const absPins: AbsPin[] = [];
  for (const comp of allComponents) {
    const rad = (comp.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    for (const pin of comp.pins) {
      // Rotate pin position around component origin, then translate
      const rx = pin.x * cosR - pin.y * sinR;
      const ry = pin.x * sinR + pin.y * cosR;
      const absX = comp.x + rx;
      const absY = comp.y + ry;
      absPins.push({
        pinId: pin.id,
        compId: comp.id,
        compRef: comp.ref,
        pos: { x: absX, y: absY },
        name: pin.name,
        type: pin.type,
      });
      uf.makeSet(`pin:${pin.id}`);
    }
  }

  // ── Step 2: Index wire endpoints ──────────────────────────────────────
  interface WireEndpoint {
    wireId: string;
    pointIndex: number;
    pos: Point;
  }

  const wireEndpoints: WireEndpoint[] = [];
  for (const wire of allWires) {
    for (let i = 0; i < wire.points.length; i++) {
      const ep: WireEndpoint = {
        wireId: wire.id,
        pointIndex: i,
        pos: wire.points[i],
      };
      wireEndpoints.push(ep);
      uf.makeSet(`wpt:${wire.id}:${i}`);
    }
    // All points on the same wire are connected
    for (let i = 1; i < wire.points.length; i++) {
      uf.union(`wpt:${wire.id}:0`, `wpt:${wire.id}:${i}`);
    }
  }

  // ── Step 3: Connect overlapping wire endpoints ────────────────────────
  // Wire junctions: endpoints of different wires at the same position
  for (let i = 0; i < wireEndpoints.length; i++) {
    for (let j = i + 1; j < wireEndpoints.length; j++) {
      const a = wireEndpoints[i];
      const b = wireEndpoints[j];
      if (a.wireId === b.wireId) continue;
      if (dist(a.pos, b.pos) <= SNAP_DISTANCE) {
        uf.union(`wpt:${a.wireId}:${a.pointIndex}`, `wpt:${b.wireId}:${b.pointIndex}`);
      }
    }
  }

  // ── Step 4: Connect pins to wire endpoints within snap distance ───────
  for (const pin of absPins) {
    for (const ep of wireEndpoints) {
      if (dist(pin.pos, ep.pos) <= SNAP_DISTANCE) {
        uf.union(`pin:${pin.pinId}`, `wpt:${ep.wireId}:${ep.pointIndex}`);
      }
    }
    // Also check pin proximity to wire segments (not just endpoints)
    for (const wire of allWires) {
      for (let i = 0; i < wire.points.length - 1; i++) {
        if (pointNearSegment(pin.pos, wire.points[i], wire.points[i + 1], SNAP_DISTANCE)) {
          uf.union(`pin:${pin.pinId}`, `wpt:${wire.id}:${i}`);
        }
      }
    }
  }

  // ── Step 5: Connect pins that are at the same position (stacked pins) ─
  for (let i = 0; i < absPins.length; i++) {
    for (let j = i + 1; j < absPins.length; j++) {
      if (dist(absPins[i].pos, absPins[j].pos) <= SNAP_DISTANCE) {
        uf.union(`pin:${absPins[i].pinId}`, `pin:${absPins[j].pinId}`);
      }
    }
  }

  // ── Step 6: Label connectivity ────────────────────────────────────────
  // Labels connect all pins/wires they touch to a named net.
  // Multiple labels with the same name create the same net (even if far apart).
  interface LabelNode {
    labelId: string;
    text: string;
    pos: Point;
  }

  const labelNodes: LabelNode[] = allLabels.map(l => ({
    labelId: l.id,
    text: l.text,
    pos: { x: l.x, y: l.y },
  }));

  // Connect labels to nearby pins/wire endpoints
  for (const lbl of labelNodes) {
    const lblKey = `label:${lbl.labelId}`;
    uf.makeSet(lblKey);

    // Connect to nearby pins
    for (const pin of absPins) {
      if (dist(lbl.pos, pin.pos) <= SNAP_DISTANCE) {
        uf.union(lblKey, `pin:${pin.pinId}`);
      }
    }
    // Connect to nearby wire endpoints
    for (const ep of wireEndpoints) {
      if (dist(lbl.pos, ep.pos) <= SNAP_DISTANCE) {
        uf.union(lblKey, `wpt:${ep.wireId}:${ep.pointIndex}`);
      }
    }
    // Connect to wire segments
    for (const wire of allWires) {
      for (let i = 0; i < wire.points.length - 1; i++) {
        if (pointNearSegment(lbl.pos, wire.points[i], wire.points[i + 1], SNAP_DISTANCE)) {
          uf.union(lblKey, `wpt:${wire.id}:${i}`);
        }
      }
    }
  }

  // Labels with the same text share a net
  const labelsByText = new Map<string, string[]>();
  for (const lbl of labelNodes) {
    const key = lbl.text.toUpperCase();
    if (!labelsByText.has(key)) labelsByText.set(key, []);
    labelsByText.get(key)!.push(`label:${lbl.labelId}`);
  }
  for (const [, keys] of labelsByText) {
    for (let i = 1; i < keys.length; i++) {
      uf.union(keys[0], keys[i]);
    }
  }

  // ── Step 7: Power ports (GND, VCC, etc.) ─────────────────────────────
  // Components with type matching a power symbol share a net by value
  const powerSymbols = new Set(['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee']);
  const powerByValue = new Map<string, string[]>();
  for (const comp of allComponents) {
    if (powerSymbols.has(comp.type.toLowerCase()) || powerSymbols.has(comp.symbol.toLowerCase())) {
      const val = comp.value.toUpperCase();
      if (!powerByValue.has(val)) powerByValue.set(val, []);
      // Connect through pin 1 (power symbols typically have one pin)
      if (comp.pins.length > 0) {
        powerByValue.get(val)!.push(`pin:${comp.pins[0].id}`);
      }
    }
  }
  for (const [, pinKeys] of powerByValue) {
    for (let i = 1; i < pinKeys.length; i++) {
      uf.union(pinKeys[0], pinKeys[i]);
    }
  }

  // Also treat global labels as power-like: same name across the whole schematic
  for (const lbl of allLabels) {
    if (lbl.type === 'global' || lbl.type === 'power') {
      const val = lbl.text.toUpperCase();
      if (!powerByValue.has(val)) powerByValue.set(val, []);
      powerByValue.get(val)!.push(`label:${lbl.id}`);
    }
  }
  for (const [, keys] of powerByValue) {
    for (let i = 1; i < keys.length; i++) {
      uf.union(keys[0], keys[i]);
    }
  }

  // ── Step 8: Build nets from union-find groups ─────────────────────────
  const groups = uf.groups();
  const nets: SchNet[] = [];
  let netCounter = 0;

  for (const [, members] of groups) {
    // Collect pin IDs and wire IDs in this group
    const pinIds: string[] = [];
    const wireIds = new Set<string>();
    let netName = '';

    for (const member of members) {
      if (member.startsWith('pin:')) {
        pinIds.push(member.slice(4));
      } else if (member.startsWith('wpt:')) {
        const parts = member.split(':');
        wireIds.add(parts[1]);
      } else if (member.startsWith('label:')) {
        const labelId = member.slice(6);
        const lbl = allLabels.find(l => l.id === labelId);
        if (lbl && !netName) {
          netName = lbl.text;
        }
      }
    }

    // Skip groups with no pins (orphan wire segments with no connections)
    if (pinIds.length === 0) continue;

    // Try to derive a name from power symbols if no label
    if (!netName) {
      for (const pid of pinIds) {
        const pin = absPins.find(p => p.pinId === pid);
        if (pin) {
          const comp = allComponents.find(c => c.id === pin.compId);
          if (comp && (powerSymbols.has(comp.type.toLowerCase()) || powerSymbols.has(comp.symbol.toLowerCase()))) {
            netName = comp.value;
            break;
          }
        }
      }
    }

    // Auto-generate name if still unnamed
    if (!netName) {
      netCounter++;
      netName = `Net_${netCounter}`;
    }

    nets.push({
      id: `net_${netName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`,
      name: netName,
      pins: pinIds,
      wires: Array.from(wireIds),
    });
  }

  // Merge nets that ended up with the same name (from multiple union-find roots)
  const merged = new Map<string, SchNet>();
  for (const net of nets) {
    const key = net.name.toUpperCase();
    if (merged.has(key)) {
      const existing = merged.get(key)!;
      existing.pins = [...new Set([...existing.pins, ...net.pins])];
      existing.wires = [...new Set([...existing.wires, ...net.wires])];
    } else {
      merged.set(key, { ...net });
    }
  }

  return Array.from(merged.values());
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── FORWARD ANNOTATION ─────────────────────────────────────────────────────
// Creates board components from schematic, maps nets onto pads.
// ═══════════════════════════════════════════════════════════════════════════

function forwardAnnotate(
  sch: SchematicState,
  existingBoard: BoardState,
  nets: SchNet[],
): BoardState {
  const newBoard: BoardState = {
    ...clone(existingBoard),
    components: [],
    traces: existingBoard.traces, // Keep existing traces
    vias: existingBoard.vias,
    zones: existingBoard.zones,
  };

  // Map: schematic component ref -> existing board component (to preserve placement)
  const existingByRef = new Map<string, BrdComponent>();
  for (const bc of existingBoard.components) {
    existingByRef.set(bc.ref, bc);
  }

  // Build pin-to-net lookup
  const pinToNet = new Map<string, string>();
  for (const net of nets) {
    for (const pinId of net.pins) {
      pinToNet.set(pinId, net.id);
    }
  }

  // Grid for auto-placement of new components
  let placeX = 10;
  let placeY = 10;
  const placeSpacing = 12;
  const maxX = (existingBoard.outline.points.length > 0)
    ? Math.max(...existingBoard.outline.points.map(p => p.x)) - 10
    : 80;

  // Gather all components from ALL sheets for forward annotation
  const { allComponents: allSchComps } = gatherAllSheetData(sch);

  for (const schComp of allSchComps) {
    // Skip power symbols (they don't have physical footprints)
    const powerSymbols = new Set(['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee']);
    if (powerSymbols.has(schComp.type.toLowerCase()) || powerSymbols.has(schComp.symbol.toLowerCase())) {
      continue;
    }
    if (!schComp.footprint) continue;

    // Look up footprint geometry
    const fpDef = lookupFootprint(schComp.footprint);

    // Preserve existing placement if this ref was already on the board
    const existing = existingByRef.get(schComp.ref);

    // Build pads
    const pads: BrdPad[] = [];
    if (fpDef) {
      // Use real footprint data
      for (const fpPad of fpDef.pads) {
        // Find matching schematic pin by number
        const schPin = schComp.pins.find(p => p.number === fpPad.number);
        const netId = schPin ? (pinToNet.get(schPin.id) || '') : '';

        pads.push({
          id: uid('pad'),
          number: fpPad.number,
          x: fpPad.x,
          y: fpPad.y,
          width: fpPad.width,
          height: fpPad.height,
          shape: fpPad.shape,
          drill: fpPad.drill,
          layers: [...fpPad.layers],
          netId,
        });
      }
    } else {
      // Fallback: create generic pads from schematic pins
      for (let i = 0; i < schComp.pins.length; i++) {
        const pin = schComp.pins[i];
        const netId = pinToNet.get(pin.id) || '';
        // Arrange in a dual-row pattern
        const side = i < schComp.pins.length / 2 ? -1 : 1;
        const row = i < schComp.pins.length / 2 ? i : i - Math.ceil(schComp.pins.length / 2);
        pads.push({
          id: uid('pad'),
          number: pin.number,
          x: side * 3,
          y: (row - Math.floor(schComp.pins.length / 4)) * 1.27,
          width: 1.6,
          height: 0.5,
          shape: 'rect',
          layers: ['F.Cu'],
          netId,
        });
      }
    }

    // Determine placement position
    let posX: number, posY: number, rotation: number, layer: string;
    if (existing) {
      posX = existing.x;
      posY = existing.y;
      rotation = existing.rotation;
      layer = existing.layer;
    } else {
      posX = placeX;
      posY = placeY;
      rotation = 0;
      layer = 'F.Cu';
      // Advance placement grid
      placeX += placeSpacing;
      if (placeX > maxX) {
        placeX = 10;
        placeY += placeSpacing;
      }
    }

    newBoard.components.push({
      id: existing?.id || uid('bcomp'),
      ref: schComp.ref,
      value: schComp.value,
      footprint: schComp.footprint,
      x: posX,
      y: posY,
      rotation,
      layer,
      pads,
    });
  }

  return newBoard;
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── STORE CREATION ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ensure the active sheet in the sheets array is synced with the top-level
 * components/wires/labels (which may have been mutated directly).
 */
function syncActiveSheetToSheets(sch: SchematicState): SchematicState {
  if (!sch.sheets || sch.sheets.length === 0) return sch;
  return {
    ...sch,
    sheets: sch.sheets.map(sh =>
      sh.id === sch.activeSheetId
        ? { ...sh, components: sch.components, wires: sch.wires, labels: sch.labels }
        : sh
    ),
  };
}

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

function makeSnapshot(state: { schematic: SchematicState; board: BoardState; nets: SchNet[] }): Snapshot {
  return {
    schematic: clone(state.schematic),
    board: clone(state.board),
    nets: clone(state.nets),
  };
}

function pushUndo(state: { schematic: SchematicState; board: BoardState; nets: SchNet[] }) {
  undoStack.push(makeSnapshot(state));
  if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
  redoStack = [];
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // ── Metadata ──────────────────────────────────────────────────────────
  metadata: defaultMetadata(),
  setMetadata: (patch) => set((s) => ({
    metadata: { ...s.metadata, ...patch, modifiedAt: new Date().toISOString() },
    isDirty: true,
  })),

  // ── Schematic ─────────────────────────────────────────────────────────
  schematic: emptySchematic(),
  updateSchematic: (patch) => {
    pushUndo(get());
    set((s) => {
      const merged = { ...s.schematic, ...patch };
      // Sync patched data to active sheet
      const sheetPatch: Partial<SchSheet> = {};
      if (patch.components) sheetPatch.components = patch.components;
      if (patch.wires) sheetPatch.wires = patch.wires;
      if (patch.labels) sheetPatch.labels = patch.labels;
      if (Object.keys(sheetPatch).length > 0) {
        merged.sheets = merged.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId ? { ...sh, ...sheetPatch } : sh
        );
      }
      return { schematic: merged, isDirty: true, canUndo: true, canRedo: false };
    });
  },

  addSchComponent: (c) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        components: [...s.schematic.components, c],
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, components: [...sh.components, c] }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  updateSchComponent: (id, patch) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        components: s.schematic.components.map(c => c.id === id ? { ...c, ...patch } : c),
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, components: sh.components.map(c => c.id === id ? { ...c, ...patch } : c) }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeSchComponents: (ids) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        components: s.schematic.components.filter(c => !ids.includes(c.id)),
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, components: sh.components.filter(c => !ids.includes(c.id)) }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  moveSchComponents: (ids, dx, dy) => {
    pushUndo(get());
    set((s) => {
      // 1. Collect all pin positions BEFORE the move for components being moved
      const pinPositionsBefore: { x: number; y: number }[] = [];
      for (const comp of s.schematic.components) {
        if (!ids.includes(comp.id)) continue;
        const rad = (comp.rotation * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        for (const pin of comp.pins) {
          const rx = pin.x * cosR - pin.y * sinR;
          const ry = pin.x * sinR + pin.y * cosR;
          pinPositionsBefore.push({ x: comp.x + rx, y: comp.y + ry });
        }
      }

      // 2. Move the components
      const newComponents = s.schematic.components.map(c =>
        ids.includes(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c
      );

      // 3. Update wire endpoints that were connected to moved pins
      const WIRE_PIN_SNAP = 3.0; // mm
      const newWires = s.schematic.wires.map(w => {
        let changed = false;
        const newPoints = w.points.map(pt => {
          for (const pinPos of pinPositionsBefore) {
            const d = Math.hypot(pt.x - pinPos.x, pt.y - pinPos.y);
            if (d <= WIRE_PIN_SNAP) {
              changed = true;
              return { x: pt.x + dx, y: pt.y + dy };
            }
          }
          return pt;
        });
        return changed ? { ...w, points: newPoints } : w;
      });

      return {
        schematic: {
          ...s.schematic,
          components: newComponents,
          wires: newWires,
          sheets: s.schematic.sheets.map(sh =>
            sh.id === s.schematic.activeSheetId
              ? { ...sh, components: newComponents, wires: newWires }
              : sh
          ),
        },
        isDirty: true, canUndo: true, canRedo: false,
      };
    });
  },

  addSchWire: (w) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        wires: [...s.schematic.wires, w],
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, wires: [...sh.wires, w] }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeSchWires: (ids) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        wires: s.schematic.wires.filter(w => !ids.includes(w.id)),
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, wires: sh.wires.filter(w => !ids.includes(w.id)) }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addSchLabel: (l) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        labels: [...s.schematic.labels, l],
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, labels: [...sh.labels, l] }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeSchLabels: (ids) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        labels: s.schematic.labels.filter(l => !ids.includes(l.id)),
        sheets: s.schematic.sheets.map(sh =>
          sh.id === s.schematic.activeSheetId
            ? { ...sh, labels: sh.labels.filter(l => !ids.includes(l.id)) }
            : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  // ── Bus wires & NoConnect markers (persisted) ──────────────────────

  addBusWire: (bw) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        busWires: [...s.schematic.busWires, bw],
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeBusWires: (ids) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        busWires: s.schematic.busWires.filter(bw => !ids.includes(bw.id)),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addNoConnect: (pt) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        noConnects: [...s.schematic.noConnects, pt],
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeNoConnect: (pt) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        noConnects: s.schematic.noConnects.filter(
          nc => Math.hypot(nc.x - pt.x, nc.y - pt.y) > 0.5
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  // ── Drag-aware move: skips pushUndo for smooth real-time wire updates ──

  moveSchComponentsIncremental: (ids, dx, dy) => {
    // Same logic as moveSchComponents but WITHOUT pushUndo.
    // Caller is responsible for pushing undo once at drag start.
    set((s) => {
      // 1. Collect pin positions BEFORE move
      const pinPositionsBefore: { x: number; y: number }[] = [];
      for (const comp of s.schematic.components) {
        if (!ids.includes(comp.id)) continue;
        const rad = (comp.rotation * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        for (const pin of comp.pins) {
          const rx = pin.x * cosR - pin.y * sinR;
          const ry = pin.x * sinR + pin.y * cosR;
          pinPositionsBefore.push({ x: comp.x + rx, y: comp.y + ry });
        }
      }

      // 2. Move components
      const newComponents = s.schematic.components.map(c =>
        ids.includes(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c
      );

      // 3. Update wire endpoints connected to moved pins
      const WIRE_PIN_SNAP = 3.0;
      const newWires = s.schematic.wires.map(w => {
        let changed = false;
        const newPoints = w.points.map(pt => {
          for (const pinPos of pinPositionsBefore) {
            const d = Math.hypot(pt.x - pinPos.x, pt.y - pinPos.y);
            if (d <= WIRE_PIN_SNAP) {
              changed = true;
              return { x: pt.x + dx, y: pt.y + dy };
            }
          }
          return pt;
        });
        return changed ? { ...w, points: newPoints } : w;
      });

      return {
        schematic: {
          ...s.schematic,
          components: newComponents,
          wires: newWires,
          sheets: s.schematic.sheets.map(sh =>
            sh.id === s.schematic.activeSheetId
              ? { ...sh, components: newComponents, wires: newWires }
              : sh
          ),
        },
        isDirty: true,
      };
    });
  },

  // ── Sheet management (hierarchical schematics) ──────────────────────

  addSheet: (name: string) => {
    const newId = uid('sheet');
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        sheets: [...s.schematic.sheets, { id: newId, name, components: [], wires: [], labels: [] }],
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeSheet: (id: string) => {
    const state = get();
    const sheets = state.schematic.sheets;
    if (sheets.length <= 1) return; // Can't remove last sheet
    pushUndo(state);
    const newSheets = sheets.filter(s => s.id !== id);
    const wasActive = state.schematic.activeSheetId === id;
    const newActiveId = wasActive ? newSheets[0].id : state.schematic.activeSheetId;
    const activeSheet = newSheets.find(s => s.id === newActiveId)!;
    set({
      schematic: {
        ...state.schematic,
        sheets: newSheets,
        activeSheetId: newActiveId,
        components: activeSheet.components,
        wires: activeSheet.wires,
        labels: activeSheet.labels,
      },
      isDirty: true, canUndo: true, canRedo: false,
    });
  },

  renameSheet: (id: string, name: string) => {
    pushUndo(get());
    set((s) => ({
      schematic: {
        ...s.schematic,
        sheets: s.schematic.sheets.map(sh =>
          sh.id === id ? { ...sh, name } : sh
        ),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  switchSheet: (id: string) => {
    const state = get();
    if (id === state.schematic.activeSheetId) return;
    const targetSheet = state.schematic.sheets.find(s => s.id === id);
    if (!targetSheet) return;

    // Save current active sheet's data back into sheets array
    const updatedSheets = state.schematic.sheets.map(sh =>
      sh.id === state.schematic.activeSheetId
        ? { ...sh, components: state.schematic.components, wires: state.schematic.wires, labels: state.schematic.labels }
        : sh
    );

    set({
      schematic: {
        ...state.schematic,
        sheets: updatedSheets,
        activeSheetId: id,
        components: targetSheet.components,
        wires: targetSheet.wires,
        labels: targetSheet.labels,
      },
    });
  },

  duplicateSheet: (id: string) => {
    const state = get();
    // If duplicating the active sheet, sync its current data first
    const sheets = state.schematic.sheets.map(sh =>
      sh.id === state.schematic.activeSheetId
        ? { ...sh, components: state.schematic.components, wires: state.schematic.wires, labels: state.schematic.labels }
        : sh
    );
    const source = sheets.find(s => s.id === id);
    if (!source) return;
    pushUndo(state);
    const newId = uid('sheet');
    const duplicated: SchSheet = {
      id: newId,
      name: `${source.name} (copy)`,
      components: clone(source.components).map((c: SchComponent) => ({ ...c, id: uid('sc') })),
      wires: clone(source.wires).map((w: SchWire) => ({ ...w, id: uid('sw') })),
      labels: clone(source.labels).map((l: SchLabel) => ({ ...l, id: uid('sl') })),
    };
    set({
      schematic: {
        ...state.schematic,
        sheets: [...sheets, duplicated],
      },
      isDirty: true, canUndo: true, canRedo: false,
    });
  },

  reorderSheets: (orderedIds: string[]) => {
    const state = get();
    const sheetMap = new Map(state.schematic.sheets.map(s => [s.id, s]));
    const reordered = orderedIds.map(id => sheetMap.get(id)).filter(Boolean) as SchSheet[];
    if (reordered.length !== state.schematic.sheets.length) return;
    set({
      schematic: { ...state.schematic, sheets: reordered },
      isDirty: true,
    });
  },

  // ── Board ─────────────────────────────────────────────────────────────
  board: emptyBoard(),
  updateBoard: (patch) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, ...patch },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addBrdComponent: (c) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, components: [...s.board.components, c] },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  updateBrdComponent: (id, patch) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        components: s.board.components.map(c => c.id === id ? { ...c, ...patch } : c),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeBrdComponents: (ids) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        components: s.board.components.filter(c => !ids.includes(c.id)),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  moveBrdComponent: (id, x, y) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        components: s.board.components.map(c => c.id === id ? { ...c, x, y } : c),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addBrdTrace: (t) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, traces: [...s.board.traces, t] },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeBrdTraces: (ids) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        traces: s.board.traces.filter(t => !ids.includes(t.id)),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addBrdVia: (v) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, vias: [...s.board.vias, v] },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeBrdVias: (ids) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        vias: s.board.vias.filter(v => !ids.includes(v.id)),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  addBrdZone: (z) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, zones: [...s.board.zones, z] },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  removeBrdZones: (ids) => {
    pushUndo(get());
    set((s) => ({
      board: {
        ...s.board,
        zones: s.board.zones.filter(z => !ids.includes(z.id)),
      },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  setBoardOutline: (o) => {
    pushUndo(get());
    set((s) => ({
      board: { ...s.board, outline: o },
      isDirty: true, canUndo: true, canRedo: false,
    }));
  },

  // ── Nets ──────────────────────────────────────────────────────────────
  nets: [],

  // ── Design Rules ──────────────────────────────────────────────────────
  designRules: createDefaultDesignRules(),
  setDesignRules: (rules) => set({ designRules: rules, isDirty: true }),

  // ── Netlist extraction ────────────────────────────────────────────────
  extractNetlist: () => {
    const state = get();
    // Sync active sheet data into sheets before extracting
    const syncedSchematic = syncActiveSheetToSheets(state.schematic);
    const nets = extractNetlistFromSchematic(syncedSchematic);

    // Write netId back onto active sheet's components and wires
    const updatedComponents = syncedSchematic.components.map(comp => ({
      ...comp,
      pins: comp.pins.map(pin => {
        const net = nets.find(n => n.pins.includes(pin.id));
        return { ...pin, netId: net ? net.id : undefined };
      }),
    }));

    const updatedWires = syncedSchematic.wires.map(wire => {
      const net = nets.find(n => n.wires.includes(wire.id));
      return { ...wire, netId: net ? net.id : undefined };
    });

    // Also write netIds into all sheets
    const updatedSheets = syncedSchematic.sheets.map(sh => ({
      ...sh,
      components: sh.components.map(comp => ({
        ...comp,
        pins: comp.pins.map(pin => {
          const net = nets.find(n => n.pins.includes(pin.id));
          return { ...pin, netId: net ? net.id : undefined };
        }),
      })),
      wires: sh.wires.map(wire => {
        const net = nets.find(n => n.wires.includes(wire.id));
        return { ...wire, netId: net ? net.id : undefined };
      }),
    }));

    const updatedSchematic = {
      ...syncedSchematic,
      components: updatedComponents,
      wires: updatedWires,
      sheets: updatedSheets,
      nets,
    };

    set({ nets, schematic: updatedSchematic });
    return nets;
  },

  // ── Forward annotation ────────────────────────────────────────────────
  syncSchematicToBoard: () => {
    const state = get();
    // Sync active sheet data into sheets before extracting
    const syncedSchematic = syncActiveSheetToSheets(state.schematic);
    const nets = extractNetlistFromSchematic(syncedSchematic);

    // Write netId back onto active sheet's components and wires
    const updatedComponents = syncedSchematic.components.map(comp => ({
      ...comp,
      pins: comp.pins.map(pin => {
        const net = nets.find(n => n.pins.includes(pin.id));
        return { ...pin, netId: net ? net.id : undefined };
      }),
    }));
    const updatedWires = syncedSchematic.wires.map(wire => {
      const net = nets.find(n => n.wires.includes(wire.id));
      return { ...wire, netId: net ? net.id : undefined };
    });

    // Also write netIds into all sheets
    const updatedSheets = syncedSchematic.sheets.map(sh => ({
      ...sh,
      components: sh.components.map(comp => ({
        ...comp,
        pins: comp.pins.map(pin => {
          const net = nets.find(n => n.pins.includes(pin.id));
          return { ...pin, netId: net ? net.id : undefined };
        }),
      })),
      wires: sh.wires.map(wire => {
        const net = nets.find(n => n.wires.includes(wire.id));
        return { ...wire, netId: net ? net.id : undefined };
      }),
    }));

    const updatedSchematic = {
      ...syncedSchematic,
      components: updatedComponents,
      wires: updatedWires,
      sheets: updatedSheets,
      nets,
    };

    // Then forward-annotate to build/update the board
    const newBoard = forwardAnnotate(updatedSchematic, state.board, nets);
    pushUndo(state);
    set({
      nets,
      schematic: updatedSchematic,
      board: newBoard,
      isDirty: true,
      canUndo: true,
      canRedo: false,
    });
  },

  // ── Undo / Redo ───────────────────────────────────────────────────────
  canUndo: false,
  canRedo: false,

  undo: () => {
    if (undoStack.length === 0) return;
    const state = get();
    redoStack.push(makeSnapshot(state));
    const prev = undoStack.pop()!;
    set({
      schematic: prev.schematic,
      board: prev.board,
      nets: prev.nets,
      canUndo: undoStack.length > 0,
      canRedo: true,
      isDirty: true,
    });
  },

  redo: () => {
    if (redoStack.length === 0) return;
    const state = get();
    undoStack.push(makeSnapshot(state));
    const next = redoStack.pop()!;
    set({
      schematic: next.schematic,
      board: next.board,
      nets: next.nets,
      canUndo: true,
      canRedo: redoStack.length > 0,
      isDirty: true,
    });
  },

  // ── Dirty tracking ────────────────────────────────────────────────────
  isDirty: false,
  markClean: () => set({ isDirty: false }),

  // ── Persistence ───────────────────────────────────────────────────────

  saveProject: (): ProjectData => {
    const s = get();
    // Sync active sheet before saving
    const syncedSchematic = syncActiveSheetToSheets(s.schematic);
    return {
      metadata: { ...s.metadata, modifiedAt: new Date().toISOString() },
      schematic: clone(syncedSchematic),
      board: clone(s.board),
      nets: clone(s.nets),
      designRules: clone(s.designRules),
    };
  },

  loadProject: (data: ProjectData) => {
    undoStack = [];
    redoStack = [];
    // Backward compatibility: if loaded data has no sheets, create default sheet from top-level data
    const sch = data.schematic;
    if (!sch.sheets || sch.sheets.length === 0) {
      const defaultId = uid('sheet');
      sch.sheets = [{
        id: defaultId,
        name: 'Sheet 1',
        components: sch.components || [],
        wires: sch.wires || [],
        labels: sch.labels || [],
      }];
      sch.activeSheetId = defaultId;
    }
    if (!sch.activeSheetId && sch.sheets.length > 0) {
      sch.activeSheetId = sch.sheets[0].id;
    }
    // Backward compat: ensure busWires and noConnects exist
    if (!sch.busWires) sch.busWires = [];
    if (!sch.noConnects) sch.noConnects = [];
    // Set top-level fields to match active sheet
    const activeSheet = sch.sheets.find(s => s.id === sch.activeSheetId) || sch.sheets[0];
    sch.components = activeSheet.components;
    sch.wires = activeSheet.wires;
    sch.labels = activeSheet.labels;
    set({
      metadata: data.metadata,
      schematic: sch,
      board: data.board,
      nets: data.nets || [],
      designRules: data.designRules || createDefaultDesignRules(),
      isDirty: false,
      canUndo: false,
      canRedo: false,
    });
  },

  // ── Legacy sync methods (kept for backward compat) ────────────────
  saveToLocalStorage: () => {
    // Delegate to async version, fire-and-forget
    get().saveToStorage().catch((e) => {
      console.warn('Failed to autosave:', e);
    });
  },

  loadFromLocalStorage: (): boolean => {
    // Legacy sync path: try localStorage first for immediate load
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as ProjectData;
      if (!data.metadata || !data.schematic || !data.board) return false;
      get().loadProject(data);
      return true;
    } catch (e) {
      console.warn('Failed to load from localStorage:', e);
      return false;
    }
  },

  // ── Async IndexedDB storage methods ──────────────────────────────────

  initStorage: async () => {
    try {
      const storage = getStorage();
      await storage.init();
      // Migrate legacy localStorage data if present
      await migrateFromLocalStorage();
    } catch (e) {
      console.warn('Failed to initialize storage:', e);
    }
  },

  saveToStorage: async () => {
    try {
      const state = get();
      const data = state.saveProject();
      const storage = getStorage();
      await storage.saveProject('autosave', data);
      // Track in recent projects (still uses localStorage for WelcomeScreen)
      addToRecentProjects(
        state.metadata.name,
        Date.now(),
        state.schematic.components.length,
        state.nets.length,
      );
    } catch (e) {
      console.warn('Failed to autosave to IndexedDB:', e);
    }
  },

  loadFromStorage: async (): Promise<boolean> => {
    try {
      const storage = getStorage();
      const data = await storage.loadProject('autosave');
      if (!data) return false;
      if (!data.metadata || !data.schematic || !data.board) return false;
      get().loadProject(data);
      return true;
    } catch (e) {
      console.warn('Failed to load from IndexedDB:', e);
      return false;
    }
  },

  listSavedProjects: async (): Promise<ProjectMeta[]> => {
    try {
      const storage = getStorage();
      return await storage.listProjects();
    } catch (e) {
      console.warn('Failed to list projects:', e);
      return [];
    }
  },

  saveProjectAs: async (name: string): Promise<string> => {
    const state = get();
    // Update metadata with the new name
    const data = state.saveProject();
    data.metadata.name = name;
    data.metadata.modifiedAt = new Date().toISOString();

    // Generate a unique id from the name + timestamp
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;

    const storage = getStorage();
    await storage.saveProject(id, data);

    // Track in recent projects
    addToRecentProjects(
      name,
      Date.now(),
      state.schematic.components.length,
      state.nets.length,
    );

    // Update current project name
    set((s) => ({
      metadata: { ...s.metadata, name, modifiedAt: new Date().toISOString() },
      isDirty: false,
    }));

    return id;
  },

  deleteSavedProject: async (id: string): Promise<void> => {
    try {
      const storage = getStorage();
      await storage.deleteProject(id);
    } catch (e) {
      console.warn('Failed to delete project:', e);
    }
  },

  downloadProject: () => {
    const s = get();
    const data = s.saveProject();
    downloadRouteAIFile(data);
    set({ isDirty: false });
    // Track in recent projects
    addToRecentProjects(
      s.metadata.name,
      Date.now(),
      s.schematic.components.length,
      s.nets.length,
    );
  },

  uploadProject: async (file: File) => {
    const routeaiFile = await readRouteAIFile(file);
    const data = deserializeProject(routeaiFile);
    get().loadProject(data);
    // Track in recent projects
    addToRecentProjects(
      data.metadata.name,
      Date.now(),
      data.schematic.components.length,
      (data.nets || []).length,
    );
  },

  newProject: (name?: string) => {
    undoStack = [];
    redoStack = [];
    set({
      metadata: defaultMetadata(name),
      schematic: emptySchematic(),
      board: emptyBoard(),
      nets: [],
      designRules: createDefaultDesignRules(),
      isDirty: false,
      canUndo: false,
      canRedo: false,
    });
  },
}));

export default useProjectStore;
