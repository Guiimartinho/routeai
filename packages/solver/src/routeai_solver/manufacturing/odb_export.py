"""ODB++ format exporter for PCB manufacturing.

Generates ODB++ v8.1 compatible output packaged as a .tgz archive.
ODB++ is an open data exchange format used by PCB manufacturers for
CAM processing, providing a comprehensive single-archive representation
of the complete PCB fabrication dataset.

Structure generated:
    odb/
        matrix/matrix          -- Layer stack definition
        misc/info              -- Job information
        steps/pcb/
            profile            -- Board outline
            layers/<name>/features  -- Per-layer feature files
            netlists/cadnet/netlist -- Netlist data
"""

from __future__ import annotations

import io
import os
import math
import tarfile
import time
from pathlib import Path
from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    LayerType,
    Pad,
    PadShape,
    Trace,
    TraceSegment,
    Via,
)


# ---------------------------------------------------------------------------
# ODB++ feature formatting helpers
# ---------------------------------------------------------------------------

def _fmt(value_mm: float) -> str:
    """Format a coordinate/dimension in ODB++ units (inches, 6 decimal places).

    ODB++ uses inches internally. Convert from mm.
    """
    inches = value_mm / 25.4
    return f"{inches:.6f}"


def _fmt_mm(value_mm: float) -> str:
    """Format a value keeping mm with 6 decimal places."""
    return f"{value_mm:.6f}"


def _odb_timestamp() -> str:
    """Generate an ODB++ compatible timestamp."""
    return time.strftime("%Y%m%d.%H%M%S")


# ---------------------------------------------------------------------------
# Layer type mapping
# ---------------------------------------------------------------------------

_LAYER_TYPE_MAP: dict[str, tuple[str, str, str]] = {
    # name -> (type, context, polarity)
    "F.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "B.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In1.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In2.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In3.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In4.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In5.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "In6.Cu": ("SIGNAL", "BOARD", "POSITIVE"),
    "F.Mask": ("SOLDER_MASK", "BOARD", "POSITIVE"),
    "B.Mask": ("SOLDER_MASK", "BOARD", "POSITIVE"),
    "F.SilkS": ("SILK_SCREEN", "BOARD", "POSITIVE"),
    "B.SilkS": ("SILK_SCREEN", "BOARD", "POSITIVE"),
    "F.Paste": ("SOLDER_PASTE", "BOARD", "POSITIVE"),
    "B.Paste": ("SOLDER_PASTE", "BOARD", "POSITIVE"),
    "Edge.Cuts": ("BOARD", "BOARD", "POSITIVE"),
}

_LAYER_SIDE_MAP: dict[str, str] = {
    "F.Cu": "TOP",
    "B.Cu": "BOTTOM",
    "In1.Cu": "INNER",
    "In2.Cu": "INNER",
    "In3.Cu": "INNER",
    "In4.Cu": "INNER",
    "In5.Cu": "INNER",
    "In6.Cu": "INNER",
    "F.Mask": "TOP",
    "B.Mask": "BOTTOM",
    "F.SilkS": "TOP",
    "B.SilkS": "BOTTOM",
    "F.Paste": "TOP",
    "B.Paste": "BOTTOM",
    "Edge.Cuts": "NONE",
}


class ODBExporter:
    """Exports a board design to ODB++ v8.1 format.

    Generates the complete ODB++ directory structure and packages it
    as a .tgz file suitable for import into CAM software.

    Usage::

        exporter = ODBExporter()
        tgz_path = exporter.export(board, "/output/dir")
    """

    def __init__(self, job_name: str = "routeai_board") -> None:
        self.job_name = job_name

    def export(self, board: BoardDesign, output_dir: str | Path) -> str:
        """Export the board design to an ODB++ .tgz archive.

        Args:
            board: The board design to export.
            output_dir: Directory where the .tgz file will be written.

        Returns:
            Path to the generated .tgz file.
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        tgz_path = output_dir / f"{self.job_name}.tgz"

        with tarfile.open(tgz_path, "w:gz") as tar:
            # Determine which layers to export
            export_layers = self._determine_layers(board)

            # matrix/matrix
            matrix_content = self._generate_matrix(board, export_layers)
            self._add_text_to_tar(tar, "odb/matrix/matrix", matrix_content)

            # misc/info
            info_content = self._generate_info(board)
            self._add_text_to_tar(tar, "odb/misc/info", info_content)

            # steps/pcb/profile
            profile_content = self._generate_profile(board)
            self._add_text_to_tar(tar, "odb/steps/pcb/profile", profile_content)

            # Per-layer features
            for layer_name in export_layers:
                features_content = self._generate_layer_features(board, layer_name)
                safe_name = layer_name.replace(".", "_").lower()
                self._add_text_to_tar(
                    tar,
                    f"odb/steps/pcb/layers/{safe_name}/features",
                    features_content,
                )

            # Netlist
            netlist_content = self._generate_netlist(board)
            self._add_text_to_tar(
                tar,
                "odb/steps/pcb/netlists/cadnet/netlist",
                netlist_content,
            )

        return str(tgz_path)

    # ------------------------------------------------------------------
    # Layer determination
    # ------------------------------------------------------------------

    def _determine_layers(self, board: BoardDesign) -> list[str]:
        """Determine which layers to include in the export."""
        layers: list[str] = []

        # Copper layers
        for layer in board.layers:
            if layer.layer_type == LayerType.COPPER:
                layers.append(layer.name)

        # Mask, silk, paste
        has_front = any(l.name == "F.Cu" for l in board.layers)
        has_back = any(l.name == "B.Cu" for l in board.layers)

        if has_front:
            layers.extend(["F.Mask", "F.SilkS", "F.Paste"])
        if has_back:
            layers.extend(["B.Mask", "B.SilkS", "B.Paste"])

        # Board outline
        if board.outline is not None:
            layers.append("Edge.Cuts")

        return layers

    # ------------------------------------------------------------------
    # Matrix file
    # ------------------------------------------------------------------

    def _generate_matrix(
        self, board: BoardDesign, export_layers: list[str]
    ) -> str:
        """Generate the matrix/matrix file defining the layer stack."""
        lines: list[str] = []
        lines.append("UNITS=MM")
        lines.append("")

        for row, layer_name in enumerate(export_layers):
            layer_info = _LAYER_TYPE_MAP.get(layer_name, ("SIGNAL", "BOARD", "POSITIVE"))
            layer_type, context, polarity = layer_info
            side = _LAYER_SIDE_MAP.get(layer_name, "NONE")
            safe_name = layer_name.replace(".", "_").lower()

            lines.append(f"STEP {{")
            lines.append(f"   COL={safe_name}")
            lines.append(f"   ROW={row}")
            lines.append(f"   CONTEXT={context}")
            lines.append(f"   TYPE={layer_type}")
            lines.append(f"   POLARITY={polarity}")
            lines.append(f"   SIDE={side}")
            lines.append(f"   NAME={safe_name}")
            lines.append(f"}}")
            lines.append("")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Info file
    # ------------------------------------------------------------------

    def _generate_info(self, board: BoardDesign) -> str:
        """Generate the misc/info file with job metadata."""
        lines: list[str] = []
        lines.append("UNITS=MM")
        lines.append(f"JOB_NAME={self.job_name}")
        lines.append(f"ODB_VERSION_MAJOR=8")
        lines.append(f"ODB_VERSION_MINOR=1")
        lines.append(f"CREATION_DATE={_odb_timestamp()}")
        lines.append(f"SAVE_DATE={_odb_timestamp()}")
        lines.append(f"SAVE_APP=RouteAI EDA")
        lines.append(f"SAVE_USER=routeai")
        lines.append(f"MAX_UID=0")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Profile (board outline)
    # ------------------------------------------------------------------

    def _generate_profile(self, board: BoardDesign) -> str:
        """Generate the steps/pcb/profile file (board outline)."""
        lines: list[str] = []
        lines.append("UNITS=MM")
        lines.append("")

        if board.outline is not None and not board.outline.is_empty:
            coords = list(board.outline.exterior.coords)
            if len(coords) >= 3:
                lines.append("OB")
                for i, (x, y) in enumerate(coords):
                    if i == 0:
                        lines.append(f"OS {_fmt_mm(x)} {_fmt_mm(y)}")
                    else:
                        lines.append(f"OC {_fmt_mm(x)} {_fmt_mm(y)}")
                # Close
                lines.append(f"OC {_fmt_mm(coords[0][0])} {_fmt_mm(coords[0][1])}")
                lines.append("OE")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Layer features
    # ------------------------------------------------------------------

    def _generate_layer_features(
        self, board: BoardDesign, layer_name: str
    ) -> str:
        """Generate the features file for a single layer.

        ODB++ features format includes:
        - Symbol definitions (apertures)
        - Pad records
        - Line records
        - Arc records
        - Surface records (fills)
        """
        lines: list[str] = []
        lines.append("UNITS=MM")
        lines.append("")

        # Symbol (aperture) definitions section
        symbols: list[str] = []
        symbol_map: dict[str, int] = {}

        def get_symbol(sym_def: str) -> int:
            """Get or create a symbol index for the given definition."""
            if sym_def in symbol_map:
                return symbol_map[sym_def]
            idx = len(symbols)
            symbols.append(sym_def)
            symbol_map[sym_def] = idx
            return idx

        # Collect features
        feature_lines: list[str] = []

        # Find the Layer object
        layer_obj = None
        for l in board.layers:
            if l.name == layer_name:
                layer_obj = l
                break

        if layer_obj is not None and layer_obj.layer_type == LayerType.COPPER:
            # Traces
            for trace in board.traces_on_layer(layer_obj):
                for seg in trace.segments:
                    sym_def = f"r{_fmt_mm(seg.width)}"
                    sym_idx = get_symbol(sym_def)
                    feature_lines.append(
                        f"L {_fmt_mm(seg.start_x)} {_fmt_mm(seg.start_y)} "
                        f"{_fmt_mm(seg.end_x)} {_fmt_mm(seg.end_y)} "
                        f"{sym_idx} P 0 ;NET={trace.net.name}"
                    )

            # Pads
            for pad in board.pads_on_layer(layer_obj):
                if pad.shape == PadShape.CIRCLE:
                    sym_def = f"r{_fmt_mm(pad.width)}"
                elif pad.shape == PadShape.RECT:
                    sym_def = f"rect{_fmt_mm(pad.width)}x{_fmt_mm(pad.height)}"
                elif pad.shape == PadShape.OVAL:
                    sym_def = f"oval{_fmt_mm(pad.width)}x{_fmt_mm(pad.height)}"
                elif pad.shape == PadShape.ROUNDRECT:
                    cr = pad.corner_radius_ratio * min(pad.width, pad.height) / 2.0
                    sym_def = (
                        f"rect{_fmt_mm(pad.width)}x{_fmt_mm(pad.height)}"
                        f"xr{_fmt_mm(cr)}"
                    )
                else:
                    sym_def = f"r{_fmt_mm(pad.width)}"

                sym_idx = get_symbol(sym_def)
                rot = pad.rotation if pad.rotation != 0 else 0
                feature_lines.append(
                    f"P {_fmt_mm(pad.x)} {_fmt_mm(pad.y)} "
                    f"{sym_idx} P 0 ;NET={pad.net.name}"
                    f",REF={pad.component_ref},PIN={pad.pad_number}"
                )

            # Vias on this layer
            for via in board.vias:
                if (via.start_layer == layer_obj or via.end_layer == layer_obj
                        or via.start_layer.name == layer_name
                        or via.end_layer.name == layer_name):
                    sym_def = f"r{_fmt_mm(via.diameter)}"
                    sym_idx = get_symbol(sym_def)
                    feature_lines.append(
                        f"P {_fmt_mm(via.x)} {_fmt_mm(via.y)} "
                        f"{sym_idx} P 0 ;NET={via.net.name},VIA=Y"
                    )

            # Zones (copper fills) as surfaces
            for zone in board.zones:
                if zone.layer == layer_obj or zone.layer.name == layer_name:
                    poly = zone.to_shapely()
                    if poly.is_empty:
                        continue
                    polys = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
                    for single_poly in polys:
                        if single_poly.is_empty:
                            continue
                        coords = list(single_poly.exterior.coords)
                        if len(coords) < 3:
                            continue
                        feature_lines.append(f"S P 0 ;NET={zone.net.name}")
                        feature_lines.append(f"OB")
                        for idx_c, (cx, cy) in enumerate(coords):
                            if idx_c == 0:
                                feature_lines.append(f"OS {_fmt_mm(cx)} {_fmt_mm(cy)}")
                            else:
                                feature_lines.append(f"OC {_fmt_mm(cx)} {_fmt_mm(cy)}")
                        feature_lines.append(f"OE")
                        feature_lines.append(f"SE")

        elif layer_name.endswith(".Mask"):
            # Solder mask: openings around pads
            is_front = layer_name.startswith("F.")
            copper_name = "F.Cu" if is_front else "B.Cu"
            expansion = board.design_rules.solder_mask_expansion

            for pad in board.pads:
                if pad.layer.name != copper_name:
                    continue
                w = pad.width + 2 * expansion
                h = pad.height + 2 * expansion
                if pad.shape == PadShape.CIRCLE:
                    sym_def = f"r{_fmt_mm(w)}"
                else:
                    sym_def = f"rect{_fmt_mm(w)}x{_fmt_mm(h)}"
                sym_idx = get_symbol(sym_def)
                feature_lines.append(
                    f"P {_fmt_mm(pad.x)} {_fmt_mm(pad.y)} "
                    f"{sym_idx} P 0"
                )

            for via in board.vias:
                w = via.diameter + 2 * expansion
                sym_def = f"r{_fmt_mm(w)}"
                sym_idx = get_symbol(sym_def)
                feature_lines.append(
                    f"P {_fmt_mm(via.x)} {_fmt_mm(via.y)} "
                    f"{sym_idx} P 0"
                )

        elif layer_name.endswith(".Paste"):
            # Solder paste: SMD pads only
            is_front = layer_name.startswith("F.")
            copper_name = "F.Cu" if is_front else "B.Cu"

            for pad in board.pads:
                if pad.layer.name != copper_name or pad.is_through_hole:
                    continue
                shrink = 0.05
                w = max(0.1, pad.width - 2 * shrink)
                h = max(0.1, pad.height - 2 * shrink)
                if pad.shape == PadShape.CIRCLE:
                    sym_def = f"r{_fmt_mm(w)}"
                else:
                    sym_def = f"rect{_fmt_mm(w)}x{_fmt_mm(h)}"
                sym_idx = get_symbol(sym_def)
                feature_lines.append(
                    f"P {_fmt_mm(pad.x)} {_fmt_mm(pad.y)} "
                    f"{sym_idx} P 0"
                )

        elif layer_name == "Edge.Cuts":
            # Board outline
            if board.outline is not None and not board.outline.is_empty:
                sym_def = "r0.050000"
                sym_idx = get_symbol(sym_def)
                coords = list(board.outline.exterior.coords)
                for i in range(len(coords) - 1):
                    x1, y1 = coords[i]
                    x2, y2 = coords[i + 1]
                    feature_lines.append(
                        f"L {_fmt_mm(x1)} {_fmt_mm(y1)} "
                        f"{_fmt_mm(x2)} {_fmt_mm(y2)} "
                        f"{sym_idx} P 0"
                    )

        elif layer_name.endswith(".SilkS"):
            # Silkscreen: component outlines and text
            # Render as thin lines -- actual data would come from the board model
            sym_def = "r0.150000"
            sym_idx = get_symbol(sym_def)
            # Placeholder: silkscreen data would come from component courtyard/fab
            pass

        # Write symbol definitions
        lines.append("#")
        lines.append("# Symbol definitions")
        lines.append("#")
        for idx_s, sym_def in enumerate(symbols):
            lines.append(f"$0 {sym_def}")

        lines.append("")
        lines.append("#")
        lines.append("# Features")
        lines.append("#")
        lines.extend(feature_lines)

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Netlist
    # ------------------------------------------------------------------

    def _generate_netlist(self, board: BoardDesign) -> str:
        """Generate the netlist file."""
        lines: list[str] = []
        lines.append("H optimize n staggered n")
        lines.append("")

        for net in board.nets:
            if not net.name:
                continue

            lines.append(f"$0 {net.name}")

            # Find all pads in this net
            for pad in board.pads:
                if pad.net == net:
                    ref = pad.component_ref or "?"
                    lines.append(f"  P {ref} {pad.pad_number}")

            # Find all vias in this net
            for via in board.vias:
                if via.net == net:
                    lines.append(f"  V {_fmt_mm(via.x)} {_fmt_mm(via.y)}")

            lines.append("")

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Tar helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _add_text_to_tar(
        tar: tarfile.TarFile, arcname: str, content: str
    ) -> None:
        """Add a text file to the tar archive."""
        data = content.encode("utf-8")
        info = tarfile.TarInfo(name=arcname)
        info.size = len(data)
        info.mtime = int(time.time())
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(data))
