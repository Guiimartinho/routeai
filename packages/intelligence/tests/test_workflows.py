"""Tests for Temporal workflow activities and review workflow.

Tests activity functions with mocked external calls, workflow pipeline
ordering, and retry behavior configuration.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.workflows.activities import (
    DRCInput,
    DRCOutput,
    ExecuteRoutingInput,
    ExecuteRoutingOutput,
    GenerateStrategyInput,
    GenerateStrategyOutput,
    LLMReviewInput,
    LLMReviewOutput,
    MergeReportsInput,
    MergeReportsOutput,
    ParseProjectInput,
    ParseProjectOutput,
    PhysicsChecksInput,
    PhysicsChecksOutput,
)
from routeai_intelligence.workflows.review_workflow import (
    ACTIVITY_RETRY_POLICY,
    ReviewProgress,
    ReviewStep,
    ReviewWorkflow,
    ReviewWorkflowInput,
)


# ---------------------------------------------------------------------------
# Activity Data Class Tests
# ---------------------------------------------------------------------------


class TestActivityDataClasses:
    """Test that activity input/output data classes are well-formed."""

    def test_parse_project_input(self):
        inp = ParseProjectInput(
            project_id="proj-1",
            file_path="/tmp/board.kicad_pcb",
            file_format="kicad",
        )
        assert inp.project_id == "proj-1"
        assert inp.file_format == "kicad"

    def test_parse_project_output(self):
        out = ParseProjectOutput(
            project_id="proj-1",
            board_outline={"width": 100, "height": 80},
            components=[{"reference": "U1"}],
            nets=[{"name": "VCC"}],
            layer_count=4,
        )
        assert out.layer_count == 4
        assert len(out.components) == 1

    def test_drc_input_output(self):
        inp = DRCInput(
            project_id="proj-1",
            board_data={"components": []},
            rule_set="ipc_class_2",
        )
        assert inp.rule_set == "ipc_class_2"

        out = DRCOutput(
            project_id="proj-1",
            violations=[],
            warnings=[{"msg": "test"}],
            passed=True,
            summary="0 violations, 1 warning",
        )
        assert out.passed is True
        assert len(out.warnings) == 1

    def test_llm_review_input_output(self):
        inp = LLMReviewInput(
            project_id="proj-1",
            board_data={},
            drc_results={},
            review_scope=["power_integrity", "signal_integrity"],
        )
        assert "power_integrity" in inp.review_scope

        out = LLMReviewOutput(
            project_id="proj-1",
            findings=[{"severity": "warning"}],
            suggestions=[],
            confidence_scores={"overall": 0.9},
            token_usage={"prompt": 1000, "completion": 500},
        )
        assert len(out.findings) == 1

    def test_physics_checks_input_output(self):
        inp = PhysicsChecksInput(
            project_id="proj-1",
            board_data={},
            check_types=["impedance", "thermal"],
        )
        assert "impedance" in inp.check_types

        out = PhysicsChecksOutput(
            project_id="proj-1",
            impedance_results=[],
            thermal_results=[{"passed": True}],
            current_capacity_results=[],
            all_passed=True,
        )
        assert out.all_passed is True

    def test_merge_reports_input_output(self):
        inp = MergeReportsInput(
            project_id="proj-1",
            drc_results={"violations": []},
            llm_review={"findings": []},
            physics_results={"impedance_results": []},
        )
        assert "violations" in inp.drc_results

        out = MergeReportsOutput(
            project_id="proj-1",
            merged_report={"sections": {}},
            overall_score=95.0,
            critical_issues=0,
            warnings=2,
        )
        assert out.overall_score == 95.0

    def test_generate_strategy_input_output(self):
        inp = GenerateStrategyInput(
            project_id="proj-1",
            board_data={},
            constraints={},
            previous_attempt=None,
        )
        assert inp.previous_attempt is None

        out = GenerateStrategyOutput(
            project_id="proj-1",
            strategy={"routing_order": []},
            estimated_completion_pct=85.0,
        )
        assert out.estimated_completion_pct == 85.0

    def test_execute_routing_input_output(self):
        inp = ExecuteRoutingInput(
            project_id="proj-1",
            board_data={},
            strategy={},
        )
        assert inp.project_id == "proj-1"

        out = ExecuteRoutingOutput(
            project_id="proj-1",
            routed_board={"traces": []},
            completion_pct=100.0,
            unrouted_nets=[],
        )
        assert out.completion_pct == 100.0
        assert len(out.unrouted_nets) == 0


# ---------------------------------------------------------------------------
# Merge Reports Activity Logic Tests
# ---------------------------------------------------------------------------


class TestMergeReportsLogic:
    """Test the merge_reports activity logic directly."""

    @pytest.mark.asyncio
    async def test_merge_reports_scoring(self):
        """merge_reports should compute overall score correctly."""
        # We test the logic by importing and calling with mocked heartbeat
        from routeai_intelligence.workflows.activities import merge_reports as _merge_reports

        inp = MergeReportsInput(
            project_id="test",
            drc_results={
                "violations": [
                    {"severity": "critical"},
                    {"severity": "warning"},
                ],
            },
            llm_review={
                "findings": [
                    {"severity": "warning"},
                ],
            },
            physics_results={
                "impedance_results": [{"passed": True}],
                "thermal_results": [],
                "current_capacity_results": [],
            },
        )

        with patch("routeai_intelligence.workflows.activities.activity"):
            result = await _merge_reports(inp)

        assert isinstance(result, MergeReportsOutput)
        assert result.critical_issues == 1
        assert result.warnings >= 2
        assert 0 <= result.overall_score <= 100

    @pytest.mark.asyncio
    async def test_merge_reports_no_issues(self):
        """No issues should produce 100% score."""
        from routeai_intelligence.workflows.activities import merge_reports as _merge_reports

        inp = MergeReportsInput(
            project_id="test",
            drc_results={"violations": []},
            llm_review={"findings": []},
            physics_results={
                "impedance_results": [],
                "thermal_results": [],
                "current_capacity_results": [],
            },
        )

        with patch("routeai_intelligence.workflows.activities.activity"):
            result = await _merge_reports(inp)

        assert result.overall_score == 100.0
        assert result.critical_issues == 0
        assert result.warnings == 0


# ---------------------------------------------------------------------------
# Workflow Pipeline Ordering Tests
# ---------------------------------------------------------------------------


class TestWorkflowPipelineOrdering:
    """Test that the review workflow steps execute in correct order."""

    def test_review_step_enum_values(self):
        """ReviewStep should have all pipeline stages."""
        steps = {s.value for s in ReviewStep}
        expected = {"pending", "parsing", "drc", "llm_review", "physics_checks", "merging", "completed", "failed", "cancelled"}
        assert expected == steps

    def test_initial_progress_is_pending(self):
        """Initial progress should be PENDING at 0%."""
        wf = ReviewWorkflow()
        progress = wf.progress()
        assert progress.step == ReviewStep.PENDING
        assert progress.percent_complete == 0.0

    def test_update_progress(self):
        """_update_progress should update step, pct, and message."""
        wf = ReviewWorkflow()
        wf._update_progress(ReviewStep.DRC, 25.0, "Running DRC")
        progress = wf.progress()
        assert progress.step == ReviewStep.DRC
        assert progress.percent_complete == 25.0
        assert progress.message == "Running DRC"

    def test_workflow_input_defaults(self):
        """ReviewWorkflowInput should have sensible defaults."""
        inp = ReviewWorkflowInput(
            project_id="test",
            file_path="/tmp/board.kicad_pcb",
            file_format="kicad",
        )
        assert inp.rule_set == "default"
        assert "power_integrity" in inp.review_scope
        assert "impedance" in inp.physics_checks

    def test_cancellation_sets_cancelled_step(self):
        """Cancellation signal should set step to CANCELLED."""
        wf = ReviewWorkflow()
        wf._update_progress(ReviewStep.DRC, 30.0, "Running DRC")

        # Simulate cancel signal
        wf._cancelled = True
        wf._progress = ReviewProgress(
            step=ReviewStep.CANCELLED,
            percent_complete=30.0,
            message="Cancellation requested",
        )

        progress = wf.progress()
        assert progress.step == ReviewStep.CANCELLED
        assert progress.percent_complete == 30.0


# ---------------------------------------------------------------------------
# Retry Behavior Tests
# ---------------------------------------------------------------------------


class TestRetryBehavior:
    """Test retry policy configuration."""

    def test_retry_policy_max_attempts(self):
        assert ACTIVITY_RETRY_POLICY.maximum_attempts == 3

    def test_retry_policy_initial_interval(self):
        assert ACTIVITY_RETRY_POLICY.initial_interval == timedelta(seconds=2)

    def test_retry_policy_backoff(self):
        assert ACTIVITY_RETRY_POLICY.backoff_coefficient == 2.0

    def test_retry_policy_max_interval(self):
        assert ACTIVITY_RETRY_POLICY.maximum_interval == timedelta(seconds=30)

    def test_review_progress_dataclass(self):
        """ReviewProgress should store all fields correctly."""
        p = ReviewProgress(
            step=ReviewStep.LLM_REVIEW,
            percent_complete=45.0,
            message="Analyzing design",
            elapsed_seconds=12.5,
        )
        assert p.step == ReviewStep.LLM_REVIEW
        assert p.percent_complete == 45.0
        assert p.elapsed_seconds == 12.5


# ---------------------------------------------------------------------------
# Activity Function Error Handling Tests
# ---------------------------------------------------------------------------


class TestActivityErrorHandling:
    """Test error handling in activity functions."""

    @pytest.mark.asyncio
    async def test_parse_project_unsupported_format(self):
        """parse_project should raise ValueError for unsupported formats."""
        from routeai_intelligence.workflows.activities import parse_project

        inp = ParseProjectInput(
            project_id="test",
            file_path="/tmp/board.brd",
            file_format="altium",
        )

        with patch("routeai_intelligence.workflows.activities.activity"):
            with pytest.raises(ValueError, match="Unsupported file format"):
                await parse_project(inp)
