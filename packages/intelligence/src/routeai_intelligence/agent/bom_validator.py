"""BOM Validator - Validates bill of materials against schematic and design rules.

Checks for wrong dielectric types, insufficient voltage ratings, thermal derating,
obsolete/NRND components, missing components, and suggests alternatives.
"""

from __future__ import annotations

import json
import logging
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class IssueSeverity(str, Enum):
    """Severity levels for BOM validation issues."""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class IssueCategory(str, Enum):
    """Categories of BOM validation issues."""
    VOLTAGE_RATING = "voltage_rating"
    DIELECTRIC_TYPE = "dielectric_type"
    THERMAL_DERATING = "thermal_derating"
    OBSOLETE_PART = "obsolete_part"
    MISSING_COMPONENT = "missing_component"
    FOOTPRINT_MISMATCH = "footprint_mismatch"
    VALUE_MISMATCH = "value_mismatch"
    TOLERANCE = "tolerance"
    POWER_RATING = "power_rating"
    AVAILABILITY = "availability"
    COST = "cost"
    SINGLE_SOURCE = "single_source"
    DECOUPLING = "decoupling"
    PROTECTION = "protection"


class BOMIssue(BaseModel):
    """A single issue found during BOM validation."""
    id: str
    severity: IssueSeverity
    category: IssueCategory
    component_ref: str = Field(description="Component reference designator")
    component_mpn: str = Field(default="", description="Manufacturer part number")
    description: str = Field(description="Human-readable issue description")
    detail: str = Field(default="", description="Detailed technical explanation")
    fix_suggestion: str = Field(default="", description="Suggested fix")
    citation: str = Field(default="", description="Standard or datasheet reference")


class BOMSuggestion(BaseModel):
    """A proactive suggestion for BOM improvement."""
    id: str
    category: str
    description: str
    affected_components: list[str]
    benefit: str
    implementation: str


class BOMValidationReport(BaseModel):
    """Complete BOM validation report."""
    issues: list[BOMIssue] = Field(default_factory=list)
    warnings: list[BOMIssue] = Field(default_factory=list)
    suggestions: list[BOMSuggestion] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    passed: bool = Field(default=True)


class Alternative(BaseModel):
    """An alternative component suggestion."""
    mpn: str
    manufacturer: str
    description: str
    reason: str = Field(description="Why this is suggested as an alternative")
    compatibility: str = Field(
        default="drop-in",
        description="Compatibility level: drop-in, footprint_change, circuit_change",
    )
    price: float | None = None
    availability: str = Field(default="unknown")
    trade_offs: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Known component lifecycle status
# ---------------------------------------------------------------------------

_OBSOLETE_PARTS: dict[str, str] = {
    "LM7805": "NRND - consider using modern LDO or buck converter",
    "LM317T": "Active but aging - consider AP2112K or similar for new designs",
    "NE555": "Active but consider CMOS variant LMC555 for lower power",
    "LM358N": "Active but DIP package - consider LM358DR (SOIC) for SMD designs",
    "AT24C02": "Active but limited sources - consider 24LC02B as second source",
}

# Capacitor dielectric guidelines per application
_DIELECTRIC_GUIDELINES: dict[str, dict[str, Any]] = {
    "decoupling": {
        "recommended": ["X5R", "X7R", "C0G"],
        "avoid": ["Y5V", "Z5U"],
        "reason": "Decoupling caps need stable capacitance across temperature and voltage bias",
        "citation": "Application Note - MLCC Selection for Decoupling",
    },
    "timing": {
        "recommended": ["C0G", "NP0"],
        "avoid": ["X5R", "X7R", "Y5V", "Z5U"],
        "reason": "Timing circuits require minimal capacitance variation with temperature",
        "citation": "IEC 60384-21 - Fixed capacitors for timing applications",
    },
    "power_input": {
        "recommended": ["X5R", "X7R"],
        "avoid": ["Y5V", "Z5U"],
        "reason": "Input capacitors for regulators must maintain capacitance under DC bias",
        "citation": "Regulator manufacturer application notes",
    },
    "power_output": {
        "recommended": ["X5R", "X7R"],
        "avoid": ["Y5V", "Z5U"],
        "reason": "Output capacitors for regulators affect stability; ESR and capacitance must be stable",
        "citation": "Regulator manufacturer application notes - output capacitor requirements",
    },
}

# Voltage derating guidelines
_VOLTAGE_DERATING_RULES: dict[str, float] = {
    "mlcc_ceramic": 0.5,       # Use cap at max 50% of rated voltage for MLCCs
    "electrolytic": 0.8,       # 80% derating for electrolytics
    "tantalum": 0.5,           # 50% derating for tantalum (failure risk)
    "film": 0.8,               # 80% for film caps
    "semiconductor": 0.8,      # 80% for semiconductor voltage ratings
}


# ---------------------------------------------------------------------------
# Main validator class
# ---------------------------------------------------------------------------


class BOMValidator:
    """Validates BOM against schematic and design best practices.

    Checks include:
    - Wrong dielectric for decoupling applications
    - Insufficient voltage ratings with derating
    - Thermal derating concerns
    - Obsolete or NRND components
    - Missing components (decoupling caps, ESD protection)
    - Footprint mismatches
    - Single-source risk

    Args:
        agent: Optional RouteAIAgent for LLM-powered deep validation.
    """

    def __init__(self, agent: Any | None = None) -> None:
        self._agent = agent
        self._issue_counter = 0

    def _next_issue_id(self) -> str:
        self._issue_counter += 1
        return f"BOM_{self._issue_counter:04d}"

    async def validate(
        self,
        bom: list[dict[str, Any]],
        schematic: dict[str, Any],
    ) -> BOMValidationReport:
        """Validate the BOM against the schematic.

        Args:
            bom: List of BOM entries, each with keys:
                reference, mpn, value, footprint, description, quantity,
                manufacturer, specs (dict), supplier_status
            schematic: Serialized schematic dict with components, nets.

        Returns:
            BOMValidationReport with issues, warnings, and suggestions.
        """
        self._issue_counter = 0
        issues: list[BOMIssue] = []
        warnings: list[BOMIssue] = []
        suggestions: list[BOMSuggestion] = []

        schematic_components = schematic.get("components", [])
        schematic_nets = schematic.get("nets", [])

        # Build reference map
        bom_refs = {entry.get("reference", ""): entry for entry in bom}
        schematic_refs = {comp.get("reference", ""): comp for comp in schematic_components}

        # 1. Check for missing BOM entries
        missing_issues = self._check_missing_components(bom_refs, schematic_refs)
        for issue in missing_issues:
            if issue.severity == IssueSeverity.ERROR:
                issues.append(issue)
            else:
                warnings.append(issue)

        # 2. Check voltage ratings
        voltage_issues = self._check_voltage_ratings(bom, schematic_nets)
        for issue in voltage_issues:
            if issue.severity == IssueSeverity.ERROR:
                issues.append(issue)
            else:
                warnings.append(issue)

        # 3. Check dielectric types
        dielectric_issues = self._check_dielectric_types(bom, schematic_nets, schematic_refs)
        for issue in dielectric_issues:
            if issue.severity == IssueSeverity.ERROR:
                issues.append(issue)
            else:
                warnings.append(issue)

        # 4. Check for obsolete/NRND parts
        lifecycle_issues = self._check_lifecycle_status(bom)
        for issue in lifecycle_issues:
            warnings.append(issue)

        # 5. Check thermal derating
        thermal_issues = self._check_thermal_derating(bom)
        for issue in thermal_issues:
            warnings.append(issue)

        # 6. Check footprint consistency
        footprint_issues = self._check_footprint_consistency(bom_refs, schematic_refs)
        for issue in footprint_issues:
            warnings.append(issue)

        # 7. Check for missing decoupling caps
        decoupling_suggestions = self._check_decoupling_caps(bom, schematic_components, schematic_nets)
        suggestions.extend(decoupling_suggestions)

        # 8. Check for missing ESD protection
        esd_suggestions = self._check_esd_protection(bom, schematic_nets)
        suggestions.extend(esd_suggestions)

        # 9. Check power rating for resistors
        power_issues = self._check_power_ratings(bom)
        for issue in power_issues:
            warnings.append(issue)

        # 10. Single-source risk
        single_source = self._check_single_source(bom)
        suggestions.extend(single_source)

        # LLM enhancement
        if self._agent is not None:
            llm_issues, llm_suggestions = await self._llm_deep_validate(bom, schematic)
            issues.extend(llm_issues)
            suggestions.extend(llm_suggestions)

        passed = len(issues) == 0

        report = BOMValidationReport(
            issues=issues,
            warnings=warnings,
            suggestions=suggestions,
            summary={
                "total_bom_entries": len(bom),
                "total_schematic_components": len(schematic_components),
                "errors": len(issues),
                "warnings": len(warnings),
                "suggestions": len(suggestions),
                "passed": passed,
            },
            passed=passed,
        )

        return report

    async def suggest_alternatives(
        self,
        component: dict[str, Any],
        reason: str,
    ) -> list[Alternative]:
        """Suggest alternative components for a given part.

        Args:
            component: Component data dict with mpn, specs, footprint, etc.
            reason: Reason for seeking an alternative (e.g., "obsolete", "cost", "availability")

        Returns:
            List of Alternative suggestions.
        """
        alternatives: list[Alternative] = []
        mpn = component.get("mpn", "")
        category = component.get("category", "")
        specs = component.get("specs", {})
        footprint = component.get("footprint", "")

        # Built-in alternatives database
        alt_db: dict[str, list[dict[str, Any]]] = {
            "AMS1117-3.3": [
                {
                    "mpn": "AP2112K-3.3TRG1",
                    "manufacturer": "Diodes Inc",
                    "description": "3.3V 600mA LDO, lower dropout, lower IQ",
                    "compatibility": "footprint_change",
                    "price": 0.15,
                    "trade_offs": ["Lower max current (600mA vs 1A)", "Different pinout (SOT-23-5)"],
                },
                {
                    "mpn": "XC6220B331MR-G",
                    "manufacturer": "Torex",
                    "description": "3.3V 700mA LDO, ultra-low noise",
                    "compatibility": "footprint_change",
                    "price": 0.25,
                    "trade_offs": ["Higher cost", "SOT-23-5 package"],
                },
            ],
            "LM7805": [
                {
                    "mpn": "AMS1117-5.0",
                    "manufacturer": "Advanced Monolithic Systems",
                    "description": "5V 1A LDO, SMD replacement for 7805",
                    "compatibility": "footprint_change",
                    "price": 0.08,
                    "trade_offs": ["Lower dropout than 7805", "SMD package (SOT-223)"],
                },
                {
                    "mpn": "TPS54331",
                    "manufacturer": "Texas Instruments",
                    "description": "5V 3A buck converter for better efficiency",
                    "compatibility": "circuit_change",
                    "price": 1.20,
                    "trade_offs": ["Higher efficiency but needs inductor", "More complex circuit"],
                },
            ],
        }

        # Look up in alternatives database
        if mpn in alt_db:
            for alt_data in alt_db[mpn]:
                alternatives.append(Alternative(
                    mpn=alt_data["mpn"],
                    manufacturer=alt_data["manufacturer"],
                    description=alt_data["description"],
                    reason=f"Alternative for {mpn}: {reason}",
                    compatibility=alt_data.get("compatibility", "drop-in"),
                    price=alt_data.get("price"),
                    trade_offs=alt_data.get("trade_offs", []),
                ))

        # LDO generic alternatives
        if not alternatives and "ldo" in (component.get("description", "") + " " + category).lower():
            voltage = specs.get("output_voltage")
            current = specs.get("max_current_a", 1.0)

            if voltage and isinstance(voltage, (int, float)):
                if voltage == 3.3:
                    alternatives.append(Alternative(
                        mpn="AP2112K-3.3TRG1",
                        manufacturer="Diodes Inc",
                        description=f"3.3V {min(current, 0.6)}A LDO alternative",
                        reason=reason,
                        compatibility="footprint_change" if footprint != "SOT-23-5" else "drop-in",
                        price=0.15,
                        trade_offs=["600mA max output"],
                    ))
                if voltage == 1.8:
                    alternatives.append(Alternative(
                        mpn="AP2112K-1.8TRG1",
                        manufacturer="Diodes Inc",
                        description="1.8V 600mA LDO alternative",
                        reason=reason,
                        compatibility="footprint_change" if footprint != "SOT-23-5" else "drop-in",
                        price=0.15,
                    ))

        # Capacitor alternatives based on specs
        if not alternatives and "capacitor" in (component.get("description", "") + " " + category).lower():
            cap_nf = specs.get("capacitance_nf", 0)
            vrating = specs.get("voltage_rating_v", 0)
            if cap_nf > 0:
                # Suggest equivalent from different manufacturer
                alternatives.append(Alternative(
                    mpn=f"GRM-series-{int(cap_nf)}nF",
                    manufacturer="Murata",
                    description=f"{cap_nf}nF {vrating}V X7R ceramic capacitor (Murata equivalent)",
                    reason=f"Second-source alternative: {reason}",
                    compatibility="drop-in",
                    trade_offs=["May have slight ESR differences"],
                ))

        # LLM-powered alternative search
        if self._agent is not None:
            llm_alts = await self._llm_find_alternatives(component, reason, alternatives)
            alternatives.extend(llm_alts)

        return alternatives

    # ------------------------------------------------------------------
    # Validation checks
    # ------------------------------------------------------------------

    def _check_missing_components(
        self,
        bom_refs: dict[str, dict[str, Any]],
        schematic_refs: dict[str, dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check for components in schematic but missing from BOM."""
        issues: list[BOMIssue] = []

        for ref, comp in schematic_refs.items():
            if ref not in bom_refs:
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.ERROR,
                    category=IssueCategory.MISSING_COMPONENT,
                    component_ref=ref,
                    description=f"Component {ref} ({comp.get('value', '')}) is in schematic but missing from BOM",
                    fix_suggestion=f"Add {ref} to the BOM with correct MPN and specifications",
                ))

        # Check for BOM entries not in schematic
        for ref, entry in bom_refs.items():
            if ref not in schematic_refs:
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.MISSING_COMPONENT,
                    component_ref=ref,
                    component_mpn=entry.get("mpn", ""),
                    description=f"BOM entry {ref} ({entry.get('mpn', '')}) is not in the schematic",
                    fix_suggestion="Verify if this component was removed from the schematic or if the BOM is out of date",
                ))

        return issues

    def _check_voltage_ratings(
        self,
        bom: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check that component voltage ratings are adequate with derating."""
        issues: list[BOMIssue] = []

        # Build net voltage map from net names
        net_voltages: dict[str, float] = {}
        for net in nets:
            name = net.get("name", "")
            voltage = self._extract_voltage_from_name(name)
            if voltage is not None:
                net_voltages[name] = voltage

        for entry in bom:
            ref = entry.get("reference", "")
            specs = entry.get("specs", {})
            vrating = specs.get("voltage_rating_v")
            if not isinstance(vrating, (int, float)):
                continue

            # Determine applicable voltage for this component
            connected_nets = entry.get("connected_nets", [])
            max_voltage = 0.0
            for net_name in connected_nets:
                v = net_voltages.get(net_name, 0)
                max_voltage = max(max_voltage, abs(v))

            if max_voltage == 0:
                continue

            # Apply derating
            comp_type = self._determine_cap_type(entry)
            derating = _VOLTAGE_DERATING_RULES.get(comp_type, 0.8)
            derated_voltage = vrating * derating

            if max_voltage > derated_voltage:
                severity = IssueSeverity.ERROR if max_voltage > vrating * 0.9 else IssueSeverity.WARNING
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=severity,
                    category=IssueCategory.VOLTAGE_RATING,
                    component_ref=ref,
                    component_mpn=entry.get("mpn", ""),
                    description=(
                        f"{ref}: Voltage rating ({vrating}V) insufficient after "
                        f"{int(derating * 100)}% derating ({derated_voltage:.1f}V) "
                        f"for {max_voltage}V application"
                    ),
                    detail=(
                        f"Component {ref} rated at {vrating}V. After {comp_type} derating "
                        f"({int(derating * 100)}%), effective safe voltage is {derated_voltage:.1f}V. "
                        f"Applied voltage is {max_voltage}V."
                    ),
                    fix_suggestion=f"Use a component rated at least {max_voltage / derating:.0f}V",
                    citation=f"Voltage derating guideline for {comp_type}: operate at max {int(derating * 100)}% of rated voltage",
                ))

        return issues

    def _check_dielectric_types(
        self,
        bom: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        schematic_refs: dict[str, dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check capacitor dielectric types for their application."""
        issues: list[BOMIssue] = []

        for entry in bom:
            ref = entry.get("reference", "")
            if not ref.startswith("C"):
                continue

            specs = entry.get("specs", {})
            dielectric = specs.get("dielectric", "")
            if not dielectric:
                continue

            # Determine application from connected nets
            application = self._determine_cap_application(ref, entry, nets, schematic_refs)
            guidelines = _DIELECTRIC_GUIDELINES.get(application)

            if guidelines and dielectric in guidelines["avoid"]:
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.ERROR,
                    category=IssueCategory.DIELECTRIC_TYPE,
                    component_ref=ref,
                    component_mpn=entry.get("mpn", ""),
                    description=(
                        f"{ref}: {dielectric} dielectric not suitable for {application} application"
                    ),
                    detail=guidelines["reason"],
                    fix_suggestion=f"Use {' or '.join(guidelines['recommended'])} dielectric instead",
                    citation=guidelines["citation"],
                ))
            elif guidelines and dielectric not in guidelines["recommended"]:
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.DIELECTRIC_TYPE,
                    component_ref=ref,
                    component_mpn=entry.get("mpn", ""),
                    description=(
                        f"{ref}: {dielectric} dielectric may not be optimal for {application}; "
                        f"recommended: {', '.join(guidelines['recommended'])}"
                    ),
                    detail=guidelines["reason"],
                    fix_suggestion=f"Consider using {guidelines['recommended'][0]} for better performance",
                    citation=guidelines["citation"],
                ))

        return issues

    def _check_lifecycle_status(
        self,
        bom: list[dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check for obsolete or NRND components."""
        issues: list[BOMIssue] = []

        for entry in bom:
            ref = entry.get("reference", "")
            mpn = entry.get("mpn", "")
            supplier_status = entry.get("supplier_status", "")

            # Check against known obsolete parts
            for known_mpn, note in _OBSOLETE_PARTS.items():
                if known_mpn.lower() in mpn.lower():
                    issues.append(BOMIssue(
                        id=self._next_issue_id(),
                        severity=IssueSeverity.WARNING,
                        category=IssueCategory.OBSOLETE_PART,
                        component_ref=ref,
                        component_mpn=mpn,
                        description=f"{ref} ({mpn}): {note}",
                        fix_suggestion="Consider a modern replacement for long-term availability",
                    ))
                    break

            # Check supplier status field
            if supplier_status.lower() in ("obsolete", "nrnd", "not recommended"):
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.OBSOLETE_PART,
                    component_ref=ref,
                    component_mpn=mpn,
                    description=f"{ref} ({mpn}): supplier status is '{supplier_status}'",
                    fix_suggestion="Find an alternative component with active lifecycle status",
                ))

        return issues

    def _check_thermal_derating(
        self,
        bom: list[dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check for thermal derating concerns."""
        issues: list[BOMIssue] = []

        for entry in bom:
            ref = entry.get("reference", "")
            specs = entry.get("specs", {})

            # Check resistor power dissipation
            if ref.startswith("R"):
                power_w = specs.get("power_w", 0)
                if isinstance(power_w, (int, float)) and power_w > 0:
                    # Check if operating close to rated power
                    operating_power = specs.get("operating_power_w")
                    if isinstance(operating_power, (int, float)) and operating_power > power_w * 0.5:
                        issues.append(BOMIssue(
                            id=self._next_issue_id(),
                            severity=IssueSeverity.WARNING,
                            category=IssueCategory.THERMAL_DERATING,
                            component_ref=ref,
                            component_mpn=entry.get("mpn", ""),
                            description=(
                                f"{ref}: Operating at {operating_power * 1000:.0f}mW, "
                                f"which is {operating_power / power_w * 100:.0f}% of rated power ({power_w * 1000:.0f}mW)"
                            ),
                            fix_suggestion="Derate to 50% of rated power for reliability, or use a larger package",
                            citation="IPC-2221B / resistor manufacturer thermal derating curves",
                        ))

            # Check IC thermal dissipation
            if ref.startswith("U"):
                tj_max = specs.get("tj_max_c")
                theta_ja = specs.get("theta_ja_cw")
                power_dissipation = specs.get("power_dissipation_w")
                if all(isinstance(v, (int, float)) for v in [tj_max, theta_ja, power_dissipation] if v is not None):
                    if tj_max and theta_ja and power_dissipation:
                        ambient = 85  # Worst case ambient (industrial)
                        tj_calc = ambient + power_dissipation * theta_ja
                        if tj_calc > tj_max * 0.9:
                            issues.append(BOMIssue(
                                id=self._next_issue_id(),
                                severity=IssueSeverity.WARNING,
                                category=IssueCategory.THERMAL_DERATING,
                                component_ref=ref,
                                component_mpn=entry.get("mpn", ""),
                                description=(
                                    f"{ref}: Junction temperature {tj_calc:.0f}C "
                                    f"at {ambient}C ambient approaches Tj_max ({tj_max}C)"
                                ),
                                fix_suggestion="Improve thermal management with thermal vias, copper pours, or heatsink",
                                citation="Component datasheet thermal specifications",
                            ))

        return issues

    def _check_footprint_consistency(
        self,
        bom_refs: dict[str, dict[str, Any]],
        schematic_refs: dict[str, dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check that BOM footprints match schematic footprints."""
        issues: list[BOMIssue] = []

        for ref in bom_refs:
            bom_fp = bom_refs[ref].get("footprint", "")
            sch_fp = schematic_refs.get(ref, {}).get("footprint", "")
            if bom_fp and sch_fp and bom_fp.lower() != sch_fp.lower():
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.FOOTPRINT_MISMATCH,
                    component_ref=ref,
                    description=(
                        f"{ref}: BOM footprint '{bom_fp}' does not match schematic footprint '{sch_fp}'"
                    ),
                    fix_suggestion="Update BOM or schematic to ensure footprint consistency",
                ))

        return issues

    def _check_decoupling_caps(
        self,
        bom: list[dict[str, Any]],
        schematic_components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> list[BOMSuggestion]:
        """Check that ICs have adequate decoupling capacitors."""
        suggestions: list[BOMSuggestion] = []

        ic_refs = [c.get("reference", "") for c in schematic_components if c.get("reference", "").startswith("U")]
        cap_refs = [e.get("reference", "") for e in bom if e.get("reference", "").startswith("C")]

        # Simple heuristic: at least 1 decoupling cap per IC power pin
        # In practice, we'd check actual connectivity
        if len(ic_refs) > 0 and len(cap_refs) < len(ic_refs):
            suggestions.append(BOMSuggestion(
                id=f"SUG_{len(suggestions) + 1:04d}",
                category="decoupling",
                description=(
                    f"Only {len(cap_refs)} capacitors for {len(ic_refs)} ICs. "
                    f"Each IC typically needs at least one 100nF decoupling cap per power pin."
                ),
                affected_components=ic_refs,
                benefit="Improved power supply integrity and reduced switching noise",
                implementation="Add 100nF X5R/X7R ceramic capacitors close to each IC power pin",
            ))

        return suggestions

    def _check_esd_protection(
        self,
        bom: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> list[BOMSuggestion]:
        """Check for missing ESD protection on external interfaces."""
        suggestions: list[BOMSuggestion] = []

        # Check for USB nets without ESD protection
        usb_nets = [n.get("name", "") for n in nets if re.search(r"USB|D\+|D\-", n.get("name", ""), re.IGNORECASE)]
        has_esd = any("ESD" in e.get("description", "").upper() or "TVS" in e.get("description", "").upper() for e in bom)

        if usb_nets and not has_esd:
            suggestions.append(BOMSuggestion(
                id=f"SUG_{len(suggestions) + 1:04d}",
                category="protection",
                description="USB data lines detected but no ESD protection device found in BOM",
                affected_components=[],
                benefit="ESD protection prevents damage from electrostatic discharge on USB connector",
                implementation="Add USBLC6-2SC6 or equivalent TVS diode array on USB D+/D- lines",
            ))

        return suggestions

    def _check_power_ratings(
        self,
        bom: list[dict[str, Any]],
    ) -> list[BOMIssue]:
        """Check resistor power ratings."""
        issues: list[BOMIssue] = []

        for entry in bom:
            ref = entry.get("reference", "")
            if not ref.startswith("R"):
                continue
            specs = entry.get("specs", {})
            resistance = specs.get("resistance_ohm")
            power_w = specs.get("power_w")
            package = entry.get("package", entry.get("footprint", ""))

            # Check that tiny packages aren't used for power resistors
            if package in ("0201", "0402") and isinstance(power_w, (int, float)) and power_w > 0.1:
                issues.append(BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.POWER_RATING,
                    component_ref=ref,
                    description=f"{ref}: {package} package rated at {power_w * 1000:.0f}mW - verify adequate for application",
                    fix_suggestion="Use 0603 or larger package for higher power dissipation",
                    citation="Resistor manufacturer package power ratings",
                ))

        return issues

    def _check_single_source(
        self,
        bom: list[dict[str, Any]],
    ) -> list[BOMSuggestion]:
        """Identify single-source risk components."""
        suggestions: list[BOMSuggestion] = []
        single_source_refs: list[str] = []

        for entry in bom:
            ref = entry.get("reference", "")
            mpn = entry.get("mpn", "")
            sources = entry.get("alternative_sources", [])
            manufacturer = entry.get("manufacturer", "")

            if mpn and not sources and ref.startswith("U"):
                single_source_refs.append(ref)

        if single_source_refs:
            suggestions.append(BOMSuggestion(
                id=f"SUG_{1:04d}",
                category="supply_chain",
                description=f"{len(single_source_refs)} IC(s) appear to be single-source",
                affected_components=single_source_refs,
                benefit="Reduced supply chain risk and potentially better pricing through competition",
                implementation="Identify and qualify second-source alternatives for critical components",
            ))

        return suggestions

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_voltage_from_name(name: str) -> float | None:
        """Extract voltage from a net name."""
        patterns = [
            (r"(\d+)V(\d+)", lambda m: float(f"{m.group(1)}.{m.group(2)}")),
            (r"(\d+(?:\.\d+)?)V", lambda m: float(m.group(1))),
        ]
        for pattern, extractor in patterns:
            match = re.search(pattern, name, re.IGNORECASE)
            if match:
                return extractor(match)
        return None

    @staticmethod
    def _determine_cap_type(entry: dict[str, Any]) -> str:
        """Determine capacitor type for derating lookup."""
        desc = (entry.get("description", "") + " " + entry.get("mpn", "")).lower()
        if "tantalum" in desc:
            return "tantalum"
        if "electrolytic" in desc or "elec" in desc:
            return "electrolytic"
        if "film" in desc:
            return "film"
        return "mlcc_ceramic"

    @staticmethod
    def _determine_cap_application(
        ref: str,
        entry: dict[str, Any],
        nets: list[dict[str, Any]],
        schematic_refs: dict[str, dict[str, Any]],
    ) -> str:
        """Determine the application of a capacitor from its circuit context."""
        connected_nets = entry.get("connected_nets", [])
        desc = entry.get("description", "").lower()

        # Check if connected to crystal (timing)
        for net_name in connected_nets:
            if re.search(r"(XTAL|OSC|CRYSTAL)", net_name, re.IGNORECASE):
                return "timing"

        # Check if near a power regulator (power input/output)
        for net_name in connected_nets:
            if re.search(r"(VIN|VBUS|INPUT)", net_name, re.IGNORECASE):
                return "power_input"
            if re.search(r"(VOUT|OUTPUT)", net_name, re.IGNORECASE):
                return "power_output"

        # Check if it's a bypass/decoupling cap
        if "bypass" in desc or "decoupling" in desc or "decouple" in desc:
            return "decoupling"

        # Default: decoupling if connected to power
        for net_name in connected_nets:
            if re.search(r"(VCC|VDD|3V3|5V|1V8)", net_name, re.IGNORECASE):
                return "decoupling"

        return "decoupling"  # Default assumption for capacitors

    # ------------------------------------------------------------------
    # LLM enhancement
    # ------------------------------------------------------------------

    async def _llm_deep_validate(
        self,
        bom: list[dict[str, Any]],
        schematic: dict[str, Any],
    ) -> tuple[list[BOMIssue], list[BOMSuggestion]]:
        """Use LLM for deeper BOM validation."""
        if self._agent is None:
            return [], []

        try:
            response = await self._agent.chat(
                "Review this BOM for a PCB design and identify any issues:\n\n"
                f"BOM (first 20 entries):\n{json.dumps(bom[:20], indent=2, default=str)}\n\n"
                f"Schematic context:\n{json.dumps(schematic, indent=2, default=str)[:3000]}\n\n"
                "Check for:\n"
                "- Incorrect component values or specifications\n"
                "- Missing components for the circuit to function\n"
                "- Component compatibility issues\n"
                "- Better alternatives available\n"
                "Return findings as JSON with keys: issues (array of {severity, category, ref, description, fix}), "
                "suggestions (array of {category, description, benefit, implementation})"
            )
            data = json.loads(response.message)
            issues = [
                BOMIssue(
                    id=self._next_issue_id(),
                    severity=IssueSeverity(i.get("severity", "warning")),
                    category=IssueCategory.MISSING_COMPONENT,
                    component_ref=i.get("ref", ""),
                    description=i.get("description", ""),
                    fix_suggestion=i.get("fix", ""),
                )
                for i in data.get("issues", [])
            ]
            suggestions = [
                BOMSuggestion(
                    id=f"LLM_SUG_{j}",
                    category=s.get("category", "general"),
                    description=s.get("description", ""),
                    affected_components=[],
                    benefit=s.get("benefit", ""),
                    implementation=s.get("implementation", ""),
                )
                for j, s in enumerate(data.get("suggestions", []))
            ]
            return issues, suggestions
        except Exception as e:
            logger.warning("LLM BOM validation failed: %s", e)
            return [], []

    async def _llm_find_alternatives(
        self,
        component: dict[str, Any],
        reason: str,
        existing: list[Alternative],
    ) -> list[Alternative]:
        """Use LLM to find additional alternatives."""
        if self._agent is None:
            return []

        try:
            response = await self._agent.chat(
                f"Find alternative components for {component.get('mpn', '')}.\n"
                f"Reason: {reason}\n"
                f"Specs: {json.dumps(component.get('specs', {}), default=str)}\n"
                f"Footprint: {component.get('footprint', '')}\n"
                f"Already suggested: {[a.mpn for a in existing]}\n\n"
                f"Return as JSON array with: mpn, manufacturer, description, reason, compatibility, trade_offs"
            )
            data = json.loads(response.message)
            if isinstance(data, list):
                return [
                    Alternative(
                        mpn=a.get("mpn", ""),
                        manufacturer=a.get("manufacturer", ""),
                        description=a.get("description", ""),
                        reason=a.get("reason", reason),
                        compatibility=a.get("compatibility", "unknown"),
                        trade_offs=a.get("trade_offs", []),
                    )
                    for a in data
                ]
        except Exception as e:
            logger.warning("LLM alternative search failed: %s", e)

        return []
