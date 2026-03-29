// ─── routingSolver.ts ── Rule-based routing constraint generator ──────────────
// Pure pattern-matching engine: analyzes nets and generates routing constraints.
// NO LLM. Detects net types from naming conventions and component connections.

import type { SchNet, SchComponent, BoardState, BrdTrace, BrdPad, Point } from '../types';

// ─── Constraint Types ────────────────────────────────────────────────────────

export type NetType = 'power' | 'ground' | 'differential' | 'clock' | 'high-speed' | 'analog' | 'i2c' | 'spi' | 'uart' | 'can' | 'signal';

export interface NetPriority {
  netId: string;
  netName: string;
  type: NetType;
  priority: number;
  layer: string;
  width: number;
  reasoning: string;
}

export interface LayerRule {
  layerName: string;
  purpose: string;
  preferredDirection: 'horizontal' | 'vertical' | 'any';
}

export interface ImpedanceTarget {
  netPattern: string;
  netNames: string[];
  targetImpedance: number;
  traceWidth: number;
  spacing: number;
  protocol: string;
}

export interface LengthMatchGroup {
  groupName: string;
  netNames: string[];
  maxSkew: number; // mm
  reason: string;
}

export interface RoutingConstraints {
  netPriorities: NetPriority[];
  layerAssignment: LayerRule[];
  impedanceTargets: ImpedanceTarget[];
  lengthMatchGroups: LengthMatchGroup[];
  generalNotes: string[];
}

// ─── Net type detection patterns ─────────────────────────────────────────────

interface NetPattern {
  pattern: RegExp;
  type: NetType;
  priority: number;
  width: number;
  reasoning: string;
}

const NET_PATTERNS: NetPattern[] = [
  // Ground nets - highest priority, use ground plane
  {
    pattern: /^GND$|^AGND$|^DGND$|^PGND$|^GNDA$|^GNDD$|^VSS$/i,
    type: 'ground',
    priority: 1,
    width: 0.5,
    reasoning: 'Ground net - use ground plane for lowest impedance return path',
  },
  // Power supply rails
  {
    pattern: /^VCC|^VDD|^3V3|^\+3\.3V|^5V$|^\+5V|^12V$|^\+12V|^VBUS$|^VIN$|^VOUT|^VBAT|^VSYS/i,
    type: 'power',
    priority: 2,
    width: 0.5,
    reasoning: 'Power rail - use wider traces for current capacity, consider power plane',
  },
  // USB differential pairs
  {
    pattern: /USB.*D\+|USB.*D-|USB.*DP|USB.*DN|USB.*P$|USB.*N$|DP$|DM$|D\+$|D-$/i,
    type: 'differential',
    priority: 3,
    width: 0.18,
    reasoning: 'USB differential pair - 90 ohm impedance, matched length, minimize layer transitions',
  },
  // Ethernet differential pairs
  {
    pattern: /ETH.*TX|ETH.*RX|ETH.*T\+|ETH.*T-|ETH.*R\+|ETH.*R-|RMII|MII_TX|MII_RX/i,
    type: 'differential',
    priority: 3,
    width: 0.15,
    reasoning: 'Ethernet differential pair - 100 ohm impedance, matched length per pair',
  },
  // LVDS / HDMI
  {
    pattern: /LVDS|HDMI.*D|HDMI.*CLK/i,
    type: 'differential',
    priority: 3,
    width: 0.15,
    reasoning: 'High-speed differential - controlled impedance, length matching required',
  },
  // Clock signals
  {
    pattern: /^CLK|^MCLK|^XTAL|^OSC|_CLK$|_CLOCK$|HCLK|PCLK|SYSCLK/i,
    type: 'clock',
    priority: 4,
    width: 0.2,
    reasoning: 'Clock signal - keep short, avoid vias, series termination recommended',
  },
  // SPI bus
  {
    pattern: /^SPI|^SCLK$|^MOSI$|^MISO$|^SCK$|^SDO$|^SDI$|_SCLK$|_MOSI$|_MISO$|^QSPI/i,
    type: 'spi',
    priority: 5,
    width: 0.2,
    reasoning: 'SPI bus signal - match group lengths within 2mm, maintain reference plane',
  },
  // SDIO
  {
    pattern: /^SDIO|^SD_|^SD[0-9]|SDIO_CLK|SDIO_CMD|SDIO_D[0-9]/i,
    type: 'high-speed',
    priority: 5,
    width: 0.2,
    reasoning: 'SDIO bus - match group lengths, controlled impedance for high-speed modes',
  },
  // I2C bus
  {
    pattern: /^SDA$|^SCL$|^I2C|_SDA$|_SCL$/i,
    type: 'i2c',
    priority: 6,
    width: 0.2,
    reasoning: 'I2C bus - ensure pull-ups present, keep total bus capacitance low',
  },
  // UART
  {
    pattern: /^TX$|^RX$|^UART|_TX$|_RX$|^TXD$|^RXD$/i,
    type: 'uart',
    priority: 7,
    width: 0.2,
    reasoning: 'UART signal - standard routing, keep reasonable length',
  },
  // CAN bus
  {
    pattern: /^CAN|^CANH$|^CANL$|_CANH$|_CANL$/i,
    type: 'can',
    priority: 6,
    width: 0.2,
    reasoning: 'CAN bus - differential pair, 120 ohm termination at both ends',
  },
  // Analog signals
  {
    pattern: /^ADC|^AIN|^AREF|^SENSE|^VREF|^DAC|_ADC|_AIN|_SENSE/i,
    type: 'analog',
    priority: 5,
    width: 0.2,
    reasoning: 'Sensitive analog signal - guard ring recommended, keep away from digital noise',
  },
  // Debug (SWD/JTAG)
  {
    pattern: /^SWCLK$|^SWDIO$|^SWO$|^JTAG|^TMS$|^TCK$|^TDI$|^TDO$|^NRST$|^RESET$/i,
    type: 'signal',
    priority: 8,
    width: 0.2,
    reasoning: 'Debug/reset signal - standard routing, keep accessible for debug connector',
  },
];

// ─── Detect net type ─────────────────────────────────────────────────────────

function detectNetType(netName: string): NetPattern | null {
  for (const p of NET_PATTERNS) {
    if (p.pattern.test(netName)) {
      return p;
    }
  }
  return null;
}

// ─── Generate layer assignment ───────────────────────────────────────────────

function generateLayerAssignment(layerCount: number): LayerRule[] {
  if (layerCount <= 2) {
    return [
      { layerName: 'F.Cu', purpose: 'Signal routing (horizontal preferred)', preferredDirection: 'horizontal' },
      { layerName: 'B.Cu', purpose: 'Ground plane + vertical signal routing', preferredDirection: 'vertical' },
    ];
  }
  if (layerCount === 4) {
    return [
      { layerName: 'F.Cu', purpose: 'Signal routing (horizontal preferred)', preferredDirection: 'horizontal' },
      { layerName: 'In1.Cu', purpose: 'Ground plane (GND) - reference plane', preferredDirection: 'any' },
      { layerName: 'In2.Cu', purpose: 'Power plane (VCC/3V3)', preferredDirection: 'any' },
      { layerName: 'B.Cu', purpose: 'Signal routing (vertical preferred)', preferredDirection: 'vertical' },
    ];
  }
  // 6+ layers
  return [
    { layerName: 'F.Cu', purpose: 'Signal routing', preferredDirection: 'horizontal' },
    { layerName: 'In1.Cu', purpose: 'Ground plane (GND)', preferredDirection: 'any' },
    { layerName: 'In2.Cu', purpose: 'Inner signal routing', preferredDirection: 'vertical' },
    { layerName: 'In3.Cu', purpose: 'Power plane (VCC)', preferredDirection: 'any' },
    { layerName: 'In4.Cu', purpose: 'Ground plane (GND)', preferredDirection: 'any' },
    { layerName: 'B.Cu', purpose: 'Signal routing', preferredDirection: 'horizontal' },
  ];
}

// ─── Detect differential pairs ───────────────────────────────────────────────

function findDifferentialPairs(nets: SchNet[]): LengthMatchGroup[] {
  const groups: LengthMatchGroup[] = [];
  const matched = new Set<string>();

  for (const net of nets) {
    if (matched.has(net.id)) continue;

    // USB D+/D-
    if (/USB.*D\+|USB.*DP|^DP$|^D\+$/i.test(net.name)) {
      const complement = nets.find(n =>
        !matched.has(n.id) && /USB.*D-|USB.*DN|^DM$|^D-$/i.test(n.name)
      );
      if (complement) {
        groups.push({
          groupName: 'USB Data Pair',
          netNames: [net.name, complement.name],
          maxSkew: 0.15,
          reason: 'USB 2.0 differential pair - max 0.15mm length skew',
        });
        matched.add(net.id);
        matched.add(complement.id);
      }
    }

    // Ethernet TX+/TX-
    if (/ETH.*TX\+|ETH.*T\+/i.test(net.name)) {
      const complement = nets.find(n =>
        !matched.has(n.id) && /ETH.*TX-|ETH.*T-/i.test(n.name)
      );
      if (complement) {
        groups.push({
          groupName: 'Ethernet TX Pair',
          netNames: [net.name, complement.name],
          maxSkew: 0.1,
          reason: 'Ethernet TX differential pair - max 0.1mm length skew',
        });
        matched.add(net.id);
        matched.add(complement.id);
      }
    }

    // Ethernet RX+/RX-
    if (/ETH.*RX\+|ETH.*R\+/i.test(net.name)) {
      const complement = nets.find(n =>
        !matched.has(n.id) && /ETH.*RX-|ETH.*R-/i.test(n.name)
      );
      if (complement) {
        groups.push({
          groupName: 'Ethernet RX Pair',
          netNames: [net.name, complement.name],
          maxSkew: 0.1,
          reason: 'Ethernet RX differential pair - max 0.1mm length skew',
        });
        matched.add(net.id);
        matched.add(complement.id);
      }
    }

    // CAN H/L
    if (/CANH|CAN_H/i.test(net.name)) {
      const complement = nets.find(n =>
        !matched.has(n.id) && /CANL|CAN_L/i.test(n.name)
      );
      if (complement) {
        groups.push({
          groupName: 'CAN Bus Pair',
          netNames: [net.name, complement.name],
          maxSkew: 0.5,
          reason: 'CAN differential pair - max 0.5mm skew, 120 ohm termination',
        });
        matched.add(net.id);
        matched.add(complement.id);
      }
    }
  }

  // SPI length match group (not differential, but length-matched)
  const spiNets = nets.filter(n =>
    /^SCLK$|^MOSI$|^MISO$|^SCK$|SPI.*CLK|SPI.*MOSI|SPI.*MISO/i.test(n.name)
  );
  if (spiNets.length >= 2) {
    groups.push({
      groupName: 'SPI Bus Group',
      netNames: spiNets.map(n => n.name),
      maxSkew: 2.0,
      reason: 'SPI bus signals should be length-matched within 2mm for high-speed operation',
    });
  }

  return groups;
}

// ─── Detect impedance targets ────────────────────────────────────────────────

function findImpedanceTargets(nets: SchNet[]): ImpedanceTarget[] {
  const targets: ImpedanceTarget[] = [];
  const usbNets = nets.filter(n =>
    /USB.*D\+|USB.*D-|USB.*DP|USB.*DN|^DP$|^DM$|^D\+$|^D-$/i.test(n.name)
  );
  if (usbNets.length > 0) {
    targets.push({
      netPattern: 'USB_D+/D-',
      netNames: usbNets.map(n => n.name),
      targetImpedance: 90,
      traceWidth: 0.18,
      spacing: 0.15,
      protocol: 'USB 2.0',
    });
  }

  const ethNets = nets.filter(n =>
    /ETH.*TX|ETH.*RX|ETH.*T\+|ETH.*T-|ETH.*R\+|ETH.*R-/i.test(n.name)
  );
  if (ethNets.length > 0) {
    targets.push({
      netPattern: 'Ethernet TX/RX',
      netNames: ethNets.map(n => n.name),
      targetImpedance: 100,
      traceWidth: 0.15,
      spacing: 0.18,
      protocol: 'Ethernet 100BASE-TX',
    });
  }

  const lvdsNets = nets.filter(n => /LVDS/i.test(n.name));
  if (lvdsNets.length > 0) {
    targets.push({
      netPattern: 'LVDS',
      netNames: lvdsNets.map(n => n.name),
      targetImpedance: 100,
      traceWidth: 0.12,
      spacing: 0.15,
      protocol: 'LVDS',
    });
  }

  const canNets = nets.filter(n => /CANH|CANL|CAN_H|CAN_L/i.test(n.name));
  if (canNets.length > 0) {
    targets.push({
      netPattern: 'CAN Bus',
      netNames: canNets.map(n => n.name),
      targetImpedance: 120,
      traceWidth: 0.2,
      spacing: 0.2,
      protocol: 'CAN 2.0',
    });
  }

  return targets;
}

// ─── Main: Generate Routing Constraints ──────────────────────────────────────

/**
 * Analyze nets and generate routing constraints.
 * Uses pattern matching (not LLM) to identify net types.
 * Produces a prioritized routing order with per-net rules.
 */
export function generateRoutingConstraints(
  nets: SchNet[],
  components: SchComponent[],
  layerCount: number = 2,
): RoutingConstraints {
  // 1. Classify each net
  const netPriorities: NetPriority[] = [];
  let priorityCounter = 1;

  // First pass: classify known net types (these get sorted by their inherent priority)
  const classified: { net: SchNet; pattern: NetPattern }[] = [];
  const unclassified: SchNet[] = [];

  for (const net of nets) {
    const pattern = detectNetType(net.name);
    if (pattern) {
      classified.push({ net, pattern });
    } else {
      unclassified.push(net);
    }
  }

  // Sort classified nets by priority (lower number = higher priority)
  classified.sort((a, b) => a.pattern.priority - b.pattern.priority);

  // Assign final priority numbers
  for (const { net, pattern } of classified) {
    // Determine layer based on type and layer count
    let layer = 'F.Cu';
    if (pattern.type === 'ground') {
      layer = layerCount >= 4 ? 'In1.Cu' : 'B.Cu';
    } else if (pattern.type === 'power') {
      layer = layerCount >= 4 ? 'In2.Cu' : 'F.Cu';
    }

    // Adjust width for high-current power nets
    let width = pattern.width;
    if (pattern.type === 'power' && net.pins && net.pins.length > 4) {
      width = Math.max(width, 0.5);
    }

    netPriorities.push({
      netId: net.id,
      netName: net.name,
      type: pattern.type,
      priority: priorityCounter++,
      layer,
      width,
      reasoning: pattern.reasoning,
    });
  }

  // Unclassified nets get default signal priority
  for (const net of unclassified) {
    netPriorities.push({
      netId: net.id,
      netName: net.name,
      type: 'signal',
      priority: priorityCounter++,
      layer: 'F.Cu',
      width: 0.2,
      reasoning: 'General signal - standard routing rules apply',
    });
  }

  // 2. Layer assignment
  const layerAssignment = generateLayerAssignment(layerCount);

  // 3. Impedance targets
  const impedanceTargets = findImpedanceTargets(nets);

  // 4. Length match groups
  const lengthMatchGroups = findDifferentialPairs(nets);

  // 5. Generate general routing notes
  const generalNotes: string[] = [
    'Route power and ground first for clean reference planes',
    'Use 45-degree bends, avoid 90-degree corners on signal traces',
    'Add ground stitching vias near signal vias for return path continuity',
    'Minimize via count on high-speed nets',
  ];

  if (impedanceTargets.some(t => t.protocol === 'USB 2.0')) {
    generalNotes.push('Route USB differential pair with matched length, max 0.15mm skew');
  }
  if (impedanceTargets.some(t => t.protocol.includes('Ethernet'))) {
    generalNotes.push('Route Ethernet pairs with matched length, max 0.1mm skew per pair');
  }
  if (netPriorities.some(n => n.type === 'clock')) {
    generalNotes.push('Keep crystal/clock traces under 5mm total length, avoid vias');
  }
  if (netPriorities.some(n => n.type === 'analog')) {
    generalNotes.push('Route analog signals away from switching regulators and digital clock lines');
  }
  if (netPriorities.some(n => n.type === 'i2c')) {
    generalNotes.push('Ensure I2C pull-up resistors are present, keep bus capacitance under 400pF');
  }
  if (layerCount >= 4) {
    generalNotes.push('Maintain continuous ground plane on inner layer - avoid splits under high-speed traces');
  }

  return {
    netPriorities,
    layerAssignment,
    impedanceTargets,
    lengthMatchGroups,
    generalNotes,
  };
}

// ─── Explanation generator (for UI display) ──────────────────────────────────
// Generates human-readable explanations of why constraints were set.
// This replaces LLM explanation - it is deterministic and domain-accurate.

export function explainConstraints(constraints: RoutingConstraints): string {
  const lines: string[] = [];

  // Summarize by net type
  const typeCounts = new Map<NetType, number>();
  for (const np of constraints.netPriorities) {
    typeCounts.set(np.type, (typeCounts.get(np.type) || 0) + 1);
  }

  lines.push(`Analyzed ${constraints.netPriorities.length} nets:`);
  const typeLabels: Record<NetType, string> = {
    ground: 'Ground',
    power: 'Power',
    differential: 'Differential Pair',
    clock: 'Clock',
    'high-speed': 'High-Speed Bus',
    analog: 'Analog',
    i2c: 'I2C',
    spi: 'SPI',
    uart: 'UART',
    can: 'CAN',
    signal: 'General Signal',
  };

  for (const [type, count] of typeCounts) {
    lines.push(`  ${count} ${typeLabels[type]} net${count > 1 ? 's' : ''}`);
  }

  if (constraints.impedanceTargets.length > 0) {
    lines.push('');
    lines.push('Impedance-controlled nets detected:');
    for (const target of constraints.impedanceTargets) {
      lines.push(`  ${target.protocol}: ${target.targetImpedance} ohm, trace width ${target.traceWidth}mm`);
    }
  }

  if (constraints.lengthMatchGroups.length > 0) {
    lines.push('');
    lines.push('Length matching required:');
    for (const group of constraints.lengthMatchGroups) {
      lines.push(`  ${group.groupName}: max ${group.maxSkew}mm skew`);
    }
  }

  return lines.join('\n');
}

// ─── A* Grid-Based Autorouter ─────────────────────────────────────────────────
// Actual pathfinding engine: creates an obstacle grid from the board state and
// uses A* search with 8-directional movement to find trace paths between pads.

const GRID_RESOLUTION = 0.25; // mm per grid cell
const MAX_ITERATIONS = 50000;
const VIA_COST_PENALTY = 50;
const TURN_90_PENALTY = 2.0;
const TURN_45_PENALTY = 0.5;
const DIAGONAL_COST = Math.SQRT2;

// 8-directional movement: dx, dy, cost
const DIRECTIONS: { dx: number; dy: number; cost: number }[] = [
  { dx: 1, dy: 0, cost: 1 },         // right
  { dx: -1, dy: 0, cost: 1 },        // left
  { dx: 0, dy: 1, cost: 1 },         // down
  { dx: 0, dy: -1, cost: 1 },        // up
  { dx: 1, dy: 1, cost: DIAGONAL_COST },   // down-right (45°)
  { dx: -1, dy: 1, cost: DIAGONAL_COST },  // down-left (45°)
  { dx: 1, dy: -1, cost: DIAGONAL_COST },  // up-right (45°)
  { dx: -1, dy: -1, cost: DIAGONAL_COST }, // up-left (45°)
];

interface GridCell {
  x: number;
  y: number;
}

interface AStarNode {
  gx: number; // grid x
  gy: number; // grid y
  g: number;  // cost from start
  f: number;  // g + heuristic
  parentKey: string | null;
  dirX: number; // direction we came from (for turn penalty)
  dirY: number;
}

function gridKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

function worldToGrid(wx: number, wy: number, originX: number, originY: number): GridCell {
  return {
    x: Math.round((wx - originX) / GRID_RESOLUTION),
    y: Math.round((wy - originY) / GRID_RESOLUTION),
  };
}

function gridToWorld(gx: number, gy: number, originX: number, originY: number): Point {
  return {
    x: originX + gx * GRID_RESOLUTION,
    y: originY + gy * GRID_RESOLUTION,
  };
}

/** Manhattan distance heuristic (admissible for 8-dir with unit cost >= 1) */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  // Octile distance: more accurate for 8-directional movement
  return Math.max(dx, dy) + (DIAGONAL_COST - 1) * Math.min(dx, dy);
}

/** Calculate turn penalty based on direction change */
function turnPenalty(prevDx: number, prevDy: number, newDx: number, newDy: number): number {
  if (prevDx === 0 && prevDy === 0) return 0; // no previous direction
  if (prevDx === newDx && prevDy === newDy) return 0; // same direction

  // Dot product to detect angle
  const dot = prevDx * newDx + prevDy * newDy;
  const magPrev = Math.sqrt(prevDx * prevDx + prevDy * prevDy);
  const magNew = Math.sqrt(newDx * newDx + newDy * newDy);
  const cosAngle = dot / (magPrev * magNew);

  if (cosAngle > 0.9) return 0;            // nearly straight
  if (cosAngle > 0.3) return TURN_45_PENALTY; // 45° turn
  if (cosAngle > -0.1) return TURN_90_PENALTY; // 90° turn
  return TURN_90_PENALTY * 1.5;              // 135° or U-turn
}

/**
 * Build an obstacle grid from the board state.
 * Returns a Set of grid keys that are blocked.
 */
function buildObstacleGrid(
  board: BoardState,
  excludeNetId: string,
  clearance: number,
  originX: number,
  originY: number,
  gridW: number,
  gridH: number,
): Set<string> {
  const blocked = new Set<string>();
  const clearanceCells = Math.ceil(clearance / GRID_RESOLUTION);

  // Helper: mark a rectangular region as blocked
  function blockRect(cx: number, cy: number, halfW: number, halfH: number, buffer: number) {
    const gMin = worldToGrid(cx - halfW - buffer, cy - halfH - buffer, originX, originY);
    const gMax = worldToGrid(cx + halfW + buffer, cy + halfH + buffer, originX, originY);
    for (let gy = Math.max(0, gMin.y); gy <= Math.min(gridH - 1, gMax.y); gy++) {
      for (let gx = Math.max(0, gMin.x); gx <= Math.min(gridW - 1, gMax.x); gx++) {
        blocked.add(gridKey(gx, gy));
      }
    }
  }

  // Helper: mark cells along a trace segment as blocked
  function blockSegment(p1: Point, p2: Point, halfWidth: number, buffer: number) {
    const totalHalf = halfWidth + buffer;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      blockRect(p1.x, p1.y, totalHalf, totalHalf, 0);
      return;
    }
    const steps = Math.ceil(len / GRID_RESOLUTION);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = p1.x + dx * t;
      const py = p1.y + dy * t;
      blockRect(px, py, totalHalf, totalHalf, 0);
    }
  }

  // Mark existing traces (with clearance) as obstacles, except our own net
  for (const trace of board.traces) {
    if (trace.netId === excludeNetId) continue;
    for (let i = 0; i < trace.points.length - 1; i++) {
      blockSegment(trace.points[i], trace.points[i + 1], trace.width / 2, clearance);
    }
  }

  // Mark component bodies as obstacles (use pad bounding boxes expanded)
  for (const comp of board.components) {
    for (const pad of comp.pads) {
      // Skip pads that belong to our net (we need to reach them)
      if (pad.netId === excludeNetId) continue;
      const padX = comp.x + pad.x;
      const padY = comp.y + pad.y;
      blockRect(padX, padY, pad.width / 2, pad.height / 2, clearance);
    }
  }

  // Mark vias as obstacles (except our net)
  for (const via of board.vias) {
    if (via.netId === excludeNetId) continue;
    blockRect(via.x, via.y, via.size / 2, via.size / 2, clearance);
  }

  // Mark keepout zones
  for (const zone of board.zones) {
    if (!zone.isKeepout) continue;
    if (zone.keepoutType && zone.keepoutType !== 'no_trace' && zone.keepoutType !== 'no_copper') continue;
    // Simple bounding-box approach for keepout polygons
    if (zone.points.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of zone.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const gMin = worldToGrid(minX, minY, originX, originY);
    const gMax = worldToGrid(maxX, maxY, originX, originY);
    for (let gy = Math.max(0, gMin.y); gy <= Math.min(gridH - 1, gMax.y); gy++) {
      for (let gx = Math.max(0, gMin.x); gx <= Math.min(gridW - 1, gMax.x); gx++) {
        blocked.add(gridKey(gx, gy));
      }
    }
  }

  return blocked;
}

/**
 * Collect all pads belonging to a net across all board components.
 */
function collectNetPads(board: BoardState, netId: string): { pad: BrdPad; worldX: number; worldY: number }[] {
  const result: { pad: BrdPad; worldX: number; worldY: number }[] = [];
  for (const comp of board.components) {
    for (const pad of comp.pads) {
      if (pad.netId === netId) {
        result.push({
          pad,
          worldX: comp.x + pad.x,
          worldY: comp.y + pad.y,
        });
      }
    }
  }
  return result;
}

/**
 * Simplify a path by removing collinear intermediate points.
 */
function simplifyPath(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Check if prev->curr->next are collinear
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    // Cross product ~ 0 means collinear
    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    if (cross > 1e-9) {
      result.push(curr);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/** Simple min-heap priority queue for A* open set */
class MinHeap {
  private data: AStarNode[] = [];

  get size(): number { return this.data.length; }

  push(node: AStarNode): void {
    this.data.push(node);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): AStarNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}

/**
 * A* pathfinding on the obstacle grid.
 * Returns grid-coordinate path from start to goal, or null if no path found.
 */
function aStarSearch(
  startGx: number,
  startGy: number,
  goalGx: number,
  goalGy: number,
  blocked: Set<string>,
  gridW: number,
  gridH: number,
): GridCell[] | null {
  const startKey = gridKey(startGx, startGy);
  const goalKey = gridKey(goalGx, goalGy);

  if (startKey === goalKey) return [{ x: startGx, y: startGy }];

  const openSet = new MinHeap();
  const closed = new Set<string>();
  const bestG = new Map<string, number>();
  const cameFrom = new Map<string, { parentKey: string; dirX: number; dirY: number }>();

  const h0 = heuristic(startGx, startGy, goalGx, goalGy);
  openSet.push({
    gx: startGx, gy: startGy,
    g: 0, f: h0,
    parentKey: null,
    dirX: 0, dirY: 0,
  });
  bestG.set(startKey, 0);

  let iterations = 0;

  while (openSet.size > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const current = openSet.pop()!;
    const currentKey = gridKey(current.gx, current.gy);

    if (currentKey === goalKey) {
      // Reconstruct path
      const path: GridCell[] = [];
      let key: string | null = goalKey;
      path.push({ x: current.gx, y: current.gy });
      while (key && cameFrom.has(key)) {
        const info: { parentKey: string; dirX: number; dirY: number } = cameFrom.get(key)!;
        const [px, py] = info.parentKey.split(',').map(Number);
        path.push({ x: px, y: py });
        key = info.parentKey;
      }
      path.reverse();
      return path;
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    for (const dir of DIRECTIONS) {
      const nx = current.gx + dir.dx;
      const ny = current.gy + dir.dy;

      // Bounds check
      if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;

      const nKey = gridKey(nx, ny);
      if (closed.has(nKey)) continue;
      if (blocked.has(nKey)) continue;

      // For diagonal movement, check that both orthogonal neighbors are clear
      // (prevents cutting through corners of obstacles)
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (blocked.has(gridKey(current.gx + dir.dx, current.gy)) ||
            blocked.has(gridKey(current.gx, current.gy + dir.dy))) {
          continue;
        }
      }

      const tp = turnPenalty(current.dirX, current.dirY, dir.dx, dir.dy);
      const tentativeG = current.g + dir.cost + tp;

      const existingG = bestG.get(nKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;

      bestG.set(nKey, tentativeG);
      cameFrom.set(nKey, { parentKey: currentKey, dirX: dir.dx, dirY: dir.dy });

      const h = heuristic(nx, ny, goalGx, goalGy);
      openSet.push({
        gx: nx, gy: ny,
        g: tentativeG, f: tentativeG + h,
        parentKey: currentKey,
        dirX: dir.dx, dirY: dir.dy,
      });
    }
  }

  return null; // No path found
}

/**
 * Route a single net on the board using A* pathfinding.
 *
 * Creates a grid at 0.25mm resolution, marks obstacles (existing traces with
 * clearance, component pads, keepout zones, vias), then finds a path between
 * unconnected pads of the given net.
 *
 * @returns A BrdTrace with the routed path, or null if no path found.
 */
export function autoRouteNet(
  board: BoardState,
  netId: string,
  layer: string,
  width: number,
  clearance: number,
): BrdTrace | null {
  // Collect pads belonging to this net
  const pads = collectNetPads(board, netId);
  if (pads.length < 2) return null;

  // Determine grid bounds from board outline
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (board.outline.points.length > 0) {
    for (const p of board.outline.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  } else {
    // Fallback: derive bounds from component positions
    for (const comp of board.components) {
      if (comp.x - 10 < minX) minX = comp.x - 10;
      if (comp.y - 10 < minY) minY = comp.y - 10;
      if (comp.x + 10 > maxX) maxX = comp.x + 10;
      if (comp.y + 10 > maxY) maxY = comp.y + 10;
    }
  }

  // Add margin
  const margin = clearance * 2;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;

  const gridW = Math.ceil((maxX - minX) / GRID_RESOLUTION) + 1;
  const gridH = Math.ceil((maxY - minY) / GRID_RESOLUTION) + 1;

  // Safety: if grid is unreasonably large, bail out
  if (gridW * gridH > 4_000_000) return null;

  // Build obstacle grid
  const blocked = buildObstacleGrid(board, netId, clearance, minX, minY, gridW, gridH);

  // Route using a star-chain approach: connect pads sequentially
  // Start from first pad, connect to nearest unconnected pad, repeat
  const allPoints: Point[] = [];
  const connected = new Set<number>([0]);
  const unconnected = new Set<number>();
  for (let i = 1; i < pads.length; i++) unconnected.add(i);

  let currentPadIdx = 0;

  while (unconnected.size > 0) {
    // Find nearest unconnected pad to current pad
    let bestDist = Infinity;
    let bestIdx = -1;
    const cp = pads[currentPadIdx];

    for (const idx of Array.from(unconnected)) {
      const tp = pads[idx];
      const dist = Math.abs(tp.worldX - cp.worldX) + Math.abs(tp.worldY - cp.worldY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) break;

    const startPad = pads[currentPadIdx];
    const endPad = pads[bestIdx];

    const startGrid = worldToGrid(startPad.worldX, startPad.worldY, minX, minY);
    const endGrid = worldToGrid(endPad.worldX, endPad.worldY, minX, minY);

    // Temporarily unblock start and end cells (they are pads of our net)
    const startCellKey = gridKey(startGrid.x, startGrid.y);
    const endCellKey = gridKey(endGrid.x, endGrid.y);
    const startWasBlocked = blocked.has(startCellKey);
    const endWasBlocked = blocked.has(endCellKey);
    blocked.delete(startCellKey);
    blocked.delete(endCellKey);

    const gridPath = aStarSearch(
      startGrid.x, startGrid.y,
      endGrid.x, endGrid.y,
      blocked, gridW, gridH,
    );

    // Restore blocked state
    if (startWasBlocked) blocked.add(startCellKey);
    if (endWasBlocked) blocked.add(endCellKey);

    if (!gridPath) return null; // Failed to route this segment

    // Convert grid path to world coordinates
    const worldPath = gridPath.map(gc => gridToWorld(gc.x, gc.y, minX, minY));

    // Snap first/last point to exact pad positions
    worldPath[0] = { x: startPad.worldX, y: startPad.worldY };
    worldPath[worldPath.length - 1] = { x: endPad.worldX, y: endPad.worldY };

    // Append to overall path (skip first point if we already have points to avoid duplicates)
    if (allPoints.length > 0) {
      allPoints.push(...worldPath.slice(1));
    } else {
      allPoints.push(...worldPath);
    }

    // Mark the routed segment as an obstacle for subsequent pad connections
    for (let i = 0; i < gridPath.length - 1; i++) {
      const p1 = gridToWorld(gridPath[i].x, gridPath[i].y, minX, minY);
      const p2 = gridToWorld(gridPath[i + 1].x, gridPath[i + 1].y, minX, minY);
      // We don't block our own trace, but the grid already tracks it
    }

    connected.add(bestIdx);
    unconnected.delete(bestIdx);
    currentPadIdx = bestIdx;
  }

  if (allPoints.length < 2) return null;

  // Simplify path by removing collinear points
  const simplified = simplifyPath(allPoints);

  const trace: BrdTrace = {
    id: `auto_${netId}_${Date.now()}`,
    points: simplified,
    width,
    layer,
    netId,
  };

  return trace;
}

/**
 * Auto-route all unconnected nets on the board in priority order.
 *
 * Routes power nets first (wider traces), then high-speed, then signal.
 * Uses the constraint system to determine layer assignment and trace width.
 *
 * @returns New traces and a list of net IDs that failed to route.
 */
export function autoRouteAll(
  board: BoardState,
  constraints: RoutingConstraints,
  options?: { maxNets?: number },
): { traces: BrdTrace[]; failed: string[] } {
  const traces: BrdTrace[] = [];
  const failed: string[] = [];
  const maxNets = options?.maxNets ?? Infinity;

  // Sort nets by priority (lower number = higher priority = route first)
  const sortedNets = [...constraints.netPriorities].sort((a, b) => a.priority - b.priority);

  // Default clearance by net type
  function getClearance(np: NetPriority): number {
    switch (np.type) {
      case 'power':
      case 'ground':
        return 0.3;
      case 'differential':
      case 'high-speed':
      case 'clock':
        return 0.2;
      default:
        return 0.15;
    }
  }

  // Build a working copy of board state so new traces become obstacles for later nets
  const workingBoard: BoardState = {
    ...board,
    traces: [...board.traces],
    vias: [...board.vias],
    zones: [...board.zones],
    components: [...board.components],
    outline: board.outline,
    layers: board.layers,
  };

  let routedCount = 0;

  for (const np of sortedNets) {
    if (routedCount >= maxNets) break;

    // Skip ground/power nets if they should use planes (on inner layers of 4+ layer boards)
    // They can still be routed on 2-layer boards
    if ((np.type === 'ground' || np.type === 'power') &&
        (np.layer === 'In1.Cu' || np.layer === 'In2.Cu')) {
      continue; // These use copper pours, not traces
    }

    // Check if this net has unconnected pads
    const pads = collectNetPads(workingBoard, np.netId);
    if (pads.length < 2) continue;

    // Check if already fully routed (all pads connected by existing traces)
    const existingTraces = workingBoard.traces.filter(t => t.netId === np.netId);
    if (existingTraces.length >= pads.length - 1) continue; // heuristic: likely routed

    const clearance = getClearance(np);
    const trace = autoRouteNet(workingBoard, np.netId, np.layer, np.width, clearance);

    if (trace) {
      traces.push(trace);
      workingBoard.traces.push(trace); // Add to working board so it's an obstacle for later nets
      routedCount++;
    } else {
      failed.push(np.netId);
    }
  }

  return { traces, failed };
}
