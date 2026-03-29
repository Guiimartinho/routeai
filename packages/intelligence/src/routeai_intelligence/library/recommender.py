"""LLM-powered component recommendation engine.

Uses an optional LLM agent (Ollama/Claude) to recommend components based on
design requirements, and suggest alternatives for given parts with trade-off
analysis.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from routeai_intelligence.library.models import ComponentResult, Recommendation
from routeai_intelligence.library.unified_search import UnifiedComponentSearch

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Built-in knowledge base for common recommendations (LLM-free fallback)
# ---------------------------------------------------------------------------

_RECOMMENDATION_DB: dict[str, list[dict[str, Any]]] = {
    "3.3v_ldo": [
        {
            "mpn": "AP2112K-3.3TRG1",
            "manufacturer": "Diodes Inc",
            "description": "3.3V 600mA LDO, low dropout (250mV), low Iq (55uA)",
            "category": "voltage_regulator",
            "package": "SOT-23-5",
            "reasoning": "Best choice for battery-powered 3.3V rail: very low dropout, low quiescent current, compact package",
            "trade_offs": ["Limited to 600mA", "Needs 1uF minimum output cap"],
            "confidence": 0.9,
        },
        {
            "mpn": "AMS1117-3.3",
            "manufacturer": "Advanced Monolithic Systems",
            "description": "3.3V 1A LDO regulator",
            "category": "voltage_regulator",
            "package": "SOT-223",
            "reasoning": "Cheapest option with 1A output, widely available, good for cost-sensitive designs",
            "trade_offs": ["High dropout (1.1V)", "High quiescent current (5mA)", "Needs >4.4V input"],
            "confidence": 0.85,
        },
        {
            "mpn": "XC6206P332MR",
            "manufacturer": "Torex",
            "description": "3.3V 200mA LDO, ultra-low quiescent current",
            "category": "voltage_regulator",
            "package": "SOT-23",
            "reasoning": "Ultra-low Iq (1uA) ideal for always-on battery applications, very compact",
            "trade_offs": ["Only 200mA output", "Moderate dropout (250mV)"],
            "confidence": 0.8,
        },
    ],
    "usb_esd": [
        {
            "mpn": "USBLC6-2SC6",
            "manufacturer": "STMicroelectronics",
            "description": "USB ESD protection, SOT-23-6, 1pF capacitance",
            "category": "protection",
            "package": "SOT-23-6",
            "reasoning": "Industry standard USB ESD protection with very low capacitance (1pF) for signal integrity",
            "trade_offs": ["Two-channel only", "Need separate IC for 4-channel protection"],
            "confidence": 0.95,
        },
    ],
    "buck_converter": [
        {
            "mpn": "TPS54331",
            "manufacturer": "Texas Instruments",
            "description": "3A 28V input step-down converter",
            "category": "voltage_regulator",
            "package": "SOIC-8",
            "reasoning": "Well-documented, wide input range, internal compensation, reliable for most applications",
            "trade_offs": ["External diode needed (non-synchronous)", "Larger solution size than integrated modules"],
            "confidence": 0.85,
        },
        {
            "mpn": "MP2315",
            "manufacturer": "Monolithic Power Systems",
            "description": "1.5A 24V synchronous buck, SOT-23-8",
            "category": "voltage_regulator",
            "package": "SOT-23-8",
            "reasoning": "Very compact synchronous design with 96% efficiency, no external diode needed",
            "trade_offs": ["Limited to 1.5A", "Smaller input voltage range than TPS54331"],
            "confidence": 0.85,
        },
    ],
}

# Keyword patterns to match requirements to recommendation categories
_KEYWORD_PATTERNS: list[tuple[list[str], str]] = [
    (["3.3v", "3v3", "ldo", "linear regulator", "low dropout"], "3.3v_ldo"),
    (["usb", "esd", "protection", "tvs"], "usb_esd"),
    (["buck", "step-down", "switching", "dc-dc"], "buck_converter"),
]


class ComponentRecommender:
    """Uses LLM to recommend components based on design requirements.

    Falls back to a built-in knowledge base when no LLM agent is available.

    Usage::

        recommender = ComponentRecommender(search=unified_search)
        recs = await recommender.recommend("3.3V LDO, 500mA, low noise")
        alts = await recommender.suggest_alternatives(component, reason="cost")
    """

    def __init__(
        self,
        search: UnifiedComponentSearch | None = None,
        agent: Any | None = None,
    ) -> None:
        """Initialize the recommender.

        Args:
            search: Optional UnifiedComponentSearch for enriching recommendations
                with live availability data.
            agent: Optional RouteAIAgent for LLM-powered analysis.
        """
        self._search = search
        self._agent = agent

    async def recommend(
        self,
        requirement: str,
        constraints: dict[str, Any] | None = None,
    ) -> list[Recommendation]:
        """Recommend components based on design requirements.

        Analyses the requirement string and suggests specific parts with
        trade-off analysis. Uses LLM if available, otherwise falls back to
        the built-in knowledge base.

        Args:
            requirement: Natural language requirement description.
                Example: ``"3.3V LDO, 500mA, low noise, battery powered"``
            constraints: Optional constraints dict with keys like ``budget``,
                ``package_size``, ``availability``, ``temperature_range``.

        Returns:
            List of Recommendation objects ordered by confidence.
        """
        # Try LLM-powered recommendation first
        if self._agent is not None:
            llm_recs = await self._llm_recommend(requirement, constraints)
            if llm_recs:
                return llm_recs

        # Fallback to built-in knowledge base
        return await self._builtin_recommend(requirement, constraints)

    async def suggest_alternatives(
        self,
        component: ComponentResult,
        reason: str = "cost",
    ) -> list[Recommendation]:
        """Suggest alternative components for a given part.

        Args:
            component: The original component to find alternatives for.
            reason: Why alternatives are needed. One of: ``"cost"``,
                ``"availability"``, ``"performance"``, ``"package"``.

        Returns:
            List of Recommendation with alternatives and reasoning.
        """
        # Try LLM first
        if self._agent is not None:
            llm_alts = await self._llm_suggest_alternatives(component, reason)
            if llm_alts:
                return llm_alts

        # Fallback: search for similar parts
        if self._search is not None:
            query = f"{component.category} {component.package}"
            if reason == "cost":
                query += " cheap"
            elif reason == "availability":
                query += " in stock"

            search_results = await self._search.search(query, limit=10)
            # Filter out the original component
            alternatives = [
                r for r in search_results
                if r.mpn.lower() != component.mpn.lower()
            ]

            return [
                Recommendation(
                    component=alt,
                    reasoning=f"Alternative to {component.mpn} for {reason}: "
                    f"{alt.description}",
                    trade_offs=[
                        f"Different source: {alt.source}",
                        f"Package: {alt.package}" if alt.package != component.package else "",
                    ],
                    confidence=0.5,
                    source="parametric_search",
                )
                for alt in alternatives[:5]
            ]

        return []

    # ------------------------------------------------------------------
    # Built-in recommendation engine
    # ------------------------------------------------------------------

    async def _builtin_recommend(
        self,
        requirement: str,
        constraints: dict[str, Any] | None = None,
    ) -> list[Recommendation]:
        """Use the built-in knowledge base to generate recommendations."""
        req_lower = requirement.lower()

        # Find matching recommendation category
        matched_category: str | None = None
        for keywords, category in _KEYWORD_PATTERNS:
            if any(kw in req_lower for kw in keywords):
                matched_category = category
                break

        if matched_category is None:
            # No direct match, try search if available
            if self._search is not None:
                search_results = await self._search.search(requirement, limit=5)
                return [
                    Recommendation(
                        component=r,
                        reasoning=f"Found via search for: {requirement}",
                        trade_offs=[],
                        confidence=0.4,
                        source="search",
                    )
                    for r in search_results
                ]
            return []

        db_entries = _RECOMMENDATION_DB.get(matched_category, [])
        recommendations: list[Recommendation] = []

        for entry in db_entries:
            comp = ComponentResult(
                mpn=entry["mpn"],
                manufacturer=entry["manufacturer"],
                description=entry["description"],
                category=entry.get("category", ""),
                package=entry.get("package", ""),
                source="local",
                source_id=entry["mpn"],
                has_symbol=False,
                has_footprint=False,
                has_3d_model=False,
                datasheet_url=None,
                price_usd=None,
                stock=None,
            )

            # Apply constraints filtering
            if constraints:
                budget = constraints.get("budget")
                if budget is not None and comp.price_usd is not None:
                    if comp.price_usd > budget:
                        continue

                package_size = constraints.get("package_size")
                if package_size and package_size.lower() not in comp.package.lower():
                    continue

            # Enrich with live search data if available
            if self._search is not None:
                search_results = await self._search.search(
                    entry["mpn"], limit=1
                )
                if search_results:
                    live = search_results[0]
                    comp.price_usd = live.price_usd
                    comp.stock = live.stock
                    comp.datasheet_url = live.datasheet_url
                    comp.has_symbol = live.has_symbol
                    comp.has_footprint = live.has_footprint

            recommendations.append(
                Recommendation(
                    component=comp,
                    reasoning=entry["reasoning"],
                    trade_offs=entry.get("trade_offs", []),
                    confidence=entry.get("confidence", 0.7),
                    source="engineering_knowledge",
                )
            )

        recommendations.sort(key=lambda r: r.confidence, reverse=True)
        return recommendations

    # ------------------------------------------------------------------
    # LLM-powered recommendation
    # ------------------------------------------------------------------

    async def _llm_recommend(
        self,
        requirement: str,
        constraints: dict[str, Any] | None,
    ) -> list[Recommendation]:
        """Use LLM agent for intelligent component recommendation."""
        if self._agent is None:
            return []

        try:
            prompt = (
                f"Recommend electronic components for this requirement:\n"
                f"Requirement: {requirement}\n"
            )
            if constraints:
                prompt += f"Constraints: {json.dumps(constraints, default=str)}\n"

            prompt += (
                "\nFor each suggestion, provide:\n"
                "- mpn: Manufacturer part number\n"
                "- manufacturer: Component manufacturer\n"
                "- description: Brief description\n"
                "- category: Component category\n"
                "- package: Package type\n"
                "- reasoning: Why this component is recommended\n"
                "- trade_offs: List of trade-offs\n"
                "- confidence: 0-1 confidence score\n\n"
                "Return as a JSON array."
            )

            response = await self._agent.chat(prompt)
            suggestions = json.loads(response.message)
            if not isinstance(suggestions, list):
                return []

            recommendations: list[Recommendation] = []
            for s in suggestions:
                if not isinstance(s, dict):
                    continue
                comp = ComponentResult(
                    mpn=s.get("mpn", ""),
                    manufacturer=s.get("manufacturer", ""),
                    description=s.get("description", ""),
                    category=s.get("category", ""),
                    package=s.get("package", ""),
                    source="local",
                    source_id=s.get("mpn", ""),
                    has_symbol=False,
                    has_footprint=False,
                    has_3d_model=False,
                )
                recommendations.append(
                    Recommendation(
                        component=comp,
                        reasoning=s.get("reasoning", ""),
                        trade_offs=s.get("trade_offs", []),
                        confidence=float(s.get("confidence", 0.7)),
                        source="llm_analysis",
                    )
                )

            return recommendations

        except Exception:
            logger.exception("LLM recommendation failed for: %s", requirement)
            return []

    async def _llm_suggest_alternatives(
        self,
        component: ComponentResult,
        reason: str,
    ) -> list[Recommendation]:
        """Use LLM to suggest alternative components."""
        if self._agent is None:
            return []

        try:
            prompt = (
                f"Suggest alternatives to this electronic component:\n"
                f"Part: {component.mpn} ({component.manufacturer})\n"
                f"Description: {component.description}\n"
                f"Package: {component.package}\n"
                f"Reason for alternatives: {reason}\n\n"
                f"For each alternative, provide mpn, manufacturer, description, "
                f"category, package, reasoning, trade_offs, confidence.\n"
                f"Return as a JSON array."
            )

            response = await self._agent.chat(prompt)
            suggestions = json.loads(response.message)
            if not isinstance(suggestions, list):
                return []

            recommendations: list[Recommendation] = []
            for s in suggestions:
                if not isinstance(s, dict):
                    continue
                alt = ComponentResult(
                    mpn=s.get("mpn", ""),
                    manufacturer=s.get("manufacturer", ""),
                    description=s.get("description", ""),
                    category=s.get("category", component.category),
                    package=s.get("package", ""),
                    source="local",
                    source_id=s.get("mpn", ""),
                    has_symbol=False,
                    has_footprint=False,
                    has_3d_model=False,
                )
                recommendations.append(
                    Recommendation(
                        component=alt,
                        reasoning=s.get("reasoning", ""),
                        trade_offs=s.get("trade_offs", []),
                        confidence=float(s.get("confidence", 0.6)),
                        source="llm_analysis",
                    )
                )

            return recommendations

        except Exception:
            logger.exception("LLM alternatives suggestion failed")
            return []
