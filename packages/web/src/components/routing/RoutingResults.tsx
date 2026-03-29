import { useMemo, useCallback, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRoutingStore } from '../../stores/routingStore';
import type { NetRoutingResult, DrcViolation } from '../../api/routing';
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  Undo2,
  CheckCheck,
  X,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Route,
  Layers,
  CircleDot,
} from 'lucide-react';

type SortField = 'name' | 'status' | 'length' | 'vias';
type SortDir = 'asc' | 'desc';

export default function RoutingResults() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const results = useRoutingStore((s) => s.results);
  const acceptedNets = useRoutingStore((s) => s.acceptedNets);
  const rejectedNets = useRoutingStore((s) => s.rejectedNets);
  const acceptNet = useRoutingStore((s) => s.acceptNet);
  const rejectNet = useRoutingStore((s) => s.rejectNet);
  const acceptAllNets = useRoutingStore((s) => s.acceptAllNets);
  const rejectAllNets = useRoutingStore((s) => s.rejectAllNets);
  const commitAccepted = useRoutingStore((s) => s.commitAccepted);
  const commitRejected = useRoutingStore((s) => s.commitRejected);
  const undoRouting = useRoutingStore((s) => s.undoRouting);
  const phase = useRoutingStore((s) => s.phase);

  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showDrc, setShowDrc] = useState(false);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  const sortedNetResults = useMemo(() => {
    if (!results) return [];
    const items = [...results.net_results];
    const dir = sortDir === 'asc' ? 1 : -1;

    items.sort((a: NetRoutingResult, b: NetRoutingResult) => {
      switch (sortField) {
        case 'name':
          return a.net_name.localeCompare(b.net_name) * dir;
        case 'status': {
          const order: Record<string, number> = { routed: 0, failed: 1, skipped: 2 };
          return ((order[a.status] ?? 3) - (order[b.status] ?? 3)) * dir;
        }
        case 'length':
          return (a.length_mm - b.length_mm) * dir;
        case 'vias':
          return (a.via_count - b.via_count) * dir;
        default:
          return 0;
      }
    });
    return items;
  }, [results, sortField, sortDir]);

  const handleCommit = useCallback(async () => {
    if (!currentProject) return;
    if (acceptedNets.size > 0) await commitAccepted(currentProject.id);
    if (rejectedNets.size > 0) await commitRejected(currentProject.id);
  }, [currentProject, acceptedNets, rejectedNets, commitAccepted, commitRejected]);

  const handleUndo = useCallback(() => {
    if (!currentProject) return;
    undoRouting(currentProject.id);
  }, [currentProject, undoRouting]);

  if (phase !== 'viewing_results' || !results) {
    return null;
  }

  const {
    completion_rate,
    total_nets,
    routed_count,
    failed_count,
    skipped_count,
    total_wire_length_mm,
    total_via_count,
    drc_violations,
    iterations_used,
  } = results;

  const pendingCount =
    sortedNetResults.filter(
      (nr: NetRoutingResult) =>
        nr.status === 'routed' && !acceptedNets.has(nr.net_name) && !rejectedNets.has(nr.net_name)
    ).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary header */}
      <div className="p-4 border-b border-gray-800 shrink-0">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Routing Results</h3>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-gray-900/60 rounded p-2">
            <div className="text-lg font-bold text-emerald-400">{completion_rate.toFixed(1)}%</div>
            <div className="text-[10px] text-gray-500 uppercase">Completion</div>
          </div>
          <div className="bg-gray-900/60 rounded p-2">
            <div className="text-lg font-bold text-gray-300">{total_wire_length_mm.toFixed(1)}mm</div>
            <div className="text-[10px] text-gray-500 uppercase">Wire Length</div>
          </div>
          <div className="bg-gray-900/60 rounded p-2 flex items-center gap-2">
            <CircleDot className="w-4 h-4 text-gray-500" />
            <div>
              <div className="text-sm font-bold text-gray-300">{total_via_count}</div>
              <div className="text-[10px] text-gray-500">Vias</div>
            </div>
          </div>
          <div className="bg-gray-900/60 rounded p-2 flex items-center gap-2">
            <AlertTriangle
              className={`w-4 h-4 ${drc_violations.length > 0 ? 'text-yellow-400' : 'text-gray-600'}`}
            />
            <div>
              <div
                className={`text-sm font-bold ${drc_violations.length > 0 ? 'text-yellow-400' : 'text-gray-500'}`}
              >
                {drc_violations.length}
              </div>
              <div className="text-[10px] text-gray-500">DRC</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span>
            {routed_count} routed / {failed_count} failed / {skipped_count} skipped
          </span>
          <span>({iterations_used} iteration{iterations_used !== 1 ? 's' : ''})</span>
        </div>
      </div>

      {/* DRC Violations toggle */}
      {drc_violations.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-800 shrink-0">
          <button
            onClick={() => setShowDrc(!showDrc)}
            className="flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300"
          >
            <AlertTriangle className="w-3 h-3" />
            {drc_violations.length} DRC Violation{drc_violations.length !== 1 ? 's' : ''}
            {showDrc ? (
              <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowDown className="w-3 h-3" />
            )}
          </button>
          {showDrc && (
            <div className="mt-2 space-y-1 max-h-32 overflow-auto">
              {drc_violations.map((v: DrcViolation) => (
                <div
                  key={v.id}
                  className={`px-2 py-1 rounded text-[10px] ${
                    v.severity === 'error'
                      ? 'bg-red-900/20 text-red-400'
                      : 'bg-yellow-900/20 text-yellow-400'
                  }`}
                >
                  <span className="font-medium">[{v.type}]</span> {v.description}
                  {v.affected_nets.length > 0 && (
                    <span className="text-gray-500 ml-1">({v.affected_nets.join(', ')})</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk actions */}
      <div className="px-4 py-2 border-b border-gray-800 shrink-0 flex items-center gap-2">
        <button
          onClick={acceptAllNets}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 hover:bg-emerald-900/50 transition-colors"
        >
          <CheckCheck className="w-3 h-3" />
          Accept All
        </button>
        <button
          onClick={rejectAllNets}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-red-900/30 text-red-400 border border-red-700/30 hover:bg-red-900/50 transition-colors"
        >
          <X className="w-3 h-3" />
          Reject All
        </button>
        <div className="flex-1" />
        <button
          onClick={handleUndo}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-gray-400 border border-gray-700 hover:bg-gray-800 transition-colors"
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </button>
      </div>

      {/* Per-net results */}
      <div className="flex-1 overflow-auto">
        {/* Sort header */}
        <div className="sticky top-0 bg-gray-950 flex items-center px-3 py-1.5 border-b border-gray-800 text-[10px] text-gray-600 uppercase tracking-wider">
          <button className="flex-1 text-left flex items-center gap-0.5" onClick={() => handleSort('name')}>
            Net {sortField === 'name' && (sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
          </button>
          <button className="w-14 text-center flex items-center justify-center gap-0.5" onClick={() => handleSort('status')}>
            Status {sortField === 'status' && (sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
          </button>
          <button className="w-16 text-right flex items-center justify-end gap-0.5" onClick={() => handleSort('length')}>
            Length {sortField === 'length' && (sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
          </button>
          <button className="w-12 text-right flex items-center justify-end gap-0.5" onClick={() => handleSort('vias')}>
            Vias {sortField === 'vias' && (sortDir === 'asc' ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />)}
          </button>
          <div className="w-14 text-center">Layers</div>
          <div className="w-20 text-center">Action</div>
        </div>

        {sortedNetResults.map((nr: NetRoutingResult) => {
          const isAccepted = acceptedNets.has(nr.net_name);
          const isRejected = rejectedNets.has(nr.net_name);
          const isRoutable = nr.status === 'routed';

          return (
            <div
              key={nr.net_name}
              className={`flex items-center px-3 py-1.5 border-b border-gray-800/30 text-xs transition-colors ${
                isAccepted
                  ? 'bg-emerald-900/10'
                  : isRejected
                  ? 'bg-red-900/10'
                  : 'hover:bg-gray-800/20'
              }`}
            >
              {/* Net name */}
              <div className="flex-1 min-w-0">
                <span className="text-gray-300 truncate block">{nr.net_name}</span>
                {nr.failure_reason && (
                  <span className="text-[9px] text-red-400 truncate block">{nr.failure_reason}</span>
                )}
              </div>

              {/* Status icon */}
              <div className="w-14 flex justify-center">
                {nr.status === 'routed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                {nr.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                {nr.status === 'skipped' && <SkipForward className="w-3.5 h-3.5 text-gray-500" />}
              </div>

              {/* Length */}
              <div className="w-16 text-right text-[10px] text-gray-400">
                {nr.status === 'routed' ? `${nr.length_mm.toFixed(1)}mm` : '--'}
              </div>

              {/* Vias */}
              <div className="w-12 text-right text-[10px] text-gray-400">
                {nr.status === 'routed' ? nr.via_count : '--'}
              </div>

              {/* Layers */}
              <div className="w-14 flex justify-center gap-0.5">
                {nr.layers_used.map((layer) => (
                  <span
                    key={layer}
                    className="text-[8px] px-1 py-0.5 rounded bg-gray-800 text-gray-400"
                    title={layer}
                  >
                    {layer.replace('.Cu', '')}
                  </span>
                ))}
              </div>

              {/* Accept / Reject buttons */}
              <div className="w-20 flex justify-center gap-1">
                {isRoutable && (
                  <>
                    <button
                      onClick={() => acceptNet(nr.net_name)}
                      className={`p-1 rounded transition-colors ${
                        isAccepted
                          ? 'bg-emerald-600 text-white'
                          : 'text-gray-600 hover:text-emerald-400 hover:bg-emerald-900/20'
                      }`}
                      title="Accept"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => rejectNet(nr.net_name)}
                      className={`p-1 rounded transition-colors ${
                        isRejected
                          ? 'bg-red-600 text-white'
                          : 'text-gray-600 hover:text-red-400 hover:bg-red-900/20'
                      }`}
                      title="Reject"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Commit bar */}
      <div className="px-4 py-3 border-t border-gray-800 shrink-0 bg-gray-950">
        <div className="flex items-center justify-between mb-2 text-[10px] text-gray-500">
          <span>
            {acceptedNets.size} accepted, {rejectedNets.size} rejected, {pendingCount} pending
          </span>
        </div>
        <button
          onClick={handleCommit}
          disabled={acceptedNets.size === 0 && rejectedNets.size === 0}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            acceptedNets.size === 0 && rejectedNets.size === 0
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-brand-600 text-white hover:bg-brand-500'
          }`}
        >
          <Route className="w-3.5 h-3.5" />
          Apply Changes
        </button>
      </div>
    </div>
  );
}
