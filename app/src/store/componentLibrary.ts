import type { LibComponent, LibPin } from '../types';

// ─── SVG Symbol Primitives ───────────────────────────────────────────────────
// All symbols are drawn in a local coordinate space where (0,0) is the center.
// Pin positions are relative offsets from that center.

// Resistor: zigzag
const SYM_RESISTOR = 'M -30 0 L -20 0 L -17 -8 L -11 8 L -5 -8 L 1 8 L 7 -8 L 13 8 L 17 0 L 30 0';

// Capacitor: two parallel plates
const SYM_CAPACITOR = 'M -30 0 L -4 0 M -4 -10 L -4 10 M 4 -10 L 4 10 M 4 0 L 30 0';

// Polarized capacitor
const SYM_CAP_POLAR = 'M -30 0 L -4 0 M -4 -10 L -4 10 M 4 -12 C 4 -12 8 0 4 12 M 4 0 L 30 0 M -10 -8 L -10 -4 M -12 -6 L -8 -6';

// Inductor: bumps
const SYM_INDUCTOR = 'M -30 0 L -20 0 C -20 -10 -10 -10 -10 0 C -10 -10 0 -10 0 0 C 0 -10 10 -10 10 0 C 10 -10 20 -10 20 0 L 30 0';

// Crystal
const SYM_CRYSTAL = 'M -30 0 L -8 0 M -8 -10 L -8 10 M -5 -7 L -5 7 L 5 7 L 5 -7 Z M 8 -10 L 8 10 M 8 0 L 30 0';

// Fuse
const SYM_FUSE = 'M -30 0 L -15 0 M -15 -6 L -15 6 L 15 6 L 15 -6 L -15 -6 M 15 0 L 30 0 M -10 0 C -5 -4 5 4 10 0';

// Ferrite bead
const SYM_FERRITE = 'M -30 0 L -15 0 M -15 -6 L -15 6 L 15 6 L 15 -6 L -15 -6 M 15 0 L 30 0 M -15 -6 L 15 6';

// LED
const SYM_LED = 'M -30 0 L -5 0 M -5 -10 L -5 10 L 15 0 Z M 15 -10 L 15 10 M 15 0 L 30 0 M 5 -12 L 12 -18 L 10 -15 M 9 -8 L 16 -14 L 14 -11';

// Diode
const SYM_DIODE = 'M -30 0 L -5 0 M -5 -10 L -5 10 L 15 0 Z M 15 -10 L 15 10 M 15 0 L 30 0';

// Zener diode
const SYM_ZENER = 'M -30 0 L -5 0 M -5 -10 L -5 10 L 15 0 Z M 12 -12 L 15 -10 L 15 10 L 18 12 M 15 0 L 30 0';

// Schottky diode
const SYM_SCHOTTKY = 'M -30 0 L -5 0 M -5 -10 L -5 10 L 15 0 Z M 12 -10 L 15 -10 L 15 10 L 18 10 M 15 0 L 30 0';

// TVS diode
const SYM_TVS = 'M -30 0 L -5 0 M -5 -10 L -5 10 L 15 0 Z M 12 -12 L 15 -10 L 15 10 L 18 12 M 15 0 L 30 0 M -15 -10 L -15 10 L -5 0 Z';

// Bridge rectifier
const SYM_BRIDGE = 'M 0 -20 L 20 0 L 0 20 L -20 0 Z M -6 -6 L 6 6 M -6 6 L 6 -6 M 0 -20 L 0 -30 M 0 20 L 0 30 M -20 0 L -30 0 M 20 0 L 30 0';

// NPN transistor
const SYM_NPN = 'M -30 0 L -5 0 M -5 -15 L -5 15 M -5 -8 L 20 -20 M -5 8 L 20 20 M 20 -20 L 20 -30 M 20 20 L 20 30 M 12 12 L 20 20 L 16 12';

// PNP transistor
const SYM_PNP = 'M -30 0 L -5 0 M -5 -15 L -5 15 M -5 -8 L 20 -20 M -5 8 L 20 20 M 20 -20 L 20 -30 M 20 20 L 20 30 M -2 2 L -5 8 L 2 6';

// N-MOSFET
const SYM_NMOS = 'M -30 0 L -10 0 M -10 -15 L -10 15 M -6 -12 L -6 -4 M -6 -8 L 15 -8 L 15 -30 M -6 4 L -6 12 M -6 8 L 15 8 L 15 30 M -6 -1 L -6 1 M -6 0 L 15 0 L 15 8 M 10 4 L 15 8 L 10 12';

// P-MOSFET
const SYM_PMOS = 'M -30 0 L -10 0 M -10 -15 L -10 15 M -6 -12 L -6 -4 M -6 -8 L 15 -8 L 15 -30 M -6 4 L -6 12 M -6 8 L 15 8 L 15 30 M -6 -1 L -6 1 M -6 0 L 15 0 L 15 -8 M 10 -4 L 15 -8 L 10 -12';

// IGBT
const SYM_IGBT = 'M -30 0 L -10 0 M -10 -15 L -10 15 M -6 -12 L -6 -4 M -6 -8 L 15 -8 L 15 -30 M -6 4 L -6 12 M -6 8 L 15 8 L 15 30 M 10 12 L 15 8 L 10 4';

// Generic IC box (variable size, parameterized via function)
function symIC(pinCountLeft: number, pinCountRight: number): string {
  const h = Math.max(pinCountLeft, pinCountRight) * 10 + 10;
  const w = 40;
  const top = -h / 2;
  return `M ${-w / 2} ${top} L ${w / 2} ${top} L ${w / 2} ${-top} L ${-w / 2} ${-top} Z`;
}

const SYM_IC_8 = symIC(4, 4);
const SYM_IC_14 = symIC(7, 7);
const SYM_IC_16 = symIC(8, 8);
const SYM_IC_20 = symIC(10, 10);
const SYM_IC_28 = symIC(14, 14);
const SYM_IC_32 = symIC(16, 16);
const SYM_IC_48 = symIC(24, 24);
const SYM_IC_64 = symIC(32, 32);
const SYM_IC_100 = symIC(50, 50);

// Tactile switch
const SYM_SWITCH = 'M -30 0 L -10 0 M 10 0 L 30 0 M -10 -5 L -10 5 M 10 -5 L 10 5 M -10 0 L 0 10 M 0 -15 L 0 10';

// Slide switch
const SYM_SLIDE_SW = 'M -30 0 L -10 0 M 10 -10 L 30 -10 M 10 10 L 30 10 M -10 0 L 10 -10';

// Relay
const SYM_RELAY = 'M -30 0 L -20 0 M -20 -10 L -20 10 L 0 10 L 0 -10 Z M 0 0 L 10 0 M 15 -15 L 15 15 M 20 -10 L 30 -10 M 20 10 L 30 10 M 15 -10 L 20 -10 M 15 10 L 20 10';

// Buzzer
const SYM_BUZZER = 'M -30 0 L -10 0 M -10 -12 L -10 12 L 10 16 L 10 -16 Z M 10 0 L 30 0';

// USB-C connector
const SYM_USB_C = 'M -20 -25 L 20 -25 L 20 25 L -20 25 Z M -10 -20 L 10 -20 L 10 -10 L -10 -10 Z';

// Pin header
const SYM_HEADER = 'M -10 -15 L 10 -15 L 10 15 L -10 15 Z M -5 -10 L 5 -10 M -5 -5 L 5 -5 M -5 0 L 5 0 M -5 5 L 5 5 M -5 10 L 5 10';

// RJ45
const SYM_RJ45 = 'M -15 -20 L 15 -20 L 15 20 L -15 20 Z M -10 -15 L -10 15 L 10 15 L 10 -15 Z';

// SMA connector
const SYM_SMA = 'M -15 -15 L 15 -15 L 15 15 L -15 15 Z M 0 0 m -5 0 a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0';

// SD card
const SYM_SD = 'M -15 -20 L 10 -20 L 15 -15 L 15 20 L -15 20 Z';

// Sensor (generic box with label area)
const SYM_SENSOR = 'M -15 -15 L 15 -15 L 15 15 L -15 15 Z M -10 -5 L 10 -5';

// ─── Pin helpers ─────────────────────────────────────────────────────────────

function p(name: string, num: string, x: number, y: number, type: LibPin['type'] = 'passive'): LibPin {
  return { name, number: num, x, y, type };
}

function icPinsLR(left: string[], right: string[], spacing: number = 10): LibPin[] {
  const pins: LibPin[] = [];
  const totalLeft = left.length;
  const totalRight = right.length;
  const maxPins = Math.max(totalLeft, totalRight);
  const halfH = (maxPins * spacing) / 2;
  left.forEach((name, i) => {
    const num = String(i + 1);
    pins.push(p(name, num, -40, -halfH + spacing / 2 + i * spacing, name.includes('VCC') || name.includes('VDD') || name.includes('GND') || name.includes('VSS') ? 'power' : name.startsWith('P') || name.includes('IO') ? 'bidirectional' : 'input'));
  });
  right.forEach((name, i) => {
    const num = String(left.length + right.length - i);
    pins.push(p(name, num, 40, -halfH + spacing / 2 + i * spacing, name.includes('VCC') || name.includes('VDD') || name.includes('GND') || name.includes('VSS') ? 'power' : name.startsWith('P') || name.includes('IO') ? 'bidirectional' : 'output'));
  });
  return pins;
}

// ─── Library Data ────────────────────────────────────────────────────────────

function makeResistor(size: string, footprint: string): LibComponent {
  return {
    id: `R_${size}`,
    name: `Resistor ${size}`,
    category: 'Passives',
    subcategory: 'Resistors',
    symbol: 'resistor',
    footprint,
    pins: [p('1', '1', -30, 0), p('2', '2', 30, 0)],
    description: `SMD Resistor, ${size} package`,
    datasheetUrl: '',
    mpn: `RC${size}FR-07100KL`,
    manufacturer: 'Yageo',
  };
}

function makeCap(size: string, footprint: string): LibComponent {
  return {
    id: `C_${size}`,
    name: `Capacitor ${size}`,
    category: 'Passives',
    subcategory: 'Capacitors',
    symbol: 'capacitor',
    footprint,
    pins: [p('1', '1', -30, 0), p('2', '2', 30, 0)],
    description: `SMD Ceramic Capacitor, ${size} package`,
    datasheetUrl: '',
    mpn: `GRM${size.charAt(0)}55R71H104KA01`,
    manufacturer: 'Murata',
  };
}

function makeInductor(size: string, footprint: string): LibComponent {
  return {
    id: `L_${size}`,
    name: `Inductor ${size}`,
    category: 'Passives',
    subcategory: 'Inductors',
    symbol: 'inductor',
    footprint,
    pins: [p('1', '1', -30, 0), p('2', '2', 30, 0)],
    description: `SMD Inductor, ${size} package`,
    datasheetUrl: '',
    mpn: `LQH${size}PN100M`,
    manufacturer: 'Murata',
  };
}

export const componentLibrary: LibComponent[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PASSIVES - Resistors (8)
  // ═══════════════════════════════════════════════════════════════════════════
  makeResistor('0201', 'R_0201'),
  makeResistor('0402', 'R_0402'),
  makeResistor('0603', 'R_0603'),
  makeResistor('0805', 'R_0805'),
  makeResistor('1206', 'R_1206'),
  makeResistor('1210', 'R_1210'),
  makeResistor('2010', 'R_2010'),
  makeResistor('2512', 'R_2512'),

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSIVES - Capacitors (8)
  // ═══════════════════════════════════════════════════════════════════════════
  makeCap('0201', 'C_0201'),
  makeCap('0402', 'C_0402'),
  makeCap('0603', 'C_0603'),
  makeCap('0805', 'C_0805'),
  makeCap('1206', 'C_1206'),
  makeCap('1210', 'C_1210'),
  makeCap('1812', 'C_1812'),
  makeCap('2220', 'C_2220'),

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSIVES - Polarized Capacitors (2)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'C_Elec_6.3x5.4',
    name: 'Electrolytic Cap 6.3x5.4',
    category: 'Passives',
    subcategory: 'Capacitors',
    symbol: 'capacitor_polarized',
    footprint: 'CP_Elec_6.3x5.4',
    pins: [p('+', '1', -30, 0, 'passive'), p('-', '2', 30, 0, 'passive')],
    description: 'Aluminum electrolytic capacitor, 6.3x5.4mm',
    datasheetUrl: '',
    mpn: 'EEE-1VA100SR',
    manufacturer: 'Panasonic',
  },
  {
    id: 'C_Elec_8x10',
    name: 'Electrolytic Cap 8x10',
    category: 'Passives',
    subcategory: 'Capacitors',
    symbol: 'capacitor_polarized',
    footprint: 'CP_Elec_8x10',
    pins: [p('+', '1', -30, 0, 'passive'), p('-', '2', 30, 0, 'passive')],
    description: 'Aluminum electrolytic capacitor, 8x10mm',
    datasheetUrl: '',
    mpn: 'UVR1V470MDD',
    manufacturer: 'Nichicon',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSIVES - Inductors (5)
  // ═══════════════════════════════════════════════════════════════════════════
  makeInductor('0402', 'L_0402'),
  makeInductor('0603', 'L_0603'),
  makeInductor('0805', 'L_0805'),
  makeInductor('1008', 'L_1008'),
  makeInductor('1210', 'L_1210'),

  // ═══════════════════════════════════════════════════════════════════════════
  // PASSIVES - Crystal, Fuse, Ferrite (4)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'XTAL_3225',
    name: 'Crystal 3225',
    category: 'Passives',
    subcategory: 'Crystals',
    symbol: 'crystal',
    footprint: 'Crystal_SMD_3225',
    pins: [p('IN', '1', -30, 0, 'passive'), p('OUT', '2', 30, 0, 'passive'), p('GND1', '3', 0, -15, 'passive'), p('GND2', '4', 0, 15, 'passive')],
    description: 'SMD Crystal, 3.2x2.5mm, 8MHz-48MHz',
    datasheetUrl: '',
    mpn: 'ABM8-8.000MHZ-B2-T',
    manufacturer: 'Abracon',
  },
  {
    id: 'XTAL_5032',
    name: 'Crystal 5032',
    category: 'Passives',
    subcategory: 'Crystals',
    symbol: 'crystal',
    footprint: 'Crystal_SMD_5032',
    pins: [p('IN', '1', -30, 0, 'passive'), p('OUT', '2', 30, 0, 'passive'), p('GND1', '3', 0, -15, 'passive'), p('GND2', '4', 0, 15, 'passive')],
    description: 'SMD Crystal, 5.0x3.2mm',
    datasheetUrl: '',
    mpn: 'ECS-80-20-30B-TR',
    manufacturer: 'ECS',
  },
  {
    id: 'Fuse_1206',
    name: 'Fuse 1206',
    category: 'Passives',
    subcategory: 'Fuses',
    symbol: 'fuse',
    footprint: 'Fuse_1206',
    pins: [p('1', '1', -30, 0), p('2', '2', 30, 0)],
    description: 'SMD Fuse, 1206 package',
    datasheetUrl: '',
    mpn: '0685P0500-01',
    manufacturer: 'Bel Fuse',
  },
  {
    id: 'FB_0805',
    name: 'Ferrite Bead 0805',
    category: 'Passives',
    subcategory: 'Ferrite Beads',
    symbol: 'ferrite',
    footprint: 'FB_0805',
    pins: [p('1', '1', -30, 0), p('2', '2', 30, 0)],
    description: 'Ferrite Bead, 0805, 600 Ohm @ 100MHz',
    datasheetUrl: '',
    mpn: 'BLM21PG601SN1D',
    manufacturer: 'Murata',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIODES (7)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'LED_0603',
    name: 'LED 0603',
    category: 'Diodes',
    subcategory: 'LEDs',
    symbol: 'led',
    footprint: 'LED_0603',
    pins: [p('A', '1', -30, 0, 'passive'), p('K', '2', 30, 0, 'passive')],
    description: 'SMD LED, 0603, various colors',
    datasheetUrl: '',
    mpn: '150060VS75000',
    manufacturer: 'Wurth',
  },
  {
    id: 'LED_0805',
    name: 'LED 0805',
    category: 'Diodes',
    subcategory: 'LEDs',
    symbol: 'led',
    footprint: 'LED_0805',
    pins: [p('A', '1', -30, 0, 'passive'), p('K', '2', 30, 0, 'passive')],
    description: 'SMD LED, 0805, various colors',
    datasheetUrl: '',
    mpn: '150080RS75000',
    manufacturer: 'Wurth',
  },
  {
    id: 'LED_RGB_5050',
    name: 'LED RGB 5050',
    category: 'Diodes',
    subcategory: 'LEDs',
    symbol: 'led',
    footprint: 'LED_5050',
    pins: [p('R', '1', -30, -10, 'passive'), p('G', '2', -30, 0, 'passive'), p('B', '3', -30, 10, 'passive'), p('GND', '4', 30, 0, 'power')],
    description: 'RGB LED, WS2812B compatible, 5050',
    datasheetUrl: '',
    mpn: 'WS2812B',
    manufacturer: 'Worldsemi',
  },
  {
    id: 'D_Zener',
    name: 'Zener Diode',
    category: 'Diodes',
    subcategory: 'Zener',
    symbol: 'zener',
    footprint: 'D_SOD-123',
    pins: [p('A', '1', -30, 0, 'passive'), p('K', '2', 30, 0, 'passive')],
    description: 'Zener Diode, SOD-123, 3.3V-36V',
    datasheetUrl: '',
    mpn: 'MMSZ5231B',
    manufacturer: 'ON Semi',
  },
  {
    id: 'D_Schottky',
    name: 'Schottky Diode',
    category: 'Diodes',
    subcategory: 'Schottky',
    symbol: 'schottky',
    footprint: 'D_SMA',
    pins: [p('A', '1', -30, 0, 'passive'), p('K', '2', 30, 0, 'passive')],
    description: 'Schottky Barrier Diode, SMA',
    datasheetUrl: '',
    mpn: 'SS14',
    manufacturer: 'ON Semi',
  },
  {
    id: 'D_TVS',
    name: 'TVS Diode',
    category: 'Diodes',
    subcategory: 'TVS',
    symbol: 'tvs',
    footprint: 'D_SMB',
    pins: [p('A', '1', -30, 0, 'passive'), p('K', '2', 30, 0, 'passive')],
    description: 'TVS Diode, bidirectional, SMB',
    datasheetUrl: '',
    mpn: 'SMBJ5.0CA',
    manufacturer: 'Littelfuse',
  },
  {
    id: 'D_Bridge',
    name: 'Bridge Rectifier',
    category: 'Diodes',
    subcategory: 'Bridge Rectifier',
    symbol: 'bridge',
    footprint: 'SOIC-4',
    pins: [p('AC1', '1', -30, 0, 'passive'), p('AC2', '2', 30, 0, 'passive'), p('+', '3', 0, -30, 'passive'), p('-', '4', 0, 30, 'passive')],
    description: 'Full bridge rectifier, 1A 100V',
    datasheetUrl: '',
    mpn: 'MB10S',
    manufacturer: 'ON Semi',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSISTORS (6)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'Q_NPN_SOT23',
    name: 'NPN Transistor SOT-23',
    category: 'Transistors',
    subcategory: 'BJT',
    symbol: 'npn',
    footprint: 'SOT-23',
    pins: [p('B', '1', -30, 0, 'input'), p('C', '2', 20, -30, 'passive'), p('E', '3', 20, 30, 'passive')],
    description: 'NPN General Purpose Transistor, SOT-23',
    datasheetUrl: '',
    mpn: 'MMBT3904',
    manufacturer: 'ON Semi',
  },
  {
    id: 'Q_PNP_SOT23',
    name: 'PNP Transistor SOT-23',
    category: 'Transistors',
    subcategory: 'BJT',
    symbol: 'pnp',
    footprint: 'SOT-23',
    pins: [p('B', '1', -30, 0, 'input'), p('C', '2', 20, -30, 'passive'), p('E', '3', 20, 30, 'passive')],
    description: 'PNP General Purpose Transistor, SOT-23',
    datasheetUrl: '',
    mpn: 'MMBT3906',
    manufacturer: 'ON Semi',
  },
  {
    id: 'Q_NMOS_SOT23',
    name: 'N-MOSFET SOT-23',
    category: 'Transistors',
    subcategory: 'MOSFET',
    symbol: 'nmos',
    footprint: 'SOT-23',
    pins: [p('G', '1', -30, 0, 'input'), p('D', '2', 15, -30, 'passive'), p('S', '3', 15, 30, 'passive')],
    description: 'N-Channel MOSFET, 60V 300mA, SOT-23',
    datasheetUrl: '',
    mpn: '2N7002',
    manufacturer: 'ON Semi',
  },
  {
    id: 'Q_PMOS_SOT23',
    name: 'P-MOSFET SOT-23',
    category: 'Transistors',
    subcategory: 'MOSFET',
    symbol: 'pmos',
    footprint: 'SOT-23',
    pins: [p('G', '1', -30, 0, 'input'), p('S', '2', 15, -30, 'passive'), p('D', '3', 15, 30, 'passive')],
    description: 'P-Channel MOSFET, -20V -3.5A, SOT-23',
    datasheetUrl: '',
    mpn: 'SI2301CDS',
    manufacturer: 'Vishay',
  },
  {
    id: 'Q_NMOS_DPAK',
    name: 'N-MOSFET DPAK',
    category: 'Transistors',
    subcategory: 'MOSFET',
    symbol: 'nmos',
    footprint: 'DPAK',
    pins: [p('G', '1', -30, 0, 'input'), p('D', '2', 15, -30, 'passive'), p('S', '3', 15, 30, 'passive')],
    description: 'N-Channel MOSFET, 55V 30A, DPAK',
    datasheetUrl: '',
    mpn: 'IRLR7843',
    manufacturer: 'Infineon',
  },
  {
    id: 'Q_IGBT',
    name: 'IGBT TO-220',
    category: 'Transistors',
    subcategory: 'IGBT',
    symbol: 'igbt',
    footprint: 'TO-220-3',
    pins: [p('G', '1', -30, 0, 'input'), p('C', '2', 15, -30, 'passive'), p('E', '3', 15, 30, 'passive')],
    description: 'IGBT, 600V 15A, TO-220',
    datasheetUrl: '',
    mpn: 'IRG4BC15UD',
    manufacturer: 'Infineon',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ICs - MCU (8)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'STM32F103C8',
    name: 'STM32F103C8',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'LQFP-48',
    pins: icPinsLR(
      ['VBAT', 'PC13', 'PC14', 'PC15', 'PD0', 'PD1', 'NRST', 'VSSA', 'VDDA', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PB0', 'PB1', 'PB2', 'PB10', 'PB11', 'VSS1', 'VDD1'],
      ['VDD2', 'VSS2', 'PB9', 'PB8', 'BOOT0', 'PB7', 'PB6', 'PB5', 'PB4', 'PB3', 'PD2', 'PC12', 'PC11', 'PC10', 'PA15', 'PA14', 'PA13', 'PA12', 'PA11', 'PA10', 'PA9', 'PA8', 'PB15', 'PB14']
    ),
    description: 'ARM Cortex-M3 MCU, 72MHz, 64KB Flash, 20KB RAM',
    datasheetUrl: 'https://www.st.com/resource/en/datasheet/stm32f103c8.pdf',
    mpn: 'STM32F103C8T6',
    manufacturer: 'STMicroelectronics',
  },
  {
    id: 'STM32F405RG',
    name: 'STM32F405RG',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'LQFP-64',
    pins: icPinsLR(
      ['VBAT', 'PC13', 'PC14', 'PC15', 'PH0', 'PH1', 'NRST', 'PC0', 'PC1', 'PC2', 'PC3', 'VSSA', 'VDDA', 'PA0', 'PA1', 'PA2', 'PA3', 'VSS1', 'VDD1', 'PA4', 'PA5', 'PA6', 'PA7', 'PC4', 'PC5', 'PB0', 'PB1', 'PB2', 'PB10', 'PB11', 'VCAP1', 'VDD2'],
      ['VDD3', 'VCAP2', 'PB9', 'PB8', 'BOOT0', 'PB7', 'PB6', 'PB5', 'PB4', 'PB3', 'PD7', 'PD6', 'PD5', 'PD4', 'PD3', 'PD2', 'PD1', 'PD0', 'PC12', 'PC11', 'PC10', 'PA15', 'PA14', 'PA13', 'PA12', 'PA11', 'PA10', 'PA9', 'PA8', 'PC9', 'PC8', 'PC7']
    ),
    description: 'ARM Cortex-M4 MCU, 168MHz, 1MB Flash, 192KB RAM, FPU',
    datasheetUrl: 'https://www.st.com/resource/en/datasheet/stm32f405rg.pdf',
    mpn: 'STM32F405RGT6',
    manufacturer: 'STMicroelectronics',
  },
  {
    id: 'ESP32_WROOM',
    name: 'ESP32-WROOM-32',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'ESP32-WROOM-32',
    pins: icPinsLR(
      ['GND', 'VDD', 'EN', 'IO36', 'IO39', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12', 'GND2', 'IO13', 'SD2', 'SD3', 'CMD', 'CLK'],
      ['GND3', 'IO23', 'IO22', 'TXD', 'RXD', 'IO21', 'NC', 'IO19', 'IO18', 'IO5', 'IO17', 'IO16', 'IO4', 'IO0', 'IO2', 'IO15', 'SD1', 'SD0', 'GND4', 'GND5']
    ),
    description: 'Wi-Fi + BT/BLE MCU module, dual-core 240MHz, 4MB Flash',
    datasheetUrl: 'https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32_datasheet_en.pdf',
    mpn: 'ESP32-WROOM-32E',
    manufacturer: 'Espressif',
  },
  {
    id: 'ATmega328P',
    name: 'ATmega328P',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'TQFP-32',
    pins: icPinsLR(
      ['PC6/RESET', 'PD0/RXD', 'PD1/TXD', 'PD2/INT0', 'PD3/INT1', 'PD4/T0', 'VCC', 'GND', 'PB6/XTAL1', 'PB7/XTAL2', 'PD5/T1', 'PD6/AIN0', 'PD7/AIN1', 'PB0/ICP1'],
      ['PB1/OC1A', 'PB2/OC1B', 'PB3/MOSI', 'PB4/MISO', 'PB5/SCK', 'AVCC', 'AREF', 'GND2', 'PC0/ADC0', 'PC1/ADC1', 'PC2/ADC2', 'PC3/ADC3', 'PC4/SDA', 'PC5/SCL']
    ),
    description: 'AVR MCU, 20MHz, 32KB Flash, 2KB RAM (Arduino Uno)',
    datasheetUrl: 'https://ww1.microchip.com/downloads/en/DeviceDoc/ATmega328P-DS40002061A.pdf',
    mpn: 'ATmega328P-AU',
    manufacturer: 'Microchip',
  },
  {
    id: 'RP2040',
    name: 'RP2040',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'QFN-56',
    pins: icPinsLR(
      ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'GPIO4', 'GPIO5', 'GPIO6', 'GPIO7', 'GPIO8', 'GPIO9', 'GPIO10', 'GPIO11', 'GPIO12', 'GPIO13', 'GPIO14', 'GPIO15', 'TESTEN', 'XIN', 'XOUT', 'IOVDD1', 'DVDD1', 'SWCLK', 'SWD', 'RUN'],
      ['GPIO29', 'GPIO28', 'GPIO27', 'GPIO26', 'GPIO25', 'GPIO24', 'GPIO23', 'GPIO22', 'GPIO21', 'GPIO20', 'GPIO19', 'GPIO18', 'GPIO17', 'GPIO16', 'IOVDD2', 'DVDD2', 'USB_DP', 'USB_DM', 'USB_VDD', 'VREG_IN', 'VREG_VOUT', 'QSPI_SD3', 'QSPI_SCLK', 'QSPI_CS']
    ),
    description: 'Dual ARM Cortex-M0+ MCU, 133MHz, 264KB SRAM',
    datasheetUrl: 'https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf',
    mpn: 'RP2040',
    manufacturer: 'Raspberry Pi',
  },
  {
    id: 'nRF52832',
    name: 'nRF52832',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'QFN-48',
    pins: icPinsLR(
      ['DEC1', 'P0.00', 'P0.01', 'P0.02', 'P0.03', 'P0.04', 'P0.05', 'P0.06', 'P0.07', 'P0.08', 'VDD', 'P0.09', 'P0.10', 'P0.11', 'P0.12', 'P0.13', 'P0.14', 'P0.15', 'P0.16', 'P0.17', 'P0.18', 'P0.19', 'P0.20', 'P0.21'],
      ['DEC4', 'DEC3', 'DEC2', 'SWDIO', 'SWDCLK', 'ANT', 'VSS', 'VDD2', 'P0.31', 'P0.30', 'P0.29', 'P0.28', 'P0.27', 'P0.26', 'P0.25', 'P0.24', 'P0.23', 'P0.22', 'GND', 'DCC', 'VDD3', 'XC2', 'XC1', 'DEC5']
    ),
    description: 'BLE SoC, ARM Cortex-M4F, 64MHz, 512KB Flash, 64KB RAM',
    datasheetUrl: 'https://infocenter.nordicsemi.com/pdf/nRF52832_PS_v1.4.pdf',
    mpn: 'nRF52832-QIAA',
    manufacturer: 'Nordic Semiconductor',
  },
  {
    id: 'PIC18F46K22',
    name: 'PIC18F46K22',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'TQFP-44',
    pins: icPinsLR(
      ['MCLR/VPP', 'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5', 'RE0', 'RE1', 'RE2', 'VDD', 'VSS', 'RA7/OSC1', 'RA6/OSC2', 'RC0', 'RC1', 'RC2', 'RC3/SCK', 'RD0', 'RD1', 'RD2', 'RD3'],
      ['RB7/PGD', 'RB6/PGC', 'RB5', 'RB4', 'RB3', 'RB2', 'RB1', 'RB0', 'VDD2', 'VSS2', 'RD7', 'RD6', 'RD5', 'RD4', 'RC7/RX', 'RC6/TX', 'RC5', 'RC4', 'RA7', 'RE3', 'VDD3', 'VSS3']
    ),
    description: 'PIC18 MCU, 64MHz, 64KB Flash, nanoWatt XLP',
    datasheetUrl: '',
    mpn: 'PIC18F46K22-I/PT',
    manufacturer: 'Microchip',
  },
  {
    id: 'STM32G031K8',
    name: 'STM32G031K8',
    category: 'ICs',
    subcategory: 'MCU',
    symbol: 'ic',
    footprint: 'LQFP-32',
    pins: icPinsLR(
      ['VDD', 'PC14', 'PC15', 'NRST', 'VDDA', 'PA0', 'PA1', 'PA2', 'PA3', 'PA4', 'PA5', 'PA6', 'PA7', 'PB0', 'PB1', 'PB2'],
      ['VSS', 'VDD2', 'PB9', 'PB8', 'PB7', 'PB6', 'PB5', 'PB4', 'PB3', 'PA15', 'PA14', 'PA13', 'PA12', 'PA11', 'PA10', 'PA8']
    ),
    description: 'ARM Cortex-M0+ MCU, 64MHz, 64KB Flash, value line',
    datasheetUrl: '',
    mpn: 'STM32G031K8T6',
    manufacturer: 'STMicroelectronics',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ICs - POWER (8)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'LM7805',
    name: 'LM7805',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'TO-220-3',
    pins: [p('IN', '1', -40, -10, 'power'), p('GND', '2', 0, 20, 'power'), p('OUT', '3', 40, -10, 'power')],
    description: 'Linear voltage regulator, 5V 1.5A, TO-220',
    datasheetUrl: '',
    mpn: 'LM7805CT',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'AMS1117_3V3',
    name: 'AMS1117-3.3',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'SOT-223',
    pins: [p('GND', '1', 0, 20, 'power'), p('VOUT', '2', 40, 0, 'power'), p('VIN', '3', -40, 0, 'power')],
    description: 'LDO regulator, 3.3V 1A, SOT-223',
    datasheetUrl: '',
    mpn: 'AMS1117-3.3',
    manufacturer: 'AMS',
  },
  {
    id: 'TPS54331',
    name: 'TPS54331',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['BOOT', 'VIN', 'EN', 'SS'], ['PH', 'GND', 'VSNS', 'COMP']),
    description: 'Step-down converter, 3A, 3.5V-28V input',
    datasheetUrl: '',
    mpn: 'TPS54331DR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'MP2315',
    name: 'MP2315',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'TSOT23-8',
    pins: icPinsLR(['EN', 'VIN', 'SW', 'PG'], ['BST', 'GND', 'FB', 'SS']),
    description: 'Synchronous step-down converter, 3A, 4.5V-24V',
    datasheetUrl: '',
    mpn: 'MP2315GJ',
    manufacturer: 'MPS',
  },
  {
    id: 'LM2596',
    name: 'LM2596',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'TO-263-5',
    pins: [p('VIN', '1', -40, -10, 'power'), p('VOUT', '2', 40, -10, 'output'), p('GND', '3', 0, 20, 'power'), p('FB', '4', 40, 10, 'input'), p('ON/OFF', '5', -40, 10, 'input')],
    description: 'Step-down converter, 3A, adjustable, TO-263',
    datasheetUrl: '',
    mpn: 'LM2596S-ADJ',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'TPS62130',
    name: 'TPS62130',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'QFN-16',
    pins: icPinsLR(['VIN', 'VIN2', 'EN', 'DEF', 'SS/TR', 'PG', 'FB', 'AGND'], ['SW', 'SW2', 'PGND', 'PGND2', 'VOS', 'AVIN', 'MODE', 'NC']),
    description: 'Step-down converter, 3A, 3V-17V, high efficiency',
    datasheetUrl: '',
    mpn: 'TPS62130RGT',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'AP2112K_3V3',
    name: 'AP2112K-3.3',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'SOT-23-5',
    pins: [p('VIN', '1', -40, -10, 'power'), p('GND', '2', 0, 20, 'power'), p('EN', '3', -40, 10, 'input'), p('NC', '4', 40, 10, 'passive'), p('VOUT', '5', 40, -10, 'power')],
    description: 'LDO regulator, 3.3V 600mA, SOT-23-5',
    datasheetUrl: '',
    mpn: 'AP2112K-3.3TRG1',
    manufacturer: 'Diodes Inc',
  },
  {
    id: 'TPS63020',
    name: 'TPS63020',
    category: 'ICs',
    subcategory: 'Power',
    symbol: 'ic',
    footprint: 'QFN-14',
    pins: icPinsLR(['VIN', 'VIN2', 'EN', 'PS/SYNC', 'PG', 'FB', 'GND'], ['VOUT', 'VOUT2', 'L2', 'L1', 'PGND', 'PGND2', 'NC']),
    description: 'Buck-boost converter, 3.6A, 1.8V-5.5V in, single Li battery',
    datasheetUrl: '',
    mpn: 'TPS63020DSJR',
    manufacturer: 'Texas Instruments',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ICs - INTERFACE (6)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'FT232RL',
    name: 'FT232RL',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'SSOP-28',
    pins: icPinsLR(
      ['TXD', 'DTR', 'RTS', 'VCCIO', 'RXD', 'RI', 'GND', 'NC1', 'DSR', 'DCD', 'CTS', 'CBUS4', 'CBUS2', 'CBUS3'],
      ['VCC', 'GND2', 'USBDP', 'USBDM', 'RESET', '3V3OUT', 'NC2', 'OSCI', 'OSCO', 'TEST', 'AGND', 'CBUS0', 'CBUS1', 'NC3']
    ),
    description: 'USB to UART bridge, SSOP-28',
    datasheetUrl: 'https://ftdichip.com/wp-content/uploads/2020/08/DS_FT232R.pdf',
    mpn: 'FT232RL',
    manufacturer: 'FTDI',
  },
  {
    id: 'CH340G',
    name: 'CH340G',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'SOIC-16',
    pins: icPinsLR(
      ['GND', 'TXD', 'RXD', 'V3', 'UD+', 'UD-', 'XI', 'XO'],
      ['VCC', 'CTS', 'DSR', 'RI', 'DCD', 'DTR', 'RTS', 'RS232']
    ),
    description: 'USB to UART bridge, SOIC-16, low cost',
    datasheetUrl: '',
    mpn: 'CH340G',
    manufacturer: 'WCH',
  },
  {
    id: 'MAX232',
    name: 'MAX232',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'SOIC-16',
    pins: icPinsLR(
      ['C1+', 'VS+', 'C1-', 'C2+', 'C2-', 'VS-', 'T2OUT', 'R2IN'],
      ['VCC', 'GND', 'T1OUT', 'R1IN', 'R1OUT', 'T1IN', 'T2IN', 'R2OUT']
    ),
    description: 'Dual RS-232 driver/receiver, SOIC-16',
    datasheetUrl: '',
    mpn: 'MAX232ESE',
    manufacturer: 'Maxim',
  },
  {
    id: 'SN65HVD230',
    name: 'SN65HVD230',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['TXD', 'GND', 'VCC', 'RXD'], ['CANH', 'CANL', 'Vref', 'Rs']),
    description: 'CAN bus transceiver, 3.3V, 1Mbps',
    datasheetUrl: '',
    mpn: 'SN65HVD230DR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'FUSB302',
    name: 'FUSB302',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'MLP-14',
    pins: icPinsLR(
      ['VDD', 'CC1', 'CC2', 'VBUS', 'INT_N', 'SDA', 'SCL'],
      ['GND', 'GND2', 'ADDR0', 'ADDR1', 'NC1', 'NC2', 'NC3']
    ),
    description: 'USB Type-C PD controller, I2C',
    datasheetUrl: '',
    mpn: 'FUSB302BMPX',
    manufacturer: 'ON Semi',
  },
  {
    id: 'CP2102N',
    name: 'CP2102N',
    category: 'ICs',
    subcategory: 'Interface',
    symbol: 'ic',
    footprint: 'QFN-28',
    pins: icPinsLR(
      ['DCD', 'RI', 'GND', 'D+', 'D-', 'VDD', 'VREGIN', 'VBUS', 'RSTB', 'NC1', 'SUSB', 'SUSPEND', 'CHREN', 'CHR1'],
      ['GPIO0', 'GPIO1', 'GPIO2', 'GPIO3', 'NC2', 'NC3', 'RXD', 'TXD', 'RTS', 'CTS', 'DSR', 'DTR', 'WAKEUP', 'CLK']
    ),
    description: 'USB to UART bridge, QFN-28, Silicon Labs',
    datasheetUrl: '',
    mpn: 'CP2102N-A02-GQFN28',
    manufacturer: 'Silicon Labs',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ICs - ANALOG (6)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'LM358',
    name: 'LM358',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['OUT1', 'IN1-', 'IN1+', 'GND'], ['VCC', 'OUT2', 'IN2-', 'IN2+']),
    description: 'Dual op-amp, general purpose, SOIC-8',
    datasheetUrl: '',
    mpn: 'LM358DR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'OPA2340',
    name: 'OPA2340',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['OUT1', 'IN1-', 'IN1+', 'V-'], ['V+', 'OUT2', 'IN2-', 'IN2+']),
    description: 'Dual CMOS rail-to-rail op-amp, 5.5MHz',
    datasheetUrl: '',
    mpn: 'OPA2340UA',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'ADS1115',
    name: 'ADS1115',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'MSOP-10',
    pins: icPinsLR(['ADDR', 'ALERT', 'GND', 'AIN0', 'AIN1'], ['VDD', 'SDA', 'SCL', 'AIN2', 'AIN3']),
    description: '16-bit ADC, 4-channel, I2C, 860 SPS',
    datasheetUrl: '',
    mpn: 'ADS1115IDGST',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'MCP3008',
    name: 'MCP3008',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'SOIC-16',
    pins: icPinsLR(['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7'], ['VDD', 'VREF', 'AGND', 'CLK', 'DOUT', 'DIN', 'CS', 'DGND']),
    description: '10-bit ADC, 8-channel, SPI, 200ksps',
    datasheetUrl: '',
    mpn: 'MCP3008-I/SL',
    manufacturer: 'Microchip',
  },
  {
    id: 'DAC8552',
    name: 'DAC8552',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['VOUTA', 'VOUTB', 'GND', 'DIN'], ['VDD', 'VREF', 'SYNC', 'SCLK']),
    description: 'Dual 16-bit DAC, SPI, low power',
    datasheetUrl: '',
    mpn: 'DAC8552IDGK',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'INA219',
    name: 'INA219',
    category: 'ICs',
    subcategory: 'Analog',
    symbol: 'ic',
    footprint: 'SOT-23-6',
    pins: icPinsLR(['VS+', 'VS-', 'GND'], ['VCC', 'SCL', 'SDA']),
    description: 'High-side current/power monitor, I2C',
    datasheetUrl: '',
    mpn: 'INA219AIDR',
    manufacturer: 'Texas Instruments',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ICs - MEMORY (4)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'W25Q128',
    name: 'W25Q128',
    category: 'ICs',
    subcategory: 'Memory',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['CS', 'DO', 'WP', 'GND'], ['VCC', 'HOLD', 'CLK', 'DI']),
    description: 'SPI NOR Flash, 128Mbit (16MB)',
    datasheetUrl: '',
    mpn: 'W25Q128JVSIQ',
    manufacturer: 'Winbond',
  },
  {
    id: 'AT24C256',
    name: 'AT24C256',
    category: 'ICs',
    subcategory: 'Memory',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['A0', 'A1', 'A2', 'GND'], ['VCC', 'WP', 'SCL', 'SDA']),
    description: 'I2C EEPROM, 256Kbit (32KB)',
    datasheetUrl: '',
    mpn: 'AT24C256C-SSHL-T',
    manufacturer: 'Microchip',
  },
  {
    id: 'IS62WV5128',
    name: 'IS62WV5128',
    category: 'ICs',
    subcategory: 'Memory',
    symbol: 'ic',
    footprint: 'TSOP-II-44',
    pins: icPinsLR(
      ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15'],
      ['DQ0', 'DQ1', 'DQ2', 'DQ3', 'DQ4', 'DQ5', 'DQ6', 'DQ7', 'CE', 'OE', 'WE', 'VCC', 'GND', 'A16', 'A17', 'A18']
    ),
    description: 'Async SRAM, 4Mbit (512KB), 55ns',
    datasheetUrl: '',
    mpn: 'IS62WV5128BLL-55TLI',
    manufacturer: 'ISSI',
  },
  {
    id: 'W25Q32',
    name: 'W25Q32',
    category: 'ICs',
    subcategory: 'Memory',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['CS', 'DO', 'WP', 'GND'], ['VCC', 'HOLD', 'CLK', 'DI']),
    description: 'SPI NOR Flash, 32Mbit (4MB)',
    datasheetUrl: '',
    mpn: 'W25Q32JVSSIQ',
    manufacturer: 'Winbond',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTORS (14)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'USB_A',
    name: 'USB-A Receptacle',
    category: 'Connectors',
    subcategory: 'USB',
    symbol: 'connector',
    footprint: 'USB_A_TH',
    pins: [p('VBUS', '1', -30, -10, 'power'), p('D-', '2', -30, 0, 'bidirectional'), p('D+', '3', -30, 10, 'bidirectional'), p('GND', '4', 30, 0, 'power')],
    description: 'USB Type-A receptacle, through-hole',
    datasheetUrl: '',
    mpn: 'USB-A1HSW6',
    manufacturer: 'On Shore',
  },
  {
    id: 'USB_B',
    name: 'USB-B Receptacle',
    category: 'Connectors',
    subcategory: 'USB',
    symbol: 'connector',
    footprint: 'USB_B_TH',
    pins: [p('VBUS', '1', -30, -10, 'power'), p('D-', '2', -30, 0, 'bidirectional'), p('D+', '3', -30, 10, 'bidirectional'), p('GND', '4', 30, 0, 'power')],
    description: 'USB Type-B receptacle, through-hole',
    datasheetUrl: '',
    mpn: 'USB-B1HSW6',
    manufacturer: 'On Shore',
  },
  {
    id: 'USB_C',
    name: 'USB-C Receptacle',
    category: 'Connectors',
    subcategory: 'USB',
    symbol: 'connector',
    footprint: 'USB_C_SMD',
    pins: [
      p('GND', 'A1', -30, -20, 'power'), p('VBUS', 'A4', -30, -10, 'power'),
      p('CC1', 'A5', -30, 0, 'bidirectional'), p('D+', 'A6', -30, 10, 'bidirectional'),
      p('D-', 'A7', -30, 20, 'bidirectional'), p('SBU1', 'A8', 30, -20, 'bidirectional'),
      p('CC2', 'B5', 30, -10, 'bidirectional'), p('SBU2', 'B8', 30, 0, 'bidirectional'),
      p('VBUS2', 'B9', 30, 10, 'power'), p('GND2', 'B12', 30, 20, 'power'),
    ],
    description: 'USB Type-C receptacle, 24-pin, SMD',
    datasheetUrl: '',
    mpn: 'USB4105-GF-A',
    manufacturer: 'GCT',
  },
  {
    id: 'CONN_2PIN',
    name: 'Pin Header 2P',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_1x02_P2.54mm',
    pins: [p('1', '1', -20, -5, 'passive'), p('2', '2', -20, 5, 'passive')],
    description: 'Pin header, 1x2, 2.54mm pitch',
    datasheetUrl: '',
    mpn: 'PH1-02-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'CONN_4PIN',
    name: 'Pin Header 4P',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_1x04_P2.54mm',
    pins: [p('1', '1', -20, -15, 'passive'), p('2', '2', -20, -5, 'passive'), p('3', '3', -20, 5, 'passive'), p('4', '4', -20, 15, 'passive')],
    description: 'Pin header, 1x4, 2.54mm pitch',
    datasheetUrl: '',
    mpn: 'PH1-04-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'CONN_6PIN',
    name: 'Pin Header 6P',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_1x06_P2.54mm',
    pins: Array.from({ length: 6 }, (_, i) => p(String(i + 1), String(i + 1), -20, -25 + i * 10, 'passive')),
    description: 'Pin header, 1x6, 2.54mm pitch',
    datasheetUrl: '',
    mpn: 'PH1-06-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'CONN_10PIN',
    name: 'Pin Header 10P 2x5',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_2x05_P2.54mm',
    pins: Array.from({ length: 10 }, (_, i) => p(String(i + 1), String(i + 1), i < 5 ? -20 : 20, -20 + (i % 5) * 10, 'passive')),
    description: 'Pin header, 2x5, 2.54mm pitch (JTAG/SWD)',
    datasheetUrl: '',
    mpn: 'PH2-05-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'CONN_20PIN',
    name: 'Pin Header 20P',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_1x20_P2.54mm',
    pins: Array.from({ length: 20 }, (_, i) => p(String(i + 1), String(i + 1), -20, -95 + i * 10, 'passive')),
    description: 'Pin header, 1x20, 2.54mm pitch',
    datasheetUrl: '',
    mpn: 'PH1-20-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'CONN_40PIN',
    name: 'Pin Header 40P 2x20',
    category: 'Connectors',
    subcategory: 'Pin Headers',
    symbol: 'connector',
    footprint: 'PinHeader_2x20_P2.54mm',
    pins: Array.from({ length: 40 }, (_, i) => p(String(i + 1), String(i + 1), i < 20 ? -20 : 20, -95 + (i % 20) * 10, 'passive')),
    description: 'Pin header, 2x20, 2.54mm pitch (RPi GPIO)',
    datasheetUrl: '',
    mpn: 'PH2-20-UA',
    manufacturer: 'Adam Tech',
  },
  {
    id: 'JST_XH_4',
    name: 'JST-XH 4P',
    category: 'Connectors',
    subcategory: 'JST',
    symbol: 'connector',
    footprint: 'JST_XH_4P_2.50mm',
    pins: [p('1', '1', -20, -15, 'passive'), p('2', '2', -20, -5, 'passive'), p('3', '3', -20, 5, 'passive'), p('4', '4', -20, 15, 'passive')],
    description: 'JST XH connector, 4-pin, 2.5mm pitch',
    datasheetUrl: '',
    mpn: 'B4B-XH-A',
    manufacturer: 'JST',
  },
  {
    id: 'JST_XH_6',
    name: 'JST-XH 6P',
    category: 'Connectors',
    subcategory: 'JST',
    symbol: 'connector',
    footprint: 'JST_XH_6P_2.50mm',
    pins: Array.from({ length: 6 }, (_, i) => p(String(i + 1), String(i + 1), -20, -25 + i * 10, 'passive')),
    description: 'JST XH connector, 6-pin, 2.5mm pitch',
    datasheetUrl: '',
    mpn: 'B6B-XH-A',
    manufacturer: 'JST',
  },
  {
    id: 'RJ45',
    name: 'RJ45 Jack',
    category: 'Connectors',
    subcategory: 'Network',
    symbol: 'connector',
    footprint: 'RJ45_TH',
    pins: [
      p('TX+', '1', -30, -30, 'bidirectional'), p('TX-', '2', -30, -20, 'bidirectional'),
      p('RX+', '3', -30, -10, 'bidirectional'), p('NC1', '4', -30, 0, 'passive'),
      p('NC2', '5', -30, 10, 'passive'), p('RX-', '6', -30, 20, 'bidirectional'),
      p('NC3', '7', -30, 30, 'passive'), p('NC4', '8', -30, 40, 'passive'),
      p('SHIELD', 'S', 30, 0, 'passive'),
    ],
    description: 'RJ45 Ethernet jack with magnetics',
    datasheetUrl: '',
    mpn: 'J1B1211CCD',
    manufacturer: 'Ckmtw',
  },
  {
    id: 'SMA',
    name: 'SMA Connector',
    category: 'Connectors',
    subcategory: 'RF',
    symbol: 'connector',
    footprint: 'SMA_Edge',
    pins: [p('SIG', '1', -30, 0, 'passive'), p('GND', '2', 30, 0, 'power')],
    description: 'SMA edge-mount RF connector, 50 Ohm',
    datasheetUrl: '',
    mpn: 'SMA-J-P-H-ST-EM1',
    manufacturer: 'Samtec',
  },
  {
    id: 'SD_CARD',
    name: 'SD Card Socket',
    category: 'Connectors',
    subcategory: 'Memory Card',
    symbol: 'connector',
    footprint: 'SD_Card_SMD',
    pins: [
      p('DAT2', '1', -30, -30, 'bidirectional'), p('CD/DAT3', '2', -30, -20, 'bidirectional'),
      p('CMD', '3', -30, -10, 'input'), p('VDD', '4', -30, 0, 'power'),
      p('CLK', '5', -30, 10, 'input'), p('VSS', '6', -30, 20, 'power'),
      p('DAT0', '7', -30, 30, 'bidirectional'), p('DAT1', '8', -30, 40, 'bidirectional'),
      p('DET', '9', 30, 0, 'output'),
    ],
    description: 'Micro SD card socket, push-push, SMD',
    datasheetUrl: '',
    mpn: 'DM3AT-SF-PEJM5',
    manufacturer: 'Hirose',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTROMECHANICAL (6)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'SW_Tactile',
    name: 'Tactile Switch',
    category: 'Electromechanical',
    subcategory: 'Switches',
    symbol: 'switch',
    footprint: 'SW_Tactile_6x6mm',
    pins: [p('1', '1', -30, 0, 'passive'), p('2', '2', 30, 0, 'passive')],
    description: 'Tactile push button, 6x6mm, SMD',
    datasheetUrl: '',
    mpn: 'B3U-1000P',
    manufacturer: 'Omron',
  },
  {
    id: 'SW_Tactile_4.5',
    name: 'Tactile Switch 4.5mm',
    category: 'Electromechanical',
    subcategory: 'Switches',
    symbol: 'switch',
    footprint: 'SW_Tactile_4.5x4.5mm',
    pins: [p('1', '1', -30, 0, 'passive'), p('2', '2', 30, 0, 'passive')],
    description: 'Tactile push button, 4.5x4.5mm, SMD',
    datasheetUrl: '',
    mpn: 'KSC241JLFS',
    manufacturer: 'C&K',
  },
  {
    id: 'SW_Slide',
    name: 'Slide Switch',
    category: 'Electromechanical',
    subcategory: 'Switches',
    symbol: 'switch',
    footprint: 'SW_Slide_SPDT',
    pins: [p('COM', '1', -30, 0, 'passive'), p('NO1', '2', 30, -10, 'passive'), p('NO2', '3', 30, 10, 'passive')],
    description: 'Slide switch, SPDT, SMD',
    datasheetUrl: '',
    mpn: 'OS102011MA1QN1',
    manufacturer: 'C&K',
  },
  {
    id: 'SW_DIP_4',
    name: 'DIP Switch 4P',
    category: 'Electromechanical',
    subcategory: 'Switches',
    symbol: 'ic',
    footprint: 'SW_DIP_x04',
    pins: icPinsLR(['1', '2', '3', '4'], ['8', '7', '6', '5']),
    description: 'DIP switch, 4 position, SMD',
    datasheetUrl: '',
    mpn: 'A6S-4102-H',
    manufacturer: 'Omron',
  },
  {
    id: 'Relay_SPDT',
    name: 'Relay SPDT',
    category: 'Electromechanical',
    subcategory: 'Relays',
    symbol: 'ic',
    footprint: 'Relay_SPDT_Omron_G6K',
    pins: [p('COIL+', '1', -30, -10, 'passive'), p('COIL-', '2', -30, 10, 'passive'), p('COM', '3', 30, 0, 'passive'), p('NO', '4', 30, -10, 'passive'), p('NC', '5', 30, 10, 'passive')],
    description: 'Signal relay, SPDT, 5V coil',
    datasheetUrl: '',
    mpn: 'G6K-2F-Y-5DC',
    manufacturer: 'Omron',
  },
  {
    id: 'Buzzer',
    name: 'Buzzer SMD',
    category: 'Electromechanical',
    subcategory: 'Audio',
    symbol: 'ic',
    footprint: 'Buzzer_SMD_12x9.5mm',
    pins: [p('+', '1', -30, 0, 'passive'), p('-', '2', 30, 0, 'passive')],
    description: 'SMD buzzer, magnetic, 12mm, 2.7kHz',
    datasheetUrl: '',
    mpn: 'CMT-1203-SMT',
    manufacturer: 'CUI Devices',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SENSORS (6)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'BME280',
    name: 'BME280',
    category: 'Sensors',
    subcategory: 'Environmental',
    symbol: 'ic',
    footprint: 'LGA-8_2.5x2.5mm',
    pins: icPinsLR(['VDD', 'GND', 'SDI', 'SCK'], ['CSB', 'SDO', 'VDDIO', 'GND2']),
    description: 'Temp/humidity/pressure sensor, I2C/SPI',
    datasheetUrl: 'https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme280-ds002.pdf',
    mpn: 'BME280',
    manufacturer: 'Bosch',
  },
  {
    id: 'LIS2DH12',
    name: 'LIS2DH12',
    category: 'Sensors',
    subcategory: 'IMU',
    symbol: 'ic',
    footprint: 'LGA-12_2x2mm',
    pins: icPinsLR(
      ['VDD_IO', 'NC1', 'NC2', 'SCL', 'GND', 'SDA'],
      ['VDD', 'NC3', 'INT2', 'INT1', 'GND2', 'CS']
    ),
    description: '3-axis accelerometer, I2C/SPI, ultra low power',
    datasheetUrl: '',
    mpn: 'LIS2DH12TR',
    manufacturer: 'STMicroelectronics',
  },
  {
    id: 'MPU6050',
    name: 'MPU6050',
    category: 'Sensors',
    subcategory: 'IMU',
    symbol: 'ic',
    footprint: 'QFN-24_4x4mm',
    pins: icPinsLR(
      ['CLKIN', 'NC1', 'NC2', 'NC3', 'NC4', 'AUX_DA', 'AUX_CL', 'VLOGIC', 'AD0', 'REGOUT'],
      ['VDD', 'GND', 'RESV', 'FSYNC', 'INT', 'SDA', 'SCL', 'GND2', 'GND3', 'CPOUT']
    ),
    description: '6-axis IMU (accel + gyro), I2C, 16-bit',
    datasheetUrl: '',
    mpn: 'MPU-6050',
    manufacturer: 'InvenSense',
  },
  {
    id: 'BH1750',
    name: 'BH1750',
    category: 'Sensors',
    subcategory: 'Light',
    symbol: 'ic',
    footprint: 'WSOF-6',
    pins: icPinsLR(['VCC', 'ADDR', 'GND'], ['SDA', 'SCL', 'DVI']),
    description: 'Ambient light sensor, I2C, 16-bit, 1-65535 lux',
    datasheetUrl: '',
    mpn: 'BH1750FVI-TR',
    manufacturer: 'Rohm',
  },
  {
    id: 'ACS712_20A',
    name: 'ACS712-20A',
    category: 'Sensors',
    subcategory: 'Current',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['IP+1', 'IP+2', 'IP-1', 'IP-2'], ['VCC', 'VIOUT', 'FILTER', 'GND']),
    description: 'Hall-effect current sensor, +/-20A, analog out',
    datasheetUrl: '',
    mpn: 'ACS712ELCTR-20A-T',
    manufacturer: 'Allegro',
  },
  {
    id: 'MAX31855',
    name: 'MAX31855',
    category: 'Sensors',
    subcategory: 'Temperature',
    symbol: 'ic',
    footprint: 'SOIC-8',
    pins: icPinsLR(['GND', 'T-', 'T+', 'VCC'], ['SO', 'CS', 'SCK', 'NC']),
    description: 'Thermocouple-to-digital converter, SPI, K-type',
    datasheetUrl: '',
    mpn: 'MAX31855KASA+T',
    manufacturer: 'Maxim',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RF (4)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'nRF24L01_CONN',
    name: 'nRF24L01+ Connector',
    category: 'RF',
    subcategory: 'Wireless',
    symbol: 'ic',
    footprint: 'PinHeader_2x04_P2.54mm',
    pins: icPinsLR(['GND', 'CSN', 'MOSI', 'IRQ'], ['VCC', 'CE', 'SCK', 'MISO']),
    description: '2.4GHz transceiver module connector, 8-pin',
    datasheetUrl: '',
    mpn: 'nRF24L01+',
    manufacturer: 'Nordic Semiconductor',
  },
  {
    id: 'SX1276',
    name: 'SX1276',
    category: 'RF',
    subcategory: 'LoRa',
    symbol: 'ic',
    footprint: 'QFN-28_4x4mm',
    pins: icPinsLR(
      ['GND', 'DIO5', 'RXTX', 'DIO3', 'DIO4', 'VDD_ANA', 'RFI_HF', 'RFO_HF', 'GND2', 'GND3', 'RFI_LF', 'RFO_LF', 'VDD_ANA2', 'DIO2'],
      ['VDD_DIG', 'DIO1', 'DIO0', 'RESET', 'NSS', 'SCK', 'MOSI', 'MISO', 'GND4', 'GND5', 'VDD_DIG2', 'XOSC32_A', 'XOSC32_B', 'GND6']
    ),
    description: 'LoRa/FSK transceiver, 137-1020MHz, SPI',
    datasheetUrl: '',
    mpn: 'SX1276IMLTRT',
    manufacturer: 'Semtech',
  },
  {
    id: 'CC1101',
    name: 'CC1101',
    category: 'RF',
    subcategory: 'Sub-GHz',
    symbol: 'ic',
    footprint: 'QFN-20_4x4mm',
    pins: icPinsLR(
      ['SCLK', 'SO/GDO1', 'GDO2', 'DVDD', 'DCPL', 'GDO0', 'CSn', 'XOSC_Q1', 'AVDD1', 'AVDD2'],
      ['SI', 'AVDD3', 'AVDD4', 'RF_P', 'RF_N', 'AVDD5', 'AVDD6', 'GND', 'RBIAS', 'DGUARD']
    ),
    description: 'Sub-1GHz transceiver, 300-348/387-464/779-928MHz',
    datasheetUrl: '',
    mpn: 'CC1101RGPR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'ESP_ANT',
    name: 'ESP32 PCB Antenna',
    category: 'RF',
    subcategory: 'Antenna',
    symbol: 'connector',
    footprint: 'Ant_2.4GHz_PCB',
    pins: [p('FEED', '1', -30, 0, 'passive'), p('GND', '2', 30, 0, 'power')],
    description: '2.4GHz PCB trace antenna for ESP32/WiFi/BLE',
    datasheetUrl: '',
    mpn: 'PCB-ANT-2.4G',
    manufacturer: 'Generic',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL - Logic ICs (4)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'SN74HC595',
    name: '74HC595',
    category: 'ICs',
    subcategory: 'Logic',
    symbol: 'ic',
    footprint: 'SOIC-16',
    pins: icPinsLR(
      ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND'],
      ['VCC', 'QA', 'SER', 'OE', 'RCLK', 'SRCLK', 'SRCLR', 'QH_P']
    ),
    description: '8-bit shift register, serial-in parallel-out',
    datasheetUrl: '',
    mpn: 'SN74HC595DR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'SN74HC245',
    name: '74HC245',
    category: 'ICs',
    subcategory: 'Logic',
    symbol: 'ic',
    footprint: 'SOIC-20',
    pins: icPinsLR(
      ['DIR', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'GND'],
      ['VCC', 'OE', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']
    ),
    description: 'Octal bus transceiver, 3-state',
    datasheetUrl: '',
    mpn: 'SN74HC245DWR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'SN74LVC1G14',
    name: '74LVC1G14',
    category: 'ICs',
    subcategory: 'Logic',
    symbol: 'ic',
    footprint: 'SOT-23-5',
    pins: [p('A', '1', -40, 0, 'input'), p('GND', '2', 0, 20, 'power'), p('Y', '3', 40, 0, 'output'), p('NC', '4', 0, -20, 'passive'), p('VCC', '5', 0, -10, 'power')],
    description: 'Single Schmitt-trigger inverter',
    datasheetUrl: '',
    mpn: 'SN74LVC1G14DBVR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'TXB0108',
    name: 'TXB0108',
    category: 'ICs',
    subcategory: 'Logic',
    symbol: 'ic',
    footprint: 'TSSOP-20',
    pins: icPinsLR(
      ['VCCA', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'OE'],
      ['VCCB', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'GND']
    ),
    description: '8-bit bidirectional level shifter, auto direction',
    datasheetUrl: '',
    mpn: 'TXB0108PWR',
    manufacturer: 'Texas Instruments',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL - ESD / Protection (3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'USBLC6_2',
    name: 'USBLC6-2',
    category: 'ICs',
    subcategory: 'Protection',
    symbol: 'ic',
    footprint: 'SOT-23-6',
    pins: icPinsLR(['IO1', 'GND', 'IO2'], ['VBUS', 'IO3', 'IO4']),
    description: 'USB ESD protection, dual, SOT-23-6',
    datasheetUrl: '',
    mpn: 'USBLC6-2SC6',
    manufacturer: 'STMicroelectronics',
  },
  {
    id: 'TPD4E05U06',
    name: 'TPD4E05U06',
    category: 'ICs',
    subcategory: 'Protection',
    symbol: 'ic',
    footprint: 'USON-6',
    pins: icPinsLR(['IO1', 'IO2', 'GND'], ['VCC', 'IO3', 'IO4']),
    description: '4-channel ESD protection, 6V clamp',
    datasheetUrl: '',
    mpn: 'TPD4E05U06DQAR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'SP0503BAHT',
    name: 'SP0503BAHT',
    category: 'ICs',
    subcategory: 'Protection',
    symbol: 'ic',
    footprint: 'SOT-143',
    pins: [p('GND', '1', 0, 20, 'power'), p('IO1', '2', -30, 0, 'passive'), p('IO2', '3', 30, 0, 'passive'), p('IO3', '4', 0, -20, 'passive')],
    description: 'TVS array, 3-channel, I2C/SPI protection',
    datasheetUrl: '',
    mpn: 'SP0503BAHTG',
    manufacturer: 'Littelfuse',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL - Motor drivers (2)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'DRV8833',
    name: 'DRV8833',
    category: 'ICs',
    subcategory: 'Motor Driver',
    symbol: 'ic',
    footprint: 'HTSSOP-16',
    pins: icPinsLR(
      ['nSLEEP', 'AISEN', 'AIN1', 'AIN2', 'BIN2', 'BIN1', 'BISEN', 'nFAULT'],
      ['VCC', 'AOUT1', 'AOUT2', 'GND', 'GND2', 'BOUT2', 'BOUT1', 'VM']
    ),
    description: 'Dual H-bridge motor driver, 1.5A per channel',
    datasheetUrl: '',
    mpn: 'DRV8833PWPR',
    manufacturer: 'Texas Instruments',
  },
  {
    id: 'A4988',
    name: 'A4988',
    category: 'ICs',
    subcategory: 'Motor Driver',
    symbol: 'ic',
    footprint: 'QFN-28',
    pins: icPinsLR(
      ['CP1', 'CP2', 'VCP', 'VBB', 'ROSC', 'VDD', 'MS1', 'MS2', 'MS3', 'RESET', 'SLEEP', 'STEP', 'DIR', 'GND'],
      ['OUT1B', 'VBB2', 'OUT1A', 'SENSE1', 'GND2', 'SENSE2', 'OUT2A', 'VBB3', 'OUT2B', 'ENABLE', 'PFD', 'VDD2', 'REF', 'GND3']
    ),
    description: 'Stepper motor driver, microstepping, 2A',
    datasheetUrl: '',
    mpn: 'A4988SETTR-T',
    manufacturer: 'Allegro',
  },
];

// ─── Indexed lookups ─────────────────────────────────────────────────────────

export const componentById = new Map<string, LibComponent>(
  componentLibrary.map((c) => [c.id, c])
);

export const componentsByCategory = componentLibrary.reduce<Record<string, LibComponent[]>>((acc, c) => {
  if (!acc[c.category]) acc[c.category] = [];
  acc[c.category].push(c);
  return acc;
}, {});

export const componentsBySubcategory = componentLibrary.reduce<Record<string, LibComponent[]>>((acc, c) => {
  const key = `${c.category}/${c.subcategory}`;
  if (!acc[key]) acc[key] = [];
  acc[key].push(c);
  return acc;
}, {});

export function searchComponents(query: string): LibComponent[] {
  const q = query.toLowerCase();
  return componentLibrary.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.mpn.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.subcategory.toLowerCase().includes(q)
  );
}

// ─── KiCad Symbol Fetch & Cache ───────────────────────────────────────────
// When a component is selected for placement, fetch its full KiCad symbol
// data from the API and cache it in memory.

import type { KiCadSymbolData } from '../components/SymbolLibrary';

/** Map frontend symbol type to KiCad symbol name for basic components */
const KICAD_SYMBOL_MAP: Record<string, string> = {
  'resistor': 'R',
  'capacitor': 'C',
  'capacitor_polarized': 'C_Polarized',
  'inductor': 'L',
  'diode': 'D',
  'led': 'LED',
  'zener': 'D_Zener',
  'schottky': 'D_Schottky',
  'tvs': 'D_TVS',
  'npn': 'Q_NPN_BEC',
  'pnp': 'Q_PNP_BEC',
  'nmos': 'Q_NMOS_GDS',
  'pmos': 'Q_PMOS_GDS',
  'opamp': 'Amplifier_Operational',
  'crystal': 'Crystal',
  'fuse': 'Fuse',
  'switch': 'SW_Push',
  'ferrite': 'FerriteBead',
};

const _kicadSymbolCache = new Map<string, KiCadSymbolData>();
const _kicadFetchInFlight = new Map<string, Promise<KiCadSymbolData | null>>();

/**
 * Fetch the full KiCad symbol data (with pins & body) for a given symbol name.
 * Results are cached in memory -- subsequent calls return immediately.
 */
export async function fetchKiCadSymbol(name: string): Promise<KiCadSymbolData | null> {
  const key = name.toLowerCase();

  // 1. Cache hit
  const cached = _kicadSymbolCache.get(key);
  if (cached) return cached;

  // 2. De-duplicate in-flight requests
  const existing = _kicadFetchInFlight.get(key);
  if (existing) return existing;

  // 3. Fetch from API
  const promise = (async (): Promise<KiCadSymbolData | null> => {
    try {
      const resp = await fetch(`/api/components/symbol/${encodeURIComponent(name)}`);
      if (!resp.ok) return null;
      const data = await resp.json();
      if (!data.found || !data.symbol) return null;
      const sym: KiCadSymbolData = data.symbol;
      _kicadSymbolCache.set(key, sym);
      return sym;
    } catch {
      return null;
    } finally {
      _kicadFetchInFlight.delete(key);
    }
  })();

  _kicadFetchInFlight.set(key, promise);
  return promise;
}

/** Check if a symbol is already cached (synchronous). */
export function getCachedKiCadSymbol(name: string): KiCadSymbolData | undefined {
  return _kicadSymbolCache.get(name.toLowerCase());
}

/**
 * Enrich a LibComponent with its KiCad symbol data.
 * Call this when a component is selected for placement.
 * Mutates the component in-place by setting kicadSymbol, and also
 * updates its pins array to match the real KiCad pin positions.
 */
export async function enrichWithKiCadSymbol(comp: LibComponent): Promise<LibComponent> {
  // Build a set of candidate names to try, in priority order.
  const namesToTry = new Set<string>();

  // 1. Try explicit KiCad symbol map first (for basic passive/discrete components).
  //    This avoids fuzzy-matching footprint names like "R_0603" against symbol "R".
  const mappedName = KICAD_SYMBOL_MAP[comp.symbol];
  if (mappedName) namesToTry.add(mappedName);

  // 2. Original names (component name, MPN, id)
  if (comp.name) namesToTry.add(comp.name);
  if (comp.mpn) namesToTry.add(comp.mpn);
  if (comp.id) namesToTry.add(comp.id);

  // 3. KiCad naming conventions for ICs (Tx/x suffix patterns)
  if (comp.symbol === 'ic' || comp.symbol === 'opamp') {
    if (comp.name) {
      namesToTry.add(comp.name + 'Tx');  // LQFP/TQFP packages
      namesToTry.add(comp.name + 'x');   // Generic suffix
    }
    if (comp.mpn) {
      // Remove trailing package code (e.g., "STM32F103C8T6" -> "STM32F103C8T" -> try with "x")
      const mpnBase = comp.mpn.replace(/\d+$/, '');  // Remove trailing digits
      namesToTry.add(mpnBase + 'x');
    }
  }

  for (const n of namesToTry) {
    if (!n) continue;
    const sym = await fetchKiCadSymbol(n);
    if (sym) {
      comp.kicadSymbol = sym;
      // Update pins to match KiCad positions so wires connect correctly
      comp.pins = sym.pins.map((kp) => ({
        name: kp.name,
        number: kp.number,
        x: kp.x,
        y: kp.y,
        type: mapPinType(kp.type) as import('../types').PinType,
      }));
      return comp;
    }
  }
  return comp;
}

/** Map KiCad pin electrical type to our simplified PinType */
function mapPinType(kicadType: string): string {
  switch (kicadType) {
    case 'bidirectional':
    case 'tri_state':
      return 'bidirectional';
    case 'input':
      return 'input';
    case 'output':
    case 'open_collector':
    case 'open_emitter':
      return 'output';
    case 'power':
    case 'power_in':
    case 'power_out':
    case 'power_flag':
      return 'power';
    default:
      return 'passive';
  }
}
