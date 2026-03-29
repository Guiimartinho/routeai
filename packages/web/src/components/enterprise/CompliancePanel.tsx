import { useState, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileDown,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Info,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckResult = 'pass' | 'fail' | 'na' | 'warning';

interface ComplianceCheck {
  clauseRef: string;
  description: string;
  result: CheckResult;
  measuredValue?: string;
  requiredValue?: string;
  details?: string;
}

interface ComplianceReport {
  standard: string;
  classLevel: number;
  passed: boolean;
  checks: ComplianceCheck[];
  summary: string;
  passCount: number;
  failCount: number;
  warningCount: number;
  naCount: number;
}

interface IPCStandard {
  id: string;
  name: string;
  fullName: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IPC_STANDARDS: IPCStandard[] = [
  {
    id: 'ipc-2221b',
    name: 'IPC-2221B',
    fullName: 'Generic Standard on Printed Board Design',
    description: 'Conductor width, spacing, annular ring, edge clearance',
  },
  {
    id: 'ipc-6012',
    name: 'IPC-6012',
    fullName: 'Rigid Board Qualification and Performance',
    description: 'Plating thickness, hole quality, board thickness, bow/twist',
  },
  {
    id: 'ipc-a610',
    name: 'IPC-A-610',
    fullName: 'Acceptability of Electronic Assemblies',
    description: 'Pad design, solder joints, component spacing, testability',
  },
];

const CLASS_LEVELS = [
  { value: 1, label: 'Class 1', description: 'General Electronic Products' },
  { value: 2, label: 'Class 2', description: 'Dedicated Service Electronic Products' },
  { value: 3, label: 'Class 3', description: 'High Reliability Electronic Products' },
];

const RESULT_STYLES: Record<CheckResult, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  pass: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-900/20', label: 'PASS' },
  fail: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-900/20', label: 'FAIL' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-900/20', label: 'WARN' },
  na: { icon: Info, color: 'text-gray-500', bg: 'bg-gray-800/50', label: 'N/A' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: CheckResult }) {
  const style = RESULT_STYLES[result];
  const Icon = style.icon;

  return (
    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${style.bg}`}>
      <Icon className={`w-3 h-3 ${style.color}`} />
      <span className={`text-[10px] font-semibold ${style.color}`}>{style.label}</span>
    </div>
  );
}

function ComplianceCheckRow({ check, expanded, onToggle }: {
  check: ComplianceCheck;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = check.details || check.measuredValue || check.requiredValue;

  return (
    <div className={`border-b border-gray-800/50 ${check.result === 'fail' ? 'bg-red-900/5' : ''}`}>
      <button
        onClick={onToggle}
        disabled={!hasDetails}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/30 transition-colors disabled:cursor-default"
      >
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-gray-600 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
          )
        ) : (
          <div className="w-3" />
        )}
        <span className="text-[10px] text-gray-500 font-mono w-[100px] shrink-0">{check.clauseRef}</span>
        <span className="text-xs text-gray-300 flex-1 truncate">{check.description}</span>
        <ResultBadge result={check.result} />
      </button>
      {expanded && hasDetails && (
        <div className="px-3 pb-2 pl-8 space-y-1">
          {check.measuredValue && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-500 w-16">Measured:</span>
              <span className="text-gray-300 font-mono">{check.measuredValue}</span>
            </div>
          )}
          {check.requiredValue && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-500 w-16">Required:</span>
              <span className="text-gray-300 font-mono">{check.requiredValue}</span>
            </div>
          )}
          {check.details && (
            <p className="text-[10px] text-gray-500 mt-1">{check.details}</p>
          )}
        </div>
      )}
    </div>
  );
}

function StandardReport({
  report,
  defaultOpen = false,
}: {
  report: ComplianceReport;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedChecks, setExpandedChecks] = useState<Set<number>>(new Set());

  const toggleCheck = (idx: number) => {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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
        <Shield className={`w-4 h-4 shrink-0 ${report.passed ? 'text-emerald-400' : 'text-red-400'}`} />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-200">
            {report.standard} (Class {report.classLevel})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500">
            {report.passCount}P / {report.failCount}F / {report.warningCount}W
          </span>
          {report.passed ? (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-900/30 text-emerald-400 rounded">PASS</span>
          ) : (
            <span className="px-2 py-0.5 text-[10px] font-bold bg-red-900/30 text-red-400 rounded">FAIL</span>
          )}
        </div>
      </button>

      {open && (
        <div>
          {/* Summary */}
          <div className="px-3 py-2 border-t border-gray-800 bg-gray-900/30">
            <p className="text-xs text-gray-400">{report.summary}</p>
            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1 text-[10px]">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">{report.passCount}</span>
                <span className="text-gray-500">passed</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <XCircle className="w-3 h-3 text-red-400" />
                <span className="text-red-400 font-semibold">{report.failCount}</span>
                <span className="text-gray-500">failed</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <AlertTriangle className="w-3 h-3 text-yellow-400" />
                <span className="text-yellow-400 font-semibold">{report.warningCount}</span>
                <span className="text-gray-500">warnings</span>
              </div>
              <div className="flex items-center gap-1 text-[10px]">
                <Info className="w-3 h-3 text-gray-500" />
                <span className="text-gray-500 font-semibold">{report.naCount}</span>
                <span className="text-gray-600">n/a</span>
              </div>
            </div>
          </div>

          {/* Checks */}
          <div className="border-t border-gray-800">
            {report.checks.map((check, i) => (
              <ComplianceCheckRow
                key={i}
                check={check}
                expanded={expandedChecks.has(i)}
                onToggle={() => toggleCheck(i)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function CompliancePanel() {
  const [selectedStandards, setSelectedStandards] = useState<Set<string>>(
    new Set(['ipc-2221b', 'ipc-6012']),
  );
  const [classLevel, setClassLevel] = useState(2);
  const [reports, setReports] = useState<ComplianceReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const toggleStandard = (id: string) => {
    setSelectedStandards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standards: Array.from(selectedStandards),
          classLevel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports ?? []);
      }
    } catch {
      // API may not be running
    } finally {
      setLoading(false);
    }
  }, [selectedStandards, classLevel]);

  const exportReport = useCallback(async () => {
    setExportLoading(true);
    try {
      const res = await fetch('/api/compliance/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standards: Array.from(selectedStandards),
          classLevel,
          format: 'pdf',
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `compliance_report_class${classLevel}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Handle error
    } finally {
      setExportLoading(false);
    }
  }, [selectedStandards, classLevel]);

  const overallPassed = reports.length > 0 && reports.every((r) => r.passed);
  const totalFails = reports.reduce((sum, r) => sum + r.failCount, 0);
  const totalPasses = reports.reduce((sum, r) => sum + r.passCount, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-semibold text-gray-200">IPC Compliance</span>
        </div>

        {/* Standard selection */}
        <div className="space-y-1.5 mb-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Standards</p>
          {IPC_STANDARDS.map((std) => {
            const selected = selectedStandards.has(std.id);
            return (
              <label
                key={std.id}
                className={`flex items-start gap-2 px-2.5 py-2 rounded border cursor-pointer transition-colors ${
                  selected
                    ? 'border-brand-500/30 bg-brand-500/5'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleStandard(std.id)}
                  className="mt-0.5 rounded bg-gray-700 border-gray-600 text-brand-500 focus:ring-brand-500"
                />
                <div>
                  <div className={`text-xs font-medium ${selected ? 'text-gray-200' : 'text-gray-400'}`}>
                    {std.name}
                  </div>
                  <div className="text-[10px] text-gray-600">{std.fullName}</div>
                  <div className="text-[10px] text-gray-600">{std.description}</div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Class level selector */}
        <div className="mb-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Class Level</p>
          <div className="flex gap-1">
            {CLASS_LEVELS.map((cl) => (
              <button
                key={cl.value}
                onClick={() => setClassLevel(cl.value)}
                className={`flex-1 px-2 py-1.5 rounded border text-center transition-colors ${
                  classLevel === cl.value
                    ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                    : 'border-gray-800 text-gray-500 hover:border-gray-700'
                }`}
              >
                <div className="text-xs font-medium">{cl.label}</div>
                <div className="text-[9px] text-gray-600">{cl.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={runCheck}
          disabled={loading || selectedStandards.size === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ClipboardCheck className="w-4 h-4" />
          )}
          Run Compliance Check
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {reports.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
            <Shield className="w-10 h-10 text-gray-700" />
            <p className="text-sm text-gray-400">No compliance results yet.</p>
            <p className="text-xs text-gray-600">
              Select IPC standards and class level, then run the compliance check.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
            <p className="text-sm text-gray-400">Checking compliance...</p>
          </div>
        )}

        {/* Overall summary */}
        {reports.length > 0 && (
          <div className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
            {overallPassed ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-8 h-8 text-red-400 shrink-0" />
            )}
            <div>
              <div className={`text-lg font-bold ${overallPassed ? 'text-emerald-400' : 'text-red-400'}`}>
                {overallPassed ? 'COMPLIANT' : 'NON-COMPLIANT'}
              </div>
              <p className="text-xs text-gray-400">
                {totalPasses} checks passed, {totalFails} failed across {reports.length} standard(s) at Class {classLevel}
              </p>
            </div>
          </div>
        )}

        {/* Per-standard results */}
        {reports.map((report, i) => (
          <StandardReport key={i} report={report} defaultOpen={i === 0} />
        ))}
      </div>

      {/* Footer */}
      {reports.length > 0 && (
        <div className="p-3 border-t border-gray-800 shrink-0">
          <button
            onClick={exportReport}
            disabled={exportLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            {exportLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4" />
            )}
            Export Compliance Report (PDF)
          </button>
        </div>
      )}
    </div>
  );
}
