// ─── placementSolver.ts ── Simulated Annealing placement solver ──────────────
// Pure algorithmic engine: takes constraints + components, produces positions.
// NO LLM. The intelligence comes from the cost function and constraint model.

import type { BrdComponent } from '../types';

// ─── Constraint Types ────────────────────────────────────────────────────────

export type ZoneType = 'POWER' | 'DIGITAL' | 'ANALOG' | 'CONNECTOR' | 'CLOCK' | 'UI' | 'COMMUNICATION';

export interface ZoneDefinition {
  type: ZoneType;
  componentRefs: string[];
  preferredRegion?: { x: number; y: number; w: number; h: number };
}

export interface CriticalPairConstraint {
  refA: string;
  refB: string;
  maxDistance: number;
  reason: string;
}

export interface PlacementConstraint {
  zones: ZoneDefinition[];
  criticalPairs: CriticalPairConstraint[];
  boardWidth: number;
  boardHeight: number;
  thermalOptimize?: boolean;
}

// ─── Internal working types ──────────────────────────────────────────────────

interface ComponentPlacement {
  ref: string;
  x: number;
  y: number;
  rotation: number;
  layer: string;
  width: number;   // bounding box width (from footprint estimate)
  height: number;   // bounding box height
  zoneType: ZoneType | null;
}

// ─── Footprint size estimation ───────────────────────────────────────────────

function estimateComponentSize(comp: BrdComponent): { w: number; h: number } {
  const fp = comp.footprint.toUpperCase();
  const ref = comp.ref;

  // ICs
  if (/QFP|LQFP/.test(fp)) return { w: 12, h: 12 };
  if (/BGA/.test(fp)) return { w: 14, h: 14 };
  if (/QFN/.test(fp)) return { w: 5, h: 5 };
  if (/TSSOP/.test(fp)) return { w: 6.5, h: 3 };
  if (/SOIC-?16|SOIC-?14/.test(fp)) return { w: 10, h: 4 };
  if (/SOIC/.test(fp)) return { w: 5, h: 4 };
  if (/DIP-?28|DIP-?40/.test(fp)) return { w: 15, h: 7.5 };
  if (/DIP/.test(fp)) return { w: 10, h: 7.5 };
  if (/SOT-223/.test(fp)) return { w: 7, h: 3.5 };
  if (/SOT-23/.test(fp)) return { w: 3, h: 1.5 };
  if (/TO-252|DPAK/.test(fp)) return { w: 7, h: 6.5 };

  // Connectors
  if (ref.startsWith('J')) return { w: 8, h: 5 };

  // Passives by reference prefix
  if (/0201/.test(fp)) return { w: 1.0, h: 0.5 };
  if (/0402/.test(fp)) return { w: 1.4, h: 0.8 };
  if (/0603/.test(fp)) return { w: 2.0, h: 1.2 };
  if (/0805/.test(fp)) return { w: 2.6, h: 1.6 };
  if (/1206/.test(fp)) return { w: 3.6, h: 2.0 };

  // Generic by ref
  if (ref.startsWith('U')) return { w: 8, h: 8 };
  if (ref.startsWith('R') || ref.startsWith('C')) return { w: 2.0, h: 1.2 };
  if (ref.startsWith('L')) return { w: 3, h: 3 };
  if (ref.startsWith('D')) return { w: 2, h: 1.5 };
  if (ref.startsWith('Y') || ref.startsWith('X')) return { w: 4, h: 2 };
  if (ref.startsWith('LED')) return { w: 2, h: 1.5 };
  if (ref.startsWith('SW') || ref.startsWith('BZ')) return { w: 4, h: 4 };

  return { w: 3, h: 2 };
}

// ─── Grid snap ───────────────────────────────────────────────────────────────

const GRID_SNAP = 0.5; // mm

function snap(v: number): number {
  return Math.round(v / GRID_SNAP) * GRID_SNAP;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ─── Pseudo-random with seed for reproducibility ─────────────────────────────

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
    return (s >>> 0) / 0xFFFFFFFF;
  };
}

// ─── Default zone region layout ──────────────────────────────────────────────
// Assigns preferred regions on the board to each zone type if not provided.

function assignDefaultRegions(
  zones: ZoneDefinition[],
  boardW: number,
  boardH: number,
): ZoneDefinition[] {
  const margin = 2;
  const usableW = boardW - margin * 2;
  const usableH = boardH - margin * 2;

  // Count how many non-CONNECTOR zones we have
  const internalZones = zones.filter(z => z.type !== 'CONNECTOR');
  const connectorZone = zones.find(z => z.type === 'CONNECTOR');

  // Build a layout: split board into quadrants/regions based on zone type
  const regionMap: Record<ZoneType, { x: number; y: number; w: number; h: number }> = {
    POWER: {
      x: margin,
      y: margin,
      w: usableW * 0.35,
      h: usableH * 0.5,
    },
    DIGITAL: {
      x: margin + usableW * 0.3,
      y: margin + usableH * 0.15,
      w: usableW * 0.45,
      h: usableH * 0.55,
    },
    ANALOG: {
      x: margin + usableW * 0.65,
      y: margin,
      w: usableW * 0.35,
      h: usableH * 0.5,
    },
    CLOCK: {
      x: margin + usableW * 0.35,
      y: margin,
      w: usableW * 0.3,
      h: usableH * 0.25,
    },
    COMMUNICATION: {
      x: margin + usableW * 0.5,
      y: margin + usableH * 0.55,
      w: usableW * 0.5,
      h: usableH * 0.45,
    },
    UI: {
      x: margin,
      y: margin + usableH * 0.65,
      w: usableW * 0.4,
      h: usableH * 0.35,
    },
    CONNECTOR: {
      // Connectors get the full board perimeter, but prefer edges
      x: margin,
      y: margin,
      w: usableW,
      h: usableH,
    },
  };

  return zones.map(z => ({
    ...z,
    preferredRegion: z.preferredRegion || regionMap[z.type] || {
      x: margin,
      y: margin,
      w: usableW,
      h: usableH,
    },
  }));
}

// ─── Cost Function ───────────────────────────────────────────────────────────

const WEIGHT_OVERLAP = 5000;
const WEIGHT_ZONE_VIOLATION = 200;
const WEIGHT_CRITICAL_PAIR = 150;
const WEIGHT_EDGE_CLEARANCE = 100;
const WEIGHT_WIRELENGTH = 1;
const WEIGHT_CONNECTOR_EDGE = 80;
const WEIGHT_THERMAL = 120;

// ─── Thermal classification patterns ────────────────────────────────────────

const HIGH_POWER_PATTERN = /regulator|ldo|buck|boost|motor|driver/i;
const HIGH_POWER_MOSFET_PATTERN = /mosfet|power/i;
const HEAT_SENSITIVE_PATTERN = /adc|dac|opamp|op-amp|reference|precision|sensor|crystal|xtal/i;

function isHighPowerComponent(ref: string, comp: BrdComponent): boolean {
  const type = comp.value || '';
  if (ref.startsWith('U') && HIGH_POWER_PATTERN.test(type)) return true;
  if (ref.startsWith('Q') && HIGH_POWER_MOSFET_PATTERN.test(type)) return true;
  return false;
}

function isHeatSensitiveComponent(comp: BrdComponent): boolean {
  const type = comp.value || '';
  return HEAT_SENSITIVE_PATTERN.test(type);
}

// ─── Thermal cost function ──────────────────────────────────────────────────
// Penalizes: high-power near sensitive, high-power away from edges, high-power clustering

function thermalCost(
  placements: ComponentPlacement[],
  components: BrdComponent[],
  boardWidth: number,
  boardHeight: number,
): number {
  let cost = 0;

  // Build component lookup by ref
  const compByRef = new Map<string, BrdComponent>();
  for (const c of components) compByRef.set(c.ref, c);

  // Classify placements
  const highPower: ComponentPlacement[] = [];
  const sensitive: ComponentPlacement[] = [];

  for (const p of placements) {
    const comp = compByRef.get(p.ref);
    if (!comp) continue;
    if (isHighPowerComponent(p.ref, comp)) highPower.push(p);
    if (isHeatSensitiveComponent(comp)) sensitive.push(p);
  }

  // (a) Penalize high-power components too close to sensitive components (< 5mm)
  const THERMAL_PENALTY_ZONE = 5; // mm
  for (const hp of highPower) {
    for (const s of sensitive) {
      const dist = Math.hypot(hp.x - s.x, hp.y - s.y);
      if (dist < THERMAL_PENALTY_ZONE) {
        // Stronger penalty the closer they are
        cost += WEIGHT_THERMAL * (THERMAL_PENALTY_ZONE - dist);
      }
    }
  }

  // (b) Reward high-power components near board edges (better heat dissipation)
  for (const hp of highPower) {
    const edgeDist = Math.min(hp.x, hp.y, boardWidth - hp.x, boardHeight - hp.y);
    // Reward for being within 8mm of an edge, penalize for being far from all edges
    const EDGE_THRESHOLD = 8;
    if (edgeDist > EDGE_THRESHOLD) {
      cost += WEIGHT_THERMAL * 0.5 * (edgeDist - EDGE_THRESHOLD);
    } else {
      cost -= WEIGHT_THERMAL * 0.3 * (EDGE_THRESHOLD - edgeDist);
    }
  }

  // (c) Penalize clustering of multiple high-power components (spread them out)
  const MIN_HP_SPACING = 8; // mm - minimum desired spacing between high-power components
  for (let i = 0; i < highPower.length; i++) {
    for (let j = i + 1; j < highPower.length; j++) {
      const dist = Math.hypot(highPower[i].x - highPower[j].x, highPower[i].y - highPower[j].y);
      if (dist < MIN_HP_SPACING) {
        cost += WEIGHT_THERMAL * 0.8 * (MIN_HP_SPACING - dist);
      }
    }
  }

  return cost;
}

function calculateCost(
  placements: ComponentPlacement[],
  constraints: PlacementConstraint,
  netConnections: Map<string, string[]>, // netName -> refs
  components?: BrdComponent[],
): number {
  let cost = 0;
  const { boardWidth, boardHeight, zones, criticalPairs } = constraints;
  const edgeMin = 1.5; // mm minimum from board edge

  // Build lookup
  const byRef = new Map<string, ComponentPlacement>();
  for (const p of placements) byRef.set(p.ref, p);

  // Zone preferred region map
  const refToZone = new Map<string, ZoneDefinition>();
  for (const z of zones) {
    for (const ref of z.componentRefs) {
      refToZone.set(ref, z);
    }
  }

  // 1. Overlap penalty (huge)
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i];
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j];
      // Axis-aligned bounding box overlap
      const overlapX = Math.max(0,
        Math.min(a.x + a.width / 2, b.x + b.width / 2) -
        Math.max(a.x - a.width / 2, b.x - b.width / 2)
      );
      const overlapY = Math.max(0,
        Math.min(a.y + a.height / 2, b.y + b.height / 2) -
        Math.max(a.y - a.height / 2, b.y - b.height / 2)
      );
      if (overlapX > 0 && overlapY > 0) {
        const overlapArea = overlapX * overlapY;
        cost += WEIGHT_OVERLAP * overlapArea;
      }
      // Even non-overlapping: penalize if center-to-center distance < sum of half-sizes + clearance
      const minDist = (a.width + b.width) / 2 + 0.5;
      const minDistY = (a.height + b.height) / 2 + 0.5;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < minDist && dy < minDistY) {
        const penalty = (minDist - dx) + (minDistY - dy);
        cost += WEIGHT_OVERLAP * 0.5 * penalty;
      }
    }
  }

  // 2. Zone containment penalty
  for (const p of placements) {
    const zone = refToZone.get(p.ref);
    if (zone?.preferredRegion) {
      const r = zone.preferredRegion;
      // Distance from component center to zone center
      const zCx = r.x + r.w / 2;
      const zCy = r.y + r.h / 2;
      // Check if component is inside zone
      const halfW = p.width / 2;
      const halfH = p.height / 2;
      const outsideX = Math.max(0, (p.x - halfW) - (r.x + r.w)) + Math.max(0, r.x - (p.x + halfW));
      const outsideY = Math.max(0, (p.y - halfH) - (r.y + r.h)) + Math.max(0, r.y - (p.y + halfH));
      if (outsideX > 0 || outsideY > 0) {
        cost += WEIGHT_ZONE_VIOLATION * (outsideX + outsideY);
      }
    }
  }

  // 3. Critical pair distance penalty
  for (const pair of criticalPairs) {
    const a = byRef.get(pair.refA);
    const b = byRef.get(pair.refB);
    if (a && b) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > pair.maxDistance) {
        cost += WEIGHT_CRITICAL_PAIR * (dist - pair.maxDistance);
      }
    }
  }

  // 4. Edge clearance penalty
  for (const p of placements) {
    const halfW = p.width / 2;
    const halfH = p.height / 2;
    const leftClear = p.x - halfW;
    const rightClear = boardWidth - (p.x + halfW);
    const topClear = p.y - halfH;
    const bottomClear = boardHeight - (p.y + halfH);

    if (leftClear < edgeMin) cost += WEIGHT_EDGE_CLEARANCE * (edgeMin - leftClear);
    if (rightClear < edgeMin) cost += WEIGHT_EDGE_CLEARANCE * (edgeMin - rightClear);
    if (topClear < edgeMin) cost += WEIGHT_EDGE_CLEARANCE * (edgeMin - topClear);
    if (bottomClear < edgeMin) cost += WEIGHT_EDGE_CLEARANCE * (edgeMin - bottomClear);

    // Out of bounds: extreme penalty
    if (leftClear < 0 || rightClear < 0 || topClear < 0 || bottomClear < 0) {
      cost += WEIGHT_OVERLAP * 10;
    }
  }

  // 5. Connector-at-edge bonus (negative cost = reward)
  for (const p of placements) {
    if (p.ref.startsWith('J')) {
      const edgeDist = Math.min(
        p.x, p.y, boardWidth - p.x, boardHeight - p.y
      );
      if (edgeDist > 5) {
        cost += WEIGHT_CONNECTOR_EDGE * (edgeDist - 5);
      } else {
        // Reward for being near edge
        cost -= WEIGHT_CONNECTOR_EDGE * (5 - edgeDist) * 0.5;
      }
    }
  }

  // 6. Wire length (HPWL - Half Perimeter Wire Length)
  for (const [, refs] of netConnections) {
    if (refs.length < 2) continue;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let validCount = 0;
    for (const ref of refs) {
      const p = byRef.get(ref);
      if (p) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        validCount++;
      }
    }
    if (validCount >= 2) {
      cost += WEIGHT_WIRELENGTH * ((maxX - minX) + (maxY - minY));
    }
  }

  // 7. Thermal cost (only when thermalOptimize is enabled and components are provided)
  if (constraints.thermalOptimize && components) {
    cost += thermalCost(placements, components, boardWidth, boardHeight);
  }

  return cost;
}

// ─── Build net connection map ────────────────────────────────────────────────
// Maps net names to the component refs that are connected by that net.

function buildNetConnections(
  components: BrdComponent[],
): Map<string, string[]> {
  const netToRefs = new Map<string, Set<string>>();

  for (const comp of components) {
    for (const pad of comp.pads) {
      if (pad.netId) {
        if (!netToRefs.has(pad.netId)) {
          netToRefs.set(pad.netId, new Set());
        }
        const refs = netToRefs.get(pad.netId);
        if (refs) refs.add(comp.ref);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [net, refs] of netToRefs) {
    result.set(net, Array.from(refs));
  }
  return result;
}

// ─── Simulated Annealing Solver ──────────────────────────────────────────────

export interface PlacementSolverOptions {
  initialTemperature?: number;
  coolingRate?: number;
  iterationsPerTemp?: number;
  seed?: number;
}

export interface PlacementResult {
  components: BrdComponent[];
  finalCost: number;
  iterations: number;
  improvement: number; // percentage improvement from initial placement
}

/**
 * Simulated Annealing placement solver.
 * Pure math, no LLM. Produces optimal positions.
 *
 * Algorithm:
 * 1. Initialize: place components in zone centers
 * 2. Simulated annealing loop:
 *    - Pick random component
 *    - Try random move (within zone bounds)
 *    - Calculate cost: wire length + overlap penalty + critical pair penalty + edge penalty
 *    - Accept/reject based on temperature (Boltzmann acceptance)
 * 3. Cool down temperature
 * 4. Return optimized positions
 */
export function solvePlacement(
  components: BrdComponent[],
  constraints: PlacementConstraint,
  options?: PlacementSolverOptions,
): PlacementResult {
  const {
    initialTemperature = 1000,
    coolingRate = 0.995,
    iterationsPerTemp = 100,
    seed = 42,
  } = options || {};

  const rng = createRng(seed);
  const { boardWidth, boardHeight } = constraints;

  // Assign default zone regions if not provided
  const zonesWithRegions = assignDefaultRegions(constraints.zones, boardWidth, boardHeight);
  const constraintsWithRegions: PlacementConstraint = {
    ...constraints,
    zones: zonesWithRegions,
  };

  // Build ref -> zone lookup
  const refToZone = new Map<string, ZoneDefinition>();
  for (const z of zonesWithRegions) {
    for (const ref of z.componentRefs) {
      refToZone.set(ref, z);
    }
  }

  // Net connections for HPWL calculation
  const netConnections = buildNetConnections(components);

  // Initialize placements: place components at zone center with jitter
  const placements: ComponentPlacement[] = components.map(comp => {
    const size = estimateComponentSize(comp);
    const zone = refToZone.get(comp.ref);
    let x: number, y: number;

    if (zone?.preferredRegion) {
      const r = zone.preferredRegion;
      // Place at zone center with some random jitter
      x = snap(r.x + r.w * (0.2 + rng() * 0.6));
      y = snap(r.y + r.h * (0.2 + rng() * 0.6));
    } else {
      // No zone: place in center of board with jitter
      x = snap(boardWidth * (0.2 + rng() * 0.6));
      y = snap(boardHeight * (0.2 + rng() * 0.6));
    }

    // Clamp to board
    x = clamp(x, size.w / 2 + 1.5, boardWidth - size.w / 2 - 1.5);
    y = clamp(y, size.h / 2 + 1.5, boardHeight - size.h / 2 - 1.5);

    return {
      ref: comp.ref,
      x: snap(x),
      y: snap(y),
      rotation: comp.rotation,
      layer: comp.layer || 'F.Cu',
      width: size.w,
      height: size.h,
      zoneType: zone?.type || null,
    };
  });

  // Calculate initial cost
  let currentCost = calculateCost(placements, constraintsWithRegions, netConnections, components);
  const initialCost = currentCost;
  let bestCost = currentCost;
  const bestPlacements = placements.map(p => ({ ...p }));

  // Simulated annealing main loop
  let temperature = initialTemperature;
  let totalIterations = 0;
  const minTemperature = 0.1;

  while (temperature > minTemperature) {
    for (let iter = 0; iter < iterationsPerTemp; iter++) {
      totalIterations++;

      // Pick a random component
      const idx = Math.floor(rng() * placements.length);
      const comp = placements[idx];

      // Save old position
      const oldX = comp.x;
      const oldY = comp.y;
      const oldRot = comp.rotation;

      // Generate move: displacement proportional to temperature
      const moveScale = (temperature / initialTemperature) * Math.min(boardWidth, boardHeight) * 0.3;
      let newX = snap(comp.x + (rng() - 0.5) * 2 * moveScale);
      let newY = snap(comp.y + (rng() - 0.5) * 2 * moveScale);

      // Occasionally try rotation (10% chance)
      let newRot = comp.rotation;
      if (rng() < 0.1) {
        newRot = [0, 90, 180, 270][Math.floor(rng() * 4)];
        // Swap width/height for 90/270 degree rotation changes
        if ((newRot % 180 !== 0) !== (comp.rotation % 180 !== 0)) {
          const tmp = comp.width;
          comp.width = comp.height;
          comp.height = tmp;
        }
      }

      // Clamp to board bounds
      newX = clamp(newX, comp.width / 2 + 1.5, boardWidth - comp.width / 2 - 1.5);
      newY = clamp(newY, comp.height / 2 + 1.5, boardHeight - comp.height / 2 - 1.5);

      // Apply move
      comp.x = newX;
      comp.y = newY;
      comp.rotation = newRot;

      // Calculate new cost
      const newCost = calculateCost(placements, constraintsWithRegions, netConnections, components);
      const deltaCost = newCost - currentCost;

      // Accept or reject (Boltzmann criterion)
      if (deltaCost < 0 || (temperature > 0.001 && rng() < Math.exp(-deltaCost / Math.max(temperature, 0.001)))) {
        // Accept
        currentCost = newCost;
        if (currentCost < bestCost) {
          bestCost = currentCost;
          for (let i = 0; i < placements.length; i++) {
            bestPlacements[i] = { ...placements[i] };
          }
        }
      } else {
        // Reject: revert
        comp.x = oldX;
        comp.y = oldY;
        if (comp.rotation !== oldRot) {
          // Swap back width/height if we changed rotation
          if ((comp.rotation % 180 !== 0) !== (oldRot % 180 !== 0)) {
            const tmp = comp.width;
            comp.width = comp.height;
            comp.height = tmp;
          }
          comp.rotation = oldRot;
        }
      }
    }

    // Cool down
    temperature *= coolingRate;
  }

  // Apply best solution back to components
  const result: BrdComponent[] = components.map(comp => {
    const best = bestPlacements.find(p => p.ref === comp.ref);
    if (best) {
      return {
        ...comp,
        x: best.x,
        y: best.y,
        rotation: best.rotation,
        layer: best.layer,
      };
    }
    return comp;
  });

  const improvement = initialCost > 0
    ? ((initialCost - bestCost) / initialCost) * 100
    : 0;

  return {
    components: result,
    finalCost: bestCost,
    iterations: totalIterations,
    improvement: Math.max(0, improvement),
  };
}

// ─── Constraint builder helpers ──────────────────────────────────────────────
// These help convert from the wizard's functional blocks into solver constraints.

export interface FunctionalBlockInput {
  name: string;
  type: string;
  components: string[];
}

/**
 * Build placement constraints from functional blocks and schematic data.
 * This is the bridge between LLM-generated zone classification and the solver.
 */
export function buildConstraintsFromBlocks(
  blocks: FunctionalBlockInput[],
  components: BrdComponent[],
  boardWidth: number,
  boardHeight: number,
): PlacementConstraint {
  // Map block types to zone types
  const typeMap: Record<string, ZoneType> = {
    power: 'POWER',
    digital: 'DIGITAL',
    analog: 'ANALOG',
    communication: 'COMMUNICATION',
    ui: 'UI',
    mechanical: 'DIGITAL', // fallback
  };

  const zones: ZoneDefinition[] = blocks.map(block => ({
    type: typeMap[block.type] || 'DIGITAL',
    componentRefs: block.components,
  }));

  // Auto-detect critical pairs from net connections
  const criticalPairs: CriticalPairConstraint[] = [];

  // Find decoupling caps: caps connected to the same power net as an IC
  const ics = components.filter(c =>
    c.ref.startsWith('U') || /QFP|BGA|QFN|LQFP|TSSOP|SOIC/i.test(c.footprint)
  );
  const caps = components.filter(c => c.ref.startsWith('C'));

  for (const ic of ics) {
    const icPowerNets = new Set<string>();
    for (const pad of ic.pads) {
      if (pad.netId && /VCC|VDD|3V3|5V|AVCC|DVCC/i.test(pad.netId)) {
        icPowerNets.add(pad.netId);
      }
    }
    for (const cap of caps) {
      const capNets = cap.pads.map(p => p.netId).filter(Boolean);
      if (capNets.some(n => icPowerNets.has(n!))) {
        criticalPairs.push({
          refA: ic.ref,
          refB: cap.ref,
          maxDistance: 3,
          reason: `Decoupling cap ${cap.ref} must be within 3mm of ${ic.ref}`,
        });
      }
    }
  }

  // Crystal close to MCU
  const crystals = components.filter(c =>
    c.ref.startsWith('Y') || c.ref.startsWith('X')
  );
  for (const xtal of crystals) {
    // Find the IC it connects to
    const xtalNets = new Set(xtal.pads.map(p => p.netId).filter(Boolean));
    for (const ic of ics) {
      const icNets = new Set(ic.pads.map(p => p.netId).filter(Boolean));
      const shared = [...xtalNets].filter(n => icNets.has(n!));
      if (shared.length > 0) {
        criticalPairs.push({
          refA: ic.ref,
          refB: xtal.ref,
          maxDistance: 5,
          reason: `Crystal ${xtal.ref} must be close to ${ic.ref} for short oscillator traces`,
        });
        break;
      }
    }
  }

  return {
    zones,
    criticalPairs,
    boardWidth,
    boardHeight,
  };
}
