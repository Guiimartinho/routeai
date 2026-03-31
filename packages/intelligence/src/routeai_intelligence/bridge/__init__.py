"""Bridge between LLM Intent DSL and solver/router parameters.

Converts PlacementIntent and RoutingIntent (Pydantic models) into
dictionaries matching the protobuf message format for the C++ router,
and into solver-compatible constraint objects.
"""

from routeai_intelligence.bridge.intent_to_solver import (
    placement_intent_to_solver_params,
    routing_intent_to_design_rules,
    routing_intent_to_router_params,
    routing_intent_to_solver_constraints,
    voltage_drops_to_pi_params,
)

__all__ = [
    "placement_intent_to_solver_params",
    "routing_intent_to_design_rules",
    "routing_intent_to_router_params",
    "routing_intent_to_solver_constraints",
    "voltage_drops_to_pi_params",
]
