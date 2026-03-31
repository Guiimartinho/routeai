"""Main LLM Agent with ReAct loop for PCB design intelligence.

The RouteAIAgent orchestrates LLM interactions for design analysis, constraint
generation, and interactive chat. It implements a ReAct (Reason + Act) loop
via the unified LLMProvider abstraction (Ollama primary, Claude/Gemini fallback),
and runs all outputs through a 3-gate validation pipeline
(schema -> confidence -> citation).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from routeai_intelligence.agent.react_state import ReActState
from routeai_intelligence.agent.prompts.constraint_gen import (
    SYSTEM_PROMPT as CONSTRAINT_GEN_PROMPT,
)
from routeai_intelligence.agent.prompts.design_review import (
    SYSTEM_PROMPT as DESIGN_REVIEW_PROMPT,
)
from routeai_intelligence.agent.prompts.routing_strategy import (
    SYSTEM_PROMPT as ROUTING_STRATEGY_PROMPT,
)
from routeai_intelligence.agent.decomposer import TaskDecomposer
from routeai_intelligence.agent.tools import (
    ALL_TOOLS,
    get_tool_handler,
    get_tool_schemas,
)
from routeai_intelligence.llm.provider import LLMProvider, LLMResponse, ToolCall
from routeai_intelligence.llm.router import LLMRouter
from routeai_intelligence.validation.citation_checker import CitationChecker
from routeai_intelligence.validation.confidence import ConfidenceChecker
from routeai_intelligence.validation.schema_validator import SchemaValidator

logger = logging.getLogger(__name__)

# Maximum number of ReAct loop iterations before forced termination
MAX_REACT_ITERATIONS = 15

# Directory containing JSON schemas
_SCHEMAS_DIR = Path(__file__).parent / "schemas"


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class DesignReview(BaseModel):
    """Result of an LLM design review."""

    raw_output: dict[str, Any] = Field(description="Full JSON output from the LLM")
    summary: dict[str, Any] = Field(description="Review summary with counts and status")
    findings: list[dict[str, Any]] = Field(default_factory=list, description="Individual findings")
    category_summaries: dict[str, Any] = Field(default_factory=dict)
    validation_passed: bool = Field(default=False, description="Whether all 3 validation gates passed")
    validation_errors: list[str] = Field(default_factory=list, description="Validation failures if any")


class ConstraintSet(BaseModel):
    """Result of LLM constraint generation."""

    raw_output: dict[str, Any] = Field(description="Full JSON output from the LLM")
    net_classes: list[dict[str, Any]] = Field(default_factory=list)
    diff_pairs: list[dict[str, Any]] = Field(default_factory=list)
    length_groups: list[dict[str, Any]] = Field(default_factory=list)
    special_rules: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    validation_passed: bool = Field(default=False)
    validation_errors: list[str] = Field(default_factory=list)
    flagged_items: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Items flagged by confidence or citation checks",
    )


class ChatResponse(BaseModel):
    """Result of a chat interaction."""

    message: str = Field(description="The assistant's response text")
    tool_calls_made: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Tools invoked during this response",
    )
    context_used: list[str] = Field(
        default_factory=list,
        description="Context sources referenced",
    )


@dataclass
class _ReActState:
    """Internal state for the ReAct loop."""

    messages: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    iterations: int = 0
    finished: bool = False
    final_text: str = ""


class RouteAIAgent:
    """Main LLM agent for PCB design intelligence.

    Wraps the unified LLM provider abstraction (Ollama, Claude, Gemini) with:
    - ReAct loop (observe -> think -> act -> observe)
    - Tool calling for impedance calculation, DRC, knowledge retrieval, etc.
    - 3-gate validation pipeline on structured outputs
    - Task-specific system prompts for constraint gen, design review, routing

    Initialization modes:
    - **No arguments**: Uses the LLMRouter with automatic provider detection.
      Priority: Ollama (local) -> Claude -> Gemini.
    - **api_key provided**: Legacy mode, uses Anthropic Claude directly.
    - **llm_provider provided**: Uses the given LLMProvider instance directly.
    - **llm_router provided**: Uses the given LLMRouter instance for fallback.

    Args:
        api_key: Anthropic API key (legacy; prefer llm_provider or llm_router).
        model: Model identifier (used for legacy Anthropic init).
        max_tokens: Maximum tokens per LLM response.
        temperature: Sampling temperature (0.0 = deterministic).
        llm_provider: Explicit LLM provider to use (overrides auto-detection).
        llm_router: Explicit LLM router to use (overrides auto-detection).
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 8192,
        temperature: float = 0.0,
        llm_provider: LLMProvider | None = None,
        llm_router: LLMRouter | None = None,
    ) -> None:
        self._max_tokens = max_tokens
        self._temperature = temperature

        # Provider setup: explicit provider > explicit router > legacy api_key > auto-detect
        self._llm_provider = llm_provider
        self._llm_router = llm_router
        self._legacy_api_key = api_key
        self._legacy_model = model
        self._initialized = False

        # If an explicit provider was given, we are ready to go
        if self._llm_provider is not None:
            self._initialized = True

        # Validation pipeline (unchanged)
        self._schema_validator = SchemaValidator()
        self._confidence_checker = ConfidenceChecker()
        self._citation_checker = CitationChecker()

    async def _ensure_initialized(self) -> None:
        """Lazy initialization of the LLM provider/router."""
        if self._initialized:
            return

        if self._llm_router is not None:
            if not self._llm_router.is_initialized:
                await self._llm_router.initialize()
            self._initialized = True
            return

        if self._legacy_api_key:
            # Legacy path: explicit Anthropic key provided
            from routeai_intelligence.llm.anthropic_provider import AnthropicProvider

            self._llm_provider = AnthropicProvider(
                api_key=self._legacy_api_key,
                model=self._legacy_model,
            )
            self._initialized = True
            return

        # Auto-detect: create and initialize a router
        self._llm_router = LLMRouter()
        await self._llm_router.initialize()
        self._initialized = True

    async def _generate(
        self,
        messages: list[dict[str, Any]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        task_type: str = "chat",
    ) -> LLMResponse:
        """Route a generate call to whichever provider/router is configured.

        Args:
            messages: Conversation messages.
            system: System prompt.
            tools: Tool schemas for tool-use.
            task_type: Task type for VRAM-aware model selection via the router.
        """
        await self._ensure_initialized()

        kwargs: dict[str, Any] = {
            "messages": messages,
            "system": system,
            "tools": tools,
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
        }

        if self._llm_provider is not None:
            return await self._llm_provider.generate(**kwargs)
        if self._llm_router is not None:
            kwargs["task_type"] = task_type
            return await self._llm_router.generate(**kwargs)

        raise RuntimeError("No LLM provider or router configured.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def analyze_design(
        self,
        board: dict[str, Any],
        schematic: dict[str, Any],
    ) -> DesignReview:
        """Run a comprehensive design review on a board + schematic pair.

        On VRAM-constrained systems (<24GB), decomposes the review into
        sequential T2 sub-tasks via TaskDecomposer so the 14B model can
        handle each piece. On 24GB+ systems, runs the full ReAct loop with
        the design review system prompt.

        Args:
            board: Serialized BoardDesign dict.
            schematic: Serialized SchematicDesign dict.

        Returns:
            DesignReview with findings, summary, and validation status.
        """
        await self._ensure_initialized()

        # Check if T1 tasks need decomposition (VRAM < 24GB)
        use_decomposition = (
            self._llm_router is not None
            and self._llm_router.model_manager is not None
            and self._llm_router.model_manager.is_t1_decomposed()
        )

        if use_decomposition:
            return await self._analyze_design_decomposed(board, schematic)

        return await self._analyze_design_monolithic(board, schematic)

    async def _analyze_design_decomposed(
        self,
        board: dict[str, Any],
        schematic: dict[str, Any],
    ) -> DesignReview:
        """Run design review via T1 decomposition (VRAM-constrained path).

        Breaks the review into focused T2 sub-tasks, each handled by the 14B
        swap model, then synthesizes the findings.
        """
        assert self._llm_router is not None

        decomposer = TaskDecomposer(
            llm_router=self._llm_router,
            tool_schemas_fn=get_tool_schemas,
        )

        # Build context string from board + schematic data
        context = (
            f"## Board Design\n```json\n{json.dumps(board, indent=2, default=str)}\n```\n\n"
            f"## Schematic\n```json\n{json.dumps(schematic, indent=2, default=str)}\n```"
        )

        result = await decomposer.execute(
            task_type="design_review",
            context=context,
            system_base=DESIGN_REVIEW_PROMPT,
        )

        logger.info(
            "Design review decomposed into %d steps", result.step_count
        )

        # The synthesis step output is the final review text — try to parse
        # it as JSON for structured output, or wrap it in a standard format.
        raw_output = result.synthesis
        parsed = self._try_parse_json(raw_output)

        # If parsing failed (no JSON in synthesis), build structured output
        # from the decomposed step results
        if "_parse_error" in parsed:
            parsed = {
                "summary": {
                    "total_findings": result.step_count - 1,
                    "decomposed": True,
                },
                "findings": [
                    {
                        "title": key,
                        "description": value,
                        "severity": "info",
                    }
                    for key, value in result.steps.items()
                    if key != "synthesis"
                ],
                "category_summaries": {},
                "synthesis": result.synthesis,
            }

        # Gate 1: Schema validation
        validation_errors: list[str] = []
        validation_result = self._schema_validator.validate(raw_output, "review")
        if not validation_result.valid:
            validation_errors.extend(validation_result.errors)

        # Gate 2: Confidence scoring
        all_findings: list[dict[str, Any]] = []
        for finding in parsed.get("findings", []):
            finding["_item_type"] = "finding"
            all_findings.append(finding)

        self._confidence_checker.check(all_findings)

        # Gate 3: Citation checking
        for item in all_findings:
            is_cited, missing = self._citation_checker.check(item)
            if not is_cited:
                item_title = item.get("title", "unknown")
                validation_errors.append(
                    f"Missing citation for finding '{item_title}': {', '.join(missing)}"
                )

        return DesignReview(
            raw_output=parsed,
            summary=parsed.get("summary", {}),
            findings=parsed.get("findings", []),
            category_summaries=parsed.get("category_summaries", {}),
            validation_passed=len(validation_errors) == 0,
            validation_errors=validation_errors,
        )

    async def _analyze_design_monolithic(
        self,
        board: dict[str, Any],
        schematic: dict[str, Any],
    ) -> DesignReview:
        """Run design review as a single ReAct loop (24GB+ VRAM path)."""
        user_message = (
            "Please review the following PCB design.\n\n"
            f"## Board Design\n```json\n{json.dumps(board, indent=2, default=str)}\n```\n\n"
            f"## Schematic\n```json\n{json.dumps(schematic, indent=2, default=str)}\n```\n\n"
            "Produce a complete design review following the output schema. "
            "Use available tools to verify your findings."
        )

        raw_output = await self._run_react_loop(
            system_prompt=DESIGN_REVIEW_PROMPT,
            user_message=user_message,
            task_type="design_review",
        )

        # Gate 1: Schema validation
        validation_errors: list[str] = []
        validation_result = self._schema_validator.validate(raw_output, "review")
        if not validation_result.valid:
            validation_errors.extend(validation_result.errors)

        parsed = self._try_parse_json(raw_output)

        # Gate 2: Confidence scoring
        all_findings: list[dict[str, Any]] = []
        for finding in parsed.get("findings", []):
            finding["_item_type"] = "finding"
            all_findings.append(finding)

        flagged_items = self._confidence_checker.check(all_findings)

        # Gate 3: Citation checking
        for item in all_findings:
            is_cited, missing = self._citation_checker.check(item)
            if not is_cited:
                item_title = item.get("title", "unknown")
                validation_errors.append(
                    f"Missing citation for finding '{item_title}': {', '.join(missing)}"
                )

        return DesignReview(
            raw_output=parsed,
            summary=parsed.get("summary", {}),
            findings=parsed.get("findings", []),
            category_summaries=parsed.get("category_summaries", {}),
            validation_passed=len(validation_errors) == 0,
            validation_errors=validation_errors,
        )

    async def generate_constraints(
        self,
        schematic: dict[str, Any],
        components: list[dict[str, Any]],
        board_params: dict[str, Any] | None = None,
    ) -> ConstraintSet:
        """Generate PCB design constraints from a schematic and component list.

        Executes the ReAct loop with the constraint generation prompt. The LLM
        analyzes component interfaces, looks up datasheets, calculates impedances,
        and produces a structured constraint set. Output passes through all 3
        validation gates.

        Args:
            schematic: Serialized SchematicDesign dict.
            components: List of component dicts with specs/datasheet info.
            board_params: Optional board parameters (layer count, stackup, etc.).

        Returns:
            ConstraintSet with net classes, diff pairs, length groups, and flags.
        """
        parts = [
            "Analyze the following schematic and generate a complete PCB constraint set.\n",
            f"## Schematic\n```json\n{json.dumps(schematic, indent=2, default=str)}\n```\n",
            f"## Components\n```json\n{json.dumps(components, indent=2, default=str)}\n```\n",
        ]
        if board_params:
            parts.append(
                f"## Board Parameters\n```json\n{json.dumps(board_params, indent=2, default=str)}\n```\n"
            )
        parts.append(
            "Generate constraints following the output schema. Use tools to look up "
            "datasheets and calculate impedances. Cite every constraint."
        )
        user_message = "\n".join(parts)

        raw_output = await self._run_react_loop(
            system_prompt=CONSTRAINT_GEN_PROMPT,
            user_message=user_message,
            task_type="constraint_generation",
        )

        # Gate 1: Schema validation
        validation_errors: list[str] = []
        validation_result = self._schema_validator.validate(raw_output, "constraint")
        if not validation_result.valid:
            validation_errors.extend(validation_result.errors)

        parsed = self._try_parse_json(raw_output)

        # Gate 2: Confidence scoring
        all_items: list[dict[str, Any]] = []
        for nc in parsed.get("net_classes", []):
            nc["_item_type"] = "net_class"
            all_items.append(nc)
        for dp in parsed.get("diff_pairs", []):
            dp["_item_type"] = "diff_pair"
            all_items.append(dp)
        for sr in parsed.get("special_rules", []):
            sr["_item_type"] = "special_rule"
            all_items.append(sr)

        flagged_items = self._confidence_checker.check(all_items)

        # Gate 3: Citation checking
        for item in all_items:
            is_cited, missing = self._citation_checker.check(item)
            if not is_cited:
                item_name = item.get("name", "unknown")
                validation_errors.append(
                    f"Missing citation for '{item_name}': {', '.join(missing)}"
                )

        return ConstraintSet(
            raw_output=parsed,
            net_classes=parsed.get("net_classes", []),
            diff_pairs=parsed.get("diff_pairs", []),
            length_groups=parsed.get("length_groups", []),
            special_rules=parsed.get("special_rules", []),
            metadata=parsed.get("metadata", {}),
            validation_passed=len(validation_errors) == 0,
            validation_errors=validation_errors,
            flagged_items=[f for f in flagged_items],
        )

    async def chat(
        self,
        message: str,
        context: dict[str, Any] | None = None,
    ) -> ChatResponse:
        """Interactive chat for design questions and guidance.

        Provides a conversational interface where the engineer can ask questions
        about their design. The agent has access to all tools and can look up
        standards, calculate impedances, and run DRC checks.

        Args:
            message: The user's chat message.
            context: Optional context dict (current board state, schematic, etc.).

        Returns:
            ChatResponse with the assistant's message and tool call log.
        """
        chat_system = (
            "You are RouteAI, an expert PCB design assistant. You help engineers "
            "with design questions, constraint selection, impedance calculations, "
            "DRC interpretation, and general PCB layout guidance.\n\n"
            "You have access to tools for impedance calculation, IPC clearance lookup, "
            "DRC checking, datasheet search, stackup suggestions, and component search.\n\n"
            "Always cite IPC standards, datasheets, or physics equations to support "
            "your recommendations. Be precise with numbers and units."
        )

        user_parts = [message]
        if context:
            user_parts.append(
                f"\n\n## Current Design Context\n```json\n"
                f"{json.dumps(context, indent=2, default=str)}\n```"
            )

        state = await self._execute_react_loop(
            system_prompt=chat_system,
            user_message="\n".join(user_parts),
            task_type="chat",
        )

        return ChatResponse(
            message=state.final_text,
            tool_calls_made=state.tool_calls,
            context_used=[tc.get("tool_name", "") for tc in state.tool_calls],
        )

    # ------------------------------------------------------------------
    # ReAct loop implementation
    # ------------------------------------------------------------------

    async def _run_react_loop(
        self,
        system_prompt: str,
        user_message: str,
        task_type: str = "chat",
    ) -> str:
        """Execute a ReAct loop and return the final text output.

        This is the main entry point for structured output tasks (design review,
        constraint generation, routing strategy). It returns the raw text that
        should be parsed as JSON.
        """
        state = await self._execute_react_loop(
            system_prompt, user_message, task_type=task_type,
        )
        return state.final_text

    async def _execute_react_loop(
        self,
        system_prompt: str,
        user_message: str,
        task_type: str = "chat",
    ) -> _ReActState:
        """Core ReAct loop: observe -> think -> act -> observe.

        Sends the initial message to the LLM provider (Ollama, Claude, or
        Gemini via the router), then iteratively processes tool calls until
        the LLM produces a final response (no more tool calls) or the
        iteration limit is reached.

        Integrates ReActState for:
        - Tool call deduplication (returns cached results for repeated calls)
        - Progress tracking (breaks loop after consecutive stale iterations)
        - State prompt injection (gives the LLM iteration/progress awareness)

        Works with ANY provider via the unified LLMResponse:
        - Providers with native tool-use (Anthropic) return tool_calls directly.
        - Providers without native tool-use (Ollama, Gemini) extract tool_calls
          from the text output.

        Returns the final _ReActState with all accumulated context.
        """
        await self._ensure_initialized()

        state = _ReActState()
        state.messages = [{"role": "user", "content": user_message}]

        # Initialize ReAct state management (deduplication + progress tracking)
        react_state = ReActState(max_iterations=MAX_REACT_ITERATIONS)

        tool_schemas = get_tool_schemas()

        while not state.finished and state.iterations < MAX_REACT_ITERATIONS:
            state.iterations += 1
            react_state.iteration = state.iterations
            logger.debug(
                "ReAct iteration %d/%d", state.iterations, MAX_REACT_ITERATIONS
            )

            # Build augmented system prompt with ReAct state context
            augmented_system = system_prompt + react_state.build_state_prompt()

            # OBSERVE + THINK: Send current conversation to the LLM
            try:
                response = await self._generate(
                    messages=state.messages,
                    system=augmented_system,
                    tools=tool_schemas,
                    task_type=task_type,
                )
            except Exception as exc:
                logger.error("LLM generation error: %s", exc)
                state.finished = True
                state.final_text = json.dumps({
                    "error": f"LLM error: {exc}",
                    "partial_tool_calls": state.tool_calls,
                })
                break

            # Build assistant message content for conversation history.
            # For providers with native tools, we reconstruct the Anthropic
            # content-block format so tool_result messages stay compatible.
            assistant_content: list[dict[str, Any]] = []
            if response.text:
                assistant_content.append({
                    "type": "text",
                    "text": response.text,
                })

            for tc in response.tool_calls:
                assistant_content.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments,
                })

            state.messages.append({
                "role": "assistant",
                "content": assistant_content,
            })

            # ACT: If there are tool calls, execute them
            new_findings_this_iteration = 0

            if response.tool_calls:
                tool_results: list[dict[str, Any]] = []

                for tool_call in response.tool_calls:
                    tool_name = tool_call.name
                    tool_input = tool_call.arguments
                    tool_id = tool_call.id

                    # --- Deduplication: check if we already have this result ---
                    if react_state.is_duplicate(tool_name, tool_input):
                        cached_msg = react_state.register_call(
                            tool_name, tool_input, "",
                        )
                        logger.info(
                            "Skipping duplicate tool call: %s(%s)",
                            tool_name, tool_input,
                        )
                        result_str = cached_msg or "CACHED: duplicate call"

                        state.tool_calls.append({
                            "tool_name": tool_name,
                            "tool_input": tool_input,
                            "tool_result": {"status": "cached", "message": result_str},
                        })
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": result_str,
                        })
                        continue

                    # --- Execute the tool normally ---
                    logger.info("Executing tool: %s(%s)", tool_name, tool_input)

                    handler = get_tool_handler(tool_name)
                    if handler is None:
                        result = {"status": "error", "message": f"Unknown tool: {tool_name}"}
                    else:
                        try:
                            result = await handler(**tool_input)
                        except Exception as exc:
                            logger.error("Tool %s raised: %s", tool_name, exc)
                            result = {"status": "error", "message": str(exc)}

                    result_str = json.dumps(result, default=str)

                    # Register the call in ReActState for future dedup
                    react_state.register_call(tool_name, tool_input, result_str)

                    # Count results that look like they contain useful data
                    if isinstance(result, dict) and result.get("status") == "ok":
                        new_findings_this_iteration += 1

                    state.tool_calls.append({
                        "tool_name": tool_name,
                        "tool_input": tool_input,
                        "tool_result": result,
                    })

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": result_str,
                    })

                # OBSERVE: Feed tool results back into the conversation
                state.messages.append({
                    "role": "user",
                    "content": tool_results,
                })
            else:
                # No tool calls means the LLM has finished reasoning
                state.finished = True
                state.final_text = response.text

            # Check stop reason
            if response.stop_reason == "end_turn" and not response.tool_calls:
                state.finished = True
                state.final_text = response.text

            # --- Progress tracking: break on stale iterations ---
            if not state.finished:
                stop_msg = react_state.update_progress(new_findings_this_iteration)
                if stop_msg is not None:
                    logger.warning("ReAct progress stall: %s", stop_msg)
                    state.finished = True
                    if not state.final_text:
                        state.final_text = json.dumps({
                            "error": stop_msg,
                            "iterations": state.iterations,
                            "tool_calls_made": len(state.tool_calls),
                        })

        if not state.finished:
            logger.warning(
                "ReAct loop hit iteration limit (%d). Returning partial output.",
                MAX_REACT_ITERATIONS,
            )
            # Collect whatever text we have
            if not state.final_text:
                state.final_text = json.dumps({
                    "error": "ReAct loop iteration limit reached",
                    "iterations": state.iterations,
                    "tool_calls_made": len(state.tool_calls),
                })

        return state

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _try_parse_json(text: str) -> dict[str, Any]:
        """Attempt to parse JSON from LLM output, handling markdown code fences."""
        cleaned = text.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            # Remove opening fence (possibly with language tag)
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        cleaned = cleaned.strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to find JSON object in the text
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(cleaned[start:end + 1])
                except json.JSONDecodeError:
                    pass

            logger.warning("Failed to parse JSON from LLM output")
            return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}

    async def generate_placement_intent(
        self,
        board: dict[str, Any] | str,
        schematic: dict[str, Any] | str,
    ) -> Any:
        """Generate placement intent DSL for the C++ solver.

        Emits a ``PlacementIntent`` model containing zones, critical pairs,
        keepouts, and ground plane requirements -- **no coordinates**.  Uses
        ``task_type="placement_strategy"`` so the ``ModelManager`` selects the
        T2 model on VRAM-constrained systems.

        Args:
            board: Serialized ``BoardDesign`` dict (or JSON string).
            schematic: Serialized ``SchematicDesign`` dict (or JSON string).

        Returns:
            A validated ``PlacementIntent`` Pydantic model.
        """
        await self._ensure_initialized()

        from routeai_intelligence.placement.strategy import (
            generate_placement_intent as _gen_intent,
        )

        # The function requires an LLMRouter. If only a direct provider is
        # configured, wrap it in a minimal router-like interface.
        router = self._llm_router
        if router is None and self._llm_provider is not None:
            # Create a temporary router and inject our provider
            router = LLMRouter()
            router.add_provider(self._llm_provider, primary=True)
            router._initialized = True  # noqa: SLF001

        if router is None:
            raise RuntimeError("No LLM provider or router configured.")

        return await _gen_intent(
            llm_router=router,
            board_data=board,
            schematic_data=schematic,
        )

    async def generate_routing_strategy(
        self,
        board: dict[str, Any],
        constraints: dict[str, Any],
        schematic: dict[str, Any],
    ) -> dict[str, Any]:
        """Generate a routing strategy for the automated router.

        Args:
            board: Serialized BoardDesign dict.
            constraints: Serialized ConstraintSet dict.
            schematic: Serialized SchematicDesign dict.

        Returns:
            Validated routing strategy dict conforming to routing_schema.json.
        """
        user_message = (
            "Generate a routing strategy for the following design.\n\n"
            f"## Board Design\n```json\n{json.dumps(board, indent=2, default=str)}\n```\n\n"
            f"## Constraints\n```json\n{json.dumps(constraints, indent=2, default=str)}\n```\n\n"
            f"## Schematic\n```json\n{json.dumps(schematic, indent=2, default=str)}\n```\n\n"
            "Produce a routing strategy following the output schema. "
            "Use tools to verify impedance targets are achievable."
        )

        raw_output = await self._run_react_loop(
            system_prompt=ROUTING_STRATEGY_PROMPT,
            user_message=user_message,
            task_type="routing_director",
        )

        # Validate
        validation_result = self._schema_validator.validate(raw_output, "routing")
        parsed = self._try_parse_json(raw_output)

        if not validation_result.valid:
            parsed["_validation_errors"] = validation_result.errors

        return parsed

    async def generate_routing_intent(
        self,
        board: dict[str, Any],
        constraints: dict[str, Any],
        schematic: dict[str, Any],
        board_id: str = "",
    ) -> Any:
        """Generate a RoutingIntent DSL for the C++ routing solver.

        Produces a ``RoutingIntent`` model containing net classes, routing
        order, layer assignments, cost weights, and voltage drop targets --
        **no coordinates or trace paths**.  Uses ``task_type="routing_director"``
        so the ``ModelManager`` selects the T2 model on VRAM-constrained systems.

        This is the new-format counterpart to ``generate_routing_strategy()``.
        The old method returns a free-form dict; this one returns a validated
        Pydantic ``RoutingIntent`` model that the C++ solver consumes directly.

        Args:
            board: Serialized ``BoardDesign`` dict.
            constraints: Serialized ``ConstraintSet`` dict.
            schematic: Serialized ``SchematicDesign`` dict.
            board_id: Optional board identifier to embed in the intent.

        Returns:
            A validated ``RoutingIntent`` Pydantic model.
        """
        await self._ensure_initialized()

        from routeai_intelligence.agent.routing_director import RoutingDirector

        # Build the routing director with the same temperature/token settings
        director = RoutingDirector(
            api_key=self._legacy_api_key,
            model=self._legacy_model,
            max_tokens=self._max_tokens,
            temperature=self._temperature,
        )

        # Prefer LLMRouter for VRAM-aware model selection
        router = self._llm_router
        if router is None and self._llm_provider is not None:
            router = LLMRouter()
            router.add_provider(self._llm_provider, primary=True)
            router._initialized = True  # noqa: SLF001

        return await director.generate_routing_intent(
            board_state=board,
            schematic_info=schematic,
            constraints=constraints,
            board_id=board_id,
            llm_router=router,
        )
