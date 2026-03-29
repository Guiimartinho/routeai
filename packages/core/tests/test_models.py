"""Comprehensive tests for the RouteAI Core unified PCB data model.

Tests cover:
- Creation of each model with valid data
- JSON round-trip serialization for each model
- Unit conversions (mm, mil, inch, um)
- Geometry operations (union, intersection, difference)
- Nested model structures (BoardDesign containing everything)
- Default values and optional fields
"""

import json
import math

import pytest

from routeai_core.units import Angle, Length
from routeai_core.geometry import Arc, BoundingBox, Line, Point, Polygon
from routeai_core.models.schematic import (
    Bus,
    Component,
    ElectricalType,
    Net,
    Pin,
    SchematicDesign,
    Sheet,
    SheetInstance,
)
from routeai_core.models.physical import (
    BoardDesign,
    BoardOutline,
    Footprint,
    Model3D,
    Pad,
    PadShape,
    PadType,
    ThermalRelief,
    TraceArc,
    TraceSegment,
    Via,
    ViaType,
    Zone,
    ZoneFillType,
)
from routeai_core.models.constraints import (
    DesignRules,
    DiffPair,
    KeepOut,
    LengthGroup,
    NetClass,
)
from routeai_core.models.stackup import (
    CopperWeight,
    DielectricLayer,
    Layer,
    LayerType,
    StackUp,
    StackupLayer,
    make_2_layer_stackup,
    make_4_layer_stackup,
    make_6_layer_stackup,
)
from routeai_core.models.manufacturing import (
    AssemblyData,
    BOM,
    BOMEntry,
    FabricationSpec,
    PickAndPlace,
    SolderMaskColor,
    SolderPasteLayer,
    SurfaceFinish,
)


# ============================================================
# Unit conversion tests
# ============================================================


class TestLength:
    """Tests for the Length unit class."""

    def test_from_mm(self):
        l = Length.from_mm(25.4)
        assert l.mm == 25.4

    def test_mm_to_mil(self):
        l = Length.from_mm(25.4)
        assert math.isclose(l.mil, 1000.0, rel_tol=1e-9)

    def test_mm_to_inch(self):
        l = Length.from_mm(25.4)
        assert math.isclose(l.inch, 1.0, rel_tol=1e-9)

    def test_mm_to_um(self):
        l = Length.from_mm(1.0)
        assert math.isclose(l.um, 1000.0, rel_tol=1e-9)

    def test_from_mil(self):
        l = Length.from_mil(1000.0)
        assert math.isclose(l.mm, 25.4, rel_tol=1e-9)

    def test_from_inch(self):
        l = Length.from_inch(1.0)
        assert math.isclose(l.mm, 25.4, rel_tol=1e-9)

    def test_from_um(self):
        l = Length.from_um(1000.0)
        assert math.isclose(l.mm, 1.0, rel_tol=1e-9)

    def test_round_trip_mil(self):
        original_mil = 500.0
        l = Length.from_mil(original_mil)
        assert math.isclose(l.mil, original_mil, rel_tol=1e-9)

    def test_round_trip_inch(self):
        original_inch = 2.5
        l = Length.from_inch(original_inch)
        assert math.isclose(l.inch, original_inch, rel_tol=1e-9)

    def test_addition(self):
        a = Length.from_mm(10.0)
        b = Length.from_mm(5.0)
        result = a + b
        assert result.mm == 15.0

    def test_subtraction(self):
        a = Length.from_mm(10.0)
        b = Length.from_mm(3.0)
        result = a - b
        assert result.mm == 7.0

    def test_multiplication(self):
        a = Length.from_mm(5.0)
        result = a * 3.0
        assert result.mm == 15.0

    def test_rmul(self):
        a = Length.from_mm(5.0)
        result = 3.0 * a
        assert result.mm == 15.0

    def test_division(self):
        a = Length.from_mm(15.0)
        result = a / 3.0
        assert result.mm == 5.0

    def test_negation(self):
        a = Length.from_mm(5.0)
        result = -a
        assert result.mm == -5.0

    def test_abs(self):
        a = Length.from_mm(-5.0)
        result = abs(a)
        assert result.mm == 5.0

    def test_comparison(self):
        a = Length.from_mm(10.0)
        b = Length.from_mm(5.0)
        assert a > b
        assert b < a
        assert a >= a
        assert a <= a

    def test_equality(self):
        a = Length.from_mm(25.4)
        b = Length.from_inch(1.0)
        assert a == b

    def test_hash(self):
        a = Length.from_mm(25.4)
        b = Length.from_inch(1.0)
        assert hash(a) == hash(b)

    def test_unknown_unit_raises(self):
        with pytest.raises(ValueError, match="Unknown length unit"):
            Length(1.0, "feet")

    def test_repr(self):
        l = Length.from_mm(5.0)
        assert "5.0" in repr(l)
        assert "mm" in repr(l)


class TestAngle:
    """Tests for the Angle unit class."""

    def test_degrees(self):
        a = Angle(90.0)
        assert a.degrees == 90.0

    def test_to_radians(self):
        a = Angle(180.0)
        assert math.isclose(a.radians, math.pi, rel_tol=1e-9)

    def test_from_radians(self):
        a = Angle.from_radians(math.pi)
        assert math.isclose(a.degrees, 180.0, rel_tol=1e-9)

    def test_normalized(self):
        a = Angle(450.0)
        assert math.isclose(a.normalized().degrees, 90.0, rel_tol=1e-9)

    def test_addition(self):
        a = Angle(90.0)
        b = Angle(45.0)
        assert (a + b).degrees == 135.0

    def test_subtraction(self):
        a = Angle(90.0)
        b = Angle(45.0)
        assert (a - b).degrees == 45.0

    def test_equality(self):
        a = Angle(90.0)
        b = Angle.from_radians(math.pi / 2)
        assert a == b


# ============================================================
# Geometry tests
# ============================================================


class TestPoint:
    """Tests for the Point geometry class."""

    def test_creation(self):
        p = Point(x=Length.from_mm(10.0), y=Length.from_mm(20.0))
        assert p.x.mm == 10.0
        assert p.y.mm == 20.0

    def test_default(self):
        p = Point()
        assert p.x.mm == 0.0
        assert p.y.mm == 0.0

    def test_distance(self):
        p1 = Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0))
        p2 = Point(x=Length.from_mm(3.0), y=Length.from_mm(4.0))
        assert math.isclose(p1.distance_to(p2).mm, 5.0, rel_tol=1e-9)

    def test_translate(self):
        p = Point(x=Length.from_mm(1.0), y=Length.from_mm(2.0))
        moved = p.translate(Length.from_mm(3.0), Length.from_mm(4.0))
        assert moved.x.mm == 4.0
        assert moved.y.mm == 6.0

    def test_rotate(self):
        p = Point(x=Length.from_mm(1.0), y=Length.from_mm(0.0))
        rotated = p.rotate(Angle(90.0))
        assert math.isclose(rotated.x.mm, 0.0, abs_tol=1e-9)
        assert math.isclose(rotated.y.mm, 1.0, abs_tol=1e-9)

    def test_json_round_trip(self):
        p = Point(x=Length.from_mm(10.5), y=Length.from_mm(20.3))
        json_str = p.model_dump_json()
        p2 = Point.model_validate_json(json_str)
        assert math.isclose(p.x.mm, p2.x.mm, rel_tol=1e-9)
        assert math.isclose(p.y.mm, p2.y.mm, rel_tol=1e-9)


class TestLine:
    """Tests for the Line geometry class."""

    def test_creation(self):
        start = Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0))
        end = Point(x=Length.from_mm(10.0), y=Length.from_mm(0.0))
        line = Line(start=start, end=end)
        assert math.isclose(line.length.mm, 10.0, rel_tol=1e-9)

    def test_midpoint(self):
        start = Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0))
        end = Point(x=Length.from_mm(10.0), y=Length.from_mm(10.0))
        line = Line(start=start, end=end)
        mid = line.midpoint
        assert math.isclose(mid.x.mm, 5.0, rel_tol=1e-9)
        assert math.isclose(mid.y.mm, 5.0, rel_tol=1e-9)

    def test_json_round_trip(self):
        line = Line(
            start=Point(x=Length.from_mm(1.0), y=Length.from_mm(2.0)),
            end=Point(x=Length.from_mm(3.0), y=Length.from_mm(4.0)),
        )
        json_str = line.model_dump_json()
        line2 = Line.model_validate_json(json_str)
        assert math.isclose(line.start.x.mm, line2.start.x.mm, rel_tol=1e-9)


class TestArc:
    """Tests for the Arc geometry class."""

    def test_creation(self):
        arc = Arc(
            center=Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
            radius=Length.from_mm(10.0),
            start_angle=Angle(0.0),
            end_angle=Angle(90.0),
        )
        expected_length = 10.0 * math.pi / 2.0
        assert math.isclose(arc.arc_length.mm, expected_length, rel_tol=1e-6)

    def test_point_at_angle(self):
        arc = Arc(
            center=Point(),
            radius=Length.from_mm(10.0),
        )
        p = arc.point_at_angle(Angle(0.0))
        assert math.isclose(p.x.mm, 10.0, abs_tol=1e-9)
        assert math.isclose(p.y.mm, 0.0, abs_tol=1e-9)

    def test_to_points(self):
        arc = Arc(
            center=Point(),
            radius=Length.from_mm(10.0),
            start_angle=Angle(0.0),
            end_angle=Angle(90.0),
        )
        points = arc.to_points(num_segments=4)
        assert len(points) == 5  # 4 segments = 5 points

    def test_json_round_trip(self):
        arc = Arc(
            center=Point(x=Length.from_mm(5.0), y=Length.from_mm(5.0)),
            radius=Length.from_mm(3.0),
            start_angle=Angle(45.0),
            end_angle=Angle(135.0),
        )
        json_str = arc.model_dump_json()
        arc2 = Arc.model_validate_json(json_str)
        assert math.isclose(arc.radius.mm, arc2.radius.mm, rel_tol=1e-9)
        assert math.isclose(arc.start_angle.degrees, arc2.start_angle.degrees, rel_tol=1e-9)


class TestPolygon:
    """Tests for the Polygon geometry class with boolean operations."""

    def _make_square(self, x: float, y: float, size: float) -> Polygon:
        """Create a square polygon at (x, y) with given size."""
        return Polygon(points=[
            Point(x=Length.from_mm(x), y=Length.from_mm(y)),
            Point(x=Length.from_mm(x + size), y=Length.from_mm(y)),
            Point(x=Length.from_mm(x + size), y=Length.from_mm(y + size)),
            Point(x=Length.from_mm(x), y=Length.from_mm(y + size)),
        ])

    def test_area(self):
        sq = self._make_square(0, 0, 10)
        assert math.isclose(sq.area, 100.0, rel_tol=1e-6)

    def test_perimeter(self):
        sq = self._make_square(0, 0, 10)
        assert math.isclose(sq.perimeter.mm, 40.0, rel_tol=1e-6)

    def test_centroid(self):
        sq = self._make_square(0, 0, 10)
        c = sq.centroid
        assert math.isclose(c.x.mm, 5.0, abs_tol=1e-6)
        assert math.isclose(c.y.mm, 5.0, abs_tol=1e-6)

    def test_contains_point(self):
        sq = self._make_square(0, 0, 10)
        inside = Point(x=Length.from_mm(5.0), y=Length.from_mm(5.0))
        outside = Point(x=Length.from_mm(15.0), y=Length.from_mm(15.0))
        assert sq.contains_point(inside)
        assert not sq.contains_point(outside)

    def test_union(self):
        sq1 = self._make_square(0, 0, 10)
        sq2 = self._make_square(5, 0, 10)
        result = sq1.union(sq2)
        # Union of two overlapping 10x10 squares offset by 5 in x
        expected_area = 10 * 10 + 5 * 10  # 150
        assert math.isclose(result.area, expected_area, rel_tol=1e-3)

    def test_intersection(self):
        sq1 = self._make_square(0, 0, 10)
        sq2 = self._make_square(5, 0, 10)
        result = sq1.intersection(sq2)
        # Overlap is 5x10 = 50
        assert math.isclose(result.area, 50.0, rel_tol=1e-3)

    def test_difference(self):
        sq1 = self._make_square(0, 0, 10)
        sq2 = self._make_square(5, 0, 10)
        result = sq1.difference(sq2)
        # sq1 minus overlap = 100 - 50 = 50
        assert math.isclose(result.area, 50.0, rel_tol=1e-3)

    def test_no_intersection(self):
        sq1 = self._make_square(0, 0, 10)
        sq2 = self._make_square(20, 20, 10)
        result = sq1.intersection(sq2)
        assert len(result.points) == 0

    def test_buffer(self):
        sq = self._make_square(0, 0, 10)
        buffered = sq.buffer(Length.from_mm(1.0))
        assert buffered.area > sq.area

    def test_json_round_trip(self):
        sq = self._make_square(0, 0, 10)
        json_str = sq.model_dump_json()
        sq2 = Polygon.model_validate_json(json_str)
        assert len(sq2.points) == 4
        assert math.isclose(sq2.area, 100.0, rel_tol=1e-3)


class TestBoundingBox:
    """Tests for the BoundingBox class."""

    def test_creation(self):
        bb = BoundingBox(
            min_x=Length.from_mm(0.0),
            min_y=Length.from_mm(0.0),
            max_x=Length.from_mm(10.0),
            max_y=Length.from_mm(5.0),
        )
        assert bb.width.mm == 10.0
        assert bb.height.mm == 5.0
        assert bb.area == 50.0

    def test_center(self):
        bb = BoundingBox(
            min_x=Length.from_mm(0.0),
            min_y=Length.from_mm(0.0),
            max_x=Length.from_mm(10.0),
            max_y=Length.from_mm(10.0),
        )
        assert bb.center.x.mm == 5.0
        assert bb.center.y.mm == 5.0

    def test_contains_point(self):
        bb = BoundingBox(
            min_x=Length.from_mm(0.0),
            min_y=Length.from_mm(0.0),
            max_x=Length.from_mm(10.0),
            max_y=Length.from_mm(10.0),
        )
        assert bb.contains_point(Point(x=Length.from_mm(5.0), y=Length.from_mm(5.0)))
        assert not bb.contains_point(Point(x=Length.from_mm(15.0), y=Length.from_mm(5.0)))

    def test_overlaps(self):
        bb1 = BoundingBox(
            min_x=Length.from_mm(0.0), min_y=Length.from_mm(0.0),
            max_x=Length.from_mm(10.0), max_y=Length.from_mm(10.0),
        )
        bb2 = BoundingBox(
            min_x=Length.from_mm(5.0), min_y=Length.from_mm(5.0),
            max_x=Length.from_mm(15.0), max_y=Length.from_mm(15.0),
        )
        bb3 = BoundingBox(
            min_x=Length.from_mm(20.0), min_y=Length.from_mm(20.0),
            max_x=Length.from_mm(30.0), max_y=Length.from_mm(30.0),
        )
        assert bb1.overlaps(bb2)
        assert not bb1.overlaps(bb3)

    def test_merge(self):
        bb1 = BoundingBox(
            min_x=Length.from_mm(0.0), min_y=Length.from_mm(0.0),
            max_x=Length.from_mm(10.0), max_y=Length.from_mm(10.0),
        )
        bb2 = BoundingBox(
            min_x=Length.from_mm(5.0), min_y=Length.from_mm(5.0),
            max_x=Length.from_mm(20.0), max_y=Length.from_mm(20.0),
        )
        merged = bb1.merge(bb2)
        assert merged.min_x.mm == 0.0
        assert merged.min_y.mm == 0.0
        assert merged.max_x.mm == 20.0
        assert merged.max_y.mm == 20.0

    def test_from_polygon(self):
        poly = Polygon(points=[
            Point(x=Length.from_mm(1.0), y=Length.from_mm(2.0)),
            Point(x=Length.from_mm(5.0), y=Length.from_mm(2.0)),
            Point(x=Length.from_mm(5.0), y=Length.from_mm(8.0)),
            Point(x=Length.from_mm(1.0), y=Length.from_mm(8.0)),
        ])
        bb = BoundingBox.from_polygon(poly)
        assert bb.min_x.mm == 1.0
        assert bb.min_y.mm == 2.0
        assert bb.max_x.mm == 5.0
        assert bb.max_y.mm == 8.0

    def test_json_round_trip(self):
        bb = BoundingBox(
            min_x=Length.from_mm(1.0), min_y=Length.from_mm(2.0),
            max_x=Length.from_mm(11.0), max_y=Length.from_mm(12.0),
        )
        json_str = bb.model_dump_json()
        bb2 = BoundingBox.model_validate_json(json_str)
        assert math.isclose(bb.min_x.mm, bb2.min_x.mm, rel_tol=1e-9)
        assert math.isclose(bb.max_y.mm, bb2.max_y.mm, rel_tol=1e-9)


# ============================================================
# Schematic model tests
# ============================================================


class TestSchematicModels:
    """Tests for schematic data models."""

    def test_pin_creation(self):
        pin = Pin(
            number="1",
            name="VCC",
            position=Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
            electrical_type=ElectricalType.POWER_IN,
            net_ref="VCC",
        )
        assert pin.number == "1"
        assert pin.name == "VCC"
        assert pin.electrical_type == ElectricalType.POWER_IN
        assert pin.net_ref == "VCC"

    def test_pin_defaults(self):
        pin = Pin(number="1")
        assert pin.name == ""
        assert pin.electrical_type == ElectricalType.UNSPECIFIED
        assert pin.net_ref is None

    def test_component_creation(self):
        comp = Component(
            reference="R1",
            value="10k",
            footprint="Resistor_SMD:R_0402_1005Metric",
            pins=[
                Pin(number="1", name="1", net_ref="NET1"),
                Pin(number="2", name="2", net_ref="GND"),
            ],
        )
        assert comp.reference == "R1"
        assert comp.value == "10k"
        assert len(comp.pins) == 2

    def test_component_get_pin(self):
        comp = Component(
            reference="U1",
            value="ATmega328P",
            pins=[
                Pin(number="1", name="RESET"),
                Pin(number="7", name="VCC"),
                Pin(number="8", name="GND"),
            ],
        )
        assert comp.get_pin_by_number("7").name == "VCC"
        assert comp.get_pin_by_name("GND").number == "8"
        assert comp.get_pin_by_number("99") is None

    def test_net_creation(self):
        net = Net(
            name="GND",
            net_class="Power",
            pads=["R1.1", "C1.2", "U1.8"],
        )
        assert net.name == "GND"
        assert len(net.pads) == 3

    def test_bus_creation(self):
        bus = Bus(
            name="DATA[0..7]",
            nets=[f"D{i}" for i in range(8)],
        )
        assert bus.name == "DATA[0..7]"
        assert len(bus.nets) == 8

    def test_sheet_creation(self):
        sheet = Sheet(
            name="Power",
            filename="power.kicad_sch",
            instances=[SheetInstance(path="/power/", page="2")],
        )
        assert sheet.name == "Power"
        assert len(sheet.instances) == 1

    def test_schematic_design(self):
        design = SchematicDesign(
            title="Test Board",
            date="2026-03-14",
            revision="1.0",
            components=[
                Component(reference="R1", value="10k"),
                Component(reference="C1", value="100nF"),
            ],
            nets=[
                Net(name="VCC", pads=["R1.1"]),
                Net(name="GND", pads=["R1.2", "C1.2"]),
            ],
            buses=[Bus(name="DATA[0..3]", nets=["D0", "D1", "D2", "D3"])],
        )
        assert design.component_count == 2
        assert design.net_count == 2
        assert design.get_component("R1").value == "10k"
        assert design.get_net("GND") is not None
        assert design.get_component("X99") is None

    def test_schematic_design_json_round_trip(self):
        design = SchematicDesign(
            title="JSON Test",
            components=[
                Component(
                    reference="U1",
                    value="IC",
                    pins=[Pin(number="1", name="VCC", electrical_type=ElectricalType.POWER_IN)],
                ),
            ],
            nets=[Net(name="VCC", net_class="Power", pads=["U1.1"])],
        )
        json_str = design.model_dump_json()
        data = json.loads(json_str)
        assert data["title"] == "JSON Test"

        design2 = SchematicDesign.model_validate_json(json_str)
        assert design2.title == "JSON Test"
        assert design2.components[0].reference == "U1"
        assert design2.nets[0].name == "VCC"


# ============================================================
# Physical model tests
# ============================================================


class TestPhysicalModels:
    """Tests for physical layout data models."""

    def test_pad_smd(self):
        pad = Pad(
            number="1",
            shape=PadShape.RECT,
            size_x=Length.from_mm(1.2),
            size_y=Length.from_mm(0.6),
            layers=["F.Cu", "F.Paste", "F.Mask"],
            pad_type=PadType.SMD,
        )
        assert pad.shape == PadShape.RECT
        assert pad.pad_type == PadType.SMD
        assert pad.drill is None

    def test_pad_through_hole(self):
        pad = Pad(
            number="1",
            shape=PadShape.CIRCLE,
            size_x=Length.from_mm(1.8),
            size_y=Length.from_mm(1.8),
            drill=Length.from_mm(1.0),
            layers=["*.Cu", "*.Mask"],
            pad_type=PadType.THROUGH_HOLE,
        )
        assert pad.pad_type == PadType.THROUGH_HOLE
        assert pad.drill.mm == 1.0

    def test_pad_roundrect(self):
        pad = Pad(
            shape=PadShape.ROUNDRECT,
            size_x=Length.from_mm(1.5),
            size_y=Length.from_mm(1.0),
            roundrect_ratio=0.25,
        )
        assert pad.shape == PadShape.ROUNDRECT
        assert pad.roundrect_ratio == 0.25

    def test_via_creation(self):
        via = Via(
            position=Point(x=Length.from_mm(10.0), y=Length.from_mm(20.0)),
            drill=Length.from_mm(0.3),
            size=Length.from_mm(0.6),
            layers=["F.Cu", "B.Cu"],
            net_ref="GND",
            via_type=ViaType.THROUGH,
        )
        assert via.via_type == ViaType.THROUGH
        assert math.isclose(via.annular_ring.mm, 0.15, rel_tol=1e-9)

    def test_via_blind(self):
        via = Via(
            drill=Length.from_mm(0.15),
            size=Length.from_mm(0.3),
            layers=["F.Cu", "In1.Cu"],
            via_type=ViaType.BLIND,
        )
        assert via.via_type == ViaType.BLIND

    def test_trace_segment(self):
        trace = TraceSegment(
            start=Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
            end=Point(x=Length.from_mm(10.0), y=Length.from_mm(0.0)),
            width=Length.from_mm(0.25),
            layer="F.Cu",
            net_ref="NET1",
        )
        assert math.isclose(trace.length.mm, 10.0, rel_tol=1e-9)

    def test_trace_arc(self):
        arc = TraceArc(
            center=Point(),
            radius=Length.from_mm(5.0),
            start_angle=Angle(0.0),
            end_angle=Angle(90.0),
            width=Length.from_mm(0.25),
            layer="F.Cu",
        )
        expected = 5.0 * math.pi / 2.0
        assert math.isclose(arc.arc_length.mm, expected, rel_tol=1e-6)

    def test_footprint_creation(self):
        fp = Footprint(
            reference="R1",
            value="10k",
            position=Point(x=Length.from_mm(50.0), y=Length.from_mm(30.0)),
            rotation=Angle(0.0),
            layer="F.Cu",
            pads=[
                Pad(number="1", shape=PadShape.RECT, size_x=Length.from_mm(1.0), size_y=Length.from_mm(0.6)),
                Pad(number="2", shape=PadShape.RECT, size_x=Length.from_mm(1.0), size_y=Length.from_mm(0.6)),
            ],
        )
        assert fp.reference == "R1"
        assert len(fp.pads) == 2
        assert fp.get_pad("1") is not None
        assert fp.get_pad("3") is None

    def test_footprint_with_3d_model(self):
        fp = Footprint(
            reference="U1",
            value="IC",
            model_3d=Model3D(path="/models/ic.step", scale=1.0),
        )
        assert fp.model_3d.path == "/models/ic.step"

    def test_zone_creation(self):
        zone = Zone(
            name="GND_Fill",
            net_ref="GND",
            layer="F.Cu",
            polygon=Polygon(points=[
                Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(80.0)),
                Point(x=Length.from_mm(0.0), y=Length.from_mm(80.0)),
            ]),
            fill_type=ZoneFillType.SOLID,
            clearance=Length.from_mm(0.3),
            min_width=Length.from_mm(0.25),
            priority=1,
            thermal_relief=ThermalRelief(
                gap=Length.from_mm(0.5),
                bridge_width=Length.from_mm(0.5),
            ),
        )
        assert zone.net_ref == "GND"
        assert zone.fill_type == ZoneFillType.SOLID
        assert zone.priority == 1

    def test_board_outline(self):
        outline = BoardOutline(
            polygon=Polygon(points=[
                Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(80.0)),
                Point(x=Length.from_mm(0.0), y=Length.from_mm(80.0)),
            ]),
            cutouts=[
                Polygon(points=[
                    Point(x=Length.from_mm(10.0), y=Length.from_mm(10.0)),
                    Point(x=Length.from_mm(15.0), y=Length.from_mm(10.0)),
                    Point(x=Length.from_mm(15.0), y=Length.from_mm(15.0)),
                    Point(x=Length.from_mm(10.0), y=Length.from_mm(15.0)),
                ]),
            ],
        )
        assert len(outline.cutouts) == 1

    def test_physical_json_round_trip(self):
        pad = Pad(
            number="1",
            shape=PadShape.OVAL,
            size_x=Length.from_mm(2.0),
            size_y=Length.from_mm(1.5),
            drill=Length.from_mm(0.8),
            pad_type=PadType.THROUGH_HOLE,
        )
        json_str = pad.model_dump_json()
        pad2 = Pad.model_validate_json(json_str)
        assert pad2.shape == PadShape.OVAL
        assert pad2.pad_type == PadType.THROUGH_HOLE
        assert math.isclose(pad2.drill.mm, 0.8, rel_tol=1e-9)


# ============================================================
# Constraint model tests
# ============================================================


class TestConstraintModels:
    """Tests for constraint and design rule models."""

    def test_net_class(self):
        nc = NetClass(
            name="HighSpeed",
            clearance=Length.from_mm(0.15),
            trace_width=Length.from_mm(0.1),
            via_drill=Length.from_mm(0.2),
            via_size=Length.from_mm(0.45),
            diff_pair_width=Length.from_mm(0.1),
            diff_pair_gap=Length.from_mm(0.12),
            nets=["USB_D+", "USB_D-"],
        )
        assert nc.name == "HighSpeed"
        assert len(nc.nets) == 2
        assert nc.diff_pair_width.mm == 0.1

    def test_net_class_defaults(self):
        nc = NetClass(name="Default")
        assert nc.clearance.mm == 0.2
        assert nc.trace_width.mm == 0.25
        assert nc.diff_pair_width is None

    def test_diff_pair(self):
        dp = DiffPair(
            name="USB_D",
            positive_net="USB_D+",
            negative_net="USB_D-",
            impedance_target=90.0,
            max_skew=Length.from_mm(0.5),
            gap=Length.from_mm(0.12),
            width=Length.from_mm(0.1),
        )
        assert dp.impedance_target == 90.0
        assert dp.max_skew.mm == 0.5

    def test_length_group(self):
        lg = LengthGroup(
            name="DDR4_DQ0",
            nets=["DQ0", "DQ1", "DQ2", "DQ3"],
            target_length=Length.from_mm(50.0),
            tolerance=Length.from_mm(1.0),
            priority=1,
        )
        assert len(lg.nets) == 4
        assert lg.target_length.mm == 50.0

    def test_keepout(self):
        ko = KeepOut(
            name="Antenna_Clearance",
            layer="All",
            polygon=Polygon(points=[
                Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(10.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(10.0), y=Length.from_mm(10.0)),
                Point(x=Length.from_mm(0.0), y=Length.from_mm(10.0)),
            ]),
            no_tracks=True,
            no_vias=True,
            no_copper=True,
        )
        assert ko.no_tracks is True
        assert ko.no_vias is True

    def test_design_rules(self):
        dr = DesignRules()
        assert dr.min_clearance.mm == 0.15
        assert dr.min_trace_width.mm == 0.15
        assert dr.min_via_drill.mm == 0.2

    def test_design_rules_custom(self):
        dr = DesignRules(
            min_clearance=Length.from_mil(4.0),
            min_trace_width=Length.from_mil(4.0),
            min_via_drill=Length.from_mil(8.0),
            min_via_size=Length.from_mil(16.0),
        )
        assert math.isclose(dr.min_clearance.mil, 4.0, rel_tol=1e-9)

    def test_constraint_json_round_trip(self):
        nc = NetClass(
            name="Power",
            clearance=Length.from_mm(0.3),
            trace_width=Length.from_mm(0.5),
            nets=["VCC", "GND"],
        )
        json_str = nc.model_dump_json()
        nc2 = NetClass.model_validate_json(json_str)
        assert nc2.name == "Power"
        assert len(nc2.nets) == 2
        assert math.isclose(nc2.trace_width.mm, 0.5, rel_tol=1e-9)


# ============================================================
# Stackup model tests
# ============================================================


class TestStackupModels:
    """Tests for stackup layer models."""

    def test_layer_creation(self):
        layer = Layer(
            name="F.Cu",
            layer_type=LayerType.SIGNAL,
            copper_weight=CopperWeight.ONE_OZ,
        )
        assert layer.name == "F.Cu"
        assert layer.thickness.mm == 0.035

    def test_dielectric_layer(self):
        dl = DielectricLayer(
            name="Core",
            thickness_mm=1.0,
            dielectric_constant=4.5,
            loss_tangent=0.02,
            material="FR-4",
        )
        assert dl.dielectric_constant == 4.5
        assert dl.thickness.mm == 1.0

    def test_2_layer_stackup(self):
        stackup = make_2_layer_stackup()
        assert stackup.layer_count == 2
        assert len(stackup.copper_layers) == 2
        assert len(stackup.dielectric_layers) == 1
        assert stackup.total_thickness == 1.6

    def test_4_layer_stackup(self):
        stackup = make_4_layer_stackup()
        assert stackup.layer_count == 4
        assert len(stackup.copper_layers) == 4
        assert len(stackup.dielectric_layers) == 3
        copper_names = [l.name for l in stackup.copper_layers]
        assert "F.Cu" in copper_names
        assert "In1.Cu" in copper_names
        assert "In2.Cu" in copper_names
        assert "B.Cu" in copper_names

    def test_6_layer_stackup(self):
        stackup = make_6_layer_stackup()
        assert stackup.layer_count == 6
        assert len(stackup.copper_layers) == 6

    def test_stackup_computed_thickness(self):
        stackup = make_2_layer_stackup()
        computed = stackup.computed_thickness
        assert computed > 0

    def test_stackup_json_round_trip(self):
        stackup = make_4_layer_stackup()
        json_str = stackup.model_dump_json()
        stackup2 = StackUp.model_validate_json(json_str)
        assert stackup2.layer_count == 4
        assert len(stackup2.layers) == len(stackup.layers)


# ============================================================
# Manufacturing model tests
# ============================================================


class TestManufacturingModels:
    """Tests for manufacturing data models."""

    def test_fabrication_spec(self):
        spec = FabricationSpec(
            layers=4,
            surface_finish=SurfaceFinish.ENIG,
            solder_mask_color=SolderMaskColor.BLACK,
            min_trace=Length.from_mil(4.0),
            min_space=Length.from_mil(4.0),
            min_drill=Length.from_mm(0.2),
            board_thickness=Length.from_mm(1.6),
            copper_weight=CopperWeight.ONE_OZ,
            material="FR-4",
            has_impedance_control=True,
        )
        assert spec.layers == 4
        assert spec.surface_finish == SurfaceFinish.ENIG
        assert spec.has_impedance_control is True

    def test_fabrication_spec_defaults(self):
        spec = FabricationSpec()
        assert spec.layers == 2
        assert spec.surface_finish == SurfaceFinish.HASL
        assert spec.solder_mask_color == SolderMaskColor.GREEN

    def test_bom_entry(self):
        entry = BOMEntry(
            reference="R1,R2,R3",
            value="10k",
            footprint="R_0402",
            quantity=3,
            manufacturer="Yageo",
            mpn="RC0402FR-0710KL",
            supplier="DigiKey",
            supplier_pn="311-10KLRCT-ND",
            unit_price=0.01,
            description="RES 10K OHM 1% 1/16W 0402",
        )
        assert entry.quantity == 3
        assert entry.total_price == 0.03

    def test_bom_entry_no_price(self):
        entry = BOMEntry(reference="J1", value="USB-C")
        assert entry.total_price is None

    def test_bom(self):
        bom = BOM(
            entries=[
                BOMEntry(reference="R1,R2", value="10k", quantity=2, unit_price=0.01),
                BOMEntry(reference="C1", value="100nF", quantity=1, unit_price=0.05),
                BOMEntry(reference="U1", value="MCU", quantity=1, unit_price=3.50),
            ]
        )
        assert bom.unique_part_count == 3
        assert bom.total_quantity == 4
        assert math.isclose(bom.computed_total_cost, 3.57, rel_tol=1e-6)

    def test_pick_and_place(self):
        pnp = PickAndPlace(
            reference="R1",
            value="10k",
            footprint="R_0402",
            x=Length.from_mm(50.0),
            y=Length.from_mm(30.0),
            rotation=Angle(90.0),
            side="top",
        )
        assert pnp.x.mm == 50.0
        assert pnp.rotation.degrees == 90.0
        assert pnp.side == "top"

    def test_assembly_data(self):
        asm = AssemblyData(
            pick_and_place=[
                PickAndPlace(reference="R1", side="top"),
                PickAndPlace(reference="R2", side="top"),
                PickAndPlace(reference="U1", side="bottom"),
            ],
            solder_paste_layers=[
                SolderPasteLayer(layer="F.Paste", openings=["R1.1", "R1.2", "R2.1", "R2.2"]),
                SolderPasteLayer(layer="B.Paste", openings=["U1.1"]),
            ],
        )
        assert asm.top_side_count == 2
        assert asm.bottom_side_count == 1

    def test_manufacturing_json_round_trip(self):
        spec = FabricationSpec(
            layers=4,
            surface_finish=SurfaceFinish.ENIG,
            solder_mask_color=SolderMaskColor.BLUE,
        )
        json_str = spec.model_dump_json()
        spec2 = FabricationSpec.model_validate_json(json_str)
        assert spec2.layers == 4
        assert spec2.surface_finish == SurfaceFinish.ENIG
        assert spec2.solder_mask_color == SolderMaskColor.BLUE

    def test_bom_json_round_trip(self):
        bom = BOM(
            entries=[
                BOMEntry(reference="R1", value="10k", quantity=1, unit_price=0.01),
            ]
        )
        json_str = bom.model_dump_json()
        bom2 = BOM.model_validate_json(json_str)
        assert bom2.entries[0].reference == "R1"
        assert bom2.entries[0].unit_price == 0.01


# ============================================================
# Nested/integrated model tests
# ============================================================


class TestNestedBoardDesign:
    """Tests for a complete BoardDesign with all nested structures."""

    def _make_full_board_design(self) -> BoardDesign:
        """Create a complete board design with all element types."""
        # Pads for a resistor footprint
        pad1 = Pad(
            number="1",
            shape=PadShape.RECT,
            size_x=Length.from_mm(1.0),
            size_y=Length.from_mm(0.6),
            layers=["F.Cu", "F.Paste", "F.Mask"],
            position=Point(x=Length.from_mm(-0.95), y=Length.from_mm(0.0)),
            pad_type=PadType.SMD,
            net_ref="VCC",
        )
        pad2 = Pad(
            number="2",
            shape=PadShape.RECT,
            size_x=Length.from_mm(1.0),
            size_y=Length.from_mm(0.6),
            layers=["F.Cu", "F.Paste", "F.Mask"],
            position=Point(x=Length.from_mm(0.95), y=Length.from_mm(0.0)),
            pad_type=PadType.SMD,
            net_ref="NET1",
        )

        # Footprint
        fp = Footprint(
            reference="R1",
            value="10k",
            position=Point(x=Length.from_mm(50.0), y=Length.from_mm(30.0)),
            rotation=Angle(0.0),
            layer="F.Cu",
            pads=[pad1, pad2],
            courtyard=Polygon(points=[
                Point(x=Length.from_mm(-1.5), y=Length.from_mm(-0.5)),
                Point(x=Length.from_mm(1.5), y=Length.from_mm(-0.5)),
                Point(x=Length.from_mm(1.5), y=Length.from_mm(0.5)),
                Point(x=Length.from_mm(-1.5), y=Length.from_mm(0.5)),
            ]),
            silkscreen_lines=[
                Line(
                    start=Point(x=Length.from_mm(-1.0), y=Length.from_mm(-0.4)),
                    end=Point(x=Length.from_mm(1.0), y=Length.from_mm(-0.4)),
                ),
                Line(
                    start=Point(x=Length.from_mm(-1.0), y=Length.from_mm(0.4)),
                    end=Point(x=Length.from_mm(1.0), y=Length.from_mm(0.4)),
                ),
            ],
        )

        # Trace
        trace = TraceSegment(
            start=Point(x=Length.from_mm(51.0), y=Length.from_mm(30.0)),
            end=Point(x=Length.from_mm(60.0), y=Length.from_mm(30.0)),
            width=Length.from_mm(0.25),
            layer="F.Cu",
            net_ref="NET1",
        )

        # Via
        via = Via(
            position=Point(x=Length.from_mm(60.0), y=Length.from_mm(30.0)),
            drill=Length.from_mm(0.3),
            size=Length.from_mm(0.6),
            layers=["F.Cu", "B.Cu"],
            net_ref="NET1",
            via_type=ViaType.THROUGH,
        )

        # Zone
        zone = Zone(
            name="GND_Fill",
            net_ref="GND",
            layer="B.Cu",
            polygon=Polygon(points=[
                Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(80.0)),
                Point(x=Length.from_mm(0.0), y=Length.from_mm(80.0)),
            ]),
            fill_type=ZoneFillType.SOLID,
            clearance=Length.from_mm(0.3),
            min_width=Length.from_mm(0.25),
            priority=0,
        )

        # Board outline
        outline = BoardOutline(
            polygon=Polygon(points=[
                Point(x=Length.from_mm(0.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(0.0)),
                Point(x=Length.from_mm(100.0), y=Length.from_mm(80.0)),
                Point(x=Length.from_mm(0.0), y=Length.from_mm(80.0)),
            ]),
        )

        # Stackup
        stackup = make_4_layer_stackup()

        # Design rules
        rules = DesignRules(
            min_clearance=Length.from_mm(0.15),
            min_trace_width=Length.from_mm(0.15),
            min_via_drill=Length.from_mm(0.2),
        )

        # Net classes
        default_nc = NetClass(
            name="Default",
            clearance=Length.from_mm(0.2),
            trace_width=Length.from_mm(0.25),
            nets=["NET1", "NET2"],
        )
        power_nc = NetClass(
            name="Power",
            clearance=Length.from_mm(0.3),
            trace_width=Length.from_mm(0.5),
            nets=["VCC", "GND"],
        )

        return BoardDesign(
            title="Test PCB",
            footprints=[fp],
            traces=[trace],
            vias=[via],
            zones=[zone],
            outline=outline,
            stackup=stackup,
            design_rules=rules,
            nets=["VCC", "GND", "NET1", "NET2"],
            net_classes=[default_nc, power_nc],
        )

    def test_full_board_creation(self):
        board = self._make_full_board_design()
        assert board.title == "Test PCB"
        assert board.footprint_count == 1
        assert board.trace_count == 1
        assert board.via_count == 1
        assert len(board.zones) == 1
        assert board.outline is not None
        assert board.stackup is not None
        assert board.stackup.layer_count == 4
        assert board.design_rules is not None
        assert len(board.net_classes) == 2
        assert len(board.nets) == 4

    def test_full_board_get_footprint(self):
        board = self._make_full_board_design()
        r1 = board.get_footprint("R1")
        assert r1 is not None
        assert r1.value == "10k"
        assert len(r1.pads) == 2
        assert r1.get_pad("1").net_ref == "VCC"

    def test_full_board_json_round_trip(self):
        board = self._make_full_board_design()
        json_str = board.model_dump_json()
        data = json.loads(json_str)
        assert data["title"] == "Test PCB"

        board2 = BoardDesign.model_validate_json(json_str)
        assert board2.title == "Test PCB"
        assert board2.footprint_count == 1
        assert board2.trace_count == 1
        assert board2.via_count == 1
        assert len(board2.zones) == 1
        assert board2.outline is not None
        assert board2.stackup.layer_count == 4
        assert len(board2.net_classes) == 2

        # Verify nested data survived
        r1 = board2.get_footprint("R1")
        assert r1.value == "10k"
        assert len(r1.pads) == 2
        assert r1.pads[0].shape == PadShape.RECT

    def test_full_board_json_size(self):
        """Verify JSON serialization produces reasonable output."""
        board = self._make_full_board_design()
        json_str = board.model_dump_json()
        # Should produce meaningful JSON, not empty
        assert len(json_str) > 500

    def test_board_design_defaults(self):
        """Test that a BoardDesign with all defaults is valid."""
        board = BoardDesign()
        assert board.title == "Untitled"
        assert board.footprint_count == 0
        assert board.trace_count == 0
        assert board.via_count == 0
        assert board.outline is None
        assert board.stackup is None
        assert board.design_rules is None


# ============================================================
# Default and Optional field tests
# ============================================================


class TestDefaultsAndOptionals:
    """Tests for default values and optional fields across all models."""

    def test_point_default(self):
        p = Point()
        assert p.x.mm == 0.0
        assert p.y.mm == 0.0

    def test_pin_optional_net_ref(self):
        pin = Pin(number="1")
        assert pin.net_ref is None

    def test_component_optional_fields(self):
        comp = Component(reference="R1")
        assert comp.value == ""
        assert comp.footprint == ""
        assert len(comp.pins) == 0
        assert len(comp.properties) == 0

    def test_pad_optional_drill(self):
        pad = Pad()
        assert pad.drill is None

    def test_via_defaults(self):
        via = Via()
        assert via.drill.mm == 0.3
        assert via.size.mm == 0.6
        assert via.via_type == ViaType.THROUGH

    def test_zone_defaults(self):
        zone = Zone()
        assert zone.net_ref is None
        assert zone.fill_type == ZoneFillType.SOLID
        assert zone.priority == 0

    def test_diff_pair_optional_fields(self):
        dp = DiffPair(name="USB", positive_net="D+", negative_net="D-")
        assert dp.impedance_target is None
        assert dp.max_skew is None
        assert dp.gap is None
        assert dp.width is None

    def test_length_group_optional_target(self):
        lg = LengthGroup(name="Test")
        assert lg.target_length is None
        assert lg.tolerance.mm == 1.0

    def test_stackup_layer_property(self):
        sl_copper = StackupLayer(copper=Layer(name="F.Cu"))
        sl_diel = StackupLayer(dielectric=DielectricLayer(name="Core"))
        assert sl_copper.is_copper is True
        assert sl_diel.is_copper is False
        assert sl_copper.name == "F.Cu"
        assert sl_diel.name == "Core"

    def test_bom_entry_defaults(self):
        entry = BOMEntry(reference="R1")
        assert entry.value == ""
        assert entry.quantity == 1
        assert entry.unit_price is None
        assert entry.manufacturer == ""

    def test_assembly_data_defaults(self):
        asm = AssemblyData()
        assert asm.top_side_count == 0
        assert asm.bottom_side_count == 0


# ============================================================
# Pydantic integration tests for custom types
# ============================================================


class TestPydanticIntegration:
    """Tests for Length and Angle Pydantic v2 integration."""

    def test_length_in_model_from_float(self):
        """Length fields should accept plain float values (interpreted as mm)."""
        pad = Pad.model_validate({
            "number": "1",
            "shape": "circle",
            "size_x": 1.5,
            "size_y": 1.5,
        })
        assert pad.size_x.mm == 1.5

    def test_angle_in_model_from_float(self):
        """Angle fields should accept plain float values (interpreted as degrees)."""
        comp = Component.model_validate({
            "reference": "R1",
            "rotation": 45.0,
        })
        assert comp.rotation.degrees == 45.0

    def test_length_serialization(self):
        """Length should serialize to a float (mm value)."""
        pad = Pad(size_x=Length.from_mm(2.5), size_y=Length.from_mm(1.0))
        data = pad.model_dump()
        assert isinstance(data["size_x"], float)
        assert data["size_x"] == 2.5

    def test_angle_serialization(self):
        """Angle should serialize to a float (degrees value)."""
        comp = Component(reference="R1", rotation=Angle(90.0))
        data = comp.model_dump()
        assert isinstance(data["rotation"], float)
        assert data["rotation"] == 90.0
