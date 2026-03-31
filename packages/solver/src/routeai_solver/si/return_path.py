"""Return path continuity analyzer for high-speed PCB designs.

Checks reference plane continuity under high-speed traces, detects
slots and splits, analyzes via transitions for reference plane switches,
and suggests stitching via placements.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from shapely.geometry import LineString
from shapely.ops import unary_union

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    LayerType,
    Net,
    StackupLayer,
    Trace,
)

# ---------------------------------------------------------------------------
# Result data classes
# ---------------------------------------------------------------------------

@dataclass
class PlaneDiscontinuity:
    """A detected discontinuity in a reference plane."""

    location: tuple[float, float]
    layer: str
    discontinuity_type: str  # "slot", "split", "gap", "cutout"
    width_mm: float  # width of the gap/slot
    length_mm: float  # length of the discontinuity
    affected_nets: list[str] = field(default_factory=list)
    severity: str = "warning"  # "error", "warning", "info"
    description: str = ""


@dataclass
class ViaTransitionIssue:
    """A via transition that changes the reference plane."""

    via_location: tuple[float, float]
    net_name: str
    from_layer: str
    to_layer: str
    from_reference: str  # reference plane on the source layer
    to_reference: str  # reference plane on the destination layer
    reference_changed: bool
    return_path_length_mm: float  # estimated return current path length
    severity: str = "warning"
    description: str = ""


@dataclass
class StitchingViaSuggestion:
    """A suggested stitching via to maintain return path continuity."""

    location: tuple[float, float]
    connect_layers: tuple[str, str]
    reason: str
    priority: str = "recommended"  # "required", "recommended", "optional"
    associated_signal_via: Optional[tuple[float, float]] = None


@dataclass
class ReturnPathReport:
    """Complete return path analysis report."""

    plane_discontinuities: list[PlaneDiscontinuity] = field(default_factory=list)
    via_transition_issues: list[ViaTransitionIssue] = field(default_factory=list)
    stitching_suggestions: list[StitchingViaSuggestion] = field(default_factory=list)
    overall_pass: bool = True
    summary: str = ""
    total_issues: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_reference_planes(
    layer: Layer,
    stackup: list[StackupLayer],
    board: BoardDesign,
) -> list[tuple[str, Layer]]:
    """Find the reference (ground/power) planes adjacent to a signal layer.

    Returns list of (net_name, plane_layer) tuples for planes that serve
    as reference planes for the given signal layer.
    """
    # Find the copper layer's position in the stackup
    layer_idx = -1
    for i, sl in enumerate(stackup):
        if sl.layer == layer or sl.layer.name == layer.name:
            layer_idx = i
            break

    if layer_idx < 0:
        return []

    ref_planes: list[tuple[str, Layer]] = []

    # Look for copper layers above and below, skipping dielectrics
    # Reference plane is the nearest copper layer with a zone (pour)
    for direction in [-1, 1]:
        idx = layer_idx + direction
        while 0 <= idx < len(stackup):
            sl = stackup[idx]
            if sl.layer.layer_type == LayerType.COPPER:
                # Check if this copper layer has zones (pours) - indicates a plane
                layer_zones = [
                    z for z in board.zones
                    if z.layer == sl.layer or z.layer.name == sl.layer.name
                ]
                if layer_zones:
                    for zone in layer_zones:
                        ref_planes.append((zone.net.name, sl.layer))
                    break
                else:
                    # Even without explicit zones, inner copper layers
                    # may still be planes (trace-only layers are less common)
                    break
            idx += direction

    return ref_planes


def _check_plane_under_trace(
    trace: Trace,
    plane_zones: list[CopperZone],
    gap_threshold_mm: float = 0.5,
) -> list[PlaneDiscontinuity]:
    """Check if the reference plane has gaps or slots under a trace path.

    Projects the trace centerline onto the reference plane zones and
    identifies locations where the trace crosses a gap in the plane.
    """
    discontinuities: list[PlaneDiscontinuity] = []

    if not plane_zones or not trace.segments:
        return discontinuities

    # Build the union of all plane polygons
    plane_polys = []
    for zone in plane_zones:
        poly = zone.to_shapely()
        if not poly.is_empty:
            plane_polys.append(poly)

    if not plane_polys:
        return discontinuities

    plane_union = unary_union(plane_polys)

    for seg in trace.segments:
        trace_line = seg.to_line()
        if trace_line.is_empty:
            continue

        # Buffer the trace line slightly to detect near-misses
        trace_corridor = trace_line.buffer(seg.width * 1.5)

        # Check intersection with plane
        intersection = plane_union.intersection(trace_corridor)

        if intersection.is_empty:
            # Entire segment has no reference plane underneath
            mid_x = (seg.start_x + seg.end_x) / 2.0
            mid_y = (seg.start_y + seg.end_y) / 2.0
            discontinuities.append(PlaneDiscontinuity(
                location=(mid_x, mid_y),
                layer=plane_zones[0].layer.name if plane_zones else "unknown",
                discontinuity_type="gap",
                width_mm=seg.length,
                length_mm=seg.width * 3.0,
                affected_nets=[trace.net.name],
                severity="error",
                description=(
                    f"No reference plane under {trace.net.name} segment on "
                    f"{trace.layer.name} ({seg.length:.2f}mm long)"
                ),
            ))
        else:
            # Check for partial coverage (slot crossing)
            coverage_ratio = intersection.area / trace_corridor.area if trace_corridor.area > 0 else 1.0

            if coverage_ratio < 0.9:
                # There's a gap -- find where
                gap = trace_corridor.difference(plane_union)
                if not gap.is_empty:
                    centroid = gap.centroid
                    gap_width = math.sqrt(gap.area) if gap.area > 0 else 0.0

                    if gap_width > gap_threshold_mm:
                        discontinuities.append(PlaneDiscontinuity(
                            location=(centroid.x, centroid.y),
                            layer=plane_zones[0].layer.name if plane_zones else "unknown",
                            discontinuity_type="slot",
                            width_mm=gap_width,
                            length_mm=gap_width,
                            affected_nets=[trace.net.name],
                            severity="warning" if coverage_ratio > 0.7 else "error",
                            description=(
                                f"Reference plane slot/gap under {trace.net.name} "
                                f"on {trace.layer.name}. Coverage: {coverage_ratio * 100:.0f}%. "
                                f"Gap size: ~{gap_width:.2f}mm"
                            ),
                        ))

    return discontinuities


# ---------------------------------------------------------------------------
# Return path analyzer
# ---------------------------------------------------------------------------

class ReturnPathAnalyzer:
    """Analyzes return path continuity for high-speed signals.

    Checks that reference planes are continuous under signal traces,
    detects problematic via transitions that switch reference planes,
    and suggests stitching via placements.

    Args:
        high_speed_nets: List of net names considered high-speed.
            If None, all nets are analyzed.
        gap_threshold_mm: Minimum gap size to flag in reference planes.
        max_return_path_mm: Maximum acceptable return current path
            length at layer transitions. Beyond this is flagged.
        stitching_via_spacing_mm: Recommended spacing for stitching vias
            along layer transitions.
    """

    def __init__(
        self,
        high_speed_nets: Optional[list[str]] = None,
        gap_threshold_mm: float = 0.5,
        max_return_path_mm: float = 3.0,
        stitching_via_spacing_mm: float = 2.0,
    ) -> None:
        self.high_speed_nets = high_speed_nets
        self.gap_threshold_mm = gap_threshold_mm
        self.max_return_path_mm = max_return_path_mm
        self.stitching_via_spacing_mm = stitching_via_spacing_mm

    def _should_analyze_net(self, net: Net) -> bool:
        """Determine if a net should be analyzed."""
        if self.high_speed_nets is None:
            # Analyze all signal nets (skip power/ground by convention)
            name_lower = net.name.lower()
            for prefix in ("gnd", "vcc", "vdd", "+3v", "+5v", "+12v", "agnd", "dgnd"):
                if name_lower.startswith(prefix):
                    return False
            return True
        return net.name in self.high_speed_nets

    def _analyze_plane_continuity(
        self,
        board: BoardDesign,
        stackup: list[StackupLayer],
    ) -> list[PlaneDiscontinuity]:
        """Check reference plane continuity under all analyzed signal traces."""
        discontinuities: list[PlaneDiscontinuity] = []

        for net in board.nets:
            if not self._should_analyze_net(net):
                continue

            traces = board.traces_in_net(net)
            for trace in traces:
                # Find reference planes for this trace's layer
                ref_planes = _find_reference_planes(trace.layer, stackup, board)

                for ref_net_name, ref_layer in ref_planes:
                    # Get zones on the reference plane layer for this net
                    ref_zones = [
                        z for z in board.zones
                        if (z.layer == ref_layer or z.layer.name == ref_layer.name)
                        and z.net.name == ref_net_name
                    ]

                    issues = _check_plane_under_trace(
                        trace, ref_zones, self.gap_threshold_mm
                    )
                    discontinuities.extend(issues)

        return discontinuities

    def _analyze_via_transitions(
        self,
        board: BoardDesign,
        stackup: list[StackupLayer],
    ) -> tuple[list[ViaTransitionIssue], list[StitchingViaSuggestion]]:
        """Analyze via transitions for reference plane changes."""
        issues: list[ViaTransitionIssue] = []
        suggestions: list[StitchingViaSuggestion] = []

        for net in board.nets:
            if not self._should_analyze_net(net):
                continue

            vias = board.vias_in_net(net)
            for via in vias:
                # Find reference planes on each side of the via
                from_refs = _find_reference_planes(via.start_layer, stackup, board)
                to_refs = _find_reference_planes(via.end_layer, stackup, board)

                if not from_refs and not to_refs:
                    continue

                from_ref_name = from_refs[0][0] if from_refs else "none"
                from_ref_layer = from_refs[0][1].name if from_refs else "none"
                to_ref_name = to_refs[0][0] if to_refs else "none"
                to_ref_layer = to_refs[0][1].name if to_refs else "none"

                reference_changed = from_ref_name != to_ref_name

                # Estimate return path length
                # If reference planes are different, the return current must
                # find a path between the two reference nets (usually through
                # decoupling capacitors)
                if reference_changed:
                    # Rough estimate: find nearest via or capacitor connecting
                    # the two reference nets
                    nearest_connection_dist = float("inf")

                    # Check for nearby stitching/decap vias
                    for other_via in board.vias:
                        if other_via is via:
                            continue
                        if other_via.net.name in (from_ref_name, to_ref_name):
                            dist = math.sqrt(
                                (other_via.x - via.x) ** 2
                                + (other_via.y - via.y) ** 2
                            )
                            nearest_connection_dist = min(nearest_connection_dist, dist)

                    if nearest_connection_dist == float("inf"):
                        nearest_connection_dist = 20.0  # assume worst case

                    return_path_length = nearest_connection_dist
                else:
                    return_path_length = 0.0

                severity = "info"
                if reference_changed:
                    if return_path_length > self.max_return_path_mm:
                        severity = "error"
                    else:
                        severity = "warning"

                issue = ViaTransitionIssue(
                    via_location=(via.x, via.y),
                    net_name=net.name,
                    from_layer=via.start_layer.name,
                    to_layer=via.end_layer.name,
                    from_reference=f"{from_ref_name} ({from_ref_layer})",
                    to_reference=f"{to_ref_name} ({to_ref_layer})",
                    reference_changed=reference_changed,
                    return_path_length_mm=return_path_length,
                    severity=severity,
                    description=(
                        f"Via at ({via.x:.2f}, {via.y:.2f}) on {net.name}: "
                        f"{'reference plane change' if reference_changed else 'same reference'} "
                        f"from {from_ref_name} to {to_ref_name}. "
                        f"Return path: {return_path_length:.1f}mm"
                    ),
                )

                if reference_changed:
                    issues.append(issue)

                    # Suggest stitching vias
                    suggestions.append(StitchingViaSuggestion(
                        location=(via.x + 0.5, via.y),
                        connect_layers=(from_ref_layer, to_ref_layer),
                        reason=(
                            f"Connect {from_ref_name} to {to_ref_name} near "
                            f"signal via for {net.name} to maintain return "
                            f"path continuity"
                        ),
                        priority="required" if severity == "error" else "recommended",
                        associated_signal_via=(via.x, via.y),
                    ))

                    # Suggest additional stitching vias on the other side
                    suggestions.append(StitchingViaSuggestion(
                        location=(via.x - 0.5, via.y),
                        connect_layers=(from_ref_layer, to_ref_layer),
                        reason=(
                            f"Second stitching via for symmetric return path "
                            f"at {net.name} layer transition"
                        ),
                        priority="recommended",
                        associated_signal_via=(via.x, via.y),
                    ))

        return issues, suggestions

    def _detect_plane_splits(
        self,
        board: BoardDesign,
        stackup: list[StackupLayer],
    ) -> list[PlaneDiscontinuity]:
        """Detect splits in reference planes (multiple disconnected regions).

        A split plane forces return current to take a long detour,
        which is a common source of EMI.
        """
        discontinuities: list[PlaneDiscontinuity] = []

        # Check each copper plane for splits
        copper_layers = [sl for sl in stackup if sl.layer.layer_type == LayerType.COPPER]

        for sl in copper_layers:
            layer_zones = [
                z for z in board.zones
                if z.layer == sl.layer or z.layer.name == sl.layer.name
            ]

            if len(layer_zones) < 2:
                continue

            # Group zones by net
            zones_by_net: dict[str, list[CopperZone]] = {}
            for zone in layer_zones:
                net_name = zone.net.name
                if net_name not in zones_by_net:
                    zones_by_net[net_name] = []
                zones_by_net[net_name].append(zone)

            # Multiple power nets on the same layer indicates a split plane
            power_nets = [
                name for name in zones_by_net
                if any(kw in name.lower() for kw in ("gnd", "vcc", "vdd", "+"))
            ]

            if len(power_nets) > 1:
                # Find the boundary between the different plane regions
                for i in range(len(power_nets)):
                    for j in range(i + 1, len(power_nets)):
                        zones_a = zones_by_net[power_nets[i]]
                        zones_b = zones_by_net[power_nets[j]]

                        poly_a = unary_union([z.to_shapely() for z in zones_a if not z.to_shapely().is_empty])
                        poly_b = unary_union([z.to_shapely() for z in zones_b if not z.to_shapely().is_empty])

                        if poly_a.is_empty or poly_b.is_empty:
                            continue

                        # Find the closest point between the two regions
                        dist = poly_a.distance(poly_b)
                        if dist < 5.0:  # Only flag if planes are close (shared layer)
                            boundary_point = poly_a.centroid
                            # Find traces that cross the boundary
                            affected = []
                            for trace in board.traces:
                                if trace.layer == sl.layer or trace.layer.name == sl.layer.name:
                                    continue
                                trace_line = LineString([
                                    (s.start_x, s.start_y)
                                    for s in trace.segments
                                ] + (
                                    [(trace.segments[-1].end_x, trace.segments[-1].end_y)]
                                    if trace.segments else []
                                ))
                                if not trace_line.is_empty and trace_line.length > 0:
                                    buf = trace_line.buffer(1.0)
                                    if buf.intersects(poly_a) and buf.intersects(poly_b):
                                        affected.append(trace.net.name)

                            discontinuities.append(PlaneDiscontinuity(
                                location=(boundary_point.x, boundary_point.y),
                                layer=sl.layer.name,
                                discontinuity_type="split",
                                width_mm=dist,
                                length_mm=0.0,
                                affected_nets=affected[:10],
                                severity="error" if affected else "warning",
                                description=(
                                    f"Split plane on {sl.layer.name}: "
                                    f"{power_nets[i]} / {power_nets[j]} boundary. "
                                    f"Gap: {dist:.2f}mm. "
                                    f"{len(affected)} signal(s) cross the split."
                                ),
                            ))

        return discontinuities

    def analyze(
        self,
        board: BoardDesign,
        stackup: Optional[list[StackupLayer]] = None,
    ) -> ReturnPathReport:
        """Run complete return path analysis.

        Args:
            board: Board design to analyze.
            stackup: Stackup layers. If None, uses board.stackup.

        Returns:
            ReturnPathReport with discontinuities, via issues, and
            stitching via suggestions.
        """
        if stackup is None:
            stackup = board.stackup

        report = ReturnPathReport()

        # 1. Check plane continuity under traces
        plane_issues = self._analyze_plane_continuity(board, stackup)
        report.plane_discontinuities.extend(plane_issues)

        # 2. Detect plane splits
        split_issues = self._detect_plane_splits(board, stackup)
        report.plane_discontinuities.extend(split_issues)

        # 3. Analyze via transitions
        via_issues, stitching = self._analyze_via_transitions(board, stackup)
        report.via_transition_issues = via_issues
        report.stitching_suggestions = stitching

        # Summary
        error_count = sum(
            1 for d in report.plane_discontinuities if d.severity == "error"
        ) + sum(
            1 for v in report.via_transition_issues if v.severity == "error"
        )
        warning_count = sum(
            1 for d in report.plane_discontinuities if d.severity == "warning"
        ) + sum(
            1 for v in report.via_transition_issues if v.severity == "warning"
        )

        report.total_issues = error_count + warning_count
        report.overall_pass = error_count == 0

        report.summary = (
            f"Return path analysis: {error_count} errors, {warning_count} warnings. "
            f"{len(report.plane_discontinuities)} plane discontinuities, "
            f"{len(report.via_transition_issues)} via reference changes. "
            f"{len(report.stitching_suggestions)} stitching vias suggested. "
            f"{'PASS' if report.overall_pass else 'FAIL'}."
        )

        return report
