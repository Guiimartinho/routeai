"""Circuit zone analysis for intelligent PCB placement.

Analyzes a schematic design to identify functional zones (power, digital,
analog, RF, connectors, decoupling, clock), critical component pairs that
must be placed near each other, and thermal groups requiring heat management.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from routeai_parsers.models import SchematicDesign, SchSymbol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Zone type constants
# ---------------------------------------------------------------------------

ZONE_POWER = "POWER"
ZONE_DIGITAL = "DIGITAL"
ZONE_ANALOG = "ANALOG"
ZONE_RF = "RF"
ZONE_CONNECTORS = "CONNECTORS"
ZONE_DECOUPLING = "DECOUPLING"
ZONE_CLOCK = "CLOCK"

_ALL_ZONE_TYPES = (
    ZONE_POWER, ZONE_DIGITAL, ZONE_ANALOG, ZONE_RF,
    ZONE_CONNECTORS, ZONE_DECOUPLING, ZONE_CLOCK,
)

# Zone placement priority (lower number = higher priority = placed first)
_ZONE_PRIORITY: dict[str, int] = {
    ZONE_CONNECTORS: 1,
    ZONE_POWER: 2,
    ZONE_DIGITAL: 3,
    ZONE_DECOUPLING: 4,
    ZONE_CLOCK: 5,
    ZONE_RF: 6,
    ZONE_ANALOG: 7,
}

# IPC constraints by zone
_ZONE_CONSTRAINTS: dict[str, list[str]] = {
    ZONE_POWER: [
        "IPC-2221B Section 6.2: Power plane connections",
        "Minimize high-current loop areas",
    ],
    ZONE_DIGITAL: [
        "IPC-2221B Section 6.3: Signal routing",
        "Maintain consistent impedance for high-speed signals",
    ],
    ZONE_ANALOG: [
        "IPC-2221B Section 6.4: Analog signal isolation",
        "Separate analog and digital ground planes",
        "Guard ring for sensitive analog circuits",
    ],
    ZONE_RF: [
        "IPC-2221B Section 6.5: RF layout guidelines",
        "Controlled impedance matching networks",
        "Minimize trace stubs",
    ],
    ZONE_CONNECTORS: [
        "IPC-7351: Connector placement at board edges",
        "ESD protection close to connector pins",
    ],
    ZONE_DECOUPLING: [
        "IPC-7351: Bypass capacitor placement",
        "Place within 2mm of associated IC power pin",
        "Short, wide traces to ground plane",
    ],
    ZONE_CLOCK: [
        "IPC-2221B: Clock signal integrity",
        "Minimize clock trace length",
        "Guard traces for clock signals",
    ],
}


# ---------------------------------------------------------------------------
# Reference designator classification patterns
# ---------------------------------------------------------------------------

# Regex for extracting the alpha prefix from a reference designator
_REF_PREFIX_RE = re.compile(r"^([A-Za-z]+)")

# Keywords and lib_id substrings used for finer classification
_POWER_KEYWORDS = frozenset({
    "regulator", "ldo", "buck", "boost", "converter", "vreg", "power",
    "mosfet", "fet", "pmos", "nmos", "inductor",
})
_ANALOG_KEYWORDS = frozenset({
    "opamp", "op-amp", "adc", "dac", "amplifier", "comparator",
    "reference", "vref", "analog", "ina",
})
_RF_KEYWORDS = frozenset({
    "antenna", "rf", "balun", "lna", "mixer", "filter_rf",
    "matching", "saw", "diplexer",
})
_CLOCK_KEYWORDS = frozenset({
    "crystal", "oscillator", "xtal", "clock", "pll", "tcxo", "vcxo",
})
_CONNECTOR_KEYWORDS = frozenset({
    "connector", "usb", "ethernet", "header", "jack", "receptacle",
    "terminal", "rj45", "hdmi", "uart", "spi", "jtag", "swd",
})
_MCU_FPGA_KEYWORDS = frozenset({
    "mcu", "stm32", "esp32", "nrf", "pic", "avr", "fpga", "cpld",
    "sam", "rp2040", "atsam", "xc7", "ice40",
})

# Power net name patterns
_POWER_NET_RE = re.compile(
    r"^(VCC|VDD|VBUS|VIN|VOUT|V3V3|3V3|5V|1V8|12V|GND|AGND|DGND|VSS|AVDD|DVDD)",
    re.IGNORECASE,
)

# High-power component patterns (for thermal analysis)
_HIGH_POWER_LIB_IDS = frozenset({
    "regulator", "mosfet", "fet", "converter", "driver", "amplifier",
})


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ComponentZone:
    """A group of components belonging to the same functional zone."""

    zone_type: str  # One of ZONE_* constants
    components: list[str]  # Component reference designators
    priority: int  # Placement priority (1=highest)
    constraints: list[str]  # Applicable IPC rules

    def __repr__(self) -> str:
        return (
            f"ComponentZone(type={self.zone_type!r}, "
            f"count={len(self.components)}, priority={self.priority})"
        )


@dataclass
class CriticalPair:
    """Two components that MUST be placed near each other."""

    component_a: str  # Reference designator
    component_b: str  # Reference designator
    max_distance_mm: float  # Maximum allowed distance
    reason: str  # Human-readable explanation
    rule_source: str  # E.g. "IC datasheet", "IPC-7351"

    def __repr__(self) -> str:
        return (
            f"CriticalPair({self.component_a} <-> {self.component_b}, "
            f"max={self.max_distance_mm}mm)"
        )


@dataclass
class ThermalGroup:
    """Components that dissipate significant heat and need thermal management."""

    components: list[str]  # Reference designators
    estimated_power_w: float  # Total estimated power dissipation
    strategy: str  # e.g. "thermal_vias", "heatsink", "copper_pour"
    notes: list[str] = field(default_factory=list)

    def __repr__(self) -> str:
        return (
            f"ThermalGroup(components={self.components}, "
            f"power={self.estimated_power_w:.2f}W)"
        )


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------


class CircuitZoneAnalyzer:
    """Analyzes a schematic to identify functional zones for placement.

    Separates components into zones based on function:
    - POWER: voltage regulators, power MOSFETs, inductors, bulk caps
    - DIGITAL: MCUs, FPGAs, logic ICs, digital interfaces
    - ANALOG: ADCs, DACs, op-amps, precision references
    - RF: antennas, matching networks, RF switches
    - CONNECTORS: USB, Ethernet, headers, test points
    - DECOUPLING: bypass caps associated with specific ICs
    - CLOCK: crystals, oscillators, clock buffers
    """

    def analyze(self, schematic: SchematicDesign) -> list[ComponentZone]:
        """Classify all components into functional zones.

        Examines each symbol's reference designator, lib_id, value, and
        net connectivity to assign it to the most appropriate zone.

        Args:
            schematic: Parsed schematic design.

        Returns:
            List of ComponentZone, one per zone type that has members.
        """
        zone_map: dict[str, list[str]] = {z: [] for z in _ALL_ZONE_TYPES}

        # Build net connectivity index: net_name -> set of component refs
        net_to_refs = self._build_net_index(schematic)

        # Build IC reference set (for decoupling detection)
        ic_refs = self._find_ic_refs(schematic)

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue

            zone = self._classify_component(symbol, net_to_refs, ic_refs, schematic)
            zone_map[zone].append(ref)

        # Build result list, only including non-empty zones
        results: list[ComponentZone] = []
        for zone_type in _ALL_ZONE_TYPES:
            components = zone_map[zone_type]
            if components:
                results.append(ComponentZone(
                    zone_type=zone_type,
                    components=sorted(components),
                    priority=_ZONE_PRIORITY.get(zone_type, 8),
                    constraints=list(_ZONE_CONSTRAINTS.get(zone_type, [])),
                ))

        # Sort by priority (lowest number first)
        results.sort(key=lambda z: z.priority)

        logger.info(
            "Zone analysis: %d zones, %d total components classified",
            len(results),
            sum(len(z.components) for z in results),
        )
        return results

    def identify_critical_pairs(
        self, schematic: SchematicDesign
    ) -> list[CriticalPair]:
        """Find components that MUST be placed near each other.

        Detects:
        - Decoupling caps -> their IC (< 2mm)
        - Crystal -> MCU (< 5mm)
        - Series resistors -> their IC pin
        - ESD protection -> connector
        - Feedback divider -> regulator

        Args:
            schematic: Parsed schematic design.

        Returns:
            List of CriticalPair constraints.
        """
        pairs: list[CriticalPair] = []
        net_to_pins = self._build_net_pin_index(schematic)
        ic_refs = self._find_ic_refs(schematic)
        ref_to_symbol = {s.reference: s for s in schematic.symbols if s.reference}

        # 1. Decoupling caps -> IC
        pairs.extend(self._find_decoupling_pairs(schematic, net_to_pins, ic_refs, ref_to_symbol))

        # 2. Crystal -> MCU
        pairs.extend(self._find_crystal_pairs(schematic, net_to_pins, ref_to_symbol))

        # 3. Series resistors -> IC
        pairs.extend(self._find_series_resistor_pairs(schematic, net_to_pins, ic_refs, ref_to_symbol))

        # 4. ESD protection -> connector
        pairs.extend(self._find_esd_connector_pairs(schematic, net_to_pins, ref_to_symbol))

        # 5. Feedback divider -> regulator
        pairs.extend(self._find_feedback_pairs(schematic, net_to_pins, ref_to_symbol))

        logger.info("Critical pair analysis: %d pairs identified", len(pairs))
        return pairs

    def identify_thermal_groups(
        self, schematic: SchematicDesign
    ) -> list[ThermalGroup]:
        """Find high-power components that need thermal management.

        Identifies voltage regulators, power MOSFETs, drivers, and other
        components likely to dissipate significant heat.

        Args:
            schematic: Parsed schematic design.

        Returns:
            List of ThermalGroup with estimated power and strategy.
        """
        groups: list[ThermalGroup] = []
        thermal_components: list[tuple[str, float, str]] = []  # (ref, est_power, type)

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue

            lib_lower = symbol.lib_id.lower()
            value_lower = symbol.value.lower()
            prefix = self._ref_prefix(ref)

            est_power = 0.0
            comp_type = ""

            # Voltage regulators
            if any(kw in lib_lower for kw in ("regulator", "ldo", "vreg")):
                est_power = 0.5  # Conservative estimate
                comp_type = "linear_regulator"
            elif any(kw in lib_lower for kw in ("buck", "boost", "converter")):
                est_power = 0.3
                comp_type = "switching_regulator"
            # Power MOSFETs
            elif prefix == "Q" and any(kw in lib_lower for kw in ("mosfet", "fet", "pmos", "nmos")):
                est_power = 1.0
                comp_type = "power_mosfet"
            # Large resistors (power dissipation)
            elif prefix == "R":
                # Check for power resistors by package
                for prop in symbol.properties:
                    if prop.key.lower() == "footprint" and any(
                        pkg in prop.value for pkg in ("2512", "2010", "1206")
                    ):
                        est_power = 0.25
                        comp_type = "power_resistor"
                        break
            # Motor drivers, audio amps, etc.
            elif any(kw in lib_lower for kw in ("driver", "amplifier", "h-bridge")):
                est_power = 0.5
                comp_type = "driver"

            if est_power > 0.1:
                thermal_components.append((ref, est_power, comp_type))

        if not thermal_components:
            return []

        # Group by proximity in estimated power class
        # For now, group all into one thermal group (a more sophisticated
        # approach would cluster by spatial proximity after initial placement)
        total_power = sum(p for _, p, _ in thermal_components)
        refs = [r for r, _, _ in thermal_components]

        notes: list[str] = []
        if total_power > 2.0:
            strategy = "heatsink"
            notes.append("Total power > 2W: consider external heatsink or thermal pad")
        elif total_power > 0.5:
            strategy = "thermal_vias"
            notes.append("Use thermal vias to inner ground plane for heat spreading")
        else:
            strategy = "copper_pour"
            notes.append("Ensure adequate exposed copper area around power components")

        notes.append("Maintain minimum 5mm clearance between high-power components")
        notes.append("Place away from temperature-sensitive analog components")

        groups.append(ThermalGroup(
            components=sorted(refs),
            estimated_power_w=round(total_power, 2),
            strategy=strategy,
            notes=notes,
        ))

        logger.info(
            "Thermal analysis: %d components, %.2fW total estimated dissipation",
            len(refs), total_power,
        )
        return groups

    # ------------------------------------------------------------------
    # Internal classification logic
    # ------------------------------------------------------------------

    def _classify_component(
        self,
        symbol: SchSymbol,
        net_to_refs: dict[str, set[str]],
        ic_refs: set[str],
        schematic: SchematicDesign,
    ) -> str:
        """Determine which zone a component belongs to."""
        ref = symbol.reference
        prefix = self._ref_prefix(ref)
        lib_lower = symbol.lib_id.lower()
        value_lower = symbol.value.lower()

        # 1. Connectors (J, P, TP prefixes or connector keywords)
        if prefix in ("J", "P", "TP"):
            return ZONE_CONNECTORS
        if any(kw in lib_lower for kw in _CONNECTOR_KEYWORDS):
            return ZONE_CONNECTORS

        # 2. Clock components
        if prefix == "Y" or any(kw in lib_lower for kw in _CLOCK_KEYWORDS):
            return ZONE_CLOCK
        if prefix in ("X",) and any(kw in lib_lower for kw in ("crystal", "oscillator")):
            return ZONE_CLOCK

        # 3. RF components
        if any(kw in lib_lower for kw in _RF_KEYWORDS):
            return ZONE_RF

        # 4. Decoupling capacitors: small caps connected to an IC's power net
        if prefix == "C":
            if self._is_decoupling_cap(symbol, net_to_refs, ic_refs, schematic):
                return ZONE_DECOUPLING

        # 5. Power components
        if any(kw in lib_lower for kw in _POWER_KEYWORDS):
            return ZONE_POWER
        if prefix == "L":  # Inductors are usually power
            return ZONE_POWER
        if prefix == "D" and any(kw in lib_lower for kw in ("schottky", "diode_power")):
            return ZONE_POWER
        # Large electrolytic / bulk caps
        if prefix == "C" and self._is_bulk_cap(symbol):
            return ZONE_POWER

        # 6. Analog components
        if any(kw in lib_lower for kw in _ANALOG_KEYWORDS):
            return ZONE_ANALOG

        # 7. Digital: MCU/FPGA and related digital ICs
        if prefix == "U":
            if any(kw in lib_lower for kw in _MCU_FPGA_KEYWORDS):
                return ZONE_DIGITAL
            if any(kw in lib_lower for kw in _ANALOG_KEYWORDS):
                return ZONE_ANALOG
            # Default ICs to digital
            return ZONE_DIGITAL

        # 8. Default classification by prefix
        if prefix in ("R", "C"):
            # Small passives: classify by what they connect to
            connected_zones = self._infer_zone_from_connections(
                symbol, net_to_refs, ic_refs, schematic
            )
            if connected_zones:
                return connected_zones

        # Catch-all: LEDs and misc go to digital
        if prefix in ("D", "LED"):
            return ZONE_DIGITAL

        return ZONE_DIGITAL

    def _is_decoupling_cap(
        self,
        symbol: SchSymbol,
        net_to_refs: dict[str, set[str]],
        ic_refs: set[str],
        schematic: SchematicDesign,
    ) -> bool:
        """Check if a capacitor is a decoupling/bypass cap for an IC.

        A decoupling cap typically:
        - Has value <= 1uF (100nF most common)
        - One pin connects to a power net (VCC, VDD, etc.)
        - The other pin connects to GND
        - Shares a power net with an IC
        """
        value_lower = symbol.value.lower()

        # Check typical decoupling values
        is_small_cap = False
        if any(v in value_lower for v in ("100n", "0.1u", "10n", "1u", "4.7u", "22n", "47n")) or value_lower in ("100nf", "0.1uf", "10nf", "1uf"):
            is_small_cap = True

        if not is_small_cap:
            return False

        # Check if connected to a power net and shares it with an IC
        connected_nets = self._get_connected_nets(symbol, schematic)
        has_power_net = False
        has_ground_net = False
        shares_with_ic = False

        for net_name in connected_nets:
            if _POWER_NET_RE.match(net_name):
                if "gnd" in net_name.lower() or "vss" in net_name.lower():
                    has_ground_net = True
                else:
                    has_power_net = True
                    # Check if an IC also connects to this net
                    refs_on_net = net_to_refs.get(net_name, set())
                    if refs_on_net & ic_refs:
                        shares_with_ic = True

        return has_power_net and has_ground_net and shares_with_ic

    def _is_bulk_cap(self, symbol: SchSymbol) -> bool:
        """Check if a capacitor is a bulk/input/output capacitor (>= 10uF)."""
        value_lower = symbol.value.lower()
        # Match values like "10u", "22u", "47u", "100u", "10uf", "47uf"
        match = re.match(r"(\d+(?:\.\d+)?)\s*u", value_lower)
        if match:
            val = float(match.group(1))
            return val >= 10.0
        return False

    def _infer_zone_from_connections(
        self,
        symbol: SchSymbol,
        net_to_refs: dict[str, set[str]],
        ic_refs: set[str],
        schematic: SchematicDesign,
    ) -> str:
        """For passive components, infer zone from what they connect to."""
        connected_nets = self._get_connected_nets(symbol, schematic)
        for net_name in connected_nets:
            # Power net -> POWER zone
            if _POWER_NET_RE.match(net_name) and "gnd" not in net_name.lower():
                return ZONE_POWER
        return ""

    # ------------------------------------------------------------------
    # Critical pair detection helpers
    # ------------------------------------------------------------------

    def _find_decoupling_pairs(
        self,
        schematic: SchematicDesign,
        net_to_pins: dict[str, list[tuple[str, str]]],
        ic_refs: set[str],
        ref_to_symbol: dict[str, SchSymbol],
    ) -> list[CriticalPair]:
        """Find decoupling cap -> IC pairs."""
        pairs: list[CriticalPair] = []
        net_to_refs = self._build_net_index(schematic)

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref or self._ref_prefix(ref) != "C":
                continue

            # Check if this is a small-value cap
            value_lower = symbol.value.lower()
            is_small = any(v in value_lower for v in (
                "100n", "0.1u", "10n", "1u", "4.7u", "22n", "47n",
            ))
            if not is_small:
                continue

            # Find which IC it decouples
            connected_nets = self._get_connected_nets(symbol, schematic)
            for net_name in connected_nets:
                if _POWER_NET_RE.match(net_name) and "gnd" not in net_name.lower():
                    refs_on_net = net_to_refs.get(net_name, set())
                    for ic_ref in sorted(refs_on_net & ic_refs):
                        pairs.append(CriticalPair(
                            component_a=ref,
                            component_b=ic_ref,
                            max_distance_mm=2.0,
                            reason=(
                                f"Decoupling capacitor {ref} ({symbol.value}) "
                                f"for {ic_ref} power pin on net {net_name}"
                            ),
                            rule_source="IC datasheet / IPC-7351",
                        ))

        return pairs

    def _find_crystal_pairs(
        self,
        schematic: SchematicDesign,
        net_to_pins: dict[str, list[tuple[str, str]]],
        ref_to_symbol: dict[str, SchSymbol],
    ) -> list[CriticalPair]:
        """Find crystal/oscillator -> MCU pairs."""
        pairs: list[CriticalPair] = []

        crystal_refs: list[str] = []
        mcu_refs: list[str] = []

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue
            lib_lower = symbol.lib_id.lower()
            prefix = self._ref_prefix(ref)

            if prefix == "Y" or any(kw in lib_lower for kw in _CLOCK_KEYWORDS):
                crystal_refs.append(ref)
            if any(kw in lib_lower for kw in _MCU_FPGA_KEYWORDS):
                mcu_refs.append(ref)

        # Find crystals connected to MCUs via shared nets
        net_to_refs = self._build_net_index(schematic)
        for crystal_ref in crystal_refs:
            crystal_sym = ref_to_symbol.get(crystal_ref)
            if not crystal_sym:
                continue
            connected_nets = self._get_connected_nets(crystal_sym, schematic)
            for net_name in connected_nets:
                refs_on_net = net_to_refs.get(net_name, set())
                for mcu_ref in mcu_refs:
                    if mcu_ref in refs_on_net:
                        pairs.append(CriticalPair(
                            component_a=crystal_ref,
                            component_b=mcu_ref,
                            max_distance_mm=5.0,
                            reason=(
                                f"Crystal {crystal_ref} must be close to "
                                f"{mcu_ref} clock pins for signal integrity"
                            ),
                            rule_source="IC datasheet / Crystal manufacturer guidelines",
                        ))

        return pairs

    def _find_series_resistor_pairs(
        self,
        schematic: SchematicDesign,
        net_to_pins: dict[str, list[tuple[str, str]]],
        ic_refs: set[str],
        ref_to_symbol: dict[str, SchSymbol],
    ) -> list[CriticalPair]:
        """Find series termination resistors near their IC."""
        pairs: list[CriticalPair] = []
        net_to_refs = self._build_net_index(schematic)

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref or self._ref_prefix(ref) != "R":
                continue

            # Series resistors are small value (22-100 ohm typically)
            value_lower = symbol.value.lower()
            is_series = False
            match = re.match(r"(\d+(?:\.\d+)?)\s*(?:ohm|r)?$", value_lower)
            if match:
                val = float(match.group(1))
                if 10 <= val <= 100:
                    is_series = True
            if not is_series:
                continue

            # Check if it connects between an IC and a signal net
            connected_nets = self._get_connected_nets(symbol, schematic)
            connected_ics = set()
            for net_name in connected_nets:
                if _POWER_NET_RE.match(net_name):
                    continue  # Not a series termination if on power net
                refs_on_net = net_to_refs.get(net_name, set())
                connected_ics.update(refs_on_net & ic_refs)

            for ic_ref in sorted(connected_ics):
                pairs.append(CriticalPair(
                    component_a=ref,
                    component_b=ic_ref,
                    max_distance_mm=3.0,
                    reason=(
                        f"Series resistor {ref} ({symbol.value}) should be "
                        f"close to {ic_ref} for signal termination"
                    ),
                    rule_source="Signal integrity best practice",
                ))

        return pairs

    def _find_esd_connector_pairs(
        self,
        schematic: SchematicDesign,
        net_to_pins: dict[str, list[tuple[str, str]]],
        ref_to_symbol: dict[str, SchSymbol],
    ) -> list[CriticalPair]:
        """Find ESD protection -> connector pairs."""
        pairs: list[CriticalPair] = []
        net_to_refs = self._build_net_index(schematic)

        esd_refs: list[str] = []
        connector_refs: list[str] = []

        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue
            lib_lower = symbol.lib_id.lower()
            prefix = self._ref_prefix(ref)

            if any(kw in lib_lower for kw in ("esd", "tvs", "protection")):
                esd_refs.append(ref)
            if prefix in ("J", "P") or any(kw in lib_lower for kw in _CONNECTOR_KEYWORDS):
                connector_refs.append(ref)

        for esd_ref in esd_refs:
            esd_sym = ref_to_symbol.get(esd_ref)
            if not esd_sym:
                continue
            connected_nets = self._get_connected_nets(esd_sym, schematic)
            for net_name in connected_nets:
                if "gnd" in net_name.lower():
                    continue
                refs_on_net = net_to_refs.get(net_name, set())
                for conn_ref in connector_refs:
                    if conn_ref in refs_on_net:
                        pairs.append(CriticalPair(
                            component_a=esd_ref,
                            component_b=conn_ref,
                            max_distance_mm=3.0,
                            reason=(
                                f"ESD protection {esd_ref} must be between "
                                f"connector {conn_ref} and the rest of the circuit"
                            ),
                            rule_source="IPC-2221B / ESD protection guidelines",
                        ))

        return pairs

    def _find_feedback_pairs(
        self,
        schematic: SchematicDesign,
        net_to_pins: dict[str, list[tuple[str, str]]],
        ref_to_symbol: dict[str, SchSymbol],
    ) -> list[CriticalPair]:
        """Find feedback resistor divider -> regulator pairs."""
        pairs: list[CriticalPair] = []
        net_to_refs = self._build_net_index(schematic)

        regulator_refs: list[str] = []
        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue
            lib_lower = symbol.lib_id.lower()
            if any(kw in lib_lower for kw in ("regulator", "buck", "boost", "converter")):
                regulator_refs.append(ref)

        # Find resistors that share a net named "FB" or "feedback" with a regulator
        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref or self._ref_prefix(ref) != "R":
                continue

            connected_nets = self._get_connected_nets(symbol, schematic)
            for net_name in connected_nets:
                net_lower = net_name.lower()
                if "fb" in net_lower or "feedback" in net_lower:
                    refs_on_net = net_to_refs.get(net_name, set())
                    for reg_ref in regulator_refs:
                        if reg_ref in refs_on_net:
                            pairs.append(CriticalPair(
                                component_a=ref,
                                component_b=reg_ref,
                                max_distance_mm=5.0,
                                reason=(
                                    f"Feedback resistor {ref} for regulator "
                                    f"{reg_ref} on net {net_name}"
                                ),
                                rule_source="Regulator datasheet layout guidelines",
                            ))

        return pairs

    # ------------------------------------------------------------------
    # Utility helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _ref_prefix(ref: str) -> str:
        """Extract the alphabetic prefix from a reference designator."""
        m = _REF_PREFIX_RE.match(ref)
        return m.group(1) if m else ""

    @staticmethod
    def _build_net_index(
        schematic: SchematicDesign,
    ) -> dict[str, set[str]]:
        """Build mapping: net_name -> set of component reference designators."""
        net_to_refs: dict[str, set[str]] = {}
        for net in schematic.nets:
            refs = set()
            for comp_ref, _pin_num in net.pins:
                refs.add(comp_ref)
            net_to_refs[net.name] = refs
        return net_to_refs

    @staticmethod
    def _build_net_pin_index(
        schematic: SchematicDesign,
    ) -> dict[str, list[tuple[str, str]]]:
        """Build mapping: net_name -> list of (component_ref, pin_number)."""
        net_to_pins: dict[str, list[tuple[str, str]]] = {}
        for net in schematic.nets:
            net_to_pins[net.name] = list(net.pins)
        return net_to_pins

    @staticmethod
    def _find_ic_refs(schematic: SchematicDesign) -> set[str]:
        """Find all IC reference designators (U prefix or known IC lib_ids)."""
        ic_refs: set[str] = set()
        for symbol in schematic.symbols:
            ref = symbol.reference
            if not ref:
                continue
            prefix = _REF_PREFIX_RE.match(ref)
            if prefix and prefix.group(1) == "U":
                ic_refs.add(ref)
        return ic_refs

    @staticmethod
    def _get_connected_nets(
        symbol: SchSymbol,
        schematic: SchematicDesign,
    ) -> list[str]:
        """Get all net names connected to a symbol."""
        ref = symbol.reference
        nets: list[str] = []
        for net in schematic.nets:
            for comp_ref, _pin in net.pins:
                if comp_ref == ref:
                    nets.append(net.name)
                    break
        return nets
