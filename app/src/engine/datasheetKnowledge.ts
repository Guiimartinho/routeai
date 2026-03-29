// ─── Datasheet Knowledge Base ─────────────────────────────────────────────
// Pre-built knowledge base of IC support component requirements.
// All values are sourced from real datasheets and application notes.
// This does NOT use LLM in real-time — it is a static lookup table.

export interface SupportComponent {
  role: string;          // "bypass_cap", "bulk_cap", "crystal", "load_cap", "series_resistor", "pull_up", "pull_down", "esd_protection", "filter_cap", "inductor", "feedback_divider", "bootstrap_cap"
  symbol: string;        // symbol type from SymbolLibrary: "capacitor", "resistor", "crystal", "inductor", "diode", etc.
  value: string;         // "100nF", "10K", "8MHz"
  footprint: string;     // "C_0402", "R_0402", "Crystal_3225"
  quantity: number;
  perPin?: string;       // "VDD" = one per VDD pin, "all" = one total
  maxDistance_mm?: number; // max distance from IC (for bypass: 2mm)
  reason: string;        // "Datasheet Section 6.1: Each VDD pin requires 100nF bypass"
  pinRef?: string;       // which pin this relates to: "VDD", "HSE_IN", "NRST", "USB_D+", etc.
  placement?: string;    // "close_to_ic", "edge", "between_connector_and_ic"
}

export interface ICKnowledge {
  patterns: string[];       // regex patterns to match component value
  manufacturer: string;
  type: string;            // "mcu", "regulator", "sensor", "connector", "transceiver", "memory", etc.
  powerPins: string[];     // ["VDD", "VDDA", "VBAT"]
  supportComponents: SupportComponent[];
  designNotes: string[];   // general notes shown to user
}

export const IC_KNOWLEDGE_BASE: ICKnowledge[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // STM32F0/F1/F3 series (e.g., STM32F103C8T6, STM32F030F4P6, STM32F303RE)
  // Ref: AN4206, DS5319 (F103), DS9773 (F030), DS9118 (F303)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['STM32F0.*', 'STM32F1.*', 'STM32F3.*'],
    manufacturer: 'STMicroelectronics',
    type: 'mcu',
    powerPins: ['VDD', 'VDDA', 'VBAT'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDD', maxDistance_mm: 2,
        reason: 'AN4206 Section 5.1: Place one 100nF ceramic (X7R or X5R) on each VDD pin, as close as possible',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDDA', maxDistance_mm: 2,
        reason: 'AN4206: 100nF ceramic on VDDA for analog reference stability',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '4.7uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'AN4206 Section 5.1: 4.7uF bulk decoupling capacitor near VDD cluster',
        placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AN4206: 1uF additional filter capacitor on VDDA',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '8MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'DS5319 Section 6.2.4: HSE oscillator, 4-16 MHz crystal. Place close to OSC_IN/OSC_OUT',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '20pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors (C0G/NP0). CL = 2*(Cload - Cstray). For 20pF crystal load with 5pF stray: ~20pF per cap',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'DS5319 Section 6.1: NRST pin filter capacitor, 100nF to ground',
        pinRef: 'NRST', placement: 'close_to_ic',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'AN2606: BOOT0 pin pull-down to GND for boot from Flash (default mode)',
        pinRef: 'BOOT0', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'Place bypass caps as close as possible to VDD pins (< 2mm), with short vias to ground plane',
      'Route VDD traces short and wide; connect caps directly to GND plane via',
      'Crystal traces should be short and guarded; avoid routing other signals near OSC_IN/OSC_OUT',
      'VDDA should have its own filtering (ferrite bead + cap) if ADC precision > 10-bit is needed',
      'Keep BOOT0 pulled low via 10K unless ISP programming is needed',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STM32F4 series (e.g., STM32F401, STM32F407, STM32F411, STM32F446)
  // Ref: AN4488, DS10086 (F407), DS10693 (F411)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['STM32F4.*'],
    manufacturer: 'STMicroelectronics',
    type: 'mcu',
    powerPins: ['VDD', 'VDDA', 'VBAT', 'VCAP1', 'VCAP2'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDD', maxDistance_mm: 2,
        reason: 'AN4488: 100nF ceramic (X7R) on each VDD pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AN4488: 100nF ceramic on VDDA',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '4.7uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'AN4488: 4.7uF bulk capacitor near VDD power input',
        placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AN4488: 1uF filter on VDDA for ADC/DAC reference',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '2.2uF', footprint: 'C_0805',
        quantity: 1, perPin: 'VCAP',
        reason: 'DS10086 Section 6.1.6: 2.2uF low-ESR ceramic on each VCAP pin (internal regulator output). CRITICAL: Do not omit!',
        pinRef: 'VCAP1', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'VBAT bypass capacitor, 100nF ceramic',
        pinRef: 'VBAT', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '8MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'HSE oscillator, 4-26 MHz. Typical: 8MHz for USB (PLL to 48MHz). Place close to OSC_IN/OSC_OUT',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '20pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors (C0G/NP0). Calculate from crystal datasheet CL spec',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'NRST pin filter capacitor per AN4488',
        pinRef: 'NRST', placement: 'close_to_ic',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'BOOT0 pull-down for boot from Flash',
        pinRef: 'BOOT0', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'VCAP pins MUST have 2.2uF ceramic caps — omitting them can damage the internal regulator',
      'STM32F4 has up to 2 VCAP pins (100-pin+ packages). Check your specific package pinout',
      'For USB: 8MHz HSE crystal with PLL configured to output 48MHz USB clock',
      'F407/F429 in LQFP144: 5 VDD pins, each needs its own 100nF bypass',
      'VDDA ferrite bead recommended for ADC accuracy better than 10 bits',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STM32F7 series (e.g., STM32F746, STM32F767)
  // Ref: AN4661, DS11532
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['STM32F7.*'],
    manufacturer: 'STMicroelectronics',
    type: 'mcu',
    powerPins: ['VDD', 'VDDA', 'VBAT', 'VCAP1'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDD', maxDistance_mm: 2,
        reason: 'AN4661: 100nF ceramic on each VDD pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AN4661: 100nF on VDDA',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '4.7uF', footprint: 'C_0805',
        quantity: 2,
        reason: 'AN4661: Two 4.7uF bulk caps near VDD input cluster',
        placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '2.2uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'DS11532: 2.2uF ceramic on VCAP1 (internal voltage regulator). Mandatory',
        pinRef: 'VCAP1', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '25MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'HSE oscillator for Ethernet/USB, typically 25MHz for STM32F7 with Ethernet',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '20pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors (C0G/NP0)',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'NRST pin filter capacitor',
        pinRef: 'NRST', placement: 'close_to_ic',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'BOOT0 pull-down to GND',
        pinRef: 'BOOT0', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'STM32F7 requires VCAP1 capacitor — do not omit',
      'For Ethernet PHY: use 25MHz crystal and consider dedicated 3.3VA supply',
      'L1 cache means flash wait states less critical, but power supply integrity is paramount',
      'PDR_ON pin: connect to VDD for normal operation or use external supervisor for brown-out',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STM32H7 series (e.g., STM32H743, STM32H750, STM32H723)
  // Ref: AN5293, DS12110 (H743)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['STM32H7.*'],
    manufacturer: 'STMicroelectronics',
    type: 'mcu',
    powerPins: ['VDD', 'VDDA', 'VBAT', 'VCAP1', 'VCAP2', 'VDD33USB', 'VDDLDO'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDD', maxDistance_mm: 2,
        reason: 'AN5293: 100nF ceramic on each VDD pin. H743 LQFP144 has 6 VDD pins',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AN5293: 100nF ceramic on VDDA',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '4.7uF', footprint: 'C_0805',
        quantity: 2,
        reason: 'AN5293: 4.7uF bulk decoupling near VDD cluster, use two for high-freq supply stability',
        placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '2.2uF', footprint: 'C_0805',
        quantity: 2,
        reason: 'AN5293 Section 4.3: 2.2uF on VCAP1 and VCAP2 pins (SMPS/LDO regulator output). Both mandatory',
        pinRef: 'VCAP', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'VDDA filter: 1uF + ferrite bead for ADC/DAC reference',
        pinRef: 'VDDA', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '25MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'HSE oscillator. H7 runs at up to 480MHz via PLL; 25MHz common for Ethernet',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '20pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors (C0G/NP0)',
        pinRef: 'OSC_IN', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'NRST pin filter capacitor per AN5293',
        pinRef: 'NRST', placement: 'close_to_ic',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'BOOT0 pull-down for boot from Flash',
        pinRef: 'BOOT0', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '1uH', footprint: 'L_1210',
        quantity: 1,
        reason: 'AN5293: SMPS inductor for H7 integrated switching regulator, 1uH ± 30%, DCR < 100mOhm',
        pinRef: 'VDDSMPS', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'H7 has internal SMPS regulator — requires external inductor on VDDSMPS pin',
      'VCAP1 and VCAP2 MUST have 2.2uF caps — damage to internal regulator if missing',
      'Power domain partitioning: VDD (digital), VDDA (analog), VDD33USB (USB), VBAT (RTC)',
      'For SMPS mode: connect inductor between VDDSMPS and VSW, with output cap on VDDSMPS',
      'H7 in LQFP144: up to 6 VDD pins, each needs 100nF. Check your specific pinout',
      'Consider using external 1.2V supply instead of internal LDO for better efficiency',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ESP32-WROOM-32E / ESP32-WROVER (module, not bare die)
  // Ref: ESP32-WROOM-32E Datasheet v1.3, ESP32 Hardware Design Guidelines v3.5
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['ESP32.*WROOM.*', 'ESP32.*WROVER.*', 'ESP32-S3.*', 'ESP32$', 'ESP32-D.*', 'ESP32-PICO.*'],
    manufacturer: 'Espressif',
    type: 'mcu',
    powerPins: ['3V3', 'EN'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 3,
        reason: 'ESP32 HW Design Guide Section 2.2: 100nF ceramic bypass on 3V3 pin',
        pinRef: '3V3', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'ESP32 HW Design Guide: 10uF bulk cap on 3V3 for Wi-Fi TX current spikes (up to 500mA)',
        pinRef: '3V3', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'EN (Chip Enable) pin: 100nF cap to ground for noise filtering and power-on reset delay',
        pinRef: 'EN', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'EN pin pull-up to 3V3 (required for reliable startup)',
        pinRef: 'EN', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'GPIO0 pull-up to 3V3 (strapping pin: HIGH=normal boot, LOW=download mode)',
        pinRef: 'GPIO0', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'GPIO2 must be LOW during boot (strapping pin). Pull-down or leave floating for WROOM modules',
        pinRef: 'GPIO2', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'ESP32-WROOM module includes internal crystal, flash, and antenna — no external crystal needed',
      'Keep antenna area clear: no copper pour, traces, or components under or near the antenna',
      'Wi-Fi TX can draw 500mA peaks — ensure 3V3 supply can handle transients',
      'Strapping pins (GPIO0, GPIO2, GPIO12, GPIO15) must be at correct levels during boot',
      'For auto-programming: use DTR/RTS from USB-UART to toggle EN and GPIO0',
      'GPIO12 (MTDI) controls flash voltage — leave floating or pull LOW for 3.3V flash',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RP2040 (Raspberry Pi microcontroller)
  // Ref: RP2040 Datasheet (Section 2.9 "Hardware Design"), RP2040 Minimal Design Example
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['RP2040'],
    manufacturer: 'Raspberry Pi',
    type: 'mcu',
    powerPins: ['IOVDD', 'DVDD', 'VREG_VIN', 'VREG_VOUT', 'USB_VDD', 'ADC_AVDD'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 3,
        reason: 'RP2040 DS Section 2.9.3: 100nF on each IOVDD pin (3 pairs)',
        pinRef: 'IOVDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'RP2040 DS: 100nF on DVDD (digital core 1.1V from internal regulator)',
        pinRef: 'DVDD', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'RP2040 DS: 1uF on VREG_VOUT (internal regulator 1.1V output)',
        pinRef: 'VREG_VOUT', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'RP2040 DS: 100nF on USB_VDD',
        pinRef: 'USB_VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'RP2040 DS: 100nF on ADC_AVDD (analog supply)',
        pinRef: 'ADC_AVDD', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '12MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'RP2040 DS Section 2.9.4: 12MHz crystal on XIN/XOUT. PLL generates 125MHz system clock',
        pinRef: 'XIN', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '15pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'RP2040 minimal design: 15pF load caps for 12MHz crystal (C0G/NP0)',
        pinRef: 'XIN', placement: 'close_to_ic',
      },
      {
        role: 'series_resistor', symbol: 'resistor', value: '1K', footprint: 'R_0402',
        quantity: 1,
        reason: 'RP2040 DS: 1K series resistor on XIN for crystal drive level limiting',
        pinRef: 'XIN', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '27R', footprint: 'R_0402',
        quantity: 2,
        reason: 'RP2040 DS Section 2.9.5: 27 ohm series resistors on USB_D+ and USB_D- (USB impedance matching)',
        pinRef: 'USB_D+', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'RP2040 requires external flash (QSPI) — see W25Q128 entry for flash support components',
      'Internal voltage regulator outputs 1.1V on VREG_VOUT; connect DVDD to VREG_VOUT via 1uF',
      '12MHz crystal is the standard; PLL multiplies to 125MHz (or 133MHz max)',
      'For USB: 27 ohm series resistors on D+/D-, connect USB_VDD to VBUS through regulator',
      'Flash chip (W25Q16 minimum) connects via QSPI: SCLK, SS, SD0-SD3',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ATmega328P (Arduino Uno MCU)
  // Ref: ATmega328P Datasheet (DS40002061B)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['ATmega328P.*', 'ATMEGA328P.*', 'ATmega328$'],
    manufacturer: 'Microchip',
    type: 'mcu',
    powerPins: ['VCC', 'AVCC', 'AREF'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'DS40002061B Section 31.4: 100nF between VCC and GND, placed close to pin',
        pinRef: 'VCC', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'DS40002061B Section 31.4: 100nF between AVCC and GND',
        pinRef: 'AVCC', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '10uH', footprint: 'L_0805',
        quantity: 1,
        reason: 'DS40002061B Section 31.4: AVCC should be connected to VCC through 10uH inductor for ADC noise filtering',
        pinRef: 'AVCC', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AREF pin: 100nF bypass cap if external reference not used',
        pinRef: 'AREF', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '16MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'External crystal for full-speed operation (up to 20MHz at 5V). 16MHz standard for Arduino',
        pinRef: 'XTAL1', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '22pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors: 22pF C0G/NP0 for 16MHz crystal with typical 8pF stray capacitance',
        pinRef: 'XTAL1', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'RESET pin pull-up to VCC (internal pull-up is weak ~30-60K). Required for noise immunity',
        pinRef: 'RESET', placement: 'close_to_ic',
      },
      {
        role: 'filter_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'RESET pin: 100nF to GND for noise filtering (optional but recommended)',
        pinRef: 'RESET', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'AVCC must always be connected, even if ADC is not used — it powers Port C I/O',
      'Use 10uH inductor between VCC and AVCC for analog accuracy',
      'Internal 8MHz RC oscillator available if crystal is not needed (lower accuracy)',
      'For ISP programming: keep RESET, MOSI, MISO, SCK accessible',
      'ATmega328P max clock: 20MHz at 5V, 10MHz at 3.3V (see speed grade)',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // nRF52840 (Nordic Semiconductor BLE SoC)
  // Ref: nRF52840 Product Specification v1.7 (Section 17 "GPIO and pin assignment")
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['nRF52840.*', 'NRF52840.*'],
    manufacturer: 'Nordic Semiconductor',
    type: 'mcu',
    powerPins: ['VDD', 'VDDH', 'DCC', 'DCCH', 'VBUS', 'DECUSB'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, perPin: 'VDD', maxDistance_mm: 2,
        reason: 'nRF52840 PS Section 53.1: 100nF decoupling on each VDD pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'nRF52840 PS: 100nF on VDDH (high-voltage input)',
        pinRef: 'VDDH', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '4.7uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'nRF52840 PS: 4.7uF bulk cap near VDDH pin',
        pinRef: 'VDDH', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '10uH', footprint: 'L_0805',
        quantity: 1,
        reason: 'nRF52840 PS Section 53.2: 10uH inductor on DCC pin (DC-DC converter). Use shielded inductor, DCR < 0.5 ohm',
        pinRef: 'DCC', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'nRF52840 PS: 1uF on DCC output (DC-DC regulator output cap)',
        pinRef: 'DCC', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '10uH', footprint: 'L_0805',
        quantity: 1,
        reason: 'nRF52840 PS: 10uH inductor on DCCH pin (high-voltage DC-DC)',
        pinRef: 'DCCH', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'nRF52840 PS: 1uF on DECUSB pin (USB LDO decoupling)',
        pinRef: 'DECUSB', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '32MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'nRF52840 PS: 32MHz crystal on XC1/XC2 for BLE radio. Tolerance ±40ppm',
        pinRef: 'XC1', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '12pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load caps for 32MHz crystal (C0G/NP0). Value depends on crystal CL spec',
        pinRef: 'XC1', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'ANT matching network: 100nF DC block for antenna (application-specific)',
        pinRef: 'ANT', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'nRF52840 has integrated DC-DC converter — use 10uH shielded inductor for best efficiency',
      'If DC-DC not used, DCC can be connected to VDD directly (LDO mode, higher power consumption)',
      'BLE antenna matching network: follow Nordic reference design for your antenna type',
      'Crystal load caps: check your specific crystal datasheet for CL requirement',
      'USB: nRF52840 has integrated voltage regulator for USB — VBUS connects to USB 5V, DECUSB needs 1uF',
      'For QSPI flash: add W25Q128 or similar with 100nF bypass',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AP2112K-3.3 (3.3V LDO Regulator, 600mA)
  // Ref: AP2112 Datasheet (Diodes Inc)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['AP2112.*', 'AP2112K.*'],
    manufacturer: 'Diodes Incorporated',
    type: 'regulator',
    powerPins: ['VIN', 'VOUT', 'EN'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AP2112 DS: 1uF minimum input capacitor, ceramic X5R/X7R. Place close to VIN-GND',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '1uF', footprint: 'C_0402',
        quantity: 1,
        reason: 'AP2112 DS: 1uF minimum output capacitor for stability, ceramic X5R/X7R',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '100K', footprint: 'R_0402',
        quantity: 1,
        reason: 'EN pin pull-up to VIN if enable control not needed (AP2112K has internal pull-up, but external recommended for reliability)',
        pinRef: 'EN', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'AP2112K: K variant has enable pin, non-K variant is always-on',
      'Input cap: place as close as possible to VIN pin. Ceramic 1uF minimum, 10uF for better transient response',
      'Output cap: 1uF minimum for stability. Larger values improve transient response',
      'Max input voltage: 6V. Dropout voltage: ~250mV at 600mA',
      'Thermal pad (if present) must be soldered to PCB ground plane for heat dissipation',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AMS1117-3.3 (3.3V LDO Regulator, 1A)
  // Ref: AMS1117 Datasheet (Advanced Monolithic Systems)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['AMS1117.*', 'LM1117.*', 'LD1117.*'],
    manufacturer: 'Advanced Monolithic Systems',
    type: 'regulator',
    powerPins: ['VIN', 'VOUT', 'ADJ/GND'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_1206',
        quantity: 1,
        reason: 'AMS1117 DS: 10uF tantalum or 10uF ceramic (X5R/X7R) on input. Tantalum recommended for ESR requirements',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '22uF', footprint: 'C_1206',
        quantity: 1,
        reason: 'AMS1117 DS: 22uF tantalum on output REQUIRED for stability. ESR 0.1-0.5 ohm range critical. Or use 22uF ceramic + 1 ohm series resistor',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'AMS1117 REQUIRES output capacitor with specific ESR range (0.1-0.5 ohm) for stability',
      'Tantalum or aluminum polymer caps recommended for output (ceramic alone may oscillate)',
      'If using ceramic output cap: add 1-2 ohm series resistor to increase effective ESR',
      'Dropout voltage: 1.1V at 1A — needs VIN >= 4.4V for 3.3V output at full load',
      'SOT-223 package: center pad is VOUT, connect to large copper area for heat dissipation',
      'Maximum input voltage: 15V. Include input protection if powered from unregulated supply',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TPS54331 (3.5-28V Input, 3A Step-Down Converter)
  // Ref: TPS54331 Datasheet (SLVSA30G), Application Note SLVA477
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['TPS54331.*'],
    manufacturer: 'Texas Instruments',
    type: 'regulator',
    powerPins: ['VIN', 'BOOT', 'PH', 'VSENSE', 'COMP', 'EN'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_1206',
        quantity: 2,
        reason: 'TPS54331 DS Section 9.2.2: Two 10uF ceramic (X7R, 50V rated) on VIN. Handle input ripple current',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'TPS54331 DS: Additional 100nF ceramic close to VIN-GND for high-frequency bypass',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bootstrap_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'TPS54331 DS Section 9.2.3: 100nF ceramic on BOOT pin to PH pin (bootstrap capacitor for high-side driver)',
        pinRef: 'BOOT', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '15uH', footprint: 'L_1210',
        quantity: 1,
        reason: 'TPS54331 DS: Output inductor. 15uH for 3.3V/3A from 12V. Select based on: L = (VIN-VOUT)*VOUT/(VIN*fsw*deltaIL)',
        pinRef: 'PH', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '47uF', footprint: 'C_1210',
        quantity: 2,
        reason: 'TPS54331 DS: Output capacitors. Two 47uF ceramic (X5R/X7R) for output filtering. Low ESR critical',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'TPS54331 DS: 100nF output capacitor for high-frequency noise',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
      {
        role: 'feedback_divider', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'TPS54331: Upper feedback resistor. VOUT = 0.8V * (1 + R_top/R_bot). For 3.3V: R_top=31.6K, R_bot=10K',
        pinRef: 'VSENSE', placement: 'close_to_ic',
      },
      {
        role: 'feedback_divider', symbol: 'resistor', value: '31.6K', footprint: 'R_0402',
        quantity: 1,
        reason: 'TPS54331: Lower feedback resistor (top of divider). VOUT = 0.8V * (1 + 31.6K/10K) = 3.328V',
        pinRef: 'VSENSE', placement: 'close_to_ic',
      },
      {
        role: 'series_resistor', symbol: 'resistor', value: '100K', footprint: 'R_0402',
        quantity: 1,
        reason: 'TPS54331 DS: EN pin pull-up or voltage divider for UVLO threshold setting',
        pinRef: 'EN', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'diode', value: 'SS340', footprint: 'SMA',
        quantity: 1,
        reason: 'TPS54331 DS: Schottky catch diode (3A, 40V). SMA package. Cathode to PH, anode to GND',
        pinRef: 'PH', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'TPS54331 is asynchronous (external diode) — use low-Vf Schottky (SS340 or equivalent)',
      'Input caps: use X7R ceramic rated for at least 2x VIN. Avoid Y5V — they lose capacitance under DC bias',
      'Output inductor: shielded type recommended. DCR affects efficiency. Saturation current > max load',
      'PCB layout critical: keep SW node (PH) area small, use short wide traces for power path',
      'Feedback divider: place close to VSENSE pin. Route away from SW node',
      'Compensation: COMP pin may need RC network — use TI WEBENCH for optimal values',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MP2315 (4.5-24V Input, 3A Step-Down Converter, integrated FETs)
  // Ref: MP2315 Datasheet (Monolithic Power Systems)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['MP2315.*', 'MP2315S.*'],
    manufacturer: 'Monolithic Power Systems',
    type: 'regulator',
    powerPins: ['VIN', 'BST', 'SW', 'FB', 'EN'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'MP2315 DS: 10uF input capacitor (X5R/X7R, rated > VIN_max). Place close to VIN-GND',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'MP2315 DS: 100nF additional high-frequency bypass on VIN',
        pinRef: 'VIN', placement: 'close_to_ic',
      },
      {
        role: 'bootstrap_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'MP2315 DS: 100nF bootstrap capacitor on BST pin to SW pin',
        pinRef: 'BST', placement: 'close_to_ic',
      },
      {
        role: 'inductor', symbol: 'inductor', value: '4.7uH', footprint: 'L_1008',
        quantity: 1,
        reason: 'MP2315 DS: 4.7uH inductor for 3.3V output. Shielded, Isat > 4A, DCR < 50mOhm',
        pinRef: 'SW', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '22uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'MP2315 DS: 22uF output capacitor, ceramic X5R/X7R',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'MP2315 DS: additional 100nF output cap for high-frequency filtering',
        pinRef: 'VOUT', placement: 'close_to_ic',
      },
      {
        role: 'feedback_divider', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'MP2315: Bottom feedback resistor. VOUT = 0.6V * (1 + R_top/R_bot). For 3.3V: R_top=45.3K, R_bot=10K',
        pinRef: 'FB', placement: 'close_to_ic',
      },
      {
        role: 'feedback_divider', symbol: 'resistor', value: '45.3K', footprint: 'R_0402',
        quantity: 1,
        reason: 'MP2315: Top feedback resistor for 3.3V output',
        pinRef: 'FB', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '100K', footprint: 'R_0402',
        quantity: 1,
        reason: 'EN pin pull-up to VIN (or connect directly to VIN for always-on)',
        pinRef: 'EN', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'MP2315 has integrated MOSFETs (synchronous) — no external diode needed',
      'Keep SW node trace short and away from sensitive signals — it is the main EMI source',
      'PCB layout: minimize loop area of VIN cap, IC, and SW node',
      'Inductor: shielded type strongly recommended for EMI. Ferrite core preferred for efficiency',
      'Feedback resistors: place close to FB pin, route away from SW node',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // USB-C Connector (Type-C receptacle)
  // Ref: USB Type-C Specification v2.1, Section 4.5
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['USB[-_]?C.*', 'USB.*Type[-_]?C.*', 'TYPE[-_]?C.*'],
    manufacturer: 'Various',
    type: 'connector',
    powerPins: ['VBUS', 'CC1', 'CC2'],
    supportComponents: [
      {
        role: 'pull_down', symbol: 'resistor', value: '5.1K', footprint: 'R_0402',
        quantity: 1,
        reason: 'USB Type-C Spec Section 4.5.1.3.1: 5.1K pull-down on CC1 to identify as UFP (device/sink). 1% tolerance',
        pinRef: 'CC1', placement: 'close_to_ic',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '5.1K', footprint: 'R_0402',
        quantity: 1,
        reason: 'USB Type-C Spec: 5.1K pull-down on CC2 to identify as UFP (device/sink). 1% tolerance',
        pinRef: 'CC2', placement: 'close_to_ic',
      },
      {
        role: 'esd_protection', symbol: 'diode', value: 'USBLC6-2SC6', footprint: 'SOT-23-6',
        quantity: 1,
        reason: 'ESD protection on D+/D- lines. IEC 61000-4-2 Level 4 (±8kV contact). Place close to connector',
        pinRef: 'USB_D+', placement: 'between_connector_and_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '10uF', footprint: 'C_0805',
        quantity: 1,
        reason: 'VBUS bulk decoupling capacitor. Handle hot-plug inrush and USB noise',
        pinRef: 'VBUS', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'VBUS high-frequency bypass capacitor',
        pinRef: 'VBUS', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'For device (sink) mode: two 5.1K resistors on CC1 and CC2 (to GND)',
      'For host (source) mode: Rp pull-ups on CC1/CC2 (56K for default, 22K for 1.5A, 10K for 3A)',
      'ESD protection is mandatory for USB — place TVS diodes close to the connector',
      'USB 2.0 differential pair: maintain 90 ohm differential impedance, length-match D+/D-',
      'VBUS: consider adding a PMOS + load switch for OVP/OCP protection',
      'Shield pins should connect to chassis ground through 1M + 4.7nF (RC filter)',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CH340G / CH340C (USB to UART bridge)
  // Ref: CH340G Datasheet (WCH), CH340C Datasheet (no crystal variant)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['CH340G', 'CH340C', 'CH340N', 'CH340K', 'CH340E', 'CH340.*'],
    manufacturer: 'WCH (Nanjing Qinheng)',
    type: 'ic',
    powerPins: ['VCC', 'V3'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 3,
        reason: 'CH340 DS: 100nF bypass capacitor on VCC pin',
        pinRef: 'VCC', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'CH340 DS: 100nF decoupling on V3 pin (internal 3.3V regulator output)',
        pinRef: 'V3', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '12MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'CH340G DS: 12MHz crystal required for CH340G (CH340C/E/N have internal oscillator, no crystal needed)',
        pinRef: 'XI', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '22pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'CH340G: Crystal load capacitors, 22pF C0G/NP0 (not needed for CH340C)',
        pinRef: 'XI', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'CH340G requires external 12MHz crystal; CH340C/CH340E/CH340N have internal oscillator',
      'V3 pin: if VCC = 5V, connect 100nF cap from V3 to GND. If VCC = 3.3V, connect V3 directly to VCC',
      'For auto-reset programming (Arduino-style): connect DTR through 100nF cap to MCU RESET',
      'USB D+/D- lines: add ESD protection TVS diode close to USB connector',
      'CH340C is pin-compatible with CH340G but does not need crystal — simpler BOM',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MCP2515 (CAN Controller with SPI Interface)
  // Ref: MCP2515 Datasheet (Microchip DS20001801J)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['MCP2515.*'],
    manufacturer: 'Microchip',
    type: 'ic',
    powerPins: ['VDD'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'MCP2515 DS Section 1.2: 100nF decoupling on VDD, as close as possible to pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'crystal', symbol: 'crystal', value: '8MHz', footprint: 'Crystal_3225',
        quantity: 1, maxDistance_mm: 5,
        reason: 'MCP2515 DS Section 7.2: Requires external crystal (up to 25MHz). 8MHz or 16MHz typical',
        pinRef: 'OSC1', placement: 'close_to_ic',
      },
      {
        role: 'load_cap', symbol: 'capacitor', value: '22pF', footprint: 'C_0402',
        quantity: 2,
        reason: 'Crystal load capacitors (C0G/NP0). Value per crystal datasheet CL spec',
        pinRef: 'OSC1', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'MCP2515: CS (chip select) pull-up to VDD — keep CS high when SPI not active',
        pinRef: 'CS', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'MCP2515 is CAN controller only — needs separate CAN transceiver (e.g., MCP2551, SN65HVD230)',
      'SPI interface: CS, SCK, SI, SO. Connect to MCU SPI bus',
      'INT output: active low interrupt. Can be connected to MCU GPIO with external pull-up',
      'Crystal frequency determines CAN baud rate accuracy. 8MHz for 500kbps/1Mbps CAN',
      'RESET pin: connect to MCU GPIO or pull HIGH through 10K resistor',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SN65HVD230 (3.3V CAN Transceiver)
  // Ref: SN65HVD230 Datasheet (TI SLOS346T)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['SN65HVD23[0-3].*', 'SN65HVD230.*'],
    manufacturer: 'Texas Instruments',
    type: 'transceiver',
    powerPins: ['VCC'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'SN65HVD230 DS Section 8.1: 100nF ceramic bypass between VCC and GND',
        pinRef: 'VCC', placement: 'close_to_ic',
      },
      {
        role: 'series_resistor', symbol: 'resistor', value: '120R', footprint: 'R_0402',
        quantity: 1,
        reason: 'CAN bus termination: 120 ohm between CANH and CANL at each end of bus. Only install at bus endpoints',
        pinRef: 'CANH', placement: 'edge',
      },
      {
        role: 'pull_down', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'SN65HVD230: Rs pin pull-down for high-speed mode. 10K for slope control, GND for max speed',
        pinRef: 'Rs', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'SN65HVD230 is 3.3V only — use SN65HVD231/232 for 5V tolerant I/O',
      'CAN bus termination: 120 ohm required at each END of the bus, not at intermediate nodes',
      'Rs pin: GND = high speed (no slope control), pull-up through resistor = slope control mode',
      'Vref pin: provides VCC/2 reference — useful for standby mode wake detection',
      'CANH/CANL: add common-mode choke for EMI compliance if needed',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // W25Q128 / W25Q64 / W25Q32 / W25Q16 (SPI NOR Flash)
  // Ref: W25Q128JV Datasheet (Winbond)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['W25Q.*', 'W25Q128.*', 'W25Q64.*', 'W25Q32.*', 'W25Q16.*'],
    manufacturer: 'Winbond',
    type: 'memory',
    powerPins: ['VCC'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'W25Q128 DS Section 5.2: 100nF ceramic decoupling on VCC, as close to pin as possible',
        pinRef: 'VCC', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'W25Q128: /WP (Write Protect) pull-up to VCC — prevents accidental writes to status register',
        pinRef: 'WP', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'W25Q128: /HOLD (or /RESET) pull-up to VCC — prevents accidental hold/reset during normal operation',
        pinRef: 'HOLD', placement: 'close_to_ic',
      },
      {
        role: 'pull_up', symbol: 'resistor', value: '10K', footprint: 'R_0402',
        quantity: 1,
        reason: 'W25Q128: /CS pull-up to VCC — keep flash deselected when MCU SPI bus is shared or during boot',
        pinRef: 'CS', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'W25Q128: 16MB (128Mbit) SPI/Dual-SPI/Quad-SPI NOR flash',
      'For RP2040 QSPI boot flash: use Quad SPI mode (QE bit must be set in status register)',
      'SPI signals: CLK, CS, DO (IO0), DI (IO1), /WP (IO2), /HOLD (IO3)',
      'Max SPI clock: 133MHz (standard SPI), 266MHz (Dual/Quad output). Check your MCU SPI max speed',
      'Power supply range: 2.7-3.6V. Add 100nF bypass cap close to VCC pin',
      'Keep SPI traces short for high-speed operation; add series resistors (33R) if ringing observed',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BME280 (Temperature, Humidity, Pressure Sensor)
  // Ref: BME280 Datasheet (Bosch Sensortec BST-BME280-DS002)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['BME280.*', 'BMP280.*'],
    manufacturer: 'Bosch Sensortec',
    type: 'sensor',
    powerPins: ['VDD', 'VDDIO'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'BME280 DS Section 6.2: 100nF bypass on VDD pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'BME280 DS: 100nF bypass on VDDIO (I/O voltage level supply)',
        pinRef: 'VDDIO', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'BME280 supports both I2C and SPI interfaces. SDO pin selects I2C address (GND=0x76, VDDIO=0x77)',
      'CSB pin: pull HIGH for I2C mode, use as chip select for SPI mode',
      'I2C: needs external pull-ups on SDA/SCL (typically 4.7K to VDDIO)',
      'Place sensor away from heat sources (regulators, MCU) for accurate temperature readings',
      'Pressure port: do not obstruct with conformal coating or potting',
      'VDD range: 1.71-3.6V. VDDIO range: 1.2-3.6V',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MPU-6050 (6-Axis Accelerometer + Gyroscope)
  // Ref: MPU-6050 Register Map and Descriptions (RM-MPU-6000A-00)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    patterns: ['MPU[-_]?6050.*', 'MPU6050.*'],
    manufacturer: 'InvenSense (TDK)',
    type: 'sensor',
    powerPins: ['VDD', 'VLOGIC'],
    supportComponents: [
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1, maxDistance_mm: 2,
        reason: 'MPU-6050 DS Section 6.2: 100nF bypass on VDD pin',
        pinRef: 'VDD', placement: 'close_to_ic',
      },
      {
        role: 'bulk_cap', symbol: 'capacitor', value: '10nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'MPU-6050 DS: 10nF on REGOUT pin (internal regulator output bypass). Do NOT connect other loads',
        pinRef: 'REGOUT', placement: 'close_to_ic',
      },
      {
        role: 'bypass_cap', symbol: 'capacitor', value: '100nF', footprint: 'C_0402',
        quantity: 1,
        reason: 'MPU-6050: VLOGIC bypass (if VLOGIC used for I2C level shifting)',
        pinRef: 'VLOGIC', placement: 'close_to_ic',
      },
    ],
    designNotes: [
      'MPU-6050 I2C address: AD0=GND → 0x68, AD0=VDD → 0x69',
      'I2C pull-ups: 4.7K to VDD for standard/fast mode (100/400kHz)',
      'FSYNC pin: connect to GND if external sync not used',
      'Place sensor close to center of board, away from vibration sources',
      'CLKIN pin: connect to GND for internal clock (recommended for most applications)',
      'VDD range: 2.375-3.46V. VLOGIC: 1.71-VDD',
    ],
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────

/**
 * Find a matching ICKnowledge entry for a given component value string.
 * Returns the first match, or undefined.
 */
export function findICKnowledge(componentValue: string): ICKnowledge | undefined {
  if (!componentValue) return undefined;
  const normalized = componentValue.trim();
  for (const entry of IC_KNOWLEDGE_BASE) {
    for (const pattern of entry.patterns) {
      const regex = new RegExp(`^${pattern}$`, 'i');
      if (regex.test(normalized)) {
        return entry;
      }
    }
  }
  return undefined;
}

/**
 * Get all IC families in the knowledge base (for UI listing).
 */
export function listKnownICFamilies(): { patterns: string[]; manufacturer: string; type: string }[] {
  return IC_KNOWLEDGE_BASE.map(entry => ({
    patterns: entry.patterns,
    manufacturer: entry.manufacturer,
    type: entry.type,
  }));
}
