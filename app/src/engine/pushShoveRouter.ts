// ─── pushShoveRouter.ts ── Push-and-Shove interactive routing engine ────────
// When routing a new trace, detects collisions with existing traces/pads and
// pushes them aside to maintain clearance, similar to KiCad's interactive router.

import type { Point, BrdTrace, BrdPad, BrdComponent } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PushShoveConfig {
  enabled: boolean;
  maxIterations: number;       // max push iterations before giving up
  maxPushDistance: number;      // max distance (mm) a trace can be pushed
  respectLocks: boolean;       // don't push locked traces
}

export const DEFAULT_PUSH_SHOVE_CONFIG: PushShoveConfig = {
  enabled: true,
  maxIterations: 50,
  maxPushDistance: 5.0,
  respectLocks: true,
};

export interface PushShoveResult {
  newTrace: BrdTrace;
  modifiedTraces: BrdTrace[];  // existing traces that were pushed
  success: boolean;
  violations: string[];        // any unresolvable conflicts
}

interface Segment {
  a: Point;
  b: Point;
}

interface CollisionInfo {
  traceId: string;
  traceIndex: number;
  segmentIndex: number;
  distance: number;
  pushVector: Point;    // direction and magnitude to push
  closestPoint: Point;  // point of closest approach on existing segment
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function segmentLength(a: Point, b: Point): number {
  return dist(a, b);
}

/** Minimum distance from point P to segment AB, returns [distance, closest point, t-parameter] */
function distPointToSegmentFull(
  P: Point, A: Point, B: Point,
): { distance: number; closest: Point; t: number } {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { distance: dist(P, A), closest: { ...A }, t: 0 };
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = { x: A.x + t * dx, y: A.y + t * dy };
  return { distance: dist(P, closest), closest, t };
}

/** Minimum distance between two segments, with closest points */
function distSegmentToSegment(
  A: Point, B: Point, C: Point, D: Point,
): { distance: number; closestOnAB: Point; closestOnCD: Point } {
  // Check all point-to-segment combinations
  const results = [
    (() => { const r = distPointToSegmentFull(A, C, D); return { distance: r.distance, closestOnAB: A, closestOnCD: r.closest }; })(),
    (() => { const r = distPointToSegmentFull(B, C, D); return { distance: r.distance, closestOnAB: B, closestOnCD: r.closest }; })(),
    (() => { const r = distPointToSegmentFull(C, A, B); return { distance: r.distance, closestOnAB: r.closest, closestOnCD: C }; })(),
    (() => { const r = distPointToSegmentFull(D, A, B); return { distance: r.distance, closestOnAB: r.closest, closestOnCD: D }; })(),
  ];

  // Also check actual segment intersection
  if (segmentsIntersect(A, B, C, D)) {
    const pt = segmentIntersectionPoint(A, B, C, D);
    if (pt) {
      results.push({ distance: 0, closestOnAB: pt, closestOnCD: pt });
    }
  }

  let best = results[0];
  for (let i = 1; i < results.length; i++) {
    if (results[i].distance < best.distance) best = results[i];
  }
  return best;
}

function cross2D(A: Point, B: Point, C: Point): number {
  return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
}

function segmentsIntersect(A: Point, B: Point, C: Point, D: Point): boolean {
  const d1 = cross2D(C, D, A);
  const d2 = cross2D(C, D, B);
  const d3 = cross2D(A, B, C);
  const d4 = cross2D(A, B, D);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return false;
}

function segmentIntersectionPoint(A: Point, B: Point, C: Point, D: Point): Point | null {
  const dAB = { x: B.x - A.x, y: B.y - A.y };
  const dCD = { x: D.x - C.x, y: D.y - C.y };
  const denom = dAB.x * dCD.y - dAB.y * dCD.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((C.x - A.x) * dCD.y - (C.y - A.y) * dCD.x) / denom;
  return { x: A.x + t * dAB.x, y: A.y + t * dAB.y };
}

/** Perpendicular vector (unit length) to segment AB */
function perpendicularUnit(A: Point, B: Point): Point {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return { x: 0, y: 1 };
  // Perpendicular: rotate 90 degrees CCW
  return { x: -dy / len, y: dx / len };
}

/** Determine which side of segment AB point P is on (+1 or -1) */
function sideOf(A: Point, B: Point, P: Point): number {
  const c = cross2D(A, B, P);
  return c >= 0 ? 1 : -1;
}

/** Distance from point to pad (rectangle approximated) */
function distPointToPad(
  P: Point, padCenter: Point, padWidth: number, padHeight: number,
): number {
  const hw = padWidth / 2;
  const hh = padHeight / 2;
  const dx = Math.max(0, Math.abs(P.x - padCenter.x) - hw);
  const dy = Math.max(0, Math.abs(P.y - padCenter.y) - hh);
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from a segment to a pad center (approximated as rectangle) */
function distSegmentToPad(
  A: Point, B: Point, padCenter: Point, padWidth: number, padHeight: number,
): number {
  // Approximate: distance from segment to pad center minus half-diagonal
  const { distance } = distPointToSegmentFull(padCenter, A, B);
  const halfSize = Math.max(padWidth, padHeight) / 2;
  return Math.max(0, distance - halfSize);
}

// ─── Collision detection ────────────────────────────────────────────────────

function detectTraceCollisions(
  newSegments: Segment[],
  newWidth: number,
  existingTraces: BrdTrace[],
  clearance: number,
  newNetId: string,
): CollisionInfo[] {
  const collisions: CollisionInfo[] = [];
  const requiredGap = clearance;

  for (let ti = 0; ti < existingTraces.length; ti++) {
    const trace = existingTraces[ti];
    // Skip same-net traces (they can overlap)
    if (trace.netId === newNetId) continue;

    const halfWidths = (newWidth + trace.width) / 2;
    const minAllowed = halfWidths + requiredGap;

    for (let si = 0; si < trace.points.length - 1; si++) {
      const eA = trace.points[si];
      const eB = trace.points[si + 1];

      for (const seg of newSegments) {
        const result = distSegmentToSegment(seg.a, seg.b, eA, eB);

        if (result.distance < minAllowed) {
          // Calculate push vector: perpendicular to existing segment,
          // pushing away from the new trace
          const perp = perpendicularUnit(eA, eB);
          const side = sideOf(eA, eB, seg.a);
          // Push the existing trace in the opposite direction of the new trace
          const pushDir = { x: -perp.x * side, y: -perp.y * side };
          const pushMag = minAllowed - result.distance + 0.01; // small epsilon

          collisions.push({
            traceId: trace.id,
            traceIndex: ti,
            segmentIndex: si,
            distance: result.distance,
            pushVector: {
              x: pushDir.x * pushMag,
              y: pushDir.y * pushMag,
            },
            closestPoint: result.closestOnCD,
          });
        }
      }
    }
  }

  return collisions;
}

function detectPadCollisions(
  newSegments: Segment[],
  newWidth: number,
  pads: { center: Point; width: number; height: number; netId?: string }[],
  clearance: number,
  newNetId: string,
): string[] {
  const violations: string[] = [];
  const halfWidth = newWidth / 2;

  for (const pad of pads) {
    if (pad.netId === newNetId) continue;

    for (const seg of newSegments) {
      const d = distSegmentToPad(seg.a, seg.b, pad.center, pad.width, pad.height);
      if (d < halfWidth + clearance) {
        violations.push(
          `Trace violates clearance to pad at (${pad.center.x.toFixed(2)}, ${pad.center.y.toFixed(2)}) ` +
          `by ${(halfWidth + clearance - d).toFixed(3)}mm`
        );
      }
    }
  }

  return violations;
}

// ─── Push logic ─────────────────────────────────────────────────────────────

/**
 * Push a trace segment by translating the affected vertices.
 * Uses a spring-like model: vertices near the collision point move the most,
 * vertices farther away move less, creating a smooth deformation.
 */
function pushTraceSegments(
  trace: BrdTrace,
  collisions: CollisionInfo[],
  config: PushShoveConfig,
): BrdTrace | null {
  const points = trace.points.map(p => ({ ...p }));
  let totalPush = 0;

  // Group collisions and apply push to affected vertices
  for (const col of collisions) {
    const si = col.segmentIndex;

    // Influence falloff: vertices near the collision move more
    for (let vi = 0; vi < points.length; vi++) {
      // Distance from vertex to collision (in segment indices)
      const indexDist = Math.min(Math.abs(vi - si), Math.abs(vi - (si + 1)));
      // Gaussian falloff
      const influence = Math.exp(-indexDist * indexDist / 2.0);

      if (influence > 0.01) {
        const pushX = col.pushVector.x * influence;
        const pushY = col.pushVector.y * influence;
        points[vi].x += pushX;
        points[vi].y += pushY;
        totalPush = Math.max(totalPush, Math.sqrt(pushX * pushX + pushY * pushY));
      }
    }
  }

  // Check if push exceeded max distance
  if (totalPush > config.maxPushDistance) {
    return null; // Can't push this far
  }

  return { ...trace, points };
}

/**
 * Verify that a pushed trace doesn't violate its own constraints.
 * Checks that pushed trace doesn't collide with other traces (besides the new one).
 */
function validatePushedTrace(
  pushed: BrdTrace,
  allTraces: BrdTrace[],
  excludeIds: Set<string>,
  clearance: number,
): boolean {
  const segments: Segment[] = [];
  for (let i = 0; i < pushed.points.length - 1; i++) {
    segments.push({ a: pushed.points[i], b: pushed.points[i + 1] });
  }

  for (const other of allTraces) {
    if (other.id === pushed.id || excludeIds.has(other.id)) continue;
    if (other.netId === pushed.netId) continue;
    if (other.layer !== pushed.layer) continue;

    const halfWidths = (pushed.width + other.width) / 2;
    const minAllowed = halfWidths + clearance;

    for (let si = 0; si < other.points.length - 1; si++) {
      for (const seg of segments) {
        const result = distSegmentToSegment(seg.a, seg.b, other.points[si], other.points[si + 1]);
        if (result.distance < minAllowed) {
          return false; // Would create new violation
        }
      }
    }
  }

  return true;
}

// ─── Main router function ───────────────────────────────────────────────────

/**
 * Route a new trace with push-and-shove collision avoidance.
 *
 * When the new trace would collide with existing traces:
 * 1. Detect all collisions within clearance distance
 * 2. Group collisions by affected trace
 * 3. Push each affected trace aside (translate segments to maintain clearance)
 * 4. Validate that pushed traces don't violate their own DRC
 * 5. Iterate if pushing one trace causes new collisions
 *
 * @returns PushShoveResult with the new trace and any modified existing traces
 */
export function routeWithPushShove(
  newSegments: Point[],
  netId: string,
  layer: string,
  width: number,
  existingTraces: BrdTrace[],
  existingPads: BrdPad[],
  clearance: number,
  config: PushShoveConfig = DEFAULT_PUSH_SHOVE_CONFIG,
): PushShoveResult {
  // Build new trace
  const newTrace: BrdTrace = {
    id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    points: [...newSegments],
    width,
    layer,
    netId,
  };

  // If push-and-shove is disabled, just return the trace with any violations noted
  if (!config.enabled) {
    const segs = pointsToSegments(newSegments);
    const padInfos = existingPads.map(p => ({
      center: { x: p.x, y: p.y },
      width: p.width,
      height: p.height,
      netId: p.netId,
    }));
    const padViolations = detectPadCollisions(segs, width, padInfos, clearance, netId);

    const sameLayerTraces = existingTraces.filter(t => t.layer === layer);
    const traceCollisions = detectTraceCollisions(segs, width, sameLayerTraces, clearance, netId);

    const violations: string[] = [...padViolations];
    if (traceCollisions.length > 0) {
      violations.push(`${traceCollisions.length} trace clearance violations detected`);
    }

    return {
      newTrace,
      modifiedTraces: [],
      success: violations.length === 0,
      violations,
    };
  }

  // Build pad collision info
  const padInfos = existingPads.map(p => ({
    center: { x: p.x, y: p.y },
    width: p.width,
    height: p.height,
    netId: p.netId,
  }));

  // Filter to same-layer traces only
  const sameLayerTraces = existingTraces.filter(t => t.layer === layer);

  // Iterative push-and-shove
  const modifiedMap = new Map<string, BrdTrace>();
  let workingTraces = [...sameLayerTraces];
  const violations: string[] = [];
  let iteration = 0;
  let converged = false;

  while (iteration < config.maxIterations && !converged) {
    iteration++;
    converged = true;

    const newSegs = pointsToSegments(newTrace.points);

    // Also check collisions against already-modified traces pushing into each other
    const allNewSegs = [
      ...newSegs,
      ...Array.from(modifiedMap.values()).flatMap(t => pointsToSegments(t.points)),
    ];

    // Detect collisions with current state of traces
    const collisions = detectTraceCollisions(newSegs, width, workingTraces, clearance, netId);

    if (collisions.length === 0) break;

    // Group by trace
    const collisionsByTrace = new Map<string, CollisionInfo[]>();
    for (const col of collisions) {
      const key = col.traceId;
      if (!collisionsByTrace.has(key)) collisionsByTrace.set(key, []);
      const arr = collisionsByTrace.get(key);
      if (arr) arr.push(col);
    }

    for (const [traceId, traceCols] of collisionsByTrace) {
      const traceIdx = workingTraces.findIndex(t => t.id === traceId);
      if (traceIdx < 0) continue;

      const original = workingTraces[traceIdx];

      // Attempt push
      const pushed = pushTraceSegments(original, traceCols, config);

      if (!pushed) {
        violations.push(
          `Cannot push trace ${traceId}: would exceed max push distance (${config.maxPushDistance}mm)`
        );
        continue;
      }

      // Validate pushed trace doesn't create new violations with non-involved traces
      const excludeIds = new Set([newTrace.id, ...Array.from(modifiedMap.keys())]);
      const isValid = validatePushedTrace(pushed, workingTraces, excludeIds, clearance);

      if (!isValid) {
        violations.push(
          `Cannot push trace ${traceId}: would create new DRC violations`
        );
        continue;
      }

      // Accept the push
      workingTraces[traceIdx] = pushed;
      modifiedMap.set(traceId, pushed);
      converged = false; // Need another iteration to check cascading effects
    }
  }

  if (!converged && iteration >= config.maxIterations) {
    violations.push(`Push-and-shove did not converge after ${config.maxIterations} iterations`);
  }

  // Check pad violations (pads can't be pushed)
  const newSegs = pointsToSegments(newTrace.points);
  const padViolations = detectPadCollisions(newSegs, width, padInfos, clearance, netId);
  violations.push(...padViolations);

  return {
    newTrace,
    modifiedTraces: Array.from(modifiedMap.values()),
    success: violations.length === 0,
    violations,
  };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function pointsToSegments(points: Point[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({ a: points[i], b: points[i + 1] });
  }
  return segs;
}

/**
 * Collect all pads from board components into a flat array with world positions.
 * Handles component rotation.
 */
export function collectBoardPads(
  components: BrdComponent[],
): BrdPad[] {
  const pads: BrdPad[] = [];
  for (const comp of components) {
    const rad = (comp.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    for (const pad of comp.pads) {
      const rx = pad.x * cosR - pad.y * sinR;
      const ry = pad.x * sinR + pad.y * cosR;
      pads.push({
        ...pad,
        x: comp.x + rx,
        y: comp.y + ry,
      });
    }
  }
  return pads;
}

/**
 * Compute total trace length from its points.
 */
export function traceLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += dist(points[i], points[i + 1]);
  }
  return len;
}
