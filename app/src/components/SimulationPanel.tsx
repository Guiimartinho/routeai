// ─── Simulation Panel ────────────────────────────────────────────────────────
// UI for SPICE netlist generation, DC operating point analysis, and export.

import React, { useState, useCallback, useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { generateSpiceNetlist, generateSpiceFile } from '../engine/spiceNetlist';
import { solveDCOperatingPoint, formatEngineering, type SpiceResult } from '../engine/spiceSolver';
import { theme } from '../styles/theme';

// ─── Analysis types ──────────────────────────────────────────────────────────

type AnalysisType = 'dc_op' | 'dc_sweep' | 'transient';

const analysisOptions: { value: AnalysisType; label: string; available: boolean }[] = [
  { value: 'dc_op', label: 'DC Operating Point', available: true },
  { value: 'dc_sweep', label: 'DC Sweep (export only)', available: false },
  { value: 'transient', label: 'Transient (export only)', available: false },
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  background: theme.bg0,
  color: theme.textPrimary,
  fontFamily: theme.fontSans,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: `1px solid ${theme.bg3}`,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  background: theme.bg3,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textSecondary,
  fontSize: '12px',
  fontFamily: 'inherit',
  fontWeight: 500,
  padding: '6px 12px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

const btnAccentStyle: React.CSSProperties = {
  ...btnStyle,
  borderColor: theme.blue,
  color: theme.blue,
};

const btnGreenStyle: React.CSSProperties = {
  ...btnStyle,
  borderColor: theme.green,
  color: theme.green,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
  fontFamily: theme.fontMono,
};

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  borderBottom: `1px solid ${theme.bg3}`,
  color: theme.textMuted,
  fontWeight: 600,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  position: 'sticky',
  top: 0,
  background: theme.bg1,
  zIndex: 1,
};

const tdStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderBottom: `1px solid ${theme.bg2}`,
  color: theme.textPrimary,
};

// ─── Component ───────────────────────────────────────────────────────────────

const SimulationPanel: React.FC = () => {
  const { schematic, nets, extractNetlist } = useProjectStore();

  const [analysisType, setAnalysisType] = useState<AnalysisType>('dc_op');
  const [netlistText, setNetlistText] = useState<string>('');
  const [result, setResult] = useState<SpiceResult | null>(null);
  const [showNetlist, setShowNetlist] = useState(true);
  const [showResults, setShowResults] = useState(true);
  const [copied, setCopied] = useState(false);

  // ── Generate netlist from current schematic ──────────────────────
  const handleGenerateNetlist = useCallback(() => {
    // Extract nets first if not already done
    let currentNets = nets;
    if (currentNets.length === 0) {
      currentNets = extractNetlist();
    }
    const nl = generateSpiceNetlist(schematic.components, currentNets);
    setNetlistText(nl);
    setResult(null);
  }, [schematic.components, nets, extractNetlist]);

  // ── Run DC analysis ────────────────────────────────────────────────
  const handleRunAnalysis = useCallback(() => {
    if (!netlistText) {
      // Auto-generate if not done yet
      let currentNets = nets;
      if (currentNets.length === 0) {
        currentNets = extractNetlist();
      }
      const nl = generateSpiceNetlist(schematic.components, currentNets);
      setNetlistText(nl);
      const res = solveDCOperatingPoint(nl);
      setResult(res);
      return;
    }
    const res = solveDCOperatingPoint(netlistText);
    setResult(res);
  }, [netlistText, schematic.components, nets, extractNetlist]);

  // ── Export .cir file ───────────────────────────────────────────────
  const handleExport = useCallback(() => {
    let currentNets = nets;
    if (currentNets.length === 0) {
      currentNets = extractNetlist();
    }

    let content: string;
    if (netlistText) {
      content = netlistText;
    } else {
      const analysisMap: Record<AnalysisType, 'dc' | 'ac' | 'tran'> = {
        'dc_op': 'dc',
        'dc_sweep': 'dc',
        'transient': 'tran',
      };
      content = generateSpiceFile(schematic.components, currentNets, analysisMap[analysisType]);
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'circuit.cir';
    a.click();
    URL.revokeObjectURL(url);
  }, [netlistText, schematic.components, nets, extractNetlist, analysisType]);

  // ── Copy netlist to clipboard ──────────────────────────────────────
  const handleCopy = useCallback(() => {
    if (!netlistText) return;
    navigator.clipboard.writeText(netlistText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [netlistText]);

  // ── Sorted results for display ─────────────────────────────────────
  const sortedVoltages = useMemo(() => {
    if (!result) return [];
    return Array.from(result.nodeVoltages.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [result]);

  const sortedCurrents = useMemo(() => {
    if (!result) return [];
    return Array.from(result.branchCurrents.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [result]);

  // ── Count stats ────────────────────────────────────────────────────
  const componentCount = schematic.components.length;
  const netCount = nets.length;

  return (
    <div style={panelStyle}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <span style={{ fontSize: '16px' }}>{'\u{1F4CA}'}</span>
        <span style={{ fontWeight: 600, fontSize: '14px' }}>SPICE Simulation</span>
        <span style={{ color: theme.textMuted, fontSize: '11px', marginLeft: '4px' }}>
          {componentCount} components, {netCount} nets
        </span>
        <div style={{ flex: 1 }} />

        {/* Analysis type selector */}
        <select
          value={analysisType}
          onChange={(e) => setAnalysisType(e.target.value as AnalysisType)}
          style={{
            background: theme.bg2,
            color: theme.textPrimary,
            border: `1px solid ${theme.bg3}`,
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            fontFamily: 'inherit',
          }}
        >
          {analysisOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div style={{
        padding: '8px 16px',
        borderBottom: `1px solid ${theme.bg3}`,
        display: 'flex',
        gap: '8px',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <button style={btnAccentStyle} onClick={handleGenerateNetlist}>
          {'\u{1F4DD}'} Generate Netlist
        </button>
        <button
          style={btnGreenStyle}
          onClick={handleRunAnalysis}
          title={analysisType !== 'dc_op' ? 'Only DC Op Point runs in-browser. Use Export for other analyses.' : ''}
        >
          {'\u25B6'} Run DC Analysis
        </button>
        <button style={btnStyle} onClick={handleExport}>
          {'\u{1F4BE}'} Export .cir
        </button>
        <button
          style={btnStyle}
          onClick={handleCopy}
          disabled={!netlistText}
        >
          {copied ? '\u2713 Copied!' : '\u{1F4CB} Copy Netlist'}
        </button>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...btnStyle, fontSize: '11px' }}
          onClick={() => setShowNetlist(v => !v)}
        >
          {showNetlist ? 'Hide' : 'Show'} Netlist
        </button>
        <button
          style={{ ...btnStyle, fontSize: '11px' }}
          onClick={() => setShowResults(v => !v)}
        >
          {showResults ? 'Hide' : 'Show'} Results
        </button>
      </div>

      {/* ── Main content ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Netlist editor pane */}
        {showNetlist && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: showResults ? `1px solid ${theme.bg3}` : undefined,
            minWidth: 0,
          }}>
            <div style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              color: theme.textMuted,
              background: theme.bg1,
              borderBottom: `1px solid ${theme.bg2}`,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              SPICE Netlist
            </div>
            <textarea
              value={netlistText}
              onChange={(e) => setNetlistText(e.target.value)}
              placeholder="Click 'Generate Netlist' to create SPICE netlist from schematic, or type/paste a netlist here..."
              spellCheck={false}
              style={{
                flex: 1,
                background: theme.bg1,
                color: theme.textPrimary,
                border: 'none',
                padding: '10px 12px',
                fontSize: '12px',
                fontFamily: theme.fontMono,
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none',
                minWidth: 0,
              }}
            />
          </div>
        )}

        {/* Results pane */}
        {showResults && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
          }}>
            {/* Status bar */}
            {result && (
              <div style={{
                padding: '8px 12px',
                background: result.converged ? theme.greenDim : theme.redDim,
                borderBottom: `1px solid ${theme.bg3}`,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '12px',
                flexShrink: 0,
              }}>
                <span style={{
                  color: result.converged ? theme.green : theme.red,
                  fontWeight: 600,
                }}>
                  {result.converged ? '\u2713 Converged' : '\u2717 Failed'}
                </span>
                <span style={{ color: theme.textMuted }}>
                  {result.iterations} iteration{result.iterations !== 1 ? 's' : ''}
                </span>
                {result.error && (
                  <span style={{ color: theme.orange, fontSize: '11px' }}>
                    {result.error}
                  </span>
                )}
              </div>
            )}

            <div style={{ flex: 1, overflow: 'auto' }}>
              {!result ? (
                <div style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: theme.textMuted,
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>{'\u{1F4CA}'}</div>
                  <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '6px' }}>
                    No simulation results yet
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    Generate a netlist and click "Run DC Analysis" to solve the circuit.
                  </div>
                  <div style={{
                    fontSize: '11px',
                    marginTop: '16px',
                    color: theme.textMuted,
                    lineHeight: '1.6',
                  }}>
                    The built-in solver supports resistors, voltage/current sources,
                    inductors, and diodes (Newton-Raphson).<br />
                    For complex circuits, export the .cir file and use ngspice.
                  </div>
                </div>
              ) : (
                <>
                  {/* Node Voltages */}
                  <div style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: theme.textMuted,
                    background: theme.bg1,
                    borderBottom: `1px solid ${theme.bg2}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Node Voltages ({sortedVoltages.length})
                  </div>
                  <div style={{ maxHeight: '40%', overflow: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Net Name</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Voltage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedVoltages.map(([name, voltage]) => (
                          <tr key={name} style={{
                            background: name === '0' ? theme.bg2 : undefined,
                          }}>
                            <td style={{
                              ...tdStyle,
                              color: name === '0' ? theme.cyan : theme.textPrimary,
                              fontWeight: name === '0' ? 600 : 400,
                            }}>
                              {name}
                              {name === '0' && (
                                <span style={{ color: theme.textMuted, fontSize: '10px', marginLeft: '6px' }}>
                                  (GND)
                                </span>
                              )}
                            </td>
                            <td style={{
                              ...tdStyle,
                              textAlign: 'right',
                              color: Math.abs(voltage) > 0.001 ? theme.yellow : theme.textMuted,
                            }}>
                              {formatEngineering(voltage, 'V')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Branch Currents */}
                  <div style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: theme.textMuted,
                    background: theme.bg1,
                    borderBottom: `1px solid ${theme.bg2}`,
                    borderTop: `1px solid ${theme.bg3}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Branch Currents ({sortedCurrents.length})
                  </div>
                  <div style={{ overflow: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Component</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Current</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedCurrents.map(([name, current]) => (
                          <tr key={name}>
                            <td style={tdStyle}>{name}</td>
                            <td style={{
                              ...tdStyle,
                              textAlign: 'right',
                              color: Math.abs(current) > 1e-12 ? theme.cyan : theme.textMuted,
                            }}>
                              {formatEngineering(current, 'A')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SimulationPanel;
