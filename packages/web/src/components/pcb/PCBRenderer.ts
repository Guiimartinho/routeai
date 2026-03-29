import * as THREE from 'three';
import type { Trace, Pad, Via, Zone, OutlineSegment, SilkscreenItem, Point } from '../../types/board';
import type { ReviewItem } from '../../types/review';

// ---------------------------------------------------------------------------
// Safe accessors: the backend may return flat {x, y} or nested {position: {x,y}}
// ---------------------------------------------------------------------------
function px(obj: any): number {
  return obj?.position?.x ?? obj?.x ?? obj?.at?.x ?? 0;
}
function py(obj: any): number {
  return obj?.position?.y ?? obj?.y ?? obj?.at?.y ?? 0;
}
function psize(obj: any, key: string, fallback = 0): number {
  return obj?.size?.[key] ?? obj?.[key] ?? fallback;
}
function psizeW(obj: any): number { return psize(obj, 'width', obj?.size_x ?? obj?.size?.width ?? 1); }
function psizeH(obj: any): number { return psize(obj, 'height', obj?.size_y ?? obj?.size?.height ?? 1); }
function viaSize(v: any): number { return v?.size ?? v?.diameter ?? 0.6; }
function viaDrill(v: any): number { return v?.drillSize ?? v?.drill_size ?? v?.drill ?? 0.3; }
function padDrill(p: any): number { return p?.drillSize ?? p?.drill_size ?? p?.drill ?? 0; }
function padRot(p: any): number { return p?.rotation ?? p?.angle ?? 0; }

/** Default layer colors */
export const LAYER_COLORS: Record<string, string> = {
  'F.Cu': '#ff4444',
  'B.Cu': '#4444ff',
  'In1.Cu': '#44cc44',
  'In2.Cu': '#cc44cc',
  'In3.Cu': '#cc8844',
  'In4.Cu': '#44cccc',
  'F.Mask': '#880088',
  'B.Mask': '#008800',
  'F.SilkS': '#ffffff',
  'B.SilkS': '#cccccc',
  'Edge.Cuts': '#cccc00',
  'F.Paste': '#888800',
  'B.Paste': '#008888',
  'F.CrtYd': '#444444',
  'B.CrtYd': '#333333',
  'F.Fab': '#666666',
  'B.Fab': '#555555',
};

/** Severity colors for annotation markers */
const SEVERITY_COLORS: Record<string, number> = {
  critical: 0xff0000,
  error: 0xff8800,
  warning: 0xffcc00,
  info: 0x4488ff,
};

/**
 * Create geometry for traces on a given layer.
 * Each trace is rendered as a series of thick line segments (rectangles).
 */
export function createTraceGeometry(
  traces: Trace[],
  layer: string,
  color: string
): THREE.Group {
  const group = new THREE.Group();
  group.name = `traces_${layer}`;
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Filter by layer name, or render all if layer is empty string
  const layerTraces = !layer ? traces : traces.filter((t: any) =>
    t.layer === layer || t.layerId === layer || t.layer_id === layer
  );

  for (const trace of layerTraces) {
    if (trace.points.length < 2) continue;

    for (let i = 0; i < trace.points.length - 1; i++) {
      const p0 = trace.points[i];
      const p1 = trace.points[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      const width = Math.max(trace.width, 0.1);
      const geo = new THREE.PlaneGeometry(len, width);
      const mesh = new THREE.Mesh(geo, mat);

      // Position at midpoint
      mesh.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0);
      // Rotate to align with segment
      mesh.rotation.z = Math.atan2(dy, dx);

      mesh.userData = {
        type: 'trace',
        id: trace.id,
        netId: trace.netId ?? trace.net_id ?? 0,
        layer: trace.layer ?? '',
      };

      group.add(mesh);
    }

    // Add round caps at each joint/endpoint
    const capGeo = new THREE.CircleGeometry(Math.max(trace.width / 2, 0.05), 12);
    for (const pt of trace.points) {
      const cap = new THREE.Mesh(capGeo, mat);
      cap.position.set(pt.x, pt.y, 0);
      cap.userData = {
        type: 'trace',
        id: trace.id,
        netId: trace.netId ?? trace.net_id ?? 0,
        layer: trace.layer ?? '',
      };
      group.add(cap);
    }
  }

  return group;
}

/**
 * Create geometry for pads on a given layer.
 */
export function createPadGeometry(pads: Pad[], layer: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `pads_${layer}`;

  const copperColor = new THREE.Color('#b87333');
  const mat = new THREE.MeshBasicMaterial({
    color: copperColor,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const layerPads = !layer ? pads : pads.filter((p: any) =>
    p.layer === layer || p.layer === 'all' || p.layerId === layer || p.layer_id === layer
  );

  for (const pad of layerPads) {
    let geo: THREE.BufferGeometry;

    switch (pad.shape) {
      case 'circle':
      case 'oval':
        geo = new THREE.CircleGeometry(
          Math.max(psizeW(pad), psizeH(pad)) / 2,
          pad.shape === 'circle' ? 24 : 16
        );
        if (pad.shape === 'oval') {
          geo.scale(
            psizeW(pad) / Math.max(psizeW(pad), psizeH(pad)),
            psizeH(pad) / Math.max(psizeW(pad), psizeH(pad)),
            1
          );
        }
        break;
      case 'roundrect': {
        const shape = new THREE.Shape();
        const w = psizeW(pad) / 2;
        const h = psizeH(pad) / 2;
        const r = Math.min(w, h) * 0.25;
        shape.moveTo(-w + r, -h);
        shape.lineTo(w - r, -h);
        shape.quadraticCurveTo(w, -h, w, -h + r);
        shape.lineTo(w, h - r);
        shape.quadraticCurveTo(w, h, w - r, h);
        shape.lineTo(-w + r, h);
        shape.quadraticCurveTo(-w, h, -w, h - r);
        shape.lineTo(-w, -h + r);
        shape.quadraticCurveTo(-w, -h, -w + r, -h);
        geo = new THREE.ShapeGeometry(shape);
        break;
      }
      default:
        // rect or fallback
        geo = new THREE.PlaneGeometry(psizeW(pad), psizeH(pad));
        break;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px(pad), py(pad), 0.01);
    mesh.rotation.z = (padRot(pad) * Math.PI) / 180;

    mesh.userData = {
      type: 'pad',
      id: pad.id ?? pad.component_ref ?? '',
      componentId: pad.componentId ?? pad.component_ref ?? '',
      netId: pad.netId ?? pad.net_id ?? 0,
      layer: pad.layer ?? '',
    };

    group.add(mesh);

    // Drill hole (dark center)
    if (padDrill(pad) && padDrill(pad) > 0) {
      const drillGeo = new THREE.CircleGeometry(padDrill(pad) / 2, 16);
      const drillMat = new THREE.MeshBasicMaterial({
        color: 0x1a1a1a,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const drill = new THREE.Mesh(drillGeo, drillMat);
      drill.position.set(px(pad), py(pad), 0.02);
      group.add(drill);
    }
  }

  return group;
}

/**
 * Create geometry for vias.
 */
export function createViaGeometry(vias: Via[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vias';

  const viaMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#c0c0c0'),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const drillMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a1a,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#b87333'),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  for (const via of vias) {
    // Outer annular ring
    const outerGeo = new THREE.CircleGeometry(viaSize(via) / 2, 20);
    const outer = new THREE.Mesh(outerGeo, ringMat);
    outer.position.set(px(via), py(via), 0.03);
    outer.userData = {
      type: 'via',
      id: via.id,
      netId: via.netId,
    };
    group.add(outer);

    // Inner silver ring
    const innerRadius = (viaSize(via) / 2 + viaDrill(via) / 2) / 2;
    const innerGeo = new THREE.RingGeometry(viaDrill(via) / 2, innerRadius, 20);
    const inner = new THREE.Mesh(innerGeo, viaMat);
    inner.position.set(px(via), py(via), 0.04);
    group.add(inner);

    // Drill hole
    const drillGeo = new THREE.CircleGeometry(viaDrill(via) / 2, 16);
    const drill = new THREE.Mesh(drillGeo, drillMat);
    drill.position.set(px(via), py(via), 0.05);
    group.add(drill);
  }

  return group;
}

/**
 * Create semi-transparent filled zone polygons.
 */
export function createZoneGeometry(zones: Zone[], layer: string, color: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `zones_${layer}`;

  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const outlineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.5,
  });

  const layerZones = !layer ? zones : zones.filter((z: any) =>
    z.layer === layer || z.layerId === layer || z.layer_id === layer
  );

  for (const zone of layerZones) {
    // Draw filled polygons
    const zoneOutline = zone?.outline ?? zone?.points ?? [];
    const filledPolygons = zone?.filledPolygons ?? [];
    const polygons = filledPolygons.length > 0 ? filledPolygons : [zoneOutline];

    for (const poly of polygons) {
      if (poly.length < 3) continue;

      try {
        const shape = new THREE.Shape();
        shape.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          shape.lineTo(poly[i].x, poly[i].y);
        }
        shape.closePath();

        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.z = -0.01;
        mesh.userData = {
          type: 'zone',
          id: zone?.id ?? '',
          netId: zone?.netId ?? zone?.net_id ?? 0,
          layer: zone?.layer ?? '',
        };
        group.add(mesh);
      } catch {
        // Skip malformed polygons
      }
    }

    // Draw zone outline
    if (zoneOutline.length >= 2) {
      const points = zoneOutline.map((p: any) => new THREE.Vector3(p?.x ?? 0, p?.y ?? 0, -0.005));
      points.push(new THREE.Vector3(zoneOutline[0]?.x ?? 0, zoneOutline[0]?.y ?? 0, -0.005));
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeo, outlineMat);
      group.add(line);
    }
  }

  return group;
}

/**
 * Create board outline geometry.
 */
export function createOutlineGeometry(outline: OutlineSegment[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'outline';

  const mat = new THREE.LineBasicMaterial({
    color: 0xcccc00,
    linewidth: 2,
  });

  const points: THREE.Vector3[] = [];

  // Handle simple point array format: [{x, y}, {x, y}, ...]
  if (outline.length > 0 && !outline[0]?.type) {
    for (const pt of outline) {
      points.push(new THREE.Vector3(pt?.x ?? 0, pt?.y ?? 0, 0.1));
    }
    // Close the outline
    if (outline.length > 2) {
      points.push(new THREE.Vector3(outline[0]?.x ?? 0, outline[0]?.y ?? 0, 0.1));
    }
    if (points.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      group.add(new THREE.Line(geo, mat));
    }
    return group;
  }

  for (const seg of outline) {
    if (seg.type === 'line') {
      points.push(new THREE.Vector3((seg?.start?.x ?? seg?.x ?? 0), (seg?.start?.y ?? seg?.y ?? 0), 0.1));
      points.push(new THREE.Vector3((seg?.end?.x ?? 0), (seg?.end?.y ?? 0), 0.1));
    } else if (seg.type === 'arc' && seg.center && seg.radius) {
      const startAngle = Math.atan2((seg?.start?.y ?? seg?.y ?? 0) - (seg?.center?.y ?? 0), (seg?.start?.x ?? seg?.x ?? 0) - (seg?.center?.x ?? 0));
      const endAngle = Math.atan2((seg?.end?.y ?? 0) - (seg?.center?.y ?? 0), (seg?.end?.x ?? 0) - (seg?.center?.x ?? 0));
      const segments = 32;
      let angleDiff = endAngle - startAngle;
      if (angleDiff < 0) angleDiff += Math.PI * 2;

      for (let i = 0; i <= segments; i++) {
        const angle = startAngle + (angleDiff * i) / segments;
        points.push(
          new THREE.Vector3(
            (seg?.center?.x ?? 0) + Math.cos(angle) * seg.radius,
            (seg?.center?.y ?? 0) + Math.sin(angle) * seg.radius,
            0.1
          )
        );
      }
    } else if (seg.type === 'circle' && seg.center && seg.radius) {
      const segments = 48;
      for (let i = 0; i <= segments; i++) {
        const angle = (Math.PI * 2 * i) / segments;
        points.push(
          new THREE.Vector3(
            (seg?.center?.x ?? 0) + Math.cos(angle) * seg.radius,
            (seg?.center?.y ?? 0) + Math.sin(angle) * seg.radius,
            0.1
          )
        );
      }
    }
  }

  if (points.length >= 2) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineSegments(geo, mat);
    group.add(line);
  }

  return group;
}

/**
 * Create silkscreen text and shapes.
 */
export function createSilkscreenGeometry(items: SilkscreenItem[], layer: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `silk_${layer}`;

  const color = layer.startsWith('F') ? '#ffffff' : '#cccccc';
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const lineMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.7,
  });

  const layerItems = !layer ? items : items.filter((i: any) =>
    i.layer === layer || i.layerId === layer || i.layer_id === layer
  );

  for (const item of layerItems) {
    if (item.type === 'text' && item.text) {
      // Render text as a simple rectangle placeholder
      // (Full text rendering requires font loading / SDF which is complex)
      const size = item.size ?? 1;
      const width = item.text.length * size * 0.6;
      const height = size;
      const geo = new THREE.PlaneGeometry(width, height);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.material.opacity = 0.15;
      mesh.position.set(
        px(item) + width / 2,
        py(item),
        0.06
      );
      if (item.rotation) {
        mesh.rotation.z = (item.rotation * Math.PI) / 180;
      }
      mesh.userData = { type: 'silkscreen', id: item.id, text: item.text };
      group.add(mesh);
    } else if (item.type === 'line' && item.points && item.points.length >= 2) {
      const pts = item.points.map((p: Point) => new THREE.Vector3(p.x, p.y, 0.06));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, lineMat);
      group.add(line);
    } else if (item.type === 'circle' && item.size) {
      const circGeo = new THREE.RingGeometry(
        item.size / 2 - (item.thickness ?? 0.1) / 2,
        item.size / 2 + (item.thickness ?? 0.1) / 2,
        24
      );
      const circ = new THREE.Mesh(circGeo, mat);
      circ.position.set(px(item), py(item), 0.06);
      group.add(circ);
    } else if (item.type === 'polygon' && item.points && item.points.length >= 3) {
      try {
        const shape = new THREE.Shape();
        shape.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) {
          shape.lineTo(item.points[i].x, item.points[i].y);
        }
        shape.closePath();
        const shapeGeo = new THREE.ShapeGeometry(shape);
        const shapeMesh = new THREE.Mesh(shapeGeo, mat);
        shapeMesh.position.z = 0.06;
        group.add(shapeMesh);
      } catch {
        // skip
      }
    }
  }

  return group;
}

/**
 * Create annotation markers for review violations.
 */
export function createAnnotationMarkers(violations: ReviewItem[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'annotations';

  for (const item of violations) {
    if (!item.location) continue;

    const color = SEVERITY_COLORS[item.severity] ?? 0xffffff;
    const radius = item.location.radius ?? 1.5;

    // Outer glow ring
    const ringGeo = new THREE.RingGeometry(radius * 0.8, radius, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set((item?.location?.x ?? px(item)), (item?.location?.y ?? py(item)), 0.2);
    group.add(ring);

    // Center dot
    const dotGeo = new THREE.CircleGeometry(radius * 0.35, 16);
    const dotMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set((item?.location?.x ?? px(item)), (item?.location?.y ?? py(item)), 0.21);
    dot.userData = {
      type: 'annotation',
      id: item.id,
      severity: item.severity,
      title: item.title,
    };
    group.add(dot);

    // Pulsing outer ring (larger, more transparent)
    const pulseGeo = new THREE.RingGeometry(radius * 1.2, radius * 1.4, 24);
    const pulseMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.position.set((item?.location?.x ?? px(item)), (item?.location?.y ?? py(item)), 0.19);
    pulse.userData = { pulse: true };
    group.add(pulse);
  }

  return group;
}

/**
 * Create the board background (green PCB substrate).
 */
export function createBoardBackground(
  width: number,
  height: number,
  centerX: number,
  centerY: number
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width * 1.05, height * 1.05);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x1a472a,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(centerX, centerY, -0.1);
  mesh.name = 'board_background';
  return mesh;
}

/**
 * Create grid overlay for the viewer.
 */
export function createGrid(
  width: number,
  height: number,
  spacing: number,
  centerX: number,
  centerY: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grid';

  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.04,
  });

  const halfW = width / 2;
  const halfH = height / 2;

  // Vertical lines
  for (let x = -halfW; x <= halfW; x += spacing) {
    const pts = [
      new THREE.Vector3(centerX + x, centerY - halfH, -0.2),
      new THREE.Vector3(centerX + x, centerY + halfH, -0.2),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, mat));
  }

  // Horizontal lines
  for (let y = -halfH; y <= halfH; y += spacing) {
    const pts = [
      new THREE.Vector3(centerX - halfW, centerY + y, -0.2),
      new THREE.Vector3(centerX + halfW, centerY + y, -0.2),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, mat));
  }

  return group;
}
