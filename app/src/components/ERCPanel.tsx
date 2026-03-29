// ─── ERCPanel.tsx ── Electrical Rule Check panel ────────────────────────────
import React, { useState, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import {
  runERCWithResult,
  ERC_RULE_LABELS,
  type ERCResult,
  type ERCViolation,
  type ERCRuleKind,
} from '../engine/ercEngine';

// ─── Severity filter ────────────────────────────────────────────────────────

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: theme.bg1,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderBottom: `1px solid ${theme.bg3}`,
    userSelect: 'none' as const,
  },
  title: {
    fontSize: '13px',
    fontWeight: 600,
    flex: 1,
  },
  actionBar: {
    display: 'flex',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: `1px solid ${theme.bg3}`,
    flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 500,
    fontFamily: theme.fontSans,
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    whiteSpace: 'nowrap' as const,
  },
  btnPrimary: {
    background: theme.blue,
    color: '#fff',
  },
  btnSecondary: {
    background: theme.bg3,
    color: theme.textSecondary,
    border: `1px solid ${theme.bg3}`,
  },
  filterBar: {
    display: 'flex',
    gap: '4px',
    padding: '6px 12px',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  filterBtn: {
    padding: '3px 10px',
    fontSize: '11px',
    fontWeight: 500,
    fontFamily: theme.fontSans,
    borderRadius: '12px',
    border: `1px solid ${theme.bg3}`,
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    background: 'transparent',
    color: theme.textSecondary,
  },
  filterBtnActive: {
    background: theme.blueDim,
    color: theme.blue,
    borderColor: theme.blue,
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    borderBottom: `1px solid ${theme.bg3}`,
    flexWrap: 'wrap' as const,
  },
  scoreCircle: {
    position: 'relative' as const,
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  scoreText: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column' as const,
  },
  scoreValue: {
    fontSize: '18px',
    fontWeight: 700,
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: '8px',
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  statGroup: {
    display: 'flex',
    gap: '16px',
    flex: 1,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '2px',
  },
  statValue: {
    fontSize: '18px',
    fontWeight: 600,
  },
  statLabel: {
    fontSize: '9px',
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
  },
  passStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 10px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 600,
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  ruleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: theme.textSecondary,
    background: theme.bg2,
    cursor: 'pointer',
    userSelect: 'none' as const,
    borderBottom: `1px solid ${theme.bg3}`,
  },
  ruleCount: {
    fontSize: '10px',
    color: theme.textMuted,
    fontWeight: 400,
  },
  violation: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '6px 12px 6px 24px',
    cursor: 'pointer',
    transition: 'background 0.1s ease',
    borderBottom: `1px solid ${theme.bg3}`,
  },
  violationHover: {
    background: theme.bg2,
  },
  severityIcon: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
  },
  violationContent: {
    flex: 1,
    minWidth: 0,
  },
  violationDesc: {
    fontSize: '12px',
    color: theme.textPrimary,
    lineHeight: 1.3,
  },
  violationMeta: {
    fontSize: '10px',
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    marginTop: '2px',
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: 500,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px 20px',
    color: theme.textMuted,
  },
  emptyIcon: {
    fontSize: '32px',
    opacity: 0.5,
  },
  spinnerWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px 20px',
  },
};

// ─── Severity helpers ───────────────────────────────────────────────────────

function severityColor(s: 'error' | 'warning' | 'info'): string {
  switch (s) {
    case 'error': return theme.red;
    case 'warning': return theme.orange;
    case 'info': return theme.blue;
  }
}

function severityBg(s: 'error' | 'warning' | 'info'): string {
  switch (s) {
    case 'error': return theme.redDim;
    case 'warning': return theme.orangeDim;
    case 'info': return theme.blueDim;
  }
}

function severitySymbol(s: 'error' | 'warning' | 'info'): string {
  switch (s) {
    case 'error': return '\u2716';
    case 'warning': return '!';
    case 'info': return 'i';
  }
}

// ─── Score Circle (SVG) ────────────────────────────────────────────────────

const ScoreCircle: React.FC<{ score: number }> = ({ score }) => {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 90 ? theme.green : score >= 70 ? theme.orange : theme.red;

  return (
    <div style={styles.scoreCircle}>
      <svg width={56} height={56} viewBox="0 0 56 56">
        <circle
          cx={28} cy={28} r={radius}
          fill="none" stroke={theme.bg3} strokeWidth={4}
        />
        <circle
          cx={28} cy={28} r={radius}
          fill="none" stroke={color} strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
      </svg>
      <div style={styles.scoreText}>
        <span style={{ ...styles.scoreValue, color }}>{score}</span>
        <span style={styles.scoreLabel}>Score</span>
      </div>
    </div>
  );
};

// ─── ERCPanel Component ─────────────────────────────────────────────────────

const ERCPanel: React.FC = () => {
  const [result, setResult] = useState<ERCResult | null>(null);
  const [running, setRunning] = useState(false);
  const [collapsedRules, setCollapsedRules] = useState<Set<string>>(new Set());
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const toggleRule = useCallback((rule: string) => {
    setCollapsedRules((prev) => {
      const next = new Set(prev);
      if (next.has(rule)) next.delete(rule);
      else next.add(rule);
      return next;
    });
  }, []);

  const handleRunERC = useCallback(() => {
    setRunning(true);
    // Use requestAnimationFrame to let the spinner render before the sync check
    requestAnimationFrame(() => {
      const state = useProjectStore.getState();
      // Re-extract netlist to ensure it is current
      const nets = state.extractNetlist();
      const ercResult = runERCWithResult(state.schematic, nets);
      setResult(ercResult);
      setRunning(false);
    });
  }, []);

  const handleExportReport = useCallback(() => {
    if (!result) return;
    const lines = [
      'RouteAI Electrical Rule Check Report',
      '='.repeat(50),
      `Date: ${new Date(result.timestamp).toISOString()}`,
      `Score: ${result.score}/100`,
      `Run time: ${result.runTimeMs.toFixed(1)}ms`,
      `Total violations: ${result.violations.length}`,
      '',
      ...result.violations.map((v, i) =>
        `${i + 1}. [${v.severity.toUpperCase()}] ${v.rule}: ${v.message}` +
        (v.components.length > 0 ? `\n   Components: ${v.components.join(', ')}` : '') +
        (v.nets.length > 0 ? `\n   Nets: ${v.nets.join(', ')}` : '') +
        (v.x != null && v.y != null ? `\n   Location: (${v.x.toFixed(2)}, ${v.y.toFixed(2)})` : '')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'erc-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleNavigateTo = useCallback((x?: number, y?: number) => {
    if (x == null || y == null) return;
    // Dispatch navigation event for the schematic editor to handle
    window.dispatchEvent(new CustomEvent('routeai-navigate-to', {
      detail: { x, y },
    }));
  }, []);

  // ── Filtered violations ────────────────────────────────────────────
  const filteredViolations = result
    ? severityFilter === 'all'
      ? result.violations
      : result.violations.filter(v => v.severity === severityFilter)
    : [];

  // Group by rule kind
  const grouped = filteredViolations.reduce<Record<string, ERCViolation[]>>((acc, v) => {
    if (!acc[v.rule]) acc[v.rule] = [];
    acc[v.rule].push(v);
    return acc;
  }, {});

  const errors = result ? result.violations.filter(v => v.severity === 'error').length : 0;
  const warnings = result ? result.violations.filter(v => v.severity === 'warning').length : 0;
  const infos = result ? result.violations.filter(v => v.severity === 'info').length : 0;
  const passed = result ? errors === 0 : false;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: '14px' }}>{'\u26A1'}</span>
        <span style={styles.title}>Electrical Rule Check</span>
      </div>

      {/* Action buttons */}
      <div style={styles.actionBar}>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary, opacity: running ? 0.6 : 1 }}
          onClick={handleRunERC}
          disabled={running}
        >
          {running ? (
            <>
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 0.6s linear infinite',
                }}
              />
              Running...
            </>
          ) : (
            <>{'\u25B6'} Run ERC</>
          )}
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnSecondary }}
          onClick={handleExportReport}
          disabled={!result}
        >
          {'\u2913'} Export Report
        </button>
      </div>

      {/* Severity filter */}
      {result && result.violations.length > 0 && (
        <div style={styles.filterBar}>
          {(['all', 'error', 'warning', 'info'] as const).map(f => {
            const count = f === 'all' ? result.violations.length
              : f === 'error' ? errors
              : f === 'warning' ? warnings
              : infos;
            const isActive = severityFilter === f;
            return (
              <button
                key={f}
                style={{
                  ...styles.filterBtn,
                  ...(isActive ? styles.filterBtnActive : {}),
                }}
                onClick={() => setSeverityFilter(f)}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {result && (
        <div style={styles.summary}>
          <ScoreCircle score={result.score} />
          <div style={styles.statGroup}>
            <div style={styles.stat}>
              <span style={{ ...styles.statValue, color: errors > 0 ? theme.red : theme.green }}>
                {errors}
              </span>
              <span style={styles.statLabel}>Errors</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statValue, color: warnings > 0 ? theme.orange : theme.textSecondary }}>
                {warnings}
              </span>
              <span style={styles.statLabel}>Warnings</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statValue, color: theme.blue }}>{infos}</span>
              <span style={styles.statLabel}>Info</span>
            </div>
          </div>
          <span
            style={{
              ...styles.passStatus,
              background: passed ? theme.greenDim : theme.redDim,
              color: passed ? theme.green : theme.red,
            }}
          >
            {passed ? '\u2714 PASS' : '\u2716 FAIL'}
          </span>
          <span style={{ fontSize: '10px', color: theme.textMuted }}>
            {result.runTimeMs.toFixed(1)}ms
          </span>
        </div>
      )}

      {/* Violation list */}
      <div style={styles.body}>
        {running && (
          <div style={styles.spinnerWrap}>
            <span
              style={{
                display: 'inline-block',
                width: 24,
                height: 24,
                border: `3px solid ${theme.bg3}`,
                borderTopColor: theme.blue,
                borderRadius: '50%',
                animation: 'spin 0.6s linear infinite',
              }}
            />
            <span style={{ color: theme.textMuted, fontSize: '12px' }}>
              Analyzing electrical rules...
            </span>
          </div>
        )}

        {!running && !result && (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>{'\u26A1'}</span>
            <span style={{ fontSize: '12px' }}>
              Run ERC to check your schematic
            </span>
            <span style={{ fontSize: '10px', color: theme.textMuted, textAlign: 'center' }}>
              Electrical Rule Check validates pin connectivity,
              <br />
              power nets, floating inputs, and output conflicts.
            </span>
          </div>
        )}

        {!running && result && filteredViolations.length === 0 && (
          <div style={styles.empty}>
            <span style={{ ...styles.emptyIcon, color: theme.green }}>{'\u2714'}</span>
            <span style={{ fontSize: '12px', color: theme.green }}>
              {severityFilter === 'all'
                ? 'No ERC violations found!'
                : `No ${severityFilter} violations found.`}
            </span>
          </div>
        )}

        {!running &&
          result &&
          Object.entries(grouped)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([rule, violations]) => {
              const collapsed = collapsedRules.has(rule);
              const ruleErrors = violations.filter(v => v.severity === 'error').length;
              const ruleWarnings = violations.filter(v => v.severity === 'warning').length;

              return (
                <div key={rule}>
                  <div
                    style={styles.ruleHeader}
                    onClick={() => toggleRule(rule)}
                  >
                    <span style={{ fontSize: '10px', color: theme.textMuted }}>
                      {collapsed ? '\u25B6' : '\u25BC'}
                    </span>
                    <span>{ERC_RULE_LABELS[rule as ERCRuleKind] || rule}</span>
                    <span style={styles.ruleCount}>
                      ({violations.length})
                    </span>
                    {ruleErrors > 0 && (
                      <span
                        style={{
                          ...styles.tag,
                          background: theme.redDim,
                          color: theme.red,
                        }}
                      >
                        {ruleErrors} err
                      </span>
                    )}
                    {ruleWarnings > 0 && (
                      <span
                        style={{
                          ...styles.tag,
                          background: theme.orangeDim,
                          color: theme.orange,
                        }}
                      >
                        {ruleWarnings} warn
                      </span>
                    )}
                  </div>
                  {!collapsed &&
                    violations.map((v, idx) => {
                      const globalIdx = filteredViolations.indexOf(v);
                      return (
                        <div
                          key={`${rule}-${idx}`}
                          style={{
                            ...styles.violation,
                            ...(hoveredIdx === globalIdx ? styles.violationHover : {}),
                          }}
                          onMouseEnter={() => setHoveredIdx(globalIdx)}
                          onMouseLeave={() => setHoveredIdx(null)}
                          onClick={() => handleNavigateTo(v.x, v.y)}
                        >
                          <span
                            style={{
                              ...styles.severityIcon,
                              background: severityBg(v.severity),
                              color: severityColor(v.severity),
                            }}
                          >
                            {severitySymbol(v.severity)}
                          </span>
                          <div style={styles.violationContent}>
                            <div style={styles.violationDesc}>{v.message}</div>
                            <div style={styles.violationMeta}>
                              {v.components.length > 0 && (
                                <span>
                                  Components: {v.components.join(', ')}
                                </span>
                              )}
                              {v.nets.length > 0 && (
                                <span>
                                  Nets: {v.nets.join(', ')}
                                </span>
                              )}
                              {v.x != null && v.y != null && (
                                <span>
                                  ({v.x.toFixed(2)}, {v.y.toFixed(2)})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
      </div>
    </div>
  );
};

export default ERCPanel;
