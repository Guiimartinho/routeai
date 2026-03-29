"""Shared test fixtures for routeai_core tests."""

from __future__ import annotations

import pytest

from routeai_core import (
    Angle,
    BoardDesign,
    BoardOutline,
    Component,
    DesignRules,
    Footprint,
    Length,
    Net,
    Pad,
    PadShape,
    PadType,
    Pin,
    Point,
    Polygon,
    SchematicDesign,
    TraceSegment,
    Via,
    ViaType,
    Zone,
    ZoneFillType,
    make_4_layer_stackup,
)


@pytest.fixture
def origin() -> Point:
    return Point(x=Length.from_mm(0), y=Length.from_mm(0))


@pytest.fixture
def sample_point() -> Point:
    return Point(x=Length.from_mm(10.0), y=Length.from_mm(20.0))


@pytest.fixture
def sample_polygon() -> Polygon:
    return Polygon(
        points=[
            Point(x=Length.from_mm(0), y=Length.from_mm(0)),
            Point(x=Length.from_mm(10), y=Length.from_mm(0)),
            Point(x=Length.from_mm(10), y=Length.from_mm(10)),
            Point(x=Length.from_mm(0), y=Length.from_mm(10)),
        ]
    )


@pytest.fixture
def sample_pad() -> Pad:
    return Pad(
        number="1",
        shape=PadShape.RECT,
        size_x=Length.from_mm(1.5),
        size_y=Length.from_mm(1.0),
        drill=Length.from_mm(0.8),
        layers=["F.Cu", "B.Cu"],
        position=Point(x=Length.from_mm(0), y=Length.from_mm(0)),
        net_ref="VCC",
        pad_type=PadType.THROUGH_HOLE,
    )


@pytest.fixture
def sample_via() -> Via:
    return Via(
        position=Point(x=Length.from_mm(5), y=Length.from_mm(5)),
        drill=Length.from_mm(0.3),
        size=Length.from_mm(0.6),
        layers=["F.Cu", "B.Cu"],
        net_ref="GND",
        via_type=ViaType.THROUGH,
    )


@pytest.fixture
def sample_trace() -> TraceSegment:
    return TraceSegment(
        start=Point(x=Length.from_mm(0), y=Length.from_mm(0)),
        end=Point(x=Length.from_mm(10), y=Length.from_mm(0)),
        width=Length.from_mm(0.25),
        layer="F.Cu",
        net_ref="SDA",
    )


@pytest.fixture
def sample_footprint(sample_pad: Pad) -> Footprint:
    return Footprint(
        reference="R1",
        value="10k",
        position=Point(x=Length.from_mm(25), y=Length.from_mm(25)),
        rotation=Angle.from_degrees(0),
        layer="F.Cu",
        pads=[sample_pad],
    )


@pytest.fixture
def sample_component() -> Component:
    return Component(
        reference="U1",
        value="STM32F103",
        footprint="LQFP-48",
        position=Point(x=Length.from_mm(50), y=Length.from_mm(50)),
        rotation=Angle.from_degrees(0),
        layer="F.Cu",
        pins=[
            Pin(number="1", name="VDD", position=Point(x=Length.from_mm(0), y=Length.from_mm(0))),
            Pin(number="2", name="GND", position=Point(x=Length.from_mm(1), y=Length.from_mm(0))),
        ],
    )


@pytest.fixture
def sample_design_rules() -> DesignRules:
    return DesignRules()


@pytest.fixture
def sample_board(
    sample_footprint: Footprint,
    sample_trace: TraceSegment,
    sample_via: Via,
    sample_polygon: Polygon,
) -> BoardDesign:
    return BoardDesign(
        title="Test Board",
        footprints=[sample_footprint],
        traces=[sample_trace],
        vias=[sample_via],
        zones=[
            Zone(
                name="GND",
                net_ref="GND",
                layer="F.Cu",
                polygon=sample_polygon,
                fill_type=ZoneFillType.SOLID,
            )
        ],
        outline=BoardOutline(polygon=sample_polygon),
        stackup=make_4_layer_stackup(),
        nets=[Net(name="GND"), Net(name="VCC"), Net(name="SDA")],
    )


@pytest.fixture
def sample_schematic(sample_component: Component) -> SchematicDesign:
    return SchematicDesign(
        title="Test Schematic",
        components=[sample_component],
        nets=[Net(name="VDD"), Net(name="GND")],
    )
