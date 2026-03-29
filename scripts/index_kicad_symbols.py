#!/usr/bin/env python3
"""Download KiCad .lib symbol files and extract FULL pin data.

Creates a JSON index with pin names, numbers, positions, and types
for all components — usable by the frontend for accurate symbol rendering.

Output: data/component_library/kicad_symbols.json
"""

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

# Download ALL 203 libraries — get the list dynamically from GitHub
LIBS_TO_INDEX = None  # Will be fetched from GitHub API

RAW_BASE = "https://raw.githubusercontent.com/KiCad/kicad-symbols/master"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "component_library"


def parse_lib_file(content: str, lib_name: str) -> list[dict]:
    """Parse a KiCad .lib file and extract components with full pin data."""
    components = []

    # Find each DEF...ENDDEF block
    blocks = re.findall(r'DEF\s+(\S+)\s+(\S+)\s+.*?\nENDDEF', content, re.DOTALL)

    for block_match in re.finditer(r'(DEF\s+(\S+)\s+(\S+)\s+.*?\nENDDEF)', content, re.DOTALL):
        block = block_match.group(1)
        comp_name = block_match.group(2)
        ref_prefix = block_match.group(3)

        # Extract pins: X name number posX posY length direction nameSize numSize unit convert type [shape]
        pins = []
        for pin_match in re.finditer(
            r'^X\s+(\S+)\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+([RLUD])\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)',
            block, re.MULTILINE
        ):
            name = pin_match.group(1)
            number = pin_match.group(2)
            x = int(pin_match.group(3))
            y = int(pin_match.group(4))
            length = int(pin_match.group(5))
            direction = pin_match.group(6)
            pin_type_code = pin_match.group(11)

            # Map KiCad pin type codes to readable types
            type_map = {
                'I': 'input', 'O': 'output', 'B': 'bidirectional',
                'T': 'tri_state', 'P': 'passive', 'U': 'unspecified',
                'W': 'power', 'w': 'power_flag', 'C': 'open_collector',
                'E': 'open_emitter', 'N': 'not_connected',
            }
            pin_type = type_map.get(pin_type_code, 'passive')

            # Convert KiCad mils to mm (1 mil = 0.0254 mm)
            # But for schematic rendering we keep in KiCad units (mils / 50 for our grid)
            scale = 0.02  # Convert KiCad mils to our schematic units

            pins.append({
                'name': name if name != '~' else '',
                'number': number,
                'x': round(x * scale, 2),
                'y': round(-y * scale, 2),  # KiCad Y is inverted
                'type': pin_type,
                'direction': direction,
                'length': round(length * scale, 2),
            })

        if pins:
            # Get description from DRAW section (rectangle bounds)
            rect_match = re.search(r'^S\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)', block, re.MULTILINE)
            body = None
            if rect_match:
                scale = 0.02
                body = {
                    'x1': round(int(rect_match.group(1)) * scale, 2),
                    'y1': round(-int(rect_match.group(2)) * scale, 2),
                    'x2': round(int(rect_match.group(3)) * scale, 2),
                    'y2': round(-int(rect_match.group(4)) * scale, 2),
                }

            components.append({
                'name': comp_name,
                'refPrefix': ref_prefix,
                'library': lib_name,
                'pinCount': len(pins),
                'pins': pins,
                'body': body,
            })

    return components


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_components = []
    errors = 0

    # Fetch ALL library names from GitHub
    global LIBS_TO_INDEX
    if LIBS_TO_INDEX is None:
        print("Fetching library list from GitHub...")
        req = urllib.request.Request(
            "https://api.github.com/repos/KiCad/kicad-symbols/git/trees/master",
            headers={"User-Agent": "RouteAI-Indexer"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        LIBS_TO_INDEX = [t["path"].replace(".lib", "") for t in data["tree"] if t["path"].endswith(".lib")]
        print(f"Found {len(LIBS_TO_INDEX)} libraries")

    print(f"Downloading {len(LIBS_TO_INDEX)} KiCad symbol libraries...")

    for i, lib_name in enumerate(LIBS_TO_INDEX):
        url = f"{RAW_BASE}/{lib_name}.lib"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "RouteAI-Indexer"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                content = resp.read().decode("utf-8", errors="replace")

            components = parse_lib_file(content, lib_name)
            all_components.extend(components)

            sys.stdout.write(f"\r  [{i+1}/{len(LIBS_TO_INDEX)}] {lib_name}: {len(components)} symbols (total: {len(all_components)})")
            sys.stdout.flush()

            if i % 5 == 4:
                time.sleep(0.5)  # Rate limit

        except Exception as e:
            errors += 1
            sys.stdout.write(f"\r  [{i+1}/{len(LIBS_TO_INDEX)}] {lib_name}: ERROR ({e})")
            sys.stdout.flush()

    print(f"\n\nDone! {len(all_components)} symbols from {len(LIBS_TO_INDEX)} libraries ({errors} errors)")

    # Write output
    output_path = OUTPUT_DIR / "kicad_symbols.json"
    with open(output_path, "w") as f:
        json.dump(all_components, f, separators=(",", ":"))

    size_mb = output_path.stat().st_size / 1024 / 1024
    print(f"Written to {output_path} ({size_mb:.1f} MB)")

    # Stats
    total_pins = sum(len(c['pins']) for c in all_components)
    print(f"Total pins indexed: {total_pins}")

    # Sample
    stm32 = [c for c in all_components if 'STM32F103C8' in c['name']]
    if stm32:
        s = stm32[0]
        print(f"\nSample: {s['name']} ({s['pinCount']} pins)")
        for p in s['pins'][:5]:
            print(f"  Pin {p['number']:4s} {p['name']:12s} ({p['x']:6.2f}, {p['y']:6.2f}) {p['type']}")


if __name__ == "__main__":
    main()
