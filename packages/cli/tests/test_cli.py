"""Tests for the RouteAI CLI.

Covers:
- File discovery
- Model conversion from parser to solver format
- Design scoring
- Severity filtering
- Reporter output formats
- CLI click command invocation
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from routeai_cli.analyzer import (
    AnalysisResult,
    _calculate_design_score,
    _filter_violations,
    convert_to_solver_board,
    discover_kicad_files,
)
from routeai_cli.main import app
from routeai_cli.reporter import HTMLReporter, JSONReporter, MarkdownReporter
from routeai_solver.drc.engine import DRCReport, DRCSeverity, DRCViolation


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def sample_pcb_text() -> str:
    """Minimal valid .kicad_pcb content for testing."""
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
    """Minimal valid .kicad_sch content for testing."""
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
def tmp_project(tmp_path: Path, sample_pcb_text: str, sample_sch_text: str) -> Path:
    """Create a temporary KiCad project directory with sample files."""
    pcb_file = tmp_path / "test_board.kicad_pcb"
    pcb_file.write_text(sample_pcb_text, encoding="utf-8")

    sch_file = tmp_path / "test_board.kicad_sch"
    sch_file.write_text(sample_sch_text, encoding="utf-8")

    return tmp_path


@pytest.fixture()
def sample_drc_report() -> DRCReport:
    """A DRC report with various violation severities for testing."""
    return DRCReport(
        violations=[
            DRCViolation(
                rule="min_clearance",
                severity=DRCSeverity.ERROR,
                message="Clearance violation: 0.10mm < 0.15mm minimum",
                location=(100.0, 50.0),
                affected_items=["R1-pad1", "trace-net1"],
            ),
            DRCViolation(
                rule="min_trace_width",
                severity=DRCSeverity.WARNING,
                message="Trace width 0.12mm is below recommended 0.15mm",
                location=(95.0, 50.0),
            ),
            DRCViolation(
                rule="solder_mask_bridge",
                severity=DRCSeverity.INFO,
                message="Solder mask bridge 0.08mm is narrow",
                location=(100.5, 50.0),
                affected_items=["R1-pad2"],
            ),
            DRCViolation(
                rule="drill_to_copper",
                severity=DRCSeverity.WARNING,
                message="Drill to copper clearance 0.15mm < 0.20mm",
            ),
        ],
        passed=False,
        stats={
            "clearance_violations": 1,
            "min_width_violations": 1,
            "solder_mask_violations": 1,
            "drill_to_copper_violations": 1,
        },
        elapsed_seconds=0.042,
    )


@pytest.fixture()
def sample_analysis_result(
    tmp_project: Path,
    sample_drc_report: DRCReport,
) -> AnalysisResult:
    """A fully-populated AnalysisResult for testing reporters."""
    return AnalysisResult(
        project_dir=tmp_project,
        boards_parsed=1,
        schematics_parsed=1,
        drc_report=sample_drc_report,
        filtered_violations=sample_drc_report.violations,
        design_score=74,
        impedance_warnings=["Trace width 0.12mm is below recommended 0.15mm"],
        thermal_warnings=[],
        manufacturing_warnings=[
            "Solder mask bridge 0.08mm is narrow",
            "Drill to copper clearance 0.15mm < 0.20mm",
        ],
        ai_constraints=[],
        ai_findings=[],
        ai_enabled=False,
        elapsed_seconds=0.15,
        board_summary={
            "generator": "pcbnew",
            "version": 20240108,
            "thickness_mm": 1.6,
            "layer_count": 5,
            "copper_layer_count": 2,
            "net_count": 3,
            "footprint_count": 1,
            "segment_count": 2,
            "via_count": 1,
            "zone_count": 0,
        },
        schematic_summary={
            "title": "Test Schematic",
            "revision": "1.0",
            "symbol_count": 1,
            "net_count": 1,
            "wire_count": 1,
            "label_count": 1,
            "hierarchical_sheet_count": 0,
        },
    )


# ---------------------------------------------------------------------------
# Tests: File discovery
# ---------------------------------------------------------------------------


class TestDiscoverKiCadFiles:
    """Tests for discover_kicad_files."""

    def test_finds_pcb_and_sch(self, tmp_project: Path) -> None:
        files = discover_kicad_files(tmp_project)
        assert len(files["pcb"]) == 1
        assert len(files["sch"]) == 1
        assert files["pcb"][0].suffix == ".kicad_pcb"
        assert files["sch"][0].suffix == ".kicad_sch"

    def test_empty_directory(self, tmp_path: Path) -> None:
        files = discover_kicad_files(tmp_path)
        assert files["pcb"] == []
        assert files["sch"] == []

    def test_nonexistent_directory(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            discover_kicad_files(tmp_path / "nonexistent")

    def test_multiple_files(self, tmp_path: Path) -> None:
        (tmp_path / "a.kicad_pcb").write_text("(kicad_pcb)", encoding="utf-8")
        (tmp_path / "b.kicad_pcb").write_text("(kicad_pcb)", encoding="utf-8")
        (tmp_path / "main.kicad_sch").write_text("(kicad_sch)", encoding="utf-8")
        files = discover_kicad_files(tmp_path)
        assert len(files["pcb"]) == 2
        assert len(files["sch"]) == 1


# ---------------------------------------------------------------------------
# Tests: Model conversion
# ---------------------------------------------------------------------------


class TestConvertToSolverBoard:
    """Tests for convert_to_solver_board."""

    def test_basic_conversion(self, sample_pcb_text: str) -> None:
        from routeai_parsers import KiCadPcbParser

        parsed = KiCadPcbParser().parse_text(sample_pcb_text)
        solver = convert_to_solver_board(parsed)

        # Nets
        assert len(solver.nets) == 3  # "", "GND", "VCC"
        net_names = {n.name for n in solver.nets}
        assert "GND" in net_names
        assert "VCC" in net_names

        # Layers
        assert len(solver.layers) >= 2
        copper = [l for l in solver.layers if l.layer_type.value == "copper"]
        assert len(copper) == 2

        # Traces
        assert len(solver.traces) >= 1

        # Vias
        assert len(solver.vias) == 1
        assert solver.vias[0].drill == 0.3
        assert solver.vias[0].diameter == 0.6

        # Pads
        assert len(solver.pads) == 2
        pad_refs = {p.component_ref for p in solver.pads}
        assert "R1" in pad_refs

        # Board outline
        assert solver.outline is not None
        assert solver.outline.area > 0


# ---------------------------------------------------------------------------
# Tests: Design scoring
# ---------------------------------------------------------------------------


class TestDesignScore:
    """Tests for _calculate_design_score."""

    def test_perfect_score(self) -> None:
        report = DRCReport(violations=[], passed=True, elapsed_seconds=0.01)
        assert _calculate_design_score(report) == 100

    def test_errors_reduce_score(self) -> None:
        report = DRCReport(
            violations=[
                DRCViolation(rule="r", severity=DRCSeverity.ERROR, message="e"),
                DRCViolation(rule="r", severity=DRCSeverity.ERROR, message="e"),
            ],
            passed=False,
            elapsed_seconds=0.01,
        )
        assert _calculate_design_score(report) == 80

    def test_mixed_severities(self, sample_drc_report: DRCReport) -> None:
        score = _calculate_design_score(sample_drc_report)
        # 100 - 10 (1 error) - 6 (2 warnings) - 1 (1 info) = 83
        assert score == 83

    def test_floor_at_zero(self) -> None:
        violations = [
            DRCViolation(rule="r", severity=DRCSeverity.ERROR, message="e")
            for _ in range(20)
        ]
        report = DRCReport(violations=violations, passed=False, elapsed_seconds=0.01)
        assert _calculate_design_score(report) == 0


# ---------------------------------------------------------------------------
# Tests: Severity filtering
# ---------------------------------------------------------------------------


class TestSeverityFiltering:
    """Tests for _filter_violations."""

    def test_filter_info_includes_all(self, sample_drc_report: DRCReport) -> None:
        filtered = _filter_violations(sample_drc_report.violations, "info")
        assert len(filtered) == 4

    def test_filter_warning_excludes_info(self, sample_drc_report: DRCReport) -> None:
        filtered = _filter_violations(sample_drc_report.violations, "warning")
        assert len(filtered) == 3
        assert all(v.severity != DRCSeverity.INFO for v in filtered)

    def test_filter_critical_only_errors(self, sample_drc_report: DRCReport) -> None:
        filtered = _filter_violations(sample_drc_report.violations, "critical")
        assert len(filtered) == 1
        assert filtered[0].severity == DRCSeverity.ERROR


# ---------------------------------------------------------------------------
# Tests: Reporters
# ---------------------------------------------------------------------------


class TestMarkdownReporter:
    """Tests for MarkdownReporter."""

    def test_renders_markdown(self, sample_analysis_result: AnalysisResult) -> None:
        report = MarkdownReporter().render(sample_analysis_result)

        assert "# RouteAI Design Analysis Report" in report
        assert "## Summary" in report
        assert "## DRC Violations" in report
        assert "74/100" in report
        assert "FAILED" in report
        assert "min_clearance" in report
        assert "R1-pad1" in report
        assert "Generated by RouteAI CLI" in report

    def test_no_violations(self, sample_analysis_result: AnalysisResult) -> None:
        result = sample_analysis_result
        result.filtered_violations = []
        report = MarkdownReporter().render(result)
        assert "No violations at the selected severity level" in report

    def test_ai_section_absent_when_disabled(
        self, sample_analysis_result: AnalysisResult
    ) -> None:
        report = MarkdownReporter().render(sample_analysis_result)
        assert "## LLM Analysis" not in report

    def test_ai_section_present_when_enabled(
        self, sample_analysis_result: AnalysisResult
    ) -> None:
        result = sample_analysis_result
        result.ai_enabled = True
        result.ai_findings = [
            {"severity": "warning", "category": "signal_integrity", "message": "USB pair skew"}
        ]
        result.ai_constraints = [
            {"type": "diff_pair", "name": "USB_D+/D-", "impedance": 90}
        ]
        report = MarkdownReporter().render(result)
        assert "## LLM Analysis" in report
        assert "USB pair skew" in report
        assert "USB_D+/D-" in report


class TestJSONReporter:
    """Tests for JSONReporter."""

    def test_renders_valid_json(self, sample_analysis_result: AnalysisResult) -> None:
        report = JSONReporter().render(sample_analysis_result)
        data = json.loads(report)

        assert data["report"] == "routeai-analysis"
        assert data["summary"]["design_score"] == 74
        assert data["summary"]["design_grade"] == "C"
        assert len(data["violations"]) == 4
        assert data["violations"][0]["rule"] == "min_clearance"
        assert data["violations"][0]["severity"] == "error"
        assert "location" in data["violations"][0]

    def test_includes_board_info(self, sample_analysis_result: AnalysisResult) -> None:
        report = JSONReporter().render(sample_analysis_result)
        data = json.loads(report)
        assert data["board"]["generator"] == "pcbnew"
        assert data["schematic"]["title"] == "Test Schematic"

    def test_drc_stats(self, sample_analysis_result: AnalysisResult) -> None:
        report = JSONReporter().render(sample_analysis_result)
        data = json.loads(report)
        drc = data["summary"]["drc"]
        assert drc["passed"] is False
        assert drc["error_count"] == 1
        assert drc["warning_count"] == 2


class TestHTMLReporter:
    """Tests for HTMLReporter."""

    def test_renders_html(self, sample_analysis_result: AnalysisResult) -> None:
        report = HTMLReporter().render(sample_analysis_result)

        assert "<!DOCTYPE html>" in report
        assert "<title>RouteAI Analysis Report</title>" in report
        assert "74/100" in report
        assert "min_clearance" in report
        assert "Generated by RouteAI CLI" in report

    def test_html_escapes_content(self, sample_analysis_result: AnalysisResult) -> None:
        """Ensure special characters are HTML-escaped."""
        result = sample_analysis_result
        result.errors = ["Something <script>alert('xss')</script> happened"]
        report = HTMLReporter().render(result)
        assert "<script>" not in report
        assert "&lt;script&gt;" in report


# ---------------------------------------------------------------------------
# Tests: CLI commands
# ---------------------------------------------------------------------------


class TestCLIVersion:
    """Tests for the ``routeai version`` command."""

    def test_version_output(self) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["version"])
        assert result.exit_code == 0
        assert "routeai-cli" in result.output


class TestCLIInfo:
    """Tests for the ``routeai info`` command."""

    def test_info_shows_project_data(self, tmp_project: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["info", str(tmp_project)])
        assert result.exit_code == 0
        assert "PCB files found: 1" in result.output
        assert "Schematic files found: 1" in result.output
        assert "Nets" in result.output

    def test_info_no_kicad_files(self, tmp_path: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["info", str(tmp_path)])
        assert result.exit_code != 0


class TestCLIAnalyze:
    """Tests for the ``routeai analyze`` command."""

    def test_analyze_default_format(self, tmp_project: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["analyze", str(tmp_project)])
        assert result.exit_code == 0
        assert "RouteAI Design Analysis Report" in result.output

    def test_analyze_json_format(self, tmp_project: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["analyze", str(tmp_project), "--format", "json"])
        assert result.exit_code == 0
        # Find the JSON object in the output (skip the "Analyzing project..." preamble)
        output = result.output
        json_start = output.index("{")
        data = json.loads(output[json_start:])
        assert data["report"] == "routeai-analysis"

    def test_analyze_html_format(self, tmp_project: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["analyze", str(tmp_project), "--format", "html"])
        assert result.exit_code == 0
        assert "<!DOCTYPE html>" in result.output

    def test_analyze_output_to_file(self, tmp_project: Path, tmp_path: Path) -> None:
        out_file = tmp_path / "report.md"
        runner = CliRunner()
        result = runner.invoke(
            app,
            ["analyze", str(tmp_project), "--output", str(out_file)],
        )
        assert result.exit_code == 0
        assert out_file.exists()
        content = out_file.read_text(encoding="utf-8")
        assert "RouteAI Design Analysis Report" in content

    def test_analyze_severity_filter(self, tmp_project: Path) -> None:
        runner = CliRunner()
        result = runner.invoke(
            app,
            ["analyze", str(tmp_project), "--severity", "critical", "--format", "json"],
        )
        assert result.exit_code == 0

    def test_analyze_ai_without_key_fails(self, tmp_project: Path) -> None:
        runner = CliRunner()
        env = dict(ANTHROPIC_API_KEY="")
        result = runner.invoke(app, ["analyze", str(tmp_project), "--ai"], env=env)
        assert result.exit_code != 0
        assert "ANTHROPIC_API_KEY" in result.output

    def test_analyze_nonexistent_dir(self) -> None:
        runner = CliRunner()
        result = runner.invoke(app, ["analyze", "/nonexistent/path"])
        assert result.exit_code != 0
