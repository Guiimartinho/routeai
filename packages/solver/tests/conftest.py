"""Shared test fixtures for routeai_solver tests."""

from __future__ import annotations

import pytest

from routeai_solver.board_model import (
    BoardDesign,
    DesignRules,
    Layer,
    LayerType,
    Net,
    Pad,
    PadShape,
    StackupLayer,
    Trace,
    TraceSegment,
    Via,
)


@pytest.fixture
def default_rules() -> DesignRules:
    return DesignRules(
        min_trace_width=0.15,
        min_clearance=0.15,
        min_annular_ring=0.13,
        min_drill=0.2,
        board_edge_clearance=0.25,
    )


@pytest.fixture
def copper_layers() -> list[Layer]:
    return [
        Layer(name="F.Cu", layer_type=LayerType.COPPER, index=0),
        Layer(name="In1.Cu", layer_type=LayerType.COPPER, index=1),
        Layer(name="In2.Cu", layer_type=LayerType.COPPER, index=2),
        Layer(name="B.Cu", layer_type=LayerType.COPPER, index=3),
    ]


@pytest.fixture
def four_layer_stackup() -> list[StackupLayer]:
    return [
        StackupLayer(name="F.Cu", thickness_mm=0.035, material="copper"),
        StackupLayer(name="Prepreg1", thickness_mm=0.2, material="FR-4", epsilon_r=4.3),
        StackupLayer(name="In1.Cu", thickness_mm=0.035, material="copper"),
        StackupLayer(name="Core", thickness_mm=1.0, material="FR-4", epsilon_r=4.3),
        StackupLayer(name="In2.Cu", thickness_mm=0.035, material="copper"),
        StackupLayer(name="Prepreg2", thickness_mm=0.2, material="FR-4", epsilon_r=4.3),
        StackupLayer(name="B.Cu", thickness_mm=0.035, material="copper"),
    ]


@pytest.fixture
def sample_nets() -> list[Net]:
    return [
        Net(name="GND", id=1),
        Net(name="VCC", id=2),
        Net(name="SDA", id=3),
        Net(name="SCL", id=4),
    ]


@pytest.fixture
def sample_pads() -> list[Pad]:
    return [
        Pad(
            net=Net(name="VCC", id=2),
            layer=Layer(name="F.Cu", layer_type=LayerType.COPPER, index=0),
            x=10.0,
            y=10.0,
            shape=PadShape.RECT,
            width=1.5,
            height=1.0,
        ),
        Pad(
            net=Net(name="GND", id=1),
            layer=Layer(name="F.Cu", layer_type=LayerType.COPPER, index=0),
            x=20.0,
            y=10.0,
            shape=PadShape.CIRCLE,
            width=1.0,
            height=1.0,
        ),
    ]


@pytest.fixture
def sample_traces() -> list[Trace]:
    net = Net(name="VCC", id=2)
    layer = Layer(name="F.Cu", layer_type=LayerType.COPPER, index=0)
    return [
        Trace(
            net=net,
            layer=layer,
            segments=[
                TraceSegment(start_x=10.0, start_y=10.0, end_x=15.0, end_y=10.0, width=0.25),
            ],
        ),
    ]


@pytest.fixture
def sample_vias() -> list[Via]:
    return [
        Via(
            net=Net(name="VCC", id=2),
            x=15.0,
            y=10.0,
            drill=0.3,
            diameter=0.6,
            start_layer=Layer(name="F.Cu", layer_type=LayerType.COPPER, index=0),
            end_layer=Layer(name="B.Cu", layer_type=LayerType.COPPER, index=3),
        ),
    ]


@pytest.fixture
def sample_board(
    copper_layers: list[Layer],
    four_layer_stackup: list[StackupLayer],
    sample_nets: list[Net],
    sample_pads: list[Pad],
    sample_traces: list[Trace],
    sample_vias: list[Via],
    default_rules: DesignRules,
) -> BoardDesign:
    from shapely.geometry import box

    return BoardDesign(
        layers=copper_layers,
        stackup=four_layer_stackup,
        nets=sample_nets,
        components=[],
        traces=sample_traces,
        pads=sample_pads,
        vias=sample_vias,
        zones=[],
        outline=box(0, 0, 50, 50),
        design_rules=default_rules,
    )
