// ─── EMCPanel.tsx ── EMC Compliance Pre-flight Checklist ─────────────────────
import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import { detectComponentType } from '../engine/componentRules';
import type { BrdComponent, BrdTrace, BrdVia, BrdZone, BoardState } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'warning' | 'na';

interface EMCCheck {
  id: string;
  name: string;
  category: string;
  status: CheckStatus;
  score: number;       // 0-10 contribution to overall score
  maxScore: number;
  details: string;
  recommendation: string;
  affectedRefs?: string[];
}

// ─── Helper: distance between two points ────────────────────────────────────

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

// ─── EMC Check Functions ────────────────────────────────────────────────────

function checkDecouplingCaps(board: BoardState): EMCCheck {
  const ics: BrdComponent[] = [];
  const caps: BrdComponent[] = [];

  for (const comp of board.components) {
    const type = detectComponentType(comp.value, '', comp.ref, comp.footprint);
    if (type && ['mcu', 'fpga', 'usb_uart', 'can_transceiver', 'rs485', 'spi_flash',
      'i2c_eeprom', 'i2c_device', 'opamp', 'comparator', 'display_driver',
      'motor_driver', 'audio', 'wireless_module', 'battery_charger'].includes(type)) {
      ics.push(comp);
    }
    // Detect capacitors by ref (C prefix) and small footprint
    if (/^C\d/i.test(comp.ref) && /C_0[24568]0[2356]/i.test(comp.footprint)) {
      caps.push(comp);
    }
  }

  if (ics.length === 0) {
    return {
      id: 'decoupling',
      name: 'Decoupling Capacitors',
      category: 'Power Integrity',
      status: 'na',
      score: 0,
      maxScore: 15,
      details: 'No ICs detected on board.',
      recommendation: '',
    };
  }

  const MAX_DISTANCE = 3.0; // mm
  const missingDecap: string[] = [];

  for (const ic of ics) {
    const hasNearCap = caps.some(
      (cap) => dist(ic.x, ic.y, cap.x, cap.y) <= MAX_DISTANCE
    );
    if (!hasNearCap) {
      missingDecap.push(ic.ref);
    }
  }

  if (missingDecap.length === 0) {
    return {
      id: 'decoupling',
      name: 'Decoupling Capacitors',
      category: 'Power Integrity',
      status: 'pass',
      score: 15,
      maxScore: 15,
      details: `All ${ics.length} ICs have bypass capacitor within ${MAX_DISTANCE}mm.`,
      recommendation: '',
    };
  }

  const ratio = (ics.length - missingDecap.length) / ics.length;
  return {
    id: 'decoupling',
    name: 'Decoupling Capacitors',
    category: 'Power Integrity',
    status: missingDecap.length === ics.length ? 'fail' : 'warning',
    score: Math.round(ratio * 15),
    maxScore: 15,
    details: `${missingDecap.length} of ${ics.length} ICs missing bypass cap within ${MAX_DISTANCE}mm: ${missingDecap.join(', ')}`,
    recommendation: `Place 100nF ceramic capacitor within ${MAX_DISTANCE}mm of each IC VDD pin. Use short traces to ground plane via.`,
    affectedRefs: missingDecap,
  };
}

function checkGroundPlane(board: BoardState): EMCCheck {
  const groundZones = board.zones.filter(
    (z) => z.netId.toLowerCase().includes('gnd') || z.netId.toLowerCase().includes('ground')
  );

  if (groundZones.length === 0) {
    // Also check for zones without net label that cover large area
    const largeZones = board.zones.filter((z) => {
      if (z.points.length < 3) return false;
      // Rough area estimate
      let area = 0;
      for (let i = 0; i < z.points.length; i++) {
        const j = (i + 1) % z.points.length;
        area += z.points[i].x * z.points[j].y - z.points[j].x * z.points[i].y;
      }
      return Math.abs(area) / 2 > 100; // > 100mm^2
    });

    if (largeZones.length > 0) {
      return {
        id: 'ground_plane',
        name: 'Ground Plane',
        category: 'Power Integrity',
        status: 'warning',
        score: 5,
        maxScore: 10,
        details: `${largeZones.length} large zone(s) found but none labeled as GND. Verify ground plane exists.`,
        recommendation: 'Assign the GND net to at least one copper zone for a solid ground plane.',
      };
    }

    return {
      id: 'ground_plane',
      name: 'Ground Plane',
      category: 'Power Integrity',
      status: board.zones.length === 0 ? 'fail' : 'warning',
      score: 0,
      maxScore: 10,
      details: 'No ground plane (copper zone with GND net) detected.',
      recommendation: 'Add a ground pour/zone on at least one copper layer. A solid ground plane is essential for EMC compliance and signal integrity.',
    };
  }

  return {
    id: 'ground_plane',
    name: 'Ground Plane',
    category: 'Power Integrity',
    status: 'pass',
    score: 10,
    maxScore: 10,
    details: `${groundZones.length} ground zone(s) found.`,
    recommendation: '',
  };
}

function checkPowerFiltering(board: BoardState): EMCCheck {
  // Check for bulk capacitors near power input (connectors)
  const connectors = board.components.filter(
    (c) => /^J\d/i.test(c.ref) || /connector|header|jack|barrel/i.test(c.value)
  );
  const bulkCaps = board.components.filter(
    (c) => /^C\d/i.test(c.ref) && (/C_0805|C_1206|C_1210/i.test(c.footprint) || /[14][07]u|22u|47u|100u/i.test(c.value))
  );

  if (connectors.length === 0) {
    return {
      id: 'power_filter',
      name: 'Power Input Filtering',
      category: 'Power Integrity',
      status: 'na',
      score: 0,
      maxScore: 10,
      details: 'No power connectors detected.',
      recommendation: '',
    };
  }

  const MAX_DIST = 15; // mm from connector
  const hasNearBulk = connectors.some((conn) =>
    bulkCaps.some((cap) => dist(conn.x, conn.y, cap.x, cap.y) <= MAX_DIST)
  );

  if (hasNearBulk) {
    return {
      id: 'power_filter',
      name: 'Power Input Filtering',
      category: 'Power Integrity',
      status: 'pass',
      score: 10,
      maxScore: 10,
      details: 'Bulk capacitor found near power connector.',
      recommendation: '',
    };
  }

  return {
    id: 'power_filter',
    name: 'Power Input Filtering',
    category: 'Power Integrity',
    status: bulkCaps.length > 0 ? 'warning' : 'fail',
    score: bulkCaps.length > 0 ? 5 : 0,
    maxScore: 10,
    details: bulkCaps.length > 0
      ? 'Bulk capacitors exist but none near power connector.'
      : 'No bulk capacitors found for power input filtering.',
    recommendation: 'Add a bulk capacitor (10uF-100uF) and a 100nF bypass cap near the power input connector. Consider adding an input ferrite bead for additional EMI filtering.',
  };
}

function checkESDProtection(board: BoardState): EMCCheck {
  const connectors = board.components.filter(
    (c) => /^J\d/i.test(c.ref) || /usb|connector|header|rj45|jack/i.test(c.value.toLowerCase())
  );
  const esdDevices = board.components.filter((c) => {
    const type = detectComponentType(c.value, '', c.ref, c.footprint);
    return type === 'esd' || /USBLC|PRTR|TVS|ESD|PESD|TPD|SMBJ|SMAJ/i.test(c.value);
  });

  if (connectors.length === 0) {
    return {
      id: 'esd_protection',
      name: 'ESD Protection',
      category: 'EMC Compliance',
      status: 'na',
      score: 0,
      maxScore: 10,
      details: 'No external connectors detected.',
      recommendation: '',
    };
  }

  if (esdDevices.length === 0) {
    return {
      id: 'esd_protection',
      name: 'ESD Protection',
      category: 'EMC Compliance',
      status: 'fail',
      score: 0,
      maxScore: 10,
      details: `${connectors.length} external connector(s) found but no ESD protection devices.`,
      recommendation: 'Add TVS diode arrays (e.g., USBLC6-2, PRTR5V0U2X) on all external-facing signal lines. Required for CE/FCC compliance.',
      affectedRefs: connectors.map((c) => c.ref),
    };
  }

  const ratio = Math.min(1, esdDevices.length / connectors.length);
  return {
    id: 'esd_protection',
    name: 'ESD Protection',
    category: 'EMC Compliance',
    status: ratio >= 1 ? 'pass' : 'warning',
    score: Math.round(ratio * 10),
    maxScore: 10,
    details: `${esdDevices.length} ESD device(s) for ${connectors.length} connector(s).`,
    recommendation: ratio < 1
      ? 'Not all connectors have ESD protection. Add TVS diodes on unprotected external signal lines.'
      : '',
  };
}

function checkClockTraces(board: BoardState): EMCCheck {
  const crystals = board.components.filter((c) => {
    const type = detectComponentType(c.value, '', c.ref, c.footprint);
    return type === 'crystal' || /^Y\d/i.test(c.ref) || /crystal|osc/i.test(c.value.toLowerCase());
  });
  const mcus = board.components.filter((c) => {
    const type = detectComponentType(c.value, '', c.ref, c.footprint);
    return type === 'mcu' || type === 'fpga';
  });

  if (crystals.length === 0) {
    return {
      id: 'clock_traces',
      name: 'Clock Trace Length',
      category: 'Signal Integrity',
      status: 'na',
      score: 0,
      maxScore: 10,
      details: 'No crystals/oscillators detected.',
      recommendation: '',
    };
  }

  const MAX_CRYSTAL_DIST = 10; // mm
  const farCrystals: string[] = [];

  for (const crystal of crystals) {
    const nearMCU = mcus.some(
      (mcu) => dist(crystal.x, crystal.y, mcu.x, mcu.y) <= MAX_CRYSTAL_DIST
    );
    if (!nearMCU && mcus.length > 0) {
      farCrystals.push(crystal.ref);
    }
  }

  if (farCrystals.length === 0) {
    return {
      id: 'clock_traces',
      name: 'Clock Trace Length',
      category: 'Signal Integrity',
      status: 'pass',
      score: 10,
      maxScore: 10,
      details: `All ${crystals.length} crystal(s) within ${MAX_CRYSTAL_DIST}mm of MCU/FPGA.`,
      recommendation: '',
    };
  }

  return {
    id: 'clock_traces',
    name: 'Clock Trace Length',
    category: 'Signal Integrity',
    status: 'warning',
    score: Math.round(((crystals.length - farCrystals.length) / crystals.length) * 10),
    maxScore: 10,
    details: `Crystal(s) ${farCrystals.join(', ')} too far from MCU (>${MAX_CRYSTAL_DIST}mm).`,
    recommendation: `Move crystal within ${MAX_CRYSTAL_DIST}mm of MCU. Add guard ring / ground pour around clock traces. Use short, direct routing.`,
    affectedRefs: farCrystals,
  };
}

function checkUSBProtection(board: BoardState): EMCCheck {
  const usbConnectors = board.components.filter(
    (c) => /usb/i.test(c.value) || /usb/i.test(c.footprint)
  );
  const usbICs = board.components.filter((c) => {
    const type = detectComponentType(c.value, '', c.ref, c.footprint);
    return type === 'usb_uart';
  });

  if (usbConnectors.length === 0 && usbICs.length === 0) {
    return {
      id: 'usb_esd',
      name: 'USB D+/D- ESD Protection',
      category: 'EMC Compliance',
      status: 'na',
      score: 0,
      maxScore: 10,
      details: 'No USB interfaces detected.',
      recommendation: '',
    };
  }

  const usbESD = board.components.filter(
    (c) => /USBLC|PRTR5V.*U/i.test(c.value) || /TPD.*USB/i.test(c.value)
  );

  if (usbESD.length > 0) {
    return {
      id: 'usb_esd',
      name: 'USB D+/D- ESD Protection',
      category: 'EMC Compliance',
      status: 'pass',
      score: 10,
      maxScore: 10,
      details: `USB ESD protection found: ${usbESD.map((c) => `${c.ref} (${c.value})`).join(', ')}`,
      recommendation: '',
    };
  }

  return {
    id: 'usb_esd',
    name: 'USB D+/D- ESD Protection',
    category: 'EMC Compliance',
    status: 'fail',
    score: 0,
    maxScore: 10,
    details: 'USB interface detected but no D+/D- ESD protection.',
    recommendation: 'Add USBLC6-2SC6 (SOT-23-6) or PRTR5V0U2X between USB connector and IC. Place as close to connector as possible.',
  };
}

function checkTraceWidths(board: BoardState): EMCCheck {
  const MIN_POWER_WIDTH = 0.3; // mm

  // Identify power traces (traces on nets with power-related names)
  const powerTraces = board.traces.filter(
    (t) => /vcc|vdd|vin|vout|3v3|5v|12v|gnd|pwr|power/i.test(t.netId)
  );

  if (powerTraces.length === 0 && board.traces.length === 0) {
    return {
      id: 'trace_widths',
      name: 'Power Trace Widths',
      category: 'Power Integrity',
      status: 'na',
      score: 0,
      maxScore: 10,
      details: 'No traces found on board.',
      recommendation: '',
    };
  }

  if (powerTraces.length === 0) {
    return {
      id: 'trace_widths',
      name: 'Power Trace Widths',
      category: 'Power Integrity',
      status: 'warning',
      score: 5,
      maxScore: 10,
      details: `${board.traces.length} traces found but none identified as power nets. Cannot verify widths.`,
      recommendation: 'Ensure power traces (VCC, GND, VIN) use adequate width (>= 0.3mm for low current, >= 0.5mm for >500mA).',
    };
  }

  const thinPower = powerTraces.filter((t) => t.width < MIN_POWER_WIDTH);

  if (thinPower.length === 0) {
    return {
      id: 'trace_widths',
      name: 'Power Trace Widths',
      category: 'Power Integrity',
      status: 'pass',
      score: 10,
      maxScore: 10,
      details: `All ${powerTraces.length} power traces >= ${MIN_POWER_WIDTH}mm.`,
      recommendation: '',
    };
  }

  return {
    id: 'trace_widths',
    name: 'Power Trace Widths',
    category: 'Power Integrity',
    status: 'fail',
    score: Math.round(((powerTraces.length - thinPower.length) / powerTraces.length) * 10),
    maxScore: 10,
    details: `${thinPower.length} power trace(s) narrower than ${MIN_POWER_WIDTH}mm.`,
    recommendation: `Increase power trace width to >= ${MIN_POWER_WIDTH}mm. Use 0.5mm+ for currents above 500mA. Wider traces reduce voltage drop and EMI.`,
  };
}

function checkViaStitching(board: BoardState): EMCCheck {
  const groundZones = board.zones.filter(
    (z) => z.netId.toLowerCase().includes('gnd')
  );

  if (groundZones.length === 0) {
    return {
      id: 'via_stitching',
      name: 'Ground Via Stitching',
      category: 'Power Integrity',
      status: 'na',
      score: 0,
      maxScore: 5,
      details: 'No ground zones to stitch.',
      recommendation: '',
    };
  }

  // Check for vias that connect layers (ground stitching vias)
  const groundVias = board.vias.filter(
    (v) => v.netId.toLowerCase().includes('gnd') && v.layers.length >= 2
  );

  if (groundVias.length === 0) {
    return {
      id: 'via_stitching',
      name: 'Ground Via Stitching',
      category: 'Power Integrity',
      status: 'warning',
      score: 0,
      maxScore: 5,
      details: 'Ground zones exist but no stitching vias connecting layers.',
      recommendation: 'Add ground stitching vias (every 5-10mm) across the ground plane to connect layers and reduce ground impedance.',
    };
  }

  return {
    id: 'via_stitching',
    name: 'Ground Via Stitching',
    category: 'Power Integrity',
    status: groundVias.length >= 4 ? 'pass' : 'warning',
    score: Math.min(5, groundVias.length),
    maxScore: 5,
    details: `${groundVias.length} ground stitching via(s) found.`,
    recommendation: groundVias.length < 4
      ? 'Add more stitching vias for better inter-layer ground connectivity. Target one via every 5-10mm.'
      : '',
  };
}

function checkSilkscreen(board: BoardState): EMCCheck {
  if (board.components.length === 0) {
    return {
      id: 'silkscreen',
      name: 'Reference Designators',
      category: 'Manufacturing',
      status: 'na',
      score: 0,
      maxScore: 5,
      details: 'No components on board.',
      recommendation: '',
    };
  }

  const missingRef = board.components.filter(
    (c) => !c.ref || c.ref.trim() === ''
  );

  if (missingRef.length === 0) {
    return {
      id: 'silkscreen',
      name: 'Reference Designators',
      category: 'Manufacturing',
      status: 'pass',
      score: 5,
      maxScore: 5,
      details: `All ${board.components.length} components have reference designators.`,
      recommendation: '',
    };
  }

  return {
    id: 'silkscreen',
    name: 'Reference Designators',
    category: 'Manufacturing',
    status: 'fail',
    score: Math.round(((board.components.length - missingRef.length) / board.components.length) * 5),
    maxScore: 5,
    details: `${missingRef.length} component(s) missing reference designators.`,
    recommendation: 'Ensure all components have visible reference designators on the silkscreen layer for assembly and debugging.',
  };
}

function checkBoardEdgeClearance(board: BoardState): EMCCheck {
  const MIN_EDGE_CLEARANCE = 0.5; // mm

  if (board.outline.points.length < 3) {
    return {
      id: 'edge_clearance',
      name: 'Board Edge Clearance',
      category: 'Manufacturing',
      status: 'na',
      score: 0,
      maxScore: 5,
      details: 'No board outline defined.',
      recommendation: '',
    };
  }

  if (board.traces.length === 0 && board.components.length === 0) {
    return {
      id: 'edge_clearance',
      name: 'Board Edge Clearance',
      category: 'Manufacturing',
      status: 'na',
      score: 0,
      maxScore: 5,
      details: 'No traces or components to check.',
      recommendation: '',
    };
  }

  // Simple check: compute distance from each trace point / component to nearest edge segment
  const outline = board.outline.points;
  let violations = 0;
  const violatingRefs: string[] = [];

  // Check components
  for (const comp of board.components) {
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      const d = pointToSegmentDist(comp.x, comp.y, outline[i].x, outline[i].y, outline[j].x, outline[j].y);
      if (d < MIN_EDGE_CLEARANCE) {
        violations++;
        if (!violatingRefs.includes(comp.ref)) violatingRefs.push(comp.ref);
        break;
      }
    }
  }

  // Check trace points
  let traceViolations = 0;
  for (const trace of board.traces) {
    for (const pt of trace.points) {
      for (let i = 0; i < outline.length; i++) {
        const j = (i + 1) % outline.length;
        const d = pointToSegmentDist(pt.x, pt.y, outline[i].x, outline[i].y, outline[j].x, outline[j].y);
        if (d < MIN_EDGE_CLEARANCE) {
          traceViolations++;
          break;
        }
      }
    }
  }

  const totalViolations = violatingRefs.length + traceViolations;
  if (totalViolations === 0) {
    return {
      id: 'edge_clearance',
      name: 'Board Edge Clearance',
      category: 'Manufacturing',
      status: 'pass',
      score: 5,
      maxScore: 5,
      details: `All traces and components are >= ${MIN_EDGE_CLEARANCE}mm from board edge.`,
      recommendation: '',
    };
  }

  return {
    id: 'edge_clearance',
    name: 'Board Edge Clearance',
    category: 'Manufacturing',
    status: 'fail',
    score: 0,
    maxScore: 5,
    details: `${totalViolations} item(s) within ${MIN_EDGE_CLEARANCE}mm of board edge${violatingRefs.length > 0 ? ': ' + violatingRefs.join(', ') : ''}.`,
    recommendation: `Keep all copper, traces, and components at least ${MIN_EDGE_CLEARANCE}mm from the board edge. Manufacturing process may remove copper near edges.`,
    affectedRefs: violatingRefs,
  };
}

function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * (bx - ax);
  const projY = ay + t * (by - ay);
  return Math.hypot(px - projX, py - projY);
}

// ─── Run All Checks ─────────────────────────────────────────────────────────

function runEMCChecks(board: BoardState): EMCCheck[] {
  return [
    checkDecouplingCaps(board),
    checkGroundPlane(board),
    checkPowerFiltering(board),
    checkESDProtection(board),
    checkClockTraces(board),
    checkUSBProtection(board),
    checkTraceWidths(board),
    checkViaStitching(board),
    checkSilkscreen(board),
    checkBoardEdgeClearance(board),
  ];
}

// ─── Status color/label helpers ─────────────────────────────────────────────

const STATUS_COLORS: Record<CheckStatus, string> = {
  pass: theme.green,
  fail: theme.red,
  warning: theme.orange,
  na: theme.textMuted,
};

const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  warning: 'WARN',
  na: 'N/A',
};

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: '\u2705',
  fail: '\u274C',
  warning: '\u26A0\uFE0F',
  na: '\u2796',
};

// ─── Component ──────────────────────────────────────────────────────────────

const EMCPanel: React.FC = () => {
  const board = useProjectStore((s) => s.board);
  const [checks, setChecks] = useState<EMCCheck[] | null>(null);
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);

  const handleRunChecks = useCallback(() => {
    const results = runEMCChecks(board);
    setChecks(results);
  }, [board]);

  // Overall score
  const overallScore = useMemo(() => {
    if (!checks) return 0;
    const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
    const totalMax = checks.reduce((sum, c) => sum + c.maxScore, 0);
    if (totalMax === 0) return 0;
    return Math.round((totalScore / totalMax) * 100);
  }, [checks]);

  // Score color
  const scoreColor = useMemo(() => {
    if (overallScore >= 80) return theme.green;
    if (overallScore >= 50) return theme.orange;
    return theme.red;
  }, [overallScore]);

  // Category grouping
  const groupedChecks = useMemo(() => {
    if (!checks) return new Map<string, EMCCheck[]>();
    const grouped = new Map<string, EMCCheck[]>();
    for (const check of checks) {
      const arr = grouped.get(check.category) || [];
      arr.push(check);
      grouped.set(check.category, arr);
    }
    return grouped;
  }, [checks]);

  // Status counts
  const statusCounts = useMemo(() => {
    if (!checks) return { pass: 0, fail: 0, warning: 0, na: 0 };
    return {
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      warning: checks.filter((c) => c.status === 'warning').length,
      na: checks.filter((c) => c.status === 'na').length,
    };
  }, [checks]);

  // Export checklist as text
  const exportChecklist = useCallback(() => {
    if (!checks) return;
    const lines = [
      '=== EMC Compliance Pre-flight Checklist ===',
      `Date: ${new Date().toISOString()}`,
      `Overall Score: ${overallScore}/100`,
      '',
      `PASS: ${statusCounts.pass}  |  FAIL: ${statusCounts.fail}  |  WARN: ${statusCounts.warning}  |  N/A: ${statusCounts.na}`,
      '',
      '--- Detailed Results ---',
      '',
    ];

    for (const [category, categoryChecks] of groupedChecks) {
      lines.push(`[${category}]`);
      for (const check of categoryChecks) {
        lines.push(`  [${STATUS_LABELS[check.status]}] ${check.name}`);
        lines.push(`         ${check.details}`);
        if (check.recommendation) {
          lines.push(`         Recommendation: ${check.recommendation}`);
        }
        if (check.affectedRefs && check.affectedRefs.length > 0) {
          lines.push(`         Affected: ${check.affectedRefs.join(', ')}`);
        }
        lines.push('');
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emc_checklist.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [checks, overallScore, statusCounts, groupedChecks]);

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={styles.title}>EMC Compliance Pre-flight</span>
          <span style={styles.subtitle}>Rule-based checks for electromagnetic compatibility</span>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.runBtn} onClick={handleRunChecks}>
            {checks ? 'Re-run Checks' : 'Run EMC Checks'}
          </button>
          {checks && (
            <button style={styles.exportBtn} onClick={exportChecklist}>
              Export Report
            </button>
          )}
        </div>
      </div>

      {/* Score + Summary */}
      {checks && (
        <div style={styles.scoreBanner}>
          <div style={styles.scoreCircle}>
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke={theme.bg3}
                strokeWidth="6"
              />
              <circle
                cx="40" cy="40" r="34"
                fill="none"
                stroke={scoreColor}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(overallScore / 100) * 2 * Math.PI * 34} ${2 * Math.PI * 34}`}
                transform="rotate(-90 40 40)"
              />
              <text
                x="40" y="38"
                textAnchor="middle"
                fill={scoreColor}
                fontSize="22"
                fontWeight="700"
                fontFamily={theme.fontMono}
              >
                {overallScore}
              </text>
              <text
                x="40" y="52"
                textAnchor="middle"
                fill={theme.textMuted}
                fontSize="9"
                fontFamily={theme.fontSans}
              >
                / 100
              </text>
            </svg>
          </div>

          <div style={styles.statusSummary}>
            <div style={styles.statusItem}>
              <span style={{ ...styles.statusDot, background: theme.green }} />
              <span style={styles.statusLabel}>{statusCounts.pass} Pass</span>
            </div>
            <div style={styles.statusItem}>
              <span style={{ ...styles.statusDot, background: theme.red }} />
              <span style={styles.statusLabel}>{statusCounts.fail} Fail</span>
            </div>
            <div style={styles.statusItem}>
              <span style={{ ...styles.statusDot, background: theme.orange }} />
              <span style={styles.statusLabel}>{statusCounts.warning} Warning</span>
            </div>
            <div style={styles.statusItem}>
              <span style={{ ...styles.statusDot, background: theme.textMuted }} />
              <span style={styles.statusLabel}>{statusCounts.na} N/A</span>
            </div>
          </div>
        </div>
      )}

      {/* Checks list */}
      <div style={styles.checksContainer}>
        {!checks ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '48px', marginBottom: 12 }}>&#x1F50C;</div>
            <div style={{ fontSize: theme.fontMd, fontWeight: 600, marginBottom: 4 }}>
              EMC Pre-flight Checklist
            </div>
            <div style={{ fontSize: theme.fontSm, color: theme.textMuted, maxWidth: 400, textAlign: 'center', lineHeight: 1.5 }}>
              Checks decoupling capacitors, ground plane, power filtering, ESD protection,
              clock trace lengths, USB protection, trace widths, via stitching, silkscreen,
              and board edge clearance.
            </div>
            <button style={{ ...styles.runBtn, marginTop: 16 }} onClick={handleRunChecks}>
              Run EMC Checks
            </button>
          </div>
        ) : (
          Array.from(groupedChecks.entries()).map(([category, categoryChecks]) => (
            <div key={category} style={styles.categoryGroup}>
              <div style={styles.categoryTitle}>{category}</div>
              {categoryChecks.map((check) => {
                const isExpanded = expandedCheck === check.id;
                return (
                  <div key={check.id} style={styles.checkCard}>
                    <div
                      style={styles.checkRow}
                      onClick={() => setExpandedCheck(isExpanded ? null : check.id)}
                    >
                      <span style={{
                        ...styles.statusBadge,
                        background: STATUS_COLORS[check.status] + '20',
                        color: STATUS_COLORS[check.status],
                        borderColor: STATUS_COLORS[check.status] + '40',
                      }}>
                        {STATUS_LABELS[check.status]}
                      </span>
                      <span style={styles.checkName}>{check.name}</span>
                      <span style={styles.checkScore}>
                        {check.score}/{check.maxScore}
                      </span>
                      <span style={styles.expandIcon}>
                        {isExpanded ? '\u25B2' : '\u25BC'}
                      </span>
                    </div>

                    {isExpanded && (
                      <div style={styles.checkDetails}>
                        <div style={styles.detailRow}>
                          <span style={styles.detailLabel}>Status:</span>
                          <span style={{ color: STATUS_COLORS[check.status] }}>
                            {check.details}
                          </span>
                        </div>
                        {check.recommendation && (
                          <div style={styles.detailRow}>
                            <span style={styles.detailLabel}>Fix:</span>
                            <span style={{ color: theme.textSecondary }}>
                              {check.recommendation}
                            </span>
                          </div>
                        )}
                        {check.affectedRefs && check.affectedRefs.length > 0 && (
                          <div style={styles.detailRow}>
                            <span style={styles.detailLabel}>Affected:</span>
                            <div style={styles.refTags}>
                              {check.affectedRefs.map((ref) => (
                                <span key={ref} style={styles.refTag}>{ref}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: theme.bg0,
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px 12px',
    borderBottom: theme.border,
    background: theme.bg1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  titleRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    fontSize: theme.fontLg,
    fontWeight: 700,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
  },
  subtitle: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontSans,
  },
  headerActions: {
    display: 'flex',
    gap: 8,
  },
  runBtn: {
    background: `linear-gradient(135deg, ${theme.blue}, ${theme.purple})`,
    border: 'none',
    borderRadius: theme.radiusSm,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '7px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  exportBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  scoreBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    padding: '16px 20px',
    borderBottom: theme.border,
    background: theme.bg1,
    flexShrink: 0,
  },
  scoreCircle: {
    flexShrink: 0,
  },
  statusSummary: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap' as const,
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusLabel: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
    fontWeight: 500,
  },
  checksContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
  },
  categoryGroup: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: theme.fontXs,
    fontWeight: 700,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '4px 0 8px',
    fontFamily: theme.fontSans,
  },
  checkCard: {
    background: theme.bg1,
    border: theme.border,
    borderRadius: theme.radiusSm,
    marginBottom: 4,
    overflow: 'hidden',
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    gap: 10,
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  statusBadge: {
    fontSize: '9px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 3,
    border: '1px solid',
    fontFamily: theme.fontMono,
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'center' as const,
  },
  checkName: {
    flex: 1,
    fontSize: theme.fontSm,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
    fontWeight: 500,
  },
  checkScore: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  expandIcon: {
    fontSize: '8px',
    color: theme.textMuted,
    flexShrink: 0,
  },
  checkDetails: {
    padding: '8px 12px 12px 54px',
    borderTop: `1px solid ${theme.bg3}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  detailRow: {
    display: 'flex',
    gap: 8,
    fontSize: theme.fontXs,
    lineHeight: 1.4,
    fontFamily: theme.fontSans,
  },
  detailLabel: {
    color: theme.textMuted,
    fontWeight: 600,
    minWidth: 50,
    flexShrink: 0,
  },
  refTags: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  refTag: {
    background: theme.redDim,
    color: theme.red,
    fontSize: '9px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
};

export default EMCPanel;
