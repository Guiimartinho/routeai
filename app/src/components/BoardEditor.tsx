// ─── BoardEditor.tsx ── Main PCB layout editor ─────────────────────────────
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { theme } from '../styles/theme';
import type {
  Point, BrdTool, BrdComponent, BrdTrace, BrdVia, BrdZone,
  BoardState, SchNet, KeepoutType, ViaType,
} from '../types';
import PanelizationDialog from './PanelizationDialog';
import BoardCanvasGL, {
  type BoardCanvasHandle, type LayerConfig, type DRCMarker,
  type RatsnestLine, type MeasureState, type SelectionRect,
} from './BoardCanvasGL';
import LayerPanel from './LayerPanel';
import NetlistPanel from './NetlistPanel';
import GerberExport from './GerberExport';
import BoardOutlineEditor from './BoardOutlineEditor';
import DesignRuleCheck from './DesignRuleCheck';
import type { DRCResult as DRCComponentResult } from './DesignRuleCheck';
import AIPanel from './AIPanel';
import NetClassEditor from './NetClassEditor';
import StackupEditor from './StackupEditor';
import { runDRC } from '../engine/drcEngine';
import type { DesignRules } from '../engine/drcEngine';
import type { DRCResult as DRCEngineResult } from '../engine/drcEngine';
import { useProjectStore } from '../store/projectStore';
import { dispatchCrossProbe } from '../engine/crossProbe';
import { routeWithPushShove, collectBoardPads, DEFAULT_PUSH_SHOVE_CONFIG } from '../engine/pushShoveRouter';
import { quickDiffPair } from '../engine/diffPairRouter';
import { addMeanders, calculateTraceLength } from '../engine/lengthTuner';
import type { MeanderStyle } from '../engine/lengthTuner';

// ─── Default layers ─────────────────────────────────────────────────────────

function createDefaultLayers(): LayerConfig[] {
  const layerDefs: [string, string][] = [
    ['F.Cu', '#f04040'], ['B.Cu', '#4060f0'],
    ['In1.Cu', '#40c040'], ['In2.Cu', '#c0c040'],
    ['In3.Cu', '#c040c0'], ['In4.Cu', '#40c0c0'],
    ['F.SilkS', '#f0f040'], ['B.SilkS', '#a040f0'],
    ['F.Mask', '#a04060'], ['B.Mask', '#4060a0'],
    ['F.Paste', '#c08080'], ['B.Paste', '#8080c0'],
    ['F.Fab', '#808040'], ['B.Fab', '#408080'],
    ['Edge.Cuts', '#e0e040'],
    ['Dwgs.User', '#808080'], ['Cmts.User', '#606060'],
  ];
  return layerDefs.map(([id, color]) => ({
    id, color, visible: true,
    opacity: ['F.Paste', 'B.Paste', 'F.Fab', 'B.Fab', 'Dwgs.User', 'Cmts.User'].includes(id) ? 0.5 : 0.85,
  }));
}

// ─── Rotation helper (Bug #3, #4) ───────────────────────────────────────────
// Compute the world-space position of a pad, accounting for component rotation.

function rotatedPadPos(comp: BrdComponent, pad: { x: number; y: number }): Point {
  const rad = (comp.rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const rx = pad.x * cosR - pad.y * sinR;
  const ry = pad.x * sinR + pad.y * cosR;
  return { x: comp.x + rx, y: comp.y + ry };
}

// ─── Toolbar button ─────────────────────────────────────────────────────────

interface ToolBtnProps {
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}

const ToolBtn: React.FC<ToolBtnProps> = ({ label, shortcut, active, onClick }) => (
  <button
    style={{
      ...styles.toolBtn,
      ...(active ? styles.toolBtnActive : {}),
    }}
    onClick={onClick}
    title={`${label} (${shortcut})`}
  >
    <span style={styles.toolLabel}>{label}</span>
    <span style={styles.toolShortcut}>{shortcut}</span>
  </button>
);

// ─── UID generator ──────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++_uidCounter).toString(36)}`;
}

// ─── Via layer helpers ──────────────────────────────────────────────────────

/** Ordered copper layer names used for computing via spans */
const COPPER_LAYER_ORDER = ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'];

/** Return all copper layers between startLayer and endLayer (inclusive) */
function computeViaLayers(startLayer: string, endLayer: string): string[] {
  const si = COPPER_LAYER_ORDER.indexOf(startLayer);
  const ei = COPPER_LAYER_ORDER.indexOf(endLayer);
  if (si < 0 || ei < 0) return [startLayer, endLayer];
  const lo = Math.min(si, ei);
  const hi = Math.max(si, ei);
  return COPPER_LAYER_ORDER.slice(lo, hi + 1);
}

/** Return valid layer pair options for a given via type, considering the board layers */
function getValidLayerPairs(type: ViaType, boardLayers: string[]): { start: string; end: string; label: string }[] {
  const cuLayers = COPPER_LAYER_ORDER.filter(l => boardLayers.includes(l));
  const pairs: { start: string; end: string; label: string }[] = [];

  switch (type) {
    case 'through':
      if (cuLayers.length >= 2) {
        pairs.push({ start: cuLayers[0], end: cuLayers[cuLayers.length - 1], label: `${cuLayers[0]} - ${cuLayers[cuLayers.length - 1]}` });
      }
      break;
    case 'blind':
      // Blind vias connect an outer layer to an inner layer
      for (let i = 1; i < cuLayers.length - 1; i++) {
        pairs.push({ start: cuLayers[0], end: cuLayers[i], label: `${cuLayers[0]} - ${cuLayers[i]}` });
      }
      for (let i = 1; i < cuLayers.length - 1; i++) {
        pairs.push({ start: cuLayers[cuLayers.length - 1], end: cuLayers[i], label: `${cuLayers[cuLayers.length - 1]} - ${cuLayers[i]}` });
      }
      break;
    case 'buried':
      // Buried vias connect inner layers only
      for (let i = 1; i < cuLayers.length - 1; i++) {
        for (let j = i + 1; j < cuLayers.length - 1; j++) {
          pairs.push({ start: cuLayers[i], end: cuLayers[j], label: `${cuLayers[i]} - ${cuLayers[j]}` });
        }
      }
      break;
    case 'micro':
      // Micro vias connect adjacent layers only
      for (let i = 0; i < cuLayers.length - 1; i++) {
        pairs.push({ start: cuLayers[i], end: cuLayers[i + 1], label: `${cuLayers[i]} - ${cuLayers[i + 1]}` });
      }
      break;
  }
  return pairs;
}

/** Default via drill/size by type */
function getViaDefaults(type: ViaType): { drill: number; size: number } {
  switch (type) {
    case 'through': return { drill: 0.3, size: 0.6 };
    case 'blind':   return { drill: 0.2, size: 0.45 };
    case 'buried':  return { drill: 0.2, size: 0.4 };
    case 'micro':   return { drill: 0.1, size: 0.25 };
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface BoardEditorProps {
  crossProbeRef?: { source: 'sch' | 'board'; ref: string } | null;
}

const BoardEditor: React.FC<BoardEditorProps> = ({ crossProbeRef }) => {
  // Bug #1 & #8: Read board state from projectStore instead of local useState with demo data
  const projectStore = useProjectStore();
  const board = projectStore.board;
  const nets = projectStore.nets;

  // Wrapper to update board via projectStore (Bug #8)
  const setBoard = useCallback((updater: BoardState | ((prev: BoardState) => BoardState)) => {
    const newBoard = typeof updater === 'function' ? updater(projectStore.board) : updater;
    // Use updateBoard without pushing undo (we manage undo manually where needed)
    useProjectStore.setState({ board: newBoard, isDirty: true });
  }, [projectStore.board]);

  // Editor state
  const [activeTool, setActiveTool] = useState<BrdTool>('select');
  const [activeLayer, setActiveLayer] = useState('F.Cu');
  const [layers, setLayers] = useState<LayerConfig[]>(createDefaultLayers);
  const [highlightedNet, setHighlightedNet] = useState<string | null>(null);

  // Grid
  const [gridSpacing, setGridSpacing] = useState(1.27);
  const [gridStyle, setGridStyle] = useState<'dots' | 'lines'>('dots');
  const [showGrid, setShowGrid] = useState(true);
  const [showRatsnest, setShowRatsnest] = useState(true);
  const [showCrosshair, setShowCrosshair] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);

  // Tool state
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [measure, setMeasure] = useState<MeasureState>({ start: null, end: null, active: false });
  const [routingPreview, setRoutingPreview] = useState<Point[] | null>(null);
  const [routingWidth, setRoutingWidth] = useState(0.25);
  const [zonePreview, setZonePreview] = useState<Point[] | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeStart, setRouteStart] = useState<Point | null>(null);
  const [routeSegments, setRouteSegments] = useState<Point[]>([]);
  const [routeNetId, setRouteNetId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<{ id: string; type: 'component'; offsetX: number; offsetY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);

  // Bug #7: Zone net assignment - track selected net for zone tool
  const [zoneNetId, setZoneNetId] = useState<string>('');

  // Keepout zone state
  const [keepoutPreview, setKeepoutPreview] = useState<Point[] | null>(null);
  const [keepoutType, setKeepoutType] = useState<KeepoutType>('no_copper');

  // Via type state (blind/buried/micro support)
  const [viaType, setViaType] = useState<ViaType>('through');
  const [viaStartLayer, setViaStartLayer] = useState<string>('F.Cu');
  const [viaEndLayer, setViaEndLayer] = useState<string>('B.Cu');

  // Panelization dialog
  const [showPanelization, setShowPanelization] = useState(false);

  // Push-and-shove routing state
  const [pushShoveEnabled, setPushShoveEnabled] = useState(true);

  // Differential pair routing state
  const [diffPairStart, setDiffPairStart] = useState<Point | null>(null);
  const [diffPairGap, setDiffPairGap] = useState(0.2);
  const [diffPairNetP, setDiffPairNetP] = useState('');
  const [diffPairNetN, setDiffPairNetN] = useState('');
  const [diffPairPreview, setDiffPairPreview] = useState<{ p: Point[]; n: Point[] } | null>(null);

  // Length tuning state
  const [lengthTuneTraceId, setLengthTuneTraceId] = useState<string | null>(null);
  const [lengthTuneTarget, setLengthTuneTarget] = useState(0);
  const [lengthTuneAmplitude, setLengthTuneAmplitude] = useState(1.0);
  const [lengthTuneStyle, setLengthTuneStyle] = useState<MeanderStyle>('serpentine');
  const [lengthTuneInfo, setLengthTuneInfo] = useState<{ id: string; length: number } | null>(null);

  // Track current mouse position in world coords (Bug #5)
  const currentMouseWorldRef = useRef<Point>({ x: 0, y: 0 });

  // Double-click detection for cross-probe
  const lastClickRef = useRef<{ time: number; id: string }>({ time: 0, id: '' });

  // DRC markers (derived from real DRC results)
  const [drcMarkers, setDrcMarkers] = useState<DRCMarker[]>([]);

  // DRC state
  const [drcResult, setDrcResult] = useState<DRCComponentResult | null>(null);
  const [drcRunning, setDrcRunning] = useState(false);
  const [showDRCPanel, setShowDRCPanel] = useState(false);

  // Panel visibility
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showNetClassEditor, setShowNetClassEditor] = useState(false);
  const [showStackupEditor, setShowStackupEditor] = useState(false);
  const [showOutlineEditor, setShowOutlineEditor] = useState(false);

  const canvasRef = useRef<BoardCanvasHandle>(null);

  // ─── Cross-probe: highlight incoming ref from schematic ─────────────
  useEffect(() => {
    if (!crossProbeRef || crossProbeRef.source !== 'sch') return;
    const comp = board.components.find(c => c.ref === crossProbeRef.ref);
    if (comp) {
      setSelectedIds(new Set([comp.id]));
      // Also zoom to the component
      if (canvasRef.current) {
        const vs = canvasRef.current.getViewState();
        const cw = 800;
        const ch = 600;
        const z = Math.max(vs.zoom, 6);
        canvasRef.current.setZoom(z);
        canvasRef.current.setPan(cw / 2 - comp.x * z, ch / 2 - comp.y * z);
      }
    }
  }, [crossProbeRef, board.components]);

  // ─── Snap to grid ───────────────────────────────────────────────────

  const snap = useCallback((p: Point): Point => {
    if (!snapToGrid) return p;
    return {
      x: Math.round(p.x / gridSpacing) * gridSpacing,
      y: Math.round(p.y / gridSpacing) * gridSpacing,
    };
  }, [snapToGrid, gridSpacing]);

  // ─── Compute ratsnest (Bug #4: use rotatedPadPos) ─────────────────

  const ratsnest = useMemo((): RatsnestLine[] => {
    const lines: RatsnestLine[] = [];
    nets.forEach(net => {
      // Get pad positions for this net, applying component rotation
      const padPositions: Point[] = [];
      board.components.forEach(comp => {
        comp.pads.forEach(pad => {
          if (pad.netId === net.id) {
            padPositions.push(rotatedPadPos(comp, pad));
          }
        });
      });
      if (padPositions.length < 2) return;

      // Check which connections are already routed
      const tracesForNet = board.traces.filter(t => t.netId === net.id);

      // Simple: if not enough traces, draw minimum spanning tree of unconnected pads
      if (tracesForNet.length < padPositions.length - 1) {
        // Simplified: just connect sequential pads that don't have traces
        for (let i = 0; i < padPositions.length - 1; i++) {
          // Check if there's a trace roughly connecting these
          const hasTrace = tracesForNet.some(t => {
            const start = t.points[0];
            const end = t.points[t.points.length - 1];
            const d1 = Math.hypot(start.x - padPositions[i].x, start.y - padPositions[i].y);
            const d2 = Math.hypot(end.x - padPositions[i + 1].x, end.y - padPositions[i + 1].y);
            const d3 = Math.hypot(start.x - padPositions[i + 1].x, start.y - padPositions[i + 1].y);
            const d4 = Math.hypot(end.x - padPositions[i].x, end.y - padPositions[i].y);
            return (d1 < 2 && d2 < 2) || (d3 < 2 && d4 < 2);
          });
          if (!hasTrace) {
            lines.push({
              from: padPositions[i],
              to: padPositions[i + 1],
              netId: net.id,
            });
          }
        }
      }
    });
    return lines;
  }, [nets, board]);

  // ─── Hit testing (Bug #3: apply rotation) ─────────────────────────

  const hitTestComponent = useCallback((pos: Point): BrdComponent | null => {
    for (const comp of board.components) {
      for (const pad of comp.pads) {
        const pp = rotatedPadPos(comp, pad);
        const hw = pad.width / 2 + 0.5;
        const hh = pad.height / 2 + 0.5;
        if (pos.x >= pp.x - hw && pos.x <= pp.x + hw && pos.y >= pp.y - hh && pos.y <= pp.y + hh) {
          return comp;
        }
      }
    }
    return null;
  }, [board.components]);

  const hitTestPad = useCallback((pos: Point): { comp: BrdComponent; pad: typeof board.components[0]['pads'][0]; netId: string | undefined } | null => {
    for (const comp of board.components) {
      for (const pad of comp.pads) {
        const pp = rotatedPadPos(comp, pad);
        const hw = pad.width / 2;
        const hh = pad.height / 2;
        if (pos.x >= pp.x - hw && pos.x <= pp.x + hw && pos.y >= pp.y - hh && pos.y <= pp.y + hh) {
          return { comp, pad, netId: pad.netId };
        }
      }
    }
    return null;
  }, [board.components]);

  // ─── Undo/Redo helpers (Bug #8: use projectStore) ─────────────────

  const handleUndo = useCallback(() => {
    projectStore.undo();
  }, [projectStore]);

  const handleRedo = useCallback(() => {
    projectStore.redo();
  }, [projectStore]);

  // ─── 45-degree routing helper ─────────────────────────────────────

  const computeRouteSegments = useCallback((start: Point, end: Point): Point[] => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // 45-degree routing: horizontal first, then diagonal
    if (absDx > absDy) {
      const straight = absDx - absDy;
      const midX = start.x + Math.sign(dx) * straight;
      return [start, { x: midX, y: start.y }, end];
    } else {
      const straight = absDy - absDx;
      const midY = start.y + Math.sign(dy) * straight;
      return [start, { x: start.x, y: midY }, end];
    }
  }, []);

  // ─── Mouse handlers ──────────────────────────────────────────────

  const handleMouseDown = useCallback((worldPos: Point, e: React.MouseEvent) => {
    const pos = snap(worldPos);

    // Middle mouse: pan
    if (e.button === 1) {
      setIsPanning(true);
      setPanStart(worldPos);
      return;
    }

    // Right click: cancel current operation
    if (e.button === 2) {
      if (isRouting) {
        setIsRouting(false);
        setRouteStart(null);
        setRouteSegments([]);
        setRoutingPreview(null);
        setRouteNetId(null);
      }
      if (zonePreview) {
        setZonePreview(null);
      }
      if (measure.active) {
        setMeasure({ start: null, end: null, active: false });
      }
      return;
    }

    switch (activeTool) {
      case 'select': {
        const hitComp = hitTestComponent(pos);
        if (hitComp) {
          // Double-click detection for cross-probe
          const now = Date.now();
          const last = lastClickRef.current;
          if (last.id === hitComp.id && now - last.time < 400) {
            // Double-click detected: dispatch cross-probe
            dispatchCrossProbe({ source: 'board', ref: hitComp.ref });
            lastClickRef.current = { time: 0, id: '' };
            break;
          }
          lastClickRef.current = { time: now, id: hitComp.id };

          setSelectedIds(new Set([hitComp.id]));
          // Bug #6: Push undo snapshot when drag STARTS (mouseDown), not during drag
          projectStore.updateBoard({ ...board }); // push undo snapshot via store
          setDragging({
            id: hitComp.id,
            type: 'component',
            offsetX: pos.x - hitComp.x,
            offsetY: pos.y - hitComp.y,
          });
          // Highlight net of clicked pad
          const hitPad = hitTestPad(pos);
          if (hitPad?.netId) setHighlightedNet(hitPad.netId);
        } else {
          lastClickRef.current = { time: 0, id: '' };
          setSelectedIds(new Set());
          setHighlightedNet(null);
          // Start selection rectangle
          setSelectionRect({ start: worldPos, end: worldPos });
        }
        break;
      }

      case 'trace': {
        if (!isRouting) {
          // Bug #2: Allow starting a route from empty space (not just pads)
          const hitPad = hitTestPad(pos);
          setIsRouting(true);
          setRouteStart(pos);
          setRouteSegments([pos]);
          setRouteNetId(hitPad?.netId || null);
          if (hitPad?.netId) setHighlightedNet(hitPad.netId);
        } else {
          // Add routing segment
          const newSegments = [...routeSegments, pos];
          setRouteSegments(newSegments);

          // Check if we hit a target pad
          const hitPad = hitTestPad(pos);

          // Bug #2: Multiple completion scenarios
          if (hitPad && newSegments.length > 1) {
            // Ending on a pad
            let traceNetId = routeNetId;
            if (!traceNetId && hitPad.netId) {
              // Started from empty space, ending on a pad: adopt pad's net
              traceNetId = hitPad.netId;
            }
            // BUG 7 FIX: Reject route if start and end pads belong to different nets
            if (routeNetId && hitPad.netId && routeNetId !== hitPad.netId) {
              console.warn(`Cannot route between different nets: ${routeNetId} → ${hitPad.netId}`);
              setIsRouting(false);
              setRouteStart(null);
              setRouteSegments([]);
              setRoutingPreview(null);
            } else if (traceNetId === hitPad.netId || !routeNetId) {
              // Complete trace with optional push-and-shove
              const finalNetId = traceNetId || hitPad.netId || '';
              if (pushShoveEnabled) {
                const boardPads = collectBoardPads(board.components);
                const psResult = routeWithPushShove(
                  newSegments, finalNetId, activeLayer, routingWidth,
                  board.traces, boardPads, projectStore.designRules.global.clearance,
                  { ...DEFAULT_PUSH_SHOVE_CONFIG, enabled: true },
                );
                // BUG 8 FIX: Check psResult.success and warn on push-shove failure
                if (!psResult.success) {
                  console.warn('Push-and-shove failed: trace created but may have clearance violations');
                }
                const updatedTraces = board.traces.map(t => {
                  const modified = psResult.modifiedTraces.find(m => m.id === t.id);
                  return modified || t;
                });
                projectStore.updateBoard({
                  ...board,
                  traces: [...updatedTraces, { ...psResult.newTrace, id: uid('t'), netId: finalNetId }],
                });
              } else {
                const newTrace: BrdTrace = {
                  id: uid('t'),
                  points: newSegments,
                  width: routingWidth,
                  layer: activeLayer,
                  netId: finalNetId,
                };
                projectStore.updateBoard({
                  ...board,
                  traces: [...board.traces, newTrace],
                });
              }
              setIsRouting(false);
              setRouteStart(null);
              setRouteSegments([]);
              setRoutingPreview(null);
              setRouteNetId(null);
            }
          }
          // Double-click or press Enter to finish on empty space handled via keyboard
        }
        break;
      }

      case 'via': {
        const viaDef = getViaDefaults(viaType);
        const vLayers = computeViaLayers(viaStartLayer, viaEndLayer);
        if (isRouting) {
          // Insert via during routing
          const newVia: BrdVia = {
            id: uid('v'),
            x: pos.x, y: pos.y,
            drill: viaDef.drill, size: viaDef.size,
            layers: vLayers,
            netId: routeNetId || '',
            viaType,
            startLayer: viaStartLayer,
            endLayer: viaEndLayer,
          };
          projectStore.updateBoard({
            ...board,
            vias: [...board.vias, newVia],
          });
          // Switch active layer to the other end of the via
          setActiveLayer(prev => prev === viaStartLayer ? viaEndLayer : viaStartLayer);
          // Add segment to via point
          setRouteSegments(prev => [...prev, pos]);
        } else {
          // Place standalone via
          const hitPad = hitTestPad(pos);
          const newVia: BrdVia = {
            id: uid('v'),
            x: pos.x, y: pos.y,
            drill: viaDef.drill, size: viaDef.size,
            layers: vLayers,
            netId: hitPad?.netId || '',
            viaType,
            startLayer: viaStartLayer,
            endLayer: viaEndLayer,
          };
          projectStore.updateBoard({
            ...board,
            vias: [...board.vias, newVia],
          });
        }
        break;
      }

      case 'zone': {
        if (!zonePreview) {
          // Bug #7: Auto-assign net from the first pad clicked inside the zone
          const hitPad = hitTestPad(pos);
          if (hitPad?.netId && !zoneNetId) {
            setZoneNetId(hitPad.netId);
          }
          setZonePreview([pos]);
        } else {
          // Check if closing the zone (near first point)
          const first = zonePreview[0];
          const dist = Math.hypot(pos.x - first.x, pos.y - first.y);
          if (dist < 2 && zonePreview.length >= 3) {
            // Complete zone - use zoneNetId or highlighted net
            const assignedNetId = zoneNetId || highlightedNet || '';
            const newZone: BrdZone = {
              id: uid('z'),
              points: zonePreview,
              layer: activeLayer,
              netId: assignedNetId,
            };
            projectStore.updateBoard({
              ...board,
              zones: [...board.zones, newZone],
            });
            setZonePreview(null);
            setZoneNetId('');
          } else {
            // Bug #7: Check for pads clicked while building zone to auto-assign net
            const hitPad = hitTestPad(pos);
            if (hitPad?.netId && !zoneNetId) {
              setZoneNetId(hitPad.netId);
            }
            setZonePreview(prev => prev ? [...prev, pos] : [pos]);
          }
        }
        break;
      }

      case 'keepout': {
        if (!keepoutPreview) {
          setKeepoutPreview([pos]);
        } else {
          // Check if closing the keepout zone (near first point)
          const first = keepoutPreview[0];
          const closeDist = Math.hypot(pos.x - first.x, pos.y - first.y);
          if (closeDist < 2 && keepoutPreview.length >= 3) {
            // Complete keepout zone
            const newZone: BrdZone = {
              id: uid('kz'),
              points: keepoutPreview,
              layer: activeLayer,
              netId: '',
              isKeepout: true,
              keepoutType: keepoutType,
            };
            projectStore.updateBoard({
              ...board,
              zones: [...board.zones, newZone],
            });
            setKeepoutPreview(null);
          } else {
            setKeepoutPreview(prev => prev ? [...prev, pos] : [pos]);
          }
        }
        break;
      }

      case 'measure': {
        if (!measure.start || measure.end) {
          setMeasure({ start: pos, end: null, active: true });
        } else {
          setMeasure(prev => ({ ...prev, end: pos, active: false }));
        }
        break;
      }

      case 'dimension': {
        // Same as measure for now
        if (!measure.start || measure.end) {
          setMeasure({ start: pos, end: null, active: true });
        } else {
          setMeasure(prev => ({ ...prev, end: pos, active: false }));
        }
        break;
      }

      case 'component': {
        // Place a new component at click position
        const newComp: BrdComponent = {
          id: uid('c'),
          ref: `U${board.components.length + 1}`,
          value: 'New',
          footprint: 'QFP-32',
          x: pos.x, y: pos.y,
          rotation: 0,
          layer: activeLayer,
          pads: [
            { id: uid('p'), number: '1', x: -2, y: -2, width: 1, height: 0.5, shape: 'rect', layers: [activeLayer] },
            { id: uid('p'), number: '2', x: -2, y: 0, width: 1, height: 0.5, shape: 'rect', layers: [activeLayer] },
            { id: uid('p'), number: '3', x: 2, y: -2, width: 1, height: 0.5, shape: 'rect', layers: [activeLayer] },
            { id: uid('p'), number: '4', x: 2, y: 0, width: 1, height: 0.5, shape: 'rect', layers: [activeLayer] },
          ],
        };
        projectStore.updateBoard({
          ...board,
          components: [...board.components, newComp],
        });
        break;
      }

      case 'diffpair': {
        if (!diffPairStart) {
          // First click: set start point
          const hitPad = hitTestPad(pos);
          setDiffPairStart(pos);
          if (hitPad?.netId) setDiffPairNetP(hitPad.netId);
        } else {
          // Second click: complete differential pair route
          const hitPad = hitTestPad(pos);
          if (hitPad?.netId && !diffPairNetN) setDiffPairNetN(hitPad.netId);

          const result = quickDiffPair(
            diffPairStart, pos,
            diffPairGap, routingWidth, activeLayer,
            diffPairNetP || uid('dpP'),
            diffPairNetN || (hitPad?.netId || uid('dpN')),
          );

          projectStore.updateBoard({
            ...board,
            traces: [
              ...board.traces,
              { ...result.positiveTrace, id: uid('t') },
              { ...result.negativeTrace, id: uid('t') },
            ],
          });

          // Reset state
          setDiffPairStart(null);
          setDiffPairPreview(null);
          setDiffPairNetP('');
          setDiffPairNetN('');
        }
        break;
      }

      case 'lengthtune': {
        // Click on a trace to select it for length tuning
        const hitTrace = board.traces.find(t => {
          if (t.layer !== activeLayer) return false;
          for (let i = 0; i < t.points.length - 1; i++) {
            const A = t.points[i];
            const B = t.points[i + 1];
            const dx = B.x - A.x;
            const dy = B.y - A.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) continue;
            let tt = ((pos.x - A.x) * dx + (pos.y - A.y) * dy) / lenSq;
            tt = Math.max(0, Math.min(1, tt));
            const closest = { x: A.x + tt * dx, y: A.y + tt * dy };
            const d = Math.hypot(pos.x - closest.x, pos.y - closest.y);
            if (d < t.width / 2 + 1.0) return true;
          }
          return false;
        });

        if (hitTrace) {
          if (lengthTuneTraceId === hitTrace.id) {
            // Already selected - apply meander
            if (lengthTuneTarget > 0) {
              const result = addMeanders(hitTrace, lengthTuneTarget, lengthTuneAmplitude, lengthTuneStyle);
              projectStore.updateBoard({
                ...board,
                traces: board.traces.map(t => t.id === hitTrace.id ? result.trace : t),
              });
              setLengthTuneTraceId(null);
              setLengthTuneInfo(null);
            }
          } else {
            // Select trace for tuning
            const len = calculateTraceLength(hitTrace);
            setLengthTuneTraceId(hitTrace.id);
            setLengthTuneInfo({ id: hitTrace.id, length: len });
            setLengthTuneTarget(Math.ceil(len * 1.2 * 10) / 10);
            setSelectedIds(new Set([hitTrace.id]));
          }
        } else {
          setLengthTuneTraceId(null);
          setLengthTuneInfo(null);
        }
        break;
      }
    }
  }, [
    snap, activeTool, isRouting, routeSegments, routeNetId, routingWidth,
    activeLayer, highlightedNet, measure, zonePreview, zoneNetId, board,
    keepoutPreview, keepoutType, pushShoveEnabled,
    diffPairStart, diffPairGap, diffPairNetP, diffPairNetN,
    lengthTuneTraceId, lengthTuneTarget, lengthTuneAmplitude, lengthTuneStyle,
    hitTestComponent, hitTestPad, projectStore,
  ]);

  const handleMouseMove = useCallback((worldPos: Point, e: React.MouseEvent) => {
    const pos = snap(worldPos);
    // Bug #5: Track current mouse world position
    currentMouseWorldRef.current = pos;

    // Panning
    if (isPanning && panStart && canvasRef.current) {
      const vs = canvasRef.current.getViewState();
      const dx = (worldPos.x - panStart.x) * vs.zoom;
      const dy = (worldPos.y - panStart.y) * vs.zoom;
      canvasRef.current.setPan(vs.panX + dx, vs.panY + dy);
      return;
    }

    // Bug #6: Dragging component - undo was pushed on mouseDown, so just update position here
    if (dragging && dragging.type === 'component') {
      setBoard(prev => ({
        ...prev,
        components: prev.components.map(c =>
          c.id === dragging.id
            ? { ...c, x: pos.x - dragging.offsetX, y: pos.y - dragging.offsetY }
            : c
        ),
      }));
      return;
    }

    // Selection rectangle
    if (selectionRect && activeTool === 'select') {
      setSelectionRect(prev => prev ? { ...prev, end: worldPos } : null);
      return;
    }

    // Routing preview
    if (isRouting && routeSegments.length > 0) {
      const lastPt = routeSegments[routeSegments.length - 1];
      const segments = computeRouteSegments(lastPt, pos);
      setRoutingPreview([...routeSegments, ...segments.slice(1)]);
    }

    // Differential pair preview
    if (activeTool === 'diffpair' && diffPairStart) {
      const result = quickDiffPair(
        diffPairStart, pos,
        diffPairGap, routingWidth, activeLayer,
        diffPairNetP || 'preview_p',
        diffPairNetN || 'preview_n',
      );
      setDiffPairPreview({
        p: result.positiveTrace.points,
        n: result.negativeTrace.points,
      });
    }

    // Zone preview - update last point as mouse position for visual feedback
    if (zonePreview && zonePreview.length > 0) {
      // Preview handled by zonePreview state + mouse position in canvas
    }
  }, [
    snap, isPanning, panStart, dragging, selectionRect, activeTool,
    isRouting, routeSegments, computeRouteSegments, zonePreview, setBoard,
    diffPairStart, diffPairGap, diffPairNetP, diffPairNetN, routingWidth, activeLayer,
  ]);

  const handleMouseUp = useCallback((worldPos: Point, e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (dragging) {
      setDragging(null);
      return;
    }

    if (selectionRect && activeTool === 'select') {
      // Find components in selection rectangle
      const minX = Math.min(selectionRect.start.x, selectionRect.end.x);
      const maxX = Math.max(selectionRect.start.x, selectionRect.end.x);
      const minY = Math.min(selectionRect.start.y, selectionRect.end.y);
      const maxY = Math.max(selectionRect.start.y, selectionRect.end.y);
      const selected = new Set<string>();
      board.components.forEach(c => {
        if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) {
          selected.add(c.id);
        }
      });
      setSelectedIds(selected);
      setSelectionRect(null);
    }
  }, [isPanning, dragging, selectionRect, activeTool, board.components]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    e.preventDefault();
    const vs = canvasRef.current.getViewState();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(50, vs.zoom * factor));

    // Zoom centered on mouse
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const newPanX = mx - (mx - vs.panX) * (newZoom / vs.zoom);
    const newPanY = my - (my - vs.panY) * (newZoom / vs.zoom);

    canvasRef.current.setZoom(newZoom);
    canvasRef.current.setPan(newPanX, newPanY);
  }, []);

  // ─── Keyboard shortcuts ───────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          if (isRouting) {
            // Bug #5: Place via at current mouse position, not last segment point
            // Also push undo before placing
            const pos = currentMouseWorldRef.current;
            if (pos) {
              const viaDef = getViaDefaults(viaType);
              const vLayers = computeViaLayers(viaStartLayer, viaEndLayer);
              const newVia: BrdVia = {
                id: uid('v'),
                x: pos.x, y: pos.y,
                drill: viaDef.drill, size: viaDef.size,
                layers: vLayers,
                netId: routeNetId || '',
                viaType,
                startLayer: viaStartLayer,
                endLayer: viaEndLayer,
              };
              projectStore.updateBoard({
                ...projectStore.board,
                vias: [...projectStore.board.vias, newVia],
              });
              setActiveLayer(prev => prev === viaStartLayer ? viaEndLayer : viaStartLayer);
              // Add segment to via position
              setRouteSegments(prev => [...prev, pos]);
            }
          } else {
            setActiveTool('select');
          }
          break;
        case 'x':
          setActiveTool('trace');
          break;
        case 'z':
          setActiveTool('zone');
          break;
        case 'k':
          setActiveTool('keepout');
          break;
        case 'm':
          setActiveTool('measure');
          break;
        case 'd':
          setActiveTool('diffpair');
          setDiffPairStart(null);
          setDiffPairPreview(null);
          break;
        case 'l':
          setActiveTool('lengthtune');
          setLengthTuneTraceId(null);
          setLengthTuneInfo(null);
          break;
        case 'enter':
          // Bug #2: Finish trace on empty space with Enter key
          if (isRouting && routeSegments.length > 1) {
            const traceNetId = routeNetId || uid('tmpnet');
            if (pushShoveEnabled) {
              const boardPads = collectBoardPads(projectStore.board.components);
              const psResult = routeWithPushShove(
                routeSegments, traceNetId, activeLayer, routingWidth,
                projectStore.board.traces, boardPads, projectStore.designRules.global.clearance,
                { ...DEFAULT_PUSH_SHOVE_CONFIG, enabled: true },
              );
              const updatedTraces = projectStore.board.traces.map(t => {
                const modified = psResult.modifiedTraces.find(m => m.id === t.id);
                return modified || t;
              });
              projectStore.updateBoard({
                ...projectStore.board,
                traces: [...updatedTraces, { ...psResult.newTrace, id: uid('t'), netId: traceNetId }],
              });
            } else {
              const newTrace: BrdTrace = {
                id: uid('t'),
                points: routeSegments,
                width: routingWidth,
                layer: activeLayer,
                netId: traceNetId,
              };
              projectStore.updateBoard({
                ...projectStore.board,
                traces: [...projectStore.board.traces, newTrace],
              });
            }
            setIsRouting(false);
            setRouteStart(null);
            setRouteSegments([]);
            setRoutingPreview(null);
            setRouteNetId(null);
          }
          break;
        case 'escape':
          if (isRouting) {
            setIsRouting(false);
            setRouteStart(null);
            setRouteSegments([]);
            setRoutingPreview(null);
            setRouteNetId(null);
          } else if (zonePreview) {
            setZonePreview(null);
            setZoneNetId('');
          } else if (keepoutPreview) {
            setKeepoutPreview(null);
          } else if (diffPairStart) {
            setDiffPairStart(null);
            setDiffPairPreview(null);
            setDiffPairNetP('');
            setDiffPairNetN('');
          } else if (lengthTuneTraceId) {
            setLengthTuneTraceId(null);
            setLengthTuneInfo(null);
          } else {
            setActiveTool('select');
            setSelectedIds(new Set());
            setHighlightedNet(null);
            setMeasure({ start: null, end: null, active: false });
          }
          break;
        case 'r':
          // Rotate selected component
          if (selectedIds.size > 0) {
            projectStore.updateBoard({
              ...projectStore.board,
              components: projectStore.board.components.map(c =>
                selectedIds.has(c.id)
                  ? { ...c, rotation: (c.rotation + 90) % 360 }
                  : c
              ),
            });
          }
          break;
        case 'f':
          // Flip selected component
          if (selectedIds.size > 0) {
            projectStore.updateBoard({
              ...projectStore.board,
              components: projectStore.board.components.map(c => {
                if (!selectedIds.has(c.id)) return c;
                const newLayer = c.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
                return {
                  ...c,
                  layer: newLayer,
                  pads: c.pads.map(p => ({
                    ...p,
                    layers: p.layers.map(l =>
                      l === 'F.Cu' ? 'B.Cu' : l === 'B.Cu' ? 'F.Cu' : l
                    ),
                  })),
                };
              }),
            });
          }
          break;
        case 'delete':
        case 'backspace':
          if (selectedIds.size > 0) {
            projectStore.updateBoard({
              ...projectStore.board,
              components: projectStore.board.components.filter(c => !selectedIds.has(c.id)),
            });
            setSelectedIds(new Set());
          }
          break;
        case 'h':
          // Fit to screen
          canvasRef.current?.zoomToFit();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRouting, routeSegments, routeNetId, routingWidth, activeLayer, selectedIds, zonePreview, keepoutPreview, handleUndo, handleRedo, projectStore, viaType, viaStartLayer, viaEndLayer]);

  // ─── Layer callbacks ──────────────────────────────────────────────

  const handleToggleVisibility = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
  }, []);

  const handleSetOpacity = useCallback((layerId: string, opacity: number) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, opacity } : l));
  }, []);

  const handleShowAll = useCallback(() => {
    setLayers(prev => prev.map(l => ({ ...l, visible: true })));
  }, []);

  const handleHideAll = useCallback(() => {
    setLayers(prev => prev.map(l => ({ ...l, visible: false })));
  }, []);

  // ─── Net callbacks ────────────────────────────────────────────────

  const handleZoomToNet = useCallback((netId: string) => {
    setHighlightedNet(netId);
    // Find all pads/traces for this net and zoom to fit them
    const pts: Point[] = [];
    board.components.forEach(c => {
      c.pads.forEach(p => {
        if (p.netId === netId) pts.push(rotatedPadPos(c, p));
      });
    });
    board.traces.forEach(t => {
      if (t.netId === netId) t.points.forEach(p => pts.push(p));
    });
    if (pts.length === 0 || !canvasRef.current) return;
    const minX = Math.min(...pts.map(p => p.x)) - 5;
    const maxX = Math.max(...pts.map(p => p.x)) + 5;
    const minY = Math.min(...pts.map(p => p.y)) - 5;
    const maxY = Math.max(...pts.map(p => p.y)) + 5;
    // Simple zoom: set pan/zoom to show this rect
    const vs = canvasRef.current.getViewState();
    const cw = 800; // approximate canvas width
    const ch = 600;
    const zx = cw / (maxX - minX);
    const zy = ch / (maxY - minY);
    const z = Math.min(zx, zy) * 0.8;
    canvasRef.current.setZoom(z);
    canvasRef.current.setPan(
      cw / 2 - ((minX + maxX) / 2) * z,
      ch / 2 - ((minY + maxY) / 2) * z,
    );
  }, [board]);

  const handleRouteAll = useCallback(() => {
    setShowAIPanel(true);
  }, []);

  // ─── DRC callbacks ───────────────────────────────────────────────────

  const handleRunDRC = useCallback(() => {
    setDrcRunning(true);
    setShowDRCPanel(true);
    // Run in a microtask to allow UI to show spinner
    Promise.resolve().then(() => {
      // Map user-configured design rules from projectStore to DRC engine format
      const { global: g, netClasses: nc } = projectStore.designRules;
      const userRules: DesignRules = {
        minClearance: g.clearance,
        minTraceWidth: g.minTraceWidth,
        minAnnularRing: g.minAnnularRing,
        minViaDrill: g.minViaDrill,
        minBoardEdgeClearance: g.copperToEdgeClearance,
        minSolderMaskExpansion: (g as any).solderMaskExpansion ?? 0.05,
        minSilkToPadClearance: (g as any).silkToPadClearance ?? 0.15,
        netClasses: nc.map(c => ({
          name: c.name,
          nets: [],
          minTraceWidth: c.traceWidth,
          minClearance: c.clearance,
        })),
      };
      const engineResult: DRCEngineResult = runDRC(board, userRules);
      // Map engine result to component DRCResult format
      const componentResult: DRCComponentResult = {
        violations: engineResult.violations.map((v, i) => ({
          id: `drc_${i}`,
          severity: v.severity,
          category: v.rule === 'short-circuit' ? 'clearance' :
                    v.rule === 'board-edge' ? 'clearance' :
                    v.rule as any,
          description: v.message,
          x: v.x,
          y: v.y,
          elementIds: v.affectedItems,
        })),
        score: engineResult.score,
        runTime: engineResult.runTimeMs,
        timestamp: engineResult.timestamp,
      };
      setDrcResult(componentResult);

      // Update DRC markers on the canvas
      setDrcMarkers(
        engineResult.violations
          .filter(v => v.severity === 'error' || v.severity === 'warning')
          .map(v => ({
            x: v.x,
            y: v.y,
            message: v.message,
            severity: v.severity as 'error' | 'warning',
          }))
      );

      setDrcRunning(false);
    });
  }, [board, projectStore.designRules]);

  const handleDRCNavigateTo = useCallback((x: number, y: number) => {
    if (!canvasRef.current) return;
    const vs = canvasRef.current.getViewState();
    const cw = 800;
    const ch = 600;
    const z = Math.max(vs.zoom, 6);
    canvasRef.current.setZoom(z);
    canvasRef.current.setPan(cw / 2 - x * z, ch / 2 - y * z);
  }, []);

  const handleDRCSelectElements = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const handleDRCExportReport = useCallback(() => {
    if (!drcResult) return;
    const lines = [
      'Design Rule Check Report',
      `Date: ${new Date(drcResult.timestamp).toISOString()}`,
      `Score: ${drcResult.score}/100`,
      `Run time: ${drcResult.runTime.toFixed(1)}ms`,
      `Total violations: ${drcResult.violations.length}`,
      '',
      ...drcResult.violations.map(v =>
        `[${v.severity.toUpperCase()}] ${v.category}: ${v.description} at (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'drc_report.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [drcResult]);

  // ─── Collect available nets for zone net picker (Bug #7) ──────────

  const availableNets = useMemo(() => {
    const netSet = new Map<string, string>();
    nets.forEach(n => netSet.set(n.id, n.name));
    // Also collect nets from pads on the board
    board.components.forEach(c => {
      c.pads.forEach(p => {
        if (p.netId && !netSet.has(p.netId)) {
          netSet.set(p.netId, p.netId);
        }
      });
    });
    return Array.from(netSet.entries()).map(([id, name]) => ({ id, name }));
  }, [nets, board.components]);

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="board-editor-container" style={styles.root}>
      {/* Top toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolGroup}>
          <ToolBtn label="Select" shortcut="V" active={activeTool === 'select'} onClick={() => setActiveTool('select')} />
          <ToolBtn label="Route" shortcut="X" active={activeTool === 'trace'} onClick={() => setActiveTool('trace')} />
          <ToolBtn label="Via" shortcut="" active={activeTool === 'via'} onClick={() => setActiveTool('via')} />
          <ToolBtn label="Part" shortcut="" active={activeTool === 'component'} onClick={() => setActiveTool('component')} />
          <ToolBtn label="Zone" shortcut="Z" active={activeTool === 'zone'} onClick={() => setActiveTool('zone')} />
          <ToolBtn label="Keepout" shortcut="K" active={activeTool === 'keepout'} onClick={() => setActiveTool('keepout')} />
          <ToolBtn label="Measure" shortcut="M" active={activeTool === 'measure'} onClick={() => setActiveTool('measure')} />
          <ToolBtn label="DiffPair" shortcut="D" active={activeTool === 'diffpair'} onClick={() => { setActiveTool('diffpair'); setDiffPairStart(null); setDiffPairPreview(null); }} />
          <ToolBtn label="LenTune" shortcut="L" active={activeTool === 'lengthtune'} onClick={() => { setActiveTool('lengthtune'); setLengthTuneTraceId(null); setLengthTuneInfo(null); }} />
        </div>

        <div style={styles.toolSeparator} />

        {/* Push-and-Shove toggle */}
        <div style={styles.toolGroup}>
          <button
            style={{ ...styles.toggleBtn, ...(pushShoveEnabled ? styles.toggleBtnActive : {}) }}
            onClick={() => setPushShoveEnabled(!pushShoveEnabled)}
            title="Toggle push-and-shove routing"
          >
            P&amp;S
          </button>
        </div>

        <div style={styles.toolSeparator} />

        {/* Trace width */}
        <div style={styles.toolGroup}>
          <span style={styles.paramLabel}>Width:</span>
          <select
            style={styles.paramSelect}
            value={routingWidth}
            onChange={e => setRoutingWidth(parseFloat(e.target.value))}
          >
            <option value={0.1}>0.10mm</option>
            <option value={0.15}>0.15mm</option>
            <option value={0.2}>0.20mm</option>
            <option value={0.25}>0.25mm</option>
            <option value={0.3}>0.30mm</option>
            <option value={0.4}>0.40mm</option>
            <option value={0.5}>0.50mm</option>
            <option value={1.0}>1.00mm</option>
          </select>
        </div>

        <div style={styles.toolSeparator} />

        {/* Bug #7: Zone net picker dropdown */}
        {activeTool === 'zone' && (
          <>
            <div style={styles.toolGroup}>
              <span style={styles.paramLabel}>Zone Net:</span>
              <select
                style={styles.paramSelect}
                value={zoneNetId}
                onChange={e => setZoneNetId(e.target.value)}
              >
                <option value="">-- auto --</option>
                {availableNets.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
            <div style={styles.toolSeparator} />
          </>
        )}

        {/* Via type + layer pair picker */}
        {activeTool === 'via' && (
          <>
            <div style={styles.toolGroup}>
              <span style={styles.paramLabel}>Via:</span>
              <select
                style={styles.paramSelect}
                value={viaType}
                onChange={e => {
                  const newType = e.target.value as ViaType;
                  setViaType(newType);
                  // Auto-select first valid layer pair for the new type
                  const pairs = getValidLayerPairs(newType, board.layers);
                  if (pairs.length > 0) {
                    setViaStartLayer(pairs[0].start);
                    setViaEndLayer(pairs[0].end);
                  }
                }}
              >
                <option value="through">Through</option>
                <option value="blind">Blind</option>
                <option value="buried">Buried</option>
                <option value="micro">Micro</option>
              </select>
              <span style={styles.paramLabel}>Layers:</span>
              <select
                style={{ ...styles.paramSelect, minWidth: 120 }}
                value={`${viaStartLayer}|${viaEndLayer}`}
                onChange={e => {
                  const [s, en] = e.target.value.split('|');
                  setViaStartLayer(s);
                  setViaEndLayer(en);
                }}
              >
                {getValidLayerPairs(viaType, board.layers).map(p => (
                  <option key={`${p.start}|${p.end}`} value={`${p.start}|${p.end}`}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span style={{
                ...styles.paramLabel,
                color: viaType === 'through' ? '#d4a057' :
                       viaType === 'blind' ? '#4090f0' :
                       viaType === 'buried' ? '#40c040' : '#f04040',
                fontWeight: 600,
              }}>
                {viaType === 'through' ? 'THV' :
                 viaType === 'blind' ? 'BVia' :
                 viaType === 'buried' ? 'BurVia' : 'uVia'}
              </span>
            </div>
            <div style={styles.toolSeparator} />
          </>
        )}

        {/* Keepout type picker */}
        {activeTool === 'keepout' && (
          <>
            <div style={styles.toolGroup}>
              <span style={styles.paramLabel}>Type:</span>
              <select
                style={styles.paramSelect}
                value={keepoutType}
                onChange={e => setKeepoutType(e.target.value as KeepoutType)}
              >
                <option value="no_copper">No Copper</option>
                <option value="no_trace">No Trace</option>
                <option value="no_via">No Via</option>
                <option value="no_component">No Component</option>
              </select>
            </div>
            <div style={styles.toolSeparator} />
          </>
        )}

        {/* Differential pair controls */}
        {activeTool === 'diffpair' && (
          <>
            <div style={styles.toolGroup}>
              <span style={styles.paramLabel}>Gap:</span>
              <select
                style={styles.paramSelect}
                value={diffPairGap}
                onChange={e => setDiffPairGap(parseFloat(e.target.value))}
              >
                <option value={0.1}>0.10mm</option>
                <option value={0.15}>0.15mm</option>
                <option value={0.2}>0.20mm</option>
                <option value={0.25}>0.25mm</option>
                <option value={0.3}>0.30mm</option>
                <option value={0.5}>0.50mm</option>
              </select>
              <span style={styles.paramLabel}>P Net:</span>
              <select
                style={{ ...styles.paramSelect, maxWidth: 80 }}
                value={diffPairNetP}
                onChange={e => setDiffPairNetP(e.target.value)}
              >
                <option value="">-- auto --</option>
                {availableNets.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
              <span style={styles.paramLabel}>N Net:</span>
              <select
                style={{ ...styles.paramSelect, maxWidth: 80 }}
                value={diffPairNetN}
                onChange={e => setDiffPairNetN(e.target.value)}
              >
                <option value="">-- auto --</option>
                {availableNets.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
            <div style={styles.toolSeparator} />
          </>
        )}

        {/* Length tuning controls */}
        {activeTool === 'lengthtune' && (
          <>
            <div style={styles.toolGroup}>
              {lengthTuneInfo && (
                <span style={{ ...styles.paramLabel, color: theme.cyan }}>
                  Current: {lengthTuneInfo.length.toFixed(2)}mm
                </span>
              )}
              <span style={styles.paramLabel}>Target:</span>
              <input
                type="number"
                style={{ ...styles.paramSelect, width: 60 }}
                value={lengthTuneTarget}
                step={0.1}
                min={0}
                onChange={e => setLengthTuneTarget(parseFloat(e.target.value) || 0)}
              />
              <span style={styles.paramLabel}>mm</span>
              <span style={styles.paramLabel}>Amp:</span>
              <select
                style={styles.paramSelect}
                value={lengthTuneAmplitude}
                onChange={e => setLengthTuneAmplitude(parseFloat(e.target.value))}
              >
                <option value={0.3}>0.3mm</option>
                <option value={0.5}>0.5mm</option>
                <option value={1.0}>1.0mm</option>
                <option value={1.5}>1.5mm</option>
                <option value={2.0}>2.0mm</option>
              </select>
              <span style={styles.paramLabel}>Style:</span>
              <select
                style={styles.paramSelect}
                value={lengthTuneStyle}
                onChange={e => setLengthTuneStyle(e.target.value as MeanderStyle)}
              >
                <option value="serpentine">Serpentine</option>
                <option value="trombone">Trombone</option>
              </select>
            </div>
            <div style={styles.toolSeparator} />
          </>
        )}

        {/* Grid controls */}
        <div style={styles.toolGroup}>
          <span style={styles.paramLabel}>Grid:</span>
          <select
            style={styles.paramSelect}
            value={gridSpacing}
            onChange={e => setGridSpacing(parseFloat(e.target.value))}
          >
            <option value={0.1}>0.10mm</option>
            <option value={0.25}>0.25mm</option>
            <option value={0.5}>0.50mm</option>
            <option value={1.0}>1.00mm</option>
            <option value={1.27}>1.27mm</option>
            <option value={2.54}>2.54mm</option>
          </select>
          <button
            style={{ ...styles.toggleBtn, ...(showGrid ? styles.toggleBtnActive : {}) }}
            onClick={() => setShowGrid(!showGrid)}
            title="Toggle grid"
          >
            Grid
          </button>
          <button
            style={{ ...styles.toggleBtn, ...(snapToGrid ? styles.toggleBtnActive : {}) }}
            onClick={() => setSnapToGrid(!snapToGrid)}
            title="Toggle snap"
          >
            Snap
          </button>
          <button
            style={{ ...styles.toggleBtn, ...(showRatsnest ? styles.toggleBtnActive : {}) }}
            onClick={() => setShowRatsnest(!showRatsnest)}
            title="Toggle ratsnest"
          >
            Rats
          </button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Right side buttons */}
        <div style={styles.toolGroup}>
          <button style={styles.actionBtn} onClick={() => canvasRef.current?.zoomToFit()} title="Zoom to Fit (H)">
            Fit
          </button>
          <button
            style={{ ...styles.actionBtn, borderColor: theme.yellow, color: theme.yellow }}
            onClick={() => setShowOutlineEditor(true)}
            title="Board Outline Editor"
          >
            Outline
          </button>
          <button
            style={{ ...styles.actionBtn, borderColor: theme.purple, color: theme.purple }}
            onClick={() => setShowStackupEditor(true)}
          >
            Stackup
          </button>
          <button
            style={{ ...styles.actionBtn, borderColor: theme.orange, color: theme.orange }}
            onClick={handleRunDRC}
          >
            DRC
          </button>
          <button
            style={{ ...styles.actionBtn, borderColor: theme.cyan, color: theme.cyan }}
            onClick={() => setShowNetClassEditor(true)}
            title="Net Class Editor"
          >
            Net Classes
          </button>
          <button
            style={{ ...styles.actionBtn, borderColor: theme.cyan, color: theme.cyan }}
            onClick={() => setShowPanelization(true)}
            title="Panelization"
          >
            Panel
          </button>
          <button
            style={{ ...styles.actionBtn, ...styles.exportActionBtn }}
            onClick={() => setShowExportDialog(true)}
          >
            Export
          </button>
          <button
            style={{ ...styles.actionBtn, ...styles.aiActionBtn }}
            onClick={() => setShowAIPanel(!showAIPanel)}
          >
            AI
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={styles.mainArea}>
        {/* Layer panel (left) */}
        <LayerPanel
          layers={layers}
          activeLayer={activeLayer}
          onSetActiveLayer={setActiveLayer}
          onToggleVisibility={handleToggleVisibility}
          onSetOpacity={handleSetOpacity}
          onShowAll={handleShowAll}
          onHideAll={handleHideAll}
        />

        {/* Canvas (center) */}
        <div style={styles.canvasArea}>
          <BoardCanvasGL
            ref={canvasRef}
            board={board}
            layers={layers}
            activeLayer={activeLayer}
            highlightedNet={highlightedNet}
            drcMarkers={drcMarkers}
            ratsnest={ratsnest}
            gridSpacing={gridSpacing}
            gridStyle={gridStyle}
            showGrid={showGrid}
            showRatsnest={showRatsnest}
            showCrosshair={showCrosshair}
            selectionRect={selectionRect}
            measure={measure}
            routingPreview={routingPreview}
            routingWidth={routingWidth}
            zonePreview={zonePreview}
            keepoutPreview={keepoutPreview}
            diffPairPreview={diffPairPreview}
            lengthTuneTraceId={lengthTuneTraceId}
            lengthTuneTarget={lengthTuneTarget}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Tool hint bar */}
          <div style={styles.toolHintBar}>
            {activeTool === 'select' && <span>Click to select | Drag to move | R=Rotate | F=Flip | Del=Delete</span>}
            {activeTool === 'trace' && !isRouting && <span>Click pad or empty space to start routing | X=Route mode</span>}
            {activeTool === 'trace' && isRouting && <span>Click to add segment | V=Insert via | Enter=Finish trace | Esc=Cancel | Click target pad to finish</span>}
            {activeTool === 'via' && <span>Click to place {viaType} via ({viaStartLayer} - {viaEndLayer}) | Select type and layers in toolbar</span>}
            {activeTool === 'zone' && !zonePreview && <span>Click to start zone polygon | Select net from dropdown</span>}
            {activeTool === 'zone' && zonePreview && <span>Click to add point | Click near start to close | Esc=Cancel</span>}
            {activeTool === 'keepout' && !keepoutPreview && <span>Click to start keepout zone | K=Keepout mode | Select type from dropdown</span>}
            {activeTool === 'keepout' && keepoutPreview && <span>Click to add point | Click near start to close | Esc=Cancel</span>}
            {activeTool === 'measure' && <span>Click two points to measure distance</span>}
            {activeTool === 'component' && <span>Click to place component</span>}
            {activeTool === 'diffpair' && !diffPairStart && <span>Click start point for differential pair | D=DiffPair mode | Set gap and nets in toolbar</span>}
            {activeTool === 'diffpair' && diffPairStart && <span>Click end point to complete diff pair | Esc=Cancel</span>}
            {activeTool === 'lengthtune' && !lengthTuneTraceId && <span>Click a trace to select for length tuning | L=LenTune mode</span>}
            {activeTool === 'lengthtune' && lengthTuneTraceId && (
              <span>
                Trace length: {lengthTuneInfo?.length.toFixed(2)}mm | Target: {lengthTuneTarget.toFixed(2)}mm |
                Click trace again to apply meanders | Esc=Cancel
              </span>
            )}
          </div>

          {/* Diff pair preview overlay */}
          {diffPairPreview && (
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 15,
              }}
            >
              {/* These are world-coord lines; actual rendering uses BoardCanvas */}
            </svg>
          )}
        </div>

        {/* Netlist panel (right) */}
        <NetlistPanel
          nets={nets}
          board={board}
          highlightedNet={highlightedNet}
          onHighlightNet={setHighlightedNet}
          onZoomToNet={handleZoomToNet}
          onRouteAll={handleRouteAll}
        />

        {/* DRC Panel (right, overlay) */}
        {showDRCPanel && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 340,
            zIndex: 50,
            boxShadow: '-4px 0 12px rgba(0,0,0,0.3)',
          }}>
            <DesignRuleCheck
              result={drcResult}
              running={drcRunning}
              onRunDRC={handleRunDRC}
              onRunAIReview={() => setShowAIPanel(true)}
              onExportReport={handleDRCExportReport}
              onNavigateTo={handleDRCNavigateTo}
              onSelectElements={handleDRCSelectElements}
            />
            <button
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'none',
                border: 'none',
                color: theme.textMuted,
                fontSize: 16,
                cursor: 'pointer',
                zIndex: 51,
              }}
              onClick={() => setShowDRCPanel(false)}
            >
              {'\u2715'}
            </button>
          </div>
        )}

        {/* AI Panel (right, overlay) */}
        {showAIPanel && (
          <AIPanel
            visible={showAIPanel}
            onClose={() => setShowAIPanel(false)}
          />
        )}
      </div>

      {/* Net Class Editor Dialog */}
      <NetClassEditor
        visible={showNetClassEditor}
        onClose={() => setShowNetClassEditor(false)}
      />

      {/* Stackup Editor Dialog */}
      <StackupEditor
        visible={showStackupEditor}
        onClose={() => setShowStackupEditor(false)}
        onApply={(layers) => projectStore.updateBoard({ layers })}
      />

      {/* Board Outline Editor Dialog */}
      <BoardOutlineEditor
        visible={showOutlineEditor}
        onClose={() => setShowOutlineEditor(false)}
      />

      {/* Gerber Export Dialog */}
      <GerberExport
        board={board}
        visible={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />

      {/* Panelization Dialog */}
      <PanelizationDialog
        board={board}
        visible={showPanelization}
        onClose={() => setShowPanelization(false)}
      />
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: theme.bg0,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    overflow: 'hidden',
  },
  toolbar: {
    height: 38,
    background: theme.bg1,
    borderBottom: theme.border,
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    gap: 4,
    flexShrink: 0,
    zIndex: 100,
  },
  toolGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  toolBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    padding: '3px 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: theme.fontSans,
    transition: 'all 0.1s',
    height: 26,
  },
  toolBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  toolLabel: {
    fontWeight: 500,
  },
  toolShortcut: {
    fontSize: '9px',
    color: theme.textMuted,
    opacity: 0.6,
  },
  toolSeparator: {
    width: 1,
    height: 20,
    background: theme.bg3,
    margin: '0 4px',
  },
  paramLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    marginRight: 4,
  },
  paramSelect: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    padding: '2px 4px',
    cursor: 'pointer',
    fontFamily: theme.fontMono,
    height: 24,
  },
  toggleBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textMuted,
    fontSize: '9px',
    padding: '2px 6px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    fontWeight: 500,
    height: 22,
    transition: 'all 0.1s',
  },
  toggleBtnActive: {
    background: 'rgba(77,158,255,0.15)',
    borderColor: 'rgba(77,158,255,0.4)',
    color: theme.blue,
  },
  actionBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '3px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    height: 26,
  },
  exportActionBtn: {
    borderColor: theme.green,
    color: theme.green,
  },
  aiActionBtn: {
    background: `linear-gradient(135deg, rgba(160,109,255,0.2), rgba(77,158,255,0.2))`,
    borderColor: theme.purple,
    color: theme.purple,
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  toolHintBar: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(20,23,32,0.85)',
    border: theme.border,
    borderRadius: theme.radiusMd,
    padding: '4px 12px',
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    pointerEvents: 'none',
    zIndex: 20,
    whiteSpace: 'nowrap',
  },
};

export default BoardEditor;
