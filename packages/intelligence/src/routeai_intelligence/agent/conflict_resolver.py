"""Conflict resolver for multi-agent intent mediation.

Detects and resolves conflicts between PlacementIntent and RoutingIntent
BEFORE the solver runs. Uses domain-priority weights for deterministic
resolution and optional LLM mediation for close-priority conflicts.

Domain priorities reflect PCB design reality: safety and signal integrity
outrank density and aesthetics.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Domain priority weights
# ---------------------------------------------------------------------------

DOMAIN_PRIORITY: dict[str, int] = {
    "safety": 100,
    "signal_integrity": 80,
    "power_integrity": 75,
    "thermal": 70,
    "manufacturability": 60,
    "density": 40,
    "cost": 30,
    "aesthetics": 10,
}

# Gap threshold: if priority difference exceeds this, the higher-priority
# domain wins outright. Below this, a compromise is attempted.
PRIORITY_GAP_THRESHOLD = 20


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Conflict:
    """A detected conflict between two agent intents."""

    agent_a: str
    domain_a: str
    intent_a: str  # Description of what agent A wants
    agent_b: str
    domain_b: str
    intent_b: str  # Description of what agent B wants
    affected_components: list[str] = field(default_factory=list)


@dataclass
class Resolution:
    """Resolution of a conflict between two agent intents."""

    conflict: Conflict
    winner: str
    decision: str
    justification: str
    compromise: dict[str, Any] | None = None  # Modified DSL fields if needed


# ---------------------------------------------------------------------------
# Conflict Resolver
# ---------------------------------------------------------------------------


class ConflictResolver:
    """Detects and resolves contradictions between PlacementIntent and RoutingIntent.

    Runs BEFORE the solver to catch DSL contradictions that would cause
    the solver to produce suboptimal or impossible results.

    Detection is deterministic (no LLM needed). Resolution uses domain
    priority weights for clear winners and optional LLM mediation for
    close-priority conflicts.

    Args:
        llm_router: Optional LLMRouter for LLM-mediated compromise on
            close-priority conflicts. If None, uses deterministic resolution.
    """

    def __init__(self, llm_router: Any | None = None) -> None:
        self._router = llm_router

    # ------------------------------------------------------------------
    # Conflict detection
    # ------------------------------------------------------------------

    def detect_conflicts(
        self,
        placement_intent: dict[str, Any],
        routing_intent: dict[str, Any],
    ) -> list[Conflict]:
        """Detect contradictions between placement and routing intents.

        Runs three concrete conflict checks:
        1. Thermal keepout vs minimize_distance critical pairs
        2. Wide power traces vs signal routing corridors
        3. Ground plane solid_pour vs signal layer assignment

        Args:
            placement_intent: Serialized PlacementIntent dict.
            routing_intent: Serialized RoutingIntent dict.

        Returns:
            List of detected Conflict objects. Empty list if no conflicts.
        """
        conflicts: list[Conflict] = []

        conflicts.extend(
            self._check_thermal_vs_proximity(placement_intent, routing_intent)
        )
        conflicts.extend(
            self._check_power_width_vs_routing_space(placement_intent, routing_intent)
        )
        conflicts.extend(
            self._check_ground_plane_vs_signal_layer(placement_intent, routing_intent)
        )

        if conflicts:
            logger.info(
                "ConflictResolver detected %d conflict(s) between placement and routing intents",
                len(conflicts),
            )

        return conflicts

    def _check_thermal_vs_proximity(
        self,
        placement_intent: dict[str, Any],
        routing_intent: dict[str, Any],
    ) -> list[Conflict]:
        """Check 1: Thermal keepout component also in a minimize_distance critical pair.

        If a component has a thermal keepout radius in the placement intent
        but is also listed in a critical pair with constraint=minimize_distance,
        these goals directly conflict: thermal wants space around the component,
        while the critical pair wants another component as close as possible.
        """
        conflicts: list[Conflict] = []

        # Build set of components with thermal keepouts and their radii
        keepouts = placement_intent.get("keepouts", [])
        thermal_keepout_components: dict[str, float] = {}
        for ko in keepouts:
            if ko.get("type") == "thermal" and ko.get("source_component"):
                thermal_keepout_components[ko["source_component"]] = ko.get("radius_mm", 0)

        if not thermal_keepout_components:
            return conflicts

        # Check critical pairs for minimize_distance constraints involving
        # a thermal-keepout component
        critical_pairs = placement_intent.get("critical_pairs", [])
        for pair in critical_pairs:
            constraint = pair.get("constraint", "")
            if constraint != "minimize_distance":
                continue

            comp_a = pair.get("component_a", "")
            comp_b = pair.get("component_b", "")
            max_dist = pair.get("max_distance_mm", 0)

            for thermal_comp, radius_mm in thermal_keepout_components.items():
                if thermal_comp not in (comp_a, comp_b):
                    continue
                other_comp = comp_b if thermal_comp == comp_a else comp_a

                # Conflict: keepout radius may exceed the max_distance constraint
                if radius_mm > 0 and (max_dist == 0 or radius_mm >= max_dist * 0.5):
                    conflicts.append(Conflict(
                        agent_a="placement",
                        domain_a="thermal",
                        intent_a=(
                            f"Component {thermal_comp} requires {radius_mm}mm "
                            f"thermal keepout radius"
                        ),
                        agent_b="placement",
                        domain_b="signal_integrity",
                        intent_b=(
                            f"Critical pair ({comp_a}, {comp_b}) wants "
                            f"minimize_distance with max {max_dist}mm"
                        ),
                        affected_components=[thermal_comp, other_comp],
                    ))

        return conflicts

    def _check_power_width_vs_routing_space(
        self,
        placement_intent: dict[str, Any],
        routing_intent: dict[str, Any],
    ) -> list[Conflict]:
        """Check 2: Wide power traces blocking signal routing corridors.

        If voltage_drop_targets require wide traces (min_trace_width_mm)
        on layers that are also used for signal routing, the wide power
        traces may consume routing space needed by signal nets, especially
        in dense areas near the source/sink components.
        """
        conflicts: list[Conflict] = []

        vd_targets = routing_intent.get("voltage_drop_targets", [])
        if not vd_targets:
            return conflicts

        # Gather signal layers from routing intent
        layer_assignment = routing_intent.get("layer_assignment") or {}
        signal_layers = set(layer_assignment.get("signal_layers", []))

        # Gather net classes and their layer preferences
        net_classes = routing_intent.get("net_classes", [])
        signal_layer_nets: dict[str, list[str]] = {}  # layer -> net names
        for nc in net_classes:
            for layer in nc.get("layer_preference", []):
                if layer not in signal_layer_nets:
                    signal_layer_nets[layer] = []
                signal_layer_nets[layer].extend(nc.get("nets", []))

        # Wide power trace threshold: traces wider than 0.5mm can block corridors
        WIDE_TRACE_THRESHOLD_MM = 0.5

        for vd in vd_targets:
            min_width = vd.get("min_trace_width_mm", 0)
            if min_width < WIDE_TRACE_THRESHOLD_MM:
                continue

            power_net = vd.get("net", "?")
            source = vd.get("source_component", "")
            sinks = vd.get("sink_components", [])
            max_current = vd.get("max_current_a", 0)

            # Power traces typically route on signal layers if no dedicated
            # power plane exists. Check if any signal layers would be affected.
            affected_layers = [
                layer for layer in signal_layer_nets
                if signal_layer_nets[layer]  # Has signal nets assigned
            ]

            if not affected_layers and signal_layers:
                # If no explicit layer preferences but signal layers exist,
                # power may still route on them
                affected_layers = list(signal_layers)

            if affected_layers:
                affected_comps = [source] + list(sinks) if source else list(sinks)
                signal_net_count = sum(
                    len(signal_layer_nets.get(l, []))
                    for l in affected_layers
                )

                conflicts.append(Conflict(
                    agent_a="routing",
                    domain_a="power_integrity",
                    intent_a=(
                        f"Power net {power_net} needs {min_width}mm wide traces "
                        f"for {max_current}A ({source} -> {', '.join(sinks[:3])})"
                    ),
                    agent_b="routing",
                    domain_b="signal_integrity",
                    intent_b=(
                        f"{signal_net_count} signal nets need routing space on "
                        f"layers [{', '.join(affected_layers[:4])}]"
                    ),
                    affected_components=affected_comps[:10],
                ))

        return conflicts

    def _check_ground_plane_vs_signal_layer(
        self,
        placement_intent: dict[str, Any],
        routing_intent: dict[str, Any],
    ) -> list[Conflict]:
        """Check 3: Ground plane solid_pour on a layer that routing needs for signals.

        If the placement intent specifies a solid_pour ground plane on a
        layer that the routing intent assigns as a signal routing layer,
        signals cannot be routed there (solid pour leaves no space for traces).
        """
        conflicts: list[Conflict] = []

        ground_planes = placement_intent.get("ground_planes", [])
        if not ground_planes:
            return conflicts

        # Gather signal layers from routing intent
        layer_assignment = routing_intent.get("layer_assignment") or {}
        signal_layers = set(layer_assignment.get("signal_layers", []))

        # Also check net class layer preferences
        net_classes = routing_intent.get("net_classes", [])
        for nc in net_classes:
            for layer in nc.get("layer_preference", []):
                signal_layers.add(layer)

        if not signal_layers:
            return conflicts

        for gp in ground_planes:
            plane_layer = gp.get("layer", "")
            plane_type = gp.get("type", "")
            plane_net = gp.get("net", "GND")
            split_allowed = gp.get("split_allowed", True)

            if plane_layer not in signal_layers:
                continue

            # solid_pour with split_allowed=False is the most severe conflict
            if plane_type == "solid_pour" and not split_allowed:
                # Find which net classes want to use this layer
                affected_nc_names: list[str] = []
                affected_nets: list[str] = []
                for nc in net_classes:
                    if plane_layer in nc.get("layer_preference", []):
                        affected_nc_names.append(nc.get("name", "?"))
                        affected_nets.extend(nc.get("nets", [])[:5])

                conflicts.append(Conflict(
                    agent_a="placement",
                    domain_a="power_integrity",
                    intent_a=(
                        f"Ground plane requires solid_pour ({plane_net}) on "
                        f"layer {plane_layer} with no splits allowed"
                    ),
                    agent_b="routing",
                    domain_b="signal_integrity",
                    intent_b=(
                        f"Net classes [{', '.join(affected_nc_names[:4])}] need "
                        f"layer {plane_layer} for signal routing "
                        f"({len(affected_nets)} nets affected)"
                    ),
                    affected_components=[],  # Layer-level conflict, no specific components
                ))
            elif plane_type == "solid_pour" and split_allowed:
                # Less severe: solid pour but splits are allowed for routing
                affected_nc_names = []
                for nc in net_classes:
                    if plane_layer in nc.get("layer_preference", []):
                        affected_nc_names.append(nc.get("name", "?"))

                if affected_nc_names:
                    conflicts.append(Conflict(
                        agent_a="placement",
                        domain_a="power_integrity",
                        intent_a=(
                            f"Ground plane prefers solid_pour ({plane_net}) on "
                            f"layer {plane_layer} (splits allowed but degrade "
                            f"return path continuity)"
                        ),
                        agent_b="routing",
                        domain_b="signal_integrity",
                        intent_b=(
                            f"Signal routing on layer {plane_layer} will split "
                            f"the {plane_net} plane, degrading reference plane "
                            f"integrity for [{', '.join(affected_nc_names[:4])}]"
                        ),
                        affected_components=[],
                    ))

        return conflicts

    # ------------------------------------------------------------------
    # Conflict resolution
    # ------------------------------------------------------------------

    def resolve(self, conflict: Conflict) -> Resolution:
        """Resolve a conflict using domain priority weights.

        If the priority gap exceeds PRIORITY_GAP_THRESHOLD, the higher-priority
        domain wins outright. Otherwise, a compromise is generated via
        _mediate().

        Args:
            conflict: The conflict to resolve.

        Returns:
            Resolution with winner, decision, justification, and optional compromise.
        """
        a_priority = DOMAIN_PRIORITY.get(conflict.domain_a, 50)
        b_priority = DOMAIN_PRIORITY.get(conflict.domain_b, 50)

        gap = abs(a_priority - b_priority)

        if gap > PRIORITY_GAP_THRESHOLD:
            # Clear winner
            if a_priority > b_priority:
                winner = conflict.agent_a
                winner_domain = conflict.domain_a
                loser_domain = conflict.domain_b
            else:
                winner = conflict.agent_b
                winner_domain = conflict.domain_b
                loser_domain = conflict.domain_a

            return Resolution(
                conflict=conflict,
                winner=winner,
                decision=(
                    f"{winner} ({winner_domain}) wins -- "
                    f"{winner_domain} outranks {loser_domain}"
                ),
                justification=(
                    f"Priority gap: {gap} points "
                    f"({winner_domain}={max(a_priority, b_priority)} vs "
                    f"{loser_domain}={min(a_priority, b_priority)})"
                ),
            )
        else:
            # Close priorities -- needs compromise
            return self._mediate(conflict, a_priority, b_priority)

    def resolve_all(self, conflicts: list[Conflict]) -> list[Resolution]:
        """Resolve a list of conflicts deterministically.

        Args:
            conflicts: List of Conflict objects to resolve.

        Returns:
            List of Resolution objects in the same order.
        """
        return [self.resolve(c) for c in conflicts]

    def _mediate(
        self,
        conflict: Conflict,
        a_priority: int,
        b_priority: int,
    ) -> Resolution:
        """Create a compromise for close-priority conflicts.

        The higher-priority domain gets its full constraint preserved.
        The lower-priority domain gets a relaxed version of its constraint.

        Args:
            conflict: The conflict to mediate.
            a_priority: Priority of domain A.
            b_priority: Priority of domain B.

        Returns:
            Resolution with compromise details.
        """
        if a_priority >= b_priority:
            winner = conflict.agent_a
            winner_domain = conflict.domain_a
            loser_domain = conflict.domain_b
        else:
            winner = conflict.agent_b
            winner_domain = conflict.domain_b
            loser_domain = conflict.domain_a

        # Generate concrete compromise suggestions based on the conflict type
        compromise = self._suggest_compromise(conflict, winner_domain, loser_domain)

        return Resolution(
            conflict=conflict,
            winner=winner,
            decision=(
                f"{winner} ({winner_domain}) takes priority; "
                f"{loser_domain} constraint relaxed"
            ),
            justification=(
                f"Close priorities ({a_priority} vs {b_priority}), "
                f"compromise applied. Manual review recommended."
            ),
            compromise=compromise,
        )

    @staticmethod
    def _suggest_compromise(
        conflict: Conflict,
        winner_domain: str,
        loser_domain: str,
    ) -> dict[str, Any]:
        """Generate concrete compromise suggestions based on conflict domains.

        Returns a dict with suggested DSL field modifications.
        """
        compromise: dict[str, Any] = {
            "manual_review_recommended": True,
            "winner_domain": winner_domain,
            "loser_domain": loser_domain,
        }

        # Thermal vs signal_integrity: reduce keepout radius by 30%
        if "thermal" in (winner_domain, loser_domain) and "signal_integrity" in (
            winner_domain, loser_domain
        ):
            compromise["suggestion"] = (
                "Reduce thermal keepout radius by 30% and verify junction "
                "temperature with thermal simulation. Add thermal vias to "
                "compensate for reduced keepout."
            )
            compromise["relaxation_factor"] = 0.7

        # Power_integrity vs signal_integrity: add layer for power routing
        elif "power_integrity" in (winner_domain, loser_domain) and "signal_integrity" in (
            winner_domain, loser_domain
        ):
            compromise["suggestion"] = (
                "Route power net on a dedicated inner layer or use wider "
                "trace only in non-congested regions. Consider copper pour "
                "instead of discrete trace for power delivery."
            )
            compromise["consider_dedicated_power_layer"] = True

        else:
            compromise["suggestion"] = (
                f"Apply {winner_domain} constraint fully. Relax "
                f"{loser_domain} constraint to minimum acceptable level."
            )

        return compromise

    # ------------------------------------------------------------------
    # LLM-mediated resolution (optional)
    # ------------------------------------------------------------------

    async def resolve_with_llm(self, conflict: Conflict) -> Resolution:
        """Use LLM to mediate close-priority conflicts.

        Falls back to deterministic resolution if no LLM router is configured.

        Args:
            conflict: The conflict to resolve via LLM mediation.

        Returns:
            Resolution with LLM-generated compromise details.
        """
        if not self._router:
            return self.resolve(conflict)

        a_priority = DOMAIN_PRIORITY.get(conflict.domain_a, 50)
        b_priority = DOMAIN_PRIORITY.get(conflict.domain_b, 50)

        # If the gap is large, no need for LLM -- deterministic wins
        if abs(a_priority - b_priority) > PRIORITY_GAP_THRESHOLD:
            return self.resolve(conflict)

        prompt = (
            f"CONFLICT in PCB design:\n"
            f"Agent A ({conflict.agent_a}, domain: {conflict.domain_a}): "
            f"{conflict.intent_a}\n"
            f"Agent B ({conflict.agent_b}, domain: {conflict.domain_b}): "
            f"{conflict.intent_b}\n"
            f"Affected components: {', '.join(conflict.affected_components)}\n\n"
            f"Priority A ({conflict.domain_a}): {a_priority}\n"
            f"Priority B ({conflict.domain_b}): {b_priority}\n\n"
            f"Propose a COMPROMISE that fully satisfies the higher-priority "
            f"domain and minimizes violation of the lower-priority domain.\n\n"
            f"Respond with JSON: "
            f'{{"winner": "agent_a or agent_b", "decision": "...", '
            f'"justification": "...", "compromise": {{...}}}}'
        )

        try:
            response = await self._router.generate(
                messages=[{"role": "user", "content": prompt}],
                system=(
                    "You are a PCB design conflict mediator. Be concise. "
                    "Always respond with valid JSON only."
                ),
                tools=[],
                task_type="routing_critic",
            )

            parsed = self._extract_json(response.text)

            winner_key = parsed.get("winner", "")
            if winner_key == "agent_a":
                winner = conflict.agent_a
            elif winner_key == "agent_b":
                winner = conflict.agent_b
            else:
                # Fallback: higher priority wins
                winner = (
                    conflict.agent_a if a_priority >= b_priority
                    else conflict.agent_b
                )

            return Resolution(
                conflict=conflict,
                winner=winner,
                decision=parsed.get("decision", f"{winner} takes priority (LLM-mediated)"),
                justification=parsed.get("justification", f"LLM mediation, priorities {a_priority} vs {b_priority}"),
                compromise=parsed.get("compromise"),
            )

        except Exception as exc:
            logger.warning(
                "LLM mediation failed (%s), falling back to deterministic resolution",
                exc,
            )
            return self.resolve(conflict)

    async def resolve_all_with_llm(self, conflicts: list[Conflict]) -> list[Resolution]:
        """Resolve a list of conflicts, using LLM for close-priority ones.

        Args:
            conflicts: List of Conflict objects to resolve.

        Returns:
            List of Resolution objects in the same order.
        """
        resolutions: list[Resolution] = []
        for conflict in conflicts:
            resolution = await self.resolve_with_llm(conflict)
            resolutions.append(resolution)
        return resolutions

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        """Extract a JSON object from LLM text, handling markdown fences."""
        cleaned = text.strip()

        if cleaned.startswith("```"):
            first_newline = cleaned.find("\n")
            if first_newline != -1:
                cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start:end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("ConflictResolver: Failed to parse JSON from LLM output")
        return {}
