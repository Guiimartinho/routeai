"""LLM Routing Director - Generates and iteratively refines routing strategies.

The RoutingDirector uses Claude to analyze a PCB board state, schematic information,
and design constraints to produce a RoutingStrategy. When the solver reports issues,
it can adjust the strategy up to 3 times before flagging nets for manual routing.

All outputs pass through Gate 1 (schema validation) before being returned.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from routeai_core.models.intent import RoutingIntent
from routeai_intelligence.agent.prompts.routing_director import (
    ROUTING_DIRECTOR_SYSTEM_PROMPT,
    STRATEGY_ADJUSTMENT_PROMPT,
)
from routeai_intelligence.agent.prompts.routing_intent import ROUTING_INTENT_PROMPT
from routeai_intelligence.llm.router import LLMRouter
from routeai_intelligence.validation.schema_validator import SchemaValidator

logger = logging.getLogger(__name__)

# Maximum adjustment iterations before giving up
MAX_ADJUSTMENT_ITERATIONS = 3


# ---------------------------------------------------------------------------
# Pydantic models for RoutingStrategy
# ---------------------------------------------------------------------------


class NetConstraints(BaseModel):
    """Per-net routing constraints."""

    max_length_mm: float | None = Field(
        default=None, description="Maximum total trace length in mm"
    )
    min_spacing_mm: float | None = Field(
        default=None, description="Minimum spacing to adjacent traces in mm"
    )
    impedance_ohm: float | None = Field(
        default=None, description="Target characteristic impedance in ohms"
    )
    length_match_group: str | None = Field(
        default=None, description="Length match group identifier"
    )
    max_vias: int | None = Field(
        default=None, description="Maximum number of vias for this net"
    )
    preferred_layers: list[str] = Field(
        default_factory=list, description="Ordered list of preferred routing layers"
    )


class RoutingOrderEntry(BaseModel):
    """A single net in the routing order."""

    net_name: str = Field(description="Exact net identifier from the netlist")
    priority: int = Field(ge=1, le=10, description="Routing priority 1-10 (10=highest)")
    reason: str = Field(description="Justification for this priority assignment")
    constraints: NetConstraints = Field(
        default_factory=NetConstraints, description="Per-net routing constraints"
    )


class LayerAssignmentEntry(BaseModel):
    """Layer assignment for a net pattern."""

    signal_layers: list[str] = Field(
        description="Ordered list of preferred layers for matching nets"
    )
    reason: str = Field(description="Justification for layer assignment")


class ViaStrategy(BaseModel):
    """Via usage rules by signal category."""

    high_speed: str = Field(
        default="through_only",
        description="Via policy for high-speed nets: through_only | through_or_blind",
    )
    general: str = Field(
        default="through_or_blind",
        description="Via policy for general nets: through_only | through_or_blind",
    )
    power: str = Field(
        default="through_only",
        description="Via policy for power nets: through_only | through_or_blind",
    )
    return_path_via_max_distance_mm: float = Field(
        default=2.0,
        ge=0.0,
        le=10.0,
        description="Max distance from signal via to return-path stitching via in mm",
    )
    via_size_overrides: dict[str, Any] = Field(
        default_factory=dict,
        description="Per-net-class via size overrides {net_class: {drill_mm, pad_mm}}",
    )


class CostWeights(BaseModel):
    """Routing cost function weights (0.0 - 1.0)."""

    wire_length: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Penalty for total trace length"
    )
    via_count: float = Field(
        default=0.3, ge=0.0, le=1.0, description="Penalty per via used"
    )
    congestion: float = Field(
        default=0.4, ge=0.0, le=1.0, description="Penalty for routing through dense areas"
    )
    layer_change: float = Field(
        default=0.3, ge=0.0, le=1.0, description="Penalty for changing layers"
    )


class GeneratedConstraint(BaseModel):
    """An additional constraint inferred by the Routing Director."""

    type: str = Field(
        description="Constraint type: spacing, length_match, impedance, width, "
        "keep_out, manual_routing_required, warning"
    )
    description: str = Field(description="Human-readable constraint description")
    affected_nets: list[str] = Field(
        default_factory=list, description="Net names this constraint applies to"
    )
    parameters: dict[str, Any] = Field(
        default_factory=dict, description="Constraint-specific parameters"
    )


class AdjustmentNote(BaseModel):
    """Record of a change made during strategy adjustment."""

    change: str = Field(description="What was changed")
    reason: str = Field(description="Why, referencing solver feedback")
    affected_nets: list[str] = Field(
        default_factory=list, description="Nets affected by this change"
    )


class RoutingStrategy(BaseModel):
    """Complete routing strategy produced by the Routing Director.

    This is the primary output that drives the automated routing solver. It
    includes net ordering, layer assignments, via rules, cost weights, and
    any additional constraints the LLM inferred from the design.
    """

    routing_order: list[RoutingOrderEntry] = Field(
        description="Nets ordered by routing priority (highest first)"
    )
    layer_assignment: dict[str, LayerAssignmentEntry] = Field(
        default_factory=dict,
        description="Net pattern -> layer assignment mapping",
    )
    via_strategy: ViaStrategy = Field(
        default_factory=ViaStrategy, description="Via usage rules"
    )
    cost_weights: CostWeights = Field(
        default_factory=CostWeights, description="Routing cost function weights"
    )
    constraints_generated: list[GeneratedConstraint] = Field(
        default_factory=list,
        description="Additional constraints inferred from the design",
    )
    adjustment_notes: list[AdjustmentNote] = Field(
        default_factory=list,
        description="Changes made during iterative adjustment (empty on first pass)",
    )
    validation_passed: bool = Field(
        default=False, description="Whether Gate 1 schema validation passed"
    )
    validation_errors: list[str] = Field(
        default_factory=list, description="Validation errors if any"
    )


# ---------------------------------------------------------------------------
# Solver feedback model (input for adjust_strategy)
# ---------------------------------------------------------------------------


class FailedNet(BaseModel):
    """A net that the solver failed to route."""

    net_name: str
    failure_reason: str = Field(
        description="no_path_found | congestion | impedance_violation | "
        "length_violation | drc_violation"
    )
    details: str = Field(default="", description="Human-readable detail")


class SolverFeedback(BaseModel):
    """Structured feedback from the routing solver after an attempt."""

    completion_rate: float = Field(
        ge=0.0, le=100.0, description="Percentage of nets successfully routed"
    )
    failed_nets: list[FailedNet] = Field(
        default_factory=list, description="Nets that could not be routed"
    )
    congestion_map: dict[str, float] = Field(
        default_factory=dict,
        description="Region name -> congestion score (0.0 = clear, 1.0 = saturated)",
    )
    drc_violations: list[dict[str, Any]] = Field(
        default_factory=list, description="DRC violations found in routed traces"
    )
    timing_issues: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Nets violating length or timing constraints",
    )


# ---------------------------------------------------------------------------
# RoutingDirector
# ---------------------------------------------------------------------------


class RoutingDirector:
    """Orchestrates LLM-based routing strategy generation and refinement.

    Uses Claude to analyze board state and constraints, then produces a
    RoutingStrategy. If the solver reports issues, adjust_strategy can be
    called up to MAX_ADJUSTMENT_ITERATIONS times for iterative refinement.

    Args:
        api_key: Anthropic API key. Reads ANTHROPIC_API_KEY env var if None.
        model: Claude model identifier.
        max_tokens: Maximum tokens per LLM response.
        temperature: Sampling temperature (0.0 = deterministic).
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 8192,
        temperature: float = 0.0,
    ) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens
        self._temperature = temperature
        self._schema_validator = SchemaValidator()
        self._adjustment_count = 0

    async def generate_strategy(
        self,
        board_state: dict[str, Any],
        schematic_info: dict[str, Any],
        constraints: dict[str, Any],
    ) -> RoutingStrategy:
        """Generate an initial routing strategy from the design data.

        Sends the board state, schematic, and existing constraints to Claude
        with the ROUTING_DIRECTOR_SYSTEM_PROMPT. The LLM analyzes net
        criticality, assigns layers, defines via rules, and tunes the cost
        function. Output is validated through Gate 1 (schema validation).

        Args:
            board_state: Serialized board design including component placements,
                stackup definition, board outline, and existing traces/zones.
            schematic_info: Serialized schematic with net list, component
                connections, and interface groupings.
            constraints: Existing constraint set (net classes, diff pairs,
                length groups, special rules).

        Returns:
            RoutingStrategy with validated routing decisions.
        """
        self._adjustment_count = 0

        user_message = self._build_generation_message(
            board_state, schematic_info, constraints
        )

        raw_output = await self._call_llm(
            system_prompt=ROUTING_DIRECTOR_SYSTEM_PROMPT,
            user_message=user_message,
        )

        return self._parse_and_validate(raw_output)

    async def adjust_strategy(
        self,
        previous_strategy: RoutingStrategy,
        solver_feedback: SolverFeedback,
    ) -> RoutingStrategy:
        """Adjust a previously generated strategy based on solver feedback.

        The solver attempted to execute the previous strategy and encountered
        issues. This method sends both the previous strategy and the solver
        feedback to Claude, asking it to make targeted adjustments. The LLM
        modifies priorities, layer assignments, constraints, and cost weights
        to address the reported failures.

        This method tracks iteration count internally and will set
        manual_routing_required constraints on iteration 3 for any
        unresolvable nets.

        Args:
            previous_strategy: The strategy that was executed (may have
                been previously adjusted).
            solver_feedback: Structured report from the solver.

        Returns:
            Adjusted RoutingStrategy.

        Raises:
            ValueError: If called more than MAX_ADJUSTMENT_ITERATIONS times
                without calling generate_strategy to reset.
        """
        self._adjustment_count += 1

        if self._adjustment_count > MAX_ADJUSTMENT_ITERATIONS:
            raise ValueError(
                f"Maximum adjustment iterations ({MAX_ADJUSTMENT_ITERATIONS}) exceeded. "
                f"Call generate_strategy() to start fresh or handle remaining nets manually."
            )

        prompt = STRATEGY_ADJUSTMENT_PROMPT.replace(
            "{iteration}", str(self._adjustment_count)
        )

        user_message = self._build_adjustment_message(
            previous_strategy, solver_feedback
        )

        raw_output = await self._call_llm(
            system_prompt=prompt,
            user_message=user_message,
        )

        strategy = self._parse_and_validate(raw_output)

        # On final iteration, ensure unresolved nets are flagged
        if self._adjustment_count == MAX_ADJUSTMENT_ITERATIONS:
            strategy = self._flag_unresolved_nets(strategy, solver_feedback)

        return strategy

    async def generate_routing_intent(
        self,
        board_state: dict[str, Any],
        schematic_info: dict[str, Any],
        constraints: dict[str, Any],
        board_id: str = "",
        llm_router: LLMRouter | None = None,
    ) -> RoutingIntent:
        """Generate a RoutingIntent DSL from the design data.

        Produces the new-format RoutingIntent (net classes, routing order,
        layer assignments, cost weights, voltage drop targets) that the C++
        routing solver consumes directly. The LLM never emits coordinates --
        only net names, constraints, and strategy parameters.

        Args:
            board_state: Serialized board design including component placements,
                stackup definition, board outline, and existing traces/zones.
            schematic_info: Serialized schematic with net list, component
                connections, and interface groupings.
            constraints: Existing constraint set (net classes, diff pairs,
                length groups, special rules).
            board_id: Board design identifier to embed in the intent.
            llm_router: Optional LLMRouter for VRAM-aware model selection.
                Falls back to the direct Anthropic client if not provided.

        Returns:
            Validated RoutingIntent Pydantic model.
        """
        # Build the schema string from the RoutingIntent model
        schema_json = json.dumps(
            RoutingIntent.model_json_schema(), indent=2
        )
        system_prompt = ROUTING_INTENT_PROMPT.replace("{schema}", schema_json)

        # Build a compact context message
        user_message = _format_routing_context(
            board_state, schematic_info, constraints
        )

        # Prefer LLMRouter.generate_json() for VRAM-aware model selection;
        # fall back to the direct Anthropic _call_llm() path.
        if llm_router is not None:
            messages = [{"role": "user", "content": user_message}]
            raw_dict = await llm_router.generate_json(
                messages=messages,
                system=system_prompt,
                schema=RoutingIntent.model_json_schema(),
                task_type="routing_director",
            )
            raw_output = json.dumps(raw_dict)
        else:
            raw_output = await self._call_llm(
                system_prompt=system_prompt,
                user_message=user_message,
            )

        # Parse and validate through the RoutingIntent Pydantic model
        parsed = self._try_parse_json(raw_output)

        # Inject board_id if provided and not already set
        if board_id and not parsed.get("board_id"):
            parsed["board_id"] = board_id

        intent = RoutingIntent.model_validate(parsed)
        return intent

    @property
    def adjustment_count(self) -> int:
        """Number of adjustment iterations performed since last generate_strategy."""
        return self._adjustment_count

    @property
    def adjustments_remaining(self) -> int:
        """Number of adjustment iterations remaining."""
        return max(0, MAX_ADJUSTMENT_ITERATIONS - self._adjustment_count)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _call_llm(self, system_prompt: str, user_message: str) -> str:
        """Send a single request to Claude and return the text response.

        Does not implement tool calling - the Routing Director operates
        purely on the data provided in the prompt. Tool-augmented analysis
        (impedance calculation, DRC) should be performed beforehand by the
        RouteAIAgent and included in the board_state/constraints.
        """
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
        except anthropic.APIError as exc:
            logger.error("Anthropic API error in RoutingDirector: %s", exc)
            return json.dumps({
                "routing_order": [],
                "layer_assignment": {},
                "via_strategy": {
                    "high_speed": "through_only",
                    "general": "through_or_blind",
                    "power": "through_only",
                    "return_path_via_max_distance_mm": 2.0,
                    "via_size_overrides": {},
                },
                "cost_weights": {
                    "wire_length": 0.5,
                    "via_count": 0.3,
                    "congestion": 0.4,
                    "layer_change": 0.3,
                },
                "constraints_generated": [
                    {
                        "type": "warning",
                        "description": f"LLM API error: {exc}. Using default strategy.",
                        "affected_nets": [],
                        "parameters": {},
                    }
                ],
            })

        # Extract text from response
        text_parts: list[str] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)

        return "\n".join(text_parts)

    def _parse_and_validate(self, raw_output: str) -> RoutingStrategy:
        """Parse LLM JSON output and validate through Gate 1.

        Attempts to parse the raw text as JSON, extracts the RoutingStrategy
        fields, and runs schema validation. Validation errors are attached
        to the strategy but do not prevent it from being returned (the caller
        can decide whether to use a strategy with validation warnings).
        """
        parsed = self._try_parse_json(raw_output)
        validation_errors: list[str] = []

        # Gate 1: Schema validation against the routing schema
        validation_result = self._schema_validator.validate(raw_output, "routing")
        if not validation_result.valid:
            validation_errors.extend(validation_result.errors)
            logger.warning(
                "Routing strategy failed Gate 1 validation with %d errors",
                len(validation_result.errors),
            )

        # Build the RoutingStrategy from parsed data
        routing_order = self._extract_routing_order(parsed)
        layer_assignment = self._extract_layer_assignment(parsed)
        via_strategy = self._extract_via_strategy(parsed)
        cost_weights = self._extract_cost_weights(parsed)
        constraints_generated = self._extract_constraints(parsed)
        adjustment_notes = self._extract_adjustment_notes(parsed)

        return RoutingStrategy(
            routing_order=routing_order,
            layer_assignment=layer_assignment,
            via_strategy=via_strategy,
            cost_weights=cost_weights,
            constraints_generated=constraints_generated,
            adjustment_notes=adjustment_notes,
            validation_passed=len(validation_errors) == 0,
            validation_errors=validation_errors,
        )

    def _extract_routing_order(
        self, parsed: dict[str, Any]
    ) -> list[RoutingOrderEntry]:
        """Extract and normalize routing_order from parsed LLM output."""
        raw_order = parsed.get("routing_order", [])
        entries: list[RoutingOrderEntry] = []

        for item in raw_order:
            if isinstance(item, dict):
                net_name = item.get("net_name", item.get("name", "unknown"))
                priority = item.get("priority", 3)
                reason = item.get("reason", "No reason provided")

                raw_constraints = item.get("constraints", {})
                if isinstance(raw_constraints, dict):
                    constraints = NetConstraints(
                        max_length_mm=raw_constraints.get("max_length_mm"),
                        min_spacing_mm=raw_constraints.get("min_spacing_mm"),
                        impedance_ohm=raw_constraints.get("impedance_ohm"),
                        length_match_group=raw_constraints.get("length_match_group"),
                        max_vias=raw_constraints.get("max_vias"),
                        preferred_layers=raw_constraints.get("preferred_layers", []),
                    )
                else:
                    constraints = NetConstraints()

                # Clamp priority to valid range
                priority = max(1, min(10, int(priority)))

                entries.append(
                    RoutingOrderEntry(
                        net_name=str(net_name),
                        priority=priority,
                        reason=str(reason),
                        constraints=constraints,
                    )
                )

        # Sort by priority descending (highest priority first)
        entries.sort(key=lambda e: e.priority, reverse=True)
        return entries

    def _extract_layer_assignment(
        self, parsed: dict[str, Any]
    ) -> dict[str, LayerAssignmentEntry]:
        """Extract and normalize layer_assignment from parsed LLM output."""
        raw_assignment = parsed.get("layer_assignment", {})
        result: dict[str, LayerAssignmentEntry] = {}

        if isinstance(raw_assignment, dict):
            for pattern, value in raw_assignment.items():
                if isinstance(value, dict):
                    result[str(pattern)] = LayerAssignmentEntry(
                        signal_layers=value.get("signal_layers", []),
                        reason=value.get("reason", "No reason provided"),
                    )

        return result

    def _extract_via_strategy(self, parsed: dict[str, Any]) -> ViaStrategy:
        """Extract and normalize via_strategy from parsed LLM output."""
        raw_via = parsed.get("via_strategy", {})
        if not isinstance(raw_via, dict):
            return ViaStrategy()

        return ViaStrategy(
            high_speed=raw_via.get("high_speed", "through_only"),
            general=raw_via.get("general", "through_or_blind"),
            power=raw_via.get("power", "through_only"),
            return_path_via_max_distance_mm=float(
                raw_via.get("return_path_via_max_distance_mm", 2.0)
            ),
            via_size_overrides=raw_via.get("via_size_overrides", {}),
        )

    def _extract_cost_weights(self, parsed: dict[str, Any]) -> CostWeights:
        """Extract and normalize cost_weights from parsed LLM output."""
        raw_weights = parsed.get("cost_weights", {})
        if not isinstance(raw_weights, dict):
            return CostWeights()

        def clamp(val: Any, default: float) -> float:
            try:
                v = float(val)
                return max(0.0, min(1.0, v))
            except (TypeError, ValueError):
                return default

        return CostWeights(
            wire_length=clamp(raw_weights.get("wire_length"), 0.5),
            via_count=clamp(raw_weights.get("via_count"), 0.3),
            congestion=clamp(raw_weights.get("congestion"), 0.4),
            layer_change=clamp(raw_weights.get("layer_change"), 0.3),
        )

    def _extract_constraints(
        self, parsed: dict[str, Any]
    ) -> list[GeneratedConstraint]:
        """Extract constraints_generated from parsed LLM output."""
        raw_constraints = parsed.get("constraints_generated", [])
        result: list[GeneratedConstraint] = []

        for item in raw_constraints:
            if isinstance(item, dict):
                result.append(
                    GeneratedConstraint(
                        type=item.get("type", "unknown"),
                        description=item.get("description", ""),
                        affected_nets=item.get("affected_nets", []),
                        parameters=item.get("parameters", {}),
                    )
                )

        return result

    def _extract_adjustment_notes(
        self, parsed: dict[str, Any]
    ) -> list[AdjustmentNote]:
        """Extract adjustment_notes from parsed LLM output."""
        raw_notes = parsed.get("adjustment_notes", [])
        result: list[AdjustmentNote] = []

        for item in raw_notes:
            if isinstance(item, dict):
                result.append(
                    AdjustmentNote(
                        change=item.get("change", ""),
                        reason=item.get("reason", ""),
                        affected_nets=item.get("affected_nets", []),
                    )
                )

        return result

    def _flag_unresolved_nets(
        self,
        strategy: RoutingStrategy,
        feedback: SolverFeedback,
    ) -> RoutingStrategy:
        """On the final iteration, flag any still-failing nets for manual routing."""
        if not feedback.failed_nets:
            return strategy

        already_flagged = {
            net
            for c in strategy.constraints_generated
            if c.type == "manual_routing_required"
            for net in c.affected_nets
        }

        unflagged = [
            fn.net_name
            for fn in feedback.failed_nets
            if fn.net_name not in already_flagged
        ]

        if unflagged:
            strategy.constraints_generated.append(
                GeneratedConstraint(
                    type="manual_routing_required",
                    description=(
                        f"After {MAX_ADJUSTMENT_ITERATIONS} adjustment iterations, "
                        f"the following {len(unflagged)} net(s) could not be auto-routed "
                        f"and require manual routing intervention."
                    ),
                    affected_nets=unflagged,
                    parameters={
                        "iteration_limit_reached": True,
                        "failure_details": {
                            fn.net_name: fn.failure_reason
                            for fn in feedback.failed_nets
                            if fn.net_name in unflagged
                        },
                    },
                )
            )

        return strategy

    def _build_generation_message(
        self,
        board_state: dict[str, Any],
        schematic_info: dict[str, Any],
        constraints: dict[str, Any],
    ) -> str:
        """Build the user message for initial strategy generation."""
        parts = [
            "Generate a complete routing strategy for the following PCB design.\n",
            f"## Board State\n```json\n{json.dumps(board_state, indent=2, default=str)}\n```\n",
            f"## Schematic\n```json\n{json.dumps(schematic_info, indent=2, default=str)}\n```\n",
            f"## Existing Constraints\n```json\n{json.dumps(constraints, indent=2, default=str)}\n```\n",
            "Analyze all nets, assign priorities, define layer assignments, set via "
            "strategy, tune cost weights, and generate any additional constraints. "
            "Respond with a single JSON object matching the output schema.",
        ]
        return "\n".join(parts)

    def _build_adjustment_message(
        self,
        previous_strategy: RoutingStrategy,
        solver_feedback: SolverFeedback,
    ) -> str:
        """Build the user message for strategy adjustment."""
        strategy_dict = previous_strategy.model_dump(exclude={"validation_passed", "validation_errors"})
        feedback_dict = solver_feedback.model_dump()

        parts = [
            "The solver executed your previous routing strategy and encountered issues. "
            "Please adjust the strategy to address the failures.\n",
            f"## Previous Strategy\n```json\n{json.dumps(strategy_dict, indent=2, default=str)}\n```\n",
            f"## Solver Feedback\n```json\n{json.dumps(feedback_dict, indent=2, default=str)}\n```\n",
            f"This is adjustment iteration {self._adjustment_count} of {MAX_ADJUSTMENT_ITERATIONS}.",
        ]

        if self._adjustment_count == MAX_ADJUSTMENT_ITERATIONS:
            parts.append(
                "\nThis is the FINAL iteration. For any nets that still cannot be "
                "resolved, add a constraint with type 'manual_routing_required'."
            )

        parts.append(
            "\nRespond with the adjusted RoutingStrategy JSON including adjustment_notes."
        )
        return "\n".join(parts)

    @staticmethod
    def _try_parse_json(text: str) -> dict[str, Any]:
        """Attempt to parse JSON from LLM output, handling markdown code fences."""
        cleaned = text.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
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

        # Try to find JSON object boundaries
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start : end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("RoutingDirector: Failed to parse JSON from LLM output")
        return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}


# ---------------------------------------------------------------------------
# Module-level helpers for RoutingIntent generation
# ---------------------------------------------------------------------------


def _format_routing_context(
    board_state: dict[str, Any],
    schematic_info: dict[str, Any],
    constraints: dict[str, Any],
) -> str:
    """Build a compact context message for RoutingIntent generation.

    Extracts the most relevant information from the board, schematic, and
    constraint dicts and formats it into a concise prompt section. Target
    is under ~2000 tokens to leave room for the LLM's response.

    Sections:
    - Net list with connected components (from schematic)
    - Existing constraints (net classes, diff pairs)
    - Stackup info (layers, materials)
    - Board dimensions
    """
    parts: list[str] = []

    # -- Board dimensions --
    outline = board_state.get("outline") or board_state.get("board_outline")
    dimensions = board_state.get("dimensions") or board_state.get("board_dimensions")
    if outline or dimensions:
        parts.append("## Board Dimensions")
        if dimensions:
            parts.append(json.dumps(dimensions, indent=2, default=str))
        elif outline:
            parts.append(json.dumps(outline, indent=2, default=str))
        parts.append("")

    # -- Stackup info --
    stackup = board_state.get("stackup") or board_state.get("layer_stackup")
    if stackup:
        parts.append("## Stackup")
        # Keep only layer names, types, thickness, and materials
        if isinstance(stackup, list):
            compact_layers = []
            for layer in stackup:
                if isinstance(layer, dict):
                    compact_layers.append({
                        k: v
                        for k, v in layer.items()
                        if k in (
                            "name", "type", "thickness_mm", "material",
                            "copper_weight_oz", "dielectric_constant",
                        )
                    })
            parts.append(json.dumps(compact_layers, indent=2, default=str))
        else:
            parts.append(json.dumps(stackup, indent=2, default=str))
        parts.append("")

    # -- Net list with connected components --
    nets = schematic_info.get("nets") or schematic_info.get("net_list", [])
    if nets:
        parts.append("## Nets (name -> connected components)")
        # Truncate to first 80 nets to stay within token budget
        net_entries: list[str] = []
        net_items = nets if isinstance(nets, list) else list(nets.values()) if isinstance(nets, dict) else []
        for i, net in enumerate(net_items):
            if i >= 80:
                remaining = len(net_items) - 80
                net_entries.append(f"... and {remaining} more nets")
                break
            if isinstance(net, dict):
                name = net.get("name") or net.get("net_name", f"net_{i}")
                pads = net.get("pads") or net.get("connected_pads") or net.get("connections", [])
                # Extract component refs from pads
                comp_refs: list[str] = []
                for pad in pads if isinstance(pads, list) else []:
                    if isinstance(pad, dict):
                        ref = pad.get("component") or pad.get("ref", "")
                        if ref and ref not in comp_refs:
                            comp_refs.append(ref)
                    elif isinstance(pad, str):
                        comp_refs.append(pad)
                net_entries.append(f"- {name}: {', '.join(comp_refs)}")
            elif isinstance(net, str):
                net_entries.append(f"- {net}")
        parts.append("\n".join(net_entries))
        parts.append("")

    # -- Existing constraints --
    net_classes = constraints.get("net_classes", [])
    diff_pairs = constraints.get("diff_pairs", [])
    length_groups = constraints.get("length_groups", [])

    if net_classes or diff_pairs or length_groups:
        parts.append("## Existing Constraints")
        if net_classes:
            parts.append("### Net Classes")
            parts.append(json.dumps(net_classes, indent=2, default=str))
        if diff_pairs:
            parts.append("### Differential Pairs")
            parts.append(json.dumps(diff_pairs, indent=2, default=str))
        if length_groups:
            parts.append("### Length-Matched Groups")
            parts.append(json.dumps(length_groups, indent=2, default=str))
        parts.append("")

    # -- Component summary (count by type) --
    components = (
        board_state.get("components")
        or schematic_info.get("components")
        or []
    )
    if components and isinstance(components, list):
        type_counts: dict[str, int] = {}
        for comp in components:
            if isinstance(comp, dict):
                ctype = comp.get("type") or comp.get("package", "unknown")
                type_counts[ctype] = type_counts.get(ctype, 0) + 1
        if type_counts:
            parts.append(f"## Components: {len(components)} total")
            for ctype, count in sorted(type_counts.items(), key=lambda x: -x[1]):
                parts.append(f"- {ctype}: {count}")
            parts.append("")

    parts.append(
        "Generate a RoutingIntent JSON for this design. "
        "Respond with ONLY the JSON object, no explanation."
    )

    return "\n".join(parts)
