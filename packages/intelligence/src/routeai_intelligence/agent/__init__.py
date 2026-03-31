"""Agent module - LLM-powered design intelligence with ReAct loop and tool calling."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from routeai_intelligence.agent.conflict_resolver import ConflictResolver
    from routeai_intelligence.agent.core import RouteAIAgent
    from routeai_intelligence.agent.routing_critic import RoutingCritic

__all__ = ["ConflictResolver", "RouteAIAgent", "RoutingCritic"]


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
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
