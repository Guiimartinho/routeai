"""Agent module - LLM-powered design intelligence with ReAct loop and tool calling."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from routeai_intelligence.agent.core import RouteAIAgent

__all__ = ["RouteAIAgent"]


def __getattr__(name: str):
    """Lazy import for RouteAIAgent to defer anthropic dependency."""
    if name == "RouteAIAgent":
        from routeai_intelligence.agent.core import RouteAIAgent
        return RouteAIAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
