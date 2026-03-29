"""Main DRC engine that orchestrates all design rule checkers.

Runs geometric, electrical, and manufacturing checks and produces
a consolidated DRCReport.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from routeai_solver.board_model import BoardDesign


class DRCSeverity(Enum):
    """Severity level of a DRC violation."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class DRCViolation:
    """A single DRC violation."""

    rule: str
    severity: DRCSeverity
    message: str
    location: Optional[tuple[float, float]] = None  # (x_mm, y_mm)
    affected_items: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        loc = f" at ({self.location[0]:.3f}, {self.location[1]:.3f})" if self.location else ""
        items = f" [{', '.join(self.affected_items)}]" if self.affected_items else ""
        return f"[{self.severity.value.upper()}] {self.rule}: {self.message}{loc}{items}"


@dataclass
class DRCReport:
    """Consolidated DRC report from all checkers."""

    violations: list[DRCViolation] = field(default_factory=list)
    passed: bool = True
    stats: dict[str, int] = field(default_factory=dict)
    elapsed_seconds: float = 0.0

    @property
    def error_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == DRCSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == DRCSeverity.WARNING)

    @property
    def info_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == DRCSeverity.INFO)

    def summary(self) -> str:
        status = "PASSED" if self.passed else "FAILED"
        return (
            f"DRC {status}: {self.error_count} errors, "
            f"{self.warning_count} warnings, {self.info_count} info "
            f"({self.elapsed_seconds:.3f}s)"
        )


class DRCEngine:
    """Orchestrates all DRC checks on a board design.

    Usage:
        engine = DRCEngine()
        report = engine.run(board)
    """

    def __init__(
        self,
        run_geometric: bool = True,
        run_electrical: bool = True,
        run_manufacturing: bool = True,
        fab_profile: Optional[object] = None,
    ) -> None:
        self.run_geometric = run_geometric
        self.run_electrical = run_electrical
        self.run_manufacturing = run_manufacturing
        self.fab_profile = fab_profile

    def run(self, board: BoardDesign) -> DRCReport:
        """Run all enabled DRC checks on the board.

        Args:
            board: The board design to check.

        Returns:
            A DRCReport with all violations found.
        """
        start = time.monotonic()
        all_violations: list[DRCViolation] = []
        stats: dict[str, int] = {}

        if self.run_geometric:
            from routeai_solver.drc.geometric import (
                check_acid_traps,
                check_board_edge_clearance,
                check_clearance,
                check_min_annular_ring,
                check_min_trace_width,
                check_silk_to_pad_clearance,
            )

            clearance_v = check_clearance(board)
            stats["clearance_violations"] = len(clearance_v)
            all_violations.extend(clearance_v)

            width_v = check_min_trace_width(board)
            stats["min_width_violations"] = len(width_v)
            all_violations.extend(width_v)

            ring_v = check_min_annular_ring(board)
            stats["annular_ring_violations"] = len(ring_v)
            all_violations.extend(ring_v)

            if board.outline is not None:
                edge_v = check_board_edge_clearance(board)
                stats["edge_clearance_violations"] = len(edge_v)
                all_violations.extend(edge_v)

            silk_v = check_silk_to_pad_clearance(board)
            stats["silk_to_pad_violations"] = len(silk_v)
            all_violations.extend(silk_v)

            acid_v = check_acid_traps(board)
            stats["acid_trap_violations"] = len(acid_v)
            all_violations.extend(acid_v)

        if self.run_electrical:
            from routeai_solver.drc.electrical import (
                check_connectivity,
                check_short_circuits,
            )

            conn_v = check_connectivity(board)
            stats["connectivity_violations"] = len(conn_v)
            all_violations.extend(conn_v)

            short_v = check_short_circuits(board)
            stats["short_circuit_violations"] = len(short_v)
            all_violations.extend(short_v)

        if self.run_manufacturing:
            from routeai_solver.drc.manufacturing import (
                check_drill_to_copper,
                check_min_drill,
                check_solder_mask,
                check_solder_paste_coverage,
            )

            drill_v = check_min_drill(board)
            stats["min_drill_violations"] = len(drill_v)
            all_violations.extend(drill_v)

            d2c_v = check_drill_to_copper(board)
            stats["drill_to_copper_violations"] = len(d2c_v)
            all_violations.extend(d2c_v)

            mask_v = check_solder_mask(board)
            stats["solder_mask_violations"] = len(mask_v)
            all_violations.extend(mask_v)

            paste_v = check_solder_paste_coverage(board)
            stats["solder_paste_violations"] = len(paste_v)
            all_violations.extend(paste_v)

        elapsed = time.monotonic() - start
        has_errors = any(v.severity == DRCSeverity.ERROR for v in all_violations)

        return DRCReport(
            violations=all_violations,
            passed=not has_errors,
            stats=stats,
            elapsed_seconds=elapsed,
        )
