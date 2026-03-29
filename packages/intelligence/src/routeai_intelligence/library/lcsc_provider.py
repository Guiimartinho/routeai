"""LCSC/JLCPCB component search via the jlcsearch API.

LCSC is the largest Chinese electronic component distributor and the
preferred supplier for JLCPCB assembly. This provider queries the
tscircuit jlcsearch API and falls back to the LCSC global search endpoint.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 10.0


@dataclass
class LCSCResult:
    """A single search result from LCSC/jlcsearch."""

    lcsc_code: str
    mpn: str
    manufacturer: str
    description: str
    package: str
    category: str
    stock: int
    price_usd: float | None = None
    datasheet_url: str | None = None
    image_url: str | None = None


@dataclass
class LCSCPartDetail:
    """Full detail for an LCSC part."""

    lcsc_code: str
    mpn: str
    manufacturer: str
    description: str
    package: str
    category: str
    stock: int
    price_breaks: list[dict[str, float]] = field(default_factory=list)
    datasheet_url: str | None = None
    image_url: str | None = None
    specs: dict[str, str] = field(default_factory=dict)


class LCSCProvider:
    """LCSC component search via jlcsearch API.

    Searches the tscircuit jlcsearch API (free, no auth required) and
    optionally falls back to the LCSC global search endpoint.

    Usage::

        provider = LCSCProvider()
        results = await provider.search("STM32F103C8T6")
    """

    JLCSEARCH_URL = "https://jlcsearch.tscircuit.com/api/components/list.json"
    LCSC_SEARCH_URL = "https://wmsc.lcsc.com/ftps/wm/search/global"

    def __init__(self, timeout: float = _DEFAULT_TIMEOUT) -> None:
        self._timeout = timeout

    async def search(self, query: str, limit: int = 20) -> list[LCSCResult]:
        """Search LCSC/jlcsearch for parts matching *query*.

        Tries the jlcsearch API first, falling back to LCSC direct search
        if jlcsearch returns fewer than 3 results.

        Args:
            query: Part number, description, or keyword.
            limit: Maximum results to return.

        Returns:
            List of LCSCResult items. Empty list on any error.
        """
        results = await self._search_jlcsearch(query, limit)
        if len(results) < 3:
            fallback = await self._search_lcsc_direct(query, limit)
            # Merge, preferring jlcsearch results
            seen_codes: set[str] = {r.lcsc_code for r in results}
            for fb in fallback:
                if fb.lcsc_code not in seen_codes:
                    results.append(fb)
                    seen_codes.add(fb.lcsc_code)
        return results[:limit]

    async def get_part_detail(self, lcsc_id: str) -> LCSCPartDetail | None:
        """Get full detail for a specific LCSC part.

        Args:
            lcsc_id: The LCSC part code (e.g., ``"C14259"``).

        Returns:
            LCSCPartDetail or None on error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self.JLCSEARCH_URL,
                    params={"search": lcsc_id, "limit": "1", "full": "true"},
                    headers={"Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            components: list[dict[str, Any]] = data.get("components", data if isinstance(data, list) else [])
            if not components:
                return None

            c = components[0]
            specs: dict[str, str] = {}
            for key in ("resistance", "capacitance", "voltage", "current", "power", "tolerance"):
                val = c.get(key)
                if val is not None:
                    specs[key] = str(val)

            price_breaks: list[dict[str, float]] = []
            prices = c.get("prices") or []
            if isinstance(prices, list):
                for p in prices:
                    if isinstance(p, dict):
                        price_breaks.append({"qty": float(p.get("qty", 1)), "price": float(p.get("price", 0))})
            elif c.get("price") is not None:
                price_breaks.append({"qty": 1, "price": float(c["price"])})

            return LCSCPartDetail(
                lcsc_code=c.get("lcsc", lcsc_id),
                mpn=c.get("mfr", ""),
                manufacturer=c.get("manufacturer", ""),
                description=c.get("description", ""),
                package=c.get("package", ""),
                category=c.get("subcategory", c.get("category", "")),
                stock=int(c.get("stock", 0)),
                price_breaks=price_breaks,
                datasheet_url=c.get("datasheet"),
                image_url=c.get("image_url"),
                specs=specs,
            )

        except Exception:
            logger.exception("LCSC get_part_detail failed for: %s", lcsc_id)
            return None

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _search_jlcsearch(self, query: str, limit: int) -> list[LCSCResult]:
        """Search via the tscircuit jlcsearch API."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self.JLCSEARCH_URL,
                    params={"search": query, "limit": str(limit), "full": "true"},
                    headers={"Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            components: list[dict[str, Any]] = data.get("components", data if isinstance(data, list) else [])
            results: list[LCSCResult] = []
            for c in components:
                price: float | None = None
                prices = c.get("prices")
                if isinstance(prices, list) and prices:
                    price = float(prices[0].get("price", 0))
                elif c.get("price") is not None:
                    price = float(c["price"])

                results.append(
                    LCSCResult(
                        lcsc_code=c.get("lcsc", ""),
                        mpn=c.get("mfr", c.get("lcsc", "")),
                        manufacturer=c.get("manufacturer", ""),
                        description=c.get("description", ""),
                        package=c.get("package", ""),
                        category=c.get("subcategory", c.get("category", "")),
                        stock=int(c.get("stock", 0)),
                        price_usd=price,
                        datasheet_url=c.get("datasheet"),
                        image_url=c.get("image_url"),
                    )
                )
            return results[:limit]

        except httpx.TimeoutException:
            logger.warning("jlcsearch timed out for query: %s", query)
            return []
        except Exception:
            logger.exception("jlcsearch search failed for query: %s", query)
            return []

    async def _search_lcsc_direct(self, query: str, limit: int) -> list[LCSCResult]:
        """Fallback search via LCSC global search endpoint."""
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self.LCSC_SEARCH_URL,
                    params={"keyword": query},
                    headers={"Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

            product_list: list[dict[str, Any]] = (
                data.get("result", {}).get("tipProductList")
                or data.get("result", {}).get("productList")
                or []
            )

            results: list[LCSCResult] = []
            for p in product_list[:limit]:
                price: float | None = None
                price_list = p.get("productPriceList")
                if isinstance(price_list, list) and price_list:
                    price = float(price_list[0].get("usdPrice", 0))

                results.append(
                    LCSCResult(
                        lcsc_code=p.get("productCode", ""),
                        mpn=p.get("productModel", ""),
                        manufacturer=p.get("brandNameEn", ""),
                        description=p.get("productDescEn", ""),
                        package=p.get("encapStandard", ""),
                        category=p.get("catalogName", ""),
                        stock=int(p.get("stockNumber", 0)),
                        price_usd=price,
                        datasheet_url=p.get("pdfUrl"),
                        image_url=p.get("productImageUrl"),
                    )
                )
            return results

        except httpx.TimeoutException:
            logger.warning("LCSC direct search timed out for query: %s", query)
            return []
        except Exception:
            logger.exception("LCSC direct search failed for query: %s", query)
            return []
