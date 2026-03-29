import { useState, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRoutingStore } from '../../stores/routingStore';
import {
  LayoutGrid,
  Loader2,
  Sparkles,
  Grid3X3,
  GitBranch,
  Move,
  Thermometer,
  Minimize2,
  Route,
  AlertCircle,
} from 'lucide-react';

type PlacementStrategy = 'routing' | 'area' | 'thermal';

const strategyOptions: {
  value: PlacementStrategy;
  label: string;
  description: string;
  icon: typeof Route;
}[] = [
  {
    value: 'routing',
    label: 'Optimize for Routing',
    description: 'Place components to minimize trace lengths and routing congestion',
    icon: Route,
  },
  {
    value: 'area',
    label: 'Minimize Board Area',
    description: 'Compact placement to reduce overall board dimensions',
    icon: Minimize2,
  },
  {
    value: 'thermal',
    label: 'Thermal Optimization',
    description: 'Spread heat-generating components for better thermal performance',
    icon: Thermometer,
  },
];

export default function PlacementPanel() {
  const boardData = useProjectStore((s) => s.boardData);
  const currentProject = useProjectStore((s) => s.currentProject);

  const placementPhase = useRoutingStore((s) => s.placementPhase);
  const placementResult = useRoutingStore((s) => s.placementResult);
  const placementError = useRoutingStore((s) => s.placementError);
  const loadPlacementSuggestions = useRoutingStore((s) => s.loadPlacementSuggestions);
  const clearPlacement = useRoutingStore((s) => s.clearPlacement);

  const [selectedStrategy, setSelectedStrategy] = useState<PlacementStrategy>('routing');
  const [dragDropEnabled, setDragDropEnabled] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(0.5);
  const [showRatsnest, setShowRatsnest] = useState(true);

  const handleAutoPlace = useCallback(() => {
    if (!currentProject) return;
    loadPlacementSuggestions(currentProject.id, selectedStrategy);
  }, [currentProject, selectedStrategy, loadPlacementSuggestions]);

  if (!boardData) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No board data loaded. Upload a design to begin placement.
      </div>
    );
  }

  const componentCount = boardData.components.length;
  const isLoading = placementPhase === 'loading_suggestions';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1">
          Component Placement
        </h3>
        <p className="text-[10px] text-gray-500">
          {componentCount} components on board
        </p>
      </div>

      {/* Placement strategy selection */}
      <div className="p-3 border-b border-gray-800 shrink-0">
        <h4 className="text-[11px] font-medium text-gray-300 mb-2">Placement Strategy</h4>
        <div className="space-y-1.5">
          {strategyOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selectedStrategy === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSelectedStrategy(opt.value)}
                className={`w-full flex items-start gap-2.5 p-2 rounded border transition-colors text-left ${
                  isSelected
                    ? 'border-brand-500/50 bg-brand-900/20'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${
                    isSelected ? 'text-brand-400' : 'text-gray-600'
                  }`}
                />
                <div>
                  <div
                    className={`text-xs font-medium ${
                      isSelected ? 'text-brand-300' : 'text-gray-300'
                    }`}
                  >
                    {opt.label}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{opt.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Auto-Place button */}
        <button
          onClick={handleAutoPlace}
          disabled={isLoading}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 mt-3 rounded text-xs font-medium transition-colors ${
            isLoading
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-brand-600 text-white hover:bg-brand-500'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generating Suggestions...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              Auto-Place
            </>
          )}
        </button>

        {placementError && (
          <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{placementError}</span>
          </div>
        )}
      </div>

      {/* LLM Floorplan suggestions */}
      {placementResult && (
        <div className="p-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-medium text-gray-300 flex items-center gap-1.5">
              <LayoutGrid className="w-3 h-3 text-brand-400" />
              AI Suggestions ({placementResult.suggestions.length})
            </h4>
            <button
              onClick={clearPlacement}
              className="text-[10px] text-gray-500 hover:text-red-400"
            >
              Dismiss
            </button>
          </div>
          <div className="bg-gray-900/60 rounded p-2 text-[10px] text-gray-400 mb-2">
            <span className="font-medium text-gray-300">Strategy:</span>{' '}
            {placementResult.strategy}
            <br />
            <span className="font-medium text-gray-300">Est. improvement:</span>{' '}
            {placementResult.estimated_improvement.toFixed(0)}%
          </div>
          <p className="text-[10px] text-gray-500">
            See Placement Suggestions panel for details and controls.
          </p>
        </div>
      )}

      {/* Manual placement controls */}
      <div className="flex-1 overflow-auto">
        <div className="p-3 space-y-3">
          <h4 className="text-[11px] font-medium text-gray-300">Manual Controls</h4>

          {/* Drag-and-drop toggle */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <Move className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400" />
              <span className="text-xs text-gray-400 group-hover:text-gray-300">
                Drag-and-drop mode
              </span>
            </div>
            <div
              className={`relative w-8 h-4 rounded-full transition-colors ${
                dragDropEnabled ? 'bg-brand-600' : 'bg-gray-700'
              }`}
              onClick={() => setDragDropEnabled(!dragDropEnabled)}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  dragDropEnabled ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
          </label>

          {/* Snap-to-grid toggle */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400" />
              <span className="text-xs text-gray-400 group-hover:text-gray-300">Snap to grid</span>
            </div>
            <div
              className={`relative w-8 h-4 rounded-full transition-colors ${
                snapToGrid ? 'bg-brand-600' : 'bg-gray-700'
              }`}
              onClick={() => setSnapToGrid(!snapToGrid)}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  snapToGrid ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
          </label>

          {/* Grid size slider */}
          {snapToGrid && (
            <div className="pl-6">
              <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                <span>Grid size</span>
                <span>{gridSize.toFixed(2)} mm</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={2.54}
                step={0.05}
                value={gridSize}
                onChange={(e) => setGridSize(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-brand-500"
              />
              <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                <span>0.1mm</span>
                <span>2.54mm</span>
              </div>
            </div>
          )}

          {/* Ratsnest toggle */}
          <label className="flex items-center justify-between cursor-pointer group">
            <div className="flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-400" />
              <span className="text-xs text-gray-400 group-hover:text-gray-300">
                Show ratsnest
              </span>
            </div>
            <div
              className={`relative w-8 h-4 rounded-full transition-colors ${
                showRatsnest ? 'bg-brand-600' : 'bg-gray-700'
              }`}
              onClick={() => setShowRatsnest(!showRatsnest)}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                  showRatsnest ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
