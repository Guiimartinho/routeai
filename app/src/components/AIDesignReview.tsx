// ─── AIDesignReview.tsx ── AI-powered PCB design review panel ────────────────
import React, { useState, useCallback, useMemo } from 'react';
import { theme } from '../styles/theme';
import type { SchNet, BrdComponent, BoardState } from '../types';
import {
  useOllama,
  buildDesignReviewPrompt,
  type DesignFinding,
  type DesignReviewResult,
} from '../hooks/useOllama';
import { useProjectStore } from '../store/projectStore';

// ─── Types ──────────────────────────────────────────────────────────────────

type FindingCategory = 'all' | DesignFinding['category'];
type SeverityFilter = 'all' | DesignFinding['severity'];

export interface AIDesignReviewProps {
  visible?: boolean;
  onClose?: () => void;
  boardState?: BoardState;
  nets?: SchNet[];
  onNavigateTo?: (x: number, y: number) => void;
  onAutoFix?: (finding: DesignFinding) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<DesignFinding['category'], string> = {
  placement: 'Placement',
  routing: 'Routing',
  thermal: 'Thermal',
  'signal-integrity': 'Signal Integrity',
  'power-integrity': 'Power Integrity',
  dfm: 'DFM',
  emc: 'EMC',
};

const CATEGORY_ICONS: Record<DesignFinding['category'], string> = {
  placement: '\uD83D\uDCE6',
  routing: '\uD83D\uDDFA',
  thermal: '\uD83C\uDF21',
  'signal-integrity': '\u26A1',
  'power-integrity': '\uD83D\uDD0B',
  dfm: '\uD83C\uDFED',
  emc: '\uD83D\uDEE1',
};

const SEVERITY_COLORS: Record<DesignFinding['severity'], string> = {
  critical: theme.red,
  warning: theme.orange,
  suggestion: theme.blue,
  info: theme.textMuted,
};

const SEVERITY_BG: Record<DesignFinding['severity'], string> = {
  critical: theme.redDim,
  warning: theme.orangeDim,
  suggestion: theme.blueDim,
  info: theme.bg3,
};

// ─── Component ──────────────────────────────────────────────────────────────

const AIDesignReview: React.FC<AIDesignReviewProps> = (props) => {
  const store = useProjectStore();
  const visible = props.visible ?? true;
  const onClose = props.onClose ?? (() => {});
  const boardState = props.boardState ?? store.board;
  const nets = props.nets ?? store.nets;
  const onNavigateTo = props.onNavigateTo;
  const onAutoFix = props.onAutoFix;
  const ollama = useOllama();

  const [review, setReview] = useState<DesignReviewResult | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<FindingCategory>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);

  // ── Fallback review engine (defined BEFORE runReview to avoid TDZ) ──

  const generateFallbackReview = useCallback((): DesignReviewResult => {
    const findings: DesignFinding[] = [];
    let findingIdx = 0;

    const ics = boardState.components.filter(c =>
      /QFP|BGA|QFN|LQFP|TSSOP|SOIC/i.test(c.footprint) || c.ref.startsWith('U')
    );
    const caps = boardState.components.filter(c => c.ref.startsWith('C'));

    for (const ic of ics) {
      const powerPads = ic.pads.filter(p => p.netId && /VCC|VDD|3V3|5V/i.test(p.netId));
      for (const pp of powerPads) {
        const padX = ic.x + pp.x;
        const padY = ic.y + pp.y;
        const nearestCap = caps.reduce<{ cap: typeof caps[0] | null; dist: number }>(
          (best, cap) => {
            const hasMatchingNet = cap.pads.some(cp => cp.netId === pp.netId);
            if (!hasMatchingNet) return best;
            const dist = Math.hypot(cap.x - padX, cap.y - padY);
            return dist < best.dist ? { cap, dist } : best;
          }, { cap: null, dist: Infinity }
        );
        if (!nearestCap.cap) {
          findings.push({ id: `f_${findingIdx++}`, severity: 'critical', category: 'placement', title: `Missing decoupling cap for ${ic.ref}`, description: `${ic.ref} pad ${pp.number} (${pp.netId}) has no associated decoupling capacitor.`, affectedComponents: [ic.ref], suggestedFix: `Add 100nF ceramic cap close to ${ic.ref} pad ${pp.number}`, autoFixable: false, x: padX, y: padY });
        } else if (nearestCap.dist > 3) {
          findings.push({ id: `f_${findingIdx++}`, severity: 'warning', category: 'placement', title: `Decoupling cap too far from ${ic.ref}`, description: `${nearestCap.cap.ref} is ${nearestCap.dist.toFixed(1)}mm from ${ic.ref} pad ${pp.number}.`, affectedComponents: [nearestCap.cap.ref, ic.ref], suggestedFix: `Move ${nearestCap.cap.ref} within 2mm of ${ic.ref}`, autoFixable: true, x: nearestCap.cap.x, y: nearestCap.cap.y });
        }
      }
    }

    const crystals = boardState.components.filter(c => c.ref.startsWith('Y'));
    for (const xtal of crystals) {
      const nearestIC = ics.reduce<{ ic: typeof ics[0] | null; dist: number }>((best, ic) => { const dist = Math.hypot(ic.x - xtal.x, ic.y - xtal.y); return dist < best.dist ? { ic, dist } : best; }, { ic: null, dist: Infinity });
      if (nearestIC.ic && nearestIC.dist > 10) {
        findings.push({ id: `f_${findingIdx++}`, severity: 'warning', category: 'signal-integrity', title: `Crystal ${xtal.ref} far from MCU`, description: `${xtal.ref} is ${nearestIC.dist.toFixed(1)}mm from ${nearestIC.ic.ref}.`, affectedComponents: [xtal.ref, nearestIC.ic.ref], suggestedFix: `Move ${xtal.ref} within 5mm of ${nearestIC.ic.ref}`, autoFixable: true, x: xtal.x, y: xtal.y });
      }
    }

    const connectors = boardState.components.filter(c => c.ref.startsWith('J'));
    const outline = boardState.outline.points;
    if (outline.length >= 4) {
      const minBrdX = Math.min(...outline.map(p => p.x));
      const maxBrdX = Math.max(...outline.map(p => p.x));
      const minBrdY = Math.min(...outline.map(p => p.y));
      const maxBrdY = Math.max(...outline.map(p => p.y));
      for (const conn of connectors) {
        const edgeDist = Math.min(conn.x - minBrdX, maxBrdX - conn.x, conn.y - minBrdY, maxBrdY - conn.y);
        if (edgeDist > 10) {
          findings.push({ id: `f_${findingIdx++}`, severity: 'suggestion', category: 'placement', title: `Connector ${conn.ref} not at edge`, description: `${conn.ref} is ${edgeDist.toFixed(1)}mm from nearest edge.`, affectedComponents: [conn.ref], suggestedFix: `Move ${conn.ref} to board edge`, autoFixable: true, x: conn.x, y: conn.y });
        }
      }
    }

    const powerNets = nets.filter(n => /VCC|VDD|3V3|5V|12V|VBUS/i.test(n.name));
    for (const pnet of powerNets) {
      const traces = boardState.traces.filter(t => t.netId === pnet.id);
      const thinTraces = traces.filter(t => t.width < 0.3);
      if (thinTraces.length > 0) {
        findings.push({ id: `f_${findingIdx++}`, severity: 'warning', category: 'power-integrity', title: `Thin power trace on ${pnet.name}`, description: `${thinTraces.length} segment(s) are only ${thinTraces[0].width}mm wide.`, affectedComponents: [], suggestedFix: `Widen to at least 0.3mm`, autoFixable: true, x: thinTraces[0].points[0]?.x, y: thinTraces[0].points[0]?.y });
      }
    }

    const thermalPkgs = boardState.components.filter(c => /QFN|BGA|PowerPAD|DPAK|D2PAK/i.test(c.footprint));
    for (const pkg of thermalPkgs) {
      const nearbyVias = boardState.vias.filter(v => Math.hypot(v.x - pkg.x, v.y - pkg.y) < 3);
      if (nearbyVias.length < 4) {
        findings.push({ id: `f_${findingIdx++}`, severity: 'suggestion', category: 'thermal', title: `Missing thermal vias under ${pkg.ref}`, description: `Only ${nearbyVias.length} via(s) within 3mm.`, affectedComponents: [pkg.ref], suggestedFix: `Add 3x3 via array under ${pkg.ref}`, autoFixable: false, x: pkg.x, y: pkg.y });
      }
    }

    const gndZones = boardState.zones.filter(z => z.netId && /GND/i.test(z.netId));
    if (gndZones.length === 0 && boardState.components.length > 3) {
      findings.push({ id: `f_${findingIdx++}`, severity: 'warning', category: 'emc', title: 'No ground plane detected', description: 'No ground copper zone found.', affectedComponents: [], suggestedFix: 'Add ground zone on bottom layer', autoFixable: false });
    }

    const critCount = findings.filter(f => f.severity === 'critical').length;
    const warnCount = findings.filter(f => f.severity === 'warning').length;
    const suggCount = findings.filter(f => f.severity === 'suggestion').length;
    const score = Math.max(0, Math.min(100, 100 - critCount * 15 - warnCount * 5 - suggCount * 2));
    const summary = critCount > 0 ? `${critCount} critical issue(s) found.` : warnCount > 0 ? `${warnCount} warning(s) to address.` : 'Design looks good.';
    return { findings, overallScore: score, summary };
  }, [boardState, nets]);

  // ── Run review ─────────────────────────────────────────────────

  const runReview = useCallback(async () => {
    setIsReviewing(true);
    setReview(null);

    const prompt = buildDesignReviewPrompt(boardState.components, nets, boardState);

    try {
      const response = await ollama.generate(
        [{ role: 'user', content: prompt }],
        { json: true }
      );
      const parsed = ollama.parseJsonResponse<DesignReviewResult>(response);
      if (parsed && parsed.findings) {
        // Assign IDs if missing
        parsed.findings = parsed.findings.map((f, i) => ({
          ...f,
          id: f.id || `finding_${i}`,
          autoFixable: f.autoFixable ?? false,
          affectedComponents: f.affectedComponents || [],
        }));
        setReview(parsed);
      } else {
        setReview(generateFallbackReview());
      }
    } catch {
      setReview(generateFallbackReview());
    }

    setIsReviewing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardState, nets, ollama, generateFallbackReview]);

  // ── Auto-fix handler ───────────────────────────────────────────

  const handleAutoFix = useCallback(async (finding: DesignFinding) => {
    setFixingId(finding.id);
    // Simulate fix delay
    await new Promise(r => setTimeout(r, 500));
    onAutoFix?.(finding);
    // Remove the finding from results
    setReview(prev => {
      if (!prev) return prev;
      const newFindings = prev.findings.filter(f => f.id !== finding.id);
      const critCount = newFindings.filter(f => f.severity === 'critical').length;
      const warnCount = newFindings.filter(f => f.severity === 'warning').length;
      const suggCount = newFindings.filter(f => f.severity === 'suggestion').length;
      const newScore = Math.max(0, Math.min(100, 100 - critCount * 15 - warnCount * 5 - suggCount * 2));
      return {
        ...prev,
        findings: newFindings,
        overallScore: newScore,
      };
    });
    setFixingId(null);
  }, [onAutoFix]);

  // ── Filtered findings ──────────────────────────────────────────

  const filteredFindings = useMemo(() => {
    if (!review) return [];
    return review.findings.filter(f => {
      if (categoryFilter !== 'all' && f.category !== categoryFilter) return false;
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      return true;
    });
  }, [review, categoryFilter, severityFilter]);

  // ── Severity counts ────────────────────────────────────────────

  const severityCounts = useMemo(() => {
    if (!review) return { critical: 0, warning: 0, suggestion: 0, info: 0 };
    return {
      critical: review.findings.filter(f => f.severity === 'critical').length,
      warning: review.findings.filter(f => f.severity === 'warning').length,
      suggestion: review.findings.filter(f => f.severity === 'suggestion').length,
      info: review.findings.filter(f => f.severity === 'info').length,
    };
  }, [review]);

  if (!visible) return null;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.aiIcon}>AI</div>
          <span style={styles.title}>Design Review</span>
        </div>
        <button style={styles.closeBtn} onClick={onClose}>{'\u2715'}</button>
      </div>

      {/* Status */}
      <div style={styles.statusBar}>
        <div style={{
          ...styles.statusDot,
          background: ollama.status.connected ? theme.green : theme.orange,
        }} />
        <span style={styles.statusText}>
          {ollama.status.connected ? ollama.config.model : 'Fallback engine'}
        </span>
      </div>

      {/* No review yet */}
      {!review && !isReviewing && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>{'\uD83D\uDD0D'}</div>
          <div style={styles.emptyTitle}>AI Design Review</div>
          <div style={styles.emptyDesc}>
            Run a comprehensive AI review of your PCB design checking placement, routing, thermal, signal integrity, power integrity, DFM, and EMC.
          </div>
          <button style={styles.reviewBtn} onClick={runReview}>
            Review Design
          </button>
        </div>
      )}

      {/* Reviewing */}
      {isReviewing && (
        <div style={styles.emptyState}>
          <div style={styles.spinner} />
          <div style={styles.reviewingLabel}>
            Reviewing {boardState.components.length} components, {boardState.traces.length} traces...
          </div>
          <div style={styles.reviewingSubtext}>
            Checking placement, routing, thermal, SI, PI, DFM, EMC
          </div>
        </div>
      )}

      {/* Review results */}
      {review && !isReviewing && (
        <div style={styles.results}>
          {/* Score */}
          <div style={styles.scoreSection}>
            <div style={styles.scoreCircle}>
              <svg width={64} height={64} viewBox="0 0 64 64">
                <circle cx={32} cy={32} r={28} fill="none"
                  stroke={theme.bg3} strokeWidth={4} />
                <circle cx={32} cy={32} r={28} fill="none"
                  stroke={
                    review.overallScore >= 80 ? theme.green :
                    review.overallScore >= 50 ? theme.orange : theme.red
                  }
                  strokeWidth={4}
                  strokeDasharray={`${review.overallScore * 1.76} 176`}
                  strokeLinecap="round"
                  transform="rotate(-90 32 32)"
                />
                <text x={32} y={32} textAnchor="middle" dominantBaseline="central"
                  fill={theme.textPrimary} fontSize="18" fontWeight="700"
                  fontFamily={theme.fontMono}>
                  {review.overallScore}
                </text>
              </svg>
            </div>
            <div style={styles.scoreSummary}>
              <div style={styles.summaryText}>{review.summary}</div>
              <div style={styles.severityCounts}>
                {severityCounts.critical > 0 && (
                  <span style={{ ...styles.countBadge, background: theme.redDim, color: theme.red }}>
                    {severityCounts.critical} Critical
                  </span>
                )}
                {severityCounts.warning > 0 && (
                  <span style={{ ...styles.countBadge, background: theme.orangeDim, color: theme.orange }}>
                    {severityCounts.warning} Warning
                  </span>
                )}
                {severityCounts.suggestion > 0 && (
                  <span style={{ ...styles.countBadge, background: theme.blueDim, color: theme.blue }}>
                    {severityCounts.suggestion} Suggestion
                  </span>
                )}
                {severityCounts.info > 0 && (
                  <span style={{ ...styles.countBadge, background: theme.bg3, color: theme.textMuted }}>
                    {severityCounts.info} Info
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={styles.filters}>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Category:</span>
              <select
                style={styles.filterSelect}
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value as FindingCategory)}
              >
                <option value="all">All</option>
                {(Object.entries(CATEGORY_LABELS) as [DesignFinding['category'], string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div style={styles.filterGroup}>
              <span style={styles.filterLabel}>Severity:</span>
              <select
                style={styles.filterSelect}
                value={severityFilter}
                onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
              >
                <option value="all">All</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="suggestion">Suggestion</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>

          {/* Findings list */}
          <div style={styles.findingsList}>
            {filteredFindings.length === 0 ? (
              <div style={styles.noFindings}>
                No findings match the current filters.
              </div>
            ) : (
              filteredFindings.map(finding => {
                const isExpanded = expandedFinding === finding.id;
                const isFixing = fixingId === finding.id;

                return (
                  <div
                    key={finding.id}
                    style={{
                      ...styles.findingCard,
                      borderLeftColor: SEVERITY_COLORS[finding.severity],
                    }}
                  >
                    {/* Finding header */}
                    <div
                      style={styles.findingHeader}
                      onClick={() => setExpandedFinding(isExpanded ? null : finding.id)}
                    >
                      <div style={styles.findingLeft}>
                        <span style={{
                          ...styles.severityBadge,
                          background: SEVERITY_BG[finding.severity],
                          color: SEVERITY_COLORS[finding.severity],
                        }}>
                          {finding.severity.toUpperCase()}
                        </span>
                        <span style={styles.categoryTag}>
                          {CATEGORY_ICONS[finding.category]} {CATEGORY_LABELS[finding.category]}
                        </span>
                      </div>
                      <span style={styles.expandArrow}>
                        {isExpanded ? '\u25B4' : '\u25BE'}
                      </span>
                    </div>

                    <div style={styles.findingTitle}>{finding.title}</div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div style={styles.findingDetails}>
                        <div style={styles.findingDesc}>{finding.description}</div>

                        {finding.affectedComponents.length > 0 && (
                          <div style={styles.affectedRow}>
                            <span style={styles.detailLabel}>Affected:</span>
                            <div style={styles.affectedChips}>
                              {finding.affectedComponents.map(comp => (
                                <span key={comp} style={styles.affectedChip}>{comp}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={styles.suggestedFix}>
                          <span style={styles.detailLabel}>Suggested fix:</span>
                          <span style={styles.fixText}>{finding.suggestedFix}</span>
                        </div>

                        {/* Action buttons */}
                        <div style={styles.findingActions}>
                          {finding.x !== undefined && finding.y !== undefined && onNavigateTo && (
                            <button
                              style={styles.navBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigateTo(finding.x!, finding.y!);
                              }}
                            >
                              Navigate
                            </button>
                          )}
                          {finding.autoFixable && onAutoFix && (
                            <button
                              style={{
                                ...styles.fixBtn,
                                opacity: isFixing ? 0.5 : 1,
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAutoFix(finding);
                              }}
                              disabled={isFixing}
                            >
                              {isFixing ? 'Fixing...' : 'Auto-fix'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Re-review button */}
          <div style={styles.bottomActions}>
            <button style={styles.reReviewBtn} onClick={runReview}>
              Re-review Design
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 380,
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
  aiIcon: {
    width: 22,
    height: 22,
    borderRadius: theme.radiusSm,
    background: `linear-gradient(135deg, ${theme.orange}, ${theme.red})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '8px',
    fontWeight: 800,
    fontFamily: theme.fontMono,
  },
  title: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
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

  // Empty state
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  emptyDesc: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: 280,
  },
  reviewBtn: {
    background: `linear-gradient(135deg, ${theme.orange}cc, ${theme.red}cc)`,
    border: 'none',
    borderRadius: theme.radiusMd,
    color: '#fff',
    fontSize: theme.fontSm,
    fontWeight: 600,
    padding: '10px 24px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    marginTop: 8,
  },
  spinner: {
    width: 28,
    height: 28,
    border: `3px solid ${theme.bg3}`,
    borderTopColor: theme.orange,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  reviewingLabel: {
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    textAlign: 'center',
  },
  reviewingSubtext: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    textAlign: 'center',
  },

  // Results
  results: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },

  // Score section
  scoreSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '12px 14px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  scoreCircle: {
    flexShrink: 0,
  },
  scoreSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: 1,
  },
  summaryText: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    lineHeight: 1.4,
  },
  severityCounts: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  countBadge: {
    fontSize: '9px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 3,
    fontFamily: theme.fontSans,
  },

  // Filters
  filters: {
    display: 'flex',
    gap: 8,
    padding: '6px 14px',
    borderBottom: theme.border,
    flexShrink: 0,
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  filterLabel: {
    color: theme.textMuted,
    fontSize: '9px',
  },
  filterSelect: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: 2,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    padding: '2px 4px',
    fontFamily: theme.fontSans,
    cursor: 'pointer',
    outline: 'none',
  },

  // Findings
  findingsList: {
    flex: 1,
    overflow: 'auto',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  noFindings: {
    color: theme.textMuted,
    fontSize: theme.fontXs,
    textAlign: 'center',
    padding: 20,
  },
  findingCard: {
    background: theme.bg2,
    borderRadius: theme.radiusSm,
    border: theme.border,
    borderLeft: '3px solid',
    overflow: 'hidden',
  },
  findingHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 8px',
    cursor: 'pointer',
  },
  findingLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  severityBadge: {
    fontSize: '7px',
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
  categoryTag: {
    color: theme.textMuted,
    fontSize: '9px',
  },
  expandArrow: {
    color: theme.textMuted,
    fontSize: '10px',
  },
  findingTitle: {
    color: theme.textPrimary,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '0 8px 6px',
    lineHeight: 1.3,
  },
  findingDetails: {
    padding: '6px 8px 8px',
    borderTop: theme.border,
    background: theme.bg1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  findingDesc: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    lineHeight: 1.4,
  },
  affectedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  detailLabel: {
    color: theme.textMuted,
    fontSize: '9px',
    flexShrink: 0,
  },
  affectedChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 3,
  },
  affectedChip: {
    background: theme.bg3,
    borderRadius: 2,
    color: theme.textSecondary,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    fontWeight: 600,
  },
  suggestedFix: {
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
  },
  fixText: {
    color: theme.green,
    fontSize: theme.fontXs,
    lineHeight: 1.3,
  },
  findingActions: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
  },
  navBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    fontSize: '9px',
    fontWeight: 500,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  fixBtn: {
    background: theme.greenDim,
    border: `1px solid ${theme.green}44`,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: '9px',
    fontWeight: 600,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },

  // Bottom actions
  bottomActions: {
    padding: '8px 14px',
    borderTop: theme.border,
    flexShrink: 0,
  },
  reReviewBtn: {
    width: '100%',
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 500,
    padding: '8px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
};

export default AIDesignReview;
