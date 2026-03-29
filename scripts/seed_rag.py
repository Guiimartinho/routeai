#!/usr/bin/env python3
"""Seed the pgvector database with PCB design knowledge base data.

Creates the required tables and vector indexes, then populates with:
- IPC-2221B clearance/creepage/current-capacity data
- IPC-2141 impedance formula references
- Common component data (popular MCUs, regulators, passives)
- 10 reference design summaries

Usage:
    python scripts/seed_rag.py [--db-url postgresql://routeai:routeai_dev@localhost:5432/routeai]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from typing import Any

import psycopg2  # type: ignore[import-untyped]
from psycopg2.extras import execute_values  # type: ignore[import-untyped]


# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table: source documents and metadata
CREATE TABLE IF NOT EXISTS rag_documents (
    id              SERIAL PRIMARY KEY,
    doc_hash        VARCHAR(64) UNIQUE NOT NULL,
    source          VARCHAR(255) NOT NULL,
    title           VARCHAR(512) NOT NULL,
    category        VARCHAR(128) NOT NULL,
    content         TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Chunks table: text chunks with embeddings
CREATE TABLE IF NOT EXISTS rag_chunks (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    embedding       vector(1536),
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

-- Component data table
CREATE TABLE IF NOT EXISTS rag_components (
    id              SERIAL PRIMARY KEY,
    mpn             VARCHAR(128) UNIQUE NOT NULL,
    manufacturer    VARCHAR(255) NOT NULL,
    category        VARCHAR(128) NOT NULL,
    description     TEXT NOT NULL,
    specs           JSONB NOT NULL DEFAULT '{}'::jsonb,
    footprint       VARCHAR(128),
    datasheet_url   VARCHAR(512),
    embedding       vector(1536),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for vector similarity search
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
    ON rag_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_rag_components_embedding
    ON rag_components USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- Indexes for filtered queries
CREATE INDEX IF NOT EXISTS idx_rag_documents_category ON rag_documents(category);
CREATE INDEX IF NOT EXISTS idx_rag_documents_source ON rag_documents(source);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_rag_components_category ON rag_components(category);
CREATE INDEX IF NOT EXISTS idx_rag_components_mpn ON rag_components(mpn);
"""


# ---------------------------------------------------------------------------
# Sample IPC standard data
# ---------------------------------------------------------------------------

IPC_2221B_CLEARANCE_DATA = [
    {
        "source": "IPC-2221B",
        "title": "IPC-2221B Table 6-1: Electrical Clearance (Internal Layers)",
        "category": "clearance",
        "content": (
            "IPC-2221B Table 6-1 - Minimum Electrical Clearance for Internal Layers\n\n"
            "Voltage (DC or AC peak) | Minimum Clearance (mm)\n"
            "0-15V                   | 0.05\n"
            "16-30V                  | 0.05\n"
            "31-50V                  | 0.10\n"
            "51-100V                 | 0.10\n"
            "101-150V                | 0.20\n"
            "151-170V                | 0.20\n"
            "171-250V                | 0.20\n"
            "251-300V                | 0.20\n"
            "301-500V                | 0.25\n"
            "\n"
            "These clearances apply to uncoated internal conductors. B1 (bare board) "
            "conditions apply. For conformal-coated assemblies, clearances may be reduced "
            "per IPC-2221B Section 6.3."
        ),
        "metadata": {"section": "6.3", "table": "6-1", "revision": "B"},
    },
    {
        "source": "IPC-2221B",
        "title": "IPC-2221B Table 6-1: Electrical Clearance (External Layers, Uncoated, Sea Level)",
        "category": "clearance",
        "content": (
            "IPC-2221B Table 6-1 - Minimum Electrical Clearance for External Layers "
            "(Uncoated, Sea Level to 3050m)\n\n"
            "Voltage (DC or AC peak) | Minimum Clearance (mm)\n"
            "0-15V                   | 0.10\n"
            "16-30V                  | 0.10\n"
            "31-50V                  | 0.60\n"
            "51-100V                 | 0.60\n"
            "101-150V                | 0.60\n"
            "151-170V                | 1.00\n"
            "171-250V                | 1.00\n"
            "251-300V                | 1.00\n"
            "301-500V                | 2.50\n"
            "\n"
            "External layer clearances are greater than internal layers due to surface "
            "contamination risk and altitude derating. Conformal coating per IPC-A-610 "
            "can allow reduced clearances. Assembly class (1, 2, or 3) does not affect "
            "minimum electrical clearance requirements."
        ),
        "metadata": {"section": "6.3", "table": "6-1", "revision": "B"},
    },
    {
        "source": "IPC-2221B",
        "title": "IPC-2221B Section 6.2: Conductor Spacing",
        "category": "clearance",
        "content": (
            "IPC-2221B Section 6.2 - Conductor Spacing\n\n"
            "Minimum conductor spacing is determined by the maximum voltage difference "
            "between adjacent conductors, the type of coating, and the altitude of "
            "operation. Creepage and clearance must both be considered.\n\n"
            "Key rules:\n"
            "1. Clearance is the shortest distance through air between two conductors.\n"
            "2. Creepage is the shortest distance along the surface of a solid "
            "insulating material between two conductors.\n"
            "3. For mixed-voltage boards, the clearance between any two conductors is "
            "determined by the highest voltage difference possible between them.\n"
            "4. Ground planes do not eliminate the need for clearance between power "
            "conductors on the same layer.\n"
            "5. Voltage ratings are DC or AC peak (not RMS)."
        ),
        "metadata": {"section": "6.2", "revision": "B"},
    },
]

IPC_2141_IMPEDANCE_DATA = [
    {
        "source": "IPC-2141",
        "title": "IPC-2141 Microstrip Impedance Formula",
        "category": "impedance",
        "content": (
            "IPC-2141 Section 4.2.1 - Surface Microstrip Impedance\n\n"
            "For a surface microstrip transmission line, the characteristic impedance "
            "Z0 is approximated by:\n\n"
            "For W/H <= 1:\n"
            "  Z0 = (60 / sqrt(Er_eff)) * ln(8H/W_eff + W_eff/4H)\n\n"
            "For W/H > 1:\n"
            "  Z0 = (120 * pi) / (sqrt(Er_eff) * (W_eff/H + 1.393 + 0.667 * ln(W_eff/H + 1.444)))\n\n"
            "Where:\n"
            "  W = trace width\n"
            "  H = dielectric height (distance from trace to reference plane)\n"
            "  T = trace thickness (copper weight)\n"
            "  Er = dielectric constant of the substrate\n"
            "  W_eff = effective trace width accounting for thickness\n"
            "  Er_eff = effective dielectric constant\n\n"
            "Typical Er values:\n"
            "  FR-4: 4.2-4.5 (varies with frequency)\n"
            "  Rogers 4003C: 3.38\n"
            "  Rogers 4350B: 3.48\n"
            "  Isola 370HR: 4.04"
        ),
        "metadata": {"section": "4.2.1"},
    },
    {
        "source": "IPC-2141",
        "title": "IPC-2141 Stripline Impedance Formula",
        "category": "impedance",
        "content": (
            "IPC-2141 Section 4.2.2 - Symmetric Stripline Impedance\n\n"
            "For a symmetric stripline (trace centered between two reference planes), "
            "the characteristic impedance is:\n\n"
            "  Z0 = (60 / sqrt(Er)) * ln(4B / (0.67 * pi * (0.8W + T)))\n\n"
            "Where:\n"
            "  W = trace width\n"
            "  B = distance between reference planes\n"
            "  T = trace thickness\n"
            "  Er = dielectric constant\n\n"
            "For asymmetric stripline (trace not centered):\n"
            "  The impedance depends on the distances H1 and H2 to each reference "
            "plane. The formula uses the geometric mean of the two stripline "
            "impedances calculated with each distance independently.\n\n"
            "Common target impedances:\n"
            "  Single-ended: 50 ohm (most common), 75 ohm (video)\n"
            "  Differential: 90 ohm (USB), 100 ohm (Ethernet, PCIe), 85 ohm (SATA)"
        ),
        "metadata": {"section": "4.2.2"},
    },
    {
        "source": "IPC-2141",
        "title": "IPC-2141 Differential Pair Impedance",
        "category": "impedance",
        "content": (
            "IPC-2141 Section 4.3 - Differential Impedance\n\n"
            "The differential impedance Zdiff for a coupled pair is:\n\n"
            "  Zdiff = 2 * Z0 * (1 - k)\n\n"
            "Where:\n"
            "  Z0 = single-ended impedance of each trace\n"
            "  k = coupling coefficient (0 to 1)\n\n"
            "The coupling coefficient depends on the spacing S between traces "
            "relative to the dielectric height H:\n"
            "  - Tightly coupled (S/H < 1): k is significant, Zdiff < 2*Z0\n"
            "  - Loosely coupled (S/H > 3): k approaches 0, Zdiff approaches 2*Z0\n\n"
            "For edge-coupled microstrip differential pair:\n"
            "  Zdiff = 2 * Z0 * (1 - 0.48 * exp(-0.96 * S/H))\n\n"
            "Design guidelines:\n"
            "  - USB 2.0: Zdiff = 90 ohm +/- 10%\n"
            "  - USB 3.x: Zdiff = 90 ohm +/- 7%\n"
            "  - PCIe Gen3+: Zdiff = 85 ohm +/- 10%\n"
            "  - HDMI: Zdiff = 100 ohm +/- 10%\n"
            "  - Ethernet 1000BASE-T: Zdiff = 100 ohm +/- 10%"
        ),
        "metadata": {"section": "4.3"},
    },
]

# ---------------------------------------------------------------------------
# Sample component data
# ---------------------------------------------------------------------------

SAMPLE_COMPONENTS = [
    {
        "mpn": "GRM155R71C104KA88D",
        "manufacturer": "Murata",
        "category": "capacitor",
        "description": "100nF 16V X7R 0402 MLCC capacitor, general purpose decoupling",
        "specs": {
            "capacitance_f": 1e-7,
            "voltage_v": 16,
            "dielectric": "X7R",
            "tolerance": "10%",
            "package": "0402",
            "temperature_range_c": "-55 to 125",
        },
        "footprint": "C_0402_1005Metric",
        "datasheet_url": "https://www.murata.com/products/productdetail?partno=GRM155R71C104KA88D",
    },
    {
        "mpn": "RC0402FR-0710KL",
        "manufacturer": "Yageo",
        "category": "resistor",
        "description": "10K ohm 1% 0402 thick film resistor",
        "specs": {
            "resistance_ohm": 10000,
            "tolerance": "1%",
            "power_w": 0.0625,
            "package": "0402",
            "temperature_coefficient_ppm": 100,
        },
        "footprint": "R_0402_1005Metric",
        "datasheet_url": "https://www.yageo.com/en/Chart/Download/pdf/RC0402FR-0710KL",
    },
    {
        "mpn": "STM32F405RGT6",
        "manufacturer": "STMicroelectronics",
        "category": "microcontroller",
        "description": "ARM Cortex-M4 168MHz 1MB Flash 192KB RAM LQFP-64",
        "specs": {
            "core": "ARM Cortex-M4F",
            "clock_mhz": 168,
            "flash_kb": 1024,
            "ram_kb": 192,
            "gpio": 51,
            "adc_channels": 16,
            "uart": 4,
            "spi": 3,
            "i2c": 3,
            "usb": "OTG FS/HS",
            "voltage_v": "1.8-3.6",
            "package": "LQFP-64",
        },
        "footprint": "LQFP-64_10x10mm_P0.5mm",
        "datasheet_url": "https://www.st.com/resource/en/datasheet/stm32f405rg.pdf",
    },
    {
        "mpn": "TPS54331DR",
        "manufacturer": "Texas Instruments",
        "category": "power",
        "description": "3A 28V input step-down DC-DC converter, 570kHz",
        "specs": {
            "topology": "buck",
            "vin_max_v": 28,
            "vout_range_v": "0.8-25",
            "iout_max_a": 3,
            "frequency_khz": 570,
            "efficiency_pct": 95,
            "package": "SOIC-8",
        },
        "footprint": "SOIC-8_3.9x4.9mm_P1.27mm",
        "datasheet_url": "https://www.ti.com/lit/ds/symlink/tps54331.pdf",
    },
    {
        "mpn": "SN65HVD230DR",
        "manufacturer": "Texas Instruments",
        "category": "interface",
        "description": "CAN bus transceiver 3.3V, 1Mbps, SOIC-8",
        "specs": {
            "protocol": "CAN 2.0",
            "data_rate_mbps": 1,
            "supply_v": 3.3,
            "standby_current_ua": 370,
            "nodes": 120,
            "package": "SOIC-8",
        },
        "footprint": "SOIC-8_3.9x4.9mm_P1.27mm",
        "datasheet_url": "https://www.ti.com/lit/ds/symlink/sn65hvd230.pdf",
    },
    {
        "mpn": "CRCW040210K0FKED",
        "manufacturer": "Vishay Dale",
        "category": "resistor",
        "description": "10K ohm 1% 0402 thin film precision resistor",
        "specs": {
            "resistance_ohm": 10000,
            "tolerance": "1%",
            "power_w": 0.063,
            "package": "0402",
            "temperature_coefficient_ppm": 50,
            "type": "thin_film",
        },
        "footprint": "R_0402_1005Metric",
        "datasheet_url": "https://www.vishay.com/docs/20035/dcrcw.pdf",
    },
    {
        "mpn": "BLM15AG121SN1D",
        "manufacturer": "Murata",
        "category": "ferrite_bead",
        "description": "120 ohm at 100MHz ferrite bead 0402, 300mA",
        "specs": {
            "impedance_ohm_100mhz": 120,
            "current_rating_ma": 300,
            "dcr_ohm": 0.28,
            "package": "0402",
        },
        "footprint": "L_0402_1005Metric",
        "datasheet_url": "https://www.murata.com/products/productdetail?partno=BLM15AG121SN1D",
    },
    {
        "mpn": "ECS-240-20-33-AEN-TR",
        "manufacturer": "ECS",
        "category": "crystal",
        "description": "24MHz crystal, 20pF load, 3.2x2.5mm",
        "specs": {
            "frequency_mhz": 24,
            "load_capacitance_pf": 20,
            "frequency_tolerance_ppm": 10,
            "esr_ohm": 40,
            "package": "3.2x2.5mm",
        },
        "footprint": "Crystal_SMD_3215-4Pin_3.2x1.5mm",
        "datasheet_url": "https://ecsxtal.com/store/pdf/ECS-240-20-33-AEN-TR.pdf",
    },
    {
        "mpn": "ESP32-WROOM-32E",
        "manufacturer": "Espressif",
        "category": "microcontroller",
        "description": "Wi-Fi + Bluetooth SoC module, dual-core 240MHz, 4MB Flash",
        "specs": {
            "core": "Xtensa LX6 dual-core",
            "clock_mhz": 240,
            "flash_kb": 4096,
            "ram_kb": 520,
            "wireless": "Wi-Fi 802.11 b/g/n, BT 4.2+BLE",
            "gpio": 34,
            "voltage_v": "3.0-3.6",
            "package": "Module 18x25.5mm",
        },
        "footprint": "ESP32-WROOM-32E",
        "datasheet_url": "https://www.espressif.com/sites/default/files/documentation/esp32-wroom-32e_datasheet_en.pdf",
    },
    {
        "mpn": "RP2040",
        "manufacturer": "Raspberry Pi",
        "category": "microcontroller",
        "description": "Dual-core ARM Cortex-M0+ 133MHz, QFN-56, USB 1.1",
        "specs": {
            "core": "Dual ARM Cortex-M0+",
            "clock_mhz": 133,
            "ram_kb": 264,
            "flash_kb": 0,
            "external_flash": "QSPI required",
            "gpio": 30,
            "pio": 8,
            "usb": "USB 1.1 device/host",
            "voltage_v": "1.8-3.3",
            "package": "QFN-56",
        },
        "footprint": "QFN-56-1EP_7x7mm_P0.4mm",
        "datasheet_url": "https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf",
    },
    {
        "mpn": "AMS1117-3.3",
        "manufacturer": "AMS",
        "category": "power",
        "description": "1A LDO voltage regulator, 3.3V fixed output, SOT-223",
        "specs": {
            "topology": "LDO",
            "vin_max_v": 12,
            "vout_v": 3.3,
            "iout_max_a": 1,
            "dropout_v": 1.1,
            "quiescent_current_ma": 5,
            "package": "SOT-223",
        },
        "footprint": "SOT-223-3_TabPin2",
        "datasheet_url": "http://www.advanced-monolithic.com/pdf/ds1117.pdf",
    },
    {
        "mpn": "NRF52840-QIAA",
        "manufacturer": "Nordic Semiconductor",
        "category": "microcontroller",
        "description": "BLE 5.0 SoC, ARM Cortex-M4F 64MHz, 1MB Flash, QFN-73",
        "specs": {
            "core": "ARM Cortex-M4F",
            "clock_mhz": 64,
            "flash_kb": 1024,
            "ram_kb": 256,
            "wireless": "Bluetooth 5.0, 802.15.4, NFC",
            "gpio": 48,
            "usb": "USB 2.0",
            "voltage_v": "1.7-5.5",
            "package": "QFN-73",
        },
        "footprint": "QFN-73-1EP_7x7mm",
        "datasheet_url": "https://infocenter.nordicsemi.com/pdf/nRF52840_PS_v1.7.pdf",
    },
    {
        "mpn": "LM2596S-5.0",
        "manufacturer": "Texas Instruments",
        "category": "power",
        "description": "3A 5V fixed step-down regulator, TO-263-5",
        "specs": {
            "topology": "buck",
            "vin_max_v": 40,
            "vout_v": 5.0,
            "iout_max_a": 3,
            "frequency_khz": 150,
            "package": "TO-263-5",
        },
        "footprint": "TO-263-5_TabPin3",
        "datasheet_url": "https://www.ti.com/lit/ds/symlink/lm2596.pdf",
    },
]

# ---------------------------------------------------------------------------
# Additional IPC-2221B data: Creepage and Current Capacity
# ---------------------------------------------------------------------------

IPC_2221B_CREEPAGE_DATA = [
    {
        "source": "IPC-2221B",
        "title": "IPC-2221B Creepage Distance Requirements",
        "category": "creepage",
        "content": (
            "IPC-2221B Creepage Distance Guidelines\n\n"
            "Creepage is the shortest path along the surface of insulating material "
            "between two conductors. Unlike clearance (air gap), creepage follows "
            "the board surface and is affected by pollution degree and CTI "
            "(Comparative Tracking Index) of the laminate.\n\n"
            "General rule of thumb for creepage on FR-4 (CTI 175-249, Material Group IIIb):\n"
            "- Pollution Degree 1 (sealed/clean): creepage >= clearance\n"
            "- Pollution Degree 2 (normal indoor): creepage = 1.5x to 2x clearance\n"
            "- Pollution Degree 3 (industrial): creepage = 2x to 4x clearance\n\n"
            "For mains-connected designs (>60V), always consult IEC 60950-1 / "
            "IEC 62368-1 safety standards which define specific creepage "
            "requirements based on working voltage, insulation type (functional, "
            "basic, supplementary, reinforced), and pollution degree.\n\n"
            "Slot or groove in the PCB surface can be used to increase effective "
            "creepage distance without increasing board size."
        ),
        "metadata": {"section": "6.3", "revision": "B", "topic": "creepage"},
    },
]

IPC_2221B_CURRENT_DATA = [
    {
        "source": "IPC-2221B",
        "title": "IPC-2221B Section 6.2: Conductor Width for Current Capacity",
        "category": "current_capacity",
        "content": (
            "IPC-2221B Section 6.2 - Conductor Sizing for Current Carrying Capacity\n\n"
            "Required trace width depends on current, allowable temperature rise, "
            "and copper thickness. For 1 oz copper (35 um) on external layers:\n\n"
            "Current | 10C rise | 20C rise | 30C rise\n"
            "0.5A    | 0.18 mm  | 0.13 mm  | 0.10 mm\n"
            "1.0A    | 0.50 mm  | 0.33 mm  | 0.25 mm\n"
            "2.0A    | 1.35 mm  | 0.90 mm  | 0.70 mm\n"
            "3.0A    | 2.55 mm  | 1.70 mm  | 1.30 mm\n"
            "5.0A    | 5.80 mm  | 3.90 mm  | 3.00 mm\n"
            "10.0A   | 17.0 mm  | 11.2 mm  | 8.70 mm\n\n"
            "Internal layers have approximately half the current capacity of "
            "external layers for the same width due to reduced heat dissipation. "
            "Use IPC-2152 for more precise calculations with thermal modeling.\n\n"
            "The IPC-2152 standard supersedes the charts in IPC-2221B with a more "
            "accurate thermal model that accounts for board thickness, copper "
            "distribution, and ambient conditions."
        ),
        "metadata": {"section": "6.2", "revision": "B", "topic": "current_capacity"},
    },
]

# ---------------------------------------------------------------------------
# Reference Design Summaries (10 designs)
# ---------------------------------------------------------------------------

REFERENCE_DESIGNS = [
    {
        "source": "ST Discovery Board (UM1472)",
        "title": "STM32F4 Discovery Board Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: STM32F4 Discovery Board\n\n"
            "MCU: STM32F407VGT6 (Cortex-M4, 168 MHz, LQFP-100)\n"
            "Layer stack: 4-layer, 1.6mm (Signal/GND/Power/Signal)\n"
            "Power: USB 5V -> AMS1117-3.3 -> 3.3V. Ferrite bead for VDDA.\n"
            "Decoupling: 100nF per VDD, 1uF on VDDA, 4.7uF bulk.\n"
            "Peripherals: USB OTG, audio codec CS43L22, accelerometer LIS302DL.\n"
            "Impedance: 50 ohm SE for USB, 90 ohm differential USB D+/D-."
        ),
        "metadata": {"domain": "reference_design", "board": "STM32F4-Discovery"},
    },
    {
        "source": "Raspberry Pi Pico hardware design",
        "title": "Raspberry Pi Pico Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: Raspberry Pi Pico\n\n"
            "MCU: RP2040 (dual Cortex-M0+, 133 MHz, QFN-56)\n"
            "Layer stack: 4-layer, 1.0mm.\n"
            "Power: USB 5V -> RT6150B buck-boost -> 3.3V (600mA).\n"
            "QSPI Flash: W25Q16JVUXIQ, 6 lines matched +/- 0.5mm, 50 ohm.\n"
            "USB: 27 ohm series resistors, 90 ohm diff pair, 0.15mm max skew.\n"
            "Crystal: 12MHz ABM8-272-T3 with 15pF load caps."
        ),
        "metadata": {"domain": "reference_design", "board": "Raspberry-Pi-Pico"},
    },
    {
        "source": "ESP32-DevKitC V4 schematic (Espressif)",
        "title": "ESP32 DevKit V1 Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: ESP32 DevKit V1\n\n"
            "Module: ESP32-WROOM-32 (Wi-Fi + BLE)\n"
            "Layer stack: 2-layer, 1.6mm.\n"
            "Power: USB 5V -> AMS1117-3.3 -> 3.3V.\n"
            "USB-UART bridge: CP2102 or CH340, auto-reset circuit.\n"
            "RF: No copper under antenna on both layers. Board edge past antenna.\n"
            "Decoupling: 10uF + 100nF on 3V3 near module."
        ),
        "metadata": {"domain": "reference_design", "board": "ESP32-DevKitC-V4"},
    },
    {
        "source": "Arduino Uno R3 Eagle schematic",
        "title": "Arduino Uno R3 Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: Arduino Uno R3\n\n"
            "MCU: ATmega328P (8-bit AVR, 16 MHz)\n"
            "Layer stack: 2-layer, 1.6mm.\n"
            "Power: DC jack 7-12V or USB 5V. NCP1117-5.0 and NCP1117-3.3.\n"
            "USB: ATmega16U2 bridge, full-speed USB 1.1, 22 ohm series resistors.\n"
            "Crystal: 16MHz with 22pF load caps, traces on same layer as MCU."
        ),
        "metadata": {"domain": "reference_design", "board": "Arduino-Uno-R3"},
    },
    {
        "source": "STM32MP1 DDR4 Guidelines (AN5122)",
        "title": "DDR4 Memory Interface Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: DDR4 Memory Interface (STM32MP1)\n\n"
            "MCU: STM32MP157 with 32-bit DDR4 at 533 MHz.\n"
            "Layer stack: 8-layer (Signal/GND/DDR-Data/VDDQ/GND/DDR-Addr/GND/Signal).\n"
            "Impedance: DQ/DM 50 ohm SE, DQS/CK 100 ohm diff.\n"
            "Length matching: DQ-to-DQS +/- 5 mils per byte lane, CK-to-CMD +/- 25 mils.\n"
            "Termination: ODT on DDR4 chip, VTT = VDDQ/2 = 0.6V."
        ),
        "metadata": {"domain": "reference_design", "board": "STM32MP1-DDR4"},
    },
    {
        "source": "STUSB4500 Evaluation Board (STEVAL-ISC005V1)",
        "title": "USB-PD Sink Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: USB-PD Sink (STUSB4500)\n\n"
            "Controller: STUSB4500 (QFN-24), standalone USB-PD negotiation.\n"
            "Layer stack: 2-layer, 1.0mm.\n"
            "Negotiates 5V/9V/15V/20V from USB-PD source.\n"
            "CC pins: 5.1K pull-downs. VBUS: 10uF + 100nF decoupling.\n"
            "VBUS traces: 0.5mm min width for 3A. CC traces < 50mm."
        ),
        "metadata": {"domain": "reference_design", "board": "STUSB4500-EVB"},
    },
    {
        "source": "Nordic IoT reference, Semtech SX1276 app note",
        "title": "4-Layer IoT Sensor Node Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: IoT Sensor Node (BLE + LoRa)\n\n"
            "MCU: nRF52840 (BLE 5.0), Radio: SX1276 (LoRa 868/915 MHz).\n"
            "Layer stack: 4-layer, 0.8mm (Signal-RF/GND/Power/Signal).\n"
            "Power: CR2032 -> TPS62740 buck (90% eff at 10mA). Sleep < 5uA.\n"
            "RF: Separate BLE (2.4GHz) and LoRa antennas on opposite edges.\n"
            "No ground under antenna areas. Pi-network matching on both.\n"
            "Sensors: BME280 + LIS2DH12 on I2C with 4.7K pull-ups."
        ),
        "metadata": {"domain": "reference_design", "board": "IoT-Sensor-Node"},
    },
    {
        "source": "DRV8301 EVM user guide (SLVU571, TI)",
        "title": "BLDC Motor Driver Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: 3-Phase BLDC Motor Driver (DRV8301)\n\n"
            "Driver: DRV8301 + 6x CSD18540Q5B MOSFETs, STM32F405 controller.\n"
            "Layer stack: 4-layer, 2.0mm, 2 oz copper on L1/L4.\n"
            "Critical: Minimize gate drive loops. Phase paths 3mm+ wide.\n"
            "Kelvin sense: differential route from shunt to DRV8301 SOx pins.\n"
            "Thermal: MOSFET drain pads via array to ground. Separate AGND/PGND."
        ),
        "metadata": {"domain": "reference_design", "board": "DRV8301-BLDC"},
    },
    {
        "source": "PCM5102A Datasheet (SLAS764E, TI)",
        "title": "Audio DAC Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: Audio DAC (PCM5102A)\n\n"
            "DAC: PCM5102A (32-bit, 112dB SNR, I2S input).\n"
            "Layer stack: 4-layer, 1.6mm (Signal/GND/Power/Signal).\n"
            "Power: Separate AVDD and DVDD 3.3V with ferrite bead.\n"
            "Layout: No ground splits under DAC. I2S traces away from analog out.\n"
            "Analog output: 470 ohm + 2.2nF EMI filter. 220uF coupling caps.\n"
            "Clock jitter < 50ps for good audio quality."
        ),
        "metadata": {"domain": "reference_design", "board": "PCM5102A-DAC"},
    },
    {
        "source": "LAN8720A Datasheet (DS00002165B, Microchip)",
        "title": "Ethernet PHY Reference Design",
        "category": "reference_design",
        "content": (
            "Reference Design: 10/100 Ethernet PHY (LAN8720A)\n\n"
            "PHY: LAN8720A (RMII interface, QFN-24).\n"
            "Layer stack: 4-layer, 1.6mm.\n"
            "RMII: 6 signals at 50 MHz, 50 ohm impedance, matched +/- 1mm.\n"
            "Magnetics: Integrated RJ45 (HR911105A) or separate transformer.\n"
            "TX/RX pairs: 100 ohm differential, traces < 25mm to PHY.\n"
            "25MHz crystal within 10mm. Separate analog ground under PHY."
        ),
        "metadata": {"domain": "reference_design", "board": "LAN8720A-ETH"},
    },
]


# ---------------------------------------------------------------------------
# Placeholder embedding (zero vector for seeding; real embeddings from model)
# ---------------------------------------------------------------------------

def _placeholder_embedding(text: str) -> list[float]:
    """Generate a deterministic pseudo-embedding from text hash.

    In production, this would call an embedding model (e.g., OpenAI text-embedding-3-small).
    For seeding, we generate a repeatable 1536-dim vector from the content hash.
    """
    digest = hashlib.sha512(text.encode()).digest()
    values: list[float] = []
    for i in range(0, min(len(digest), 1536), 1):
        values.append((digest[i % len(digest)] - 128) / 128.0)
    while len(values) < 1536:
        idx = len(values)
        val = ((digest[idx % len(digest)] + idx) % 256 - 128) / 128.0
        values.append(val)
    return values[:1536]


def _embedding_literal(vec: list[float]) -> str:
    """Convert a float list to a pgvector literal string."""
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


# ---------------------------------------------------------------------------
# Seeding logic
# ---------------------------------------------------------------------------

def seed_database(db_url: str) -> dict[str, int]:
    """Create tables and seed data. Returns counts of inserted rows."""
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    # Create schema
    print("Creating schema and indexes...")
    cur.execute(SCHEMA_SQL)
    conn.commit()

    stats: dict[str, int] = {"documents": 0, "chunks": 0, "components": 0}

    # Seed IPC documents (clearance, creepage, current capacity, impedance)
    all_docs = (
        IPC_2221B_CLEARANCE_DATA
        + IPC_2221B_CREEPAGE_DATA
        + IPC_2221B_CURRENT_DATA
        + IPC_2141_IMPEDANCE_DATA
    )
    print(f"Seeding {len(all_docs)} IPC standard documents...")

    for doc in all_docs:
        doc_hash = hashlib.sha256(doc["content"].encode()).hexdigest()

        cur.execute(
            """
            INSERT INTO rag_documents (doc_hash, source, title, category, content, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (doc_hash) DO NOTHING
            RETURNING id
            """,
            (
                doc_hash,
                doc["source"],
                doc["title"],
                doc["category"],
                doc["content"],
                psycopg2.extras.Json(doc.get("metadata", {})),
            ),
        )
        row = cur.fetchone()
        if row is None:
            # Already exists, look up the id
            cur.execute("SELECT id FROM rag_documents WHERE doc_hash = %s", (doc_hash,))
            row = cur.fetchone()
            if row is None:
                continue
        doc_id = row[0]
        stats["documents"] += 1

        # Split content into chunks (simple paragraph-based splitting)
        paragraphs = [p.strip() for p in doc["content"].split("\n\n") if p.strip()]
        for idx, paragraph in enumerate(paragraphs):
            embedding = _placeholder_embedding(paragraph)
            cur.execute(
                """
                INSERT INTO rag_chunks (document_id, chunk_index, content, embedding, metadata)
                VALUES (%s, %s, %s, %s::vector, %s)
                ON CONFLICT (document_id, chunk_index) DO NOTHING
                """,
                (
                    doc_id,
                    idx,
                    paragraph,
                    _embedding_literal(embedding),
                    psycopg2.extras.Json({"source": doc["source"], "category": doc["category"]}),
                ),
            )
            stats["chunks"] += 1

    conn.commit()

    # Seed component data
    print(f"Seeding {len(SAMPLE_COMPONENTS)} component records...")
    for comp in SAMPLE_COMPONENTS:
        embedding = _placeholder_embedding(f"{comp['mpn']} {comp['description']}")
        cur.execute(
            """
            INSERT INTO rag_components (mpn, manufacturer, category, description, specs, footprint, datasheet_url, embedding)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)
            ON CONFLICT (mpn) DO NOTHING
            """,
            (
                comp["mpn"],
                comp["manufacturer"],
                comp["category"],
                comp["description"],
                psycopg2.extras.Json(comp["specs"]),
                comp.get("footprint"),
                comp.get("datasheet_url"),
                _embedding_literal(embedding),
            ),
        )
        stats["components"] += 1

    conn.commit()

    # Seed reference design summaries
    print(f"Seeding {len(REFERENCE_DESIGNS)} reference design summaries...")
    for doc in REFERENCE_DESIGNS:
        doc_hash = hashlib.sha256(doc["content"].encode()).hexdigest()

        cur.execute(
            """
            INSERT INTO rag_documents (doc_hash, source, title, category, content, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (doc_hash) DO NOTHING
            RETURNING id
            """,
            (
                doc_hash,
                doc["source"],
                doc["title"],
                doc["category"],
                doc["content"],
                psycopg2.extras.Json(doc.get("metadata", {})),
            ),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute("SELECT id FROM rag_documents WHERE doc_hash = %s", (doc_hash,))
            row = cur.fetchone()
            if row is None:
                continue
        doc_id = row[0]
        stats["documents"] += 1

        # Create a single chunk per reference design summary
        embedding = _placeholder_embedding(doc["content"])
        cur.execute(
            """
            INSERT INTO rag_chunks (document_id, chunk_index, content, embedding, metadata)
            VALUES (%s, %s, %s, %s::vector, %s)
            ON CONFLICT (document_id, chunk_index) DO NOTHING
            """,
            (
                doc_id,
                0,
                doc["content"],
                _embedding_literal(embedding),
                psycopg2.extras.Json({"source": doc["source"], "category": doc["category"]}),
            ),
        )
        stats["chunks"] += 1

    conn.commit()
    cur.close()
    conn.close()

    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the RouteAI RAG database")
    parser.add_argument(
        "--db-url",
        default="postgresql://routeai:routeai_dev@localhost:5432/routeai",
        help="PostgreSQL connection URL",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("RouteAI RAG Database Seeder")
    print("=" * 60)
    print(f"Database: {args.db_url.split('@')[1] if '@' in args.db_url else args.db_url}")

    try:
        stats = seed_database(args.db_url)
    except Exception as e:
        print(f"\nERROR: {e}")
        print("Make sure PostgreSQL is running and pgvector extension is available.")
        sys.exit(1)

    print("\n--- Seed Results ---")
    print(f"  Documents inserted:  {stats['documents']}")
    print(f"  Chunks inserted:     {stats['chunks']}")
    print(f"  Components inserted: {stats['components']}")
    n_ipc = len(IPC_2221B_CLEARANCE_DATA) + len(IPC_2221B_CREEPAGE_DATA) + len(IPC_2221B_CURRENT_DATA) + len(IPC_2141_IMPEDANCE_DATA)
    print(f"  ({n_ipc} IPC docs, {len(SAMPLE_COMPONENTS)} components, {len(REFERENCE_DESIGNS)} reference designs)")
    print("\nDone.")


if __name__ == "__main__":
    main()
