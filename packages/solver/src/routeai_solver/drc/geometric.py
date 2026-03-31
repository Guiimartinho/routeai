"""Geometric DRC checks using Shapely for polygon/line distance calculations.

Checks clearances between copper objects, minimum trace widths,
annular ring requirements, and board edge clearances.
"""

from __future__ import annotations

from itertools import combinations
from typing import TYPE_CHECKING

from shapely.geometry import MultiPolygon
from shapely.geometry import Polygon as ShapelyPolygon

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    Pad,
    Trace,
    TraceSegment,
    Via,
)
from routeai_solver.drc.engine import DRCSeverity, DRCViolation

if TYPE_CHECKING:
    pass


def _item_label(item: object) -> str:
    """Generate a human-readable label for a board item."""
    if isinstance(item, Trace):
        return f"Trace(net={item.net.name}, layer={item.layer.name})"
    elif isinstance(item, Pad):
        ref = item.component_ref or "?"
        return f"Pad({ref}.{item.pad_number}, net={item.net.name})"
    elif isinstance(item, Via):
        return f"Via(net={item.net.name}, pos=({item.x:.3f},{item.y:.3f}))"
    elif isinstance(item, CopperZone):
        return f"Zone(net={item.net.name}, layer={item.layer.name})"
    return str(item)


def _geometry_centroid(geom: ShapelyPolygon | MultiPolygon) -> tuple[float, float] | None:
    """Get the centroid of a Shapely geometry."""
    if geom.is_empty:
        return None
    c = geom.centroid
    return (c.x, c.y)


def _get_copper_items_on_layer(
    board: BoardDesign, layer: Layer
) -> list[tuple[object, ShapelyPolygon | MultiPolygon, str]]:
    """Collect all copper items on a layer as (item, geometry, net_name) tuples."""
    items = []

    for trace in board.traces_on_layer(layer):
        geom = trace.to_shapely()
        if not geom.is_empty:
            items.append((trace, geom, trace.net.name))

    for pad in board.pads_on_layer(layer):
        geom = pad.to_shapely()
        if not geom.is_empty:
            items.append((pad, geom, pad.net.name))

    for via in board.vias:
        # Vias appear on all layers between start and end
        if layer == via.start_layer or layer == via.end_layer:
            geom = via.to_shapely()
            if not geom.is_empty:
                items.append((via, geom, via.net.name))

    for zone in board.zones:
        if zone.layer == layer:
            geom = zone.to_shapely()
            if not geom.is_empty:
                items.append((zone, geom, zone.net.name))

    return items


def check_clearance(board: BoardDesign) -> list[DRCViolation]:
    """Check clearances between all copper items on each layer.

    Verifies trace-trace, trace-pad, trace-via, trace-zone, pad-pad,
    pad-via, and via-via clearances against the board's design rules.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for clearance failures.
    """
    violations: list[DRCViolation] = []
    min_clearance = board.design_rules.min_clearance

    for layer in board.copper_layers():
        items = _get_copper_items_on_layer(board, layer)

        # Check all pairs of items on this layer
        for i, j in combinations(range(len(items)), 2):
            item_a, geom_a, net_a = items[i]
            item_b, geom_b, net_b = items[j]

            # Items on the same net don't need clearance checks between each other
            if net_a == net_b:
                continue

            # Compute minimum distance between the two geometries
            distance = geom_a.distance(geom_b)

            if distance < min_clearance:
                # Find approximate location of the violation
                # Use the nearest points between the two geometries
                from shapely.ops import nearest_points

                p1, p2 = nearest_points(geom_a, geom_b)
                loc = ((p1.x + p2.x) / 2.0, (p1.y + p2.y) / 2.0)

                violations.append(DRCViolation(
                    rule="clearance",
                    severity=DRCSeverity.ERROR,
                    message=(
                        f"Clearance violation on {layer.name}: "
                        f"{distance:.4f}mm < {min_clearance:.4f}mm minimum"
                    ),
                    location=loc,
                    affected_items=[_item_label(item_a), _item_label(item_b)],
                ))

    return violations


def check_min_trace_width(board: BoardDesign) -> list[DRCViolation]:
    """Verify all trace segments meet the minimum width requirement.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for traces below minimum width.
    """
    violations: list[DRCViolation] = []
    min_width = board.design_rules.min_trace_width

    for trace in board.traces:
        for seg in trace.segments:
            if seg.width < min_width:
                mid_x = (seg.start_x + seg.end_x) / 2.0
                mid_y = (seg.start_y + seg.end_y) / 2.0
                violations.append(DRCViolation(
                    rule="min_trace_width",
                    severity=DRCSeverity.ERROR,
                    message=(
                        f"Trace width {seg.width:.4f}mm < "
                        f"{min_width:.4f}mm minimum on {trace.layer.name}"
                    ),
                    location=(mid_x, mid_y),
                    affected_items=[_item_label(trace)],
                ))

    return violations


def check_min_annular_ring(board: BoardDesign) -> list[DRCViolation]:
    """Check that pad and via annular rings meet the minimum requirement.

    The annular ring is the copper ring around a drill hole.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for insufficient annular rings.
    """
    violations: list[DRCViolation] = []
    min_ring = board.design_rules.min_annular_ring

    # Check through-hole pads
    for pad in board.pads:
        if pad.is_through_hole:
            ring = pad.annular_ring
            if ring < min_ring:
                violations.append(DRCViolation(
                    rule="min_annular_ring",
                    severity=DRCSeverity.ERROR,
                    message=(
                        f"Pad annular ring {ring:.4f}mm < "
                        f"{min_ring:.4f}mm minimum"
                    ),
                    location=(pad.x, pad.y),
                    affected_items=[_item_label(pad)],
                ))

    # Check vias
    for via in board.vias:
        ring = via.annular_ring
        if ring < min_ring:
            violations.append(DRCViolation(
                rule="min_annular_ring",
                severity=DRCSeverity.ERROR,
                message=(
                    f"Via annular ring {ring:.4f}mm < "
                    f"{min_ring:.4f}mm minimum"
                ),
                location=(via.x, via.y),
                affected_items=[_item_label(via)],
                ))

    return violations


def check_silk_to_pad_clearance(board: BoardDesign) -> list[DRCViolation]:
    """Check that silkscreen graphics maintain minimum clearance from pads.

    Silkscreen ink that overlaps solder mask openings (pad areas) causes
    manufacturing defects: poor solder wetting, adhesion issues, and
    cosmetic problems. This check verifies all silkscreen items maintain
    minimum clearance from pad copper plus mask expansion.

    The check examines the bounding extents of each pad (including mask
    expansion) and verifies no silk lines, arcs, or text fall within
    the exclusion zone.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for silk-over-pad conflicts.
    """
    violations: list[DRCViolation] = []
    min_silk_clearance = 0.15  # mm - typical silk-to-pad clearance
    mask_expansion = board.design_rules.solder_mask_expansion

    # Collect pad geometries per side with mask expansion
    front_pad_geoms: list[tuple[Pad, ShapelyPolygon]] = []
    back_pad_geoms: list[tuple[Pad, ShapelyPolygon]] = []

    for pad in board.pads:
        geom = pad.to_shapely()
        if geom.is_empty:
            continue
        # Expand pad geometry by mask expansion to get the actual exclusion zone
        expanded = geom.buffer(mask_expansion + min_silk_clearance)

        if pad.layer.name == "F.Cu":
            front_pad_geoms.append((pad, expanded))
        elif pad.layer.name == "B.Cu":
            back_pad_geoms.append((pad, expanded))

    # Also add via pad exclusion zones on both sides
    for via in board.vias:
        via_geom = via.to_shapely()
        if via_geom.is_empty:
            continue
        expanded = via_geom.buffer(mask_expansion + min_silk_clearance)
        front_pad_geoms.append((None, expanded))  # type: ignore[arg-type]
        back_pad_geoms.append((None, expanded))  # type: ignore[arg-type]

    # Check traces on silk layers (silk lines are stored as traces by some designs)
    # Also check any graphical items that would be on silk layers
    for trace in board.traces:
        # Determine which pad list to check against
        if trace.layer.name == "F.SilkS":
            pad_geoms = front_pad_geoms
        elif trace.layer.name == "B.SilkS":
            pad_geoms = back_pad_geoms
        else:
            continue

        silk_geom = trace.to_shapely()
        if silk_geom.is_empty:
            continue

        for pad_item, pad_exclusion in pad_geoms:
            if silk_geom.intersects(pad_exclusion):
                from shapely.ops import nearest_points
                p1, p2 = nearest_points(silk_geom, pad_exclusion)
                loc = (p1.x, p1.y)

                pad_label = "Pad" if pad_item is None else _item_label(pad_item)
                violations.append(DRCViolation(
                    rule="silk_to_pad_clearance",
                    severity=DRCSeverity.WARNING,
                    message=(
                        f"Silkscreen overlaps pad exclusion zone on "
                        f"{trace.layer.name}"
                    ),
                    location=loc,
                    affected_items=[_item_label(trace), pad_label],
                ))

    return violations


def check_acid_traps(board: BoardDesign) -> list[DRCViolation]:
    """Detect acid traps in the PCB layout.

    Acid traps are acute-angle junctions between copper features (typically
    traces meeting at sharp angles < 90 degrees). During etching, etchant
    can become trapped in these acute corners, leading to incomplete etching
    and potential shorts or reliability issues.

    Detection algorithm:
    1. Find all trace segment endpoints that share a common node (junction).
    2. For each junction with 2+ segments, compute the angles between them.
    3. Flag any junction where the acute angle between adjacent segments
       is below the threshold (default: 90 degrees).

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for detected acid traps.
    """
    violations: list[DRCViolation] = []
    acid_trap_threshold = 90.0  # degrees - angles below this are acid traps

    import math
    from collections import defaultdict

    for layer in board.copper_layers():
        # Build junction map: position -> list of (trace, segment, direction_vector)
        # Direction vector points away from the junction
        junction_map: dict[
            tuple[float, float], list[tuple[Trace, TraceSegment, float, float]]
        ] = defaultdict(list)

        for trace in board.traces_on_layer(layer):
            for seg in trace.segments:
                # Start endpoint: direction is from start toward end
                sx = round(seg.start_x, 4)
                sy = round(seg.start_y, 4)
                dx = seg.end_x - seg.start_x
                dy = seg.end_y - seg.start_y
                length = math.sqrt(dx * dx + dy * dy)
                if length > 1e-9:
                    junction_map[(sx, sy)].append(
                        (trace, seg, dx / length, dy / length)
                    )

                # End endpoint: direction is from end toward start
                ex = round(seg.end_x, 4)
                ey = round(seg.end_y, 4)
                if length > 1e-9:
                    junction_map[(ex, ey)].append(
                        (trace, seg, -dx / length, -dy / length)
                    )

        # Check each junction with 2+ segments
        for (jx, jy), segments in junction_map.items():
            if len(segments) < 2:
                continue

            for i in range(len(segments)):
                for j in range(i + 1, len(segments)):
                    t1, s1, dx1, dy1 = segments[i]
                    t2, s2, dx2, dy2 = segments[j]

                    # Skip segments from same trace that are just continuations
                    # (180-degree angle is normal)

                    # Compute angle between the two direction vectors
                    dot = dx1 * dx2 + dy1 * dy2
                    # Clamp for numerical stability
                    dot = max(-1.0, min(1.0, dot))
                    angle = math.degrees(math.acos(dot))

                    # The angle between segments meeting at a junction
                    # A straight continuation is 180 degrees
                    # An acid trap is when the angle between the copper
                    # features (not the direction vectors) is acute
                    # The copper angle is 180 - angle_between_vectors
                    copper_angle = 180.0 - angle

                    if copper_angle < acid_trap_threshold and copper_angle > 1.0:
                        violations.append(DRCViolation(
                            rule="acid_trap",
                            severity=DRCSeverity.WARNING,
                            message=(
                                f"Acid trap detected: {copper_angle:.1f} degree "
                                f"angle between traces on {layer.name} "
                                f"(minimum recommended: {acid_trap_threshold})"
                            ),
                            location=(jx, jy),
                            affected_items=[
                                _item_label(t1), _item_label(t2)
                            ],
                        ))

    return violations


def check_board_edge_clearance(board: BoardDesign) -> list[DRCViolation]:
    """Check that all copper items maintain minimum clearance from the board edge.

    Args:
        board: The board design to check. Must have a non-None outline.

    Returns:
        List of DRC violations for items too close to the board edge.
    """
    violations: list[DRCViolation] = []

    if board.outline is None:
        return violations

    min_edge_clearance = board.design_rules.board_edge_clearance
    outline_boundary = board.outline.boundary  # LineString of the outline

    for layer in board.copper_layers():
        items = _get_copper_items_on_layer(board, layer)

        for item, geom, net_name in items:
            # Distance from copper geometry to board outline boundary
            distance = geom.distance(outline_boundary)

            if distance < min_edge_clearance:
                from shapely.ops import nearest_points

                p1, _ = nearest_points(geom, outline_boundary)
                loc = (p1.x, p1.y)

                violations.append(DRCViolation(
                    rule="board_edge_clearance",
                    severity=DRCSeverity.ERROR,
                    message=(
                        f"Board edge clearance {distance:.4f}mm < "
                        f"{min_edge_clearance:.4f}mm minimum on {layer.name}"
                    ),
                    location=loc,
                    affected_items=[_item_label(item)],
                ))

    return violations
