import { useMemo, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRoutingStore } from '../../stores/routingStore';
import type { PlacementSuggestion } from '../../api/routing';
import {
  CheckCircle2,
  Circle,
  CheckCheck,
  Loader2,
  MoveRight,
  MapPin,
  Quote,
  AlertCircle,
} from 'lucide-react';

export default function PlacementSuggestions() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const boardData = useProjectStore((s) => s.boardData);

  const placementPhase = useRoutingStore((s) => s.placementPhase);
  const placementResult = useRoutingStore((s) => s.placementResult);
  const placementError = useRoutingStore((s) => s.placementError);
  const appliedSuggestions = useRoutingStore((s) => s.appliedSuggestions);
  const applyPlacementSuggestion = useRoutingStore((s) => s.applyPlacementSuggestion);
  const applyAllSuggestions = useRoutingStore((s) => s.applyAllSuggestions);
  const commitPlacement = useRoutingStore((s) => s.commitPlacement);
  const clearPlacement = useRoutingStore((s) => s.clearPlacement);

  // Build a lookup from component ref to current position
  const componentPositions = useMemo(() => {
    if (!boardData) return new Map<string, { x: number; y: number; rotation: number }>();
    const map = new Map<string, { x: number; y: number; rotation: number }>();
    for (const comp of boardData.components) {
      map.set(comp.reference, {
        x: comp.position.x,
        y: comp.position.y,
        rotation: comp.rotation,
      });
    }
    return map;
  }, [boardData]);

  const suggestions: PlacementSuggestion[] = placementResult?.suggestions ?? [];

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) => b.improvement_score - a.improvement_score);
  }, [suggestions]);

  const selectedCount = appliedSuggestions.size;
  const totalCount = suggestions.length;

  const handleCommit = useCallback(() => {
    if (!currentProject) return;
    commitPlacement(currentProject.id);
  }, [currentProject, commitPlacement]);

  // Loading state
  if (placementPhase === 'loading_suggestions') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
        <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
        <p className="text-sm text-gray-400">Analyzing placement...</p>
        <p className="text-xs text-gray-600">The AI is evaluating component positions.</p>
      </div>
    );
  }

  // No suggestions
  if (placementPhase === 'idle' || !placementResult) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <MapPin className="w-10 h-10 text-gray-700" />
        <p className="text-sm text-gray-400">No placement suggestions.</p>
        <p className="text-xs text-gray-600">
          Use the Placement panel to generate AI suggestions for component positions.
        </p>
      </div>
    );
  }

  // Error
  if (placementPhase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-500" />
        <p className="text-sm text-red-400">Failed to generate suggestions</p>
        <p className="text-xs text-gray-600">{placementError}</p>
      </div>
    );
  }

  const isApplying = placementPhase === 'applying';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-200">Placement Suggestions</h3>
          <button
            onClick={clearPlacement}
            className="text-[10px] text-gray-500 hover:text-red-400"
          >
            Dismiss
          </button>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-500">
          <span>
            {selectedCount} / {totalCount} selected
          </span>
          <span>
            Strategy: {placementResult.strategy} | Est. improvement:{' '}
            {placementResult.estimated_improvement.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* Bulk actions */}
      <div className="px-4 py-2 border-b border-gray-800 shrink-0 flex items-center gap-2">
        <button
          onClick={applyAllSuggestions}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-brand-900/30 text-brand-400 border border-brand-700/30 hover:bg-brand-900/50 transition-colors"
        >
          <CheckCheck className="w-3 h-3" />
          Apply All
        </button>
        <div className="flex-1" />
      </div>

      {/* Suggestions list */}
      <div className="flex-1 overflow-auto">
        {sortedSuggestions.map((suggestion: PlacementSuggestion) => {
          const isSelected = appliedSuggestions.has(suggestion.component_ref);
          const currentPos = componentPositions.get(suggestion.component_ref);
          const hasMoved =
            currentPos &&
            (Math.abs(currentPos.x - suggestion.suggested_x) > 0.01 ||
              Math.abs(currentPos.y - suggestion.suggested_y) > 0.01 ||
              Math.abs(currentPos.rotation - suggestion.suggested_rotation) > 0.1);

          return (
            <div
              key={suggestion.component_ref}
              className={`border-b border-gray-800/30 transition-colors ${
                isSelected ? 'bg-brand-900/10' : 'hover:bg-gray-800/20'
              }`}
            >
              <div className="p-3">
                {/* Component ref + apply button */}
                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    onClick={() => applyPlacementSuggestion(suggestion.component_ref)}
                    className="shrink-0"
                  >
                    {isSelected ? (
                      <CheckCircle2 className="w-4 h-4 text-brand-400" />
                    ) : (
                      <Circle className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                    )}
                  </button>
                  <span className="text-xs font-medium text-gray-200">
                    {suggestion.component_ref}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      suggestion.improvement_score >= 70
                        ? 'bg-emerald-900/30 text-emerald-400'
                        : suggestion.improvement_score >= 40
                        ? 'bg-yellow-900/30 text-yellow-400'
                        : 'bg-gray-800 text-gray-400'
                    }`}
                  >
                    +{suggestion.improvement_score}%
                  </span>
                </div>

                {/* Before/after position preview */}
                {currentPos && hasMoved && (
                  <div className="flex items-center gap-2 mb-1.5 text-[10px]">
                    <div className="text-gray-500">
                      ({currentPos.x.toFixed(2)}, {currentPos.y.toFixed(2)})
                      {currentPos.rotation !== 0 && ` ${currentPos.rotation.toFixed(0)}deg`}
                    </div>
                    <MoveRight className="w-3 h-3 text-brand-400" />
                    <div className="text-brand-300">
                      ({suggestion.suggested_x.toFixed(2)}, {suggestion.suggested_y.toFixed(2)})
                      {suggestion.suggested_rotation !== 0 &&
                        ` ${suggestion.suggested_rotation.toFixed(0)}deg`}
                    </div>
                  </div>
                )}

                {/* Reason */}
                <p className="text-[10px] text-gray-400 mb-1">{suggestion.reason}</p>

                {/* Citation */}
                {suggestion.citation && (
                  <div className="flex items-start gap-1 text-[9px] text-gray-500">
                    <Quote className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                    <span className="italic">{suggestion.citation}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Commit bar */}
      <div className="px-4 py-3 border-t border-gray-800 shrink-0 bg-gray-950">
        <button
          onClick={handleCommit}
          disabled={selectedCount === 0 || isApplying}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
            selectedCount === 0 || isApplying
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-brand-600 text-white hover:bg-brand-500'
          }`}
        >
          {isApplying ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Applying...
            </>
          ) : (
            <>
              <CheckCheck className="w-3.5 h-3.5" />
              Apply {selectedCount} Suggestion{selectedCount !== 1 ? 's' : ''}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
