"""Design Intent Processor - Converts natural language design intent to formal constraints.

Translates engineer descriptions like "1GHz clock distribution" into specific
electrical constraints (impedance, length matching, guard traces) with full
citation to standards and datasheets.
"""

from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class Constraint(BaseModel):
    """A single formal design constraint."""
    id: str
    type: str = Field(description="Constraint type: impedance, length_match, spacing, width, guard_trace, copper_pour, thermal_relief, diff_pair, via_count, keepout")
    parameter: str = Field(description="What this constraint controls")
    value: str = Field(description="Constraint value")
    unit: str = Field(description="Value unit")
    applies_to: list[str] = Field(
        default_factory=list,
        description="Net names or component groups this applies to",
    )
    priority: str = Field(default="required", description="required, recommended, or optional")
    rationale: str = Field(description="Why this constraint exists")
    citation: str = Field(description="Standard, datasheet, or physics reference")
    confidence: float = Field(
        default=0.9,
        description="Confidence level 0-1 in this constraint's correctness",
    )


class ConstraintSet(BaseModel):
    """A complete set of constraints generated from design intent."""
    constraints: list[Constraint] = Field(default_factory=list)
    intent_description: str = Field(default="")
    context_summary: str = Field(default="")
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class IntentChange(BaseModel):
    """Represents a change to the schematic that may require constraint updates."""
    change_type: str = Field(description="added, removed, modified, moved")
    component_refs: list[str] = Field(default_factory=list)
    net_names: list[str] = Field(default_factory=list)
    description: str = Field(default="")


# ---------------------------------------------------------------------------
# Intent pattern database
# ---------------------------------------------------------------------------

@dataclass
class IntentPattern:
    """A pattern for matching natural language intent to constraints."""
    regex: re.Pattern[str]
    extract: str  # Name of extraction function
    description: str


_INTENT_PATTERNS: list[IntentPattern] = [
    IntentPattern(
        regex=re.compile(r"(\d+(?:\.\d+)?)\s*(GHz|MHz|kHz)\s*(clock|clk|signal|data|bus)?\s*(distribution|network|tree)?", re.IGNORECASE),
        extract="_extract_high_speed_signal",
        description="High-speed signal/clock intent",
    ),
    IntentPattern(
        regex=re.compile(r"USB\s*(2\.0|3\.\d|4)?.*?(high[- ]speed|full[- ]speed|super[- ]speed)?", re.IGNORECASE),
        extract="_extract_usb",
        description="USB interface intent",
    ),
    IntentPattern(
        regex=re.compile(r"DDR([345])\s*(memory|interface|bus)?", re.IGNORECASE),
        extract="_extract_ddr",
        description="DDR memory interface intent",
    ),
    IntentPattern(
        regex=re.compile(r"(\d+(?:\.\d+)?)\s*A\s*(power|current|delivery|section|supply)?", re.IGNORECASE),
        extract="_extract_power_section",
        description="Power section intent",
    ),
    IntentPattern(
        regex=re.compile(r"(buck|boost|LDO|switching|linear)\s*(converter|regulator|supply)?", re.IGNORECASE),
        extract="_extract_regulator",
        description="Voltage regulator intent",
    ),
    IntentPattern(
        regex=re.compile(r"(low[- ]noise|sensitive|precision)\s*(analog|ADC|DAC|sensor|measurement)?", re.IGNORECASE),
        extract="_extract_analog_sensitive",
        description="Sensitive analog intent",
    ),
    IntentPattern(
        regex=re.compile(r"(differential|diff)\s*(pair|line|signal)?\s*(\d+)?\s*(ohm)?", re.IGNORECASE),
        extract="_extract_diff_pair",
        description="Differential pair intent",
    ),
    IntentPattern(
        regex=re.compile(r"SPI\s*(bus|interface)?\s*(?:at\s*)?(\d+)?\s*(MHz)?", re.IGNORECASE),
        extract="_extract_spi",
        description="SPI bus intent",
    ),
    IntentPattern(
        regex=re.compile(r"I2C\s*(bus|interface)?\s*(?:at\s*)?(\d+)?\s*(kHz|MHz)?", re.IGNORECASE),
        extract="_extract_i2c",
        description="I2C bus intent",
    ),
    IntentPattern(
        regex=re.compile(r"UART\s*(interface)?\s*(?:at\s*)?(\d+)?\s*(baud|Mbps)?", re.IGNORECASE),
        extract="_extract_uart",
        description="UART interface intent",
    ),
    IntentPattern(
        regex=re.compile(r"(Ethernet|RGMII|RMII|MII|PHY)\s*(1G|100M|10M)?", re.IGNORECASE),
        extract="_extract_ethernet",
        description="Ethernet interface intent",
    ),
    IntentPattern(
        regex=re.compile(r"(RF|antenna|wireless|radio|2\.4\s*GHz|5\s*GHz|sub[- ]GHz)", re.IGNORECASE),
        extract="_extract_rf",
        description="RF section intent",
    ),
    IntentPattern(
        regex=re.compile(r"(HDMI|DisplayPort|LVDS|MIPI)\s*(interface|output|input)?", re.IGNORECASE),
        extract="_extract_video",
        description="Video interface intent",
    ),
    IntentPattern(
        regex=re.compile(r"(PCIe|PCI Express)\s*(x\d+|Gen\s*\d)?", re.IGNORECASE),
        extract="_extract_pcie",
        description="PCIe interface intent",
    ),
]


# ---------------------------------------------------------------------------
# Main processor class
# ---------------------------------------------------------------------------


class DesignIntentProcessor:
    """Converts natural language design intent into formal PCB constraints.

    Supports a wide range of intent descriptions including:
    - Clock and high-speed signal routing
    - USB, DDR, Ethernet, PCIe, HDMI interfaces
    - Power delivery sections
    - Analog sensitive areas
    - RF sections

    Each generated constraint includes a citation to the relevant standard
    or design guideline.

    Args:
        agent: Optional RouteAIAgent for LLM-enhanced intent processing.
    """

    def __init__(self, agent: Any | None = None) -> None:
        self._agent = agent
        self._constraint_counter = 0

    def _next_constraint_id(self) -> str:
        self._constraint_counter += 1
        return f"C_{self._constraint_counter:04d}"

    async def process_intent(
        self,
        block_annotation: str,
        schematic_context: dict[str, Any] | None = None,
    ) -> ConstraintSet:
        """Convert a natural language design intent into formal constraints.

        Args:
            block_annotation: Natural language description of the design intent.
                Examples:
                - "1GHz clock distribution"
                - "5A power section"
                - "USB 2.0 high-speed interface"
                - "low-noise analog frontend"
            schematic_context: Optional schematic context dict with components,
                nets, and connectivity information.

        Returns:
            ConstraintSet with formal constraints, rationale, and citations.
        """
        self._constraint_counter = 0
        constraints: list[Constraint] = []
        warnings: list[str] = []
        context_summary = ""

        # Extract applicable nets from context
        applicable_nets: list[str] = []
        applicable_components: list[str] = []
        if schematic_context:
            applicable_nets = [
                n.get("name", "") for n in schematic_context.get("nets", [])
            ]
            applicable_components = [
                c.get("reference", "") for c in schematic_context.get("components", [])
            ]
            context_summary = (
                f"Context: {len(applicable_components)} components, "
                f"{len(applicable_nets)} nets"
            )

        # Match against known patterns
        matched = False
        for pattern in _INTENT_PATTERNS:
            match = pattern.regex.search(block_annotation)
            if match:
                matched = True
                extractor = getattr(self, pattern.extract, None)
                if extractor:
                    extracted = extractor(match, block_annotation, applicable_nets, applicable_components)
                    constraints.extend(extracted)

        # If no pattern matched, try generic keyword analysis
        if not matched:
            constraints.extend(
                self._extract_generic(block_annotation, applicable_nets, applicable_components)
            )

        # LLM enhancement for complex intents
        if self._agent is not None:
            llm_constraints = await self._llm_process_intent(
                block_annotation, schematic_context, constraints
            )
            # Merge LLM constraints (add new ones, don't duplicate)
            existing_params = {(c.type, c.parameter) for c in constraints}
            for lc in llm_constraints:
                if (lc.type, lc.parameter) not in existing_params:
                    constraints.append(lc)

        if not constraints:
            warnings.append(
                f"Could not generate specific constraints for: '{block_annotation}'. "
                f"Please provide more detail about the signal type, frequency, or interface standard."
            )

        return ConstraintSet(
            constraints=constraints,
            intent_description=block_annotation,
            context_summary=context_summary,
            warnings=warnings,
            metadata={
                "matched_patterns": matched,
                "constraint_count": len(constraints),
                "net_count": len(applicable_nets),
                "component_count": len(applicable_components),
            },
        )

    async def propagate_constraints(
        self,
        schematic_changes: list[IntentChange],
        existing_constraints: ConstraintSet,
        schematic_context: dict[str, Any] | None = None,
    ) -> ConstraintSet:
        """Update constraints based on schematic changes.

        When components are added, removed, or modified, this method determines
        which constraints need updating and generates new ones as needed.

        Args:
            schematic_changes: List of changes that occurred.
            existing_constraints: Current constraint set.
            schematic_context: Updated schematic context.

        Returns:
            Updated ConstraintSet.
        """
        updated_constraints = list(existing_constraints.constraints)
        warnings = list(existing_constraints.warnings)

        for change in schematic_changes:
            if change.change_type == "removed":
                # Remove constraints that apply only to removed components/nets
                removed_refs = set(change.component_refs)
                removed_nets = set(change.net_names)
                updated_constraints = [
                    c for c in updated_constraints
                    if not (set(c.applies_to) & (removed_refs | removed_nets) == set(c.applies_to) and c.applies_to)
                ]
                warnings.append(
                    f"Removed constraints for deleted items: {change.description}"
                )

            elif change.change_type == "added":
                # Check if new components need constraints
                if schematic_context:
                    for ref in change.component_refs:
                        comp = next(
                            (c for c in schematic_context.get("components", []) if c.get("reference") == ref),
                            None,
                        )
                        if comp:
                            val = (comp.get("value", "") + " " + comp.get("description", "")).lower()

                            # Auto-detect if new component needs constraints
                            if any(kw in val for kw in ("usb", "ddr", "ethernet", "pcie")):
                                new_intent = f"Interface component {ref} ({comp.get('value', '')})"
                                new_cs = await self.process_intent(new_intent, schematic_context)
                                for c in new_cs.constraints:
                                    c.applies_to.append(ref)
                                    updated_constraints.append(c)
                                warnings.append(
                                    f"Auto-generated constraints for new component {ref}"
                                )

            elif change.change_type == "modified":
                # Update applies_to for renamed nets
                for net_name in change.net_names:
                    for c in updated_constraints:
                        if net_name in c.applies_to:
                            warnings.append(
                                f"Constraint {c.id} may need review after modification of {net_name}"
                            )

        return ConstraintSet(
            constraints=updated_constraints,
            intent_description=existing_constraints.intent_description,
            context_summary=f"Updated after {len(schematic_changes)} change(s)",
            warnings=warnings,
            metadata={
                **existing_constraints.metadata,
                "propagation_changes": len(schematic_changes),
            },
        )

    # ------------------------------------------------------------------
    # Intent extraction methods
    # ------------------------------------------------------------------

    def _extract_high_speed_signal(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for high-speed signals/clocks."""
        constraints: list[Constraint] = []
        freq_val = float(match.group(1))
        freq_unit = match.group(2).upper()
        signal_type = (match.group(3) or "signal").lower()
        topology = (match.group(4) or "").lower()

        freq_hz = freq_val * {"GHZ": 1e9, "MHZ": 1e6, "KHZ": 1e3}.get(freq_unit, 1)
        freq_label = f"{freq_val}{freq_unit}"

        # Calculate rise time estimate (rule of thumb: Tr ~ 0.35/BW for digital)
        rise_time_ns = 0.35 / (freq_hz * 1e-9) if freq_hz > 0 else 10
        # Critical length: trace becomes transmission line when > lambda/10
        wavelength_mm = (3e8 / freq_hz) * 1000 / 2  # effective in FR-4
        critical_length_mm = wavelength_mm / 10

        # Impedance control
        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="impedance",
            parameter="single-ended impedance",
            value="50",
            unit="ohm",
            applies_to=nets or [],
            rationale=(
                f"{freq_label} signal requires controlled impedance routing. "
                f"Critical trace length is ~{critical_length_mm:.0f}mm at this frequency."
            ),
            citation=f"High-speed design guidelines: traces longer than lambda/10 ({critical_length_mm:.0f}mm at {freq_label}) must be impedance controlled",
            confidence=0.95,
        ))

        # Length matching for distribution/tree
        if "distribution" in topology or "tree" in topology or "clock" in signal_type:
            skew = "2" if freq_hz >= 1e9 else "5" if freq_hz >= 100e6 else "25"
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="length_match",
                parameter="max skew within group",
                value=skew,
                unit="mil",
                applies_to=nets or [],
                rationale=f"Clock distribution at {freq_label} requires length matching for synchronous timing",
                citation=f"High-speed clock distribution: skew budget calculation based on {freq_label} period ({1e9/freq_hz:.2f}ns)",
                confidence=0.9,
            ))

        # Guard traces for high frequencies
        if freq_hz >= 500e6:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="guard_trace",
                parameter="guard trace spacing",
                value="3x trace width",
                unit="",
                applies_to=nets or [],
                rationale=f"{freq_label} signals benefit from guard traces to reduce crosstalk",
                citation="IPC-2141A: crosstalk increases with frequency; guard traces recommended above 500MHz",
                confidence=0.85,
            ))

        # Spacing
        if freq_hz >= 100e6:
            spacing = "0.5" if freq_hz >= 1e9 else "0.3"
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="spacing",
                parameter="minimum clearance from other signals",
                value=spacing,
                unit="mm",
                applies_to=nets or [],
                rationale=f"Adequate spacing prevents crosstalk coupling at {freq_label}",
                citation="3W rule for high-speed signal isolation (edge-to-edge spacing >= 3x trace width)",
                confidence=0.9,
            ))

        return constraints

    def _extract_usb(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for USB interfaces."""
        constraints: list[Constraint] = []
        version = match.group(1) or "2.0"
        speed = (match.group(2) or "").lower()

        is_usb3 = "3" in version or "super" in speed
        spec_ref = f"USB {version} Specification"

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter="differential impedance",
            value="90",
            unit="ohm",
            applies_to=[n for n in nets if re.search(r"(USB|D[PM]|D\+|D\-)", n, re.IGNORECASE)] or nets,
            rationale="USB specification requires 90 ohm differential impedance for all data pairs",
            citation=f"{spec_ref} - Section 7.1.2: 90 ohm +/-10% differential impedance",
            confidence=0.98,
        ))

        skew = "0.05" if is_usb3 else "0.15"
        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="intra-pair skew",
            value=skew,
            unit="mm",
            applies_to=[n for n in nets if re.search(r"(USB|D[PM]|D\+|D\-)", n, re.IGNORECASE)] or nets,
            rationale=f"USB {version} differential pair must be length matched",
            citation=f"{spec_ref} - maximum intra-pair skew {float(skew)*1000:.0f} mils",
            confidence=0.95,
        ))

        spacing = "0.5" if is_usb3 else "0.38"
        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="spacing",
            parameter="isolation from other signals",
            value=spacing,
            unit="mm",
            applies_to=[n for n in nets if re.search(r"(USB|D[PM]|D\+|D\-)", n, re.IGNORECASE)] or nets,
            rationale="USB data pairs need isolation spacing to prevent crosstalk",
            citation=f"{spec_ref} routing guidelines: maintain {spacing}mm minimum spacing",
            confidence=0.9,
        ))

        if is_usb3:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="via_count",
                parameter="maximum vias per diff pair",
                value="2",
                unit="",
                applies_to=nets,
                rationale="USB 3.x: minimize vias on SuperSpeed pairs to reduce impedance discontinuities",
                citation="USB 3.x routing guidelines: minimize layer transitions on 5Gbps+ signals",
                confidence=0.85,
            ))

        return constraints

    def _extract_ddr(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for DDR memory interfaces."""
        constraints: list[Constraint] = []
        ddr_gen = match.group(1)
        ddr_type = f"DDR{ddr_gen}"

        # Impedance targets by DDR generation
        z0_map = {"3": 50, "4": 50, "5": 40}
        zdiff_map = {"3": 100, "4": 100, "5": 80}
        z0 = z0_map.get(ddr_gen, 50)
        zdiff = zdiff_map.get(ddr_gen, 100)
        jedec_spec = f"JEDEC JESD79-{ddr_gen}"

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="impedance",
            parameter="data/address single-ended impedance",
            value=str(z0),
            unit="ohm",
            applies_to=nets,
            rationale=f"{ddr_type} requires {z0} ohm single-ended impedance on data and address lines",
            citation=f"{jedec_spec}: {z0} ohm +/-10% single-ended impedance",
            confidence=0.98,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter="clock differential impedance",
            value=str(zdiff),
            unit="ohm",
            applies_to=[n for n in nets if re.search(r"(CK|CLK)", n, re.IGNORECASE)] or nets,
            rationale=f"{ddr_type} clock pairs require {zdiff} ohm differential impedance",
            citation=f"{jedec_spec}: {zdiff} ohm differential clock impedance",
            confidence=0.98,
        ))

        byte_skew = "0.05" if ddr_gen == "5" else "0.1"
        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="byte lane internal skew",
            value=byte_skew,
            unit="mm",
            applies_to=nets,
            rationale=f"{ddr_type} data byte lanes must be length matched within +/-{byte_skew}mm",
            citation=f"{jedec_spec}: byte lane intra-group length matching",
            confidence=0.95,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="address/command to clock skew",
            value="0.64",
            unit="mm",
            applies_to=nets,
            rationale=f"{ddr_type} address and command signals must be matched to clock",
            citation=f"{jedec_spec}: address/command to CK/CK# timing requirements",
            confidence=0.9,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="spacing",
            parameter="minimum spacing between groups",
            value="0.2",
            unit="mm",
            applies_to=nets,
            rationale=f"{ddr_type} signal groups need adequate spacing for crosstalk isolation",
            citation=f"{jedec_spec} layout guidelines: inter-group spacing",
            confidence=0.9,
        ))

        return constraints

    def _extract_power_section(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for power delivery sections."""
        constraints: list[Constraint] = []
        current = float(match.group(1))

        # Trace width calculation (IPC-2221B, 1oz copper, 10C rise)
        # I = k * dT^0.44 * A^0.725 where A is cross-section area in mil^2
        # Solving for width at 1oz (1.4mil thickness):
        area_mil2 = (current / (0.048 * (10 ** 0.44))) ** (1 / 0.725)
        width_mil = area_mil2 / 1.4  # 1oz copper = 1.4 mil thick
        width_mm = width_mil * 0.0254

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="width",
            parameter="minimum trace width",
            value=f"{max(width_mm, 0.25):.2f}",
            unit="mm",
            applies_to=nets,
            rationale=f"{current}A current requires minimum {width_mm:.2f}mm trace width (1oz copper, 10C rise)",
            citation="IPC-2221B Section 6.2: conductor sizing for current capacity (external layer, 10C temperature rise)",
            confidence=0.9,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="copper_pour",
            parameter="copper fill",
            value="required",
            unit="",
            applies_to=nets,
            rationale=f"Copper pour reduces resistance and improves thermal performance for {current}A delivery",
            citation="PCB power distribution best practices: use copper pour for currents >1A",
            confidence=0.85,
        ))

        if current >= 3:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="thermal_relief",
                parameter="thermal vias",
                value="array of 0.3mm drill, 1mm pitch",
                unit="",
                applies_to=nets,
                rationale=f"{current}A load requires thermal vias for heat dissipation through the PCB",
                citation="IPC-7093: thermal via design for power applications",
                confidence=0.85,
            ))

        if current >= 5:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="width",
                parameter="minimum via current capacity",
                value=str(max(2, math.ceil(current / 1.5))),
                unit="parallel vias",
                applies_to=nets,
                rationale=f"Multiple parallel vias needed for {current}A layer transitions (~1.5A per 0.3mm via)",
                citation="IPC-2221B: via current capacity approximately 1-2A per 0.3mm plated via",
                confidence=0.8,
            ))

        return constraints

    def _extract_regulator(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for voltage regulators."""
        constraints: list[Constraint] = []
        reg_type = match.group(1).lower()

        if reg_type in ("buck", "switching"):
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="spacing",
                parameter="switching loop area",
                value="minimize",
                unit="",
                applies_to=nets,
                rationale="Switching regulator hot loop must be minimized to reduce EMI emissions",
                citation="AN-1149: Layout for switching regulators - minimize high di/dt loop area",
                confidence=0.95,
            ))
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="spacing",
                parameter="input cap to VIN pin distance",
                value="3",
                unit="mm max",
                applies_to=components,
                rationale="Input capacitor must be as close as possible to regulator VIN/GND pins",
                citation="TI SLVA477: Buck converter layout best practices",
                confidence=0.9,
            ))
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="keepout",
                parameter="sensitive signals under inductor",
                value="no routing",
                unit="",
                applies_to=components,
                rationale="Avoid routing sensitive signals under or near the switching inductor",
                citation="EMC design guidelines: inductor magnetic field coupling",
                confidence=0.85,
            ))

        elif reg_type in ("ldo", "linear"):
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="spacing",
                parameter="output cap to VOUT pin distance",
                value="3",
                unit="mm max",
                applies_to=components,
                rationale="LDO output capacitor must be close for stability (affects loop gain)",
                citation="LDO regulator application notes: output capacitor placement critical for stability",
                confidence=0.9,
            ))

        return constraints

    def _extract_analog_sensitive(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for sensitive analog sections."""
        constraints: list[Constraint] = []

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="guard_trace",
            parameter="guard ring",
            value="grounded guard ring around sensitive signals",
            unit="",
            applies_to=nets,
            rationale="Guard ring prevents noise from coupling into sensitive analog signals",
            citation="IPC-2221B: guard trace methodology for sensitive analog circuits",
            confidence=0.9,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="spacing",
            parameter="separation from digital signals",
            value="1.0",
            unit="mm minimum",
            applies_to=nets,
            rationale="Analog signals must be physically separated from digital to prevent noise injection",
            citation="Mixed-signal PCB design guidelines: analog/digital separation",
            confidence=0.9,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="copper_pour",
            parameter="dedicated analog ground plane",
            value="recommended",
            unit="",
            applies_to=nets,
            rationale="Dedicated analog ground region prevents digital return currents from coupling into analog signals",
            citation="Henry Ott - Electromagnetic Compatibility Engineering: ground plane partitioning for mixed-signal designs",
            confidence=0.85,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="width",
            parameter="analog signal trace width",
            value="0.2",
            unit="mm minimum",
            applies_to=nets,
            rationale="Wider traces reduce resistance and thermal noise in analog signal paths",
            citation="Low-noise PCB design guidelines: minimize trace resistance in signal path",
            confidence=0.8,
        ))

        return constraints

    def _extract_diff_pair(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for generic differential pairs."""
        constraints: list[Constraint] = []
        impedance = match.group(3) or "100"

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter="differential impedance",
            value=impedance,
            unit="ohm",
            applies_to=nets,
            rationale=f"Differential pair requires {impedance} ohm impedance control",
            citation=f"Differential signaling: {impedance} ohm impedance target",
            confidence=0.9,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="intra-pair skew",
            value="0.1",
            unit="mm",
            applies_to=nets,
            rationale="Differential pair members must be length matched for signal integrity",
            citation="Differential pair routing: maintain <5mil intra-pair skew for optimal common-mode rejection",
            confidence=0.9,
        ))

        return constraints

    def _extract_spi(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for SPI bus."""
        constraints: list[Constraint] = []
        freq = int(match.group(2) or "10")

        if freq >= 20:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="impedance",
                parameter="SPI signal impedance",
                value="50",
                unit="ohm",
                applies_to=nets,
                rationale=f"SPI at {freq}MHz benefits from impedance control",
                citation=f"High-speed SPI routing at {freq}MHz requires transmission line treatment",
                confidence=0.8,
            ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="SPI bus length match",
            value="1.0" if freq >= 50 else "2.0",
            unit="mm",
            applies_to=nets,
            rationale=f"SPI signals should be length matched at {freq}MHz for reliable timing",
            citation=f"SPI bus routing: match SCLK, MOSI, MISO within timing margin at {freq}MHz",
            confidence=0.85,
        ))

        return constraints

    def _extract_i2c(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for I2C bus."""
        constraints: list[Constraint] = []
        freq = int(match.group(2) or "400")
        freq_unit = (match.group(3) or "kHz").lower()

        cap_limit = "400" if freq <= 400 else "550"

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="spacing",
            parameter="maximum bus capacitance",
            value=cap_limit,
            unit="pF",
            applies_to=nets,
            rationale=f"I2C bus capacitance limit at {freq}{freq_unit} restricts total trace length",
            citation=f"NXP UM10204: I2C-bus specification - maximum bus capacitance {cap_limit}pF",
            confidence=0.95,
        ))

        return constraints

    def _extract_uart(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for UART interfaces."""
        constraints: list[Constraint] = []
        baud = match.group(2)

        if baud and int(baud) >= 1000000:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="impedance",
                parameter="UART signal impedance",
                value="50",
                unit="ohm",
                applies_to=nets,
                rationale=f"High-speed UART at {baud} baud benefits from impedance control",
                citation="UART routing at high baud rates: treat as transmission line above 1Mbps",
                confidence=0.75,
            ))

        return constraints

    def _extract_ethernet(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for Ethernet interfaces."""
        constraints: list[Constraint] = []
        interface = match.group(1).upper()
        speed = match.group(2) or ""

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter="Ethernet differential impedance",
            value="100",
            unit="ohm",
            applies_to=nets,
            rationale="Ethernet specification requires 100 ohm differential impedance",
            citation="IEEE 802.3: 100 ohm +/-10% differential impedance",
            confidence=0.98,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="intra-pair skew",
            value="0.1",
            unit="mm",
            applies_to=nets,
            rationale="Ethernet differential pairs must be tightly matched",
            citation="IEEE 802.3: differential pair routing guidelines",
            confidence=0.95,
        ))

        if interface in ("RGMII", "RMII") or "1G" in speed:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="length_match",
                parameter="inter-pair length match",
                value="5.0",
                unit="mm",
                applies_to=nets,
                rationale=f"{interface} requires length matching between TX and RX groups",
                citation=f"{interface} layout guidelines: signal group length matching",
                confidence=0.85,
            ))

        return constraints

    def _extract_rf(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for RF sections."""
        constraints: list[Constraint] = []

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="impedance",
            parameter="RF trace impedance",
            value="50",
            unit="ohm",
            applies_to=nets,
            rationale="RF signal paths require 50 ohm impedance matching",
            citation="Standard 50 ohm RF system impedance per IEEE/IEC conventions",
            confidence=0.95,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="keepout",
            parameter="ground plane clearance",
            value="no ground plane voids under RF traces",
            unit="",
            applies_to=nets,
            rationale="Continuous ground plane reference required under RF traces",
            citation="RF PCB design: maintain uninterrupted ground plane beneath all RF signal traces",
            confidence=0.95,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="spacing",
            parameter="RF isolation from digital",
            value="2.0",
            unit="mm minimum",
            applies_to=nets,
            rationale="RF signals need significant separation from digital noise sources",
            citation="EMC design guidelines: RF/digital section isolation",
            confidence=0.9,
        ))

        return constraints

    def _extract_video(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for video interfaces."""
        constraints: list[Constraint] = []
        interface = match.group(1).upper()

        impedance_map = {"HDMI": 100, "DISPLAYPORT": 100, "LVDS": 100, "MIPI": 100}
        z = impedance_map.get(interface, 100)

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter=f"{interface} differential impedance",
            value=str(z),
            unit="ohm",
            applies_to=nets,
            rationale=f"{interface} specification requires {z} ohm differential impedance",
            citation=f"{interface} specification: {z} ohm differential impedance",
            confidence=0.95,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="intra-pair skew",
            value="0.1",
            unit="mm",
            applies_to=nets,
            rationale=f"{interface} differential pairs must be tightly length matched",
            citation=f"{interface} routing guidelines",
            confidence=0.9,
        ))

        return constraints

    def _extract_pcie(
        self,
        match: re.Match,
        full_text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract constraints for PCIe interfaces."""
        constraints: list[Constraint] = []
        gen = match.group(2) or ""

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="diff_pair",
            parameter="PCIe differential impedance",
            value="85",
            unit="ohm",
            applies_to=nets,
            rationale="PCIe specification requires 85 ohm differential impedance",
            citation="PCI Express Base Specification: 85 ohm +/-10% differential impedance",
            confidence=0.98,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="length_match",
            parameter="intra-pair skew",
            value="0.05",
            unit="mm",
            applies_to=nets,
            rationale="PCIe differential pairs require very tight length matching",
            citation="PCI Express CEM specification: intra-pair skew requirements",
            confidence=0.95,
        ))

        constraints.append(Constraint(
            id=self._next_constraint_id(),
            type="via_count",
            parameter="maximum layer transitions",
            value="2",
            unit="per lane",
            applies_to=nets,
            rationale="Minimize vias on PCIe lanes to reduce impedance discontinuities",
            citation="PCI Express routing guidelines: minimize reference plane changes",
            confidence=0.85,
        ))

        return constraints

    def _extract_generic(
        self,
        text: str,
        nets: list[str],
        components: list[str],
    ) -> list[Constraint]:
        """Extract generic constraints from unmatched intent text."""
        constraints: list[Constraint] = []
        lower = text.lower()

        # Look for impedance mentions
        z_match = re.search(r"(\d+)\s*ohm", lower)
        if z_match:
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="impedance",
                parameter="target impedance",
                value=z_match.group(1),
                unit="ohm",
                applies_to=nets,
                rationale=f"Impedance target specified in intent: {z_match.group(0)}",
                citation="User-specified impedance target",
                confidence=0.7,
            ))

        # Look for width mentions
        w_match = re.search(r"(\d+)\s*(mil|mm)\s*(trace|width|track)", lower)
        if w_match:
            value = w_match.group(1)
            unit = w_match.group(2)
            constraints.append(Constraint(
                id=self._next_constraint_id(),
                type="width",
                parameter="minimum trace width",
                value=value,
                unit=unit,
                applies_to=nets,
                rationale=f"Trace width specified in intent: {w_match.group(0)}",
                citation="User-specified trace width",
                confidence=0.7,
            ))

        return constraints

    # ------------------------------------------------------------------
    # LLM enhancement
    # ------------------------------------------------------------------

    async def _llm_process_intent(
        self,
        block_annotation: str,
        schematic_context: dict[str, Any] | None,
        existing_constraints: list[Constraint],
    ) -> list[Constraint]:
        """Use LLM for enhanced intent processing."""
        if self._agent is None:
            return []

        try:
            context_str = ""
            if schematic_context:
                context_str = f"\nSchematic context:\n{json.dumps(schematic_context, indent=2, default=str)[:3000]}"

            existing_str = json.dumps(
                [{"type": c.type, "parameter": c.parameter, "value": c.value} for c in existing_constraints],
                indent=2,
            )

            response = await self._agent.chat(
                f"Convert this design intent into PCB constraints:\n"
                f"Intent: {block_annotation}\n"
                f"{context_str}\n\n"
                f"Already generated:\n{existing_str}\n\n"
                f"Add any missing constraints. For each constraint provide:\n"
                f"- type (impedance, length_match, spacing, width, guard_trace, copper_pour, etc.)\n"
                f"- parameter (what it controls)\n"
                f"- value and unit\n"
                f"- rationale\n"
                f"- citation (standard or datasheet reference)\n"
                f"Return as JSON array."
            )

            data = json.loads(response.message)
            if isinstance(data, list):
                return [
                    Constraint(
                        id=self._next_constraint_id(),
                        type=c.get("type", "general"),
                        parameter=c.get("parameter", ""),
                        value=str(c.get("value", "")),
                        unit=c.get("unit", ""),
                        applies_to=[],
                        rationale=c.get("rationale", ""),
                        citation=c.get("citation", "LLM analysis"),
                        confidence=0.7,
                    )
                    for c in data
                    if isinstance(c, dict)
                ]
        except Exception as e:
            logger.warning("LLM intent processing failed: %s", e)

        return []
