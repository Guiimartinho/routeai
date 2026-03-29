"""IR drop analyzer for power distribution networks.

Calculates DC resistance of power planes and traces, computes current
density heatmaps, and identifies components with excessive voltage drop.

References:
    - IPC-2152 for trace resistance
    - Copper resistivity temperature model
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
    Pad,
    StackupLayer,
    Trace,
    TraceSegment,
    Via,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Copper resistivity at 20C in ohm-mm
COPPER_RESISTIVITY_20C = 1.724e-5
# Temperature coefficient (1/K)
COPPER_TEMP_COEFF = 3.93e-3


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ComponentVoltage:
    """Voltage drop analysis for a single component."""

    component_ref: str
    pad_location: tuple[float, float]
    net_name: str
    supply_voltage: float  # V
    voltage_at_component: float  # V
    voltage_drop: float  # V
    drop_percentage: float  # %
    resistance_to_source: float  # ohms
    current_draw: float  # A
    passed: bool = True
    path_description: str = ""


@dataclass
class CurrentDensityPoint:
    """A single point in the current density heatmap."""

    x: float
    y: float
    layer: str
    current_density_a_per_mm2: float
    temperature_rise_c: float


@dataclass
class IRDropReport:
    """Complete IR drop analysis report."""

    component_voltages: list[ComponentVoltage] = field(default_factory=list)
    current_density_heatmap: list[CurrentDensityPoint] = field(default_factory=list)
    total_power_loss_w: float = 0.0
    max_voltage_drop_v: float = 0.0
    max_voltage_drop_pct: float = 0.0
    overall_pass: bool = True
    summary: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _trace_resistance(
    width_mm: float,
    length_mm: float,
    thickness_mm: float = 0.035,
    temperature_c: float = 50.0,
) -> float:
    """Calculate DC resistance of a copper trace.

    R = rho * L / A

    Args:
        width_mm: Trace width in mm.
        length_mm: Trace length in mm.
        thickness_mm: Copper thickness in mm.
        temperature_c: Operating temperature in Celsius.

    Returns:
        Resistance in ohms.
    """
    if width_mm <= 0 or length_mm <= 0 or thickness_mm <= 0:
        return float("inf")

    rho = COPPER_RESISTIVITY_20C * (1.0 + COPPER_TEMP_COEFF * (temperature_c - 20.0))
    area = width_mm * thickness_mm
    return rho * length_mm / area


def _via_resistance(
    drill_mm: float,
    plating_thickness_mm: float = 0.025,
    barrel_length_mm: float = 1.6,
    temperature_c: float = 50.0,
) -> float:
    """Calculate DC resistance of a plated via.

    Models the via as a hollow copper cylinder.

    Args:
        drill_mm: Via drill diameter in mm.
        plating_thickness_mm: Copper plating thickness.
        barrel_length_mm: Board thickness / via length.
        temperature_c: Operating temperature.

    Returns:
        Resistance in ohms.
    """
    if drill_mm <= 0 or plating_thickness_mm <= 0 or barrel_length_mm <= 0:
        return float("inf")

    rho = COPPER_RESISTIVITY_20C * (1.0 + COPPER_TEMP_COEFF * (temperature_c - 20.0))
    r_outer = drill_mm / 2.0
    r_inner = r_outer - plating_thickness_mm
    if r_inner < 0:
        r_inner = 0.0
    area = math.pi * (r_outer**2 - r_inner**2)
    if area <= 0:
        return float("inf")
    return rho * barrel_length_mm / area


def _plane_sheet_resistance(
    thickness_mm: float = 0.035,
    temperature_c: float = 50.0,
) -> float:
    """Calculate the sheet resistance of a copper plane.

    R_sheet = rho / thickness (ohms per square)

    Args:
        thickness_mm: Copper thickness.
        temperature_c: Operating temperature.

    Returns:
        Sheet resistance in ohms/square.
    """
    rho = COPPER_RESISTIVITY_20C * (1.0 + COPPER_TEMP_COEFF * (temperature_c - 20.0))
    if thickness_mm <= 0:
        return float("inf")
    return rho / thickness_mm


# ---------------------------------------------------------------------------
# IR Drop Analyzer
# ---------------------------------------------------------------------------

class IRDropAnalyzer:
    """DC IR drop analysis for power distribution networks.

    Traces the power delivery path from the supply source to each
    component, computing the cumulative resistance and resulting
    voltage drop.

    Args:
        max_drop_pct: Maximum acceptable voltage drop percentage.
        operating_temp_c: Operating temperature for resistance calculations.
        copper_thickness_mm: Default copper thickness.
        via_plating_mm: Default via plating thickness.
    """

    def __init__(
        self,
        max_drop_pct: float = 3.0,
        operating_temp_c: float = 50.0,
        copper_thickness_mm: float = 0.035,
        via_plating_mm: float = 0.025,
    ) -> None:
        self.max_drop_pct = max_drop_pct
        self.operating_temp_c = operating_temp_c
        self.copper_thickness_mm = copper_thickness_mm
        self.via_plating_mm = via_plating_mm

    def _estimate_path_resistance(
        self,
        board: BoardDesign,
        net: Net,
        source_pos: tuple[float, float],
        sink_pos: tuple[float, float],
        stackup: list[StackupLayer],
    ) -> tuple[float, str]:
        """Estimate the resistance from source to sink along a power net.

        Uses a simplified path model: finds traces and vias connecting
        the two points on the power net and sums their resistances.

        Returns:
            (total_resistance_ohms, path_description)
        """
        traces = board.traces_in_net(net)
        vias = board.vias_in_net(net)
        zones = [z for z in board.zones if z.net == net]

        total_r = 0.0
        path_parts: list[str] = []

        # Simple heuristic: find trace segments near the source and sink,
        # and sum resistances along the shortest path.
        # For a more accurate analysis, we would build a resistance mesh.

        # Step 1: Sum trace resistances on this net
        # Weight by proximity to the source-sink path
        sx, sy = source_pos
        ex, ey = sink_pos
        direct_dist = math.sqrt((ex - sx)**2 + (ey - sy)**2)

        if direct_dist < 0.01:
            return 0.0, "co-located"

        # Find traces that are relevant to the path
        relevant_trace_r = 0.0
        trace_count = 0

        for trace in traces:
            # Get copper thickness for this layer
            cu_thick = self.copper_thickness_mm
            for sl in stackup:
                if sl.layer == trace.layer or sl.layer.name == trace.layer.name:
                    cu_thick = sl.thickness_mm
                    break

            for seg in trace.segments:
                # Check if this segment is "between" source and sink
                mid_x = (seg.start_x + seg.end_x) / 2.0
                mid_y = (seg.start_y + seg.end_y) / 2.0

                dist_to_source = math.sqrt((mid_x - sx)**2 + (mid_y - sy)**2)
                dist_to_sink = math.sqrt((mid_x - ex)**2 + (mid_y - ey)**2)

                # Include if segment is roughly on the path
                if dist_to_source + dist_to_sink < direct_dist * 1.5 + 5.0:
                    seg_r = _trace_resistance(
                        seg.width, seg.length, cu_thick, self.operating_temp_c
                    )
                    relevant_trace_r += seg_r
                    trace_count += 1

        if trace_count > 0:
            total_r += relevant_trace_r
            path_parts.append(
                f"{trace_count} trace segments (R={relevant_trace_r * 1e3:.2f}mOhm)"
            )

        # Step 2: Add via resistances along the path
        # Estimate board thickness from stackup
        board_thickness = sum(sl.thickness_mm for sl in stackup)
        if board_thickness <= 0:
            board_thickness = 1.6

        via_r_total = 0.0
        via_count = 0
        for via in vias:
            dist_to_source = math.sqrt((via.x - sx)**2 + (via.y - sy)**2)
            dist_to_sink = math.sqrt((via.x - ex)**2 + (via.y - ey)**2)

            if dist_to_source + dist_to_sink < direct_dist * 1.5 + 5.0:
                v_r = _via_resistance(
                    via.drill, self.via_plating_mm, board_thickness,
                    self.operating_temp_c,
                )
                via_r_total += v_r
                via_count += 1

        # Vias in parallel reduce effective resistance
        if via_count > 1:
            via_r_total = via_r_total / (via_count * via_count)
            path_parts.append(
                f"{via_count} vias in parallel (R={via_r_total * 1e3:.2f}mOhm)"
            )
        elif via_count == 1:
            total_r += via_r_total
            path_parts.append(f"1 via (R={via_r_total * 1e3:.2f}mOhm)")

        if via_count > 1:
            total_r += via_r_total

        # Step 3: If zones are present, add plane resistance estimate
        if zones and not traces:
            # Power plane: use sheet resistance model
            r_sheet = _plane_sheet_resistance(self.copper_thickness_mm, self.operating_temp_c)
            # Approximate number of squares from source to sink
            # For a large plane, effective squares ~ distance / width_of_current_spread
            # Rough estimate: sqrt(distance) squares
            n_squares = math.sqrt(direct_dist) if direct_dist > 1 else 1.0
            plane_r = r_sheet * n_squares
            total_r += plane_r
            path_parts.append(
                f"Plane ({n_squares:.1f} squares, R={plane_r * 1e3:.2f}mOhm)"
            )

        # If no path found, estimate from direct distance assuming narrow trace
        if total_r == 0 and direct_dist > 0:
            # Worst case: thin trace the whole way
            total_r = _trace_resistance(
                0.25, direct_dist, self.copper_thickness_mm, self.operating_temp_c
            )
            path_parts.append(
                f"Estimated (direct {direct_dist:.1f}mm, R={total_r * 1e3:.2f}mOhm)"
            )

        path_desc = " -> ".join(path_parts) if path_parts else "unknown path"
        return total_r, path_desc

    def _compute_current_density_heatmap(
        self,
        board: BoardDesign,
        net: Net,
        total_current: float,
        stackup: list[StackupLayer],
    ) -> list[CurrentDensityPoint]:
        """Compute current density at sample points along power traces/planes."""
        points: list[CurrentDensityPoint] = []

        traces = board.traces_in_net(net)
        for trace in traces:
            cu_thick = self.copper_thickness_mm
            for sl in stackup:
                if sl.layer == trace.layer or sl.layer.name == trace.layer.name:
                    cu_thick = sl.thickness_mm
                    break

            for seg in trace.segments:
                # Sample points along the segment
                n_samples = max(1, int(seg.length / 1.0))
                for k in range(n_samples):
                    frac = (k + 0.5) / n_samples
                    px = seg.start_x + (seg.end_x - seg.start_x) * frac
                    py = seg.start_y + (seg.end_y - seg.start_y) * frac

                    # Cross-sectional area
                    area = seg.width * cu_thick
                    if area > 0:
                        j = total_current / area  # A/mm^2
                    else:
                        j = 0.0

                    # Temperature rise estimate (simplified)
                    # P = I^2 * R per unit length
                    rho = COPPER_RESISTIVITY_20C * (
                        1.0 + COPPER_TEMP_COEFF * (self.operating_temp_c - 20.0)
                    )
                    r_per_mm = rho / area if area > 0 else 0.0
                    power_per_mm = total_current**2 * r_per_mm
                    # Rough temp rise assuming convection h ~ 10 W/(m^2*K)
                    # and trace top surface area = width * 1mm
                    surface_area_m2 = seg.width * 1e-3 * 1e-3  # 1mm length
                    if surface_area_m2 > 0:
                        temp_rise = power_per_mm * 1e-3 / (10.0 * surface_area_m2)
                    else:
                        temp_rise = 0.0

                    points.append(CurrentDensityPoint(
                        x=px,
                        y=py,
                        layer=trace.layer.name,
                        current_density_a_per_mm2=j,
                        temperature_rise_c=temp_rise,
                    ))

        return points

    def analyze(
        self,
        board: BoardDesign,
        power_nets: Optional[dict[str, dict]] = None,
        current_map: Optional[dict[str, float]] = None,
    ) -> IRDropReport:
        """Run IR drop analysis.

        Args:
            board: Board design to analyze.
            power_nets: Dict mapping power net names to specs:
                {"VCC_3V3": {"voltage": 3.3, "source_pos": (10, 10)}}
            current_map: Dict mapping component reference to current draw (A):
                {"U1": 0.5, "U2": 0.3}
                If None, estimates 0.1A per connected component.

        Returns:
            IRDropReport with per-component voltage drops and heatmap.
        """
        stackup = board.stackup
        report = IRDropReport()

        if power_nets is None:
            # Auto-detect
            power_nets = {}
            for net in board.nets:
                name_lower = net.name.lower()
                if any(kw in name_lower for kw in ("vcc", "vdd", "+3v", "+5v")):
                    voltage = 3.3
                    if "5v" in name_lower:
                        voltage = 5.0
                    elif "1v8" in name_lower or "1.8" in name_lower:
                        voltage = 1.8
                    elif "1v2" in name_lower or "1.2" in name_lower:
                        voltage = 1.2
                    power_nets[net.name] = {"voltage": voltage}

        if current_map is None:
            current_map = {}

        total_power_loss = 0.0
        max_drop = 0.0
        max_drop_pct = 0.0

        for net_name, specs in power_nets.items():
            voltage = specs.get("voltage", 3.3)
            source_pos = specs.get("source_pos", None)

            net = board.get_net(net_name)
            if net is None:
                continue

            # Find source position (regulator output pad)
            if source_pos is None:
                # Use the first pad on this net as the source
                pads = board.pads_in_net(net)
                if pads:
                    source_pos = (pads[0].x, pads[0].y)
                else:
                    continue

            # Analyze voltage drop to each component pad
            pads = board.pads_in_net(net)
            net_total_current = 0.0

            for pad in pads:
                if (pad.x, pad.y) == source_pos:
                    continue  # Skip the source pad

                ref = pad.component_ref or f"pad@({pad.x:.1f},{pad.y:.1f})"
                current = current_map.get(ref, 0.1)  # default 100mA
                net_total_current += current

                path_r, path_desc = self._estimate_path_resistance(
                    board, net, source_pos, (pad.x, pad.y), stackup
                )

                v_drop = current * path_r
                v_at_component = voltage - v_drop
                drop_pct = (v_drop / voltage * 100.0) if voltage > 0 else 0.0
                passed = drop_pct <= self.max_drop_pct

                power_loss = current**2 * path_r
                total_power_loss += power_loss

                max_drop = max(max_drop, v_drop)
                max_drop_pct = max(max_drop_pct, drop_pct)

                report.component_voltages.append(ComponentVoltage(
                    component_ref=ref,
                    pad_location=(pad.x, pad.y),
                    net_name=net_name,
                    supply_voltage=voltage,
                    voltage_at_component=v_at_component,
                    voltage_drop=v_drop,
                    drop_percentage=drop_pct,
                    resistance_to_source=path_r,
                    current_draw=current,
                    passed=passed,
                    path_description=path_desc,
                ))

            # Current density heatmap
            if net_total_current > 0:
                heatmap = self._compute_current_density_heatmap(
                    board, net, net_total_current, stackup
                )
                report.current_density_heatmap.extend(heatmap)

        report.total_power_loss_w = total_power_loss
        report.max_voltage_drop_v = max_drop
        report.max_voltage_drop_pct = max_drop_pct
        report.overall_pass = all(cv.passed for cv in report.component_voltages)

        failed_count = sum(1 for cv in report.component_voltages if not cv.passed)
        report.summary = (
            f"IR drop analysis: {len(report.component_voltages)} component connections. "
            f"Max drop: {max_drop * 1e3:.1f}mV ({max_drop_pct:.2f}%). "
            f"Total power loss: {total_power_loss * 1e3:.1f}mW. "
            f"{'PASS' if report.overall_pass else 'FAIL'}: "
            f"{failed_count} connections exceed {self.max_drop_pct}% threshold."
        )

        return report
