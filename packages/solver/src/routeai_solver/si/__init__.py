"""Signal Integrity analysis subsystem.

Provides board-level impedance analysis, crosstalk evaluation,
return path continuity checking, and power distribution network analysis.
"""

from routeai_solver.si.impedance_engine import (
    ImpedanceEngine,
    ImpedanceReport,
    PerNetResult,
    SegmentIssue,
)
from routeai_solver.si.crosstalk_engine import (
    CrosstalkEngine,
    CrosstalkReport,
    CouplingPair,
    HeatmapPoint,
    Mitigation,
)
from routeai_solver.si.return_path import (
    ReturnPathAnalyzer,
    ReturnPathReport,
    PlaneDiscontinuity,
    ViaTransitionIssue,
    StitchingViaSuggestion,
)
from routeai_solver.si.pdn_analyzer import (
    PDNAnalyzer,
    PDNReport,
    TargetImpedance,
    DecapSuggestion,
    ImpedancePlotPoint,
)

__all__ = [
    "ImpedanceEngine",
    "ImpedanceReport",
    "PerNetResult",
    "SegmentIssue",
    "CrosstalkEngine",
    "CrosstalkReport",
    "CouplingPair",
    "HeatmapPoint",
    "Mitigation",
    "ReturnPathAnalyzer",
    "ReturnPathReport",
    "PlaneDiscontinuity",
    "ViaTransitionIssue",
    "StitchingViaSuggestion",
    "PDNAnalyzer",
    "PDNReport",
    "TargetImpedance",
    "DecapSuggestion",
    "ImpedancePlotPoint",
]
