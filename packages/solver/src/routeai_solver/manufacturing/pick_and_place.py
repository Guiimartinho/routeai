"""Pick-and-place file exporter for SMT assembly.

Generates component placement files in CSV format for use by
automated pick-and-place machines. Includes position, rotation,
and side information for each component.
"""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass

from routeai_solver.board_model import BoardDesign, Pad

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class PlacementEntry:
    """A single component placement for pick-and-place."""

    reference: str  # e.g., "U1"
    value: str  # e.g., "STM32F405"
    package: str  # footprint name
    pos_x_mm: float  # center X position in mm
    pos_y_mm: float  # center Y position in mm
    rotation_deg: float  # rotation in degrees (0-360)
    side: str  # "top" or "bottom"


# ---------------------------------------------------------------------------
# Pick-and-Place Exporter
# ---------------------------------------------------------------------------

class PickAndPlaceExporter:
    """Exports component placement data for pick-and-place assembly.

    Generates a CSV file with reference, value, package, position,
    rotation, and side for each SMD component. Through-hole components
    are optionally included with a flag.

    Args:
        include_through_hole: Whether to include TH components.
        include_dnp: Whether to include DNP-marked components.
        board_name: Name for file header.
    """

    def __init__(
        self,
        include_through_hole: bool = False,
        include_dnp: bool = False,
        board_name: str = "RouteAI_Board",
    ) -> None:
        self.include_through_hole = include_through_hole
        self.include_dnp = include_dnp
        self.board_name = board_name

    def _collect_placements(
        self, board: BoardDesign
    ) -> list[PlacementEntry]:
        """Collect component placement data from the board.

        Determines component center position by averaging the positions
        of all pads belonging to each component.
        """
        # Group pads by component reference
        components: dict[str, list[Pad]] = {}
        for pad in board.pads:
            ref = pad.component_ref
            if not ref:
                continue
            if ref not in components:
                components[ref] = []
            components[ref].append(pad)

        placements: list[PlacementEntry] = []

        for ref, pads in sorted(components.items()):
            if not pads:
                continue

            # Determine if this is SMD or through-hole
            has_th = any(p.is_through_hole for p in pads)
            is_smd = not has_th

            if has_th and not self.include_through_hole:
                continue

            # Calculate component center (average of pad positions)
            sum_x = sum(p.x for p in pads)
            sum_y = sum(p.y for p in pads)
            center_x = sum_x / len(pads)
            center_y = sum_y / len(pads)

            # Determine side from the first pad's layer
            first_layer = pads[0].layer.name
            if "B." in first_layer or "Bot" in first_layer or "bottom" in first_layer.lower():
                side = "bottom"
            else:
                side = "top"

            # Get rotation from the first pad (assume all pads share
            # the component rotation)
            rotation = pads[0].rotation

            # Determine value and package from pad properties
            # In a real design, these come from the schematic; here we
            # derive what we can from the pad data.
            value = ""
            package = ""

            # Use pad count and size to guess package
            pad_count = len(pads)
            avg_width = sum(p.width for p in pads) / len(pads)

            if pad_count == 2 and avg_width < 1.0:
                # Likely a passive (resistor, capacitor)
                # Estimate package from pad spacing
                dx = abs(pads[0].x - pads[1].x) if len(pads) >= 2 else 0
                dy = abs(pads[0].y - pads[1].y) if len(pads) >= 2 else 0
                spacing = max(dx, dy)
                if spacing < 1.0:
                    package = "0402"
                elif spacing < 1.8:
                    package = "0603"
                elif spacing < 2.5:
                    package = "0805"
                else:
                    package = "1206"

                if ref.startswith("R"):
                    value = "resistor"
                elif ref.startswith("C"):
                    value = "capacitor"
                elif ref.startswith("L"):
                    value = "inductor"
            else:
                package = f"{pad_count}-pin"

            placements.append(PlacementEntry(
                reference=ref,
                value=value,
                package=package,
                pos_x_mm=round(center_x, 4),
                pos_y_mm=round(center_y, 4),
                rotation_deg=round(rotation % 360.0, 2),
                side=side,
            ))

        return placements

    def export(
        self,
        board: BoardDesign,
        filepath: str,
    ) -> str:
        """Export pick-and-place data to CSV file.

        Format:
            Ref, Val, Package, PosX(mm), PosY(mm), Rot(deg), Side

        Separate sections for top and bottom components.

        Args:
            board: The board design to export.
            filepath: Output file path.

        Returns:
            The file path written.
        """
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)

        placements = self._collect_placements(board)

        # Separate top and bottom
        top_placements = [p for p in placements if p.side == "top"]
        bottom_placements = [p for p in placements if p.side == "bottom"]

        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)

            # Header
            writer.writerow([f"# Pick-and-Place file for {self.board_name}"])
            writer.writerow(["# Generated by RouteAI EDA"])
            writer.writerow(["# Units: mm, degrees"])
            writer.writerow([f"# Total components: {len(placements)}"])
            writer.writerow([f"# Top: {len(top_placements)}, Bottom: {len(bottom_placements)}"])
            writer.writerow([])

            # Column headers
            writer.writerow([
                "Ref",
                "Val",
                "Package",
                "PosX",
                "PosY",
                "Rot",
                "Side",
            ])

            # Top components
            if top_placements:
                writer.writerow(["# --- Top Side ---"])
                for p in sorted(top_placements, key=lambda x: x.reference):
                    writer.writerow([
                        p.reference,
                        p.value,
                        p.package,
                        f"{p.pos_x_mm:.4f}",
                        f"{p.pos_y_mm:.4f}",
                        f"{p.rotation_deg:.2f}",
                        p.side,
                    ])

            # Bottom components
            if bottom_placements:
                writer.writerow(["# --- Bottom Side ---"])
                for p in sorted(bottom_placements, key=lambda x: x.reference):
                    writer.writerow([
                        p.reference,
                        p.value,
                        p.package,
                        f"{p.pos_x_mm:.4f}",
                        f"{p.pos_y_mm:.4f}",
                        f"{p.rotation_deg:.2f}",
                        p.side,
                    ])

        return filepath
