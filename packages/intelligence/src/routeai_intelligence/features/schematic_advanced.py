"""Schematic Intelligence Features S6-S10.

Five LLM-powered features for advanced schematic analysis and synthesis:
  S6:  ComplianceAdvisor              - Standards compliance checking
  S7:  SystemComponentSelector        - System-level BOM-aware component selection
  S8:  PhysicsConstraintPropagator    - Interface-aware trace geometry computation
  S9:  ContextualDesignReviewer       - Senior-engineer-level deep design review
  S10: NaturalLanguageSchematicGenerator - NL to schematic with iterative refinement

Each class works standalone with just an LLM API key (Gemini or Anthropic).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from .schematic_intelligence import _LLMClientMixin

logger = logging.getLogger(__name__)


# ===========================================================================
# S6: ComplianceAdvisor
# ===========================================================================


@dataclass
class ComplianceFinding:
    """A single compliance finding (pass or fail)."""

    clause: str = ""
    title: str = ""
    status: str = "pass"  # pass, fail, warning, not_applicable
    description: str = ""
    evidence: str = ""
    remediation: str = ""


@dataclass
class ComplianceReport:
    """Result of S6 compliance check."""

    standard: str = ""
    classification: str = ""  # e.g. "Class II", "ASIL-B", "DAL A"
    findings: list[ComplianceFinding] = field(default_factory=list)
    pass_count: int = 0
    fail_count: int = 0
    warning_count: int = 0
    summary: str = ""
    error: str = ""


class ComplianceAdvisor(_LLMClientMixin):
    """S6: Check schematic compliance against safety/industry standards.

    Supports IEC-60601-1 (medical), ISO-26262 (automotive), DO-254
    (aerospace), and IEC-61508 (industrial functional safety).
    """

    SUPPORTED_STANDARDS = {"IEC-60601-1", "ISO-26262", "DO-254", "IEC-61508"}

    async def check_compliance(
        self,
        schematic_context: dict[str, Any],
        standard: str,
        params: dict[str, Any] | None = None,
    ) -> ComplianceReport:
        """Check a schematic against a safety/industry standard.

        Args:
            schematic_context: Dict describing the schematic - components,
                nets, power rails, interfaces, and intended application.
            standard: The standard to check against, one of IEC-60601-1,
                ISO-26262, DO-254, IEC-61508.
            params: Optional parameters such as target classification level,
                operating environment, or specific clauses to audit.

        Returns:
            ComplianceReport with per-clause findings, pass/fail counts.
        """
        if standard not in self.SUPPORTED_STANDARDS:
            return ComplianceReport(
                standard=standard,
                error=f"Unsupported standard '{standard}'. "
                f"Supported: {', '.join(sorted(self.SUPPORTED_STANDARDS))}",
            )

        params = params or {}
        system = self._build_system_prompt(standard)
        prompt = self._build_prompt(schematic_context, standard, params)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return ComplianceReport(
                    standard=standard,
                    error=f"LLM response parse error: {raw[:500]}",
                )
            return self._map_result(parsed, standard)
        except Exception as exc:
            logger.error("check_compliance failed: %s", exc)
            return ComplianceReport(standard=standard, error=str(exc))

    @staticmethod
    def _build_system_prompt(standard: str) -> str:
        standard_detail = {
            "IEC-60601-1": (
                "IEC 60601-1 (Medical Electrical Equipment - General Requirements for "
                "Basic Safety and Essential Performance). Focus on: means of protection "
                "(MOP/MOPP/MOOP), creepage/clearance distances, patient leakage current "
                "limits, isolation barriers, component derating for Class I/II equipment, "
                "single fault conditions, and protective earth requirements."
            ),
            "ISO-26262": (
                "ISO 26262 (Road vehicles - Functional safety). Focus on: ASIL "
                "decomposition, hardware architectural metrics (SPFM, LFM, PMHF), "
                "diagnostic coverage of safety mechanisms, redundancy in safety-critical "
                "paths, independent fault detection, safe state transitions, and "
                "systematic capability of components."
            ),
            "DO-254": (
                "DO-254 (Design Assurance Guidance for Airborne Electronic Hardware). "
                "Focus on: Design Assurance Level (DAL A-E) requirements, hardware "
                "design lifecycle data, verification coverage, component qualification "
                "(COTS usage), environmental qualification (DO-160), configuration "
                "management, and traceability from requirements to implementation."
            ),
            "IEC-61508": (
                "IEC 61508 (Functional Safety of Electrical/Electronic/Programmable "
                "Electronic Safety-related Systems). Focus on: SIL determination, "
                "hardware fault tolerance (HFT), safe failure fraction (SFF), "
                "proof test intervals, diagnostic coverage, systematic capability, "
                "common cause failure analysis, and architectural constraints."
            ),
        }
        return (
            f"You are a certified functional safety engineer and compliance auditor "
            f"specialising in {standard}.\n\n"
            f"Standard details:\n{standard_detail[standard]}\n\n"
            "Given a schematic description, audit each relevant clause and produce "
            "structured JSON with these keys:\n"
            "  classification: <string>  -- applicable classification level\n"
            "  findings: [{clause, title, status, description, evidence, remediation}]\n"
            "    status is one of: pass, fail, warning, not_applicable\n"
            "  pass_count: <int>\n"
            "  fail_count: <int>\n"
            "  warning_count: <int>\n"
            "  summary: <string>  -- executive summary\n\n"
            "Rules:\n"
            "- Be specific: cite clause numbers (e.g. '8.5.2.1').\n"
            "- For each fail, provide concrete remediation steps.\n"
            "- Output ONLY the JSON object, no markdown fences."
        )

    @staticmethod
    def _build_prompt(
        schematic_context: dict[str, Any],
        standard: str,
        params: dict[str, Any],
    ) -> str:
        ctx_json = json.dumps(schematic_context, indent=2, default=str)
        parts = [
            f"Audit the following schematic against {standard}.\n",
            f"Schematic context:\n{ctx_json}\n",
        ]
        if params.get("classification"):
            parts.append(f"Target classification: {params['classification']}")
        if params.get("clauses"):
            parts.append(f"Focus on clauses: {', '.join(params['clauses'])}")
        if params.get("environment"):
            parts.append(f"Operating environment: {params['environment']}")
        return "\n".join(parts)

    @staticmethod
    def _map_result(data: dict[str, Any], standard: str) -> ComplianceReport:
        findings = []
        for f in data.get("findings", []):
            findings.append(
                ComplianceFinding(
                    clause=f.get("clause", ""),
                    title=f.get("title", ""),
                    status=f.get("status", "pass"),
                    description=f.get("description", ""),
                    evidence=f.get("evidence", ""),
                    remediation=f.get("remediation", ""),
                )
            )
        return ComplianceReport(
            standard=standard,
            classification=data.get("classification", ""),
            findings=findings,
            pass_count=int(data.get("pass_count", 0)),
            fail_count=int(data.get("fail_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            summary=data.get("summary", ""),
        )


# ===========================================================================
# S7: SystemComponentSelector
# ===========================================================================


@dataclass
class ComponentCandidate:
    """A candidate component with system-level impact analysis."""

    mpn: str = ""
    manufacturer: str = ""
    description: str = ""
    unit_price_usd: float = 0.0
    availability: str = ""
    key_specs: dict[str, str] = field(default_factory=dict)
    system_impact: str = ""
    score: float = 0.0


@dataclass
class BOMImpact:
    """Impact of a component selection on the total BOM."""

    added_components: list[str] = field(default_factory=list)
    removed_components: list[str] = field(default_factory=list)
    cost_delta_usd: float = 0.0
    board_area_delta_mm2: float = 0.0
    power_delta_mw: float = 0.0
    risk_assessment: str = ""


@dataclass
class SystemSelectionResult:
    """Result of S7 system-aware component selection."""

    candidates: list[ComponentCandidate] = field(default_factory=list)
    recommendation: str = ""
    total_bom_impact: BOMImpact = field(default_factory=BOMImpact)
    reasoning: str = ""
    error: str = ""


class SystemComponentSelector(_LLMClientMixin):
    """S7: Select components with system-level BOM impact analysis.

    Unlike simple parametric search, this considers the existing BOM to
    evaluate total system cost, added support components, power budget
    changes, and supply-chain risk for each candidate.
    """

    async def select_with_system_analysis(
        self,
        requirements: dict[str, Any],
        existing_bom: list[dict[str, Any]],
        constraints: dict[str, Any] | None = None,
    ) -> SystemSelectionResult:
        """Select a component considering total BOM impact.

        Args:
            requirements: What the component must do - e.g.
                {"type": "LDO", "vin_max": 12, "vout": 3.3, "iout_ma": 500}.
            existing_bom: Current BOM as list of dicts with at least
                {mpn, reference, value, description}.
            constraints: Optional constraints such as max_cost, preferred
                manufacturers, footprint size limits, or banned substances.

        Returns:
            SystemSelectionResult with ranked candidates, a recommendation,
            total BOM impact analysis, and reasoning.
        """
        constraints = constraints or {}
        system = self._build_system_prompt()
        prompt = self._build_prompt(requirements, existing_bom, constraints)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return SystemSelectionResult(
                    error=f"LLM response parse error: {raw[:500]}"
                )
            return self._map_result(parsed)
        except Exception as exc:
            logger.error("select_with_system_analysis failed: %s", exc)
            return SystemSelectionResult(error=str(exc))

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are a senior electronics design engineer and supply-chain analyst. "
            "When selecting components you consider not just the part itself but its "
            "total system impact: additional support circuitry it requires, shared "
            "component consolidation opportunities, power budget effects, board area, "
            "second-source availability, and lifecycle risk.\n\n"
            "Given requirements and an existing BOM, recommend components and analyse "
            "the total BOM impact. Output structured JSON:\n"
            "  candidates: [{mpn, manufacturer, description, unit_price_usd, "
            "availability, key_specs: {k:v}, system_impact, score}]\n"
            "    score is 0-1 (1 = best fit considering all factors)\n"
            "  recommendation: <string>  -- the top-pick MPN with one-line rationale\n"
            "  total_bom_impact: {added_components: [str], removed_components: [str], "
            "cost_delta_usd, board_area_delta_mm2, power_delta_mw, risk_assessment}\n"
            "  reasoning: <string>  -- detailed trade-off analysis\n\n"
            "Rules:\n"
            "- Use real, currently-available MPNs from major distributors.\n"
            "- Identify support components the candidate needs that are NOT already "
            "in the BOM (e.g. bootstrap capacitor, inductor, feedback resistors).\n"
            "- Identify existing BOM components that could be removed/consolidated.\n"
            "- Cost estimates should be at 1k qty from major distributors.\n"
            "- Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(
        requirements: dict[str, Any],
        existing_bom: list[dict[str, Any]],
        constraints: dict[str, Any],
    ) -> str:
        req_json = json.dumps(requirements, indent=2, default=str)
        bom_json = json.dumps(existing_bom[:50], indent=2, default=str)  # cap for token limit
        parts = [
            f"Component requirements:\n{req_json}\n",
            f"Existing BOM ({len(existing_bom)} items, showing first 50):\n{bom_json}\n",
        ]
        if constraints:
            parts.append(f"Constraints:\n{json.dumps(constraints, indent=2, default=str)}")
        parts.append(
            "\nAnalyse the BOM to find consolidation opportunities. For example, "
            "if the BOM already has a switching regulator, consider whether a "
            "second output from the same IC family could be used. List all NEW "
            "support components needed (with MPNs) and any existing BOM items "
            "that become unnecessary."
        )
        return "\n".join(parts)

    @staticmethod
    def _map_result(data: dict[str, Any]) -> SystemSelectionResult:
        candidates = []
        for c in data.get("candidates", []):
            candidates.append(
                ComponentCandidate(
                    mpn=c.get("mpn", ""),
                    manufacturer=c.get("manufacturer", ""),
                    description=c.get("description", ""),
                    unit_price_usd=float(c.get("unit_price_usd", 0.0)),
                    availability=c.get("availability", ""),
                    key_specs=c.get("key_specs", {}),
                    system_impact=c.get("system_impact", ""),
                    score=float(c.get("score", 0.0)),
                )
            )

        bom_raw = data.get("total_bom_impact", {})
        bom_impact = BOMImpact(
            added_components=bom_raw.get("added_components", []),
            removed_components=bom_raw.get("removed_components", []),
            cost_delta_usd=float(bom_raw.get("cost_delta_usd", 0.0)),
            board_area_delta_mm2=float(bom_raw.get("board_area_delta_mm2", 0.0)),
            power_delta_mw=float(bom_raw.get("power_delta_mw", 0.0)),
            risk_assessment=bom_raw.get("risk_assessment", ""),
        )

        return SystemSelectionResult(
            candidates=candidates,
            recommendation=data.get("recommendation", ""),
            total_bom_impact=bom_impact,
            reasoning=data.get("reasoning", ""),
        )


# ===========================================================================
# S8: PhysicsConstraintPropagator
# ===========================================================================


@dataclass
class TraceConstraint:
    """A single physical constraint for a net or group of nets."""

    net_pattern: str = ""
    constraint_type: str = ""  # impedance, spacing, length_match, width, via
    value: str = ""
    unit: str = ""
    rationale: str = ""


@dataclass
class PropagatedConstraints:
    """Result of S8 physics constraint propagation."""

    interface: str = ""
    impedance_target: float = 0.0  # ohms
    trace_width_mm: float = 0.0
    spacing_mm: float = 0.0
    constraints: list[TraceConstraint] = field(default_factory=list)
    stackup_layer: str = ""
    calculation_notes: str = ""
    error: str = ""


class PhysicsConstraintPropagator(_LLMClientMixin):
    """S8: Propagate physical constraints from interface type to trace geometry.

    Given an interface type (e.g. USB 2.0 HS, DDR3, LVDS), the connected
    components, and the PCB stackup, computes required trace widths, spacing,
    impedance targets, and length-matching rules for the actual stackup.
    """

    async def propagate_constraints(
        self,
        interface_type: str,
        components: list[dict[str, Any]],
        stackup: dict[str, Any],
    ) -> PropagatedConstraints:
        """Compute trace geometry constraints for an interface on a given stackup.

        Args:
            interface_type: The interface, e.g. "USB2.0_HS", "DDR3-1600",
                "LVDS", "100BASE-TX", "PCIe_Gen3_x4", "HDMI_2.0".
            components: List of connected components with pin assignments,
                e.g. [{"mpn": "STM32H743", "pins": {"D+": "PA12", "D-": "PA11"}}].
            stackup: PCB stackup definition including layer count, dielectric
                constant (Er), copper thickness, prepreg/core thicknesses.

        Returns:
            PropagatedConstraints with impedance target, trace width, spacing,
            and detailed constraint list for the given stackup.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(interface_type, components, stackup)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return PropagatedConstraints(
                    interface=interface_type,
                    error=f"LLM response parse error: {raw[:500]}",
                )
            return self._map_result(parsed, interface_type)
        except Exception as exc:
            logger.error("propagate_constraints failed: %s", exc)
            return PropagatedConstraints(interface=interface_type, error=str(exc))

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert PCB signal-integrity engineer. You compute trace "
            "geometry from first principles using transmission-line theory.\n\n"
            "For a given interface and PCB stackup, you:\n"
            "1. Identify the impedance target from the interface specification "
            "(e.g. USB 2.0 = 90 ohm differential, DDR3 = 40 ohm single-ended).\n"
            "2. Compute trace width for the target impedance on the given stackup "
            "using the microstrip or stripline formula as appropriate.\n"
            "3. Compute minimum spacing for acceptable crosstalk (typically 3x "
            "dielectric height for <1% crosstalk).\n"
            "4. Derive length-matching, via count limits, and reference plane "
            "requirements from the interface spec and data rate.\n\n"
            "Show your work in calculation_notes with the formulas used.\n\n"
            "Output JSON:\n"
            "  interface: <string>\n"
            "  impedance_target: <float ohms>\n"
            "  trace_width_mm: <float>\n"
            "  spacing_mm: <float>\n"
            "  stackup_layer: <string>  -- recommended routing layer\n"
            "  constraints: [{net_pattern, constraint_type, value, unit, rationale}]\n"
            "    constraint_type: impedance | spacing | length_match | width | via | "
            "reference_plane | guard_trace\n"
            "  calculation_notes: <string>  -- formulas and intermediate values\n\n"
            "Rules:\n"
            "- Use the ACTUAL stackup dimensions provided, not generic values.\n"
            "- If the stackup cannot achieve the target impedance with reasonable "
            "trace widths (0.075-1.0 mm), flag this in calculation_notes.\n"
            "- Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(
        interface_type: str,
        components: list[dict[str, Any]],
        stackup: dict[str, Any],
    ) -> str:
        comp_json = json.dumps(components, indent=2, default=str)
        stackup_json = json.dumps(stackup, indent=2, default=str)
        return (
            f"Interface type: {interface_type}\n\n"
            f"Connected components:\n{comp_json}\n\n"
            f"PCB stackup:\n{stackup_json}\n\n"
            "Compute the required trace geometry for this interface on this "
            "specific stackup. Show all calculations in calculation_notes "
            "including the impedance formula used and intermediate values. "
            "Provide all constraints needed for correct routing."
        )

    @staticmethod
    def _map_result(
        data: dict[str, Any], interface_type: str
    ) -> PropagatedConstraints:
        constraints = []
        for c in data.get("constraints", []):
            constraints.append(
                TraceConstraint(
                    net_pattern=c.get("net_pattern", ""),
                    constraint_type=c.get("constraint_type", ""),
                    value=c.get("value", ""),
                    unit=c.get("unit", ""),
                    rationale=c.get("rationale", ""),
                )
            )
        return PropagatedConstraints(
            interface=data.get("interface", interface_type),
            impedance_target=float(data.get("impedance_target", 0.0)),
            trace_width_mm=float(data.get("trace_width_mm", 0.0)),
            spacing_mm=float(data.get("spacing_mm", 0.0)),
            constraints=constraints,
            stackup_layer=data.get("stackup_layer", ""),
            calculation_notes=data.get("calculation_notes", ""),
        )


# ===========================================================================
# S9: ContextualDesignReviewer
# ===========================================================================


@dataclass
class ReviewCalculation:
    """A supporting calculation in a review finding."""

    name: str = ""
    formula: str = ""
    inputs: dict[str, str] = field(default_factory=dict)
    result: str = ""
    interpretation: str = ""


@dataclass
class ReviewFinding:
    """A single finding from the deep design review."""

    area: str = ""  # power, signal_integrity, thermal, EMC, reliability, etc.
    severity: str = "info"  # critical, error, warning, info, good
    title: str = ""
    description: str = ""
    calculation_chain: list[ReviewCalculation] = field(default_factory=list)
    recommendation: str = ""
    references: list[str] = field(default_factory=list)


@dataclass
class DeepReviewReport:
    """Result of S9 deep design review."""

    score: float = 0.0  # 0-100, overall design quality
    findings: list[ReviewFinding] = field(default_factory=list)
    critical_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    summary: str = ""
    error: str = ""


class ContextualDesignReviewer(_LLMClientMixin):
    """S9: Senior-engineer-level deep design review with calculations.

    Analyses a schematic as a senior engineer would, performing actual
    calculations: filter corner frequencies, MOSFET operating points, thermal
    analysis, voltage divider ratios, decoupling effectiveness, and more.
    Each finding includes a calculation chain showing the work.
    """

    async def deep_review(
        self,
        schematic_context: dict[str, Any],
        focus_areas: list[str] | None = None,
    ) -> DeepReviewReport:
        """Perform a deep design review of a schematic.

        Args:
            schematic_context: Dict describing the schematic including
                components (with values), nets, power rails, operating
                conditions (temperature, input voltage range).
            focus_areas: Optional list of areas to focus on, e.g.
                ["power", "signal_integrity", "thermal", "EMC",
                 "reliability", "decoupling", "filtering"].
                If None, all areas are reviewed.

        Returns:
            DeepReviewReport with scored findings and calculation chains.
        """
        system = self._build_system_prompt()
        prompt = self._build_prompt(schematic_context, focus_areas)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return DeepReviewReport(
                    error=f"LLM response parse error: {raw[:500]}"
                )
            return self._map_result(parsed)
        except Exception as exc:
            logger.error("deep_review failed: %s", exc)
            return DeepReviewReport(error=str(exc))

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are a senior electronics design engineer with 25+ years of "
            "experience performing design reviews. You do not just look for "
            "obvious errors - you perform CALCULATIONS to verify the design.\n\n"
            "For every finding, show your work with a calculation chain:\n"
            "- Filter analysis: compute f_c = 1/(2*pi*R*C), verify it meets "
            "the bandwidth requirement.\n"
            "- MOSFET operating point: compute Vgs, Id, Pd, verify SOA.\n"
            "- Thermal: compute Tj = Ta + Pd*Rth_ja, verify Tj < Tj_max.\n"
            "- Voltage divider: compute Vout = Vin * R2/(R1+R2), verify "
            "against the feedback pin reference.\n"
            "- Decoupling: compute impedance at frequency of interest, "
            "verify it meets the target impedance.\n"
            "- Current sense: compute I_max from Vsense_max / Rsense.\n\n"
            "Output JSON:\n"
            "  score: <float 0-100>  -- overall design quality score\n"
            "  findings: [{area, severity, title, description, "
            "calculation_chain: [{name, formula, inputs: {k:v}, result, "
            "interpretation}], recommendation, references: [str]}]\n"
            "    severity: critical | error | warning | info | good\n"
            "  critical_count: <int>\n"
            "  error_count: <int>\n"
            "  warning_count: <int>\n"
            "  summary: <string>\n\n"
            "Rules:\n"
            "- Every finding with severity >= warning MUST have at least one "
            "calculation in calculation_chain.\n"
            "- Include positive findings (severity='good') for well-designed "
            "parts of the circuit.\n"
            "- Score reflects: 90-100 production-ready, 70-89 minor issues, "
            "50-69 significant issues, <50 fundamental problems.\n"
            "- Output ONLY the JSON object."
        )

    @staticmethod
    def _build_prompt(
        schematic_context: dict[str, Any],
        focus_areas: list[str] | None,
    ) -> str:
        ctx_json = json.dumps(schematic_context, indent=2, default=str)
        parts = [
            "Perform a deep design review of this schematic.\n",
            f"Schematic:\n{ctx_json}\n",
        ]
        if focus_areas:
            parts.append(f"Focus areas: {', '.join(focus_areas)}")
        else:
            parts.append(
                "Review ALL areas: power integrity, signal integrity, thermal "
                "management, EMC, reliability, decoupling, filtering, protection "
                "circuits, feedback loop stability, and component derating."
            )
        parts.append(
            "\nFor EACH issue found, show your calculations. For example, if "
            "you find an RC filter, compute its corner frequency and verify "
            "it is correct for the application."
        )
        return "\n".join(parts)

    @staticmethod
    def _map_result(data: dict[str, Any]) -> DeepReviewReport:
        findings = []
        for f in data.get("findings", []):
            calcs = []
            for c in f.get("calculation_chain", []):
                calcs.append(
                    ReviewCalculation(
                        name=c.get("name", ""),
                        formula=c.get("formula", ""),
                        inputs=c.get("inputs", {}),
                        result=c.get("result", ""),
                        interpretation=c.get("interpretation", ""),
                    )
                )
            findings.append(
                ReviewFinding(
                    area=f.get("area", ""),
                    severity=f.get("severity", "info"),
                    title=f.get("title", ""),
                    description=f.get("description", ""),
                    calculation_chain=calcs,
                    recommendation=f.get("recommendation", ""),
                    references=f.get("references", []),
                )
            )
        return DeepReviewReport(
            score=float(data.get("score", 0.0)),
            findings=findings,
            critical_count=int(data.get("critical_count", 0)),
            error_count=int(data.get("error_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            summary=data.get("summary", ""),
        )


# ===========================================================================
# S10: NaturalLanguageSchematicGenerator
# ===========================================================================


@dataclass
class SchematicBlock:
    """A functional block in the generated schematic."""

    name: str = ""
    function: str = ""
    components: list[str] = field(default_factory=list)  # references
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)


@dataclass
class SchematicComponent:
    """A component in the generated schematic."""

    reference: str = ""
    mpn: str = ""
    value: str = ""
    footprint: str = ""
    description: str = ""
    block: str = ""  # which SchematicBlock this belongs to


@dataclass
class SchematicConnection:
    """A connection in the generated schematic."""

    from_ref: str = ""
    from_pin: str = ""
    to_ref: str = ""
    to_pin: str = ""
    net_name: str = ""


@dataclass
class SchematicConstraint:
    """A layout constraint from the generated schematic."""

    type: str = ""
    description: str = ""
    value: str = ""
    priority: str = "required"


@dataclass
class BOMEntry:
    """A BOM entry for the generated schematic."""

    reference: str = ""
    mpn: str = ""
    manufacturer: str = ""
    value: str = ""
    quantity: int = 1
    unit_price_usd: float = 0.0


@dataclass
class GeneratedSchematic:
    """Result of S10 NL schematic generation."""

    blocks: list[SchematicBlock] = field(default_factory=list)
    components: list[SchematicComponent] = field(default_factory=list)
    connections: list[SchematicConnection] = field(default_factory=list)
    constraints: list[SchematicConstraint] = field(default_factory=list)
    bom: list[BOMEntry] = field(default_factory=list)
    design_notes: str = ""
    error: str = ""


class NaturalLanguageSchematicGenerator(_LLMClientMixin):
    """S10: Generate schematics from natural language with iterative refinement.

    Converts a plain-English description into a structured schematic with
    functional blocks, components, connections, constraints, and BOM.
    Supports iterative refinement through a refine_schematic method.
    """

    async def generate_schematic(
        self,
        description: str,
    ) -> GeneratedSchematic:
        """Generate a schematic from a natural-language description.

        Args:
            description: Plain-English description of the desired circuit,
                e.g. "Battery-powered IoT sensor node with LoRa, BME280
                temperature/humidity sensor, and USB-C charging".

        Returns:
            GeneratedSchematic with blocks, components, connections,
            constraints, and BOM.
        """
        system = self._build_system_prompt()
        prompt = self._build_generate_prompt(description)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return GeneratedSchematic(
                    error=f"LLM response parse error: {raw[:500]}"
                )
            return self._map_result(parsed)
        except Exception as exc:
            logger.error("generate_schematic failed: %s", exc)
            return GeneratedSchematic(error=str(exc))

    async def refine_schematic(
        self,
        current: GeneratedSchematic,
        instruction: str,
    ) -> GeneratedSchematic:
        """Refine an existing generated schematic based on an instruction.

        Args:
            current: The current GeneratedSchematic to modify.
            instruction: What to change, e.g. "Replace the LDO with a
                buck converter for better efficiency" or "Add ESD
                protection to all external connectors".

        Returns:
            Updated GeneratedSchematic with the requested changes applied.
        """
        system = self._build_system_prompt()
        prompt = self._build_refine_prompt(current, instruction)

        try:
            raw = await self._llm_call(prompt, system)
            parsed = self._parse_json(raw)
            if "_parse_error" in parsed:
                return GeneratedSchematic(
                    error=f"LLM response parse error: {raw[:500]}"
                )
            return self._map_result(parsed)
        except Exception as exc:
            logger.error("refine_schematic failed: %s", exc)
            return GeneratedSchematic(error=str(exc))

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are an expert electronics architect who converts natural-language "
            "descriptions into complete, production-ready schematic designs.\n\n"
            "You decompose the design into functional blocks, then detail every "
            "component with real MPNs, every connection with pin-level detail, "
            "and every layout constraint.\n\n"
            "Output JSON:\n"
            "  blocks: [{name, function, components: [ref], inputs: [str], "
            "outputs: [str]}]\n"
            "  components: [{reference, mpn, value, footprint, description, block}]\n"
            "  connections: [{from_ref, from_pin, to_ref, to_pin, net_name}]\n"
            "  constraints: [{type, description, value, priority}]\n"
            "  bom: [{reference, mpn, manufacturer, value, quantity, "
            "unit_price_usd}]\n"
            "  design_notes: <string>  -- architecture rationale and key decisions\n\n"
            "Rules:\n"
            "- Every IC must have all decoupling caps, pull-ups, crystals, and "
            "support circuitry specified.\n"
            "- Use real, commercially available MPNs.\n"
            "- Connections must be pin-accurate (use datasheet pin names).\n"
            "- Include power distribution: show how each rail is generated and "
            "which blocks it supplies.\n"
            "- Include test points on critical signals.\n"
            "- Include all connectors (power input, debug, user interfaces).\n"
            "- Output ONLY the JSON object."
        )

    @staticmethod
    def _build_generate_prompt(description: str) -> str:
        return (
            f"Design a complete schematic for:\n{description}\n\n"
            "Decompose into functional blocks first, then detail each block. "
            "Include ALL support circuitry - decoupling, protection, filtering, "
            "pull-ups, debug headers, and power regulation. Every component "
            "must have a real MPN and footprint.\n\n"
            "Provide pin-level connections between all components. Include "
            "layout constraints for high-speed or sensitive signals."
        )

    @staticmethod
    def _build_refine_prompt(
        current: GeneratedSchematic,
        instruction: str,
    ) -> str:
        current_dict = {
            "blocks": [
                {
                    "name": b.name,
                    "function": b.function,
                    "components": b.components,
                    "inputs": b.inputs,
                    "outputs": b.outputs,
                }
                for b in current.blocks
            ],
            "components": [
                {
                    "reference": c.reference,
                    "mpn": c.mpn,
                    "value": c.value,
                    "footprint": c.footprint,
                    "description": c.description,
                    "block": c.block,
                }
                for c in current.components
            ],
            "connections": [
                {
                    "from_ref": c.from_ref,
                    "from_pin": c.from_pin,
                    "to_ref": c.to_ref,
                    "to_pin": c.to_pin,
                    "net_name": c.net_name,
                }
                for c in current.connections
            ],
            "constraints": [
                {
                    "type": c.type,
                    "description": c.description,
                    "value": c.value,
                    "priority": c.priority,
                }
                for c in current.constraints
            ],
            "bom": [
                {
                    "reference": b.reference,
                    "mpn": b.mpn,
                    "manufacturer": b.manufacturer,
                    "value": b.value,
                    "quantity": b.quantity,
                    "unit_price_usd": b.unit_price_usd,
                }
                for b in current.bom
            ],
            "design_notes": current.design_notes,
        }
        current_json = json.dumps(current_dict, indent=2)
        return (
            f"Here is the current schematic design:\n{current_json}\n\n"
            f"Modification requested:\n{instruction}\n\n"
            "Apply the requested modification to the schematic. Return the "
            "COMPLETE updated schematic (not just the changes). Preserve all "
            "parts of the design that are not affected by the modification. "
            "Update the BOM, connections, and constraints accordingly. "
            "Explain what changed in design_notes."
        )

    @staticmethod
    def _map_result(data: dict[str, Any]) -> GeneratedSchematic:
        blocks = []
        for b in data.get("blocks", []):
            blocks.append(
                SchematicBlock(
                    name=b.get("name", ""),
                    function=b.get("function", ""),
                    components=b.get("components", []),
                    inputs=b.get("inputs", []),
                    outputs=b.get("outputs", []),
                )
            )

        components = []
        for c in data.get("components", []):
            components.append(
                SchematicComponent(
                    reference=c.get("reference", ""),
                    mpn=c.get("mpn", ""),
                    value=c.get("value", ""),
                    footprint=c.get("footprint", ""),
                    description=c.get("description", ""),
                    block=c.get("block", ""),
                )
            )

        connections = []
        for cn in data.get("connections", []):
            connections.append(
                SchematicConnection(
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
                SchematicConstraint(
                    type=cs.get("type", ""),
                    description=cs.get("description", ""),
                    value=cs.get("value", ""),
                    priority=cs.get("priority", "required"),
                )
            )

        bom = []
        for b in data.get("bom", []):
            bom.append(
                BOMEntry(
                    reference=b.get("reference", ""),
                    mpn=b.get("mpn", ""),
                    manufacturer=b.get("manufacturer", ""),
                    value=b.get("value", ""),
                    quantity=int(b.get("quantity", 1)),
                    unit_price_usd=float(b.get("unit_price_usd", 0.0)),
                )
            )

        return GeneratedSchematic(
            blocks=blocks,
            components=components,
            connections=connections,
            constraints=constraints,
            bom=bom,
            design_notes=data.get("design_notes", ""),
        )
