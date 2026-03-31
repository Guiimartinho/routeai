"""Signal Integrity analysis subsystem.

Provides board-level impedance analysis, crosstalk evaluation,
return path continuity checking, and power distribution network analysis.
"""

from routeai_solver.si.crosstalk_engine import (
    CouplingPair,
    CrosstalkEngine,
    CrosstalkReport,
    HeatmapPoint,
    Mitigation,
)
from routeai_solver.si.impedance_engine import (
    ImpedanceEngine,
    ImpedanceReport,
    PerNetResult,
    SegmentIssue,
)
from routeai_solver.si.pdn_analyzer import (
    DecapSuggestion,
    ImpedancePlotPoint,
    PDNAnalyzer,
    PDNReport,
    TargetImpedance,
)
from routeai_solver.si.return_path import (
    PlaneDiscontinuity,
    ReturnPathAnalyzer,
    ReturnPathReport,
    StitchingViaSuggestion,
    ViaTransitionIssue,
)

__all__ = [
    "CouplingPair",
    "CrosstalkEngine",
    "CrosstalkReport",
    "DecapSuggestion",
    "HeatmapPoint",
    "ImpedanceEngine",
    "ImpedancePlotPoint",
    "ImpedanceReport",
    "Mitigation",
    "PDNAnalyzer",
    "PDNReport",
    "PerNetResult",
    "PlaneDiscontinuity",
    "ReturnPathAnalyzer",
    "ReturnPathReport",
    "SegmentIssue",
    "StitchingViaSuggestion",
    "TargetImpedance",
    "ViaTransitionIssue",
]
