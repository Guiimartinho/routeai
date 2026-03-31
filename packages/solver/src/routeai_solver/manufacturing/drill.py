"""Excellon drill file exporter.

Generates industry-standard Excellon NC drill files for PCB
fabrication, supporting plated and non-plated holes, tool tables,
and slot routing.

References:
    - IPC-NC-349: Computer Numerical Control Formatting for Drillers
    - Excellon format as commonly supported by PCB fabs
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from routeai_solver.board_model import (
    BoardDesign,
)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DrillTool:
    """A drill tool definition."""

    number: int  # Tool number (T01, T02, ...)
    diameter_mm: float
    plated: bool = True
    hit_count: int = 0


@dataclass
class DrillHit:
    """A single drill hit (hole location)."""

    x: float  # mm
    y: float  # mm
    tool_number: int
    is_slot: bool = False
    slot_end_x: float = 0.0
    slot_end_y: float = 0.0


# ---------------------------------------------------------------------------
# Coordinate formatting
# ---------------------------------------------------------------------------

def _fmt_coord(value_mm: float) -> str:
    """Format a coordinate in Excellon format (4.3 for mm, trailing zeros)."""
    # Excellon typically uses 3.3 or 4.3 format for mm
    # We use 4 integer, 3 decimal for mm
    scaled = int(round(value_mm * 1000))
    return str(scaled)


# ---------------------------------------------------------------------------
# Drill Exporter
# ---------------------------------------------------------------------------

class DrillExporter:
    """Exports PCB drill data to Excellon format.

    Generates separate files for plated (PTH) and non-plated (NPTH)
    holes. Supports standard round holes and routed slots.

    Args:
        board_name: Name for the drill file headers.
        units: Coordinate units ("mm" or "inch").
    """

    def __init__(
        self,
        board_name: str = "RouteAI_Board",
        units: str = "mm",
    ) -> None:
        self.board_name = board_name
        self.units = units

    def _collect_drill_data(
        self, board: BoardDesign
    ) -> tuple[list[DrillHit], list[DrillHit]]:
        """Collect all drill holes from the board, separating PTH and NPTH.

        Returns:
            (plated_hits, non_plated_hits)
        """
        plated_hits: list[DrillHit] = []
        non_plated_hits: list[DrillHit] = []

        # Tool diameter -> tool number mapping
        plated_tools: dict[float, int] = {}
        npth_tools: dict[float, int] = {}
        next_pth_tool = 1
        next_npth_tool = 1

        # Vias (always plated)
        for via in board.vias:
            diameter = round(via.drill, 3)
            if diameter not in plated_tools:
                plated_tools[diameter] = next_pth_tool
                next_pth_tool += 1
            plated_hits.append(DrillHit(
                x=via.x,
                y=via.y,
                tool_number=plated_tools[diameter],
            ))

        # Through-hole pads (plated)
        for pad in board.pads:
            if not pad.is_through_hole:
                continue
            diameter = round(pad.drill, 3)
            if diameter not in plated_tools:
                plated_tools[diameter] = next_pth_tool
                next_pth_tool += 1
            plated_hits.append(DrillHit(
                x=pad.x,
                y=pad.y,
                tool_number=plated_tools[diameter],
            ))

        # Non-plated drill holes (mounting holes, etc.)
        for hole in board.drills:
            diameter = round(hole.diameter, 3)
            if hole.plated:
                if diameter not in plated_tools:
                    plated_tools[diameter] = next_pth_tool
                    next_pth_tool += 1
                plated_hits.append(DrillHit(
                    x=hole.x,
                    y=hole.y,
                    tool_number=plated_tools[diameter],
                ))
            else:
                if diameter not in npth_tools:
                    npth_tools[diameter] = next_npth_tool
                    next_npth_tool += 1
                non_plated_hits.append(DrillHit(
                    x=hole.x,
                    y=hole.y,
                    tool_number=npth_tools[diameter],
                ))

        return plated_hits, non_plated_hits

    def _build_tool_table(
        self, hits: list[DrillHit], board: BoardDesign
    ) -> dict[int, DrillTool]:
        """Build the tool table from drill hits."""
        tools: dict[int, DrillTool] = {}

        # Build diameter mapping from all drillable features
        tool_diameters: dict[int, float] = {}

        # From vias
        via_tools: dict[float, int] = {}
        tool_num = 1
        for via in board.vias:
            d = round(via.drill, 3)
            if d not in via_tools:
                via_tools[d] = tool_num
                tool_diameters[tool_num] = d
                tool_num += 1

        # From pads
        for pad in board.pads:
            if not pad.is_through_hole:
                continue
            d = round(pad.drill, 3)
            if d not in via_tools:
                via_tools[d] = tool_num
                tool_diameters[tool_num] = d
                tool_num += 1

        # From drill holes
        for hole in board.drills:
            d = round(hole.diameter, 3)
            if d not in via_tools:
                via_tools[d] = tool_num
                tool_diameters[tool_num] = d
                tool_num += 1

        # Count hits per tool
        hit_counts: dict[int, int] = {}
        for hit in hits:
            hit_counts[hit.tool_number] = hit_counts.get(hit.tool_number, 0) + 1

        for tn, diameter in tool_diameters.items():
            if tn in hit_counts:
                tools[tn] = DrillTool(
                    number=tn,
                    diameter_mm=diameter,
                    plated=True,
                    hit_count=hit_counts.get(tn, 0),
                )

        return tools

    def _write_excellon(
        self,
        hits: list[DrillHit],
        tools: dict[int, DrillTool],
        plated: bool,
    ) -> str:
        """Generate the Excellon file content."""
        lines: list[str] = []

        # Header
        lines.append("M48")  # Begin header
        lines.append("; Generated by RouteAI EDA")
        lines.append(f"; Board: {self.board_name}")
        lines.append(f"; {'Plated (PTH)' if plated else 'Non-Plated (NPTH)'} Drill File")
        lines.append("; Format: Excellon")

        if self.units == "mm":
            lines.append("METRIC,TZ")  # Metric, trailing zeros
            lines.append("FMAT,2")  # Format 2
        else:
            lines.append("INCH,TZ")
            lines.append("FMAT,2")

        # IPC-2581 attributes
        if plated:
            lines.append("; #@! TF.FileFunction,Plated,1,{n},PTH")
        else:
            lines.append("; #@! TF.FileFunction,NonPlated,1,{n},NPTH")
        lines.append("; #@! TF.GenerationSoftware,RouteAI,EDA,1.0")

        # Tool table (sorted by tool number)
        for tn in sorted(tools.keys()):
            tool = tools[tn]
            if self.units == "mm":
                lines.append(f"T{tn:02d}C{tool.diameter_mm:.3f}")
            else:
                diameter_inch = tool.diameter_mm / 25.4
                lines.append(f"T{tn:02d}C{diameter_inch:.4f}")

        lines.append("%")  # End header

        # Drill body: group hits by tool
        hits_by_tool: dict[int, list[DrillHit]] = {}
        for hit in hits:
            if hit.tool_number not in hits_by_tool:
                hits_by_tool[hit.tool_number] = []
            hits_by_tool[hit.tool_number].append(hit)

        for tn in sorted(hits_by_tool.keys()):
            lines.append(f"T{tn:02d}")
            for hit in hits_by_tool[tn]:
                if hit.is_slot:
                    # Routed slot: G85 command
                    lines.append(
                        f"X{_fmt_coord(hit.x)}Y{_fmt_coord(hit.y)}"
                        f"G85X{_fmt_coord(hit.slot_end_x)}Y{_fmt_coord(hit.slot_end_y)}"
                    )
                else:
                    lines.append(f"X{_fmt_coord(hit.x)}Y{_fmt_coord(hit.y)}")

        # Footer
        lines.append("T0")  # Unload tool
        lines.append("M30")  # End of program

        return "\n".join(lines) + "\n"

    def export(
        self,
        board: BoardDesign,
        output_dir: str,
    ) -> list[str]:
        """Export drill files in Excellon format.

        Generates separate files for plated and non-plated holes.

        Args:
            board: The board design to export.
            output_dir: Directory to write the drill files to.

        Returns:
            List of generated file paths.
        """
        os.makedirs(output_dir, exist_ok=True)
        generated_files: list[str] = []

        plated_hits, npth_hits = self._collect_drill_data(board)

        # Plated drill file
        if plated_hits:
            # Build simple tool table from hits
            tools: dict[int, DrillTool] = {}
            diameters_seen: dict[float, int] = {}
            tool_num = 1

            for via in board.vias:
                d = round(via.drill, 3)
                if d not in diameters_seen:
                    diameters_seen[d] = tool_num
                    tool_num += 1

            for pad in board.pads:
                if pad.is_through_hole:
                    d = round(pad.drill, 3)
                    if d not in diameters_seen:
                        diameters_seen[d] = tool_num
                        tool_num += 1

            for hole in board.drills:
                if hole.plated:
                    d = round(hole.diameter, 3)
                    if d not in diameters_seen:
                        diameters_seen[d] = tool_num
                        tool_num += 1

            # Rebuild hits with correct tool numbers
            rebuilt_hits: list[DrillHit] = []

            for via in board.vias:
                d = round(via.drill, 3)
                tn = diameters_seen[d]
                rebuilt_hits.append(DrillHit(x=via.x, y=via.y, tool_number=tn))

            for pad in board.pads:
                if pad.is_through_hole:
                    d = round(pad.drill, 3)
                    tn = diameters_seen[d]
                    rebuilt_hits.append(DrillHit(x=pad.x, y=pad.y, tool_number=tn))

            for hole in board.drills:
                if hole.plated:
                    d = round(hole.diameter, 3)
                    tn = diameters_seen[d]
                    rebuilt_hits.append(DrillHit(x=hole.x, y=hole.y, tool_number=tn))

            for d, tn in diameters_seen.items():
                count = sum(1 for h in rebuilt_hits if h.tool_number == tn)
                tools[tn] = DrillTool(number=tn, diameter_mm=d, plated=True, hit_count=count)

            content = self._write_excellon(rebuilt_hits, tools, plated=True)
            filepath = os.path.join(output_dir, f"{self.board_name}-PTH.drl")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            generated_files.append(filepath)

        # Non-plated drill file
        if npth_hits:
            tools = {}
            diameters_seen = {}
            tool_num = 1

            for hole in board.drills:
                if not hole.plated:
                    d = round(hole.diameter, 3)
                    if d not in diameters_seen:
                        diameters_seen[d] = tool_num
                        tool_num += 1

            rebuilt_hits = []
            for hole in board.drills:
                if not hole.plated:
                    d = round(hole.diameter, 3)
                    tn = diameters_seen[d]
                    rebuilt_hits.append(DrillHit(x=hole.x, y=hole.y, tool_number=tn))

            for d, tn in diameters_seen.items():
                count = sum(1 for h in rebuilt_hits if h.tool_number == tn)
                tools[tn] = DrillTool(number=tn, diameter_mm=d, plated=False, hit_count=count)

            content = self._write_excellon(rebuilt_hits, tools, plated=False)
            filepath = os.path.join(output_dir, f"{self.board_name}-NPTH.drl")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            generated_files.append(filepath)

        return generated_files
