// ─── DecomposedProgress.tsx ── Step-by-step progress for decomposed T1 tasks ──
import React from 'react';
import { theme } from '../styles/theme';

// ─── Types ─────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface ProgressStep {
  description: string;
  status: StepStatus;
}

export interface DecomposedProgressProps {
  steps: ProgressStep[];
  currentStep: number;
  totalSteps: number;
}

// ─── Status indicators ─────────────────────────────────────────────────────

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '\u23F3',   // hourglass
  running: '\u26A1',   // lightning
  done: '\u2713',      // checkmark
  error: '\u2717',     // cross
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: theme.textMuted,
  running: theme.orange,
  done: theme.green,
  error: theme.red,
};

const STATUS_BG: Record<StepStatus, string> = {
  pending: theme.bg3,
  running: theme.orangeDim,
  done: theme.greenDim,
  error: theme.redDim,
};

// ─── Component ─────────────────────────────────────────────────────────────

export const DecomposedProgress: React.FC<DecomposedProgressProps> = ({
  steps,
  currentStep,
  totalSteps,
}) => {
  const doneCount = steps.filter(s => s.status === 'done').length;
  const errorCount = steps.filter(s => s.status === 'error').length;
  const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : 0;

  return (
    <div style={styles.container}>
      {/* Progress header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Task Progress</span>
        <span style={styles.headerCount}>
          {doneCount}/{totalSteps}
          {errorCount > 0 && (
            <span style={styles.errorCount}> ({errorCount} failed)</span>
          )}
        </span>
      </div>

      {/* Progress bar */}
      <div style={styles.barContainer}>
        <div style={styles.barBg}>
          <div style={{
            ...styles.barFill,
            width: `${pct}%`,
            background: errorCount > 0
              ? `linear-gradient(90deg, ${theme.green}, ${theme.orange})`
              : `linear-gradient(90deg, ${theme.green}cc, ${theme.green})`,
          }} />
        </div>
        <span style={styles.barPct}>{pct}%</span>
      </div>

      {/* Step list */}
      <div style={styles.stepList}>
        {steps.map((step, i) => {
          const isCurrent = i === currentStep;
          return (
            <div
              key={i}
              style={{
                ...styles.stepItem,
                background: isCurrent ? theme.bg2 : 'transparent',
                borderColor: isCurrent ? STATUS_COLOR[step.status] : 'transparent',
              }}
            >
              <div style={{
                ...styles.stepIcon,
                background: STATUS_BG[step.status],
                color: STATUS_COLOR[step.status],
                ...(step.status === 'running' ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
              }}>
                {STATUS_ICON[step.status]}
              </div>
              <div style={styles.stepContent}>
                <span style={{
                  ...styles.stepNum,
                  color: STATUS_COLOR[step.status],
                }}>
                  Step {i + 1}
                </span>
                <span style={{
                  ...styles.stepDesc,
                  color: step.status === 'done'
                    ? theme.textMuted
                    : step.status === 'running'
                      ? theme.textPrimary
                      : step.status === 'error'
                        ? theme.red
                        : theme.textSecondary,
                  fontWeight: isCurrent ? 600 : 400,
                }}>
                  {step.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: theme.bg1,
    border: theme.border,
    borderRadius: theme.radiusMd,
    padding: '8px 10px',
    fontFamily: theme.fontSans,
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  headerTitle: {
    color: theme.textSecondary,
    fontSize: theme.fontXs,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  headerCount: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
  },
  errorCount: {
    color: theme.red,
  },

  // Progress bar
  barContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  barBg: {
    flex: 1,
    height: 4,
    background: theme.bg3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.4s ease',
  },
  barPct: {
    color: theme.textMuted,
    fontSize: '9px',
    fontFamily: theme.fontMono,
    fontWeight: 600,
    minWidth: 28,
    textAlign: 'right' as const,
  },

  // Step list
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px',
    borderRadius: theme.radiusSm,
    borderLeft: '2px solid',
    transition: 'background 0.2s ease',
  },
  stepIcon: {
    width: 18,
    height: 18,
    borderRadius: theme.radiusSm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '9px',
    fontWeight: 700,
    flexShrink: 0,
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
    minWidth: 0,
  },
  stepNum: {
    fontSize: '8px',
    fontWeight: 700,
    fontFamily: theme.fontMono,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  },
  stepDesc: {
    fontSize: theme.fontXs,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
};

export default DecomposedProgress;
