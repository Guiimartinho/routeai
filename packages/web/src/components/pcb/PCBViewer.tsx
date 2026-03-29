import { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import type { BoardData } from '../../types/board';
import { useProjectStore } from '../../stores/projectStore';
import {
  createTraceGeometry,
  createPadGeometry,
  createViaGeometry,
  createZoneGeometry,
  createOutlineGeometry,
  createSilkscreenGeometry,
  createAnnotationMarkers,
  createBoardBackground,
  createGrid,
  LAYER_COLORS,
} from './PCBRenderer';
import { ZoomIn, ZoomOut, Maximize2, MousePointer } from 'lucide-react';

interface PCBViewerProps {
  boardData: BoardData;
}

/** Inner Three.js scene component */
function PCBScene({ boardData }: { boardData: BoardData }) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const highlightGroupRef = useRef<THREE.Group>(null);

  const layerVisibility = useProjectStore((s) => s.layerVisibility);
  const highlightedNetId = useProjectStore((s) => s.highlightedNetId);
  const reviewResult = useProjectStore((s) => s.reviewResult);
  const setSelectedElement = useProjectStore((s) => s.setSelectedElement);
  const viewerCenter = useProjectStore((s) => s.viewerCenter);
  const viewerZoom = useProjectStore((s) => s.viewerZoom);

  // Safe array fallbacks for all collections
  const layers = boardData?.layers || [];
  const traces = boardData?.traces || [];
  const pads = boardData?.pads || [];
  const vias = boardData?.vias || [];
  const zones = boardData?.zones || [];
  const outline = boardData?.outline || [];
  const silkscreen = boardData?.silkscreen || [];
  const nets = boardData?.nets || [];
  const components = boardData?.components || [];

  // Safe metadata access: support both {metadata: {boardWidth}} and {width} formats
  const boardWidth = (boardData?.metadata?.boardWidth ?? (boardData as any)?.width ?? 100);
  const boardHeight = (boardData?.metadata?.boardHeight ?? (boardData as any)?.height ?? 100);
  const units = (boardData?.metadata?.units ?? 'mm');
  const layerCount = (boardData?.metadata?.layerCount ?? boardData?.layers?.length ?? 0);
  const componentCount = (boardData?.metadata?.componentCount ?? boardData?.components?.length ?? 0);

  // Center of board
  const centerX = boardWidth / 2;
  const centerY = boardHeight / 2;

  // Build scene groups once
  const sceneGroups = useMemo(() => {
    const groups: { id: string; group: THREE.Group | THREE.Mesh }[] = [];

    // Board background
    groups.push({
      id: '__board_bg',
      group: createBoardBackground(boardWidth, boardHeight, centerX, centerY),
    });

    // Grid
    const gridSpacing = boardWidth > 100 ? 10 : boardWidth > 50 ? 5 : 2.54;
    groups.push({
      id: '__grid',
      group: createGrid(boardWidth * 1.5, boardHeight * 1.5, gridSpacing, centerX, centerY),
    });

    // Determine which layers are copper-like (type can be 'copper', 'signal', 'power', 'mixed')
    const copperTypes = new Set(['copper', 'signal', 'power', 'mixed']);
    const silkTypes = new Set(['silkscreen', 'user']);
    const copperLayers = layers.filter((l: any) => copperTypes.has(l?.type) || l?.name?.includes('.Cu'));
    const silkLayers = layers.filter((l: any) => silkTypes.has(l?.type) || l?.name?.includes('Silk'));

    // Zones (drawn first, underneath)
    if (zones.length > 0) {
      const color = LAYER_COLORS['F.Cu'] ?? '#ff4444';
      groups.push({ id: 'zone_all', group: createZoneGeometry(zones, '', color) });
    }

    // Traces — render ALL at once (backend uses layer_id numbers, not names)
    if (traces.length > 0) {
      const color = copperLayers[0]?.color ?? LAYER_COLORS['F.Cu'] ?? '#ff4444';
      groups.push({ id: 'trace_all', group: createTraceGeometry(traces, '', color) });
    }

    // Pads — render ALL at once
    if (pads.length > 0) {
      groups.push({ id: 'pad_all', group: createPadGeometry(pads, '') });
    }

    // Vias
    if (vias.length > 0) {
      groups.push({ id: '__vias', group: createViaGeometry(vias) });
    }

    // Silkscreen
    if (silkscreen.length > 0) {
      for (const layer of silkLayers) {
        groups.push({ id: `silk_${layer?.id}`, group: createSilkscreenGeometry(silkscreen, layer?.name) });
      }
    }

    // Board outline
    groups.push({ id: '__outline', group: createOutlineGeometry(outline) });

    // Annotations
    if (reviewResult?.items) {
      groups.push({ id: '__annotations', group: createAnnotationMarkers(reviewResult.items) });
    }

    return groups;
  }, [boardData, reviewResult, boardWidth, boardHeight, layers, traces, pads, vias, zones, outline, silkscreen, centerX, centerY]);

  // Apply layer visibility
  useEffect(() => {
    if (!groupRef.current) return;

    for (const child of groupRef.current.children) {
      const name = child.name || '';

      // Match layer-based groups
      for (const layer of layers) {
        if (layer?.id && name.includes(layer.id)) {
          child.visible = layerVisibility[layer.id] !== false;
        }
      }

      // Vias are always visible unless all copper layers are hidden
      if (name === 'vias') {
        const anyCopper = layers
          .filter((l) => l?.type === 'copper')
          .some((l) => l?.id && layerVisibility[l.id] !== false);
        child.visible = anyCopper;
      }
    }
  }, [layerVisibility, layers]);

  // Highlight net
  useEffect(() => {
    if (!highlightGroupRef.current) return;
    // Clear old highlights
    while (highlightGroupRef.current.children.length > 0) {
      highlightGroupRef.current.remove(highlightGroupRef.current.children[0]);
    }

    if (!highlightedNetId || !groupRef.current) return;

    // Traverse all meshes, dim non-net elements
    groupRef.current.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
        const netId = obj.userData?.netId;
        if (netId) {
          if (netId === highlightedNetId) {
            obj.material.opacity = 1.0;
          } else {
            obj.material.opacity = 0.15;
          }
        }
      }
    });

    return () => {
      // Reset opacities
      groupRef.current?.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
          if (obj.userData?.netId) {
            obj.material.opacity = obj.userData?.type === 'zone' ? 0.2 : 0.85;
          }
        }
      });
    };
  }, [highlightedNetId]);

  // Animate annotation pulse
  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.elapsedTime;
    groupRef.current.traverse((obj) => {
      if (obj.userData?.pulse) {
        const scale = 1 + Math.sin(time * 3) * 0.15;
        obj.scale.set(scale, scale, 1);
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial) {
          obj.material.opacity = 0.1 + Math.sin(time * 3) * 0.05;
        }
      }
    });
  });

  // Navigate to location
  useEffect(() => {
    if (viewerCenter && camera) {
      camera.position.set(viewerCenter.x, viewerCenter.y, camera.position.z);
      if ('zoom' in camera) {
        (camera as THREE.OrthographicCamera).zoom = viewerZoom;
        camera.updateProjectionMatrix();
      }
    }
  }, [viewerCenter, viewerZoom, camera]);

  // Set initial camera position
  useEffect(() => {
    if (camera) {
      camera.position.set(centerX, centerY, 100);
      if ('zoom' in camera) {
        const ortho = camera as THREE.OrthographicCamera;
        const maxDim = Math.max(boardWidth, boardHeight);
        ortho.zoom = maxDim > 0 ? 300 / maxDim : 5;
        ortho.updateProjectionMatrix();
      }
    }
  }, [camera, boardWidth, boardHeight, centerX, centerY]);

  // Click handler
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const obj = e.object;
      if (obj.userData?.type) {
        setSelectedElement(obj.userData?.id, obj.userData?.type);
      }
    },
    [setSelectedElement]
  );

  // Background click to deselect
  const handleBackgroundClick = useCallback(() => {
    setSelectedElement(null, null);
  }, [setSelectedElement]);

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={1} />

      {/* Main board group */}
      <group ref={groupRef} onClick={handleClick}>
        {sceneGroups.map(({ id, group }) => (
          <primitive key={id} object={group} />
        ))}
      </group>

      {/* Highlight overlay */}
      <group ref={highlightGroupRef} />

      {/* Invisible background plane for deselect */}
      <mesh
        position={[centerX, centerY, -1]}
        onClick={handleBackgroundClick}
      >
        <planeGeometry args={[boardWidth * 5, boardHeight * 5]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </>
  );
}

/** Main PCBViewer component */
export default function PCBViewer({ boardData }: PCBViewerProps) {
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);
  const selectedElementId = useProjectStore((s) => s.selectedElementId);
  const selectedElementType = useProjectStore((s) => s.selectedElementType);

  // Safe metadata access: support both {metadata: {boardWidth}} and {width} formats
  const boardWidth = (boardData?.metadata?.boardWidth ?? (boardData as any)?.width ?? 100);
  const boardHeight = (boardData?.metadata?.boardHeight ?? (boardData as any)?.height ?? 100);
  const units = (boardData?.metadata?.units ?? 'mm');
  const layerCount = (boardData?.metadata?.layerCount ?? boardData?.layers?.length ?? 0);
  const componentCount = (boardData?.metadata?.componentCount ?? boardData?.components?.length ?? 0);
  const maxDim = Math.max(boardWidth, boardHeight) || 100;
  const frustum = maxDim * 2;

  // Safe array fallbacks
  const layers = boardData?.layers || [];
  const components = boardData?.components || [];
  const nets = boardData?.nets || [];

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useProjectStore.getState().setSelectedElement(null, null);
        useProjectStore.getState().setHighlightedNet(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleZoomIn = () => {
    useProjectStore.getState().navigateTo(
      useProjectStore.getState().viewerCenter?.x ?? boardWidth / 2,
      useProjectStore.getState().viewerCenter?.y ?? boardHeight / 2,
      (useProjectStore.getState().viewerZoom || 1) * 1.5
    );
  };

  const handleZoomOut = () => {
    useProjectStore.getState().navigateTo(
      useProjectStore.getState().viewerCenter?.x ?? boardWidth / 2,
      useProjectStore.getState().viewerCenter?.y ?? boardHeight / 2,
      (useProjectStore.getState().viewerZoom || 1) / 1.5
    );
  };

  const handleFit = () => {
    useProjectStore.getState().navigateTo(
      boardWidth / 2,
      boardHeight / 2,
      300 / maxDim
    );
  };

  return (
    <div className="relative w-full h-full">
      <Canvas
        orthographic
        gl={{ antialias: true, alpha: false }}
        onPointerMissed={() => {
          useProjectStore.getState().setSelectedElement(null, null);
        }}
        onPointerMove={(e) => {
          // We could do raycasting for hover info here
        }}
      >
        <OrthographicCamera
          makeDefault
          position={[boardWidth / 2, boardHeight / 2, 100]}
          zoom={300 / maxDim}
          near={0.1}
          far={1000}
        />
        <MapControls
          enableRotate={false}
          enableDamping
          dampingFactor={0.1}
          minZoom={0.5}
          maxZoom={200}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />
        <PCBScene boardData={boardData} />
      </Canvas>

      {/* Zoom controls overlay */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        <button
          onClick={handleZoomIn}
          className="p-2 bg-gray-800/80 hover:bg-gray-700/80 rounded-lg border border-gray-700/50 text-gray-300 hover:text-white backdrop-blur-sm transition-colors"
          title="Zoom in (scroll up)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 bg-gray-800/80 hover:bg-gray-700/80 rounded-lg border border-gray-700/50 text-gray-300 hover:text-white backdrop-blur-sm transition-colors"
          title="Zoom out (scroll down)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleFit}
          className="p-2 bg-gray-800/80 hover:bg-gray-700/80 rounded-lg border border-gray-700/50 text-gray-300 hover:text-white backdrop-blur-sm transition-colors"
          title="Fit to screen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Selection info overlay */}
      {selectedElementId && (
        <div className="absolute top-4 left-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <MousePointer className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-gray-400 capitalize">{selectedElementType}:</span>
            <span className="text-gray-200 font-mono text-xs">{selectedElementId}</span>
          </div>
        </div>
      )}

      {/* Board info overlay */}
      <div className="absolute top-4 right-4 bg-gray-900/70 backdrop-blur-sm border border-gray-700/50 rounded-lg px-2.5 py-1.5 text-xs text-gray-500">
        {boardWidth.toFixed(1)} x {boardHeight.toFixed(1)} {units}
      </div>
    </div>
  );
}
