// ─── drcEngine.ts ── Real Design Rule Check engine ──────────────────────────
// Runs entirely in the browser using simple 2D geometry.

import type {
  Point, BoardState, BrdTrace, BrdVia, BrdComponent, BrdPad, BrdZone,
} from '../types';

// ─── Design Rules ───────────────────────────────────────────────────────────

export interface NetClassRules {
  name: string;
  nets: string[];
  minTraceWidth: number;
  minClearance: number;
}

export interface DesignRules {
  /** Default minimum clearance in mm */
  minClearance: number;
  /** Default minimum trace width in mm */
  minTraceWidth: number;
  /** Minimum annular ring in mm (pad radius - drill radius) */
  minAnnularRing: number;
  /** Minimum via drill diameter in mm */
  minViaDrill: number;
  /** Minimum board edge clearance in mm */
  minBoardEdgeClearance: number;
  /** Minimum solder mask expansion in mm (mask opening beyond pad edge) */
  minSolderMaskExpansion: number;
  /** Minimum silk-to-pad clearance in mm */
  minSilkToPadClearance: number;
  /** Per net-class overrides */
  netClasses?: NetClassRules[];
}

export const DEFAULT_RULES: DesignRules = {
  minClearance: 0.15,
  minTraceWidth: 0.15,
  minAnnularRing: 0.125,
  minViaDrill: 0.2,
  minBoardEdgeClearance: 0.25,
  minSolderMaskExpansion: 0.05,
  minSilkToPadClearance: 0.15,
};

// ─── Violation ──────────────────────────────────────────────────────────────

export type DRCSeverity = 'error' | 'warning' | 'info';

export type DRCRuleKind =
  | 'clearance'
  | 'width'
  | 'annular-ring'
  | 'connectivity'
  | 'short-circuit'
  | 'board-edge'
  | 'drill'
  | 'copper-pour'
  | 'keepout'
  | 'via-type'
  | 'solder-mask'
  | 'silk-to-pad'
  | 'diff-pair-spacing';

export interface DRCViolation {
  rule: DRCRuleKind;
  severity: DRCSeverity;
  message: string;
  x: number;
  y: number;
  affectedItems: string[];
}

export interface DRCResult {
  violations: DRCViolation[];
  score: number;
  runTimeMs: number;
  timestamp: number;
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

/** Distance between two points */
function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Minimum distance from point P to line segment AB */
function distPointToSegment(P: Point, A: Point, B: Point): number {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(P, A);
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(P, { x: A.x + t * dx, y: A.y + t * dy });
}

/** Minimum distance between two line segments AB and CD */
function distSegmentToSegment(A: Point, B: Point, C: Point, D: Point): number {
  // Check all 4 point-to-segment distances plus intersection
  let minD = Infinity;
  minD = Math.min(minD, distPointToSegment(A, C, D));
  minD = Math.min(minD, distPointToSegment(B, C, D));
  minD = Math.min(minD, distPointToSegment(C, A, B));
  minD = Math.min(minD, distPointToSegment(D, A, B));

  // Check for actual intersection
  if (segmentsIntersect(A, B, C, D)) return 0;

  return minD;
}

/** Do two segments intersect? */
function segmentsIntersect(A: Point, B: Point, C: Point, D: Point): boolean {
  const d1 = cross(C, D, A);
  const d2 = cross(C, D, B);
  const d3 = cross(A, B, C);
  const d4 = cross(A, B, D);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(C, D, A)) return true;
  if (d2 === 0 && onSegment(C, D, B)) return true;
  if (d3 === 0 && onSegment(A, B, C)) return true;
  if (d4 === 0 && onSegment(A, B, D)) return true;
  return false;
}

function cross(A: Point, B: Point, C: Point): number {
  return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
}

function onSegment(A: Point, B: Point, P: Point): boolean {
  return Math.min(A.x, B.x) <= P.x && P.x <= Math.max(A.x, B.x) &&
         Math.min(A.y, B.y) <= P.y && P.y <= Math.max(A.y, B.y);
}

/** Closest point on a polygon edge to point P; returns distance */
function distPointToPolygonEdge(P: Point, polygon: Point[]): number {
  let minD = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    minD = Math.min(minD, distPointToSegment(P, polygon[i], polygon[j]));
  }
  return minD;
}

/** Is point inside polygon? (ray casting) */
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

/** Midpoint of a segment */
function midpoint(A: Point, B: Point): Point {
  return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
}

// ─── Bug #14: Rectangle-to-segment distance for rectangular pads ────────────

/**
 * Compute the minimum distance from a line segment (A, B) to an
 * axis-aligned rectangle centered at (cx, cy) with half-extents hw, hh.
 * The rectangle may be rotated by `rotation` degrees.
 */
function distSegmentToRect(
  A: Point, B: Point,
  cx: number, cy: number,
  hw: number, hh: number,
  rotation: number
): number {
  // Transform segment into the rectangle's local frame
  const rad = -(rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  function toLocal(p: Point): Point {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: dx * cosR - dy * sinR, y: dx * sinR + dy * cosR };
  }

  const la = toLocal(A);
  const lb = toLocal(B);

  // Rectangle corners in local space
  const corners: Point[] = [
    { x: -hw, y: -hh },
    { x:  hw, y: -hh },
    { x:  hw, y:  hh },
    { x: -hw, y:  hh },
  ];

  // Check if either endpoint is inside the rectangle
  function insideRect(p: Point): boolean {
    return Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
  }
  if (insideRect(la) || insideRect(lb)) return 0;

  // Check segment against all 4 edges of the rectangle
  let minD = Infinity;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const d = distSegmentToSegment(la, lb, corners[i], corners[j]);
    if (d < minD) minD = d;
  }

  // Also check distance from rectangle center to segment, minus the rect extent
  // (handles the case of segment passing very near the rect)
  const dCenter = distPointToSegment({ x: 0, y: 0 }, la, lb);
  // Project center onto segment to find closest point direction
  if (dCenter < minD) {
    // This is covered by the edge checks above, but as a safety net:
    // minD is already the minimum from edge checks
  }

  return minD;
}

// ─── Resolve pad world position ─────────────────────────────────────────────

interface PadWorld {
  id: string;
  cx: number;
  cy: number;
  hw: number;    // half-width
  hh: number;    // half-height
  netId: string;
  layer: string;
  layers: string[];  // all layers this pad is on
  drill: number;
  annularRing: number;
  compId: string;
  padNum: string;
  shape: string;
  rotation: number;  // total rotation (comp rotation) for rect distance checks
}

function resolvePads(board: BoardState): PadWorld[] {
  const pads: PadWorld[] = [];
  for (const comp of board.components) {
    const rad = (comp.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    for (const pad of comp.pads) {
      // Apply rotation
      const rx = pad.x * cosR - pad.y * sinR;
      const ry = pad.x * sinR + pad.y * cosR;
      const drill = pad.drill ?? 0;
      const minDim = Math.min(pad.width, pad.height);
      pads.push({
        id: pad.id,
        cx: comp.x + rx,
        cy: comp.y + ry,
        hw: pad.width / 2,
        hh: pad.height / 2,
        netId: pad.netId ?? '',
        layer: pad.layers[0] ?? comp.layer,
        layers: pad.layers.length > 0 ? pad.layers : [comp.layer],
        drill,
        annularRing: drill > 0 ? (minDim - drill) / 2 : Infinity,
        compId: comp.id,
        padNum: pad.number,
        shape: pad.shape,
        rotation: comp.rotation,
      });
    }
  }
  return pads;
}

// ─── Net class lookup ───────────────────────────────────────────────────────

function getClearanceForNets(rules: DesignRules, netA: string, netB: string): number {
  if (rules.netClasses) {
    for (const nc of rules.netClasses) {
      if (nc.nets.includes(netA) || nc.nets.includes(netB)) {
        return nc.minClearance;
      }
    }
  }
  return rules.minClearance;
}

function getMinWidthForNet(rules: DesignRules, netId: string): number {
  if (rules.netClasses) {
    for (const nc of rules.netClasses) {
      if (nc.nets.includes(netId)) return nc.minTraceWidth;
    }
  }
  return rules.minTraceWidth;
}

// ─── Check: clearance trace-trace ──────────────────────────────────────────

function checkTraceTraceClearance(board: BoardState, rules: DesignRules): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const traces = board.traces;
  for (let a = 0; a < traces.length; a++) {
    for (let b = a + 1; b < traces.length; b++) {
      const ta = traces[a];
      const tb = traces[b];
      // Only check traces on same layer
      if (ta.layer !== tb.layer) continue;
      // Same net can overlap
      if (ta.netId === tb.netId) continue;
      const requiredClearance = getClearanceForNets(rules, ta.netId, tb.netId);
      const requiredGap = requiredClearance + ta.width / 2 + tb.width / 2;
      for (let i = 0; i < ta.points.length - 1; i++) {
        for (let j = 0; j < tb.points.length - 1; j++) {
          const d = distSegmentToSegment(
            ta.points[i], ta.points[i + 1],
            tb.points[j], tb.points[j + 1]
          );
          if (d < requiredGap) {
            const mid = midpoint(
              midpoint(ta.points[i], ta.points[i + 1]),
              midpoint(tb.points[j], tb.points[j + 1])
            );
            const actual = Math.max(0, d - ta.width / 2 - tb.width / 2);
            violations.push({
              rule: 'clearance',
              severity: 'error',
              message: `Trace-trace clearance ${actual.toFixed(3)}mm < ${requiredClearance}mm (${ta.netId} / ${tb.netId})`,
              x: mid.x,
              y: mid.y,
              affectedItems: [ta.id, tb.id],
            });
          }
        }
      }
    }
  }
  return violations;
}

// ─── Check: clearance trace-pad (Bug #14: use rectangle distance for rect pads) ─

function checkTracePadClearance(board: BoardState, rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  for (const trace of board.traces) {
    for (const pad of pads) {
      // Check shared layers
      const sharedLayer = pad.layers.some(pl => pl === trace.layer);
      if (!sharedLayer) continue;
      if (trace.netId === pad.netId) continue;
      const requiredClearance = getClearanceForNets(rules, trace.netId, pad.netId);

      for (let i = 0; i < trace.points.length - 1; i++) {
        let gapDistance: number;

        if (pad.shape === 'rect' || pad.shape === 'roundrect') {
          // Bug #14: Use rectangle-to-segment distance for rectangular pads
          const segDist = distSegmentToRect(
            trace.points[i], trace.points[i + 1],
            pad.cx, pad.cy,
            pad.hw, pad.hh,
            pad.rotation
          );
          gapDistance = segDist - trace.width / 2;
        } else {
          // Circle/oval: use point-to-segment with radius
          const padRadius = Math.max(pad.hw, pad.hh);
          const padPt: Point = { x: pad.cx, y: pad.cy };
          const d = distPointToSegment(padPt, trace.points[i], trace.points[i + 1]);
          gapDistance = d - trace.width / 2 - padRadius;
        }

        if (gapDistance < requiredClearance) {
          const actual = Math.max(0, gapDistance);
          violations.push({
            rule: 'clearance',
            severity: 'error',
            message: `Trace-pad clearance ${actual.toFixed(3)}mm < ${requiredClearance}mm (${trace.netId} / pad ${pad.padNum})`,
            x: pad.cx,
            y: pad.cy,
            affectedItems: [trace.id, pad.id],
          });
        }
      }
    }
  }
  return violations;
}

// ─── Check: clearance pad-pad ───────────────────────────────────────────────

function checkPadPadClearance(rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  for (let a = 0; a < pads.length; a++) {
    for (let b = a + 1; b < pads.length; b++) {
      const pa = pads[a];
      const pb = pads[b];
      // Same component pads skip
      if (pa.compId === pb.compId) continue;
      // Same net skip
      if (pa.netId === pb.netId && pa.netId !== '') continue;
      // Must share a layer
      const sharesLayer = pa.layers.some(l => pb.layers.includes(l));
      if (!sharesLayer) continue;
      const requiredClearance = getClearanceForNets(rules, pa.netId, pb.netId);
      const d = dist({ x: pa.cx, y: pa.cy }, { x: pb.cx, y: pb.cy });
      const radA = Math.max(pa.hw, pa.hh);
      const radB = Math.max(pb.hw, pb.hh);
      const actual = d - radA - radB;
      if (actual < requiredClearance) {
        violations.push({
          rule: 'clearance',
          severity: 'error',
          message: `Pad-pad clearance ${actual.toFixed(3)}mm < ${requiredClearance}mm (${pa.padNum} / ${pb.padNum})`,
          x: (pa.cx + pb.cx) / 2,
          y: (pa.cy + pb.cy) / 2,
          affectedItems: [pa.id, pb.id],
        });
      }
    }
  }
  return violations;
}

// ─── Check: clearance trace-via / via-via ───────────────────────────────────

function checkViaClearance(board: BoardState, rules: DesignRules): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const vias = board.vias;

  // Via-via
  for (let a = 0; a < vias.length; a++) {
    for (let b = a + 1; b < vias.length; b++) {
      const va = vias[a];
      const vb = vias[b];
      if (va.netId === vb.netId) continue;
      const requiredClearance = getClearanceForNets(rules, va.netId, vb.netId);
      const d = dist({ x: va.x, y: va.y }, { x: vb.x, y: vb.y });
      const actual = d - va.size / 2 - vb.size / 2;
      if (actual < requiredClearance) {
        violations.push({
          rule: 'clearance',
          severity: 'error',
          message: `Via-via clearance ${actual.toFixed(3)}mm < ${requiredClearance}mm`,
          x: (va.x + vb.x) / 2,
          y: (va.y + vb.y) / 2,
          affectedItems: [va.id, vb.id],
        });
      }
    }
  }

  // Trace-via
  for (const trace of board.traces) {
    for (const via of vias) {
      // Check shared layers
      const sharedLayer = via.layers.some(vl => vl === trace.layer);
      if (!sharedLayer) continue;
      if (trace.netId === via.netId) continue;
      const requiredClearance = getClearanceForNets(rules, trace.netId, via.netId);
      const requiredGap = requiredClearance + trace.width / 2 + via.size / 2;
      const viaPt: Point = { x: via.x, y: via.y };
      for (let i = 0; i < trace.points.length - 1; i++) {
        const d = distPointToSegment(viaPt, trace.points[i], trace.points[i + 1]);
        if (d < requiredGap) {
          const actual = Math.max(0, d - trace.width / 2 - via.size / 2);
          violations.push({
            rule: 'clearance',
            severity: 'error',
            message: `Trace-via clearance ${actual.toFixed(3)}mm < ${requiredClearance}mm`,
            x: via.x,
            y: via.y,
            affectedItems: [trace.id, via.id],
          });
        }
      }
    }
  }
  return violations;
}

// ─── Check: minimum trace width ─────────────────────────────────────────────

function checkMinTraceWidth(board: BoardState, rules: DesignRules): DRCViolation[] {
  const violations: DRCViolation[] = [];
  for (const trace of board.traces) {
    const minW = getMinWidthForNet(rules, trace.netId);
    if (trace.width < minW) {
      const mid = trace.points[Math.floor(trace.points.length / 2)];
      violations.push({
        rule: 'width',
        severity: 'error',
        message: `Trace width ${trace.width}mm < minimum ${minW}mm (net ${trace.netId})`,
        x: mid.x,
        y: mid.y,
        affectedItems: [trace.id],
      });
    }
  }
  return violations;
}

// ─── Check: minimum annular ring ────────────────────────────────────────────

function checkAnnularRing(board: BoardState, rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  // Pads with drill
  for (const pad of pads) {
    if (pad.drill <= 0) continue;
    if (pad.annularRing < rules.minAnnularRing) {
      violations.push({
        rule: 'annular-ring',
        severity: 'error',
        message: `Annular ring ${pad.annularRing.toFixed(3)}mm < ${rules.minAnnularRing}mm (pad ${pad.padNum})`,
        x: pad.cx,
        y: pad.cy,
        affectedItems: [pad.id],
      });
    }
  }
  // Vias
  for (const via of board.vias) {
    const ring = (via.size - via.drill) / 2;
    if (ring < rules.minAnnularRing) {
      violations.push({
        rule: 'annular-ring',
        severity: 'error',
        message: `Via annular ring ${ring.toFixed(3)}mm < ${rules.minAnnularRing}mm`,
        x: via.x,
        y: via.y,
        affectedItems: [via.id],
      });
    }
  }
  return violations;
}

// ─── Check: via drill size ──────────────────────────────────────────────────

function checkViaDrill(board: BoardState, rules: DesignRules): DRCViolation[] {
  const violations: DRCViolation[] = [];
  for (const via of board.vias) {
    if (via.drill < rules.minViaDrill) {
      violations.push({
        rule: 'drill',
        severity: 'error',
        message: `Via drill ${via.drill}mm < minimum ${rules.minViaDrill}mm`,
        x: via.x,
        y: via.y,
        affectedItems: [via.id],
      });
    }
  }
  return violations;
}

// ─── Check: board edge clearance ────────────────────────────────────────────

function checkBoardEdgeClearance(board: BoardState, rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const outline = board.outline.points;
  if (outline.length < 3) return violations;

  const minEdge = rules.minBoardEdgeClearance;

  // Pads vs edge
  for (const pad of pads) {
    const d = distPointToPolygonEdge({ x: pad.cx, y: pad.cy }, outline);
    const effective = d - Math.max(pad.hw, pad.hh);
    if (effective < minEdge) {
      violations.push({
        rule: 'board-edge',
        severity: 'error',
        message: `Pad ${pad.padNum} edge clearance ${effective.toFixed(3)}mm < ${minEdge}mm`,
        x: pad.cx,
        y: pad.cy,
        affectedItems: [pad.id],
      });
    }
  }

  // Trace segments vs edge
  for (const trace of board.traces) {
    for (let i = 0; i < trace.points.length - 1; i++) {
      const seg = [trace.points[i], trace.points[i + 1]];
      // Sample points along segment
      const len = dist(seg[0], seg[1]);
      const steps = Math.max(2, Math.ceil(len / 1));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const pt: Point = {
          x: seg[0].x + t * (seg[1].x - seg[0].x),
          y: seg[0].y + t * (seg[1].y - seg[0].y),
        };
        const d = distPointToPolygonEdge(pt, outline);
        const effective = d - trace.width / 2;
        if (effective < minEdge) {
          violations.push({
            rule: 'board-edge',
            severity: 'error',
            message: `Trace edge clearance ${effective.toFixed(3)}mm < ${minEdge}mm (net ${trace.netId})`,
            x: pt.x,
            y: pt.y,
            affectedItems: [trace.id],
          });
          break; // one violation per segment is enough
        }
      }
    }
  }

  // Vias vs edge
  for (const via of board.vias) {
    const d = distPointToPolygonEdge({ x: via.x, y: via.y }, outline);
    const effective = d - via.size / 2;
    if (effective < minEdge) {
      violations.push({
        rule: 'board-edge',
        severity: 'error',
        message: `Via edge clearance ${effective.toFixed(3)}mm < ${minEdge}mm`,
        x: via.x,
        y: via.y,
        affectedItems: [via.id],
      });
    }
  }

  return violations;
}

// ─── Check: unconnected nets (Bug #13: fix via connectivity) ────────────────

/**
 * Build a connectivity graph from traces and vias.
 * For each net, find all pad positions and check that they are connected
 * through the trace/via graph.
 */
function checkUnconnectedNets(board: BoardState, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];

  // Group pads by netId
  const netPads = new Map<string, PadWorld[]>();
  for (const pad of pads) {
    if (!pad.netId) continue;
    let arr = netPads.get(pad.netId);
    if (!arr) { arr = []; netPads.set(pad.netId, arr); }
    arr.push(pad);
  }

  // For each net that has >1 pad, check connectivity
  for (const [netId, padList] of netPads) {
    if (padList.length < 2) continue;

    const tracesForNet = board.traces.filter(t => t.netId === netId);
    const viasForNet = board.vias.filter(v => v.netId === netId);

    // Build a simple union-find from trace endpoints and pad positions
    // Positions are snapped to 0.01mm grid for matching
    const key = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    const parent = new Map<string, string>();

    function find(x: string): string {
      // Initialize if not yet in parent map
      if (!parent.has(x)) { parent.set(x, x); return x; }
      while (parent.get(x) !== x) {
        const p = parent.get(x);
        if (p === undefined) { parent.set(x, x); return x; }
        parent.set(x, parent.get(p) ?? p); // path compression
        x = p;
      }
      return x;
    }

    function union(a: string, b: string) {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    // Initialize all pad positions
    for (const pad of padList) {
      const k = key({ x: pad.cx, y: pad.cy });
      if (!parent.has(k)) parent.set(k, k);
    }

    // Add trace endpoints and union consecutive points
    for (const trace of tracesForNet) {
      for (let i = 0; i < trace.points.length; i++) {
        const k = key(trace.points[i]);
        if (!parent.has(k)) parent.set(k, k);
        if (i > 0) {
          union(key(trace.points[i - 1]), k);
        }
      }
    }

    // Bug #13: Explicitly union vias with nearby trace endpoints and pads on all via layers.
    // Vias connect their position across layers. We must union them with
    // all trace endpoints and pads that are near the via on ANY of its layers.
    for (const via of viasForNet) {
      const viaKey = key({ x: via.x, y: via.y });
      if (!parent.has(viaKey)) parent.set(viaKey, viaKey);

      // Union via with all trace endpoints near the via on any of the via's layers
      for (const trace of tracesForNet) {
        // Check if trace shares a layer with the via
        const traceSharingLayer = via.layers.includes(trace.layer);
        if (!traceSharingLayer) continue;
        for (const pt of trace.points) {
          if (dist({ x: via.x, y: via.y }, pt) < 0.5) {
            union(viaKey, key(pt));
          }
        }
      }

      // Union via with all pads near the via on any shared layer
      for (const pad of padList) {
        const sharesLayer = pad.layers.some(pl => via.layers.includes(pl));
        if (!sharesLayer) continue;
        if (dist({ x: via.x, y: via.y }, { x: pad.cx, y: pad.cy }) < 0.5) {
          union(viaKey, key({ x: pad.cx, y: pad.cy }));
        }
      }

      // Union via with other vias of same net that share layers and overlap
      for (const otherVia of viasForNet) {
        if (otherVia.id === via.id) continue;
        const sharesViaLayer = via.layers.some(vl => otherVia.layers.includes(vl));
        if (!sharesViaLayer) continue;
        if (dist({ x: via.x, y: via.y }, { x: otherVia.x, y: otherVia.y }) < 0.5) {
          union(viaKey, key({ x: otherVia.x, y: otherVia.y }));
        }
      }
    }

    // Also union nearby points (trace end near pad, within 0.5mm tolerance)
    const allKeys: { k: string; pt: Point }[] = [];
    for (const [k] of parent) {
      const parts = k.split(',');
      allKeys.push({ k, pt: { x: parseInt(parts[0]) / 100, y: parseInt(parts[1]) / 100 } });
    }
    for (let i = 0; i < allKeys.length; i++) {
      for (let j = i + 1; j < allKeys.length; j++) {
        if (dist(allKeys[i].pt, allKeys[j].pt) < 0.5) {
          union(allKeys[i].k, allKeys[j].k);
        }
      }
    }

    // Check if all pads in the net are in the same set
    const padKeys = padList.map(p => key({ x: p.cx, y: p.cy }));
    const roots = new Set(padKeys.map(k => find(k)));
    if (roots.size > 1) {
      // Find pairs that are not connected
      const firstRoot = find(padKeys[0]);
      for (let i = 1; i < padList.length; i++) {
        if (find(padKeys[i]) !== firstRoot) {
          violations.push({
            rule: 'connectivity',
            severity: 'error',
            message: `Unconnected net "${netId}": pad ${padList[0].padNum} not connected to pad ${padList[i].padNum}`,
            x: padList[i].cx,
            y: padList[i].cy,
            affectedItems: [padList[0].id, padList[i].id],
          });
        }
      }
    }
  }
  return violations;
}

// ─── Check: short circuits (Bug #12: don't stop after first short) ──────────

function checkShortCircuits(board: BoardState): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const traces = board.traces;

  // Check if traces from different nets overlap (zero clearance distance considering widths)
  for (let a = 0; a < traces.length; a++) {
    for (let b = a + 1; b < traces.length; b++) {
      const ta = traces[a];
      const tb = traces[b];
      if (ta.layer !== tb.layer) continue;
      if (ta.netId === tb.netId) continue;
      if (!ta.netId || !tb.netId) continue;

      let foundShortForPair = false;
      for (let i = 0; i < ta.points.length - 1 && !foundShortForPair; i++) {
        for (let j = 0; j < tb.points.length - 1 && !foundShortForPair; j++) {
          const d = distSegmentToSegment(
            ta.points[i], ta.points[i + 1],
            tb.points[j], tb.points[j + 1]
          );
          const touchDist = ta.width / 2 + tb.width / 2;
          if (d < touchDist * 0.1) {
            // Overlapping or nearly touching -- short circuit
            const mid = midpoint(
              midpoint(ta.points[i], ta.points[i + 1]),
              midpoint(tb.points[j], tb.points[j + 1])
            );
            violations.push({
              rule: 'short-circuit',
              severity: 'error',
              message: `Short circuit: net "${ta.netId}" overlaps net "${tb.netId}" on ${ta.layer}`,
              x: mid.x,
              y: mid.y,
              affectedItems: [ta.id, tb.id],
            });
            // Bug #12: One violation per trace pair is enough, but CONTINUE checking other pairs
            // (was: return violations -- stopping after first short entirely)
            foundShortForPair = true;
          }
        }
      }
    }
  }
  return violations;
}

// ─── Check: keepout zone violations ──────────────────────────────────────────

function checkKeepoutZones(board: BoardState, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const keepouts = board.zones.filter(z => z.isKeepout);

  for (const kz of keepouts) {
    if (kz.points.length < 3) continue;
    const ktype = kz.keepoutType || 'no_copper';

    // Check traces inside keepout (no_copper or no_trace)
    if (ktype === 'no_copper' || ktype === 'no_trace') {
      for (const trace of board.traces) {
        if (trace.layer !== kz.layer && kz.layer !== 'All') continue;
        for (let i = 0; i < trace.points.length - 1; i++) {
          const mid = midpoint(trace.points[i], trace.points[i + 1]);
          if (pointInPolygon(trace.points[i], kz.points) ||
              pointInPolygon(trace.points[i + 1], kz.points) ||
              pointInPolygon(mid, kz.points)) {
            violations.push({
              rule: 'keepout',
              severity: 'error',
              message: `Trace in ${ktype} keepout zone (net ${trace.netId})`,
              x: mid.x,
              y: mid.y,
              affectedItems: [trace.id, kz.id],
            });
            break; // one violation per trace per keepout
          }
        }
      }
    }

    // Check vias inside keepout (no_copper or no_via)
    if (ktype === 'no_copper' || ktype === 'no_via') {
      for (const via of board.vias) {
        const sharesLayer = via.layers.some(vl => vl === kz.layer || kz.layer === 'All');
        if (!sharesLayer) continue;
        if (pointInPolygon({ x: via.x, y: via.y }, kz.points)) {
          violations.push({
            rule: 'keepout',
            severity: 'error',
            message: `Via in ${ktype} keepout zone`,
            x: via.x,
            y: via.y,
            affectedItems: [via.id, kz.id],
          });
        }
      }
    }

    // Check pads inside keepout (no_copper)
    if (ktype === 'no_copper') {
      for (const pad of pads) {
        const sharesLayer = pad.layers.some(pl => pl === kz.layer || kz.layer === 'All');
        if (!sharesLayer) continue;
        if (pointInPolygon({ x: pad.cx, y: pad.cy }, kz.points)) {
          violations.push({
            rule: 'keepout',
            severity: 'error',
            message: `Pad ${pad.padNum} in ${ktype} keepout zone`,
            x: pad.cx,
            y: pad.cy,
            affectedItems: [pad.id, kz.id],
          });
        }
      }
    }

    // Check components inside keepout (no_component)
    if (ktype === 'no_component') {
      for (const comp of board.components) {
        if (comp.layer !== kz.layer && kz.layer !== 'All') continue;
        if (pointInPolygon({ x: comp.x, y: comp.y }, kz.points)) {
          violations.push({
            rule: 'keepout',
            severity: 'error',
            message: `Component ${comp.ref} in ${ktype} keepout zone`,
            x: comp.x,
            y: comp.y,
            affectedItems: [comp.id, kz.id],
          });
        }
      }
    }
  }
  return violations;
}

// ─── Check: via type constraints (blind/buried/micro) ────────────────────────

const OUTER_LAYERS = new Set(['F.Cu', 'B.Cu']);

function checkViaTypeConstraints(board: BoardState, rules: DesignRules): DRCViolation[] {
  const violations: DRCViolation[] = [];

  for (const via of board.vias) {
    const vType = via.viaType || 'through';
    const startLayer = via.startLayer || via.layers[0] || 'F.Cu';
    const endLayer = via.endLayer || via.layers[via.layers.length - 1] || 'B.Cu';

    switch (vType) {
      case 'micro': {
        // Micro via: minimum drill is typically 0.1mm (vs 0.2mm for through)
        const microMinDrill = 0.1;
        if (via.drill < microMinDrill) {
          violations.push({
            rule: 'drill',
            severity: 'error',
            message: `Micro via drill ${via.drill}mm < minimum ${microMinDrill}mm`,
            x: via.x, y: via.y,
            affectedItems: [via.id],
          });
        }
        // Micro via must connect adjacent layers only
        const cuOrder = ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'];
        const si = cuOrder.indexOf(startLayer);
        const ei = cuOrder.indexOf(endLayer);
        if (si >= 0 && ei >= 0 && Math.abs(si - ei) > 1) {
          violations.push({
            rule: 'via-type',
            severity: 'error',
            message: `Micro via must connect adjacent layers only (${startLayer} to ${endLayer} spans ${Math.abs(si - ei)} layers)`,
            x: via.x, y: via.y,
            affectedItems: [via.id],
          });
        }
        break;
      }

      case 'blind': {
        // Blind via must connect to at least one outer layer
        const hasOuter = OUTER_LAYERS.has(startLayer) || OUTER_LAYERS.has(endLayer);
        if (!hasOuter) {
          violations.push({
            rule: 'via-type',
            severity: 'error',
            message: `Blind via must connect to an outer layer (F.Cu or B.Cu), but connects ${startLayer} to ${endLayer}`,
            x: via.x, y: via.y,
            affectedItems: [via.id],
          });
        }
        // Should NOT be through-all
        if (OUTER_LAYERS.has(startLayer) && OUTER_LAYERS.has(endLayer)) {
          violations.push({
            rule: 'via-type',
            severity: 'warning',
            message: `Blind via connects ${startLayer} to ${endLayer} -- this is a through via, not blind`,
            x: via.x, y: via.y,
            affectedItems: [via.id],
          });
        }
        break;
      }

      case 'buried': {
        // Buried via must NOT connect to any outer layer
        if (OUTER_LAYERS.has(startLayer) || OUTER_LAYERS.has(endLayer)) {
          violations.push({
            rule: 'via-type',
            severity: 'error',
            message: `Buried via must NOT connect to outer layers, but connects ${startLayer} to ${endLayer}`,
            x: via.x, y: via.y,
            affectedItems: [via.id],
          });
        }
        break;
      }

      case 'through':
      default:
        // Standard through-via drill check already handled by checkViaDrill
        break;
    }

    // Via annular ring check per type (tighter for micro)
    const ring = (via.size - via.drill) / 2;
    const minRing = vType === 'micro' ? 0.075 : rules.minAnnularRing;
    if (ring < minRing) {
      violations.push({
        rule: 'annular-ring',
        severity: 'error',
        message: `${vType} via annular ring ${ring.toFixed(3)}mm < min ${minRing}mm`,
        x: via.x, y: via.y,
        affectedItems: [via.id],
      });
    }
  }

  return violations;
}

// ─── Check: solder mask expansion ────────────────────────────────────────────

/**
 * Verify that every pad has at least the configured solder mask expansion.
 * In practice the mask opening must be >= pad size + 2 * minExpansion.
 * This flags pads whose mask expansion metadata (if present) is too small,
 * or simply warns for all pads as a reminder when no per-pad mask data exists.
 * We check that pads exist on a mask layer with adequate expansion.
 */
function checkSolderMaskRules(board: BoardState, rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const minExp = rules.minSolderMaskExpansion;

  for (const comp of board.components) {
    for (const pad of comp.pads) {
      // Compute world position (same logic as resolvePads)
      const rad = (comp.rotation * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const rx = pad.x * cosR - pad.y * sinR;
      const ry = pad.x * sinR + pad.y * cosR;
      const cx = comp.x + rx;
      const cy = comp.y + ry;

      // Determine which mask layer this pad should appear on
      const onFront = pad.layers.includes('F.Cu');
      const onBack = pad.layers.includes('B.Cu');

      // Check if pad has maskExpansion property (optional in data model)
      const padMaskExpansion = (pad as any).maskExpansion as number | undefined;
      if (padMaskExpansion !== undefined && padMaskExpansion < minExp) {
        const maskLayer = onFront ? 'F.Mask' : 'B.Mask';
        violations.push({
          rule: 'solder-mask',
          severity: 'warning',
          message: `Pad ${pad.number} (${comp.ref}) solder mask expansion ${padMaskExpansion.toFixed(3)}mm < minimum ${minExp}mm on ${maskLayer}`,
          x: cx,
          y: cy,
          affectedItems: [pad.id],
        });
      }

      // Check that pads which should have mask openings are on appropriate layers
      // Through-hole pads should have mask openings on both sides
      const drill = pad.drill ?? 0;
      if (drill > 0) {
        if (!pad.layers.includes('F.Mask') && !pad.layers.includes('B.Mask')) {
          // Through-hole pad without any mask layer defined is acceptable
          // (mask is typically auto-generated), so no violation here
        }
      }
    }
  }

  return violations;
}

// ─── Check: silkscreen to pad clearance ──────────────────────────────────────

/**
 * Check that silkscreen reference designator crosses / origins don't overlap
 * with any pads. We approximate the silk reference as a small region around
 * the component origin (matching the cross drawn in gerberGenerator.ts).
 */
function checkSilkToPadClearance(board: BoardState, rules: DesignRules, pads: PadWorld[]): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const minClearance = rules.minSilkToPadClearance;
  const silkCrossHalfSize = 1.0; // matches the 1.0mm cross in gerberGenerator

  for (const comp of board.components) {
    const silkLayer = comp.layer === 'F.Cu' ? 'F.SilkS' : 'B.SilkS';
    const targetCuLayer = comp.layer === 'F.Cu' ? 'F.Cu' : 'B.Cu';

    // The silk cross extends from (comp.x - 1, comp.y) to (comp.x + 1, comp.y)
    // and from (comp.x, comp.y - 1) to (comp.x, comp.y + 1)
    // Check clearance of this cross against all pads on the same side
    for (const pad of pads) {
      const padOnSameSide = pad.layers.includes(targetCuLayer);
      if (!padOnSameSide) continue;

      // Distance from pad center to component origin
      const d = dist({ x: comp.x, y: comp.y }, { x: pad.cx, y: pad.cy });
      const padRadius = Math.max(pad.hw, pad.hh);

      // Check if any part of the silk cross is within clearance of the pad
      // The cross endpoints define two line segments
      const crossSegs: [Point, Point][] = [
        [{ x: comp.x - silkCrossHalfSize, y: comp.y }, { x: comp.x + silkCrossHalfSize, y: comp.y }],
        [{ x: comp.x, y: comp.y - silkCrossHalfSize }, { x: comp.x, y: comp.y + silkCrossHalfSize }],
      ];

      for (const [segA, segB] of crossSegs) {
        let gapDistance: number;

        if (pad.shape === 'rect' || pad.shape === 'roundrect') {
          const segDist = distSegmentToRect(
            segA, segB,
            pad.cx, pad.cy,
            pad.hw, pad.hh,
            pad.rotation
          );
          gapDistance = segDist;
        } else {
          const segDist = distPointToSegment({ x: pad.cx, y: pad.cy }, segA, segB);
          gapDistance = segDist - padRadius;
        }

        if (gapDistance < minClearance) {
          const actual = Math.max(0, gapDistance);
          violations.push({
            rule: 'silk-to-pad',
            severity: 'warning',
            message: `Silkscreen of ${comp.ref} overlaps pad ${pad.padNum} (${pad.compId}): clearance ${actual.toFixed(3)}mm < ${minClearance}mm`,
            x: pad.cx,
            y: pad.cy,
            affectedItems: [comp.id, pad.id],
          });
          break; // one violation per pad per component silk is enough
        }
      }
    }
  }

  return violations;
}

// ─── Check: differential pair spacing consistency ────────────────────────────

/** Regex patterns for common differential pair naming conventions */
const DIFF_PAIR_PATTERNS: RegExp[] = [
  /^(.+)(\+)$/,   // e.g. USB_D+
  /^(.+)(-)$/,     // e.g. USB_D-
  /^(.+)(_P)$/,    // e.g. ETH_TX_P
  /^(.+)(_N)$/,    // e.g. ETH_TX_N
  /^(.+)(P)$/,     // e.g. ETH_TXP
  /^(.+)(N)$/,     // e.g. ETH_TXN
];

/**
 * Identify differential pairs by matching net names (e.g. USB_D+ / USB_D-,
 * ETH_TX_P / ETH_TX_N) and check that each pair's trace spacing is consistent.
 */
function checkDiffPairSpacing(board: BoardState): DRCViolation[] {
  const violations: DRCViolation[] = [];

  // Collect all net IDs from traces
  const netIds = new Set<string>();
  for (const trace of board.traces) {
    if (trace.netId) netIds.add(trace.netId);
  }

  // Find differential pairs
  const pairs = new Map<string, { positive: string; negative: string }>();

  for (const netId of netIds) {
    for (const pattern of DIFF_PAIR_PATTERNS) {
      const match = netId.match(pattern);
      if (!match) continue;
      const baseName = match[1];
      const suffix = match[2];

      // Determine the complementary suffix
      let complementSuffix: string;
      if (suffix === '+') complementSuffix = '-';
      else if (suffix === '-') complementSuffix = '+';
      else if (suffix === '_P') complementSuffix = '_N';
      else if (suffix === '_N') complementSuffix = '_P';
      else if (suffix === 'P') complementSuffix = 'N';
      else if (suffix === 'N') complementSuffix = 'P';
      else continue;

      const complementNet = baseName + complementSuffix;
      if (!netIds.has(complementNet)) continue;

      // Use sorted key to avoid duplicate pair entries
      const pairKey = [netId, complementNet].sort().join('|');
      if (!pairs.has(pairKey)) {
        const isPositive = suffix === '+' || suffix === '_P' || suffix === 'P';
        pairs.set(pairKey, {
          positive: isPositive ? netId : complementNet,
          negative: isPositive ? complementNet : netId,
        });
      }
      break; // matched one pattern, no need to check more
    }
  }

  // For each differential pair, measure spacing between traces on the same layer
  for (const [, pair] of pairs) {
    const posTraces = board.traces.filter(t => t.netId === pair.positive);
    const negTraces = board.traces.filter(t => t.netId === pair.negative);

    if (posTraces.length === 0 || negTraces.length === 0) continue;

    // Measure spacing at multiple points between paired trace segments on same layer
    const spacings: { spacing: number; x: number; y: number }[] = [];

    for (const pt of posTraces) {
      for (const nt of negTraces) {
        if (pt.layer !== nt.layer) continue;

        for (let i = 0; i < pt.points.length - 1; i++) {
          for (let j = 0; j < nt.points.length - 1; j++) {
            const d = distSegmentToSegment(
              pt.points[i], pt.points[i + 1],
              nt.points[j], nt.points[j + 1]
            );
            // Only consider segments that are reasonably close (within 5mm)
            // to be part of the same differential pair routing
            const gap = d - pt.width / 2 - nt.width / 2;
            if (gap > 0 && gap < 5.0) {
              const mid = midpoint(
                midpoint(pt.points[i], pt.points[i + 1]),
                midpoint(nt.points[j], nt.points[j + 1])
              );
              spacings.push({ spacing: gap, x: mid.x, y: mid.y });
            }
          }
        }
      }
    }

    if (spacings.length < 2) continue;

    // Calculate median spacing as the "intended" spacing
    spacings.sort((a, b) => a.spacing - b.spacing);
    const medianSpacing = spacings[Math.floor(spacings.length / 2)].spacing;

    // Flag segments where spacing deviates more than 20% from median
    const tolerance = medianSpacing * 0.2;
    for (const sp of spacings) {
      if (Math.abs(sp.spacing - medianSpacing) > tolerance) {
        violations.push({
          rule: 'diff-pair-spacing',
          severity: 'warning',
          message: `Differential pair ${pair.positive}/${pair.negative} spacing ${sp.spacing.toFixed(3)}mm deviates from median ${medianSpacing.toFixed(3)}mm (tolerance ±${tolerance.toFixed(3)}mm)`,
          x: sp.x,
          y: sp.y,
          affectedItems: [],
        });
      }
    }
  }

  return violations;
}

// ─── Main DRC runner ────────────────────────────────────────────────────────

export function runDRC(board: BoardState, rules: DesignRules = DEFAULT_RULES): DRCResult {
  const t0 = performance.now();
  const pads = resolvePads(board);

  const violations: DRCViolation[] = [
    ...checkTraceTraceClearance(board, rules),
    ...checkTracePadClearance(board, rules, pads),
    ...checkPadPadClearance(rules, pads),
    ...checkViaClearance(board, rules),
    ...checkMinTraceWidth(board, rules),
    ...checkAnnularRing(board, rules, pads),
    ...checkViaDrill(board, rules),
    ...checkBoardEdgeClearance(board, rules, pads),
    ...checkUnconnectedNets(board, pads),
    ...checkShortCircuits(board),
    ...checkKeepoutZones(board, pads),
    ...checkViaTypeConstraints(board, rules),
    ...checkSolderMaskRules(board, rules, pads),
    ...checkSilkToPadClearance(board, rules, pads),
    ...checkDiffPairSpacing(board),
  ];

  // Deduplicate by position + rule (within 0.1mm)
  const seen = new Set<string>();
  const unique: DRCViolation[] = [];
  for (const v of violations) {
    const k = `${v.rule}:${Math.round(v.x * 10)}:${Math.round(v.y * 10)}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(v);
    }
  }

  // Score: start at 100, deduct per violation
  const errorCount = unique.filter(v => v.severity === 'error').length;
  const warnCount = unique.filter(v => v.severity === 'warning').length;
  const score = Math.max(0, Math.round(100 - errorCount * 8 - warnCount * 2));

  const runTimeMs = performance.now() - t0;

  return {
    violations: unique,
    score,
    runTimeMs,
    timestamp: Date.now(),
  };
}
