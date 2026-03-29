"""Parser for Autodesk Eagle .brd board files.

Eagle .brd files are XML-based. This parser reads the XML tree and converts
all board data (layers, signals/nets, elements/components, packages/footprints,
board outline, traces, vias, polygons) into the RouteAI unified BoardDesign model.

Supports Eagle 6.x through 9.x file formats.
"""

from __future__ import annotations

import logging
import math
import xml.etree.ElementTree as ET
from pathlib import Path

from routeai_parsers.models import (
    Arc,
    BoardDesign,
    Footprint,
    FpCircle,
    FpLine,
    FpPoly,
    FpText,
    GrArc,
    GrLine,
    LayerDef,
    Net,
    Pad,
    PadShape,
    PadType,
    Point2D,
    Segment,
    Via,
    Zone,
    ZoneFill,
    ZonePolygon,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Eagle layer number to name mapping
# ---------------------------------------------------------------------------

EAGLE_LAYER_MAP: dict[int, str] = {
    1: "F.Cu",        # Top
    2: "In1.Cu",      # Route2
    3: "In2.Cu",      # Route3
    4: "In3.Cu",      # Route4
    5: "In4.Cu",      # Route5
    6: "In5.Cu",      # Route6
    7: "In6.Cu",      # Route7
    8: "In7.Cu",      # Route8
    9: "In8.Cu",      # Route9
    10: "In9.Cu",     # Route10
    11: "In10.Cu",    # Route11
    12: "In11.Cu",    # Route12
    13: "In12.Cu",    # Route13
    14: "In13.Cu",    # Route14
    15: "In14.Cu",    # Route15
    16: "B.Cu",       # Bottom
    17: "F.Cu",       # Pads (through-hole, all layers)
    18: "F.Cu",       # Vias (through, all layers)
    20: "Edge.Cuts",  # Dimension (board outline)
    21: "F.SilkS",    # tPlace
    22: "B.SilkS",    # bPlace
    25: "F.Fab",      # tNames
    26: "B.Fab",      # bNames
    27: "F.Fab",      # tValues
    28: "B.Fab",      # bValues
    29: "F.Mask",     # tStop
    30: "B.Mask",     # bStop
    31: "F.Paste",    # tCream
    32: "B.Paste",    # bCream
    35: "F.Adhes",    # tGlue
    36: "B.Adhes",    # bGlue
    39: "F.CrtYd",    # tKeepout
    40: "B.CrtYd",    # bKeepout
    41: "F.CrtYd",    # tRestrict
    42: "B.CrtYd",    # bRestrict
    43: "Edge.Cuts",  # vRestrict
    44: "Edge.Cuts",  # Drills
    45: "Edge.Cuts",  # Holes
    46: "Edge.Cuts",  # Milling
    47: "F.Fab",      # Measures
    48: "F.Fab",      # Document
    49: "F.Fab",      # Reference
    51: "F.Fab",      # tDocu
    52: "B.Fab",      # bDocu
}

# Reverse: map eagle layer name to typical layer type
EAGLE_LAYER_TYPE_MAP: dict[int, str] = {
    1: "signal",
    2: "signal",
    3: "signal",
    4: "signal",
    5: "signal",
    6: "signal",
    7: "signal",
    8: "signal",
    9: "signal",
    10: "signal",
    11: "signal",
    12: "signal",
    13: "signal",
    14: "signal",
    15: "signal",
    16: "signal",
    20: "user",
    21: "user",
    22: "user",
    25: "user",
    26: "user",
    29: "user",
    30: "user",
    31: "user",
    32: "user",
}


def _float(val: str | None, default: float = 0.0) -> float:
    """Parse a float from an XML attribute, returning default if None."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _int(val: str | None, default: int = 0) -> int:
    """Parse an int from an XML attribute."""
    if val is None:
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _eagle_layer_to_kicad(eagle_layer: int) -> str:
    """Map an Eagle layer number to a KiCad-style layer name."""
    return EAGLE_LAYER_MAP.get(eagle_layer, f"User.{eagle_layer}")


def _eagle_layer_type(eagle_layer: int) -> str:
    """Get the layer type for an Eagle layer number."""
    return EAGLE_LAYER_TYPE_MAP.get(eagle_layer, "user")


class EagleBrdParser:
    """Parser for Eagle .brd board files.

    Reads the XML format and produces a BoardDesign model with all
    board data: layers, nets, components, traces, vias, zones, outline.

    Usage::

        parser = EagleBrdParser()
        board = parser.parse("my_board.brd")
    """

    def parse(self, filepath: str | Path) -> BoardDesign:
        """Parse an Eagle .brd file and return a BoardDesign.

        Args:
            filepath: Path to the Eagle .brd file.

        Returns:
            A fully populated BoardDesign instance.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is not a valid Eagle .brd file.
        """
        filepath = Path(filepath)
        tree = ET.parse(filepath)
        root = tree.getroot()
        return self._parse_root(root)

    def parse_text(self, text: str) -> BoardDesign:
        """Parse Eagle .brd XML from a string.

        Args:
            text: The raw XML content of an Eagle .brd file.

        Returns:
            A fully populated BoardDesign.
        """
        root = ET.fromstring(text)
        return self._parse_root(root)

    def _parse_root(self, root: ET.Element) -> BoardDesign:
        """Parse the root <eagle> element."""
        board = BoardDesign(generator="eagle")

        # Find the <drawing><board> element
        drawing = root.find("drawing")
        if drawing is None:
            raise ValueError("Not a valid Eagle file: missing <drawing> element")

        board_elem = drawing.find("board")
        if board_elem is None:
            raise ValueError("Not a valid Eagle .brd file: missing <board> element")

        # Parse layers from <drawing><layers>
        layers_elem = drawing.find("layers")
        if layers_elem is not None:
            board.layers = self._parse_layers(layers_elem)

        # Build net map from <board><signals>
        net_map: dict[str, int] = {}
        signals_elem = board_elem.find("signals")
        if signals_elem is not None:
            board.nets, net_map = self._parse_signals(signals_elem)

        # Parse packages (footprint library definitions)
        package_map: dict[str, list] = {}
        libraries_elem = board_elem.find("libraries")
        if libraries_elem is not None:
            package_map = self._parse_libraries(libraries_elem)

        # Parse elements (placed components)
        elements_elem = board_elem.find("elements")
        if elements_elem is not None:
            board.footprints = self._parse_elements(
                elements_elem, package_map, net_map
            )

        # Parse board outline from <board><plain>
        plain_elem = board_elem.find("plain")
        if plain_elem is not None:
            self._parse_plain(plain_elem, board)

        # Parse traces (wires) and vias from signals
        if signals_elem is not None:
            self._parse_routing(signals_elem, board, net_map)

        return board

    # ------------------------------------------------------------------
    # Layers
    # ------------------------------------------------------------------

    def _parse_layers(self, layers_elem: ET.Element) -> list[LayerDef]:
        """Parse <layers> into LayerDef list."""
        result: list[LayerDef] = []
        for layer_el in layers_elem.findall("layer"):
            number = _int(layer_el.get("number"))
            name = layer_el.get("name", "")
            kicad_name = _eagle_layer_to_kicad(number)
            layer_type = _eagle_layer_type(number)
            result.append(LayerDef(
                ordinal=number,
                name=kicad_name,
                layer_type=layer_type,
                user_name=name,
            ))
        return result

    # ------------------------------------------------------------------
    # Signals (nets)
    # ------------------------------------------------------------------

    def _parse_signals(
        self, signals_elem: ET.Element
    ) -> tuple[list[Net], dict[str, int]]:
        """Parse <signals> into Net list and name->number map."""
        nets: list[Net] = [Net(number=0, name="")]  # Net 0 = unconnected
        net_map: dict[str, int] = {"": 0}

        for idx, signal_el in enumerate(signals_elem.findall("signal"), start=1):
            name = signal_el.get("name", f"N${idx}")
            nets.append(Net(number=idx, name=name))
            net_map[name] = idx

        return nets, net_map

    # ------------------------------------------------------------------
    # Libraries / Packages
    # ------------------------------------------------------------------

    def _parse_libraries(
        self, libraries_elem: ET.Element
    ) -> dict[str, list]:
        """Parse <libraries> to build a library:package -> pad/shape definitions map.

        Returns a dict mapping "library:package" to list of parsed pad/shape data.
        """
        package_map: dict[str, list] = {}

        for lib_el in libraries_elem.findall("library"):
            lib_name = lib_el.get("name", "")
            packages_el = lib_el.find("packages")
            if packages_el is None:
                continue
            for pkg_el in packages_el.findall("package"):
                pkg_name = pkg_el.get("name", "")
                key = f"{lib_name}:{pkg_name}"
                package_map[key] = self._parse_package(pkg_el)

        return package_map

    def _parse_package(self, pkg_el: ET.Element) -> list:
        """Parse a single <package> element into a list of footprint items.

        Returns list of dicts with type 'pad', 'smd', 'wire', 'circle', 'text', 'polygon'.
        """
        items: list[dict] = []

        # SMD pads
        for smd_el in pkg_el.findall("smd"):
            items.append({
                "type": "smd",
                "name": smd_el.get("name", ""),
                "x": _float(smd_el.get("x")),
                "y": _float(smd_el.get("y")),
                "dx": _float(smd_el.get("dx")),
                "dy": _float(smd_el.get("dy")),
                "layer": _int(smd_el.get("layer")),
                "roundness": _int(smd_el.get("roundness"), 0),
                "rot": smd_el.get("rot", "R0"),
            })

        # Through-hole pads
        for pad_el in pkg_el.findall("pad"):
            shape_str = pad_el.get("shape", "round")
            items.append({
                "type": "pad",
                "name": pad_el.get("name", ""),
                "x": _float(pad_el.get("x")),
                "y": _float(pad_el.get("y")),
                "drill": _float(pad_el.get("drill")),
                "diameter": _float(pad_el.get("diameter"), 0.0),
                "shape": shape_str,
                "rot": pad_el.get("rot", "R0"),
            })

        # Wires (silkscreen/courtyard lines in the package)
        for wire_el in pkg_el.findall("wire"):
            items.append({
                "type": "wire",
                "x1": _float(wire_el.get("x1")),
                "y1": _float(wire_el.get("y1")),
                "x2": _float(wire_el.get("x2")),
                "y2": _float(wire_el.get("y2")),
                "width": _float(wire_el.get("width")),
                "layer": _int(wire_el.get("layer")),
                "curve": _float(wire_el.get("curve"), 0.0),
            })

        # Circles
        for circle_el in pkg_el.findall("circle"):
            items.append({
                "type": "circle",
                "x": _float(circle_el.get("x")),
                "y": _float(circle_el.get("y")),
                "radius": _float(circle_el.get("radius")),
                "width": _float(circle_el.get("width")),
                "layer": _int(circle_el.get("layer")),
            })

        # Text
        for text_el in pkg_el.findall("text"):
            items.append({
                "type": "text",
                "x": _float(text_el.get("x")),
                "y": _float(text_el.get("y")),
                "size": _float(text_el.get("size"), 1.27),
                "layer": _int(text_el.get("layer")),
                "rot": text_el.get("rot", "R0"),
                "text": text_el.text or "",
            })

        # Polygons
        for poly_el in pkg_el.findall("polygon"):
            vertices = []
            for vertex_el in poly_el.findall("vertex"):
                vertices.append({
                    "x": _float(vertex_el.get("x")),
                    "y": _float(vertex_el.get("y")),
                    "curve": _float(vertex_el.get("curve"), 0.0),
                })
            items.append({
                "type": "polygon",
                "width": _float(poly_el.get("width")),
                "layer": _int(poly_el.get("layer")),
                "vertices": vertices,
            })

        return items

    # ------------------------------------------------------------------
    # Elements (placed components)
    # ------------------------------------------------------------------

    def _parse_elements(
        self,
        elements_elem: ET.Element,
        package_map: dict[str, list],
        net_map: dict[str, int],
    ) -> list[Footprint]:
        """Parse <elements> into placed Footprint instances."""
        footprints: list[Footprint] = []

        for elem_el in elements_elem.findall("element"):
            name = elem_el.get("name", "")
            library = elem_el.get("library", "")
            package = elem_el.get("package", "")
            value = elem_el.get("value", "")
            x = _float(elem_el.get("x"))
            y = _float(elem_el.get("y"))
            rot_str = elem_el.get("rot", "R0")

            angle, mirror = self._parse_rotation(rot_str)

            fp = Footprint(
                library_link=f"{library}:{package}",
                at=Point2D(x=x, y=y),
                angle=angle,
                layer="B.Cu" if mirror else "F.Cu",
                reference=name,
                value=value,
            )

            # Look up package definition to get pads and shapes
            pkg_key = f"{library}:{package}"
            pkg_items = package_map.get(pkg_key, [])

            # Build contact reference map from <element> children
            contact_map: dict[str, str] = {}
            for contact_el in elem_el.findall(".//contactref"):
                pad_name = contact_el.get("pad", "")
                sig_name = contact_el.get("signal", "")
                if not sig_name:
                    # contactref might be nested under the parent signal
                    pass
                contact_map[pad_name] = sig_name

            self._populate_footprint_from_package(
                fp, pkg_items, net_map, contact_map, mirror
            )
            footprints.append(fp)

        return footprints

    def _populate_footprint_from_package(
        self,
        fp: Footprint,
        pkg_items: list[dict],
        net_map: dict[str, int],
        contact_map: dict[str, str],
        mirror: bool,
    ) -> None:
        """Populate a Footprint with pads and drawing items from a package definition."""
        for item in pkg_items:
            item_type = item["type"]

            if item_type == "smd":
                pad = self._make_smd_pad(item, net_map, contact_map, mirror)
                fp.pads.append(pad)

            elif item_type == "pad":
                pad = self._make_th_pad(item, net_map, contact_map)
                fp.pads.append(pad)

            elif item_type == "wire":
                layer_name = _eagle_layer_to_kicad(item["layer"])
                fp_line = FpLine(
                    start=Point2D(x=item["x1"], y=item["y1"]),
                    end=Point2D(x=item["x2"], y=item["y2"]),
                    layer=layer_name,
                    width=item["width"],
                )
                fp.lines.append(fp_line)

            elif item_type == "circle":
                layer_name = _eagle_layer_to_kicad(item["layer"])
                r = item["radius"]
                fp_circle = FpCircle(
                    center=Point2D(x=item["x"], y=item["y"]),
                    end=Point2D(x=item["x"] + r, y=item["y"]),
                    layer=layer_name,
                    width=item["width"],
                )
                fp.circles.append(fp_circle)

            elif item_type == "text":
                layer_name = _eagle_layer_to_kicad(item["layer"])
                text_content = item["text"]
                text_type = "user"
                if text_content == ">NAME":
                    text_type = "reference"
                    text_content = fp.reference
                elif text_content == ">VALUE":
                    text_type = "value"
                    text_content = fp.value

                fp_text = FpText(
                    text_type=text_type,
                    text=text_content,
                    at=Point2D(x=item["x"], y=item["y"]),
                    layer=layer_name,
                    font_size_x=item["size"],
                    font_size_y=item["size"],
                    font_thickness=item["size"] * 0.15,
                )
                fp.texts.append(fp_text)

            elif item_type == "polygon":
                layer_name = _eagle_layer_to_kicad(item["layer"])
                points = [
                    Point2D(x=v["x"], y=v["y"]) for v in item["vertices"]
                ]
                if points:
                    fp_poly = FpPoly(
                        points=points,
                        layer=layer_name,
                        width=item["width"],
                    )
                    fp.polygons.append(fp_poly)

    def _make_smd_pad(
        self,
        item: dict,
        net_map: dict[str, int],
        contact_map: dict[str, str],
        mirror: bool,
    ) -> Pad:
        """Create an SMD pad from a package smd item."""
        pad_name = item["name"]
        net_name = contact_map.get(pad_name, "")
        net_num = net_map.get(net_name, 0)

        angle, _ = self._parse_rotation(item.get("rot", "R0"))
        roundness = item.get("roundness", 0)

        if roundness > 0 and roundness < 100:
            shape = PadShape.ROUNDRECT
            rratio = roundness / 200.0
        elif roundness >= 100:
            shape = PadShape.OVAL
            rratio = 0.25
        else:
            shape = PadShape.RECT
            rratio = 0.0

        layer_name = "F.Cu" if not mirror else "B.Cu"
        layers = [layer_name, f"{'F' if not mirror else 'B'}.Paste",
                  f"{'F' if not mirror else 'B'}.Mask"]

        return Pad(
            number=pad_name,
            pad_type=PadType.SMD,
            shape=shape,
            at=Point2D(x=item["x"], y=item["y"]),
            angle=angle,
            size_x=item["dx"],
            size_y=item["dy"],
            layers=layers,
            net_number=net_num,
            net_name=net_name,
            roundrect_rratio=rratio if shape == PadShape.ROUNDRECT else 0.25,
        )

    def _make_th_pad(
        self,
        item: dict,
        net_map: dict[str, int],
        contact_map: dict[str, str],
    ) -> Pad:
        """Create a through-hole pad from a package pad item."""
        pad_name = item["name"]
        net_name = contact_map.get(pad_name, "")
        net_num = net_map.get(net_name, 0)

        drill = item["drill"]
        diameter = item.get("diameter", 0.0)
        if diameter <= 0.0:
            # Eagle auto-calculates: pad diameter = drill + 2 * restring
            # Default restring is approximately drill * 0.25 with a minimum
            diameter = max(drill * 1.5, drill + 0.5)

        shape_str = item.get("shape", "round")
        angle, _ = self._parse_rotation(item.get("rot", "R0"))

        if shape_str == "square":
            shape = PadShape.RECT
        elif shape_str == "long":
            shape = PadShape.OVAL
        elif shape_str == "octagon":
            shape = PadShape.ROUNDRECT
        else:  # "round"
            shape = PadShape.CIRCLE

        # For oval/long pads, make size_x larger
        size_x = diameter
        size_y = diameter
        if shape == PadShape.OVAL:
            size_x = diameter * 2.0
            size_y = diameter

        layers = ["*.Cu", "*.Mask"]

        return Pad(
            number=pad_name,
            pad_type=PadType.THRU_HOLE,
            shape=shape,
            at=Point2D(x=item["x"], y=item["y"]),
            angle=angle,
            size_x=size_x,
            size_y=size_y,
            layers=layers,
            net_number=net_num,
            net_name=net_name,
            drill=drill,
            roundrect_rratio=0.25 if shape == PadShape.ROUNDRECT else 0.0,
        )

    # ------------------------------------------------------------------
    # Plain (board outline and graphical items)
    # ------------------------------------------------------------------

    def _parse_plain(self, plain_elem: ET.Element, board: BoardDesign) -> None:
        """Parse <plain> section for board outline and graphical items."""
        for wire_el in plain_elem.findall("wire"):
            layer = _int(wire_el.get("layer"))
            layer_name = _eagle_layer_to_kicad(layer)
            x1 = _float(wire_el.get("x1"))
            y1 = _float(wire_el.get("y1"))
            x2 = _float(wire_el.get("x2"))
            y2 = _float(wire_el.get("y2"))
            width = _float(wire_el.get("width"))
            curve = _float(wire_el.get("curve"), 0.0)

            if layer == 20:
                # Board outline (Dimension layer)
                if abs(curve) > 0.01:
                    # Arc on outline
                    mid = self._arc_midpoint(x1, y1, x2, y2, curve)
                    board.gr_arcs.append(GrArc(
                        start=Point2D(x=x1, y=y1),
                        mid=Point2D(x=mid[0], y=mid[1]),
                        end=Point2D(x=x2, y=y2),
                        layer="Edge.Cuts",
                        width=width if width > 0 else 0.05,
                    ))
                else:
                    board.gr_lines.append(GrLine(
                        start=Point2D(x=x1, y=y1),
                        end=Point2D(x=x2, y=y2),
                        layer="Edge.Cuts",
                        width=width if width > 0 else 0.05,
                    ))
            else:
                if abs(curve) > 0.01:
                    mid = self._arc_midpoint(x1, y1, x2, y2, curve)
                    board.gr_arcs.append(GrArc(
                        start=Point2D(x=x1, y=y1),
                        mid=Point2D(x=mid[0], y=mid[1]),
                        end=Point2D(x=x2, y=y2),
                        layer=layer_name,
                        width=width,
                    ))
                else:
                    board.gr_lines.append(GrLine(
                        start=Point2D(x=x1, y=y1),
                        end=Point2D(x=x2, y=y2),
                        layer=layer_name,
                        width=width,
                    ))

    # ------------------------------------------------------------------
    # Routing (traces, vias, polygons from signals)
    # ------------------------------------------------------------------

    def _parse_routing(
        self,
        signals_elem: ET.Element,
        board: BoardDesign,
        net_map: dict[str, int],
    ) -> None:
        """Parse wires, vias, and polygons from <signals>."""
        for signal_el in signals_elem.findall("signal"):
            sig_name = signal_el.get("name", "")
            net_num = net_map.get(sig_name, 0)

            # Wires (traces)
            for wire_el in signal_el.findall("wire"):
                layer = _int(wire_el.get("layer"))
                # Only copper layers produce trace segments
                if layer < 1 or layer > 16:
                    continue

                layer_name = _eagle_layer_to_kicad(layer)
                x1 = _float(wire_el.get("x1"))
                y1 = _float(wire_el.get("y1"))
                x2 = _float(wire_el.get("x2"))
                y2 = _float(wire_el.get("y2"))
                width = _float(wire_el.get("width"))
                curve = _float(wire_el.get("curve"), 0.0)

                if abs(curve) > 0.01:
                    # Arc trace
                    mid = self._arc_midpoint(x1, y1, x2, y2, curve)
                    board.arcs.append(Arc(
                        start=Point2D(x=x1, y=y1),
                        mid=Point2D(x=mid[0], y=mid[1]),
                        end=Point2D(x=x2, y=y2),
                        width=width,
                        layer=layer_name,
                        net=net_num,
                    ))
                else:
                    board.segments.append(Segment(
                        start=Point2D(x=x1, y=y1),
                        end=Point2D(x=x2, y=y2),
                        width=width,
                        layer=layer_name,
                        net=net_num,
                    ))

            # Vias
            for via_el in signal_el.findall("via"):
                x = _float(via_el.get("x"))
                y = _float(via_el.get("y"))
                drill = _float(via_el.get("drill"))
                diameter = _float(via_el.get("diameter"), 0.0)
                if diameter <= 0.0:
                    diameter = max(drill * 1.5, drill + 0.5)

                extent = via_el.get("extent", "1-16")
                layers = self._parse_via_extent(extent)

                board.vias.append(Via(
                    at=Point2D(x=x, y=y),
                    size=diameter,
                    drill=drill,
                    layers=layers,
                    net=net_num,
                ))

            # Polygons (copper zones)
            for poly_el in signal_el.findall("polygon"):
                layer = _int(poly_el.get("layer"))
                if layer < 1 or layer > 16:
                    continue

                layer_name = _eagle_layer_to_kicad(layer)
                width = _float(poly_el.get("width"))
                isolate = _float(poly_el.get("isolate"), 0.0)
                thermals = poly_el.get("thermals", "yes") == "yes"

                vertices: list[Point2D] = []
                for vertex_el in poly_el.findall("vertex"):
                    vx = _float(vertex_el.get("x"))
                    vy = _float(vertex_el.get("y"))
                    vertices.append(Point2D(x=vx, y=vy))

                if vertices:
                    zone = Zone(
                        net=net_num,
                        net_name=sig_name,
                        layer=layer_name,
                        min_thickness=width if width > 0 else 0.25,
                        connect_pads="yes" if thermals else "no",
                        connect_pads_clearance=isolate if isolate > 0 else 0.3,
                        fill=ZoneFill(
                            filled=True,
                            thermal_gap=isolate if isolate > 0 else 0.5,
                            thermal_bridge_width=0.5,
                        ),
                        polygons=[ZonePolygon(points=vertices)],
                    )
                    board.zones.append(zone)

            # Contact references - build pad-to-net mapping for elements
            for contactref_el in signal_el.findall("contactref"):
                element_name = contactref_el.get("element", "")
                pad_name = contactref_el.get("pad", "")
                # Update the corresponding footprint pad's net
                for fp in board.footprints:
                    if fp.reference == element_name:
                        for pad in fp.pads:
                            if pad.number == pad_name:
                                pad.net_number = net_num
                                pad.net_name = sig_name
                                break
                        break

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_rotation(rot_str: str) -> tuple[float, bool]:
        """Parse Eagle rotation string like 'R90', 'MR180', 'SR45'.

        Returns (angle_degrees, is_mirrored).
        """
        mirror = False
        spin = False
        s = rot_str

        if s.startswith("M"):
            mirror = True
            s = s[1:]
        if s.startswith("S"):
            spin = True
            s = s[1:]
        if s.startswith("R"):
            s = s[1:]

        try:
            angle = float(s)
        except ValueError:
            angle = 0.0

        return angle, mirror

    @staticmethod
    def _arc_midpoint(
        x1: float, y1: float, x2: float, y2: float, curve: float
    ) -> tuple[float, float]:
        """Compute the midpoint of an Eagle arc defined by endpoints and curve angle.

        Eagle defines arcs by start point, end point, and a 'curve' angle
        in degrees (positive = counterclockwise). The curve is the included
        angle of the arc as seen from the center.

        Returns the midpoint of the arc (the point on the arc halfway
        between start and end).
        """
        if abs(curve) < 0.001:
            return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

        # Chord midpoint
        mx = (x1 + x2) / 2.0
        my = (y1 + y2) / 2.0

        # Half-chord length
        dx = x2 - x1
        dy = y2 - y1
        half_chord = math.sqrt(dx * dx + dy * dy) / 2.0

        if half_chord < 1e-9:
            return (mx, my)

        # The included angle
        alpha = math.radians(abs(curve)) / 2.0

        # Sagitta (distance from chord midpoint to arc midpoint)
        if abs(math.cos(alpha)) < 1e-9:
            sagitta = half_chord  # semicircle
        else:
            sagitta = half_chord * math.tan(alpha)

        # Perpendicular direction from chord midpoint
        # Normal to the chord
        nx = -dy / (2.0 * half_chord)
        ny = dx / (2.0 * half_chord)

        # Direction depends on sign of curve
        if curve > 0:
            arc_mx = mx + sagitta * nx
            arc_my = my + sagitta * ny
        else:
            arc_mx = mx - sagitta * nx
            arc_my = my - sagitta * ny

        return (arc_mx, arc_my)

    @staticmethod
    def _parse_via_extent(extent: str) -> list[str]:
        """Parse Eagle via extent string like '1-16' into layer names."""
        parts = extent.split("-")
        if len(parts) != 2:
            return ["F.Cu", "B.Cu"]

        try:
            start_layer = int(parts[0])
            end_layer = int(parts[1])
        except ValueError:
            return ["F.Cu", "B.Cu"]

        start_name = _eagle_layer_to_kicad(start_layer)
        end_name = _eagle_layer_to_kicad(end_layer)
        return [start_name, end_name]
