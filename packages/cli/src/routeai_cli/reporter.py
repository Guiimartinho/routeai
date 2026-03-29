"""Report generation for RouteAI analysis results.

Provides three reporter classes:
- ``MarkdownReporter`` -- human-readable Markdown
- ``JSONReporter``     -- machine-readable JSON
- ``HTMLReporter``     -- self-contained HTML page
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from html import escape as html_escape
from typing import Any

from routeai_solver.drc.engine import DRCSeverity, DRCViolation

from routeai_cli.analyzer import AnalysisResult


# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------


class BaseReporter(ABC):
    """Abstract base for all report renderers."""

    @abstractmethod
    def render(self, result: AnalysisResult) -> str:
        """Render the analysis result to a string."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _severity_label(severity: DRCSeverity) -> str:
    """Map DRCSeverity to a display label."""
    return {
        DRCSeverity.ERROR: "CRITICAL",
        DRCSeverity.WARNING: "WARNING",
        DRCSeverity.INFO: "INFO",
    }.get(severity, severity.value.upper())


def _severity_emoji(severity: DRCSeverity) -> str:
    """Return an ASCII indicator for severity (no Unicode emoji)."""
    return {
        DRCSeverity.ERROR: "[!]",
        DRCSeverity.WARNING: "[~]",
        DRCSeverity.INFO: "[i]",
    }.get(severity, "[ ]")


def _violation_to_dict(v: DRCViolation) -> dict[str, Any]:
    """Serialize a DRCViolation to a plain dict."""
    d: dict[str, Any] = {
        "rule": v.rule,
        "severity": v.severity.value,
        "message": v.message,
    }
    if v.location:
        d["location"] = {"x_mm": v.location[0], "y_mm": v.location[1]}
    if v.affected_items:
        d["affected_items"] = v.affected_items
    return d


def _score_grade(score: int) -> str:
    """Return a letter grade for the design score."""
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    elif score >= 70:
        return "C"
    elif score >= 60:
        return "D"
    return "F"


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------


class MarkdownReporter(BaseReporter):
    """Renders the analysis result as a Markdown document."""

    def render(self, result: AnalysisResult) -> str:
        lines: list[str] = []
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

        lines.append("# RouteAI Design Analysis Report")
        lines.append("")
        lines.append(f"**Project:** `{result.project_dir}`  ")
        lines.append(f"**Date:** {now}  ")
        lines.append(f"**Analysis time:** {result.elapsed_seconds:.2f}s  ")
        lines.append("")

        # -- Summary --
        lines.append("## Summary")
        lines.append("")
        lines.append(f"| Metric | Value |")
        lines.append(f"|--------|-------|")
        lines.append(f"| PCB files parsed | {result.boards_parsed} |")
        lines.append(f"| Schematic files parsed | {result.schematics_parsed} |")

        if result.drc_report:
            dr = result.drc_report
            lines.append(f"| DRC status | {'PASSED' if dr.passed else 'FAILED'} |")
            lines.append(f"| Errors | {dr.error_count} |")
            lines.append(f"| Warnings | {dr.warning_count} |")
            lines.append(f"| Info | {dr.info_count} |")

        grade = _score_grade(result.design_score)
        lines.append(f"| **Design score** | **{result.design_score}/100 ({grade})** |")
        lines.append("")

        # -- Board info --
        if result.board_summary:
            lines.append("## Board Information")
            lines.append("")
            bs = result.board_summary
            lines.append(f"- Generator: {bs.get('generator', 'N/A')}")
            lines.append(f"- Board thickness: {bs.get('thickness_mm', 'N/A')} mm")
            lines.append(f"- Copper layers: {bs.get('copper_layer_count', 'N/A')}")
            lines.append(f"- Total layers: {bs.get('layer_count', 'N/A')}")
            lines.append(f"- Nets: {bs.get('net_count', 'N/A')}")
            lines.append(f"- Footprints: {bs.get('footprint_count', 'N/A')}")
            lines.append(f"- Trace segments: {bs.get('segment_count', 'N/A')}")
            lines.append(f"- Vias: {bs.get('via_count', 'N/A')}")
            lines.append(f"- Zones: {bs.get('zone_count', 'N/A')}")
            lines.append("")

        # -- Schematic info --
        if result.schematic_summary:
            lines.append("## Schematic Information")
            lines.append("")
            ss = result.schematic_summary
            lines.append(f"- Title: {ss.get('title', 'N/A')}")
            lines.append(f"- Revision: {ss.get('revision', 'N/A')}")
            lines.append(f"- Symbols: {ss.get('symbol_count', 'N/A')}")
            lines.append(f"- Nets: {ss.get('net_count', 'N/A')}")
            lines.append(f"- Hierarchical sheets: {ss.get('hierarchical_sheet_count', 'N/A')}")
            lines.append("")

        # -- DRC Violations --
        if result.filtered_violations:
            lines.append("## DRC Violations")
            lines.append("")
            for v in result.filtered_violations:
                sev = _severity_emoji(v.severity)
                loc = ""
                if v.location:
                    loc = f" at ({v.location[0]:.3f}, {v.location[1]:.3f}) mm"
                items = ""
                if v.affected_items:
                    items = f" -- affects: {', '.join(v.affected_items)}"
                lines.append(f"- {sev} **{_severity_label(v.severity)}** `{v.rule}`: {v.message}{loc}{items}")
            lines.append("")
        elif result.drc_report:
            lines.append("## DRC Violations")
            lines.append("")
            lines.append("No violations at the selected severity level.")
            lines.append("")

        # -- Impedance / Thermal / Manufacturing warnings --
        if result.impedance_warnings:
            lines.append("## Impedance Warnings")
            lines.append("")
            for w in result.impedance_warnings:
                lines.append(f"- {w}")
            lines.append("")

        if result.thermal_warnings:
            lines.append("## Thermal Warnings")
            lines.append("")
            for w in result.thermal_warnings:
                lines.append(f"- {w}")
            lines.append("")

        if result.manufacturing_warnings:
            lines.append("## Manufacturing Warnings")
            lines.append("")
            for w in result.manufacturing_warnings:
                lines.append(f"- {w}")
            lines.append("")

        # -- AI analysis --
        if result.ai_enabled:
            lines.append("## LLM Analysis")
            lines.append("")

            if result.ai_findings:
                lines.append("### Findings")
                lines.append("")
                for finding in result.ai_findings:
                    severity = finding.get("severity", "info")
                    category = finding.get("category", "general")
                    message = finding.get("message", finding.get("description", str(finding)))
                    lines.append(f"- [{severity.upper()}] ({category}) {message}")
                lines.append("")

            if result.ai_constraints:
                lines.append("### Suggested Constraints")
                lines.append("")
                for constraint in result.ai_constraints:
                    ctype = constraint.get("type", "unknown")
                    name = constraint.get("name", "unnamed")
                    lines.append(f"- **{ctype}**: {name}")
                    for key, val in constraint.items():
                        if key not in ("type", "name", "_item_type"):
                            lines.append(f"  - {key}: {val}")
                lines.append("")

            if not result.ai_findings and not result.ai_constraints:
                lines.append("No additional findings from LLM analysis.")
                lines.append("")

        # -- Errors --
        if result.errors:
            lines.append("## Errors")
            lines.append("")
            for err in result.errors:
                lines.append(f"- {err}")
            lines.append("")

        lines.append("---")
        lines.append("*Generated by RouteAI CLI*")
        lines.append("")

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------


class JSONReporter(BaseReporter):
    """Renders the analysis result as a JSON document."""

    def render(self, result: AnalysisResult) -> str:
        now = datetime.now(timezone.utc).isoformat()

        data: dict[str, Any] = {
            "report": "routeai-analysis",
            "version": "1.0",
            "generated_at": now,
            "project_dir": str(result.project_dir),
            "elapsed_seconds": round(result.elapsed_seconds, 3),
            "summary": {
                "boards_parsed": result.boards_parsed,
                "schematics_parsed": result.schematics_parsed,
                "design_score": result.design_score,
                "design_grade": _score_grade(result.design_score),
            },
        }

        if result.drc_report:
            dr = result.drc_report
            data["summary"]["drc"] = {
                "passed": dr.passed,
                "error_count": dr.error_count,
                "warning_count": dr.warning_count,
                "info_count": dr.info_count,
                "elapsed_seconds": round(dr.elapsed_seconds, 3),
                "stats": dr.stats,
            }

        if result.board_summary:
            data["board"] = result.board_summary

        if result.schematic_summary:
            data["schematic"] = result.schematic_summary

        data["violations"] = [_violation_to_dict(v) for v in result.filtered_violations]

        data["warnings"] = {
            "impedance": result.impedance_warnings,
            "thermal": result.thermal_warnings,
            "manufacturing": result.manufacturing_warnings,
        }

        if result.ai_enabled:
            data["ai_analysis"] = {
                "enabled": True,
                "findings": result.ai_findings,
                "constraints": result.ai_constraints,
            }

        if result.errors:
            data["errors"] = result.errors

        return json.dumps(data, indent=2, default=str)


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------


class HTMLReporter(BaseReporter):
    """Renders the analysis result as a self-contained HTML page."""

    def render(self, result: AnalysisResult) -> str:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        h = html_escape

        # Severity badge colours
        def _badge(severity: DRCSeverity) -> str:
            colors = {
                DRCSeverity.ERROR: "#dc3545",
                DRCSeverity.WARNING: "#ffc107",
                DRCSeverity.INFO: "#17a2b8",
            }
            color = colors.get(severity, "#6c757d")
            label = _severity_label(severity)
            return (
                f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
                f'color:#fff;background:{color};font-size:12px;font-weight:bold;">'
                f'{label}</span>'
            )

        grade = _score_grade(result.design_score)

        parts: list[str] = []
        parts.append("<!DOCTYPE html>")
        parts.append("<html lang='en'>")
        parts.append("<head>")
        parts.append("<meta charset='utf-8'>")
        parts.append("<meta name='viewport' content='width=device-width, initial-scale=1'>")
        parts.append("<title>RouteAI Analysis Report</title>")
        parts.append("<style>")
        parts.append("""
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
       max-width: 900px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
h1 { border-bottom: 2px solid #0066cc; padding-bottom: 8px; }
h2 { color: #0066cc; margin-top: 32px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f4f4f4; font-weight: 600; }
.score { font-size: 48px; font-weight: bold; text-align: center; margin: 20px 0; }
.score-a { color: #28a745; }
.score-b { color: #17a2b8; }
.score-c { color: #ffc107; }
.score-d { color: #fd7e14; }
.score-f { color: #dc3545; }
.violation { padding: 8px 12px; margin: 4px 0; border-left: 4px solid #ccc; background: #fafafa; }
.violation-error { border-left-color: #dc3545; }
.violation-warning { border-left-color: #ffc107; }
.violation-info { border-left-color: #17a2b8; }
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee;
          font-size: 12px; color: #999; }
code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 90%; }
""")
        parts.append("</style>")
        parts.append("</head>")
        parts.append("<body>")

        parts.append("<h1>RouteAI Design Analysis Report</h1>")
        parts.append(f"<p><strong>Project:</strong> <code>{h(str(result.project_dir))}</code><br>")
        parts.append(f"<strong>Date:</strong> {h(now)}<br>")
        parts.append(f"<strong>Analysis time:</strong> {result.elapsed_seconds:.2f}s</p>")

        # Score
        grade_class = f"score-{grade.lower()}"
        parts.append(f'<div class="score {grade_class}">{result.design_score}/100 ({grade})</div>')

        # Summary table
        parts.append("<h2>Summary</h2>")
        parts.append("<table>")
        parts.append("<tr><th>Metric</th><th>Value</th></tr>")
        parts.append(f"<tr><td>PCB files parsed</td><td>{result.boards_parsed}</td></tr>")
        parts.append(f"<tr><td>Schematic files parsed</td><td>{result.schematics_parsed}</td></tr>")
        if result.drc_report:
            dr = result.drc_report
            status = "PASSED" if dr.passed else "FAILED"
            parts.append(f"<tr><td>DRC status</td><td><strong>{status}</strong></td></tr>")
            parts.append(f"<tr><td>Errors</td><td>{dr.error_count}</td></tr>")
            parts.append(f"<tr><td>Warnings</td><td>{dr.warning_count}</td></tr>")
            parts.append(f"<tr><td>Info</td><td>{dr.info_count}</td></tr>")
        parts.append("</table>")

        # Board info
        if result.board_summary:
            parts.append("<h2>Board Information</h2>")
            parts.append("<table>")
            for key, val in result.board_summary.items():
                parts.append(f"<tr><td>{h(key.replace('_', ' ').title())}</td><td>{h(str(val))}</td></tr>")
            parts.append("</table>")

        # Schematic info
        if result.schematic_summary:
            parts.append("<h2>Schematic Information</h2>")
            parts.append("<table>")
            for key, val in result.schematic_summary.items():
                parts.append(f"<tr><td>{h(key.replace('_', ' ').title())}</td><td>{h(str(val))}</td></tr>")
            parts.append("</table>")

        # Violations
        if result.filtered_violations:
            parts.append("<h2>DRC Violations</h2>")
            for v in result.filtered_violations:
                sev_class = {
                    DRCSeverity.ERROR: "violation-error",
                    DRCSeverity.WARNING: "violation-warning",
                    DRCSeverity.INFO: "violation-info",
                }.get(v.severity, "")
                loc = ""
                if v.location:
                    loc = f" at ({v.location[0]:.3f}, {v.location[1]:.3f}) mm"
                items = ""
                if v.affected_items:
                    items = f" &mdash; affects: {h(', '.join(v.affected_items))}"
                parts.append(
                    f'<div class="violation {sev_class}">'
                    f'{_badge(v.severity)} <code>{h(v.rule)}</code>: '
                    f'{h(v.message)}{loc}{items}'
                    f'</div>'
                )
        elif result.drc_report:
            parts.append("<h2>DRC Violations</h2>")
            parts.append("<p>No violations at the selected severity level.</p>")

        # Warnings sections
        for title, warnings in [
            ("Impedance Warnings", result.impedance_warnings),
            ("Thermal Warnings", result.thermal_warnings),
            ("Manufacturing Warnings", result.manufacturing_warnings),
        ]:
            if warnings:
                parts.append(f"<h2>{h(title)}</h2>")
                parts.append("<ul>")
                for w in warnings:
                    parts.append(f"<li>{h(w)}</li>")
                parts.append("</ul>")

        # AI analysis
        if result.ai_enabled:
            parts.append("<h2>LLM Analysis</h2>")

            if result.ai_findings:
                parts.append("<h3>Findings</h3>")
                parts.append("<ul>")
                for finding in result.ai_findings:
                    sev = finding.get("severity", "info").upper()
                    cat = finding.get("category", "general")
                    msg = finding.get("message", finding.get("description", str(finding)))
                    parts.append(f"<li><strong>[{h(sev)}]</strong> ({h(cat)}) {h(str(msg))}</li>")
                parts.append("</ul>")

            if result.ai_constraints:
                parts.append("<h3>Suggested Constraints</h3>")
                parts.append("<table>")
                parts.append("<tr><th>Type</th><th>Name</th><th>Details</th></tr>")
                for c in result.ai_constraints:
                    ctype = c.get("type", "unknown")
                    cname = c.get("name", "unnamed")
                    details = ", ".join(
                        f"{k}={v}" for k, v in c.items()
                        if k not in ("type", "name", "_item_type")
                    )
                    parts.append(
                        f"<tr><td>{h(ctype)}</td><td>{h(cname)}</td><td>{h(details)}</td></tr>"
                    )
                parts.append("</table>")

            if not result.ai_findings and not result.ai_constraints:
                parts.append("<p>No additional findings from LLM analysis.</p>")

        # Errors
        if result.errors:
            parts.append("<h2>Errors</h2>")
            parts.append("<ul>")
            for err in result.errors:
                parts.append(f"<li>{h(err)}</li>")
            parts.append("</ul>")

        # Footer
        parts.append('<div class="footer">Generated by RouteAI CLI</div>')

        parts.append("</body>")
        parts.append("</html>")

        return "\n".join(parts)
