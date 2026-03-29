// ─── LayerPanel.tsx ── PCB Layer Manager ────────────────────────────────────
import React, { useState, useCallback } from 'react';
import { theme } from '../styles/theme';
import type { LayerConfig } from './BoardCanvas';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LayerGroup {
  name: string;
  layers: string[];
}

interface LayerPanelProps {
  layers: LayerConfig[];
  activeLayer: string;
  onSetActiveLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

// ─── Layer Groups ───────────────────────────────────────────────────────────

const LAYER_GROUPS: LayerGroup[] = [
  { name: 'Copper', layers: ['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu'] },
  { name: 'Silkscreen', layers: ['F.SilkS', 'B.SilkS'] },
  { name: 'Mask', layers: ['F.Mask', 'B.Mask'] },
  { name: 'Paste', layers: ['F.Paste', 'B.Paste'] },
  { name: 'Fabrication', layers: ['F.Fab', 'B.Fab'] },
  { name: 'Other', layers: ['Edge.Cuts', 'Dwgs.User', 'Cmts.User'] },
];

// ─── Eye Icon SVG ───────────────────────────────────────────────────────────

const EyeIcon: React.FC<{ visible: boolean; size?: number }> = ({ visible, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    {visible ? (
      <>
        <path d="M8 3C4 3 1.5 8 1.5 8s2.5 5 6.5 5 6.5-5 6.5-5S12 3 8 3z"
          stroke="currentColor" strokeWidth="1.2" fill="none" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.3" />
      </>
    ) : (
      <>
        <path d="M8 3C4 3 1.5 8 1.5 8s2.5 5 6.5 5 6.5-5 6.5-5S12 3 8 3z"
          stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.3" />
        <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
      </>
    )}
  </svg>
);

// ─── Component ──────────────────────────────────────────────────────────────

const LayerPanel: React.FC<LayerPanelProps> = ({
  layers, activeLayer, onSetActiveLayer, onToggleVisibility,
  onSetOpacity, onShowAll, onHideAll,
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Copper: true,
    Silkscreen: true,
    Mask: true,
    Paste: false,
    Fabrication: false,
    Other: true,
  });
  const [sliderLayer, setSliderLayer] = useState<string | null>(null);

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroups(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const getLayer = useCallback((id: string): LayerConfig | undefined => {
    return layers.find(l => l.id === id);
  }, [layers]);

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Layers</span>
        <div style={styles.headerButtons}>
          <button style={styles.headerBtn} onClick={onShowAll} title="Show All">
            All
          </button>
          <button style={styles.headerBtn} onClick={onHideAll} title="Hide All">
            None
          </button>
        </div>
      </div>

      {/* Layer Groups */}
      <div style={styles.list}>
        {LAYER_GROUPS.map(group => {
          const groupLayers = group.layers.filter(id => getLayer(id));
          if (groupLayers.length === 0) return null;
          const expanded = expandedGroups[group.name] ?? true;

          return (
            <div key={group.name} style={styles.group}>
              {/* Group header */}
              <div
                style={styles.groupHeader}
                onClick={() => toggleGroup(group.name)}
              >
                <span style={styles.groupArrow}>{expanded ? '\u25BE' : '\u25B8'}</span>
                <span style={styles.groupName}>{group.name}</span>
                <span style={styles.groupCount}>{groupLayers.length}</span>
              </div>

              {/* Layer rows */}
              {expanded && groupLayers.map(layerId => {
                const lc = getLayer(layerId);
                if (!lc) return null;
                const isActive = layerId === activeLayer;

                return (
                  <div key={layerId}>
                    <div
                      style={{
                        ...styles.layerRow,
                        ...(isActive ? styles.layerRowActive : {}),
                      }}
                      onClick={() => onSetActiveLayer(layerId)}
                      onDoubleClick={() => setSliderLayer(sliderLayer === layerId ? null : layerId)}
                    >
                      {/* Visibility toggle */}
                      <button
                        style={styles.eyeBtn}
                        onClick={(e) => { e.stopPropagation(); onToggleVisibility(layerId); }}
                        title={lc.visible ? 'Hide layer' : 'Show layer'}
                      >
                        <span style={{ color: lc.visible ? lc.color : theme.textMuted }}>
                          <EyeIcon visible={lc.visible} />
                        </span>
                      </button>

                      {/* Color swatch */}
                      <div style={{
                        ...styles.swatch,
                        backgroundColor: lc.color,
                        opacity: lc.visible ? lc.opacity : 0.2,
                      }} />

                      {/* Layer name */}
                      <span style={{
                        ...styles.layerName,
                        color: isActive ? theme.textPrimary : (lc.visible ? theme.textSecondary : theme.textMuted),
                        fontWeight: isActive ? 600 : 400,
                      }}>
                        {layerId}
                      </span>

                      {/* Active indicator */}
                      {isActive && <div style={styles.activeIndicator} />}
                    </div>

                    {/* Opacity slider */}
                    {sliderLayer === layerId && (
                      <div style={styles.sliderRow}>
                        <span style={styles.sliderLabel}>Opacity</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={lc.opacity}
                          onChange={e => onSetOpacity(layerId, parseFloat(e.target.value))}
                          style={styles.slider}
                        />
                        <span style={styles.sliderValue}>{Math.round(lc.opacity * 100)}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    height: '100%',
    background: theme.bg1,
    borderRight: theme.border,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: theme.fontSans,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  headerButtons: {
    display: 'flex',
    gap: 4,
  },
  headerBtn: {
    background: theme.bg3,
    border: 'none',
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    padding: '2px 8px',
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  group: {
    borderBottom: theme.border,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    cursor: 'pointer',
    background: theme.bg2,
  },
  groupArrow: {
    color: theme.textMuted,
    fontSize: 10,
    marginRight: 6,
    width: 10,
    textAlign: 'center' as const,
  },
  groupName: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontWeight: 500,
    flex: 1,
  },
  groupCount: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  layerRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px 4px 16px',
    cursor: 'pointer',
    position: 'relative' as const,
    transition: 'background 0.1s',
  },
  layerRowActive: {
    background: 'rgba(77,158,255,0.08)',
  },
  eyeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    flexShrink: 0,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginLeft: 6,
    marginRight: 8,
    flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  layerName: {
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    flex: 1,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  activeIndicator: {
    width: 3,
    height: 16,
    background: theme.blue,
    borderRadius: 2,
    position: 'absolute' as const,
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px 6px 44px',
    gap: 6,
    background: 'rgba(0,0,0,0.15)',
  },
  sliderLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    whiteSpace: 'nowrap' as const,
  },
  slider: {
    flex: 1,
    height: 3,
    accentColor: theme.blue,
    cursor: 'pointer',
  },
  sliderValue: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    minWidth: 30,
    textAlign: 'right' as const,
  },
};

export default LayerPanel;
