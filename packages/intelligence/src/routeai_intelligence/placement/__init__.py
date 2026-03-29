"""AI-powered PCB component placement.

Provides intelligent placement strategy generation by analyzing schematic
functional zones, critical component pairs, and thermal groups, then using
LLM-generated strategies to produce optimized board placements.

Modules:
- analyzer: Circuit zone analysis and critical pair identification
- strategy: LLM-based placement strategy generation
- executor: Placement execution with force-directed optimization
- prompts: LLM prompt templates for placement
"""

from routeai_intelligence.placement.analyzer import (
    CircuitZoneAnalyzer,
    ComponentZone,
    CriticalPair,
    ThermalGroup,
)
from routeai_intelligence.placement.executor import PlacementExecutor, PlacementResult
from routeai_intelligence.placement.strategy import (
    ComponentPlacement,
    CriticalPairPlacement,
    PlacementStrategy,
    PlacementStrategyGenerator,
    PlacementZone,
)

__all__ = [
    "CircuitZoneAnalyzer",
    "ComponentZone",
    "CriticalPair",
    "ThermalGroup",
    "PlacementStrategyGenerator",
    "PlacementStrategy",
    "PlacementZone",
    "ComponentPlacement",
    "CriticalPairPlacement",
    "PlacementExecutor",
    "PlacementResult",
]
