"""Copper fill quality and thermal analysis for PCB layers.

Assesses copper fill coverage, thermal relief effectiveness, and
heat spreading capacity of copper planes and thermal pads.

References:
    - IPC-2221B for thermal relief design
    - Kirchhoff heat spreading model for PCB thermal analysis
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from shapely.geometry import Point as ShapelyPoint
from shapely.ops import unary_union

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    LayerType,
    Pad,
    StackupLayer,
    Trace,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COPPER_THERMAL_CONDUCTIVITY = 385.0  # W/(m*K)
FR4_THERMAL_CONDUCTIVITY = 0.25  # W/(m*K)
COPPER_DENSITY = 8960.0  # kg/m^3


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class LayerFillResult:
    """Copper fill quality result for a single layer."""

    layer_name: str
    total_area_mm2: float
    copper_area_mm2: float
    fill_percentage: float
    void_count: int
    largest_void_mm2: float
    zone_count: int
    trace_count: int
    assessment: str  # "good", "acceptable", "poor"
    notes: list[str] = field(default_factory=list)


@dataclass
class ThermalReliefResult:
    """Thermal relief analysis for a pad connection."""

    pad_ref: str
    pad_location: tuple[float, float]
    layer: str
    net_name: str
    has_thermal_relief: bool
    spoke_count: int
    spoke_width_mm: float
    gap_width_mm: float
    thermal_resistance_k_per_w: float
    solderability_score: float  # 0-1, higher is better
    assessment: str  # "good", "too_restrictive", "insufficient"
    notes: str = ""


@dataclass
class HeatSpreadResult:
    """Heat spreading analysis for a thermal pad or component."""

    component_ref: str
    location: tuple[float, float]
    layer: str
    pad_area_mm2: float
    effective_spread_area_mm2: float
    thermal_resistance_to_ambient: float  # K/W
    max_power_dissipation_w: float  # for a given temp rise
    copper_connected_area_mm2: float
    via_count: int
    assessment: str
    notes: str = ""


@dataclass
class CopperReport:
    """Complete copper analysis report."""

    layer_fills: list[LayerFillResult] = field(default_factory=list)
    thermal_reliefs: list[ThermalReliefResult] = field(default_factory=list)
    heat_spreads: list[HeatSpreadResult] = field(default_factory=list)
    overall_fill_pct: float = 0.0
    summary: str = ""


# ---------------------------------------------------------------------------
# Copper Analyzer
# ---------------------------------------------------------------------------

class CopperAnalyzer:
    """Analyzes copper fill quality, thermal reliefs, and heat spreading.

    Args:
        min_fill_pct: Minimum acceptable copper fill percentage per layer.
        max_temp_rise_c: Maximum acceptable temperature rise for thermal analysis.
        ambient_temp_c: Ambient temperature for thermal calculations.
    """

    def __init__(
        self,
        min_fill_pct: float = 40.0,
        max_temp_rise_c: float = 40.0,
        ambient_temp_c: float = 25.0,
    ) -> None:
        self.min_fill_pct = min_fill_pct
        self.max_temp_rise_c = max_temp_rise_c
        self.ambient_temp_c = ambient_temp_c

    def _analyze_layer_fill(
        self,
        board: BoardDesign,
        layer: Layer,
    ) -> LayerFillResult:
        """Assess copper fill coverage for a single layer."""
        # Calculate total board area
        if board.outline is not None and not board.outline.is_empty:
            total_area = board.outline.area
        else:
            # Estimate from component/trace extents
            all_x: list[float] = []
            all_y: list[float] = []
            for trace in board.traces:
                for seg in trace.segments:
                    all_x.extend([seg.start_x, seg.end_x])
                    all_y.extend([seg.start_y, seg.end_y])
            for pad in board.pads:
                all_x.append(pad.x)
                all_y.append(pad.y)
            if all_x and all_y:
                total_area = (max(all_x) - min(all_x)) * (max(all_y) - min(all_y))
            else:
                total_area = 100.0 * 100.0  # default

        # Collect all copper features on this layer
        copper_polys = []

        # Zones
        layer_zones = [
            z for z in board.zones
            if z.layer == layer or z.layer.name == layer.name
        ]
        for zone in layer_zones:
            poly = zone.to_shapely()
            if not poly.is_empty:
                copper_polys.append(poly)

        # Traces
        layer_traces = board.traces_on_layer(layer)
        for trace in layer_traces:
            poly = trace.to_shapely()
            if poly is not None and not poly.is_empty:
                copper_polys.append(poly)

        # Pads
        layer_pads = board.pads_on_layer(layer)
        for pad in layer_pads:
            poly = pad.to_shapely()
            if not poly.is_empty:
                copper_polys.append(poly)

        # Compute union and area
        if copper_polys:
            copper_union = unary_union(copper_polys)
            copper_area = copper_union.area

            # Count voids (holes in the copper)
            # Voids are internal rings of the copper union
            void_count = 0
            largest_void = 0.0
            if hasattr(copper_union, 'interiors'):
                void_count = len(list(copper_union.interiors))
                for interior in copper_union.interiors:
                    from shapely.geometry import Polygon
                    void_area = Polygon(interior).area
                    largest_void = max(largest_void, void_area)
            elif hasattr(copper_union, 'geoms'):
                # MultiPolygon: sum voids from all polygons
                for geom in copper_union.geoms:
                    if hasattr(geom, 'interiors'):
                        for interior in geom.interiors:
                            from shapely.geometry import Polygon
                            void_area = Polygon(interior).area
                            void_count += 1
                            largest_void = max(largest_void, void_area)
        else:
            copper_area = 0.0
            void_count = 0
            largest_void = 0.0

        fill_pct = (copper_area / total_area * 100.0) if total_area > 0 else 0.0

        # Assessment
        notes: list[str] = []
        if fill_pct >= 60:
            assessment = "good"
        elif fill_pct >= self.min_fill_pct:
            assessment = "acceptable"
            notes.append(f"Fill is below 60%, consider adding copper pours")
        else:
            assessment = "poor"
            notes.append(
                f"Fill {fill_pct:.1f}% is below minimum {self.min_fill_pct}%. "
                f"Poor copper balance may cause board warping."
            )

        if void_count > 10:
            notes.append(f"{void_count} voids detected; may indicate fill issues")

        if largest_void > total_area * 0.1:
            notes.append(
                f"Largest void ({largest_void:.1f}mm^2) is >{10}% of board area"
            )

        return LayerFillResult(
            layer_name=layer.name,
            total_area_mm2=total_area,
            copper_area_mm2=copper_area,
            fill_percentage=fill_pct,
            void_count=void_count,
            largest_void_mm2=largest_void,
            zone_count=len(layer_zones),
            trace_count=len(layer_traces),
            assessment=assessment,
            notes=notes,
        )

    def _analyze_thermal_reliefs(
        self,
        board: BoardDesign,
    ) -> list[ThermalReliefResult]:
        """Analyze thermal relief connections for through-hole pads.

        Thermal reliefs reduce the thermal connection between a pad
        and a copper plane to improve solderability while maintaining
        sufficient thermal conductance.
        """
        results: list[ThermalReliefResult] = []

        for pad in board.pads:
            if not pad.is_through_hole:
                continue

            # Check if pad is connected to a zone (copper pour)
            pad_point = ShapelyPoint(pad.x, pad.y)

            for zone in board.zones:
                if zone.net != pad.net:
                    continue
                if zone.layer != pad.layer and zone.layer.name != pad.layer.name:
                    continue

                zone_poly = zone.to_shapely()
                if zone_poly.is_empty:
                    continue

                pad_poly = pad.to_shapely()
                if not zone_poly.intersects(pad_poly):
                    continue

                # This pad connects to a zone -- analyze the thermal relief
                # Standard thermal relief: 4 spokes, spoke width = trace width,
                # gap width = zone clearance

                # Default thermal relief parameters (estimated)
                spoke_count = 4
                spoke_width = board.design_rules.min_trace_width * 2
                gap_width = zone.clearance

                # Thermal resistance through the spokes
                # Each spoke is a short trace from pad to plane
                spoke_length = gap_width + pad.width / 2.0
                if spoke_width > 0 and spoke_length > 0:
                    # Thermal resistance per spoke
                    cu_thick = 0.035  # assume 1oz
                    area_per_spoke = spoke_width * cu_thick * 1e-6  # m^2
                    length_m = spoke_length * 1e-3
                    r_spoke = length_m / (COPPER_THERMAL_CONDUCTIVITY * area_per_spoke)
                    # Parallel combination of all spokes
                    r_thermal = r_spoke / spoke_count
                else:
                    r_thermal = float("inf")

                # Solderability score: wider gaps = easier soldering
                # Good: gap >= 0.3mm, spoke_count <= 4
                solderability = min(1.0, gap_width / 0.5) * min(1.0, 4.0 / max(spoke_count, 1))

                # Assessment
                if r_thermal < 50:
                    assessment = "good"
                    notes = "Thermal relief provides adequate heat sinking"
                elif r_thermal < 200:
                    assessment = "too_restrictive"
                    notes = (
                        f"Thermal resistance {r_thermal:.0f}K/W may limit "
                        f"heat dissipation. Consider wider spokes."
                    )
                else:
                    assessment = "insufficient"
                    notes = (
                        f"Thermal resistance {r_thermal:.0f}K/W is very high. "
                        f"Pad may overheat. Consider direct connection or more spokes."
                    )

                if solderability < 0.5:
                    assessment = "too_restrictive"
                    notes += " Solderability may be poor -- gap too narrow."

                results.append(ThermalReliefResult(
                    pad_ref=pad.component_ref or f"pad@({pad.x:.1f},{pad.y:.1f})",
                    pad_location=(pad.x, pad.y),
                    layer=pad.layer.name,
                    net_name=pad.net.name,
                    has_thermal_relief=True,
                    spoke_count=spoke_count,
                    spoke_width_mm=spoke_width,
                    gap_width_mm=gap_width,
                    thermal_resistance_k_per_w=r_thermal,
                    solderability_score=solderability,
                    assessment=assessment,
                    notes=notes,
                ))

        return results

    def _analyze_heat_spreading(
        self,
        board: BoardDesign,
        stackup: list[StackupLayer],
    ) -> list[HeatSpreadResult]:
        """Analyze heat spreading from thermal pads.

        Identifies exposed pads (thermal pads on the bottom of ICs)
        and evaluates the effectiveness of the copper spreading and
        thermal via array beneath them.
        """
        results: list[HeatSpreadResult] = []

        # Find large pads that are likely thermal pads
        thermal_pads = [
            p for p in board.pads
            if p.width >= 2.0 and p.height >= 2.0  # >2mm pads
        ]

        board_thickness = sum(sl.thickness_mm for sl in stackup) if stackup else 1.6

        for pad in thermal_pads:
            pad_area = pad.width * pad.height

            # Count thermal vias under this pad
            nearby_vias = [
                v for v in board.vias
                if math.sqrt((v.x - pad.x)**2 + (v.y - pad.y)**2) < max(pad.width, pad.height) / 2.0
            ]
            via_count = len(nearby_vias)

            # Estimate copper connected area on the opposite side
            pad_point = ShapelyPoint(pad.x, pad.y)
            connected_copper = 0.0

            for zone in board.zones:
                zone_poly = zone.to_shapely()
                if zone_poly.is_empty:
                    continue
                # Check for copper on any layer near the pad projection
                pad_footprint = pad_point.buffer(max(pad.width, pad.height))
                intersection = zone_poly.intersection(pad_footprint)
                if not intersection.is_empty:
                    connected_copper += intersection.area

            # Thermal resistance calculation
            # Through-board: R = thickness / (k * A_effective)
            # Effective area depends on thermal vias
            if via_count > 0:
                # Each via provides a thermal path
                via_area_per = math.pi * (0.3**2 - 0.15**2)  # typical via dimensions
                total_via_area = via_count * via_area_per
                # Parallel: copper + FR4 paths
                r_via = (board_thickness * 1e-3) / (COPPER_THERMAL_CONDUCTIVITY * total_via_area * 1e-6)
                r_fr4 = (board_thickness * 1e-3) / (FR4_THERMAL_CONDUCTIVITY * pad_area * 1e-6)
                r_total = 1.0 / (1.0 / r_via + 1.0 / r_fr4)
            else:
                # FR4 only
                r_total = (board_thickness * 1e-3) / (FR4_THERMAL_CONDUCTIVITY * pad_area * 1e-6)

            # Add convection resistance on the bottom side
            # h ~ 10 W/(m^2*K) for natural convection
            spread_area = max(pad_area, connected_copper) * 1e-6  # m^2
            if spread_area > 0:
                r_conv = 1.0 / (10.0 * spread_area)
            else:
                r_conv = 100.0

            r_ambient = r_total + r_conv

            # Maximum power for temp rise budget
            max_power = self.max_temp_rise_c / r_ambient if r_ambient > 0 else 0.0

            # Assessment
            if via_count >= 9 and r_ambient < 30:
                assessment = "good"
                notes = f"{via_count} thermal vias, R_th={r_ambient:.1f}K/W"
            elif via_count >= 4 and r_ambient < 60:
                assessment = "acceptable"
                notes = (
                    f"{via_count} thermal vias, R_th={r_ambient:.1f}K/W. "
                    f"Consider adding more vias for improved thermal performance."
                )
            elif via_count > 0:
                assessment = "marginal"
                notes = (
                    f"Only {via_count} thermal vias, R_th={r_ambient:.1f}K/W. "
                    f"Recommend >= 9 vias in a 3x3 array under the thermal pad."
                )
            else:
                assessment = "poor"
                notes = (
                    f"No thermal vias under {pad_area:.1f}mm^2 thermal pad! "
                    f"R_th={r_ambient:.1f}K/W (FR4 only). "
                    f"Add thermal via array for adequate heat dissipation."
                )

            results.append(HeatSpreadResult(
                component_ref=pad.component_ref or f"pad@({pad.x:.1f},{pad.y:.1f})",
                location=(pad.x, pad.y),
                layer=pad.layer.name,
                pad_area_mm2=pad_area,
                effective_spread_area_mm2=max(pad_area, connected_copper),
                thermal_resistance_to_ambient=r_ambient,
                max_power_dissipation_w=max_power,
                copper_connected_area_mm2=connected_copper,
                via_count=via_count,
                assessment=assessment,
                notes=notes,
            ))

        return results

    def analyze(
        self,
        board: BoardDesign,
        stackup: Optional[list[StackupLayer]] = None,
    ) -> CopperReport:
        """Run complete copper analysis.

        Args:
            board: Board design to analyze.
            stackup: Stackup layers. Uses board.stackup if None.

        Returns:
            CopperReport with fill quality, thermal relief, and
            heat spreading results.
        """
        if stackup is None:
            stackup = board.stackup

        report = CopperReport()

        # Layer fill analysis
        copper_layers = board.copper_layers()
        total_fill = 0.0

        for layer in copper_layers:
            fill_result = self._analyze_layer_fill(board, layer)
            report.layer_fills.append(fill_result)
            total_fill += fill_result.fill_percentage

        if copper_layers:
            report.overall_fill_pct = total_fill / len(copper_layers)

        # Thermal relief analysis
        report.thermal_reliefs = self._analyze_thermal_reliefs(board)

        # Heat spreading analysis
        report.heat_spreads = self._analyze_heat_spreading(board, stackup)

        # Summary
        poor_layers = sum(1 for f in report.layer_fills if f.assessment == "poor")
        poor_thermal = sum(
            1 for t in report.thermal_reliefs if t.assessment == "insufficient"
        )
        poor_heat = sum(1 for h in report.heat_spreads if h.assessment == "poor")

        report.summary = (
            f"Copper analysis: {len(report.layer_fills)} layers "
            f"(avg fill {report.overall_fill_pct:.1f}%), "
            f"{len(report.thermal_reliefs)} thermal reliefs, "
            f"{len(report.heat_spreads)} thermal pads. "
            f"Issues: {poor_layers} poor fill layers, "
            f"{poor_thermal} insufficient thermal reliefs, "
            f"{poor_heat} inadequate thermal pads."
        )

        return report
