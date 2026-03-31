"""Exporter for Autodesk Eagle .brd board files.

Converts a BoardDesign model into valid Eagle XML .brd format.
Generates the complete XML structure including layers, libraries,
elements, signals, and board outline.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.dom import minidom

from routeai_parsers.models import (
    Arc,
    BoardDesign,
    Footprint,
    PadShape,
    PadType,
    Segment,
    Via,
    Zone,
)

# ---------------------------------------------------------------------------
# KiCad layer name -> Eagle layer number mapping (reverse of parser)
# ---------------------------------------------------------------------------

KICAD_TO_EAGLE_LAYER: dict[str, int] = {
    "F.Cu": 1,
    "In1.Cu": 2,
    "In2.Cu": 3,
    "In3.Cu": 4,
    "In4.Cu": 5,
    "In5.Cu": 6,
    "In6.Cu": 7,
    "B.Cu": 16,
    "Edge.Cuts": 20,
    "F.SilkS": 21,
    "B.SilkS": 22,
    "F.Fab": 25,
    "B.Fab": 26,
    "F.Mask": 29,
    "B.Mask": 30,
    "F.Paste": 31,
    "B.Paste": 32,
    "F.CrtYd": 39,
    "B.CrtYd": 40,
}

# Default Eagle layer definitions
DEFAULT_EAGLE_LAYERS: list[tuple[int, str, str, str]] = [
    (1, "Top", "signal", "active"),
    (2, "Route2", "signal", "active"),
    (3, "Route3", "signal", "active"),
    (4, "Route4", "signal", "active"),
    (5, "Route5", "signal", "active"),
    (6, "Route6", "signal", "active"),
    (7, "Route7", "signal", "active"),
    (8, "Route8", "signal", "active"),
    (9, "Route9", "signal", "active"),
    (10, "Route10", "signal", "active"),
    (11, "Route11", "signal", "active"),
    (12, "Route12", "signal", "active"),
    (13, "Route13", "signal", "active"),
    (14, "Route14", "signal", "active"),
    (15, "Route15", "signal", "active"),
    (16, "Bottom", "signal", "active"),
    (17, "Pads", "all", "active"),
    (18, "Vias", "all", "active"),
    (19, "Unrouted", "all", "active"),
    (20, "Dimension", "board", "active"),
    (21, "tPlace", "silk_top", "active"),
    (22, "bPlace", "silk_bot", "active"),
    (23, "tOrigins", "top", "active"),
    (24, "bOrigins", "bot", "active"),
    (25, "tNames", "top", "active"),
    (26, "bNames", "bot", "active"),
    (27, "tValues", "top", "active"),
    (28, "bValues", "bot", "active"),
    (29, "tStop", "top", "active"),
    (30, "bStop", "bot", "active"),
    (31, "tCream", "top", "active"),
    (32, "bCream", "bot", "active"),
    (33, "tFinish", "top", "active"),
    (34, "bFinish", "bot", "active"),
    (35, "tGlue", "top", "active"),
    (36, "bGlue", "bot", "active"),
    (39, "tKeepout", "top", "active"),
    (40, "bKeepout", "bot", "active"),
    (41, "tRestrict", "top", "active"),
    (42, "bRestrict", "bot", "active"),
    (43, "vRestrict", "all", "active"),
    (44, "Drills", "all", "active"),
    (45, "Holes", "all", "active"),
    (46, "Milling", "all", "active"),
    (47, "Measures", "doc", "active"),
    (48, "Document", "doc", "active"),
    (49, "Reference", "doc", "active"),
    (51, "tDocu", "doc", "active"),
    (52, "bDocu", "doc", "active"),
]


def _get_eagle_layer(kicad_layer: str) -> int:
    """Map a KiCad layer name to an Eagle layer number."""
    return KICAD_TO_EAGLE_LAYER.get(kicad_layer, 1)


def _rotation_string(angle: float, mirror: bool = False) -> str:
    """Build Eagle rotation string from angle and mirror flag."""
    prefix = "M" if mirror else ""
    if angle == 0.0 and not mirror:
        return "R0"
    return f"{prefix}R{angle:g}"


class EagleBrdExporter:
    """Exports a BoardDesign to Eagle .brd XML format.

    Usage::

        exporter = EagleBrdExporter()
        exporter.export(board, "output.brd")
    """

    def export(self, board: BoardDesign, filepath: str | Path) -> None:
        """Export a BoardDesign to an Eagle .brd file.

        Args:
            board: The board design to export.
            filepath: Path for the output .brd file.
        """
        filepath = Path(filepath)
        xml_str = self.export_text(board)
        filepath.write_text(xml_str, encoding="utf-8")

    def export_text(self, board: BoardDesign) -> str:
        """Export a BoardDesign to an Eagle .brd XML string.

        Args:
            board: The board design to export.

        Returns:
            The complete Eagle .brd XML as a string.
        """
        root = self._build_xml(board)
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

    def _build_xml(self, board: BoardDesign) -> ET.Element:
        """Build the complete Eagle XML tree."""
        eagle = ET.Element("eagle", version="9.6.2")

        drawing = ET.SubElement(eagle, "drawing")

        # Settings (minimal)
        settings = ET.SubElement(drawing, "settings")
        ET.SubElement(settings, "setting", alwaysvectorfont="no")
        ET.SubElement(settings, "setting", verticaltext="up")

        # Grid
        grid = ET.SubElement(drawing, "grid",
                             distance="0.1", unitdist="mm",
                             unit="mm", style="lines",
                             multiple="1", display="no",
                             altdistance="0.01", altunitdist="mm",
                             altunit="mm")

        # Layers
        layers_el = ET.SubElement(drawing, "layers")
        for num, name, color_type, visible in DEFAULT_EAGLE_LAYERS:
            ET.SubElement(layers_el, "layer",
                          number=str(num), name=name,
                          color="4", fill="1", visible="yes",
                          active=visible)

        # Board
        board_el = ET.SubElement(drawing, "board")

        # Plain (board outline)
        plain_el = ET.SubElement(board_el, "plain")
        self._build_outline(board, plain_el)

        # Libraries (footprint definitions)
        libraries_el = ET.SubElement(board_el, "libraries")
        self._build_libraries(board, libraries_el)

        # Attributes
        ET.SubElement(board_el, "attributes")

        # Variantdefs
        ET.SubElement(board_el, "variantdefs")

        # Classes (net classes)
        classes_el = ET.SubElement(board_el, "classes")
        ET.SubElement(classes_el, "class", number="0", name="default",
                      width="0", drill="0")

        # Elements (placed components)
        elements_el = ET.SubElement(board_el, "elements")
        self._build_elements(board, elements_el)

        # Signals (nets with traces, vias, polygons)
        signals_el = ET.SubElement(board_el, "signals")
        self._build_signals(board, signals_el)

        return eagle

    # ------------------------------------------------------------------
    # Board outline
    # ------------------------------------------------------------------

    def _build_outline(self, board: BoardDesign, plain_el: ET.Element) -> None:
        """Write board outline and graphical items to <plain>."""
        for line in board.gr_lines:
            eagle_layer = _get_eagle_layer(line.layer)
            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{line.start.x:.4f}")
            wire_el.set("y1", f"{line.start.y:.4f}")
            wire_el.set("x2", f"{line.end.x:.4f}")
            wire_el.set("y2", f"{line.end.y:.4f}")
            wire_el.set("width", f"{max(line.width, line.stroke_width, 0.05):.4f}")
            wire_el.set("layer", str(eagle_layer))

        for arc in board.gr_arcs:
            eagle_layer = _get_eagle_layer(arc.layer)
            curve = self._compute_curve_angle(
                arc.start.x, arc.start.y,
                arc.mid.x, arc.mid.y,
                arc.end.x, arc.end.y,
            )
            wire_el = ET.SubElement(plain_el, "wire")
            wire_el.set("x1", f"{arc.start.x:.4f}")
            wire_el.set("y1", f"{arc.start.y:.4f}")
            wire_el.set("x2", f"{arc.end.x:.4f}")
            wire_el.set("y2", f"{arc.end.y:.4f}")
            wire_el.set("width", f"{max(arc.width, arc.stroke_width, 0.05):.4f}")
            wire_el.set("layer", str(eagle_layer))
            if abs(curve) > 0.01:
                wire_el.set("curve", f"{curve:.4f}")

    # ------------------------------------------------------------------
    # Libraries
    # ------------------------------------------------------------------

    def _build_libraries(
        self, board: BoardDesign, libraries_el: ET.Element
    ) -> None:
        """Build <libraries> with package definitions from footprints."""
        # Group footprints by library name
        lib_packages: dict[str, dict[str, Footprint]] = {}
        for fp in board.footprints:
            parts = fp.library_link.split(":", 1)
            if len(parts) == 2:
                lib_name, pkg_name = parts
            else:
                lib_name = "default"
                pkg_name = fp.library_link

            lib_packages.setdefault(lib_name, {})
            if pkg_name not in lib_packages[lib_name]:
                lib_packages[lib_name][pkg_name] = fp

        for lib_name, packages in lib_packages.items():
            lib_el = ET.SubElement(libraries_el, "library", name=lib_name)
            packages_el = ET.SubElement(lib_el, "packages")

            for pkg_name, fp in packages.items():
                pkg_el = ET.SubElement(packages_el, "package", name=pkg_name)

                # Pads
                for pad in fp.pads:
                    if pad.pad_type == PadType.SMD:
                        smd_el = ET.SubElement(pkg_el, "smd")
                        smd_el.set("name", pad.number)
                        smd_el.set("x", f"{pad.at.x:.4f}")
                        smd_el.set("y", f"{pad.at.y:.4f}")
                        smd_el.set("dx", f"{pad.size_x:.4f}")
                        smd_el.set("dy", f"{pad.size_y:.4f}")
                        layer = _get_eagle_layer(fp.layer)
                        smd_el.set("layer", str(layer))
                        if pad.shape == PadShape.ROUNDRECT:
                            roundness = int(pad.roundrect_rratio * 200)
                            smd_el.set("roundness", str(roundness))
                        if pad.angle != 0.0:
                            smd_el.set("rot", _rotation_string(pad.angle))
                    else:
                        pad_el = ET.SubElement(pkg_el, "pad")
                        pad_el.set("name", pad.number)
                        pad_el.set("x", f"{pad.at.x:.4f}")
                        pad_el.set("y", f"{pad.at.y:.4f}")
                        pad_el.set("drill", f"{pad.drill:.4f}")
                        if pad.size_x > 0:
                            pad_el.set("diameter", f"{pad.size_x:.4f}")
                        shape_str = {
                            PadShape.CIRCLE: "round",
                            PadShape.RECT: "square",
                            PadShape.OVAL: "long",
                            PadShape.ROUNDRECT: "octagon",
                        }.get(pad.shape, "round")
                        pad_el.set("shape", shape_str)
                        if pad.angle != 0.0:
                            pad_el.set("rot", _rotation_string(pad.angle))

                # Lines in the package
                for line in fp.lines:
                    wire_el = ET.SubElement(pkg_el, "wire")
                    wire_el.set("x1", f"{line.start.x:.4f}")
                    wire_el.set("y1", f"{line.start.y:.4f}")
                    wire_el.set("x2", f"{line.end.x:.4f}")
                    wire_el.set("y2", f"{line.end.y:.4f}")
                    wire_el.set("width", f"{max(line.width, line.stroke_width):.4f}")
                    wire_el.set("layer", str(_get_eagle_layer(line.layer)))

                # Circles
                for circle in fp.circles:
                    circle_el = ET.SubElement(pkg_el, "circle")
                    circle_el.set("x", f"{circle.center.x:.4f}")
                    circle_el.set("y", f"{circle.center.y:.4f}")
                    dx = circle.end.x - circle.center.x
                    dy = circle.end.y - circle.center.y
                    radius = math.sqrt(dx * dx + dy * dy)
                    circle_el.set("radius", f"{radius:.4f}")
                    circle_el.set("width", f"{max(circle.width, circle.stroke_width):.4f}")
                    circle_el.set("layer", str(_get_eagle_layer(circle.layer)))

                # Texts
                for text in fp.texts:
                    text_el = ET.SubElement(pkg_el, "text")
                    text_el.set("x", f"{text.at.x:.4f}")
                    text_el.set("y", f"{text.at.y:.4f}")
                    text_el.set("size", f"{text.font_size_x:.4f}")
                    text_el.set("layer", str(_get_eagle_layer(text.layer)))
                    if text.text_type == "reference":
                        text_el.text = ">NAME"
                    elif text.text_type == "value":
                        text_el.text = ">VALUE"
                    else:
                        text_el.text = text.text

                # Polygons
                for poly in fp.polygons:
                    poly_el = ET.SubElement(pkg_el, "polygon")
                    poly_el.set("width", f"{max(poly.width, poly.stroke_width):.4f}")
                    poly_el.set("layer", str(_get_eagle_layer(poly.layer)))
                    for pt in poly.points:
                        vertex_el = ET.SubElement(poly_el, "vertex")
                        vertex_el.set("x", f"{pt.x:.4f}")
                        vertex_el.set("y", f"{pt.y:.4f}")

    # ------------------------------------------------------------------
    # Elements
    # ------------------------------------------------------------------

    def _build_elements(
        self, board: BoardDesign, elements_el: ET.Element
    ) -> None:
        """Build <elements> from placed footprints."""
        for fp in board.footprints:
            parts = fp.library_link.split(":", 1)
            if len(parts) == 2:
                lib_name, pkg_name = parts
            else:
                lib_name = "default"
                pkg_name = fp.library_link

            is_mirror = fp.layer == "B.Cu"
            elem = ET.SubElement(elements_el, "element")
            elem.set("name", fp.reference)
            elem.set("library", lib_name)
            elem.set("package", pkg_name)
            elem.set("value", fp.value)
            elem.set("x", f"{fp.at.x:.4f}")
            elem.set("y", f"{fp.at.y:.4f}")
            elem.set("rot", _rotation_string(fp.angle, mirror=is_mirror))

    # ------------------------------------------------------------------
    # Signals
    # ------------------------------------------------------------------

    def _build_signals(
        self, board: BoardDesign, signals_el: ET.Element
    ) -> None:
        """Build <signals> with traces, vias, polygons, and contact refs."""
        # Group by net
        net_segments: dict[int, list[Segment]] = {}
        for seg in board.segments:
            net_segments.setdefault(seg.net, []).append(seg)

        net_arcs: dict[int, list[Arc]] = {}
        for arc in board.arcs:
            net_arcs.setdefault(arc.net, []).append(arc)

        net_vias: dict[int, list[Via]] = {}
        for via in board.vias:
            net_vias.setdefault(via.net, []).append(via)

        net_zones: dict[int, list[Zone]] = {}
        for zone in board.zones:
            net_zones.setdefault(zone.net, []).append(zone)

        # Pad-to-net map for contactrefs
        pad_net_map: dict[tuple[str, str], int] = {}
        for fp in board.footprints:
            for pad in fp.pads:
                if pad.net_number > 0:
                    pad_net_map[(fp.reference, pad.number)] = pad.net_number

        # Build net name map
        net_names: dict[int, str] = {}
        for net in board.nets:
            net_names[net.number] = net.name

        # Collect all net numbers that have any content
        all_net_nums: set[int] = set()
        all_net_nums.update(net_segments.keys())
        all_net_nums.update(net_arcs.keys())
        all_net_nums.update(net_vias.keys())
        all_net_nums.update(net_zones.keys())
        for (ref, pad_num), net_num in pad_net_map.items():
            all_net_nums.add(net_num)
        all_net_nums.discard(0)  # Skip unconnected net

        for net_num in sorted(all_net_nums):
            net_name = net_names.get(net_num, f"N${net_num}")
            signal_el = ET.SubElement(signals_el, "signal", name=net_name)

            # Contact references
            for (ref, pad_num), pnet in pad_net_map.items():
                if pnet == net_num:
                    ET.SubElement(signal_el, "contactref",
                                  element=ref, pad=pad_num)

            # Traces (wires)
            for seg in net_segments.get(net_num, []):
                eagle_layer = _get_eagle_layer(seg.layer)
                wire_el = ET.SubElement(signal_el, "wire")
                wire_el.set("x1", f"{seg.start.x:.4f}")
                wire_el.set("y1", f"{seg.start.y:.4f}")
                wire_el.set("x2", f"{seg.end.x:.4f}")
                wire_el.set("y2", f"{seg.end.y:.4f}")
                wire_el.set("width", f"{seg.width:.4f}")
                wire_el.set("layer", str(eagle_layer))

            # Arc traces
            for arc in net_arcs.get(net_num, []):
                eagle_layer = _get_eagle_layer(arc.layer)
                curve = self._compute_curve_angle(
                    arc.start.x, arc.start.y,
                    arc.mid.x, arc.mid.y,
                    arc.end.x, arc.end.y,
                )
                wire_el = ET.SubElement(signal_el, "wire")
                wire_el.set("x1", f"{arc.start.x:.4f}")
                wire_el.set("y1", f"{arc.start.y:.4f}")
                wire_el.set("x2", f"{arc.end.x:.4f}")
                wire_el.set("y2", f"{arc.end.y:.4f}")
                wire_el.set("width", f"{arc.width:.4f}")
                wire_el.set("layer", str(eagle_layer))
                if abs(curve) > 0.01:
                    wire_el.set("curve", f"{curve:.4f}")

            # Vias
            for via in net_vias.get(net_num, []):
                via_el = ET.SubElement(signal_el, "via")
                via_el.set("x", f"{via.at.x:.4f}")
                via_el.set("y", f"{via.at.y:.4f}")
                via_el.set("drill", f"{via.drill:.4f}")
                if via.size > 0:
                    via_el.set("diameter", f"{via.size:.4f}")
                # Extent
                if len(via.layers) >= 2:
                    start = KICAD_TO_EAGLE_LAYER.get(via.layers[0], 1)
                    end = KICAD_TO_EAGLE_LAYER.get(via.layers[-1], 16)
                    via_el.set("extent", f"{start}-{end}")

            # Polygons (zones)
            for zone in net_zones.get(net_num, []):
                eagle_layer = _get_eagle_layer(zone.layer)
                for zpoly in zone.polygons:
                    poly_el = ET.SubElement(signal_el, "polygon")
                    poly_el.set("width", f"{zone.min_thickness:.4f}")
                    poly_el.set("layer", str(eagle_layer))
                    if zone.connect_pads_clearance > 0:
                        poly_el.set("isolate", f"{zone.connect_pads_clearance:.4f}")
                    if zone.connect_pads == "no":
                        poly_el.set("thermals", "no")
                    for pt in zpoly.points:
                        vertex_el = ET.SubElement(poly_el, "vertex")
                        vertex_el.set("x", f"{pt.x:.4f}")
                        vertex_el.set("y", f"{pt.y:.4f}")

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_curve_angle(
        x1: float, y1: float,
        mx: float, my: float,
        x2: float, y2: float,
    ) -> float:
        """Compute Eagle curve angle from start, mid, end points.

        Returns the included angle in degrees (positive = CCW).
        """
        # Compute vectors from midpoint of chord to arc midpoint
        # and determine the included angle
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0

        # Half-chord length
        dx = x2 - x1
        dy = y2 - y1
        half_chord = math.sqrt(dx * dx + dy * dy) / 2.0

        if half_chord < 1e-9:
            return 0.0

        # Sagitta (distance from chord midpoint to arc midpoint)
        smx = mx - cx
        smy = my - cy
        sagitta = math.sqrt(smx * smx + smy * smy)

        if sagitta < 1e-9:
            return 0.0

        # The included angle = 2 * atan(sagitta / half_chord)
        # But this gives half the curve angle
        alpha = math.atan2(sagitta, half_chord)
        curve = math.degrees(2.0 * alpha)

        # Determine sign: is the arc midpoint on the left or right of the chord?
        cross = dx * (my - y1) - dy * (mx - x1)
        if cross < 0:
            curve = -curve

        return curve
