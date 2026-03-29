/**
 * SchematicCanvas - SVG rendering of schematic elements.
 *
 * Renders components with their symbols, wires with junction dots, net labels,
 * power symbols, bus notation, selection highlighting, and ghost previews
 * during placement and wire drawing.
 */

import { memo, useCallback, useMemo } from 'react';
import {
  useSchematicStore,
  type SchematicComponent,
  type SchematicWire,
  type SchematicLabel,
  type SchematicBus,
  type PowerSymbol,
  type SchematicJunction,
  type SchematicPoint,
  type WireSegment,
} from '../../stores/schematicStore';
import SymbolRenderer, { SchematicSymbolDefs } from './SymbolRenderer';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ComponentElementProps {
  component: SchematicComponent;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

const ComponentElement = memo(function ComponentElement({
  component,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: ComponentElementProps) {
  const { id, symbolType, pins, position, rotation, mirror, reference, value, selected } = component;
  const hoveredId = useSchematicStore((s) => s.hoveredId);

  return (
    <g
      transform={`translate(${position.x}, ${position.y})`}
      onMouseDown={(e) => onMouseDown(id, e)}
      onMouseEnter={() => onMouseEnter(id)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
      data-component-id={id}
    >
      <SymbolRenderer
        symbolType={symbolType}
        pins={pins}
        rotation={rotation}
        mirror={mirror}
        isSelected={selected}
        isHovered={hoveredId === id}
      />
      {/* Reference designator */}
      <text
        x={0}
        y={-22}
        textAnchor="middle"
        fontSize={8}
        fill="#93c5fd"
        fontWeight="bold"
      >
        {reference}
      </text>
      {/* Value */}
      <text
        x={0}
        y={28}
        textAnchor="middle"
        fontSize={7}
        fill="#a5b4fc"
      >
        {value}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Wire element
// ---------------------------------------------------------------------------

interface WireElementProps {
  wire: SchematicWire;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

const WireElement = memo(function WireElement({
  wire,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: WireElementProps) {
  const hoveredId = useSchematicStore((s) => s.hoveredId);
  const isHovered = hoveredId === wire.id;

  if (wire.segments.length === 0) return null;

  const d = wire.segments.reduce((path, seg, i) => {
    if (i === 0) {
      return `M ${seg.start.x},${seg.start.y} L ${seg.end.x},${seg.end.y}`;
    }
    return `${path} L ${seg.end.x},${seg.end.y}`;
  }, '');

  const strokeColor = wire.selected ? '#3b82f6' : isHovered ? '#6366f1' : '#4ade80';
  const strokeWidth = wire.selected ? 2.5 : isHovered ? 2 : 1.5;

  return (
    <g
      onMouseDown={(e) => onMouseDown(wire.id, e)}
      onMouseEnter={() => onMouseEnter(wire.id)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
      data-wire-id={wire.id}
    >
      {/* Hit area (wider invisible path for easier selection) */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={8} />
      {/* Visible wire */}
      <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
});

// ---------------------------------------------------------------------------
// Junction dot
// ---------------------------------------------------------------------------

interface JunctionElementProps {
  junction: SchematicJunction;
}

const JunctionElement = memo(function JunctionElement({ junction }: JunctionElementProps) {
  return (
    <circle
      cx={junction.position.x}
      cy={junction.position.y}
      r={3}
      fill="#4ade80"
      data-junction-id={junction.id}
    />
  );
});

// ---------------------------------------------------------------------------
// Label element
// ---------------------------------------------------------------------------

interface LabelElementProps {
  label: SchematicLabel;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

const LabelElement = memo(function LabelElement({
  label,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: LabelElementProps) {
  const hoveredId = useSchematicStore((s) => s.hoveredId);
  const isHovered = hoveredId === label.id;

  const bgWidth = label.text.length * 6 + 16;
  const bgHeight = 14;
  const typeColor = label.type === 'global' ? '#f472b6' : label.type === 'hierarchical' ? '#c084fc' : '#4ade80';

  return (
    <g
      transform={`translate(${label.position.x}, ${label.position.y}) rotate(${label.rotation})`}
      onMouseDown={(e) => onMouseDown(label.id, e)}
      onMouseEnter={() => onMouseEnter(label.id)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
      data-label-id={label.id}
    >
      {/* Background */}
      <rect
        x={-2}
        y={-bgHeight / 2}
        width={bgWidth}
        height={bgHeight}
        fill={label.selected ? '#1e3a5f' : '#1e293b'}
        stroke={label.selected ? '#3b82f6' : isHovered ? '#6366f1' : typeColor}
        strokeWidth={1}
        rx={2}
      />
      {/* Flag indicator for type */}
      {label.type !== 'net' && (
        <polygon
          points={`${bgWidth - 2},${-bgHeight / 2} ${bgWidth + 6},0 ${bgWidth - 2},${bgHeight / 2}`}
          fill={label.selected ? '#1e3a5f' : '#1e293b'}
          stroke={label.selected ? '#3b82f6' : typeColor}
          strokeWidth={1}
        />
      )}
      {/* Connection line to wire */}
      <line x1={0} y1={0} x2={-6} y2={0} stroke={typeColor} strokeWidth={1.5} />
      <circle cx={-6} cy={0} r={2} fill={typeColor} />
      {/* Label text */}
      <text
        x={bgWidth / 2}
        y={1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={8}
        fill={typeColor}
        fontFamily="monospace"
      >
        {label.text}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Bus element
// ---------------------------------------------------------------------------

interface BusElementProps {
  bus: SchematicBus;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
}

const BusElement = memo(function BusElement({ bus, onMouseDown }: BusElementProps) {
  if (bus.segments.length === 0) return null;

  const d = bus.segments.reduce((path, seg, i) => {
    if (i === 0) {
      return `M ${seg.start.x},${seg.start.y} L ${seg.end.x},${seg.end.y}`;
    }
    return `${path} L ${seg.end.x},${seg.end.y}`;
  }, '');

  const strokeColor = bus.selected ? '#3b82f6' : '#fbbf24';

  return (
    <g
      onMouseDown={(e) => onMouseDown(bus.id, e)}
      className="cursor-pointer"
      data-bus-id={bus.id}
    >
      <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
      <path d={d} fill="none" stroke={strokeColor} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      {/* Bus name at start */}
      <text
        x={bus.segments[0].start.x}
        y={bus.segments[0].start.y - 8}
        textAnchor="start"
        fontSize={7}
        fill="#fbbf24"
        fontFamily="monospace"
      >
        {bus.name}[{bus.members.length - 1}:0]
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Power symbol element
// ---------------------------------------------------------------------------

interface PowerSymbolElementProps {
  symbol: PowerSymbol;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
}

const PowerSymbolElement = memo(function PowerSymbolElement({
  symbol,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: PowerSymbolElementProps) {
  const hoveredId = useSchematicStore((s) => s.hoveredId);
  const isHovered = hoveredId === symbol.id;

  const symbolTypeMap: Record<string, 'ground' | 'vcc' | 'vdd'> = {
    gnd: 'ground',
    gnda: 'ground',
    vcc: 'vcc',
    vdd: 'vdd',
    vee: 'vdd',
    custom: 'vcc',
  };

  const mapped = symbolTypeMap[symbol.type] || 'vcc';

  return (
    <g
      transform={`translate(${symbol.position.x}, ${symbol.position.y}) rotate(${symbol.rotation})`}
      onMouseDown={(e) => onMouseDown(symbol.id, e)}
      onMouseEnter={() => onMouseEnter(symbol.id)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
      data-power-id={symbol.id}
    >
      <SymbolRenderer
        symbolType={mapped}
        pins={[]}
        isSelected={symbol.selected}
        isHovered={isHovered}
      />
      <text
        x={12}
        y={-2}
        fontSize={7}
        fill="#f87171"
        fontWeight="bold"
      >
        {symbol.name}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Wire preview (ghost while drawing)
// ---------------------------------------------------------------------------

interface WirePreviewProps {
  segments: WireSegment[];
  startPoint: SchematicPoint;
}

const WirePreview = memo(function WirePreview({ segments, startPoint }: WirePreviewProps) {
  if (segments.length === 0) {
    return (
      <circle cx={startPoint.x} cy={startPoint.y} r={3} fill="#4ade80" opacity={0.5} />
    );
  }

  const d = segments.reduce((path, seg, i) => {
    if (i === 0) {
      return `M ${seg.start.x},${seg.start.y} L ${seg.end.x},${seg.end.y}`;
    }
    return `${path} L ${seg.end.x},${seg.end.y}`;
  }, '');

  return (
    <g>
      <path d={d} fill="none" stroke="#4ade80" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.6} />
      {/* Start dot */}
      <circle cx={segments[0].start.x} cy={segments[0].start.y} r={3} fill="#4ade80" opacity={0.5} />
      {/* End dot */}
      <circle
        cx={segments[segments.length - 1].end.x}
        cy={segments[segments.length - 1].end.y}
        r={3}
        fill="#4ade80"
        opacity={0.7}
      />
    </g>
  );
});

// ---------------------------------------------------------------------------
// Component placement ghost
// ---------------------------------------------------------------------------

interface PlacementGhostProps {
  component: SchematicComponent;
  position: SchematicPoint;
}

const PlacementGhost = memo(function PlacementGhost({ component, position }: PlacementGhostProps) {
  return (
    <g transform={`translate(${position.x}, ${position.y})`}>
      <SymbolRenderer
        symbolType={component.symbolType}
        pins={component.pins}
        rotation={component.rotation}
        mirror={component.mirror}
        isGhost={true}
      />
      <text
        x={0}
        y={-22}
        textAnchor="middle"
        fontSize={8}
        fill="#93c5fd"
        opacity={0.5}
      >
        {component.reference}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// Selection rectangle overlay
// ---------------------------------------------------------------------------

interface SelectionRectProps {
  start: SchematicPoint;
  end: SchematicPoint;
}

export const SelectionRect = memo(function SelectionRect({ start, end }: SelectionRectProps) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);

  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill="rgba(59, 130, 246, 0.08)"
      stroke="#3b82f6"
      strokeWidth={1}
      strokeDasharray="4 2"
    />
  );
});

// ---------------------------------------------------------------------------
// Grid rendering
// ---------------------------------------------------------------------------

interface GridProps {
  gridSize: number;
  viewportOffset: SchematicPoint;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
}

const Grid = memo(function Grid({ gridSize, viewportOffset, zoom, canvasWidth, canvasHeight }: GridProps) {
  const effectiveGrid = gridSize * zoom;
  if (effectiveGrid < 4) return null; // Too small to display

  const startX = -(viewportOffset.x % effectiveGrid);
  const startY = -(viewportOffset.y % effectiveGrid);

  const lines: JSX.Element[] = [];
  let key = 0;

  // Vertical lines
  for (let x = startX; x < canvasWidth; x += effectiveGrid) {
    const isMajor = Math.round((x - viewportOffset.x) / effectiveGrid) % 5 === 0;
    lines.push(
      <line
        key={key++}
        x1={x}
        y1={0}
        x2={x}
        y2={canvasHeight}
        stroke={isMajor ? '#334155' : '#1e293b'}
        strokeWidth={isMajor ? 0.5 : 0.25}
      />,
    );
  }

  // Horizontal lines
  for (let y = startY; y < canvasHeight; y += effectiveGrid) {
    const isMajor = Math.round((y - viewportOffset.y) / effectiveGrid) % 5 === 0;
    lines.push(
      <line
        key={key++}
        x1={0}
        y1={y}
        x2={canvasWidth}
        y2={y}
        stroke={isMajor ? '#334155' : '#1e293b'}
        strokeWidth={isMajor ? 0.5 : 0.25}
      />,
    );
  }

  return <g className="schematic-grid">{lines}</g>;
});

// ---------------------------------------------------------------------------
// Main SchematicCanvas
// ---------------------------------------------------------------------------

export interface SchematicCanvasProps {
  width: number;
  height: number;
  selectionRect: { start: SchematicPoint; end: SchematicPoint } | null;
  onElementMouseDown: (id: string, e: React.MouseEvent) => void;
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onCanvasMouseMove: (e: React.MouseEvent) => void;
  onCanvasMouseUp: (e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export default function SchematicCanvas({
  width,
  height,
  selectionRect,
  onElementMouseDown,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onWheel,
}: SchematicCanvasProps) {
  const components = useSchematicStore((s) => s.components);
  const wires = useSchematicStore((s) => s.wires);
  const junctions = useSchematicStore((s) => s.junctions);
  const labels = useSchematicStore((s) => s.labels);
  const buses = useSchematicStore((s) => s.buses);
  const powerSymbols = useSchematicStore((s) => s.powerSymbols);
  const viewportOffset = useSchematicStore((s) => s.viewportOffset);
  const viewportZoom = useSchematicStore((s) => s.viewportZoom);
  const showGrid = useSchematicStore((s) => s.showGrid);
  const gridSize = useSchematicStore((s) => s.gridSize);
  const wireDrawing = useSchematicStore((s) => s.wireDrawing);
  const wireStartPoint = useSchematicStore((s) => s.wireStartPoint);
  const wirePreviewSegments = useSchematicStore((s) => s.wirePreviewSegments);
  const placingComponent = useSchematicStore((s) => s.placingComponent);
  const placingPosition = useSchematicStore((s) => s.placingPosition);
  const setHovered = useSchematicStore((s) => s.setHovered);

  const handleMouseEnter = useCallback((id: string) => setHovered(id), [setHovered]);
  const handleMouseLeave = useCallback(() => setHovered(null), [setHovered]);

  const componentList = useMemo(() => Array.from(components.values()), [components]);
  const wireList = useMemo(() => Array.from(wires.values()), [wires]);
  const junctionList = useMemo(() => Array.from(junctions.values()), [junctions]);
  const labelList = useMemo(() => Array.from(labels.values()), [labels]);
  const busList = useMemo(() => Array.from(buses.values()), [buses]);
  const powerList = useMemo(() => Array.from(powerSymbols.values()), [powerSymbols]);

  return (
    <svg
      width={width}
      height={height}
      className="schematic-canvas bg-gray-950"
      onMouseDown={onCanvasMouseDown}
      onMouseMove={onCanvasMouseMove}
      onMouseUp={onCanvasMouseUp}
      onWheel={onWheel}
      style={{ cursor: getCursor(useSchematicStore.getState().toolMode) }}
    >
      <SchematicSymbolDefs />

      {/* Grid (drawn in screen space) */}
      {showGrid && (
        <Grid
          gridSize={gridSize}
          viewportOffset={viewportOffset}
          zoom={viewportZoom}
          canvasWidth={width}
          canvasHeight={height}
        />
      )}

      {/* World-space content */}
      <g transform={`translate(${viewportOffset.x}, ${viewportOffset.y}) scale(${viewportZoom})`}>
        {/* Buses (drawn under wires) */}
        {busList.map((bus) => (
          <BusElement
            key={bus.id}
            bus={bus}
            onMouseDown={onElementMouseDown}
          />
        ))}

        {/* Wires */}
        {wireList.map((wire) => (
          <WireElement
            key={wire.id}
            wire={wire}
            onMouseDown={onElementMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ))}

        {/* Junctions */}
        {junctionList.map((junc) => (
          <JunctionElement key={junc.id} junction={junc} />
        ))}

        {/* Components */}
        {componentList.map((comp) => (
          <ComponentElement
            key={comp.id}
            component={comp}
            onMouseDown={onElementMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ))}

        {/* Labels */}
        {labelList.map((label) => (
          <LabelElement
            key={label.id}
            label={label}
            onMouseDown={onElementMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ))}

        {/* Power symbols */}
        {powerList.map((ps) => (
          <PowerSymbolElement
            key={ps.id}
            symbol={ps}
            onMouseDown={onElementMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ))}

        {/* Wire drawing preview */}
        {wireDrawing && wireStartPoint && (
          <WirePreview segments={wirePreviewSegments} startPoint={wireStartPoint} />
        )}

        {/* Component placement ghost */}
        {placingComponent && placingPosition && (
          <PlacementGhost component={placingComponent} position={placingPosition} />
        )}

        {/* Selection rectangle */}
        {selectionRect && (
          <SelectionRect start={selectionRect.start} end={selectionRect.end} />
        )}
      </g>

      {/* Origin crosshair */}
      <g transform={`translate(${viewportOffset.x}, ${viewportOffset.y})`} opacity={0.2}>
        <line x1={-10} y1={0} x2={10} y2={0} stroke="#94a3b8" strokeWidth={0.5} />
        <line x1={0} y1={-10} x2={0} y2={10} stroke="#94a3b8" strokeWidth={0.5} />
      </g>
    </svg>
  );
}

function getCursor(toolMode: string): string {
  switch (toolMode) {
    case 'select': return 'default';
    case 'wire': return 'crosshair';
    case 'component': return 'copy';
    case 'label': return 'text';
    case 'bus': return 'crosshair';
    case 'power': return 'copy';
    default: return 'default';
  }
}
