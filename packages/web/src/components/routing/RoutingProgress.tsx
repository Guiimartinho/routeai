import { useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRoutingStore } from '../../stores/routingStore';
import {
  Loader2,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Map,
} from 'lucide-react';

function formatTime(seconds: number): string {
  if (seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function RoutingProgress() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const progress = useRoutingStore((s) => s.progress);
  const phase = useRoutingStore((s) => s.phase);
  const cancelRouting = useRoutingStore((s) => s.cancelRouting);

  const handleCancel = useCallback(() => {
    if (!currentProject) return;
    cancelRouting(currentProject.id);
  }, [currentProject, cancelRouting]);

  if (!progress || phase !== 'routing') {
    return null;
  }

  const {
    status,
    total_nets,
    completed_nets,
    current_net,
    current_net_status,
    elapsed_seconds,
    estimated_remaining_seconds,
    completion_rate,
    failed_nets,
    drc_violation_count,
  } = progress;

  const progressPct = total_nets > 0 ? (completed_nets / total_nets) * 100 : 0;
  const isActive = status === 'routing' || status === 'generating_strategy';
  const isCancelled = status === 'cancelled';
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isActive && <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />}
            {isCompleted && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {isFailed && <XCircle className="w-4 h-4 text-red-400" />}
            {isCancelled && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
            <span className="text-sm font-medium text-gray-200">
              {isActive
                ? status === 'generating_strategy'
                  ? 'Generating Strategy...'
                  : 'Routing in Progress'
                : isCompleted
                ? 'Routing Complete'
                : isCancelled
                ? 'Routing Cancelled'
                : 'Routing Failed'}
            </span>
          </div>
          {isActive && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-red-400 border border-red-800 hover:bg-red-900/30 transition-colors"
            >
              <XCircle className="w-3 h-3" />
              Cancel
            </button>
          )}
        </div>

        {/* Main progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>
              {completed_nets} / {total_nets} nets
            </span>
            <span>{completion_rate.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isFailed
                  ? 'bg-red-500'
                  : isCancelled
                  ? 'bg-yellow-500'
                  : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-brand-500'
              }`}
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>

        {/* Time stats */}
        <div className="flex items-center gap-4 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Elapsed: {formatTime(elapsed_seconds)}</span>
          </div>
          {isActive && estimated_remaining_seconds > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>ETA: {formatTime(estimated_remaining_seconds)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Current net being routed */}
      {current_net && isActive && (
        <div className="px-4 py-2 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative w-2 h-2">
              <div className="absolute inset-0 bg-brand-400 rounded-full animate-ping opacity-50" />
              <div className="absolute inset-0 bg-brand-400 rounded-full" />
            </div>
            <span className="text-xs text-gray-300 font-medium truncate">{current_net}</span>
          </div>
          {current_net_status && (
            <p className="text-[10px] text-gray-500 mt-0.5 ml-4">{current_net_status}</p>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div className="px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-400">{completed_nets}</div>
            <div className="text-[10px] text-gray-600 uppercase">Routed</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${failed_nets.length > 0 ? 'text-red-400' : 'text-gray-600'}`}>
              {failed_nets.length}
            </div>
            <div className="text-[10px] text-gray-600 uppercase">Failed</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-bold ${drc_violation_count > 0 ? 'text-yellow-400' : 'text-gray-600'}`}>
              {drc_violation_count}
            </div>
            <div className="text-[10px] text-gray-600 uppercase">DRC</div>
          </div>
        </div>
      </div>

      {/* Failed nets list */}
      <div className="flex-1 overflow-auto">
        {failed_nets.length > 0 && (
          <div className="p-3">
            <h4 className="text-[11px] font-medium text-red-400 mb-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Failed Nets ({failed_nets.length})
            </h4>
            <div className="space-y-0.5">
              {failed_nets.map((netName) => (
                <div
                  key={netName}
                  className="flex items-center gap-2 px-2 py-1 bg-red-900/15 rounded text-[10px] text-red-300"
                >
                  <XCircle className="w-3 h-3 shrink-0" />
                  <span className="truncate">{netName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Congestion heatmap toggle placeholder */}
        <div className="p-3 border-t border-gray-800/50">
          <h4 className="text-[11px] font-medium text-gray-300 mb-1.5 flex items-center gap-1">
            <Layers className="w-3 h-3 text-brand-400" />
            View Options
          </h4>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="form-checkbox w-3 h-3 rounded text-brand-500" />
            <Map className="w-3 h-3 text-gray-500" />
            <span className="text-[10px] text-gray-400">Show congestion heatmap</span>
          </label>
        </div>
      </div>
    </div>
  );
}
