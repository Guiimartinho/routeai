"""AI placement strategy generation using LLM.

When a user finishes a schematic, the PlacementStrategyGenerator:
1. Analyzes the circuit (zones, critical pairs, thermal groups)
2. Asks the LLM to generate a placement strategy
3. Returns a structured PlacementStrategy with reasoning

All LLM outputs are validated through Gate 1 (schema validation) before use.

The ``generate_placement_intent`` function is the newer, DSL-first path:
it asks the LLM to emit a ``PlacementIntent`` (no coordinates) that the C++
placement solver consumes directly.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import anthropic
from pydantic import BaseModel, Field

from routeai_intelligence.placement.analyzer import (
    CircuitZoneAnalyzer,
    ComponentZone,
    CriticalPair,
)
from routeai_intelligence.placement.prompts import (
    PLACEMENT_EXPLAIN_PROMPT,
    PLACEMENT_SYSTEM_PROMPT,
    build_placement_user_message,
)
from routeai_intelligence.validation.schema_validator import SchemaValidator
from routeai_parsers.models import SchematicDesign

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic models for structured placement output
# ---------------------------------------------------------------------------


class ComponentPlacement(BaseModel):
    """Placement coordinates and reasoning for a single component."""

    reference: str = Field(description="Component reference designator")
    x_mm: float = Field(description="X position in mm from board origin")
    y_mm: float = Field(description="Y position in mm from board origin")
    rotation_deg: float = Field(default=0.0, description="Rotation in degrees")
    layer: str = Field(default="F.Cu", description="Placement layer (F.Cu or B.Cu)")
    reasoning: str = Field(default="", description="Why this position was chosen")


class CriticalPairPlacement(BaseModel):
    """Placement result for a critical pair with actual distance."""

    component_a: str = Field(description="First component reference")
    component_b: str = Field(description="Second component reference")
    actual_distance_mm: float = Field(description="Actual distance after placement")
    max_distance_mm: float = Field(description="Maximum allowed distance")
    reason: str = Field(default="", description="Constraint reason")
    satisfied: bool = Field(default=True, description="Whether constraint is met")


class PlacementZone(BaseModel):
    """A placement zone with region bounds and component placements."""

    zone_type: str = Field(description="Zone type: POWER, DIGITAL, ANALOG, etc.")
    region: tuple[float, float, float, float] = Field(
        description="Bounding box (x_min, y_min, x_max, y_max) in mm"
    )
    components: list[ComponentPlacement] = Field(
        default_factory=list, description="Components placed in this zone"
    )
    reasoning: str = Field(default="", description="Why this zone is positioned here")


class PlacementStrategy(BaseModel):
    """Complete placement strategy produced by the LLM.

    This is the primary output of the PlacementStrategyGenerator. It
    contains zone definitions, component positions, critical pair
    validation, and the overall design reasoning.
    """

    zones: list[PlacementZone] = Field(
        default_factory=list, description="Placement zones with components"
    )
    critical_pairs: list[CriticalPairPlacement] = Field(
        default_factory=list, description="Critical pair constraint results"
    )
    board_outline_mm: tuple[float, float] = Field(
        default=(50.0, 50.0), description="Board width and height in mm"
    )
    layer_count: int = Field(default=4, description="Number of PCB layers")
    ground_plane_layers: list[str] = Field(
        default_factory=list, description="Layers used as ground planes"
    )
    power_plane_layers: list[str] = Field(
        default_factory=list, description="Layers used as power planes"
    )
    reasoning: str = Field(default="", description="Overall strategy explanation")
    ipc_references: list[str] = Field(
        default_factory=list, description="IPC standards referenced"
    )
    validation_passed: bool = Field(
        default=False, description="Whether Gate 1 schema validation passed"
    )
    validation_errors: list[str] = Field(
        default_factory=list, description="Validation errors if any"
    )

    def get_all_placements(self) -> list[ComponentPlacement]:
        """Return a flat list of all component placements across all zones."""
        result: list[ComponentPlacement] = []
        for zone in self.zones:
            result.extend(zone.components)
        return result

    def get_placement(self, reference: str) -> ComponentPlacement | None:
        """Look up a specific component's placement by reference."""
        for zone in self.zones:
            for comp in zone.components:
                if comp.reference == reference:
                    return comp
        return None


# ---------------------------------------------------------------------------
# Strategy generator
# ---------------------------------------------------------------------------


class PlacementStrategyGenerator:
    """Uses LLM to generate intelligent placement strategy.

    When user finishes schematic, this class:
    1. Analyzes the circuit (zones, critical pairs, thermal)
    2. Asks LLM to generate placement strategy
    3. Returns structured strategy with reasoning

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
        self._zone_analyzer = CircuitZoneAnalyzer()

    async def generate_strategy(
        self,
        schematic: SchematicDesign,
        board_outline: dict[str, float] | None = None,
        layer_count: int = 4,
        constraints: dict[str, Any] | None = None,
    ) -> PlacementStrategy:
        """Generate complete placement strategy using LLM.

        The LLM prompt includes:
        - Component list with values and packages
        - Net connectivity (which components connect to which)
        - Zone classification
        - Critical pairs
        - Board dimensions and layer stack

        Args:
            schematic: Parsed schematic design.
            board_outline: Board dimensions {"width": float, "height": float}.
                Defaults to auto-sized board.
            layer_count: Number of PCB layers (default 4).
            constraints: Additional constraints dict.

        Returns:
            PlacementStrategy with validated placement decisions.
        """
        # Step 1: Analyze the circuit
        zones = self._zone_analyzer.analyze(schematic)
        critical_pairs = self._zone_analyzer.identify_critical_pairs(schematic)
        thermal_groups = self._zone_analyzer.identify_thermal_groups(schematic)

        # Step 2: Determine board size
        board_w = 50.0
        board_h = 50.0
        if board_outline:
            board_w = board_outline.get("width", 50.0)
            board_h = board_outline.get("height", 50.0)
        else:
            # Auto-size based on component count
            num_components = len(schematic.symbols)
            side = max(30.0, 10.0 + num_components * 2.5)
            board_w = side
            board_h = side

        # Step 3: Build prompt data
        components_info = self._serialize_components(schematic)
        net_info = self._serialize_nets(schematic)
        zone_info = self._serialize_zones(zones)
        pairs_info = self._serialize_critical_pairs(critical_pairs)

        extra = ""
        if constraints:
            extra = json.dumps(constraints, indent=2, default=str)
        if thermal_groups:
            extra += "\n\n## Thermal Groups\n"
            for tg in thermal_groups:
                extra += (
                    f"- Components: {tg.components}, "
                    f"Est. power: {tg.estimated_power_w}W, "
                    f"Strategy: {tg.strategy}\n"
                )

        user_message = build_placement_user_message(
            components_info=components_info,
            net_connectivity=net_info,
            zone_analysis=zone_info,
            critical_pairs=pairs_info,
            board_width_mm=board_w,
            board_height_mm=board_h,
            layer_count=layer_count,
            extra_constraints=extra,
        )

        # Step 4: Call LLM
        raw_output = await self._call_llm(
            system_prompt=PLACEMENT_SYSTEM_PROMPT,
            user_message=user_message,
        )

        # Step 5: Parse and validate
        return self._parse_and_validate(
            raw_output,
            board_w=board_w,
            board_h=board_h,
            layer_count=layer_count,
            critical_pairs=critical_pairs,
        )

    async def explain_placement(
        self,
        strategy: PlacementStrategy,
        component_ref: str,
    ) -> str:
        """Explain why a specific component was placed where it is.

        Args:
            strategy: The placement strategy containing the component.
            component_ref: Reference designator to explain.

        Returns:
            Human-readable explanation of the placement decision.
        """
        placement = strategy.get_placement(component_ref)
        if placement is None:
            return f"Component {component_ref} not found in the placement strategy."

        if placement.reasoning:
            # If the strategy already has reasoning, enhance it with LLM
            prompt = PLACEMENT_EXPLAIN_PROMPT.format(
                component_ref=component_ref,
                strategy_json=json.dumps(
                    strategy.model_dump(exclude={"validation_passed", "validation_errors"}),
                    indent=2,
                    default=str,
                ),
            )

            try:
                explanation = await self._call_llm(
                    system_prompt="You are an expert PCB placement engineer.",
                    user_message=prompt,
                )
                return explanation.strip()
            except Exception as exc:
                logger.warning("LLM explain_placement failed: %s", exc)
                return placement.reasoning

        return placement.reasoning or f"No reasoning available for {component_ref}."

    # ------------------------------------------------------------------
    # LLM communication
    # ------------------------------------------------------------------

    async def _call_llm(self, system_prompt: str, user_message: str) -> str:
        """Send a single request to Claude and return the text response."""
        try:
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
        except anthropic.APIError as exc:
            logger.error("Anthropic API error in PlacementStrategyGenerator: %s", exc)
            return json.dumps({
                "board_size_mm": {"width": 50, "height": 50},
                "zones": [],
                "critical_pairs": [],
                "ground_planes": [],
                "power_planes": [],
                "overall_reasoning": f"LLM API error: {exc}. Using default strategy.",
            })

        text_parts: list[str] = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)

        return "\n".join(text_parts)

    # ------------------------------------------------------------------
    # Parsing and validation
    # ------------------------------------------------------------------

    def _parse_and_validate(
        self,
        raw_output: str,
        board_w: float,
        board_h: float,
        layer_count: int,
        critical_pairs: list[CriticalPair],
    ) -> PlacementStrategy:
        """Parse LLM JSON output and validate through Gate 1."""
        parsed = self._try_parse_json(raw_output)
        validation_errors: list[str] = []

        # Gate 1: Schema validation
        validation_result = self._schema_validator.validate(raw_output, "placement")
        if not validation_result.valid:
            validation_errors.extend(validation_result.errors)
            logger.warning(
                "Placement strategy failed Gate 1 validation with %d errors",
                len(validation_result.errors),
            )

        # Extract data
        board_size = parsed.get("board_size_mm", {})
        actual_w = board_size.get("width", board_w)
        actual_h = board_size.get("height", board_h)

        zones = self._extract_zones(parsed)
        pair_placements = self._extract_critical_pairs(parsed, critical_pairs)
        ground_planes = parsed.get("ground_planes", [])
        power_planes = parsed.get("power_planes", [])
        reasoning = parsed.get("overall_reasoning", "")

        # Collect IPC references from reasoning text
        ipc_refs: list[str] = []
        for standard in ("IPC-7351", "IPC-2221B", "IPC-2141", "IPC-2152"):
            if standard.lower() in (reasoning + str(parsed)).lower():
                ipc_refs.append(standard)

        return PlacementStrategy(
            zones=zones,
            critical_pairs=pair_placements,
            board_outline_mm=(actual_w, actual_h),
            layer_count=layer_count,
            ground_plane_layers=ground_planes if isinstance(ground_planes, list) else [],
            power_plane_layers=power_planes if isinstance(power_planes, list) else [],
            reasoning=reasoning,
            ipc_references=ipc_refs,
            validation_passed=len(validation_errors) == 0,
            validation_errors=validation_errors,
        )

    def _extract_zones(self, parsed: dict[str, Any]) -> list[PlacementZone]:
        """Extract placement zones from parsed LLM output."""
        raw_zones = parsed.get("zones", [])
        zones: list[PlacementZone] = []

        for raw_zone in raw_zones:
            if not isinstance(raw_zone, dict):
                continue

            zone_type = raw_zone.get("type", "DIGITAL")
            region_data = raw_zone.get("region_mm", {})
            region = (
                float(region_data.get("x_min", 0.0)),
                float(region_data.get("y_min", 0.0)),
                float(region_data.get("x_max", 50.0)),
                float(region_data.get("y_max", 50.0)),
            )

            components: list[ComponentPlacement] = []
            for raw_comp in raw_zone.get("components", []):
                if not isinstance(raw_comp, dict):
                    continue
                components.append(ComponentPlacement(
                    reference=str(raw_comp.get("ref", raw_comp.get("reference", ""))),
                    x_mm=float(raw_comp.get("x_mm", 0.0)),
                    y_mm=float(raw_comp.get("y_mm", 0.0)),
                    rotation_deg=float(raw_comp.get("rotation_deg", raw_comp.get("rotation", 0.0))),
                    layer=str(raw_comp.get("layer", "F.Cu")),
                    reasoning=str(raw_comp.get("reason", raw_comp.get("reasoning", ""))),
                ))

            zones.append(PlacementZone(
                zone_type=zone_type,
                region=region,
                components=components,
                reasoning=str(raw_zone.get("reasoning", raw_zone.get("reason", ""))),
            ))

        return zones

    def _extract_critical_pairs(
        self,
        parsed: dict[str, Any],
        original_pairs: list[CriticalPair],
    ) -> list[CriticalPairPlacement]:
        """Extract critical pair results from parsed LLM output."""
        raw_pairs = parsed.get("critical_pairs", [])
        results: list[CriticalPairPlacement] = []

        for raw_pair in raw_pairs:
            if not isinstance(raw_pair, dict):
                continue

            actual = float(raw_pair.get("actual_distance_mm", 0.0))
            max_dist = float(raw_pair.get("max_distance_mm", 2.0))

            results.append(CriticalPairPlacement(
                component_a=str(raw_pair.get("a", raw_pair.get("component_a", ""))),
                component_b=str(raw_pair.get("b", raw_pair.get("component_b", ""))),
                actual_distance_mm=actual,
                max_distance_mm=max_dist,
                reason=str(raw_pair.get("reason", "")),
                satisfied=actual <= max_dist,
            ))

        return results

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _serialize_components(schematic: SchematicDesign) -> str:
        """Serialize schematic components to JSON for the LLM prompt."""
        components: list[dict[str, Any]] = []
        for sym in schematic.symbols:
            if not sym.reference:
                continue
            footprint = ""
            for prop in sym.properties:
                if prop.key.lower() == "footprint":
                    footprint = prop.value
                    break
            components.append({
                "ref": sym.reference,
                "value": sym.value,
                "lib_id": sym.lib_id,
                "footprint": footprint,
            })
        return json.dumps(components, indent=2)

    @staticmethod
    def _serialize_nets(schematic: SchematicDesign) -> str:
        """Serialize net connectivity to JSON for the LLM prompt."""
        nets: list[dict[str, Any]] = []
        for net in schematic.nets:
            if not net.pins:
                continue
            pins = [{"ref": ref, "pin": pin} for ref, pin in net.pins]
            nets.append({
                "name": net.name,
                "is_power": net.is_power,
                "pins": pins,
            })
        return json.dumps(nets, indent=2)

    @staticmethod
    def _serialize_zones(zones: list[ComponentZone]) -> str:
        """Serialize zone analysis to JSON for the LLM prompt."""
        data = [
            {
                "type": z.zone_type,
                "components": z.components,
                "priority": z.priority,
                "constraints": z.constraints,
            }
            for z in zones
        ]
        return json.dumps(data, indent=2)

    @staticmethod
    def _serialize_critical_pairs(pairs: list[CriticalPair]) -> str:
        """Serialize critical pairs to JSON for the LLM prompt."""
        data = [
            {
                "a": p.component_a,
                "b": p.component_b,
                "max_distance_mm": p.max_distance_mm,
                "reason": p.reason,
                "rule": p.rule_source,
            }
            for p in pairs
        ]
        return json.dumps(data, indent=2)

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

        logger.warning("PlacementStrategyGenerator: Failed to parse JSON from LLM output")
        return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}


# ---------------------------------------------------------------------------
# PlacementIntent DSL generation (coordinate-free)
# ---------------------------------------------------------------------------

# Maximum approximate token budget for the board+schematic context sent to
# the LLM.  Keeps the payload small enough for the 4096-context T2 model.
_MAX_CONTEXT_COMPONENTS = 80
_MAX_CONTEXT_NETS = 120


def _format_board(board_data: dict[str, Any] | str) -> str:
    """Convert board data to a compact text representation for the LLM.

    Extracts:
    - Component list (reference, value, footprint, power dissipation)
    - Board outline dimensions
    - Existing constraints (if any)

    Keeps the output under ~1000 tokens.
    """
    if isinstance(board_data, str):
        try:
            board_data = json.loads(board_data)
        except (json.JSONDecodeError, TypeError):
            return board_data[:3000]

    if not isinstance(board_data, dict):
        return str(board_data)[:3000]

    parts: list[str] = []

    # Board outline
    outline = board_data.get("outline") or board_data.get("board_outline")
    if outline:
        parts.append(f"Outline: {json.dumps(outline, default=str)}")

    # Components — compact table
    footprints = board_data.get("footprints", [])
    if footprints:
        parts.append("Components:")
        for fp in footprints[:_MAX_CONTEXT_COMPONENTS]:
            ref = fp.get("reference", "?")
            value = fp.get("value", "")
            footprint = fp.get("footprint", fp.get("lib_id", ""))
            power_w = fp.get("power_dissipation_w", "")
            line = f"  {ref}: {value}"
            if footprint:
                line += f" [{footprint}]"
            if power_w:
                line += f" ({power_w}W)"
            parts.append(line)
        if len(footprints) > _MAX_CONTEXT_COMPONENTS:
            parts.append(f"  ... and {len(footprints) - _MAX_CONTEXT_COMPONENTS} more")

    # Existing constraints
    constraints = board_data.get("constraints") or board_data.get("design_rules")
    if constraints:
        parts.append(f"Constraints: {json.dumps(constraints, default=str)[:500]}")

    return "\n".join(parts)


def _format_schematic(schematic_data: dict[str, Any] | str) -> str:
    """Convert schematic data to a compact text representation for the LLM.

    Extracts:
    - Component list with reference designators, values, footprints
    - Net list with net names and connected pins
    - Power dissipation estimates (if available)

    Keeps the output under ~1000 tokens.
    """
    if isinstance(schematic_data, str):
        try:
            schematic_data = json.loads(schematic_data)
        except (json.JSONDecodeError, TypeError):
            return schematic_data[:3000]

    if not isinstance(schematic_data, dict):
        return str(schematic_data)[:3000]

    parts: list[str] = []

    # Symbols / components
    symbols = schematic_data.get("symbols", [])
    if symbols:
        parts.append("Schematic components:")
        for sym in symbols[:_MAX_CONTEXT_COMPONENTS]:
            ref = sym.get("reference", "?")
            value = sym.get("value", "")
            lib_id = sym.get("lib_id", "")
            fp = ""
            for prop in sym.get("properties", []):
                if isinstance(prop, dict) and prop.get("key", "").lower() == "footprint":
                    fp = prop.get("value", "")
                    break
            line = f"  {ref}: {value}"
            if lib_id:
                line += f" ({lib_id})"
            if fp:
                line += f" [{fp}]"
            parts.append(line)
        if len(symbols) > _MAX_CONTEXT_COMPONENTS:
            parts.append(f"  ... and {len(symbols) - _MAX_CONTEXT_COMPONENTS} more")

    # Nets
    nets = schematic_data.get("nets", [])
    if nets:
        parts.append("Nets:")
        for net in nets[:_MAX_CONTEXT_NETS]:
            name = net.get("name", "?")
            is_power = net.get("is_power", False)
            pins = net.get("pins", [])
            pin_strs = [
                f"{p[0]}.{p[1]}" if isinstance(p, (list, tuple)) else str(p)
                for p in pins[:8]
            ]
            suffix = " [PWR]" if is_power else ""
            pin_text = ", ".join(pin_strs)
            if len(pins) > 8:
                pin_text += f" +{len(pins) - 8} more"
            parts.append(f"  {name}{suffix}: {pin_text}")
        if len(nets) > _MAX_CONTEXT_NETS:
            parts.append(f"  ... and {len(nets) - _MAX_CONTEXT_NETS} more nets")

    return "\n".join(parts)


async def generate_placement_intent(
    llm_router: Any,
    board_data: dict[str, Any] | str,
    schematic_data: dict[str, Any] | str,
) -> Any:
    """Generate a PlacementIntent DSL from board and schematic data.

    Uses the LLM (via ``llm_router.generate_json``) to produce a structured
    ``PlacementIntent`` containing zones, critical pairs, keepouts, and ground
    plane requirements -- but **no coordinates**.  The C++ placement solver
    consumes this intent to compute actual positions.

    Args:
        llm_router: An initialized ``LLMRouter`` instance (or any object
            that exposes an async ``generate_json`` method).
        board_data: Serialized ``BoardDesign`` dict (or JSON string).
        schematic_data: Serialized ``SchematicDesign`` dict (or JSON string).

    Returns:
        A validated ``PlacementIntent`` Pydantic model.
    """
    from routeai_core.models.intent import PlacementIntent
    from routeai_intelligence.agent.prompts.placement_intent import (
        PLACEMENT_INTENT_PROMPT,
    )

    schema_json = json.dumps(PlacementIntent.model_json_schema(), indent=2)
    system = PLACEMENT_INTENT_PROMPT.format(schema=schema_json)

    context = (
        f"BOARD DATA:\n{_format_board(board_data)}\n\n"
        f"SCHEMATIC DATA:\n{_format_schematic(schematic_data)}"
    )

    response = await llm_router.generate_json(
        messages=[{"role": "user", "content": context}],
        system=system,
        schema=PlacementIntent.model_json_schema(),
        task_type="placement_strategy",
    )

    # Validate through Pydantic
    intent = PlacementIntent.model_validate(response)
    return intent
