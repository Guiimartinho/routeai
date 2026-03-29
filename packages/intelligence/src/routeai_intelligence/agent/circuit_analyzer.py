"""Circuit Analyzer - LLM-powered functional block identification and net classification.

Uses the RouteAI agent to analyze schematics, identify functional blocks,
classify nets by signal type, and infer design rules from component types
and interface standards.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class BlockType(str, Enum):
    """Functional block categories in a PCB design."""
    POWER_SUPPLY = "power_supply"
    DIGITAL_CORE = "digital_core"
    ANALOG_FRONTEND = "analog_frontend"
    COMM_INTERFACE = "comm_interface"
    RF = "rf"
    MEMORY = "memory"
    SENSOR = "sensor"
    MOTOR_DRIVER = "motor_driver"
    PROTECTION = "protection"
    CLOCK = "clock"
    USER_IO = "user_io"
    DEBUG = "debug"
    UNKNOWN = "unknown"


class SignalType(str, Enum):
    """Signal classification for nets."""
    POWER = "power"
    GROUND = "ground"
    CLOCK = "clock"
    HIGH_SPEED = "high_speed"
    ANALOG = "analog"
    DIGITAL = "digital"
    DIFFERENTIAL = "differential"
    RF_SIGNAL = "rf_signal"
    RESET = "reset"
    CONTROL = "control"
    DATA_BUS = "data_bus"
    I2C = "i2c"
    SPI = "spi"
    UART = "uart"
    USB = "usb"
    JTAG = "jtag"
    UNKNOWN = "unknown"


class FunctionalBlock(BaseModel):
    """A functional block identified in the schematic."""
    id: str = Field(description="Unique block identifier")
    type: BlockType = Field(description="Block functional category")
    name: str = Field(description="Human-readable block name")
    components: list[str] = Field(
        description="Component reference designators in this block"
    )
    nets: list[str] = Field(
        description="Net names associated with this block"
    )
    description: str = Field(description="Detailed description of the block's function")
    input_nets: list[str] = Field(
        default_factory=list,
        description="Input signal nets"
    )
    output_nets: list[str] = Field(
        default_factory=list,
        description="Output signal nets"
    )
    power_nets: list[str] = Field(
        default_factory=list,
        description="Power supply nets used by this block"
    )
    citations: list[str] = Field(
        default_factory=list,
        description="References supporting the classification"
    )


class NetClassification(BaseModel):
    """Signal type classification for a net."""
    net_name: str = Field(description="Net name from the schematic")
    signal_type: SignalType = Field(description="Classified signal type")
    frequency_estimate: str | None = Field(
        default=None,
        description="Estimated signal frequency (e.g., '100MHz', 'DC')"
    )
    voltage_level: str | None = Field(
        default=None,
        description="Voltage level (e.g., '3.3V', '1.8V LVCMOS')"
    )
    constraints_needed: list[str] = Field(
        default_factory=list,
        description="Constraint types needed for this net"
    )
    connected_pins: list[str] = Field(
        default_factory=list,
        description="Pin references connected to this net"
    )
    citations: list[str] = Field(
        default_factory=list,
        description="References supporting the classification"
    )


class DesignRule(BaseModel):
    """A design rule inferred from the schematic."""
    rule_id: str
    category: str = Field(description="Rule category: impedance, spacing, width, length_match, etc.")
    parameter: str = Field(description="What this rule controls")
    value: str = Field(description="Rule value")
    unit: str = Field(description="Value unit")
    applies_to: list[str] = Field(description="Net names or component groups this applies to")
    source: str = Field(description="Standard or datasheet this rule comes from")
    priority: str = Field(default="required", description="required, recommended, or optional")
    citation: str = Field(description="Specific citation for the rule")


class ConstraintSet(BaseModel):
    """A complete set of inferred design constraints."""
    rules: list[DesignRule] = Field(default_factory=list)
    net_classes: list[dict[str, Any]] = Field(default_factory=list)
    diff_pairs: list[dict[str, Any]] = Field(default_factory=list)
    length_groups: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Heuristic analysis engine
# ---------------------------------------------------------------------------

# Patterns for component identification
_POWER_REGULATOR_PREFIXES = {"U"}
_POWER_REGULATOR_VALUES = re.compile(
    r"(LDO|LM78|LM317|AMS1117|TPS|LTC|MP\d|TLV|AP\d|NCV|MIC|RT\d|SY\d|buck|boost|regulator)",
    re.IGNORECASE,
)
_PASSIVE_PREFIXES = {"R", "C", "L", "FB"}
_CONNECTOR_PREFIXES = {"J", "P", "CN"}
_CRYSTAL_PREFIXES = {"Y", "X"}
_DIODE_PREFIXES = {"D"}
_TRANSISTOR_PREFIXES = {"Q"}
_IC_PREFIXES = {"U"}

_POWER_NET_PATTERNS = re.compile(
    r"^(VCC|VDD|VBUS|V\d|AVCC|AVDD|DVCC|DVDD|3V3|5V|1V8|1V2|12V|VBAT|VSYS|VIN|VOUT|\+\d+V)",
    re.IGNORECASE,
)
_GROUND_NET_PATTERNS = re.compile(
    r"^(GND|AGND|DGND|PGND|GNDA|VSS|AVSS|DVSS|EARTH|0V)",
    re.IGNORECASE,
)
_CLOCK_NET_PATTERNS = re.compile(
    r"(CLK|CLOCK|SCK|SCLK|XTAL|OSC|HSE|LSE|MCLK|BCLK|LRCK|WCLK)",
    re.IGNORECASE,
)
_USB_NET_PATTERNS = re.compile(r"(USB|D\+|D\-|DP|DM|VBUS|CC1|CC2|SBU)", re.IGNORECASE)
_SPI_NET_PATTERNS = re.compile(r"(MOSI|MISO|SCK|SCLK|CS|SS|SPI)", re.IGNORECASE)
_I2C_NET_PATTERNS = re.compile(r"(SDA|SCL|I2C)", re.IGNORECASE)
_UART_NET_PATTERNS = re.compile(r"(TX|RX|TXD|RXD|UART)", re.IGNORECASE)
_JTAG_NET_PATTERNS = re.compile(r"(TCK|TMS|TDI|TDO|TRST|SWDIO|SWCLK|SWD|JTAG)", re.IGNORECASE)
_RESET_NET_PATTERNS = re.compile(r"(RESET|RST|NRST|NRESET)", re.IGNORECASE)

# DDR interface detection
_DDR_PATTERNS = re.compile(
    r"(DDR[345]?_|DQ\d|DQS|DM\d|BA\d|CAS|RAS|WE|CKE|ODT|A\d+_DDR|SDRAM)",
    re.IGNORECASE,
)
# Differential pair detection
_DIFF_PAIR_PATTERNS = re.compile(r"(.+?)([_]?[PN]$|_DIFF[_PN])", re.IGNORECASE)


class CircuitAnalyzer:
    """Analyzes schematic designs to identify functional blocks, classify nets,
    and infer design rules.

    This class provides both a fast heuristic analysis path and an LLM-assisted
    deep analysis path. The heuristic path can run without an API key and handles
    common patterns. The LLM path provides more nuanced analysis for complex designs.

    Args:
        agent: Optional RouteAIAgent instance for LLM-powered analysis.
            If None, only heuristic analysis is available.
    """

    def __init__(self, agent: Any | None = None) -> None:
        self._agent = agent

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def identify_blocks(
        self,
        schematic: dict[str, Any],
    ) -> list[FunctionalBlock]:
        """Identify functional blocks in the schematic.

        Analyzes component types, net names, and connectivity to group components
        into logical functional blocks (power supply, digital core, analog frontend,
        communication interfaces, etc.).

        Args:
            schematic: Serialized schematic dict with components, nets, and connections.

        Returns:
            List of identified FunctionalBlock objects.
        """
        components = schematic.get("components", [])
        nets = schematic.get("nets", [])
        connections = schematic.get("connections", schematic.get("wires", []))

        # Build connectivity map
        comp_net_map = self._build_component_net_map(components, nets)

        blocks: list[FunctionalBlock] = []
        assigned_components: set[str] = set()

        # 1. Identify power supply blocks
        power_blocks = self._find_power_blocks(components, nets, comp_net_map)
        for block in power_blocks:
            blocks.append(block)
            assigned_components.update(block.components)

        # 2. Identify communication interface blocks
        comm_blocks = self._find_comm_interface_blocks(components, nets, comp_net_map, assigned_components)
        for block in comm_blocks:
            blocks.append(block)
            assigned_components.update(block.components)

        # 3. Identify clock blocks
        clock_blocks = self._find_clock_blocks(components, nets, comp_net_map, assigned_components)
        for block in clock_blocks:
            blocks.append(block)
            assigned_components.update(block.components)

        # 4. Identify digital core blocks (MCU/FPGA)
        digital_blocks = self._find_digital_core_blocks(components, nets, comp_net_map, assigned_components)
        for block in digital_blocks:
            blocks.append(block)
            assigned_components.update(block.components)

        # 5. Identify analog blocks
        analog_blocks = self._find_analog_blocks(components, nets, comp_net_map, assigned_components)
        for block in analog_blocks:
            blocks.append(block)
            assigned_components.update(block.components)

        # 6. Group remaining into generic blocks
        remaining = [c for c in components if c.get("reference", "") not in assigned_components]
        if remaining:
            refs = [c["reference"] for c in remaining]
            remaining_nets = set()
            for ref in refs:
                remaining_nets.update(comp_net_map.get(ref, []))
            blocks.append(FunctionalBlock(
                id="block_misc",
                type=BlockType.UNKNOWN,
                name="Miscellaneous",
                components=refs,
                nets=list(remaining_nets),
                description="Components not assigned to a specific functional block",
            ))

        # LLM enhancement if agent is available
        if self._agent is not None:
            blocks = await self._llm_refine_blocks(schematic, blocks)

        return blocks

    async def classify_nets(
        self,
        schematic: dict[str, Any],
    ) -> list[NetClassification]:
        """Classify all nets in the schematic by signal type.

        Analyzes net names, connected component types, and pin functions to
        determine the signal type and constraints needed for each net.

        Args:
            schematic: Serialized schematic dict.

        Returns:
            List of NetClassification objects.
        """
        nets = schematic.get("nets", [])
        components = schematic.get("components", [])
        classifications: list[NetClassification] = []

        # Build pin function map
        pin_map = self._build_pin_function_map(components)

        for net in nets:
            net_name = net.get("name", net.get("id", ""))
            connected_pins = net.get("pinIds", net.get("pins", []))

            classification = self._classify_single_net(net_name, connected_pins, pin_map)
            classifications.append(classification)

        # LLM refinement if available
        if self._agent is not None:
            classifications = await self._llm_refine_classifications(schematic, classifications)

        return classifications

    async def infer_design_rules(
        self,
        schematic: dict[str, Any],
        components: list[dict[str, Any]] | None = None,
    ) -> ConstraintSet:
        """Infer design rules from the schematic and component specifications.

        Detects component interfaces and applies appropriate design rules:
        - DDR4 -> JEDEC timing and impedance rules
        - USB -> 90 ohm differential pairs
        - Buck converters -> minimize loop area
        - High-speed clocks -> impedance control
        - Analog sections -> guard traces and separation

        All rules include citations to standards or datasheets.

        Args:
            schematic: Serialized schematic dict.
            components: Optional list of component specs with datasheet info.

        Returns:
            ConstraintSet with all inferred rules.
        """
        nets = schematic.get("nets", [])
        comp_list = components or schematic.get("components", [])
        comp_net_map = self._build_component_net_map(comp_list, nets)
        net_classifications = await self.classify_nets(schematic)

        rules: list[DesignRule] = []
        net_classes: list[dict[str, Any]] = []
        diff_pairs: list[dict[str, Any]] = []
        length_groups: list[dict[str, Any]] = []
        rule_idx = 0

        # Classify nets into net classes
        power_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.POWER]
        ground_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.GROUND]
        clock_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.CLOCK]
        high_speed_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.HIGH_SPEED]
        analog_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.ANALOG]
        usb_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.USB]
        diff_nets = [nc.net_name for nc in net_classifications if nc.signal_type == SignalType.DIFFERENTIAL]

        # Power net class
        if power_nets:
            net_classes.append({
                "name": "Power",
                "nets": power_nets,
                "min_width_mm": 0.5,
                "min_clearance_mm": 0.2,
                "priority": "required",
                "citation": "IPC-2221B Section 6.2 - conductor sizing for current capacity",
            })

        # Default signal class
        digital_nets = [
            nc.net_name for nc in net_classifications
            if nc.signal_type in (SignalType.DIGITAL, SignalType.CONTROL, SignalType.RESET)
        ]
        if digital_nets:
            net_classes.append({
                "name": "Default",
                "nets": digital_nets,
                "min_width_mm": 0.15,
                "min_clearance_mm": 0.15,
                "priority": "required",
                "citation": "IPC-2221B Table 6-1 minimum conductor spacing",
            })

        # DDR interface rules
        ddr_nets = [n for n in (nc.net_name for nc in net_classifications) if _DDR_PATTERNS.search(n)]
        if ddr_nets:
            ddr_type = "DDR4"
            for comp in comp_list:
                val = comp.get("value", "")
                if "ddr5" in val.lower():
                    ddr_type = "DDR5"
                elif "ddr3" in val.lower():
                    ddr_type = "DDR3"

            z0 = "40" if ddr_type == "DDR5" else "50"
            zdiff = "80" if ddr_type == "DDR5" else "100"

            rule_idx += 1
            rules.append(DesignRule(
                rule_id=f"rule_{rule_idx}",
                category="impedance",
                parameter="single-ended impedance",
                value=z0,
                unit="ohm",
                applies_to=[n for n in ddr_nets if not re.search(r"(DQS|CK)", n, re.IGNORECASE)],
                source=f"{ddr_type} JEDEC JESD79-{{'DDR3':'3','DDR4':'4','DDR5':'5'}[ddr_type]}",
                citation=f"{ddr_type} JEDEC specification - single-ended impedance {z0} ohm +/-10%",
            ))

            # DQS differential pairs
            dqs_nets = [n for n in ddr_nets if re.search(r"DQS", n, re.IGNORECASE)]
            if dqs_nets:
                paired = _pair_differential_nets(dqs_nets)
                for p_name, n_name in paired:
                    diff_pairs.append({
                        "positive": p_name,
                        "negative": n_name,
                        "impedance_ohm": int(zdiff),
                        "citation": f"{ddr_type} JEDEC - DQS differential impedance {zdiff} ohm",
                    })

            # Byte lane length matching
            dq_groups: dict[str, list[str]] = {}
            for n in ddr_nets:
                match = re.search(r"DQ(\d+)", n, re.IGNORECASE)
                if match:
                    byte_lane = str(int(match.group(1)) // 8)
                    dq_groups.setdefault(byte_lane, []).append(n)

            for lane, lane_nets in dq_groups.items():
                length_groups.append({
                    "name": f"DDR_ByteLane{lane}",
                    "nets": lane_nets,
                    "max_skew_mm": 0.05 if ddr_type == "DDR5" else 0.1,
                    "citation": f"{ddr_type} JEDEC - byte lane length matching within +/-{0.05 if ddr_type == 'DDR5' else 0.1}mm",
                })

        # USB rules
        if usb_nets:
            paired = _pair_differential_nets(usb_nets)
            for p_name, n_name in paired:
                diff_pairs.append({
                    "positive": p_name,
                    "negative": n_name,
                    "impedance_ohm": 90,
                    "citation": "USB 2.0/3.x specification - 90 ohm differential impedance",
                })

            rule_idx += 1
            rules.append(DesignRule(
                rule_id=f"rule_{rule_idx}",
                category="impedance",
                parameter="USB differential impedance",
                value="90",
                unit="ohm",
                applies_to=usb_nets,
                source="USB 2.0/3.x Specification",
                citation="USB-IF specification: 90 ohm +/-10% differential impedance for all USB data pairs",
            ))

            rule_idx += 1
            rules.append(DesignRule(
                rule_id=f"rule_{rule_idx}",
                category="length_match",
                parameter="USB intra-pair skew",
                value="0.15",
                unit="mm",
                applies_to=usb_nets,
                source="USB 2.0/3.x Specification",
                citation="USB-IF specification: maximum intra-pair skew 150 mils for differential pairs",
            ))

        # Clock signal rules
        if clock_nets:
            rule_idx += 1
            rules.append(DesignRule(
                rule_id=f"rule_{rule_idx}",
                category="impedance",
                parameter="clock impedance control",
                value="50",
                unit="ohm",
                applies_to=clock_nets,
                source="General high-speed design practice",
                citation="Clock signals require controlled impedance (typically 50 ohm) to minimize reflections and jitter",
            ))

            net_classes.append({
                "name": "Clock",
                "nets": clock_nets,
                "min_width_mm": 0.125,
                "min_clearance_mm": 0.2,
                "impedance_ohm": 50,
                "priority": "required",
                "citation": "High-speed clock routing requires impedance control and adequate clearance",
            })

        # Analog signal rules
        if analog_nets:
            rule_idx += 1
            rules.append(DesignRule(
                rule_id=f"rule_{rule_idx}",
                category="spacing",
                parameter="analog signal isolation",
                value="1.0",
                unit="mm",
                applies_to=analog_nets,
                source="IPC-2221B / General analog design practice",
                citation="Analog signals should maintain adequate separation from digital signals to prevent noise coupling",
            ))

            net_classes.append({
                "name": "Analog",
                "nets": analog_nets,
                "min_width_mm": 0.2,
                "min_clearance_mm": 0.5,
                "priority": "recommended",
                "citation": "Analog nets benefit from wider traces and larger clearances to reduce noise",
            })

        # Buck converter loop area rules
        for comp in comp_list:
            val = (comp.get("value", "") + " " + comp.get("description", "")).lower()
            if any(kw in val for kw in ("buck", "tps", "mp1", "mp2", "lm267", "switching regulator")):
                ref = comp.get("reference", "")
                nearby_nets = comp_net_map.get(ref, [])
                rule_idx += 1
                rules.append(DesignRule(
                    rule_id=f"rule_{rule_idx}",
                    category="layout",
                    parameter="switching loop area",
                    value="minimize",
                    unit="",
                    applies_to=nearby_nets,
                    source="Application note / EMC best practices",
                    priority="required",
                    citation=f"Buck converter {ref}: minimize the hot loop area (input cap -> high-side FET -> inductor -> low-side FET -> input cap) to reduce EMI per component datasheet layout guidelines",
                ))

        # LLM enhancement
        if self._agent is not None:
            rules, net_classes, diff_pairs, length_groups = await self._llm_refine_rules(
                schematic, comp_list, rules, net_classes, diff_pairs, length_groups
            )

        return ConstraintSet(
            rules=rules,
            net_classes=net_classes,
            diff_pairs=diff_pairs,
            length_groups=length_groups,
            metadata={
                "total_nets": len(nets),
                "total_components": len(comp_list),
                "rules_count": len(rules),
                "net_classes_count": len(net_classes),
                "diff_pairs_count": len(diff_pairs),
                "length_groups_count": len(length_groups),
            },
        )

    # ------------------------------------------------------------------
    # Internal heuristic helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_component_net_map(
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
    ) -> dict[str, list[str]]:
        """Build a mapping of component references to their connected net names."""
        comp_net: dict[str, list[str]] = {}
        pin_to_comp: dict[str, str] = {}

        for comp in components:
            ref = comp.get("reference", "")
            for pin_id in comp.get("pads", comp.get("pins", [])):
                if isinstance(pin_id, str):
                    pin_to_comp[pin_id] = ref
                elif isinstance(pin_id, dict):
                    pin_to_comp[pin_id.get("id", "")] = ref

        for net in nets:
            net_name = net.get("name", net.get("id", ""))
            for pin_id in net.get("pinIds", net.get("pins", [])):
                comp_ref = pin_to_comp.get(pin_id, "")
                if comp_ref:
                    comp_net.setdefault(comp_ref, []).append(net_name)

        return comp_net

    @staticmethod
    def _build_pin_function_map(
        components: list[dict[str, Any]],
    ) -> dict[str, str]:
        """Build a map from pin IDs to pin function/type."""
        pin_map: dict[str, str] = {}
        for comp in components:
            ref = comp.get("reference", "")
            for pin in comp.get("pins", []):
                if isinstance(pin, dict):
                    pin_id = pin.get("id", "")
                    pin_type = pin.get("type", "passive")
                    pin_name = pin.get("name", "")
                    pin_map[pin_id] = f"{ref}:{pin_name}:{pin_type}"
        return pin_map

    def _classify_single_net(
        self,
        net_name: str,
        connected_pins: list[str],
        pin_map: dict[str, str],
    ) -> NetClassification:
        """Classify a single net based on name patterns and pin types."""
        constraints: list[str] = []

        # Power nets
        if _POWER_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.POWER,
                voltage_level=self._extract_voltage(net_name),
                frequency_estimate="DC",
                constraints_needed=["min_width", "copper_pour"],
                connected_pins=connected_pins,
                citations=["IPC-2221B Section 6.2"],
            )

        if _GROUND_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.GROUND,
                voltage_level="0V",
                frequency_estimate="DC",
                constraints_needed=["copper_pour", "via_stitching"],
                connected_pins=connected_pins,
                citations=["IPC-2221B - ground plane best practices"],
            )

        # USB nets
        if _USB_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.USB,
                frequency_estimate="480MHz" if "3" not in net_name.upper() else "5GHz",
                constraints_needed=["diff_pair", "impedance_control", "length_match"],
                connected_pins=connected_pins,
                citations=["USB 2.0/3.x Specification"],
            )

        # Clock nets
        if _CLOCK_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.CLOCK,
                constraints_needed=["impedance_control", "guard_trace"],
                connected_pins=connected_pins,
                citations=["General high-speed design guidelines"],
            )

        # DDR nets
        if _DDR_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.HIGH_SPEED,
                constraints_needed=["impedance_control", "length_match"],
                connected_pins=connected_pins,
                citations=["JEDEC DDR specification"],
            )

        # SPI
        if _SPI_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.SPI,
                constraints_needed=["length_match"],
                connected_pins=connected_pins,
                citations=["SPI protocol specification"],
            )

        # I2C
        if _I2C_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.I2C,
                frequency_estimate="400kHz",
                constraints_needed=["max_capacitance"],
                connected_pins=connected_pins,
                citations=["I2C-bus specification (NXP UM10204)"],
            )

        # UART
        if _UART_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.UART,
                connected_pins=connected_pins,
            )

        # JTAG/SWD
        if _JTAG_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.JTAG,
                connected_pins=connected_pins,
            )

        # Reset
        if _RESET_NET_PATTERNS.search(net_name):
            return NetClassification(
                net_name=net_name,
                signal_type=SignalType.RESET,
                connected_pins=connected_pins,
                citations=["Component datasheet reset requirements"],
            )

        # Default: digital
        return NetClassification(
            net_name=net_name,
            signal_type=SignalType.DIGITAL,
            connected_pins=connected_pins,
        )

    @staticmethod
    def _extract_voltage(net_name: str) -> str | None:
        """Extract voltage level from a net name."""
        patterns = [
            (r"(\d+)V(\d+)", lambda m: f"{m.group(1)}.{m.group(2)}V"),
            (r"(\d+(?:\.\d+)?)V", lambda m: f"{m.group(1)}V"),
        ]
        for pattern, formatter in patterns:
            match = re.search(pattern, net_name, re.IGNORECASE)
            if match:
                return formatter(match)
        if "VCC" in net_name.upper() or "VDD" in net_name.upper():
            return "3.3V"
        return None

    def _find_power_blocks(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
    ) -> list[FunctionalBlock]:
        """Find power supply blocks (regulators + surrounding passives)."""
        blocks: list[FunctionalBlock] = []
        regulators: list[dict[str, Any]] = []

        for comp in components:
            ref = comp.get("reference", "")
            val = comp.get("value", "") + " " + comp.get("description", "")
            if _POWER_REGULATOR_VALUES.search(val):
                regulators.append(comp)

        for i, reg in enumerate(regulators):
            ref = reg.get("reference", "")
            reg_nets = set(comp_net_map.get(ref, []))

            # Find associated passives (capacitors, inductors connected to same nets)
            associated = [ref]
            for comp in components:
                cref = comp.get("reference", "")
                if cref == ref:
                    continue
                prefix = re.match(r"[A-Z]+", cref)
                if prefix and prefix.group() in _PASSIVE_PREFIXES:
                    comp_nets = set(comp_net_map.get(cref, []))
                    if comp_nets & reg_nets:
                        associated.append(cref)

            power_nets = [n for n in reg_nets if _POWER_NET_PATTERNS.search(n)]
            input_nets = [n for n in reg_nets if any(kw in n.upper() for kw in ("VIN", "VBUS", "INPUT"))]
            output_nets = [n for n in reg_nets if any(kw in n.upper() for kw in ("VOUT", "OUTPUT"))]

            blocks.append(FunctionalBlock(
                id=f"block_power_{i}",
                type=BlockType.POWER_SUPPLY,
                name=f"Power Supply ({reg.get('value', ref)})",
                components=associated,
                nets=list(reg_nets),
                description=f"Power supply block centered on {ref} ({reg.get('value', '')}) with {len(associated) - 1} supporting passives",
                input_nets=input_nets,
                output_nets=output_nets or power_nets,
                power_nets=power_nets,
                citations=["Component datasheet layout guidelines"],
            ))

        return blocks

    def _find_comm_interface_blocks(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
        assigned: set[str],
    ) -> list[FunctionalBlock]:
        """Find communication interface blocks (USB, Ethernet, etc.)."""
        blocks: list[FunctionalBlock] = []

        # USB block
        usb_nets = [n.get("name", "") for n in nets if _USB_NET_PATTERNS.search(n.get("name", ""))]
        if usb_nets:
            usb_comps: list[str] = []
            for comp in components:
                ref = comp.get("reference", "")
                if ref in assigned:
                    continue
                comp_nets = set(comp_net_map.get(ref, []))
                if comp_nets & set(usb_nets):
                    usb_comps.append(ref)

            if usb_comps:
                blocks.append(FunctionalBlock(
                    id="block_usb",
                    type=BlockType.COMM_INTERFACE,
                    name="USB Interface",
                    components=usb_comps,
                    nets=usb_nets,
                    description="USB communication interface with associated ESD protection and connectors",
                    citations=["USB 2.0/3.x Specification"],
                ))

        return blocks

    def _find_clock_blocks(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
        assigned: set[str],
    ) -> list[FunctionalBlock]:
        """Find clock generation/distribution blocks."""
        blocks: list[FunctionalBlock] = []
        crystal_comps: list[str] = []

        for comp in components:
            ref = comp.get("reference", "")
            if ref in assigned:
                continue
            prefix = re.match(r"[A-Z]+", ref)
            if prefix and prefix.group() in _CRYSTAL_PREFIXES:
                crystal_comps.append(ref)

        if crystal_comps:
            clock_nets_set: set[str] = set()
            all_comps = list(crystal_comps)
            for ref in crystal_comps:
                comp_nets = comp_net_map.get(ref, [])
                clock_nets_set.update(comp_nets)
                # Find load capacitors
                for comp in components:
                    cref = comp.get("reference", "")
                    if cref in assigned or cref in all_comps:
                        continue
                    if cref.startswith("C"):
                        ccomp_nets = set(comp_net_map.get(cref, []))
                        if ccomp_nets & clock_nets_set:
                            all_comps.append(cref)

            blocks.append(FunctionalBlock(
                id="block_clock",
                type=BlockType.CLOCK,
                name="Clock Generation",
                components=all_comps,
                nets=list(clock_nets_set),
                description=f"Clock generation block with {len(crystal_comps)} crystal(s) and load capacitors",
                citations=["Crystal manufacturer application notes"],
            ))

        return blocks

    def _find_digital_core_blocks(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
        assigned: set[str],
    ) -> list[FunctionalBlock]:
        """Find digital core blocks (MCUs, FPGAs, processors)."""
        blocks: list[FunctionalBlock] = []
        mcu_keywords = re.compile(
            r"(STM32|ATME|PIC|ESP32|NRF|SAMD|RP2040|FPGA|XC\d|ECP|ICE40|MCU|CPU|PROCESSOR)",
            re.IGNORECASE,
        )

        for comp in components:
            ref = comp.get("reference", "")
            if ref in assigned:
                continue
            val = comp.get("value", "") + " " + comp.get("description", "")
            if mcu_keywords.search(val):
                comp_nets = set(comp_net_map.get(ref, []))

                # Find decoupling caps
                decap_refs: list[str] = []
                for c2 in components:
                    cref = c2.get("reference", "")
                    if cref in assigned or cref == ref:
                        continue
                    if cref.startswith("C"):
                        c2_nets = set(comp_net_map.get(cref, []))
                        power_overlap = any(
                            _POWER_NET_PATTERNS.search(n) or _GROUND_NET_PATTERNS.search(n)
                            for n in (c2_nets & comp_nets)
                        )
                        if power_overlap:
                            decap_refs.append(cref)

                all_refs = [ref] + decap_refs
                power_nets = [n for n in comp_nets if _POWER_NET_PATTERNS.search(n) or _GROUND_NET_PATTERNS.search(n)]

                blocks.append(FunctionalBlock(
                    id=f"block_digital_{ref}",
                    type=BlockType.DIGITAL_CORE,
                    name=f"Digital Core ({comp.get('value', ref)})",
                    components=all_refs,
                    nets=list(comp_nets),
                    description=f"Digital core block: {comp.get('value', '')} with {len(decap_refs)} decoupling capacitors",
                    power_nets=power_nets,
                    citations=["Component datasheet"],
                ))

        return blocks

    def _find_analog_blocks(
        self,
        components: list[dict[str, Any]],
        nets: list[dict[str, Any]],
        comp_net_map: dict[str, list[str]],
        assigned: set[str],
    ) -> list[FunctionalBlock]:
        """Find analog frontend blocks (op-amps, ADCs, DACs)."""
        blocks: list[FunctionalBlock] = []
        analog_keywords = re.compile(
            r"(OPAMP|OP-AMP|LM358|TL07|OPA\d|AD\d|MCP\d|ADS\d|DAC|ADC|ANALOG|AMP)",
            re.IGNORECASE,
        )

        analog_comps: list[str] = []
        analog_nets_set: set[str] = set()

        for comp in components:
            ref = comp.get("reference", "")
            if ref in assigned:
                continue
            val = comp.get("value", "") + " " + comp.get("description", "")
            if analog_keywords.search(val):
                analog_comps.append(ref)
                analog_nets_set.update(comp_net_map.get(ref, []))

        if analog_comps:
            # Find associated passive components
            for comp in components:
                ref = comp.get("reference", "")
                if ref in assigned or ref in analog_comps:
                    continue
                prefix = re.match(r"[A-Z]+", ref)
                if prefix and prefix.group() in _PASSIVE_PREFIXES:
                    comp_nets = set(comp_net_map.get(ref, []))
                    if comp_nets & analog_nets_set:
                        analog_comps.append(ref)

            blocks.append(FunctionalBlock(
                id="block_analog",
                type=BlockType.ANALOG_FRONTEND,
                name="Analog Frontend",
                components=analog_comps,
                nets=list(analog_nets_set),
                description=f"Analog signal processing block with {len(analog_comps)} components",
                citations=["Op-amp datasheet layout guidelines"],
            ))

        return blocks

    # ------------------------------------------------------------------
    # LLM refinement methods
    # ------------------------------------------------------------------

    async def _llm_refine_blocks(
        self,
        schematic: dict[str, Any],
        blocks: list[FunctionalBlock],
    ) -> list[FunctionalBlock]:
        """Use LLM to refine block identification."""
        if self._agent is None:
            return blocks

        prompt = (
            "I have identified the following functional blocks in a schematic. "
            "Please review and refine them. For each block, verify the classification "
            "and suggest any missing components or corrections.\n\n"
            f"Blocks:\n{json.dumps([b.model_dump() for b in blocks], indent=2, default=str)}\n\n"
            f"Schematic context:\n{json.dumps(schematic, indent=2, default=str)[:3000]}\n\n"
            "Return the refined blocks as a JSON array."
        )

        try:
            response = await self._agent.chat(prompt)
            parsed = json.loads(response.message) if response.message.strip().startswith("[") else blocks
            if isinstance(parsed, list):
                return [FunctionalBlock(**b) if isinstance(b, dict) else b for b in parsed]
        except Exception as e:
            logger.warning("LLM block refinement failed: %s. Using heuristic results.", e)

        return blocks

    async def _llm_refine_classifications(
        self,
        schematic: dict[str, Any],
        classifications: list[NetClassification],
    ) -> list[NetClassification]:
        """Use LLM to refine net classifications.

        Sends the heuristic classifications and schematic context to Claude
        for expert review. The LLM corrects misclassifications, adds missing
        frequency estimates, voltage levels, and constraint recommendations
        that the heuristic engine cannot infer from naming alone.
        """
        if self._agent is None:
            return classifications

        # Build a concise summary of classifications for the prompt.
        classification_summary = []
        for nc in classifications:
            entry = {
                "net": nc.net_name,
                "type": nc.signal_type.value,
                "freq": nc.frequency_estimate,
                "voltage": nc.voltage_level,
                "constraints": nc.constraints_needed,
                "pins": nc.connected_pins[:6],  # Limit pin list size.
            }
            classification_summary.append(entry)

        # Truncate schematic context to avoid exceeding token limits.
        sch_context = json.dumps(schematic, indent=2, default=str)
        if len(sch_context) > 4000:
            sch_context = sch_context[:4000] + "\n... (truncated)"

        prompt = (
            "You are an expert PCB design engineer. I ran a heuristic net "
            "classifier on a schematic and need you to refine the results.\n\n"
            "For each net, verify the signal type classification and improve "
            "the frequency estimate, voltage level, and constraint recommendations. "
            "Pay special attention to:\n"
            "- Nets that may be misclassified (e.g., a UART TX line classified as generic digital)\n"
            "- High-speed signals that need impedance control but weren't flagged\n"
            "- Analog signals near digital sections that need guard traces\n"
            "- Power nets that need specific width requirements based on current\n\n"
            f"Heuristic classifications:\n{json.dumps(classification_summary, indent=2)}\n\n"
            f"Schematic context:\n{sch_context}\n\n"
            "Return a JSON array of refined classifications. Each entry must have:\n"
            '  "net": net name,\n'
            '  "type": one of [power, ground, clock, high_speed, analog, digital, '
            'differential, rf_signal, reset, control, data_bus, i2c, spi, uart, usb, jtag, unknown],\n'
            '  "freq": frequency estimate string or null,\n'
            '  "voltage": voltage level string or null,\n'
            '  "constraints": list of constraint type strings,\n'
            '  "citations": list of standard/datasheet references supporting the classification\n'
            "Only include nets where you changed something. Omit unchanged nets."
        )

        try:
            response = await self._agent.chat(prompt)
            content = response.message.strip()

            # Extract JSON array from the response.
            json_start = content.find("[")
            json_end = content.rfind("]") + 1
            if json_start == -1 or json_end <= json_start:
                logger.warning("LLM classification refinement: no JSON array found in response")
                return classifications

            refinements = json.loads(content[json_start:json_end])
            if not isinstance(refinements, list):
                return classifications

            # Build a lookup of refinements by net name.
            refinement_map: dict[str, dict[str, Any]] = {}
            for r in refinements:
                if isinstance(r, dict) and "net" in r:
                    refinement_map[r["net"]] = r

            # Apply refinements to the original classifications.
            refined: list[NetClassification] = []
            for nc in classifications:
                if nc.net_name in refinement_map:
                    r = refinement_map[nc.net_name]
                    # Map the type string to the SignalType enum.
                    new_type_str = r.get("type", nc.signal_type.value)
                    try:
                        new_type = SignalType(new_type_str)
                    except ValueError:
                        new_type = nc.signal_type

                    refined.append(NetClassification(
                        net_name=nc.net_name,
                        signal_type=new_type,
                        frequency_estimate=r.get("freq", nc.frequency_estimate),
                        voltage_level=r.get("voltage", nc.voltage_level),
                        constraints_needed=r.get("constraints", nc.constraints_needed),
                        connected_pins=nc.connected_pins,
                        citations=r.get("citations", nc.citations),
                    ))
                else:
                    refined.append(nc)

            logger.info(
                "LLM refined %d of %d net classifications",
                len(refinement_map), len(classifications),
            )
            return refined

        except Exception as e:
            logger.warning("LLM net classification refinement failed: %s. Using heuristic results.", e)
            return classifications

    async def _llm_refine_rules(
        self,
        schematic: dict[str, Any],
        components: list[dict[str, Any]],
        rules: list[DesignRule],
        net_classes: list[dict[str, Any]],
        diff_pairs: list[dict[str, Any]],
        length_groups: list[dict[str, Any]],
    ) -> tuple[list[DesignRule], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """Use LLM to enhance inferred rules with datasheet-specific constraints.

        Sends the heuristic-derived rules along with the component list to
        Claude. The LLM reviews the rules for correctness, adds component-
        specific constraints from its knowledge of datasheets (e.g., specific
        decoupling requirements, thermal pad specifications, keep-out zones),
        and identifies any missing rules that the heuristic engine could not
        infer.
        """
        if self._agent is None:
            return rules, net_classes, diff_pairs, length_groups

        # Serialize current rules for the prompt.
        rules_summary = [
            {
                "id": r.rule_id,
                "category": r.category,
                "parameter": r.parameter,
                "value": r.value,
                "unit": r.unit,
                "applies_to": r.applies_to[:5],  # Limit list size.
                "source": r.source,
            }
            for r in rules
        ]

        # Summarize components for the LLM.
        comp_summary = []
        for c in components[:30]:  # Limit to 30 components to fit in context.
            comp_summary.append({
                "reference": c.get("reference", ""),
                "value": c.get("value", ""),
                "footprint": c.get("footprint", ""),
                "description": c.get("description", "")[:100],
            })

        prompt = (
            "You are an expert PCB design engineer with deep knowledge of "
            "component datasheets and industry standards. Review the following "
            "heuristic-generated design rules and improve them.\n\n"
            f"Components in this design:\n{json.dumps(comp_summary, indent=2)}\n\n"
            f"Current rules ({len(rules)} total):\n{json.dumps(rules_summary, indent=2)}\n\n"
            f"Current net classes: {json.dumps(net_classes, indent=2)}\n\n"
            f"Current diff pairs: {json.dumps(diff_pairs, indent=2)}\n\n"
            f"Current length groups: {json.dumps(length_groups, indent=2)}\n\n"
            "Please return a JSON object with these keys:\n"
            '"additional_rules": array of new rules to add. Each rule:\n'
            '  {"category": str, "parameter": str, "value": str, "unit": str, '
            '"applies_to": [net names], "source": str, "priority": str, "citation": str}\n'
            '"modified_rules": array of rule corrections. Each:\n'
            '  {"rule_id": str, "value": new_value, "unit": new_unit, "citation": updated_citation}\n'
            '"additional_diff_pairs": array of {positive, negative, impedance_ohm, citation}\n'
            '"additional_length_groups": array of {name, nets, max_skew_mm, citation}\n\n'
            "Focus on:\n"
            "- Component-specific constraints from datasheets (decoupling, thermal pads)\n"
            "- Missing impedance rules for high-speed interfaces\n"
            "- Correcting any overly conservative or incorrect rule values\n"
            "- Adding keep-out zone rules where needed\n"
            "- Identifying differential pairs the heuristic missed\n"
            "Return only the JSON object, no additional text."
        )

        try:
            response = await self._agent.chat(prompt)
            content = response.message.strip()

            # Extract JSON object from the response.
            json_start = content.find("{")
            json_end = content.rfind("}") + 1
            if json_start == -1 or json_end <= json_start:
                logger.warning("LLM rule refinement: no JSON object found in response")
                return rules, net_classes, diff_pairs, length_groups

            refinement = json.loads(content[json_start:json_end])
            if not isinstance(refinement, dict):
                return rules, net_classes, diff_pairs, length_groups

            # Apply rule modifications.
            modified_rules = {
                m["rule_id"]: m
                for m in refinement.get("modified_rules", [])
                if isinstance(m, dict) and "rule_id" in m
            }

            updated_rules: list[DesignRule] = []
            for rule in rules:
                if rule.rule_id in modified_rules:
                    mod = modified_rules[rule.rule_id]
                    updated_rules.append(DesignRule(
                        rule_id=rule.rule_id,
                        category=rule.category,
                        parameter=rule.parameter,
                        value=str(mod.get("value", rule.value)),
                        unit=mod.get("unit", rule.unit),
                        applies_to=rule.applies_to,
                        source=rule.source,
                        priority=rule.priority,
                        citation=mod.get("citation", rule.citation),
                    ))
                else:
                    updated_rules.append(rule)

            # Add new rules from LLM.
            next_rule_idx = len(updated_rules) + 1
            for new_rule in refinement.get("additional_rules", []):
                if not isinstance(new_rule, dict):
                    continue
                if not new_rule.get("category") or not new_rule.get("parameter"):
                    continue

                updated_rules.append(DesignRule(
                    rule_id=f"rule_{next_rule_idx}",
                    category=new_rule.get("category", ""),
                    parameter=new_rule.get("parameter", ""),
                    value=str(new_rule.get("value", "")),
                    unit=new_rule.get("unit", ""),
                    applies_to=new_rule.get("applies_to", []),
                    source=new_rule.get("source", "LLM analysis"),
                    priority=new_rule.get("priority", "recommended"),
                    citation=new_rule.get("citation", "Identified by LLM design rule analysis"),
                ))
                next_rule_idx += 1

            # Add new diff pairs.
            updated_diff_pairs = list(diff_pairs)
            for dp in refinement.get("additional_diff_pairs", []):
                if isinstance(dp, dict) and "positive" in dp and "negative" in dp:
                    updated_diff_pairs.append({
                        "positive": dp["positive"],
                        "negative": dp["negative"],
                        "impedance_ohm": dp.get("impedance_ohm", 100),
                        "citation": dp.get("citation", "Identified by LLM analysis"),
                    })

            # Add new length groups.
            updated_length_groups = list(length_groups)
            for lg in refinement.get("additional_length_groups", []):
                if isinstance(lg, dict) and "name" in lg and "nets" in lg:
                    updated_length_groups.append({
                        "name": lg["name"],
                        "nets": lg["nets"],
                        "max_skew_mm": lg.get("max_skew_mm", 0.5),
                        "citation": lg.get("citation", "Identified by LLM analysis"),
                    })

            added_rules = len(updated_rules) - len(rules)
            modified_count = len(modified_rules)
            logger.info(
                "LLM rule refinement: %d rules modified, %d rules added, "
                "%d diff pairs added, %d length groups added",
                modified_count, added_rules,
                len(updated_diff_pairs) - len(diff_pairs),
                len(updated_length_groups) - len(length_groups),
            )

            return updated_rules, net_classes, updated_diff_pairs, updated_length_groups

        except Exception as e:
            logger.warning("LLM rule refinement failed: %s. Using heuristic results.", e)
            return rules, net_classes, diff_pairs, length_groups


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def _pair_differential_nets(net_names: list[str]) -> list[tuple[str, str]]:
    """Attempt to pair differential net names (P/N or +/-)."""
    pairs: list[tuple[str, str]] = []
    used: set[str] = set()

    for name in sorted(net_names):
        if name in used:
            continue
        # Try common differential naming conventions
        for pos_suffix, neg_suffix in [("P", "N"), ("+", "-"), ("_P", "_N"), ("DP", "DM")]:
            if name.endswith(pos_suffix):
                partner = name[:-len(pos_suffix)] + neg_suffix
                if partner in net_names and partner not in used:
                    pairs.append((name, partner))
                    used.add(name)
                    used.add(partner)
                    break

    return pairs
