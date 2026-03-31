"""Intent DSL models for LLM-to-solver communication.

Defines PlacementIntent and RoutingIntent: the contracts between the LLM
intelligence layer and the C++ solver. The LLM emits intent (no coordinates),
the solver produces coordinates.

These models contain ONLY component references, net names, layer names, and
constraints -- never coordinates or geometry.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Placement Intent Models
# ---------------------------------------------------------------------------


class ClusteringIntent(BaseModel):
    """How components in a zone should be clustered."""

    strategy: Literal[
        "minimize_loop_area",
        "minimize_trace_length",
        "thermal_spread",
        "functional_group",
    ]
    anchor_component: str = Field(description="Reference designator of the anchor component")
    max_spread_mm: float = Field(
        ge=1.0, le=500.0, description="Maximum spread radius in mm"
    )
    orientation_preference: str | None = Field(
        default=None, description="Preferred orientation (e.g. 'horizontal', 'vertical')"
    )


class ThermalIntent(BaseModel):
    """Thermal constraints for a placement zone."""

    max_junction_temp_c: float = Field(
        ge=-40, le=200, description="Maximum junction temperature in Celsius"
    )
    keepout_radius_mm: float = Field(
        ge=0, le=50, default=0, description="Thermal keepout radius in mm"
    )
    requires_thermal_vias: bool = Field(
        default=False, description="Whether thermal vias are required"
    )
    copper_pour_layers: list[str] = Field(
        default_factory=list, description="Layers requiring copper pour for heat spreading"
    )
    airflow_direction: Literal[
        "left_to_right", "right_to_left", "bottom_to_top", "top_to_bottom"
    ] | None = Field(default=None, description="Expected airflow direction over this zone")


class PowerPlaneIntent(BaseModel):
    """Power plane requirements for a zone."""

    voltage_rail: str = Field(description="Voltage rail name (e.g. '3V3', '1V8')")
    target_voltage_drop_mv: float = Field(
        ge=0, le=500, description="Target maximum voltage drop in mV"
    )
    min_copper_area_mm2: float = Field(
        ge=0, default=0, description="Minimum copper area in mm^2"
    )


class PlacementZone(BaseModel):
    """A functional zone with components and constraints.

    Groups related components and specifies how the solver should
    arrange them relative to each other.
    """

    zone_id: str = Field(description="Unique zone identifier")
    zone_type: Literal[
        "functional_group",
        "power_stage",
        "high_speed",
        "analog",
        "digital",
        "rf",
        "connector",
    ] = Field(description="Functional type of this zone")
    components: list[str] = Field(
        min_length=1, description="Reference designators of components in this zone"
    )
    clustering: ClusteringIntent | None = Field(
        default=None, description="Clustering strategy for components in this zone"
    )
    thermal: ThermalIntent | None = Field(
        default=None, description="Thermal constraints for this zone"
    )
    power_plane: PowerPlaneIntent | None = Field(
        default=None, description="Power plane requirements for this zone"
    )


class CriticalPair(BaseModel):
    """A pair of components with a distance constraint."""

    component_a: str = Field(description="First component reference designator")
    component_b: str = Field(description="Second component reference designator")
    constraint: Literal[
        "minimize_distance", "decoupling", "differential", "thermal_separation"
    ] = Field(description="Type of distance constraint")
    max_distance_mm: float = Field(
        ge=0, le=500, description="Maximum allowed distance in mm"
    )
    reason: str = Field(description="Human-readable reason for this constraint")


class KeepoutIntent(BaseModel):
    """Area where certain components must not be placed."""

    type: Literal["thermal", "mechanical", "electrical", "rf"] = Field(
        description="Reason for the keepout"
    )
    source_component: str | None = Field(
        default=None, description="Component generating the keepout (if any)"
    )
    radius_mm: float = Field(
        ge=0, le=100, default=0, description="Keepout radius in mm"
    )
    excluded_components: list[str] = Field(
        default_factory=list,
        description="Components that must not be placed in this keepout",
    )
    reason: str = Field(description="Human-readable reason for this keepout")


class GroundPlaneIntent(BaseModel):
    """Ground/power plane requirement."""

    layer: str = Field(description="Layer name (e.g. 'In1.Cu')")
    type: Literal["solid_pour", "hatched", "split_plane"] = Field(
        description="Plane fill type"
    )
    net: str = Field(description="Net name for the plane (e.g. 'GND', 'VCC')")
    split_allowed: bool = Field(
        default=True, description="Whether the plane may be split by routing"
    )
    reason: str = Field(description="Human-readable reason for this plane requirement")


class PlacementIntent(BaseModel):
    """Complete placement intent emitted by LLM for the C++ placement solver.

    Contains NO coordinates -- only component references, zone types, and
    constraints. The solver is responsible for computing actual positions.
    """

    schema_version: str = Field(
        default="routeai/placement-intent/v1",
        description="Schema version identifier",
    )
    board_id: str = Field(default="", description="Board design identifier")
    zones: list[PlacementZone] = Field(
        default_factory=list, description="Functional placement zones"
    )
    critical_pairs: list[CriticalPair] = Field(
        default_factory=list, description="Component pairs with distance constraints"
    )
    keepouts: list[KeepoutIntent] = Field(
        default_factory=list, description="Placement keepout areas"
    )
    ground_planes: list[GroundPlaneIntent] = Field(
        default_factory=list, description="Ground/power plane requirements"
    )


# ---------------------------------------------------------------------------
# Routing Intent Models
# ---------------------------------------------------------------------------


class ImpedanceTarget(BaseModel):
    """Impedance requirement for a net class."""

    type: Literal["single_ended", "differential"] = Field(
        description="Impedance type"
    )
    target_ohm: float = Field(
        ge=20, le=150, description="Target impedance in ohms"
    )
    tolerance_percent: float = Field(
        ge=1, le=30, default=10, description="Impedance tolerance in percent"
    )
    coupling_gap_mm: float | None = Field(
        default=None, description="Coupling gap for differential pairs in mm"
    )


class LengthMatchingIntent(BaseModel):
    """Length matching constraint for a group of nets."""

    group: str = Field(description="Length matching group name")
    max_skew_mm: float = Field(
        ge=0, le=50, description="Maximum length skew in mm"
    )
    reference_net: str | None = Field(
        default=None, description="Net to use as length reference (longest if None)"
    )


class ViaStrategyIntent(BaseModel):
    """Via usage rules for a net class."""

    type: Literal["through", "blind_microvia", "buried", "any"] = Field(
        default="through", description="Allowed via type"
    )
    max_vias_per_net: int = Field(
        ge=0, le=50, default=10, description="Maximum number of vias per net"
    )
    via_size_mm: float = Field(
        ge=0.1, le=1.0, default=0.3, description="Via outer diameter in mm"
    )


class DiffPairIntent(BaseModel):
    """Differential pair routing constraints."""

    max_intra_pair_skew_mm: float = Field(
        ge=0, le=10, description="Maximum skew within the pair in mm"
    )
    max_parallel_length_mm: float = Field(
        ge=0, default=1000, description="Maximum parallel routing length in mm"
    )
    min_spacing_to_other_diff_mm: float = Field(
        ge=0, default=0.5, description="Minimum spacing to other differential pairs in mm"
    )


class NetClassIntent(BaseModel):
    """Routing rules for a group of nets.

    Defines impedance, width, clearance, layer preferences, and other
    routing constraints for a named group of nets.
    """

    name: str = Field(description="Net class name")
    nets: list[str] = Field(
        min_length=1, description="Net names belonging to this class"
    )
    impedance: ImpedanceTarget | None = Field(
        default=None, description="Impedance requirement"
    )
    width_mm: float = Field(
        ge=0.05, le=10.0, default=0.15, description="Trace width in mm"
    )
    clearance_mm: float = Field(
        ge=0.05, le=10.0, default=0.15, description="Minimum clearance in mm"
    )
    layer_preference: list[str] = Field(
        default_factory=list, description="Preferred routing layers"
    )
    length_matching: LengthMatchingIntent | None = Field(
        default=None, description="Length matching constraint"
    )
    via_strategy: ViaStrategyIntent | None = Field(
        default=None, description="Via usage rules"
    )
    differential_pair: DiffPairIntent | None = Field(
        default=None, description="Differential pair constraints"
    )
    routing_priority: int = Field(
        ge=1, le=100, default=50, description="Routing priority (1=highest)"
    )
    max_total_length_mm: float | None = Field(
        default=None, description="Maximum total trace length in mm"
    )


class RoutingOrderEntry(BaseModel):
    """Priority entry in the routing order."""

    priority: int = Field(
        ge=1, le=100, description="Routing priority (1=first)"
    )
    net_class: str = Field(description="Net class name to route at this priority")
    reason: str = Field(description="Human-readable reason for this priority")


class LayerTransitionIntent(BaseModel):
    """Rules for layer changes during routing."""

    max_layer_changes_per_net: int = Field(
        ge=0, le=20, default=4, description="Maximum layer changes per net"
    )
    preferred_via_layers: list[list[str]] = Field(
        default_factory=list,
        description="Preferred layer pairs for vias (e.g. [['F.Cu', 'In1.Cu']])",
    )


class LayerAssignmentIntent(BaseModel):
    """Layer usage plan for routing."""

    signal_layers: list[str] = Field(
        min_length=1, description="Layers available for signal routing"
    )
    reference_planes: dict[str, str] = Field(
        default_factory=dict,
        description="Mapping of signal layer to its reference plane (e.g. {'F.Cu': 'In1.Cu'})",
    )
    layer_transitions: LayerTransitionIntent | None = Field(
        default=None, description="Layer transition rules"
    )


class CostWeights(BaseModel):
    """Cost function weights for the routing algorithm.

    These weights tune the router's optimization objective.
    """

    via_cost: float = Field(
        ge=0, le=100, default=10.0, description="Cost per via"
    )
    layer_change_cost: float = Field(
        ge=0, le=100, default=8.0, description="Cost per layer change"
    )
    length_cost: float = Field(
        ge=0, le=100, default=1.0, description="Cost per mm of trace length"
    )
    congestion_cost: float = Field(
        ge=0, le=100, default=5.0, description="Cost for routing in congested areas"
    )
    reference_plane_violation_cost: float = Field(
        ge=0, le=1000, default=100.0,
        description="Cost for routing without a continuous reference plane",
    )


class VoltageDropTarget(BaseModel):
    """Voltage drop budget for a power net."""

    net: str = Field(description="Power net name")
    source_component: str = Field(description="Source component reference designator")
    sink_components: list[str] = Field(
        min_length=1, description="Sink component reference designators"
    )
    max_drop_mv: float = Field(
        ge=0, le=1000, description="Maximum allowed voltage drop in mV"
    )
    max_current_a: float = Field(
        ge=0, le=100, description="Maximum expected current in amps"
    )
    min_trace_width_mm: float = Field(
        ge=0.05, le=10.0, description="Minimum trace width for this power net in mm"
    )


class RoutingIntent(BaseModel):
    """Complete routing intent emitted by LLM for the C++ routing solver.

    Contains NO coordinates -- only net names, constraints, and strategy.
    The solver is responsible for computing actual trace paths.
    """

    schema_version: str = Field(
        default="routeai/routing-intent/v1",
        description="Schema version identifier",
    )
    board_id: str = Field(default="", description="Board design identifier")
    net_classes: list[NetClassIntent] = Field(
        default_factory=list, description="Net class routing rules"
    )
    routing_order: list[RoutingOrderEntry] = Field(
        default_factory=list, description="Ordered routing priorities"
    )
    layer_assignment: LayerAssignmentIntent | None = Field(
        default=None, description="Layer usage plan"
    )
    cost_weights: CostWeights = Field(
        default_factory=CostWeights, description="Router cost function weights"
    )
    voltage_drop_targets: list[VoltageDropTarget] = Field(
        default_factory=list, description="Power net voltage drop budgets"
    )
