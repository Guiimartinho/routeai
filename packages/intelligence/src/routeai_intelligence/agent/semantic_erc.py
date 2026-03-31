"""Semantic ERC -- function-based electrical rule check beyond simple connectivity.

Unlike traditional ERC (which only checks connectivity and pin direction),
Semantic ERC analyses *functional* correctness: voltage compatibility between
connected pins, proper pull-up/down values, decoupling coverage, reset/enable
logic, clock integrity, and analog/digital separation.

Uses the LLMRouter for VRAM-aware model selection with task_type="semantic_erc".
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
class SemanticERCResult:
    """Result of a semantic electrical rule check.

    Attributes:
        findings: List of individual findings.  Each dict contains:
            ``category``, ``severity`` (critical/error/warning/info),
            ``net``, ``components``, ``message``, ``recommendation``.
        error_count: Number of findings with severity ``critical`` or ``error``.
        warning_count: Number of findings with severity ``warning``.
        passed: ``True`` if ``error_count == 0``.
    """

    findings: list[dict[str, Any]] = field(default_factory=list)
    error_count: int = 0
    warning_count: int = 0
    passed: bool = True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SEMANTIC_ERC_PROMPT = """\
You are a semantic electrical rule checker for PCB schematics.

Unlike traditional ERC (connectivity only), you check FUNCTIONAL correctness:

1. POWER PIN VOLTAGE MATCH: Do connected power pins expect the same voltage?
   (e.g., a 3.3 V IC connected to a 5 V rail = ERROR)
2. SIGNAL DIRECTION: Are bidirectional pins properly configured?
   Are outputs driving outputs? (contention)
3. PULL-UP/DOWN VALUES: Are I2C pull-ups in the correct range
   (2.2 k - 10 k for standard mode)?
4. DECOUPLING: Does every IC with power pins have a nearby decoupling cap?
5. RESET/ENABLE LOGIC: Are active-low pins properly connected (not floating)?
6. CLOCK INTEGRITY: Are clock signals properly terminated?
7. ANALOG/DIGITAL SEPARATION: Are analog signals routed away from digital noise?

Use the datasheet_lookup tool when you need to verify pin voltage levels or
operating parameters.

OUTPUT FORMAT -- respond with a single JSON object:
{
  "findings": [
    {
      "category": "<one of: voltage_mismatch, signal_contention, pull_resistor, \
decoupling, reset_enable, clock, analog_digital, other>",
      "severity": "<critical|error|warning|info>",
      "net": "<net name or empty>",
      "components": ["<ref1>", ...],
      "message": "<concise description>",
      "recommendation": "<how to fix>"
    }
  ],
  "error_count": <int>,
  "warning_count": <int>,
  "passed": true/false
}
"""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------


class SemanticERCAnalyzer:
    """Function-based electrical rule checker powered by an LLM.

    Args:
        llm_router: An ``LLMRouter`` instance for provider selection.
    """

    def __init__(self, llm_router: LLMRouter) -> None:
        self._router = llm_router

    async def analyze(
        self,
        schematic_data: dict[str, Any] | str,
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> SemanticERCResult:
        """Run the semantic ERC analysis.

        Args:
            schematic_data: Serialized schematic dict (or pre-formatted string).
            tool_schemas: Optional tool schemas for LLM tool-use.

        Returns:
            A ``SemanticERCResult`` with categorized findings.
        """
        context = self._format_schematic(schematic_data)
        response = await self._router.generate(
            messages=[{"role": "user", "content": context}],
            system=SEMANTIC_ERC_PROMPT,
            tools=tool_schemas or [],
            task_type="semantic_erc",
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
            pins = comp.get("pins", [])
            pin_info = ""
            if pins:
                pin_strs = []
                for p in pins[:10]:
                    pname = p.get("name", p.get("pin_name", ""))
                    ptype = p.get("type", p.get("electrical_type", ""))
                    pnet = p.get("net", "")
                    pin_strs.append(f"{pname}({ptype})={pnet}")
                pin_info = " | pins: " + ", ".join(pin_strs)
            lines.append(f"  {ref}: {value}{pin_info}")

        if nets:
            lines.append("\nNETS:")
            for net in nets[:150]:
                net_name = net.get("name", net.get("net_name", ""))
                pins = net.get("pins", net.get("connections", []))
                if pins:
                    lines.append(f"  {net_name}: {', '.join(str(p) for p in pins[:20])}")
                else:
                    lines.append(f"  {net_name}")

        return "\n".join(lines)

    @staticmethod
    def _parse(text: str) -> SemanticERCResult:
        """Extract a ``SemanticERCResult`` from the LLM response text."""
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
                findings = data.get("findings", [])

                # Recompute counts from findings for consistency
                error_count = sum(
                    1
                    for f in findings
                    if f.get("severity") in ("critical", "error")
                )
                warning_count = sum(
                    1 for f in findings if f.get("severity") == "warning"
                )

                return SemanticERCResult(
                    findings=findings,
                    error_count=error_count,
                    warning_count=warning_count,
                    passed=error_count == 0,
                )
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("Failed to parse semantic ERC LLM output: %s", exc)

        return SemanticERCResult(
            findings=[],
            error_count=1,
            warning_count=0,
            passed=False,
        )
