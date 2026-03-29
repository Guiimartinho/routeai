// ─── Toolbar.tsx ─ Top toolbar ─────────────────────────────────────────────
import React, { useCallback, useState } from 'react';
import type { SchTool } from '../types';
import { theme } from '../styles/theme';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import DRCConfigDialog from './DRCConfigDialog';

// ─── Icon SVGs (inline, no dependencies) ──────────────────────────────────
function IconSelect() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 1L3 13L7 9L11 13L13 11L9 7L13 3L3 1Z" fill={theme.textPrimary} stroke={theme.textPrimary} strokeWidth="0.5"/>
    </svg>
  );
}
function IconWire() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 14L2 8L14 8L14 2" stroke={theme.schWire} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="2" cy="14" r="1.5" fill={theme.schWire}/>
      <circle cx="14" cy="2" r="1.5" fill={theme.schWire}/>
    </svg>
  );
}
function IconComponent() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="4" width="10" height="8" rx="1" stroke={theme.schComponentBorder} strokeWidth="1.2"/>
      <line x1="1" y1="7" x2="3" y2="7" stroke={theme.schPinColor} strokeWidth="1"/>
      <line x1="1" y1="10" x2="3" y2="10" stroke={theme.schPinColor} strokeWidth="1"/>
      <line x1="13" y1="8" x2="15" y2="8" stroke={theme.schPinColor} strokeWidth="1"/>
    </svg>
  );
}
function IconLabel() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <polygon points="1,4 11,4 14,8 11,12 1,12" fill="none" stroke={theme.blue} strokeWidth="1.2"/>
      <text x="5" y="9.5" fontSize="6" fill={theme.blue} fontFamily="sans-serif">A</text>
    </svg>
  );
}
function IconPower() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="8" y1="14" x2="8" y2="5" stroke={theme.schComponentBorder} strokeWidth="1.2"/>
      <polygon points="8,2 5,7 11,7" fill={theme.schComponentBorder}/>
    </svg>
  );
}
function IconDelete() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="3" y1="3" x2="13" y2="13" stroke={theme.red} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="13" y1="3" x2="3" y2="13" stroke={theme.red} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
function IconUndo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 6L2 8L4 10" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 8H10C12.2 8 14 9.8 14 12" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
function IconRedo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M12 6L14 8L12 10" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M14 8H6C3.8 8 2 9.8 2 12" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}
function IconZoomIn() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke={theme.textSecondary} strokeWidth="1.2"/>
      <line x1="11" y1="11" x2="14" y2="14" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="5" y1="7" x2="9" y2="7" stroke={theme.textSecondary} strokeWidth="1"/>
      <line x1="7" y1="5" x2="7" y2="9" stroke={theme.textSecondary} strokeWidth="1"/>
    </svg>
  );
}
function IconZoomOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="5" stroke={theme.textSecondary} strokeWidth="1.2"/>
      <line x1="11" y1="11" x2="14" y2="14" stroke={theme.textSecondary} strokeWidth="1.2" strokeLinecap="round"/>
      <line x1="5" y1="7" x2="9" y2="7" stroke={theme.textSecondary} strokeWidth="1"/>
    </svg>
  );
}
function IconGrid() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="4" y1="1" x2="4" y2="15" stroke={theme.textMuted} strokeWidth="0.8"/>
      <line x1="8" y1="1" x2="8" y2="15" stroke={theme.textMuted} strokeWidth="0.8"/>
      <line x1="12" y1="1" x2="12" y2="15" stroke={theme.textMuted} strokeWidth="0.8"/>
      <line x1="1" y1="4" x2="15" y2="4" stroke={theme.textMuted} strokeWidth="0.8"/>
      <line x1="1" y1="8" x2="15" y2="8" stroke={theme.textMuted} strokeWidth="0.8"/>
      <line x1="1" y1="12" x2="15" y2="12" stroke={theme.textMuted} strokeWidth="0.8"/>
    </svg>
  );
}
function IconSnap() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="3" width="4" height="4" fill={theme.textMuted}/>
      <rect x="9" y="3" width="4" height="4" fill={theme.textMuted}/>
      <rect x="3" y="9" width="4" height="4" fill={theme.textMuted}/>
      <rect x="9" y="9" width="4" height="4" fill={theme.textMuted}/>
      <circle cx="8" cy="8" r="1.5" fill={theme.blue}/>
    </svg>
  );
}
function IconMeasure() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="13" x2="14" y2="13" stroke={theme.textSecondary} strokeWidth="1"/>
      <line x1="2" y1="11" x2="2" y2="15" stroke={theme.textSecondary} strokeWidth="1"/>
      <line x1="14" y1="11" x2="14" y2="15" stroke={theme.textSecondary} strokeWidth="1"/>
      <line x1="5" y1="12" x2="5" y2="14" stroke={theme.textSecondary} strokeWidth="0.8"/>
      <line x1="8" y1="12" x2="8" y2="14" stroke={theme.textSecondary} strokeWidth="0.8"/>
      <line x1="11" y1="12" x2="11" y2="14" stroke={theme.textSecondary} strokeWidth="0.8"/>
      <text x="8" y="9" fontSize="5" fill={theme.textSecondary} textAnchor="middle" fontFamily="sans-serif">12.7</text>
    </svg>
  );
}
function IconBus() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <line x1="2" y1="4" x2="14" y2="4" stroke={theme.schBus} strokeWidth="2"/>
      <line x1="4" y1="4" x2="4" y2="12" stroke={theme.schBus} strokeWidth="1"/>
      <line x1="8" y1="4" x2="8" y2="12" stroke={theme.schBus} strokeWidth="1"/>
      <line x1="12" y1="4" x2="12" y2="12" stroke={theme.schBus} strokeWidth="1"/>
    </svg>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    height: theme.toolbarHeight,
    background: theme.bg1,
    borderBottom: theme.border,
    display: 'flex',
    alignItems: 'center',
    padding: `0 ${theme.sp2}`,
    gap: '2px',
    userSelect: 'none',
    flexShrink: 0,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '30px',
    height: '28px',
    border: 'none',
    borderRadius: theme.radiusSm,
    background: 'transparent',
    cursor: 'pointer',
    position: 'relative' as const,
    transition: 'background 0.1s',
  },
  btnActive: {
    background: theme.blueDim,
    boxShadow: `inset 0 0 0 1px ${theme.blue}`,
  },
  btnDisabled: {
    opacity: 0.35,
    cursor: 'default',
  },
  separator: {
    width: '1px',
    height: '20px',
    background: theme.bg3,
    margin: `0 ${theme.sp1}`,
    flexShrink: 0,
  },
  shortcutLabel: {
    position: 'absolute' as const,
    bottom: '1px',
    right: '2px',
    fontSize: '7px',
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    pointerEvents: 'none' as const,
  },
  zoomDisplay: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    fontFamily: theme.fontMono,
    minWidth: '48px',
    textAlign: 'center' as const,
    padding: `0 ${theme.sp1}`,
  },
  coordDisplay: {
    fontSize: theme.fontSm,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    marginLeft: 'auto',
    padding: `0 ${theme.sp2}`,
    whiteSpace: 'nowrap' as const,
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp1,
    padding: `${theme.sp1} ${theme.sp2}`,
    border: 'none',
    borderRadius: theme.radiusSm,
    background: 'transparent',
    cursor: 'pointer',
    fontSize: theme.fontXs,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
    fontWeight: 500,
    transition: 'background 0.1s, color 0.1s',
    whiteSpace: 'nowrap' as const,
  },
  toggleActive: {
    color: theme.blue,
    background: theme.blueDim,
  },
};

// ─── Tool button definition ────────────────────────────────────────────────
interface ToolBtn {
  tool: SchTool;
  icon: React.FC;
  shortcut: string;
  tooltip: string;
}

const toolButtons: ToolBtn[] = [
  { tool: 'select', icon: IconSelect, shortcut: 'V', tooltip: 'Select (V)' },
  { tool: 'wire', icon: IconWire, shortcut: 'W', tooltip: 'Wire (W)' },
  { tool: 'component', icon: IconComponent, shortcut: 'C', tooltip: 'Component (C)' },
  { tool: 'label', icon: IconLabel, shortcut: 'L', tooltip: 'Label (L)' },
  { tool: 'power', icon: IconPower, shortcut: 'P', tooltip: 'Power (P)' },
  { tool: 'bus', icon: IconBus, shortcut: 'B', tooltip: 'Bus (B)' },
  { tool: 'measure', icon: IconMeasure, shortcut: 'M', tooltip: 'Measure (M)' },
];

// ─── Component ─────────────────────────────────────────────────────────────
const Toolbar: React.FC = () => {
  const [drcConfigOpen, setDrcConfigOpen] = useState(false);
  const {
    activeTool, setTool,
    zoom, zoomTo, showGrid, snapToGrid, toggleGrid, toggleSnap,
    cursorX, cursorY,
  } = useEditorStore();
  const { canUndo, canRedo, undo, redo, removeSchComponents, removeSchWires, removeSchLabels } = useProjectStore();
  const selectedIds = useEditorStore(s => s.selectedIds);
  const clearSelection = useEditorStore(s => s.clearSelection);

  const handleZoomIn = useCallback(() => zoomTo(zoom * 1.3), [zoom, zoomTo]);
  const handleZoomOut = useCallback(() => zoomTo(zoom / 1.3), [zoom, zoomTo]);
  const handleZoomFit = useCallback(() => zoomTo(0.5), [zoomTo]); // Fit: zoom out to see all content
  const handleZoom100 = useCallback(() => zoomTo(1), [zoomTo]); // 100%: actual size

  return (
    <div style={styles.toolbar}>
      {/* Tool buttons */}
      {toolButtons.map(({ tool, icon: Icon, shortcut, tooltip }) => (
        <button
          key={tool}
          style={{
            ...styles.btn,
            ...(activeTool === tool ? styles.btnActive : {}),
          }}
          onClick={() => setTool(tool)}
          title={tooltip}
          onMouseEnter={(e) => {
            if (activeTool !== tool)
              (e.currentTarget as HTMLElement).style.background = theme.bg3;
          }}
          onMouseLeave={(e) => {
            if (activeTool !== tool)
              (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          <Icon />
          <span style={styles.shortcutLabel}>{shortcut}</span>
        </button>
      ))}

      {/* Delete */}
      <button
        style={styles.btn}
        title="Delete (Del)"
        onClick={() => {
          if (selectedIds.length > 0) {
            removeSchComponents(selectedIds);
            removeSchWires(selectedIds);
            removeSchLabels(selectedIds);
            clearSelection();
          }
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.redDim; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IconDelete />
        <span style={styles.shortcutLabel}>Del</span>
      </button>

      <div style={styles.separator} />

      {/* Undo / Redo */}
      <button
        style={{ ...styles.btn, ...(canUndo ? {} : styles.btnDisabled) }}
        onClick={canUndo ? undo : undefined}
        title="Undo (Ctrl+Z)"
        onMouseEnter={(e) => { if (canUndo) (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IconUndo />
      </button>
      <button
        style={{ ...styles.btn, ...(canRedo ? {} : styles.btnDisabled) }}
        onClick={canRedo ? redo : undefined}
        title="Redo (Ctrl+Y)"
        onMouseEnter={(e) => { if (canRedo) (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IconRedo />
      </button>

      <div style={styles.separator} />

      {/* Zoom controls */}
      <button
        style={styles.btn}
        onClick={handleZoomOut}
        title="Zoom Out"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IconZoomOut />
      </button>
      <span style={styles.zoomDisplay}>{Math.round(zoom * 100)}%</span>
      <button
        style={styles.btn}
        onClick={handleZoomIn}
        title="Zoom In"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <IconZoomIn />
      </button>
      <button
        style={styles.actionBtn}
        onClick={handleZoomFit}
        title="Fit to screen"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        Fit
      </button>
      <button
        style={styles.actionBtn}
        onClick={handleZoom100}
        title="Reset to 100%"
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        100%
      </button>

      <div style={styles.separator} />

      {/* Grid / Snap toggles */}
      <button
        style={{
          ...styles.actionBtn,
          ...(showGrid ? styles.toggleActive : {}),
        }}
        onClick={toggleGrid}
        title="Toggle Grid"
      >
        <IconGrid /> Grid
      </button>
      <button
        style={{
          ...styles.actionBtn,
          ...(snapToGrid ? styles.toggleActive : {}),
        }}
        onClick={toggleSnap}
        title="Toggle Snap"
      >
        <IconSnap /> Snap
      </button>

      <div style={styles.separator} />

      {/* Action buttons — dispatch custom events so App.tsx can switch tabs */}
      <button
        style={styles.actionBtn}
        title="Run Design Rule Check"
        onClick={() => window.dispatchEvent(new CustomEvent('routeai-navigate', { detail: 'drc' }))}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.green; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        Run DRC
      </button>
      <button
        style={styles.actionBtn}
        title="Configure DRC Rules"
        onClick={() => setDrcConfigOpen(true)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.textPrimary; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        {'\u2699'}
      </button>
      <DRCConfigDialog open={drcConfigOpen} onClose={() => setDrcConfigOpen(false)} />
      <button
        style={styles.actionBtn}
        title="Run Electrical Rule Check"
        onClick={() => window.dispatchEvent(new CustomEvent('routeai-navigate', { detail: 'erc' }))}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.orange; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        Run ERC
      </button>
      <button
        style={styles.actionBtn}
        title="AI-powered design review"
        onClick={() => window.dispatchEvent(new CustomEvent('routeai-navigate', { detail: 'ai-review' }))}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.purpleDim; (e.currentTarget as HTMLElement).style.color = theme.purple; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        AI Review
      </button>
      <button
        style={styles.actionBtn}
        title="Export design as PDF with title block"
        onClick={() => window.dispatchEvent(new CustomEvent('routeai-open-pdf-export'))}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.cyan; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        PDF
      </button>
      <button
        style={styles.actionBtn}
        title="Export to Gerber, BOM, etc."
        onClick={() => window.dispatchEvent(new CustomEvent('routeai-navigate', { detail: 'export' }))}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.textPrimary; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = theme.textSecondary; }}
      >
        Export
      </button>

      {/* Coordinates display */}
      <span style={styles.coordDisplay}>
        X: {cursorX.toFixed(2)}mm &nbsp; Y: {cursorY.toFixed(2)}mm
      </span>
    </div>
  );
};

export default Toolbar;
