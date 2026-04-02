"""Agent module - LLM-powered design intelligence with ReAct loop and tool calling."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from routeai_intelligence.agent.conflict_resolver import ConflictResolver
    from routeai_intelligence.agent.core import RouteAIAgent
    from routeai_intelligence.agent.decomposer import TaskDecomposer
    from routeai_intelligence.agent.fabrication_advisor import FabricationAdvisor
    from routeai_intelligence.agent.power_budget import PowerBudgetAnalyzer
    from routeai_intelligence.agent.react_state import ReActState
    from routeai_intelligence.agent.routing_critic import RoutingCritic
    from routeai_intelligence.agent.semantic_erc import SemanticERCAnalyzer
    from routeai_intelligence.agent.style_learner import StyleLearner
    from routeai_intelligence.agent.thermal_advisor import ThermalAdvisor

__all__ = [
    "ConflictResolver",
    "FabricationAdvisor",
    "PowerBudgetAnalyzer",
    "ReActState",
    "RouteAIAgent",
    "RoutingCritic",
    "SemanticERCAnalyzer",
    "StyleLearner",
    "TaskDecomposer",
    "ThermalAdvisor",
]


def __getattr__(name: str):
    """Lazy import for agent classes to defer heavy dependencies."""
    if name == "RouteAIAgent":
        from routeai_intelligence.agent.core import RouteAIAgent
        return RouteAIAgent
    if name == "RoutingCritic":
        from routeai_intelligence.agent.routing_critic import RoutingCritic
        return RoutingCritic
    if name == "ConflictResolver":
        from routeai_intelligence.agent.conflict_resolver import ConflictResolver
        return ConflictResolver
    if name == "TaskDecomposer":
        from routeai_intelligence.agent.decomposer import TaskDecomposer
        return TaskDecomposer
    if name == "StyleLearner":
        from routeai_intelligence.agent.style_learner import StyleLearner
        return StyleLearner
    if name == "PowerBudgetAnalyzer":
        from routeai_intelligence.agent.power_budget import PowerBudgetAnalyzer
        return PowerBudgetAnalyzer
    if name == "SemanticERCAnalyzer":
        from routeai_intelligence.agent.semantic_erc import SemanticERCAnalyzer
        return SemanticERCAnalyzer
    if name == "ThermalAdvisor":
        from routeai_intelligence.agent.thermal_advisor import ThermalAdvisor
        return ThermalAdvisor
    if name == "FabricationAdvisor":
        from routeai_intelligence.agent.fabrication_advisor import FabricationAdvisor
        return FabricationAdvisor
    if name == "ReActState":
        from routeai_intelligence.agent.react_state import ReActState
        return ReActState
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
