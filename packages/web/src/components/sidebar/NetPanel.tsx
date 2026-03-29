import { useState, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { Search, Zap } from 'lucide-react';

export default function NetPanel() {
  const boardData = useProjectStore((s) => s.boardData);
  const highlightedNetId = useProjectStore((s) => s.highlightedNetId);
  const setHighlightedNet = useProjectStore((s) => s.setHighlightedNet);
  const [search, setSearch] = useState('');

  const nets = boardData?.nets ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return nets;
    const q = search.toLowerCase();
    return nets.filter(
      (n) =>
        (n.name ?? '').toLowerCase().includes(q) ||
        String(n.id).toLowerCase().includes(q) ||
        (n.class ?? '').toLowerCase().includes(q)
    );
  }, [nets, search]);

  if (!boardData) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No board data loaded.
      </div>
    );
  }

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
            placeholder="Search nets..."
            className="input-field text-xs pl-8 py-1.5"
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-600">
          <span>{filtered.length} nets</span>
          {highlightedNetId && (
            <button
              onClick={() => setHighlightedNet(null)}
              className="text-brand-400 hover:text-brand-300"
            >
              Clear highlight
            </button>
          )}
        </div>
      </div>

      {/* Net list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-600">
            {search ? 'No matching nets found.' : 'No nets in board.'}
          </div>
        ) : (
          <div className="py-1">
            {filtered.map((net) => {
              const isHighlighted = highlightedNetId === net.id;
              const connectionCount = (net.padIds ?? []).length;
              const traceCount = (net.traceIds ?? []).length;

              return (
                <button
                  key={net.id}
                  onClick={() => setHighlightedNet(isHighlighted ? null : net.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    isHighlighted
                      ? 'bg-brand-600/20 text-brand-300'
                      : 'text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <Zap
                    className={`w-3 h-3 shrink-0 ${
                      isHighlighted ? 'text-brand-400' : 'text-gray-600'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {net.name || `Net ${net.id}`}
                    </div>
                    {net.class && net.class !== 'Default' && (
                      <div className="text-[10px] text-gray-600 truncate">{net.class}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-600 shrink-0 text-right">
                    <div>{connectionCount} pads</div>
                    <div>{traceCount} traces</div>
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
