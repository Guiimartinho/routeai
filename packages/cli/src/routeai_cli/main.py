"""Main CLI entry point using Click.

Provides the ``routeai`` command group with subcommands:
- ``analyze`` -- parse KiCad files, run DRC, optionally run LLM analysis
- ``info``    -- show parsed project information
- ``version`` -- print version string
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import click

from routeai_cli import __version__
from routeai_cli.analyzer import AnalysisOptions, analyze_project
from routeai_cli.reporter import HTMLReporter, JSONReporter, MarkdownReporter


# ---------------------------------------------------------------------------
# CLI root group
# ---------------------------------------------------------------------------

@click.group()
def app() -> None:
    """RouteAI -- LLM-powered PCB design analysis toolkit."""


# ---------------------------------------------------------------------------
# version
# ---------------------------------------------------------------------------

@app.command()
def version() -> None:
    """Print the RouteAI CLI version."""
    click.echo(f"routeai-cli {__version__}")


# ---------------------------------------------------------------------------
# info
# ---------------------------------------------------------------------------

@app.command()
@click.argument("project_dir", type=click.Path(exists=True, file_okay=False, resolve_path=True))
def info(project_dir: str) -> None:
    """Show parsed project information for a KiCad project directory.

    PROJECT_DIR is the path to a directory containing .kicad_pcb and/or
    .kicad_sch files.
    """
    from routeai_cli.analyzer import discover_kicad_files, parse_kicad_files

    project_path = Path(project_dir)
    files = discover_kicad_files(project_path)

    if not files["pcb"] and not files["sch"]:
        click.echo(f"No KiCad files found in {project_dir}", err=True)
        sys.exit(1)

    click.echo(f"Project directory: {project_dir}")
    click.echo()

    if files["pcb"]:
        click.echo(f"PCB files found: {len(files['pcb'])}")
        for p in files["pcb"]:
            click.echo(f"  - {p.name}")
    else:
        click.echo("PCB files found: 0")

    if files["sch"]:
        click.echo(f"Schematic files found: {len(files['sch'])}")
        for s in files["sch"]:
            click.echo(f"  - {s.name}")
    else:
        click.echo("Schematic files found: 0")

    click.echo()

    parsed = parse_kicad_files(files)

    for board in parsed["boards"]:
        click.echo(f"--- Board: {board.generator or 'unknown generator'} ---")
        click.echo(f"  Version     : {board.version}")
        click.echo(f"  Thickness   : {board.thickness} mm")
        click.echo(f"  Layers      : {len(board.layers)}")
        click.echo(f"  Nets        : {len(board.nets)}")
        click.echo(f"  Footprints  : {len(board.footprints)}")
        click.echo(f"  Segments    : {len(board.segments)}")
        click.echo(f"  Vias        : {len(board.vias)}")
        click.echo(f"  Zones       : {len(board.zones)}")

        copper_layers = [l for l in board.layers if l.layer_type == "signal" or l.layer_type == "power"]
        if copper_layers:
            click.echo(f"  Copper layers: {', '.join(l.name for l in copper_layers)}")

        if board.net_classes:
            click.echo(f"  Net classes : {', '.join(nc.name for nc in board.net_classes)}")

        click.echo()

    for sch in parsed["schematics"]:
        click.echo(f"--- Schematic: {sch.title or 'untitled'} ---")
        click.echo(f"  Version     : {sch.version}")
        click.echo(f"  Generator   : {sch.generator}")
        if sch.revision:
            click.echo(f"  Revision    : {sch.revision}")
        if sch.company:
            click.echo(f"  Company     : {sch.company}")
        click.echo(f"  Symbols     : {len(sch.symbols)}")
        click.echo(f"  Wires       : {len(sch.wires)}")
        click.echo(f"  Labels      : {len(sch.labels)}")
        click.echo(f"  Nets        : {len(sch.nets)}")
        click.echo(f"  Hier sheets : {len(sch.hierarchical_sheets)}")

        # Component summary
        refs: dict[str, int] = {}
        for sym in sch.symbols:
            prefix = ""
            for ch in sym.reference:
                if ch.isalpha():
                    prefix += ch
                else:
                    break
            if prefix:
                refs[prefix] = refs.get(prefix, 0) + 1
        if refs:
            parts = [f"{count} {prefix}" for prefix, count in sorted(refs.items())]
            click.echo(f"  Components  : {', '.join(parts)}")

        # Power nets
        power_nets = [n for n in sch.nets if n.is_power]
        if power_nets:
            click.echo(f"  Power nets  : {', '.join(n.name for n in power_nets[:10])}"
                        + (" ..." if len(power_nets) > 10 else ""))

        click.echo()


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------

@app.command()
@click.argument("project_dir", type=click.Path(exists=True, file_okay=False, resolve_path=True))
@click.option(
    "--format", "report_format",
    type=click.Choice(["markdown", "json", "html"], case_sensitive=False),
    default="markdown",
    help="Output report format (default: markdown).",
)
@click.option(
    "--severity",
    type=click.Choice(["critical", "warning", "info"], case_sensitive=False),
    default="info",
    help="Minimum severity level to include in the report (default: info).",
)
@click.option(
    "--output", "-o",
    type=click.Path(dir_okay=False, writable=True),
    default=None,
    help="Write report to a file instead of stdout.",
)
@click.option(
    "--ai",
    is_flag=True,
    default=False,
    help="Enable LLM-powered analysis (requires ANTHROPIC_API_KEY).",
)
def analyze(
    project_dir: str,
    report_format: str,
    severity: str,
    output: str | None,
    ai: bool,
) -> None:
    """Analyze a KiCad project directory.

    Parses .kicad_pcb and .kicad_sch files, runs DRC checks, and generates
    a report.  Optionally runs LLM analysis when --ai is passed.

    PROJECT_DIR is the path to a directory containing KiCad project files.
    """
    # Validate AI prerequisites
    if ai and not os.environ.get("ANTHROPIC_API_KEY"):
        click.echo(
            "Error: --ai flag requires the ANTHROPIC_API_KEY environment variable to be set.",
            err=True,
        )
        sys.exit(1)

    project_path = Path(project_dir)

    options = AnalysisOptions(
        project_dir=project_path,
        use_ai=ai,
        min_severity=severity,
    )

    click.echo(f"Analyzing project: {project_path}")
    click.echo()

    try:
        result = analyze_project(options)
    except FileNotFoundError as exc:
        click.echo(f"Error: {exc}", err=True)
        sys.exit(1)
    except Exception as exc:
        click.echo(f"Error during analysis: {exc}", err=True)
        sys.exit(1)

    # Select reporter
    reporters = {
        "markdown": MarkdownReporter,
        "json": JSONReporter,
        "html": HTMLReporter,
    }
    reporter_cls = reporters[report_format.lower()]
    reporter = reporter_cls()
    report_text = reporter.render(result)

    # Output
    if output:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(report_text, encoding="utf-8")
        click.echo(f"Report written to {output_path}")
    else:
        click.echo(report_text)


# ---------------------------------------------------------------------------
# Entry point for direct invocation
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app()
