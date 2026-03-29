/**
 * SchematicEditor - Main schematic editing workspace.
 *
 * Provides an SVG-based 2D schematic canvas with:
 * - Grid with configurable snap
 * - Pan (middle-click drag) and zoom (scroll wheel)
 * - Tool modes: select, wire, component, label, bus, power
 * - Wire drawing: click start -> route -> click end
 * - Component placement: drag from library
 * - Selection: click, drag box, multi-select with Shift
 * - Delete selected with Delete key
 * - Undo/redo with Ctrl+Z / Ctrl+Y
 * - Keyboard shortcuts overlay
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MousePointer,
  Minus,
  Square,
  Type,
  GitBranch,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  Scissors,
  Clipboard,
  RotateCw,
  FlipHorizontal,
  Grid as GridIcon,
  Keyboard,
  Save,
  Upload,
} from 'lucide-react';
import SchematicCanvas from './SchematicCanvas';
import {
  useSchematicStore,
  type SchematicPoint,
  type ToolMode,
  type SchematicLabel,
  type PowerSymbol,
} from '../../stores/schematicStore';

// ---------------------------------------------------------------------------
// Keyboard shortcuts definition
// ---------------------------------------------------------------------------

const SHORTCUTS = [
  { key: 'S', description: 'Select tool' },
  { key: 'W', description: 'Wire tool' },
  { key: 'C', description: 'Component tool' },
  { key: 'L', description: 'Label tool' },
  { key: 'B', description: 'Bus tool' },
  { key: 'P', description: 'Power symbol tool' },
  { key: 'R', description: 'Rotate selected' },
  { key: 'X', description: 'Mirror selected' },
  { key: 'Delete', description: 'Delete selected' },
  { key: 'Escape', description: 'Cancel / Deselect' },
  { key: 'Ctrl+Z', description: 'Undo' },
  { key: 'Ctrl+Y', description: 'Redo' },
  { key: 'Ctrl+C', description: 'Copy' },
  { key: 'Ctrl+X', description: 'Cut' },
  { key: 'Ctrl+V', description: 'Paste' },
  { key: 'Ctrl+A', description: 'Select all' },
  { key: 'Ctrl+S', description: 'Save' },
  { key: 'F', description: 'Fit to view' },
  { key: 'G', description: 'Toggle grid' },
  { key: '?', description: 'Show shortcuts' },
];

// ---------------------------------------------------------------------------
// Tool button
// ---------------------------------------------------------------------------

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}

function ToolButton({ icon, label, shortcut, active, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
        active
          ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
          : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 border border-transparent'
      }`}
      title={`${label} (${shortcut})`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SchematicEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartWorld, setDragStartWorld] = useState<SchematicPoint | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ start: SchematicPoint; end: SchematicPoint } | null>(null);
  const [dragElementId, setDragElementId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<SchematicPoint>({ x: 0, y: 0 });
  const [mouseWorldPos, setMouseWorldPos] = useState<SchematicPoint>({ x: 0, y: 0 });

  const toolMode = useSchematicStore((s) => s.toolMode);
  const setToolMode = useSchematicStore((s) => s.setToolMode);
  const gridSize = useSchematicStore((s) => s.gridSize);
  const showGrid = useSchematicStore((s) => s.showGrid);
  const snapToGrid = useSchematicStore((s) => s.snapToGrid);
  const viewportOffset = useSchematicStore((s) => s.viewportOffset);
  const viewportZoom = useSchematicStore((s) => s.viewportZoom);
  const selectedIds = useSchematicStore((s) => s.selectedIds);
  const undoStack = useSchematicStore((s) => s.undoStack);
  const redoStack = useSchematicStore((s) => s.redoStack);

  // -----------------------------------------------------------------------
  // Resize observer
  // -----------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Coordinate conversion
  // -----------------------------------------------------------------------

  const screenToWorld = useCallback(
    (sx: number, sy: number): SchematicPoint => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: sx, y: sy };
      const canvasX = sx - rect.left;
      const canvasY = sy - rect.top;
      return {
        x: (canvasX - viewportOffset.x) / viewportZoom,
        y: (canvasY - viewportOffset.y) / viewportZoom,
      };
    },
    [viewportOffset, viewportZoom],
  );

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            useSchematicStore.getState().undo();
            return;
          case 'y':
            e.preventDefault();
            useSchematicStore.getState().redo();
            return;
          case 'c':
            e.preventDefault();
            useSchematicStore.getState().copySelected();
            return;
          case 'x':
            e.preventDefault();
            useSchematicStore.getState().cutSelected();
            return;
          case 'v':
            e.preventDefault();
            useSchematicStore.getState().paste(mouseWorldPos);
            return;
          case 'a':
            e.preventDefault();
            useSchematicStore.getState().selectAll();
            return;
          case 's':
            e.preventDefault();
            // Export schematic data
            const data = useSchematicStore.getState().exportSchematic();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'schematic.json';
            a.click();
            URL.revokeObjectURL(url);
            return;
        }
      }

      switch (e.key.toLowerCase()) {
        case 's':
          if (!ctrl) setToolMode('select');
          break;
        case 'w':
          setToolMode('wire');
          break;
        case 'c':
          if (!ctrl) setToolMode('component');
          break;
        case 'l':
          setToolMode('label');
          break;
        case 'b':
          setToolMode('bus');
          break;
        case 'p':
          setToolMode('power');
          break;
        case 'r':
          selectedIds.forEach((id) => {
            useSchematicStore.getState().rotateComponent(id);
          });
          break;
        case 'x':
          if (!ctrl) {
            selectedIds.forEach((id) => {
              useSchematicStore.getState().mirrorComponent(id);
            });
          }
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          useSchematicStore.getState().deleteSelected();
          break;
        case 'escape':
          useSchematicStore.getState().deselectAll();
          useSchematicStore.getState().cancelWireDrawing();
          useSchematicStore.getState().cancelPlacement();
          setToolMode('select');
          break;
        case 'f':
          useSchematicStore.getState().fitToView();
          break;
        case 'g':
          useSchematicStore.getState().setShowGrid(!showGrid);
          break;
        case '?':
          setShowShortcuts((v) => !v);
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setToolMode, selectedIds, showGrid, mouseWorldPos]);

  // -----------------------------------------------------------------------
  // Mouse handlers
  // -----------------------------------------------------------------------

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      setMouseWorldPos(worldPos);

      // Middle click: start panning
      if (e.button === 1) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // Right click: nothing for now
      if (e.button === 2) return;

      // Left click behaviors by tool mode
      const state = useSchematicStore.getState();

      switch (toolMode) {
        case 'select':
          // Start drag-selection rectangle
          state.deselectAll();
          setIsDragging(true);
          setDragStartWorld(worldPos);
          setSelectionRect({ start: worldPos, end: worldPos });
          break;

        case 'wire':
          if (state.wireDrawing) {
            // Continue wire: finalize this segment and continue
            state.finalizeWireSegment(worldPos);
          } else {
            state.startWireDrawing(worldPos);
          }
          break;

        case 'component':
          if (state.placingComponent) {
            state.updatePlacingPosition(worldPos);
            state.finalizePlacement();
          }
          break;

        case 'label': {
          const text = prompt('Enter net label:');
          if (text) {
            const label: SchematicLabel = {
              id: `label_${Date.now()}`,
              text,
              position: state.snapPoint(worldPos),
              rotation: 0,
              type: 'net',
              netId: null,
              selected: false,
            };
            state.addLabel(label);
          }
          break;
        }

        case 'power': {
          const name = prompt('Power net name (e.g., VCC, GND):');
          if (name) {
            const typeMap: Record<string, PowerSymbol['type']> = {
              vcc: 'vcc', vdd: 'vdd', vee: 'vee', gnd: 'gnd', gnda: 'gnda',
            };
            const lower = name.toLowerCase();
            const pType = typeMap[lower] || 'custom';
            const ps: PowerSymbol = {
              id: `power_${Date.now()}`,
              type: pType,
              name,
              position: state.snapPoint(worldPos),
              rotation: 0,
              netId: null,
              selected: false,
            };
            state.addPowerSymbol(ps);
          }
          break;
        }
      }
    },
    [screenToWorld, toolMode],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const worldPos = screenToWorld(e.clientX, e.clientY);
      setMouseWorldPos(worldPos);

      // Handle panning
      if (isPanning && panStart) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        useSchematicStore.getState().pan(dx, dy);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // Handle drag-select rectangle
      if (isDragging && dragStartWorld) {
        setSelectionRect({ start: dragStartWorld, end: worldPos });
        return;
      }

      // Handle dragging a selected element
      if (dragElementId) {
        const state = useSchematicStore.getState();
        const comp = state.components.get(dragElementId);
        if (comp) {
          state.moveComponent(dragElementId, {
            x: worldPos.x - dragOffset.x,
            y: worldPos.y - dragOffset.y,
          });
        }
        const label = state.labels.get(dragElementId);
        if (label) {
          state.moveLabel(dragElementId, {
            x: worldPos.x - dragOffset.x,
            y: worldPos.y - dragOffset.y,
          });
        }
        const ps = state.powerSymbols.get(dragElementId);
        if (ps) {
          state.movePowerSymbol(dragElementId, {
            x: worldPos.x - dragOffset.x,
            y: worldPos.y - dragOffset.y,
          });
        }
        return;
      }

      // Wire preview
      if (useSchematicStore.getState().wireDrawing) {
        useSchematicStore.getState().updateWirePreview(worldPos);
        return;
      }

      // Component placement preview
      if (useSchematicStore.getState().placingComponent) {
        useSchematicStore.getState().updatePlacingPosition(worldPos);
      }
    },
    [screenToWorld, isPanning, panStart, isDragging, dragStartWorld, dragElementId, dragOffset],
  );

  const handleCanvasMouseUp = useCallback(
    (e: React.MouseEvent) => {
      // End panning
      if (isPanning) {
        setIsPanning(false);
        setPanStart(null);
        return;
      }

      // End drag selection
      if (isDragging && selectionRect) {
        const tl = {
          x: Math.min(selectionRect.start.x, selectionRect.end.x),
          y: Math.min(selectionRect.start.y, selectionRect.end.y),
        };
        const br = {
          x: Math.max(selectionRect.start.x, selectionRect.end.x),
          y: Math.max(selectionRect.start.y, selectionRect.end.y),
        };
        const width = br.x - tl.x;
        const height = br.y - tl.y;
        if (width > 2 || height > 2) {
          useSchematicStore.getState().selectInRect(tl, br, e.shiftKey);
        }
        setIsDragging(false);
        setDragStartWorld(null);
        setSelectionRect(null);
        return;
      }

      // End element dragging
      if (dragElementId) {
        useSchematicStore.getState().pushHistory();
        setDragElementId(null);
        setDragOffset({ x: 0, y: 0 });
      }
    },
    [isPanning, isDragging, selectionRect, dragElementId],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const center = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      useSchematicStore.getState().zoom(factor, center);
    },
    [],
  );

  const handleElementMouseDown = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;

      const state = useSchematicStore.getState();

      // Wire tool: double-click on wire endpoint to finish
      if (toolMode === 'wire' && state.wireDrawing) {
        const worldPos = screenToWorld(e.clientX, e.clientY);
        state.finalizeWireSegment(worldPos);
        state.finishWireDrawing();
        return;
      }

      if (toolMode !== 'select') return;

      // Select the element
      state.select(id, e.shiftKey);

      // Start dragging
      const worldPos = screenToWorld(e.clientX, e.clientY);
      const comp = state.components.get(id);
      if (comp) {
        setDragElementId(id);
        setDragOffset({ x: worldPos.x - comp.position.x, y: worldPos.y - comp.position.y });
      }
      const label = state.labels.get(id);
      if (label) {
        setDragElementId(id);
        setDragOffset({ x: worldPos.x - label.position.x, y: worldPos.y - label.position.y });
      }
      const ps = state.powerSymbols.get(id);
      if (ps) {
        setDragElementId(id);
        setDragOffset({ x: worldPos.x - ps.position.x, y: worldPos.y - ps.position.y });
      }
      // Wires: just select, no drag
    },
    [toolMode, screenToWorld],
  );

  // Double-click to finish wire
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (toolMode === 'wire') {
        const state = useSchematicStore.getState();
        if (state.wireDrawing) {
          const worldPos = screenToWorld(e.clientX, e.clientY);
          state.finalizeWireSegment(worldPos);
          state.finishWireDrawing();
        }
      }
    },
    [toolMode, screenToWorld],
  );

  // Prevent context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const toolModes: { mode: ToolMode; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { mode: 'select', icon: <MousePointer className="w-3.5 h-3.5" />, label: 'Select', shortcut: 'S' },
    { mode: 'wire', icon: <Minus className="w-3.5 h-3.5" />, label: 'Wire', shortcut: 'W' },
    { mode: 'component', icon: <Square className="w-3.5 h-3.5" />, label: 'Component', shortcut: 'C' },
    { mode: 'label', icon: <Type className="w-3.5 h-3.5" />, label: 'Label', shortcut: 'L' },
    { mode: 'bus', icon: <GitBranch className="w-3.5 h-3.5" />, label: 'Bus', shortcut: 'B' },
    { mode: 'power', icon: <Zap className="w-3.5 h-3.5" />, label: 'Power', shortcut: 'P' },
  ];

  return (
    <div className="flex flex-col w-full h-full bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-900 border-b border-gray-800">
        {/* Tool modes */}
        <div className="flex items-center gap-1 mr-3">
          {toolModes.map((t) => (
            <ToolButton
              key={t.mode}
              icon={t.icon}
              label={t.label}
              shortcut={t.shortcut}
              active={toolMode === t.mode}
              onClick={() => setToolMode(t.mode)}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Edit actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useSchematicStore.getState().undo()}
            disabled={undoStack.length === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useSchematicStore.getState().redo()}
            disabled={redoStack.length === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Clipboard */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useSchematicStore.getState().copySelected()}
            disabled={selectedIds.size === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Copy (Ctrl+C)"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useSchematicStore.getState().cutSelected()}
            disabled={selectedIds.size === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Cut (Ctrl+X)"
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useSchematicStore.getState().paste(mouseWorldPos)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Paste (Ctrl+V)"
          >
            <Clipboard className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useSchematicStore.getState().deleteSelected()}
            disabled={selectedIds.size === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-red-400 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Delete (Del)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Transform */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => selectedIds.forEach((id) => useSchematicStore.getState().rotateComponent(id))}
            disabled={selectedIds.size === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Rotate (R)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => selectedIds.forEach((id) => useSchematicStore.getState().mirrorComponent(id))}
            disabled={selectedIds.size === 0}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Mirror (X)"
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1" />

        {/* Grid / View controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useSchematicStore.getState().setShowGrid(!showGrid)}
            className={`p-1.5 rounded-md transition-colors ${
              showGrid ? 'text-blue-400 bg-blue-600/20' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
            }`}
            title="Toggle Grid (G)"
          >
            <GridIcon className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1 bg-gray-800/60 rounded-md px-2 py-0.5">
            <span className="text-[10px] text-gray-500">Grid:</span>
            <select
              value={gridSize}
              onChange={(e) => useSchematicStore.getState().setGridSize(Number(e.target.value))}
              className="bg-transparent text-xs text-gray-300 outline-none cursor-pointer"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
          <label className="flex items-center gap-1 text-[10px] text-gray-500 ml-1 cursor-pointer">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => useSchematicStore.getState().setSnapToGrid(e.target.checked)}
              className="w-3 h-3 accent-blue-500"
            />
            Snap
          </label>
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => useSchematicStore.getState().zoom(1.3, { x: containerSize.width / 2, y: containerSize.height / 2 })}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-gray-500 min-w-[32px] text-center">
            {Math.round(viewportZoom * 100)}%
          </span>
          <button
            onClick={() => useSchematicStore.getState().zoom(1 / 1.3, { x: containerSize.width / 2, y: containerSize.height / 2 })}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useSchematicStore.getState().fitToView()}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Fit to View (F)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* File operations */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const data = useSchematicStore.getState().exportSchematic();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'schematic.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const text = await file.text();
                try {
                  const data = JSON.parse(text);
                  useSchematicStore.getState().importSchematic(data);
                } catch {
                  alert('Invalid schematic file');
                }
              };
              input.click();
            }}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Load"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700/60 transition-colors"
            title="Keyboard Shortcuts (?)"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <SchematicCanvas
          width={containerSize.width}
          height={containerSize.height}
          selectionRect={selectionRect}
          onElementMouseDown={handleElementMouseDown}
          onCanvasMouseDown={handleCanvasMouseDown}
          onCanvasMouseMove={handleCanvasMouseMove}
          onCanvasMouseUp={handleCanvasMouseUp}
          onWheel={handleWheel}
        />

        {/* Status bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-1 bg-gray-900/90 border-t border-gray-800 text-[10px] text-gray-500">
          <div className="flex items-center gap-4">
            <span>
              X: {mouseWorldPos.x.toFixed(1)} Y: {mouseWorldPos.y.toFixed(1)}
            </span>
            <span>
              Grid: {gridSize} | Snap: {snapToGrid ? 'ON' : 'OFF'}
            </span>
            <span>
              Tool: {toolMode.charAt(0).toUpperCase() + toolMode.slice(1)}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span>Selected: {selectedIds.size}</span>
            <span>Zoom: {Math.round(viewportZoom * 100)}%</span>
          </div>
        </div>

        {/* Keyboard shortcuts overlay */}
        {showShortcuts && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-200">Keyboard Shortcuts</h3>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="text-gray-400 hover:text-gray-200 text-lg leading-none"
                >
                  x
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {SHORTCUTS.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{s.description}</span>
                    <kbd className="ml-2 px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-300 font-mono">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
