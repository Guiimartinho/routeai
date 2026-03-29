"""Physics subsystem for PCB signal integrity and thermal analysis.

Provides impedance calculators, crosstalk estimation, and thermal analysis
based on IPC-2141 and IPC-2152 standards.
"""

from routeai_solver.physics.impedance import (
    ImpedanceResult,
    differential_microstrip_impedance,
    differential_stripline_impedance,
    embedded_microstrip_impedance,
    microstrip_impedance,
    stripline_impedance,
)

__all__ = [
    "ImpedanceResult",
    "differential_microstrip_impedance",
    "differential_stripline_impedance",
    "embedded_microstrip_impedance",
    "microstrip_impedance",
    "stripline_impedance",
]
