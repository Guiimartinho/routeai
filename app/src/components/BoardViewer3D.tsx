// ─── 3D PCB Board Viewer ─────────────────────────────────────────────────────
// Three.js-based 3D viewer for PCB board data using react-three-fiber.
// Renders board body, components, traces, vias, and copper zones from projectStore.

import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useProjectStore } from '../store/projectStore';
import { theme } from '../styles/theme';
import type { BrdComponent, BrdTrace, BrdVia, BrdZone, BoardOutline, Point } from '../types';

// ─── Constants ──────────────────────────────────────────────────────────────

const BOARD_THICKNESS = 1.6;       // mm (FR4 default)
const COPPER_THICKNESS = 0.035;    // mm
const SOLDER_MASK_OFFSET = 0.02;   // mm
const MM_TO_UNIT = 1;              // 1:1 mapping (mm)

// ─── Footprint category detection ────────────────────────────────────────────

type FootprintCategory =
  | 'chip_passive'   // 0402/0603/0805/1206 resistors/capacitors
  | 'sot'            // SOT-23, SOT-223
  | 'soic'           // SOIC-8/16, TSSOP
  | 'qfp'            // QFP/LQFP/TQFP
  | 'qfn'            // QFN/DFN
  | 'bga'            // BGA
  | 'dip'            // DIP through-hole
  | 'connector'      // Connectors/headers
  | 'electrolytic'   // Electrolytic capacitors
  | 'crystal'        // Crystals/oscillators
  | 'led'            // LEDs
  | 'generic';       // Fallback

function classifyFootprint(footprint: string): FootprintCategory {
  const fp = footprint.toLowerCase();
  if (/0402|0603|0805|0201|1206|1210|chip|r_|c_/.test(fp)) return 'chip_passive';
  if (/sot[-_]?23|sot[-_]?223|sot[-_]?89/.test(fp)) return 'sot';
  if (/soic|ssop|tssop|msop/.test(fp)) return 'soic';
  if (/qfp|lqfp|tqfp/.test(fp)) return 'qfp';
  if (/qfn|dfn/.test(fp)) return 'qfn';
  if (/bga|csp|wlcsp/.test(fp)) return 'bga';
  if (/dip|pdip|sip/.test(fp)) return 'dip';
  if (/connector|header|jst|molex|usb|rj45|barrel/.test(fp)) return 'connector';
  if (/electrolytic|cp_|elec|polarized/.test(fp)) return 'electrolytic';
  if (/crystal|xtal|osc/.test(fp)) return 'crystal';
  if (/led|diode_led/.test(fp)) return 'led';
  return 'generic';
}

function getComponentHeight(footprint: string): number {
  switch (classifyFootprint(footprint)) {
    case 'chip_passive': return 0.5;
    case 'sot': return 1.2;
    case 'soic': return 1.5;
    case 'qfp': return 1.8;
    case 'qfn': return 0.8;
    case 'bga': return 1.2;
    case 'dip': return 3.0;
    case 'connector': return 6.0;
    case 'electrolytic': return 5.0;
    case 'crystal': return 2.0;
    case 'led': return 1.0;
    default: return 2.0;
  }
}

// ─── Via layer index for computing partial spans ─────────────────────────────

const LAYER_ORDER = ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu'];

function layerIndex(layer: string): number {
  const idx = LAYER_ORDER.indexOf(layer);
  return idx >= 0 ? idx : 0;
}

// ─── Via color by type ──────────────────────────────────────────────────────

function viaColor(viaType: string): string {
  switch (viaType) {
    case 'blind': return '#d4a017';    // gold
    case 'buried': return '#8844cc';   // purple
    case 'micro': return '#17d4c4';    // cyan
    default: return '#b87333';         // copper (through)
  }
}

// ─── Get component body dimensions from footprint ───────────────────────────

function getComponentSize(comp: BrdComponent): { w: number; h: number } {
  if (comp.pads.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const pad of comp.pads) {
      minX = Math.min(minX, pad.x - pad.width / 2);
      maxX = Math.max(maxX, pad.x + pad.width / 2);
      minY = Math.min(minY, pad.y - pad.height / 2);
      maxY = Math.max(maxY, pad.y + pad.height / 2);
    }
    return { w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
  }
  return { w: 3, h: 2 };
}

// ─── Layer color map ────────────────────────────────────────────────────────

const LAYER_COLORS: Record<string, string> = {
  'F.Cu': '#cc3333',
  'B.Cu': '#3344cc',
  'In1.Cu': '#33aa33',
  'In2.Cu': '#aaaa33',
  'In3.Cu': '#aa33aa',
  'In4.Cu': '#33aaaa',
};

function layerColor(layer: string): string {
  return LAYER_COLORS[layer] || '#cc8833';
}

// ─── Compute board center and bounds ────────────────────────────────────────

function boardBounds(outline: BoardOutline): { cx: number; cy: number; width: number; height: number } {
  if (outline.points.length === 0) return { cx: 50, cy: 40, width: 100, height: 80 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outline.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ─── Board Body Mesh ────────────────────────────────────────────────────────

const BoardBody: React.FC<{
  outline: BoardOutline;
  xray: boolean;
}> = React.memo(({ outline, xray }) => {
  const geometry = useMemo(() => {
    if (outline.points.length < 3) {
      return new THREE.BoxGeometry(100, BOARD_THICKNESS, 80);
    }
    const shape = new THREE.Shape();
    shape.moveTo(outline.points[0].x, -outline.points[0].y);
    for (let i = 1; i < outline.points.length; i++) {
      shape.lineTo(outline.points[i].x, -outline.points[i].y);
    }
    shape.closePath();
    const extrudeSettings = { depth: BOARD_THICKNESS, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Rotate so Z is up
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outline]);

  return (
    <mesh geometry={geometry} position={[0, 0, 0]}>
      <meshStandardMaterial
        color="#1a5c1a"
        transparent={xray}
        opacity={xray ? 0.15 : 0.92}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
});

// ─── Solder Mask Layer ──────────────────────────────────────────────────────

const SolderMask: React.FC<{
  outline: BoardOutline;
  side: 'top' | 'bottom';
  xray: boolean;
}> = React.memo(({ outline, side, xray }) => {
  const geometry = useMemo(() => {
    if (outline.points.length < 3) return null;
    const shape = new THREE.Shape();
    shape.moveTo(outline.points[0].x, -outline.points[0].y);
    for (let i = 1; i < outline.points.length; i++) {
      shape.lineTo(outline.points[i].x, -outline.points[i].y);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [outline]);

  if (!geometry) return null;

  const yPos = side === 'top'
    ? BOARD_THICKNESS + SOLDER_MASK_OFFSET
    : -SOLDER_MASK_OFFSET;

  return (
    <mesh geometry={geometry} position={[0, yPos, 0]} renderOrder={1}>
      <meshStandardMaterial
        color="#0d7a0d"
        transparent
        opacity={xray ? 0.05 : 0.3}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
});

// ─── Pin 1 Marker (small white dot on ICs) ──────────────────────────────────

const Pin1Marker: React.FC<{
  x: number;
  y: number;
  z: number;
  radius: number;
}> = ({ x, y, z, radius }) => (
  <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
    <circleGeometry args={[radius, 16]} />
    <meshStandardMaterial color="#e0e0e0" />
  </mesh>
);

// ─── Gull-wing lead ─────────────────────────────────────────────────────────

const GullWingLead: React.FC<{
  x: number;
  z: number;
  bodyHeight: number;
  leadLen: number;
  leadWidth: number;
  xray: boolean;
}> = React.memo(({ x, z, bodyHeight, leadLen, leadWidth, xray }) => {
  // A simplified gull-wing: horizontal foot + vertical riser + horizontal shoulder
  const footThick = 0.08;
  const riserH = bodyHeight * 0.35;
  return (
    <group position={[x, 0, z]}>
      {/* Foot (flat on PCB surface) */}
      <mesh position={[0, footThick / 2, 0]}>
        <boxGeometry args={[leadLen * 0.4, footThick, leadWidth]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.2} transparent={xray} opacity={xray ? 0.4 : 1} />
      </mesh>
      {/* Riser */}
      <mesh position={[leadLen > 0 ? -leadLen * 0.15 : leadLen * 0.15, riserH / 2, 0]}>
        <boxGeometry args={[footThick, riserH, leadWidth]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.2} transparent={xray} opacity={xray ? 0.4 : 1} />
      </mesh>
    </group>
  );
});

// ─── Procedural Component Body: Chip Passive (R/C 0402-1206) ────────────────

const ChipPassiveBody: React.FC<{
  w: number; h: number; height: number; xray: boolean;
}> = React.memo(({ w, h, height, xray }) => {
  const capW = Math.min(w * 0.2, 0.4);
  return (
    <group>
      {/* Ceramic body - tan/brown color */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w * 0.85, height, h * 0.9]} />
        <meshStandardMaterial color="#c4a46c" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.7} />
      </mesh>
      {/* Left end cap (silver) */}
      <mesh position={[-w / 2 + capW / 2, height / 2, 0]}>
        <boxGeometry args={[capW, height * 1.02, h * 0.92]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} transparent={xray} opacity={xray ? 0.4 : 1} />
      </mesh>
      {/* Right end cap (silver) */}
      <mesh position={[w / 2 - capW / 2, height / 2, 0]}>
        <boxGeometry args={[capW, height * 1.02, h * 0.92]} />
        <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} transparent={xray} opacity={xray ? 0.4 : 1} />
      </mesh>
    </group>
  );
});

// ─── Procedural Component Body: SOT package ─────────────────────────────────

const SOTBody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  const leadLen = w * 0.15;
  const leadW = 0.3;
  return (
    <group>
      {/* Dark epoxy body */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w * 0.7, height, h * 0.7]} />
        <meshStandardMaterial color="#1a1a1e" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.6} />
      </mesh>
      {/* Pin 1 marker */}
      <Pin1Marker x={-w * 0.25} y={height + 0.02} z={-h * 0.2} radius={0.15} />
      {/* Leads - left side (1 pin) and right side (2 pins) for SOT-23 */}
      <GullWingLead x={-w / 2 + leadLen / 2} z={0} bodyHeight={height} leadLen={-leadLen} leadWidth={leadW} xray={xray} />
      <GullWingLead x={w / 2 - leadLen / 2} z={-h * 0.2} bodyHeight={height} leadLen={leadLen} leadWidth={leadW} xray={xray} />
      <GullWingLead x={w / 2 - leadLen / 2} z={h * 0.2} bodyHeight={height} leadLen={leadLen} leadWidth={leadW} xray={xray} />
    </group>
  );
});

// ─── Procedural Component Body: SOIC / TSSOP IC ────────────────────────────

const SOICBody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  const pinsPerSide = Math.max(Math.floor(padCount / 2), 2);
  const bodyW = w * 0.65;
  const leadLen = (w - bodyW) / 2;
  const pinSpacing = (h * 0.8) / pinsPerSide;
  const leadW = pinSpacing * 0.5;
  const startZ = -((pinsPerSide - 1) * pinSpacing) / 2;

  return (
    <group>
      {/* Black IC body */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[bodyW, height, h * 0.85]} />
        <meshStandardMaterial color="#111114" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.5} />
      </mesh>
      {/* Pin 1 marker */}
      <Pin1Marker x={-bodyW * 0.35} y={height + 0.02} z={startZ} radius={0.2} />
      {/* Gull-wing leads on both sides */}
      {Array.from({ length: pinsPerSide }).map((_, i) => (
        <React.Fragment key={`soic-lead-${i}`}>
          <GullWingLead x={-w / 2 + leadLen / 2} z={startZ + i * pinSpacing} bodyHeight={height} leadLen={-leadLen} leadWidth={leadW} xray={xray} />
          <GullWingLead x={w / 2 - leadLen / 2} z={startZ + i * pinSpacing} bodyHeight={height} leadLen={leadLen} leadWidth={leadW} xray={xray} />
        </React.Fragment>
      ))}
    </group>
  );
});

// ─── Procedural Component Body: QFP (leads on all 4 sides) ──────────────────

const QFPBody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  const pinsPerSide = Math.max(Math.floor(padCount / 4), 2);
  const bodyFrac = 0.65;
  const bodyW = w * bodyFrac;
  const bodyH = h * bodyFrac;
  const leadLenX = (w - bodyW) / 2;
  const leadLenZ = (h - bodyH) / 2;
  const pinSpacingX = (bodyH * 0.85) / pinsPerSide;
  const pinSpacingZ = (bodyW * 0.85) / pinsPerSide;
  const leadW = Math.min(pinSpacingX, pinSpacingZ) * 0.45;

  return (
    <group>
      {/* Black IC body */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[bodyW, height, bodyH]} />
        <meshStandardMaterial color="#111114" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.5} />
      </mesh>
      {/* Pin 1 chamfer (small beveled corner) */}
      <Pin1Marker x={-bodyW * 0.4} y={height + 0.02} z={-bodyH * 0.4} radius={0.25} />
      {/* Leads on left and right */}
      {Array.from({ length: pinsPerSide }).map((_, i) => {
        const z = -((pinsPerSide - 1) * pinSpacingX) / 2 + i * pinSpacingX;
        return (
          <React.Fragment key={`qfp-lr-${i}`}>
            <GullWingLead x={-w / 2 + leadLenX / 2} z={z} bodyHeight={height} leadLen={-leadLenX} leadWidth={leadW} xray={xray} />
            <GullWingLead x={w / 2 - leadLenX / 2} z={z} bodyHeight={height} leadLen={leadLenX} leadWidth={leadW} xray={xray} />
          </React.Fragment>
        );
      })}
      {/* Leads on top and bottom (Z-axis sides) */}
      {Array.from({ length: pinsPerSide }).map((_, i) => {
        const x = -((pinsPerSide - 1) * pinSpacingZ) / 2 + i * pinSpacingZ;
        return (
          <React.Fragment key={`qfp-tb-${i}`}>
            <GullWingLead x={x} z={-h / 2 + leadLenZ / 2} bodyHeight={height} leadLen={-leadLenZ} leadWidth={leadW} xray={xray} />
            <GullWingLead x={x} z={h / 2 - leadLenZ / 2} bodyHeight={height} leadLen={leadLenZ} leadWidth={leadW} xray={xray} />
          </React.Fragment>
        );
      })}
    </group>
  );
});

// ─── Procedural Component Body: QFN/DFN (no visible leads, exposed pad) ────

const QFNBody: React.FC<{
  w: number; h: number; height: number; xray: boolean;
}> = React.memo(({ w, h, height, xray }) => (
  <group>
    {/* Dark gray flat body */}
    <mesh position={[0, height / 2, 0]}>
      <boxGeometry args={[w * 0.9, height, h * 0.9]} />
      <meshStandardMaterial color="#2a2a30" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.5} />
    </mesh>
    {/* Exposed pad underneath (copper color) */}
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w * 0.5, h * 0.5]} />
      <meshStandardMaterial color="#b87333" metalness={0.8} roughness={0.3} transparent={xray} opacity={xray ? 0.3 : 0.9} />
    </mesh>
    {/* Pin 1 marker */}
    <Pin1Marker x={-w * 0.35} y={height + 0.02} z={-h * 0.35} radius={0.2} />
  </group>
));

// ─── Procedural Component Body: BGA ─────────────────────────────────────────

const BGABody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  // Approximate ball grid: square root of pad count per side
  const gridSize = Math.max(Math.round(Math.sqrt(padCount)), 2);
  const ballRadius = Math.min(w, h) / (gridSize * 3);
  const spacingX = (w * 0.7) / gridSize;
  const spacingZ = (h * 0.7) / gridSize;

  return (
    <group>
      {/* Black IC body */}
      <mesh position={[0, height / 2 + ballRadius, 0]}>
        <boxGeometry args={[w * 0.9, height, h * 0.9]} />
        <meshStandardMaterial color="#0e0e12" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.4} />
      </mesh>
      {/* Pin 1 marker */}
      <Pin1Marker x={-w * 0.35} y={height + ballRadius + 0.02} z={-h * 0.35} radius={0.25} />
      {/* Ball grid (simplified - show limited balls for performance) */}
      {Array.from({ length: Math.min(gridSize, 8) }).map((_, row) =>
        Array.from({ length: Math.min(gridSize, 8) }).map((_, col) => (
          <mesh
            key={`ball-${row}-${col}`}
            position={[
              -((Math.min(gridSize, 8) - 1) * spacingX) / 2 + col * spacingX,
              ballRadius,
              -((Math.min(gridSize, 8) - 1) * spacingZ) / 2 + row * spacingZ,
            ]}
          >
            <sphereGeometry args={[ballRadius, 8, 8]} />
            <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} transparent={xray} opacity={xray ? 0.3 : 1} />
          </mesh>
        ))
      )}
    </group>
  );
});

// ─── Procedural Component Body: DIP (through-hole) ─────────────────────────

const DIPBody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  const pinsPerSide = Math.max(Math.floor(padCount / 2), 2);
  const pinSpacing = (h * 0.85) / pinsPerSide;
  const pinRadius = 0.2;
  const pinH = BOARD_THICKNESS + 2; // pins go through board

  return (
    <group>
      {/* Black body */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w * 0.8, height, h * 0.9]} />
        <meshStandardMaterial color="#111114" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.5} />
      </mesh>
      {/* Notch at top (pin 1 end) */}
      <mesh position={[0, height + 0.01, -h * 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[w * 0.1, 16, 0, Math.PI]} />
        <meshStandardMaterial color="#222228" />
      </mesh>
      {/* Through-hole pins */}
      {Array.from({ length: pinsPerSide }).map((_, i) => {
        const z = -((pinsPerSide - 1) * pinSpacing) / 2 + i * pinSpacing;
        return (
          <React.Fragment key={`dip-pin-${i}`}>
            <mesh position={[-w * 0.35, -pinH / 2 + height / 2, z]}>
              <cylinderGeometry args={[pinRadius, pinRadius, pinH, 6]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.2} transparent={xray} opacity={xray ? 0.4 : 1} />
            </mesh>
            <mesh position={[w * 0.35, -pinH / 2 + height / 2, z]}>
              <cylinderGeometry args={[pinRadius, pinRadius, pinH, 6]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.2} transparent={xray} opacity={xray ? 0.4 : 1} />
            </mesh>
          </React.Fragment>
        );
      })}
    </group>
  );
});

// ─── Procedural Component Body: Connector ───────────────────────────────────

const ConnectorBody: React.FC<{
  w: number; h: number; height: number; xray: boolean; padCount: number;
}> = React.memo(({ w, h, height, xray, padCount }) => {
  const pinSpacing = Math.max(h * 0.8, w * 0.8) / Math.max(padCount, 2);
  const pinRadius = 0.2;

  return (
    <group>
      {/* Plastic housing - blue/white */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w * 0.9, height, h * 0.9]} />
        <meshStandardMaterial color="#2244aa" transparent={xray} opacity={xray ? 0.3 : 0.95} roughness={0.7} />
      </mesh>
      {/* White shroud rim on top */}
      <mesh position={[0, height - 0.3, 0]}>
        <boxGeometry args={[w * 0.95, 0.6, h * 0.95]} />
        <meshStandardMaterial color="#e0e0e0" transparent={xray} opacity={xray ? 0.2 : 0.9} roughness={0.8} />
      </mesh>
      {/* Pin row (vertical pins) */}
      {Array.from({ length: Math.min(padCount, 20) }).map((_, i) => {
        const isLong = h > w;
        const pos = -((Math.min(padCount, 20) - 1) * pinSpacing) / 2 + i * pinSpacing;
        return (
          <mesh
            key={`conn-pin-${i}`}
            position={isLong ? [0, -1, pos] : [pos, -1, 0]}
          >
            <cylinderGeometry args={[pinRadius, pinRadius, BOARD_THICKNESS + 2, 6]} />
            <meshStandardMaterial color="#daa520" metalness={0.9} roughness={0.15} transparent={xray} opacity={xray ? 0.4 : 1} />
          </mesh>
        );
      })}
    </group>
  );
});

// ─── Procedural Component Body: Electrolytic Capacitor ──────────────────────

const ElectrolyticBody: React.FC<{
  w: number; h: number; height: number; xray: boolean;
}> = React.memo(({ w, h, height, xray }) => {
  const radius = Math.min(w, h) * 0.45;
  return (
    <group>
      {/* Cylinder body */}
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radius, radius, height, 20]} />
        <meshStandardMaterial color="#222228" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.6} />
      </mesh>
      {/* Polarity stripe (lighter band on one side) */}
      <mesh position={[-radius * 0.85, height / 2, 0]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.15, height * 0.9, radius * 1.2]} />
        <meshStandardMaterial color="#888888" transparent={xray} opacity={xray ? 0.3 : 0.9} />
      </mesh>
      {/* Top marking ring */}
      <mesh position={[0, height - 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.3, radius * 0.85, 20]} />
        <meshStandardMaterial color="#333338" />
      </mesh>
    </group>
  );
});

// ─── Procedural Component Body: Crystal ─────────────────────────────────────

const CrystalBody: React.FC<{
  w: number; h: number; height: number; xray: boolean;
}> = React.memo(({ w, h, height, xray }) => (
  <group>
    {/* Metal can body */}
    <mesh position={[0, height / 2, 0]}>
      <boxGeometry args={[w * 0.85, height, h * 0.85]} />
      <meshStandardMaterial color="#c0b080" metalness={0.85} roughness={0.2} transparent={xray} opacity={xray ? 0.3 : 1} />
    </mesh>
    {/* Pad markings on ends */}
    <mesh position={[-w * 0.35, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w * 0.25, h * 0.6]} />
      <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} />
    </mesh>
    <mesh position={[w * 0.35, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w * 0.25, h * 0.6]} />
      <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.15} />
    </mesh>
  </group>
));

// ─── Procedural Component Body: LED ─────────────────────────────────────────

const LEDBody: React.FC<{
  w: number; h: number; height: number; xray: boolean;
}> = React.memo(({ w, h, height, xray }) => {
  const baseH = height * 0.5;
  const domeR = Math.min(w, h) * 0.35;
  return (
    <group>
      {/* Rectangular base */}
      <mesh position={[0, baseH / 2, 0]}>
        <boxGeometry args={[w * 0.85, baseH, h * 0.85]} />
        <meshStandardMaterial color="#e8e8d8" transparent={xray} opacity={xray ? 0.2 : 0.85} roughness={0.8} />
      </mesh>
      {/* Tinted dome (translucent) */}
      <mesh position={[0, baseH, 0]}>
        <sphereGeometry args={[domeR, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color="#44ff44"
          transparent
          opacity={xray ? 0.15 : 0.6}
          emissive="#22aa22"
          emissiveIntensity={0.3}
          roughness={0.1}
        />
      </mesh>
    </group>
  );
});

// ─── PCB Component (procedural model dispatcher) ────────────────────────────

const PCBComponent: React.FC<{
  comp: BrdComponent;
  xray: boolean;
  onHover: (comp: BrdComponent | null) => void;
}> = React.memo(({ comp, xray, onHover }) => {
  const size = useMemo(() => getComponentSize(comp), [comp]);
  const height = useMemo(() => getComponentHeight(comp.footprint), [comp.footprint]);
  const category = useMemo(() => classifyFootprint(comp.footprint), [comp.footprint]);
  const isBottom = comp.layer === 'B.Cu';
  const yBase = isBottom ? 0 : BOARD_THICKNESS;
  const yDir = isBottom ? -1 : 1;

  const rotRad = (comp.rotation * Math.PI) / 180;

  const bodyNode = useMemo(() => {
    const props = { w: size.w, h: size.h, height, xray, padCount: comp.pads.length };
    switch (category) {
      case 'chip_passive': return <ChipPassiveBody {...props} />;
      case 'sot': return <SOTBody {...props} />;
      case 'soic': return <SOICBody {...props} />;
      case 'qfp': return <QFPBody {...props} />;
      case 'qfn': return <QFNBody {...props} />;
      case 'bga': return <BGABody {...props} />;
      case 'dip': return <DIPBody {...props} />;
      case 'connector': return <ConnectorBody {...props} />;
      case 'electrolytic': return <ElectrolyticBody {...props} />;
      case 'crystal': return <CrystalBody {...props} />;
      case 'led': return <LEDBody {...props} />;
      default:
        return (
          <group>
            <mesh position={[0, height / 2, 0]}>
              <boxGeometry args={[size.w * 0.85, height, size.h * 0.85]} />
              <meshStandardMaterial color="#2a2a2e" transparent={xray} opacity={xray ? 0.3 : 1} roughness={0.6} />
            </mesh>
            <Pin1Marker x={-size.w * 0.3} y={height + 0.02} z={-size.h * 0.3} radius={0.2} />
          </group>
        );
    }
  }, [category, size.w, size.h, height, xray, comp.pads.length]);

  return (
    <group
      position={[comp.x, yBase, -comp.y]}
      rotation={[0, -rotRad, isBottom ? Math.PI : 0]}
      scale={[1, yDir, 1]}
      onPointerEnter={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(comp); }}
      onPointerLeave={() => onHover(null)}
    >
      {/* Procedural component body */}
      {bodyNode}

      {/* Reference label on top surface */}
      <Text
        position={[0, height + 0.15, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={Math.min(size.w, size.h) * 0.25}
        maxWidth={size.w * 0.9}
        color="#e0e0e0"
        anchorX="center"
        anchorY="middle"
        depthOffset={-1}
      >
        {comp.ref}
      </Text>

      {/* Pads (under the component, visible at board level) */}
      {comp.pads.map((pad) => (
        <mesh
          key={pad.id}
          position={[pad.x, 0.01, -pad.y]}
        >
          <boxGeometry args={[pad.width, 0.04, pad.height]} />
          <meshStandardMaterial color="#b87333" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
});

// ─── Trace ──────────────────────────────────────────────────────────────────

const PCBTrace: React.FC<{
  trace: BrdTrace;
  xray: boolean;
  visible: boolean;
}> = React.memo(({ trace, xray, visible }) => {
  const isBack = trace.layer === 'B.Cu';
  const yPos = isBack ? -COPPER_THICKNESS : BOARD_THICKNESS;
  const color = layerColor(trace.layer);

  const geometry = useMemo(() => {
    if (trace.points.length < 2) return null;

    // Build a flat ribbon along the trace path
    const halfW = trace.width / 2;
    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < trace.points.length; i++) {
      const p = trace.points[i];
      let dx: number, dy: number;

      if (i < trace.points.length - 1) {
        const next = trace.points[i + 1];
        dx = next.x - p.x;
        dy = next.y - p.y;
      } else {
        const prev = trace.points[i - 1];
        dx = p.x - prev.x;
        dy = p.y - prev.y;
      }

      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      // Normal perpendicular to direction (in XZ plane)
      const nx = -dy / len * halfW;
      const nz = dx / len * halfW;

      // Left and right vertices
      vertices.push(p.x + nx, 0, -p.y + nz);
      vertices.push(p.x - nx, 0, -p.y - nz);

      if (i > 0) {
        const base = (i - 1) * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [trace.points, trace.width]);

  if (!geometry || !visible) return null;

  return (
    <mesh geometry={geometry} position={[0, yPos, 0]}>
      <meshStandardMaterial
        color={color}
        transparent={xray}
        opacity={xray ? 0.5 : 0.9}
        side={THREE.DoubleSide}
        metalness={0.6}
        roughness={0.4}
      />
    </mesh>
  );
});

// ─── Via (differentiated by type: through/blind/buried/micro) ───────────────

const PCBVia: React.FC<{
  via: BrdVia;
  xray: boolean;
}> = React.memo(({ via, xray }) => {
  const outerRadius = via.size / 2;
  const drillRadius = via.drill / 2;
  const vType = via.viaType || 'through';

  // Compute vertical span based on start/end layers
  const startIdx = layerIndex(via.startLayer || 'F.Cu');
  const endIdx = layerIndex(via.endLayer || 'B.Cu');
  const totalLayers = LAYER_ORDER.length - 1; // spans 0..5
  const spanFrac = Math.abs(endIdx - startIdx) / totalLayers;
  const fullHeight = BOARD_THICKNESS + 0.1;
  const viaHeight = vType === 'through' ? fullHeight : fullHeight * Math.max(spanFrac, 0.15);

  // Vertical position: offset based on which layers the via spans
  const topFrac = Math.min(startIdx, endIdx) / totalLayers;
  const yPos = vType === 'through'
    ? -0.05
    : BOARD_THICKNESS * (1 - topFrac) - viaHeight / 2;

  const color = viaColor(vType);

  // Micro vias are visually smaller
  const radiusScale = vType === 'micro' ? 0.7 : 1;

  return (
    <group position={[via.x, vType === 'through' ? -0.05 : yPos, -via.y]}>
      {/* Outer copper barrel */}
      <mesh>
        <cylinderGeometry args={[outerRadius * radiusScale, outerRadius * radiusScale, viaHeight, 16]} />
        <meshStandardMaterial
          color={color}
          transparent={xray}
          opacity={xray ? 0.4 : 1}
          metalness={0.8}
          roughness={0.3}
        />
      </mesh>
      {/* Drill hole */}
      <mesh>
        <cylinderGeometry args={[drillRadius * radiusScale, drillRadius * radiusScale, viaHeight + 0.1, 12]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      {/* Annular ring on top for blind/micro vias */}
      {vType !== 'through' && (
        <mesh position={[0, viaHeight / 2 + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[drillRadius * radiusScale, outerRadius * radiusScale * 1.2, 16]} />
          <meshStandardMaterial color={color} metalness={0.8} roughness={0.3} />
        </mesh>
      )}
    </group>
  );
});

// ─── Zone ───────────────────────────────────────────────────────────────────

const PCBZone: React.FC<{
  zone: BrdZone;
  xray: boolean;
  visible: boolean;
}> = React.memo(({ zone, xray, visible }) => {
  const isBack = zone.layer === 'B.Cu';
  const yPos = isBack ? -COPPER_THICKNESS - 0.01 : BOARD_THICKNESS + 0.01;
  const color = layerColor(zone.layer);

  const geometry = useMemo(() => {
    if (zone.points.length < 3) return null;
    const shape = new THREE.Shape();
    shape.moveTo(zone.points[0].x, -zone.points[0].y);
    for (let i = 1; i < zone.points.length; i++) {
      shape.lineTo(zone.points[i].x, -zone.points[i].y);
    }
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [zone.points]);

  if (!geometry || !visible) return null;

  return (
    <mesh geometry={geometry} position={[0, yPos, 0]}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={xray ? 0.15 : 0.4}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
});

// ─── Silkscreen Outlines (component outlines on top/bottom) ─────────────────

const SilkscreenOutlines: React.FC<{
  components: BrdComponent[];
  xray: boolean;
}> = React.memo(({ components, xray }) => {
  const lines = useMemo(() => {
    const result: { points: [number, number, number][]; side: 'top' | 'bottom' }[] = [];
    for (const comp of components) {
      const size = getComponentSize(comp);
      const hw = size.w / 2;
      const hh = size.h / 2;
      const rotRad = (comp.rotation * Math.PI) / 180;
      const cos = Math.cos(-rotRad);
      const sin = Math.sin(-rotRad);

      // Component outline corners (local space)
      const corners: [number, number][] = [
        [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh],
      ];

      const isBottom = comp.layer === 'B.Cu';
      const yPos = isBottom ? -SOLDER_MASK_OFFSET - 0.01 : BOARD_THICKNESS + SOLDER_MASK_OFFSET + 0.01;

      const pts: [number, number, number][] = corners.map(([lx, lz]) => {
        const rx = lx * cos - lz * sin;
        const rz = lx * sin + lz * cos;
        return [comp.x + rx, yPos, -(comp.y + rz)];
      });

      result.push({ points: pts, side: isBottom ? 'bottom' : 'top' });
    }
    return result;
  }, [components]);

  return (
    <>
      {lines.map((line, i) => (
        <Line
          key={`silk-${i}`}
          points={line.points}
          color={line.side === 'top' ? '#d0d0a0' : '#a0a0d0'}
          lineWidth={0.8}
          transparent
          opacity={xray ? 0.15 : 0.5}
        />
      ))}
    </>
  );
});

// ─── Camera Controller ──────────────────────────────────────────────────────

interface CameraControllerProps {
  target: [number, number, number];
  viewPreset: 'free' | 'top' | 'bottom' | 'front' | 'back' | null;
  onPresetApplied: () => void;
}

const CameraController: React.FC<CameraControllerProps> = ({ target, viewPreset, onPresetApplied }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  useFrame(() => {
    if (viewPreset && controlsRef.current) {
      const dist = 120;
      switch (viewPreset) {
        case 'top':
          camera.position.set(target[0], dist, target[2]);
          camera.up.set(0, 0, -1);
          break;
        case 'bottom':
          camera.position.set(target[0], -dist, target[2]);
          camera.up.set(0, 0, 1);
          break;
        case 'front':
          camera.position.set(target[0], target[1], target[2] + dist);
          camera.up.set(0, 1, 0);
          break;
        case 'back':
          camera.position.set(target[0], target[1], target[2] - dist);
          camera.up.set(0, 1, 0);
          break;
      }
      camera.lookAt(target[0], target[1], target[2]);
      controlsRef.current.target.set(...target);
      controlsRef.current.update();
      onPresetApplied();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      target={target}
      enableDamping
      dampingFactor={0.1}
      minDistance={5}
      maxDistance={500}
    />
  );
};

// ─── Overlay button style ───────────────────────────────────────────────────

const overlayBtnStyle: React.CSSProperties = {
  background: theme.bg2,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textSecondary,
  fontSize: '11px',
  fontFamily: 'inherit',
  fontWeight: 500,
  padding: '4px 10px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  whiteSpace: 'nowrap',
};

const overlayBtnActive: React.CSSProperties = {
  ...overlayBtnStyle,
  background: theme.blueDim,
  borderColor: theme.blue,
  color: theme.blue,
};

// ─── Main BoardViewer3D Component ───────────────────────────────────────────

const BoardViewer3D: React.FC = () => {
  const board = useProjectStore((s) => s.board);
  const [xray, setXray] = useState(false);
  const [hoveredComp, setHoveredComp] = useState<BrdComponent | null>(null);
  const [viewPreset, setViewPreset] = useState<'free' | 'top' | 'bottom' | 'front' | 'back' | null>(null);

  // Layer visibility
  const [layerVis, setLayerVis] = useState<Record<string, boolean>>({
    'F.Cu': true,
    'B.Cu': true,
    'In1.Cu': true,
    'In2.Cu': true,
    'Components': true,
    'Vias': true,
    'Zones': true,
  });

  const toggleLayer = useCallback((layer: string) => {
    setLayerVis((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const bounds = useMemo(() => boardBounds(board.outline), [board.outline]);
  const cameraTarget = useMemo<[number, number, number]>(
    () => [bounds.cx, BOARD_THICKNESS / 2, -bounds.cy],
    [bounds],
  );

  const handleHover = useCallback((comp: BrdComponent | null) => {
    setHoveredComp(comp);
  }, []);

  // Determine which layers exist in traces/zones
  const activeLayers = useMemo(() => {
    const layers = new Set<string>();
    for (const t of board.traces) layers.add(t.layer);
    for (const z of board.zones) layers.add(z.layer);
    return Array.from(layers).sort();
  }, [board.traces, board.zones]);

  const isLayerVisible = useCallback((layer: string) => {
    return layerVis[layer] !== false;
  }, [layerVis]);

  return (
    <div style={{ flex: 1, display: 'flex', position: 'relative', background: '#0a0c10' }}>
      {/* Three.js Canvas */}
      <Canvas
        camera={{
          position: [bounds.cx, 80, -bounds.cy + 80],
          fov: 45,
          near: 0.1,
          far: 2000,
          up: [0, 1, 0],
        }}
        style={{ flex: 1 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor('#0a0c10');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[50, 100, 50]} intensity={0.8} castShadow={false} />
        <directionalLight position={[-30, 80, -40]} intensity={0.3} />
        <pointLight position={[bounds.cx, 40, -bounds.cy]} intensity={0.4} />

        {/* Camera controls */}
        <CameraController
          target={cameraTarget}
          viewPreset={viewPreset}
          onPresetApplied={() => setViewPreset(null)}
        />

        {/* Board body (FR4) */}
        <BoardBody outline={board.outline} xray={xray} />

        {/* Solder mask */}
        <SolderMask outline={board.outline} side="top" xray={xray} />
        <SolderMask outline={board.outline} side="bottom" xray={xray} />

        {/* Silkscreen outlines */}
        {layerVis['Components'] !== false && (
          <SilkscreenOutlines components={board.components} xray={xray} />
        )}

        {/* Components */}
        {layerVis['Components'] !== false && board.components.map((comp) => (
          <PCBComponent
            key={comp.id}
            comp={comp}
            xray={xray}
            onHover={handleHover}
          />
        ))}

        {/* Traces */}
        {board.traces.map((trace) => (
          <PCBTrace
            key={trace.id}
            trace={trace}
            xray={xray}
            visible={isLayerVisible(trace.layer)}
          />
        ))}

        {/* Vias */}
        {layerVis['Vias'] !== false && board.vias.map((via) => (
          <PCBVia key={via.id} via={via} xray={xray} />
        ))}

        {/* Zones */}
        {board.zones.map((zone) => (
          <PCBZone
            key={zone.id}
            zone={zone}
            xray={xray}
            visible={layerVis['Zones'] !== false && isLayerVisible(zone.layer)}
          />
        ))}

        {/* Grid helper */}
        <gridHelper
          args={[200, 200, '#1a1e2a', '#111420']}
          position={[bounds.cx, -0.1, -bounds.cy]}
        />
      </Canvas>

      {/* ── Overlay Controls (top-right) ──────────────────────────────── */}
      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 10,
      }}>
        {/* View preset buttons */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button style={overlayBtnStyle} onClick={() => setViewPreset('top')} title="Top view">Top</button>
          <button style={overlayBtnStyle} onClick={() => setViewPreset('bottom')} title="Bottom view">Bottom</button>
          <button style={overlayBtnStyle} onClick={() => setViewPreset('front')} title="Front view">Front</button>
          <button style={overlayBtnStyle} onClick={() => setViewPreset('back')} title="Back view">Back</button>
        </div>

        {/* X-ray toggle */}
        <button
          style={xray ? overlayBtnActive : overlayBtnStyle}
          onClick={() => setXray((v) => !v)}
          title="Toggle X-ray mode (semi-transparent board)"
        >
          {xray ? 'X-Ray ON' : 'X-Ray'}
        </button>

        {/* Reset view */}
        <button
          style={overlayBtnStyle}
          onClick={() => setViewPreset('free')}
          title="Reset camera to default perspective"
        >
          Reset View
        </button>

        {/* Layer visibility */}
        <div style={{
          background: `${theme.bg1}ee`,
          border: `1px solid ${theme.bg3}`,
          borderRadius: '6px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginTop: 4,
        }}>
          <div style={{ fontSize: '10px', color: theme.textMuted, fontWeight: 600, marginBottom: 2, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Layers
          </div>

          {/* Standard toggles */}
          {['F.Cu', 'B.Cu', ...activeLayers.filter(l => l !== 'F.Cu' && l !== 'B.Cu')].map((layer) => (
            <label key={layer} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: '11px', color: theme.textSecondary, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={layerVis[layer] !== false}
                onChange={() => toggleLayer(layer)}
                style={{ accentColor: layerColor(layer) }}
              />
              <span style={{
                width: 8, height: 8, borderRadius: 2,
                background: layerColor(layer),
                display: 'inline-block',
                flexShrink: 0,
              }} />
              {layer}
            </label>
          ))}

          {/* Aggregate toggles */}
          <div style={{ borderTop: `1px solid ${theme.bg3}`, marginTop: 2, paddingTop: 4 }} />
          {['Components', 'Vias', 'Zones'].map((item) => (
            <label key={item} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: '11px', color: theme.textSecondary, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={layerVis[item] !== false}
                onChange={() => toggleLayer(item)}
                style={{ accentColor: theme.blue }}
              />
              {item}
            </label>
          ))}
        </div>

        {/* Board stats */}
        <div style={{
          background: `${theme.bg1}ee`,
          border: `1px solid ${theme.bg3}`,
          borderRadius: '6px',
          padding: '8px 10px',
          fontSize: '10px',
          color: theme.textMuted,
          lineHeight: '1.6',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Board Info</div>
          <div>Size: {bounds.width.toFixed(1)} x {bounds.height.toFixed(1)} mm</div>
          <div>Components: {board.components.length}</div>
          <div>Traces: {board.traces.length}</div>
          <div>Vias: {board.vias.length}</div>
          <div>Zones: {board.zones.length}</div>
        </div>
      </div>

      {/* ── Hover Tooltip ─────────────────────────────────────────────── */}
      {hoveredComp && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          background: `${theme.bg2}f0`,
          border: `1px solid ${theme.bg3}`,
          borderRadius: '6px',
          padding: '8px 14px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          zIndex: 10,
          fontSize: '12px',
          color: theme.textPrimary,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          <span style={{ fontWeight: 700, color: theme.blue }}>{hoveredComp.ref}</span>
          <span style={{ color: theme.textSecondary }}>{hoveredComp.value}</span>
          <span style={{ color: theme.textMuted, fontSize: '10px' }}>{hoveredComp.footprint}</span>
          <span style={{ color: theme.textMuted, fontSize: '10px' }}>
            ({hoveredComp.x.toFixed(1)}, {hoveredComp.y.toFixed(1)}) {hoveredComp.layer}
          </span>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {board.components.length === 0 && board.traces.length === 0 && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: theme.textMuted,
          pointerEvents: 'none',
          zIndex: 5,
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 4 }}>
            3D Board Viewer
          </div>
          <div style={{ fontSize: '12px' }}>
            Add components to the board to see them rendered in 3D.
          </div>
          <div style={{ fontSize: '11px', marginTop: 4 }}>
            Use "Update Board" to sync from schematic.
          </div>
        </div>
      )}
    </div>
  );
};

export default BoardViewer3D;
