"""Board-level impedance analysis engine.

Checks every trace segment against net class impedance targets using
the physics.impedance calculator. Identifies impedance discontinuities
caused by width changes, via transitions, and stackup variations.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
    Layer,
    LayerType,
    Net,
    StackupLayer,
    Trace,
    TraceSegment,
)
from routeai_solver.physics.impedance import (
    embedded_microstrip_impedance,
    microstrip_impedance,
    stripline_impedance,
)

# ---------------------------------------------------------------------------
# Data classes for impedance analysis results
# ---------------------------------------------------------------------------

@dataclass
class SegmentIssue:
    """An impedance issue on a specific trace segment."""

    segment_index: int
    start: tuple[float, float]
    end: tuple[float, float]
    layer: str
    width_mm: float
    actual_z0: float
    target_z0: float
    deviation_pct: float
    issue_type: str  # "out_of_spec", "width_change", "via_transition"
    description: str


@dataclass
class PerNetResult:
    """Impedance analysis result for a single net."""

    net_name: str
    target_z0: float
    actual_z0_range: tuple[float, float]  # (min, max)
    deviation_pct: float  # max absolute deviation %
    segments_with_issues: list[SegmentIssue] = field(default_factory=list)
    total_segments: int = 0
    passed: bool = True


@dataclass
class ImpedanceReport:
    """Complete impedance analysis report for a board."""

    per_net_results: list[PerNetResult] = field(default_factory=list)
    overall_pass: bool = True
    summary: str = ""
    total_nets_analyzed: int = 0
    total_segments_analyzed: int = 0
    total_issues: int = 0


# ---------------------------------------------------------------------------
# Net class impedance targets (typical defaults)
# ---------------------------------------------------------------------------

DEFAULT_IMPEDANCE_TARGETS: dict[str, float] = {
    "default": 50.0,
    "usb": 90.0,
    "usb2": 90.0,
    "usb3": 85.0,
    "hdmi": 100.0,
    "ethernet": 100.0,
    "pcie": 85.0,
    "ddr": 50.0,
    "ddr4": 40.0,
    "ddr5": 40.0,
    "sata": 85.0,
    "lvds": 100.0,
    "mipi": 100.0,
}

DEFAULT_TOLERANCE_PCT = 10.0  # +/- 10% impedance tolerance


# ---------------------------------------------------------------------------
# Impedance engine
# ---------------------------------------------------------------------------

class ImpedanceEngine:
    """Analyzes board-wide impedance compliance.

    For each net with an impedance target, checks every trace segment
    against the target impedance. Identifies discontinuities at width
    changes and via transitions.

    Args:
        impedance_targets: Mapping of net name (or net class) to target
            impedance in ohms. Falls back to DEFAULT_IMPEDANCE_TARGETS.
        tolerance_pct: Acceptable impedance deviation percentage.
        copper_thickness: Default copper thickness in mm (1oz = 0.035mm).
    """

    def __init__(
        self,
        impedance_targets: Optional[dict[str, float]] = None,
        tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
        copper_thickness: float = 0.035,
    ) -> None:
        self.impedance_targets = impedance_targets or {}
        self.tolerance_pct = tolerance_pct
        self.copper_thickness = copper_thickness

    def _get_target_z0(self, net_name: str) -> Optional[float]:
        """Look up the impedance target for a net by name or class prefix."""
        # Exact match
        if net_name in self.impedance_targets:
            return self.impedance_targets[net_name]

        # Check if net name contains a known class keyword
        name_lower = net_name.lower()
        for class_key, z0 in {**DEFAULT_IMPEDANCE_TARGETS, **self.impedance_targets}.items():
            if class_key != "default" and class_key in name_lower:
                return z0

        # Fall back to default if provided
        if "default" in self.impedance_targets:
            return self.impedance_targets["default"]
        return DEFAULT_IMPEDANCE_TARGETS.get("default")

    def _find_stackup_for_layer(
        self, layer: Layer, stackup: list[StackupLayer]
    ) -> tuple[Optional[StackupLayer], Optional[StackupLayer], Optional[StackupLayer]]:
        """Find the copper layer and adjacent dielectric layers in the stackup.

        Returns:
            (layer_above, this_copper_layer, layer_below) stackup entries.
            layer_above and layer_below are the nearest dielectric layers.
        """
        copper_entry: Optional[StackupLayer] = None
        copper_idx = -1

        for i, sl in enumerate(stackup):
            if sl.layer == layer or sl.layer.name == layer.name:
                copper_entry = sl
                copper_idx = i
                break

        if copper_entry is None or copper_idx < 0:
            return None, None, None

        # Find dielectric above (lower index = higher in stack)
        above: Optional[StackupLayer] = None
        for i in range(copper_idx - 1, -1, -1):
            if stackup[i].layer.layer_type == LayerType.DIELECTRIC:
                above = stackup[i]
                break

        # Find dielectric below (higher index = lower in stack)
        below: Optional[StackupLayer] = None
        for i in range(copper_idx + 1, len(stackup)):
            if stackup[i].layer.layer_type == LayerType.DIELECTRIC:
                below = stackup[i]
                break

        return above, copper_entry, below

    def _calculate_segment_impedance(
        self,
        segment: TraceSegment,
        layer: Layer,
        stackup: list[StackupLayer],
    ) -> float:
        """Calculate the characteristic impedance of a single trace segment.

        Determines whether the trace is microstrip, embedded microstrip,
        or stripline based on its position in the stackup, then applies
        the appropriate formula.
        """
        above_diel, copper_sl, below_diel = self._find_stackup_for_layer(layer, stackup)

        w = segment.width
        t = self.copper_thickness if copper_sl is None else copper_sl.thickness_mm

        # Default fallback if stackup info is missing
        if below_diel is None and above_diel is None:
            # No stackup data; assume standard microstrip with FR4
            result = microstrip_impedance(w, 0.2, 4.3, t)
            return result.z0

        if above_diel is not None and below_diel is not None:
            # Trace has dielectric on both sides -- stripline or embedded microstrip
            # Check if both sides have reference planes (copper)
            h_above = above_diel.thickness_mm
            h_below = below_diel.thickness_mm
            er_above = above_diel.dielectric_constant
            er_below = below_diel.dielectric_constant

            if abs(er_above - er_below) < 0.1 and abs(h_above - h_below) / max(h_above, h_below, 0.01) < 0.2:
                # Approximately symmetric -- stripline
                h = (h_above + h_below) / 2.0
                er = (er_above + er_below) / 2.0
                result = stripline_impedance(w, h, er, t)
            else:
                # Asymmetric -- use embedded microstrip with below as reference
                result = embedded_microstrip_impedance(w, h_below, h_above, er_below, t)
            return result.z0

        if below_diel is not None:
            # Surface microstrip (trace on top, dielectric below)
            result = microstrip_impedance(w, below_diel.thickness_mm, below_diel.dielectric_constant, t)
            return result.z0

        if above_diel is not None:
            # Inverted microstrip (trace on bottom, dielectric above)
            result = microstrip_impedance(w, above_diel.thickness_mm, above_diel.dielectric_constant, t)
            return result.z0

        # Should not reach here
        return 50.0

    def _detect_width_changes(
        self, trace: Trace, target_z0: float, stackup: list[StackupLayer]
    ) -> list[SegmentIssue]:
        """Detect impedance discontinuities caused by trace width changes."""
        issues: list[SegmentIssue] = []
        segments = trace.segments
        if len(segments) < 2:
            return issues

        for i in range(1, len(segments)):
            prev_seg = segments[i - 1]
            curr_seg = segments[i]

            if abs(prev_seg.width - curr_seg.width) > 0.001:
                z0_prev = self._calculate_segment_impedance(prev_seg, trace.layer, stackup)
                z0_curr = self._calculate_segment_impedance(curr_seg, trace.layer, stackup)
                delta_z = abs(z0_curr - z0_prev)
                delta_pct = (delta_z / target_z0) * 100.0 if target_z0 > 0 else 0.0

                if delta_pct > self.tolerance_pct / 2.0:
                    issues.append(SegmentIssue(
                        segment_index=i,
                        start=curr_seg.start,
                        end=curr_seg.end,
                        layer=trace.layer.name,
                        width_mm=curr_seg.width,
                        actual_z0=z0_curr,
                        target_z0=target_z0,
                        deviation_pct=delta_pct,
                        issue_type="width_change",
                        description=(
                            f"Width change from {prev_seg.width:.3f}mm to "
                            f"{curr_seg.width:.3f}mm causes impedance jump: "
                            f"{z0_prev:.1f} -> {z0_curr:.1f} ohm "
                            f"({delta_pct:.1f}% discontinuity)"
                        ),
                    ))

        return issues

    def _detect_via_discontinuities(
        self,
        net: Net,
        board: BoardDesign,
        target_z0: float,
        stackup: list[StackupLayer],
    ) -> list[SegmentIssue]:
        """Detect impedance discontinuities at via transitions.

        Via transitions introduce a localized impedance change due to
        the via barrel inductance and pad capacitance. We flag vias
        where the trace transitions between layers with significantly
        different impedance environments.
        """
        issues: list[SegmentIssue] = []
        vias = board.vias_in_net(net)
        traces = board.traces_in_net(net)

        if not vias or not traces:
            return issues

        for via in vias:
            # Find traces connected to this via on each layer
            start_traces = [
                t for t in traces
                if t.layer.name == via.start_layer.name
            ]
            end_traces = [
                t for t in traces
                if t.layer.name == via.end_layer.name
            ]

            if not start_traces or not end_traces:
                continue

            # Get representative impedance on each side
            z0_start = 50.0
            z0_end = 50.0

            for t in start_traces:
                for seg in t.segments:
                    # Check if segment endpoint is near via
                    dist_s = math.sqrt((seg.start_x - via.x)**2 + (seg.start_y - via.y)**2)
                    dist_e = math.sqrt((seg.end_x - via.x)**2 + (seg.end_y - via.y)**2)
                    if min(dist_s, dist_e) < via.diameter:
                        z0_start = self._calculate_segment_impedance(seg, t.layer, stackup)
                        break

            for t in end_traces:
                for seg in t.segments:
                    dist_s = math.sqrt((seg.start_x - via.x)**2 + (seg.start_y - via.y)**2)
                    dist_e = math.sqrt((seg.end_x - via.x)**2 + (seg.end_y - via.y)**2)
                    if min(dist_s, dist_e) < via.diameter:
                        z0_end = self._calculate_segment_impedance(seg, t.layer, stackup)
                        break

            delta_z = abs(z0_end - z0_start)
            delta_pct = (delta_z / target_z0) * 100.0 if target_z0 > 0 else 0.0

            if delta_pct > self.tolerance_pct * 0.75:
                # Via barrel parasitic estimate
                # L_via ~ 0.2nH per 0.1mm of barrel length (rough rule of thumb)
                barrel_length = sum(
                    sl.thickness_mm for sl in stackup
                    if sl.layer.layer_type == LayerType.DIELECTRIC
                )
                via_inductance_nh = 0.2 * (barrel_length / 0.1)
                via_capacitance_pf = 1.41 * 4.3 * via.diameter * barrel_length / (
                    max(via.diameter - via.drill, 0.01)
                )

                issues.append(SegmentIssue(
                    segment_index=-1,
                    start=(via.x, via.y),
                    end=(via.x, via.y),
                    layer=f"{via.start_layer.name} -> {via.end_layer.name}",
                    width_mm=via.diameter,
                    actual_z0=(z0_start + z0_end) / 2.0,
                    target_z0=target_z0,
                    deviation_pct=delta_pct,
                    issue_type="via_transition",
                    description=(
                        f"Via at ({via.x:.2f}, {via.y:.2f}) transitions from "
                        f"{via.start_layer.name} ({z0_start:.1f} ohm) to "
                        f"{via.end_layer.name} ({z0_end:.1f} ohm). "
                        f"Estimated parasitic L={via_inductance_nh:.2f}nH, "
                        f"C={via_capacitance_pf:.3f}pF"
                    ),
                ))

        return issues

    def analyze_board(
        self,
        board: BoardDesign,
        stackup: Optional[list[StackupLayer]] = None,
    ) -> ImpedanceReport:
        """Run impedance analysis on the entire board.

        Checks every trace segment on every net that has an impedance
        target. Identifies segments out of spec and impedance
        discontinuities at width changes and via transitions.

        Args:
            board: The board design to analyze.
            stackup: Stackup layer definitions. If None, uses board.stackup.

        Returns:
            ImpedanceReport with per-net results and overall pass/fail.
        """
        if stackup is None:
            stackup = board.stackup

        report = ImpedanceReport()
        all_issues = 0
        all_segments = 0

        for net in board.nets:
            target_z0 = self._get_target_z0(net.name)
            if target_z0 is None:
                continue

            traces = board.traces_in_net(net)
            if not traces:
                continue

            # Analyze each segment
            z0_values: list[float] = []
            segment_issues: list[SegmentIssue] = []
            total_segs = 0

            for trace in traces:
                for idx, seg in enumerate(trace.segments):
                    total_segs += 1
                    z0 = self._calculate_segment_impedance(seg, trace.layer, stackup)
                    z0_values.append(z0)

                    deviation = abs(z0 - target_z0) / target_z0 * 100.0 if target_z0 > 0 else 0.0

                    if deviation > self.tolerance_pct:
                        segment_issues.append(SegmentIssue(
                            segment_index=idx,
                            start=seg.start,
                            end=seg.end,
                            layer=trace.layer.name,
                            width_mm=seg.width,
                            actual_z0=z0,
                            target_z0=target_z0,
                            deviation_pct=deviation,
                            issue_type="out_of_spec",
                            description=(
                                f"Impedance {z0:.1f} ohm deviates "
                                f"{deviation:.1f}% from target {target_z0:.1f} ohm "
                                f"(width={seg.width:.3f}mm on {trace.layer.name})"
                            ),
                        ))

                # Width change discontinuities
                width_issues = self._detect_width_changes(trace, target_z0, stackup)
                segment_issues.extend(width_issues)

            # Via transition discontinuities
            via_issues = self._detect_via_discontinuities(net, board, target_z0, stackup)
            segment_issues.extend(via_issues)

            # Build per-net result
            if z0_values:
                z0_min = min(z0_values)
                z0_max = max(z0_values)
            else:
                z0_min = z0_max = 0.0

            max_dev = max(
                (abs(z - target_z0) / target_z0 * 100.0 for z in z0_values),
                default=0.0,
            ) if target_z0 > 0 else 0.0

            net_passed = len(segment_issues) == 0

            per_net = PerNetResult(
                net_name=net.name,
                target_z0=target_z0,
                actual_z0_range=(z0_min, z0_max),
                deviation_pct=max_dev,
                segments_with_issues=segment_issues,
                total_segments=total_segs,
                passed=net_passed,
            )
            report.per_net_results.append(per_net)

            all_issues += len(segment_issues)
            all_segments += total_segs

        # Build summary
        report.total_nets_analyzed = len(report.per_net_results)
        report.total_segments_analyzed = all_segments
        report.total_issues = all_issues
        report.overall_pass = all(r.passed for r in report.per_net_results)

        nets_failed = sum(1 for r in report.per_net_results if not r.passed)
        report.summary = (
            f"Analyzed {report.total_nets_analyzed} nets, "
            f"{report.total_segments_analyzed} segments. "
            f"{'PASS' if report.overall_pass else 'FAIL'}: "
            f"{all_issues} issues found across {nets_failed} nets."
        )

        return report
