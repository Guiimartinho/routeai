"""Tests for the workflow API endpoints.

Tests all endpoints in routeai_cli.api.workflow with mocked project data,
including AI placement, AI review, AI routing, cross-probe, export, and status.
"""

from __future__ import annotations

import io
import json
import textwrap
import time
import zipfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from routeai_cli.api.models import PROJECTS, Project


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_projects():
    """Clear the global project store before/after each test."""
    PROJECTS.clear()
    yield
    PROJECTS.clear()


@pytest.fixture()
def sample_pcb_text() -> str:
    """Minimal valid .kicad_pcb content."""
    return textwrap.dedent("""\
        (kicad_pcb (version 20240108) (generator "pcbnew")
          (general (thickness 1.6))
          (layers
            (0 "F.Cu" signal)
            (31 "B.Cu" signal)
            (36 "B.SilkS" user)
            (37 "F.SilkS" user)
            (44 "Edge.Cuts" user)
          )
          (net 0 "")
          (net 1 "GND")
          (net 2 "VCC")
          (net 3 "SDA")
          (footprint "Resistor_SMD:R_0402"
            (at 100 50)
            (layer "F.Cu")
            (property "Reference" "R1")
            (property "Value" "10k")
            (pad "1" smd rect (at -0.5 0) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 1 "GND"))
            (pad "2" smd rect (at 0.5 0) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 2 "VCC"))
          )
          (footprint "Package_SO:SOIC-8"
            (at 110 50)
            (layer "F.Cu")
            (property "Reference" "U1")
            (property "Value" "LM358")
            (pad "1" smd rect (at -2 -1.5) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 2 "VCC"))
            (pad "2" smd rect (at -2 0) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 3 "SDA"))
            (pad "3" smd rect (at -2 1.5) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 1 "GND"))
            (pad "4" smd rect (at 2 1.5) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask")
              (net 1 "GND"))
          )
          (segment (start 99.5 50) (end 95 50) (width 0.25) (layer "F.Cu") (net 1))
          (segment (start 100.5 50) (end 105 50) (width 0.25) (layer "F.Cu") (net 2))
          (via (at 95 50) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
          (gr_line (start 80 30) (end 120 30) (layer "Edge.Cuts") (width 0.05))
          (gr_line (start 120 30) (end 120 70) (layer "Edge.Cuts") (width 0.05))
          (gr_line (start 120 70) (end 80 70) (layer "Edge.Cuts") (width 0.05))
          (gr_line (start 80 70) (end 80 30) (layer "Edge.Cuts") (width 0.05))
        )
    """)


@pytest.fixture()
def sample_sch_text() -> str:
    """Minimal valid .kicad_sch content."""
    return textwrap.dedent("""\
        (kicad_sch (version 20231120) (generator "eeschema")
          (uuid "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
          (title_block
            (title "Test Schematic")
            (date "2024-01-01")
            (rev "1.0")
          )
          (lib_symbols
            (symbol "Device:R"
              (symbol "Device:R_0_1"
                (pin passive line (at 0 1.27 270) (length 1.27)
                  (name "~" ) (number "1" ))
                (pin passive line (at 0 -1.27 90) (length 1.27)
                  (name "~" ) (number "2" ))
              )
            )
          )
          (symbol (lib_id "Device:R")
            (at 100 50)
            (uuid "11111111-2222-3333-4444-555555555555")
            (property "Reference" "R1")
            (property "Value" "10k")
            (pin "1" (uuid "pin-1-uuid"))
            (pin "2" (uuid "pin-2-uuid"))
          )
          (wire (pts (xy 100 48.73) (xy 100 45))
            (uuid "wire-1"))
          (label "VCC" (at 100 45)
            (uuid "label-1"))
        )
    """)


@pytest.fixture()
def parsed_project(tmp_path: Path, sample_pcb_text: str, sample_sch_text: str) -> Project:
    """Create a project with parsed board and schematic data."""
    pcb_file = tmp_path / "test_board.kicad_pcb"
    pcb_file.write_text(sample_pcb_text, encoding="utf-8")

    sch_file = tmp_path / "test_board.kicad_sch"
    sch_file.write_text(sample_sch_text, encoding="utf-8")

    from routeai_cli.api.models import parse_project_files

    project = Project(
        id="test123",
        name="test_board",
        upload_dir=tmp_path,
        created_at=time.time(),
    )
    parse_project_files(project)
    PROJECTS["test123"] = project
    return project


@pytest.fixture()
def board_only_project(tmp_path: Path, sample_pcb_text: str) -> Project:
    """Create a project with only board data (no schematic)."""
    pcb_file = tmp_path / "board_only.kicad_pcb"
    pcb_file.write_text(sample_pcb_text, encoding="utf-8")

    from routeai_cli.api.models import parse_project_files

    project = Project(
        id="board01",
        name="board_only",
        upload_dir=tmp_path,
        created_at=time.time(),
    )
    parse_project_files(project)
    PROJECTS["board01"] = project
    return project


@pytest.fixture()
def client() -> TestClient:
    """Create a FastAPI test client with the workflow router mounted."""
    from fastapi import FastAPI
    from routeai_cli.api.workflow import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Workflow status tests
# ---------------------------------------------------------------------------


class TestWorkflowStatus:
    """Tests for GET /api/workflow/{project_id}/status."""

    def test_status_with_board_and_schematic(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get("/api/workflow/test123/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_board"] is True
        assert data["has_schematic"] is True
        assert data["has_review"] is False
        assert data["component_count"] == 2  # R1 + U1
        assert data["net_count"] == 4  # "", GND, VCC, SDA
        assert data["drc_violations"] == 0
        assert len(data["stages"]) >= 4
        assert data["stages"][0]["name"] == "upload"
        assert data["stages"][0]["status"] == "complete"
        assert data["ai_suggestion"] is not None

    def test_status_project_not_found(self, client: TestClient) -> None:
        resp = client.get("/api/workflow/nonexistent/status")
        assert resp.status_code == 404

    def test_status_with_drc_result(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        # Simulate a DRC result
        mock_drc = MagicMock()
        mock_drc.filtered_violations = [MagicMock(), MagicMock()]
        mock_drc.design_score = 85.0
        mock_drc.drc_report = MagicMock(error_count=1, warning_count=1, info_count=0)
        parsed_project.drc_result = mock_drc

        resp = client.get("/api/workflow/test123/status")
        data = resp.json()
        assert data["drc_violations"] == 2
        assert data["stages"][1]["status"] == "complete"

    def test_status_with_review(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        parsed_project.ai_review = {"findings": [{"msg": "test"}]}
        resp = client.get("/api/workflow/test123/status")
        data = resp.json()
        assert data["has_review"] is True
        assert data["stages"][2]["status"] == "complete"


# ---------------------------------------------------------------------------
# Cross-probe tests
# ---------------------------------------------------------------------------


class TestCrossProbe:
    """Tests for GET /api/workflow/{project_id}/cross-probe."""

    def test_cross_probe_component_on_board(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get(
            "/api/workflow/test123/cross-probe",
            params={"source": "board", "element_type": "component", "element_id": "R1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["board_location"] is not None
        assert data["board_location"]["x"] == 100.0
        assert data["board_location"]["y"] == 50.0
        assert len(data["highlight_nets"]) > 0

    def test_cross_probe_component_on_schematic(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get(
            "/api/workflow/test123/cross-probe",
            params={"source": "schematic", "element_type": "component", "element_id": "R1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["schematic_location"] is not None
        assert data["board_location"] is not None  # Both should be populated

    def test_cross_probe_net(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get(
            "/api/workflow/test123/cross-probe",
            params={"source": "board", "element_type": "net", "element_id": "GND"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert "GND" in data["highlight_nets"]
        assert len(data["related_elements"]) > 0

    def test_cross_probe_pin(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get(
            "/api/workflow/test123/cross-probe",
            params={"source": "board", "element_type": "pin", "element_id": "R1.1"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is True
        assert data["board_location"] is not None

    def test_cross_probe_not_found(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get(
            "/api/workflow/test123/cross-probe",
            params={"source": "board", "element_type": "component", "element_id": "NONEXIST"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["found"] is False

    def test_cross_probe_missing_params(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.get("/api/workflow/test123/cross-probe")
        assert resp.status_code == 422  # Missing required query params

    def test_cross_probe_no_data(self, client: TestClient) -> None:
        empty = Project(id="empty01", name="empty", upload_dir=Path("/tmp"))
        PROJECTS["empty01"] = empty
        resp = client.get(
            "/api/workflow/empty01/cross-probe",
            params={"source": "board", "element_type": "component", "element_id": "R1"},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Export tests
# ---------------------------------------------------------------------------


class TestExport:
    """Tests for POST /api/workflow/{project_id}/export/{format}."""

    def test_export_kicad(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.post("/api/workflow/test123/export/kicad")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        assert "kicad.zip" in resp.headers["content-disposition"]

        # Verify the zip contains expected files
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        assert any(n.endswith(".kicad_pcb") for n in names)
        assert any(n.endswith(".kicad_sch") for n in names)

    def test_export_eagle(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.post("/api/workflow/test123/export/eagle")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"

        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        assert any(n.endswith(".brd") for n in names)
        assert any(n.endswith(".sch") for n in names)

    def test_export_bom(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.post("/api/workflow/test123/export/bom")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        content = resp.content.decode("utf-8")
        assert "R1" in content or "Ref" in content

    def test_export_unsupported_format(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        resp = client.post("/api/workflow/test123/export/xyz")
        assert resp.status_code == 400
        assert "Unsupported" in resp.json()["detail"]

    def test_export_project_not_found(self, client: TestClient) -> None:
        resp = client.post("/api/workflow/nonexistent/export/kicad")
        assert resp.status_code == 404

    def test_export_no_board_for_gerber(self, client: TestClient) -> None:
        empty = Project(id="noboard", name="empty", upload_dir=Path("/tmp"))
        PROJECTS["noboard"] = empty
        resp = client.post("/api/workflow/noboard/export/gerber")
        assert resp.status_code == 400

    def test_export_kicad_board_only(
        self, client: TestClient, board_only_project: Project
    ) -> None:
        resp = client.post("/api/workflow/board01/export/kicad")
        assert resp.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        assert any(n.endswith(".kicad_pcb") for n in names)
        # No schematic expected
        assert not any(n.endswith(".kicad_sch") for n in names)


# ---------------------------------------------------------------------------
# AI Placement tests (mocked LLM)
# ---------------------------------------------------------------------------


class TestAIPlacement:
    """Tests for POST /api/workflow/{project_id}/ai-placement."""

    def test_placement_no_llm_key(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        with patch("routeai_cli.api.workflow.detect_llm_provider", return_value=None):
            resp = client.post(
                "/api/workflow/test123/ai-placement",
                json={"board_width_mm": 50, "board_height_mm": 50},
            )
            assert resp.status_code == 400
            assert "No LLM" in resp.json()["detail"]

    def test_placement_no_data(self, client: TestClient) -> None:
        empty = Project(id="nodata", name="empty", upload_dir=Path("/tmp"))
        PROJECTS["nodata"] = empty
        with patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"):
            resp = client.post(
                "/api/workflow/nodata/ai-placement",
                json={},
            )
            assert resp.status_code == 400

    def test_placement_success(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        mock_response = json.dumps({
            "zones": [
                {"name": "Power", "zone_type": "power", "x": 5, "y": 5, "width": 10, "height": 10, "reasoning": "test"}
            ],
            "components": [
                {"reference": "R1", "x": 10, "y": 10, "rotation": 0, "layer": "F.Cu", "zone": "Power", "reasoning": "near VCC"}
            ],
            "critical_pairs": [
                {"component_a": "U1", "component_b": "R1", "max_distance_mm": 3.0, "pair_type": "decoupling", "reasoning": "close"}
            ],
            "ground_planes": ["In2.Cu"],
            "power_planes": ["In1.Cu"],
            "reasoning": "Optimized placement strategy",
            "ipc_references": ["IPC-7351B"],
        })

        with (
            patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"),
            patch("routeai_cli.api.workflow.ai_with_tools", new_callable=AsyncMock) as mock_ai,
        ):
            mock_ai.return_value = (f"```json\n{mock_response}\n```", [])
            resp = client.post(
                "/api/workflow/test123/ai-placement",
                json={"board_width_mm": 50, "board_height_mm": 50, "layer_count": 4},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["zones"]) == 1
        assert data["zones"][0]["zone_type"] == "power"
        assert len(data["components"]) == 1
        assert data["components"][0]["reference"] == "R1"
        assert len(data["critical_pairs"]) == 1
        assert data["ground_planes"] == ["In2.Cu"]
        assert data["reasoning"] == "Optimized placement strategy"


# ---------------------------------------------------------------------------
# AI Review tests (mocked LLM)
# ---------------------------------------------------------------------------


class TestAIReview:
    """Tests for POST /api/workflow/{project_id}/ai-review."""

    def test_review_no_llm(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        with patch("routeai_cli.api.workflow.detect_llm_provider", return_value=None):
            resp = client.post("/api/workflow/test123/ai-review")
            assert resp.status_code == 400

    def test_review_success(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        llm_findings = json.dumps([
            {
                "category": "signal_integrity",
                "severity": "warning",
                "message": "Trace impedance mismatch on VCC net",
                "location": "VCC",
                "suggestion": "Widen trace to 0.3mm",
            },
            {
                "category": "placement",
                "severity": "info",
                "message": "Decoupling cap R1 is within spec of U1",
                "location": "R1, U1",
                "suggestion": "No action needed",
            },
        ])

        with (
            patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"),
            patch("routeai_cli.api.workflow.ai_with_tools", new_callable=AsyncMock) as mock_ai,
        ):
            mock_ai.return_value = (f"```json\n{llm_findings}\n```", [])
            resp = client.post("/api/workflow/test123/ai-review")

        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] <= 100.0
        assert data["score"] >= 0.0
        assert data["status"] in ("PASS", "PASS_WITH_WARNINGS", "FAIL")
        assert len(data["findings"]) >= 2
        assert data["summary"] != ""
        assert data["ai_suggestion"] is not None

    def test_review_score_critical(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        llm_findings = json.dumps([
            {
                "category": "drc",
                "severity": "critical",
                "message": "Short circuit between VCC and GND",
                "location": "VCC-GND",
                "suggestion": "Fix short",
            },
        ])

        with (
            patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"),
            patch("routeai_cli.api.workflow.ai_with_tools", new_callable=AsyncMock) as mock_ai,
        ):
            mock_ai.return_value = (f"```json\n{llm_findings}\n```", [])
            resp = client.post("/api/workflow/test123/ai-review")

        data = resp.json()
        assert data["status"] == "FAIL"
        assert data["score"] < 100.0


# ---------------------------------------------------------------------------
# AI Routing tests (mocked LLM)
# ---------------------------------------------------------------------------


class TestAIRouting:
    """Tests for POST /api/workflow/{project_id}/ai-routing."""

    def test_routing_no_llm(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        with patch("routeai_cli.api.workflow.detect_llm_provider", return_value=None):
            resp = client.post("/api/workflow/test123/ai-routing")
            assert resp.status_code == 400

    def test_routing_no_board(self, client: TestClient) -> None:
        empty = Project(id="nobd", name="empty", upload_dir=Path("/tmp"))
        PROJECTS["nobd"] = empty
        with patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"):
            resp = client.post("/api/workflow/nobd/ai-routing")
            assert resp.status_code == 400

    def test_routing_generic_llm(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        strategy = json.dumps({
            "routing_order": [
                {"priority": 1, "nets": ["GND"], "reason": "power net first"}
            ],
            "layer_assignments": {
                "power": {"layers": ["In1.Cu"], "reason": "dedicated plane"},
            },
            "cost_weights": {"via_cost": 10, "length_cost": 1},
            "net_classes": [],
            "critical_notes": ["Route GND first"],
        })

        with (
            patch("routeai_cli.api.workflow.detect_llm_provider", return_value="gemini"),
            patch("routeai_cli.api.workflow.ai_with_tools", new_callable=AsyncMock) as mock_ai,
        ):
            mock_ai.return_value = (f"```json\n{strategy}\n```", [])
            resp = client.post("/api/workflow/test123/ai-routing")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "complete"
        assert "strategy" in data
        assert data["engine"] == "llm_tool_loop"


# ---------------------------------------------------------------------------
# Integration: status progression
# ---------------------------------------------------------------------------


class TestWorkflowProgression:
    """Test that workflow status updates as steps are completed."""

    def test_status_progression(
        self, client: TestClient, parsed_project: Project
    ) -> None:
        # Initial: should suggest DRC
        resp = client.get("/api/workflow/test123/status")
        data = resp.json()
        assert data["current_stage"] == "drc"

        # After DRC
        mock_drc = MagicMock()
        mock_drc.filtered_violations = []
        mock_drc.design_score = 95.0
        mock_drc.drc_report = MagicMock(error_count=0, warning_count=0, info_count=0)
        parsed_project.drc_result = mock_drc

        resp = client.get("/api/workflow/test123/status")
        data = resp.json()
        assert data["current_stage"] == "review"

        # After review
        parsed_project.ai_review = {"findings": []}
        resp = client.get("/api/workflow/test123/status")
        data = resp.json()
        assert data["current_stage"] == "placement"
