import { useState, useMemo, useCallback } from 'react';
import {
  Activity,
  Zap,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Waves,
  GitBranch,
  Battery,
  TrendingUp,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SegmentIssue {
  segmentIndex: number;
  start: [number, number];
  end: [number, number];
  layer: string;
  widthMm: number;
  actualZ0: number;
  targetZ0: number;
  deviationPct: number;
  issueType: 'out_of_spec' | 'width_change' | 'via_transition';
  description: string;
}

interface PerNetResult {
  netName: string;
  targetZ0: number;
  actualZ0Range: [number, number];
  deviationPct: number;
  segmentsWithIssues: SegmentIssue[];
  totalSegments: number;
  passed: boolean;
}

interface ImpedanceReport {
  perNetResults: PerNetResult[];
  overallPass: boolean;
  summary: string;
  totalNetsAnalyzed: number;
  totalSegmentsAnalyzed: number;
  totalIssues: number;
}

interface CouplingPair {
  aggressorNet: string;
  victimNet: string;
  layer: string;
  parallelLengthMm: number;
  separationMm: number;
  nextDb: number;
  fextDb: number;
  worstDb: number;
  passed: boolean;
  mitigations: { action: string; description: string; estimatedImprovementDb: number }[];
}

interface CrosstalkReport {
  couplingPairs: CouplingPair[];
  overallPass: boolean;
  summary: string;
  maxCouplingDb: number;
  totalViolations: number;
}

interface ReturnPathReport {
  planeDiscontinuities: {
    location: [number, number];
    layer: string;
    type: string;
    description: string;
    severity: string;
  }[];
  viaTransitionIssues: {
    viaLocation: [number, number];
    netName: string;
    fromLayer: string;
    toLayer: string;
    referenceChanged: boolean;
    severity: string;
    description: string;
  }[];
  stitchingSuggestions: {
    location: [number, number];
    connectLayers: [string, string];
    reason: string;
    priority: string;
  }[];
  overallPass: boolean;
  summary: string;
}

interface ImpedancePlotPoint {
  frequencyHz: number;
  impedanceOhms: number;
  targetZOhms: number;
  withinTarget: boolean;
}

interface PDNReport {
  targetImpedances: {
    railName: string;
    voltage: number;
    maxCurrent: number;
    targetZOhms: number;
  }[];
  decapSuggestions: {
    capacitance: number;
    package: string;
    quantity: number;
    reason: string;
  }[];
  impedancePlot: ImpedancePlotPoint[];
  planeCapacitancePf: number;
  overallPass: boolean;
  summary: string;
}

interface SIPIAnalysisState {
  impedance: ImpedanceReport | null;
  crosstalk: CrosstalkReport | null;
  returnPath: ReturnPathReport | null;
  pdn: PDNReport | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFrequency(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(1)}GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(1)}MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(1)}kHz`;
  return `${hz.toFixed(0)}Hz`;
}

function formatCapacitance(farads: number): string {
  if (farads >= 1e-6) return `${(farads * 1e6).toFixed(1)}uF`;
  if (farads >= 1e-9) return `${(farads * 1e9).toFixed(0)}nF`;
  return `${(farads * 1e12).toFixed(0)}pF`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  icon: Icon,
  passed,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  passed: boolean | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-900/50 hover:bg-gray-800/50 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        )}
        <Icon className="w-4 h-4 text-brand-400 shrink-0" />
        <span className="text-sm font-medium text-gray-200 flex-1">{title}</span>
        {passed !== null && (
          passed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          )
        )}
      </button>
      {open && <div className="p-3 border-t border-gray-800">{children}</div>}
    </div>
  );
}

function ImpedanceBar({ actual, target, tolerance = 10 }: { actual: [number, number]; target: number; tolerance?: number }) {
  const low = target * (1 - tolerance / 100);
  const high = target * (1 + tolerance / 100);
  const rangeMin = Math.min(actual[0], low) - 5;
  const rangeMax = Math.max(actual[1], high) + 5;
  const span = rangeMax - rangeMin || 1;

  const targetPct = ((target - rangeMin) / span) * 100;
  const lowPct = ((low - rangeMin) / span) * 100;
  const highPct = ((high - rangeMin) / span) * 100;
  const actLowPct = ((actual[0] - rangeMin) / span) * 100;
  const actHighPct = ((actual[1] - rangeMin) / span) * 100;

  const inSpec = actual[0] >= low && actual[1] <= high;

  return (
    <div className="relative h-4 bg-gray-800 rounded-full overflow-hidden">
      {/* Target zone */}
      <div
        className="absolute top-0 h-full bg-emerald-900/40"
        style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }}
      />
      {/* Actual range */}
      <div
        className={`absolute top-1 h-2 rounded-full ${inSpec ? 'bg-emerald-500' : 'bg-red-500'}`}
        style={{
          left: `${actLowPct}%`,
          width: `${Math.max(actHighPct - actLowPct, 1)}%`,
        }}
      />
      {/* Target line */}
      <div
        className="absolute top-0 h-full w-0.5 bg-yellow-400"
        style={{ left: `${targetPct}%` }}
      />
    </div>
  );
}

function PDNPlot({ data }: { data: ImpedancePlotPoint[] }) {
  if (data.length === 0) return null;

  const width = 320;
  const height = 120;
  const padX = 40;
  const padY = 16;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const freqRange = [
    Math.log10(data[0].frequencyHz),
    Math.log10(data[data.length - 1].frequencyHz),
  ];
  const maxZ = Math.max(...data.map((d) => d.impedanceOhms), data[0].targetZOhms * 2);
  const minZ = Math.min(...data.map((d) => d.impedanceOhms)) * 0.5;
  const zRange = [Math.log10(Math.max(minZ, 1e-6)), Math.log10(maxZ)];

  const toX = (f: number) => padX + ((Math.log10(f) - freqRange[0]) / (freqRange[1] - freqRange[0])) * plotW;
  const toY = (z: number) =>
    padY + plotH - ((Math.log10(Math.max(z, 1e-6)) - zRange[0]) / (zRange[1] - zRange[0])) * plotH;

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(d.frequencyHz).toFixed(1)},${toY(d.impedanceOhms).toFixed(1)}`)
    .join(' ');

  const targetY = toY(data[0].targetZOhms);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: 140 }}>
      {/* Grid */}
      <rect x={padX} y={padY} width={plotW} height={plotH} fill="none" stroke="#333" strokeWidth={0.5} />
      {/* Target impedance line */}
      <line
        x1={padX}
        y1={targetY}
        x2={padX + plotW}
        y2={targetY}
        stroke="#fbbf24"
        strokeWidth={1}
        strokeDasharray="4,3"
      />
      <text x={padX + plotW + 2} y={targetY + 3} fill="#fbbf24" fontSize={7}>
        Z_target
      </text>
      {/* Impedance curve */}
      <path d={pathD} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
      {/* Violation regions */}
      {data.map((d, i) =>
        !d.withinTarget ? (
          <circle
            key={i}
            cx={toX(d.frequencyHz)}
            cy={toY(d.impedanceOhms)}
            r={1.5}
            fill="#ef4444"
            opacity={0.7}
          />
        ) : null,
      )}
      {/* Axis labels */}
      <text x={width / 2} y={height - 1} fill="#888" fontSize={7} textAnchor="middle">
        Frequency
      </text>
      <text x={4} y={height / 2} fill="#888" fontSize={7} textAnchor="middle" transform={`rotate(-90, 4, ${height / 2})`}>
        |Z| (ohm)
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function SIPIPanel() {
  const [analysisState, setAnalysisState] = useState<SIPIAnalysisState>({
    impedance: null,
    crosstalk: null,
    returnPath: null,
    pdn: null,
  });
  const [siLoading, setSiLoading] = useState(false);
  const [piLoading, setPiLoading] = useState(false);
  const [crosstalkOverlay, setCrosstalkOverlay] = useState(false);

  const runSIAnalysis = useCallback(async () => {
    setSiLoading(true);
    try {
      // In production, this would call the backend API
      const res = await fetch('/api/analysis/si', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAnalysisState((prev) => ({
          ...prev,
          impedance: data.impedance ?? null,
          crosstalk: data.crosstalk ?? null,
          returnPath: data.returnPath ?? null,
        }));
      }
    } catch {
      // Silently handle -- in dev, the API may not be running
    } finally {
      setSiLoading(false);
    }
  }, []);

  const runPIAnalysis = useCallback(async () => {
    setPiLoading(true);
    try {
      const res = await fetch('/api/analysis/pi', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAnalysisState((prev) => ({
          ...prev,
          pdn: data.pdn ?? null,
        }));
      }
    } catch {
      // Silently handle
    } finally {
      setPiLoading(false);
    }
  }, []);

  const { impedance, crosstalk, returnPath, pdn } = analysisState;
  const hasResults = impedance || crosstalk || returnPath || pdn;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with action buttons */}
      <div className="p-3 border-b border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-semibold text-gray-200">SI / PI Analysis</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runSIAnalysis}
            disabled={siLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
          >
            {siLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Waves className="w-3 h-3" />}
            Run SI Analysis
          </button>
          <button
            onClick={runPIAnalysis}
            disabled={piLoading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
          >
            {piLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Battery className="w-3 h-3" />}
            Run PI Analysis
          </button>
        </div>
        {/* Overlay toggle */}
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={crosstalkOverlay}
            onChange={(e) => setCrosstalkOverlay(e.target.checked)}
            className="rounded bg-gray-700 border-gray-600 text-brand-500 focus:ring-brand-500"
          />
          Show crosstalk heatmap overlay
        </label>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {!hasResults && !siLoading && !piLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            <Zap className="w-10 h-10 text-gray-700" />
            <p className="text-sm text-gray-400">No analysis results yet.</p>
            <p className="text-xs text-gray-600">
              Run SI or PI analysis to check signal and power integrity.
            </p>
          </div>
        )}

        {(siLoading || piLoading) && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            <p className="text-sm text-gray-400">
              Running {siLoading ? 'signal integrity' : 'power integrity'} analysis...
            </p>
          </div>
        )}

        {/* Impedance Analysis */}
        {impedance && (
          <CollapsibleSection
            title={`Impedance (${impedance.totalNetsAnalyzed} nets)`}
            icon={TrendingUp}
            passed={impedance.overallPass}
            defaultOpen
          >
            <p className="text-xs text-gray-400 mb-3">{impedance.summary}</p>

            {/* Per-net impedance chart */}
            <div className="space-y-2">
              {impedance.perNetResults.slice(0, 20).map((net) => (
                <div key={net.netName} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-300 font-mono truncate max-w-[140px]">
                      {net.netName}
                    </span>
                    <span className={`text-[10px] font-medium ${net.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                      {net.actualZ0Range[0].toFixed(1)}-{net.actualZ0Range[1].toFixed(1)} ohm
                      {' / '}target {net.targetZ0.toFixed(0)} ohm
                    </span>
                  </div>
                  <ImpedanceBar actual={net.actualZ0Range} target={net.targetZ0} />
                  {net.segmentsWithIssues.length > 0 && (
                    <div className="pl-2 space-y-0.5">
                      {net.segmentsWithIssues.slice(0, 3).map((issue, i) => (
                        <div key={i} className="flex items-start gap-1 text-[10px] text-red-400/80">
                          <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                          <span>{issue.description}</span>
                        </div>
                      ))}
                      {net.segmentsWithIssues.length > 3 && (
                        <span className="text-[10px] text-gray-600">
                          +{net.segmentsWithIssues.length - 3} more issues
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Crosstalk Analysis */}
        {crosstalk && (
          <CollapsibleSection
            title={`Crosstalk (${crosstalk.totalViolations} violations)`}
            icon={Waves}
            passed={crosstalk.overallPass}
          >
            <p className="text-xs text-gray-400 mb-3">{crosstalk.summary}</p>

            <div className="space-y-2">
              {crosstalk.couplingPairs
                .filter((p) => !p.passed)
                .slice(0, 15)
                .map((pair, i) => (
                  <div key={i} className="bg-gray-800/50 rounded p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300">
                        {pair.aggressorNet} / {pair.victimNet}
                      </span>
                      <span className="text-[10px] font-mono text-red-400">
                        {pair.worstDb.toFixed(1)} dB
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {pair.layer} &middot; {pair.parallelLengthMm.toFixed(1)}mm parallel &middot;{' '}
                      {pair.separationMm.toFixed(2)}mm gap
                    </div>
                    <div className="text-[10px] text-gray-500">
                      NEXT: {pair.nextDb.toFixed(1)}dB &middot; FEXT: {pair.fextDb.toFixed(1)}dB
                    </div>
                    {pair.mitigations.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {pair.mitigations.map((m, j) => (
                          <div key={j} className="text-[10px] text-blue-400/80">
                            Fix: {m.description} (~{m.estimatedImprovementDb.toFixed(0)}dB improvement)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Return Path Analysis */}
        {returnPath && (
          <CollapsibleSection
            title={`Return Path (${returnPath.planeDiscontinuities.length + returnPath.viaTransitionIssues.length} issues)`}
            icon={GitBranch}
            passed={returnPath.overallPass}
          >
            <p className="text-xs text-gray-400 mb-3">{returnPath.summary}</p>

            {returnPath.planeDiscontinuities.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Plane Discontinuities</p>
                <div className="space-y-1">
                  {returnPath.planeDiscontinuities.slice(0, 10).map((d, i) => (
                    <div
                      key={i}
                      className={`text-[10px] px-2 py-1 rounded ${
                        d.severity === 'error'
                          ? 'bg-red-900/30 text-red-400'
                          : 'bg-yellow-900/30 text-yellow-400'
                      }`}
                    >
                      [{d.type}] {d.description}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {returnPath.stitchingSuggestions.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Stitching Via Suggestions ({returnPath.stitchingSuggestions.length})
                </p>
                <div className="space-y-1">
                  {returnPath.stitchingSuggestions.slice(0, 8).map((s, i) => (
                    <div key={i} className="text-[10px] text-blue-400/80 bg-blue-900/20 px-2 py-1 rounded">
                      [{s.priority}] {s.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* PDN Impedance Analysis */}
        {pdn && (
          <CollapsibleSection
            title={`PDN Impedance (${pdn.targetImpedances.length} rails)`}
            icon={Battery}
            passed={pdn.overallPass}
            defaultOpen
          >
            <p className="text-xs text-gray-400 mb-3">{pdn.summary}</p>

            {/* Target impedance summary */}
            <div className="mb-3 space-y-1">
              {pdn.targetImpedances.map((ti, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 font-mono">{ti.railName}</span>
                  <span className="text-gray-500">
                    {ti.voltage}V / {ti.maxCurrent}A &rarr; Z_target = {ti.targetZOhms.toFixed(3)} ohm
                  </span>
                </div>
              ))}
            </div>

            {/* Impedance vs frequency plot */}
            {pdn.impedancePlot.length > 0 && (
              <div className="bg-gray-900 rounded p-2 mb-3">
                <p className="text-[10px] text-gray-500 mb-1">PDN Impedance vs Frequency</p>
                <PDNPlot data={pdn.impedancePlot} />
              </div>
            )}

            {/* Decap suggestions */}
            {pdn.decapSuggestions.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Decoupling Suggestions
                </p>
                <div className="space-y-1">
                  {pdn.decapSuggestions.map((s, i) => (
                    <div key={i} className="bg-gray-800/50 rounded px-2 py-1.5 text-[10px]">
                      <span className="text-gray-300 font-medium">
                        {s.quantity}x {formatCapacitance(s.capacitance)} ({s.package})
                      </span>
                      <div className="text-gray-500 mt-0.5">{s.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Plane capacitance */}
            <div className="mt-2 text-[10px] text-gray-500">
              Interplane capacitance: {pdn.planeCapacitancePf.toFixed(1)} pF
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
