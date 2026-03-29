"""Power Distribution Network (PDN) impedance analyzer.

Calculates target impedance from IC current requirements, models AC
impedance of the power distribution network, analyzes decoupling
capacitor effectiveness, and generates frequency-domain impedance plots.

References:
    - Larry Smith, "Decoupling Capacitor Calculations for CMOS Circuits"
    - Istvan Novak, "Frequency-Domain Characterization of PDNs"
    - IPC-2141A for plane capacitance estimation
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    LayerType,
    Net,
    StackupLayer,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VACUUM_PERMITTIVITY = 8.854e-12  # F/m
COPPER_RESISTIVITY = 1.724e-8  # ohm-m

# Standard MLCC capacitor series (typical values available)
STANDARD_CAPS = [
    100e-12, 220e-12, 470e-12,
    1e-9, 2.2e-9, 4.7e-9, 10e-9, 22e-9, 47e-9,
    100e-9, 220e-9, 470e-9,
    1e-6, 2.2e-6, 4.7e-6, 10e-6, 22e-6, 47e-6, 100e-6,
]

# Typical ESR and ESL for MLCC packages
MLCC_PARASITICS: dict[str, tuple[float, float]] = {
    # package: (ESR_ohms, ESL_nH)
    "0201": (0.05, 0.3),
    "0402": (0.03, 0.5),
    "0603": (0.02, 0.7),
    "0805": (0.015, 0.9),
    "1206": (0.010, 1.1),
    "1210": (0.008, 1.2),
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class TargetImpedance:
    """Target impedance calculation for a power rail."""

    rail_name: str
    voltage: float  # V
    max_current: float  # A
    max_ripple_pct: float  # % (typically 2-5%)
    target_z_ohms: float  # target impedance in ohms
    max_frequency_hz: float  # highest frequency to meet target


@dataclass
class DecapModel:
    """Model of a decoupling capacitor with parasitics."""

    capacitance: float  # F
    esr: float  # ohm (Equivalent Series Resistance)
    esl: float  # H (Equivalent Series Inductance)
    package: str = "0402"
    quantity: int = 1

    @property
    def resonant_frequency(self) -> float:
        """Series resonant frequency in Hz."""
        if self.capacitance > 0 and self.esl > 0:
            return 1.0 / (2.0 * math.pi * math.sqrt(self.esl * self.capacitance))
        return 0.0

    def impedance_at(self, freq_hz: float) -> complex:
        """Complex impedance at a given frequency."""
        if freq_hz <= 0:
            return complex(self.esr, 0)
        omega = 2.0 * math.pi * freq_hz
        z_c = -1.0 / (omega * self.capacitance) if self.capacitance > 0 else -1e12
        z_l = omega * self.esl
        return complex(self.esr, z_l + z_c)

    def impedance_magnitude_at(self, freq_hz: float) -> float:
        """Impedance magnitude at a given frequency."""
        return abs(self.impedance_at(freq_hz))


@dataclass
class DecapSuggestion:
    """Suggested decoupling capacitor placement."""

    capacitance: float  # F
    package: str
    quantity: int
    target_frequency_range: tuple[float, float]  # Hz (low, high)
    placement_hint: str  # "near_ic", "distributed", "bulk"
    estimated_position: Optional[tuple[float, float]] = None
    reason: str = ""


@dataclass
class ImpedancePlotPoint:
    """A single point in the frequency-domain impedance plot."""

    frequency_hz: float
    impedance_ohms: float  # magnitude
    phase_degrees: float
    target_z_ohms: float
    within_target: bool


@dataclass
class PDNReport:
    """Complete PDN analysis report."""

    target_impedances: list[TargetImpedance] = field(default_factory=list)
    decap_suggestions: list[DecapSuggestion] = field(default_factory=list)
    impedance_plot: list[ImpedancePlotPoint] = field(default_factory=list)
    plane_capacitance_pf: float = 0.0
    overall_pass: bool = True
    summary: str = ""
    frequency_violations: list[tuple[float, float, float]] = field(default_factory=list)
    # (frequency_hz, actual_z, target_z)


# ---------------------------------------------------------------------------
# PDN Analyzer
# ---------------------------------------------------------------------------

class PDNAnalyzer:
    """Analyzes the power distribution network impedance.

    Computes target impedance from IC requirements, models the PDN
    including plane capacitance and decoupling capacitors, and
    identifies frequency ranges where the target is not met.

    Args:
        frequency_points: Number of frequency points for the sweep.
        min_freq_hz: Minimum frequency for analysis.
        max_freq_hz: Maximum frequency for analysis.
    """

    def __init__(
        self,
        frequency_points: int = 200,
        min_freq_hz: float = 1e3,
        max_freq_hz: float = 5e9,
    ) -> None:
        self.frequency_points = frequency_points
        self.min_freq_hz = min_freq_hz
        self.max_freq_hz = max_freq_hz

    @staticmethod
    def calculate_target_impedance(
        voltage: float,
        max_current: float,
        ripple_pct: float = 5.0,
    ) -> float:
        """Calculate target impedance for a power rail.

        Z_target = V * ripple_pct / (100 * I_max)

        This is the maximum PDN impedance allowable at any frequency
        to keep voltage ripple within spec.

        Args:
            voltage: Rail voltage in volts.
            max_current: Maximum transient current in amps.
            ripple_pct: Maximum allowed voltage ripple percentage.

        Returns:
            Target impedance in ohms.
        """
        if max_current <= 0:
            return float("inf")
        return voltage * (ripple_pct / 100.0) / max_current

    def _calculate_plane_capacitance(
        self,
        stackup: list[StackupLayer],
        board: BoardDesign,
        power_net: str,
        ground_net: str,
    ) -> float:
        """Calculate the interplane capacitance between power and ground planes.

        C_plane = er * e0 * A / d

        where A is the overlap area and d is the dielectric thickness.
        """
        # Find power and ground plane layers
        power_layers: list[int] = []
        ground_layers: list[int] = []

        for i, sl in enumerate(stackup):
            if sl.layer.layer_type != LayerType.COPPER:
                continue
            layer_zones = [
                z for z in board.zones
                if (z.layer == sl.layer or z.layer.name == sl.layer.name)
            ]
            for zone in layer_zones:
                if zone.net.name == power_net:
                    power_layers.append(i)
                elif zone.net.name == ground_net:
                    ground_layers.append(i)

        total_capacitance = 0.0

        # For each adjacent power/ground pair, calculate capacitance
        for pi in power_layers:
            for gi in ground_layers:
                if abs(pi - gi) > 2:
                    continue  # Only consider adjacent or near-adjacent

                # Find the dielectric between them
                lo, hi = min(pi, gi), max(pi, gi)
                dielectric_thickness = 0.0
                er = 4.3  # default FR4

                for k in range(lo + 1, hi):
                    if stackup[k].layer.layer_type == LayerType.DIELECTRIC:
                        dielectric_thickness += stackup[k].thickness_mm
                        er = stackup[k].dielectric_constant

                if dielectric_thickness <= 0:
                    continue

                # Estimate overlap area from zone polygons
                power_zones = [
                    z for z in board.zones
                    if (z.layer == stackup[pi].layer or z.layer.name == stackup[pi].layer.name)
                    and z.net.name == power_net
                ]
                ground_zones = [
                    z for z in board.zones
                    if (z.layer == stackup[gi].layer or z.layer.name == stackup[gi].layer.name)
                    and z.net.name == ground_net
                ]

                if not power_zones or not ground_zones:
                    # Estimate from board outline
                    if board.outline is not None:
                        overlap_area_mm2 = board.outline.area * 0.7  # 70% fill estimate
                    else:
                        overlap_area_mm2 = 50.0 * 50.0 * 0.7  # default estimate
                else:
                    from shapely.ops import unary_union
                    power_poly = unary_union([z.to_shapely() for z in power_zones])
                    ground_poly = unary_union([z.to_shapely() for z in ground_zones])
                    overlap = power_poly.intersection(ground_poly)
                    overlap_area_mm2 = overlap.area if not overlap.is_empty else 0.0

                # C = er * e0 * A / d  (convert mm to m)
                area_m2 = overlap_area_mm2 * 1e-6
                thickness_m = dielectric_thickness * 1e-3
                capacitance = er * VACUUM_PERMITTIVITY * area_m2 / thickness_m
                total_capacitance += capacitance

        return total_capacitance * 1e12  # return in pF

    def _model_pdn_impedance(
        self,
        plane_capacitance_pf: float,
        decaps: list[DecapModel],
        target_z: float,
        vrm_output_impedance: float = 0.001,
        vrm_bandwidth_hz: float = 100e3,
        plane_esr: float = 0.005,
        plane_esl_nh: float = 0.05,
    ) -> list[ImpedancePlotPoint]:
        """Model the total PDN impedance across frequency.

        The PDN model includes:
        1. VRM output impedance (low frequency)
        2. Bulk capacitors (mid-low frequency)
        3. MLCC decaps (mid-high frequency)
        4. Plane capacitance (high frequency)

        These are modeled as parallel impedances.
        """
        plot: list[ImpedancePlotPoint] = []

        # Generate logarithmic frequency sweep
        log_min = math.log10(self.min_freq_hz)
        log_max = math.log10(self.max_freq_hz)
        frequencies = [
            10 ** (log_min + (log_max - log_min) * i / (self.frequency_points - 1))
            for i in range(self.frequency_points)
        ]

        for freq in frequencies:
            omega = 2.0 * math.pi * freq

            # VRM impedance (increases with frequency above bandwidth)
            if freq < vrm_bandwidth_hz:
                z_vrm = complex(vrm_output_impedance, 0)
            else:
                # VRM output impedance rises above its bandwidth
                z_vrm = complex(
                    vrm_output_impedance * (freq / vrm_bandwidth_hz),
                    vrm_output_impedance * (freq / vrm_bandwidth_hz),
                )

            # Plane capacitance impedance
            c_plane = plane_capacitance_pf * 1e-12
            if c_plane > 0:
                z_plane_c = -1.0 / (omega * c_plane)
                z_plane_l = omega * (plane_esl_nh * 1e-9)
                z_plane = complex(plane_esr, z_plane_l + z_plane_c)
            else:
                z_plane = complex(1e6, 0)

            # Decap impedances (each decap is in parallel)
            # Start with 1/Z_total = 1/Z_vrm + 1/Z_plane
            y_total = (1.0 / z_vrm if abs(z_vrm) > 0 else 0) + (
                1.0 / z_plane if abs(z_plane) > 0 else 0
            )

            for decap in decaps:
                z_decap = decap.impedance_at(freq)
                if abs(z_decap) > 0:
                    # Multiple decaps of same type in parallel
                    y_total += decap.quantity / z_decap

            if abs(y_total) > 0:
                z_total = 1.0 / y_total
            else:
                z_total = complex(1e6, 0)

            magnitude = abs(z_total)
            phase = math.degrees(math.atan2(z_total.imag, z_total.real))

            plot.append(ImpedancePlotPoint(
                frequency_hz=freq,
                impedance_ohms=magnitude,
                phase_degrees=phase,
                target_z_ohms=target_z,
                within_target=magnitude <= target_z,
            ))

        return plot

    def _suggest_decaps(
        self,
        target_z: float,
        max_freq_hz: float,
        plane_cap_pf: float,
        existing_decaps: list[DecapModel],
        ic_positions: list[tuple[float, float]],
    ) -> list[DecapSuggestion]:
        """Suggest optimal decoupling capacitor values and placements.

        Uses a multi-tier approach:
        1. Bulk capacitors for low-frequency decoupling (<1 MHz)
        2. Mid-range MLCC for medium frequencies (1-100 MHz)
        3. Small MLCC for high frequencies (>100 MHz)
        4. Plane capacitance covers the highest frequencies
        """
        suggestions: list[DecapSuggestion] = []

        # Determine what frequency ranges need additional decoupling
        # by simulating current decaps and finding violations
        test_plot = self._model_pdn_impedance(
            plane_cap_pf, existing_decaps, target_z
        )

        # Find frequency ranges that violate the target
        violation_ranges: list[tuple[float, float]] = []
        in_violation = False
        violation_start = 0.0

        for point in test_plot:
            if not point.within_target and not in_violation:
                in_violation = True
                violation_start = point.frequency_hz
            elif point.within_target and in_violation:
                in_violation = False
                violation_ranges.append((violation_start, point.frequency_hz))

        if in_violation:
            violation_ranges.append((violation_start, max_freq_hz))

        # For each violation range, suggest appropriate decaps
        for f_low, f_high in violation_ranges:
            f_center = math.sqrt(f_low * f_high)  # geometric mean

            # Find the capacitor value whose SRF is near f_center
            # SRF = 1 / (2*pi*sqrt(L*C))
            # For a target SRF, C = 1 / ((2*pi*SRF)^2 * L)
            target_srf = f_center

            if f_center < 1e6:
                # Low frequency: bulk capacitor
                package = "1210"
                esr, esl_nh = MLCC_PARASITICS["1210"]
                esl = esl_nh * 1e-9
                c_ideal = 1.0 / ((2.0 * math.pi * target_srf) ** 2 * esl)
                # Round to nearest standard value
                c_val = min(STANDARD_CAPS, key=lambda x: abs(x - c_ideal))
                qty = max(1, int(target_z / (esr / 2) + 0.5))
                qty = min(qty, 10)

                suggestions.append(DecapSuggestion(
                    capacitance=c_val,
                    package=package,
                    quantity=qty,
                    target_frequency_range=(f_low, f_high),
                    placement_hint="bulk",
                    reason=(
                        f"Bulk decoupling for {f_low / 1e3:.0f}kHz-"
                        f"{f_high / 1e3:.0f}kHz range. "
                        f"{qty}x {_format_capacitance(c_val)} {package}"
                    ),
                ))

            elif f_center < 100e6:
                # Mid frequency: standard MLCC
                package = "0402"
                esr, esl_nh = MLCC_PARASITICS["0402"]
                esl = esl_nh * 1e-9
                c_ideal = 1.0 / ((2.0 * math.pi * target_srf) ** 2 * esl)
                c_val = min(STANDARD_CAPS, key=lambda x: abs(x - c_ideal))
                # Need enough in parallel to bring impedance below target
                z_single_at_srf = esr  # at resonance, impedance = ESR
                qty = max(1, math.ceil(z_single_at_srf / target_z))
                qty = min(qty, 20)

                est_pos = ic_positions[0] if ic_positions else None
                suggestions.append(DecapSuggestion(
                    capacitance=c_val,
                    package=package,
                    quantity=qty,
                    target_frequency_range=(f_low, f_high),
                    placement_hint="near_ic",
                    estimated_position=est_pos,
                    reason=(
                        f"Mid-frequency decoupling for "
                        f"{f_low / 1e6:.1f}MHz-{f_high / 1e6:.1f}MHz. "
                        f"{qty}x {_format_capacitance(c_val)} {package}. "
                        f"Place within 2mm of IC power pins."
                    ),
                ))

            else:
                # High frequency: small MLCC
                package = "0201"
                esr, esl_nh = MLCC_PARASITICS["0201"]
                esl = esl_nh * 1e-9
                c_ideal = 1.0 / ((2.0 * math.pi * target_srf) ** 2 * esl)
                c_val = min(STANDARD_CAPS, key=lambda x: abs(x - c_ideal))
                z_single_at_srf = esr
                qty = max(1, math.ceil(z_single_at_srf / target_z))
                qty = min(qty, 30)

                est_pos = ic_positions[0] if ic_positions else None
                suggestions.append(DecapSuggestion(
                    capacitance=c_val,
                    package=package,
                    quantity=qty,
                    target_frequency_range=(f_low, f_high),
                    placement_hint="near_ic",
                    estimated_position=est_pos,
                    reason=(
                        f"High-frequency decoupling for "
                        f"{f_low / 1e6:.0f}MHz-{f_high / 1e6:.0f}MHz. "
                        f"{qty}x {_format_capacitance(c_val)} {package}. "
                        f"Place directly at IC power pins with shortest "
                        f"possible via connection."
                    ),
                ))

        # Always suggest a standard decoupling scheme if no existing decaps
        if not existing_decaps and not suggestions:
            suggestions.append(DecapSuggestion(
                capacitance=100e-9,
                package="0402",
                quantity=4,
                target_frequency_range=(1e6, 100e6),
                placement_hint="near_ic",
                reason="Standard 100nF decoupling per IC power pin pair",
            ))
            suggestions.append(DecapSuggestion(
                capacitance=10e-6,
                package="0805",
                quantity=2,
                target_frequency_range=(10e3, 1e6),
                placement_hint="distributed",
                reason="Bulk 10uF decoupling for low-frequency supply stability",
            ))

        return suggestions

    def analyze(
        self,
        board: BoardDesign,
        stackup: Optional[list[StackupLayer]] = None,
        power_nets: Optional[dict[str, dict]] = None,
    ) -> PDNReport:
        """Run PDN impedance analysis.

        Args:
            board: Board design to analyze.
            stackup: Stackup layers. Uses board.stackup if None.
            power_nets: Dict mapping power net names to their specs:
                {
                    "VCC_3V3": {
                        "voltage": 3.3,
                        "max_current": 2.0,
                        "ripple_pct": 3.0,
                        "ground_net": "GND",
                    }
                }
                If None, attempts to auto-detect power nets.

        Returns:
            PDNReport with impedance analysis, plots, and suggestions.
        """
        if stackup is None:
            stackup = board.stackup

        report = PDNReport()

        # Auto-detect power nets if not provided
        if power_nets is None:
            power_nets = {}
            for net in board.nets:
                name_lower = net.name.lower()
                if any(kw in name_lower for kw in ("vcc", "vdd", "+3v", "+5v", "+1v", "+12v", "+2v")):
                    # Guess voltage from name
                    voltage = 3.3
                    if "5v" in name_lower or "5.0" in name_lower:
                        voltage = 5.0
                    elif "1v8" in name_lower or "1.8" in name_lower:
                        voltage = 1.8
                    elif "1v2" in name_lower or "1.2" in name_lower:
                        voltage = 1.2
                    elif "12v" in name_lower:
                        voltage = 12.0
                    elif "2v5" in name_lower or "2.5" in name_lower:
                        voltage = 2.5

                    power_nets[net.name] = {
                        "voltage": voltage,
                        "max_current": 1.0,
                        "ripple_pct": 5.0,
                        "ground_net": "GND",
                    }

        for rail_name, specs in power_nets.items():
            voltage = specs.get("voltage", 3.3)
            max_current = specs.get("max_current", 1.0)
            ripple_pct = specs.get("ripple_pct", 5.0)
            ground_net = specs.get("ground_net", "GND")

            # Calculate target impedance
            target_z = self.calculate_target_impedance(voltage, max_current, ripple_pct)

            # Estimate the highest frequency of concern
            # Rule of thumb: 5th harmonic of clock, or 1/pi/rise_time
            max_freq = min(self.max_freq_hz, 1e9)  # default cap at 1GHz

            target = TargetImpedance(
                rail_name=rail_name,
                voltage=voltage,
                max_current=max_current,
                max_ripple_pct=ripple_pct,
                target_z_ohms=target_z,
                max_frequency_hz=max_freq,
            )
            report.target_impedances.append(target)

            # Calculate plane capacitance
            plane_cap = self._calculate_plane_capacitance(
                stackup, board, rail_name, ground_net
            )
            report.plane_capacitance_pf += plane_cap

            # Find IC positions (pads connected to power net) for placement hints
            power_pads = board.pads_in_net(
                board.get_net(rail_name) or Net(name=rail_name)
            )
            ic_positions = [(p.x, p.y) for p in power_pads[:5]]

            # Suggest decaps
            suggestions = self._suggest_decaps(
                target_z, max_freq, plane_cap, [], ic_positions
            )
            report.decap_suggestions.extend(suggestions)

            # Build impedance plot with suggested decaps
            decap_models = [
                DecapModel(
                    capacitance=s.capacitance,
                    esr=MLCC_PARASITICS.get(s.package, (0.02, 0.7))[0],
                    esl=MLCC_PARASITICS.get(s.package, (0.02, 0.7))[1] * 1e-9,
                    package=s.package,
                    quantity=s.quantity,
                )
                for s in suggestions
            ]

            plot = self._model_pdn_impedance(plane_cap, decap_models, target_z)
            report.impedance_plot.extend(plot)

            # Check for violations
            for point in plot:
                if not point.within_target:
                    report.frequency_violations.append((
                        point.frequency_hz,
                        point.impedance_ohms,
                        point.target_z_ohms,
                    ))

        report.overall_pass = len(report.frequency_violations) == 0

        total_rails = len(report.target_impedances)
        total_violations = len(report.frequency_violations)
        report.summary = (
            f"PDN analysis for {total_rails} power rail(s). "
            f"Plane capacitance: {report.plane_capacitance_pf:.1f}pF. "
            f"{len(report.decap_suggestions)} decap suggestions. "
            f"{'PASS' if report.overall_pass else 'FAIL'}: "
            f"{total_violations} frequency points exceed target impedance."
        )

        return report


def _format_capacitance(value: float) -> str:
    """Format a capacitance value to a human-readable string."""
    if value >= 1e-6:
        return f"{value * 1e6:.1f}uF"
    elif value >= 1e-9:
        return f"{value * 1e9:.0f}nF"
    elif value >= 1e-12:
        return f"{value * 1e12:.0f}pF"
    else:
        return f"{value:.2e}F"
