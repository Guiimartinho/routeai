// ─── DRCConfigDialog.tsx ── Modal for configuring DRC rules ──────────────────
import React, { useState, useCallback, useEffect } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import type {
  DesignRulesConfig,
  DesignRule,
  NetClassRule,
} from '../store/designRules';
import { defaultGlobalRules, defaultNetClass } from '../store/designRules';

// ─── Preset Definitions ──────────────────────────────────────────────────────

type PresetName =
  | 'IPC Class 2'
  | 'IPC Class 3'
  | 'JLCPCB Standard'
  | 'JLCPCB Advanced'
  | 'PCBWay'
  | 'OSH Park';

interface ManufacturingExtras {
  minSilkWidth: number;
  minSolderMaskOpening: number;
  acidTrapAngle: number;
  microViaDrill: number;
  blindBuried: boolean;
}

const DEFAULT_MFG_EXTRAS: ManufacturingExtras = {
  minSilkWidth: 0.15,
  minSolderMaskOpening: 0.05,
  acidTrapAngle: 90,
  microViaDrill: 0.1,
  blindBuried: false,
};

interface PresetData {
  global: DesignRule;
  mfg: ManufacturingExtras;
  netClasses: NetClassRule[];
}

const PRESETS: Record<PresetName, PresetData> = {
  'IPC Class 2': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.2,
      minTraceWidth: 0.2,
      maxTraceWidth: 5.0,
      preferredTraceWidth: 0.25,
      minViaDrill: 0.25,
      minViaAnnularRing: 0.125,
      preferredViaSize: 0.6,
      preferredViaDrill: 0.3,
      minThroughHole: 0.25,
      minAnnularRing: 0.125,
      copperToEdgeClearance: 0.25,
      silkToPadClearance: 0.15,
    },
    mfg: { minSilkWidth: 0.15, minSolderMaskOpening: 0.05, acidTrapAngle: 90, microViaDrill: 0.15, blindBuried: false },
    netClasses: [defaultNetClass()],
  },
  'IPC Class 3': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.1,
      minTraceWidth: 0.1,
      maxTraceWidth: 5.0,
      preferredTraceWidth: 0.15,
      minViaDrill: 0.15,
      minViaAnnularRing: 0.075,
      preferredViaSize: 0.45,
      preferredViaDrill: 0.2,
      minThroughHole: 0.15,
      minAnnularRing: 0.075,
      copperToEdgeClearance: 0.2,
      silkToPadClearance: 0.1,
    },
    mfg: { minSilkWidth: 0.1, minSolderMaskOpening: 0.04, acidTrapAngle: 60, microViaDrill: 0.1, blindBuried: true },
    netClasses: [{ ...defaultNetClass(), clearance: 0.1, traceWidth: 0.15, viaDrill: 0.2, viaSize: 0.45 }],
  },
  'JLCPCB Standard': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.2,
      minTraceWidth: 0.127,
      maxTraceWidth: 5.0,
      preferredTraceWidth: 0.25,
      minViaDrill: 0.3,
      minViaAnnularRing: 0.125,
      preferredViaSize: 0.6,
      preferredViaDrill: 0.3,
      minThroughHole: 0.3,
      minAnnularRing: 0.125,
      copperToEdgeClearance: 0.3,
      silkToPadClearance: 0.15,
    },
    mfg: { minSilkWidth: 0.15, minSolderMaskOpening: 0.05, acidTrapAngle: 90, microViaDrill: 0.2, blindBuried: false },
    netClasses: [defaultNetClass()],
  },
  'JLCPCB Advanced': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.1,
      minTraceWidth: 0.09,
      maxTraceWidth: 5.0,
      preferredTraceWidth: 0.15,
      minViaDrill: 0.15,
      minViaAnnularRing: 0.075,
      preferredViaSize: 0.4,
      preferredViaDrill: 0.2,
      minThroughHole: 0.15,
      minAnnularRing: 0.075,
      copperToEdgeClearance: 0.2,
      silkToPadClearance: 0.1,
    },
    mfg: { minSilkWidth: 0.1, minSolderMaskOpening: 0.04, acidTrapAngle: 60, microViaDrill: 0.1, blindBuried: true },
    netClasses: [{ ...defaultNetClass(), clearance: 0.1, traceWidth: 0.15, viaDrill: 0.2, viaSize: 0.4 }],
  },
  'PCBWay': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.15,
      minTraceWidth: 0.1,
      maxTraceWidth: 6.0,
      preferredTraceWidth: 0.2,
      minViaDrill: 0.2,
      minViaAnnularRing: 0.1,
      preferredViaSize: 0.5,
      preferredViaDrill: 0.25,
      minThroughHole: 0.2,
      minAnnularRing: 0.1,
      copperToEdgeClearance: 0.25,
      silkToPadClearance: 0.12,
    },
    mfg: { minSilkWidth: 0.12, minSolderMaskOpening: 0.05, acidTrapAngle: 90, microViaDrill: 0.1, blindBuried: true },
    netClasses: [{ ...defaultNetClass(), clearance: 0.15, traceWidth: 0.2, viaDrill: 0.25, viaSize: 0.5 }],
  },
  'OSH Park': {
    global: {
      ...defaultGlobalRules(),
      clearance: 0.15,
      minTraceWidth: 0.127,
      maxTraceWidth: 5.0,
      preferredTraceWidth: 0.254,
      minViaDrill: 0.254,
      minViaAnnularRing: 0.127,
      preferredViaSize: 0.6,
      preferredViaDrill: 0.33,
      minThroughHole: 0.254,
      minAnnularRing: 0.127,
      copperToEdgeClearance: 0.381,
      silkToPadClearance: 0.15,
    },
    mfg: { minSilkWidth: 0.15, minSolderMaskOpening: 0.05, acidTrapAngle: 90, microViaDrill: 0.15, blindBuried: false },
    netClasses: [{ ...defaultNetClass(), clearance: 0.15, traceWidth: 0.254, viaDrill: 0.33, viaSize: 0.6 }],
  },
};

const PRESET_NAMES: PresetName[] = [
  'IPC Class 2', 'IPC Class 3',
  'JLCPCB Standard', 'JLCPCB Advanced',
  'PCBWay', 'OSH Park',
];

// ─── Tab Types ───────────────────────────────────────────────────────────────

type TabId = 'clearance' | 'trace' | 'via' | 'manufacturing' | 'netclasses';

interface TabDef {
  id: TabId;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'clearance', label: 'Clearance' },
  { id: 'trace', label: 'Trace Width' },
  { id: 'via', label: 'Via' },
  { id: 'manufacturing', label: 'Manufacturing' },
  { id: 'netclasses', label: 'Net Classes' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface DRCConfigDialogProps {
  open: boolean;
  onClose: () => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    fontFamily: theme.fontSans,
  },
  dialog: {
    background: theme.bg1,
    borderRadius: theme.radiusLg,
    border: theme.border,
    boxShadow: theme.shadowLg,
    width: 620,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    color: theme.textPrimary,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  headerTitle: {
    fontSize: theme.fontLg,
    fontWeight: 600,
  },
  presetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderBottom: `1px solid ${theme.bg3}`,
    fontSize: theme.fontSm,
  },
  select: {
    background: theme.bg2,
    color: theme.textPrimary,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '4px 8px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    cursor: 'pointer',
    outline: 'none',
    flex: 1,
    maxWidth: 220,
  },
  tabBar: {
    display: 'flex',
    gap: '0px',
    borderBottom: `1px solid ${theme.bg3}`,
    padding: '0 16px',
    background: theme.bg0,
  },
  tab: {
    padding: '8px 14px',
    fontSize: theme.fontSm,
    fontWeight: 500,
    fontFamily: theme.fontSans,
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    color: theme.textMuted,
    borderBottom: '2px solid transparent',
    transition: 'all 0.15s ease',
  },
  tabActive: {
    color: theme.blue,
    borderBottomColor: theme.blue,
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
  },
  fieldGroup: {
    marginBottom: '16px',
  },
  fieldGroupTitle: {
    fontSize: '10px',
    fontWeight: 600,
    color: theme.textSecondary,
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 0',
    gap: '12px',
  },
  fieldLabel: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    flex: 1,
  },
  spinner: {
    width: 90,
    background: theme.bg2,
    color: theme.textPrimary,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '4px 8px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    textAlign: 'right' as const,
    outline: 'none',
  },
  unit: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    width: 24,
    textAlign: 'left' as const,
  },
  toggle: {
    position: 'relative' as const,
    width: 36,
    height: 20,
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background 0.2s ease',
    border: 'none',
    flexShrink: 0,
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s ease',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: `1px solid ${theme.bg3}`,
  },
  btn: {
    padding: '6px 16px',
    fontSize: theme.fontSm,
    fontWeight: 500,
    fontFamily: theme.fontSans,
    borderRadius: theme.radiusMd,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  btnPrimary: {
    background: theme.blue,
    color: '#fff',
  },
  btnCancel: {
    background: theme.bg3,
    color: theme.textSecondary,
  },
  // Net class table
  ncTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: theme.fontSm,
  },
  ncTh: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    fontSize: '10px',
    color: theme.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  ncTd: {
    padding: '4px 8px',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  ncInput: {
    width: 60,
    background: theme.bg2,
    color: theme.textPrimary,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '3px 6px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    textAlign: 'right' as const,
    outline: 'none',
  },
  ncNameInput: {
    width: 100,
    background: theme.bg2,
    color: theme.textPrimary,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '3px 6px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    outline: 'none',
  },
  addBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    fontWeight: 500,
    borderRadius: theme.radiusSm,
    border: `1px dashed ${theme.bg3}`,
    background: 'transparent',
    color: theme.textMuted,
    cursor: 'pointer',
    marginTop: '8px',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px 4px',
    borderRadius: theme.radiusSm,
  },
};

// ─── Spinner Input ───────────────────────────────────────────────────────────

const SpinnerInput: React.FC<{
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ value, onChange, min = 0, max = 100, step = 0.01, unit = 'mm' }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
    <input
      type="number"
      style={s.spinner}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = theme.blue; }}
      onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = theme.bg3; }}
    />
    <span style={s.unit}>{unit}</span>
  </div>
);

// ─── Toggle Switch ───────────────────────────────────────────────────────────

const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ checked, onChange }) => (
  <button
    type="button"
    style={{
      ...s.toggle,
      background: checked ? theme.blue : theme.bg3,
    }}
    onClick={() => onChange(!checked)}
  >
    <div style={{ ...s.toggleKnob, left: checked ? 18 : 2 }} />
  </button>
);

// ─── Field Row Component ─────────────────────────────────────────────────────

const Field: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}> = ({ label, value, onChange, min, max, step, unit }) => (
  <div style={s.fieldRow}>
    <span style={s.fieldLabel}>{label}</span>
    <SpinnerInput value={value} onChange={onChange} min={min} max={max} step={step} unit={unit} />
  </div>
);

// ─── Main Component ──────────────────────────────────────────────────────────

const DRCConfigDialog: React.FC<DRCConfigDialogProps> = ({ open, onClose }) => {
  const designRules = useProjectStore((st) => st.designRules);
  const setDesignRules = useProjectStore((st) => st.setDesignRules);

  const [activeTab, setActiveTab] = useState<TabId>('clearance');
  const [draft, setDraft] = useState<DesignRulesConfig>(() => structuredClone(designRules));
  const [mfgExtras, setMfgExtras] = useState<ManufacturingExtras>(() => ({ ...DEFAULT_MFG_EXTRAS }));
  const [selectedPreset, setSelectedPreset] = useState<string>('');

  // Reset draft when dialog opens
  useEffect(() => {
    if (open) {
      setDraft(structuredClone(designRules));
      setSelectedPreset('');
    }
  }, [open, designRules]);

  // ── Global rule updater ──
  const updateGlobal = useCallback(<K extends keyof DesignRule>(key: K, value: DesignRule[K]) => {
    setDraft((prev) => ({
      ...prev,
      global: { ...prev.global, [key]: value },
    }));
    setSelectedPreset('');
  }, []);

  // ── Mfg extras updater ──
  const updateMfg = useCallback(<K extends keyof ManufacturingExtras>(key: K, value: ManufacturingExtras[K]) => {
    setMfgExtras((prev) => ({ ...prev, [key]: value }));
    setSelectedPreset('');
  }, []);

  // ── Net class updater ──
  const updateNetClass = useCallback((idx: number, patch: Partial<NetClassRule>) => {
    setDraft((prev) => {
      const ncs = [...prev.netClasses];
      ncs[idx] = { ...ncs[idx], ...patch };
      return { ...prev, netClasses: ncs };
    });
    setSelectedPreset('');
  }, []);

  const addNetClass = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      netClasses: [
        ...prev.netClasses,
        {
          name: `Class ${prev.netClasses.length}`,
          description: '',
          clearance: prev.global.clearance,
          traceWidth: prev.global.preferredTraceWidth,
          viaDrill: prev.global.preferredViaDrill,
          viaSize: prev.global.preferredViaSize,
        },
      ],
    }));
  }, []);

  const removeNetClass = useCallback((idx: number) => {
    setDraft((prev) => {
      if (prev.netClasses.length <= 1) return prev; // keep at least one
      const ncs = prev.netClasses.filter((_, i) => i !== idx);
      return { ...prev, netClasses: ncs };
    });
  }, []);

  // ── Preset application ──
  const applyPreset = useCallback((name: string) => {
    setSelectedPreset(name);
    const preset = PRESETS[name as PresetName];
    if (!preset) return;
    setDraft((prev) => ({
      ...prev,
      global: { ...preset.global },
      netClasses: preset.netClasses.map((nc) => ({ ...nc })),
    }));
    setMfgExtras({ ...preset.mfg });
  }, []);

  // ── Save ──
  const handleSave = useCallback(() => {
    setDesignRules(draft);
    onClose();
  }, [draft, setDesignRules, onClose]);

  // ── Close on Escape ──
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const g = draft.global;

  // ── Tab content renderers ──

  const renderClearanceTab = () => (
    <div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Copper Clearances</div>
        <Field label="Min copper-to-copper" value={g.clearance} onChange={(v) => updateGlobal('clearance', v)} />
        <Field label="Pad-to-pad clearance" value={g.padToPadClearance} onChange={(v) => updateGlobal('padToPadClearance', v)} />
        <Field label="Pad-to-track clearance" value={g.padToTrackClearance} onChange={(v) => updateGlobal('padToTrackClearance', v)} />
        <Field label="Track-to-track clearance" value={g.trackToTrackClearance} onChange={(v) => updateGlobal('trackToTrackClearance', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Edge &amp; Silkscreen</div>
        <Field label="Copper-to-edge clearance" value={g.copperToEdgeClearance} onChange={(v) => updateGlobal('copperToEdgeClearance', v)} />
        <Field label="Silk-to-pad clearance" value={g.silkToPadClearance} onChange={(v) => updateGlobal('silkToPadClearance', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Solder Mask</div>
        <Field label="Solder mask expansion" value={g.solderMaskExpansion} onChange={(v) => updateGlobal('solderMaskExpansion', v)} />
        <Field label="Solder paste margin" value={g.solderPasteMargin} onChange={(v) => updateGlobal('solderPasteMargin', v)} step={0.01} min={-1} />
        <Field label="Solder paste ratio" value={g.solderPasteRatio} onChange={(v) => updateGlobal('solderPasteRatio', v)} step={0.01} min={0} max={1} unit="" />
      </div>
    </div>
  );

  const renderTraceTab = () => (
    <div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Trace Width</div>
        <Field label="Minimum trace width" value={g.minTraceWidth} onChange={(v) => updateGlobal('minTraceWidth', v)} />
        <Field label="Preferred trace width" value={g.preferredTraceWidth} onChange={(v) => updateGlobal('preferredTraceWidth', v)} />
        <Field label="Maximum trace width" value={g.maxTraceWidth} onChange={(v) => updateGlobal('maxTraceWidth', v)} max={20} />
      </div>
    </div>
  );

  const renderViaTab = () => (
    <div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Via Parameters</div>
        <Field label="Min via drill diameter" value={g.minViaDrill} onChange={(v) => updateGlobal('minViaDrill', v)} />
        <Field label="Min annular ring" value={g.minViaAnnularRing} onChange={(v) => updateGlobal('minViaAnnularRing', v)} />
        <Field label="Preferred via size (OD)" value={g.preferredViaSize} onChange={(v) => updateGlobal('preferredViaSize', v)} />
        <Field label="Preferred via drill" value={g.preferredViaDrill} onChange={(v) => updateGlobal('preferredViaDrill', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Through-Hole</div>
        <Field label="Min through-hole drill" value={g.minThroughHole} onChange={(v) => updateGlobal('minThroughHole', v)} />
        <Field label="Min annular ring" value={g.minAnnularRing} onChange={(v) => updateGlobal('minAnnularRing', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Advanced</div>
        <Field label="Micro via drill" value={mfgExtras.microViaDrill} onChange={(v) => updateMfg('microViaDrill', v)} />
        <div style={s.fieldRow}>
          <span style={s.fieldLabel}>Allow blind/buried vias</span>
          <ToggleSwitch checked={mfgExtras.blindBuried} onChange={(v) => updateMfg('blindBuried', v)} />
        </div>
      </div>
    </div>
  );

  const renderManufacturingTab = () => (
    <div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Silkscreen</div>
        <Field label="Min silk line width" value={mfgExtras.minSilkWidth} onChange={(v) => updateMfg('minSilkWidth', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Solder Mask</div>
        <Field label="Min solder mask opening" value={mfgExtras.minSolderMaskOpening} onChange={(v) => updateMfg('minSolderMaskOpening', v)} />
      </div>
      <div style={s.fieldGroup}>
        <div style={s.fieldGroupTitle}>Geometry</div>
        <Field label="Acid trap angle" value={mfgExtras.acidTrapAngle} onChange={(v) => updateMfg('acidTrapAngle', v)} min={0} max={180} step={1} unit="deg" />
      </div>
    </div>
  );

  const renderNetClassesTab = () => (
    <div>
      <table style={s.ncTable}>
        <thead>
          <tr>
            <th style={s.ncTh}>Name</th>
            <th style={s.ncTh}>Clearance</th>
            <th style={s.ncTh}>Width</th>
            <th style={s.ncTh}>Via Drill</th>
            <th style={s.ncTh}>Via Size</th>
            <th style={{ ...s.ncTh, width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {draft.netClasses.map((nc, idx) => (
            <tr key={idx}>
              <td style={s.ncTd}>
                <input
                  style={s.ncNameInput}
                  value={nc.name}
                  onChange={(e) => updateNetClass(idx, { name: e.target.value })}
                />
              </td>
              <td style={s.ncTd}>
                <input
                  type="number"
                  style={s.ncInput}
                  value={nc.clearance}
                  step={0.01}
                  min={0}
                  onChange={(e) => updateNetClass(idx, { clearance: parseFloat(e.target.value) || 0 })}
                />
              </td>
              <td style={s.ncTd}>
                <input
                  type="number"
                  style={s.ncInput}
                  value={nc.traceWidth}
                  step={0.01}
                  min={0}
                  onChange={(e) => updateNetClass(idx, { traceWidth: parseFloat(e.target.value) || 0 })}
                />
              </td>
              <td style={s.ncTd}>
                <input
                  type="number"
                  style={s.ncInput}
                  value={nc.viaDrill}
                  step={0.01}
                  min={0}
                  onChange={(e) => updateNetClass(idx, { viaDrill: parseFloat(e.target.value) || 0 })}
                />
              </td>
              <td style={s.ncTd}>
                <input
                  type="number"
                  style={s.ncInput}
                  value={nc.viaSize}
                  step={0.01}
                  min={0}
                  onChange={(e) => updateNetClass(idx, { viaSize: parseFloat(e.target.value) || 0 })}
                />
              </td>
              <td style={s.ncTd}>
                {draft.netClasses.length > 1 && (
                  <button
                    style={s.removeBtn}
                    title="Remove net class"
                    onClick={() => removeNetClass(idx)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = theme.red; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = theme.textMuted; }}
                  >
                    {'\u2715'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        style={s.addBtn}
        onClick={addNetClass}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = theme.blue; (e.currentTarget as HTMLElement).style.color = theme.blue; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = theme.bg3; (e.currentTarget as HTMLElement).style.color = theme.textMuted; }}
      >
        + Add Net Class
      </button>
    </div>
  );

  const tabContent: Record<TabId, () => React.ReactNode> = {
    clearance: renderClearanceTab,
    trace: renderTraceTab,
    via: renderViaTab,
    manufacturing: renderManufacturingTab,
    netclasses: renderNetClassesTab,
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>DRC Rules Configuration</span>
          <button
            style={{ ...s.btn, ...s.btnCancel, padding: '4px 8px', fontSize: '14px' }}
            onClick={onClose}
            title="Close"
          >
            {'\u2715'}
          </button>
        </div>

        {/* Preset selector */}
        <div style={s.presetRow}>
          <span style={{ color: theme.textSecondary }}>Preset:</span>
          <select
            style={s.select}
            value={selectedPreset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Custom</option>
            {PRESET_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        {/* Tabs */}
        <div style={s.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              style={{
                ...s.tab,
                ...(activeTab === tab.id ? s.tabActive : {}),
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={s.body}>
          {tabContent[activeTab]()}
        </div>

        {/* Footer */}
        <div style={s.footer}>
          <button
            style={{ ...s.btn, ...s.btnCancel }}
            onClick={onClose}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg2; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
          >
            Cancel
          </button>
          <button
            style={{ ...s.btn, ...s.btnPrimary }}
            onClick={handleSave}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.blueHover; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = theme.blue; }}
          >
            Save Rules
          </button>
        </div>
      </div>
    </div>
  );
};

export default DRCConfigDialog;
