"""Unified LLM provider abstraction for RouteAI.

Supports Ollama (primary/local), Anthropic Claude, and Google Gemini with
automatic provider detection and fallback routing.
"""

from __future__ import annotations

from routeai_intelligence.llm.gpu_detect import (
    GPUInfo,
    get_gpu_info,
    get_vram_gb,
)
from routeai_intelligence.llm.model_manager import (
    TASK_TIER_MAP,
    GPUProfile,
    ModelManager,
    ModelTier,
)
from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
    TokenUsage,
    ToolCall,
)
from routeai_intelligence.llm.router import LLMRouter

__all__ = [
    "TASK_TIER_MAP",
    "GPUInfo",
    "GPUProfile",
    "LLMProvider",
    "LLMResponse",
    "LLMRouter",
    "ModelManager",
    "ModelTier",
    "TokenUsage",
    "ToolCall",
    "get_gpu_info",
    "get_vram_gb",
]
