"""Ollama management endpoints for the RouteAI web server.

Provides connection testing, model listing, and model pulling (with streamed
progress) so the React frontend can manage Ollama directly through the
backend -- avoiding CORS issues with direct browser-to-Ollama requests.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger("routeai.server")

router = APIRouter(prefix="/api/ollama", tags=["ollama"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ollama_url() -> str:
    return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")


def _ollama_get(path: str, timeout: int = 5) -> Any:
    """Perform a GET request to Ollama and return parsed JSON."""
    import urllib.request

    url = f"{_ollama_url()}{path}"
    resp = urllib.request.urlopen(url, timeout=timeout)
    return json.loads(resp.read().decode())


# ---------------------------------------------------------------------------
# GET /api/ollama/status
# ---------------------------------------------------------------------------

@router.get("/status")
async def ollama_status() -> dict[str, Any]:
    """Test Ollama connection and return model list + response time."""
    start = time.monotonic()
    try:
        data = _ollama_get("/api/tags")
        elapsed_ms = round((time.monotonic() - start) * 1000)
        raw_models = data.get("models", [])
        models = [
            {
                "name": m.get("name", m.get("model", "")),
                "size": m.get("size", 0),
                "modified_at": m.get("modified_at", ""),
            }
            for m in raw_models
        ]
        return {
            "connected": True,
            "ollama_url": _ollama_url(),
            "response_time_ms": elapsed_ms,
            "model_count": len(models),
            "models": models,
            "error": None,
        }
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - start) * 1000)
        logger.warning("Ollama status check failed: %s", exc)
        return {
            "connected": False,
            "ollama_url": _ollama_url(),
            "response_time_ms": elapsed_ms,
            "model_count": 0,
            "models": [],
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# GET /api/ollama/models
# ---------------------------------------------------------------------------

@router.get("/models")
async def ollama_models() -> dict[str, Any]:
    """List available Ollama models with sizes and metadata."""
    try:
        data = _ollama_get("/api/tags")
        raw_models = data.get("models", [])
        models = [
            {
                "name": m.get("name", m.get("model", "")),
                "size": m.get("size", 0),
                "modified_at": m.get("modified_at", ""),
                "digest": m.get("digest", ""),
                "details": m.get("details", {}),
            }
            for m in raw_models
        ]
        return {"models": models, "count": len(models)}
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot reach Ollama at {_ollama_url()}: {exc}",
        )


# ---------------------------------------------------------------------------
# POST /api/ollama/pull
# ---------------------------------------------------------------------------

class PullRequest(BaseModel):
    model: str


@router.post("/pull")
async def ollama_pull(req: PullRequest) -> StreamingResponse:
    """Trigger model download and stream progress as newline-delimited JSON.

    Each line is a JSON object with at least a ``status`` field, plus optional
    ``completed`` and ``total`` byte counts for download progress.
    """
    import urllib.request

    model = req.model.strip()
    if not model:
        raise HTTPException(status_code=400, detail="Model name is required")

    url = f"{_ollama_url()}/api/pull"
    payload = json.dumps({"name": model, "stream": True}).encode()
    headers = {"Content-Type": "application/json"}

    def _stream():
        try:
            r = urllib.request.Request(url, data=payload, headers=headers)
            resp = urllib.request.urlopen(r, timeout=600)

            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line.decode())
                        yield json.dumps(obj) + "\n"
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass

            # Flush any remaining buffer
            if buf.strip():
                try:
                    obj = json.loads(buf.strip().decode())
                    yield json.dumps(obj) + "\n"
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass

            yield json.dumps({"status": "success"}) + "\n"
        except Exception as exc:
            logger.error("Ollama pull failed for %s: %s", model, exc)
            yield json.dumps({"status": f"error: {exc}"}) + "\n"

    return StreamingResponse(
        _stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
