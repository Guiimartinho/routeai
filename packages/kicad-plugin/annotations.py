"""
Board annotation helpers for the RouteAI KiCad plugin.

Draws colour-coded DRC-style markers and text annotations on the board to
visualise review findings.  All drawing objects are placed on the
``User.Comments`` layer and tagged with a group name so they can be
reliably cleaned up before the next review run.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("routeai.annotations")

# ---------------------------------------------------------------------------
# Conditional pcbnew import
# ---------------------------------------------------------------------------
try:
    import pcbnew

    PCBNEW_AVAILABLE = True
except ImportError:
    pcbnew = None  # type: ignore[assignment]
    PCBNEW_AVAILABLE = False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_GROUP_NAME = "RouteAI_Review"

# Severity -> RGBA as KiCad COLOR4D arguments (0.0-1.0)
_SEVERITY_COLORS: Dict[str, tuple] = {
    "critical": (0.86, 0.20, 0.20, 0.90),  # red
    "warning": (0.85, 0.68, 0.10, 0.90),  # yellow / amber
    "info": (0.24, 0.47, 0.82, 0.90),  # blue
}

# Marker cross-hair half-size in nanometres (1 mm)
_MARKER_SIZE_NM = 1_000_000

# Text height in nanometres (0.8 mm)
_TEXT_HEIGHT_NM = 800_000
_TEXT_WIDTH_NM = 800_000

# Offset of text from marker centre (1.5 mm right)
_TEXT_OFFSET_X_NM = 1_500_000
_TEXT_OFFSET_Y_NM = 0


def _mm_to_nm(mm: float) -> int:
    """Convert millimetres to KiCad internal nanometres."""
    return int(mm * 1_000_000)


# ---------------------------------------------------------------------------
# BoardAnnotator
# ---------------------------------------------------------------------------


class BoardAnnotator:
    """
    Add and remove RouteAI review annotations on a KiCad board.

    Usage::

        annotator = BoardAnnotator(board)
        annotator.clear()
        annotator.annotate(findings)
        pcbnew.Refresh()
    """

    def __init__(self, board: Any) -> None:
        if not PCBNEW_AVAILABLE:
            raise RuntimeError("BoardAnnotator requires the pcbnew module")
        self._board = board

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def clear(self) -> int:
        """
        Remove all previously-added RouteAI annotations from the board.

        Returns the number of items removed.
        """
        removed = 0

        # Strategy 1 -- try to find a PCB_GROUP named ``_GROUP_NAME`` and
        # delete all its children.
        group = self._find_group()
        if group is not None:
            for item in list(group.GetItems()):
                group.RemoveItem(item)
                self._board.Remove(item)
                removed += 1
            self._board.Remove(group)
            removed += 1
            return removed

        # Strategy 2 -- fall back to scanning all drawings for our tag in
        # the text content.  Slower but works if grouping wasn't available.
        to_remove = []
        for drawing in self._board.GetDrawings():
            if hasattr(drawing, "GetText"):
                txt = drawing.GetText()
                if txt and txt.startswith("[RouteAI]"):
                    to_remove.append(drawing)
        for item in to_remove:
            self._board.Remove(item)
            removed += 1

        return removed

    def annotate(self, findings: List[Dict[str, Any]]) -> int:
        """
        Draw markers and labels for each finding on the board.

        Returns the number of annotations created.
        """
        if not findings:
            return 0

        group = self._get_or_create_group()
        count = 0

        for finding in findings:
            location = finding.get("location")
            if not location:
                continue

            severity = finding.get("severity", "info")
            title = finding.get("title", "Issue")
            component = finding.get("component", "")

            x_nm = _mm_to_nm(float(location.get("x", 0)))
            y_nm = _mm_to_nm(float(location.get("y", 0)))

            # -- draw cross-hair marker ------------------------------------
            self._draw_marker(group, x_nm, y_nm, severity)
            count += 1

            # -- draw text label -------------------------------------------
            label = f"[RouteAI] {title}"
            if component:
                label += f" ({component})"
            self._draw_text(
                group,
                x_nm + _TEXT_OFFSET_X_NM,
                y_nm + _TEXT_OFFSET_Y_NM,
                label,
                severity,
            )
            count += 1

        return count

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _find_group(self) -> Optional[Any]:
        """Find an existing RouteAI group on the board, or ``None``."""
        try:
            for group in self._board.Groups():
                if group.GetName() == _GROUP_NAME:
                    return group
        except Exception:
            pass
        return None

    def _get_or_create_group(self) -> Any:
        """Return (and possibly create) the RouteAI annotation group."""
        group = self._find_group()
        if group is not None:
            return group
        try:
            group = pcbnew.PCB_GROUP(self._board)
            group.SetName(_GROUP_NAME)
            self._board.Add(group)
            return group
        except Exception:
            # If grouping is unsupported, return a no-op wrapper.
            return _NullGroup(self._board)

    def _user_layer(self) -> int:
        """Return the ``User.Comments`` layer id."""
        try:
            return pcbnew.User_Comments
        except AttributeError:
            # KiCad 7 constant name
            return pcbnew.Cmts_User  # type: ignore[attr-defined]

    def _color4d(self, severity: str) -> Any:
        """Return a ``COLOR4D`` for the given severity."""
        r, g, b, a = _SEVERITY_COLORS.get(severity, _SEVERITY_COLORS["info"])
        return pcbnew.COLOR4D(r, g, b, a)

    def _draw_marker(
        self, group: Any, x_nm: int, y_nm: int, severity: str
    ) -> None:
        """Draw two crossing lines at the specified position."""
        layer = self._user_layer()
        color = self._color4d(severity)
        half = _MARKER_SIZE_NM

        lines = [
            (x_nm - half, y_nm - half, x_nm + half, y_nm + half),
            (x_nm - half, y_nm + half, x_nm + half, y_nm - half),
        ]

        for x1, y1, x2, y2 in lines:
            seg = pcbnew.PCB_SHAPE(self._board)
            seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
            seg.SetStart(pcbnew.VECTOR2I(x1, y1))
            seg.SetEnd(pcbnew.VECTOR2I(x2, y2))
            seg.SetLayer(layer)
            seg.SetWidth(int(_MARKER_SIZE_NM * 0.15))
            try:
                seg.SetColor(color)
            except AttributeError:
                pass  # colour is best-effort
            self._board.Add(seg)
            try:
                group.AddItem(seg)
            except Exception:
                pass

        # Draw a circle around the cross
        circle = pcbnew.PCB_SHAPE(self._board)
        circle.SetShape(pcbnew.SHAPE_T_CIRCLE)
        circle.SetCenter(pcbnew.VECTOR2I(x_nm, y_nm))
        circle.SetEnd(pcbnew.VECTOR2I(x_nm + half, y_nm))
        circle.SetLayer(layer)
        circle.SetWidth(int(_MARKER_SIZE_NM * 0.12))
        try:
            circle.SetColor(color)
        except AttributeError:
            pass
        self._board.Add(circle)
        try:
            group.AddItem(circle)
        except Exception:
            pass

    def _draw_text(
        self,
        group: Any,
        x_nm: int,
        y_nm: int,
        text: str,
        severity: str,
    ) -> None:
        """Place a text annotation at the given position."""
        layer = self._user_layer()
        color = self._color4d(severity)

        txt = pcbnew.PCB_TEXT(self._board)
        txt.SetText(text)
        txt.SetPosition(pcbnew.VECTOR2I(x_nm, y_nm))
        txt.SetLayer(layer)
        txt.SetTextSize(pcbnew.VECTOR2I(_TEXT_WIDTH_NM, _TEXT_HEIGHT_NM))
        txt.SetTextThickness(int(_TEXT_HEIGHT_NM * 0.12))
        try:
            txt.SetColor(color)
        except AttributeError:
            pass
        try:
            txt.SetHorizJustify(pcbnew.GR_TEXT_H_ALIGN_LEFT)
            txt.SetVertJustify(pcbnew.GR_TEXT_V_ALIGN_CENTER)
        except AttributeError:
            pass
        self._board.Add(txt)
        try:
            group.AddItem(txt)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Fallback when grouping is not available
# ---------------------------------------------------------------------------


class _NullGroup:
    """Dummy group that just adds items directly to the board."""

    def __init__(self, board: Any) -> None:
        self._board = board

    def AddItem(self, item: Any) -> None:  # noqa: N802
        pass  # item is already on the board

    def GetItems(self) -> list:  # noqa: N802
        return []

    def GetName(self) -> str:  # noqa: N802
        return _GROUP_NAME
