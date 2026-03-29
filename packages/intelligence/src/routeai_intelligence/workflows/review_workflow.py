"""Temporal workflow for the design review pipeline.

Pipeline steps:
  1. ParseProject  - Parse the uploaded PCB file into structured data
  2. RunDRC        - Run Design Rule Checks against the parsed board
  3. RunLLMReview  - LLM-powered analysis of the design
  4. RunPhysicsChecks - Impedance, thermal, and current capacity checks
  5. MergeReports  - Combine all results into a unified review report

Each step is a Temporal activity with retry policy (max 3 attempts, exponential
backoff). The workflow supports progress queries and cancellation.
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
        LLMReviewInput,
        MergeReportsInput,
        ParseProjectInput,
        PhysicsChecksInput,
        merge_reports,
        parse_project,
        run_drc,
        run_llm_review,
        run_physics_checks,
    )

logger = logging.getLogger(__name__)


class ReviewStep(str, Enum):
    PENDING = "pending"
    PARSING = "parsing"
    DRC = "drc"
    LLM_REVIEW = "llm_review"
    PHYSICS_CHECKS = "physics_checks"
    MERGING = "merging"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclasses.dataclass
class ReviewWorkflowInput:
    project_id: str
    file_path: str
    file_format: str
    rule_set: str = "default"
    review_scope: list[str] = dataclasses.field(
        default_factory=lambda: ["power_integrity", "signal_integrity", "thermal"]
    )
    physics_checks: list[str] = dataclasses.field(
        default_factory=lambda: ["impedance", "thermal", "current_capacity"]
    )


@dataclasses.dataclass
class ReviewProgress:
    step: ReviewStep
    percent_complete: float
    message: str
    elapsed_seconds: float = 0.0


ACTIVITY_RETRY_POLICY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_attempts=3,
    maximum_interval=timedelta(seconds=30),
)


@workflow.defn
class ReviewWorkflow:
    """Temporal workflow that orchestrates the full design review pipeline."""

    def __init__(self) -> None:
        self._progress = ReviewProgress(
            step=ReviewStep.PENDING,
            percent_complete=0.0,
            message="Waiting to start",
        )
        self._cancelled = False

    @workflow.query
    def progress(self) -> ReviewProgress:
        """Return current workflow progress. Callable via Temporal query."""
        return self._progress

    @workflow.signal
    async def cancel_review(self) -> None:
        """Signal handler to request graceful cancellation."""
        self._cancelled = True
        self._progress = ReviewProgress(
            step=ReviewStep.CANCELLED,
            percent_complete=self._progress.percent_complete,
            message="Cancellation requested",
        )

    def _update_progress(self, step: ReviewStep, pct: float, msg: str) -> None:
        self._progress = ReviewProgress(
            step=step,
            percent_complete=pct,
            message=msg,
        )

    def _check_cancelled(self) -> None:
        if self._cancelled:
            raise workflow.ContinueAsNewError(
                args=[], workflow="ReviewWorkflow"
            ) from None

    @workflow.run
    async def run(self, input: ReviewWorkflowInput) -> dict[str, Any]:
        """Execute the full review pipeline.

        Returns the merged review report as a dict.
        """
        # Step 1: Parse project
        self._check_cancelled()
        self._update_progress(ReviewStep.PARSING, 5.0, "Parsing project file")

        parse_result = await workflow.execute_activity(
            parse_project,
            ParseProjectInput(
                project_id=input.project_id,
                file_path=input.file_path,
                file_format=input.file_format,
            ),
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=ACTIVITY_RETRY_POLICY,
            heartbeat_timeout=timedelta(seconds=30),
        )
        board_data = {
            "board_outline": parse_result.board_outline,
            "components": parse_result.components,
            "nets": parse_result.nets,
            "layer_count": parse_result.layer_count,
        }

        # Step 2: Run DRC
        self._check_cancelled()
        self._update_progress(ReviewStep.DRC, 25.0, "Running Design Rule Checks")

        drc_result = await workflow.execute_activity(
            run_drc,
            DRCInput(
                project_id=input.project_id,
                board_data=board_data,
                rule_set=input.rule_set,
            ),
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=ACTIVITY_RETRY_POLICY,
            heartbeat_timeout=timedelta(seconds=30),
        )
        drc_data = {
            "violations": drc_result.violations,
            "warnings": drc_result.warnings,
            "passed": drc_result.passed,
            "summary": drc_result.summary,
        }

        # Step 3: Run LLM Review
        self._check_cancelled()
        self._update_progress(ReviewStep.LLM_REVIEW, 45.0, "Running LLM design review")

        llm_result = await workflow.execute_activity(
            run_llm_review,
            LLMReviewInput(
                project_id=input.project_id,
                board_data=board_data,
                drc_results=drc_data,
                review_scope=input.review_scope,
            ),
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=ACTIVITY_RETRY_POLICY,
            heartbeat_timeout=timedelta(seconds=60),
        )
        llm_data = {
            "findings": llm_result.findings,
            "suggestions": llm_result.suggestions,
            "confidence_scores": llm_result.confidence_scores,
            "token_usage": llm_result.token_usage,
        }

        # Step 4: Run Physics Checks
        self._check_cancelled()
        self._update_progress(ReviewStep.PHYSICS_CHECKS, 65.0, "Running physics checks")

        physics_result = await workflow.execute_activity(
            run_physics_checks,
            PhysicsChecksInput(
                project_id=input.project_id,
                board_data=board_data,
                check_types=input.physics_checks,
            ),
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=ACTIVITY_RETRY_POLICY,
            heartbeat_timeout=timedelta(seconds=30),
        )
        physics_data = {
            "impedance_results": physics_result.impedance_results,
            "thermal_results": physics_result.thermal_results,
            "current_capacity_results": physics_result.current_capacity_results,
            "all_passed": physics_result.all_passed,
        }

        # Step 5: Merge Reports
        self._check_cancelled()
        self._update_progress(ReviewStep.MERGING, 85.0, "Merging review reports")

        merge_result = await workflow.execute_activity(
            merge_reports,
            MergeReportsInput(
                project_id=input.project_id,
                drc_results=drc_data,
                llm_review=llm_data,
                physics_results=physics_data,
            ),
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=ACTIVITY_RETRY_POLICY,
            heartbeat_timeout=timedelta(seconds=15),
        )

        self._update_progress(ReviewStep.COMPLETED, 100.0, "Review complete")

        return merge_result.merged_report
