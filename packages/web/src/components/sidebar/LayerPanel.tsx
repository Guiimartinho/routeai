import { useProjectStore } from '../../stores/projectStore';
import { LAYER_COLORS } from '../pcb/PCBRenderer';
import { Eye, EyeOff, ToggleLeft, ToggleRight } from 'lucide-react';

const layerTypeLabels: Record<string, string> = {
  copper: 'Copper',
  mask: 'Solder Mask',
  paste: 'Solder Paste',
  silkscreen: 'Silkscreen',
  courtyard: 'Courtyard',
  fabrication: 'Fabrication',
  edge: 'Board Edge',
  user: 'User',
};

export default function LayerPanel() {
  const boardData = useProjectStore((s) => s.boardData);
  const layerVisibility = useProjectStore((s) => s.layerVisibility);
  const setLayerVisibility = useProjectStore((s) => s.setLayerVisibility);
  const toggleAllLayers = useProjectStore((s) => s.toggleAllLayers);

  if (!boardData) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No board data loaded.
      </div>
    );
  }

  const layers = boardData.layers || [];
  const allVisible = Object.values(layerVisibility).every(Boolean);

  // Group layers by type
  const grouped: Record<string, typeof layers> = {};
  for (const layer of layers) {
    const key = layer.type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(layer);
  }

  return (
    <div className="p-2">
      {/* Toggle all */}
      <div className="flex items-center justify-between px-2 py-1.5 mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Layers ({layers.length})
        </span>
        <button
          onClick={() => toggleAllLayers(!allVisible)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          title={allVisible ? 'Hide all' : 'Show all'}
        >
          {allVisible ? (
            <>
              <ToggleRight className="w-3.5 h-3.5 text-brand-400" />
              All
            </>
          ) : (
            <>
              <ToggleLeft className="w-3.5 h-3.5" />
              All
            </>
          )}
        </button>
      </div>

      {/* Layer groups */}
      {Object.entries(grouped).map(([type, layerGroup]) => (
        <div key={type} className="mb-3">
          <div className="px-2 py-1 text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
            {layerTypeLabels[type] ?? type}
          </div>
          <div className="space-y-px">
            {layerGroup.map((layer) => {
              const visible = layerVisibility[layer.id] !== false;
              const color = LAYER_COLORS[layer.name] ?? layer.color ?? '#888888';

              return (
                <button
                  key={layer.id}
                  onClick={() => setLayerVisibility(layer.id, !visible)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                    visible
                      ? 'text-gray-200 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-gray-800/50'
                  }`}
                >
                  {/* Color swatch */}
                  <div
                    className="w-3 h-3 rounded-sm shrink-0 border border-gray-700"
                    style={{
                      backgroundColor: visible ? color : 'transparent',
                      borderColor: color,
                    }}
                  />

                  {/* Layer name */}
                  <span className="flex-1 text-left text-xs truncate">
                    {layer.name}
                  </span>

                  {/* Visibility icon */}
                  {visible ? (
                    <Eye className="w-3 h-3 text-gray-500 shrink-0" />
                  ) : (
                    <EyeOff className="w-3 h-3 text-gray-700 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
