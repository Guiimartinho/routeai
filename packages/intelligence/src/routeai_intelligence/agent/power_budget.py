"""Power Budget Analyzer -- analyzes power consumption by operating mode.

Identifies voltage rails, regulators, and consumer components. Calculates
current draw per rail in ACTIVE and SLEEP modes. Flags rails with
insufficient regulator margin (<20%).

Uses the LLMRouter for VRAM-aware model selection with task_type="power_budget".
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
class PowerBudgetResult:
    """Result of a power budget analysis.

    Attributes:
        rails: Per-rail breakdown with regulators, consumers, totals.
            Each dict has: name, voltage, regulators, consumers,
            total_current_ma, margin_pct.
        operating_modes: Power by mode.  Keys are mode names (e.g.
            ``"active"``, ``"sleep"``), values are dicts with
            ``total_power_mw`` and ``per_rail`` breakdowns.
        warnings: Human-readable warning messages.
        passed: ``True`` if every rail has >= 20 % margin.
    """

    rails: list[dict[str, Any]] = field(default_factory=list)
    operating_modes: dict[str, dict[str, Any]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    passed: bool = True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

POWER_BUDGET_PROMPT = """\
You are a power budget analyst for PCB designs.

Given the schematic data, analyze the power distribution:

1. Identify all voltage rails and their regulators (source components).
2. For each rail, list all consumer components and their current draw.
3. Calculate total current per rail in ACTIVE mode.
4. Estimate current in SLEEP mode (typically 10-20% of active for digital ICs).
5. Check if each regulator has sufficient capacity (include margin).
6. Flag any rails with less than 20% margin.

Use the datasheet_lookup tool to find current ratings for regulators and
consumption for ICs.

OUTPUT FORMAT -- respond with a single JSON object:
{
  "rails": [
    {
      "name": "<rail name, e.g. 3V3>",
      "voltage": <nominal voltage>,
      "regulators": ["<ref1>", ...],
      "consumers": [{"ref": "<ref>", "current_ma": <value>}, ...],
      "total_current_ma": <sum>,
      "regulator_max_ma": <max output of regulator>,
      "margin_pct": <(max - total) / max * 100>
    }
  ],
  "operating_modes": {
    "active": {"total_power_mw": <value>, "per_rail": {"<rail>": <mW>, ...}},
    "sleep":  {"total_power_mw": <value>, "per_rail": {"<rail>": <mW>, ...}}
  },
  "warnings": ["<warning string>", ...],
  "passed": true/false
}
"""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------


class PowerBudgetAnalyzer:
    """Analyzes power budget of a PCB design via LLM-assisted inspection.

    Args:
        llm_router: An ``LLMRouter`` instance for provider selection.
    """

    def __init__(self, llm_router: LLMRouter) -> None:
        self._router = llm_router

    async def analyze(
        self,
        schematic_data: dict[str, Any] | str,
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> PowerBudgetResult:
        """Run the power budget analysis.

        Args:
            schematic_data: Serialized schematic dict (or pre-formatted string).
            tool_schemas: Optional tool schemas to pass to the LLM for
                tool-use (e.g. ``datasheet_lookup``).

        Returns:
            A ``PowerBudgetResult`` with per-rail data, operating modes,
            and warnings.
        """
        context = self._format_schematic(schematic_data)
        response = await self._router.generate(
            messages=[{"role": "user", "content": context}],
            system=POWER_BUDGET_PROMPT,
            tools=tool_schemas or [],
            task_type="power_budget",
        )
        return self._parse(response.text)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_schematic(data: dict[str, Any] | str) -> str:
        """Convert schematic data into a compact text representation."""
        if isinstance(data, str):
            return data

        components = data.get("components", [])
        nets = data.get("nets", [])

        lines: list[str] = ["COMPONENTS:"]
        for comp in components[:200]:
            ref = comp.get("reference", comp.get("ref", "?"))
            value = comp.get("value", "")
            footprint = comp.get("footprint", "")
            lines.append(f"  {ref}: {value} ({footprint})")

        if nets:
            lines.append("\nNETS (power-relevant):")
            for net in nets[:100]:
                net_name = net.get("name", net.get("net_name", ""))
                pins = net.get("pins", net.get("connections", []))
                if pins:
                    lines.append(f"  {net_name}: {', '.join(str(p) for p in pins[:20])}")
                else:
                    lines.append(f"  {net_name}")

        return "\n".join(lines)

    @staticmethod
    def _parse(text: str) -> PowerBudgetResult:
        """Extract a ``PowerBudgetResult`` from the LLM response text."""
        try:
            # Strip markdown fences if present
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
                return PowerBudgetResult(
                    rails=data.get("rails", []),
                    operating_modes=data.get("operating_modes", {}),
                    warnings=data.get("warnings", []),
                    passed=data.get("passed", True),
                )
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("Failed to parse power budget LLM output: %s", exc)

        return PowerBudgetResult(
            rails=[],
            operating_modes={},
            warnings=["Failed to parse LLM output"],
            passed=False,
        )
