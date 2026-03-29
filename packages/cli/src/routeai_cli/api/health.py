"""Health and info endpoints for the RouteAI API.

Provides service status, LLM provider info, project count, and uptime.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from fastapi import APIRouter

logger = logging.getLogger("routeai.server")

router = APIRouter(tags=["health"])

# Recorded at module import time; close enough to server start.
_SERVER_START_TIME = time.time()

_VERSION = "0.2.0"

_FEATURES = [
    "kicad-parsing",
    "eagle-parsing",
    "drc-analysis",
    "ai-review",
    "component-search",
    "impedance-calc",
    "stackup-analysis",
    "workflow-automation",
    "llm-tool-use",
]

_ENGINES = [
    {"name": "ollama", "type": "local", "description": "Local LLM via Ollama"},
    {"name": "gemini", "type": "cloud", "description": "Google Gemini API"},
    {"name": "anthropic", "type": "cloud", "description": "Anthropic Claude API"},
]


def _check_ollama() -> dict[str, Any]:
    """Probe Ollama and return status dict."""
    import urllib.request

    ollama_url = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
    try:
        resp = urllib.request.urlopen(f"{ollama_url}/api/tags", timeout=2)
        import json

        data = json.loads(resp.read().decode())
        models = [m.get("name", "unknown") for m in data.get("models", [])]
        return {
            "available": True,
            "url": ollama_url,
            "models": models,
            "model_count": len(models),
        }
    except Exception:
        return {"available": False, "url": ollama_url, "models": [], "model_count": 0}


def _detect_active_provider() -> str:
    """Return the name of the first available LLM provider."""
    try:
        from routeai_cli.api.llm import detect_llm_provider

        provider = detect_llm_provider()
        return provider or "none"
    except Exception:
        return "unknown"


@router.get("/health")
async def health_check() -> dict[str, Any]:
    """Service health: status, LLM info, project count, uptime."""
    from routeai_cli.api.models import PROJECTS

    uptime_seconds = time.time() - _SERVER_START_TIME
    ollama_status = _check_ollama()
    active_provider = _detect_active_provider()

    return {
        "status": "ok",
        "service": "routeai",
        "version": _VERSION,
        "uptime_seconds": round(uptime_seconds, 1),
        "active_llm_provider": active_provider,
        "ollama": ollama_status,
        "project_count": len(PROJECTS),
    }


@router.get("/api/info")
async def api_info() -> dict[str, Any]:
    """API metadata: version, features, available engines."""
    return {
        "name": "RouteAI",
        "version": _VERSION,
        "features": _FEATURES,
        "engines": _ENGINES,
        "engine_count": len(_ENGINES),
    }
