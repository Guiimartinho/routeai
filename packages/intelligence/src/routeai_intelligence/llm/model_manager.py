"""VRAM-aware model manager for local Ollama inference.

Selects the right model for each task based on available GPU VRAM.
All inference is 100% local via Ollama -- no cloud APIs.

Models are organized into three tiers:
- T3_FAST: Always-resident small model for quick tasks.
- T2_STRUCTURED: Swap-in model for structured output tasks.
- T1_HEAVY: Large model for complex analysis (decomposed on low VRAM).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class ModelTier(Enum):
    """Model tier based on task complexity."""

    T3_FAST = "t3_fast"
    T2_STRUCTURED = "t2_structured"
    T1_HEAVY = "t1_heavy"


@dataclass(frozen=True)
class GPUProfile:
    """GPU memory profile determining model selection."""

    vram_gb: int
    resident_model: str  # Always loaded (T3)
    swap_model: str | None  # Loaded on demand (T2/T1)
    max_context: int  # num_ctx limit for Ollama
    max_parallel: int  # Max parallel requests


GPU_PROFILES: dict[int, GPUProfile] = {
    6: GPUProfile(
        vram_gb=6,
        resident_model="phi3.5:3.8b",
        swap_model="qwen2.5:7b",
        max_context=2048,
        max_parallel=1,
    ),
    8: GPUProfile(
        vram_gb=8,
        resident_model="phi3.5:3.8b",
        swap_model="qwen2.5:7b",
        max_context=4096,
        max_parallel=1,
    ),
    10: GPUProfile(
        vram_gb=10,
        resident_model="qwen2.5:7b",
        swap_model="qwen2.5-coder:14b",
        max_context=4096,
        max_parallel=2,
    ),
    12: GPUProfile(
        vram_gb=12,
        resident_model="qwen2.5:7b",
        swap_model="qwen2.5-coder:14b",
        max_context=4096,
        max_parallel=2,
    ),
    16: GPUProfile(
        vram_gb=16,
        resident_model="qwen2.5:7b",
        swap_model="qwen2.5-coder:14b",
        max_context=8192,
        max_parallel=2,
    ),
    24: GPUProfile(
        vram_gb=24,
        resident_model="qwen2.5:7b",
        swap_model="qwen2.5:32b",
        max_context=8192,
        max_parallel=4,
    ),
}

TASK_TIER_MAP: dict[str, ModelTier] = {
    # T1 -- heavy analysis, decomposed on low VRAM
    "design_review": ModelTier.T1_HEAVY,
    "schematic_review": ModelTier.T1_HEAVY,
    "return_path_analysis": ModelTier.T1_HEAVY,
    "semantic_erc": ModelTier.T1_HEAVY,
    "routing_critic": ModelTier.T1_HEAVY,
    "cross_datasheet": ModelTier.T1_HEAVY,
    "power_budget": ModelTier.T1_HEAVY,
    # T2 -- structured output tasks
    "constraint_generation": ModelTier.T2_STRUCTURED,
    "placement_strategy": ModelTier.T2_STRUCTURED,
    "routing_director": ModelTier.T2_STRUCTURED,
    "intent_aware_router": ModelTier.T2_STRUCTURED,
    "stackup_advisor": ModelTier.T2_STRUCTURED,
    "bga_fanout": ModelTier.T2_STRUCTURED,
    "circuit_synthesizer": ModelTier.T2_STRUCTURED,
    "pdn_designer": ModelTier.T2_STRUCTURED,
    "thermal_analyzer": ModelTier.T2_STRUCTURED,
    "fabrication_advisor": ModelTier.T2_STRUCTURED,
    "routing_style_learner": ModelTier.T2_STRUCTURED,
    # T3 -- fast, lightweight tasks
    "schema_validation": ModelTier.T3_FAST,
    "citation_check": ModelTier.T3_FAST,
    "explain_placement": ModelTier.T3_FAST,
    "component_search": ModelTier.T3_FAST,
    "chat": ModelTier.T3_FAST,
    "signal_flow_floorplan": ModelTier.T3_FAST,
    "routing_style_applier": ModelTier.T3_FAST,
    "circuit_suggester": ModelTier.T3_FAST,
}

# Sorted VRAM thresholds for profile lookup (descending for round-down)
_VRAM_THRESHOLDS = sorted(GPU_PROFILES.keys())


def _resolve_profile(vram_gb: int) -> GPUProfile:
    """Find the best GPU profile for the given VRAM (round down)."""
    selected = _VRAM_THRESHOLDS[0]
    for threshold in _VRAM_THRESHOLDS:
        if threshold <= vram_gb:
            selected = threshold
        else:
            break
    return GPU_PROFILES[selected]


class ModelManager:
    """VRAM-aware model selection for local Ollama inference.

    Picks the right model for each task type based on available GPU memory.
    Tracks which model is currently loaded to determine swap requirements.
    """

    def __init__(self, vram_gb: int) -> None:
        self._profile = _resolve_profile(vram_gb)
        self._current_model: str = self._profile.resident_model
        logger.info(
            "ModelManager initialized: vram=%dGB, profile=%dGB, "
            "resident=%s, swap=%s, ctx=%d, parallel=%d",
            vram_gb,
            self._profile.vram_gb,
            self._profile.resident_model,
            self._profile.swap_model,
            self._profile.max_context,
            self._profile.max_parallel,
        )

    @property
    def profile(self) -> GPUProfile:
        """Current GPU profile."""
        return self._profile

    def get_tier(self, task_type: str) -> ModelTier:
        """Return the tier for a task type. Defaults to T3_FAST for unknown tasks."""
        return TASK_TIER_MAP.get(task_type, ModelTier.T3_FAST)

    def select_model(self, task_type: str) -> str:
        """Return the Ollama model name for the given task type.

        Selection logic:
        - T3 (fast): Always use the resident model.
        - T2 (structured): Use swap model if available, else resident.
        - T1 (heavy): Use swap model. On <24GB VRAM, the swap model
          (14B) handles T1 with decomposition.
        """
        tier = self.get_tier(task_type)

        if tier == ModelTier.T3_FAST:
            model = self._profile.resident_model
        elif tier == ModelTier.T2_STRUCTURED:
            model = self._profile.swap_model or self._profile.resident_model
        else:
            # T1_HEAVY: swap_model handles it (32B on 24GB, 14B+decomposition otherwise)
            model = self._profile.swap_model or self._profile.resident_model

        self._current_model = model
        return model

    def needs_swap(self, target_model: str) -> bool:
        """Check if loading target_model requires unloading the current model."""
        return target_model != self._current_model

    def is_t1_decomposed(self) -> bool:
        """True if T1 tasks must be decomposed (VRAM < 24GB)."""
        return self._profile.vram_gb < 24

    def get_context_limit(self) -> int:
        """Return the max context window size (num_ctx) for this profile."""
        return self._profile.max_context
