"""Thermal Advisor -- thermal management recommendations for PCB designs.

Identifies heat-generating components, checks copper pour coverage, recommends
thermal via arrays, evaluates component spacing for thermal interaction, and
advises on heatsink and airflow considerations.

Uses the LLMRouter for VRAM-aware model selection with task_type="thermal_analyzer".
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from routeai_intelligence.llm.router import LLMRouter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result data model
# ---------------------------------------------------------------------------


@dataclass
class ThermalAdvisorResult:
    """Result of a thermal analysis.

    Attributes:
        hot_components: Components dissipating significant power.  Each dict
            contains: ``ref``, ``value``, ``power_dissipation_w``,
            ``package``, ``thermal_resistance_jc`` (if known).
        recommendations: Actionable thermal management recommendations.
            Each dict contains: ``component`` (or ``"board"``),
            ``category``, ``message``, ``priority`` (high/medium/low).
        thermal_budget: Board-level thermal summary with keys like
            ``total_dissipation_w``, ``max_junction_temp_c``,
            ``ambient_temp_c``, ``requires_forced_air``.
        warnings: Human-readable warning messages.
        passed: ``True`` if no component exceeds its thermal rating.
    """

    hot_components: list[dict[str, Any]] = field(default_factory=list)
    recommendations: list[dict[str, Any]] = field(default_factory=list)
    thermal_budget: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    passed: bool = True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

THERMAL_ADVISOR_PROMPT = """\
You are a thermal management advisor for PCB designs.

Analyze the board for thermal issues:

1. Identify all heat-generating components (>0.5 W dissipation).
   Estimate power dissipation from component type and operating conditions.
2. Check copper pour area under hot components -- recommend adequate thermal
   relief patterns or solid connections as appropriate.
3. Recommend thermal via arrays for components with thermal/exposed pads
   (typical: 0.3 mm drill, 1.0 mm pitch grid under the pad).
4. Check spacing between hot components (thermal interaction -- keep
   high-power parts > 5 mm apart when possible).
5. Verify heatsink attachment points if power > 2 W on a single component.
6. Check airflow considerations for component placement (tall components
   should not block airflow to hot components downstream).
7. Estimate junction temperatures using Theta-JA from datasheets.

Use the datasheet_lookup tool to find thermal resistance values and
maximum junction temperatures.

OUTPUT FORMAT -- respond with a single JSON object:
{
  "hot_components": [
    {
      "ref": "<component ref>",
      "value": "<part number / value>",
      "power_dissipation_w": <estimated watts>,
      "package": "<package type>",
      "theta_ja_c_per_w": <thermal resistance if known, else null>,
      "estimated_tj_c": <estimated junction temp at 25C ambient, else null>
    }
  ],
  "recommendations": [
    {
      "component": "<ref or 'board'>",
      "category": "<thermal_vias|copper_pour|heatsink|spacing|airflow|other>",
      "message": "<recommendation>",
      "priority": "<high|medium|low>"
    }
  ],
  "thermal_budget": {
    "total_dissipation_w": <sum>,
    "max_junction_temp_c": <hottest component Tj>,
    "ambient_temp_c": 25,
    "requires_forced_air": true/false
  },
  "warnings": ["...", ...],
  "passed": true/false
}
"""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------


class ThermalAdvisor:
    """Thermal management advisor powered by an LLM.

    Args:
        llm_router: An ``LLMRouter`` instance for provider selection.
    """

    def __init__(self, llm_router: LLMRouter) -> None:
        self._router = llm_router

    async def analyze(
        self,
        schematic_data: dict[str, Any] | str,
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> ThermalAdvisorResult:
        """Run the thermal analysis.

        Args:
            schematic_data: Serialized schematic/board dict (or pre-formatted
                string).  Should include component values, footprints, and
                ideally power consumption hints.
            tool_schemas: Optional tool schemas for LLM tool-use.

        Returns:
            A ``ThermalAdvisorResult`` with hot components, recommendations,
            and thermal budget.
        """
        context = self._format_schematic(schematic_data)
        response = await self._router.generate(
            messages=[{"role": "user", "content": context}],
            system=THERMAL_ADVISOR_PROMPT,
            tools=tool_schemas or [],
            task_type="thermal_analyzer",
        )
        return self._parse(response.text)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_schematic(data: dict[str, Any] | str) -> str:
        """Convert schematic/board data into a compact text representation."""
        if isinstance(data, str):
            return data

        components = data.get("components", [])
        board_info = data.get("board", {})

        lines: list[str] = []

        if board_info:
            dims = board_info.get("dimensions", {})
            layers = board_info.get("layer_count", "unknown")
            lines.append(
                f"BOARD: {dims.get('width_mm', '?')} x "
                f"{dims.get('height_mm', '?')} mm, {layers} layers"
            )
            lines.append("")

        lines.append("COMPONENTS:")
        for comp in components[:200]:
            ref = comp.get("reference", comp.get("ref", "?"))
            value = comp.get("value", "")
            footprint = comp.get("footprint", "")
            power = comp.get("power_dissipation_w", "")
            power_str = f", {power} W" if power else ""
            lines.append(f"  {ref}: {value} [{footprint}]{power_str}")

        return "\n".join(lines)

    @staticmethod
    def _parse(text: str) -> ThermalAdvisorResult:
        """Extract a ``ThermalAdvisorResult`` from the LLM response text."""
        try:
            cleaned = text.strip()
            if cleaned.startswith("```"):
                first_nl = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
                cleaned = cleaned[first_nl + 1:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3].rstrip()

            start = cleaned.find("{")
            end = cleaned.rfind("}") + 1
            if start >= 0 and end > start:
                data = json.loads(cleaned[start:end])
                return ThermalAdvisorResult(
                    hot_components=data.get("hot_components", []),
                    recommendations=data.get("recommendations", []),
                    thermal_budget=data.get("thermal_budget", {}),
                    warnings=data.get("warnings", []),
                    passed=data.get("passed", True),
                )
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("Failed to parse thermal advisor LLM output: %s", exc)

        return ThermalAdvisorResult(
            hot_components=[],
            recommendations=[],
            thermal_budget={},
            warnings=["Failed to parse LLM output"],
            passed=False,
        )
