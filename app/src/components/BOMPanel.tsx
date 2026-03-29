// ─── BOMPanel.tsx ── Bill of Materials Cost Analysis ─────────────────────────
import React, { useState, useMemo, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useProjectStore } from '../store/projectStore';
import type { BrdComponent } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

type SortKey = 'ref' | 'value' | 'cost';
type SortDir = 'asc' | 'desc';

interface BOMEntry {
  refs: string[];
  value: string;
  footprint: string;
  quantity: number;
  unitPrice: number;
  category: string;
  alternatives: Alternative[];
}

interface Alternative {
  value: string;
  footprint: string;
  unitPrice: number;
  reason: string;
}

// ─── Built-in Price Database ────────────────────────────────────────────────
// Extends from componentSearch BUILTIN_COMPONENTS concept with pricing data

interface PriceEntry {
  pattern: RegExp;
  category: string;
  unitPrice: number;
  footprintPriceOverrides?: Record<string, number>;
}

const PRICE_DATABASE: PriceEntry[] = [
  // ── Resistors ──
  { pattern: /^R_0402$/i, category: 'resistor', unitPrice: 0.001 },
  { pattern: /^R_0603$/i, category: 'resistor', unitPrice: 0.002 },
  { pattern: /^R_0805$/i, category: 'resistor', unitPrice: 0.003 },
  { pattern: /^R_1206$/i, category: 'resistor', unitPrice: 0.005 },

  // ── Capacitors (MLCC) ──
  { pattern: /^C_0402$/i, category: 'capacitor', unitPrice: 0.005 },
  { pattern: /^C_0603$/i, category: 'capacitor', unitPrice: 0.008 },
  { pattern: /^C_0805$/i, category: 'capacitor', unitPrice: 0.012 },
  { pattern: /^C_1206$/i, category: 'capacitor', unitPrice: 0.025 },
  { pattern: /^C_1210$/i, category: 'capacitor', unitPrice: 0.050 },

  // ── Inductors ──
  { pattern: /^IND/i, category: 'inductor', unitPrice: 0.15 },
  { pattern: /^L_/i, category: 'inductor', unitPrice: 0.12 },

  // ── Diodes ──
  { pattern: /^SMA$/i, category: 'diode', unitPrice: 0.08 },
  { pattern: /^SOD-?123/i, category: 'diode', unitPrice: 0.03 },
  { pattern: /^SOD-?323/i, category: 'diode', unitPrice: 0.02 },

  // ── Crystals ──
  { pattern: /^Crystal/i, category: 'crystal', unitPrice: 0.20 },
  { pattern: /^HC49/i, category: 'crystal', unitPrice: 0.15 },
];

// Value-based pricing for specific ICs and parts
interface ICPriceEntry {
  pattern: RegExp;
  category: string;
  unitPrice: number;
}

const IC_PRICE_DATABASE: ICPriceEntry[] = [
  // ── MCUs ──
  { pattern: /^STM32F103/i, category: 'mcu', unitPrice: 2.50 },
  { pattern: /^STM32F0/i, category: 'mcu', unitPrice: 1.80 },
  { pattern: /^STM32F3/i, category: 'mcu', unitPrice: 3.20 },
  { pattern: /^STM32F4/i, category: 'mcu', unitPrice: 4.50 },
  { pattern: /^STM32H7/i, category: 'mcu', unitPrice: 8.00 },
  { pattern: /^STM32L0/i, category: 'mcu', unitPrice: 1.50 },
  { pattern: /^STM32G0/i, category: 'mcu', unitPrice: 1.20 },
  { pattern: /^ESP32/i, category: 'mcu', unitPrice: 2.80 },
  { pattern: /^ESP8266/i, category: 'mcu', unitPrice: 1.50 },
  { pattern: /^RP2040/i, category: 'mcu', unitPrice: 0.80 },
  { pattern: /^ATMEGA328/i, category: 'mcu', unitPrice: 2.00 },
  { pattern: /^ATMEGA32U4/i, category: 'mcu', unitPrice: 3.50 },
  { pattern: /^ATTINY85/i, category: 'mcu', unitPrice: 0.80 },
  { pattern: /^ATTINY/i, category: 'mcu', unitPrice: 0.60 },
  { pattern: /^nRF52/i, category: 'mcu', unitPrice: 3.00 },
  { pattern: /^PIC\d/i, category: 'mcu', unitPrice: 1.20 },
  { pattern: /^GD32/i, category: 'mcu', unitPrice: 1.50 },
  { pattern: /^CH32/i, category: 'mcu', unitPrice: 0.30 },

  // ── USB-UART ──
  { pattern: /^CH340G/i, category: 'usb_uart', unitPrice: 0.40 },
  { pattern: /^CH340C/i, category: 'usb_uart', unitPrice: 0.45 },
  { pattern: /^CH340/i, category: 'usb_uart', unitPrice: 0.40 },
  { pattern: /^CP2102/i, category: 'usb_uart', unitPrice: 1.80 },
  { pattern: /^FT232R/i, category: 'usb_uart', unitPrice: 3.50 },
  { pattern: /^FT232H/i, category: 'usb_uart', unitPrice: 5.00 },
  { pattern: /^PL2303/i, category: 'usb_uart', unitPrice: 1.00 },

  // ── Regulators ──
  { pattern: /^AMS1117/i, category: 'ldo', unitPrice: 0.15 },
  { pattern: /^AP2112/i, category: 'ldo', unitPrice: 0.20 },
  { pattern: /^MCP1700/i, category: 'ldo', unitPrice: 0.25 },
  { pattern: /^XC6206/i, category: 'ldo', unitPrice: 0.10 },
  { pattern: /^RT9013/i, category: 'ldo', unitPrice: 0.18 },
  { pattern: /^ME6211/i, category: 'ldo', unitPrice: 0.08 },
  { pattern: /^HT73/i, category: 'ldo', unitPrice: 0.06 },
  { pattern: /^LP5907/i, category: 'ldo', unitPrice: 0.35 },
  { pattern: /^TPS7A/i, category: 'ldo', unitPrice: 1.50 },

  // ── Buck converters ──
  { pattern: /^TPS5430/i, category: 'buck', unitPrice: 1.80 },
  { pattern: /^MP2315/i, category: 'buck', unitPrice: 0.80 },
  { pattern: /^MP1584/i, category: 'buck', unitPrice: 0.60 },
  { pattern: /^SY8089/i, category: 'buck', unitPrice: 0.35 },
  { pattern: /^LM2596/i, category: 'buck', unitPrice: 0.50 },
  { pattern: /^XL1509/i, category: 'buck', unitPrice: 0.30 },

  // ── ESD Protection ──
  { pattern: /^USBLC6/i, category: 'esd', unitPrice: 0.12 },
  { pattern: /^PRTR5V/i, category: 'esd', unitPrice: 0.15 },
  { pattern: /^PESD/i, category: 'esd', unitPrice: 0.08 },
  { pattern: /^TVS/i, category: 'esd', unitPrice: 0.10 },
  { pattern: /^TPD\d/i, category: 'esd', unitPrice: 0.20 },

  // ── Memory ──
  { pattern: /^W25Q32/i, category: 'spi_flash', unitPrice: 0.40 },
  { pattern: /^W25Q64/i, category: 'spi_flash', unitPrice: 0.55 },
  { pattern: /^W25Q128/i, category: 'spi_flash', unitPrice: 0.80 },
  { pattern: /^W25Q16/i, category: 'spi_flash', unitPrice: 0.30 },
  { pattern: /^24LC/i, category: 'i2c_eeprom', unitPrice: 0.25 },
  { pattern: /^AT24C/i, category: 'i2c_eeprom', unitPrice: 0.20 },

  // ── Sensors ──
  { pattern: /^BME280/i, category: 'sensor', unitPrice: 2.50 },
  { pattern: /^BMP280/i, category: 'sensor', unitPrice: 1.20 },
  { pattern: /^SHT3/i, category: 'sensor', unitPrice: 2.80 },
  { pattern: /^MPU6050/i, category: 'sensor', unitPrice: 1.50 },
  { pattern: /^INA219/i, category: 'sensor', unitPrice: 1.00 },
  { pattern: /^ADS1115/i, category: 'sensor', unitPrice: 3.50 },

  // ── CAN ──
  { pattern: /^MCP2551/i, category: 'can_transceiver', unitPrice: 0.80 },
  { pattern: /^TJA1050/i, category: 'can_transceiver', unitPrice: 0.60 },
  { pattern: /^SN65HVD230/i, category: 'can_transceiver', unitPrice: 1.20 },

  // ── Display ──
  { pattern: /^SSD1306/i, category: 'display_driver', unitPrice: 1.00 },
  { pattern: /^MAX7219/i, category: 'display_driver', unitPrice: 0.70 },

  // ── Wireless ──
  { pattern: /^SX127/i, category: 'wireless', unitPrice: 3.50 },
  { pattern: /^nRF24L01/i, category: 'wireless', unitPrice: 0.80 },
  { pattern: /^CC1101/i, category: 'wireless', unitPrice: 1.50 },

  // ── MOSFETs ──
  { pattern: /^2N7002/i, category: 'mosfet', unitPrice: 0.02 },
  { pattern: /^BSS138/i, category: 'mosfet', unitPrice: 0.03 },
  { pattern: /^IRF540/i, category: 'mosfet', unitPrice: 0.40 },
  { pattern: /^SI2302/i, category: 'mosfet', unitPrice: 0.04 },
  { pattern: /^AO3400/i, category: 'mosfet', unitPrice: 0.05 },
];

// ── Capacitor value-based pricing adjustments ──
function getCapacitorPriceMultiplier(value: string): number {
  const val = value.toLowerCase();
  if (val.includes('100u') || val.includes('220u')) return 3.0;
  if (val.includes('47u') || val.includes('68u')) return 2.5;
  if (val.includes('22u') || val.includes('33u')) return 2.0;
  if (val.includes('10u')) return 1.5;
  if (val.includes('4.7u') || val.includes('1u') && !val.includes('100n') && !val.includes('10n')) return 1.2;
  return 1.0;
}

// ─── Price Lookup ───────────────────────────────────────────────────────────

function lookupPrice(value: string, footprint: string): { price: number; category: string } {
  // Try IC price database first (value-based)
  for (const entry of IC_PRICE_DATABASE) {
    if (entry.pattern.test(value)) {
      return { price: entry.unitPrice, category: entry.category };
    }
  }

  // Try footprint-based pricing (passives)
  for (const entry of PRICE_DATABASE) {
    if (entry.pattern.test(footprint)) {
      let price = entry.unitPrice;
      if (entry.category === 'capacitor') {
        price *= getCapacitorPriceMultiplier(value);
      }
      return { price, category: entry.category };
    }
  }

  // Heuristic fallback based on reference prefix
  if (/^\d/.test(value) || /^[0-9.]+[kKmMuUpPnN]/.test(value)) {
    // Likely a passive
    return { price: 0.01, category: 'passive' };
  }

  // Unknown IC/module
  return { price: 0.50, category: 'unknown' };
}

// ─── Alternatives Database ──────────────────────────────────────────────────

function findAlternatives(value: string, category: string, currentPrice: number): Alternative[] {
  const alts: Alternative[] = [];

  if (category === 'mcu') {
    const mcuAlts: { pattern: RegExp; alt: Alternative }[] = [
      { pattern: /STM32F103/i, alt: { value: 'GD32F103', footprint: 'LQFP-48', unitPrice: 1.50, reason: 'Pin-compatible clone, 40% cheaper' } },
      { pattern: /STM32F103/i, alt: { value: 'CH32F103', footprint: 'LQFP-48', unitPrice: 0.80, reason: 'WCH clone, 68% cheaper' } },
      { pattern: /ESP32/i, alt: { value: 'ESP32-C3', footprint: 'QFN-32', unitPrice: 1.50, reason: 'RISC-V core, cheaper, lower power' } },
      { pattern: /ATMEGA328/i, alt: { value: 'STM32G030', footprint: 'TSSOP-20', unitPrice: 0.80, reason: 'More capable ARM Cortex-M0+, cheaper' } },
      { pattern: /STM32F4/i, alt: { value: 'GD32F407', footprint: 'LQFP-100', unitPrice: 3.00, reason: 'GigaDevice clone, ~33% cheaper' } },
      { pattern: /RP2040/i, alt: { value: 'CH32V003', footprint: 'SOP-8', unitPrice: 0.10, reason: 'Ultra-cheap RISC-V if fewer features needed' } },
    ];
    for (const { pattern, alt } of mcuAlts) {
      if (pattern.test(value) && alt.unitPrice < currentPrice) {
        alts.push(alt);
      }
    }
  }

  if (category === 'usb_uart') {
    const uartAlts: { pattern: RegExp; alt: Alternative }[] = [
      { pattern: /CP2102/i, alt: { value: 'CH340C', footprint: 'SOP-16', unitPrice: 0.45, reason: 'Internal clock, no external crystal needed, 75% cheaper' } },
      { pattern: /FT232R/i, alt: { value: 'CH340G', footprint: 'SOP-16', unitPrice: 0.40, reason: 'Widely available, 89% cheaper' } },
      { pattern: /FT232H/i, alt: { value: 'CH340C', footprint: 'SOP-16', unitPrice: 0.45, reason: '91% cheaper (USB-UART only, no MPSSE)' } },
      { pattern: /PL2303/i, alt: { value: 'CH340C', footprint: 'SOP-16', unitPrice: 0.45, reason: 'Better driver support, cheaper' } },
    ];
    for (const { pattern, alt } of uartAlts) {
      if (pattern.test(value) && alt.unitPrice < currentPrice) {
        alts.push(alt);
      }
    }
  }

  if (category === 'ldo') {
    const ldoAlts: { pattern: RegExp; alt: Alternative }[] = [
      { pattern: /AP2112/i, alt: { value: 'ME6211', footprint: 'SOT-23-5', unitPrice: 0.08, reason: '60% cheaper, similar specs' } },
      { pattern: /LP5907/i, alt: { value: 'XC6206', footprint: 'SOT-23', unitPrice: 0.10, reason: '71% cheaper, lower quiescent current' } },
      { pattern: /MCP1700/i, alt: { value: 'HT7333', footprint: 'SOT-89', unitPrice: 0.06, reason: '76% cheaper' } },
      { pattern: /AMS1117/i, alt: { value: 'ME6211', footprint: 'SOT-23-5', unitPrice: 0.08, reason: 'Smaller, lower dropout, cheaper' } },
      { pattern: /TPS7A/i, alt: { value: 'LP5907', footprint: 'SOT-23-5', unitPrice: 0.35, reason: '77% cheaper, still ultra-low noise' } },
    ];
    for (const { pattern, alt } of ldoAlts) {
      if (pattern.test(value) && alt.unitPrice < currentPrice) {
        alts.push(alt);
      }
    }
  }

  if (category === 'buck') {
    if (currentPrice > 0.50) {
      alts.push({ value: 'XL1509', footprint: 'SOP-8', unitPrice: 0.30, reason: 'Budget buck converter' });
    }
    if (currentPrice > 0.80) {
      alts.push({ value: 'SY8089', footprint: 'SOT-23-5', unitPrice: 0.35, reason: 'Small, efficient, cheap' });
    }
  }

  if (category === 'spi_flash') {
    if (currentPrice > 0.40) {
      alts.push({ value: 'GD25Q32', footprint: 'SOP-8', unitPrice: 0.30, reason: 'GigaDevice compatible alternative' });
    }
  }

  return alts.slice(0, 3); // Max 3 alternatives
}

// ─── Component ──────────────────────────────────────────────────────────────

const BOMPanel: React.FC = () => {
  const board = useProjectStore((s) => s.board);
  const [sortKey, setSortKey] = useState<SortKey>('ref');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupByValue, setGroupByValue] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Build BOM entries
  const bomEntries = useMemo((): BOMEntry[] => {
    if (board.components.length === 0) return [];

    const map = new Map<string, { refs: string[]; comp: BrdComponent }>();

    for (const comp of board.components) {
      const key = groupByValue
        ? `${comp.value}||${comp.footprint}`
        : comp.ref;

      const existing = map.get(key);
      if (existing) {
        existing.refs.push(comp.ref);
      } else {
        map.set(key, { refs: [comp.ref], comp });
      }
    }

    return Array.from(map.values()).map(({ refs, comp }) => {
      const { price, category } = lookupPrice(comp.value, comp.footprint);
      const alternatives = findAlternatives(comp.value, category, price);

      return {
        refs: refs.sort((a, b) => {
          const aNum = parseInt(a.replace(/\D/g, '')) || 0;
          const bNum = parseInt(b.replace(/\D/g, '')) || 0;
          return aNum - bNum;
        }),
        value: comp.value,
        footprint: comp.footprint,
        quantity: refs.length,
        unitPrice: price,
        category,
        alternatives,
      };
    });
  }, [board.components, groupByValue]);

  // Sort entries
  const sortedEntries = useMemo(() => {
    const sorted = [...bomEntries];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'ref':
          cmp = a.refs[0].localeCompare(b.refs[0], undefined, { numeric: true });
          break;
        case 'value':
          cmp = a.value.localeCompare(b.value);
          break;
        case 'cost':
          cmp = (a.unitPrice * a.quantity) - (b.unitPrice * b.quantity);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [bomEntries, sortKey, sortDir]);

  // Total cost
  const totalCost = useMemo(() => {
    return bomEntries.reduce((sum, e) => sum + e.unitPrice * e.quantity, 0);
  }, [bomEntries]);

  const totalParts = useMemo(() => {
    return bomEntries.reduce((sum, e) => sum + e.quantity, 0);
  }, [bomEntries]);

  const uniqueLines = bomEntries.length;

  // Sort toggle
  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return key;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  // Export CSV
  const exportCSV = useCallback(() => {
    const lines = ['Reference,Value,Footprint,Quantity,Unit Price (USD),Total (USD),Category'];
    for (const entry of sortedEntries) {
      lines.push(
        `"${entry.refs.join(', ')}","${entry.value}","${entry.footprint}",${entry.quantity},${entry.unitPrice.toFixed(4)},${(entry.unitPrice * entry.quantity).toFixed(4)},"${entry.category}"`
      );
    }
    lines.push('');
    lines.push(`,,Total Parts:,${totalParts},Total Cost:,$${totalCost.toFixed(2)},`);

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bom_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [sortedEntries, totalCost, totalParts]);

  // Sort arrow indicator
  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={styles.title}>Bill of Materials</span>
          <span style={styles.subtitle}>
            {uniqueLines} unique lines | {totalParts} total parts
          </span>
        </div>
        <div style={styles.controls}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={groupByValue}
              onChange={(e) => setGroupByValue(e.target.checked)}
              style={styles.checkbox}
            />
            <span style={styles.checkboxText}>Group by value</span>
          </label>
          <button style={styles.exportBtn} onClick={exportCSV} title="Export BOM as CSV">
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={styles.tableContainer}>
        {/* Table header */}
        <div style={styles.tableHeader}>
          <span
            style={{ ...styles.th, flex: 1.5, cursor: 'pointer' }}
            onClick={() => handleSort('ref')}
          >
            Ref{sortArrow('ref')}
          </span>
          <span
            style={{ ...styles.th, flex: 2, cursor: 'pointer' }}
            onClick={() => handleSort('value')}
          >
            Value{sortArrow('value')}
          </span>
          <span style={{ ...styles.th, flex: 1.5 }}>Footprint</span>
          <span style={{ ...styles.th, flex: 0.5, textAlign: 'center' }}>Qty</span>
          <span style={{ ...styles.th, flex: 0.8, textAlign: 'right' }}>Unit $</span>
          <span
            style={{ ...styles.th, flex: 0.8, textAlign: 'right', cursor: 'pointer' }}
            onClick={() => handleSort('cost')}
          >
            Total ${sortArrow('cost')}
          </span>
          <span style={{ ...styles.th, flex: 1, textAlign: 'center' }}>Alts</span>
        </div>

        {/* Table body */}
        <div style={styles.tableBody}>
          {sortedEntries.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: '32px', marginBottom: 8 }}>&#x1F4CB;</div>
              <div>No components on board</div>
              <div style={{ fontSize: theme.fontXs, marginTop: 4, color: theme.textMuted }}>
                Add components to the schematic and sync to board
              </div>
            </div>
          ) : (
            sortedEntries.map((entry, idx) => {
              const rowKey = `${entry.value}__${entry.footprint}`;
              const isExpanded = expandedRow === rowKey;
              const lineTotal = entry.unitPrice * entry.quantity;

              return (
                <React.Fragment key={rowKey}>
                  <div
                    style={{
                      ...styles.tableRow,
                      background: idx % 2 === 0 ? 'transparent' : theme.bg2,
                    }}
                  >
                    <span style={{ ...styles.td, flex: 1.5, color: theme.textPrimary }}>
                      {entry.refs.length <= 3
                        ? entry.refs.join(', ')
                        : `${entry.refs.slice(0, 3).join(', ')}...`}
                    </span>
                    <span style={{ ...styles.td, flex: 2, color: theme.cyan }}>
                      {entry.value}
                    </span>
                    <span style={{ ...styles.td, flex: 1.5 }}>
                      {entry.footprint}
                    </span>
                    <span style={{ ...styles.td, flex: 0.5, textAlign: 'center', color: theme.textPrimary }}>
                      {entry.quantity}
                    </span>
                    <span style={{ ...styles.td, flex: 0.8, textAlign: 'right' }}>
                      ${entry.unitPrice.toFixed(3)}
                    </span>
                    <span style={{
                      ...styles.td,
                      flex: 0.8,
                      textAlign: 'right',
                      color: lineTotal > 1.0 ? theme.orange : theme.green,
                      fontWeight: 500,
                    }}>
                      ${lineTotal.toFixed(3)}
                    </span>
                    <span style={{ ...styles.td, flex: 1, textAlign: 'center' }}>
                      {entry.alternatives.length > 0 ? (
                        <button
                          style={styles.altBtn}
                          onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                          title="Find cheaper alternatives"
                        >
                          {isExpanded ? 'Hide' : `${entry.alternatives.length} cheaper`}
                        </button>
                      ) : (
                        <span style={{ color: theme.textMuted, fontSize: theme.fontXs }}>--</span>
                      )}
                    </span>
                  </div>

                  {/* Alternatives expansion */}
                  {isExpanded && entry.alternatives.length > 0 && (
                    <div style={styles.altPanel}>
                      <div style={styles.altPanelTitle}>Cheaper Alternatives</div>
                      {entry.alternatives.map((alt, aIdx) => {
                        const savings = ((entry.unitPrice - alt.unitPrice) / entry.unitPrice * 100).toFixed(0);
                        return (
                          <div key={aIdx} style={styles.altRow}>
                            <span style={{ ...styles.altCell, flex: 2, color: theme.green }}>
                              {alt.value}
                            </span>
                            <span style={{ ...styles.altCell, flex: 1.5 }}>
                              {alt.footprint}
                            </span>
                            <span style={{ ...styles.altCell, flex: 0.8, textAlign: 'right', color: theme.green, fontWeight: 600 }}>
                              ${alt.unitPrice.toFixed(3)}
                            </span>
                            <span style={{ ...styles.altCell, flex: 0.8 }}>
                              <span style={styles.savingsBadge}>-{savings}%</span>
                            </span>
                            <span style={{ ...styles.altCell, flex: 3, fontSize: '9px', color: theme.textMuted }}>
                              {alt.reason}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Footer: total cost */}
      {sortedEntries.length > 0 && (
        <div style={styles.footer}>
          <div style={styles.costBreakdown}>
            <div style={styles.costItem}>
              <span style={styles.costLabel}>Unique Lines</span>
              <span style={styles.costVal}>{uniqueLines}</span>
            </div>
            <div style={styles.costItem}>
              <span style={styles.costLabel}>Total Parts</span>
              <span style={styles.costVal}>{totalParts}</span>
            </div>
            <div style={styles.costDivider} />
            <div style={styles.costItem}>
              <span style={styles.costLabel}>BOM Cost (1x)</span>
              <span style={styles.costTotal}>${totalCost.toFixed(2)}</span>
            </div>
            <div style={styles.costItem}>
              <span style={styles.costLabel}>BOM Cost (100x)</span>
              <span style={{ ...styles.costVal, color: theme.green }}>
                ${(totalCost * 100 * 0.85).toFixed(2)}
              </span>
            </div>
            <div style={styles.costItem}>
              <span style={styles.costLabel}>BOM Cost (1000x)</span>
              <span style={{ ...styles.costVal, color: theme.green }}>
                ${(totalCost * 1000 * 0.70).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: theme.bg0,
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px 12px',
    borderBottom: theme.border,
    background: theme.bg1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  titleRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    fontSize: theme.fontLg,
    fontWeight: 700,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
  },
  subtitle: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontMono,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: theme.blue,
    cursor: 'pointer',
  },
  checkboxText: {
    fontSize: theme.fontXs,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
  },
  exportBtn: {
    background: theme.bg3,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.green,
    fontSize: theme.fontXs,
    fontWeight: 600,
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  tableContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '8px 16px',
    background: theme.bg2,
    borderBottom: theme.border,
    flexShrink: 0,
  },
  th: {
    color: theme.textMuted,
    fontSize: '9px',
    fontWeight: 700,
    fontFamily: theme.fontMono,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    paddingRight: 8,
    userSelect: 'none',
  },
  tableBody: {
    flex: 1,
    overflowY: 'auto',
  },
  tableRow: {
    display: 'flex',
    padding: '5px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.02)',
    alignItems: 'center',
  },
  td: {
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textSecondary,
    paddingRight: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    color: theme.textMuted,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
  },
  altBtn: {
    background: theme.blueDim,
    border: `1px solid ${theme.blue}`,
    borderRadius: theme.radiusSm,
    color: theme.blue,
    fontSize: '9px',
    fontWeight: 600,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    whiteSpace: 'nowrap' as const,
  },
  altPanel: {
    background: theme.bg1,
    borderLeft: `3px solid ${theme.green}`,
    padding: '8px 16px 8px 24px',
    marginBottom: 2,
  },
  altPanelTitle: {
    fontSize: '9px',
    fontWeight: 700,
    color: theme.green,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 6,
    fontFamily: theme.fontSans,
  },
  altRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '3px 0',
    gap: 4,
  },
  altCell: {
    fontSize: theme.fontXs,
    fontFamily: theme.fontMono,
    color: theme.textSecondary,
  },
  savingsBadge: {
    background: theme.greenDim,
    color: theme.green,
    fontSize: '9px',
    fontWeight: 700,
    padding: '1px 5px',
    borderRadius: 2,
    fontFamily: theme.fontMono,
  },
  footer: {
    padding: '12px 20px',
    borderTop: theme.border,
    background: theme.bg1,
    flexShrink: 0,
  },
  costBreakdown: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap' as const,
  },
  costItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  costLabel: {
    fontSize: '9px',
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
    fontFamily: theme.fontSans,
  },
  costVal: {
    fontSize: theme.fontMd,
    fontWeight: 600,
    color: theme.textPrimary,
    fontFamily: theme.fontMono,
  },
  costTotal: {
    fontSize: theme.fontXl,
    fontWeight: 700,
    color: theme.green,
    fontFamily: theme.fontMono,
  },
  costDivider: {
    width: 1,
    height: 30,
    background: theme.bg3,
  },
};

export default BOMPanel;
