// ─── IntentPreview.tsx ── Human-readable DSL preview for PlacementIntent/RoutingIntent ──
// Shows intent JSON in structured sections before solver execution.
import React, { useState, useCallback } from 'react';
import { theme } from '../styles/theme';

// ─── Intent Sub-Types ──────────────────────────────────────────────────────

interface PlacementZone {
  zone_id: string;
  zone_type: string;
  components: string[];
  clustering_strategy?: string;
  thermal_constraints?: {
    max_temp_rise?: number;
    requires_heatsink?: boolean;
    airflow_direction?: string;
  };
}

interface CriticalPair {
  component_a: string;
  component_b: string;
  constraint_type: string;
  max_distance_mm: number;
  reason: string;
}

interface Keepout {
  type: string;
  source_component: string;
  radius_mm: number;
  reason: string;
}

interface GroundPlane {
  layer: string;
  type: string;
  net: string;
  reason: string;
}

interface PlacementIntent {
  zones?: PlacementZone[];
  critical_pairs?: CriticalPair[];
  keepouts?: Keepout[];
  ground_planes?: GroundPlane[];
  [key: string]: unknown;
}

interface NetClass {
  name: string;
  nets: string[];
  impedance_target_ohm?: number;
  width_mm?: number;
  priority?: number;
}

interface RoutingOrderEntry {
  priority: number;
  net_class: string;
  reason: string;
}

interface LayerAssignment {
  signal_layers?: string[];
  reference_planes?: Record<string, string>;
}

interface CostWeights {
  [key: string]: number;
}

interface VoltageDropTarget {
  net: string;
  source: string;
  sinks: string[];
  max_drop_mv: number;
  max_current_a: number;
}

interface RoutingIntent {
  net_classes?: NetClass[];
  routing_order?: RoutingOrderEntry[];
  layer_assignment?: LayerAssignment;
  cost_weights?: CostWeights;
  voltage_drop_targets?: VoltageDropTarget[];
  [key: string]: unknown;
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface IntentPreviewProps {
  type: 'placement' | 'routing';
  intent: PlacementIntent | RoutingIntent;
  onApprove: () => void;
  onEdit: (edited: PlacementIntent | RoutingIntent) => void;
  onCancel: () => void;
  isRunning?: boolean;
}

// ─── Collapsible Section ───────────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={styles.section}>
      <div style={styles.sectionHeader} onClick={() => setOpen(!open)}>
        <span style={styles.sectionTitle}>{title}</span>
        {count !== undefined && (
          <span style={styles.sectionCount}>{count}</span>
        )}
        <span style={styles.sectionArrow}>{open ? '\u25B4' : '\u25BE'}</span>
      </div>
      {open && <div style={styles.sectionBody}>{children}</div>}
    </div>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────

export const IntentPreview: React.FC<IntentPreviewProps> = ({
  type,
  intent,
  onApprove,
  onEdit,
  onCancel,
  isRunning = false,
}) => {
  const [showRawJson, setShowRawJson] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedJson, setEditedJson] = useState('');
  const [jsonError, setJsonError] = useState('');

  const handleEditToggle = useCallback(() => {
    if (!editMode) {
      setEditedJson(JSON.stringify(intent, null, 2));
      setJsonError('');
    }
    setEditMode(!editMode);
  }, [editMode, intent]);

  const handleSaveEdit = useCallback(() => {
    try {
      const parsed = JSON.parse(editedJson);
      setJsonError('');
      setEditMode(false);
      onEdit(parsed);
    } catch (e: unknown) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [editedJson, onEdit]);

  // ── Placement intent rendering ─────────────────────────────────

  const renderPlacementIntent = (pi: PlacementIntent) => (
    <>
      {/* Zones */}
      {pi.zones && pi.zones.length > 0 && (
        <Section title="Zones" count={pi.zones.length}>
          {pi.zones.map((zone, i) => (
            <div key={zone.zone_id || i} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardId}>{zone.zone_id}</span>
                <span style={styles.typeBadge}>{zone.zone_type}</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Components:</span>
                <div style={styles.chipContainer}>
                  {zone.components.map(c => (
                    <span key={c} style={styles.chip}>{c}</span>
                  ))}
                </div>
              </div>
              {zone.clustering_strategy && (
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Clustering:</span>
                  <span style={styles.cardValue}>{zone.clustering_strategy}</span>
                </div>
              )}
              {zone.thermal_constraints && (
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Thermal:</span>
                  <div style={styles.thermalInfo}>
                    {zone.thermal_constraints.max_temp_rise !== undefined && (
                      <span style={styles.accentValue}>
                        max +{zone.thermal_constraints.max_temp_rise}C
                      </span>
                    )}
                    {zone.thermal_constraints.requires_heatsink && (
                      <span style={styles.warningBadge}>heatsink</span>
                    )}
                    {zone.thermal_constraints.airflow_direction && (
                      <span style={styles.cardValue}>
                        airflow: {zone.thermal_constraints.airflow_direction}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Critical Pairs */}
      {pi.critical_pairs && pi.critical_pairs.length > 0 && (
        <Section title="Critical Pairs" count={pi.critical_pairs.length}>
          <div style={styles.table}>
            <div style={styles.tableHeaderRow}>
              <span style={{ ...styles.tableCell, flex: 1 }}>Comp A</span>
              <span style={{ ...styles.tableCell, flex: 1 }}>Comp B</span>
              <span style={{ ...styles.tableCell, flex: 1 }}>Constraint</span>
              <span style={{ ...styles.tableCell, width: 60 }}>Max Dist</span>
            </div>
            {pi.critical_pairs.map((pair, i) => (
              <div key={i} style={styles.tableRow}>
                <span style={{ ...styles.tableCellValue, flex: 1 }}>{pair.component_a}</span>
                <span style={{ ...styles.tableCellValue, flex: 1 }}>{pair.component_b}</span>
                <span style={{ ...styles.tableCellValue, flex: 1 }}>{pair.constraint_type}</span>
                <span style={{ ...styles.accentValue, width: 60 }}>
                  {pair.max_distance_mm}mm
                </span>
              </div>
            ))}
            {pi.critical_pairs.map((pair, i) => pair.reason ? (
              <div key={`reason-${i}`} style={styles.reasonRow}>
                <span style={styles.reasonLabel}>#{i + 1}:</span>
                <span style={styles.reasonText}>{pair.reason}</span>
              </div>
            ) : null)}
          </div>
        </Section>
      )}

      {/* Keepouts */}
      {pi.keepouts && pi.keepouts.length > 0 && (
        <Section title="Keepouts" count={pi.keepouts.length}>
          {pi.keepouts.map((k, i) => (
            <div key={i} style={styles.listItem}>
              <div style={styles.listItemTop}>
                <span style={styles.typeBadge}>{k.type}</span>
                <span style={styles.cardValue}>{k.source_component}</span>
                <span style={styles.accentValue}>{k.radius_mm}mm radius</span>
              </div>
              <div style={styles.reasonText}>{k.reason}</div>
            </div>
          ))}
        </Section>
      )}

      {/* Ground Planes */}
      {pi.ground_planes && pi.ground_planes.length > 0 && (
        <Section title="Ground Planes" count={pi.ground_planes.length}>
          {pi.ground_planes.map((gp, i) => (
            <div key={i} style={styles.listItem}>
              <div style={styles.listItemTop}>
                <span style={styles.layerBadge}>{gp.layer}</span>
                <span style={styles.typeBadge}>{gp.type}</span>
                <span style={styles.cardValue}>net: {gp.net}</span>
              </div>
              <div style={styles.reasonText}>{gp.reason}</div>
            </div>
          ))}
        </Section>
      )}
    </>
  );

  // ── Routing intent rendering ───────────────────────────────────

  const renderRoutingIntent = (ri: RoutingIntent) => (
    <>
      {/* Net Classes */}
      {ri.net_classes && ri.net_classes.length > 0 && (
        <Section title="Net Classes" count={ri.net_classes.length}>
          {ri.net_classes.map((nc, i) => (
            <div key={nc.name || i} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardId}>{nc.name}</span>
                {nc.priority !== undefined && (
                  <span style={styles.priorityBadge}>P{nc.priority}</span>
                )}
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Nets:</span>
                <span style={styles.cardValue}>{nc.nets.length} net(s)</span>
              </div>
              <div style={styles.cardRow}>
                {nc.impedance_target_ohm !== undefined && (
                  <span style={styles.accentValue}>
                    Z={nc.impedance_target_ohm}{'\u03A9'}
                  </span>
                )}
                {nc.width_mm !== undefined && (
                  <span style={styles.accentValue}>
                    W={nc.width_mm}mm
                  </span>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Routing Order */}
      {ri.routing_order && ri.routing_order.length > 0 && (
        <Section title="Routing Order" count={ri.routing_order.length}>
          <div style={styles.orderedList}>
            {ri.routing_order.map((entry, i) => (
              <div key={i} style={styles.orderItem}>
                <span style={styles.orderNum}>{entry.priority}</span>
                <div style={styles.orderContent}>
                  <span style={styles.orderName}>{entry.net_class}</span>
                  <span style={styles.reasonText}>{entry.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Layer Assignment */}
      {ri.layer_assignment && (
        <Section title="Layer Assignment">
          {ri.layer_assignment.signal_layers && ri.layer_assignment.signal_layers.length > 0 && (
            <div style={styles.subSection}>
              <span style={styles.subSectionTitle}>Signal Layers</span>
              <div style={styles.chipContainer}>
                {ri.layer_assignment.signal_layers.map(l => (
                  <span key={l} style={{
                    ...styles.layerBadge,
                    background: `${theme.layers[l] || theme.textMuted}22`,
                    color: theme.layers[l] || theme.textMuted,
                    borderColor: `${theme.layers[l] || theme.textMuted}44`,
                  }}>
                    {l}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ri.layer_assignment.reference_planes && Object.keys(ri.layer_assignment.reference_planes).length > 0 && (
            <div style={styles.subSection}>
              <span style={styles.subSectionTitle}>Reference Planes</span>
              {Object.entries(ri.layer_assignment.reference_planes).map(([sig, ref]) => (
                <div key={sig} style={styles.refPlaneRow}>
                  <span style={styles.refPlaneSignal}>{sig}</span>
                  <span style={styles.refPlaneArrow}>{'\u2192'}</span>
                  <span style={styles.refPlaneRef}>{ref}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Cost Weights */}
      {ri.cost_weights && Object.keys(ri.cost_weights).length > 0 && (
        <Section title="Cost Weights" count={Object.keys(ri.cost_weights).length} defaultOpen={false}>
          <div style={styles.weightsList}>
            {Object.entries(ri.cost_weights)
              .sort(([, a], [, b]) => b - a)
              .map(([key, value]) => {
                const maxWeight = Math.max(...Object.values(ri.cost_weights!));
                const pct = maxWeight > 0 ? (value / maxWeight) * 100 : 0;
                return (
                  <div key={key} style={styles.weightRow}>
                    <span style={styles.weightLabel}>{key}</span>
                    <div style={styles.weightBarBg}>
                      <div style={{
                        ...styles.weightBarFill,
                        width: `${pct}%`,
                      }} />
                    </div>
                    <span style={styles.weightValue}>{value}</span>
                  </div>
                );
              })}
          </div>
        </Section>
      )}

      {/* Voltage Drop Targets */}
      {ri.voltage_drop_targets && ri.voltage_drop_targets.length > 0 && (
        <Section title="Voltage Drop Targets" count={ri.voltage_drop_targets.length}>
          <div style={styles.table}>
            <div style={styles.tableHeaderRow}>
              <span style={{ ...styles.tableCell, flex: 1 }}>Net</span>
              <span style={{ ...styles.tableCell, flex: 1 }}>Source</span>
              <span style={{ ...styles.tableCell, width: 60 }}>Max Drop</span>
              <span style={{ ...styles.tableCell, width: 60 }}>Max I</span>
            </div>
            {ri.voltage_drop_targets.map((vdt, i) => (
              <div key={i} style={styles.tableRow}>
                <span style={{ ...styles.tableCellValue, flex: 1 }}>{vdt.net}</span>
                <span style={{ ...styles.tableCellValue, flex: 1 }}>{vdt.source}</span>
                <span style={{ ...styles.accentValue, width: 60 }}>
                  {vdt.max_drop_mv}mV
                </span>
                <span style={{ ...styles.accentValue, width: 60 }}>
                  {vdt.max_current_a}A
                </span>
              </div>
            ))}
            {ri.voltage_drop_targets.map((vdt, i) => vdt.sinks.length > 0 ? (
              <div key={`sinks-${i}`} style={styles.reasonRow}>
                <span style={styles.reasonLabel}>{vdt.net} sinks:</span>
                <div style={styles.chipContainer}>
                  {vdt.sinks.map(s => (
                    <span key={s} style={styles.chip}>{s}</span>
                  ))}
                </div>
              </div>
            ) : null)}
          </div>
        </Section>
      )}
    </>
  );

  // ── Main render ────────────────────────────────────────────────

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={{
            ...styles.icon,
            background: type === 'placement'
              ? `linear-gradient(135deg, ${theme.orange}, ${theme.red})`
              : `linear-gradient(135deg, ${theme.green}, ${theme.blue})`,
          }}>
            {type === 'placement' ? 'P' : 'R'}
          </div>
          <span style={styles.title}>
            {type === 'placement' ? 'Placement Intent' : 'Routing Intent'}
          </span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.jsonToggle}
            onClick={() => { setShowRawJson(!showRawJson); setEditMode(false); }}
          >
            {showRawJson ? 'Structured' : 'JSON'}
          </button>
          <button style={styles.closeBtn} onClick={onCancel}>{'\u2715'}</button>
        </div>
      </div>

      {/* Status */}
      <div style={styles.statusBar}>
        <div style={{
          ...styles.statusDot,
          background: isRunning ? theme.orange : theme.green,
        }} />
        <span style={styles.statusText}>
          {isRunning ? 'Solver running...' : 'Ready for review'}
        </span>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {showRawJson || editMode ? (
          <div style={styles.jsonSection}>
            {editMode ? (
              <>
                <textarea
                  style={styles.jsonEditor}
                  value={editedJson}
                  onChange={e => { setEditedJson(e.target.value); setJsonError(''); }}
                  spellCheck={false}
                />
                {jsonError && (
                  <div style={styles.jsonError}>{jsonError}</div>
                )}
                <div style={styles.editActions}>
                  <button style={styles.cancelEditBtn} onClick={() => setEditMode(false)}>
                    Cancel
                  </button>
                  <button style={styles.saveEditBtn} onClick={handleSaveEdit}>
                    Save Changes
                  </button>
                </div>
              </>
            ) : (
              <>
                <pre style={styles.jsonPre}>
                  {JSON.stringify(intent, null, 2)}
                </pre>
                <button style={styles.editJsonBtn} onClick={handleEditToggle}>
                  Edit JSON
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={styles.sections}>
            {type === 'placement'
              ? renderPlacementIntent(intent as PlacementIntent)
              : renderRoutingIntent(intent as RoutingIntent)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <button
          style={styles.cancelBtn}
          onClick={onCancel}
          disabled={isRunning}
        >
          Cancel
        </button>
        <button
          style={{
            ...styles.approveBtn,
            opacity: isRunning ? 0.5 : 1,
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
          onClick={onApprove}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span style={styles.btnSpinner} />
              Solver Running...
            </>
          ) : (
            'Approve & Run Solver'
          )}
        </button>
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 400,
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
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  icon: {
    width: 22,
    height: 22,
    borderRadius: theme.radiusSm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '9px',
    fontWeight: 800,
    fontFamily: theme.fontMono,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  jsonToggle: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 500,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: theme.fontMono,
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

  // Content area
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 10px',
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },

  // Collapsible section
  section: {
    marginBottom: 2,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    border: theme.border,
  },
  sectionTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    flex: 1,
  },
  sectionCount: {
    background: theme.bg3,
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: theme.radiusFull,
    fontFamily: theme.fontMono,
  },
  sectionArrow: {
    color: theme.textMuted,
    fontSize: '10px',
  },
  sectionBody: {
    padding: '6px 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },

  // Card (zones, net classes)
  card: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  cardId: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontMono,
  },
  cardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  cardLabel: {
    color: theme.textMuted,
    fontSize: '9px',
    flexShrink: 0,
  },
  cardValue: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
  },

  // Chips / tags
  chipContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 3,
  },
  chip: {
    background: theme.bg3,
    borderRadius: 2,
    color: theme.textSecondary,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    fontWeight: 600,
  },

  // Badges
  typeBadge: {
    fontSize: '7px',
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
    background: theme.blueDim,
    color: theme.blue,
    textTransform: 'uppercase' as const,
  },
  priorityBadge: {
    fontSize: '7px',
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
    background: theme.orangeDim,
    color: theme.orange,
  },
  warningBadge: {
    fontSize: '8px',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 2,
    background: theme.redDim,
    color: theme.red,
  },
  layerBadge: {
    fontSize: '9px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
    background: theme.purpleDim,
    color: theme.purple,
    border: `1px solid ${theme.purple}44`,
  },
  accentValue: {
    color: theme.orange,
    fontSize: theme.fontXs,
    fontWeight: 700,
    fontFamily: theme.fontMono,
  },
  thermalInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },

  // Table
  table: {
    display: 'flex',
    flexDirection: 'column',
    border: theme.border,
    borderRadius: theme.radiusSm,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    background: theme.bg3,
    padding: '4px 8px',
    gap: 8,
  },
  tableCell: {
    color: theme.textMuted,
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  },
  tableRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    gap: 8,
    borderTop: theme.border,
    background: theme.bg2,
  },
  tableCellValue: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  reasonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    borderTop: theme.border,
    background: theme.bg1,
  },
  reasonLabel: {
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 600,
    flexShrink: 0,
  },
  reasonText: {
    color: theme.textMuted,
    fontSize: '9px',
    lineHeight: 1.4,
  },

  // List items (keepouts, ground planes)
  listItem: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    padding: '5px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  listItemTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },

  // Ordered list (routing order)
  orderedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  orderItem: {
    display: 'flex',
    gap: 8,
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    padding: '5px 8px',
    alignItems: 'flex-start',
  },
  orderNum: {
    color: theme.orange,
    fontSize: theme.fontSm,
    fontWeight: 700,
    fontFamily: theme.fontMono,
    minWidth: 20,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  orderContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  },
  orderName: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
  },

  // Sub-sections (layer assignment)
  subSection: {
    marginBottom: 6,
  },
  subSectionTitle: {
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 600,
    display: 'block',
    marginBottom: 4,
  },
  refPlaneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 8px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    marginBottom: 2,
  },
  refPlaneSignal: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    fontWeight: 600,
  },
  refPlaneArrow: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
  },
  refPlaneRef: {
    color: theme.blue,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    fontWeight: 600,
  },

  // Cost weights bar chart
  weightsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  weightRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  weightLabel: {
    color: theme.textSecondary,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    minWidth: 90,
    textAlign: 'right' as const,
  },
  weightBarBg: {
    flex: 1,
    height: 6,
    background: theme.bg3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  weightBarFill: {
    height: '100%',
    background: `linear-gradient(90deg, ${theme.blue}, ${theme.cyan})`,
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  weightValue: {
    color: theme.orange,
    fontSize: '9px',
    fontWeight: 700,
    fontFamily: theme.fontMono,
    minWidth: 30,
    textAlign: 'right' as const,
  },

  // JSON view
  jsonSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    height: '100%',
  },
  jsonPre: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    lineHeight: 1.5,
    margin: 0,
    padding: '8px 10px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    overflow: 'auto',
    flex: 1,
  },
  jsonEditor: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    lineHeight: 1.5,
    padding: '8px 10px',
    background: theme.bg0,
    borderRadius: theme.radiusSm,
    border: theme.borderFocus,
    whiteSpace: 'pre' as const,
    resize: 'none' as const,
    outline: 'none',
    flex: 1,
    minHeight: 200,
  },
  jsonError: {
    color: theme.red,
    fontSize: '9px',
    padding: '4px 8px',
    background: theme.redDim,
    borderRadius: theme.radiusSm,
  },
  editActions: {
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
  },
  editJsonBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 500,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    alignSelf: 'flex-start',
  },
  cancelEditBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 500,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  saveEditBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}44`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    fontSize: '9px',
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },

  // Bottom actions
  actions: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderTop: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  cancelBtn: {
    flex: 0,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 500,
    padding: '8px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  approveBtn: {
    flex: 1,
    background: `linear-gradient(135deg, ${theme.green}cc, ${theme.green})`,
    border: `1px solid ${theme.green}`,
    borderRadius: theme.radiusSm,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 700,
    padding: '8px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnSpinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: `2px solid rgba(255,255,255,0.3)`,
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default IntentPreview;
