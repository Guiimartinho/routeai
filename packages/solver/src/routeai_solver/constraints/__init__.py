"""Constraint solving subsystem using Z3 SMT solver.

Provides formal verification of length matching, differential pair skew,
and timing constraints.
"""

from routeai_solver.constraints.z3_solver import ConstraintSolver

__all__ = ["ConstraintSolver"]
