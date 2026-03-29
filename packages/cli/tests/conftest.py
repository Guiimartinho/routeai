"""Shared test fixtures for routeai_cli tests."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_project_dir(tmp_path: Path) -> Path:
    """Create a temporary project directory with sample KiCad files."""
    project = tmp_path / "test_project"
    project.mkdir()

    # Minimal KiCad PCB file
    pcb_file = project / "test.kicad_pcb"
    pcb_file.write_text(
        '(kicad_pcb (version 20231014) (generator "test")\n'
        "  (general (thickness 1.6))\n"
        "  (layers\n"
        '    (0 "F.Cu" signal)\n'
        '    (31 "B.Cu" signal)\n'
        "  )\n"
        '  (net 0 "")\n'
        '  (net 1 "GND")\n'
        ")\n"
    )

    # Minimal KiCad schematic file
    sch_file = project / "test.kicad_sch"
    sch_file.write_text(
        '(kicad_sch (version 20231120) (generator "test")\n'
        '  (uuid "00000000-0000-0000-0000-000000000001")\n'
        '  (paper "A4")\n'
        ")\n"
    )

    return project


@pytest.fixture
def tmp_output_dir(tmp_path: Path) -> Path:
    """Create a temporary output directory for reports."""
    out = tmp_path / "output"
    out.mkdir()
    return out
