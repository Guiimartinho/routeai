"""Temporal workflow for routing job orchestration.

Pipeline steps (iterative):
  1. GenerateStrategy  - LLM generates or adjusts a routing strategy
  2. ExecuteRouting    - C++ router executes the strategy via gRPC
  3. RunDRC            - Validate the routed result
  4. If routing incomplete or DRC fails, AdjustStrategy (up to 3 iterations)
  5. ReturnResults     - Final routed board and DRC report

Each step is a Temporal activity with retry policy (max 3 attempts, exponential
backoff). The workflow supports progress queries and streaming updates.
"""

from __future__ import annotations

import dataclasses
import logging
from datetime import timedelta
from enum import Enum
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from routeai_intelligence.workflows.activities import (
        DRCInput,
        ExecuteRoutingInput,
        GenerateStrategyInput,
        execute_routing,
        generate_strategy,
        run_drc,
    )

logger = logging.getLogger(__name__)

MAX_ROUTING_ITERATIONS = 3
ROUTING_COMPLETION_THRESHOLD = 100.0


class RoutingStep(str, Enum):
    PENDING = "pending"
    GENERATING_STRATEGY = "generating_strategy"
    EXECUTING_ROUTING = "executing_routing"
    RUNNING_DRC = "running_drc"
    ADJUSTING_STRATEGY = "adjusting_strategy"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclasses.dataclass
class RoutingWorkflowInput:
    project_id: str
    board_data: dict[str, Any]
    constraints: dict[str, Any]
    rule_set: str = "default"


@dataclasses.dataclass
class RoutingProgress:
    step: RoutingStep
    iteration: int
    max_iterations: int
    percent_complete: float
    completion_pct: float
    message: str
    unrouted_nets: list[str] = dataclasses.field(default_factory=list)


ACTIVITY_RETRY_POLICY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_attempts=3,
    maximum_interval=timedelta(seconds=30),
)


@workflow.defn
class RoutingWorkflow:
    """Temporal workflow that orchestrates iterative PCB routing."""

    def __init__(self) -> None:
        self._progress = RoutingProgress(
            step=RoutingStep.PENDING,
            iteration=0,
            max_iterations=MAX_ROUTING_ITERATIONS,
            percent_complete=0.0,
            completion_pct=0.0,
            message="Waiting to start",
        )
        self._cancelled = False

    @workflow.query
    def progress(self) -> RoutingProgress:
        """Return current routing progress. Callable via Temporal query."""
        return self._progress

    @workflow.signal
    async def cancel_routing(self) -> None:
        """Signal handler to request graceful cancellation."""
        self._cancelled = True
        self._progress.step = RoutingStep.CANCELLED
        self._progress.message = "Cancellation requested"

    def _update_progress(
        self,
        step: RoutingStep,
        iteration: int,
        pct: float,
        completion_pct: float,
        msg: str,
        unrouted: list[str] | None = None,
    ) -> None:
        self._progress = RoutingProgress(
            step=step,
            iteration=iteration,
            max_iterations=MAX_ROUTING_ITERATIONS,
            percent_complete=pct,
            completion_pct=completion_pct,
            message=msg,
            unrouted_nets=unrouted or [],
        )

    def _check_cancelled(self) -> None:
        if self._cancelled:
            raise workflow.ContinueAsNewError(
                args=[], workflow="RoutingWorkflow"
            ) from None

    @workflow.run
    async def run(self, input: RoutingWorkflowInput) -> dict[str, Any]:
        """Execute the iterative routing pipeline.

        Returns the final routing result including routed board and DRC report.
        """
        previous_attempt: dict[str, Any] | None = None
        best_result: dict[str, Any] = {}
        best_completion: float = 0.0

        for iteration in range(1, MAX_ROUTING_ITERATIONS + 1):
            self._check_cancelled()

            # --- Step 1: Generate / adjust strategy ---
            step_label = "Adjusting" if previous_attempt else "Generating"
            step_enum = RoutingStep.ADJUSTING_STRATEGY if previous_attempt else RoutingStep.GENERATING_STRATEGY
            base_pct = ((iteration - 1) / MAX_ROUTING_ITERATIONS) * 100
            self._update_progress(
                step_enum, iteration, base_pct + 5, best_completion,
                f"{step_label} routing strategy (iteration {iteration}/{MAX_ROUTING_ITERATIONS})",
            )

            strategy_result = await workflow.execute_activity(
                generate_strategy,
                GenerateStrategyInput(
                    project_id=input.project_id,
                    board_data=input.board_data,
                    constraints=input.constraints,
                    previous_attempt=previous_attempt,
                ),
                start_to_close_timeout=timedelta(seconds=300),
                retry_policy=ACTIVITY_RETRY_POLICY,
                heartbeat_timeout=timedelta(seconds=60),
            )

            # --- Step 2: Execute routing ---
            self._check_cancelled()
            self._update_progress(
                RoutingStep.EXECUTING_ROUTING, iteration, base_pct + 30, best_completion,
                f"Executing routing (iteration {iteration}/{MAX_ROUTING_ITERATIONS})",
            )

            routing_result = await workflow.execute_activity(
                execute_routing,
                ExecuteRoutingInput(
                    project_id=input.project_id,
                    board_data=input.board_data,
                    strategy=strategy_result.strategy,
                ),
                start_to_close_timeout=timedelta(seconds=300),
                retry_policy=ACTIVITY_RETRY_POLICY,
                heartbeat_timeout=timedelta(seconds=60),
            )

            current_completion = routing_result.completion_pct
            if current_completion > best_completion:
                best_completion = current_completion
                best_result = {
                    "routed_board": routing_result.routed_board,
                    "completion_pct": routing_result.completion_pct,
                    "unrouted_nets": routing_result.unrouted_nets,
                    "strategy": strategy_result.strategy,
                    "iteration": iteration,
                }

            # --- Step 3: Run DRC on routed result ---
            self._check_cancelled()
            self._update_progress(
                RoutingStep.RUNNING_DRC, iteration, base_pct + 60, current_completion,
                f"Validating routed board (iteration {iteration}/{MAX_ROUTING_ITERATIONS})",
                unrouted=routing_result.unrouted_nets,
            )

            drc_result = await workflow.execute_activity(
                run_drc,
                DRCInput(
                    project_id=input.project_id,
                    board_data=routing_result.routed_board,
                    rule_set=input.rule_set,
                ),
                start_to_close_timeout=timedelta(seconds=300),
                retry_policy=ACTIVITY_RETRY_POLICY,
                heartbeat_timeout=timedelta(seconds=30),
            )

            # Check if routing is complete and DRC passes
            if current_completion >= ROUTING_COMPLETION_THRESHOLD and drc_result.passed:
                self._update_progress(
                    RoutingStep.COMPLETED, iteration, 100.0, current_completion,
                    f"Routing complete after {iteration} iteration(s)",
                )
                return {
                    "status": "completed",
                    "routed_board": routing_result.routed_board,
                    "completion_pct": current_completion,
                    "unrouted_nets": routing_result.unrouted_nets,
                    "drc": {
                        "violations": drc_result.violations,
                        "warnings": drc_result.warnings,
                        "passed": drc_result.passed,
                        "summary": drc_result.summary,
                    },
                    "strategy": strategy_result.strategy,
                    "iterations_used": iteration,
                }

            # Prepare for next iteration
            previous_attempt = {
                "routed_board": routing_result.routed_board,
                "completion_pct": current_completion,
                "unrouted_nets": routing_result.unrouted_nets,
                "drc_violations": drc_result.violations,
                "drc_warnings": drc_result.warnings,
                "strategy": strategy_result.strategy,
            }

        # Exhausted all iterations - return best result
        self._update_progress(
            RoutingStep.COMPLETED, MAX_ROUTING_ITERATIONS, 100.0, best_completion,
            f"Routing finished after {MAX_ROUTING_ITERATIONS} iterations (best: {best_completion:.1f}% complete)",
            unrouted=best_result.get("unrouted_nets", []),
        )

        return {
            "status": "partial" if best_completion < ROUTING_COMPLETION_THRESHOLD else "completed",
            "routed_board": best_result.get("routed_board", {}),
            "completion_pct": best_completion,
            "unrouted_nets": best_result.get("unrouted_nets", []),
            "drc": {
                "violations": drc_result.violations,
                "warnings": drc_result.warnings,
                "passed": drc_result.passed,
                "summary": drc_result.summary,
            },
            "strategy": best_result.get("strategy", {}),
            "iterations_used": MAX_ROUTING_ITERATIONS,
        }
