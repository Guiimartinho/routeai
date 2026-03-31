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
    GPUProfile,
    ModelManager,
    ModelTier,
    TASK_TIER_MAP,
)
from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
    TokenUsage,
    ToolCall,
)
from routeai_intelligence.llm.router import LLMRouter

__all__ = [
    "GPUInfo",
    "GPUProfile",
    "LLMProvider",
    "LLMResponse",
    "LLMRouter",
    "ModelManager",
    "ModelTier",
    "TASK_TIER_MAP",
    "TokenUsage",
    "ToolCall",
    "get_gpu_info",
    "get_vram_gb",
]
