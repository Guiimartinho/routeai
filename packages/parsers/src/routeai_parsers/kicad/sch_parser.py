"""Parser for KiCad 8 .kicad_sch schematic files.

Reads the S-expression format used by KiCad 8 and produces a SchematicDesign
model containing all schematic data: symbols, wires, labels, buses,
hierarchical sheets, and resolved nets.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from routeai_parsers.kicad.sexpr import parse as parse_sexpr, find_node, find_nodes, node_value
from routeai_parsers.models import (
    HierarchicalSheet,
    LabelType,
    LibSymbol,
    LibSymbolPin,
    Point2D,
    SchBus,
    SchJunction,
    SchLabel,
    SchNet,
    SchNoConnect,
    SchPin,
    SchProperty,
    SchSymbol,
    SchWire,
    SchematicDesign,
)

logger = logging.getLogger(__name__)

# Tolerance for matching wire endpoints to pin/label positions (mm)
_POSITION_TOLERANCE = 0.01


class KiCadSchParser:
    """Parser for KiCad 8 .kicad_sch files.

    Usage::

        parser = KiCadSchParser()
        schematic = parser.parse("my_schematic.kicad_sch")
        print(schematic.symbols)
    """

    def parse(self, filepath: str | Path) -> SchematicDesign:
        """Parse a .kicad_sch file and return a SchematicDesign model.

        Args:
            filepath: Path to the .kicad_sch file.

        Returns:
            A fully populated SchematicDesign instance with resolved nets.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is not a valid kicad_sch file.
        """
        filepath = Path(filepath)
        text = filepath.read_text(encoding="utf-8")
        return self.parse_text(text)

    def parse_text(self, text: str) -> SchematicDesign:
        """Parse .kicad_sch content from a string.

        Args:
            text: The raw S-expression content of a .kicad_sch file.

        Returns:
            A fully populated SchematicDesign instance with resolved nets.
        """
        ast = parse_sexpr(text)
        if not isinstance(ast, list) or not ast or ast[0] != "kicad_sch":
            raise ValueError("Not a valid kicad_sch file: missing kicad_sch root element")
        return self._parse_schematic(ast)

    def _parse_schematic(self, ast: list[Any]) -> SchematicDesign:
        """Parse the top-level kicad_sch AST node."""
        sch = SchematicDesign()

        # Version
        version_node = find_node(ast, "version")
        if version_node:
            sch.version = int(node_value(version_node, 0))

        # Generator
        generator_node = find_node(ast, "generator")
        if generator_node:
            sch.generator = str(node_value(generator_node, ""))

        # UUID
        uuid_node = find_node(ast, "uuid")
        if uuid_node:
            sch.uuid = str(node_value(uuid_node, ""))

        # Title block
        title_block = find_node(ast, "title_block")
        if title_block:
            self._parse_title_block(title_block, sch)

        # Library symbols
        lib_symbols_node = find_node(ast, "lib_symbols")
        if lib_symbols_node:
            sch.lib_symbols = self._parse_lib_symbols(lib_symbols_node)

        # Symbol instances (components placed on the schematic)
        for sym_node in find_nodes(ast, "symbol"):
            sch.symbols.append(self._parse_symbol(sym_node))

        # Wires
        for wire_node in find_nodes(ast, "wire"):
            sch.wires.append(self._parse_wire(wire_node))

        # Buses
        for bus_node in find_nodes(ast, "bus"):
            sch.buses.append(self._parse_bus(bus_node))

        # Labels (local net labels)
        for label_node in find_nodes(ast, "label"):
            sch.labels.append(self._parse_label(label_node, LabelType.LOCAL))

        # Global labels
        for gl_node in find_nodes(ast, "global_label"):
            sch.labels.append(self._parse_label(gl_node, LabelType.GLOBAL))

        # Hierarchical labels
        for hl_node in find_nodes(ast, "hierarchical_label"):
            sch.labels.append(self._parse_label(hl_node, LabelType.HIERARCHICAL))

        # Power symbols: In KiCad 8, power symbols are regular symbol instances
        # with lib_ids prefixed by "power:" (e.g., "power:GND", "power:VCC").
        # Detect them and create power labels from their Value property and position.
        for sym in list(sch.symbols):
            if sym.lib_id and sym.lib_id.startswith("power:"):
                power_name = sym.value if sym.value else sym.lib_id.split(":", 1)[1]
                power_label = SchLabel(
                    label_type=LabelType.POWER,
                    text=power_name,
                    at=sym.at,
                )
                power_label.uuid = sym.uuid
                sch.labels.append(power_label)

        # Junctions
        for junc_node in find_nodes(ast, "junction"):
            sch.junctions.append(self._parse_junction(junc_node))

        # No-connects
        for nc_node in find_nodes(ast, "no_connect"):
            sch.no_connects.append(self._parse_no_connect(nc_node))

        # Hierarchical sheets
        for sheet_node in find_nodes(ast, "sheet"):
            sch.hierarchical_sheets.append(self._parse_sheet(sheet_node))

        # Resolve nets from connectivity
        sch.nets = self._resolve_nets(sch)

        return sch

    # ------------------------------------------------------------------
    # Title block
    # ------------------------------------------------------------------

    def _parse_title_block(self, node: list[Any], sch: SchematicDesign) -> None:
        """Parse the title_block section."""
        title_node = find_node(node, "title")
        if title_node:
            sch.title = str(node_value(title_node, ""))
        date_node = find_node(node, "date")
        if date_node:
            sch.date = str(node_value(date_node, ""))
        rev_node = find_node(node, "rev")
        if rev_node:
            sch.revision = str(node_value(rev_node, ""))
        company_node = find_node(node, "company")
        if company_node:
            sch.company = str(node_value(company_node, ""))

    # ------------------------------------------------------------------
    # Library symbols
    # ------------------------------------------------------------------

    def _parse_lib_symbols(self, node: list[Any]) -> list[LibSymbol]:
        """Parse the lib_symbols section."""
        symbols: list[LibSymbol] = []
        for sym_node in find_nodes(node, "symbol"):
            symbols.append(self._parse_lib_symbol(sym_node))
        return symbols

    def _parse_lib_symbol(self, node: list[Any]) -> LibSymbol:
        """Parse a single library symbol definition."""
        lib_sym = LibSymbol()
        if len(node) > 1 and isinstance(node[1], str):
            lib_sym.lib_id = node[1]
        lib_sym.raw = node

        # Parse properties
        for prop_node in find_nodes(node, "property"):
            lib_sym.properties.append(self._parse_property(prop_node))

        # Parse pins from sub-symbols
        # In KiCad, lib symbols can have sub-symbols like "Device:R_0_1"
        # Pins are within these sub-symbols
        self._collect_pins_recursive(node, lib_sym)

        return lib_sym

    def _collect_pins_recursive(self, node: list[Any], lib_sym: LibSymbol) -> None:
        """Recursively collect pin definitions from a library symbol and its sub-symbols."""
        for item in node:
            if not isinstance(item, list) or not item:
                continue
            if item[0] == "pin":
                pin = self._parse_lib_pin(item)
                if pin:
                    lib_sym.pins.append(pin)
            elif item[0] == "symbol":
                # Sub-symbol: recurse into it
                self._collect_pins_recursive(item, lib_sym)

    def _parse_lib_pin(self, node: list[Any]) -> LibSymbolPin | None:
        """Parse a pin definition within a library symbol.

        KiCad pin format: (pin <type> <style> (at x y angle) (length l) (name "N" ...) (number "1" ...))
        """
        pin = LibSymbolPin()

        if len(node) > 1 and isinstance(node[1], str):
            pin.pin_type = node[1]

        at_node = find_node(node, "at")
        if at_node:
            pin.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
            if len(at_node) > 3:
                pin.angle = float(at_node[3])

        length_node = find_node(node, "length")
        if length_node:
            pin.length = float(node_value(length_node, 2.54))

        name_node = find_node(node, "name")
        if name_node and len(name_node) > 1:
            pin.name = str(name_node[1])

        number_node = find_node(node, "number")
        if number_node and len(number_node) > 1:
            pin.number = str(number_node[1])

        return pin

    # ------------------------------------------------------------------
    # Symbol instances
    # ------------------------------------------------------------------

    def _parse_symbol(self, node: list[Any]) -> SchSymbol:
        """Parse a placed symbol instance on the schematic."""
        sym = SchSymbol()

        # lib_id
        lib_id_node = find_node(node, "lib_id")
        if lib_id_node:
            sym.lib_id = str(node_value(lib_id_node, ""))

        # Position
        at_node = find_node(node, "at")
        if at_node:
            sym.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
            if len(at_node) > 3:
                sym.angle = float(at_node[3])

        # Mirror
        mirror_node = find_node(node, "mirror")
        if mirror_node:
            sym.mirror = str(node_value(mirror_node, ""))

        # Unit
        unit_node = find_node(node, "unit")
        if unit_node:
            sym.unit = int(node_value(unit_node, 1))

        # UUID
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            sym.uuid = str(node_value(uuid_node, ""))

        # Properties
        for prop_node in find_nodes(node, "property"):
            prop = self._parse_property(prop_node)
            sym.properties.append(prop)
            if prop.key == "Reference":
                sym.reference = prop.value
            elif prop.key == "Value":
                sym.value = prop.value

        # Pins
        for pin_node in find_nodes(node, "pin"):
            pin = SchPin()
            if len(pin_node) > 1:
                pin.number = str(pin_node[1])
            uuid_sub = find_node(pin_node, "uuid")
            if uuid_sub:
                pin.uuid = str(node_value(uuid_sub, ""))
            sym.pins.append(pin)

        return sym

    def _parse_property(self, node: list[Any]) -> SchProperty:
        """Parse a property node."""
        prop = SchProperty()
        if len(node) > 1:
            prop.key = str(node[1])
        if len(node) > 2:
            prop.value = str(node[2])

        at_node = find_node(node, "at")
        if at_node:
            prop.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
            if len(at_node) > 3:
                prop.angle = float(at_node[3])

        effects_node = find_node(node, "effects")
        if effects_node:
            hide_node = find_node(effects_node, "hide")
            if hide_node:
                val = node_value(hide_node, "yes")
                prop.effects_hidden = val == "yes" or val is True

        return prop

    # ------------------------------------------------------------------
    # Wires, buses, labels
    # ------------------------------------------------------------------

    def _parse_wire(self, node: list[Any]) -> SchWire:
        """Parse a wire node."""
        wire = SchWire()
        pts_node = find_node(node, "pts")
        if pts_node:
            wire.points = self._parse_pts(pts_node)
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            wire.uuid = str(node_value(uuid_node, ""))
        return wire

    def _parse_bus(self, node: list[Any]) -> SchBus:
        """Parse a bus node."""
        bus = SchBus()
        pts_node = find_node(node, "pts")
        if pts_node:
            bus.points = self._parse_pts(pts_node)
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            bus.uuid = str(node_value(uuid_node, ""))
        return bus

    def _parse_label(self, node: list[Any], label_type: LabelType) -> SchLabel:
        """Parse a label, global_label, hierarchical_label, or power_port node."""
        label = SchLabel(label_type=label_type)
        if len(node) > 1 and isinstance(node[1], str):
            label.text = node[1]

        at_node = find_node(node, "at")
        if at_node:
            label.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
            if len(at_node) > 3:
                label.angle = float(at_node[3])

        uuid_node = find_node(node, "uuid")
        if uuid_node:
            label.uuid = str(node_value(uuid_node, ""))

        shape_node = find_node(node, "shape")
        if shape_node:
            label.shape = str(node_value(shape_node, ""))

        return label

    def _parse_junction(self, node: list[Any]) -> SchJunction:
        """Parse a junction node."""
        junc = SchJunction()
        at_node = find_node(node, "at")
        if at_node:
            junc.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
        diameter_node = find_node(node, "diameter")
        if diameter_node:
            junc.diameter = float(node_value(diameter_node, 0.0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            junc.uuid = str(node_value(uuid_node, ""))
        return junc

    def _parse_no_connect(self, node: list[Any]) -> SchNoConnect:
        """Parse a no_connect node."""
        nc = SchNoConnect()
        at_node = find_node(node, "at")
        if at_node:
            nc.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            nc.uuid = str(node_value(uuid_node, ""))
        return nc

    # ------------------------------------------------------------------
    # Hierarchical sheets
    # ------------------------------------------------------------------

    def _parse_sheet(self, node: list[Any]) -> HierarchicalSheet:
        """Parse a hierarchical sheet node."""
        sheet = HierarchicalSheet()

        at_node = find_node(node, "at")
        if at_node:
            sheet.at = Point2D(
                x=float(at_node[1]) if len(at_node) > 1 else 0.0,
                y=float(at_node[2]) if len(at_node) > 2 else 0.0,
            )

        size_node = find_node(node, "size")
        if size_node:
            sheet.size_x = float(size_node[1]) if len(size_node) > 1 else 0.0
            sheet.size_y = float(size_node[2]) if len(size_node) > 2 else 0.0

        uuid_node = find_node(node, "uuid")
        if uuid_node:
            sheet.uuid = str(node_value(uuid_node, ""))

        # Properties
        for prop_node in find_nodes(node, "property"):
            prop = self._parse_property(prop_node)
            sheet.properties.append(prop)
            if prop.key == "Sheetname" or prop.key == "Sheet name":
                sheet.sheet_name = prop.value
            elif prop.key == "Sheetfile" or prop.key == "Sheet file":
                sheet.file_name = prop.value

        # Sheet pins
        for pin_node in find_nodes(node, "pin"):
            pin = SchPin()
            if len(pin_node) > 1:
                pin.name = str(pin_node[1])
            at_sub = find_node(pin_node, "at")
            if at_sub:
                pin.position = Point2D(
                    x=float(at_sub[1]) if len(at_sub) > 1 else 0.0,
                    y=float(at_sub[2]) if len(at_sub) > 2 else 0.0,
                )
            uuid_sub = find_node(pin_node, "uuid")
            if uuid_sub:
                pin.uuid = str(node_value(uuid_sub, ""))
            sheet.pins.append(pin)

        return sheet

    # ------------------------------------------------------------------
    # Net resolution
    # ------------------------------------------------------------------

    def _resolve_nets(self, sch: SchematicDesign) -> list[SchNet]:
        """Resolve netlist from schematic connectivity.

        Connects wire endpoints to symbol pins and labels to determine which
        pins share the same electrical net. Global labels and power ports
        create named nets that span the entire schematic hierarchy.

        Algorithm:
        1. Build a map of all connection points (pin positions, wire endpoints,
           label positions).
        2. Use union-find to group connected points.
        3. Assign net names from labels (global > local).
        4. Collect pins belonging to each net.
        """
        # Compute absolute pin positions for each symbol
        pin_positions: list[tuple[float, float, str, str]] = []  # (x, y, ref, pin_number)
        for sym in sch.symbols:
            lib_sym = sch.lib_symbol_by_id(sym.lib_id)
            if not lib_sym:
                continue
            for lib_pin in lib_sym.pins:
                # Transform pin position from symbol-local to schematic coordinates
                abs_pos = self._transform_pin_position(
                    lib_pin.at, lib_pin.angle, sym.at, sym.angle, sym.mirror
                )
                pin_positions.append((abs_pos.x, abs_pos.y, sym.reference, lib_pin.number))

        # Build spatial index of all connection points
        # Key: (rounded_x, rounded_y) -> set of node IDs
        node_id_counter = 0
        point_to_nodes: dict[tuple[float, float], list[int]] = defaultdict(list)
        node_data: dict[int, dict[str, Any]] = {}

        # Add pin positions
        for px, py, ref, pin_num in pin_positions:
            key = (round(px, 2), round(py, 2))
            nid = node_id_counter
            node_id_counter += 1
            point_to_nodes[key].append(nid)
            node_data[nid] = {"type": "pin", "ref": ref, "pin": pin_num}

        # Add wire endpoints
        wire_endpoint_nodes: list[tuple[tuple[float, float], int]] = []
        for wire in sch.wires:
            for pt in wire.points:
                key = (round(pt.x, 2), round(pt.y, 2))
                nid = node_id_counter
                node_id_counter += 1
                point_to_nodes[key].append(nid)
                node_data[nid] = {"type": "wire"}
                wire_endpoint_nodes.append((key, nid))

        # Add labels
        label_nodes: list[tuple[int, SchLabel]] = []
        for label in sch.labels:
            key = (round(label.at.x, 2), round(label.at.y, 2))
            nid = node_id_counter
            node_id_counter += 1
            point_to_nodes[key].append(nid)
            node_data[nid] = {"type": "label", "label": label}
            label_nodes.append((nid, label))

        # Union-Find
        parent: dict[int, int] = {i: i for i in range(node_id_counter)}
        rank: dict[int, int] = {i: 0 for i in range(node_id_counter)}

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int) -> None:
            ra, rb = find(a), find(b)
            if ra == rb:
                return
            if rank[ra] < rank[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            if rank[ra] == rank[rb]:
                rank[ra] += 1

        # Connect all nodes at the same position
        for key, nids in point_to_nodes.items():
            for i in range(1, len(nids)):
                union(nids[0], nids[i])

        # Connect wire endpoints belonging to the same wire
        for wire in sch.wires:
            if len(wire.points) >= 2:
                keys = [(round(pt.x, 2), round(pt.y, 2)) for pt in wire.points]
                # Get a node from the first endpoint
                if keys[0] in point_to_nodes and keys[-1] in point_to_nodes:
                    n1 = point_to_nodes[keys[0]][0]
                    n2 = point_to_nodes[keys[-1]][0]
                    union(n1, n2)
                # Connect all intermediate points too
                for i in range(len(keys) - 1):
                    if keys[i] in point_to_nodes and keys[i + 1] in point_to_nodes:
                        union(point_to_nodes[keys[i]][0], point_to_nodes[keys[i + 1]][0])

        # Group nodes by their root
        groups: dict[int, list[int]] = defaultdict(list)
        for nid in range(node_id_counter):
            groups[find(nid)].append(nid)

        # Build nets from groups
        nets: list[SchNet] = []
        seen_roots: set[int] = set()

        for root, members in groups.items():
            if root in seen_roots:
                continue
            seen_roots.add(root)

            pins: list[tuple[str, str]] = []
            label_names: list[str] = []
            is_power = False
            net_name = ""

            for nid in members:
                data = node_data[nid]
                if data["type"] == "pin":
                    pins.append((data["ref"], data["pin"]))
                elif data["type"] == "label":
                    lbl: SchLabel = data["label"]
                    label_names.append(lbl.text)
                    if lbl.label_type == LabelType.POWER:
                        is_power = True
                    # Priority: power > global > hierarchical > local
                    if not net_name:
                        net_name = lbl.text
                    elif lbl.label_type == LabelType.POWER:
                        net_name = lbl.text
                    elif lbl.label_type == LabelType.GLOBAL and not is_power:
                        net_name = lbl.text

            # Only create a net if there are pins or labels
            if pins or label_names:
                if not net_name and pins:
                    # Auto-generate name from first pin
                    net_name = f"Net-({pins[0][0]}-{pins[0][1]})"
                elif not net_name:
                    net_name = f"Net-{root}"

                nets.append(SchNet(
                    name=net_name,
                    pins=pins,
                    labels=label_names,
                    is_power=is_power,
                ))

        return nets

    def _transform_pin_position(
        self,
        pin_local: Point2D,
        pin_angle_deg: float,
        sym_pos: Point2D,
        sym_angle_deg: float,
        mirror: str,
    ) -> Point2D:
        """Transform a library pin position to schematic coordinates.

        Applies the symbol's rotation, mirror, and translation to the pin's
        local position within the library symbol.
        """
        x, y = pin_local.x, pin_local.y

        # Apply mirror
        if mirror == "x":
            x = -x
        elif mirror == "y":
            y = -y

        # Apply symbol rotation
        if sym_angle_deg != 0.0:
            rad = math.radians(sym_angle_deg)
            cos_a = math.cos(rad)
            sin_a = math.sin(rad)
            x, y = x * cos_a - y * sin_a, x * sin_a + y * cos_a

        # Translate to symbol position
        return Point2D(x=sym_pos.x + x, y=sym_pos.y + y)

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _parse_pts(self, node: list[Any]) -> list[Point2D]:
        """Parse a (pts (xy x y) ...) node."""
        points: list[Point2D] = []
        for item in node[1:]:
            if isinstance(item, list) and item and item[0] == "xy":
                x = float(item[1]) if len(item) > 1 else 0.0
                y = float(item[2]) if len(item) > 2 else 0.0
                points.append(Point2D(x=x, y=y))
        return points
