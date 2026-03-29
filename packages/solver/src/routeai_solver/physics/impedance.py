"""Transmission line impedance calculator using IPC-2141 / Hammerstad-Jensen equations.

Implements closed-form equations for microstrip, embedded microstrip, stripline,
and differential pair configurations. All dimensions in mm, frequencies in GHz.

References:
    - IPC-2141A: Design Guide for High-Speed Controlled Impedance Circuit Boards
    - Hammerstad, E. & Jensen, O. "Accurate Models for Microstrip Computer-Aided
      Design", IEEE MTT-S, 1980
    - Wadell, B. "Transmission Line Design Handbook", Artech House, 1991
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Speed of light in vacuum (m/s)
C_0 = 299_792_458.0

# Free-space impedance (ohms)
ETA_0 = 376.730313668


@dataclass
class ImpedanceResult:
    """Result from an impedance calculation."""

    z0: float  # characteristic impedance (ohms) -- single-ended
    z_diff: float = 0.0  # differential impedance (ohms), 0 if not applicable
    er_eff: float = 1.0  # effective dielectric constant
    velocity: float = C_0  # signal propagation velocity (m/s)
    delay_per_length: float = 0.0  # propagation delay (ps/mm)

    def __post_init__(self) -> None:
        if self.er_eff > 0:
            self.velocity = C_0 / math.sqrt(self.er_eff)
            # delay in ps/mm: (1/velocity) converted to ps/mm
            # velocity is m/s, 1 mm = 1e-3 m, 1 s = 1e12 ps
            self.delay_per_length = 1e9 / self.velocity  # ps/mm


# ---------------------------------------------------------------------------
# Effective dielectric constant helpers (Hammerstad-Jensen)
# ---------------------------------------------------------------------------

def _effective_dielectric_hammerstad(
    er: float, u: float
) -> float:
    """Effective dielectric constant for microstrip (Hammerstad-Jensen).

    Args:
        er: Relative permittivity of substrate.
        u: Normalized width w/h.

    Returns:
        Effective dielectric constant er_eff.
    """
    # Hammerstad-Jensen formula for er_eff
    # a(u) and b(er) correction factors
    a = 1.0 + (1.0 / 49.0) * math.log(
        (u**4 + (u / 52.0)**2) / (u**4 + 0.432)
    ) + (1.0 / 18.7) * math.log(1.0 + (u / 18.1)**3)

    b = 0.564 * ((er - 0.9) / (er + 3.0)) ** 0.053

    er_eff = (er + 1.0) / 2.0 + ((er - 1.0) / 2.0) * (1.0 + 10.0 / u) ** (-a * b)
    return er_eff


def _z0_microstrip_hammerstad(u: float) -> float:
    """Characteristic impedance of microstrip in free space (er=1).

    Hammerstad-Jensen formula for Z0 with er=1 (air).

    Args:
        u: Normalized width w/h.

    Returns:
        Z0 for air dielectric (ohms).
    """
    # F(u) expression from Hammerstad-Jensen
    f_u = 6.0 + (2.0 * math.pi - 6.0) * math.exp(
        -(30.666 / u) ** 0.7528
    )
    z0_air = (ETA_0 / (2.0 * math.pi)) * math.log(f_u / u + math.sqrt(1.0 + (2.0 / u)**2))
    return z0_air


def _thickness_correction(u: float, t: float, h: float) -> float:
    """Effective width correction for finite trace thickness.

    Accounts for the fringing effect of trace thickness per Wheeler's
    approximation as used in Hammerstad-Jensen.

    Args:
        u: Normalized width w/h.
        t: Trace thickness (mm).
        h: Dielectric height (mm).

    Returns:
        Corrected normalized width u_eff.
    """
    if t <= 0.0 or h <= 0.0:
        return u

    t_h = t / h
    if u >= 1.0 / (2.0 * math.pi):
        # Wide-strip correction (Wheeler)
        delta_u = (t_h / math.pi) * math.log(
            4.0 * math.e / math.sqrt((t_h / (math.pi * (u + 1.1)))**2 + 1.0)
        )
    else:
        # Narrow-strip correction (Wheeler)
        delta_u = (t_h / (2.0 * math.pi)) * math.log(
            4.0 * math.pi * u / t_h
        )
    return u + delta_u


# ---------------------------------------------------------------------------
# Public API: Impedance calculations
# ---------------------------------------------------------------------------

def microstrip_impedance(
    w: float, h: float, er: float, t: float = 0.035
) -> ImpedanceResult:
    """Calculate characteristic impedance of a surface microstrip.

    Uses Hammerstad-Jensen closed-form equations from IPC-2141.

    Args:
        w: Trace width (mm).
        h: Dielectric height from trace to reference plane (mm).
        er: Relative permittivity of the dielectric.
        t: Trace thickness / copper thickness (mm). Default 1 oz = 0.035mm.

    Returns:
        ImpedanceResult with Z0, er_eff, velocity, and delay.
    """
    if w <= 0 or h <= 0 or er <= 0:
        raise ValueError("w, h, and er must all be positive")

    u = w / h
    # Apply thickness correction
    u_eff = _thickness_correction(u, t, h)

    # Calculate Z0 in free space and er_eff
    z0_air = _z0_microstrip_hammerstad(u_eff)
    er_eff = _effective_dielectric_hammerstad(er, u_eff)

    # Thickness correction to er_eff
    if t > 0 and h > 0:
        t_h = t / h
        delta_er = -(er - 1.0) * t_h / (4.6 * math.sqrt(u))
        er_eff = max(1.0, er_eff + delta_er)

    z0 = z0_air / math.sqrt(er_eff)

    return ImpedanceResult(z0=z0, er_eff=er_eff)


def embedded_microstrip_impedance(
    w: float, h1: float, h2: float, er: float, t: float = 0.035
) -> ImpedanceResult:
    """Calculate impedance of an embedded (covered/coated) microstrip.

    An embedded microstrip has dielectric above and below the trace.
    h1 is the height from the trace to the reference plane (below),
    h2 is the height of the dielectric covering above the trace.

    Uses the Hammerstad-Jensen microstrip formula with a correction
    factor for the covering dielectric per IPC-2141.

    Args:
        w: Trace width (mm).
        h1: Dielectric height below trace to reference plane (mm).
        h2: Dielectric height above trace (covering) (mm).
        er: Relative permittivity of the dielectric.
        t: Trace thickness (mm).

    Returns:
        ImpedanceResult with Z0, er_eff, velocity, and delay.
    """
    if w <= 0 or h1 <= 0 or h2 <= 0 or er <= 0:
        raise ValueError("w, h1, h2, and er must all be positive")

    # Start with the uncovered microstrip calculation
    base = microstrip_impedance(w, h1, er, t)

    # Correction factor for the covering dielectric
    # The covering increases er_eff towards the bulk er.
    # Empirical formula from IPC-2141 / Wadell:
    # er_eff_embedded = er - (er - er_eff_uncovered) * exp(-2 * h2/h1)
    correction = math.exp(-2.0 * h2 / h1)
    er_eff_embedded = er - (er - base.er_eff) * correction

    # Recalculate Z0 with the embedded er_eff
    u = w / h1
    u_eff = _thickness_correction(u, t, h1)
    z0_air = _z0_microstrip_hammerstad(u_eff)
    z0 = z0_air / math.sqrt(er_eff_embedded)

    return ImpedanceResult(z0=z0, er_eff=er_eff_embedded)


def stripline_impedance(
    w: float, h: float, er: float, t: float = 0.035
) -> ImpedanceResult:
    """Calculate characteristic impedance of a centered (symmetric) stripline.

    The trace is centered between two ground planes separated by total
    distance 2*h (the trace sits at height h from each plane).

    Uses the Wadell/Cohn closed-form equations from IPC-2141.
    Primary formula: Z0 = (60 / sqrt(er)) * ln(4*b / (pi * we))
    with effective width correction for finite trace thickness.

    Args:
        w: Trace width (mm).
        h: Distance from trace center to each ground plane (mm).
            Total dielectric thickness is 2*h.
        er: Relative permittivity of the dielectric.
        t: Trace thickness (mm).

    Returns:
        ImpedanceResult with Z0, er_eff (= er for stripline), velocity, and delay.
    """
    if w <= 0 or h <= 0 or er <= 0:
        raise ValueError("w, h, and er must all be positive")

    # b = total distance between ground planes
    b = 2.0 * h

    # Effective width correction for finite thickness (Wheeler/Cohn)
    # we = w + delta_w where delta_w accounts for fringing from trace thickness
    if t > 0 and (b - t) > 0:
        x = t / (b - t)
        # Wheeler's correction for stripline
        if w / (b - t) >= 0.35:
            delta_w = (t / math.pi) * (1.0 - math.log(
                (2.0 * x) if x > 0 else 1e-10
            ))
        else:
            delta_w = (t / math.pi) * (1.0 - math.log(
                4.0 * math.pi * w / (math.pi * w + 4.0 * t) if (math.pi * w + 4.0 * t) > 0 else 1e-10
            ))
        w_eff = w + abs(delta_w)
    else:
        w_eff = w

    we_bt = w_eff / (b - t) if (b - t) > 0 else w_eff / b

    if we_bt < 0.35:
        # Narrow strip: Cohn's formula
        # Z0 = (60 / sqrt(er)) * ln(4 * b / (pi * d_e))
        # For narrow rectangular strip: d_e ~ (pi/4) * w_eff * (1 + t/(pi*w_eff) * (1 + ln(4*pi*w_eff/t)))
        # Simplified Wadell formula for narrow strip:
        # Z0 = (60 / sqrt(er)) * ln(2*b / (pi * w_eff))  -- for very narrow strips
        # Better: use the complete Cohn formula
        ratio = 4.0 * b / (math.pi * w_eff) if w_eff > 0 else 1000.0
        if ratio > 1.0:
            z0 = (60.0 / math.sqrt(er)) * math.log(ratio)
        else:
            z0 = (60.0 / math.sqrt(er)) * 0.01  # degenerate case
    else:
        # Wide strip: Wheeler/Cohn formula
        # Z0 = (94.15 / sqrt(er)) / (we/(b-t) + (2/pi)*ln(2*(b-t)/(pi*t) + 1))
        if t > 0:
            cf_val = (2.0 / math.pi) * math.log(
                2.0 * (b - t) / (math.pi * t) + 1.0
            )
        else:
            cf_val = 0.0
        z0 = (94.15 / math.sqrt(er)) / (we_bt + cf_val)

    # For stripline, er_eff = er (fully embedded in dielectric)
    return ImpedanceResult(z0=z0, er_eff=er)


def differential_microstrip_impedance(
    w: float, s: float, h: float, er: float, t: float = 0.035
) -> ImpedanceResult:
    """Calculate differential impedance of edge-coupled microstrip pair.

    Uses the single-ended microstrip impedance with coupling correction
    per IPC-2141.

    Args:
        w: Trace width of each line (mm).
        s: Edge-to-edge spacing between the two traces (mm).
        h: Dielectric height to reference plane (mm).
        er: Relative permittivity.
        t: Trace thickness (mm).

    Returns:
        ImpedanceResult with both Z0 (single-ended) and Z_diff.
    """
    if w <= 0 or s <= 0 or h <= 0 or er <= 0:
        raise ValueError("w, s, h, and er must all be positive")

    # Get single-ended impedance
    se = microstrip_impedance(w, h, er, t)

    # Coupling coefficient for edge-coupled microstrip (IPC-2141 / Wadell)
    # Odd-mode impedance: Z_odd = Z0 * (1 - k * exp(-a * s/h))
    # where k and a are empirical fit parameters

    # Kirschning and Jansen coupling model:
    u = w / h
    g = s / h

    # Odd-mode effective dielectric constant
    # er_eff_odd = (0.5 * (er+1) + a0 - er_eff) * exp(-c * g^d) + er_eff
    # Simplified empirical model:
    a0 = 0.7287 * (se.er_eff - 0.5 * (er + 1.0)) * (1.0 + 0.25 * (u - 0.5))
    c_coeff = 0.747 * er / (0.15 + er)
    d_coeff = max(0.1, 1.0 - 0.5 * math.exp(-0.1 * u))

    # Coupling correction factor for odd-mode impedance
    # Based on IPC-2141 empirical formulas
    q1 = 0.8695 * u ** 0.194
    q2 = 1.0 + 0.7519 * g + 0.189 * g ** 2.31
    q3 = 0.1975 + (16.6 + (8.4 / g) ** 6.0) ** (-0.387)
    q4 = (2.0 / (q2 * (math.exp(-g) * u**q3 + (2.0 - math.exp(-g)) * u**(-q3))))

    # Odd-mode Z0
    z0_odd = se.z0 * (1.0 - q4 * math.exp(-1.0 * g)) if g > 0 else se.z0 * 0.5

    # Even-mode Z0
    q5 = 1.794 + 1.14 * math.log(1.0 + 0.638 / (g + 0.517 * g**2.43))
    q6 = 0.2305 + (1.0 / (281.3 + (g * (1.0 + 1.0 / (3.0 * u))))**5.0)

    z0_even = se.z0 * (1.0 + q5 * math.exp(-q6 * g)) if g > 0 else se.z0 * 2.0

    # Differential impedance
    z_diff = 2.0 * z0_odd

    # More direct empirical approach from IPC-2141:
    # Z_diff = 2 * Z0 * (1 - 0.48 * exp(-0.96 * s/h))
    z_diff_empirical = 2.0 * se.z0 * (1.0 - 0.48 * math.exp(-0.96 * s / h))

    # Use the empirical formula as it's been well validated against measurements
    z_diff = z_diff_empirical

    # Effective er for differential mode (average of odd and even)
    er_eff_diff = se.er_eff  # Approximation; exact requires full mode analysis

    return ImpedanceResult(z0=se.z0, z_diff=z_diff, er_eff=er_eff_diff)


def differential_stripline_impedance(
    w: float, s: float, h: float, er: float, t: float = 0.035
) -> ImpedanceResult:
    """Calculate differential impedance of edge-coupled stripline pair.

    Uses the single-ended stripline impedance with coupling correction
    per IPC-2141.

    Args:
        w: Trace width of each line (mm).
        s: Edge-to-edge spacing between traces (mm).
        h: Distance from trace to each ground plane (mm).
            Total stackup height = 2*h.
        er: Relative permittivity.
        t: Trace thickness (mm).

    Returns:
        ImpedanceResult with both Z0 and Z_diff.
    """
    if w <= 0 or s <= 0 or h <= 0 or er <= 0:
        raise ValueError("w, s, h, and er must all be positive")

    # Get single-ended impedance
    se = stripline_impedance(w, h, er, t)

    # Coupling correction for edge-coupled stripline (IPC-2141)
    # Z_diff = 2 * Z0 * (1 - 0.347 * exp(-2.90 * s / (2*h)))
    # where 2*h is the total ground-plane separation
    b = 2.0 * h  # total ground spacing
    z_diff = 2.0 * se.z0 * (1.0 - 0.347 * math.exp(-2.90 * s / b))

    return ImpedanceResult(z0=se.z0, z_diff=z_diff, er_eff=er)
