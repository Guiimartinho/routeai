#!/usr/bin/env python3
"""RouteAI benchmark suite.

Measures performance of core operations (parsing, DRC, impedance calculations)
across PCB files of varying complexity. Outputs JSON results with timing data
and optional comparison against a stored baseline.

Usage:
    python scripts/benchmark.py [--output results.json] [--baseline baseline.json]
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Result data structures
# ---------------------------------------------------------------------------

@dataclass
class BenchmarkResult:
    name: str
    iterations: int
    mean_ms: float
    median_ms: float
    stdev_ms: float
    min_ms: float
    max_ms: float
    p95_ms: float


@dataclass
class BenchmarkSuite:
    timestamp: str
    results: list[BenchmarkResult] = field(default_factory=list)
    system_info: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Timing utilities
# ---------------------------------------------------------------------------

def _percentile(data: list[float], pct: float) -> float:
    """Calculate the given percentile from sorted data."""
    if not data:
        return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (pct / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_data[int(k)]
    return sorted_data[f] * (c - k) + sorted_data[c] * (k - f)


def bench(name: str, fn: Callable[[], Any], iterations: int = 10) -> BenchmarkResult:
    """Run a function multiple times and collect timing statistics."""
    timings_ms: list[float] = []
    for _ in range(iterations):
        start = time.perf_counter()
        fn()
        elapsed = (time.perf_counter() - start) * 1000.0
        timings_ms.append(elapsed)

    return BenchmarkResult(
        name=name,
        iterations=iterations,
        mean_ms=round(statistics.mean(timings_ms), 3),
        median_ms=round(statistics.median(timings_ms), 3),
        stdev_ms=round(statistics.stdev(timings_ms) if len(timings_ms) > 1 else 0.0, 3),
        min_ms=round(min(timings_ms), 3),
        max_ms=round(max(timings_ms), 3),
        p95_ms=round(_percentile(timings_ms, 95), 3),
    )


# ---------------------------------------------------------------------------
# Test-case generators (synthetic KiCad-like data)
# ---------------------------------------------------------------------------

def _make_kicad_content(num_components: int, num_nets: int) -> str:
    """Generate a synthetic KiCad-like S-expression string."""
    components = "\n".join(
        f'  (module "C{i}" (at {i * 2.54} {(i % 20) * 2.54}) '
        f'(fp_text reference "C{i}" (at 0 0) (layer "F.SilkS")) '
        f'(pad "1" smd rect (at 0 -0.5) (size 1 0.6) (layers "F.Cu")) '
        f'(pad "2" smd rect (at 0 0.5) (size 1 0.6) (layers "F.Cu")))'
        for i in range(num_components)
    )
    nets = "\n".join(
        f'  (net {i} "Net{i}")'
        for i in range(num_nets)
    )
    return f'(kicad_pcb (version 20230101)\n{nets}\n{components}\n)'


COMPLEXITY_LEVELS = [
    ("simple_10c", 10, 15),
    ("medium_50c", 50, 80),
    ("complex_200c", 200, 350),
    ("large_500c", 500, 900),
    ("xlarge_1000c", 1000, 1800),
    ("huge_2000c", 2000, 3500),
    ("massive_3000c", 3000, 5000),
    ("extreme_4000c", 4000, 7000),
    ("ultra_5000c", 5000, 9000),
    ("max_6000c", 6000, 10000),
]


# ---------------------------------------------------------------------------
# Benchmark: Parse KiCad content
# ---------------------------------------------------------------------------

def _parse_sexp_tokens(content: str) -> list[Any]:
    """Minimal S-expression tokenizer for benchmarking parse throughput."""
    tokens: list[Any] = []
    i = 0
    length = len(content)
    while i < length:
        ch = content[i]
        if ch in (' ', '\n', '\r', '\t'):
            i += 1
        elif ch == '(':
            tokens.append('(')
            i += 1
        elif ch == ')':
            tokens.append(')')
            i += 1
        elif ch == '"':
            j = i + 1
            while j < length and content[j] != '"':
                j += 1
            tokens.append(content[i + 1:j])
            i = j + 1
        else:
            j = i
            while j < length and content[j] not in (' ', '\n', '\r', '\t', '(', ')'):
                j += 1
            tokens.append(content[i:j])
            i = j
    return tokens


def bench_parse(label: str, content: str) -> BenchmarkResult:
    return bench(f"parse_{label}", lambda: _parse_sexp_tokens(content), iterations=10)


# ---------------------------------------------------------------------------
# Benchmark: DRC checks
# ---------------------------------------------------------------------------

def _run_drc_check(components: int, nets: int) -> dict[str, Any]:
    """Simulate DRC: clearance checks between all adjacent component pairs."""
    violations: list[dict[str, str]] = []
    min_clearance_mm = 0.2
    for i in range(components - 1):
        x1 = i * 2.54
        y1 = (i % 20) * 2.54
        x2 = (i + 1) * 2.54
        y2 = ((i + 1) % 20) * 2.54
        dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        if dist < min_clearance_mm:
            violations.append({
                "type": "clearance",
                "component_a": f"C{i}",
                "component_b": f"C{i + 1}",
                "distance_mm": str(round(dist, 4)),
            })

    net_violations: list[dict[str, str]] = []
    for n in range(nets):
        stub_length = (n * 1.7) % 25.0
        if stub_length > 20.0:
            net_violations.append({
                "type": "stub_length",
                "net": f"Net{n}",
                "length_mm": str(round(stub_length, 3)),
            })

    return {
        "clearance_violations": len(violations),
        "stub_violations": len(net_violations),
        "total_violations": len(violations) + len(net_violations),
        "passed": len(violations) + len(net_violations) == 0,
    }


def bench_drc(label: str, components: int, nets: int) -> BenchmarkResult:
    return bench(f"drc_{label}", lambda: _run_drc_check(components, nets), iterations=10)


# ---------------------------------------------------------------------------
# Benchmark: Impedance calculations
# ---------------------------------------------------------------------------

def _microstrip_impedance(
    w_mm: float, h_mm: float, t_mm: float, er: float
) -> float:
    """Calculate microstrip impedance using IPC-2141 approximation."""
    w_eff = w_mm + (t_mm / math.pi) * math.log(4 * math.e / math.sqrt((t_mm / h_mm) ** 2 + (t_mm / (w_mm * math.pi + 1.1 * t_mm * math.pi)) ** 2))
    ratio = w_eff / h_mm
    if ratio <= 1:
        f_val = math.log(8 / ratio + ratio / 4)
        z0 = (60 / math.sqrt(er)) * f_val
    else:
        z0 = (120 * math.pi) / (math.sqrt(er) * (ratio + 1.393 + 0.667 * math.log(ratio + 1.444)))
    return z0


def _run_impedance_batch(num_traces: int) -> list[dict[str, float]]:
    """Calculate impedance for a batch of traces with varying geometry."""
    results: list[dict[str, float]] = []
    for i in range(num_traces):
        width = 0.1 + (i % 20) * 0.025
        height = 0.1 + (i % 5) * 0.05
        thickness = 0.035
        er = 4.2 + (i % 3) * 0.1
        z0 = _microstrip_impedance(width, height, thickness, er)
        results.append({
            "trace_id": float(i),
            "width_mm": width,
            "height_mm": height,
            "impedance_ohm": round(z0, 2),
        })
    return results


def bench_impedance(label: str, num_traces: int) -> BenchmarkResult:
    return bench(f"impedance_{label}", lambda: _run_impedance_batch(num_traces), iterations=10)


# ---------------------------------------------------------------------------
# Baseline comparison
# ---------------------------------------------------------------------------

def compare_with_baseline(
    current: list[dict[str, Any]], baseline_path: Path
) -> list[dict[str, Any]]:
    """Compare current results with baseline, returning deltas."""
    if not baseline_path.exists():
        return []

    with open(baseline_path) as f:
        baseline_data = json.load(f)

    baseline_map = {r["name"]: r for r in baseline_data.get("results", [])}
    comparisons: list[dict[str, Any]] = []

    for result in current:
        name = result["name"]
        if name in baseline_map:
            base = baseline_map[name]
            delta_mean = result["mean_ms"] - base["mean_ms"]
            delta_pct = (delta_mean / base["mean_ms"]) * 100 if base["mean_ms"] > 0 else 0
            comparisons.append({
                "name": name,
                "current_mean_ms": result["mean_ms"],
                "baseline_mean_ms": base["mean_ms"],
                "delta_ms": round(delta_mean, 3),
                "delta_pct": round(delta_pct, 1),
                "regression": delta_pct > 10,
            })

    return comparisons


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_benchmarks() -> BenchmarkSuite:
    import platform
    from datetime import datetime, timezone

    suite = BenchmarkSuite(
        timestamp=datetime.now(timezone.utc).isoformat(),
        system_info={
            "python": platform.python_version(),
            "platform": platform.platform(),
            "processor": platform.processor(),
        },
    )

    print("=" * 60)
    print("RouteAI Benchmark Suite")
    print("=" * 60)

    # Parse benchmarks
    print("\n--- Parsing benchmarks ---")
    for label, components, nets in COMPLEXITY_LEVELS:
        content = _make_kicad_content(components, nets)
        result = bench_parse(label, content)
        suite.results.append(result)
        print(f"  {result.name:35s}  mean={result.mean_ms:8.2f}ms  p95={result.p95_ms:8.2f}ms")

    # DRC benchmarks
    print("\n--- DRC benchmarks ---")
    for label, components, nets in COMPLEXITY_LEVELS:
        result = bench_drc(label, components, nets)
        suite.results.append(result)
        print(f"  {result.name:35s}  mean={result.mean_ms:8.2f}ms  p95={result.p95_ms:8.2f}ms")

    # Impedance benchmarks
    print("\n--- Impedance calculation benchmarks ---")
    trace_counts = [10, 50, 100, 500, 1000, 2000, 5000, 10000, 20000, 50000]
    for count in trace_counts:
        result = bench_impedance(f"{count}_traces", count)
        suite.results.append(result)
        print(f"  {result.name:35s}  mean={result.mean_ms:8.2f}ms  p95={result.p95_ms:8.2f}ms")

    print(f"\nTotal benchmarks: {len(suite.results)}")
    return suite


def main() -> None:
    parser = argparse.ArgumentParser(description="RouteAI benchmark suite")
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=Path("benchmark-results.json"),
        help="Output JSON file (default: benchmark-results.json)",
    )
    parser.add_argument(
        "--baseline", "-b",
        type=Path,
        default=None,
        help="Baseline JSON file for comparison",
    )
    args = parser.parse_args()

    suite = run_benchmarks()
    results_dicts = [asdict(r) for r in suite.results]

    output_data: dict[str, Any] = {
        "timestamp": suite.timestamp,
        "system_info": suite.system_info,
        "results": results_dicts,
    }

    if args.baseline:
        comparisons = compare_with_baseline(results_dicts, args.baseline)
        output_data["comparisons"] = comparisons
        if comparisons:
            print("\n--- Baseline comparison ---")
            regressions = 0
            for c in comparisons:
                marker = "REGRESSION" if c["regression"] else "ok"
                print(
                    f"  {c['name']:35s}  "
                    f"current={c['current_mean_ms']:8.2f}ms  "
                    f"baseline={c['baseline_mean_ms']:8.2f}ms  "
                    f"delta={c['delta_pct']:+.1f}%  [{marker}]"
                )
                if c["regression"]:
                    regressions += 1
            if regressions:
                print(f"\n  WARNING: {regressions} regression(s) detected (>10% slower)")
        else:
            print("\n  No matching baseline entries found for comparison.")

    with open(args.output, "w") as f:
        json.dump(output_data, f, indent=2)
    print(f"\nResults written to {args.output}")


if __name__ == "__main__":
    main()
