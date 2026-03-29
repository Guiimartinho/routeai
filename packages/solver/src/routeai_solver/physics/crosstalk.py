"""Crosstalk estimation for coupled transmission lines.

Calculates forward (FEXT) and backward (NEXT) crosstalk coefficients
for parallel trace segments based on coupled-line theory per IPC-2141.

References:
    - IPC-2141A sections on crosstalk
    - Howard Johnson, "High-Speed Signal Propagation"
    - Eric Bogatin, "Signal and Power Integrity - Simplified"
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from routeai_solver.board_model import StackupLayer, Trace


@dataclass
class TraceGeometry:
    """Simplified trace geometry for crosstalk calculation."""

    width: float  # mm
    parallel_length: float  # mm - length of parallel run
    separation: float  # mm - edge-to-edge spacing
    layer_index: int = 0  # which copper layer


@dataclass
class StackupInfo:
    """Stackup info needed for crosstalk calculations."""

    h: float  # height to reference plane (mm)
    er: float  # relative permittivity
    t: float = 0.035  # trace thickness (mm)


@dataclass
class CrosstalkResult:
    """Result from crosstalk calculation."""

    coefficient: float  # crosstalk coefficient (dimensionless ratio, 0-1)
    coefficient_db: float  # crosstalk in dB (negative number)
    coupled_length_mm: float  # parallel coupling length


def _mutual_capacitance_ratio(s: float, h: float, w: float) -> float:
    """Estimate mutual-to-self capacitance ratio for edge-coupled microstrip.

    Based on the approximate formula from coupled-line theory.

    Args:
        s: Edge-to-edge separation (mm).
        h: Height to reference plane (mm).
        w: Trace width (mm).

    Returns:
        Cm/C ratio (dimensionless).
    """
    if s <= 0 or h <= 0:
        return 0.0
    # Approximate mutual capacitance ratio for microstrip
    # Based on empirical fit to full-wave solutions
    k_c = (1.0 / math.pi) * math.log(1.0 + (2.0 * h / s) * math.tanh(
        math.pi * w / (4.0 * h)
    ))
    return max(0.0, min(1.0, k_c))


def _mutual_inductance_ratio(s: float, h: float, w: float) -> float:
    """Estimate mutual-to-self inductance ratio for edge-coupled microstrip.

    Args:
        s: Edge-to-edge separation (mm).
        h: Height to reference plane (mm).
        w: Trace width (mm).

    Returns:
        Lm/L ratio (dimensionless).
    """
    if s <= 0 or h <= 0:
        return 0.0
    # For microstrip, Lm/L is typically somewhat larger than Cm/C
    # because the magnetic coupling extends above the traces (air region)
    k_l = (1.0 / math.pi) * math.log(1.0 + (2.0 * h / s) * math.tanh(
        math.pi * (w + 2.0 * h) / (4.0 * h)
    ))
    return max(0.0, min(1.0, k_l))


def calculate_next(
    aggressor: TraceGeometry,
    victim: TraceGeometry,
    stackup: StackupInfo,
) -> CrosstalkResult:
    """Calculate backward crosstalk (NEXT) coefficient.

    NEXT is the crosstalk measured at the near end (same end as the
    aggressor driver). It is proportional to the sum of inductive and
    capacitive coupling and reaches a maximum that is independent of
    coupled length (for lengths longer than the saturation length).

    The NEXT coefficient (Kb) is:
        Kb = (1/4) * (Lm/L + Cm/C)

    For short coupled lengths (< saturation length), NEXT scales with
    coupled length. The saturation length is approximately:
        L_sat = rise_time * v / 2

    We report the maximum NEXT assuming the coupled length is at or
    beyond saturation.

    Args:
        aggressor: Aggressor trace geometry.
        victim: Victim trace geometry.
        stackup: Stackup parameters.

    Returns:
        CrosstalkResult with NEXT coefficient.
    """
    s = aggressor.separation
    h = stackup.h
    w_avg = (aggressor.width + victim.width) / 2.0

    k_c = _mutual_capacitance_ratio(s, h, w_avg)
    k_l = _mutual_inductance_ratio(s, h, w_avg)

    # NEXT coefficient (backward crosstalk)
    # Kb = (Lm/L + Cm/C) / 4
    # This is the saturated (maximum) NEXT coefficient
    kb = (k_l + k_c) / 4.0

    # Clamp to physical limits
    kb = max(0.0, min(1.0, kb))

    if kb > 0:
        coeff_db = 20.0 * math.log10(kb)
    else:
        coeff_db = -200.0  # effectively zero

    return CrosstalkResult(
        coefficient=kb,
        coefficient_db=coeff_db,
        coupled_length_mm=aggressor.parallel_length,
    )


def calculate_fext(
    aggressor: TraceGeometry,
    victim: TraceGeometry,
    stackup: StackupInfo,
    rise_time_ns: float = 0.5,
) -> CrosstalkResult:
    """Calculate forward crosstalk (FEXT) coefficient.

    FEXT is the crosstalk measured at the far end (opposite end from
    the aggressor driver). Unlike NEXT, FEXT is proportional to the
    coupled length and inversely proportional to rise time.

    For microstrip (asymmetric dielectric), the FEXT coefficient (Kf) is:
        Kf = (coupled_length / (2 * rise_time * v)) * (Lm/L - Cm/C)

    The Lm/L - Cm/C term is non-zero for microstrip because the electric
    and magnetic fields see different dielectric environments.

    For stripline (symmetric), FEXT is theoretically zero because
    Lm/L = Cm/C (pure TEM mode).

    Args:
        aggressor: Aggressor trace geometry.
        victim: Victim trace geometry.
        stackup: Stackup parameters.
        rise_time_ns: Signal rise time in nanoseconds. Default 0.5ns.

    Returns:
        CrosstalkResult with FEXT coefficient.
    """
    s = aggressor.separation
    h = stackup.h
    w_avg = (aggressor.width + victim.width) / 2.0
    coupled_length = aggressor.parallel_length

    k_c = _mutual_capacitance_ratio(s, h, w_avg)
    k_l = _mutual_inductance_ratio(s, h, w_avg)

    # Propagation velocity
    from routeai_solver.physics.impedance import microstrip_impedance
    imp = microstrip_impedance(w_avg, h, stackup.er, stackup.t)
    velocity_mm_per_ns = imp.velocity * 1e-6  # m/s -> mm/ns

    # FEXT coefficient
    # Kf = (coupled_length / (2 * Tr * v)) * |Lm/L - Cm/C|
    if rise_time_ns > 0 and velocity_mm_per_ns > 0:
        kf = (coupled_length / (2.0 * rise_time_ns * velocity_mm_per_ns)) * abs(k_l - k_c)
    else:
        kf = 0.0

    kf = max(0.0, min(1.0, kf))

    if kf > 0:
        coeff_db = 20.0 * math.log10(kf)
    else:
        coeff_db = -200.0

    return CrosstalkResult(
        coefficient=kf,
        coefficient_db=coeff_db,
        coupled_length_mm=coupled_length,
    )
