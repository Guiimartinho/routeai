"""Verification Intelligence Features V1-V7.

Seven LLM-powered features for design verification and compliance:
  V1: SemanticDRCEngine              - Function-aware design rule checking
  V2: DesignChecklist                - Context-aware "did you forget?" checker
  V3: ApplicationComplianceChecker   - IEC-60601, ISO-26262, DO-254 compliance
  V4: CrossDomainVerifier            - Layout vs schematic intent verification
  V5: DatasheetLayoutComplianceChecker - Datasheet layout recommendation checking
  V6: SIPreFlightChecker             - Pre-simulation signal integrity check
  V7: PDNReviewer                    - Power delivery network review

Each class works standalone with just an LLM API key (Gemini or Anthropic).
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared LLM call mixin
# ---------------------------------------------------------------------------


class _LLMClientMixin:
    """Provides a dual-provider LLM call method (Gemini / Anthropic)."""

    async def _llm_call(self, prompt: str, system: str = "") -> str:
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


# ===========================================================================
# V1: SemanticDRCEngine
# ===========================================================================


@dataclass
class SemanticDRCFinding:
    """A single finding from semantic DRC analysis."""

    category: str = ""  # feedback_divider, resistor_power, cap_derating, sense_resistor, thermal, general
    component_ref: str = ""
    description: str = ""
    calculation_chain: str = ""
    expected_value: str = ""
    actual_value: str = ""
    severity: str = "warning"  # error, warning, info
    recommendation: str = ""


@dataclass
class SemanticDRCReport:
    """Result of V1 semantic DRC analysis."""

    findings: list[SemanticDRCFinding] = field(default_factory=list)
    circuit_function_summary: str = ""
    pass_count: int = 0
    fail_count: int = 0
    warning_count: int = 0
    confidence: float = 0.0
    error: str = ""


class SemanticDRCEngine(_LLMClientMixin):
    """V1: Function-aware design rule checking.

    Unlike traditional DRC which checks geometric/connectivity rules, this engine
    understands the circuit function and verifies that component values are
    consistent with the intended operation: feedback divider output vs load
    requirements, resistor power dissipation margins, capacitor voltage derating,
    and current-sense resistor sanity.
    """

    async def run_semantic_drc(
        self,
        schematic_context: dict[str, Any],
        board_context: dict[str, Any],
    ) -> SemanticDRCReport:
        """Run semantic DRC on a design.

        Args:
            schematic_context: Schematic data including components, nets, and
                connectivity with component values and ratings.
            board_context: Board layout data including power nets, voltages,
                and load current information.

        Returns:
            SemanticDRCReport with findings categorised by type.
        """
        system = (
            "You are an expert analog/power electronics engineer performing a "
            "function-aware design review. You understand circuit topology and can "
            "verify that component values match the intended circuit behaviour.\n\n"
            "Perform these checks on the provided design:\n"
            "1. FEEDBACK DIVIDER: Calculate Vout from divider resistors. Compare to "
            "   the stated output and load requirements. Flag mismatches.\n"
            "2. RESISTOR POWER: For each resistor, estimate worst-case power "
            "   dissipation (P = V^2/R or I^2*R). Flag any exceeding 50%% of rating.\n"
            "3. CAPACITOR VOLTAGE DERATING: Check that each cap's rated voltage is "
            "   at least 1.5x the applied voltage (2x for ceramic class II).\n"
            "4. SENSE RESISTOR: Verify current-sense resistor values give reasonable "
            "   sense voltages (typically 50-100mV at full load). Flag if signal "
            "   is too small for the ADC/comparator or if power loss is excessive.\n"
            "5. THERMAL: Flag any component whose power dissipation may cause thermal "
            "   issues given its package.\n\n"
            "For EVERY finding, show the full calculation chain.\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  findings: [{category, component_ref, description, calculation_chain, "
            "    expected_value, actual_value, severity, recommendation}]\n"
            "  circuit_function_summary: <string>\n"
            "  pass_count: <int>\n"
            "  fail_count: <int>\n"
            "  warning_count: <int>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Schematic context:\n{json.dumps(schematic_context, indent=2)}\n\n"
            f"Board context:\n{json.dumps(board_context, indent=2)}\n\n"
            "Perform a complete semantic DRC. Show calculations for every check."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return SemanticDRCReport(error=f"LLM response parse error: {raw[:500]}")
            return self._map_report(data)
        except Exception as exc:
            logger.error("run_semantic_drc failed: %s", exc)
            return SemanticDRCReport(error=str(exc))

    @staticmethod
    def _map_report(data: dict[str, Any]) -> SemanticDRCReport:
        findings = []
        for f in data.get("findings", []):
            findings.append(
                SemanticDRCFinding(
                    category=f.get("category", ""),
                    component_ref=f.get("component_ref", ""),
                    description=f.get("description", ""),
                    calculation_chain=f.get("calculation_chain", ""),
                    expected_value=f.get("expected_value", ""),
                    actual_value=f.get("actual_value", ""),
                    severity=f.get("severity", "warning"),
                    recommendation=f.get("recommendation", ""),
                )
            )
        return SemanticDRCReport(
            findings=findings,
            circuit_function_summary=data.get("circuit_function_summary", ""),
            pass_count=int(data.get("pass_count", 0)),
            fail_count=int(data.get("fail_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V2: DesignChecklist
# ===========================================================================


@dataclass
class CheckedItem:
    """An item that was checked and found present."""

    category: str = ""
    description: str = ""
    component_ref: str = ""
    status: str = "present"  # present, partial


@dataclass
class MissingItem:
    """An item that should be present but was not found."""

    category: str = ""
    description: str = ""
    severity: str = "warning"  # critical, warning, suggestion
    rationale: str = ""
    typical_solution: str = ""
    affected_net_or_component: str = ""


@dataclass
class ChecklistReport:
    """Result of V2 design checklist analysis."""

    checked_items: list[CheckedItem] = field(default_factory=list)
    missing_items: list[MissingItem] = field(default_factory=list)
    design_type_detected: str = ""
    critical_count: int = 0
    warning_count: int = 0
    suggestion_count: int = 0
    confidence: float = 0.0
    error: str = ""


class DesignChecklist(_LLMClientMixin):
    """V2: Context-aware 'did you forget?' design checklist.

    Analyses the design to detect what kind of circuit it is (USB device,
    motor controller, RF front-end, etc.) then checks for commonly forgotten
    items appropriate to that design type: TVS diodes on USB lines, series
    resistors on reset pins, test points on critical nets, pull-up resistors,
    ESD protection on external connectors, bulk capacitors near regulators,
    fiducial marks on the board, and more.
    """

    async def check_forgotten_items(
        self,
        schematic_context: dict[str, Any],
        board_context: dict[str, Any],
    ) -> ChecklistReport:
        """Check for commonly forgotten design items.

        Args:
            schematic_context: Schematic data with components, nets, connectors.
            board_context: Board layout data with placement info.

        Returns:
            ChecklistReport listing checked and missing items.
        """
        system = (
            "You are a senior PCB design reviewer performing a 'did you forget?' "
            "checklist review. First identify the design type from the schematic, "
            "then check for ALL commonly forgotten items.\n\n"
            "Always check these categories:\n"
            "- ESD/TVS protection on ALL external-facing connectors (USB, Ethernet, "
            "  GPIO headers, antenna ports)\n"
            "- Series resistors on reset and enable pins\n"
            "- Test points on critical signals (power rails, clocks, data buses)\n"
            "- Pull-up/pull-down resistors where required (I2C, SPI CS, open-drain)\n"
            "- Bulk capacitors near voltage regulators (not just MLCC)\n"
            "- Decoupling caps on EVERY power pin of EVERY IC\n"
            "- Fiducial marks (at least 3 for pick-and-place)\n"
            "- Mounting holes with proper clearance\n"
            "- Power indicator LED\n"
            "- Reverse polarity protection on DC input\n"
            "- Ferrite beads on analog power supply pins\n"
            "- Thermal relief on high-current pads\n"
            "- Solder jumpers or 0-ohm resistors for configuration options\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  checked_items: [{category, description, component_ref, status}]\n"
            "  missing_items: [{category, description, severity, rationale, "
            "    typical_solution, affected_net_or_component}]\n"
            "  design_type_detected: <string>\n"
            "  critical_count: <int>\n"
            "  warning_count: <int>\n"
            "  suggestion_count: <int>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Schematic context:\n{json.dumps(schematic_context, indent=2)}\n\n"
            f"Board context:\n{json.dumps(board_context, indent=2)}\n\n"
            "Identify the design type and check for all commonly forgotten items."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return ChecklistReport(error=f"LLM response parse error: {raw[:500]}")
            return self._map_report(data)
        except Exception as exc:
            logger.error("check_forgotten_items failed: %s", exc)
            return ChecklistReport(error=str(exc))

    @staticmethod
    def _map_report(data: dict[str, Any]) -> ChecklistReport:
        checked = [
            CheckedItem(
                category=c.get("category", ""),
                description=c.get("description", ""),
                component_ref=c.get("component_ref", ""),
                status=c.get("status", "present"),
            )
            for c in data.get("checked_items", [])
        ]
        missing = [
            MissingItem(
                category=m.get("category", ""),
                description=m.get("description", ""),
                severity=m.get("severity", "warning"),
                rationale=m.get("rationale", ""),
                typical_solution=m.get("typical_solution", ""),
                affected_net_or_component=m.get("affected_net_or_component", ""),
            )
            for m in data.get("missing_items", [])
        ]
        return ChecklistReport(
            checked_items=checked,
            missing_items=missing,
            design_type_detected=data.get("design_type_detected", ""),
            critical_count=int(data.get("critical_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            suggestion_count=int(data.get("suggestion_count", 0)),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V3: ApplicationComplianceChecker
# ===========================================================================


@dataclass
class ComplianceRequirement:
    """A single compliance requirement and its assessment."""

    clause: str = ""
    description: str = ""
    status: str = "unknown"  # pass, fail, partial, not_applicable
    evidence: str = ""
    gap_description: str = ""
    remediation: str = ""
    severity: str = "mandatory"  # mandatory, recommended, informational


@dataclass
class ApplicationComplianceReport:
    """Result of V3 application compliance check."""

    standard: str = ""
    classification: str = ""
    requirements: list[ComplianceRequirement] = field(default_factory=list)
    pass_count: int = 0
    fail_count: int = 0
    partial_count: int = 0
    overall_status: str = "unknown"  # compliant, non_compliant, needs_review
    summary: str = ""
    confidence: float = 0.0
    error: str = ""


class ApplicationComplianceChecker(_LLMClientMixin):
    """V3: Check design compliance against industry standards.

    Supports IEC-60601-1 (medical), ISO-26262 (automotive), DO-254 (avionics),
    and other standards. Analyses the board design for creepage/clearance,
    isolation, redundancy, fault tolerance, and documentation requirements.
    """

    async def check_application_compliance(
        self,
        board_context: dict[str, Any],
        standard: str,
        classification: str = "",
    ) -> ApplicationComplianceReport:
        """Check board design against a compliance standard.

        Args:
            board_context: Board layout and design data.
            standard: Standard to check against (e.g. "IEC-60601-1",
                "ISO-26262", "DO-254").
            classification: Safety classification within the standard
                (e.g. "ASIL-B", "Class II", "DAL-C").

        Returns:
            ApplicationComplianceReport with per-clause assessment.
        """
        standard_guidance = self._get_standard_guidance(standard)
        system = (
            "You are a regulatory compliance engineer specialising in electronics "
            "safety standards. You have deep knowledge of IEC-60601-1 (medical), "
            "ISO-26262 (automotive functional safety), DO-254 (airborne electronic "
            "hardware), IPC standards, and UL/CSA requirements.\n\n"
            f"You are checking compliance against: {standard}"
            f"{f' classification {classification}' if classification else ''}.\n\n"
            f"{standard_guidance}\n\n"
            "For each applicable clause, determine if the design meets the "
            "requirement based on the provided board data. When evidence is "
            "insufficient, mark as 'needs_review' rather than guessing.\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  standard: <string>\n"
            "  classification: <string>\n"
            "  requirements: [{clause, description, status, evidence, "
            "    gap_description, remediation, severity}]\n"
            "  pass_count: <int>\n"
            "  fail_count: <int>\n"
            "  partial_count: <int>\n"
            "  overall_status: <compliant|non_compliant|needs_review>\n"
            "  summary: <string>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Board context:\n{json.dumps(board_context, indent=2)}\n\n"
            f"Check compliance against {standard}"
            f"{f' ({classification})' if classification else ''}.\n"
            "Assess each applicable requirement clause."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return ApplicationComplianceReport(
                    error=f"LLM response parse error: {raw[:500]}"
                )
            return self._map_report(data)
        except Exception as exc:
            logger.error("check_application_compliance failed: %s", exc)
            return ApplicationComplianceReport(error=str(exc))

    @staticmethod
    def _get_standard_guidance(standard: str) -> str:
        std = standard.upper().replace(" ", "")
        if "60601" in std or "MEDICAL" in std:
            return (
                "Key IEC-60601-1 clauses for PCB design:\n"
                "- Clause 8.4: Creepage and clearance distances (Table 11/12)\n"
                "- Clause 8.5: Solid insulation requirements\n"
                "- Clause 8.7: Working voltage classification (MOPP/MOOP)\n"
                "- Clause 8.8: Protective earth connections\n"
                "- Clause 11: Temperature limits for components and enclosure\n"
                "- Clause 13: Hazardous situations and fault conditions\n"
                "- Clause 15: EMC immunity requirements per IEC-60601-1-2"
            )
        if "26262" in std or "AUTOMOTIVE" in std:
            return (
                "Key ISO-26262 clauses for hardware design:\n"
                "- Part 5, Clause 7: Hardware safety requirements specification\n"
                "- Part 5, Clause 8: Hardware architectural metrics (SPFM, LFM)\n"
                "- Part 5, Clause 9: Safety analysis (FMEA/FTA)\n"
                "- Part 5, Clause 10: Hardware integration and verification\n"
                "- Redundancy requirements per ASIL level\n"
                "- Diagnostic coverage for random hardware faults\n"
                "- Safe state definition and fault-tolerant time interval"
            )
        if "DO-254" in std or "254" in std or "AVIONICS" in std:
            return (
                "Key DO-254 requirements for hardware design:\n"
                "- Section 5: Hardware design lifecycle\n"
                "- Section 6: Design assurance level (DAL) requirements\n"
                "- Section 7: Validation and verification\n"
                "- Section 9: Configuration management\n"
                "- Component obsolescence and COTS usage\n"
                "- Environmental qualification (DO-160)\n"
                "- Hardware/software interface requirements"
            )
        return f"Check against key requirements of {standard}."

    @staticmethod
    def _map_report(data: dict[str, Any]) -> ApplicationComplianceReport:
        reqs = [
            ComplianceRequirement(
                clause=r.get("clause", ""),
                description=r.get("description", ""),
                status=r.get("status", "unknown"),
                evidence=r.get("evidence", ""),
                gap_description=r.get("gap_description", ""),
                remediation=r.get("remediation", ""),
                severity=r.get("severity", "mandatory"),
            )
            for r in data.get("requirements", [])
        ]
        return ApplicationComplianceReport(
            standard=data.get("standard", ""),
            classification=data.get("classification", ""),
            requirements=reqs,
            pass_count=int(data.get("pass_count", 0)),
            fail_count=int(data.get("fail_count", 0)),
            partial_count=int(data.get("partial_count", 0)),
            overall_status=data.get("overall_status", "unknown"),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V4: CrossDomainVerifier
# ===========================================================================


@dataclass
class CrossDomainIssue:
    """A layout-vs-schematic intent mismatch."""

    category: str = ""  # star_ground, sense_trace, ground_mixing, return_path, thermal, placement
    description: str = ""
    schematic_intent: str = ""
    layout_reality: str = ""
    affected_nets: list[str] = field(default_factory=list)
    affected_components: list[str] = field(default_factory=list)
    severity: str = "warning"
    recommendation: str = ""


@dataclass
class CrossDomainReport:
    """Result of V4 cross-domain verification."""

    issues: list[CrossDomainIssue] = field(default_factory=list)
    verified_intents: list[str] = field(default_factory=list)
    error_count: int = 0
    warning_count: int = 0
    summary: str = ""
    confidence: float = 0.0
    error: str = ""


class CrossDomainVerifier(_LLMClientMixin):
    """V4: Verify layout implements schematic intent correctly.

    Catches issues where the layout is technically DRC-clean but violates the
    design intent: star-ground topology bypassed by copper pour, Kelvin sense
    traces routed through noisy areas, analog and digital ground planes mixed
    under sensitive components, return current paths crossing split planes, etc.
    """

    async def verify_cross_domain(
        self,
        schematic_context: dict[str, Any],
        board_context: dict[str, Any],
    ) -> CrossDomainReport:
        """Verify layout faithfully implements schematic intent.

        Args:
            schematic_context: Schematic with annotated design intent (ground
                topology, sensitive nets, matching requirements).
            board_context: Board layout with copper pours, component placement,
                trace routing, and layer stack-up.

        Returns:
            CrossDomainReport with intent-vs-reality mismatches.
        """
        system = (
            "You are a senior PCB layout reviewer who specialises in verifying that "
            "the physical layout correctly implements the schematic designer's intent. "
            "You look beyond basic DRC to find functional issues.\n\n"
            "Check for these cross-domain issues:\n"
            "1. STAR GROUND: If schematic shows star-ground topology, verify the layout "
            "   actually implements it. Ground pours that short separate ground paths "
            "   defeat the purpose of star grounding.\n"
            "2. SENSE TRACES: Kelvin/sense traces must be routed away from noisy "
            "   power traces and switching nodes. They should be thin, direct, and "
            "   shielded if possible.\n"
            "3. GROUND MIXING: Analog ground (AGND) and digital ground (DGND) should "
            "   only connect at a single defined point. Check that ground pours don't "
            "   accidentally bridge them elsewhere.\n"
            "4. RETURN PATHS: High-speed signal return currents must have a continuous "
            "   reference plane. Flag traces that cross plane splits.\n"
            "5. THERMAL: Heat-generating components should not be placed near "
            "   temperature-sensitive parts (voltage references, crystal oscillators).\n"
            "6. PLACEMENT: Components that the schematic groups together functionally "
            "   should be placed close together on the board.\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  issues: [{category, description, schematic_intent, layout_reality, "
            "    affected_nets, affected_components, severity, recommendation}]\n"
            "  verified_intents: [<string>]  -- intents confirmed as correctly implemented\n"
            "  error_count: <int>\n"
            "  warning_count: <int>\n"
            "  summary: <string>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Schematic context (with design intent annotations):\n"
            f"{json.dumps(schematic_context, indent=2)}\n\n"
            f"Board layout context:\n{json.dumps(board_context, indent=2)}\n\n"
            "Verify that the layout implements all schematic intents correctly."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return CrossDomainReport(error=f"LLM response parse error: {raw[:500]}")
            return self._map_report(data)
        except Exception as exc:
            logger.error("verify_cross_domain failed: %s", exc)
            return CrossDomainReport(error=str(exc))

    @staticmethod
    def _map_report(data: dict[str, Any]) -> CrossDomainReport:
        issues = [
            CrossDomainIssue(
                category=i.get("category", ""),
                description=i.get("description", ""),
                schematic_intent=i.get("schematic_intent", ""),
                layout_reality=i.get("layout_reality", ""),
                affected_nets=i.get("affected_nets", []),
                affected_components=i.get("affected_components", []),
                severity=i.get("severity", "warning"),
                recommendation=i.get("recommendation", ""),
            )
            for i in data.get("issues", [])
        ]
        return CrossDomainReport(
            issues=issues,
            verified_intents=data.get("verified_intents", []),
            error_count=int(data.get("error_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V5: DatasheetLayoutComplianceChecker
# ===========================================================================


@dataclass
class DatasheetLayoutRule:
    """A layout rule extracted from a component datasheet."""

    rule_type: str = ""  # pad_geometry, thermal_via, trace_width, placement, keepout, copper_pour
    datasheet_text: str = ""
    requirement: str = ""
    board_value: str = ""
    status: str = "unknown"  # pass, fail, warning, not_checked
    deviation: str = ""
    recommendation: str = ""


@dataclass
class DatasheetComplianceReport:
    """Result of V5 datasheet layout compliance check."""

    component_ref: str = ""
    component_mpn: str = ""
    rules: list[DatasheetLayoutRule] = field(default_factory=list)
    pass_count: int = 0
    fail_count: int = 0
    warning_count: int = 0
    critical_issues: list[str] = field(default_factory=list)
    summary: str = ""
    confidence: float = 0.0
    error: str = ""


class DatasheetLayoutComplianceChecker(_LLMClientMixin):
    """V5: Check board layout against datasheet recommendations.

    Extracts layout recommendations from the component datasheet (thermal pad
    geometry, via patterns, trace widths, keepout zones, copper pour requirements)
    and verifies the actual board layout follows them.
    """

    async def check_datasheet_compliance(
        self,
        component_ref: str,
        component_mpn: str,
        board_context: dict[str, Any],
    ) -> DatasheetComplianceReport:
        """Check layout compliance with datasheet recommendations.

        Args:
            component_ref: Reference designator (e.g. "U3").
            component_mpn: Manufacturer part number for datasheet lookup.
            board_context: Board layout data around the component including
                pad geometry, vias, trace widths, and copper areas.

        Returns:
            DatasheetComplianceReport with per-rule assessment.
        """
        system = (
            "You are a PCB layout engineer who meticulously checks layouts against "
            "component datasheet recommendations. You know the typical layout "
            "guidelines for common IC families.\n\n"
            f"Component: {component_mpn} (ref: {component_ref})\n\n"
            "Based on your knowledge of this component (or similar components in the "
            "same family), extract the key layout recommendations and check the "
            "provided board layout against each one.\n\n"
            "Typical datasheet layout rules to check:\n"
            "- Exposed/thermal pad: correct size, solder paste coverage (typically "
            "  50-80%% window pattern), thermal vias (count, size, pitch)\n"
            "- Decoupling capacitor placement: distance from power pins, via "
            "  connections to ground plane\n"
            "- Input/output capacitor placement and trace routing\n"
            "- Trace width for power connections vs signal connections\n"
            "- Keepout zones around sensitive pins (e.g. high-impedance FB pin on "
            "  switching regulators)\n"
            "- Ground plane continuity under the IC\n"
            "- Component orientation relative to airflow (if thermal)\n"
            "- Recommended land pattern vs actual footprint dimensions\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  component_ref: <string>\n"
            "  component_mpn: <string>\n"
            "  rules: [{rule_type, datasheet_text, requirement, board_value, "
            "    status, deviation, recommendation}]\n"
            "  pass_count: <int>\n"
            "  fail_count: <int>\n"
            "  warning_count: <int>\n"
            "  critical_issues: [<string>]\n"
            "  summary: <string>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Component: {component_mpn} (reference designator: {component_ref})\n\n"
            f"Board layout context around this component:\n"
            f"{json.dumps(board_context, indent=2)}\n\n"
            "Check the layout against all known datasheet recommendations for this "
            "component. For each rule, state the datasheet requirement, what the "
            "board actually has, and whether it passes."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return DatasheetComplianceReport(
                    component_ref=component_ref,
                    component_mpn=component_mpn,
                    error=f"LLM response parse error: {raw[:500]}",
                )
            return self._map_report(data, component_ref, component_mpn)
        except Exception as exc:
            logger.error("check_datasheet_compliance failed: %s", exc)
            return DatasheetComplianceReport(
                component_ref=component_ref,
                component_mpn=component_mpn,
                error=str(exc),
            )

    @staticmethod
    def _map_report(
        data: dict[str, Any], ref: str, mpn: str
    ) -> DatasheetComplianceReport:
        rules = [
            DatasheetLayoutRule(
                rule_type=r.get("rule_type", ""),
                datasheet_text=r.get("datasheet_text", ""),
                requirement=r.get("requirement", ""),
                board_value=r.get("board_value", ""),
                status=r.get("status", "unknown"),
                deviation=r.get("deviation", ""),
                recommendation=r.get("recommendation", ""),
            )
            for r in data.get("rules", [])
        ]
        return DatasheetComplianceReport(
            component_ref=data.get("component_ref", ref),
            component_mpn=data.get("component_mpn", mpn),
            rules=rules,
            pass_count=int(data.get("pass_count", 0)),
            fail_count=int(data.get("fail_count", 0)),
            warning_count=int(data.get("warning_count", 0)),
            critical_issues=data.get("critical_issues", []),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V6: SIPreFlightChecker
# ===========================================================================


@dataclass
class SINetAssessment:
    """Signal integrity pre-flight assessment for a single net."""

    net_name: str = ""
    signal_type: str = ""  # clock, data, differential, single_ended
    data_rate_gbps: float = 0.0
    frequency_ghz: float = 0.0
    trace_length_mm: float = 0.0
    wavelength_fraction: str = ""
    needs_termination: bool = False
    termination_recommendation: str = ""
    estimated_loss_db: float = 0.0
    loss_explanation: str = ""
    impedance_target_ohm: float = 0.0
    via_stub_concern: bool = False
    via_stub_explanation: str = ""
    risk_level: str = "low"  # low, medium, high, critical
    explanation: str = ""
    recommendations: list[str] = field(default_factory=list)


@dataclass
class SIPreFlightReport:
    """Result of V6 SI pre-flight check."""

    net_assessments: list[SINetAssessment] = field(default_factory=list)
    high_risk_nets: list[str] = field(default_factory=list)
    board_technology_limits: str = ""
    overall_risk: str = "low"
    summary: str = ""
    confidence: float = 0.0
    error: str = ""


class SIPreFlightChecker(_LLMClientMixin):
    """V6: Pre-simulation signal integrity sanity check.

    Before running expensive SI simulations, this checker provides a quick
    assessment of which nets need attention, with educational explanations
    of loss at frequency, wavelength context (is the trace electrically long?),
    termination needs, and via stub concerns.
    """

    async def si_preflight(
        self,
        board_context: dict[str, Any],
        net_contexts: list[dict[str, Any]],
    ) -> SIPreFlightReport:
        """Run SI pre-flight check on specified nets.

        Args:
            board_context: Board stack-up, material properties (Dk, Df),
                layer count, via structure.
            net_contexts: List of net descriptions, each with net_name,
                signal_type, data_rate or frequency, trace_length, layer
                transitions, and via count.

        Returns:
            SIPreFlightReport with per-net assessment and explanations.
        """
        system = (
            "You are a signal integrity engineer performing a pre-flight check "
            "before running full-wave SI simulations. Your goal is to quickly "
            "identify high-risk nets and explain WHY they need attention.\n\n"
            "For each net, analyse:\n"
            "1. ELECTRICAL LENGTH: Calculate wavelength at the knee frequency "
            "   (f_knee = 0.35/t_rise for digital, or carrier frequency for RF). "
            "   If trace length > lambda/10, it is electrically long and needs "
            "   controlled impedance and possibly termination.\n"
            "2. LOSS ESTIMATE: Estimate conductor loss (skin effect) and dielectric "
            "   loss at the signal frequency. Express in dB and explain whether the "
            "   eye diagram will close.\n"
            "3. TERMINATION: Based on electrical length and driver/receiver type, "
            "   recommend series, parallel, AC, or no termination.\n"
            "4. VIA STUBS: For through-hole vias on inner-layer signals, estimate "
            "   stub resonance frequency. Flag if it falls near the signal bandwidth.\n"
            "5. CROSSTALK RISK: Based on trace spacing and parallel run length, "
            "   estimate near-end and far-end crosstalk risk.\n\n"
            "Provide educational explanations, not just pass/fail.\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  net_assessments: [{net_name, signal_type, data_rate_gbps, "
            "    frequency_ghz, trace_length_mm, wavelength_fraction, "
            "    needs_termination, termination_recommendation, estimated_loss_db, "
            "    loss_explanation, impedance_target_ohm, via_stub_concern, "
            "    via_stub_explanation, risk_level, explanation, recommendations}]\n"
            "  high_risk_nets: [<string>]\n"
            "  board_technology_limits: <string>\n"
            "  overall_risk: <low|medium|high|critical>\n"
            "  summary: <string>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Board context (stackup, materials):\n"
            f"{json.dumps(board_context, indent=2)}\n\n"
            f"Nets to assess:\n{json.dumps(net_contexts, indent=2)}\n\n"
            "Perform SI pre-flight assessment for each net. Show your calculations "
            "and explain the physics behind each concern."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return SIPreFlightReport(error=f"LLM response parse error: {raw[:500]}")
            return self._map_report(data)
        except Exception as exc:
            logger.error("si_preflight failed: %s", exc)
            return SIPreFlightReport(error=str(exc))

    @staticmethod
    def _map_report(data: dict[str, Any]) -> SIPreFlightReport:
        assessments = []
        for a in data.get("net_assessments", []):
            assessments.append(
                SINetAssessment(
                    net_name=a.get("net_name", ""),
                    signal_type=a.get("signal_type", ""),
                    data_rate_gbps=float(a.get("data_rate_gbps", 0.0)),
                    frequency_ghz=float(a.get("frequency_ghz", 0.0)),
                    trace_length_mm=float(a.get("trace_length_mm", 0.0)),
                    wavelength_fraction=a.get("wavelength_fraction", ""),
                    needs_termination=bool(a.get("needs_termination", False)),
                    termination_recommendation=a.get("termination_recommendation", ""),
                    estimated_loss_db=float(a.get("estimated_loss_db", 0.0)),
                    loss_explanation=a.get("loss_explanation", ""),
                    impedance_target_ohm=float(a.get("impedance_target_ohm", 0.0)),
                    via_stub_concern=bool(a.get("via_stub_concern", False)),
                    via_stub_explanation=a.get("via_stub_explanation", ""),
                    risk_level=a.get("risk_level", "low"),
                    explanation=a.get("explanation", ""),
                    recommendations=a.get("recommendations", []),
                )
            )
        return SIPreFlightReport(
            net_assessments=assessments,
            high_risk_nets=data.get("high_risk_nets", []),
            board_technology_limits=data.get("board_technology_limits", ""),
            overall_risk=data.get("overall_risk", "low"),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )


# ===========================================================================
# V7: PDNReviewer
# ===========================================================================


@dataclass
class DecapAssessment:
    """Assessment of a single decoupling capacitor."""

    component_ref: str = ""
    value: str = ""
    distance_to_ic_mm: float = 0.0
    max_recommended_mm: float = 0.0
    via_count: int = 0
    via_recommendation: str = ""
    effective_frequency_range: str = ""
    status: str = "ok"  # ok, too_far, wrong_value, missing_via, suboptimal


@dataclass
class PowerNetAssessment:
    """Assessment of a single power net's delivery network."""

    net_name: str = ""
    voltage: float = 0.0
    estimated_current_a: float = 0.0
    trace_width_mm: float = 0.0
    required_trace_width_mm: float = 0.0
    trace_width_status: str = "ok"  # ok, too_narrow, marginal
    via_count: int = 0
    via_current_capacity_a: float = 0.0
    via_status: str = "ok"
    decaps: list[DecapAssessment] = field(default_factory=list)
    plane_coverage: str = ""
    impedance_estimate: str = ""
    risk_level: str = "low"
    issues: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)


@dataclass
class PDNReviewReport:
    """Result of V7 PDN review."""

    power_net_assessments: list[PowerNetAssessment] = field(default_factory=list)
    overall_pdn_quality: str = "unknown"  # good, acceptable, needs_work, poor
    decap_strategy_summary: str = ""
    critical_issues: list[str] = field(default_factory=list)
    summary: str = ""
    confidence: float = 0.0
    error: str = ""


class PDNReviewer(_LLMClientMixin):
    """V7: Power delivery network review.

    Analyses decoupling capacitor placement (distance from IC, via connections),
    power trace widths, via count and current capacity, plane coverage, and
    overall PDN impedance strategy for each power net.
    """

    async def review_pdn(
        self,
        board_context: dict[str, Any],
        power_nets: list[dict[str, Any]],
    ) -> PDNReviewReport:
        """Review power delivery network quality.

        Args:
            board_context: Board stackup, layer assignment, copper weight.
            power_nets: List of power nets with name, voltage, current,
                connected ICs, decap locations, trace widths, and via info.

        Returns:
            PDNReviewReport with per-net assessment and overall quality score.
        """
        system = (
            "You are a power integrity engineer reviewing a PCB's power delivery "
            "network (PDN). You evaluate decoupling strategy, trace sizing, via "
            "current capacity, and plane utilisation.\n\n"
            "For each power net, analyse:\n"
            "1. DECOUPLING CAPACITORS:\n"
            "   - Distance from each decap to the IC power pin (should be < 3mm for "
            "     high-frequency caps, < 10mm for bulk caps)\n"
            "   - Via connections (each decap needs low-inductance vias to the ground "
            "     plane; 2 vias minimum for caps 100nF and smaller)\n"
            "   - Value distribution (ensure coverage from DC to hundreds of MHz: "
            "     bulk electrolytic -> 10uF MLCC -> 1uF -> 100nF -> optional 10nF)\n"
            "   - Self-resonance frequency coverage (no gaps in impedance profile)\n"
            "2. TRACE WIDTH:\n"
            "   - Calculate required width using IPC-2152 for the given current and "
            "     copper weight. Account for temperature rise (typically 10-20C max).\n"
            "3. VIA CURRENT:\n"
            "   - Each standard via (0.3mm drill) carries ~0.5-1A depending on "
            "     copper weight. Check total via count supports the net current.\n"
            "4. PLANE COVERAGE:\n"
            "   - Power planes should have minimal slots/splits near IC power pins.\n"
            "   - Anti-pads from signal vias should not create bottlenecks.\n\n"
            "Output ONLY valid JSON with keys:\n"
            "  power_net_assessments: [{net_name, voltage, estimated_current_a, "
            "    trace_width_mm, required_trace_width_mm, trace_width_status, "
            "    via_count, via_current_capacity_a, via_status, "
            "    decaps: [{component_ref, value, distance_to_ic_mm, "
            "      max_recommended_mm, via_count, via_recommendation, "
            "      effective_frequency_range, status}], "
            "    plane_coverage, impedance_estimate, risk_level, issues, "
            "    recommendations}]\n"
            "  overall_pdn_quality: <good|acceptable|needs_work|poor>\n"
            "  decap_strategy_summary: <string>\n"
            "  critical_issues: [<string>]\n"
            "  summary: <string>\n"
            "  confidence: <float 0-1>"
        )
        prompt = (
            f"Board context (stackup, copper weight):\n"
            f"{json.dumps(board_context, indent=2)}\n\n"
            f"Power nets to review:\n{json.dumps(power_nets, indent=2)}\n\n"
            "Review the PDN for each power net. Calculate trace width requirements, "
            "assess decap placement, and check via current capacity."
        )

        try:
            raw = await self._llm_call(prompt, system)
            data = self._parse_json(raw)
            if "_parse_error" in data:
                return PDNReviewReport(error=f"LLM response parse error: {raw[:500]}")
            return self._map_report(data)
        except Exception as exc:
            logger.error("review_pdn failed: %s", exc)
            return PDNReviewReport(error=str(exc))

    @staticmethod
    def _map_report(data: dict[str, Any]) -> PDNReviewReport:
        net_assessments = []
        for n in data.get("power_net_assessments", []):
            decaps = [
                DecapAssessment(
                    component_ref=d.get("component_ref", ""),
                    value=d.get("value", ""),
                    distance_to_ic_mm=float(d.get("distance_to_ic_mm", 0.0)),
                    max_recommended_mm=float(d.get("max_recommended_mm", 0.0)),
                    via_count=int(d.get("via_count", 0)),
                    via_recommendation=d.get("via_recommendation", ""),
                    effective_frequency_range=d.get("effective_frequency_range", ""),
                    status=d.get("status", "ok"),
                )
                for d in n.get("decaps", [])
            ]
            net_assessments.append(
                PowerNetAssessment(
                    net_name=n.get("net_name", ""),
                    voltage=float(n.get("voltage", 0.0)),
                    estimated_current_a=float(n.get("estimated_current_a", 0.0)),
                    trace_width_mm=float(n.get("trace_width_mm", 0.0)),
                    required_trace_width_mm=float(n.get("required_trace_width_mm", 0.0)),
                    trace_width_status=n.get("trace_width_status", "ok"),
                    via_count=int(n.get("via_count", 0)),
                    via_current_capacity_a=float(n.get("via_current_capacity_a", 0.0)),
                    via_status=n.get("via_status", "ok"),
                    decaps=decaps,
                    plane_coverage=n.get("plane_coverage", ""),
                    impedance_estimate=n.get("impedance_estimate", ""),
                    risk_level=n.get("risk_level", "low"),
                    issues=n.get("issues", []),
                    recommendations=n.get("recommendations", []),
                )
            )
        return PDNReviewReport(
            power_net_assessments=net_assessments,
            overall_pdn_quality=data.get("overall_pdn_quality", "unknown"),
            decap_strategy_summary=data.get("decap_strategy_summary", ""),
            critical_issues=data.get("critical_issues", []),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )
