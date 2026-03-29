import { useEffect, useRef, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { SchTool } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShortcutDef {
  /** Key (lowercase), e.g. 'z', 'delete', '=' */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Action to perform */
  action: () => void;
  /** Description shown in UI */
  description?: string;
  /** Prevent default browser behavior */
  preventDefault?: boolean;
}

export interface UseKeyboardOptions {
  /** Whether keyboard shortcuts are enabled (disable when input is focused) */
  enabled?: boolean;
  /** Additional custom shortcuts */
  extraShortcuts?: ShortcutDef[];
  /** Callbacks */
  onRotate?: () => void;
  onFlip?: () => void;
  onCancel?: () => void;
  onRepeat?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  onSave?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onCut?: () => void;
  onDelete?: () => void;
  onSelectAll?: () => void;
}

// ─── Shortcut key normalization ─────────────────────────────────────────────

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  switch (lower) {
    case ' ': return 'space';
    case 'escape': return 'escape';
    case 'delete': return 'delete';
    case 'backspace': return 'backspace';
    case 'enter': return 'enter';
    case 'arrowup': return 'arrowup';
    case 'arrowdown': return 'arrowdown';
    case 'arrowleft': return 'arrowleft';
    case 'arrowright': return 'arrowright';
    case '+': return '+';
    case '=': return '=';
    case '-': return '-';
    default: return lower;
  }
}

function matchesShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  const key = normalizeKey(e.key);
  if (key !== def.key) return false;
  if (!!def.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (!!def.shift !== e.shiftKey) return false;
  if (!!def.alt !== e.altKey) return false;
  return true;
}

// ─── Tool key map ───────────────────────────────────────────────────────────

const TOOL_KEYS: Record<string, SchTool> = {
  v: 'select',
  w: 'wire',
  c: 'component',
  l: 'label',
  p: 'power',
  x: 'select', // via not in SchTool, default to select
  z: 'select', // zone not in SchTool, default to select
  m: 'measure',
};

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useKeyboard(options: UseKeyboardOptions = {}): void {
  const {
    enabled = true,
    extraShortcuts = [],
    onRotate,
    onFlip,
    onCancel,
    onRepeat,
    onZoomIn,
    onZoomOut,
    onZoomFit,
    onSave,
    onCopy,
    onPaste,
    onCut,
    onDelete,
    onSelectAll,
  } = options;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setTool = useEditorStore((s) => s.setTool);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const cancelWire = useEditorStore((s) => s.cancelWire);
  // Undo/redo and data CRUD come from projectStore (single source of truth)
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const removeComponents = useProjectStore((s) => s.removeSchComponents);
  const removeWires = useProjectStore((s) => s.removeSchWires);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore when typing in input elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Check extra shortcuts first
      for (const def of extraShortcuts) {
        if (matchesShortcut(e, def)) {
          if (def.preventDefault !== false) e.preventDefault();
          def.action();
          return;
        }
      }

      const key = normalizeKey(e.key);
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // ── Ctrl combos ─────────────────────────────────────────

      if (ctrl) {
        switch (key) {
          case 'z':
            e.preventDefault();
            if (shift) {
              redo();
            } else {
              undo();
            }
            return;

          case 'y':
            e.preventDefault();
            redo();
            return;

          case 'c':
            e.preventDefault();
            onCopy?.();
            return;

          case 'v':
            e.preventDefault();
            onPaste?.();
            return;

          case 'x':
            e.preventDefault();
            onCut?.();
            return;

          case 'a':
            e.preventDefault();
            onSelectAll?.();
            return;

          case 's':
            e.preventDefault();
            onSave?.();
            return;

          case '0':
            e.preventDefault();
            onZoomFit?.();
            return;

          case '=':
          case '+':
            e.preventDefault();
            onZoomIn?.();
            return;

          case '-':
            e.preventDefault();
            onZoomOut?.();
            return;

          case 'd':
            e.preventDefault();
            // Duplicate - handled by consuming component
            return;
        }
        return;
      }

      // ── Single key shortcuts ────────────────────────────────

      // Tool switching
      if (TOOL_KEYS[key]) {
        e.preventDefault();
        setTool(TOOL_KEYS[key]);
        return;
      }

      switch (key) {
        case 'r':
          e.preventDefault();
          onRotate?.();
          return;

        case 'f':
          e.preventDefault();
          onFlip?.();
          return;

        case 'escape':
          e.preventDefault();
          cancelWire();
          clearSelection();
          setTool('select');
          onCancel?.();
          return;

        case 'space':
          e.preventDefault();
          onRepeat?.();
          return;

        case 'delete':
        case 'backspace':
          e.preventDefault();
          if (onDelete) {
            onDelete();
          } else if (selectedIds.length > 0) {
            removeComponents(selectedIds);
            removeWires(selectedIds);
          }
          return;

        case 'g':
          e.preventDefault();
          toggleSnap();
          return;

        case 'n':
          // Toggle net highlight (placeholder)
          e.preventDefault();
          return;
      }
    },
    [
      enabled,
      extraShortcuts,
      setTool,
      undo,
      redo,
      clearSelection,
      toggleSnap,
      selectedIds,
      removeComponents,
      removeWires,
      cancelWire,
      onRotate,
      onFlip,
      onCancel,
      onRepeat,
      onZoomIn,
      onZoomOut,
      onZoomFit,
      onSave,
      onCopy,
      onPaste,
      onCut,
      onDelete,
      onSelectAll,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// ─── Shortcut label formatter (for UI display) ─────────────────────────────

export function formatShortcut(def: Partial<ShortcutDef>): string {
  const parts: string[] = [];
  if (def.ctrl) parts.push('Ctrl');
  if (def.shift) parts.push('Shift');
  if (def.alt) parts.push('Alt');
  if (def.key) {
    const k = def.key;
    switch (k) {
      case 'delete': parts.push('Del'); break;
      case 'backspace': parts.push('Bksp'); break;
      case 'escape': parts.push('Esc'); break;
      case 'space': parts.push('Space'); break;
      case 'arrowup': parts.push('\u2191'); break;
      case 'arrowdown': parts.push('\u2193'); break;
      case 'arrowleft': parts.push('\u2190'); break;
      case 'arrowright': parts.push('\u2192'); break;
      default: parts.push(k.toUpperCase()); break;
    }
  }
  return parts.join('+');
}

// ─── All shortcuts (for help display) ───────────────────────────────────────

export const ALL_SHORTCUTS = [
  { key: 'V', description: 'Select tool' },
  { key: 'W', description: 'Wire / Trace tool' },
  { key: 'C', description: 'Place Component' },
  { key: 'L', description: 'Place Label' },
  { key: 'P', description: 'Place Power Symbol' },
  { key: 'X', description: 'Place Via' },
  { key: 'Z', description: 'Draw Zone' },
  { key: 'M', description: 'Measure' },
  { key: 'R', description: 'Rotate selection' },
  { key: 'F', description: 'Flip selection' },
  { key: 'G', description: 'Toggle grid snap' },
  { key: 'Del', description: 'Delete selection' },
  { key: 'Esc', description: 'Cancel / Deselect' },
  { key: 'Space', description: 'Repeat last action' },
  { key: 'Ctrl+Z', description: 'Undo' },
  { key: 'Ctrl+Shift+Z', description: 'Redo' },
  { key: 'Ctrl+Y', description: 'Redo' },
  { key: 'Ctrl+C', description: 'Copy' },
  { key: 'Ctrl+V', description: 'Paste' },
  { key: 'Ctrl+X', description: 'Cut' },
  { key: 'Ctrl+A', description: 'Select all' },
  { key: 'Ctrl+S', description: 'Save' },
  { key: 'Ctrl+D', description: 'Duplicate' },
  { key: 'Ctrl+0', description: 'Zoom to fit' },
  { key: 'Ctrl+=', description: 'Zoom in' },
  { key: 'Ctrl+-', description: 'Zoom out' },
] as const;

export default useKeyboard;
