import { useState, useMemo, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useRoutingStore } from '../../stores/routingStore';
import type { Net } from '../../types/board';
import type { RoutingOrderEntry } from '../../api/routing';
import {
  Search,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  Sparkles,
  AlertCircle,
  Layers,
  ArrowUpDown,
  Gauge,
  Route,
} from 'lucide-react';

export default function RoutingPanel() {
  const boardData = useProjectStore((s) => s.boardData);
  const currentProject = useProjectStore((s) => s.currentProject);

  const selectedNets = useRoutingStore((s) => s.selectedNets);
  const naturalLanguageConstraints = useRoutingStore((s) => s.naturalLanguageConstraints);
  const strategy = useRoutingStore((s) => s.strategy);
  const strategyLoading = useRoutingStore((s) => s.strategyLoading);
  const strategyError = useRoutingStore((s) => s.strategyError);
  const phase = useRoutingStore((s) => s.phase);
  const selectNet = useRoutingStore((s) => s.selectNet);
  const deselectNet = useRoutingStore((s) => s.deselectNet);
  const selectAllNets = useRoutingStore((s) => s.selectAllNets);
  const deselectAllNets = useRoutingStore((s) => s.deselectAllNets);
  const toggleNet = useRoutingStore((s) => s.toggleNet);
  const setNaturalLanguageConstraints = useRoutingStore((s) => s.setNaturalLanguageConstraints);
  const generateStrategy = useRoutingStore((s) => s.generateStrategy);
  const clearStrategy = useRoutingStore((s) => s.clearStrategy);
  const executeRouting = useRoutingStore((s) => s.executeRouting);

  const [netSearch, setNetSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showStrategy, setShowStrategy] = useState(true);

  const nets: Net[] = boardData?.nets ?? [];

  // Group nets by class
  const groupedNets = useMemo(() => {
    const groups: Record<string, Net[]> = {};
    const query = netSearch.toLowerCase();

    for (const net of nets) {
      if (query && !net.name.toLowerCase().includes(query) && !net.class.toLowerCase().includes(query)) {
        continue;
      }
      const cls = net.class || 'Default';
      if (!groups[cls]) groups[cls] = [];
      groups[cls].push(net);
    }

    // Sort groups alphabetically, but put 'Default' last
    const sorted = Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Default') return 1;
      if (b === 'Default') return -1;
      return a.localeCompare(b);
    });

    return sorted;
  }, [nets, netSearch]);

  const totalFilteredNets = useMemo(
    () => groupedNets.reduce((sum, [, g]) => sum + g.length, 0),
    [groupedNets]
  );

  const allFilteredSelected = useMemo(() => {
    if (totalFilteredNets === 0) return false;
    return groupedNets.every(([, g]) => g.every((n) => selectedNets.has(n.id)));
  }, [groupedNets, selectedNets, totalFilteredNets]);

  const toggleGroup = useCallback(
    (className: string) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(className)) next.delete(className);
        else next.add(className);
        return next;
      });
    },
    []
  );

  const selectGroupNets = useCallback(
    (groupNets: Net[]) => {
      for (const net of groupNets) {
        selectNet(net.id);
      }
    },
    [selectNet]
  );

  const deselectGroupNets = useCallback(
    (groupNets: Net[]) => {
      for (const net of groupNets) {
        deselectNet(net.id);
      }
    },
    [deselectNet]
  );

  const handleSelectAll = useCallback(() => {
    const allIds = groupedNets.flatMap(([, g]) => g.map((n) => n.id));
    selectAllNets(allIds);
  }, [groupedNets, selectAllNets]);

  const handleRouteAll = useCallback(() => {
    const allIds = nets.map((n) => n.id);
    selectAllNets(allIds);
  }, [nets, selectAllNets]);

  const handleGenerateStrategy = useCallback(() => {
    if (!currentProject) return;
    generateStrategy(currentProject.id);
  }, [currentProject, generateStrategy]);

  const handleExecuteRouting = useCallback(() => {
    if (!currentProject) return;
    executeRouting(currentProject.id);
  }, [currentProject, executeRouting]);

  if (!boardData) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No board data loaded. Upload a design to begin routing.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Net Selection Section */}
      <div className="shrink-0 border-b border-gray-800">
        <div className="p-3">
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
            Net Selection
          </h3>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={netSearch}
              onChange={(e) => setNetSearch(e.target.value)}
              placeholder="Search nets..."
              className="input-field text-xs pl-8 py-1.5 w-full"
            />
          </div>

          {/* Select All / None / Route All */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-500">{selectedNets.size} / {nets.length} selected</span>
              {allFilteredSelected ? (
                <button
                  onClick={deselectAllNets}
                  className="text-brand-400 hover:text-brand-300"
                >
                  Select None
                </button>
              ) : (
                <button
                  onClick={handleSelectAll}
                  className="text-brand-400 hover:text-brand-300"
                >
                  Select All
                </button>
              )}
            </div>
            <button
              onClick={handleRouteAll}
              className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Route All
            </button>
          </div>
        </div>

        {/* Net list grouped by class */}
        <div className="max-h-48 overflow-auto border-t border-gray-800/50">
          {groupedNets.length === 0 ? (
            <div className="p-3 text-center text-xs text-gray-600">
              {netSearch ? 'No matching nets.' : 'No nets in design.'}
            </div>
          ) : (
            groupedNets.map(([className, groupNets]) => {
              const isCollapsed = collapsedGroups.has(className);
              const allSelected = groupNets.every((n) => selectedNets.has(n.id));
              const someSelected = groupNets.some((n) => selectedNets.has(n.id));

              return (
                <div key={className}>
                  {/* Group header */}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900/50 border-b border-gray-800/30">
                    <button
                      onClick={() => toggleGroup(className)}
                      className="text-gray-500 hover:text-gray-300"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3 h-3" />
                      ) : (
                        <ChevronDown className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        allSelected
                          ? deselectGroupNets(groupNets)
                          : selectGroupNets(groupNets)
                      }
                      className="text-gray-400 hover:text-gray-200"
                    >
                      {allSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-brand-400" />
                      ) : someSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-gray-500" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <span className="text-[11px] font-medium text-gray-300 flex-1">
                      {className}
                    </span>
                    <span className="text-[10px] text-gray-600">{groupNets.length}</span>
                  </div>

                  {/* Individual nets */}
                  {!isCollapsed &&
                    groupNets.map((net) => {
                      const isSelected = selectedNets.has(net.id);
                      return (
                        <button
                          key={net.id}
                          onClick={() => toggleNet(net.id)}
                          className={`w-full flex items-center gap-2 pl-8 pr-3 py-1 text-left transition-colors text-xs ${
                            isSelected
                              ? 'bg-brand-600/10 text-brand-300'
                              : 'text-gray-400 hover:bg-gray-800/30'
                          }`}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-3 h-3 text-brand-400 shrink-0" />
                          ) : (
                            <Square className="w-3 h-3 text-gray-600 shrink-0" />
                          )}
                          <span className="truncate flex-1">{net.name || `Net ${net.id}`}</span>
                          <span className="text-[10px] text-gray-600 shrink-0">
                            {net.padIds.length}p
                          </span>
                        </button>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Natural Language Constraints */}
      <div className="shrink-0 p-3 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
          Constraints (Natural Language)
        </h3>
        <textarea
          value={naturalLanguageConstraints}
          onChange={(e) => setNaturalLanguageConstraints(e.target.value)}
          placeholder="e.g., Route USB signals on inner layers, keep DDR traces under 50mm, minimize vias on clock nets..."
          className="input-field text-xs w-full h-16 resize-none"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleGenerateStrategy}
            disabled={selectedNets.size === 0 || strategyLoading}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              selectedNets.size === 0 || strategyLoading
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-brand-600 text-white hover:bg-brand-500'
            }`}
          >
            {strategyLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generate Strategy
              </>
            )}
          </button>
        </div>

        {strategyError && (
          <div className="mt-2 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{strategyError}</span>
          </div>
        )}
      </div>

      {/* Strategy Preview */}
      {strategy && (
        <div className="flex-1 overflow-auto">
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Strategy Preview
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowStrategy(!showStrategy)}
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                >
                  {showStrategy ? 'Collapse' : 'Expand'}
                </button>
                <button
                  onClick={clearStrategy}
                  className="text-[10px] text-gray-500 hover:text-red-400 ml-2"
                >
                  Clear
                </button>
              </div>
            </div>

            {!strategy.validation_passed && strategy.validation_errors.length > 0 && (
              <div className="mb-2 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-[10px] text-yellow-400">
                Strategy has {strategy.validation_errors.length} validation warning(s).
              </div>
            )}

            {showStrategy && (
              <div className="space-y-3">
                {/* Routing Order */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <ArrowUpDown className="w-3 h-3 text-brand-400" />
                    <span className="text-[11px] font-medium text-gray-300">
                      Routing Order ({strategy.routing_order.length} nets)
                    </span>
                  </div>
                  <div className="space-y-0.5 max-h-32 overflow-auto">
                    {strategy.routing_order.slice(0, 20).map((entry: RoutingOrderEntry, i: number) => (
                      <div
                        key={`${entry.net_name}-${i}`}
                        className="flex items-center gap-2 px-2 py-1 bg-gray-900/50 rounded text-[10px]"
                      >
                        <span
                          className={`shrink-0 w-5 h-5 rounded flex items-center justify-center font-bold ${
                            entry.priority >= 8
                              ? 'bg-red-900/40 text-red-400'
                              : entry.priority >= 5
                              ? 'bg-yellow-900/40 text-yellow-400'
                              : 'bg-gray-800 text-gray-400'
                          }`}
                        >
                          {entry.priority}
                        </span>
                        <span className="text-gray-300 truncate flex-1">{entry.net_name}</span>
                        <span className="text-gray-600 truncate max-w-[120px]" title={entry.reason}>
                          {entry.reason}
                        </span>
                      </div>
                    ))}
                    {strategy.routing_order.length > 20 && (
                      <div className="text-[10px] text-gray-600 text-center py-1">
                        +{strategy.routing_order.length - 20} more nets
                      </div>
                    )}
                  </div>
                </div>

                {/* Layer Assignments */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Layers className="w-3 h-3 text-brand-400" />
                    <span className="text-[11px] font-medium text-gray-300">Layer Assignments</span>
                  </div>
                  <div className="space-y-0.5">
                    {Object.entries(strategy.layer_assignment).map(([pattern, entry]) => (
                      <div
                        key={pattern}
                        className="flex items-start gap-2 px-2 py-1 bg-gray-900/50 rounded text-[10px]"
                      >
                        <span className="text-brand-300 font-mono shrink-0">{pattern}</span>
                        <span className="text-gray-500">-&gt;</span>
                        <span className="text-gray-300">{entry.signal_layers.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cost Weights */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Gauge className="w-3 h-3 text-brand-400" />
                    <span className="text-[11px] font-medium text-gray-300">Cost Weights</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(strategy.cost_weights).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 px-2 py-1 bg-gray-900/50 rounded">
                        <span className="text-[10px] text-gray-400 flex-1">
                          {key.replace(/_/g, ' ')}
                        </span>
                        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full"
                            style={{ width: `${(value as number) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500 w-7 text-right">
                          {(value as number).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Via Strategy summary */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Route className="w-3 h-3 text-brand-400" />
                    <span className="text-[11px] font-medium text-gray-300">Via Strategy</span>
                  </div>
                  <div className="space-y-0.5 text-[10px]">
                    <div className="flex justify-between px-2 py-1 bg-gray-900/50 rounded">
                      <span className="text-gray-400">High-speed</span>
                      <span className="text-gray-300">{strategy.via_strategy.high_speed}</span>
                    </div>
                    <div className="flex justify-between px-2 py-1 bg-gray-900/50 rounded">
                      <span className="text-gray-400">General</span>
                      <span className="text-gray-300">{strategy.via_strategy.general}</span>
                    </div>
                    <div className="flex justify-between px-2 py-1 bg-gray-900/50 rounded">
                      <span className="text-gray-400">Return via distance</span>
                      <span className="text-gray-300">
                        {strategy.via_strategy.return_path_via_max_distance_mm}mm
                      </span>
                    </div>
                  </div>
                </div>

                {/* Generated constraints */}
                {strategy.constraints_generated.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertCircle className="w-3 h-3 text-yellow-400" />
                      <span className="text-[11px] font-medium text-gray-300">
                        Generated Constraints ({strategy.constraints_generated.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {strategy.constraints_generated.map((c, i) => (
                        <div
                          key={i}
                          className={`px-2 py-1 rounded text-[10px] ${
                            c.type === 'warning' || c.type === 'manual_routing_required'
                              ? 'bg-yellow-900/20 text-yellow-400'
                              : 'bg-gray-900/50 text-gray-300'
                          }`}
                        >
                          <span className="font-medium">[{c.type}]</span> {c.description}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Execute Routing Button */}
            <div className="mt-3 pt-3 border-t border-gray-800">
              <button
                onClick={handleExecuteRouting}
                disabled={phase === 'routing'}
                className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors ${
                  phase === 'routing'
                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                Execute Routing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
