"""GPU detection for local LLM inference."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass

_cached: GPUInfo | None = None


@dataclass(frozen=True)
class GPUInfo:
    """Basic GPU information for VRAM-based model selection."""

    name: str
    vram_total_mb: int
    vram_free_mb: int
    compute_capability: str


_FALLBACK = GPUInfo(
    name="Unknown",
    vram_total_mb=8192,
    vram_free_mb=6144,
    compute_capability="0.0",
)


def detect_gpu() -> GPUInfo:
    """Query nvidia-smi for GPU info; returns fallback on any failure."""
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,compute_cap",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        line = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 4:
            return _FALLBACK
        return GPUInfo(
            name=parts[0],
            vram_total_mb=int(parts[1]),
            vram_free_mb=int(parts[2]),
            compute_capability=parts[3],
        )
    except (
        FileNotFoundError,
        subprocess.TimeoutExpired,
        subprocess.CalledProcessError,
        ValueError,
        IndexError,
    ):
        return _FALLBACK


def get_gpu_info() -> GPUInfo:
    """Return cached GPU info, detecting on first call."""
    global _cached
    if _cached is None:
        _cached = detect_gpu()
    return _cached


def get_vram_gb() -> int:
    """Return total VRAM in whole gigabytes."""
    return get_gpu_info().vram_total_mb // 1024
