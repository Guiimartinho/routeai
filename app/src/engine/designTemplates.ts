// ─── Design Template Generation Engine ────────────────────────────────────────
// Pre-built circuit templates that generate complete schematics with real
// SchComponent, SchWire, and SchLabel objects ready for the project store.

import type { SchComponent, SchWire, SchLabel, SchPin, PinType, Point } from '../types';
import { SYMBOL_DEFS, generateICSymbol } from '../components/SymbolLibrary';
import type { SymbolDef } from '../components/SymbolLibrary';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface TemplateParams {
  voltage?: number;
  mcu?: string;
  interfaces?: string[];
}

export interface TemplateResult {
  components: SchComponent[];
  wires: SchWire[];
  labels: SchLabel[];
}

export interface DesignTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  params?: {
    voltage?: { min: number; max: number; default: number };
    mcu?: { options: string[]; default: string };
    interfaces?: { options: string[]; default: string[] };
  };
  generate: (params: TemplateParams) => TemplateResult;
}

// ─── UID generation ──────────────────────────────────────────────────────────

let _tplUid = 0;
function uid(prefix: string): string {
  return `${prefix}_tpl_${Date.now()}_${(++_tplUid).toString(36)}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reference designator counters, scoped per generate() call */
interface RefCounters {
  [prefix: string]: number;
}

function nextRef(counters: RefCounters, prefix: string): string {
  if (!counters[prefix]) counters[prefix] = 0;
  counters[prefix]++;
  return `${prefix}${counters[prefix]}`;
}

/** Build a SchPin from LibPin-style data */
function mkPin(name: string, number: string, x: number, y: number, type: PinType = 'passive'): SchPin {
  return { id: uid('pin'), name, number, x, y, type };
}

/** Create a SchComponent from symbol defs or custom pin layout */
function mkComponent(
  ref: string,
  type: string,
  symbol: string,
  value: string,
  footprint: string,
  x: number,
  y: number,
  rotation: number,
  customPins?: SchPin[],
): SchComponent {
  let pins: SchPin[];
  if (customPins) {
    pins = customPins;
  } else {
    const def = SYMBOL_DEFS[symbol];
    if (def) {
      pins = def.pins.map(p => mkPin(p.name, p.number, p.x, p.y, p.type));
    } else {
      pins = [mkPin('1', '1', -15, 0), mkPin('2', '2', 15, 0)];
    }
  }
  return {
    id: uid('comp'),
    type, ref, value, x, y, rotation, pins, symbol, footprint,
  };
}

/** Create a power symbol (GND, VCC, +3V3, etc.) */
function mkPower(
  ref: string,
  symbol: string,
  value: string,
  x: number,
  y: number,
): SchComponent {
  const def = SYMBOL_DEFS[symbol];
  const pins = def
    ? def.pins.map(p => mkPin(p.name, p.number, p.x, p.y, p.type))
    : [mkPin('1', '1', 0, -10, 'power')];
  return {
    id: uid('pwr'),
    type: symbol,
    ref, value, x, y,
    rotation: 0,
    pins,
    symbol,
    footprint: '',
  };
}

/** Create a wire between two absolute points */
function mkWire(points: Point[]): SchWire {
  return { id: uid('wire'), points };
}

/** Create a label */
function mkLabel(text: string, x: number, y: number, type: 'local' | 'global' | 'power' = 'local'): SchLabel {
  return { id: uid('lbl'), text, x, y, type };
}

/** Create IC pins for a given pin map: [pinNumber, name, side, index, type] */
type PinSpec = [string, string, 'L' | 'R' | 'T' | 'B', number, PinType];

function mkICPins(specs: PinSpec[], bodyW: number, bodyH: number, pinSpacing: number = 10): SchPin[] {
  const halfW = bodyW / 2;
  const halfH = bodyH / 2;
  const stub = 6;
  return specs.map(([number, name, side, idx, type]) => {
    let x = 0, y = 0;
    switch (side) {
      case 'L': x = -(halfW + stub); y = -halfH + 10 + idx * pinSpacing; break;
      case 'R': x = halfW + stub; y = -halfH + 10 + idx * pinSpacing; break;
      case 'T': x = -halfW + 10 + idx * pinSpacing; y = -(halfH + stub); break;
      case 'B': x = -halfW + 10 + idx * pinSpacing; y = halfH + stub; break;
    }
    return mkPin(name, number, x, y, type);
  });
}

// Grid spacing for component placement
const GRID = 30; // mm

// ─── Template: STM32 Minimal ─────────────────────────────────────────────────

function generateSTM32Minimal(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU - STM32F103C8T6 (48-pin LQFP)
  const mcuPins: SchPin[] = mkICPins([
    // Left side - Power & reset
    ['7', 'NRST', 'L', 0, 'input'],
    ['8', 'VSSA', 'L', 1, 'power'],
    ['9', 'VDDA', 'L', 2, 'power'],
    ['44', 'BOOT0', 'L', 3, 'input'],
    ['23', 'VDD1', 'L', 4, 'power'],
    ['35', 'VDD2', 'L', 5, 'power'],
    ['47', 'VDD3', 'L', 6, 'power'],
    ['48', 'VSS', 'L', 7, 'power'],
    // Right side - I/O & oscillator
    ['5', 'OSC_IN', 'R', 0, 'input'],
    ['6', 'OSC_OUT', 'R', 1, 'output'],
    ['10', 'PA0', 'R', 2, 'bidirectional'],
    ['11', 'PA1', 'R', 3, 'bidirectional'],
    ['12', 'PA2', 'R', 4, 'bidirectional'],
    ['13', 'PA3', 'R', 5, 'bidirectional'],
    ['30', 'PA9', 'R', 6, 'bidirectional'],
    ['31', 'PA10', 'R', 7, 'bidirectional'],
  ], 28, 90);

  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'STM32F103C8T6', 'LQFP-48',
    120, 120, 0, mcuPins,
  );
  components.push(mcu);

  // === Bypass capacitors (100nF on each VDD) ===
  const vddPins = [
    { name: 'VDD1', cx: 60, cy: 80 },
    { name: 'VDD2', cx: 60, cy: 110 },
    { name: 'VDD3', cx: 60, cy: 140 },
    { name: 'VDDA', cx: 60, cy: 50 },
  ];

  for (const vp of vddPins) {
    const cap = mkComponent(
      nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
      vp.cx, vp.cy, 90,
    );
    components.push(cap);

    // +3V3 label at top of cap
    labels.push(mkLabel('+3V3', vp.cx, vp.cy - 15, 'power'));
    // GND at bottom of cap
    const gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', vp.cx, vp.cy + 20);
    components.push(gnd);
    // Wire from cap pin2 to GND
    wires.push(mkWire([{ x: vp.cx + 15, y: vp.cy }, { x: vp.cx, y: vp.cy + 20 }]));
  }

  // === Bulk capacitor 4.7uF ===
  const bulkCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '4.7uF', 'C_0805',
    30, 80, 90,
  );
  components.push(bulkCap);
  labels.push(mkLabel('+3V3', 30, 65, 'power'));
  const bulkGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 30, 100);
  components.push(bulkGnd);

  // === Crystal oscillator 8MHz ===
  const xtal = mkComponent(
    nextRef(refs, 'Y'), 'crystal', 'crystal', '8MHz', 'Crystal_3225',
    180, 80, 0,
  );
  components.push(xtal);

  // Load capacitors for crystal (2x 20pF)
  const loadCap1 = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '20pF', 'C_0402',
    165, 100, 90,
  );
  components.push(loadCap1);
  const loadCap2 = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '20pF', 'C_0402',
    195, 100, 90,
  );
  components.push(loadCap2);

  // GND for load caps
  const xGnd1 = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 165, 118);
  const xGnd2 = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 195, 118);
  components.push(xGnd1, xGnd2);

  // Wire crystal to MCU OSC_IN / OSC_OUT
  wires.push(mkWire([{ x: 165, y: 80 }, { x: 165, y: 100 }]));
  wires.push(mkWire([{ x: 195, y: 80 }, { x: 195, y: 100 }]));

  // === Reset circuit ===
  // Pull-up resistor on NRST
  const rstPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    60, 30, 0,
  );
  components.push(rstPullUp);
  labels.push(mkLabel('+3V3', 40, 30, 'power'));
  labels.push(mkLabel('NRST', 80, 30, 'local'));

  // Reset capacitor 100nF to GND
  const rstCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    90, 40, 90,
  );
  components.push(rstCap);
  const rstGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 90, 58);
  components.push(rstGnd);
  wires.push(mkWire([{ x: 80, y: 30 }, { x: 90, y: 30 }, { x: 90, y: 40 }]));

  // === BOOT0 pull-down ===
  const boot0R = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    60, 170, 0,
  );
  components.push(boot0R);
  labels.push(mkLabel('BOOT0', 80, 170, 'local'));
  const boot0Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 40, 178);
  components.push(boot0Gnd);
  wires.push(mkWire([{ x: 40, y: 170 }, { x: 40, y: 178 }]));

  // Main power labels for MCU
  labels.push(mkLabel('+3V3', 120, 50, 'power'));
  labels.push(mkLabel('GND', 120, 200, 'power'));

  return { components, wires, labels };
}

// ─── Template: USB-C Power Input ─────────────────────────────────────────────

function generateUSBCPowerInput(params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  const outputVoltage = params.voltage ?? 3.3;

  // USB-C connector (simplified 6-pin)
  const usbcPins: SchPin[] = [
    mkPin('VBUS', '1', -20, -15, 'power'),
    mkPin('CC1', '2', -20, -5, 'bidirectional'),
    mkPin('CC2', '3', -20, 5, 'bidirectional'),
    mkPin('D+', '4', 20, -10, 'bidirectional'),
    mkPin('D-', '5', 20, 0, 'bidirectional'),
    mkPin('GND', '6', -20, 15, 'power'),
    mkPin('SHIELD', '7', 0, 22, 'passive'),
  ];
  const usbc = mkComponent(
    nextRef(refs, 'J'), 'ic', 'ic', 'USB-C', 'USB_C_Receptacle',
    40, 80, 0, usbcPins,
  );
  components.push(usbc);

  // CC1 pull-down resistor 5.1K (for UFP sink)
  const cc1r = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '5.1K', 'R_0402',
    40, 120, 90,
  );
  components.push(cc1r);
  const cc1Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 40, 140);
  components.push(cc1Gnd);
  labels.push(mkLabel('CC1', 40, 100, 'local'));

  // CC2 pull-down resistor 5.1K
  const cc2r = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '5.1K', 'R_0402',
    70, 120, 90,
  );
  components.push(cc2r);
  const cc2Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 70, 140);
  components.push(cc2Gnd);
  labels.push(mkLabel('CC2', 70, 100, 'local'));

  // ESD protection TVS diode on VBUS
  const esd = mkComponent(
    nextRef(refs, 'D'), 'tvs', 'tvs', 'USBLC6-2SC6', 'SOT-23-6',
    100, 60, 0,
  );
  components.push(esd);
  labels.push(mkLabel('VBUS', 85, 60, 'power'));
  const esdGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 115, 60);
  components.push(esdGnd);

  // Input bulk cap 10uF
  const inCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '10uF', 'C_0805',
    120, 100, 90,
  );
  components.push(inCap);
  labels.push(mkLabel('VBUS', 120, 85, 'power'));
  const inCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 120, 118);
  components.push(inCapGnd);

  // LDO regulator (e.g. AMS1117-3.3 or MIC5219)
  const ldoPins: SchPin[] = [
    mkPin('VIN', '1', -20, -5, 'power'),
    mkPin('GND', '2', 0, 18, 'power'),
    mkPin('VOUT', '3', 20, -5, 'output'),
    mkPin('EN', '4', -20, 5, 'input'),
  ];
  const ldoValue = outputVoltage === 3.3 ? 'AMS1117-3.3' : `LDO-${outputVoltage}V`;
  const ldo = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', ldoValue, 'SOT-223',
    170, 80, 0, ldoPins,
  );
  components.push(ldo);

  // Wire VBUS to LDO input
  wires.push(mkWire([{ x: 120, y: 65 }, { x: 150, y: 65 }, { x: 150, y: 75 }]));

  // LDO input cap 1uF
  const ldoInCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '1uF', 'C_0402',
    150, 100, 90,
  );
  components.push(ldoInCap);
  const ldoInGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 150, 118);
  components.push(ldoInGnd);

  // LDO output cap 10uF
  const ldoOutCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '10uF', 'C_0805',
    210, 100, 90,
  );
  components.push(ldoOutCap);
  labels.push(mkLabel(`+${outputVoltage}V`, 210, 85, 'power'));
  const ldoOutGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 210, 118);
  components.push(ldoOutGnd);

  // LDO output bypass 100nF
  const ldoBypass = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    230, 100, 90,
  );
  components.push(ldoBypass);
  const ldoBypassGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 230, 118);
  components.push(ldoBypassGnd);

  // Wire LDO output to output caps
  wires.push(mkWire([{ x: 190, y: 75 }, { x: 230, y: 75 }, { x: 230, y: 100 }]));
  wires.push(mkWire([{ x: 210, y: 75 }, { x: 210, y: 100 }]));

  // LDO GND
  const ldoGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 170, 100);
  components.push(ldoGnd);

  // Output power label
  const outputLabel = outputVoltage === 3.3 ? '+3V3' : `+${outputVoltage}V`;
  labels.push(mkLabel(outputLabel, 240, 75, 'power'));

  // USB GND
  const usbGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 40, 100);
  components.push(usbGnd);
  labels.push(mkLabel('VBUS', 20, 65, 'power'));

  return { components, wires, labels };
}

// ─── Template: ESP32 WiFi Module ─────────────────────────────────────────────

function generateESP32WiFi(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // ESP32-WROOM module (key pins)
  const esp32Pins: SchPin[] = mkICPins([
    // Left side
    ['1', '3V3', 'L', 0, 'power'],
    ['3', 'EN', 'L', 1, 'input'],
    ['4', 'SENSOR_VP', 'L', 2, 'input'],
    ['5', 'SENSOR_VN', 'L', 3, 'input'],
    ['6', 'IO34', 'L', 4, 'bidirectional'],
    ['7', 'IO35', 'L', 5, 'bidirectional'],
    ['8', 'IO32', 'L', 6, 'bidirectional'],
    ['9', 'IO33', 'L', 7, 'bidirectional'],
    // Right side
    ['10', 'IO25', 'R', 0, 'bidirectional'],
    ['11', 'IO26', 'R', 1, 'bidirectional'],
    ['12', 'IO27', 'R', 2, 'bidirectional'],
    ['24', 'IO2', 'R', 3, 'bidirectional'],
    ['25', 'IO0', 'R', 4, 'bidirectional'],
    ['26', 'IO4', 'R', 5, 'bidirectional'],
    ['29', 'TXD0', 'R', 6, 'output'],
    ['34', 'RXD0', 'R', 7, 'input'],
    // Bottom - GND
    ['38', 'GND', 'B', 0, 'power'],
  ], 28, 100);

  const esp32 = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'ESP32-WROOM-32', 'ESP32-WROOM',
    120, 120, 0, esp32Pins,
  );
  components.push(esp32);

  // EN (enable) circuit: 10K pull-up + 100nF to GND + 10K series for delay
  const enPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    60, 60, 0,
  );
  components.push(enPullUp);
  labels.push(mkLabel('+3V3', 40, 60, 'power'));
  labels.push(mkLabel('EN', 80, 60, 'local'));

  const enCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    80, 80, 90,
  );
  components.push(enCap);
  const enGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 80, 98);
  components.push(enGnd);
  wires.push(mkWire([{ x: 80, y: 60 }, { x: 80, y: 80 }]));

  // Strapping pin IO0: pull-up 10K (for normal boot)
  const io0PullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    200, 160, 0,
  );
  components.push(io0PullUp);
  labels.push(mkLabel('+3V3', 220, 160, 'power'));
  labels.push(mkLabel('IO0', 180, 160, 'local'));

  // Strapping pin IO2: pull-down 10K
  const io2PullDown = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    200, 130, 90,
  );
  components.push(io2PullDown);
  const io2Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 200, 150);
  components.push(io2Gnd);
  labels.push(mkLabel('IO2', 200, 110, 'local'));

  // Decoupling caps: 100nF + 10uF on 3V3
  const decap1 = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    50, 100, 90,
  );
  components.push(decap1);
  labels.push(mkLabel('+3V3', 50, 85, 'power'));
  const dec1Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 50, 118);
  components.push(dec1Gnd);

  const decap2 = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '10uF', 'C_0805',
    30, 100, 90,
  );
  components.push(decap2);
  labels.push(mkLabel('+3V3', 30, 85, 'power'));
  const dec2Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 30, 118);
  components.push(dec2Gnd);

  // ESP32 power labels
  labels.push(mkLabel('+3V3', 100, 70, 'power'));
  labels.push(mkLabel('GND', 120, 230, 'power'));

  // UART labels for programming
  labels.push(mkLabel('TXD0', 170, 186, 'global'));
  labels.push(mkLabel('RXD0', 170, 196, 'global'));

  return { components, wires, labels };
}

// ─── Template: I2C Sensor Hub ────────────────────────────────────────────────

function generateI2CSensorHub(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU (generic - 8 pin IC)
  const mcuPins: SchPin[] = [
    mkPin('VDD', '1', -20, -10, 'power'),
    mkPin('SDA', '2', -20, 0, 'bidirectional'),
    mkPin('SCL', '3', -20, 10, 'bidirectional'),
    mkPin('GND', '4', 0, 18, 'power'),
    mkPin('PA0', '5', 20, -10, 'bidirectional'),
    mkPin('PA1', '6', 20, 0, 'bidirectional'),
    mkPin('PA2', '7', 20, 10, 'bidirectional'),
    mkPin('INT', '8', 20, -20, 'input'),
  ];
  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCU', 'LQFP-48',
    60, 80, 0, mcuPins,
  );
  components.push(mcu);
  labels.push(mkLabel('+3V3', 40, 70, 'power'));

  const mcuGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 60, 100);
  components.push(mcuGnd);

  // I2C pull-up resistors (SDA & SCL)
  const sdaPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '4.7K', 'R_0402',
    30, 40, 90,
  );
  components.push(sdaPullUp);
  labels.push(mkLabel('+3V3', 30, 20, 'power'));
  labels.push(mkLabel('SDA', 30, 55, 'global'));

  const sclPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '4.7K', 'R_0402',
    10, 40, 90,
  );
  components.push(sclPullUp);
  labels.push(mkLabel('+3V3', 10, 20, 'power'));
  labels.push(mkLabel('SCL', 10, 55, 'global'));

  // Wire MCU I2C pins to pull-up nets
  wires.push(mkWire([{ x: 40, y: 80 }, { x: 30, y: 80 }, { x: 30, y: 55 }]));
  wires.push(mkWire([{ x: 40, y: 90 }, { x: 10, y: 90 }, { x: 10, y: 55 }]));

  // === BME280 - Temp/Humidity/Pressure sensor ===
  const bme280Pins: SchPin[] = [
    mkPin('VDD', '1', -20, -10, 'power'),
    mkPin('GND', '2', -20, 10, 'power'),
    mkPin('SDI', '3', 20, -5, 'bidirectional'),
    mkPin('SCK', '4', 20, 5, 'input'),
    mkPin('SDO', '5', 0, 18, 'output'),
    mkPin('CSB', '6', -20, 0, 'input'),
  ];
  const bme280 = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'BME280', 'LGA-8',
    160, 50, 0, bme280Pins,
  );
  components.push(bme280);

  // BME280 bypass cap
  const bme280Cap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    130, 30, 0,
  );
  components.push(bme280Cap);
  labels.push(mkLabel('+3V3', 115, 30, 'power'));
  const bme280Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 140, 60);
  components.push(bme280Gnd);
  labels.push(mkLabel('SDA', 180, 45, 'global'));
  labels.push(mkLabel('SCL', 180, 55, 'global'));
  // CSB to VDD (I2C mode)
  labels.push(mkLabel('+3V3', 140, 50, 'power'));
  // SDO to GND (address 0x76)
  const bme280AddrGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 160, 70);
  components.push(bme280AddrGnd);

  // === MPU6050 - Accelerometer/Gyroscope ===
  const mpu6050Pins: SchPin[] = [
    mkPin('VDD', '1', -20, -10, 'power'),
    mkPin('GND', '2', -20, 10, 'power'),
    mkPin('SDA', '3', 20, -5, 'bidirectional'),
    mkPin('SCL', '4', 20, 5, 'input'),
    mkPin('INT', '5', 20, -15, 'output'),
    mkPin('AD0', '6', -20, 0, 'input'),
  ];
  const mpu6050 = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MPU6050', 'QFN-24',
    160, 120, 0, mpu6050Pins,
  );
  components.push(mpu6050);

  // MPU6050 bypass cap
  const mpu6050Cap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    130, 100, 0,
  );
  components.push(mpu6050Cap);
  labels.push(mkLabel('+3V3', 115, 100, 'power'));
  const mpu6050Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 140, 130);
  components.push(mpu6050Gnd);
  labels.push(mkLabel('SDA', 180, 115, 'global'));
  labels.push(mkLabel('SCL', 180, 125, 'global'));
  // AD0 to GND (address 0x68)
  const mpuAddrGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 140, 120);
  components.push(mpuAddrGnd);

  // === BH1750 - Ambient Light Sensor ===
  const bh1750Pins: SchPin[] = [
    mkPin('VCC', '1', -20, -5, 'power'),
    mkPin('GND', '2', -20, 5, 'power'),
    mkPin('SDA', '3', 20, -5, 'bidirectional'),
    mkPin('SCL', '4', 20, 5, 'input'),
    mkPin('ADDR', '5', 0, 18, 'input'),
  ];
  const bh1750 = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'BH1750', 'WSOF-6',
    160, 190, 0, bh1750Pins,
  );
  components.push(bh1750);

  // BH1750 bypass cap
  const bh1750Cap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    130, 170, 0,
  );
  components.push(bh1750Cap);
  labels.push(mkLabel('+3V3', 115, 170, 'power'));
  const bh1750Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 140, 195);
  components.push(bh1750Gnd);
  labels.push(mkLabel('SDA', 180, 185, 'global'));
  labels.push(mkLabel('SCL', 180, 195, 'global'));
  // ADDR to GND (address 0x23)
  const bhAddrGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 160, 210);
  components.push(bhAddrGnd);

  return { components, wires, labels };
}

// ─── Template: CAN Bus Node ──────────────────────────────────────────────────

function generateCANBusNode(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU (generic with CAN pins)
  const mcuPins: SchPin[] = [
    mkPin('VDD', '1', -20, -15, 'power'),
    mkPin('CAN_TX', '2', -20, -5, 'output'),
    mkPin('CAN_RX', '3', -20, 5, 'input'),
    mkPin('GND', '4', 0, 22, 'power'),
    mkPin('PA0', '5', 20, -10, 'bidirectional'),
    mkPin('PA1', '6', 20, 0, 'bidirectional'),
    mkPin('NRST', '7', 20, 10, 'input'),
    mkPin('BOOT0', '8', 20, -20, 'input'),
  ];
  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'STM32F103', 'LQFP-48',
    60, 80, 0, mcuPins,
  );
  components.push(mcu);
  labels.push(mkLabel('+3V3', 40, 65, 'power'));
  const mcuGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 60, 104);
  components.push(mcuGnd);

  // MCU bypass cap
  const mcuCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    30, 60, 90,
  );
  components.push(mcuCap);
  labels.push(mkLabel('+3V3', 30, 45, 'power'));
  const mcuCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 30, 78);
  components.push(mcuCapGnd);

  // CAN Transceiver MCP2551 / TJA1050
  const canPins: SchPin[] = [
    mkPin('TXD', '1', -20, -10, 'input'),
    mkPin('VSS', '2', 0, 22, 'power'),
    mkPin('VDD', '3', 0, -22, 'power'),
    mkPin('RXD', '4', -20, 0, 'output'),
    mkPin('VREF', '5', -20, 10, 'output'),
    mkPin('CANL', '6', 20, 5, 'bidirectional'),
    mkPin('CANH', '7', 20, -5, 'bidirectional'),
    mkPin('RS', '8', 20, 15, 'input'),
  ];
  const canXcvr = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCP2551', 'SOIC-8',
    160, 80, 0, canPins,
  );
  components.push(canXcvr);
  labels.push(mkLabel('+5V', 160, 58, 'power'));
  const canGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 160, 104);
  components.push(canGnd);

  // CAN transceiver bypass cap
  const canCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    130, 60, 90,
  );
  components.push(canCap);
  labels.push(mkLabel('+5V', 130, 45, 'power'));
  const canCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 130, 78);
  components.push(canCapGnd);

  // Wire MCU CAN_TX -> transceiver TXD
  wires.push(mkWire([{ x: 40, y: 75 }, { x: 20, y: 75 }, { x: 20, y: 50 }, { x: 130, y: 50 }, { x: 130, y: 70 }, { x: 140, y: 70 }]));
  labels.push(mkLabel('CAN_TX', 20, 50, 'local'));

  // Wire MCU CAN_RX -> transceiver RXD
  wires.push(mkWire([{ x: 40, y: 85 }, { x: 15, y: 85 }, { x: 15, y: 110 }, { x: 130, y: 110 }, { x: 130, y: 80 }, { x: 140, y: 80 }]));
  labels.push(mkLabel('CAN_RX', 15, 110, 'local'));

  // RS pin to GND (high-speed mode)
  const rsGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 185, 98);
  components.push(rsGnd);
  wires.push(mkWire([{ x: 180, y: 95 }, { x: 185, y: 95 }, { x: 185, y: 98 }]));

  // Termination resistor 120 ohm
  const termR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '120', 'R_0805',
    220, 80, 90,
  );
  components.push(termR);
  labels.push(mkLabel('CANH', 220, 60, 'global'));
  labels.push(mkLabel('CANL', 220, 100, 'global'));

  // CAN bus connector
  const canConn = mkComponent(
    nextRef(refs, 'J'), 'connector_2', 'connector_2', 'CAN_BUS', 'TerminalBlock_2P',
    260, 80, 0,
  );
  components.push(canConn);
  labels.push(mkLabel('CANH', 248, 75, 'global'));
  labels.push(mkLabel('CANL', 248, 85, 'global'));

  // CANH / CANL labels from transceiver
  wires.push(mkWire([{ x: 180, y: 75 }, { x: 220, y: 75 }]));
  wires.push(mkWire([{ x: 180, y: 85 }, { x: 220, y: 85 }]));

  // ESD protection common mode choke (optional TVS)
  const tvsCan = mkComponent(
    nextRef(refs, 'D'), 'tvs', 'tvs', 'PESD2CAN', 'SOT-23',
    240, 110, 0,
  );
  components.push(tvsCan);
  const tvsGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 255, 110);
  components.push(tvsGnd);

  return { components, wires, labels };
}

// ─── Template: RS485 Interface ───────────────────────────────────────────────

function generateRS485Interface(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU
  const mcuPins: SchPin[] = [
    mkPin('VDD', '1', -20, -15, 'power'),
    mkPin('TX', '2', -20, -5, 'output'),
    mkPin('RX', '3', -20, 5, 'input'),
    mkPin('DE/RE', '4', -20, 15, 'output'),
    mkPin('GND', '5', 0, 26, 'power'),
    mkPin('PA0', '6', 20, -5, 'bidirectional'),
    mkPin('PA1', '7', 20, 5, 'bidirectional'),
  ];
  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCU', 'LQFP-48',
    60, 80, 0, mcuPins,
  );
  components.push(mcu);
  labels.push(mkLabel('+3V3', 40, 65, 'power'));
  const mcuGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 60, 108);
  components.push(mcuGnd);

  // RS485 transceiver MAX485 / SP485EE
  const rs485Pins: SchPin[] = [
    mkPin('RO', '1', -20, -15, 'output'),
    mkPin('RE', '2', -20, -5, 'input'),
    mkPin('DE', '3', -20, 5, 'input'),
    mkPin('DI', '4', -20, 15, 'input'),
    mkPin('GND', '5', 0, 26, 'power'),
    mkPin('A', '6', 20, -5, 'bidirectional'),
    mkPin('B', '7', 20, 5, 'bidirectional'),
    mkPin('VCC', '8', 0, -26, 'power'),
  ];
  const rs485 = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MAX485', 'SOIC-8',
    160, 80, 0, rs485Pins,
  );
  components.push(rs485);
  labels.push(mkLabel('+3V3', 160, 54, 'power'));
  const rs485Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 160, 108);
  components.push(rs485Gnd);

  // Bypass cap
  const rs485Cap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    130, 55, 0,
  );
  components.push(rs485Cap);
  labels.push(mkLabel('+3V3', 115, 55, 'power'));
  const capGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 145, 60);
  components.push(capGnd);

  // Wire MCU -> RS485 transceiver
  labels.push(mkLabel('RS485_TX', 40, 75, 'local'));
  labels.push(mkLabel('RS485_RX', 40, 85, 'local'));
  labels.push(mkLabel('RS485_DE', 40, 95, 'local'));
  labels.push(mkLabel('RS485_TX', 140, 95, 'local'));
  labels.push(mkLabel('RS485_RX', 140, 65, 'local'));
  labels.push(mkLabel('RS485_DE', 140, 75, 'local'));

  // Wire RE and DE together (half-duplex control)
  wires.push(mkWire([{ x: 140, y: 75 }, { x: 135, y: 75 }, { x: 135, y: 85 }, { x: 140, y: 85 }]));

  // Bias resistors: A pull-up 560 ohm, B pull-down 560 ohm
  const biasA = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '560', 'R_0402',
    210, 55, 90,
  );
  components.push(biasA);
  labels.push(mkLabel('+3V3', 210, 35, 'power'));

  const biasB = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '560', 'R_0402',
    230, 105, 90,
  );
  components.push(biasB);
  const biasBGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 230, 125);
  components.push(biasBGnd);

  // Termination resistor 120 ohm
  const termR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '120', 'R_0805',
    250, 80, 90,
  );
  components.push(termR);
  labels.push(mkLabel('RS485_A', 250, 60, 'global'));
  labels.push(mkLabel('RS485_B', 250, 100, 'global'));

  // Wire transceiver outputs A & B
  wires.push(mkWire([{ x: 180, y: 75 }, { x: 210, y: 75 }]));
  wires.push(mkWire([{ x: 180, y: 85 }, { x: 230, y: 85 }]));
  wires.push(mkWire([{ x: 210, y: 75 }, { x: 250, y: 75 }]));
  wires.push(mkWire([{ x: 230, y: 85 }, { x: 250, y: 85 }]));

  // Connector
  const conn = mkComponent(
    nextRef(refs, 'J'), 'connector_2', 'connector_2', 'RS485', 'TerminalBlock_2P',
    280, 80, 0,
  );
  components.push(conn);
  labels.push(mkLabel('RS485_A', 268, 75, 'global'));
  labels.push(mkLabel('RS485_B', 268, 85, 'global'));

  return { components, wires, labels };
}

// ─── Template: LED Driver (WS2812) ──────────────────────────────────────────

function generateWS2812Driver(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU
  const mcuPins: SchPin[] = [
    mkPin('VDD', '1', -20, -10, 'power'),
    mkPin('DATA_OUT', '2', -20, 0, 'output'),
    mkPin('GND', '3', 0, 18, 'power'),
    mkPin('PA1', '4', 20, -10, 'bidirectional'),
    mkPin('PA2', '5', 20, 0, 'bidirectional'),
    mkPin('PA3', '6', 20, 10, 'bidirectional'),
  ];
  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCU', 'LQFP-48',
    40, 80, 0, mcuPins,
  );
  components.push(mcu);
  labels.push(mkLabel('+3V3', 20, 70, 'power'));
  const mcuGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 40, 100);
  components.push(mcuGnd);

  // Level shifter (3.3V -> 5V for WS2812)
  // Using SN74HCT125 or simple MOSFET level shifter
  const lsPins: SchPin[] = [
    mkPin('VCC', '1', 0, -18, 'power'),
    mkPin('GND', '2', 0, 18, 'power'),
    mkPin('A', '3', -20, 0, 'input'),
    mkPin('Y', '4', 20, 0, 'output'),
    mkPin('OE', '5', -20, 10, 'input'),
  ];
  const levelShift = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'SN74HCT125', 'SOIC-14',
    110, 80, 0, lsPins,
  );
  components.push(levelShift);
  labels.push(mkLabel('+5V', 110, 62, 'power'));
  const lsGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 110, 100);
  components.push(lsGnd);
  // OE to GND (always enabled)
  const oeGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 90, 92);
  components.push(oeGnd);
  wires.push(mkWire([{ x: 90, y: 90 }, { x: 90, y: 92 }]));

  // Wire MCU data -> level shifter input
  wires.push(mkWire([{ x: 20, y: 80 }, { x: 10, y: 80 }, { x: 10, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 80 }, { x: 90, y: 80 }]));
  labels.push(mkLabel('LED_DATA', 10, 60, 'local'));

  // Series resistor 330 ohm on data line
  const dataR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '330', 'R_0402',
    155, 80, 0,
  );
  components.push(dataR);
  wires.push(mkWire([{ x: 130, y: 80 }, { x: 135, y: 80 }]));

  // WS2812B chain (3 LEDs shown)
  for (let i = 0; i < 3; i++) {
    const wsX = 200 + i * 40;
    const wsPins: SchPin[] = [
      mkPin('VDD', '1', 0, -18, 'power'),
      mkPin('DOUT', '2', 20, 0, 'output'),
      mkPin('VSS', '3', 0, 18, 'power'),
      mkPin('DIN', '4', -20, 0, 'input'),
    ];
    const ws = mkComponent(
      nextRef(refs, 'D'), 'ic', 'ic', 'WS2812B', 'LED_WS2812B',
      wsX, 80, 0, wsPins,
    );
    components.push(ws);
    labels.push(mkLabel('+5V', wsX, 62, 'power'));
    const wsGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', wsX, 100);
    components.push(wsGnd);

    // Bypass cap for each LED
    const wsCap = mkComponent(
      nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
      wsX + 12, 55, 0,
    );
    components.push(wsCap);
    labels.push(mkLabel('+5V', wsX - 3, 55, 'power'));
    const wsCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', wsX + 27, 55);
    components.push(wsCapGnd);

    // Chain data: DOUT of previous -> DIN of current
    if (i === 0) {
      wires.push(mkWire([{ x: 175, y: 80 }, { x: 180, y: 80 }]));
    } else {
      wires.push(mkWire([{ x: 200 + (i - 1) * 40 + 20, y: 80 }, { x: wsX - 20, y: 80 }]));
    }
  }

  // Bulk capacitor 1000uF on 5V rail
  const bulkCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '1000uF', 'Cap_Elec_8x10',
    320, 80, 90,
  );
  components.push(bulkCap);
  labels.push(mkLabel('+5V', 320, 65, 'power'));
  const bulkGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 320, 98);
  components.push(bulkGnd);

  return { components, wires, labels };
}

// ─── Template: Buck Power Supply (TPS54331) ──────────────────────────────────

function generateBuckSupply(params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  const vOut = params.voltage ?? 3.3;

  // Input connector
  const connPins: SchPin[] = [
    mkPin('VIN', '1', -12, -5, 'passive'),
    mkPin('GND', '2', -12, 5, 'passive'),
  ];
  const inputConn = mkComponent(
    nextRef(refs, 'J'), 'connector', 'connector_2', 'VIN', 'TerminalBlock_2P',
    30, 80, 0, connPins,
  );
  components.push(inputConn);
  labels.push(mkLabel('VIN', 18, 75, 'power'));
  const connGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 18, 90);
  components.push(connGnd);

  // Input capacitors: 10uF x2 ceramic
  const inCap1 = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '10uF/50V', 'C_1206',
    60, 100, 90,
  );
  components.push(inCap1);
  labels.push(mkLabel('VIN', 60, 85, 'power'));
  const inCap1Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 60, 118);
  components.push(inCap1Gnd);

  const inCap2 = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '10uF/50V', 'C_1206',
    80, 100, 90,
  );
  components.push(inCap2);
  labels.push(mkLabel('VIN', 80, 85, 'power'));
  const inCap2Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 80, 118);
  components.push(inCap2Gnd);

  // TPS54331 buck converter
  const buckPins: SchPin[] = [
    mkPin('BOOT', '1', -20, -20, 'passive'),
    mkPin('VIN', '2', -20, -10, 'power'),
    mkPin('EN', '3', -20, 0, 'input'),
    mkPin('SS/TR', '4', -20, 10, 'input'),
    mkPin('VSENSE', '5', -20, 20, 'input'),
    mkPin('COMP', '6', 20, 20, 'output'),
    mkPin('GND', '7', 0, 30, 'power'),
    mkPin('PH', '8', 20, -10, 'output'),
  ];
  const buck = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'TPS54331', 'SOIC-8',
    140, 80, 0, buckPins,
  );
  components.push(buck);
  const buckGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 140, 112);
  components.push(buckGnd);

  // EN to VIN (always enabled)
  labels.push(mkLabel('VIN', 120, 80, 'power'));
  labels.push(mkLabel('VIN', 120, 70, 'power'));

  // Bootstrap cap 100nF
  const bootCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    110, 45, 0,
  );
  components.push(bootCap);
  labels.push(mkLabel('BOOT', 95, 45, 'local'));
  labels.push(mkLabel('PH', 125, 45, 'local'));

  // Soft start cap 10nF
  const ssCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '10nF', 'C_0402',
    110, 105, 90,
  );
  components.push(ssCap);
  const ssGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 110, 123);
  components.push(ssGnd);
  wires.push(mkWire([{ x: 120, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 105 }]));

  // Inductor 15uH
  const inductor = mkComponent(
    nextRef(refs, 'L'), 'inductor', 'inductor', '15uH', 'L_1210',
    200, 70, 0,
  );
  components.push(inductor);
  wires.push(mkWire([{ x: 160, y: 70 }, { x: 180, y: 70 }]));
  labels.push(mkLabel('PH', 170, 70, 'local'));

  // Output cap 47uF
  const outCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor_polarized', 'capacitor_polarized', '47uF', 'C_1210',
    240, 95, 90,
  );
  components.push(outCap);
  const outCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 240, 113);
  components.push(outCapGnd);

  // Output ceramic cap 22uF
  const outCap2 = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '22uF', 'C_1206',
    260, 95, 90,
  );
  components.push(outCap2);
  const outCap2Gnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 260, 113);
  components.push(outCap2Gnd);

  // Wire inductor output to output caps
  wires.push(mkWire([{ x: 220, y: 70 }, { x: 260, y: 70 }, { x: 260, y: 95 }]));
  wires.push(mkWire([{ x: 240, y: 70 }, { x: 240, y: 95 }]));

  // Feedback resistor divider
  // R_top from VOUT to VSENSE, R_bottom from VSENSE to GND
  // For TPS54331: VREF = 0.8V, VOUT = VREF * (1 + R_top / R_bottom)
  // For 3.3V: R_top = 31.6K, R_bottom = 10K
  // For 5V: R_top = 52.3K, R_bottom = 10K
  const rBottom = 10; // K
  const rTop = (vOut / 0.8 - 1) * rBottom;
  const rTopStr = rTop >= 10 ? `${Math.round(rTop)}K` : `${(rTop * 1000).toFixed(0)}`;

  const fbRTop = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', `${Math.round(rTop * 10) / 10}K`, 'R_0402',
    220, 110, 90,
  );
  components.push(fbRTop);

  const fbRBot = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    220, 140, 90,
  );
  components.push(fbRBot);
  const fbGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 220, 160);
  components.push(fbGnd);

  // Wire feedback divider
  wires.push(mkWire([{ x: 240, y: 70 }, { x: 240, y: 85 }, { x: 220, y: 85 }, { x: 220, y: 110 }]));
  wires.push(mkWire([{ x: 220, y: 125 }, { x: 220, y: 130 }]));
  labels.push(mkLabel('VSENSE', 210, 125, 'local'));

  // Wire VSENSE to buck converter
  wires.push(mkWire([{ x: 220, y: 125 }, { x: 200, y: 125 }, { x: 200, y: 100 }, { x: 120, y: 100 }]));

  // Comp network
  const compR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '16.9K', 'R_0402',
    175, 115, 90,
  );
  components.push(compR);
  const compC = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '2.2nF', 'C_0402',
    175, 145, 90,
  );
  components.push(compC);
  const compGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 175, 163);
  components.push(compGnd);
  wires.push(mkWire([{ x: 160, y: 100 }, { x: 175, y: 100 }, { x: 175, y: 115 }]));
  wires.push(mkWire([{ x: 175, y: 130 }, { x: 175, y: 145 }]));

  // Output power label
  const outLabel = vOut === 3.3 ? '+3V3' : vOut === 5 ? '+5V' : `+${vOut}V`;
  labels.push(mkLabel(outLabel, 270, 70, 'power'));

  // Schottky diode (catch diode)
  const schottky = mkComponent(
    nextRef(refs, 'D'), 'schottky', 'schottky', 'SS34', 'SMA',
    185, 95, 90,
  );
  components.push(schottky);
  labels.push(mkLabel('PH', 185, 80, 'local'));
  const schGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 185, 112);
  components.push(schGnd);

  return { components, wires, labels };
}

// ─── Template: Battery Charger (MCP73831) ────────────────────────────────────

function generateBatteryCharger(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // USB-C connector (simplified)
  const usbPins: SchPin[] = [
    mkPin('VBUS', '1', -12, -5, 'power'),
    mkPin('GND', '2', -12, 5, 'power'),
  ];
  const usbc = mkComponent(
    nextRef(refs, 'J'), 'connector', 'connector_2', 'USB-C', 'USB_C_Receptacle',
    30, 60, 0, usbPins,
  );
  components.push(usbc);
  labels.push(mkLabel('VUSB', 18, 55, 'power'));
  const usbGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 18, 70);
  components.push(usbGnd);

  // Input protection schottky
  const inDiode = mkComponent(
    nextRef(refs, 'D'), 'schottky', 'schottky', 'BAT54', 'SOD-323',
    60, 55, 0,
  );
  components.push(inDiode);
  wires.push(mkWire([{ x: 18, y: 55 }, { x: 45, y: 55 }]));

  // MCP73831 charger IC
  const chgPins: SchPin[] = [
    mkPin('VDD', '1', -20, -10, 'power'),
    mkPin('STAT', '2', -20, 0, 'output'),
    mkPin('VSS', '3', 0, 22, 'power'),
    mkPin('PROG', '4', 20, 10, 'input'),
    mkPin('VBAT', '5', 20, -10, 'output'),
  ];
  const charger = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCP73831', 'SOT-23-5',
    120, 60, 0, chgPins,
  );
  components.push(charger);
  const chgGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 120, 84);
  components.push(chgGnd);

  // Wire diode output to charger VDD
  wires.push(mkWire([{ x: 75, y: 55 }, { x: 100, y: 55 }, { x: 100, y: 50 }]));

  // Input cap 4.7uF
  const inCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '4.7uF', 'C_0805',
    90, 80, 90,
  );
  components.push(inCap);
  const inCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 90, 98);
  components.push(inCapGnd);
  wires.push(mkWire([{ x: 90, y: 55 }, { x: 90, y: 80 }]));

  // PROG resistor (sets charge current: I = 1000V / R_PROG)
  // 2K = 500mA, 10K = 100mA
  const progR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '2K', 'R_0402',
    155, 85, 90,
  );
  components.push(progR);
  const progGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 155, 103);
  components.push(progGnd);
  wires.push(mkWire([{ x: 140, y: 70 }, { x: 155, y: 70 }, { x: 155, y: 85 }]));

  // STAT LED (charge indicator)
  const statLed = mkComponent(
    nextRef(refs, 'D'), 'led', 'led', 'LED_Red', 'LED_0805',
    80, 40, 0,
  );
  components.push(statLed);
  const statR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '1K', 'R_0402',
    80, 25, 0,
  );
  components.push(statR);
  labels.push(mkLabel('VUSB', 60, 25, 'power'));
  wires.push(mkWire([{ x: 95, y: 25 }, { x: 100, y: 25 }, { x: 100, y: 40 }, { x: 95, y: 40 }]));
  wires.push(mkWire([{ x: 65, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 100, y: 60 }]));
  labels.push(mkLabel('STAT', 60, 48, 'local'));

  // Battery connector
  const batPins: SchPin[] = [
    mkPin('+', '1', -12, -5, 'passive'),
    mkPin('-', '2', -12, 5, 'passive'),
  ];
  const batConn = mkComponent(
    nextRef(refs, 'J'), 'connector', 'connector_2', 'BATTERY', 'JST_PH_2P',
    170, 50, 0, batPins,
  );
  components.push(batConn);
  wires.push(mkWire([{ x: 140, y: 50 }, { x: 158, y: 50 }, { x: 158, y: 45 }]));
  labels.push(mkLabel('VBAT', 155, 40, 'power'));
  const batGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 158, 60);
  components.push(batGnd);

  // Battery output cap 4.7uF
  const batCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '4.7uF', 'C_0805',
    190, 60, 90,
  );
  components.push(batCap);
  labels.push(mkLabel('VBAT', 190, 45, 'power'));
  const batCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 190, 78);
  components.push(batCapGnd);

  // LDO output stage (3.3V from battery)
  const ldoPins: SchPin[] = [
    mkPin('VIN', '1', -20, -5, 'power'),
    mkPin('GND', '2', 0, 18, 'power'),
    mkPin('VOUT', '3', 20, -5, 'output'),
    mkPin('EN', '4', -20, 5, 'input'),
  ];
  const ldo = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MIC5219-3.3', 'SOT-23-5',
    240, 50, 0, ldoPins,
  );
  components.push(ldo);
  labels.push(mkLabel('VBAT', 220, 45, 'power'));
  labels.push(mkLabel('VBAT', 220, 55, 'power'));
  const ldoGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 240, 70);
  components.push(ldoGnd);

  // LDO output caps
  const ldoOutCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '10uF', 'C_0805',
    280, 65, 90,
  );
  components.push(ldoOutCap);
  labels.push(mkLabel('+3V3', 280, 50, 'power'));
  const ldoOutGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 280, 83);
  components.push(ldoOutGnd);

  wires.push(mkWire([{ x: 260, y: 45 }, { x: 280, y: 45 }, { x: 280, y: 65 }]));
  labels.push(mkLabel('+3V3', 290, 45, 'power'));

  return { components, wires, labels };
}

// ─── Template: SPI Flash ─────────────────────────────────────────────────────

function generateSPIFlash(_params: TemplateParams): TemplateResult {
  const refs: RefCounters = {};
  const components: SchComponent[] = [];
  const wires: SchWire[] = [];
  const labels: SchLabel[] = [];

  // MCU (generic with SPI pins)
  const mcuPins: SchPin[] = [
    mkPin('VDD', '1', -20, -15, 'power'),
    mkPin('SPI_SCK', '2', -20, -5, 'output'),
    mkPin('SPI_MOSI', '3', -20, 5, 'output'),
    mkPin('SPI_MISO', '4', -20, 15, 'input'),
    mkPin('SPI_CS', '5', 20, -15, 'output'),
    mkPin('GND', '6', 0, 26, 'power'),
    mkPin('PA0', '7', 20, -5, 'bidirectional'),
    mkPin('PA1', '8', 20, 5, 'bidirectional'),
  ];
  const mcu = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'MCU', 'LQFP-48',
    60, 80, 0, mcuPins,
  );
  components.push(mcu);
  labels.push(mkLabel('+3V3', 40, 65, 'power'));
  const mcuGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 60, 108);
  components.push(mcuGnd);

  // MCU bypass cap
  const mcuCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    30, 60, 90,
  );
  components.push(mcuCap);
  labels.push(mkLabel('+3V3', 30, 45, 'power'));
  const mcuCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 30, 78);
  components.push(mcuCapGnd);

  // W25Q128 SPI Flash
  const flashPins: SchPin[] = [
    mkPin('/CS', '1', -20, -15, 'input'),
    mkPin('DO', '2', -20, -5, 'output'),
    mkPin('/WP', '3', -20, 5, 'input'),
    mkPin('GND', '4', 0, 26, 'power'),
    mkPin('DI', '5', 20, 15, 'input'),
    mkPin('CLK', '6', 20, 5, 'input'),
    mkPin('/HOLD', '7', 20, -5, 'input'),
    mkPin('VCC', '8', 0, -26, 'power'),
  ];
  const flash = mkComponent(
    nextRef(refs, 'U'), 'ic', 'ic', 'W25Q128JVSIQ', 'SOIC-8',
    180, 80, 0, flashPins,
  );
  components.push(flash);
  labels.push(mkLabel('+3V3', 180, 54, 'power'));
  const flashGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 180, 108);
  components.push(flashGnd);

  // Flash bypass cap 100nF
  const flashCap = mkComponent(
    nextRef(refs, 'C'), 'capacitor', 'capacitor', '100nF', 'C_0402',
    210, 55, 90,
  );
  components.push(flashCap);
  labels.push(mkLabel('+3V3', 210, 40, 'power'));
  const flashCapGnd = mkPower(nextRef(refs, '#PWR'), 'gnd', 'GND', 210, 73);
  components.push(flashCapGnd);

  // SPI signal labels (connecting MCU to Flash)
  labels.push(mkLabel('SPI_SCK', 40, 75, 'global'));
  labels.push(mkLabel('SPI_MOSI', 40, 85, 'global'));
  labels.push(mkLabel('SPI_MISO', 40, 95, 'global'));
  labels.push(mkLabel('SPI_CS', 80, 65, 'global'));

  labels.push(mkLabel('SPI_SCK', 200, 85, 'global'));
  labels.push(mkLabel('SPI_MOSI', 200, 95, 'global'));
  labels.push(mkLabel('SPI_MISO', 160, 75, 'global'));
  labels.push(mkLabel('SPI_CS', 160, 65, 'global'));

  // Pull-up on /WP (write protect disabled)
  const wpPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    150, 100, 90,
  );
  components.push(wpPullUp);
  labels.push(mkLabel('+3V3', 150, 85, 'power'));
  wires.push(mkWire([{ x: 150, y: 115 }, { x: 150, y: 85 }, { x: 160, y: 85 }]));

  // Pull-up on /HOLD (hold disabled)
  const holdPullUp = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '10K', 'R_0402',
    210, 80, 0,
  );
  components.push(holdPullUp);
  labels.push(mkLabel('+3V3', 230, 80, 'power'));
  wires.push(mkWire([{ x: 200, y: 75 }, { x: 210, y: 75 }, { x: 210, y: 80 }]));

  // Series resistors on SPI lines (optional EMI protection)
  const sckR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '33', 'R_0402',
    120, 75, 0,
  );
  components.push(sckR);

  const mosiR = mkComponent(
    nextRef(refs, 'R'), 'resistor', 'resistor', '33', 'R_0402',
    120, 85, 0,
  );
  components.push(mosiR);

  return { components, wires, labels };
}

// ─── Template Registry ───────────────────────────────────────────────────────

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'stm32-minimal',
    name: 'STM32 Minimal',
    description: 'STM32F103 + bypass caps + crystal + reset circuit + BOOT0 pull-down',
    category: 'MCU',
    tags: ['stm32', 'mcu', 'arm', 'cortex-m3'],
    icon: '\u2339',
    generate: generateSTM32Minimal,
  },
  {
    id: 'usbc-power',
    name: 'USB-C Power Input',
    description: 'USB-C connector + CC resistors + ESD + LDO + bulk caps',
    category: 'Power',
    tags: ['usb-c', 'power', 'ldo', 'esd'],
    icon: '\u26A1',
    params: {
      voltage: { min: 1.8, max: 5, default: 3.3 },
    },
    generate: generateUSBCPowerInput,
  },
  {
    id: 'esp32-wifi',
    name: 'ESP32 WiFi Module',
    description: 'ESP32-WROOM + EN circuit + strapping pins + decoupling',
    category: 'MCU',
    tags: ['esp32', 'wifi', 'iot', 'wireless'],
    icon: '\u2637',
    generate: generateESP32WiFi,
  },
  {
    id: 'i2c-sensor-hub',
    name: 'I2C Sensor Hub',
    description: 'MCU + BME280 + MPU6050 + BH1750 + I2C pull-ups',
    category: 'Sensors',
    tags: ['i2c', 'sensor', 'bme280', 'mpu6050', 'bh1750'],
    icon: '\u2609',
    generate: generateI2CSensorHub,
  },
  {
    id: 'can-bus-node',
    name: 'CAN Bus Node',
    description: 'MCU + CAN transceiver (MCP2551) + termination + ESD protection',
    category: 'Communication',
    tags: ['can', 'bus', 'automotive', 'transceiver'],
    icon: '\u21C4',
    generate: generateCANBusNode,
  },
  {
    id: 'rs485-interface',
    name: 'RS485 Interface',
    description: 'MCU + MAX485 transceiver + bias resistors + termination',
    category: 'Communication',
    tags: ['rs485', 'serial', 'modbus', 'industrial'],
    icon: '\u21C6',
    generate: generateRS485Interface,
  },
  {
    id: 'ws2812-led-driver',
    name: 'LED Driver (WS2812)',
    description: 'MCU + level shifter + WS2812B chain + bulk caps',
    category: 'LED',
    tags: ['ws2812', 'neopixel', 'led', 'rgb', 'addressable'],
    icon: '\u2600',
    generate: generateWS2812Driver,
  },
  {
    id: 'buck-supply',
    name: 'Buck Power Supply',
    description: 'TPS54331 buck converter + inductor + caps + feedback divider',
    category: 'Power',
    tags: ['buck', 'smps', 'power', 'tps54331', 'dc-dc'],
    icon: '\u2301',
    params: {
      voltage: { min: 1.2, max: 12, default: 3.3 },
    },
    generate: generateBuckSupply,
  },
  {
    id: 'battery-charger',
    name: 'Battery Charger',
    description: 'USB-C + MCP73831 charger + LiPo battery + LDO output',
    category: 'Power',
    tags: ['battery', 'charger', 'lipo', 'mcp73831', 'usb'],
    icon: '\u{1F50B}',
    generate: generateBatteryCharger,
  },
  {
    id: 'spi-flash',
    name: 'SPI Flash',
    description: 'MCU + W25Q128 flash + bypass caps + pull-ups + series resistors',
    category: 'Memory',
    tags: ['spi', 'flash', 'w25q128', 'memory', 'storage'],
    icon: '\u{1F4BE}',
    generate: generateSPIFlash,
  },
];

/** Get all unique categories */
export function getTemplateCategories(): string[] {
  const cats = new Set(DESIGN_TEMPLATES.map(t => t.category));
  return ['All', ...Array.from(cats).sort()];
}

/** Search templates by query */
export function searchTemplates(query: string, category?: string): DesignTemplate[] {
  let results = DESIGN_TEMPLATES;
  if (category && category !== 'All') {
    results = results.filter(t => t.category === category);
  }
  if (query.trim()) {
    const q = query.toLowerCase();
    results = results.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.includes(q))
    );
  }
  return results;
}
