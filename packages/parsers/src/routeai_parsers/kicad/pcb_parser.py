"""Parser for KiCad 8 .kicad_pcb board files.

Reads the S-expression format used by KiCad 8 and produces a BoardDesign
model containing all board data: layers, nets, footprints, traces, vias,
zones, graphical items, stackup, and design rules.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from routeai_parsers.kicad.sexpr import find_node, find_nodes, node_value
from routeai_parsers.kicad.sexpr import parse as parse_sexpr
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
    LayerDef,
    Model3D,
    Net,
    NetClass,
    Pad,
    PadShape,
    PadType,
    Point2D,
    Point3D,
    Segment,
    Stackup,
    StackupLayer,
    Via,
    Zone,
    ZoneFill,
    ZoneFillType,
    ZonePolygon,
)

logger = logging.getLogger(__name__)


class KiCadPcbParser:
    """Parser for KiCad 8 .kicad_pcb files.

    Usage::

        parser = KiCadPcbParser()
        board = parser.parse("my_board.kicad_pcb")
        print(board.nets)
    """

    def parse(self, filepath: str | Path) -> BoardDesign:
        """Parse a .kicad_pcb file and return a BoardDesign model.

        Args:
            filepath: Path to the .kicad_pcb file.

        Returns:
            A fully populated BoardDesign instance.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is not a valid kicad_pcb file.
        """
        filepath = Path(filepath)
        text = filepath.read_text(encoding="utf-8")
        return self.parse_text(text)

    def parse_text(self, text: str) -> BoardDesign:
        """Parse .kicad_pcb content from a string.

        Args:
            text: The raw S-expression content of a .kicad_pcb file.

        Returns:
            A fully populated BoardDesign instance.
        """
        ast = parse_sexpr(text)
        if not isinstance(ast, list) or not ast or ast[0] != "kicad_pcb":
            raise ValueError("Not a valid kicad_pcb file: missing kicad_pcb root element")
        return self._parse_board(ast)

    def _parse_board(self, ast: list[Any]) -> BoardDesign:
        """Parse the top-level kicad_pcb AST node."""
        board = BoardDesign()

        # Version
        version_node = find_node(ast, "version")
        if version_node:
            board.version = int(node_value(version_node, 0))

        # Generator
        generator_node = find_node(ast, "generator")
        if generator_node:
            board.generator = str(node_value(generator_node, ""))

        # General section
        general_node = find_node(ast, "general")
        if general_node:
            self._parse_general(general_node, board)

        # Layers
        layers_node = find_node(ast, "layers")
        if layers_node:
            board.layers = self._parse_layers(layers_node)

        # Setup
        setup_node = find_node(ast, "setup")
        if setup_node:
            board.setup_raw = setup_node
            self._parse_setup(setup_node, board)

        # Nets
        for net_node in find_nodes(ast, "net"):
            board.nets.append(self._parse_net(net_node))

        # Footprints
        for fp_node in find_nodes(ast, "footprint"):
            board.footprints.append(self._parse_footprint(fp_node))

        # Also handle "module" for older format compat
        for fp_node in find_nodes(ast, "module"):
            board.footprints.append(self._parse_footprint(fp_node))

        # Segments (traces)
        for seg_node in find_nodes(ast, "segment"):
            board.segments.append(self._parse_segment(seg_node))

        # Arcs
        for arc_node in find_nodes(ast, "arc"):
            board.arcs.append(self._parse_arc(arc_node))

        # Vias
        for via_node in find_nodes(ast, "via"):
            board.vias.append(self._parse_via(via_node))

        # Zones
        for zone_node in find_nodes(ast, "zone"):
            board.zones.append(self._parse_zone(zone_node))

        # Graphical items
        for gr_line_node in find_nodes(ast, "gr_line"):
            board.gr_lines.append(self._parse_gr_line(gr_line_node))

        for gr_arc_node in find_nodes(ast, "gr_arc"):
            board.gr_arcs.append(self._parse_gr_arc(gr_arc_node))

        for gr_circle_node in find_nodes(ast, "gr_circle"):
            board.gr_circles.append(self._parse_gr_circle(gr_circle_node))

        for gr_rect_node in find_nodes(ast, "gr_rect"):
            board.gr_rects.append(self._parse_gr_rect(gr_rect_node))

        return board

    # ------------------------------------------------------------------
    # Section parsers
    # ------------------------------------------------------------------

    def _parse_general(self, node: list[Any], board: BoardDesign) -> None:
        """Parse the (general ...) section."""
        thickness_node = find_node(node, "thickness")
        if thickness_node:
            board.thickness = float(node_value(thickness_node, 1.6))

    def _parse_layers(self, node: list[Any]) -> list[LayerDef]:
        """Parse the (layers ...) section."""
        layers: list[LayerDef] = []
        for item in node[1:]:
            if isinstance(item, list) and len(item) >= 3:
                ordinal = int(item[0])
                name = str(item[1])
                layer_type = str(item[2])
                user_name = str(item[3]) if len(item) > 3 else ""
                layers.append(LayerDef(
                    ordinal=ordinal,
                    name=name,
                    layer_type=layer_type,
                    user_name=user_name,
                ))
        return layers

    def _parse_setup(self, node: list[Any], board: BoardDesign) -> None:
        """Parse the (setup ...) section for design rules and stackup."""
        # Stackup
        stackup_node = find_node(node, "stackup")
        if stackup_node:
            board.stackup = self._parse_stackup(stackup_node)

        # Net classes from setup
        for nc_node in find_nodes(node, "net_class"):
            board.net_classes.append(self._parse_net_class(nc_node))

        # Design rules from pad_to_mask_clearance, etc.
        rules = board.design_rules
        pad_mask = find_node(node, "pad_to_mask_clearance")
        if pad_mask:
            # This sets the solder mask expansion
            pass

        # Copper edge clearance
        edge_clear = find_node(node, "copper_edge_clearance")
        if edge_clear:
            rules.copper_edge_clearance = float(node_value(edge_clear, 0.0))

        # Blind/buried vias
        blind_node = find_node(node, "allow_blind_buried_vias")
        if blind_node:
            val = node_value(blind_node, "no")
            rules.allow_blind_buried_vias = val == "yes" or val is True

        micro_node = find_node(node, "allow_micro_vias")
        if micro_node:
            val = node_value(micro_node, "no")
            rules.allow_micro_vias = val == "yes" or val is True

        # Parse pcbplotparams and other setup items - we store the raw AST
        # for round-trip fidelity

    def _parse_stackup(self, node: list[Any]) -> Stackup:
        """Parse the stackup definition."""
        stackup = Stackup()
        for layer_node in find_nodes(node, "layer"):
            sl = StackupLayer()
            if len(layer_node) >= 2:
                sl.name = str(layer_node[1])

            type_node = find_node(layer_node, "type")
            if type_node:
                sl.layer_type = str(node_value(type_node, ""))

            thickness_node = find_node(layer_node, "thickness")
            if thickness_node:
                sl.thickness = float(node_value(thickness_node, 0.0))

            material_node = find_node(layer_node, "material")
            if material_node:
                sl.material = str(node_value(material_node, ""))

            epsilon_node = find_node(layer_node, "epsilon_r")
            if epsilon_node:
                sl.epsilon_r = float(node_value(epsilon_node, 0.0))

            loss_node = find_node(layer_node, "loss_tangent")
            if loss_node:
                sl.loss_tangent = float(node_value(loss_node, 0.0))

            stackup.layers.append(sl)
        return stackup

    def _parse_net_class(self, node: list[Any]) -> NetClass:
        """Parse a net class definition."""
        nc = NetClass()
        if len(node) >= 2:
            nc.name = str(node[1])

        desc_node = find_node(node, "description")
        if desc_node:
            nc.description = str(node_value(desc_node, ""))

        clearance_node = find_node(node, "clearance")
        if clearance_node:
            nc.clearance = float(node_value(clearance_node, 0.2))

        trace_width_node = find_node(node, "trace_width")
        if trace_width_node:
            nc.trace_width = float(node_value(trace_width_node, 0.25))

        via_dia_node = find_node(node, "via_dia")
        if via_dia_node:
            nc.via_diameter = float(node_value(via_dia_node, 0.6))

        via_drill_node = find_node(node, "via_drill")
        if via_drill_node:
            nc.via_drill = float(node_value(via_drill_node, 0.3))

        uvia_dia_node = find_node(node, "uvia_dia")
        if uvia_dia_node:
            nc.uvia_diameter = float(node_value(uvia_dia_node, 0.3))

        uvia_drill_node = find_node(node, "uvia_drill")
        if uvia_drill_node:
            nc.uvia_drill = float(node_value(uvia_drill_node, 0.1))

        dpw_node = find_node(node, "diff_pair_width")
        if dpw_node:
            nc.diff_pair_width = float(node_value(dpw_node, 0.2))

        dpg_node = find_node(node, "diff_pair_gap")
        if dpg_node:
            nc.diff_pair_gap = float(node_value(dpg_node, 0.25))

        # Collect net names assigned to this class
        for net_node in find_nodes(node, "add_net"):
            net_name = node_value(net_node)
            if net_name:
                nc.nets.append(str(net_name))

        return nc

    def _parse_net(self, node: list[Any]) -> Net:
        """Parse a (net <number> <name>) node."""
        number = int(node[1]) if len(node) > 1 else 0
        name = str(node[2]) if len(node) > 2 else ""
        return Net(number=number, name=name)

    # ------------------------------------------------------------------
    # Footprint parsing
    # ------------------------------------------------------------------

    def _parse_footprint(self, node: list[Any]) -> Footprint:
        """Parse a footprint node."""
        fp = Footprint()

        # Library link is the first argument
        if len(node) > 1 and isinstance(node[1], str):
            fp.library_link = node[1]

        # Position
        at_node = find_node(node, "at")
        if at_node:
            fp.at, fp.angle = self._parse_at(at_node)

        # Layer
        layer_node = find_node(node, "layer")
        if layer_node:
            fp.layer = str(node_value(layer_node, "F.Cu"))

        # Locked
        if "locked" in node:
            fp.locked = True

        # UUID
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            fp.uuid = str(node_value(uuid_node, ""))

        # Pads
        for pad_node in find_nodes(node, "pad"):
            fp.pads.append(self._parse_pad(pad_node))

        # Text items - fp_text
        for text_node in find_nodes(node, "fp_text"):
            fp.texts.append(self._parse_fp_text(text_node))

        # Property nodes (KiCad 8 style)
        for prop_node in find_nodes(node, "property"):
            prop = self._parse_fp_property(prop_node)
            if prop:
                key, value = prop
                fp.properties[key] = value
                if key == "Reference":
                    fp.reference = value
                elif key == "Value":
                    fp.value = value

        # Also extract reference and value from fp_text
        for t in fp.texts:
            if t.text_type == "reference" and not fp.reference:
                fp.reference = t.text
            elif t.text_type == "value" and not fp.value:
                fp.value = t.text

        # Lines
        for line_node in find_nodes(node, "fp_line"):
            fp.lines.append(self._parse_fp_line(line_node))

        # Circles
        for circle_node in find_nodes(node, "fp_circle"):
            fp.circles.append(self._parse_fp_circle(circle_node))

        # Arcs
        for arc_node in find_nodes(node, "fp_arc"):
            fp.arcs.append(self._parse_fp_arc(arc_node))

        # Polygons
        for poly_node in find_nodes(node, "fp_poly"):
            fp.polygons.append(self._parse_fp_poly(poly_node))

        # 3D Model
        model_node = find_node(node, "model")
        if model_node:
            fp.model = self._parse_model(model_node)

        return fp

    def _parse_pad(self, node: list[Any]) -> Pad:
        """Parse a pad node."""
        pad = Pad(number="", pad_type=PadType.SMD, shape=PadShape.RECT)

        # (pad "1" smd rect ...)
        if len(node) > 1:
            pad.number = str(node[1])
        if len(node) > 2:
            pad.pad_type = self._map_pad_type(str(node[2]))
        if len(node) > 3:
            pad.shape = self._map_pad_shape(str(node[3]))

        # Position
        at_node = find_node(node, "at")
        if at_node:
            pad.at, pad.angle = self._parse_at(at_node)

        # Size
        size_node = find_node(node, "size")
        if size_node:
            pad.size_x = float(size_node[1]) if len(size_node) > 1 else 0.0
            pad.size_y = float(size_node[2]) if len(size_node) > 2 else pad.size_x

        # Layers
        layers_node = find_node(node, "layers")
        if layers_node:
            pad.layers = [str(l) for l in layers_node[1:] if isinstance(l, str)]

        # Net
        net_node = find_node(node, "net")
        if net_node:
            pad.net_number = int(net_node[1]) if len(net_node) > 1 else 0
            pad.net_name = str(net_node[2]) if len(net_node) > 2 else ""

        # Drill
        drill_node = find_node(node, "drill")
        if drill_node:
            self._parse_drill(drill_node, pad)

        # Roundrect ratio
        rratio_node = find_node(node, "roundrect_rratio")
        if rratio_node:
            pad.roundrect_rratio = float(node_value(rratio_node, 0.25))

        # Solder mask margin
        smm_node = find_node(node, "solder_mask_margin")
        if smm_node:
            pad.solder_mask_margin = float(node_value(smm_node, 0.0))

        # Solder paste margin
        spm_node = find_node(node, "solder_paste_margin")
        if spm_node:
            pad.solder_paste_margin = float(node_value(spm_node, 0.0))

        # Clearance
        clearance_node = find_node(node, "clearance")
        if clearance_node:
            pad.clearance = float(node_value(clearance_node, 0.0))

        return pad

    def _parse_drill(self, node: list[Any], pad: Pad) -> None:
        """Parse a drill specification node."""
        # (drill 0.3) or (drill oval 0.6 0.8) or (drill 0.3 (offset 0 0.5))
        idx = 1
        if idx < len(node) and isinstance(node[idx], str) and node[idx] == "oval":
            idx += 1
            if idx < len(node) and isinstance(node[idx], (int, float)):
                pad.drill_oval_x = float(node[idx])
                idx += 1
            if idx < len(node) and isinstance(node[idx], (int, float)):
                pad.drill_oval_y = float(node[idx])
                idx += 1
            pad.drill = pad.drill_oval_x
        elif idx < len(node) and isinstance(node[idx], (int, float)):
            pad.drill = float(node[idx])
            idx += 1

    def _parse_fp_text(self, node: list[Any]) -> FpText:
        """Parse a fp_text node."""
        t = FpText()
        if len(node) > 1:
            t.text_type = str(node[1])
        if len(node) > 2:
            t.text = str(node[2])

        at_node = find_node(node, "at")
        if at_node:
            t.at, t.angle = self._parse_at(at_node)

        layer_node = find_node(node, "layer")
        if layer_node:
            t.layer = str(node_value(layer_node, ""))

        # Check for hidden
        if "hide" in node:
            t.hidden = True

        effects_node = find_node(node, "effects")
        if effects_node:
            font_node = find_node(effects_node, "font")
            if font_node:
                size_node = find_node(font_node, "size")
                if size_node and len(size_node) > 2:
                    t.font_size_x = float(size_node[1])
                    t.font_size_y = float(size_node[2])
                thickness_node = find_node(font_node, "thickness")
                if thickness_node:
                    t.font_thickness = float(node_value(thickness_node, 0.15))

            # Hidden in effects
            hide_node = find_node(effects_node, "hide")
            if hide_node:
                val = node_value(hide_node, "yes")
                t.hidden = val == "yes" or val is True

        return t

    def _parse_fp_property(self, node: list[Any]) -> tuple[str, str] | None:
        """Parse a property node, return (key, value) or None."""
        if len(node) >= 3:
            return (str(node[1]), str(node[2]))
        return None

    def _parse_fp_line(self, node: list[Any]) -> FpLine:
        """Parse a fp_line node."""
        line = FpLine()
        start_node = find_node(node, "start")
        if start_node:
            line.start = self._parse_point(start_node)
        end_node = find_node(node, "end")
        if end_node:
            line.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            line.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            line.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                line.stroke_width = float(node_value(sw_node, 0.0))
        return line

    def _parse_fp_circle(self, node: list[Any]) -> FpCircle:
        """Parse a fp_circle node."""
        circle = FpCircle()
        center_node = find_node(node, "center")
        if center_node:
            circle.center = self._parse_point(center_node)
        end_node = find_node(node, "end")
        if end_node:
            circle.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            circle.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            circle.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                circle.stroke_width = float(node_value(sw_node, 0.0))
        return circle

    def _parse_fp_arc(self, node: list[Any]) -> FpArc:
        """Parse a fp_arc node."""
        arc = FpArc()
        start_node = find_node(node, "start")
        if start_node:
            arc.start = self._parse_point(start_node)
        mid_node = find_node(node, "mid")
        if mid_node:
            arc.mid = self._parse_point(mid_node)
        end_node = find_node(node, "end")
        if end_node:
            arc.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            arc.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            arc.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                arc.stroke_width = float(node_value(sw_node, 0.0))
        return arc

    def _parse_fp_poly(self, node: list[Any]) -> FpPoly:
        """Parse a fp_poly node."""
        poly = FpPoly()
        pts_node = find_node(node, "pts")
        if pts_node:
            poly.points = self._parse_pts(pts_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            poly.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            poly.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                poly.stroke_width = float(node_value(sw_node, 0.0))
        return poly

    def _parse_model(self, node: list[Any]) -> Model3D:
        """Parse a 3D model node."""
        model = Model3D()
        if len(node) > 1 and isinstance(node[1], str):
            model.path = node[1]

        offset_node = find_node(node, "offset")
        if offset_node:
            xyz_node = find_node(offset_node, "xyz")
            if xyz_node:
                model.offset = self._parse_xyz(xyz_node)

        scale_node = find_node(node, "scale")
        if scale_node:
            xyz_node = find_node(scale_node, "xyz")
            if xyz_node:
                model.scale = self._parse_xyz(xyz_node)

        rotate_node = find_node(node, "rotate")
        if rotate_node:
            xyz_node = find_node(rotate_node, "xyz")
            if xyz_node:
                model.rotate = self._parse_xyz(xyz_node)

        return model

    # ------------------------------------------------------------------
    # Trace / Via / Zone parsing
    # ------------------------------------------------------------------

    def _parse_segment(self, node: list[Any]) -> Segment:
        """Parse a segment (trace) node."""
        seg = Segment()
        start_node = find_node(node, "start")
        if start_node:
            seg.start = self._parse_point(start_node)
        end_node = find_node(node, "end")
        if end_node:
            seg.end = self._parse_point(end_node)
        width_node = find_node(node, "width")
        if width_node:
            seg.width = float(node_value(width_node, 0.25))
        layer_node = find_node(node, "layer")
        if layer_node:
            seg.layer = str(node_value(layer_node, ""))
        net_node = find_node(node, "net")
        if net_node:
            seg.net = int(node_value(net_node, 0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            seg.uuid = str(node_value(uuid_node, ""))
        return seg

    def _parse_arc(self, node: list[Any]) -> Arc:
        """Parse an arc trace node."""
        arc = Arc()
        start_node = find_node(node, "start")
        if start_node:
            arc.start = self._parse_point(start_node)
        mid_node = find_node(node, "mid")
        if mid_node:
            arc.mid = self._parse_point(mid_node)
        end_node = find_node(node, "end")
        if end_node:
            arc.end = self._parse_point(end_node)
        width_node = find_node(node, "width")
        if width_node:
            arc.width = float(node_value(width_node, 0.25))
        layer_node = find_node(node, "layer")
        if layer_node:
            arc.layer = str(node_value(layer_node, ""))
        net_node = find_node(node, "net")
        if net_node:
            arc.net = int(node_value(net_node, 0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            arc.uuid = str(node_value(uuid_node, ""))
        return arc

    def _parse_via(self, node: list[Any]) -> Via:
        """Parse a via node."""
        via = Via()
        at_node = find_node(node, "at")
        if at_node:
            via.at = self._parse_point(at_node)
        size_node = find_node(node, "size")
        if size_node:
            via.size = float(node_value(size_node, 0.6))
        drill_node = find_node(node, "drill")
        if drill_node:
            via.drill = float(node_value(drill_node, 0.3))
        layers_node = find_node(node, "layers")
        if layers_node:
            via.layers = [str(l) for l in layers_node[1:] if isinstance(l, str)]
        net_node = find_node(node, "net")
        if net_node:
            via.net = int(node_value(net_node, 0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            via.uuid = str(node_value(uuid_node, ""))

        # Via type: blind, micro, or standard (no keyword)
        if "blind" in node:
            via.via_type = "blind"
        elif "micro" in node:
            via.via_type = "micro"

        return via

    def _parse_zone(self, node: list[Any]) -> Zone:
        """Parse a zone (copper pour) node."""
        zone = Zone()

        net_node = find_node(node, "net")
        if net_node:
            zone.net = int(node_value(net_node, 0))

        net_name_node = find_node(node, "net_name")
        if net_name_node:
            zone.net_name = str(node_value(net_name_node, ""))

        layer_node = find_node(node, "layer")
        if layer_node:
            zone.layer = str(node_value(layer_node, ""))

        layers_node = find_node(node, "layers")
        if layers_node:
            zone.layers = [str(l) for l in layers_node[1:] if isinstance(l, str)]

        uuid_node = find_node(node, "uuid")
        if uuid_node:
            zone.uuid = str(node_value(uuid_node, ""))

        name_node = find_node(node, "name")
        if name_node:
            zone.name = str(node_value(name_node, ""))

        priority_node = find_node(node, "priority")
        if priority_node:
            zone.priority = int(node_value(priority_node, 0))

        # Connect pads
        cp_node = find_node(node, "connect_pads")
        if cp_node:
            # (connect_pads (clearance 0.5)) or (connect_pads thru_hole_only (clearance 0.5))
            if len(cp_node) >= 2 and isinstance(cp_node[1], str) and cp_node[1] != "clearance":
                zone.connect_pads = cp_node[1]
            clearance_sub = find_node(cp_node, "clearance")
            if clearance_sub:
                zone.connect_pads_clearance = float(node_value(clearance_sub, 0.0))

        # Min thickness
        min_thick_node = find_node(node, "min_thickness")
        if min_thick_node:
            zone.min_thickness = float(node_value(min_thick_node, 0.25))

        # Fill settings
        fill_node = find_node(node, "fill")
        if fill_node:
            zone.fill = self._parse_zone_fill(fill_node)

        # Keepout settings
        keepout_node = find_node(node, "keepout")
        if keepout_node:
            tracks_node = find_node(keepout_node, "tracks")
            if tracks_node:
                zone.keepout_tracks = str(node_value(tracks_node, ""))
            vias_node = find_node(keepout_node, "vias")
            if vias_node:
                zone.keepout_vias = str(node_value(vias_node, ""))
            pads_node = find_node(keepout_node, "pads")
            if pads_node:
                zone.keepout_pads = str(node_value(pads_node, ""))
            copperpour_node = find_node(keepout_node, "copperpour")
            if copperpour_node:
                zone.keepout_copperpour = str(node_value(copperpour_node, ""))
            footprints_node = find_node(keepout_node, "footprints")
            if footprints_node:
                zone.keepout_footprints = str(node_value(footprints_node, ""))

        # Polygon outlines
        for poly_node in find_nodes(node, "polygon"):
            zone.polygons.append(self._parse_zone_polygon(poly_node))

        # Filled polygons
        for fill_poly_node in find_nodes(node, "filled_polygon"):
            zone.fill_polygons.append(self._parse_zone_polygon(fill_poly_node))

        return zone

    def _parse_zone_fill(self, node: list[Any]) -> ZoneFill:
        """Parse zone fill settings."""
        fill = ZoneFill()

        # (fill yes ...) or (fill (thermal_gap 0.5) ...)
        if len(node) >= 2 and node[1] == "yes":
            fill.filled = True
        elif len(node) >= 2 and node[1] == "no":
            fill.filled = False

        tg_node = find_node(node, "thermal_gap")
        if tg_node:
            fill.thermal_gap = float(node_value(tg_node, 0.5))

        tbw_node = find_node(node, "thermal_bridge_width")
        if tbw_node:
            fill.thermal_bridge_width = float(node_value(tbw_node, 0.5))

        # Hatch fill
        hatch_thick = find_node(node, "hatch_thickness")
        if hatch_thick:
            fill.hatch_thickness = float(node_value(hatch_thick, 0.0))
            fill.fill_type = ZoneFillType.HATCHED

        hatch_gap_node = find_node(node, "hatch_gap")
        if hatch_gap_node:
            fill.hatch_gap = float(node_value(hatch_gap_node, 0.0))

        hatch_orient = find_node(node, "hatch_orientation")
        if hatch_orient:
            fill.hatch_orientation = float(node_value(hatch_orient, 0.0))

        smoothing_node = find_node(node, "smoothing")
        if smoothing_node:
            fill.smoothing = str(node_value(smoothing_node, ""))

        radius_node = find_node(node, "radius")
        if radius_node:
            fill.smoothing_radius = float(node_value(radius_node, 0.0))

        island_node = find_node(node, "island_removal_mode")
        if island_node:
            fill.island_removal_mode = int(node_value(island_node, 0))

        island_area = find_node(node, "island_area_min")
        if island_area:
            fill.island_area_min = float(node_value(island_area, 0.0))

        return fill

    def _parse_zone_polygon(self, node: list[Any]) -> ZonePolygon:
        """Parse a zone polygon (outline or filled)."""
        poly = ZonePolygon()
        pts_node = find_node(node, "pts")
        if pts_node:
            poly.points = self._parse_pts(pts_node)
        return poly

    # ------------------------------------------------------------------
    # Graphical items
    # ------------------------------------------------------------------

    def _parse_gr_line(self, node: list[Any]) -> GrLine:
        """Parse a gr_line node."""
        line = GrLine()
        start_node = find_node(node, "start")
        if start_node:
            line.start = self._parse_point(start_node)
        end_node = find_node(node, "end")
        if end_node:
            line.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            line.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            line.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                line.stroke_width = float(node_value(sw_node, 0.0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            line.uuid = str(node_value(uuid_node, ""))
        return line

    def _parse_gr_arc(self, node: list[Any]) -> GrArc:
        """Parse a gr_arc node."""
        arc = GrArc()
        start_node = find_node(node, "start")
        if start_node:
            arc.start = self._parse_point(start_node)
        mid_node = find_node(node, "mid")
        if mid_node:
            arc.mid = self._parse_point(mid_node)
        end_node = find_node(node, "end")
        if end_node:
            arc.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            arc.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            arc.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                arc.stroke_width = float(node_value(sw_node, 0.0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            arc.uuid = str(node_value(uuid_node, ""))
        return arc

    def _parse_gr_circle(self, node: list[Any]) -> GrCircle:
        """Parse a gr_circle node."""
        circle = GrCircle()
        center_node = find_node(node, "center")
        if center_node:
            circle.center = self._parse_point(center_node)
        end_node = find_node(node, "end")
        if end_node:
            circle.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            circle.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            circle.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                circle.stroke_width = float(node_value(sw_node, 0.0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            circle.uuid = str(node_value(uuid_node, ""))
        return circle

    def _parse_gr_rect(self, node: list[Any]) -> GrRect:
        """Parse a gr_rect node."""
        rect = GrRect()
        start_node = find_node(node, "start")
        if start_node:
            rect.start = self._parse_point(start_node)
        end_node = find_node(node, "end")
        if end_node:
            rect.end = self._parse_point(end_node)
        layer_node = find_node(node, "layer")
        if layer_node:
            rect.layer = str(node_value(layer_node, ""))
        width_node = find_node(node, "width")
        if width_node:
            rect.width = float(node_value(width_node, 0.0))
        stroke_node = find_node(node, "stroke")
        if stroke_node:
            sw_node = find_node(stroke_node, "width")
            if sw_node:
                rect.stroke_width = float(node_value(sw_node, 0.0))
        uuid_node = find_node(node, "uuid")
        if uuid_node:
            rect.uuid = str(node_value(uuid_node, ""))
        return rect

    # ------------------------------------------------------------------
    # Utility helpers
    # ------------------------------------------------------------------

    def _parse_at(self, node: list[Any]) -> tuple[Point2D, float]:
        """Parse an (at x y [angle]) node, returning (point, angle)."""
        x = float(node[1]) if len(node) > 1 else 0.0
        y = float(node[2]) if len(node) > 2 else 0.0
        angle = float(node[3]) if len(node) > 3 else 0.0
        return Point2D(x=x, y=y), angle

    def _parse_point(self, node: list[Any]) -> Point2D:
        """Parse a (tag x y) node as a Point2D."""
        x = float(node[1]) if len(node) > 1 else 0.0
        y = float(node[2]) if len(node) > 2 else 0.0
        return Point2D(x=x, y=y)

    def _parse_xyz(self, node: list[Any]) -> Point3D:
        """Parse an (xyz x y z) node."""
        x = float(node[1]) if len(node) > 1 else 0.0
        y = float(node[2]) if len(node) > 2 else 0.0
        z = float(node[3]) if len(node) > 3 else 0.0
        return Point3D(x=x, y=y, z=z)

    def _parse_pts(self, node: list[Any]) -> list[Point2D]:
        """Parse a (pts (xy x y) (xy x y) ...) node."""
        points: list[Point2D] = []
        for item in node[1:]:
            if isinstance(item, list) and item and item[0] == "xy":
                x = float(item[1]) if len(item) > 1 else 0.0
                y = float(item[2]) if len(item) > 2 else 0.0
                points.append(Point2D(x=x, y=y))
        return points

    @staticmethod
    def _map_pad_type(s: str) -> PadType:
        """Map a KiCad pad type string to PadType enum."""
        mapping = {
            "smd": PadType.SMD,
            "thru_hole": PadType.THRU_HOLE,
            "connect": PadType.CONNECT,
            "np_thru_hole": PadType.NP_THRU_HOLE,
        }
        return mapping.get(s, PadType.SMD)

    @staticmethod
    def _map_pad_shape(s: str) -> PadShape:
        """Map a KiCad pad shape string to PadShape enum."""
        mapping = {
            "circle": PadShape.CIRCLE,
            "rect": PadShape.RECT,
            "oval": PadShape.OVAL,
            "trapezoid": PadShape.TRAPEZOID,
            "roundrect": PadShape.ROUNDRECT,
            "custom": PadShape.CUSTOM,
        }
        return mapping.get(s, PadShape.RECT)
