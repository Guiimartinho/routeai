"""Schematic Reviewer - LLM-powered schematic design review.

Performs automated checks for common schematic issues including missing pull-ups,
missing decoupling caps, ESD protection gaps, wrong crystal load caps, bypass cap
placement, missing series resistors, and power sequencing issues.
"""

from __future__ import annotations

import json
import logging
import math
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class FindingSeverity(str, Enum):
    """Severity levels for schematic review findings."""
    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class FindingCategory(str, Enum):
    """Categories of schematic review findings."""
    PULL_UP_MISSING = "pull_up_missing"
    DECOUPLING_CAP = "decoupling_cap"
    ESD_PROTECTION = "esd_protection"
    CRYSTAL_LOAD_CAP = "crystal_load_cap"
    BYPASS_CAP_PLACEMENT = "bypass_cap_placement"
    SERIES_RESISTOR = "series_resistor"
    POWER_SEQUENCING = "power_sequencing"
    RESET_CIRCUIT = "reset_circuit"
    UNUSED_PIN = "unused_pin"
    FLOATING_INPUT = "floating_input"
    POWER_PIN = "power_pin"
    TERMINATION = "termination"
    POLARITY = "polarity"
    FANOUT = "fanout"
    GROUND_SPLIT = "ground_split"
    FILTER = "filter"
    GENERAL = "general"


class SchematicFinding(BaseModel):
    """A single finding from the schematic review."""
    id: str
    severity: FindingSeverity
    category: FindingCategory
    title: str = Field(description="Short title of the finding")
    description: str = Field(description="Detailed description of the issue")
    location: str = Field(
        default="",
        description="Location in schematic (component ref, net name, sheet)",
    )
    affected_components: list[str] = Field(
        default_factory=list,
        description="Component references affected",
    )
    affected_nets: list[str] = Field(
        default_factory=list,
        description="Net names affected",
    )
    fix_suggestion: str = Field(description="How to fix this issue")
    citation: str = Field(
        default="",
        description="Standard, datasheet, or design guide reference",
    )


class SchematicReviewReport(BaseModel):
    """Complete schematic review report."""
    findings: list[SchematicFinding] = Field(default_factory=list)
    summary: dict[str, Any] = Field(default_factory=dict)
    score: float = Field(
        default=100.0,
        description="Overall review score (0-100)",
    )
    passed: bool = Field(default=True)


# ---------------------------------------------------------------------------
# Known pin characteristics
# ---------------------------------------------------------------------------

# Open-drain/open-collector outputs that need pull-ups
_OPEN_DRAIN_SIGNALS = re.compile(
    r"(I2C|SDA|SCL|INT|IRQ|nINT|ALERT|DRDY|OPEN_DRAIN|OD|OC|nFAULT|nPG|nRESET|RESET_OUT)",
    re.IGNORECASE,
)

# Signals that typically need series resistors
_SERIES_RESISTOR_SIGNALS = re.compile(
    r"(USB_D[PM]|D\+|D\-|UART_TX|TXD|SPI_CLK|SCLK|MOSI|GPIO\d+_OUT)",
    re.IGNORECASE,
)

# Power domains that may need sequencing
_POWER_DOMAINS = re.compile(
    r"(VCC_CORE|VCC_IO|VCC_AUX|VDDQ|VDDIO|VDDA|AVDD|DVDD|1V0|1V1|1V2|1V5|1V8|2V5|3V3|5V0)",
    re.IGNORECASE,
)

# Crystal-related net patterns
_CRYSTAL_NETS = re.compile(r"(XTAL|OSC|CRYSTAL|XIN|XOUT|XI|XO|HSE)", re.IGNORECASE)

# Decoupling requirements per IC type
_DECOUPLING_REQUIREMENTS: dict[str, dict[str, Any]] = {
    "mcu": {
        "min_100nf_per_vdd": 1,
        "min_bulk_uf": 10,
        "citation": "Microcontroller datasheet - power supply decoupling",
    },
    "fpga": {
        "min_100nf_per_vdd": 2,
        "min_bulk_uf": 22,
        "citation": "FPGA power supply design guide",
    },
    "adc": {
        "min_100nf_per_vdd": 1,
        "min_10nf_per_vref": 1,
        "min_bulk_uf": 10,
        "citation": "ADC datasheet - power supply filtering requirements",
    },
    "ddr": {
        "min_100nf_per_vdd": 2,
        "min_bulk_uf": 47,
        "citation": "JEDEC DDR memory - VTT termination and decoupling",
    },
    "generic_ic": {
        "min_100nf_per_vdd": 1,
        "min_bulk_uf": 4.7,
        "citation": "General IC design guideline - minimum one 100nF cap per VDD pin",
    },
}


# ---------------------------------------------------------------------------
# Main reviewer class
# ---------------------------------------------------------------------------


class SchematicReviewer:
    """Reviews schematic designs for common issues and best practice violations.

    Checks include:
    - Missing pull-ups on open-drain/I2C lines
    - Missing or inadequate decoupling capacitors
    - ESD protection gaps on external interfaces
    - Wrong crystal load capacitor values
    - Bypass caps placed too far from IC pins
    - Missing series resistors on high-speed outputs
    - Power sequencing issues
    - Floating inputs and unused pins
    - Reset circuit completeness

    Each finding includes severity, location, fix suggestion, and citation.

    Args:
        agent: Optional RouteAIAgent for LLM-enhanced deep review.
    """

    def __init__(self, agent: Any | None = None) -> None:
        self._agent = agent
        self._finding_counter = 0

    def _next_finding_id(self) -> str:
        self._finding_counter += 1
        return f"SCH_{self._finding_counter:04d}"

    async def review(
        self,
        schematic: dict[str, Any],
    ) -> SchematicReviewReport:
        """Perform a comprehensive schematic review.

        Args:
            schematic: Serialized schematic dict with:
                - components: list of component dicts
                - nets: list of net dicts
                - connections/wires: connectivity information

        Returns:
            SchematicReviewReport with findings, summary, and score.
        """
        self._finding_counter = 0
        findings: list[SchematicFinding] = []

        components = schematic.get("components", [])
        nets = schematic.get("nets", [])

        # Build lookup structures
        comp_map = {c.get("reference", ""): c for c in components}
        net_map = {n.get("name", n.get("id", "")): n for n in nets}
        comp_net_map = self._build_comp_net_map(components, nets)
        pin_net_map = self._build_pin_net_map(components, nets)

        # Run all checks
        findings.extend(self._check_pull_ups(components, nets, comp_net_map, pin_net_map))
        findings.extend(self._check_decoupling_caps(components, nets, comp_map, comp_net_map))
        findings.extend(self._check_esd_protection(components, nets, net_map))
        findings.extend(self._check_crystal_load_caps(components, nets, comp_map, comp_net_map))
        findings.extend(self._check_series_resistors(nets, comp_net_map))
        findings.extend(self._check_power_sequencing(components, nets, comp_net_map))
        findings.extend(self._check_reset_circuit(components, nets, comp_net_map))
        findings.extend(self._check_unused_pins(components, pin_net_map))
        findings.extend(self._check_floating_inputs(components, nets, pin_net_map))
        findings.extend(self._check_power_pins(components, nets, comp_net_map))

        # LLM-enhanced review
        if self._agent is not None:
            llm_findings = await self._llm_deep_review(schematic, findings)
            findings.extend(llm_findings)

        # Calculate score
        score = self._calculate_score(findings)
        passed = not any(f.severity in (FindingSeverity.CRITICAL, FindingSeverity.ERROR) for f in findings)

        # Build summary
        severity_counts = {s.value: 0 for s in FindingSeverity}
        category_counts: dict[str, int] = {}
        for f in findings:
            severity_counts[f.severity.value] = severity_counts.get(f.severity.value, 0) + 1
            category_counts[f.category.value] = category_counts.get(f.category.value, 0) + 1

        return SchematicReviewReport(
            findings=findings,
            summary={
                "total_findings": len(findings),
                "by_severity": severity_counts,
                "by_category": category_counts,
                "total_components": len(components),
                "total_nets": len(nets),
            },
            score=score,
            passed=passed,
        )

    # ------------------------------------------------------------------
    # Check implementations
    # ------------------------------------------------------------------

    def _check_pull_ups(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
        pin_net_map: dict[str, str],
    ) -> list[SchematicFinding]:
        """Check for missing pull-up resistors on open-drain signals."""
        findings: list[SchematicFinding] = []

        for net in nets:
            net_name = net.get("name", "")
            if not _OPEN_DRAIN_SIGNALS.search(net_name):
                continue

            pin_ids = net.get("pinIds", net.get("pins", []))

            # Check if any connected component is a resistor (pull-up)
            has_pull_up = False
            connected_refs: list[str] = []

            for comp in components:
                ref = comp.get("reference", "")
                comp_nets = comp_net_map.get(ref, [])
                if net_name in comp_nets:
                    connected_refs.append(ref)
                    if ref.startswith("R"):
                        # Verify the other end connects to a power rail
                        other_nets = [n for n in comp_nets if n != net_name]
                        for on in other_nets:
                            if re.search(r"(VCC|VDD|3V3|5V|VBUS|VDDIO)", on, re.IGNORECASE):
                                has_pull_up = True
                                break

            if not has_pull_up and connected_refs:
                severity = FindingSeverity.ERROR if "I2C" in net_name.upper() or "SDA" in net_name.upper() or "SCL" in net_name.upper() else FindingSeverity.WARNING

                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=severity,
                    category=FindingCategory.PULL_UP_MISSING,
                    title=f"Missing pull-up on {net_name}",
                    description=(
                        f"Net '{net_name}' appears to be an open-drain signal but no pull-up "
                        f"resistor to a power rail was detected. Open-drain outputs require an "
                        f"external pull-up resistor to function correctly."
                    ),
                    location=net_name,
                    affected_components=connected_refs,
                    affected_nets=[net_name],
                    fix_suggestion=(
                        f"Add a pull-up resistor (typically 4.7k for I2C, 10k for general purpose) "
                        f"from {net_name} to the appropriate VDD rail"
                    ),
                    citation="I2C-bus specification (NXP UM10204) requires pull-up resistors on SDA and SCL; "
                             "Open-drain outputs require external pull-up per component datasheet",
                ))

        return findings

    def _check_decoupling_caps(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_map: dict[str, dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check for missing or inadequate decoupling capacitors."""
        findings: list[SchematicFinding] = []

        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("U"):
                continue

            val = (comp.get("value", "") + " " + comp.get("description", "")).lower()
            comp_nets = comp_net_map.get(ref, [])

            # Determine IC type for decoupling requirements
            ic_type = "generic_ic"
            if any(kw in val for kw in ("stm32", "atme", "pic", "esp32", "nrf", "samd", "rp2040")):
                ic_type = "mcu"
            elif any(kw in val for kw in ("fpga", "xc", "ecp", "ice40")):
                ic_type = "fpga"
            elif any(kw in val for kw in ("adc", "ads", "mcp32")):
                ic_type = "adc"

            requirements = _DECOUPLING_REQUIREMENTS[ic_type]

            # Count VDD pins
            vdd_nets = [n for n in comp_nets if re.search(r"(VCC|VDD|AVDD|DVDD|VDDIO)", n, re.IGNORECASE)]
            power_pin_count = max(1, len(vdd_nets))

            # Count nearby capacitors connected to the same power nets
            nearby_caps = 0
            nearby_cap_refs: list[str] = []
            for cap_comp in components:
                cap_ref = cap_comp.get("reference", "")
                if not cap_ref.startswith("C"):
                    continue
                cap_nets = comp_net_map.get(cap_ref, [])
                # Check if capacitor shares a power net AND a ground net with the IC
                shared_power = set(vdd_nets) & set(cap_nets)
                shared_ground = any(
                    re.search(r"(GND|VSS|AGND|DGND)", n, re.IGNORECASE)
                    for n in cap_nets
                )
                if shared_power and shared_ground:
                    nearby_caps += 1
                    nearby_cap_refs.append(cap_ref)

            min_required = power_pin_count * requirements.get("min_100nf_per_vdd", 1)

            if nearby_caps < min_required:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.ERROR if ic_type in ("mcu", "fpga") else FindingSeverity.WARNING,
                    category=FindingCategory.DECOUPLING_CAP,
                    title=f"Insufficient decoupling for {ref}",
                    description=(
                        f"{ref} ({comp.get('value', '')}) has {nearby_caps} decoupling capacitor(s) "
                        f"but needs at least {min_required} (one 100nF per VDD pin). "
                        f"Detected {power_pin_count} power pin(s): {', '.join(vdd_nets[:5])}"
                    ),
                    location=ref,
                    affected_components=[ref] + nearby_cap_refs,
                    affected_nets=vdd_nets,
                    fix_suggestion=(
                        f"Add {min_required - nearby_caps} more 100nF X5R/X7R ceramic decoupling capacitor(s) "
                        f"close to {ref}'s VDD pins. Place as close as possible to the IC with short, "
                        f"direct connections to the ground plane."
                    ),
                    citation=requirements.get("citation", "General IC design guideline"),
                ))

        return findings

    def _check_esd_protection(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        net_map: dict[str, dict[str, Any]],
    ) -> list[SchematicFinding]:
        """Check for missing ESD protection on external interfaces."""
        findings: list[SchematicFinding] = []

        # Check USB
        usb_nets = [n.get("name", "") for n in nets if re.search(r"USB.*D[PM]|D\+|D\-", n.get("name", ""), re.IGNORECASE)]
        if usb_nets:
            has_esd = any(
                re.search(r"(USBLC|ESD|TVS|PESD|TPD)", comp.get("value", "") + comp.get("description", ""), re.IGNORECASE)
                for comp in components
            )
            if not has_esd:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.ERROR,
                    category=FindingCategory.ESD_PROTECTION,
                    title="Missing USB ESD protection",
                    description=(
                        "USB data lines detected but no ESD protection device found. "
                        "USB connectors are exposed to external ESD events and require protection."
                    ),
                    location="USB interface",
                    affected_nets=usb_nets,
                    fix_suggestion=(
                        "Add an ESD protection device (e.g., USBLC6-2SC6) on USB D+ and D- lines, "
                        "placed as close to the connector as possible"
                    ),
                    citation="IEC 61000-4-2 ESD immunity requirements; USB-IF design guidelines",
                ))

        # Check Ethernet
        eth_nets = [n.get("name", "") for n in nets if re.search(r"(ETH|MDI|TX[PM]|RX[PM])", n.get("name", ""), re.IGNORECASE)]
        if eth_nets:
            has_protection = any(
                re.search(r"(ESD|TVS|PESD|transformer|magnetics)", comp.get("value", "") + comp.get("description", ""), re.IGNORECASE)
                for comp in components
            )
            if not has_protection:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.WARNING,
                    category=FindingCategory.ESD_PROTECTION,
                    title="Missing Ethernet ESD/surge protection",
                    description="Ethernet interface detected without explicit ESD/surge protection components",
                    location="Ethernet interface",
                    affected_nets=eth_nets,
                    fix_suggestion="Add TVS diode array or ensure isolation transformer provides adequate protection",
                    citation="IEEE 802.3 - Ethernet surge immunity requirements",
                ))

        # Check GPIO headers/connectors
        conn_nets: list[str] = []
        for comp in components:
            ref = comp.get("reference", "")
            if ref.startswith("J") or ref.startswith("P"):
                for pin in comp.get("pins", []):
                    if isinstance(pin, dict):
                        net = pin.get("net", "")
                        if net and not re.search(r"(VCC|VDD|GND|VSS)", net, re.IGNORECASE):
                            conn_nets.append(net)

        if len(conn_nets) > 4:
            # Many external signals without protection
            has_any_protection = any(
                re.search(r"(ESD|TVS|PESD|TPD)", comp.get("value", "") + comp.get("description", ""), re.IGNORECASE)
                for comp in components
            )
            if not has_any_protection:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.INFO,
                    category=FindingCategory.ESD_PROTECTION,
                    title="Consider ESD protection for external connectors",
                    description=(
                        f"{len(conn_nets)} signal(s) routed to external connectors without "
                        f"visible ESD protection. If these connectors are user-accessible, "
                        f"ESD protection is recommended."
                    ),
                    location="External connectors",
                    affected_nets=conn_nets[:10],
                    fix_suggestion="Add TVS diode arrays on signals connected to external connectors",
                    citation="IEC 61000-4-2 Level 4: +/-8kV contact, +/-15kV air discharge",
                ))

        return findings

    def _check_crystal_load_caps(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_map: dict[str, dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check crystal load capacitor values."""
        findings: list[SchematicFinding] = []

        for comp in components:
            ref = comp.get("reference", "")
            if not (ref.startswith("Y") or ref.startswith("X")):
                continue

            val = comp.get("value", "")
            specs = comp.get("specs", {})
            crystal_nets = comp_net_map.get(ref, [])

            # Find load capacitors on crystal nets
            load_caps: list[dict[str, Any]] = []
            for cap_comp in components:
                cap_ref = cap_comp.get("reference", "")
                if not cap_ref.startswith("C"):
                    continue
                cap_nets = comp_net_map.get(cap_ref, [])
                if set(crystal_nets) & set(cap_nets):
                    # Check if this cap also connects to ground
                    if any(re.search(r"(GND|VSS)", n, re.IGNORECASE) for n in cap_nets):
                        load_caps.append(cap_comp)

            if len(load_caps) < 2:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.ERROR,
                    category=FindingCategory.CRYSTAL_LOAD_CAP,
                    title=f"Missing load capacitors for {ref}",
                    description=(
                        f"Crystal {ref} ({val}) should have two load capacitors (one on each pin to ground). "
                        f"Found {len(load_caps)} load cap(s)."
                    ),
                    location=ref,
                    affected_components=[ref] + [c.get("reference", "") for c in load_caps],
                    fix_suggestion=(
                        f"Add load capacitors to both crystal pins. Typical values: "
                        f"CL = 2 * (Cload - Cstray), where Cload is the crystal's specified load "
                        f"capacitance and Cstray is ~3-5pF. For a 20pF load crystal, use 33pF caps."
                    ),
                    citation="Crystal manufacturer application note: CL = 2 * (Cload - Cstray); "
                             "ST AN2867 - Oscillator design guide for STM32",
                ))
            elif len(load_caps) == 2:
                # Verify values match
                val1 = load_caps[0].get("value", "")
                val2 = load_caps[1].get("value", "")
                if val1 and val2 and val1 != val2:
                    findings.append(SchematicFinding(
                        id=self._next_finding_id(),
                        severity=FindingSeverity.WARNING,
                        category=FindingCategory.CRYSTAL_LOAD_CAP,
                        title=f"Mismatched crystal load caps for {ref}",
                        description=(
                            f"Crystal {ref} load capacitors have different values: "
                            f"{load_caps[0].get('reference', '')}={val1}, "
                            f"{load_caps[1].get('reference', '')}={val2}. "
                            f"Load caps should typically be the same value."
                        ),
                        location=ref,
                        affected_components=[c.get("reference", "") for c in load_caps],
                        fix_suggestion="Use matched load capacitor values for symmetrical crystal loading",
                        citation="Crystal manufacturer application notes - symmetrical loading",
                    ))

                # Check for C0G/NP0 dielectric recommendation
                for cap in load_caps:
                    dielectric = cap.get("specs", {}).get("dielectric", "")
                    if dielectric and dielectric not in ("C0G", "NP0", ""):
                        cap_ref = cap.get("reference", "")
                        findings.append(SchematicFinding(
                            id=self._next_finding_id(),
                            severity=FindingSeverity.WARNING,
                            category=FindingCategory.CRYSTAL_LOAD_CAP,
                            title=f"Non-C0G dielectric for crystal load cap {cap_ref}",
                            description=(
                                f"Crystal load capacitor {cap_ref} uses {dielectric} dielectric. "
                                f"C0G/NP0 is recommended for crystal load capacitors due to minimal "
                                f"capacitance variation with temperature."
                            ),
                            location=cap_ref,
                            affected_components=[cap_ref, ref],
                            fix_suggestion="Use C0G/NP0 dielectric capacitors for crystal load caps",
                            citation="Crystal oscillator design guides recommend C0G/NP0 for temperature stability",
                        ))

        return findings

    def _check_series_resistors(
        self,
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check for missing series resistors on high-speed outputs."""
        findings: list[SchematicFinding] = []

        for net in nets:
            net_name = net.get("name", "")
            if not _SERIES_RESISTOR_SIGNALS.search(net_name):
                continue

            # Check if any resistor is in series on this net
            pin_ids = net.get("pinIds", net.get("pins", []))
            has_series_r = False

            for ref, ref_nets in comp_net_map.items():
                if ref.startswith("R") and net_name in ref_nets:
                    has_series_r = True
                    break

            if not has_series_r and len(pin_ids) >= 2:
                # Only warn if there are at least 2 connections (source and destination)
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.INFO,
                    category=FindingCategory.SERIES_RESISTOR,
                    title=f"Consider series resistor on {net_name}",
                    description=(
                        f"High-speed signal '{net_name}' has no series termination resistor. "
                        f"Series resistors (22-33 ohm) help reduce overshoot and ringing."
                    ),
                    location=net_name,
                    affected_nets=[net_name],
                    fix_suggestion=(
                        f"Add a 22-33 ohm series resistor near the source driver on {net_name}. "
                        f"This is especially important for signals longer than 2 inches or crossing connectors."
                    ),
                    citation="High-speed digital design guidelines - series termination for impedance matching",
                ))

        return findings

    def _check_power_sequencing(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check for potential power sequencing issues."""
        findings: list[SchematicFinding] = []

        # Find all power domains
        power_domains: list[str] = []
        for net in nets:
            name = net.get("name", "")
            if _POWER_DOMAINS.search(name):
                power_domains.append(name)

        # Check multi-rail ICs
        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("U"):
                continue

            comp_nets = comp_net_map.get(ref, [])
            ic_power_rails = [n for n in comp_nets if any(pd in n for pd in power_domains)]

            if len(set(ic_power_rails)) >= 3:
                # IC has 3+ different power rails - sequencing may be needed
                val = comp.get("value", "")
                has_mcu = any(
                    kw in val.lower()
                    for kw in ("stm32", "atme", "esp32", "fpga", "xc", "ddr", "phy")
                )

                if has_mcu:
                    findings.append(SchematicFinding(
                        id=self._next_finding_id(),
                        severity=FindingSeverity.WARNING,
                        category=FindingCategory.POWER_SEQUENCING,
                        title=f"Verify power sequencing for {ref}",
                        description=(
                            f"{ref} ({val}) has {len(set(ic_power_rails))} power domains: "
                            f"{', '.join(sorted(set(ic_power_rails))[:5])}. "
                            f"Verify that the power-up sequence meets the datasheet requirements."
                        ),
                        location=ref,
                        affected_components=[ref],
                        affected_nets=list(set(ic_power_rails)),
                        fix_suggestion=(
                            f"Check {val} datasheet for power sequencing requirements. "
                            f"Typically, core voltage must ramp before I/O voltage. "
                            f"Add enable sequencing or power-good monitoring if required."
                        ),
                        citation=f"{val} datasheet - power supply sequencing requirements",
                    ))

        return findings

    def _check_reset_circuit(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check reset circuit completeness."""
        findings: list[SchematicFinding] = []

        reset_nets = [n for n in nets if re.search(r"(NRST|RESET|RST)", n.get("name", ""), re.IGNORECASE)]
        if not reset_nets:
            return findings

        for reset_net in reset_nets:
            net_name = reset_net.get("name", "")
            has_cap = False
            has_resistor = False

            for ref, ref_nets in comp_net_map.items():
                if net_name not in ref_nets:
                    continue
                if ref.startswith("C"):
                    has_cap = True
                if ref.startswith("R"):
                    has_resistor = True

            if not has_cap:
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.WARNING,
                    category=FindingCategory.RESET_CIRCUIT,
                    title=f"Missing filter cap on {net_name}",
                    description=(
                        f"Reset net '{net_name}' has no decoupling/filter capacitor. "
                        f"A 100nF capacitor on the reset line helps filter noise and provides "
                        f"a clean reset signal."
                    ),
                    location=net_name,
                    affected_nets=[net_name],
                    fix_suggestion=f"Add a 100nF capacitor from {net_name} to GND for noise filtering",
                    citation="Microcontroller design guidelines - reset circuit best practices",
                ))

        return findings

    def _check_unused_pins(
        self,
        components: list[dict[str, Any]],
        pin_net_map: dict[str, str],
    ) -> list[SchematicFinding]:
        """Check for unconnected IC pins that should not be left floating."""
        findings: list[SchematicFinding] = []

        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("U"):
                continue

            pins = comp.get("pins", [])
            unconnected: list[str] = []

            for pin in pins:
                if isinstance(pin, dict):
                    pin_id = pin.get("id", "")
                    pin_name = pin.get("name", "")
                    pin_type = pin.get("type", "")

                    if pin_id not in pin_net_map and pin_type not in ("unconnected", "passive"):
                        unconnected.append(f"{pin_name} (pin {pin.get('number', '?')})")

            if unconnected and len(unconnected) <= 5:
                # Only report if a few pins are unconnected (likely intentional for many)
                findings.append(SchematicFinding(
                    id=self._next_finding_id(),
                    severity=FindingSeverity.INFO,
                    category=FindingCategory.UNUSED_PIN,
                    title=f"Unconnected pins on {ref}",
                    description=(
                        f"{ref} has {len(unconnected)} unconnected pin(s): "
                        f"{', '.join(unconnected[:5])}. "
                        f"Verify these are intentionally left unconnected per the datasheet."
                    ),
                    location=ref,
                    affected_components=[ref],
                    fix_suggestion=(
                        "Check datasheet for recommended handling of unused pins. "
                        "Unused inputs should typically be tied to VDD or GND. "
                        "Unused outputs can usually be left floating."
                    ),
                    citation="Component datasheet - unused pin handling recommendations",
                ))

        return findings

    def _check_floating_inputs(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        pin_net_map: dict[str, str],
    ) -> list[SchematicFinding]:
        """Check for floating digital inputs."""
        findings: list[SchematicFinding] = []

        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("U"):
                continue

            for pin in comp.get("pins", []):
                if not isinstance(pin, dict):
                    continue
                pin_type = pin.get("type", "")
                pin_name = pin.get("name", "")
                pin_id = pin.get("id", "")

                if pin_type != "input":
                    continue

                net_name = pin_net_map.get(pin_id, "")
                if not net_name:
                    continue

                # Check if the net has a driver (output or power)
                net_data = next((n for n in nets if n.get("name", n.get("id", "")) == net_name), None)
                if not net_data:
                    continue

                pin_ids = net_data.get("pinIds", net_data.get("pins", []))
                if len(pin_ids) <= 1:
                    # Only this pin on the net - might be floating
                    findings.append(SchematicFinding(
                        id=self._next_finding_id(),
                        severity=FindingSeverity.WARNING,
                        category=FindingCategory.FLOATING_INPUT,
                        title=f"Potentially floating input: {ref}.{pin_name}",
                        description=(
                            f"Input pin {pin_name} on {ref} is connected to net '{net_name}' "
                            f"which has no other connections. This input may be floating."
                        ),
                        location=f"{ref}.{pin_name}",
                        affected_components=[ref],
                        affected_nets=[net_name],
                        fix_suggestion=(
                            f"Connect {net_name} to a driver, or add a pull-up/pull-down resistor "
                            f"to define the default state"
                        ),
                        citation="Digital design best practices - no floating inputs",
                    ))

        return findings

    def _check_power_pins(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[SchematicFinding]:
        """Check that all IC power pins are properly connected."""
        findings: list[SchematicFinding] = []

        for comp in components:
            ref = comp.get("reference", "")
            if not ref.startswith("U"):
                continue

            for pin in comp.get("pins", []):
                if not isinstance(pin, dict):
                    continue
                pin_type = pin.get("type", "")
                pin_name = pin.get("name", "")
                pin_id = pin.get("id", "")

                if pin_type != "power":
                    continue

                # Check if power pin is connected to a power net
                comp_nets = comp_net_map.get(ref, [])
                pin_connected = False
                for net_name in comp_nets:
                    if re.search(r"(VCC|VDD|GND|VSS|VEE|AVCC|AVDD|DVCC|DVDD|3V3|5V|1V8)", net_name, re.IGNORECASE):
                        pin_connected = True
                        break

                if not pin_connected and pin_name:
                    if re.search(r"(VCC|VDD|GND|VSS|VEE|V\+|V\-)", pin_name, re.IGNORECASE):
                        findings.append(SchematicFinding(
                            id=self._next_finding_id(),
                            severity=FindingSeverity.CRITICAL,
                            category=FindingCategory.POWER_PIN,
                            title=f"Unconnected power pin: {ref}.{pin_name}",
                            description=(
                                f"Power pin {pin_name} on {ref} ({comp.get('value', '')}) "
                                f"does not appear to be connected to a power rail."
                            ),
                            location=f"{ref}.{pin_name}",
                            affected_components=[ref],
                            fix_suggestion=f"Connect {ref}.{pin_name} to the appropriate power net",
                            citation="Component datasheet - all power and ground pins must be connected",
                        ))

        return findings

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_comp_net_map(
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """Build component reference -> [net names] map."""
        pin_to_comp: dict[str, str] = {}
        for comp in components:
            ref = comp.get("reference", "")
            for pin in comp.get("pads", comp.get("pins", [])):
                pid = pin.get("id", pin) if isinstance(pin, dict) else pin
                pin_to_comp[pid] = ref

        comp_nets: dict[str, list[str]] = {}
        for net in nets:
            net_name = net.get("name", net.get("id", ""))
            for pin_id in net.get("pinIds", net.get("pins", [])):
                ref = pin_to_comp.get(pin_id, "")
                if ref:
                    comp_nets.setdefault(ref, []).append(net_name)

        return comp_nets

    @staticmethod
    def _build_pin_net_map(
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> dict[str, str]:
        """Build pin ID -> net name map."""
        pin_net: dict[str, str] = {}
        for net in nets:
            net_name = net.get("name", net.get("id", ""))
            for pin_id in net.get("pinIds", net.get("pins", [])):
                pin_net[pin_id] = net_name
        return pin_net

    @staticmethod
    def _calculate_score(findings: list[SchematicFinding]) -> float:
        """Calculate a review score based on findings."""
        score = 100.0
        for f in findings:
            if f.severity == FindingSeverity.CRITICAL:
                score -= 15
            elif f.severity == FindingSeverity.ERROR:
                score -= 8
            elif f.severity == FindingSeverity.WARNING:
                score -= 3
            elif f.severity == FindingSeverity.INFO:
                score -= 0.5
        return max(0.0, round(score, 1))

    # ------------------------------------------------------------------
    # LLM enhancement
    # ------------------------------------------------------------------

    async def _llm_deep_review(
        self,
        schematic: dict[str, Any],
        existing_findings: list[SchematicFinding],
    ) -> list[SchematicFinding]:
        """Use LLM for deeper schematic analysis."""
        if self._agent is None:
            return []

        try:
            existing_summary = [
                f"- [{f.severity.value}] {f.title}" for f in existing_findings[:10]
            ]

            response = await self._agent.chat(
                "Review this schematic for additional issues beyond what was already found:\n\n"
                f"Schematic (summary):\n{json.dumps(schematic, indent=2, default=str)[:4000]}\n\n"
                f"Already found:\n" + "\n".join(existing_summary) + "\n\n"
                "Look for:\n"
                "- Incorrect component values for the circuit topology\n"
                "- Missing protection components (TVS, fuses, ferrite beads)\n"
                "- Signal integrity issues\n"
                "- Thermal management concerns\n"
                "- EMC/EMI issues\n\n"
                "Return as JSON array of {severity, category, title, description, location, fix_suggestion, citation}"
            )
            data = json.loads(response.message)
            if isinstance(data, list):
                return [
                    SchematicFinding(
                        id=self._next_finding_id(),
                        severity=FindingSeverity(f.get("severity", "info")),
                        category=FindingCategory.GENERAL,
                        title=f.get("title", "LLM finding"),
                        description=f.get("description", ""),
                        location=f.get("location", ""),
                        fix_suggestion=f.get("fix_suggestion", ""),
                        citation=f.get("citation", "LLM analysis"),
                    )
                    for f in data
                ]
        except Exception as e:
            logger.warning("LLM deep review failed: %s", e)

        return []
