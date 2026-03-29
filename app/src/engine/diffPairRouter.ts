// ─── diffPairRouter.ts ── Differential pair routing engine ──────────────────
// Routes two traces in parallel with constant gap for high-speed signals.
// Handles corners with matched-radius turns and adds length-matching meanders.

import type { Point, BrdTrace } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiffPairResult {
  positiveTrace: BrdTrace;
  negativeTrace: BrdTrace;
  gap: number;
  lengthP: number;
  lengthN: number;
  skew: number;           // length difference in mm (P - N)
}

export interface DiffPairConfig {
  gap: number;            // center-to-center spacing (mm)
  width: number;          // individual trace width (mm)
  layer: string;
  netIdP: string;         // positive net
  netIdN: string;         // negative net
  maxSkew: number;        // max allowed length mismatch (mm)
  cornerStyle: 'mitered' | 'curved';
  lengthMatch: boolean;   // auto-add meanders to shorter trace
  meanderAmplitude: number;  // amplitude for length matching meanders
}

export const DEFAULT_DIFF_PAIR_CONFIG: DiffPairConfig = {
  gap: 0.2,
  width: 0.15,
  layer: 'F.Cu',
  netIdP: '',
  netIdN: '',
  maxSkew: 0.1,
  cornerStyle: 'mitered',
  lengthMatch: true,
  meanderAmplitude: 0.5,
};

// ─── Geometry helpers ───────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function vecSub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function vecAdd(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function vecScale(v: Point, s: number): Point {
  return { x: v.x * s, y: v.y * s };
}

function vecLength(v: Point): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function vecNormalize(v: Point): Point {
  const len = vecLength(v);
  if (len < 1e-10) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/** Perpendicular unit vector (90 degrees CCW) */
function vecPerpCCW(v: Point): Point {
  const n = vecNormalize(v);
  return { x: -n.y, y: n.x };
}

function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += dist(points[i], points[i + 1]);
  }
  return len;
}

/** Angle of direction vector in radians */
function vecAngle(v: Point): number {
  return Math.atan2(v.y, v.x);
}

/** Signed angle difference (radians) from angle a to angle b */
function angleDiff(a: number, b: number): number {
  let d = b - a;
  if (!isFinite(d)) return 0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// ─── Offset path generation ─────────────────────────────────────────────────

/**
 * Generate an offset path at a given distance from the center path.
 * Positive offset = left side (CCW perpendicular), negative = right side.
 * Handles corners by computing the intersection of offset lines or inserting
 * miter points for acute angles.
 */
function offsetPath(centerPoints: Point[], offsetDist: number): Point[] {
  if (centerPoints.length < 2) return [...centerPoints];

  const result: Point[] = [];

  // For each segment, compute the offset line
  const offsetSegments: { a: Point; b: Point }[] = [];

  for (let i = 0; i < centerPoints.length - 1; i++) {
    const dir = vecSub(centerPoints[i + 1], centerPoints[i]);
    const perp = vecPerpCCW(dir);
    const offset = vecScale(perp, offsetDist);

    offsetSegments.push({
      a: vecAdd(centerPoints[i], offset),
      b: vecAdd(centerPoints[i + 1], offset),
    });
  }

  // First point
  result.push(offsetSegments[0].a);

  // For each junction between segments, find intersection or add miter
  for (let i = 0; i < offsetSegments.length - 1; i++) {
    const seg1 = offsetSegments[i];
    const seg2 = offsetSegments[i + 1];

    // Try to intersect the two offset lines
    const intersection = lineLineIntersection(seg1.a, seg1.b, seg2.a, seg2.b);

    if (intersection) {
      // Check if intersection is not too far (miter limit)
      const d1 = dist(intersection, seg1.b);
      const d2 = dist(intersection, seg2.a);
      const segLen = dist(centerPoints[i + 1], centerPoints[i]);

      if (d1 < segLen * 3 && d2 < segLen * 3) {
        result.push(intersection);
      } else {
        // Miter limit exceeded, insert bevel
        result.push(seg1.b);
        result.push(seg2.a);
      }
    } else {
      // Parallel segments - just use the endpoint
      result.push(seg1.b);
    }
  }

  // Last point
  result.push(offsetSegments[offsetSegments.length - 1].b);

  return result;
}

/** Line-line intersection (infinite lines through AB and CD) */
function lineLineIntersection(A: Point, B: Point, C: Point, D: Point): Point | null {
  const dAB = vecSub(B, A);
  const dCD = vecSub(D, C);
  const denom = dAB.x * dCD.y - dAB.y * dCD.x;

  if (Math.abs(denom) < 1e-10) return null; // Parallel

  const t = ((C.x - A.x) * dCD.y - (C.y - A.y) * dCD.x) / denom;
  return {
    x: A.x + t * dAB.x,
    y: A.y + t * dAB.y,
  };
}

// ─── Length matching meanders ───────────────────────────────────────────────

/**
 * Add serpentine meanders to a trace path to increase its length to match a target.
 * Inserts meanders on the longest straight segment.
 */
function addLengthMatchingMeanders(
  points: Point[],
  currentLength: number,
  targetLength: number,
  amplitude: number,
): Point[] {
  const deficit = targetLength - currentLength;
  if (deficit <= 0.01) return points; // Already long enough

  // Find the longest segment to insert meanders
  let longestIdx = 0;
  let longestLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = dist(points[i], points[i + 1]);
    if (len > longestLen) {
      longestLen = len;
      longestIdx = i;
    }
  }

  if (longestLen < amplitude * 2) {
    // Segment too short for meanders
    return points;
  }

  const A = points[longestIdx];
  const B = points[longestIdx + 1];
  const dir = vecNormalize(vecSub(B, A));
  const perp = vecPerpCCW(dir);

  // Calculate meander parameters
  // Each meander cycle (one S-curve) adds approximately:
  // extra = 2 * sqrt(pitch^2 + amplitude^2) - 2 * pitch
  // where pitch is the spacing between meander peaks
  // Solve for number of meanders needed
  const pitch = amplitude * 1.5; // spacing between peaks
  const legLength = Math.sqrt(pitch * pitch + amplitude * amplitude);
  const extraPerCycle = 2 * legLength - 2 * pitch;

  if (extraPerCycle <= 0.001) return points;

  const numCycles = Math.ceil(deficit / extraPerCycle);
  const totalMeanderLength = numCycles * 2 * pitch;

  if (totalMeanderLength > longestLen * 0.8) {
    // Not enough room; use available space
    return points;
  }

  // Center meanders on the segment
  const startOffset = (longestLen - totalMeanderLength) / 2;
  const meanderPoints: Point[] = [];

  // Points before meander
  meanderPoints.push(A);
  const meanderStart = vecAdd(A, vecScale(dir, startOffset));
  meanderPoints.push(meanderStart);

  // Generate meander points
  for (let c = 0; c < numCycles; c++) {
    const baseOffset = startOffset + c * 2 * pitch;

    // Up peak
    const upBase = vecAdd(A, vecScale(dir, baseOffset + pitch * 0.5));
    const upPeak = vecAdd(upBase, vecScale(perp, amplitude));
    meanderPoints.push(upPeak);

    // Down peak
    const downBase = vecAdd(A, vecScale(dir, baseOffset + pitch * 1.5));
    const downPeak = vecAdd(downBase, vecScale(perp, -amplitude));
    meanderPoints.push(downPeak);
  }

  // End of meander
  const meanderEnd = vecAdd(A, vecScale(dir, startOffset + totalMeanderLength));
  meanderPoints.push(meanderEnd);
  meanderPoints.push(B);

  // Reconstruct full path
  const result: Point[] = [];
  for (let i = 0; i < longestIdx; i++) {
    result.push(points[i]);
  }
  result.push(...meanderPoints);
  for (let i = longestIdx + 2; i < points.length; i++) {
    result.push(points[i]);
  }

  return result;
}

// ─── Main differential pair routing ─────────────────────────────────────────

/**
 * Route a differential pair: two parallel traces with constant gap.
 *
 * Algorithm:
 * 1. Compute a center path from start midpoint to end midpoint
 * 2. Offset the center path by +/- gap/2 to create P and N traces
 * 3. Handle corners by computing offset-line intersections
 * 4. If length matching is enabled, add meanders to the shorter trace
 *
 * @param startP - Start point of positive trace
 * @param endP - End point of positive trace
 * @param startN - Start point of negative trace
 * @param endN - End point of negative trace
 * @param gap - Center-to-center gap between traces
 * @param width - Individual trace width
 * @param layer - PCB layer
 * @param netIdP - Net ID for positive trace
 * @param netIdN - Net ID for negative trace
 */
export function routeDiffPair(
  startP: Point, endP: Point,
  startN: Point, endN: Point,
  gap: number, width: number, layer: string,
  netIdP: string, netIdN: string,
  config: Partial<DiffPairConfig> = {},
): DiffPairResult {
  const cfg = { ...DEFAULT_DIFF_PAIR_CONFIG, gap, width, layer, netIdP, netIdN, ...config };

  // Compute center path (midpoint of P and N at start and end)
  const startMid: Point = {
    x: (startP.x + startN.x) / 2,
    y: (startP.y + startN.y) / 2,
  };
  const endMid: Point = {
    x: (endP.x + endN.x) / 2,
    y: (endP.y + endN.y) / 2,
  };

  // Determine which side is P and which is N from the start points
  const startDir = vecNormalize(vecSub(endMid, startMid));
  const startPerp = vecPerpCCW(startDir);
  const startToP = vecSub(startP, startMid);
  const pSide = startToP.x * startPerp.x + startToP.y * startPerp.y;
  const halfGap = gap / 2;
  const pOffset = pSide >= 0 ? halfGap : -halfGap;
  const nOffset = -pOffset;

  // Build center path with 45-degree routing
  const centerPath = buildCenterPath(startMid, endMid);

  // Generate offset paths for P and N
  let pathP = offsetPath(centerPath, pOffset);
  let pathN = offsetPath(centerPath, nOffset);

  // Snap endpoints to actual start/end positions
  pathP = snapEndpoints(pathP, startP, endP);
  pathN = snapEndpoints(pathN, startN, endN);

  // Calculate lengths
  let lengthP = pathLength(pathP);
  let lengthN = pathLength(pathN);

  // Length matching
  if (cfg.lengthMatch && Math.abs(lengthP - lengthN) > cfg.maxSkew) {
    if (lengthP < lengthN) {
      pathP = addLengthMatchingMeanders(pathP, lengthP, lengthN, cfg.meanderAmplitude);
      lengthP = pathLength(pathP);
    } else {
      pathN = addLengthMatchingMeanders(pathN, lengthN, lengthP, cfg.meanderAmplitude);
      lengthN = pathLength(pathN);
    }
  }

  const skew = lengthP - lengthN;
  const ts = Date.now().toString(36);

  const positiveTrace: BrdTrace = {
    id: `dp_p_${ts}`,
    points: pathP,
    width: cfg.width,
    layer: cfg.layer,
    netId: cfg.netIdP,
  };

  const negativeTrace: BrdTrace = {
    id: `dp_n_${ts}`,
    points: pathN,
    width: cfg.width,
    layer: cfg.layer,
    netId: cfg.netIdN,
  };

  return {
    positiveTrace,
    negativeTrace,
    gap: cfg.gap,
    lengthP,
    lengthN,
    skew,
  };
}

// ─── Center path builder ────────────────────────────────────────────────────

/**
 * Build a center path from start to end using 45-degree segments.
 * Creates a horizontal-then-diagonal or vertical-then-diagonal path.
 */
function buildCenterPath(start: Point, end: Point): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // If nearly straight (within 5%), use direct path
  if (absDx < 0.05 || absDy < 0.05) {
    return [start, end];
  }

  // 45-degree routing: horizontal/vertical first, then diagonal
  if (absDx > absDy) {
    const straight = absDx - absDy;
    const midX = start.x + Math.sign(dx) * straight;
    return [start, { x: midX, y: start.y }, end];
  } else {
    const straight = absDy - absDx;
    const midY = start.y + Math.sign(dy) * straight;
    return [start, { x: start.x, y: midY }, end];
  }
}

/**
 * Snap the first and last points of a path to desired positions.
 * Adjusts the second and second-to-last points to maintain path shape.
 */
function snapEndpoints(path: Point[], start: Point, end: Point): Point[] {
  if (path.length < 2) return [start, end];
  const result = [...path];
  result[0] = { ...start };
  result[result.length - 1] = { ...end };
  return result;
}

/**
 * Quick helper: generate a simple diff pair from two click positions.
 * Determines P/N based on which pad is "left" or "right" of the route direction.
 */
export function quickDiffPair(
  clickStart: Point,
  clickEnd: Point,
  gap: number,
  width: number,
  layer: string,
  netIdP: string,
  netIdN: string,
): DiffPairResult {
  // Generate P/N start and end points perpendicular to route direction
  const dir = vecNormalize(vecSub(clickEnd, clickStart));
  const perp = vecPerpCCW(dir);
  const halfGap = gap / 2;

  const startP = vecAdd(clickStart, vecScale(perp, halfGap));
  const startN = vecAdd(clickStart, vecScale(perp, -halfGap));
  const endP = vecAdd(clickEnd, vecScale(perp, halfGap));
  const endN = vecAdd(clickEnd, vecScale(perp, -halfGap));

  return routeDiffPair(startP, endP, startN, endN, gap, width, layer, netIdP, netIdN);
}
