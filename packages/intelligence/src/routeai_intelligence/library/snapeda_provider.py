"""SnapEDA API integration for downloading symbols and footprints.

SnapEDA provides free symbols/footprints for millions of electronic parts.
This provider searches the SnapEDA catalogue and downloads assets in KiCad format.

API reference: https://www.snapeda.com/api/v1/
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 10.0


@dataclass
class SnapEDAResult:
    """A single search result from SnapEDA."""

    part_number: str
    manufacturer: str
    description: str
    has_symbol: bool
    has_footprint: bool
    has_3d_model: bool
    url: str
    part_id: str
    category: str = ""
    package: str = ""


@dataclass
class SnapEDAPart:
    """Full detail for a SnapEDA part."""

    part_number: str
    manufacturer: str
    description: str
    has_symbol: bool
    has_footprint: bool
    has_3d_model: bool
    url: str
    part_id: str
    datasheet_url: str | None = None
    category: str = ""
    package: str = ""
    pins: list[dict[str, str]] = field(default_factory=list)


class SnapEDAProvider:
    """SnapEDA API client for downloading symbols and footprints.

    SnapEDA provides free symbols/footprints for millions of parts.
    API: https://www.snapeda.com/api/v1/

    Usage::

        provider = SnapEDAProvider(api_key="your-key")
        results = await provider.search("STM32F103C8T6")
        symbol_bytes = await provider.download_symbol(results[0].part_id)
    """

    BASE_URL = "https://www.snapeda.com/api/v1"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        """Build request headers, including API key if available."""
        headers: dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": "RouteAI/1.0",
        }
        if self._api_key:
            headers["Authorization"] = f"Token {self._api_key}"
        return headers

    async def search(self, query: str, limit: int = 20) -> list[SnapEDAResult]:
        """Search SnapEDA for parts matching *query*.

        Args:
            query: Part number, description, or keyword.
            limit: Maximum results to return.

        Returns:
            List of SnapEDAResult items. Empty list on any error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/parts",
                    params={"q": query, "limit": limit},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                data: dict[str, Any] = resp.json()

            results: list[SnapEDAResult] = []
            for item in data.get("results", data.get("parts", [])):
                results.append(
                    SnapEDAResult(
                        part_number=item.get("part_number", ""),
                        manufacturer=item.get("manufacturer", {}).get("name", "")
                        if isinstance(item.get("manufacturer"), dict)
                        else str(item.get("manufacturer", "")),
                        description=item.get("short_description", item.get("description", "")),
                        has_symbol=bool(item.get("has_symbol", False)),
                        has_footprint=bool(item.get("has_footprint", False)),
                        has_3d_model=bool(item.get("has_3d_model", False)),
                        url=item.get("url", ""),
                        part_id=str(item.get("id", item.get("_id", ""))),
                        category=item.get("category", ""),
                        package=item.get("package", ""),
                    )
                )
            return results[:limit]

        except httpx.TimeoutException:
            logger.warning("SnapEDA search timed out for query: %s", query)
            return []
        except httpx.HTTPStatusError as exc:
            logger.warning("SnapEDA search HTTP %s for query: %s", exc.response.status_code, query)
            return []
        except Exception:
            logger.exception("SnapEDA search failed for query: %s", query)
            return []

    async def get_part(self, part_number: str) -> SnapEDAPart | None:
        """Get full detail for a specific part by part number.

        Args:
            part_number: The manufacturer part number.

        Returns:
            SnapEDAPart with full detail, or None on error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/parts",
                    params={"q": part_number, "limit": 1},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                data = resp.json()

            items = data.get("results", data.get("parts", []))
            if not items:
                return None

            item = items[0]
            return SnapEDAPart(
                part_number=item.get("part_number", ""),
                manufacturer=item.get("manufacturer", {}).get("name", "")
                if isinstance(item.get("manufacturer"), dict)
                else str(item.get("manufacturer", "")),
                description=item.get("short_description", item.get("description", "")),
                has_symbol=bool(item.get("has_symbol", False)),
                has_footprint=bool(item.get("has_footprint", False)),
                has_3d_model=bool(item.get("has_3d_model", False)),
                url=item.get("url", ""),
                part_id=str(item.get("id", item.get("_id", ""))),
                datasheet_url=item.get("datasheet_url"),
                category=item.get("category", ""),
                package=item.get("package", ""),
                pins=item.get("pins", []),
            )

        except Exception:
            logger.exception("SnapEDA get_part failed for: %s", part_number)
            return None

    async def download_symbol(self, part_id: str, format: str = "kicad") -> bytes:
        """Download a symbol file for a part.

        Args:
            part_id: The SnapEDA part identifier.
            format: Output format (default ``"kicad"`` for ``.kicad_sym``).

        Returns:
            Raw bytes of the symbol file. Empty bytes on error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout * 2) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/parts/{part_id}/symbol",
                    params={"format": format},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                return resp.content

        except Exception:
            logger.exception("SnapEDA download_symbol failed for part_id: %s", part_id)
            return b""

    async def download_footprint(self, part_id: str, format: str = "kicad") -> bytes:
        """Download a footprint file for a part.

        Args:
            part_id: The SnapEDA part identifier.
            format: Output format (default ``"kicad"`` for ``.kicad_mod``).

        Returns:
            Raw bytes of the footprint file. Empty bytes on error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout * 2) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/parts/{part_id}/footprint",
                    params={"format": format},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                return resp.content

        except Exception:
            logger.exception("SnapEDA download_footprint failed for part_id: %s", part_id)
            return b""

    async def download_3d_model(self, part_id: str) -> bytes | None:
        """Download a 3D model (STEP) for a part, if available.

        Args:
            part_id: The SnapEDA part identifier.

        Returns:
            Raw bytes of the STEP file, or None if unavailable.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout * 3) as client:
                resp = await client.get(
                    f"{self.BASE_URL}/parts/{part_id}/3dmodel",
                    headers=self._headers(),
                )
                if resp.status_code == 404:
                    return None
                resp.raise_for_status()
                return resp.content

        except Exception:
            logger.exception("SnapEDA download_3d_model failed for part_id: %s", part_id)
            return None
