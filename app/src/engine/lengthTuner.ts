// ─── lengthTuner.ts ── Trace length tuning with meander patterns ────────────
// Adds serpentine or trombone meander patterns to traces to match a target length.
// Used for high-speed design length matching (DDR, USB, PCIe, etc.).

import type { Point, BrdTrace } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type MeanderStyle = 'serpentine' | 'trombone';

export interface MeanderConfig {
  style: MeanderStyle;
  maxAmplitude: number;       // maximum meander height (mm)
  minSpacing: number;         // minimum spacing between meander legs (mm)
  cornerStyle: 'sharp' | 'rounded';
  symmetry: boolean;          // symmetric meanders around centerline
}

export const DEFAULT_MEANDER_CONFIG: MeanderConfig = {
  style: 'serpentine',
  maxAmplitude: 1.0,
  minSpacing: 0.3,
  cornerStyle: 'rounded',
  symmetry: true,
};

export interface MeanderResult {
  trace: BrdTrace;
  currentLength: number;
  targetLength: number;
  meanderCount: number;
  achievedLength: number;     // actual length after meanders
  error: number;              // difference from target (mm)
}

export interface LengthInfo {
  traceId: string;
  length: number;
  points: Point[];
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
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

function vecNormalize(v: Point): Point {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
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

/**
 * Interpolate along a polyline at a given distance from the start.
 * Returns the point and the segment index.
 */
function interpolateAlongPath(
  points: Point[], targetDist: number,
): { point: Point; segmentIndex: number; t: number } | null {
  let accumulated = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = dist(points[i], points[i + 1]);
    if (accumulated + segLen >= targetDist) {
      const t = (targetDist - accumulated) / segLen;
      return {
        point: {
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
        },
        segmentIndex: i,
        t,
      };
    }
    accumulated += segLen;
  }
  return null;
}

// ─── Serpentine meander generation ──────────────────────────────────────────

/**
 * Generate serpentine (S-curve) meander pattern.
 *
 * Creates a zigzag pattern perpendicular to the trace direction:
 *
 *     ___     ___     ___
 *    |   |   |   |   |   |
 * ---+   +---+   +---+   +---
 *
 * Each full cycle consists of:
 * - Move perpendicular +amplitude
 * - Move forward by spacing
 * - Move perpendicular -2*amplitude
 * - Move forward by spacing
 * - Move perpendicular +amplitude (back to center)
 *
 * The extra path length per cycle = 4*amplitude - 0 (approximately,
 * since we're adding vertical segments).
 */
function generateSerpentineMeander(
  segStart: Point,
  segEnd: Point,
  amplitude: number,
  numCycles: number,
  spacing: number,
  cornerStyle: 'sharp' | 'rounded',
): Point[] {
  const dir = vecNormalize(vecSub(segEnd, segStart));
  const perp = vecPerpCCW(dir);
  const segLen = dist(segStart, segEnd);

  // Total meander length along the segment
  const totalMeanderLen = numCycles * spacing * 2;
  if (totalMeanderLen > segLen * 0.9) {
    return [segStart, segEnd]; // Not enough room
  }

  // Center the meander region
  const startOffset = (segLen - totalMeanderLen) / 2;
  const points: Point[] = [];

  // Lead-in
  points.push(segStart);
  const meanderOrigin = vecAdd(segStart, vecScale(dir, startOffset));
  points.push(meanderOrigin);

  let currentPos = meanderOrigin;
  let side = 1; // +1 = left, -1 = right

  for (let c = 0; c < numCycles; c++) {
    if (cornerStyle === 'rounded') {
      // Rounded corners: add intermediate points for smoother bends
      const cornerRadius = Math.min(amplitude * 0.3, spacing * 0.3);

      // Move to peak with rounded entry
      const prePeak = vecAdd(currentPos, vecScale(perp, side * (amplitude - cornerRadius)));
      const peakEntry = vecAdd(prePeak, vecScale(dir, cornerRadius));
      points.push(vecAdd(currentPos, vecScale(perp, side * cornerRadius)));
      points.push(prePeak);
      points.push(peakEntry);

      // Move forward along peak
      const peakForward = vecAdd(peakEntry, vecScale(dir, spacing - 2 * cornerRadius));
      points.push(peakForward);

      // Rounded exit from peak
      const postPeak = vecAdd(peakForward, vecScale(dir, cornerRadius));
      const exitPoint = vecAdd(postPeak, vecScale(perp, -side * (amplitude - cornerRadius)));
      points.push(vecAdd(peakForward, vecScale(perp, -side * cornerRadius)));

      // Return to center line
      const centerReturn = vecAdd(currentPos, vecScale(dir, spacing * 2));
      points.push(vecAdd(centerReturn, vecScale(perp, side * cornerRadius)));
      points.push(centerReturn);

      currentPos = centerReturn;
    } else {
      // Sharp corners: simple rectangular meander
      // Up to peak
      const peak1 = vecAdd(currentPos, vecScale(perp, side * amplitude));
      points.push(peak1);

      // Forward along peak
      const peak2 = vecAdd(peak1, vecScale(dir, spacing));
      points.push(peak2);

      // Back to center
      const center1 = vecAdd(peak2, vecScale(perp, -side * amplitude));
      points.push(center1);

      // Forward to next half-cycle start
      const nextStart = vecAdd(center1, vecScale(dir, spacing));

      // Down to opposite peak
      const peak3 = vecAdd(nextStart, vecScale(perp, -side * amplitude));

      // But for serpentine, we alternate sides each half-cycle
      // Actually, a full serpentine cycle = up, forward, down (2x amp), forward, up
      // Let's use the simpler S-pattern:

      currentPos = center1;
      side = -side; // Alternate sides for serpentine
    }
  }

  // Lead-out
  const meanderEnd = vecAdd(segStart, vecScale(dir, startOffset + totalMeanderLen));
  points.push(meanderEnd);
  points.push(segEnd);

  return points;
}

// ─── Trombone meander generation ────────────────────────────────────────────

/**
 * Generate trombone (U-turn) meander pattern.
 *
 * Creates U-shaped extensions perpendicular to the trace:
 *
 *    |  |    |  |    |  |
 *    |  |    |  |    |  |
 * ---+  +----+  +----+  +---
 *
 * Each U-turn adds 2*amplitude of extra length.
 */
function generateTromboneMeander(
  segStart: Point,
  segEnd: Point,
  amplitude: number,
  numCycles: number,
  spacing: number,
  cornerStyle: 'sharp' | 'rounded',
): Point[] {
  const dir = vecNormalize(vecSub(segEnd, segStart));
  const perp = vecPerpCCW(dir);
  const segLen = dist(segStart, segEnd);

  // Each trombone uses: spacing for the U-width + spacing for gap between trombones
  const tromboneWidth = spacing;
  const totalLen = numCycles * (tromboneWidth + spacing);
  if (totalLen > segLen * 0.9) {
    return [segStart, segEnd];
  }

  const startOffset = (segLen - totalLen) / 2;
  const points: Point[] = [];

  points.push(segStart);
  const origin = vecAdd(segStart, vecScale(dir, startOffset));
  points.push(origin);

  let currentPos = origin;

  for (let c = 0; c < numCycles; c++) {
    if (cornerStyle === 'rounded') {
      const r = Math.min(amplitude * 0.2, tromboneWidth * 0.3);

      // Go up
      const topLeft = vecAdd(currentPos, vecScale(perp, amplitude - r));
      points.push(vecAdd(currentPos, vecScale(perp, r)));
      points.push(topLeft);

      // Round corner at top-left
      const topRight = vecAdd(topLeft, vecScale(dir, tromboneWidth));
      points.push(vecAdd(topLeft, vecScale(dir, r)));
      points.push(vecAdd(topRight, vecScale(dir, -r)));
      points.push(topRight);

      // Come back down
      const bottomRight = vecAdd(currentPos, vecScale(dir, tromboneWidth));
      points.push(vecAdd(bottomRight, vecScale(perp, r)));
      points.push(bottomRight);

      // Gap to next trombone
      currentPos = vecAdd(bottomRight, vecScale(dir, spacing));
      points.push(currentPos);
    } else {
      // Sharp corners
      // Go perpendicular
      const top1 = vecAdd(currentPos, vecScale(perp, amplitude));
      points.push(top1);

      // Move forward
      const top2 = vecAdd(top1, vecScale(dir, tromboneWidth));
      points.push(top2);

      // Come back
      const bottom = vecAdd(currentPos, vecScale(dir, tromboneWidth));
      points.push(bottom);

      // Gap
      currentPos = vecAdd(bottom, vecScale(dir, spacing));
      points.push(currentPos);
    }
  }

  // Lead-out
  points.push(segEnd);

  return points;
}

// ─── Segment selection ──────────────────────────────────────────────────────

/**
 * Find the best segment to insert meanders.
 * Prefers the longest straight segment that has enough room.
 */
function findBestSegment(
  points: Point[],
  requiredLength: number,
  amplitude: number,
): { index: number; length: number } | null {
  let bestIdx = -1;
  let bestLen = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const len = dist(points[i], points[i + 1]);
    // Segment must be long enough for at least one meander cycle
    if (len > amplitude * 3 && len > bestLen) {
      bestLen = len;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;
  return { index: bestIdx, length: bestLen };
}

// ─── Main function ──────────────────────────────────────────────────────────

/**
 * Add meander patterns to a trace to match a target length.
 *
 * Algorithm:
 * 1. Calculate current trace length and deficit
 * 2. Find the best segment for meander insertion
 * 3. Calculate required number of meander cycles
 * 4. Generate meander pattern (serpentine or trombone)
 * 5. Splice meander into the trace points
 * 6. Iterate amplitude/count to converge on target length
 *
 * @param trace - The trace to add meanders to
 * @param targetLength - Desired total trace length (mm)
 * @param maxAmplitude - Maximum meander amplitude (mm)
 * @param style - 'serpentine' or 'trombone'
 */
export function addMeanders(
  trace: BrdTrace,
  targetLength: number,
  maxAmplitude: number,
  style: MeanderStyle = 'serpentine',
  config: Partial<MeanderConfig> = {},
): MeanderResult {
  const cfg: MeanderConfig = { ...DEFAULT_MEANDER_CONFIG, style, maxAmplitude, ...config };
  const currentLength = pathLength(trace.points);

  if (currentLength >= targetLength) {
    return {
      trace: { ...trace },
      currentLength,
      targetLength,
      meanderCount: 0,
      achievedLength: currentLength,
      error: currentLength - targetLength,
    };
  }

  const deficit = targetLength - currentLength;

  // Find best segment for meander insertion
  const bestSeg = findBestSegment(trace.points, deficit, cfg.maxAmplitude);
  if (!bestSeg) {
    return {
      trace: { ...trace },
      currentLength,
      targetLength,
      meanderCount: 0,
      achievedLength: currentLength,
      error: deficit,
    };
  }

  const segStart = trace.points[bestSeg.index];
  const segEnd = trace.points[bestSeg.index + 1];

  // Binary search for optimal amplitude and cycle count
  let bestResult: Point[] = trace.points;
  let bestAchieved = currentLength;
  let bestCount = 0;
  let bestError = deficit;

  // Try different combinations of amplitude and cycle count
  for (let ampFraction = 1.0; ampFraction >= 0.2; ampFraction -= 0.1) {
    const amplitude = cfg.maxAmplitude * ampFraction;
    const spacing = Math.max(cfg.minSpacing, amplitude * 0.8);

    // Estimate extra length per cycle
    let extraPerCycle: number;
    if (style === 'serpentine') {
      // Serpentine: each cycle adds ~4 * amplitude (up, across, down, across)
      // minus the straight-line distance of 2*spacing
      extraPerCycle = 2 * amplitude; // approximate
    } else {
      // Trombone: each U-turn adds ~2 * amplitude
      extraPerCycle = 2 * amplitude;
    }

    if (extraPerCycle <= 0.001) continue;

    const numCycles = Math.max(1, Math.round(deficit / extraPerCycle));

    // Generate meander
    let meanderPoints: Point[];
    if (style === 'serpentine') {
      meanderPoints = generateSerpentineMeander(
        segStart, segEnd, amplitude, numCycles, spacing, cfg.cornerStyle,
      );
    } else {
      meanderPoints = generateTromboneMeander(
        segStart, segEnd, amplitude, numCycles, spacing, cfg.cornerStyle,
      );
    }

    // Splice into trace
    const newPoints: Point[] = [
      ...trace.points.slice(0, bestSeg.index),
      ...meanderPoints,
      ...trace.points.slice(bestSeg.index + 2),
    ];

    const achieved = pathLength(newPoints);
    const error = Math.abs(achieved - targetLength);

    if (error < bestError) {
      bestResult = newPoints;
      bestAchieved = achieved;
      bestCount = numCycles;
      bestError = error;
    }

    // Good enough
    if (error < 0.05) break;
  }

  return {
    trace: {
      ...trace,
      points: bestResult,
    },
    currentLength,
    targetLength,
    meanderCount: bestCount,
    achievedLength: bestAchieved,
    error: bestError,
  };
}

// ─── Utility functions ──────────────────────────────────────────────────────

/**
 * Calculate the length of a trace.
 */
export function calculateTraceLength(trace: BrdTrace): number {
  return pathLength(trace.points);
}

/**
 * Get length info for all traces in a group (e.g., a bus).
 */
export function getTraceLengths(traces: BrdTrace[]): LengthInfo[] {
  return traces.map(t => ({
    traceId: t.id,
    length: pathLength(t.points),
    points: t.points,
  }));
}

/**
 * Calculate the target length for a group (longest trace).
 */
export function calculateGroupTarget(traces: BrdTrace[]): number {
  if (traces.length === 0) return 0;
  return Math.max(...traces.map(t => pathLength(t.points)));
}

/**
 * Match lengths of all traces in a group to the longest one.
 */
export function matchGroupLengths(
  traces: BrdTrace[],
  maxAmplitude: number,
  style: MeanderStyle = 'serpentine',
): MeanderResult[] {
  const target = calculateGroupTarget(traces);
  return traces.map(t => addMeanders(t, target, maxAmplitude, style));
}

/**
 * Preview meander: returns just the points without modifying the trace.
 * Useful for showing a preview before committing.
 */
export function previewMeander(
  tracePoints: Point[],
  targetLength: number,
  maxAmplitude: number,
  style: MeanderStyle = 'serpentine',
): { points: Point[]; achievedLength: number } {
  const dummyTrace: BrdTrace = {
    id: 'preview',
    points: tracePoints,
    width: 0,
    layer: '',
    netId: '',
  };
  const result = addMeanders(dummyTrace, targetLength, maxAmplitude, style);
  return {
    points: result.trace.points,
    achievedLength: result.achievedLength,
  };
}
