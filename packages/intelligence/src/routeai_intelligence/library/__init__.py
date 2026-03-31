"""Universal Component Library - search across SnapEDA, LCSC, KiCad, Eagle, EasyEDA, and local DB.

Provides unified component search with deduplication, ranking, LLM-powered
recommendations, and automatic symbol/footprint download and caching.
"""

from __future__ import annotations

from routeai_intelligence.library.eagle_lib_provider import EagleLibProvider
from routeai_intelligence.library.easyeda_provider import EasyEDAProvider
from routeai_intelligence.library.kicad_lib_provider import KiCadLibProvider
from routeai_intelligence.library.lcsc_provider import LCSCProvider
from routeai_intelligence.library.models import (
    ComponentDetail,
    ComponentResult,
    LocalComponent,
    PinInfo,
    Recommendation,
)
from routeai_intelligence.library.pcbparts_client import PCBPartsClient, get_pcbparts_client
from routeai_intelligence.library.recommender import ComponentRecommender
from routeai_intelligence.library.snapeda_provider import SnapEDAProvider
from routeai_intelligence.library.unified_search import UnifiedComponentSearch

__all__ = [
    "ComponentDetail",
    "ComponentRecommender",
    "ComponentResult",
    "EagleLibProvider",
    "EasyEDAProvider",
    "KiCadLibProvider",
    "LCSCProvider",
    "LocalComponent",
    "PCBPartsClient",
    "PinInfo",
    "Recommendation",
    "SnapEDAProvider",
    "UnifiedComponentSearch",
    "get_pcbparts_client",
]
