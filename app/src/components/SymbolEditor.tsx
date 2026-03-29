// ─── SymbolEditor.tsx ─ Full symbol creation/editing dialog ─────────────────
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { theme } from '../styles/theme';
import type { PinType, LibPin } from '../types';
import { SYMBOL_DEFS, type SymbolDef } from './SymbolLibrary';

// ─── Local types ────────────────────────────────────────────────────────────

interface EditorPin extends LibPin {
  id: string;
}

interface SymbolData {
  name: string;
  description: string;
  bodyShape: 'rectangle' | 'custom';
  width: number;
  height: number;
  pins: EditorPin[];
  customLines: { x1: number; y1: number; x2: number; y2: number }[];
}

interface SavedSymbol {
  key: string;
  data: SymbolData;
  savedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'routeai_custom_symbols';
const PIN_TYPES: PinType[] = ['input', 'output', 'bidirectional', 'power', 'passive'];
const GRID_SIZE = 5;
const CANVAS_W = 500;
const CANVAS_H = 400;
const VIEW_PADDING = 60;

const PIN_COLORS: Record<PinType, string> = {
  input: theme.green,
  output: theme.red,
  bidirectional: theme.blue,
  power: theme.orange,
  passive: theme.textSecondary,
};

let _pinIdCounter = 0;
function nextPinId(): string {
  return `pin_${++_pinIdCounter}_${Date.now()}`;
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

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

const btnAccent: React.CSSProperties = {
  ...btnStyle,
  borderColor: theme.blue,
  color: theme.blue,
};

const btnGreen: React.CSSProperties = {
  ...btnStyle,
  borderColor: theme.green,
  color: theme.green,
};

const btnDanger: React.CSSProperties = {
  ...btnStyle,
  borderColor: theme.red,
  color: theme.red,
};

const labelStyle: React.CSSProperties = {
  fontSize: '10px',
  color: theme.textMuted,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadCustomSymbols(): SavedSymbol[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomSymbols(symbols: SavedSymbol[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

function defaultSymbolData(): SymbolData {
  return {
    name: 'New Symbol',
    description: '',
    bodyShape: 'rectangle',
    width: 40,
    height: 30,
    pins: [
      { id: nextPinId(), name: '1', number: '1', x: -25, y: 0, type: 'passive' },
      { id: nextPinId(), name: '2', number: '2', x: 25, y: 0, type: 'passive' },
    ],
    customLines: [],
  };
}

/** Convert SymbolData to the SymbolDef format used by SymbolLibrary */
function toSymbolDef(data: SymbolData): SymbolDef {
  return {
    pins: data.pins.map(p => ({ name: p.name, number: p.number, x: p.x, y: p.y, type: p.type })),
    width: data.width,
    height: data.height,
  };
}

/** Convert a built-in SymbolDef to editable SymbolData */
function fromSymbolDef(key: string, def: SymbolDef): SymbolData {
  return {
    name: key,
    description: `Imported from built-in: ${key}`,
    bodyShape: 'rectangle',
    width: def.width,
    height: def.height,
    pins: def.pins.map(p => ({ ...p, id: nextPinId() })),
    customLines: [],
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

interface SymbolEditorProps {
  open: boolean;
  onClose: () => void;
}

const SymbolEditor: React.FC<SymbolEditorProps> = ({ open, onClose }) => {
  const [symbol, setSymbol] = useState<SymbolData>(defaultSymbolData);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const [savedSymbols, setSavedSymbols] = useState<SavedSymbol[]>(loadCustomSymbols);
  const [drawingLine, setDrawingLine] = useState<{ x1: number; y1: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Reload saved symbols when dialog opens
  useEffect(() => {
    if (open) setSavedSymbols(loadCustomSymbols());
  }, [open]);

  // ── SVG coordinate conversion ──────────────────────────────────────
  const svgPoint = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    return {
      x: snapToGrid((clientX - rect.left) * scaleX - CANVAS_W / 2),
      y: snapToGrid((clientY - rect.top) * scaleY - CANVAS_H / 2),
    };
  }, []);

  // ── Pin operations ─────────────────────────────────────────────────
  const addPin = useCallback(() => {
    const nextNum = String(symbol.pins.length + 1);
    const y = symbol.pins.length * 10 - (symbol.pins.length * 10) / 2;
    const newPin: EditorPin = {
      id: nextPinId(),
      name: nextNum,
      number: nextNum,
      x: snapToGrid(-symbol.width / 2 - 5),
      y: snapToGrid(y),
      type: 'passive',
    };
    setSymbol(s => ({ ...s, pins: [...s.pins, newPin] }));
    setSelectedPinId(newPin.id);
  }, [symbol.pins.length, symbol.width]);

  const removePin = useCallback((id: string) => {
    setSymbol(s => ({ ...s, pins: s.pins.filter(p => p.id !== id) }));
    if (selectedPinId === id) setSelectedPinId(null);
  }, [selectedPinId]);

  const updatePin = useCallback((id: string, updates: Partial<EditorPin>) => {
    setSymbol(s => ({
      ...s,
      pins: s.pins.map(p => p.id === id ? { ...p, ...updates } : p),
    }));
  }, []);

  // ── Canvas mouse handlers ──────────────────────────────────────────
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pt = svgPoint(e.clientX, e.clientY);

    // Check if clicking on a pin
    for (const p of symbol.pins) {
      const dx = pt.x - p.x;
      const dy = pt.y - p.y;
      if (dx * dx + dy * dy < 64) {
        setDraggingPinId(p.id);
        setSelectedPinId(p.id);
        return;
      }
    }

    // Custom line drawing mode
    if (symbol.bodyShape === 'custom') {
      if (drawingLine) {
        setSymbol(s => ({
          ...s,
          customLines: [...s.customLines, { x1: drawingLine.x1, y1: drawingLine.y1, x2: pt.x, y2: pt.y }],
        }));
        setDrawingLine(null);
      } else {
        setDrawingLine({ x1: pt.x, y1: pt.y });
      }
    }

    setSelectedPinId(null);
  }, [symbol.pins, symbol.bodyShape, drawingLine, svgPoint]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const pt = svgPoint(e.clientX, e.clientY);
    setMousePos(pt);

    if (draggingPinId) {
      updatePin(draggingPinId, { x: pt.x, y: pt.y });
    }
  }, [draggingPinId, svgPoint, updatePin]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingPinId(null);
  }, []);

  // ── Save / Load / Export / Import ──────────────────────────────────
  const handleSave = useCallback(() => {
    const key = symbol.name.toLowerCase().replace(/\s+/g, '_');
    const existing = savedSymbols.filter(s => s.key !== key);
    const updated: SavedSymbol[] = [
      ...existing,
      { key, data: symbol, savedAt: new Date().toISOString() },
    ];
    saveCustomSymbols(updated);
    setSavedSymbols(updated);
    window.alert(`Symbol "${symbol.name}" saved to custom library.`);
  }, [symbol, savedSymbols]);

  const handleLoad = useCallback((saved: SavedSymbol) => {
    setSymbol(saved.data);
    setSelectedPinId(null);
  }, []);

  const handleLoadBuiltin = useCallback((key: string) => {
    const def = SYMBOL_DEFS[key];
    if (def) {
      setSymbol(fromSymbolDef(key, def));
      setSelectedPinId(null);
    }
  }, []);

  const handleDelete = useCallback((key: string) => {
    const updated = savedSymbols.filter(s => s.key !== key);
    saveCustomSymbols(updated);
    setSavedSymbols(updated);
  }, [savedSymbols]);

  const handleExportJSON = useCallback(() => {
    const json = JSON.stringify({ type: 'routeai_symbol', version: 1, symbol }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${symbol.name.replace(/\s+/g, '_')}.symbol.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [symbol]);

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
        if (parsed.type === 'routeai_symbol' && parsed.symbol) {
          setSymbol(parsed.symbol);
          setSelectedPinId(null);
        } else {
          window.alert('Invalid symbol file format.');
        }
      } catch {
        window.alert('Failed to parse symbol file.');
      }
    };
    input.click();
  }, []);

  const handleAutoSize = useCallback(() => {
    if (symbol.pins.length === 0) return;
    const xs = symbol.pins.map(p => Math.abs(p.x));
    const ys = symbol.pins.map(p => Math.abs(p.y));
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    setSymbol(s => ({
      ...s,
      width: snapToGrid(maxX * 2 + 10),
      height: snapToGrid(maxY * 2 + 10),
    }));
  }, [symbol.pins]);

  const handleClearCustomLines = useCallback(() => {
    setSymbol(s => ({ ...s, customLines: [] }));
    setDrawingLine(null);
  }, []);

  if (!open) return null;

  const selectedPin = symbol.pins.find(p => p.id === selectedPinId) || null;
  const halfW = symbol.width / 2;
  const halfH = symbol.height / 2;

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
            <span style={{ fontSize: '16px' }}>{'\u2699'}</span>
            <span style={{ fontSize: theme.fontLg, fontWeight: 700, color: theme.textPrimary }}>Symbol Editor</span>
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
          {/* Left: Saved symbols browser */}
          <div style={{ ...panelStyle, width: '180px', minWidth: '180px', overflow: 'auto' }}>
            <span style={labelStyle}>Library</span>

            {/* Custom symbols */}
            {savedSymbols.length > 0 && (
              <>
                <span style={{ fontSize: '10px', color: theme.textMuted, marginTop: '4px' }}>Custom</span>
                {savedSymbols.map(s => (
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
              </>
            )}

            {/* Built-in symbols */}
            <span style={{ fontSize: '10px', color: theme.textMuted, marginTop: '6px' }}>Built-in</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'auto' }}>
              {Object.keys(SYMBOL_DEFS).slice(0, 25).map(key => (
                <div
                  key={key}
                  onClick={() => handleLoadBuiltin(key)}
                  style={{
                    padding: '2px 6px', borderRadius: '3px', cursor: 'pointer',
                    fontSize: '10px', color: theme.textSecondary,
                    background: 'transparent',
                    transition: 'background 0.08s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget).style.background = theme.bg3; }}
                  onMouseLeave={(e) => { (e.currentTarget).style.background = 'transparent'; }}
                >
                  {key}
                </div>
              ))}
            </div>
          </div>

          {/* Center: Canvas */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Symbol info fields */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>Name</span>
                <input
                  style={inputStyle}
                  value={symbol.name}
                  onChange={(e) => setSymbol(s => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div style={{ flex: 2 }}>
                <span style={labelStyle}>Description</span>
                <input
                  style={inputStyle}
                  value={symbol.description}
                  onChange={(e) => setSymbol(s => ({ ...s, description: e.target.value }))}
                />
              </div>
              <div>
                <span style={labelStyle}>Body</span>
                <select
                  style={selectStyle}
                  value={symbol.bodyShape}
                  onChange={(e) => {
                    setSymbol(s => ({ ...s, bodyShape: e.target.value as 'rectangle' | 'custom' }));
                    setDrawingLine(null);
                  }}
                >
                  <option value="rectangle">Rectangle (IC)</option>
                  <option value="custom">Custom Lines</option>
                </select>
              </div>
              <div>
                <span style={labelStyle}>W</span>
                <input
                  type="number" style={{ ...inputStyle, width: '55px' }}
                  value={symbol.width} min={10} step={5}
                  onChange={(e) => setSymbol(s => ({ ...s, width: Number(e.target.value) }))}
                />
              </div>
              <div>
                <span style={labelStyle}>H</span>
                <input
                  type="number" style={{ ...inputStyle, width: '55px' }}
                  value={symbol.height} min={10} step={5}
                  onChange={(e) => setSymbol(s => ({ ...s, height: Number(e.target.value) }))}
                />
              </div>
              <button style={btnStyle} onClick={handleAutoSize} title="Auto-size body to fit pins">Auto</button>
            </div>

            {/* SVG Canvas */}
            <div style={{
              flex: 1, background: theme.bg0, borderRadius: '6px', border: theme.border,
              position: 'relative', overflow: 'hidden',
            }}>
              {symbol.bodyShape === 'custom' && (
                <div style={{
                  position: 'absolute', top: '6px', left: '6px', zIndex: 10,
                  display: 'flex', gap: '4px',
                }}>
                  <button style={btnStyle} onClick={handleClearCustomLines}>Clear Lines</button>
                  {drawingLine && (
                    <span style={{ fontSize: '10px', color: theme.orange, alignSelf: 'center' }}>
                      Click to end line segment
                    </span>
                  )}
                </div>
              )}
              <svg
                ref={svgRef}
                width="100%" height="100%"
                viewBox={`${-CANVAS_W / 2} ${-CANVAS_H / 2} ${CANVAS_W} ${CANVAS_H}`}
                style={{ cursor: draggingPinId ? 'grabbing' : 'crosshair' }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              >
                {/* Grid */}
                <defs>
                  <pattern id="symGrid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                    <circle cx={GRID_SIZE / 2} cy={GRID_SIZE / 2} r={0.4} fill={theme.gridDotColor} />
                  </pattern>
                </defs>
                <rect
                  x={-CANVAS_W / 2} y={-CANVAS_H / 2} width={CANVAS_W} height={CANVAS_H}
                  fill="url(#symGrid)"
                />

                {/* Origin crosshair */}
                <line x1={-10} y1={0} x2={10} y2={0} stroke={theme.textMuted} strokeWidth={0.3} strokeDasharray="2,2" />
                <line x1={0} y1={-10} x2={0} y2={10} stroke={theme.textMuted} strokeWidth={0.3} strokeDasharray="2,2" />

                {/* Body */}
                {symbol.bodyShape === 'rectangle' ? (
                  <rect
                    x={-halfW} y={-halfH} width={symbol.width} height={symbol.height}
                    fill={theme.schComponentBody}
                    stroke={theme.schComponentBorder}
                    strokeWidth={0.8} rx={1}
                  />
                ) : (
                  <>
                    {symbol.customLines.map((ln, i) => (
                      <line
                        key={i}
                        x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                        stroke={theme.schComponentBorder}
                        strokeWidth={0.8}
                      />
                    ))}
                  </>
                )}

                {/* Drawing line preview */}
                {drawingLine && (
                  <line
                    x1={drawingLine.x1} y1={drawingLine.y1}
                    x2={mousePos.x} y2={mousePos.y}
                    stroke={theme.blue} strokeWidth={0.6} strokeDasharray="3,2"
                  />
                )}

                {/* Pins */}
                {symbol.pins.map(p => {
                  const isSelected = p.id === selectedPinId;
                  const color = PIN_COLORS[p.type] || theme.textSecondary;
                  return (
                    <g key={p.id}>
                      {/* Pin stub line from body edge */}
                      {symbol.bodyShape === 'rectangle' && (() => {
                        // Draw line from pin to nearest body edge
                        let bx = p.x;
                        let by = p.y;
                        if (p.x < -halfW) bx = -halfW;
                        else if (p.x > halfW) bx = halfW;
                        if (p.y < -halfH) by = -halfH;
                        else if (p.y > halfH) by = halfH;
                        // Clamp to body edge
                        bx = Math.max(-halfW, Math.min(halfW, bx));
                        by = Math.max(-halfH, Math.min(halfH, by));
                        if (Math.abs(p.x) > halfW || Math.abs(p.y) > halfH) {
                          return (
                            <line x1={p.x} y1={p.y} x2={bx} y2={by}
                              stroke={theme.schComponentBorder} strokeWidth={0.8} />
                          );
                        }
                        return null;
                      })()}

                      {/* Pin circle */}
                      <circle
                        cx={p.x} cy={p.y} r={isSelected ? 3.5 : 2.5}
                        fill={isSelected ? color : theme.bg0}
                        stroke={color}
                        strokeWidth={isSelected ? 1.2 : 0.8}
                        style={{ cursor: 'grab' }}
                      />

                      {/* Pin name */}
                      <text
                        x={p.x} y={p.y - 5}
                        textAnchor="middle"
                        fontSize={3.5}
                        fill={theme.schPinName}
                        fontFamily={theme.fontMono}
                        style={{ pointerEvents: 'none' }}
                      >
                        {p.name}
                      </text>

                      {/* Pin number */}
                      <text
                        x={p.x} y={p.y + 7}
                        textAnchor="middle"
                        fontSize={2.8}
                        fill={theme.textMuted}
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
                  x={CANVAS_W / 2 - 5} y={CANVAS_H / 2 - 5}
                  textAnchor="end" fontSize={3} fill={theme.textMuted}
                  fontFamily={theme.fontMono}
                >
                  {mousePos.x}, {mousePos.y}
                </text>
              </svg>
            </div>

            {/* Preview of SymbolDef output */}
            <div style={{
              ...panelStyle, flexDirection: 'row', alignItems: 'center', gap: '16px',
              padding: '6px 12px',
            }}>
              <span style={labelStyle}>Preview (SymbolDef)</span>
              <span style={{ fontSize: '10px', color: theme.textMuted, fontFamily: theme.fontMono }}>
                pins: {symbol.pins.length} | width: {symbol.width} | height: {symbol.height}
              </span>
              <span style={{ fontSize: '10px', color: theme.green, fontFamily: theme.fontMono }}>
                Compatible with SYMBOL_DEFS
              </span>
            </div>
          </div>

          {/* Right: Pin list + editor */}
          <div style={{ ...panelStyle, width: '240px', minWidth: '240px', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={labelStyle}>Pins ({symbol.pins.length})</span>
              <button style={btnAccent} onClick={addPin}>+ Add Pin</button>
            </div>

            {/* Pin list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'auto', flex: 1 }}>
              {symbol.pins.map(p => (
                <div
                  key={p.id}
                  onClick={() => setSelectedPinId(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    background: p.id === selectedPinId ? theme.blueDim : theme.bg0,
                    border: p.id === selectedPinId ? `1px solid ${theme.blue}` : theme.border,
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: PIN_COLORS[p.type], flexShrink: 0,
                  }} />
                  <span style={{ color: theme.textPrimary, fontWeight: 600, minWidth: '20px' }}>
                    {p.number}
                  </span>
                  <span style={{ color: theme.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </span>
                  <span style={{ color: theme.textMuted, fontSize: '9px', fontFamily: theme.fontMono }}>
                    {p.x},{p.y}
                  </span>
                  <span
                    onClick={(e) => { e.stopPropagation(); removePin(p.id); }}
                    style={{ color: theme.red, cursor: 'pointer', fontSize: '10px', fontWeight: 700 }}
                    title="Remove pin"
                  >
                    x
                  </span>
                </div>
              ))}
            </div>

            {/* Selected pin editor */}
            {selectedPin && (
              <div style={{
                ...panelStyle, marginTop: '6px', background: theme.bg0,
                gap: '6px',
              }}>
                <span style={labelStyle}>Edit Pin #{selectedPin.number}</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Name</span>
                    <input
                      style={inputStyle}
                      value={selectedPin.name}
                      onChange={(e) => updatePin(selectedPin.id, { name: e.target.value })}
                    />
                  </div>
                  <div style={{ width: '50px' }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Number</span>
                    <input
                      style={inputStyle}
                      value={selectedPin.number}
                      onChange={(e) => updatePin(selectedPin.id, { number: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <span style={{ ...labelStyle, fontSize: '9px' }}>Type</span>
                  <select
                    style={selectStyle}
                    value={selectedPin.type}
                    onChange={(e) => updatePin(selectedPin.id, { type: e.target.value as PinType })}
                  >
                    {PIN_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>X</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPin.x} step={GRID_SIZE}
                      onChange={(e) => updatePin(selectedPin.id, { x: Number(e.target.value) })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ ...labelStyle, fontSize: '9px' }}>Y</span>
                    <input
                      type="number" style={inputStyle}
                      value={selectedPin.y} step={GRID_SIZE}
                      onChange={(e) => updatePin(selectedPin.id, { y: Number(e.target.value) })}
                    />
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

export default SymbolEditor;
