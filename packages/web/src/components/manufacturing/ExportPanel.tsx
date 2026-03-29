import { useState, useCallback } from 'react';
import {
  Download,
  FileArchive,
  FileText,
  Settings,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Package,
  Cpu,
  Layers,
  HardDrive,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = 'gerber' | 'excellon' | 'bom_csv' | 'bom_json' | 'pick_and_place' | 'ipc2581';

interface FabProfileOption {
  id: string;
  name: string;
  description: string;
  orderUrl: string;
}

interface DFMIssue {
  severity: 'error' | 'warning' | 'info';
  category: string;
  description: string;
  location?: [number, number];
  measuredValue?: number;
  requiredValue?: number;
  suggestion: string;
}

interface DFMReport {
  fabProfile: string;
  issues: DFMIssue[];
  score: number;
  fabCompatible: boolean;
  summary: string;
  errorCount: number;
  warningCount: number;
}

interface BOMEntry {
  references: string;
  value: string;
  footprint: string;
  quantity: number;
  mpn: string;
  supplier: string;
  supplierPn: string;
  unitPrice: number;
  totalPrice: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAB_PROFILES: FabProfileOption[] = [
  {
    id: 'jlcpcb',
    name: 'JLCPCB',
    description: 'Low-cost prototyping, 1-32 layers, fast turnaround',
    orderUrl: 'https://cart.jlcpcb.com/quote',
  },
  {
    id: 'pcbway',
    name: 'PCBWay',
    description: 'Advanced capabilities, flex-rigid, HDI',
    orderUrl: 'https://www.pcbway.com/orderonline.aspx',
  },
  {
    id: 'osh_park',
    name: 'OSH Park',
    description: 'Purple boards, ENIG finish, 2-4 layers',
    orderUrl: 'https://oshpark.com/',
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Define your own fab capabilities',
    orderUrl: '',
  },
];

const EXPORT_FORMATS: { id: ExportFormat; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { id: 'gerber', label: 'Gerber RS-274X', icon: Layers, description: 'Copper, mask, silk, paste, edge' },
  { id: 'excellon', label: 'Excellon Drill', icon: HardDrive, description: 'PTH and NPTH drill files' },
  { id: 'bom_csv', label: 'BOM (CSV)', icon: FileText, description: 'Grouped bill of materials' },
  { id: 'bom_json', label: 'BOM (JSON)', icon: FileText, description: 'Machine-readable BOM' },
  { id: 'pick_and_place', label: 'Pick & Place', icon: Cpu, description: 'Component placement CSV' },
  { id: 'ipc2581', label: 'IPC-2581', icon: Package, description: 'Complete board interchange' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : score >= 40 ? 'text-orange-400' : 'text-red-400';
  const bg =
    score >= 80 ? 'bg-emerald-900/30' : score >= 60 ? 'bg-yellow-900/30' : score >= 40 ? 'bg-orange-900/30' : 'bg-red-900/30';

  return (
    <div className={`${bg} rounded-lg px-3 py-2 text-center`}>
      <div className={`text-2xl font-bold ${color}`}>{score.toFixed(0)}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">DFM Score</div>
    </div>
  );
}

function DFMIssueCard({ issue }: { issue: DFMIssue }) {
  const severityColors = {
    error: 'border-red-800 bg-red-900/20',
    warning: 'border-yellow-800 bg-yellow-900/20',
    info: 'border-blue-800 bg-blue-900/20',
  };
  const severityText = {
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };
  const Icon = issue.severity === 'error' ? XCircle : issue.severity === 'warning' ? AlertTriangle : CheckCircle2;

  return (
    <div className={`border rounded p-2 ${severityColors[issue.severity]}`}>
      <div className="flex items-start gap-1.5">
        <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${severityText[issue.severity]}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-gray-500 uppercase">{issue.category}</div>
          <div className="text-xs text-gray-300">{issue.description}</div>
          {issue.suggestion && (
            <div className="text-[10px] text-blue-400/80 mt-1">Fix: {issue.suggestion}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BOMViewer({ entries }: { entries: BOMEntry[] }) {
  const total = entries.reduce((sum, e) => sum + e.totalPrice, 0);

  return (
    <div className="border border-gray-800 rounded overflow-hidden">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-gray-900">
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Ref</th>
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Value</th>
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Package</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-medium">Qty</th>
            <th className="px-2 py-1.5 text-left text-gray-500 font-medium">MPN</th>
            <th className="px-2 py-1.5 text-right text-gray-500 font-medium">Price</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 50).map((e, i) => (
            <tr key={i} className="border-t border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-2 py-1 text-gray-300 font-mono">{e.references}</td>
              <td className="px-2 py-1 text-gray-400">{e.value}</td>
              <td className="px-2 py-1 text-gray-500">{e.footprint}</td>
              <td className="px-2 py-1 text-right text-gray-400">{e.quantity}</td>
              <td className="px-2 py-1 text-gray-500">
                {e.supplier && e.supplierPn ? (
                  <a
                    href={`https://www.digikey.com/products/en?keywords=${encodeURIComponent(e.mpn || e.supplierPn)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-400 hover:underline"
                  >
                    {e.mpn || e.supplierPn}
                  </a>
                ) : (
                  <span>{e.mpn || '-'}</span>
                )}
              </td>
              <td className="px-2 py-1 text-right text-gray-400">
                {e.unitPrice > 0 ? `$${e.totalPrice.toFixed(2)}` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-700 bg-gray-900/50">
            <td colSpan={5} className="px-2 py-1.5 text-right text-gray-400 font-medium">
              Total:
            </td>
            <td className="px-2 py-1.5 text-right text-gray-200 font-bold">${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function ExportPanel() {
  const [selectedFormats, setSelectedFormats] = useState<Set<ExportFormat>>(
    new Set(['gerber', 'excellon', 'bom_csv', 'pick_and_place']),
  );
  const [selectedFab, setSelectedFab] = useState<string>('jlcpcb');
  const [dfmReport, setDfmReport] = useState<DFMReport | null>(null);
  const [dfmLoading, setDfmLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [bomEntries, setBomEntries] = useState<BOMEntry[]>([]);
  const [showBom, setShowBom] = useState(false);
  const [showDfmDetails, setShowDfmDetails] = useState(false);

  const toggleFormat = (fmt: ExportFormat) => {
    const next = new Set(selectedFormats);
    if (next.has(fmt)) next.delete(fmt);
    else next.add(fmt);
    setSelectedFormats(next);
  };

  const runDFM = useCallback(async () => {
    setDfmLoading(true);
    try {
      const res = await fetch('/api/manufacturing/dfm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fabProfile: selectedFab }),
      });
      if (res.ok) {
        const data = await res.json();
        setDfmReport(data);
      }
    } catch {
      // API may not be running in dev
    } finally {
      setDfmLoading(false);
    }
  }, [selectedFab]);

  const handleExportAll = useCallback(async () => {
    setExportLoading(true);
    try {
      const res = await fetch('/api/manufacturing/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formats: Array.from(selectedFormats),
          fabProfile: selectedFab,
        }),
      });
      if (res.ok) {
        // Trigger download of zip file
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pcb_manufacturing_files.zip`;
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
  }, [selectedFormats, selectedFab]);

  const handleOrderPCB = useCallback(() => {
    const profile = FAB_PROFILES.find((p) => p.id === selectedFab);
    if (profile?.orderUrl) {
      window.open(profile.orderUrl, '_blank', 'noopener,noreferrer');
    }
  }, [selectedFab]);

  const fabProfile = FAB_PROFILES.find((p) => p.id === selectedFab);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-brand-400" />
          <span className="text-sm font-semibold text-gray-200">Manufacturing Export</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Fab Profile Selector */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Fabrication House</p>
          <div className="grid grid-cols-2 gap-1.5">
            {FAB_PROFILES.map((fp) => (
              <button
                key={fp.id}
                onClick={() => setSelectedFab(fp.id)}
                className={`text-left px-2.5 py-2 rounded border transition-colors ${
                  selectedFab === fp.id
                    ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                    : 'border-gray-800 bg-gray-900/50 text-gray-400 hover:border-gray-700'
                }`}
              >
                <div className="text-xs font-medium">{fp.name}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">{fp.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* DFM Analysis */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">DFM Analysis</p>
            <button
              onClick={runDFM}
              disabled={dfmLoading}
              className="flex items-center gap-1 px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded transition-colors disabled:opacity-50"
            >
              {dfmLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
              Check DFM
            </button>
          </div>

          {dfmReport && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <ScoreBadge score={dfmReport.score} />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    {dfmReport.fabCompatible ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-medium text-emerald-400">Compatible</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-red-400" />
                        <span className="text-sm font-medium text-red-400">Not Compatible</span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {dfmReport.errorCount} errors, {dfmReport.warningCount} warnings for {dfmReport.fabProfile}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowDfmDetails(!showDfmDetails)}
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showDfmDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {showDfmDetails ? 'Hide' : 'Show'} details ({dfmReport.issues.length} issues)
              </button>

              {showDfmDetails && (
                <div className="space-y-1.5 max-h-60 overflow-auto">
                  {dfmReport.issues.map((issue, i) => (
                    <DFMIssueCard key={i} issue={issue} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Export Format Selection */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Export Formats</p>
          <div className="space-y-1">
            {EXPORT_FORMATS.map((fmt) => {
              const Icon = fmt.icon;
              const selected = selectedFormats.has(fmt.id);
              return (
                <label
                  key={fmt.id}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded border cursor-pointer transition-colors ${
                    selected
                      ? 'border-brand-500/30 bg-brand-500/5'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleFormat(fmt.id)}
                    className="rounded bg-gray-700 border-gray-600 text-brand-500 focus:ring-brand-500"
                  />
                  <Icon className={`w-3.5 h-3.5 ${selected ? 'text-brand-400' : 'text-gray-600'}`} />
                  <div className="flex-1">
                    <div className={`text-xs ${selected ? 'text-gray-200' : 'text-gray-400'}`}>{fmt.label}</div>
                    <div className="text-[10px] text-gray-600">{fmt.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* BOM Viewer */}
        {bomEntries.length > 0 && (
          <div>
            <button
              onClick={() => setShowBom(!showBom)}
              className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors mb-1.5"
            >
              {showBom ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              BOM Preview ({bomEntries.length} line items)
            </button>
            {showBom && <BOMViewer entries={bomEntries} />}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-gray-800 shrink-0 space-y-2">
        <button
          onClick={handleExportAll}
          disabled={exportLoading || selectedFormats.size === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded transition-colors"
        >
          {exportLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileArchive className="w-4 h-4" />
          )}
          Export All ({selectedFormats.size} formats)
        </button>

        {fabProfile && fabProfile.orderUrl && (
          <button
            onClick={handleOrderPCB}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Order PCB from {fabProfile.name}
          </button>
        )}
      </div>
    </div>
  );
}
