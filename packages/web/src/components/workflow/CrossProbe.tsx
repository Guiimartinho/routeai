/**
 * CrossProbe - Bidirectional schematic <-> board navigation panel.
 *
 * Enables clicking a component or net in one view and highlighting it
 * in the other, with split-view mode support.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  ArrowRightLeft,
  Columns2,
  Square,
  Search,
  Loader2,
  MapPin,
  Network,
  Component,
  AlertCircle,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSchematicStore } from '../../stores/schematicStore';
import * as workflowApi from '../../api/workflow';
import type { CrossProbeResult } from '../../api/workflow';

// ---------------------------------------------------------------------------
// Cross-probe history entry
// ---------------------------------------------------------------------------

interface ProbeHistoryEntry {
  id: string;
  source: 'schematic' | 'board';
  elementId: string;
  elementName: string;
  elementType: string;
  timestamp: number;
  result: CrossProbeResult | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CrossProbe({ projectId }: { projectId: string }) {
  const splitViewEnabled = useWorkflowStore((s) => s.splitViewEnabled);
  const setSplitView = useWorkflowStore((s) => s.setSplitView);
  const setCrossProbe = useWorkflowStore((s) => s.setCrossProbe);

  const selectedElementId = useProjectStore((s) => s.selectedElementId);
  const selectedElementType = useProjectStore((s) => s.selectedElementType);
  const setHighlightedNet = useProjectStore((s) => s.setHighlightedNet);
  const navigateTo = useProjectStore((s) => s.navigateTo);
  const setSelectedElement = useProjectStore((s) => s.setSelectedElement);
  const boardData = useProjectStore((s) => s.boardData);

  const schematicSelectedIds = useSchematicStore((s) => s.selectedIds);
  const schematicComponents = useSchematicStore((s) => s.components);
  const schematicNets = useSchematicStore((s) => s.nets);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<CrossProbeResult | null>(null);
  const [history, setHistory] = useState<ProbeHistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(true);
  const [autoProbe, setAutoProbe] = useState(true);

  // ---------------------------------------------------------------------------
  // Auto cross-probe when board element is selected
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!autoProbe || !selectedElementId || !selectedElementType) return;

    const doProbe = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await workflowApi.crossProbe(projectId, 'board', selectedElementId);
        setCurrentResult(result);
        setCrossProbe('board', selectedElementId);

        // Highlight in schematic
        if (result.matchedElementId) {
          const comp = schematicComponents.get(result.matchedElementId);
          if (comp) {
            useSchematicStore.getState().select(result.matchedElementId);
          }
        }

        // Add to history
        const entry: ProbeHistoryEntry = {
          id: `probe_${Date.now()}`,
          source: 'board',
          elementId: selectedElementId,
          elementName: selectedElementId,
          elementType: selectedElementType || 'unknown',
          timestamp: Date.now(),
          result,
        };
        setHistory((prev) => [entry, ...prev].slice(0, 50));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Cross-probe failed';
        setError(msg);
        setCurrentResult(null);
      } finally {
        setLoading(false);
      }
    };

    doProbe();
  }, [autoProbe, selectedElementId, selectedElementType, projectId, setCrossProbe, schematicComponents]);

  // ---------------------------------------------------------------------------
  // Auto cross-probe when schematic element is selected
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!autoProbe || schematicSelectedIds.size === 0) return;

    const firstId = schematicSelectedIds.values().next().value;
    if (!firstId) return;

    const doProbe = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await workflowApi.crossProbe(projectId, 'schematic', firstId);
        setCurrentResult(result);
        setCrossProbe('schematic', firstId);

        // Navigate board to matched element
        if (result.location) {
          navigateTo(result.location.x, result.location.y, 10);
        }
        if (result.matchedElementId) {
          setSelectedElement(result.matchedElementId, result.matchedType || 'component');
        }

        // Highlight net
        if (result.highlightIds.length > 0) {
          setHighlightedNet(result.highlightIds[0]);
        }

        const comp = schematicComponents.get(firstId);
        const entry: ProbeHistoryEntry = {
          id: `probe_${Date.now()}`,
          source: 'schematic',
          elementId: firstId,
          elementName: comp?.reference || firstId,
          elementType: 'component',
          timestamp: Date.now(),
          result,
        };
        setHistory((prev) => [entry, ...prev].slice(0, 50));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Cross-probe failed';
        setError(msg);
        setCurrentResult(null);
      } finally {
        setLoading(false);
      }
    };

    doProbe();
  }, [autoProbe, schematicSelectedIds, projectId, setCrossProbe, navigateTo, setSelectedElement, setHighlightedNet, schematicComponents]);

  // ---------------------------------------------------------------------------
  // Manual cross-probe search
  // ---------------------------------------------------------------------------

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setLoading(true);
    setError(null);

    // Try to find the element in board or schematic
    const boardComp = boardData?.components.find(
      (c) => c.reference.toLowerCase() === query.toLowerCase() || c.id === query,
    );
    const boardNet = boardData?.nets.find(
      (n) => n.name.toLowerCase() === query.toLowerCase() || n.id === query,
    );

    let source: 'schematic' | 'board' = 'board';
    let elementId = query;

    if (boardComp) {
      source = 'board';
      elementId = boardComp.id;
    } else if (boardNet) {
      source = 'board';
      elementId = boardNet.id;
      setHighlightedNet(boardNet.id);
    } else {
      // Try schematic
      source = 'schematic';
      let found = false;
      schematicComponents.forEach((comp) => {
        if (comp.reference.toLowerCase() === query.toLowerCase() || comp.id === query) {
          elementId = comp.id;
          found = true;
        }
      });
      if (!found) {
        schematicNets.forEach((net) => {
          if (net.name.toLowerCase() === query.toLowerCase()) {
            elementId = net.id;
            found = true;
          }
        });
      }
    }

    try {
      const result = await workflowApi.crossProbe(projectId, source, elementId);
      setCurrentResult(result);
      setCrossProbe(source, elementId);

      if (result.location) {
        navigateTo(result.location.x, result.location.y, 10);
      }
      if (result.matchedElementId) {
        if (source === 'board') {
          useSchematicStore.getState().select(result.matchedElementId);
        } else {
          setSelectedElement(result.matchedElementId, result.matchedType || 'component');
        }
      }

      const entry: ProbeHistoryEntry = {
        id: `probe_${Date.now()}`,
        source,
        elementId,
        elementName: query,
        elementType: boardComp ? 'component' : boardNet ? 'net' : 'unknown',
        timestamp: Date.now(),
        result,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 50));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cross-probe failed';
      setError(msg);
      setCurrentResult(null);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, boardData, projectId, navigateTo, setSelectedElement, setHighlightedNet, setCrossProbe, schematicComponents, schematicNets]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-3 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-brand-400" />
            <h3 className="text-xs font-semibold text-gray-200">Cross-Probe</h3>
          </div>
          <button
            onClick={() => setSplitView(!splitViewEnabled)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
              splitViewEnabled
                ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            title="Toggle split view (schematic + board side by side)"
          >
            <Columns2 className="w-3 h-3" />
            Split View
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search component or net (e.g., U1, GND)..."
            className="w-full pl-8 pr-8 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-brand-500"
          />
          {loading && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-400 animate-spin" />
          )}
        </div>

        {/* Auto-probe toggle */}
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <div
            className={`relative w-7 h-3.5 rounded-full transition-colors ${
              autoProbe ? 'bg-brand-600' : 'bg-gray-700'
            }`}
            onClick={() => setAutoProbe(!autoProbe)}
          >
            <div
              className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${
                autoProbe ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </div>
          <span className="text-[10px] text-gray-500">Auto cross-probe on selection</span>
        </label>
      </div>

      {/* Current result */}
      {error && (
        <div className="px-3 py-2 bg-red-900/10 border-b border-red-800/30 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          <span className="text-[10px] text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-3 h-3 text-red-400 hover:text-red-300" />
          </button>
        </div>
      )}

      {currentResult && (
        <div className="shrink-0 p-3 border-b border-gray-800 bg-gray-900/30">
          <div className="text-[10px] text-gray-500 mb-1">Current Match</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded text-xs">
              {currentResult.source === 'schematic' ? (
                <Square className="w-3 h-3 text-blue-400" />
              ) : (
                <Component className="w-3 h-3 text-emerald-400" />
              )}
              <span className="text-gray-300 font-mono">{currentResult.elementId}</span>
            </div>
            <ArrowRightLeft className="w-3 h-3 text-gray-600" />
            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded text-xs">
              {currentResult.matchedElementId ? (
                <>
                  <MapPin className="w-3 h-3 text-brand-400" />
                  <span className="text-gray-300 font-mono">{currentResult.matchedElementId}</span>
                </>
              ) : (
                <span className="text-gray-500 italic">No match</span>
              )}
            </div>
          </div>
          {currentResult.highlightIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {currentResult.highlightIds.map((id) => (
                <span key={id} className="px-1.5 py-0.5 bg-brand-600/10 text-brand-300 rounded text-[9px] font-mono">
                  {id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="flex-1 overflow-auto">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-gray-500 hover:text-gray-300 border-b border-gray-800/50"
        >
          {showHistory ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Probe History ({history.length})
        </button>

        {showHistory && (
          <div className="divide-y divide-gray-800/30">
            {history.length === 0 ? (
              <div className="p-4 text-center text-[10px] text-gray-600">
                Select a component or net to start cross-probing.
              </div>
            ) : (
              history.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    if (entry.result?.location) {
                      navigateTo(entry.result.location.x, entry.result.location.y, 10);
                    }
                    if (entry.result?.matchedElementId) {
                      setSelectedElement(entry.result.matchedElementId, entry.result.matchedType || 'component');
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-800/30 transition-colors"
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      entry.source === 'schematic' ? 'bg-blue-400' : 'bg-emerald-400'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-gray-300 truncate">{entry.elementName}</span>
                      <span className="text-[9px] text-gray-600 uppercase">{entry.elementType}</span>
                    </div>
                    {entry.result?.matchedElementId && (
                      <span className="text-[9px] text-gray-500">
                        matched: {entry.result.matchedElementId}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] text-gray-600 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
