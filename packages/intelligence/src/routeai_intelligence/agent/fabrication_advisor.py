"""Fabrication Advisor -- DFM optimization recommendations for PCB designs.

Checks drill aspect ratio, annular ring, solder mask dams, copper balance,
trace/space minimums, and panel utilization. Classifies the design into
IPC fabrication classes (1-3) and provides actionable DFM recommendations.

Uses the LLMRouter for VRAM-aware model selection with task_type="fabrication_advisor".
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
class FabricationAdvisorResult:
    """Result of a fabrication / DFM analysis.

    Attributes:
        findings: Individual DFM findings.  Each dict contains:
            ``category``, ``severity`` (error/warning/info),
            ``message``, ``recommendation``, ``reference`` (IPC standard).
        fab_class: Recommended IPC fabrication class (1, 2, or 3).
            Class 1 = general electronics, Class 2 = dedicated-service,
            Class 3 = high-reliability.
        recommendations: High-level DFM recommendations (e.g. panel size,
            copper balancing, drill optimization).
        warnings: Human-readable warning messages.
        passed: ``True`` if no critical DFM violations were found.
    """

    findings: list[dict[str, Any]] = field(default_factory=list)
    fab_class: int = 2
    recommendations: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    passed: bool = True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

FABRICATION_ADVISOR_PROMPT = """\
You are a PCB fabrication advisor (DFM expert).

Analyze the design for manufacturability:

1. DRILL ASPECT RATIO: Board thickness / smallest drill diameter should
   be < 10:1.  Flag vias that exceed this ratio.
2. ANNULAR RING: Minimum annular ring for via reliability.
   IPC Class 2: >= 0.05 mm, Class 3: >= 0.075 mm.
3. SOLDER MASK: Minimum solder mask dam between pads.
   Standard: >= 0.075 mm (3 mil).  Flag tight-pitch BGA if < 0.05 mm.
4. COPPER BALANCE: Check copper distribution symmetry between layers.
   Asymmetric copper causes warping during reflow.  Flag >15% imbalance.
5. TRACE/SPACE: Verify minimum trace width and spacing meet fab house
   capabilities.  Standard: 0.1 mm / 0.1 mm (4/4 mil).
   Advanced: 0.075 mm / 0.075 mm (3/3 mil).
6. PANEL UTILIZATION: Recommend board dimensions for standard panel sizes
   (18x24", 21x24", 18x21").  Flag odd dimensions that waste panel area.
7. CONTROLLED IMPEDANCE: Flag if impedance-controlled traces require
   tighter dielectric tolerance (indicate fab cost impact).
8. SURFACE FINISH: Recommend surface finish based on component types
   (HASL, ENIG, OSP, immersion silver/tin).

Use the datasheet_lookup tool to verify pad dimensions and IPC standards.

OUTPUT FORMAT -- respond with a single JSON object:
{
  "findings": [
    {
      "category": "<drill|annular_ring|solder_mask|copper_balance|\
trace_space|panel|impedance|surface_finish|other>",
      "severity": "<error|warning|info>",
      "message": "<description>",
      "recommendation": "<how to fix>",
      "reference": "<IPC standard or fab guideline>"
    }
  ],
  "fab_class": <1|2|3>,
  "recommendations": [
    {
      "category": "<category>",
      "message": "<recommendation>",
      "cost_impact": "<none|low|medium|high>"
    }
  ],
  "warnings": ["...", ...],
  "passed": true/false
}
"""


# ---------------------------------------------------------------------------
# Agent class
# ---------------------------------------------------------------------------


class FabricationAdvisor:
    """DFM advisor powered by an LLM.

    Args:
        llm_router: An ``LLMRouter`` instance for provider selection.
    """

    def __init__(self, llm_router: LLMRouter) -> None:
        self._router = llm_router

    async def analyze(
        self,
        schematic_data: dict[str, Any] | str,
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> FabricationAdvisorResult:
        """Run the DFM analysis.

        Args:
            schematic_data: Serialized board/schematic dict (or pre-formatted
                string).  Should include board dimensions, layer stackup,
                via sizes, trace widths, and component footprints.
            tool_schemas: Optional tool schemas for LLM tool-use.

        Returns:
            A ``FabricationAdvisorResult`` with findings, fab class, and
            recommendations.
        """
        context = self._format_schematic(schematic_data)
        response = await self._router.generate(
            messages=[{"role": "user", "content": context}],
            system=FABRICATION_ADVISOR_PROMPT,
            tools=tool_schemas or [],
            task_type="fabrication_advisor",
        )
        return self._parse(response.text)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_schematic(data: dict[str, Any] | str) -> str:
        """Convert board/schematic data into a compact text representation."""
        if isinstance(data, str):
            return data

        board = data.get("board", {})
        components = data.get("components", [])
        vias = data.get("vias", [])
        traces = data.get("traces", data.get("tracks", []))
        stackup = data.get("stackup", data.get("layer_stackup", []))

        lines: list[str] = []

        # Board dimensions
        if board:
            dims = board.get("dimensions", {})
            thickness = board.get("thickness_mm", 1.6)
            layer_count = board.get("layer_count", "?")
            lines.append(
                f"BOARD: {dims.get('width_mm', '?')} x "
                f"{dims.get('height_mm', '?')} mm, "
                f"{layer_count} layers, {thickness} mm thick"
            )

        # Stackup
        if stackup:
            lines.append("\nSTACKUP:")
            for layer in stackup[:20]:
                lname = layer.get("name", "?")
                ltype = layer.get("type", "?")
                thickness = layer.get("thickness_mm", "?")
                lines.append(f"  {lname}: {ltype}, {thickness} mm")

        # Vias summary
        if vias:
            drill_sizes = set()
            for v in vias:
                d = v.get("drill_mm", v.get("drill", 0))
                if d:
                    drill_sizes.add(round(d, 3))
            lines.append(
                f"\nVIAS: {len(vias)} total, drill sizes: "
                f"{sorted(drill_sizes)} mm"
            )

        # Traces summary
        if traces:
            widths = set()
            for t in traces:
                w = t.get("width_mm", t.get("width", 0))
                if w:
                    widths.add(round(w, 3))
            lines.append(
                f"TRACES: {len(traces)} total, widths: {sorted(widths)} mm"
            )

        # Components
        if components:
            lines.append(f"\nCOMPONENTS ({len(components)} total):")
            for comp in components[:150]:
                ref = comp.get("reference", comp.get("ref", "?"))
                value = comp.get("value", "")
                footprint = comp.get("footprint", "")
                lines.append(f"  {ref}: {value} [{footprint}]")

        return "\n".join(lines) if lines else "No board data provided."

    @staticmethod
    def _parse(text: str) -> FabricationAdvisorResult:
        """Extract a ``FabricationAdvisorResult`` from the LLM response text."""
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

                fab_class = data.get("fab_class", 2)
                if not isinstance(fab_class, int) or fab_class not in (1, 2, 3):
                    fab_class = 2

                return FabricationAdvisorResult(
                    findings=data.get("findings", []),
                    fab_class=fab_class,
                    recommendations=data.get("recommendations", []),
                    warnings=data.get("warnings", []),
                    passed=data.get("passed", True),
                )
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning(
                "Failed to parse fabrication advisor LLM output: %s", exc
            )

        return FabricationAdvisorResult(
            findings=[],
            fab_class=2,
            recommendations=[],
            warnings=["Failed to parse LLM output"],
            passed=False,
        )
