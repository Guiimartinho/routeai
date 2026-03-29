"""File upload and project management endpoints."""

from __future__ import annotations

import io
import logging
import os
import shutil
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from routeai_cli.api.llm import detect_llm_provider
from routeai_cli.api.models import (
    PROJECTS,
    Project,
    board_to_viewer_json,
    drc_to_dict,
    get_project_or_404,
    parse_project_files,
)

logger = logging.getLogger("routeai.server")

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# API key management
# ---------------------------------------------------------------------------

@router.post("/set-key")
async def set_api_key(request: Request) -> dict[str, Any]:
    """Set API keys at runtime from the browser."""
    body = await request.json()
    gemini_key = body.get("gemini_key", "").strip()
    anthropic_key = body.get("anthropic_key", "").strip()
    old_key = body.get("key", "").strip()

    if gemini_key:
        os.environ["GEMINI_API_KEY"] = gemini_key
        logger.info("Gemini API key set (%d chars)", len(gemini_key))
    if anthropic_key:
        os.environ["ANTHROPIC_API_KEY"] = anthropic_key
        logger.info("Anthropic API key set (%d chars)", len(anthropic_key))
    if old_key and not gemini_key and not anthropic_key:
        if old_key.startswith("sk-ant"):
            os.environ["ANTHROPIC_API_KEY"] = old_key
        else:
            os.environ["GEMINI_API_KEY"] = old_key

    provider = detect_llm_provider()
    if not provider:
        raise HTTPException(400, "No valid key provided")
    return {"status": "ok", "ai_enabled": True, "provider": provider}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_project(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload a KiCad zip or individual .kicad_pcb/.kicad_sch file."""
    project_id = str(uuid.uuid4())[:8]
    upload_dir = Path(tempfile.mkdtemp(prefix=f"routeai_{project_id}_"))

    content = await file.read()
    filename = file.filename or "unknown"

    if filename.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for member in zf.namelist():
                if member.endswith((".kicad_pcb", ".kicad_sch")):
                    basename = Path(member).name
                    target = upload_dir / basename
                    with zf.open(member) as src, open(target, "wb") as dst:
                        dst.write(src.read())
    elif filename.endswith((".kicad_pcb", ".kicad_sch")):
        target = upload_dir / filename
        target.write_bytes(content)
    else:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(400, "Unsupported file type. Upload .kicad_pcb, .kicad_sch, or .zip")

    project = Project(
        id=project_id,
        name=Path(filename).stem,
        upload_dir=upload_dir,
        created_at=time.time(),
    )

    try:
        parse_project_files(project)
    except Exception as exc:
        logger.error("Parse error: %s", exc)
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(422, f"Failed to parse file: {exc}")

    if not project.parsed_board and not project.parsed_schematic:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(422, "No valid KiCad files found in upload")

    PROJECTS[project_id] = project

    return {
        "id": project_id,
        "name": project.name,
        "board_summary": project.board_summary,
        "schematic_summary": project.schematic_summary,
        "has_board": project.parsed_board is not None,
        "has_schematic": project.parsed_schematic is not None,
    }


# ---------------------------------------------------------------------------
# Project listing / details / board data / report
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_projects() -> list[dict[str, Any]]:
    """List all uploaded projects."""
    return [
        {
            "id": p.id, "name": p.name,
            "has_board": p.parsed_board is not None,
            "has_schematic": p.parsed_schematic is not None,
            "has_drc": p.drc_result is not None,
            "created_at": p.created_at,
        }
        for p in PROJECTS.values()
    ]


@router.get("/projects/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    """Get project info."""
    p = get_project_or_404(project_id)
    return {
        "id": p.id, "name": p.name,
        "board_summary": p.board_summary,
        "schematic_summary": p.schematic_summary,
        "has_board": p.parsed_board is not None,
        "has_schematic": p.parsed_schematic is not None,
        "has_drc": p.drc_result is not None,
        "has_ai_review": p.ai_review is not None,
        "ai_enabled": detect_llm_provider() is not None,
        "ai_provider": detect_llm_provider(),
    }


@router.get("/projects/{project_id}/board")
async def get_board_data(project_id: str) -> dict[str, Any]:
    """Get board data for the 2D viewer."""
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(400, "No board data available")
    return board_to_viewer_json(p.parsed_board)


@router.get("/projects/{project_id}/report")
async def get_report(project_id: str) -> dict[str, Any]:
    """Get the full analysis report."""
    p = get_project_or_404(project_id)
    report: dict[str, Any] = {
        "project": {"id": p.id, "name": p.name},
        "board_summary": p.board_summary,
        "schematic_summary": p.schematic_summary,
        "drc": drc_to_dict(p.drc_result) if p.drc_result else {"status": "not_run"},
    }
    if p.ai_review:
        report["ai_review"] = p.ai_review
    return report
