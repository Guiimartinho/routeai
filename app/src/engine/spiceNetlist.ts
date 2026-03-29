// ─── SPICE Netlist Generator ─────────────────────────────────────────────────
// Converts RouteAI schematic components + nets into a SPICE-compatible netlist.
// Supports: R, C, L, V, I, Diode, NPN, MOSFET, Op-Amp.
// For advanced simulation, export the .cir file and run with external ngspice.

import type { SchComponent, SchNet, SchPin } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a lookup from pin ID to net name. Unconnected pins get a unique float node. */
function buildPinNetMap(components: SchComponent[], nets: SchNet[]): Map<string, string> {
  const map = new Map<string, string>();
  let floatIdx = 0;

  for (const net of nets) {
    for (const pinId of net.pins) {
      map.set(pinId, sanitizeNetName(net.name));
    }
  }

  // Assign floating nodes for unconnected pins
  for (const comp of components) {
    for (const pin of comp.pins) {
      if (!map.has(pin.id)) {
        map.set(pin.id, `_float_${++floatIdx}`);
      }
    }
  }

  return map;
}

/** Make net names SPICE-safe: no spaces, no special chars except underscore. */
function sanitizeNetName(name: string): string {
  // SPICE ground is node 0
  const lower = name.toLowerCase();
  if (lower === 'gnd' || lower === '0' || lower === 'vss') return '0';
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** Parse a component value string into SPICE format.
 *  "10k" -> "10k", "4.7uF" -> "4.7u", "100nH" -> "100n", "3.3V" -> "3.3"
 */
function parseValue(value: string): string {
  if (!value) return '0';
  // Strip trailing unit suffixes (ohm, F, H, V, A) but keep SPICE multipliers
  let v = value.trim();
  // Handle common shorthand: "10k" -> "10k", "4.7u" -> "4.7u"
  v = v.replace(/[Oo]hm[s]?$/i, '');
  v = v.replace(/[Ff]arad[s]?$/i, '');
  v = v.replace(/[Hh]enr(?:y|ies)$/i, '');
  v = v.replace(/[Vv]olt[s]?$/i, '');
  v = v.replace(/[Aa]mp[s]?$/i, '');
  // Remove trailing F/H/V/A single char if preceded by a SPICE multiplier
  v = v.replace(/([pnumkMGT])[FHVAΩfhva]$/i, '$1');
  // If it's just a plain number with units like "100nF", strip the F
  v = v.replace(/([0-9.]+[pnumkMGT]?)[FHVAΩfhva]$/i, '$1');
  return v || '0';
}

/** Find a pin by name (case-insensitive) or by number. */
function findPin(pins: SchPin[], ...names: string[]): SchPin | undefined {
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = pins.find(
      p => p.name.toLowerCase() === lower || p.number === name
    );
    if (found) return found;
  }
  return undefined;
}

/** Get net name for a pin, falling back to pin index if needed. */
function netOf(pin: SchPin | undefined, pinNetMap: Map<string, string>, fallback: string): string {
  if (!pin) return fallback;
  return pinNetMap.get(pin.id) || fallback;
}

// ─── Component type detection ────────────────────────────────────────────────

type SpiceType = 'R' | 'C' | 'L' | 'V' | 'I' | 'D' | 'NPN' | 'PNP' | 'NMOS' | 'PMOS' | 'OPAMP' | 'UNKNOWN';

function classifyComponent(comp: SchComponent): SpiceType {
  const type = comp.type.toLowerCase();
  const ref = comp.ref.toUpperCase();
  const sym = comp.symbol.toLowerCase();

  // By reference designator prefix (most reliable)
  if (ref.startsWith('R')) return 'R';
  if (ref.startsWith('C')) return 'C';
  if (ref.startsWith('L')) return 'L';
  if (ref.startsWith('D')) return 'D';
  if (ref.startsWith('Q')) {
    if (type.includes('pnp') || sym.includes('pnp')) return 'PNP';
    if (type.includes('pmos') || sym.includes('pmos')) return 'PMOS';
    if (type.includes('nmos') || sym.includes('nmos')) return 'NMOS';
    return 'NPN'; // default BJT
  }
  if (ref.startsWith('M')) {
    if (type.includes('pmos') || sym.includes('pmos')) return 'PMOS';
    return 'NMOS';
  }
  if (ref.startsWith('U') || ref.startsWith('X')) {
    if (type.includes('opamp') || sym.includes('opamp') || type.includes('op-amp') || sym.includes('op_amp')) return 'OPAMP';
  }
  if (ref.startsWith('V')) return 'V';
  if (ref.startsWith('I')) return 'I';

  // By type/symbol name
  if (type === 'resistor' || type === 'r' || sym.includes('resistor')) return 'R';
  if (type === 'capacitor' || type === 'c' || sym.includes('capacitor')) return 'C';
  if (type === 'inductor' || type === 'l' || sym.includes('inductor')) return 'L';
  if (type === 'diode' || type === 'd' || sym.includes('diode') || sym.includes('led')) return 'D';
  if (type.includes('npn') || sym.includes('npn')) return 'NPN';
  if (type.includes('pnp') || sym.includes('pnp')) return 'PNP';
  if (type.includes('nmos') || type.includes('nfet') || sym.includes('nmos')) return 'NMOS';
  if (type.includes('pmos') || type.includes('pfet') || sym.includes('pmos')) return 'PMOS';
  if (type.includes('opamp') || sym.includes('opamp')) return 'OPAMP';
  if (type.includes('voltage') || type === 'vsource' || sym.includes('vsource')) return 'V';
  if (type.includes('current') || type === 'isource' || sym.includes('isource')) return 'I';

  // Power symbols mapped as voltage sources
  const powerTypes = ['vcc', '3v3', '5v', '12v', 'vdd', '3.3v', '5v0', '12v0'];
  if (powerTypes.includes(type.toLowerCase()) || powerTypes.includes(sym.toLowerCase())) return 'V';

  return 'UNKNOWN';
}

// ─── Netlist line generators per component type ──────────────────────────────

function emitPassive(prefix: string, comp: SchComponent, pinNetMap: Map<string, string>): string {
  const pins = comp.pins;
  const p1 = pins[0];
  const p2 = pins[1] || pins[0];
  const n1 = netOf(p1, pinNetMap, '0');
  const n2 = netOf(p2, pinNetMap, '0');
  const val = parseValue(comp.value);
  return `${prefix}${comp.ref} ${n1} ${n2} ${val}`;
}

function emitVoltageSource(comp: SchComponent, pinNetMap: Map<string, string>): string {
  const pins = comp.pins;
  // Try to find positive/negative pins
  const pPlus = findPin(pins, '+', 'p', 'pos', 'positive', 'vcc', '1') || pins[0];
  const pMinus = findPin(pins, '-', 'n', 'neg', 'negative', 'gnd', '2') || pins[1];
  const nPlus = netOf(pPlus, pinNetMap, '0');
  const nMinus = pMinus ? netOf(pMinus, pinNetMap, '0') : '0';

  // Extract voltage value
  let val = parseValue(comp.value);
  // If value looks like a power name (VCC, 3V3, etc), extract the number
  const numMatch = val.match(/(\d+\.?\d*)/);
  if (numMatch) {
    val = numMatch[1];
  } else {
    val = '5'; // default 5V
  }

  return `V${comp.ref} ${nPlus} ${nMinus} DC ${val}`;
}

function emitCurrentSource(comp: SchComponent, pinNetMap: Map<string, string>): string {
  const pins = comp.pins;
  const pPlus = findPin(pins, '+', 'p', 'pos', '1') || pins[0];
  const pMinus = findPin(pins, '-', 'n', 'neg', '2') || pins[1];
  const nPlus = netOf(pPlus, pinNetMap, '0');
  const nMinus = pMinus ? netOf(pMinus, pinNetMap, '0') : '0';
  const val = parseValue(comp.value);
  return `I${comp.ref} ${nPlus} ${nMinus} DC ${val}`;
}

function emitDiode(comp: SchComponent, pinNetMap: Map<string, string>): string {
  const pins = comp.pins;
  const anode = findPin(pins, 'A', 'anode', '+', '1') || pins[0];
  const cathode = findPin(pins, 'K', 'cathode', 'C', '-', '2') || pins[1];
  const nA = netOf(anode, pinNetMap, '0');
  const nK = cathode ? netOf(cathode, pinNetMap, '0') : '0';
  return `D${comp.ref} ${nA} ${nK} D_DEFAULT`;
}

function emitBJT(comp: SchComponent, pinNetMap: Map<string, string>, model: string): string {
  const pins = comp.pins;
  const pC = findPin(pins, 'C', 'collector', '3') || pins[0];
  const pB = findPin(pins, 'B', 'base', '2') || pins[1];
  const pE = findPin(pins, 'E', 'emitter', '1') || pins[2] || pins[0];
  const nC = netOf(pC, pinNetMap, '0');
  const nB = pB ? netOf(pB, pinNetMap, '0') : '0';
  const nE = pE ? netOf(pE, pinNetMap, '0') : '0';
  return `Q${comp.ref} ${nC} ${nB} ${nE} ${model}`;
}

function emitMOSFET(comp: SchComponent, pinNetMap: Map<string, string>, model: string): string {
  const pins = comp.pins;
  const pD = findPin(pins, 'D', 'drain', '3') || pins[0];
  const pG = findPin(pins, 'G', 'gate', '2') || pins[1];
  const pS = findPin(pins, 'S', 'source', '1') || pins[2] || pins[0];
  const nD = netOf(pD, pinNetMap, '0');
  const nG = pG ? netOf(pG, pinNetMap, '0') : '0';
  const nS = pS ? netOf(pS, pinNetMap, '0') : '0';
  return `M${comp.ref} ${nD} ${nG} ${nS} ${nS} ${model}`;
}

function emitOpAmp(comp: SchComponent, pinNetMap: Map<string, string>): string {
  const pins = comp.pins;
  const pInP = findPin(pins, '+', 'IN+', 'non-inverting', 'inp', '3') || pins[0];
  const pInN = findPin(pins, '-', 'IN-', 'inverting', 'inn', '2') || pins[1];
  const pOut = findPin(pins, 'OUT', 'output', 'O', '1') || pins[2] || pins[0];
  const pVP = findPin(pins, 'V+', 'VCC', 'VDD', 'VP', '5');
  const pVN = findPin(pins, 'V-', 'VEE', 'VSS', 'VN', '4');

  const nInP = netOf(pInP, pinNetMap, '0');
  const nInN = pInN ? netOf(pInN, pinNetMap, '0') : '0';
  const nOut = pOut ? netOf(pOut, pinNetMap, '0') : '0';
  const nVP = pVP ? netOf(pVP, pinNetMap, '0') : 'VCC';
  const nVN = pVN ? netOf(pVN, pinNetMap, '0') : 'VEE';

  return `X${comp.ref} ${nInP} ${nInN} ${nOut} ${nVP} ${nVN} OPAMP`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate a SPICE netlist string from schematic components and nets.
 * The netlist includes model cards for default semiconductor devices
 * and a subcircuit definition for op-amps.
 */
export function generateSpiceNetlist(components: SchComponent[], nets: SchNet[]): string {
  const pinNetMap = buildPinNetMap(components, nets);
  const lines: string[] = [];
  const modelsNeeded = new Set<string>();

  lines.push('* RouteAI SPICE Netlist');
  lines.push(`* Generated: ${new Date().toISOString()}`);
  lines.push(`* Components: ${components.length}, Nets: ${nets.length}`);
  lines.push('');

  // Skip power symbols (GND, VCC etc) - they are represented by net names
  const powerTypes = new Set(['gnd', 'vcc', '3v3', '5v', '12v', 'vdd', 'vss', 'vee']);

  for (const comp of components) {
    if (powerTypes.has(comp.type.toLowerCase()) || powerTypes.has(comp.symbol.toLowerCase())) {
      continue;
    }

    const spiceType = classifyComponent(comp);
    let line = '';

    switch (spiceType) {
      case 'R':
        line = emitPassive('R', comp, pinNetMap);
        break;
      case 'C':
        line = emitPassive('C', comp, pinNetMap);
        break;
      case 'L':
        line = emitPassive('L', comp, pinNetMap);
        break;
      case 'V':
        line = emitVoltageSource(comp, pinNetMap);
        break;
      case 'I':
        line = emitCurrentSource(comp, pinNetMap);
        break;
      case 'D':
        line = emitDiode(comp, pinNetMap);
        modelsNeeded.add('D_DEFAULT');
        break;
      case 'NPN':
        line = emitBJT(comp, pinNetMap, 'NPN_DEFAULT');
        modelsNeeded.add('NPN_DEFAULT');
        break;
      case 'PNP':
        line = emitBJT(comp, pinNetMap, 'PNP_DEFAULT');
        modelsNeeded.add('PNP_DEFAULT');
        break;
      case 'NMOS':
        line = emitMOSFET(comp, pinNetMap, 'NMOS_DEFAULT');
        modelsNeeded.add('NMOS_DEFAULT');
        break;
      case 'PMOS':
        line = emitMOSFET(comp, pinNetMap, 'PMOS_DEFAULT');
        modelsNeeded.add('PMOS_DEFAULT');
        break;
      case 'OPAMP':
        line = emitOpAmp(comp, pinNetMap);
        modelsNeeded.add('OPAMP');
        break;
      default:
        line = `* UNSUPPORTED: ${comp.ref} (${comp.type}) ${comp.value}`;
        break;
    }

    lines.push(line);
  }

  // ── Model cards ────────────────────────────────────────────────────────
  if (modelsNeeded.size > 0) {
    lines.push('');
    lines.push('* ─── Model Definitions ───');
  }

  if (modelsNeeded.has('D_DEFAULT')) {
    lines.push('.model D_DEFAULT D (IS=1e-14 N=1.05 RS=0.5 BV=100 IBV=1e-10)');
  }
  if (modelsNeeded.has('NPN_DEFAULT')) {
    lines.push('.model NPN_DEFAULT NPN (BF=100 IS=1e-15 VAF=100 RB=10 RC=1 RE=0.5)');
  }
  if (modelsNeeded.has('PNP_DEFAULT')) {
    lines.push('.model PNP_DEFAULT PNP (BF=100 IS=1e-15 VAF=100 RB=10 RC=1 RE=0.5)');
  }
  if (modelsNeeded.has('NMOS_DEFAULT')) {
    lines.push('.model NMOS_DEFAULT NMOS (VTO=0.7 KP=110u GAMMA=0.4 PHI=0.65 LAMBDA=0.04)');
  }
  if (modelsNeeded.has('PMOS_DEFAULT')) {
    lines.push('.model PMOS_DEFAULT PMOS (VTO=-0.7 KP=50u GAMMA=0.4 PHI=0.65 LAMBDA=0.05)');
  }
  if (modelsNeeded.has('OPAMP')) {
    lines.push('');
    lines.push('* Ideal op-amp subcircuit (voltage-controlled voltage source)');
    lines.push('.subckt OPAMP inp inn out vp vn');
    lines.push('  Rin inp inn 10Meg');
    lines.push('  E1 out 0 inp inn 100k');
    lines.push('.ends OPAMP');
  }

  // ── Analysis commands (placeholder) ────────────────────────────────────
  lines.push('');
  lines.push('* ─── Analysis ───');
  lines.push('.op');
  lines.push('.end');

  return lines.join('\n');
}

/**
 * Generate a downloadable .cir file content with custom analysis commands.
 */
export function generateSpiceFile(
  components: SchComponent[],
  nets: SchNet[],
  analysis: 'dc' | 'ac' | 'tran',
  params?: { start?: number; stop?: number; step?: number; source?: string }
): string {
  // Get base netlist but remove the trailing .op and .end
  let netlist = generateSpiceNetlist(components, nets);
  const endIdx = netlist.lastIndexOf('* ─── Analysis ───');
  if (endIdx !== -1) {
    netlist = netlist.substring(0, endIdx);
  }

  const lines = [netlist.trimEnd(), '', '* ─── Analysis ───'];

  switch (analysis) {
    case 'dc':
      if (params?.source) {
        const start = params.start ?? 0;
        const stop = params.stop ?? 10;
        const step = params.step ?? 0.1;
        lines.push(`.dc ${params.source} ${start} ${stop} ${step}`);
      } else {
        lines.push('.op');
      }
      break;
    case 'ac':
      lines.push(`.ac dec 100 ${params?.start ?? 1} ${params?.stop ?? 1e9}`);
      break;
    case 'tran':
      lines.push(`.tran ${params?.step ?? '1u'} ${params?.stop ?? '10m'}`);
      break;
  }

  lines.push('.end');
  return lines.join('\n');
}
