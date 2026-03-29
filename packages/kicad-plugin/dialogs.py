"""
wxPython dialogs for the RouteAI KiCad plugin.

All dialogs are designed to work with the wxPython version bundled inside
KiCad 8.  When running outside KiCad (unit-tests, CLI), importing this
module will raise an ``ImportError`` for ``wx``.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

import wx
import wx.lib.scrolledpanel as scrolled

if TYPE_CHECKING:
    from .api_client import RouteAIClient

# ---------------------------------------------------------------------------
# Severity helpers
# ---------------------------------------------------------------------------

_SEVERITY_COLOURS: Dict[str, wx.Colour] = {}


def _severity_colour(severity: str) -> wx.Colour:
    """Return a colour for the given severity string."""
    if not _SEVERITY_COLOURS:
        _SEVERITY_COLOURS.update(
            {
                "critical": wx.Colour(220, 50, 50),
                "warning": wx.Colour(200, 170, 30),
                "info": wx.Colour(60, 120, 210),
            }
        )
    return _SEVERITY_COLOURS.get(severity, wx.Colour(128, 128, 128))


_SEVERITY_LABELS = {
    "critical": "CRITICAL",
    "warning": "WARNING",
    "info": "INFO",
}

# ---------------------------------------------------------------------------
# LoginDialog
# ---------------------------------------------------------------------------


class LoginDialog(wx.Dialog):
    """
    Simple email + password login dialog.

    On successful login the dialog closes with ``wx.ID_OK``.
    """

    def __init__(self, parent: Optional[wx.Window], client: "RouteAIClient") -> None:
        super().__init__(
            parent,
            title="RouteAI - Login",
            size=(380, 260),
            style=wx.DEFAULT_DIALOG_STYLE,
        )
        self._client = client
        self._build_ui()
        self.CentreOnScreen()

    def _build_ui(self) -> None:
        panel = wx.Panel(self)
        vbox = wx.BoxSizer(wx.VERTICAL)

        # -- header --------------------------------------------------------
        header = wx.StaticText(panel, label="Sign in to RouteAI")
        header_font = header.GetFont()
        header_font.SetPointSize(header_font.GetPointSize() + 2)
        header_font.SetWeight(wx.FONTWEIGHT_BOLD)
        header.SetFont(header_font)
        vbox.Add(header, 0, wx.ALL | wx.ALIGN_CENTER_HORIZONTAL, 12)

        # -- email ---------------------------------------------------------
        vbox.Add(wx.StaticText(panel, label="Email:"), 0, wx.LEFT | wx.TOP, 12)
        self._email = wx.TextCtrl(panel, size=(340, -1))
        vbox.Add(self._email, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

        # -- password ------------------------------------------------------
        vbox.Add(wx.StaticText(panel, label="Password:"), 0, wx.LEFT, 12)
        self._password = wx.TextCtrl(panel, size=(340, -1), style=wx.TE_PASSWORD)
        vbox.Add(self._password, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

        # -- remember me ---------------------------------------------------
        self._remember = wx.CheckBox(panel, label="Remember me")
        self._remember.SetValue(True)
        vbox.Add(self._remember, 0, wx.LEFT | wx.BOTTOM, 12)

        # -- buttons -------------------------------------------------------
        btn_sizer = wx.StdDialogButtonSizer()
        self._login_btn = wx.Button(panel, wx.ID_OK, "Login")
        self._login_btn.Bind(wx.EVT_BUTTON, self._on_login)
        btn_sizer.AddButton(self._login_btn)
        cancel_btn = wx.Button(panel, wx.ID_CANCEL, "Cancel")
        btn_sizer.AddButton(cancel_btn)
        btn_sizer.Realize()
        vbox.Add(btn_sizer, 0, wx.ALIGN_CENTER_HORIZONTAL | wx.ALL, 12)

        # -- status --------------------------------------------------------
        self._status = wx.StaticText(panel, label="")
        self._status.SetForegroundColour(wx.Colour(200, 50, 50))
        vbox.Add(self._status, 0, wx.LEFT | wx.BOTTOM, 12)

        panel.SetSizer(vbox)

    def _on_login(self, _event: wx.CommandEvent) -> None:
        email = self._email.GetValue().strip()
        password = self._password.GetValue()
        if not email or not password:
            self._status.SetLabel("Please enter email and password.")
            return

        self._login_btn.Disable()
        self._status.SetLabel("Logging in...")

        def _do_login() -> None:
            try:
                self._client.login(email, password)
                wx.CallAfter(self._on_login_success)
            except Exception as exc:
                wx.CallAfter(self._on_login_error, str(exc))

        threading.Thread(target=_do_login, daemon=True).start()

    def _on_login_success(self) -> None:
        self.EndModal(wx.ID_OK)

    def _on_login_error(self, message: str) -> None:
        self._login_btn.Enable()
        self._status.SetLabel(message[:120])


# ---------------------------------------------------------------------------
# ProgressDialog
# ---------------------------------------------------------------------------


class ProgressDialog(wx.Dialog):
    """
    Non-modal-looking progress dialog with a gauge and cancel button.
    """

    def __init__(self, parent: Optional[wx.Window], title: str = "RouteAI") -> None:
        super().__init__(
            parent,
            title=title,
            size=(420, 170),
            style=wx.DEFAULT_DIALOG_STYLE,
        )
        self._cancelled = False
        self._build_ui()
        self.CentreOnScreen()

    def _build_ui(self) -> None:
        panel = wx.Panel(self)
        vbox = wx.BoxSizer(wx.VERTICAL)

        self._status_text = wx.StaticText(panel, label="Initialising...")
        vbox.Add(self._status_text, 0, wx.ALL, 12)

        self._gauge = wx.Gauge(panel, range=100, size=(380, 24))
        vbox.Add(self._gauge, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

        cancel_btn = wx.Button(panel, wx.ID_CANCEL, "Cancel")
        cancel_btn.Bind(wx.EVT_BUTTON, self._on_cancel)
        vbox.Add(cancel_btn, 0, wx.ALIGN_CENTER_HORIZONTAL | wx.BOTTOM, 12)

        panel.SetSizer(vbox)

    def set_status(self, text: str) -> None:
        """Update the status label (must be called on the GUI thread)."""
        if self._status_text:
            self._status_text.SetLabel(text)

    def set_progress(self, value: int) -> None:
        """Update the gauge (0-100). Must be called on the GUI thread."""
        self._gauge.SetValue(min(max(value, 0), 100))

    def was_cancelled(self) -> bool:
        return self._cancelled

    def call_later(self, func: Callable[[], Any]) -> None:
        """Schedule *func* to run on the GUI thread."""
        wx.CallAfter(func)

    def _on_cancel(self, _event: wx.CommandEvent) -> None:
        self._cancelled = True
        self.EndModal(wx.ID_CANCEL)


# ---------------------------------------------------------------------------
# ResultsDialog
# ---------------------------------------------------------------------------


class ResultsDialog(wx.Dialog):
    """
    Scrollable dialog listing all review findings.

    Double-clicking a finding navigates the KiCad board view to the relevant
    location.
    """

    def __init__(
        self,
        parent: Optional[wx.Window],
        findings: List[Dict[str, Any]],
        board: Any = None,
    ) -> None:
        super().__init__(
            parent,
            title="RouteAI - Review Results",
            size=(640, 500),
            style=wx.DEFAULT_DIALOG_STYLE | wx.RESIZE_BORDER,
        )
        self._findings = findings
        self._board = board
        self._build_ui()
        self.CentreOnScreen()

    def _build_ui(self) -> None:
        vbox = wx.BoxSizer(wx.VERTICAL)

        # -- summary -------------------------------------------------------
        counts = {"critical": 0, "warning": 0, "info": 0}
        for f in self._findings:
            sev = f.get("severity", "info")
            counts[sev] = counts.get(sev, 0) + 1

        summary = (
            f"Findings: {counts['critical']} critical, "
            f"{counts['warning']} warnings, {counts['info']} info"
        )
        summary_label = wx.StaticText(self, label=summary)
        summary_font = summary_label.GetFont()
        summary_font.SetWeight(wx.FONTWEIGHT_BOLD)
        summary_label.SetFont(summary_font)
        vbox.Add(summary_label, 0, wx.ALL, 10)

        # -- scrollable list -----------------------------------------------
        scroll = scrolled.ScrolledPanel(self, size=(-1, 380))
        scroll.SetupScrolling(scroll_x=False)
        sbox = wx.BoxSizer(wx.VERTICAL)

        for idx, finding in enumerate(self._findings):
            row = self._make_finding_row(scroll, idx, finding)
            sbox.Add(row, 0, wx.EXPAND | wx.LEFT | wx.RIGHT | wx.BOTTOM, 8)

        scroll.SetSizer(sbox)
        vbox.Add(scroll, 1, wx.EXPAND | wx.LEFT | wx.RIGHT, 6)

        # -- close button --------------------------------------------------
        close_btn = wx.Button(self, wx.ID_CLOSE, "Close")
        close_btn.Bind(wx.EVT_BUTTON, lambda _e: self.EndModal(wx.ID_CLOSE))
        vbox.Add(close_btn, 0, wx.ALIGN_CENTER_HORIZONTAL | wx.ALL, 10)

        self.SetSizer(vbox)

    def _make_finding_row(
        self, parent: wx.Window, idx: int, finding: Dict[str, Any]
    ) -> wx.Sizer:
        hbox = wx.BoxSizer(wx.HORIZONTAL)

        severity = finding.get("severity", "info")
        colour = _severity_colour(severity)
        label_text = _SEVERITY_LABELS.get(severity, "INFO")

        # Severity badge
        badge = wx.StaticText(parent, label=f" {label_text} ")
        badge.SetBackgroundColour(colour)
        badge.SetForegroundColour(wx.WHITE)
        badge_font = badge.GetFont()
        badge_font.SetPointSize(badge_font.GetPointSize() - 1)
        badge_font.SetWeight(wx.FONTWEIGHT_BOLD)
        badge.SetFont(badge_font)
        hbox.Add(badge, 0, wx.RIGHT | wx.ALIGN_CENTER_VERTICAL, 8)

        # Title + description
        text_vbox = wx.BoxSizer(wx.VERTICAL)
        title = wx.StaticText(parent, label=finding.get("title", "(untitled)"))
        title_font = title.GetFont()
        title_font.SetWeight(wx.FONTWEIGHT_BOLD)
        title.SetFont(title_font)
        text_vbox.Add(title, 0)

        desc = finding.get("description", "")
        if desc:
            desc_label = wx.StaticText(parent, label=desc[:200])
            desc_label.Wrap(440)
            text_vbox.Add(desc_label, 0, wx.TOP, 2)

        component = finding.get("component", "")
        if component:
            comp_label = wx.StaticText(parent, label=f"Component: {component}")
            comp_label.SetForegroundColour(wx.Colour(100, 100, 100))
            text_vbox.Add(comp_label, 0, wx.TOP, 2)

        hbox.Add(text_vbox, 1, wx.EXPAND)

        # Navigate button
        loc = finding.get("location")
        if loc:
            nav_btn = wx.Button(parent, label="Go to", size=(56, 28))
            nav_btn.Bind(wx.EVT_BUTTON, lambda _e, l=loc: self._navigate_to(l))
            hbox.Add(nav_btn, 0, wx.ALIGN_CENTER_VERTICAL | wx.LEFT, 6)

        return hbox

    def _navigate_to(self, location: Dict[str, float]) -> None:
        """Centre the KiCad board view on the given mm coordinates."""
        try:
            import pcbnew

            x_nm = int(location.get("x", 0) * 1e6)
            y_nm = int(location.get("y", 0) * 1e6)
            pcbnew.FocusOnItem(pcbnew.VECTOR2I(x_nm, y_nm))
        except Exception:
            pass


# ---------------------------------------------------------------------------
# SettingsDialog
# ---------------------------------------------------------------------------


class SettingsDialog(wx.Dialog):
    """
    Plugin settings: API URL, auto-review toggle.
    """

    def __init__(
        self,
        parent: Optional[wx.Window],
        settings: Dict[str, Any],
        on_save: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        super().__init__(
            parent,
            title="RouteAI - Settings",
            size=(420, 220),
            style=wx.DEFAULT_DIALOG_STYLE,
        )
        self._settings = dict(settings)
        self._on_save = on_save
        self._build_ui()
        self.CentreOnScreen()

    def _build_ui(self) -> None:
        panel = wx.Panel(self)
        vbox = wx.BoxSizer(wx.VERTICAL)

        # -- API URL -------------------------------------------------------
        vbox.Add(wx.StaticText(panel, label="API URL:"), 0, wx.LEFT | wx.TOP, 12)
        self._api_url = wx.TextCtrl(panel, size=(380, -1))
        self._api_url.SetValue(
            self._settings.get("api_url", "https://api.routeai.com")
        )
        vbox.Add(self._api_url, 0, wx.LEFT | wx.RIGHT | wx.BOTTOM, 12)

        # -- auto-review ---------------------------------------------------
        self._auto_review = wx.CheckBox(panel, label="Auto-review on board save")
        self._auto_review.SetValue(self._settings.get("auto_review", False))
        vbox.Add(self._auto_review, 0, wx.LEFT | wx.BOTTOM, 12)

        # -- buttons -------------------------------------------------------
        btn_sizer = wx.StdDialogButtonSizer()
        save_btn = wx.Button(panel, wx.ID_OK, "Save")
        save_btn.Bind(wx.EVT_BUTTON, self._on_save_click)
        btn_sizer.AddButton(save_btn)
        cancel_btn = wx.Button(panel, wx.ID_CANCEL, "Cancel")
        btn_sizer.AddButton(cancel_btn)
        btn_sizer.Realize()
        vbox.Add(btn_sizer, 0, wx.ALIGN_CENTER_HORIZONTAL | wx.ALL, 12)

        panel.SetSizer(vbox)

    def _on_save_click(self, _event: wx.CommandEvent) -> None:
        self._settings["api_url"] = self._api_url.GetValue().strip()
        self._settings["auto_review"] = self._auto_review.GetValue()
        if self._on_save:
            self._on_save(self._settings)
        self.EndModal(wx.ID_OK)

    def get_settings(self) -> Dict[str, Any]:
        return dict(self._settings)
