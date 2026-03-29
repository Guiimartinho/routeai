"""Pydantic request/response models and shared state for the RouteAI API."""

from __future__ import annotations

import math
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# In-memory project store
# ---------------------------------------------------------------------------

@dataclass
class Project:
    """In-memory project record."""

    id: str
    name: str
    upload_dir: Path
    parsed_board: Any = None
    parsed_schematic: Any = None
    board_summary: dict[str, Any] = field(default_factory=dict)
    schematic_summary: dict[str, Any] = field(default_factory=dict)
    drc_result: Any = None  # AnalysisResult
    ai_review: Any = None
    chat_history: list[dict[str, str]] = field(default_factory=list)
    created_at: float = 0.0


PROJECTS: dict[str, Project] = {}


# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------

class SetKeyRequest(BaseModel):
    gemini_key: str = ""
    anthropic_key: str = ""
    key: str = ""  # legacy single-key field


class SetKeyResponse(BaseModel):
    status: str = "ok"
    ai_enabled: bool = True
    provider: str | None = None


class ProjectUploadResponse(BaseModel):
    id: str
    name: str
    board_summary: dict[str, Any] = Field(default_factory=dict)
    schematic_summary: dict[str, Any] = Field(default_factory=dict)
    has_board: bool = False
    has_schematic: bool = False


class ProjectListItem(BaseModel):
    id: str
    name: str
    has_board: bool = False
    has_schematic: bool = False
    has_drc: bool = False
    created_at: float = 0.0


class ProjectDetail(BaseModel):
    id: str
    name: str
    board_summary: dict[str, Any] = Field(default_factory=dict)
    schematic_summary: dict[str, Any] = Field(default_factory=dict)
    has_board: bool = False
    has_schematic: bool = False
    has_drc: bool = False
    has_ai_review: bool = False
    ai_enabled: bool = False
    ai_provider: str | None = None


class ChatRequest(BaseModel):
    message: str


class ImpedanceRequest(BaseModel):
    w: float = 0.15
    h: float = 0.2
    er: float = 4.2
    t: float = 0.035
    type: str = "microstrip"
    spacing: float | None = None


class CurrentCapacityRequest(BaseModel):
    width: float = 0.25
    thickness: float = 1.0
    temp_rise: float = 10.0


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def get_project_or_404(project_id: str) -> Project:
    """Look up a project by ID; raise HTTPException 404 if missing."""
    from fastapi import HTTPException

    p = PROJECTS.get(project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def board_to_viewer_json(board: Any) -> dict[str, Any]:
    """Convert a parsed BoardDesign to JSON suitable for the Canvas PCB viewer."""
    if board is None:
        return {
            "traces": [], "pads": [], "vias": [], "outline": [],
            "zones": [], "components": [],
        }

    net_names: dict[int, str] = {}
    for n in board.nets:
        net_names[n.number] = n.name

    traces = []
    for seg in board.segments:
        traces.append({
            "x1": seg.start.x, "y1": seg.start.y,
            "x2": seg.end.x, "y2": seg.end.y,
            "width": seg.width,
            "layer": seg.layer,
            "net": net_names.get(seg.net, ""),
        })

    pads = []
    components = []
    for fp in board.footprints:
        components.append({
            "ref": fp.reference,
            "value": fp.value,
            "x": fp.at.x,
            "y": fp.at.y,
            "rotation": fp.angle,
            "layer": fp.layer,
        })
        for pad in fp.pads:
            fx, fy = fp.at.x, fp.at.y
            px, py = pad.at.x, pad.at.y
            fp_angle_rad = math.radians(fp.angle)
            if fp.angle != 0.0:
                cos_a = math.cos(fp_angle_rad)
                sin_a = math.sin(fp_angle_rad)
                abs_x = fx + px * cos_a - py * sin_a
                abs_y = fy + px * sin_a + py * cos_a
            else:
                abs_x = fx + px
                abs_y = fy + py

            primary_layer = pad.layers[0] if pad.layers else fp.layer
            pads.append({
                "x": abs_x, "y": abs_y,
                "width": pad.size_x, "height": pad.size_y,
                "shape": pad.shape.value,
                "layer": primary_layer,
                "net": net_names.get(pad.net_number, ""),
                "ref": fp.reference,
                "number": pad.number,
                "drill": pad.drill,
            })

    vias = []
    for v in board.vias:
        vias.append({
            "x": v.at.x, "y": v.at.y,
            "drill": v.drill,
            "size": v.size,
            "net": net_names.get(v.net, ""),
        })

    outline = []
    for gl in board.gr_lines:
        if gl.layer == "Edge.Cuts":
            outline.append({
                "x1": gl.start.x, "y1": gl.start.y,
                "x2": gl.end.x, "y2": gl.end.y,
            })
    for gr in board.gr_rects:
        if gr.layer == "Edge.Cuts":
            x1, y1 = gr.start.x, gr.start.y
            x2, y2 = gr.end.x, gr.end.y
            outline.extend([
                {"x1": x1, "y1": y1, "x2": x2, "y2": y1},
                {"x1": x2, "y1": y1, "x2": x2, "y2": y2},
                {"x1": x2, "y1": y2, "x2": x1, "y2": y2},
                {"x1": x1, "y1": y2, "x2": x1, "y2": y1},
            ])

    zones = []
    for z in board.zones:
        for poly in z.polygons:
            pts = [{"x": p.x, "y": p.y} for p in poly.points]
            if pts:
                zones.append({
                    "points": pts,
                    "layer": z.layer,
                    "net": net_names.get(z.net, ""),
                })

    return {
        "traces": traces, "pads": pads, "vias": vias,
        "outline": outline, "zones": zones, "components": components,
    }


def drc_to_dict(result: Any) -> dict[str, Any]:
    """Convert an AnalysisResult to a JSON-serializable dict."""
    if result is None:
        return {"status": "not_run"}

    violations = []
    for v in (result.filtered_violations or []):
        violations.append({
            "rule": v.rule,
            "severity": v.severity.value,
            "message": v.message,
            "location": list(v.location) if v.location else None,
            "affected_items": v.affected_items,
        })

    return {
        "status": "complete",
        "design_score": result.design_score,
        "boards_parsed": result.boards_parsed,
        "schematics_parsed": result.schematics_parsed,
        "violation_count": len(violations),
        "error_count": result.drc_report.error_count if result.drc_report else 0,
        "warning_count": result.drc_report.warning_count if result.drc_report else 0,
        "info_count": result.drc_report.info_count if result.drc_report else 0,
        "violations": violations,
        "impedance_warnings": result.impedance_warnings,
        "thermal_warnings": result.thermal_warnings,
        "manufacturing_warnings": result.manufacturing_warnings,
        "elapsed_seconds": round(result.elapsed_seconds, 3),
        "board_summary": result.board_summary,
        "schematic_summary": result.schematic_summary,
    }


def parse_project_files(project: Project) -> None:
    """Parse KiCad files in the project upload directory."""
    from routeai_parsers import KiCadPcbParser, KiCadSchParser

    pcb_parser = KiCadPcbParser()
    sch_parser = KiCadSchParser()

    for f in sorted(project.upload_dir.glob("*.kicad_pcb")):
        project.parsed_board = pcb_parser.parse(f)
        break

    for f in sorted(project.upload_dir.glob("*.kicad_sch")):
        project.parsed_schematic = sch_parser.parse(f)
        break

    if project.parsed_board:
        b = project.parsed_board
        copper_layers = [l for l in b.layers if l.layer_type in ("signal", "power")]
        project.board_summary = {
            "generator": b.generator,
            "version": b.version,
            "thickness_mm": b.thickness,
            "layer_count": len(b.layers),
            "copper_layer_count": len(copper_layers),
            "net_count": len(b.nets),
            "footprint_count": len(b.footprints),
            "segment_count": len(b.segments),
            "via_count": len(b.vias),
            "zone_count": len(b.zones),
        }

    if project.parsed_schematic:
        s = project.parsed_schematic
        project.schematic_summary = {
            "title": s.title,
            "revision": s.revision,
            "symbol_count": len(s.symbols),
            "net_count": len(s.nets),
            "wire_count": len(s.wires),
            "label_count": len(s.labels),
        }


def get_board_context(p: Project) -> dict[str, Any]:
    """Build a context dict summarizing the project for the AI."""
    ctx: dict[str, Any] = {"board_summary": p.board_summary}

    if p.parsed_board:
        net_names = {n.number: n.name for n in p.parsed_board.nets}
        named_nets = [n.name for n in p.parsed_board.nets if n.name and n.name.strip()]
        ctx["nets"] = named_nets[:60]

        comps = []
        for fp in p.parsed_board.footprints[:60]:
            comps.append({"ref": fp.reference, "value": fp.value, "layer": fp.layer})
        ctx["components"] = comps

        if hasattr(p.parsed_board, "stackup") and p.parsed_board.stackup:
            ctx["stackup"] = [
                {
                    "name": sl.name, "type": sl.layer_type,
                    "thickness": sl.thickness, "er": sl.epsilon_r, "material": sl.material,
                }
                for sl in p.parsed_board.stackup.layers[:20]
            ]

        widths: Counter = Counter()
        for seg in p.parsed_board.segments:
            widths[round(seg.width, 3)] += 1
        ctx["trace_widths_mm"] = dict(widths.most_common(10))

    if p.schematic_summary:
        ctx["schematic_summary"] = p.schematic_summary

    if p.drc_result:
        drc = p.drc_result
        violations_by_rule: Counter = Counter()
        for v in (drc.filtered_violations or []):
            violations_by_rule[v.rule] += 1
        ctx["drc"] = {
            "design_score": drc.design_score,
            "error_count": drc.drc_report.error_count if drc.drc_report else 0,
            "warning_count": drc.drc_report.warning_count if drc.drc_report else 0,
            "violations_by_rule": dict(violations_by_rule.most_common(15)),
            "sample_violations": [
                {"rule": v.rule, "severity": v.severity.value, "message": v.message[:150]}
                for v in (drc.filtered_violations or [])[:10]
            ],
        }

    return ctx
