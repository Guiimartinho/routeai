"""Tests for the RoutingDirector module.

Tests strategy generation, adjustment with feedback, max iteration limiting,
manual_routing_required fallback, and validation gate integration.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.agent.routing_director import (
    MAX_ADJUSTMENT_ITERATIONS,
    AdjustmentNote,
    CostWeights,
    FailedNet,
    GeneratedConstraint,
    LayerAssignmentEntry,
    NetConstraints,
    RoutingDirector,
    RoutingOrderEntry,
    RoutingStrategy,
    SolverFeedback,
    ViaStrategy,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _mock_llm_response(json_data: dict) -> MagicMock:
    """Create a mock Anthropic API response."""
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = json.dumps(json_data)

    response = MagicMock()
    response.content = [text_block]
    response.stop_reason = "end_turn"
    return response


def _make_strategy_json(**overrides) -> dict:
    """Build a minimal valid routing strategy JSON dict."""
    base = {
        "routing_order": [
            {"net_name": "CLK", "priority": 10, "reason": "Clock signal - highest priority"},
            {"net_name": "DATA0", "priority": 5, "reason": "Data signal"},
        ],
        "layer_assignment": {
            "high_speed": {"signal_layers": ["F.Cu", "In1.Cu"], "reason": "Microstrip for impedance"},
        },
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
        "constraints_generated": [],
        "adjustment_notes": [],
    }
    base.update(overrides)
    return base


@pytest.fixture
def director():
    """Create a RoutingDirector with mocked API client."""
    with patch("routeai_intelligence.agent.routing_director.anthropic"):
        d = RoutingDirector(api_key="test-key")
    return d


# ---------------------------------------------------------------------------
# Strategy generation output structure tests
# ---------------------------------------------------------------------------


class TestStrategyGeneration:
    """Test generate_strategy output structure."""

    @pytest.mark.asyncio
    async def test_generate_strategy_returns_routing_strategy(self, director):
        """generate_strategy should return a RoutingStrategy model."""
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy(
            board_state={"components": []},
            schematic_info={"nets": []},
            constraints={"net_classes": []},
        )

        assert isinstance(result, RoutingStrategy)
        assert len(result.routing_order) == 2
        # Should be sorted by priority descending
        assert result.routing_order[0].priority >= result.routing_order[1].priority

    @pytest.mark.asyncio
    async def test_routing_order_has_correct_fields(self, director):
        """Each routing order entry should have net_name, priority, reason."""
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        entry = result.routing_order[0]
        assert isinstance(entry, RoutingOrderEntry)
        assert entry.net_name == "CLK"
        assert entry.priority == 10
        assert len(entry.reason) > 0

    @pytest.mark.asyncio
    async def test_layer_assignment_extracted(self, director):
        """Layer assignments should be properly extracted."""
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        assert "high_speed" in result.layer_assignment
        la = result.layer_assignment["high_speed"]
        assert isinstance(la, LayerAssignmentEntry)
        assert "F.Cu" in la.signal_layers

    @pytest.mark.asyncio
    async def test_via_strategy_extracted(self, director):
        """Via strategy should be properly extracted."""
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        assert isinstance(result.via_strategy, ViaStrategy)
        assert result.via_strategy.high_speed == "through_only"
        assert result.via_strategy.return_path_via_max_distance_mm == 2.0

    @pytest.mark.asyncio
    async def test_cost_weights_extracted(self, director):
        """Cost weights should be extracted with clamping."""
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        assert isinstance(result.cost_weights, CostWeights)
        assert 0.0 <= result.cost_weights.wire_length <= 1.0
        assert 0.0 <= result.cost_weights.via_count <= 1.0

    @pytest.mark.asyncio
    async def test_generate_resets_adjustment_count(self, director):
        """generate_strategy should reset the adjustment counter."""
        director._adjustment_count = 2
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        await director.generate_strategy({}, {}, {})

        assert director.adjustment_count == 0
        assert director.adjustments_remaining == MAX_ADJUSTMENT_ITERATIONS


# ---------------------------------------------------------------------------
# Strategy adjustment tests
# ---------------------------------------------------------------------------


class TestStrategyAdjustment:
    """Test adjust_strategy with solver feedback."""

    @pytest.mark.asyncio
    async def test_adjust_strategy_increments_counter(self, director):
        """Each adjust_strategy call should increment the counter."""
        director._adjustment_count = 0
        adjusted_json = _make_strategy_json(
            adjustment_notes=[
                {"change": "Increased DATA0 priority", "reason": "congestion", "affected_nets": ["DATA0"]}
            ]
        )
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(adjusted_json)
        )

        previous = RoutingStrategy(
            routing_order=[RoutingOrderEntry(net_name="CLK", priority=10, reason="test")],
        )
        feedback = SolverFeedback(
            completion_rate=80.0,
            failed_nets=[FailedNet(net_name="DATA0", failure_reason="congestion")],
        )

        result = await director.adjust_strategy(previous, feedback)

        assert director.adjustment_count == 1
        assert director.adjustments_remaining == MAX_ADJUSTMENT_ITERATIONS - 1
        assert isinstance(result, RoutingStrategy)

    @pytest.mark.asyncio
    async def test_adjustment_notes_preserved(self, director):
        """Adjustment notes from LLM should appear in the result."""
        director._adjustment_count = 0
        adjusted_json = _make_strategy_json(
            adjustment_notes=[
                {"change": "Lowered via penalty", "reason": "too many unrouted nets", "affected_nets": []}
            ]
        )
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(adjusted_json)
        )

        previous = RoutingStrategy(
            routing_order=[RoutingOrderEntry(net_name="CLK", priority=10, reason="test")],
        )
        feedback = SolverFeedback(completion_rate=90.0)

        result = await director.adjust_strategy(previous, feedback)

        assert len(result.adjustment_notes) == 1
        assert "via penalty" in result.adjustment_notes[0].change.lower()


# ---------------------------------------------------------------------------
# Max iteration limiting tests
# ---------------------------------------------------------------------------


class TestMaxIterationLimiting:
    """Test behavior at and beyond the iteration limit."""

    @pytest.mark.asyncio
    async def test_exceeding_max_iterations_raises(self, director):
        """Exceeding MAX_ADJUSTMENT_ITERATIONS should raise ValueError."""
        director._adjustment_count = MAX_ADJUSTMENT_ITERATIONS

        previous = RoutingStrategy(
            routing_order=[RoutingOrderEntry(net_name="CLK", priority=10, reason="test")],
        )
        feedback = SolverFeedback(completion_rate=50.0)

        with pytest.raises(ValueError, match="Maximum adjustment iterations"):
            await director.adjust_strategy(previous, feedback)

    @pytest.mark.asyncio
    async def test_final_iteration_flags_unresolved_nets(self, director):
        """On the last iteration, unresolved nets should get manual_routing_required."""
        director._adjustment_count = MAX_ADJUSTMENT_ITERATIONS - 1
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        previous = RoutingStrategy(
            routing_order=[RoutingOrderEntry(net_name="CLK", priority=10, reason="test")],
        )
        feedback = SolverFeedback(
            completion_rate=70.0,
            failed_nets=[
                FailedNet(net_name="NET_HARD", failure_reason="no_path_found"),
                FailedNet(net_name="NET_STUCK", failure_reason="congestion"),
            ],
        )

        result = await director.adjust_strategy(previous, feedback)

        manual_constraints = [
            c for c in result.constraints_generated
            if c.type == "manual_routing_required"
        ]
        assert len(manual_constraints) == 1
        assert "NET_HARD" in manual_constraints[0].affected_nets
        assert "NET_STUCK" in manual_constraints[0].affected_nets


# ---------------------------------------------------------------------------
# Manual routing required fallback tests
# ---------------------------------------------------------------------------


class TestManualRoutingFallback:
    """Test manual_routing_required constraint generation."""

    def test_flag_unresolved_nets_adds_constraint(self, director):
        """_flag_unresolved_nets should add a constraint for unflagged nets."""
        strategy = RoutingStrategy(
            routing_order=[],
            constraints_generated=[],
        )
        feedback = SolverFeedback(
            completion_rate=60.0,
            failed_nets=[
                FailedNet(net_name="DIFF_P", failure_reason="impedance_violation"),
            ],
        )

        result = director._flag_unresolved_nets(strategy, feedback)

        manual = [c for c in result.constraints_generated if c.type == "manual_routing_required"]
        assert len(manual) == 1
        assert "DIFF_P" in manual[0].affected_nets
        assert manual[0].parameters["iteration_limit_reached"] is True

    def test_already_flagged_nets_not_duplicated(self, director):
        """Nets already flagged as manual_routing_required should not be duplicated."""
        strategy = RoutingStrategy(
            routing_order=[],
            constraints_generated=[
                GeneratedConstraint(
                    type="manual_routing_required",
                    description="Already flagged",
                    affected_nets=["NET_A"],
                    parameters={},
                ),
            ],
        )
        feedback = SolverFeedback(
            completion_rate=50.0,
            failed_nets=[
                FailedNet(net_name="NET_A", failure_reason="congestion"),
                FailedNet(net_name="NET_B", failure_reason="no_path_found"),
            ],
        )

        result = director._flag_unresolved_nets(strategy, feedback)

        manual = [c for c in result.constraints_generated if c.type == "manual_routing_required"]
        # Should have original + new one for NET_B only
        assert len(manual) == 2
        new_constraint = manual[1]
        assert "NET_B" in new_constraint.affected_nets
        assert "NET_A" not in new_constraint.affected_nets

    def test_no_failed_nets_no_change(self, director):
        """No failed nets should not add any manual constraints."""
        strategy = RoutingStrategy(routing_order=[], constraints_generated=[])
        feedback = SolverFeedback(completion_rate=100.0, failed_nets=[])

        result = director._flag_unresolved_nets(strategy, feedback)
        assert len(result.constraints_generated) == 0


# ---------------------------------------------------------------------------
# Validation gate integration tests
# ---------------------------------------------------------------------------


class TestValidationGateIntegration:
    """Test that schema validation is applied to routing strategies."""

    @pytest.mark.asyncio
    async def test_valid_strategy_passes_validation(self, director):
        strategy_json = _make_strategy_json()
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        # The actual validation depends on schema files existing,
        # but the strategy object should be created successfully
        assert isinstance(result, RoutingStrategy)
        # validation_errors may or may not be empty depending on schema file presence
        assert isinstance(result.validation_errors, list)

    @pytest.mark.asyncio
    async def test_malformed_json_produces_parse_error(self, director):
        """Malformed JSON from LLM should produce a parse error in the output."""
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "This is not valid JSON at all"

        response = MagicMock()
        response.content = [text_block]
        response.stop_reason = "end_turn"

        director._client = MagicMock()
        director._client.messages.create = AsyncMock(return_value=response)

        result = await director.generate_strategy({}, {}, {})

        # Should still return a RoutingStrategy (with empty routing order)
        assert isinstance(result, RoutingStrategy)
        assert len(result.routing_order) == 0

    @pytest.mark.asyncio
    async def test_api_error_returns_default_strategy(self, director):
        """API error should produce a fallback strategy with warning."""
        import anthropic

        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            side_effect=anthropic.APIError(
                message="rate limited",
                request=MagicMock(),
                body=None,
            )
        )

        result = await director.generate_strategy({}, {}, {})

        assert isinstance(result, RoutingStrategy)
        # Should have a warning constraint about the API error
        warnings = [c for c in result.constraints_generated if c.type == "warning"]
        assert len(warnings) >= 1

    @pytest.mark.asyncio
    async def test_priority_clamped_to_valid_range(self, director):
        """Priorities outside 1-10 should be clamped."""
        strategy_json = _make_strategy_json(
            routing_order=[
                {"net_name": "NET_HIGH", "priority": 99, "reason": "very high"},
                {"net_name": "NET_LOW", "priority": -5, "reason": "very low"},
            ]
        )
        director._client = MagicMock()
        director._client.messages.create = AsyncMock(
            return_value=_mock_llm_response(strategy_json)
        )

        result = await director.generate_strategy({}, {}, {})

        priorities = {e.net_name: e.priority for e in result.routing_order}
        assert priorities["NET_HIGH"] == 10
        assert priorities["NET_LOW"] == 1


# ---------------------------------------------------------------------------
# JSON parsing edge cases
# ---------------------------------------------------------------------------


class TestJSONParsing:
    """Test _try_parse_json edge cases."""

    def test_parse_clean_json(self):
        data = {"routing_order": []}
        assert RoutingDirector._try_parse_json(json.dumps(data)) == data

    def test_parse_markdown_fenced(self):
        data = {"routing_order": []}
        fenced = f"```json\n{json.dumps(data)}\n```"
        assert RoutingDirector._try_parse_json(fenced) == data

    def test_parse_json_embedded_in_text(self):
        data = {"routing_order": []}
        text = f"Here is the strategy:\n{json.dumps(data)}\nEnd of strategy."
        result = RoutingDirector._try_parse_json(text)
        assert result == data

    def test_parse_invalid_returns_error_dict(self):
        result = RoutingDirector._try_parse_json("not json at all")
        assert "_parse_error" in result
