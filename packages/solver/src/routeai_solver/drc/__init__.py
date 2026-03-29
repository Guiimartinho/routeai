"""Design Rule Check (DRC) subsystem.

Provides geometric, electrical, and manufacturing design rule checks.
"""

from routeai_solver.drc.engine import DRCEngine, DRCReport, DRCSeverity, DRCViolation

__all__ = ["DRCEngine", "DRCReport", "DRCSeverity", "DRCViolation"]
