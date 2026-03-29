// ─── ercEngine.ts ── Electrical Rule Check engine ────────────────────────────
// Runs entirely in the browser, analyzing schematic connectivity for ERC errors.

import type {
  SchematicState, SchComponent, SchPin, SchNet, PinType, Point,
} from '../types';

// ─── ERC Rule Kinds ─────────────────────────────────────────────────────────

export type ERCRuleKind =
  | 'unconnected-pin'
  | 'pin-conflict'
  | 'power-conflict'
  | 'missing-power-flag'
  | 'floating-input'
  | 'single-pin-net'
  | 'unconnected-component';

// ─── ERC Violation ──────────────────────────────────────────────────────────

export interface ERCViolation {
  severity: 'error' | 'warning' | 'info';
  rule: ERCRuleKind;
  message: string;
  components: string[];   // affected component refs
  nets: string[];          // affected net names
  x?: number;
  y?: number;
}

// ─── ERC Result ─────────────────────────────────────────────────────────────

export interface ERCResult {
  violations: ERCViolation[];
  score: number;
  runTimeMs: number;
  timestamp: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ResolvedPin {
  pin: SchPin;
  component: SchComponent;
  absX: number;
  absY: number;
}

/** Compute absolute pin positions from component transforms */
function resolveAbsolutePins(schematic: SchematicState): ResolvedPin[] {
  const result: ResolvedPin[] = [];
  for (const comp of schematic.components) {
    const rad = (comp.rotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    for (const pin of comp.pins) {
      const rx = pin.x * cosR - pin.y * sinR;
      const ry = pin.x * sinR + pin.y * cosR;
      result.push({
        pin,
        component: comp,
        absX: comp.x + rx,
        absY: comp.y + ry,
      });
    }
  }
  return result;
}

/** Build a map from pin ID to its resolved info */
function buildPinMap(resolved: ResolvedPin[]): Map<string, ResolvedPin> {
  const map = new Map<string, ResolvedPin>();
  for (const rp of resolved) {
    map.set(rp.pin.id, rp);
  }
  return map;
}

/** Build a map from net ID to its SchNet */
function buildNetMap(nets: SchNet[]): Map<string, SchNet> {
  const map = new Map<string, SchNet>();
  for (const net of nets) {
    map.set(net.id, net);
  }
  return map;
}

/** Check if a component type looks like a power symbol */
function isPowerSymbol(comp: SchComponent): boolean {
  const t = comp.type.toLowerCase();
  const s = comp.symbol.toLowerCase();
  return (
    t.includes('power') ||
    t.includes('pwr') ||
    s.includes('power') ||
    s.includes('pwr') ||
    t === 'vcc' || t === 'vdd' || t === 'gnd' || t === 'vss' ||
    t === 'v3p3' || t === 'v5' || t === 'v1p8'
  );
}

// ─── ERC Checks ─────────────────────────────────────────────────────────────

/**
 * 1. Unconnected pins: IC pins not connected to any net.
 *    - Error for power pins, warning for passive/others.
 */
function checkUnconnectedPins(
  schematic: SchematicState,
  nets: SchNet[],
  absPins: ResolvedPin[],
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  // Build set of all pin IDs that appear in any net
  const connectedPinIds = new Set<string>();
  for (const net of nets) {
    for (const pinId of net.pins) {
      connectedPinIds.add(pinId);
    }
  }

  for (const rp of absPins) {
    if (connectedPinIds.has(rp.pin.id)) continue;

    // Skip power symbol pins -- they define nets, not consume them
    if (isPowerSymbol(rp.component)) continue;

    const severity: 'error' | 'warning' =
      rp.pin.type === 'power' ? 'error' : 'warning';

    violations.push({
      severity,
      rule: 'unconnected-pin',
      message: `Pin ${rp.pin.name} (${rp.pin.number}) of ${rp.component.ref} is unconnected` +
        (rp.pin.type === 'power' ? ' (power pin - must be connected)' : ''),
      components: [rp.component.ref],
      nets: [],
      x: rp.absX,
      y: rp.absY,
    });
  }

  return violations;
}

/**
 * 2. Pin conflict: Two output pins on the same net.
 */
function checkPinConflicts(
  nets: SchNet[],
  pinMap: Map<string, ResolvedPin>,
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  for (const net of nets) {
    const outputPins: ResolvedPin[] = [];
    for (const pinId of net.pins) {
      const rp = pinMap.get(pinId);
      if (rp && rp.pin.type === 'output') {
        outputPins.push(rp);
      }
    }

    if (outputPins.length > 1) {
      const refs = [...new Set(outputPins.map(rp => rp.component.ref))];
      const pinNames = outputPins.map(rp => `${rp.component.ref}:${rp.pin.name}`);
      violations.push({
        severity: 'error',
        rule: 'pin-conflict',
        message: `Output pin conflict on net "${net.name}": ${pinNames.join(', ')} are all driving the same net`,
        components: refs,
        nets: [net.name],
        x: outputPins[0].absX,
        y: outputPins[0].absY,
      });
    }
  }

  return violations;
}

/**
 * 3. Power pin conflict: Two different power sources on the same net.
 *    Looks for multiple power-type pins from different power symbols on a net.
 */
function checkPowerConflicts(
  schematic: SchematicState,
  nets: SchNet[],
  pinMap: Map<string, ResolvedPin>,
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  for (const net of nets) {
    const powerSources: ResolvedPin[] = [];

    for (const pinId of net.pins) {
      const rp = pinMap.get(pinId);
      if (!rp) continue;

      // A power source is a power pin on a power symbol (e.g., VCC, GND)
      if (rp.pin.type === 'power' && isPowerSymbol(rp.component)) {
        powerSources.push(rp);
      }
    }

    // Check if different power symbols with different values drive the same net
    if (powerSources.length > 1) {
      const uniqueValues = new Set(powerSources.map(rp => rp.component.value));
      if (uniqueValues.size > 1) {
        const refs = [...new Set(powerSources.map(rp => rp.component.ref))];
        const values = [...uniqueValues];
        violations.push({
          severity: 'error',
          rule: 'power-conflict',
          message: `Power conflict on net "${net.name}": different power sources [${values.join(', ')}] connected to the same net`,
          components: refs,
          nets: [net.name],
          x: powerSources[0].absX,
          y: powerSources[0].absY,
        });
      }
    }
  }

  return violations;
}

/**
 * 4. Missing power flag: Net has power-consuming pins but no power symbol driving it.
 */
function checkMissingPowerFlag(
  schematic: SchematicState,
  nets: SchNet[],
  pinMap: Map<string, ResolvedPin>,
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  for (const net of nets) {
    let hasPowerConsumer = false;
    let hasPowerSource = false;

    for (const pinId of net.pins) {
      const rp = pinMap.get(pinId);
      if (!rp) continue;

      if (rp.pin.type === 'power') {
        if (isPowerSymbol(rp.component)) {
          hasPowerSource = true;
        } else {
          hasPowerConsumer = true;
        }
      }
    }

    if (hasPowerConsumer && !hasPowerSource) {
      // Collect the consuming components
      const consumers: ResolvedPin[] = [];
      for (const pinId of net.pins) {
        const rp = pinMap.get(pinId);
        if (rp && rp.pin.type === 'power' && !isPowerSymbol(rp.component)) {
          consumers.push(rp);
        }
      }

      const refs = [...new Set(consumers.map(rp => rp.component.ref))];
      violations.push({
        severity: 'warning',
        rule: 'missing-power-flag',
        message: `Net "${net.name}" has power pins [${refs.join(', ')}] but no power symbol driving it`,
        components: refs,
        nets: [net.name],
        x: consumers[0]?.absX,
        y: consumers[0]?.absY,
      });
    }
  }

  return violations;
}

/**
 * 5. Floating input: Input pin not driven by any output or bidirectional pin.
 */
function checkFloatingInputs(
  nets: SchNet[],
  pinMap: Map<string, ResolvedPin>,
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  for (const net of nets) {
    const inputPins: ResolvedPin[] = [];
    let hasDriver = false;

    for (const pinId of net.pins) {
      const rp = pinMap.get(pinId);
      if (!rp) continue;

      if (rp.pin.type === 'input') {
        inputPins.push(rp);
      } else if (
        rp.pin.type === 'output' ||
        rp.pin.type === 'bidirectional' ||
        rp.pin.type === 'power'
      ) {
        hasDriver = true;
      }
    }

    if (inputPins.length > 0 && !hasDriver) {
      for (const rp of inputPins) {
        violations.push({
          severity: 'warning',
          rule: 'floating-input',
          message: `Floating input: ${rp.component.ref}:${rp.pin.name} on net "${net.name}" has no driver (output/bidir/power)`,
          components: [rp.component.ref],
          nets: [net.name],
          x: rp.absX,
          y: rp.absY,
        });
      }
    }
  }

  return violations;
}

/**
 * 6. Single-pin net: Net with only one connection (usually a mistake).
 */
function checkSinglePinNets(
  nets: SchNet[],
  pinMap: Map<string, ResolvedPin>,
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  for (const net of nets) {
    if (net.pins.length === 1) {
      const rp = pinMap.get(net.pins[0]);
      if (!rp) continue;

      violations.push({
        severity: 'warning',
        rule: 'single-pin-net',
        message: `Net "${net.name}" has only one pin connected (${rp.component.ref}:${rp.pin.name}) - likely a mistake`,
        components: [rp.component.ref],
        nets: [net.name],
        x: rp.absX,
        y: rp.absY,
      });
    }
  }

  return violations;
}

/**
 * 7. Unconnected component: Component with ALL pins unconnected.
 */
function checkUnconnectedComponents(
  schematic: SchematicState,
  nets: SchNet[],
): ERCViolation[] {
  const violations: ERCViolation[] = [];

  // Build set of all pin IDs in any net
  const connectedPinIds = new Set<string>();
  for (const net of nets) {
    for (const pinId of net.pins) {
      connectedPinIds.add(pinId);
    }
  }

  for (const comp of schematic.components) {
    if (comp.pins.length === 0) continue;

    // Skip power symbols -- they define nets
    if (isPowerSymbol(comp)) continue;

    const allUnconnected = comp.pins.every(pin => !connectedPinIds.has(pin.id));
    if (allUnconnected) {
      violations.push({
        severity: 'error',
        rule: 'unconnected-component',
        message: `Component ${comp.ref} (${comp.value}) has all ${comp.pins.length} pins unconnected`,
        components: [comp.ref],
        nets: [],
        x: comp.x,
        y: comp.y,
      });
    }
  }

  return violations;
}

// ─── Score calculation ──────────────────────────────────────────────────────

function computeScore(violations: ERCViolation[]): number {
  if (violations.length === 0) return 100;

  let deductions = 0;
  for (const v of violations) {
    switch (v.severity) {
      case 'error':
        deductions += 15;
        break;
      case 'warning':
        deductions += 5;
        break;
      case 'info':
        deductions += 1;
        break;
    }
  }

  return Math.max(0, Math.round(100 - deductions));
}

// ─── Main ERC runner ────────────────────────────────────────────────────────

export function runERC(schematic: SchematicState, nets: SchNet[]): ERCViolation[] {
  const absPins = resolveAbsolutePins(schematic);
  const pinMap = buildPinMap(absPins);

  const violations: ERCViolation[] = [
    ...checkUnconnectedPins(schematic, nets, absPins),
    ...checkPinConflicts(nets, pinMap),
    ...checkPowerConflicts(schematic, nets, pinMap),
    ...checkMissingPowerFlag(schematic, nets, pinMap),
    ...checkFloatingInputs(nets, pinMap),
    ...checkSinglePinNets(nets, pinMap),
    ...checkUnconnectedComponents(schematic, nets),
  ];

  // Sort: errors first, then warnings, then info
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return violations;
}

/** Convenience wrapper that returns a full result object with timing */
export function runERCWithResult(schematic: SchematicState, nets: SchNet[]): ERCResult {
  const t0 = performance.now();
  const violations = runERC(schematic, nets);
  const runTimeMs = performance.now() - t0;

  return {
    violations,
    score: computeScore(violations),
    runTimeMs,
    timestamp: Date.now(),
  };
}

/** Rule labels for display */
export const ERC_RULE_LABELS: Record<ERCRuleKind, string> = {
  'unconnected-pin': 'Unconnected Pin',
  'pin-conflict': 'Pin Conflict',
  'power-conflict': 'Power Conflict',
  'missing-power-flag': 'Missing Power Flag',
  'floating-input': 'Floating Input',
  'single-pin-net': 'Single-Pin Net',
  'unconnected-component': 'Unconnected Component',
};
