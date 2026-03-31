"""PCBParts MCP client — optional online component search and KiCad library download.

Endpoint: https://pcbparts.dev/mcp
Protocol: MCP (Model Context Protocol) over HTTP — JSON-RPC 2.0
Auth: None required for JLCPCB data
Rate limit: 100 req/min

When offline or endpoint unreachable, all methods return empty results gracefully.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

PCBPARTS_MCP_URL = "https://pcbparts.dev/mcp"
TIMEOUT = 10.0  # seconds


class PCBPartsClient:
    """Client for PCBParts MCP server.

    Wraps the MCP JSON-RPC 2.0 protocol into simple async methods.
    All methods return empty/None on failure so callers never need to
    handle network errors — the system stays fully functional offline.
    """

    def __init__(self, cache_dir: str | Path | None = None) -> None:
        self._url = PCBPARTS_MCP_URL
        self._cache_dir = Path(cache_dir) if cache_dir else None
        self._available: bool | None = None
        self._request_id = 0

    # ── Low-level MCP transport ──────────────────────────────────────────

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
        """Call an MCP tool via JSON-RPC 2.0. Returns parsed result or None."""
        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.post(
                    self._url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code != 200:
                    logger.debug("PCBParts MCP returned %d for %s", resp.status_code, tool_name)
                    return None
                data = resp.json()

                # JSON-RPC error
                if "error" in data:
                    logger.debug("PCBParts MCP error: %s", data["error"])
                    return None

                # MCP returns result in data["result"]["content"][0]["text"]
                result = data.get("result", {})
                content = result.get("content", [])
                if content and isinstance(content, list):
                    text = content[0].get("text", "")
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return {"raw": text}
                return result
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            logger.debug("PCBParts MCP unreachable (%s): %s", tool_name, exc)
            self._available = False
            return None
        except Exception as exc:
            logger.debug("PCBParts MCP call failed (%s): %s", tool_name, exc)
            return None

    async def is_available(self) -> bool:
        """Check if PCBParts MCP endpoint is reachable.

        Result is cached for the lifetime of the client instance. Call
        ``reset_availability()`` to force a re-check.
        """
        if self._available is not None:
            return self._available
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # Use a lightweight tools/list call to verify the MCP server
                resp = await client.post(
                    self._url,
                    json={"jsonrpc": "2.0", "id": 0, "method": "tools/list", "params": {}},
                    headers={"Content-Type": "application/json"},
                )
                self._available = resp.status_code == 200
        except Exception:
            self._available = False
        return self._available

    def reset_availability(self) -> None:
        """Clear the cached availability flag so the next call re-checks."""
        self._available = None

    # ── Component Search ─────────────────────────────────────────────────

    async def search_components(
        self,
        query: str,
        subcategory: str | None = None,
        in_stock: bool = True,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Search JLCPCB catalog. Supports smart queries like '10k 0603 1%'."""
        args: dict[str, Any] = {"query": query, "limit": limit}
        if subcategory:
            args["subcategory"] = subcategory
        if in_stock:
            args["in_stock"] = True
        result = await self._call_tool("jlc_search", args)
        if not result:
            return []
        return result.get("parts", result.get("results", []))

    async def get_part_details(self, lcsc_code: str) -> dict[str, Any] | None:
        """Get full details for a specific JLCPCB part (e.g., 'C25804')."""
        return await self._call_tool("jlc_get_part", {"lcsc": lcsc_code})

    async def check_stock(self, lcsc_code: str) -> dict[str, Any] | None:
        """Check real-time stock and pricing for a JLCPCB part."""
        return await self._call_tool("jlc_stock_check", {"lcsc": lcsc_code})

    async def get_pinout(self, lcsc_code: str) -> dict[str, Any] | None:
        """Get pinout/schematic symbol data from EasyEDA."""
        return await self._call_tool("jlc_get_pinout", {"lcsc": lcsc_code})

    # ── Alternatives ─────────────────────────────────────────────────────

    async def find_alternatives(
        self,
        lcsc_code: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Find alternative components with same-or-better specs."""
        result = await self._call_tool("jlc_find_alternatives", {
            "lcsc": lcsc_code,
            "limit": limit,
        })
        if not result:
            return []
        return result.get("alternatives", result.get("parts", []))

    # ── Sensor Recommendation ────────────────────────────────────────────

    async def recommend_sensors(
        self,
        measurement: str,
        protocol: str | None = None,
        platform: str | None = None,
    ) -> list[dict[str, Any]]:
        """Recommend sensor ICs by measurement type (e.g., 'temperature', 'CO2')."""
        args: dict[str, Any] = {"measurement": measurement}
        if protocol:
            args["protocol"] = protocol
        if platform:
            args["platform"] = platform
        result = await self._call_tool("sensor_recommend", args)
        if not result:
            return []
        return result.get("sensors", result.get("results", []))

    # ── Reference Boards ─────────────────────────────────────────────────

    async def search_boards(self, query: str) -> list[dict[str, Any]]:
        """Search open-source reference board schematics."""
        result = await self._call_tool("board_search", {"query": query})
        if not result:
            return []
        return result.get("boards", result.get("results", []))

    async def get_board_details(self, board_id: str) -> dict[str, Any] | None:
        """Get IC neighborhood details from a reference board."""
        return await self._call_tool("board_get", {"board_id": board_id})

    # ── KiCad Symbol/Footprint Download ──────────────────────────────────

    async def search_kicad_models(self, query: str) -> list[dict[str, Any]]:
        """Search SamacSys for KiCad symbols and footprints."""
        result = await self._call_tool("cse_search", {"query": query})
        if not result:
            return []
        return result.get("models", result.get("results", []))

    async def download_kicad_symbol(self, cse_id: str) -> dict[str, Any] | None:
        """Download KiCad symbol and footprint data from SamacSys."""
        result = await self._call_tool("cse_get_kicad", {"id": cse_id})
        if result and self._cache_dir:
            await self._cache_symbol(cse_id, result)
        return result

    async def _cache_symbol(self, cse_id: str, data: dict[str, Any]) -> None:
        """Save downloaded symbol to local cache for offline use."""
        if not self._cache_dir:
            return
        cache_file = self._cache_dir / f"pcbparts_{cse_id}.json"
        try:
            self._cache_dir.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, indent=2))
            logger.info("Cached KiCad symbol: %s", cache_file)
        except Exception as exc:
            logger.debug("Failed to cache symbol %s: %s", cse_id, exc)

    # ── Design Rules ─────────────────────────────────────────────────────

    async def get_design_rules(self, topic: str | None = None) -> list[dict[str, Any]]:
        """Get curated PCB design rules (41 topics)."""
        args: dict[str, Any] = {"topic": topic} if topic else {}
        result = await self._call_tool("get_design_rules", args)
        if not result:
            return []
        return result.get("rules", result.get("results", []))

    # ── Cross-distributor Lookup ─────────────────────────────────────────

    async def get_mouser_part(self, mpn: str) -> dict[str, Any] | None:
        """Look up a part on Mouser by MPN."""
        return await self._call_tool("mouser_get_part", {"mpn": mpn})

    async def get_digikey_part(self, mpn: str) -> dict[str, Any] | None:
        """Look up a part on DigiKey by MPN."""
        return await self._call_tool("digikey_get_part", {"mpn": mpn})


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_client: PCBPartsClient | None = None


def get_pcbparts_client(cache_dir: str | Path | None = None) -> PCBPartsClient:
    """Get or create the singleton PCBParts client.

    Parameters
    ----------
    cache_dir:
        Directory for caching downloaded KiCad symbols/footprints.
        Only used when creating the client for the first time.
    """
    global _client  # noqa: PLW0603
    if _client is None:
        _client = PCBPartsClient(cache_dir=cache_dir)
    return _client
