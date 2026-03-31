// ─── SymbolLibrary.tsx ─ SVG symbol renderer for all schematic components ───
import React, { useState, useEffect } from 'react';
import type { LibPin, PinType } from '../types';
import { theme } from '../styles/theme';

// ─── Pin definitions for each symbol type ──────────────────────────────────
export interface SymbolDef {
  pins: LibPin[];
  width: number;
  height: number;
}

const pin = (name: string, number: string, x: number, y: number, type: PinType = 'passive'): LibPin => ({
  name, number, x, y, type,
});

export const SYMBOL_DEFS: Record<string, SymbolDef> = {
  resistor: {
    pins: [pin('1', '1', -20, 0), pin('2', '2', 20, 0)],
    width: 40, height: 12,
  },
  capacitor: {
    pins: [pin('1', '1', -15, 0), pin('2', '2', 15, 0)],
    width: 30, height: 16,
  },
  capacitor_polarized: {
    pins: [pin('+', '1', -15, 0, 'passive'), pin('-', '2', 15, 0, 'passive')],
    width: 30, height: 16,
  },
  inductor: {
    pins: [pin('1', '1', -20, 0), pin('2', '2', 20, 0)],
    width: 40, height: 12,
  },
  diode: {
    pins: [pin('A', '1', -15, 0), pin('K', '2', 15, 0)],
    width: 30, height: 14,
  },
  led: {
    pins: [pin('A', '1', -15, 0), pin('K', '2', 15, 0)],
    width: 30, height: 14,
  },
  zener: {
    pins: [pin('A', '1', -15, 0), pin('K', '2', 15, 0)],
    width: 30, height: 14,
  },
  npn: {
    pins: [pin('B', '1', -15, 0, 'input'), pin('C', '2', 10, -15, 'output'), pin('E', '3', 10, 15, 'output')],
    width: 25, height: 30,
  },
  pnp: {
    pins: [pin('B', '1', -15, 0, 'input'), pin('C', '2', 10, 15, 'output'), pin('E', '3', 10, -15, 'output')],
    width: 25, height: 30,
  },
  nmos: {
    pins: [pin('G', '1', -15, 0, 'input'), pin('D', '2', 10, -15, 'output'), pin('S', '3', 10, 15, 'output')],
    width: 25, height: 30,
  },
  pmos: {
    pins: [pin('G', '1', -15, 0, 'input'), pin('D', '2', 10, 15, 'output'), pin('S', '3', 10, -15, 'output')],
    width: 25, height: 30,
  },
  opamp: {
    pins: [
      pin('+', '1', -20, 8, 'input'),
      pin('-', '2', -20, -8, 'input'),
      pin('OUT', '3', 20, 0, 'output'),
      pin('V+', '4', 0, -15, 'power'),
      pin('V-', '5', 0, 15, 'power'),
    ],
    width: 40, height: 30,
  },
  ic: {
    pins: [
      pin('1', '1', -20, -10, 'input'),
      pin('2', '2', -20, 0, 'input'),
      pin('3', '3', -20, 10, 'input'),
      pin('4', '4', 20, -10, 'output'),
      pin('5', '5', 20, 0, 'output'),
      pin('6', '6', 20, 10, 'output'),
      pin('VCC', '7', 0, -18, 'power'),
      pin('GND', '8', 0, 18, 'power'),
    ],
    width: 40, height: 36,
  },
  connector_2: {
    pins: [pin('1', '1', -12, -5), pin('2', '2', -12, 5)],
    width: 24, height: 16,
  },
  connector_4: {
    pins: [pin('1', '1', -12, -10), pin('2', '2', -12, -3), pin('3', '3', -12, 4), pin('4', '4', -12, 11)],
    width: 24, height: 28,
  },
  crystal: {
    pins: [pin('1', '1', -15, 0), pin('2', '2', 15, 0)],
    width: 30, height: 14,
  },
  fuse: {
    pins: [pin('1', '1', -15, 0), pin('2', '2', 15, 0)],
    width: 30, height: 8,
  },
  switch: {
    pins: [pin('1', '1', -15, 0), pin('2', '2', 15, 0)],
    width: 30, height: 10,
  },
  connector: {
    pins: [pin('1', '1', -15, -5), pin('2', '2', -15, 5)],
    width: 30, height: 16,
  },
  schottky: {
    pins: [pin('A', '1', -15, 0), pin('K', '2', 15, 0)],
    width: 30, height: 14,
  },
  tvs: {
    pins: [pin('A', '1', -15, 0), pin('K', '2', 15, 0)],
    width: 30, height: 14,
  },
  bridge: {
    pins: [pin('AC1', '1', -15, 0), pin('AC2', '2', 0, -15), pin('+', '3', 15, 0), pin('-', '4', 0, 15)],
    width: 30, height: 30,
  },
  igbt: {
    pins: [pin('G', '1', -15, 0, 'input'), pin('C', '2', 10, -15, 'output'), pin('E', '3', 10, 15, 'output')],
    width: 25, height: 30,
  },
  ferrite: {
    pins: [pin('1', '1', -15, 0), pin('2', '2', 15, 0)],
    width: 30, height: 8,
  },
  gnd: {
    pins: [pin('1', '1', 0, -10, 'power')],
    width: 12, height: 16,
  },
  vcc: {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 12, height: 16,
  },
  '3v3': {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 16, height: 16,
  },
  '5v': {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 12, height: 16,
  },
  '12v': {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 16, height: 16,
  },
  vdd: {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 12, height: 16,
  },
  vss: {
    pins: [pin('1', '1', 0, -10, 'power')],
    width: 12, height: 16,
  },
  vbat: {
    pins: [pin('1', '1', 0, 10, 'power')],
    width: 16, height: 16,
  },
};

// ─── Generate IC symbol for arbitrary pin counts ──────────────────────────

export function generateICSymbol(pinCount: number, pinsPerSide?: number): SymbolDef {
  // For ICs with > 20 pins and no explicit pinsPerSide, distribute on all 4 sides (QFP-style)
  if (pinCount > 20 && !pinsPerSide) {
    return generateICSymbol4Side(pinCount);
  }

  const perSide = pinsPerSide ?? Math.ceil(pinCount / 2);
  const rightCount = pinCount - perSide;
  const pinSpacing = 10;

  // Body height scales to fit pins on the larger side
  const maxSide = Math.max(perSide, rightCount);
  const bodyH = (maxSide - 1) * pinSpacing + 20; // 10 padding top+bottom
  const bodyW = 28;
  const halfH = bodyH / 2;
  const halfW = bodyW / 2;
  const stubLen = 6; // pin extends beyond body edge

  const pins: LibPin[] = [];

  // Left-side pins (numbered 1..perSide), top to bottom
  for (let i = 0; i < perSide; i++) {
    const py = -halfH + 10 + i * pinSpacing;
    pins.push(pin(
      `${i + 1}`,
      `${i + 1}`,
      -(halfW + stubLen),
      py,
      'input',
    ));
  }

  // Right-side pins (numbered perSide+1..pinCount), bottom to top (DIP-style)
  for (let i = 0; i < rightCount; i++) {
    const pinNum = perSide + 1 + i;
    // DIP numbering: right side goes bottom-to-top
    const py = halfH - 10 - i * pinSpacing;
    pins.push(pin(
      `${pinNum}`,
      `${pinNum}`,
      halfW + stubLen,
      py,
      'output',
    ));
  }

  return {
    pins,
    width: (halfW + stubLen) * 2,
    height: bodyH,
  };
}

/** Generate a 4-side IC symbol (QFP/BGA style) for high pin count ICs */
function generateICSymbol4Side(pinCount: number): SymbolDef {
  const pinSpacing = 10;
  const stubLen = 6;

  // Distribute pins: left, bottom, right, top (roughly equal)
  const perSide = Math.ceil(pinCount / 4);
  const leftCount = perSide;
  const bottomCount = perSide;
  const rightCount = perSide;
  const topCount = pinCount - leftCount - bottomCount - rightCount;

  // Body dimensions based on the larger of horizontal/vertical pin counts
  const vertMax = Math.max(leftCount, rightCount);
  const horizMax = Math.max(topCount, bottomCount);
  const bodyH = (vertMax - 1) * pinSpacing + 20;
  const bodyW = Math.max((horizMax - 1) * pinSpacing + 20, 40);
  const halfH = bodyH / 2;
  const halfW = bodyW / 2;

  const pins: LibPin[] = [];
  let pinNum = 1;

  // Left-side pins: top to bottom
  for (let i = 0; i < leftCount; i++) {
    const py = -halfH + 10 + i * pinSpacing;
    pins.push(pin(`${pinNum}`, `${pinNum}`, -(halfW + stubLen), py, 'input'));
    pinNum++;
  }

  // Bottom-side pins: left to right
  for (let i = 0; i < bottomCount; i++) {
    const px = -halfW + 10 + i * pinSpacing;
    pins.push(pin(`${pinNum}`, `${pinNum}`, px, halfH + stubLen, 'passive'));
    pinNum++;
  }

  // Right-side pins: bottom to top
  for (let i = 0; i < rightCount; i++) {
    const py = halfH - 10 - i * pinSpacing;
    pins.push(pin(`${pinNum}`, `${pinNum}`, halfW + stubLen, py, 'output'));
    pinNum++;
  }

  // Top-side pins: right to left
  for (let i = 0; i < topCount; i++) {
    const px = halfW - 10 - i * pinSpacing;
    pins.push(pin(`${pinNum}`, `${pinNum}`, px, -(halfH + stubLen), 'power'));
    pinNum++;
  }

  return {
    pins,
    width: (halfW + stubLen) * 2,
    height: (halfH + stubLen) * 2,
  };
}

// ─── Render a generated IC symbol as SVG ──────────────────────────────────

function GeneratedICSymbol({ def }: { def: SymbolDef }): React.ReactElement {
  const stubLen = 6;
  // Compute body dimensions from pins — handle 4-side layout
  const leftPins = def.pins.filter(p => p.x < 0 && Math.abs(p.y) <= def.height / 2);
  const rightPins = def.pins.filter(p => p.x > 0 && Math.abs(p.y) <= def.height / 2);
  const topPins = def.pins.filter(p => p.y < 0 && Math.abs(p.x) <= def.width / 2);
  const bottomPins = def.pins.filter(p => p.y > 0 && Math.abs(p.x) <= def.width / 2);
  const has4Sides = topPins.length > 0 || bottomPins.length > 0;

  // Find body bounds from pin extents (body edge is stubLen inward from pin tips)
  let bodyLeft: number, bodyRight: number, bodyTop: number, bodyBottom: number;
  if (has4Sides) {
    const allPinX = def.pins.map(p => p.x);
    const allPinY = def.pins.map(p => p.y);
    bodyLeft = Math.min(...allPinX) + stubLen;
    bodyRight = Math.max(...allPinX) - stubLen;
    bodyTop = Math.min(...allPinY) + stubLen;
    bodyBottom = Math.max(...allPinY) - stubLen;
  } else {
    const allY = def.pins.map(p => p.y);
    bodyTop = Math.min(...allY) - 10;
    bodyBottom = Math.max(...allY) + 10;
    const bodyW = def.width - stubLen * 2;
    bodyLeft = -bodyW / 2;
    bodyRight = bodyW / 2;
  }

  const bodyW = bodyRight - bodyLeft;
  const bodyH = bodyBottom - bodyTop;
  const bodyStroke = '#b4b7c9';
  const bodyFill = '#1a1a2e';
  const pinLineColor = '#4ec9b0';

  return (
    <g>
      <rect
        x={bodyLeft} y={bodyTop}
        width={bodyW} height={bodyH}
        fill={bodyFill}
        stroke={bodyStroke}
        strokeWidth={0.8} rx={1}
      />
      {/* Notch */}
      <path
        d={`M ${(bodyLeft + bodyRight) / 2 - 3} ${bodyTop} A 3 3 0 0 0 ${(bodyLeft + bodyRight) / 2 + 3} ${bodyTop}`}
        fill="none" stroke={bodyStroke} strokeWidth={0.6}
      />
      {/* Pin 1 dot marker */}
      {def.pins.length > 0 && (
        <circle
          cx={def.pins[0].x < 0 ? bodyLeft + 3 : def.pins[0].x > 0 ? bodyRight - 3 : def.pins[0].x}
          cy={def.pins[0].y < 0 ? bodyTop + 3 : def.pins[0].y > 0 ? bodyBottom - 3 : def.pins[0].y}
          r={1.2}
          fill={pinLineColor}
          opacity={0.7}
        />
      )}
      {/* Left pin stubs */}
      {leftPins.map((p, i) => (
        <line key={`lp${i}`}
          x1={p.x} y1={p.y} x2={bodyLeft} y2={p.y}
          stroke={pinLineColor} strokeWidth={0.8}
        />
      ))}
      {/* Right pin stubs */}
      {rightPins.map((p, i) => (
        <line key={`rp${i}`}
          x1={bodyRight} y1={p.y} x2={p.x} y2={p.y}
          stroke={pinLineColor} strokeWidth={0.8}
        />
      ))}
      {/* Top pin stubs */}
      {topPins.map((p, i) => (
        <line key={`tp${i}`}
          x1={p.x} y1={p.y} x2={p.x} y2={bodyTop}
          stroke={pinLineColor} strokeWidth={0.8}
        />
      ))}
      {/* Bottom pin stubs */}
      {bottomPins.map((p, i) => (
        <line key={`bp${i}`}
          x1={p.x} y1={bodyBottom} x2={p.x} y2={p.y}
          stroke={pinLineColor} strokeWidth={0.8}
        />
      ))}
    </g>
  );
}

// ─── Render functions ──────────────────────────────────────────────────────

interface SymbolProps {
  type: string;
  selected?: boolean;
  hover?: boolean;
  ghost?: boolean;
  showPinNames?: boolean;
  showPinNumbers?: boolean;
  pinCount?: number;
}

function pinStub(px: number, py: number, def: SymbolDef): React.ReactElement {
  // Draw a short line from the pin's position to the body edge
  const cx = 0;
  const cy = 0;
  const dx = px - cx;
  const dy = py - cy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return <></>;
  const nx = dx / len;
  const ny = dy / len;
  const stubLen = 5;
  return (
    <line
      x1={px} y1={py}
      x2={px + nx * stubLen} y2={py + ny * stubLen}
      stroke={theme.schPinColor}
      strokeWidth={0.6}
    />
  );
}

function renderPinDots(pins: LibPin[]): React.ReactElement[] {
  return pins.map((p, i) => (
    <circle
      key={`pd_${i}`}
      cx={p.x} cy={p.y}
      r={1}
      fill={theme.schPinColor}
    />
  ));
}

function renderPinLabels(pins: LibPin[], showNames: boolean, showNumbers: boolean): React.ReactElement[] {
  const els: React.ReactElement[] = [];
  pins.forEach((p, i) => {
    if (showNumbers) {
      els.push(
        <text
          key={`pn_${i}`}
          x={p.x + (p.x < 0 ? -2 : 2)}
          y={p.y - 2}
          fontSize={3}
          fill={theme.textMuted}
          textAnchor={p.x < 0 ? 'end' : 'start'}
          dominantBaseline="auto"
        >
          {p.number}
        </text>
      );
    }
    if (showNames && p.name !== p.number) {
      els.push(
        <text
          key={`pnm_${i}`}
          x={p.x + (p.x < 0 ? 3 : -3)}
          y={p.y + 1}
          fontSize={2.8}
          fill={theme.schPinName}
          textAnchor={p.x < 0 ? 'start' : 'end'}
          dominantBaseline="middle"
        >
          {p.name}
        </text>
      );
    }
  });
  return els;
}

// ─── Individual symbol SVG renderers ───────────────────────────────────────

function ResistorSymbol(): React.ReactElement {
  // US-style zigzag
  return (
    <g>
      <line x1={-20} y1={0} x2={-12} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polyline
        points="-12,0 -10,-4 -7,4 -4,-4 -1,4 2,-4 5,4 8,-4 10,4 12,0"
        fill="none"
        stroke={theme.schComponentBorder}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <line x1={12} y1={0} x2={20} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function CapacitorSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-2.5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-2.5} y1={-6} x2={-2.5} y2={6} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      <line x1={2.5} y1={-6} x2={2.5} y2={6} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      <line x1={2.5} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function CapacitorPolarizedSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-2.5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-2.5} y1={-6} x2={-2.5} y2={6} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      {/* Curved plate for polarized */}
      <path d="M 2.5 -6 Q 4.5 0 2.5 6" fill="none" stroke={theme.schComponentBorder} strokeWidth={1.2} />
      <line x1={2.5} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Plus sign */}
      <text x={-7} y={-3} fontSize={4} fill={theme.schComponentBorder} textAnchor="middle">+</text>
    </g>
  );
}

function InductorSymbol(): React.ReactElement {
  // Bumps/coils
  return (
    <g>
      <line x1={-20} y1={0} x2={-12} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <path
        d="M -12 0 A 3 3 0 0 1 -6 0 A 3 3 0 0 1 0 0 A 3 3 0 0 1 6 0 A 3 3 0 0 1 12 0"
        fill="none"
        stroke={theme.schComponentBorder}
        strokeWidth={0.8}
      />
      <line x1={12} y1={0} x2={20} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function DiodeSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polygon points="-5,-5 -5,5 5,0" fill="none" stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={5} y1={-5} x2={5} y2={5} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={5} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function LEDSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polygon points="-5,-5 -5,5 5,0" fill="none" stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={5} y1={-5} x2={5} y2={5} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={5} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Emission arrows */}
      <line x1={2} y1={-7} x2={6} y2={-11} stroke={theme.schComponentBorder} strokeWidth={0.5} />
      <line x1={4.5} y1={-11} x2={6} y2={-11} stroke={theme.schComponentBorder} strokeWidth={0.5} />
      <line x1={6} y1={-11} x2={6} y2={-9.5} stroke={theme.schComponentBorder} strokeWidth={0.5} />
      <line x1={-1} y1={-8} x2={3} y2={-12} stroke={theme.schComponentBorder} strokeWidth={0.5} />
      <line x1={1.5} y1={-12} x2={3} y2={-12} stroke={theme.schComponentBorder} strokeWidth={0.5} />
      <line x1={3} y1={-12} x2={3} y2={-10.5} stroke={theme.schComponentBorder} strokeWidth={0.5} />
    </g>
  );
}

function ZenerSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polygon points="-5,-5 -5,5 5,0" fill="none" stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Bent bar for zener */}
      <polyline points="3,-6 5,-5 5,5 7,6" fill="none" stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={5} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function NPNSymbol(): React.ReactElement {
  return (
    <g>
      {/* Base line */}
      <line x1={-15} y1={0} x2={-3} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Vertical base bar */}
      <line x1={-3} y1={-8} x2={-3} y2={8} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      {/* Collector */}
      <line x1={-3} y1={-5} x2={10} y2={-15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Emitter */}
      <line x1={-3} y1={5} x2={10} y2={15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Arrow on emitter (pointing out) */}
      <polygon points="5.5,10 10,15 4,13" fill={theme.schComponentBorder} stroke="none" />
      {/* Circle */}
      <circle cx={2} cy={0} r={12} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.5} />
    </g>
  );
}

function PNPSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-3} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-3} y1={-8} x2={-3} y2={8} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      <line x1={-3} y1={-5} x2={10} y2={-15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-3} y1={5} x2={10} y2={15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Arrow on emitter (pointing in) */}
      <polygon points="-3,5 2.5,3 0.5,8.5" fill={theme.schComponentBorder} stroke="none" />
      <circle cx={2} cy={0} r={12} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.5} />
    </g>
  );
}

function NMOSSymbol(): React.ReactElement {
  return (
    <g>
      {/* Gate */}
      <line x1={-15} y1={0} x2={-5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-5} y1={-8} x2={-5} y2={8} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      {/* Channel (3 segments) */}
      <line x1={-2} y1={-8} x2={-2} y2={-3} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={-1.5} x2={-2} y2={1.5} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={3} x2={-2} y2={8} stroke={theme.schComponentBorder} strokeWidth={1} />
      {/* Drain */}
      <line x1={-2} y1={-6} x2={10} y2={-6} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={10} y1={-6} x2={10} y2={-15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Source */}
      <line x1={-2} y1={6} x2={10} y2={6} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={10} y1={6} x2={10} y2={15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Body connection */}
      <line x1={-2} y1={0} x2={10} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
      {/* Arrow (N-channel: pointing in) */}
      <polygon points="-2,0 3,-2 3,2" fill={theme.schComponentBorder} stroke="none" />
    </g>
  );
}

function PMOSSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-5} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-5} y1={-8} x2={-5} y2={8} stroke={theme.schComponentBorder} strokeWidth={1.2} />
      <line x1={-2} y1={-8} x2={-2} y2={-3} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={-1.5} x2={-2} y2={1.5} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={3} x2={-2} y2={8} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={-6} x2={10} y2={-6} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={10} y1={-6} x2={10} y2={-15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-2} y1={6} x2={10} y2={6} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={10} y1={6} x2={10} y2={15} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-2} y1={0} x2={10} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
      {/* Arrow (P-channel: pointing out) */}
      <polygon points="3,0 -2,-2 -2,2" fill={theme.schComponentBorder} stroke="none" />
      {/* Circle on gate to indicate P-channel */}
      <circle cx={-3.5} cy={0} r={1.2} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.6} />
    </g>
  );
}

function OpampSymbol(): React.ReactElement {
  return (
    <g>
      {/* Triangle body */}
      <polygon points="-12,-15 -12,15 15,0" fill={theme.schComponentBody} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Input lines */}
      <line x1={-20} y1={8} x2={-12} y2={8} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-20} y1={-8} x2={-12} y2={-8} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Output line */}
      <line x1={15} y1={0} x2={20} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* +/- labels */}
      <text x={-9} y={9.5} fontSize={4} fill={theme.schPinColor} textAnchor="start" dominantBaseline="middle">+</text>
      <text x={-9} y={-7} fontSize={4} fill={theme.schPinColor} textAnchor="start" dominantBaseline="middle">&minus;</text>
      {/* Power pins (invisible stubs) */}
      <line x1={0} y1={-15} x2={0} y2={-9} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
      <line x1={0} y1={15} x2={0} y2={9} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
    </g>
  );
}

function ICSymbol(): React.ReactElement {
  const hw = 14;
  const hh = 15;
  return (
    <g>
      <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={theme.schComponentBody} stroke={theme.schComponentBorder} strokeWidth={0.8} rx={1} />
      {/* Notch */}
      <path d={`M -3 ${-hh} A 3 3 0 0 0 3 ${-hh}`} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.6} />
      {/* Left pins */}
      <line x1={-20} y1={-10} x2={-hw} y2={-10} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-20} y1={0} x2={-hw} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-20} y1={10} x2={-hw} y2={10} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Right pins */}
      <line x1={hw} y1={-10} x2={20} y2={-10} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={hw} y1={0} x2={20} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={hw} y1={10} x2={20} y2={10} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Top/bottom power pins */}
      <line x1={0} y1={-18} x2={0} y2={-hh} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
      <line x1={0} y1={18} x2={0} y2={hh} stroke={theme.schComponentBorder} strokeWidth={0.5} strokeDasharray="1,1" />
    </g>
  );
}

function Connector2Symbol(): React.ReactElement {
  const w = 10;
  const h = 14;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={theme.schComponentBody} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-12} y1={-5} x2={-w / 2} y2={-5} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <circle cx={-w / 2 + 2} cy={-5} r={1.2} fill={theme.schPinColor} />
      <line x1={-12} y1={5} x2={-w / 2} y2={5} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <circle cx={-w / 2 + 2} cy={5} r={1.2} fill={theme.schPinColor} />
    </g>
  );
}

function Connector4Symbol(): React.ReactElement {
  const w = 10;
  const h = 26;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={theme.schComponentBody} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {[-10, -3, 4, 11].map((y, i) => (
        <g key={i}>
          <line x1={-12} y1={y} x2={-w / 2} y2={y} stroke={theme.schComponentBorder} strokeWidth={0.8} />
          <circle cx={-w / 2 + 2} cy={y} r={1.2} fill={theme.schPinColor} />
        </g>
      ))}
    </g>
  );
}

function CrystalSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-6} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Plates */}
      <line x1={-6} y1={-5} x2={-6} y2={5} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={6} y1={-5} x2={6} y2={5} stroke={theme.schComponentBorder} strokeWidth={1} />
      {/* Crystal body */}
      <rect x={-3.5} y={-4} width={7} height={8} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={6} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function FuseSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-8} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* S-curve */}
      <path
        d="M -8 0 C -5 -5, -2 5, 1 0 C 4 -5, 7 5, 8 0"
        fill="none"
        stroke={theme.schComponentBorder}
        strokeWidth={0.8}
      />
      <line x1={8} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function SwitchSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={-15} y1={0} x2={-6} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <circle cx={-6} cy={0} r={1.5} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.7} />
      <circle cx={6} cy={0} r={1.5} fill="none" stroke={theme.schComponentBorder} strokeWidth={0.7} />
      {/* Arm */}
      <line x1={-4.5} y1={0} x2={5} y2={-5} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={6} y1={0} x2={15} y2={0} stroke={theme.schComponentBorder} strokeWidth={0.8} />
    </g>
  );
}

function GNDSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={0} y1={-10} x2={0} y2={-2} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-6} y1={-2} x2={6} y2={-2} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-4} y1={1} x2={4} y2={1} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={4} x2={2} y2={4} stroke={theme.schComponentBorder} strokeWidth={1} />
    </g>
  );
}

function VCCSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={0} y1={10} x2={0} y2={2} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      {/* Upward arrow */}
      <line x1={0} y1={2} x2={0} y2={-5} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polygon points="0,-7 -3,-2 3,-2" fill={theme.schComponentBorder} stroke="none" />
      <text x={0} y={-9} fontSize={3.5} fill={theme.schRefColor} textAnchor="middle" dominantBaseline="auto">VCC</text>
    </g>
  );
}

function PowerSymbol({ label }: { label: string }): React.ReactElement {
  return (
    <g>
      <line x1={0} y1={10} x2={0} y2={2} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={0} y1={2} x2={0} y2={-5} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <polygon points="0,-7 -3,-2 3,-2" fill={theme.schComponentBorder} stroke="none" />
      <text x={0} y={-9} fontSize={3.5} fill={theme.schRefColor} textAnchor="middle" dominantBaseline="auto">{label}</text>
    </g>
  );
}

function VSSSymbol(): React.ReactElement {
  return (
    <g>
      <line x1={0} y1={-10} x2={0} y2={-2} stroke={theme.schComponentBorder} strokeWidth={0.8} />
      <line x1={-6} y1={-2} x2={6} y2={-2} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-4} y1={1} x2={4} y2={1} stroke={theme.schComponentBorder} strokeWidth={1} />
      <line x1={-2} y1={4} x2={2} y2={4} stroke={theme.schComponentBorder} strokeWidth={1} />
      <text x={0} y={8} fontSize={3.5} fill={theme.schRefColor} textAnchor="middle" dominantBaseline="hanging">VSS</text>
    </g>
  );
}

// ─── Main render function ──────────────────────────────────────────────────

const symbolRenderers: Record<string, () => React.ReactElement> = {
  resistor: ResistorSymbol,
  capacitor: CapacitorSymbol,
  capacitor_polarized: CapacitorPolarizedSymbol,
  inductor: InductorSymbol,
  diode: DiodeSymbol,
  led: LEDSymbol,
  zener: ZenerSymbol,
  npn: NPNSymbol,
  pnp: PNPSymbol,
  nmos: NMOSSymbol,
  pmos: PMOSSymbol,
  opamp: OpampSymbol,
  ic: ICSymbol,
  connector_2: Connector2Symbol,
  connector_4: Connector4Symbol,
  crystal: CrystalSymbol,
  fuse: FuseSymbol,
  switch: SwitchSymbol,
  connector: Connector2Symbol,
  schottky: DiodeSymbol,
  tvs: DiodeSymbol,
  bridge: ICSymbol,
  igbt: NMOSSymbol,
  ferrite: FuseSymbol,
  gnd: GNDSymbol,
  vcc: VCCSymbol,
  vss: VSSSymbol,
};

export function renderSymbol(props: SymbolProps): React.ReactElement {
  const { type, selected, hover, ghost, showPinNames = false, showPinNumbers = false, pinCount } = props;
  const opacity = ghost ? 0.5 : 1;
  const strokeFilter = selected
    ? `drop-shadow(0 0 2px ${theme.selectionColor})`
    : hover
      ? `drop-shadow(0 0 1.5px ${theme.hoverColor})`
      : 'none';

  // If type is 'ic' and a custom pinCount is provided, use generated IC symbol
  if (type === 'ic' && pinCount && pinCount !== 8) {
    const genDef = generateICSymbol(pinCount);
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <GeneratedICSymbol def={genDef} />
        {renderPinDots(genDef.pins)}
        {renderPinLabels(genDef.pins, showPinNames, showPinNumbers)}
      </g>
    );
  }

  const def = SYMBOL_DEFS[type];
  const renderer = symbolRenderers[type];

  if (type === '3v3') {
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <PowerSymbol label="+3V3" />
        {def && renderPinDots(def.pins)}
      </g>
    );
  }
  if (type === '5v') {
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <PowerSymbol label="+5V" />
        {def && renderPinDots(def.pins)}
      </g>
    );
  }
  if (type === '12v') {
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <PowerSymbol label="+12V" />
        {def && renderPinDots(def.pins)}
      </g>
    );
  }
  if (type === 'vdd') {
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <PowerSymbol label="VDD" />
        {def && renderPinDots(def.pins)}
      </g>
    );
  }
  if (type === 'vbat') {
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <PowerSymbol label="VBAT" />
        {def && renderPinDots(def.pins)}
      </g>
    );
  }

  if (!renderer) {
    // Fallback: generic rectangle
    return (
      <g opacity={opacity} style={{ filter: strokeFilter }}>
        <rect x={-10} y={-8} width={20} height={16} fill={theme.schComponentBody} stroke={theme.schComponentBorder} strokeWidth={0.8} rx={1} />
        <text x={0} y={1} fontSize={3} fill={theme.textMuted} textAnchor="middle" dominantBaseline="middle">{type}</text>
        {def && renderPinDots(def.pins)}
      </g>
    );
  }

  return (
    <g opacity={opacity} style={{ filter: strokeFilter }}>
      {renderer()}
      {def && renderPinDots(def.pins)}
      {def && renderPinLabels(def.pins, showPinNames, showPinNumbers)}
    </g>
  );
}

// ─── KiCad Symbol Data Types ──────────────────────────────────────────────

export interface KiCadPin {
  name: string;
  number: string;
  x: number;
  y: number;
  type: string;       // input, output, bidirectional, power_in, power_out, passive, tri_state, no_connect, etc.
  style?: string;     // inverted, clock, inverted_clock, etc.
  direction: 'R' | 'L' | 'U' | 'D';
  length: number;
}

export interface KiCadBody {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ─── Graphic primitives for symbol body rendering ─────────────────────────

export interface KiCadGraphicRect {
  type: 'rectangle';
  x1: number; y1: number;
  x2: number; y2: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface KiCadGraphicCircle {
  type: 'circle';
  cx: number; cy: number;
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface KiCadGraphicArc {
  type: 'arc';
  cx: number; cy: number;
  radius: number;
  startAngle: number;  // degrees
  endAngle: number;    // degrees
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface KiCadGraphicPolyline {
  type: 'polyline';
  points: { x: number; y: number }[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  closed?: boolean;
}

export type KiCadGraphic = KiCadGraphicRect | KiCadGraphicCircle | KiCadGraphicArc | KiCadGraphicPolyline;

export interface KiCadSymbolData {
  name: string;
  refPrefix: string;
  library: string;
  pinCount: number;
  pins: KiCadPin[];
  body: KiCadBody;
  graphics?: KiCadGraphic[];  // optional: rich body graphics from KiCad symbol lib
}

// ─── Scale factor: KiCad symbol units → RouteAI canvas units ──
// KiCad symbols vary wildly in size: a resistor body is 1.6x4 units,
// an STM32 is 22x56 units. We scale them so they look proportional
// on the schematic canvas where generic symbols span ~30-40 units.
//
// Base scale: KiCad 1 unit ≈ 2.54mm. Our canvas 1 unit ≈ 0.5mm.
// So KiCad 1 unit ≈ 5 canvas units. Fine-tuned to 3.0 for readability.
const KICAD_SCALE = 3.0;

// ─── Pin connection point computation ─────────────────────────────────────
// Pin position in the JSON is the tip (connection point).
// The body edge is at (pin.x - direction_offset * pin.length).
// Direction: R = pin extends Right from body, so body-edge is to the LEFT of tip
//            L = pin extends Left from body, body-edge is to the RIGHT of tip
//            U = pin extends Up from body, body-edge is BELOW tip
//            D = pin extends Down from body, body-edge is ABOVE tip

function pinBodyEdge(p: KiCadPin): { bx: number; by: number } {
  switch (p.direction) {
    case 'R': return { bx: p.x - p.length, by: p.y };
    case 'L': return { bx: p.x + p.length, by: p.y };
    case 'U': return { bx: p.x, by: p.y + p.length };
    case 'D': return { bx: p.x, by: p.y - p.length };
    default:  return { bx: p.x, by: p.y };
  }
}

// ─── SVG text-anchor type alias (fixes TS error for textAnchor prop) ──────
type SvgTextAnchor = 'start' | 'middle' | 'end' | 'inherit';

// ─── Render graphic primitives from the graphics array ────────────────────

function renderKiCadGraphics(
  graphics: KiCadGraphic[],
  s: number,
  defaultStroke: string,
  defaultFill: string,
): React.ReactElement[] {
  return graphics.map((g, idx) => {
    const stroke = g.stroke || defaultStroke;
    const sw = (g.strokeWidth ?? 0.8) * s;
    switch (g.type) {
      case 'rectangle': {
        const rx1 = Math.min(g.x1, g.x2) * s;
        const ry1 = Math.min(g.y1, g.y2) * s;
        const rw = Math.abs(g.x2 - g.x1) * s;
        const rh = Math.abs(g.y2 - g.y1) * s;
        return (
          <rect key={`gfx_r_${idx}`}
            x={rx1} y={ry1} width={rw} height={rh}
            fill={g.fill || defaultFill}
            stroke={stroke} strokeWidth={sw}
          />
        );
      }
      case 'circle':
        return (
          <circle key={`gfx_c_${idx}`}
            cx={g.cx * s} cy={g.cy * s} r={g.radius * s}
            fill={g.fill || 'none'}
            stroke={stroke} strokeWidth={sw}
          />
        );
      case 'arc': {
        // Convert center + radius + angles to SVG arc path
        const startRad = (g.startAngle * Math.PI) / 180;
        const endRad = (g.endAngle * Math.PI) / 180;
        const x1a = g.cx * s + g.radius * s * Math.cos(startRad);
        const y1a = g.cy * s - g.radius * s * Math.sin(startRad);
        const x2a = g.cx * s + g.radius * s * Math.cos(endRad);
        const y2a = g.cy * s - g.radius * s * Math.sin(endRad);
        // Determine if large arc (> 180 degrees)
        let sweep = g.endAngle - g.startAngle;
        if (sweep < 0) sweep += 360;
        const largeArc = sweep > 180 ? 1 : 0;
        return (
          <path key={`gfx_a_${idx}`}
            d={`M ${x1a} ${y1a} A ${g.radius * s} ${g.radius * s} 0 ${largeArc} 0 ${x2a} ${y2a}`}
            fill={g.fill || 'none'}
            stroke={stroke} strokeWidth={sw}
          />
        );
      }
      case 'polyline': {
        const pts = g.points.map(pt => `${pt.x * s},${pt.y * s}`).join(' ');
        if (g.closed) {
          return (
            <polygon key={`gfx_p_${idx}`}
              points={pts}
              fill={g.fill || 'none'}
              stroke={stroke} strokeWidth={sw}
            />
          );
        }
        return (
          <polyline key={`gfx_pl_${idx}`}
            points={pts}
            fill={g.fill || 'none'}
            stroke={stroke} strokeWidth={sw}
          />
        );
      }
      default:
        return <g key={`gfx_unk_${idx}`} />;
    }
  });
}

// ─── Pin type glyph renderer ──────────────────────────────────────────────
// Draws a small indicator at the body edge based on electrical type / style.
// (dx, dy) is the unit vector from body edge TOWARD the pin tip.

function renderPinTypeGlyph(
  edgeX: number, edgeY: number,
  dx: number, dy: number,
  pinType: string,
  pinStyle: string | undefined,
  color: string,
  idx: number,
): React.ReactElement | null {
  const gs = 1.2; // glyph size
  const elements: React.ReactElement[] = [];

  // ── Pin style decorators (drawn at the body edge) ──
  if (pinStyle === 'inverted' || pinStyle === 'inverted_clock') {
    // Small open circle at body edge (inversion bubble)
    elements.push(
      <circle key={`psty_inv_${idx}`}
        cx={edgeX + dx * gs * 0.5} cy={edgeY + dy * gs * 0.5}
        r={gs * 0.5} fill="none" stroke={color} strokeWidth={0.35}
      />
    );
  }
  if (pinStyle === 'clock' || pinStyle === 'inverted_clock') {
    // Clock edge marker: small '>' triangle at body edge perpendicular to pin
    const perpX = -dy; // perpendicular direction
    const perpY = dx;
    elements.push(
      <path key={`psty_clk_${idx}`}
        d={`M ${edgeX + perpX * gs * 0.6} ${edgeY + perpY * gs * 0.6} L ${edgeX - dx * gs * 0.7} ${edgeY - dy * gs * 0.7} L ${edgeX - perpX * gs * 0.6} ${edgeY - perpY * gs * 0.6}`}
        fill="none" stroke={color} strokeWidth={0.35}
      />
    );
  }

  // ── Electrical type glyphs (drawn at pin tip) ──
  const tipOffX = -dx * gs; // offset back from tip toward body
  const tipOffY = -dy * gs;
  switch (pinType) {
    case 'input': {
      // Small arrow pointing INTO body (toward body edge from tip)
      const perpX = -dy;
      const perpY = dx;
      elements.push(
        <path key={`ptyp_in_${idx}`}
          d={`M ${edgeX + dx * gs} ${edgeY + dy * gs} L ${edgeX} ${edgeY} M ${edgeX + perpX * gs * 0.4 + dx * gs * 0.6} ${edgeY + perpY * gs * 0.4 + dy * gs * 0.6} L ${edgeX} ${edgeY} L ${edgeX - perpX * gs * 0.4 + dx * gs * 0.6} ${edgeY - perpY * gs * 0.4 + dy * gs * 0.6}`}
          fill="none" stroke={color} strokeWidth={0.4}
        />
      );
      break;
    }
    case 'output': {
      // Small arrow pointing OUT of body (away from body edge)
      const perpX = -dy;
      const perpY = dx;
      elements.push(
        <path key={`ptyp_out_${idx}`}
          d={`M ${edgeX} ${edgeY} L ${edgeX + dx * gs} ${edgeY + dy * gs} M ${edgeX + perpX * gs * 0.4 + dx * gs * 0.4} ${edgeY + perpY * gs * 0.4 + dy * gs * 0.4} L ${edgeX + dx * gs} ${edgeY + dy * gs} L ${edgeX - perpX * gs * 0.4 + dx * gs * 0.4} ${edgeY - perpY * gs * 0.4 + dy * gs * 0.4}`}
          fill="none" stroke={color} strokeWidth={0.4}
        />
      );
      break;
    }
    case 'bidirectional':
    case 'tri_state': {
      // Diamond shape at body edge
      const perpX = -dy;
      const perpY = dx;
      elements.push(
        <polygon key={`ptyp_bid_${idx}`}
          points={[
            `${edgeX - dx * gs * 0.5},${edgeY - dy * gs * 0.5}`,
            `${edgeX + perpX * gs * 0.4},${edgeY + perpY * gs * 0.4}`,
            `${edgeX + dx * gs * 0.5},${edgeY + dy * gs * 0.5}`,
            `${edgeX - perpX * gs * 0.4},${edgeY - perpY * gs * 0.4}`,
          ].join(' ')}
          fill="none" stroke={color} strokeWidth={0.35}
        />
      );
      break;
    }
    case 'power_in':
    case 'power_out': {
      // Small filled square at body edge
      const half = gs * 0.35;
      elements.push(
        <rect key={`ptyp_pwr_${idx}`}
          x={edgeX - half} y={edgeY - half}
          width={half * 2} height={half * 2}
          fill={color} stroke="none"
        />
      );
      break;
    }
    case 'no_connect': {
      // X mark at tip
      const xsz = gs * 0.5;
      elements.push(
        <g key={`ptyp_nc_${idx}`}>
          <line x1={edgeX - xsz} y1={edgeY - xsz} x2={edgeX + xsz} y2={edgeY + xsz} stroke={color} strokeWidth={0.4} />
          <line x1={edgeX + xsz} y1={edgeY - xsz} x2={edgeX - xsz} y2={edgeY + xsz} stroke={color} strokeWidth={0.4} />
        </g>
      );
      break;
    }
    // 'passive', 'unspecified', etc. - no special glyph, just the line
    default:
      break;
  }

  if (elements.length === 0) return null;
  return <g key={`pglyph_${idx}`}>{elements}</g>;
}

// ─── Direction to unit vector (from body edge toward pin tip) ─────────────
function pinDirVec(dir: string): { dx: number; dy: number } {
  switch (dir) {
    case 'R': return { dx: 1, dy: 0 };
    case 'L': return { dx: -1, dy: 0 };
    case 'U': return { dx: 0, dy: -1 };
    case 'D': return { dx: 0, dy: 1 };
    default:  return { dx: 1, dy: 0 };
  }
}

// ─── Render a REAL KiCad symbol from parsed data ──────────────────────────

export function renderKiCadSymbol({
  symbolData,
  selected = false,
  hover = false,
  ghost = false,
}: {
  symbolData: KiCadSymbolData;
  selected?: boolean;
  hover?: boolean;
  ghost?: boolean;
}): React.ReactElement {
  if (!symbolData || !symbolData.pins) {
    return renderSymbol({ type: 'ic', selected, hover, ghost });
  }
  const { pins, body, graphics } = symbolData;
  const s = KICAD_SCALE;
  const opacity = ghost ? 0.5 : 1;
  const strokeFilter = selected
    ? `drop-shadow(0 0 2px ${theme.selectionColor})`
    : hover
      ? `drop-shadow(0 0 1.5px ${theme.hoverColor})`
      : 'none';

  // Body rectangle (normalize min/max since x1,y1 may be > x2,y2)
  const bx1 = Math.min(body.x1, body.x2) * s;
  const by1 = Math.min(body.y1, body.y2) * s;
  const bx2 = Math.max(body.x1, body.x2) * s;
  const by2 = Math.max(body.y1, body.y2) * s;
  const bw = bx2 - bx1;
  const bh = by2 - by1;

  // Colors matching KiCad dark theme
  const bodyFill = '#1a1a2e';
  const bodyStroke = '#b4b7c9';
  const pinColor = '#4ec9b0';
  const pinNameColor = '#00c8c8';
  const pinNumColor = '#e04040';
  const pinDotColor = '#4ec9b0';
  const glyphColor = '#b0b8d0';

  // Font sizes relative to the symbol body size.
  // Compute pin spacing from body height and pin count on the busiest side.
  const pinCount = pins.length;
  const bodyHeight = bh; // already scaled
  const pinsPerSide = Math.ceil(pinCount / 2);
  const pinSpacing = pinsPerSide > 1 ? bodyHeight / (pinsPerSide + 1) : bodyHeight;
  // Font must be smaller than pin spacing to avoid overlap. Cap at 60% of spacing.
  const maxFont = Math.max(pinSpacing * 0.55, 1.0);
  const baseFontSize = Math.min(maxFont, pinCount > 40 ? 2.2 : pinCount > 16 ? 2.8 : 3.5);
  const numFontSize = baseFontSize * 0.75;

  // Determine whether we have rich graphics or fall back to simple rectangle
  const hasGraphics = graphics && graphics.length > 0;

  return (
    <g opacity={opacity} style={{ filter: strokeFilter }}>
      {/* ── Body graphics ── */}
      {hasGraphics ? (
        // Render rich body graphics from KiCad symbol library
        renderKiCadGraphics(graphics, s, bodyStroke, bodyFill)
      ) : (
        // Fallback: simple body rectangle + IC notch
        <>
          <rect
            x={bx1} y={by1}
            width={bw} height={bh}
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth={0.6}
            rx={1}
          />
          {/* IC notch marker at top center */}
          {bw > 10 && (
            <path
              d={`M ${(bx1 + bx2) / 2 - 3} ${by1} A 3 3 0 0 0 ${(bx1 + bx2) / 2 + 3} ${by1}`}
              fill="none" stroke={bodyStroke} strokeWidth={0.4}
            />
          )}
          {/* Pin 1 dot marker (small filled circle near pin 1 inside body) */}
          {pins.length > 0 && (() => {
            const p1 = pins[0];
            const p1Edge = pinBodyEdge(p1);
            // Place dot 2 units inside the body from the body edge
            const dotX = p1Edge.bx * s + (p1.direction === 'R' ? -2 : p1.direction === 'L' ? 2 : 0);
            const dotY = p1Edge.by * s + (p1.direction === 'D' ? -2 : p1.direction === 'U' ? 2 : 0);
            return (
              <circle
                cx={dotX} cy={dotY}
                r={1}
                fill={pinColor}
                opacity={0.7}
              />
            );
          })()}
        </>
      )}

      {/* ── Pins ── */}
      {pins.map((p, i) => {
        const tipX = p.x * s;
        const tipY = p.y * s;
        const edge = pinBodyEdge(p);
        const edgeX = edge.bx * s;
        const edgeY = edge.by * s;
        const { dx, dy } = pinDirVec(p.direction);

        // Pin name label placement: inside body, near body edge (KiCad standard)
        let nameX: number, nameY: number;
        let nameAnchor: SvgTextAnchor;
        let nameDx = 0, nameDy = 0;
        // Pin number label placement: outside body, near tip (KiCad standard)
        let numX: number, numY: number;
        let numAnchor: SvgTextAnchor;

        // KiCad layout: pin name INSIDE body near edge, pin number OUTSIDE near tip
        const nameInset = baseFontSize * 0.5;

        const numDist = baseFontSize * 0.7;  // distance from pin line for number
        switch (p.direction) {
          case 'R':
            nameX = edgeX + nameInset;  nameY = edgeY;
            nameAnchor = 'start'; nameDy = baseFontSize * 0.15;
            numX = tipX - numDist;  numY = tipY - numDist;
            numAnchor = 'end';
            break;
          case 'L':
            nameX = edgeX - nameInset;  nameY = edgeY;
            nameAnchor = 'end'; nameDy = baseFontSize * 0.15;
            numX = tipX + numDist;  numY = tipY - numDist;
            numAnchor = 'start';
            break;
          case 'U':
            nameX = edgeX + nameInset; nameY = edgeY + nameInset;
            nameAnchor = 'start'; nameDx = 0;
            numX = tipX + numDist; numY = tipY + numDist;
            numAnchor = 'start';
            break;
          case 'D':
            nameX = edgeX + nameInset; nameY = edgeY - nameInset;
            nameAnchor = 'start'; nameDx = 0;
            numX = tipX + numDist; numY = tipY - numDist;
            numAnchor = 'start';
            break;
          default:
            nameX = edgeX; nameY = edgeY; nameAnchor = 'start';
            numX = tipX; numY = tipY; numAnchor = 'start';
        }

        return (
          <g key={`kpin_${i}`}>
            {/* Pin line from body edge to tip */}
            <line
              x1={edgeX} y1={edgeY}
              x2={tipX} y2={tipY}
              stroke={pinColor}
              strokeWidth={0.4}
            />
            {/* Small connection point at tip */}
            <circle
              cx={tipX} cy={tipY}
              r={0.5}
              fill="none"
              stroke={pinDotColor}
              strokeWidth={0.3}
              opacity={0.4}
            />
            {/* Pin type glyph at body edge */}
            {renderPinTypeGlyph(edgeX, edgeY, dx, dy, p.type, p.style, glyphColor, i)}
            {/* Pin name (inside body, near edge) */}
            <text
              x={nameX + nameDx} y={nameY + nameDy}
              fontSize={baseFontSize}
              fill={pinNameColor}
              textAnchor={nameAnchor}
              dominantBaseline="middle"
              style={{ fontFamily: "'Courier New', monospace", userSelect: 'none' }}
            >
              {p.name}
            </text>
            {/* Pin number (outside, near tip — above pin line for H, beside for V) */}
            <text
              x={numX}
              y={numY}
              fontSize={numFontSize}
              fill={pinNumColor}
              textAnchor={numAnchor}
              dominantBaseline="middle"
              style={{ fontFamily: "'Courier New', monospace", userSelect: 'none' }}
            >
              {p.number}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ─── Compute bounding box for a KiCad symbol ─────────────────────────────

export function getKiCadSymbolBounds(sym: KiCadSymbolData): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!sym || !sym.pins || !sym.body) {
    return { minX: -22, minY: -18, maxX: 22, maxY: 18 };
  }
  const s = KICAD_SCALE;
  let minX = Math.min(sym.body.x1, sym.body.x2) * s;
  let minY = Math.min(sym.body.y1, sym.body.y2) * s;
  let maxX = Math.max(sym.body.x1, sym.body.x2) * s;
  let maxY = Math.max(sym.body.y1, sym.body.y2) * s;

  // Expand bounds for graphic elements
  if (sym.graphics) {
    for (const g of sym.graphics) {
      switch (g.type) {
        case 'rectangle': {
          const gx1 = Math.min(g.x1, g.x2) * s;
          const gy1 = Math.min(g.y1, g.y2) * s;
          const gx2 = Math.max(g.x1, g.x2) * s;
          const gy2 = Math.max(g.y1, g.y2) * s;
          if (gx1 < minX) minX = gx1;
          if (gy1 < minY) minY = gy1;
          if (gx2 > maxX) maxX = gx2;
          if (gy2 > maxY) maxY = gy2;
          break;
        }
        case 'circle': {
          const cl = (g.cx - g.radius) * s;
          const ct = (g.cy - g.radius) * s;
          const cr = (g.cx + g.radius) * s;
          const cb = (g.cy + g.radius) * s;
          if (cl < minX) minX = cl;
          if (ct < minY) minY = ct;
          if (cr > maxX) maxX = cr;
          if (cb > maxY) maxY = cb;
          break;
        }
        case 'arc': {
          // Conservative: use bounding box of full circle
          const al = (g.cx - g.radius) * s;
          const at = (g.cy - g.radius) * s;
          const ar = (g.cx + g.radius) * s;
          const ab = (g.cy + g.radius) * s;
          if (al < minX) minX = al;
          if (at < minY) minY = at;
          if (ar > maxX) maxX = ar;
          if (ab > maxY) maxY = ab;
          break;
        }
        case 'polyline':
          for (const pt of g.points) {
            const px = pt.x * s;
            const py = pt.y * s;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          break;
      }
    }
  }

  for (const p of sym.pins) {
    const px = p.x * s;
    const py = p.y * s;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  return { minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2 };
}

// ─── Helper: compute bounding box from symbol definition pins ─────────────

export function getSymbolBounds(type: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const def = SYMBOL_DEFS[type];
  if (!def || def.pins.length === 0) {
    return { minX: -22, minY: -18, maxX: 22, maxY: 18 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of def.pins) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Add some padding around the pin extents
  const padX = 4;
  const padY = 4;
  return {
    minX: minX - padX,
    minY: minY - padY,
    maxX: maxX + padX,
    maxY: maxY + padY,
  };
}

// ─── Thumbnail for palette ─────────────────────────────────────────────────

export function SymbolThumbnail({ type, size = 32 }: { type: string; size?: number }): React.ReactElement {
  const def = SYMBOL_DEFS[type];
  const vw = def ? def.width + 10 : 30;
  const vh = def ? def.height + 10 : 24;
  return (
    <svg width={size} height={size} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`}>
      {renderSymbol({ type })}
    </svg>
  );
}

// ─── KiCad Symbol Thumbnail for palette ──────────────────────────────────
// Tries to render a real KiCad symbol preview. Falls back to generic SymbolThumbnail.

export function KiCadSymbolThumbnail({
  symbolName,
  fallbackType,
  size = 28,
}: {
  symbolName: string;
  fallbackType: string;
  size?: number;
}): React.ReactElement {
  const [symbolData, setSymbolData] = useState<KiCadSymbolData | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Lazy import to avoid circular deps — getCachedKiCadSymbol and fetchKiCadSymbol
    // are in componentLibrary.ts
    import('../store/componentLibrary').then(({ getCachedKiCadSymbol, fetchKiCadSymbol }) => {
      if (cancelled) return;
      // Synchronous cache check first
      const cached = getCachedKiCadSymbol(symbolName);
      if (cached) {
        setSymbolData(cached);
        setTried(true);
        return;
      }
      // Async fetch
      fetchKiCadSymbol(symbolName).then((data) => {
        if (!cancelled && data) {
          setSymbolData(data);
        }
        if (!cancelled) setTried(true);
      });
    });
    return () => { cancelled = true; };
  }, [symbolName]);

  // If we have KiCad data, render a scaled-down version
  if (symbolData) {
    const bounds = getKiCadSymbolBounds(symbolData);
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    // Add padding
    const pad = 4;
    const vw = bw + pad * 2;
    const vh = bh + pad * 2;
    const vx = bounds.minX - pad;
    const vy = bounds.minY - pad;
    return (
      <svg width={size} height={size} viewBox={`${vx} ${vy} ${vw} ${vh}`}>
        {renderKiCadSymbol({ symbolData })}
      </svg>
    );
  }

  // Fallback to generic symbol thumbnail
  return <SymbolThumbnail type={fallbackType} size={size} />;
}

export default renderSymbol;
