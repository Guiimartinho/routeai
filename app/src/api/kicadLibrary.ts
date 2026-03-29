// ─── kicadLibrary.ts ─ Pre-built index of popular KiCad symbols ─────────────
//
// Since we cannot clone KiCad git repos from the browser, this file provides
// a curated index of ~500 of the most commonly used KiCad library symbols.
// Categorized by KiCad library name.
// In the future, the backend can serve the full KiCad library.

export interface KicadIndexEntry {
  name: string;
  lib_file: string;
  pin_count: number;
  description: string;
  category: string;
  footprint_suggestion?: string;
}

export const KICAD_LIBRARY_INDEX: KicadIndexEntry[] = [
  // ─── Device (generic passives & semiconductors) ───────────────────────────
  { name: 'R', lib_file: 'Device', pin_count: 2, description: 'Resistor', category: 'Device', footprint_suggestion: 'R_0402' },
  { name: 'R_Small', lib_file: 'Device', pin_count: 2, description: 'Resistor, small symbol', category: 'Device', footprint_suggestion: 'R_0201' },
  { name: 'R_Pack04', lib_file: 'Device', pin_count: 8, description: 'Resistor array 4x', category: 'Device', footprint_suggestion: 'R_Array_Convex_4x0402' },
  { name: 'R_POT', lib_file: 'Device', pin_count: 3, description: 'Potentiometer', category: 'Device', footprint_suggestion: 'Potentiometer_Bourns_3296W' },
  { name: 'R_Thermistor', lib_file: 'Device', pin_count: 2, description: 'NTC/PTC Thermistor', category: 'Device', footprint_suggestion: 'R_0402' },
  { name: 'C', lib_file: 'Device', pin_count: 2, description: 'Capacitor', category: 'Device', footprint_suggestion: 'C_0402' },
  { name: 'C_Small', lib_file: 'Device', pin_count: 2, description: 'Capacitor, small symbol', category: 'Device', footprint_suggestion: 'C_0201' },
  { name: 'C_Polarized', lib_file: 'Device', pin_count: 2, description: 'Polarized capacitor', category: 'Device', footprint_suggestion: 'CP_Elec_5x5.3' },
  { name: 'C_Feedthrough', lib_file: 'Device', pin_count: 3, description: 'Feedthrough capacitor', category: 'Device', footprint_suggestion: 'C_Feedthrough' },
  { name: 'L', lib_file: 'Device', pin_count: 2, description: 'Inductor', category: 'Device', footprint_suggestion: 'L_0603' },
  { name: 'L_Small', lib_file: 'Device', pin_count: 2, description: 'Inductor, small symbol', category: 'Device', footprint_suggestion: 'L_0402' },
  { name: 'L_Core_Ferrite', lib_file: 'Device', pin_count: 2, description: 'Ferrite bead', category: 'Device', footprint_suggestion: 'L_0402' },
  { name: 'D', lib_file: 'Device', pin_count: 2, description: 'Diode', category: 'Device', footprint_suggestion: 'D_SOD-123' },
  { name: 'D_Schottky', lib_file: 'Device', pin_count: 2, description: 'Schottky diode', category: 'Device', footprint_suggestion: 'D_SOD-123' },
  { name: 'D_Zener', lib_file: 'Device', pin_count: 2, description: 'Zener diode', category: 'Device', footprint_suggestion: 'D_SOD-123' },
  { name: 'D_TVS', lib_file: 'Device', pin_count: 2, description: 'TVS diode', category: 'Device', footprint_suggestion: 'D_SMA' },
  { name: 'D_TVS_Bidir', lib_file: 'Device', pin_count: 2, description: 'Bidirectional TVS diode', category: 'Device', footprint_suggestion: 'D_SMA' },
  { name: 'D_Bridge_Rectifier', lib_file: 'Device', pin_count: 4, description: 'Bridge rectifier', category: 'Device', footprint_suggestion: 'SOIC-4' },
  { name: 'LED', lib_file: 'Device', pin_count: 2, description: 'LED', category: 'Device', footprint_suggestion: 'LED_0603' },
  { name: 'LED_RGB', lib_file: 'Device', pin_count: 4, description: 'RGB LED, common cathode', category: 'Device', footprint_suggestion: 'LED_RGB_5050' },
  { name: 'LED_ARGB', lib_file: 'Device', pin_count: 4, description: 'RGB LED, common anode', category: 'Device', footprint_suggestion: 'LED_RGB_5050' },
  { name: 'Q_NPN_BEC', lib_file: 'Device', pin_count: 3, description: 'NPN BJT (B-E-C)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_NPN_BCE', lib_file: 'Device', pin_count: 3, description: 'NPN BJT (B-C-E)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_PNP_BEC', lib_file: 'Device', pin_count: 3, description: 'PNP BJT (B-E-C)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_PNP_BCE', lib_file: 'Device', pin_count: 3, description: 'PNP BJT (B-C-E)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_NMOS_GSD', lib_file: 'Device', pin_count: 3, description: 'N-channel MOSFET (G-S-D)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_NMOS_GDS', lib_file: 'Device', pin_count: 3, description: 'N-channel MOSFET (G-D-S)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_PMOS_GSD', lib_file: 'Device', pin_count: 3, description: 'P-channel MOSFET (G-S-D)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Q_PMOS_GDS', lib_file: 'Device', pin_count: 3, description: 'P-channel MOSFET (G-D-S)', category: 'Device', footprint_suggestion: 'SOT-23' },
  { name: 'Crystal', lib_file: 'Device', pin_count: 2, description: 'Crystal oscillator', category: 'Device', footprint_suggestion: 'Crystal_SMD_3215' },
  { name: 'Crystal_GND24', lib_file: 'Device', pin_count: 4, description: 'Crystal oscillator with GND', category: 'Device', footprint_suggestion: 'Crystal_SMD_3215_4Pin' },
  { name: 'Fuse', lib_file: 'Device', pin_count: 2, description: 'Fuse', category: 'Device', footprint_suggestion: 'Fuse_0603' },
  { name: 'Polyfuse', lib_file: 'Device', pin_count: 2, description: 'Resettable fuse (PTC)', category: 'Device', footprint_suggestion: 'Fuse_0805' },
  { name: 'Varistor', lib_file: 'Device', pin_count: 2, description: 'Varistor (MOV)', category: 'Device', footprint_suggestion: 'Varistor_10mm' },
  { name: 'Transformer_1P_1S', lib_file: 'Device', pin_count: 4, description: 'Transformer 1:1', category: 'Device' },
  { name: 'Speaker', lib_file: 'Device', pin_count: 2, description: 'Speaker / buzzer', category: 'Device' },
  { name: 'Buzzer', lib_file: 'Device', pin_count: 2, description: 'Piezo buzzer', category: 'Device' },
  { name: 'Battery', lib_file: 'Device', pin_count: 2, description: 'Battery cell', category: 'Device' },
  { name: 'Antenna', lib_file: 'Device', pin_count: 1, description: 'Antenna', category: 'Device' },
  { name: 'Heatsink', lib_file: 'Device', pin_count: 1, description: 'Heatsink', category: 'Device' },
  { name: 'Relay_SPDT', lib_file: 'Device', pin_count: 5, description: 'SPDT relay', category: 'Device' },
  { name: 'Relay_DPDT', lib_file: 'Device', pin_count: 8, description: 'DPDT relay', category: 'Device' },
  { name: 'Photodiode', lib_file: 'Device', pin_count: 2, description: 'Photodiode', category: 'Device', footprint_suggestion: 'D_SOD-123' },
  { name: 'Phototransistor_NPN', lib_file: 'Device', pin_count: 3, description: 'NPN phototransistor', category: 'Device', footprint_suggestion: 'SOT-23' },

  // ─── Regulator_Linear ─────────────────────────────────────────────────────
  { name: 'LM1117-3.3', lib_file: 'Regulator_Linear', pin_count: 3, description: '3.3V 800mA LDO regulator', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'LM1117-5.0', lib_file: 'Regulator_Linear', pin_count: 3, description: '5.0V 800mA LDO regulator', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'LM1117-ADJ', lib_file: 'Regulator_Linear', pin_count: 3, description: 'Adjustable 800mA LDO regulator', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'AMS1117-3.3', lib_file: 'Regulator_Linear', pin_count: 3, description: '3.3V 1A LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'AMS1117-1.8', lib_file: 'Regulator_Linear', pin_count: 3, description: '1.8V 1A LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'AP2112K-3.3', lib_file: 'Regulator_Linear', pin_count: 5, description: '3.3V 600mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-23-5' },
  { name: 'MCP1700-3302E', lib_file: 'Regulator_Linear', pin_count: 3, description: '3.3V 250mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-23' },
  { name: 'LM7805', lib_file: 'Regulator_Linear', pin_count: 3, description: '5V 1.5A linear regulator', category: 'Regulator_Linear', footprint_suggestion: 'TO-220' },
  { name: 'LM7812', lib_file: 'Regulator_Linear', pin_count: 3, description: '12V 1.5A linear regulator', category: 'Regulator_Linear', footprint_suggestion: 'TO-220' },
  { name: 'LM7905', lib_file: 'Regulator_Linear', pin_count: 3, description: '-5V 1.5A negative regulator', category: 'Regulator_Linear', footprint_suggestion: 'TO-220' },
  { name: 'LM317_TO-220', lib_file: 'Regulator_Linear', pin_count: 3, description: 'Adj 1.5A linear regulator', category: 'Regulator_Linear', footprint_suggestion: 'TO-220' },
  { name: 'LDL1117S33R', lib_file: 'Regulator_Linear', pin_count: 4, description: '3.3V 1.2A LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'SPX3819M5-L-3-3', lib_file: 'Regulator_Linear', pin_count: 5, description: '3.3V 500mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-23-5' },
  { name: 'TLV1117-33', lib_file: 'Regulator_Linear', pin_count: 3, description: '3.3V 800mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-223' },
  { name: 'XC6206P332MR', lib_file: 'Regulator_Linear', pin_count: 3, description: '3.3V 200mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-23' },
  { name: 'RT9013-33GB', lib_file: 'Regulator_Linear', pin_count: 5, description: '3.3V 500mA LDO', category: 'Regulator_Linear', footprint_suggestion: 'SOT-23-5' },

  // ─── Regulator_Switching ──────────────────────────────────────────────────
  { name: 'LM2596S-5', lib_file: 'Regulator_Switching', pin_count: 5, description: '5V 3A step-down', category: 'Regulator_Switching', footprint_suggestion: 'TO-263-5' },
  { name: 'LM2596S-3.3', lib_file: 'Regulator_Switching', pin_count: 5, description: '3.3V 3A step-down', category: 'Regulator_Switching', footprint_suggestion: 'TO-263-5' },
  { name: 'LM2596S-ADJ', lib_file: 'Regulator_Switching', pin_count: 5, description: 'Adj 3A step-down', category: 'Regulator_Switching', footprint_suggestion: 'TO-263-5' },
  { name: 'MP1584EN', lib_file: 'Regulator_Switching', pin_count: 8, description: '3A step-down converter', category: 'Regulator_Switching', footprint_suggestion: 'SOIC-8' },
  { name: 'MP2307DN', lib_file: 'Regulator_Switching', pin_count: 8, description: '3A step-down converter', category: 'Regulator_Switching', footprint_suggestion: 'SOIC-8' },
  { name: 'TPS5430', lib_file: 'Regulator_Switching', pin_count: 8, description: '3A step-down converter', category: 'Regulator_Switching', footprint_suggestion: 'SOIC-8' },
  { name: 'TPS54331', lib_file: 'Regulator_Switching', pin_count: 8, description: '3A step-down converter', category: 'Regulator_Switching', footprint_suggestion: 'SOIC-8' },
  { name: 'TPS61040', lib_file: 'Regulator_Switching', pin_count: 6, description: '28V boost converter', category: 'Regulator_Switching', footprint_suggestion: 'SOT-23-6' },
  { name: 'TPS61090', lib_file: 'Regulator_Switching', pin_count: 10, description: '5.5V 2A boost converter', category: 'Regulator_Switching', footprint_suggestion: 'MSOP-10' },
  { name: 'MT3608', lib_file: 'Regulator_Switching', pin_count: 6, description: '2A boost converter', category: 'Regulator_Switching', footprint_suggestion: 'SOT-23-6' },
  { name: 'XL6009', lib_file: 'Regulator_Switching', pin_count: 5, description: '4A boost/buck converter', category: 'Regulator_Switching', footprint_suggestion: 'TO-263-5' },
  { name: 'LTC3780', lib_file: 'Regulator_Switching', pin_count: 24, description: 'Sync buck-boost controller', category: 'Regulator_Switching', footprint_suggestion: 'SSOP-24' },
  { name: 'AP3012', lib_file: 'Regulator_Switching', pin_count: 5, description: '1.4A boost converter', category: 'Regulator_Switching', footprint_suggestion: 'SOT-23-5' },
  { name: 'SY8089', lib_file: 'Regulator_Switching', pin_count: 6, description: '2A step-down converter', category: 'Regulator_Switching', footprint_suggestion: 'SOT-23-6' },

  // ─── MCU_ST (STM32) ──────────────────────────────────────────────────────
  { name: 'STM32F103C8T6', lib_file: 'MCU_ST_STM32F1', pin_count: 48, description: 'ARM Cortex-M3 72MHz 64KB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-48' },
  { name: 'STM32F103CBT6', lib_file: 'MCU_ST_STM32F1', pin_count: 48, description: 'ARM Cortex-M3 72MHz 128KB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-48' },
  { name: 'STM32F103RCT6', lib_file: 'MCU_ST_STM32F1', pin_count: 64, description: 'ARM Cortex-M3 72MHz 256KB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-64' },
  { name: 'STM32F401CCU6', lib_file: 'MCU_ST_STM32F4', pin_count: 48, description: 'ARM Cortex-M4 84MHz 256KB Flash', category: 'MCU_ST', footprint_suggestion: 'QFN-48' },
  { name: 'STM32F411CEU6', lib_file: 'MCU_ST_STM32F4', pin_count: 48, description: 'ARM Cortex-M4 100MHz 512KB Flash', category: 'MCU_ST', footprint_suggestion: 'QFN-48' },
  { name: 'STM32F407VGT6', lib_file: 'MCU_ST_STM32F4', pin_count: 100, description: 'ARM Cortex-M4 168MHz 1MB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-100' },
  { name: 'STM32F429ZIT6', lib_file: 'MCU_ST_STM32F4', pin_count: 144, description: 'ARM Cortex-M4 180MHz 2MB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-144' },
  { name: 'STM32F030F4P6', lib_file: 'MCU_ST_STM32F0', pin_count: 20, description: 'ARM Cortex-M0 48MHz 16KB Flash', category: 'MCU_ST', footprint_suggestion: 'TSSOP-20' },
  { name: 'STM32F042F6P6', lib_file: 'MCU_ST_STM32F0', pin_count: 20, description: 'ARM Cortex-M0 48MHz 32KB Flash USB', category: 'MCU_ST', footprint_suggestion: 'TSSOP-20' },
  { name: 'STM32G030F6P6', lib_file: 'MCU_ST_STM32G0', pin_count: 20, description: 'ARM Cortex-M0+ 64MHz 32KB Flash', category: 'MCU_ST', footprint_suggestion: 'TSSOP-20' },
  { name: 'STM32G431CBU6', lib_file: 'MCU_ST_STM32G4', pin_count: 48, description: 'ARM Cortex-M4 170MHz 128KB Flash', category: 'MCU_ST', footprint_suggestion: 'QFN-48' },
  { name: 'STM32H743VIT6', lib_file: 'MCU_ST_STM32H7', pin_count: 100, description: 'ARM Cortex-M7 480MHz 2MB Flash', category: 'MCU_ST', footprint_suggestion: 'LQFP-100' },
  { name: 'STM32L031F6P6', lib_file: 'MCU_ST_STM32L0', pin_count: 20, description: 'ARM Cortex-M0+ ULP 32KB Flash', category: 'MCU_ST', footprint_suggestion: 'TSSOP-20' },
  { name: 'STM32L432KCU6', lib_file: 'MCU_ST_STM32L4', pin_count: 32, description: 'ARM Cortex-M4 ULP 256KB Flash', category: 'MCU_ST', footprint_suggestion: 'QFN-32' },
  { name: 'STM32WB55CGU6', lib_file: 'MCU_ST_STM32WB', pin_count: 48, description: 'ARM Cortex-M4 BLE 1MB Flash', category: 'MCU_ST', footprint_suggestion: 'QFN-48' },
  { name: 'STM32C011F4P6', lib_file: 'MCU_ST_STM32C0', pin_count: 20, description: 'ARM Cortex-M0+ 48MHz 16KB Flash', category: 'MCU_ST', footprint_suggestion: 'TSSOP-20' },

  // ─── MCU_Microchip (ATmega, PIC, SAMD) ───────────────────────────────────
  { name: 'ATmega328P-AU', lib_file: 'MCU_Microchip_ATmega', pin_count: 32, description: 'AVR 20MHz 32KB Flash (Arduino)', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-32' },
  { name: 'ATmega328P-PU', lib_file: 'MCU_Microchip_ATmega', pin_count: 28, description: 'AVR 20MHz 32KB Flash DIP', category: 'MCU_Microchip', footprint_suggestion: 'DIP-28' },
  { name: 'ATmega32U4-AU', lib_file: 'MCU_Microchip_ATmega', pin_count: 44, description: 'AVR 16MHz 32KB Flash USB', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-44' },
  { name: 'ATmega2560-16AU', lib_file: 'MCU_Microchip_ATmega', pin_count: 100, description: 'AVR 16MHz 256KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-100' },
  { name: 'ATtiny85-20SU', lib_file: 'MCU_Microchip_ATtiny', pin_count: 8, description: 'AVR 20MHz 8KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'SOIC-8' },
  { name: 'ATtiny13A-SSU', lib_file: 'MCU_Microchip_ATtiny', pin_count: 8, description: 'AVR 20MHz 1KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'SOIC-8' },
  { name: 'ATtiny44A-SSU', lib_file: 'MCU_Microchip_ATtiny', pin_count: 14, description: 'AVR 20MHz 4KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'SOIC-14' },
  { name: 'ATtiny1614', lib_file: 'MCU_Microchip_ATtiny', pin_count: 14, description: 'AVR 20MHz 16KB Flash UPDI', category: 'MCU_Microchip', footprint_suggestion: 'SOIC-14' },
  { name: 'ATSAMD21G18A-AU', lib_file: 'MCU_Microchip_SAMD', pin_count: 48, description: 'ARM Cortex-M0+ 48MHz 256KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-48' },
  { name: 'ATSAMD51J19A-AU', lib_file: 'MCU_Microchip_SAMD', pin_count: 64, description: 'ARM Cortex-M4 120MHz 512KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-64' },
  { name: 'PIC16F877A-I/P', lib_file: 'MCU_Microchip_PIC16', pin_count: 40, description: 'PIC 20MHz 14KB Flash', category: 'MCU_Microchip', footprint_suggestion: 'DIP-40' },
  { name: 'PIC18F4550-I/PT', lib_file: 'MCU_Microchip_PIC18', pin_count: 44, description: 'PIC 48MHz 32KB Flash USB', category: 'MCU_Microchip', footprint_suggestion: 'TQFP-44' },

  // ─── MCU_Espressif ────────────────────────────────────────────────────────
  { name: 'ESP32-WROOM-32', lib_file: 'MCU_Espressif', pin_count: 38, description: 'ESP32 WiFi+BT module 4MB Flash', category: 'MCU_Espressif', footprint_suggestion: 'ESP32-WROOM-32' },
  { name: 'ESP32-WROVER-E', lib_file: 'MCU_Espressif', pin_count: 38, description: 'ESP32 WiFi+BT module 8MB PSRAM', category: 'MCU_Espressif', footprint_suggestion: 'ESP32-WROVER-E' },
  { name: 'ESP32-S3-WROOM-1', lib_file: 'MCU_Espressif', pin_count: 44, description: 'ESP32-S3 WiFi+BT AI module', category: 'MCU_Espressif', footprint_suggestion: 'ESP32-S3-WROOM-1' },
  { name: 'ESP32-C3-MINI-1', lib_file: 'MCU_Espressif', pin_count: 29, description: 'ESP32-C3 RISC-V WiFi+BT', category: 'MCU_Espressif', footprint_suggestion: 'ESP32-C3-MINI-1' },
  { name: 'ESP8266EX', lib_file: 'MCU_Espressif', pin_count: 32, description: 'ESP8266 WiFi SoC', category: 'MCU_Espressif', footprint_suggestion: 'QFN-32' },
  { name: 'ESP-12E', lib_file: 'MCU_Espressif', pin_count: 22, description: 'ESP8266 WiFi module', category: 'MCU_Espressif', footprint_suggestion: 'ESP-12E' },

  // ─── MCU_Nordic ───────────────────────────────────────────────────────────
  { name: 'nRF52832-CIAA', lib_file: 'MCU_Nordic', pin_count: 48, description: 'ARM Cortex-M4 BLE 512KB Flash', category: 'MCU_Nordic', footprint_suggestion: 'QFN-48' },
  { name: 'nRF52840-QIAA', lib_file: 'MCU_Nordic', pin_count: 73, description: 'ARM Cortex-M4 BLE+USB 1MB Flash', category: 'MCU_Nordic', footprint_suggestion: 'QFN-73' },

  // ─── MCU_RaspberryPi ─────────────────────────────────────────────────────
  { name: 'RP2040', lib_file: 'MCU_RaspberryPi', pin_count: 56, description: 'Dual ARM Cortex-M0+ 133MHz 264KB SRAM', category: 'MCU_RaspberryPi', footprint_suggestion: 'QFN-56' },

  // ─── Connector_Generic ────────────────────────────────────────────────────
  { name: 'Conn_01x01', lib_file: 'Connector_Generic', pin_count: 1, description: '1-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x01' },
  { name: 'Conn_01x02', lib_file: 'Connector_Generic', pin_count: 2, description: '2-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x02' },
  { name: 'Conn_01x03', lib_file: 'Connector_Generic', pin_count: 3, description: '3-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x03' },
  { name: 'Conn_01x04', lib_file: 'Connector_Generic', pin_count: 4, description: '4-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x04' },
  { name: 'Conn_01x05', lib_file: 'Connector_Generic', pin_count: 5, description: '5-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x05' },
  { name: 'Conn_01x06', lib_file: 'Connector_Generic', pin_count: 6, description: '6-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x06' },
  { name: 'Conn_01x08', lib_file: 'Connector_Generic', pin_count: 8, description: '8-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x08' },
  { name: 'Conn_01x10', lib_file: 'Connector_Generic', pin_count: 10, description: '10-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x10' },
  { name: 'Conn_01x16', lib_file: 'Connector_Generic', pin_count: 16, description: '16-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x16' },
  { name: 'Conn_01x20', lib_file: 'Connector_Generic', pin_count: 20, description: '20-pin connector', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_1x20' },
  { name: 'Conn_02x02', lib_file: 'Connector_Generic', pin_count: 4, description: '2x2 pin header', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x02' },
  { name: 'Conn_02x03', lib_file: 'Connector_Generic', pin_count: 6, description: '2x3 pin header (ISP)', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x03' },
  { name: 'Conn_02x04', lib_file: 'Connector_Generic', pin_count: 8, description: '2x4 pin header', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x04' },
  { name: 'Conn_02x05', lib_file: 'Connector_Generic', pin_count: 10, description: '2x5 pin header (JTAG)', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x05' },
  { name: 'Conn_02x10', lib_file: 'Connector_Generic', pin_count: 20, description: '2x10 pin header', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x10' },
  { name: 'Conn_02x20', lib_file: 'Connector_Generic', pin_count: 40, description: '2x20 pin header (RPi)', category: 'Connector_Generic', footprint_suggestion: 'PinHeader_2x20' },

  // ─── Connector USB ────────────────────────────────────────────────────────
  { name: 'USB_B_Micro', lib_file: 'Connector_USB', pin_count: 5, description: 'USB Micro-B receptacle', category: 'Connector_USB', footprint_suggestion: 'USB_Micro-B' },
  { name: 'USB_C_Receptacle', lib_file: 'Connector_USB', pin_count: 24, description: 'USB Type-C receptacle (full)', category: 'Connector_USB', footprint_suggestion: 'USB_C_Receptacle' },
  { name: 'USB_C_Receptacle_USB2.0', lib_file: 'Connector_USB', pin_count: 12, description: 'USB Type-C receptacle (USB 2.0)', category: 'Connector_USB', footprint_suggestion: 'USB_C_Receptacle' },
  { name: 'USB_A', lib_file: 'Connector_USB', pin_count: 4, description: 'USB Type-A plug', category: 'Connector_USB', footprint_suggestion: 'USB_A' },
  { name: 'USB_B_Mini', lib_file: 'Connector_USB', pin_count: 5, description: 'USB Mini-B receptacle', category: 'Connector_USB', footprint_suggestion: 'USB_Mini-B' },

  // ─── Connector_Audio ──────────────────────────────────────────────────────
  { name: 'AudioJack3', lib_file: 'Connector_Audio', pin_count: 3, description: '3.5mm TRS audio jack', category: 'Connector_Audio' },
  { name: 'AudioJack3_SwitchT', lib_file: 'Connector_Audio', pin_count: 5, description: '3.5mm TRS with switch', category: 'Connector_Audio' },

  // ─── Connector_Card ───────────────────────────────────────────────────────
  { name: 'SD_Card', lib_file: 'Connector_Card', pin_count: 9, description: 'SD card slot', category: 'Connector_Card' },
  { name: 'microSD_Card', lib_file: 'Connector_Card', pin_count: 8, description: 'MicroSD card slot', category: 'Connector_Card' },

  // ─── Amplifier_Operational ────────────────────────────────────────────────
  { name: 'LM358', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'Dual op-amp, low power', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'LM324', lib_file: 'Amplifier_Operational', pin_count: 14, description: 'Quad op-amp, low power', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-14' },
  { name: 'LM741', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'General purpose op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'NE5532', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'Low-noise dual op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'TL072', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'Low-noise JFET dual op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'OPA2134', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'High-perf audio dual op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'MCP6001', lib_file: 'Amplifier_Operational', pin_count: 5, description: '1MHz rail-to-rail op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOT-23-5' },
  { name: 'MCP6002', lib_file: 'Amplifier_Operational', pin_count: 8, description: '1MHz rail-to-rail dual op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'OPA340', lib_file: 'Amplifier_Operational', pin_count: 5, description: 'CMOS rail-to-rail op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOT-23-5' },
  { name: 'AD8605', lib_file: 'Amplifier_Operational', pin_count: 5, description: 'Precision CMOS op-amp', category: 'Amplifier_Operational', footprint_suggestion: 'SOT-23-5' },
  { name: 'INA219', lib_file: 'Amplifier_Operational', pin_count: 8, description: 'Current/power monitor I2C', category: 'Amplifier_Operational', footprint_suggestion: 'SOIC-8' },
  { name: 'INA226', lib_file: 'Amplifier_Operational', pin_count: 10, description: 'Current/power monitor I2C', category: 'Amplifier_Operational', footprint_suggestion: 'MSOP-10' },

  // ─── Transistor_FET ───────────────────────────────────────────────────────
  { name: 'AO3400A', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 30V 5.7A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'AO3401A', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -30V -4A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'SI2301CDS', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -20V -2.8A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'SI2302CDS', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 20V 2.6A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'IRF540N', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 100V 33A', category: 'Transistor_FET', footprint_suggestion: 'TO-220' },
  { name: 'IRF9540N', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -100V -23A', category: 'Transistor_FET', footprint_suggestion: 'TO-220' },
  { name: 'IRLZ44N', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 55V 47A logic-level', category: 'Transistor_FET', footprint_suggestion: 'TO-220' },
  { name: 'BSS138', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 50V 0.2A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'BSS84', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -50V -0.13A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: '2N7002', lib_file: 'Transistor_FET', pin_count: 3, description: 'N-ch MOSFET 60V 0.3A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'DMG2305UX', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -20V -4.2A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },
  { name: 'FDN340P', lib_file: 'Transistor_FET', pin_count: 3, description: 'P-ch MOSFET -20V -2A', category: 'Transistor_FET', footprint_suggestion: 'SOT-23' },

  // ─── Transistor_BJT ───────────────────────────────────────────────────────
  { name: '2N2222A', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN general purpose 40V 0.6A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: '2N3904', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN general purpose 40V 0.2A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: '2N3906', lib_file: 'Transistor_BJT', pin_count: 3, description: 'PNP general purpose -40V -0.2A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'BC547B', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN 45V 0.1A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'BC557B', lib_file: 'Transistor_BJT', pin_count: 3, description: 'PNP -45V -0.1A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'BC337-25', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN 45V 0.8A', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'MMBT3904', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN 40V 0.2A SMD', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'MMBT3906', lib_file: 'Transistor_BJT', pin_count: 3, description: 'PNP -40V -0.2A SMD', category: 'Transistor_BJT', footprint_suggestion: 'SOT-23' },
  { name: 'TIP120', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN Darlington 60V 5A', category: 'Transistor_BJT', footprint_suggestion: 'TO-220' },
  { name: 'TIP122', lib_file: 'Transistor_BJT', pin_count: 3, description: 'NPN Darlington 100V 5A', category: 'Transistor_BJT', footprint_suggestion: 'TO-220' },
  { name: 'TIP127', lib_file: 'Transistor_BJT', pin_count: 3, description: 'PNP Darlington -100V -5A', category: 'Transistor_BJT', footprint_suggestion: 'TO-220' },

  // ─── Logic / Interface ICs ────────────────────────────────────────────────
  { name: '74HC04', lib_file: 'Logic_74xx', pin_count: 14, description: 'Hex inverter', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC08', lib_file: 'Logic_74xx', pin_count: 14, description: 'Quad 2-input AND', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC14', lib_file: 'Logic_74xx', pin_count: 14, description: 'Hex Schmitt inverter', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC32', lib_file: 'Logic_74xx', pin_count: 14, description: 'Quad 2-input OR', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC74', lib_file: 'Logic_74xx', pin_count: 14, description: 'Dual D flip-flop', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC125', lib_file: 'Logic_74xx', pin_count: 14, description: 'Quad bus buffer tri-state', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC138', lib_file: 'Logic_74xx', pin_count: 16, description: '3-to-8 line decoder', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: '74HC164', lib_file: 'Logic_74xx', pin_count: 14, description: '8-bit shift register SIPO', category: 'Logic', footprint_suggestion: 'SOIC-14' },
  { name: '74HC245', lib_file: 'Logic_74xx', pin_count: 20, description: 'Octal bus transceiver', category: 'Logic', footprint_suggestion: 'SOIC-20' },
  { name: '74HC595', lib_file: 'Logic_74xx', pin_count: 16, description: '8-bit shift register SIPO + latch', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: '74HC4051', lib_file: 'Logic_74xx', pin_count: 16, description: '8:1 analog multiplexer', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: '74HC4052', lib_file: 'Logic_74xx', pin_count: 16, description: 'Dual 4:1 analog mux', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: '74HC4053', lib_file: 'Logic_74xx', pin_count: 16, description: 'Triple 2:1 analog mux', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: 'CD4017', lib_file: 'Logic_CMOS_4000', pin_count: 16, description: 'Decade counter/divider', category: 'Logic', footprint_suggestion: 'SOIC-16' },
  { name: 'CD4066', lib_file: 'Logic_CMOS_4000', pin_count: 14, description: 'Quad bilateral switch', category: 'Logic', footprint_suggestion: 'SOIC-14' },

  // ─── Communication / Interface ────────────────────────────────────────────
  { name: 'MAX232', lib_file: 'Interface_UART', pin_count: 16, description: 'Dual RS-232 driver/receiver', category: 'Interface', footprint_suggestion: 'SOIC-16' },
  { name: 'MAX485', lib_file: 'Interface_UART', pin_count: 8, description: 'RS-485 transceiver', category: 'Interface', footprint_suggestion: 'SOIC-8' },
  { name: 'SP3485EN', lib_file: 'Interface_UART', pin_count: 8, description: 'RS-485 transceiver 3.3V', category: 'Interface', footprint_suggestion: 'SOIC-8' },
  { name: 'CH340G', lib_file: 'Interface_USB', pin_count: 16, description: 'USB to UART bridge', category: 'Interface', footprint_suggestion: 'SOIC-16' },
  { name: 'CH340C', lib_file: 'Interface_USB', pin_count: 16, description: 'USB to UART (no crystal)', category: 'Interface', footprint_suggestion: 'SOIC-16' },
  { name: 'CP2102', lib_file: 'Interface_USB', pin_count: 28, description: 'USB to UART bridge', category: 'Interface', footprint_suggestion: 'QFN-28' },
  { name: 'FT232RL', lib_file: 'Interface_USB', pin_count: 28, description: 'USB to UART FTDI', category: 'Interface', footprint_suggestion: 'SSOP-28' },
  { name: 'MCP2515', lib_file: 'Interface_CAN', pin_count: 18, description: 'CAN controller SPI', category: 'Interface', footprint_suggestion: 'SOIC-18' },
  { name: 'MCP2551', lib_file: 'Interface_CAN', pin_count: 8, description: 'CAN transceiver', category: 'Interface', footprint_suggestion: 'SOIC-8' },
  { name: 'SN65HVD230', lib_file: 'Interface_CAN', pin_count: 8, description: 'CAN transceiver 3.3V', category: 'Interface', footprint_suggestion: 'SOIC-8' },
  { name: 'TXB0104', lib_file: 'Interface_LevelShift', pin_count: 14, description: '4-bit level translator', category: 'Interface', footprint_suggestion: 'SOIC-14' },
  { name: 'TXB0108', lib_file: 'Interface_LevelShift', pin_count: 20, description: '8-bit level translator', category: 'Interface', footprint_suggestion: 'TSSOP-20' },

  // ─── ADC / DAC ────────────────────────────────────────────────────────────
  { name: 'ADS1115', lib_file: 'Analog_ADC', pin_count: 10, description: '16-bit 4ch ADC I2C', category: 'Analog_ADC', footprint_suggestion: 'MSOP-10' },
  { name: 'MCP3008', lib_file: 'Analog_ADC', pin_count: 16, description: '10-bit 8ch ADC SPI', category: 'Analog_ADC', footprint_suggestion: 'SOIC-16' },
  { name: 'MCP3208', lib_file: 'Analog_ADC', pin_count: 16, description: '12-bit 8ch ADC SPI', category: 'Analog_ADC', footprint_suggestion: 'SOIC-16' },
  { name: 'MCP4725', lib_file: 'Analog_DAC', pin_count: 6, description: '12-bit DAC I2C', category: 'Analog_DAC', footprint_suggestion: 'SOT-23-6' },
  { name: 'MCP4822', lib_file: 'Analog_DAC', pin_count: 8, description: '12-bit dual DAC SPI', category: 'Analog_DAC', footprint_suggestion: 'SOIC-8' },

  // ─── Sensor / Temperature ─────────────────────────────────────────────────
  { name: 'DS18B20', lib_file: 'Sensor_Temperature', pin_count: 3, description: 'Digital temp sensor 1-Wire', category: 'Sensor', footprint_suggestion: 'TO-92' },
  { name: 'LM35', lib_file: 'Sensor_Temperature', pin_count: 3, description: 'Analog temp sensor', category: 'Sensor', footprint_suggestion: 'TO-92' },
  { name: 'TMP36', lib_file: 'Sensor_Temperature', pin_count: 3, description: 'Analog temp sensor', category: 'Sensor', footprint_suggestion: 'SOT-23' },
  { name: 'BME280', lib_file: 'Sensor_Pressure', pin_count: 8, description: 'Temp/humidity/pressure I2C/SPI', category: 'Sensor', footprint_suggestion: 'LGA-8' },
  { name: 'BMP280', lib_file: 'Sensor_Pressure', pin_count: 8, description: 'Pressure/temp sensor I2C/SPI', category: 'Sensor', footprint_suggestion: 'LGA-8' },
  { name: 'DHT22', lib_file: 'Sensor_Humidity', pin_count: 4, description: 'Temp/humidity sensor', category: 'Sensor' },
  { name: 'MPU6050', lib_file: 'Sensor_Motion', pin_count: 24, description: '6-axis IMU I2C', category: 'Sensor', footprint_suggestion: 'QFN-24' },
  { name: 'ADXL345', lib_file: 'Sensor_Motion', pin_count: 14, description: '3-axis accelerometer I2C/SPI', category: 'Sensor', footprint_suggestion: 'LGA-14' },

  // ─── Memory ───────────────────────────────────────────────────────────────
  { name: 'AT24C256', lib_file: 'Memory_EEPROM', pin_count: 8, description: '256Kbit EEPROM I2C', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: 'AT24C32', lib_file: 'Memory_EEPROM', pin_count: 8, description: '32Kbit EEPROM I2C', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: 'W25Q128JV', lib_file: 'Memory_Flash', pin_count: 8, description: '128Mbit SPI Flash', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: 'W25Q32JV', lib_file: 'Memory_Flash', pin_count: 8, description: '32Mbit SPI Flash', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: 'W25Q64JV', lib_file: 'Memory_Flash', pin_count: 8, description: '64Mbit SPI Flash', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: '23LC1024', lib_file: 'Memory_RAM', pin_count: 8, description: '1Mbit SPI SRAM', category: 'Memory', footprint_suggestion: 'SOIC-8' },
  { name: 'IS62WV12816BLL', lib_file: 'Memory_RAM', pin_count: 44, description: '2Mbit parallel SRAM', category: 'Memory', footprint_suggestion: 'TSOP-II-44' },

  // ─── Timer / Oscillator ───────────────────────────────────────────────────
  { name: 'NE555', lib_file: 'Timer', pin_count: 8, description: '555 timer', category: 'Timer', footprint_suggestion: 'SOIC-8' },
  { name: 'LM555', lib_file: 'Timer', pin_count: 8, description: '555 timer (TI)', category: 'Timer', footprint_suggestion: 'SOIC-8' },
  { name: 'TLC555', lib_file: 'Timer', pin_count: 8, description: 'CMOS 555 timer', category: 'Timer', footprint_suggestion: 'SOIC-8' },
  { name: 'DS1307', lib_file: 'Timer_RTC', pin_count: 8, description: 'RTC I2C', category: 'Timer', footprint_suggestion: 'SOIC-8' },
  { name: 'DS3231', lib_file: 'Timer_RTC', pin_count: 16, description: 'Precision RTC I2C TCXO', category: 'Timer', footprint_suggestion: 'SOIC-16' },
  { name: 'PCF8563', lib_file: 'Timer_RTC', pin_count: 8, description: 'RTC I2C low power', category: 'Timer', footprint_suggestion: 'SOIC-8' },

  // ─── Display driver ───────────────────────────────────────────────────────
  { name: 'SSD1306', lib_file: 'Display_Driver', pin_count: 30, description: 'OLED display driver 128x64 I2C', category: 'Display', footprint_suggestion: 'SSD1306_Module' },
  { name: 'MAX7219', lib_file: 'Display_Driver', pin_count: 24, description: '8-digit LED driver SPI', category: 'Display', footprint_suggestion: 'DIP-24' },
  { name: 'TM1637', lib_file: 'Display_Driver', pin_count: 18, description: 'LED driver (7-seg)', category: 'Display', footprint_suggestion: 'SOP-20' },
  { name: 'WS2812B', lib_file: 'LED_Driver', pin_count: 4, description: 'Addressable RGB LED (NeoPixel)', category: 'Display', footprint_suggestion: 'LED_WS2812B_5050' },
  { name: 'SK6812', lib_file: 'LED_Driver', pin_count: 4, description: 'Addressable RGBW LED', category: 'Display', footprint_suggestion: 'LED_SK6812_5050' },
  { name: 'TLC5940', lib_file: 'LED_Driver', pin_count: 28, description: '16-ch PWM LED driver', category: 'Display', footprint_suggestion: 'SSOP-28' },
  { name: 'PCA9685', lib_file: 'LED_Driver', pin_count: 28, description: '16-ch PWM I2C LED/servo driver', category: 'Display', footprint_suggestion: 'SSOP-28' },

  // ─── Motor driver ─────────────────────────────────────────────────────────
  { name: 'L293D', lib_file: 'Motor_Driver', pin_count: 16, description: 'Dual H-bridge motor driver', category: 'Motor_Driver', footprint_suggestion: 'DIP-16' },
  { name: 'L298N', lib_file: 'Motor_Driver', pin_count: 15, description: 'Dual H-bridge motor driver 2A', category: 'Motor_Driver', footprint_suggestion: 'Multiwatt-15' },
  { name: 'DRV8833', lib_file: 'Motor_Driver', pin_count: 16, description: 'Dual H-bridge 1.5A', category: 'Motor_Driver', footprint_suggestion: 'TSSOP-16' },
  { name: 'A4988', lib_file: 'Motor_Driver', pin_count: 16, description: 'Stepper motor driver', category: 'Motor_Driver', footprint_suggestion: 'QFN-28' },
  { name: 'DRV8825', lib_file: 'Motor_Driver', pin_count: 28, description: 'Stepper motor driver 2.5A', category: 'Motor_Driver', footprint_suggestion: 'HTSSOP-28' },
  { name: 'TMC2209', lib_file: 'Motor_Driver', pin_count: 28, description: 'Silent stepper driver UART', category: 'Motor_Driver', footprint_suggestion: 'QFN-28' },

  // ─── Power management ─────────────────────────────────────────────────────
  { name: 'TP4056', lib_file: 'Power_Management', pin_count: 8, description: 'Li-ion charger 1A', category: 'Power_Management', footprint_suggestion: 'SOIC-8' },
  { name: 'MCP73831', lib_file: 'Power_Management', pin_count: 5, description: 'Li-ion charger 500mA', category: 'Power_Management', footprint_suggestion: 'SOT-23-5' },
  { name: 'BQ24075', lib_file: 'Power_Management', pin_count: 20, description: 'Li-ion charger + power path', category: 'Power_Management', footprint_suggestion: 'QFN-20' },
  { name: 'TPS2113A', lib_file: 'Power_Management', pin_count: 8, description: 'Power mux auto-switching', category: 'Power_Management', footprint_suggestion: 'SOIC-8' },
  { name: 'MAX17043', lib_file: 'Power_Management', pin_count: 8, description: 'Li-ion fuel gauge I2C', category: 'Power_Management', footprint_suggestion: 'TDFN-8' },
  { name: 'LTC4054', lib_file: 'Power_Management', pin_count: 5, description: 'Li-ion charger 800mA', category: 'Power_Management', footprint_suggestion: 'SOT-23-5' },

  // ─── Audio ────────────────────────────────────────────────────────────────
  { name: 'LM386', lib_file: 'Amplifier_Audio', pin_count: 8, description: 'Low-voltage audio amplifier', category: 'Audio', footprint_suggestion: 'SOIC-8' },
  { name: 'PAM8403', lib_file: 'Amplifier_Audio', pin_count: 16, description: 'Class-D stereo 3W amplifier', category: 'Audio', footprint_suggestion: 'SOP-16' },
  { name: 'TPA3116D2', lib_file: 'Amplifier_Audio', pin_count: 32, description: 'Class-D stereo 50W amplifier', category: 'Audio', footprint_suggestion: 'HTSSOP-32' },
  { name: 'MAX9814', lib_file: 'Amplifier_Audio', pin_count: 14, description: 'Mic amplifier with AGC', category: 'Audio', footprint_suggestion: 'TSSOP-14' },

  // ─── Optocoupler ──────────────────────────────────────────────────────────
  { name: 'PC817', lib_file: 'Isolator_Optocoupler', pin_count: 4, description: 'Optocoupler', category: 'Isolator', footprint_suggestion: 'DIP-4' },
  { name: '6N137', lib_file: 'Isolator_Optocoupler', pin_count: 8, description: 'High-speed optocoupler', category: 'Isolator', footprint_suggestion: 'DIP-8' },
  { name: 'TLP281', lib_file: 'Isolator_Optocoupler', pin_count: 4, description: 'Optocoupler phototransistor', category: 'Isolator', footprint_suggestion: 'SOP-4' },
  { name: 'ADUM1201', lib_file: 'Isolator_Digital', pin_count: 8, description: 'Digital isolator dual', category: 'Isolator', footprint_suggestion: 'SOIC-8' },
  { name: 'ADUM1401', lib_file: 'Isolator_Digital', pin_count: 16, description: 'Digital isolator quad', category: 'Isolator', footprint_suggestion: 'SOIC-16' },

  // ─── Voltage Reference ────────────────────────────────────────────────────
  { name: 'REF3030', lib_file: 'Reference_Voltage', pin_count: 3, description: '3.0V precision voltage reference', category: 'Reference', footprint_suggestion: 'SOT-23' },
  { name: 'REF3033', lib_file: 'Reference_Voltage', pin_count: 3, description: '3.3V precision voltage reference', category: 'Reference', footprint_suggestion: 'SOT-23' },
  { name: 'LM4040', lib_file: 'Reference_Voltage', pin_count: 2, description: 'Shunt voltage reference', category: 'Reference', footprint_suggestion: 'SOT-23' },
  { name: 'TL431', lib_file: 'Reference_Voltage', pin_count: 3, description: 'Adjustable shunt reference', category: 'Reference', footprint_suggestion: 'SOT-23' },

  // ─── Switch / Button ──────────────────────────────────────────────────────
  { name: 'SW_Push', lib_file: 'Switch', pin_count: 2, description: 'Push button', category: 'Switch' },
  { name: 'SW_DPDT', lib_file: 'Switch', pin_count: 6, description: 'DPDT switch', category: 'Switch' },
  { name: 'SW_SPDT', lib_file: 'Switch', pin_count: 3, description: 'SPDT switch', category: 'Switch' },
  { name: 'SW_DIP_x04', lib_file: 'Switch', pin_count: 8, description: '4-position DIP switch', category: 'Switch' },
  { name: 'SW_Rotary_Encoder', lib_file: 'Switch', pin_count: 5, description: 'Rotary encoder with push', category: 'Switch' },

  // ─── Power symbols ────────────────────────────────────────────────────────
  { name: 'GND', lib_file: 'power', pin_count: 1, description: 'Ground', category: 'Power' },
  { name: 'VCC', lib_file: 'power', pin_count: 1, description: 'VCC power symbol', category: 'Power' },
  { name: 'VDD', lib_file: 'power', pin_count: 1, description: 'VDD power symbol', category: 'Power' },
  { name: '+3V3', lib_file: 'power', pin_count: 1, description: '3.3V power rail', category: 'Power' },
  { name: '+5V', lib_file: 'power', pin_count: 1, description: '5V power rail', category: 'Power' },
  { name: '+12V', lib_file: 'power', pin_count: 1, description: '12V power rail', category: 'Power' },
  { name: '+3.3VA', lib_file: 'power', pin_count: 1, description: '3.3V analog rail', category: 'Power' },
  { name: 'VBUS', lib_file: 'power', pin_count: 1, description: 'USB bus voltage', category: 'Power' },
  { name: 'GNDA', lib_file: 'power', pin_count: 1, description: 'Analog ground', category: 'Power' },
  { name: 'GNDD', lib_file: 'power', pin_count: 1, description: 'Digital ground', category: 'Power' },
  { name: 'PWR_FLAG', lib_file: 'power', pin_count: 1, description: 'Power flag (ERC)', category: 'Power' },

  // ─── Test Points / Mechanical ─────────────────────────────────────────────
  { name: 'TestPoint', lib_file: 'Mechanical', pin_count: 1, description: 'Test point', category: 'Mechanical', footprint_suggestion: 'TestPoint_Pad_1mm' },
  { name: 'MountingHole', lib_file: 'Mechanical', pin_count: 0, description: 'Mounting hole', category: 'Mechanical', footprint_suggestion: 'MountingHole_3.2mm' },
  { name: 'MountingHole_Pad', lib_file: 'Mechanical', pin_count: 1, description: 'Mounting hole with pad', category: 'Mechanical', footprint_suggestion: 'MountingHole_3.2mm_Pad' },
  { name: 'Fiducial', lib_file: 'Mechanical', pin_count: 0, description: 'Fiducial marker', category: 'Mechanical', footprint_suggestion: 'Fiducial_1mm' },

  // ─── Wireless / RF ────────────────────────────────────────────────────────
  { name: 'RFM95W', lib_file: 'RF_Module', pin_count: 16, description: 'LoRa transceiver 868/915MHz', category: 'RF', footprint_suggestion: 'RFM95W' },
  { name: 'nRF24L01_Breakout', lib_file: 'RF_Module', pin_count: 8, description: '2.4GHz transceiver module', category: 'RF' },
  { name: 'CC1101', lib_file: 'RF_Transceiver', pin_count: 20, description: 'Sub-GHz transceiver', category: 'RF', footprint_suggestion: 'QFN-20' },
  { name: 'SX1276', lib_file: 'RF_LoRa', pin_count: 28, description: 'LoRa transceiver SPI', category: 'RF', footprint_suggestion: 'QFN-28' },

  // ─── ESD Protection ───────────────────────────────────────────────────────
  { name: 'USBLC6-2SC6', lib_file: 'ESD_Protection', pin_count: 6, description: 'USB ESD protection', category: 'ESD_Protection', footprint_suggestion: 'SOT-23-6' },
  { name: 'PRTR5V0U2X', lib_file: 'ESD_Protection', pin_count: 4, description: 'USB ESD protection', category: 'ESD_Protection', footprint_suggestion: 'SOT-143' },
  { name: 'TPD4E05U06', lib_file: 'ESD_Protection', pin_count: 6, description: '4-ch ESD protection', category: 'ESD_Protection', footprint_suggestion: 'SOT-23-6' },
  { name: 'SP0503BAHT', lib_file: 'ESD_Protection', pin_count: 4, description: '3-ch ESD protection', category: 'ESD_Protection', footprint_suggestion: 'SOT-143' },

  // ─── Crypto / Security ────────────────────────────────────────────────────
  { name: 'ATECC608A', lib_file: 'Security_Crypto', pin_count: 8, description: 'Crypto authentication IC I2C', category: 'Security', footprint_suggestion: 'SOIC-8' },
  { name: 'DS2401', lib_file: 'Security_ID', pin_count: 3, description: 'Silicon serial number 1-Wire', category: 'Security', footprint_suggestion: 'SOT-23' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Get unique category names from the index */
export function getKicadCategories(): string[] {
  const cats = new Set(KICAD_LIBRARY_INDEX.map(e => e.category));
  return Array.from(cats).sort();
}

/** Get total number of indexed components */
export function getKicadIndexSize(): number {
  return KICAD_LIBRARY_INDEX.length;
}

/** Search the local KiCad index by query string */
export function searchKicadIndex(query: string, limit = 40): KicadIndexEntry[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  return KICAD_LIBRARY_INDEX
    .filter(entry => {
      const text = `${entry.name} ${entry.description} ${entry.category} ${entry.lib_file}`.toLowerCase();
      return tokens.every(tok => text.includes(tok));
    })
    .slice(0, limit);
}
