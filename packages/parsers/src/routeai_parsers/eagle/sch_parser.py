"""Parser for Autodesk Eagle .sch schematic files.

Eagle .sch files are XML-based. This parser reads the XML and converts
schematic data (parts, instances, nets, buses, sheets) into the RouteAI
unified SchematicDesign model.

Supports Eagle 6.x through 9.x file formats.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from routeai_parsers.models import (
    LabelType,
    LibSymbol,
    LibSymbolPin,
    Point2D,
    SchBus,
    SchematicDesign,
    SchJunction,
    SchLabel,
    SchNet,
    SchPin,
    SchProperty,
    SchSymbol,
    SchWire,
)

logger = logging.getLogger(__name__)


def _float(val: str | None, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _int(val: str | None, default: int = 0) -> int:
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


class EagleSchParser:
    """Parser for Eagle .sch schematic files.

    Reads Eagle XML format and produces a SchematicDesign model with
    library symbols, placed parts, wires, labels, buses, and resolved nets.

    Usage::

        parser = EagleSchParser()
        schematic = parser.parse("my_schematic.sch")
    """

    def parse(self, filepath: str | Path) -> SchematicDesign:
        """Parse an Eagle .sch file and return a SchematicDesign.

        Args:
            filepath: Path to the Eagle .sch file.

        Returns:
            A fully populated SchematicDesign with resolved nets.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is not a valid Eagle schematic.
        """
        filepath = Path(filepath)
        tree = ET.parse(filepath)
        root = tree.getroot()
        return self._parse_root(root)

    def parse_text(self, text: str) -> SchematicDesign:
        """Parse Eagle .sch XML from a string."""
        root = ET.fromstring(text)
        return self._parse_root(root)

    def _parse_root(self, root: ET.Element) -> SchematicDesign:
        """Parse the root <eagle> element."""
        sch = SchematicDesign(generator="eagle")

        drawing = root.find("drawing")
        if drawing is None:
            raise ValueError("Not a valid Eagle file: missing <drawing> element")

        schematic_elem = drawing.find("schematic")
        if schematic_elem is None:
            raise ValueError("Not a valid Eagle .sch file: missing <schematic> element")

        # Parse description if present
        desc = schematic_elem.find("description")
        if desc is not None and desc.text:
            sch.title = desc.text.strip()

        # Parse libraries -> lib_symbols
        libraries_elem = schematic_elem.find("libraries")
        lib_symbol_map: dict[str, LibSymbol] = {}
        if libraries_elem is not None:
            sch.lib_symbols, lib_symbol_map = self._parse_libraries(libraries_elem)

        # Parse parts -> map of part name -> (library, deviceset, device, value)
        parts_elem = schematic_elem.find("parts")
        parts_map: dict[str, dict[str, str]] = {}
        if parts_elem is not None:
            parts_map = self._parse_parts(parts_elem)

        # Parse sheets
        sheets_elem = schematic_elem.find("sheets")
        if sheets_elem is not None:
            self._parse_sheets(sheets_elem, sch, parts_map, lib_symbol_map)

        # Resolve nets
        sch.nets = self._resolve_nets(schematic_elem, sch)

        return sch

    # ------------------------------------------------------------------
    # Libraries
    # ------------------------------------------------------------------

    def _parse_libraries(
        self, libraries_elem: ET.Element
    ) -> tuple[list[LibSymbol], dict[str, LibSymbol]]:
        """Parse <libraries> into LibSymbol list."""
        symbols: list[LibSymbol] = []
        symbol_map: dict[str, LibSymbol] = {}

        for lib_el in libraries_elem.findall("library"):
            lib_name = lib_el.get("name", "")
            devicesets = lib_el.find("devicesets")
            if devicesets is None:
                continue

            # Also parse raw symbols for pin geometry
            symbol_defs: dict[str, ET.Element] = {}
            symbols_el = lib_el.find("symbols")
            if symbols_el is not None:
                for sym_el in symbols_el.findall("symbol"):
                    sym_name = sym_el.get("name", "")
                    symbol_defs[sym_name] = sym_el

            for ds_el in devicesets.findall("deviceset"):
                ds_name = ds_el.get("name", "")

                # Parse gates to find which symbols they use
                gates_el = ds_el.find("gates")
                gate_symbol_map: dict[str, str] = {}
                if gates_el is not None:
                    for gate_el in gates_el.findall("gate"):
                        gate_name = gate_el.get("name", "")
                        gate_symbol = gate_el.get("symbol", "")
                        gate_symbol_map[gate_name] = gate_symbol

                # Parse devices to get connect mappings (gate.pin -> pad)
                devices_el = ds_el.find("devices")
                if devices_el is None:
                    continue

                for dev_el in devices_el.findall("device"):
                    dev_name = dev_el.get("name", "")
                    lib_id = f"{lib_name}:{ds_name}{dev_name}"

                    lib_sym = LibSymbol(lib_id=lib_id)

                    # Collect pins from all gate symbols
                    for gate_name, sym_name in gate_symbol_map.items():
                        sym_def = symbol_defs.get(sym_name)
                        if sym_def is None:
                            continue
                        for pin_el in sym_def.findall("pin"):
                            pin_name = pin_el.get("name", "")
                            x = _float(pin_el.get("x"))
                            y = _float(pin_el.get("y"))
                            length_str = pin_el.get("length", "middle")
                            direction = pin_el.get("direction", "")
                            rot_str = pin_el.get("rot", "R0")

                            length_val = {
                                "point": 0.0,
                                "short": 2.54,
                                "middle": 5.08,
                                "long": 7.62,
                            }.get(length_str, 5.08)

                            angle = self._parse_rotation_angle(rot_str)

                            # Map direction to KiCad pin type
                            pin_type = {
                                "in": "input",
                                "out": "output",
                                "io": "bidirectional",
                                "pas": "passive",
                                "pwr": "power_in",
                                "sup": "power_in",
                                "hiz": "tri_state",
                                "oc": "openCollector",
                            }.get(direction, "passive")

                            lib_sym.pins.append(LibSymbolPin(
                                name=pin_name,
                                number=pin_name,
                                pin_type=pin_type,
                                at=Point2D(x=x, y=y),
                                angle=angle,
                                length=length_val,
                            ))

                    # Parse connect elements for pad number mapping
                    connects_el = dev_el.find("connects")
                    pin_pad_map: dict[str, str] = {}
                    if connects_el is not None:
                        for connect_el in connects_el.findall("connect"):
                            gate = connect_el.get("gate", "")
                            pin = connect_el.get("pin", "")
                            pad = connect_el.get("pad", "")
                            pin_pad_map[f"{gate}.{pin}"] = pad

                    # Update pin numbers from connect mapping
                    for pin in lib_sym.pins:
                        for gate_pin_key, pad_num in pin_pad_map.items():
                            parts = gate_pin_key.split(".", 1)
                            if len(parts) == 2 and parts[1] == pin.name:
                                pin.number = pad_num
                                break

                    # Properties from deviceset
                    prefix = ds_el.get("prefix", "")
                    if prefix:
                        lib_sym.properties.append(SchProperty(
                            key="Reference", value=prefix
                        ))

                    symbols.append(lib_sym)
                    symbol_map[lib_id] = lib_sym

        return symbols, symbol_map

    # ------------------------------------------------------------------
    # Parts
    # ------------------------------------------------------------------

    def _parse_parts(self, parts_elem: ET.Element) -> dict[str, dict[str, str]]:
        """Parse <parts> into a map: part_name -> attribute dict."""
        parts_map: dict[str, dict[str, str]] = {}

        for part_el in parts_elem.findall("part"):
            name = part_el.get("name", "")
            parts_map[name] = {
                "library": part_el.get("library", ""),
                "deviceset": part_el.get("deviceset", ""),
                "device": part_el.get("device", ""),
                "value": part_el.get("value", ""),
            }

        return parts_map

    # ------------------------------------------------------------------
    # Sheets
    # ------------------------------------------------------------------

    def _parse_sheets(
        self,
        sheets_elem: ET.Element,
        sch: SchematicDesign,
        parts_map: dict[str, dict[str, str]],
        lib_symbol_map: dict[str, LibSymbol],
    ) -> None:
        """Parse all <sheet> elements within <sheets>."""
        for sheet_el in sheets_elem.findall("sheet"):
            # Parse instances (placed symbols)
            instances_el = sheet_el.find("instances")
            if instances_el is not None:
                for inst_el in instances_el.findall("instance"):
                    sym = self._parse_instance(inst_el, parts_map, lib_symbol_map)
                    if sym is not None:
                        sch.symbols.append(sym)

            # Parse nets (wires and labels)
            nets_el = sheet_el.find("nets")
            if nets_el is not None:
                self._parse_sheet_nets(nets_el, sch)

            # Parse buses
            busses_el = sheet_el.find("busses")
            if busses_el is not None:
                for bus_el in busses_el.findall("bus"):
                    for seg_el in bus_el.findall("segment"):
                        for wire_el in seg_el.findall("wire"):
                            x1 = _float(wire_el.get("x1"))
                            y1 = _float(wire_el.get("y1"))
                            x2 = _float(wire_el.get("x2"))
                            y2 = _float(wire_el.get("y2"))
                            sch.buses.append(SchBus(
                                points=[
                                    Point2D(x=x1, y=y1),
                                    Point2D(x=x2, y=y2),
                                ],
                            ))

    def _parse_instance(
        self,
        inst_el: ET.Element,
        parts_map: dict[str, dict[str, str]],
        lib_symbol_map: dict[str, LibSymbol],
    ) -> SchSymbol | None:
        """Parse a single <instance> element."""
        part_name = inst_el.get("part", "")
        gate = inst_el.get("gate", "")
        x = _float(inst_el.get("x"))
        y = _float(inst_el.get("y"))
        rot_str = inst_el.get("rot", "R0")

        part_info = parts_map.get(part_name)
        if part_info is None:
            logger.warning("Instance references unknown part: %s", part_name)
            return None

        lib_name = part_info["library"]
        ds_name = part_info["deviceset"]
        dev_name = part_info["device"]
        value = part_info.get("value", "")

        lib_id = f"{lib_name}:{ds_name}{dev_name}"
        angle = self._parse_rotation_angle(rot_str)
        mirror = "x" if rot_str.startswith("M") else ""

        sym = SchSymbol(
            lib_id=lib_id,
            at=Point2D(x=x, y=y),
            angle=angle,
            mirror=mirror,
            reference=part_name,
            value=value,
        )

        sym.properties.append(SchProperty(key="Reference", value=part_name))
        if value:
            sym.properties.append(SchProperty(key="Value", value=value))

        # Copy pins from library symbol
        lib_sym = lib_symbol_map.get(lib_id)
        if lib_sym is not None:
            for lib_pin in lib_sym.pins:
                sym.pins.append(SchPin(
                    number=lib_pin.number,
                    name=lib_pin.name,
                    position=Point2D(x=lib_pin.at.x, y=lib_pin.at.y),
                ))

        return sym

    def _parse_sheet_nets(
        self, nets_el: ET.Element, sch: SchematicDesign
    ) -> None:
        """Parse <nets> within a sheet: wires, junctions, labels."""
        for net_el in nets_el.findall("net"):
            net_name = net_el.get("name", "")

            for seg_el in net_el.findall("segment"):
                # Wires
                for wire_el in seg_el.findall("wire"):
                    x1 = _float(wire_el.get("x1"))
                    y1 = _float(wire_el.get("y1"))
                    x2 = _float(wire_el.get("x2"))
                    y2 = _float(wire_el.get("y2"))
                    sch.wires.append(SchWire(
                        points=[
                            Point2D(x=x1, y=y1),
                            Point2D(x=x2, y=y2),
                        ],
                    ))

                # Labels
                for label_el in seg_el.findall("label"):
                    x = _float(label_el.get("x"))
                    y = _float(label_el.get("y"))
                    rot_str = label_el.get("rot", "R0")
                    angle = self._parse_rotation_angle(rot_str)

                    sch.labels.append(SchLabel(
                        text=net_name,
                        label_type=LabelType.LOCAL,
                        at=Point2D(x=x, y=y),
                        angle=angle,
                    ))

                # Junctions
                for junc_el in seg_el.findall("junction"):
                    x = _float(junc_el.get("x"))
                    y = _float(junc_el.get("y"))
                    sch.junctions.append(SchJunction(
                        at=Point2D(x=x, y=y),
                    ))

                # Pinrefs (connect pins to nets -- used for net resolution)
                for pinref_el in seg_el.findall("pinref"):
                    part = pinref_el.get("part", "")
                    pin = pinref_el.get("pin", "")
                    gate = pinref_el.get("gate", "")
                    # Tag the symbol pin with its connected net
                    for sym in sch.symbols:
                        if sym.reference == part:
                            for sym_pin in sym.pins:
                                if sym_pin.name == pin or sym_pin.number == pin:
                                    sym_pin.connected_net = net_name
                                    break
                            break

    # ------------------------------------------------------------------
    # Net resolution
    # ------------------------------------------------------------------

    def _resolve_nets(
        self, schematic_elem: ET.Element, sch: SchematicDesign
    ) -> list[SchNet]:
        """Resolve nets from Eagle's explicit net definitions.

        Eagle schematics have explicit net names in the XML, so we can
        directly build the netlist without complex connectivity analysis.
        """
        net_pins: dict[str, list[tuple[str, str]]] = defaultdict(list)
        net_labels: dict[str, list[str]] = defaultdict(list)
        power_nets: set[str] = set()

        # Collect from explicit net definitions in sheets
        sheets_elem = schematic_elem.find("sheets")
        if sheets_elem is not None:
            for sheet_el in sheets_elem.findall("sheet"):
                nets_el = sheet_el.find("nets")
                if nets_el is None:
                    continue

                for net_el in nets_el.findall("net"):
                    net_name = net_el.get("name", "")
                    net_class = net_el.get("class", "0")

                    for seg_el in net_el.findall("segment"):
                        # Collect pin references
                        for pinref_el in seg_el.findall("pinref"):
                            part = pinref_el.get("part", "")
                            pin = pinref_el.get("pin", "")
                            net_pins[net_name].append((part, pin))

                        # Collect labels
                        for label_el in seg_el.findall("label"):
                            net_labels[net_name].append(net_name)

                    # Detect power nets (convention: nets starting with + or
                    # containing VCC, VDD, GND, etc.)
                    name_upper = net_name.upper()
                    if any(pwr in name_upper for pwr in
                           ["VCC", "VDD", "GND", "VSS", "V+", "V-", "+3V", "+5V",
                            "+12V", "+3.3V", "+1.8V", "+2.5V"]):
                        power_nets.add(net_name)
                    if net_name.startswith("+") or net_name.startswith("-"):
                        power_nets.add(net_name)

        # Build SchNet list
        nets: list[SchNet] = []
        for net_name, pins in net_pins.items():
            nets.append(SchNet(
                name=net_name,
                pins=pins,
                labels=net_labels.get(net_name, []),
                is_power=net_name in power_nets,
            ))

        # Include nets with only labels (no pin connections)
        for net_name, labels in net_labels.items():
            if net_name not in net_pins:
                nets.append(SchNet(
                    name=net_name,
                    pins=[],
                    labels=labels,
                    is_power=net_name in power_nets,
                ))

        return nets

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_rotation_angle(rot_str: str) -> float:
        """Parse Eagle rotation string, returning angle in degrees."""
        s = rot_str
        if s.startswith("M"):
            s = s[1:]
        if s.startswith("S"):
            s = s[1:]
        if s.startswith("R"):
            s = s[1:]
        try:
            return float(s)
        except ValueError:
            return 0.0
