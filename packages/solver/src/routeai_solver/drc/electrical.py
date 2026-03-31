"""Electrical DRC checks: connectivity and short circuit detection.

Uses union-find (disjoint set) data structure for efficient connectivity
analysis across traces, vias, and pads.
"""

from __future__ import annotations

from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
    Net,
    Pad,
    Trace,
    Via,
)
from routeai_solver.drc.engine import DRCSeverity, DRCViolation

# ---------------------------------------------------------------------------
# Union-Find data structure
# ---------------------------------------------------------------------------

class UnionFind:
    """Disjoint set / union-find with path compression and union by rank."""

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}
        self._rank: dict[str, int] = {}

    def make_set(self, x: str) -> None:
        if x not in self._parent:
            self._parent[x] = x
            self._rank[x] = 0

    def find(self, x: str) -> str:
        if self._parent[x] != x:
            self._parent[x] = self.find(self._parent[x])  # path compression
        return self._parent[x]

    def union(self, x: str, y: str) -> None:
        rx, ry = self.find(x), self.find(y)
        if rx == ry:
            return
        # Union by rank
        if self._rank[rx] < self._rank[ry]:
            rx, ry = ry, rx
        self._parent[ry] = rx
        if self._rank[rx] == self._rank[ry]:
            self._rank[rx] += 1

    def connected(self, x: str, y: str) -> bool:
        return self.find(x) == self.find(y)

    def groups(self) -> dict[str, list[str]]:
        """Return groups of connected elements."""
        result: dict[str, list[str]] = {}
        for x in self._parent:
            root = self.find(x)
            result.setdefault(root, []).append(x)
        return result


# ---------------------------------------------------------------------------
# Node key generation helpers
# ---------------------------------------------------------------------------

_COORD_PRECISION = 4  # decimal places for coordinate rounding


def _point_key(x: float, y: float, layer_name: str) -> str:
    """Create a unique key for a point on a specific layer."""
    return f"{round(x, _COORD_PRECISION)},{round(y, _COORD_PRECISION)},{layer_name}"


def _pad_key(pad: Pad) -> str:
    """Create a unique key for a pad."""
    ref = pad.component_ref or "?"
    return f"pad:{ref}.{pad.pad_number}:{round(pad.x, _COORD_PRECISION)},{round(pad.y, _COORD_PRECISION)}"


def _via_key(via: Via) -> str:
    """Create a unique key for a via."""
    return f"via:{round(via.x, _COORD_PRECISION)},{round(via.y, _COORD_PRECISION)}"


# ---------------------------------------------------------------------------
# Build connectivity graph
# ---------------------------------------------------------------------------

def _build_net_connectivity(
    board: BoardDesign, net: Net
) -> tuple[UnionFind, list[str]]:
    """Build a connectivity graph for a single net using union-find.

    Connects pads, trace endpoints, and vias based on spatial coincidence.

    Returns:
        (union_find, pad_keys): the union-find structure and list of pad node keys.
    """
    uf = UnionFind()
    pad_keys: list[str] = []
    tolerance = 0.01  # mm -- points within this distance are considered connected

    # Collect all pads in this net
    pads = board.pads_in_net(net)
    traces = board.traces_in_net(net)
    vias = board.vias_in_net(net)

    # Register all pad nodes
    for pad in pads:
        key = _pad_key(pad)
        uf.make_set(key)
        pad_keys.append(key)

    # Register all via nodes
    for via in vias:
        key = _via_key(via)
        uf.make_set(key)

    # Register trace endpoint nodes and connect trace segments
    for trace in traces:
        layer_name = trace.layer.name
        prev_key: Optional[str] = None
        for seg in trace.segments:
            start_key = _point_key(seg.start_x, seg.start_y, layer_name)
            end_key = _point_key(seg.end_x, seg.end_y, layer_name)
            uf.make_set(start_key)
            uf.make_set(end_key)
            # Connect start and end of each segment
            uf.union(start_key, end_key)
            # Connect consecutive segments at shared endpoints
            if prev_key is not None:
                uf.union(prev_key, start_key)
            prev_key = end_key

    # Connect pads to coincident trace endpoints
    for pad in pads:
        pk = _pad_key(pad)
        for trace in traces:
            layer_name = trace.layer.name
            if pad.layer != trace.layer:
                continue
            for seg in trace.segments:
                for px, py in [(seg.start_x, seg.start_y), (seg.end_x, seg.end_y)]:
                    dx = abs(pad.x - px)
                    dy = abs(pad.y - py)
                    if dx <= tolerance and dy <= tolerance:
                        pt_key = _point_key(px, py, layer_name)
                        uf.union(pk, pt_key)

    # Connect vias to coincident trace endpoints on both layers
    for via in vias:
        vk = _via_key(via)
        for trace in traces:
            layer_name = trace.layer.name
            if trace.layer != via.start_layer and trace.layer != via.end_layer:
                continue
            for seg in trace.segments:
                for px, py in [(seg.start_x, seg.start_y), (seg.end_x, seg.end_y)]:
                    dx = abs(via.x - px)
                    dy = abs(via.y - py)
                    if dx <= tolerance and dy <= tolerance:
                        pt_key = _point_key(px, py, layer_name)
                        uf.union(vk, pt_key)

    # Connect vias to coincident pads
    for via in vias:
        vk = _via_key(via)
        for pad in pads:
            dx = abs(via.x - pad.x)
            dy = abs(via.y - pad.y)
            if dx <= tolerance and dy <= tolerance:
                uf.union(vk, _pad_key(pad))

    return uf, pad_keys


# ---------------------------------------------------------------------------
# Connectivity check
# ---------------------------------------------------------------------------

def check_connectivity(board: BoardDesign) -> list[DRCViolation]:
    """Find pads in the same net that are not connected by traces/vias.

    For each net with two or more pads, builds a connectivity graph and
    verifies that all pads are in the same connected component.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for unconnected net segments.
    """
    violations: list[DRCViolation] = []

    # Get unique nets that have at least 2 pads
    net_pad_count: dict[str, int] = {}
    for pad in board.pads:
        net_pad_count[pad.net.name] = net_pad_count.get(pad.net.name, 0) + 1

    for net in board.nets:
        if net_pad_count.get(net.name, 0) < 2:
            continue

        uf, pad_keys = _build_net_connectivity(board, net)

        if len(pad_keys) < 2:
            continue

        # Check that all pads are in the same connected component
        root = uf.find(pad_keys[0])
        disconnected_pads: list[str] = []
        for pk in pad_keys[1:]:
            if uf.find(pk) != root:
                disconnected_pads.append(pk)

        if disconnected_pads:
            # Report one violation per disconnected group
            pad_groups = uf.groups()
            # Count how many distinct groups contain pads
            pad_roots: set[str] = set()
            for pk in pad_keys:
                pad_roots.add(uf.find(pk))

            if len(pad_roots) > 1:
                # Find representative pads for location
                pads_in_net = board.pads_in_net(net)
                loc = (pads_in_net[0].x, pads_in_net[0].y) if pads_in_net else None

                violations.append(DRCViolation(
                    rule="connectivity",
                    severity=DRCSeverity.ERROR,
                    message=(
                        f"Net '{net.name}' has {len(pad_roots)} disconnected "
                        f"subnetworks ({len(pad_keys)} pads total)"
                    ),
                    location=loc,
                    affected_items=[f"Net({net.name})"],
                ))

    return violations


# ---------------------------------------------------------------------------
# Short circuit check
# ---------------------------------------------------------------------------

def check_short_circuits(board: BoardDesign) -> list[DRCViolation]:
    """Find traces or pads from different nets that overlap (short circuits).

    Checks for geometric intersection between copper objects on the same
    layer that belong to different nets.

    Args:
        board: The board design to check.

    Returns:
        List of DRC violations for short circuits.
    """
    violations: list[DRCViolation] = []

    for layer in board.copper_layers():
        # Collect all copper geometries per net on this layer
        net_geometries: dict[str, list[tuple[object, any]]] = {}

        for trace in board.traces_on_layer(layer):
            geom = trace.to_shapely()
            if not geom.is_empty:
                net_geometries.setdefault(trace.net.name, []).append(
                    (trace, geom)
                )

        for pad in board.pads_on_layer(layer):
            geom = pad.to_shapely()
            if not geom.is_empty:
                net_geometries.setdefault(pad.net.name, []).append(
                    (pad, geom)
                )

        for via in board.vias:
            if layer == via.start_layer or layer == via.end_layer:
                geom = via.to_shapely()
                if not geom.is_empty:
                    net_geometries.setdefault(via.net.name, []).append(
                        (via, geom)
                    )

        # Check pairs of different nets for overlap
        net_names = list(net_geometries.keys())
        for i in range(len(net_names)):
            for j in range(i + 1, len(net_names)):
                net_a = net_names[i]
                net_b = net_names[j]

                for item_a, geom_a in net_geometries[net_a]:
                    for item_b, geom_b in net_geometries[net_b]:
                        if geom_a.intersects(geom_b):
                            intersection = geom_a.intersection(geom_b)
                            if not intersection.is_empty and intersection.area > 1e-8:
                                centroid = intersection.centroid
                                loc = (centroid.x, centroid.y)

                                label_a = _item_label_short(item_a, net_a)
                                label_b = _item_label_short(item_b, net_b)

                                violations.append(DRCViolation(
                                    rule="short_circuit",
                                    severity=DRCSeverity.ERROR,
                                    message=(
                                        f"Short circuit between nets '{net_a}' and "
                                        f"'{net_b}' on {layer.name}"
                                    ),
                                    location=loc,
                                    affected_items=[label_a, label_b],
                                ))

    return violations


def _item_label_short(item: object, net_name: str) -> str:
    """Generate a short label for a board item."""
    if isinstance(item, Trace):
        return f"Trace(net={net_name})"
    elif isinstance(item, Pad):
        ref = item.component_ref or "?"
        return f"Pad({ref}.{item.pad_number})"
    elif isinstance(item, Via):
        return f"Via(net={net_name})"
    return str(item)
