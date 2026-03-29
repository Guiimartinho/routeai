// ─── BoardCanvasGL.tsx ── High-performance Canvas 2D PCB renderer ─────────────
// Drop-in replacement for BoardCanvas with:
// - Offscreen canvas per render-layer for selective redraw
// - Grid-based spatial index for O(1) hit testing
// - Cursor-centered zoom (wheel), pan (middle-drag / space+drag)
// - Adaptive grid spacing based on zoom level
// - Rubber-band selection rect
// - requestAnimationFrame with dirty-flag (60 fps target, 1000 components)
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  useRef, useEffect, useCallback, useState,
  forwardRef, useImperativeHandle,
} from 'react';
import { theme } from '../styles/theme';
import type {
  Point, BrdComponent, BrdTrace, BrdVia, BrdZone, BrdPad,
  BoardState,
} from '../types';

// Re-export shared types identical to BoardCanvas so consumers can swap freely
export interface LayerConfig {
  id: string;
  color: string;
  visible: boolean;
  opacity: number;
}

export interface DRCMarker {
  x: number;
  y: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface RatsnestLine {
  from: Point;
  to: Point;
  netId: string;
}

export interface MeasureState {
  start: Point | null;
  end: Point | null;
  active: boolean;
}

export interface SelectionRect {
  start: Point;
  end: Point;
}

export interface BoardCanvasProps {
  board: BoardState;
  layers: LayerConfig[];
  activeLayer: string;
  highlightedNet: string | null;
  drcMarkers: DRCMarker[];
  ratsnest: RatsnestLine[];
  gridSpacing: number;
  gridStyle: 'dots' | 'lines';
  showGrid: boolean;
  showRatsnest: boolean;
  showCrosshair: boolean;
  selectionRect: SelectionRect | null;
  measure: MeasureState;
  routingPreview: Point[] | null;
  routingWidth: number;
  zonePreview: Point[] | null;
  keepoutPreview?: Point[] | null;
  diffPairPreview?: { p: Point[]; n: Point[] } | null;
  lengthTuneTraceId?: string | null;
  lengthTuneTarget?: number;
  onMouseDown: (worldPos: Point, e: React.MouseEvent) => void;
  onMouseMove: (worldPos: Point, e: React.MouseEvent) => void;
  onMouseUp: (worldPos: Point, e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export interface BoardCanvasHandle {
  screenToWorld: (sx: number, sy: number) => Point;
  worldToScreen: (wx: number, wy: number) => Point;
  zoomToFit: () => void;
  getViewState: () => { panX: number; panY: number; zoom: number };
  setPan: (x: number, y: number) => void;
  setZoom: (z: number) => void;
}

// ─── Hit-test result ─────────────────────────────────────────────────────────

export interface HitResult {
  type: 'component' | 'pad' | 'trace' | 'via' | 'zone';
  id: string;
  componentId?: string;
  padNumber?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function brighten(hex: string, factor: number): string {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.floor(r + (255 - r) * factor));
  g = Math.min(255, Math.floor(g + (255 - g) * factor));
  b = Math.min(255, Math.floor(b + (255 - b) * factor));
  return `rgb(${r},${g},${b})`;
}

function rotatedPadWorldPos(comp: BrdComponent, pad: BrdPad): Point {
  const rad = (comp.rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rx = pad.x * cosR - pad.y * sinR;
  const ry = pad.x * sinR + pad.y * cosR;
  return { x: comp.x + rx, y: comp.y + ry };
}

function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── Spatial Index ───────────────────────────────────────────────────────────

interface SpatialEntry {
  type: 'component' | 'pad' | 'trace' | 'via';
  id: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  data: BrdComponent | BrdPad | BrdTrace | BrdVia;
  parentComp?: BrdComponent;
  worldPos?: Point;
}

class SpatialIndex {
  private cellSize: number;
  private cells: Map<string, SpatialEntry[]>;

  constructor(cellSize: number = 10) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear(): void { this.cells.clear(); }

  insert(entry: SpatialEntry): void {
    const { minX, minY, maxX, maxY } = entry.bounds;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const y0 = Math.floor(minY / cs);
    const x1 = Math.floor(maxX / cs);
    const y1 = Math.floor(maxY / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        let cell = this.cells.get(key);
        if (!cell) { cell = []; this.cells.set(key, cell); }
        cell.push(entry);
      }
    }
  }

  queryPoint(x: number, y: number): SpatialEntry[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cell = this.cells.get(`${cx},${cy}`);
    if (!cell) return [];
    return cell.filter(e =>
      x >= e.bounds.minX && x <= e.bounds.maxX &&
      y >= e.bounds.minY && y <= e.bounds.maxY
    );
  }

  queryRect(minX: number, minY: number, maxX: number, maxY: number): SpatialEntry[] {
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const y0 = Math.floor(minY / cs);
    const x1 = Math.floor(maxX / cs);
    const y1 = Math.floor(maxY / cs);
    const seen = new Set<string>();
    const results: SpatialEntry[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(`${cx},${cy}`);
        if (!cell) continue;
        for (const e of cell) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.bounds.maxX >= minX && e.bounds.minX <= maxX &&
              e.bounds.maxY >= minY && e.bounds.minY <= maxY) {
            results.push(e);
          }
        }
      }
    }
    return results;
  }
}

// ─── Offscreen layer management ──────────────────────────────────────────────

type RenderLayerName =
  | 'grid'
  | 'outline'
  | 'zones'
  | 'traces'
  | 'pads'
  | 'vias'
  | 'silkscreen'
  | 'ratsnest'
  | 'overlay';

interface OffscreenLayer {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function createOffscreen(w: number, h: number): OffscreenLayer {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext('2d')!;
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext('2d')!;
  }
  return { canvas, ctx };
}

const ALL_LAYERS: RenderLayerName[] = [
  'grid', 'outline', 'zones', 'traces', 'pads', 'vias',
  'silkscreen', 'ratsnest', 'overlay',
];

// ─── Component ───────────────────────────────────────────────────────────────

const BoardCanvasGL = forwardRef<BoardCanvasHandle, BoardCanvasProps>((props, ref) => {
  const {
    board, layers, activeLayer, highlightedNet, drcMarkers, ratsnest,
    gridSpacing, gridStyle, showGrid, showRatsnest, showCrosshair,
    selectionRect, measure, routingPreview, routingWidth, zonePreview,
    keepoutPreview, diffPairPreview, lengthTuneTraceId, lengthTuneTarget,
    onMouseDown, onMouseMove, onMouseUp, onWheel,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // View transform
  const panRef = useRef({ x: 300, y: 300 });
  const zoomRef = useRef(4);
  const mouseWorldRef = useRef<Point>({ x: 0, y: 0 });
  const [coordsDisplay, setCoordsDisplay] = useState({ x: 0, y: 0 });

  // Canvas dimensions (logical px)
  const dimRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Panning state
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartMouseRef = useRef({ x: 0, y: 0 });
  const spaceDownRef = useRef(false);

  // ─── Dirty tracking ─────────────────────────────────────────────────

  const dirtyMap = useRef<Record<RenderLayerName, boolean>>({
    grid: true, outline: true, zones: true, traces: true,
    pads: true, vias: true, silkscreen: true, ratsnest: true, overlay: true,
  });
  const needsComposite = useRef(true);

  const markAllDirty = useCallback(() => {
    const m = dirtyMap.current;
    for (const k of ALL_LAYERS) m[k] = true;
    needsComposite.current = true;
  }, []);

  // Board-data prop changes dirty all board layers
  useEffect(() => { markAllDirty(); }, [
    board, layers, activeLayer, highlightedNet, gridSpacing, gridStyle, showGrid,
    markAllDirty,
  ]);

  // Ratsnest layer only
  useEffect(() => {
    dirtyMap.current.ratsnest = true;
    needsComposite.current = true;
  }, [ratsnest, showRatsnest]);

  // Overlay layer only (previews, selection, measure, crosshair, DRC)
  useEffect(() => {
    dirtyMap.current.overlay = true;
    needsComposite.current = true;
  }, [
    drcMarkers, selectionRect, measure, routingPreview, routingWidth,
    zonePreview, keepoutPreview, diffPairPreview, lengthTuneTraceId,
    lengthTuneTarget, showCrosshair,
  ]);

  // ─── Offscreen canvases ──────────────────────────────────────────────

  const offscreenRef = useRef<Record<RenderLayerName, OffscreenLayer> | null>(null);

  const ensureOffscreen = useCallback((w: number, h: number) => {
    const dpr = dimRef.current.dpr;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (offscreenRef.current) {
      const first = offscreenRef.current.grid;
      if (first.canvas.width === pw && first.canvas.height === ph) return;
    }
    const map: Record<string, OffscreenLayer> = {};
    for (const name of ALL_LAYERS) {
      map[name] = createOffscreen(pw, ph);
    }
    offscreenRef.current = map as Record<RenderLayerName, OffscreenLayer>;
    markAllDirty();
  }, [markAllDirty]);

  // ─── Spatial index (rebuilt when board data changes) ─────────────────

  const spatialRef = useRef(new SpatialIndex(10));

  const rebuildSpatialIndex = useCallback(() => {
    const si = new SpatialIndex(10);
    for (const comp of board.components) {
      for (const pad of comp.pads) {
        const wp = rotatedPadWorldPos(comp, pad);
        const hw = pad.width / 2;
        const hh = pad.height / 2;
        si.insert({
          type: 'pad', id: `pad:${comp.id}:${pad.id}`,
          bounds: { minX: wp.x - hw, minY: wp.y - hh, maxX: wp.x + hw, maxY: wp.y + hh },
          data: pad, parentComp: comp, worldPos: wp,
        });
      }
      if (comp.pads.length > 0) {
        let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
        for (const pad of comp.pads) {
          const wp = rotatedPadWorldPos(comp, pad);
          cMinX = Math.min(cMinX, wp.x - pad.width / 2 - 0.5);
          cMinY = Math.min(cMinY, wp.y - pad.height / 2 - 0.5);
          cMaxX = Math.max(cMaxX, wp.x + pad.width / 2 + 0.5);
          cMaxY = Math.max(cMaxY, wp.y + pad.height / 2 + 0.5);
        }
        si.insert({
          type: 'component', id: `comp:${comp.id}`,
          bounds: { minX: cMinX, minY: cMinY, maxX: cMaxX, maxY: cMaxY },
          data: comp,
        });
      }
    }
    for (const trace of board.traces) {
      if (trace.points.length < 2) continue;
      let tMinX = Infinity, tMinY = Infinity, tMaxX = -Infinity, tMaxY = -Infinity;
      for (const pt of trace.points) {
        const hw = trace.width / 2;
        tMinX = Math.min(tMinX, pt.x - hw);
        tMinY = Math.min(tMinY, pt.y - hw);
        tMaxX = Math.max(tMaxX, pt.x + hw);
        tMaxY = Math.max(tMaxY, pt.y + hw);
      }
      si.insert({
        type: 'trace', id: `trace:${trace.id}`,
        bounds: { minX: tMinX, minY: tMinY, maxX: tMaxX, maxY: tMaxY },
        data: trace,
      });
    }
    for (const via of board.vias) {
      const r = via.size / 2;
      si.insert({
        type: 'via', id: `via:${via.id}`,
        bounds: { minX: via.x - r, minY: via.y - r, maxX: via.x + r, maxY: via.y + r },
        data: via,
      });
    }
    spatialRef.current = si;
  }, [board.components, board.traces, board.vias]);

  useEffect(() => { rebuildSpatialIndex(); }, [rebuildSpatialIndex]);

  // ─── Hit testing (uses spatial index for fast lookup) ────────────────

  const hitTestWorld = useCallback((worldX: number, worldY: number): HitResult | null => {
    const candidates = spatialRef.current.queryPoint(worldX, worldY);

    // Check vias first (smallest targets)
    for (const c of candidates) {
      if (c.type === 'via') {
        const via = c.data as BrdVia;
        const dx = worldX - via.x;
        const dy = worldY - via.y;
        if (dx * dx + dy * dy <= (via.size / 2) * (via.size / 2)) {
          return { type: 'via', id: via.id };
        }
      }
    }
    // Pads
    for (const c of candidates) {
      if (c.type === 'pad') {
        const pad = c.data as BrdPad;
        const wp = c.worldPos!;
        const hw = pad.width / 2;
        const hh = pad.height / 2;
        if (pad.shape === 'circle') {
          const dx = worldX - wp.x;
          const dy = worldY - wp.y;
          if (dx * dx + dy * dy <= hw * hw) {
            return { type: 'pad', id: pad.id, componentId: c.parentComp!.id, padNumber: pad.number };
          }
        } else {
          if (Math.abs(worldX - wp.x) <= hw && Math.abs(worldY - wp.y) <= hh) {
            return { type: 'pad', id: pad.id, componentId: c.parentComp!.id, padNumber: pad.number };
          }
        }
      }
    }
    // Traces (point-to-segment)
    for (const c of candidates) {
      if (c.type === 'trace') {
        const trace = c.data as BrdTrace;
        const hitDist = Math.max(trace.width / 2, 0.5);
        for (let j = 0; j < trace.points.length - 1; j++) {
          const a = trace.points[j];
          const b = trace.points[j + 1];
          if (pointToSegmentDist(worldX, worldY, a.x, a.y, b.x, b.y) <= hitDist) {
            return { type: 'trace', id: trace.id };
          }
        }
      }
    }
    // Components
    for (const c of candidates) {
      if (c.type === 'component') {
        return { type: 'component', id: (c.data as BrdComponent).id };
      }
    }
    // Zones (point-in-polygon, not spatial-indexed -- usually few)
    for (let i = board.zones.length - 1; i >= 0; i--) {
      const zone = board.zones[i];
      if (pointInPolygon(worldX, worldY, zone.points)) {
        return { type: 'zone', id: zone.id };
      }
    }
    return null;
  }, [board.zones]);

  // ─── Coordinate transforms ──────────────────────────────────────────

  const screenToWorld = useCallback((sx: number, sy: number): Point => {
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: (sx - p.x) / z, y: (sy - p.y) / z };
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number): Point => {
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: wx * z + p.x, y: wy * z + p.y };
  }, []);

  // ─── Imperative handle ──────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    screenToWorld,
    worldToScreen,
    zoomToFit: () => {
      const { w, h } = dimRef.current;
      if (w === 0 || h === 0) return;
      const allPts: Point[] = [];
      board.components.forEach(c => {
        allPts.push({ x: c.x, y: c.y });
        c.pads.forEach(p => allPts.push(rotatedPadWorldPos(c, p)));
      });
      board.traces.forEach(t => t.points.forEach(p => allPts.push(p)));
      board.vias.forEach(v => allPts.push({ x: v.x, y: v.y }));
      board.outline.points.forEach(p => allPts.push(p));
      if (allPts.length === 0) return;
      const minX = Math.min(...allPts.map(p => p.x)) - 5;
      const maxX = Math.max(...allPts.map(p => p.x)) + 5;
      const minY = Math.min(...allPts.map(p => p.y)) - 5;
      const maxY = Math.max(...allPts.map(p => p.y)) + 5;
      const bw = maxX - minX;
      const bh = maxY - minY;
      const z = Math.min(w / bw, h / bh) * 0.9;
      zoomRef.current = z;
      panRef.current = {
        x: w / 2 - ((minX + maxX) / 2) * z,
        y: h / 2 - ((minY + maxY) / 2) * z,
      };
      markAllDirty();
    },
    getViewState: () => ({ panX: panRef.current.x, panY: panRef.current.y, zoom: zoomRef.current }),
    setPan: (x: number, y: number) => { panRef.current = { x, y }; markAllDirty(); },
    setZoom: (z: number) => { zoomRef.current = z; markAllDirty(); },
  }));

  // ─── Layer helpers ──────────────────────────────────────────────────

  const getLayerConfig = useCallback((layerId: string): LayerConfig | undefined => {
    return layers.find(l => l.id === layerId);
  }, [layers]);

  const isLayerVisible = useCallback((layerId: string): boolean => {
    const lc = getLayerConfig(layerId);
    return lc ? lc.visible : false;
  }, [getLayerConfig]);

  const getLayerColor = useCallback((layerId: string, alpha?: number): string => {
    const lc = getLayerConfig(layerId);
    if (!lc) return 'rgba(128,128,128,0.5)';
    const a = alpha !== undefined ? alpha : lc.opacity;
    return hexToRgba(lc.color, a);
  }, [getLayerConfig]);

  // ─── Typed context alias ────────────────────────────────────────────
  type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  // ─── Draw: Grid (adaptive spacing) ──────────────────────────────────

  const drawGrid = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    if (!showGrid) return;

    const z = zoomRef.current;
    const p = panRef.current;
    const wStart = screenToWorld(0, 0);
    const wEnd = screenToWorld(w, h);

    // Adaptive: double the step until screen-space gap >= 8 px
    let step = gridSpacing;
    while (step * z < 8) step *= 2;

    const startX = Math.floor(wStart.x / step) * step;
    const endX = Math.ceil(wEnd.x / step) * step;
    const startY = Math.floor(wStart.y / step) * step;
    const endY = Math.ceil(wEnd.y / step) * step;

    // Safety cap
    const cols = (endX - startX) / step;
    const rows = (endY - startY) / step;
    if (cols * rows > 16_000_000) return;

    if (gridStyle === 'dots') {
      const dotSize = Math.max(1, z * 0.06);
      ctx.fillStyle = theme.gridDotColor;
      for (let x = startX; x <= endX; x += step) {
        for (let y = startY; y <= endY; y += step) {
          ctx.fillRect(x * z + p.x - dotSize / 2, y * z + p.y - dotSize / 2, dotSize, dotSize);
        }
      }
    } else {
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += step) {
        const sx = x * z + p.x;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      for (let y = startY; y <= endY; y += step) {
        const sy = y * z + p.y;
        ctx.moveTo(0, sy); ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }
  }, [showGrid, gridSpacing, gridStyle, screenToWorld]);

  // ─── Draw: Board outline ────────────────────────────────────────────

  const drawBoardOutline = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const pts = board.outline.points;
    if (pts.length < 2) return;
    if (!isLayerVisible('Edge.Cuts')) return;
    const z = zoomRef.current;
    const p = panRef.current;
    ctx.strokeStyle = theme.layers['Edge.Cuts'] || '#e0e040';
    ctx.lineWidth = Math.max(2, z * 0.15);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x * z + p.x, pts[0].y * z + p.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * z + p.x, pts[i].y * z + p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }, [board.outline, isLayerVisible]);

  // ─── Draw: Zones (copper + keepout with hatching) ───────────────────

  const drawZones = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const z = zoomRef.current;
    const p = panRef.current;

    for (const zone of board.zones) {
      if (!isLayerVisible(zone.layer)) continue;
      if (zone.points.length < 3) continue;

      const isKeepout = zone.isKeepout === true;
      const isHL = highlightedNet !== null && zone.netId === highlightedNet;

      if (isKeepout) {
        ctx.fillStyle = 'rgba(240, 80, 96, 0.12)';
        ctx.strokeStyle = 'rgba(240, 80, 96, 0.8)';
        ctx.lineWidth = Math.max(1.5, z * 0.08);
        ctx.setLineDash([z * 0.3, z * 0.15]);
      } else {
        ctx.fillStyle = getLayerColor(zone.layer, isHL ? 0.6 : 0.25);
        ctx.strokeStyle = getLayerColor(zone.layer, 0.7);
        ctx.lineWidth = Math.max(1, z * 0.05);
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(zone.points[0].x * z + p.x, zone.points[0].y * z + p.y);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x * z + p.x, zone.points[i].y * z + p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Hatching
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zone.points[0].x * z + p.x, zone.points[0].y * z + p.y);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x * z + p.x, zone.points[i].y * z + p.y);
      }
      ctx.closePath();
      ctx.clip();

      const minX = Math.min(...zone.points.map(pt => pt.x));
      const maxX = Math.max(...zone.points.map(pt => pt.x));
      const minY = Math.min(...zone.points.map(pt => pt.y));
      const maxY = Math.max(...zone.points.map(pt => pt.y));

      if (isKeepout) {
        // Cross-hatch
        ctx.strokeStyle = 'rgba(240, 80, 96, 0.3)';
        ctx.lineWidth = 1;
        const hatchStep = 1.5;
        ctx.beginPath();
        for (let hx = minX; hx <= maxX + (maxY - minY); hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx - (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        for (let hx = minX - (maxY - minY); hx <= maxX; hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx + (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        ctx.stroke();

        const centerX = ((minX + maxX) / 2) * z + p.x;
        const centerY = ((minY + maxY) / 2) * z + p.y;
        const label = zone.keepoutType ? zone.keepoutType.replace('_', ' ').toUpperCase() : 'KEEPOUT';
        ctx.fillStyle = 'rgba(240, 80, 96, 0.7)';
        ctx.font = `bold ${Math.max(8, z * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, centerX, centerY);
      } else if (!isHL) {
        ctx.strokeStyle = getLayerColor(zone.layer, 0.15);
        ctx.lineWidth = 1;
        const hatchStep = 2;
        ctx.beginPath();
        for (let hx = minX; hx <= maxX + (maxY - minY); hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx - (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [board.zones, isLayerVisible, getLayerColor, highlightedNet]);

  // ─── Draw: Traces (batched by layer) ────────────────────────────────

  const drawTraces = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const z = zoomRef.current;
    const pn = panRef.current;

    const byLayer = new Map<string, BrdTrace[]>();
    for (const trace of board.traces) {
      if (!isLayerVisible(trace.layer)) continue;
      if (trace.points.length < 2) continue;
      let arr = byLayer.get(trace.layer);
      if (!arr) { arr = []; byLayer.set(trace.layer, arr); }
      arr.push(trace);
    }

    for (const [layer, traces] of byLayer) {
      const lc = getLayerConfig(layer);
      const baseColor = getLayerColor(layer, 0.85);
      const hlColor = lc ? brighten(lc.color, 0.5) : '#fff';

      for (const trace of traces) {
        const isHL = highlightedNet !== null && trace.netId === highlightedNet;
        ctx.strokeStyle = isHL ? hlColor : baseColor;
        ctx.lineWidth = trace.width * z;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (isHL) { ctx.shadowColor = lc?.color || '#fff'; ctx.shadowBlur = 8; }
        ctx.beginPath();
        ctx.moveTo(trace.points[0].x * z + pn.x, trace.points[0].y * z + pn.y);
        for (let i = 1; i < trace.points.length; i++) {
          ctx.lineTo(trace.points[i].x * z + pn.x, trace.points[i].y * z + pn.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }, [board.traces, isLayerVisible, getLayerColor, getLayerConfig, highlightedNet]);

  // ─── Draw: Pads ─────────────────────────────────────────────────────

  const drawSinglePad = useCallback((
    ctx: Ctx, pad: BrdPad, cx: number, cy: number, rotation: number, compLayer: string
  ) => {
    const z = zoomRef.current;
    const pn = panRef.current;
    if (!pad.layers.some(l => isLayerVisible(l))) return;

    const isHL = highlightedNet !== null && pad.netId === highlightedNet;
    const padLayer = pad.layers.includes(compLayer) ? compLayer : pad.layers[0];
    const color = isHL
      ? brighten(getLayerConfig(padLayer)?.color || '#fff', 0.5)
      : getLayerColor(padLayer, 0.9);

    const sx = cx * z + pn.x;
    const sy = cy * z + pn.y;
    const sw = pad.width * z;
    const sh = pad.height * z;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((rotation * Math.PI) / 180);

    if (isHL) { ctx.shadowColor = getLayerConfig(padLayer)?.color || '#fff'; ctx.shadowBlur = 10; }

    ctx.fillStyle = color;
    switch (pad.shape) {
      case 'circle':
        ctx.beginPath(); ctx.arc(0, 0, sw / 2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'rect':
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        break;
      case 'oval':
        ctx.beginPath(); ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'roundrect': {
        const radius = Math.min(sw, sh) * 0.25;
        ctx.beginPath();
        ctx.moveTo(-sw / 2 + radius, -sh / 2);
        ctx.lineTo(sw / 2 - radius, -sh / 2);
        ctx.arcTo(sw / 2, -sh / 2, sw / 2, -sh / 2 + radius, radius);
        ctx.lineTo(sw / 2, sh / 2 - radius);
        ctx.arcTo(sw / 2, sh / 2, sw / 2 - radius, sh / 2, radius);
        ctx.lineTo(-sw / 2 + radius, sh / 2);
        ctx.arcTo(-sw / 2, sh / 2, -sw / 2, sh / 2 - radius, radius);
        ctx.lineTo(-sw / 2, -sh / 2 + radius);
        ctx.arcTo(-sw / 2, -sh / 2, -sw / 2 + radius, -sh / 2, radius);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.shadowBlur = 0;

    if (pad.drill && pad.drill > 0) {
      ctx.fillStyle = theme.brdBackground;
      ctx.beginPath(); ctx.arc(0, 0, (pad.drill * z) / 2, 0, Math.PI * 2); ctx.fill();
    }

    if (z > 2.5) {
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(6, z * 0.6)}px ${theme.fontMono}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pad.number, 0, 0);
    }

    ctx.restore();
  }, [isLayerVisible, getLayerColor, getLayerConfig, highlightedNet]);

  const drawPads = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    for (const comp of board.components) {
      for (const pad of comp.pads) {
        const wp = rotatedPadWorldPos(comp, pad);
        drawSinglePad(ctx, pad, wp.x, wp.y, comp.rotation, comp.layer);
      }
    }
  }, [board.components, drawSinglePad]);

  // ─── Draw: Silkscreen + courtyard ───────────────────────────────────

  const drawSilkscreen = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const z = zoomRef.current;
    const pn = panRef.current;

    for (const comp of board.components) {
      const silkLayer = comp.layer === 'F.Cu' ? 'F.SilkS' : 'B.SilkS';
      if (!isLayerVisible(silkLayer)) continue;

      const sx = comp.x * z + pn.x;
      const sy = comp.y * z + pn.y;

      ctx.fillStyle = getLayerColor(silkLayer, 0.9);
      ctx.font = `${Math.max(8, z * 0.8)}px ${theme.fontMono}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate((comp.rotation * Math.PI) / 180);
      ctx.fillText(comp.ref, 0, -Math.max(3, z * 1.2));
      ctx.restore();

      if (z > 1.5) {
        const fabLayer = comp.layer === 'F.Cu' ? 'F.Fab' : 'B.Fab';
        if (!isLayerVisible(fabLayer)) continue;
        const maxW = Math.max(...comp.pads.map(p => Math.abs(p.x) + p.width / 2), 2);
        const maxH = Math.max(...comp.pads.map(p => Math.abs(p.y) + p.height / 2), 2);
        ctx.strokeStyle = getLayerColor(fabLayer, 0.4);
        ctx.lineWidth = Math.max(0.5, z * 0.03);
        ctx.setLineDash([z * 0.3, z * 0.3]);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((comp.rotation * Math.PI) / 180);
        ctx.strokeRect(
          -(maxW + 0.5) * z, -(maxH + 0.5) * z,
          (maxW + 0.5) * 2 * z, (maxH + 0.5) * 2 * z
        );
        ctx.restore();
        ctx.setLineDash([]);
      }
    }
  }, [board.components, isLayerVisible, getLayerColor]);

  // ─── Draw: Vias (type-differentiated rendering) ─────────────────────

  const drawVias = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const z = zoomRef.current;
    const pn = panRef.current;

    // Color map per via type
    const VIA_TYPE_COLORS: Record<string, string> = {
      through: '#d4a057',  // copper/gold
      blind:   '#4090f0',  // blue
      buried:  '#40c040',  // green
      micro:   '#f04040',  // red
    };

    for (const via of board.vias) {
      if (!via.layers.some(l => isLayerVisible(l))) continue;
      const isHL = highlightedNet !== null && via.netId === highlightedNet;
      const sx = via.x * z + pn.x;
      const sy = via.y * z + pn.y;
      const outerR = (via.size / 2) * z;
      const innerR = (via.drill / 2) * z;
      const vType = via.viaType || 'through';
      const typeColor = VIA_TYPE_COLORS[vType] || VIA_TYPE_COLORS.through;

      if (isHL) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 8; }

      switch (vType) {
        case 'through':
        default: {
          // Solid circle with gradient and drill hole (existing style)
          const gradient = ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
          const topColor = getLayerConfig(via.layers[0])?.color || '#f04040';
          const botColor = getLayerConfig(via.layers[via.layers.length - 1])?.color || '#4060f0';
          gradient.addColorStop(0, hexToRgba(topColor, isHL ? 1 : 0.8));
          gradient.addColorStop(1, hexToRgba(botColor, isHL ? 1 : 0.8));
          ctx.fillStyle = gradient;
          ctx.beginPath(); ctx.arc(sx, sy, outerR, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          // Drill hole
          ctx.fillStyle = theme.brdBackground;
          ctx.beginPath(); ctx.arc(sx, sy, innerR, 0, Math.PI * 2); ctx.fill();
          // Cross marker at high zoom
          if (z > 2) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(sx - innerR * 0.5, sy); ctx.lineTo(sx + innerR * 0.5, sy);
            ctx.moveTo(sx, sy - innerR * 0.5); ctx.lineTo(sx, sy + innerR * 0.5);
            ctx.stroke();
          }
          break;
        }

        case 'blind': {
          // Half-filled circle: top half if startLayer is F.Cu, bottom half if B.Cu
          const isFrontStart = via.startLayer === 'F.Cu';
          const fillAlpha = isHL ? 1 : 0.85;
          // Outer ring
          ctx.strokeStyle = hexToRgba(typeColor, fillAlpha);
          ctx.lineWidth = Math.max(1, z * 0.1);
          ctx.beginPath(); ctx.arc(sx, sy, outerR, 0, Math.PI * 2); ctx.stroke();
          // Half fill
          ctx.fillStyle = hexToRgba(typeColor, fillAlpha);
          ctx.beginPath();
          if (isFrontStart) {
            // Top half filled (starts from front)
            ctx.arc(sx, sy, outerR, Math.PI, 0);
            ctx.lineTo(sx + outerR, sy);
            ctx.arc(sx, sy, outerR, 0, Math.PI, true);
          } else {
            // Bottom half filled (starts from back)
            ctx.arc(sx, sy, outerR, 0, Math.PI);
            ctx.lineTo(sx - outerR, sy);
            ctx.arc(sx, sy, outerR, Math.PI, 0, true);
          }
          ctx.closePath(); ctx.fill();
          ctx.shadowBlur = 0;
          // Drill hole
          ctx.fillStyle = theme.brdBackground;
          ctx.beginPath(); ctx.arc(sx, sy, innerR, 0, Math.PI * 2); ctx.fill();
          // Type label at high zoom
          if (z > 3) {
            ctx.fillStyle = hexToRgba(typeColor, 0.8);
            ctx.font = `bold ${Math.max(6, z * 0.4)}px ${theme.fontMono}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('B', sx, sy);
          }
          break;
        }

        case 'buried': {
          // Dashed circle outline (no fill)
          const fillAlpha = isHL ? 1 : 0.85;
          ctx.strokeStyle = hexToRgba(typeColor, fillAlpha);
          ctx.lineWidth = Math.max(1.5, z * 0.12);
          ctx.setLineDash([z * 0.2, z * 0.15]);
          ctx.beginPath(); ctx.arc(sx, sy, outerR, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          // Inner ring
          ctx.strokeStyle = hexToRgba(typeColor, fillAlpha * 0.6);
          ctx.lineWidth = Math.max(1, z * 0.06);
          ctx.beginPath(); ctx.arc(sx, sy, innerR, 0, Math.PI * 2); ctx.stroke();
          // Center dot
          ctx.fillStyle = hexToRgba(typeColor, fillAlpha * 0.5);
          ctx.beginPath(); ctx.arc(sx, sy, innerR * 0.3, 0, Math.PI * 2); ctx.fill();
          // Type label at high zoom
          if (z > 3) {
            ctx.fillStyle = hexToRgba(typeColor, 0.8);
            ctx.font = `bold ${Math.max(6, z * 0.4)}px ${theme.fontMono}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Bu', sx, sy);
          }
          break;
        }

        case 'micro': {
          // Small filled dot
          const fillAlpha = isHL ? 1 : 0.9;
          ctx.fillStyle = hexToRgba(typeColor, fillAlpha);
          ctx.beginPath(); ctx.arc(sx, sy, outerR, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          // Tiny drill hole
          ctx.fillStyle = theme.brdBackground;
          ctx.beginPath(); ctx.arc(sx, sy, innerR * 0.7, 0, Math.PI * 2); ctx.fill();
          // Diamond marker at high zoom
          if (z > 3) {
            const d = outerR * 0.4;
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(sx, sy - d); ctx.lineTo(sx + d, sy);
            ctx.lineTo(sx, sy + d); ctx.lineTo(sx - d, sy);
            ctx.closePath(); ctx.stroke();
          }
          // Type label at high zoom
          if (z > 4) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = `bold ${Math.max(5, z * 0.3)}px ${theme.fontMono}`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('u', sx, sy);
          }
          break;
        }
      }
    }
  }, [board.vias, isLayerVisible, getLayerConfig, highlightedNet]);

  // ─── Draw: Ratsnest ─────────────────────────────────────────────────

  const drawRatsnest = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    if (!showRatsnest) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    ctx.setLineDash([4, 4]);
    for (const line of ratsnest) {
      const isHL = highlightedNet !== null && line.netId === highlightedNet;
      ctx.strokeStyle = isHL ? theme.highlightColor : theme.brdRatsnest;
      ctx.lineWidth = isHL ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(line.from.x * z + pn.x, line.from.y * z + pn.y);
      ctx.lineTo(line.to.x * z + pn.x, line.to.y * z + pn.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [showRatsnest, ratsnest, highlightedNet]);

  // ─── Draw: Overlay ──────────────────────────────────────────────────

  const drawOverlay = useCallback((ctx: Ctx) => {
    const { w, h, dpr } = dimRef.current;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    const z = zoomRef.current;
    const pn = panRef.current;

    // Routing preview
    if (routingPreview && routingPreview.length >= 1) {
      ctx.strokeStyle = getLayerColor(activeLayer, 0.6);
      ctx.lineWidth = routingWidth * z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.setLineDash([z * 0.5, z * 0.3]);
      ctx.beginPath();
      ctx.moveTo(routingPreview[0].x * z + pn.x, routingPreview[0].y * z + pn.y);
      for (let i = 1; i < routingPreview.length; i++) {
        ctx.lineTo(routingPreview[i].x * z + pn.x, routingPreview[i].y * z + pn.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Zone preview
    if (zonePreview && zonePreview.length >= 1) {
      ctx.fillStyle = getLayerColor(activeLayer, 0.3);
      ctx.strokeStyle = getLayerColor(activeLayer, 0.7);
      ctx.lineWidth = Math.max(1, z * 0.08);
      ctx.setLineDash([z * 0.4, z * 0.2]);
      ctx.beginPath();
      ctx.moveTo(zonePreview[0].x * z + pn.x, zonePreview[0].y * z + pn.y);
      for (let i = 1; i < zonePreview.length; i++) {
        ctx.lineTo(zonePreview[i].x * z + pn.x, zonePreview[i].y * z + pn.y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      for (const pt of zonePreview) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pt.x * z + pn.x, pt.y * z + pn.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Keepout preview
    if (keepoutPreview && keepoutPreview.length >= 1) {
      ctx.fillStyle = 'rgba(240, 80, 96, 0.15)';
      ctx.strokeStyle = 'rgba(240, 80, 96, 0.8)';
      ctx.lineWidth = Math.max(1.5, z * 0.08);
      ctx.setLineDash([z * 0.3, z * 0.15]);
      ctx.beginPath();
      ctx.moveTo(keepoutPreview[0].x * z + pn.x, keepoutPreview[0].y * z + pn.y);
      for (let i = 1; i < keepoutPreview.length; i++) {
        ctx.lineTo(keepoutPreview[i].x * z + pn.x, keepoutPreview[i].y * z + pn.y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      for (const pt of keepoutPreview) {
        ctx.fillStyle = '#f05060';
        ctx.beginPath(); ctx.arc(pt.x * z + pn.x, pt.y * z + pn.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Diff pair preview
    if (diffPairPreview) {
      const drawPath = (points: Point[], color: string) => {
        if (points.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, routingWidth * z);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.setLineDash([z * 0.4, z * 0.2]);
        ctx.beginPath();
        ctx.moveTo(points[0].x * z + pn.x, points[0].y * z + pn.y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x * z + pn.x, points[i].y * z + pn.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      drawPath(diffPairPreview.p, 'rgba(255, 140, 60, 0.7)');
      drawPath(diffPairPreview.n, 'rgba(60, 160, 255, 0.7)');

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([z * 0.1, z * 0.15]);
      const minLen = Math.min(diffPairPreview.p.length, diffPairPreview.n.length);
      for (let i = 0; i < minLen; i += Math.max(1, Math.floor(minLen / 8))) {
        const pp = diffPairPreview.p[i];
        const np = diffPairPreview.n[i];
        ctx.beginPath();
        ctx.moveTo(pp.x * z + pn.x, pp.y * z + pn.y);
        ctx.lineTo(np.x * z + pn.x, np.y * z + pn.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Length tune overlay
    if (lengthTuneTraceId) {
      const trace = board.traces.find(t => t.id === lengthTuneTraceId);
      if (trace && trace.points.length >= 2) {
        ctx.strokeStyle = 'rgba(0, 255, 180, 0.5)';
        ctx.lineWidth = (trace.width + 0.3) * z;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(trace.points[0].x * z + pn.x, trace.points[0].y * z + pn.y);
        for (let i = 1; i < trace.points.length; i++) {
          ctx.lineTo(trace.points[i].x * z + pn.x, trace.points[i].y * z + pn.y);
        }
        ctx.stroke();

        const midIdx = Math.floor(trace.points.length / 2);
        const mp = trace.points[midIdx];
        let totalLen = 0;
        for (let i = 0; i < trace.points.length - 1; i++) {
          totalLen += Math.hypot(
            trace.points[i + 1].x - trace.points[i].x,
            trace.points[i + 1].y - trace.points[i].y,
          );
        }
        const lsx = mp.x * z + pn.x;
        const lsy = mp.y * z + pn.y - 12;
        ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        const text = `${totalLen.toFixed(2)}mm`;
        const targetText = lengthTuneTarget ? ` / ${lengthTuneTarget.toFixed(2)}mm` : '';
        const fullText = text + targetText;
        const tw = ctx.measureText(fullText).width;
        ctx.fillRect(lsx - tw / 2 - 4, lsy - 10, tw + 8, 16);
        ctx.fillStyle = totalLen >= (lengthTuneTarget || 0) ? '#00ffb4' : '#ff8040';
        ctx.fillText(fullText, lsx, lsy);
      }
    }

    // Selection rect (rubber band)
    if (selectionRect) {
      const sx1 = selectionRect.start.x * z + pn.x;
      const sy1 = selectionRect.start.y * z + pn.y;
      const sx2 = selectionRect.end.x * z + pn.x;
      const sy2 = selectionRect.end.y * z + pn.y;
      ctx.fillStyle = theme.selectionFill;
      ctx.strokeStyle = theme.selectionColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      ctx.setLineDash([]);
    }

    // Measure tool
    if (measure.start) {
      const s1 = { x: measure.start.x * z + pn.x, y: measure.start.y * z + pn.y };
      const endPt = measure.end || mouseWorldRef.current;
      const s2 = { x: endPt.x * z + pn.x, y: endPt.y * z + pn.y };

      ctx.strokeStyle = theme.cyan; ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.setLineDash([]);

      [s1, s2].forEach(pt => {
        ctx.fillStyle = theme.cyan;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
      });

      const dx = endPt.x - measure.start.x;
      const dy = endPt.y - measure.start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const midX = (s1.x + s2.x) / 2;
      const midY = (s1.y + s2.y) / 2;
      const label = `${dist.toFixed(2)} mm`;
      ctx.font = `bold 12px ${theme.fontMono}`;
      ctx.fillStyle = theme.bg0;
      const m = ctx.measureText(label);
      ctx.fillRect(midX - m.width / 2 - 4, midY - 18, m.width + 8, 20);
      ctx.fillStyle = theme.cyan;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, midX, midY - 8);
    }

    // DRC markers
    const markerSize = Math.max(6, z * 1.5);
    for (const marker of drcMarkers) {
      const sx = marker.x * z + pn.x;
      const sy = marker.y * z + pn.y;
      const color = marker.severity === 'error' ? theme.red : theme.orange;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, z * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx - markerSize, sy - markerSize); ctx.lineTo(sx + markerSize, sy + markerSize);
      ctx.moveTo(sx + markerSize, sy - markerSize); ctx.lineTo(sx - markerSize, sy + markerSize);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, markerSize * 1.3, 0, Math.PI * 2); ctx.stroke();
    }

    // Crosshair
    if (showCrosshair) {
      const mx = mouseWorldRef.current;
      const csx = mx.x * z + pn.x;
      const csy = mx.y * z + pn.y;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(csx, 0); ctx.lineTo(csx, h);
      ctx.moveTo(0, csy); ctx.lineTo(w, csy);
      ctx.stroke();
    }
  }, [
    routingPreview, routingWidth, activeLayer, getLayerColor,
    zonePreview, keepoutPreview, diffPairPreview,
    lengthTuneTraceId, lengthTuneTarget, board.traces,
    selectionRect, measure, drcMarkers, showCrosshair,
  ]);

  // ─── Main render loop ───────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { animRef.current = requestAnimationFrame(render); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { animRef.current = requestAnimationFrame(render); return; }
    const oc = offscreenRef.current;
    if (!oc) { animRef.current = requestAnimationFrame(render); return; }

    const dm = dirtyMap.current;
    let anyDirty = false;

    // Redraw only the dirty offscreen layers
    if (dm.grid)        { drawGrid(oc.grid.ctx as any);               dm.grid = false;       anyDirty = true; }
    if (dm.outline)     { drawBoardOutline(oc.outline.ctx as any);    dm.outline = false;    anyDirty = true; }
    if (dm.zones)       { drawZones(oc.zones.ctx as any);             dm.zones = false;      anyDirty = true; }
    if (dm.traces)      { drawTraces(oc.traces.ctx as any);           dm.traces = false;     anyDirty = true; }
    if (dm.pads)        { drawPads(oc.pads.ctx as any);               dm.pads = false;       anyDirty = true; }
    if (dm.vias)        { drawVias(oc.vias.ctx as any);               dm.vias = false;       anyDirty = true; }
    if (dm.silkscreen)  { drawSilkscreen(oc.silkscreen.ctx as any);  dm.silkscreen = false;  anyDirty = true; }
    if (dm.ratsnest)    { drawRatsnest(oc.ratsnest.ctx as any);      dm.ratsnest = false;    anyDirty = true; }
    if (dm.overlay)     { drawOverlay(oc.overlay.ctx as any);         dm.overlay = false;    anyDirty = true; }

    // Composite all layers to the visible canvas
    if (anyDirty || needsComposite.current) {
      needsComposite.current = false;
      const { w, h, dpr } = dimRef.current;
      const pw = w * dpr;
      const ph = h * dpr;

      ctx.clearRect(0, 0, pw, ph);
      ctx.fillStyle = theme.brdBackground;
      ctx.fillRect(0, 0, pw, ph);

      // Composite in painter's order
      ctx.drawImage(oc.grid.canvas as any, 0, 0);
      ctx.drawImage(oc.outline.canvas as any, 0, 0);
      ctx.drawImage(oc.zones.canvas as any, 0, 0);
      ctx.drawImage(oc.traces.canvas as any, 0, 0);
      ctx.drawImage(oc.pads.canvas as any, 0, 0);
      ctx.drawImage(oc.vias.canvas as any, 0, 0);
      ctx.drawImage(oc.silkscreen.canvas as any, 0, 0);
      ctx.drawImage(oc.ratsnest.canvas as any, 0, 0);
      ctx.drawImage(oc.overlay.canvas as any, 0, 0);
    }

    animRef.current = requestAnimationFrame(render);
  }, [
    drawGrid, drawBoardOutline, drawZones, drawTraces, drawPads,
    drawVias, drawSilkscreen, drawRatsnest, drawOverlay,
  ]);

  // ─── Canvas resize ──────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      dimRef.current = { w, h, dpr };
      ensureOffscreen(w, h);
      markAllDirty();
    };
    resize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => { resize(); });
      resizeObserver.observe(container);
    }
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [ensureOffscreen, markAllDirty]);

  // Start render loop
  useEffect(() => {
    markAllDirty();
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render, markAllDirty]);

  // ─── Keyboard: space for pan mode ───────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceDownRef.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        isPanningRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ─── Mouse: wheel zoom centered on cursor ──────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const oldZoom = zoomRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.max(0.1, Math.min(200, oldZoom * factor));

    // Keep the world-point under the cursor fixed
    const p = panRef.current;
    panRef.current = {
      x: sx - (sx - p.x) * (newZoom / oldZoom),
      y: sy - (sy - p.y) * (newZoom / oldZoom),
    };
    zoomRef.current = newZoom;
    markAllDirty();

    onWheel(e);
  }, [onWheel, markAllDirty]);

  // ─── Mouse: move (pan or world coords) ─────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Panning
    if (isPanningRef.current) {
      const dx = sx - panStartMouseRef.current.x;
      const dy = sy - panStartMouseRef.current.y;
      panRef.current = {
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      };
      markAllDirty();
      return;
    }

    const world = screenToWorld(sx, sy);
    mouseWorldRef.current = world;
    dirtyMap.current.overlay = true;
    needsComposite.current = true;
    setCoordsDisplay({ x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 });
    onMouseMove(world, e);
  }, [screenToWorld, onMouseMove, markAllDirty]);

  // ─── Mouse: down (start pan or forward) ─────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Middle button or space+left = pan
    if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
      isPanningRef.current = true;
      panStartRef.current = { ...panRef.current };
      panStartMouseRef.current = { x: sx, y: sy };
      e.preventDefault();
      return;
    }

    const world = screenToWorld(sx, sy);
    onMouseDown(world, e);
  }, [screenToWorld, onMouseDown]);

  // ─── Mouse: up ──────────────────────────────────────────────────────

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    onMouseUp(world, e);
  }, [screenToWorld, onMouseUp]);

  // ─── Render JSX ─────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={styles.container}>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={e => e.preventDefault()}
      />
      <div style={styles.coordsBar}>
        <span style={styles.coordLabel}>X:</span>
        <span style={styles.coordValue}>{coordsDisplay.x.toFixed(2)}</span>
        <span style={styles.coordLabel}>Y:</span>
        <span style={styles.coordValue}>{coordsDisplay.y.toFixed(2)}</span>
        <span style={styles.coordLabel}>mm</span>
        <span style={{ ...styles.coordLabel, marginLeft: 16 }}>Layer:</span>
        <span style={{ ...styles.coordValue, color: getLayerConfig(activeLayer)?.color || '#fff' }}>
          {activeLayer}
        </span>
      </div>
    </div>
  );
});

BoardCanvasGL.displayName = 'BoardCanvasGL';

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    cursor: 'crosshair',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
  coordsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
    background: theme.bg1,
    borderTop: theme.border,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 4,
    zIndex: 10,
  },
  coordLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
  },
  coordValue: {
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    minWidth: 56,
  },
};

export default BoardCanvasGL;
