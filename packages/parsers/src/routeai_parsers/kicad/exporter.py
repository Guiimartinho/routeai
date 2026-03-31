"""Exporter for KiCad 8 .kicad_pcb board files.

Converts a BoardDesign model back into the KiCad S-expression format,
producing a valid .kicad_pcb file that KiCad can open. Preserves formatting
conventions including indentation style.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from routeai_parsers.kicad.sexpr import serialize
from routeai_parsers.models import (
    Arc,
    BoardDesign,
    Footprint,
    FpArc,
    FpCircle,
    FpLine,
    FpPoly,
    FpText,
    GrArc,
    GrCircle,
    GrLine,
    GrRect,
    Model3D,
    NetClass,
    Pad,
    PadShape,
    Segment,
    Via,
    Zone,
    ZoneFillType,
    ZonePolygon,
)


class KiCadPcbExporter:
    """Exporter that writes BoardDesign to KiCad .kicad_pcb format.

    Usage::

        exporter = KiCadPcbExporter()
        exporter.export(board, "output.kicad_pcb")
    """

    def export(self, board: BoardDesign, filepath: str | Path) -> None:
        """Export a BoardDesign to a .kicad_pcb file.

        Args:
            board: The board design to export.
            filepath: Path for the output .kicad_pcb file.
        """
        filepath = Path(filepath)
        text = self.export_text(board)
        filepath.write_text(text, encoding="utf-8")

    def export_text(self, board: BoardDesign) -> str:
        """Export a BoardDesign to a .kicad_pcb string.

        Args:
            board: The board design to export.

        Returns:
            The S-expression text of the board.
        """
        ast = self._build_ast(board)
        return serialize(ast) + "\n"

    def _build_ast(self, board: BoardDesign) -> list[Any]:
        """Build the complete S-expression AST for a board."""
        root: list[Any] = ["kicad_pcb"]

        # Version
        root.append(["version", board.version])

        # Generator
        root.append(["generator", board.generator])

        # General
        general: list[Any] = ["general", ["thickness", board.thickness]]
        root.append(general)

        # Layers
        root.append(self._build_layers(board))

        # Setup - use raw if available for round-trip fidelity
        if board.setup_raw:
            root.append(board.setup_raw)
        else:
            root.append(self._build_setup(board))

        # Nets
        for net in board.nets:
            root.append(["net", net.number, net.name])

        # Footprints
        for fp in board.footprints:
            root.append(self._build_footprint(fp))

        # Segments
        for seg in board.segments:
            root.append(self._build_segment(seg))

        # Arcs
        for arc in board.arcs:
            root.append(self._build_arc(arc))

        # Vias
        for via in board.vias:
            root.append(self._build_via(via))

        # Zones
        for zone in board.zones:
            root.append(self._build_zone(zone))

        # Graphical items
        for gr_line in board.gr_lines:
            root.append(self._build_gr_line(gr_line))

        for gr_arc in board.gr_arcs:
            root.append(self._build_gr_arc(gr_arc))

        for gr_circle in board.gr_circles:
            root.append(self._build_gr_circle(gr_circle))

        for gr_rect in board.gr_rects:
            root.append(self._build_gr_rect(gr_rect))

        return root

    # ------------------------------------------------------------------
    # Builders for each section
    # ------------------------------------------------------------------

    def _build_layers(self, board: BoardDesign) -> list[Any]:
        """Build the layers section."""
        layers_node: list[Any] = ["layers"]
        for layer in board.layers:
            entry: list[Any] = [layer.ordinal, layer.name, layer.layer_type]
            if layer.user_name:
                entry.append(layer.user_name)
            layers_node.append(entry)
        return layers_node

    def _build_setup(self, board: BoardDesign) -> list[Any]:
        """Build a minimal setup section from design rules."""
        setup: list[Any] = ["setup"]

        rules = board.design_rules
        if rules.copper_edge_clearance > 0:
            setup.append(["copper_edge_clearance", rules.copper_edge_clearance])

        if rules.allow_blind_buried_vias:
            setup.append(["allow_blind_buried_vias", "yes"])

        if rules.allow_micro_vias:
            setup.append(["allow_micro_vias", "yes"])

        # Net classes
        for nc in board.net_classes:
            setup.append(self._build_net_class(nc))

        return setup

    def _build_net_class(self, nc: NetClass) -> list[Any]:
        """Build a net_class node."""
        node: list[Any] = ["net_class", nc.name]
        if nc.description:
            node.append(["description", nc.description])
        node.append(["clearance", nc.clearance])
        node.append(["trace_width", nc.trace_width])
        node.append(["via_dia", nc.via_diameter])
        node.append(["via_drill", nc.via_drill])
        node.append(["uvia_dia", nc.uvia_diameter])
        node.append(["uvia_drill", nc.uvia_drill])
        node.append(["diff_pair_width", nc.diff_pair_width])
        node.append(["diff_pair_gap", nc.diff_pair_gap])
        for net_name in nc.nets:
            node.append(["add_net", net_name])
        return node

    def _build_footprint(self, fp: Footprint) -> list[Any]:
        """Build a footprint node."""
        node: list[Any] = ["footprint", fp.library_link]

        if fp.locked:
            node.append("locked")

        # Layer
        node.append(["layer", fp.layer])

        # UUID
        if fp.uuid:
            node.append(["uuid", fp.uuid])

        # Position
        at_node: list[Any] = ["at", fp.at.x, fp.at.y]
        if fp.angle != 0.0:
            at_node.append(fp.angle)
        node.append(at_node)

        # Properties (KiCad 8 style)
        if fp.reference:
            node.append(["property", "Reference", fp.reference])
        if fp.value:
            node.append(["property", "Value", fp.value])
        for key, value in fp.properties.items():
            if key not in ("Reference", "Value"):
                node.append(["property", key, value])

        # Text items
        for text in fp.texts:
            node.append(self._build_fp_text(text))

        # Lines
        for line in fp.lines:
            node.append(self._build_fp_line(line))

        # Circles
        for circle in fp.circles:
            node.append(self._build_fp_circle(circle))

        # Arcs
        for arc in fp.arcs:
            node.append(self._build_fp_arc(arc))

        # Polygons
        for poly in fp.polygons:
            node.append(self._build_fp_poly(poly))

        # Pads
        for pad in fp.pads:
            node.append(self._build_pad(pad))

        # 3D Model
        if fp.model:
            node.append(self._build_model(fp.model))

        return node

    def _build_pad(self, pad: Pad) -> list[Any]:
        """Build a pad node."""
        node: list[Any] = ["pad", pad.number, pad.pad_type.value, pad.shape.value]

        # Position
        at_node: list[Any] = ["at", pad.at.x, pad.at.y]
        if pad.angle != 0.0:
            at_node.append(pad.angle)
        node.append(at_node)

        # Size
        node.append(["size", pad.size_x, pad.size_y])

        # Drill
        if pad.drill > 0:
            if pad.drill_oval_x > 0 and pad.drill_oval_y > 0:
                node.append(["drill", "oval", pad.drill_oval_x, pad.drill_oval_y])
            else:
                node.append(["drill", pad.drill])

        # Layers
        if pad.layers:
            node.append(["layers"] + pad.layers)

        # Roundrect ratio
        if pad.shape == PadShape.ROUNDRECT:
            node.append(["roundrect_rratio", pad.roundrect_rratio])

        # Net
        if pad.net_number > 0 or pad.net_name:
            node.append(["net", pad.net_number, pad.net_name])

        # Optional margins
        if pad.solder_mask_margin is not None:
            node.append(["solder_mask_margin", pad.solder_mask_margin])
        if pad.solder_paste_margin is not None:
            node.append(["solder_paste_margin", pad.solder_paste_margin])
        if pad.clearance is not None:
            node.append(["clearance", pad.clearance])

        return node

    def _build_fp_text(self, text: FpText) -> list[Any]:
        """Build a fp_text node."""
        node: list[Any] = ["fp_text", text.text_type, text.text]

        at_node: list[Any] = ["at", text.at.x, text.at.y]
        if text.angle != 0.0:
            at_node.append(text.angle)
        node.append(at_node)

        node.append(["layer", text.layer])

        if text.hidden:
            node.append("hide")

        # Effects with font
        effects: list[Any] = ["effects"]
        font: list[Any] = [
            "font",
            ["size", text.font_size_x, text.font_size_y],
            ["thickness", text.font_thickness],
        ]
        effects.append(font)
        node.append(effects)

        return node

    def _build_fp_line(self, line: FpLine) -> list[Any]:
        """Build a fp_line node."""
        node: list[Any] = [
            "fp_line",
            ["start", line.start.x, line.start.y],
            ["end", line.end.x, line.end.y],
        ]
        if line.stroke_width > 0:
            node.append(["stroke", ["width", line.stroke_width], ["type", "solid"]])
        elif line.width > 0:
            node.append(["width", line.width])
        node.append(["layer", line.layer])
        return node

    def _build_fp_circle(self, circle: FpCircle) -> list[Any]:
        """Build a fp_circle node."""
        node: list[Any] = [
            "fp_circle",
            ["center", circle.center.x, circle.center.y],
            ["end", circle.end.x, circle.end.y],
        ]
        if circle.stroke_width > 0:
            node.append(["stroke", ["width", circle.stroke_width], ["type", "solid"]])
        elif circle.width > 0:
            node.append(["width", circle.width])
        node.append(["layer", circle.layer])
        return node

    def _build_fp_arc(self, arc: FpArc) -> list[Any]:
        """Build a fp_arc node."""
        node: list[Any] = [
            "fp_arc",
            ["start", arc.start.x, arc.start.y],
            ["mid", arc.mid.x, arc.mid.y],
            ["end", arc.end.x, arc.end.y],
        ]
        if arc.stroke_width > 0:
            node.append(["stroke", ["width", arc.stroke_width], ["type", "solid"]])
        elif arc.width > 0:
            node.append(["width", arc.width])
        node.append(["layer", arc.layer])
        return node

    def _build_fp_poly(self, poly: FpPoly) -> list[Any]:
        """Build a fp_poly node."""
        pts: list[Any] = ["pts"] + [["xy", p.x, p.y] for p in poly.points]
        node: list[Any] = ["fp_poly", pts]
        if poly.stroke_width > 0:
            node.append(["stroke", ["width", poly.stroke_width], ["type", "solid"]])
        elif poly.width > 0:
            node.append(["width", poly.width])
        node.append(["layer", poly.layer])
        return node

    def _build_model(self, model: Model3D) -> list[Any]:
        """Build a 3D model node."""
        node: list[Any] = ["model", model.path]
        node.append(["offset", ["xyz", model.offset.x, model.offset.y, model.offset.z]])
        node.append(["scale", ["xyz", model.scale.x, model.scale.y, model.scale.z]])
        node.append(["rotate", ["xyz", model.rotate.x, model.rotate.y, model.rotate.z]])
        return node

    # ------------------------------------------------------------------
    # Traces, vias, zones
    # ------------------------------------------------------------------

    def _build_segment(self, seg: Segment) -> list[Any]:
        """Build a segment (trace) node."""
        node: list[Any] = [
            "segment",
            ["start", seg.start.x, seg.start.y],
            ["end", seg.end.x, seg.end.y],
            ["width", seg.width],
            ["layer", seg.layer],
            ["net", seg.net],
        ]
        if seg.uuid:
            node.append(["uuid", seg.uuid])
        return node

    def _build_arc(self, arc: Arc) -> list[Any]:
        """Build an arc trace node."""
        node: list[Any] = [
            "arc",
            ["start", arc.start.x, arc.start.y],
            ["mid", arc.mid.x, arc.mid.y],
            ["end", arc.end.x, arc.end.y],
            ["width", arc.width],
            ["layer", arc.layer],
            ["net", arc.net],
        ]
        if arc.uuid:
            node.append(["uuid", arc.uuid])
        return node

    def _build_via(self, via: Via) -> list[Any]:
        """Build a via node."""
        node: list[Any] = ["via"]

        if via.via_type:
            node.append(via.via_type)

        node.append(["at", via.at.x, via.at.y])
        node.append(["size", via.size])
        node.append(["drill", via.drill])
        if via.layers:
            node.append(["layers"] + via.layers)
        node.append(["net", via.net])
        if via.uuid:
            node.append(["uuid", via.uuid])
        return node

    def _build_zone(self, zone: Zone) -> list[Any]:
        """Build a zone node."""
        node: list[Any] = ["zone"]

        node.append(["net", zone.net])
        node.append(["net_name", zone.net_name])

        if zone.layer:
            node.append(["layer", zone.layer])
        if zone.layers:
            node.append(["layers"] + zone.layers)

        if zone.uuid:
            node.append(["uuid", zone.uuid])
        if zone.name:
            node.append(["name", zone.name])
        if zone.priority > 0:
            node.append(["priority", zone.priority])

        # Connect pads
        cp_node: list[Any] = ["connect_pads"]
        if zone.connect_pads not in ("yes", ""):
            cp_node.append(zone.connect_pads)
        if zone.connect_pads_clearance > 0:
            cp_node.append(["clearance", zone.connect_pads_clearance])
        if len(cp_node) > 1:
            node.append(cp_node)

        # Min thickness
        if zone.min_thickness > 0:
            node.append(["min_thickness", zone.min_thickness])

        # Fill
        fill_node: list[Any] = ["fill"]
        if zone.fill.filled:
            fill_node.append("yes")
        else:
            fill_node.append("no")

        fill_node.append(["thermal_gap", zone.fill.thermal_gap])
        fill_node.append(["thermal_bridge_width", zone.fill.thermal_bridge_width])

        if zone.fill.fill_type == ZoneFillType.HATCHED:
            fill_node.append(["hatch_thickness", zone.fill.hatch_thickness])
            fill_node.append(["hatch_gap", zone.fill.hatch_gap])
            fill_node.append(["hatch_orientation", zone.fill.hatch_orientation])

        if zone.fill.smoothing:
            fill_node.append(["smoothing", zone.fill.smoothing])
        if zone.fill.smoothing_radius > 0:
            fill_node.append(["radius", zone.fill.smoothing_radius])
        if zone.fill.island_removal_mode > 0:
            fill_node.append(["island_removal_mode", zone.fill.island_removal_mode])
        if zone.fill.island_area_min > 0:
            fill_node.append(["island_area_min", zone.fill.island_area_min])

        node.append(fill_node)

        # Keepout
        if any([zone.keepout_tracks, zone.keepout_vias, zone.keepout_pads,
                zone.keepout_copperpour, zone.keepout_footprints]):
            keepout: list[Any] = ["keepout"]
            if zone.keepout_tracks:
                keepout.append(["tracks", zone.keepout_tracks])
            if zone.keepout_vias:
                keepout.append(["vias", zone.keepout_vias])
            if zone.keepout_pads:
                keepout.append(["pads", zone.keepout_pads])
            if zone.keepout_copperpour:
                keepout.append(["copperpour", zone.keepout_copperpour])
            if zone.keepout_footprints:
                keepout.append(["footprints", zone.keepout_footprints])
            node.append(keepout)

        # Polygons
        for poly in zone.polygons:
            node.append(self._build_zone_polygon("polygon", poly))

        for fill_poly in zone.fill_polygons:
            node.append(self._build_zone_polygon("filled_polygon", fill_poly))

        return node

    def _build_zone_polygon(self, tag: str, poly: ZonePolygon) -> list[Any]:
        """Build a zone polygon/filled_polygon node."""
        pts: list[Any] = ["pts"] + [["xy", p.x, p.y] for p in poly.points]
        return [tag, pts]

    # ------------------------------------------------------------------
    # Graphical items
    # ------------------------------------------------------------------

    def _build_gr_line(self, line: GrLine) -> list[Any]:
        """Build a gr_line node."""
        node: list[Any] = [
            "gr_line",
            ["start", line.start.x, line.start.y],
            ["end", line.end.x, line.end.y],
        ]
        if line.stroke_width > 0:
            node.append(["stroke", ["width", line.stroke_width], ["type", "solid"]])
        elif line.width > 0:
            node.append(["width", line.width])
        node.append(["layer", line.layer])
        if line.uuid:
            node.append(["uuid", line.uuid])
        return node

    def _build_gr_arc(self, arc: GrArc) -> list[Any]:
        """Build a gr_arc node."""
        node: list[Any] = [
            "gr_arc",
            ["start", arc.start.x, arc.start.y],
            ["mid", arc.mid.x, arc.mid.y],
            ["end", arc.end.x, arc.end.y],
        ]
        if arc.stroke_width > 0:
            node.append(["stroke", ["width", arc.stroke_width], ["type", "solid"]])
        elif arc.width > 0:
            node.append(["width", arc.width])
        node.append(["layer", arc.layer])
        if arc.uuid:
            node.append(["uuid", arc.uuid])
        return node

    def _build_gr_circle(self, circle: GrCircle) -> list[Any]:
        """Build a gr_circle node."""
        node: list[Any] = [
            "gr_circle",
            ["center", circle.center.x, circle.center.y],
            ["end", circle.end.x, circle.end.y],
        ]
        if circle.stroke_width > 0:
            node.append(["stroke", ["width", circle.stroke_width], ["type", "solid"]])
        elif circle.width > 0:
            node.append(["width", circle.width])
        node.append(["layer", circle.layer])
        if circle.uuid:
            node.append(["uuid", circle.uuid])
        return node

    def _build_gr_rect(self, rect: GrRect) -> list[Any]:
        """Build a gr_rect node."""
        node: list[Any] = [
            "gr_rect",
            ["start", rect.start.x, rect.start.y],
            ["end", rect.end.x, rect.end.y],
        ]
        if rect.stroke_width > 0:
            node.append(["stroke", ["width", rect.stroke_width], ["type", "solid"]])
        elif rect.width > 0:
            node.append(["width", rect.width])
        node.append(["layer", rect.layer])
        if rect.uuid:
            node.append(["uuid", rect.uuid])
        return node
