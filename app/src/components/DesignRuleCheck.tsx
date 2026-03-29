import React, { useState, useCallback } from 'react';
import { theme } from '../styles/theme';
import DRCConfigDialog from './DRCConfigDialog';
import { useProjectStore } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ViolationSeverity = 'error' | 'warning' | 'info';

export type ViolationCategory =
  | 'clearance'
  | 'width'
  | 'annular-ring'
  | 'courtyard'
  | 'connectivity'
  | 'copper-pour'
  | 'silkscreen'
  | 'drill'
  | 'impedance'
  | 'thermal';

export interface DRCViolation {
  id: string;
  severity: ViolationSeverity;
  category: ViolationCategory;
  description: string;
  x: number;
  y: number;
  layer?: string;
  netId?: string;
  elementIds?: string[];
}

export interface DRCResult {
  violations: DRCViolation[];
  score: number;
  runTime: number;
  timestamp: number;
}

export interface DesignRuleCheckProps {
  result?: DRCResult | null;
  running?: boolean;
  onRunDRC?: () => void;
  onRunAIReview?: () => void;
  onExportReport?: () => void;
  onNavigateTo?: (x: number, y: number) => void;
  onSelectElements?: (ids: string[]) => void;
}

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
    fontSize: theme.fontMd,
    fontWeight: 600,
    flex: 1,
  },
  actionBar: {
    display: 'flex',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: `1px solid ${theme.bg3}`,
    flexWrap: 'wrap' as const,
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '5px 12px',
    fontSize: theme.fontSm,
    fontWeight: 500,
    fontFamily: theme.fontSans,
    borderRadius: theme.radiusMd,
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
  btnAI: {
    background: theme.purpleDim,
    color: theme.purple,
    border: `1px solid rgba(160,109,255,0.2)`,
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
    fontSize: theme.fontLg,
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
    fontSize: theme.fontLg,
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
    borderRadius: theme.radiusFull,
    fontSize: theme.fontSm,
    fontWeight: 600,
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 0',
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    fontSize: theme.fontSm,
    fontWeight: 600,
    color: theme.textSecondary,
    background: theme.bg2,
    cursor: 'pointer',
    userSelect: 'none' as const,
    borderBottom: `1px solid ${theme.bg3}`,
  },
  categoryCount: {
    fontSize: theme.fontXs,
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
    fontSize: theme.fontSm,
    color: theme.textPrimary,
    lineHeight: 1.3,
  },
  violationLocation: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
    marginTop: '2px',
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

function severityColor(s: ViolationSeverity): string {
  switch (s) {
    case 'error': return theme.red;
    case 'warning': return theme.orange;
    case 'info': return theme.blue;
  }
}

function severityBg(s: ViolationSeverity): string {
  switch (s) {
    case 'error': return theme.redDim;
    case 'warning': return theme.orangeDim;
    case 'info': return theme.blueDim;
  }
}

function severitySymbol(s: ViolationSeverity): string {
  switch (s) {
    case 'error': return '\u2716';
    case 'warning': return '!';
    case 'info': return 'i';
  }
}

const CATEGORY_LABELS: Record<ViolationCategory, string> = {
  clearance: 'Clearance',
  width: 'Trace Width',
  'annular-ring': 'Annular Ring',
  courtyard: 'Courtyard',
  connectivity: 'Connectivity',
  'copper-pour': 'Copper Pour',
  silkscreen: 'Silkscreen',
  drill: 'Drill',
  impedance: 'Impedance',
  thermal: 'Thermal',
};

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
          cx={28}
          cy={28}
          r={radius}
          fill="none"
          stroke={theme.bg3}
          strokeWidth={4}
        />
        <circle
          cx={28}
          cy={28}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={4}
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

// ─── DesignRuleCheck Component ──────────────────────────────────────────────

const noop = () => {};
const DesignRuleCheck: React.FC<DesignRuleCheckProps> = (props) => {
  const result = props.result ?? null;
  const running = props.running ?? false;
  const onRunDRC = props.onRunDRC ?? noop;
  const onRunAIReview = props.onRunAIReview ?? noop;
  const onExportReport = props.onExportReport ?? noop;
  const onNavigateTo = props.onNavigateTo ?? (() => {});
  const onSelectElements = props.onSelectElements ?? (() => {});
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [hoveredViolation, setHoveredViolation] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // Group violations by category
  const grouped = result
    ? result.violations.reduce<Record<string, DRCViolation[]>>((acc, v) => {
        if (!acc[v.category]) acc[v.category] = [];
        acc[v.category].push(v);
        return acc;
      }, {})
    : {};

  const errors = result ? result.violations.filter((v) => v.severity === 'error').length : 0;
  const warnings = result ? result.violations.filter((v) => v.severity === 'warning').length : 0;
  const infos = result ? result.violations.filter((v) => v.severity === 'info').length : 0;
  const passed = result ? errors === 0 : false;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontSize: '14px' }}>{'\u2611'}</span>
        <span style={styles.title}>Design Rule Check</span>
      </div>

      {/* Action buttons */}
      <div style={styles.actionBar}>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary, opacity: running ? 0.6 : 1 }}
          onClick={onRunDRC}
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
            <>{'\u25B6'} Run DRC</>
          )}
        </button>
        <button style={{ ...styles.btn, ...styles.btnAI }} onClick={onRunAIReview}>
          {'\u2728'} AI Deep Review
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnSecondary }}
          onClick={onExportReport}
          disabled={!result}
        >
          {'\u2913'} Export Report
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnSecondary }}
          onClick={() => setConfigOpen(true)}
        >
          {'\u2699'} Configure Rules
        </button>
      </div>

      {/* DRC Config Dialog */}
      <DRCConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />

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
            <span style={{ color: theme.textMuted, fontSize: theme.fontSm }}>
              Analyzing design rules...
            </span>
          </div>
        )}

        {!running && !result && (
          <div style={styles.empty}>
            <span style={styles.emptyIcon}>{'\u2611'}</span>
            <span style={{ fontSize: theme.fontSm }}>
              Run DRC to check your design
            </span>
            <span style={{ fontSize: theme.fontXs, color: theme.textMuted, textAlign: 'center' }}>
              Design Rule Check validates clearance, connectivity,
              <br />
              trace width, and other manufacturing constraints.
            </span>
          </div>
        )}

        {!running && result && result.violations.length === 0 && (
          <div style={styles.empty}>
            <span style={{ ...styles.emptyIcon, color: theme.green }}>{'\u2714'}</span>
            <span style={{ fontSize: theme.fontSm, color: theme.green }}>
              No violations found!
            </span>
          </div>
        )}

        {!running &&
          result &&
          Object.entries(grouped)
            .sort(([, a], [, b]) => b.length - a.length)
            .map(([category, violations]) => {
              const collapsed = collapsedCategories.has(category);
              const catErrors = violations.filter((v) => v.severity === 'error').length;
              const catWarnings = violations.filter((v) => v.severity === 'warning').length;

              return (
                <div key={category}>
                  <div
                    style={styles.categoryHeader}
                    onClick={() => toggleCategory(category)}
                  >
                    <span style={{ fontSize: '10px', color: theme.textMuted }}>
                      {collapsed ? '\u25B6' : '\u25BC'}
                    </span>
                    <span>{CATEGORY_LABELS[category as ViolationCategory] || category}</span>
                    <span style={styles.categoryCount}>
                      ({violations.length})
                    </span>
                    {catErrors > 0 && (
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '0 4px',
                          borderRadius: theme.radiusSm,
                          background: theme.redDim,
                          color: theme.red,
                        }}
                      >
                        {catErrors} err
                      </span>
                    )}
                    {catWarnings > 0 && (
                      <span
                        style={{
                          fontSize: '9px',
                          padding: '0 4px',
                          borderRadius: theme.radiusSm,
                          background: theme.orangeDim,
                          color: theme.orange,
                        }}
                      >
                        {catWarnings} warn
                      </span>
                    )}
                  </div>
                  {!collapsed &&
                    violations.map((v) => (
                      <div
                        key={v.id}
                        style={{
                          ...styles.violation,
                          ...(hoveredViolation === v.id ? styles.violationHover : {}),
                        }}
                        onMouseEnter={() => setHoveredViolation(v.id)}
                        onMouseLeave={() => setHoveredViolation(null)}
                        onClick={() => {
                          onNavigateTo(v.x, v.y);
                          if (v.elementIds) onSelectElements(v.elementIds);
                        }}
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
                          <div style={styles.violationDesc}>{v.description}</div>
                          <div style={styles.violationLocation}>
                            ({v.x.toFixed(2)}, {v.y.toFixed(2)})
                            {v.layer && <span> {'\u00B7'} {v.layer}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
      </div>
    </div>
  );
};

export default DesignRuleCheck;
