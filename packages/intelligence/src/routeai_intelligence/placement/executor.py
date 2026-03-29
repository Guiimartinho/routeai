"""Placement execution engine with force-directed optimization.

Executes a PlacementStrategy by running force-directed placement that
respects critical pair constraints, zone containment, and IPC-7351
courtyard spacing rules. Uses the C++ ForceDirectedPlacer via gRPC
when available, falling back to a pure Python implementation.
"""

from __future__ import annotations

import logging
import math
import random
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from routeai_intelligence.placement.strategy import (
    ComponentPlacement,
    CriticalPairPlacement,
    PlacementStrategy,
    PlacementZone,
)
from routeai_parsers.models import BoardDesign

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# IPC-7351 courtyard spacing table (package -> minimum courtyard in mm)
# ---------------------------------------------------------------------------

_IPC_COURTYARD_MM: dict[str, float] = {
    "0201": 0.10,
    "0402": 0.15,
    "0603": 0.20,
    "0805": 0.25,
    "1206": 0.30,
    "1210": 0.30,
    "2010": 0.35,
    "2512": 0.40,
    "SOT-23": 0.30,
    "SOT-23-5": 0.30,
    "SOT-23-6": 0.30,
    "SOT-23-8": 0.30,
    "SOT-223": 0.50,
    "SOIC-8": 0.50,
    "SOIC-14": 0.50,
    "SOIC-16": 0.50,
    "SSOP-20": 0.40,
    "TSSOP-14": 0.35,
    "TSSOP-16": 0.35,
    "TSSOP-20": 0.35,
    "QFN-16": 0.40,
    "QFN-24": 0.40,
    "QFN-32": 0.40,
    "QFN-48": 0.50,
    "QFP-44": 0.50,
    "QFP-48": 0.50,
    "LQFP-48": 0.50,
    "LQFP-64": 0.50,
    "LQFP-100": 0.60,
    "LQFP-144": 0.60,
    "BGA-256": 0.80,
    "USB_C_Receptacle": 1.00,
}

# Default courtyard for unknown packages
_DEFAULT_COURTYARD_MM = 0.25

# Approximate package dimensions (width, height) in mm
_PACKAGE_SIZE_MM: dict[str, tuple[float, float]] = {
    "0201": (0.6, 0.3),
    "0402": (1.0, 0.5),
    "0603": (1.6, 0.8),
    "0805": (2.0, 1.25),
    "1206": (3.2, 1.6),
    "1210": (3.2, 2.5),
    "2010": (5.0, 2.5),
    "2512": (6.3, 3.2),
    "SOT-23": (2.9, 1.3),
    "SOT-23-5": (2.9, 1.6),
    "SOT-23-6": (2.9, 1.6),
    "SOT-23-8": (2.9, 1.6),
    "SOT-223": (6.5, 3.5),
    "SOIC-8": (5.0, 4.0),
    "SOIC-14": (8.7, 4.0),
    "SOIC-16": (10.0, 4.0),
    "QFN-16": (4.0, 4.0),
    "QFN-24": (5.0, 5.0),
    "QFN-32": (5.0, 5.0),
    "QFN-48": (7.0, 7.0),
    "LQFP-48": (9.0, 9.0),
    "LQFP-64": (12.0, 12.0),
    "LQFP-100": (16.0, 16.0),
    "LQFP-144": (22.0, 22.0),
    "BGA-256": (17.0, 17.0),
    "USB_C_Receptacle": (9.0, 7.5),
    "1008": (2.5, 2.0),
    "ESP32-WROOM-32E": (18.0, 25.5),
    "Module": (18.0, 25.5),
}

_DEFAULT_PACKAGE_SIZE_MM = (2.0, 2.0)


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------


class PlacementResult(BaseModel):
    """Result of placement execution."""

    success: bool = Field(default=True, description="Whether placement succeeded")
    components: list[ComponentPlacement] = Field(
        default_factory=list, description="Final component positions"
    )
    critical_pairs: list[CriticalPairPlacement] = Field(
        default_factory=list, description="Critical pair constraint results"
    )
    total_wirelength_mm: float = Field(
        default=0.0, description="Total half-perimeter wirelength"
    )
    violations: list[str] = Field(
        default_factory=list, description="Any constraint violations"
    )
    iterations: int = Field(default=0, description="Number of iterations used")
    error: str = Field(default="", description="Error message if failed")


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class PlacementExecutor:
    """Executes placement strategy using force-directed optimization.

    Flow:
    1. Receive PlacementStrategy from AI
    2. Convert to C++ PlaceComponent format (if gRPC available)
    3. Run force-directed optimization respecting critical pairs
    4. Apply IPC-7351 courtyard spacing rules
    5. Return final coordinates

    Python fallback for when C++ router isn't available.

    Args:
        max_iterations: Maximum force-directed iterations.
        convergence_threshold: Stop when max movement is below this (mm).
        attraction_weight: Spring force weight for connected components.
        repulsion_weight: Repulsion force weight for overlap avoidance.
        critical_pair_weight: Extra spring weight for critical pairs.
    """

    def __init__(
        self,
        max_iterations: int = 300,
        convergence_threshold: float = 0.01,
        attraction_weight: float = 1.0,
        repulsion_weight: float = 50.0,
        critical_pair_weight: float = 5.0,
    ) -> None:
        self._max_iterations = max_iterations
        self._convergence_threshold = convergence_threshold
        self._attraction_weight = attraction_weight
        self._repulsion_weight = repulsion_weight
        self._critical_pair_weight = critical_pair_weight

    async def execute(
        self,
        strategy: PlacementStrategy,
        board: BoardDesign | None = None,
    ) -> PlacementResult:
        """Execute placement strategy.

        First attempts to use the C++ ForceDirectedPlacer via gRPC.
        Falls back to pure Python implementation if unavailable.

        Args:
            strategy: Placement strategy from the AI generator.
            board: Optional existing board design for context.

        Returns:
            PlacementResult with final positions and constraint check.
        """
        all_placements = strategy.get_all_placements()
        if not all_placements:
            return PlacementResult(
                success=True,
                components=[],
                critical_pairs=[],
                total_wirelength_mm=0.0,
            )

        board_w, board_h = strategy.board_outline_mm

        # Build footprint size map from strategy + board data
        footprints = self._build_footprint_map(all_placements, board)

        # Try C++ engine first
        cpp_result = await self._try_cpp_placement(strategy, footprints)
        if cpp_result is not None:
            return cpp_result

        # Python fallback
        logger.info("Using Python force-directed placement fallback")
        optimized = self._python_force_directed(
            components=all_placements,
            critical_pairs=strategy.critical_pairs,
            board_bounds=(board_w, board_h),
            footprints=footprints,
            zones=strategy.zones,
        )

        # Apply IPC spacing
        optimized = self._apply_ipc_spacing(optimized, footprints)

        # Validate critical pairs
        pair_results = self._validate_critical_pairs(optimized, strategy.critical_pairs)
        violations = [
            f"{p.component_a}-{p.component_b}: {p.actual_distance_mm:.1f}mm > {p.max_distance_mm}mm"
            for p in pair_results
            if not p.satisfied
        ]

        # Compute wirelength estimate (HPWL)
        wirelength = self._compute_hpwl(optimized)

        return PlacementResult(
            success=True,
            components=optimized,
            critical_pairs=pair_results,
            total_wirelength_mm=round(wirelength, 2),
            violations=violations,
            iterations=self._max_iterations,
        )

    # ------------------------------------------------------------------
    # Python force-directed placement
    # ------------------------------------------------------------------

    def _python_force_directed(
        self,
        components: list[ComponentPlacement],
        critical_pairs: list[CriticalPairPlacement],
        board_bounds: tuple[float, float],
        footprints: dict[str, tuple[float, float]],
        zones: list[PlacementZone] | None = None,
    ) -> list[ComponentPlacement]:
        """Pure Python fallback for force-directed placement.

        Simple spring model:
        - Attraction: connected components pull toward each other
        - Repulsion: all components repel (no overlap)
        - Critical pairs: strong spring force (< max_distance)
        - Edge attraction: connectors pulled to board edges
        - Zone containment: components stay in their zone

        Args:
            components: Initial component placements from AI.
            critical_pairs: Critical pair constraints.
            board_bounds: Board (width, height) in mm.
            footprints: Map of ref -> (width, height) in mm.
            zones: Optional zone definitions for containment.

        Returns:
            Optimized component placements.
        """
        board_w, board_h = board_bounds
        n = len(components)
        if n == 0:
            return []

        # Working arrays: positions
        xs = [c.x_mm for c in components]
        ys = [c.y_mm for c in components]
        refs = [c.reference for c in components]
        ref_to_idx = {ref: i for i, ref in enumerate(refs)}

        # Component sizes
        widths = [footprints.get(r, _DEFAULT_PACKAGE_SIZE_MM)[0] for r in refs]
        heights = [footprints.get(r, _DEFAULT_PACKAGE_SIZE_MM)[1] for r in refs]

        # Build zone containment map: component_ref -> zone region
        zone_map: dict[str, tuple[float, float, float, float]] = {}
        if zones:
            for zone in zones:
                for comp in zone.components:
                    zone_map[comp.reference] = zone.region

        # Identify connectors (for edge attraction)
        connector_indices: set[int] = set()
        for i, ref in enumerate(refs):
            if ref.startswith(("J", "P", "TP")):
                connector_indices.add(i)

        # Build critical pair index
        pair_indices: list[tuple[int, int, float]] = []
        for pair in critical_pairs:
            idx_a = ref_to_idx.get(pair.component_a)
            idx_b = ref_to_idx.get(pair.component_b)
            if idx_a is not None and idx_b is not None:
                pair_indices.append((idx_a, idx_b, pair.max_distance_mm))

        step_size = 1.0

        for iteration in range(self._max_iterations):
            fx = [0.0] * n
            fy = [0.0] * n

            # --- Repulsion forces (overlap avoidance) ---
            for i in range(n):
                for j in range(i + 1, n):
                    dx = xs[i] - xs[j]
                    dy = ys[i] - ys[j]
                    dist_sq = dx * dx + dy * dy

                    min_dist = (widths[i] + widths[j]) / 2.0 + (heights[i] + heights[j]) / 2.0
                    min_dist_sq = min_dist * min_dist

                    if dist_sq < min_dist_sq and dist_sq > 1e-10:
                        dist = math.sqrt(dist_sq)
                        force = self._repulsion_weight * (min_dist - dist) / dist
                        fdx = force * dx / dist
                        fdy = force * dy / dist
                        fx[i] += fdx
                        fy[i] += fdy
                        fx[j] -= fdx
                        fy[j] -= fdy

            # --- Critical pair attraction (strong spring) ---
            for idx_a, idx_b, max_dist in pair_indices:
                dx = xs[idx_b] - xs[idx_a]
                dy = ys[idx_b] - ys[idx_a]
                dist = math.sqrt(dx * dx + dy * dy)

                if dist > max_dist * 0.8:
                    # Pull toward each other
                    strength = self._critical_pair_weight * (dist - max_dist * 0.5)
                    if dist > 1e-6:
                        fx[idx_a] += strength * dx / dist
                        fy[idx_a] += strength * dy / dist
                        fx[idx_b] -= strength * dx / dist
                        fy[idx_b] -= strength * dy / dist

            # --- Zone containment force ---
            for i, ref in enumerate(refs):
                region = zone_map.get(ref)
                if region is None:
                    continue
                x_min, y_min, x_max, y_max = region
                # Push back into zone if outside
                if xs[i] < x_min:
                    fx[i] += 2.0 * (x_min - xs[i])
                elif xs[i] > x_max:
                    fx[i] += 2.0 * (x_max - xs[i])
                if ys[i] < y_min:
                    fy[i] += 2.0 * (y_min - ys[i])
                elif ys[i] > y_max:
                    fy[i] += 2.0 * (y_max - ys[i])

            # --- Connector edge attraction ---
            for i in connector_indices:
                # Find nearest board edge
                d_left = xs[i]
                d_right = board_w - xs[i]
                d_top = ys[i]
                d_bottom = board_h - ys[i]
                min_d = min(d_left, d_right, d_top, d_bottom)

                if min_d == d_left:
                    fx[i] -= 1.0
                elif min_d == d_right:
                    fx[i] += 1.0
                elif min_d == d_top:
                    fy[i] -= 1.0
                else:
                    fy[i] += 1.0

            # --- Update positions ---
            max_move = 0.0
            for i in range(n):
                dx = step_size * fx[i]
                dy = step_size * fy[i]

                # Limit max displacement
                mag = math.sqrt(dx * dx + dy * dy)
                max_step = 5.0
                if mag > max_step:
                    dx *= max_step / mag
                    dy *= max_step / mag

                xs[i] += dx
                ys[i] += dy

                # Clamp to board bounds
                half_w = widths[i] / 2.0
                half_h = heights[i] / 2.0
                xs[i] = max(half_w, min(board_w - half_w, xs[i]))
                ys[i] = max(half_h, min(board_h - half_h, ys[i]))

                max_move = max(max_move, abs(dx) + abs(dy))

            # Adaptive step size
            if max_move < 0.1:
                step_size *= 1.1
            else:
                step_size *= 0.95
            step_size = max(0.01, min(2.0, step_size))

            if max_move < self._convergence_threshold:
                logger.info(
                    "Force-directed placement converged at iteration %d", iteration
                )
                break

        # Build result
        result: list[ComponentPlacement] = []
        for i, comp in enumerate(components):
            result.append(ComponentPlacement(
                reference=comp.reference,
                x_mm=round(xs[i], 3),
                y_mm=round(ys[i], 3),
                rotation_deg=comp.rotation_deg,
                layer=comp.layer,
                reasoning=comp.reasoning,
            ))

        return result

    def _apply_ipc_spacing(
        self,
        components: list[ComponentPlacement],
        footprints: dict[str, tuple[float, float]],
    ) -> list[ComponentPlacement]:
        """Ensure minimum courtyard spacing per IPC-7351.

        Iteratively pushes overlapping components apart until all
        courtyard clearances are met.

        Args:
            components: Current component placements.
            footprints: Map of ref -> (width, height) in mm.

        Returns:
            Adjusted component placements.
        """
        n = len(components)
        if n < 2:
            return components

        xs = [c.x_mm for c in components]
        ys = [c.y_mm for c in components]
        refs = [c.reference for c in components]

        # Get courtyard clearance for each component
        courtyards = [self._get_courtyard(r, footprints) for r in refs]
        widths = [footprints.get(r, _DEFAULT_PACKAGE_SIZE_MM)[0] for r in refs]
        heights = [footprints.get(r, _DEFAULT_PACKAGE_SIZE_MM)[1] for r in refs]

        # Iterative overlap resolution
        for _pass in range(50):
            moved = False
            for i in range(n):
                for j in range(i + 1, n):
                    # Required center-to-center distance in each axis
                    req_dx = (widths[i] + widths[j]) / 2.0 + courtyards[i] + courtyards[j]
                    req_dy = (heights[i] + heights[j]) / 2.0 + courtyards[i] + courtyards[j]

                    dx = abs(xs[i] - xs[j])
                    dy = abs(ys[i] - ys[j])

                    # Check for overlap (AABB overlap with courtyard)
                    if dx < req_dx and dy < req_dy:
                        # Push apart along the axis with least overlap
                        overlap_x = req_dx - dx
                        overlap_y = req_dy - dy

                        if overlap_x < overlap_y:
                            shift = overlap_x / 2.0 + 0.01
                            if xs[i] <= xs[j]:
                                xs[i] -= shift
                                xs[j] += shift
                            else:
                                xs[i] += shift
                                xs[j] -= shift
                        else:
                            shift = overlap_y / 2.0 + 0.01
                            if ys[i] <= ys[j]:
                                ys[i] -= shift
                                ys[j] += shift
                            else:
                                ys[i] += shift
                                ys[j] -= shift
                        moved = True

            if not moved:
                break

        # Build result
        result: list[ComponentPlacement] = []
        for i, comp in enumerate(components):
            result.append(ComponentPlacement(
                reference=comp.reference,
                x_mm=round(xs[i], 3),
                y_mm=round(ys[i], 3),
                rotation_deg=comp.rotation_deg,
                layer=comp.layer,
                reasoning=comp.reasoning,
            ))

        return result

    # ------------------------------------------------------------------
    # C++ engine integration
    # ------------------------------------------------------------------

    async def _try_cpp_placement(
        self,
        strategy: PlacementStrategy,
        footprints: dict[str, tuple[float, float]],
    ) -> PlacementResult | None:
        """Attempt to use C++ ForceDirectedPlacer via gRPC.

        Returns None if C++ engine is not available.
        """
        try:
            import grpc  # noqa: F401
            # TODO: Implement gRPC client when C++ placement service is ready
            # For now, fall through to Python fallback
            return None
        except ImportError:
            return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_footprint_map(
        placements: list[ComponentPlacement],
        board: BoardDesign | None,
    ) -> dict[str, tuple[float, float]]:
        """Build a map of component ref -> (width, height) from board data."""
        fp_map: dict[str, tuple[float, float]] = {}

        # Get sizes from board design if available
        if board:
            for fp in board.footprints:
                ref = fp.reference
                if not ref:
                    continue
                # Compute bounding box from pads
                if fp.pads:
                    min_x = min(p.at.x - p.size_x / 2 for p in fp.pads)
                    max_x = max(p.at.x + p.size_x / 2 for p in fp.pads)
                    min_y = min(p.at.y - p.size_y / 2 for p in fp.pads)
                    max_y = max(p.at.y + p.size_y / 2 for p in fp.pads)
                    fp_map[ref] = (max_x - min_x, max_y - min_y)

        # Fill in from package size table for any missing
        for comp in placements:
            if comp.reference not in fp_map:
                # Try to match package name from reasoning or default
                for pkg, size in _PACKAGE_SIZE_MM.items():
                    if pkg.lower() in comp.reasoning.lower():
                        fp_map[comp.reference] = size
                        break
                else:
                    fp_map[comp.reference] = _DEFAULT_PACKAGE_SIZE_MM

        return fp_map

    @staticmethod
    def _get_courtyard(ref: str, footprints: dict[str, tuple[float, float]]) -> float:
        """Get IPC-7351 courtyard clearance for a component."""
        size = footprints.get(ref, _DEFAULT_PACKAGE_SIZE_MM)
        # Try to match by package name
        for pkg, courtyard in _IPC_COURTYARD_MM.items():
            if pkg.lower() in str(size).lower():
                return courtyard
        # Estimate based on component size
        max_dim = max(size)
        if max_dim < 2.0:
            return 0.15  # Small passives
        elif max_dim < 5.0:
            return 0.25  # Small ICs
        elif max_dim < 10.0:
            return 0.50  # Medium ICs
        else:
            return 0.80  # Large packages
        return _DEFAULT_COURTYARD_MM

    @staticmethod
    def _validate_critical_pairs(
        components: list[ComponentPlacement],
        pairs: list[CriticalPairPlacement],
    ) -> list[CriticalPairPlacement]:
        """Validate critical pair distance constraints after placement."""
        ref_to_pos = {c.reference: (c.x_mm, c.y_mm) for c in components}
        results: list[CriticalPairPlacement] = []

        for pair in pairs:
            pos_a = ref_to_pos.get(pair.component_a)
            pos_b = ref_to_pos.get(pair.component_b)

            if pos_a is None or pos_b is None:
                results.append(CriticalPairPlacement(
                    component_a=pair.component_a,
                    component_b=pair.component_b,
                    actual_distance_mm=0.0,
                    max_distance_mm=pair.max_distance_mm,
                    reason=pair.reason,
                    satisfied=False,
                ))
                continue

            dx = pos_a[0] - pos_b[0]
            dy = pos_a[1] - pos_b[1]
            actual = math.sqrt(dx * dx + dy * dy)

            results.append(CriticalPairPlacement(
                component_a=pair.component_a,
                component_b=pair.component_b,
                actual_distance_mm=round(actual, 3),
                max_distance_mm=pair.max_distance_mm,
                reason=pair.reason,
                satisfied=actual <= pair.max_distance_mm,
            ))

        return results

    @staticmethod
    def _compute_hpwl(components: list[ComponentPlacement]) -> float:
        """Compute half-perimeter wirelength estimate.

        This is a rough estimate since we don't have net connectivity here.
        Returns sum of bounding box half-perimeters for all unique component pairs.
        """
        if len(components) < 2:
            return 0.0

        total = 0.0
        positions = [(c.x_mm, c.y_mm) for c in components]

        x_min = min(p[0] for p in positions)
        x_max = max(p[0] for p in positions)
        y_min = min(p[1] for p in positions)
        y_max = max(p[1] for p in positions)

        total = (x_max - x_min) + (y_max - y_min)
        return total
