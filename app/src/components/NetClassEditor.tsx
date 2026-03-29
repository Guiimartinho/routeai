// ─── NetClassEditor.tsx ── Net Class management panel ─────────────────────────
// Allows creating, editing, and deleting net classes with per-class electrical
// rules (clearance, trace width, via drill/size), color, and net assignment.
// Integrates with the routingSolver for auto-classification of nets.

import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import type { NetClassRule, DesignRulesConfig, NetOverride } from '../store/designRules';
import type { SchNet } from '../types';
import { generateRoutingConstraints } from '../engine/routingSolver';
import type { NetType } from '../engine/routingSolver';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NetClassEntry extends NetClassRule {
  color: string;
}

interface NetClassEditorProps {
  visible: boolean;
  onClose: () => void;
}

// ─── Default class colors ───────────────────────────────────────────────────

const DEFAULT_CLASS_COLORS: Record<string, string> = {
  Default: '#9ba4b8',
  Power: '#f05060',
  'High-Speed': '#4d9eff',
  Analog: '#3cdc7c',
};

const PALETTE = [
  '#f05060', '#f0a030', '#e0d040', '#3cdc7c', '#40d0e0',
  '#4d9eff', '#a06dff', '#ff6eb4', '#9ba4b8', '#c08060',
];

// ─── Default net classes ────────────────────────────────────────────────────

function createDefaultClasses(): NetClassEntry[] {
  return [
    { name: 'Default', description: 'Default net class for all signals', clearance: 0.2, traceWidth: 0.25, viaDrill: 0.3, viaSize: 0.6, color: '#9ba4b8' },
    { name: 'Power', description: 'Power rails (VCC, GND, 12V, etc.)', clearance: 0.3, traceWidth: 0.5, viaDrill: 0.4, viaSize: 0.8, color: '#f05060' },
    { name: 'High-Speed', description: 'USB, HDMI, Ethernet, clocks', clearance: 0.15, traceWidth: 0.15, viaDrill: 0.2, viaSize: 0.45, color: '#4d9eff' },
    { name: 'Analog', description: 'Sensitive analog signals', clearance: 0.25, traceWidth: 0.2, viaDrill: 0.3, viaSize: 0.6, color: '#3cdc7c' },
  ];
}

// ─── Map solver NetType to net class name ───────────────────────────────────

function netTypeToClassName(type: NetType): string {
  switch (type) {
    case 'power':
    case 'ground':
      return 'Power';
    case 'differential':
    case 'clock':
    case 'high-speed':
    case 'spi':
    case 'i2c':
    case 'uart':
    case 'can':
      return 'High-Speed';
    case 'analog':
      return 'Analog';
    case 'signal':
    default:
      return 'Default';
  }
}

// ─── UID ────────────────────────────────────────────────────────────────────

let _uid = 0;
function uid(): string {
  return `nce_${Date.now()}_${(++_uid).toString(36)}`;
}

// ─── Spinner (number input) ─────────────────────────────────────────────────

interface SpinnerProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  width?: number;
}

const Spinner: React.FC<SpinnerProps> = ({ value, onChange, min = 0.01, max = 10, step = 0.05, width = 72 }) => (
  <input
    type="number"
    value={value}
    min={min}
    max={max}
    step={step}
    onChange={e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    }}
    style={{
      ...s.spinner,
      width,
    }}
  />
);

// ─── Color Picker (simple swatch selector) ─────────────────────────────────

interface ColorPickerProps {
  color: string;
  onChange: (c: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange }) => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        style={{
          ...s.colorSwatch,
          background: color,
        }}
        onClick={() => setOpen(!open)}
        title="Pick color"
      />
      {open && (
        <div style={s.colorPopover}>
          <div style={s.colorGrid}>
            {PALETTE.map(c => (
              <button
                key={c}
                style={{
                  ...s.colorOption,
                  background: c,
                  outline: c === color ? `2px solid ${theme.textPrimary}` : 'none',
                  outlineOffset: 1,
                }}
                onClick={() => { onChange(c); setOpen(false); }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <span style={{ color: theme.textMuted, fontSize: theme.fontXs }}>Custom:</span>
            <input
              type="color"
              value={color}
              onChange={e => { onChange(e.target.value); setOpen(false); }}
              style={{ width: 28, height: 20, border: 'none', cursor: 'pointer', background: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const NetClassEditor: React.FC<NetClassEditorProps> = ({ visible, onClose }) => {
  const { nets, designRules, setDesignRules, schematic } = useProjectStore();

  // Build classes from designRules, augmenting with color
  const initialClasses = useMemo((): NetClassEntry[] => {
    if (designRules.netClasses.length === 0) return createDefaultClasses();
    return designRules.netClasses.map(nc => ({
      ...nc,
      color: DEFAULT_CLASS_COLORS[nc.name] || PALETTE[Math.abs(hashStr(nc.name)) % PALETTE.length],
    }));
  }, [designRules.netClasses]);

  const [classes, setClasses] = useState<NetClassEntry[]>(initialClasses);
  const [netAssignments, setNetAssignments] = useState<Record<string, string>>(() => {
    // Build initial assignments from netOverrides
    const map: Record<string, string> = {};
    for (const ov of designRules.netOverrides) {
      if (ov.netClass) map[ov.netId] = ov.netClass;
    }
    return map;
  });
  const [autoClassifying, setAutoClassifying] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [newNameValue, setNewNameValue] = useState('');

  // Count nets per class
  const netCountByClass = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cls of classes) counts[cls.name] = 0;
    for (const net of nets) {
      const assigned = netAssignments[net.id] || 'Default';
      if (counts[assigned] !== undefined) {
        counts[assigned]++;
      } else {
        counts['Default'] = (counts['Default'] || 0) + 1;
      }
    }
    return counts;
  }, [classes, nets, netAssignments]);

  // Update a class property
  const updateClass = useCallback((name: string, patch: Partial<NetClassEntry>) => {
    setClasses(prev => prev.map(c => c.name === name ? { ...c, ...patch } : c));
  }, []);

  // Add a new class
  const addClass = useCallback(() => {
    const baseName = 'NewClass';
    let name = baseName;
    let i = 1;
    while (classes.some(c => c.name === name)) {
      name = `${baseName}_${i++}`;
    }
    setClasses(prev => [
      ...prev,
      {
        name,
        description: '',
        clearance: 0.2,
        traceWidth: 0.25,
        viaDrill: 0.3,
        viaSize: 0.6,
        color: PALETTE[prev.length % PALETTE.length],
      },
    ]);
  }, [classes]);

  // Remove a class (cannot remove Default)
  const removeClass = useCallback((name: string) => {
    if (name === 'Default') return;
    setClasses(prev => prev.filter(c => c.name !== name));
    // Reassign nets from the removed class to Default
    setNetAssignments(prev => {
      const next = { ...prev };
      for (const [netId, cls] of Object.entries(next)) {
        if (cls === name) next[netId] = 'Default';
      }
      return next;
    });
  }, []);

  // Rename a class
  const startRename = useCallback((name: string) => {
    if (name === 'Default') return;
    setEditingName(name);
    setNewNameValue(name);
  }, []);

  const finishRename = useCallback(() => {
    if (!editingName || !newNameValue.trim()) {
      setEditingName(null);
      return;
    }
    const trimmed = newNameValue.trim();
    if (trimmed === editingName) {
      setEditingName(null);
      return;
    }
    // Avoid duplicates
    if (classes.some(c => c.name === trimmed)) {
      setEditingName(null);
      return;
    }
    setClasses(prev => prev.map(c => c.name === editingName ? { ...c, name: trimmed } : c));
    setNetAssignments(prev => {
      const next: Record<string, string> = {};
      for (const [netId, cls] of Object.entries(prev)) {
        next[netId] = cls === editingName ? trimmed : cls;
      }
      return next;
    });
    setEditingName(null);
  }, [editingName, newNameValue, classes]);

  // Assign a net to a class
  const assignNet = useCallback((netId: string, className: string) => {
    setNetAssignments(prev => ({ ...prev, [netId]: className }));
  }, []);

  // Auto-classify using routing solver
  const handleAutoClassify = useCallback(() => {
    if (nets.length === 0) return;
    setAutoClassifying(true);

    // Ensure we have the 4 default classes
    setClasses(prev => {
      const names = new Set(prev.map(c => c.name));
      const defaults = createDefaultClasses();
      const merged = [...prev];
      for (const dc of defaults) {
        if (!names.has(dc.name)) merged.push(dc);
      }
      return merged;
    });

    try {
      const constraints = generateRoutingConstraints(nets, schematic.components, 2);
      const newAssignments: Record<string, string> = {};
      for (const np of constraints.netPriorities) {
        newAssignments[np.netId] = netTypeToClassName(np.type);
      }
      setNetAssignments(newAssignments);
    } catch (err) {
      console.error('Auto-classify failed:', err);
    }

    setAutoClassifying(false);
  }, [nets, schematic.components]);

  // Apply changes to the store
  const handleApply = useCallback(() => {
    const netClasses: NetClassRule[] = classes.map(({ color: _color, ...rest }) => rest);
    const netOverrides: NetOverride[] = [];
    for (const [netId, className] of Object.entries(netAssignments)) {
      const net = nets.find(n => n.id === netId);
      if (!net) continue;
      const cls = classes.find(c => c.name === className);
      if (!cls || className === 'Default') continue;
      netOverrides.push({
        netId,
        netName: net.name,
        netClass: className,
        clearance: cls.clearance,
        traceWidth: cls.traceWidth,
        viaDrill: cls.viaDrill,
        viaSize: cls.viaSize,
      });
    }
    const config: DesignRulesConfig = {
      ...designRules,
      netClasses,
      netOverrides,
    };
    setDesignRules(config);
    onClose();
  }, [classes, netAssignments, nets, designRules, setDesignRules, onClose]);

  if (!visible) return null;

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>Net Class Editor</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              style={{
                ...s.headerBtn,
                color: theme.cyan,
                borderColor: theme.cyan,
                opacity: autoClassifying ? 0.5 : 1,
              }}
              onClick={handleAutoClassify}
              disabled={autoClassifying || nets.length === 0}
              title="Auto-classify nets using pattern matching"
            >
              {autoClassifying ? 'Classifying...' : 'Auto-Detect'}
            </button>
            <button style={s.closeBtn} onClick={onClose}>{'\u2715'}</button>
          </div>
        </div>

        {/* Net Class Table */}
        <div style={s.tableWrapper}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Name</th>
                <th style={{ ...s.th, width: 85 }}>Clearance (mm)</th>
                <th style={{ ...s.th, width: 85 }}>Trace W (mm)</th>
                <th style={{ ...s.th, width: 85 }}>Via Drill (mm)</th>
                <th style={{ ...s.th, width: 85 }}>Via Size (mm)</th>
                <th style={{ ...s.th, width: 50 }}>Color</th>
                <th style={{ ...s.th, width: 50 }}>Nets</th>
                <th style={{ ...s.th, width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {classes.map(cls => (
                <tr key={cls.name} style={s.tr}>
                  <td style={s.td}>
                    {editingName === cls.name ? (
                      <input
                        style={s.nameInput}
                        value={newNameValue}
                        autoFocus
                        onChange={e => setNewNameValue(e.target.value)}
                        onBlur={finishRename}
                        onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setEditingName(null); }}
                      />
                    ) : (
                      <span
                        style={{
                          ...s.className,
                          cursor: cls.name !== 'Default' ? 'pointer' : 'default',
                          borderLeft: `3px solid ${cls.color}`,
                          paddingLeft: 6,
                        }}
                        onDoubleClick={() => startRename(cls.name)}
                        title={cls.description || cls.name}
                      >
                        {cls.name}
                      </span>
                    )}
                  </td>
                  <td style={s.td}>
                    <Spinner value={cls.clearance} onChange={v => updateClass(cls.name, { clearance: v })} step={0.05} />
                  </td>
                  <td style={s.td}>
                    <Spinner value={cls.traceWidth} onChange={v => updateClass(cls.name, { traceWidth: v })} step={0.05} />
                  </td>
                  <td style={s.td}>
                    <Spinner value={cls.viaDrill} onChange={v => updateClass(cls.name, { viaDrill: v })} step={0.05} />
                  </td>
                  <td style={s.td}>
                    <Spinner value={cls.viaSize} onChange={v => updateClass(cls.name, { viaSize: v })} step={0.05} />
                  </td>
                  <td style={s.td}>
                    <ColorPicker color={cls.color} onChange={c => updateClass(cls.name, { color: c })} />
                  </td>
                  <td style={{ ...s.td, textAlign: 'center' }}>
                    <span style={s.netCount}>{netCountByClass[cls.name] || 0}</span>
                  </td>
                  <td style={s.td}>
                    {cls.name !== 'Default' && (
                      <button
                        style={s.removeBtn}
                        onClick={() => removeClass(cls.name)}
                        title="Remove class"
                      >
                        {'\u2715'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Class Button */}
        <div style={{ padding: '0 16px 8px' }}>
          <button style={s.addBtn} onClick={addClass}>
            + Add Net Class
          </button>
        </div>

        {/* Net Assignment Section */}
        <div style={s.sectionHeader}>
          <span>Net Assignments</span>
          <span style={s.sectionCount}>{nets.length} nets</span>
        </div>
        <div style={s.netListWrapper}>
          {nets.length === 0 ? (
            <div style={s.emptyMsg}>
              No nets found. Run netlist extraction first (Schematic editor).
            </div>
          ) : (
            <table style={s.netTable}>
              <thead>
                <tr>
                  <th style={s.netTh}>Net Name</th>
                  <th style={s.netTh}>Pins</th>
                  <th style={{ ...s.netTh, width: 140 }}>Class</th>
                </tr>
              </thead>
              <tbody>
                {nets.map(net => {
                  const assignedClass = netAssignments[net.id] || 'Default';
                  const classDef = classes.find(c => c.name === assignedClass);
                  return (
                    <tr key={net.id} style={s.netTr}>
                      <td style={s.netTd}>
                        <span style={{
                          borderLeft: `3px solid ${classDef?.color || '#9ba4b8'}`,
                          paddingLeft: 6,
                        }}>
                          {net.name}
                        </span>
                      </td>
                      <td style={{ ...s.netTd, textAlign: 'center', color: theme.textMuted }}>
                        {net.pins.length}
                      </td>
                      <td style={s.netTd}>
                        <select
                          style={s.netClassSelect}
                          value={assignedClass}
                          onChange={e => assignNet(net.id, e.target.value)}
                        >
                          {classes.map(c => (
                            <option key={c.name} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.applyBtn} onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
};

// ─── Simple string hash for deterministic color assignment ──────────────────

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: theme.bg1,
    border: theme.border,
    borderRadius: theme.radiusLg,
    boxShadow: theme.shadowLg,
    width: 760,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  title: {
    fontSize: theme.fontLg,
    fontWeight: 700,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
  },
  headerBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    fontSize: theme.fontXs,
    fontWeight: 600,
    fontFamily: theme.fontSans,
    padding: '4px 10px',
    cursor: 'pointer',
    height: 26,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
  },

  // Table
  tableWrapper: {
    overflowX: 'auto',
    padding: '8px 16px',
    flexShrink: 0,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: theme.fontSans,
    fontSize: theme.fontSm,
  },
  th: {
    textAlign: 'left',
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '6px 4px',
    borderBottom: `1px solid ${theme.bg3}`,
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: `1px solid ${theme.bg2}`,
  },
  td: {
    padding: '5px 4px',
    verticalAlign: 'middle',
  },
  className: {
    fontWeight: 600,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
  },
  nameInput: {
    background: theme.bg3,
    border: theme.borderFocus,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    padding: '2px 6px',
    width: '100%',
    outline: 'none',
  },
  spinner: {
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 4px',
    textAlign: 'right' as const,
    outline: 'none',
    height: 24,
  },
  colorSwatch: {
    width: 22,
    height: 22,
    borderRadius: theme.radiusSm,
    border: `1px solid ${theme.bg3}`,
    cursor: 'pointer',
    padding: 0,
  },
  colorPopover: {
    position: 'absolute',
    top: 28,
    left: 0,
    background: theme.bg1,
    border: theme.border,
    borderRadius: theme.radiusMd,
    padding: 8,
    zIndex: 200,
    boxShadow: theme.shadowLg,
  },
  colorGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: 4,
  },
  colorOption: {
    width: 22,
    height: 22,
    borderRadius: 3,
    border: '1px solid transparent',
    cursor: 'pointer',
    padding: 0,
  },
  netCount: {
    display: 'inline-block',
    background: theme.bg3,
    borderRadius: theme.radiusFull,
    padding: '1px 8px',
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textSecondary,
    fontWeight: 600,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 13,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 3,
  },
  addBtn: {
    background: theme.bg2,
    border: `1px dashed ${theme.bg3}`,
    borderRadius: theme.radiusSm,
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    padding: '5px 12px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center' as const,
  },

  // Net assignments section
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px 4px',
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontWeight: 700,
    fontFamily: theme.fontSans,
    borderTop: theme.border,
    flexShrink: 0,
  },
  sectionCount: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontWeight: 400,
    fontFamily: theme.fontMono,
  },
  netListWrapper: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 16px 8px',
    minHeight: 80,
    maxHeight: 240,
  },
  netTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: theme.fontSans,
    fontSize: theme.fontXs,
  },
  netTh: {
    textAlign: 'left',
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 600,
    padding: '4px 4px',
    borderBottom: `1px solid ${theme.bg3}`,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  netTr: {
    borderBottom: `1px solid ${theme.bg2}`,
  },
  netTd: {
    padding: '3px 4px',
    verticalAlign: 'middle',
    color: theme.textPrimary,
  },
  netClassSelect: {
    background: theme.bg2,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    padding: '2px 4px',
    cursor: 'pointer',
    width: '100%',
    height: 22,
  },
  emptyMsg: {
    textAlign: 'center' as const,
    color: theme.textMuted,
    fontSize: theme.fontSm,
    padding: '20px 0',
  },

  // Footer
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '10px 16px',
    borderTop: theme.border,
    flexShrink: 0,
  },
  cancelBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    padding: '6px 18px',
    cursor: 'pointer',
  },
  applyBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    fontWeight: 700,
    padding: '6px 22px',
    cursor: 'pointer',
  },
};

export default NetClassEditor;
