#!/usr/bin/env python3
"""Benchmark local LLM inference performance on the current GPU.

100% LOCAL -- no cloud APIs, no network calls outside localhost.
Requires Ollama running locally: https://ollama.com

Usage:
    python scripts/benchmark_inference.py
    python scripts/benchmark_inference.py --dry-run   # GPU info only, no Ollama needed

Measures:
- GPU detection latency
- Model selection latency
- T3 (resident) model first-token and total response time
- T2 (swap) model load + first response time
- Physics check throughput (deterministic, no LLM)
- ReAct state overhead
- Intent DSL serialization/deserialization throughput
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Add package sources to path
_ROOT = Path(__file__).resolve().parent.parent
for pkg in ("core", "intelligence", "solver"):
    src = _ROOT / "packages" / pkg / "src"
    if src.is_dir():
        sys.path.insert(0, str(src))


def benchmark_gpu_detection() -> dict:
    """Benchmark GPU detection latency."""
    import routeai_intelligence.llm.gpu_detect as gpu_detect

    # Clear cache to force re-detection
    gpu_detect._cached = None

    start = time.perf_counter()
    info = gpu_detect.detect_gpu()
    elapsed = time.perf_counter() - start

    return {
        "gpu_name": info.name,
        "vram_total_mb": info.vram_total_mb,
        "vram_free_mb": info.vram_free_mb,
        "compute_capability": info.compute_capability,
        "detection_ms": round(elapsed * 1000, 2),
    }


def benchmark_model_selection() -> dict:
    """Benchmark model manager initialization and selection."""
    from routeai_intelligence.llm.model_manager import TASK_TIER_MAP, ModelManager

    vram_gb = 12  # Common config

    start = time.perf_counter()
    mm = ModelManager(vram_gb)
    init_ms = (time.perf_counter() - start) * 1000

    # Benchmark all task selections
    start = time.perf_counter()
    for task_type in TASK_TIER_MAP:
        mm.select_model(task_type)
    select_all_ms = (time.perf_counter() - start) * 1000

    return {
        "vram_gb": vram_gb,
        "resident_model": mm.profile.resident_model,
        "swap_model": mm.profile.swap_model,
        "max_context": mm.profile.max_context,
        "t1_decomposed": mm.is_t1_decomposed(),
        "init_ms": round(init_ms, 3),
        "select_all_tasks_ms": round(select_all_ms, 3),
        "tasks_count": len(TASK_TIER_MAP),
    }


def benchmark_physics_checks() -> dict:
    """Benchmark deterministic physics boundary checks (zero-cost validation)."""
    from routeai_intelligence.validation.confidence import physics_check

    # Realistic PCB parameter sets
    test_cases = [
        {"impedance_ohm": 50, "trace_width_mm": 0.15, "clearance_mm": 0.15},
        {"impedance_ohm": 90, "crosstalk_db": -30, "via_drill_mm": 0.3},
        {"voltage_drop_mv": 100, "supply_voltage_mv": 3300, "junction_temp_c": 85},
        {"impedance_ohm": 500, "trace_width_mm": 0.01},  # violations
        {
            "analysis": {
                "signal": {
                    "impedance_ohm": 50,
                    "trace_width_mm": 0.15,
                }
            }
        },  # nested
    ]

    iterations = 10_000
    start = time.perf_counter()
    for _ in range(iterations):
        for case in test_cases:
            physics_check(case)
    elapsed = time.perf_counter() - start

    total_checks = iterations * len(test_cases)
    return {
        "total_checks": total_checks,
        "elapsed_s": round(elapsed, 3),
        "checks_per_sec": round(total_checks / elapsed),
        "avg_us_per_check": round(elapsed / total_checks * 1_000_000, 2),
    }


def benchmark_react_state() -> dict:
    """Benchmark ReAct state management overhead."""
    from routeai_intelligence.agent.react_state import ReActState

    iterations = 10_000

    # Deduplication benchmark
    start = time.perf_counter()
    for i in range(iterations):
        state = ReActState()
        state.register_call("tool_a", {"x": i}, f"result_{i}")
        state.is_duplicate("tool_a", {"x": i})
        state.register_call("tool_a", {"x": i}, f"result_{i}")  # duplicate
    dedup_elapsed = time.perf_counter() - start

    # State prompt generation benchmark
    state = ReActState(max_iterations=15)
    for i in range(10):
        state.register_call(f"tool_{i}", {"param": i}, f"result_{i}")
    state.findings_count = 5
    state.iteration = 8

    start = time.perf_counter()
    for _ in range(iterations):
        state.build_state_prompt()
    prompt_elapsed = time.perf_counter() - start

    return {
        "dedup_iterations": iterations,
        "dedup_elapsed_s": round(dedup_elapsed, 3),
        "dedup_ops_per_sec": round(iterations / dedup_elapsed),
        "prompt_iterations": iterations,
        "prompt_elapsed_s": round(prompt_elapsed, 3),
        "prompts_per_sec": round(iterations / prompt_elapsed),
    }


def benchmark_intent_serialization() -> dict:
    """Benchmark Intent DSL model creation and JSON roundtrip."""
    from routeai_core.models.intent import (
        CostWeights,
        CriticalPair,
        ImpedanceTarget,
        KeepoutIntent,
        NetClassIntent,
        PlacementIntent,
        PlacementZone,
        RoutingIntent,
        ViaStrategyIntent,
    )

    iterations = 5_000

    # Routing intent creation + JSON roundtrip
    start = time.perf_counter()
    for _ in range(iterations):
        intent = RoutingIntent(
            board_id="bench",
            net_classes=[
                NetClassIntent(
                    name="USB",
                    nets=["DP", "DM"],
                    impedance=ImpedanceTarget(type="differential", target_ohm=90),
                    via_strategy=ViaStrategyIntent(max_vias_per_net=2),
                    width_mm=0.12,
                )
            ],
            cost_weights=CostWeights(via_cost=20.0),
        )
        json_str = intent.model_dump_json()
        RoutingIntent.model_validate_json(json_str)
    routing_elapsed = time.perf_counter() - start

    # Placement intent creation + JSON roundtrip
    start = time.perf_counter()
    for _ in range(iterations):
        intent = PlacementIntent(
            board_id="bench",
            zones=[
                PlacementZone(zone_id="z1", zone_type="power_stage", components=["U1", "L1"]),
                PlacementZone(zone_id="z2", zone_type="digital", components=["U2", "U3"]),
            ],
            critical_pairs=[
                CriticalPair(
                    component_a="U1", component_b="C1",
                    constraint="decoupling", max_distance_mm=2.0,
                    reason="bypass",
                )
            ],
            keepouts=[
                KeepoutIntent(type="thermal", radius_mm=5.0, reason="heat"),
            ],
        )
        json_str = intent.model_dump_json()
        PlacementIntent.model_validate_json(json_str)
    placement_elapsed = time.perf_counter() - start

    return {
        "iterations": iterations,
        "routing_roundtrip_s": round(routing_elapsed, 3),
        "routing_per_sec": round(iterations / routing_elapsed),
        "placement_roundtrip_s": round(placement_elapsed, 3),
        "placement_per_sec": round(iterations / placement_elapsed),
    }


def benchmark_solver_bridge() -> dict:
    """Benchmark intent-to-solver parameter conversion."""
    from routeai_core.models.intent import (
        CostWeights,
        ImpedanceTarget,
        KeepoutIntent,
        NetClassIntent,
        PlacementIntent,
        PlacementZone,
        RoutingIntent,
        ViaStrategyIntent,
    )
    from routeai_intelligence.bridge.intent_to_solver import (
        placement_intent_to_solver_params,
        routing_intent_to_router_params,
    )

    routing_intent = RoutingIntent(
        board_id="bench",
        net_classes=[
            NetClassIntent(
                name="USB",
                nets=["DP", "DM"],
                impedance=ImpedanceTarget(type="differential", target_ohm=90),
                via_strategy=ViaStrategyIntent(max_vias_per_net=2),
            ),
            NetClassIntent(name="SPI", nets=["CLK", "MOSI", "MISO", "CS"]),
            NetClassIntent(name="Power", nets=["VCC", "GND"]),
        ],
        cost_weights=CostWeights(via_cost=20.0),
    )

    placement_intent = PlacementIntent(
        board_id="bench",
        zones=[
            PlacementZone(zone_id="z1", zone_type="power_stage", components=["U1", "L1"]),
            PlacementZone(zone_id="z2", zone_type="digital", components=["U2", "U3", "U4"]),
        ],
        keepouts=[KeepoutIntent(type="thermal", radius_mm=5.0, reason="heat")],
    )

    iterations = 10_000

    start = time.perf_counter()
    for _ in range(iterations):
        routing_intent_to_router_params(routing_intent)
    routing_elapsed = time.perf_counter() - start

    start = time.perf_counter()
    for _ in range(iterations):
        placement_intent_to_solver_params(placement_intent)
    placement_elapsed = time.perf_counter() - start

    return {
        "iterations": iterations,
        "routing_bridge_s": round(routing_elapsed, 3),
        "routing_bridge_per_sec": round(iterations / routing_elapsed),
        "placement_bridge_s": round(placement_elapsed, 3),
        "placement_bridge_per_sec": round(iterations / placement_elapsed),
    }


def print_section(title: str, results: dict) -> None:
    """Print a formatted benchmark section."""
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")
    max_key = max(len(k) for k in results)
    for key, value in results.items():
        print(f"  {key:<{max_key + 2}} {value}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark local LLM inference stack (100%% LOCAL)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only run deterministic benchmarks, skip Ollama inference",
    )
    args = parser.parse_args()

    print("RouteAI Local GPU Architecture Benchmark")
    print("100%% LOCAL -- no cloud APIs")
    print()

    # Always run: deterministic benchmarks
    gpu_results = benchmark_gpu_detection()
    print_section("GPU Detection", gpu_results)

    model_results = benchmark_model_selection()
    print_section("Model Selection (VRAM-aware)", model_results)

    physics_results = benchmark_physics_checks()
    print_section("Physics Boundary Checks (deterministic)", physics_results)

    react_results = benchmark_react_state()
    print_section("ReAct State Management", react_results)

    intent_results = benchmark_intent_serialization()
    print_section("Intent DSL Serialization", intent_results)

    bridge_results = benchmark_solver_bridge()
    print_section("Solver Bridge Conversion", bridge_results)

    if args.dry_run:
        print(f"\n{'=' * 60}")
        print("  Skipping Ollama inference (--dry-run)")
        print(f"{'=' * 60}")
        return

    # Ollama inference benchmarks (requires Ollama running)
    print(f"\n{'=' * 60}")
    print("  Ollama Inference (requires: ollama serve)")
    print(f"{'=' * 60}")

    try:
        import asyncio

        asyncio.run(_benchmark_ollama(gpu_results["vram_total_mb"] // 1024))
    except Exception as e:
        print(f"  Ollama benchmark skipped: {e}")
        print("  Start Ollama with: ollama serve")


async def _benchmark_ollama(vram_gb: int) -> None:
    """Benchmark actual Ollama inference (async)."""
    try:
        from routeai_intelligence.llm.model_manager import ModelManager

        mm = ModelManager(vram_gb)

        # Try a simple HTTP check to Ollama
        import httpx

        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.get("http://127.0.0.1:11434/api/tags")
                if resp.status_code != 200:
                    print("  Ollama not responding. Start with: ollama serve")
                    return
            except httpx.ConnectError:
                print("  Ollama not running. Start with: ollama serve")
                return

        available_models = resp.json().get("models", [])
        model_names = [m["name"] for m in available_models]
        print(f"  Available models: {', '.join(model_names) or 'none'}")

        # Check if resident model is available
        resident = mm.profile.resident_model
        if not any(resident in name for name in model_names):
            print(f"  Resident model '{resident}' not found.")
            print(f"  Pull it with: ollama pull {resident}")
            return

        # Benchmark T3 (resident) model
        print(f"\n  Benchmarking T3 resident: {resident}")
        async with httpx.AsyncClient(timeout=120.0) as client:
            payload = {
                "model": resident,
                "prompt": 'Respond with valid JSON only: {"status": "ok"}',
                "system": "You are a JSON-only responder.",
                "stream": False,
                "options": {"num_ctx": mm.profile.max_context},
            }

            # Warm-up
            await client.post("http://127.0.0.1:11434/api/generate", json=payload)

            # Timed runs
            times = []
            for i in range(3):
                start = time.perf_counter()
                resp = await client.post(
                    "http://127.0.0.1:11434/api/generate", json=payload
                )
                elapsed = time.perf_counter() - start
                times.append(elapsed)
                data = resp.json()
                tokens = data.get("eval_count", 0)
                eval_dur = data.get("eval_duration", 1) / 1e9  # ns -> s
                tok_per_sec = tokens / eval_dur if eval_dur > 0 else 0
                print(
                    f"    Run {i + 1}: {elapsed:.2f}s, "
                    f"{tokens} tokens, "
                    f"{tok_per_sec:.1f} tok/s"
                )

            avg = sum(times) / len(times)
            print(f"    Average: {avg:.2f}s")

            # Benchmark swap model if available
            swap = mm.profile.swap_model
            if swap and any(swap in name for name in model_names):
                print(f"\n  Benchmarking T2 swap: {swap}")
                payload["model"] = swap

                start = time.perf_counter()
                resp = await client.post(
                    "http://127.0.0.1:11434/api/generate", json=payload
                )
                elapsed = time.perf_counter() - start
                data = resp.json()
                tokens = data.get("eval_count", 0)
                eval_dur = data.get("eval_duration", 1) / 1e9
                tok_per_sec = tokens / eval_dur if eval_dur > 0 else 0
                print(
                    f"    Swap + generate: {elapsed:.2f}s, "
                    f"{tokens} tokens, "
                    f"{tok_per_sec:.1f} tok/s"
                )
            elif swap:
                print(f"\n  Swap model '{swap}' not found. Pull: ollama pull {swap}")

    except ImportError as e:
        print(f"  Missing dependency: {e}")


if __name__ == "__main__":
    main()
