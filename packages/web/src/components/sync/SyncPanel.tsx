import { useState, useCallback, useMemo } from 'react';
import {
  ArrowRightLeft,
  ArrowRight,
  ArrowLeft,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Crosshair,
  GitCompare,
  Loader2,
  Plus,
  Minus,
  Pencil,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncChange {
  change_type: string;
  component_ref: string;
  net_name: string;
  old_value: string | null;
  new_value: string | null;
  details: Record<string, unknown>;
  confidence: number;
}

interface DiffEntry {
  type: 'net' | 'component';
  id: string;
  label: string;
  color: string;
  status: 'added' | 'removed' | 'modified';
  detail: string;
  pins?: string[];
  added_pins?: string[];
  removed_pins?: string[];
  changed_fields?: string[];
}

interface SyncConflict {
  id: string;
  element_type: string;
  element_id: string;
  schematic_value: string;
  layout_value: string;
  resolution: 'schematic' | 'layout' | null;
}

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'conflicts';

// ---------------------------------------------------------------------------
// Status Indicator
// ---------------------------------------------------------------------------

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const config: Record<SyncStatus, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
    idle: {
      bg: 'bg-gray-800',
      text: 'text-gray-400',
      label: 'Not synced',
      icon: <ArrowRightLeft className="w-3 h-3" />,
    },
    syncing: {
      bg: 'bg-blue-900/30',
      text: 'text-blue-400',
      label: 'Syncing...',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    synced: {
      bg: 'bg-emerald-900/30',
      text: 'text-emerald-400',
      label: 'In sync',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    error: {
      bg: 'bg-red-900/30',
      text: 'text-red-400',
      label: 'Sync error',
      icon: <XCircle className="w-3 h-3" />,
    },
    conflicts: {
      bg: 'bg-yellow-900/30',
      text: 'text-yellow-400',
      label: 'Conflicts',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
  };

  const c = config[status];

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.icon}
      {c.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff Entry Component
// ---------------------------------------------------------------------------

function DiffEntryRow({
  entry,
  onCrossProbe,
}: {
  entry: DiffEntry;
  onCrossProbe: (type: string, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(
    entry.detail ||
    (entry.added_pins && entry.added_pins.length > 0) ||
    (entry.removed_pins && entry.removed_pins.length > 0) ||
    (entry.changed_fields && entry.changed_fields.length > 0)
  );

  const StatusIcon = entry.status === 'added' ? Plus : entry.status === 'removed' ? Minus : Pencil;

  return (
    <div className="border border-gray-800 rounded">
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {hasDetails ? (
          expanded ? (
            <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />
          )
        ) : (
          <div className="w-3" />
        )}

        <StatusIcon className="w-3 h-3 shrink-0" style={{ color: entry.color }} />

        <span className="text-xs flex-1 min-w-0 truncate" style={{ color: entry.color }}>
          {entry.label}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onCrossProbe(entry.type, entry.id);
          }}
          className="p-0.5 rounded hover:bg-gray-700 transition-colors"
          title="Cross-probe: highlight in other view"
        >
          <Crosshair className="w-3 h-3 text-gray-500 hover:text-brand-400" />
        </button>
      </div>

      {expanded && hasDetails && (
        <div className="px-2 pb-2 ml-5 border-t border-gray-800/50">
          {entry.detail && (
            <p className="text-[10px] text-gray-400 mt-1">{entry.detail}</p>
          )}
          {entry.added_pins && entry.added_pins.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-emerald-500 uppercase tracking-wider">Added pins:</span>
              <p className="text-[10px] text-gray-400 font-mono">
                {entry.added_pins.join(', ')}
              </p>
            </div>
          )}
          {entry.removed_pins && entry.removed_pins.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-red-500 uppercase tracking-wider">Removed pins:</span>
              <p className="text-[10px] text-gray-400 font-mono">
                {entry.removed_pins.join(', ')}
              </p>
            </div>
          )}
          {entry.changed_fields && entry.changed_fields.length > 0 && (
            <div className="mt-1">
              <span className="text-[9px] text-blue-500 uppercase tracking-wider">Changed fields:</span>
              <p className="text-[10px] text-gray-400">{entry.changed_fields.join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict Resolution Row
// ---------------------------------------------------------------------------

function ConflictRow({
  conflict,
  onResolve,
}: {
  conflict: SyncConflict;
  onResolve: (id: string, resolution: 'schematic' | 'layout') => void;
}) {
  return (
    <div className="border border-yellow-900/50 rounded p-2 bg-yellow-900/10">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0" />
        <span className="text-xs text-yellow-300 font-medium">
          {conflict.element_type}: {conflict.element_id}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
        <div className="bg-gray-800 rounded p-1.5">
          <div className="text-gray-500 mb-0.5">Schematic</div>
          <div className="text-gray-300 font-mono truncate">{conflict.schematic_value}</div>
        </div>
        <div className="bg-gray-800 rounded p-1.5">
          <div className="text-gray-500 mb-0.5">Layout</div>
          <div className="text-gray-300 font-mono truncate">{conflict.layout_value}</div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={() => onResolve(conflict.id, 'schematic')}
          className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            conflict.resolution === 'schematic'
              ? 'bg-brand-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Use Schematic
        </button>
        <button
          onClick={() => onResolve(conflict.id, 'layout')}
          className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
            conflict.resolution === 'layout'
              ? 'bg-brand-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          Use Layout
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function SyncPanel() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [activeTab, setActiveTab] = useState<'annotate' | 'diff' | 'conflicts'>('annotate');
  const [crossProbeEnabled, setCrossProbeEnabled] = useState(true);
  const [diffEntries, setDiffEntries] = useState<DiffEntry[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<'all' | 'added' | 'removed' | 'modified'>('all');
  const [diffSearchQuery, setDiffSearchQuery] = useState('');

  // --- Actions ---

  const handleForwardAnnotate = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      // In production this calls the intelligence API.
      // POST /api/v1/projects/:id/sync/forward
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSyncStatus('synced');
      setLastSyncTime(new Date().toISOString());
    } catch {
      setSyncStatus('error');
    }
  }, []);

  const handleBackAnnotate = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSyncStatus('synced');
      setLastSyncTime(new Date().toISOString());
    } catch {
      setSyncStatus('error');
    }
  }, []);

  const handleNetlistDiff = useCallback(async () => {
    setSyncStatus('syncing');
    try {
      // POST /api/v1/projects/:id/sync/diff
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Placeholder diff results for UI rendering.
      setDiffEntries([]);
      setSyncStatus('idle');
      setActiveTab('diff');
    } catch {
      setSyncStatus('error');
    }
  }, []);

  const handleCrossProbe = useCallback(
    (type: string, id: string) => {
      if (!crossProbeEnabled) return;
      // In production, dispatch an event to highlight the element in the
      // schematic or layout viewer component.
      // window.dispatchEvent(new CustomEvent('cross-probe', { detail: { type, id } }));
      console.log(`Cross-probe: ${type} ${id}`);
    },
    [crossProbeEnabled],
  );

  const resolveConflict = useCallback((id: string, resolution: 'schematic' | 'layout') => {
    setConflicts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, resolution } : c)),
    );
  }, []);

  const applyConflictResolutions = useCallback(async () => {
    const unresolved = conflicts.filter((c) => c.resolution === null);
    if (unresolved.length > 0) return;
    setSyncStatus('syncing');
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setConflicts([]);
      setSyncStatus('synced');
      setLastSyncTime(new Date().toISOString());
    } catch {
      setSyncStatus('error');
    }
  }, [conflicts]);

  // --- Filtered diff entries ---

  const filteredDiffEntries = useMemo(() => {
    let entries = diffEntries;
    if (diffFilter !== 'all') {
      entries = entries.filter((e) => e.status === diffFilter);
    }
    if (diffSearchQuery.trim()) {
      const q = diffSearchQuery.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.label.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q),
      );
    }
    return entries;
  }, [diffEntries, diffFilter, diffSearchQuery]);

  const diffStats = useMemo(() => {
    return {
      added: diffEntries.filter((e) => e.status === 'added').length,
      removed: diffEntries.filter((e) => e.status === 'removed').length,
      modified: diffEntries.filter((e) => e.status === 'modified').length,
    };
  }, [diffEntries]);

  const unresolvedConflicts = conflicts.filter((c) => c.resolution === null).length;

  const tabs = [
    { id: 'annotate' as const, label: 'Annotate' },
    { id: 'diff' as const, label: 'Diff', count: diffEntries.length },
    { id: 'conflicts' as const, label: 'Conflicts', count: unresolvedConflicts },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-brand-400" />
            <span className="text-sm font-semibold text-gray-200">Sync</span>
          </div>
          <SyncStatusBadge status={syncStatus} />
        </div>

        {/* Cross-probe toggle */}
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={crossProbeEnabled}
              onChange={(e) => setCrossProbeEnabled(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600 text-brand-500 focus:ring-brand-500"
            />
            <Crosshair className="w-3 h-3" />
            Cross-probe enabled
          </label>
          {lastSyncTime && (
            <span className="text-[9px] text-gray-600">
              Last sync: {new Date(lastSyncTime).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 bg-gray-900 rounded p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="bg-brand-600 text-white text-[8px] px-1 rounded-full min-w-[14px] text-center">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {/* Annotate Tab */}
        {activeTab === 'annotate' && (
          <div className="space-y-3">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Forward Annotation</p>
            <p className="text-xs text-gray-400">
              Push schematic changes to the PCB layout. New components will be placed outside
              the board outline for manual positioning.
            </p>
            <button
              onClick={handleForwardAnnotate}
              disabled={syncStatus === 'syncing'}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
            >
              {syncStatus === 'syncing' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              Forward Annotate (Schematic to Layout)
            </button>

            <div className="border-t border-gray-800 pt-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Back Annotation</p>
              <p className="text-xs text-gray-400 mt-1">
                Push layout changes back to the schematic. Supports pin swaps and gate swaps
                made during routing.
              </p>
              <button
                onClick={handleBackAnnotate}
                disabled={syncStatus === 'syncing'}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-xs font-medium rounded transition-colors"
              >
                {syncStatus === 'syncing' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowLeft className="w-3.5 h-3.5" />
                )}
                Back Annotate (Layout to Schematic)
              </button>
            </div>

            <div className="border-t border-gray-800 pt-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Netlist Diff</p>
              <p className="text-xs text-gray-400 mt-1">
                Compare schematic versions and view all changes between them.
              </p>
              <button
                onClick={handleNetlistDiff}
                disabled={syncStatus === 'syncing'}
                className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-xs font-medium rounded transition-colors"
              >
                <GitCompare className="w-3.5 h-3.5" />
                Run Netlist Diff
              </button>
            </div>
          </div>
        )}

        {/* Diff Tab */}
        {activeTab === 'diff' && (
          <div className="space-y-3">
            {/* Stats bar */}
            {diffEntries.length > 0 && (
              <div className="flex gap-3 text-[10px]">
                <span className="text-emerald-400">+{diffStats.added} added</span>
                <span className="text-red-400">-{diffStats.removed} removed</span>
                <span className="text-blue-400">~{diffStats.modified} modified</span>
              </div>
            )}

            {/* Filter and search */}
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
                <input
                  type="text"
                  value={diffSearchQuery}
                  onChange={(e) => setDiffSearchQuery(e.target.value)}
                  placeholder="Search changes..."
                  className="w-full pl-7 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
                />
              </div>
              <select
                value={diffFilter}
                onChange={(e) => setDiffFilter(e.target.value as typeof diffFilter)}
                className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 focus:outline-none focus:border-brand-500"
              >
                <option value="all">All</option>
                <option value="added">Added</option>
                <option value="removed">Removed</option>
                <option value="modified">Modified</option>
              </select>
            </div>

            {/* Diff entries */}
            {filteredDiffEntries.length === 0 ? (
              <div className="text-center py-8">
                <GitCompare className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500">
                  {diffEntries.length === 0
                    ? 'Run a netlist diff to see changes.'
                    : 'No changes match your filter.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredDiffEntries.map((entry) => (
                  <DiffEntryRow key={entry.id} entry={entry} onCrossProbe={handleCrossProbe} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Conflicts Tab */}
        {activeTab === 'conflicts' && (
          <div className="space-y-3">
            {conflicts.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                <p className="text-xs text-gray-500">No conflicts to resolve.</p>
              </div>
            ) : (
              <>
                <p className="text-[10px] text-gray-500">
                  {unresolvedConflicts} of {conflicts.length} conflicts need resolution
                </p>

                <div className="space-y-2">
                  {conflicts.map((conflict) => (
                    <ConflictRow
                      key={conflict.id}
                      conflict={conflict}
                      onResolve={resolveConflict}
                    />
                  ))}
                </div>

                <button
                  onClick={applyConflictResolutions}
                  disabled={unresolvedConflicts > 0 || syncStatus === 'syncing'}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
                >
                  {syncStatus === 'syncing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  Apply Resolutions & Sync
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
