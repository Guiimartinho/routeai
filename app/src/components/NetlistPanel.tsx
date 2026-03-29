// ─── NetlistPanel.tsx ── Net browser panel ──────────────────────────────────
import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';
import type { SchNet, BrdTrace, BrdVia, BrdPad, BoardState } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NetInfo {
  id: string;
  name: string;
  padCount: number;
  routedPct: number;
  totalLength: number;
  isFullyRouted: boolean;
}

interface NetlistPanelProps {
  nets: SchNet[];
  board: BoardState;
  highlightedNet: string | null;
  onHighlightNet: (netId: string | null) => void;
  onZoomToNet: (netId: string) => void;
  onRouteAll: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeTraceLength(traces: BrdTrace[], netId: string): number {
  let total = 0;
  traces.forEach(t => {
    if (t.netId !== netId) return;
    for (let i = 1; i < t.points.length; i++) {
      const dx = t.points[i].x - t.points[i - 1].x;
      const dy = t.points[i].y - t.points[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
  });
  return total;
}

function countPadsForNet(board: BoardState, netId: string): number {
  let count = 0;
  board.components.forEach(c => {
    c.pads.forEach(p => {
      if (p.netId === netId) count++;
    });
  });
  return count;
}

function computeRoutedPct(board: BoardState, net: SchNet): number {
  const padCount = countPadsForNet(board, net.id);
  if (padCount <= 1) return 100;
  // Simple heuristic: check how many trace segments connect pads
  const traceCount = board.traces.filter(t => t.netId === net.id).length;
  const viaCount = board.vias.filter(v => v.netId === net.id).length;
  const connections = traceCount + viaCount;
  const needed = padCount - 1;
  return Math.min(100, Math.round((connections / needed) * 100));
}

// ─── Component ──────────────────────────────────────────────────────────────

const NetlistPanel: React.FC<NetlistPanelProps> = ({
  nets, board, highlightedNet, onHighlightNet, onZoomToNet, onRouteAll,
}) => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'pads' | 'routed' | 'length'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Compute net info
  const netInfos = useMemo((): NetInfo[] => {
    return nets.map(net => {
      const padCount = countPadsForNet(board, net.id);
      const routedPct = computeRoutedPct(board, net);
      const totalLength = computeTraceLength(board.traces, net.id);
      return {
        id: net.id,
        name: net.name,
        padCount,
        routedPct,
        totalLength: Math.round(totalLength * 100) / 100,
        isFullyRouted: routedPct >= 100,
      };
    });
  }, [nets, board]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = netInfos;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n => n.name.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'pads': cmp = a.padCount - b.padCount; break;
        case 'routed': cmp = a.routedPct - b.routedPct; break;
        case 'length': cmp = a.totalLength - b.totalLength; break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [netInfos, search, sortBy, sortAsc]);

  const unroutedCount = useMemo(() => netInfos.filter(n => !n.isFullyRouted).length, [netInfos]);

  const handleSort = useCallback((col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(true); }
  }, [sortBy, sortAsc]);

  const handleClick = useCallback((netId: string) => {
    onHighlightNet(highlightedNet === netId ? null : netId);
  }, [highlightedNet, onHighlightNet]);

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Netlist</span>
        <span style={styles.count}>{nets.length} nets</span>
      </div>

      {/* Search */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          placeholder="Search nets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Stats bar */}
      <div style={styles.statsBar}>
        <div style={styles.stat}>
          <span style={styles.statValue}>{netInfos.filter(n => n.isFullyRouted).length}</span>
          <span style={styles.statLabel}>routed</span>
        </div>
        <div style={styles.stat}>
          <span style={{ ...styles.statValue, color: unroutedCount > 0 ? theme.orange : theme.green }}>
            {unroutedCount}
          </span>
          <span style={styles.statLabel}>unrouted</span>
        </div>
        <button style={styles.routeAllBtn} onClick={onRouteAll} title="AI Auto-Route All">
          Route All
        </button>
      </div>

      {/* Column headers */}
      <div style={styles.colHeaders}>
        <div style={{ ...styles.colHeader, flex: 2 }} onClick={() => handleSort('name')}>
          Net {sortBy === 'name' ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
        </div>
        <div style={{ ...styles.colHeader, flex: 1 }} onClick={() => handleSort('pads')}>
          Pads {sortBy === 'pads' ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
        </div>
        <div style={{ ...styles.colHeader, flex: 1 }} onClick={() => handleSort('routed')}>
          % {sortBy === 'routed' ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
        </div>
        <div style={{ ...styles.colHeader, flex: 1 }} onClick={() => handleSort('length')}>
          mm {sortBy === 'length' ? (sortAsc ? '\u25B4' : '\u25BE') : ''}
        </div>
      </div>

      {/* Net list */}
      <div style={styles.list}>
        {filtered.map(net => {
          const isHighlighted = net.id === highlightedNet;
          return (
            <div
              key={net.id}
              style={{
                ...styles.netRow,
                ...(isHighlighted ? styles.netRowHighlighted : {}),
                ...((!net.isFullyRouted && !isHighlighted) ? styles.netRowUnrouted : {}),
              }}
              onClick={() => handleClick(net.id)}
              onDoubleClick={() => onZoomToNet(net.id)}
            >
              {/* Net name */}
              <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div style={{
                  ...styles.netDot,
                  backgroundColor: net.isFullyRouted ? theme.green : theme.orange,
                }} />
                <span style={{
                  ...styles.netName,
                  color: isHighlighted ? theme.highlightColor : theme.textPrimary,
                }}>
                  {net.name}
                </span>
              </div>

              {/* Pad count */}
              <span style={{ ...styles.netStat, flex: 1 }}>{net.padCount}</span>

              {/* Routed % with bar */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={styles.progressBg}>
                  <div style={{
                    ...styles.progressFill,
                    width: `${net.routedPct}%`,
                    backgroundColor: net.routedPct >= 100 ? theme.green : theme.orange,
                  }} />
                </div>
                <span style={{
                  ...styles.netStat,
                  color: net.routedPct >= 100 ? theme.green : theme.orange,
                  minWidth: 28,
                }}>
                  {net.routedPct}
                </span>
              </div>

              {/* Length */}
              <span style={{ ...styles.netStat, flex: 1 }}>
                {net.totalLength > 0 ? net.totalLength.toFixed(1) : '-'}
              </span>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={styles.empty}>No nets found</div>
        )}
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 280,
    height: '100%',
    background: theme.bg1,
    borderLeft: theme.border,
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
  count: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  searchRow: {
    padding: '6px 10px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    padding: '4px 8px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  statsBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 10px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  statValue: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
    fontFamily: theme.fontMono,
  },
  statLabel: {
    color: theme.textMuted,
    fontSize: '9px',
    textTransform: 'uppercase' as const,
  },
  routeAllBtn: {
    marginLeft: 'auto',
    background: `linear-gradient(135deg, ${theme.purple}, ${theme.blue})`,
    border: 'none',
    color: '#fff',
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  colHeaders: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  colHeader: {
    color: theme.textMuted,
    fontSize: '9px',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  netRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 10px',
    cursor: 'pointer',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    transition: 'background 0.1s',
  },
  netRowHighlighted: {
    background: 'rgba(240,160,48,0.1)',
    borderLeft: `2px solid ${theme.highlightColor}`,
    paddingLeft: 8,
  },
  netRowUnrouted: {
    borderLeft: `2px solid ${theme.orange}`,
    paddingLeft: 8,
  },
  netDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  netName: {
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  netStat: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    textAlign: 'right' as const,
  },
  progressBg: {
    flex: 1,
    height: 3,
    background: theme.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s',
  },
  empty: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
    textAlign: 'center' as const,
    padding: 20,
  },
};

export default NetlistPanel;
