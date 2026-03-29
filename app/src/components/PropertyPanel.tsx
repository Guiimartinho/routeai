// ─── PropertyPanel.tsx ─ Right side properties panel ───────────────────────
import React, { useState, useCallback, useEffect } from 'react';
import type { SchComponent } from '../types';
import { theme } from '../styles/theme';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { SymbolThumbnail } from './SymbolLibrary';

// ─── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    width: theme.sidebarWidth,
    minWidth: theme.panelMinWidth,
    height: '100%',
    background: theme.bg1,
    borderLeft: theme.border,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    userSelect: 'none',
  },
  header: {
    padding: `${theme.sp2} ${theme.sp3}`,
    borderBottom: theme.border,
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: theme.sp2,
  },
  section: {
    marginBottom: theme.sp3,
  },
  sectionTitle: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    marginBottom: theme.sp1,
    paddingBottom: theme.sp1,
    borderBottom: theme.border,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp2,
    marginBottom: theme.sp1,
  },
  label: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
    width: '70px',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: `${theme.sp1} ${theme.sp2}`,
    background: theme.bg0,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  readOnly: {
    flex: 1,
    padding: `${theme.sp1} ${theme.sp2}`,
    fontSize: theme.fontSm,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
  },
  button: {
    padding: `${theme.sp1} ${theme.sp3}`,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    cursor: 'pointer',
    transition: 'background 0.1s',
    width: '100%',
    textAlign: 'center' as const,
  },
  emptyState: {
    padding: theme.sp6,
    color: theme.textMuted,
    fontSize: theme.fontSm,
    textAlign: 'center' as const,
    fontFamily: theme.fontSans,
    lineHeight: '1.6',
  },
  thumbnail: {
    display: 'flex',
    justifyContent: 'center',
    padding: theme.sp2,
    marginBottom: theme.sp2,
    background: theme.bg0,
    borderRadius: theme.radiusMd,
    border: theme.border,
  },
  pinRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp2,
    padding: `2px ${theme.sp2}`,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textSecondary,
    borderBottom: `1px solid ${theme.bg2}`,
  },
  pinNumber: {
    color: theme.textMuted,
    width: '20px',
  },
  pinName: {
    flex: 1,
    color: theme.textPrimary,
  },
  pinNet: {
    color: theme.schWire,
    fontSize: theme.fontXs,
  },
  multiHeader: {
    padding: theme.sp3,
    textAlign: 'center' as const,
    color: theme.textSecondary,
    fontSize: theme.fontMd,
    fontFamily: theme.fontSans,
    fontWeight: 600,
  },
};

// ─── Component ─────────────────────────────────────────────────────────────
const PropertyPanel: React.FC = () => {
  const { selectedIds } = useEditorStore();
  const { schematic, nets, updateSchComponent: updateComponent } = useProjectStore();
  const { components, wires, labels } = schematic;

  const selectedComponents = components.filter(c => selectedIds.includes(c.id));
  const selectedWires = wires.filter(w => selectedIds.includes(w.id));
  const selectedLabels = labels.filter(l => selectedIds.includes(l.id));
  const totalSelected = selectedIds.length;

  // Single component editing
  const [editRef, setEditRef] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editFootprint, setEditFootprint] = useState('');

  const comp = selectedComponents.length === 1 ? selectedComponents[0] : null;

  useEffect(() => {
    if (comp) {
      setEditRef(comp.ref);
      setEditValue(comp.value);
      setEditFootprint(comp.footprint);
    }
  }, [comp?.id, comp?.ref, comp?.value, comp?.footprint]);

  const handleRefChange = useCallback((val: string) => {
    setEditRef(val);
    if (comp) updateComponent(comp.id, { ref: val });
  }, [comp, updateComponent]);

  const handleValueChange = useCallback((val: string) => {
    setEditValue(val);
    if (comp) updateComponent(comp.id, { value: val });
  }, [comp, updateComponent]);

  const handleFootprintChange = useCallback((val: string) => {
    setEditFootprint(val);
    if (comp) updateComponent(comp.id, { footprint: val });
  }, [comp, updateComponent]);

  // Nothing selected
  if (totalSelected === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Properties</div>
        <div style={styles.emptyState}>
          Select a component, wire, or label to view its properties.
          <br /><br />
          <span style={{ color: theme.textMuted, fontSize: theme.fontXs }}>
            Tip: Click to select, Shift+click for multi-select
          </span>
        </div>
      </div>
    );
  }

  // Multiple selection
  if (totalSelected > 1) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Properties</div>
        <div style={styles.body}>
          <div style={styles.multiHeader}>
            {totalSelected} items selected
          </div>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Selection</div>
            {selectedComponents.length > 0 && (
              <div style={styles.row}>
                <span style={styles.label}>Components</span>
                <span style={styles.readOnly}>{selectedComponents.length}</span>
              </div>
            )}
            {selectedWires.length > 0 && (
              <div style={styles.row}>
                <span style={styles.label}>Wires</span>
                <span style={styles.readOnly}>{selectedWires.length}</span>
              </div>
            )}
            {selectedLabels.length > 0 && (
              <div style={styles.row}>
                <span style={styles.label}>Labels</span>
                <span style={styles.readOnly}>{selectedLabels.length}</span>
              </div>
            )}
          </div>

          {/* Common value editing for multiple components */}
          {selectedComponents.length > 1 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Common Properties</div>
              <div style={styles.row}>
                <span style={styles.label}>Value</span>
                <input
                  style={styles.input}
                  placeholder="(mixed)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      selectedComponents.forEach(c => updateComponent(c.id, { value: val }));
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Single component
  if (comp) {
    const compNets = comp.pins
      .filter(p => p.netId)
      .map(p => {
        const net = nets.find(n => n.id === p.netId);
        return { pin: p, netName: net?.name || p.netId || '' };
      });

    return (
      <div style={styles.container}>
        <div style={styles.header}>Properties</div>
        <div style={styles.body}>
          {/* Thumbnail */}
          <div style={styles.thumbnail}>
            <SymbolThumbnail type={comp.symbol || comp.type} size={56} />
          </div>

          {/* Editable fields */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Identification</div>
            <div style={styles.row}>
              <span style={styles.label}>Reference</span>
              <input
                style={styles.input}
                value={editRef}
                onChange={(e) => handleRefChange(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Value</span>
              <input
                style={styles.input}
                value={editValue}
                onChange={(e) => handleValueChange(e.target.value)}
              />
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Footprint</span>
              <input
                style={styles.input}
                value={editFootprint}
                onChange={(e) => handleFootprintChange(e.target.value)}
              />
            </div>
          </div>

          {/* Read-only position */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Position</div>
            <div style={styles.row}>
              <span style={styles.label}>X</span>
              <span style={styles.readOnly}>{comp.x.toFixed(2)} mm</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Y</span>
              <span style={styles.readOnly}>{comp.y.toFixed(2)} mm</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Rotation</span>
              <span style={styles.readOnly}>{comp.rotation}&deg;</span>
            </div>
          </div>

          {/* Pin connections */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Pins ({comp.pins.length})</div>
            {comp.pins.map((p, i) => (
              <div key={i} style={styles.pinRow}>
                <span style={styles.pinNumber}>{p.number}</span>
                <span style={styles.pinName}>{p.name}</span>
                <span style={styles.pinNet}>
                  {p.netId ? (nets.find(n => n.id === p.netId)?.name || p.netId) : '---'}
                </span>
              </div>
            ))}
          </div>

          {/* Datasheet button */}
          <div style={styles.section}>
            <button
              style={styles.button}
              onClick={() => {
                // Placeholder: would open datasheet URL
                alert(`Open datasheet for ${comp.ref} (${comp.type})`);
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = theme.bg2; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = theme.bg3; }}
            >
              Open Datasheet
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Single wire or label selected
  const wire = selectedWires.length === 1 ? selectedWires[0] : null;
  const lbl = selectedLabels.length === 1 ? selectedLabels[0] : null;

  if (wire) {
    const net = wire.netId ? nets.find(n => n.id === wire.netId) : null;
    return (
      <div style={styles.container}>
        <div style={styles.header}>Properties</div>
        <div style={styles.body}>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Wire</div>
            <div style={styles.row}>
              <span style={styles.label}>ID</span>
              <span style={styles.readOnly}>{wire.id}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Net</span>
              <span style={{ ...styles.readOnly, color: theme.schWire }}>
                {net?.name || 'Unassigned'}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Points</span>
              <span style={styles.readOnly}>{wire.points.length}</span>
            </div>
            {wire.points.map((p, i) => (
              <div key={i} style={styles.row}>
                <span style={styles.label}>  [{i}]</span>
                <span style={styles.readOnly}>{p.x.toFixed(2)}, {p.y.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (lbl) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>Properties</div>
        <div style={styles.body}>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Label</div>
            <div style={styles.row}>
              <span style={styles.label}>Text</span>
              <span style={styles.readOnly}>{lbl.text}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Type</span>
              <span style={styles.readOnly}>{lbl.type}</span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>Position</span>
              <span style={styles.readOnly}>{lbl.x.toFixed(2)}, {lbl.y.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>Properties</div>
      <div style={styles.emptyState}>Unknown selection</div>
    </div>
  );
};

export default PropertyPanel;
