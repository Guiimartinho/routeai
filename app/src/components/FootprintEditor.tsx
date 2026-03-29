// ─── FootprintEditor.tsx ─ Full footprint creation/editing dialog ───────────
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { theme } from '../styles/theme';
import type { PadShape } from '../types';
import type { FootprintDef, FootprintPad, SilkLine } from '../store/footprintData';

// ─── Local types ────────────────────────────────────────────────────────────

type PadType = 'smd' | 'th' | 'npth';

interface EditorPad extends FootprintPad {
  padId: string;
  padType: PadType;
}

interface FootprintData {
  name: string;
  description: string;
  pads: EditorPad[];
  silkscreen: SilkLine[];
  courtyard: { width: number; height: number };
  courtyardMargin: number;
  origin: { x: number; y: number };
}

interface SavedFootprint {
  key: string;
  data: FootprintData;
  savedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'routeai_custom_footprints';
const PAD_SHAPES: PadShape[] = ['circle', 'rect', 'oval', 'roundrect'];
const PAD_TYPES: PadType[] = ['smd', 'th', 'npth'];
const LAYERS = ['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu', 'F.Mask', 'B.Mask', 'F.Paste', 'B.Paste'];
const GRID_SIZE = 0.25; // mm
const CANVAS_W = 500;
const CANVAS_H = 400;
const SCALE = 30; // pixels per mm

let _padIdCounter = 0;
function nextPadId(): string {
  return `pad_${++_padIdCounter}_${Date.now()}`;
}

function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function roundMm(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ─── Quick templates ────────────────────────────────────────────────────────

interface QuickTemplate {
  label: string;
  generate: () => FootprintData;
}

function makeSmdChip(name: string, padW: number, padH: number, span: number, cyW: number, cyH: number): FootprintData {
  const hs = span / 2;
  return {
    name, description: `SMD chip ${name}`,
    pads: [
      { padId: nextPadId(), number: '1', x: -hs, y: 0, width: padW, height: padH, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
      { padId: nextPadId(), number: '2', x: hs, y: 0, width: padW, height: padH, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
    ],
    silkscreen: rectSilk(cyW, cyH),
    courtyard: { width: cyW, height: cyH },
    courtyardMargin: 0.25,
    origin: { x: 0, y: 0 },
  };
}

function rectSilk(w: number, h: number): SilkLine[] {
  const hw = w / 2, hh = h / 2;
  return [
    { x1: -hw, y1: -hh, x2: hw, y2: -hh },
    { x1: hw, y1: -hh, x2: hw, y2: hh },
    { x1: hw, y1: hh, x2: -hw, y2: hh },
    { x1: -hw, y1: hh, x2: -hw, y2: -hh },
  ];
}

function makeDualRow(name: string, pinCount: number, pitch: number, padW: number, padH: number, spanX: number, cyW: number, cyH: number, drill?: number): FootprintData {
  const padsPerSide = pinCount / 2;
  const totalPitch = (padsPerSide - 1) * pitch;
  const startY = -totalPitch / 2;
  const halfSpanX = spanX / 2;
  const pads: EditorPad[] = [];
  const pType: PadType = drill ? 'th' : 'smd';
  const layers = drill ? ['F.Cu', 'B.Cu'] : ['F.Cu'];

  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(i + 1),
      x: -halfSpanX, y: roundMm(startY + i * pitch),
      width: padW, height: padH, shape: 'rect',
      drill, layers, padType: pType,
    });
  }
  for (let i = 0; i < padsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(padsPerSide + i + 1),
      x: halfSpanX, y: roundMm(startY + (padsPerSide - 1 - i) * pitch),
      width: padW, height: padH, shape: 'rect',
      drill, layers, padType: pType,
    });
  }

  return {
    name, description: `${name} package`,
    pads,
    silkscreen: rectSilk(cyW, cyH),
    courtyard: { width: cyW, height: cyH },
    courtyardMargin: 0.25,
    origin: { x: 0, y: 0 },
  };
}

function makeSOT23(): FootprintData {
  return {
    name: 'SOT-23', description: 'SOT-23 3-pin',
    pads: [
      { padId: nextPadId(), number: '1', x: -0.95, y: 1.0, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
      { padId: nextPadId(), number: '2', x: 0.95, y: 1.0, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
      { padId: nextPadId(), number: '3', x: 0, y: -1.0, width: 0.6, height: 0.7, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
    ],
    silkscreen: rectSilk(1.7, 2.9),
    courtyard: { width: 2.5, height: 3.2 },
    courtyardMargin: 0.25,
    origin: { x: 0, y: 0 },
  };
}

function makeQFP32(): FootprintData {
  const pinsPerSide = 8;
  const pitch = 0.8;
  const padW = 1.5, padH = 0.4;
  const span = 4.4;
  const totalPitch = (pinsPerSide - 1) * pitch;
  const startOffset = -totalPitch / 2;
  const halfSpan = span / 2;
  const pads: EditorPad[] = [];
  let pin = 1;

  // Bottom (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(pin++),
      x: roundMm(startOffset + i * pitch), y: halfSpan,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'], padType: 'smd',
    });
  }
  // Right (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(pin++),
      x: halfSpan, y: roundMm(startOffset + (pinsPerSide - 1 - i) * pitch),
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'], padType: 'smd',
    });
  }
  // Top (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(pin++),
      x: roundMm(startOffset + (pinsPerSide - 1 - i) * pitch), y: -halfSpan,
      width: padH, height: padW, shape: 'rect', layers: ['F.Cu'], padType: 'smd',
    });
  }
  // Left (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      padId: nextPadId(), number: String(pin++),
      x: -halfSpan, y: roundMm(startOffset + i * pitch),
      width: padW, height: padH, shape: 'rect', layers: ['F.Cu'], padType: 'smd',
    });
  }

  return {
    name: 'QFP-32', description: 'QFP-32 0.8mm pitch',
    pads,
    silkscreen: rectSilk(7.0, 7.0),
    courtyard: { width: 8.0, height: 8.0 },
    courtyardMargin: 0.25,
    origin: { x: 0, y: 0 },
  };
}

const QUICK_TEMPLATES: QuickTemplate[] = [
  { label: '0402', generate: () => makeSmdChip('0402', 0.5, 0.5, 0.8, 1.6, 0.8) },
  { label: '0603', generate: () => makeSmdChip('0603', 0.6, 0.6, 1.2, 2.2, 1.2) },
  { label: '0805', generate: () => makeSmdChip('0805', 0.7, 0.8, 1.6, 2.8, 1.6) },
  { label: 'SOT-23', generate: makeSOT23 },
  { label: 'DIP-8', generate: () => makeDualRow('DIP-8', 8, 2.54, 1.6, 1.0, 7.62, 10.2, 10.2, 1.0) },
  { label: 'SOIC-8', generate: () => makeDualRow('SOIC-8', 8, 1.27, 1.5, 0.6, 5.4, 6.0, 5.2) },
  { label: 'QFP-32', generate: makeQFP32 },
];

// ─── Styles (shared base) ───────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 5000,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const dialogStyle: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '10px',
  boxShadow: theme.shadowLg,
  width: '1100px',
  maxWidth: '95vw',
  height: '700px',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const panelStyle: React.CSSProperties = {
  background: theme.bg2,
  borderRadius: '6px',
  border: theme.border,
  padding: '10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const inputStyle: React.CSSProperties = {
  background: theme.bg0,
  border: theme.border,
  borderRadius: '4px',
  color: theme.textPrimary,
  fontSize: theme.fontSm,
  fontFamily: theme.fontMono,
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const btnStyle: React.CSSProperties = {
  background: theme.bg3,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textSecondary,
  fontSize: '11px',
  fontFamily: theme.fontSans,
  fontWeight: 500,
  padding: '4px 10px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  whiteSpace: 'nowrap',
};

const btnAccent: React.CSSProperties = { ...btnStyle, borderColor: theme.blue, color: theme.blue };
const btnGreen: React.CSSProperties = { ...btnStyle, borderColor: theme.green, color: theme.green };

const labelStyle: React.CSSProperties = {
  fontSize: '10px', color: theme.textMuted, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadCustomFootprints(): SavedFootprint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomFootprints(fps: SavedFootprint[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fps));
}

function defaultFootprintData(): FootprintData {
  return {
    name: 'New Footprint',
    description: '',
    pads: [
      { padId: nextPadId(), number: '1', x: -0.75, y: 0, width: 0.6, height: 0.6, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
      { padId: nextPadId(), number: '2', x: 0.75, y: 0, width: 0.6, height: 0.6, shape: 'rect', layers: ['F.Cu'], padType: 'smd' },
    ],
    silkscreen: rectSilk(2.0, 1.2),
    courtyard: { width: 2.5, height: 1.5 },
    courtyardMargin: 0.25,
    origin: { x: 0, y: 0 },
  };
}

/** Convert FootprintData to FootprintDef (compatible with footprintData.ts) */
function toFootprintDef(data: FootprintData): FootprintDef {
  return {
    id: data.name.replace(/\s+/g, '_'),
    name: data.name,
    pads: data.pads.map(p => ({
      number: p.number, x: p.x, y: p.y,
      width: p.width, height: p.height,
      shape: p.shape,
      drill: p.drill,
      layers: p.layers,
    })),
    courtyard: data.courtyard,
    silkscreen: data.silkscreen,
    origin: data.origin,
  };
}

function layersForPadType(padType: PadType): string[] {
  switch (padType) {
    case 'smd': return ['F.Cu'];
    case 'th': return ['F.Cu', 'B.Cu'];
    case 'npth': return ['F.Cu', 'B.Cu'];
  }
}

// ─── Pad color by layer ─────────────────────────────────────────────────────

function padColor(pad: EditorPad): string {
  if (pad.layers.includes('F.Cu') && pad.layers.includes('B.Cu')) return theme.purple;
  if (pad.layers.includes('B.Cu')) return theme.layers['B.Cu'];
  return theme.layers['F.Cu'];
}

// ─── Component ──────────────────────────────────────────────────────────────

interface FootprintEditorProps {
  open: boolean;
  onClose: () => void;
}

const FootprintEditor: React.FC<FootprintEditorProps> = ({ open, onClose }) => {
  const [fp, setFp] = useState<FootprintData>(defaultFootprintData);
  const [selectedPadId, setSelectedPadId] = useState<string | null>(null);
  const [draggingPadId, setDraggingPadId] = useState<string | null>(null);
  const [savedFootprints, setSavedFootprints] = useState<SavedFootprint[]>(loadCustomFootprints);
  const [drawingSilk, setDrawingSilk] = useState<{ x1: number; y1: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (open) setSavedFootprints(loadCustomFootprints());
  }, [open]);

  // ── SVG coordinate conversion (mm) ─────────────────────────────────
  const svgPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vbW = CANVAS_W / SCALE;
    const vbH = CANVAS_H / SCALE;
    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    return {
      x: roundMm(snap((clientX - rect.left) * scaleX - vbW / 2)),
      y: roundMm(snap((clientY - rect.top) * scaleY - vbH / 2)),
    };
  }, []);

  // ── Pad operations ─────────────────────────────────────────────────
  const addPad = useCallback(() => {
    const nextNum = String(fp.pads.length + 1);
    const newPad: EditorPad = {
      padId: nextPadId(),
      number: nextNum,
      x: 0, y: 0,
      width: 0.6, height: 0.6,
      shape: 'rect',
      layers: ['F.Cu'],
      padType: 'smd',
    };
    setFp(s => ({ ...s, pads: [...s.pads, newPad] }));
    setSelectedPadId(newPad.padId);
  }, [fp.pads.length]);

  const removePad = useCallback((id: string) => {
    setFp(s => ({ ...s, pads: s.pads.filter(p => p.padId !== id) }));
    if (selectedPadId === id) setSelectedPadId(null);
  }, [selectedPadId]);

  const updatePad = useCallback((id: string, updates: Partial<EditorPad>) => {
    setFp(s => ({
      ...s,
      pads: s.pads.map(p => {
        if (p.padId !== id) return p;
        const merged = { ...p, ...updates };
        // Sync layers when padType changes
        if (updates.padType && updates.padType !== p.padType) {
          merged.layers = layersForPadType(updates.padType);
          if (updates.padType === 'th' && !merged.drill) merged.drill = 0.8;
          if (updates.padType === 'npth') { merged.drill = merged.drill || 1.0; }
          if (updates.padType === 'smd') { delete merged.drill; }
        }
        return merged;
      }),
    }));
  }, []);

  // ── Auto-calculate courtyard ───────────────────────────────────────
  const autoCourtyard = useCallback(() => {
    if (fp.pads.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of fp.pads) {
      minX = Math.min(minX, p.x - p.width / 2);
      maxX = Math.max(maxX, p.x + p.width / 2);
      minY = Math.min(minY, p.y - p.height / 2);
      maxY = Math.max(maxY, p.y + p.height / 2);
    }
    const margin = fp.courtyardMargin;
    setFp(s => ({
      ...s,
      courtyard: {
        width: roundMm(maxX - minX + margin * 2),
        height: roundMm(maxY - minY + margin * 2),
      },
    }));
  }, [fp.pads, fp.courtyardMargin]);

  // ── Canvas mouse handlers ──────────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pt = svgPoint(e.clientX, e.clientY);

    // Check if clicking on a pad
    for (const p of fp.pads) {
      const dx = Math.abs(pt.x - p.x);
      const dy = Math.abs(pt.y - p.y);
      if (dx < p.width / 2 + 0.2 && dy < p.height / 2 + 0.2) {
        setDraggingPadId(p.padId);
        setSelectedPadId(p.padId);
        return;
      }
    }

    // Silkscreen drawing
    if (drawingSilk) {
      setFp(s => ({
        ...s,
        silkscreen: [...s.silkscreen, { x1: drawingSilk.x1, y1: drawingSilk.y1, x2: pt.x, y2: pt.y }],
      }));
      setDrawingSilk(null);
    }

    setSelectedPadId(null);
  }, [fp.pads, drawingSilk, svgPoint]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = svgPoint(e.clientX, e.clientY);
    setMousePos(pt);
    if (draggingPadId) {
      updatePad(draggingPadId, { x: pt.x, y: pt.y });
    }
  }, [draggingPadId, svgPoint, updatePad]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingPadId(null);
  }, []);

  // ── Save / Load / Export / Import ──────────────────────────────────
  const handleSave = useCallback(() => {
    const key = fp.name.toLowerCase().replace(/\s+/g, '_');
    const existing = savedFootprints.filter(s => s.key !== key);
    const updated: SavedFootprint[] = [
      ...existing,
      { key, data: fp, savedAt: new Date().toISOString() },
    ];
    saveCustomFootprints(updated);
    setSavedFootprints(updated);
    window.alert(`Footprint "${fp.name}" saved to custom library.`);
  }, [fp, savedFootprints]);

  const handleLoad = useCallback((saved: SavedFootprint) => {
    setFp(saved.data);
    setSelectedPadId(null);
  }, []);

  const handleDelete = useCallback((key: string) => {
    const updated = savedFootprints.filter(s => s.key !== key);
    saveCustomFootprints(updated);
    setSavedFootprints(updated);
  }, [savedFootprints]);

  const handleExportJSON = useCallback(() => {
    const json = JSON.stringify({ type: 'routeai_footprint', version: 1, footprint: fp }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fp.name.replace(/\s+/g, '_')}.footprint.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fp]);

  const handleImportJSON = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed.type === 'routeai_footprint' && parsed.footprint) {
          setFp(parsed.footprint);
          setSelectedPadId(null);
        } else {
          window.alert('Invalid footprint file format.');
        }
      } catch {
        window.alert('Failed to parse footprint file.');
      }
    };
    input.click();
  }, []);

  const handleTemplate = useCallback((tpl: QuickTemplate) => {
    setFp(tpl.generate());
    setSelectedPadId(null);
  }, []);

  const handleStartSilkDraw = useCallback(() => {
    // Toggle silk drawing mode
    if (drawingSilk) {
      setDrawingSilk(null);
    } else {
      setDrawingSilk(null);
      // Will start on next canvas click
      window.alert('Click two points on the canvas to draw a silkscreen line.');
      const handler = (e: MouseEvent) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const vbW = CANVAS_W / SCALE;
        const vbH = CANVAS_H / SCALE;
        const x = roundMm(snap((e.clientX - rect.left) * (vbW / rect.width) - vbW / 2));
        const y = roundMm(snap((e.clientY - rect.top) * (vbH / rect.height) - vbH / 2));
        setDrawingSilk({ x1: x, y1: y });
        window.removeEventListener('click', handler, true);
      };
      // Use a timeout so alert doesn't interfere
      setTimeout(() => window.addEventListener('click', handler, { once: true, capture: true }), 100);
    }
  }, [drawingSilk]);

  const handleClearSilk = useCallback(() => {
    setFp(s => ({ ...s, silkscreen: [] }));
    setDrawingSilk(null);
  }, []);

  if (!open) return null;

  const selectedPad = fp.pads.find(p => p.padId === selectedPadId) || null;
  const vbW = CANVAS_W / SCALE;
  const vbH = CANVAS_H / SCALE;
  const halfCyW = fp.courtyard.width / 2;
  const halfCyH = fp.courtyard.height / 2;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: `1px solid ${theme.bg3}`,
          background: theme.bg2,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>{'\u2B22'}</span>
            <span style={{ fontSize: theme.fontLg, fontWeight: 700, color: theme.textPrimary }}>Footprint Editor</span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={btnStyle} onClick={handleImportJSON}>Import JSON</button>
            <button style={btnStyle} onClick={handleExportJSON}>Export JSON</button>
            <button style={btnGreen} onClick={handleSave}>Save to Library</button>
            <button style={btnStyle} onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '10px', gap: '10px' }}>

          {/* Left: Library + templates */}
          <div style={{ ...panelStyle, width: '170px', minWidth: '170px', overflow: 'auto' }}>
            <span style={labelStyle}>Quick Templates</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {QUICK_TEMPLATES.map(tpl => (
                <button
                  key={tpl.label} style={{ ...btnStyle, fontSize: '10px', padding: '3px 8px' }}
                  onClick={() => handleTemplate(tpl)}
                >
                  {tpl.label}
                </button>
              ))}
            </div>

            <span style={{ ...labelStyle, marginTop: '8px' }}>Custom Library</span>
            {savedFootprints.length === 0 && (
              <span style={{ fontSize: '10px', color: theme.textMuted }}>No saved footprints</span>
            )}
            {savedFootprints.map(s => (
              <div key={s.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 6px', borderRadius: '3px', cursor: 'pointer',
                background: theme.bg0, fontSize: '11px',
              }}>
                <span
                  style={{ color: theme.textPrimary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => handleLoad(s)}
                  title={`Load: ${s.data.name}`}
                >
                  {s.data.name}
                </span>
                <span
                  style={{ color: theme.red, cursor: 'pointer', marginLeft: '4px', fontSize: '10px' }}
                  onClick={() => handleDelete(s.key)}
                  title="Delete"
                >
                  x
                </span>
              </div>
            ))}
          </div>

          {/* Center: Canvas */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Info fields */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>Name</span>
                <input
                  style={inputStyle}
                  value={fp.name}
                  onChange={(e) => setFp(s => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div style={{ flex: 2 }}>
                <span style={labelStyle}>Description</span>
                <input
                  style={inputStyle}
                  value={fp.description}
                  onChange={(e) => setFp(s => ({ ...s, description: e.target.value }))}
                />
              </div>
              <div>
                <span style={labelStyle}>CY Margin</span>
                <input
                  type="number" style={{ ...inputStyle, width: '55px' }}
                  value={fp.courtyardMargin} min={0} step={0.05}
                  onChange={(e) => setFp(s => ({ ...s, courtyardMargin: Number(e.target.value) }))}
                />
              </div>
              <button style={btnAccent} onClick={autoCourtyard} title="Auto-calculate courtyard from pads + margin">
                Auto CY
              </button>
            </div>

            {/* SVG Canvas */}
            <div style={{
              flex: 1, background: theme.brdBackground, borderRadius: '6px', border: theme.border,
              position: 'relative', overflow: 'hidden',
            }}>
              {/* Silk draw controls */}
              <div style={{
                position: 'absolute', top: '6px', left: '6px', zIndex: 10,
                display: 'flex', gap: '4px',
              }}>
                <button style={btnStyle} onClick={handleStartSilkDraw}>
                  {drawingSilk ? 'Cancel Silk' : 'Draw Silk'}
                </button>
                <button style={btnStyle} onClick={handleClearSilk}>Clear Silk</button>
                {drawingSilk && (
                  <span style={{ fontSize: '10px', color: theme.orange, alignSelf: 'center' }}>
                    Click to end silk line
                  </span>
                )}
              </div>

              <svg
                ref={svgRef}
                width="100%" height="100%"
                viewBox={`${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`}
                style={{ cursor: draggingPadId ? 'grabbing' : 'crosshair' }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              >
                {/* Grid (mm) */}
                <defs>
                  <pattern id="fpGridFine" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                    <circle cx={GRID_SIZE / 2} cy={GRID_SIZE / 2} r={0.015} fill={theme.gridDotColor} />
                  </pattern>
                  <pattern id="fpGridMajor" width={1} height={1} patternUnits="userSpaceOnUse">
                    <circle cx={0.5} cy={0.5} r={0.025} fill={theme.gridMajorColor} />
                  </pattern>
                </defs>
                <rect x={-vbW / 2} y={-vbH / 2} width={vbW} height={vbH} fill="url(#fpGridFine)" />
                <rect x={-vbW / 2} y={-vbH / 2} width={vbW} height={vbH} fill="url(#fpGridMajor)" />

                {/* Origin crosshair */}
                <line x1={-0.5} y1={0} x2={0.5} y2={0} stroke={theme.textMuted} strokeWidth={0.02} strokeDasharray="0.05,0.05" />
                <line x1={0} y1={-0.5} x2={0} y2={0.5} stroke={theme.textMuted} strokeWidth={0.02} strokeDasharray="0.05,0.05" />

                {/* Courtyard */}
                <rect
                  x={-halfCyW} y={-halfCyH}
                  width={fp.courtyard.width} height={fp.courtyard.height}
                  fill="none"
                  stroke={theme.brdCourtyard}
                  strokeWidth={0.04}
                  strokeDasharray="0.1,0.08"
                />

                {/* Silkscreen */}
                {fp.silkscreen.map((ln, i) => (
                  <line
                    key={`silk${i}`}
                    x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                    stroke={theme.layers['F.SilkS']}
                    strokeWidth={0.05}
                  />
                ))}

                {/* Drawing silk preview */}
                {drawingSilk && (
                  <line
                    x1={drawingSilk.x1} y1={drawingSilk.y1}
                    x2={mousePos.x} y2={mousePos.y}
                    stroke={theme.layers['F.SilkS']} strokeWidth={0.04} strokeDasharray="0.08,0.06"
                  />
                )}

                {/* Pads */}
                {fp.pads.map(p => {
                  const isSelected = p.padId === selectedPadId;
                  const color = padColor(p);
                  const strokeColor = isSelected ? theme.selectionColor : color;
                  const sw = isSelected ? 0.06 : 0.03;

                  let padEl: React.ReactNode;
                  if (p.shape === 'circle') {
                    const r = Math.min(p.width, p.height) / 2;
                    padEl = <circle cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={0.4} stroke={strokeColor} strokeWidth={sw} />;
                  } else if (p.shape === 'oval') {
                    padEl = <ellipse cx={p.x} cy={p.y} rx={p.width / 2} ry={p.height / 2} fill={color} fillOpacity={0.4} stroke={strokeColor} strokeWidth={sw} />;
                  } else if (p.shape === 'roundrect') {
                    const r = Math.min(p.width, p.height) * 0.15;
                    padEl = (
                      <rect
                        x={p.x - p.width / 2} y={p.y - p.height / 2}
                        width={p.width} height={p.height}
                        rx={r} fill={color} fillOpacity={0.4}
                        stroke={strokeColor} strokeWidth={sw}
                      />
                    );
                  } else {
                    padEl = (
                      <rect
                        x={p.x - p.width / 2} y={p.y - p.height / 2}
                        width={p.width} height={p.height}
                        fill={color} fillOpacity={0.4}
                        stroke={strokeColor} strokeWidth={sw}
                      />
                    );
                  }

                  return (
                    <g key={p.padId}>
                      {padEl}
                      {/* Drill hole */}
                      {p.drill && (
                        <circle cx={p.x} cy={p.y} r={p.drill / 2} fill={theme.bg0} stroke={theme.textMuted} strokeWidth={0.02} />
                      )}
                      {/* Pad number */}
                      <text
                        x={p.x} y={p.y + 0.06}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={Math.min(p.width, p.height) * 0.55}
                        fill={theme.textPrimary}
                        fontFamily={theme.fontMono}
                        style={{ pointerEvents: 'none' }}
                      >
                        {p.number}
                      </text>
                    </g>
                  );
                })}

                {/* Coordinate info */}
                <text
                  x={vbW / 2 - 0.2} y={vbH / 2 - 0.15}
                  textAnchor="end" fontSize={0.12} fill={theme.textMuted}
                  fontFamily={theme.fontMono}
                >
                  {mousePos.x.toFixed(2)}, {mousePos.y.toFixed(2)} mm
                </text>
              </svg>
            </div>

            {/* Preview */}
            <div style={{
              ...panelStyle, flexDirection: 'row', alignItems: 'center', gap: '16px',
              padding: '6px 12px',
            }}>
              <span style={labelStyle}>FootprintDef</span>
              <span style={{ fontSize: '10px', color: theme.textMuted, fontFamily: theme.fontMono }}>
                pads: {fp.pads.length} | courtyard: {fp.courtyard.width.toFixed(2)} x {fp.courtyard.height.toFixed(2)} mm
              </span>
              <span style={{ fontSize: '10px', color: theme.green, fontFamily: theme.fontMono }}>
                Compatible with footprintData
              </span>
            </div>
          </div>

          {/* Right: Pad list + editor */}
          <div style={{ ...panelStyle, width: '250px', minWidth: '250px', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={labelStyle}>Pads ({fp.pads.length})</span>
              <button style={btnAccent} onClick={addPad}>+ Add Pad</button>
            </div>

            {/* Pad list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'auto', flex: 1 }}>
              {fp.pads.map(p => (
                <div
                  key={p.padId}
                  onClick={() => setSelectedPadId(p.padId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '4px 6px', borderRadius: '4px',
                    background: p.padId === selectedPadId ? theme.blueDim : theme.bg0,
                    border: p.padId === selectedPadId ? `1px solid ${theme.blue}` : theme.border,
                    cursor: 'pointer', fontSize: '11px',
                  }}
                >
                  <span style={{
                    width: '8px', height: '8px', borderRadius: p.shape === 'circle' ? '50%' : '2px',
                    background: padColor(p), flexShrink: 0,
                  }} />
                  <span style={{ color: theme.textPrimary, fontWeight: 600, minWidth: '20px' }}>
                    {p.number}
                  </span>
                  <span style={{ color: theme.textSecondary, fontSize: '9px' }}>
                    {p.shape} {p.padType.toUpperCase()}
                  </span>
                  <span style={{ color: theme.textMuted, fontSize: '9px', fontFamily: theme.fontMono, marginLeft: 'auto' }}>
                    {p.x.toFixed(2)},{p.y.toFixed(2)}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); removePad(p.padId); }}
                    style={{ color: theme.red, cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                    title="Remove pad"
                  >
                    x
                  </span>
                </div>
              ))}
            </div>

            {/* Selected pad editor */}
            {selectedPad && (
              <div style={{ ...panelStyle, marginTop: '6px', background: theme.bg0, gap: '6px' }}>
                <span style={labelStyle}>Edit Pad #{selectedPad.number}</span>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Number</span>
                    <input
                      style={inputStyle}
                      value={selectedPad.number}
                      onChange={(e) => updatePad(selectedPad.padId, { number: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Type</span>
                    <select
                      style={selectStyle}
                      value={selectedPad.padType}
                      onChange={(e) => updatePad(selectedPad.padId, { padType: e.target.value as PadType })}
                    >
                      {PAD_TYPES.map(t => (
                        <option key={t} value={t}>{t.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Shape</span>
                    <select
                      style={selectStyle}
                      value={selectedPad.shape}
                      onChange={(e) => updatePad(selectedPad.padId, { shape: e.target.value as PadShape })}
                    >
                      {PAD_SHAPES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  {(selectedPad.padType === 'th' || selectedPad.padType === 'npth') && (
                    <div style={{ flex: 1 }}>
                      <span style={{ ...labelStyle, fontSize: '9px' }}>Drill</span>
                      <input
                        type="number" style={inputStyle}
                        value={selectedPad.drill || 0.8} min={0.1} step={0.1}
                        onChange={(e) => updatePad(selectedPad.padId, { drill: Number(e.target.value) })}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Width</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPad.width} min={0.1} step={0.05}
                      onChange={(e) => updatePad(selectedPad.padId, { width: Number(e.target.value) })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Height</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPad.height} min={0.1} step={0.05}
                      onChange={(e) => updatePad(selectedPad.padId, { height: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>X (mm)</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPad.x} step={GRID_SIZE}
                      onChange={(e) => updatePad(selectedPad.padId, { x: Number(e.target.value) })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Y (mm)</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPad.y} step={GRID_SIZE}
                      onChange={(e) => updatePad(selectedPad.padId, { y: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Layers */}
                <div>
                  <span style={{ ...labelStyle, fontSize: '9px' }}>Layers</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                    {LAYERS.map(layer => {
                      const active = selectedPad.layers.includes(layer);
                      return (
                        <button
                          key={layer}
                          style={{
                            ...btnStyle,
                            fontSize: '9px', padding: '2px 5px',
                            borderColor: active ? (theme.layers[layer] || theme.blue) : theme.bg3,
                            color: active ? (theme.layers[layer] || theme.blue) : theme.textMuted,
                            background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
                          }}
                          onClick={() => {
                            const newLayers = active
                              ? selectedPad.layers.filter(l => l !== layer)
                              : [...selectedPad.layers, layer];
                            if (newLayers.length > 0) {
                              updatePad(selectedPad.padId, { layers: newLayers });
                            }
                          }}
                        >
                          {layer}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FootprintEditor;
