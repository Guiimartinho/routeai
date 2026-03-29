"""Tests for physics calculations and constraint solver.

Tests impedance calculations against known reference values,
current capacity against IPC-2152, and Z3 constraint solver.

Reference impedance values from:
    - Polar Instruments Si8000m field solver (industry standard)
    - IPC-2141A examples and tables
    - Commonly targeted impedances (50 ohm, 75 ohm, 90 ohm USB, 100 ohm DDR4)
"""

from __future__ import annotations

import math

import pytest

from routeai_solver.board_model import DiffPair, LengthGroup, Net
from routeai_solver.constraints.z3_solver import ConstraintSolver
from routeai_solver.physics.crosstalk import (
    CrosstalkResult,
    StackupInfo,
    TraceGeometry,
    calculate_fext,
    calculate_next,
)
from routeai_solver.physics.impedance import (
    ImpedanceResult,
    differential_microstrip_impedance,
    differential_stripline_impedance,
    embedded_microstrip_impedance,
    microstrip_impedance,
    stripline_impedance,
)
from routeai_solver.physics.thermal import (
    thermal_resistance_trace,
    trace_current_capacity,
    via_current_capacity,
)


# ---------------------------------------------------------------------------
# Impedance tests
# ---------------------------------------------------------------------------

class TestMicrostripImpedance:
    """Test microstrip impedance calculations against known values."""

    def test_50_ohm_standard(self):
        """Standard ~50 ohm microstrip on FR4 (er=4.3).

        A common design: w=0.28mm on 0.2mm FR4 substrate should give ~50 ohms.
        Tolerance: +/- 10% (field solver vs. closed-form)
        """
        result = microstrip_impedance(w=0.28, h=0.2, er=4.3, t=0.035)
        assert isinstance(result, ImpedanceResult)
        assert 40.0 < result.z0 < 60.0, f"Expected ~50 ohm, got {result.z0:.1f}"
        assert result.er_eff > 1.0
        assert result.er_eff < 4.3  # Must be between 1 and er
        assert result.velocity > 0
        assert result.delay_per_length > 0

    def test_75_ohm_video(self):
        """~75 ohm microstrip for video signals.

        Narrower trace on same stackup gives higher impedance.
        w=0.12mm, h=0.2mm, er=4.3
        """
        result = microstrip_impedance(w=0.12, h=0.2, er=4.3, t=0.035)
        assert 60.0 < result.z0 < 95.0, f"Expected ~75 ohm, got {result.z0:.1f}"

    def test_wider_trace_lower_impedance(self):
        """Wider traces should have lower impedance."""
        narrow = microstrip_impedance(w=0.1, h=0.2, er=4.3)
        wide = microstrip_impedance(w=0.5, h=0.2, er=4.3)
        assert wide.z0 < narrow.z0

    def test_taller_dielectric_higher_impedance(self):
        """Thicker dielectric should increase impedance."""
        thin = microstrip_impedance(w=0.2, h=0.1, er=4.3)
        thick = microstrip_impedance(w=0.2, h=0.5, er=4.3)
        assert thick.z0 > thin.z0

    def test_higher_er_lower_impedance(self):
        """Higher dielectric constant should decrease impedance."""
        low_er = microstrip_impedance(w=0.2, h=0.2, er=3.0)
        high_er = microstrip_impedance(w=0.2, h=0.2, er=10.0)
        assert high_er.z0 < low_er.z0

    def test_effective_dielectric_bounds(self):
        """Effective dielectric constant should be between 1 and er."""
        for er in [2.0, 4.3, 6.0, 10.0]:
            result = microstrip_impedance(w=0.2, h=0.2, er=er)
            assert 1.0 <= result.er_eff <= er, (
                f"er_eff={result.er_eff} not in [1, {er}]"
            )

    def test_velocity_less_than_c(self):
        """Signal velocity must be less than speed of light."""
        result = microstrip_impedance(w=0.2, h=0.2, er=4.3)
        c = 299_792_458.0
        assert result.velocity < c

    def test_invalid_params_raise(self):
        with pytest.raises(ValueError):
            microstrip_impedance(w=0, h=0.2, er=4.3)
        with pytest.raises(ValueError):
            microstrip_impedance(w=0.2, h=0, er=4.3)
        with pytest.raises(ValueError):
            microstrip_impedance(w=0.2, h=0.2, er=0)


class TestEmbeddedMicrostrip:
    """Test embedded (covered) microstrip impedance."""

    def test_embedded_lower_than_surface(self):
        """Embedded microstrip should have lower impedance than surface."""
        surface = microstrip_impedance(w=0.2, h=0.2, er=4.3)
        embedded = embedded_microstrip_impedance(w=0.2, h1=0.2, h2=0.2, er=4.3)
        # Covering dielectric increases er_eff, lowering Z0
        assert embedded.z0 < surface.z0

    def test_thick_cover_approaches_stripline(self):
        """With very thick covering, should approach but be above stripline."""
        embedded = embedded_microstrip_impedance(w=0.2, h1=0.2, h2=5.0, er=4.3)
        # er_eff should approach bulk er
        assert embedded.er_eff > 3.5


class TestStriplineImpedance:
    """Test stripline impedance calculations."""

    def test_50_ohm_stripline(self):
        """~50 ohm centered stripline.

        For stripline, narrow trace on tall stackup gives ~50 ohms:
        w=0.1mm between two ground planes each 0.2mm away, er=4.3
        """
        result = stripline_impedance(w=0.1, h=0.2, er=4.3, t=0.035)
        assert isinstance(result, ImpedanceResult)
        assert 35.0 < result.z0 < 65.0, f"Expected ~50 ohm, got {result.z0:.1f}"
        # For stripline, er_eff should equal er (fully embedded)
        assert abs(result.er_eff - 4.3) < 0.01

    def test_stripline_er_eff_equals_er(self):
        """Stripline effective dielectric = bulk dielectric."""
        result = stripline_impedance(w=0.2, h=0.3, er=4.5)
        assert result.er_eff == 4.5

    def test_wider_trace_lower_impedance_stripline(self):
        narrow = stripline_impedance(w=0.1, h=0.3, er=4.3)
        wide = stripline_impedance(w=0.5, h=0.3, er=4.3)
        assert wide.z0 < narrow.z0


class TestDifferentialMicrostrip:
    """Test differential microstrip impedance."""

    def test_90_ohm_usb(self):
        """USB 2.0/3.0 targets 90 ohm differential.

        Realistic 4-layer stackup: w=0.18mm, s=0.15mm, h=0.11mm, er=4.3
        Expected Z_diff around 80-100 ohms.
        """
        result = differential_microstrip_impedance(
            w=0.18, s=0.15, h=0.11, er=4.3, t=0.035
        )
        assert result.z_diff > 0
        # Z_diff should be somewhat less than 2*Z0 due to coupling
        assert result.z_diff < 2.0 * result.z0
        # Approximate range for USB
        assert 70.0 < result.z_diff < 110.0, (
            f"Expected ~90 ohm diff, got {result.z_diff:.1f}"
        )

    def test_100_ohm_ddr4(self):
        """DDR4 targets 100 ohm differential.

        Realistic stackup: w=0.12mm, s=0.12mm, h=0.1mm, er=4.3
        """
        result = differential_microstrip_impedance(
            w=0.12, s=0.12, h=0.1, er=4.3, t=0.035
        )
        assert result.z_diff > 0
        assert 80.0 < result.z_diff < 120.0, (
            f"Expected ~100 ohm diff, got {result.z_diff:.1f}"
        )

    def test_wider_spacing_higher_diff_impedance(self):
        """More spacing reduces coupling, increasing differential impedance."""
        close = differential_microstrip_impedance(w=0.15, s=0.1, h=0.2, er=4.3)
        far = differential_microstrip_impedance(w=0.15, s=1.0, h=0.2, er=4.3)
        assert far.z_diff > close.z_diff

    def test_z_diff_less_than_2_z0(self):
        """Differential impedance should be less than 2x single-ended (coupling reduces it)."""
        result = differential_microstrip_impedance(w=0.15, s=0.15, h=0.2, er=4.3)
        assert result.z_diff < 2.0 * result.z0 * 1.01  # small tolerance


class TestDifferentialStripline:
    """Test differential stripline impedance."""

    def test_100_ohm_diff_stripline(self):
        """~100 ohm differential stripline."""
        result = differential_stripline_impedance(
            w=0.1, s=0.2, h=0.2, er=4.3, t=0.035
        )
        assert result.z_diff > 0
        assert result.z_diff < 2.0 * result.z0

    def test_coupling_effect(self):
        """Tighter coupling should lower differential impedance."""
        close = differential_stripline_impedance(w=0.15, s=0.1, h=0.3, er=4.3)
        far = differential_stripline_impedance(w=0.15, s=1.0, h=0.3, er=4.3)
        assert far.z_diff > close.z_diff


# ---------------------------------------------------------------------------
# Crosstalk tests
# ---------------------------------------------------------------------------

class TestCrosstalk:
    """Test crosstalk calculations."""

    def test_next_decreases_with_spacing(self):
        """NEXT should decrease as traces are spaced further apart."""
        stackup = StackupInfo(h=0.2, er=4.3)
        close = TraceGeometry(width=0.15, parallel_length=50.0, separation=0.15)
        far = TraceGeometry(width=0.15, parallel_length=50.0, separation=1.0)

        next_close = calculate_next(close, close, stackup)
        next_far = calculate_next(far, far, stackup)
        assert next_far.coefficient < next_close.coefficient

    def test_fext_scales_with_length(self):
        """FEXT should increase with parallel coupling length."""
        stackup = StackupInfo(h=0.2, er=4.3)
        short = TraceGeometry(width=0.15, parallel_length=5.0, separation=0.2)
        long = TraceGeometry(width=0.15, parallel_length=50.0, separation=0.2)

        fext_short = calculate_fext(short, short, stackup)
        fext_long = calculate_fext(long, long, stackup)
        assert fext_long.coefficient > fext_short.coefficient

    def test_next_coefficient_bounds(self):
        """NEXT coefficient should be between 0 and 1."""
        stackup = StackupInfo(h=0.2, er=4.3)
        geom = TraceGeometry(width=0.15, parallel_length=50.0, separation=0.2)
        result = calculate_next(geom, geom, stackup)
        assert 0.0 <= result.coefficient <= 1.0

    def test_crosstalk_db_negative(self):
        """Crosstalk in dB should be negative (attenuation)."""
        stackup = StackupInfo(h=0.2, er=4.3)
        geom = TraceGeometry(width=0.15, parallel_length=50.0, separation=0.3)
        next_result = calculate_next(geom, geom, stackup)
        if next_result.coefficient > 0:
            assert next_result.coefficient_db < 0


# ---------------------------------------------------------------------------
# Thermal tests
# ---------------------------------------------------------------------------

class TestTraceCurrentCapacity:
    """Test trace current capacity against IPC-2152 values."""

    def test_1oz_external_10c_rise(self):
        """1oz external copper, 10C rise: IPC-2152 reference values.

        For a 0.25mm (10mil) wide, 1oz (0.035mm) external trace with 10C rise,
        expected capacity is roughly 0.5-1.0 A.
        """
        current = trace_current_capacity(
            width=0.254,  # 10 mil
            thickness=0.035,  # 1 oz
            temp_rise=10.0,
            internal=False,
        )
        assert 0.3 < current < 2.0, f"Expected ~0.5-1A for 10mil 1oz, got {current:.2f}A"

    def test_wider_trace_more_current(self):
        """Wider traces should carry more current."""
        narrow = trace_current_capacity(width=0.2, thickness=0.035, temp_rise=10.0)
        wide = trace_current_capacity(width=1.0, thickness=0.035, temp_rise=10.0)
        assert wide > narrow

    def test_higher_temp_rise_more_current(self):
        """Higher temperature budget allows more current."""
        low_rise = trace_current_capacity(width=0.3, thickness=0.035, temp_rise=5.0)
        high_rise = trace_current_capacity(width=0.3, thickness=0.035, temp_rise=30.0)
        assert high_rise > low_rise

    def test_internal_less_than_external(self):
        """Internal layers carry less current than external (less cooling)."""
        external = trace_current_capacity(
            width=0.5, thickness=0.035, temp_rise=10.0, internal=False,
        )
        internal = trace_current_capacity(
            width=0.5, thickness=0.035, temp_rise=10.0, internal=True,
        )
        assert internal < external

    def test_2oz_more_than_1oz(self):
        """2oz copper should carry more current than 1oz."""
        one_oz = trace_current_capacity(width=0.5, thickness=0.035, temp_rise=10.0)
        two_oz = trace_current_capacity(width=0.5, thickness=0.070, temp_rise=10.0)
        assert two_oz > one_oz

    def test_known_ipc2152_reference(self):
        """Cross-check against IPC-2152 chart values.

        For external, 1oz copper, 1mm wide trace, 20C rise:
        IPC-2152 indicates approximately 2-3 A.
        """
        current = trace_current_capacity(
            width=1.0, thickness=0.035, temp_rise=20.0, internal=False,
        )
        assert 1.0 < current < 5.0, f"Expected ~2-3A, got {current:.2f}A"

    def test_zero_width_returns_zero(self):
        assert trace_current_capacity(width=0.0, thickness=0.035, temp_rise=10.0) == 0.0


class TestViaCurrentCapacity:
    """Test via current capacity."""

    def test_standard_via(self):
        """Standard 0.3mm drill via with 25um plating."""
        current = via_current_capacity(
            drill=0.3, plating_thickness=0.025, length=1.6, temp_rise=10.0,
        )
        assert current > 0
        # A standard via typically handles 0.5-1.5A
        assert 0.1 < current < 5.0, f"Expected 0.5-1.5A for std via, got {current:.2f}A"

    def test_larger_via_more_current(self):
        """Larger via should carry more current."""
        small = via_current_capacity(drill=0.2, plating_thickness=0.025)
        large = via_current_capacity(drill=0.8, plating_thickness=0.025)
        assert large > small


class TestThermalResistance:
    """Test thermal resistance calculations."""

    def test_basic_calculation(self):
        """Basic thermal resistance calculation."""
        r_th = thermal_resistance_trace(
            width=1.0, length=10.0, thickness=0.035,
        )
        assert r_th > 0
        assert math.isfinite(r_th)

    def test_longer_trace_higher_resistance(self):
        """Longer traces have higher thermal resistance."""
        short = thermal_resistance_trace(width=0.5, length=5.0, thickness=0.035)
        long = thermal_resistance_trace(width=0.5, length=50.0, thickness=0.035)
        assert long > short

    def test_wider_trace_lower_resistance(self):
        """Wider traces have lower thermal resistance."""
        narrow = thermal_resistance_trace(width=0.2, length=10.0, thickness=0.035)
        wide = thermal_resistance_trace(width=2.0, length=10.0, thickness=0.035)
        assert wide < narrow

    def test_zero_returns_inf(self):
        assert thermal_resistance_trace(width=0, length=10.0, thickness=0.035) == float('inf')


# ---------------------------------------------------------------------------
# Z3 Constraint solver tests
# ---------------------------------------------------------------------------

class TestConstraintSolver:
    """Test Z3-based constraint solver."""

    def test_length_matching_satisfied(self):
        """All nets within tolerance should satisfy constraint."""
        solver = ConstraintSolver()
        net_lengths = {
            "D0": 50.0,
            "D1": 50.3,
            "D2": 49.8,
            "D3": 50.1,
        }
        groups = [
            LengthGroup(
                name="DATA_BUS",
                nets=["D0", "D1", "D2", "D3"],
                tolerance=0.5,
            ),
        ]
        result = solver.verify_length_matching(net_lengths, groups)
        assert result.satisfied
        assert len(result.violations) == 0

    def test_length_matching_violated(self):
        """Net far from target should fail."""
        solver = ConstraintSolver()
        net_lengths = {
            "D0": 50.0,
            "D1": 50.2,
            "D2": 45.0,  # 5mm off from max
            "D3": 50.1,
        }
        groups = [
            LengthGroup(
                name="DATA_BUS",
                nets=["D0", "D1", "D2", "D3"],
                tolerance=0.5,
            ),
        ]
        result = solver.verify_length_matching(net_lengths, groups)
        assert not result.satisfied
        assert len(result.violations) > 0
        # D2 should be identified as violating
        d2_violation = any("D2" in v.message for v in result.violations)
        assert d2_violation

    def test_length_matching_with_target(self):
        """Length matching against a specific target length."""
        solver = ConstraintSolver()
        net_lengths = {
            "CLK": 48.0,  # 2mm short of target
        }
        groups = [
            LengthGroup(
                name="CLOCK",
                nets=["CLK"],
                target_length=50.0,
                tolerance=0.5,
            ),
        ]
        result = solver.verify_length_matching(net_lengths, groups)
        assert not result.satisfied

    def test_diff_pair_skew_ok(self):
        """Differential pair within skew tolerance."""
        solver = ConstraintSolver()
        pair = DiffPair(
            name="USB_DP_DN",
            positive_net=Net("USB_DP"),
            negative_net=Net("USB_DN"),
            max_skew=0.1,
        )
        result = solver.verify_diff_pair_skew(pair, pos_length=50.0, neg_length=50.05)
        assert result.satisfied

    def test_diff_pair_skew_violated(self):
        """Differential pair exceeding skew tolerance."""
        solver = ConstraintSolver()
        pair = DiffPair(
            name="USB_DP_DN",
            positive_net=Net("USB_DP"),
            negative_net=Net("USB_DN"),
            max_skew=0.1,
        )
        result = solver.verify_diff_pair_skew(pair, pos_length=50.0, neg_length=50.5)
        assert not result.satisfied
        assert len(result.violations) == 1
        assert "skew" in result.violations[0].message.lower()

    def test_timing_constraints_satisfied(self):
        """All signals within timing budget."""
        solver = ConstraintSolver()
        delays = {
            "D0": 500.0,  # ps
            "D1": 505.0,
            "D2": 498.0,
            "D3": 502.0,
        }
        result = solver.verify_timing_constraints(
            delays=delays,
            max_delay=600.0,
            max_skew=20.0,
        )
        assert result.satisfied

    def test_timing_constraints_delay_exceeded(self):
        """Signal exceeding max delay."""
        solver = ConstraintSolver()
        delays = {
            "D0": 500.0,
            "D1": 700.0,  # exceeds 600ps max
        }
        result = solver.verify_timing_constraints(
            delays=delays,
            max_delay=600.0,
            max_skew=20.0,
        )
        assert not result.satisfied
        delay_violation = any("delay" in v.constraint_name for v in result.violations)
        assert delay_violation

    def test_timing_constraints_skew_exceeded(self):
        """Skew between signals exceeding tolerance."""
        solver = ConstraintSolver()
        delays = {
            "D0": 500.0,
            "D1": 550.0,  # 50ps skew > 20ps max
        }
        result = solver.verify_timing_constraints(
            delays=delays,
            max_delay=600.0,
            max_skew=20.0,
        )
        assert not result.satisfied

    def test_empty_delays_satisfies(self):
        """Empty delays dict should trivially satisfy."""
        solver = ConstraintSolver()
        result = solver.verify_timing_constraints(
            delays={},
            max_delay=600.0,
            max_skew=20.0,
        )
        assert result.satisfied
