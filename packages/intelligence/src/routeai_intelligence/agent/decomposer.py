"""T1 Task Decomposition framework for VRAM-constrained local inference.

T1 tasks (design review, schematic review, return path analysis, etc.) are too
complex for a 14B model to handle in a single shot. This module breaks them into
sequential T2 sub-tasks, each small enough for the swap model to handle well.

Each step receives accumulated context from previous steps, so the final
synthesis step sees ALL prior findings.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable

from routeai_intelligence.llm.router import LLMRouter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class DecompositionStep:
    """A single sub-task within a decomposed T1 task."""

    description: str
    """What this step does — becomes the core of the LLM prompt."""

    task_type: str
    """Maps to TASK_TIER_MAP so ModelManager selects the right model (T2)."""

    tools: list[str]
    """Which tools this step can use (empty list = no tools)."""

    output_key: str
    """Key to store this step's result in the accumulated context dict."""


@dataclass
class DecomposedResult:
    """Result of a fully decomposed T1 task execution."""

    steps: dict[str, str]
    """output_key -> result text for every step."""

    synthesis: str
    """The final synthesis step output."""

    step_count: int
    """Total number of steps executed."""

    task_type: str
    """The original T1 task type that was decomposed."""


# ---------------------------------------------------------------------------
# Decomposition templates
# ---------------------------------------------------------------------------

DECOMPOSITION_TEMPLATES: dict[str, list[DecompositionStep]] = {
    "design_review": [
        DecompositionStep(
            description=(
                "List all high-speed nets (>50MHz) and their impedance "
                "requirements from the schematic"
            ),
            task_type="constraint_generation",
            tools=["impedance_calc"],
            output_key="high_speed_nets",
        ),
        DecompositionStep(
            description=(
                "For each power net, check trace width against current "
                "requirement using IPC-2152"
            ),
            task_type="thermal_analyzer",
            tools=["impedance_calc"],
            output_key="power_analysis",
        ),
        DecompositionStep(
            description=(
                "Identify components dissipating >0.5W and check thermal "
                "clearance to neighbors"
            ),
            task_type="thermal_analyzer",
            tools=[],
            output_key="thermal_analysis",
        ),
        DecompositionStep(
            description=(
                "Check decoupling capacitor placement — each IC must have "
                "a cap within 2mm"
            ),
            task_type="placement_strategy",
            tools=[],
            output_key="decoupling_check",
        ),
        DecompositionStep(
            description=(
                "Run DRC and categorize violations by severity "
                "(error/warning/info)"
            ),
            task_type="constraint_generation",
            tools=["drc_check"],
            output_key="drc_results",
        ),
        DecompositionStep(
            description=(
                "Synthesize ALL previous findings into a categorized design "
                "review report with severity ratings"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "schematic_review": [
        DecompositionStep(
            description=(
                "List all ICs and verify each has bypass/decoupling "
                "capacitors on power pins"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="bypass_check",
        ),
        DecompositionStep(
            description=(
                "Check all external interface pins for ESD/TVS protection "
                "components"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="protection_check",
        ),
        DecompositionStep(
            description=(
                "Verify pull-up/pull-down resistor values on I2C/SPI/UART "
                "buses match datasheet recommendations"
            ),
            task_type="constraint_generation",
            tools=["datasheet_lookup"],
            output_key="pullup_check",
        ),
        DecompositionStep(
            description=(
                "Analyze power tree: list all regulators, their input/output "
                "voltages, and load components"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="power_tree",
        ),
        DecompositionStep(
            description=(
                "Check for common schematic errors: floating inputs, "
                "unconnected outputs, wrong pin assignments"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="connectivity_check",
        ),
        DecompositionStep(
            description=(
                "Synthesize ALL previous findings into a categorized "
                "schematic review report"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "return_path_analysis": [
        DecompositionStep(
            description=(
                "Identify all signals that transition between layers "
                "(via layer changes)"
            ),
            task_type="routing_director",
            tools=[],
            output_key="layer_transitions",
        ),
        DecompositionStep(
            description=(
                "For each layer transition, check if the reference plane "
                "(GND/PWR) is continuous at that point"
            ),
            task_type="routing_director",
            tools=[],
            output_key="plane_continuity",
        ),
        DecompositionStep(
            description=(
                "List locations where stitching vias are needed near signal "
                "vias for return current"
            ),
            task_type="routing_director",
            tools=[],
            output_key="stitching_vias",
        ),
        DecompositionStep(
            description="Synthesize return path findings with recommendations",
            task_type="routing_director",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "semantic_erc": [
        DecompositionStep(
            description=(
                "Classify all nets by electrical type: power, ground, signal, "
                "clock, reset, analog"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="net_classification",
        ),
        DecompositionStep(
            description=(
                "Check power net connections: verify voltage levels match "
                "between source and load pins"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="power_check",
        ),
        DecompositionStep(
            description=(
                "Check bidirectional pins: verify directions are consistent "
                "and not conflicting"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="direction_check",
        ),
        DecompositionStep(
            description=(
                "Identify floating inputs and undriven outputs that could "
                "cause issues"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="floating_check",
        ),
        DecompositionStep(
            description="Synthesize ERC findings",
            task_type="constraint_generation",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "routing_critic": [
        DecompositionStep(
            description=(
                "Check each routed net against impedance targets — flag "
                "width mismatches"
            ),
            task_type="constraint_generation",
            tools=["impedance_calc"],
            output_key="impedance_check",
        ),
        DecompositionStep(
            description="Count vias per net and flag those exceeding budget",
            task_type="routing_director",
            tools=[],
            output_key="via_check",
        ),
        DecompositionStep(
            description="Check length matching groups for skew violations",
            task_type="routing_director",
            tools=[],
            output_key="length_check",
        ),
        DecompositionStep(
            description=(
                "Identify signals crossing split planes (reference plane "
                "discontinuity)"
            ),
            task_type="routing_director",
            tools=[],
            output_key="plane_check",
        ),
        DecompositionStep(
            description=(
                "Synthesize routing critique with prioritized fix "
                "recommendations"
            ),
            task_type="routing_director",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "cross_datasheet": [
        DecompositionStep(
            description=(
                "Extract key interface parameters from IC A datasheet "
                "(voltage levels, timing, impedance)"
            ),
            task_type="constraint_generation",
            tools=["datasheet_lookup"],
            output_key="ic_a_params",
        ),
        DecompositionStep(
            description="Extract key interface parameters from IC B datasheet",
            task_type="constraint_generation",
            tools=["datasheet_lookup"],
            output_key="ic_b_params",
        ),
        DecompositionStep(
            description=(
                "Compare parameters: check voltage level compatibility, "
                "timing margins, impedance matching"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="compatibility_check",
        ),
        DecompositionStep(
            description=(
                "Synthesize compatibility findings with pass/fail per "
                "parameter"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="synthesis",
        ),
    ],
    "power_budget": [
        DecompositionStep(
            description=(
                "List all power consumers with their current draw in active "
                "mode"
            ),
            task_type="constraint_generation",
            tools=["datasheet_lookup"],
            output_key="active_budget",
        ),
        DecompositionStep(
            description=(
                "List current draw in sleep/standby mode for each consumer"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="sleep_budget",
        ),
        DecompositionStep(
            description=(
                "Calculate total power per rail and check against regulator "
                "capacity"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="rail_analysis",
        ),
        DecompositionStep(
            description=(
                "Synthesize power budget report with margin analysis per "
                "operating mode"
            ),
            task_type="constraint_generation",
            tools=[],
            output_key="synthesis",
        ),
    ],
}


# ---------------------------------------------------------------------------
# TaskDecomposer
# ---------------------------------------------------------------------------


class TaskDecomposer:
    """Breaks T1 tasks into sequential T2 sub-tasks for VRAM-constrained GPUs.

    Each step is sent to the LLM as a focused T2 task. Results accumulate so
    later steps (especially the final synthesis) can reference all prior
    findings.

    Args:
        llm_router: The LLMRouter instance for generating responses.
        tool_schemas_fn: Callable that returns tool schemas (e.g. get_tool_schemas).
    """

    def __init__(
        self,
        llm_router: LLMRouter,
        tool_schemas_fn: Callable[[], list[dict[str, Any]]],
    ) -> None:
        self._router = llm_router
        self._tool_schemas_fn = tool_schemas_fn

    async def execute(
        self,
        task_type: str,
        context: str,
        system_base: str = "",
    ) -> DecomposedResult:
        """Execute a decomposed T1 task as a sequence of T2 sub-tasks.

        Args:
            task_type: The T1 task type (must be a key in DECOMPOSITION_TEMPLATES).
            context: Design context string (board/schematic data).
            system_base: Optional base system prompt prepended to each step.

        Returns:
            DecomposedResult with all step outputs and the final synthesis.

        Raises:
            ValueError: If task_type has no decomposition template.
        """
        if task_type not in DECOMPOSITION_TEMPLATES:
            raise ValueError(
                f"No decomposition template for task type '{task_type}'. "
                f"Available: {', '.join(DECOMPOSITION_TEMPLATES.keys())}"
            )

        steps = DECOMPOSITION_TEMPLATES[task_type]
        all_schemas = self._tool_schemas_fn()
        accumulated: dict[str, str] = {}

        for i, step in enumerate(steps):
            logger.info(
                "Decomposed step %d/%d [%s]: %s",
                i + 1,
                len(steps),
                step.output_key,
                step.description,
            )

            # Filter tool schemas to only those allowed for this step
            step_tools: list[dict[str, Any]] | None = None
            if step.tools:
                step_tools = [
                    s for s in all_schemas if s["name"] in step.tools
                ]

            # Build the prompt for this step
            prompt = self._build_step_prompt(step, context, accumulated)

            # Build system prompt
            system = system_base or (
                "You are RouteAI, an expert PCB design engineer performing "
                "a focused analysis step. Be precise — cite component "
                "references, net names, and values."
            )

            messages = [{"role": "user", "content": prompt}]

            try:
                response = await self._router.generate(
                    messages=messages,
                    system=system,
                    tools=step_tools,
                    task_type=step.task_type,
                )
                result_text = response.text or ""
            except Exception as exc:
                logger.error(
                    "Decomposed step '%s' failed: %s", step.output_key, exc
                )
                result_text = f"[Step failed: {exc}]"

            accumulated[step.output_key] = result_text
            logger.debug(
                "Step '%s' produced %d chars", step.output_key, len(result_text)
            )

        return DecomposedResult(
            steps=accumulated,
            synthesis=accumulated.get("synthesis", ""),
            step_count=len(steps),
            task_type=task_type,
        )

    @staticmethod
    def _build_step_prompt(
        step: DecompositionStep,
        context: str,
        accumulated: dict[str, str],
    ) -> str:
        """Build the LLM prompt for a single decomposition step.

        Includes the step description, design context, and all findings from
        previous steps so the model has full visibility.
        """
        parts = [
            f"TASK: {step.description}",
            "",
            "DESIGN CONTEXT:",
            context,
        ]

        if accumulated:
            parts.append("")
            parts.append("PREVIOUS FINDINGS:")
            for key, value in accumulated.items():
                parts.append(f"--- {key} ---")
                parts.append(value)
                parts.append("")

        parts.append("")
        parts.append(
            "Respond with your analysis. Be specific — cite component "
            "references, net names, and values."
        )

        return "\n".join(parts)
