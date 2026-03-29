// ─── zoneFill.ts ── Zone (copper pour) fill engine ──────────────────────────
// Simplified zone fill that works in the browser using polygon subtraction.

import type {
  Point, BoardState, BrdZone, BrdTrace, BrdVia, BrdPad,
} from '../types';
import type { DesignRules } from './drcEngine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ThermalRelief {
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  spokeWidth: number;
  spokeCount: number;
}

export interface ClearanceHole {
  cx: number;
  cy: number;
  radius: number;
}

export interface FilledZone {
  zoneId: string;
  /** The original zone outline */
  outline: Point[];
  /** Circular holes cut out for clearance */
  clearanceHoles: ClearanceHole[];
  /** Thermal reliefs for same-net pads */
  thermalReliefs: ThermalRelief[];
  /** Isolated copper islands that were removed */
  removedIslands: Point[][];
  /** Final filled polygon boundary (outline minus holes) */
  fillPolygon: Point[];
  /** Layer */
  layer: string;
  /** Net */
  netId: string;
  /** Area of filled copper in mm^2 */
  filledArea: number;
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function pointInPolygon(P: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > P.y) !== (yj > P.y)) &&
        (P.x < (xj - xi) * (P.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Generate circle approximation with N segments */
function circlePoints(cx: number, cy: number, r: number, n: number = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

/** Minimum distance from point P to a polyline (not closed) */
function distPointToPolyline(P: Point, pts: Point[]): number {
  let minD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i];
    const B = pts[i + 1];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) { minD = Math.min(minD, dist(P, A)); continue; }
    let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    minD = Math.min(minD, dist(P, { x: A.x + t * dx, y: A.y + t * dy }));
  }
  return minD;
}

// ─── Resolve all obstacles ──────────────────────────────────────────────────

interface PadObstacle {
  cx: number;
  cy: number;
  radius: number;
  netId: string;
  padId: string;
  layer: string;
}

interface ViaObstacle {
  cx: number;
  cy: number;
  radius: number;
  netId: string;
  viaId: string;
  layers: string[];
}

interface TraceObstacle {
  points: Point[];
  halfWidth: number;
  netId: string;
  traceId: string;
  layer: string;
}

function gatherObstacles(board: BoardState) {
  const pads: PadObstacle[] = [];
  const vias: ViaObstacle[] = [];
  const traces: TraceObstacle[] = [];

  for (const comp of board.components) {
    const rad = (comp.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    for (const pad of comp.pads) {
      const rx = pad.x * cosR - pad.y * sinR;
      const ry = pad.x * sinR + pad.y * cosR;
      pads.push({
        cx: comp.x + rx,
        cy: comp.y + ry,
        radius: Math.max(pad.width, pad.height) / 2,
        netId: pad.netId ?? '',
        padId: pad.id,
        layer: pad.layers[0] ?? comp.layer,
      });
    }
  }

  for (const via of board.vias) {
    vias.push({
      cx: via.x,
      cy: via.y,
      radius: via.size / 2,
      netId: via.netId,
      viaId: via.id,
      layers: via.layers,
    });
  }

  for (const trace of board.traces) {
    traces.push({
      points: trace.points,
      halfWidth: trace.width / 2,
      netId: trace.netId,
      traceId: trace.id,
      layer: trace.layer,
    });
  }

  return { pads, vias, traces };
}

// ─── Fill a single zone ─────────────────────────────────────────────────────

export function fillZone(
  zone: BrdZone,
  board: BoardState,
  rules: DesignRules,
): FilledZone {
  const clearance = rules.minClearance;
  const { pads, vias, traces } = gatherObstacles(board);

  const clearanceHoles: ClearanceHole[] = [];
  const thermalReliefs: ThermalRelief[] = [];

  // ── Process pads ──────────────────────────────────────────────────────
  for (const pad of pads) {
    // Check if pad is within zone polygon
    if (!pointInPolygon({ x: pad.cx, y: pad.cy }, zone.points)) continue;
    // Check layer overlap
    if (pad.layer !== zone.layer && !pad.layer.includes('Cu')) continue;

    if (pad.netId === zone.netId && zone.netId !== '') {
      // Same net: thermal relief (4 spokes connecting pad to pour)
      thermalReliefs.push({
        cx: pad.cx,
        cy: pad.cy,
        outerRadius: pad.radius + clearance,
        innerRadius: pad.radius,
        spokeWidth: Math.max(0.2, pad.radius * 0.5),
        spokeCount: 4,
      });
    } else {
      // Different net: full clearance cutout
      clearanceHoles.push({
        cx: pad.cx,
        cy: pad.cy,
        radius: pad.radius + clearance,
      });
    }
  }

  // ── Process vias ──────────────────────────────────────────────────────
  for (const via of vias) {
    if (!pointInPolygon({ x: via.cx, y: via.cy }, zone.points)) continue;
    if (!via.layers.includes(zone.layer)) continue;

    if (via.netId === zone.netId && zone.netId !== '') {
      // Same net: thermal relief
      thermalReliefs.push({
        cx: via.cx,
        cy: via.cy,
        outerRadius: via.radius + clearance,
        innerRadius: via.radius,
        spokeWidth: Math.max(0.15, via.radius * 0.4),
        spokeCount: 4,
      });
    } else {
      clearanceHoles.push({
        cx: via.cx,
        cy: via.cy,
        radius: via.radius + clearance,
      });
    }
  }

  // ── Process traces ────────────────────────────────────────────────────
  // For traces on same layer but different net, generate clearance holes
  // along the trace path
  for (const trace of traces) {
    if (trace.layer !== zone.layer) continue;
    if (trace.netId === zone.netId) continue; // same net traces merge with zone
    if (trace.points.length < 2) continue;

    // Sample clearance circles along the trace
    for (let i = 0; i < trace.points.length - 1; i++) {
      const A = trace.points[i];
      const B = trace.points[i + 1];
      const len = dist(A, B);
      const step = Math.max(0.3, clearance);
      const steps = Math.max(2, Math.ceil(len / step));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const pt: Point = { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
        if (!pointInPolygon(pt, zone.points)) continue;
        clearanceHoles.push({
          cx: pt.x,
          cy: pt.y,
          radius: trace.halfWidth + clearance,
        });
      }
    }
  }

  // ── Build fill polygon ────────────────────────────────────────────────
  // The fill polygon is the zone outline. The clearance holes and thermal
  // reliefs are stored separately for rendering/export.
  const fillPolygon = [...zone.points];

  // ── Detect isolated copper islands ────────────────────────────────────
  // Simple heuristic: if a large region of the zone is surrounded by holes
  // and has no connection to any same-net pad/via, it is an island.
  // For simplicity, we skip actual polygon boolean and just flag zones
  // that have no same-net connections at all.
  const removedIslands: Point[][] = [];
  const hasSameNetConnection = thermalReliefs.length > 0 ||
    traces.some(t => t.layer === zone.layer && t.netId === zone.netId);

  if (!hasSameNetConnection && zone.netId !== '') {
    // This whole zone is potentially an island if it has no copper connections
    // We don't remove it but flag it
    // (In a real implementation we'd do polygon flood fill)
  }

  // ── Compute filled area ───────────────────────────────────────────────
  let filledArea = polygonArea(zone.points);
  for (const hole of clearanceHoles) {
    filledArea -= Math.PI * hole.radius * hole.radius;
  }
  // Thermal reliefs subtract the annular gap minus spoke area
  for (const tr of thermalReliefs) {
    const gapArea = Math.PI * (tr.outerRadius * tr.outerRadius - tr.innerRadius * tr.innerRadius);
    const spokeArea = tr.spokeCount * tr.spokeWidth * (tr.outerRadius - tr.innerRadius);
    filledArea -= (gapArea - spokeArea);
  }
  filledArea = Math.max(0, filledArea);

  return {
    zoneId: zone.id,
    outline: zone.points,
    clearanceHoles,
    thermalReliefs,
    removedIslands,
    fillPolygon,
    layer: zone.layer,
    netId: zone.netId,
    filledArea,
  };
}

// ─── Fill all zones ─────────────────────────────────────────────────────────

export function fillAllZones(board: BoardState, rules: DesignRules): FilledZone[] {
  return board.zones.map(zone => fillZone(zone, board, rules));
}
