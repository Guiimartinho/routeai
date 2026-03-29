"""Exporter for KiCad 8 .kicad_sch schematic files.

Converts a SchematicDesign model into KiCad S-expression format,
producing a valid .kicad_sch file that KiCad can open.

Exports: lib_symbols, symbols (components), wires, labels, buses,
power ports, hierarchical sheets, junctions, no-connects.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from routeai_parsers.kicad.sexpr import serialize
from routeai_parsers.models import (
    HierarchicalSheet,
    LabelType,
    LibSymbol,
    LibSymbolPin,
    Point2D,
    SchBus,
    SchJunction,
    SchLabel,
    SchNoConnect,
    SchPin,
    SchProperty,
    SchSymbol,
    SchWire,
    SchematicDesign,
)


class KiCadSchExporter:
    """Exporter that writes SchematicDesign to KiCad .kicad_sch format.

    Usage::

        exporter = KiCadSchExporter()
        exporter.export(schematic, "output.kicad_sch")
    """

    def export(self, schematic: SchematicDesign, filepath: str | Path) -> None:
        """Export a SchematicDesign to a .kicad_sch file.

        Args:
            schematic: The schematic design to export.
            filepath: Path for the output .kicad_sch file.
        """
        filepath = Path(filepath)
        text = self.export_text(schematic)
        filepath.write_text(text, encoding="utf-8")

    def export_text(self, schematic: SchematicDesign) -> str:
        """Export a SchematicDesign to a .kicad_sch string.

        Args:
            schematic: The schematic design to export.

        Returns:
            The S-expression text of the schematic.
        """
        ast = self._build_ast(schematic)
        return serialize(ast) + "\n"

    def _build_ast(self, sch: SchematicDesign) -> list[Any]:
        """Build the complete S-expression AST for a schematic."""
        root: list[Any] = ["kicad_sch"]

        # Version
        root.append(["version", sch.version if sch.version else 20231120])

        # Generator
        root.append(["generator", sch.generator if sch.generator else "routeai"])

        # Generator version
        root.append(["generator_version", "8.0"])

        # UUID
        if sch.uuid:
            root.append(["uuid", sch.uuid])

        # Paper size
        root.append(["paper", "A4"])

        # Title block
        if sch.title or sch.date or sch.revision or sch.company:
            root.append(self._build_title_block(sch))

        # Library symbols
        if sch.lib_symbols:
            root.append(self._build_lib_symbols(sch.lib_symbols))

        # Symbol instances (placed components)
        for sym in sch.symbols:
            root.append(self._build_symbol(sym))

        # Wires
        for wire in sch.wires:
            root.append(self._build_wire(wire))

        # Buses
        for bus in sch.buses:
            root.append(self._build_bus(bus))

        # Labels
        for label in sch.labels:
            root.append(self._build_label(label))

        # Junctions
        for junc in sch.junctions:
            root.append(self._build_junction(junc))

        # No-connects
        for nc in sch.no_connects:
            root.append(self._build_no_connect(nc))

        # Hierarchical sheets
        for sheet in sch.hierarchical_sheets:
            root.append(self._build_sheet(sheet))

        return root

    # ------------------------------------------------------------------
    # Title block
    # ------------------------------------------------------------------

    def _build_title_block(self, sch: SchematicDesign) -> list[Any]:
        """Build the title_block section."""
        tb: list[Any] = ["title_block"]
        if sch.title:
            tb.append(["title", sch.title])
        if sch.date:
            tb.append(["date", sch.date])
        if sch.revision:
            tb.append(["rev", sch.revision])
        if sch.company:
            tb.append(["company", sch.company])
        return tb

    # ------------------------------------------------------------------
    # Library symbols
    # ------------------------------------------------------------------

    def _build_lib_symbols(self, lib_symbols: list[LibSymbol]) -> list[Any]:
        """Build the lib_symbols section."""
        node: list[Any] = ["lib_symbols"]

        for ls in lib_symbols:
            if ls.raw is not None:
                # Preserve the raw AST for round-trip fidelity
                node.append(ls.raw)
            else:
                node.append(self._build_lib_symbol(ls))

        return node

    def _build_lib_symbol(self, ls: LibSymbol) -> list[Any]:
        """Build a library symbol definition from model data."""
        sym: list[Any] = ["symbol", ls.lib_id]

        # Properties
        for prop in ls.properties:
            sym.append(self._build_property(prop))

        # Create a sub-symbol for the pins
        sub_sym: list[Any] = ["symbol", f"{ls.lib_id}_0_1"]

        for pin in ls.pins:
            sub_sym.append(self._build_lib_pin(pin))

        sym.append(sub_sym)
        return sym

    def _build_lib_pin(self, pin: LibSymbolPin) -> list[Any]:
        """Build a pin definition within a library symbol."""
        # pin type style (at x y angle) (length l) (name "N" ...) (number "1" ...)
        pin_type = pin.pin_type if pin.pin_type else "passive"
        style = "line"  # default graphic style

        node: list[Any] = ["pin", pin_type, style]

        at_node: list[Any] = ["at", pin.at.x, pin.at.y]
        if pin.angle != 0.0:
            at_node.append(pin.angle)
        node.append(at_node)

        node.append(["length", pin.length])

        name_node: list[Any] = ["name", pin.name]
        name_node.append(["effects", ["font", ["size", 1.27, 1.27]]])
        node.append(name_node)

        number_node: list[Any] = ["number", pin.number]
        number_node.append(["effects", ["font", ["size", 1.27, 1.27]]])
        node.append(number_node)

        return node

    # ------------------------------------------------------------------
    # Symbol instances
    # ------------------------------------------------------------------

    def _build_symbol(self, sym: SchSymbol) -> list[Any]:
        """Build a placed symbol instance."""
        node: list[Any] = ["symbol"]

        # lib_id
        node.append(["lib_id", sym.lib_id])

        # Position
        at_node: list[Any] = ["at", sym.at.x, sym.at.y]
        if sym.angle != 0.0:
            at_node.append(sym.angle)
        node.append(at_node)

        # Mirror
        if sym.mirror:
            node.append(["mirror", sym.mirror])

        # Unit
        node.append(["unit", sym.unit])

        # UUID
        if sym.uuid:
            node.append(["uuid", sym.uuid])

        # Properties
        for prop in sym.properties:
            node.append(self._build_property(prop))

        # Pins
        for pin in sym.pins:
            pin_node: list[Any] = ["pin", pin.number]
            if pin.uuid:
                pin_node.append(["uuid", pin.uuid])
            node.append(pin_node)

        return node

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    def _build_property(self, prop: SchProperty) -> list[Any]:
        """Build a property node."""
        node: list[Any] = ["property", prop.key, prop.value]

        at_node: list[Any] = ["at", prop.at.x, prop.at.y]
        if prop.angle != 0.0:
            at_node.append(prop.angle)
        node.append(at_node)

        effects: list[Any] = ["effects"]
        effects.append(["font", ["size", 1.27, 1.27]])
        if prop.effects_hidden:
            effects.append(["hide", "yes"])
        node.append(effects)

        return node

    # ------------------------------------------------------------------
    # Wires
    # ------------------------------------------------------------------

    def _build_wire(self, wire: SchWire) -> list[Any]:
        """Build a wire node."""
        node: list[Any] = ["wire"]

        pts: list[Any] = ["pts"]
        for pt in wire.points:
            pts.append(["xy", pt.x, pt.y])
        node.append(pts)

        node.append(["stroke", ["width", 0], ["type", "default"]])

        if wire.uuid:
            node.append(["uuid", wire.uuid])

        return node

    # ------------------------------------------------------------------
    # Buses
    # ------------------------------------------------------------------

    def _build_bus(self, bus: SchBus) -> list[Any]:
        """Build a bus node."""
        node: list[Any] = ["bus"]

        pts: list[Any] = ["pts"]
        for pt in bus.points:
            pts.append(["xy", pt.x, pt.y])
        node.append(pts)

        node.append(["stroke", ["width", 0], ["type", "default"]])

        if bus.uuid:
            node.append(["uuid", bus.uuid])

        return node

    # ------------------------------------------------------------------
    # Labels
    # ------------------------------------------------------------------

    def _build_label(self, label: SchLabel) -> list[Any]:
        """Build a label node (local, global, hierarchical, or power)."""
        # Determine the tag based on label type
        tag_map = {
            LabelType.LOCAL: "label",
            LabelType.GLOBAL: "global_label",
            LabelType.HIERARCHICAL: "hierarchical_label",
            LabelType.POWER: "power_port",
        }
        tag = tag_map.get(label.label_type, "label")

        node: list[Any] = [tag, label.text]

        at_node: list[Any] = ["at", label.at.x, label.at.y]
        if label.angle != 0.0:
            at_node.append(label.angle)
        node.append(at_node)

        # Shape for global/hierarchical labels
        if label.shape and label.label_type in (LabelType.GLOBAL, LabelType.HIERARCHICAL):
            node.append(["shape", label.shape])

        # Effects
        node.append(["effects", ["font", ["size", 1.27, 1.27]]])

        if label.uuid:
            node.append(["uuid", label.uuid])

        return node

    # ------------------------------------------------------------------
    # Junctions
    # ------------------------------------------------------------------

    def _build_junction(self, junc: SchJunction) -> list[Any]:
        """Build a junction node."""
        node: list[Any] = [
            "junction",
            ["at", junc.at.x, junc.at.y],
        ]
        if junc.diameter > 0:
            node.append(["diameter", junc.diameter])
        if junc.uuid:
            node.append(["uuid", junc.uuid])
        return node

    # ------------------------------------------------------------------
    # No-connects
    # ------------------------------------------------------------------

    def _build_no_connect(self, nc: SchNoConnect) -> list[Any]:
        """Build a no_connect node."""
        node: list[Any] = [
            "no_connect",
            ["at", nc.at.x, nc.at.y],
        ]
        if nc.uuid:
            node.append(["uuid", nc.uuid])
        return node

    # ------------------------------------------------------------------
    # Hierarchical sheets
    # ------------------------------------------------------------------

    def _build_sheet(self, sheet: HierarchicalSheet) -> list[Any]:
        """Build a hierarchical sheet node."""
        node: list[Any] = ["sheet"]

        node.append(["at", sheet.at.x, sheet.at.y])
        node.append(["size", sheet.size_x, sheet.size_y])

        if sheet.uuid:
            node.append(["uuid", sheet.uuid])

        # Properties
        if sheet.sheet_name:
            node.append(["property", "Sheetname", sheet.sheet_name,
                         ["at", sheet.at.x, sheet.at.y - 1],
                         ["effects", ["font", ["size", 1.27, 1.27]]]])
        if sheet.file_name:
            node.append(["property", "Sheetfile", sheet.file_name,
                         ["at", sheet.at.x, sheet.at.y + sheet.size_y + 1],
                         ["effects", ["font", ["size", 1.27, 1.27]]]])

        for prop in sheet.properties:
            if prop.key not in ("Sheetname", "Sheet name", "Sheetfile", "Sheet file"):
                node.append(self._build_property(prop))

        # Pins
        for pin in sheet.pins:
            pin_node: list[Any] = ["pin", pin.name]
            pin_node.append(["at", pin.position.x, pin.position.y])
            if pin.uuid:
                pin_node.append(["uuid", pin.uuid])
            node.append(pin_node)

        return node
