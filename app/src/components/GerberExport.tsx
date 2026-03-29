// ─── GerberExport.tsx ── Manufacturing export dialog ────────────────────────
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { theme } from '../styles/theme';
import type { BoardState, BrdTrace, BrdComponent, BrdVia, BrdZone } from '../types';
import { generateAllFiles, exportAll, type ExportFile } from '../engine/gerberGenerator';
import GerberViewer from './GerberViewer';
import { useProjectStore } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

type ExportFormat = 'gerber' | 'excellon' | 'bom' | 'pickplace' | 'pdf';
type FabProfile = 'jlcpcb' | 'pcbway' | 'oshpark' | 'custom';

interface DFMIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  layer?: string;
}

interface BOMRow {
  ref: string;
  value: string;
  footprint: string;
  quantity: number;
  supplier?: string;
  partUrl?: string;
}

interface GerberExportProps {
  board?: BoardState;
  visible?: boolean;
  onClose?: () => void;
}

// ─── Fab Profiles ───────────────────────────────────────────────────────────

const FAB_PROFILES: Record<FabProfile, { name: string; url: string; minTrace: number; minSpace: number; minDrill: number; layers: string[] }> = {
  jlcpcb: {
    name: 'JLCPCB',
    url: 'https://cart.jlcpcb.com/quote',
    minTrace: 0.127,
    minSpace: 0.127,
    minDrill: 0.3,
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
  },
  pcbway: {
    name: 'PCBWay',
    url: 'https://www.pcbway.com/orderonline.aspx',
    minTrace: 0.1,
    minSpace: 0.1,
    minDrill: 0.2,
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
  },
  oshpark: {
    name: 'OSH Park',
    url: 'https://oshpark.com/',
    minTrace: 0.152,
    minSpace: 0.152,
    minDrill: 0.254,
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'],
  },
  custom: {
    name: 'Custom',
    url: '',
    minTrace: 0.1,
    minSpace: 0.1,
    minDrill: 0.2,
    layers: ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste', 'Edge.Cuts'],
  },
};

const ALL_EXPORT_LAYERS = [
  'F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu',
  'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask',
  'F.Paste', 'B.Paste', 'Edge.Cuts',
];

// ─── Mini Canvas Preview ────────────────────────────────────────────────────

const LayerPreview: React.FC<{ board: BoardState; layer: string; color: string }> = ({ board, layer, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = theme.bg0;
    ctx.fillRect(0, 0, w, h);

    // Compute bounding box
    const allPts: { x: number; y: number }[] = [];
    board.outline.points.forEach(p => allPts.push(p));
    board.components.forEach(c => c.pads.forEach(p => allPts.push({ x: c.x + p.x, y: c.y + p.y })));
    board.traces.forEach(t => t.points.forEach(p => allPts.push(p)));
    if (allPts.length === 0) return;
    const minX = Math.min(...allPts.map(p => p.x)) - 2;
    const maxX = Math.max(...allPts.map(p => p.x)) + 2;
    const minY = Math.min(...allPts.map(p => p.y)) + 2;
    const maxY = Math.max(...allPts.map(p => p.y)) + 2;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min((w - 10) / bw, (h - 10) / bh);
    const offX = (w - bw * scale) / 2 - minX * scale;
    const offY = (h - bh * scale) / 2 - minY * scale;

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';

    // Board outline
    if (layer === 'Edge.Cuts' && board.outline.points.length > 1) {
      ctx.beginPath();
      const pts = board.outline.points;
      ctx.moveTo(pts[0].x * scale + offX, pts[0].y * scale + offY);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * scale + offX, pts[i].y * scale + offY);
      ctx.closePath();
      ctx.stroke();
    }

    // Traces on this layer
    board.traces.forEach(t => {
      if (t.layer !== layer) return;
      if (t.points.length < 2) return;
      ctx.lineWidth = Math.max(0.5, t.width * scale);
      ctx.beginPath();
      ctx.moveTo(t.points[0].x * scale + offX, t.points[0].y * scale + offY);
      for (let i = 1; i < t.points.length; i++)
        ctx.lineTo(t.points[i].x * scale + offX, t.points[i].y * scale + offY);
      ctx.stroke();
    });

    // Pads on this layer
    board.components.forEach(comp => {
      comp.pads.forEach(pad => {
        if (!pad.layers.includes(layer)) return;
        const px = (comp.x + pad.x) * scale + offX;
        const py = (comp.y + pad.y) * scale + offY;
        const pw = Math.max(1, pad.width * scale);
        const ph = Math.max(1, pad.height * scale);
        if (pad.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(px, py, pw / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);
        }
      });
    });

    // Zones on this layer
    board.zones.forEach(zone => {
      if (zone.layer !== layer) return;
      if (zone.points.length < 3) return;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(zone.points[0].x * scale + offX, zone.points[0].y * scale + offY);
      for (let i = 1; i < zone.points.length; i++)
        ctx.lineTo(zone.points[i].x * scale + offX, zone.points[i].y * scale + offY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Silkscreen text
    if (layer.includes('SilkS')) {
      ctx.font = `${Math.max(5, scale * 0.6)}px ${theme.fontMono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const targetSide = layer.startsWith('F.') ? 'F.Cu' : 'B.Cu';
      board.components.forEach(comp => {
        if (comp.layer !== targetSide) return;
        ctx.fillText(comp.ref, comp.x * scale + offX, comp.y * scale + offY);
      });
    }

    // Vias (for copper layers)
    if (layer.includes('Cu')) {
      board.vias.forEach(via => {
        if (!via.layers.includes(layer)) return;
        ctx.beginPath();
        ctx.arc(via.x * scale + offX, via.y * scale + offY, Math.max(1, (via.size / 2) * scale), 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [board, layer, color]);

  return <canvas ref={canvasRef} width={120} height={90} style={previewStyles.canvas} />;
};

// ─── Component ──────────────────────────────────────────────────────────────

const GerberExport: React.FC<GerberExportProps> = (props) => {
  const store = useProjectStore();
  const board = props.board ?? store.board;
  const visible = props.visible ?? true;
  const onClose = props.onClose ?? (() => {});
  const [format, setFormat] = useState<ExportFormat>('gerber');
  const [fabProfile, setFabProfile] = useState<FabProfile>('jlcpcb');
  const [selectedLayers, setSelectedLayers] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ALL_EXPORT_LAYERS.forEach(l => { init[l] = true; });
    return init;
  });
  const [dfmChecked, setDfmChecked] = useState(false);
  const [dfmIssues, setDfmIssues] = useState<DFMIssue[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [generatedFiles, setGeneratedFiles] = useState<ExportFile[]>([]);
  const [showGerberViewer, setShowGerberViewer] = useState(false);

  // BOM data
  const bomData = useMemo((): BOMRow[] => {
    const map = new Map<string, BOMRow>();
    board.components.forEach(c => {
      const key = `${c.value}_${c.footprint}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity++;
        existing.ref += `, ${c.ref}`;
      } else {
        map.set(key, {
          ref: c.ref,
          value: c.value,
          footprint: c.footprint,
          quantity: 1,
          supplier: 'Mouser',
          partUrl: '#',
        });
      }
    });
    return Array.from(map.values());
  }, [board.components]);

  // Estimated cost
  const estimatedCost = useMemo(() => {
    const profile = FAB_PROFILES[fabProfile];
    const layerCount = ['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu'].filter(l => selectedLayers[l]).length;
    const area = (() => {
      const pts = board.outline.points;
      if (pts.length < 3) return 100; // default 100mm^2
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      return Math.abs(a) / 2;
    })();
    // Very rough cost estimate
    const baseCost = fabProfile === 'oshpark' ? 5 : 2;
    const layerMult = layerCount <= 2 ? 1 : layerCount <= 4 ? 2.5 : 5;
    const areaCost = area * 0.005;
    return Math.max(baseCost, baseCost + areaCost * layerMult).toFixed(2);
  }, [fabProfile, selectedLayers, board.outline.points]);

  // DFM check
  const runDFMCheck = useCallback(() => {
    const issues: DFMIssue[] = [];
    const profile = FAB_PROFILES[fabProfile];

    // Check trace widths
    board.traces.forEach(t => {
      if (t.width < profile.minTrace) {
        issues.push({
          severity: 'error',
          message: `Trace width ${t.width}mm < min ${profile.minTrace}mm on ${t.layer}`,
          layer: t.layer,
        });
      }
    });

    // Check drill sizes (with via type awareness)
    board.vias.forEach(v => {
      const vType = v.viaType || 'through';
      const minDrill = vType === 'micro' ? 0.1 : profile.minDrill;
      if (v.drill < minDrill) {
        issues.push({
          severity: 'error',
          message: `${vType} via drill ${v.drill}mm < min ${minDrill}mm`,
        });
      }
      // Warn about blind/buried vias if fab might not support them
      if ((vType === 'blind' || vType === 'buried' || vType === 'micro') && fabProfile !== 'custom') {
        issues.push({
          severity: 'warning',
          message: `${vType} via at (${v.x.toFixed(1)}, ${v.y.toFixed(1)}) - verify fab supports ${vType} vias`,
        });
      }
    });

    board.components.forEach(c => {
      c.pads.forEach(p => {
        if (p.drill && p.drill < profile.minDrill) {
          issues.push({
            severity: 'warning',
            message: `Pad ${c.ref}:${p.number} drill ${p.drill}mm < min ${profile.minDrill}mm`,
          });
        }
      });
    });

    // Check board outline
    if (board.outline.points.length < 3) {
      issues.push({ severity: 'error', message: 'Board outline is missing or incomplete' });
    }

    // Check for unconnected pads (simple heuristic)
    if (board.traces.length === 0 && board.components.length > 0) {
      issues.push({ severity: 'warning', message: 'No traces found - board appears unrouted' });
    }

    if (issues.length === 0) {
      issues.push({ severity: 'info', message: 'All DFM checks passed!' });
    }

    setDfmIssues(issues);
    setDfmChecked(true);
  }, [board, fabProfile]);

  // Export: generate real Gerber files and download as ZIP
  const handleExport = useCallback(() => {
    setExporting(true);
    // Run generation in a microtask to let UI update
    Promise.resolve().then(() => {
      try {
        const layersToExport = ALL_EXPORT_LAYERS.filter(l => selectedLayers[l]);
        const files = generateAllFiles(board, layersToExport);
        setGeneratedFiles(files);

        // Build and download ZIP
        const blob = exportAll(board, layersToExport);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gerber_export.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExporting(false);
        setExported(true);
        setTimeout(() => setExported(false), 4000);
      } catch (err) {
        console.error('Export failed:', err);
        setExporting(false);
      }
    });
  }, [board, selectedLayers]);

  const handleOrderPCB = useCallback(() => {
    const profile = FAB_PROFILES[fabProfile];
    if (profile.url) {
      window.open(profile.url, '_blank');
    }
  }, [fabProfile]);

  const toggleLayer = useCallback((layer: string) => {
    setSelectedLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  if (!visible) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={e => e.stopPropagation()}>
        {/* Title bar */}
        <div style={styles.titleBar}>
          <span style={styles.dialogTitle}>Manufacturing Export</span>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        <div style={styles.body}>
          {/* Left column: settings */}
          <div style={styles.leftCol}>
            {/* Format selection */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Export Format</div>
              <div style={styles.formatGrid}>
                {([
                  ['gerber', 'Gerber RS-274X'],
                  ['excellon', 'Excellon Drill'],
                  ['bom', 'BOM CSV'],
                  ['pickplace', 'Pick & Place'],
                  ['pdf', 'PDF Drawing'],
                ] as [ExportFormat, string][]).map(([f, label]) => (
                  <button
                    key={f}
                    style={{
                      ...styles.formatBtn,
                      ...(format === f ? styles.formatBtnActive : {}),
                    }}
                    onClick={() => setFormat(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Fab profile */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Fabrication Profile</div>
              <div style={styles.profileGrid}>
                {(Object.entries(FAB_PROFILES) as [FabProfile, typeof FAB_PROFILES[FabProfile]][]).map(([key, prof]) => (
                  <button
                    key={key}
                    style={{
                      ...styles.profileBtn,
                      ...(fabProfile === key ? styles.profileBtnActive : {}),
                    }}
                    onClick={() => setFabProfile(key)}
                  >
                    <span style={styles.profileName}>{prof.name}</span>
                    <span style={styles.profileSpec}>
                      {prof.minTrace}mm / {prof.minDrill}mm
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Layer selection */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Layers</div>
              <div style={styles.layerCheckboxes}>
                {ALL_EXPORT_LAYERS.map(layer => (
                  <label key={layer} style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={selectedLayers[layer] ?? false}
                      onChange={() => toggleLayer(layer)}
                      style={styles.checkbox}
                    />
                    <span style={{
                      ...styles.layerText,
                      color: theme.layers[layer] || theme.textSecondary,
                    }}>
                      {layer}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* DFM Check */}
            <div style={styles.section}>
              <button style={styles.dfmBtn} onClick={runDFMCheck}>
                {dfmChecked ? 'Re-run DFM Check' : 'Run DFM Check'}
              </button>
              {dfmChecked && (
                <div style={styles.dfmResults}>
                  {dfmIssues.map((issue, i) => (
                    <div key={i} style={styles.dfmIssue}>
                      <span style={{
                        ...styles.dfmBadge,
                        background: issue.severity === 'error' ? theme.red :
                                    issue.severity === 'warning' ? theme.orange : theme.green,
                      }}>
                        {issue.severity.toUpperCase()}
                      </span>
                      <span style={styles.dfmMessage}>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cost estimate */}
            <div style={styles.costSection}>
              <span style={styles.costLabel}>Estimated Cost (5 pcs):</span>
              <span style={styles.costValue}>${estimatedCost}</span>
            </div>
          </div>

          {/* Right column: previews & BOM */}
          <div style={styles.rightCol}>
            {format === 'bom' ? (
              <div style={styles.bomSection}>
                <div style={styles.sectionTitle}>Bill of Materials</div>
                <div style={styles.bomTable}>
                  <div style={styles.bomHeader}>
                    <span style={{ ...styles.bomCell, flex: 1 }}>Ref</span>
                    <span style={{ ...styles.bomCell, flex: 2 }}>Value</span>
                    <span style={{ ...styles.bomCell, flex: 2 }}>Footprint</span>
                    <span style={{ ...styles.bomCell, flex: 0.5 }}>Qty</span>
                    <span style={{ ...styles.bomCell, flex: 1 }}>Supplier</span>
                  </div>
                  <div style={styles.bomBody}>
                    {bomData.map((row, i) => (
                      <div key={i} style={styles.bomRow}>
                        <span style={{ ...styles.bomCell, flex: 1, color: theme.textPrimary }}>{row.ref}</span>
                        <span style={{ ...styles.bomCell, flex: 2, color: theme.cyan }}>{row.value}</span>
                        <span style={{ ...styles.bomCell, flex: 2 }}>{row.footprint}</span>
                        <span style={{ ...styles.bomCell, flex: 0.5, color: theme.textPrimary }}>{row.quantity}</span>
                        <span style={{ ...styles.bomCell, flex: 1 }}>
                          <a href={row.partUrl} target="_blank" rel="noreferrer" style={styles.supplierLink}>
                            {row.supplier}
                          </a>
                        </span>
                      </div>
                    ))}
                    {bomData.length === 0 && (
                      <div style={styles.bomEmpty}>No components on board</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.previewSection}>
                <div style={styles.sectionTitle}>Layer Previews</div>
                <div style={styles.previewGrid}>
                  {ALL_EXPORT_LAYERS.filter(l => selectedLayers[l]).map(layer => {
                    const gf = generatedFiles.find(f => f.name.replace('_', '.').replace('.gbr', '').includes(layer.replace('.', '_').replace('.', '_')) || f.name.startsWith(layer.replace('.', '_')));
                    return (
                      <div key={layer} style={styles.previewCard}>
                        <LayerPreview board={board} layer={layer} color={theme.layers[layer] || '#888'} />
                        <span style={{
                          ...styles.previewLabel,
                          color: theme.layers[layer] || theme.textSecondary,
                        }}>
                          {layer}
                        </span>
                        {gf && (
                          <span style={{
                            fontSize: '9px',
                            color: theme.textMuted,
                            fontFamily: theme.fontMono,
                          }}>
                            {(gf.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {generatedFiles.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={styles.sectionTitle}>Generated Files</div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      marginTop: 6,
                      maxHeight: 140,
                      overflowY: 'auto',
                    }}>
                      {generatedFiles.map((f, i) => (
                        <div key={i} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '2px 6px',
                          fontSize: theme.fontXs,
                          fontFamily: theme.fontMono,
                          color: theme.textSecondary,
                          background: i % 2 === 0 ? theme.bg2 : 'transparent',
                          borderRadius: 2,
                        }}>
                          <span>{f.name}</span>
                          <span style={{ color: theme.textMuted }}>
                            {f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}
                          </span>
                        </div>
                      ))}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        fontSize: theme.fontXs,
                        fontFamily: theme.fontMono,
                        color: theme.textPrimary,
                        borderTop: `1px solid ${theme.bg3}`,
                        marginTop: 2,
                      }}>
                        <span>Total ({generatedFiles.length} files)</span>
                        <span style={{ color: theme.green }}>
                          {(generatedFiles.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...styles.orderBtn,
              borderColor: theme.cyan,
              color: theme.cyan,
              background: 'rgba(64,208,224,0.08)',
            }}
            onClick={() => setShowGerberViewer(true)}
          >
            Gerber Preview
          </button>
          <button style={styles.orderBtn} onClick={handleOrderPCB}>
            Order PCB
          </button>
          <button
            style={{
              ...styles.exportBtn,
              ...(exporting ? { opacity: 0.6 } : {}),
            }}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : exported ? 'Exported!' : 'Export All'}
          </button>
        </div>
      </div>

      {/* Gerber Viewer Dialog */}
      <GerberViewer
        board={board}
        visible={showGerberViewer}
        onClose={() => setShowGerberViewer(false)}
      />
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const previewStyles: Record<string, React.CSSProperties> = {
  canvas: {
    display: 'block',
    borderRadius: theme.radiusSm,
    border: theme.border,
  },
};

const styles: Record<string, React.CSSProperties> = {
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
    width: 900,
    maxWidth: '95vw',
    maxHeight: '90vh',
    background: theme.bg1,
    border: theme.border,
    borderRadius: theme.radiusLg,
    boxShadow: theme.shadowLg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  dialogTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontLg,
    fontWeight: 600,
    fontFamily: theme.fontSans,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 400,
  },
  leftCol: {
    width: 360,
    borderRight: theme.border,
    padding: 16,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    flexShrink: 0,
  },
  rightCol: {
    flex: 1,
    padding: 16,
    overflowY: 'auto',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    fontFamily: theme.fontSans,
  },
  formatGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  formatBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    padding: '5px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    transition: 'all 0.1s',
  },
  formatBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
  },
  profileBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
  },
  profileBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
  },
  profileName: {
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontWeight: 500,
    fontFamily: theme.fontSans,
  },
  profileSpec: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
  },
  layerCheckboxes: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '2px 8px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    padding: '2px 0',
  },
  checkbox: {
    accentColor: theme.blue,
    cursor: 'pointer',
  },
  layerText: {
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
  },
  dfmBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    fontWeight: 500,
    width: '100%',
  },
  dfmResults: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 120,
    overflowY: 'auto',
  },
  dfmIssue: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '3px 0',
  },
  dfmBadge: {
    fontSize: '8px',
    fontWeight: 700,
    color: '#fff',
    padding: '1px 4px',
    borderRadius: 2,
    flexShrink: 0,
    fontFamily: theme.fontMono,
  },
  dfmMessage: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    lineHeight: 1.3,
    fontFamily: theme.fontSans,
  },
  costSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: theme.bg2,
    borderRadius: theme.radiusSm,
  },
  costLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  costValue: {
    color: theme.green,
    fontSize: theme.fontLg,
    fontWeight: 700,
    fontFamily: theme.fontMono,
  },
  previewSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  previewGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 10,
  },
  previewCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  previewLabel: {
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    fontWeight: 500,
  },
  bomSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    height: '100%',
  },
  bomTable: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    border: theme.border,
    borderRadius: theme.radiusSm,
    overflow: 'hidden',
  },
  bomHeader: {
    display: 'flex',
    background: theme.bg2,
    padding: '6px 10px',
    borderBottom: theme.border,
  },
  bomBody: {
    flex: 1,
    overflowY: 'auto',
  },
  bomRow: {
    display: 'flex',
    padding: '4px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  bomCell: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    paddingRight: 6,
  },
  bomEmpty: {
    color: theme.textMuted,
    fontSize: theme.fontSm,
    padding: 16,
    textAlign: 'center' as const,
  },
  supplierLink: {
    color: theme.blue,
    textDecoration: 'none',
    fontSize: theme.fontXs,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 16px',
    borderTop: theme.border,
    background: theme.bg2,
    flexShrink: 0,
  },
  cancelBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  orderBtn: {
    background: theme.bg3,
    border: `1px solid ${theme.green}`,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  exportBtn: {
    background: `linear-gradient(135deg, ${theme.blue}, ${theme.purple})`,
    border: 'none',
    borderRadius: theme.radiusSm,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '6px 20px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
};

export default GerberExport;
