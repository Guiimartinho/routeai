"""Board-level crosstalk analysis engine.

Finds parallel trace segments on the same or adjacent layers, computes
FEXT/NEXT coupling coefficients, generates heatmap data, and suggests
mitigations.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from shapely.geometry import LineString

from routeai_solver.board_model import (
    BoardDesign,
    Layer,
    LayerType,
    Net,
    StackupLayer,
    Trace,
    TraceSegment,
)
from routeai_solver.physics.crosstalk import (
    CrosstalkResult,
    StackupInfo,
    TraceGeometry,
    calculate_fext,
    calculate_next,
)


# ---------------------------------------------------------------------------
# Result data classes
# ---------------------------------------------------------------------------

@dataclass
class HeatmapPoint:
    """A single point in the crosstalk heatmap."""

    x: float
    y: float
    coupling_coefficient: float  # 0-1
    layer: str


@dataclass
class Mitigation:
    """A suggested mitigation action for a crosstalk issue."""

    location: tuple[float, float]
    action: str  # "increase_spacing", "add_guard_trace", "change_layer", "shorten_parallel"
    description: str
    estimated_improvement_db: float


@dataclass
class CouplingPair:
    """Analysis result for a pair of coupled trace segments."""

    aggressor_net: str
    victim_net: str
    layer: str
    parallel_length_mm: float
    separation_mm: float
    next_coefficient: float
    next_db: float
    fext_coefficient: float
    fext_db: float
    worst_coefficient: float
    worst_db: float
    passed: bool
    mitigations: list[Mitigation] = field(default_factory=list)
    midpoint: tuple[float, float] = (0.0, 0.0)


@dataclass
class CrosstalkReport:
    """Complete crosstalk analysis report."""

    coupling_pairs: list[CouplingPair] = field(default_factory=list)
    heatmap: list[HeatmapPoint] = field(default_factory=list)
    overall_pass: bool = True
    summary: str = ""
    max_coupling_db: float = -200.0
    total_pairs_analyzed: int = 0
    total_violations: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _segment_to_line(seg: TraceSegment) -> LineString:
    """Convert a TraceSegment to a Shapely LineString."""
    return LineString([(seg.start_x, seg.start_y), (seg.end_x, seg.end_y)])


def _parallel_overlap(
    seg_a: TraceSegment, seg_b: TraceSegment
) -> tuple[float, float, float, float, float]:
    """Compute the parallel overlap between two segments.

    Returns:
        (parallel_length, separation, mid_x, mid_y, angle_diff)
        parallel_length: length of parallel run in mm
        separation: edge-to-edge distance in mm
        mid_x, mid_y: midpoint of the overlap region
        angle_diff: angle difference in degrees (0 = perfectly parallel)
    """
    line_a = _segment_to_line(seg_a)
    line_b = _segment_to_line(seg_b)

    # Direction vectors
    dx_a = seg_a.end_x - seg_a.start_x
    dy_a = seg_a.end_y - seg_a.start_y
    len_a = math.sqrt(dx_a**2 + dy_a**2)

    dx_b = seg_b.end_x - seg_b.start_x
    dy_b = seg_b.end_y - seg_b.start_y
    len_b = math.sqrt(dx_b**2 + dy_b**2)

    if len_a < 1e-6 or len_b < 1e-6:
        return 0.0, float("inf"), 0.0, 0.0, 90.0

    # Normalize
    ux_a, uy_a = dx_a / len_a, dy_a / len_a
    ux_b, uy_b = dx_b / len_b, dy_b / len_b

    # Angle between directions
    dot = abs(ux_a * ux_b + uy_a * uy_b)
    dot = min(dot, 1.0)
    angle_diff = math.degrees(math.acos(dot))

    # Only consider segments that are roughly parallel (within 20 degrees)
    if angle_diff > 20.0:
        return 0.0, float("inf"), 0.0, 0.0, angle_diff

    # Project segment B endpoints onto segment A's direction to find overlap
    # Use the axis of segment A
    def project_onto_a(px: float, py: float) -> float:
        return (px - seg_a.start_x) * ux_a + (py - seg_a.start_y) * uy_a

    proj_a_start = 0.0
    proj_a_end = len_a
    proj_b_start = project_onto_a(seg_b.start_x, seg_b.start_y)
    proj_b_end = project_onto_a(seg_b.end_x, seg_b.end_y)

    if proj_b_start > proj_b_end:
        proj_b_start, proj_b_end = proj_b_end, proj_b_start

    overlap_start = max(proj_a_start, proj_b_start)
    overlap_end = min(proj_a_end, proj_b_end)
    parallel_length = max(0.0, overlap_end - overlap_start)

    if parallel_length < 0.01:
        return 0.0, float("inf"), 0.0, 0.0, angle_diff

    # Center-to-center distance (perpendicular distance between parallel lines)
    distance = line_a.distance(line_b)
    # Edge-to-edge separation
    separation = max(0.0, distance - (seg_a.width + seg_b.width) / 2.0)

    # Midpoint of overlap region
    mid_param = (overlap_start + overlap_end) / 2.0
    mid_x = seg_a.start_x + ux_a * mid_param
    mid_y = seg_a.start_y + uy_a * mid_param

    return parallel_length, separation, mid_x, mid_y, angle_diff


def _get_stackup_info_for_layer(
    layer: Layer, stackup: list[StackupLayer]
) -> StackupInfo:
    """Extract StackupInfo for a given copper layer."""
    # Find the dielectric below (or above) this copper layer
    found_idx = -1
    for i, sl in enumerate(stackup):
        if sl.layer == layer or sl.layer.name == layer.name:
            found_idx = i
            break

    if found_idx < 0:
        return StackupInfo(h=0.2, er=4.3)

    # Look for nearest dielectric
    for i in range(found_idx + 1, len(stackup)):
        if stackup[i].layer.layer_type == LayerType.DIELECTRIC:
            return StackupInfo(
                h=stackup[i].thickness_mm,
                er=stackup[i].dielectric_constant,
                t=stackup[found_idx].thickness_mm,
            )

    for i in range(found_idx - 1, -1, -1):
        if stackup[i].layer.layer_type == LayerType.DIELECTRIC:
            return StackupInfo(
                h=stackup[i].thickness_mm,
                er=stackup[i].dielectric_constant,
                t=stackup[found_idx].thickness_mm,
            )

    return StackupInfo(h=0.2, er=4.3)


def _are_adjacent_layers(
    layer_a: Layer, layer_b: Layer, stackup: list[StackupLayer]
) -> bool:
    """Check if two copper layers are adjacent (separated by one dielectric)."""
    copper_layers = [sl for sl in stackup if sl.layer.layer_type == LayerType.COPPER]
    idx_a = -1
    idx_b = -1
    for i, sl in enumerate(copper_layers):
        if sl.layer == layer_a or sl.layer.name == layer_a.name:
            idx_a = i
        if sl.layer == layer_b or sl.layer.name == layer_b.name:
            idx_b = i
    if idx_a < 0 or idx_b < 0:
        return False
    return abs(idx_a - idx_b) == 1


# ---------------------------------------------------------------------------
# Crosstalk engine
# ---------------------------------------------------------------------------

class CrosstalkEngine:
    """Board-level crosstalk analysis.

    Finds all parallel trace coupling pairs, calculates NEXT/FEXT
    coefficients, generates heatmap data, and suggests mitigations.

    Args:
        max_coupling_db: Maximum acceptable coupling in dB (e.g., -40).
            Pairs exceeding this threshold are flagged.
        min_parallel_mm: Minimum parallel run length to consider (mm).
        max_separation_mm: Maximum separation to consider for coupling (mm).
        rise_time_ns: Signal rise time for FEXT calculation.
    """

    def __init__(
        self,
        max_coupling_db: float = -40.0,
        min_parallel_mm: float = 1.0,
        max_separation_mm: float = 2.0,
        rise_time_ns: float = 0.5,
    ) -> None:
        self.max_coupling_db = max_coupling_db
        self.min_parallel_mm = min_parallel_mm
        self.max_separation_mm = max_separation_mm
        self.rise_time_ns = rise_time_ns

    def _generate_mitigations(
        self, pair: CouplingPair, stackup_info: StackupInfo
    ) -> list[Mitigation]:
        """Generate mitigation suggestions for a crosstalk violation."""
        mitigations: list[Mitigation] = []
        loc = pair.midpoint

        # Suggestion 1: Increase spacing
        # 6dB improvement per doubling of spacing (approximate)
        if pair.separation_mm < self.max_separation_mm * 2:
            target_sep = pair.separation_mm * 2.0
            improvement = 6.0  # ~6dB per doubling
            mitigations.append(Mitigation(
                location=loc,
                action="increase_spacing",
                description=(
                    f"Increase spacing between {pair.aggressor_net} and "
                    f"{pair.victim_net} from {pair.separation_mm:.2f}mm to "
                    f"{target_sep:.2f}mm"
                ),
                estimated_improvement_db=improvement,
            ))

        # Suggestion 2: Add guard trace
        if pair.separation_mm < stackup_info.h * 4:
            mitigations.append(Mitigation(
                location=loc,
                action="add_guard_trace",
                description=(
                    f"Add grounded guard trace between {pair.aggressor_net} "
                    f"and {pair.victim_net} on {pair.layer}. Guard trace "
                    f"should be stitched to ground every {stackup_info.h * 10:.1f}mm"
                ),
                estimated_improvement_db=10.0,
            ))

        # Suggestion 3: Change layer
        if pair.parallel_length_mm > 10.0:
            mitigations.append(Mitigation(
                location=loc,
                action="change_layer",
                description=(
                    f"Route {pair.victim_net} on a different layer to "
                    f"eliminate the {pair.parallel_length_mm:.1f}mm parallel run "
                    f"with {pair.aggressor_net}"
                ),
                estimated_improvement_db=20.0,
            ))

        # Suggestion 4: Shorten parallel run
        if pair.parallel_length_mm > 5.0:
            target_len = pair.parallel_length_mm / 2.0
            # FEXT scales linearly with length
            improvement = 6.0  # ~6dB for halving length
            mitigations.append(Mitigation(
                location=loc,
                action="shorten_parallel",
                description=(
                    f"Reduce parallel run between {pair.aggressor_net} and "
                    f"{pair.victim_net} from {pair.parallel_length_mm:.1f}mm to "
                    f"<{target_len:.1f}mm by staggering routes"
                ),
                estimated_improvement_db=improvement,
            ))

        return mitigations

    def analyze_board(
        self,
        board: BoardDesign,
        stackup: Optional[list[StackupLayer]] = None,
    ) -> CrosstalkReport:
        """Run crosstalk analysis on the entire board.

        Finds all pairs of traces on the same layer or adjacent layers
        that run in parallel within the separation threshold, and
        calculates their coupling coefficients.

        Args:
            board: Board design to analyze.
            stackup: Stackup layers. If None, uses board.stackup.

        Returns:
            CrosstalkReport with coupling pairs, heatmap, and mitigations.
        """
        if stackup is None:
            stackup = board.stackup

        report = CrosstalkReport()
        heatmap_points: list[HeatmapPoint] = []

        # Group traces by layer for efficient pairing
        traces_by_layer: dict[str, list[Trace]] = {}
        for trace in board.traces:
            layer_name = trace.layer.name
            if layer_name not in traces_by_layer:
                traces_by_layer[layer_name] = []
            traces_by_layer[layer_name].append(trace)

        # Build list of layer pairs to check (same layer + adjacent layers)
        copper_layers = board.copper_layers()
        layer_pairs: list[tuple[Layer, Layer]] = []

        for layer in copper_layers:
            layer_pairs.append((layer, layer))  # same-layer coupling

        for i in range(len(copper_layers) - 1):
            if _are_adjacent_layers(copper_layers[i], copper_layers[i + 1], stackup):
                layer_pairs.append((copper_layers[i], copper_layers[i + 1]))

        analyzed_net_pairs: set[tuple[str, str, str]] = set()

        for layer_a, layer_b in layer_pairs:
            traces_a = traces_by_layer.get(layer_a.name, [])
            traces_b = traces_by_layer.get(layer_b.name, [])

            for t_a in traces_a:
                for t_b in traces_b:
                    # Skip same-net coupling
                    if t_a.net.name == t_b.net.name:
                        continue

                    # Skip already-analyzed pairs (order independent)
                    pair_key = tuple(sorted([t_a.net.name, t_b.net.name])) + (
                        f"{layer_a.name}_{layer_b.name}",
                    )
                    if pair_key in analyzed_net_pairs:
                        continue

                    # Check all segment pairs
                    best_parallel = 0.0
                    best_sep = float("inf")
                    best_mid = (0.0, 0.0)
                    total_parallel = 0.0

                    for seg_a in t_a.segments:
                        for seg_b in t_b.segments:
                            p_len, sep, mx, my, _ = _parallel_overlap(seg_a, seg_b)

                            if p_len < self.min_parallel_mm:
                                continue
                            if sep > self.max_separation_mm:
                                continue

                            total_parallel += p_len
                            if p_len > best_parallel:
                                best_parallel = p_len
                                best_sep = sep
                                best_mid = (mx, my)

                            # Add heatmap data for each coupling segment
                            # Sample points along the overlap
                            n_points = max(1, int(p_len / 0.5))
                            dx = (seg_a.end_x - seg_a.start_x)
                            dy = (seg_a.end_y - seg_a.start_y)
                            seg_len = seg_a.length
                            if seg_len > 0:
                                for k in range(n_points):
                                    frac = (k + 0.5) / n_points
                                    px = seg_a.start_x + dx * frac
                                    py = seg_a.start_y + dy * frac
                                    # Coupling decreases with separation squared
                                    coupling = max(0.0, 1.0 - (sep / self.max_separation_mm) ** 2)
                                    coupling *= min(1.0, p_len / 10.0)
                                    heatmap_points.append(HeatmapPoint(
                                        x=px, y=py,
                                        coupling_coefficient=coupling,
                                        layer=layer_a.name,
                                    ))

                    if total_parallel < self.min_parallel_mm or best_sep > self.max_separation_mm:
                        continue

                    analyzed_net_pairs.add(pair_key)

                    # Calculate NEXT and FEXT
                    stackup_info = _get_stackup_info_for_layer(layer_a, stackup)

                    aggressor_geom = TraceGeometry(
                        width=t_a.width if t_a.width > 0 else 0.15,
                        parallel_length=total_parallel,
                        separation=max(best_sep, 0.001),
                        layer_index=layer_a.index,
                    )
                    victim_geom = TraceGeometry(
                        width=t_b.width if t_b.width > 0 else 0.15,
                        parallel_length=total_parallel,
                        separation=max(best_sep, 0.001),
                        layer_index=layer_b.index,
                    )

                    next_result = calculate_next(aggressor_geom, victim_geom, stackup_info)
                    fext_result = calculate_fext(
                        aggressor_geom, victim_geom, stackup_info, self.rise_time_ns
                    )

                    worst_coeff = max(next_result.coefficient, fext_result.coefficient)
                    worst_db = max(next_result.coefficient_db, fext_result.coefficient_db)
                    passed = worst_db <= self.max_coupling_db

                    pair_result = CouplingPair(
                        aggressor_net=t_a.net.name,
                        victim_net=t_b.net.name,
                        layer=layer_a.name if layer_a == layer_b else f"{layer_a.name}/{layer_b.name}",
                        parallel_length_mm=total_parallel,
                        separation_mm=best_sep,
                        next_coefficient=next_result.coefficient,
                        next_db=next_result.coefficient_db,
                        fext_coefficient=fext_result.coefficient,
                        fext_db=fext_result.coefficient_db,
                        worst_coefficient=worst_coeff,
                        worst_db=worst_db,
                        passed=passed,
                        midpoint=best_mid,
                    )

                    if not passed:
                        pair_result.mitigations = self._generate_mitigations(
                            pair_result, stackup_info
                        )
                        report.total_violations += 1

                    report.coupling_pairs.append(pair_result)

        # Sort by worst coupling (most severe first)
        report.coupling_pairs.sort(key=lambda p: p.worst_db, reverse=True)

        report.heatmap = heatmap_points
        report.total_pairs_analyzed = len(report.coupling_pairs)
        report.overall_pass = report.total_violations == 0

        if report.coupling_pairs:
            report.max_coupling_db = max(p.worst_db for p in report.coupling_pairs)

        report.summary = (
            f"Analyzed {report.total_pairs_analyzed} coupling pairs. "
            f"{'PASS' if report.overall_pass else 'FAIL'}: "
            f"{report.total_violations} pairs exceed {self.max_coupling_db:.0f}dB threshold. "
            f"Worst coupling: {report.max_coupling_db:.1f}dB."
        )

        return report
