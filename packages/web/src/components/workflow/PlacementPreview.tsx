/**
 * PlacementPreview - AI-generated component placement visualization.
 *
 * Shows color-coded zones, component outlines, critical pair connections,
 * zone boundaries, and accept/reject controls.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Check,
  X,
  RotateCcw,
  Move,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { useRoutingStore } from '../../stores/routingStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { PlacementSuggestion } from '../../api/routing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlacementZone {
  name: string;
  color: string;
  components: string[];
  bounds: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Zone color map
// ---------------------------------------------------------------------------

const ZONE_COLORS: Record<string, { fill: string; stroke: string; label: string }> = {
  power: { fill: 'rgba(239, 68, 68, 0.08)', stroke: 'rgba(239, 68, 68, 0.4)', label: 'Power' },
  digital: { fill: 'rgba(59, 130, 246, 0.08)', stroke: 'rgba(59, 130, 246, 0.4)', label: 'Digital' },
  analog: { fill: 'rgba(34, 197, 94, 0.08)', stroke: 'rgba(34, 197, 94, 0.4)', label: 'Analog' },
  mixed: { fill: 'rgba(168, 85, 247, 0.08)', stroke: 'rgba(168, 85, 247, 0.4)', label: 'Mixed Signal' },
  connector: { fill: 'rgba(251, 191, 36, 0.08)', stroke: 'rgba(251, 191, 36, 0.4)', label: 'Connectors' },
  rf: { fill: 'rgba(236, 72, 153, 0.08)', stroke: 'rgba(236, 72, 153, 0.4)', label: 'RF' },
  mechanical: { fill: 'rgba(156, 163, 175, 0.08)', stroke: 'rgba(156, 163, 175, 0.4)', label: 'Mechanical' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyComponent(ref: string, reason: string): string {
  const lower = (ref + ' ' + reason).toLowerCase();
  if (lower.includes('power') || lower.includes('regulator') || lower.includes('inductor')) return 'power';
  if (lower.includes('analog') || lower.includes('adc') || lower.includes('dac') || lower.includes('opamp')) return 'analog';
  if (lower.includes('connector') || lower.includes('usb') || lower.includes('header')) return 'connector';
  if (lower.includes('rf') || lower.includes('antenna')) return 'rf';
  if (lower.includes('crystal') || lower.includes('mechanical') || lower.includes('mount')) return 'mechanical';
  if (lower.includes('mixed')) return 'mixed';
  return 'digital';
}

function buildZones(suggestions: PlacementSuggestion[]): PlacementZone[] {
  const groups: Record<string, PlacementSuggestion[]> = {};

  for (const s of suggestions) {
    const zone = classifyComponent(s.component_ref, s.reason);
    if (!groups[zone]) groups[zone] = [];
    groups[zone].push(s);
  }

  return Object.entries(groups).map(([zoneKey, items]) => {
    const xs = items.map((i) => i.suggested_x);
    const ys = items.map((i) => i.suggested_y);
    const minX = Math.min(...xs) - 5;
    const minY = Math.min(...ys) - 5;
    const maxX = Math.max(...xs) + 5;
    const maxY = Math.max(...ys) + 5;

    return {
      name: zoneKey,
      color: zoneKey,
      components: items.map((i) => i.component_ref),
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  });
}

// ---------------------------------------------------------------------------
// Draggable component on SVG
// ---------------------------------------------------------------------------

interface DraggableComponentProps {
  suggestion: PlacementSuggestion;
  scale: number;
  offsetX: number;
  offsetY: number;
  isSelected: boolean;
  isApplied: boolean;
  onSelect: (ref: string) => void;
  onDragEnd: (ref: string, x: number, y: number) => void;
}

function DraggableComponent({
  suggestion,
  scale,
  offsetX,
  offsetY,
  isSelected,
  isApplied,
  onSelect,
  onDragEnd,
}: DraggableComponentProps) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGGElement>(null);

  const zone = classifyComponent(suggestion.component_ref, suggestion.reason);
  const zoneStyle = ZONE_COLORS[zone] || ZONE_COLORS.digital;

  const cx = (dragPos?.x ?? suggestion.suggested_x) * scale + offsetX;
  const cy = (dragPos?.y ?? suggestion.suggested_y) * scale + offsetY;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(suggestion.component_ref);
    setDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = suggestion.suggested_x;
    const origY = suggestion.suggested_y;

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      setDragPos({ x: origX + dx, y: origY + dy });
    };

    const handleMouseUp = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      setDragging(false);
      setDragPos(null);
      onDragEnd(suggestion.component_ref, origX + dx, origY + dy);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <g
      ref={svgRef}
      onMouseDown={handleMouseDown}
      className={`cursor-grab ${dragging ? 'cursor-grabbing' : ''}`}
    >
      {/* Component body */}
      <rect
        x={cx - 12}
        y={cy - 8}
        width={24}
        height={16}
        rx={2}
        fill={isApplied ? zoneStyle.fill : 'rgba(255,255,255,0.03)'}
        stroke={isSelected ? '#818cf8' : zoneStyle.stroke}
        strokeWidth={isSelected ? 2 : 1}
        strokeDasharray={isApplied ? 'none' : '3,2'}
      />

      {/* Reference text */}
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={isSelected ? '#c7d2fe' : '#9ca3af'}
        fontSize={7}
        fontFamily="monospace"
      >
        {suggestion.component_ref}
      </text>

      {/* Rotation indicator */}
      {suggestion.suggested_rotation !== 0 && (
        <text
          x={cx + 14}
          y={cy - 6}
          fill="#6b7280"
          fontSize={5}
          fontFamily="monospace"
        >
          {suggestion.suggested_rotation}deg
        </text>
      )}

      {/* Improvement score badge */}
      <circle
        cx={cx + 12}
        cy={cy - 8}
        r={5}
        fill={suggestion.improvement_score > 0.7 ? '#22c55e' : suggestion.improvement_score > 0.4 ? '#eab308' : '#ef4444'}
        opacity={0.8}
      />
      <text
        x={cx + 12}
        y={cy - 7}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={4}
        fontWeight="bold"
      >
        {Math.round(suggestion.improvement_score * 100)}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PlacementPreview() {
  const placementResult = useRoutingStore((s) => s.placementResult);
  const placementPhase = useRoutingStore((s) => s.placementPhase);
  const appliedSuggestions = useRoutingStore((s) => s.appliedSuggestions);
  const applyPlacementSuggestion = useRoutingStore((s) => s.applyPlacementSuggestion);
  const applyAllSuggestions = useRoutingStore((s) => s.applyAllSuggestions);
  const commitPlacement = useRoutingStore((s) => s.commitPlacement);
  const clearPlacement = useRoutingStore((s) => s.clearPlacement);
  const loadPlacementSuggestions = useRoutingStore((s) => s.loadPlacementSuggestions);
  const currentProject = useProjectStore((s) => s.currentProject);
  const advanceStage = useWorkflowStore((s) => s.advanceStage);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 600, height: 400 });
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [adjustedPositions, setAdjustedPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Compute scale and offset
  const { scale, offsetX, offsetY, zones } = useMemo(() => {
    if (!placementResult || placementResult.suggestions.length === 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, zones: [] };
    }

    const suggestions = placementResult.suggestions.map((s) => ({
      ...s,
      suggested_x: adjustedPositions[s.component_ref]?.x ?? s.suggested_x,
      suggested_y: adjustedPositions[s.component_ref]?.y ?? s.suggested_y,
    }));

    const xs = suggestions.map((s) => s.suggested_x);
    const ys = suggestions.map((s) => s.suggested_y);
    const minX = Math.min(...xs) - 10;
    const minY = Math.min(...ys) - 10;
    const maxX = Math.max(...xs) + 10;
    const maxY = Math.max(...ys) + 10;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const sc = Math.min((containerSize.width - 40) / spanX, (containerSize.height - 40) / spanY, 8);

    return {
      scale: sc,
      offsetX: (containerSize.width - spanX * sc) / 2 - minX * sc,
      offsetY: (containerSize.height - spanY * sc) / 2 - minY * sc,
      zones: buildZones(suggestions),
    };
  }, [placementResult, adjustedPositions, containerSize]);

  const handleDragEnd = useCallback((ref: string, x: number, y: number) => {
    setAdjustedPositions((prev) => ({ ...prev, [ref]: { x, y } }));
  }, []);

  const handleAcceptAll = useCallback(() => {
    if (!currentProject) return;
    applyAllSuggestions();
    commitPlacement(currentProject.id);
    advanceStage();
  }, [currentProject, applyAllSuggestions, commitPlacement, advanceStage]);

  const handleRerun = useCallback(() => {
    if (!currentProject) return;
    setAdjustedPositions({});
    loadPlacementSuggestions(currentProject.id, 'routing');
  }, [currentProject, loadPlacementSuggestions]);

  const handleReject = useCallback(() => {
    clearPlacement();
    setAdjustedPositions({});
  }, [clearPlacement]);

  // ---------------------------------------------------------------------------
  // No data state
  // ---------------------------------------------------------------------------

  if (!placementResult) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center">
          <Move className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p>No placement data. Run AI auto-placement first.</p>
        </div>
      </div>
    );
  }

  const isApplying = placementPhase === 'applying';

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-brand-400" />
          <span className="text-xs font-semibold text-gray-200">
            Placement Preview
          </span>
          <span className="text-[10px] text-gray-500">
            {placementResult.suggestions.length} components
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-500">
            Est. improvement: <span className="text-emerald-400 font-medium">{placementResult.estimated_improvement.toFixed(0)}%</span>
          </span>
        </div>
      </div>

      {/* Zone legend */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-gray-800/50 overflow-x-auto">
        {Object.entries(ZONE_COLORS).map(([key, val]) => {
          const count = zones.find((z) => z.name === key)?.components.length ?? 0;
          if (count === 0) return null;
          return (
            <div key={key} className="flex items-center gap-1 shrink-0">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: val.stroke }} />
              <span className="text-[9px] text-gray-400">{val.label} ({count})</span>
            </div>
          );
        })}
      </div>

      {/* SVG canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-950">
        <svg width={containerSize.width} height={containerSize.height} className="absolute inset-0">
          {/* Zone boundaries */}
          {zones.map((zone) => {
            const zs = ZONE_COLORS[zone.color] || ZONE_COLORS.digital;
            return (
              <g key={zone.name}>
                <rect
                  x={zone.bounds.x * scale + offsetX}
                  y={zone.bounds.y * scale + offsetY}
                  width={zone.bounds.width * scale}
                  height={zone.bounds.height * scale}
                  fill={zs.fill}
                  stroke={zs.stroke}
                  strokeWidth={1}
                  strokeDasharray="6,3"
                  rx={4}
                />
                <text
                  x={zone.bounds.x * scale + offsetX + 4}
                  y={zone.bounds.y * scale + offsetY + 10}
                  fill={zs.stroke}
                  fontSize={8}
                  fontFamily="sans-serif"
                  opacity={0.8}
                >
                  {ZONE_COLORS[zone.color]?.label || zone.name}
                </text>
              </g>
            );
          })}

          {/* Critical pair connections (dotted lines between nearby components) */}
          {placementResult.suggestions.map((s, i) => {
            // Draw lines to the next suggestion in the same zone for visual effect
            const zone = classifyComponent(s.component_ref, s.reason);
            const next = placementResult.suggestions.find(
              (other, j) => j > i && classifyComponent(other.component_ref, other.reason) === zone,
            );
            if (!next) return null;
            const sx = (adjustedPositions[s.component_ref]?.x ?? s.suggested_x) * scale + offsetX;
            const sy = (adjustedPositions[s.component_ref]?.y ?? s.suggested_y) * scale + offsetY;
            const ex = (adjustedPositions[next.component_ref]?.x ?? next.suggested_x) * scale + offsetX;
            const ey = (adjustedPositions[next.component_ref]?.y ?? next.suggested_y) * scale + offsetY;
            const dist = Math.sqrt((s.suggested_x - next.suggested_x) ** 2 + (s.suggested_y - next.suggested_y) ** 2);

            return (
              <g key={`conn-${i}`}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke="rgba(156,163,175,0.2)"
                  strokeWidth={0.5}
                  strokeDasharray="2,2"
                />
                <text
                  x={(sx + ex) / 2}
                  y={(sy + ey) / 2 - 3}
                  fill="rgba(156,163,175,0.4)"
                  fontSize={5}
                  textAnchor="middle"
                >
                  {dist.toFixed(1)}mm
                </text>
              </g>
            );
          })}

          {/* Component rectangles */}
          {placementResult.suggestions.map((s) => (
            <DraggableComponent
              key={s.component_ref}
              suggestion={{
                ...s,
                suggested_x: adjustedPositions[s.component_ref]?.x ?? s.suggested_x,
                suggested_y: adjustedPositions[s.component_ref]?.y ?? s.suggested_y,
              }}
              scale={scale}
              offsetX={offsetX}
              offsetY={offsetY}
              isSelected={selectedRef === s.component_ref}
              isApplied={appliedSuggestions.has(s.component_ref)}
              onSelect={setSelectedRef}
              onDragEnd={handleDragEnd}
            />
          ))}
        </svg>

        {/* Selected component info overlay */}
        {selectedRef && (() => {
          const s = placementResult.suggestions.find((sg) => sg.component_ref === selectedRef);
          if (!s) return null;
          return (
            <div className="absolute top-3 left-3 bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 text-xs max-w-64">
              <div className="font-semibold text-gray-200 mb-1">{s.component_ref}</div>
              <div className="text-gray-400 text-[10px] leading-relaxed">{s.reason}</div>
              {s.citation && (
                <div className="text-gray-500 text-[9px] mt-1 italic">{s.citation}</div>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                <span>X: {(adjustedPositions[s.component_ref]?.x ?? s.suggested_x).toFixed(2)}</span>
                <span>Y: {(adjustedPositions[s.component_ref]?.y ?? s.suggested_y).toFixed(2)}</span>
                <span>Rot: {s.suggested_rotation}</span>
                <span className={`font-medium ${s.improvement_score > 0.7 ? 'text-emerald-400' : s.improvement_score > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                  Score: {Math.round(s.improvement_score * 100)}%
                </span>
              </div>
              <button
                onClick={() => applyPlacementSuggestion(s.component_ref)}
                className={`mt-2 w-full text-[10px] py-1 rounded transition-colors ${
                  appliedSuggestions.has(s.component_ref)
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {appliedSuggestions.has(s.component_ref) ? 'Applied' : 'Apply This Suggestion'}
              </button>
            </div>
          );
        })()}
      </div>

      {/* Action bar */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-gray-800 bg-gray-900/50">
        <button
          onClick={handleRerun}
          disabled={isApplying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" />
          Re-run
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReject}
            disabled={isApplying}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-red-900/20 transition-colors disabled:opacity-50"
          >
            <X className="w-3 h-3" />
            Reject
          </button>
          <button
            onClick={handleAcceptAll}
            disabled={isApplying}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-3 h-3" />
                Accept All
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
