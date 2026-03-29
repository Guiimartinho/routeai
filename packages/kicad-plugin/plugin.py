"""
Main RouteAI KiCad Action Plugin.

Provides the ActionPlugin subclass that KiCad loads, along with all
orchestration logic: project packaging, API communication, progress
reporting, and result visualisation.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger("routeai.plugin")

# ---------------------------------------------------------------------------
# Conditional imports -- allow the module to be loaded outside KiCad
# ---------------------------------------------------------------------------
try:
    import pcbnew

    PCBNEW_AVAILABLE = True
except ImportError:
    pcbnew = None  # type: ignore[assignment]
    PCBNEW_AVAILABLE = False

try:
    import wx
except ImportError:
    wx = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Stub base class so the file is importable even without pcbnew
# ---------------------------------------------------------------------------
if PCBNEW_AVAILABLE:
    _ActionPluginBase = pcbnew.ActionPlugin
else:

    class _ActionPluginBase:  # type: ignore[no-redef]
        """Fallback base when pcbnew is unavailable (testing only)."""

        def register(self) -> None:
            pass

        def defaults(self) -> None:
            pass

        def Run(self) -> None:
            pass


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_KICAD_EXTENSIONS = {
    ".kicad_pcb",
    ".kicad_sch",
    ".kicad_pro",
    ".kicad_dru",
    ".kicad_wks",
    ".kicad_sym",
    ".kicad_mod",
    ".net",
    ".csv",
}

_PLUGIN_ICON_XPM = None  # Will be set to an XPM string if an icon file exists


def _locate_icon() -> Optional[str]:
    """Return the path to the plugin icon, or *None*."""
    here = Path(__file__).resolve().parent
    for name in ("icon.png", "icon.svg", "icon.xpm"):
        candidate = here / name
        if candidate.exists():
            return str(candidate)
    return None


# ---------------------------------------------------------------------------
# Plugin class
# ---------------------------------------------------------------------------


class RouteAIPlugin(_ActionPluginBase):
    """KiCad Action Plugin entry-point for RouteAI Design Review."""

    # ---- registration metadata -------------------------------------------

    def defaults(self) -> None:
        self.name = "RouteAI Design Review"
        self.category = "Design Review"
        self.description = (
            "AI-powered PCB design review and analysis. "
            "Packages your KiCad project files, sends them to the RouteAI "
            "cloud service for review, and annotates the board with findings."
        )
        icon_path = _locate_icon()
        if icon_path:
            self.icon_file_name = icon_path
        self.show_toolbar_button = True

    # ---- main entry point ------------------------------------------------

    def Run(self) -> None:  # noqa: N802 – KiCad convention
        """Called by KiCad when the user clicks the plugin button/menu item."""
        if not PCBNEW_AVAILABLE:
            logger.error("RouteAI plugin requires pcbnew – aborting.")
            return

        board = pcbnew.GetBoard()
        if board is None:
            self._show_error("No board is currently open.")
            return

        board_path = board.GetFileName()
        if not board_path:
            self._show_error("Please save the board before running a review.")
            return

        project_dir = Path(board_path).parent

        # -- ensure user is authenticated ----------------------------------
        from .api_client import RouteAIClient
        from .dialogs import LoginDialog, SettingsDialog

        settings = self._load_settings()
        client = RouteAIClient(base_url=settings.get("api_url", "https://api.routeai.com"))

        if not client.has_token():
            dlg = LoginDialog(None, client)
            result = dlg.ShowModal()
            dlg.Destroy()
            if result != wx.ID_OK:
                return  # user cancelled

        # -- package project -----------------------------------------------
        try:
            zip_path = self._package_project(project_dir)
        except Exception as exc:
            self._show_error(f"Failed to package project:\n{exc}")
            return

        # -- upload & review in a background thread with progress ----------
        from .dialogs import ProgressDialog

        progress = ProgressDialog(None, "RouteAI Design Review")
        progress.set_status("Uploading project...")
        progress.set_progress(10)
        progress.Show()

        # We use a simple shared dict to communicate between threads.
        state: dict = {"error": None, "results": None, "cancelled": False}

        def _background() -> None:
            try:
                progress.call_later(lambda: progress.set_status("Uploading project..."))
                progress.call_later(lambda: progress.set_progress(20))
                project_id = client.upload_project(zip_path)

                progress.call_later(lambda: progress.set_status("Starting review..."))
                progress.call_later(lambda: progress.set_progress(30))
                review_id = client.start_review(project_id)

                def _on_poll(pct: int, msg: str) -> bool:
                    progress.call_later(lambda: progress.set_status(msg))
                    progress.call_later(lambda: progress.set_progress(30 + int(pct * 0.6)))
                    return not state["cancelled"]

                results = client.poll_until_complete(review_id, _on_poll)
                state["results"] = results
            except Exception as exc:
                state["error"] = str(exc)
            finally:
                progress.call_later(lambda: progress.EndModal(wx.ID_OK))

        worker = threading.Thread(target=_background, daemon=True)
        worker.start()

        modal_result = progress.ShowModal()
        progress.Destroy()

        # Clean up temp zip
        try:
            os.unlink(zip_path)
        except OSError:
            pass

        if progress.was_cancelled():
            state["cancelled"] = True
            return

        if state["error"]:
            self._show_error(f"Review failed:\n{state['error']}")
            return

        results = state["results"]
        if not results:
            self._show_info("Review completed with no findings.")
            return

        # -- display results -----------------------------------------------
        from .annotations import BoardAnnotator
        from .dialogs import ResultsDialog

        annotator = BoardAnnotator(board)
        annotator.clear()
        annotator.annotate(results)
        pcbnew.Refresh()

        dlg = ResultsDialog(None, results, board)
        dlg.ShowModal()
        dlg.Destroy()

    # ---- helpers ---------------------------------------------------------

    @staticmethod
    def _package_project(project_dir: Path) -> str:
        """Zip all KiCad-relevant files in *project_dir* and return the zip path."""
        tmp = tempfile.NamedTemporaryFile(
            prefix="routeai_", suffix=".zip", delete=False
        )
        tmp_path = tmp.name
        tmp.close()

        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _dirs, files in os.walk(project_dir):
                for fname in files:
                    fpath = Path(root) / fname
                    if fpath.suffix.lower() in _KICAD_EXTENSIONS:
                        arcname = str(fpath.relative_to(project_dir))
                        zf.write(str(fpath), arcname)

        return tmp_path

    @staticmethod
    def _show_error(message: str) -> None:
        if wx:
            wx.MessageBox(message, "RouteAI - Error", wx.OK | wx.ICON_ERROR)
        else:
            logger.error(message)

    @staticmethod
    def _show_info(message: str) -> None:
        if wx:
            wx.MessageBox(message, "RouteAI", wx.OK | wx.ICON_INFORMATION)
        else:
            logger.info(message)

    @staticmethod
    def _load_settings() -> dict:
        """Load persisted settings from the plugin config file."""
        import json

        settings_path = Path(__file__).resolve().parent / "settings.json"
        if settings_path.exists():
            try:
                return json.loads(settings_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    @staticmethod
    def _save_settings(settings: dict) -> None:
        import json

        settings_path = Path(__file__).resolve().parent / "settings.json"
        settings_path.write_text(
            json.dumps(settings, indent=2), encoding="utf-8"
        )
