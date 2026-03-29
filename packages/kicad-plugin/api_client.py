"""
RouteAI API client.

Handles authentication, project upload, review lifecycle, and polling.
All HTTP communication goes through :mod:`urllib` so the plugin has no
third-party dependencies beyond what KiCad ships.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("routeai.api_client")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
_DEFAULT_BASE_URL = "https://api.routeai.com"
_DEFAULT_TIMEOUT = 60  # seconds per HTTP request
_POLL_INTERVAL = 3  # seconds between status polls
_MAX_POLL_TIME = 600  # 10 minutes total
_MAX_RETRIES = 3
_RETRY_BACKOFF = 2.0  # exponential back-off multiplier

_TOKEN_FILE = Path(__file__).resolve().parent / ".auth_token"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class RouteAIClient:
    """Thin wrapper around the RouteAI REST API."""

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: int = _DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._token: Optional[str] = self._load_token()

    # -- token persistence -------------------------------------------------

    @staticmethod
    def _load_token() -> Optional[str]:
        try:
            return _TOKEN_FILE.read_text(encoding="utf-8").strip()
        except (FileNotFoundError, OSError):
            return None

    def _save_token(self, token: str) -> None:
        try:
            _TOKEN_FILE.write_text(token, encoding="utf-8")
            # Restrict permissions where possible
            try:
                os.chmod(str(_TOKEN_FILE), 0o600)
            except OSError:
                pass
        except OSError as exc:
            logger.warning("Could not persist auth token: %s", exc)

    def _clear_token(self) -> None:
        self._token = None
        try:
            _TOKEN_FILE.unlink(missing_ok=True)
        except OSError:
            pass

    def has_token(self) -> bool:
        return self._token is not None

    # -- low-level HTTP helpers --------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[dict] = None,
        file_path: Optional[str] = None,
        headers: Optional[dict] = None,
    ) -> dict:
        """
        Execute an HTTP request with retries and return the parsed JSON body.

        Parameters
        ----------
        method : str
            HTTP method (GET, POST, PUT, ...).
        path : str
            URL path (e.g. ``/v1/projects``).
        body : dict, optional
            JSON body payload.
        file_path : str, optional
            If provided the request will be a ``multipart/form-data`` upload
            of the given file.  *body* is ignored in this case.
        headers : dict, optional
            Additional request headers.
        """
        url = f"{self.base_url}{path}"
        hdrs: Dict[str, str] = dict(headers or {})

        if self._token:
            hdrs["Authorization"] = f"Bearer {self._token}"

        data: Optional[bytes] = None

        if file_path is not None:
            # Build a minimal multipart/form-data payload
            boundary = "----RouteAIBoundary7MA4YWxkTrZu0gW"
            filename = Path(file_path).name
            with open(file_path, "rb") as fh:
                file_bytes = fh.read()

            parts: list[bytes] = []
            parts.append(f"--{boundary}\r\n".encode())
            parts.append(
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
            )
            parts.append(b"Content-Type: application/zip\r\n\r\n")
            parts.append(file_bytes)
            parts.append(f"\r\n--{boundary}--\r\n".encode())
            data = b"".join(parts)
            hdrs["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"

        last_exc: Optional[Exception] = None
        for attempt in range(_MAX_RETRIES):
            try:
                req = Request(url, data=data, headers=hdrs, method=method)
                with urlopen(req, timeout=self.timeout) as resp:
                    resp_bytes = resp.read()
                    if resp_bytes:
                        return json.loads(resp_bytes)
                    return {}
            except HTTPError as exc:
                # Don't retry client errors (4xx) except 429
                if 400 <= exc.code < 500 and exc.code != 429:
                    error_body = ""
                    try:
                        error_body = exc.read().decode("utf-8", errors="replace")
                    except Exception:
                        pass
                    raise APIError(exc.code, error_body) from exc
                last_exc = exc
            except (URLError, OSError) as exc:
                last_exc = exc

            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_BACKOFF ** attempt)

        raise ConnectionError(
            f"Failed after {_MAX_RETRIES} attempts: {last_exc}"
        ) from last_exc

    # -- public API --------------------------------------------------------

    def login(self, email: str, password: str) -> str:
        """
        Authenticate and return a bearer token.

        The token is also stored on disk so subsequent sessions can reuse it.
        """
        resp = self._request(
            "POST",
            "/api/v1/auth/login",
            body={"email": email, "password": password},
        )
        token = resp.get("access_token", "")
        if not token:
            raise APIError(0, "Server returned no token")
        self._token = token
        self._save_token(token)
        return token

    def upload_project(self, zip_path: str) -> str:
        """Upload a zipped KiCad project and return a ``project_id``."""
        resp = self._request("POST", "/api/v1/projects", file_path=zip_path)
        project_id = resp.get("id", "")
        if not project_id:
            raise APIError(0, "Server did not return a project id")
        return project_id

    def start_review(self, project_id: str) -> str:
        """Initiate an AI review for the given project and return a ``review_id``."""
        resp = self._request(
            "POST",
            f"/api/v1/projects/{project_id}/review",
            body={"type": "full"},
        )
        review_id = resp.get("review_id", resp.get("id", ""))
        if not review_id:
            raise APIError(0, "Server did not return a review_id")
        return review_id

    def get_review_status(self, project_id: str) -> Dict[str, Any]:
        """
        Return the current status of a review for a project.

        The response typically contains:
        - ``status``: one of ``queued``, ``running``, ``completed``, ``failed``
        - ``progress``: an integer 0-100
        - ``message``: human-readable status string
        """
        return self._request("GET", f"/api/v1/projects/{project_id}/review")

    def get_review_results(self, project_id: str) -> List[Dict[str, Any]]:
        """
        Fetch the completed review results (items) for a project.

        Returns a list of finding dicts, each with at least:
        - ``severity``: ``critical`` | ``warning`` | ``info``
        - ``title``: short description
        - ``message``: detailed explanation
        - ``location``: ``{"x": float, "y": float}`` board coordinates in mm
        - ``component``: optional reference designator
        """
        resp = self._request("GET", f"/api/v1/projects/{project_id}/review/items")
        return resp.get("items", resp.get("findings", []))

    def poll_until_complete(
        self,
        project_id: str,
        callback: Optional[Callable[[int, str], bool]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Poll for review completion, calling *callback(progress, message)* on
        each tick.  If the callback returns ``False`` the poll is aborted and
        an empty list is returned.

        Raises
        ------
        TimeoutError
            If the review does not complete within ``_MAX_POLL_TIME``.
        APIError
            If the review fails server-side.
        """
        deadline = time.monotonic() + _MAX_POLL_TIME

        while time.monotonic() < deadline:
            status = self.get_review_status(project_id)
            state = status.get("status", "unknown")
            progress = int(status.get("progress", 0))
            message = status.get("message", state.capitalize())

            if callback is not None:
                if not callback(progress, message):
                    return []  # cancelled by caller

            if state == "completed":
                return self.get_review_results(project_id)
            if state == "failed":
                raise APIError(
                    0,
                    status.get("message", "Review failed on server"),
                )

            time.sleep(_POLL_INTERVAL)

        raise TimeoutError(
            f"Review for project {project_id} did not complete within {_MAX_POLL_TIME}s"
        )


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class APIError(Exception):
    """Raised when the RouteAI API returns an error."""

    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        self.message = message
        super().__init__(f"API error {status_code}: {message}")
