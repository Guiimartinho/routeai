"""DRC analysis and tool endpoints (impedance, current capacity)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from routeai_cli.api.llm import (
    _tool_calculate_current_capacity,
    _tool_calculate_impedance,
)
from routeai_cli.api.models import drc_to_dict, get_project_or_404

logger = logging.getLogger("routeai.server")

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# DRC analysis
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/analyze")
async def analyze_project_endpoint(project_id: str) -> dict[str, Any]:
    """Run DRC analysis on the project."""
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(400, "No board file to analyze")

    from routeai_cli.analyzer import AnalysisOptions
    from routeai_cli.analyzer import analyze_project as run_analysis

    try:
        options = AnalysisOptions(
            project_dir=p.upload_dir, use_ai=False, min_severity="info",
        )
        result = run_analysis(options)
        p.drc_result = result
        return drc_to_dict(result)
    except Exception as exc:
        logger.error("Analysis error: %s", exc)
        raise HTTPException(500, f"Analysis failed: {exc}")


# ---------------------------------------------------------------------------
# Standalone tool endpoints
# ---------------------------------------------------------------------------

@router.post("/tools/impedance")
async def calc_impedance(request: Request) -> dict[str, Any]:
    """Calculate transmission line impedance."""
    body = await request.json()
    result = _tool_calculate_impedance(
        width_mm=float(body.get("w", 0.15)),
        height_mm=float(body.get("h", 0.2)),
        er=float(body.get("er", 4.2)),
        thickness_mm=float(body.get("t", 0.035)),
        topology=body.get("type", "microstrip"),
        spacing_mm=float(body["spacing"]) if body.get("spacing") else None,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/tools/current")
async def calc_current(request: Request) -> dict[str, Any]:
    """Calculate current capacity per IPC-2152."""
    body = await request.json()
    result = _tool_calculate_current_capacity(
        width_mm=float(body.get("width", 0.25)),
        copper_oz=float(body.get("thickness", 1.0)),
        temp_rise_c=float(body.get("temp_rise", 10.0)),
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    # Add legacy field names for UI compatibility
    result["thickness_oz"] = result["copper_oz"]
    result["area_mil2"] = round(
        (result["width_mm"] * result["copper_oz"] * 0.035) / (0.0254 ** 2), 2,
    )
    return result
