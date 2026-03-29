import { useProjectStore } from '../../stores/projectStore';
import { useAuthStore } from '../../stores/authStore';
import { Wifi, WifiOff, Cpu, Layers, MousePointer, Crosshair } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function StatusBar() {
  const boardData = useProjectStore((s) => s.boardData);
  const currentProject = useProjectStore((s) => s.currentProject);
  const selectedElementId = useProjectStore((s) => s.selectedElementId);
  const selectedElementType = useProjectStore((s) => s.selectedElementType);
  const highlightedNetId = useProjectStore((s) => s.highlightedNetId);
  const reviewResult = useProjectStore((s) => s.reviewResult);
  const user = useAuthStore((s) => s.user);

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setCursorPos(e.detail);
    };
    window.addEventListener('pcb-cursor-move' as any, handler);
    return () => window.removeEventListener('pcb-cursor-move' as any, handler);
  }, []);

  // Safe access: support both {metadata: {layerCount}} and {layers: [...]} formats
  const layerCount = boardData?.metadata?.layerCount ?? boardData?.layers?.length ?? 0;
  const componentCount = boardData?.metadata?.componentCount ?? boardData?.components?.length ?? 0;
  const netCount = boardData?.nets?.length ?? 0;
  const viaCount = boardData?.vias?.length ?? 0;
  const boardWidth = boardData?.metadata?.boardWidth ?? boardData?.width ?? 0;
  const boardHeight = boardData?.metadata?.boardHeight ?? boardData?.height ?? 0;
  const units = boardData?.metadata?.units ?? 'mm';

  return (
    <footer className="h-6 bg-gray-900 border-t border-gray-800 flex items-center justify-between px-3 text-[10px] text-gray-600 shrink-0 select-none">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {isOnline ? (
            <>
              <Wifi className="w-3 h-3 text-emerald-500" />
              <span>Connected</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-red-400" />
              <span className="text-red-400">Offline</span>
            </>
          )}
        </div>

        <div className="w-px h-3 bg-gray-800" />

        {boardData && (
          <>
            <div className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              <span>{layerCount} layers</span>
            </div>

            <div className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              <span>{componentCount} components</span>
            </div>

            <span>{netCount} nets</span>
            <span>{viaCount} vias</span>
          </>
        )}
      </div>

      {/* Center: cursor position */}
      <div className="flex items-center gap-3">
        {cursorPos && (
          <div className="flex items-center gap-1">
            <Crosshair className="w-3 h-3" />
            <span>
              X: {cursorPos.x.toFixed(2)} Y: {cursorPos.y.toFixed(2)}
            </span>
          </div>
        )}

        {selectedElementId && (
          <div className="flex items-center gap-1">
            <MousePointer className="w-3 h-3 text-brand-400" />
            <span className="text-brand-400">
              {selectedElementType}: {selectedElementId}
            </span>
          </div>
        )}

        {highlightedNetId && boardData && (
          <span className="text-yellow-500">
            Net: {boardData.nets?.find((n: any) => n.id === highlightedNetId)?.name ?? highlightedNetId}
          </span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {reviewResult && (
          <span>
            Score: {(reviewResult as any).score ?? 0}/100 | {(reviewResult as any).totalIssues ?? 0} issues
          </span>
        )}

        {currentProject && (
          <span className="uppercase">{(currentProject as any).format ?? 'kicad'}</span>
        )}

        {boardData && boardWidth > 0 && (
          <span>
            {boardWidth.toFixed(1)}x{boardHeight.toFixed(1)} {units}
          </span>
        )}

        {user && (
          <span className="capitalize">{user.tier}</span>
        )}
      </div>
    </footer>
  );
}
