"""RouteAI Intelligence - LLM-powered PCB design analysis and constraint generation.

Provides:
- RouteAIAgent: Main LLM agent with ReAct loop for design analysis, constraint
  generation, and interactive chat
- Validation pipeline: Schema validation, confidence scoring, citation checking
  (the 3-gate pipeline)
- RAG pipeline: Document indexing, embedding, and retrieval for IPC standards,
  datasheets, and reference designs
- Library: Universal component search across SnapEDA, LCSC, KiCad, Eagle,
  EasyEDA with LLM-powered recommendations
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from routeai_intelligence.validation.citation_checker import CitationChecker
from routeai_intelligence.validation.confidence import ConfidenceChecker
from routeai_intelligence.validation.schema_validator import SchemaValidator

if TYPE_CHECKING:
    from routeai_intelligence.agent.core import RouteAIAgent
    from routeai_intelligence.library.unified_search import UnifiedComponentSearch
    from routeai_intelligence.library.recommender import ComponentRecommender

__all__ = [
    "RouteAIAgent",
    "SchemaValidator",
    "ConfidenceChecker",
    "CitationChecker",
    "UnifiedComponentSearch",
    "ComponentRecommender",
]

__version__ = "0.1.0"


def __getattr__(name: str):
    """Lazy import for RouteAIAgent and library classes to avoid heavy deps at import time."""
    if name == "RouteAIAgent":
        from routeai_intelligence.agent.core import RouteAIAgent
        return RouteAIAgent
    if name == "UnifiedComponentSearch":
        from routeai_intelligence.library.unified_search import UnifiedComponentSearch
        return UnifiedComponentSearch
    if name == "ComponentRecommender":
        from routeai_intelligence.library.recommender import ComponentRecommender
        return ComponentRecommender
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
