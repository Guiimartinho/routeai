// ─── Component Rules Engine ──────────────────────────────────────────────────
//
// 3-level system that covers virtually ALL electronic components:
//
//   Level 1: GENERIC RULES BY TYPE (~30 rules → covers 99% of all ICs)
//            "any MCU" → bypass caps + bulk cap + crystal
//            "any LDO" → input cap + output cap
//
//   Level 2: FAMILY EXCEPTIONS (in datasheetKnowledge.ts, ~16 families)
//            "STM32H7" → needs SMPS inductor (unlike most MCUs)
//            "AMS1117" → output cap needs high ESR (tantalum)
//
//   Level 3: LLM REFINEMENT (optional, when Ollama available)
//            Ask LLM to refine values based on specific MPN datasheet
//
// This file implements Level 1 — the generic rules.

import type { SupportComponent, ICKnowledge } from './datasheetKnowledge';
import { findICKnowledge } from './datasheetKnowledge';

// ─── Types ──────────────────────────────────────────────────────────────────

/** How we detect what TYPE a component is */
interface TypeDetector {
  /** Component type name */
  type: string;
  /** Match against component value/symbol/footprint */
  matchValue?: RegExp[];
  matchSymbol?: RegExp[];
  matchFootprint?: RegExp[];
  matchRef?: RegExp[];
}

/** Generic rules that apply to ALL components of a given type */
interface GenericRule {
  type: string;
  description: string;
  supportComponents: SupportComponent[];
  designNotes: string[];
}

// ─── Type Detection ─────────────────────────────────────────────────────────
// Determines what TYPE a component is from its value, symbol, reference, footprint

export const TYPE_DETECTORS: TypeDetector[] = [
  // --- MCU ---
  {
    type: 'mcu',
    matchValue: [
      /STM32/i, /ESP32/i, /RP2040/i, /ATMEGA/i, /ATTINY/i, /PIC\d/i,
      /SAMD\d/i, /SAME\d/i, /nRF5\d/i, /CC26\d/i, /MSP430/i,
      /EFM32/i, /EFR32/i, /LPC\d/i, /MK\d/i, /iMXRT/i, /GD32/i,
      /CH32/i, /WCH/i, /BL\d{3}/i, /ASR\d/i, /RTL\d/i, /W806/i,
      /CY8C/i, /PSoC/i, /XMC\d/i, /R7FA/i, /RA\dM/i,
    ],
    matchRef: [/^U\d/],
  },
  // --- FPGA / CPLD ---
  {
    type: 'fpga',
    matchValue: [
      /XC\d/i, /EP\d/i, /ICE40/i, /ECP5/i, /GW\d/i, /LCMXO/i,
      /Artix/i, /Spartan/i, /Zynq/i, /Cyclone/i, /MAX\d{4}/i,
    ],
  },
  // --- Linear Regulator (LDO) ---
  {
    type: 'ldo',
    matchValue: [
      /AMS1117/i, /AP2112/i, /MCP1700/i, /RT9013/i, /XC6206/i,
      /TLV1117/i, /NCV8164/i, /SPX3819/i, /ME6211/i, /HT7\d{3}/i,
      /LP2985/i, /LP5907/i, /TPS7A\d/i, /ADP\d{4}/i, /NCP\d{4}/i,
      /TC1262/i, /MIC5205/i, /AP7\d{3}/i, /SGM2019/i,
    ],
    matchSymbol: [/regulator/i, /ldo/i],
  },
  // --- Buck Converter ---
  {
    type: 'buck',
    matchValue: [
      /TPS5\d{4}/i, /TPS6\d{4}/i, /MP\d{4}/i, /RT\d{4}/i,
      /SY8\d{3}/i, /AOZ\d{4}/i, /LM2596/i, /LM2576/i, /LMR\d{5}/i,
      /AP\d{4}[A-Z]/i, /XL\d{4}/i, /MT36\d{2}/i, /SX13\d{2}/i,
    ],
    matchSymbol: [/buck/i, /step.?down/i],
  },
  // --- Boost Converter ---
  {
    type: 'boost',
    matchValue: [
      /TPS61\d{3}/i, /MT3608/i, /SX1308/i, /XL6009/i,
      /LT1073/i, /MAX1674/i, /TLV61\d{2}/i,
    ],
    matchSymbol: [/boost/i, /step.?up/i],
  },
  // --- Op-Amp ---
  {
    type: 'opamp',
    matchValue: [
      /LM358/i, /LMV321/i, /MCP600/i, /OPA\d/i, /AD860/i,
      /TLV9/i, /TSV9/i, /LM324/i, /NE5532/i, /TL07/i,
      /AD862/i, /OPA365/i, /LT1013/i, /MAX44/i,
    ],
    matchSymbol: [/opamp/i, /op.?amp/i, /amplifier/i],
  },
  // --- Comparator ---
  {
    type: 'comparator',
    matchValue: [/LM393/i, /LM339/i, /LM311/i, /TLV3\d{3}/i, /MAX9\d{2}/i],
    matchSymbol: [/comparator/i],
  },
  // --- USB-UART Bridge ---
  {
    type: 'usb_uart',
    matchValue: [
      /CH340/i, /CH341/i, /CP210/i, /FT232/i, /FT2232/i, /FT4232/i,
      /PL2303/i, /MCP2200/i,
    ],
  },
  // --- CAN Transceiver ---
  {
    type: 'can_transceiver',
    matchValue: [
      /MCP2551/i, /MCP2562/i, /SN65HVD\d/i, /TJA10\d/i, /TJA11\d/i,
      /ISO1050/i, /TCAN\d/i,
    ],
  },
  // --- RS-485 Transceiver ---
  {
    type: 'rs485',
    matchValue: [
      /MAX485/i, /MAX3485/i, /SP3485/i, /SN65HVD\d/i, /ISL8\d{4}/i,
      /ADM2\d{3}/i,
    ],
  },
  // --- SPI Flash ---
  {
    type: 'spi_flash',
    matchValue: [
      /W25Q/i, /IS25LP/i, /AT25SF/i, /MX25/i, /GD25/i, /SST25/i,
      /S25FL/i, /N25Q/i, /MT25Q/i,
    ],
  },
  // --- I2C EEPROM ---
  {
    type: 'i2c_eeprom',
    matchValue: [
      /24LC/i, /24AA/i, /24C\d/i, /AT24/i, /M24C/i, /CAT24/i, /BR24/i,
    ],
  },
  // --- I2C Device (generic sensor, RTC, etc.) ---
  {
    type: 'i2c_device',
    matchValue: [
      /BME\d{3}/i, /BMP\d{3}/i, /SHT\d/i, /HDC\d/i,  // temp/humidity
      /MPU\d{4}/i, /LSM\d/i, /ADXL\d/i, /LIS\d/i, /MMA\d/i,  // IMU
      /BH17\d{2}/i, /TSL\d{4}/i, /VEML\d{4}/i,  // light
      /INA\d{3}/i, /ADS1\d{3}/i, /MCP48\d{2}/i,  // ADC/DAC
      /DS3231/i, /PCF85\d{2}/i, /RV\d{4}/i,  // RTC
      /PCA9\d{3}/i, /TCA9\d{3}/i,  // I2C mux
      /MCP98\d{2}/i, /LM75/i, /TMP\d{3}/i,  // temp sensor
    ],
  },
  // --- USB Connector ---
  {
    type: 'usb_connector',
    matchValue: [/USB/i],
    matchSymbol: [/usb/i, /connector.*usb/i],
    matchRef: [/^J\d/],
  },
  // --- Generic Connector ---
  {
    type: 'connector',
    matchRef: [/^J\d/],
    matchSymbol: [/connector/i, /header/i, /jack/i, /socket/i],
  },
  // --- Crystal / Oscillator ---
  {
    type: 'crystal',
    matchSymbol: [/crystal/i, /oscillator/i],
    matchValue: [/\d+\.?\d*\s*MHz/i, /\d+\.?\d*\s*kHz/i],
    matchRef: [/^Y\d/],
  },
  // --- LED ---
  {
    type: 'led',
    matchSymbol: [/led/i],
    matchValue: [/LED/i, /WS281/i],
    matchRef: [/^D\d/],
  },
  // --- Motor Driver ---
  {
    type: 'motor_driver',
    matchValue: [
      /DRV8\d{3}/i, /A4988/i, /TMC2\d{3}/i, /L298/i, /TB67\d/i,
      /ULN2\d{3}/i, /L293/i,
    ],
  },
  // --- Display Driver ---
  {
    type: 'display_driver',
    matchValue: [
      /SSD13\d{2}/i, /ST77\d{2}/i, /ILI93\d{2}/i, /SH110\d/i,
      /HX8\d{3}/i, /MAX72\d{2}/i,
    ],
  },
  // --- Battery Charger ---
  {
    type: 'battery_charger',
    matchValue: [
      /BQ24\d{3}/i, /MCP738\d{2}/i, /TP40\d{2}/i, /IP5\d{3}/i,
      /LTC4\d{3}/i, /MAX1\d{4}/i,
    ],
  },
  // --- Wireless Module (LoRa, NRF24, etc.) ---
  {
    type: 'wireless_module',
    matchValue: [
      /SX127/i, /SX126/i, /RFM9/i, /nRF24/i, /CC11\d{2}/i,
      /LoRa/i, /SI44\d{2}/i,
    ],
  },
  // --- Audio ---
  {
    type: 'audio',
    matchValue: [
      /MAX983\d/i, /PAM84\d{2}/i, /PCM51\d{2}/i, /TPA\d{4}/i,
      /WM87\d{2}/i, /CS43\d{2}/i, /SGTL5/i,
    ],
  },
  // --- Power MOSFET ---
  {
    type: 'power_mosfet',
    matchValue: [
      /IRF\d{3}/i, /IRLML\d/i, /SI2302/i, /AO\d{4}/i, /2N7002/i,
      /BSS138/i, /DMG\d{4}/i, /CJ\d{4}/i,
    ],
    matchSymbol: [/nmos/i, /pmos/i, /mosfet/i],
    matchRef: [/^Q\d/],
  },
  // --- ESD Protection ---
  {
    type: 'esd',
    matchValue: [
      /USBLC/i, /PRTR5V/i, /PESD/i, /TVS/i, /SMBJ/i, /SMAJ/i,
      /ESD\d/i, /TPD\d/i,
    ],
  },
];

// ─── Generic Rules by Type ──────────────────────────────────────────────────
// These apply to ALL components of a given type, regardless of MPN.
// ~30 rules that cover 99% of the world's electronic components.

export const GENERIC_RULES: GenericRule[] = [
  // === MCU ===
  {
    type: 'mcu',
    description: 'Microcontroller — needs decoupling, bulk cap, and usually a crystal',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 3, perPin: 'VDD', maxDistance_mm: 2, reason: 'Every MCU needs 100nF ceramic bypass cap on each VDD pin — universal rule for all digital ICs', pinRef: 'VDD', placement: 'close_to_ic' },
      { role: 'bulk_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Bulk decoupling capacitor near power input — handles current transients during startup and RF bursts', placement: 'close_to_ic' },
      { role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Reset pin filter capacitor — prevents noise-induced resets', pinRef: 'NRST', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Place bypass caps as close as possible to VDD pins (< 2mm), with short traces to GND plane via',
      'Check datasheet for exact number of VDD pins — add one 100nF per VDD',
      'If using ADC, add separate filtering on VDDA (ferrite bead + 100nF + 1uF)',
      'Check if MCU needs external crystal or can use internal RC oscillator',
    ],
  },
  // === FPGA ===
  {
    type: 'fpga',
    description: 'FPGA — needs many decoupling caps, core voltage, and configuration flash',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 10, perPin: 'VCC', maxDistance_mm: 2, reason: 'FPGAs need 100nF on every power pin — check pin count for exact quantity', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'bulk_cap', symbol: 'capacitor', value: '47uF', footprint: 'C_1206', quantity: 2, reason: 'FPGAs draw high transient current — need multiple bulk caps', placement: 'close_to_ic' },
    ],
    designNotes: [
      'FPGAs typically need 3+ voltage rails (core, I/O, auxiliary)',
      'Configuration flash (SPI) is usually required for SRAM-based FPGAs',
      'Decoupling: follow vendor power distribution guidelines exactly',
      'Consider using capacitor arrays (0402x4) for space efficiency',
    ],
  },
  // === LDO ===
  {
    type: 'ldo',
    description: 'Linear voltage regulator — needs input and output capacitors',
    supportComponents: [
      { role: 'input_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402', quantity: 1, reason: 'Input capacitor for LDO stability — ceramic X5R/X7R, place close to VIN pin', pinRef: 'VIN', placement: 'close_to_ic' },
      { role: 'output_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402', quantity: 1, reason: 'Output capacitor for LDO stability and transient response — ceramic, low ESR', pinRef: 'VOUT', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Check datasheet for minimum/maximum output capacitor ESR — some LDOs (AMS1117) need ESR > 0.1Ω (use tantalum)',
      'Input capacitor should be rated for input voltage with margin',
      'Keep input and output traces short and wide',
      'Enable pin: add pull-up if always on, or RC delay for sequencing',
    ],
  },
  // === Buck Converter ===
  {
    type: 'buck',
    description: 'Switching buck (step-down) regulator — needs inductor, caps, and feedback network',
    supportComponents: [
      { role: 'input_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 2, reason: 'Input caps handle switching current ripple — use low ESR ceramic, X5R/X7R', pinRef: 'VIN', placement: 'close_to_ic' },
      { role: 'output_cap', symbol: 'capacitor', value: '22uF', footprint: 'C_0805', quantity: 2, reason: 'Output caps for voltage ripple filtering — low ESR ceramic', pinRef: 'VOUT', placement: 'close_to_ic' },
      { role: 'inductor', symbol: 'inductor', value: '4.7uH', footprint: 'IND_4x4', quantity: 1, reason: 'Output inductor — choose based on current rating and DCR. Shielded preferred to reduce EMI', pinRef: 'SW', placement: 'close_to_ic' },
      { role: 'bootstrap_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bootstrap capacitor for high-side MOSFET gate drive', pinRef: 'BST', placement: 'close_to_ic' },
      { role: 'feedback_high', symbol: 'resistor', value: '100K', footprint: 'R_0402', quantity: 1, reason: 'Feedback divider top resistor — sets output voltage. Calculate: R_top = R_bot × (Vout/Vref - 1)', pinRef: 'FB', placement: 'close_to_ic' },
      { role: 'feedback_low', symbol: 'resistor', value: '10K', footprint: 'R_0402', quantity: 1, reason: 'Feedback divider bottom resistor — typically 10K. Connect to FB pin', pinRef: 'FB', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Layout is CRITICAL: input cap → IC → inductor → output cap must be tight loop',
      'Keep SW (switch) node area small to reduce EMI',
      'Ground plane under IC is essential — use thermal vias',
      'Feedback trace: route away from SW node, quiet side',
      'Calculate inductor value: L = (Vin - Vout) × Vout / (Vin × fsw × ΔIL)',
    ],
  },
  // === Boost Converter ===
  {
    type: 'boost',
    description: 'Switching boost (step-up) regulator — needs inductor and caps',
    supportComponents: [
      { role: 'input_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Input capacitor — low ESR ceramic', pinRef: 'VIN', placement: 'close_to_ic' },
      { role: 'output_cap', symbol: 'capacitor', value: '22uF', footprint: 'C_0805', quantity: 1, reason: 'Output capacitor — rated for output voltage', pinRef: 'VOUT', placement: 'close_to_ic' },
      { role: 'inductor', symbol: 'inductor', value: '4.7uH', footprint: 'IND_4x4', quantity: 1, reason: 'Input inductor — shielded, low DCR', pinRef: 'SW', placement: 'close_to_ic' },
      { role: 'schottky', symbol: 'diode', value: 'SS34', footprint: 'SMA', quantity: 1, reason: 'Schottky diode for rectification — low forward voltage, fast recovery', pinRef: 'SW', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Inductor → SW → diode → output cap path must be tight',
      'Use Schottky diode rated for output voltage + margin',
      'Input and output caps close to IC',
    ],
  },
  // === Op-Amp ===
  {
    type: 'opamp',
    description: 'Operational amplifier — needs decoupling cap',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass capacitor on V+ supply pin — place within 5mm of pin', pinRef: 'V+', maxDistance_mm: 5, placement: 'close_to_ic' },
    ],
    designNotes: [
      'Place 100nF ceramic cap close to V+ pin with short trace to GND',
      'For precision op-amps, add 10uF in parallel with 100nF',
      'Keep input traces short and guarded for high-impedance circuits',
      'Avoid routing digital signals near analog inputs',
    ],
  },
  // === Comparator ===
  {
    type: 'comparator',
    description: 'Comparator — needs decoupling',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap on supply pin', pinRef: 'VCC', maxDistance_mm: 5, placement: 'close_to_ic' },
    ],
    designNotes: ['Add hysteresis resistor if input is noisy to prevent oscillation'],
  },
  // === USB-UART ===
  {
    type: 'usb_uart',
    description: 'USB-UART bridge IC — needs bypass cap, may need crystal',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass capacitor on VCC', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'bulk_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Bulk cap for USB power', placement: 'close_to_ic' },
    ],
    designNotes: [
      'CH340G needs 12MHz crystal, CH340C/K has internal oscillator',
      'USB D+/D- traces: keep short, matched length, 90Ω differential',
      'Add ESD protection (USBLC6-2) on USB lines',
    ],
  },
  // === CAN Transceiver ===
  {
    type: 'can_transceiver',
    description: 'CAN bus transceiver — needs bypass cap and optional termination',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap on VCC pin', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'termination', symbol: 'resistor', value: '120', footprint: 'R_0603', quantity: 1, reason: 'CAN bus termination resistor (120Ω) — only needed at the two ends of the bus', pinRef: 'CANH', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Termination: 120Ω between CANH and CANL at each end of bus',
      'Only 2 termination resistors per bus (not per node)',
      'Keep CAN traces as differential pair',
    ],
  },
  // === RS-485 ===
  {
    type: 'rs485',
    description: 'RS-485 transceiver — needs bypass cap and termination',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'termination', symbol: 'resistor', value: '120', footprint: 'R_0603', quantity: 1, reason: 'Bus termination at end nodes', pinRef: 'A', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Bias resistors (390Ω to VCC on A, 390Ω to GND on B) prevent floating bus when no driver active',
      'Termination: 120Ω between A and B at each end of bus',
    ],
  },
  // === SPI Flash ===
  {
    type: 'spi_flash',
    description: 'SPI NOR Flash — needs bypass cap and pull-ups',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap on VCC', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402', quantity: 1, reason: 'CS# pull-up — keeps flash deselected during MCU boot', pinRef: 'CS', placement: 'close_to_ic' },
      { role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402', quantity: 1, reason: 'WP# (Write Protect) pull-up', pinRef: 'WP', placement: 'close_to_ic' },
      { role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402', quantity: 1, reason: 'HOLD# pull-up — prevents accidental hold during boot', pinRef: 'HOLD', placement: 'close_to_ic' },
    ],
    designNotes: [
      'SPI clock speed: check flash max frequency vs MCU SPI config',
      'Keep SPI traces short for high-speed operation',
    ],
  },
  // === I2C EEPROM ===
  {
    type: 'i2c_eeprom',
    description: 'I2C EEPROM — needs bypass cap, bus pull-ups handled at bus level',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap on VCC', pinRef: 'VCC', placement: 'close_to_ic' },
    ],
    designNotes: [
      'I2C bus pull-ups: one set per bus (not per device) — typically 4.7K to VCC',
      'Address pins: tie high or low to set I2C address',
      'WP pin: tie to GND for read/write, VCC for read-only',
    ],
  },
  // === I2C Device (sensor, RTC, etc.) ===
  {
    type: 'i2c_device',
    description: 'I2C peripheral — needs bypass cap',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Bypass cap on VDD — standard for all digital ICs', pinRef: 'VDD', placement: 'close_to_ic' },
    ],
    designNotes: [
      'I2C pull-ups: one pair per bus (4.7K typical for 100kHz, 2.2K for 400kHz)',
      'If multiple I2C devices share bus, only ONE set of pull-ups',
      'Check I2C address conflicts if multiple devices on same bus',
    ],
  },
  // === USB Connector ===
  {
    type: 'usb_connector',
    description: 'USB connector — needs ESD protection and possibly CC resistors',
    supportComponents: [
      { role: 'esd_protection', symbol: 'ic', value: 'USBLC6-2SC6', footprint: 'SOT-23-6', quantity: 1, reason: 'ESD protection on USB D+/D- — required for certification, strongly recommended for reliability', pinRef: 'USB_D+', placement: 'between_connector_and_ic' },
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'VBUS filter capacitor', pinRef: 'VBUS', placement: 'close_to_ic' },
    ],
    designNotes: [
      'USB Type-C: add 5.1K resistors on CC1 and CC2 pins (device mode)',
      'USB 2.0: D+/D- traces should be 90Ω differential impedance',
      'Place ESD protection as close to connector as possible',
    ],
  },
  // === LED ===
  {
    type: 'led',
    description: 'LED — needs current limiting resistor',
    supportComponents: [
      { role: 'series_resistor', symbol: 'resistor', value: '1K', footprint: 'R_0402', quantity: 1, reason: 'Current limiting resistor. Calculate: R = (Vsupply - Vf) / If. For 3.3V, green LED: (3.3-2.2)/0.001 = 1.1KΩ ≈ 1K', pinRef: 'anode', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Adjust resistor value based on supply voltage and desired brightness',
      'Typical LED forward voltages: Red=1.8V, Green=2.2V, Blue=3.2V, White=3.2V',
      'For WS2812B addressable LEDs: add 100nF bypass per LED + 300-500Ω series on data line',
    ],
  },
  // === Motor Driver ===
  {
    type: 'motor_driver',
    description: 'Motor driver IC — needs decoupling and motor power caps',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'Logic supply bypass', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'bulk_cap', symbol: 'capacitor', value: '100uF', footprint: 'C_1210', quantity: 1, reason: 'Motor power bulk capacitor — absorbs back-EMF spikes. Use low ESR', pinRef: 'VM', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Motor power traces: wide, short, direct to power supply',
      'Add flyback diodes if not integrated in driver',
      'Ground plane essential under driver IC',
    ],
  },
  // === Battery Charger ===
  {
    type: 'battery_charger',
    description: 'Battery charging IC — needs input/output caps and programming resistor',
    supportComponents: [
      { role: 'input_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Input capacitor from USB/adapter', pinRef: 'VIN', placement: 'close_to_ic' },
      { role: 'output_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Battery side capacitor', pinRef: 'BAT', placement: 'close_to_ic' },
      { role: 'prog_resistor', symbol: 'resistor', value: '2K', footprint: 'R_0402', quantity: 1, reason: 'Charge current programming resistor. Rprog = Vprog / Ichg. Check datasheet for formula', pinRef: 'PROG', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Programming resistor sets charge current — calculate from datasheet formula',
      'Add thermal pad/via for heat dissipation',
      'Keep battery traces short and wide (high current)',
    ],
  },
  // === Wireless Module ===
  {
    type: 'wireless_module',
    description: 'Wireless module — needs decoupling and antenna',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'VCC bypass', pinRef: 'VCC', placement: 'close_to_ic' },
      { role: 'bulk_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'Bulk cap for TX power bursts (RF modules draw high current during transmit)', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Antenna: maintain 50Ω impedance trace, keep ground plane clear under antenna',
      'Place bypass caps on VCC as close as possible',
      'SPI modules (nRF24, LoRa): keep SPI traces short',
    ],
  },
  // === Audio ===
  {
    type: 'audio',
    description: 'Audio IC — needs decoupling and possibly coupling caps',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805', quantity: 1, reason: 'PVDD/AVDD bypass — audio ICs sensitive to supply noise', pinRef: 'VDD', placement: 'close_to_ic' },
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'High-frequency bypass', pinRef: 'VDD', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Separate analog and digital ground, connect at one point',
      'Audio traces: route away from switching supplies and digital buses',
      'AC coupling caps on output if DC blocking needed',
    ],
  },
  // === Display Driver ===
  {
    type: 'display_driver',
    description: 'Display/LED driver — needs decoupling and possibly charge pump caps',
    supportComponents: [
      { role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402', quantity: 1, reason: 'VCC bypass', pinRef: 'VCC', placement: 'close_to_ic' },
    ],
    designNotes: [
      'OLED (SSD1306): may need charge pump caps if using internal boost',
      'LED drivers (MAX7219): add 10uF on V+ and ISET resistor',
      'TFT (ILI9341): needs 3.3V and possibly separate LED backlight supply',
    ],
  },
  // === ESD Protection ===
  {
    type: 'esd',
    description: 'ESD/TVS protection — place between connector and IC',
    supportComponents: [],
    designNotes: [
      'Place ESD protection as close to connector as possible',
      'Route protected traces through the TVS, not around it',
      'Check clamping voltage is below IC absolute maximum rating',
    ],
  },
  // === Power MOSFET ===
  {
    type: 'power_mosfet',
    description: 'Power MOSFET — may need gate resistor',
    supportComponents: [
      { role: 'gate_resistor', symbol: 'resistor', value: '10', footprint: 'R_0402', quantity: 1, reason: 'Gate resistor limits dI/dt, reduces ringing. 10-100Ω typical', pinRef: 'gate', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Gate pull-down (10K-100K) to keep MOSFET off during MCU boot',
      'For high-side P-FET: gate driver or level shifter may be needed',
      'N-FET: ensure Vgs(th) < MCU GPIO voltage',
    ],
  },
  // === Crystal (standalone) ===
  {
    type: 'crystal',
    description: 'Crystal oscillator — needs load capacitors',
    supportComponents: [
      { role: 'load_cap', symbol: 'capacitor', value: '20pF', footprint: 'C_0402', quantity: 2, reason: 'Load capacitors. Calculate: CL = 2 × (Cload - Cstray). Use C0G/NP0 type only', placement: 'close_to_ic' },
    ],
    designNotes: [
      'Use C0G/NP0 capacitors ONLY (not X5R/X7R) — they have stable capacitance',
      'Place crystal and load caps as close as possible to MCU pins',
      'Guard ring or ground pour around crystal traces to reduce noise coupling',
      'Calculate load caps: CL = 2 × (Cload_crystal - Cstray), typical Cstray = 3-5pF',
    ],
  },
  // === Connector (generic) ===
  {
    type: 'connector',
    description: 'Connector — consider ESD protection on exposed lines',
    supportComponents: [],
    designNotes: [
      'External connectors should have ESD protection on signal lines',
      'Power connectors: add reverse polarity protection (Schottky or P-FET)',
      'Pin headers: add pull-ups/pull-downs on unused pins if they connect to IC inputs',
    ],
  },
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Detect the component type from its value, symbol, reference, and footprint.
 * Returns the first matching type, or null if unknown.
 */
export function detectComponentType(
  value: string,
  symbol: string = '',
  ref: string = '',
  footprint: string = '',
): string | null {
  for (const detector of TYPE_DETECTORS) {
    if (detector.matchValue) {
      for (const re of detector.matchValue) {
        if (re.test(value)) return detector.type;
      }
    }
    if (detector.matchSymbol) {
      for (const re of detector.matchSymbol) {
        if (re.test(symbol)) return detector.type;
      }
    }
    if (detector.matchRef && ref) {
      for (const re of detector.matchRef) {
        if (re.test(ref)) {
          // Ref-only match is weak — only use if other fields empty
          if (!value && !symbol) return detector.type;
        }
      }
    }
    if (detector.matchFootprint && footprint) {
      for (const re of detector.matchFootprint) {
        if (re.test(footprint)) return detector.type;
      }
    }
  }
  return null;
}

/**
 * Get generic rules for a component type.
 */
export function getGenericRules(type: string): GenericRule | null {
  return GENERIC_RULES.find(r => r.type === type) || null;
}

/**
 * Get rules for a specific component — tries Level 2 (datasheet knowledge) first,
 * falls back to Level 1 (generic rules).
 */
export function getRulesForComponent(
  value: string,
  symbol: string = '',
  ref: string = '',
  footprint: string = '',
): { rules: GenericRule | null; source: 'datasheet' | 'generic' | 'none'; type: string | null } {
  // Level 2: Check specific datasheet knowledge first
  const specific = findICKnowledge(value);
  if (specific) {
    return {
      rules: {
        type: specific.type,
        description: `${specific.manufacturer} ${specific.type.toUpperCase()} — datasheet-specific rules`,
        supportComponents: specific.supportComponents,
        designNotes: specific.designNotes,
      },
      source: 'datasheet',
      type: specific.type,
    };
  }

  // Level 1: Fall back to generic rules by detected type
  const type = detectComponentType(value, symbol, ref, footprint);
  if (type) {
    const generic = getGenericRules(type);
    if (generic) {
      return { rules: generic, source: 'generic', type };
    }
  }

  return { rules: null, source: 'none', type: null };
}
