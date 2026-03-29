import { useState, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Search, Cpu, MapPin } from 'lucide-react';

const LAYER_NAMES: Record<number, string> = {
  0: 'F',
  31: 'B',
};

function getLayerLabel(comp: Record<string, unknown>): string {
  if (typeof comp.layer === 'string') return comp.layer.replace('.Cu', '');
  if (typeof comp.layer_id === 'number') return LAYER_NAMES[comp.layer_id] ?? `L${comp.layer_id}`;
  return '?';
}

export default function ComponentPanel() {
  const boardData = useProjectStore((s) => s.boardData);
  const setSelectedElement = useProjectStore((s) => s.setSelectedElement);
  const navigateTo = useProjectStore((s) => s.navigateTo);
  const selectedElementId = useProjectStore((s) => s.selectedElementId);
  const [search, setSearch] = useState('');

  const components = boardData?.components ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return components;
    const q = search.toLowerCase();
    return components.filter((c) => {
      const ref = (c.reference ?? '').toLowerCase();
      const val = (c.value ?? '').toLowerCase();
      const fp = (c.footprint ?? '').toLowerCase();
      const desc = (c.description ?? '').toLowerCase();
      return ref.includes(q) || val.includes(q) || fp.includes(q) || desc.includes(q);
    });
  }, [components, search]);

  // Sort: by reference designator
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aRef = a.reference ?? '';
      const bRef = b.reference ?? '';
      const aPrefix = aRef.replace(/[0-9]/g, '');
      const bPrefix = bRef.replace(/[0-9]/g, '');
      if (aPrefix !== bPrefix) return aPrefix.localeCompare(bPrefix);
      const aNum = parseInt(aRef.replace(/[^0-9]/g, ''), 10) || 0;
      const bNum = parseInt(bRef.replace(/[^0-9]/g, ''), 10) || 0;
      return aNum - bNum;
    });
  }, [filtered]);

  if (!boardData) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No board data loaded.
      </div>
    );
  }

  const handleClick = (ref: string, x: number, y: number) => {
    setSelectedElement(ref, 'component');
    navigateTo(x, y, 20);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-gray-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search components..."
            className="input-field text-xs pl-8 py-1.5"
          />
        </div>
        <div className="mt-1.5 text-[10px] text-gray-600">
          {filtered.length} of {components.length} components
        </div>
      </div>

      {/* Component list */}
      <div className="flex-1 overflow-auto">
        {sorted.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-600">
            {search ? 'No matching components found.' : 'No components in board.'}
          </div>
        ) : (
          <div className="py-1">
            {sorted.map((comp) => {
              const compId = comp.id ?? comp.reference ?? '';
              const isSelected = selectedElementId === compId;
              const x = comp.x ?? comp.position?.x ?? 0;
              const y = comp.y ?? comp.position?.y ?? 0;

              return (
                <button
                  key={compId}
                  onClick={() => handleClick(compId, x, y)}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-brand-600/20 text-brand-300'
                      : 'text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <Cpu
                    className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                      isSelected ? 'text-brand-400' : 'text-gray-600'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{comp.reference ?? '??'}</span>
                      <span className="text-xs text-gray-500">{comp.value ?? ''}</span>
                    </div>
                    <div className="text-[10px] text-gray-600 truncate">{comp.footprint ?? ''}</div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-600 shrink-0">
                    <MapPin className="w-2.5 h-2.5" />
                    <span className="uppercase text-[9px]">{getLayerLabel(comp)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
