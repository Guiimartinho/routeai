// ─── KiCad S-Expression Importer ─────────────────────────────────────────────
// Client-side parser for .kicad_sch and .kicad_pcb files.
// Converts KiCad S-expression format into RouteAI's internal types.

import type {
  SchComponent, SchWire, SchLabel, SchPin, SchNet,
  BrdComponent, BrdPad, BrdTrace, BrdVia, BrdZone,
  BoardState, SchematicState, BoardOutline,
  Point, PinType, PadShape, LabelType, ViaType,
} from '../types';

// ─── UID generator ───────────────────────────────────────────────────────────

let _uidCounter = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++_uidCounter).toString(36)}`;
}

// ─── Arc interpolation ──────────────────────────────────────────────────────
// Given 3 points on an arc (start, mid, end), compute the circumscribed circle
// and generate `segments` intermediate points along the arc.

function interpolateArc(p1: Point, p2: Point, p3: Point, segments: number): Point[] {
  // Find circumscribed circle center using perpendicular bisectors.
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));

  // If D is ~0 the points are colinear; fall back to straight line.
  if (Math.abs(D) < 1e-10) {
    return [p1, p2, p3];
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) +
              (bx * bx + by * by) * (cy - ay) +
              (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) +
              (bx * bx + by * by) * (ax - cx) +
              (cx * cx + cy * cy) * (bx - ax)) / D;

  // Angles from center to each point.
  let startAngle = Math.atan2(ay - uy, ax - ux);
  const midAngle   = Math.atan2(by - uy, bx - ux);
  let endAngle   = Math.atan2(cy - uy, cx - ux);

  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

  // Determine arc direction (CW vs CCW) by checking whether the mid point
  // lies on the short arc going CCW from start to end.
  // Normalize angles to [0, 2PI).
  const twoPi = 2 * Math.PI;
  const normalize = (a: number) => ((a % twoPi) + twoPi) % twoPi;

  let sa = normalize(startAngle);
  const ma = normalize(midAngle);
  let ea = normalize(endAngle);

  // Compute CCW sweep from start to end.
  let ccwSweep = normalize(ea - sa);
  // Check if mid lies within the CCW sweep.
  const midInCcw = ccwSweep > 0 &&
    (normalize(ma - sa) < ccwSweep);

  let sweep: number;
  if (midInCcw) {
    // Arc goes CCW from start to end (positive sweep).
    sweep = ccwSweep;
  } else {
    // Arc goes CW — use the negative (clockwise) sweep.
    sweep = ccwSweep - twoPi;
  }

  // Generate interpolated points along the arc.
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = sa + sweep * t;
    points.push({
      x: ux + radius * Math.cos(angle),
      y: uy + radius * Math.sin(angle),
    });
  }

  return points;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── S-EXPRESSION PARSER ─────────────────────────────────────────────────────
// Handles parenthesized lists, quoted strings, numbers, bare tokens, comments.
// ═══════════════════════════════════════════════════════════════════════════════

export type SExpr = string | number | SExpr[];

/**
 * Parse a KiCad S-expression string into nested arrays.
 * Handles:
 *   - Parenthesized lists: (tag value1 value2 (subtag ...))
 *   - Quoted strings: "hello world" with backslash escapes
 *   - Numbers: integers and floats (including negative)
 *   - Bare tokens (identifiers)
 *   - Comments: lines starting with # (rare in KiCad but spec'd)
 */
export function parseSExpr(text: string): SExpr[] {
  let pos = 0;
  const len = text.length;

  function skipWhitespaceAndComments(): void {
    while (pos < len) {
      const ch = text[pos];
      // Whitespace
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        pos++;
        continue;
      }
      // Comment: # to end of line (used in some KiCad files)
      if (ch === '#') {
        while (pos < len && text[pos] !== '\n') pos++;
        continue;
      }
      break;
    }
  }

  function parseQuotedString(): string {
    pos++; // skip opening "
    let result = '';
    while (pos < len) {
      const ch = text[pos];
      if (ch === '\\' && pos + 1 < len) {
        pos++;
        const esc = text[pos];
        if (esc === 'n') result += '\n';
        else if (esc === 't') result += '\t';
        else if (esc === '"') result += '"';
        else if (esc === '\\') result += '\\';
        else result += esc;
        pos++;
        continue;
      }
      if (ch === '"') {
        pos++; // skip closing "
        return result;
      }
      result += ch;
      pos++;
    }
    console.warn('KiCad import: unterminated string at position', pos);
    return result; // unterminated string
  }

  function parseToken(): string | number {
    const start = pos;
    while (pos < len) {
      const ch = text[pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' ||
          ch === '(' || ch === ')' || ch === '"') {
        break;
      }
      pos++;
    }
    const token = text.slice(start, pos);
    // Try to parse as number
    if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
      const num = Number(token);
      if (!isNaN(num)) return num;
    }
    return token;
  }

  function parseList(): SExpr[] {
    pos++; // skip (
    const items: SExpr[] = [];
    while (pos < len) {
      skipWhitespaceAndComments();
      if (pos >= len) break;
      if (text[pos] === ')') {
        pos++; // skip )
        return items;
      }
      items.push(parseOne());
    }
    console.warn('KiCad import: unterminated list at position', pos);
    return items; // unterminated list
  }

  function parseOne(): SExpr {
    skipWhitespaceAndComments();
    if (pos >= len) return '';
    const ch = text[pos];
    if (ch === '(') return parseList();
    if (ch === '"') return parseQuotedString();
    return parseToken();
  }

  // Parse top-level: may be a single expression or multiple
  const results: SExpr[] = [];
  while (pos < len) {
    skipWhitespaceAndComments();
    if (pos >= len) break;
    results.push(parseOne());
  }

  // KiCad files are typically a single top-level expression
  // Return the content if there's exactly one top-level list
  if (results.length === 1 && Array.isArray(results[0])) {
    return results[0] as SExpr[];
  }
  return results;
}

// ─── S-Expression Query Helpers ──────────────────────────────────────────────

/** Get the tag (first element) of an s-expression list */
function tag(expr: SExpr): string {
  if (Array.isArray(expr) && expr.length > 0 && typeof expr[0] === 'string') {
    return expr[0];
  }
  return '';
}

/** Find all child lists with a given tag */
function findAll(list: SExpr[], tagName: string): SExpr[][] {
  const results: SExpr[][] = [];
  for (const item of list) {
    if (Array.isArray(item) && tag(item) === tagName) {
      results.push(item);
    }
  }
  return results;
}

/** Find first child list with a given tag */
function findFirst(list: SExpr[], tagName: string): SExpr[] | null {
  for (const item of list) {
    if (Array.isArray(item) && tag(item) === tagName) {
      return item;
    }
  }
  return null;
}

/** Get the first value after a tag: (tag value) -> value */
function getValue(list: SExpr[], tagName: string): string | number | null {
  const node = findFirst(list, tagName);
  if (node && node.length >= 2) {
    return node[1] as string | number;
  }
  return null;
}

/** Get a numeric value, defaulting to 0 */
function getNum(list: SExpr[], tagName: string, defaultVal: number = 0): number {
  const v = getValue(list, tagName);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? defaultVal : n;
  }
  return defaultVal;
}

/** Get a string value */
function getStr(list: SExpr[], tagName: string, defaultVal: string = ''): string {
  const v = getValue(list, tagName);
  if (v === null) return defaultVal;
  return String(v);
}

/** Extract (at x y) or (at x y angle) */
function getAt(list: SExpr[]): { x: number; y: number; angle: number } {
  const at = findFirst(list, 'at');
  if (!at) return { x: 0, y: 0, angle: 0 };
  return {
    x: typeof at[1] === 'number' ? at[1] : parseFloat(String(at[1])) || 0,
    y: typeof at[2] === 'number' ? at[2] : parseFloat(String(at[2])) || 0,
    angle: at.length >= 4 && typeof at[3] === 'number' ? at[3] :
           at.length >= 4 ? parseFloat(String(at[3])) || 0 : 0,
  };
}

/** Extract (xy x y) */
function getXY(list: SExpr[]): Point {
  if (list.length >= 3) {
    return {
      x: typeof list[1] === 'number' ? list[1] : parseFloat(String(list[1])) || 0,
      y: typeof list[2] === 'number' ? list[2] : parseFloat(String(list[2])) || 0,
    };
  }
  return { x: 0, y: 0 };
}

/** Extract (start x y) or (end x y) */
function getPoint(list: SExpr[], tagName: string): Point {
  const node = findFirst(list, tagName);
  if (!node || node.length < 3) return { x: 0, y: 0 };
  return {
    x: typeof node[1] === 'number' ? node[1] : parseFloat(String(node[1])) || 0,
    y: typeof node[2] === 'number' ? node[2] : parseFloat(String(node[2])) || 0,
  };
}

/** Extract (size w h) */
function getSize(list: SExpr[]): { w: number; h: number } {
  const node = findFirst(list, 'size');
  if (!node || node.length < 3) return { w: 0, h: 0 };
  return {
    w: typeof node[1] === 'number' ? node[1] : parseFloat(String(node[1])) || 0,
    h: typeof node[2] === 'number' ? node[2] : parseFloat(String(node[2])) || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── KICAD SCHEMATIC IMPORTER (.kicad_sch) ───────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** Map KiCad pin electrical type to our PinType */
function mapPinType(kicadType: string): PinType {
  switch (kicadType.toLowerCase()) {
    case 'input': return 'input';
    case 'output': return 'output';
    case 'bidirectional': case 'tri_state': return 'bidirectional';
    case 'power_in': case 'power_out': return 'power';
    case 'passive': case 'free': case 'unspecified': case 'unconnected':
    case 'no_connect': case 'open_collector': case 'open_emitter':
    default: return 'passive';
  }
}

/**
 * Parse a KiCad 7/8 symbol definition within the schematic.
 * Returns the pin definitions relative to symbol origin.
 */
function parseSymbolPins(symbolDef: SExpr[]): SchPin[] {
  const pins: SchPin[] = [];

  // Recursively find pins in symbol and its sub-units
  function collectPins(node: SExpr[]): void {
    for (const child of node) {
      if (!Array.isArray(child)) continue;
      if (tag(child) === 'pin') {
        // (pin type style (at x y angle) (length len) (name "name" ...) (number "num" ...))
        const pinType = typeof child[1] === 'string' ? child[1] : 'passive';
        const at = getAt(child);
        const nameNode = findFirst(child, 'name');
        const numberNode = findFirst(child, 'number');
        const pinName = nameNode && nameNode.length >= 2 ? String(nameNode[1]) : '';
        const pinNumber = numberNode && numberNode.length >= 2 ? String(numberNode[1]) : '';
        const length = getNum(child, 'length', 2.54);

        // KiCad pin (at x y angle) already specifies the electrical connection
        // point. The pin body extends FROM this point by `length` in the
        // direction of `angle` (R=0°, U=90°, L=180°, D=270°), but the
        // connection end — the one wires attach to — is (at.x, at.y) itself.
        const connX = at.x;
        const connY = at.y;

        pins.push({
          id: uid('pin'),
          name: pinName,
          number: pinNumber,
          x: connX,
          y: connY,
          type: mapPinType(pinType),
        });
      }
      // Recurse into sub-symbols (units)
      if (tag(child) === 'symbol') {
        collectPins(child);
      }
    }
  }

  collectPins(symbolDef);
  return pins;
}

/**
 * Convert a parsed .kicad_sch file to our SchematicState.
 */
export function importKicadSchematic(text: string): {
  components: SchComponent[];
  wires: SchWire[];
  labels: SchLabel[];
} {
  const tree = parseSExpr(text);
  // tree should be (kicad_sch ...)

  if (tag(tree) !== 'kicad_sch') {
    throw new Error('Not a valid KiCad schematic file (expected kicad_sch)');
  }

  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // ── Collect symbol library definitions ──────────────────────────────
  // In .kicad_sch, the lib_symbols section has the full symbol defs
  const libSymbols = new Map<string, SExpr[]>();
  const libSection = findFirst(tree, 'lib_symbols');
  if (libSection) {
    for (const sym of findAll(libSection, 'symbol')) {
      const symName = typeof sym[1] === 'string' ? sym[1] : '';
      if (symName) {
        libSymbols.set(symName, sym);
      }
    }
  }

  // ── Parse symbol instances (components on the schematic) ────────────
  for (const symInst of findAll(tree, 'symbol')) {
    // (symbol (lib_id "Lib:Name") (at x y angle) (unit 1)
    //   (in_bom yes) (on_board yes)
    //   (property "Reference" "U1" (at ...) ...)
    //   (property "Value" "LM7805" (at ...) ...)
    //   (property "Footprint" "Package_TO:TO-220" (at ...) ...)
    //   (pin "1" (uuid ...))
    //   ...)
    const libId = getStr(symInst, 'lib_id');
    const at = getAt(symInst);

    // Mirror handling
    const mirrorNode = findFirst(symInst, 'mirror');
    const mirrorX = mirrorNode ? String(mirrorNode[1] ?? '') === 'x' || String(mirrorNode[1] ?? '') === 'y' : false;

    // Extract properties
    const properties = findAll(symInst, 'property');
    let ref = '';
    let value = '';
    let footprint = '';
    let symbolName = libId;

    for (const prop of properties) {
      const propName = typeof prop[1] === 'string' ? prop[1] : '';
      const propValue = typeof prop[2] === 'string' ? prop[2] : String(prop[2] ?? '');
      switch (propName) {
        case 'Reference': ref = propValue; break;
        case 'Value': value = propValue; break;
        case 'Footprint': footprint = propValue; break;
      }
    }

    // Skip power symbols that are just net labels (e.g., #PWR01)
    const isPower = ref.startsWith('#PWR') || ref.startsWith('#FLG');

    // Get pin definitions from lib_symbols
    let pins: SchPin[] = [];
    const libDef = libSymbols.get(libId);
    if (libDef) {
      pins = parseSymbolPins(libDef);
    }

    // If no lib def found, try to get pins from the instance's pin references
    if (pins.length === 0) {
      const pinRefs = findAll(symInst, 'pin');
      for (const pinRef of pinRefs) {
        const pinNumber = typeof pinRef[1] === 'string' ? pinRef[1] : String(pinRef[1] ?? '');
        pins.push({
          id: uid('pin'),
          name: pinNumber,
          number: pinNumber,
          x: 0,
          y: 0,
          type: 'passive',
        });
      }
    }

    // Determine component type from library name
    const type = isPower ? libId.split(':').pop()?.toLowerCase() || 'power' :
                 libId.split(':').pop() || 'unknown';

    // KiCad uses mils internally but .kicad_sch format uses mm
    // The at coordinates are already in mm in KiCad 7+
    components.push({
      id: uid('comp'),
      type,
      ref,
      value,
      x: at.x,
      y: at.y,
      rotation: at.angle,
      pins,
      symbol: symbolName,
      footprint,
    });
  }

  // ── Parse wires ─────────────────────────────────────────────────────
  for (const wire of findAll(tree, 'wire')) {
    // (wire (pts (xy x1 y1) (xy x2 y2)) (stroke ...) (uuid ...))
    const ptsNode = findFirst(wire, 'pts');
    if (!ptsNode) continue;

    const points: Point[] = [];
    for (const xy of findAll(ptsNode, 'xy')) {
      points.push(getXY(xy));
    }

    if (points.length >= 2) {
      wires.push({
        id: uid('wire'),
        points,
      });
    }
  }

  // ── Parse bus entries and polylines as additional wires ──────────────
  for (const polyline of findAll(tree, 'polyline')) {
    const ptsNode = findFirst(polyline, 'pts');
    if (!ptsNode) continue;
    const points: Point[] = [];
    for (const xy of findAll(ptsNode, 'xy')) {
      points.push(getXY(xy));
    }
    if (points.length >= 2) {
      wires.push({ id: uid('wire'), points });
    }
  }

  // ── Parse labels ────────────────────────────────────────────────────
  // Local labels: (label "NAME" (at x y angle) ...)
  for (const lbl of findAll(tree, 'label')) {
    const text = typeof lbl[1] === 'string' ? lbl[1] : String(lbl[1] ?? '');
    const at = getAt(lbl);
    labels.push({
      id: uid('lbl'),
      text,
      x: at.x,
      y: at.y,
      type: 'local',
    });
  }

  // Global labels: (global_label "NAME" (at x y angle) ...)
  for (const lbl of findAll(tree, 'global_label')) {
    const text = typeof lbl[1] === 'string' ? lbl[1] : String(lbl[1] ?? '');
    const at = getAt(lbl);
    labels.push({
      id: uid('lbl'),
      text,
      x: at.x,
      y: at.y,
      type: 'global',
    });
  }

  // Hierarchical labels
  for (const lbl of findAll(tree, 'hierarchical_label')) {
    const text = typeof lbl[1] === 'string' ? lbl[1] : String(lbl[1] ?? '');
    const at = getAt(lbl);
    labels.push({
      id: uid('lbl'),
      text,
      x: at.x,
      y: at.y,
      type: 'global',
    });
  }

  // Power flags / power port labels
  for (const lbl of findAll(tree, 'power_port')) {
    const text = typeof lbl[1] === 'string' ? lbl[1] : String(lbl[1] ?? '');
    const at = getAt(lbl);
    labels.push({
      id: uid('lbl'),
      text,
      x: at.x,
      y: at.y,
      type: 'power',
    });
  }

  return { components, wires, labels };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── KICAD PCB IMPORTER (.kicad_pcb) ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** Map KiCad pad shape to our PadShape */
function mapPadShape(kicadShape: string): PadShape {
  switch (kicadShape.toLowerCase()) {
    case 'circle': return 'circle';
    case 'rect': case 'rectangle': return 'rect';
    case 'oval': return 'oval';
    case 'roundrect': return 'roundrect';
    case 'trapezoid': return 'rect'; // approximate
    case 'custom': return 'rect'; // approximate
    default: return 'rect';
  }
}

/** Map KiCad layer name to our layer system */
function mapLayer(kicadLayer: string): string {
  // KiCad uses names like "F.Cu", "B.Cu", "In1.Cu", "F.SilkS", etc.
  // Our system uses the same naming convention
  return kicadLayer;
}

/**
 * Convert a parsed .kicad_pcb file to our BoardState.
 */
export function importKicadPCB(text: string): BoardState {
  const tree = parseSExpr(text);

  if (tag(tree) !== 'kicad_pcb') {
    throw new Error('Not a valid KiCad PCB file (expected kicad_pcb)');
  }

  const components: BrdComponent[] = [];
  const traces: BrdTrace[] = [];
  const vias: BrdVia[] = [];
  const zones: BrdZone[] = [];
  let outline: BoardOutline = { points: [] };
  const layerSet = new Set<string>();

  // ── Collect layer definitions ───────────────────────────────────────
  const layersNode = findFirst(tree, 'layers');
  if (layersNode) {
    for (const child of layersNode) {
      if (Array.isArray(child) && child.length >= 3) {
        const layerName = String(child[1]);
        layerSet.add(layerName);
      }
    }
  }
  // Default layers if none found
  if (layerSet.size === 0) {
    ['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'F.Mask', 'B.Mask', 'Edge.Cuts'].forEach(l => layerSet.add(l));
  }

  // ── Build net lookup ────────────────────────────────────────────────
  const netNames = new Map<number, string>();
  for (const netNode of findAll(tree, 'net')) {
    const netNum = typeof netNode[1] === 'number' ? netNode[1] : parseInt(String(netNode[1]), 10);
    const netName = typeof netNode[2] === 'string' ? netNode[2] : String(netNode[2] ?? '');
    if (!isNaN(netNum)) {
      netNames.set(netNum, netName);
    }
  }

  function getNetId(list: SExpr[]): string {
    const netNode = findFirst(list, 'net');
    if (!netNode || netNode.length < 2) return '';
    const netNum = typeof netNode[1] === 'number' ? netNode[1] : parseInt(String(netNode[1]), 10);
    const name = netNames.get(netNum);
    return name ? `net_${name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}` : '';
  }

  // ── Parse footprints (components) ───────────────────────────────────
  // KiCad 7+ uses "footprint", older uses "module"
  const footprintNodes = [...findAll(tree, 'footprint'), ...findAll(tree, 'module')];
  for (const fp of footprintNodes) {
    const fpName = typeof fp[1] === 'string' ? fp[1] : String(fp[1] ?? '');
    const at = getAt(fp);
    const layerVal = getStr(fp, 'layer', 'F.Cu');

    // Properties
    let ref = '';
    let value = '';

    // KiCad 7+: (property "Reference" "U1" ...)
    for (const prop of findAll(fp, 'property')) {
      const propName = typeof prop[1] === 'string' ? prop[1] : '';
      const propVal = typeof prop[2] === 'string' ? prop[2] : String(prop[2] ?? '');
      if (propName === 'Reference') ref = propVal;
      else if (propName === 'Value') value = propVal;
    }

    // KiCad 6 and earlier: (fp_text reference "U1" ...)
    if (!ref) {
      for (const fpText of findAll(fp, 'fp_text')) {
        const textType = typeof fpText[1] === 'string' ? fpText[1] : '';
        const textVal = typeof fpText[2] === 'string' ? fpText[2] : String(fpText[2] ?? '');
        if (textType === 'reference') ref = textVal;
        else if (textType === 'value') value = textVal;
      }
    }

    // Parse pads
    const pads: BrdPad[] = [];
    for (const padNode of findAll(fp, 'pad')) {
      // (pad "1" smd rect (at x y) (size w h) (layers "F.Cu" "F.Mask") (net 3 "VCC") ...)
      // (pad "1" thru_hole circle (at x y) (size w h) (drill d) (layers ...) (net ...) ...)
      const padNumber = typeof padNode[1] === 'string' ? padNode[1] : String(padNode[1] ?? '');
      const padType = typeof padNode[2] === 'string' ? padNode[2] : ''; // smd, thru_hole, np_thru_hole, connect
      const padShape = typeof padNode[3] === 'string' ? padNode[3] : 'rect';
      const padAt = getAt(padNode);
      const padSize = getSize(padNode);

      // Drill
      const drillNode = findFirst(padNode, 'drill');
      let drill: number | undefined;
      if (drillNode && drillNode.length >= 2) {
        drill = typeof drillNode[1] === 'number' ? drillNode[1] : parseFloat(String(drillNode[1]));
        if (isNaN(drill)) drill = undefined;
      }

      // Layers
      const layersNode = findFirst(padNode, 'layers');
      const padLayers: string[] = [];
      if (layersNode) {
        for (let i = 1; i < layersNode.length; i++) {
          const l = String(layersNode[i]);
          // Expand wildcards like *.Cu
          if (l === '*.Cu') {
            padLayers.push('F.Cu', 'B.Cu');
          } else if (l === '*.Mask') {
            padLayers.push('F.Mask', 'B.Mask');
          } else {
            padLayers.push(mapLayer(l));
          }
        }
      }

      // Net
      const netId = getNetId(padNode);

      pads.push({
        id: uid('pad'),
        number: padNumber,
        x: padAt.x,
        y: padAt.y,
        width: padSize.w || 1,
        height: padSize.h || 1,
        shape: mapPadShape(padShape),
        drill,
        layers: padLayers.length > 0 ? padLayers : [layerVal],
        netId: netId || undefined,
      });
    }

    components.push({
      id: uid('bcomp'),
      ref: ref || fpName,
      value,
      footprint: fpName,
      x: at.x,
      y: at.y,
      rotation: at.angle,
      layer: mapLayer(layerVal),
      pads,
    });
  }

  // ── Parse segments (traces) ─────────────────────────────────────────
  for (const seg of findAll(tree, 'segment')) {
    const start = getPoint(seg, 'start');
    const end = getPoint(seg, 'end');
    const width = getNum(seg, 'width', 0.25);
    const layer = getStr(seg, 'layer', 'F.Cu');
    const netId = getNetId(seg);

    traces.push({
      id: uid('trace'),
      points: [start, end],
      width,
      layer: mapLayer(layer),
      netId,
    });
  }

  // Also parse arcs (KiCad 7+)
  for (const arc of findAll(tree, 'arc')) {
    const start = getPoint(arc, 'start');
    const mid = getPoint(arc, 'mid');
    const end = getPoint(arc, 'end');
    const width = getNum(arc, 'width', 0.25);
    const layer = getStr(arc, 'layer', 'F.Cu');
    const netId = getNetId(arc);

    // Interpolate arc from 3 points (start, mid, end) into polyline segments.
    // Find the circumscribed circle center and radius, then walk the arc.
    const arcPoints = interpolateArc(start, mid, end, 12);
    traces.push({
      id: uid('trace'),
      points: arcPoints,
      width,
      layer: mapLayer(layer),
      netId,
    });
  }

  // ── Parse vias ──────────────────────────────────────────────────────
  for (const viaNode of findAll(tree, 'via')) {
    const at = getAt(viaNode);
    const drill = getNum(viaNode, 'drill', 0.4);
    const sizeVal = getNum(viaNode, 'size', 0.8);
    const netId = getNetId(viaNode);

    // Layers
    const layersNode = findFirst(viaNode, 'layers');
    const viaLayers: string[] = [];
    if (layersNode) {
      for (let i = 1; i < layersNode.length; i++) {
        viaLayers.push(mapLayer(String(layersNode[i])));
      }
    }
    const resolvedLayers = viaLayers.length > 0 ? viaLayers : ['F.Cu', 'B.Cu'];

    // Determine via type from the KiCad type field or layer span
    const viaTypeStr = getStr(viaNode, 'type', '');
    let viaType: ViaType = 'through';
    if (viaTypeStr === 'blind') viaType = 'blind';
    else if (viaTypeStr === 'buried') viaType = 'buried';
    else if (viaTypeStr === 'micro') viaType = 'micro';

    vias.push({
      id: uid('via'),
      x: at.x,
      y: at.y,
      drill,
      size: sizeVal,
      layers: resolvedLayers,
      netId,
      viaType,
      startLayer: resolvedLayers[0] || 'F.Cu',
      endLayer: resolvedLayers[resolvedLayers.length - 1] || 'B.Cu',
    });
  }

  // ── Parse zones (copper fills) ──────────────────────────────────────
  for (const zoneNode of findAll(tree, 'zone')) {
    const layer = getStr(zoneNode, 'layer', 'F.Cu');
    const netId = getNetId(zoneNode);

    // Is keepout?
    const keepoutNode = findFirst(zoneNode, 'keepout');
    const isKeepout = keepoutNode !== null;

    // Get polygon points
    const points: Point[] = [];
    const polyNode = findFirst(zoneNode, 'polygon');
    if (polyNode) {
      const ptsNode = findFirst(polyNode, 'pts');
      if (ptsNode) {
        for (const xy of findAll(ptsNode, 'xy')) {
          points.push(getXY(xy));
        }
      }
    }

    // Also check filled_polygon for the actual fill
    if (points.length === 0) {
      const filledNode = findFirst(zoneNode, 'filled_polygon');
      if (filledNode) {
        const ptsNode = findFirst(filledNode, 'pts');
        if (ptsNode) {
          for (const xy of findAll(ptsNode, 'xy')) {
            points.push(getXY(xy));
          }
        }
      }
    }

    if (points.length >= 3) {
      zones.push({
        id: uid('zone'),
        points,
        layer: mapLayer(layer),
        netId,
        isKeepout,
      });
    }
  }

  // ── Parse board outline (Edge.Cuts layer graphics) ──────────────────
  const outlinePoints: Point[] = [];

  // gr_line on Edge.Cuts
  for (const grLine of findAll(tree, 'gr_line')) {
    const layer = getStr(grLine, 'layer', '');
    if (layer === 'Edge.Cuts') {
      const start = getPoint(grLine, 'start');
      const end = getPoint(grLine, 'end');
      outlinePoints.push(start, end);
    }
  }

  // gr_rect on Edge.Cuts
  for (const grRect of findAll(tree, 'gr_rect')) {
    const layer = getStr(grRect, 'layer', '');
    if (layer === 'Edge.Cuts') {
      const start = getPoint(grRect, 'start');
      const end = getPoint(grRect, 'end');
      outlinePoints.push(
        { x: start.x, y: start.y },
        { x: end.x, y: start.y },
        { x: end.x, y: end.y },
        { x: start.x, y: end.y },
      );
    }
  }

  // gr_poly on Edge.Cuts
  for (const grPoly of findAll(tree, 'gr_poly')) {
    const layer = getStr(grPoly, 'layer', '');
    if (layer === 'Edge.Cuts') {
      const ptsNode = findFirst(grPoly, 'pts');
      if (ptsNode) {
        for (const xy of findAll(ptsNode, 'xy')) {
          outlinePoints.push(getXY(xy));
        }
      }
    }
  }

  if (outlinePoints.length >= 3) {
    // Deduplicate and order the outline points
    const unique = deduplicatePoints(outlinePoints);
    outline = { points: unique.length >= 3 ? unique : outlinePoints };
  } else if (outlinePoints.length > 0) {
    outline = { points: outlinePoints };
  } else {
    // Fallback: compute bounding box from all components
    if (components.length > 0) {
      const xs = components.map(c => c.x);
      const ys = components.map(c => c.y);
      const minX = Math.min(...xs) - 10;
      const maxX = Math.max(...xs) + 10;
      const minY = Math.min(...ys) - 10;
      const maxY = Math.max(...ys) + 10;
      outline = {
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ],
      };
    } else {
      outline = {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 80 },
          { x: 0, y: 80 },
        ],
      };
    }
  }

  return {
    components,
    traces,
    vias,
    zones,
    outline,
    layers: Array.from(layerSet),
  };
}

// ─── Point deduplication helper ──────────────────────────────────────────────

function deduplicatePoints(points: Point[], threshold: number = 0.01): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    const exists = result.some(r => Math.abs(r.x - p.x) < threshold && Math.abs(r.y - p.y) < threshold);
    if (!exists) result.push(p);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── IMPORT SUMMARY (for preview) ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export interface ImportPreview {
  fileType: 'kicad_sch' | 'kicad_pcb' | 'unknown';
  componentCount: number;
  wireCount: number;
  labelCount: number;
  traceCount: number;
  viaCount: number;
  zoneCount: number;
  netCount: number;
  layerCount: number;
}

/**
 * Quick-scan a KiCad file to get counts without full parsing.
 * Useful for the preview in the import dialog.
 */
export function previewKicadFile(text: string, filename: string): ImportPreview {
  const isSchematic = filename.endsWith('.kicad_sch');
  const isPCB = filename.endsWith('.kicad_pcb');

  if (isSchematic) {
    try {
      const result = importKicadSchematic(text);
      return {
        fileType: 'kicad_sch',
        componentCount: result.components.length,
        wireCount: result.wires.length,
        labelCount: result.labels.length,
        traceCount: 0,
        viaCount: 0,
        zoneCount: 0,
        netCount: 0,
        layerCount: 0,
      };
    } catch {
      return { fileType: 'kicad_sch', componentCount: 0, wireCount: 0, labelCount: 0, traceCount: 0, viaCount: 0, zoneCount: 0, netCount: 0, layerCount: 0 };
    }
  }

  if (isPCB) {
    try {
      const result = importKicadPCB(text);
      // Count unique nets
      const netIds = new Set<string>();
      for (const t of result.traces) { if (t.netId) netIds.add(t.netId); }
      for (const c of result.components) {
        for (const p of c.pads) { if (p.netId) netIds.add(p.netId); }
      }

      return {
        fileType: 'kicad_pcb',
        componentCount: result.components.length,
        wireCount: 0,
        labelCount: 0,
        traceCount: result.traces.length,
        viaCount: result.vias.length,
        zoneCount: result.zones.length,
        netCount: netIds.size,
        layerCount: result.layers.length,
      };
    } catch {
      return { fileType: 'kicad_pcb', componentCount: 0, wireCount: 0, labelCount: 0, traceCount: 0, viaCount: 0, zoneCount: 0, netCount: 0, layerCount: 0 };
    }
  }

  return { fileType: 'unknown', componentCount: 0, wireCount: 0, labelCount: 0, traceCount: 0, viaCount: 0, zoneCount: 0, netCount: 0, layerCount: 0 };
}
