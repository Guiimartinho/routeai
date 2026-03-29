"""Tests for the DRC engine and individual checkers.

Tests geometric, electrical, and manufacturing DRC checks using
known board geometries with expected pass/fail results.
"""

from __future__ import annotations

import pytest
from shapely.geometry import Polygon as ShapelyPolygon

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    DesignRules,
    DrillHole,
    Layer,
    LayerType,
    Net,
    Pad,
    PadShape,
    Trace,
    TraceSegment,
    Via,
)
from routeai_solver.drc.engine import DRCEngine, DRCSeverity
from routeai_solver.drc.geometric import (
    check_board_edge_clearance,
    check_clearance,
    check_min_annular_ring,
    check_min_trace_width,
)
from routeai_solver.drc.electrical import check_connectivity, check_short_circuits
from routeai_solver.drc.manufacturing import (
    JLCPCB_STANDARD,
    OSHPARK,
    FabProfile,
    check_drill_to_copper,
    check_min_drill,
    check_solder_mask,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def f_cu() -> Layer:
    return Layer("F.Cu", LayerType.COPPER, index=0)


@pytest.fixture
def b_cu() -> Layer:
    return Layer("B.Cu", LayerType.COPPER, index=1)


@pytest.fixture
def net_vcc() -> Net:
    return Net("VCC", id=1)


@pytest.fixture
def net_gnd() -> Net:
    return Net("GND", id=2)


@pytest.fixture
def net_sig() -> Net:
    return Net("SIG", id=3)


@pytest.fixture
def design_rules() -> DesignRules:
    return DesignRules(
        min_trace_width=0.15,
        min_clearance=0.15,
        min_annular_ring=0.13,
        min_drill=0.3,
        board_edge_clearance=0.25,
    )


def _make_board(
    traces: list[Trace] | None = None,
    pads: list[Pad] | None = None,
    vias: list[Via] | None = None,
    drills: list[DrillHole] | None = None,
    zones: list[CopperZone] | None = None,
    layers: list[Layer] | None = None,
    nets: list[Net] | None = None,
    rules: DesignRules | None = None,
    outline: ShapelyPolygon | None = None,
) -> BoardDesign:
    """Helper to create a board with defaults."""
    f_cu = Layer("F.Cu", LayerType.COPPER, index=0)
    b_cu = Layer("B.Cu", LayerType.COPPER, index=1)
    return BoardDesign(
        name="TestBoard",
        traces=traces or [],
        pads=pads or [],
        vias=vias or [],
        zones=zones or [],
        drills=drills or [],
        nets=nets or [Net("VCC", 1), Net("GND", 2)],
        layers=layers or [f_cu, b_cu],
        design_rules=rules or DesignRules(),
        outline=outline,
    )


# ---------------------------------------------------------------------------
# Geometric DRC tests
# ---------------------------------------------------------------------------

class TestClearance:
    """Test clearance violation detection."""

    def test_no_violation_sufficient_clearance(self, f_cu, net_vcc, net_gnd):
        """Two traces far apart should produce no clearance violations."""
        t1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        t2 = Trace(net=net_gnd, layer=f_cu, segments=[
            TraceSegment(0.0, 2.0, 10.0, 2.0, width=0.2),
        ])
        board = _make_board(
            traces=[t1, t2],
            nets=[net_vcc, net_gnd],
            rules=DesignRules(min_clearance=0.15),
        )
        violations = check_clearance(board)
        assert len(violations) == 0

    def test_violation_traces_too_close(self, f_cu, net_vcc, net_gnd):
        """Two traces with less than min_clearance should trigger a violation."""
        # Traces are 0.3mm apart center-to-center, 0.2mm wide each
        # Edge-to-edge = 0.3 - 0.1 - 0.1 = 0.1mm < 0.15mm min
        t1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        t2 = Trace(net=net_gnd, layer=f_cu, segments=[
            TraceSegment(0.0, 0.3, 10.0, 0.3, width=0.2),
        ])
        board = _make_board(
            traces=[t1, t2],
            nets=[net_vcc, net_gnd],
            rules=DesignRules(min_clearance=0.15),
        )
        violations = check_clearance(board)
        assert len(violations) > 0
        assert violations[0].severity == DRCSeverity.ERROR
        assert "clearance" in violations[0].rule.lower()

    def test_same_net_no_violation(self, f_cu, net_vcc):
        """Traces on the same net should not be checked against each other."""
        t1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        t2 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.15, 10.0, 0.15, width=0.2),
        ])
        board = _make_board(
            traces=[t1, t2],
            nets=[net_vcc],
            rules=DesignRules(min_clearance=0.15),
        )
        violations = check_clearance(board)
        assert len(violations) == 0

    def test_trace_pad_clearance_violation(self, f_cu, net_vcc, net_gnd):
        """Trace too close to a pad on a different net."""
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        pad = Pad(
            net=net_gnd, layer=f_cu,
            x=5.0, y=0.25,  # very close to trace
            shape=PadShape.CIRCLE, width=0.3, height=0.3,
        )
        board = _make_board(
            traces=[trace],
            pads=[pad],
            nets=[net_vcc, net_gnd],
            rules=DesignRules(min_clearance=0.15),
        )
        violations = check_clearance(board)
        assert len(violations) > 0


class TestMinTraceWidth:
    """Test minimum trace width detection."""

    def test_width_ok(self, f_cu, net_vcc):
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace],
            rules=DesignRules(min_trace_width=0.15),
        )
        violations = check_min_trace_width(board)
        assert len(violations) == 0

    def test_width_violation(self, f_cu, net_vcc):
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.1),  # too narrow
        ])
        board = _make_board(
            traces=[trace],
            rules=DesignRules(min_trace_width=0.15),
        )
        violations = check_min_trace_width(board)
        assert len(violations) == 1
        assert violations[0].severity == DRCSeverity.ERROR
        assert "width" in violations[0].message.lower()

    def test_mixed_widths(self, f_cu, net_vcc):
        """Only the narrow segments should trigger violations."""
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 5.0, 0.0, width=0.2),   # OK
            TraceSegment(5.0, 0.0, 10.0, 0.0, width=0.08),  # too narrow
        ])
        board = _make_board(
            traces=[trace],
            rules=DesignRules(min_trace_width=0.15),
        )
        violations = check_min_trace_width(board)
        assert len(violations) == 1


class TestAnnularRing:
    """Test annular ring checks."""

    def test_ring_ok(self, f_cu, net_vcc, b_cu):
        pad = Pad(
            net=net_vcc, layer=f_cu,
            x=5.0, y=5.0,
            shape=PadShape.CIRCLE,
            width=1.0, height=1.0,
            drill=0.5,  # annular ring = (1.0 - 0.5)/2 = 0.25mm
        )
        board = _make_board(
            pads=[pad],
            rules=DesignRules(min_annular_ring=0.13),
        )
        violations = check_min_annular_ring(board)
        assert len(violations) == 0

    def test_ring_violation_pad(self, f_cu, net_vcc):
        pad = Pad(
            net=net_vcc, layer=f_cu,
            x=5.0, y=5.0,
            shape=PadShape.CIRCLE,
            width=0.55, height=0.55,
            drill=0.4,  # annular ring = (0.55 - 0.4)/2 = 0.075mm
        )
        board = _make_board(
            pads=[pad],
            rules=DesignRules(min_annular_ring=0.13),
        )
        violations = check_min_annular_ring(board)
        assert len(violations) == 1
        assert "annular" in violations[0].rule.lower()

    def test_ring_violation_via(self, f_cu, b_cu, net_vcc):
        via = Via(
            net=net_vcc, x=5.0, y=5.0,
            drill=0.3, diameter=0.5,  # ring = (0.5-0.3)/2 = 0.1mm
            start_layer=f_cu, end_layer=b_cu,
        )
        board = _make_board(
            vias=[via],
            rules=DesignRules(min_annular_ring=0.13),
        )
        violations = check_min_annular_ring(board)
        assert len(violations) == 1

    def test_smd_pad_no_check(self, f_cu, net_vcc):
        """SMD pads (drill=0) should not be checked for annular ring."""
        pad = Pad(
            net=net_vcc, layer=f_cu,
            x=5.0, y=5.0,
            shape=PadShape.RECT,
            width=1.0, height=0.5,
            drill=0.0,
        )
        board = _make_board(
            pads=[pad],
            rules=DesignRules(min_annular_ring=0.13),
        )
        violations = check_min_annular_ring(board)
        assert len(violations) == 0


class TestBoardEdgeClearance:
    """Test board edge clearance checks."""

    def test_edge_clearance_ok(self, f_cu, net_vcc):
        outline = ShapelyPolygon([
            (0, 0), (50, 0), (50, 50), (0, 50),
        ])
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(5.0, 25.0, 45.0, 25.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace],
            outline=outline,
            rules=DesignRules(board_edge_clearance=0.25),
        )
        violations = check_board_edge_clearance(board)
        assert len(violations) == 0

    def test_edge_clearance_violation(self, f_cu, net_vcc):
        outline = ShapelyPolygon([
            (0, 0), (50, 0), (50, 50), (0, 50),
        ])
        # Trace running along the top edge, very close
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(5.0, 49.9, 45.0, 49.9, width=0.2),  # 0.0mm from edge
        ])
        board = _make_board(
            traces=[trace],
            outline=outline,
            rules=DesignRules(board_edge_clearance=0.25),
        )
        violations = check_board_edge_clearance(board)
        assert len(violations) > 0


# ---------------------------------------------------------------------------
# Electrical DRC tests
# ---------------------------------------------------------------------------

class TestConnectivity:
    """Test connectivity checker."""

    def test_connected_net(self, f_cu, net_vcc):
        """Pads connected by a trace should not trigger violations."""
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="R1", pad_number="1",
        )
        pad2 = Pad(
            net=net_vcc, layer=f_cu,
            x=10.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="R1", pad_number="2",
        )
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace],
            pads=[pad1, pad2],
            nets=[net_vcc],
        )
        violations = check_connectivity(board)
        assert len(violations) == 0

    def test_unconnected_net(self, f_cu, net_vcc):
        """Pads in the same net with no trace should trigger a violation."""
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="U1", pad_number="1",
        )
        pad2 = Pad(
            net=net_vcc, layer=f_cu,
            x=20.0, y=20.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="C1", pad_number="1",
        )
        board = _make_board(
            pads=[pad1, pad2],
            nets=[net_vcc],
        )
        violations = check_connectivity(board)
        assert len(violations) > 0
        assert violations[0].severity == DRCSeverity.ERROR

    def test_via_connects_layers(self, f_cu, b_cu, net_vcc):
        """Pads on different layers connected through a via."""
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="U1", pad_number="1",
        )
        pad2 = Pad(
            net=net_vcc, layer=b_cu,
            x=10.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="U2", pad_number="1",
        )
        # Trace on front copper to via
        trace1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 5.0, 0.0, width=0.2),
        ])
        via = Via(
            net=net_vcc, x=5.0, y=0.0,
            drill=0.3, diameter=0.6,
            start_layer=f_cu, end_layer=b_cu,
        )
        # Trace on back copper from via
        trace2 = Trace(net=net_vcc, layer=b_cu, segments=[
            TraceSegment(5.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace1, trace2],
            pads=[pad1, pad2],
            vias=[via],
            nets=[net_vcc],
            layers=[f_cu, b_cu],
        )
        violations = check_connectivity(board)
        assert len(violations) == 0


class TestShortCircuits:
    """Test short circuit detection."""

    def test_no_short(self, f_cu, net_vcc, net_gnd):
        """Non-overlapping traces on different nets should be fine."""
        t1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        t2 = Trace(net=net_gnd, layer=f_cu, segments=[
            TraceSegment(0.0, 5.0, 10.0, 5.0, width=0.2),
        ])
        board = _make_board(
            traces=[t1, t2],
            nets=[net_vcc, net_gnd],
        )
        violations = check_short_circuits(board)
        assert len(violations) == 0

    def test_short_overlapping_traces(self, f_cu, net_vcc, net_gnd):
        """Overlapping traces on different nets should trigger a short."""
        t1 = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.5),
        ])
        # Crossing trace
        t2 = Trace(net=net_gnd, layer=f_cu, segments=[
            TraceSegment(5.0, -5.0, 5.0, 5.0, width=0.5),
        ])
        board = _make_board(
            traces=[t1, t2],
            nets=[net_vcc, net_gnd],
        )
        violations = check_short_circuits(board)
        assert len(violations) > 0
        assert violations[0].severity == DRCSeverity.ERROR
        assert "short" in violations[0].rule.lower()

    def test_short_pad_trace_overlap(self, f_cu, net_vcc, net_gnd):
        """A trace running over a pad from a different net is a short."""
        pad = Pad(
            net=net_gnd, layer=f_cu,
            x=5.0, y=0.0,
            shape=PadShape.CIRCLE, width=1.0, height=1.0,
        )
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.5),
        ])
        board = _make_board(
            traces=[trace],
            pads=[pad],
            nets=[net_vcc, net_gnd],
        )
        violations = check_short_circuits(board)
        assert len(violations) > 0


# ---------------------------------------------------------------------------
# Manufacturing DRC tests
# ---------------------------------------------------------------------------

class TestMinDrill:
    """Test minimum drill size checks."""

    def test_drill_ok(self, f_cu, net_vcc, b_cu):
        via = Via(
            net=net_vcc, x=5.0, y=5.0,
            drill=0.4, diameter=0.8,
            start_layer=f_cu, end_layer=b_cu,
        )
        board = _make_board(vias=[via])
        violations = check_min_drill(board, JLCPCB_STANDARD)
        assert len(violations) == 0

    def test_drill_violation(self, f_cu, net_vcc, b_cu):
        via = Via(
            net=net_vcc, x=5.0, y=5.0,
            drill=0.15, diameter=0.35,  # too small for JLCPCB_STANDARD
            start_layer=f_cu, end_layer=b_cu,
        )
        board = _make_board(vias=[via])
        violations = check_min_drill(board, JLCPCB_STANDARD)
        assert len(violations) > 0

    def test_oshpark_profile(self, f_cu, net_vcc, b_cu):
        """OSH Park has different minimum drill than JLCPCB."""
        via = Via(
            net=net_vcc, x=5.0, y=5.0,
            drill=0.25, diameter=0.5,
            start_layer=f_cu, end_layer=b_cu,
        )
        board = _make_board(vias=[via])
        # 0.25mm is below OSH Park min of 0.254mm
        violations = check_min_drill(board, OSHPARK)
        assert len(violations) > 0


class TestDrillToCopper:
    """Test drill-to-copper clearance."""

    def test_npth_far_from_copper(self, f_cu, net_vcc):
        drill = DrillHole(x=25.0, y=25.0, diameter=3.0, plated=False)
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(traces=[trace], drills=[drill])
        violations = check_drill_to_copper(board)
        assert len(violations) == 0

    def test_npth_too_close_to_trace(self, f_cu, net_vcc):
        drill = DrillHole(x=5.0, y=0.3, diameter=1.0, plated=False)
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace],
            drills=[drill],
            rules=DesignRules(drill_to_copper_clearance=0.2),
        )
        violations = check_drill_to_copper(board)
        assert len(violations) > 0


class TestSolderMask:
    """Test solder mask bridge checks."""

    def test_pads_far_apart_no_violation(self, f_cu, net_vcc, net_gnd):
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0,
            component_ref="U1", pad_number="1",
        )
        pad2 = Pad(
            net=net_gnd, layer=f_cu,
            x=5.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0,
            component_ref="U1", pad_number="2",
        )
        board = _make_board(pads=[pad1, pad2], nets=[net_vcc, net_gnd])
        violations = check_solder_mask(board)
        assert len(violations) == 0

    def test_pads_close_mask_violation(self, f_cu, net_vcc, net_gnd):
        """Two pads close together with overlapping mask openings."""
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=0.6, height=0.6,
            component_ref="U1", pad_number="1",
        )
        pad2 = Pad(
            net=net_gnd, layer=f_cu,
            x=0.7, y=0.0, shape=PadShape.CIRCLE,
            width=0.6, height=0.6,
            component_ref="U1", pad_number="2",
        )
        board = _make_board(
            pads=[pad1, pad2],
            nets=[net_vcc, net_gnd],
            rules=DesignRules(solder_mask_expansion=0.05, min_solder_mask_bridge=0.1),
        )
        violations = check_solder_mask(board)
        # Gap between pad edges = 0.7 - 0.3 - 0.3 = 0.1mm
        # Mask openings expand by 0.05mm each side, so gap = 0.1 - 0.1 = 0.0mm
        assert len(violations) > 0


# ---------------------------------------------------------------------------
# DRC Engine integration test
# ---------------------------------------------------------------------------

class TestDRCEngine:
    """Test the main DRC engine orchestrator."""

    def test_clean_board_passes(self, f_cu, b_cu, net_vcc):
        """A simple board with proper clearances should pass."""
        pad1 = Pad(
            net=net_vcc, layer=f_cu,
            x=0.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="R1", pad_number="1",
        )
        pad2 = Pad(
            net=net_vcc, layer=f_cu,
            x=10.0, y=0.0, shape=PadShape.CIRCLE,
            width=1.0, height=1.0, drill=0.5,
            component_ref="R1", pad_number="2",
        )
        trace = Trace(net=net_vcc, layer=f_cu, segments=[
            TraceSegment(0.0, 0.0, 10.0, 0.0, width=0.2),
        ])
        board = _make_board(
            traces=[trace],
            pads=[pad1, pad2],
            nets=[net_vcc],
            layers=[f_cu, b_cu],
        )

        engine = DRCEngine(run_manufacturing=False)
        report = engine.run(board)
        assert report.passed
        assert report.error_count == 0

    def test_report_summary(self, f_cu, net_vcc):
        """Engine report should have a valid summary string."""
        board = _make_board(nets=[net_vcc])
        engine = DRCEngine()
        report = engine.run(board)
        summary = report.summary()
        assert "DRC" in summary
        assert "errors" in summary
