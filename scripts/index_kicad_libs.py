#!/usr/bin/env python3
"""Download and index ALL KiCad official symbol libraries.

Fetches ~203 .dcm files from GitHub, extracts component names and descriptions,
and writes a JSON index file for the RouteAI component search.

Output: data/component_library/kicad_index.json (~10MB, 20K+ components)

Usage:
    python3 scripts/index_kicad_libs.py
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

GITHUB_TREE_URL = "https://api.github.com/repos/KiCad/kicad-symbols/git/trees/master"
RAW_BASE = "https://raw.githubusercontent.com/KiCad/kicad-symbols/master"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "component_library"

# Category mapping from library name to search category
CATEGORY_MAP = {
    "Device": "passive",
    "Regulator_Linear": "regulator",
    "Regulator_Switching": "regulator",
    "Regulator_Controller": "regulator",
    "Regulator_Current": "regulator",
    "Regulator_SwitchedCapacitor": "regulator",
    "Transistor_FET": "mosfet",
    "Transistor_BJT": "transistor",
    "Transistor_IGBT": "transistor",
    "Transistor_Array": "transistor",
    "Diode": "diode",
    "Diode_Bridge": "diode",
    "Diode_Laser": "diode",
    "LED": "led",
    "Connector": "connector",
    "Connector_Generic": "connector",
    "Connector_Generic_MountingPin": "connector",
    "Connector_Generic_Shielded": "connector",
    "Sensor": "sensor",
    "Sensor_Temperature": "sensor",
    "Sensor_Pressure": "sensor",
    "Sensor_Humidity": "sensor",
    "Sensor_Motion": "sensor",
    "Sensor_Current": "sensor",
    "Sensor_Optical": "sensor",
    "Sensor_Magnetic": "sensor",
    "Sensor_Audio": "sensor",
    "Sensor_Distance": "sensor",
    "Sensor_Gas": "sensor",
    "Sensor_Proximity": "sensor",
    "Sensor_Touch": "sensor",
    "Sensor_Voltage": "sensor",
    "Amplifier_Operational": "opamp",
    "Amplifier_Audio": "opamp",
    "Amplifier_Buffer": "opamp",
    "Amplifier_Current": "opamp",
    "Amplifier_Difference": "opamp",
    "Amplifier_Instrumentation": "opamp",
    "Amplifier_Video": "opamp",
    "Comparator": "opamp",
    "Analog_ADC": "ic",
    "Analog_DAC": "ic",
    "Analog": "ic",
    "Analog_Switch": "ic",
    "Interface": "interface",
    "Interface_CAN_LIN": "interface",
    "Interface_Ethernet": "interface",
    "Interface_HDMI": "interface",
    "Interface_USB": "interface",
    "Interface_UART": "interface",
    "Interface_LineDriver": "interface",
    "Interface_Optical": "interface",
    "Interface_Telecom": "interface",
    "Interface_HID": "interface",
    "Interface_CurrentLoop": "interface",
    "Interface_Expansion": "interface",
    "Isolator": "interface",
    "Isolator_Analog": "interface",
    "Memory_EEPROM": "memory",
    "Memory_Flash": "memory",
    "Memory_RAM": "memory",
    "Memory_ROM": "memory",
    "Memory_EPROM": "memory",
    "Memory_NVRAM": "memory",
    "Memory_UniqueID": "memory",
    "Timer": "ic",
    "Timer_PLL": "ic",
    "Timer_RTC": "ic",
    "Filter": "passive",
    "Oscillator": "crystal",
    "Reference_Voltage": "ic",
    "Reference_Current": "ic",
    "Power_Management": "ic",
    "Power_Protection": "protection",
    "Power_Supervisor": "ic",
    "Security": "ic",
    "Switch": "switch",
    "Relay": "relay",
    "Relay_SolidState": "relay",
    "Transformer": "passive",
    "RF": "ic",
    "RF_Module": "ic",
    "RF_WiFi": "ic",
    "RF_Bluetooth": "ic",
    "RF_GPS": "ic",
    "RF_ZigBee": "ic",
    "RF_NFC": "ic",
    "RF_RFID": "ic",
    "RF_Amplifier": "ic",
    "RF_Filter": "ic",
    "RF_Mixer": "ic",
    "RF_Switch": "ic",
    "RF_AM_FM": "ic",
    "RF_GSM": "ic",
    "Driver_Display": "ic",
    "Driver_FET": "ic",
    "Driver_LED": "ic",
    "Driver_Motor": "ic",
    "Driver_Relay": "ic",
    "Driver_Haptic": "ic",
    "Driver_TEC": "ic",
    "Display_Character": "ic",
    "Display_Graphic": "ic",
    "Battery_Management": "ic",
    "Buffer": "ic",
    "Logic_LevelTranslator": "ic",
    "Logic_Programmable": "ic",
    "Video": "ic",
    "Audio": "ic",
    "Motor": "passive",
    "Mechanical": "connector",
    "Valve": "passive",
    "Graphic": "passive",
    "Jumper": "connector",
    "Potentiometer_Digital": "ic",
    "Fiber_Optic": "interface",
    "GPU": "ic",
    "Triac_Thyristor": "transistor",
    "Converter_ACDC": "regulator",
    "Converter_DCDC": "regulator",
    "Simulation_SPICE": "passive",
    "power": "power",
    "pspice": "passive",
}


def get_library_list() -> list[str]:
    """Fetch list of .dcm files from GitHub."""
    req = urllib.request.Request(GITHUB_TREE_URL, headers={"User-Agent": "RouteAI-Indexer"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())

    return [t["path"] for t in data["tree"] if t["path"].endswith(".dcm")]


def parse_dcm(content: str, lib_name: str) -> list[dict]:
    """Parse a .dcm file and extract components."""
    components = []
    current_name = None
    current_desc = ""
    current_keywords = ""
    current_datasheet = ""

    for line in content.splitlines():
        if line.startswith("$CMP "):
            current_name = line[5:].strip()
        elif line.startswith("D "):
            current_desc = line[2:].strip()
        elif line.startswith("K "):
            current_keywords = line[2:].strip()
        elif line.startswith("F "):
            current_datasheet = line[2:].strip()
            if current_datasheet == "~":
                current_datasheet = ""
        elif line.startswith("$ENDCMP"):
            if current_name:
                category = CATEGORY_MAP.get(lib_name, "ic")
                # Try to detect category from library name patterns
                for prefix in ("MCU_ST_STM32", "MCU_Microchip", "MCU_NXP", "MCU_Nordic",
                               "MCU_Espressif", "MCU_Texas", "MCU_SiliconLabs", "MCU_SiFive",
                               "MCU_Intel", "MCU_Cypress", "MCU_Dialog", "MCU_Parallax",
                               "MCU_Renesas", "MCU_STC", "MCU_Module"):
                    if lib_name.startswith(prefix):
                        category = "mcu"
                        break
                for prefix in ("CPLD_", "FPGA_", "DSP_", "CPU"):
                    if lib_name.startswith(prefix):
                        category = "ic"
                        break

                components.append({
                    "mpn": current_name,
                    "manufacturer": "",
                    "description": current_desc or current_name,
                    "category": category,
                    "package": "",
                    "source": "kicad",
                    "keywords": current_keywords,
                    "datasheet_url": current_datasheet if current_datasheet.startswith("http") else None,
                    "library": lib_name,
                    "has_symbol": True,
                    "has_footprint": False,
                })

            current_name = None
            current_desc = ""
            current_keywords = ""
            current_datasheet = ""

    return components


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching KiCad library list from GitHub...")
    dcm_files = get_library_list()
    print(f"Found {len(dcm_files)} libraries")

    all_components = []
    errors = 0

    for i, dcm_file in enumerate(dcm_files):
        lib_name = dcm_file.replace(".dcm", "")
        url = f"{RAW_BASE}/{dcm_file}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "RouteAI-Indexer"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8", errors="replace")

            components = parse_dcm(content, lib_name)
            all_components.extend(components)

            sys.stdout.write(f"\r  [{i+1}/{len(dcm_files)}] {lib_name}: {len(components)} components (total: {len(all_components)})")
            sys.stdout.flush()

            # Rate limit: don't hammer GitHub
            if i % 10 == 9:
                time.sleep(1)

        except Exception as e:
            errors += 1
            sys.stdout.write(f"\r  [{i+1}/{len(dcm_files)}] {lib_name}: ERROR ({e})")
            sys.stdout.flush()

    print(f"\n\nDone! Total: {len(all_components)} components from {len(dcm_files)} libraries ({errors} errors)")

    # Write index
    output_path = OUTPUT_DIR / "kicad_index.json"
    with open(output_path, "w") as f:
        json.dump(all_components, f, separators=(",", ":"))

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"Written to {output_path} ({size_mb:.1f} MB)")

    # Print category summary
    categories: dict[str, int] = {}
    for c in all_components:
        categories[c["category"]] = categories.get(c["category"], 0) + 1
    print("\nCategory breakdown:")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
        print(f"  {cat:20s}: {count:5d}")


if __name__ == "__main__":
    main()
