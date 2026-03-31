"""Design for Manufacturability (DFM) analyzer.

Checks a board design against specific fabrication house capabilities
and provides a detailed report of issues, warnings, and suggestions.

Supports profiles for JLCPCB, PCBWay, OSH Park, and custom fabs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
)

# ---------------------------------------------------------------------------
# Fabrication capability profiles
# ---------------------------------------------------------------------------

@dataclass
class FabProfile:
    """Fabrication house capability profile."""

    name: str
    min_trace_width_mm: float
    min_trace_spacing_mm: float
    min_drill_mm: float
    min_via_drill_mm: float
    min_annular_ring_mm: float
    min_hole_to_hole_mm: float
    min_hole_to_edge_mm: float
    min_solder_mask_bridge_mm: float
    max_board_width_mm: float
    max_board_height_mm: float
    max_layer_count: int
    min_board_thickness_mm: float
    max_board_thickness_mm: float
    supports_blind_vias: bool
    supports_buried_vias: bool
    supports_microvias: bool
    supports_castellated_holes: bool
    supports_impedance_control: bool
    min_silkscreen_width_mm: float
    min_silkscreen_height_mm: float
    copper_weights_oz: list[float] = field(default_factory=lambda: [1.0, 2.0])
    surface_finishes: list[str] = field(default_factory=lambda: ["HASL", "ENIG"])
    notes: str = ""


# Standard fab profiles
JLCPCB = FabProfile(
    name="JLCPCB",
    min_trace_width_mm=0.09,
    min_trace_spacing_mm=0.09,
    min_drill_mm=0.2,
    min_via_drill_mm=0.2,
    min_annular_ring_mm=0.13,
    min_hole_to_hole_mm=0.254,
    min_hole_to_edge_mm=0.3,
    min_solder_mask_bridge_mm=0.1,
    max_board_width_mm=500.0,
    max_board_height_mm=500.0,
    max_layer_count=32,
    min_board_thickness_mm=0.4,
    max_board_thickness_mm=2.4,
    supports_blind_vias=True,
    supports_buried_vias=True,
    supports_microvias=True,
    supports_castellated_holes=True,
    supports_impedance_control=True,
    min_silkscreen_width_mm=0.15,
    min_silkscreen_height_mm=0.8,
    copper_weights_oz=[0.5, 1.0, 2.0],
    surface_finishes=["HASL", "HASL-LF", "ENIG", "OSP"],
    notes="Standard capability; tighter specs available with higher cost",
)

PCBWAY = FabProfile(
    name="PCBWay",
    min_trace_width_mm=0.09,
    min_trace_spacing_mm=0.09,
    min_drill_mm=0.2,
    min_via_drill_mm=0.15,
    min_annular_ring_mm=0.1,
    min_hole_to_hole_mm=0.254,
    min_hole_to_edge_mm=0.3,
    min_solder_mask_bridge_mm=0.08,
    max_board_width_mm=500.0,
    max_board_height_mm=1100.0,
    max_layer_count=28,
    min_board_thickness_mm=0.2,
    max_board_thickness_mm=3.2,
    supports_blind_vias=True,
    supports_buried_vias=True,
    supports_microvias=True,
    supports_castellated_holes=True,
    supports_impedance_control=True,
    min_silkscreen_width_mm=0.15,
    min_silkscreen_height_mm=0.8,
    copper_weights_oz=[0.5, 1.0, 2.0, 3.0],
    surface_finishes=["HASL", "HASL-LF", "ENIG", "OSP", "Immersion Silver", "Immersion Tin"],
    notes="Advanced capabilities; flex-rigid supported",
)

OSH_PARK = FabProfile(
    name="OSH Park",
    min_trace_width_mm=0.15,
    min_trace_spacing_mm=0.15,
    min_drill_mm=0.254,
    min_via_drill_mm=0.254,
    min_annular_ring_mm=0.18,
    min_hole_to_hole_mm=0.38,
    min_hole_to_edge_mm=0.38,
    min_solder_mask_bridge_mm=0.1,
    max_board_width_mm=381.0,  # 15 inches
    max_board_height_mm=381.0,
    max_layer_count=4,
    min_board_thickness_mm=0.8,
    max_board_thickness_mm=1.6,
    supports_blind_vias=False,
    supports_buried_vias=False,
    supports_microvias=False,
    supports_castellated_holes=False,
    supports_impedance_control=False,
    min_silkscreen_width_mm=0.15,
    min_silkscreen_height_mm=1.0,
    copper_weights_oz=[1.0, 2.0],
    surface_finishes=["ENIG"],
    notes="Purple boards; limited to 2 or 4 layers; good for prototyping",
)

FAB_PROFILES: dict[str, FabProfile] = {
    "jlcpcb": JLCPCB,
    "pcbway": PCBWAY,
    "osh_park": OSH_PARK,
    "oshpark": OSH_PARK,
}


# ---------------------------------------------------------------------------
# DFM issue classes
# ---------------------------------------------------------------------------

class DFMSeverity(Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class DFMIssue:
    """A single DFM issue or warning."""

    severity: DFMSeverity
    category: str  # "trace", "drill", "annular_ring", "board_size", etc.
    description: str
    location: Optional[tuple[float, float]] = None
    measured_value: Optional[float] = None
    required_value: Optional[float] = None
    suggestion: str = ""


@dataclass
class DFMReport:
    """Complete DFM analysis report."""

    fab_profile: str
    issues: list[DFMIssue] = field(default_factory=list)
    warnings: list[DFMIssue] = field(default_factory=list)
    score: float = 100.0  # 0-100, higher is better
    fab_compatible: bool = True
    summary: str = ""

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == DFMSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == DFMSeverity.WARNING)


# ---------------------------------------------------------------------------
# DFM Analyzer
# ---------------------------------------------------------------------------

class DFMAnalyzer:
    """Checks board design against fab house capabilities.

    Validates minimum trace width/spacing, drill sizes, annular rings,
    board dimensions, layer count, and special features against a
    specific fabrication profile.
    """

    def _check_trace_width(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check all traces against minimum width."""
        issues: list[DFMIssue] = []

        for trace in board.traces:
            for seg in trace.segments:
                if seg.width < profile.min_trace_width_mm:
                    mid_x = (seg.start_x + seg.end_x) / 2.0
                    mid_y = (seg.start_y + seg.end_y) / 2.0
                    issues.append(DFMIssue(
                        severity=DFMSeverity.ERROR,
                        category="trace_width",
                        description=(
                            f"Trace width {seg.width:.3f}mm on "
                            f"{trace.layer.name} (net: {trace.net.name}) "
                            f"is below minimum {profile.min_trace_width_mm:.3f}mm "
                            f"for {profile.name}"
                        ),
                        location=(mid_x, mid_y),
                        measured_value=seg.width,
                        required_value=profile.min_trace_width_mm,
                        suggestion=(
                            f"Increase trace width to at least "
                            f"{profile.min_trace_width_mm:.3f}mm"
                        ),
                    ))

        return issues

    def _check_trace_spacing(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check trace-to-trace clearance against minimum spacing.

        Uses a simplified pairwise check for traces on the same layer.
        """
        issues: list[DFMIssue] = []

        copper_layers = board.copper_layers()
        for layer in copper_layers:
            layer_traces = board.traces_on_layer(layer)
            # Pairwise check (limited to avoid O(n^2) explosion on large boards)
            max_checks = min(len(layer_traces), 200)
            for i in range(max_checks):
                for j in range(i + 1, min(i + 50, len(layer_traces))):
                    t_a = layer_traces[i]
                    t_b = layer_traces[j]

                    if t_a.net == t_b.net:
                        continue

                    poly_a = t_a.to_shapely()
                    poly_b = t_b.to_shapely()

                    if poly_a is None or poly_b is None:
                        continue
                    if poly_a.is_empty or poly_b.is_empty:
                        continue

                    dist = poly_a.distance(poly_b)
                    if dist < profile.min_trace_spacing_mm:
                        # Find approximate location
                        centroid_a = poly_a.centroid
                        issues.append(DFMIssue(
                            severity=DFMSeverity.ERROR,
                            category="trace_spacing",
                            description=(
                                f"Trace spacing {dist:.3f}mm between "
                                f"{t_a.net.name} and {t_b.net.name} on "
                                f"{layer.name} is below minimum "
                                f"{profile.min_trace_spacing_mm:.3f}mm "
                                f"for {profile.name}"
                            ),
                            location=(centroid_a.x, centroid_a.y),
                            measured_value=dist,
                            required_value=profile.min_trace_spacing_mm,
                            suggestion=(
                                f"Increase spacing to at least "
                                f"{profile.min_trace_spacing_mm:.3f}mm"
                            ),
                        ))

        return issues

    def _check_drill_sizes(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check all drill holes against minimum size."""
        issues: list[DFMIssue] = []

        # Vias
        for via in board.vias:
            if via.drill < profile.min_via_drill_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="drill_size",
                    description=(
                        f"Via drill {via.drill:.3f}mm at "
                        f"({via.x:.2f}, {via.y:.2f}) is below minimum "
                        f"{profile.min_via_drill_mm:.3f}mm for {profile.name}"
                    ),
                    location=(via.x, via.y),
                    measured_value=via.drill,
                    required_value=profile.min_via_drill_mm,
                    suggestion=(
                        f"Increase via drill to at least "
                        f"{profile.min_via_drill_mm:.3f}mm"
                    ),
                ))

        # Through-hole pads
        for pad in board.pads:
            if pad.is_through_hole and pad.drill < profile.min_drill_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="drill_size",
                    description=(
                        f"Pad drill {pad.drill:.3f}mm for {pad.component_ref} "
                        f"at ({pad.x:.2f}, {pad.y:.2f}) is below minimum "
                        f"{profile.min_drill_mm:.3f}mm for {profile.name}"
                    ),
                    location=(pad.x, pad.y),
                    measured_value=pad.drill,
                    required_value=profile.min_drill_mm,
                    suggestion=(
                        f"Increase drill to at least {profile.min_drill_mm:.3f}mm"
                    ),
                ))

        # Non-plated holes
        for hole in board.drills:
            if hole.diameter < profile.min_drill_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="drill_size",
                    description=(
                        f"Drill hole {hole.diameter:.3f}mm at "
                        f"({hole.x:.2f}, {hole.y:.2f}) is below minimum "
                        f"{profile.min_drill_mm:.3f}mm for {profile.name}"
                    ),
                    location=(hole.x, hole.y),
                    measured_value=hole.diameter,
                    required_value=profile.min_drill_mm,
                    suggestion=f"Increase drill to {profile.min_drill_mm:.3f}mm",
                ))

        return issues

    def _check_annular_ring(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check annular ring sizes for vias and TH pads."""
        issues: list[DFMIssue] = []

        for via in board.vias:
            ring = via.annular_ring
            if ring < profile.min_annular_ring_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="annular_ring",
                    description=(
                        f"Via annular ring {ring:.3f}mm at "
                        f"({via.x:.2f}, {via.y:.2f}) is below minimum "
                        f"{profile.min_annular_ring_mm:.3f}mm for {profile.name}"
                    ),
                    location=(via.x, via.y),
                    measured_value=ring,
                    required_value=profile.min_annular_ring_mm,
                    suggestion=(
                        f"Increase via pad diameter to at least "
                        f"{via.drill + 2 * profile.min_annular_ring_mm:.3f}mm"
                    ),
                ))

        for pad in board.pads:
            if pad.is_through_hole:
                ring = pad.annular_ring
                if ring < profile.min_annular_ring_mm:
                    issues.append(DFMIssue(
                        severity=DFMSeverity.ERROR,
                        category="annular_ring",
                        description=(
                            f"Pad annular ring {ring:.3f}mm for "
                            f"{pad.component_ref} at ({pad.x:.2f}, {pad.y:.2f}) "
                            f"is below minimum "
                            f"{profile.min_annular_ring_mm:.3f}mm for {profile.name}"
                        ),
                        location=(pad.x, pad.y),
                        measured_value=ring,
                        required_value=profile.min_annular_ring_mm,
                        suggestion="Increase pad size or reduce drill diameter",
                    ))

        return issues

    def _check_board_dimensions(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check board size and layer count against fab limits."""
        issues: list[DFMIssue] = []

        # Board size
        if board.outline is not None and not board.outline.is_empty:
            bounds = board.outline.bounds  # (minx, miny, maxx, maxy)
            width = bounds[2] - bounds[0]
            height = bounds[3] - bounds[1]

            if width > profile.max_board_width_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="board_size",
                    description=(
                        f"Board width {width:.1f}mm exceeds maximum "
                        f"{profile.max_board_width_mm:.1f}mm for {profile.name}"
                    ),
                    measured_value=width,
                    required_value=profile.max_board_width_mm,
                    suggestion="Reduce board width or choose a different fab",
                ))

            if height > profile.max_board_height_mm:
                issues.append(DFMIssue(
                    severity=DFMSeverity.ERROR,
                    category="board_size",
                    description=(
                        f"Board height {height:.1f}mm exceeds maximum "
                        f"{profile.max_board_height_mm:.1f}mm for {profile.name}"
                    ),
                    measured_value=height,
                    required_value=profile.max_board_height_mm,
                    suggestion="Reduce board height or choose a different fab",
                ))

        # Layer count
        layer_count = len(board.copper_layers())
        if layer_count > profile.max_layer_count:
            issues.append(DFMIssue(
                severity=DFMSeverity.ERROR,
                category="layer_count",
                description=(
                    f"Board has {layer_count} copper layers, exceeding "
                    f"maximum {profile.max_layer_count} for {profile.name}"
                ),
                measured_value=float(layer_count),
                required_value=float(profile.max_layer_count),
                suggestion="Reduce layer count or choose a different fab",
            ))

        return issues

    def _check_special_features(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check for special features not supported by the fab."""
        issues: list[DFMIssue] = []

        # Check for blind/buried vias
        copper_layers = board.copper_layers()
        if len(copper_layers) >= 2:
            first_layer = copper_layers[0]
            last_layer = copper_layers[-1]

            for via in board.vias:
                is_through = (
                    (via.start_layer == first_layer or via.start_layer.name == first_layer.name)
                    and (via.end_layer == last_layer or via.end_layer.name == last_layer.name)
                )

                if not is_through:
                    # It's a blind or buried via
                    starts_at_surface = (
                        via.start_layer == first_layer
                        or via.start_layer.name == first_layer.name
                        or via.end_layer == first_layer
                        or via.end_layer.name == first_layer.name
                        or via.start_layer == last_layer
                        or via.start_layer.name == last_layer.name
                        or via.end_layer == last_layer
                        or via.end_layer.name == last_layer.name
                    )

                    if starts_at_surface:
                        # Blind via
                        if not profile.supports_blind_vias:
                            issues.append(DFMIssue(
                                severity=DFMSeverity.ERROR,
                                category="special_feature",
                                description=(
                                    f"Blind via at ({via.x:.2f}, {via.y:.2f}) "
                                    f"not supported by {profile.name}"
                                ),
                                location=(via.x, via.y),
                                suggestion="Use through-hole vias or choose a different fab",
                            ))
                    else:
                        # Buried via
                        if not profile.supports_buried_vias:
                            issues.append(DFMIssue(
                                severity=DFMSeverity.ERROR,
                                category="special_feature",
                                description=(
                                    f"Buried via at ({via.x:.2f}, {via.y:.2f}) "
                                    f"not supported by {profile.name}"
                                ),
                                location=(via.x, via.y),
                                suggestion="Use through-hole vias or choose a different fab",
                            ))

        # Check for edge clearance
        if board.outline is not None and not board.outline.is_empty:
            outline = board.outline
            for via in board.vias:
                from shapely.geometry import Point as ShapelyPoint
                pt = ShapelyPoint(via.x, via.y)
                edge_dist = outline.exterior.distance(pt)
                if edge_dist < profile.min_hole_to_edge_mm:
                    issues.append(DFMIssue(
                        severity=DFMSeverity.ERROR,
                        category="edge_clearance",
                        description=(
                            f"Via at ({via.x:.2f}, {via.y:.2f}) is "
                            f"{edge_dist:.3f}mm from board edge, below "
                            f"minimum {profile.min_hole_to_edge_mm:.3f}mm "
                            f"for {profile.name}"
                        ),
                        location=(via.x, via.y),
                        measured_value=edge_dist,
                        required_value=profile.min_hole_to_edge_mm,
                        suggestion="Move via further from board edge",
                    ))

        return issues

    def _check_solder_mask(
        self, board: BoardDesign, profile: FabProfile
    ) -> list[DFMIssue]:
        """Check solder mask bridge widths between adjacent pads."""
        issues: list[DFMIssue] = []
        expansion = board.design_rules.solder_mask_expansion

        # Check pads on the same layer that are close together
        for layer in board.copper_layers():
            layer_pads = board.pads_on_layer(layer)

            # Pairwise check (limited)
            max_checks = min(len(layer_pads), 300)
            for i in range(max_checks):
                for j in range(i + 1, min(i + 30, len(layer_pads))):
                    pa = layer_pads[i]
                    pb = layer_pads[j]

                    # Distance between pad edges including mask expansion
                    dx = abs(pa.x - pb.x)
                    dy = abs(pa.y - pb.y)
                    center_dist = math.sqrt(dx**2 + dy**2)

                    # Approximate edge-to-edge distance
                    ra = max(pa.width, pa.height) / 2.0 + expansion
                    rb = max(pb.width, pb.height) / 2.0 + expansion
                    edge_dist = center_dist - ra - rb

                    if 0 < edge_dist < profile.min_solder_mask_bridge_mm:
                        mid_x = (pa.x + pb.x) / 2.0
                        mid_y = (pa.y + pb.y) / 2.0
                        issues.append(DFMIssue(
                            severity=DFMSeverity.WARNING,
                            category="solder_mask_bridge",
                            description=(
                                f"Solder mask bridge {edge_dist:.3f}mm between "
                                f"{pa.component_ref}:{pa.pad_number} and "
                                f"{pb.component_ref}:{pb.pad_number} on "
                                f"{layer.name} is below minimum "
                                f"{profile.min_solder_mask_bridge_mm:.3f}mm "
                                f"for {profile.name}"
                            ),
                            location=(mid_x, mid_y),
                            measured_value=edge_dist,
                            required_value=profile.min_solder_mask_bridge_mm,
                            suggestion=(
                                "Reduce solder mask expansion or increase "
                                "pad spacing"
                            ),
                        ))

        return issues

    def analyze(
        self,
        board: BoardDesign,
        fab_profile: Optional[str | FabProfile] = None,
    ) -> DFMReport:
        """Run DFM analysis against a fab profile.

        Args:
            board: Board design to analyze.
            fab_profile: Fab profile name ("jlcpcb", "pcbway", "osh_park")
                or a FabProfile instance. Defaults to JLCPCB.

        Returns:
            DFMReport with issues, warnings, score, and compatibility.
        """
        if fab_profile is None:
            profile = JLCPCB
        elif isinstance(fab_profile, str):
            profile = FAB_PROFILES.get(fab_profile.lower(), JLCPCB)
        else:
            profile = fab_profile

        all_issues: list[DFMIssue] = []

        # Run all checks
        all_issues.extend(self._check_trace_width(board, profile))
        all_issues.extend(self._check_trace_spacing(board, profile))
        all_issues.extend(self._check_drill_sizes(board, profile))
        all_issues.extend(self._check_annular_ring(board, profile))
        all_issues.extend(self._check_board_dimensions(board, profile))
        all_issues.extend(self._check_special_features(board, profile))
        all_issues.extend(self._check_solder_mask(board, profile))

        # Split into errors and warnings
        errors = [i for i in all_issues if i.severity == DFMSeverity.ERROR]
        warnings = [i for i in all_issues if i.severity in (DFMSeverity.WARNING, DFMSeverity.INFO)]

        # Calculate score
        # Start at 100, deduct points for issues
        score = 100.0
        score -= len(errors) * 10.0  # 10 points per error
        score -= len(warnings) * 2.0  # 2 points per warning
        score = max(0.0, score)

        fab_compatible = len(errors) == 0

        report = DFMReport(
            fab_profile=profile.name,
            issues=all_issues,
            warnings=warnings,
            score=score,
            fab_compatible=fab_compatible,
            summary=(
                f"DFM analysis for {profile.name}: "
                f"{'COMPATIBLE' if fab_compatible else 'NOT COMPATIBLE'}. "
                f"Score: {score:.0f}/100. "
                f"{len(errors)} errors, {len(warnings)} warnings. "
                f"{profile.notes}"
            ),
        )

        return report
