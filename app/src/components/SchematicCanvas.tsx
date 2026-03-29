// ─── SchematicCanvas.tsx ─ SVG rendering engine ────────────────────────────
import React, { useMemo, useCallback } from 'react';
import type { SchComponent, SchWire, SchLabel, Point } from '../types';
import { theme } from '../styles/theme';
import { renderSymbol, getSymbolBounds, generateICSymbol, SYMBOL_DEFS, renderKiCadSymbol, getKiCadSymbolBounds } from './SymbolLibrary';
// NOTE: useEditorStore is NOT imported here - SchematicCanvas receives all data via props

// ─── Props ─────────────────────────────────────────────────────────────────
interface SchematicCanvasProps {
  width: number;
  height: number;
  components: SchComponent[];
  wires: SchWire[];
  labels: SchLabel[];
  selectedIds: string[];
  hoveredId: string | null;
  viewportX: number;
  viewportY: number;
  zoom: number;
  showGrid: boolean;
  ghostComponent?: {
    type: string;
    x: number;
    y: number;
    rotation: number;
    pinCount?: number;
    kicadSymbol?: import('./SymbolLibrary').KiCadSymbolData;
  } | null;
  ghostWirePoints?: Point[];
  selectionBox?: { x: number; y: number; w: number; h: number } | null;
  busWires?: { points: Point[] }[];
  noConnects?: Point[];
  measureLine?: { from: Point; to: Point; distMm: number } | null;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: (e: React.MouseEvent<SVGSVGElement>) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onContextMenu: (e: React.MouseEvent<SVGSVGElement>) => void;
  onComponentMouseDown: (id: string, e: React.MouseEvent) => void;
  onWireMouseDown: (id: string, e: React.MouseEvent) => void;
}

// ─── Grid Pattern ──────────────────────────────────────────────────────────
const MINOR_GRID = 2.54;   // 100mil in mm
const MAJOR_GRID = 25.4;   // 10 * 100mil

function GridPattern({ zoom }: { zoom: number }): React.ReactElement {
  const minorSize = MINOR_GRID;
  const majorSize = MAJOR_GRID;

  // Adaptive: hide minor grid when zoomed out too far
  const showMinor = zoom > 0.3;

  return (
    <defs>
      {showMinor && (
        <pattern id="minorGrid" width={minorSize} height={minorSize} patternUnits="userSpaceOnUse">
          <circle cx={minorSize / 2} cy={minorSize / 2} r={0.15 / Math.max(zoom, 0.3)} fill={theme.gridDotColor} />
        </pattern>
      )}
      <pattern id="majorGrid" width={majorSize} height={majorSize} patternUnits="userSpaceOnUse">
        {showMinor && <rect width={majorSize} height={majorSize} fill="url(#minorGrid)" />}
        <line x1={0} y1={0} x2={majorSize} y2={0} stroke={theme.gridMajorColor} strokeWidth={0.3 / Math.max(zoom, 0.1)} />
        <line x1={0} y1={0} x2={0} y2={majorSize} stroke={theme.gridMajorColor} strokeWidth={0.3 / Math.max(zoom, 0.1)} />
      </pattern>
    </defs>
  );
}

// ─── Build junction frequency map ──────────────────────────────────────────
// Count how many wire segments touch each point. A wire with N points has
// N-1 segments; each segment contributes its two endpoints.
function buildJunctionMap(wires: SchWire[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of wires) {
    for (let i = 0; i < w.points.length - 1; i++) {
      const p1 = w.points[i];
      const p2 = w.points[i + 1];
      const k1 = `${p1.x.toFixed(4)},${p1.y.toFixed(4)}`;
      const k2 = `${p2.x.toFixed(4)},${p2.y.toFixed(4)}`;
      freq.set(k1, (freq.get(k1) || 0) + 1);
      freq.set(k2, (freq.get(k2) || 0) + 1);
    }
  }
  return freq;
}

// ─── Wire Rendering ────────────────────────────────────────────────────────
function WireElement({
  wire,
  selected,
  hovered,
  onMouseDown,
  junctionMap,
}: {
  wire: SchWire;
  selected: boolean;
  hovered: boolean;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
  junctionMap: Map<string, number>;
}): React.ReactElement {
  const pts = wire.points.map(p => `${p.x},${p.y}`).join(' ');
  const color = selected ? theme.selectionColor : hovered ? theme.hoverColor : theme.schWire;
  const width = selected ? 0.8 : 0.5;

  return (
    <g>
      {/* Hit area (invisible wider path) */}
      <polyline
        points={pts}
        fill="none"
        stroke="transparent"
        strokeWidth={3}
        style={{ cursor: 'pointer' }}
        onMouseDown={(e) => onMouseDown(wire.id, e)}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Junction dots only where 3+ wire segments meet */}
      {wire.points.map((p, i) => {
        const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
        const count = junctionMap.get(key) || 0;
        if (count >= 3) {
          return <circle key={i} cx={p.x} cy={p.y} r={0.8} fill={theme.schJunction} />;
        }
        return null;
      })}
    </g>
  );
}

// ─── Component Rendering ───────────────────────────────────────────────────
function ComponentElement({
  comp,
  selected,
  hovered,
  onMouseDown,
}: {
  comp: SchComponent;
  selected: boolean;
  hovered: boolean;
  onMouseDown: (id: string, e: React.MouseEvent) => void;
}): React.ReactElement {
  const hasKiCadSymbol = !!comp.kicadSymbol;

  // Compute bounding box
  let bounds: { minX: number; minY: number; maxX: number; maxY: number };
  if (hasKiCadSymbol) {
    bounds = getKiCadSymbolBounds(comp.kicadSymbol!);
  } else {
    const symbolType = comp.symbol || comp.type;
    bounds = getSymbolBounds(symbolType);
    if (symbolType === 'ic' && comp.pins.length > 8) {
      const genDef = generateICSymbol(comp.pins.length);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of genDef.pins) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      bounds = { minX: minX - 4, minY: minY - 4, maxX: maxX + 4, maxY: maxY + 4 };
    }
  }
  const bx = bounds.minX;
  const by = bounds.minY;
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;

  return (
    <g
      transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}
      style={{ cursor: 'pointer' }}
      onMouseDown={(e) => onMouseDown(comp.id, e)}
    >
      {/* Render KiCad symbol if available, otherwise generic */}
      {hasKiCadSymbol
        ? renderKiCadSymbol({
            symbolData: comp.kicadSymbol!,
            selected,
            hover: hovered,
          })
        : renderSymbol({
            type: comp.symbol || comp.type,
            selected,
            hover: hovered,
            pinCount: comp.pins.length,
          })
      }
      {/* Selection highlight box */}
      {selected && (
        <rect
          x={bx} y={by} width={bw} height={bh}
          fill={theme.selectionFill}
          stroke={theme.selectionColor}
          strokeWidth={0.4}
          strokeDasharray="2,1"
          rx={1}
          pointerEvents="none"
        />
      )}
      {/* Pin connection points — only show for non-KiCad symbols (KiCad renderer draws its own dots) */}
      {!hasKiCadSymbol && comp.pins.map((pin, i) => (
        <circle
          key={`pin_${i}`}
          cx={pin.x}
          cy={pin.y}
          r={0.8}
          fill="none"
          stroke={theme.schPinColor ?? '#44aa44'}
          strokeWidth={0.3}
          pointerEvents="none"
          opacity={0.7}
        />
      ))}
      {/* Reference designator */}
      <text
        x={0} y={bounds.minY - 2}
        fontSize={3.2}
        fill={theme.schRefColor}
        textAnchor="middle"
        dominantBaseline="auto"
        pointerEvents="none"
        style={{ fontFamily: theme.fontSans }}
      >
        {comp.ref}
      </text>
      {/* Value */}
      <text
        x={0} y={bounds.maxY + 2}
        fontSize={2.8}
        fill={theme.schValueColor}
        textAnchor="middle"
        dominantBaseline="hanging"
        pointerEvents="none"
        style={{ fontFamily: theme.fontSans }}
      >
        {comp.value}
      </text>
    </g>
  );
}

// ─── Label Rendering ───────────────────────────────────────────────────────
function LabelElement({
  label,
  selected,
}: {
  label: SchLabel;
  selected: boolean;
}): React.ReactElement {
  const isGlobal = label.type === 'global';
  const isPower = label.type === 'power';
  const bgColor = isPower ? theme.purpleDim : isGlobal ? theme.blueDim : theme.greenDim;
  const borderColor = isPower ? theme.purple : isGlobal ? theme.blue : theme.green;
  const textColor = isPower ? theme.purple : isGlobal ? theme.blue : theme.green;

  const textLen = label.text.length * 2.2 + 4;
  return (
    <g transform={`translate(${label.x}, ${label.y})`}>
      {/* Flag shape */}
      {isGlobal ? (
        <polygon
          points={`${-textLen / 2 - 3},${-4} ${textLen / 2},${-4} ${textLen / 2 + 4},0 ${textLen / 2},4 ${-textLen / 2 - 3},4`}
          fill={bgColor}
          stroke={selected ? theme.selectionColor : borderColor}
          strokeWidth={0.5}
        />
      ) : (
        <rect
          x={-textLen / 2 - 2}
          y={-4}
          width={textLen + 4}
          height={8}
          fill={bgColor}
          stroke={selected ? theme.selectionColor : borderColor}
          strokeWidth={0.5}
          rx={1}
        />
      )}
      <text
        x={0} y={0.5}
        fontSize={3.2}
        fill={textColor}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontFamily: theme.fontMono }}
      >
        {label.text}
      </text>
      {/* Connection dot */}
      <circle cx={-textLen / 2 - 3} cy={0} r={1} fill={borderColor} />
    </g>
  );
}

// ─── Main Canvas Component ─────────────────────────────────────────────────
const SchematicCanvas: React.FC<SchematicCanvasProps> = React.memo(({
  width,
  height,
  components,
  wires,
  labels,
  selectedIds,
  hoveredId,
  viewportX,
  viewportY,
  zoom,
  showGrid,
  ghostComponent,
  ghostWirePoints,
  selectionBox,
  busWires,
  noConnects,
  measureLine,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onContextMenu,
  onComponentMouseDown,
  onWireMouseDown,
}) => {
  // Viewport bounds in schematic coords for frustum culling
  const viewBounds = useMemo(() => {
    const margin = 50 / zoom;
    return {
      left: -viewportX / zoom - margin,
      top: -viewportY / zoom - margin,
      right: (-viewportX + width) / zoom + margin,
      bottom: (-viewportY + height) / zoom + margin,
    };
  }, [viewportX, viewportY, width, height, zoom]);

  // Frustum cull components
  const visibleComponents = useMemo(() => {
    return components.filter(c => {
      return c.x >= viewBounds.left && c.x <= viewBounds.right &&
             c.y >= viewBounds.top && c.y <= viewBounds.bottom;
    });
  }, [components, viewBounds]);

  // Frustum cull wires
  const visibleWires = useMemo(() => {
    return wires.filter(w => {
      return w.points.some(p =>
        p.x >= viewBounds.left && p.x <= viewBounds.right &&
        p.y >= viewBounds.top && p.y <= viewBounds.bottom
      );
    });
  }, [wires, viewBounds]);

  // Frustum cull labels
  const visibleLabels = useMemo(() => {
    return labels.filter(l => {
      return l.x >= viewBounds.left && l.x <= viewBounds.right &&
             l.y >= viewBounds.top && l.y <= viewBounds.bottom;
    });
  }, [labels, viewBounds]);

  // Build junction frequency map for all wires (not just visible)
  const junctionMap = useMemo(() => buildJunctionMap(wires), [wires]);

  // Ghost wire preview
  const ghostWirePath = useMemo(() => {
    if (!ghostWirePoints || ghostWirePoints.length < 2) return null;
    return ghostWirePoints.map(p => `${p.x},${p.y}`).join(' ');
  }, [ghostWirePoints]);

  // Grid extent (large enough to cover any pan)
  const gridExtent = 10000;

  return (
    <svg
      width={width}
      height={height}
      style={{
        background: theme.schBackground,
        cursor: 'crosshair',
        display: 'block',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    >
      <GridPattern zoom={zoom} />
      <g transform={`translate(${viewportX}, ${viewportY}) scale(${zoom})`}>
        {/* Grid background */}
        {showGrid && (
          <rect
            x={-gridExtent}
            y={-gridExtent}
            width={gridExtent * 2}
            height={gridExtent * 2}
            fill="url(#majorGrid)"
          />
        )}

        {/* Origin crosshair */}
        <line x1={-5} y1={0} x2={5} y2={0} stroke={theme.textMuted} strokeWidth={0.15} />
        <line x1={0} y1={-5} x2={0} y2={5} stroke={theme.textMuted} strokeWidth={0.15} />

        {/* Wires layer */}
        <g>
          {visibleWires.map(w => (
            <WireElement
              key={w.id}
              wire={w}
              selected={selectedIds.includes(w.id)}
              hovered={hoveredId === w.id}
              onMouseDown={onWireMouseDown}
              junctionMap={junctionMap}
            />
          ))}
        </g>

        {/* Bus wires layer */}
        {busWires && busWires.map((bw, i) => {
          const pts = bw.points.map(p => `${p.x},${p.y}`).join(' ');
          return (
            <polyline
              key={`bus_${i}`}
              points={pts}
              fill="none"
              stroke={theme.schBus}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* No-connect markers layer */}
        {noConnects && noConnects.map((nc, i) => (
          <g key={`nc_${i}`}>
            <line x1={nc.x - 3} y1={nc.y - 3} x2={nc.x + 3} y2={nc.y + 3} stroke={theme.schNoConnect} strokeWidth={0.8} />
            <line x1={nc.x + 3} y1={nc.y - 3} x2={nc.x - 3} y2={nc.y + 3} stroke={theme.schNoConnect} strokeWidth={0.8} />
          </g>
        ))}

        {/* Components layer */}
        <g>
          {visibleComponents.map(c => (
            <ComponentElement
              key={c.id}
              comp={c}
              selected={selectedIds.includes(c.id)}
              hovered={hoveredId === c.id}
              onMouseDown={onComponentMouseDown}
            />
          ))}
        </g>

        {/* Labels layer */}
        <g>
          {visibleLabels.map(l => (
            <LabelElement
              key={l.id}
              label={l}
              selected={selectedIds.includes(l.id)}
            />
          ))}
        </g>

        {/* Ghost component preview */}
        {ghostComponent && (
          <g transform={`translate(${ghostComponent.x}, ${ghostComponent.y}) rotate(${ghostComponent.rotation})`}>
            {ghostComponent.kicadSymbol
              ? renderKiCadSymbol({
                  symbolData: ghostComponent.kicadSymbol,
                  ghost: true,
                })
              : renderSymbol({
                  type: ghostComponent.type,
                  ghost: true,
                  pinCount: ghostComponent.pinCount,
                })}
          </g>
        )}

        {/* Ghost wire preview */}
        {ghostWirePath && (
          <polyline
            points={ghostWirePath}
            fill="none"
            stroke={theme.schWire}
            strokeWidth={0.5}
            strokeDasharray="2,1"
            opacity={0.6}
          />
        )}

        {/* Measure line */}
        {measureLine && (
          <g>
            <line
              x1={measureLine.from.x} y1={measureLine.from.y}
              x2={measureLine.to.x} y2={measureLine.to.y}
              stroke={theme.highlightColor}
              strokeWidth={0.5}
              strokeDasharray="2,2"
            />
            <circle cx={measureLine.from.x} cy={measureLine.from.y} r={1} fill={theme.highlightColor} />
            <circle cx={measureLine.to.x} cy={measureLine.to.y} r={1} fill={theme.highlightColor} />
            <text
              x={(measureLine.from.x + measureLine.to.x) / 2}
              y={(measureLine.from.y + measureLine.to.y) / 2 - 3}
              fontSize={3.5}
              fill={theme.highlightColor}
              textAnchor="middle"
              dominantBaseline="auto"
              style={{ fontFamily: theme.fontMono }}
            >
              {measureLine.distMm.toFixed(2)} mm
            </text>
          </g>
        )}

        {/* Selection box */}
        {selectionBox && (
          <rect
            x={selectionBox.x}
            y={selectionBox.y}
            width={selectionBox.w}
            height={selectionBox.h}
            fill={theme.selectionFill}
            stroke={theme.selectionColor}
            strokeWidth={0.4 / zoom}
            strokeDasharray={`${2 / zoom},${1 / zoom}`}
          />
        )}
      </g>
    </svg>
  );
});

SchematicCanvas.displayName = 'SchematicCanvas';
export default SchematicCanvas;
