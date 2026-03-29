// ─── BoardCanvas.tsx ── High-performance Canvas2D PCB renderer ──────────────
import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { theme } from '../styles/theme';
import type {
  Point, BrdComponent, BrdTrace, BrdVia, BrdZone, BrdPad,
  BoardOutline, BoardState,
} from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LayerConfig {
  id: string;
  color: string;
  visible: boolean;
  opacity: number;
}

export interface DRCMarker {
  x: number;
  y: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface RatsnestLine {
  from: Point;
  to: Point;
  netId: string;
}

export interface MeasureState {
  start: Point | null;
  end: Point | null;
  active: boolean;
}

export interface SelectionRect {
  start: Point;
  end: Point;
}

export interface BoardCanvasProps {
  board: BoardState;
  layers: LayerConfig[];
  activeLayer: string;
  highlightedNet: string | null;
  drcMarkers: DRCMarker[];
  ratsnest: RatsnestLine[];
  gridSpacing: number;
  gridStyle: 'dots' | 'lines';
  showGrid: boolean;
  showRatsnest: boolean;
  showCrosshair: boolean;
  selectionRect: SelectionRect | null;
  measure: MeasureState;
  routingPreview: Point[] | null;
  routingWidth: number;
  zonePreview: Point[] | null;
  keepoutPreview?: Point[] | null;
  diffPairPreview?: { p: Point[]; n: Point[] } | null;
  lengthTuneTraceId?: string | null;
  lengthTuneTarget?: number;
  onMouseDown: (worldPos: Point, e: React.MouseEvent) => void;
  onMouseMove: (worldPos: Point, e: React.MouseEvent) => void;
  onMouseUp: (worldPos: Point, e: React.MouseEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
}

export interface BoardCanvasHandle {
  screenToWorld: (sx: number, sy: number) => Point;
  worldToScreen: (wx: number, wy: number) => Point;
  zoomToFit: () => void;
  getViewState: () => { panX: number; panY: number; zoom: number };
  setPan: (x: number, y: number) => void;
  setZoom: (z: number) => void;
}

// ─── Helper: convert hex + alpha to rgba ────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function brighten(hex: string, factor: number): string {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.floor(r + (255 - r) * factor));
  g = Math.min(255, Math.floor(g + (255 - g) * factor));
  b = Math.min(255, Math.floor(b + (255 - b) * factor));
  return `rgb(${r},${g},${b})`;
}

// ─── Bug #9: Rotation helper for pad world position ─────────────────────────

function rotatedPadWorldPos(comp: BrdComponent, pad: BrdPad): Point {
  const rad = (comp.rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rx = pad.x * cosR - pad.y * sinR;
  const ry = pad.x * sinR + pad.y * cosR;
  return { x: comp.x + rx, y: comp.y + ry };
}

// ─── Component ──────────────────────────────────────────────────────────────

const BoardCanvas = forwardRef<BoardCanvasHandle, BoardCanvasProps>((props, ref) => {
  const {
    board, layers, activeLayer, highlightedNet, drcMarkers, ratsnest,
    gridSpacing, gridStyle, showGrid, showRatsnest, showCrosshair,
    selectionRect, measure, routingPreview, routingWidth, zonePreview,
    keepoutPreview,
    diffPairPreview,
    lengthTuneTraceId,
    lengthTuneTarget,
    onMouseDown, onMouseMove, onMouseUp, onWheel,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Bug #10: Dirty flag to avoid continuous re-rendering
  const dirtyRef = useRef(true);
  const prevPropsRef = useRef<string>('');

  // View transform
  const panRef = useRef({ x: 300, y: 300 });
  const zoomRef = useRef(4);
  const mouseWorldRef = useRef<Point>({ x: 0, y: 0 });
  const [coordsDisplay, setCoordsDisplay] = useState({ x: 0, y: 0 });

  // Mark dirty when any prop changes
  useEffect(() => {
    dirtyRef.current = true;
  }, [
    board, layers, activeLayer, highlightedNet, drcMarkers, ratsnest,
    gridSpacing, gridStyle, showGrid, showRatsnest, showCrosshair,
    selectionRect, measure, routingPreview, routingWidth, zonePreview,
  ]);

  // Coordinate transforms
  const screenToWorld = useCallback((sx: number, sy: number): Point => {
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: (sx - p.x) / z, y: (sy - p.y) / z };
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number): Point => {
    const z = zoomRef.current;
    const p = panRef.current;
    return { x: wx * z + p.x, y: wy * z + p.y };
  }, []);

  // Expose imperative API
  useImperativeHandle(ref, () => ({
    screenToWorld,
    worldToScreen,
    zoomToFit: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const allPts: Point[] = [];
      board.components.forEach(c => {
        allPts.push({ x: c.x, y: c.y });
        c.pads.forEach(p => {
          const pp = rotatedPadWorldPos(c, p);
          allPts.push(pp);
        });
      });
      board.traces.forEach(t => t.points.forEach(p => allPts.push(p)));
      board.vias.forEach(v => allPts.push({ x: v.x, y: v.y }));
      board.outline.points.forEach(p => allPts.push(p));
      if (allPts.length === 0) return;
      const minX = Math.min(...allPts.map(p => p.x)) - 5;
      const maxX = Math.max(...allPts.map(p => p.x)) + 5;
      const minY = Math.min(...allPts.map(p => p.y)) - 5;
      const maxY = Math.max(...allPts.map(p => p.y)) + 5;
      const w = maxX - minX;
      const h = maxY - minY;
      const zx = canvas.width / w;
      const zy = canvas.height / h;
      const z = Math.min(zx, zy) * 0.9;
      zoomRef.current = z;
      panRef.current = {
        x: canvas.width / 2 - ((minX + maxX) / 2) * z,
        y: canvas.height / 2 - ((minY + maxY) / 2) * z,
      };
      dirtyRef.current = true;
    },
    getViewState: () => ({ panX: panRef.current.x, panY: panRef.current.y, zoom: zoomRef.current }),
    setPan: (x: number, y: number) => { panRef.current = { x, y }; dirtyRef.current = true; },
    setZoom: (z: number) => { zoomRef.current = z; dirtyRef.current = true; },
  }));

  // ─── Layer helpers ──────────────────────────────────────────────────────

  const getLayerConfig = useCallback((layerId: string): LayerConfig | undefined => {
    return layers.find(l => l.id === layerId);
  }, [layers]);

  const isLayerVisible = useCallback((layerId: string): boolean => {
    const lc = getLayerConfig(layerId);
    return lc ? lc.visible : false;
  }, [getLayerConfig]);

  const getLayerColor = useCallback((layerId: string, alpha?: number): string => {
    const lc = getLayerConfig(layerId);
    if (!lc) return 'rgba(128,128,128,0.5)';
    const a = alpha !== undefined ? alpha : lc.opacity;
    return hexToRgba(lc.color, a);
  }, [getLayerConfig]);

  // ─── Drawing functions ────────────────────────────────────────────────

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!showGrid) return;
    const z = zoomRef.current;
    const p = panRef.current;

    // Determine visible world range
    const wStart = screenToWorld(0, 0);
    const wEnd = screenToWorld(w, h);
    const step = gridSpacing;

    const startX = Math.floor(wStart.x / step) * step;
    const endX = Math.ceil(wEnd.x / step) * step;
    const startY = Math.floor(wStart.y / step) * step;
    const endY = Math.ceil(wEnd.y / step) * step;

    if (gridStyle === 'dots') {
      const dotSize = Math.max(1, z * 0.06);
      ctx.fillStyle = theme.gridDotColor;
      for (let x = startX; x <= endX; x += step) {
        for (let y = startY; y <= endY; y += step) {
          const sx = x * z + p.x;
          const sy = y * z + p.y;
          ctx.fillRect(sx - dotSize / 2, sy - dotSize / 2, dotSize, dotSize);
        }
      }
    } else {
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let x = startX; x <= endX; x += step) {
        const sx = x * z + p.x;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = startY; y <= endY; y += step) {
        const sy = y * z + p.y;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }
  }, [showGrid, gridSpacing, gridStyle, screenToWorld]);

  const drawBoardOutline = useCallback((ctx: CanvasRenderingContext2D) => {
    const pts = board.outline.points;
    if (pts.length < 2) return;
    if (!isLayerVisible('Edge.Cuts')) return;
    const z = zoomRef.current;
    const p = panRef.current;
    ctx.strokeStyle = theme.layers['Edge.Cuts'] || '#e0e040';
    ctx.lineWidth = Math.max(2, z * 0.15);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x * z + p.x, pts[0].y * z + p.y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * z + p.x, pts[i].y * z + p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }, [board.outline, isLayerVisible]);

  const drawZones = useCallback((ctx: CanvasRenderingContext2D) => {
    const z = zoomRef.current;
    const p = panRef.current;
    board.zones.forEach((zone: BrdZone) => {
      if (!isLayerVisible(zone.layer)) return;
      if (zone.points.length < 3) return;

      const isKeepout = zone.isKeepout === true;
      const isHighlighted = highlightedNet && zone.netId === highlightedNet;

      if (isKeepout) {
        // Keepout zones: red-tinted with cross-hatch pattern
        ctx.fillStyle = 'rgba(240, 80, 96, 0.12)';
        ctx.strokeStyle = 'rgba(240, 80, 96, 0.8)';
        ctx.lineWidth = Math.max(1.5, z * 0.08);
        ctx.setLineDash([z * 0.3, z * 0.15]);
      } else {
        const color = getLayerColor(zone.layer, isHighlighted ? 0.6 : 0.25);
        ctx.fillStyle = color;
        ctx.strokeStyle = getLayerColor(zone.layer, 0.7);
        ctx.lineWidth = Math.max(1, z * 0.05);
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(zone.points[0].x * z + p.x, zone.points[0].y * z + p.y);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x * z + p.x, zone.points[i].y * z + p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      // Hatching
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(zone.points[0].x * z + p.x, zone.points[0].y * z + p.y);
      for (let i = 1; i < zone.points.length; i++) {
        ctx.lineTo(zone.points[i].x * z + p.x, zone.points[i].y * z + p.y);
      }
      ctx.closePath();
      ctx.clip();

      const minX = Math.min(...zone.points.map(pt => pt.x));
      const maxX = Math.max(...zone.points.map(pt => pt.x));
      const minY = Math.min(...zone.points.map(pt => pt.y));
      const maxY = Math.max(...zone.points.map(pt => pt.y));

      if (isKeepout) {
        // Cross-hatch for keepout zones (both diagonal directions)
        ctx.strokeStyle = 'rgba(240, 80, 96, 0.3)';
        ctx.lineWidth = 1;
        const hatchStep = 1.5;
        ctx.beginPath();
        for (let hx = minX; hx <= maxX + (maxY - minY); hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx - (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        for (let hx = minX - (maxY - minY); hx <= maxX; hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx + (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        ctx.stroke();

        // Label the keepout type
        const centerX = ((minX + maxX) / 2) * z + p.x;
        const centerY = ((minY + maxY) / 2) * z + p.y;
        const label = zone.keepoutType ? zone.keepoutType.replace('_', ' ').toUpperCase() : 'KEEPOUT';
        ctx.fillStyle = 'rgba(240, 80, 96, 0.7)';
        ctx.font = `bold ${Math.max(8, z * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, centerX, centerY);
      } else if (!isHighlighted) {
        ctx.strokeStyle = getLayerColor(zone.layer, 0.15);
        ctx.lineWidth = 1;
        const hatchStep = 2;
        ctx.beginPath();
        for (let hx = minX; hx <= maxX + (maxY - minY); hx += hatchStep) {
          ctx.moveTo(hx * z + p.x, minY * z + p.y);
          ctx.lineTo((hx - (maxY - minY)) * z + p.x, maxY * z + p.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    });
  }, [board.zones, isLayerVisible, getLayerColor, highlightedNet]);

  const drawTraces = useCallback((ctx: CanvasRenderingContext2D) => {
    const z = zoomRef.current;
    const pn = panRef.current;
    board.traces.forEach((trace: BrdTrace) => {
      if (!isLayerVisible(trace.layer)) return;
      if (trace.points.length < 2) return;
      const isHighlighted = highlightedNet && trace.netId === highlightedNet;
      ctx.strokeStyle = isHighlighted
        ? brighten(getLayerConfig(trace.layer)?.color || '#fff', 0.5)
        : getLayerColor(trace.layer, 0.85);
      ctx.lineWidth = trace.width * z;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isHighlighted) {
        ctx.shadowColor = getLayerConfig(trace.layer)?.color || '#fff';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(trace.points[0].x * z + pn.x, trace.points[0].y * z + pn.y);
      for (let i = 1; i < trace.points.length; i++) {
        ctx.lineTo(trace.points[i].x * z + pn.x, trace.points[i].y * z + pn.y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }, [board.traces, isLayerVisible, getLayerColor, getLayerConfig, highlightedNet]);

  const drawPad = useCallback((
    ctx: CanvasRenderingContext2D, pad: BrdPad,
    cx: number, cy: number, rotation: number, compLayer: string
  ) => {
    const z = zoomRef.current;
    const pn = panRef.current;

    // Check if any of the pad's layers are visible
    const anyVisible = pad.layers.some(l => isLayerVisible(l));
    if (!anyVisible) return;

    const isHighlighted = highlightedNet && pad.netId === highlightedNet;
    const padLayer = pad.layers.includes(compLayer) ? compLayer : pad.layers[0];
    const color = isHighlighted
      ? brighten(getLayerConfig(padLayer)?.color || '#fff', 0.5)
      : getLayerColor(padLayer, 0.9);

    const sx = cx * z + pn.x;
    const sy = cy * z + pn.y;
    const sw = pad.width * z;
    const sh = pad.height * z;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((rotation * Math.PI) / 180);

    if (isHighlighted) {
      ctx.shadowColor = getLayerConfig(padLayer)?.color || '#fff';
      ctx.shadowBlur = 10;
    }

    ctx.fillStyle = color;
    switch (pad.shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, sw / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'rect':
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
        break;
      case 'oval':
        ctx.beginPath();
        ctx.ellipse(0, 0, sw / 2, sh / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'roundrect': {
        const radius = Math.min(sw, sh) * 0.25;
        ctx.beginPath();
        ctx.moveTo(-sw / 2 + radius, -sh / 2);
        ctx.lineTo(sw / 2 - radius, -sh / 2);
        ctx.arcTo(sw / 2, -sh / 2, sw / 2, -sh / 2 + radius, radius);
        ctx.lineTo(sw / 2, sh / 2 - radius);
        ctx.arcTo(sw / 2, sh / 2, sw / 2 - radius, sh / 2, radius);
        ctx.lineTo(-sw / 2 + radius, sh / 2);
        ctx.arcTo(-sw / 2, sh / 2, -sw / 2, sh / 2 - radius, radius);
        ctx.lineTo(-sw / 2, -sh / 2 + radius);
        ctx.arcTo(-sw / 2, -sh / 2, -sw / 2 + radius, -sh / 2, radius);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.shadowBlur = 0;

    // Drill hole
    if (pad.drill && pad.drill > 0) {
      ctx.fillStyle = theme.brdBackground;
      ctx.beginPath();
      ctx.arc(0, 0, (pad.drill * z) / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pad number
    if (z > 2.5) {
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(6, z * 0.6)}px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pad.number, 0, 0);
    }

    ctx.restore();
  }, [isLayerVisible, getLayerColor, getLayerConfig, highlightedNet]);

  const drawComponents = useCallback((ctx: CanvasRenderingContext2D) => {
    board.components.forEach((comp: BrdComponent) => {
      // Bug #9: Apply component rotation to pad x,y offset before adding to component position
      comp.pads.forEach((pad: BrdPad) => {
        const worldPos = rotatedPadWorldPos(comp, pad);
        drawPad(ctx, pad, worldPos.x, worldPos.y, comp.rotation, comp.layer);
      });

      // Draw silkscreen reference
      const silkLayer = comp.layer === 'F.Cu' ? 'F.SilkS' : 'B.SilkS';
      if (!isLayerVisible(silkLayer)) return;
      const z = zoomRef.current;
      const pn = panRef.current;
      const sx = comp.x * z + pn.x;
      const sy = comp.y * z + pn.y;
      ctx.fillStyle = getLayerColor(silkLayer, 0.9);
      ctx.font = `${Math.max(8, z * 0.8)}px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate((comp.rotation * Math.PI) / 180);
      ctx.fillText(comp.ref, 0, -Math.max(3, z * 1.2));
      ctx.restore();

      // Courtyard outline (if zoomed enough)
      if (z > 1.5) {
        const fabLayer = comp.layer === 'F.Cu' ? 'F.Fab' : 'B.Fab';
        if (!isLayerVisible(fabLayer)) return;
        const maxW = Math.max(...comp.pads.map(p => Math.abs(p.x) + p.width / 2), 2);
        const maxH = Math.max(...comp.pads.map(p => Math.abs(p.y) + p.height / 2), 2);
        ctx.strokeStyle = getLayerColor(fabLayer, 0.4);
        ctx.lineWidth = Math.max(0.5, z * 0.03);
        ctx.setLineDash([z * 0.3, z * 0.3]);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate((comp.rotation * Math.PI) / 180);
        ctx.strokeRect(
          -(maxW + 0.5) * z, -(maxH + 0.5) * z,
          (maxW + 0.5) * 2 * z, (maxH + 0.5) * 2 * z
        );
        ctx.restore();
        ctx.setLineDash([]);
      }
    });
  }, [board.components, drawPad, isLayerVisible, getLayerColor]);

  const drawVias = useCallback((ctx: CanvasRenderingContext2D) => {
    const z = zoomRef.current;
    const pn = panRef.current;
    board.vias.forEach((via: BrdVia) => {
      const anyVisible = via.layers.some(l => isLayerVisible(l));
      if (!anyVisible) return;
      const isHighlighted = highlightedNet && via.netId === highlightedNet;
      const sx = via.x * z + pn.x;
      const sy = via.y * z + pn.y;
      const outerR = (via.size / 2) * z;
      const innerR = (via.drill / 2) * z;

      // Outer ring - blend layers
      const gradient = ctx.createRadialGradient(sx, sy, innerR, sx, sy, outerR);
      const topColor = getLayerConfig(via.layers[0])?.color || '#f04040';
      const botColor = getLayerConfig(via.layers[via.layers.length - 1])?.color || '#4060f0';
      gradient.addColorStop(0, hexToRgba(topColor, isHighlighted ? 1 : 0.8));
      gradient.addColorStop(1, hexToRgba(botColor, isHighlighted ? 1 : 0.8));

      if (isHighlighted) {
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(sx, sy, outerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Drill hole
      ctx.fillStyle = theme.brdBackground;
      ctx.beginPath();
      ctx.arc(sx, sy, innerR, 0, Math.PI * 2);
      ctx.fill();

      // Cross indicator
      if (z > 2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx - innerR * 0.5, sy);
        ctx.lineTo(sx + innerR * 0.5, sy);
        ctx.moveTo(sx, sy - innerR * 0.5);
        ctx.lineTo(sx, sy + innerR * 0.5);
        ctx.stroke();
      }
    });
  }, [board.vias, isLayerVisible, getLayerConfig, highlightedNet]);

  const drawRatsnest = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!showRatsnest) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    ctx.strokeStyle = theme.brdRatsnest;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ratsnest.forEach(line => {
      const isHighlighted = highlightedNet && line.netId === highlightedNet;
      if (isHighlighted) {
        ctx.strokeStyle = theme.highlightColor;
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = theme.brdRatsnest;
        ctx.lineWidth = 0.5;
      }
      ctx.beginPath();
      ctx.moveTo(line.from.x * z + pn.x, line.from.y * z + pn.y);
      ctx.lineTo(line.to.x * z + pn.x, line.to.y * z + pn.y);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }, [showRatsnest, ratsnest, highlightedNet]);

  const drawDRCMarkers = useCallback((ctx: CanvasRenderingContext2D) => {
    const z = zoomRef.current;
    const pn = panRef.current;
    const markerSize = Math.max(6, z * 1.5);
    drcMarkers.forEach(marker => {
      const sx = marker.x * z + pn.x;
      const sy = marker.y * z + pn.y;
      const color = marker.severity === 'error' ? theme.red : theme.orange;

      // X mark
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, z * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx - markerSize, sy - markerSize);
      ctx.lineTo(sx + markerSize, sy + markerSize);
      ctx.moveTo(sx + markerSize, sy - markerSize);
      ctx.lineTo(sx - markerSize, sy + markerSize);
      ctx.stroke();

      // Circle around
      ctx.beginPath();
      ctx.arc(sx, sy, markerSize * 1.3, 0, Math.PI * 2);
      ctx.stroke();
    });
  }, [drcMarkers]);

  const drawRoutingPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!routingPreview || routingPreview.length < 1) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    const color = getLayerColor(activeLayer, 0.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = routingWidth * z;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([z * 0.5, z * 0.3]);
    ctx.beginPath();
    ctx.moveTo(routingPreview[0].x * z + pn.x, routingPreview[0].y * z + pn.y);
    for (let i = 1; i < routingPreview.length; i++) {
      ctx.lineTo(routingPreview[i].x * z + pn.x, routingPreview[i].y * z + pn.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }, [routingPreview, routingWidth, activeLayer, getLayerColor]);

  const drawZonePreview = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!zonePreview || zonePreview.length < 1) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    const color = getLayerColor(activeLayer, 0.3);
    ctx.fillStyle = color;
    ctx.strokeStyle = getLayerColor(activeLayer, 0.7);
    ctx.lineWidth = Math.max(1, z * 0.08);
    ctx.setLineDash([z * 0.4, z * 0.2]);
    ctx.beginPath();
    ctx.moveTo(zonePreview[0].x * z + pn.x, zonePreview[0].y * z + pn.y);
    for (let i = 1; i < zonePreview.length; i++) {
      ctx.lineTo(zonePreview[i].x * z + pn.x, zonePreview[i].y * z + pn.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertices
    zonePreview.forEach(pt => {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(pt.x * z + pn.x, pt.y * z + pn.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [zonePreview, activeLayer, getLayerColor]);

  const drawKeepoutPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!keepoutPreview || keepoutPreview.length < 1) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    ctx.fillStyle = 'rgba(240, 80, 96, 0.15)';
    ctx.strokeStyle = 'rgba(240, 80, 96, 0.8)';
    ctx.lineWidth = Math.max(1.5, z * 0.08);
    ctx.setLineDash([z * 0.3, z * 0.15]);
    ctx.beginPath();
    ctx.moveTo(keepoutPreview[0].x * z + pn.x, keepoutPreview[0].y * z + pn.y);
    for (let i = 1; i < keepoutPreview.length; i++) {
      ctx.lineTo(keepoutPreview[i].x * z + pn.x, keepoutPreview[i].y * z + pn.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw vertices
    keepoutPreview.forEach(pt => {
      ctx.fillStyle = '#f05060';
      ctx.beginPath();
      ctx.arc(pt.x * z + pn.x, pt.y * z + pn.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [keepoutPreview]);

  const drawDiffPairPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!diffPairPreview) return;
    const z = zoomRef.current;
    const pn = panRef.current;

    const drawPath = (points: Point[], color: string) => {
      if (points.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, routingWidth * z);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([z * 0.4, z * 0.2]);
      ctx.beginPath();
      ctx.moveTo(points[0].x * z + pn.x, points[0].y * z + pn.y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * z + pn.x, points[i].y * z + pn.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Draw P trace in warm color, N trace in cool color
    drawPath(diffPairPreview.p, 'rgba(255, 140, 60, 0.7)');
    drawPath(diffPairPreview.n, 'rgba(60, 160, 255, 0.7)');

    // Draw gap indicator lines between the two paths
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([z * 0.1, z * 0.15]);
    const minLen = Math.min(diffPairPreview.p.length, diffPairPreview.n.length);
    for (let i = 0; i < minLen; i += Math.max(1, Math.floor(minLen / 8))) {
      const pp = diffPairPreview.p[i];
      const np = diffPairPreview.n[i];
      ctx.beginPath();
      ctx.moveTo(pp.x * z + pn.x, pp.y * z + pn.y);
      ctx.lineTo(np.x * z + pn.x, np.y * z + pn.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, [diffPairPreview, routingWidth]);

  const drawLengthTuneOverlay = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!lengthTuneTraceId) return;
    const z = zoomRef.current;
    const pn = panRef.current;

    // Find the trace and highlight it
    const trace = board.traces.find(t => t.id === lengthTuneTraceId);
    if (!trace || trace.points.length < 2) return;

    // Draw highlighted trace with glow
    ctx.strokeStyle = 'rgba(0, 255, 180, 0.5)';
    ctx.lineWidth = (trace.width + 0.3) * z;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(trace.points[0].x * z + pn.x, trace.points[0].y * z + pn.y);
    for (let i = 1; i < trace.points.length; i++) {
      ctx.lineTo(trace.points[i].x * z + pn.x, trace.points[i].y * z + pn.y);
    }
    ctx.stroke();

    // Draw length label at midpoint
    const midIdx = Math.floor(trace.points.length / 2);
    const mp = trace.points[midIdx];
    let totalLen = 0;
    for (let i = 0; i < trace.points.length - 1; i++) {
      totalLen += Math.hypot(
        trace.points[i + 1].x - trace.points[i].x,
        trace.points[i + 1].y - trace.points[i].y,
      );
    }

    const sx = mp.x * z + pn.x;
    const sy = mp.y * z + pn.y - 12;
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    const text = `${totalLen.toFixed(2)}mm`;
    const targetText = lengthTuneTarget ? ` / ${lengthTuneTarget.toFixed(2)}mm` : '';
    const fullText = text + targetText;
    const tw = ctx.measureText(fullText).width;
    ctx.fillRect(sx - tw / 2 - 4, sy - 10, tw + 8, 16);
    ctx.fillStyle = totalLen >= (lengthTuneTarget || 0) ? '#00ffb4' : '#ff8040';
    ctx.fillText(fullText, sx, sy);
  }, [lengthTuneTraceId, lengthTuneTarget, board.traces]);

  const drawSelection = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!selectionRect) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    const sx1 = selectionRect.start.x * z + pn.x;
    const sy1 = selectionRect.start.y * z + pn.y;
    const sx2 = selectionRect.end.x * z + pn.x;
    const sy2 = selectionRect.end.y * z + pn.y;
    ctx.fillStyle = theme.selectionFill;
    ctx.strokeStyle = theme.selectionColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
    ctx.setLineDash([]);
  }, [selectionRect]);

  const drawMeasure = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!measure.start) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    const s1 = { x: measure.start.x * z + pn.x, y: measure.start.y * z + pn.y };
    const endPt = measure.end || mouseWorldRef.current;
    const s2 = { x: endPt.x * z + pn.x, y: endPt.y * z + pn.y };

    ctx.strokeStyle = theme.cyan;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoints
    [s1, s2].forEach(pt => {
      ctx.fillStyle = theme.cyan;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Distance label
    const dx = endPt.x - measure.start.x;
    const dy = endPt.y - measure.start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (s1.x + s2.x) / 2;
    const midY = (s1.y + s2.y) / 2;
    const label = `${dist.toFixed(2)} mm`;
    ctx.font = `bold 12px ${theme.fontMono}`;
    ctx.fillStyle = theme.bg0;
    const m = ctx.measureText(label);
    ctx.fillRect(midX - m.width / 2 - 4, midY - 18, m.width + 8, 20);
    ctx.fillStyle = theme.cyan;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY - 8);
  }, [measure]);

  const drawCrosshair = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (!showCrosshair) return;
    const z = zoomRef.current;
    const pn = panRef.current;
    const mx = mouseWorldRef.current;
    const sx = mx.x * z + pn.x;
    const sy = mx.y * z + pn.y;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }, [showCrosshair]);

  // ─── Main render loop (Bug #10: only re-render when dirty) ─────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      animRef.current = requestAnimationFrame(render);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animRef.current = requestAnimationFrame(render);
      return;
    }

    // Bug #10: Skip rendering if nothing changed
    if (!dirtyRef.current) {
      animRef.current = requestAnimationFrame(render);
      return;
    }
    dirtyRef.current = false;

    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.fillStyle = theme.brdBackground;
    ctx.fillRect(0, 0, w, h);

    // Draw in correct layer order
    drawGrid(ctx, w, h);
    drawBoardOutline(ctx);
    drawZones(ctx);
    drawTraces(ctx);
    drawComponents(ctx);
    drawVias(ctx);
    drawRatsnest(ctx);
    drawRoutingPreview(ctx);
    drawZonePreview(ctx);
    drawKeepoutPreview(ctx);
    drawDiffPairPreview(ctx);
    drawLengthTuneOverlay(ctx);
    drawSelection(ctx);
    drawMeasure(ctx);
    drawDRCMarkers(ctx);
    drawCrosshair(ctx, w, h);

    animRef.current = requestAnimationFrame(render);
  }, [
    drawGrid, drawBoardOutline, drawZones, drawTraces, drawComponents,
    drawVias, drawRatsnest, drawRoutingPreview, drawZonePreview,
    drawKeepoutPreview, drawDiffPairPreview, drawLengthTuneOverlay,
    drawSelection, drawMeasure, drawDRCMarkers, drawCrosshair,
  ]);

  // ─── Canvas resize (Bug #11: Add ResizeObserver) ────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
      dirtyRef.current = true;
    };
    resize();

    // Bug #11: Watch the container element with ResizeObserver, not just window resize
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        resize();
      });
      resizeObserver.observe(container);
    }

    // Also keep window resize as fallback
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  // Start render loop
  useEffect(() => {
    dirtyRef.current = true;
    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [render]);

  // ─── Mouse handlers ──────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    mouseWorldRef.current = world;
    dirtyRef.current = true; // crosshair moved
    setCoordsDisplay({ x: Math.round(world.x * 100) / 100, y: Math.round(world.y * 100) / 100 });
    onMouseMove(world, e);
  }, [screenToWorld, onMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    onMouseDown(world, e);
  }, [screenToWorld, onMouseDown]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    onMouseUp(world, e);
  }, [screenToWorld, onMouseUp]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={styles.container}>
      <canvas
        ref={canvasRef}
        style={styles.canvas}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={onWheel}
        onContextMenu={e => e.preventDefault()}
      />
      <div style={styles.coordsBar}>
        <span style={styles.coordLabel}>X:</span>
        <span style={styles.coordValue}>{coordsDisplay.x.toFixed(2)}</span>
        <span style={styles.coordLabel}>Y:</span>
        <span style={styles.coordValue}>{coordsDisplay.y.toFixed(2)}</span>
        <span style={styles.coordLabel}>mm</span>
        <span style={{ ...styles.coordLabel, marginLeft: 16 }}>Layer:</span>
        <span style={{ ...styles.coordValue, color: getLayerConfig(activeLayer)?.color || '#fff' }}>
          {activeLayer}
        </span>
      </div>
    </div>
  );
});

BoardCanvas.displayName = 'BoardCanvas';

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    cursor: 'crosshair',
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
  coordsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 24,
    background: theme.bg1,
    borderTop: theme.border,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 4,
    zIndex: 10,
  },
  coordLabel: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
  },
  coordValue: {
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    minWidth: 56,
  },
};

export default BoardCanvas;
