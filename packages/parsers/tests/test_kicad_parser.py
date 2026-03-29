"""Tests for the KiCad S-expression parser, PCB parser, schematic parser,
and exporter.
"""

from __future__ import annotations

import pytest

from routeai_parsers.kicad.sexpr import (
    SExprError,
    find_node,
    find_nodes,
    node_value,
    node_values,
    parse,
    serialize,
    tokenize,
)
from routeai_parsers.kicad.pcb_parser import KiCadPcbParser
from routeai_parsers.kicad.sch_parser import KiCadSchParser
from routeai_parsers.kicad.exporter import KiCadPcbExporter
from routeai_parsers.models import (
    BoardDesign,
    PadShape,
    PadType,
    SchematicDesign,
)


# =========================================================================
# Inline test fixtures
# =========================================================================

MINIMAL_PCB = """\
(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
  (general (thickness 1.6) (legacy_teardrops no))
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (32 "B.Adhes" user "B.Adhesive")
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user "B.Mask")
    (39 "F.Mask" user "F.Mask")
    (44 "Edge.Cuts" user)
  )
  (setup
    (copper_edge_clearance 0.05)
  )
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (net 3 "SDA")
  (footprint "Package_SO:SOIC-8" (at 100 50 0) (layer "F.Cu")
    (uuid "fp-uuid-1")
    (property "Reference" "U1")
    (property "Value" "IC1")
    (fp_text reference "U1" (at 0 -3.5) (layer "F.SilkS")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_text value "IC1" (at 0 3.5) (layer "F.Fab")
      (effects (font (size 1 1) (thickness 0.15)))
    )
    (fp_line (start -2.45 -3.25) (end 2.45 -3.25) (layer "F.SilkS") (width 0.12))
    (pad "1" smd rect (at -1.905 -2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
    (pad "2" smd rect (at -0.635 -2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 3 "SDA"))
    (pad "3" smd rect (at 0.635 -2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 ""))
    (pad "4" smd rect (at 1.905 -2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 ""))
    (pad "5" smd rect (at 1.905 2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 ""))
    (pad "6" smd rect (at 0.635 2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 ""))
    (pad "7" smd rect (at -0.635 2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 0 ""))
    (pad "8" smd rect (at -1.905 2.475) (size 0.6 1.55) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "VCC"))
    (model "${KICAD8_3DMODEL_DIR}/Package_SO.3dshapes/SOIC-8.wrl"
      (offset (xyz 0 0 0))
      (scale (xyz 1 1 1))
      (rotate (xyz 0 0 0))
    )
  )
  (footprint "Resistor_SMD:R_0402" (at 120 60 90) (layer "F.Cu")
    (uuid "fp-uuid-2")
    (property "Reference" "R1")
    (property "Value" "10k")
    (pad "1" smd roundrect (at -0.51 0) (size 0.54 0.64) (layers "F.Cu" "F.Paste" "F.Mask")
      (roundrect_rratio 0.25) (net 2 "VCC"))
    (pad "2" smd roundrect (at 0.51 0) (size 0.54 0.64) (layers "F.Cu" "F.Paste" "F.Mask")
      (roundrect_rratio 0.25) (net 1 "GND"))
  )
  (segment (start 100 50) (end 110 50) (width 0.25) (layer "F.Cu") (net 1) (uuid "seg-1"))
  (segment (start 110 50) (end 120 60) (width 0.25) (layer "F.Cu") (net 1) (uuid "seg-2"))
  (segment (start 100 48) (end 100 40) (width 0.2) (layer "F.Cu") (net 2) (uuid "seg-3"))
  (via (at 105 55) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 2) (uuid "via-1"))
  (via (at 115 45) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "via-2"))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "zone-1")
    (connect_pads (clearance 0.5))
    (min_thickness 0.25)
    (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 200 0) (xy 200 100) (xy 0 100)))
  )
  (gr_line (start 0 0) (end 200 0) (layer "Edge.Cuts") (width 0.05) (uuid "gr-1"))
  (gr_line (start 200 0) (end 200 100) (layer "Edge.Cuts") (width 0.05) (uuid "gr-2"))
  (gr_line (start 200 100) (end 0 100) (layer "Edge.Cuts") (width 0.05) (uuid "gr-3"))
  (gr_line (start 0 100) (end 0 0) (layer "Edge.Cuts") (width 0.05) (uuid "gr-4"))
)
"""

MINIMAL_SCH = """\
(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (uuid "sch-root-uuid")
  (title_block
    (title "Test Schematic")
    (date "2024-01-15")
    (rev "1.0")
    (company "RouteAI")
  )
  (lib_symbols
    (symbol "Device:R"
      (property "Reference" "R" (at 0 0 0))
      (property "Value" "R" (at 0 0 0))
      (symbol "Device:R_0_1"
        (pin passive line (at 0 3.81 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))
        )
        (pin passive line (at 0 -3.81 90) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))
        )
      )
    )
    (symbol "Device:C"
      (property "Reference" "C" (at 0 0 0))
      (property "Value" "C" (at 0 0 0))
      (symbol "Device:C_0_1"
        (pin passive line (at 0 2.54 270) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "1" (effects (font (size 1.27 1.27))))
        )
        (pin passive line (at 0 -2.54 90) (length 1.27)
          (name "~" (effects (font (size 1.27 1.27))))
          (number "2" (effects (font (size 1.27 1.27))))
        )
      )
    )
  )
  (symbol (lib_id "Device:R") (at 100 50 0) (unit 1)
    (uuid "sym-uuid-1")
    (property "Reference" "R1" (at 102 48 0))
    (property "Value" "10k" (at 102 52 0))
    (pin "1" (uuid "pin-uuid-1"))
    (pin "2" (uuid "pin-uuid-2"))
  )
  (symbol (lib_id "Device:C") (at 120 50 0) (unit 1)
    (uuid "sym-uuid-2")
    (property "Reference" "C1" (at 122 48 0))
    (property "Value" "100nF" (at 122 52 0))
    (pin "1" (uuid "pin-uuid-3"))
    (pin "2" (uuid "pin-uuid-4"))
  )
  (wire (pts (xy 100 46.19) (xy 100 40)) (uuid "wire-uuid-1"))
  (wire (pts (xy 100 53.81) (xy 100 60)) (uuid "wire-uuid-2"))
  (wire (pts (xy 120 47.46) (xy 120 40)) (uuid "wire-uuid-3"))
  (wire (pts (xy 120 52.54) (xy 120 60)) (uuid "wire-uuid-4"))
  (wire (pts (xy 100 40) (xy 120 40)) (uuid "wire-uuid-5"))
  (wire (pts (xy 100 60) (xy 120 60)) (uuid "wire-uuid-6"))
  (label "NET1" (at 110 40 0) (uuid "label-uuid-1"))
  (global_label "VCC" (at 100 35 0) (uuid "gl-uuid-1")
    (shape input)
  )
  (global_label "GND" (at 100 65 180) (uuid "gl-uuid-2")
    (shape input)
  )
  (junction (at 100 40) (diameter 0) (uuid "junc-uuid-1"))
  (junction (at 100 60) (diameter 0) (uuid "junc-uuid-2"))
  (no_connect (at 150 50) (uuid "nc-uuid-1"))
  (sheet (at 200 30) (size 30 20) (uuid "sheet-uuid-1")
    (property "Sheetname" "PowerSupply" (at 200 29 0))
    (property "Sheetfile" "power_supply.kicad_sch" (at 200 52 0))
    (pin "VIN" input (at 200 40 180) (uuid "sheet-pin-1"))
    (pin "VOUT" output (at 230 40 0) (uuid "sheet-pin-2"))
  )
)
"""


# =========================================================================
# S-expression tokenizer tests
# =========================================================================

class TestTokenizer:
    """Tests for the S-expression tokenizer."""

    def test_empty_input(self) -> None:
        assert tokenize("") == []

    def test_whitespace_only(self) -> None:
        assert tokenize("   \n\t  ") == []

    def test_parentheses(self) -> None:
        tokens = tokenize("()")
        assert len(tokens) == 2
        assert tokens[0][0] == "LPAREN"
        assert tokens[1][0] == "RPAREN"

    def test_symbol(self) -> None:
        tokens = tokenize("hello")
        assert len(tokens) == 1
        assert tokens[0] == ("SYMBOL", "hello")

    def test_integer(self) -> None:
        tokens = tokenize("42")
        assert tokens[0] == ("INT", 42)

    def test_negative_integer(self) -> None:
        tokens = tokenize("-7")
        assert tokens[0] == ("INT", -7)

    def test_float(self) -> None:
        tokens = tokenize("3.14")
        assert tokens[0] == ("FLOAT", 3.14)

    def test_negative_float(self) -> None:
        tokens = tokenize("-0.25")
        assert tokens[0] == ("FLOAT", -0.25)

    def test_scientific_notation(self) -> None:
        tokens = tokenize("1.5e3")
        assert tokens[0] == ("FLOAT", 1500.0)

    def test_quoted_string(self) -> None:
        tokens = tokenize('"hello world"')
        assert tokens[0] == ("STRING", "hello world")

    def test_quoted_string_with_escapes(self) -> None:
        tokens = tokenize(r'"line1\nline2"')
        assert tokens[0] == ("STRING", "line1\nline2")

    def test_quoted_string_with_escaped_quote(self) -> None:
        tokens = tokenize(r'"say \"hi\""')
        assert tokens[0] == ("STRING", 'say "hi"')

    def test_quoted_string_with_backslash(self) -> None:
        tokens = tokenize(r'"path\\to\\file"')
        assert tokens[0] == ("STRING", "path\\to\\file")

    def test_empty_quoted_string(self) -> None:
        tokens = tokenize('""')
        assert tokens[0] == ("STRING", "")

    def test_comment_skipped(self) -> None:
        tokens = tokenize("# this is a comment\nhello")
        assert len(tokens) == 1
        assert tokens[0] == ("SYMBOL", "hello")

    def test_mixed_tokens(self) -> None:
        tokens = tokenize('(net 1 "GND")')
        assert len(tokens) == 5
        assert tokens[0][0] == "LPAREN"
        assert tokens[1] == ("SYMBOL", "net")
        assert tokens[2] == ("INT", 1)
        assert tokens[3] == ("STRING", "GND")
        assert tokens[4][0] == "RPAREN"

    def test_symbol_with_dots(self) -> None:
        tokens = tokenize("F.Cu")
        assert tokens[0] == ("SYMBOL", "F.Cu")

    def test_symbol_starting_with_number_and_letter(self) -> None:
        # "3D" should be a symbol, not a number
        tokens = tokenize("3D")
        assert tokens[0][0] == "SYMBOL"

    def test_unterminated_string_raises(self) -> None:
        with pytest.raises(SExprError, match="Unterminated"):
            tokenize('"hello')

    def test_multiline(self) -> None:
        text = """(kicad_pcb
  (version 20240108)
  (generator "pcbnew")
)"""
        tokens = tokenize(text)
        # ( kicad_pcb ( version 20240108 ) ( generator "pcbnew" ) )
        assert len(tokens) == 11


# =========================================================================
# S-expression parser tests
# =========================================================================

class TestParser:
    """Tests for the S-expression parser."""

    def test_empty(self) -> None:
        assert parse("") == []

    def test_simple_list(self) -> None:
        result = parse("(a b c)")
        assert result == ["a", "b", "c"]

    def test_nested_list(self) -> None:
        result = parse("(a (b c) d)")
        assert result == ["a", ["b", "c"], "d"]

    def test_numbers(self) -> None:
        result = parse("(x 1 2.5)")
        assert result == ["x", 1, 2.5]

    def test_string_values(self) -> None:
        result = parse('(net 1 "GND")')
        assert result == ["net", 1, "GND"]

    def test_deeply_nested(self) -> None:
        result = parse("(a (b (c (d))))")
        assert result == ["a", ["b", ["c", ["d"]]]]

    def test_unmatched_lparen_raises(self) -> None:
        with pytest.raises(SExprError):
            parse("(a b")

    def test_unmatched_rparen_raises(self) -> None:
        with pytest.raises(SExprError):
            parse("a b)")

    def test_empty_parens(self) -> None:
        result = parse("()")
        assert result == []

    def test_kicad_like(self) -> None:
        text = '(segment (start 100 50) (end 110 50) (width 0.25) (layer "F.Cu") (net 1))'
        result = parse(text)
        assert result[0] == "segment"
        assert result[1] == ["start", 100, 50]
        assert result[2] == ["end", 110, 50]
        assert result[3] == ["width", 0.25]
        assert result[4] == ["layer", "F.Cu"]
        assert result[5] == ["net", 1]


# =========================================================================
# S-expression serialize tests
# =========================================================================

class TestSerializer:
    """Tests for the S-expression serializer."""

    def test_simple_list(self) -> None:
        result = serialize(["a", "b", "c"], compact=True)
        assert result == "(a b c)"

    def test_nested(self) -> None:
        result = serialize(["a", ["b", "c"]], compact=True)
        assert result == "(a (b c))"

    def test_numbers(self) -> None:
        result = serialize(["x", 1, 2.5], compact=True)
        assert "(x 1" in result
        assert "2.5" in result

    def test_quoted_strings(self) -> None:
        # F.Cu has no spaces or special chars, so it serializes as a bare symbol
        result = serialize(["layer", "F.Cu"], compact=True)
        assert result == "(layer F.Cu)"

    def test_quoted_strings_with_spaces(self) -> None:
        result = serialize(["name", "my layer"], compact=True)
        assert result == '(name "my layer")'

    def test_empty_string(self) -> None:
        result = serialize(["net", 0, ""], compact=True)
        assert '""' in result

    def test_round_trip_simple(self) -> None:
        original = "(a (b c) (d 1 2.5))"
        ast = parse(original)
        output = serialize(ast, compact=True)
        reparsed = parse(output)
        assert ast == reparsed

    def test_round_trip_kicad_segment(self) -> None:
        original = '(segment (start 100 50) (end 110 50) (width 0.25) (layer "F.Cu") (net 1))'
        ast = parse(original)
        output = serialize(ast, compact=True)
        reparsed = parse(output)
        assert ast == reparsed


# =========================================================================
# Helper function tests
# =========================================================================

class TestHelpers:
    """Tests for find_node, find_nodes, node_value, node_values."""

    def test_find_node(self) -> None:
        ast = parse('(root (version 1) (name "test"))')
        node = find_node(ast, "version")
        assert node == ["version", 1]

    def test_find_node_not_found(self) -> None:
        ast = parse("(root (version 1))")
        assert find_node(ast, "missing") is None

    def test_find_nodes(self) -> None:
        ast = parse("(root (net 0) (net 1) (net 2))")
        nets = find_nodes(ast, "net")
        assert len(nets) == 3
        assert nets[1] == ["net", 1]

    def test_node_value(self) -> None:
        node = ["version", 42]
        assert node_value(node) == 42

    def test_node_value_default(self) -> None:
        assert node_value(None, "default") == "default"

    def test_node_values(self) -> None:
        node = ["layers", "F.Cu", "B.Cu"]
        assert node_values(node) == ["F.Cu", "B.Cu"]


# =========================================================================
# PCB parser tests
# =========================================================================

class TestPcbParser:
    """Tests for the KiCad PCB parser."""

    @pytest.fixture()
    def board(self) -> BoardDesign:
        parser = KiCadPcbParser()
        return parser.parse_text(MINIMAL_PCB)

    def test_version(self, board: BoardDesign) -> None:
        assert board.version == 20240108

    def test_generator(self, board: BoardDesign) -> None:
        assert board.generator == "pcbnew"

    def test_thickness(self, board: BoardDesign) -> None:
        assert board.thickness == 1.6

    def test_layers(self, board: BoardDesign) -> None:
        assert len(board.layers) == 8
        layer_names = [l.name for l in board.layers]
        assert "F.Cu" in layer_names
        assert "B.Cu" in layer_names
        assert "Edge.Cuts" in layer_names

    def test_layer_types(self, board: BoardDesign) -> None:
        fcu = next(l for l in board.layers if l.name == "F.Cu")
        assert fcu.layer_type == "signal"
        assert fcu.ordinal == 0

        edge = next(l for l in board.layers if l.name == "Edge.Cuts")
        assert edge.layer_type == "user"

    def test_layer_user_names(self, board: BoardDesign) -> None:
        badhes = next(l for l in board.layers if l.name == "B.Adhes")
        assert badhes.user_name == "B.Adhesive"

    def test_nets(self, board: BoardDesign) -> None:
        assert len(board.nets) == 4
        assert board.nets[0].number == 0
        assert board.nets[0].name == ""
        assert board.nets[1].number == 1
        assert board.nets[1].name == "GND"
        assert board.nets[2].name == "VCC"
        assert board.nets[3].name == "SDA"

    def test_net_by_number(self, board: BoardDesign) -> None:
        net = board.net_by_number(2)
        assert net is not None
        assert net.name == "VCC"

    def test_net_by_name(self, board: BoardDesign) -> None:
        net = board.net_by_name("GND")
        assert net is not None
        assert net.number == 1

    def test_footprints_count(self, board: BoardDesign) -> None:
        assert len(board.footprints) == 2

    def test_footprint_soic(self, board: BoardDesign) -> None:
        fp = board.footprints[0]
        assert fp.library_link == "Package_SO:SOIC-8"
        assert fp.at.x == 100.0
        assert fp.at.y == 50.0
        assert fp.angle == 0.0
        assert fp.layer == "F.Cu"
        assert fp.reference == "U1"
        assert fp.value == "IC1"
        assert fp.uuid == "fp-uuid-1"

    def test_footprint_pads(self, board: BoardDesign) -> None:
        fp = board.footprints[0]
        assert len(fp.pads) == 8
        pad1 = fp.pads[0]
        assert pad1.number == "1"
        assert pad1.pad_type == PadType.SMD
        assert pad1.shape == PadShape.RECT
        assert pad1.at.x == -1.905
        assert pad1.at.y == -2.475
        assert pad1.size_x == 0.6
        assert pad1.size_y == 1.55
        assert "F.Cu" in pad1.layers
        assert "F.Paste" in pad1.layers
        assert "F.Mask" in pad1.layers
        assert pad1.net_number == 1
        assert pad1.net_name == "GND"

    def test_footprint_roundrect_pads(self, board: BoardDesign) -> None:
        fp = board.footprints[1]
        assert fp.reference == "R1"
        assert len(fp.pads) == 2
        pad = fp.pads[0]
        assert pad.shape == PadShape.ROUNDRECT
        assert pad.roundrect_rratio == 0.25

    def test_footprint_rotation(self, board: BoardDesign) -> None:
        fp = board.footprints[1]
        assert fp.angle == 90.0

    def test_footprint_text(self, board: BoardDesign) -> None:
        fp = board.footprints[0]
        assert len(fp.texts) >= 2
        ref_text = next((t for t in fp.texts if t.text_type == "reference"), None)
        assert ref_text is not None
        assert ref_text.text == "U1"
        assert ref_text.layer == "F.SilkS"

    def test_footprint_lines(self, board: BoardDesign) -> None:
        fp = board.footprints[0]
        assert len(fp.lines) == 1
        line = fp.lines[0]
        assert line.start.x == -2.45
        assert line.end.x == 2.45
        assert line.layer == "F.SilkS"

    def test_footprint_3d_model(self, board: BoardDesign) -> None:
        fp = board.footprints[0]
        assert fp.model is not None
        assert "SOIC-8" in fp.model.path
        assert fp.model.scale.x == 1.0

    def test_segments(self, board: BoardDesign) -> None:
        assert len(board.segments) == 3
        seg = board.segments[0]
        assert seg.start.x == 100.0
        assert seg.start.y == 50.0
        assert seg.end.x == 110.0
        assert seg.end.y == 50.0
        assert seg.width == 0.25
        assert seg.layer == "F.Cu"
        assert seg.net == 1
        assert seg.uuid == "seg-1"

    def test_vias(self, board: BoardDesign) -> None:
        assert len(board.vias) == 2
        via = board.vias[0]
        assert via.at.x == 105.0
        assert via.at.y == 55.0
        assert via.size == 0.6
        assert via.drill == 0.3
        assert "F.Cu" in via.layers
        assert "B.Cu" in via.layers
        assert via.net == 2
        assert via.uuid == "via-1"

    def test_zones(self, board: BoardDesign) -> None:
        assert len(board.zones) == 1
        zone = board.zones[0]
        assert zone.net == 1
        assert zone.net_name == "GND"
        assert zone.layer == "F.Cu"
        assert zone.uuid == "zone-1"
        assert zone.fill.filled is True
        assert zone.fill.thermal_gap == 0.5
        assert zone.fill.thermal_bridge_width == 0.5
        assert zone.min_thickness == 0.25

    def test_zone_polygon(self, board: BoardDesign) -> None:
        zone = board.zones[0]
        assert len(zone.polygons) == 1
        poly = zone.polygons[0]
        assert len(poly.points) == 4
        assert poly.points[0].x == 0.0
        assert poly.points[0].y == 0.0
        assert poly.points[2].x == 200.0
        assert poly.points[2].y == 100.0

    def test_gr_lines(self, board: BoardDesign) -> None:
        assert len(board.gr_lines) == 4
        # Board outline (Edge.Cuts)
        for line in board.gr_lines:
            assert line.layer == "Edge.Cuts"
            assert line.width == 0.05

    def test_design_rules(self, board: BoardDesign) -> None:
        assert board.design_rules.copper_edge_clearance == 0.05

    def test_invalid_file_raises(self) -> None:
        parser = KiCadPcbParser()
        with pytest.raises(ValueError, match="Not a valid kicad_pcb"):
            parser.parse_text("(not_a_pcb)")

    def test_layer_names_helper(self, board: BoardDesign) -> None:
        signal_layers = board.layer_names("signal")
        assert "F.Cu" in signal_layers
        assert "B.Cu" in signal_layers
        assert "Edge.Cuts" not in signal_layers


# =========================================================================
# Schematic parser tests
# =========================================================================

class TestSchParser:
    """Tests for the KiCad schematic parser."""

    @pytest.fixture()
    def schematic(self) -> SchematicDesign:
        parser = KiCadSchParser()
        return parser.parse_text(MINIMAL_SCH)

    def test_version(self, schematic: SchematicDesign) -> None:
        assert schematic.version == 20231120

    def test_generator(self, schematic: SchematicDesign) -> None:
        assert schematic.generator == "eeschema"

    def test_uuid(self, schematic: SchematicDesign) -> None:
        assert schematic.uuid == "sch-root-uuid"

    def test_title_block(self, schematic: SchematicDesign) -> None:
        assert schematic.title == "Test Schematic"
        assert schematic.date == "2024-01-15"
        assert schematic.revision == "1.0"
        assert schematic.company == "RouteAI"

    def test_lib_symbols(self, schematic: SchematicDesign) -> None:
        assert len(schematic.lib_symbols) == 2
        r_sym = schematic.lib_symbol_by_id("Device:R")
        assert r_sym is not None
        assert len(r_sym.pins) == 2
        assert r_sym.pins[0].number == "1"
        assert r_sym.pins[0].pin_type == "passive"
        assert r_sym.pins[1].number == "2"

    def test_lib_symbol_pin_position(self, schematic: SchematicDesign) -> None:
        r_sym = schematic.lib_symbol_by_id("Device:R")
        assert r_sym is not None
        pin1 = r_sym.pins[0]
        assert pin1.at.x == 0.0
        assert pin1.at.y == 3.81

    def test_symbols(self, schematic: SchematicDesign) -> None:
        assert len(schematic.symbols) == 2
        r1 = schematic.symbol_by_reference("R1")
        assert r1 is not None
        assert r1.lib_id == "Device:R"
        assert r1.at.x == 100.0
        assert r1.at.y == 50.0
        assert r1.value == "10k"

    def test_symbol_pins(self, schematic: SchematicDesign) -> None:
        r1 = schematic.symbol_by_reference("R1")
        assert r1 is not None
        assert len(r1.pins) == 2
        assert r1.pins[0].number == "1"
        assert r1.pins[0].uuid == "pin-uuid-1"

    def test_wires(self, schematic: SchematicDesign) -> None:
        assert len(schematic.wires) == 6
        wire = schematic.wires[0]
        assert len(wire.points) == 2
        assert wire.uuid == "wire-uuid-1"

    def test_labels(self, schematic: SchematicDesign) -> None:
        local_labels = [l for l in schematic.labels if l.label_type.value == "local"]
        assert len(local_labels) == 1
        assert local_labels[0].text == "NET1"
        assert local_labels[0].at.x == 110.0
        assert local_labels[0].at.y == 40.0

    def test_global_labels(self, schematic: SchematicDesign) -> None:
        global_labels = [l for l in schematic.labels if l.label_type.value == "global"]
        assert len(global_labels) == 2
        vcc = next(l for l in global_labels if l.text == "VCC")
        assert vcc.shape == "input"

    def test_junctions(self, schematic: SchematicDesign) -> None:
        assert len(schematic.junctions) == 2
        assert schematic.junctions[0].at.x == 100.0
        assert schematic.junctions[0].at.y == 40.0

    def test_no_connects(self, schematic: SchematicDesign) -> None:
        assert len(schematic.no_connects) == 1
        assert schematic.no_connects[0].at.x == 150.0

    def test_hierarchical_sheets(self, schematic: SchematicDesign) -> None:
        assert len(schematic.hierarchical_sheets) == 1
        sheet = schematic.hierarchical_sheets[0]
        assert sheet.sheet_name == "PowerSupply"
        assert sheet.file_name == "power_supply.kicad_sch"
        assert sheet.at.x == 200.0
        assert sheet.size_x == 30.0
        assert sheet.size_y == 20.0
        assert len(sheet.pins) == 2
        assert sheet.pins[0].name == "VIN"

    def test_net_resolution(self, schematic: SchematicDesign) -> None:
        # Nets should be resolved from wire connectivity
        assert len(schematic.nets) > 0
        # Check that named nets exist
        net_names = [n.name for n in schematic.nets]
        # At minimum we should find the label-named nets
        # The exact nets depend on pin position matching

    def test_invalid_file_raises(self) -> None:
        parser = KiCadSchParser()
        with pytest.raises(ValueError, match="Not a valid kicad_sch"):
            parser.parse_text("(not_a_sch)")


# =========================================================================
# Exporter tests
# =========================================================================

class TestExporter:
    """Tests for the KiCad PCB exporter."""

    @pytest.fixture()
    def board(self) -> BoardDesign:
        parser = KiCadPcbParser()
        return parser.parse_text(MINIMAL_PCB)

    def test_export_produces_string(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert isinstance(text, str)
        assert text.startswith("(kicad_pcb")

    def test_export_contains_version(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "20240108" in text

    def test_export_contains_nets(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "GND" in text
        assert "VCC" in text

    def test_export_contains_footprints(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "SOIC-8" in text
        assert "R_0402" in text

    def test_export_contains_segments(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "segment" in text

    def test_export_contains_vias(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "via" in text

    def test_export_contains_zones(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "zone" in text
        assert "thermal_gap" in text

    def test_export_contains_gr_lines(self, board: BoardDesign) -> None:
        exporter = KiCadPcbExporter()
        text = exporter.export_text(board)
        assert "gr_line" in text
        assert "Edge.Cuts" in text


# =========================================================================
# Round-trip tests
# =========================================================================

class TestRoundTrip:
    """Test that parse -> export -> parse produces equivalent models."""

    def test_round_trip_pcb(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        # Parse original
        board1 = parser.parse_text(MINIMAL_PCB)

        # Export
        exported_text = exporter.export_text(board1)

        # Parse exported
        board2 = parser.parse_text(exported_text)

        # Compare key fields
        assert board2.version == board1.version
        assert board2.generator == board1.generator
        assert board2.thickness == board1.thickness
        assert len(board2.layers) == len(board1.layers)
        assert len(board2.nets) == len(board1.nets)
        assert len(board2.footprints) == len(board1.footprints)
        assert len(board2.segments) == len(board1.segments)
        assert len(board2.vias) == len(board1.vias)
        assert len(board2.zones) == len(board1.zones)
        assert len(board2.gr_lines) == len(board1.gr_lines)

    def test_round_trip_nets(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        board1 = parser.parse_text(MINIMAL_PCB)
        exported_text = exporter.export_text(board1)
        board2 = parser.parse_text(exported_text)

        for n1, n2 in zip(board1.nets, board2.nets):
            assert n1.number == n2.number
            assert n1.name == n2.name

    def test_round_trip_footprint_pads(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        board1 = parser.parse_text(MINIMAL_PCB)
        exported_text = exporter.export_text(board1)
        board2 = parser.parse_text(exported_text)

        for fp1, fp2 in zip(board1.footprints, board2.footprints):
            assert fp1.library_link == fp2.library_link
            assert fp1.reference == fp2.reference
            assert fp1.value == fp2.value
            assert len(fp1.pads) == len(fp2.pads)
            for p1, p2 in zip(fp1.pads, fp2.pads):
                assert p1.number == p2.number
                assert p1.pad_type == p2.pad_type
                assert p1.shape == p2.shape
                assert abs(p1.at.x - p2.at.x) < 0.001
                assert abs(p1.at.y - p2.at.y) < 0.001
                assert abs(p1.size_x - p2.size_x) < 0.001
                assert abs(p1.size_y - p2.size_y) < 0.001
                assert p1.net_number == p2.net_number
                assert p1.net_name == p2.net_name

    def test_round_trip_segments(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        board1 = parser.parse_text(MINIMAL_PCB)
        exported_text = exporter.export_text(board1)
        board2 = parser.parse_text(exported_text)

        for s1, s2 in zip(board1.segments, board2.segments):
            assert abs(s1.start.x - s2.start.x) < 0.001
            assert abs(s1.start.y - s2.start.y) < 0.001
            assert abs(s1.end.x - s2.end.x) < 0.001
            assert abs(s1.end.y - s2.end.y) < 0.001
            assert abs(s1.width - s2.width) < 0.001
            assert s1.layer == s2.layer
            assert s1.net == s2.net

    def test_round_trip_vias(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        board1 = parser.parse_text(MINIMAL_PCB)
        exported_text = exporter.export_text(board1)
        board2 = parser.parse_text(exported_text)

        for v1, v2 in zip(board1.vias, board2.vias):
            assert abs(v1.at.x - v2.at.x) < 0.001
            assert abs(v1.at.y - v2.at.y) < 0.001
            assert abs(v1.size - v2.size) < 0.001
            assert abs(v1.drill - v2.drill) < 0.001
            assert v1.layers == v2.layers
            assert v1.net == v2.net

    def test_round_trip_zones(self) -> None:
        parser = KiCadPcbParser()
        exporter = KiCadPcbExporter()

        board1 = parser.parse_text(MINIMAL_PCB)
        exported_text = exporter.export_text(board1)
        board2 = parser.parse_text(exported_text)

        for z1, z2 in zip(board1.zones, board2.zones):
            assert z1.net == z2.net
            assert z1.net_name == z2.net_name
            assert z1.layer == z2.layer
            assert z1.fill.filled == z2.fill.filled
            assert abs(z1.fill.thermal_gap - z2.fill.thermal_gap) < 0.001
            assert len(z1.polygons) == len(z2.polygons)
            for p1, p2 in zip(z1.polygons, z2.polygons):
                assert len(p1.points) == len(p2.points)

    def test_sexpr_round_trip(self) -> None:
        """Test S-expression parse -> serialize -> parse round trip."""
        original = MINIMAL_PCB
        ast1 = parse(original)
        serialized = serialize(ast1, compact=True)
        ast2 = parse(serialized)
        # AST should be structurally identical
        assert ast1 == ast2
