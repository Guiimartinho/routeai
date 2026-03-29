// ─── GerberViewer.tsx ── Layer-by-layer Gerber preview panel ──────────────────
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { theme } from '../styles/theme';
import type { BoardState, Point } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewMode = 'overlay' | 'single';

interface MeasurePoint {
  x: number;
  y: number;
}

interface GerberViewerProps {
  board: BoardState;
  visible: boolean;
  onClose: () => void;
}

// ─── Layer color mapping (standard Gerber colors) ────────────────────────────

const LAYER_COLORS: Record<string, string> = {
  'F.Cu':      '#ff4040',
  'B.Cu':      '#4080ff',
  'In1.Cu':    '#40c040',
  'In2.Cu':    '#c0c040',
  'F.Mask':    '#a040a0',
  'B.Mask':    '#40a040',
  'F.SilkS':   '#f0f040',
  'B.SilkS':   '#a040f0',
  'F.Paste':   '#c08080',
  'B.Paste':   '#8080c0',
  'Edge.Cuts': '#ffffff',
};

const ALL_LAYERS = [
  'F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu',
  'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask',
  'F.Paste', 'B.Paste', 'Edge.Cuts',
];

// ─── Component ──────────────────────────────────────────────────────────────

const GerberViewer: React.FC<GerberViewerProps> = ({ board, visible, onClose }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('overlay');
  const [singleLayer, setSingleLayer] = useState('F.Cu');
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ALL_LAYERS.forEach(l => { init[l] = true; });
    return init;
  });

  // Pan / zoom
  const [zoom, setZoom] = useState(4);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number }>({ x: 0, y: 0, px: 0, py: 0 });

  // Measurement
  const [measureActive, setMeasureActive] = useState(false);
  const [measureStart, setMeasureStart] = useState<MeasurePoint | null>(null);
  const [measureEnd, setMeasureEnd] = useState<MeasurePoint | null>(null);
  const [measureCursor, setMeasureCursor] = useState<MeasurePoint | null>(null);

  // Bounding box
  const bounds = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    board.outline.points.forEach(p => pts.push(p));
    board.components.forEach(c => c.pads.forEach(p => pts.push({ x: c.x + p.x, y: c.y + p.y })));
    board.traces.forEach(t => t.points.forEach(p => pts.push(p)));
    board.vias.forEach(v => pts.push({ x: v.x, y: v.y }));
    if (pts.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 80, w: 100, h: 80 };
    const minX = Math.min(...pts.map(p => p.x)) - 2;
    const maxX = Math.max(...pts.map(p => p.x)) + 2;
    const minY = Math.min(...pts.map(p => p.y)) - 2;
    const maxY = Math.max(...pts.map(p => p.y)) + 2;
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }, [board]);

  // Fit on first open
  useEffect(() => {
    if (!visible) return;
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth || 600;
    const ch = container.clientHeight || 400;
    const fitZoom = Math.min(cw / (bounds.w + 4), ch / (bounds.h + 4));
    setZoom(fitZoom);
    setPanX(-(bounds.minX + bounds.w / 2) * fitZoom + cw / 2);
    setPanY(-(bounds.minY + bounds.h / 2) * fitZoom + ch / 2);
  }, [visible, bounds]);

  // Coordinate conversion: screen -> board
  const screenToBoard = useCallback((sx: number, sy: number): MeasurePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (sx - rect.left - panX) / zoom,
      y: (sy - rect.top - panY) / zoom,
    };
  }, [zoom, panX, panY]);

  // Zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.1, Math.min(200, zoom * factor));
    setPanX(mx - (mx - panX) * (newZoom / zoom));
    setPanY(my - (my - panY) * (newZoom / zoom));
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (measureActive) {
      const pt = screenToBoard(e.clientX, e.clientY);
      if (!measureStart) {
        setMeasureStart(pt);
        setMeasureEnd(null);
      } else {
        setMeasureEnd(pt);
        setMeasureActive(false);
      }
      return;
    }
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    }
  }, [measureActive, measureStart, panX, panY, screenToBoard]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (measureActive && measureStart && !measureEnd) {
      setMeasureCursor(screenToBoard(e.clientX, e.clientY));
    }
    if (!isPanning) return;
    setPanX(panStartRef.current.px + (e.clientX - panStartRef.current.x));
    setPanY(panStartRef.current.py + (e.clientY - panStartRef.current.y));
  }, [isPanning, measureActive, measureStart, measureEnd, screenToBoard]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Toggle layer
  const toggleLayer = useCallback((layer: string) => {
    setLayerVisibility(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  // Active layers
  const activeLayers = useMemo(() => {
    if (viewMode === 'single') return [singleLayer];
    return ALL_LAYERS.filter(l => layerVisibility[l]);
  }, [viewMode, singleLayer, layerVisibility]);

  // Measurement distance
  const measureDist = useMemo(() => {
    const p1 = measureStart;
    const p2 = measureEnd || measureCursor;
    if (!p1 || !p2) return null;
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }, [measureStart, measureEnd, measureCursor]);

  // Drill holes from vias + through-hole pads
  const drillHoles = useMemo(() => {
    const holes: { x: number; y: number; drill: number }[] = [];
    board.vias.forEach(v => holes.push({ x: v.x, y: v.y, drill: v.drill }));
    board.components.forEach(c => {
      c.pads.forEach(p => {
        if (p.drill) {
          const rad = (c.rotation * Math.PI) / 180;
          const cosR = Math.cos(rad);
          const sinR = Math.sin(rad);
          holes.push({
            x: c.x + p.x * cosR - p.y * sinR,
            y: c.y + p.x * sinR + p.y * cosR,
            drill: p.drill,
          });
        }
      });
    });
    return holes;
  }, [board]);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const factor = 1.3;
    const newZoom = zoom * factor;
    setPanX(cx - (cx - panX) * factor);
    setPanY(cy - (cy - panY) * factor);
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const handleZoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    const factor = 1 / 1.3;
    const newZoom = zoom * factor;
    setPanX(cx - (cx - panX) * factor);
    setPanY(cy - (cy - panY) * factor);
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const handleFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth || 600;
    const ch = container.clientHeight || 400;
    const fitZoom = Math.min(cw / (bounds.w + 4), ch / (bounds.h + 4));
    setZoom(fitZoom);
    setPanX(-(bounds.minX + bounds.w / 2) * fitZoom + cw / 2);
    setPanY(-(bounds.minY + bounds.h / 2) * fitZoom + ch / 2);
  }, [bounds]);

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderOutline = useCallback((layer: string) => {
    if (layer !== 'Edge.Cuts') return null;
    const pts = board.outline.points;
    if (pts.length < 2) return null;
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
    return (
      <path
        key="outline"
        d={d}
        fill="none"
        stroke={LAYER_COLORS['Edge.Cuts']}
        strokeWidth={0.2}
        opacity={0.9}
      />
    );
  }, [board.outline.points]);

  const renderTraces = useCallback((layer: string) => {
    return board.traces
      .filter(t => t.layer === layer)
      .map(t => {
        if (t.points.length < 2) return null;
        const d = t.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        return (
          <path
            key={`trace-${t.id}`}
            d={d}
            fill="none"
            stroke={LAYER_COLORS[layer] || '#888'}
            strokeWidth={t.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        );
      });
  }, [board.traces]);

  const renderPads = useCallback((layer: string) => {
    const elements: React.ReactNode[] = [];
    board.components.forEach(comp => {
      comp.pads.forEach(pad => {
        if (!pad.layers.includes(layer)) return;
        const rad = (comp.rotation * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const px = comp.x + pad.x * cosR - pad.y * sinR;
        const py = comp.y + pad.x * sinR + pad.y * cosR;
        const color = LAYER_COLORS[layer] || '#888';

        if (pad.shape === 'circle') {
          elements.push(
            <circle
              key={`pad-${comp.id}-${pad.id}`}
              cx={px}
              cy={py}
              r={pad.width / 2}
              fill={color}
              opacity={0.85}
            />
          );
        } else if (pad.shape === 'oval') {
          elements.push(
            <ellipse
              key={`pad-${comp.id}-${pad.id}`}
              cx={px}
              cy={py}
              rx={pad.width / 2}
              ry={pad.height / 2}
              fill={color}
              opacity={0.85}
              transform={`rotate(${comp.rotation}, ${px}, ${py})`}
            />
          );
        } else {
          elements.push(
            <rect
              key={`pad-${comp.id}-${pad.id}`}
              x={px - pad.width / 2}
              y={py - pad.height / 2}
              width={pad.width}
              height={pad.height}
              fill={color}
              opacity={0.85}
              rx={pad.shape === 'roundrect' ? Math.min(pad.width, pad.height) * 0.25 : 0}
              transform={`rotate(${comp.rotation}, ${px}, ${py})`}
            />
          );
        }
      });
    });
    return elements;
  }, [board.components]);

  const renderVias = useCallback((layer: string) => {
    if (!layer.includes('Cu')) return null;
    return board.vias
      .filter(v => v.layers.includes(layer))
      .map(v => (
        <g key={`via-${v.id}`}>
          <circle cx={v.x} cy={v.y} r={v.size / 2} fill={LAYER_COLORS[layer] || '#888'} opacity={0.85} />
          <circle cx={v.x} cy={v.y} r={v.drill / 2} fill={theme.bg0} />
        </g>
      ));
  }, [board.vias]);

  const renderZones = useCallback((layer: string) => {
    return board.zones
      .filter(z => z.layer === layer)
      .map(z => {
        if (z.points.length < 3) return null;
        const d = z.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
        return (
          <path
            key={`zone-${z.id}`}
            d={d}
            fill={LAYER_COLORS[layer] || '#888'}
            opacity={0.25}
            stroke={LAYER_COLORS[layer] || '#888'}
            strokeWidth={0.1}
          />
        );
      });
  }, [board.zones]);

  const renderSilkscreen = useCallback((layer: string) => {
    if (!layer.includes('SilkS')) return null;
    const side = layer.startsWith('F.') ? 'F.Cu' : 'B.Cu';
    return board.components
      .filter(c => c.layer === side)
      .map(c => (
        <text
          key={`silk-${c.id}`}
          x={c.x}
          y={c.y}
          fill={LAYER_COLORS[layer] || '#f0f040'}
          fontSize={0.8}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily={theme.fontMono}
        >
          {c.ref}
        </text>
      ));
  }, [board.components]);

  const renderDrillHoles = useCallback(() => {
    return drillHoles.map((h, i) => (
      <g key={`drill-${i}`}>
        <circle cx={h.x} cy={h.y} r={h.drill / 2} fill="none" stroke="#e0e0e0" strokeWidth={0.08} opacity={0.6} />
        <line x1={h.x - h.drill / 3} y1={h.y} x2={h.x + h.drill / 3} y2={h.y} stroke="#e0e0e0" strokeWidth={0.06} opacity={0.4} />
        <line x1={h.x} y1={h.y - h.drill / 3} x2={h.x} y2={h.y + h.drill / 3} stroke="#e0e0e0" strokeWidth={0.06} opacity={0.4} />
      </g>
    ));
  }, [drillHoles]);

  if (!visible) return null;

  const measureP2 = measureEnd || measureCursor;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.dialogTitle}>Gerber Viewer</span>
          <div style={styles.titleControls}>
            <span style={styles.zoomLabel}>{(zoom * 10).toFixed(0)}%</span>
            <button style={styles.titleBtn} onClick={handleZoomOut} title="Zoom Out">-</button>
            <button style={styles.titleBtn} onClick={handleZoomIn} title="Zoom In">+</button>
            <button style={styles.titleBtn} onClick={handleFit} title="Fit">Fit</button>
            <button
              style={{
                ...styles.titleBtn,
                ...(measureActive ? { background: theme.blue, color: '#fff' } : {}),
              }}
              onClick={() => {
                setMeasureActive(!measureActive);
                setMeasureStart(null);
                setMeasureEnd(null);
                setMeasureCursor(null);
              }}
              title="Measure Tool"
            >
              Measure
            </button>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        <div style={styles.body}>
          {/* Left panel: layer controls */}
          <div style={styles.layerPanel}>
            {/* View mode toggle */}
            <div style={styles.modeToggle}>
              <button
                style={{
                  ...styles.modeBtn,
                  ...(viewMode === 'overlay' ? styles.modeBtnActive : {}),
                }}
                onClick={() => setViewMode('overlay')}
              >
                Overlay
              </button>
              <button
                style={{
                  ...styles.modeBtn,
                  ...(viewMode === 'single' ? styles.modeBtnActive : {}),
                }}
                onClick={() => setViewMode('single')}
              >
                Single
              </button>
            </div>

            <div style={styles.layerTitle}>Layers</div>

            {viewMode === 'overlay' ? (
              <div style={styles.layerList}>
                {ALL_LAYERS.map(layer => {
                  const hasContent = layerHasContent(board, layer);
                  return (
                    <label
                      key={layer}
                      style={{
                        ...styles.layerItem,
                        opacity: hasContent ? 1 : 0.4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={layerVisibility[layer] ?? true}
                        onChange={() => toggleLayer(layer)}
                        style={styles.layerCheckbox}
                      />
                      <span
                        style={{
                          ...styles.layerSwatch,
                          background: LAYER_COLORS[layer] || '#888',
                        }}
                      />
                      <span style={styles.layerName}>{layer}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div style={styles.layerList}>
                {ALL_LAYERS.map(layer => {
                  const hasContent = layerHasContent(board, layer);
                  return (
                    <button
                      key={layer}
                      style={{
                        ...styles.singleLayerBtn,
                        ...(singleLayer === layer ? styles.singleLayerBtnActive : {}),
                        opacity: hasContent ? 1 : 0.4,
                      }}
                      onClick={() => setSingleLayer(layer)}
                    >
                      <span
                        style={{
                          ...styles.layerSwatch,
                          background: LAYER_COLORS[layer] || '#888',
                        }}
                      />
                      <span style={styles.layerName}>{layer}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Drill holes toggle */}
            <div style={{ ...styles.layerTitle, marginTop: 12 }}>Drill Data</div>
            <div style={styles.drillInfo}>
              <span style={styles.drillCount}>{drillHoles.length} holes</span>
              {drillHoles.length > 0 && (
                <span style={styles.drillSizes}>
                  {[...new Set(drillHoles.map(h => h.drill.toFixed(2)))].sort().join(', ')} mm
                </span>
              )}
            </div>

            {/* Measurement result */}
            {measureDist !== null && (
              <div style={styles.measureResult}>
                <div style={styles.layerTitle}>Measurement</div>
                <div style={styles.measureValue}>
                  {measureDist.toFixed(3)} mm
                </div>
                {measureStart && (
                  <div style={styles.measureCoord}>
                    From: ({measureStart.x.toFixed(2)}, {measureStart.y.toFixed(2)})
                  </div>
                )}
                {(measureEnd || measureCursor) && (
                  <div style={styles.measureCoord}>
                    To: ({(measureEnd || measureCursor)!.x.toFixed(2)}, {(measureEnd || measureCursor)!.y.toFixed(2)})
                  </div>
                )}
                <button
                  style={styles.clearMeasureBtn}
                  onClick={() => {
                    setMeasureStart(null);
                    setMeasureEnd(null);
                    setMeasureCursor(null);
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Main SVG canvas */}
          <div
            ref={containerRef}
            style={{
              ...styles.canvasContainer,
              cursor: measureActive ? 'crosshair' : isPanning ? 'grabbing' : 'grab',
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              style={styles.svg}
            >
              <rect width="100%" height="100%" fill={theme.bg0} />

              <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>
                {/* Render layers bottom-to-top */}
                {[...activeLayers].reverse().map(layer => (
                  <g key={layer} opacity={0.85}>
                    {renderZones(layer)}
                    {renderTraces(layer)}
                    {renderPads(layer)}
                    {renderVias(layer)}
                    {renderSilkscreen(layer)}
                    {renderOutline(layer)}
                  </g>
                ))}

                {/* Drill holes overlay */}
                {renderDrillHoles()}

                {/* Measurement line */}
                {measureStart && measureP2 && (
                  <g>
                    <line
                      x1={measureStart.x}
                      y1={measureStart.y}
                      x2={measureP2.x}
                      y2={measureP2.y}
                      stroke="#ff0"
                      strokeWidth={0.15}
                      strokeDasharray="0.3,0.3"
                    />
                    <circle cx={measureStart.x} cy={measureStart.y} r={0.3} fill="#ff0" />
                    {measureP2 && (
                      <circle cx={measureP2.x} cy={measureP2.y} r={0.3} fill="#ff0" />
                    )}
                  </g>
                )}
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Helper ─────────────────────────────────────────────────────────────────

function layerHasContent(board: BoardState, layer: string): boolean {
  if (layer === 'Edge.Cuts') return board.outline.points.length >= 3;
  if (board.traces.some(t => t.layer === layer)) return true;
  if (board.zones.some(z => z.layer === layer)) return true;
  if (board.components.some(c => c.pads.some(p => p.layers.includes(layer)))) return true;
  if (layer.includes('Cu') && board.vias.some(v => v.layers.includes(layer))) return true;
  if (layer.includes('SilkS')) {
    const side = layer.startsWith('F.') ? 'F.Cu' : 'B.Cu';
    return board.components.some(c => c.layer === side);
  }
  return false;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    width: '90vw',
    maxWidth: 1200,
    height: '85vh',
    background: theme.bg1,
    borderRadius: theme.radiusMd,
    border: theme.border,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: theme.shadowLg,
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    background: theme.bg2,
    borderBottom: theme.border,
    gap: 12,
  },
  dialogTitle: {
    fontWeight: 600,
    fontSize: theme.fontLg,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
  },
  titleControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
  },
  titleBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  zoomLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    minWidth: 40,
    textAlign: 'right' as const,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 18,
    cursor: 'pointer',
    marginLeft: 8,
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  layerPanel: {
    width: 180,
    background: theme.bg2,
    borderRight: theme.border,
    padding: '8px 0',
    overflowY: 'auto' as const,
    flexShrink: 0,
  },
  modeToggle: {
    display: 'flex',
    margin: '0 8px 8px',
    gap: 2,
  },
  modeBtn: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
  },
  modeBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  layerTitle: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    padding: '4px 10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  layerList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
  },
  layerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    color: theme.textSecondary,
  },
  layerCheckbox: {
    width: 12,
    height: 12,
    accentColor: theme.blue,
  },
  layerSwatch: {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  layerName: {
    fontFamily: theme.fontMono,
    fontSize: theme.fontXs,
  },
  singleLayerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    textAlign: 'left' as const,
    width: '100%',
  },
  singleLayerBtnActive: {
    background: theme.blueDim,
    color: theme.blue,
  },
  drillInfo: {
    padding: '4px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  drillCount: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
  },
  drillSizes: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
  },
  measureResult: {
    margin: '8px 8px',
    padding: 8,
    background: theme.bg3,
    borderRadius: theme.radiusSm,
    border: `1px solid ${theme.yellow}40`,
  },
  measureValue: {
    fontSize: theme.fontLg,
    fontWeight: 700,
    color: theme.yellow,
    fontFamily: theme.fontMono,
    padding: '2px 0 4px',
  },
  measureCoord: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
  },
  clearMeasureBtn: {
    marginTop: 6,
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: theme.fontXs,
    width: '100%',
  },
  canvasContainer: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
    background: theme.bg0,
  },
  svg: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
};

export default GerberViewer;
