"""Thermal analysis for PCB traces and vias per IPC-2152.

Calculates current-carrying capacity of traces and vias based on
acceptable temperature rise, and thermal resistance of copper features.

References:
    - IPC-2152: Standard for Determining Current Carrying Capacity in
      Printed Board Design (2009)
    - IPC-2221B, Section 6.2 (older, superseded by IPC-2152)
    - Adam, J. "New Correlations Between Electrical Current and Temperature
      Rise in PCB Traces", 20th IEEE SEMI-THERM, 2004
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from routeai_solver.board_model import BoardDesign, Net, Trace
from routeai_solver.drc.engine import DRCSeverity, DRCViolation


# ---------------------------------------------------------------------------
# Physical constants
# ---------------------------------------------------------------------------

# Copper resistivity at 20C (ohm-mm)
COPPER_RESISTIVITY_20C = 1.724e-5  # ohm-mm (= 1.724e-8 ohm-m * 1e3 mm/m)

# Temperature coefficient of resistivity for copper (1/K)
COPPER_TEMP_COEFF = 3.93e-3

# Copper thermal conductivity (W/(mm*K))
COPPER_THERMAL_CONDUCTIVITY = 0.385  # W/(mm*K) = 385 W/(m*K) * 1e-3

# Stefan-Boltzmann constant: not directly needed for IPC-2152 empirical model


# ---------------------------------------------------------------------------
# IPC-2152 current capacity
# ---------------------------------------------------------------------------

def trace_current_capacity(
    width: float,
    thickness: float = 0.035,
    temp_rise: float = 10.0,
    ambient: float = 25.0,
    internal: bool = False,
) -> float:
    """Calculate maximum current-carrying capacity of a PCB trace.

    Uses the IPC-2152 empirical model. IPC-2152 replaced the older IPC-2221
    charts with data from extensive testing. The model accounts for
    trace cross-section area and acceptable temperature rise.

    The empirical formula (curve fit to IPC-2152 data):
        I = k * dT^b * A^c

    where:
        I = current (amps)
        k = empirical constant (differs for external vs internal layers)
        dT = temperature rise above ambient (Celsius)
        A = cross-sectional area of trace (mil^2)
        b, c = empirical exponents

    For external (outer) layers: k=0.048, b=0.44, c=0.725
    For internal layers: k=0.024, b=0.44, c=0.725
    (IPC-2152 internal traces have ~half the capacity due to reduced convection)

    Args:
        width: Trace width (mm).
        thickness: Copper thickness (mm). Default 1oz copper = 0.035mm.
        temp_rise: Maximum acceptable temperature rise in Celsius.
        ambient: Ambient temperature in Celsius.
        internal: True for internal layer traces, False for external.

    Returns:
        Maximum current in amps.
    """
    if width <= 0 or thickness <= 0 or temp_rise <= 0:
        return 0.0

    # Convert cross-sectional area to mil^2 (IPC-2152 uses mil^2)
    area_mm2 = width * thickness  # mm^2
    area_mil2 = area_mm2 / (0.0254 ** 2)  # 1 mil = 0.0254 mm

    # IPC-2152 empirical coefficients (curve fit)
    if internal:
        k = 0.024
    else:
        k = 0.048

    b = 0.44
    c = 0.725

    current = k * (temp_rise ** b) * (area_mil2 ** c)

    # Derating for elevated ambient temperature
    # At higher ambient temperatures, the absolute max temperature is reached sooner.
    # Approximate derating: reduce capacity by sqrt(Tmax_rise / actual_rise) factor
    # where Tmax_rise accounts for reduced headroom
    # For simplicity, IPC-2152 charts are already at a reference ambient;
    # the primary variable is the temperature RISE, not absolute temperature.
    # No additional derating applied here since temp_rise is the user's budget.

    return current


def via_current_capacity(
    drill: float,
    plating_thickness: float = 0.025,
    length: float = 1.6,
    temp_rise: float = 10.0,
) -> float:
    """Calculate maximum current-carrying capacity of a plated via.

    A via is modeled as a hollow copper cylinder. Its current capacity
    depends on the cross-sectional area of the copper annulus and
    the via length (which determines thermal dissipation).

    The copper cross-section of a plated via:
        A = pi * ((r_outer)^2 - (r_inner)^2)
        A = pi * plating_thickness * (drill - plating_thickness)

    For short vias, thermal capacity is limited. We use a simplified
    model based on the cross-sectional area and IPC-2152 methodology.

    Args:
        drill: Via drill diameter (mm).
        plating_thickness: Copper plating thickness (mm). Typical: 0.025mm (1mil).
        length: Via barrel length / board thickness (mm). Default 1.6mm.
        temp_rise: Maximum acceptable temperature rise (Celsius).

    Returns:
        Maximum current in amps.
    """
    if drill <= 0 or plating_thickness <= 0 or length <= 0 or temp_rise <= 0:
        return 0.0

    # Cross-sectional area of the copper plating (hollow cylinder)
    r_outer = drill / 2.0
    r_inner = r_outer - plating_thickness
    if r_inner < 0:
        r_inner = 0.0

    area_mm2 = math.pi * (r_outer**2 - r_inner**2)

    # Resistance of the via barrel
    # R = rho * L / A
    # Using copper resistivity at elevated temperature
    t_operating = 25.0 + temp_rise
    rho = COPPER_RESISTIVITY_20C * (1.0 + COPPER_TEMP_COEFF * (t_operating - 20.0))
    resistance = rho * length / area_mm2  # ohms

    # Power dissipation for temperature rise
    # Simplified thermal model: the via dissipates heat through the
    # surrounding board material and connected copper planes.
    # Approximate thermal resistance of a via:
    # R_th ~ length / (k_copper * A_copper + k_fr4 * A_fr4)
    # For a conservative estimate, assume heat removal only through
    # the copper annulus itself (worst case).

    # Using P = I^2 * R and P = dT / R_thermal:
    # I = sqrt(dT / (R * R_thermal))
    # Approximate R_thermal for the via:
    k_fr4 = 0.25e-3  # FR4 thermal conductivity W/(mm*K) = 0.25 W/(m*K)
    # Heat is removed axially through copper and radially through FR4
    # Conservative: axial conduction through copper dominates
    r_th_axial = length / (COPPER_THERMAL_CONDUCTIVITY * area_mm2 * 2.0)  # divide by 2 for both ends

    # Also consider the equivalent IPC-2152-style model
    # Convert area to mil^2 and use similar empirical formula
    area_mil2 = area_mm2 / (0.0254 ** 2)

    # Empirical approach similar to trace (conservative for vias)
    # Vias have less surface area, so use lower k factor
    k = 0.020  # Conservative for vias
    b = 0.44
    c = 0.725

    current_empirical = k * (temp_rise ** b) * (area_mil2 ** c)

    # Thermal limit from resistance
    if resistance > 0 and r_th_axial > 0:
        current_thermal = math.sqrt(temp_rise / (resistance * r_th_axial))
    else:
        current_thermal = float('inf')

    # Return the more conservative (lower) estimate
    return min(current_empirical, current_thermal)


def thermal_resistance_trace(
    width: float,
    length: float,
    thickness: float = 0.035,
    copper_conductivity: float = COPPER_THERMAL_CONDUCTIVITY,
) -> float:
    """Calculate thermal resistance of a copper trace.

    Thermal resistance R_th = L / (k * A) where:
        L = trace length
        k = thermal conductivity of copper
        A = cross-sectional area

    This models the trace as a thermal conductor transferring heat
    along its length. For heat spreading calculations, you may also
    need to consider the FR4 substrate.

    Args:
        width: Trace width (mm).
        length: Trace length (mm).
        thickness: Copper thickness (mm). Default 1oz = 0.035mm.
        copper_conductivity: Thermal conductivity in W/(mm*K).
            Default: copper = 0.385 W/(mm*K).

    Returns:
        Thermal resistance in K/W (Kelvin per Watt).
    """
    if width <= 0 or length <= 0 or thickness <= 0 or copper_conductivity <= 0:
        return float('inf')

    area = width * thickness  # mm^2
    r_thermal = length / (copper_conductivity * area)
    return r_thermal


def _trace_resistance(
    width: float,
    length: float,
    thickness: float = 0.035,
    temperature: float = 25.0,
) -> float:
    """Calculate DC electrical resistance of a trace.

    Args:
        width: Trace width (mm).
        length: Trace length (mm).
        thickness: Copper thickness (mm).
        temperature: Operating temperature (C).

    Returns:
        Resistance in ohms.
    """
    if width <= 0 or length <= 0 or thickness <= 0:
        return float('inf')

    rho = COPPER_RESISTIVITY_20C * (1.0 + COPPER_TEMP_COEFF * (temperature - 20.0))
    area = width * thickness  # mm^2
    return rho * length / area


def check_current_capacity(
    board: BoardDesign,
    net_currents: dict[str, float],
    temp_rise: float = 10.0,
    ambient: float = 25.0,
    copper_thickness: float = 0.035,
) -> list[DRCViolation]:
    """Check that traces in specified nets can carry their required current.

    For each net with a specified current, finds the narrowest trace
    and verifies it can handle the current within the temperature rise budget.

    Args:
        board: The board design to check.
        net_currents: Mapping of net name to required current in amps.
        temp_rise: Maximum acceptable temperature rise (Celsius).
        ambient: Ambient temperature (Celsius).
        copper_thickness: Copper thickness for all traces (mm).

    Returns:
        List of DRC violations for traces exceeding their current capacity.
    """
    violations: list[DRCViolation] = []

    for net_name, required_current in net_currents.items():
        net = board.get_net(net_name)
        if net is None:
            continue

        traces = board.traces_in_net(net)
        if not traces:
            continue

        for trace in traces:
            for seg in trace.segments:
                # Determine if this is an internal or external layer
                # Heuristic: layers with index 0 or max are external
                copper_layers = board.copper_layers()
                is_internal = True
                if copper_layers:
                    if trace.layer == copper_layers[0] or trace.layer == copper_layers[-1]:
                        is_internal = False

                max_current = trace_current_capacity(
                    width=seg.width,
                    thickness=copper_thickness,
                    temp_rise=temp_rise,
                    ambient=ambient,
                    internal=is_internal,
                )

                if required_current > max_current:
                    mid_x = (seg.start_x + seg.end_x) / 2.0
                    mid_y = (seg.start_y + seg.end_y) / 2.0
                    layer_type = "internal" if is_internal else "external"

                    violations.append(DRCViolation(
                        rule="current_capacity",
                        severity=DRCSeverity.ERROR,
                        message=(
                            f"Trace on net '{net_name}' ({layer_type}, "
                            f"w={seg.width:.3f}mm) can carry {max_current:.2f}A "
                            f"but {required_current:.2f}A required "
                            f"(dT={temp_rise}C)"
                        ),
                        location=(mid_x, mid_y),
                        affected_items=[
                            f"Trace(net={net_name}, layer={trace.layer.name})"
                        ],
                    ))

    return violations
