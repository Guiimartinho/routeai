// ─── BoardOutlineEditor.tsx ── PCB outline drawing/editing dialog ────────────
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { theme } from '../styles/theme';
import type { Point, BoardOutline } from '../types';
import { useProjectStore } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

type DrawTool = 'line' | 'rect' | 'circle' | 'arc';
type EditorMode = 'draw' | 'edit';
type QuickShape = 'rectangle' | 'circle' | 'roundedRect';

interface BoardOutlineEditorProps {
  visible: boolean;
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const GRID_STEP = 0.1; // 0.1mm snap
const GRID_MAJOR = 10;  // Every 1mm (10 * 0.1)
const ORIGIN_SIZE = 1.5;

// ─── UID generator ──────────────────────────────────────────────────────────

let _uid = 0;
function uid(): string {
  return `cutout_${Date.now()}_${(++_uid).toString(36)}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

const BoardOutlineEditor: React.FC<BoardOutlineEditorProps> = ({ visible, onClose }) => {
  const projectStore = useProjectStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outline points (working copy)
  const [outlinePoints, setOutlinePoints] = useState<Point[]>([]);
  const [cutouts, setCutouts] = useState<Point[][]>([]);

  // Mode & tool
  const [mode, setMode] = useState<EditorMode>('draw');
  const [drawTool, setDrawTool] = useState<DrawTool>('line');
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [isDrawingCutout, setIsDrawingCutout] = useState(false);

  // Edit mode state
  const [dragVertex, setDragVertex] = useState<{ outlineIdx: number; pointIdx: number } | null>(null);

  // Quick shape
  const [quickShape, setQuickShape] = useState<QuickShape>('rectangle');
  const [shapeW, setShapeW] = useState(50);
  const [shapeH, setShapeH] = useState(30);
  const [shapeR, setShapeR] = useState(3);
  const [shapeDia, setShapeDia] = useState(30);

  // Pan / zoom
  const [zoom, setZoom] = useState(5);
  const [panX, setPanX] = useState(100);
  const [panY, setPanY] = useState(100);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });

  // Mouse position in board coords
  const [cursorPos, setCursorPos] = useState<Point>({ x: 0, y: 0 });

  // Load outline from store on open
  useEffect(() => {
    if (!visible) return;
    setOutlinePoints([...projectStore.board.outline.points]);
    setCutouts([]);
    setDrawingPoints([]);
    setMode(projectStore.board.outline.points.length >= 3 ? 'edit' : 'draw');
  }, [visible, projectStore.board.outline.points]);

  // Fit view
  useEffect(() => {
    if (!visible || !containerRef.current) return;
    const cw = containerRef.current.clientWidth || 600;
    const ch = containerRef.current.clientHeight || 400;
    const pts = outlinePoints.length > 0 ? outlinePoints : [{ x: 0, y: 0 }, { x: 100, y: 80 }];
    const minX = Math.min(...pts.map(p => p.x)) - 5;
    const maxX = Math.max(...pts.map(p => p.x)) + 5;
    const minY = Math.min(...pts.map(p => p.y)) - 5;
    const maxY = Math.max(...pts.map(p => p.y)) + 5;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const fitZoom = Math.min(cw / bw, ch / bh);
    setZoom(fitZoom);
    setPanX(-(minX + bw / 2) * fitZoom + cw / 2);
    setPanY(-(minY + bh / 2) * fitZoom + ch / 2);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap to grid
  const snap = useCallback((v: number): number => {
    return Math.round(v / GRID_STEP) * GRID_STEP;
  }, []);

  // Screen to board coordinates
  const screenToBoard = useCallback((sx: number, sy: number): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: snap((sx - rect.left - panX) / zoom),
      y: snap((sy - rect.top - panY) / zoom),
    };
  }, [zoom, panX, panY, snap]);

  // Board dimensions
  const dimensions = useMemo(() => {
    const pts = outlinePoints;
    if (pts.length < 2) return { width: 0, height: 0, area: 0, perimeter: 0 };
    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));
    // Shoelace area
    let area = 0;
    let perimeter = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      const dx = pts[j].x - pts[i].x;
      const dy = pts[j].y - pts[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    return {
      width: maxX - minX,
      height: maxY - minY,
      area: Math.abs(area) / 2,
      perimeter,
    };
  }, [outlinePoints]);

  // ─── Event handlers ───────────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.5, Math.min(100, zoom * factor));
    setPanX(mx - (mx - panX) * (newZoom / zoom));
    setPanY(my - (my - panY) * (newZoom / zoom));
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      return;
    }
    if (e.button !== 0) return;

    const pt = screenToBoard(e.clientX, e.clientY);
    setCursorPos(pt);

    if (mode === 'edit') {
      // Check if clicking near a vertex
      const hitRadius = 1.5 / zoom;
      // Check outline vertices
      for (let i = 0; i < outlinePoints.length; i++) {
        const dx = outlinePoints[i].x - pt.x;
        const dy = outlinePoints[i].y - pt.y;
        if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
          setDragVertex({ outlineIdx: -1, pointIdx: i });
          return;
        }
      }
      // Check cutout vertices
      for (let ci = 0; ci < cutouts.length; ci++) {
        for (let pi = 0; pi < cutouts[ci].length; pi++) {
          const dx = cutouts[ci][pi].x - pt.x;
          const dy = cutouts[ci][pi].y - pt.y;
          if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
            setDragVertex({ outlineIdx: ci, pointIdx: pi });
            return;
          }
        }
      }
      return;
    }

    if (mode === 'draw') {
      if (drawTool === 'line') {
        setDrawingPoints(prev => [...prev, pt]);
      } else if (drawTool === 'rect') {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
        } else {
          const p0 = drawingPoints[0];
          const rectPts: Point[] = [
            { x: p0.x, y: p0.y },
            { x: pt.x, y: p0.y },
            { x: pt.x, y: pt.y },
            { x: p0.x, y: pt.y },
          ];
          if (isDrawingCutout) {
            setCutouts(prev => [...prev, rectPts]);
          } else {
            setOutlinePoints(rectPts);
          }
          setDrawingPoints([]);
          setMode('edit');
        }
      } else if (drawTool === 'circle') {
        if (drawingPoints.length === 0) {
          setDrawingPoints([pt]);
        } else {
          const center = drawingPoints[0];
          const radius = Math.sqrt((pt.x - center.x) ** 2 + (pt.y - center.y) ** 2);
          const circlePts = generateCirclePoints(center.x, center.y, radius, 36);
          if (isDrawingCutout) {
            setCutouts(prev => [...prev, circlePts]);
          } else {
            setOutlinePoints(circlePts);
          }
          setDrawingPoints([]);
          setMode('edit');
        }
      } else if (drawTool === 'arc') {
        setDrawingPoints(prev => [...prev, pt]);
        if (drawingPoints.length >= 2) {
          // 3 points define an arc: center, start, end
          const center = drawingPoints[0];
          const startPt = drawingPoints[1];
          const endPt = pt;
          const radius = Math.sqrt((startPt.x - center.x) ** 2 + (startPt.y - center.y) ** 2);
          const startAngle = Math.atan2(startPt.y - center.y, startPt.x - center.x);
          const endAngle = Math.atan2(endPt.y - center.y, endPt.x - center.x);
          const arcPts = generateArcPoints(center.x, center.y, radius, startAngle, endAngle, 18);
          // Append arc points to current drawing/outline
          if (isDrawingCutout) {
            setCutouts(prev => [...prev, arcPts]);
          } else {
            setOutlinePoints(prev => [...prev, ...arcPts]);
          }
          setDrawingPoints([]);
        }
      }
    }
  }, [mode, drawTool, drawingPoints, screenToBoard, zoom, outlinePoints, cutouts, isDrawingCutout, panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = screenToBoard(e.clientX, e.clientY);
    setCursorPos(pt);

    if (isPanning) {
      setPanX(panStartRef.current.px + (e.clientX - panStartRef.current.x));
      setPanY(panStartRef.current.py + (e.clientY - panStartRef.current.y));
      return;
    }

    if (dragVertex) {
      if (dragVertex.outlineIdx === -1) {
        setOutlinePoints(prev => {
          const next = [...prev];
          next[dragVertex.pointIdx] = pt;
          return next;
        });
      } else {
        setCutouts(prev => {
          const next = prev.map(c => [...c]);
          next[dragVertex.outlineIdx][dragVertex.pointIdx] = pt;
          return next;
        });
      }
    }
  }, [isPanning, dragVertex, screenToBoard]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragVertex(null);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (mode !== 'draw' || drawTool !== 'line') return;
    // Close polygon
    if (drawingPoints.length >= 3) {
      if (isDrawingCutout) {
        setCutouts(prev => [...prev, [...drawingPoints]]);
      } else {
        setOutlinePoints([...drawingPoints]);
      }
      setDrawingPoints([]);
      setMode('edit');
    }
  }, [mode, drawTool, drawingPoints, isDrawingCutout]);

  // ─── Quick shape generators ───────────────────────────────────────────────

  const applyQuickRect = useCallback(() => {
    setOutlinePoints([
      { x: 0, y: 0 },
      { x: shapeW, y: 0 },
      { x: shapeW, y: shapeH },
      { x: 0, y: shapeH },
    ]);
    setMode('edit');
  }, [shapeW, shapeH]);

  const applyQuickCircle = useCallback(() => {
    const r = shapeDia / 2;
    setOutlinePoints(generateCirclePoints(r, r, r, 48));
    setMode('edit');
  }, [shapeDia]);

  const applyQuickRoundedRect = useCallback(() => {
    const r = Math.min(shapeR, shapeW / 2, shapeH / 2);
    const pts: Point[] = [];
    // Top-right corner
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / 8);
      pts.push({ x: shapeW - r + r * Math.cos(a), y: r + r * Math.sin(a) });
    }
    // Bottom-right corner (sin was inverted, fix direction)
    for (let i = 0; i <= 8; i++) {
      const a = 0 + (Math.PI / 2) * (i / 8);
      pts.push({ x: shapeW - r + r * Math.cos(a), y: shapeH - r + r * Math.sin(a) });
    }
    // Bottom-left corner
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 2 + (Math.PI / 2) * (i / 8);
      pts.push({ x: r + r * Math.cos(a), y: shapeH - r + r * Math.sin(a) });
    }
    // Top-left corner
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (Math.PI / 2) * (i / 8);
      pts.push({ x: r + r * Math.cos(a), y: r + r * Math.sin(a) });
    }
    setOutlinePoints(pts);
    setMode('edit');
  }, [shapeW, shapeH, shapeR]);

  // ─── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (outlinePoints.length >= 3) {
      projectStore.setBoardOutline({ points: outlinePoints });
    }
    onClose();
  }, [outlinePoints, projectStore, onClose]);

  // ─── Clear ────────────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    setOutlinePoints([]);
    setCutouts([]);
    setDrawingPoints([]);
    setMode('draw');
  }, []);

  // ─── Start drawing cutout ────────────────────────────────────────────────

  const handleStartCutout = useCallback(() => {
    setIsDrawingCutout(true);
    setDrawingPoints([]);
    setMode('draw');
    setDrawTool('line');
  }, []);

  // ─── Grid rendering ──────────────────────────────────────────────────────

  const renderGrid = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const cw = container.clientWidth || 600;
    const ch = container.clientHeight || 400;

    // Visible range in board coords
    const x0 = -panX / zoom;
    const y0 = -panY / zoom;
    const x1 = (cw - panX) / zoom;
    const y1 = (ch - panY) / zoom;

    // Adaptive grid: skip rendering if too dense
    const gridPixels = GRID_STEP * zoom;
    if (gridPixels < 1) return null;

    const step = gridPixels < 4 ? GRID_STEP * GRID_MAJOR : GRID_STEP;
    const majorStep = GRID_STEP * GRID_MAJOR;

    const lines: React.ReactNode[] = [];
    const startX = Math.floor(x0 / step) * step;
    const startY = Math.floor(y0 / step) * step;

    for (let x = startX; x <= x1; x += step) {
      const isMajor = Math.abs(x % majorStep) < 0.001;
      lines.push(
        <line
          key={`gv-${x.toFixed(2)}`}
          x1={x} y1={y0} x2={x} y2={y1}
          stroke={isMajor ? theme.gridMajorColor : theme.gridColor}
          strokeWidth={isMajor ? 0.08 : 0.04}
        />
      );
    }
    for (let y = startY; y <= y1; y += step) {
      const isMajor = Math.abs(y % majorStep) < 0.001;
      lines.push(
        <line
          key={`gh-${y.toFixed(2)}`}
          x1={x0} y1={y} x2={x1} y2={y}
          stroke={isMajor ? theme.gridMajorColor : theme.gridColor}
          strokeWidth={isMajor ? 0.08 : 0.04}
        />
      );
    }
    return <g>{lines}</g>;
  }, [panX, panY, zoom]);

  if (!visible) return null;

  // Build outline SVG path
  const outlinePath = outlinePoints.length >= 2
    ? outlinePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
    : '';

  // Build drawing preview path
  const drawingPath = drawingPoints.length >= 1
    ? drawingPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ` L${cursorPos.x},${cursorPos.y}`
    : '';

  // Drawing preview for rect tool
  const rectPreview = drawTool === 'rect' && drawingPoints.length === 1
    ? `M${drawingPoints[0].x},${drawingPoints[0].y} L${cursorPos.x},${drawingPoints[0].y} L${cursorPos.x},${cursorPos.y} L${drawingPoints[0].x},${cursorPos.y} Z`
    : '';

  // Drawing preview for circle tool
  const circlePreviewRadius = drawTool === 'circle' && drawingPoints.length === 1
    ? Math.sqrt((cursorPos.x - drawingPoints[0].x) ** 2 + (cursorPos.y - drawingPoints[0].y) ** 2)
    : 0;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.dialogTitle}>Board Outline Editor</span>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        <div style={styles.body}>
          {/* Left panel: tools */}
          <div style={styles.toolPanel}>
            {/* Mode */}
            <div style={styles.sectionTitle}>Mode</div>
            <div style={styles.modeToggle}>
              <button
                style={{ ...styles.modeBtn, ...(mode === 'draw' ? styles.modeBtnActive : {}) }}
                onClick={() => { setMode('draw'); setIsDrawingCutout(false); }}
              >
                Draw
              </button>
              <button
                style={{ ...styles.modeBtn, ...(mode === 'edit' ? styles.modeBtnActive : {}) }}
                onClick={() => setMode('edit')}
                disabled={outlinePoints.length < 3}
              >
                Edit
              </button>
            </div>

            {/* Draw tools */}
            {mode === 'draw' && (
              <>
                <div style={styles.sectionTitle}>Drawing Tools</div>
                <div style={styles.toolGrid}>
                  {(['line', 'rect', 'circle', 'arc'] as DrawTool[]).map(t => (
                    <button
                      key={t}
                      style={{
                        ...styles.drawToolBtn,
                        ...(drawTool === t ? styles.drawToolBtnActive : {}),
                      }}
                      onClick={() => { setDrawTool(t); setDrawingPoints([]); }}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {drawTool === 'line' && (
                  <div style={styles.hint}>
                    Click to add points. Double-click to close polygon.
                  </div>
                )}
                {drawTool === 'rect' && (
                  <div style={styles.hint}>
                    Click first corner, then opposite corner.
                  </div>
                )}
                {drawTool === 'circle' && (
                  <div style={styles.hint}>
                    Click center, then drag to set radius.
                  </div>
                )}
                {drawTool === 'arc' && (
                  <div style={styles.hint}>
                    Click: center, start point, end point.
                  </div>
                )}
              </>
            )}

            {mode === 'edit' && (
              <>
                <div style={styles.sectionTitle}>Edit</div>
                <div style={styles.hint}>
                  Drag vertices to adjust. Add cutouts below.
                </div>
                <button style={styles.cutoutBtn} onClick={handleStartCutout}>
                  + Add Cutout
                </button>
              </>
            )}

            {/* Quick shapes */}
            <div style={{ ...styles.sectionTitle, marginTop: 12 }}>Quick Shapes</div>
            <div style={styles.quickShapeRow}>
              {(['rectangle', 'circle', 'roundedRect'] as QuickShape[]).map(s => (
                <button
                  key={s}
                  style={{
                    ...styles.qsBtn,
                    ...(quickShape === s ? styles.qsBtnActive : {}),
                  }}
                  onClick={() => setQuickShape(s)}
                >
                  {s === 'roundedRect' ? 'Rounded' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {quickShape === 'rectangle' && (
              <div style={styles.paramGroup}>
                <label style={styles.paramLabel}>
                  W: <input type="number" value={shapeW} min={1} step={0.1}
                    onChange={e => setShapeW(parseFloat(e.target.value) || 1)}
                    style={styles.paramInput} /> mm
                </label>
                <label style={styles.paramLabel}>
                  H: <input type="number" value={shapeH} min={1} step={0.1}
                    onChange={e => setShapeH(parseFloat(e.target.value) || 1)}
                    style={styles.paramInput} /> mm
                </label>
                <button style={styles.applyBtn} onClick={applyQuickRect}>Apply</button>
              </div>
            )}

            {quickShape === 'circle' && (
              <div style={styles.paramGroup}>
                <label style={styles.paramLabel}>
                  Dia: <input type="number" value={shapeDia} min={1} step={0.1}
                    onChange={e => setShapeDia(parseFloat(e.target.value) || 1)}
                    style={styles.paramInput} /> mm
                </label>
                <button style={styles.applyBtn} onClick={applyQuickCircle}>Apply</button>
              </div>
            )}

            {quickShape === 'roundedRect' && (
              <div style={styles.paramGroup}>
                <label style={styles.paramLabel}>
                  W: <input type="number" value={shapeW} min={1} step={0.1}
                    onChange={e => setShapeW(parseFloat(e.target.value) || 1)}
                    style={styles.paramInput} /> mm
                </label>
                <label style={styles.paramLabel}>
                  H: <input type="number" value={shapeH} min={1} step={0.1}
                    onChange={e => setShapeH(parseFloat(e.target.value) || 1)}
                    style={styles.paramInput} /> mm
                </label>
                <label style={styles.paramLabel}>
                  R: <input type="number" value={shapeR} min={0.1} step={0.1} max={Math.min(shapeW, shapeH) / 2}
                    onChange={e => setShapeR(parseFloat(e.target.value) || 0.1)}
                    style={styles.paramInput} /> mm
                </label>
                <button style={styles.applyBtn} onClick={applyQuickRoundedRect}>Apply</button>
              </div>
            )}

            {/* Dimensions */}
            <div style={{ ...styles.sectionTitle, marginTop: 12 }}>Dimensions</div>
            <div style={styles.dimGroup}>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Width:</span>
                <span style={styles.dimValue}>{dimensions.width.toFixed(2)} mm</span>
              </div>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Height:</span>
                <span style={styles.dimValue}>{dimensions.height.toFixed(2)} mm</span>
              </div>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Area:</span>
                <span style={styles.dimValue}>{dimensions.area.toFixed(1)} mm{'\u00B2'}</span>
              </div>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Perimeter:</span>
                <span style={styles.dimValue}>{dimensions.perimeter.toFixed(2)} mm</span>
              </div>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Points:</span>
                <span style={styles.dimValue}>{outlinePoints.length}</span>
              </div>
              <div style={styles.dimRow}>
                <span style={styles.dimLabel}>Cutouts:</span>
                <span style={styles.dimValue}>{cutouts.length}</span>
              </div>
            </div>

            {/* Cursor position */}
            <div style={styles.cursorInfo}>
              X: {cursorPos.x.toFixed(1)} &nbsp; Y: {cursorPos.y.toFixed(1)}
            </div>
          </div>

          {/* Main SVG canvas */}
          <div
            ref={containerRef}
            style={{
              ...styles.canvasContainer,
              cursor: mode === 'draw' ? 'crosshair' : dragVertex ? 'grabbing' : 'default',
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              style={{ display: 'block', width: '100%', height: '100%' }}
            >
              <rect width="100%" height="100%" fill={theme.bg0} />

              <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>
                {/* Grid */}
                {renderGrid()}

                {/* Origin marker */}
                <line x1={-ORIGIN_SIZE} y1={0} x2={ORIGIN_SIZE} y2={0} stroke={theme.red} strokeWidth={0.15} />
                <line x1={0} y1={-ORIGIN_SIZE} x2={0} y2={ORIGIN_SIZE} stroke={theme.green} strokeWidth={0.15} />
                <circle cx={0} cy={0} r={0.3} fill="none" stroke={theme.textMuted} strokeWidth={0.08} />

                {/* Existing outline */}
                {outlinePath && (
                  <path
                    d={outlinePath}
                    fill="rgba(255,255,255,0.04)"
                    stroke="#e0e040"
                    strokeWidth={0.2}
                    strokeLinejoin="round"
                  />
                )}

                {/* Cutouts */}
                {cutouts.map((cut, ci) => {
                  const cPath = cut.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
                  return (
                    <path
                      key={`cutout-${ci}`}
                      d={cPath}
                      fill="rgba(240,80,96,0.1)"
                      stroke={theme.red}
                      strokeWidth={0.15}
                      strokeDasharray="0.4,0.2"
                    />
                  );
                })}

                {/* Drawing preview */}
                {drawingPath && (
                  <path
                    d={drawingPath}
                    fill="none"
                    stroke={isDrawingCutout ? theme.red : theme.cyan}
                    strokeWidth={0.15}
                    strokeDasharray="0.3,0.2"
                  />
                )}

                {/* Rectangle preview */}
                {rectPreview && (
                  <path
                    d={rectPreview}
                    fill="rgba(77,158,255,0.08)"
                    stroke={theme.cyan}
                    strokeWidth={0.15}
                    strokeDasharray="0.3,0.2"
                  />
                )}

                {/* Circle preview */}
                {circlePreviewRadius > 0 && (
                  <circle
                    cx={drawingPoints[0].x}
                    cy={drawingPoints[0].y}
                    r={circlePreviewRadius}
                    fill="rgba(77,158,255,0.08)"
                    stroke={theme.cyan}
                    strokeWidth={0.15}
                    strokeDasharray="0.3,0.2"
                  />
                )}

                {/* Drawing points */}
                {drawingPoints.map((p, i) => (
                  <circle
                    key={`dp-${i}`}
                    cx={p.x} cy={p.y} r={0.4}
                    fill={theme.cyan}
                    stroke="#fff"
                    strokeWidth={0.08}
                  />
                ))}

                {/* Edit mode vertex handles */}
                {mode === 'edit' && outlinePoints.map((p, i) => (
                  <rect
                    key={`vh-${i}`}
                    x={p.x - 0.4}
                    y={p.y - 0.4}
                    width={0.8}
                    height={0.8}
                    fill={theme.blue}
                    stroke="#fff"
                    strokeWidth={0.08}
                    style={{ cursor: 'grab' }}
                    rx={0.1}
                  />
                ))}

                {/* Cutout vertex handles */}
                {mode === 'edit' && cutouts.map((cut, ci) =>
                  cut.map((p, pi) => (
                    <rect
                      key={`cvh-${ci}-${pi}`}
                      x={p.x - 0.35}
                      y={p.y - 0.35}
                      width={0.7}
                      height={0.7}
                      fill={theme.red}
                      stroke="#fff"
                      strokeWidth={0.06}
                      style={{ cursor: 'grab' }}
                      rx={0.1}
                    />
                  ))
                )}

                {/* Cursor crosshair */}
                {mode === 'draw' && (
                  <g opacity={0.4}>
                    <line x1={cursorPos.x - 2} y1={cursorPos.y} x2={cursorPos.x + 2} y2={cursorPos.y} stroke={theme.textMuted} strokeWidth={0.06} />
                    <line x1={cursorPos.x} y1={cursorPos.y - 2} x2={cursorPos.x} y2={cursorPos.y + 2} stroke={theme.textMuted} strokeWidth={0.06} />
                  </g>
                )}
              </g>
            </svg>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.clearBtn} onClick={handleClear}>Clear All</button>
          <div style={{ flex: 1 }} />
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...styles.saveBtn,
              ...(outlinePoints.length < 3 ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onClick={handleSave}
            disabled={outlinePoints.length < 3}
          >
            Save Outline
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateCirclePoints(cx: number, cy: number, r: number, segments: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push({
      x: Math.round((cx + r * Math.cos(a)) * 10) / 10,
      y: Math.round((cy + r * Math.sin(a)) * 10) / 10,
    });
  }
  return pts;
}

function generateArcPoints(
  cx: number, cy: number, r: number,
  startAngle: number, endAngle: number, segments: number,
): Point[] {
  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 2 * Math.PI;
  const pts: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + sweep * (i / segments);
    pts.push({
      x: Math.round((cx + r * Math.cos(a)) * 10) / 10,
      y: Math.round((cy + r * Math.sin(a)) * 10) / 10,
    });
  }
  return pts;
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
    width: '88vw',
    maxWidth: 1100,
    height: '82vh',
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
  },
  dialogTitle: {
    fontWeight: 600,
    fontSize: theme.fontLg,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
    flex: 1,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 18,
    cursor: 'pointer',
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  toolPanel: {
    width: 200,
    background: theme.bg2,
    borderRight: theme.border,
    padding: 8,
    overflowY: 'auto' as const,
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '6px 0 4px',
  },
  modeToggle: {
    display: 'flex',
    gap: 2,
    marginBottom: 8,
  },
  modeBtn: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '5px 0',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  modeBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  toolGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 3,
    marginBottom: 6,
  },
  drawToolBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '5px 4px',
    cursor: 'pointer',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
  },
  drawToolBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  hint: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    padding: '4px 0',
    lineHeight: 1.4,
  },
  cutoutBtn: {
    width: '100%',
    background: theme.redDim,
    border: `1px solid ${theme.red}60`,
    borderRadius: theme.radiusSm,
    color: theme.red,
    padding: '5px 0',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    marginTop: 4,
  },
  quickShapeRow: {
    display: 'flex',
    gap: 2,
    marginBottom: 6,
  },
  qsBtn: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '4px 2px',
    cursor: 'pointer',
    fontSize: '9px',
    fontFamily: theme.fontSans,
  },
  qsBtnActive: {
    background: theme.purpleDim,
    borderColor: theme.purple,
    color: theme.purple,
  },
  paramGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    marginBottom: 4,
  },
  paramLabel: {
    fontSize: theme.fontXs,
    color: theme.textSecondary,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  paramInput: {
    width: 60,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    padding: '2px 4px',
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
  },
  applyBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}60`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  dimGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
    padding: '2px 0',
  },
  dimRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dimLabel: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
  },
  dimValue: {
    fontSize: theme.fontXs,
    color: theme.textPrimary,
    fontFamily: theme.fontMono,
  },
  cursorInfo: {
    marginTop: 12,
    padding: '4px 6px',
    background: theme.bg3,
    borderRadius: theme.radiusSm,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textSecondary,
    textAlign: 'center' as const,
  },
  canvasContainer: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
    background: theme.bg0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    background: theme.bg2,
    borderTop: theme.border,
    gap: 8,
  },
  clearBtn: {
    background: theme.redDim,
    border: `1px solid ${theme.red}40`,
    borderRadius: theme.radiusSm,
    color: theme.red,
    padding: '5px 14px',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  cancelBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    padding: '5px 14px',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  saveBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    padding: '5px 18px',
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontWeight: 600,
    fontFamily: theme.fontSans,
  },
};

export default BoardOutlineEditor;
