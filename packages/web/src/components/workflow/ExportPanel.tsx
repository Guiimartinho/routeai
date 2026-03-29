/**
 * ExportPanel - Export project in multiple formats.
 *
 * Provides download buttons for KiCad, Eagle, Gerber, ODB++, BOM,
 * Pick & Place, and STEP formats with progress indicators.
 */

import { useState, useCallback } from 'react';
import {
  Download,
  FileText,
  Cpu,
  Layers,
  Box,
  Table2,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FolderArchive,
} from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import * as workflowApi from '../../api/workflow';
import { EXPORT_FORMATS, type ExportFormat, type ExportFormatInfo } from '../../api/workflow';

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const FORMAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  kicad: FileText,
  eagle: FileText,
  gerber: Layers,
  odb: FolderArchive,
  bom: Table2,
  pnp: MapPin,
  step: Box,
};

const CATEGORY_LABELS: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  design: { label: 'Design Files', icon: FileText },
  manufacturing: { label: 'Manufacturing', icon: Cpu },
  data: { label: 'Data Exports', icon: Table2 },
  '3d': { label: '3D Models', icon: Box },
};

// ---------------------------------------------------------------------------
// Individual export card
// ---------------------------------------------------------------------------

type ExportState = 'idle' | 'downloading' | 'success' | 'error';

interface ExportCardProps {
  format: ExportFormatInfo;
  projectId: string;
  projectName: string;
}

function ExportCard({ format, projectId, projectName }: ExportCardProps) {
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const Icon = FORMAT_ICONS[format.id] || FileText;

  const handleDownload = useCallback(async () => {
    setState('downloading');
    setError(null);

    try {
      const blob = await workflowApi.exportProject(projectId, format.id);

      // Determine filename
      const ext = format.extension.includes('zip') ? '.zip' : format.extension.split('+')[0].trim();
      const filename = `${projectName}-${format.id}${ext}`;

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState('success');
      setTimeout(() => setState('idle'), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      setError(msg);
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  }, [projectId, projectName, format]);

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-900/60 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors group">
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-gray-800 flex items-center justify-center shrink-0 group-hover:bg-gray-700 transition-colors">
        <Icon className="w-4 h-4 text-gray-400" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-200">{format.name}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
            {format.extension}
          </span>
        </div>
        <p className="text-[10px] text-gray-500 mt-0.5 truncate">{format.description}</p>
        {error && (
          <p className="text-[10px] text-red-400 mt-0.5 flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5" />
            {error}
          </p>
        )}
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        disabled={state === 'downloading'}
        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
          state === 'success'
            ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
            : state === 'error'
            ? 'bg-red-600/20 text-red-400 border border-red-600/30'
            : state === 'downloading'
            ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
            : 'bg-brand-600 text-white hover:bg-brand-500'
        }`}
      >
        {state === 'downloading' ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            Exporting...
          </>
        ) : state === 'success' ? (
          <>
            <CheckCircle2 className="w-3 h-3" />
            Done
          </>
        ) : state === 'error' ? (
          <>
            <AlertCircle className="w-3 h-3" />
            Retry
          </>
        ) : (
          <>
            <Download className="w-3 h-3" />
            Download
          </>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ExportPanel component
// ---------------------------------------------------------------------------

export default function ExportPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const advanceStage = useWorkflowStore((s) => s.advanceStage);
  const [downloadAllState, setDownloadAllState] = useState<'idle' | 'downloading' | 'done'>('idle');

  const projectId = currentProject?.id ?? '';
  const projectName = currentProject?.name ?? 'project';

  // Group formats by category
  const grouped = EXPORT_FORMATS.reduce<Record<string, ExportFormatInfo[]>>((acc, fmt) => {
    if (!acc[fmt.category]) acc[fmt.category] = [];
    acc[fmt.category].push(fmt);
    return acc;
  }, {});

  const handleDownloadAll = useCallback(async () => {
    if (!projectId) return;
    setDownloadAllState('downloading');

    const formats: ExportFormat[] = ['gerber', 'bom', 'pnp'];
    for (const fmt of formats) {
      try {
        const blob = await workflowApi.exportProject(projectId, fmt);
        const info = EXPORT_FORMATS.find((f) => f.id === fmt);
        const ext = info?.extension.includes('zip') ? '.zip' : (info?.extension.split('+')[0].trim() ?? '');
        const filename = `${projectName}-${fmt}${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        // Continue with remaining downloads
      }
    }

    setDownloadAllState('done');
    setTimeout(() => setDownloadAllState('idle'), 3000);
  }, [projectId, projectName]);

  if (!currentProject) {
    return (
      <div className="p-4 text-sm text-gray-500 text-center">
        No project loaded.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-200">Export Project</h3>
          <button
            onClick={handleDownloadAll}
            disabled={downloadAllState === 'downloading'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-brand-600 text-white hover:bg-brand-500 disabled:bg-gray-800 disabled:text-gray-500 transition-colors"
          >
            {downloadAllState === 'downloading' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Exporting...
              </>
            ) : downloadAllState === 'done' ? (
              <>
                <CheckCircle2 className="w-3 h-3" />
                Done
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                Manufacturing Pack
              </>
            )}
          </button>
        </div>
        <p className="text-[11px] text-gray-500">
          Export your design in industry-standard formats for fabrication, assembly, and collaboration.
        </p>
      </div>

      {/* Format groups */}
      <div className="flex-1 overflow-auto p-4 space-y-5">
        {Object.entries(grouped).map(([category, formats]) => {
          const catInfo = CATEGORY_LABELS[category];
          const CatIcon = catInfo?.icon || FileText;

          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <CatIcon className="w-3.5 h-3.5 text-gray-500" />
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {catInfo?.label || category}
                </h4>
              </div>
              <div className="space-y-2">
                {formats.map((fmt) => (
                  <ExportCard
                    key={fmt.id}
                    format={fmt}
                    projectId={projectId}
                    projectName={projectName}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer action */}
      <div className="shrink-0 p-3 border-t border-gray-800">
        <button
          onClick={advanceStage}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
        >
          Continue to Placement
        </button>
      </div>
    </div>
  );
}
