/**
 * SymbolRenderer - SVG symbol definitions for all basic schematic components.
 *
 * Provides reusable <g> elements for resistor (zigzag), capacitor (parallel lines),
 * inductor (coils), IC (rectangle with pins), connector, diode, LED, transistor
 * NPN/PNP, op-amp triangle, crystal, and fuse. Supports rotation, mirroring, and
 * proper pin rendering with numbers and names.
 */

import { memo } from 'react';
import type { SymbolType, SchematicPin } from '../../stores/schematicStore';

// ---------------------------------------------------------------------------
// Pin rendering
// ---------------------------------------------------------------------------

interface PinProps {
  pin: SchematicPin;
  showNames: boolean;
  showNumbers: boolean;
}

const PIN_LENGTH = 15;
const PIN_DOT_RADIUS = 2.5;

const PinElement = memo(function PinElement({ pin, showNames, showNumbers }: PinProps) {
  const { position, orientation, name, number } = pin;
  const dirMap: Record<string, { dx: number; dy: number }> = {
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
  };
  const dir = dirMap[orientation] || dirMap.right;
  const endX = position.x + dir.dx * PIN_LENGTH;
  const endY = position.y + dir.dy * PIN_LENGTH;

  const isHorizontal = orientation === 'left' || orientation === 'right';
  const nameAnchor = orientation === 'left' ? 'end' : orientation === 'right' ? 'start' : 'middle';
  const nameOffsetX = dir.dx * (PIN_LENGTH + 4);
  const nameOffsetY = dir.dy * (PIN_LENGTH + 4);
  const numOffsetX = isHorizontal ? dir.dx * 6 : 4;
  const numOffsetY = isHorizontal ? -4 : dir.dy * 6;

  return (
    <g className="schematic-pin">
      {/* Pin wire */}
      <line
        x1={position.x}
        y1={position.y}
        x2={endX}
        y2={endY}
        stroke="#4ade80"
        strokeWidth={1}
      />
      {/* Connection dot */}
      <circle
        cx={endX}
        cy={endY}
        r={PIN_DOT_RADIUS}
        fill="#4ade80"
        className="pin-endpoint"
        data-pin-id={pin.id}
      />
      {/* Pin name */}
      {showNames && name && name !== '~' && (
        <text
          x={position.x + nameOffsetX}
          y={position.y + nameOffsetY + (isHorizontal ? 3 : 0)}
          textAnchor={nameAnchor}
          fontSize={7}
          fill="#94a3b8"
          dominantBaseline="middle"
        >
          {name}
        </text>
      )}
      {/* Pin number */}
      {showNumbers && number && (
        <text
          x={position.x + numOffsetX}
          y={position.y + numOffsetY}
          textAnchor="middle"
          fontSize={5.5}
          fill="#64748b"
          dominantBaseline="middle"
        >
          {number}
        </text>
      )}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Symbol body shapes
// ---------------------------------------------------------------------------

function ResistorBody() {
  // Zigzag pattern, body centered at origin, horizontal
  const points = [
    -20, 0,
    -15, 0,
    -12, -6,
    -6, 6,
    0, -6,
    6, 6,
    12, -6,
    15, 0,
    20, 0,
  ];
  const d = points.reduce((acc, val, i) => {
    if (i === 0) return `M ${val}`;
    return acc + (i % 2 === 0 ? ' L ' : ',') + val;
  }, '');

  return (
    <path d={d} fill="none" stroke="#e2e8f0" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
  );
}

function CapacitorBody() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-3} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-3} y1={-8} x2={-3} y2={8} stroke="#e2e8f0" strokeWidth={2} />
      <line x1={3} y1={-8} x2={3} y2={8} stroke="#e2e8f0" strokeWidth={2} />
      <line x1={3} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function InductorBody() {
  // Four bumps
  return (
    <g>
      <line x1={-20} y1={0} x2={-14} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <path
        d="M -14,0 A 4,4 0 0,1 -7,0 A 4,4 0 0,1 0,0 A 4,4 0 0,1 7,0 A 4,4 0 0,1 14,0"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={1.5}
      />
      <line x1={14} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function DiodeBody() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-6} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <polygon points="-6,-7 -6,7 6,0" fill="none" stroke="#e2e8f0" strokeWidth={1.5} strokeLinejoin="round" />
      <line x1={6} y1={-7} x2={6} y2={7} stroke="#e2e8f0" strokeWidth={2} />
      <line x1={6} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function LEDBody() {
  return (
    <g>
      {/* Diode body */}
      <line x1={-20} y1={0} x2={-6} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <polygon points="-6,-7 -6,7 6,0" fill="none" stroke="#e2e8f0" strokeWidth={1.5} strokeLinejoin="round" />
      <line x1={6} y1={-7} x2={6} y2={7} stroke="#e2e8f0" strokeWidth={2} />
      <line x1={6} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Emission arrows */}
      <line x1={2} y1={-10} x2={6} y2={-14} stroke="#fbbf24" strokeWidth={1} />
      <line x1={6} y1={-14} x2={4} y2={-12} stroke="#fbbf24" strokeWidth={1} />
      <line x1={6} y1={-14} x2={6.5} y2={-11.5} stroke="#fbbf24" strokeWidth={1} />
      <line x1={6} y1={-12} x2={10} y2={-16} stroke="#fbbf24" strokeWidth={1} />
      <line x1={10} y1={-16} x2={8} y2={-14} stroke="#fbbf24" strokeWidth={1} />
      <line x1={10} y1={-16} x2={10.5} y2={-13.5} stroke="#fbbf24" strokeWidth={1} />
    </g>
  );
}

function TransistorNPNBody() {
  return (
    <g>
      {/* Base line */}
      <line x1={-20} y1={0} x2={-4} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Emitter line (vertical) */}
      <line x1={-4} y1={-10} x2={-4} y2={10} stroke="#e2e8f0" strokeWidth={2} />
      {/* Collector */}
      <line x1={-4} y1={-5} x2={10} y2={-15} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={10} y1={-15} x2={10} y2={-20} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Emitter with arrow */}
      <line x1={-4} y1={5} x2={10} y2={15} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={10} y1={15} x2={10} y2={20} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Arrow on emitter */}
      <polygon points="6,11 10,15 4,14" fill="#e2e8f0" stroke="none" />
    </g>
  );
}

function TransistorPNPBody() {
  return (
    <g>
      {/* Base line */}
      <line x1={-20} y1={0} x2={-4} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Emitter line (vertical) */}
      <line x1={-4} y1={-10} x2={-4} y2={10} stroke="#e2e8f0" strokeWidth={2} />
      {/* Collector */}
      <line x1={-4} y1={-5} x2={10} y2={-15} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={10} y1={-15} x2={10} y2={-20} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Emitter */}
      <line x1={-4} y1={5} x2={10} y2={15} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={10} y1={15} x2={10} y2={20} stroke="#e2e8f0" strokeWidth={1.5} />
      {/* Arrow on emitter pointing towards base */}
      <polygon points="-1,7 3,5 1,10" fill="#e2e8f0" stroke="none" />
    </g>
  );
}

function OpampBody() {
  return (
    <g>
      {/* Triangle */}
      <polygon
        points="-15,-20 -15,20 20,0"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* + input */}
      <line x1={-25} y1={-10} x2={-15} y2={-10} stroke="#e2e8f0" strokeWidth={1.5} />
      <text x={-12} y={-8} fontSize={8} fill="#4ade80" textAnchor="start" dominantBaseline="middle">+</text>
      {/* - input */}
      <line x1={-25} y1={10} x2={-15} y2={10} stroke="#e2e8f0" strokeWidth={1.5} />
      <text x={-12} y={12} fontSize={8} fill="#f87171" textAnchor="start" dominantBaseline="middle">&minus;</text>
      {/* Output */}
      <line x1={20} y1={0} x2={30} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function CrystalBody() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-6} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-6} y1={-7} x2={-6} y2={7} stroke="#e2e8f0" strokeWidth={1.5} />
      <rect x={-4} y={-5} width={8} height={10} fill="none" stroke="#e2e8f0" strokeWidth={1.5} rx={1} />
      <line x1={6} y1={-7} x2={6} y2={7} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={6} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function FuseBody() {
  return (
    <g>
      <line x1={-20} y1={0} x2={-10} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <rect x={-10} y={-5} width={20} height={10} fill="none" stroke="#e2e8f0" strokeWidth={1.5} rx={2} />
      {/* Fuse element */}
      <path d="M -8,0 Q -4,-4 0,0 Q 4,4 8,0" fill="none" stroke="#e2e8f0" strokeWidth={1} />
      <line x1={10} y1={0} x2={20} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

interface ICBodyProps {
  pins: SchematicPin[];
  width?: number;
  height?: number;
}

function ICBody({ pins, width, height }: ICBodyProps) {
  const leftPins = pins.filter((p) => p.orientation === 'left');
  const rightPins = pins.filter((p) => p.orientation === 'right');
  const topPins = pins.filter((p) => p.orientation === 'up');
  const bottomPins = pins.filter((p) => p.orientation === 'down');

  const maxVert = Math.max(leftPins.length, rightPins.length, 1);
  const maxHorz = Math.max(topPins.length, bottomPins.length, 0);

  const w = width ?? Math.max(40, maxHorz * 12 + 20);
  const h = height ?? Math.max(30, maxVert * 12 + 10);

  return (
    <g>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill="#1e293b"
        stroke="#e2e8f0"
        strokeWidth={1.5}
        rx={2}
      />
      {/* IC notch */}
      <path
        d={`M ${-w / 2 + 8},${-h / 2} A 4,4 0 0,0 ${-w / 2 + 16},${-h / 2}`}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={1}
      />
      {/* Pin 1 dot */}
      <circle cx={-w / 2 + 5} cy={-h / 2 + 5} r={1.5} fill="#4ade80" />
    </g>
  );
}

interface ConnectorBodyProps {
  pinCount: number;
}

function ConnectorBody({ pinCount }: ConnectorBodyProps) {
  const h = Math.max(20, pinCount * 12 + 6);
  const w = 20;
  return (
    <g>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        fill="#1e293b"
        stroke="#e2e8f0"
        strokeWidth={1.5}
        rx={2}
      />
      {Array.from({ length: pinCount }).map((_, i) => {
        const y = -h / 2 + 6 + i * 12;
        return (
          <g key={i}>
            <circle cx={-w / 2 - 2} cy={y} r={2} fill="#4ade80" />
            <text x={0} y={y + 1} textAnchor="middle" fontSize={6} fill="#94a3b8" dominantBaseline="middle">
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GroundSymbol() {
  return (
    <g>
      <line x1={0} y1={-10} x2={0} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-10} y1={0} x2={10} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-6} y1={4} x2={6} y2={4} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-3} y1={8} x2={3} y2={8} stroke="#e2e8f0" strokeWidth={1.5} />
    </g>
  );
}

function VCCSymbol() {
  return (
    <g>
      <line x1={0} y1={10} x2={0} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-8} y1={0} x2={8} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <polygon points="0,-6 -5,0 5,0" fill="#f87171" stroke="none" />
    </g>
  );
}

function VDDSymbol() {
  return (
    <g>
      <line x1={0} y1={10} x2={0} y2={0} stroke="#e2e8f0" strokeWidth={1.5} />
      <line x1={-8} y1={0} x2={8} y2={0} stroke="#e2e8f0" strokeWidth={2} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main SymbolRenderer component
// ---------------------------------------------------------------------------

export interface SymbolRendererProps {
  symbolType: SymbolType;
  pins: SchematicPin[];
  rotation?: number;
  mirror?: boolean;
  showPinNames?: boolean;
  showPinNumbers?: boolean;
  isGhost?: boolean;
  isSelected?: boolean;
  isHovered?: boolean;
  scale?: number;
}

const SymbolRenderer = memo(function SymbolRenderer({
  symbolType,
  pins,
  rotation = 0,
  mirror = false,
  showPinNames = true,
  showPinNumbers = true,
  isGhost = false,
  isSelected = false,
  isHovered = false,
  scale = 1,
}: SymbolRendererProps) {
  const transform = [
    `scale(${scale})`,
    `rotate(${rotation})`,
    mirror ? 'scale(-1, 1)' : '',
  ].filter(Boolean).join(' ');

  const opacity = isGhost ? 0.4 : 1;

  let outline: { x: number; y: number; w: number; h: number } | null = null;

  function renderBody() {
    switch (symbolType) {
      case 'resistor':
        outline = { x: -22, y: -8, w: 44, h: 16 };
        return <ResistorBody />;
      case 'capacitor':
        outline = { x: -22, y: -10, w: 44, h: 20 };
        return <CapacitorBody />;
      case 'inductor':
        outline = { x: -22, y: -8, w: 44, h: 16 };
        return <InductorBody />;
      case 'diode':
        outline = { x: -22, y: -9, w: 44, h: 18 };
        return <DiodeBody />;
      case 'led':
        outline = { x: -22, y: -18, w: 44, h: 36 };
        return <LEDBody />;
      case 'transistor_npn':
        outline = { x: -22, y: -22, w: 34, h: 44 };
        return <TransistorNPNBody />;
      case 'transistor_pnp':
        outline = { x: -22, y: -22, w: 34, h: 44 };
        return <TransistorPNPBody />;
      case 'opamp':
        outline = { x: -27, y: -22, w: 60, h: 44 };
        return <OpampBody />;
      case 'crystal':
        outline = { x: -22, y: -9, w: 44, h: 18 };
        return <CrystalBody />;
      case 'fuse':
        outline = { x: -22, y: -7, w: 44, h: 14 };
        return <FuseBody />;
      case 'ic': {
        const leftCount = pins.filter((p) => p.orientation === 'left').length;
        const rightCount = pins.filter((p) => p.orientation === 'right').length;
        const maxV = Math.max(leftCount, rightCount, 1);
        const w = 40;
        const h = Math.max(30, maxV * 12 + 10);
        outline = { x: -w / 2 - 2, y: -h / 2 - 2, w: w + 4, h: h + 4 };
        return <ICBody pins={pins} />;
      }
      case 'connector': {
        const count = pins.length || 2;
        const h = Math.max(20, count * 12 + 6);
        outline = { x: -12, y: -h / 2 - 2, w: 24, h: h + 4 };
        return <ConnectorBody pinCount={count} />;
      }
      case 'ground':
        outline = { x: -12, y: -12, w: 24, h: 22 };
        return <GroundSymbol />;
      case 'vcc':
        outline = { x: -10, y: -8, w: 20, h: 20 };
        return <VCCSymbol />;
      case 'vdd':
        outline = { x: -10, y: -2, w: 20, h: 14 };
        return <VDDSymbol />;
      default:
        outline = { x: -15, y: -15, w: 30, h: 30 };
        return (
          <rect
            x={-15}
            y={-15}
            width={30}
            height={30}
            fill="#1e293b"
            stroke="#e2e8f0"
            strokeWidth={1.5}
            rx={3}
          />
        );
    }
  }

  const body = renderBody();

  return (
    <g transform={transform} opacity={opacity}>
      {/* Selection/hover highlight */}
      {(isSelected || isHovered) && outline && (
        <rect
          x={outline.x - 2}
          y={outline.y - 2}
          width={outline.w + 4}
          height={outline.h + 4}
          fill="none"
          stroke={isSelected ? '#3b82f6' : '#6366f1'}
          strokeWidth={1.5}
          strokeDasharray={isHovered && !isSelected ? '3 2' : 'none'}
          rx={3}
          opacity={0.7}
        />
      )}

      {/* Symbol body */}
      {body}

      {/* Pins */}
      {pins.map((pin) => (
        <PinElement
          key={pin.id}
          pin={pin}
          showNames={showPinNames}
          showNumbers={showPinNumbers}
        />
      ))}
    </g>
  );
});

export default SymbolRenderer;

// ---------------------------------------------------------------------------
// Symbol defs for use in <defs> block
// ---------------------------------------------------------------------------

export function SchematicSymbolDefs() {
  return (
    <defs>
      <symbol id="sym-resistor" viewBox="-25 -12 50 24" overflow="visible">
        <ResistorBody />
      </symbol>
      <symbol id="sym-capacitor" viewBox="-25 -12 50 24" overflow="visible">
        <CapacitorBody />
      </symbol>
      <symbol id="sym-inductor" viewBox="-25 -10 50 20" overflow="visible">
        <InductorBody />
      </symbol>
      <symbol id="sym-diode" viewBox="-25 -12 50 24" overflow="visible">
        <DiodeBody />
      </symbol>
      <symbol id="sym-led" viewBox="-25 -20 50 40" overflow="visible">
        <LEDBody />
      </symbol>
      <symbol id="sym-transistor-npn" viewBox="-25 -25 40 50" overflow="visible">
        <TransistorNPNBody />
      </symbol>
      <symbol id="sym-transistor-pnp" viewBox="-25 -25 40 50" overflow="visible">
        <TransistorPNPBody />
      </symbol>
      <symbol id="sym-opamp" viewBox="-30 -25 65 50" overflow="visible">
        <OpampBody />
      </symbol>
      <symbol id="sym-crystal" viewBox="-25 -12 50 24" overflow="visible">
        <CrystalBody />
      </symbol>
      <symbol id="sym-fuse" viewBox="-25 -10 50 20" overflow="visible">
        <FuseBody />
      </symbol>
      <symbol id="sym-ground" viewBox="-15 -15 30 30" overflow="visible">
        <GroundSymbol />
      </symbol>
      <symbol id="sym-vcc" viewBox="-12 -10 24 24" overflow="visible">
        <VCCSymbol />
      </symbol>
      <symbol id="sym-vdd" viewBox="-12 -5 24 20" overflow="visible">
        <VDDSymbol />
      </symbol>

      {/* Junction dot */}
      <symbol id="sym-junction" viewBox="-4 -4 8 8" overflow="visible">
        <circle cx={0} cy={0} r={3} fill="#4ade80" />
      </symbol>

      {/* No-connect marker */}
      <symbol id="sym-noconnect" viewBox="-6 -6 12 12" overflow="visible">
        <line x1={-4} y1={-4} x2={4} y2={4} stroke="#f87171" strokeWidth={1.5} />
        <line x1={4} y1={-4} x2={-4} y2={4} stroke="#f87171" strokeWidth={1.5} />
      </symbol>
    </defs>
  );
}
