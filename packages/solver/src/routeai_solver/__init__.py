"""RouteAI Solver - DRC engine, physics calculations, and constraint solving.

Provides:
- DRC engine for geometric, electrical, and manufacturing design rule checks
- Physics calculators for impedance, crosstalk, and thermal analysis
- Z3-based constraint solver for length matching and timing verification
- Board data model used across all solver subsystems
"""

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    DesignRules,
    DiffPair,
    DrillHole,
    Layer,
    LayerType,
    LengthGroup,
    Net,
    Pad,
    PadShape,
    StackupLayer,
    Trace,
    TraceSegment,
    Via,
)
from routeai_solver.drc.engine import DRCEngine, DRCReport, DRCSeverity, DRCViolation

__all__ = [
    "BoardDesign",
    "CopperZone",
    "DesignRules",
    "DiffPair",
    "DrillHole",
    "DRCEngine",
    "DRCReport",
    "DRCSeverity",
    "DRCViolation",
    "Layer",
    "LayerType",
    "LengthGroup",
    "Net",
    "Pad",
    "PadShape",
    "StackupLayer",
    "Trace",
    "TraceSegment",
    "Via",
]
