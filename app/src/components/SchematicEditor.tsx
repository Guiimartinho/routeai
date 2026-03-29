// ─── SchematicEditor.tsx ─ Main schematic editor composition ───────────────
import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { SchComponent, SchWire, SchLabel, BusWire, Point, SchTool, PinType } from '../types';
import { theme } from '../styles/theme';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import SchematicCanvas from './SchematicCanvas';
import ComponentPalette from './ComponentPalette';
import PropertyPanel from './PropertyPanel';
import Toolbar from './Toolbar';
import { SYMBOL_DEFS } from './SymbolLibrary';
import { COMPONENT_LIBRARY } from './ComponentPalette';
import {
  suggestSupportComponents,
  calculateAutoPlacement,
  type ComponentSuggestion,
} from '../engine/componentSuggester';
import { dispatchCrossProbe, type CrossProbeDetail } from '../engine/crossProbe';
import SheetTabs from './SheetTabs';

// ─── Constants ─────────────────────────────────────────────────────────────
const GRID_SIZE = 2.54;
const ZOOM_SPEED = 0.001;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;

// ─── Power symbol choices ──────────────────────────────────────────────────
const POWER_SYMBOLS = [
  { label: 'GND', symbol: 'gnd', value: 'GND' },
  { label: 'VCC', symbol: 'vcc', value: 'VCC' },
  { label: '+3V3', symbol: '3v3', value: '+3V3' },
  { label: '+5V', symbol: '5v', value: '+5V' },
  { label: '+12V', symbol: '12v', value: '+12V' },
  { label: 'VDD', symbol: 'vdd', value: 'VDD' },
  { label: 'VSS', symbol: 'vss', value: 'VSS' },
  { label: 'VBAT', symbol: 'vbat', value: 'VBAT' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function screenToWorld(
  screenX: number, screenY: number,
  vpX: number, vpY: number, zoom: number,
): Point {
  return {
    x: (screenX - vpX) / zoom,
    y: (screenY - vpY) / zoom,
  };
}

// L-shape auto-routing: generate intermediate point for 90-degree wire
function lShapeRoute(from: Point, to: Point): Point[] {
  // Horizontal first, then vertical
  return [from, { x: to.x, y: from.y }, to];
}

// ─── Ref counter for component references ──────────────────────────────────
const refCounters: Record<string, number> = {};

const REF_PREFIX_MAP: Record<string, string> = {
  resistor: 'R', capacitor: 'C', capacitor_polarized: 'C',
  inductor: 'L', diode: 'D', led: 'D', zener: 'D', schottky: 'D', tvs: 'D', bridge: 'D',
  npn: 'Q', pnp: 'Q', nmos: 'Q', pmos: 'Q', igbt: 'Q',
  opamp: 'U', ic: 'U', connector: 'J', connector_2: 'J', connector_4: 'J',
  crystal: 'Y', fuse: 'F', ferrite: 'FB', switch: 'SW',
  gnd: '#PWR', vcc: '#PWR', '3v3': '#PWR', '5v': '#PWR', '12v': '#PWR',
  vdd: '#PWR', vss: '#PWR', vbat: '#PWR',
};

function nextRef(symbol: string): string {
  const prefix = REF_PREFIX_MAP[symbol] || 'U';
  refCounters[prefix] = (refCounters[prefix] || 0) + 1;
  return `${prefix}${refCounters[prefix]}`;
}

// Initialize refCounters from existing components so loaded projects don't collide
function initRefCountersFromComponents(components: SchComponent[]) {
  // Reset all counters
  for (const key of Object.keys(refCounters)) {
    delete refCounters[key];
  }
  for (const comp of components) {
    // Parse ref like "R5", "U12", "SW3" etc.
    const match = comp.ref.match(/^([A-Za-z#]+)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const num = parseInt(match[2], 10);
      if (!refCounters[prefix] || refCounters[prefix] < num) {
        refCounters[prefix] = num;
      }
    }
  }
}

// ─── Suggestion Popup ─────────────────────────────────────────────────────
interface SuggestionPopupProps {
  x: number;
  y: number;
  icRef: string;
  icValue: string;
  suggestions: ComponentSuggestion[];
  onAddSelected: (selected: ComponentSuggestion[]) => void;
  onDismiss: () => void;
}

const suggestionStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute' as const,
    zIndex: 2000,
    background: theme.bg2,
    border: `1px solid ${theme.blue}`,
    borderRadius: '6px',
    padding: '12px',
    minWidth: '340px',
    maxWidth: '480px',
    maxHeight: '420px',
    overflowY: 'auto' as const,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    fontFamily: theme.fontSans,
    fontSize: theme.fontSm,
    color: theme.textPrimary,
  },
  title: {
    fontSize: '13px',
    fontWeight: 700,
    color: theme.blue,
    marginBottom: '8px',
    borderBottom: `1px solid ${theme.bg3}`,
    paddingBottom: '6px',
  },
  subtitle: {
    fontSize: '11px',
    color: theme.textSecondary,
    marginBottom: '8px',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  checkbox: {
    accentColor: theme.blue,
    cursor: 'pointer',
  },
  itemRole: {
    color: theme.textSecondary,
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    minWidth: '80px',
  },
  itemValue: {
    color: theme.green,
    fontWeight: 600,
    fontFamily: theme.fontMono,
    minWidth: '60px',
  },
  itemSymbol: {
    color: theme.textMuted,
    fontSize: '11px',
    minWidth: '60px',
  },
  itemReason: {
    color: theme.textSecondary,
    fontSize: '10px',
    lineHeight: '1.3',
    flex: 1,
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    justifyContent: 'flex-end',
  },
  btnPrimary: {
    padding: '5px 14px',
    background: theme.blue,
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
  },
  btnSecondary: {
    padding: '5px 14px',
    background: 'transparent',
    color: theme.textSecondary,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  selectAll: {
    color: theme.blue,
    cursor: 'pointer',
    fontSize: '11px',
    background: 'none',
    border: 'none',
    padding: 0,
    textDecoration: 'underline',
    marginRight: 'auto',
  },
};

const SuggestionPopup: React.FC<SuggestionPopupProps> = ({
  x, y, icRef, icValue, suggestions, onAddSelected, onDismiss,
}) => {
  const [checked, setChecked] = React.useState<boolean[]>(() =>
    suggestions.map(() => true)
  );

  const toggleItem = (idx: number) => {
    setChecked(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  };

  const toggleAll = () => {
    const allChecked = checked.every(Boolean);
    setChecked(suggestions.map(() => !allChecked));
  };

  const handleAdd = () => {
    const selected = suggestions.filter((_, i) => checked[i]);
    if (selected.length > 0) {
      onAddSelected(selected);
    }
    onDismiss();
  };

  const selectedCount = checked.filter(Boolean).length;

  // Group by role for display
  const groupedDisplay: { role: string; items: { suggestion: ComponentSuggestion; index: number }[] }[] = [];
  const roleOrder: string[] = [];
  suggestions.forEach((s, i) => {
    const role = s.component.role;
    if (!roleOrder.includes(role)) {
      roleOrder.push(role);
      groupedDisplay.push({ role, items: [] });
    }
    const group = groupedDisplay.find(g => g.role === role)!;
    group.items.push({ suggestion: s, index: i });
  });

  // Clamp position to stay visible
  const left = Math.min(x, window.innerWidth - 500);
  const top = Math.min(y, window.innerHeight - 450);

  return (
    <div style={{ ...suggestionStyles.overlay, left, top }} onClick={e => e.stopPropagation()}>
      <div style={suggestionStyles.title}>
        Recommended components for {icRef} ({icValue})
      </div>
      <div style={suggestionStyles.subtitle}>
        Based on datasheet requirements. {suggestions.length} component{suggestions.length !== 1 ? 's' : ''} needed.
      </div>

      {groupedDisplay.map(group => (
        <div key={group.role}>
          {group.items.map(({ suggestion: s, index: i }) => (
            <div key={i} style={suggestionStyles.itemRow}>
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={() => toggleItem(i)}
                style={suggestionStyles.checkbox}
              />
              <span style={suggestionStyles.itemRole}>
                {s.component.role.replace(/_/g, ' ')}
              </span>
              <span style={suggestionStyles.itemValue}>
                {s.component.value}
              </span>
              <span style={suggestionStyles.itemSymbol}>
                {s.component.symbol} ({s.component.footprint})
              </span>
              <span style={suggestionStyles.itemReason} title={s.component.reason}>
                {s.component.pinRef ? `[${s.component.pinRef}] ` : ''}
                {s.component.reason.length > 80
                  ? s.component.reason.slice(0, 77) + '...'
                  : s.component.reason}
              </span>
            </div>
          ))}
        </div>
      ))}

      <div style={suggestionStyles.buttonRow}>
        <button style={suggestionStyles.selectAll} onClick={toggleAll}>
          {checked.every(Boolean) ? 'Deselect all' : 'Select all'}
        </button>
        <button style={suggestionStyles.btnSecondary} onClick={onDismiss}>
          Dismiss
        </button>
        <button style={suggestionStyles.btnPrimary} onClick={handleAdd}>
          Add Selected ({selectedCount})
        </button>
      </div>
    </div>
  );
};

// ─── Clipboard type that holds components, wires, and labels ────────────────
interface ClipboardData {
  components: SchComponent[];
  wires: SchWire[];
  labels: SchLabel[];
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: theme.bg0,
    overflow: 'hidden',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  canvasWrap: {
    flex: 1,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  statusBar: {
    height: theme.statusBarHeight,
    background: theme.bg1,
    borderTop: theme.border,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.sp3}`,
    gap: theme.sp4,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textMuted,
    userSelect: 'none',
    flexShrink: 0,
  },
  statusItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp1,
  },
  statusTool: {
    color: theme.blue,
    fontWeight: 600,
  },
  statusValue: {
    color: theme.textSecondary,
  },
  contextMenu: {
    position: 'absolute' as const,
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusMd,
    boxShadow: theme.shadowLg,
    padding: `${theme.sp1} 0`,
    zIndex: 1000,
    minWidth: '160px',
  },
  contextItem: {
    padding: `${theme.sp1} ${theme.sp3}`,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'background 0.08s',
  },
  contextShortcut: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    marginLeft: theme.sp4,
  },
  contextSep: {
    height: '1px',
    background: theme.bg3,
    margin: `${theme.sp1} 0`,
  },
  powerPopup: {
    position: 'absolute' as const,
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusMd,
    boxShadow: theme.shadowLg,
    padding: `${theme.sp1} 0`,
    zIndex: 1001,
    minWidth: '120px',
  },
  powerItem: {
    padding: `${theme.sp1} ${theme.sp3}`,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    cursor: 'pointer',
    transition: 'background 0.08s',
  },
};

// ─── Context Menu ──────────────────────────────────────────────────────────
interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: string) => void;
  hasSelection: boolean;
}

function ContextMenu({ x, y, onClose, onAction, hasSelection }: ContextMenuProps): React.ReactElement {
  const items = [
    ...(hasSelection ? [
      { label: 'Cut', shortcut: 'Ctrl+X', action: 'cut' },
      { label: 'Copy', shortcut: 'Ctrl+C', action: 'copy' },
      { label: 'Delete', shortcut: 'Del', action: 'delete' },
      { label: 'Rotate', shortcut: 'R', action: 'rotate' },
      { label: 'Flip', shortcut: 'F', action: 'flip' },
      { type: 'sep' as const },
    ] : []),
    { label: 'Paste', shortcut: 'Ctrl+V', action: 'paste' },
    { type: 'sep' as const },
    { label: 'Select All', shortcut: 'Ctrl+A', action: 'selectAll' },
    { label: 'Zoom to Fit', shortcut: '', action: 'zoomFit' },
  ];

  return (
    <div
      style={{ ...styles.contextMenu, left: x, top: y }}
      onMouseLeave={onClose}
    >
      {items.map((item, i) => {
        if ('type' in item && item.type === 'sep') {
          return <div key={i} style={styles.contextSep} />;
        }
        const it = item as { label: string; shortcut: string; action: string };
        return (
          <div
            key={i}
            style={styles.contextItem}
            onClick={() => { onAction(it.action); onClose(); }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span>{it.label}</span>
            {it.shortcut && <span style={styles.contextShortcut}>{it.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Power Symbol Popup ─────────────────────────────────────────────────────
interface PowerPopupProps {
  x: number;
  y: number;
  onSelect: (symbol: string, value: string) => void;
  onClose: () => void;
}

function PowerPopup({ x, y, onSelect, onClose }: PowerPopupProps): React.ReactElement {
  const [customName, setCustomName] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div
      style={{ ...styles.powerPopup, left: x, top: y }}
      onMouseLeave={onClose}
    >
      {POWER_SYMBOLS.map((ps) => (
        <div
          key={ps.symbol}
          style={styles.powerItem}
          onClick={() => onSelect(ps.symbol, ps.value)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {ps.label}
        </div>
      ))}
      <div style={styles.contextSep} />
      {!showCustom ? (
        <div
          style={styles.powerItem}
          onClick={() => setShowCustom(true)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          Custom...
        </div>
      ) : (
        <div style={{ padding: `${theme.sp1} ${theme.sp3}`, display: 'flex', gap: '4px' }}>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Name"
            autoFocus
            style={{
              width: '70px',
              background: theme.bg0,
              border: theme.border,
              borderRadius: theme.radiusSm,
              color: theme.textPrimary,
              fontSize: theme.fontXs,
              padding: '2px 4px',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customName.trim()) {
                onSelect('vcc', customName.trim());
              }
            }}
          />
          <button
            onClick={() => {
              if (customName.trim()) {
                onSelect('vcc', customName.trim());
              }
            }}
            style={{
              background: theme.blue,
              border: 'none',
              borderRadius: theme.radiusSm,
              color: '#fff',
              fontSize: theme.fontXs,
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Editor Component ─────────────────────────────────────────────────
interface SchematicEditorProps {
  crossProbeRef?: { source: 'sch' | 'board'; ref: string } | null;
}

const SchematicEditor: React.FC<SchematicEditorProps> = ({ crossProbeRef }) => {
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  // Drag state (component move)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);

  // Selection box
  const [selBox, setSelBox] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Power popup state
  const [powerPopup, setPowerPopup] = useState<{ x: number; y: number; worldPt: Point } | null>(null);
  const [selectedPowerSymbol, setSelectedPowerSymbol] = useState<{ symbol: string; value: string }>({ symbol: 'gnd', value: 'GND' });

  // Clipboard (local) - now includes components, wires, and labels
  const clipboardRef = useRef<ClipboardData>({ components: [], wires: [], labels: [] });

  // Last placed component for Space repeat
  const lastPlacedRef = useRef<string | null>(null);

  // Component suggestion popup state
  const [suggestionPopup, setSuggestionPopup] = useState<{
    x: number;
    y: number;
    icRef: string;
    icValue: string;
    icX: number;
    icY: number;
    suggestions: ComponentSuggestion[];
  } | null>(null);

  // Bus wires: persisted in projectStore, drawing state is local
  const [isDrawingBus, setIsDrawingBus] = useState(false);
  const [busPoints, setBusPoints] = useState<Point[]>([]);

  // NoConnect markers: persisted in projectStore (removed local state)

  // Measure tool state
  const [measureStart, setMeasureStart] = useState<Point | null>(null);
  const [measureLine, setMeasureLine] = useState<{ from: Point; to: Point; distMm: number } | null>(null);

  // UI-only state from editorStore
  const store = useEditorStore();
  const {
    activeTool, setTool,
    selectedIds, setSelectedIds, toggleSelected, clearSelection,
    viewportX, viewportY, zoom, panBy, zoomTo, setViewport,
    showGrid, snapToGrid, snapPoint,
    placingComponent, setPlacingComponent, placementRotation, rotatePlacement,
    isDrawingWire, wirePoints, startWire, addWirePoint, finishWire: _editorFinishWire, cancelWire,
    setCursor, cursorX, cursorY,
    addRecentlyUsed,
  } = store;

  // Wrap finishWire to save wire to projectStore with validation
  const finishWire = useCallback(() => {
    const pts = useEditorStore.getState().wirePoints;
    if (pts.length >= 2) {
      // Remove degenerate consecutive points (< 0.1mm apart)
      const cleaned: Point[] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const prev = cleaned[cleaned.length - 1];
        if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) > 0.1) {
          cleaned.push(pts[i]);
        }
      }
      if (cleaned.length >= 2) {
        const wire: SchWire = {
          id: 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          points: cleaned,
        };
        useProjectStore.getState().addSchWire(wire);
      }
    }
    _editorFinishWire(); // clears drawing state
  }, [_editorFinishWire]);

  // DATA from projectStore (unified, persisted, netlisted)
  const proj = useProjectStore();
  const components = proj.schematic.components;
  const wires = proj.schematic.wires;
  const labels = proj.schematic.labels;
  const busWires = proj.schematic.busWires;
  const noConnects = proj.schematic.noConnects;
  const addComponent = proj.addSchComponent;
  const updateComponent = (id: string, patch: Partial<SchComponent>) => proj.updateSchComponent(id, patch);
  const removeComponents = (ids: string[]) => proj.removeSchComponents(ids);
  const removeWires = (ids: string[]) => proj.removeSchWires(ids);
  const removeLabels = (ids: string[]) => proj.removeSchLabels(ids);
  const moveComponents = (ids: string[], dx: number, dy: number) => proj.moveSchComponents(ids, dx, dy);
  const moveComponentsIncremental = (ids: string[], dx: number, dy: number) => proj.moveSchComponentsIncremental(ids, dx, dy);
  const addBusWire = proj.addBusWire;
  const addNoConnect = proj.addNoConnect;
  const undo = proj.undo;
  const redo = proj.redo;
  const canUndo = proj.canUndo;
  const canRedo = proj.canRedo;

  // ─── Initialize refCounters when components change (e.g., project load) ──
  const prevCompCountRef = useRef(0);
  useEffect(() => {
    // Detect a project load: components appeared from empty, or a large batch changed
    if (components.length > 0 && prevCompCountRef.current === 0) {
      initRefCountersFromComponents(components);
    }
    prevCompCountRef.current = components.length;
  }, [components]);

  // ─── Resize observer ──────────────────────────────────────────────────
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setCanvasSize({
          w: entry.contentRect.width,
          h: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ─── Cross-probe: highlight incoming ref from board ──────────────────
  useEffect(() => {
    if (!crossProbeRef || crossProbeRef.source !== 'board') return;
    // Find the schematic component with this ref and select it
    const comp = components.find(c => c.ref === crossProbeRef.ref);
    if (comp) {
      setSelectedIds([comp.id]);
    }
  }, [crossProbeRef, components, setSelectedIds]);

  // ─── Screen-to-world helper ───────────────────────────────────────────
  const toWorld = useCallback((screenX: number, screenY: number): Point => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(screenX - rect.left, screenY - rect.top, viewportX, viewportY, zoom);
  }, [viewportX, viewportY, zoom]);

  const toWorldSnapped = useCallback((screenX: number, screenY: number): Point => {
    const p = toWorld(screenX, screenY);
    if (snapToGrid) {
      return { x: snap(p.x), y: snap(p.y) };
    }
    return p;
  }, [toWorld, snapToGrid]);

  // ─── Pin snap: when drawing wires, snap to the nearest pin if close ──
  const PIN_SNAP_RADIUS = 3.0; // mm — snap to pin if cursor is within this radius

  // Check if a point is near any component pin
  const isNearAnyPin = useCallback((pt: Point, comps: SchComponent[]): boolean => {
    for (const comp of comps) {
      const rad = (comp.rotation * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      for (const pin of comp.pins) {
        const rx = pin.x * cosR - pin.y * sinR;
        const ry = pin.x * sinR + pin.y * cosR;
        const d = Math.hypot(pt.x - (comp.x + rx), pt.y - (comp.y + ry));
        if (d < PIN_SNAP_RADIUS) return true;
      }
    }
    return false;
  }, []);

  const snapToPin = useCallback((worldPt: Point): Point => {
    let bestDist = PIN_SNAP_RADIUS;
    let bestPt = worldPt;

    for (const comp of components) {
      const rad = (comp.rotation * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      for (const pin of comp.pins) {
        // Compute absolute pin position (rotated + translated)
        const rx = pin.x * cosR - pin.y * sinR;
        const ry = pin.x * sinR + pin.y * cosR;
        const absPinX = comp.x + rx;
        const absPinY = comp.y + ry;
        const d = Math.hypot(worldPt.x - absPinX, worldPt.y - absPinY);
        if (d < bestDist) {
          bestDist = d;
          bestPt = { x: snap(absPinX), y: snap(absPinY) };
        }
      }
    }
    return bestPt;
  }, [components]);

  // ─── Ghost preview for placement ─────────────────────────────────────
  const ghostComponent = useMemo(() => {
    if (!placingComponent) return null;
    return {
      type: placingComponent.symbol,
      x: snapToGrid ? snap(cursorX) : cursorX,
      y: snapToGrid ? snap(cursorY) : cursorY,
      rotation: placementRotation,
      pinCount: placingComponent.pins?.length || 0,
      kicadSymbol: placingComponent.kicadSymbol,
    };
  }, [placingComponent, cursorX, cursorY, placementRotation, snapToGrid]);

  // ─── Ghost wire preview ──────────────────────────────────────────────
  const ghostWirePoints = useMemo(() => {
    if (!isDrawingWire || wirePoints.length === 0) return undefined;
    const lastPt = wirePoints[wirePoints.length - 1];
    const curPt = snapToGrid ? { x: snap(cursorX), y: snap(cursorY) } : { x: cursorX, y: cursorY };
    return lShapeRoute(lastPt, curPt);
  }, [isDrawingWire, wirePoints, cursorX, cursorY, snapToGrid]);

  // ─── Selection box in world coords ───────────────────────────────────
  const selectionBox = useMemo(() => {
    if (!selBox) return null;
    const x = Math.min(selBox.sx, selBox.cx);
    const y = Math.min(selBox.sy, selBox.cy);
    const w = Math.abs(selBox.cx - selBox.sx);
    const h = Math.abs(selBox.cy - selBox.sy);
    return { x, y, w, h };
  }, [selBox]);

  // ─── Find element at position ────────────────────────────────────────
  const findComponentAt = useCallback((p: Point): SchComponent | null => {
    const hitRadius = 15;
    for (let i = components.length - 1; i >= 0; i--) {
      const c = components[i];
      if (Math.abs(c.x - p.x) < hitRadius && Math.abs(c.y - p.y) < hitRadius) {
        return c;
      }
    }
    return null;
  }, [components]);

  // ─── Place power symbol helper ────────────────────────────────────────
  const placePowerSymbol = useCallback((worldPt: Point, symbolType: string, value: string) => {
    const def = SYMBOL_DEFS[symbolType];
    const pins = (def?.pins || []).map((p) => ({
      id: uid('pin'),
      name: p.name,
      number: p.number,
      x: p.x,
      y: p.y,
      type: p.type,
    }));
    const comp: SchComponent = {
      id: uid('comp'),
      type: symbolType,
      ref: nextRef(symbolType),
      value,
      x: worldPt.x,
      y: worldPt.y,
      rotation: 0,
      pins,
      symbol: symbolType,
      footprint: '',
    };
    addComponent(comp);
  }, [addComponent]);

  // ─── Mouse handlers ──────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Skip second click of double-click to prevent duplicate wire points
    if (e.detail >= 2) return;

    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Close context menu
    setContextMenu(null);

    // Middle button = pan
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Right button handled by context menu
    if (e.button === 2) return;

    // Left button
    const worldPt = toWorldSnapped(e.clientX, e.clientY);

    if (activeTool === 'component' && placingComponent) {
      // Place component — use KiCad symbol pins if available, else fall back
      const hasKiCad = !!placingComponent.kicadSymbol;
      const def = SYMBOL_DEFS[placingComponent.symbol];
      const pinSource = hasKiCad
        ? placingComponent.kicadSymbol!.pins.map((kp) => ({
            name: kp.name,
            number: kp.number,
            x: kp.x,
            y: kp.y,
            type: (kp.type === 'bidirectional' ? 'bidirectional'
              : kp.type === 'input' ? 'input'
              : kp.type === 'output' ? 'output'
              : kp.type === 'power' ? 'power'
              : 'passive') as PinType,
          }))
        : (def?.pins || placingComponent.pins);
      const pins = pinSource.map((p, i) => ({
        id: uid('pin'),
        name: p.name,
        number: p.number,
        x: p.x,
        y: p.y,
        type: p.type,
      }));

      const comp: SchComponent = {
        id: uid('comp'),
        type: placingComponent.symbol,
        ref: nextRef(placingComponent.symbol),
        value: placingComponent.name,
        x: worldPt.x,
        y: worldPt.y,
        rotation: placementRotation,
        pins,
        symbol: placingComponent.symbol,
        footprint: placingComponent.footprint,
        kicadSymbol: placingComponent.kicadSymbol,
      };
      addComponent(comp);
      lastPlacedRef.current = placingComponent.id;

      // Check for datasheet-based support component suggestions
      const currentComponents = useProjectStore.getState().schematic.components;
      const suggestions = suggestSupportComponents(comp, currentComponents);
      console.log('[SUGGEST]', comp.value, '→', suggestions.length, 'suggestions', suggestions.map(s => s.component.role + ':' + s.component.value));
      if (suggestions.length > 0) {
        const rect = canvasWrapRef.current?.getBoundingClientRect();
        const popupX = rect ? (e.clientX - rect.left + 20) : 200;
        const popupY = rect ? (e.clientY - rect.top - 10) : 100;
        setSuggestionPopup({
          x: popupX,
          y: popupY,
          icRef: comp.ref,
          icValue: comp.value,
          icX: comp.x,
          icY: comp.y,
          suggestions,
        });
      }

      // Don't clear placing - allow repeated placement
      return;
    }

    if (activeTool === 'wire') {
      // Snap to nearest component pin for reliable connections
      const snappedPt = snapToPin(worldPt);

      if (!isDrawingWire) {
        // START wire
        startWire(snappedPt);
      } else {
        // CONTINUE or FINISH wire
        const lastPt = wirePoints[wirePoints.length - 1];

        // Check if we landed on a pin (different from start) → auto-finish
        const startPt = wirePoints[0];
        const landedOnPin = isNearAnyPin(snappedPt, components);
        const isBackAtStart = Math.hypot(snappedPt.x - startPt.x, snappedPt.y - startPt.y) < 0.5;

        // Add L-shape waypoint
        const midPt = { x: snappedPt.x, y: lastPt.y };
        if (Math.abs(midPt.x - lastPt.x) > 0.5 || Math.abs(midPt.y - lastPt.y) > 0.5) {
          addWirePoint(midPt);
        }
        addWirePoint(snappedPt);

        // Auto-finish if we landed on a different pin
        if (landedOnPin && !isBackAtStart) {
          finishWire();
        }
      }
      return;
    }

    if (activeTool === 'bus') {
      if (!isDrawingBus) {
        setIsDrawingBus(true);
        setBusPoints([worldPt]);
      } else {
        const lastPt = busPoints[busPoints.length - 1];
        const midPt = { x: worldPt.x, y: lastPt.y };
        const newPoints = [...busPoints];
        if (Math.abs(midPt.x - lastPt.x) > 0.5 || Math.abs(midPt.y - lastPt.y) > 0.5) {
          newPoints.push(midPt);
        }
        newPoints.push(worldPt);
        setBusPoints(newPoints);
      }
      return;
    }

    if (activeTool === 'label') {
      const text = prompt('Enter label text:');
      if (text) {
        const label: SchLabel = {
          id: uid('lbl'),
          text,
          x: worldPt.x,
          y: worldPt.y,
          type: 'local',
        };
        proj.addSchLabel(label);
      }
      return;
    }

    if (activeTool === 'power') {
      // Show power popup to choose symbol
      setPowerPopup({ x: sx, y: sy, worldPt });
      return;
    }

    if (activeTool === 'noconnect') {
      // Place an X marker at the clicked position (persisted in store)
      addNoConnect(worldPt);
      return;
    }

    if (activeTool === 'measure') {
      if (!measureStart) {
        setMeasureStart(worldPt);
        setMeasureLine(null);
      } else {
        const dx = worldPt.x - measureStart.x;
        const dy = worldPt.y - measureStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        setMeasureLine({ from: measureStart, to: worldPt, distMm: dist });
        setMeasureStart(null);
      }
      return;
    }

    if (activeTool === 'select') {
      // Check if clicking on empty space => start selection box
      const hitComp = findComponentAt(toWorld(e.clientX, e.clientY));
      if (!hitComp && !e.shiftKey) {
        clearSelection();
        // Start selection box
        const wp = toWorld(e.clientX, e.clientY);
        setSelBox({ sx: wp.x, sy: wp.y, cx: wp.x, cy: wp.y });
      }
    }
  }, [
    activeTool, placingComponent, placementRotation, isDrawingWire, wirePoints,
    toWorldSnapped, toWorld, addComponent, startWire, addWirePoint,
    clearSelection, findComponentAt, snapToGrid, store,
    isDrawingBus, busPoints, measureStart, placePowerSymbol,
    finishWire, snapToPin, isNearAnyPin, components,
    addNoConnect, addBusWire,
  ]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Update cursor coords
    const wp = toWorld(e.clientX, e.clientY);
    const snapped = snapToGrid ? { x: snap(wp.x), y: snap(wp.y) } : wp;
    setCursor(snapped.x, snapped.y);

    // Panning
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      panBy(dx, dy);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    // Dragging components — use incremental move (no undo push per frame)
    if (isDragging && dragStart) {
      const curWorld = toWorldSnapped(e.clientX, e.clientY);
      const dx = curWorld.x - dragStart.x;
      const dy = curWorld.y - dragStart.y;
      if (Math.abs(dx) >= GRID_SIZE || Math.abs(dy) >= GRID_SIZE) {
        moveComponentsIncremental(selectedIds, dx, dy);
        setDragStart(curWorld);
      }
      return;
    }

    // Selection box
    if (selBox) {
      const wp2 = toWorld(e.clientX, e.clientY);
      setSelBox(prev => prev ? { ...prev, cx: wp2.x, cy: wp2.y } : null);
      return;
    }
  }, [isPanning, panStart, isDragging, dragStart, selBox, toWorld, toWorldSnapped, snapToGrid, setCursor, panBy, moveComponentsIncremental, selectedIds]);

  const handleMouseUp = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (isDragging) {
      setIsDragging(false);
      setDragStart(null);
      return;
    }

    // Finish selection box - now includes labels
    if (selBox) {
      const box = selectionBox;
      if (box && (box.w > 2 || box.h > 2)) {
        const inBox = components.filter(c =>
          c.x >= box.x && c.x <= box.x + box.w &&
          c.y >= box.y && c.y <= box.y + box.h
        ).map(c => c.id);
        const wiresInBox = wires.filter(w =>
          w.points.some(p =>
            p.x >= box.x && p.x <= box.x + box.w &&
            p.y >= box.y && p.y <= box.y + box.h
          )
        ).map(w => w.id);
        const labelsInBox = labels.filter(l =>
          l.x >= box.x && l.x <= box.x + box.w &&
          l.y >= box.y && l.y <= box.y + box.h
        ).map(l => l.id);
        setSelectedIds([...inBox, ...wiresInBox, ...labelsInBox]);
      }
      setSelBox(null);
      return;
    }
  }, [isPanning, isDragging, selBox, selectionBox, components, wires, labels, setSelectedIds]);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const delta = -e.deltaY * ZOOM_SPEED;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (1 + delta)));
    zoomTo(newZoom, mx, my);
  }, [zoom, zoomTo]);

  const handleContextMenu = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  // ─── Component interaction handlers ──────────────────────────────────
  const handleComponentMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);

    if (activeTool === 'select') {
      if (e.shiftKey) {
        toggleSelected(id);
      } else if (!selectedIds.includes(id)) {
        setSelectedIds([id]);
      }
      // Start drag — push undo snapshot once here (not on every move increment)
      moveComponents(selectedIds.length > 0 ? selectedIds : [id], 0, 0);
      const wp = toWorldSnapped(e.clientX, e.clientY);
      setIsDragging(true);
      setDragStart(wp);
    }
  }, [activeTool, selectedIds, setSelectedIds, toggleSelected, toWorldSnapped, moveComponents]);

  const handleWireMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);

    if (activeTool === 'select') {
      if (e.shiftKey) {
        toggleSelected(id);
      } else {
        setSelectedIds([id]);
      }
    }
  }, [activeTool, setSelectedIds, toggleSelected]);

  // ─── Double-click to finish wire or bus, or cross-probe ────────────────
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'wire' && isDrawingWire) {
      // Remove duplicate points added by the two mouseDown events of double-click
      finishWire();
      return; // Prevent further processing
    }
    if (activeTool === 'bus' && isDrawingBus) {
      if (busPoints.length >= 2) {
        const bw: BusWire = {
          id: 'bus_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          points: [...busPoints],
        };
        addBusWire(bw);
      }
      setIsDrawingBus(false);
      setBusPoints([]);
      return;
    }

    // Cross-probe: double-click on a component dispatches cross-probe event
    if (activeTool === 'select') {
      const worldPt = toWorld(e.clientX, e.clientY);
      const hitComp = findComponentAt(worldPt);
      if (hitComp) {
        dispatchCrossProbe({ source: 'sch', ref: hitComp.ref });
      }
    }
  }, [activeTool, isDrawingWire, finishWire, isDrawingBus, busPoints, toWorld, findComponentAt, addBusWire]);

  // ─── Power popup selection handler ──────────────────────────────────
  const handlePowerSelect = useCallback((symbol: string, value: string) => {
    if (powerPopup) {
      placePowerSymbol(powerPopup.worldPt, symbol, value);
      setSelectedPowerSymbol({ symbol, value });
    }
    setPowerPopup(null);
  }, [powerPopup, placePowerSymbol]);

  // ─── Context menu actions ────────────────────────────────────────────
  const handleContextAction = useCallback((action: string) => {
    switch (action) {
      case 'delete': {
        const compIds = selectedIds.filter(id => components.some(c => c.id === id));
        const wireIds = selectedIds.filter(id => wires.some(w => w.id === id));
        const labelIds = selectedIds.filter(id => labels.some(l => l.id === id));
        if (compIds.length) removeComponents(compIds);
        if (wireIds.length) removeWires(wireIds);
        if (labelIds.length) removeLabels(labelIds);
        break;
      }
      case 'rotate': {
        selectedIds.forEach(id => {
          const c = components.find(c => c.id === id);
          if (c) updateComponent(id, { rotation: (c.rotation + 90) % 360 });
        });
        break;
      }
      case 'flip': {
        // True horizontal mirror: negate pin X positions
        selectedIds.forEach(id => {
          const c = components.find(comp => comp.id === id);
          if (c) {
            const mirroredPins = c.pins.map(p => ({
              ...p,
              x: -p.x,
            }));
            updateComponent(id, { pins: mirroredPins });
          }
        });
        break;
      }
      case 'copy': {
        // Copy selected components, wires, and labels
        const selComps = components
          .filter(c => selectedIds.includes(c.id))
          .map(c => JSON.parse(JSON.stringify(c)));
        const selWires = wires
          .filter(w => selectedIds.includes(w.id))
          .map(w => JSON.parse(JSON.stringify(w)));
        const selLabels = labels
          .filter(l => selectedIds.includes(l.id))
          .map(l => JSON.parse(JSON.stringify(l)));
        clipboardRef.current = { components: selComps, wires: selWires, labels: selLabels };
        break;
      }
      case 'cut': {
        const selComps = components
          .filter(c => selectedIds.includes(c.id))
          .map(c => JSON.parse(JSON.stringify(c)));
        const selWires = wires
          .filter(w => selectedIds.includes(w.id))
          .map(w => JSON.parse(JSON.stringify(w)));
        const selLabels = labels
          .filter(l => selectedIds.includes(l.id))
          .map(l => JSON.parse(JSON.stringify(l)));
        clipboardRef.current = { components: selComps, wires: selWires, labels: selLabels };
        const compIds = selectedIds.filter(id => components.some(c => c.id === id));
        const wireIds = selectedIds.filter(id => wires.some(w => w.id === id));
        const labelIds = selectedIds.filter(id => labels.some(l => l.id === id));
        if (compIds.length) removeComponents(compIds);
        if (wireIds.length) removeWires(wireIds);
        if (labelIds.length) removeLabels(labelIds);
        break;
      }
      case 'paste': {
        const offset = 10;
        const newIds: string[] = [];
        // Paste components
        clipboardRef.current.components.forEach(c => {
          const newId = uid('comp');
          newIds.push(newId);
          addComponent({
            ...c,
            id: newId,
            ref: nextRef(c.symbol),
            x: c.x + offset,
            y: c.y + offset,
            pins: c.pins.map((p: any) => ({ ...p, id: uid('pin') })),
          });
        });
        // Paste wires
        clipboardRef.current.wires.forEach(w => {
          const newId = uid('wire');
          newIds.push(newId);
          proj.addSchWire({
            ...w,
            id: newId,
            points: w.points.map((p: Point) => ({ x: p.x + offset, y: p.y + offset })),
          });
        });
        // Paste labels
        clipboardRef.current.labels.forEach(l => {
          const newId = uid('lbl');
          newIds.push(newId);
          proj.addSchLabel({
            ...l,
            id: newId,
            x: l.x + offset,
            y: l.y + offset,
          });
        });
        setSelectedIds(newIds);
        break;
      }
      case 'selectAll': {
        setSelectedIds([
          ...components.map(c => c.id),
          ...wires.map(w => w.id),
          ...labels.map(l => l.id),
        ]);
        break;
      }
      case 'zoomFit': {
        zoomTo(1);
        setViewport(canvasSize.w / 2, canvasSize.h / 2, 1);
        break;
      }
    }
  }, [
    selectedIds, components, wires, labels,
    removeComponents, removeWires, removeLabels,
    updateComponent, addComponent, setSelectedIds,
    zoomTo, setViewport, canvasSize, store,
  ]);

  // ─── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl shortcuts
      if (ctrl) {
        switch (e.key.toLowerCase()) {
          case 'z':
            e.preventDefault();
            undo();
            return;
          case 'y':
            e.preventDefault();
            redo();
            return;
          case 'c':
            e.preventDefault();
            handleContextAction('copy');
            return;
          case 'x':
            e.preventDefault();
            handleContextAction('cut');
            return;
          case 'v':
            e.preventDefault();
            handleContextAction('paste');
            return;
          case 'a':
            e.preventDefault();
            handleContextAction('selectAll');
            return;
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'v':
          setTool('select');
          break;
        case 'w':
          setTool('wire');
          break;
        case 'c':
          setTool('component');
          break;
        case 'l':
          setTool('label');
          break;
        case 'p':
          setTool('power');
          break;
        case 'b':
          setTool('bus');
          break;
        case 'n':
          setTool('noconnect');
          break;
        case 'm':
          setTool('measure');
          break;
        case 'r':
          if (placingComponent) {
            rotatePlacement();
          } else {
            handleContextAction('rotate');
          }
          break;
        case 'f':
          handleContextAction('flip');
          break;
        case 'escape':
          if (isDrawingWire) {
            cancelWire();
          } else if (isDrawingBus) {
            if (busPoints.length >= 2) {
              const bw: BusWire = {
                id: 'bus_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                points: [...busPoints],
              };
              addBusWire(bw);
            }
            setIsDrawingBus(false);
            setBusPoints([]);
          } else if (placingComponent) {
            setPlacingComponent(null);
          } else if (measureStart) {
            setMeasureStart(null);
            setMeasureLine(null);
          } else if (powerPopup) {
            setPowerPopup(null);
          } else {
            clearSelection();
          }
          break;
        case 'delete':
        case 'backspace':
          handleContextAction('delete');
          break;
        case ' ':
          e.preventDefault();
          // Repeat last component placement
          if (lastPlacedRef.current) {
            const lib = COMPONENT_LIBRARY.find(c => c.id === lastPlacedRef.current);
            if (lib) {
              setPlacingComponent(lib);
              addRecentlyUsed(lib.id);
            }
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    undo, redo, setTool, placingComponent, rotatePlacement,
    isDrawingWire, cancelWire, clearSelection, setPlacingComponent,
    handleContextAction, addRecentlyUsed, isDrawingBus, busPoints,
    measureStart, powerPopup, addBusWire,
  ]);

  // ─── Drop handler for drag-from-palette ──────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/eda-component');
    if (!data) return;
    try {
      const libComp = JSON.parse(data);
      setPlacingComponent(libComp);
      addRecentlyUsed(libComp.id);

      // Place immediately at drop location
      const wp = toWorldSnapped(e.clientX, e.clientY);
      const def = SYMBOL_DEFS[libComp.symbol];
      const pins = (def?.pins || libComp.pins || []).map((p: any) => ({
        id: uid('pin'),
        name: p.name,
        number: p.number,
        x: p.x,
        y: p.y,
        type: p.type,
      }));
      const comp: SchComponent = {
        id: uid('comp'),
        type: libComp.symbol,
        ref: nextRef(libComp.symbol),
        value: libComp.name,
        x: wp.x,
        y: wp.y,
        rotation: 0,
        pins,
        symbol: libComp.symbol,
        footprint: libComp.footprint,
        kicadSymbol: libComp.kicadSymbol,
      };
      addComponent(comp);
      lastPlacedRef.current = libComp.id;
      setPlacingComponent(null);

      // Check for datasheet-based support component suggestions
      const currentComponents = useProjectStore.getState().schematic.components;
      const dropSuggestions = suggestSupportComponents(comp, currentComponents);
      if (dropSuggestions.length > 0) {
        const dropRect = canvasWrapRef.current?.getBoundingClientRect();
        const popupX = dropRect ? (e.clientX - dropRect.left + 20) : 200;
        const popupY = dropRect ? (e.clientY - dropRect.top - 10) : 100;
        setSuggestionPopup({
          x: popupX,
          y: popupY,
          icRef: comp.ref,
          icValue: comp.value,
          icX: comp.x,
          icY: comp.y,
          suggestions: dropSuggestions,
        });
      }
    } catch { /* ignore */ }
  }, [toWorldSnapped, addComponent, setPlacingComponent, addRecentlyUsed]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // ─── Handle adding suggested support components ──────────────────────
  const handleAddSuggested = useCallback((selected: ComponentSuggestion[]) => {
    if (!suggestionPopup || selected.length === 0) return;

    // Extract values before async forEach to avoid stale closure
    const icX = suggestionPopup.icX;
    const icY = suggestionPopup.icY;

    const positions = calculateAutoPlacement(
      { id: '', type: '', ref: '', value: '', x: icX, y: icY, rotation: 0, pins: [], symbol: '', footprint: '' },
      selected.length,
    );

    selected.forEach((s, idx) => {
      const pos = positions[idx] || { x: icX + 50, y: icY + idx * 20 };
      const def = SYMBOL_DEFS[s.component.symbol];
      const pins = (def?.pins || []).map(p => ({
        id: uid('pin'),
        name: p.name,
        number: p.number,
        x: p.x,
        y: p.y,
        type: p.type,
      }));

      const comp: SchComponent = {
        id: uid('comp'),
        type: s.component.symbol,
        ref: nextRef(s.component.symbol),
        value: s.component.value,
        x: pos.x,
        y: pos.y,
        rotation: 0,
        pins,
        symbol: s.component.symbol,
        footprint: s.component.footprint,
      };
      addComponent(comp);
    });

    setSuggestionPopup(null);
  }, [suggestionPopup, addComponent]);

  // ─── Tool name display ───────────────────────────────────────────────
  const toolNames: Record<SchTool, string> = {
    select: 'Select',
    wire: 'Wire',
    component: 'Component',
    label: 'Label',
    power: 'Power',
    bus: 'Bus',
    noconnect: 'No Connect',
    measure: 'Measure',
  };

  return (
    <div className="schematic-editor-container" style={styles.container}>
      {/* Toolbar */}
      <Toolbar />

      {/* Body: palette + canvas + properties */}
      <div style={styles.body}>
        {/* Left: Component Palette */}
        <ComponentPalette />

        {/* Center: Canvas */}
        <div
          ref={canvasWrapRef}
          style={styles.canvasWrap}
          onDoubleClick={handleDoubleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <SchematicCanvas
            width={canvasSize.w}
            height={canvasSize.h}
            components={components}
            wires={wires}
            labels={labels}
            selectedIds={selectedIds}
            hoveredId={hoveredId}
            viewportX={viewportX}
            viewportY={viewportY}
            zoom={zoom}
            showGrid={showGrid}
            ghostComponent={ghostComponent}
            ghostWirePoints={ghostWirePoints}
            selectionBox={selectionBox}
            busWires={busWires}
            noConnects={noConnects}
            measureLine={measureLine}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
            onComponentMouseDown={handleComponentMouseDown}
            onWireMouseDown={handleWireMouseDown}
          />

          {/* Context menu overlay */}
          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              onAction={handleContextAction}
              hasSelection={selectedIds.length > 0}
            />
          )}

          {/* Power symbol popup */}
          {powerPopup && (
            <PowerPopup
              x={powerPopup.x}
              y={powerPopup.y}
              onSelect={handlePowerSelect}
              onClose={() => setPowerPopup(null)}
            />
          )}

          {/* Datasheet-based component suggestion popup */}
          {suggestionPopup && (
            <SuggestionPopup
              x={suggestionPopup.x}
              y={suggestionPopup.y}
              icRef={suggestionPopup.icRef}
              icValue={suggestionPopup.icValue}
              suggestions={suggestionPopup.suggestions}
              onAddSelected={handleAddSuggested}
              onDismiss={() => setSuggestionPopup(null)}
            />
          )}
        </div>

        {/* Right: Property Panel */}
        <PropertyPanel />
      </div>

      {/* Sheet Tabs */}
      <SheetTabs />

      {/* Status Bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusItem}>
          <span>Tool:</span>
          <span style={styles.statusTool}>{toolNames[activeTool]}</span>
        </div>
        <div style={styles.statusItem}>
          <span>X:</span>
          <span style={styles.statusValue}>{cursorX.toFixed(2)}mm</span>
          <span>Y:</span>
          <span style={styles.statusValue}>{cursorY.toFixed(2)}mm</span>
        </div>
        <div style={styles.statusItem}>
          <span>Selected:</span>
          <span style={styles.statusValue}>{selectedIds.length}</span>
        </div>
        <div style={styles.statusItem}>
          <span>Zoom:</span>
          <span style={styles.statusValue}>{Math.round(zoom * 100)}%</span>
        </div>
        <div style={styles.statusItem}>
          <span>Components:</span>
          <span style={styles.statusValue}>{components.length}</span>
        </div>
        <div style={styles.statusItem}>
          <span>Wires:</span>
          <span style={styles.statusValue}>{wires.length}</span>
        </div>
        {isDrawingWire && (
          <div style={{ ...styles.statusItem, color: theme.schWire }}>
            Drawing wire ({wirePoints.length} points) - Click to add, Double-click to finish, Esc to cancel
          </div>
        )}
        {isDrawingBus && (
          <div style={{ ...styles.statusItem, color: theme.schBus }}>
            Drawing bus ({busPoints.length} points) - Click to add, Double-click to finish, Esc to cancel
          </div>
        )}
        {measureStart && (
          <div style={{ ...styles.statusItem, color: theme.highlightColor }}>
            Measure: click second point (Esc to cancel)
          </div>
        )}
        {placingComponent && (
          <div style={{ ...styles.statusItem, color: theme.blue }}>
            Placing: {placingComponent.name} - Click to place, R to rotate, Esc to cancel
          </div>
        )}
      </div>
    </div>
  );
};

export default SchematicEditor;
