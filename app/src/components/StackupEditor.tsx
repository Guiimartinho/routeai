// ─── StackupEditor.tsx ── PCB Layer Stackup Configuration Dialog ─────────────
import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

type DielectricMaterial = 'FR-4' | 'Polyimide' | 'Rogers 4003C' | 'Rogers 4350B';
type CopperWeight = 0.5 | 1 | 2; // oz
type ViaType = 'through-hole' | 'blind' | 'buried';

interface CopperLayer {
  kind: 'copper';
  id: string;
  name: string;
  thicknessOz: CopperWeight;
  color: string;
}

interface DielectricLayer {
  kind: 'dielectric';
  id: string;
  name: string;
  thicknessMm: number;
  material: DielectricMaterial;
  er: number;
  tg: number; // glass transition temp
}

type StackupLayer = CopperLayer | DielectricLayer;

interface ViaConfig {
  type: ViaType;
  drillMin: number;
  drillMax: number;
  fromLayer: string;
  toLayer: string;
}

interface StackupPreset {
  label: string;
  layerCount: number;
  layers: StackupLayer[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MATERIAL_DEFAULTS: Record<DielectricMaterial, { er: number; tg: number }> = {
  'FR-4':          { er: 4.5,  tg: 130 },
  'Polyimide':     { er: 3.5,  tg: 260 },
  'Rogers 4003C':  { er: 3.55, tg: 280 },
  'Rogers 4350B':  { er: 3.66, tg: 280 },
};

const COPPER_OZ_TO_MM: Record<CopperWeight, number> = {
  0.5: 0.0175,
  1:   0.035,
  2:   0.07,
};

const LAYER_COLORS = ['#f04040', '#4060f0', '#40c040', '#c0c040', '#c040c0', '#40c0c0', '#f0a030', '#a06dff'];

// ─── Preset factory ─────────────────────────────────────────────────────────

function makeCopperLayer(name: string, oz: CopperWeight, colorIdx: number): CopperLayer {
  return { kind: 'copper', id: `cu_${name}`, name, thicknessOz: oz, color: LAYER_COLORS[colorIdx % LAYER_COLORS.length] };
}

function makeDielectric(name: string, thicknessMm: number, mat: DielectricMaterial): DielectricLayer {
  const d = MATERIAL_DEFAULTS[mat];
  return { kind: 'dielectric', id: `di_${name}`, name, thicknessMm, material: mat, er: d.er, tg: d.tg };
}

function buildStandard2Layer(): StackupLayer[] {
  return [
    makeCopperLayer('F.Cu', 1, 0),
    makeDielectric('Core', 1.51, 'FR-4'),
    makeCopperLayer('B.Cu', 1, 1),
  ];
}

function buildStandard4Layer(): StackupLayer[] {
  return [
    makeCopperLayer('F.Cu', 1, 0),
    makeDielectric('Prepreg 1', 0.2, 'FR-4'),
    makeCopperLayer('In1.Cu', 0.5, 2),
    makeDielectric('Core', 0.8, 'FR-4'),
    makeCopperLayer('In2.Cu', 0.5, 3),
    makeDielectric('Prepreg 2', 0.2, 'FR-4'),
    makeCopperLayer('B.Cu', 1, 1),
  ];
}

function buildHDI6Layer(): StackupLayer[] {
  return [
    makeCopperLayer('F.Cu', 1, 0),
    makeDielectric('Prepreg 1', 0.1, 'FR-4'),
    makeCopperLayer('In1.Cu', 0.5, 2),
    makeDielectric('Core 1', 0.3, 'FR-4'),
    makeCopperLayer('In2.Cu', 0.5, 3),
    makeDielectric('Core 2', 0.3, 'FR-4'),
    makeCopperLayer('In3.Cu', 0.5, 4),
    makeDielectric('Prepreg 2', 0.1, 'FR-4'),
    makeCopperLayer('In4.Cu', 0.5, 5),
    makeDielectric('Prepreg 3', 0.1, 'FR-4'),
    makeCopperLayer('B.Cu', 1, 1),
  ];
}

function buildImpedanceControlled4L(): StackupLayer[] {
  return [
    makeCopperLayer('F.Cu', 1, 0),
    makeDielectric('Prepreg 1', 0.2, 'Rogers 4350B'),
    makeCopperLayer('In1.Cu (GND)', 1, 2),
    makeDielectric('Core', 0.8, 'Rogers 4350B'),
    makeCopperLayer('In2.Cu (PWR)', 1, 3),
    makeDielectric('Prepreg 2', 0.2, 'Rogers 4350B'),
    makeCopperLayer('B.Cu', 1, 1),
  ];
}

const PRESETS: StackupPreset[] = [
  { label: 'Standard 2-layer 1.6mm', layerCount: 2, layers: buildStandard2Layer() },
  { label: 'Standard 4-layer 1.6mm', layerCount: 4, layers: buildStandard4Layer() },
  { label: '6-layer HDI',            layerCount: 6, layers: buildHDI6Layer() },
  { label: 'Impedance-controlled 4L', layerCount: 4, layers: buildImpedanceControlled4L() },
];

function buildDefaultStackup(count: number): StackupLayer[] {
  if (count === 2) return buildStandard2Layer();
  if (count === 4) return buildStandard4Layer();
  if (count === 6) return buildHDI6Layer();
  // 8 layers
  const layers: StackupLayer[] = [];
  const cuNames = ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'In5.Cu', 'In6.Cu', 'B.Cu'];
  for (let i = 0; i < count; i++) {
    layers.push(makeCopperLayer(cuNames[i], i === 0 || i === count - 1 ? 1 : 0.5, i));
    if (i < count - 1) {
      const isCore = i % 2 === 0;
      layers.push(makeDielectric(
        isCore ? `Core ${Math.floor(i / 2) + 1}` : `Prepreg ${Math.ceil(i / 2)}`,
        isCore ? 0.3 : 0.15,
        'FR-4',
      ));
    }
  }
  return layers;
}

// ─── Impedance Calculator ───────────────────────────────────────────────────

function calcMicrostripZ0(er: number, h: number, w: number, t: number): number {
  // Z_microstrip = (87 / sqrt(Er+1.41)) * ln(5.98*h / (0.8*w+t))
  const denom = Math.sqrt(er + 1.41);
  const arg = (5.98 * h) / (0.8 * w + t);
  if (arg <= 0) return 0;
  return (87 / denom) * Math.log(arg);
}

function calcStriplineZ0(er: number, h: number, w: number, t: number): number {
  // Simplified stripline: Z0 = (60 / sqrt(Er)) * ln(4*h / (0.67*pi*(0.8*w+t)))
  const arg = (4 * h) / (0.67 * Math.PI * (0.8 * w + t));
  if (arg <= 0) return 0;
  return (60 / Math.sqrt(er)) * Math.log(arg);
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface StackupEditorProps {
  visible: boolean;
  onClose: () => void;
  onApply?: (layers: string[]) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

const StackupEditor: React.FC<StackupEditorProps> = ({ visible, onClose, onApply }) => {
  const [stackup, setStackup] = useState<StackupLayer[]>(buildStandard4Layer());
  const [layerCount, setLayerCount] = useState<number>(4);
  const [vias, setVias] = useState<ViaConfig[]>([
    { type: 'through-hole', drillMin: 0.2, drillMax: 0.6, fromLayer: 'F.Cu', toLayer: 'B.Cu' },
  ]);

  // Impedance calculator state
  const [impTraceWidth, setImpTraceWidth] = useState(0.15); // mm
  const [impMode, setImpMode] = useState<'microstrip' | 'stripline'>('microstrip');

  // Total thickness
  const totalThickness = useMemo(() => {
    return stackup.reduce((sum, layer) => {
      if (layer.kind === 'copper') return sum + COPPER_OZ_TO_MM[layer.thicknessOz];
      return sum + layer.thicknessMm;
    }, 0);
  }, [stackup]);

  // Copper layers for via config
  const copperLayers = useMemo(() => stackup.filter((l): l is CopperLayer => l.kind === 'copper'), [stackup]);

  // Impedance calculation
  const impedanceResult = useMemo(() => {
    // Find the first dielectric adjacent to top copper for microstrip
    const firstDiIdx = stackup.findIndex(l => l.kind === 'dielectric');
    if (firstDiIdx === -1) return { z0: 0, er: 4.5, h: 0.2 };
    const di = stackup[firstDiIdx] as DielectricLayer;

    if (impMode === 'microstrip') {
      // Use first dielectric under F.Cu
      const t = COPPER_OZ_TO_MM[1]; // assume 1oz for calc
      const z0 = calcMicrostripZ0(di.er, di.thicknessMm, impTraceWidth, t);
      return { z0, er: di.er, h: di.thicknessMm };
    } else {
      // Stripline: find dielectric above and below an inner copper layer
      // Use the second dielectric if available
      const dielectrics = stackup.filter((l): l is DielectricLayer => l.kind === 'dielectric');
      if (dielectrics.length < 2) return { z0: 0, er: di.er, h: di.thicknessMm };
      const hTotal = dielectrics[0].thicknessMm + dielectrics[1].thicknessMm;
      const erAvg = (dielectrics[0].er + dielectrics[1].er) / 2;
      const t = COPPER_OZ_TO_MM[0.5];
      const z0 = calcStriplineZ0(erAvg, hTotal / 2, impTraceWidth, t);
      return { z0, er: erAvg, h: hTotal };
    }
  }, [stackup, impTraceWidth, impMode]);

  const handleLayerCountChange = useCallback((count: number) => {
    setLayerCount(count);
    setStackup(buildDefaultStackup(count));
  }, []);

  const handlePreset = useCallback((preset: StackupPreset) => {
    setLayerCount(preset.layerCount);
    setStackup(preset.layers.map(l => ({ ...l })));
  }, []);

  const updateLayer = useCallback((idx: number, patch: Partial<CopperLayer> | Partial<DielectricLayer>) => {
    setStackup(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } as StackupLayer : l));
  }, []);

  const updateDielectricMaterial = useCallback((idx: number, mat: DielectricMaterial) => {
    const defaults = MATERIAL_DEFAULTS[mat];
    setStackup(prev => prev.map((l, i) => {
      if (i !== idx || l.kind !== 'dielectric') return l;
      return { ...l, material: mat, er: defaults.er, tg: defaults.tg };
    }));
  }, []);

  const addVia = useCallback(() => {
    setVias(prev => [...prev, {
      type: 'through-hole',
      drillMin: 0.2,
      drillMax: 0.6,
      fromLayer: copperLayers[0]?.name || 'F.Cu',
      toLayer: copperLayers[copperLayers.length - 1]?.name || 'B.Cu',
    }]);
  }, [copperLayers]);

  const updateVia = useCallback((idx: number, patch: Partial<ViaConfig>) => {
    setVias(prev => prev.map((v, i) => i === idx ? { ...v, ...patch } : v));
  }, []);

  const removeVia = useCallback((idx: number) => {
    setVias(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleApply = useCallback(() => {
    if (onApply) {
      const layerNames = copperLayers.map(l => l.name);
      layerNames.push('F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts');
      onApply(layerNames);
    }
    onClose();
  }, [copperLayers, onApply, onClose]);

  if (!visible) return null;

  // ─── Cross-section diagram ──────────────────────────────────────────────

  const DIAGRAM_HEIGHT = Math.max(240, stackup.length * 22 + 40);
  const layerBlockHeight = Math.max(14, Math.min(24, (DIAGRAM_HEIGHT - 40) / stackup.length));

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>Stackup Editor</span>
          <button style={styles.closeBtn} onClick={onClose}>X</button>
        </div>

        <div style={styles.body}>
          {/* Left column: controls */}
          <div style={styles.leftCol}>

            {/* Layer count selector */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Layer Count</div>
              <div style={styles.layerCountRow}>
                {[2, 4, 6, 8].map(n => (
                  <button
                    key={n}
                    style={{
                      ...styles.lcBtn,
                      ...(layerCount === n ? styles.lcBtnActive : {}),
                    }}
                    onClick={() => handleLayerCountChange(n)}
                  >
                    {n}L
                  </button>
                ))}
              </div>
            </div>

            {/* Presets */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Presets</div>
              <div style={styles.presetGrid}>
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    style={styles.presetBtn}
                    onClick={() => handlePreset(p)}
                    title={p.label}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layer list */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Layer Configuration</div>
              <div style={styles.layerList}>
                {stackup.map((layer, idx) => (
                  <div key={layer.id} style={styles.layerRow}>
                    {layer.kind === 'copper' ? (
                      <>
                        <div style={{ ...styles.layerColorSwatch, background: layer.color }} />
                        <input
                          style={styles.layerNameInput}
                          value={layer.name}
                          onChange={e => updateLayer(idx, { name: e.target.value })}
                        />
                        <select
                          style={styles.layerSelect}
                          value={layer.thicknessOz}
                          onChange={e => updateLayer(idx, { thicknessOz: parseFloat(e.target.value) as CopperWeight })}
                        >
                          <option value={0.5}>0.5 oz</option>
                          <option value={1}>1 oz</option>
                          <option value={2}>2 oz</option>
                        </select>
                        <input
                          type="color"
                          style={styles.colorPicker}
                          value={layer.color}
                          onChange={e => updateLayer(idx, { color: e.target.value })}
                        />
                      </>
                    ) : (
                      <>
                        <div style={styles.dielectricIcon}>~</div>
                        <input
                          style={styles.layerNameInput}
                          value={layer.name}
                          onChange={e => updateLayer(idx, { name: e.target.value })}
                        />
                        <input
                          type="number"
                          style={styles.thicknessInput}
                          value={layer.thicknessMm}
                          min={0.01}
                          step={0.01}
                          onChange={e => updateLayer(idx, { thicknessMm: parseFloat(e.target.value) || 0.1 })}
                        />
                        <span style={styles.unitLabel}>mm</span>
                        <select
                          style={styles.layerSelect}
                          value={layer.material}
                          onChange={e => updateDielectricMaterial(idx, e.target.value as DielectricMaterial)}
                        >
                          <option value="FR-4">FR-4</option>
                          <option value="Polyimide">Polyimide</option>
                          <option value="Rogers 4003C">Rogers 4003C</option>
                          <option value="Rogers 4350B">Rogers 4350B</option>
                        </select>
                        <span style={styles.erLabel}>Er={layer.er.toFixed(2)}</span>
                        <span style={styles.tgLabel}>Tg={layer.tg}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Total thickness */}
            <div style={styles.thicknessDisplay}>
              Total Board Thickness: <strong>{totalThickness.toFixed(3)} mm</strong>
            </div>
          </div>

          {/* Right column: diagram + impedance + vias */}
          <div style={styles.rightCol}>

            {/* Cross-section diagram */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Cross-Section</div>
              <div style={styles.diagramContainer}>
                <svg width="100%" height={DIAGRAM_HEIGHT} viewBox={`0 0 280 ${DIAGRAM_HEIGHT}`}>
                  {/* Background */}
                  <rect x="0" y="0" width="280" height={DIAGRAM_HEIGHT} fill={theme.bg0} rx="4" />

                  {stackup.map((layer, idx) => {
                    const y = 20 + idx * layerBlockHeight;
                    const isCu = layer.kind === 'copper';
                    const h = isCu ? layerBlockHeight * 0.55 : layerBlockHeight * 0.85;
                    const yOff = (layerBlockHeight - h) / 2;

                    return (
                      <g key={layer.id}>
                        <rect
                          x="40"
                          y={y + yOff}
                          width="180"
                          height={h}
                          fill={isCu ? (layer as CopperLayer).color : '#8B7355'}
                          opacity={isCu ? 0.85 : 0.4}
                          rx="1"
                          stroke={isCu ? '#fff' : '#6B5B45'}
                          strokeWidth={isCu ? 0.5 : 0.3}
                        />
                        <text
                          x="235"
                          y={y + layerBlockHeight / 2 + 3}
                          fill={theme.textSecondary}
                          fontSize="8"
                          fontFamily={theme.fontMono}
                        >
                          {layer.name}
                        </text>
                        <text
                          x="10"
                          y={y + layerBlockHeight / 2 + 3}
                          fill={theme.textMuted}
                          fontSize="7"
                          fontFamily={theme.fontMono}
                        >
                          {isCu
                            ? `${(layer as CopperLayer).thicknessOz}oz`
                            : `${(layer as DielectricLayer).thicknessMm}mm`
                          }
                        </text>
                      </g>
                    );
                  })}

                  {/* Dimension line */}
                  <line x1="36" y1="18" x2="36" y2={18 + stackup.length * layerBlockHeight} stroke={theme.textMuted} strokeWidth="0.5" />
                  <text
                    x="33"
                    y={20 + stackup.length * layerBlockHeight + 12}
                    fill={theme.textSecondary}
                    fontSize="8"
                    fontFamily={theme.fontMono}
                    textAnchor="middle"
                  >
                    {totalThickness.toFixed(2)}mm
                  </text>
                </svg>
              </div>
            </div>

            {/* Impedance calculator */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Impedance Calculator</div>
              <div style={styles.impRow}>
                <span style={styles.impLabel}>Mode:</span>
                <select
                  style={styles.layerSelect}
                  value={impMode}
                  onChange={e => setImpMode(e.target.value as 'microstrip' | 'stripline')}
                >
                  <option value="microstrip">Microstrip</option>
                  <option value="stripline">Stripline</option>
                </select>
              </div>
              <div style={styles.impRow}>
                <span style={styles.impLabel}>Trace Width:</span>
                <input
                  type="number"
                  style={styles.thicknessInput}
                  value={impTraceWidth}
                  min={0.01}
                  step={0.01}
                  onChange={e => setImpTraceWidth(parseFloat(e.target.value) || 0.1)}
                />
                <span style={styles.unitLabel}>mm</span>
              </div>
              <div style={styles.impResult}>
                <div style={styles.impZ0}>
                  Z<sub>0</sub> = <strong>{impedanceResult.z0 > 0 ? impedanceResult.z0.toFixed(1) : '--'}</strong> Ohm
                </div>
                <div style={styles.impDetail}>
                  Er={impedanceResult.er.toFixed(2)}, h={impedanceResult.h.toFixed(3)}mm
                </div>
              </div>
            </div>

            {/* Via configuration */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>
                Via Configuration
                <button style={styles.addViaBtn} onClick={addVia}>+ Add</button>
              </div>
              <div style={styles.viaList}>
                {vias.map((via, idx) => (
                  <div key={idx} style={styles.viaRow}>
                    <select
                      style={styles.viaTypeSelect}
                      value={via.type}
                      onChange={e => updateVia(idx, { type: e.target.value as ViaType })}
                    >
                      <option value="through-hole">Through</option>
                      <option value="blind">Blind</option>
                      <option value="buried">Buried</option>
                    </select>
                    <span style={styles.viaDrillLabel}>Drill:</span>
                    <input
                      type="number"
                      style={styles.viaDrillInput}
                      value={via.drillMin}
                      min={0.05}
                      step={0.05}
                      onChange={e => updateVia(idx, { drillMin: parseFloat(e.target.value) || 0.1 })}
                    />
                    <span style={styles.unitLabel}>-</span>
                    <input
                      type="number"
                      style={styles.viaDrillInput}
                      value={via.drillMax}
                      min={0.05}
                      step={0.05}
                      onChange={e => updateVia(idx, { drillMax: parseFloat(e.target.value) || 0.3 })}
                    />
                    <span style={styles.unitLabel}>mm</span>
                    {(via.type === 'blind' || via.type === 'buried') && (
                      <>
                        <select
                          style={styles.viaLayerSelect}
                          value={via.fromLayer}
                          onChange={e => updateVia(idx, { fromLayer: e.target.value })}
                        >
                          {copperLayers.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                        </select>
                        <span style={styles.unitLabel}>to</span>
                        <select
                          style={styles.viaLayerSelect}
                          value={via.toLayer}
                          onChange={e => updateVia(idx, { toLayer: e.target.value })}
                        >
                          {copperLayers.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                        </select>
                      </>
                    )}
                    <button style={styles.viaRemoveBtn} onClick={() => removeVia(idx)}>X</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.applyBtn} onClick={handleApply}>Apply Stackup</button>
        </div>
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  dialog: {
    background: theme.bg1,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusLg,
    boxShadow: theme.shadowLg,
    width: '960px',
    maxWidth: '95vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${theme.sp3} ${theme.sp4}`,
    borderBottom: theme.border,
    background: theme.bg2,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontLg,
    fontFamily: theme.fontSans,
    fontWeight: 600,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    cursor: 'pointer',
    fontSize: theme.fontMd,
    padding: theme.sp1,
    fontFamily: theme.fontMono,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'auto',
    padding: theme.sp3,
    gap: theme.sp4,
  },
  leftCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.sp3,
  },
  rightCol: {
    width: '320px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.sp3,
  },
  section: {
    background: theme.bg2,
    borderRadius: theme.radiusMd,
    padding: theme.sp3,
    border: theme.border,
  },
  sectionTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: theme.sp2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  layerCountRow: {
    display: 'flex',
    gap: theme.sp2,
  },
  lcBtn: {
    flex: 1,
    padding: `${theme.sp2} ${theme.sp3}`,
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: theme.fontMd,
    fontFamily: theme.fontMono,
    fontWeight: 600,
    transition: 'all 0.15s',
  },
  lcBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.sp1,
  },
  presetBtn: {
    padding: `${theme.sp1} ${theme.sp2}`,
    background: theme.bg3,
    border: `1px solid transparent`,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    textAlign: 'left' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'all 0.15s',
  },
  layerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxHeight: '280px',
    overflowY: 'auto' as const,
  },
  layerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp1,
    padding: '3px 4px',
    borderRadius: theme.radiusSm,
    background: theme.bg0,
    minHeight: '28px',
  },
  layerColorSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '2px',
    flexShrink: 0,
    border: '1px solid rgba(255,255,255,0.15)',
  },
  dielectricIcon: {
    width: '12px',
    height: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#8B7355',
    fontSize: '10px',
    fontWeight: 700,
    flexShrink: 0,
  },
  layerNameInput: {
    flex: 1,
    minWidth: '60px',
    background: 'transparent',
    border: `1px solid transparent`,
    borderRadius: '2px',
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 4px',
    outline: 'none',
  },
  layerSelect: {
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '2px',
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 4px',
    outline: 'none',
    cursor: 'pointer',
  },
  thicknessInput: {
    width: '52px',
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '2px',
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 4px',
    outline: 'none',
    textAlign: 'right' as const,
  },
  unitLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  erLabel: {
    color: theme.cyan,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  tgLabel: {
    color: theme.orange,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    flexShrink: 0,
  },
  colorPicker: {
    width: '20px',
    height: '20px',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  },
  thicknessDisplay: {
    padding: `${theme.sp2} ${theme.sp3}`,
    background: theme.bg2,
    borderRadius: theme.radiusMd,
    border: theme.border,
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    textAlign: 'center' as const,
  },
  diagramContainer: {
    borderRadius: theme.radiusSm,
    overflow: 'hidden',
    border: `1px solid ${theme.bg3}`,
  },
  impRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp2,
    marginBottom: theme.sp1,
  },
  impLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    width: '80px',
    flexShrink: 0,
  },
  impResult: {
    background: theme.bg0,
    borderRadius: theme.radiusSm,
    padding: theme.sp2,
    marginTop: theme.sp1,
    textAlign: 'center' as const,
  },
  impZ0: {
    color: theme.green,
    fontSize: theme.fontLg,
    fontFamily: theme.fontMono,
    fontWeight: 600,
  },
  impDetail: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    marginTop: '2px',
  },
  addViaBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    cursor: 'pointer',
    fontSize: theme.fontXs,
    fontFamily: theme.fontSans,
    padding: '1px 8px',
  },
  viaList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  viaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp1,
    padding: '3px 4px',
    background: theme.bg0,
    borderRadius: theme.radiusSm,
    flexWrap: 'wrap' as const,
  },
  viaTypeSelect: {
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '2px',
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 4px',
    outline: 'none',
    cursor: 'pointer',
    width: '70px',
  },
  viaDrillLabel: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
  },
  viaDrillInput: {
    width: '42px',
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '2px',
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 3px',
    outline: 'none',
    textAlign: 'right' as const,
  },
  viaLayerSelect: {
    background: theme.bg3,
    border: `1px solid ${theme.bg3}`,
    borderRadius: '2px',
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '2px 3px',
    outline: 'none',
    cursor: 'pointer',
    maxWidth: '70px',
  },
  viaRemoveBtn: {
    background: 'none',
    border: 'none',
    color: theme.red,
    cursor: 'pointer',
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    padding: '0 4px',
    marginLeft: 'auto',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.sp2,
    padding: `${theme.sp3} ${theme.sp4}`,
    borderTop: theme.border,
    background: theme.bg2,
  },
  cancelBtn: {
    padding: `${theme.sp2} ${theme.sp4}`,
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  applyBtn: {
    padding: `${theme.sp2} ${theme.sp5}`,
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    cursor: 'pointer',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    fontWeight: 600,
  },
};

export default StackupEditor;
