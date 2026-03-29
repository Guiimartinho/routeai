// ─── PanelizationDialog.tsx ── PCB Panel creation dialog ─────────────────────
import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';
import type { BoardState, Point, BoardOutline } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

type TabMethod = 'vscore' | 'mousebite' | 'breakaway';
type Rotation = 0 | 90 | 180 | 270;

interface PanelConfig {
  rows: number;
  cols: number;
  spacingX: number;
  spacingY: number;
  rotation: Rotation;
  tabMethod: TabMethod;
  tabWidth: number;
  tabSpacing: number;
  railTop: number;
  railBottom: number;
  railLeft: number;
  railRight: number;
  addFiducials: boolean;
  addToolingHoles: boolean;
  toolingHoleDiameter: number;
  mouseBiteDrill: number;
  mouseBiteCount: number;
}

interface PanelizationDialogProps {
  board: BoardState;
  visible: boolean;
  onClose: () => void;
}

// ─── Default config ─────────────────────────────────────────────────────────

const defaultConfig: PanelConfig = {
  rows: 2,
  cols: 2,
  spacingX: 2,
  spacingY: 2,
  rotation: 0,
  tabMethod: 'vscore',
  tabWidth: 3,
  tabSpacing: 20,
  railTop: 5,
  railBottom: 5,
  railLeft: 5,
  railRight: 5,
  addFiducials: true,
  addToolingHoles: true,
  toolingHoleDiameter: 3.2,
  mouseBiteDrill: 0.5,
  mouseBiteCount: 5,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBoardBounds(outline: BoardOutline): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  if (outline.points.length === 0) return { minX: 0, minY: 0, maxX: 50, maxY: 30, w: 50, h: 30 };
  const xs = outline.points.map(p => p.x);
  const ys = outline.points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function rotateSize(w: number, h: number, rot: Rotation): { rw: number; rh: number } {
  if (rot === 90 || rot === 270) return { rw: h, rh: w };
  return { rw: w, rh: h };
}

// ─── Component ──────────────────────────────────────────────────────────────

const PanelizationDialog: React.FC<PanelizationDialogProps> = ({ board, visible, onClose }) => {
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);

  const update = useCallback(<K extends keyof PanelConfig>(key: K, value: PanelConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const bounds = useMemo(() => getBoardBounds(board.outline), [board.outline]);
  const { rw: boardW, rh: boardH } = useMemo(() => rotateSize(bounds.w, bounds.h, config.rotation), [bounds.w, bounds.h, config.rotation]);

  // Compute panel dimensions
  const panelInfo = useMemo(() => {
    const totalW = config.railLeft + config.cols * boardW + (config.cols - 1) * config.spacingX + config.railRight;
    const totalH = config.railTop + config.rows * boardH + (config.rows - 1) * config.spacingY + config.railBottom;
    return { totalW, totalH };
  }, [config, boardW, boardH]);

  // Generate SVG preview
  const svgPreview = useMemo(() => {
    const { totalW, totalH } = panelInfo;
    const svgW = 400;
    const svgH = 300;
    const margin = 20;
    const scale = Math.min((svgW - margin * 2) / totalW, (svgH - margin * 2) / totalH);
    const ox = (svgW - totalW * scale) / 2;
    const oy = (svgH - totalH * scale) / 2;

    const elements: React.ReactNode[] = [];

    // Panel outline
    elements.push(
      <rect key="panel" x={ox} y={oy} width={totalW * scale} height={totalH * scale}
        fill="none" stroke="#5c6478" strokeWidth={1.5} strokeDasharray="4,2" />
    );

    // Rails shading
    if (config.railTop > 0)
      elements.push(<rect key="rail-top" x={ox} y={oy} width={totalW * scale} height={config.railTop * scale}
        fill="rgba(92,100,120,0.15)" />);
    if (config.railBottom > 0)
      elements.push(<rect key="rail-bot" x={ox} y={oy + (totalH - config.railBottom) * scale}
        width={totalW * scale} height={config.railBottom * scale} fill="rgba(92,100,120,0.15)" />);
    if (config.railLeft > 0)
      elements.push(<rect key="rail-left" x={ox} y={oy} width={config.railLeft * scale}
        height={totalH * scale} fill="rgba(92,100,120,0.1)" />);
    if (config.railRight > 0)
      elements.push(<rect key="rail-right" x={ox + (totalW - config.railRight) * scale} y={oy}
        width={config.railRight * scale} height={totalH * scale} fill="rgba(92,100,120,0.1)" />);

    // Boards
    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        const bx = config.railLeft + c * (boardW + config.spacingX);
        const by = config.railTop + r * (boardH + config.spacingY);
        elements.push(
          <rect key={`board-${r}-${c}`}
            x={ox + bx * scale} y={oy + by * scale}
            width={boardW * scale} height={boardH * scale}
            fill="rgba(77,158,255,0.12)" stroke="#4d9eff" strokeWidth={1}
          />
        );
        // Rotation indicator
        if (config.rotation !== 0) {
          elements.push(
            <text key={`rot-${r}-${c}`}
              x={ox + (bx + boardW / 2) * scale} y={oy + (by + boardH / 2) * scale}
              fill="#4d9eff" fontSize={9} textAnchor="middle" dominantBaseline="middle"
            >{config.rotation}°</text>
          );
        }

        // Tab indicators between columns
        if (c < config.cols - 1) {
          const tabX = bx + boardW;
          const tabColor = config.tabMethod === 'vscore' ? '#e0d040' :
                           config.tabMethod === 'mousebite' ? '#40d0e0' : '#f0a030';
          if (config.tabMethod === 'vscore') {
            // V-score line
            elements.push(
              <line key={`vscore-v-${r}-${c}`}
                x1={ox + (tabX + config.spacingX / 2) * scale} y1={oy}
                x2={ox + (tabX + config.spacingX / 2) * scale} y2={oy + totalH * scale}
                stroke={tabColor} strokeWidth={1} strokeDasharray="3,2" />
            );
          } else {
            // Tab marks
            const numTabs = Math.max(1, Math.floor(boardH / config.tabSpacing));
            for (let t = 0; t < numTabs; t++) {
              const ty = by + (t + 0.5) * (boardH / numTabs);
              elements.push(
                <rect key={`tab-v-${r}-${c}-${t}`}
                  x={ox + tabX * scale} y={oy + (ty - config.tabWidth / 2) * scale}
                  width={config.spacingX * scale} height={config.tabWidth * scale}
                  fill={tabColor} opacity={0.5} />
              );
            }
          }
        }

        // Tab indicators between rows
        if (r < config.rows - 1 && c === 0) {
          const tabY = by + boardH;
          const tabColor = config.tabMethod === 'vscore' ? '#e0d040' :
                           config.tabMethod === 'mousebite' ? '#40d0e0' : '#f0a030';
          if (config.tabMethod === 'vscore') {
            elements.push(
              <line key={`vscore-h-${r}`}
                x1={ox} y1={oy + (tabY + config.spacingY / 2) * scale}
                x2={ox + totalW * scale} y2={oy + (tabY + config.spacingY / 2) * scale}
                stroke={tabColor} strokeWidth={1} strokeDasharray="3,2" />
            );
          }
        }
      }
    }

    // Tooling holes (4 corners)
    if (config.addToolingHoles) {
      const holeR = (config.toolingHoleDiameter / 2) * scale;
      const holeOffset = 2.5 * scale;
      const holes = [
        { x: ox + holeOffset, y: oy + holeOffset },
        { x: ox + totalW * scale - holeOffset, y: oy + holeOffset },
        { x: ox + holeOffset, y: oy + totalH * scale - holeOffset },
        { x: ox + totalW * scale - holeOffset, y: oy + totalH * scale - holeOffset },
      ];
      holes.forEach((h, i) =>
        elements.push(
          <circle key={`tooling-${i}`} cx={h.x} cy={h.y} r={Math.max(holeR, 3)}
            fill="none" stroke="#f0a030" strokeWidth={1.5} />
        )
      );
    }

    // Fiducials (3 corners)
    if (config.addFiducials) {
      const fidOffset = 4 * scale;
      const fids = [
        { x: ox + fidOffset, y: oy + fidOffset },
        { x: ox + totalW * scale - fidOffset, y: oy + fidOffset },
        { x: ox + fidOffset, y: oy + totalH * scale - fidOffset },
      ];
      fids.forEach((f, i) =>
        elements.push(
          <g key={`fid-${i}`}>
            <circle cx={f.x} cy={f.y} r={2.5} fill="#3cdc7c" opacity={0.7} />
            <circle cx={f.x} cy={f.y} r={5} fill="none" stroke="#3cdc7c" strokeWidth={0.5} opacity={0.5} />
          </g>
        )
      );
    }

    return (
      <svg width={svgW} height={svgH} style={{ background: theme.bg0, borderRadius: 6, border: theme.border }}>
        {elements}
        <text x={svgW / 2} y={svgH - 6} fill={theme.textMuted} fontSize={10} textAnchor="middle">
          {panelInfo.totalW.toFixed(1)} x {panelInfo.totalH.toFixed(1)} mm
        </text>
      </svg>
    );
  }, [config, boardW, boardH, panelInfo]);

  // Generate panel Gerber (text-based output)
  const handleExportPanel = useCallback(() => {
    const { totalW, totalH } = panelInfo;
    const lines: string[] = [
      `; Panel Gerber - ${config.rows}x${config.cols} array`,
      `; Board size: ${boardW.toFixed(2)} x ${boardH.toFixed(2)} mm`,
      `; Panel size: ${totalW.toFixed(2)} x ${totalH.toFixed(2)} mm`,
      `; Tab method: ${config.tabMethod}`,
      `; Rotation per instance: ${config.rotation} deg`,
      '',
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.100*%',
      'D10*',
      '',
      '; Panel outline',
      `X0Y0D02*`,
      `X${Math.round(totalW * 1e6)}Y0D01*`,
      `X${Math.round(totalW * 1e6)}Y${Math.round(totalH * 1e6)}D01*`,
      `X0Y${Math.round(totalH * 1e6)}D01*`,
      `X0Y0D01*`,
    ];

    // Board instances
    for (let r = 0; r < config.rows; r++) {
      for (let c = 0; c < config.cols; c++) {
        const bx = config.railLeft + c * (boardW + config.spacingX);
        const by = config.railTop + r * (boardH + config.spacingY);
        lines.push('');
        lines.push(`; Board instance [${r},${c}] at (${bx.toFixed(2)}, ${by.toFixed(2)})`);
        const x1 = Math.round(bx * 1e6);
        const y1 = Math.round(by * 1e6);
        const x2 = Math.round((bx + boardW) * 1e6);
        const y2 = Math.round((by + boardH) * 1e6);
        lines.push(`X${x1}Y${y1}D02*`);
        lines.push(`X${x2}Y${y1}D01*`);
        lines.push(`X${x2}Y${y2}D01*`);
        lines.push(`X${x1}Y${y2}D01*`);
        lines.push(`X${x1}Y${y1}D01*`);
      }
    }

    // V-score lines
    if (config.tabMethod === 'vscore') {
      lines.push('');
      lines.push('; V-score lines');
      // Horizontal
      for (let r = 0; r < config.rows - 1; r++) {
        const y = config.railTop + (r + 1) * boardH + r * config.spacingY + config.spacingY / 2;
        lines.push(`X0Y${Math.round(y * 1e6)}D02*`);
        lines.push(`X${Math.round(totalW * 1e6)}Y${Math.round(y * 1e6)}D01*`);
      }
      // Vertical
      for (let c = 0; c < config.cols - 1; c++) {
        const x = config.railLeft + (c + 1) * boardW + c * config.spacingX + config.spacingX / 2;
        lines.push(`X${Math.round(x * 1e6)}Y0D02*`);
        lines.push(`X${Math.round(x * 1e6)}Y${Math.round(totalH * 1e6)}D01*`);
      }
    }

    // Tooling holes (as drill data in comment form)
    if (config.addToolingHoles) {
      lines.push('');
      lines.push(`; Tooling holes (diameter: ${config.toolingHoleDiameter}mm)`);
      const off = 2.5;
      const holePositions = [
        [off, off], [totalW - off, off], [off, totalH - off], [totalW - off, totalH - off],
      ];
      holePositions.forEach(([hx, hy]) => {
        lines.push(`; Hole at (${hx.toFixed(2)}, ${hy.toFixed(2)})`);
      });
    }

    lines.push('');
    lines.push('M02*');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panel_${config.rows}x${config.cols}_outline.gbr`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [config, boardW, boardH, panelInfo]);

  if (!visible) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog}>
        <div style={styles.header}>
          <span style={styles.title}>Panelization</span>
          <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
        </div>

        <div style={styles.body}>
          {/* Left: Settings */}
          <div style={styles.settingsCol}>
            {/* Array size */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Array Size</div>
              <div style={styles.row}>
                <label style={styles.label}>Rows:</label>
                <input type="number" min={1} max={20} value={config.rows}
                  onChange={e => update('rows', Math.max(1, parseInt(e.target.value) || 1))}
                  style={styles.input} />
                <label style={styles.label}>Cols:</label>
                <input type="number" min={1} max={20} value={config.cols}
                  onChange={e => update('cols', Math.max(1, parseInt(e.target.value) || 1))}
                  style={styles.input} />
              </div>
              <div style={styles.row}>
                <label style={styles.label}>X spacing:</label>
                <input type="number" min={0} step={0.5} value={config.spacingX}
                  onChange={e => update('spacingX', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
                <span style={styles.unit}>mm</span>
                <label style={styles.label}>Y spacing:</label>
                <input type="number" min={0} step={0.5} value={config.spacingY}
                  onChange={e => update('spacingY', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
                <span style={styles.unit}>mm</span>
              </div>
            </div>

            {/* Rotation */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Board Rotation</div>
              <div style={styles.row}>
                {([0, 90, 180, 270] as Rotation[]).map(r => (
                  <button key={r}
                    style={{ ...styles.rotBtn, ...(config.rotation === r ? styles.rotBtnActive : {}) }}
                    onClick={() => update('rotation', r)}
                  >{r}°</button>
                ))}
              </div>
            </div>

            {/* Tab routing */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Tab Routing</div>
              <div style={styles.row}>
                <select style={styles.select} value={config.tabMethod}
                  onChange={e => update('tabMethod', e.target.value as TabMethod)}>
                  <option value="vscore">V-Score</option>
                  <option value="mousebite">Mouse Bites</option>
                  <option value="breakaway">Breakaway Tabs</option>
                </select>
              </div>
              {config.tabMethod !== 'vscore' && (
                <div style={styles.row}>
                  <label style={styles.label}>Tab width:</label>
                  <input type="number" min={0.5} step={0.5} value={config.tabWidth}
                    onChange={e => update('tabWidth', Math.max(0.5, parseFloat(e.target.value) || 3))}
                    style={styles.input} />
                  <span style={styles.unit}>mm</span>
                  <label style={styles.label}>Spacing:</label>
                  <input type="number" min={5} step={5} value={config.tabSpacing}
                    onChange={e => update('tabSpacing', Math.max(5, parseFloat(e.target.value) || 20))}
                    style={styles.input} />
                  <span style={styles.unit}>mm</span>
                </div>
              )}
              {config.tabMethod === 'mousebite' && (
                <div style={styles.row}>
                  <label style={styles.label}>Drill:</label>
                  <input type="number" min={0.3} step={0.1} value={config.mouseBiteDrill}
                    onChange={e => update('mouseBiteDrill', Math.max(0.3, parseFloat(e.target.value) || 0.5))}
                    style={styles.input} />
                  <span style={styles.unit}>mm</span>
                  <label style={styles.label}>Count:</label>
                  <input type="number" min={3} max={20} value={config.mouseBiteCount}
                    onChange={e => update('mouseBiteCount', Math.max(3, parseInt(e.target.value) || 5))}
                    style={styles.input} />
                </div>
              )}
            </div>

            {/* Panel rails */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Panel Rails (mm)</div>
              <div style={styles.row}>
                <label style={styles.label}>Top:</label>
                <input type="number" min={0} step={1} value={config.railTop}
                  onChange={e => update('railTop', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
                <label style={styles.label}>Bot:</label>
                <input type="number" min={0} step={1} value={config.railBottom}
                  onChange={e => update('railBottom', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
              </div>
              <div style={styles.row}>
                <label style={styles.label}>Left:</label>
                <input type="number" min={0} step={1} value={config.railLeft}
                  onChange={e => update('railLeft', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
                <label style={styles.label}>Right:</label>
                <input type="number" min={0} step={1} value={config.railRight}
                  onChange={e => update('railRight', Math.max(0, parseFloat(e.target.value) || 0))}
                  style={styles.input} />
              </div>
            </div>

            {/* Features */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Features</div>
              <div style={styles.row}>
                <label style={styles.checkLabel}>
                  <input type="checkbox" checked={config.addFiducials}
                    onChange={e => update('addFiducials', e.target.checked)} />
                  Panel fiducials
                </label>
              </div>
              <div style={styles.row}>
                <label style={styles.checkLabel}>
                  <input type="checkbox" checked={config.addToolingHoles}
                    onChange={e => update('addToolingHoles', e.target.checked)} />
                  Tooling holes
                </label>
                {config.addToolingHoles && (
                  <>
                    <input type="number" min={1} step={0.1} value={config.toolingHoleDiameter}
                      onChange={e => update('toolingHoleDiameter', Math.max(1, parseFloat(e.target.value) || 3.2))}
                      style={{ ...styles.input, width: 50 }} />
                    <span style={styles.unit}>mm</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div style={styles.previewCol}>
            <div style={styles.sectionTitle}>Panel Preview</div>
            {svgPreview}
            <div style={styles.infoRow}>
              <span style={styles.infoText}>
                Board: {bounds.w.toFixed(1)} x {bounds.h.toFixed(1)} mm
              </span>
              <span style={styles.infoText}>
                Panel: {panelInfo.totalW.toFixed(1)} x {panelInfo.totalH.toFixed(1)} mm
              </span>
              <span style={styles.infoText}>
                {config.rows * config.cols} boards
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.exportBtn} onClick={handleExportPanel}>
            Export Panel Gerber
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: theme.bg1,
    border: theme.border,
    borderRadius: 10,
    width: 820,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: theme.border,
  },
  title: {
    color: theme.textPrimary,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: theme.fontSans,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: 16,
    cursor: 'pointer',
  },
  body: {
    display: 'flex',
    padding: 16,
    gap: 16,
    overflow: 'auto',
  },
  settingsCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  previewCol: {
    width: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  section: {
    background: theme.bg2,
    borderRadius: 6,
    padding: '8px 10px',
  },
  sectionTitle: {
    color: theme.textMuted,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 6,
    fontFamily: theme.fontSans,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    flexWrap: 'wrap' as const,
  },
  label: {
    color: theme.textSecondary,
    fontSize: 11,
    fontFamily: theme.fontSans,
    minWidth: 50,
  },
  unit: {
    color: theme.textMuted,
    fontSize: 10,
    fontFamily: theme.fontMono,
  },
  input: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 4,
    color: theme.textPrimary,
    fontSize: 11,
    fontFamily: theme.fontMono,
    padding: '3px 6px',
    width: 55,
    height: 24,
  },
  select: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 4,
    color: theme.textPrimary,
    fontSize: 11,
    fontFamily: theme.fontSans,
    padding: '3px 6px',
    height: 24,
    cursor: 'pointer',
  },
  rotBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 4,
    color: theme.textSecondary,
    fontSize: 11,
    padding: '3px 10px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    height: 24,
  },
  rotBtnActive: {
    background: theme.blueDim,
    borderColor: theme.blue,
    color: theme.blue,
  },
  checkLabel: {
    color: theme.textSecondary,
    fontSize: 11,
    fontFamily: theme.fontSans,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
  },
  infoRow: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginTop: 4,
  },
  infoText: {
    color: theme.textMuted,
    fontSize: 10,
    fontFamily: theme.fontMono,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '10px 16px',
    borderTop: theme.border,
  },
  cancelBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 6,
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: 500,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  exportBtn: {
    background: `linear-gradient(135deg, ${theme.blueDim}, ${theme.greenDim})`,
    border: `1px solid ${theme.green}`,
    borderRadius: 6,
    color: theme.green,
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
};

export default PanelizationDialog;
