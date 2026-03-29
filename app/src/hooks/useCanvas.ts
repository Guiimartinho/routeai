import { useRef, useEffect, useCallback, useState } from 'react';
import type { Point } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CanvasViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface HitTestResult {
  type: 'component' | 'wire' | 'trace' | 'via' | 'zone' | 'pad' | 'label' | 'empty';
  id?: string;
  worldPos: Point;
}

export type RenderCallback = (
  ctx: CanvasRenderingContext2D,
  view: CanvasViewState,
  width: number,
  height: number
) => void;

export type HitTestCallback = (worldPos: Point, tolerance: number) => HitTestResult;

export interface UseCanvasOptions {
  /** Minimum zoom level */
  minZoom?: number;
  /** Maximum zoom level */
  maxZoom?: number;
  /** Grid size in world units (mm) */
  gridSize?: number;
  /** Zoom speed multiplier */
  zoomSpeed?: number;
  /** Enable smooth inertia panning */
  inertia?: boolean;
  /** Inertia friction (0-1, lower = more friction) */
  inertiaFriction?: number;
}

export interface UseCanvasReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  view: CanvasViewState;
  canvasSize: { width: number; height: number };
  screenToWorld: (sx: number, sy: number) => Point;
  worldToScreen: (wx: number, wy: number) => Point;
  setView: (v: Partial<CanvasViewState>) => void;
  zoomToFit: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
  getCursorWorldPos: () => Point;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<UseCanvasOptions> = {
  minZoom: 0.02,
  maxZoom: 80,
  gridSize: 1.27,
  zoomSpeed: 1.1,
  inertia: true,
  inertiaFriction: 0.92,
};

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCanvas(
  renderFn: RenderCallback,
  options?: UseCanvasOptions
): UseCanvasReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const renderFnRef = useRef(renderFn);
  renderFnRef.current = renderFn;

  // View state
  const [view, setViewState] = useState<CanvasViewState>({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Canvas size
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(canvasSize);
  sizeRef.current = canvasSize;

  // Mouse tracking
  const mouseRef = useRef<Point>({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef<Point>({ x: 0, y: 0 });

  // Inertia state
  const velocity = useRef<Point>({ x: 0, y: 0 });
  const inertiaActive = useRef(false);

  // ─── Coordinate transforms ────────────────────────────────────────

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point => {
      const v = viewRef.current;
      const s = sizeRef.current;
      return {
        x: (sx - s.width / 2 - v.panX) / v.zoom,
        y: (sy - s.height / 2 - v.panY) / v.zoom,
      };
    },
    []
  );

  const worldToScreen = useCallback(
    (wx: number, wy: number): Point => {
      const v = viewRef.current;
      const s = sizeRef.current;
      return {
        x: wx * v.zoom + s.width / 2 + v.panX,
        y: wy * v.zoom + s.height / 2 + v.panY,
      };
    },
    []
  );

  const getCursorWorldPos = useCallback((): Point => {
    return screenToWorld(mouseRef.current.x, mouseRef.current.y);
  }, [screenToWorld]);

  // ─── View setter ──────────────────────────────────────────────────

  const setView = useCallback(
    (partial: Partial<CanvasViewState>) => {
      setViewState((prev) => {
        const next = { ...prev, ...partial };
        next.zoom = Math.max(opts.minZoom, Math.min(opts.maxZoom, next.zoom));
        return next;
      });
    },
    [opts.minZoom, opts.maxZoom]
  );

  // ─── Zoom to fit bounds ───────────────────────────────────────────

  const zoomToFit = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
      const s = sizeRef.current;
      if (s.width === 0 || s.height === 0) return;

      const bw = bounds.maxX - bounds.minX;
      const bh = bounds.maxY - bounds.minY;
      if (bw <= 0 || bh <= 0) return;

      const padding = 0.1;
      const zx = (s.width * (1 - padding * 2)) / bw;
      const zy = (s.height * (1 - padding * 2)) / bh;
      const zoom = Math.max(opts.minZoom, Math.min(opts.maxZoom, Math.min(zx, zy)));

      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;

      setView({
        zoom,
        panX: -cx * zoom,
        panY: -cy * zoom,
      });
    },
    [opts.minZoom, opts.maxZoom, setView]
  );

  // ─── Render loop ──────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const frame = () => {
      if (!running) return;

      // Inertia
      if (opts.inertia && inertiaActive.current && !isPanning.current) {
        const vx = velocity.current.x;
        const vy = velocity.current.y;
        if (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1) {
          setViewState((prev) => ({
            ...prev,
            panX: prev.panX + vx,
            panY: prev.panY + vy,
          }));
          velocity.current.x *= opts.inertiaFriction;
          velocity.current.y *= opts.inertiaFriction;
        } else {
          inertiaActive.current = false;
          velocity.current = { x: 0, y: 0 };
        }
      }

      const v = viewRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const dpr = window.devicePixelRatio || 1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w / dpr, h / dpr);

      renderFnRef.current(ctx, v, w / dpr, h / dpr);

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [opts.inertia, opts.inertiaFriction]);

  // ─── Resize observer ──────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        setCanvasSize({ width, height });
      }
    });

    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ─── Mouse / wheel handlers ───────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const v = viewRef.current;
      const worldBefore = {
        x: (mx - sizeRef.current.width / 2 - v.panX) / v.zoom,
        y: (my - sizeRef.current.height / 2 - v.panY) / v.zoom,
      };

      const factor = e.deltaY < 0 ? opts.zoomSpeed : 1 / opts.zoomSpeed;
      const newZoom = Math.max(opts.minZoom, Math.min(opts.maxZoom, v.zoom * factor));

      const newPanX = mx - sizeRef.current.width / 2 - worldBefore.x * newZoom;
      const newPanY = my - sizeRef.current.height / 2 - worldBefore.y * newZoom;

      setViewState({ zoom: newZoom, panX: newPanX, panY: newPanY });
    };

    const onMouseDown = (e: MouseEvent) => {
      // Middle mouse button or Space+Left for panning
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        isPanning.current = true;
        inertiaActive.current = false;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        velocity.current = { x: 0, y: 0 };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;

        setViewState((prev) => ({
          ...prev,
          panX: prev.panX + dx,
          panY: prev.panY + dy,
        }));

        velocity.current = {
          x: dx * 0.5 + velocity.current.x * 0.5,
          y: dy * 0.5 + velocity.current.y * 0.5,
        };

        lastMouse.current = { x: e.clientX, y: e.clientY };
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isPanning.current && (e.button === 1 || e.button === 0)) {
        isPanning.current = false;
        canvas.style.cursor = '';
        if (opts.inertia) {
          inertiaActive.current = true;
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      // Allow custom context menu handling upstream
      // e.preventDefault() is intentionally not called here
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [opts.zoomSpeed, opts.minZoom, opts.maxZoom, opts.inertia]);

  return {
    canvasRef,
    view,
    canvasSize,
    screenToWorld,
    worldToScreen,
    setView,
    zoomToFit,
    getCursorWorldPos,
  };
}

// ─── Grid rendering helper ──────────────────────────────────────────────────

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: CanvasViewState,
  width: number,
  height: number,
  gridSize: number,
  gridColor: string,
  majorColor: string,
  majorEvery: number = 10
): void {
  const { zoom, panX, panY } = view;
  const screenGrid = gridSize * zoom;

  // Don't draw grid if too dense
  if (screenGrid < 4) return;

  const cx = width / 2 + panX;
  const cy = height / 2 + panY;

  // Calculate visible world range
  const left = -cx / zoom;
  const top = -cy / zoom;
  const right = (width - cx) / zoom;
  const bottom = (height - cy) / zoom;

  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;
  const endX = Math.ceil(right / gridSize) * gridSize;
  const endY = Math.ceil(bottom / gridSize) * gridSize;

  ctx.save();

  if (screenGrid > 12) {
    // Draw as dots when zoomed in enough
    const majorGrid = gridSize * majorEvery;

    for (let x = startX; x <= endX; x += gridSize) {
      for (let y = startY; y <= endY; y += gridSize) {
        const sx = x * zoom + cx;
        const sy = y * zoom + cy;

        const isMajor =
          Math.abs(x % majorGrid) < gridSize * 0.1 &&
          Math.abs(y % majorGrid) < gridSize * 0.1;

        ctx.fillStyle = isMajor ? majorColor : gridColor;
        const r = isMajor ? 1.5 : 0.8;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
    }
  } else {
    // Draw as lines when zoomed out
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = startX; x <= endX; x += gridSize) {
      const sx = x * zoom + cx;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      const sy = y * zoom + cy;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  }

  // Draw origin crosshair
  const ox = cx;
  const oy = cy;
  ctx.strokeStyle = majorColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, height);
  ctx.moveTo(0, oy);
  ctx.lineTo(width, oy);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─── Hit test helper ────────────────────────────────────────────────────────

export function pointInRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}

export default useCanvas;
