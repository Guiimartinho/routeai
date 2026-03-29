import React, { useEffect, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { theme } from '../styles/theme';

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  bar: {
    height: theme.statusBarHeight,
    minHeight: theme.statusBarHeight,
    display: 'flex',
    alignItems: 'center',
    background: theme.bg1,
    borderTop: theme.border,
    padding: '0 10px',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    color: theme.textMuted,
    gap: '2px',
    userSelect: 'none' as const,
    overflow: 'hidden',
    whiteSpace: 'nowrap' as const,
  },
  section: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  sectionCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flex: 1,
    justifyContent: 'center',
  },
  divider: {
    width: 1,
    height: 12,
    background: theme.bg3,
    margin: '0 6px',
    flexShrink: 0,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '1px 6px',
    borderRadius: theme.radiusSm,
    fontSize: '9px',
    fontWeight: 600,
    letterSpacing: '0.3px',
  },
  badgeActive: {
    background: theme.blueDim,
    color: theme.blue,
  },
  badgeTool: {
    background: theme.bg3,
    color: theme.textSecondary,
    textTransform: 'uppercase' as const,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  dotConnected: {
    background: theme.green,
    boxShadow: `0 0 4px ${theme.green}`,
  },
  dotDisconnected: {
    background: theme.red,
    boxShadow: `0 0 4px ${theme.red}`,
  },
  coord: {
    fontFamily: theme.fontMono,
    fontSize: '10px',
    color: theme.textSecondary,
    letterSpacing: '-0.2px',
  },
  value: {
    color: theme.textSecondary,
  },
  label: {
    color: theme.textMuted,
  },
  memBar: {
    width: 40,
    height: 4,
    background: theme.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
};

// ─── Tool display name mapping ──────────────────────────────────────────────

const TOOL_NAMES: Record<string, string> = {
  select: 'Select',
  wire: 'Wire',
  trace: 'Route Trace',
  component: 'Place Component',
  label: 'Label',
  power: 'Power Symbol',
  bus: 'Bus',
  noconnect: 'No Connect',
  measure: 'Measure',
  via: 'Place Via',
  zone: 'Draw Zone',
  dimension: 'Dimension',
};

// ─── StatusBar Component ────────────────────────────────────────────────────

export interface StatusBarProps {
  /** Current editor mode label (e.g. 'SCH', 'BRD', '3D') */
  modeLabel?: string;
  /** Grid size in mm */
  gridSize?: number;
  /** Whether snap is enabled */
  snapEnabled?: boolean;
  /** Net count */
  netCount?: number;
  /** Component count */
  componentCount?: number;
  /** AI (Ollama) connected */
  aiConnected?: boolean;
}

const StatusBar: React.FC<StatusBarProps> = ({
  modeLabel = 'SCH',
  gridSize = 2.54,
  snapEnabled,
  netCount = 0,
  componentCount = 0,
  aiConnected = false,
}) => {
  const activeTool = useEditorStore((s) => s.activeTool);
  const zoom = useEditorStore((s) => s.zoom);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const cursorX = useEditorStore((s) => s.cursorX);
  const cursorY = useEditorStore((s) => s.cursorY);

  const isSnap = snapEnabled !== undefined ? snapEnabled : snapToGrid;

  const [memUsage, setMemUsage] = useState(0);

  // Memory usage polling
  useEffect(() => {
    const update = () => {
      if ((performance as any).memory) {
        const mem = (performance as any).memory;
        setMemUsage(Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100));
      }
    };
    update();
    const interval = setInterval(update, 5000);
    return () => clearInterval(interval);
  }, []);

  const toolName = TOOL_NAMES[activeTool] || activeTool;
  const zoomPercent = Math.round(zoom * 100);

  const formatCoord = (v: number) => v.toFixed(2);

  return (
    <div style={styles.bar}>
      {/* ── Left section: active tool + mode ── */}
      <div style={styles.section}>
        <span style={{ ...styles.badge, ...styles.badgeTool }}>{toolName}</span>
        <span style={{ ...styles.badge, ...styles.badgeActive }}>{modeLabel}</span>
      </div>

      <div style={styles.divider} />

      {/* ── Center section: coordinates, grid ── */}
      <div style={styles.sectionCenter}>
        <span style={styles.coord}>
          <span style={styles.label}>X: </span>
          <span style={styles.value}>{formatCoord(cursorX)}mm</span>
        </span>
        <span style={styles.coord}>
          <span style={styles.label}>Y: </span>
          <span style={styles.value}>{formatCoord(cursorY)}mm</span>
        </span>

        <div style={styles.divider} />

        <span>
          <span style={styles.label}>Grid: </span>
          <span style={styles.value}>{gridSize}mm</span>
        </span>
        <span>
          <span style={styles.label}>Snap: </span>
          <span style={{ color: isSnap ? theme.green : theme.textMuted }}>
            {isSnap ? 'ON' : 'OFF'}
          </span>
        </span>
      </div>

      <div style={styles.divider} />

      {/* ── Right section: zoom, counts, AI status, memory ── */}
      <div style={styles.section}>
        <span>
          <span style={styles.label}>Zoom: </span>
          <span style={styles.value}>{zoomPercent}%</span>
        </span>

        <div style={styles.divider} />

        {selectedIds.length > 0 && (
          <>
            <span>
              <span style={{ color: theme.blue }}>{selectedIds.length}</span>
              <span style={styles.label}> sel</span>
            </span>
            <div style={styles.divider} />
          </>
        )}

        <span>
          <span style={styles.value}>{netCount}</span>
          <span style={styles.label}> nets</span>
        </span>
        <span>
          <span style={styles.value}>{componentCount}</span>
          <span style={styles.label}> comps</span>
        </span>

        <div style={styles.divider} />

        {/* AI status */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              ...styles.dot,
              ...(aiConnected ? styles.dotConnected : styles.dotDisconnected),
            }}
          />
          <span style={{ color: aiConnected ? theme.green : theme.textMuted, fontSize: '9px' }}>
            {aiConnected ? 'Ollama' : 'AI Off'}
          </span>
        </span>

        <div style={styles.divider} />

        {/* Memory usage */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={styles.label}>Mem</span>
          <div style={styles.memBar}>
            <div
              style={{
                height: '100%',
                width: `${memUsage}%`,
                background: memUsage > 80 ? theme.red : memUsage > 50 ? theme.orange : theme.green,
                borderRadius: 2,
                transition: 'width 0.3s ease, background 0.3s ease',
              }}
            />
          </div>
        </span>
      </div>
    </div>
  );
};

export default StatusBar;
