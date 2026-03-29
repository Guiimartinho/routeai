// ─── Editor Zustand Store ──────────────────────────────────────────────────
// UI-ONLY state: tool, viewport, selection, grid, placement, wire drawing,
// cursor, favorites. All schematic DATA and undo/redo live in projectStore.
import { create } from 'zustand';
import type {
  SchTool, Point, LibComponent,
} from '../types';

// ─── Store shape ───────────────────────────────────────────────────────────
export interface EditorState {
  // Tool
  activeTool: SchTool;
  setTool: (t: SchTool) => void;

  // Selection
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;

  // Viewport
  viewportX: number;
  viewportY: number;
  zoom: number;
  setViewport: (x: number, y: number, zoom: number) => void;
  panBy: (dx: number, dy: number) => void;
  zoomTo: (z: number, cx?: number, cy?: number) => void;

  // Grid & Snap
  showGrid: boolean;
  snapToGrid: boolean;
  toggleGrid: () => void;
  toggleSnap: () => void;
  snapPoint: (p: Point) => Point;

  // Component placement
  placingComponent: LibComponent | null;
  placementRotation: number;
  setPlacingComponent: (c: LibComponent | null) => void;
  rotatePlacement: () => void;

  // Wire drawing (transient UI state only — actual wire is saved to projectStore)
  isDrawingWire: boolean;
  wirePoints: Point[];
  startWire: (p: Point) => void;
  addWirePoint: (p: Point) => void;
  finishWire: () => void;
  cancelWire: () => void;

  // Cursor position (schematic coords)
  cursorX: number;
  cursorY: number;
  setCursor: (x: number, y: number) => void;

  // Favorites / recently used
  favorites: string[];
  toggleFavorite: (id: string) => void;
  recentlyUsed: string[];
  addRecentlyUsed: (id: string) => void;
}

const GRID_SIZE = 2.54; // mm = 100mil

function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Tool
  activeTool: 'select',
  setTool: (t) => {
    const s = get();
    if (s.isDrawingWire) s.cancelWire();
    set({ activeTool: t, placingComponent: null });
  },

  // Selection
  selectedIds: [],
  setSelectedIds: (ids) => set({ selectedIds: ids }),
  toggleSelected: (id) => set((s) => {
    const has = s.selectedIds.includes(id);
    return { selectedIds: has ? s.selectedIds.filter(i => i !== id) : [...s.selectedIds, id] };
  }),
  clearSelection: () => set({ selectedIds: [] }),

  // Viewport
  viewportX: 0,
  viewportY: 0,
  zoom: 1,
  setViewport: (x, y, zoom) => set({ viewportX: x, viewportY: y, zoom }),
  panBy: (dx, dy) => set((s) => ({ viewportX: s.viewportX + dx, viewportY: s.viewportY + dy })),
  zoomTo: (z, cx, cy) => set((s) => {
    const newZoom = Math.max(0.05, Math.min(20, z));
    if (cx !== undefined && cy !== undefined) {
      const scale = newZoom / s.zoom;
      return {
        zoom: newZoom,
        viewportX: cx - (cx - s.viewportX) * scale,
        viewportY: cy - (cy - s.viewportY) * scale,
      };
    }
    return { zoom: newZoom };
  }),

  // Grid & Snap
  showGrid: true,
  snapToGrid: true,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  snapPoint: (p) => {
    if (!get().snapToGrid) return p;
    return { x: snap(p.x), y: snap(p.y) };
  },

  // Component placement
  placingComponent: null,
  placementRotation: 0,
  setPlacingComponent: (c) => set({ placingComponent: c, placementRotation: 0, activeTool: c ? 'component' : 'select' }),
  rotatePlacement: () => set((s) => ({ placementRotation: (s.placementRotation + 90) % 360 })),

  // Wire drawing
  isDrawingWire: false,
  wirePoints: [],
  startWire: (p) => set({ isDrawingWire: true, wirePoints: [p] }),
  addWirePoint: (p) => set((s) => ({ wirePoints: [...s.wirePoints, p] })),
  finishWire: () => {
    // Only clear drawing state here. Actual wire saving is done
    // by the SchematicEditor wrapper which writes to projectStore.
    set({ isDrawingWire: false, wirePoints: [] });
  },
  cancelWire: () => set({ isDrawingWire: false, wirePoints: [] }),

  // Cursor
  cursorX: 0,
  cursorY: 0,
  setCursor: (x, y) => set({ cursorX: x, cursorY: y }),

  // Favorites / recently used
  favorites: [],
  toggleFavorite: (id) => set((s) => ({
    favorites: s.favorites.includes(id) ? s.favorites.filter(f => f !== id) : [...s.favorites, id],
  })),
  recentlyUsed: [],
  addRecentlyUsed: (id) => set((s) => ({
    recentlyUsed: [id, ...s.recentlyUsed.filter(r => r !== id)].slice(0, 10),
  })),
}));

export default useEditorStore;
