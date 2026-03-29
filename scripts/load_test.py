#!/usr/bin/env python3
"""Simple load testing script for RouteAI services.

Tests concurrent API requests using asyncio + aiohttp, covering:
- File uploads
- Design reviews
- Chat messages

Reports requests/sec, latency percentiles, and error rate.

Usage:
    python scripts/load_test.py [--base-url http://localhost:8080] [--concurrency 10] [--duration 30]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from dataclasses import dataclass, field
from typing import Any

import aiohttp


# ---------------------------------------------------------------------------
# Result data structures
# ---------------------------------------------------------------------------

@dataclass
class RequestResult:
    status: int
    latency_ms: float
    error: str | None = None


@dataclass
class ScenarioReport:
    name: str
    total_requests: int
    successful: int
    failed: int
    error_rate: float
    requests_per_sec: float
    latency_mean_ms: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    latency_min_ms: float
    latency_max_ms: float
    duration_sec: float


@dataclass
class LoadTestReport:
    scenarios: list[ScenarioReport] = field(default_factory=list)
    total_requests: int = 0
    total_duration_sec: float = 0.0


# ---------------------------------------------------------------------------
# Percentile utility
# ---------------------------------------------------------------------------

def _percentile(data: list[float], pct: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (pct / 100.0)
    f_idx = math.floor(k)
    c_idx = math.ceil(k)
    if f_idx == c_idx:
        return sorted_data[int(k)]
    return sorted_data[f_idx] * (c_idx - k) + sorted_data[c_idx] * (k - f_idx)


# ---------------------------------------------------------------------------
# Request functions
# ---------------------------------------------------------------------------

async def _do_request(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    json_body: dict[str, Any] | None = None,
    data: aiohttp.FormData | None = None,
) -> RequestResult:
    """Execute a single HTTP request and measure latency."""
    start = time.perf_counter()
    try:
        async with session.request(method, url, json=json_body, data=data) as resp:
            await resp.read()
            latency = (time.perf_counter() - start) * 1000.0
            error = None if resp.status < 400 else f"HTTP {resp.status}"
            return RequestResult(status=resp.status, latency_ms=latency, error=error)
    except Exception as e:
        latency = (time.perf_counter() - start) * 1000.0
        return RequestResult(status=0, latency_ms=latency, error=str(e))


# ---------------------------------------------------------------------------
# Scenario definitions
# ---------------------------------------------------------------------------

async def scenario_file_upload(
    session: aiohttp.ClientSession,
    base_url: str,
    results: list[RequestResult],
    stop_event: asyncio.Event,
) -> None:
    """Simulate concurrent file uploads."""
    synthetic_kicad = (
        b'(kicad_pcb (version 20230101)\n'
        b'  (net 0 "GND")\n'
        b'  (net 1 "VCC")\n'
        b'  (module "R1" (at 10 10) (pad "1" smd rect (at 0 -0.5) (size 1 0.6) (layers "F.Cu")))\n'
        b')\n'
    )

    while not stop_event.is_set():
        form = aiohttp.FormData()
        form.add_field(
            "file",
            synthetic_kicad,
            filename="test_board.kicad_pcb",
            content_type="application/octet-stream",
        )
        result = await _do_request(session, "POST", f"{base_url}/api/v1/projects/upload", data=form)
        results.append(result)
        await asyncio.sleep(0.01)


async def scenario_design_review(
    session: aiohttp.ClientSession,
    base_url: str,
    results: list[RequestResult],
    stop_event: asyncio.Event,
) -> None:
    """Simulate concurrent design review requests."""
    review_payload = {
        "project_id": "load-test-project",
        "scope": ["power_integrity", "signal_integrity"],
        "rule_set": "default",
    }

    while not stop_event.is_set():
        result = await _do_request(
            session, "POST", f"{base_url}/api/v1/reviews", json_body=review_payload
        )
        results.append(result)
        await asyncio.sleep(0.05)


async def scenario_chat_message(
    session: aiohttp.ClientSession,
    base_url: str,
    results: list[RequestResult],
    stop_event: asyncio.Event,
) -> None:
    """Simulate concurrent chat messages."""
    messages = [
        {"message": "What is the recommended trace width for 3A on a 1oz copper layer?"},
        {"message": "Check the impedance of a 0.15mm trace on FR-4 with 0.2mm dielectric height"},
        {"message": "What clearance is needed between 48V and ground traces per IPC-2221B?"},
        {"message": "Suggest decoupling capacitors for an STM32F405"},
        {"message": "Review the power distribution network for voltage drop"},
    ]
    idx = 0

    while not stop_event.is_set():
        payload = {
            "project_id": "load-test-project",
            "message": messages[idx % len(messages)]["message"],
            "session_id": f"load-test-session-{idx % 5}",
        }
        result = await _do_request(
            session, "POST", f"{base_url}/api/v1/chat", json_body=payload
        )
        results.append(result)
        idx += 1
        await asyncio.sleep(0.1)


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def _build_report(name: str, results: list[RequestResult], duration: float) -> ScenarioReport:
    """Compute statistics from collected request results."""
    total = len(results)
    if total == 0:
        return ScenarioReport(
            name=name, total_requests=0, successful=0, failed=0,
            error_rate=0.0, requests_per_sec=0.0,
            latency_mean_ms=0.0, latency_p50_ms=0.0, latency_p95_ms=0.0,
            latency_p99_ms=0.0, latency_min_ms=0.0, latency_max_ms=0.0,
            duration_sec=duration,
        )

    successful = sum(1 for r in results if r.error is None)
    failed = total - successful
    latencies = [r.latency_ms for r in results]

    return ScenarioReport(
        name=name,
        total_requests=total,
        successful=successful,
        failed=failed,
        error_rate=round(failed / total, 4) if total > 0 else 0.0,
        requests_per_sec=round(total / duration, 2) if duration > 0 else 0.0,
        latency_mean_ms=round(statistics.mean(latencies), 2),
        latency_p50_ms=round(_percentile(latencies, 50), 2),
        latency_p95_ms=round(_percentile(latencies, 95), 2),
        latency_p99_ms=round(_percentile(latencies, 99), 2),
        latency_min_ms=round(min(latencies), 2),
        latency_max_ms=round(max(latencies), 2),
        duration_sec=round(duration, 2),
    )


async def run_scenario(
    name: str,
    scenario_fn: Any,
    base_url: str,
    concurrency: int,
    duration: float,
) -> ScenarioReport:
    """Run a single test scenario with the given concurrency and duration."""
    results: list[RequestResult] = []
    stop_event = asyncio.Event()

    timeout = aiohttp.ClientTimeout(total=30)
    connector = aiohttp.TCPConnector(limit=concurrency * 2)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        tasks = [
            asyncio.create_task(scenario_fn(session, base_url, results, stop_event))
            for _ in range(concurrency)
        ]

        await asyncio.sleep(duration)
        stop_event.set()

        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    return _build_report(name, results, duration)


async def run_all_scenarios(
    base_url: str,
    concurrency: int,
    duration: float,
) -> LoadTestReport:
    """Run all test scenarios sequentially."""
    report = LoadTestReport()
    start = time.perf_counter()

    scenarios = [
        ("file_upload", scenario_file_upload),
        ("design_review", scenario_design_review),
        ("chat_message", scenario_chat_message),
    ]

    for name, fn in scenarios:
        print(f"\n  Running scenario: {name} (concurrency={concurrency}, duration={duration}s)")
        scenario_report = await run_scenario(name, fn, base_url, concurrency, duration)
        report.scenarios.append(scenario_report)
        report.total_requests += scenario_report.total_requests
        print(f"    Requests: {scenario_report.total_requests}")
        print(f"    RPS:      {scenario_report.requests_per_sec}")
        print(f"    P50:      {scenario_report.latency_p50_ms}ms")
        print(f"    P95:      {scenario_report.latency_p95_ms}ms")
        print(f"    P99:      {scenario_report.latency_p99_ms}ms")
        print(f"    Errors:   {scenario_report.failed} ({scenario_report.error_rate * 100:.1f}%)")

    report.total_duration_sec = round(time.perf_counter() - start, 2)
    return report


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="RouteAI load testing tool")
    parser.add_argument(
        "--base-url",
        default="http://localhost:8080",
        help="Base URL of the API service (default: http://localhost:8080)",
    )
    parser.add_argument(
        "--concurrency", "-c",
        type=int,
        default=10,
        help="Number of concurrent connections per scenario (default: 10)",
    )
    parser.add_argument(
        "--duration", "-d",
        type=float,
        default=30.0,
        help="Duration in seconds per scenario (default: 30)",
    )
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output JSON file for results (optional)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("RouteAI Load Test")
    print("=" * 60)
    print(f"  Target:      {args.base_url}")
    print(f"  Concurrency: {args.concurrency}")
    print(f"  Duration:    {args.duration}s per scenario")

    report = asyncio.run(run_all_scenarios(args.base_url, args.concurrency, args.duration))

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"  Total requests:  {report.total_requests}")
    print(f"  Total duration:  {report.total_duration_sec}s")

    for s in report.scenarios:
        print(f"\n  [{s.name}]")
        print(f"    Requests/sec:  {s.requests_per_sec}")
        print(f"    Latency P50:   {s.latency_p50_ms}ms")
        print(f"    Latency P95:   {s.latency_p95_ms}ms")
        print(f"    Latency P99:   {s.latency_p99_ms}ms")
        print(f"    Error rate:    {s.error_rate * 100:.1f}%")

    if args.output:
        output_data = {
            "total_requests": report.total_requests,
            "total_duration_sec": report.total_duration_sec,
            "scenarios": [
                {
                    "name": s.name,
                    "total_requests": s.total_requests,
                    "successful": s.successful,
                    "failed": s.failed,
                    "error_rate": s.error_rate,
                    "requests_per_sec": s.requests_per_sec,
                    "latency_mean_ms": s.latency_mean_ms,
                    "latency_p50_ms": s.latency_p50_ms,
                    "latency_p95_ms": s.latency_p95_ms,
                    "latency_p99_ms": s.latency_p99_ms,
                    "latency_min_ms": s.latency_min_ms,
                    "latency_max_ms": s.latency_max_ms,
                    "duration_sec": s.duration_sec,
                }
                for s in report.scenarios
            ],
        }
        with open(args.output, "w") as f:
            json.dump(output_data, f, indent=2)
        print(f"\nResults written to {args.output}")

    print("\nDone.")


if __name__ == "__main__":
    main()
