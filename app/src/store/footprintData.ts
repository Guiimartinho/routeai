// ─── Footprint Data ─ Real pad geometry for common footprints ────────────────
// All dimensions in millimeters. Origin at component center unless noted.

import type { PadShape } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FootprintPad {
  number: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: PadShape;
  drill?: number;
  layers: string[];
}

export interface SilkLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FootprintDef {
  id: string;
  name: string;
  pads: FootprintPad[];
  courtyard: { width: number; height: number };
  silkscreen: SilkLine[];
  origin: { x: number; y: number };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Generate pads for a 2-terminal SMD passive (chip resistor/capacitor). */
function chip2(id: string, name: string, padW: number, padH: number, span: number, cyW: number, cyH: number): FootprintDef {
  const halfSpan = span / 2;
  return {
    id, name,
    pads: [
      { number: '1', x: -halfSpan, y: 0, width: padW, height: padH, shape: 'rect', layers: ['F.Cu'] },
      { number: '2', x: halfSpan,  y: 0, width: padW, height: padH, shape: 'rect', layers: ['F.Cu'] },
    ],
    courtyard: { width: cyW, height: cyH },
    silkscreen: [
      { x1: -cyW / 2, y1: -cyH / 2, x2: cyW / 2, y2: -cyH / 2 },
      { x1: cyW / 2, y1: -cyH / 2, x2: cyW / 2, y2: cyH / 2 },
      { x1: cyW / 2, y1: cyH / 2, x2: -cyW / 2, y2: cyH / 2 },
      { x1: -cyW / 2, y1: cyH / 2, x2: -cyW / 2, y2: -cyH / 2 },
    ],
    origin: { x: 0, y: 0 },
  };
}

/** Generate SOIC / TSSOP style dual-row gull-wing pads. */
function dualRow(
  id: string, name: string, pinCount: number, pitch: number,
  padW: number, padH: number, spanX: number,
  cyW: number, cyH: number,
): FootprintDef {
  const padsPerSide = pinCount / 2;
  const totalPitch = (padsPerSide - 1) * pitch;
  const startY = -totalPitch / 2;
  const halfSpanX = spanX / 2;
  const pads: FootprintPad[] = [];

  // Left side: pins 1..N/2 (top to bottom)
  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      number: String(i + 1),
      x: -halfSpanX, y: startY + i * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Right side: pins N/2+1..N (bottom to top)
  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      number: String(padsPerSide + i + 1),
      x: halfSpanX, y: startY + (padsPerSide - 1 - i) * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }

  const silk = rectSilk(cyW, cyH);
  // Pin 1 marker
  silk.push({ x1: -halfSpanX + padW / 2 + 0.3, y1: startY - 0.4, x2: -halfSpanX + padW / 2 + 0.6, y2: startY - 0.4 });

  return { id, name, pads, courtyard: { width: cyW, height: cyH }, silkscreen: silk, origin: { x: 0, y: 0 } };
}

/** Generate QFP style quad-row pads. */
function qfp(
  id: string, name: string, pinCount: number, pitch: number,
  padW: number, padH: number, spanX: number, spanY: number,
  cyW: number, cyH: number, epSize?: number,
): FootprintDef {
  const pinsPerSide = pinCount / 4;
  const totalPitch = (pinsPerSide - 1) * pitch;
  const startOffset = -totalPitch / 2;
  const halfSpanX = spanX / 2;
  const halfSpanY = spanY / 2;
  const pads: FootprintPad[] = [];
  let pin = 1;

  // Bottom side (left to right) - horizontal pads
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: startOffset + i * pitch, y: halfSpanY,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Right side (bottom to top) - vertical pads
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: halfSpanX, y: startOffset + (pinsPerSide - 1 - i) * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Top side (right to left) - horizontal pads
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: startOffset + (pinsPerSide - 1 - i) * pitch, y: -halfSpanY,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Left side (top to bottom) - vertical pads
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: -halfSpanX, y: startOffset + i * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }

  // Exposed pad
  if (epSize) {
    pads.push({
      number: 'EP',
      x: 0, y: 0,
      width: epSize, height: epSize, shape: 'rect', layers: ['F.Cu'],
    });
  }

  const silk = rectSilk(cyW, cyH);
  // Pin 1 marker
  silk.push({ x1: -cyW / 2 + 0.3, y1: cyH / 2 - 0.3, x2: -cyW / 2 + 0.6, y2: cyH / 2 - 0.6 });

  return { id, name, pads, courtyard: { width: cyW, height: cyH }, silkscreen: silk, origin: { x: 0, y: 0 } };
}

/** Generate QFN pads (bottom termination, no gull-wing). */
function qfn(
  id: string, name: string, pinCount: number, pitch: number,
  padW: number, padH: number, spanX: number, spanY: number,
  cyW: number, cyH: number, epSize: number,
): FootprintDef {
  // QFN is structurally identical to QFP in pad layout, just with exposed pad
  return qfp(id, name, pinCount, pitch, padW, padH, spanX, spanY, cyW, cyH, epSize);
}

/** Pin header: single row, through-hole. */
function pinHeader1xN(n: number): FootprintDef {
  const pitch = 2.54;
  const totalH = (n - 1) * pitch;
  const startY = -totalH / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < n; i++) {
    pads.push({
      number: String(i + 1),
      x: 0, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = 2.8;
  const cyH = totalH + 2.8;
  return {
    id: `PinHeader_1x${n}`,
    name: `Pin Header 1x${n}`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW, cyH),
    origin: { x: 0, y: 0 },
  };
}

/** Pin header: dual row, through-hole. */
function pinHeader2xN(n: number): FootprintDef {
  const pitch = 2.54;
  const rows = n; // n pins per row
  const totalH = (rows - 1) * pitch;
  const startY = -totalH / 2;
  const halfPitch = pitch / 2;
  const pads: FootprintPad[] = [];
  let pin = 1;
  for (let i = 0; i < rows; i++) {
    pads.push({
      number: String(pin++),
      x: -halfPitch, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
    pads.push({
      number: String(pin++),
      x: halfPitch, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = 2.54 + 2.8;
  const cyH = totalH + 2.8;
  return {
    id: `PinHeader_2x${n}`,
    name: `Pin Header 2x${n}`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW, cyH),
    origin: { x: 0, y: 0 },
  };
}

/** JST-XH connector. */
function jstXH(n: number): FootprintDef {
  const pitch = 2.5;
  const totalW = (n - 1) * pitch;
  const startX = -totalW / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < n; i++) {
    pads.push({
      number: String(i + 1),
      x: startX + i * pitch, y: 0,
      width: 1.5, height: 1.5, shape: 'circle', drill: 0.9,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = totalW + 5.0;
  const cyH = 6.0;
  return {
    id: `JST_XH_${n}`,
    name: `JST-XH ${n}-pin`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW, cyH),
    origin: { x: 0, y: 0 },
  };
}

function rectSilk(w: number, h: number): SilkLine[] {
  const hw = w / 2, hh = h / 2;
  return [
    { x1: -hw, y1: -hh, x2: hw, y2: -hh },
    { x1: hw, y1: -hh, x2: hw, y2: hh },
    { x1: hw, y1: hh, x2: -hw, y2: hh },
    { x1: -hw, y1: hh, x2: -hw, y2: -hh },
  ];
}

// ─── Footprint Database ─────────────────────────────────────────────────────

export const FOOTPRINT_DB: Record<string, FootprintDef> = {};

function reg(f: FootprintDef) { FOOTPRINT_DB[f.id] = f; }

// ── Chip passives ───────────────────────────────────────────────────────────
reg(chip2('0402', '0402 (1005 Metric)', 0.6, 0.5, 0.5, 1.6, 0.9));
reg(chip2('0603', '0603 (1608 Metric)', 0.9, 0.8, 0.8, 2.4, 1.4));
reg(chip2('0805', '0805 (2012 Metric)', 1.2, 1.0, 1.0, 3.0, 1.8));
reg(chip2('1206', '1206 (3216 Metric)', 1.6, 1.2, 1.6, 4.4, 2.0));

// ── LED packages ────────────────────────────────────────────────────────────
reg(chip2('LED_0805', 'LED 0805', 1.2, 1.0, 1.0, 3.0, 1.8));
reg({
  id: 'LED_3mm', name: 'LED 3mm Through-Hole',
  pads: [
    { number: '1', x: -1.27, y: 0, width: 1.5, height: 1.5, shape: 'rect', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 1.27, y: 0, width: 1.5, height: 1.5, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 4.4, height: 4.4 },
  silkscreen: [
    // Circle outline approximated as octagon
    { x1: -1.5, y1: -0.6, x2: -0.6, y2: -1.5 },
    { x1: -0.6, y1: -1.5, x2: 0.6, y2: -1.5 },
    { x1: 0.6, y1: -1.5, x2: 1.5, y2: -0.6 },
    { x1: 1.5, y1: -0.6, x2: 1.5, y2: 0.6 },
    { x1: 1.5, y1: 0.6, x2: 0.6, y2: 1.5 },
    { x1: 0.6, y1: 1.5, x2: -0.6, y2: 1.5 },
    { x1: -0.6, y1: 1.5, x2: -1.5, y2: 0.6 },
    { x1: -1.5, y1: 0.6, x2: -1.5, y2: -0.6 },
  ],
  origin: { x: 0, y: 0 },
});
reg({
  id: 'LED_5mm', name: 'LED 5mm Through-Hole',
  pads: [
    { number: '1', x: -1.27, y: 0, width: 1.8, height: 1.8, shape: 'rect', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 1.27, y: 0, width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 6.0, height: 6.0 },
  silkscreen: rectSilk(5.5, 5.5),
  origin: { x: 0, y: 0 },
});

// ── SOT-23 family ───────────────────────────────────────────────────────────
reg({
  id: 'SOT-23', name: 'SOT-23 (3-pin)',
  pads: [
    { number: '1', x: -0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 0, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 3.0, height: 3.2 },
  silkscreen: rectSilk(2.6, 2.8),
  origin: { x: 0, y: 0 },
});
reg({
  id: 'SOT-23-5', name: 'SOT-23-5 (5-pin)',
  pads: [
    { number: '1', x: -0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 0.95, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: -0.95, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 3.0, height: 3.2 },
  silkscreen: rectSilk(2.6, 2.8),
  origin: { x: 0, y: 0 },
});
reg({
  id: 'SOT-23-6', name: 'SOT-23-6 (6-pin)',
  pads: [
    { number: '1', x: -0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 0.95, y: 1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 0.95, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 0, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: -0.95, y: -1.1, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 3.0, height: 3.2 },
  silkscreen: rectSilk(2.6, 2.8),
  origin: { x: 0, y: 0 },
});

// ── SOIC family ─────────────────────────────────────────────────────────────
reg(dualRow('SOIC-8',  'SOIC-8 (1.27mm pitch)',  8,  1.27, 1.6, 0.6, 5.4, 6.2, 5.4));
reg(dualRow('SOIC-14', 'SOIC-14 (1.27mm pitch)', 14, 1.27, 1.6, 0.6, 5.4, 6.2, 9.8));
reg(dualRow('SOIC-16', 'SOIC-16 (1.27mm pitch)', 16, 1.27, 1.6, 0.6, 5.4, 6.2, 10.8));

// ── TSSOP family ────────────────────────────────────────────────────────────
reg(dualRow('TSSOP-8',  'TSSOP-8 (0.65mm pitch)',  8,  0.65, 1.4, 0.4, 5.0, 5.6, 3.4));
reg(dualRow('TSSOP-14', 'TSSOP-14 (0.65mm pitch)', 14, 0.65, 1.4, 0.4, 5.0, 5.6, 5.4));
reg(dualRow('TSSOP-16', 'TSSOP-16 (0.65mm pitch)', 16, 0.65, 1.4, 0.4, 5.0, 5.6, 5.8));
reg(dualRow('TSSOP-20', 'TSSOP-20 (0.65mm pitch)', 20, 0.65, 1.4, 0.4, 5.0, 5.6, 7.2));

// ── DFN-8 ───────────────────────────────────────────────────────────────────
reg({
  id: 'DFN-8', name: 'DFN-8 (0.5mm pitch)',
  pads: [
    { number: '1', x: -1.45, y: -0.75, width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -1.45, y: -0.25, width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: -1.45, y: 0.25,  width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: -1.45, y: 0.75,  width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 1.45, y: 0.75,   width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: 1.45, y: 0.25,   width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '7', x: 1.45, y: -0.25,  width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: '8', x: 1.45, y: -0.75,  width: 0.7, height: 0.25, shape: 'rect', layers: ['F.Cu'] },
    { number: 'EP', x: 0, y: 0, width: 1.7, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 4.0, height: 3.0 },
  silkscreen: rectSilk(3.2, 2.2),
  origin: { x: 0, y: 0 },
});

// ── QFP family ──────────────────────────────────────────────────────────────
reg(qfp('QFP-32',  'QFP-32 (0.8mm pitch)',  32,  0.8, 1.6, 0.4, 5.6, 5.6, 9.2, 9.2));
reg(qfp('QFP-44',  'QFP-44 (0.8mm pitch)',  44,  0.8, 1.6, 0.4, 6.8, 6.8, 12.4, 12.4));
reg(qfp('QFP-48',  'QFP-48 (0.5mm pitch)',  48,  0.5, 1.4, 0.3, 5.6, 5.6, 9.2, 9.2));
reg(qfp('QFP-64',  'QFP-64 (0.5mm pitch)',  64,  0.5, 1.4, 0.3, 6.6, 6.6, 12.2, 12.2));
reg(qfp('QFP-100', 'QFP-100 (0.5mm pitch)', 100, 0.5, 1.4, 0.3, 8.6, 8.6, 16.2, 16.2));

// LQFP-48 (specific for STM32F103 etc)
reg(qfp('LQFP-48', 'LQFP-48 (0.5mm pitch, 7x7mm)', 48, 0.5, 1.5, 0.28, 8.4, 8.4, 9.8, 9.8));

// ── QFN family ──────────────────────────────────────────────────────────────
reg(qfn('QFN-16', 'QFN-16 (0.5mm pitch)', 16, 0.5, 0.8, 0.25, 2.5, 2.5, 3.4, 3.4, 1.5));
reg(qfn('QFN-20', 'QFN-20 (0.5mm pitch)', 20, 0.5, 0.8, 0.25, 3.0, 3.0, 4.4, 4.4, 2.0));
reg(qfn('QFN-24', 'QFN-24 (0.5mm pitch)', 24, 0.5, 0.8, 0.25, 3.5, 3.5, 4.8, 4.8, 2.5));
reg(qfn('QFN-32', 'QFN-32 (0.5mm pitch)', 32, 0.5, 0.8, 0.25, 4.0, 4.0, 5.8, 5.8, 3.0));
reg(qfn('QFN-48', 'QFN-48 (0.5mm pitch)', 48, 0.5, 0.8, 0.25, 5.0, 5.0, 7.8, 7.8, 4.5));

// ── BGA packages ────────────────────────────────────────────────────────────
function bga(id: string, name: string, cols: number, rows: number, pitch: number, padDia: number, cyW: number, cyH: number): FootprintDef {
  const pads: FootprintPad[] = [];
  const startX = -((cols - 1) * pitch) / 2;
  const startY = -((rows - 1) * pitch) / 2;
  const letters = 'ABCDEFGHJKLMNPRTUVWY'; // BGA row labels (skip I, O, Q, S, X, Z)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pads.push({
        number: `${letters[r] || 'Z'}${c + 1}`,
        x: startX + c * pitch,
        y: startY + r * pitch,
        width: padDia, height: padDia, shape: 'circle',
        layers: ['F.Cu'],
      });
    }
  }
  return {
    id, name, pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.5, cyH - 0.5),
    origin: { x: 0, y: 0 },
  };
}

reg(bga('BGA-256_1.0mm', 'BGA-256 (1.0mm pitch)', 16, 16, 1.0, 0.5, 18.0, 18.0));
reg(bga('BGA-100_0.8mm', 'BGA-100 (0.8mm pitch)', 10, 10, 0.8, 0.4, 10.0, 10.0));
reg(bga('BGA-64_0.5mm',  'BGA-64 (0.5mm pitch)',  8,  8,  0.5, 0.25, 5.5, 5.5));

// ── Through-hole power packages ─────────────────────────────────────────────
reg({
  id: 'TO-220', name: 'TO-220-3',
  pads: [
    { number: '1', x: -2.54, y: 0, width: 1.8, height: 1.8, shape: 'circle', drill: 1.1, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 0,     y: 0, width: 1.8, height: 1.8, shape: 'circle', drill: 1.1, layers: ['F.Cu', 'B.Cu'] },
    { number: '3', x: 2.54,  y: 0, width: 1.8, height: 1.8, shape: 'circle', drill: 1.1, layers: ['F.Cu', 'B.Cu'] },
    // Mounting tab
    { number: 'TAB', x: 0, y: -4.5, width: 6.0, height: 6.0, shape: 'rect', drill: 3.5, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 11.0, height: 16.0 },
  silkscreen: [
    { x1: -5.2, y1: -2.0, x2: 5.2, y2: -2.0 },
    { x1: 5.2, y1: -2.0, x2: 5.2, y2: 2.6 },
    { x1: 5.2, y1: 2.6, x2: -5.2, y2: 2.6 },
    { x1: -5.2, y1: 2.6, x2: -5.2, y2: -2.0 },
    { x1: -5.2, y1: -7.5, x2: 5.2, y2: -7.5 },
    { x1: 5.2, y1: -7.5, x2: 5.2, y2: -2.0 },
    { x1: -5.2, y1: -7.5, x2: -5.2, y2: -2.0 },
  ],
  origin: { x: 0, y: 0 },
});

reg({
  id: 'TO-252', name: 'TO-252 (DPAK)',
  pads: [
    { number: '1', x: -2.3, y: 3.4, width: 1.0, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 2.3,  y: 3.4, width: 1.0, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0, y: -1.5, width: 5.6, height: 6.0, shape: 'rect', layers: ['F.Cu'] }, // Tab pad
  ],
  courtyard: { width: 7.6, height: 10.4 },
  silkscreen: rectSilk(7.0, 9.8),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'TO-263', name: 'TO-263 (D2PAK)',
  pads: [
    { number: '1', x: -2.54, y: 4.0, width: 1.2, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 2.54,  y: 4.0, width: 1.2, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0, y: -2.0, width: 8.0, height: 8.0, shape: 'rect', layers: ['F.Cu'] }, // Tab pad
  ],
  courtyard: { width: 10.6, height: 14.0 },
  silkscreen: rectSilk(10.0, 13.0),
  origin: { x: 0, y: 0 },
});

// ── Crystal packages ────────────────────────────────────────────────────────
reg({
  id: 'HC-49', name: 'Crystal HC-49 Through-Hole',
  pads: [
    { number: '1', x: -2.44, y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 2.44,  y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 12.0, height: 5.0 },
  silkscreen: [
    { x1: -5.5, y1: -2.0, x2: 5.5, y2: -2.0 },
    { x1: 5.5, y1: -2.0, x2: 5.5, y2: 2.0 },
    { x1: 5.5, y1: 2.0, x2: -5.5, y2: 2.0 },
    { x1: -5.5, y1: 2.0, x2: -5.5, y2: -2.0 },
  ],
  origin: { x: 0, y: 0 },
});

reg({
  id: 'Crystal_3.2x2.5', name: 'Crystal 3.2x2.5mm SMD',
  pads: [
    { number: '1', x: -1.1, y: -0.75, width: 1.0, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 1.1,  y: -0.75, width: 1.0, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 1.1,  y: 0.75,  width: 1.0, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: -1.1, y: 0.75,  width: 1.0, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 4.0, height: 3.4 },
  silkscreen: rectSilk(3.6, 3.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'Crystal_5x3.2', name: 'Crystal 5x3.2mm SMD',
  pads: [
    { number: '1', x: -1.85, y: -1.0, width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 1.85,  y: -1.0, width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 1.85,  y: 1.0,  width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: -1.85, y: 1.0,  width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 5.8, height: 4.0 },
  silkscreen: rectSilk(5.4, 3.6),
  origin: { x: 0, y: 0 },
});

// ── USB connectors ──────────────────────────────────────────────────────────
reg({
  id: 'USB-A', name: 'USB-A Receptacle',
  pads: [
    { number: '1', x: -3.5, y: 0, width: 1.5, height: 1.0, shape: 'rect', layers: ['F.Cu'] },   // VBUS
    { number: '2', x: -1.0, y: 0, width: 1.5, height: 1.0, shape: 'rect', layers: ['F.Cu'] },   // D-
    { number: '3', x: 1.0,  y: 0, width: 1.5, height: 1.0, shape: 'rect', layers: ['F.Cu'] },   // D+
    { number: '4', x: 3.5,  y: 0, width: 1.5, height: 1.0, shape: 'rect', layers: ['F.Cu'] },   // GND
    // Shield
    { number: 'S1', x: -6.0, y: -2.0, width: 2.5, height: 2.0, shape: 'oval', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    { number: 'S2', x: 6.0,  y: -2.0, width: 2.5, height: 2.0, shape: 'oval', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 14.5, height: 14.0 },
  silkscreen: rectSilk(14.0, 13.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'USB-B-Micro', name: 'USB Micro-B',
  pads: [
    { number: '1', x: -1.3, y: 0, width: 0.4, height: 1.35, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -0.65, y: 0, width: 0.4, height: 1.35, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 0,     y: 0, width: 0.4, height: 1.35, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 0.65,  y: 0, width: 0.4, height: 1.35, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 1.3,   y: 0, width: 0.4, height: 1.35, shape: 'rect', layers: ['F.Cu'] },
    // Shell
    { number: 'S1', x: -3.4, y: 0.4, width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
    { number: 'S2', x: 3.4,  y: 0.4, width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 9.0, height: 6.0 },
  silkscreen: rectSilk(8.4, 5.4),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'USB-C-16', name: 'USB Type-C 16-pin',
  pads: [
    // Left column (A side)
    { number: 'A1',  x: -2.75, y: -2.5, width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] }, // GND
    { number: 'A4',  x: -2.75, y: -1.5, width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] }, // VBUS
    { number: 'A6',  x: -2.75, y: -0.5, width: 0.3, height: 0.7, shape: 'rect', layers: ['F.Cu'] }, // D+
    { number: 'A7',  x: -2.75, y: 0.5,  width: 0.3, height: 0.7, shape: 'rect', layers: ['F.Cu'] }, // D-
    { number: 'A9',  x: -2.75, y: 1.5,  width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] }, // VBUS
    { number: 'A12', x: -2.75, y: 2.5,  width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] }, // GND
    // Right column (B side)
    { number: 'B1',  x: 2.75, y: -2.5, width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: 'B4',  x: 2.75, y: -1.5, width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: 'B6',  x: 2.75, y: -0.5, width: 0.3, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: 'B7',  x: 2.75, y: 0.5,  width: 0.3, height: 0.7, shape: 'rect', layers: ['F.Cu'] },
    { number: 'B9',  x: 2.75, y: 1.5,  width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: 'B12', x: 2.75, y: 2.5,  width: 0.3, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    // Shield mounting
    { number: 'S1', x: -4.3, y: -3.3, width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
    { number: 'S2', x: 4.3,  y: -3.3, width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
    { number: 'S3', x: -4.3, y: 3.3,  width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
    { number: 'S4', x: 4.3,  y: 3.3,  width: 1.8, height: 1.8, shape: 'oval', drill: 1.0, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 10.6, height: 8.8 },
  silkscreen: rectSilk(9.6, 8.0),
  origin: { x: 0, y: 0 },
});

// ── Pin Headers ─────────────────────────────────────────────────────────────
for (let n = 2; n <= 20; n++) reg(pinHeader1xN(n));
for (const n of [5, 6, 7, 8, 10, 13, 17, 20]) reg(pinHeader2xN(n));

// ── JST-XH connectors ──────────────────────────────────────────────────────
for (let n = 2; n <= 6; n++) reg(jstXH(n));

// ── SMA connector ───────────────────────────────────────────────────────────
reg({
  id: 'SMA_Edge', name: 'SMA Edge-Mount Connector',
  pads: [
    { number: '1', x: 0, y: 0, width: 1.5, height: 1.5, shape: 'circle', layers: ['F.Cu'] }, // Signal
    { number: '2', x: -2.54, y: 2.54, width: 2.0, height: 2.0, shape: 'rect', drill: 1.2, layers: ['F.Cu', 'B.Cu'] }, // GND
    { number: '3', x: 2.54,  y: 2.54, width: 2.0, height: 2.0, shape: 'rect', drill: 1.2, layers: ['F.Cu', 'B.Cu'] }, // GND
    { number: '4', x: -2.54, y: -2.54, width: 2.0, height: 2.0, shape: 'rect', drill: 1.2, layers: ['F.Cu', 'B.Cu'] }, // GND
    { number: '5', x: 2.54,  y: -2.54, width: 2.0, height: 2.0, shape: 'rect', drill: 1.2, layers: ['F.Cu', 'B.Cu'] }, // GND
  ],
  courtyard: { width: 8.0, height: 8.0 },
  silkscreen: rectSilk(7.0, 7.0),
  origin: { x: 0, y: 0 },
});

// ── RJ45 ────────────────────────────────────────────────────────────────────
reg({
  id: 'RJ45', name: 'RJ45 Ethernet Jack',
  pads: (() => {
    const pads: FootprintPad[] = [];
    // 8 signal pins at 1.02mm pitch
    const startX = -3.57;
    for (let i = 0; i < 8; i++) {
      pads.push({
        number: String(i + 1),
        x: startX + i * 1.02, y: 0,
        width: 1.2, height: 1.2, shape: 'circle', drill: 0.8,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
    // Shield / mounting pins
    pads.push(
      { number: 'S1', x: -7.9, y: -5.8, width: 2.4, height: 2.4, shape: 'oval', drill: 1.6, layers: ['F.Cu', 'B.Cu'] },
      { number: 'S2', x: 7.9,  y: -5.8, width: 2.4, height: 2.4, shape: 'oval', drill: 1.6, layers: ['F.Cu', 'B.Cu'] },
    );
    return pads;
  })(),
  courtyard: { width: 18.0, height: 16.0 },
  silkscreen: rectSilk(16.5, 14.0),
  origin: { x: 0, y: 0 },
});

// ══════════════════════════════════════════════════════════════════════════════
// NEW FOOTPRINTS – added below. All existing entries above are untouched.
// ══════════════════════════════════════════════════════════════════════════════

// ── Additional helper functions ─────────────────────────────────────────────

/** Generate DIP through-hole package. Row spacing = 7.62mm (300mil). */
function dip(pinCount: number): FootprintDef {
  const padsPerSide = pinCount / 2;
  const pitch = 2.54;
  const rowSpacing = 7.62;
  const totalH = (padsPerSide - 1) * pitch;
  const startY = -totalH / 2;
  const halfRow = rowSpacing / 2;
  const pads: FootprintPad[] = [];
  // Left side: pins 1..N/2 top to bottom
  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      number: String(i + 1),
      x: -halfRow, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: i === 0 ? 'rect' : 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  // Right side: pins N/2+1..N bottom to top
  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      number: String(padsPerSide + i + 1),
      x: halfRow, y: startY + (padsPerSide - 1 - i) * pitch,
      width: 1.7, height: 1.7, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = rowSpacing + 3.0;
  const cyH = totalH + 3.0;
  const silk = rectSilk(cyW, cyH);
  // Notch at top
  silk.push({ x1: -1.0, y1: -cyH / 2, x2: 0, y2: -cyH / 2 + 0.5 });
  silk.push({ x1: 0, y1: -cyH / 2 + 0.5, x2: 1.0, y2: -cyH / 2 });
  return {
    id: `DIP-${pinCount}`,
    name: `DIP-${pinCount} (2.54mm pitch, 7.62mm row)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: silk,
    origin: { x: 0, y: 0 },
  };
}

/** Generate SIP (single inline package) through-hole. */
function sip(pinCount: number): FootprintDef {
  const pitch = 2.54;
  const totalH = (pinCount - 1) * pitch;
  const startY = -totalH / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      number: String(i + 1),
      x: 0, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: i === 0 ? 'rect' : 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = 3.0;
  const cyH = totalH + 3.0;
  return {
    id: `SIP-${pinCount}`,
    name: `SIP-${pinCount} (2.54mm pitch)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW, cyH),
    origin: { x: 0, y: 0 },
  };
}

/** Generate SSOP dual-row package. */
function ssop(pinCount: number): FootprintDef {
  // SSOP uses 0.65mm pitch, 5.3mm span, similar to TSSOP but wider body
  return dualRow(`SSOP-${pinCount}`, `SSOP-${pinCount} (0.65mm pitch)`, pinCount, 0.65, 1.5, 0.4, 5.6, 6.2, (pinCount / 2 - 1) * 0.65 + 2.0);
}

/** Generate PLCC (J-lead) package – pads on all 4 sides. */
function plcc(pinCount: number): FootprintDef {
  const pinsPerSide = pinCount / 4;
  const pitch = 1.27;
  const totalPitch = (pinsPerSide - 1) * pitch;
  const startOffset = -totalPitch / 2;
  // PLCC body sizes vary; compute from pin count
  const bodySize = pinsPerSide * pitch + 2.0;
  const halfBody = bodySize / 2;
  const padSpan = bodySize + 1.0;
  const halfSpan = padSpan / 2;
  const padW = 1.8;
  const padH = 0.6;
  const pads: FootprintPad[] = [];
  let pin = 1;
  // Bottom side (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: startOffset + i * pitch, y: halfSpan,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Right side (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: halfSpan, y: startOffset + (pinsPerSide - 1 - i) * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Top side (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: startOffset + (pinsPerSide - 1 - i) * pitch, y: -halfSpan,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Left side (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      number: String(pin++),
      x: -halfSpan, y: startOffset + i * pitch,
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'],
    });
  }
  const cyW = padSpan + padW + 0.5;
  const cyH = padSpan + padW + 0.5;
  const silk = rectSilk(cyW, cyH);
  silk.push({ x1: -cyW / 2 + 0.3, y1: cyH / 2 - 0.3, x2: -cyW / 2 + 0.6, y2: cyH / 2 - 0.6 });
  return {
    id: `PLCC-${pinCount}`,
    name: `PLCC-${pinCount} (1.27mm pitch)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: silk,
    origin: { x: 0, y: 0 },
  };
}

/** Generate FPC/FFC SMD connector (0.5mm pitch, bottom-contact). */
function fpcConnector(pinCount: number): FootprintDef {
  const pitch = 0.5;
  const totalW = (pinCount - 1) * pitch;
  const startX = -totalW / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      number: String(i + 1),
      x: startX + i * pitch, y: 0,
      width: 0.3, height: 1.2, shape: 'rect', layers: ['F.Cu'],
    });
  }
  // Mounting / shell pads
  const halfW = totalW / 2 + 1.5;
  pads.push(
    { number: 'S1', x: -halfW, y: -2.0, width: 1.2, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: 'S2', x: halfW,  y: -2.0, width: 1.2, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
  );
  const cyW = totalW + 5.0;
  const cyH = 5.5;
  return {
    id: `FPC_${pinCount}_0.5mm`,
    name: `FPC/FFC ${pinCount}-pin (0.5mm pitch)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.5, cyH - 0.5),
    origin: { x: 0, y: 0 },
  };
}

/** Generate IDC shrouded header (2xN, 2.54mm pitch). */
function idcHeader(pinsPerRow: number): FootprintDef {
  const pitch = 2.54;
  const totalPins = pinsPerRow * 2;
  const totalH = (pinsPerRow - 1) * pitch;
  const startY = -totalH / 2;
  const halfPitch = pitch / 2;
  const pads: FootprintPad[] = [];
  let pin = 1;
  for (let i = 0; i < pinsPerRow; i++) {
    pads.push({
      number: String(pin++),
      x: -halfPitch, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: pin === 2 ? 'rect' : 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
    pads.push({
      number: String(pin++),
      x: halfPitch, y: startY + i * pitch,
      width: 1.7, height: 1.7, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  // Shrouded housing is wider/taller than plain header
  const cyW = 2.54 + 5.5;
  const cyH = totalH + 5.5;
  return {
    id: `IDC_2x${pinsPerRow}`,
    name: `IDC Header 2x${pinsPerRow} (${totalPins}-pin, shrouded)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.3, cyH - 0.3),
    origin: { x: 0, y: 0 },
  };
}

/** Generate Molex Micro-Fit 3.0 connector (3.0mm pitch, through-hole). */
function molexMicroFit(pinCount: number): FootprintDef {
  const pitch = 3.0;
  const cols = pinCount <= 2 ? pinCount : 2;
  const rows = Math.ceil(pinCount / 2);
  const totalW = (cols - 1) * pitch;
  const totalH = (rows - 1) * pitch;
  const startX = -totalW / 2;
  const startY = -totalH / 2;
  const pads: FootprintPad[] = [];
  let pin = 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pin > pinCount) break;
      pads.push({
        number: String(pin++),
        x: startX + c * pitch, y: startY + r * pitch,
        width: 1.8, height: 1.8, shape: 'circle', drill: 1.0,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
  }
  // Mounting pegs
  const pegX = totalW / 2 + 3.5;
  pads.push(
    { number: 'MP1', x: -pegX, y: 0, width: 3.0, height: 3.0, shape: 'oval', drill: 2.4, layers: ['F.Cu', 'B.Cu'] },
    { number: 'MP2', x: pegX,  y: 0, width: 3.0, height: 3.0, shape: 'oval', drill: 2.4, layers: ['F.Cu', 'B.Cu'] },
  );
  const cyW = totalW + 10.0;
  const cyH = totalH + 6.5;
  return {
    id: `Molex_MicroFit_${pinCount}`,
    name: `Molex Micro-Fit 3.0 ${pinCount}-pin`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.5, cyH - 0.5),
    origin: { x: 0, y: 0 },
  };
}

/** Generate Molex KK 254 connector (2.54mm pitch, through-hole, vertical). */
function molexKK(pinCount: number): FootprintDef {
  const pitch = 2.54;
  const totalW = (pinCount - 1) * pitch;
  const startX = -totalW / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      number: String(i + 1),
      x: startX + i * pitch, y: 0,
      width: 1.5, height: 1.5, shape: 'circle', drill: 1.0,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = totalW + 5.0;
  const cyH = 6.0;
  return {
    id: `Molex_KK_${pinCount}`,
    name: `Molex KK 254 ${pinCount}-pin (2.54mm)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.5, cyH - 0.5),
    origin: { x: 0, y: 0 },
  };
}

/** Generate screw terminal block (through-hole). */
function screwTerminal(pinCount: number, pitch: number): FootprintDef {
  const totalW = (pinCount - 1) * pitch;
  const startX = -totalW / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      number: String(i + 1),
      x: startX + i * pitch, y: 0,
      width: 2.2, height: 2.2, shape: 'circle', drill: 1.3,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = totalW + pitch + 2.0;
  const cyH = pitch + 4.0;
  const idPitch = pitch.toFixed(2).replace('.', '_');
  return {
    id: `ScrewTerminal_${pinCount}P_${idPitch}mm`,
    name: `Screw Terminal ${pinCount}-pin (${pitch}mm)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.3, cyH - 0.3),
    origin: { x: 0, y: 0 },
  };
}

/** Generate Phoenix Contact MSTB connector (5.08mm pitch). */
function phoenixMSTB(pinCount: number): FootprintDef {
  const pitch = 5.08;
  const totalW = (pinCount - 1) * pitch;
  const startX = -totalW / 2;
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      number: String(i + 1),
      x: startX + i * pitch, y: 0,
      width: 2.4, height: 2.4, shape: 'circle', drill: 1.4,
      layers: ['F.Cu', 'B.Cu'],
    });
  }
  const cyW = totalW + pitch + 3.0;
  const cyH = 10.0;
  return {
    id: `Phoenix_MSTB_${pinCount}`,
    name: `Phoenix Contact MSTB ${pinCount}-pin (5.08mm)`,
    pads,
    courtyard: { width: cyW, height: cyH },
    silkscreen: rectSilk(cyW - 0.3, cyH - 0.3),
    origin: { x: 0, y: 0 },
  };
}

/** Generate inductor SMD footprint (square or rectangular). */
function inductorSMD(sizeTag: string, padW: number, padH: number, span: number, cyW: number, cyH: number): FootprintDef {
  return chip2(`Inductor_SMD_${sizeTag}`, `Inductor SMD ${sizeTag}`, padW, padH, span, cyW, cyH);
}

// ── Larger chip passives ────────────────────────────────────────────────────
reg(chip2('1210', '1210 (3216 Metric)', 1.4, 2.0, 1.5, 3.8, 2.8));
reg(chip2('1812', '1812 (4532 Metric)', 1.8, 2.8, 2.0, 5.2, 3.6));
reg(chip2('2010', '2010 (5025 Metric)', 1.8, 2.0, 2.5, 5.8, 2.8));
reg(chip2('2012', '2012 (5032 Metric)', 1.8, 2.8, 2.5, 5.8, 3.6));
reg(chip2('2512', '2512 (6332 Metric)', 2.0, 2.8, 3.0, 7.0, 3.6));
reg(chip2('2520', '2520 (6350 Metric)', 2.0, 4.5, 3.0, 7.0, 5.4));
reg(chip2('3216', '3216 Tantalum Cap', 2.0, 3.2, 3.2, 8.6, 4.4));
reg(chip2('3528', '3528 Tantalum Cap', 2.4, 5.6, 3.6, 9.8, 7.6));
reg(chip2('7343', '7343 Tantalum D Case', 2.0, 3.6, 3.4, 8.0, 4.8));

// ── Electrolytic / can capacitors ───────────────────────────────────────────
reg({
  id: 'CAP_SMD_6.3x5.4', name: 'SMD Electrolytic 6.3x5.4mm',
  pads: [
    { number: '1', x: -2.5, y: 0, width: 1.5, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 2.5,  y: 0, width: 1.5, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 7.8, height: 6.8 },
  silkscreen: rectSilk(7.2, 6.2),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'CAP_SMD_8x6.5', name: 'SMD Electrolytic 8x6.5mm',
  pads: [
    { number: '1', x: -3.2, y: 0, width: 1.8, height: 2.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 3.2,  y: 0, width: 1.8, height: 2.4, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 9.6, height: 8.4 },
  silkscreen: rectSilk(9.0, 7.8),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'CAP_SMD_10x10', name: 'SMD Electrolytic 10x10mm',
  pads: [
    { number: '1', x: -4.0, y: 0, width: 2.2, height: 3.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 4.0,  y: 0, width: 2.2, height: 3.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 12.0, height: 11.0 },
  silkscreen: rectSilk(11.4, 10.4),
  origin: { x: 0, y: 0 },
});

// ── Power semiconductors ────────────────────────────────────────────────────
reg({
  id: 'SOT-89', name: 'SOT-89-3',
  pads: [
    { number: '1', x: -1.5, y: 1.5, width: 0.8, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0,    y: 1.5, width: 0.8, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 1.5,  y: 1.5, width: 0.8, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    // Collector tab (back)
    { number: '2T', x: 0, y: -1.0, width: 3.1, height: 2.2, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 4.8, height: 4.8 },
  silkscreen: rectSilk(4.2, 4.2),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'SOT-223', name: 'SOT-223-4',
  pads: [
    { number: '1', x: -2.3, y: 3.15, width: 0.8, height: 1.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0,    y: 3.15, width: 0.8, height: 1.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 2.3,  y: 3.15, width: 0.8, height: 1.8, shape: 'rect', layers: ['F.Cu'] },
    // Tab pad on back
    { number: '4', x: 0, y: -3.15, width: 3.5, height: 1.8, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 7.4, height: 8.0 },
  silkscreen: rectSilk(6.8, 7.4),
  origin: { x: 0, y: 0 },
});

// TO-252 and TO-263 already defined above

reg({
  id: 'TO-263-5', name: 'TO-263-5 (D2PAK-5)',
  pads: [
    { number: '1', x: -3.4,  y: 4.0, width: 1.0, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -1.7,  y: 4.0, width: 1.0, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 0,     y: 4.0, width: 1.0, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 1.7,   y: 4.0, width: 1.0, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 3.4,   y: 4.0, width: 1.0, height: 2.0, shape: 'rect', layers: ['F.Cu'] },
    // Tab pad
    { number: 'TAB', x: 0, y: -2.0, width: 8.0, height: 8.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 11.0, height: 14.0 },
  silkscreen: rectSilk(10.4, 13.4),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'PowerPAK_SO-8', name: 'PowerPAK SO-8',
  pads: [
    // Left side pins (1.27mm pitch)
    { number: '1', x: -2.7, y: -1.905, width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -2.7, y: -0.635, width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: -2.7, y: 0.635,  width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: -2.7, y: 1.905,  width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    // Right side pins
    { number: '5', x: 2.7, y: 1.905,  width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: 2.7, y: 0.635,  width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '7', x: 2.7, y: -0.635, width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    { number: '8', x: 2.7, y: -1.905, width: 1.2, height: 0.6, shape: 'rect', layers: ['F.Cu'] },
    // Exposed pad
    { number: 'EP', x: 0.6, y: 0, width: 3.0, height: 4.4, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 7.2, height: 5.6 },
  silkscreen: rectSilk(6.6, 5.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'SOT-669', name: 'SOT-669 (LFPAK33)',
  pads: [
    { number: '1', x: -1.0, y: 1.45, width: 0.6, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0,    y: 1.45, width: 0.6, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 1.0,  y: 1.45, width: 0.6, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 0,    y: 1.45, width: 0.6, height: 0.8, shape: 'rect', layers: ['F.Cu'] },
    // Tab pad
    { number: 'TAB', x: 0, y: -0.5, width: 2.6, height: 1.8, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 3.8, height: 3.8 },
  silkscreen: rectSilk(3.4, 3.4),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'LFPAK56', name: 'LFPAK56 (SOT-1054)',
  pads: [
    { number: '1', x: -1.27, y: 2.3, width: 0.7, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: 0,     y: 2.3, width: 0.7, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 1.27,  y: 2.3, width: 0.7, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: -1.27, y: 2.3, width: 0.7, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 1.27,  y: 2.3, width: 0.7, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    // Large tab pad
    { number: 'TAB', x: 0, y: -0.8, width: 4.6, height: 3.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 6.0, height: 6.0 },
  silkscreen: rectSilk(5.6, 5.6),
  origin: { x: 0, y: 0 },
});

// ── Larger IC packages: SSOP ────────────────────────────────────────────────
reg(ssop(20));
reg(ssop(24));
reg(ssop(28));

// ── TQFP family ─────────────────────────────────────────────────────────────
reg(qfp('TQFP-32',  'TQFP-32 (0.8mm pitch, 7x7mm)',  32,  0.8, 1.5, 0.35, 8.4, 8.4, 9.8, 9.8));
reg(qfp('TQFP-44',  'TQFP-44 (0.8mm pitch, 10x10mm)', 44,  0.8, 1.5, 0.35, 11.4, 11.4, 13.0, 13.0));
reg(qfp('TQFP-48',  'TQFP-48 (0.5mm pitch, 7x7mm)',  48,  0.5, 1.4, 0.28, 8.4, 8.4, 9.8, 9.8));
reg(qfp('TQFP-64',  'TQFP-64 (0.5mm pitch, 10x10mm)', 64,  0.5, 1.4, 0.28, 11.4, 11.4, 13.0, 13.0));
reg(qfp('TQFP-100', 'TQFP-100 (0.5mm pitch, 14x14mm)', 100, 0.5, 1.4, 0.28, 15.4, 15.4, 17.0, 17.0));
reg(qfp('TQFP-144', 'TQFP-144 (0.5mm pitch, 20x20mm)', 144, 0.5, 1.4, 0.28, 21.4, 21.4, 23.0, 23.0));

// ── QFP larger sizes ────────────────────────────────────────────────────────
reg(qfp('QFP-144', 'QFP-144 (0.5mm pitch)', 144, 0.5, 1.4, 0.3, 10.6, 10.6, 22.0, 22.0));
reg(qfp('QFP-176', 'QFP-176 (0.5mm pitch)', 176, 0.5, 1.4, 0.3, 12.6, 12.6, 26.0, 26.0));
reg(qfp('QFP-208', 'QFP-208 (0.5mm pitch)', 208, 0.5, 1.4, 0.3, 14.6, 14.6, 30.0, 30.0));

// ── PLCC family ─────────────────────────────────────────────────────────────
reg(plcc(44));
reg(plcc(68));
reg(plcc(84));

// ── BGA larger sizes ────────────────────────────────────────────────────────
reg(bga('BGA-324_1.0mm', 'BGA-324 (1.0mm pitch)', 18, 18, 1.0, 0.5, 20.0, 20.0));
reg(bga('BGA-400_1.0mm', 'BGA-400 (1.0mm pitch)', 20, 20, 1.0, 0.5, 23.0, 23.0));
reg(bga('BGA-484_1.0mm', 'BGA-484 (1.0mm pitch)', 22, 22, 1.0, 0.5, 25.0, 25.0));
reg(bga('BGA-625_1.0mm', 'BGA-625 (1.0mm pitch)', 25, 25, 1.0, 0.5, 28.0, 28.0));
reg(bga('BGA-900_1.0mm', 'BGA-900 (1.0mm pitch)', 30, 30, 1.0, 0.5, 33.0, 33.0));

// ── Connectors: Barrel Jack ─────────────────────────────────────────────────
reg({
  id: 'BarrelJack', name: 'DC Barrel Jack',
  pads: [
    { number: '1', x: 0,    y: 0,    width: 2.5, height: 2.5, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] }, // Center pin
    { number: '2', x: -6.0, y: 0,    width: 3.0, height: 3.0, shape: 'oval',   drill: 2.0, layers: ['F.Cu', 'B.Cu'] }, // Sleeve
    { number: '3', x: -3.0, y: -4.7, width: 3.0, height: 3.0, shape: 'oval',   drill: 2.0, layers: ['F.Cu', 'B.Cu'] }, // Switch
  ],
  courtyard: { width: 14.5, height: 11.0 },
  silkscreen: rectSilk(14.0, 10.5),
  origin: { x: 0, y: 0 },
});

// ── Connectors: Screw terminals ─────────────────────────────────────────────
reg(screwTerminal(2, 5.08));
reg(screwTerminal(3, 5.08));
reg(screwTerminal(2, 3.81));
reg(screwTerminal(3, 3.81));

// ── Connectors: DB-9 / DB-25 ───────────────────────────────────────────────
reg({
  id: 'DB9', name: 'DB-9 D-Sub Connector',
  pads: (() => {
    const pads: FootprintPad[] = [];
    const pitch = 2.77;
    // Top row: 5 pins
    for (let i = 0; i < 5; i++) {
      pads.push({
        number: String(i + 1),
        x: -2 * pitch + i * pitch, y: -1.4,
        width: 1.6, height: 1.6, shape: 'circle', drill: 1.0,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
    // Bottom row: 4 pins
    for (let i = 0; i < 4; i++) {
      pads.push({
        number: String(i + 6),
        x: -1.5 * pitch + i * pitch, y: 1.4,
        width: 1.6, height: 1.6, shape: 'circle', drill: 1.0,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
    // Mounting holes
    pads.push(
      { number: 'MH1', x: -12.5, y: 0, width: 4.0, height: 4.0, shape: 'circle', drill: 3.2, layers: ['F.Cu', 'B.Cu'] },
      { number: 'MH2', x: 12.5,  y: 0, width: 4.0, height: 4.0, shape: 'circle', drill: 3.2, layers: ['F.Cu', 'B.Cu'] },
    );
    return pads;
  })(),
  courtyard: { width: 31.0, height: 12.5 },
  silkscreen: rectSilk(30.5, 12.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'DB25', name: 'DB-25 D-Sub Connector',
  pads: (() => {
    const pads: FootprintPad[] = [];
    const pitch = 2.77;
    // Top row: 13 pins
    for (let i = 0; i < 13; i++) {
      pads.push({
        number: String(i + 1),
        x: -6 * pitch + i * pitch, y: -1.4,
        width: 1.6, height: 1.6, shape: 'circle', drill: 1.0,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
    // Bottom row: 12 pins
    for (let i = 0; i < 12; i++) {
      pads.push({
        number: String(i + 14),
        x: -5.5 * pitch + i * pitch, y: 1.4,
        width: 1.6, height: 1.6, shape: 'circle', drill: 1.0,
        layers: ['F.Cu', 'B.Cu'],
      });
    }
    // Mounting holes
    pads.push(
      { number: 'MH1', x: -19.5, y: 0, width: 4.0, height: 4.0, shape: 'circle', drill: 3.2, layers: ['F.Cu', 'B.Cu'] },
      { number: 'MH2', x: 19.5,  y: 0, width: 4.0, height: 4.0, shape: 'circle', drill: 3.2, layers: ['F.Cu', 'B.Cu'] },
    );
    return pads;
  })(),
  courtyard: { width: 47.0, height: 12.5 },
  silkscreen: rectSilk(46.5, 12.0),
  origin: { x: 0, y: 0 },
});

// ── Connectors: FPC/FFC ─────────────────────────────────────────────────────
for (const n of [10, 20, 30, 40, 50]) reg(fpcConnector(n));

// ── Connectors: IDC shrouded headers ────────────────────────────────────────
for (const n of [5, 7, 10, 13, 17, 20]) reg(idcHeader(n));

// ── Connectors: Molex Micro-Fit 3.0 ────────────────────────────────────────
for (const n of [2, 4, 6, 8, 10, 12]) reg(molexMicroFit(n));

// ── Connectors: Molex KK 254 ───────────────────────────────────────────────
for (const n of [2, 3, 4, 5, 6]) reg(molexKK(n));

// ── Connectors: Phoenix Contact MSTB ────────────────────────────────────────
for (const n of [2, 3, 4]) reg(phoenixMSTB(n));

// ── Through-hole: Axial resistor ────────────────────────────────────────────
reg({
  id: 'Axial_7.62mm', name: 'Axial Resistor (7.62mm spacing)',
  pads: [
    { number: '1', x: -3.81, y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 3.81,  y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 10.0, height: 3.0 },
  silkscreen: [
    { x1: -2.5, y1: -1.0, x2: 2.5, y2: -1.0 },
    { x1: 2.5, y1: -1.0, x2: 2.5, y2: 1.0 },
    { x1: 2.5, y1: 1.0, x2: -2.5, y2: 1.0 },
    { x1: -2.5, y1: 1.0, x2: -2.5, y2: -1.0 },
    { x1: -3.81, y1: 0, x2: -2.5, y2: 0 },
    { x1: 2.5, y1: 0, x2: 3.81, y2: 0 },
  ],
  origin: { x: 0, y: 0 },
});

reg({
  id: 'Axial_10.16mm', name: 'Axial Resistor (10.16mm spacing)',
  pads: [
    { number: '1', x: -5.08, y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 5.08,  y: 0, width: 1.6, height: 1.6, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 12.5, height: 3.0 },
  silkscreen: [
    { x1: -3.5, y1: -1.0, x2: 3.5, y2: -1.0 },
    { x1: 3.5, y1: -1.0, x2: 3.5, y2: 1.0 },
    { x1: 3.5, y1: 1.0, x2: -3.5, y2: 1.0 },
    { x1: -3.5, y1: 1.0, x2: -3.5, y2: -1.0 },
    { x1: -5.08, y1: 0, x2: -3.5, y2: 0 },
    { x1: 3.5, y1: 0, x2: 5.08, y2: 0 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Through-hole: Radial electrolytic caps ──────────────────────────────────
function radialCap(leadSpacing: number, diameter: number): FootprintDef {
  const halfSpan = leadSpacing / 2;
  const r = diameter / 2;
  const id = `RadialCap_${leadSpacing}mm_D${diameter}mm`;
  return {
    id,
    name: `Radial Electrolytic ${diameter}mm dia (${leadSpacing}mm spacing)`,
    pads: [
      { number: '1', x: -halfSpan, y: 0, width: 1.8, height: 1.8, shape: 'rect', drill: 0.9, layers: ['F.Cu', 'B.Cu'] },
      { number: '2', x: halfSpan,  y: 0, width: 1.8, height: 1.8, shape: 'circle', drill: 0.9, layers: ['F.Cu', 'B.Cu'] },
    ],
    courtyard: { width: diameter + 1.5, height: diameter + 1.5 },
    silkscreen: [
      // Circular body approximated as octagon
      { x1: -r, y1: -r * 0.4, x2: -r * 0.4, y2: -r },
      { x1: -r * 0.4, y1: -r, x2: r * 0.4, y2: -r },
      { x1: r * 0.4, y1: -r, x2: r, y2: -r * 0.4 },
      { x1: r, y1: -r * 0.4, x2: r, y2: r * 0.4 },
      { x1: r, y1: r * 0.4, x2: r * 0.4, y2: r },
      { x1: r * 0.4, y1: r, x2: -r * 0.4, y2: r },
      { x1: -r * 0.4, y1: r, x2: -r, y2: r * 0.4 },
      { x1: -r, y1: r * 0.4, x2: -r, y2: -r * 0.4 },
    ],
    origin: { x: 0, y: 0 },
  };
}

reg(radialCap(2.5, 5));
reg(radialCap(2.5, 6.3));
reg(radialCap(5, 8));
reg(radialCap(5, 10));
reg(radialCap(5, 12.5));

// ── Through-hole: TO-92 ────────────────────────────────────────────────────
reg({
  id: 'TO-92', name: 'TO-92 (3-pin, 1.27mm pitch)',
  pads: [
    { number: '1', x: -1.27, y: 0, width: 1.5, height: 1.5, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 0,     y: 0, width: 1.5, height: 1.5, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
    { number: '3', x: 1.27,  y: 0, width: 1.5, height: 1.5, shape: 'circle', drill: 0.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 5.0, height: 5.0 },
  silkscreen: [
    // Flat front
    { x1: -2.0, y1: 0.8, x2: 2.0, y2: 0.8 },
    // Half-circle back approximated
    { x1: -2.0, y1: 0.8, x2: -2.2, y2: -0.5 },
    { x1: -2.2, y1: -0.5, x2: -1.2, y2: -1.8 },
    { x1: -1.2, y1: -1.8, x2: 1.2, y2: -1.8 },
    { x1: 1.2, y1: -1.8, x2: 2.2, y2: -0.5 },
    { x1: 2.2, y1: -0.5, x2: 2.0, y2: 0.8 },
  ],
  origin: { x: 0, y: 0 },
});

// TO-220 already defined above

// ── Through-hole: TO-247 ───────────────────────────────────────────────────
reg({
  id: 'TO-247', name: 'TO-247-3 (5.45mm pitch)',
  pads: [
    { number: '1', x: -5.45, y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 0,     y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    { number: '3', x: 5.45,  y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    // Mounting tab
    { number: 'TAB', x: 0, y: -6.0, width: 8.0, height: 8.0, shape: 'rect', drill: 3.8, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 16.0, height: 20.0 },
  silkscreen: [
    { x1: -7.8, y1: -2.5, x2: 7.8, y2: -2.5 },
    { x1: 7.8, y1: -2.5, x2: 7.8, y2: 3.0 },
    { x1: 7.8, y1: 3.0, x2: -7.8, y2: 3.0 },
    { x1: -7.8, y1: 3.0, x2: -7.8, y2: -2.5 },
    { x1: -7.8, y1: -10.0, x2: 7.8, y2: -10.0 },
    { x1: 7.8, y1: -10.0, x2: 7.8, y2: -2.5 },
    { x1: -7.8, y1: -10.0, x2: -7.8, y2: -2.5 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Through-hole: TO-3P ────────────────────────────────────────────────────
reg({
  id: 'TO-3P', name: 'TO-3P (3-pin power)',
  pads: [
    { number: '1', x: -5.45, y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 0,     y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    { number: '3', x: 5.45,  y: 0, width: 2.4, height: 2.4, shape: 'circle', drill: 1.5, layers: ['F.Cu', 'B.Cu'] },
    // Mounting hole
    { number: 'MH', x: 0, y: -7.0, width: 6.0, height: 6.0, shape: 'circle', drill: 4.0, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 18.0, height: 22.0 },
  silkscreen: [
    { x1: -8.5, y1: -3.0, x2: 8.5, y2: -3.0 },
    { x1: 8.5, y1: -3.0, x2: 8.5, y2: 3.0 },
    { x1: 8.5, y1: 3.0, x2: -8.5, y2: 3.0 },
    { x1: -8.5, y1: 3.0, x2: -8.5, y2: -3.0 },
    { x1: -8.5, y1: -11.0, x2: 8.5, y2: -11.0 },
    { x1: 8.5, y1: -11.0, x2: 8.5, y2: -3.0 },
    { x1: -8.5, y1: -11.0, x2: -8.5, y2: -3.0 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Through-hole: DIP packages ──────────────────────────────────────────────
for (const n of [8, 14, 16, 20, 24, 28, 40]) reg(dip(n));

// ── Through-hole: SIP packages ──────────────────────────────────────────────
for (const n of [3, 4, 5, 8]) reg(sip(n));

// ── Inductor SMD footprints ─────────────────────────────────────────────────
reg(inductorSMD('1210', 1.4, 2.0, 1.5, 3.8, 2.8));
reg(inductorSMD('1812', 1.8, 2.8, 2.0, 5.2, 3.6));
reg(inductorSMD('4x4', 1.5, 3.2, 2.5, 4.8, 4.8));
reg(inductorSMD('5x5', 2.0, 4.0, 3.0, 6.0, 6.0));
reg(inductorSMD('6x6', 2.5, 4.5, 3.5, 7.0, 7.0));
reg(inductorSMD('8x8', 3.0, 6.0, 4.5, 9.5, 9.5));
reg(inductorSMD('10x10', 3.5, 7.5, 5.5, 12.0, 12.0));
reg(inductorSMD('12x12', 4.0, 9.0, 6.5, 14.0, 14.0));

// ── Common mode choke SMD ───────────────────────────────────────────────────
reg({
  id: 'CMC_SMD', name: 'Common Mode Choke SMD',
  pads: [
    { number: '1', x: -4.0, y: -2.5, width: 1.5, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -4.0, y: 2.5,  width: 1.5, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: 4.0,  y: 2.5,  width: 1.5, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 4.0,  y: -2.5, width: 1.5, height: 1.5, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 10.5, height: 7.5 },
  silkscreen: rectSilk(10.0, 7.0),
  origin: { x: 0, y: 0 },
});

// ── Transformer SMD ─────────────────────────────────────────────────────────
reg({
  id: 'Transformer_EP7', name: 'Transformer SMD EP7',
  pads: [
    { number: '1', x: -3.0, y: -2.0, width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -3.0, y: 0,    width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: -3.0, y: 2.0,  width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 3.0,  y: 2.0,  width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 3.0,  y: 0,    width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: 3.0,  y: -2.0, width: 1.2, height: 1.0, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 9.0, height: 7.5 },
  silkscreen: rectSilk(8.5, 7.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'Transformer_EP10', name: 'Transformer SMD EP10',
  pads: [
    { number: '1', x: -4.5, y: -2.5, width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -4.5, y: 0,    width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: -4.5, y: 2.5,  width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 4.5,  y: 2.5,  width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 4.5,  y: 0,    width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: 4.5,  y: -2.5, width: 1.5, height: 1.2, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 12.0, height: 9.5 },
  silkscreen: rectSilk(11.5, 9.0),
  origin: { x: 0, y: 0 },
});

reg({
  id: 'Transformer_EPC13', name: 'Transformer SMD EPC13',
  pads: [
    { number: '1', x: -5.5, y: -3.0, width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '2', x: -5.5, y: 0,    width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '3', x: -5.5, y: 3.0,  width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '4', x: 5.5,  y: 3.0,  width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '5', x: 5.5,  y: 0,    width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
    { number: '6', x: 5.5,  y: -3.0, width: 1.8, height: 1.4, shape: 'rect', layers: ['F.Cu'] },
  ],
  courtyard: { width: 14.5, height: 11.5 },
  silkscreen: rectSilk(14.0, 11.0),
  origin: { x: 0, y: 0 },
});

// ── Fuse holder (5x20mm axial) ──────────────────────────────────────────────
reg({
  id: 'Fuse_5x20mm', name: 'Fuse Holder 5x20mm Axial',
  pads: [
    { number: '1', x: -12.5, y: 0, width: 2.2, height: 2.2, shape: 'circle', drill: 1.3, layers: ['F.Cu', 'B.Cu'] },
    { number: '2', x: 12.5,  y: 0, width: 2.2, height: 2.2, shape: 'circle', drill: 1.3, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 28.0, height: 8.0 },
  silkscreen: [
    { x1: -10.5, y1: -3.0, x2: 10.5, y2: -3.0 },
    { x1: 10.5, y1: -3.0, x2: 10.5, y2: 3.0 },
    { x1: 10.5, y1: 3.0, x2: -10.5, y2: 3.0 },
    { x1: -10.5, y1: 3.0, x2: -10.5, y2: -3.0 },
    { x1: -12.5, y1: 0, x2: -10.5, y2: 0 },
    { x1: 10.5, y1: 0, x2: 12.5, y2: 0 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Relay: Omron G5V-1 (SPDT) ──────────────────────────────────────────────
reg({
  id: 'Relay_G5V-1', name: 'Relay Omron G5V-1 (SPDT)',
  pads: [
    { number: '1', x: -5.08, y: -3.81, width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] }, // Coil+
    { number: '2', x: 5.08,  y: -3.81, width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] }, // Coil-
    { number: '3', x: -5.08, y: 3.81,  width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] }, // NC
    { number: '4', x: 0,     y: 3.81,  width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] }, // COM
    { number: '5', x: 5.08,  y: 3.81,  width: 1.8, height: 1.8, shape: 'circle', drill: 1.0, layers: ['F.Cu', 'B.Cu'] }, // NO
  ],
  courtyard: { width: 15.0, height: 10.5 },
  silkscreen: rectSilk(14.5, 10.0),
  origin: { x: 0, y: 0 },
});

// ── Test point ──────────────────────────────────────────────────────────────
reg({
  id: 'TestPoint', name: 'Test Point (1mm pad)',
  pads: [
    { number: '1', x: 0, y: 0, width: 1.0, height: 1.0, shape: 'circle', layers: ['F.Cu'] },
  ],
  courtyard: { width: 2.0, height: 2.0 },
  silkscreen: [
    { x1: -0.7, y1: 0, x2: -0.3, y2: 0 },
    { x1: 0.3, y1: 0, x2: 0.7, y2: 0 },
    { x1: 0, y1: -0.7, x2: 0, y2: -0.3 },
    { x1: 0, y1: 0.3, x2: 0, y2: 0.7 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Fiducial ────────────────────────────────────────────────────────────────
reg({
  id: 'Fiducial', name: 'Fiducial (1mm circle, 2mm clearance)',
  pads: [
    { number: '1', x: 0, y: 0, width: 1.0, height: 1.0, shape: 'circle', layers: ['F.Cu'] },
  ],
  courtyard: { width: 3.0, height: 3.0 },
  silkscreen: [
    // Crosshair markers outside clearance ring
    { x1: -1.5, y1: 0, x2: -1.0, y2: 0 },
    { x1: 1.0, y1: 0, x2: 1.5, y2: 0 },
    { x1: 0, y1: -1.5, x2: 0, y2: -1.0 },
    { x1: 0, y1: 1.0, x2: 0, y2: 1.5 },
  ],
  origin: { x: 0, y: 0 },
});

// ── Heatsink mounting (TO-220 compatible) ───────────────────────────────────
reg({
  id: 'Heatsink_TO220', name: 'Heatsink Mounting (TO-220 compatible)',
  pads: [
    // Single mounting hole for TO-220 tab screw
    { number: '1', x: 0, y: 0, width: 5.0, height: 5.0, shape: 'circle', drill: 3.2, layers: ['F.Cu', 'B.Cu'] },
  ],
  courtyard: { width: 10.0, height: 10.0 },
  silkscreen: rectSilk(9.0, 9.0),
  origin: { x: 0, y: 0 },
});

// ─── Lookup helper ──────────────────────────────────────────────────────────

/** Find a footprint by ID (case-insensitive, also matches common aliases). */
export function lookupFootprint(name: string): FootprintDef | undefined {
  // Direct match
  if (FOOTPRINT_DB[name]) return FOOTPRINT_DB[name];

  // Case-insensitive
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(FOOTPRINT_DB)) {
    if (key.toLowerCase() === lower) return val;
  }

  // Common aliases - maps user-facing footprint names to FOOTPRINT_DB keys
  const aliases: Record<string, string> = {
    // ─── Resistor prefix aliases (R_XXXX -> chip size XXXX) ──────────
    'r_0201': '0201',
    'r_0402': '0402',
    'r_0603': '0603',
    'r_0805': '0805',
    'r_1206': '1206',
    'r_1210': '1210',
    'r_2010': '2010',
    'r_2512': '2512',
    // ─── Capacitor prefix aliases (C_XXXX -> chip size XXXX) ─────────
    'c_0201': '0201',
    'c_0402': '0402',
    'c_0603': '0603',
    'c_0805': '0805',
    'c_1206': '1206',
    'c_1210': '1210',
    'c_1812': '1812',
    'c_2220': '2512',
    // ─── Inductor prefix aliases (L_XXXX -> chip size XXXX) ──────────
    'l_0402': '0402',
    'l_0603': '0603',
    'l_0805': '0805',
    'l_1008': '1206',
    'l_1210': '1210',
    // ─── Ferrite bead aliases ────────────────────────────────────────
    'fb_0805': '0805',
    // ─── Fuse aliases ────────────────────────────────────────────────
    'fuse_0603': '0603',
    'fuse_1206': '1206',
    // ─── LED aliases ─────────────────────────────────────────────────
    'led_0603': '0603',
    'led_0805': 'LED_0805',
    'led_5050': '2520',
    // ─── Diode package aliases ───────────────────────────────────────
    'd_sod-123': 'SOT-23',
    'd_sod123': 'SOT-23',
    'd_sma': 'SMA_Edge',
    'd_smb': '2010',
    // ─── Crystal aliases ─────────────────────────────────────────────
    'crystal_hc49': 'HC-49',
    'crystal_smd_3225': 'Crystal_3.2x2.5',
    'crystal_smd_5032': 'Crystal_5x3.2',
    'crystal_3225': 'Crystal_3.2x2.5',
    'crystal_5032': 'Crystal_5x3.2',
    // ─── Polarized cap aliases ───────────────────────────────────────
    'cp_elec_5x5': 'CAP_SMD_6.3x5.4',
    'cp_elec_6.3x5.4': 'CAP_SMD_6.3x5.4',
    'cp_elec_8x10': 'CAP_SMD_8x6.5',
    'cp_elec_8x6.5': 'CAP_SMD_8x6.5',
    'cp_elec_10x10': 'CAP_SMD_10x10',
    // ─── Connector aliases ───────────────────────────────────────────
    'pinheader_1x02': 'Axial_7.62mm',
    'pinheader_1x02_p2.54mm': 'Axial_7.62mm',
    'pinheader_1x04': 'Axial_10.16mm',
    'pinheader_1x04_p2.54mm': 'Axial_10.16mm',
    'pinheader_1x06_p2.54mm': 'Axial_10.16mm',
    'pinheader_1x20_p2.54mm': 'Axial_10.16mm',
    'pinheader_2x04_p2.54mm': 'Axial_10.16mm',
    'pinheader_2x05_p2.54mm': 'Axial_10.16mm',
    'pinheader_2x20_p2.54mm': 'Axial_10.16mm',
    'rj45_th': 'RJ45',
    // ─── USB aliases ─────────────────────────────────────────────────
    'usb_c_16': 'USB-C-16',
    'usb_c': 'USB-C-16',
    'usb-c': 'USB-C-16',
    'micro_usb': 'USB-B-Micro',
    'micro-usb': 'USB-B-Micro',
    // ─── Transistor/IC package aliases ───────────────────────────────
    'dpak': 'TO-252',
    'd2pak': 'TO-263',
    'd2pak-5': 'TO-263-5',
    'sot23': 'SOT-23',
    'sot23-5': 'SOT-23-5',
    'sot23-6': 'SOT-23-6',
    'sot89': 'SOT-89',
    'sot-89': 'SOT-89',
    'sot223': 'SOT-223',
    'sot-223': 'SOT-223',
    'sot-143': 'SOT-23',
    'to-220-3': 'TO-220',
    'to220': 'TO-220',
    'to220-3': 'TO-220',
    // ─── Misc package aliases ────────────────────────────────────────
    'sma': 'SMA_Edge',
    'sma_edge': 'SMA_Edge',
    'hc49': 'HC-49',
    'hc-49': 'HC-49',
    'barrel_jack': 'BarrelJack',
    'barrel-jack': 'BarrelJack',
    'dc_jack': 'BarrelJack',
    'to92': 'TO-92',
    'to-92': 'TO-92',
    'to247': 'TO-247',
    'to-247': 'TO-247',
    'to3p': 'TO-3P',
    'to-3p': 'TO-3P',
    'lfpak33': 'SOT-669',
    'lfpak56': 'LFPAK56',
    'testpoint': 'TestPoint',
    'test_point': 'TestPoint',
    'fiducial': 'Fiducial',
    'powerpak_so8': 'PowerPAK_SO-8',
    'powerpak-so8': 'PowerPAK_SO-8',
    // ─── IC package aliases ──────────────────────────────────────────
    'soic-4': 'SOIC-8',
    'soic-20': 'SOIC-16',
    'ssop-28': 'TSSOP-20',
    'htssop-16': 'TSSOP-16',
    'msop-10': 'TSSOP-8',
    'mlp-14': 'QFN-16',
    'dfn-8': 'DFN-8',
    'lqfp-32': 'TQFP-32',
    'lqfp-64': 'TQFP-64',
    'qfn-14': 'QFN-16',
    'qfn-20_4x4mm': 'QFN-20',
    'qfn-24_4x4mm': 'QFN-24',
    'qfn-28': 'QFN-32',
    'qfn-28_4x4mm': 'QFN-32',
    'qfn-56': 'QFN-48',
    'lga-8_2.5x2.5mm': 'DFN-8',
    'lga-12_2x2mm': 'QFN-16',
    'tqfp-44': 'QFP-44',
    // ─── Switch/relay aliases ────────────────────────────────────────
    'sw_spst': 'Axial_7.62mm',
    'sw_tactile_6x6mm': 'Axial_7.62mm',
    'sw_tactile_4.5x4.5mm': 'Axial_7.62mm',
    'sw_slide_spdt': 'SOT-23',
    'sw_dip_x04': 'SOIC-8',
    'relay_spdt_omron_g6k': 'Relay_G5V-1',
    // ─── Module aliases ──────────────────────────────────────────────
    'esp32-wroom-32': 'QFN-48',
    // ─── Misc ────────────────────────────────────────────────────────
    'sd_card_smd': 'SOIC-8',
    'buzzer_smd_12x9.5mm': 'CAP_SMD_10x10',
    'ant_2.4ghz_pcb': 'TestPoint',
    'jst_xh_4p_2.50mm': 'Axial_10.16mm',
    'jst_xh_6p_2.50mm': 'Axial_10.16mm',
  };
  const aliasKey = aliases[lower];
  if (aliasKey && FOOTPRINT_DB[aliasKey]) return FOOTPRINT_DB[aliasKey];

  return undefined;
}

/** Get all footprint IDs. */
export function allFootprintIds(): string[] {
  return Object.keys(FOOTPRINT_DB);
}
