"""Component search API — proxies to multiple sources avoiding CORS issues.

Endpoints:
  GET /api/components/search?q=STM32&category=ic&limit=40
  GET /api/components/browse?category=capacitor&limit=100
"""

from __future__ import annotations

import asyncio
import json as _json_mod
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/components", tags=["components"])


class ComponentResult(BaseModel):
    mpn: str
    manufacturer: str
    description: str
    category: str
    package: str
    source: str  # "lcsc", "kicad", "snapeda", "easyeda", "local"
    stock: int | None = None
    price_usd: float | None = None
    datasheet_url: str | None = None
    lcsc_code: str | None = None
    has_symbol: bool = False
    has_footprint: bool = False


# ---------------------------------------------------------------------------
# Built-in component database (common parts)
# ---------------------------------------------------------------------------

_BUILTIN_COMPONENTS: list[dict[str, Any]] = [
    # --- Resistors ---
    {"mpn": "RC0402FR-0710KL", "manufacturer": "Yageo", "description": "10K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-071KL", "manufacturer": "Yageo", "description": "1K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-074K7L", "manufacturer": "Yageo", "description": "4.7K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07100KL", "manufacturer": "Yageo", "description": "100K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-0710KL", "manufacturer": "Yageo", "description": "10K Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-0710KL", "manufacturer": "Yageo", "description": "10K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERJ-2RKF1002X", "manufacturer": "Panasonic", "description": "10K Ohm 1% 0402 Thin Film", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Capacitors ---
    {"mpn": "CL05B104KO5NNNC", "manufacturer": "Samsung", "description": "100nF 16V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM155R61A105KE15D", "manufacturer": "Murata", "description": "1uF 10V X5R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL10B104KB8NNNC", "manufacturer": "Samsung", "description": "100nF 50V X7R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM21BR61C106KE15L", "manufacturer": "Murata", "description": "10uF 16V X5R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL21B104KBCNNNC", "manufacturer": "Samsung", "description": "100nF 50V X7R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C0402C200J5GACTU", "manufacturer": "KEMET", "description": "20pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- MCUs ---
    {"mpn": "STM32F103C8T6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M3 MCU 72MHz 64KB Flash LQFP-48", "category": "mcu", "package": "LQFP-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 2.50},
    {"mpn": "STM32F401CCU6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 84MHz 256KB Flash UFQFPN-48", "category": "mcu", "package": "UFQFPN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 3.80},
    {"mpn": "STM32F411CEU6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 100MHz 512KB Flash UFQFPN-48", "category": "mcu", "package": "UFQFPN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 4.50},
    {"mpn": "STM32G431CBU6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 170MHz 128KB Flash UFQFPN-48", "category": "mcu", "package": "UFQFPN-48", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ESP32-WROOM-32E", "manufacturer": "Espressif", "description": "Wi-Fi+BLE MCU Module 240MHz Dual-Core", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 2.80},
    {"mpn": "ESP32-S3-WROOM-1", "manufacturer": "Espressif", "description": "Wi-Fi+BLE5 MCU Module AI acceleration", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 3.50},
    {"mpn": "RP2040", "manufacturer": "Raspberry Pi", "description": "Dual ARM Cortex-M0+ 133MHz MCU", "category": "mcu", "package": "QFN-56", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.80},
    {"mpn": "ATMEGA328P-AU", "manufacturer": "Microchip", "description": "8-bit AVR MCU 20MHz 32KB Flash TQFP-32", "category": "mcu", "package": "TQFP-32", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 2.20},
    {"mpn": "nRF52840-QIAA-R", "manufacturer": "Nordic", "description": "BLE5.3 MCU ARM Cortex-M4F 64MHz", "category": "mcu", "package": "QFN-73", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Regulators ---
    {"mpn": "AMS1117-3.3", "manufacturer": "AMS", "description": "3.3V 1A LDO Regulator SOT-223", "category": "regulator", "package": "SOT-223", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.15},
    {"mpn": "AP2112K-3.3TRG1", "manufacturer": "Diodes Inc", "description": "3.3V 600mA LDO Low Noise SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.25},
    {"mpn": "TPS54331DR", "manufacturer": "Texas Instruments", "description": "3.5-28V 3A Step-Down Buck Converter SOIC-8", "category": "regulator", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 1.20},
    {"mpn": "MP2315GJ-Z", "manufacturer": "MPS", "description": "4.5-24V 3A Sync Buck Converter SOT-23-8", "category": "regulator", "package": "SOT-23-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.60},
    {"mpn": "TLV1117LV33DCYR", "manufacturer": "Texas Instruments", "description": "3.3V 1A LDO Low Dropout SOT-223", "category": "regulator", "package": "SOT-223", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "XC6206P332MR", "manufacturer": "Torex", "description": "3.3V 200mA LDO Ultra-Low Power SOT-23", "category": "regulator", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.10},
    # --- Connectors ---
    {"mpn": "USB4085-GF-A", "manufacturer": "GCT", "description": "USB Type-C Receptacle 24-pin SMD", "category": "connector", "package": "USB-C", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.50},
    {"mpn": "10118192-0001LF", "manufacturer": "Amphenol", "description": "Micro USB Type-B Receptacle SMD", "category": "connector", "package": "Micro-USB", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PJ-320A", "manufacturer": "CUI", "description": "3.5mm Audio Jack 3-Pin TH", "category": "connector", "package": "TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "B2B-XH-A", "manufacturer": "JST", "description": "XH 2-Pin Header 2.5mm Pitch", "category": "connector", "package": "XH-2P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "0022232041", "manufacturer": "Molex", "description": "KK 4-Pin Header 2.54mm Pitch", "category": "connector", "package": "KK-4P", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- ESD / Protection ---
    {"mpn": "USBLC6-2SC6", "manufacturer": "STMicroelectronics", "description": "ESD Protection for USB SOT-23-6", "category": "protection", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.15},
    {"mpn": "PRTR5V0U2X", "manufacturer": "Nexperia", "description": "ESD Protection for USB SOT-143B", "category": "protection", "package": "SOT-143B", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PESD5V0S1BA", "manufacturer": "Nexperia", "description": "ESD TVS Diode 5V Unidirectional SOD-323", "category": "protection", "package": "SOD-323", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Crystals ---
    {"mpn": "NX3225GD-8MHZ", "manufacturer": "NDK", "description": "8MHz Crystal 12pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.30},
    {"mpn": "ABM8-272-T3", "manufacturer": "Abracon", "description": "8MHz Crystal 18pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "FA-238 25MHz", "manufacturer": "Epson", "description": "25MHz Crystal 10pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- LEDs ---
    {"mpn": "LTST-C171KRKT", "manufacturer": "Lite-On", "description": "Red LED 0603 2V 20mA", "category": "led", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 500000, "price_usd": 0.03},
    {"mpn": "LTST-C171GKT", "manufacturer": "Lite-On", "description": "Green LED 0603 2.2V 20mA", "category": "led", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 500000, "price_usd": 0.03},
    {"mpn": "LTST-C171TBKT", "manufacturer": "Lite-On", "description": "Blue LED 0603 3.2V 20mA", "category": "led", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "WS2812B", "manufacturer": "Worldsemi", "description": "RGB LED Addressable 5050 NeoPixel", "category": "led", "package": "5050", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.08},
    # --- Inductors ---
    {"mpn": "NR3015T4R7M", "manufacturer": "Taiyo Yuden", "description": "4.7uH 1.4A Shielded Inductor 3x3mm", "category": "inductor", "package": "3015", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SRN4018-4R7M", "manufacturer": "Bourns", "description": "4.7uH 1.8A Semi-Shielded Inductor 4x4mm", "category": "inductor", "package": "4018", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "IHLP2525CZER4R7M01", "manufacturer": "Vishay", "description": "4.7uH 5.5A Shielded Inductor 6.5x6.5mm", "category": "inductor", "package": "2525", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Diodes ---
    {"mpn": "BAT54S", "manufacturer": "Nexperia", "description": "Schottky Dual Diode 30V 200mA SOT-23", "category": "diode", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SS14", "manufacturer": "MDD", "description": "Schottky Diode 40V 1A SMA", "category": "diode", "package": "SMA", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "1N4148W", "manufacturer": "Nexperia", "description": "Switching Diode 75V 150mA SOD-123", "category": "diode", "package": "SOD-123", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Transistors ---
    {"mpn": "2N7002", "manufacturer": "Nexperia", "description": "N-MOSFET 60V 300mA SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 300000, "price_usd": 0.02},
    {"mpn": "AO3401A", "manufacturer": "Alpha & Omega", "description": "P-MOSFET -30V -4A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MMBT3904", "manufacturer": "ON Semi", "description": "NPN Transistor 40V 200mA SOT-23", "category": "transistor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MMBT3906", "manufacturer": "ON Semi", "description": "PNP Transistor -40V -200mA SOT-23", "category": "transistor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- ICs ---
    {"mpn": "CH340G", "manufacturer": "WCH", "description": "USB to UART Bridge IC SOP-16", "category": "ic", "package": "SOP-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.40},
    {"mpn": "CP2102N-A02-GQFN28", "manufacturer": "Silicon Labs", "description": "USB to UART Bridge QFN-28", "category": "ic", "package": "QFN-28", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "W25Q128JVSIQ", "manufacturer": "Winbond", "description": "128Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 1.50},
    {"mpn": "24LC256-I/SN", "manufacturer": "Microchip", "description": "256Kbit I2C EEPROM SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MCP2515-I/SO", "manufacturer": "Microchip", "description": "CAN Controller SPI SOIC-18", "category": "interface", "package": "SOIC-18", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MAX485ESA+T", "manufacturer": "Maxim", "description": "RS-485 Transceiver SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SN65HVD230DR", "manufacturer": "Texas Instruments", "description": "CAN Transceiver 3.3V SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True},
    # --- Sensors ---
    {"mpn": "BME280", "manufacturer": "Bosch", "description": "Temperature/Humidity/Pressure Sensor LGA-8", "category": "sensor", "package": "LGA-8", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MPU-6050", "manufacturer": "InvenSense", "description": "6-Axis IMU Accelerometer+Gyroscope QFN-24", "category": "sensor", "package": "QFN-24", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "INA219AIDR", "manufacturer": "Texas Instruments", "description": "Current/Power Monitor I2C SOIC-8", "category": "sensor", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True},

    # ===================================================================
    # EXPANDED COMPONENT DATABASE
    # ===================================================================

    # --- Resistors (additional) ---
    {"mpn": "RC0402FR-070RL", "manufacturer": "Yageo", "description": "0 Ohm Jumper 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-071RL", "manufacturer": "Yageo", "description": "1 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-074R7L", "manufacturer": "Yageo", "description": "4.7 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-0722RL", "manufacturer": "Yageo", "description": "22 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-0747RL", "manufacturer": "Yageo", "description": "47 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07100RL", "manufacturer": "Yageo", "description": "100 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07220RL", "manufacturer": "Yageo", "description": "220 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07470RL", "manufacturer": "Yageo", "description": "470 Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-072K2L", "manufacturer": "Yageo", "description": "2.2K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-073K3L", "manufacturer": "Yageo", "description": "3.3K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-0722KL", "manufacturer": "Yageo", "description": "22K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-0747KL", "manufacturer": "Yageo", "description": "47K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07220KL", "manufacturer": "Yageo", "description": "220K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-07470KL", "manufacturer": "Yageo", "description": "470K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0402FR-071ML", "manufacturer": "Yageo", "description": "1M Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-0710RL", "manufacturer": "Yageo", "description": "10 Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-07100RL", "manufacturer": "Yageo", "description": "100 Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-071KL", "manufacturer": "Yageo", "description": "1K Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-074K7L", "manufacturer": "Yageo", "description": "4.7K Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0603FR-07100KL", "manufacturer": "Yageo", "description": "100K Ohm 1% 0603 Resistor", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERJ-3EKF1001V", "manufacturer": "Panasonic", "description": "1K Ohm 1% 0603 Thick Film", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERJ-3EKF1002V", "manufacturer": "Panasonic", "description": "10K Ohm 1% 0603 Thick Film", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERJ-6ENF1002V", "manufacturer": "Panasonic", "description": "10K Ohm 1% 0805 Thick Film", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERJ-8ENF1001V", "manufacturer": "Panasonic", "description": "1K Ohm 1% 1206 Thick Film", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CRCW040210K0FKED", "manufacturer": "Vishay", "description": "10K Ohm 1% 0402 Thick Film", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CRCW06034K70FKEA", "manufacturer": "Vishay", "description": "4.7K Ohm 1% 0603 Thick Film", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CRCW0805100KFKEA", "manufacturer": "Vishay", "description": "100K Ohm 1% 0805 Thick Film", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC2012F103CS", "manufacturer": "Samsung", "description": "10K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1005F102CS", "manufacturer": "Samsung", "description": "1K Ohm 1% 0402 Resistor", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0201FR-070RL", "manufacturer": "Yageo", "description": "0 Ohm Jumper 0201 Resistor", "category": "resistor", "package": "0201", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0201FR-0710KL", "manufacturer": "Yageo", "description": "10K Ohm 1% 0201 Resistor", "category": "resistor", "package": "0201", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "ERA-2AEB103X", "manufacturer": "Panasonic", "description": "10K Ohm 0.1% 0402 Precision Thin Film", "category": "resistor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RT0603BRD071KL", "manufacturer": "Yageo", "description": "1K Ohm 0.1% 0603 Precision Thin Film", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MCR03EZPFX1002", "manufacturer": "Rohm", "description": "10K Ohm 1% 0603 Thick Film", "category": "resistor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Capacitors (additional) ---
    {"mpn": "CL05C010CB5NNNC", "manufacturer": "Samsung", "description": "1pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05C100JB5NNNC", "manufacturer": "Samsung", "description": "10pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05C220JB5NNNC", "manufacturer": "Samsung", "description": "22pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05C330JB5NNNC", "manufacturer": "Samsung", "description": "33pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05C470JB5NNNC", "manufacturer": "Samsung", "description": "47pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05C101JB5NNNC", "manufacturer": "Samsung", "description": "100pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05B102KB5NNNC", "manufacturer": "Samsung", "description": "1nF 50V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05B103KB5NNNC", "manufacturer": "Samsung", "description": "10nF 50V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05B223KB5NNNC", "manufacturer": "Samsung", "description": "22nF 50V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05B473KB5NNNC", "manufacturer": "Samsung", "description": "47nF 50V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05A224KA5NNNC", "manufacturer": "Samsung", "description": "220nF 25V X5R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL05A474KA5NNNC", "manufacturer": "Samsung", "description": "470nF 25V X5R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM155R71C104KA88D", "manufacturer": "Murata", "description": "100nF 16V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM155R60J225ME15D", "manufacturer": "Murata", "description": "2.2uF 6.3V X5R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM188R61A475KE34D", "manufacturer": "Murata", "description": "4.7uF 10V X5R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM188R71C104KA01D", "manufacturer": "Murata", "description": "100nF 16V X7R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM21BR61C226ME44L", "manufacturer": "Murata", "description": "22uF 16V X5R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM31CR61C476ME15L", "manufacturer": "Murata", "description": "47uF 16V X5R 1206 MLCC", "category": "capacitor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "GRM32ER61A107ME20L", "manufacturer": "Murata", "description": "100uF 10V X5R 1210 MLCC", "category": "capacitor", "package": "1210", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C0603C104K5RACTU", "manufacturer": "KEMET", "description": "100nF 50V X7R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C0805C106K9PACTU", "manufacturer": "KEMET", "description": "10uF 6.3V X5R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C0402C220J5GACTU", "manufacturer": "KEMET", "description": "22pF 50V C0G 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C1206C475K5PACTU", "manufacturer": "KEMET", "description": "4.7uF 50V X5R 1206 MLCC", "category": "capacitor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "C0G0603100JNTA", "manufacturer": "TDK", "description": "10pF 50V C0G 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CGA3E2X7R1H104K080AA", "manufacturer": "TDK", "description": "100nF 50V X7R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CGA4J1X5R1C106K125AC", "manufacturer": "TDK", "description": "10uF 16V X5R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CC0402KRX7R7BB104", "manufacturer": "Yageo", "description": "100nF 16V X7R 0402 MLCC", "category": "capacitor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CC0603KRX7R9BB104", "manufacturer": "Yageo", "description": "100nF 50V X7R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "T491A106K010AT", "manufacturer": "KEMET", "description": "10uF 10V Tantalum Capacitor A-case", "category": "capacitor", "package": "A-1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "T491B226K016AT", "manufacturer": "KEMET", "description": "22uF 16V Tantalum Capacitor B-case", "category": "capacitor", "package": "B-3528", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "T491C476K010AT", "manufacturer": "KEMET", "description": "47uF 10V Tantalum Capacitor C-case", "category": "capacitor", "package": "C-6032", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "T491D107K010AT", "manufacturer": "KEMET", "description": "100uF 10V Tantalum Capacitor D-case", "category": "capacitor", "package": "D-7343", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "UWT1C101MCL1GS", "manufacturer": "Nichicon", "description": "100uF 16V Electrolytic 6.3x5.8mm", "category": "capacitor", "package": "6.3x5.8", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "UWT1E470MCL1GS", "manufacturer": "Nichicon", "description": "47uF 25V Electrolytic 6.3x5.8mm", "category": "capacitor", "package": "6.3x5.8", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "860020672012", "manufacturer": "Wurth", "description": "22uF 25V Electrolytic Aluminum Polymer", "category": "capacitor", "package": "5x5.3", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- MCUs (additional) ---
    {"mpn": "STM32F030F4P6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M0 MCU 48MHz 16KB Flash TSSOP-20", "category": "mcu", "package": "TSSOP-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 1.00},
    {"mpn": "STM32F103RCT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M3 MCU 72MHz 256KB Flash LQFP-64", "category": "mcu", "package": "LQFP-64", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 3.50},
    {"mpn": "STM32F303CCT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 72MHz 256KB Flash LQFP-48", "category": "mcu", "package": "LQFP-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 3.80},
    {"mpn": "STM32F407VGT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 168MHz 1MB Flash LQFP-100", "category": "mcu", "package": "LQFP-100", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 8.50},
    {"mpn": "STM32F746ZGT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M7 MCU 216MHz 1MB Flash LQFP-144", "category": "mcu", "package": "LQFP-144", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 12.00},
    {"mpn": "STM32H743VIT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M7 MCU 480MHz 2MB Flash LQFP-100", "category": "mcu", "package": "LQFP-100", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 8000, "price_usd": 15.00},
    {"mpn": "STM32L031K6T6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M0+ MCU Ultra-Low-Power 32KB LQFP-32", "category": "mcu", "package": "LQFP-32", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 1.50},
    {"mpn": "STM32L431KCU6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU Low-Power 256KB UFQFPN-32", "category": "mcu", "package": "UFQFPN-32", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 4.00},
    {"mpn": "STM32G071RBT6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M0+ MCU 64MHz 128KB LQFP-64", "category": "mcu", "package": "LQFP-64", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 2.80},
    {"mpn": "STM32G474RET6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 MCU 170MHz 512KB LQFP-64", "category": "mcu", "package": "LQFP-64", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 6.50},
    {"mpn": "STM32U575ZIT6Q", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M33 MCU Ultra-Low-Power 2MB LQFP-144", "category": "mcu", "package": "LQFP-144", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 5000, "price_usd": 10.00},
    {"mpn": "STM32WB55CEU6", "manufacturer": "STMicroelectronics", "description": "ARM Cortex-M4 BLE5.0 MCU 64MHz 512KB UFQFPN-48", "category": "mcu", "package": "UFQFPN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 12000, "price_usd": 6.00},
    {"mpn": "ESP32-S2-WROOM-I", "manufacturer": "Espressif", "description": "Wi-Fi MCU Module 240MHz Single-Core", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 2.50},
    {"mpn": "ESP32-C3-WROOM-02", "manufacturer": "Espressif", "description": "Wi-Fi+BLE5 RISC-V MCU Module", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 2.00},
    {"mpn": "ESP32-C6-WROOM-1", "manufacturer": "Espressif", "description": "Wi-Fi 6+BLE5+802.15.4 RISC-V MCU Module", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 3.00},
    {"mpn": "ESP32-H2-MINI-1", "manufacturer": "Espressif", "description": "BLE5+802.15.4 Thread/Zigbee RISC-V Module", "category": "mcu", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.20},
    {"mpn": "nRF52832-QFAA-R", "manufacturer": "Nordic", "description": "BLE5.0 MCU ARM Cortex-M4F 64MHz 512KB QFN-48", "category": "mcu", "package": "QFN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 3.50},
    {"mpn": "nRF52833-QIAA-R", "manufacturer": "Nordic", "description": "BLE5.1+Direction Finding MCU ARM Cortex-M4F QFN-40", "category": "mcu", "package": "QFN-40", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 3.80},
    {"mpn": "nRF5340-QKAA-R", "manufacturer": "Nordic", "description": "Dual ARM Cortex-M33 BLE5.3 MCU QFN-94", "category": "mcu", "package": "QFN-94", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 6.00},
    {"mpn": "ATSAMD21G18A-MUT", "manufacturer": "Microchip", "description": "ARM Cortex-M0+ MCU 48MHz 256KB QFN-48", "category": "mcu", "package": "QFN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 3.00},
    {"mpn": "ATSAME51J20A-AU", "manufacturer": "Microchip", "description": "ARM Cortex-M4F MCU 120MHz 1MB TQFP-64", "category": "mcu", "package": "TQFP-64", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 5.50},
    {"mpn": "PIC16F1459-I/SS", "manufacturer": "Microchip", "description": "8-bit PIC MCU USB 48MHz 14KB SSOP-20", "category": "mcu", "package": "SSOP-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "PIC18F26K83-I/SO", "manufacturer": "Microchip", "description": "8-bit PIC MCU CAN 64MHz 64KB SOIC-28", "category": "mcu", "package": "SOIC-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 2.50},
    {"mpn": "PIC32MX270F256B-I/SO", "manufacturer": "Microchip", "description": "32-bit PIC MCU MIPS 50MHz 256KB SOIC-28", "category": "mcu", "package": "SOIC-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 4.00},
    {"mpn": "LPC1768FBD100", "manufacturer": "NXP", "description": "ARM Cortex-M3 MCU 100MHz 512KB LQFP-100", "category": "mcu", "package": "LQFP-100", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 12000, "price_usd": 7.00},
    {"mpn": "MIMXRT1062DVJ6B", "manufacturer": "NXP", "description": "ARM Cortex-M7 i.MX RT 600MHz 1MB BGA-196", "category": "mcu", "package": "BGA-196", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 5000, "price_usd": 12.00},
    {"mpn": "MSP430FR2355TRHBR", "manufacturer": "Texas Instruments", "description": "16-bit MSP430 MCU 24MHz 32KB VQFN-32", "category": "mcu", "package": "VQFN-32", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 2.50},
    {"mpn": "CC2652R1FRGZR", "manufacturer": "Texas Instruments", "description": "ARM Cortex-M4F Multiprotocol 2.4GHz VQFN-48", "category": "mcu", "package": "VQFN-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 5.00},

    # --- Regulators (additional) ---
    {"mpn": "MCP1700-3302E/TT", "manufacturer": "Microchip", "description": "3.3V 250mA LDO Low Quiescent SOT-23", "category": "regulator", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.30},
    {"mpn": "RT9013-33GB", "manufacturer": "Richtek", "description": "3.3V 500mA LDO Low Noise SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.20},
    {"mpn": "TPS7A3301DCQR", "manufacturer": "Texas Instruments", "description": "3.3V 200mA LDO Low Noise RF SOT-223", "category": "regulator", "package": "SOT-223", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.50},
    {"mpn": "NCV8164ASN330T1G", "manufacturer": "ON Semi", "description": "3.3V 160mA LDO Ultra-Low Power SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.25},
    {"mpn": "SPX3819M5-L-3-3", "manufacturer": "MaxLinear", "description": "3.3V 500mA LDO Low Dropout SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.35},
    {"mpn": "ME6211C33M5G-N", "manufacturer": "Microne", "description": "3.3V 600mA LDO Ultra-Low Dropout SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.08},
    {"mpn": "HT7333-A", "manufacturer": "Holtek", "description": "3.3V 250mA LDO Low Quiescent TO-92", "category": "regulator", "package": "TO-92", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.10},
    {"mpn": "TPS563200DDCR", "manufacturer": "Texas Instruments", "description": "4.5-17V 3A Sync Buck Converter SOT-23-6", "category": "regulator", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.80},
    {"mpn": "TPS54302DDCR", "manufacturer": "Texas Instruments", "description": "4.5-28V 3A Sync Buck Converter SOT-23-6", "category": "regulator", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 0.90},
    {"mpn": "RT6150BGQW", "manufacturer": "Richtek", "description": "2.5-5.5V 2A Sync Buck Converter WDFN-12", "category": "regulator", "package": "WDFN-12", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 0.60},
    {"mpn": "SY8089AAAC", "manufacturer": "Silergy", "description": "4.5-18V 2A Sync Buck Converter SOT-23-5", "category": "regulator", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.30},
    {"mpn": "AOZ1282CI", "manufacturer": "Alpha & Omega", "description": "4.5-18V 3A Sync Buck Converter SOT-23-6", "category": "regulator", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.50},
    {"mpn": "TPS61200DRCT", "manufacturer": "Texas Instruments", "description": "0.3-5.5V 1.5A Boost Converter VSON-10", "category": "regulator", "package": "VSON-10", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "MT3608", "manufacturer": "XI'AN Aerosemi", "description": "2-24V 2A Step-Up Boost Converter SOT-23-6", "category": "regulator", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.10},
    {"mpn": "SX1308", "manufacturer": "Suixin", "description": "2-24V 2A Step-Up Boost Converter SOT-23-6", "category": "regulator", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.12},
    {"mpn": "TPS62A01DRLR", "manufacturer": "Texas Instruments", "description": "3-17V 1A Sync Buck Converter SOT-563", "category": "regulator", "package": "SOT-563", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 0.70},
    {"mpn": "LM2596S-5.0", "manufacturer": "ON Semi", "description": "5V 3A Step-Down Buck Regulator TO-263-5", "category": "regulator", "package": "TO-263-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 1.00},
    {"mpn": "LM1117IMPX-3.3", "manufacturer": "Texas Instruments", "description": "3.3V 800mA LDO Regulator SOT-223", "category": "regulator", "package": "SOT-223", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.40},
    {"mpn": "AP7361C-33ER", "manufacturer": "Diodes Inc", "description": "3.3V 1A LDO Fast Transient SOT-89", "category": "regulator", "package": "SOT-89", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.20},

    # --- Op-Amps ---
    {"mpn": "LM358DR", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp General Purpose SOIC-8", "category": "opamp", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.20},
    {"mpn": "LMV321IDBVR", "manufacturer": "Texas Instruments", "description": "Single Op-Amp Low Voltage Rail-to-Rail SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.25},
    {"mpn": "MCP6001T-I/OT", "manufacturer": "Microchip", "description": "Single Op-Amp 1MHz Rail-to-Rail SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.30},
    {"mpn": "OPA2340PA", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp Rail-to-Rail CMOS PDIP-8", "category": "opamp", "package": "PDIP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 1.50},
    {"mpn": "AD8605ARTZ-REEL7", "manufacturer": "Analog Devices", "description": "Single Op-Amp Low Noise Precision SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.00},
    {"mpn": "TLV9001IDCKR", "manufacturer": "Texas Instruments", "description": "Single Op-Amp 1MHz Low Power SC70-5", "category": "opamp", "package": "SC70-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.30},
    {"mpn": "TSV911AILT", "manufacturer": "STMicroelectronics", "description": "Single Op-Amp 8MHz Rail-to-Rail SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 0.40},
    {"mpn": "OPA1612AIDR", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp Ultra-Low Noise Audio SOIC-8", "category": "opamp", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 3.50},
    {"mpn": "MCP6002T-I/SN", "manufacturer": "Microchip", "description": "Dual Op-Amp 1MHz Rail-to-Rail SOIC-8", "category": "opamp", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.35},
    {"mpn": "LM324DR", "manufacturer": "Texas Instruments", "description": "Quad Op-Amp General Purpose SOIC-14", "category": "opamp", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.25},
    {"mpn": "OPA2277PA", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp High Precision Low Offset PDIP-8", "category": "opamp", "package": "PDIP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 4.00},
    {"mpn": "NE5532DR", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp Low Noise Audio SOIC-8", "category": "opamp", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.30},
    {"mpn": "TL072CDR", "manufacturer": "Texas Instruments", "description": "Dual Op-Amp Low Noise JFET SOIC-8", "category": "opamp", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.35},
    {"mpn": "AD8628ARTZ-R2", "manufacturer": "Analog Devices", "description": "Single Op-Amp Zero-Drift Auto-Zero SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.50},
    {"mpn": "OPA365AIDBVR", "manufacturer": "Texas Instruments", "description": "Single Op-Amp 50MHz Zero-Crossover SOT-23-5", "category": "opamp", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 18000, "price_usd": 1.80},

    # --- Interface ICs (additional) ---
    {"mpn": "CH340C", "manufacturer": "WCH", "description": "USB to UART Bridge No Crystal SOIC-16", "category": "interface", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.35},
    {"mpn": "CH340K", "manufacturer": "WCH", "description": "USB to UART Bridge ESSOP-10", "category": "interface", "package": "ESSOP-10", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.30},
    {"mpn": "FT232RL-REEL", "manufacturer": "FTDI", "description": "USB to UART Bridge Full Handshaking SSOP-28", "category": "interface", "package": "SSOP-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 4.50},
    {"mpn": "FT2232HL-REEL", "manufacturer": "FTDI", "description": "Dual USB to UART/FIFO Hi-Speed LQFP-64", "category": "interface", "package": "LQFP-64", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 6.00},
    {"mpn": "CP2104-F03-GMR", "manufacturer": "Silicon Labs", "description": "USB to UART Bridge QFN-24", "category": "interface", "package": "QFN-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 2.50},
    {"mpn": "MCP2551-I/SN", "manufacturer": "Microchip", "description": "CAN Transceiver High-Speed 1Mbps SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 1.00},
    {"mpn": "TJA1040T/CM", "manufacturer": "NXP", "description": "CAN Transceiver High-Speed SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.20},
    {"mpn": "SN65HVD233DR", "manufacturer": "Texas Instruments", "description": "CAN Transceiver 3.3V with Loopback SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 1.50},
    {"mpn": "MAX3485ESA+T", "manufacturer": "Maxim", "description": "RS-485 Transceiver 3.3V SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 2.00},
    {"mpn": "SP3485EN-L/TR", "manufacturer": "MaxLinear", "description": "RS-485 Transceiver 3.3V Low Power SOIC-8", "category": "interface", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.80},
    {"mpn": "PCA9548APW,118", "manufacturer": "NXP", "description": "8-Channel I2C Mux/Switch TSSOP-24", "category": "interface", "package": "TSSOP-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "TCA9548APWR", "manufacturer": "Texas Instruments", "description": "8-Channel I2C Mux/Switch TSSOP-24", "category": "interface", "package": "TSSOP-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 1.80},
    {"mpn": "TXS0108EPWR", "manufacturer": "Texas Instruments", "description": "8-Bit Bidirectional Level Shifter TSSOP-20", "category": "interface", "package": "TSSOP-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 1.00},
    {"mpn": "SN74LVC2T45DCUR", "manufacturer": "Texas Instruments", "description": "2-Bit Dual-Supply Level Translator VSSOP-8", "category": "interface", "package": "VSSOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.40},
    {"mpn": "BSS138", "manufacturer": "ON Semi", "description": "N-MOSFET Level Shifter 50V 200mA SOT-23", "category": "interface", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.03},
    {"mpn": "W25Q16JVSNIQ", "manufacturer": "Winbond", "description": "16Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.40},
    {"mpn": "W25Q32JVSSIQ", "manufacturer": "Winbond", "description": "32Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 70000, "price_usd": 0.60},
    {"mpn": "W25Q64JVSSIQ", "manufacturer": "Winbond", "description": "64Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.90},
    {"mpn": "IS25LP128F-JBLE", "manufacturer": "ISSI", "description": "128Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.80},
    {"mpn": "AT25SF081-SSHD-T", "manufacturer": "Adesto", "description": "8Mbit SPI Flash SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.35},

    # --- Connectors (additional) ---
    {"mpn": "PPTC021LFBN-RC", "manufacturer": "Sullins", "description": "1x2 Pin Header 2.54mm TH", "category": "connector", "package": "1x2-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC031LFBN-RC", "manufacturer": "Sullins", "description": "1x3 Pin Header 2.54mm TH", "category": "connector", "package": "1x3-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC041LFBN-RC", "manufacturer": "Sullins", "description": "1x4 Pin Header 2.54mm TH", "category": "connector", "package": "1x4-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC061LFBN-RC", "manufacturer": "Sullins", "description": "1x6 Pin Header 2.54mm TH", "category": "connector", "package": "1x6-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC081LFBN-RC", "manufacturer": "Sullins", "description": "1x8 Pin Header 2.54mm TH", "category": "connector", "package": "1x8-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC101LFBN-RC", "manufacturer": "Sullins", "description": "1x10 Pin Header 2.54mm TH", "category": "connector", "package": "1x10-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC201LFBN-RC", "manufacturer": "Sullins", "description": "1x20 Pin Header 2.54mm TH", "category": "connector", "package": "1x20-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC401LFBN-RC", "manufacturer": "Sullins", "description": "1x40 Pin Header 2.54mm TH", "category": "connector", "package": "1x40-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPPC052LFBN-RC", "manufacturer": "Sullins", "description": "2x5 Pin Header 2.54mm TH", "category": "connector", "package": "2x5-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPPC102LFBN-RC", "manufacturer": "Sullins", "description": "2x10 Pin Header 2.54mm TH", "category": "connector", "package": "2x10-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPPC202LFBN-RC", "manufacturer": "Sullins", "description": "2x20 Pin Header 2.54mm TH (Raspberry Pi)", "category": "connector", "package": "2x20-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SM02B-SRSS-TB", "manufacturer": "JST", "description": "SH 2-Pin Receptacle 1.0mm Pitch SMD", "category": "connector", "package": "SH-2P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SM04B-SRSS-TB", "manufacturer": "JST", "description": "SH 4-Pin Receptacle 1.0mm Pitch SMD", "category": "connector", "package": "SH-4P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SM06B-SRSS-TB", "manufacturer": "JST", "description": "SH 6-Pin Receptacle 1.0mm Pitch SMD", "category": "connector", "package": "SH-6P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "B2B-PH-K-S", "manufacturer": "JST", "description": "PH 2-Pin Header 2.0mm Pitch TH", "category": "connector", "package": "PH-2P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "B4B-PH-K-S", "manufacturer": "JST", "description": "PH 4-Pin Header 2.0mm Pitch TH", "category": "connector", "package": "PH-4P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "B4B-XH-A", "manufacturer": "JST", "description": "XH 4-Pin Header 2.5mm Pitch TH", "category": "connector", "package": "XH-4P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "BM02B-GHS-TBT", "manufacturer": "JST", "description": "GH 2-Pin Header 1.25mm Pitch SMD", "category": "connector", "package": "GH-2P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "BM04B-GHS-TBT", "manufacturer": "JST", "description": "GH 4-Pin Header 1.25mm Pitch SMD", "category": "connector", "package": "GH-4P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "FH12-24S-0.5SH", "manufacturer": "Hirose", "description": "FPC 24-Pin 0.5mm Pitch Connector", "category": "connector", "package": "FPC-24P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "FH12-40S-0.5SH", "manufacturer": "Hirose", "description": "FPC 40-Pin 0.5mm Pitch Connector", "category": "connector", "package": "FPC-40P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "AFC01-S10FCA-00", "manufacturer": "JAE", "description": "FPC 10-Pin 1.0mm Pitch Connector", "category": "connector", "package": "FPC-10P", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "DM3AT-SF-PEJM5", "manufacturer": "Hirose", "description": "Micro SD Card Socket Push-Push SMD", "category": "connector", "package": "MicroSD", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "MJ-78-SMT", "manufacturer": "CUI", "description": "SIM Card Holder Push-Push SMD", "category": "connector", "package": "SIM", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RJE72-488-1411", "manufacturer": "Amphenol", "description": "RJ45 Ethernet Jack with Magnetics TH", "category": "connector", "package": "RJ45", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "PJ-002A", "manufacturer": "CUI", "description": "DC Barrel Jack 2.1mm Center Pin TH", "category": "connector", "package": "TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CONSMA001-SMD-G-T", "manufacturer": "Linx", "description": "SMA Connector 50 Ohm Edge Mount SMD", "category": "connector", "package": "SMA", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "U.FL-R-SMT-1(10)", "manufacturer": "Hirose", "description": "U.FL Coaxial Connector SMD", "category": "connector", "package": "U.FL", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Power MOSFETs / Schottky / TVS ---
    {"mpn": "IRF540NPBF", "manufacturer": "Infineon", "description": "N-MOSFET 100V 33A TO-220", "category": "mosfet", "package": "TO-220", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.80},
    {"mpn": "IRLML6344TRPBF", "manufacturer": "Infineon", "description": "N-MOSFET 30V 5A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.15},
    {"mpn": "SI2302CDS-T1-GE3", "manufacturer": "Vishay", "description": "N-MOSFET 20V 2.8A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.10},
    {"mpn": "CJ3400", "manufacturer": "Changjiang", "description": "N-MOSFET 30V 5.8A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.05},
    {"mpn": "IRLML2502TRPBF", "manufacturer": "Infineon", "description": "N-MOSFET 20V 4.2A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.12},
    {"mpn": "DMG2305UX-13", "manufacturer": "Diodes Inc", "description": "P-MOSFET -20V -4.2A SOT-23", "category": "mosfet", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.15},
    {"mpn": "AON7410", "manufacturer": "Alpha & Omega", "description": "N-MOSFET 30V 24A DFN 3x3", "category": "mosfet", "package": "DFN-3x3", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.30},
    {"mpn": "SS34", "manufacturer": "MDD", "description": "Schottky Diode 40V 3A SMA", "category": "diode", "package": "SMA", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.05},
    {"mpn": "SS54", "manufacturer": "MDD", "description": "Schottky Diode 40V 5A SMC", "category": "diode", "package": "SMC", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.08},
    {"mpn": "MBRS340T3G", "manufacturer": "ON Semi", "description": "Schottky Diode 40V 3A SMC", "category": "diode", "package": "SMC", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.20},
    {"mpn": "B5819W", "manufacturer": "MDD", "description": "Schottky Diode 40V 1A SOD-123", "category": "diode", "package": "SOD-123", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 300000, "price_usd": 0.02},
    {"mpn": "SMBJ5.0A", "manufacturer": "Littelfuse", "description": "TVS Diode 5V Unidirectional SMB", "category": "protection", "package": "SMB", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.20},
    {"mpn": "SMAJ12A", "manufacturer": "Littelfuse", "description": "TVS Diode 12V Unidirectional SMA", "category": "protection", "package": "SMA", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.15},
    {"mpn": "SMBJ12CA", "manufacturer": "Littelfuse", "description": "TVS Diode 12V Bidirectional SMB", "category": "protection", "package": "SMB", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 0.25},
    {"mpn": "PESD3V3S2UT", "manufacturer": "Nexperia", "description": "ESD Protection 3.3V Bidirectional SOT-23", "category": "protection", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.05},

    # --- Sensors (additional) ---
    {"mpn": "DS18B20+", "manufacturer": "Maxim", "description": "1-Wire Digital Temperature Sensor TO-92", "category": "sensor", "package": "TO-92", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 1.50},
    {"mpn": "TMP36GRTZ-REEL7", "manufacturer": "Analog Devices", "description": "Analog Temperature Sensor SOT-23", "category": "sensor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.00},
    {"mpn": "LM75BIMM-3/NOPB", "manufacturer": "Texas Instruments", "description": "I2C Temperature Sensor +/-2C VSSOP-8", "category": "sensor", "package": "VSSOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 0.80},
    {"mpn": "MCP9808-E/MS", "manufacturer": "Microchip", "description": "I2C Temperature Sensor +/-0.25C MSOP-8", "category": "sensor", "package": "MSOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 1.20},
    {"mpn": "SHT40-AD1B-R2", "manufacturer": "Sensirion", "description": "I2C Temperature+Humidity Sensor DFN-4", "category": "sensor", "package": "DFN-4", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 2.50},
    {"mpn": "ADXL345BCCZ-RL7", "manufacturer": "Analog Devices", "description": "3-Axis Accelerometer +/-16g I2C/SPI LGA-14", "category": "sensor", "package": "LGA-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 3.00},
    {"mpn": "LIS3DHTR", "manufacturer": "STMicroelectronics", "description": "3-Axis Accelerometer +/-16g I2C/SPI LGA-16", "category": "sensor", "package": "LGA-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 1.50},
    {"mpn": "MMA8452QR1", "manufacturer": "NXP", "description": "3-Axis Accelerometer +/-8g I2C QFN-16", "category": "sensor", "package": "QFN-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 18000, "price_usd": 1.80},
    {"mpn": "BH1750FVI-TR", "manufacturer": "Rohm", "description": "Ambient Light Sensor I2C WSOF-6", "category": "sensor", "package": "WSOF-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.80},
    {"mpn": "TSL2591", "manufacturer": "AMS", "description": "High Dynamic Range Light Sensor I2C DFN-6", "category": "sensor", "package": "DFN-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 2.00},
    {"mpn": "VEML7700-TT", "manufacturer": "Vishay", "description": "Ambient Light Sensor I2C OPGM-4", "category": "sensor", "package": "OPGM-4", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 1.50},
    {"mpn": "BMP280", "manufacturer": "Bosch", "description": "Barometric Pressure Sensor I2C/SPI LGA-8", "category": "sensor", "package": "LGA-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 1.50},
    {"mpn": "MS5611-01BA03", "manufacturer": "TE Connectivity", "description": "Barometric Pressure Sensor SPI/I2C QFN-8", "category": "sensor", "package": "QFN-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 5.00},
    {"mpn": "ADS1115IDGSR", "manufacturer": "Texas Instruments", "description": "16-Bit 4-Channel ADC I2C VSSOP-10", "category": "sensor", "package": "VSSOP-10", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 4.00},
    {"mpn": "MCP3008-I/SL", "manufacturer": "Microchip", "description": "10-Bit 8-Channel ADC SPI SOIC-16", "category": "sensor", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 2.50},
    {"mpn": "MAX6675ISA+T", "manufacturer": "Maxim", "description": "Thermocouple-to-Digital K-Type SPI SOIC-8", "category": "sensor", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 4.00},
    {"mpn": "LSM6DSOXTR", "manufacturer": "STMicroelectronics", "description": "6-Axis IMU Accel+Gyro AI Core LGA-14", "category": "sensor", "package": "LGA-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 4.50},

    # --- Crystals / Oscillators (additional) ---
    {"mpn": "NX3225GD-4MHZ", "manufacturer": "NDK", "description": "4MHz Crystal 12pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.30},
    {"mpn": "NX3225GD-12MHZ", "manufacturer": "NDK", "description": "12MHz Crystal 12pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 45000, "price_usd": 0.30},
    {"mpn": "NX3225GD-16MHZ", "manufacturer": "NDK", "description": "16MHz Crystal 12pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.30},
    {"mpn": "NX3225GD-25MHZ", "manufacturer": "NDK", "description": "25MHz Crystal 10pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.30},
    {"mpn": "NX3225GD-32MHZ", "manufacturer": "NDK", "description": "32MHz Crystal 8pF 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 0.35},
    {"mpn": "ABS05-32.768KHZ-T", "manufacturer": "Abracon", "description": "32.768kHz Crystal 6pF 1.6x1.0mm SMD", "category": "crystal", "package": "1610", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.20},
    {"mpn": "FC-135 32.768KHZ", "manufacturer": "Epson", "description": "32.768kHz Crystal 7pF 3.2x1.5mm SMD", "category": "crystal", "package": "3215", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.25},
    {"mpn": "ABM3B-8.000MHZ-B2-T", "manufacturer": "Abracon", "description": "8MHz Crystal 18pF 5.0x3.2mm SMD", "category": "crystal", "package": "5032", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.35},
    {"mpn": "SiT8008BI-12-33E-25.000000G", "manufacturer": "SiTime", "description": "25MHz MEMS Oscillator 3.3V SOT-23-5", "category": "crystal", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 1.00},
    {"mpn": "ASE-25.000MHZ-LC-T", "manufacturer": "Abracon", "description": "25MHz Oscillator 3.3V 3.2x2.5mm SMD", "category": "crystal", "package": "3225", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 0.80},

    # --- LEDs (additional) ---
    {"mpn": "LTST-C190KGKT", "manufacturer": "Lite-On", "description": "Green LED 0402 2V 20mA", "category": "led", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 400000, "price_usd": 0.03},
    {"mpn": "LTST-C190KRKT", "manufacturer": "Lite-On", "description": "Red LED 0402 2V 20mA", "category": "led", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 400000, "price_usd": 0.03},
    {"mpn": "19-217/BHC-ZL1M2RY/3T", "manufacturer": "Everlight", "description": "White LED 0805 3.2V 20mA", "category": "led", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 300000, "price_usd": 0.04},
    {"mpn": "150060VS75000", "manufacturer": "Wurth", "description": "Green LED 0603 2.2V 20mA", "category": "led", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.04},
    {"mpn": "150060RS75000", "manufacturer": "Wurth", "description": "Red LED 0603 2V 20mA", "category": "led", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.04},
    {"mpn": "APTD3216SURCK", "manufacturer": "Kingbright", "description": "Red LED 1206 2V 20mA", "category": "led", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.05},
    {"mpn": "SK6812MINI-E", "manufacturer": "Worldsemi", "description": "RGB LED Addressable 3528 Reverse-Mount", "category": "led", "package": "3528", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},

    # --- Inductors (additional) ---
    {"mpn": "LQH32PH4R7MNCL", "manufacturer": "Murata", "description": "4.7uH 1.2A Shielded Inductor 1210", "category": "inductor", "package": "1210", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "NR3015T2R2M", "manufacturer": "Taiyo Yuden", "description": "2.2uH 1.8A Shielded Inductor 3x3mm", "category": "inductor", "package": "3015", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "NRS4018T100MDGJ", "manufacturer": "Taiyo Yuden", "description": "10uH 1.1A Shielded Inductor 4x4mm", "category": "inductor", "package": "4018", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SRN6045TA-100M", "manufacturer": "Bourns", "description": "10uH 2.5A Semi-Shielded Inductor 6x6mm", "category": "inductor", "package": "6045", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "XAL6030-222MEB", "manufacturer": "Coilcraft", "description": "2.2uH 10A Shielded Power Inductor 6x6mm", "category": "inductor", "package": "6030", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "LQH3NPN4R7MJ0L", "manufacturer": "Murata", "description": "4.7uH 630mA Inductor 1212", "category": "inductor", "package": "1212", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "BLM18PG471SN1D", "manufacturer": "Murata", "description": "470 Ohm @100MHz Ferrite Bead 0603", "category": "inductor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "BLM15PX471SN1D", "manufacturer": "Murata", "description": "470 Ohm @100MHz Ferrite Bead 0402", "category": "inductor", "package": "0402", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Transistors (additional) ---
    {"mpn": "BC847BLT1G", "manufacturer": "ON Semi", "description": "NPN Transistor 45V 100mA SOT-23", "category": "transistor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.02},
    {"mpn": "BC857BLT1G", "manufacturer": "ON Semi", "description": "PNP Transistor -45V -100mA SOT-23", "category": "transistor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.02},
    {"mpn": "MMBTA42LT1G", "manufacturer": "ON Semi", "description": "NPN Transistor 300V 500mA SOT-23", "category": "transistor", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.05},
    {"mpn": "TIP120G", "manufacturer": "ON Semi", "description": "NPN Darlington Transistor 60V 5A TO-220", "category": "transistor", "package": "TO-220", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.50},

    # --- ESD / Protection (additional) ---
    {"mpn": "TPD4E05U06DQAR", "manufacturer": "Texas Instruments", "description": "4-Channel ESD Protection USB 5V SOT-553", "category": "protection", "package": "SOT-553", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.30},
    {"mpn": "SP0504BAHTG", "manufacturer": "Littelfuse", "description": "4-Channel ESD Protection Array SOT-23-5", "category": "protection", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.20},
    {"mpn": "SRV05-4-P-T7", "manufacturer": "Semtech", "description": "ESD Protection 4-Line USB SOT-23-6", "category": "protection", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.15},
    {"mpn": "0603ESDA-MLP5", "manufacturer": "Bourns", "description": "ESD Suppressor 5V 0603", "category": "protection", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.05},
    {"mpn": "MFRC52202HN1", "manufacturer": "NXP", "description": "RFID/NFC Reader IC 13.56MHz HVQFN-32", "category": "ic", "package": "HVQFN-32", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 3.50},

    # --- Miscellaneous ICs ---
    {"mpn": "NE555DR", "manufacturer": "Texas Instruments", "description": "Timer IC Precision SOIC-8", "category": "ic", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.15},
    {"mpn": "74HC595D,653", "manufacturer": "Nexperia", "description": "8-Bit Shift Register SPI SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.20},
    {"mpn": "74HC245D,653", "manufacturer": "Nexperia", "description": "8-Bit Bus Transceiver SOIC-20", "category": "ic", "package": "SOIC-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.25},
    {"mpn": "74HC138D,653", "manufacturer": "Nexperia", "description": "3-to-8 Line Decoder SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.20},
    {"mpn": "74HC4051D,653", "manufacturer": "Nexperia", "description": "8-Channel Analog Mux SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.25},
    {"mpn": "CD4051BM96", "manufacturer": "Texas Instruments", "description": "8-Channel Analog Mux SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.20},
    {"mpn": "ULN2003ADR", "manufacturer": "Texas Instruments", "description": "7-Channel Darlington Driver SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.20},
    {"mpn": "TLC5940PWPR", "manufacturer": "Texas Instruments", "description": "16-Channel LED Driver PWM TSSOP-28", "category": "ic", "package": "TSSOP-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "PCA9685PW,118", "manufacturer": "NXP", "description": "16-Channel PWM LED Driver I2C TSSOP-28", "category": "ic", "package": "TSSOP-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 2.50},
    {"mpn": "MAX7219CNG+", "manufacturer": "Maxim", "description": "8-Digit LED Display Driver SPI PDIP-24", "category": "ic", "package": "PDIP-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 3.00},
    {"mpn": "DRV8833PWPR", "manufacturer": "Texas Instruments", "description": "Dual H-Bridge Motor Driver 1.5A TSSOP-16", "category": "ic", "package": "TSSOP-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.50},
    {"mpn": "A4988SETTR-T", "manufacturer": "Allegro", "description": "Stepper Motor Driver Microstepping QFN-28", "category": "ic", "package": "QFN-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.50},
    {"mpn": "TMC2209-LA", "manufacturer": "Trinamic", "description": "Stepper Motor Driver Silent UART QFN-28", "category": "ic", "package": "QFN-28", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 4.00},
    {"mpn": "DAC8552IDGKR", "manufacturer": "Texas Instruments", "description": "16-Bit Dual DAC SPI VSSOP-8", "category": "ic", "package": "VSSOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 5.00},
    {"mpn": "MCP4725A0T-E/CH", "manufacturer": "Microchip", "description": "12-Bit DAC I2C SOT-23-6", "category": "ic", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 1.50},
    {"mpn": "REF3033AIDBZR", "manufacturer": "Texas Instruments", "description": "3.3V Voltage Reference 0.2% SOT-23", "category": "ic", "package": "SOT-23", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 1.00},
    {"mpn": "MAX3232ECPE+", "manufacturer": "Maxim", "description": "Dual RS-232 Transceiver 3.3V PDIP-16", "category": "interface", "package": "PDIP-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 2.00},
    {"mpn": "DP83848CVVX/NOPB", "manufacturer": "Texas Instruments", "description": "10/100 Ethernet PHY LQFP-48", "category": "interface", "package": "LQFP-48", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 4.00},
    {"mpn": "LAN8720A-CP-TR", "manufacturer": "Microchip", "description": "10/100 Ethernet PHY RMII QFN-24", "category": "interface", "package": "QFN-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 2.50},
    {"mpn": "ATECC608A-MAHDA-S", "manufacturer": "Microchip", "description": "Crypto Authentication IC I2C UDFN-8", "category": "ic", "package": "UDFN-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 0.80},
    {"mpn": "TPL5111DDCR", "manufacturer": "Texas Instruments", "description": "Nano Power Timer System SOT-23-6", "category": "ic", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 25000, "price_usd": 0.60},
    {"mpn": "TPS2116DRLR", "manufacturer": "Texas Instruments", "description": "Power Mux Dual-Input Low IQ SOT-563", "category": "ic", "package": "SOT-563", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 1.00},
    {"mpn": "BQ24075RGTR", "manufacturer": "Texas Instruments", "description": "Li-Ion Battery Charger 1.5A USB QFN-16", "category": "ic", "package": "QFN-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.00},
    {"mpn": "MCP73831T-2ACI/OT", "manufacturer": "Microchip", "description": "Li-Ion/Li-Po Charger 500mA SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.50},
    {"mpn": "TP4056", "manufacturer": "NanJing Top Power", "description": "Li-Ion Charger 1A Linear SOP-8", "category": "ic", "package": "SOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 300000, "price_usd": 0.05},
    {"mpn": "IP5306", "manufacturer": "INJOINIC", "description": "Power Bank SoC 2.1A Charge/Discharge SOP-8", "category": "ic", "package": "SOP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.30},
    {"mpn": "TPS62742DSSR", "manufacturer": "Texas Instruments", "description": "3.3V 400mA Ultra-Low Power Buck WSON-12", "category": "regulator", "package": "WSON-12", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 1.50},

    # --- Fuses / Resettable ---
    {"mpn": "MF-MSMF050-2", "manufacturer": "Bourns", "description": "PTC Resettable Fuse 500mA 15V 1812", "category": "protection", "package": "1812", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.10},
    {"mpn": "MF-MSMF110/33X-2", "manufacturer": "Bourns", "description": "PTC Resettable Fuse 1.1A 33V 1812", "category": "protection", "package": "1812", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.15},
    {"mpn": "0603SFF050F/63-2", "manufacturer": "Bourns", "description": "Thin Film Fuse 500mA 63V 0603", "category": "protection", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.20},

    # --- Switches / Buttons ---
    {"mpn": "SKRPACE010", "manufacturer": "Alps Alpine", "description": "Tactile Switch 3.9x2.9mm SPST SMD", "category": "switch", "package": "SMD", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},
    {"mpn": "B3U-1000P", "manufacturer": "Omron", "description": "Tactile Switch 2.5x3.0mm SPST SMD", "category": "switch", "package": "SMD", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.15},
    {"mpn": "KSC241GLFS", "manufacturer": "C&K", "description": "Tactile Switch 6x6mm SPST TH", "category": "switch", "package": "6x6-TH", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 150000, "price_usd": 0.05},
    {"mpn": "MSK-12C02", "manufacturer": "Shou Han", "description": "Slide Switch SPDT SMD", "category": "switch", "package": "SMD", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 200000, "price_usd": 0.03},
    {"mpn": "SS-12D00-G5", "manufacturer": "C&K", "description": "Slide Switch SPDT TH", "category": "switch", "package": "TH", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.08},

    # --- Relay ---
    {"mpn": "G5V-1-DC5", "manufacturer": "Omron", "description": "Signal Relay SPDT 5V 1A TH", "category": "relay", "package": "TH", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 1.50},
    {"mpn": "SRD-05VDC-SL-C", "manufacturer": "Songle", "description": "Power Relay SPDT 5V 10A TH", "category": "relay", "package": "TH", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.50},

    # --- Optocouplers ---
    {"mpn": "PC817X2NIP0F", "manufacturer": "Sharp", "description": "Optocoupler Phototransistor DIP-4", "category": "ic", "package": "DIP-4", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},
    {"mpn": "TLP281(GB,F)", "manufacturer": "Toshiba", "description": "Optocoupler Phototransistor SOP-4", "category": "ic", "package": "SOP-4", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.15},
    {"mpn": "6N137S-TA1", "manufacturer": "Lite-On", "description": "High Speed Optocoupler 10Mbps DIP-8", "category": "ic", "package": "DIP-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.50},

    # --- Display Drivers ---
    {"mpn": "SSD1306", "manufacturer": "Solomon Systech", "description": "128x64 OLED Driver I2C/SPI Bare Die", "category": "ic", "package": "COG", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 1.00},
    {"mpn": "ST7789V", "manufacturer": "Sitronix", "description": "240x320 TFT LCD Driver SPI", "category": "ic", "package": "COG", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.50},
    {"mpn": "ILI9341", "manufacturer": "ILI Technology", "description": "240x320 TFT LCD Driver SPI/Parallel", "category": "ic", "package": "COG", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 1.20},

    # --- Wireless Modules ---
    {"mpn": "RFM95W-915S2", "manufacturer": "HopeRF", "description": "LoRa Transceiver 915MHz SX1276 SPI Module", "category": "ic", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 4.00},
    {"mpn": "SX1262IMLTRT", "manufacturer": "Semtech", "description": "LoRa Transceiver Sub-GHz QFN-24", "category": "ic", "package": "QFN-24", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 5.00},
    {"mpn": "CC1101RGPR", "manufacturer": "Texas Instruments", "description": "Sub-1GHz RF Transceiver QFN-20", "category": "ic", "package": "QFN-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 2.50},
    {"mpn": "NRF24L01P-R", "manufacturer": "Nordic", "description": "2.4GHz RF Transceiver QFN-20", "category": "ic", "package": "QFN-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.50},

    # --- Audio ---
    {"mpn": "MAX98357AETE+T", "manufacturer": "Maxim", "description": "I2S Class-D Mono Amplifier 3.2W TQFN-16", "category": "ic", "package": "TQFN-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 15000, "price_usd": 2.00},
    {"mpn": "PAM8403DR", "manufacturer": "Diodes Inc", "description": "Class-D Stereo Amplifier 3W SOP-16", "category": "ic", "package": "SOP-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.30},
    {"mpn": "PCM5102APWR", "manufacturer": "Texas Instruments", "description": "32-Bit I2S DAC Audio Stereo TSSOP-20", "category": "ic", "package": "TSSOP-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 3.50},

    # --- RTC ---
    {"mpn": "DS3231SN#T&R", "manufacturer": "Maxim", "description": "RTC TCXO +/-2ppm I2C SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 20000, "price_usd": 5.00},
    {"mpn": "PCF8563T/5,518", "manufacturer": "NXP", "description": "RTC/Calendar I2C Low Power SOIC-8", "category": "ic", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 1.00},

    # --- GPS ---
    {"mpn": "NEO-6M-0-001", "manufacturer": "u-blox", "description": "GPS/GNSS Receiver Module UART", "category": "ic", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 10000, "price_usd": 8.00},
    {"mpn": "L76K", "manufacturer": "Quectel", "description": "GPS/GNSS Multi-Constellation Module", "category": "ic", "package": "Module", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 8000, "price_usd": 6.00},

    # --- Additional Resistors (0805/1206 values) ---
    {"mpn": "RC0805FR-070RL", "manufacturer": "Yageo", "description": "0 Ohm Jumper 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-071RL", "manufacturer": "Yageo", "description": "1 Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-07100RL", "manufacturer": "Yageo", "description": "100 Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-07220RL", "manufacturer": "Yageo", "description": "220 Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-07470RL", "manufacturer": "Yageo", "description": "470 Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-071KL", "manufacturer": "Yageo", "description": "1K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-074K7L", "manufacturer": "Yageo", "description": "4.7K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-0722KL", "manufacturer": "Yageo", "description": "22K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-0747KL", "manufacturer": "Yageo", "description": "47K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-07100KL", "manufacturer": "Yageo", "description": "100K Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC0805FR-071ML", "manufacturer": "Yageo", "description": "1M Ohm 1% 0805 Resistor", "category": "resistor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1206FR-070RL", "manufacturer": "Yageo", "description": "0 Ohm Jumper 1206 Resistor", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1206FR-07100RL", "manufacturer": "Yageo", "description": "100 Ohm 1% 1206 Resistor", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1206FR-071KL", "manufacturer": "Yageo", "description": "1K Ohm 1% 1206 Resistor", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1206FR-0710KL", "manufacturer": "Yageo", "description": "10K Ohm 1% 1206 Resistor", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "RC1206FR-07100KL", "manufacturer": "Yageo", "description": "100K Ohm 1% 1206 Resistor", "category": "resistor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Additional Capacitors (more values) ---
    {"mpn": "CL10A105KA8NNNC", "manufacturer": "Samsung", "description": "1uF 25V X5R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL10A225KQ8NNNC", "manufacturer": "Samsung", "description": "2.2uF 6.3V X5R 0603 MLCC", "category": "capacitor", "package": "0603", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL21A106KQCLRNC", "manufacturer": "Samsung", "description": "10uF 6.3V X5R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL21B225KAFNNNE", "manufacturer": "Samsung", "description": "2.2uF 25V X7R 0805 MLCC", "category": "capacitor", "package": "0805", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "CL31B475KBHNNNE", "manufacturer": "Samsung", "description": "4.7uF 50V X7R 1206 MLCC", "category": "capacitor", "package": "1206", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Additional Connectors ---
    {"mpn": "PPTC121LFBN-RC", "manufacturer": "Sullins", "description": "1x12 Pin Header 2.54mm TH", "category": "connector", "package": "1x12-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPTC161LFBN-RC", "manufacturer": "Sullins", "description": "1x16 Pin Header 2.54mm TH", "category": "connector", "package": "1x16-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "PPPC072LFBN-RC", "manufacturer": "Sullins", "description": "2x7 Pin Header 2.54mm TH", "category": "connector", "package": "2x7-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SSQ-110-03-G-S", "manufacturer": "Samtec", "description": "1x10 Socket Header 2.54mm TH", "category": "connector", "package": "1x10-TH", "source": "local", "has_symbol": True, "has_footprint": True},
    {"mpn": "SSQ-120-03-G-D", "manufacturer": "Samtec", "description": "2x20 Socket Header 2.54mm TH", "category": "connector", "package": "2x20-TH", "source": "local", "has_symbol": True, "has_footprint": True},

    # --- Additional Logic ICs ---
    {"mpn": "SN74LVC1G08DBVR", "manufacturer": "Texas Instruments", "description": "Single 2-Input AND Gate SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},
    {"mpn": "SN74LVC1G32DBVR", "manufacturer": "Texas Instruments", "description": "Single 2-Input OR Gate SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},
    {"mpn": "SN74LVC1G04DBVR", "manufacturer": "Texas Instruments", "description": "Single Inverter Gate SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 100000, "price_usd": 0.10},
    {"mpn": "SN74LVC2G14DBVR", "manufacturer": "Texas Instruments", "description": "Dual Schmitt-Trigger Inverter SOT-23-6", "category": "ic", "package": "SOT-23-6", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.12},
    {"mpn": "SN74LVC1G125DBVR", "manufacturer": "Texas Instruments", "description": "Single Bus Buffer Gate SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.10},
    {"mpn": "74HC14D,653", "manufacturer": "Nexperia", "description": "Hex Schmitt-Trigger Inverter SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.20},
    {"mpn": "74HC00D,653", "manufacturer": "Nexperia", "description": "Quad 2-Input NAND Gate SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 60000, "price_usd": 0.18},
    {"mpn": "74HC02D,653", "manufacturer": "Nexperia", "description": "Quad 2-Input NOR Gate SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.18},
    {"mpn": "74HC08D,653", "manufacturer": "Nexperia", "description": "Quad 2-Input AND Gate SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.18},
    {"mpn": "74HC32D,653", "manufacturer": "Nexperia", "description": "Quad 2-Input OR Gate SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.18},
    {"mpn": "74HC86D,653", "manufacturer": "Nexperia", "description": "Quad 2-Input XOR Gate SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.20},
    {"mpn": "74HC164D,653", "manufacturer": "Nexperia", "description": "8-Bit Serial-In/Parallel-Out Shift Register SOIC-14", "category": "ic", "package": "SOIC-14", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.22},
    {"mpn": "74HC165D,653", "manufacturer": "Nexperia", "description": "8-Bit Parallel-In/Serial-Out Shift Register SOIC-16", "category": "ic", "package": "SOIC-16", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 35000, "price_usd": 0.25},
    {"mpn": "74HC574D,653", "manufacturer": "Nexperia", "description": "Octal D-Type Flip-Flop SOIC-20", "category": "ic", "package": "SOIC-20", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.28},

    # --- Additional I2C Peripherals ---
    {"mpn": "24LC64-I/SN", "manufacturer": "Microchip", "description": "64Kbit I2C EEPROM SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.50},
    {"mpn": "AT24C02D-SSHM-T", "manufacturer": "Microchip", "description": "2Kbit I2C EEPROM SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.20},
    {"mpn": "CAT24C32WI-GT3", "manufacturer": "ON Semi", "description": "32Kbit I2C EEPROM SOIC-8", "category": "memory", "package": "SOIC-8", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.30},

    # --- Additional Power ---
    {"mpn": "TPS2041BDBVR", "manufacturer": "Texas Instruments", "description": "USB Power Switch 500mA SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 40000, "price_usd": 0.50},
    {"mpn": "SY6280AAC", "manufacturer": "Silergy", "description": "USB Power Switch 2A SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 80000, "price_usd": 0.15},
    {"mpn": "AP2553W6-7", "manufacturer": "Diodes Inc", "description": "USB Power Switch 500mA SOT-26", "category": "ic", "package": "SOT-26", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 50000, "price_usd": 0.25},
    {"mpn": "FPF2193", "manufacturer": "ON Semi", "description": "Load Switch 2A Adjustable Rise Time SOT-23-5", "category": "ic", "package": "SOT-23-5", "source": "local", "has_symbol": True, "has_footprint": True, "stock": 30000, "price_usd": 0.35},
]


# ---------------------------------------------------------------------------
# JLCPCB/LCSC proxy search (avoids browser CORS)
# ---------------------------------------------------------------------------

async def _search_jlcpcb(query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Search JLCPCB/LCSC via tscircuit jlcsearch API (server-side, no CORS)."""
    import httpx

    urls = [
        f"https://jlcsearch.tscircuit.com/api/components/list.json?search={query}&limit={limit}&full=true",
        f"https://yaqwsx.github.io/jlcparts/data/search.json?q={query}",
    ]
    results: list[dict[str, Any]] = []

    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(url, headers={"Accept": "application/json"})
                if resp.status_code != 200:
                    continue
                data = resp.json()
                components = data.get("components", data) if isinstance(data, dict) else data
                if isinstance(components, list):
                    for c in components[:limit]:
                        results.append({
                            "mpn": c.get("mfr") or c.get("lcsc") or "",
                            "manufacturer": c.get("manufacturer") or "",
                            "description": c.get("description") or "",
                            "category": c.get("subcategory") or c.get("category") or "",
                            "package": c.get("package") or "",
                            "source": "lcsc",
                            "stock": c.get("stock"),
                            "price_usd": c.get("price"),
                            "lcsc_code": c.get("lcsc"),
                            "has_symbol": False,
                            "has_footprint": True,
                        })
                if results:
                    break
        except Exception as e:
            logger.debug("jlcpcb search failed: %s", e)
            continue

    return results


# ---------------------------------------------------------------------------
# KiCad official library index (16,600+ components)
# ---------------------------------------------------------------------------

_KICAD_INDEX: list[dict[str, Any]] = []
_kicad_path = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "data" / "component_library" / "kicad_index.json"
try:
    if _kicad_path.exists():
        with open(_kicad_path) as _f:
            _KICAD_INDEX = _json_mod.load(_f)
        logger.info("Loaded KiCad index: %d components from %s", len(_KICAD_INDEX), _kicad_path)
except Exception as _e:
    logger.warning("Failed to load KiCad index: %s", _e)


# ---------------------------------------------------------------------------
# KiCad symbol library (3,926 symbols with full pin data)
# ---------------------------------------------------------------------------

_KICAD_SYMBOLS: list[dict[str, Any]] = []
_KICAD_SYMBOL_MAP: dict[str, dict[str, Any]] = {}
_kicad_symbols_path = Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "data" / "component_library" / "kicad_symbols.json"
try:
    if _kicad_symbols_path.exists():
        with open(_kicad_symbols_path) as _f:
            _KICAD_SYMBOLS = _json_mod.load(_f)
        # Build name -> symbol lookup (case-insensitive key, original data)
        for _sym in _KICAD_SYMBOLS:
            _KICAD_SYMBOL_MAP[_sym["name"].lower()] = _sym
        logger.info(
            "Loaded KiCad symbols: %d symbols from %s",
            len(_KICAD_SYMBOLS),
            _kicad_symbols_path,
        )
except Exception as _e:
    logger.warning("Failed to load KiCad symbols: %s", _e)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_components(
    q: str = Query("", description="Search query"),
    category: str = Query("", description="Category filter"),
    limit: int = Query(40, description="Max results"),
) -> dict[str, Any]:
    """Search components across all sources."""
    if not q.strip():
        return {"results": [], "total": 0, "sources": []}

    query = q.strip().lower()
    cat = category.strip().lower()

    # 1. Search built-in database (409 components, instant)
    builtin_results = []
    for comp in _BUILTIN_COMPONENTS:
        text = f"{comp['mpn']} {comp['manufacturer']} {comp['description']} {comp['category']} {comp['package']}".lower()
        tokens = query.split()
        if all(tok in text for tok in tokens):
            if not cat or cat in comp.get("category", "").lower() or cat in comp.get("description", "").lower():
                builtin_results.append(comp)

    # 1b. Search KiCad index (16,600+ components)
    kicad_results = []
    if _KICAD_INDEX:
        kicad_count = 0
        for comp in _KICAD_INDEX:
            if kicad_count >= limit * 2:
                break
            text = f"{comp.get('mpn','')} {comp.get('description','')} {comp.get('keywords','')} {comp.get('category','')} {comp.get('library','')}".lower()
            if all(tok in text for tok in query.split()):
                if not cat or cat in comp.get("category", "").lower():
                    kicad_results.append(comp)
                    kicad_count += 1

    # 2. Search JLCPCB/LCSC (async, server-side)
    online_results: list[dict[str, Any]] = []
    try:
        online_results = await asyncio.wait_for(
            _search_jlcpcb(q.strip(), limit=limit),
            timeout=10.0,
        )
    except Exception as e:
        logger.warning("Online search failed: %s", e)

    # 3. Merge and deduplicate
    seen_mpns: set[str] = set()
    merged: list[dict[str, Any]] = []

    # Online results first (have stock/price)
    for r in online_results:
        key = (r.get("mpn", "").lower(), r.get("manufacturer", "").lower())
        if key[0] and key[0] not in seen_mpns:
            seen_mpns.add(key[0])
            merged.append(r)

    # Then built-in (higher quality, have price/stock)
    for r in builtin_results:
        key = r["mpn"].lower()
        if key not in seen_mpns:
            seen_mpns.add(key)
            merged.append(r)

    # Then KiCad index (largest library, has symbols)
    for r in kicad_results:
        key = r.get("mpn", "").lower()
        if key and key not in seen_mpns:
            seen_mpns.add(key)
            merged.append(r)

    sources = list({r.get("source", "local") for r in merged})

    return {
        "results": merged[:limit],
        "total": len(merged),
        "sources": sources,
    }


@router.get("/symbol-search")
async def symbol_search(
    q: str = Query("", description="Search query for symbol name"),
    limit: int = Query(50, description="Max results"),
) -> dict[str, Any]:
    """Search KiCad symbols by name.  Returns lightweight results (no full pin arrays)."""
    if not q.strip():
        return {"results": [], "total": 0}

    query = q.strip().lower()
    tokens = query.split()
    results: list[dict[str, Any]] = []

    for sym in _KICAD_SYMBOLS:
        text = f"{sym['name']} {sym.get('library', '')} {sym.get('refPrefix', '')}".lower()
        if all(tok in text for tok in tokens):
            results.append({
                "name": sym["name"],
                "library": sym.get("library", ""),
                "refPrefix": sym.get("refPrefix", "U"),
                "pinCount": sym.get("pinCount", len(sym.get("pins", []))),
            })
            if len(results) >= limit:
                break

    return {"results": results, "total": len(results)}


@router.get("/symbol/{name}")
async def get_symbol(name: str) -> dict[str, Any]:
    """Return full symbol data (with pins and body) for a given symbol name."""
    key = name.strip().lower()
    sym = _KICAD_SYMBOL_MAP.get(key)
    if sym is None:
        # Try partial match (e.g. "STM32F103C8Tx" vs "STM32F103C8")
        for k, v in _KICAD_SYMBOL_MAP.items():
            if key in k or k in key:
                sym = v
                break
    if sym is None:
        return {"error": f"Symbol '{name}' not found", "found": False}
    return {"found": True, "symbol": sym}


@router.get("/browse")
async def browse_components(
    category: str = Query("", description="Category to browse"),
    limit: int = Query(100, description="Max results"),
) -> dict[str, Any]:
    """Browse components by category (no search query needed)."""
    cat = category.strip().lower()

    results = []
    for comp in _BUILTIN_COMPONENTS:
        if not cat or cat in comp.get("category", "").lower():
            results.append(comp)

    return {
        "results": results[:limit],
        "total": len(results),
        "categories": sorted({c["category"] for c in _BUILTIN_COMPONENTS}),
    }
