"""Manufacturing DRC checks against fabrication house capabilities.

Verifies drill sizes, drill-to-copper clearances, and solder mask openings
against predefined fabrication profiles.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from shapely.geometry import Point as ShapelyPoint

from routeai_solver.board_model import BoardDesign, Pad, Via
from routeai_solver.drc.engine import DRCSeverity, DRCViolation


# ---------------------------------------------------------------------------
# Fabrication profiles
# ---------------------------------------------------------------------------

@dataclass
class FabProfile:
    """Fabrication house capabilities and limits.

    All dimensions in millimeters.
    """

    name: str
    min_trace: float  # minimum trace width (mm)
    min_space: float  # minimum trace spacing (mm)
    min_drill: float  # minimum drill diameter (mm)
    min_annular_ring: float  # minimum annular ring (mm)
    min_solder_mask_bridge: float = 0.1  # minimum solder mask web (mm)
    min_solder_mask_opening: float = 0.1  # mm
    min_drill_to_copper: float = 0.2  # mm
    max_board_thickness: float = 2.4  # mm
    min_via_drill: float = 0.2  # mm
    min_via_annular_ring: float = 0.1  # mm


# Predefined fabrication profiles based on common PCB manufacturers
JLCPCB_STANDARD = FabProfile(
    name="JLCPCB Standard",
    min_trace=0.127,          # 5 mil
    min_space=0.127,          # 5 mil
    min_drill=0.3,            # 12 mil
    min_annular_ring=0.13,
    min_solder_mask_bridge=0.1,
    min_solder_mask_opening=0.1,
    min_drill_to_copper=0.2,
    min_via_drill=0.3,
    min_via_annular_ring=0.1,
)

JLCPCB_ADVANCED = FabProfile(
    name="JLCPCB Advanced",
    min_trace=0.0762,         # 3 mil
    min_space=0.0762,         # 3 mil
    min_drill=0.15,           # 6 mil
    min_annular_ring=0.075,
    min_solder_mask_bridge=0.075,
    min_solder_mask_opening=0.075,
    min_drill_to_copper=0.15,
    min_via_drill=0.15,
    min_via_annular_ring=0.075,
)

PCBWAY_STANDARD = FabProfile(
    name="PCBWay Standard",
    min_trace=0.127,          # 5 mil
    min_space=0.127,          # 5 mil
    min_drill=0.3,
    min_annular_ring=0.15,
    min_solder_mask_bridge=0.1,
    min_solder_mask_opening=0.1,
    min_drill_to_copper=0.2,
    min_via_drill=0.3,
    min_via_annular_ring=0.1,
)

OSHPARK = FabProfile(
    name="OSH Park",
    min_trace=0.152,          # 6 mil
    min_space=0.152,          # 6 mil
    min_drill=0.254,          # 10 mil
    min_annular_ring=0.102,   # 4 mil
    min_solder_mask_bridge=0.1,
    min_solder_mask_opening=0.1,
    min_drill_to_copper=0.2,
    min_via_drill=0.254,
    min_via_annular_ring=0.102,
)


def _get_profile(board: BoardDesign, profile: Optional[FabProfile] = None) -> FabProfile:
    """Get fabrication profile, using board design rules as fallback."""
    if profile is not None:
        return profile
    dr = board.design_rules
    return FabProfile(
        name="Board Design Rules",
        min_trace=dr.min_trace_width,
        min_space=dr.min_clearance,
        min_drill=dr.min_drill,
        min_annular_ring=dr.min_annular_ring,
        min_drill_to_copper=dr.drill_to_copper_clearance,
        min_solder_mask_bridge=dr.min_solder_mask_bridge,
    )


# ---------------------------------------------------------------------------
# Manufacturing checks
# ---------------------------------------------------------------------------

def check_min_drill(
    board: BoardDesign,
    profile: Optional[FabProfile] = None,
) -> list[DRCViolation]:
    """Check that all drill holes meet the minimum drill size.

    Checks both through-hole pad drills and via drills.

    Args:
        board: The board design to check.
        profile: Optional fabrication profile. Uses board design rules if None.

    Returns:
        List of DRC violations for undersized drills.
    """
    violations: list[DRCViolation] = []
    prof = _get_profile(board, profile)

    # Check through-hole pad drills
    for pad in board.pads:
        if pad.is_through_hole and pad.drill < prof.min_drill:
            violations.append(DRCViolation(
                rule="min_drill",
                severity=DRCSeverity.ERROR,
                message=(
                    f"Pad drill {pad.drill:.4f}mm < "
                    f"{prof.min_drill:.4f}mm minimum ({prof.name})"
                ),
                location=(pad.x, pad.y),
                affected_items=[
                    f"Pad({pad.component_ref or '?'}.{pad.pad_number})"
                ],
            ))

    # Check via drills
    for via in board.vias:
        min_via = prof.min_via_drill
        if via.drill < min_via:
            violations.append(DRCViolation(
                rule="min_drill",
                severity=DRCSeverity.ERROR,
                message=(
                    f"Via drill {via.drill:.4f}mm < "
                    f"{min_via:.4f}mm minimum ({prof.name})"
                ),
                location=(via.x, via.y),
                affected_items=[
                    f"Via(net={via.net.name})"
                ],
            ))

    # Check non-plated drill holes
    for drill in board.drills:
        if drill.diameter < prof.min_drill:
            violations.append(DRCViolation(
                rule="min_drill",
                severity=DRCSeverity.ERROR,
                message=(
                    f"Drill hole {drill.diameter:.4f}mm < "
                    f"{prof.min_drill:.4f}mm minimum ({prof.name})"
                ),
                location=(drill.x, drill.y),
                affected_items=["DrillHole"],
            ))

    return violations


def check_drill_to_copper(
    board: BoardDesign,
    profile: Optional[FabProfile] = None,
) -> list[DRCViolation]:
    """Check clearance between non-plated drill holes and copper features.

    Non-plated holes must maintain minimum clearance from all copper on
    all layers they pass through.

    Args:
        board: The board design to check.
        profile: Optional fabrication profile.

    Returns:
        List of DRC violations for insufficient drill-to-copper clearance.
    """
    violations: list[DRCViolation] = []
    prof = _get_profile(board, profile)
    min_d2c = prof.min_drill_to_copper

    # Only check non-plated drill holes
    non_plated = [d for d in board.drills if not d.plated]
    if not non_plated:
        return violations

    for drill in non_plated:
        drill_circle = ShapelyPoint(drill.x, drill.y).buffer(
            drill.diameter / 2.0, resolution=32
        )

        for layer in board.copper_layers():
            # Check against traces
            for trace in board.traces_on_layer(layer):
                geom = trace.to_shapely()
                if geom.is_empty:
                    continue
                dist = drill_circle.distance(geom)
                if dist < min_d2c:
                    violations.append(DRCViolation(
                        rule="drill_to_copper",
                        severity=DRCSeverity.ERROR,
                        message=(
                            f"Drill-to-copper clearance {dist:.4f}mm < "
                            f"{min_d2c:.4f}mm on {layer.name}"
                        ),
                        location=(drill.x, drill.y),
                        affected_items=[
                            "DrillHole",
                            f"Trace(net={trace.net.name})",
                        ],
                    ))

            # Check against pads (only pads of different nets or no net)
            for pad in board.pads_on_layer(layer):
                geom = pad.to_shapely()
                if geom.is_empty:
                    continue
                dist = drill_circle.distance(geom)
                if dist < min_d2c:
                    violations.append(DRCViolation(
                        rule="drill_to_copper",
                        severity=DRCSeverity.ERROR,
                        message=(
                            f"Drill-to-copper clearance {dist:.4f}mm < "
                            f"{min_d2c:.4f}mm on {layer.name}"
                        ),
                        location=(drill.x, drill.y),
                        affected_items=[
                            "DrillHole",
                            f"Pad({pad.component_ref or '?'}.{pad.pad_number})",
                        ],
                    ))

    return violations


def check_solder_paste_coverage(
    board: BoardDesign,
    profile: Optional[FabProfile] = None,
    min_ratio: float = 0.5,
    max_ratio: float = 1.0,
    target_ratio: float = 0.75,
) -> list[DRCViolation]:
    """Check solder paste coverage and area ratio for SMD pads.

    Proper solder paste coverage is critical for reliable solder joints.
    The paste-to-pad area ratio should typically be between 50% and 100%
    of the pad area. Too little paste causes cold joints; too much causes
    bridging and tombstoning.

    For fine-pitch components (pad width < 0.5mm), the paste ratio
    requirements are tighter to prevent bridging.

    IPC-7525 guidelines:
    - Standard pads: paste area 60-100% of pad area
    - Fine pitch (< 0.5mm): paste area 50-80% of pad area
    - Large pads (> 3mm): paste may need segmentation (stencil splits)

    Args:
        board: The board design to check.
        profile: Optional fabrication profile.
        min_ratio: Minimum acceptable paste-to-pad area ratio (default 0.5).
        max_ratio: Maximum acceptable paste-to-pad area ratio (default 1.0).
        target_ratio: Target paste-to-pad area ratio (default 0.75).

    Returns:
        List of DRC violations for paste coverage issues.
    """
    violations: list[DRCViolation] = []

    for pad in board.pads:
        # Only check SMD pads (through-hole pads don't get paste)
        if pad.is_through_hole:
            continue

        pad_area = pad.width * pad.height
        if pad_area <= 0:
            continue

        # Determine effective paste aperture dimensions
        # Paste aperture is typically reduced from pad size
        paste_shrink = 0.05  # mm default paste reduction per side
        paste_width = max(0.05, pad.width - 2 * paste_shrink)
        paste_height = max(0.05, pad.height - 2 * paste_shrink)
        paste_area = paste_width * paste_height

        ratio = paste_area / pad_area

        # Adjust thresholds for fine-pitch pads
        pad_min_dim = min(pad.width, pad.height)
        effective_min = min_ratio
        effective_max = max_ratio

        if pad_min_dim < 0.5:
            # Fine pitch: tighter control
            effective_min = 0.5
            effective_max = 0.8

        # Check for large pads that may need stencil splits
        if pad_area > 9.0:  # > 3mm x 3mm equivalent
            violations.append(DRCViolation(
                rule="solder_paste_coverage",
                severity=DRCSeverity.INFO,
                message=(
                    f"Large pad ({pad.width:.2f}x{pad.height:.2f}mm, "
                    f"area={pad_area:.2f}mm^2) may benefit from "
                    f"stencil paste aperture segmentation"
                ),
                location=(pad.x, pad.y),
                affected_items=[
                    f"Pad({pad.component_ref or '?'}.{pad.pad_number})"
                ],
            ))

        if ratio < effective_min:
            violations.append(DRCViolation(
                rule="solder_paste_coverage",
                severity=DRCSeverity.WARNING,
                message=(
                    f"Solder paste ratio {ratio:.1%} below minimum "
                    f"{effective_min:.1%} for pad "
                    f"{pad.width:.3f}x{pad.height:.3f}mm"
                ),
                location=(pad.x, pad.y),
                affected_items=[
                    f"Pad({pad.component_ref or '?'}.{pad.pad_number})"
                ],
            ))
        elif ratio > effective_max:
            violations.append(DRCViolation(
                rule="solder_paste_coverage",
                severity=DRCSeverity.WARNING,
                message=(
                    f"Solder paste ratio {ratio:.1%} above maximum "
                    f"{effective_max:.1%} for pad "
                    f"{pad.width:.3f}x{pad.height:.3f}mm"
                ),
                location=(pad.x, pad.y),
                affected_items=[
                    f"Pad({pad.component_ref or '?'}.{pad.pad_number})"
                ],
            ))

    return violations


def check_solder_mask(
    board: BoardDesign,
    profile: Optional[FabProfile] = None,
) -> list[DRCViolation]:
    """Check solder mask openings and bridges between pads.

    Verifies that the solder mask web (bridge) between adjacent pads
    meets the minimum width for the fabrication profile.

    The solder mask opening around each pad is the pad extent plus the
    solder_mask_expansion from design rules. If two openings overlap or
    are too close, the mask bridge between them may be too thin to
    reliably manufacture.

    Args:
        board: The board design to check.
        profile: Optional fabrication profile.

    Returns:
        List of DRC violations for solder mask issues.
    """
    violations: list[DRCViolation] = []
    prof = _get_profile(board, profile)
    expansion = board.design_rules.solder_mask_expansion
    min_bridge = prof.min_solder_mask_bridge

    # Collect SMD pads per layer (through-hole pads have mask openings on both sides)
    layer_pads: dict[str, list[Pad]] = {}
    for pad in board.pads:
        layer_name = pad.layer.name
        layer_pads.setdefault(layer_name, []).append(pad)

    for layer_name, pads in layer_pads.items():
        # Build expanded mask opening geometries
        pad_mask_geoms = []
        for pad in pads:
            base_geom = pad.to_shapely()
            # Expand by solder mask expansion to get the mask opening
            mask_opening = base_geom.buffer(expansion)
            pad_mask_geoms.append((pad, mask_opening))

        # Check all pad pairs on this layer for mask bridge violations
        for i in range(len(pad_mask_geoms)):
            for j in range(i + 1, len(pad_mask_geoms)):
                pad_a, mask_a = pad_mask_geoms[i]
                pad_b, mask_b = pad_mask_geoms[j]

                # Distance between mask openings
                mask_gap = mask_a.distance(mask_b)

                if mask_gap < min_bridge:
                    # The mask bridge is too narrow or the openings overlap
                    mid_x = (pad_a.x + pad_b.x) / 2.0
                    mid_y = (pad_a.y + pad_b.y) / 2.0

                    if mask_gap < 0 or mask_a.intersects(mask_b):
                        msg = (
                            f"Solder mask openings overlap between pads on "
                            f"{layer_name} (bridge={mask_gap:.4f}mm < "
                            f"{min_bridge:.4f}mm)"
                        )
                    else:
                        msg = (
                            f"Solder mask bridge {mask_gap:.4f}mm < "
                            f"{min_bridge:.4f}mm on {layer_name}"
                        )

                    violations.append(DRCViolation(
                        rule="solder_mask",
                        severity=DRCSeverity.WARNING,
                        message=msg,
                        location=(mid_x, mid_y),
                        affected_items=[
                            f"Pad({pad_a.component_ref or '?'}.{pad_a.pad_number})",
                            f"Pad({pad_b.component_ref or '?'}.{pad_b.pad_number})",
                        ],
                    ))

    return violations
