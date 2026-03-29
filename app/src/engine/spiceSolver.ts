// ─── Lightweight SPICE DC Operating Point Solver ─────────────────────────────
// Implements Modified Nodal Analysis (MNA) for DC operating point.
//
// Supports:
//   - Resistors (R)
//   - Voltage sources (V) with DC value
//   - Current sources (I) with DC value
//   - Capacitors (C) treated as open circuit in DC
//   - Inductors (L) treated as short circuit (wire) in DC
//   - Diodes (D) via Newton-Raphson iteration
//   - BJTs (Q) via Ebers-Moll simplified DC model with Newton-Raphson
//   - MOSFETs (M) via Shichman-Hodges Level 1 with Newton-Raphson
//   - OpAmps (X OPAMP) via subcircuit expansion (Rin + VCVS)
//
// MNA builds the system:  [G  B] [v]   [i]
//                          [C  D] [j] = [e]
// where v = node voltages, j = voltage source currents
//
// Ground node "0" is the reference and is excluded from the matrix.

export interface SpiceResult {
  nodeVoltages: Map<string, number>;
  branchCurrents: Map<string, number>;
  converged: boolean;
  iterations: number;
  error?: string;
}

// ─── Netlist parser ──────────────────────────────────────────────────────────

interface ParsedElement {
  type: 'R' | 'C' | 'L' | 'V' | 'I' | 'D' | 'Q' | 'M' | 'X';
  name: string;
  nodes: string[];
  value: number;
  model?: string;
}

interface ParsedModel {
  name: string;
  type: string;
  params: Map<string, number>;
}

/** Parse SPICE multiplier suffixes: p, n, u, m, k, M, G, T */
function parseSpiceNumber(s: string): number {
  s = s.trim();
  const multipliers: Record<string, number> = {
    'f': 1e-15, 'p': 1e-12, 'n': 1e-9, 'u': 1e-6,
    'm': 1e-3, 'k': 1e3, 'K': 1e3, 'meg': 1e6, 'M': 1e6,
    'g': 1e9, 'G': 1e9, 't': 1e12, 'T': 1e12,
  };

  // Try 3-char suffix first (meg)
  if (s.length > 3) {
    const suffix3 = s.slice(-3).toLowerCase();
    if (suffix3 === 'meg') {
      const num = parseFloat(s.slice(0, -3));
      if (!isNaN(num)) return num * 1e6;
    }
  }

  // Try 1-char suffix
  if (s.length > 1) {
    const lastChar = s[s.length - 1];
    if (lastChar in multipliers) {
      const num = parseFloat(s.slice(0, -1));
      if (!isNaN(num)) return num * multipliers[lastChar];
    }
  }

  const num = parseFloat(s);
  return isNaN(num) ? 0 : num;
}

function parseNetlist(netlist: string): { elements: ParsedElement[]; models: Map<string, ParsedModel> } {
  const elements: ParsedElement[] = [];
  const models = new Map<string, ParsedModel>();
  const lines = netlist.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*') || line.startsWith('.end')) continue;

    // Parse .model directives
    if (line.toLowerCase().startsWith('.model')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const modelName = parts[1];
        const modelType = parts[2].toUpperCase();
        const params = new Map<string, number>();
        // Parse (param=value ...) block
        const paramMatch = line.match(/\(([^)]*)\)/);
        if (paramMatch) {
          const paramPairs = paramMatch[1].split(/\s+/);
          for (const pair of paramPairs) {
            const [k, v] = pair.split('=');
            if (k && v) {
              params.set(k.toUpperCase(), parseSpiceNumber(v));
            }
          }
        }
        models.set(modelName, { name: modelName, type: modelType, params });
      }
      continue;
    }

    // Skip other dot commands (.op, .tran, .subckt, .ends, .ac, .dc)
    if (line.startsWith('.')) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length < 3) continue;

    const name = tokens[0];
    const firstChar = name[0].toUpperCase();

    switch (firstChar) {
      case 'R': {
        // R<name> <n+> <n-> <value>
        if (tokens.length >= 4) {
          elements.push({
            type: 'R', name, nodes: [tokens[1], tokens[2]],
            value: parseSpiceNumber(tokens[3]),
          });
        }
        break;
      }
      case 'C': {
        // Capacitors are open circuits in DC -- skip
        if (tokens.length >= 4) {
          elements.push({
            type: 'C', name, nodes: [tokens[1], tokens[2]],
            value: parseSpiceNumber(tokens[3]),
          });
        }
        break;
      }
      case 'L': {
        // Inductors are short circuits in DC -- treated as 0-ohm resistor (voltage source 0V)
        if (tokens.length >= 4) {
          elements.push({
            type: 'L', name, nodes: [tokens[1], tokens[2]],
            value: parseSpiceNumber(tokens[3]),
          });
        }
        break;
      }
      case 'V': {
        // V<name> <n+> <n-> DC <value> or V<name> <n+> <n-> <value>
        if (tokens.length >= 4) {
          let val = 0;
          const dcIdx = tokens.findIndex(t => t.toUpperCase() === 'DC');
          if (dcIdx >= 0 && dcIdx + 1 < tokens.length) {
            val = parseSpiceNumber(tokens[dcIdx + 1]);
          } else {
            val = parseSpiceNumber(tokens[3]);
          }
          elements.push({
            type: 'V', name, nodes: [tokens[1], tokens[2]], value: val,
          });
        }
        break;
      }
      case 'I': {
        // I<name> <n+> <n-> DC <value> or I<name> <n+> <n-> <value>
        if (tokens.length >= 4) {
          let val = 0;
          const dcIdx = tokens.findIndex(t => t.toUpperCase() === 'DC');
          if (dcIdx >= 0 && dcIdx + 1 < tokens.length) {
            val = parseSpiceNumber(tokens[dcIdx + 1]);
          } else {
            val = parseSpiceNumber(tokens[3]);
          }
          elements.push({
            type: 'I', name, nodes: [tokens[1], tokens[2]], value: val,
          });
        }
        break;
      }
      case 'D': {
        // D<name> <anode> <cathode> <model>
        if (tokens.length >= 4) {
          elements.push({
            type: 'D', name, nodes: [tokens[1], tokens[2]],
            value: 0, model: tokens[3],
          });
        }
        break;
      }
      case 'Q': {
        // Q<name> <C> <B> <E> <model>
        if (tokens.length >= 5) {
          elements.push({
            type: 'Q', name, nodes: [tokens[1], tokens[2], tokens[3]],
            value: 0, model: tokens[4],
          });
        }
        break;
      }
      case 'M': {
        // M<name> <D> <G> <S> <B> <model>
        if (tokens.length >= 6) {
          elements.push({
            type: 'M', name, nodes: [tokens[1], tokens[2], tokens[3], tokens[4]],
            value: 0, model: tokens[5],
          });
        }
        break;
      }
      // X (subcircuit) -- not solved internally
      case 'X': {
        elements.push({
          type: 'X', name, nodes: tokens.slice(1, -1),
          value: 0, model: tokens[tokens.length - 1],
        });
        break;
      }
    }
  }

  return { elements, models };
}

// ─── Matrix helpers ──────────────────────────────────────────────────────────

/** Dense matrix stored as flat Float64Array (row-major). */
class DenseMatrix {
  data: Float64Array;
  n: number;

  constructor(n: number) {
    this.n = n;
    this.data = new Float64Array(n * n);
  }

  get(r: number, c: number): number {
    return this.data[r * this.n + c];
  }

  set(r: number, c: number, v: number): void {
    this.data[r * this.n + c] = v;
  }

  add(r: number, c: number, v: number): void {
    this.data[r * this.n + c] += v;
  }
}

/** Solve Ax = b by Gaussian elimination with partial pivoting. Returns x. */
function gaussianSolve(A: DenseMatrix, b: Float64Array): Float64Array | null {
  const n = A.n;
  if (b.length !== n) return null;

  // Augmented matrix [A|b]
  const aug = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      aug[i * (n + 1) + j] = A.get(i, j);
    }
    aug[i * (n + 1) + n] = b[i];
  }

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col * (n + 1) + col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row * (n + 1) + col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-20) {
      // Singular or near-singular
      return null;
    }

    // Swap rows
    if (maxRow !== col) {
      for (let j = col; j <= n; j++) {
        const tmp = aug[col * (n + 1) + j];
        aug[col * (n + 1) + j] = aug[maxRow * (n + 1) + j];
        aug[maxRow * (n + 1) + j] = tmp;
      }
    }

    // Eliminate below
    const pivot = aug[col * (n + 1) + col];
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row * (n + 1) + col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row * (n + 1) + j] -= factor * aug[col * (n + 1) + j];
      }
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i * (n + 1) + n];
    for (let j = i + 1; j < n; j++) {
      sum -= aug[i * (n + 1) + j] * x[j];
    }
    const pivot = aug[i * (n + 1) + i];
    if (Math.abs(pivot) < 1e-20) {
      x[i] = 0; // singular row
    } else {
      x[i] = sum / pivot;
    }
  }

  return x;
}

// ─── Diode model helpers ─────────────────────────────────────────────────────

const THERMAL_VOLTAGE = 0.02585; // kT/q at 25C (~26mV)

interface DiodeParams {
  IS: number;  // saturation current
  N: number;   // emission coefficient
  RS: number;  // series resistance
}

function getDiodeParams(model: ParsedModel | undefined): DiodeParams {
  const IS = model?.params.get('IS') ?? 1e-14;
  const N = model?.params.get('N') ?? 1.0;
  const RS = model?.params.get('RS') ?? 0;
  return { IS, N, RS };
}

/** Diode current: Id = IS * (exp(Vd / (N * VT)) - 1) */
function diodeCurrent(Vd: number, params: DiodeParams): number {
  const Vt = params.N * THERMAL_VOLTAGE;
  // Limit exponent to prevent overflow in both directions
  const maxArg = 40;
  const arg = Math.max(Math.min(Vd / Vt, maxArg), -maxArg);
  return params.IS * (Math.exp(arg) - 1);
}

/** Diode conductance: dId/dVd = IS / (N * VT) * exp(Vd / (N * VT)) */
function diodeConductance(Vd: number, params: DiodeParams): number {
  const Vt = params.N * THERMAL_VOLTAGE;
  const maxArg = 40;
  const arg = Math.max(Math.min(Vd / Vt, maxArg), -maxArg);
  return (params.IS / Vt) * Math.exp(arg);
}

// ─── BJT model helpers (Ebers-Moll simplified DC) ───────────────────────────

interface BJTParams {
  IS: number;  // saturation current
  BF: number;  // forward current gain (beta)
  N: number;   // emission coefficient
}

function getBJTParams(model: ParsedModel | undefined): BJTParams {
  const IS = model?.params.get('IS') ?? 1e-15;
  const BF = model?.params.get('BF') ?? 100;
  const N = model?.params.get('N') ?? 1.0;
  return { IS, BF, N };
}

// ─── MOSFET model helpers (Shichman-Hodges Level 1) ─────────────────────────

interface MOSFETParams {
  VTO: number;  // threshold voltage
  KP: number;   // transconductance parameter
  isNMOS: boolean;
}

function getMOSFETParams(model: ParsedModel | undefined): MOSFETParams {
  const modelType = model?.type ?? 'NMOS';
  const isNMOS = modelType !== 'PMOS';
  const VTO = model?.params.get('VTO') ?? (isNMOS ? 0.7 : -0.7);
  const KP = model?.params.get('KP') ?? (isNMOS ? 110e-6 : 50e-6);
  return { VTO, KP, isNMOS };
}

// ─── MNA Solver ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 100;
const CONVERGENCE_TOLERANCE = 1e-9;

/**
 * Solve DC operating point from a SPICE netlist string.
 * Uses Modified Nodal Analysis with Newton-Raphson for nonlinear elements.
 */
export function solveDCOperatingPoint(netlist: string): SpiceResult {
  const { elements, models } = parseNetlist(netlist);

  // ── Collect unique node names (excluding ground "0") ──────────────
  const nodeSet = new Set<string>();
  for (const el of elements) {
    for (const node of el.nodes) {
      if (node !== '0') nodeSet.add(node);
    }
  }
  const nodeNames = Array.from(nodeSet);
  const numNodes = nodeNames.length;

  if (numNodes === 0) {
    return {
      nodeVoltages: new Map(),
      branchCurrents: new Map(),
      converged: true,
      iterations: 0,
      error: 'No nodes found in netlist',
    };
  }

  // Node name -> matrix index
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < numNodes; i++) {
    nodeIndex.set(nodeNames[i], i);
  }

  // ── Count voltage sources and inductors (they add extra MNA rows) ──
  const voltageSources: ParsedElement[] = [];
  const inductors: ParsedElement[] = [];
  for (const el of elements) {
    if (el.type === 'V') voltageSources.push(el);
    if (el.type === 'L') inductors.push(el);
  }
  const numVS = voltageSources.length;
  const numL = inductors.length;

  // Index voltage sources: vs name -> extra row index (offset from numNodes)
  const vsIndex = new Map<string, number>();
  for (let i = 0; i < numVS; i++) {
    vsIndex.set(voltageSources[i].name, numNodes + i);
  }
  // Index inductors as 0V voltage sources for DC
  const lIndex = new Map<string, number>();
  for (let i = 0; i < numL; i++) {
    lIndex.set(inductors[i].name, numNodes + numVS + i);
  }

  // ── Identify nonlinear elements ────────────────────────────────────
  const diodes = elements.filter(e => e.type === 'D');
  const bjts = elements.filter(e => e.type === 'Q');
  const mosfets = elements.filter(e => e.type === 'M');
  const opamps = elements.filter(e => e.type === 'X' && (e.model || '').toUpperCase() === 'OPAMP');
  const hasNonlinear = diodes.length > 0 || bjts.length > 0 || mosfets.length > 0;

  // ── Count extra MNA rows for OpAmp VCVS outputs ──────────────────
  // Each OpAmp adds one extra row for its VCVS (modeled as a dependent voltage source)
  const numOpAmpVS = opamps.length;
  const opampVSIndex = new Map<string, number>();
  for (let i = 0; i < numOpAmpVS; i++) {
    opampVSIndex.set(opamps[i].name, numNodes + numVS + numL + i);
  }

  const extraRows = numVS + numL + numOpAmpVS;
  const matSize = numNodes + extraRows;

  // Helper: get matrix index for a node (ground = -1 means skip)
  function ni(nodeName: string): number {
    if (nodeName === '0') return -1;
    return nodeIndex.get(nodeName) ?? -1;
  }

  // ── Newton-Raphson iteration ───────────────────────────────────────
  // Start with initial guess: all voltages = 0
  let solution = new Float64Array(matSize);
  // Better initial guess: set voltage source nodes to their values
  for (const vs of voltageSources) {
    const nPlus = ni(vs.nodes[0]);
    const nMinus = ni(vs.nodes[1]);
    if (nPlus >= 0) solution[nPlus] = vs.value;
    if (nMinus >= 0) solution[nMinus] = 0;
  }

  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iterations = iter + 1;

    // Build G matrix and I vector from scratch each iteration
    const G = new DenseMatrix(matSize);
    const I = new Float64Array(matSize);

    // ── Stamp resistors ──────────────────────────────────────────
    for (const el of elements) {
      if (el.type !== 'R') continue;
      if (el.value === 0) continue; // skip zero-ohm resistors
      const g = 1.0 / el.value; // conductance
      const n1 = ni(el.nodes[0]);
      const n2 = ni(el.nodes[1]);

      if (n1 >= 0) G.add(n1, n1, g);
      if (n2 >= 0) G.add(n2, n2, g);
      if (n1 >= 0 && n2 >= 0) {
        G.add(n1, n2, -g);
        G.add(n2, n1, -g);
      }
    }

    // ── Stamp voltage sources ────────────────────────────────────
    for (const vs of voltageSources) {
      const n1 = ni(vs.nodes[0]); // positive node
      const n2 = ni(vs.nodes[1]); // negative node
      const row = vsIndex.get(vs.name)!;

      // KCL contribution: current from VS flows through n1 and n2
      if (n1 >= 0) {
        G.add(n1, row, 1);
        G.add(row, n1, 1);
      }
      if (n2 >= 0) {
        G.add(n2, row, -1);
        G.add(row, n2, -1);
      }

      // KVL: V(n1) - V(n2) = value
      I[row] = vs.value;
    }

    // ── Stamp inductors as 0V voltage sources for DC ─────────────
    for (const l of inductors) {
      const n1 = ni(l.nodes[0]);
      const n2 = ni(l.nodes[1]);
      const row = lIndex.get(l.name)!;

      if (n1 >= 0) {
        G.add(n1, row, 1);
        G.add(row, n1, 1);
      }
      if (n2 >= 0) {
        G.add(n2, row, -1);
        G.add(row, n2, -1);
      }

      // V(n1) - V(n2) = 0 for DC (inductor is a wire)
      I[row] = 0;
    }

    // ── Stamp current sources ────────────────────────────────────
    for (const el of elements) {
      if (el.type !== 'I') continue;
      const n1 = ni(el.nodes[0]); // current flows from n1 to n2
      const n2 = ni(el.nodes[1]);

      // Convention: current flows from + to - through the source
      if (n1 >= 0) I[n1] -= el.value;
      if (n2 >= 0) I[n2] += el.value;
    }

    // ── Stamp diodes (Newton-Raphson linearization) ──────────────
    for (const d of diodes) {
      const nA = ni(d.nodes[0]); // anode
      const nK = ni(d.nodes[1]); // cathode
      const params = getDiodeParams(models.get(d.model || 'D_DEFAULT'));

      // Get current voltage across diode from previous iteration
      const vA = nA >= 0 ? solution[nA] : 0;
      const vK = nK >= 0 ? solution[nK] : 0;
      const Vd = vA - vK;

      // Linearize: Id(Vd) ~ Id(Vd0) + gd * (Vd - Vd0)
      //   = gd * Vd + (Id(Vd0) - gd * Vd0)
      //   = gd * Vd + Ieq
      const Id = diodeCurrent(Vd, params);
      const gd = diodeConductance(Vd, params) + 1e-12; // small gmin for convergence
      const Ieq = Id - gd * Vd;

      // Stamp conductance
      if (nA >= 0) G.add(nA, nA, gd);
      if (nK >= 0) G.add(nK, nK, gd);
      if (nA >= 0 && nK >= 0) {
        G.add(nA, nK, -gd);
        G.add(nK, nA, -gd);
      }

      // Stamp equivalent current source
      if (nA >= 0) I[nA] -= Ieq;
      if (nK >= 0) I[nK] += Ieq;
    }

    // ── Stamp BJTs (Ebers-Moll simplified DC model) ─────────────────
    // Nodes: [collector, base, emitter]
    // Model: B-E junction as diode, Ic = beta * Ib
    // Linearized using Newton-Raphson like diodes
    for (const q of bjts) {
      const nC = ni(q.nodes[0]); // collector
      const nB = ni(q.nodes[1]); // base
      const nE = ni(q.nodes[2]); // emitter
      const params = getBJTParams(models.get(q.model || 'NPN'));

      const vC = nC >= 0 ? solution[nC] : 0;
      const vB = nB >= 0 ? solution[nB] : 0;
      const vE = nE >= 0 ? solution[nE] : 0;
      const Vbe = vB - vE;
      const Vbc = vB - vC;

      const Vt = params.N * THERMAL_VOLTAGE;
      const maxArg = 40;

      // B-E diode current and conductance
      const argBE = Math.max(Math.min(Vbe / Vt, maxArg), -maxArg);
      const Ibe = params.IS * (Math.exp(argBE) - 1);
      const gbe = (params.IS / Vt) * Math.exp(argBE) + 1e-12;
      const IeqBE = Ibe - gbe * Vbe;

      // B-C diode current and conductance (reverse junction)
      const argBC = Math.max(Math.min(Vbc / Vt, maxArg), -maxArg);
      const Ibc = params.IS * (Math.exp(argBC) - 1);
      const gbc = (params.IS / Vt) * Math.exp(argBC) + 1e-12;
      const IeqBC = Ibc - gbc * Vbc;

      // Collector current: Ic = beta * Ib_forward - Ibc
      // where Ib_forward ~ Ibe, so Ic = BF * Ibe - Ibc
      // Linearized: Ic = BF * (gbe * Vbe + IeqBE) - (gbc * Vbc + IeqBC)
      // Transconductance gm = BF * gbe
      const gm = params.BF * gbe;
      const IeqC = params.BF * IeqBE - IeqBC;

      // Stamp B-E junction conductance (gbe between base and emitter)
      if (nB >= 0) G.add(nB, nB, gbe);
      if (nE >= 0) G.add(nE, nE, gbe);
      if (nB >= 0 && nE >= 0) {
        G.add(nB, nE, -gbe);
        G.add(nE, nB, -gbe);
      }

      // Stamp B-E equivalent current source (Ib flows into base, out of emitter)
      if (nB >= 0) I[nB] -= IeqBE;
      if (nE >= 0) I[nE] += IeqBE;

      // Stamp B-C junction conductance (gbc between base and collector)
      if (nB >= 0) G.add(nB, nB, gbc);
      if (nC >= 0) G.add(nC, nC, gbc);
      if (nB >= 0 && nC >= 0) {
        G.add(nB, nC, -gbc);
        G.add(nC, nB, -gbc);
      }

      // Stamp B-C equivalent current source
      if (nB >= 0) I[nB] -= IeqBC;
      if (nC >= 0) I[nC] += IeqBC;

      // Stamp collector current source: Ic = gm * Vbe + IeqC
      // This is a voltage-controlled current source from B-E controlling C-E
      // Stamp gm: current into collector depends on Vbe
      if (nC >= 0 && nB >= 0) G.add(nC, nB, gm);
      if (nC >= 0 && nE >= 0) G.add(nC, nE, -gm);
      if (nE >= 0 && nB >= 0) G.add(nE, nB, -gm);
      if (nE >= 0) G.add(nE, nE, gm);

      // Stamp equivalent current for collector
      if (nC >= 0) I[nC] -= IeqC;
      if (nE >= 0) I[nE] += IeqC;
    }

    // ── Stamp MOSFETs (Shichman-Hodges Level 1) ─────────────────────
    // Nodes: [drain, gate, source, bulk]
    // Newton-Raphson linearization of drain current Id
    for (const m of mosfets) {
      const nD = ni(m.nodes[0]); // drain
      const nG = ni(m.nodes[1]); // gate
      const nS = ni(m.nodes[2]); // source
      // bulk node (m.nodes[3]) ignored in simplified Level 1 model
      const params = getMOSFETParams(models.get(m.model || 'NMOS'));

      const vD = nD >= 0 ? solution[nD] : 0;
      const vG = nG >= 0 ? solution[nG] : 0;
      const vS = nS >= 0 ? solution[nS] : 0;

      // For PMOS, we negate voltages so we can use the same equations as NMOS
      const sign = params.isNMOS ? 1 : -1;
      const Vgs = sign * (vG - vS);
      const Vds = sign * (vD - vS);
      const Vth = Math.abs(params.VTO);

      let Id: number;   // drain current (positive = into drain for NMOS)
      let gm: number;   // dId/dVgs
      let gds: number;  // dId/dVds

      if (Vgs <= Vth) {
        // Cutoff region
        Id = 0;
        gm = 0;
        gds = 0;
      } else if (Vds >= Vgs - Vth) {
        // Saturation region: Id = KP/2 * (Vgs - VTO)^2
        const Vov = Vgs - Vth;
        Id = (params.KP / 2) * Vov * Vov;
        gm = params.KP * Vov;
        gds = 0; // ideally zero in saturation; add lambda later if needed
      } else {
        // Linear (triode) region: Id = KP * ((Vgs - VTO) * Vds - Vds^2 / 2)
        const Vov = Vgs - Vth;
        Id = params.KP * (Vov * Vds - Vds * Vds / 2);
        gm = params.KP * Vds;
        gds = params.KP * (Vov - Vds);
      }

      // Add small conductance for convergence
      gds += 1e-12;
      gm += 1e-15;

      // Linearized: Id = Id0 + gm*(Vgs - Vgs0) + gds*(Vds - Vds0)
      // Equivalent current: Ieq = Id - gm*Vgs - gds*Vds
      const Ieq = Id - gm * Vgs - gds * Vds;

      // For PMOS, the current direction is reversed (flows source to drain)
      // We handle this by keeping the sign factor

      // Stamp gds (drain-source conductance)
      if (nD >= 0) G.add(nD, nD, gds);
      if (nS >= 0) G.add(nS, nS, gds);
      if (nD >= 0 && nS >= 0) {
        G.add(nD, nS, -gds);
        G.add(nS, nD, -gds);
      }

      // Stamp gm (transconductance: gate-source voltage controls drain current)
      // Id contribution from gm: sign * gm * (Vg - Vs)
      if (nD >= 0 && nG >= 0) G.add(nD, nG, sign * gm);
      if (nD >= 0 && nS >= 0) G.add(nD, nS, -sign * gm);
      if (nS >= 0 && nG >= 0) G.add(nS, nG, -sign * gm);
      if (nS >= 0) G.add(nS, nS, sign * gm);

      // Stamp equivalent current source
      const IeqSigned = sign * Ieq;
      if (nD >= 0) I[nD] -= IeqSigned;
      if (nS >= 0) I[nS] += IeqSigned;
    }

    // ── Stamp OpAmp subcircuit expansions ────────────────────────────
    // OpAmp X element with OPAMP model:
    //   nodes[0] = non-inverting input (inp)
    //   nodes[1] = inverting input (inn)
    //   nodes[2] = output
    // Expanded as: Rin (10Meg between inp and inn) + VCVS (Vout = 100k * (Vinp - Vinn))
    for (const op of opamps) {
      const nInp = ni(op.nodes[0]); // non-inverting input
      const nInn = ni(op.nodes[1]); // inverting input
      const nOut = ni(op.nodes[2]); // output
      const row = opampVSIndex.get(op.name)!;

      // Stamp Rin = 10Meg between inp and inn
      const gIn = 1.0 / 10e6; // 10 Megohm input resistance
      if (nInp >= 0) G.add(nInp, nInp, gIn);
      if (nInn >= 0) G.add(nInn, nInn, gIn);
      if (nInp >= 0 && nInn >= 0) {
        G.add(nInp, nInn, -gIn);
        G.add(nInn, nInp, -gIn);
      }

      // Stamp VCVS: Vout = Av * (Vinp - Vinn), where Av = 100k
      // This is modeled as a voltage source with dependent value.
      // MNA equation for VCVS at output node:
      //   V(out) - 0 = Av * (V(inp) - V(inn))   (output referenced to ground)
      //   V(out) - Av * V(inp) + Av * V(inn) = 0
      // The VCVS adds current variable j_op at row 'row'.
      const Av = 100e3;

      // KCL: j_op flows out of output node
      if (nOut >= 0) {
        G.add(nOut, row, 1);
        G.add(row, nOut, 1);
      }

      // KVL: V(out) - Av * (V(inp) - V(inn)) = 0
      // row equation: V(out) - Av*V(inp) + Av*V(inn) = 0
      if (nInp >= 0) G.add(row, nInp, -Av);
      if (nInn >= 0) G.add(row, nInn, Av);

      I[row] = 0; // no independent source value
    }

    // ── Add GMIN (minimum conductance) to every node for convergence ─
    const GMIN = 1e-12;
    for (let i = 0; i < numNodes; i++) {
      G.add(i, i, GMIN);
    }

    // ── Solve ────────────────────────────────────────────────────────
    const newSolution = gaussianSolve(G, I);
    if (!newSolution) {
      return {
        nodeVoltages: new Map(),
        branchCurrents: new Map(),
        converged: false,
        iterations,
        error: 'Matrix is singular -- check for floating nodes or short circuits',
      };
    }

    // ── Check convergence ────────────────────────────────────────────
    let maxDiff = 0;
    for (let i = 0; i < matSize; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(newSolution[i] - solution[i]));
    }

    solution = new Float64Array(newSolution);

    // For linear circuits (no nonlinear devices), one iteration is sufficient
    if (!hasNonlinear || maxDiff < CONVERGENCE_TOLERANCE) {
      converged = true;
      break;
    }
  }

  // ── Extract results ────────────────────────────────────────────────
  const nodeVoltages = new Map<string, number>();
  nodeVoltages.set('0', 0); // ground
  for (let i = 0; i < numNodes; i++) {
    nodeVoltages.set(nodeNames[i], roundSig(solution[i], 10));
  }

  const branchCurrents = new Map<string, number>();

  // Voltage source currents come directly from MNA extra variables
  for (let i = 0; i < numVS; i++) {
    branchCurrents.set(voltageSources[i].name, roundSig(solution[numNodes + i], 10));
  }

  // Inductor currents
  for (let i = 0; i < numL; i++) {
    branchCurrents.set(inductors[i].name, roundSig(solution[numNodes + numVS + i], 10));
  }

  // Resistor currents: I = (V1 - V2) / R
  for (const el of elements) {
    if (el.type !== 'R' || el.value === 0) continue;
    const idx1 = ni(el.nodes[0]);
    const v1 = el.nodes[0] === '0' ? 0 : (idx1 >= 0 ? (solution[idx1] || 0) : 0);
    const idx2 = ni(el.nodes[1]);
    const v2 = el.nodes[1] === '0' ? 0 : (idx2 >= 0 ? (solution[idx2] || 0) : 0);
    branchCurrents.set(el.name, roundSig((v1 - v2) / el.value, 10));
  }

  // Current source currents are their own value
  for (const el of elements) {
    if (el.type === 'I') {
      branchCurrents.set(el.name, el.value);
    }
  }

  // Diode currents
  for (const d of diodes) {
    const params = getDiodeParams(models.get(d.model || 'D_DEFAULT'));
    const vA = d.nodes[0] === '0' ? 0 : (solution[ni(d.nodes[0])] || 0);
    const vK = d.nodes[1] === '0' ? 0 : (solution[ni(d.nodes[1])] || 0);
    branchCurrents.set(d.name, roundSig(diodeCurrent(vA - vK, params), 10));
  }

  // BJT currents (collector current Ic = BF * Ib)
  for (const q of bjts) {
    const params = getBJTParams(models.get(q.model || 'NPN'));
    const vB = q.nodes[1] === '0' ? 0 : (solution[ni(q.nodes[1])] || 0);
    const vE = q.nodes[2] === '0' ? 0 : (solution[ni(q.nodes[2])] || 0);
    const Vbe = vB - vE;
    const Vt = params.N * THERMAL_VOLTAGE;
    const maxArg = 40;
    const argBE = Math.max(Math.min(Vbe / Vt, maxArg), -maxArg);
    const Ib = params.IS * (Math.exp(argBE) - 1);
    const Ic = params.BF * Ib;
    branchCurrents.set(q.name + ':Ic', roundSig(Ic, 10));
    branchCurrents.set(q.name + ':Ib', roundSig(Ib, 10));
    branchCurrents.set(q.name + ':Ie', roundSig(-(Ic + Ib), 10));
  }

  // MOSFET drain currents
  for (const m of mosfets) {
    const params = getMOSFETParams(models.get(m.model || 'NMOS'));
    const vD = m.nodes[0] === '0' ? 0 : (solution[ni(m.nodes[0])] || 0);
    const vG = m.nodes[1] === '0' ? 0 : (solution[ni(m.nodes[1])] || 0);
    const vS = m.nodes[2] === '0' ? 0 : (solution[ni(m.nodes[2])] || 0);
    const sign = params.isNMOS ? 1 : -1;
    const Vgs = sign * (vG - vS);
    const Vds = sign * (vD - vS);
    const Vth = Math.abs(params.VTO);
    let Id: number;
    if (Vgs <= Vth) {
      Id = 0;
    } else if (Vds >= Vgs - Vth) {
      const Vov = Vgs - Vth;
      Id = (params.KP / 2) * Vov * Vov;
    } else {
      const Vov = Vgs - Vth;
      Id = params.KP * (Vov * Vds - Vds * Vds / 2);
    }
    branchCurrents.set(m.name + ':Id', roundSig(sign * Id, 10));
  }

  // OpAmp output currents from VCVS extra variables
  for (let i = 0; i < numOpAmpVS; i++) {
    const row = numNodes + numVS + numL + i;
    branchCurrents.set(opamps[i].name + ':Iout', roundSig(solution[row], 10));
  }

  return { nodeVoltages, branchCurrents, converged, iterations };
}

/** Round to N significant figures */
function roundSig(x: number, sig: number): number {
  if (x === 0) return 0;
  const mag = Math.floor(Math.log10(Math.abs(x)));
  const factor = Math.pow(10, sig - 1 - mag);
  return Math.round(x * factor) / factor;
}

/**
 * Format a number for display with engineering notation.
 * e.g. 0.001 -> "1.000m", 4700 -> "4.700k"
 */
export function formatEngineering(value: number, unit: string = ''): string {
  if (value === 0) return `0${unit}`;

  const prefixes: [number, string][] = [
    [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
    [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'],
  ];

  const absVal = Math.abs(value);
  for (const [threshold, prefix] of prefixes) {
    if (absVal >= threshold * 0.999) {
      return `${(value / threshold).toFixed(3)}${prefix}${unit}`;
    }
  }

  return `${value.toExponential(3)}${unit}`;
}
