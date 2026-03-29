"""Schematic Intelligence Features S1-S5.

Five LLM-powered features for advanced schematic analysis and synthesis:
  S1: DatasheetCircuitSynthesizer  - NL description -> complete circuit with MPNs
  S2: CrossDatasheetAnalyzer       - IC-to-IC compatibility checking
  S3: IntentPreservingRefactorer   - Topology changes with impact analysis
  S4: PowerBudgetAnalyzer          - Power tree analysis per operating mode
  S5: SemanticERC                  - Function-aware electrical rule checking

Each class works standalone with just an LLM API key (Gemini or Anthropic).
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared LLM call mixin
# ---------------------------------------------------------------------------


class _LLMClientMixin:
    """Provides a dual-provider LLM call method (Gemini / Anthropic)."""

    async def _llm_call(self, prompt: str, system: str = "") -> str:
        """Call LLM - supports Gemini and Anthropic.

        Checks for GEMINI_API_KEY / GOOGLE_API_KEY first, then
        ANTHROPIC_API_KEY.  Returns the raw text response.
        """
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            from google import genai  # type: ignore[import-untyped]

            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"{system}\n\n{prompt}",
            )
            return response.text

        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if api_key:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=api_key)
            r = await client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            return r.content[0].text

        raise RuntimeError(
            "No LLM API key found. Set GEMINI_API_KEY or ANTHROPIC_API_KEY"
        )

    @staticmethod
    def _parse_json(text: str) -> dict[str, Any]:
        """Extract JSON from LLM output, stripping markdown fences."""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            first_nl = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_nl + 1 :]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(cleaned[start : end + 1])
                except json.JSONDecodeError:
                    pass
            logger.warning("Failed to parse JSON from LLM output")
            return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}

    @staticmethod
    def _parse_json_array(text: str) -> list[dict[str, Any]]:
        """Extract a JSON array from LLM output."""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            first_nl = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_nl + 1 :]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start : end + 1])
                if isinstance(result, list):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("Failed to parse JSON array from LLM output")
        return []


# ===========================================================================
# S1: DatasheetCircuitSynthesizer
# ===========================================================================


@dataclass
class SynthesizedComponent:
    """A component in a synthesized circuit."""

    reference: str = ""
    mpn: str = ""
    manufacturer: str = ""
    value: str = ""
    footprint: str = ""
    description: str = ""
    datasheet_citation: str = ""


@dataclass
class SynthesizedConnection:
    """A connection between two pins in the synthesized circuit."""

    from_ref: str = ""
    from_pin: str = ""
    to_ref: str = ""
    to_pin: str = ""
    net_name: str = ""


@dataclass
class CircuitConstraint:
    """A design constraint for the synthesized circuit."""

    type: str = ""  # impedance, placement, width, thermal, etc.
    description: str = ""
    parameter: str = ""
    value: str = ""
    priority: str = "required"


@dataclass
class CircuitSynthesisResult:
    """Result of S1 circuit synthesis."""

    components: list[SynthesizedComponent] = field(default_factory=list)
    connections: list[SynthesizedConnection] = field(default_factory=list)
    constraints: list[CircuitConstraint] = field(default_factory=list)
    bom_cost_estimate: float = 0.0
    citations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    explanation: str = ""
    error: str = ""


class DatasheetCircuitSynthesizer(_LLMClientMixin):
    """S1: Synthesize complete circuits from natural-language descriptions.

    Parses descriptions like "USB-C PD sink 20V/3A with FUSB302B" and
    generates a full circuit with components (MPNs), connections, values,
    constraints, BOM cost estimate, and datasheet citations.
    """

    async def synthesize_circuit(
        self,
        description: str,
        component_mpn: str | None = None,
    ) -> CircuitSynthesisResult:
        """Synthesize a complete circuit from a natural-language description.

        Args:
            description: Natural-language circuit description, e.g.
                "USB-C PD sink 20V/3A with FUSB302B".
            component_mpn: Optional primary component MPN to centre the
                design around.

        Returns:
            CircuitSynthesisResult with components, connections, constraints,
            BOM cost estimate, citations, and confidence score.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(description, component_mpn)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)

            if "_parse_error" in parsed:
                return CircuitSynthesisResult(error=f"LLM response parse error: {raw[:500]}")

            return self._map_result(parsed)
        except Exception as exc:
            logger.error("synthesize_circuit failed: %s", exc)
            return CircuitSynthesisResult(error=str(exc))

    # -- prompt builders -----------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert electronics design engineer with deep knowledge of "
            "component datasheets, application circuits, and PCB design best practices.\n\n"
            "When given a circuit description, you produce a COMPLETE circuit design as "
            "structured JSON. Every component must include a real manufacturer part number "
            "(MPN), value, footprint, and a datasheet citation explaining why that "
            "component and value were chosen.\n\n"
            "Your output MUST be valid JSON with these top-level keys:\n"
            "  components: [{reference, mpn, manufacturer, value, footprint, description, datasheet_citation}]\n"
            "  connections: [{from_ref, from_pin, to_ref, to_pin, net_name}]\n"
            "  constraints: [{type, description, parameter, value, priority}]\n"
            "  bom_cost_estimate: <float USD>\n"
            "  citations: [<string>]  -- all datasheet / app-note references used\n"
            "  confidence: <float 0-1>\n"
            "  explanation: <string>  -- plain-English design rationale\n\n"
            "Rules:\n"
            "- Use real, commercially available MPNs (e.g. 'RC0402FR-0710KL', not '10k resistor').\n"
            "- Include ALL support components: decoupling caps, pull-ups, ferrites, ESD, etc.\n"
            "- Connections must fully specify pin names from the IC datasheet.\n"
            "- Constraints must cover placement, impedance, thermal, and width requirements.\n"
            "- Cite the specific datasheet section for each component value choice.\n"
            "- Estimate BOM cost per unit at 1k quantity.\n"
            "- Output ONLY the JSON object, no markdown fences, no commentary."
        )

    @staticmethod
    def _build_prompt(description: str, component_mpn: str | None) -> str:
        parts = [f"Design a complete circuit for: {description}"]
        if component_mpn:
            parts.append(
                f"\nThe design MUST use {component_mpn} as the primary active component. "
                f"Refer to the {component_mpn} datasheet for the recommended application "
                f"circuit and component values."
            )
        parts.append(
            "\nProvide ALL required support components (decoupling capacitors on every "
            "power pin, pull-up/pull-down resistors as required by the datasheet, "
            "input/output capacitors, ESD protection for external interfaces, "
            "ferrite beads or inductors for power filtering, test points for "
            "critical signals)."
        )
        parts.append(
            "\nFor every component value, cite the datasheet section or application "
            "note that specifies or recommends that value."
        )
        return "\n".join(parts)

    # -- result mapper -------------------------------------------------------

    @staticmethod
    def _map_result(data: dict[str, Any]) -> CircuitSynthesisResult:
        components = []
        for c in data.get("components", []):
            components.append(
                SynthesizedComponent(
                    reference=c.get("reference", ""),
                    mpn=c.get("mpn", ""),
                    manufacturer=c.get("manufacturer", ""),
                    value=c.get("value", ""),
                    footprint=c.get("footprint", ""),
                    description=c.get("description", ""),
                    datasheet_citation=c.get("datasheet_citation", ""),
                )
            )

        connections = []
        for cn in data.get("connections", []):
            connections.append(
                SynthesizedConnection(
                    from_ref=cn.get("from_ref", ""),
                    from_pin=cn.get("from_pin", ""),
                    to_ref=cn.get("to_ref", ""),
                    to_pin=cn.get("to_pin", ""),
                    net_name=cn.get("net_name", ""),
                )
            )

        constraints = []
        for cs in data.get("constraints", []):
            constraints.append(
                CircuitConstraint(
                    type=cs.get("type", ""),
                    description=cs.get("description", ""),
                    parameter=cs.get("parameter", ""),
                    value=cs.get("value", ""),
                    priority=cs.get("priority", "required"),
                )
            )

        return CircuitSynthesisResult(
            components=components,
            connections=connections,
            constraints=constraints,
            bom_cost_estimate=float(data.get("bom_cost_estimate", 0.0)),
            citations=data.get("citations", []),
            confidence=float(data.get("confidence", 0.0)),
            explanation=data.get("explanation", ""),
        )


# ===========================================================================
# S2: CrossDatasheetAnalyzer
# ===========================================================================


@dataclass
class CompatibilityIssue:
    """A single compatibility issue between two ICs."""

    parameter: str = ""
    ic_a_value: str = ""
    ic_b_value: str = ""
    requirement: str = ""
    violation_description: str = ""
    severity: str = "error"  # error, warning, info
    datasheet_refs: list[str] = field(default_factory=list)


@dataclass
class CompatibilityReport:
    """Result of S2 cross-datasheet compatibility check."""

    compatible: bool = True
    issues: list[CompatibilityIssue] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    timing_analysis: dict[str, Any] = field(default_factory=dict)
    voltage_analysis: dict[str, Any] = field(default_factory=dict)
    power_sequencing: dict[str, Any] = field(default_factory=dict)
    citations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    error: str = ""


class CrossDatasheetAnalyzer(_LLMClientMixin):
    """S2: Check electrical compatibility between two ICs.

    Analyses voltage levels, timing parameters, drive strength, and power
    sequencing requirements by cross-referencing both component datasheets.
    """

    async def check_compatibility(
        self,
        component_a: str,
        component_b: str,
        interface_type: str,
        board_context: dict[str, Any] | None = None,
    ) -> CompatibilityReport:
        """Check compatibility between two ICs on a given interface.

        Args:
            component_a: MPN or name of the first IC (e.g. "STM32F103C8T6").
            component_b: MPN or name of the second IC (e.g. "W25Q128JVSIQ").
            interface_type: Interface connecting them (e.g. "SPI", "I2C",
                "UART", "parallel", "SDIO").
            board_context: Optional dict with board-level info such as
                supply voltage, pull-up values, trace length, temperature.

        Returns:
            CompatibilityReport with issues, timing/voltage analysis, and
            citations.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(component_a, component_b, interface_type, board_context)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)

            if "_parse_error" in parsed:
                return CompatibilityReport(
                    compatible=False,
                    error=f"LLM response parse error: {raw[:500]}",
                )

            return self._map_result(parsed)
        except Exception as exc:
            logger.error("check_compatibility failed: %s", exc)
            return CompatibilityReport(compatible=False, error=str(exc))

    # -- prompt builders -----------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert electronics engineer specialising in IC interface "
            "compatibility analysis. You have memorised the electrical characteristics "
            "tables of thousands of IC datasheets.\n\n"
            "When given two ICs and an interface type, you perform a thorough "
            "compatibility check covering:\n"
            "1. VOLTAGE LEVELS: Compare VOH/VOL of the driver with VIH/VIL of the receiver. "
            "   Check that the driver can actually satisfy the receiver's thresholds.\n"
            "2. TIMING: Compare clock frequency limits, setup/hold times, propagation delays, "
            "   and rise/fall time requirements. Verify timing margins.\n"
            "3. DRIVE STRENGTH: Verify the driver can source/sink enough current for the "
            "   receiver's input current plus any bus pull-ups/pull-downs.\n"
            "4. POWER SEQUENCING: Check if either IC has power-on sequencing requirements "
            "   that affect the interface (e.g., I/O voltage must not exceed VDD+0.3V before "
            "   the IC is powered).\n"
            "5. LOGIC LEVELS: Check 3.3V vs 1.8V vs 5V compatibility, open-drain "
            "   requirements, etc.\n\n"
            "Output MUST be valid JSON with these top-level keys:\n"
            "  compatible: <bool>  -- true only if NO errors found\n"
            "  issues: [{parameter, ic_a_value, ic_b_value, requirement, violation_description, severity, datasheet_refs}]\n"
            "  warnings: [<string>]  -- non-blocking but noteworthy concerns\n"
            "  timing_analysis: {clock_max_mhz, setup_margin_ns, hold_margin_ns, details: <string>}\n"
            "  voltage_analysis: {driver_voh, driver_vol, receiver_vih, receiver_vil, margin_high_mv, margin_low_mv, details: <string>}\n"
            "  power_sequencing: {requirements: [<string>], safe: <bool>}\n"
            "  citations: [<string>]  -- all datasheet references used\n"
            "  confidence: <float 0-1>\n\n"
            "Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(
        component_a: str,
        component_b: str,
        interface_type: str,
        board_context: dict[str, Any] | None,
    ) -> str:
        parts = [
            f"Check compatibility between these two ICs connected via {interface_type}:\n",
            f"IC A (driver/master): {component_a}",
            f"IC B (receiver/slave): {component_b}",
            f"Interface: {interface_type}",
        ]
        if board_context:
            parts.append(f"\nBoard context:\n{json.dumps(board_context, indent=2, default=str)}")
        parts.append(
            "\nPerform a complete voltage level, timing, drive strength, and power "
            "sequencing analysis. For every parameter cite the specific datasheet "
            "section and page where the value is found."
        )
        return "\n".join(parts)

    # -- result mapper -------------------------------------------------------

    @staticmethod
    def _map_result(data: dict[str, Any]) -> CompatibilityReport:
        issues = []
        for iss in data.get("issues", []):
            issues.append(
                CompatibilityIssue(
                    parameter=iss.get("parameter", ""),
                    ic_a_value=str(iss.get("ic_a_value", "")),
                    ic_b_value=str(iss.get("ic_b_value", "")),
                    requirement=iss.get("requirement", ""),
                    violation_description=iss.get("violation_description", ""),
                    severity=iss.get("severity", "error"),
                    datasheet_refs=iss.get("datasheet_refs", []),
                )
            )

        has_error = any(i.severity == "error" for i in issues)

        return CompatibilityReport(
            compatible=data.get("compatible", not has_error),
            issues=issues,
            warnings=data.get("warnings", []),
            timing_analysis=data.get("timing_analysis", {}),
            voltage_analysis=data.get("voltage_analysis", {}),
            power_sequencing=data.get("power_sequencing", {}),
            citations=data.get("citations", []),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# S3: IntentPreservingRefactorer
# ===========================================================================


@dataclass
class RefactorChange:
    """A single change in a refactoring operation."""

    type: str = ""  # add, remove, modify
    component_ref: str = ""
    old_value: str = ""
    new_value: str = ""
    reason: str = ""
    mpn: str = ""
    footprint: str = ""


@dataclass
class ImpactAnalysis:
    """Analysis of one downstream impact of a refactoring change."""

    category: str = ""  # noise, EMI, thermal, cost, size, reliability, performance
    description: str = ""
    severity: str = "info"  # info, warning, error
    mitigation: str = ""


@dataclass
class RefactorResult:
    """Result of S3 intent-preserving refactoring."""

    changes: list[RefactorChange] = field(default_factory=list)
    impact_analysis: list[ImpactAnalysis] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    new_constraints: list[CircuitConstraint] = field(default_factory=list)
    explanation: str = ""
    confidence: float = 0.0
    error: str = ""


class IntentPreservingRefactorer(_LLMClientMixin):
    """S3: Refactor a schematic while preserving design intent.

    Given a high-level change request like "change LDO to buck converter",
    this analyses the current schematic context, determines ALL downstream
    impacts (noise, EMI, thermal, BOM, layout), and produces a complete
    set of changes with impact analysis.
    """

    async def refactor(
        self,
        description: str,
        schematic_context: dict[str, Any],
    ) -> RefactorResult:
        """Refactor a schematic based on a natural-language description.

        Args:
            description: What to change, e.g. "Replace U3 LDO with a buck
                converter to improve efficiency" or "Change the 8MHz crystal
                to a 25MHz MEMS oscillator".
            schematic_context: Current schematic state including components,
                nets, connections, and constraints.

        Returns:
            RefactorResult with ordered changes, impact analysis, warnings,
            and new constraints.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(description, schematic_context)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)

            if "_parse_error" in parsed:
                return RefactorResult(error=f"LLM response parse error: {raw[:500]}")

            return self._map_result(parsed)
        except Exception as exc:
            logger.error("refactor failed: %s", exc)
            return RefactorResult(error=str(exc))

    # -- prompt builders -----------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert electronics design engineer who specialises in "
            "schematic refactoring and design intent preservation.\n\n"
            "When an engineer requests a component or topology change, you must:\n"
            "1. UNDERSTAND the original design intent (what function the current "
            "   circuit provides: voltage regulation, filtering, protection, etc.)\n"
            "2. DETERMINE all changes needed: components to add, remove, or modify.\n"
            "   Include ALL support components (new caps, inductors, feedback "
            "   resistors, etc.).\n"
            "3. ANALYSE downstream impacts:\n"
            "   - Noise: switching noise, output ripple, PSRR changes\n"
            "   - EMI: new radiated emissions from switching converters\n"
            "   - Thermal: changed power dissipation, new hot-spots\n"
            "   - Cost: BOM cost change\n"
            "   - Size: footprint area change\n"
            "   - Reliability: new failure modes, derating concerns\n"
            "   - Performance: efficiency, transient response, accuracy\n"
            "4. PRODUCE new constraints required by the topology change.\n\n"
            "Output MUST be valid JSON with these keys:\n"
            "  changes: [{type, component_ref, old_value, new_value, reason, mpn, footprint}]\n"
            "      type is one of: add, remove, modify\n"
            "  impact_analysis: [{category, description, severity, mitigation}]\n"
            "      category: noise, EMI, thermal, cost, size, reliability, performance\n"
            "      severity: info, warning, error\n"
            "  warnings: [<string>]  -- critical things the engineer must verify\n"
            "  new_constraints: [{type, description, parameter, value, priority}]\n"
            "  explanation: <string>  -- overall rationale\n"
            "  confidence: <float 0-1>\n\n"
            "Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(description: str, schematic_context: dict[str, Any]) -> str:
        # Truncate context to avoid exceeding token limits
        ctx_str = json.dumps(schematic_context, indent=2, default=str)
        if len(ctx_str) > 12000:
            ctx_str = ctx_str[:12000] + "\n... (truncated)"

        return (
            f"Refactoring request: {description}\n\n"
            f"Current schematic context:\n{ctx_str}\n\n"
            "Produce the complete set of changes, impact analysis, warnings, "
            "and new constraints. For every change explain WHY it is needed. "
            "For every impact provide a concrete mitigation strategy."
        )

    # -- result mapper -------------------------------------------------------

    @staticmethod
    def _map_result(data: dict[str, Any]) -> RefactorResult:
        changes = []
        for ch in data.get("changes", []):
            changes.append(
                RefactorChange(
                    type=ch.get("type", ""),
                    component_ref=ch.get("component_ref", ""),
                    old_value=str(ch.get("old_value", "")),
                    new_value=str(ch.get("new_value", "")),
                    reason=ch.get("reason", ""),
                    mpn=ch.get("mpn", ""),
                    footprint=ch.get("footprint", ""),
                )
            )

        impacts = []
        for imp in data.get("impact_analysis", []):
            impacts.append(
                ImpactAnalysis(
                    category=imp.get("category", ""),
                    description=imp.get("description", ""),
                    severity=imp.get("severity", "info"),
                    mitigation=imp.get("mitigation", ""),
                )
            )

        new_constraints = []
        for cs in data.get("new_constraints", []):
            new_constraints.append(
                CircuitConstraint(
                    type=cs.get("type", ""),
                    description=cs.get("description", ""),
                    parameter=cs.get("parameter", ""),
                    value=cs.get("value", ""),
                    priority=cs.get("priority", "required"),
                )
            )

        return RefactorResult(
            changes=changes,
            impact_analysis=impacts,
            warnings=data.get("warnings", []),
            new_constraints=new_constraints,
            explanation=data.get("explanation", ""),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# S4: PowerBudgetAnalyzer
# ===========================================================================


@dataclass
class PowerTreeNode:
    """A node in the power tree."""

    component: str = ""
    type: str = ""  # source, regulator, load
    vin: float = 0.0
    vout: float = 0.0
    current_ma: float = 0.0
    efficiency_pct: float = 100.0
    power_dissipation_mw: float = 0.0
    children: list[PowerTreeNode] = field(default_factory=list)
    notes: str = ""


@dataclass
class ThermalHotspot:
    """A component with notable thermal dissipation."""

    component: str = ""
    power_dissipation_mw: float = 0.0
    junction_temp_estimate_c: float = 0.0
    thermal_resistance_ja: float = 0.0
    severity: str = "info"  # info, warning, critical
    recommendation: str = ""


@dataclass
class PowerBudgetReport:
    """Result of S4 power budget analysis."""

    power_tree: dict[str, Any] = field(default_factory=dict)
    total_current_ma: float = 0.0
    total_power_mw: float = 0.0
    estimated_runtime_hours: float = 0.0
    thermal_hotspots: list[ThermalHotspot] = field(default_factory=list)
    per_mode_summary: dict[str, dict[str, Any]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    confidence: float = 0.0
    error: str = ""


class PowerBudgetAnalyzer(_LLMClientMixin):
    """S4: Analyse power budget from schematic topology.

    Builds a power tree from the schematic, retrieves per-IC current
    consumption from its knowledge of datasheets, calculates cascaded
    efficiency through regulators, estimates battery runtime, and
    identifies thermal hot-spots.
    """

    async def analyze_power_budget(
        self,
        schematic_context: dict[str, Any],
        power_source: str,
        operating_modes: list[str] | None = None,
    ) -> PowerBudgetReport:
        """Analyse power budget for a design.

        Args:
            schematic_context: Schematic dict with components, nets, and
                connections.
            power_source: Description of the power source, e.g.
                "USB 5V/500mA", "Li-Po 3.7V 2000mAh", "12V wall adapter".
            operating_modes: List of operating modes to analyse, e.g.
                ["active", "sleep", "deep_sleep", "transmit"].
                Defaults to ["active", "sleep"].

        Returns:
            PowerBudgetReport with power tree, per-mode current totals,
            runtime estimate, and thermal hot-spots.
        """
        if operating_modes is None:
            operating_modes = ["active", "sleep"]

        system = self._build_system_prompt()
        prompt = self._build_prompt(schematic_context, power_source, operating_modes)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)

            if "_parse_error" in parsed:
                return PowerBudgetReport(error=f"LLM response parse error: {raw[:500]}")

            return self._map_result(parsed)
        except Exception as exc:
            logger.error("analyze_power_budget failed: %s", exc)
            return PowerBudgetReport(error=str(exc))

    # -- prompt builders -----------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert power systems engineer who designs and analyses "
            "power distribution trees for electronic systems.\n\n"
            "Given a schematic and power source, you must:\n"
            "1. BUILD a power tree showing how power flows from the source through "
            "   regulators (LDOs, bucks, boosts) to every load IC.\n"
            "2. For each IC, recall or estimate its current consumption in each "
            "   operating mode from its datasheet. Use typical values.\n"
            "3. CALCULATE cascaded efficiency. If a 90%-efficient buck feeds an "
            "   85%-efficient LDO, the combined efficiency is 76.5%.\n"
            "4. Compute TOTAL current draw at the source for each mode.\n"
            "5. Estimate BATTERY RUNTIME if the source is a battery.\n"
            "6. Identify THERMAL HOTSPOTS: regulators with high (Vin-Vout)*I "
            "   dissipation, especially LDOs. Estimate junction temperature "
            "   using typical theta-JA for the package.\n\n"
            "Output MUST be valid JSON with these keys:\n"
            "  power_tree: {component, type, vin, vout, current_ma, efficiency_pct, power_dissipation_mw, children: [...]}\n"
            "      type: source, regulator, load\n"
            "  total_current_ma: <float>  -- total source current in active mode\n"
            "  total_power_mw: <float>  -- total power from source in active mode\n"
            "  estimated_runtime_hours: <float>  -- 0 if not battery-powered\n"
            "  thermal_hotspots: [{component, power_dissipation_mw, junction_temp_estimate_c, thermal_resistance_ja, severity, recommendation}]\n"
            "  per_mode_summary: {mode_name: {total_current_ma, total_power_mw, estimated_runtime_hours}}\n"
            "  warnings: [<string>]\n"
            "  citations: [<string>]  -- datasheet references for current values\n"
            "  confidence: <float 0-1>\n\n"
            "Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(
        schematic_context: dict[str, Any],
        power_source: str,
        operating_modes: list[str],
    ) -> str:
        ctx_str = json.dumps(schematic_context, indent=2, default=str)
        if len(ctx_str) > 12000:
            ctx_str = ctx_str[:12000] + "\n... (truncated)"

        return (
            f"Analyse the power budget for this design.\n\n"
            f"Power source: {power_source}\n"
            f"Operating modes to analyse: {', '.join(operating_modes)}\n\n"
            f"Schematic:\n{ctx_str}\n\n"
            "Build the complete power tree, calculate per-mode current totals, "
            "estimate runtime if battery-powered, and identify thermal hotspots. "
            "For every IC current value, cite the datasheet section it comes from. "
            "Use TYPICAL values, not maximum."
        )

    # -- result mapper -------------------------------------------------------

    @staticmethod
    def _map_result(data: dict[str, Any]) -> PowerBudgetReport:
        hotspots = []
        for hs in data.get("thermal_hotspots", []):
            hotspots.append(
                ThermalHotspot(
                    component=hs.get("component", ""),
                    power_dissipation_mw=float(hs.get("power_dissipation_mw", 0)),
                    junction_temp_estimate_c=float(hs.get("junction_temp_estimate_c", 0)),
                    thermal_resistance_ja=float(hs.get("thermal_resistance_ja", 0)),
                    severity=hs.get("severity", "info"),
                    recommendation=hs.get("recommendation", ""),
                )
            )

        return PowerBudgetReport(
            power_tree=data.get("power_tree", {}),
            total_current_ma=float(data.get("total_current_ma", 0)),
            total_power_mw=float(data.get("total_power_mw", 0)),
            estimated_runtime_hours=float(data.get("estimated_runtime_hours", 0)),
            thermal_hotspots=hotspots,
            per_mode_summary=data.get("per_mode_summary", {}),
            warnings=data.get("warnings", []),
            citations=data.get("citations", []),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# S5: SemanticERC
# ===========================================================================


class SemanticFindingCategory(str, Enum):
    """Categories for semantic ERC findings."""

    FUNCTIONAL_ERROR = "FUNCTIONAL_ERROR"
    VALUE_ERROR = "VALUE_ERROR"
    RATING_VIOLATION = "RATING_VIOLATION"
    PERFORMANCE_WARNING = "PERFORMANCE_WARNING"


class SemanticFindingSeverity(str, Enum):
    """Severity levels for semantic ERC findings."""

    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class SemanticERCFinding:
    """A single finding from the semantic ERC."""

    category: str = ""  # FUNCTIONAL_ERROR, VALUE_ERROR, RATING_VIOLATION, PERFORMANCE_WARNING
    severity: str = "warning"
    component_ref: str = ""
    calculation: str = ""  # human-readable math showing the issue
    expected_value: str = ""
    actual_value: str = ""
    impact: str = ""
    fix_suggestion: str = ""
    citation: str = ""
    title: str = ""


@dataclass
class SemanticERCReport:
    """Result of S5 semantic ERC analysis."""

    findings: list[SemanticERCFinding] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
    score: float = 100.0
    passed: bool = True
    error: str = ""


class SemanticERC(_LLMClientMixin):
    """S5: Semantic Electrical Rule Check.

    Goes beyond traditional ERC by understanding circuit FUNCTION. Checks
    include:
    - Feedback divider output vs. regulator/load requirement
    - Resistor power dissipation vs. rated power
    - Capacitor voltage rating vs. applied rail voltage (derating)
    - Sense resistor value sanity for current sensing
    - ADC reference voltage vs. resolution needs
    - LDO dropout headroom
    - Filter cutoff frequency vs. signal bandwidth
    - Bypass cap ESR suitability
    - LED current vs. max rating
    - Pull-up/pull-down suitability for bus speed

    Each finding includes the mathematical calculation so the engineer
    can verify.
    """

    async def check_semantic(
        self,
        schematic_context: dict[str, Any],
    ) -> SemanticERCReport:
        """Run semantic ERC on a schematic.

        Args:
            schematic_context: Schematic dict with components (including
                values, specs), nets, and connections.

        Returns:
            SemanticERCReport with categorised findings, each showing
            the calculation that reveals the issue.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(schematic_context)

        # Run LLM-based deep analysis
        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)

            if "_parse_error" in parsed:
                return SemanticERCReport(error=f"LLM response parse error: {raw[:500]}")

            return self._map_result(parsed)
        except Exception as exc:
            logger.error("check_semantic failed: %s", exc)
            return SemanticERCReport(error=str(exc))

    # -- local heuristic pre-checks ------------------------------------------

    @staticmethod
    def _local_voltage_rating_checks(
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> list[SemanticERCFinding]:
        """Check capacitor voltage ratings against rail voltages locally.

        This does not require an LLM and provides instant results for
        obvious violations.
        """
        findings: list[SemanticERCFinding] = []

        # Build a map of net name -> estimated voltage
        rail_voltage: dict[str, float] = {}
        for net in nets:
            name = net.get("name", "")
            # Try to extract voltage from net name
            m = re.search(r"(\d+)V(\d)?", name, re.IGNORECASE)
            if m:
                volts = float(m.group(1))
                if m.group(2):
                    volts += float(m.group(2)) / 10.0
                rail_voltage[name] = volts
            elif re.search(r"3V3|3.3V", name, re.IGNORECASE):
                rail_voltage[name] = 3.3
            elif re.search(r"5V", name, re.IGNORECASE):
                rail_voltage[name] = 5.0
            elif re.search(r"12V", name, re.IGNORECASE):
                rail_voltage[name] = 12.0
            elif re.search(r"1V8|1.8V", name, re.IGNORECASE):
                rail_voltage[name] = 1.8
            elif re.search(r"2V5|2.5V", name, re.IGNORECASE):
                rail_voltage[name] = 2.5

        # Check each capacitor
        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("C"):
                continue

            specs = comp.get("specs", {})
            v_rating = specs.get("voltage_rating_v")
            if not isinstance(v_rating, (int, float)):
                continue

            # Find which power rail(s) this cap is on
            comp_nets = comp.get("nets", [])
            for net_name in comp_nets:
                if net_name in rail_voltage:
                    rail_v = rail_voltage[net_name]
                    # Industry standard: derate ceramic caps to 80% of rating
                    derated = v_rating * 0.8
                    if rail_v > derated:
                        findings.append(
                            SemanticERCFinding(
                                category=SemanticFindingCategory.RATING_VIOLATION.value,
                                severity="error" if rail_v > v_rating else "warning",
                                component_ref=ref,
                                calculation=(
                                    f"Rail voltage: {rail_v}V, "
                                    f"Cap rating: {v_rating}V, "
                                    f"Derated (80%): {derated}V, "
                                    f"Margin: {derated - rail_v:.1f}V"
                                ),
                                expected_value=f">= {rail_v / 0.8:.1f}V rating",
                                actual_value=f"{v_rating}V",
                                impact=(
                                    "Capacitor may experience accelerated aging, reduced "
                                    "effective capacitance, or dielectric breakdown"
                                ),
                                fix_suggestion=(
                                    f"Replace {ref} with a capacitor rated >= "
                                    f"{rail_v / 0.8:.0f}V (80% derating) or "
                                    f">= {rail_v * 2:.0f}V (50% derating for high reliability)"
                                ),
                                citation="IPC-CC-830B, MLCC voltage derating guidelines",
                                title=f"Insufficient voltage rating on {ref}",
                            )
                        )

        return findings

    @staticmethod
    def _local_resistor_power_checks(
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> list[SemanticERCFinding]:
        """Check resistor power dissipation against rating locally."""
        findings: list[SemanticERCFinding] = []

        # Build rail voltage map
        rail_voltage: dict[str, float] = {}
        for net in nets:
            name = net.get("name", "")
            m = re.search(r"(\d+\.?\d*)V", name, re.IGNORECASE)
            if m:
                rail_voltage[name] = float(m.group(1))

        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("R"):
                continue

            specs = comp.get("specs", {})
            resistance = specs.get("resistance_ohm")
            power_rating = specs.get("power_w")
            if not isinstance(resistance, (int, float)) or resistance <= 0:
                continue
            if not isinstance(power_rating, (int, float)):
                continue

            # Check if this resistor bridges two different voltage rails
            comp_nets = comp.get("nets", [])
            voltages_on_pins: list[float] = []
            for n in comp_nets:
                if n in rail_voltage:
                    voltages_on_pins.append(rail_voltage[n])
                elif re.search(r"GND|VSS", n, re.IGNORECASE):
                    voltages_on_pins.append(0.0)

            if len(voltages_on_pins) >= 2:
                v_across = abs(voltages_on_pins[0] - voltages_on_pins[1])
                p_dissipated = (v_across ** 2) / resistance
                derated_power = power_rating * 0.5  # 50% derating

                if p_dissipated > derated_power:
                    findings.append(
                        SemanticERCFinding(
                            category=SemanticFindingCategory.RATING_VIOLATION.value,
                            severity="error" if p_dissipated > power_rating else "warning",
                            component_ref=ref,
                            calculation=(
                                f"V_across = {v_across:.2f}V, "
                                f"R = {resistance}ohm, "
                                f"P = V^2/R = {p_dissipated * 1000:.1f}mW, "
                                f"Rating: {power_rating * 1000:.0f}mW, "
                                f"Derated (50%): {derated_power * 1000:.0f}mW"
                            ),
                            expected_value=f"<= {derated_power * 1000:.0f}mW",
                            actual_value=f"{p_dissipated * 1000:.1f}mW",
                            impact="Resistor may overheat, drift in value, or fail",
                            fix_suggestion=(
                                f"Use a higher power rating resistor (>= {p_dissipated * 2 * 1000:.0f}mW) "
                                f"or increase resistance to reduce dissipation"
                            ),
                            citation="Resistor power derating: 50% at 70C per IPC-2221",
                            title=f"Excessive power dissipation in {ref}",
                        )
                    )

        return findings

    # -- prompt builders -----------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert electronics design engineer performing a SEMANTIC "
            "electrical rule check (ERC). Unlike a traditional ERC that only checks "
            "connectivity, you understand the FUNCTION of each circuit block and "
            "verify that component values actually achieve the intended function.\n\n"
            "For each potential issue, you MUST show the mathematical calculation "
            "that demonstrates the problem. This is not optional -- the engineer "
            "must be able to verify your finding.\n\n"
            "Checks you MUST perform:\n"
            "1. FEEDBACK DIVIDER ANALYSIS: For voltage regulators with resistor "
            "   dividers, calculate Vout = Vref * (1 + R_top/R_bottom) and verify "
            "   it matches the intended output voltage.\n"
            "2. RESISTOR POWER: P = V^2/R. Compare against the resistor's power "
            "   rating with 50% derating.\n"
            "3. CAPACITOR VOLTAGE: Verify each cap's voltage rating >= 1.5x the "
            "   applied voltage (ceramic) or >= 1.2x (electrolytic).\n"
            "4. SENSE RESISTOR: For current-sense resistors, verify R_sense gives "
            "   adequate voltage for the sense amplifier/ADC at the target current, "
            "   and that power dissipation is acceptable.\n"
            "5. ADC REFERENCE: Verify ADC reference voltage and resolution. "
            "   LSB = Vref / 2^N. Check if this provides adequate resolution for "
            "   the measured signal range.\n"
            "6. LDO DROPOUT: Verify (Vin_min - Vout) >= dropout voltage.\n"
            "7. FILTER CUTOFF: For RC/LC filters, calculate f_c = 1/(2*pi*R*C) or "
            "   1/(2*pi*sqrt(L*C)) and verify it's appropriate.\n"
            "8. LED CURRENT: I_led = (Vsupply - Vf) / R_limit. Verify <= max.\n"
            "9. PULL-UP SUITABILITY: For I2C, verify R_pull-up gives adequate "
            "   rise time: t_r = 0.8473 * R * C_bus.\n"
            "10. DECOUPLING RESONANCE: Check if decoupling cap SRF is above the "
            "    IC's clock frequency.\n\n"
            "Output MUST be valid JSON with these keys:\n"
            "  findings: [{category, severity, component_ref, calculation, expected_value, actual_value, impact, fix_suggestion, citation, title}]\n"
            "      category: FUNCTIONAL_ERROR, VALUE_ERROR, RATING_VIOLATION, PERFORMANCE_WARNING\n"
            "      severity: critical, error, warning, info\n"
            "  summary: {total_findings, by_category: {}, by_severity: {}}\n"
            "  score: <float 0-100>  -- 100 = no issues\n"
            "  passed: <bool>  -- false if any critical or error findings\n\n"
            "Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(schematic_context: dict[str, Any]) -> str:
        ctx_str = json.dumps(schematic_context, indent=2, default=str)
        if len(ctx_str) > 14000:
            ctx_str = ctx_str[:14000] + "\n... (truncated)"

        return (
            f"Perform a semantic ERC on this schematic:\n\n{ctx_str}\n\n"
            "For EVERY component, consider whether its value is correct for the "
            "circuit function. Show the math for every finding. Do not report "
            "issues you are not confident about -- only report findings where "
            "the calculation clearly shows a problem or marginal condition."
        )

    # -- result mapper -------------------------------------------------------

    @staticmethod
    def _map_result(data: dict[str, Any]) -> SemanticERCReport:
        findings = []
        for f in data.get("findings", []):
            findings.append(
                SemanticERCFinding(
                    category=f.get("category", ""),
                    severity=f.get("severity", "warning"),
                    component_ref=f.get("component_ref", ""),
                    calculation=f.get("calculation", ""),
                    expected_value=str(f.get("expected_value", "")),
                    actual_value=str(f.get("actual_value", "")),
                    impact=f.get("impact", ""),
                    fix_suggestion=f.get("fix_suggestion", ""),
                    citation=f.get("citation", ""),
                    title=f.get("title", ""),
                )
            )

        has_critical_or_error = any(
            f.severity in ("critical", "error") for f in findings
        )

        return SemanticERCReport(
            findings=findings,
            summary=data.get("summary", {
                "total_findings": len(findings),
                "by_category": _count_by(findings, "category"),
                "by_severity": _count_by(findings, "severity"),
            }),
            score=float(data.get("score", _calculate_semantic_score(findings))),
            passed=data.get("passed", not has_critical_or_error),
        )

    async def check_semantic_with_local(
        self,
        schematic_context: dict[str, Any],
    ) -> SemanticERCReport:
        """Run semantic ERC combining local heuristics with LLM analysis.

        This first runs fast local checks (voltage ratings, power dissipation)
        that do not require an LLM call, then runs the full LLM-based semantic
        analysis and merges the results.

        Args:
            schematic_context: Schematic dict.

        Returns:
            Merged SemanticERCReport.
        """
        components = schematic_context.get("components", [])
        nets = schematic_context.get("nets", [])

        # Fast local checks
        local_findings: list[SemanticERCFinding] = []
        local_findings.extend(self._local_voltage_rating_checks(components, nets))
        local_findings.extend(self._local_resistor_power_checks(components, nets))

        # LLM deep analysis
        llm_report = await self.check_semantic(schematic_context)

        # Merge: local findings first, then LLM findings that don't overlap
        local_refs = {(f.component_ref, f.category) for f in local_findings}
        merged_findings = list(local_findings)
        for f in llm_report.findings:
            if (f.component_ref, f.category) not in local_refs:
                merged_findings.append(f)

        has_critical_or_error = any(
            f.severity in ("critical", "error") for f in merged_findings
        )

        return SemanticERCReport(
            findings=merged_findings,
            summary={
                "total_findings": len(merged_findings),
                "by_category": _count_by(merged_findings, "category"),
                "by_severity": _count_by(merged_findings, "severity"),
            },
            score=_calculate_semantic_score(merged_findings),
            passed=not has_critical_or_error,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _count_by(findings: list[SemanticERCFinding], attr: str) -> dict[str, int]:
    """Count findings by a given attribute."""
    counts: dict[str, int] = {}
    for f in findings:
        key = getattr(f, attr, "unknown")
        counts[key] = counts.get(key, 0) + 1
    return counts


def _calculate_semantic_score(findings: list[SemanticERCFinding]) -> float:
    """Calculate a quality score based on findings."""
    score = 100.0
    for f in findings:
        if f.severity == "critical":
            score -= 20.0
        elif f.severity == "error":
            score -= 10.0
        elif f.severity == "warning":
            score -= 3.0
        elif f.severity == "info":
            score -= 0.5
    return max(0.0, round(score, 1))
