"""Advanced LLM-powered verification features V8-V13.

Provides thermal interpretation, test coverage analysis, DFM/DFA review,
reference design comparison, and multi-board system review. Each feature
uses a dual-provider LLM pattern (primary + fallback) with structured
prompts and real response parsing.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dual-provider LLM helper
# ---------------------------------------------------------------------------

class LLMProvider:
    """Wraps a RouteAIAgent or similar chat-capable LLM client."""

    def __init__(self, agent: Any) -> None:
        self._agent = agent

    async def call(self, prompt: str, context: dict[str, Any] | None = None) -> str:
        """Send a prompt and return the raw text response."""
        if self._agent is None:
            raise RuntimeError("No LLM agent configured")
        response = await self._agent.chat(prompt, context=context)
        return response.message


class DualProviderLLM:
    """Dual-provider LLM with automatic fallback.

    Tries the primary provider first. If it fails or returns unparseable
    output, falls back to the secondary provider. This provides resilience
    against rate limits, outages, or model-specific parsing issues.

    Args:
        primary: Primary LLM agent (e.g., Claude Opus for complex analysis).
        secondary: Fallback LLM agent (e.g., Claude Sonnet for speed/cost).
    """

    def __init__(
        self,
        primary: Any,
        secondary: Any | None = None,
    ) -> None:
        self._primary = LLMProvider(primary)
        self._secondary = LLMProvider(secondary) if secondary is not None else None

    async def call(
        self,
        prompt: str,
        context: dict[str, Any] | None = None,
        require_json: bool = True,
    ) -> dict[str, Any]:
        """Call the LLM and parse the JSON response.

        Tries primary first, falls back to secondary on failure.
        """
        for provider_name, provider in [("primary", self._primary), ("secondary", self._secondary)]:
            if provider is None:
                continue
            try:
                raw = await provider.call(prompt, context)
                if require_json:
                    return _parse_json_response(raw)
                return {"_raw_text": raw}
            except Exception as exc:
                logger.warning("LLM %s provider failed: %s", provider_name, exc)
                if provider_name == "secondary" or self._secondary is None:
                    raise
                continue

        raise RuntimeError("All LLM providers failed")

    async def call_raw(
        self,
        prompt: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        """Call the LLM and return raw text (no JSON parsing)."""
        for provider_name, provider in [("primary", self._primary), ("secondary", self._secondary)]:
            if provider is None:
                continue
            try:
                return await provider.call(prompt, context)
            except Exception as exc:
                logger.warning("LLM %s provider failed: %s", provider_name, exc)
                if provider_name == "secondary" or self._secondary is None:
                    raise
                continue
        raise RuntimeError("All LLM providers failed")


def _parse_json_response(text: str) -> dict[str, Any]:
    """Parse JSON from LLM output, handling markdown fences and partial output."""
    cleaned = text.strip()

    if cleaned.startswith("```"):
        first_nl = cleaned.find("\n")
        if first_nl != -1:
            cleaned = cleaned[first_nl + 1:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()

    try:
        result = json.loads(cleaned)
        if isinstance(result, dict):
            return result
        if isinstance(result, list):
            return {"items": result}
        return {"value": result}
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError:
            pass

    # Try finding a JSON array
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end > start:
        try:
            items = json.loads(cleaned[start:end + 1])
            if isinstance(items, list):
                return {"items": items}
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse JSON from LLM response: {cleaned[:200]}...")


# ===================================================================
# V8: ThermalInterpretation
# ===================================================================

class ThermalFixType(str, Enum):
    """Types of thermal fixes."""
    ADD_THERMAL_VIAS = "add_thermal_vias"
    INCREASE_COPPER_POUR = "increase_copper_pour"
    ADD_HEATSINK = "add_heatsink"
    IMPROVE_AIRFLOW = "improve_airflow"
    REDUCE_POWER = "reduce_power"
    RELOCATE_COMPONENT = "relocate_component"
    ADD_THERMAL_PAD = "add_thermal_pad"
    WIDEN_TRACES = "widen_traces"
    ADD_COPPER_PLANES = "add_copper_planes"
    CHANGE_PACKAGE = "change_package"


class ThermalFix(BaseModel):
    """A single thermal fix with quantified improvement."""
    fix_type: str = Field(description="Type of thermal fix")
    description: str = Field(description="Human-readable description of the fix")
    quantified_improvement: str = Field(
        description="Quantified improvement, e.g. 'Rth_JA drops from 45 to 28 C/W'"
    )
    rth_before: float = Field(default=0.0, description="Thermal resistance before fix (C/W)")
    rth_after: float = Field(default=0.0, description="Thermal resistance after fix (C/W)")
    tj_before_c: float = Field(default=0.0, description="Junction temperature before fix (C)")
    tj_after_c: float = Field(default=0.0, description="Junction temperature after fix (C)")
    effort: str = Field(default="medium", description="Implementation effort: low/medium/high")
    cost_impact: str = Field(default="minimal", description="Cost impact description")


class HotspotAnalysis(BaseModel):
    """Analysis of a single thermal hotspot."""
    component_ref: str = Field(description="Component reference designator")
    location: tuple[float, float] = Field(default=(0.0, 0.0), description="Board location (x, y) mm")
    temperature_c: float = Field(default=0.0, description="Estimated junction temperature (C)")
    max_rated_c: float = Field(default=125.0, description="Maximum rated temperature (C)")
    power_dissipation_w: float = Field(default=0.0, description="Power dissipated (W)")
    thermal_resistance_cw: float = Field(default=0.0, description="Current Rth_JA (C/W)")
    explanation: str = Field(description="Root cause explanation of the hotspot")
    impact: str = Field(description="Impact if not addressed")
    severity: str = Field(default="warning", description="critical/warning/info")
    fixes: list[ThermalFix] = Field(default_factory=list, description="Ranked fix options")


class ThermalInterpretationReport(BaseModel):
    """Complete thermal interpretation report."""
    hotspots: list[HotspotAnalysis] = Field(default_factory=list)
    ambient_temperature_c: float = Field(default=25.0)
    total_board_power_w: float = Field(default=0.0)
    worst_margin_c: float = Field(
        default=0.0,
        description="Worst thermal margin (max_rated - estimated) across all hotspots",
    )
    summary: str = Field(default="")
    recommendations: list[str] = Field(default_factory=list)


_THERMAL_PROMPT = """\
You are an expert PCB thermal analyst. Analyze the following thermal simulation data
and board context to produce actionable thermal fixes.

## Thermal Data
{thermal_json}

## Board Context
{board_json}

For EACH hotspot in the thermal data:
1. Explain the root cause (e.g., insufficient copper area, missing thermal vias, \
high power density, poor airflow path)
2. Quantify the current thermal resistance (Rth_JA) and junction temperature
3. For each fix option, calculate the expected improvement:
   - Thermal vias: each via ~0.3mm drill reduces Rth by ~3-5 C/W per via (diminishing returns after ~8 vias)
   - Copper pour: doubling copper area reduces Rth by ~20-30%
   - Heatsink: typical Rth_SA of 5-15 C/W depending on size
   - Component relocation: move away from other heat sources
4. Rate severity: critical if Tj > 0.85 * Tj_max, warning if > 0.7 * Tj_max, info otherwise

Return a JSON object:
{{
  "hotspots": [
    {{
      "component_ref": "U3",
      "location": [x, y],
      "temperature_c": 105.0,
      "max_rated_c": 125.0,
      "power_dissipation_w": 2.5,
      "thermal_resistance_cw": 45.0,
      "explanation": "High Rth_JA due to only 2 thermal vias under exposed pad...",
      "impact": "Junction temp exceeds 85% of Tj_max, reducing MTBF by ~50%",
      "severity": "critical",
      "fixes": [
        {{
          "fix_type": "add_thermal_vias",
          "description": "Add 4 thermal vias (0.3mm drill) under U3 exposed pad",
          "quantified_improvement": "Rth_JA drops from 45 to 28 C/W, Tj drops from 105C to 72C",
          "rth_before": 45.0,
          "rth_after": 28.0,
          "tj_before_c": 105.0,
          "tj_after_c": 72.0,
          "effort": "low",
          "cost_impact": "minimal - standard via process"
        }}
      ]
    }}
  ],
  "ambient_temperature_c": 25.0,
  "total_board_power_w": 8.5,
  "worst_margin_c": 20.0,
  "summary": "2 thermal hotspots identified...",
  "recommendations": ["Add thermal vias under U3...", "Increase copper pour on L2..."]
}}
"""


async def interpret_thermal(
    thermal_data: dict,
    board_context: dict,
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> ThermalInterpretationReport:
    """Translate thermal analysis data into actionable fixes.

    Uses LLM to interpret raw thermal simulation results and produce
    human-readable explanations with quantified fix options for each
    hotspot.

    Args:
        thermal_data: Raw thermal simulation output with hotspot locations,
            temperatures, power dissipation per component, and thermal
            resistance estimates.
        board_context: Board design context including layer stackup,
            copper pours, via placements, component positions, and
            package thermal specifications.
        primary_agent: Primary LLM agent for analysis.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        ThermalInterpretationReport with hotspot analyses and quantified fixes.
    """
    if primary_agent is None:
        return _thermal_heuristic_fallback(thermal_data, board_context)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _THERMAL_PROMPT.format(
        thermal_json=json.dumps(thermal_data, indent=2, default=str)[:6000],
        board_json=json.dumps(board_context, indent=2, default=str)[:6000],
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM thermal interpretation failed (%s), using heuristic fallback", exc)
        return _thermal_heuristic_fallback(thermal_data, board_context)

    hotspots: list[HotspotAnalysis] = []
    for hs in data.get("hotspots", []):
        fixes = []
        for fix_data in hs.get("fixes", []):
            fixes.append(ThermalFix(
                fix_type=fix_data.get("fix_type", "add_thermal_vias"),
                description=fix_data.get("description", ""),
                quantified_improvement=fix_data.get("quantified_improvement", ""),
                rth_before=float(fix_data.get("rth_before", 0)),
                rth_after=float(fix_data.get("rth_after", 0)),
                tj_before_c=float(fix_data.get("tj_before_c", 0)),
                tj_after_c=float(fix_data.get("tj_after_c", 0)),
                effort=fix_data.get("effort", "medium"),
                cost_impact=fix_data.get("cost_impact", "minimal"),
            ))

        loc = hs.get("location", [0.0, 0.0])
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location = (float(loc[0]), float(loc[1]))
        else:
            location = (0.0, 0.0)

        hotspots.append(HotspotAnalysis(
            component_ref=hs.get("component_ref", "unknown"),
            location=location,
            temperature_c=float(hs.get("temperature_c", 0)),
            max_rated_c=float(hs.get("max_rated_c", 125)),
            power_dissipation_w=float(hs.get("power_dissipation_w", 0)),
            thermal_resistance_cw=float(hs.get("thermal_resistance_cw", 0)),
            explanation=hs.get("explanation", ""),
            impact=hs.get("impact", ""),
            severity=hs.get("severity", "warning"),
            fixes=fixes,
        ))

    worst_margin = float("inf")
    for hs in hotspots:
        margin = hs.max_rated_c - hs.temperature_c
        if margin < worst_margin:
            worst_margin = margin
    if worst_margin == float("inf"):
        worst_margin = 0.0

    return ThermalInterpretationReport(
        hotspots=hotspots,
        ambient_temperature_c=float(data.get("ambient_temperature_c", 25.0)),
        total_board_power_w=float(data.get("total_board_power_w", 0.0)),
        worst_margin_c=float(data.get("worst_margin_c", worst_margin)),
        summary=data.get("summary", f"{len(hotspots)} thermal hotspot(s) analyzed"),
        recommendations=data.get("recommendations", []),
    )


def _thermal_heuristic_fallback(
    thermal_data: dict, board_context: dict
) -> ThermalInterpretationReport:
    """Heuristic fallback when no LLM is available."""
    hotspots_raw = thermal_data.get("hotspots", thermal_data.get("components", []))
    ambient = float(thermal_data.get("ambient_c", thermal_data.get("ambient_temperature_c", 25.0)))
    hotspots: list[HotspotAnalysis] = []
    total_power = 0.0

    for hs in hotspots_raw:
        power = float(hs.get("power_w", hs.get("power_dissipation_w", 0)))
        total_power += power
        rth = float(hs.get("rth_ja", hs.get("thermal_resistance_cw", 50.0)))
        tj = ambient + power * rth
        tj_max = float(hs.get("tj_max", hs.get("max_rated_c", 125.0)))

        if tj > 0.85 * tj_max:
            severity = "critical"
        elif tj > 0.7 * tj_max:
            severity = "warning"
        else:
            severity = "info"

        via_count = max(1, int(power / 0.5))
        rth_per_via_reduction = min(5.0, rth * 0.08)
        rth_after_vias = max(rth * 0.4, rth - via_count * rth_per_via_reduction)
        tj_after_vias = ambient + power * rth_after_vias

        rth_after_pour = rth * 0.7
        tj_after_pour = ambient + power * rth_after_pour

        fixes = [
            ThermalFix(
                fix_type="add_thermal_vias",
                description=f"Add {via_count} thermal vias (0.3mm drill) under {hs.get('ref', 'component')} exposed pad",
                quantified_improvement=f"Rth_JA drops from {rth:.0f} to {rth_after_vias:.0f} C/W, Tj drops from {tj:.0f}C to {tj_after_vias:.0f}C",
                rth_before=rth,
                rth_after=rth_after_vias,
                tj_before_c=tj,
                tj_after_c=tj_after_vias,
                effort="low",
                cost_impact="minimal - standard via process",
            ),
            ThermalFix(
                fix_type="increase_copper_pour",
                description=f"Increase copper pour area on inner layers under {hs.get('ref', 'component')}",
                quantified_improvement=f"Rth_JA drops from {rth:.0f} to {rth_after_pour:.0f} C/W, Tj drops from {tj:.0f}C to {tj_after_pour:.0f}C",
                rth_before=rth,
                rth_after=rth_after_pour,
                tj_before_c=tj,
                tj_after_c=tj_after_pour,
                effort="low",
                cost_impact="minimal",
            ),
        ]

        loc = hs.get("location", hs.get("position", [0.0, 0.0]))
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location = (float(loc[0]), float(loc[1]))
        else:
            location = (0.0, 0.0)

        hotspots.append(HotspotAnalysis(
            component_ref=hs.get("ref", hs.get("component_ref", "unknown")),
            location=location,
            temperature_c=tj,
            max_rated_c=tj_max,
            power_dissipation_w=power,
            thermal_resistance_cw=rth,
            explanation=f"Estimated Tj={tj:.0f}C from {power:.2f}W dissipation with Rth_JA={rth:.0f}C/W",
            impact=f"{'Exceeds 85% of Tj_max - reliability risk' if severity == 'critical' else 'Thermal margin adequate' if severity == 'info' else 'Approaching thermal limit'}",
            severity=severity,
            fixes=fixes,
        ))

    worst_margin = min((hs.max_rated_c - hs.temperature_c for hs in hotspots), default=0.0)

    return ThermalInterpretationReport(
        hotspots=hotspots,
        ambient_temperature_c=ambient,
        total_board_power_w=total_power,
        worst_margin_c=worst_margin,
        summary=f"{len(hotspots)} hotspot(s) analyzed via heuristic (no LLM). "
                f"Total board power: {total_power:.1f}W. Worst margin: {worst_margin:.0f}C.",
        recommendations=[
            f"Add thermal vias under {hs.component_ref}" for hs in hotspots if hs.severity == "critical"
        ],
    )


# ===================================================================
# V9: TestCoverageAnalyzer
# ===================================================================

class TestImportance(str, Enum):
    """Test point importance levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TestType(str, Enum):
    """Types of test access."""
    ICT = "ICT"
    FLYING_PROBE = "flying_probe"
    SCOPE = "scope"
    BOUNDARY_SCAN = "boundary_scan"
    FUNCTIONAL = "functional"


class ExistingTestPoint(BaseModel):
    """An existing test point in the design."""
    net_name: str
    location: tuple[float, float] = (0.0, 0.0)
    layer: str = "top"
    pad_size_mm: float = 1.0
    accessible: bool = True
    test_type: str = "ICT"


class MissingTestPoint(BaseModel):
    """A missing test point that should be added."""
    net_name: str
    importance: str = Field(description="critical/high/medium/low")
    reason: str = Field(description="Why this test point is needed")
    functional_category: str = Field(
        default="signal_probing",
        description="programming/debug/power_monitoring/signal_probing",
    )


class TestPointSuggestion(BaseModel):
    """Suggested test point location and parameters."""
    net_name: str
    importance: str = Field(description="critical/high/medium/low")
    reason: str
    suggested_position: tuple[float, float] = (0.0, 0.0)
    suggested_layer: str = "top"
    test_type: str = Field(description="ICT/flying_probe/scope")
    pad_size_mm: float = Field(default=1.0, description="Recommended test pad size")
    notes: str = ""


class TestCoverageReport(BaseModel):
    """Complete test coverage analysis report."""
    coverage_score: float = Field(
        default=0.0, description="Test coverage score 0-100"
    )
    existing_test_points: list[ExistingTestPoint] = Field(default_factory=list)
    missing_critical: list[MissingTestPoint] = Field(default_factory=list)
    missing_recommended: list[MissingTestPoint] = Field(default_factory=list)
    suggested_locations: list[TestPointSuggestion] = Field(default_factory=list)
    total_nets: int = 0
    covered_nets: int = 0
    summary: str = ""


_TEST_COVERAGE_PROMPT = """\
You are an expert PCB test engineer. Analyze the board and schematic to determine
test point coverage and identify missing test points.

## Board Context
{board_json}

## Schematic Context
{schematic_json}

Prioritize missing test points by functional importance:
1. CRITICAL - Programming interfaces (JTAG, SWD, ISP pins) - must have test access
2. HIGH - Debug signals (UART TX/RX, debug LEDs, status outputs)
3. HIGH - Power monitoring (each voltage rail should have a test point)
4. MEDIUM - Signal probing (key data buses, clock signals)
5. LOW - General I/O signals

For each net, determine:
- Is there already a test point or accessible pad?
- If missing, how important is test access?
- Where should the test point be placed? (near source, accessible location)
- What test method is appropriate? (ICT for production, flying_probe for low volume, scope for debug)

Return JSON:
{{
  "existing_test_points": [
    {{"net_name": "VCC_3V3", "location": [10.0, 20.0], "layer": "top", "pad_size_mm": 1.0, "accessible": true, "test_type": "ICT"}}
  ],
  "missing_critical": [
    {{"net_name": "SWDIO", "importance": "critical", "reason": "Programming interface - no test access for firmware flashing", "functional_category": "programming"}}
  ],
  "missing_recommended": [
    {{"net_name": "UART_TX", "importance": "high", "reason": "Debug output - needed for field diagnostics", "functional_category": "debug"}}
  ],
  "suggested_locations": [
    {{"net_name": "SWDIO", "importance": "critical", "reason": "SWD programming access", "suggested_position": [5.0, 10.0], "suggested_layer": "top", "test_type": "ICT", "pad_size_mm": 1.27, "notes": "Place near MCU, away from high-speed signals"}}
  ],
  "total_nets": 150,
  "covered_nets": 42,
  "summary": "Test coverage: 28%. 5 critical test points missing..."
}}
"""


async def analyze_test_coverage(
    board_context: dict,
    schematic_context: dict,
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> TestCoverageReport:
    """Analyze test point coverage and identify gaps.

    Examines which nets have test points and which don't, prioritizes
    missing test points by functional importance, and suggests optimal
    test point locations.

    Args:
        board_context: Board design with component placements, pads,
            and existing test points.
        schematic_context: Schematic with net types, signal functions,
            and component roles.
        primary_agent: Primary LLM agent.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        TestCoverageReport with coverage score, existing/missing test points,
        and suggested locations.
    """
    if primary_agent is None:
        return _test_coverage_heuristic(board_context, schematic_context)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _TEST_COVERAGE_PROMPT.format(
        board_json=json.dumps(board_context, indent=2, default=str)[:6000],
        schematic_json=json.dumps(schematic_context, indent=2, default=str)[:6000],
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM test coverage analysis failed (%s), using heuristic", exc)
        return _test_coverage_heuristic(board_context, schematic_context)

    existing = []
    for tp in data.get("existing_test_points", []):
        loc = tp.get("location", [0.0, 0.0])
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location = (float(loc[0]), float(loc[1]))
        else:
            location = (0.0, 0.0)
        existing.append(ExistingTestPoint(
            net_name=tp.get("net_name", ""),
            location=location,
            layer=tp.get("layer", "top"),
            pad_size_mm=float(tp.get("pad_size_mm", 1.0)),
            accessible=tp.get("accessible", True),
            test_type=tp.get("test_type", "ICT"),
        ))

    missing_critical = [
        MissingTestPoint(
            net_name=m.get("net_name", ""),
            importance=m.get("importance", "critical"),
            reason=m.get("reason", ""),
            functional_category=m.get("functional_category", "programming"),
        )
        for m in data.get("missing_critical", [])
    ]

    missing_recommended = [
        MissingTestPoint(
            net_name=m.get("net_name", ""),
            importance=m.get("importance", "medium"),
            reason=m.get("reason", ""),
            functional_category=m.get("functional_category", "signal_probing"),
        )
        for m in data.get("missing_recommended", [])
    ]

    suggested = []
    for s in data.get("suggested_locations", []):
        pos = s.get("suggested_position", [0.0, 0.0])
        if isinstance(pos, (list, tuple)) and len(pos) >= 2:
            position = (float(pos[0]), float(pos[1]))
        else:
            position = (0.0, 0.0)
        suggested.append(TestPointSuggestion(
            net_name=s.get("net_name", ""),
            importance=s.get("importance", "medium"),
            reason=s.get("reason", ""),
            suggested_position=position,
            suggested_layer=s.get("suggested_layer", "top"),
            test_type=s.get("test_type", "ICT"),
            pad_size_mm=float(s.get("pad_size_mm", 1.0)),
            notes=s.get("notes", ""),
        ))

    total_nets = int(data.get("total_nets", 0))
    covered_nets = int(data.get("covered_nets", len(existing)))
    coverage_score = (covered_nets / max(total_nets, 1)) * 100.0

    return TestCoverageReport(
        coverage_score=round(coverage_score, 1),
        existing_test_points=existing,
        missing_critical=missing_critical,
        missing_recommended=missing_recommended,
        suggested_locations=suggested,
        total_nets=total_nets,
        covered_nets=covered_nets,
        summary=data.get(
            "summary",
            f"Coverage: {coverage_score:.0f}%. {len(missing_critical)} critical, "
            f"{len(missing_recommended)} recommended test points missing.",
        ),
    )


def _test_coverage_heuristic(board_context: dict, schematic_context: dict) -> TestCoverageReport:
    """Heuristic test coverage analysis without LLM."""
    nets = schematic_context.get("nets", board_context.get("nets", []))
    components = schematic_context.get("components", board_context.get("components", []))
    test_points = board_context.get("test_points", [])

    existing: list[ExistingTestPoint] = []
    for tp in test_points:
        loc = tp.get("location", tp.get("position", [0.0, 0.0]))
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location = (float(loc[0]), float(loc[1]))
        else:
            location = (0.0, 0.0)
        existing.append(ExistingTestPoint(
            net_name=tp.get("net", tp.get("net_name", "")),
            location=location,
            layer=tp.get("layer", "top"),
        ))

    covered_net_names = {tp.net_name for tp in existing}
    missing_critical: list[MissingTestPoint] = []
    missing_recommended: list[MissingTestPoint] = []
    suggested: list[TestPointSuggestion] = []

    # Programming patterns
    _PROGRAMMING_PATTERNS = re.compile(
        r"(SWDIO|SWDCLK|SWD|JTAG|TCK|TMS|TDI|TDO|nRST|ISP|BOOT0|PROG)", re.IGNORECASE
    )
    _DEBUG_PATTERNS = re.compile(
        r"(UART.*TX|UART.*RX|TXD|RXD|DEBUG|DBG|STATUS_LED|LED_)", re.IGNORECASE
    )
    _POWER_PATTERNS = re.compile(
        r"(VCC|VDD|AVDD|DVDD|3V3|5V0|1V8|1V2|12V|VBUS|VBAT)", re.IGNORECASE
    )

    for net in nets:
        net_name = net.get("name", net.get("id", ""))
        if not net_name or net_name in covered_net_names:
            continue
        if re.search(r"^GND$|^VSS$|^AGND$|^DGND$", net_name, re.IGNORECASE):
            continue

        if _PROGRAMMING_PATTERNS.search(net_name):
            missing_critical.append(MissingTestPoint(
                net_name=net_name,
                importance="critical",
                reason=f"Programming interface signal '{net_name}' needs test access for firmware flashing",
                functional_category="programming",
            ))
            suggested.append(TestPointSuggestion(
                net_name=net_name,
                importance="critical",
                reason="Programming access required",
                test_type="ICT",
                pad_size_mm=1.27,
                notes="Place near MCU programming header area",
            ))
        elif _DEBUG_PATTERNS.search(net_name):
            missing_recommended.append(MissingTestPoint(
                net_name=net_name,
                importance="high",
                reason=f"Debug signal '{net_name}' recommended for diagnostics",
                functional_category="debug",
            ))
            suggested.append(TestPointSuggestion(
                net_name=net_name,
                importance="high",
                reason="Debug access for diagnostics and field troubleshooting",
                test_type="scope",
                pad_size_mm=1.0,
            ))
        elif _POWER_PATTERNS.search(net_name):
            missing_recommended.append(MissingTestPoint(
                net_name=net_name,
                importance="high",
                reason=f"Power rail '{net_name}' should have test point for voltage monitoring",
                functional_category="power_monitoring",
            ))
            suggested.append(TestPointSuggestion(
                net_name=net_name,
                importance="high",
                reason="Voltage rail monitoring during test and debug",
                test_type="ICT",
                pad_size_mm=1.5,
                notes="Place near regulator output for accurate measurement",
            ))

    total_nets = len(nets)
    covered = len(covered_net_names)
    score = (covered / max(total_nets, 1)) * 100.0

    return TestCoverageReport(
        coverage_score=round(score, 1),
        existing_test_points=existing,
        missing_critical=missing_critical,
        missing_recommended=missing_recommended,
        suggested_locations=suggested,
        total_nets=total_nets,
        covered_nets=covered,
        summary=f"Heuristic analysis: {score:.0f}% coverage. "
                f"{len(missing_critical)} critical, {len(missing_recommended)} recommended missing.",
    )


# ===================================================================
# V10: DFMReviewer
# ===================================================================

class DFMFindingSeverity(str, Enum):
    """DFM finding severity."""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class DFMFinding(BaseModel):
    """A single DFM finding with cost and yield impact."""
    category: str = Field(description="trace_width/drill/spacing/annular_ring/solder_mask/silkscreen/via/board_edge/special")
    severity: str = Field(default="warning")
    description: str = Field(description="Human-readable description of the issue")
    location: Optional[tuple[float, float]] = None
    measured_value: Optional[float] = None
    required_value: Optional[float] = None
    cost_impact: str = Field(
        default="none",
        description="Cost impact description, e.g. '$2 extra per board'",
    )
    cost_delta_usd: float = Field(default=0.0, description="Estimated cost change per board in USD")
    yield_impact: str = Field(
        default="none",
        description="Yield impact description, e.g. 'yield drops ~2%'",
    )
    yield_delta_pct: float = Field(default=0.0, description="Estimated yield change in percentage points")
    suggestion: str = Field(default="", description="Actionable fix suggestion")
    manufacturing_explanation: str = Field(
        default="",
        description="Why this matters for manufacturing",
    )


class DFMReviewReport(BaseModel):
    """Complete DFM review report with cost and yield estimates."""
    fab_profile: str = Field(default="")
    estimated_cost_per_board_usd: float = Field(default=0.0)
    estimated_yield_pct: float = Field(default=99.0)
    findings: list[DFMFinding] = Field(default_factory=list)
    score: float = Field(default=100.0, description="DFM score 0-100")
    summary: str = ""
    cost_optimization_tips: list[str] = Field(default_factory=list)


# Known fab profiles with cost implications
_FAB_COST_RULES: dict[str, dict[str, Any]] = {
    "jlcpcb": {
        "base_cost_per_board": 2.0,
        "min_drill_standard_mm": 0.3,
        "min_drill_advanced_mm": 0.2,
        "advanced_drill_surcharge": 2.0,
        "min_trace_standard_mm": 0.127,
        "min_trace_advanced_mm": 0.09,
        "advanced_trace_surcharge": 5.0,
        "blind_via_surcharge": 10.0,
        "4_layer_surcharge": 8.0,
        "impedance_control_surcharge": 7.0,
    },
    "pcbway": {
        "base_cost_per_board": 2.5,
        "min_drill_standard_mm": 0.3,
        "min_drill_advanced_mm": 0.15,
        "advanced_drill_surcharge": 3.0,
        "min_trace_standard_mm": 0.127,
        "min_trace_advanced_mm": 0.09,
        "advanced_trace_surcharge": 6.0,
        "blind_via_surcharge": 12.0,
        "4_layer_surcharge": 10.0,
        "impedance_control_surcharge": 8.0,
    },
    "osh_park": {
        "base_cost_per_board": 5.0,
        "min_drill_standard_mm": 0.254,
        "min_drill_advanced_mm": 0.254,
        "advanced_drill_surcharge": 0.0,
        "min_trace_standard_mm": 0.15,
        "min_trace_advanced_mm": 0.15,
        "advanced_trace_surcharge": 0.0,
        "blind_via_surcharge": 0.0,
        "4_layer_surcharge": 15.0,
        "impedance_control_surcharge": 0.0,
    },
}


_DFM_REVIEW_PROMPT = """\
You are an expert PCB manufacturing engineer. Review this board design against
the {fab_profile} fabrication capabilities and provide DFM findings with
cost and yield impact analysis.

## Board Context
{board_json}

## Fab Profile: {fab_profile}
{fab_rules_json}

Go BEYOND simple pass/fail. For each issue:
1. Explain the manufacturing impact in plain language
2. Quantify the cost impact (extra charges, panel utilization)
3. Quantify the yield impact (etch tolerance, drill registration, etc.)
4. Suggest the minimal change that fixes the issue

Common cost/yield relationships:
- Via drill <0.3mm at JLCPCB: +$2/board surcharge, 0.2mm works but adds cost
- Trace <0.127mm: advanced process, ~$5 extra, yield drops ~1-2% per 0.01mm below limit
- Blind/buried vias: +$10-15/board, additional 3-5 day lead time
- Impedance control: +$7-8/board
- Fine-pitch BGA (<0.4mm pitch): requires microvia, adds $15-20/board
- Board thickness <0.8mm: special handling, +$3/board

Return JSON:
{{
  "fab_profile": "{fab_profile}",
  "estimated_cost_per_board_usd": 5.50,
  "estimated_yield_pct": 97.5,
  "findings": [
    {{
      "category": "drill",
      "severity": "warning",
      "description": "Via drill 0.2mm used in 14 locations",
      "location": [15.0, 22.0],
      "measured_value": 0.2,
      "required_value": 0.3,
      "cost_impact": "JLCPCB charges $2 extra per board for <0.3mm drill",
      "cost_delta_usd": 2.0,
      "yield_impact": "Drill registration tolerance tighter, yield drops ~0.5%",
      "yield_delta_pct": -0.5,
      "suggestion": "Use 0.3mm drill where routing space allows. 0.3mm works for this design and saves cost.",
      "manufacturing_explanation": "Smaller drill bits break more often and require slower feed rates, increasing production cost and reducing yield."
    }}
  ],
  "score": 82.0,
  "summary": "DFM review for JLCPCB: 3 findings. Estimated cost $5.50/board, yield 97.5%.",
  "cost_optimization_tips": ["Switch 0.2mm vias to 0.3mm to save $2/board", "..."]
}}
"""


async def review_dfm(
    board_context: dict,
    fab_profile: str = "jlcpcb",
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> DFMReviewReport:
    """Review a board design for manufacturability with cost and yield analysis.

    Goes beyond pass/fail DFM checks to explain manufacturing impact,
    quantify cost implications, and estimate yield effects for the
    chosen fabrication house.

    Args:
        board_context: Board design data including traces, vias, pads,
            drill sizes, board outline, and layer stackup.
        fab_profile: Fabrication house profile name (e.g., "jlcpcb",
            "pcbway", "osh_park").
        primary_agent: Primary LLM agent.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        DFMReviewReport with findings, cost/yield estimates, and optimization tips.
    """
    fab_rules = _FAB_COST_RULES.get(fab_profile.lower(), _FAB_COST_RULES["jlcpcb"])

    if primary_agent is None:
        return _dfm_heuristic_review(board_context, fab_profile, fab_rules)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _DFM_REVIEW_PROMPT.format(
        fab_profile=fab_profile,
        board_json=json.dumps(board_context, indent=2, default=str)[:6000],
        fab_rules_json=json.dumps(fab_rules, indent=2),
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM DFM review failed (%s), using heuristic", exc)
        return _dfm_heuristic_review(board_context, fab_profile, fab_rules)

    findings = []
    for f in data.get("findings", []):
        loc = f.get("location")
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location: Optional[tuple[float, float]] = (float(loc[0]), float(loc[1]))
        else:
            location = None
        findings.append(DFMFinding(
            category=f.get("category", "general"),
            severity=f.get("severity", "warning"),
            description=f.get("description", ""),
            location=location,
            measured_value=_safe_float(f.get("measured_value")),
            required_value=_safe_float(f.get("required_value")),
            cost_impact=f.get("cost_impact", "none"),
            cost_delta_usd=float(f.get("cost_delta_usd", 0)),
            yield_impact=f.get("yield_impact", "none"),
            yield_delta_pct=float(f.get("yield_delta_pct", 0)),
            suggestion=f.get("suggestion", ""),
            manufacturing_explanation=f.get("manufacturing_explanation", ""),
        ))

    return DFMReviewReport(
        fab_profile=data.get("fab_profile", fab_profile),
        estimated_cost_per_board_usd=float(data.get("estimated_cost_per_board_usd", 0)),
        estimated_yield_pct=float(data.get("estimated_yield_pct", 99.0)),
        findings=findings,
        score=float(data.get("score", 100.0)),
        summary=data.get("summary", f"{len(findings)} DFM findings for {fab_profile}"),
        cost_optimization_tips=data.get("cost_optimization_tips", []),
    )


def _safe_float(val: Any) -> Optional[float]:
    """Safely convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _dfm_heuristic_review(
    board_context: dict, fab_profile: str, fab_rules: dict[str, Any]
) -> DFMReviewReport:
    """Heuristic DFM review without LLM."""
    findings: list[DFMFinding] = []
    total_cost = float(fab_rules.get("base_cost_per_board", 2.0))
    yield_pct = 99.5

    vias = board_context.get("vias", [])
    traces = board_context.get("traces", [])
    layers = board_context.get("layers", board_context.get("layer_count", 2))
    layer_count = layers if isinstance(layers, int) else len(layers) if isinstance(layers, list) else 2

    # Check via drill sizes
    min_standard = fab_rules.get("min_drill_standard_mm", 0.3)
    min_advanced = fab_rules.get("min_drill_advanced_mm", 0.2)
    small_via_count = 0
    for via in vias:
        drill = float(via.get("drill", via.get("drill_mm", 0.3)))
        if drill < min_standard:
            small_via_count += 1

    if small_via_count > 0:
        surcharge = float(fab_rules.get("advanced_drill_surcharge", 2.0))
        total_cost += surcharge
        yield_pct -= 0.5
        findings.append(DFMFinding(
            category="drill",
            severity="warning",
            description=f"{small_via_count} via(s) with drill <{min_standard}mm",
            cost_impact=f"{fab_profile} charges ${surcharge:.0f} extra per board for <{min_standard}mm drill",
            cost_delta_usd=surcharge,
            yield_impact=f"Yield drops ~0.5% due to tighter drill registration",
            yield_delta_pct=-0.5,
            suggestion=f"Use {min_standard}mm drill where possible to save ${surcharge:.0f}/board",
            manufacturing_explanation="Smaller drill bits have higher breakage rates and require slower feed, increasing cost.",
        ))

    # Check trace widths
    min_trace_standard = fab_rules.get("min_trace_standard_mm", 0.127)
    min_trace_advanced = fab_rules.get("min_trace_advanced_mm", 0.09)
    narrow_trace_count = 0
    for trace in traces:
        width = float(trace.get("width", trace.get("width_mm", 0.15)))
        if width < min_trace_standard:
            narrow_trace_count += 1

    if narrow_trace_count > 0:
        surcharge = float(fab_rules.get("advanced_trace_surcharge", 5.0))
        total_cost += surcharge
        yield_pct -= 1.5
        findings.append(DFMFinding(
            category="trace_width",
            severity="warning",
            description=f"{narrow_trace_count} trace(s) narrower than {min_trace_standard}mm standard capability",
            cost_impact=f"Advanced process required: +${surcharge:.0f}/board",
            cost_delta_usd=surcharge,
            yield_impact="Yield drops ~1.5% due to etch tolerance at fine widths",
            yield_delta_pct=-1.5,
            suggestion=f"Widen traces to {min_trace_standard}mm where routing allows. Fine traces only where required for BGA escape.",
            manufacturing_explanation="Narrower traces approach etch tolerance limits, causing more opens/shorts in production.",
        ))

    # Check layer count cost
    if layer_count > 2:
        layer_surcharge = float(fab_rules.get("4_layer_surcharge", 8.0))
        if layer_count > 4:
            layer_surcharge *= (layer_count / 4.0)
        total_cost += layer_surcharge

    # Check for blind/buried vias
    blind_count = sum(1 for v in vias if v.get("blind", False) or v.get("buried", False))
    if blind_count > 0:
        surcharge = float(fab_rules.get("blind_via_surcharge", 10.0))
        total_cost += surcharge
        findings.append(DFMFinding(
            category="via",
            severity="info",
            description=f"{blind_count} blind/buried via(s) detected",
            cost_impact=f"Blind/buried vias add ${surcharge:.0f}/board and 3-5 days lead time",
            cost_delta_usd=surcharge,
            yield_impact="Blind via alignment tolerance reduces yield ~1%",
            yield_delta_pct=-1.0,
            suggestion="Use through-hole vias where possible to reduce cost and lead time",
            manufacturing_explanation="Blind/buried vias require additional drilling and lamination cycles.",
        ))

    score = 100.0 - len([f for f in findings if f.severity == "error"]) * 15.0 - len([f for f in findings if f.severity == "warning"]) * 5.0
    score = max(0.0, score)

    tips = []
    if small_via_count > 0:
        tips.append(f"Switch {small_via_count} small vias to {min_standard}mm drill to save ${fab_rules.get('advanced_drill_surcharge', 2):.0f}/board")
    if narrow_trace_count > 0:
        tips.append(f"Widen {narrow_trace_count} narrow traces to eliminate advanced process surcharge")

    return DFMReviewReport(
        fab_profile=fab_profile,
        estimated_cost_per_board_usd=round(total_cost, 2),
        estimated_yield_pct=round(yield_pct, 1),
        findings=findings,
        score=score,
        summary=f"Heuristic DFM review for {fab_profile}: {len(findings)} findings. "
                f"Est. cost ${total_cost:.2f}/board, yield {yield_pct:.1f}%.",
        cost_optimization_tips=tips,
    )


# ===================================================================
# V11: DFAReviewer
# ===================================================================

class DFARiskLevel(str, Enum):
    """DFA risk levels."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class DFAFinding(BaseModel):
    """A single DFA finding."""
    category: str = Field(
        description="tombstoning/orientation/spacing/component_order/solder_paste/polarity/placement"
    )
    risk_level: str = Field(default="medium", description="high/medium/low/info")
    component_refs: list[str] = Field(default_factory=list)
    explanation: str = Field(description="Detailed explanation of the assembly risk")
    fix_suggestion: str = Field(description="How to fix or mitigate")
    location: Optional[tuple[float, float]] = None
    thermal_asymmetry_pct: Optional[float] = Field(
        default=None,
        description="For tombstoning: thermal asymmetry between pads as percentage",
    )


class DFAReviewReport(BaseModel):
    """Complete DFA review report."""
    findings: list[DFAFinding] = Field(default_factory=list)
    score: float = Field(default=100.0, description="DFA score 0-100")
    total_components: int = 0
    smd_count: int = 0
    tht_count: int = 0
    fine_pitch_count: int = 0
    summary: str = ""


_DFA_REVIEW_PROMPT = """\
You are an expert PCB assembly engineer. Review this board design for
Design for Assembly (DFA) issues.

## Board Context
{board_json}

Check for ALL of these assembly risks:

1. **Tombstoning risk** (pad thermal asymmetry):
   - For each 0402/0201/0603 passive, check if one pad connects to a large copper
     pour or ground plane while the other connects to a thin trace
   - Thermal asymmetry >30% = high risk, 15-30% = medium risk
   - Report the asymmetry percentage for each at-risk component

2. **Component orientation consistency**:
   - All polarized components (diodes, tantalum caps, ICs) should follow consistent
     orientation patterns (e.g., pin 1 always toward same board edge)
   - Mixed orientations increase pick-and-place setup time and inspection errors

3. **Minimum spacing for rework**:
   - Components closer than 1mm edge-to-edge are difficult to rework
   - Tall components near small ones block access
   - QFN/BGA components need at least 2mm clearance for rework tool access

4. **Tall-before-short component ordering**:
   - During reflow, tall components should not shadow shorter ones from IR heating
   - Check if tall electrolytic caps or connectors are placed near small SMD passives

5. **Solder paste volume for fine-pitch**:
   - Fine-pitch components (<0.5mm pitch) need aperture reduction in stencil
   - BGA with <0.4mm pitch may need stepped stencil

Return JSON:
{{
  "findings": [
    {{
      "category": "tombstoning",
      "risk_level": "high",
      "component_refs": ["C15", "C22"],
      "explanation": "C15 (0402 100nF): pad 1 connects to GND copper pour (>5mm2), pad 2 connects to 0.15mm trace. Thermal asymmetry ~45%. High tombstoning risk during reflow.",
      "fix_suggestion": "Add thermal relief on pad 1 GND connection, or add a small copper thieving pad near pad 2 to balance thermal mass.",
      "location": [12.5, 8.3],
      "thermal_asymmetry_pct": 45.0
    }}
  ],
  "score": 75.0,
  "total_components": 120,
  "smd_count": 105,
  "tht_count": 15,
  "fine_pitch_count": 3,
  "summary": "DFA review: 8 findings (3 high, 2 medium, 3 low risk). Main concerns: tombstoning risk on 5 passives, tight spacing near U1."
}}
"""


async def review_dfa(
    board_context: dict,
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> DFAReviewReport:
    """Review a board design for assembly issues.

    Checks for tombstoning risk (pad thermal asymmetry), component
    orientation consistency, minimum spacing for rework, tall-before-short
    component ordering, and solder paste volume for fine-pitch parts.

    Args:
        board_context: Board design data including component placements,
            pad geometries, copper pour areas, and package information.
        primary_agent: Primary LLM agent.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        DFAReviewReport with findings, risk levels, and fix suggestions.
    """
    if primary_agent is None:
        return _dfa_heuristic_review(board_context)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _DFA_REVIEW_PROMPT.format(
        board_json=json.dumps(board_context, indent=2, default=str)[:8000],
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM DFA review failed (%s), using heuristic", exc)
        return _dfa_heuristic_review(board_context)

    findings = []
    for f in data.get("findings", []):
        loc = f.get("location")
        if isinstance(loc, (list, tuple)) and len(loc) >= 2:
            location: Optional[tuple[float, float]] = (float(loc[0]), float(loc[1]))
        else:
            location = None
        findings.append(DFAFinding(
            category=f.get("category", "placement"),
            risk_level=f.get("risk_level", "medium"),
            component_refs=f.get("component_refs", []),
            explanation=f.get("explanation", ""),
            fix_suggestion=f.get("fix_suggestion", ""),
            location=location,
            thermal_asymmetry_pct=_safe_float(f.get("thermal_asymmetry_pct")),
        ))

    return DFAReviewReport(
        findings=findings,
        score=float(data.get("score", 100.0)),
        total_components=int(data.get("total_components", 0)),
        smd_count=int(data.get("smd_count", 0)),
        tht_count=int(data.get("tht_count", 0)),
        fine_pitch_count=int(data.get("fine_pitch_count", 0)),
        summary=data.get("summary", f"DFA review: {len(findings)} findings"),
    )


def _dfa_heuristic_review(board_context: dict) -> DFAReviewReport:
    """Heuristic DFA review without LLM."""
    components = board_context.get("components", [])
    pads = board_context.get("pads", [])
    copper_pours = board_context.get("copper_pours", board_context.get("zones", []))

    findings: list[DFAFinding] = []
    smd_count = 0
    tht_count = 0
    fine_pitch_count = 0

    # Build pad-to-copper-area map for tombstoning analysis
    gnd_area_pads: set[str] = set()
    for zone in copper_pours:
        net = zone.get("net", "")
        if re.search(r"GND|VSS|AGND|DGND", net, re.IGNORECASE):
            # Mark all pads on this net as connected to ground pour
            for p in pads:
                if p.get("net", "") == net:
                    gnd_area_pads.add(p.get("id", ""))

    # Analyze each component
    small_passives = []  # 0201, 0402, 0603 packages
    component_positions: list[dict[str, Any]] = []
    tall_components: list[dict[str, Any]] = []
    orientation_map: dict[str, list[str]] = {}

    for comp in components:
        ref = comp.get("reference", "")
        package = (comp.get("package", "") + " " + comp.get("footprint", "")).lower()
        mount = comp.get("mount", "smd")
        height = float(comp.get("height_mm", comp.get("height", 0)))
        x = float(comp.get("x", comp.get("pos_x", 0)))
        y = float(comp.get("y", comp.get("pos_y", 0)))
        rotation = float(comp.get("rotation", 0))
        pitch = float(comp.get("pitch_mm", comp.get("pin_pitch", 1.0)))

        if mount == "smd" or not ref.startswith(("J", "P")):
            smd_count += 1
        else:
            tht_count += 1

        if pitch < 0.5:
            fine_pitch_count += 1

        component_positions.append({
            "ref": ref, "x": x, "y": y,
            "width": float(comp.get("width_mm", comp.get("width", 2))),
            "height_mm": float(comp.get("length_mm", comp.get("length", 2))),
            "comp_height": height,
        })

        if height > 5.0:
            tall_components.append({"ref": ref, "x": x, "y": y, "height": height})

        # Track orientation for polarized components
        if ref.startswith(("D", "U", "Q")):
            rot_bucket = str(int(rotation) % 360)
            orientation_map.setdefault(rot_bucket, []).append(ref)

        # Tombstoning check for small passives
        is_small_passive = any(
            pkg in package for pkg in ("0201", "0402", "0603", "01005")
        ) or (ref.startswith(("C", "R")) and any(
            pkg in package for pkg in ("0201", "0402", "0603")
        ))

        if is_small_passive:
            small_passives.append(comp)
            comp_pads = [p for p in pads if p.get("component", p.get("component_ref", "")) == ref]
            if len(comp_pads) >= 2:
                pad1_on_gnd = comp_pads[0].get("id", "") in gnd_area_pads
                pad2_on_gnd = comp_pads[1].get("id", "") in gnd_area_pads
                if pad1_on_gnd != pad2_on_gnd:
                    # One pad on copper pour, other not = thermal asymmetry
                    pad1_net = comp_pads[0].get("net", "")
                    pad2_net = comp_pads[1].get("net", "")
                    gnd_pad = "pad 1" if pad1_on_gnd else "pad 2"
                    signal_pad = "pad 2" if pad1_on_gnd else "pad 1"
                    asymmetry = 40.0 if "0201" in package or "01005" in package else 30.0

                    risk = "high" if asymmetry > 35 else "medium"
                    findings.append(DFAFinding(
                        category="tombstoning",
                        risk_level=risk,
                        component_refs=[ref],
                        explanation=(
                            f"{ref} ({package.strip()}): {gnd_pad} connects to ground copper pour, "
                            f"{signal_pad} connects to signal trace. Estimated thermal asymmetry ~{asymmetry:.0f}%. "
                            f"{'High' if risk == 'high' else 'Medium'} tombstoning risk during reflow."
                        ),
                        fix_suggestion=(
                            f"Add thermal relief on {gnd_pad} ground connection to balance "
                            f"heat absorption, or add copper thieving pad near {signal_pad}."
                        ),
                        location=(x, y),
                        thermal_asymmetry_pct=asymmetry,
                    ))

    # Check orientation consistency
    if len(orientation_map) > 2 and sum(len(v) for v in orientation_map.values()) > 5:
        dominant_rotations = sorted(orientation_map.items(), key=lambda kv: -len(kv[1]))
        minority_count = sum(len(v) for _, v in dominant_rotations[2:])
        if minority_count > 3:
            minority_refs = []
            for _, refs in dominant_rotations[2:]:
                minority_refs.extend(refs[:3])
            findings.append(DFAFinding(
                category="orientation",
                risk_level="low",
                component_refs=minority_refs[:5],
                explanation=(
                    f"Polarized components use {len(orientation_map)} different orientations. "
                    f"{minority_count} components deviate from the two dominant orientations. "
                    f"Inconsistent orientation increases inspection errors."
                ),
                fix_suggestion=(
                    "Standardize component orientations: pin 1 / cathode marks should "
                    "face the same board edge where possible."
                ),
            ))

    # Check spacing for rework
    for i in range(len(component_positions)):
        for j in range(i + 1, min(i + 20, len(component_positions))):
            ci = component_positions[i]
            cj = component_positions[j]
            dist = math.sqrt((ci["x"] - cj["x"]) ** 2 + (ci["y"] - cj["y"]) ** 2)
            edge_dist = dist - (ci["width"] + cj["width"]) / 2.0

            if 0 < edge_dist < 0.8:
                findings.append(DFAFinding(
                    category="spacing",
                    risk_level="medium",
                    component_refs=[ci["ref"], cj["ref"]],
                    explanation=(
                        f"{ci['ref']} and {cj['ref']} are {edge_dist:.2f}mm apart (edge-to-edge). "
                        f"Minimum 1.0mm recommended for rework access."
                    ),
                    fix_suggestion=(
                        f"Increase spacing between {ci['ref']} and {cj['ref']} to at least 1.0mm "
                        f"for rework tool access."
                    ),
                    location=((ci["x"] + cj["x"]) / 2, (ci["y"] + cj["y"]) / 2),
                ))
                break  # Only report once per component

    # Check tall-before-short
    for tall in tall_components:
        for sp in small_passives:
            sp_x = float(sp.get("x", sp.get("pos_x", 0)))
            sp_y = float(sp.get("y", sp.get("pos_y", 0)))
            dist = math.sqrt((tall["x"] - sp_x) ** 2 + (tall["y"] - sp_y) ** 2)
            if dist < 3.0:
                findings.append(DFAFinding(
                    category="component_order",
                    risk_level="low",
                    component_refs=[tall["ref"], sp.get("reference", "")],
                    explanation=(
                        f"Tall component {tall['ref']} ({tall['height']:.1f}mm) is {dist:.1f}mm from "
                        f"small passive {sp.get('reference', '')}. May shadow it during IR reflow."
                    ),
                    fix_suggestion=(
                        f"Move {sp.get('reference', '')} at least 3mm from {tall['ref']} "
                        f"or ensure adequate thermal exposure from both sides."
                    ),
                    location=((tall["x"] + sp_x) / 2, (tall["y"] + sp_y) / 2),
                ))
                break

    # Fine-pitch solder paste
    if fine_pitch_count > 0:
        findings.append(DFAFinding(
            category="solder_paste",
            risk_level="medium",
            component_refs=[],
            explanation=(
                f"{fine_pitch_count} fine-pitch component(s) (<0.5mm pitch) detected. "
                f"Standard stencil aperture may cause bridging or insufficient paste."
            ),
            fix_suggestion=(
                "Use aperture reduction (80-90% of pad width) for fine-pitch pads in stencil design. "
                "Consider stepped stencil for mixed-pitch boards."
            ),
        ))

    score = 100.0
    for f in findings:
        if f.risk_level == "high":
            score -= 10.0
        elif f.risk_level == "medium":
            score -= 5.0
        elif f.risk_level == "low":
            score -= 2.0
    score = max(0.0, score)

    return DFAReviewReport(
        findings=findings,
        score=score,
        total_components=len(components),
        smd_count=smd_count,
        tht_count=tht_count,
        fine_pitch_count=fine_pitch_count,
        summary=(
            f"Heuristic DFA review: {len(findings)} findings. "
            f"{len([f for f in findings if f.risk_level == 'high'])} high, "
            f"{len([f for f in findings if f.risk_level == 'medium'])} medium, "
            f"{len([f for f in findings if f.risk_level == 'low'])} low risk. "
            f"Score: {score:.0f}/100."
        ),
    )


# ===================================================================
# V12: ReferenceDesignComparator
# ===================================================================

class DifferenceSeverity(str, Enum):
    """Severity of a difference from reference design."""
    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


class DesignDifference(BaseModel):
    """A difference between user's design and a reference design."""
    aspect: str = Field(description="What aspect differs: impedance/component/topology/protection/decoupling/layout")
    user_design_value: str = Field(description="What the user's design has")
    reference_value: str = Field(description="What the reference design specifies")
    significance: str = Field(description="Why this difference matters")
    severity: str = Field(default="warning", description="critical/warning/info")
    recommendation: str = Field(description="What to do about it")


class DesignSimilarity(BaseModel):
    """An aspect where the user's design matches the reference."""
    aspect: str
    description: str
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)


class ComparisonReport(BaseModel):
    """Complete reference design comparison report."""
    reference_used: str = Field(description="Name/source of the reference design")
    match_score: float = Field(default=0.0, description="Overall match score 0-100")
    similarities: list[DesignSimilarity] = Field(default_factory=list)
    differences: list[DesignDifference] = Field(default_factory=list)
    summary: str = ""
    critical_differences: int = 0
    warnings: int = 0


_REFERENCE_COMPARISON_PROMPT = """\
You are an expert PCB design reviewer. Compare the user's design against
known-good reference designs and identify important differences.

## User's Design
{board_json}

## Reference Design(s)
{reference_json}

For each major interface in the design (USB, Ethernet, DDR, power, etc.):
1. Identify the closest matching reference design (TI eval boards, ST Nucleo, etc.)
2. Compare topology, component selection, impedance, protection, and decoupling
3. Flag differences that could cause functional issues

Common reference design patterns to check:
- USB 2.0: 90 ohm diff pair, series 22R resistors, ESD TVS (USBLC6-2SC6), AC coupling caps for USB-C
- USB 3.0: 85 ohm diff pair, separate AC coupling, ESD on both USB2 and USB3 pairs
- Ethernet 100BASE-TX: 100 ohm diff pair, Bob Smith termination, magnetics/transformer
- DDR4: 40 ohm single-ended, address/cmd 50 ohm, VTT termination, fly-by topology
- HDMI: 100 ohm diff pair, ESD protection, AC coupling capacitors
- SPI Flash: series resistors for noise, decoupling on VCC, ground guard

Return JSON:
{{
  "reference_used": "TI TIDA-010210 USB Type-C reference design",
  "match_score": 72.0,
  "similarities": [
    {{"aspect": "USB diff pair routing", "description": "Correct 90 ohm impedance target", "confidence": 0.95}}
  ],
  "differences": [
    {{
      "aspect": "USB ESD protection",
      "user_design_value": "No ESD protection on USB data lines",
      "reference_value": "USBLC6-2SC6 on D+/D-, TPD2E2U06 on CC1/CC2",
      "significance": "USB connector exposed to ESD events. IEC 61000-4-2 Level 4 requires +/-8kV contact discharge protection.",
      "severity": "critical",
      "recommendation": "Add USBLC6-2SC6 ESD protection near USB connector. Place within 5mm of connector pads."
    }},
    {{
      "aspect": "USB diff pair impedance",
      "user_design_value": "85 ohm differential impedance",
      "reference_value": "90 ohm +/- 10% per USB 2.0 specification",
      "significance": "5.6% deviation from spec. May cause signal integrity issues at USB 2.0 HS (480Mbps).",
      "severity": "warning",
      "recommendation": "Adjust trace width to achieve 90 ohm differential impedance. With your stackup, use 0.12mm trace / 0.15mm gap."
    }}
  ],
  "summary": "Design compared against TI USB Type-C reference. 3 critical differences found...",
  "critical_differences": 1,
  "warnings": 2
}}
"""

# Built-in reference design knowledge base
_BUILT_IN_REFERENCES: dict[str, dict[str, Any]] = {
    "usb2": {
        "name": "USB 2.0 Reference (TI TUSB321 eval)",
        "impedance_ohm": 90.0,
        "tolerance_pct": 10.0,
        "required_components": ["ESD protection (USBLC6-2SC6)", "Series 22R resistors on D+/D-"],
        "optional_components": ["Common-mode choke", "AC coupling caps for Type-C"],
        "layout_rules": ["Keep diff pair length matched to <2mm", "90 ohm +/-10%", "Route on surface layer"],
    },
    "usb3": {
        "name": "USB 3.x SuperSpeed Reference",
        "impedance_ohm": 85.0,
        "tolerance_pct": 10.0,
        "required_components": ["ESD on USB2 pair", "ESD on USB3 TX/RX pairs", "AC coupling caps"],
        "layout_rules": ["85 ohm diff pair", "Length match TX/RX pairs to <5mil", "Minimize via transitions"],
    },
    "ethernet_100base": {
        "name": "100BASE-TX Ethernet Reference",
        "impedance_ohm": 100.0,
        "required_components": ["Magnetics/transformer", "Bob Smith termination (75R to chassis GND)"],
        "layout_rules": ["100 ohm diff pair", "Keep magnetics close to PHY", "Separate analog/digital ground"],
    },
    "ddr4": {
        "name": "DDR4 Reference (Micron TN-40-27)",
        "impedance_single_ohm": 40.0,
        "impedance_diff_ohm": 80.0,
        "required_components": ["VTT termination resistors", "Bulk decoupling on VDD", "Per-byte VREF decoupling"],
        "layout_rules": ["Fly-by topology for address/command", "T-branch for clock", "Length match within byte lane to <5mm"],
    },
    "spi_flash": {
        "name": "SPI Flash Reference Design",
        "required_components": ["100nF decoupling on VCC", "Series resistors on CLK/MOSI (22-33R)"],
        "layout_rules": ["Keep traces short (<50mm)", "Decoupling within 3mm of flash VCC pin"],
    },
}


async def compare_to_reference(
    board_context: dict,
    reference_designs: list[dict] | None = None,
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> ComparisonReport:
    """Compare a user's design to known-good reference designs.

    Identifies similarities and differences between the user's design
    and industry reference designs (eval boards, application notes).
    Highlights deviations that could cause functional or reliability issues.

    Args:
        board_context: User's board design including components, nets,
            impedances, and layout information.
        reference_designs: Optional list of reference design dicts. If None,
            uses built-in reference knowledge base.
        primary_agent: Primary LLM agent.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        ComparisonReport with similarities, differences, and recommendations.
    """
    if reference_designs is None:
        reference_designs = _detect_applicable_references(board_context)

    if primary_agent is None:
        return _reference_heuristic_comparison(board_context, reference_designs)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _REFERENCE_COMPARISON_PROMPT.format(
        board_json=json.dumps(board_context, indent=2, default=str)[:6000],
        reference_json=json.dumps(reference_designs, indent=2, default=str)[:4000],
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM reference comparison failed (%s), using heuristic", exc)
        return _reference_heuristic_comparison(board_context, reference_designs)

    similarities = [
        DesignSimilarity(
            aspect=s.get("aspect", ""),
            description=s.get("description", ""),
            confidence=float(s.get("confidence", 0.9)),
        )
        for s in data.get("similarities", [])
    ]

    differences = [
        DesignDifference(
            aspect=d.get("aspect", ""),
            user_design_value=d.get("user_design_value", ""),
            reference_value=d.get("reference_value", ""),
            significance=d.get("significance", ""),
            severity=d.get("severity", "warning"),
            recommendation=d.get("recommendation", ""),
        )
        for d in data.get("differences", [])
    ]

    critical = len([d for d in differences if d.severity == "critical"])
    warnings = len([d for d in differences if d.severity == "warning"])

    return ComparisonReport(
        reference_used=data.get("reference_used", "Multiple references"),
        match_score=float(data.get("match_score", 0)),
        similarities=similarities,
        differences=differences,
        summary=data.get("summary", f"{len(differences)} differences found"),
        critical_differences=int(data.get("critical_differences", critical)),
        warnings=int(data.get("warnings", warnings)),
    )


def _detect_applicable_references(board_context: dict) -> list[dict]:
    """Detect which reference designs apply based on the board's interfaces."""
    applicable = []
    nets = board_context.get("nets", [])
    components = board_context.get("components", [])

    all_text = json.dumps(nets + components, default=str).lower()

    if re.search(r"usb.*3|ss_tx|ss_rx|superspeed", all_text):
        applicable.append(_BUILT_IN_REFERENCES["usb3"])
    elif re.search(r"usb|d\+|d\-|vbus", all_text):
        applicable.append(_BUILT_IN_REFERENCES["usb2"])

    if re.search(r"ethernet|mdi|phy|rmii|rgmii|100base|1000base", all_text):
        applicable.append(_BUILT_IN_REFERENCES["ethernet_100base"])

    if re.search(r"ddr4|ddr3|vddq|dqs|addr.*ddr", all_text):
        applicable.append(_BUILT_IN_REFERENCES["ddr4"])

    if re.search(r"spi.*flash|w25q|at25|mx25|is25|gd25", all_text):
        applicable.append(_BUILT_IN_REFERENCES["spi_flash"])

    if not applicable:
        applicable.append({"name": "General PCB design best practices", "notes": "No specific interface reference matched"})

    return applicable


def _reference_heuristic_comparison(
    board_context: dict, reference_designs: list[dict]
) -> ComparisonReport:
    """Heuristic reference comparison without LLM."""
    similarities: list[DesignSimilarity] = []
    differences: list[DesignDifference] = []

    nets = board_context.get("nets", [])
    components = board_context.get("components", [])
    net_names = [n.get("name", "") for n in nets]
    comp_values = [(c.get("reference", ""), c.get("value", ""), c.get("description", "")) for c in components]
    all_text = " ".join(net_names).lower()
    all_comp_text = json.dumps(comp_values, default=str).lower()

    ref_names = []

    for ref_design in reference_designs:
        ref_name = ref_design.get("name", "Unknown reference")
        ref_names.append(ref_name)

        # Check required components
        for req in ref_design.get("required_components", []):
            req_lower = req.lower()
            if "esd" in req_lower:
                has_esd = re.search(r"esd|tvs|usblc|pesd|tpd", all_comp_text)
                if has_esd:
                    similarities.append(DesignSimilarity(
                        aspect=f"ESD protection ({ref_name})",
                        description=f"Design includes ESD protection as recommended",
                    ))
                else:
                    differences.append(DesignDifference(
                        aspect="ESD protection",
                        user_design_value="No ESD protection detected",
                        reference_value=req,
                        significance="Missing ESD protection on external interfaces can cause field failures",
                        severity="critical",
                        recommendation=f"Add ESD protection as specified in {ref_name}",
                    ))
            elif "series" in req_lower and ("resistor" in req_lower or "22r" in req_lower or "33r" in req_lower):
                # Check for series resistors on relevant lines
                has_series_r = any(
                    ref.startswith("R") and re.search(r"22|33|27", val)
                    for ref, val, desc in comp_values
                    if ref.startswith("R")
                )
                if has_series_r:
                    similarities.append(DesignSimilarity(
                        aspect=f"Series termination ({ref_name})",
                        description="Series resistors present for signal termination",
                    ))
                else:
                    differences.append(DesignDifference(
                        aspect="Series termination resistors",
                        user_design_value="No series resistors detected on high-speed outputs",
                        reference_value=req,
                        significance="Missing series termination can cause reflections and EMI",
                        severity="warning",
                        recommendation="Add series resistors (22-33 ohm) near source driver",
                    ))

        # Check impedance targets
        target_z0 = ref_design.get("impedance_ohm")
        if target_z0:
            similarities.append(DesignSimilarity(
                aspect=f"Impedance target ({ref_name})",
                description=f"Reference specifies {target_z0} ohm. Verify your stackup achieves this.",
                confidence=0.7,
            ))

    critical_count = len([d for d in differences if d.severity == "critical"])
    warning_count = len([d for d in differences if d.severity == "warning"])
    match_score = max(0.0, 100.0 - critical_count * 20.0 - warning_count * 8.0)

    return ComparisonReport(
        reference_used=", ".join(ref_names) if ref_names else "Built-in references",
        match_score=match_score,
        similarities=similarities,
        differences=differences,
        summary=(
            f"Heuristic comparison against {len(reference_designs)} reference(s). "
            f"{len(similarities)} matches, {len(differences)} differences "
            f"({critical_count} critical, {warning_count} warnings). Score: {match_score:.0f}/100."
        ),
        critical_differences=critical_count,
        warnings=warning_count,
    )


# ===================================================================
# V13: MultiBoardSystemReviewer
# ===================================================================

class CrossBoardIssueType(str, Enum):
    """Types of cross-board issues."""
    PINOUT_MISMATCH = "pinout_mismatch"
    VOLTAGE_INCOMPATIBILITY = "voltage_incompatibility"
    POWER_BUDGET_EXCEEDED = "power_budget_exceeded"
    SIGNAL_INTEGRITY = "signal_integrity"
    IMPEDANCE_MISMATCH = "impedance_mismatch"
    PROTOCOL_MISMATCH = "protocol_mismatch"
    GROUNDING = "grounding"
    EMC = "emc"


class CrossBoardIssue(BaseModel):
    """An issue found at a board-to-board interface."""
    board_a: str = Field(description="Name/ID of first board")
    board_b: str = Field(description="Name/ID of second board")
    connector: str = Field(description="Connector reference at the interface")
    issue_type: str = Field(description="pinout_mismatch/voltage_incompatibility/power_budget_exceeded/signal_integrity/impedance_mismatch/protocol_mismatch/grounding/emc")
    severity: str = Field(default="warning", description="critical/warning/info")
    description: str = Field(description="Detailed description of the issue")
    fix_suggestion: str = Field(description="How to fix it")


class PowerBudgetEntry(BaseModel):
    """Power budget for a single rail across the system."""
    rail_name: str
    total_supply_w: float = 0.0
    total_consumption_w: float = 0.0
    margin_w: float = 0.0
    margin_pct: float = 0.0
    sources: list[str] = Field(default_factory=list, description="Board(s) supplying this rail")
    consumers: list[str] = Field(default_factory=list, description="Board(s) consuming from this rail")
    status: str = Field(default="ok", description="ok/warning/critical")


class SignalIssue(BaseModel):
    """A signal integrity issue at a board-to-board connector."""
    signal_name: str
    board_a: str
    board_b: str
    connector: str
    issue: str
    recommendation: str


class SystemReviewReport(BaseModel):
    """Complete multi-board system review report."""
    boards_analyzed: list[str] = Field(default_factory=list)
    cross_board_issues: list[CrossBoardIssue] = Field(default_factory=list)
    power_budget: list[PowerBudgetEntry] = Field(default_factory=list)
    signal_issues: list[SignalIssue] = Field(default_factory=list)
    total_issues: int = 0
    critical_count: int = 0
    summary: str = ""


_SYSTEM_REVIEW_PROMPT = """\
You are an expert multi-board PCB system engineer. Review the following
multi-board system for cross-board interface issues.

## Boards
{boards_json}

## Board-to-Board Connections
{connections_json}

Check for ALL of these cross-board issues:

1. **Connector pinout matching**: Verify that mating connectors have compatible pinouts.
   Pin 1 on board A's connector must connect to the correct pin on board B.
   Check for swapped TX/RX, swapped differential pairs, or mirrored pinouts.

2. **Voltage compatibility**: At each board boundary:
   - I/O voltage levels must be compatible (e.g., 3.3V logic driving 1.8V input = damage risk)
   - Power rails crossing boards must have correct voltage and adequate current capacity
   - Level shifters needed where voltage domains differ

3. **Power budget across boards**:
   - Sum all power consumption per rail across all boards
   - Verify the power source can supply total current
   - Check connector current rating vs actual current
   - Include margin (recommend 20% minimum)

4. **Signal integrity at connectors**:
   - High-speed signals crossing connectors need impedance-controlled connector
   - Connector inductance adds discontinuity
   - Differential pairs must maintain pairing through connector
   - Return path continuity through ground pins

Return JSON:
{{
  "boards_analyzed": ["main_board", "sensor_board", "display_board"],
  "cross_board_issues": [
    {{
      "board_a": "main_board",
      "board_b": "sensor_board",
      "connector": "J5-J10",
      "issue_type": "voltage_incompatibility",
      "severity": "critical",
      "description": "Main board drives SPI_CLK at 3.3V but sensor board I/O is 1.8V. Maximum input voltage on sensor IC is 2.0V.",
      "fix_suggestion": "Add bidirectional level shifter (TXB0104) between boards, or configure main board SPI to 1.8V I/O bank."
    }}
  ],
  "power_budget": [
    {{
      "rail_name": "3V3",
      "total_supply_w": 3.0,
      "total_consumption_w": 2.4,
      "margin_w": 0.6,
      "margin_pct": 20.0,
      "sources": ["main_board (LDO U3: 3.3V/1A)"],
      "consumers": ["main_board (1.5W)", "sensor_board (0.6W via J5)", "display_board (0.3W via J8)"],
      "status": "ok"
    }}
  ],
  "signal_issues": [
    {{
      "signal_name": "SPI_CLK",
      "board_a": "main_board",
      "board_b": "sensor_board",
      "connector": "J5-J10",
      "issue": "40MHz SPI clock crosses 10cm cable. Connector adds ~2nH inductance, creating impedance discontinuity.",
      "recommendation": "Use series termination (33R) at source. Keep cable under 5cm or reduce SPI clock to 20MHz."
    }}
  ],
  "total_issues": 5,
  "critical_count": 1,
  "summary": "3 boards analyzed. 5 cross-board issues (1 critical). Power budget OK with 20% margin."
}}
"""


async def review_system(
    boards: list[dict],
    connections: list[dict],
    primary_agent: Any = None,
    secondary_agent: Any | None = None,
) -> SystemReviewReport:
    """Review a multi-board system for cross-board interface issues.

    Performs cross-board verification including connector pinout matching,
    voltage compatibility at board boundaries, power budget across boards,
    and signal integrity at connectors.

    Args:
        boards: List of board design dicts, each with name, components,
            nets, power_rails, and connector definitions.
        connections: List of board-to-board connection dicts, each
            specifying which connectors on which boards mate together,
            and pin mappings.
        primary_agent: Primary LLM agent.
        secondary_agent: Optional fallback LLM agent.

    Returns:
        SystemReviewReport with cross-board issues, power budget, and
        signal integrity findings.
    """
    if primary_agent is None:
        return _system_heuristic_review(boards, connections)

    llm = DualProviderLLM(primary_agent, secondary_agent)

    prompt = _SYSTEM_REVIEW_PROMPT.format(
        boards_json=json.dumps(boards, indent=2, default=str)[:8000],
        connections_json=json.dumps(connections, indent=2, default=str)[:4000],
    )

    try:
        data = await llm.call(prompt)
    except Exception as exc:
        logger.warning("LLM system review failed (%s), using heuristic", exc)
        return _system_heuristic_review(boards, connections)

    cross_board_issues = [
        CrossBoardIssue(
            board_a=i.get("board_a", ""),
            board_b=i.get("board_b", ""),
            connector=i.get("connector", ""),
            issue_type=i.get("issue_type", "signal_integrity"),
            severity=i.get("severity", "warning"),
            description=i.get("description", ""),
            fix_suggestion=i.get("fix_suggestion", ""),
        )
        for i in data.get("cross_board_issues", [])
    ]

    power_budget = [
        PowerBudgetEntry(
            rail_name=p.get("rail_name", ""),
            total_supply_w=float(p.get("total_supply_w", 0)),
            total_consumption_w=float(p.get("total_consumption_w", 0)),
            margin_w=float(p.get("margin_w", 0)),
            margin_pct=float(p.get("margin_pct", 0)),
            sources=p.get("sources", []),
            consumers=p.get("consumers", []),
            status=p.get("status", "ok"),
        )
        for p in data.get("power_budget", [])
    ]

    signal_issues = [
        SignalIssue(
            signal_name=s.get("signal_name", ""),
            board_a=s.get("board_a", ""),
            board_b=s.get("board_b", ""),
            connector=s.get("connector", ""),
            issue=s.get("issue", ""),
            recommendation=s.get("recommendation", ""),
        )
        for s in data.get("signal_issues", [])
    ]

    total = len(cross_board_issues) + len(signal_issues)
    critical = len([i for i in cross_board_issues if i.severity == "critical"])

    return SystemReviewReport(
        boards_analyzed=data.get("boards_analyzed", [b.get("name", f"board_{i}") for i, b in enumerate(boards)]),
        cross_board_issues=cross_board_issues,
        power_budget=power_budget,
        signal_issues=signal_issues,
        total_issues=int(data.get("total_issues", total)),
        critical_count=int(data.get("critical_count", critical)),
        summary=data.get("summary", f"{total} issues found across {len(boards)} boards"),
    )


def _system_heuristic_review(
    boards: list[dict], connections: list[dict]
) -> SystemReviewReport:
    """Heuristic multi-board system review without LLM."""
    board_names = [b.get("name", b.get("id", f"board_{i}")) for i, b in enumerate(boards)]
    cross_board_issues: list[CrossBoardIssue] = []
    power_entries: list[PowerBudgetEntry] = []
    signal_issues: list[SignalIssue] = []

    # Build power rail inventory per board
    rail_supply: dict[str, list[tuple[str, float]]] = {}  # rail -> [(board_name, supply_w)]
    rail_consumption: dict[str, list[tuple[str, float]]] = {}  # rail -> [(board_name, consume_w)]

    for board in boards:
        bname = board.get("name", board.get("id", "unknown"))

        for rail in board.get("power_rails", []):
            rail_name = rail.get("name", rail.get("net", ""))
            supply = float(rail.get("supply_w", rail.get("source_w", 0)))
            consume = float(rail.get("consumption_w", rail.get("load_w", 0)))

            if supply > 0:
                rail_supply.setdefault(rail_name, []).append((bname, supply))
            if consume > 0:
                rail_consumption.setdefault(rail_name, []).append((bname, consume))

        # Check I/O voltage levels
        io_voltage = float(board.get("io_voltage", board.get("vddio", 3.3)))
        board["_io_voltage"] = io_voltage

    # Check connections
    for conn in connections:
        board_a_name = conn.get("board_a", conn.get("from_board", ""))
        board_b_name = conn.get("board_b", conn.get("to_board", ""))
        connector = conn.get("connector", conn.get("connector_pair", ""))

        board_a = next((b for b in boards if b.get("name", b.get("id", "")) == board_a_name), None)
        board_b = next((b for b in boards if b.get("name", b.get("id", "")) == board_b_name), None)

        if board_a is None or board_b is None:
            continue

        # Voltage compatibility check
        va = float(board_a.get("_io_voltage", 3.3))
        vb = float(board_b.get("_io_voltage", 3.3))

        if abs(va - vb) > 0.3:
            severity = "critical" if abs(va - vb) > 1.0 else "warning"
            cross_board_issues.append(CrossBoardIssue(
                board_a=board_a_name,
                board_b=board_b_name,
                connector=connector,
                issue_type="voltage_incompatibility",
                severity=severity,
                description=(
                    f"I/O voltage mismatch: {board_a_name} operates at {va}V, "
                    f"{board_b_name} at {vb}V. Signals crossing {connector} may be "
                    f"{'out of absolute maximum ratings' if abs(va - vb) > 1.0 else 'near threshold margins'}."
                ),
                fix_suggestion=(
                    f"Add level shifter (e.g., TXB0104 or TXS0108) at {connector} "
                    f"to translate between {va}V and {vb}V domains."
                ),
            ))

        # Pin mapping check
        pin_map = conn.get("pin_mapping", conn.get("pins", {}))
        if isinstance(pin_map, dict):
            for pin_a, pin_b in pin_map.items():
                signal_a = str(pin_a)
                signal_b = str(pin_b)
                # Check for swapped TX/RX
                if ("TX" in signal_a.upper() and "TX" in signal_b.upper()) or \
                   ("RX" in signal_a.upper() and "RX" in signal_b.upper()):
                    cross_board_issues.append(CrossBoardIssue(
                        board_a=board_a_name,
                        board_b=board_b_name,
                        connector=connector,
                        issue_type="pinout_mismatch",
                        severity="critical",
                        description=(
                            f"TX-TX or RX-RX connection detected: {signal_a} on {board_a_name} "
                            f"mapped to {signal_b} on {board_b_name}. TX should connect to RX."
                        ),
                        fix_suggestion=(
                            f"Swap connections so TX on {board_a_name} connects to RX on "
                            f"{board_b_name} and vice versa."
                        ),
                    ))

        # High-speed signal check
        hs_signals = conn.get("high_speed_signals", [])
        for sig in hs_signals:
            sig_name = sig if isinstance(sig, str) else sig.get("name", "")
            freq_mhz = float(sig.get("freq_mhz", 100)) if isinstance(sig, dict) else 100.0
            if freq_mhz > 25:
                signal_issues.append(SignalIssue(
                    signal_name=sig_name,
                    board_a=board_a_name,
                    board_b=board_b_name,
                    connector=connector,
                    issue=(
                        f"{sig_name} at {freq_mhz:.0f}MHz crosses board-to-board connector. "
                        f"Connector parasitics (~1-3nH inductance) create impedance discontinuity."
                    ),
                    recommendation=(
                        f"Use impedance-controlled connector for {sig_name}. "
                        f"Add series termination (22-33R) at source. "
                        f"Minimize cable/connector length."
                    ),
                ))

        # Ground pin count check
        gnd_pins = int(conn.get("ground_pins", conn.get("gnd_pin_count", 0)))
        total_pins = int(conn.get("total_pins", conn.get("pin_count", 0)))
        if total_pins > 0 and gnd_pins > 0:
            gnd_ratio = gnd_pins / total_pins
            if gnd_ratio < 0.15 and total_pins > 10:
                cross_board_issues.append(CrossBoardIssue(
                    board_a=board_a_name,
                    board_b=board_b_name,
                    connector=connector,
                    issue_type="grounding",
                    severity="warning",
                    description=(
                        f"Only {gnd_pins}/{total_pins} ground pins ({gnd_ratio*100:.0f}%) in {connector}. "
                        f"Recommend >15% ground pins for return current path continuity."
                    ),
                    fix_suggestion=(
                        f"Add ground pins to {connector}. Interleave ground pins among signal pins "
                        f"for better return path. Place ground pins adjacent to high-speed signals."
                    ),
                ))

    # Build power budget entries
    all_rails = set(list(rail_supply.keys()) + list(rail_consumption.keys()))
    for rail_name in sorted(all_rails):
        supplies = rail_supply.get(rail_name, [])
        consumers = rail_consumption.get(rail_name, [])
        total_supply = sum(w for _, w in supplies)
        total_consume = sum(w for _, w in consumers)
        margin = total_supply - total_consume
        margin_pct = (margin / total_supply * 100.0) if total_supply > 0 else 0.0

        if margin_pct < 10:
            status = "critical"
        elif margin_pct < 20:
            status = "warning"
        else:
            status = "ok"

        if status != "ok":
            cross_board_issues.append(CrossBoardIssue(
                board_a=supplies[0][0] if supplies else "unknown",
                board_b=consumers[0][0] if consumers else "unknown",
                connector="power distribution",
                issue_type="power_budget_exceeded",
                severity=status,
                description=(
                    f"Power rail {rail_name}: {total_consume:.2f}W consumed vs {total_supply:.2f}W available. "
                    f"Margin: {margin_pct:.0f}% ({'insufficient' if status == 'critical' else 'low'})."
                ),
                fix_suggestion=(
                    f"{'Increase power supply capacity or reduce load on ' if status == 'critical' else 'Monitor closely: '}"
                    f"{rail_name}. Recommend minimum 20% margin."
                ),
            ))

        power_entries.append(PowerBudgetEntry(
            rail_name=rail_name,
            total_supply_w=round(total_supply, 3),
            total_consumption_w=round(total_consume, 3),
            margin_w=round(margin, 3),
            margin_pct=round(margin_pct, 1),
            sources=[f"{name} ({w:.2f}W)" for name, w in supplies],
            consumers=[f"{name} ({w:.2f}W)" for name, w in consumers],
            status=status,
        ))

    total_issues = len(cross_board_issues) + len(signal_issues)
    critical = len([i for i in cross_board_issues if i.severity == "critical"])

    return SystemReviewReport(
        boards_analyzed=board_names,
        cross_board_issues=cross_board_issues,
        power_budget=power_entries,
        signal_issues=signal_issues,
        total_issues=total_issues,
        critical_count=critical,
        summary=(
            f"Heuristic review of {len(boards)} boards, {len(connections)} connections. "
            f"{total_issues} issues ({critical} critical). "
            f"{len(power_entries)} power rails checked."
        ),
    )
