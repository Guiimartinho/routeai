"""Z3 SMT constraint solver for PCB design verification.

Uses the Z3 theorem prover for formal verification of length matching,
differential pair skew, and timing constraints. Instead of just checking
numeric values, Z3 formally proves whether constraints are satisfiable
and provides counterexamples when they are not.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import z3

from routeai_solver.board_model import DiffPair, LengthGroup


@dataclass
class ConstraintViolation:
    """A constraint violation found by the solver."""

    constraint_name: str
    message: str
    details: dict[str, float] = field(default_factory=dict)


@dataclass
class ConstraintResult:
    """Result from constraint verification."""

    satisfied: bool
    violations: list[ConstraintViolation] = field(default_factory=list)
    solver_status: str = ""  # "sat", "unsat", "unknown"


class ConstraintSolver:
    """Z3-based constraint solver for PCB design verification.

    Provides formal verification of length matching, differential pair
    skew, and timing constraints using the Z3 SMT solver.

    Usage:
        solver = ConstraintSolver()
        result = solver.verify_length_matching(net_lengths, groups)
    """

    def __init__(self, timeout_ms: int = 5000) -> None:
        """Initialize the constraint solver.

        Args:
            timeout_ms: Z3 solver timeout in milliseconds.
        """
        self.timeout_ms = timeout_ms

    def verify_length_matching(
        self,
        net_lengths: dict[str, float],
        groups: list[LengthGroup],
    ) -> ConstraintResult:
        """Verify that net lengths satisfy length-matching group constraints.

        For each LengthGroup, all nets in the group must have lengths within
        the specified tolerance of each other (or of the target length if set).

        This uses Z3 to formally verify the constraints. The actual net lengths
        are fixed (known), so Z3 checks whether the tolerance constraints hold.

        Args:
            net_lengths: Mapping of net name to routed length (mm).
            groups: List of length-matching groups to verify.

        Returns:
            ConstraintResult with satisfaction status and any violations.
        """
        violations: list[ConstraintViolation] = []
        all_satisfied = True

        for group in groups:
            solver = z3.Solver()
            solver.set("timeout", self.timeout_ms)

            # Create Z3 real variables for each net length
            z3_lengths: dict[str, z3.ArithRef] = {}
            for net_name in group.nets:
                z3_var = z3.Real(f"len_{net_name}")
                z3_lengths[net_name] = z3_var

                # Assert the actual measured length as a constraint
                if net_name in net_lengths:
                    actual = net_lengths[net_name]
                    solver.add(z3_var == z3.RealVal(str(actual)))

            # Determine the reference length
            if group.target_length is not None:
                ref_length = z3.RealVal(str(group.target_length))
            else:
                # Target is the longest net in the group
                max_len = 0.0
                for net_name in group.nets:
                    if net_name in net_lengths:
                        max_len = max(max_len, net_lengths[net_name])
                ref_length = z3.RealVal(str(max_len))

            tolerance = z3.RealVal(str(group.tolerance))

            # Add length matching constraints:
            # For each net: |length - reference| <= tolerance
            constraint_exprs = []
            for net_name in group.nets:
                if net_name not in z3_lengths:
                    continue
                length_var = z3_lengths[net_name]
                # |length - ref| <= tolerance
                # Equivalent to: (length - ref) <= tolerance AND (ref - length) <= tolerance
                c1 = (length_var - ref_length) <= tolerance
                c2 = (ref_length - length_var) <= tolerance
                constraint_exprs.extend([c1, c2])
                solver.add(c1, c2)

            result = solver.check()

            if result == z3.sat:
                # Constraints satisfied -- all lengths within tolerance
                pass
            elif result == z3.unsat:
                all_satisfied = False
                # Find which nets violate the constraint
                ref_val = group.target_length
                if ref_val is None:
                    ref_val = max(
                        (net_lengths.get(n, 0.0) for n in group.nets), default=0.0
                    )

                for net_name in group.nets:
                    actual = net_lengths.get(net_name, 0.0)
                    deviation = abs(actual - ref_val)
                    if deviation > group.tolerance:
                        violations.append(ConstraintViolation(
                            constraint_name=f"length_match:{group.name}",
                            message=(
                                f"Net '{net_name}' length {actual:.3f}mm deviates "
                                f"{deviation:.3f}mm from reference {ref_val:.3f}mm "
                                f"(tolerance: +/-{group.tolerance:.3f}mm)"
                            ),
                            details={
                                "net": float(hash(net_name)),
                                "actual_length": actual,
                                "reference_length": ref_val,
                                "deviation": deviation,
                                "tolerance": group.tolerance,
                            },
                        ))
            else:
                # Unknown (timeout or other issue)
                violations.append(ConstraintViolation(
                    constraint_name=f"length_match:{group.name}",
                    message=f"Solver returned 'unknown' for group '{group.name}'",
                ))
                all_satisfied = False

        status = "sat" if all_satisfied else "unsat"
        return ConstraintResult(
            satisfied=all_satisfied,
            violations=violations,
            solver_status=status,
        )

    def verify_diff_pair_skew(
        self,
        pair: DiffPair,
        pos_length: float,
        neg_length: float,
    ) -> ConstraintResult:
        """Verify differential pair intra-pair skew constraint.

        The positive and negative traces of a differential pair must have
        lengths within the max_skew tolerance.

        Args:
            pair: Differential pair definition.
            pos_length: Length of positive trace (mm).
            neg_length: Length of negative trace (mm).

        Returns:
            ConstraintResult with satisfaction status and skew info.
        """
        solver = z3.Solver()
        solver.set("timeout", self.timeout_ms)

        # Z3 variables
        p_len = z3.Real("pos_length")
        n_len = z3.Real("neg_length")
        skew = z3.Real("skew")
        max_skew = z3.RealVal(str(pair.max_skew))

        # Assert actual lengths
        solver.add(p_len == z3.RealVal(str(pos_length)))
        solver.add(n_len == z3.RealVal(str(neg_length)))

        # skew = |pos_length - neg_length|
        solver.add(z3.Or(
            z3.And(skew == p_len - n_len, p_len >= n_len),
            z3.And(skew == n_len - p_len, n_len > p_len),
        ))

        # Constraint: skew <= max_skew
        solver.add(skew <= max_skew)

        result = solver.check()
        actual_skew = abs(pos_length - neg_length)

        if result == z3.sat:
            return ConstraintResult(
                satisfied=True,
                violations=[],
                solver_status="sat",
            )
        else:
            violation = ConstraintViolation(
                constraint_name=f"diff_pair_skew:{pair.name}",
                message=(
                    f"Differential pair '{pair.name}' skew {actual_skew:.4f}mm "
                    f"exceeds maximum {pair.max_skew:.4f}mm "
                    f"(P={pos_length:.3f}mm, N={neg_length:.3f}mm)"
                ),
                details={
                    "pos_length": pos_length,
                    "neg_length": neg_length,
                    "skew": actual_skew,
                    "max_skew": pair.max_skew,
                },
            )
            return ConstraintResult(
                satisfied=False,
                violations=[violation],
                solver_status="unsat",
            )

    def verify_timing_constraints(
        self,
        delays: dict[str, float],
        max_delay: float,
        max_skew: float,
    ) -> ConstraintResult:
        """Verify timing constraints for a group of signals.

        Checks that:
        1. No signal exceeds max_delay
        2. The skew between any two signals does not exceed max_skew

        Delays are typically in picoseconds.

        Args:
            delays: Mapping of signal name to propagation delay (ps).
            max_delay: Maximum allowed propagation delay (ps).
            max_skew: Maximum allowed skew between any two signals (ps).

        Returns:
            ConstraintResult with satisfaction status.
        """
        if not delays:
            return ConstraintResult(satisfied=True, solver_status="sat")

        solver = z3.Solver()
        solver.set("timeout", self.timeout_ms)
        violations: list[ConstraintViolation] = []

        # Create Z3 variables and assert actual delay values
        z3_delays: dict[str, z3.ArithRef] = {}
        for sig_name, delay_val in delays.items():
            z3_var = z3.Real(f"delay_{sig_name}")
            z3_delays[sig_name] = z3_var
            solver.add(z3_var == z3.RealVal(str(delay_val)))

        z3_max_delay = z3.RealVal(str(max_delay))
        z3_max_skew = z3.RealVal(str(max_skew))

        # Constraint 1: All delays <= max_delay
        for sig_name, z3_var in z3_delays.items():
            solver.add(z3_var <= z3_max_delay)
            solver.add(z3_var >= z3.RealVal("0"))

        # Constraint 2: |delay_i - delay_j| <= max_skew for all pairs
        sig_names = list(z3_delays.keys())
        for i in range(len(sig_names)):
            for j in range(i + 1, len(sig_names)):
                d_i = z3_delays[sig_names[i]]
                d_j = z3_delays[sig_names[j]]
                solver.add((d_i - d_j) <= z3_max_skew)
                solver.add((d_j - d_i) <= z3_max_skew)

        result = solver.check()

        if result == z3.sat:
            return ConstraintResult(satisfied=True, solver_status="sat")

        # Unsatisfiable -- find specific violations
        all_satisfied = True

        # Check max_delay violations
        for sig_name, delay_val in delays.items():
            if delay_val > max_delay:
                all_satisfied = False
                violations.append(ConstraintViolation(
                    constraint_name="max_delay",
                    message=(
                        f"Signal '{sig_name}' delay {delay_val:.2f}ps "
                        f"exceeds maximum {max_delay:.2f}ps"
                    ),
                    details={
                        "signal": float(hash(sig_name)),
                        "delay": delay_val,
                        "max_delay": max_delay,
                    },
                ))

        # Check skew violations
        for i in range(len(sig_names)):
            for j in range(i + 1, len(sig_names)):
                skew = abs(delays[sig_names[i]] - delays[sig_names[j]])
                if skew > max_skew:
                    all_satisfied = False
                    violations.append(ConstraintViolation(
                        constraint_name="max_skew",
                        message=(
                            f"Skew between '{sig_names[i]}' and '{sig_names[j]}' "
                            f"is {skew:.2f}ps, exceeds maximum {max_skew:.2f}ps"
                        ),
                        details={
                            "signal_a": float(hash(sig_names[i])),
                            "signal_b": float(hash(sig_names[j])),
                            "skew": skew,
                            "max_skew": max_skew,
                        },
                    ))

        return ConstraintResult(
            satisfied=False,
            violations=violations,
            solver_status="unsat",
        )
