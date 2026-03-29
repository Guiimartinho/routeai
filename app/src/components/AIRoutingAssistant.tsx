// ─── AIRoutingAssistant.tsx ── Constraint-based routing strategy panel ────────
// Architecture: solver engine generates constraints, LLM only explains results.
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { theme } from '../styles/theme';
import type { SchNet, SchComponent, BoardState } from '../types';
import {
  generateRoutingConstraints,
  explainConstraints,
  type RoutingConstraints,
} from '../engine/routingSolver';
import { useProjectStore } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NetClassRule {
  netId: string;
  netName: string;
  priority: number;
  layer: string;
  width: number;
  reasoning: string;
}

interface ImpedanceNet {
  netName: string;
  targetImpedance: number;
  traceWidth: number;
  spacing: number;
}

export interface AIRoutingAssistantProps {
  visible?: boolean;
  onClose?: () => void;
  boardState?: BoardState;
  nets?: SchNet[];
  schematicComponents?: SchComponent[];
  layerCount?: number;
  onApplyStrategy?: (strategy: {
    netOrder: NetClassRule[];
    layerAssignment: Record<string, string>;
    impedanceNets: ImpedanceNet[];
  }) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

const AIRoutingAssistant: React.FC<AIRoutingAssistantProps> = (props) => {
  const store = useProjectStore();
  const visible = props.visible ?? true;
  const onClose = props.onClose ?? (() => {});
  const boardState = props.boardState ?? store.board;
  const nets = props.nets ?? store.nets;
  const schematicComponents = props.schematicComponents ?? store.schematic.components;
  const layerCount = props.layerCount ?? (store.board.layers?.length || 2);
  const onApplyStrategy = props.onApplyStrategy;
  const [constraints, setConstraints] = useState<RoutingConstraints | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editedOrder, setEditedOrder] = useState<NetClassRule[] | null>(null);
  const [expandedNet, setExpandedNet] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string>('');

  // Convert solver constraints to the display format (NetClassRule[])
  const strategyFromConstraints = useMemo(() => {
    if (!constraints) return null;
    const netOrder: NetClassRule[] = constraints.netPriorities.map(np => ({
      netId: np.netId,
      netName: np.netName,
      priority: np.priority,
      layer: np.layer,
      width: np.width,
      reasoning: np.reasoning,
    }));
    const layerAssignment: Record<string, string> = {};
    for (const lr of constraints.layerAssignment) {
      layerAssignment[lr.layerName] = lr.purpose;
    }
    const impedanceNets: ImpedanceNet[] = constraints.impedanceTargets.map(t => ({
      netName: t.netPattern,
      targetImpedance: t.targetImpedance,
      traceWidth: t.traceWidth,
      spacing: t.spacing,
    }));
    return { netOrder, layerAssignment, impedanceNets, generalNotes: constraints.generalNotes };
  }, [constraints]);

  // Effective net order (edited or from strategy)
  const netOrder = editedOrder || strategyFromConstraints?.netOrder || [];

  // ── Generate routing constraints (solver, no LLM) ──────────────

  const analyzeRouting = useCallback(() => {
    setIsAnalyzing(true);
    setEditedOrder(null);
    setExplanation('');

    // Run the solver synchronously (it's fast pattern matching, not SA)
    // Small timeout to let the UI show the spinner
    setTimeout(() => {
      const result = generateRoutingConstraints(
        nets,
        schematicComponents || [],
        layerCount,
      );
      setConstraints(result);

      // Generate deterministic explanation
      const explain = explainConstraints(result);
      setExplanation(explain);

      setIsAnalyzing(false);
    }, 100);
  }, [nets, schematicComponents, layerCount]);

  // Auto-analyze on first mount if we have nets
  useEffect(() => {
    if (visible && nets.length > 0 && !constraints) {
      analyzeRouting();
    }
  }, [visible, nets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Move net priority ──────────────────────────────────────────

  const moveNetPriority = useCallback((netId: string, direction: 'up' | 'down') => {
    const order = [...(editedOrder || strategyFromConstraints?.netOrder || [])];
    const idx = order.findIndex(n => n.netId === netId);
    if (idx < 0) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= order.length) return;

    // Swap
    [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
    // Update priorities
    order.forEach((n, i) => { n.priority = i + 1; });
    setEditedOrder(order);
  }, [editedOrder, strategyFromConstraints]);

  // ── Change layer assignment ────────────────────────────────────

  const changeNetLayer = useCallback((netId: string, layer: string) => {
    const order = [...(editedOrder || strategyFromConstraints?.netOrder || [])];
    const idx = order.findIndex(n => n.netId === netId);
    if (idx >= 0) {
      order[idx] = { ...order[idx], layer };
      setEditedOrder(order);
    }
  }, [editedOrder, strategyFromConstraints]);

  // ── Change net width ───────────────────────────────────────────

  const changeNetWidth = useCallback((netId: string, width: number) => {
    const order = [...(editedOrder || strategyFromConstraints?.netOrder || [])];
    const idx = order.findIndex(n => n.netId === netId);
    if (idx >= 0) {
      order[idx] = { ...order[idx], width };
      setEditedOrder(order);
    }
  }, [editedOrder, strategyFromConstraints]);

  // ── Apply strategy ─────────────────────────────────────────────

  const handleApply = useCallback(() => {
    if (!strategyFromConstraints) return;
    onApplyStrategy?.({
      netOrder: editedOrder || strategyFromConstraints.netOrder,
      layerAssignment: strategyFromConstraints.layerAssignment,
      impedanceNets: strategyFromConstraints.impedanceNets,
    });
  }, [strategyFromConstraints, editedOrder, onApplyStrategy]);

  // ── Stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const powerCount = netOrder.filter(n => /VCC|VDD|GND|3V3|5V/i.test(n.netName)).length;
    const hsCount = netOrder.filter(n => /USB|ETH|SPI.*CLK|SDIO|LVDS/i.test(n.netName)).length;
    const signalCount = netOrder.length - powerCount - hsCount;
    return { powerCount, hsCount, signalCount, total: netOrder.length };
  }, [netOrder]);

  if (!visible) return null;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.aiIcon}>AI</div>
          <span style={styles.title}>Routing Assistant</span>
        </div>
        <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
      </div>

      {/* Engine status */}
      <div style={styles.statusBar}>
        <div style={{
          ...styles.statusDot,
          background: theme.green,
        }} />
        <span style={styles.statusText}>
          Constraint solver (pattern matching, no LLM)
        </span>
      </div>

      {/* Main action */}
      {!constraints && !isAnalyzing && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>{'\uD83D\uDDFA'}</div>
          <div style={styles.emptyTitle}>Routing Constraint Analyzer</div>
          <div style={styles.emptyDesc}>
            Analyze nets to auto-detect types, generate routing priorities, impedance targets, and length matching rules.
          </div>
          <button style={styles.analyzeBtn} onClick={analyzeRouting}>
            Analyze Nets
          </button>
        </div>
      )}

      {/* Analyzing */}
      {isAnalyzing && (
        <div style={styles.emptyState}>
          <div style={styles.spinner} />
          <div style={styles.analyzeLabel}>Analyzing {nets.length} nets across {layerCount} layers...</div>
        </div>
      )}

      {/* Results */}
      {strategyFromConstraints && !isAnalyzing && (
        <div style={styles.results}>
          {/* Stats bar */}
          <div style={styles.statsBar}>
            <div style={styles.stat}>
              <span style={{ ...styles.statNum, color: theme.red }}>{stats.powerCount}</span>
              <span style={styles.statLabel}>Power</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statNum, color: theme.purple }}>{stats.hsCount}</span>
              <span style={styles.statLabel}>High-speed</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statNum, color: theme.blue }}>{stats.signalCount}</span>
              <span style={styles.statLabel}>Signal</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statNum, color: theme.textPrimary }}>{stats.total}</span>
              <span style={styles.statLabel}>Total</span>
            </div>
          </div>

          {/* Layer Assignment */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Layer Assignment</div>
            {Object.entries(strategyFromConstraints.layerAssignment).map(([layer, purpose]) => (
              <div key={layer} style={styles.layerRow}>
                <span style={{
                  ...styles.layerDot,
                  background: theme.layers[layer] || theme.textMuted,
                }} />
                <span style={styles.layerName}>{layer}</span>
                <span style={styles.layerPurpose}>{purpose}</span>
              </div>
            ))}
          </div>

          {/* Impedance Nets */}
          {strategyFromConstraints.impedanceNets.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Impedance-Controlled Nets</div>
              {strategyFromConstraints.impedanceNets.map(inet => (
                <div key={inet.netName} style={styles.impRow}>
                  <span style={styles.impName}>{inet.netName}</span>
                  <span style={styles.impValue}>{inet.targetImpedance}{'\u03A9'}</span>
                  <span style={styles.impDetail}>
                    W={inet.traceWidth}mm, S={inet.spacing}mm
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Length Match Groups */}
          {constraints && constraints.lengthMatchGroups.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Length Matching</div>
              {constraints.lengthMatchGroups.map(group => (
                <div key={group.groupName} style={styles.impRow}>
                  <span style={styles.impName}>{group.groupName}</span>
                  <span style={styles.impValue}>{group.maxSkew}mm</span>
                  <span style={styles.impDetail}>max skew</span>
                </div>
              ))}
            </div>
          )}

          {/* Routing Order */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>
              Routing Order
              <span style={styles.sectionHint}>(drag to reorder)</span>
            </div>
            <div style={styles.netOrderList}>
              {netOrder.map((net, idx) => {
                const isPower = /VCC|VDD|GND|3V3|5V/i.test(net.netName);
                const isHS = /USB|ETH|SPI.*CLK|SDIO|LVDS/i.test(net.netName);
                const isClock = /CLK|XTAL|OSC/i.test(net.netName);

                return (
                  <div key={net.netId} style={styles.netOrderItem}>
                    <div style={styles.netOrderHeader}>
                      <div style={styles.netOrderLeft}>
                        <span style={styles.netPriority}>#{idx + 1}</span>
                        <span style={{
                          ...styles.netTypeBadge,
                          background: isPower ? theme.redDim :
                            isHS ? theme.purpleDim :
                            isClock ? theme.orangeDim : theme.bg3,
                          color: isPower ? theme.red :
                            isHS ? theme.purple :
                            isClock ? theme.orange : theme.textMuted,
                        }}>
                          {isPower ? 'PWR' : isHS ? 'HS' : isClock ? 'CLK' : 'SIG'}
                        </span>
                        <span style={styles.netOrderName}>{net.netName}</span>
                      </div>
                      <div style={styles.netOrderRight}>
                        {/* Layer selector */}
                        <select
                          style={styles.miniSelect}
                          value={net.layer}
                          onChange={e => changeNetLayer(net.netId, e.target.value)}
                        >
                          {boardState.layers.filter(l => l.endsWith('.Cu')).map(l => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        {/* Width selector */}
                        <select
                          style={styles.miniSelect}
                          value={net.width}
                          onChange={e => changeNetWidth(net.netId, parseFloat(e.target.value))}
                        >
                          <option value={0.1}>0.1mm</option>
                          <option value={0.15}>0.15</option>
                          <option value={0.18}>0.18</option>
                          <option value={0.2}>0.2mm</option>
                          <option value={0.25}>0.25</option>
                          <option value={0.3}>0.3mm</option>
                          <option value={0.4}>0.4mm</option>
                          <option value={0.5}>0.5mm</option>
                          <option value={1.0}>1.0mm</option>
                        </select>
                        {/* Priority arrows */}
                        <button
                          style={styles.arrowBtn}
                          onClick={() => moveNetPriority(net.netId, 'up')}
                          disabled={idx === 0}
                        >
                          {'\u25B2'}
                        </button>
                        <button
                          style={styles.arrowBtn}
                          onClick={() => moveNetPriority(net.netId, 'down')}
                          disabled={idx === netOrder.length - 1}
                        >
                          {'\u25BC'}
                        </button>
                        {/* Expand toggle */}
                        <button
                          style={styles.expandBtn}
                          onClick={() => setExpandedNet(expandedNet === net.netId ? null : net.netId)}
                        >
                          {expandedNet === net.netId ? '\u25B4' : '\u25BE'}
                        </button>
                      </div>
                    </div>
                    {expandedNet === net.netId && (
                      <div style={styles.netReasoning}>{net.reasoning}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* General Notes */}
          {strategyFromConstraints.generalNotes.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Routing Notes</div>
              <ul style={styles.notesList}>
                {strategyFromConstraints.generalNotes.map((note, i) => (
                  <li key={i} style={styles.noteItem}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Constraint summary */}
          {explanation && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Constraint Summary</div>
              <pre style={styles.explanationPre}>{explanation}</pre>
            </div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            <button style={styles.reanalyzeBtn} onClick={analyzeRouting}>
              Re-analyze Nets
            </button>
            <button style={styles.applyBtn} onClick={handleApply}>
              Apply Strategy
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 360,
    height: '100%',
    background: theme.bg1,
    borderLeft: theme.border,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: theme.fontSans,
    userSelect: 'none',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  aiIcon: {
    width: 22,
    height: 22,
    borderRadius: theme.radiusSm,
    background: `linear-gradient(135deg, ${theme.green}, ${theme.blue})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '8px',
    fontWeight: 800,
    fontFamily: theme.fontMono,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusText: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
  },

  // Empty / analyzing state
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  emptyDesc: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: 260,
  },
  analyzeBtn: {
    background: `linear-gradient(135deg, ${theme.green}cc, ${theme.blue}cc)`,
    border: 'none',
    borderRadius: theme.radiusMd,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    marginTop: 8,
  },
  spinner: {
    width: 28,
    height: 28,
    border: `3px solid ${theme.bg3}`,
    borderTopColor: theme.green,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  analyzeLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
  },

  // Results
  results: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  statsBar: {
    display: 'flex',
    gap: 6,
    marginBottom: 4,
  },
  stat: {
    flex: 1,
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    padding: '6px 8px',
    textAlign: 'center',
    border: theme.border,
  },
  statNum: {
    display: 'block',
    fontSize: theme.fontLg,
    fontWeight: 700,
    fontFamily: theme.fontMono,
  },
  statLabel: {
    color: theme.textMuted,
    fontSize: '8px',
    fontWeight: 500,
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 4,
  },
  sectionTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sectionHint: {
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 400,
    textTransform: 'none',
    letterSpacing: 0,
  },
  layerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
  },
  layerDot: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  layerName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontMono,
    minWidth: 50,
  },
  layerPurpose: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  impRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    marginBottom: 3,
    border: theme.border,
  },
  impName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    flex: 1,
  },
  impValue: {
    color: theme.orange,
    fontSize: theme.fontSm,
    fontWeight: 700,
    fontFamily: theme.fontMono,
  },
  impDetail: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
  },

  // Net order list
  netOrderList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  netOrderItem: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    overflow: 'hidden',
  },
  netOrderHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 6px',
    gap: 4,
  },
  netOrderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  netPriority: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    width: 18,
    textAlign: 'right',
    flexShrink: 0,
  },
  netTypeBadge: {
    fontSize: '7px',
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  netOrderName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  netOrderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  miniSelect: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 2,
    color: theme.textSecondary,
    fontSize: '9px',
    padding: '1px 2px',
    fontFamily: theme.fontMono,
    cursor: 'pointer',
    outline: 'none',
    maxWidth: 55,
  },
  arrowBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: '8px',
    cursor: 'pointer',
    padding: '2px 3px',
    lineHeight: 1,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: '9px',
    cursor: 'pointer',
    padding: '2px 4px',
  },
  netReasoning: {
    padding: '4px 8px 6px 32px',
    color: theme.textMuted,
    fontSize: '9px',
    lineHeight: 1.4,
    borderTop: theme.border,
    background: theme.bg1,
  },

  // Notes
  notesList: {
    margin: 0,
    padding: '0 0 0 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  noteItem: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    lineHeight: 1.4,
  },
  explanationPre: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    lineHeight: 1.5,
    margin: 0,
    padding: '6px 8px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },

  // Actions
  actions: {
    display: 'flex',
    gap: 8,
    padding: '8px 0 4px',
    borderTop: theme.border,
    flexShrink: 0,
  },
  reanalyzeBtn: {
    flex: 1,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 500,
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  applyBtn: {
    flex: 1,
    background: theme.greenDim,
    border: `1px solid ${theme.green}`,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
};

export default AIRoutingAssistant;
