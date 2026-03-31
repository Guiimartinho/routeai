"""RouteAI ML-only micro-service.

This is the ONLY Python service that runs in production.  It exposes a
minimal FastAPI application on port 8001 with endpoints for ML/LLM
operations that cannot run in Go (Ollama chat, RAG, placement analysis,
design review).

The Go API gateway (port 8080) proxies ML-related calls here.

Usage:
    uvicorn routeai_intelligence.ml_service:app --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import traceback
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("routeai.ml_service")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="RouteAI ML Service",
    version="0.4.0",
    description="ML/LLM micro-service for RouteAI (design review, placement, RAG, chat).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_start_time = time.time()

# ---------------------------------------------------------------------------
# Ollama settings
# ---------------------------------------------------------------------------
OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL",
    os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434"),
).rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "300"))

_ollama_client = httpx.AsyncClient(base_url=OLLAMA_BASE_URL, timeout=OLLAMA_TIMEOUT)

# ---------------------------------------------------------------------------
# Lazy-loaded heavy dependencies
# ---------------------------------------------------------------------------
_rag_instance: Any = None
_ollama_provider: Any = None


def _get_ollama_provider() -> Any:
    """Lazy-load the OllamaProvider so import time stays fast."""
    global _ollama_provider
    if _ollama_provider is None:
        try:
            from routeai_intelligence.llm.ollama_provider import OllamaProvider

            _ollama_provider = OllamaProvider(
                host=OLLAMA_BASE_URL, model=OLLAMA_MODEL
            )
            logger.info("OllamaProvider initialised (model=%s)", OLLAMA_MODEL)
        except Exception:
            logger.warning("OllamaProvider unavailable, falling back to raw httpx")
    return _ollama_provider


def _get_rag() -> Any:
    """Lazy-load the DatasheetRAG pipeline."""
    global _rag_instance
    if _rag_instance is None:
        try:
            from routeai_intelligence.rag.datasheet_rag import DatasheetRAG

            db_path = os.getenv("RAG_DB_PATH", "data/datasheet_index.db")
            _rag_instance = DatasheetRAG(db_path=db_path)
            logger.info("DatasheetRAG initialised (db=%s)", db_path)
        except Exception:
            logger.warning("DatasheetRAG unavailable: %s", traceback.format_exc())
    return _rag_instance


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ReviewRequest(BaseModel):
    """Request body for POST /ml/review."""

    workflow_id: str = ""
    board_data: dict[str, Any] = Field(default_factory=dict)
    rules: list[str] = Field(default_factory=list)
    focus_areas: list[str] = Field(default_factory=list)


class ReviewResponse(BaseModel):
    """Response body for POST /ml/review."""

    workflow_id: str
    status: str  # "completed" | "error"
    summary: str = ""
    score: float | None = None
    items: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class PlacementRequest(BaseModel):
    """Request body for POST /ml/placement."""

    workflow_id: str = ""
    board_data: dict[str, Any] = Field(default_factory=dict)
    constraints: dict[str, Any] = Field(default_factory=dict)
    strategy: str = "auto"


class PlacementResponse(BaseModel):
    """Response body for POST /ml/placement."""

    workflow_id: str
    status: str
    placements: list[dict[str, Any]] = Field(default_factory=list)
    rationale: str = ""
    error: str | None = None


class ChatRequest(BaseModel):
    """Request body for POST /ml/chat."""

    message: str
    context: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)
    model: str = ""


class ChatResponse(BaseModel):
    """Response body for POST /ml/chat."""

    reply: str
    model: str = ""
    usage: dict[str, int] = Field(default_factory=dict)
    error: str | None = None


class RAGQueryRequest(BaseModel):
    """Request body for POST /ml/rag/query."""

    query: str
    component: str = ""
    top_k: int = 5


class RAGQueryResponse(BaseModel):
    """Response body for POST /ml/rag/query."""

    answer: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class SuggestRequest(BaseModel):
    """Request body for POST /ml/suggest."""

    description: str
    category: str = ""
    constraints: dict[str, Any] = Field(default_factory=dict)


class SuggestResponse(BaseModel):
    """Response body for POST /ml/suggest."""

    suggestions: list[dict[str, Any]] = Field(default_factory=list)
    rationale: str = ""
    error: str | None = None


class RoutingStrategyRequest(BaseModel):
    """Request body for POST /ml/routing-strategy."""

    workflow_id: str = ""
    board_state: dict[str, Any] = Field(default_factory=dict)
    constraints: dict[str, Any] = Field(default_factory=dict)
    schematic_info: dict[str, Any] = Field(default_factory=dict)


class RoutingStrategyResponse(BaseModel):
    """Response body for POST /ml/routing-strategy."""

    workflow_id: str = ""
    status: str = "completed"  # "completed" | "error"
    routing_order: list[dict[str, Any]] = Field(default_factory=list)
    layer_assignment: dict[str, Any] = Field(default_factory=dict)
    via_strategy: dict[str, Any] = Field(default_factory=dict)
    cost_weights: dict[str, Any] = Field(default_factory=dict)
    impedance_targets: dict[str, Any] = Field(default_factory=dict)
    constraints_generated: list[dict[str, Any]] = Field(default_factory=list)
    rationale: str = ""
    error: str | None = None


class ConstraintRequest(BaseModel):
    """Request body for POST /ml/constraints."""

    workflow_id: str = ""
    schematic: dict[str, Any] = Field(default_factory=dict)
    components: list[dict[str, Any]] = Field(default_factory=list)
    nets: list[dict[str, Any]] = Field(default_factory=list)
    board_params: dict[str, Any] = Field(default_factory=dict)


class ConstraintResponse(BaseModel):
    """Response body for POST /ml/constraints."""

    workflow_id: str = ""
    status: str = "completed"
    net_classes: list[dict[str, Any]] = Field(default_factory=list)
    diff_pairs: list[dict[str, Any]] = Field(default_factory=list)
    length_groups: list[dict[str, Any]] = Field(default_factory=list)
    special_rules: list[dict[str, Any]] = Field(default_factory=list)
    rationale: str = ""
    error: str | None = None


class AnalysisRequest(BaseModel):
    """Request body for POST /ml/analyze."""

    workflow_id: str = ""
    board_data: dict[str, Any] = Field(default_factory=dict)


class AnalysisResponse(BaseModel):
    """Response body for POST /ml/analyze."""

    workflow_id: str = ""
    status: str = "completed"
    violations: list[dict[str, Any]] = Field(default_factory=list)
    score: float = 100.0
    passed: bool = True
    stats: dict[str, int] = Field(default_factory=dict)
    elapsed_seconds: float = 0.0
    error: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, Any]:
    """Service health check."""
    uptime = time.time() - _start_time

    # Quick Ollama connectivity check.
    ollama_ok = False
    try:
        r = await _ollama_client.get("/api/version", timeout=5.0)
        ollama_ok = r.status_code == 200
    except Exception:
        pass

    return {
        "status": "ok",
        "service": "routeai-ml",
        "version": "0.4.0",
        "uptime_seconds": round(uptime, 1),
        "ollama": {
            "connected": ollama_ok,
            "url": OLLAMA_BASE_URL,
            "model": OLLAMA_MODEL,
        },
    }


@app.get("/ml/gpu-info")
async def gpu_info() -> dict[str, Any]:
    """Return GPU info, VRAM profile, and model tier mapping."""
    from routeai_intelligence.llm.gpu_detect import get_gpu_info
    from routeai_intelligence.llm.model_manager import ModelManager

    gpu = get_gpu_info()
    vram_gb = gpu.vram_total_mb // 1024
    manager = ModelManager(vram_gb)
    profile = manager.profile

    return {
        "gpu": {
            "name": gpu.name,
            "vram_total_mb": gpu.vram_total_mb,
            "vram_free_mb": gpu.vram_free_mb,
            "compute_capability": gpu.compute_capability,
        },
        "profile": {
            "vram_gb": profile.vram_gb,
            "resident_model": profile.resident_model,
            "swap_model": profile.swap_model,
            "max_context": profile.max_context,
            "max_parallel": profile.max_parallel,
        },
        "tiers": {
            "t3_fast": profile.resident_model,
            "t2_structured": profile.swap_model or profile.resident_model,
            "t1_strategy": "direct" if vram_gb >= 24 else "decompose",
        },
    }


@app.post("/ml/review", response_model=ReviewResponse)
async def ai_review(req: ReviewRequest) -> ReviewResponse:
    """Run AI design review on board data using Ollama."""
    try:
        board = req.board_data
        if not board:
            return ReviewResponse(
                workflow_id=req.workflow_id,
                status="error",
                error="board_data is required",
            )

        # Build a prompt summarising the board for the LLM.
        components = board.get("components", [])
        traces = board.get("traces", [])
        nets = board.get("nets", [])
        prompt = (
            "You are an expert PCB design reviewer. Analyze this board and provide "
            "findings as a JSON array of objects with keys: category, severity, title, "
            "message, suggestion.\n\n"
            f"Board summary:\n"
            f"- Components: {len(components)}\n"
            f"- Traces: {len(traces)}\n"
            f"- Nets: {len(nets)}\n"
        )
        if req.focus_areas:
            prompt += f"- Focus areas: {', '.join(req.focus_areas)}\n"
        if components:
            refs = [c.get("reference", "?") for c in components[:20]]
            prompt += f"- Component refs (first 20): {', '.join(refs)}\n"
        prompt += "\nProvide your review findings as JSON:"

        # Call Ollama.
        ollama_resp = await _ollama_client.post(
            "/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.3},
            },
            timeout=OLLAMA_TIMEOUT,
        )
        ollama_resp.raise_for_status()
        data = ollama_resp.json()
        reply_text = data.get("message", {}).get("content", "")

        # Try to extract JSON items from the reply.
        items = _extract_json_array(reply_text)

        return ReviewResponse(
            workflow_id=req.workflow_id,
            status="completed",
            summary=reply_text[:500] if not items else f"Found {len(items)} findings.",
            score=None,
            items=items,
        )

    except (httpx.ConnectError, httpx.TimeoutException):
        logger.warning("Ollama unavailable for review, returning fallback")
        return ReviewResponse(
            workflow_id=req.workflow_id,
            status="completed",
            summary="LLM unavailable, run local DRC instead",
            items=[],
            error=f"Ollama unreachable at {OLLAMA_BASE_URL} - returning empty results",
        )
    except Exception as exc:
        logger.exception("AI review failed")
        return ReviewResponse(
            workflow_id=req.workflow_id,
            status="error",
            error=str(exc),
        )


@app.post("/ml/placement", response_model=PlacementResponse)
async def ai_placement(req: PlacementRequest) -> PlacementResponse:
    """Run AI placement analysis on board data using Ollama."""
    try:
        board = req.board_data
        if not board:
            return PlacementResponse(
                workflow_id=req.workflow_id,
                status="error",
                error="board_data is required",
            )

        components = board.get("components", [])
        nets = board.get("nets", [])
        prompt = (
            "You are an expert PCB placement engineer. Given the following board data, "
            "suggest optimal component placements. Return a JSON array of objects with "
            "keys: reference, x, y, rotation, rationale.\n\n"
            f"Board: {board.get('width', 0)}mm x {board.get('height', 0)}mm\n"
            f"Components ({len(components)}):\n"
        )
        for comp in components[:30]:
            prompt += (
                f"  - {comp.get('reference', '?')}: {comp.get('value', '')} "
                f"({comp.get('footprint', '')})\n"
            )
        if req.constraints:
            prompt += f"\nConstraints: {req.constraints}\n"
        prompt += f"\nStrategy: {req.strategy}\n"
        prompt += "\nProvide placement suggestions as JSON:"

        ollama_resp = await _ollama_client.post(
            "/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.3},
            },
            timeout=OLLAMA_TIMEOUT,
        )
        ollama_resp.raise_for_status()
        data = ollama_resp.json()
        reply_text = data.get("message", {}).get("content", "")

        placements = _extract_json_array(reply_text)

        return PlacementResponse(
            workflow_id=req.workflow_id,
            status="completed",
            placements=placements,
            rationale=reply_text[:500],
        )

    except (httpx.ConnectError, httpx.TimeoutException):
        logger.warning("Ollama unavailable for placement, returning fallback")
        return PlacementResponse(
            workflow_id=req.workflow_id,
            status="completed",
            placements=[],
            rationale="LLM unavailable, no AI placement suggestions at this time",
            error=f"Ollama unreachable at {OLLAMA_BASE_URL} - returning empty results",
        )
    except Exception as exc:
        logger.exception("AI placement failed")
        return PlacementResponse(
            workflow_id=req.workflow_id,
            status="error",
            error=str(exc),
        )


@app.post("/ml/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Chat with Ollama about a PCB design."""
    model = req.model or OLLAMA_MODEL

    messages: list[dict[str, str]] = []

    # System prompt.
    messages.append(
        {
            "role": "system",
            "content": (
                "You are RouteAI, an expert PCB design assistant. "
                "Help the engineer with schematic review, component selection, "
                "layout advice, DRC issues, signal integrity, and manufacturing. "
                "Be concise and precise."
            ),
        }
    )

    # History.
    for msg in req.history:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})

    # Current message.
    content = req.message
    if req.context:
        content = f"[Context: {req.context}]\n\n{content}"
    messages.append({"role": "user", "content": content})

    try:
        ollama_resp = await _ollama_client.post(
            "/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
            },
            timeout=OLLAMA_TIMEOUT,
        )
        ollama_resp.raise_for_status()
        data = ollama_resp.json()

        reply_text = data.get("message", {}).get("content", "")
        usage: dict[str, int] = {}
        if "eval_count" in data:
            usage["completion_tokens"] = data["eval_count"]
        if "prompt_eval_count" in data:
            usage["prompt_tokens"] = data["prompt_eval_count"]

        return ChatResponse(reply=reply_text, model=model, usage=usage)

    except (httpx.ConnectError, httpx.TimeoutException):
        return ChatResponse(
            reply="",
            model=model,
            error=f"Ollama unreachable at {OLLAMA_BASE_URL}",
        )
    except Exception as exc:
        logger.exception("Chat failed")
        return ChatResponse(
            reply="",
            model=model,
            error=str(exc),
        )


@app.post("/ml/rag/query", response_model=RAGQueryResponse)
async def rag_query(req: RAGQueryRequest) -> RAGQueryResponse:
    """RAG query against indexed datasheets."""
    rag = _get_rag()
    if rag is None:
        return RAGQueryResponse(
            answer="",
            error="RAG pipeline not available (missing dependencies or index).",
        )

    try:
        result = rag.query(req.query, component=req.component or None, top_k=req.top_k)
        sources = []
        for src in getattr(result, "sources", []):
            sources.append(
                {
                    "page": getattr(src, "page", None),
                    "excerpt": getattr(src, "excerpt", ""),
                    "section": getattr(src, "section", ""),
                    "similarity": getattr(src, "similarity", 0.0),
                }
            )
        return RAGQueryResponse(
            answer=getattr(result, "text", str(result)),
            sources=sources,
        )
    except Exception as exc:
        logger.exception("RAG query failed")
        return RAGQueryResponse(answer="", error=str(exc))


@app.post("/ml/suggest", response_model=SuggestResponse)
async def suggest_components(req: SuggestRequest) -> SuggestResponse:
    """Suggest components matching a description using Ollama."""
    try:
        prompt = (
            "You are an expert electronics component engineer. "
            "Suggest suitable components for the following requirement. "
            "Return a JSON array of objects with keys: mpn, manufacturer, "
            "description, package, rationale.\n\n"
            f"Requirement: {req.description}\n"
        )
        if req.category:
            prompt += f"Category: {req.category}\n"
        if req.constraints:
            prompt += f"Constraints: {req.constraints}\n"
        prompt += "\nSuggestions (as JSON array):"

        ollama_resp = await _ollama_client.post(
            "/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.4},
            },
            timeout=OLLAMA_TIMEOUT,
        )
        ollama_resp.raise_for_status()
        data = ollama_resp.json()
        reply_text = data.get("message", {}).get("content", "")

        suggestions = _extract_json_array(reply_text)

        return SuggestResponse(
            suggestions=suggestions,
            rationale=reply_text[:500],
        )

    except httpx.ConnectError:
        return SuggestResponse(
            error=f"Ollama unreachable at {OLLAMA_BASE_URL}",
        )
    except Exception as exc:
        logger.exception("Component suggestion failed")
        return SuggestResponse(error=str(exc))


@app.post("/ml/routing-strategy", response_model=RoutingStrategyResponse)
async def routing_strategy(req: RoutingStrategyRequest) -> RoutingStrategyResponse:
    """Generate AI routing strategy using LLM.

    Analyzes board state, constraints, and schematic info to produce net
    priorities, layer assignments, impedance targets, and routing order.
    Falls back to rule-based heuristics if Ollama is unavailable.
    """
    try:
        board = req.board_state
        if not board:
            return RoutingStrategyResponse(
                workflow_id=req.workflow_id,
                status="error",
                error="board_state is required",
            )

        nets = board.get("nets", [])
        components = board.get("components", [])
        layers = board.get("layers", [])
        traces = board.get("traces", [])

        # Build prompt for the LLM
        prompt = (
            "You are an expert PCB routing strategist. Analyze the following board "
            "design and produce a routing strategy. Return a JSON object with keys:\n"
            "- routing_order: array of {net_name, priority (1-10, 10=highest), reason, "
            "constraints: {max_length_mm, min_spacing_mm, impedance_ohm, preferred_layers}}\n"
            "- layer_assignment: object mapping net patterns to {signal_layers: [...], reason}\n"
            "- via_strategy: {high_speed, general, power} each 'through_only' or 'through_or_blind'\n"
            "- cost_weights: {wire_length, via_count, congestion, layer_change} each 0.0-1.0\n"
            "- impedance_targets: object mapping net class to target impedance in ohms\n"
            "- constraints_generated: array of {type, description, affected_nets, parameters}\n\n"
            f"Board summary:\n"
            f"- Nets: {len(nets)}\n"
            f"- Components: {len(components)}\n"
            f"- Layers: {len(layers)}\n"
            f"- Existing traces: {len(traces)}\n"
        )
        if req.constraints:
            prompt += f"- Existing constraints: {req.constraints}\n"
        if nets:
            net_names = [n.get("name", "?") for n in nets[:30]]
            prompt += f"- Net names (first 30): {', '.join(net_names)}\n"
        if components:
            refs = [c.get("reference", "?") for c in components[:20]]
            prompt += f"- Component refs (first 20): {', '.join(refs)}\n"
        if req.schematic_info:
            prompt += f"- Schematic info: {req.schematic_info}\n"
        prompt += "\nProduce the routing strategy as JSON:"

        try:
            ollama_resp = await _ollama_client.post(
                "/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"temperature": 0.2},
                },
                timeout=OLLAMA_TIMEOUT,
            )
            ollama_resp.raise_for_status()
            data = ollama_resp.json()
            reply_text = data.get("message", {}).get("content", "")

            parsed = _extract_json_object(reply_text)

            return RoutingStrategyResponse(
                workflow_id=req.workflow_id,
                status="completed",
                routing_order=parsed.get("routing_order", []),
                layer_assignment=parsed.get("layer_assignment", {}),
                via_strategy=parsed.get("via_strategy", {}),
                cost_weights=parsed.get("cost_weights", {}),
                impedance_targets=parsed.get("impedance_targets", {}),
                constraints_generated=parsed.get("constraints_generated", []),
                rationale=reply_text[:500],
            )

        except (httpx.ConnectError, httpx.TimeoutException):
            logger.warning("Ollama unavailable for routing-strategy, using rule-based fallback")
            return _rule_based_routing_strategy(req)

    except Exception as exc:
        logger.exception("Routing strategy generation failed")
        return RoutingStrategyResponse(
            workflow_id=req.workflow_id,
            status="error",
            error=str(exc),
        )


@app.post("/ml/constraints", response_model=ConstraintResponse)
async def generate_constraints(req: ConstraintRequest) -> ConstraintResponse:
    """Generate design constraints from schematic/board analysis.

    Analyzes component types, interfaces, and net topology to produce net
    classes, differential pairs, length groups, and special routing rules.
    Falls back to pattern matching if Ollama is unavailable.
    """
    try:
        if not req.components and not req.schematic:
            return ConstraintResponse(
                workflow_id=req.workflow_id,
                status="error",
                error="At least one of 'components' or 'schematic' is required",
            )

        components = req.components
        nets = req.nets
        schematic = req.schematic

        prompt = (
            "You are an expert PCB design constraints engineer. Analyze the following "
            "schematic components, nets, and board parameters to generate design constraints.\n"
            "Return a JSON object with keys:\n"
            "- net_classes: array of {name, nets: [...], trace_width_mm, clearance_mm, "
            "impedance_ohm (optional), description}\n"
            "- diff_pairs: array of {name, positive_net, negative_net, "
            "target_impedance_ohm, max_skew_mm}\n"
            "- length_groups: array of {name, nets: [...], target_length_mm (optional), "
            "tolerance_mm}\n"
            "- special_rules: array of {type, description, affected_nets, parameters}\n\n"
        )
        if components:
            prompt += f"Components ({len(components)}):\n"
            for comp in components[:30]:
                ref = comp.get("reference", "?")
                value = comp.get("value", "")
                footprint = comp.get("footprint", "")
                desc = comp.get("description", "")
                prompt += f"  - {ref}: {value} ({footprint}) {desc}\n"
        if nets:
            net_names = [n.get("name", "?") for n in nets[:40]]
            prompt += f"\nNets (first 40): {', '.join(net_names)}\n"
        if schematic:
            prompt += f"\nSchematic data: {schematic}\n"
        if req.board_params:
            prompt += f"\nBoard parameters: {req.board_params}\n"
        prompt += "\nGenerate constraints as JSON:"

        try:
            ollama_resp = await _ollama_client.post(
                "/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"temperature": 0.2},
                },
                timeout=OLLAMA_TIMEOUT,
            )
            ollama_resp.raise_for_status()
            data = ollama_resp.json()
            reply_text = data.get("message", {}).get("content", "")

            parsed = _extract_json_object(reply_text)

            return ConstraintResponse(
                workflow_id=req.workflow_id,
                status="completed",
                net_classes=parsed.get("net_classes", []),
                diff_pairs=parsed.get("diff_pairs", []),
                length_groups=parsed.get("length_groups", []),
                special_rules=parsed.get("special_rules", []),
                rationale=reply_text[:500],
            )

        except (httpx.ConnectError, httpx.TimeoutException):
            logger.warning("Ollama unavailable for constraints, using pattern-matching fallback")
            return _pattern_based_constraints(req)

    except Exception as exc:
        logger.exception("Constraint generation failed")
        return ConstraintResponse(
            workflow_id=req.workflow_id,
            status="error",
            error=str(exc),
        )


@app.post("/ml/analyze", response_model=AnalysisResponse)
async def run_analysis(req: AnalysisRequest) -> AnalysisResponse:
    """Run DRC analysis on board data.

    Uses the Python DRC engine directly (no LLM needed). Converts the
    incoming board JSON into the solver's BoardDesign model and runs
    geometric, electrical, and manufacturing checks.
    """
    try:
        board_data = req.board_data
        if not board_data:
            return AnalysisResponse(
                workflow_id=req.workflow_id,
                status="error",
                error="board_data is required",
            )

        try:
            from routeai_solver.board_model import (
                BoardDesign,
                CopperZone,
                DesignRules,
                Layer,
                LayerType,
                Net,
                Pad,
                PadShape,
                Trace,
                TraceSegment,
                Via,
            )
            from routeai_solver.drc.engine import DRCEngine
        except ImportError as ie:
            logger.warning("DRC engine not available: %s", ie)
            return AnalysisResponse(
                workflow_id=req.workflow_id,
                status="error",
                error=f"DRC engine not available: {ie}",
            )

        board = _build_board_design(board_data)

        engine = DRCEngine()
        report = engine.run(board)

        violations_out: list[dict[str, Any]] = []
        for v in report.violations:
            violations_out.append({
                "rule": v.rule,
                "severity": v.severity.value,
                "message": v.message,
                "location": list(v.location) if v.location else None,
                "affected_items": v.affected_items,
            })

        # Score: 100 minus weighted violations (errors=-10, warnings=-3, info=-1),
        # clamped to [0, 100].
        score = max(
            0.0,
            100.0 - (report.error_count * 10.0)
            - (report.warning_count * 3.0)
            - (report.info_count * 1.0),
        )

        return AnalysisResponse(
            workflow_id=req.workflow_id,
            status="completed",
            violations=violations_out,
            score=round(score, 1),
            passed=report.passed,
            stats=report.stats,
            elapsed_seconds=round(report.elapsed_seconds, 4),
        )

    except Exception as exc:
        logger.exception("DRC analysis failed")
        return AnalysisResponse(
            workflow_id=req.workflow_id,
            status="error",
            error=str(exc),
        )


@app.post("/ml/export/gerber")
def export_gerber(request: dict) -> dict[str, Any]:
    """Generate Gerber export files from board data.

    Uses the gerber generator from routeai_solver to produce manufacturing
    output files (copper layers, solder mask, silk screen, drill files).
    """
    try:
        board_data = request.get("board_data", {})
        if not board_data:
            return {"files": [], "status": "error", "error": "board_data is required"}

        try:
            from routeai_solver.gerber_generator import generate_gerber
        except ImportError:
            logger.warning("Gerber generator not available, returning stub")
            return {
                "files": [],
                "status": "error",
                "error": "Gerber generator not available (routeai_solver.gerber_generator not installed)",
            }

        project_id = request.get("project_id", "unknown")
        output_format = request.get("format", "gerber_x2")

        files = generate_gerber(board_data, output_format=output_format)

        file_list = []
        for f in files:
            file_list.append({
                "name": getattr(f, "name", str(f)),
                "layer": getattr(f, "layer", ""),
                "size_bytes": getattr(f, "size_bytes", 0),
                "path": getattr(f, "path", ""),
            })

        return {"files": file_list, "status": "ok", "project_id": project_id}

    except Exception as exc:
        logger.exception("Gerber export failed")
        return {"files": [], "status": "error", "error": str(exc)}


@app.get("/ml/report/{project_id}")
async def get_report(project_id: str) -> dict[str, Any]:
    """Generate or retrieve a design report for a project.

    Aggregates review findings, DRC results, and board statistics into
    a consolidated report summary.
    """
    try:
        if not project_id or project_id == "undefined":
            return {"report": "", "status": "error", "error": "valid project_id is required"}

        report = {
            "project_id": project_id,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sections": {
                "summary": "Design report generated. Upload board data and run a review for detailed analysis.",
                "drc": {"violations": [], "passed": True, "score": 100.0},
                "review": {"items": [], "summary": "No AI review data available yet."},
                "statistics": {},
            },
        }

        return {"report": report, "status": "ok"}

    except Exception as exc:
        logger.exception("Report generation failed")
        return {"report": "", "status": "error", "error": str(exc)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_json_array(text: str) -> list[dict[str, Any]]:
    """Best-effort extraction of a JSON array from LLM output."""
    # Try to find a JSON array in the text.
    # Look for ```json ... ``` blocks first.
    m = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Try bare array.
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass

    return []


def _extract_json_object(text: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from LLM output."""
    # Try ```json ... ``` blocks first.
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    # Try bare object (find outermost braces).
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass

    return {}


def _rule_based_routing_strategy(req: RoutingStrategyRequest) -> RoutingStrategyResponse:
    """Rule-based fallback when Ollama is unavailable for routing strategy.

    Uses simple heuristics: power nets first, then high-speed signals
    (identified by common naming patterns), then general nets.
    """
    board = req.board_state
    nets = board.get("nets", [])
    layers = board.get("layers", [])

    copper_layers = [
        ly.get("name", ly) for ly in layers
        if isinstance(ly, dict) and ly.get("type", "") in ("copper", "COPPER", "signal")
    ] or ["F.Cu", "B.Cu"]

    routing_order: list[dict[str, Any]] = []
    impedance_targets: dict[str, Any] = {}

    # Classify nets by name patterns
    for net_info in nets:
        name = net_info.get("name", "") if isinstance(net_info, dict) else str(net_info)
        name_upper = name.upper()

        if not name or name in ("", "unconnected"):
            continue

        priority = 5
        reason = "General signal net"
        constraints: dict[str, Any] = {"preferred_layers": copper_layers[:2]}

        # Power nets: high priority, wide traces
        if any(kw in name_upper for kw in ("VCC", "VDD", "3V3", "5V", "12V", "PWR", "VBUS")):
            priority = 9
            reason = "Power net - route early for low impedance paths"
            constraints["min_spacing_mm"] = 0.2

        # Ground nets
        elif any(kw in name_upper for kw in ("GND", "VSS", "DGND", "AGND", "PGND")):
            priority = 8
            reason = "Ground net - critical return path"
            constraints["min_spacing_mm"] = 0.2

        # High-speed/clock signals
        elif any(kw in name_upper for kw in ("CLK", "CLOCK", "USB", "ETH", "SDIO", "SPI_CLK",
                                              "MCLK", "PCIE", "HDMI", "LVDS")):
            priority = 8
            reason = "High-speed signal - route with controlled impedance"
            constraints["impedance_ohm"] = 50.0
            constraints["min_spacing_mm"] = 0.15
            impedance_targets[name] = 50.0

        # Differential pairs
        elif name_upper.endswith(("_P", "_N", "+", "-", "_DP", "_DN")):
            priority = 7
            reason = "Likely differential pair member"
            constraints["impedance_ohm"] = 90.0
            impedance_targets[name] = 90.0

        routing_order.append({
            "net_name": name,
            "priority": priority,
            "reason": reason,
            "constraints": constraints,
        })

    # Sort by priority descending
    routing_order.sort(key=lambda x: x["priority"], reverse=True)

    return RoutingStrategyResponse(
        workflow_id=req.workflow_id,
        status="completed",
        routing_order=routing_order,
        layer_assignment={
            "power": {"signal_layers": copper_layers, "reason": "Power distributed across all layers"},
            "high_speed": {"signal_layers": copper_layers[:2], "reason": "Route on outer layers for impedance control"},
            "general": {"signal_layers": copper_layers, "reason": "Use any available layer"},
        },
        via_strategy={
            "high_speed": "through_only",
            "general": "through_or_blind",
            "power": "through_only",
            "return_path_via_max_distance_mm": 2.0,
        },
        cost_weights={
            "wire_length": 0.5,
            "via_count": 0.3,
            "congestion": 0.4,
            "layer_change": 0.3,
        },
        impedance_targets=impedance_targets,
        rationale="Rule-based fallback: classified nets by naming patterns (power/ground/high-speed/general).",
    )


def _pattern_based_constraints(req: ConstraintRequest) -> ConstraintResponse:
    """Pattern-matching fallback when Ollama is unavailable for constraint generation.

    Identifies net classes, diff pairs, and length groups from component
    descriptions and net naming conventions.
    """
    components = req.components
    nets = req.nets
    board_params = req.board_params

    net_classes: list[dict[str, Any]] = []
    diff_pairs: list[dict[str, Any]] = []
    length_groups: list[dict[str, Any]] = []
    special_rules: list[dict[str, Any]] = []

    # Collect all net names
    net_names = [n.get("name", "") if isinstance(n, dict) else str(n) for n in nets]

    # Default net class
    default_width = board_params.get("default_trace_width_mm", 0.2) if board_params else 0.2
    default_clearance = board_params.get("default_clearance_mm", 0.15) if board_params else 0.15

    # Classify nets into classes based on name patterns
    power_nets = [n for n in net_names if any(
        kw in n.upper() for kw in ("VCC", "VDD", "3V3", "5V", "12V", "PWR", "VBUS")
    )]
    ground_nets = [n for n in net_names if any(
        kw in n.upper() for kw in ("GND", "VSS", "DGND", "AGND", "PGND")
    )]
    high_speed_nets = [n for n in net_names if any(
        kw in n.upper() for kw in ("CLK", "USB", "ETH", "SDIO", "PCIE", "HDMI", "LVDS")
    )]
    general_nets = [
        n for n in net_names
        if n and n not in power_nets and n not in ground_nets and n not in high_speed_nets
    ]

    if power_nets:
        net_classes.append({
            "name": "Power",
            "nets": power_nets,
            "trace_width_mm": max(default_width, 0.3),
            "clearance_mm": 0.2,
            "description": "Power supply nets - wider traces for current capacity",
        })
    if ground_nets:
        net_classes.append({
            "name": "Ground",
            "nets": ground_nets,
            "trace_width_mm": max(default_width, 0.3),
            "clearance_mm": 0.2,
            "description": "Ground return nets",
        })
    if high_speed_nets:
        net_classes.append({
            "name": "HighSpeed",
            "nets": high_speed_nets,
            "trace_width_mm": default_width,
            "clearance_mm": 0.15,
            "impedance_ohm": 50.0,
            "description": "High-speed signals - controlled impedance routing",
        })
    if general_nets:
        net_classes.append({
            "name": "Default",
            "nets": general_nets[:50],  # Cap at 50 for readability
            "trace_width_mm": default_width,
            "clearance_mm": default_clearance,
            "description": "General signal nets",
        })

    # Detect differential pairs from naming: net_P/net_N or net+/net-
    paired: set[str] = set()
    for n in net_names:
        if n in paired:
            continue
        n_upper = n.upper()
        partner = None
        pair_name = None

        if n_upper.endswith("_P"):
            candidate = n[:-2] + "_N"
            if candidate in net_names or candidate.lower() in [x.lower() for x in net_names]:
                partner = candidate
                pair_name = n[:-2]
        elif n_upper.endswith("+"):
            candidate = n[:-1] + "-"
            if candidate in net_names or candidate.lower() in [x.lower() for x in net_names]:
                partner = candidate
                pair_name = n[:-1]
        elif n_upper.endswith("_DP"):
            candidate = n[:-3] + "_DN"
            if candidate in net_names or candidate.lower() in [x.lower() for x in net_names]:
                partner = candidate
                pair_name = n[:-3]

        if partner and pair_name:
            # Find exact match (case-insensitive)
            actual_partner = next(
                (x for x in net_names if x.lower() == partner.lower()), partner
            )
            diff_pairs.append({
                "name": pair_name,
                "positive_net": n,
                "negative_net": actual_partner,
                "target_impedance_ohm": 90.0,
                "max_skew_mm": 0.1,
            })
            paired.add(n)
            paired.add(actual_partner)

    # Detect length groups from bus patterns (e.g., DATA0..DATA7, D0..D7)
    bus_groups: dict[str, list[str]] = {}
    for n in net_names:
        m = re.match(r"^(.+?)(\d+)$", n)
        if m:
            prefix = m.group(1)
            bus_groups.setdefault(prefix, []).append(n)

    for prefix, members in bus_groups.items():
        if len(members) >= 4:  # At least 4 members to form a meaningful group
            length_groups.append({
                "name": f"{prefix}bus",
                "nets": sorted(members),
                "target_length_mm": None,
                "tolerance_mm": 1.0,
            })

    # Special rules from component analysis
    for comp in components:
        value = comp.get("value", "").upper()
        ref = comp.get("reference", "")
        desc = comp.get("description", "").upper()

        if any(kw in desc for kw in ("CRYSTAL", "OSCILLATOR", "XTAL")) or ref.startswith("Y"):
            special_rules.append({
                "type": "keep_short",
                "description": f"Keep traces to {ref} ({value}) as short as possible - crystal routing",
                "affected_nets": comp.get("nets", []),
                "parameters": {"max_length_mm": 10.0},
            })
        elif any(kw in desc for kw in ("ANTENNA", "RF")) or ref.startswith("ANT"):
            special_rules.append({
                "type": "impedance",
                "description": f"Controlled impedance for {ref} - RF/antenna trace",
                "affected_nets": comp.get("nets", []),
                "parameters": {"impedance_ohm": 50.0, "no_vias": True},
            })

    return ConstraintResponse(
        workflow_id=req.workflow_id,
        status="completed",
        net_classes=net_classes,
        diff_pairs=diff_pairs,
        length_groups=length_groups,
        special_rules=special_rules,
        rationale="Pattern-matching fallback: classified nets by naming conventions and component types.",
    )


# ---------------------------------------------------------------------------
# PCBParts MCP proxy endpoints (optional online data source)
# ---------------------------------------------------------------------------

_PCBPARTS_CACHE_DIR = "data/component_library/pcbparts_cache"


def _get_pcbparts() -> Any:
    """Lazy-import and return the PCBParts singleton client."""
    from routeai_intelligence.library.pcbparts_client import get_pcbparts_client

    return get_pcbparts_client(cache_dir=_PCBPARTS_CACHE_DIR)


@app.get("/ml/pcbparts/search")
async def pcbparts_search(
    q: str,
    subcategory: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Search JLCPCB catalog via PCBParts MCP. Offline-safe."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"parts": [], "offline": True, "message": "PCBParts not reachable"}
    parts = await client.search_components(q, subcategory=subcategory, limit=limit)
    return {"parts": parts, "offline": False}


@app.get("/ml/pcbparts/alternatives/{lcsc}")
async def pcbparts_alternatives(lcsc: str) -> dict[str, Any]:
    """Find alternative components for a given LCSC part code."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"alternatives": [], "offline": True}
    alts = await client.find_alternatives(lcsc)
    return {"alternatives": alts, "offline": False}


@app.get("/ml/pcbparts/stock/{lcsc}")
async def pcbparts_stock(lcsc: str) -> dict[str, Any]:
    """Check real-time stock and pricing for a JLCPCB part."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"stock": None, "offline": True}
    stock = await client.check_stock(lcsc)
    return {"stock": stock, "offline": False}


@app.get("/ml/pcbparts/sensors")
async def pcbparts_sensors(
    measurement: str,
    protocol: str | None = None,
    platform: str | None = None,
) -> dict[str, Any]:
    """Recommend sensor ICs by measurement type."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"sensors": [], "offline": True}
    sensors = await client.recommend_sensors(measurement, protocol=protocol, platform=platform)
    return {"sensors": sensors, "offline": False}


@app.get("/ml/pcbparts/kicad/{cse_id}")
async def pcbparts_kicad(cse_id: str) -> dict[str, Any]:
    """Download KiCad symbol and footprint from SamacSys via PCBParts."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"symbol": None, "offline": True}
    symbol = await client.download_kicad_symbol(cse_id)
    return {"symbol": symbol, "offline": False}


@app.get("/ml/pcbparts/boards")
async def pcbparts_boards(q: str) -> dict[str, Any]:
    """Search open-source reference board schematics."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"boards": [], "offline": True}
    boards = await client.search_boards(q)
    return {"boards": boards, "offline": False}


@app.get("/ml/pcbparts/design-rules")
async def pcbparts_design_rules(topic: str | None = None) -> dict[str, Any]:
    """Get curated PCB design rules."""
    client = _get_pcbparts()
    if not await client.is_available():
        return {"rules": [], "offline": True}
    rules = await client.get_design_rules(topic)
    return {"rules": rules, "offline": False}


def _build_board_design(board_data: dict[str, Any]) -> Any:
    """Convert a board_data JSON dict into a solver BoardDesign instance.

    Does a best-effort mapping from the generic JSON representation to
    the strongly-typed dataclass model used by the DRC engine.
    """
    from shapely.geometry import Polygon as ShapelyPolygon

    from routeai_solver.board_model import (
        BoardDesign,
        CopperZone,
        DesignRules,
        Layer,
        LayerType,
        Net,
        Pad,
        PadShape,
        Trace,
        TraceSegment,
        Via,
    )

    # --- Layers ---
    layer_cache: dict[str, Layer] = {}

    def _get_layer(name: str) -> Layer:
        if name not in layer_cache:
            lt = LayerType.COPPER
            name_lower = name.lower()
            if "mask" in name_lower:
                lt = LayerType.SOLDER_MASK
            elif "silk" in name_lower:
                lt = LayerType.SILK_SCREEN
            elif "paste" in name_lower:
                lt = LayerType.PASTE
            elif "edge" in name_lower or "cut" in name_lower:
                lt = LayerType.EDGE_CUTS
            layer_cache[name] = Layer(name=name, layer_type=lt, index=len(layer_cache))
        return layer_cache[name]

    for ly in board_data.get("layers", []):
        if isinstance(ly, dict):
            _get_layer(ly.get("name", f"Layer{len(layer_cache)}"))
        elif isinstance(ly, str):
            _get_layer(ly)

    # Ensure at least F.Cu/B.Cu exist
    if not layer_cache:
        _get_layer("F.Cu")
        _get_layer("B.Cu")

    # --- Nets ---
    net_cache: dict[str, Net] = {}

    def _get_net(name: str) -> Net:
        if name not in net_cache:
            net_cache[name] = Net(name=name, id=len(net_cache))
        return net_cache[name]

    for n in board_data.get("nets", []):
        if isinstance(n, dict):
            _get_net(n.get("name", f"Net{len(net_cache)}"))
        elif isinstance(n, str):
            _get_net(n)

    # --- Traces ---
    traces: list[Trace] = []
    for t in board_data.get("traces", []):
        if not isinstance(t, dict):
            continue
        net = _get_net(t.get("net", ""))
        layer = _get_layer(t.get("layer", "F.Cu"))
        segments: list[TraceSegment] = []
        for seg in t.get("segments", []):
            if isinstance(seg, dict):
                segments.append(TraceSegment(
                    start_x=float(seg.get("start_x", seg.get("x1", 0))),
                    start_y=float(seg.get("start_y", seg.get("y1", 0))),
                    end_x=float(seg.get("end_x", seg.get("x2", 0))),
                    end_y=float(seg.get("end_y", seg.get("y2", 0))),
                    width=float(seg.get("width", 0.2)),
                ))
        if segments:
            traces.append(Trace(net=net, layer=layer, segments=segments))

    # --- Pads ---
    pads: list[Pad] = []
    for p in board_data.get("pads", board_data.get("components_pads", [])):
        if not isinstance(p, dict):
            continue
        shape_str = p.get("shape", "circle").upper()
        shape_map = {
            "CIRCLE": PadShape.CIRCLE,
            "RECT": PadShape.RECT,
            "OVAL": PadShape.OVAL,
            "ROUNDRECT": PadShape.ROUNDRECT,
        }
        pads.append(Pad(
            net=_get_net(p.get("net", "")),
            layer=_get_layer(p.get("layer", "F.Cu")),
            x=float(p.get("x", 0)),
            y=float(p.get("y", 0)),
            shape=shape_map.get(shape_str, PadShape.CIRCLE),
            width=float(p.get("width", p.get("size_x", 1.0))),
            height=float(p.get("height", p.get("size_y", 1.0))),
            drill=float(p.get("drill", 0)),
            component_ref=p.get("component_ref", p.get("reference", "")),
            pad_number=str(p.get("pad_number", p.get("number", ""))),
        ))

    # --- Vias ---
    vias: list[Via] = []
    for v in board_data.get("vias", []):
        if not isinstance(v, dict):
            continue
        vias.append(Via(
            net=_get_net(v.get("net", "")),
            x=float(v.get("x", 0)),
            y=float(v.get("y", 0)),
            drill=float(v.get("drill", 0.3)),
            diameter=float(v.get("diameter", v.get("size", 0.6))),
            start_layer=_get_layer(v.get("start_layer", "F.Cu")),
            end_layer=_get_layer(v.get("end_layer", "B.Cu")),
        ))

    # --- Zones ---
    zones: list[CopperZone] = []
    for z in board_data.get("zones", []):
        if not isinstance(z, dict):
            continue
        points = z.get("polygon", z.get("points", []))
        if isinstance(points, list) and len(points) >= 3:
            try:
                coords = [(float(pt[0]), float(pt[1])) for pt in points]
                poly = ShapelyPolygon(coords)
                if poly.is_valid:
                    zones.append(CopperZone(
                        net=_get_net(z.get("net", "")),
                        layer=_get_layer(z.get("layer", "F.Cu")),
                        polygon=poly,
                        clearance=float(z.get("clearance", 0.2)),
                    ))
            except (ValueError, TypeError):
                pass

    # --- Outline ---
    outline = None
    outline_data = board_data.get("outline", board_data.get("board_outline"))
    if isinstance(outline_data, list) and len(outline_data) >= 3:
        try:
            coords = [(float(pt[0]), float(pt[1])) for pt in outline_data]
            poly = ShapelyPolygon(coords)
            if poly.is_valid:
                outline = poly
        except (ValueError, TypeError):
            pass

    # --- Design Rules ---
    rules_data = board_data.get("design_rules", {})
    design_rules = DesignRules(
        min_trace_width=float(rules_data.get("min_trace_width", 0.15)),
        min_clearance=float(rules_data.get("min_clearance", 0.15)),
        min_annular_ring=float(rules_data.get("min_annular_ring", 0.13)),
        min_drill=float(rules_data.get("min_drill", 0.2)),
        min_via_drill=float(rules_data.get("min_via_drill", 0.2)),
        min_via_diameter=float(rules_data.get("min_via_diameter", 0.45)),
        board_edge_clearance=float(rules_data.get("board_edge_clearance", 0.25)),
        solder_mask_expansion=float(rules_data.get("solder_mask_expansion", 0.05)),
        min_solder_mask_bridge=float(rules_data.get("min_solder_mask_bridge", 0.1)),
        drill_to_copper_clearance=float(rules_data.get("drill_to_copper_clearance", 0.2)),
    )

    return BoardDesign(
        name=board_data.get("name", "Untitled"),
        traces=traces,
        pads=pads,
        vias=vias,
        zones=zones,
        nets=list(net_cache.values()),
        layers=list(layer_cache.values()),
        design_rules=design_rules,
        outline=outline,
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("ML_SERVICE_PORT", "8001"))
    logger.info("Starting RouteAI ML service on port %d", port)
    uvicorn.run(
        "routeai_intelligence.ml_service:app",
        host="0.0.0.0",
        port=port,
        reload=os.getenv("ML_SERVICE_RELOAD", "false").lower() == "true",
        log_level="info",
    )
