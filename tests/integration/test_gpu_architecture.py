"""Integration tests for the GPU-first local architecture.

Tests cover the full local-only inference stack:
- GPU detection and fallback behavior
- VRAM-aware model selection (6/8/10/12/16/24 GB profiles)
- ReAct state management (deduplication, circuit breaker, progress)
- Physics boundary checks (deterministic, zero-cost validation)
- Local escalation policy (pass / retry / decompose / human_review)
- Intent DSL models (Pydantic v2, no coordinates)
- Solver bridge (intent -> proto-compatible dicts)

100% LOCAL -- no cloud APIs, no network calls.
"""

from __future__ import annotations

import json

import pytest


# ── GPU Detection ──


class TestGPUDetection:
    """GPU auto-detection with graceful fallback."""

    def test_get_gpu_info_returns_gpuinfo(self):
        from routeai_intelligence.llm.gpu_detect import GPUInfo, get_gpu_info

        info = get_gpu_info()
        assert isinstance(info, GPUInfo)
        assert info.vram_total_mb > 0

    def test_get_vram_gb(self):
        from routeai_intelligence.llm.gpu_detect import get_vram_gb

        gb = get_vram_gb()
        assert isinstance(gb, int)
        assert gb >= 1  # Even fallback returns 8

    def test_fallback_on_missing_nvidia_smi(self, monkeypatch):
        import routeai_intelligence.llm.gpu_detect as gpu_detect

        # Clear cached value so detect_gpu() runs fresh
        gpu_detect._cached = None
        monkeypatch.setattr(
            "subprocess.run",
            lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError),
        )
        info = gpu_detect.detect_gpu()
        assert info.name == "Unknown"
        assert info.vram_total_mb == 8192
        assert info.vram_free_mb == 6144
        assert info.compute_capability == "0.0"
        # Restore cache so other tests aren't affected
        gpu_detect._cached = None

    def test_fallback_on_bad_csv_output(self, monkeypatch):
        """nvidia-smi returns malformed CSV -> fallback."""
        import subprocess as _sp

        import routeai_intelligence.llm.gpu_detect as gpu_detect

        gpu_detect._cached = None

        class FakeResult:
            stdout = "garbage,data\n"
            returncode = 0

        monkeypatch.setattr(
            "subprocess.run",
            lambda *a, **kw: FakeResult(),
        )
        info = gpu_detect.detect_gpu()
        assert info.name == "Unknown"
        gpu_detect._cached = None

    def test_cached_result_reused(self):
        import routeai_intelligence.llm.gpu_detect as gpu_detect

        gpu_detect._cached = None
        first = gpu_detect.get_gpu_info()
        second = gpu_detect.get_gpu_info()
        assert first is second  # Same object, cached


# ── Model Manager ──


class TestModelManager:
    """VRAM-aware model selection for local Ollama inference."""

    def test_6gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(6)
        assert mm.profile.vram_gb == 6
        assert mm.profile.resident_model == "phi3.5:3.8b"
        assert mm.profile.swap_model == "qwen2.5:7b"
        assert mm.profile.max_context == 2048
        assert mm.profile.max_parallel == 1

    def test_8gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(8)
        assert mm.profile.vram_gb == 8
        assert mm.profile.resident_model == "phi3.5:3.8b"
        assert mm.profile.swap_model == "qwen2.5:7b"
        assert mm.profile.max_context == 4096

    def test_12gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.profile.resident_model == "qwen2.5:7b"
        assert mm.profile.swap_model == "qwen2.5-coder:14b"
        assert mm.profile.max_context == 4096
        assert mm.profile.max_parallel == 2

    def test_16gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(16)
        assert mm.profile.max_context == 8192
        assert mm.profile.swap_model == "qwen2.5-coder:14b"

    def test_24gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(24)
        assert mm.profile.swap_model == "qwen2.5:32b"
        assert mm.profile.max_parallel == 4
        assert not mm.is_t1_decomposed()  # 24GB can run T1 directly

    def test_above_24gb_uses_24gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(48)
        assert mm.profile.vram_gb == 24  # Rounds down to highest known

    def test_below_6gb_uses_6gb_profile(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(4)
        assert mm.profile.vram_gb == 6  # Minimum known profile

    def test_t3_selects_resident(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.select_model("chat") == "qwen2.5:7b"
        assert mm.select_model("schema_validation") == "qwen2.5:7b"
        assert mm.select_model("explain_placement") == "qwen2.5:7b"
        assert mm.select_model("component_search") == "qwen2.5:7b"

    def test_t2_selects_swap(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.select_model("constraint_generation") == "qwen2.5-coder:14b"
        assert mm.select_model("routing_director") == "qwen2.5-coder:14b"
        assert mm.select_model("placement_strategy") == "qwen2.5-coder:14b"
        assert mm.select_model("stackup_advisor") == "qwen2.5-coder:14b"

    def test_t1_selects_swap(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.select_model("design_review") == "qwen2.5-coder:14b"
        assert mm.select_model("schematic_review") == "qwen2.5-coder:14b"

    def test_t1_decomposed_on_12gb(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.is_t1_decomposed()  # 12GB can't run T1 directly

    def test_t1_not_decomposed_on_24gb(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(24)
        assert not mm.is_t1_decomposed()

    def test_unknown_task_defaults_to_t3(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm.select_model("some_unknown_task") == "qwen2.5:7b"
        assert mm.select_model("") == "qwen2.5:7b"

    def test_needs_swap(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        mm._current_model = "qwen2.5:7b"
        assert mm.needs_swap("qwen2.5-coder:14b")
        assert not mm.needs_swap("qwen2.5:7b")

    def test_select_model_updates_current(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)
        assert mm._current_model == "qwen2.5:7b"  # starts at resident
        mm.select_model("constraint_generation")  # T2 -> swap
        assert mm._current_model == "qwen2.5-coder:14b"
        mm.select_model("chat")  # T3 -> resident
        assert mm._current_model == "qwen2.5:7b"

    def test_all_task_types_have_tier(self):
        from routeai_intelligence.llm.model_manager import TASK_TIER_MAP, ModelManager

        mm = ModelManager(12)
        for task_type in TASK_TIER_MAP:
            model = mm.select_model(task_type)
            assert model is not None, f"No model for {task_type}"
            assert isinstance(model, str)
            assert len(model) > 0

    def test_context_limit(self):
        from routeai_intelligence.llm.model_manager import ModelManager

        assert ModelManager(6).get_context_limit() == 2048
        assert ModelManager(12).get_context_limit() == 4096
        assert ModelManager(24).get_context_limit() == 8192


# ── ReAct State ──


class TestReActState:
    """Tool call deduplication and progress tracking for ReAct loops."""

    def test_deduplication(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        # First call -- not duplicate
        assert not state.is_duplicate("impedance_calc", {"w": 0.15, "h": 0.2})
        result = state.register_call(
            "impedance_calc", {"w": 0.15, "h": 0.2}, "Z0=52.3"
        )
        assert result is None  # New call, no cached result

        # Second call -- duplicate
        assert state.is_duplicate("impedance_calc", {"w": 0.15, "h": 0.2})
        result = state.register_call(
            "impedance_calc", {"w": 0.15, "h": 0.2}, "Z0=52.3"
        )
        assert result is not None
        assert "CACHED" in result

    def test_different_params_not_duplicate(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        state.register_call("impedance_calc", {"w": 0.15}, "result1")
        assert not state.is_duplicate("impedance_calc", {"w": 0.20})

    def test_different_tools_not_duplicate(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        state.register_call("impedance_calc", {"w": 0.15}, "result1")
        assert not state.is_duplicate("drc_check", {"w": 0.15})

    def test_circuit_breaker(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        assert state.update_progress(0) is None  # 1st stale
        assert state.update_progress(0) is None  # 2nd stale
        stop = state.update_progress(0)  # 3rd stale -> stop
        assert stop is not None
        assert "Stopping" in stop or "STOP" in stop or "stop" in stop.lower()

    def test_progress_resets_on_findings(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        state.update_progress(0)  # 1st stale
        state.update_progress(0)  # 2nd stale
        state.update_progress(3)  # Found something -> resets
        assert state.consecutive_no_progress == 0
        assert state.findings_count == 3
        assert state.update_progress(0) is None  # Reset, 1st stale again

    def test_findings_accumulate(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        state.update_progress(2)
        state.update_progress(3)
        assert state.findings_count == 5

    def test_state_prompt(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState(max_iterations=15)
        state.register_call("impedance_calc", {"w": 0.15}, "Z0=52.3")
        state.findings_count = 3
        state.iteration = 5
        prompt = state.build_state_prompt()
        assert "5" in prompt
        assert "15" in prompt or "Iteration" in prompt
        assert "impedance_calc" in prompt
        assert "ReAct State" in prompt

    def test_state_prompt_warns_near_end(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState(max_iterations=10)
        state.iteration = 8  # Only 2 remaining
        prompt = state.build_state_prompt()
        assert "WARNING" in prompt
        assert "FINAL_ANSWER" in prompt

    def test_call_hash_deterministic(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        h1 = state.call_hash("tool_a", {"x": 1, "y": 2})
        h2 = state.call_hash("tool_a", {"y": 2, "x": 1})  # Different key order
        assert h1 == h2  # json.dumps with sort_keys=True

    def test_tool_call_log_records(self):
        from routeai_intelligence.agent.react_state import ReActState

        state = ReActState()
        state.register_call("tool_a", {"x": 1}, "result_a")
        state.register_call("tool_b", {"y": 2}, "result_b")
        assert len(state.tool_call_log) == 2
        assert state.tool_call_log[0][0] == "tool_a"
        assert state.tool_call_log[1][0] == "tool_b"


# ── Physics Checks ──


class TestPhysicsChecks:
    """Deterministic physics boundary validation -- no LLM needed."""

    def test_valid_values_pass(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"impedance_ohm": 50, "trace_width_mm": 0.15}
        score, violations = physics_check(result)
        assert score == 1.0
        assert len(violations) == 0

    def test_impossible_impedance_rejected(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"impedance_ohm": 500}
        score, violations = physics_check(result)
        assert score < 1.0
        assert any("impedance" in v.lower() for v in violations)

    def test_too_low_impedance_rejected(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"impedance_ohm": 5}
        score, violations = physics_check(result)
        assert score < 1.0
        assert any("impedance" in v.lower() for v in violations)

    def test_positive_crosstalk_rejected(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"crosstalk_db": 10.0}
        score, violations = physics_check(result)
        assert score < 0.6
        assert any("crosstalk" in v.lower() for v in violations)

    def test_negative_crosstalk_passes(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"crosstalk_db": -40.0}
        score, violations = physics_check(result)
        assert score == 1.0
        assert len(violations) == 0

    def test_excessive_voltage_drop(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"voltage_drop_mv": 500, "supply_voltage_mv": 3300}
        score, violations = physics_check(result)
        assert score < 1.0
        assert any("voltage_drop" in v.lower() for v in violations)

    def test_acceptable_voltage_drop(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"voltage_drop_mv": 100, "supply_voltage_mv": 3300}
        score, violations = physics_check(result)
        assert score == 1.0

    def test_nested_values_found(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {"analysis": {"signal": {"impedance_ohm": 5}}}  # too low
        score, violations = physics_check(result)
        assert score < 1.0
        assert any("impedance" in v.lower() for v in violations)

    def test_empty_result_passes(self):
        from routeai_intelligence.validation.confidence import physics_check

        score, violations = physics_check({})
        assert score == 1.0
        assert len(violations) == 0

    def test_all_boundaries_within_range(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {
            "impedance_ohm": 50.0,
            "crosstalk_db": -30.0,
            "voltage_drop_mv": 50.0,
            "junction_temp_c": 85.0,
            "trace_width_mm": 0.15,
            "clearance_mm": 0.15,
            "via_drill_mm": 0.3,
            "current_capacity_a": 2.0,
            "dielectric_constant": 4.5,
            "copper_thickness_mm": 0.035,
        }
        score, violations = physics_check(result)
        assert score == 1.0
        assert len(violations) == 0

    def test_multiple_violations_accumulate(self):
        from routeai_intelligence.validation.confidence import physics_check

        result = {
            "impedance_ohm": 500,  # too high
            "trace_width_mm": 0.01,  # too narrow
        }
        score, violations = physics_check(result)
        assert len(violations) == 2
        assert score < 0.5


class TestLocalEscalationPolicy:
    """Local escalation: pass / retry_bigger_model / decompose / human_review."""

    def test_escalation_policy_pass(self):
        from routeai_intelligence.validation.confidence import LocalEscalationPolicy

        policy = LocalEscalationPolicy()
        assert policy.should_retry("general_chat", 0.9, 0.9) == "pass"

    def test_escalation_policy_retry(self):
        from routeai_intelligence.validation.confidence import LocalEscalationPolicy

        policy = LocalEscalationPolicy()
        result = policy.should_retry("si_pi_analysis", 0.5, 0.5)
        assert result in ("retry_bigger_model", "decompose", "human_review")

    def test_escalation_policy_human_review_on_very_low(self):
        from routeai_intelligence.validation.confidence import LocalEscalationPolicy

        policy = LocalEscalationPolicy()
        result = policy.should_retry("si_pi_analysis", 0.0, 0.0)
        assert result == "human_review"

    def test_escalation_policy_all_task_types(self):
        from routeai_intelligence.validation.confidence import LocalEscalationPolicy

        policy = LocalEscalationPolicy()
        for task_type in policy.THRESHOLDS:
            # Perfect scores -> pass
            assert policy.should_retry(task_type, 1.0, 1.0) == "pass"
            # Zero scores -> human_review
            assert policy.should_retry(task_type, 0.0, 0.0) == "human_review"

    def test_escalation_unknown_task_uses_default_threshold(self):
        from routeai_intelligence.validation.confidence import LocalEscalationPolicy

        policy = LocalEscalationPolicy()
        # Unknown task uses default 0.65 threshold
        assert policy.should_retry("unknown_task", 1.0, 1.0) == "pass"
        assert policy.should_retry("unknown_task", 0.0, 0.0) == "human_review"


# ── Intent DSL Models ──


class TestIntentDSL:
    """Pydantic v2 intent models: no coordinates, only constraints."""

    def test_placement_intent_valid(self):
        from routeai_core.models.intent import (
            CriticalPair,
            PlacementIntent,
            PlacementZone,
        )

        intent = PlacementIntent(
            board_id="test",
            zones=[
                PlacementZone(
                    zone_id="z1",
                    zone_type="power_stage",
                    components=["U1", "L1"],
                )
            ],
            critical_pairs=[
                CriticalPair(
                    component_a="U1",
                    component_b="C1",
                    constraint="decoupling",
                    max_distance_mm=2.0,
                    reason="bypass cap",
                )
            ],
        )
        assert len(intent.zones) == 1
        assert intent.zones[0].zone_type == "power_stage"
        assert intent.critical_pairs[0].max_distance_mm == 2.0

    def test_placement_intent_rejects_invalid_zone_type(self):
        from routeai_core.models.intent import PlacementZone

        with pytest.raises(Exception):
            PlacementZone(
                zone_id="z1", zone_type="invalid_type", components=["U1"]
            )

    def test_placement_zone_requires_components(self):
        from routeai_core.models.intent import PlacementZone

        with pytest.raises(Exception):
            PlacementZone(zone_id="z1", zone_type="digital", components=[])

    def test_routing_intent_valid(self):
        from routeai_core.models.intent import (
            ImpedanceTarget,
            NetClassIntent,
            RoutingIntent,
        )

        intent = RoutingIntent(
            board_id="test",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["USB_DP", "USB_DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                    width_mm=0.12,
                    clearance_mm=0.15,
                )
            ],
        )
        assert intent.net_classes[0].impedance.target_ohm == 90
        assert intent.net_classes[0].impedance.type == "differential"

    def test_impedance_rejects_out_of_range(self):
        from routeai_core.models.intent import ImpedanceTarget

        with pytest.raises(Exception):
            ImpedanceTarget(type="single_ended", target_ohm=500)  # max is 150

        with pytest.raises(Exception):
            ImpedanceTarget(type="single_ended", target_ohm=5)  # min is 20

    def test_routing_intent_json_roundtrip(self):
        from routeai_core.models.intent import CostWeights, RoutingIntent

        intent = RoutingIntent(
            board_id="test", cost_weights=CostWeights(via_cost=15.0)
        )
        json_str = intent.model_dump_json()
        restored = RoutingIntent.model_validate_json(json_str)
        assert restored.cost_weights.via_cost == 15.0
        assert restored.board_id == "test"

    def test_placement_intent_json_roundtrip(self):
        from routeai_core.models.intent import (
            PlacementIntent,
            PlacementZone,
        )

        intent = PlacementIntent(
            board_id="roundtrip",
            zones=[
                PlacementZone(
                    zone_id="z1", zone_type="analog", components=["U1", "R1"]
                )
            ],
        )
        json_str = intent.model_dump_json()
        restored = PlacementIntent.model_validate_json(json_str)
        assert restored.zones[0].zone_type == "analog"
        assert "U1" in restored.zones[0].components

    def test_placement_intent_schema_generation(self):
        from routeai_core.models.intent import PlacementIntent

        schema = PlacementIntent.model_json_schema()
        assert "properties" in schema
        assert "zones" in schema["properties"]

    def test_routing_intent_schema_generation(self):
        from routeai_core.models.intent import RoutingIntent

        schema = RoutingIntent.model_json_schema()
        assert "properties" in schema
        assert "net_classes" in schema["properties"]
        assert "cost_weights" in schema["properties"]

    def test_cost_weights_defaults(self):
        from routeai_core.models.intent import CostWeights

        cw = CostWeights()
        assert cw.via_cost == 10.0
        assert cw.layer_change_cost == 8.0
        assert cw.length_cost == 1.0
        assert cw.congestion_cost == 5.0
        assert cw.reference_plane_violation_cost == 100.0

    def test_via_strategy_defaults(self):
        from routeai_core.models.intent import ViaStrategyIntent

        vs = ViaStrategyIntent()
        assert vs.type == "through"
        assert vs.max_vias_per_net == 10
        assert vs.via_size_mm == 0.3

    def test_keepout_intent(self):
        from routeai_core.models.intent import KeepoutIntent

        ko = KeepoutIntent(type="thermal", radius_mm=5.0, reason="heat sink")
        assert ko.type == "thermal"
        assert ko.source_component is None

    def test_diff_pair_intent(self):
        from routeai_core.models.intent import DiffPairIntent

        dp = DiffPairIntent(
            max_intra_pair_skew_mm=0.15,
            max_parallel_length_mm=100.0,
            min_spacing_to_other_diff_mm=0.5,
        )
        assert dp.max_intra_pair_skew_mm == 0.15


# ── Solver Bridge ──


class TestSolverBridge:
    """Intent DSL -> solver/router parameter conversion (pure, no I/O)."""

    def test_routing_intent_to_params(self):
        from routeai_core.models.intent import (
            CostWeights,
            ImpedanceTarget,
            NetClassIntent,
            RoutingIntent,
            ViaStrategyIntent,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            routing_intent_to_router_params,
        )

        intent = RoutingIntent(
            board_id="test",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["DP", "DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                    via_strategy=ViaStrategyIntent(max_vias_per_net=2),
                )
            ],
            cost_weights=CostWeights(via_cost=20.0),
        )
        params = routing_intent_to_router_params(intent)

        # Must have proto-compatible structure
        assert "constraints" in params
        assert "nets" in params
        assert "cost_weights" in params
        assert params["cost_weights"]["via_cost"] == 20.0
        assert "strategy" in params
        assert isinstance(params["constraints"], list)
        assert len(params["constraints"]) > 0

    def test_routing_params_contain_impedance_constraint(self):
        from routeai_core.models.intent import (
            ImpedanceTarget,
            NetClassIntent,
            RoutingIntent,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            CONSTRAINT_DIFF_PAIR_IMPEDANCE,
            routing_intent_to_router_params,
        )

        intent = RoutingIntent(
            board_id="test",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["DP", "DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                )
            ],
        )
        params = routing_intent_to_router_params(intent)
        impedance_constraints = [
            c for c in params["constraints"]
            if c["type"] == CONSTRAINT_DIFF_PAIR_IMPEDANCE
        ]
        assert len(impedance_constraints) == 1
        assert impedance_constraints[0]["value"] == 90.0

    def test_placement_intent_to_params(self):
        from routeai_core.models.intent import (
            KeepoutIntent,
            PlacementIntent,
            PlacementZone,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            placement_intent_to_solver_params,
        )

        intent = PlacementIntent(
            board_id="test",
            zones=[
                PlacementZone(
                    zone_id="z1", zone_type="digital", components=["U1"]
                )
            ],
            keepouts=[
                KeepoutIntent(type="thermal", radius_mm=5.0, reason="heat")
            ],
        )
        params = placement_intent_to_solver_params(intent)
        assert len(params["zones"]) == 1
        assert params["zones"][0]["zone_type"] == "digital"
        assert len(params["keepouts"]) == 1
        assert params["keepouts"][0]["radius_mm"] == 5.0
        assert params["board_id"] == "test"

    def test_empty_intent_produces_valid_params(self):
        from routeai_core.models.intent import RoutingIntent
        from routeai_intelligence.bridge.intent_to_solver import (
            routing_intent_to_router_params,
        )

        params = routing_intent_to_router_params(RoutingIntent(board_id="empty"))
        assert isinstance(params, dict)
        assert "constraints" in params
        assert "nets" in params
        assert params["constraints"] == []
        assert params["nets"] == []
        assert "cost_weights" in params

    def test_empty_placement_produces_valid_params(self):
        from routeai_core.models.intent import PlacementIntent
        from routeai_intelligence.bridge.intent_to_solver import (
            placement_intent_to_solver_params,
        )

        params = placement_intent_to_solver_params(
            PlacementIntent(board_id="empty")
        )
        assert isinstance(params, dict)
        assert params["zones"] == []
        assert params["keepouts"] == []

    def test_routing_intent_to_design_rules(self):
        from routeai_core.models.intent import (
            ImpedanceTarget,
            NetClassIntent,
            RoutingIntent,
            ViaStrategyIntent,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            routing_intent_to_design_rules,
        )

        intent = RoutingIntent(
            board_id="test",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["DP", "DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                    via_strategy=ViaStrategyIntent(via_size_mm=0.3),
                    width_mm=0.12,
                    clearance_mm=0.15,
                )
            ],
        )
        rules = routing_intent_to_design_rules(intent)
        assert len(rules["net_classes"]) == 1
        nc = rules["net_classes"][0]
        assert nc["name"] == "USB"
        assert nc["impedance_ohm"] == 90.0
        assert nc["trace_width_mm"] == 0.12
        assert nc["via_drill_mm"] == 0.3

    def test_routing_order_sorted_by_priority(self):
        from routeai_core.models.intent import (
            NetClassIntent,
            RoutingIntent,
            RoutingOrderEntry,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            routing_intent_to_router_params,
        )

        intent = RoutingIntent(
            board_id="test",
            net_classes=[
                NetClassIntent(name="Power", nets=["VCC"]),
                NetClassIntent(name="USB", nets=["DP"]),
            ],
            routing_order=[
                RoutingOrderEntry(
                    priority=2, net_class="Power", reason="power nets second"
                ),
                RoutingOrderEntry(
                    priority=1, net_class="USB", reason="high speed first"
                ),
            ],
        )
        params = routing_intent_to_router_params(intent)
        order = params["routing_order"]
        assert order[0]["net_class"] == "USB"
        assert order[1]["net_class"] == "Power"

    def test_voltage_drops_to_pi_params(self):
        from routeai_core.models.intent import VoltageDropTarget
        from routeai_intelligence.bridge.intent_to_solver import (
            voltage_drops_to_pi_params,
        )

        targets = [
            VoltageDropTarget(
                net="3V3",
                source_component="U1",
                sink_components=["U2", "U3"],
                max_drop_mv=100,
                max_current_a=2.0,
                min_trace_width_mm=0.5,
            )
        ]
        params = voltage_drops_to_pi_params(targets)
        assert len(params) == 1
        assert params[0]["net"] == "3V3"
        assert params[0]["max_current_a"] == 2.0
        assert len(params[0]["sink_components"]) == 2


# ── Cross-module Integration ──


class TestEndToEnd:
    """End-to-end flow: Intent -> Bridge -> Physics Check."""

    def test_routing_intent_through_full_pipeline(self):
        """Create intent, convert to params, validate with physics check."""
        from routeai_core.models.intent import (
            ImpedanceTarget,
            NetClassIntent,
            RoutingIntent,
        )
        from routeai_intelligence.bridge.intent_to_solver import (
            routing_intent_to_design_rules,
        )
        from routeai_intelligence.validation.confidence import physics_check

        # Step 1: Create intent (LLM output)
        intent = RoutingIntent(
            board_id="integration_test",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["USB_DP", "USB_DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                    width_mm=0.12,
                    clearance_mm=0.15,
                )
            ],
        )

        # Step 2: Convert to solver rules
        rules = routing_intent_to_design_rules(intent)
        nc = rules["net_classes"][0]

        # Step 3: Physics check on the generated rules
        score, violations = physics_check(nc)
        assert score == 1.0, f"Valid intent failed physics check: {violations}"

    def test_bad_intent_caught_by_physics(self):
        """Physics check catches implausible values even if Pydantic allows them."""
        from routeai_intelligence.validation.confidence import physics_check

        # Simulate an LLM output with a value inside Pydantic range but
        # outside physics boundaries (e.g., trace_width_mm=0.04 is below
        # the physics min of 0.05 but would need a validator < ge=0.05 in
        # the model to catch it at the Pydantic level)
        result = {"trace_width_mm": 0.04, "impedance_ohm": 50}
        score, violations = physics_check(result)
        assert score < 1.0
        assert any("trace_width" in v for v in violations)

    def test_model_selection_for_pipeline_stages(self):
        """Verify that different pipeline stages select appropriate models."""
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(12)

        # Constraint generation (T2) needs structured output -> swap model
        constraint_model = mm.select_model("constraint_generation")
        assert "14b" in constraint_model or "coder" in constraint_model

        # Chat explanation (T3) uses fast resident model
        chat_model = mm.select_model("chat")
        assert "7b" in chat_model or "phi" in chat_model

        # Design review (T1) uses swap model (decomposed on 12GB)
        review_model = mm.select_model("design_review")
        assert mm.is_t1_decomposed()  # Confirms decomposition needed
