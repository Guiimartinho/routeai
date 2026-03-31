"""Bridge between LLM Intent DSL and solver/router parameters.

Converts PlacementIntent and RoutingIntent (Pydantic models) into
dictionaries matching the protobuf message format for the C++ router,
and into solver-compatible constraint objects.

All functions are pure -- no I/O, no side effects, no network calls.
Dict keys match protobuf field names from routing.proto where applicable.

Proto reference (routing.proto):
    RoutingRequest { board, net_ids, strategy, max_iterations, grid_resolution }
    BoardState     { outline, layers, components, nets, traces, vias, zones, constraints }
    Constraint     { type, value, net_ids, layer_ids }
    RoutingStrategy: AUTO=0, GLOBAL_FIRST=1, DIRECT_ASTAR=2, LEE_MAZE=3
    Constraint.Type: MIN_TRACE_WIDTH=0, MAX_TRACE_WIDTH=1, MIN_CLEARANCE=2,
                     MIN_VIA_DRILL=3, MIN_VIA_ANNULAR=4, DIFF_PAIR_GAP=5,
                     DIFF_PAIR_IMPEDANCE=6, MAX_LENGTH=7, MAX_VIA_COUNT=8,
                     LAYER_RESTRICTION=9
"""

from __future__ import annotations

from routeai_core.models.intent import (
    CostWeights,
    NetClassIntent,
    PlacementIntent,
    PlacementZone,
    RoutingIntent,
    VoltageDropTarget,
)

# ---------------------------------------------------------------------------
# Proto enum values (matching routing.proto, avoids depending on generated code)
# ---------------------------------------------------------------------------

STRATEGY_AUTO: int = 0
STRATEGY_GLOBAL_FIRST: int = 1
STRATEGY_DIRECT_ASTAR: int = 2
STRATEGY_LEE_MAZE: int = 3

CONSTRAINT_MIN_TRACE_WIDTH: int = 0
CONSTRAINT_MAX_TRACE_WIDTH: int = 1
CONSTRAINT_MIN_CLEARANCE: int = 2
CONSTRAINT_MIN_VIA_DRILL: int = 3
CONSTRAINT_MIN_VIA_ANNULAR: int = 4
CONSTRAINT_DIFF_PAIR_GAP: int = 5
CONSTRAINT_DIFF_PAIR_IMPEDANCE: int = 6
CONSTRAINT_MAX_LENGTH: int = 7
CONSTRAINT_MAX_VIA_COUNT: int = 8
CONSTRAINT_LAYER_RESTRICTION: int = 9


# ---------------------------------------------------------------------------
# Routing intent -> C++ router parameters (proto-compatible dicts)
# ---------------------------------------------------------------------------


def routing_intent_to_router_params(intent: RoutingIntent) -> dict:
    """Convert RoutingIntent DSL to parameters for the C++ routing server.

    Returns a dict matching the routing.proto ``RoutingRequest`` structure.
    The ``board`` field is intentionally omitted -- it comes from the parsed
    design file, not from the intent.  The caller merges this dict into the
    request alongside the board state.
    """
    strategy = _determine_strategy(intent)

    params: dict = {
        "strategy": strategy,
        "max_iterations": 50,
        "grid_resolution": 0.1,  # mm
        "constraints": _build_proto_constraints(intent),
        "nets": _build_proto_nets(intent),
    }

    # Cost weights are used by the Python orchestration layer to weight the
    # objective when evaluating candidate solutions.  They are not part of
    # the proto RoutingRequest but travel alongside it.
    params["cost_weights"] = _cost_weights_to_dict(intent.cost_weights)

    # Routing order (Python-side scheduling -- the C++ server routes nets
    # in the order they appear in ``net_ids``).
    params["routing_order"] = [
        {"net_class": entry.net_class, "priority": entry.priority}
        for entry in sorted(intent.routing_order, key=lambda e: e.priority)
    ]

    # Layer assignment metadata (consumed by orchestration, not by proto).
    if intent.layer_assignment is not None:
        la = intent.layer_assignment
        layer_dict: dict = {
            "signal_layers": list(la.signal_layers),
            "reference_planes": dict(la.reference_planes),
        }
        if la.layer_transitions is not None:
            layer_dict["max_layer_changes_per_net"] = (
                la.layer_transitions.max_layer_changes_per_net
            )
            layer_dict["preferred_via_layers"] = [
                list(pair) for pair in la.layer_transitions.preferred_via_layers
            ]
        params["layer_assignment"] = layer_dict

    return params


# ---------------------------------------------------------------------------
# Routing intent -> design rules (for Python DRC engine / solver)
# ---------------------------------------------------------------------------


def routing_intent_to_design_rules(intent: RoutingIntent) -> dict:
    """Convert RoutingIntent into design rules for the DRC engine.

    Returns a dict that can be used to populate
    ``routeai_solver.board_model.DesignRules``, ``DiffPair``, and
    ``LengthGroup`` dataclasses.
    """
    rules: dict = {
        "net_classes": [],
        "diff_pairs": [],
        "length_groups": [],
    }

    for nc in intent.net_classes:
        rule: dict = {
            "name": nc.name,
            "nets": list(nc.nets),
            "trace_width_mm": nc.width_mm,
            "clearance_mm": nc.clearance_mm,
        }
        if nc.impedance is not None:
            rule["impedance_ohm"] = nc.impedance.target_ohm
            rule["impedance_type"] = nc.impedance.type
            rule["impedance_tolerance_pct"] = nc.impedance.tolerance_percent
        if nc.via_strategy is not None:
            rule["via_type"] = nc.via_strategy.type
            rule["via_drill_mm"] = nc.via_strategy.via_size_mm
            rule["max_vias_per_net"] = nc.via_strategy.max_vias_per_net
        rules["net_classes"].append(rule)

        # Differential pairs
        if nc.differential_pair is not None and len(nc.nets) >= 2:
            rules["diff_pairs"].append(
                _diff_pair_to_dict(nc)
            )

        # Length matching groups
        if nc.length_matching is not None:
            _merge_length_group(rules["length_groups"], nc)

    return rules


# ---------------------------------------------------------------------------
# Routing intent -> solver Constraint objects (proto-compatible dicts)
# ---------------------------------------------------------------------------


def routing_intent_to_solver_constraints(intent: RoutingIntent) -> list[dict]:
    """Convert RoutingIntent into a flat list of proto ``Constraint`` dicts.

    Each dict matches the ``routing.proto Constraint`` message:
        { "type": int, "value": float, "net_ids": [...], "layer_ids": [...] }

    This is the format the C++ server reads inside ``BoardState.constraints``.
    """
    return _build_proto_constraints(intent)


# ---------------------------------------------------------------------------
# Placement intent -> solver parameters
# ---------------------------------------------------------------------------


def placement_intent_to_solver_params(intent: PlacementIntent) -> dict:
    """Convert PlacementIntent DSL to parameters for the placement solver.

    Returns a dict consumed by the Python placement solver (z3-based or
    force-directed).  No coordinates -- only component references and
    constraint descriptors.
    """
    params: dict = {
        "board_id": intent.board_id,
        "zones": [_zone_to_dict(z) for z in intent.zones],
        "critical_pairs": [
            {
                "component_a": pair.component_a,
                "component_b": pair.component_b,
                "constraint": pair.constraint,
                "max_distance_mm": pair.max_distance_mm,
                "reason": pair.reason,
            }
            for pair in intent.critical_pairs
        ],
        "keepouts": [
            {
                "type": ko.type,
                "source_component": ko.source_component,
                "radius_mm": ko.radius_mm,
                "excluded_components": list(ko.excluded_components),
                "reason": ko.reason,
            }
            for ko in intent.keepouts
        ],
        "ground_planes": [
            {
                "layer": gp.layer,
                "type": gp.type,
                "net": gp.net,
                "split_allowed": gp.split_allowed,
                "reason": gp.reason,
            }
            for gp in intent.ground_planes
        ],
    }
    return params


# ---------------------------------------------------------------------------
# Voltage drop targets -> PI analysis parameters
# ---------------------------------------------------------------------------


def voltage_drops_to_pi_params(targets: list[VoltageDropTarget]) -> list[dict]:
    """Convert voltage drop targets to power-integrity analysis parameters.

    Each dict can be fed to the PI solver (IR-drop / current-density
    analysis).
    """
    return [
        {
            "net": t.net,
            "source_component": t.source_component,
            "sink_components": list(t.sink_components),
            "max_drop_mv": t.max_drop_mv,
            "max_current_a": t.max_current_a,
            "min_trace_width_mm": t.min_trace_width_mm,
        }
        for t in targets
    ]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _determine_strategy(intent: RoutingIntent) -> int:
    """Pick routing strategy enum value based on intent complexity.

    Returns the integer matching ``routing.proto RoutingStrategy``.
    """
    has_diff_pairs = any(nc.differential_pair is not None for nc in intent.net_classes)
    has_length_match = any(nc.length_matching is not None for nc in intent.net_classes)
    has_impedance = any(nc.impedance is not None for nc in intent.net_classes)

    if has_diff_pairs or has_length_match or has_impedance:
        # Complex board: full pipeline (global -> A* -> diff pair -> length match)
        return STRATEGY_AUTO
    return STRATEGY_DIRECT_ASTAR


def _cost_weights_to_dict(cw: CostWeights) -> dict:
    """Serialize CostWeights to a plain dict."""
    return {
        "via_cost": cw.via_cost,
        "layer_change_cost": cw.layer_change_cost,
        "length_cost": cw.length_cost,
        "congestion_cost": cw.congestion_cost,
        "reference_plane_violation_cost": cw.reference_plane_violation_cost,
    }


def _build_proto_constraints(intent: RoutingIntent) -> list[dict]:
    """Build a list of proto-compatible ``Constraint`` dicts from the intent.

    Each constraint is:
        { "type": <int>, "value": <float>, "net_ids": [...], "layer_ids": [...] }

    matching the ``Constraint`` message in routing.proto.
    """
    constraints: list[dict] = []

    for nc in intent.net_classes:
        net_ids = list(nc.nets)

        # MIN_TRACE_WIDTH
        constraints.append({
            "type": CONSTRAINT_MIN_TRACE_WIDTH,
            "value": nc.width_mm,
            "net_ids": net_ids,
            "layer_ids": [],
        })

        # MIN_CLEARANCE
        constraints.append({
            "type": CONSTRAINT_MIN_CLEARANCE,
            "value": nc.clearance_mm,
            "net_ids": net_ids,
            "layer_ids": [],
        })

        # Via constraints
        if nc.via_strategy is not None:
            constraints.append({
                "type": CONSTRAINT_MIN_VIA_DRILL,
                "value": nc.via_strategy.via_size_mm,
                "net_ids": net_ids,
                "layer_ids": [],
            })
            constraints.append({
                "type": CONSTRAINT_MAX_VIA_COUNT,
                "value": float(nc.via_strategy.max_vias_per_net),
                "net_ids": net_ids,
                "layer_ids": [],
            })

        # Impedance
        if nc.impedance is not None:
            if nc.impedance.type == "differential" and nc.impedance.coupling_gap_mm is not None:
                constraints.append({
                    "type": CONSTRAINT_DIFF_PAIR_GAP,
                    "value": nc.impedance.coupling_gap_mm,
                    "net_ids": net_ids,
                    "layer_ids": [],
                })
            constraints.append({
                "type": CONSTRAINT_DIFF_PAIR_IMPEDANCE,
                "value": nc.impedance.target_ohm,
                "net_ids": net_ids,
                "layer_ids": [],
            })

        # Max length
        if nc.max_total_length_mm is not None:
            constraints.append({
                "type": CONSTRAINT_MAX_LENGTH,
                "value": nc.max_total_length_mm,
                "net_ids": net_ids,
                "layer_ids": [],
            })

        # Layer restriction
        if nc.layer_preference:
            # Encode as a constraint; layer_ids will be resolved by the
            # orchestration layer that knows the actual layer index mapping.
            constraints.append({
                "type": CONSTRAINT_LAYER_RESTRICTION,
                "value": 0.0,
                "net_ids": net_ids,
                "layer_ids": [],  # Filled in by orchestration with actual indices
                "layer_names": list(nc.layer_preference),  # Extra field for resolution
            })

    return constraints


def _build_proto_nets(intent: RoutingIntent) -> list[dict]:
    """Build proto-compatible ``Net`` dicts from net class info.

    Each dict matches the ``routing.proto Net`` message fields that can be
    derived from the intent (pads come from the board, not the intent).
    """
    nets: list[dict] = []

    for nc in intent.net_classes:
        is_diff = nc.differential_pair is not None
        has_length = nc.length_matching is not None

        for i, net_name in enumerate(nc.nets):
            net_dict: dict = {
                "name": net_name,
                "is_diff_pair": is_diff,
                "diff_pair_partner": "",
                "needs_length_match": has_length,
                "length_match_group": "",
                "target_length": 0.0,
                "length_tolerance": 0.0,
            }

            # For diff pairs, the first two nets are assumed to be the pair.
            if is_diff and len(nc.nets) >= 2:
                partner_idx = 1 if i == 0 else 0
                if i < 2:
                    net_dict["diff_pair_partner"] = nc.nets[partner_idx]

            if has_length and nc.length_matching is not None:
                net_dict["length_match_group"] = nc.length_matching.group
                net_dict["length_tolerance"] = nc.length_matching.max_skew_mm
                # target_length stays 0.0 (auto-match to longest)

            nets.append(net_dict)

    return nets


def _diff_pair_to_dict(nc: NetClassIntent) -> dict:
    """Build a diff-pair dict compatible with ``routeai_solver.board_model.DiffPair``."""
    dp = nc.differential_pair
    assert dp is not None  # caller checks
    impedance = nc.impedance.target_ohm if nc.impedance is not None else 100.0
    gap = (
        nc.impedance.coupling_gap_mm
        if nc.impedance is not None and nc.impedance.coupling_gap_mm is not None
        else 0.15
    )
    return {
        "name": nc.name,
        "positive_net": nc.nets[0],
        "negative_net": nc.nets[1],
        "target_impedance": impedance,
        "max_skew": dp.max_intra_pair_skew_mm,
        "gap": gap,
        "trace_width": nc.width_mm,
        "max_parallel_length_mm": dp.max_parallel_length_mm,
        "min_spacing_to_other_diff_mm": dp.min_spacing_to_other_diff_mm,
    }


def _merge_length_group(groups: list[dict], nc: NetClassIntent) -> None:
    """Merge net class nets into an existing length group, or create one."""
    lm = nc.length_matching
    assert lm is not None  # caller checks

    for group in groups:
        if group["name"] == lm.group:
            group["nets"].extend(nc.nets)
            return

    groups.append({
        "name": lm.group,
        "nets": list(nc.nets),
        "max_skew_mm": lm.max_skew_mm,
        "tolerance": lm.max_skew_mm,
        "reference_net": lm.reference_net,
        "target_length": None,  # Auto-match to longest
    })


def _zone_to_dict(zone: PlacementZone) -> dict:
    """Convert a PlacementZone to a solver-compatible dict."""
    z: dict = {
        "zone_id": zone.zone_id,
        "zone_type": zone.zone_type,
        "components": list(zone.components),
    }

    if zone.clustering is not None:
        c = zone.clustering
        z["clustering"] = {
            "strategy": c.strategy,
            "anchor_component": c.anchor_component,
            "max_spread_mm": c.max_spread_mm,
            "orientation_preference": c.orientation_preference,
        }

    if zone.thermal is not None:
        t = zone.thermal
        z["thermal"] = {
            "max_junction_temp_c": t.max_junction_temp_c,
            "keepout_radius_mm": t.keepout_radius_mm,
            "requires_thermal_vias": t.requires_thermal_vias,
            "copper_pour_layers": list(t.copper_pour_layers),
            "airflow_direction": t.airflow_direction,
        }

    if zone.power_plane is not None:
        pp = zone.power_plane
        z["power_plane"] = {
            "voltage_rail": pp.voltage_rail,
            "target_voltage_drop_mv": pp.target_voltage_drop_mv,
            "min_copper_area_mm2": pp.min_copper_area_mm2,
        }

    return z
