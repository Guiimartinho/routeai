"""Tests for the converter layer between parsers.models and core.models."""

from __future__ import annotations

import math

import pytest

from routeai_parsers.converter import BoardConverter, SchematicConverter
from routeai_parsers.kicad.pcb_parser import KiCadPcbParser
from routeai_parsers.kicad.sch_parser import KiCadSchParser
from routeai_parsers.models import (
    Arc,
    BoardDesign,
    DesignRules,
    Footprint,
    FpLine,
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
    SchematicDesign,
    SchNet,
    SchPin,
    SchSymbol,
    SchProperty,
    LibSymbol,
    LibSymbolPin,
    Segment,
    Stackup,
    StackupLayer,
    Via,
    Zone,
    ZoneFill,
    ZoneFillType,
    ZonePolygon,
    HierarchicalSheet,
)
from routeai_core.models.physical import (
    PadShape as CorePadShape,
    PadType as CorePadType,
    ViaType as CoreViaType,
    ZoneFillType as CoreZoneFillType,
)
from routeai_core.models.schematic import ElectricalType as CoreElectricalType
from routeai_core.units import Length


# =========================================================================
# Inline test fixtures (reused from test_kicad_parser.py)
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
# Fixtures
# =========================================================================

@pytest.fixture()
def parsed_board() -> BoardDesign:
    """Parse the minimal PCB into a parser BoardDesign."""
    parser = KiCadPcbParser()
    return parser.parse_text(MINIMAL_PCB)


@pytest.fixture()
def parsed_schematic() -> SchematicDesign:
    """Parse the minimal schematic into a parser SchematicDesign."""
    parser = KiCadSchParser()
    return parser.parse_text(MINIMAL_SCH)


@pytest.fixture()
def minimal_parser_board() -> BoardDesign:
    """Create a minimal parser BoardDesign from scratch."""
    return BoardDesign(
        version=20240108,
        generator="pcbnew",
        thickness=1.6,
        layers=[
            LayerDef(ordinal=0, name="F.Cu", layer_type="signal"),
            LayerDef(ordinal=31, name="B.Cu", layer_type="signal"),
        ],
        nets=[
            Net(number=0, name=""),
            Net(number=1, name="GND"),
            Net(number=2, name="VCC"),
        ],
        net_classes=[
            NetClass(
                name="Default",
                clearance=0.2,
                trace_width=0.25,
                via_diameter=0.6,
                via_drill=0.3,
                nets=["GND", "VCC"],
            ),
        ],
        footprints=[
            Footprint(
                reference="R1",
                value="10k",
                at=Point2D(x=100.0, y=50.0),
                angle=0.0,
                layer="F.Cu",
                pads=[
                    Pad(
                        number="1",
                        pad_type=PadType.SMD,
                        shape=PadShape.RECT,
                        at=Point2D(x=-0.5, y=0.0),
                        size_x=0.6,
                        size_y=1.0,
                        layers=["F.Cu", "F.Paste", "F.Mask"],
                        net_number=1,
                        net_name="GND",
                    ),
                    Pad(
                        number="2",
                        pad_type=PadType.SMD,
                        shape=PadShape.RECT,
                        at=Point2D(x=0.5, y=0.0),
                        size_x=0.6,
                        size_y=1.0,
                        layers=["F.Cu", "F.Paste", "F.Mask"],
                        net_number=2,
                        net_name="VCC",
                    ),
                ],
                lines=[
                    FpLine(
                        start=Point2D(x=-1.0, y=-0.5),
                        end=Point2D(x=1.0, y=-0.5),
                        layer="F.SilkS",
                        width=0.12,
                    ),
                ],
                model=Model3D(
                    path="/models/R_0402.wrl",
                    scale=Point3D(x=1.0, y=1.0, z=1.0),
                ),
            ),
        ],
        segments=[
            Segment(
                start=Point2D(x=100.0, y=50.0),
                end=Point2D(x=110.0, y=50.0),
                width=0.25,
                layer="F.Cu",
                net=1,
            ),
        ],
        vias=[
            Via(
                at=Point2D(x=105.0, y=55.0),
                size=0.6,
                drill=0.3,
                layers=["F.Cu", "B.Cu"],
                net=2,
            ),
        ],
        zones=[
            Zone(
                net=1,
                net_name="GND",
                layer="F.Cu",
                connect_pads_clearance=0.5,
                min_thickness=0.25,
                fill=ZoneFill(
                    thermal_gap=0.5,
                    thermal_bridge_width=0.5,
                    fill_type=ZoneFillType.SOLID,
                ),
                polygons=[
                    ZonePolygon(points=[
                        Point2D(x=0, y=0),
                        Point2D(x=200, y=0),
                        Point2D(x=200, y=100),
                        Point2D(x=0, y=100),
                    ]),
                ],
            ),
        ],
        gr_lines=[
            GrLine(start=Point2D(x=0, y=0), end=Point2D(x=200, y=0), layer="Edge.Cuts", width=0.05),
            GrLine(start=Point2D(x=200, y=0), end=Point2D(x=200, y=100), layer="Edge.Cuts", width=0.05),
            GrLine(start=Point2D(x=200, y=100), end=Point2D(x=0, y=100), layer="Edge.Cuts", width=0.05),
            GrLine(start=Point2D(x=0, y=100), end=Point2D(x=0, y=0), layer="Edge.Cuts", width=0.05),
        ],
        design_rules=DesignRules(
            min_clearance=0.2,
            min_trace_width=0.2,
            min_via_diameter=0.6,
            min_via_drill=0.3,
            copper_edge_clearance=0.05,
        ),
    )


@pytest.fixture()
def minimal_parser_schematic() -> SchematicDesign:
    """Create a minimal parser SchematicDesign from scratch."""
    return SchematicDesign(
        version=20231120,
        generator="eeschema",
        uuid="test-uuid",
        title="Test Schematic",
        date="2024-01-15",
        revision="1.0",
        lib_symbols=[
            LibSymbol(
                lib_id="Device:R",
                pins=[
                    LibSymbolPin(number="1", name="~", pin_type="passive", at=Point2D(x=0, y=3.81)),
                    LibSymbolPin(number="2", name="~", pin_type="passive", at=Point2D(x=0, y=-3.81)),
                ],
            ),
        ],
        symbols=[
            SchSymbol(
                lib_id="Device:R",
                at=Point2D(x=100, y=50),
                reference="R1",
                value="10k",
                pins=[
                    SchPin(number="1"),
                    SchPin(number="2"),
                ],
                properties=[
                    SchProperty(key="Reference", value="R1"),
                    SchProperty(key="Value", value="10k"),
                    SchProperty(key="Footprint", value="Resistor_SMD:R_0402"),
                ],
            ),
        ],
        nets=[
            SchNet(name="GND", pins=[("R1", "1")], is_power=True),
            SchNet(name="VCC", pins=[("R1", "2")], is_power=True),
        ],
        hierarchical_sheets=[
            HierarchicalSheet(
                sheet_name="Power",
                file_name="power.kicad_sch",
                uuid="sheet-1",
            ),
        ],
    )


# =========================================================================
# Board conversion tests
# =========================================================================

class TestBoardConverterToCore:
    """Test conversion from parser BoardDesign to core BoardDesign."""

    def test_basic_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert core is not None

    def test_net_names(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert "GND" in core.nets
        assert "VCC" in core.nets
        # Empty net 0 should not appear
        assert "" not in core.nets

    def test_footprint_count(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert len(core.footprints) == 1

    def test_footprint_fields(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        fp = core.footprints[0]
        assert fp.reference == "R1"
        assert fp.value == "10k"
        assert fp.position.x.mm == pytest.approx(100.0)
        assert fp.position.y.mm == pytest.approx(50.0)
        assert fp.rotation.degrees == pytest.approx(0.0)
        assert fp.layer == "F.Cu"

    def test_pad_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        fp = core.footprints[0]
        assert len(fp.pads) == 2
        pad = fp.pads[0]
        assert pad.number == "1"
        assert pad.shape == CorePadShape.RECT
        assert pad.pad_type == CorePadType.SMD
        assert pad.size_x.mm == pytest.approx(0.6)
        assert pad.size_y.mm == pytest.approx(1.0)
        assert pad.position.x.mm == pytest.approx(-0.5)
        assert pad.net_ref == "GND"
        assert "F.Cu" in pad.layers

    def test_pad_no_net(self, minimal_parser_board: BoardDesign) -> None:
        """Pads with empty net should have None net_ref."""
        # Add a pad with net 0 (empty net)
        minimal_parser_board.footprints[0].pads.append(Pad(
            number="3",
            net_number=0,
            net_name="",
        ))
        core = BoardConverter.to_core(minimal_parser_board)
        pad3 = core.footprints[0].pads[2]
        assert pad3.net_ref is None

    def test_segment_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert len(core.traces) == 1
        trace = core.traces[0]
        assert trace.start.x.mm == pytest.approx(100.0)
        assert trace.end.x.mm == pytest.approx(110.0)
        assert trace.width.mm == pytest.approx(0.25)
        assert trace.layer == "F.Cu"
        assert trace.net_ref == "GND"

    def test_via_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert len(core.vias) == 1
        via = core.vias[0]
        assert via.position.x.mm == pytest.approx(105.0)
        assert via.position.y.mm == pytest.approx(55.0)
        assert via.drill.mm == pytest.approx(0.3)
        assert via.size.mm == pytest.approx(0.6)
        assert "F.Cu" in via.layers
        assert "B.Cu" in via.layers
        assert via.net_ref == "VCC"
        assert via.via_type == CoreViaType.THROUGH

    def test_zone_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert len(core.zones) == 1
        zone = core.zones[0]
        assert zone.net_ref == "GND"
        assert zone.layer == "F.Cu"
        assert zone.fill_type == CoreZoneFillType.SOLID
        assert zone.clearance.mm == pytest.approx(0.5)
        assert zone.min_width.mm == pytest.approx(0.25)
        assert len(zone.polygon.points) == 4

    def test_zone_thermal_relief(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        zone = core.zones[0]
        assert zone.thermal_relief is not None
        assert zone.thermal_relief.gap.mm == pytest.approx(0.5)
        assert zone.thermal_relief.bridge_width.mm == pytest.approx(0.5)

    def test_net_class_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert len(core.net_classes) == 1
        nc = core.net_classes[0]
        assert nc.name == "Default"
        assert nc.clearance.mm == pytest.approx(0.2)
        assert nc.trace_width.mm == pytest.approx(0.25)
        assert nc.via_drill.mm == pytest.approx(0.3)
        assert nc.via_size.mm == pytest.approx(0.6)
        assert "GND" in nc.nets

    def test_design_rules_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert core.design_rules is not None
        dr = core.design_rules
        assert dr.min_clearance.mm == pytest.approx(0.2)
        assert dr.min_trace_width.mm == pytest.approx(0.2)
        assert dr.min_via_drill.mm == pytest.approx(0.3)
        assert dr.min_via_size.mm == pytest.approx(0.6)
        assert dr.board_edge_clearance.mm == pytest.approx(0.05)

    def test_board_outline(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        assert core.outline is not None
        assert len(core.outline.polygon.points) == 4
        xs = [p.x.mm for p in core.outline.polygon.points]
        ys = [p.y.mm for p in core.outline.polygon.points]
        assert min(xs) == pytest.approx(0.0)
        assert max(xs) == pytest.approx(200.0)
        assert min(ys) == pytest.approx(0.0)
        assert max(ys) == pytest.approx(100.0)

    def test_3d_model_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        fp = core.footprints[0]
        assert fp.model_3d is not None
        assert "R_0402" in fp.model_3d.path
        assert fp.model_3d.scale == pytest.approx(1.0)

    def test_silkscreen_lines(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        fp = core.footprints[0]
        assert len(fp.silkscreen_lines) == 1
        line = fp.silkscreen_lines[0]
        assert line.start.x.mm == pytest.approx(-1.0)
        assert line.end.x.mm == pytest.approx(1.0)


class TestBoardConverterFromCore:
    """Test conversion from core BoardDesign to parser BoardDesign."""

    def test_basic_conversion(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        assert roundtrip is not None

    def test_net_list_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        net_names = {n.name for n in roundtrip.nets if n.name}
        assert "GND" in net_names
        assert "VCC" in net_names

    def test_footprint_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        assert len(roundtrip.footprints) == 1
        fp = roundtrip.footprints[0]
        assert fp.reference == "R1"
        assert fp.value == "10k"
        assert fp.at.x == pytest.approx(100.0)
        assert fp.at.y == pytest.approx(50.0)

    def test_pad_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        fp = roundtrip.footprints[0]
        assert len(fp.pads) == 2
        pad = fp.pads[0]
        assert pad.number == "1"
        assert pad.shape == PadShape.RECT
        assert pad.pad_type == PadType.SMD
        assert pad.size_x == pytest.approx(0.6)
        assert pad.size_y == pytest.approx(1.0)
        assert pad.net_name == "GND"

    def test_segment_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        assert len(roundtrip.segments) == 1
        seg = roundtrip.segments[0]
        assert seg.start.x == pytest.approx(100.0)
        assert seg.end.x == pytest.approx(110.0)
        assert seg.width == pytest.approx(0.25)
        assert seg.layer == "F.Cu"
        assert seg.net == 1  # GND is net 1

    def test_via_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        assert len(roundtrip.vias) == 1
        via = roundtrip.vias[0]
        assert via.at.x == pytest.approx(105.0)
        assert via.at.y == pytest.approx(55.0)
        assert via.size == pytest.approx(0.6)
        assert via.drill == pytest.approx(0.3)

    def test_zone_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        assert len(roundtrip.zones) == 1
        zone = roundtrip.zones[0]
        assert zone.net_name == "GND"
        assert zone.layer == "F.Cu"
        assert len(zone.polygons) == 1
        assert len(zone.polygons[0].points) == 4

    def test_design_rules_roundtrip(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        dr = roundtrip.design_rules
        assert dr.min_clearance == pytest.approx(0.2)
        assert dr.min_trace_width == pytest.approx(0.2)
        assert dr.min_via_drill == pytest.approx(0.3)
        assert dr.copper_edge_clearance == pytest.approx(0.05)

    def test_gr_lines_from_outline(self, minimal_parser_board: BoardDesign) -> None:
        core = BoardConverter.to_core(minimal_parser_board)
        roundtrip = BoardConverter.from_core(core)
        edge_lines = [gl for gl in roundtrip.gr_lines if gl.layer == "Edge.Cuts"]
        assert len(edge_lines) == 4


class TestBoardRoundTrip:
    """Test full round-trip: parser -> core -> parser."""

    def test_full_round_trip_from_kicad(self, parsed_board: BoardDesign) -> None:
        """Parse KiCad PCB, convert to core, convert back, check key fields."""
        core = BoardConverter.to_core(parsed_board)
        roundtrip = BoardConverter.from_core(core)

        # Net names should be preserved
        orig_names = {n.name for n in parsed_board.nets if n.name}
        rt_names = {n.name for n in roundtrip.nets if n.name}
        assert orig_names == rt_names

        # Footprint count should be preserved
        assert len(roundtrip.footprints) == len(parsed_board.footprints)

        # Segment count
        assert len(roundtrip.segments) == len(parsed_board.segments)

        # Via count
        assert len(roundtrip.vias) == len(parsed_board.vias)

        # Zone count
        assert len(roundtrip.zones) == len(parsed_board.zones)

    def test_footprint_pad_values_roundtrip(self, parsed_board: BoardDesign) -> None:
        core = BoardConverter.to_core(parsed_board)
        roundtrip = BoardConverter.from_core(core)

        for orig_fp, rt_fp in zip(parsed_board.footprints, roundtrip.footprints):
            assert orig_fp.reference == rt_fp.reference
            assert orig_fp.value == rt_fp.value
            assert len(orig_fp.pads) == len(rt_fp.pads)
            for orig_pad, rt_pad in zip(orig_fp.pads, rt_fp.pads):
                assert orig_pad.number == rt_pad.number
                assert orig_pad.size_x == pytest.approx(rt_pad.size_x, abs=0.001)
                assert orig_pad.size_y == pytest.approx(rt_pad.size_y, abs=0.001)

    def test_segment_values_roundtrip(self, parsed_board: BoardDesign) -> None:
        core = BoardConverter.to_core(parsed_board)
        roundtrip = BoardConverter.from_core(core)

        for orig, rt in zip(parsed_board.segments, roundtrip.segments):
            assert orig.start.x == pytest.approx(rt.start.x, abs=0.001)
            assert orig.start.y == pytest.approx(rt.start.y, abs=0.001)
            assert orig.end.x == pytest.approx(rt.end.x, abs=0.001)
            assert orig.end.y == pytest.approx(rt.end.y, abs=0.001)
            assert orig.width == pytest.approx(rt.width, abs=0.001)
            assert orig.layer == rt.layer

    def test_via_values_roundtrip(self, parsed_board: BoardDesign) -> None:
        core = BoardConverter.to_core(parsed_board)
        roundtrip = BoardConverter.from_core(core)

        for orig, rt in zip(parsed_board.vias, roundtrip.vias):
            assert orig.at.x == pytest.approx(rt.at.x, abs=0.001)
            assert orig.at.y == pytest.approx(rt.at.y, abs=0.001)
            assert orig.size == pytest.approx(rt.size, abs=0.001)
            assert orig.drill == pytest.approx(rt.drill, abs=0.001)
            assert orig.layers == rt.layers


# =========================================================================
# Schematic conversion tests
# =========================================================================

class TestSchematicConverterToCore:
    """Test conversion from parser SchematicDesign to core SchematicDesign."""

    def test_basic_conversion(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        assert core is not None

    def test_title_and_metadata(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        assert core.title == "Test Schematic"
        assert core.date == "2024-01-15"
        assert core.revision == "1.0"

    def test_component_count(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        assert len(core.components) == 1

    def test_component_fields(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        comp = core.components[0]
        assert comp.reference == "R1"
        assert comp.value == "10k"
        assert comp.footprint == "Resistor_SMD:R_0402"
        assert comp.position.x.mm == pytest.approx(100.0)
        assert comp.position.y.mm == pytest.approx(50.0)

    def test_component_pins(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        comp = core.components[0]
        assert len(comp.pins) == 2
        pin1 = comp.pins[0]
        assert pin1.number == "1"
        assert pin1.electrical_type == CoreElectricalType.PASSIVE

    def test_pin_position_from_lib(self, minimal_parser_schematic: SchematicDesign) -> None:
        """Pin with zero position should get position from lib symbol."""
        core = SchematicConverter.to_core(minimal_parser_schematic)
        pin1 = core.components[0].pins[0]
        # Should have gotten position from lib symbol pin
        assert pin1.position.y.mm == pytest.approx(3.81)

    def test_net_conversion(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        assert len(core.nets) == 2
        net_names = {n.name for n in core.nets}
        assert "GND" in net_names
        assert "VCC" in net_names

    def test_net_pads_format(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        gnd = next(n for n in core.nets if n.name == "GND")
        assert "R1.1" in gnd.pads

    def test_sheet_conversion(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        assert len(core.sheets) == 1
        sheet = core.sheets[0]
        assert sheet.name == "Power"
        assert sheet.filename == "power.kicad_sch"


class TestSchematicConverterFromCore:
    """Test conversion from core SchematicDesign to parser SchematicDesign."""

    def test_basic_conversion(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        assert roundtrip is not None

    def test_title_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        assert roundtrip.title == "Test Schematic"
        assert roundtrip.date == "2024-01-15"
        assert roundtrip.revision == "1.0"

    def test_symbol_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        assert len(roundtrip.symbols) == 1
        sym = roundtrip.symbols[0]
        assert sym.reference == "R1"
        assert sym.value == "10k"
        assert sym.at.x == pytest.approx(100.0)
        assert sym.at.y == pytest.approx(50.0)

    def test_pin_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        sym = roundtrip.symbols[0]
        assert len(sym.pins) == 2
        assert sym.pins[0].number == "1"

    def test_net_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        assert len(roundtrip.nets) == 2
        net_names = {n.name for n in roundtrip.nets}
        assert "GND" in net_names
        assert "VCC" in net_names

    def test_net_pins_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        gnd = next(n for n in roundtrip.nets if n.name == "GND")
        assert ("R1", "1") in gnd.pins

    def test_sheet_roundtrip(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        assert len(roundtrip.hierarchical_sheets) == 1
        sheet = roundtrip.hierarchical_sheets[0]
        assert sheet.sheet_name == "Power"
        assert sheet.file_name == "power.kicad_sch"

    def test_power_net_detection(self, minimal_parser_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(minimal_parser_schematic)
        roundtrip = SchematicConverter.from_core(core)
        gnd = next(n for n in roundtrip.nets if n.name == "GND")
        assert gnd.is_power is True


class TestSchematicRoundTrip:
    """Test full round-trip from parsed KiCad schematic."""

    def test_from_kicad(self, parsed_schematic: SchematicDesign) -> None:
        core = SchematicConverter.to_core(parsed_schematic)
        roundtrip = SchematicConverter.from_core(core)

        # Symbol count should be preserved
        assert len(roundtrip.symbols) == len(parsed_schematic.symbols)

        # References preserved
        orig_refs = {s.reference for s in parsed_schematic.symbols}
        rt_refs = {s.reference for s in roundtrip.symbols}
        assert orig_refs == rt_refs

        # Values preserved
        for orig, rt in zip(parsed_schematic.symbols, roundtrip.symbols):
            assert orig.reference == rt.reference
            assert orig.value == rt.value


# =========================================================================
# Edge case tests
# =========================================================================

class TestEdgeCases:
    """Test edge cases: empty lists, None values, unknown enums."""

    def test_empty_board(self) -> None:
        board = BoardDesign()
        core = BoardConverter.to_core(board)
        assert core is not None
        assert len(core.footprints) == 0
        assert len(core.traces) == 0
        assert len(core.vias) == 0
        assert len(core.zones) == 0
        assert len(core.nets) == 0
        assert core.outline is None

    def test_empty_schematic(self) -> None:
        sch = SchematicDesign()
        core = SchematicConverter.to_core(sch)
        assert core is not None
        assert len(core.components) == 0
        assert len(core.nets) == 0

    def test_empty_core_board(self) -> None:
        from routeai_core.models.physical import BoardDesign as CoreBD
        core = CoreBD()
        parser = BoardConverter.from_core(core)
        assert parser is not None
        assert len(parser.footprints) == 0
        assert len(parser.segments) == 0

    def test_empty_core_schematic(self) -> None:
        from routeai_core.models.schematic import SchematicDesign as CoreSD
        core = CoreSD()
        parser = SchematicConverter.from_core(core)
        assert parser is not None
        assert len(parser.symbols) == 0

    def test_via_type_blind(self) -> None:
        via = Via(
            at=Point2D(x=10, y=20),
            size=0.6,
            drill=0.3,
            layers=["F.Cu", "In1.Cu"],
            net=1,
            via_type="blind",
        )
        board = BoardDesign(
            nets=[Net(number=0, name=""), Net(number=1, name="SIG")],
            vias=[via],
        )
        core = BoardConverter.to_core(board)
        assert core.vias[0].via_type == CoreViaType.BLIND

    def test_via_type_micro(self) -> None:
        via = Via(via_type="micro")
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            vias=[via],
        )
        core = BoardConverter.to_core(board)
        assert core.vias[0].via_type == CoreViaType.MICRO

    def test_unknown_via_type(self) -> None:
        via = Via(via_type="unknown_type")
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            vias=[via],
        )
        core = BoardConverter.to_core(board)
        assert core.vias[0].via_type == CoreViaType.THROUGH  # default fallback

    def test_trapezoid_pad_maps_to_rect(self) -> None:
        pad = Pad(number="1", shape=PadShape.TRAPEZOID, size_x=1.0, size_y=1.0)
        fp = Footprint(reference="U1", pads=[pad])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            footprints=[fp],
        )
        core = BoardConverter.to_core(board)
        assert core.footprints[0].pads[0].shape == CorePadShape.RECT

    def test_thru_hole_pad_conversion(self) -> None:
        pad = Pad(
            number="1",
            pad_type=PadType.THRU_HOLE,
            shape=PadShape.CIRCLE,
            drill=0.8,
            size_x=1.6,
            size_y=1.6,
            layers=["*.Cu"],
        )
        fp = Footprint(reference="J1", pads=[pad])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            footprints=[fp],
        )
        core = BoardConverter.to_core(board)
        core_pad = core.footprints[0].pads[0]
        assert core_pad.pad_type == CorePadType.THROUGH_HOLE
        assert core_pad.drill is not None
        assert core_pad.drill.mm == pytest.approx(0.8)

    def test_npth_pad_conversion(self) -> None:
        pad = Pad(number="1", pad_type=PadType.NP_THRU_HOLE, drill=3.2)
        fp = Footprint(reference="H1", pads=[pad])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            footprints=[fp],
        )
        core = BoardConverter.to_core(board)
        assert core.footprints[0].pads[0].pad_type == CorePadType.NPTH

    def test_zone_no_polygon(self) -> None:
        zone = Zone(net=0, layer="F.Cu")
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            zones=[zone],
        )
        core = BoardConverter.to_core(board)
        assert len(core.zones[0].polygon.points) == 0

    def test_zone_hatched_fill(self) -> None:
        zone = Zone(
            net=0,
            layer="F.Cu",
            fill=ZoneFill(fill_type=ZoneFillType.HATCHED),
        )
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            zones=[zone],
        )
        core = BoardConverter.to_core(board)
        assert core.zones[0].fill_type == CoreZoneFillType.HATCHED

    def test_no_outline_when_no_edge_cuts(self) -> None:
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            gr_lines=[
                GrLine(start=Point2D(x=0, y=0), end=Point2D(x=10, y=0), layer="F.SilkS"),
            ],
        )
        core = BoardConverter.to_core(board)
        assert core.outline is None

    def test_stackup_conversion(self) -> None:
        stackup = Stackup(layers=[
            StackupLayer(name="F.Cu", layer_type="copper", thickness=0.035, material="Copper"),
            StackupLayer(name="Core", layer_type="core", thickness=1.53, material="FR-4", epsilon_r=4.5, loss_tangent=0.02),
            StackupLayer(name="B.Cu", layer_type="copper", thickness=0.035, material="Copper"),
        ])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            stackup=stackup,
        )
        core = BoardConverter.to_core(board)
        assert core.stackup is not None
        assert core.stackup.layer_count == 2
        assert len(core.stackup.layers) == 3
        assert core.stackup.layers[0].is_copper
        assert not core.stackup.layers[1].is_copper
        assert core.stackup.layers[1].dielectric is not None
        assert core.stackup.layers[1].dielectric.dielectric_constant == pytest.approx(4.5)

    def test_stackup_roundtrip(self) -> None:
        stackup = Stackup(layers=[
            StackupLayer(name="F.Cu", layer_type="copper", thickness=0.035),
            StackupLayer(name="Core", layer_type="core", thickness=1.53, epsilon_r=4.5),
            StackupLayer(name="B.Cu", layer_type="copper", thickness=0.035),
        ])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            stackup=stackup,
        )
        core = BoardConverter.to_core(board)
        roundtrip = BoardConverter.from_core(core)
        assert len(roundtrip.stackup.layers) == 3
        assert roundtrip.stackup.layers[0].layer_type == "copper"
        assert roundtrip.stackup.layers[1].layer_type == "core"
        assert roundtrip.stackup.layers[2].layer_type == "copper"

    def test_footprint_no_model(self) -> None:
        fp = Footprint(reference="R1", value="10k")
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            footprints=[fp],
        )
        core = BoardConverter.to_core(board)
        assert core.footprints[0].model_3d is None

    def test_footprint_no_lines(self) -> None:
        fp = Footprint(reference="R1", value="10k", lines=[])
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            footprints=[fp],
        )
        core = BoardConverter.to_core(board)
        assert len(core.footprints[0].silkscreen_lines) == 0
        assert len(core.footprints[0].fab_layer_lines) == 0

    def test_net_class_no_diff_pair(self) -> None:
        nc = NetClass(name="Default", diff_pair_width=0.0, diff_pair_gap=0.0)
        board = BoardDesign(
            nets=[Net(number=0, name="")],
            net_classes=[nc],
        )
        core = BoardConverter.to_core(board)
        assert core.net_classes[0].diff_pair_width is None
        assert core.net_classes[0].diff_pair_gap is None

    def test_schematic_no_lib_symbols(self) -> None:
        sch = SchematicDesign(
            symbols=[
                SchSymbol(
                    lib_id="Unknown:Part",
                    reference="U1",
                    value="CHIP",
                    pins=[SchPin(number="1"), SchPin(number="2")],
                ),
            ],
        )
        core = SchematicConverter.to_core(sch)
        assert len(core.components) == 1
        # Pins should still convert even without lib data
        assert len(core.components[0].pins) == 2
        assert core.components[0].pins[0].electrical_type == CoreElectricalType.UNSPECIFIED

    def test_schematic_pin_name_tilde_stripped(self) -> None:
        """Pin name '~' (unnamed) should become empty string."""
        sch = SchematicDesign(
            lib_symbols=[
                LibSymbol(
                    lib_id="Device:R",
                    pins=[LibSymbolPin(number="1", name="~", pin_type="passive")],
                ),
            ],
            symbols=[
                SchSymbol(
                    lib_id="Device:R",
                    reference="R1",
                    value="10k",
                    pins=[SchPin(number="1")],
                ),
            ],
        )
        core = SchematicConverter.to_core(sch)
        assert core.components[0].pins[0].name == ""

    def test_core_board_no_design_rules(self) -> None:
        from routeai_core.models.physical import BoardDesign as CoreBD
        core = CoreBD(design_rules=None)
        parser = BoardConverter.from_core(core)
        # Should get default design rules
        assert parser.design_rules.min_clearance == pytest.approx(0.2)

    def test_core_board_no_stackup(self) -> None:
        from routeai_core.models.physical import BoardDesign as CoreBD
        core = CoreBD(stackup=None)
        parser = BoardConverter.from_core(core)
        assert len(parser.stackup.layers) == 0

    def test_core_board_no_outline(self) -> None:
        from routeai_core.models.physical import BoardDesign as CoreBD
        core = CoreBD(outline=None)
        parser = BoardConverter.from_core(core)
        assert len(parser.gr_lines) == 0
