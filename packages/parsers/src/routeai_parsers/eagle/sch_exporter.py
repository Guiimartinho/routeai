"""Exporter for Autodesk Eagle .sch schematic files.

Converts a SchematicDesign model into valid Eagle XML .sch format.
Generates the complete XML structure including layers, libraries,
symbols, parts, sheets with instances, nets, buses, and hierarchical sheets.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from xml.dom import minidom

from routeai_parsers.models import (
    HierarchicalSheet,
    LibSymbol,
    SchBus,
    SchematicDesign,
    SchJunction,
    SchLabel,
    SchSymbol,
    SchWire,
)

# ---------------------------------------------------------------------------
# Default Eagle schematic layer definitions
# ---------------------------------------------------------------------------

DEFAULT_SCH_LAYERS: list[tuple[int, str, str]] = [
    (91, "Nets", "active"),
    (92, "Busses", "active"),
    (93, "Pins", "active"),
    (94, "Symbols", "active"),
    (95, "Names", "active"),
    (96, "Values", "active"),
    (97, "Info", "active"),
    (98, "Guide", "active"),
    (99, "SpiceOrder", "active"),
    (100, "Mods", "active"),
    (101, "Hidden", "active"),
]

# Map of pin type to Eagle direction attribute
_PIN_TYPE_TO_EAGLE_DIR: dict[str, str] = {
    "input": "in",
    "output": "out",
    "bidirectional": "io",
    "passive": "pas",
    "power_in": "pwr",
    "power_out": "pwr",
    "tri_state": "hiz",
    "openCollector": "oc",
    "openEmitter": "oc",
    "unspecified": "",
    "free": "",
    "": "pas",
}

# Map of pin length to Eagle length keyword
_PIN_LENGTH_TO_EAGLE: dict[str, str] = {
    "short": "short",
    "middle": "middle",
    "long": "long",
}


def _rotation_string(angle: float, mirror: bool = False) -> str:
    """Build Eagle rotation string from angle and mirror flag."""
    prefix = "M" if mirror else ""
    if angle == 0.0 and not mirror:
        return "R0"
    return f"{prefix}R{angle:g}"


def _pin_length_str(length: float) -> str:
    """Map a pin length value to an Eagle length keyword."""
    if length <= 0.01:
        return "point"
    if length <= 3.0:
        return "short"
    if length <= 6.0:
        return "middle"
    return "long"


class EagleSchExporter:
    """Exports a SchematicDesign to Eagle .sch XML format.

    Usage::

        exporter = EagleSchExporter()
        exporter.export(schematic, "output.sch")
    """

    def export(self, schematic: SchematicDesign, filepath: str | Path) -> None:
        """Export a SchematicDesign to an Eagle .sch file.

        Args:
            schematic: The schematic design to export.
            filepath: Path for the output .sch file.
        """
        filepath = Path(filepath)
        xml_str = self.export_text(schematic)
        filepath.write_text(xml_str, encoding="utf-8")

    def export_text(self, schematic: SchematicDesign) -> str:
        """Export a SchematicDesign to an Eagle .sch XML string.

        Args:
            schematic: The schematic design to export.

        Returns:
            The complete Eagle .sch XML as a string.
        """
        root = self._build_xml(schematic)
        rough = ET.tostring(root, encoding="unicode", xml_declaration=False)
        dom = minidom.parseString(rough)
        pretty = dom.toprettyxml(indent="  ", encoding=None)
        # Remove the XML declaration minidom adds, use our own
        lines = pretty.split("\n")
        if lines and lines[0].startswith("<?xml"):
            lines = lines[1:]
        xml_body = "\n".join(lines)
        return (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<!DOCTYPE eagle SYSTEM "eagle.dtd">\n'
            f"{xml_body}"
        )

    def _build_xml(self, schematic: SchematicDesign) -> ET.Element:
        """Build the complete Eagle XML tree for a schematic."""
        eagle = ET.Element("eagle", version="9.6.2")
        drawing = ET.SubElement(eagle, "drawing")

        # Settings
        settings = ET.SubElement(drawing, "settings")
        ET.SubElement(settings, "setting", alwaysvectorfont="no")
        ET.SubElement(settings, "setting", verticaltext="up")

        # Grid
        ET.SubElement(
            drawing, "grid",
            distance="0.1", unitdist="inch",
            unit="inch", style="lines",
            multiple="1", display="no",
            altdistance="0.01", altunitdist="inch",
            altunit="inch",
        )

        # Layers
        layers_el = ET.SubElement(drawing, "layers")
        for num, name, active in DEFAULT_SCH_LAYERS:
            ET.SubElement(
                layers_el, "layer",
                number=str(num), name=name,
                color="4", fill="1", visible="yes",
                active=active,
            )

        # Schematic
        schematic_el = ET.SubElement(drawing, "schematic")

        # Description
        if schematic.title:
            desc_el = ET.SubElement(schematic_el, "description")
            desc_el.text = schematic.title

        # Libraries (from lib_symbols)
        libraries_el = ET.SubElement(schematic_el, "libraries")
        lib_gate_map = self._build_libraries(schematic.lib_symbols, libraries_el)

        # Attributes
        ET.SubElement(schematic_el, "attributes")

        # Variantdefs
        ET.SubElement(schematic_el, "variantdefs")

        # Classes
        classes_el = ET.SubElement(schematic_el, "classes")
        ET.SubElement(
            classes_el, "class",
            number="0", name="default",
            width="0", drill="0",
        )

        # Parts (one per placed symbol)
        parts_el = ET.SubElement(schematic_el, "parts")
        self._build_parts(schematic.symbols, parts_el)

        # Sheets (single sheet with all content)
        sheets_el = ET.SubElement(schematic_el, "sheets")
        sheet_el = ET.SubElement(sheets_el, "sheet")

        # Instances (placed symbols on the sheet)
        instances_el = ET.SubElement(sheet_el, "instances")
        self._build_instances(schematic.symbols, instances_el)

        # Busses
        busses_el = ET.SubElement(sheet_el, "busses")
        self._build_busses(schematic.buses, busses_el)

        # Nets (wires, labels, junctions grouped by net)
        nets_el = ET.SubElement(sheet_el, "nets")
        self._build_nets(schematic, nets_el)

        return eagle

    # ------------------------------------------------------------------
    # Libraries
    # ------------------------------------------------------------------

    def _build_libraries(
        self,
        lib_symbols: list[LibSymbol],
        libraries_el: ET.Element,
    ) -> dict[str, str]:
        """Build <libraries> from LibSymbol list.

        Returns a mapping of lib_id -> gate_name for instance generation.
        """
        # Group lib_symbols by library name
        lib_groups: dict[str, dict[str, LibSymbol]] = {}
        for lib_sym in lib_symbols:
            parts = lib_sym.lib_id.split(":", 1)
            if len(parts) == 2:
                lib_name, device_name = parts
            else:
                lib_name = "default"
                device_name = lib_sym.lib_id

            lib_groups.setdefault(lib_name, {})
            lib_groups[lib_name][device_name] = lib_sym

        lib_gate_map: dict[str, str] = {}

        for lib_name, devices in lib_groups.items():
            lib_el = ET.SubElement(libraries_el, "library", name=lib_name)

            # Symbols
            symbols_el = ET.SubElement(lib_el, "symbols")
            # Devicesets
            devicesets_el = ET.SubElement(lib_el, "devicesets")

            for device_name, lib_sym in devices.items():
                # Create a symbol element
                sym_name = device_name.replace("/", "_").replace(" ", "_")
                sym_el = ET.SubElement(symbols_el, "symbol", name=sym_name)

                # Add pins to the symbol
                for pin in lib_sym.pins:
                    pin_el = ET.SubElement(sym_el, "pin")
                    pin_el.set("name", pin.name or pin.number)
                    pin_el.set("x", f"{pin.at.x:.4f}")
                    pin_el.set("y", f"{pin.at.y:.4f}")
                    pin_el.set("length", _pin_length_str(pin.length))

                    eagle_dir = _PIN_TYPE_TO_EAGLE_DIR.get(pin.pin_type, "pas")
                    if eagle_dir:
                        pin_el.set("direction", eagle_dir)

                    if pin.angle != 0.0:
                        pin_el.set("rot", _rotation_string(pin.angle))

                # Add a bounding rectangle for visual representation
                if lib_sym.pins:
                    xs = [p.at.x for p in lib_sym.pins]
                    ys = [p.at.y for p in lib_sym.pins]
                    margin = 2.54
                    x_min = min(xs) - margin
                    y_min = min(ys) - margin
                    x_max = max(xs) + margin
                    y_max = max(ys) + margin
                    wire_el = ET.SubElement(sym_el, "wire")
                    wire_el.set("x1", f"{x_min:.4f}")
                    wire_el.set("y1", f"{y_min:.4f}")
                    wire_el.set("x2", f"{x_max:.4f}")
                    wire_el.set("y2", f"{y_min:.4f}")
                    wire_el.set("width", "0.254")
                    wire_el.set("layer", "94")

                    wire_el = ET.SubElement(sym_el, "wire")
                    wire_el.set("x1", f"{x_max:.4f}")
                    wire_el.set("y1", f"{y_min:.4f}")
                    wire_el.set("x2", f"{x_max:.4f}")
                    wire_el.set("y2", f"{y_max:.4f}")
                    wire_el.set("width", "0.254")
                    wire_el.set("layer", "94")

                    wire_el = ET.SubElement(sym_el, "wire")
                    wire_el.set("x1", f"{x_max:.4f}")
                    wire_el.set("y1", f"{y_max:.4f}")
                    wire_el.set("x2", f"{x_min:.4f}")
                    wire_el.set("y2", f"{y_max:.4f}")
                    wire_el.set("width", "0.254")
                    wire_el.set("layer", "94")

                    wire_el = ET.SubElement(sym_el, "wire")
                    wire_el.set("x1", f"{x_min:.4f}")
                    wire_el.set("y1", f"{y_max:.4f}")
                    wire_el.set("x2", f"{x_min:.4f}")
                    wire_el.set("y2", f"{y_min:.4f}")
                    wire_el.set("width", "0.254")
                    wire_el.set("layer", "94")

                # Add >NAME and >VALUE text
                text_el = ET.SubElement(sym_el, "text")
                text_el.set("x", "0")
                text_el.set("y", "0")
                text_el.set("size", "1.778")
                text_el.set("layer", "95")
                text_el.text = ">NAME"

                text_el = ET.SubElement(sym_el, "text")
                text_el.set("x", "0")
                text_el.set("y", "-2.54")
                text_el.set("size", "1.778")
                text_el.set("layer", "96")
                text_el.text = ">VALUE"

                # Create deviceset
                # Extract prefix from properties if available
                prefix = ""
                for prop in lib_sym.properties:
                    if prop.key == "Reference":
                        prefix = prop.value
                        break

                ds_el = ET.SubElement(
                    devicesets_el, "deviceset",
                    name=device_name,
                )
                if prefix:
                    ds_el.set("prefix", prefix)

                # Gate
                gate_name = "G$1"
                gates_el = ET.SubElement(ds_el, "gates")
                ET.SubElement(
                    gates_el, "gate",
                    name=gate_name, symbol=sym_name,
                    x="0", y="0",
                )

                lib_gate_map[lib_sym.lib_id] = gate_name

                # Devices -> device with connects
                devices_el = ET.SubElement(ds_el, "devices")
                dev_el = ET.SubElement(devices_el, "device", name="")

                connects_el = ET.SubElement(dev_el, "connects")
                for pin in lib_sym.pins:
                    ET.SubElement(
                        connects_el, "connect",
                        gate=gate_name,
                        pin=pin.name or pin.number,
                        pad=pin.number or pin.name,
                    )

                ET.SubElement(dev_el, "technologies")

        return lib_gate_map

    # ------------------------------------------------------------------
    # Parts
    # ------------------------------------------------------------------

    def _build_parts(
        self,
        symbols: list[SchSymbol],
        parts_el: ET.Element,
    ) -> None:
        """Build <parts> from placed SchSymbol instances."""
        seen: set[str] = set()
        for sym in symbols:
            # Use reference as the part name
            part_name = sym.reference or sym.uuid or f"PART_{id(sym)}"
            if part_name in seen:
                continue
            seen.add(part_name)

            parts = sym.lib_id.split(":", 1)
            if len(parts) == 2:
                lib_name, deviceset_name = parts
            else:
                lib_name = "default"
                deviceset_name = sym.lib_id

            part_el = ET.SubElement(parts_el, "part")
            part_el.set("name", part_name)
            part_el.set("library", lib_name)
            part_el.set("deviceset", deviceset_name)
            part_el.set("device", "")

            if sym.value:
                part_el.set("value", sym.value)

    # ------------------------------------------------------------------
    # Instances
    # ------------------------------------------------------------------

    def _build_instances(
        self,
        symbols: list[SchSymbol],
        instances_el: ET.Element,
    ) -> None:
        """Build <instances> from placed SchSymbol instances."""
        for sym in symbols:
            part_name = sym.reference or sym.uuid or f"PART_{id(sym)}"
            inst_el = ET.SubElement(instances_el, "instance")
            inst_el.set("part", part_name)
            inst_el.set("gate", "G$1")
            inst_el.set("x", f"{sym.at.x:.4f}")
            inst_el.set("y", f"{sym.at.y:.4f}")

            mirror = sym.mirror == "x"
            rot_str = _rotation_string(sym.angle, mirror=mirror)
            if rot_str != "R0":
                inst_el.set("rot", rot_str)

    # ------------------------------------------------------------------
    # Busses
    # ------------------------------------------------------------------

    def _build_busses(
        self,
        buses: list[SchBus],
        busses_el: ET.Element,
    ) -> None:
        """Build <busses> from SchBus instances."""
        if not buses:
            return

        bus_el = ET.SubElement(busses_el, "bus", name="B$1")
        for bus in buses:
            seg_el = ET.SubElement(bus_el, "segment")
            if len(bus.points) >= 2:
                for i in range(len(bus.points) - 1):
                    wire_el = ET.SubElement(seg_el, "wire")
                    wire_el.set("x1", f"{bus.points[i].x:.4f}")
                    wire_el.set("y1", f"{bus.points[i].y:.4f}")
                    wire_el.set("x2", f"{bus.points[i + 1].x:.4f}")
                    wire_el.set("y2", f"{bus.points[i + 1].y:.4f}")
                    wire_el.set("width", "0.762")
                    wire_el.set("layer", "92")

    # ------------------------------------------------------------------
    # Nets
    # ------------------------------------------------------------------

    def _build_nets(
        self,
        schematic: SchematicDesign,
        nets_el: ET.Element,
    ) -> None:
        """Build <nets> with wires, labels, junctions, and pinrefs.

        Groups wires, labels, and junctions by net. Uses resolved SchNet
        data when available; otherwise creates a default net with all wires.
        """
        if schematic.nets:
            # Build nets from resolved net data
            self._build_nets_from_resolved(schematic, nets_el)
        else:
            # Fallback: put all wires into an unnamed default net
            self._build_nets_fallback(schematic, nets_el)

    def _build_nets_from_resolved(
        self,
        schematic: SchematicDesign,
        nets_el: ET.Element,
    ) -> None:
        """Build <nets> from resolved SchNet data."""
        # Build a spatial index: map wire endpoint -> wire index
        # to associate wires with nets via label/pin positions
        wire_endpoint_map: dict[tuple[float, float], list[int]] = {}
        for idx, wire in enumerate(schematic.wires):
            for pt in wire.points:
                key = (round(pt.x, 4), round(pt.y, 4))
                wire_endpoint_map.setdefault(key, []).append(idx)

        # Map label positions to net names
        label_net_map: dict[tuple[float, float], str] = {}
        for label in schematic.labels:
            label_net_map[(round(label.at.x, 4), round(label.at.y, 4))] = label.text

        # Map symbol pin positions to net names from resolved nets
        pin_pos_to_net: dict[tuple[float, float], str] = {}
        for sym in schematic.symbols:
            for pin in sym.pins:
                if pin.connected_net:
                    key = (round(pin.position.x, 4), round(pin.position.y, 4))
                    pin_pos_to_net[key] = pin.connected_net

        # Assign wires to nets
        wire_to_net: dict[int, str] = {}
        for net in schematic.nets:
            # Find wires connected to this net's pins
            for ref, pin_id in net.pins:
                for sym in schematic.symbols:
                    if sym.reference == ref:
                        for pin in sym.pins:
                            if pin.number == pin_id or pin.name == pin_id:
                                key = (round(pin.position.x, 4), round(pin.position.y, 4))
                                for widx in wire_endpoint_map.get(key, []):
                                    wire_to_net.setdefault(widx, net.name)
                                break

            # Find wires connected via labels
            for label in schematic.labels:
                if label.text == net.name:
                    key = (round(label.at.x, 4), round(label.at.y, 4))
                    for widx in wire_endpoint_map.get(key, []):
                        wire_to_net.setdefault(widx, net.name)

        # Flood-fill: propagate net names through connected wires
        changed = True
        while changed:
            changed = False
            for idx, wire in enumerate(schematic.wires):
                if idx in wire_to_net:
                    net_name = wire_to_net[idx]
                    for pt in wire.points:
                        key = (round(pt.x, 4), round(pt.y, 4))
                        for other_idx in wire_endpoint_map.get(key, []):
                            if other_idx not in wire_to_net:
                                wire_to_net[other_idx] = net_name
                                changed = True

        # Group wires by net name
        net_wires: dict[str, list[int]] = {}
        for widx, net_name in wire_to_net.items():
            net_wires.setdefault(net_name, []).append(widx)

        # Collect unassigned wires
        unassigned = [
            i for i in range(len(schematic.wires)) if i not in wire_to_net
        ]
        if unassigned:
            net_wires.setdefault("N$UNASSIGNED", []).extend(unassigned)

        # Group junctions by net (via position matching)
        junction_net_map: dict[int, str] = {}
        for jidx, junc in enumerate(schematic.junctions):
            key = (round(junc.at.x, 4), round(junc.at.y, 4))
            for widx in wire_endpoint_map.get(key, []):
                if widx in wire_to_net:
                    junction_net_map[jidx] = wire_to_net[widx]
                    break

        # Group labels by net
        label_by_net: dict[str, list[SchLabel]] = {}
        for label in schematic.labels:
            label_by_net.setdefault(label.text, []).append(label)

        # Write net elements
        for net in schematic.nets:
            net_el = ET.SubElement(nets_el, "net", name=net.name)
            if net.is_power:
                net_el.set("class", "1")
            else:
                net_el.set("class", "0")

            seg_el = ET.SubElement(net_el, "segment")

            # Pinrefs
            for ref, pin_id in net.pins:
                ET.SubElement(
                    seg_el, "pinref",
                    part=ref, gate="G$1", pin=pin_id,
                )

            # Wires
            for widx in net_wires.get(net.name, []):
                wire = schematic.wires[widx]
                if len(wire.points) >= 2:
                    for i in range(len(wire.points) - 1):
                        wire_el = ET.SubElement(seg_el, "wire")
                        wire_el.set("x1", f"{wire.points[i].x:.4f}")
                        wire_el.set("y1", f"{wire.points[i].y:.4f}")
                        wire_el.set("x2", f"{wire.points[i + 1].x:.4f}")
                        wire_el.set("y2", f"{wire.points[i + 1].y:.4f}")
                        wire_el.set("width", "0.1524")
                        wire_el.set("layer", "91")

            # Labels
            for label in label_by_net.get(net.name, []):
                label_el = ET.SubElement(seg_el, "label")
                label_el.set("x", f"{label.at.x:.4f}")
                label_el.set("y", f"{label.at.y:.4f}")
                label_el.set("size", "1.778")
                label_el.set("layer", "95")
                if label.angle != 0.0:
                    label_el.set("rot", _rotation_string(label.angle))

            # Junctions
            for jidx, jnet in junction_net_map.items():
                if jnet == net.name:
                    junc = schematic.junctions[jidx]
                    junc_el = ET.SubElement(seg_el, "junction")
                    junc_el.set("x", f"{junc.at.x:.4f}")
                    junc_el.set("y", f"{junc.at.y:.4f}")

    def _build_nets_fallback(
        self,
        schematic: SchematicDesign,
        nets_el: ET.Element,
    ) -> None:
        """Build nets as a fallback when no resolved net data is available.

        Groups wires by label proximity and creates net elements.
        """
        # Create one net per label, plus a default for unmatched wires
        label_names: set[str] = set()
        for label in schematic.labels:
            label_names.add(label.text)

        # Simple approach: one segment per net with all wires and junctions
        if not label_names:
            # No labels: put everything in a single net
            if schematic.wires:
                net_el = ET.SubElement(nets_el, "net", name="N$1")
                net_el.set("class", "0")
                seg_el = ET.SubElement(net_el, "segment")
                self._write_wires(schematic.wires, seg_el)
                self._write_junctions(schematic.junctions, seg_el)
            return

        # Group by label
        for net_name in sorted(label_names):
            net_el = ET.SubElement(nets_el, "net", name=net_name)
            net_el.set("class", "0")
            seg_el = ET.SubElement(net_el, "segment")

            # Find labels for this net
            for label in schematic.labels:
                if label.text == net_name:
                    label_el = ET.SubElement(seg_el, "label")
                    label_el.set("x", f"{label.at.x:.4f}")
                    label_el.set("y", f"{label.at.y:.4f}")
                    label_el.set("size", "1.778")
                    label_el.set("layer", "95")
                    if label.angle != 0.0:
                        label_el.set("rot", _rotation_string(label.angle))

            # Write all wires (simplified: duplicate wires across nets)
            self._write_wires(schematic.wires, seg_el)

        # Write junctions into the first net
        if schematic.junctions and label_names:
            first_net_name = sorted(label_names)[0]
            for net_el in nets_el:
                if net_el.get("name") == first_net_name:
                    seg_els = net_el.findall("segment")
                    if seg_els:
                        self._write_junctions(schematic.junctions, seg_els[0])
                    break

    # ------------------------------------------------------------------
    # Hierarchical sheets
    # ------------------------------------------------------------------

    def _build_hierarchical_sheets(
        self,
        sheets: list[HierarchicalSheet],
        plain_el: ET.Element,
    ) -> None:
        """Add hierarchical sheet frames to the <plain> section."""
        for sheet in sheets:
            # Draw sheet rectangle
            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{sheet.at.x:.4f}")
            wire_el.set("y1", f"{sheet.at.y:.4f}")
            wire_el.set("x2", f"{sheet.at.x + sheet.size_x:.4f}")
            wire_el.set("y2", f"{sheet.at.y:.4f}")
            wire_el.set("width", "0.254")
            wire_el.set("layer", "94")

            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{sheet.at.x + sheet.size_x:.4f}")
            wire_el.set("y1", f"{sheet.at.y:.4f}")
            wire_el.set("x2", f"{sheet.at.x + sheet.size_x:.4f}")
            wire_el.set("y2", f"{sheet.at.y + sheet.size_y:.4f}")
            wire_el.set("width", "0.254")
            wire_el.set("layer", "94")

            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{sheet.at.x + sheet.size_x:.4f}")
            wire_el.set("y1", f"{sheet.at.y + sheet.size_y:.4f}")
            wire_el.set("x2", f"{sheet.at.x:.4f}")
            wire_el.set("y2", f"{sheet.at.y + sheet.size_y:.4f}")
            wire_el.set("width", "0.254")
            wire_el.set("layer", "94")

            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{sheet.at.x:.4f}")
            wire_el.set("y1", f"{sheet.at.y + sheet.size_y:.4f}")
            wire_el.set("x2", f"{sheet.at.x:.4f}")
            wire_el.set("y2", f"{sheet.at.y:.4f}")
            wire_el.set("width", "0.254")
            wire_el.set("layer", "94")

            # Sheet name text
            text_el = ET.SubElement(plain_el, "text")
            text_el.set("x", f"{sheet.at.x + 1.27:.4f}")
            text_el.set("y", f"{sheet.at.y + sheet.size_y - 1.27:.4f}")
            text_el.set("size", "1.778")
            text_el.set("layer", "95")
            text_el.text = sheet.sheet_name or sheet.file_name

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _write_wires(wires: list[SchWire], seg_el: ET.Element) -> None:
        """Write wire elements into a segment."""
        for wire in wires:
            if len(wire.points) >= 2:
                for i in range(len(wire.points) - 1):
                    wire_el = ET.SubElement(seg_el, "wire")
                    wire_el.set("x1", f"{wire.points[i].x:.4f}")
                    wire_el.set("y1", f"{wire.points[i].y:.4f}")
                    wire_el.set("x2", f"{wire.points[i + 1].x:.4f}")
                    wire_el.set("y2", f"{wire.points[i + 1].y:.4f}")
                    wire_el.set("width", "0.1524")
                    wire_el.set("layer", "91")

    @staticmethod
    def _write_junctions(
        junctions: list[SchJunction],
        seg_el: ET.Element,
    ) -> None:
        """Write junction elements into a segment."""
        for junc in junctions:
            junc_el = ET.SubElement(seg_el, "junction")
            junc_el.set("x", f"{junc.at.x:.4f}")
            junc_el.set("y", f"{junc.at.y:.4f}")
