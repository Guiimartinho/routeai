"""Unified component search across ALL sources.

Runs all providers in parallel, deduplicates results by MPN + manufacturer,
and ranks by availability, datasheet presence, price, and source reliability.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from pathlib import Path
from typing import Any

from routeai_intelligence.library.eagle_lib_provider import EagleLibProvider
from routeai_intelligence.library.easyeda_provider import EasyEDAProvider
from routeai_intelligence.library.kicad_lib_provider import KiCadLibProvider
from routeai_intelligence.library.lcsc_provider import LCSCProvider
from routeai_intelligence.library.models import (
    ComponentDetail,
    ComponentResult,
    LocalComponent,
    PinInfo,
)
from routeai_intelligence.library.snapeda_provider import SnapEDAProvider

logger = logging.getLogger(__name__)

# Source reliability weights (higher = more trusted)
_SOURCE_RELIABILITY: dict[str, float] = {
    "lcsc": 0.9,
    "snapeda": 0.85,
    "kicad": 0.8,
    "easyeda": 0.75,
    "eagle": 0.7,
    "local": 0.6,
}

# Cache TTL in seconds
_CACHE_TTL = 300  # 5 minutes
_MAX_CACHE_SIZE = 500


class UnifiedComponentSearch:
    """Search components across SnapEDA, LCSC, KiCad libs, Eagle libs, EasyEDA, and local DB.

    All providers are queried in parallel. Results are deduplicated by
    MPN + manufacturer and ranked by: availability > datasheet_exists >
    price > source_reliability.

    Usage::

        search = UnifiedComponentSearch(
            snapeda_api_key="...",
            cache_dir="/tmp/routeai_components",
        )
        results = await search.search("STM32F103C8T6")
        detail = await search.get_component_detail("lcsc", "C14259")
        local = await search.download_to_local("snapeda", "12345")
    """

    def __init__(
        self,
        snapeda_api_key: str | None = None,
        github_token: str | None = None,
        cache_dir: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._snapeda = SnapEDAProvider(api_key=snapeda_api_key, timeout=timeout)
        self._lcsc = LCSCProvider(timeout=timeout)
        self._kicad = KiCadLibProvider(github_token=github_token, timeout=timeout)
        self._eagle = EagleLibProvider()
        self._easyeda = EasyEDAProvider(timeout=timeout)
        self._cache_dir = Path(cache_dir) if cache_dir else None
        self._search_cache: dict[str, tuple[float, list[ComponentResult]]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def search(
        self,
        query: str,
        filters: dict[str, Any] | None = None,
        limit: int = 40,
    ) -> list[ComponentResult]:
        """Search all sources in parallel, deduplicate by MPN, rank by relevance.

        Args:
            query: Part number, description, or keyword.
            filters: Optional filters: ``category``, ``package``, ``min_stock``,
                ``max_price``, ``sources`` (list of source names to include).
            limit: Maximum results to return.

        Returns:
            List of ComponentResult ordered by ranking score.
        """
        if not query.strip():
            return []

        # Check cache
        cache_key = self._cache_key(query, filters)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached[:limit]

        # Determine which sources to query
        enabled_sources = set(
            (filters or {}).get("sources", ["snapeda", "lcsc", "kicad", "easyeda", "eagle"])
        )

        # Launch all providers in parallel
        tasks: dict[str, asyncio.Task[list[ComponentResult]]] = {}

        if "snapeda" in enabled_sources:
            tasks["snapeda"] = asyncio.create_task(
                self._search_snapeda(query, limit)
            )
        if "lcsc" in enabled_sources:
            tasks["lcsc"] = asyncio.create_task(
                self._search_lcsc(query, limit)
            )
        if "kicad" in enabled_sources:
            tasks["kicad"] = asyncio.create_task(
                self._search_kicad(query, limit)
            )
        if "easyeda" in enabled_sources:
            tasks["easyeda"] = asyncio.create_task(
                self._search_easyeda(query, limit)
            )
        if "eagle" in enabled_sources:
            tasks["eagle"] = asyncio.create_task(
                self._search_eagle(query, limit)
            )

        # Gather results, tolerating individual failures
        all_results: list[ComponentResult] = []
        for source_name, task in tasks.items():
            try:
                results = await task
                all_results.extend(results)
            except Exception:
                logger.exception("Provider '%s' failed during search", source_name)

        # Deduplicate
        deduped = self._deduplicate(all_results)

        # Apply filters
        if filters:
            deduped = self._apply_filters(deduped, filters)

        # Rank
        ranked = self._rank(deduped)

        # Cache
        self._set_cache(cache_key, ranked)

        return ranked[:limit]

    async def get_component_detail(
        self, source: str, component_id: str
    ) -> ComponentDetail | None:
        """Get full detail including symbol, footprint, 3D model from any source.

        Args:
            source: The provider name (``"snapeda"``, ``"lcsc"``, etc.).
            component_id: The source-specific component identifier.

        Returns:
            ComponentDetail with full data, or None if not found.
        """
        try:
            if source == "snapeda":
                return await self._detail_snapeda(component_id)
            elif source == "lcsc":
                return await self._detail_lcsc(component_id)
            elif source == "kicad":
                return await self._detail_kicad(component_id)
            elif source == "easyeda":
                return await self._detail_easyeda(component_id)
            elif source == "eagle":
                return self._detail_eagle(component_id)
            else:
                logger.warning("Unknown source: %s", source)
                return None
        except Exception:
            logger.exception("get_component_detail failed for %s/%s", source, component_id)
            return None

    async def download_to_local(
        self, source: str, component_id: str
    ) -> LocalComponent | None:
        """Download symbol+footprint from external source and cache locally.

        Args:
            source: The provider name.
            component_id: The source-specific component identifier.

        Returns:
            LocalComponent with paths to cached files, or None on failure.
        """
        if self._cache_dir is None:
            logger.warning("No cache_dir configured, cannot download to local")
            return None

        detail = await self.get_component_detail(source, component_id)
        if detail is None:
            return None

        # Create cache directory structure
        safe_id = hashlib.md5(f"{source}:{component_id}".encode()).hexdigest()[:12]
        safe_mpn = "".join(c if c.isalnum() or c in "-_." else "_" for c in detail.mpn)
        comp_dir = self._cache_dir / safe_mpn / safe_id
        comp_dir.mkdir(parents=True, exist_ok=True)

        local = LocalComponent(
            mpn=detail.mpn,
            manufacturer=detail.manufacturer,
            source=source,
            source_id=component_id,
            metadata={
                "description": detail.description,
                "category": detail.category,
                "package": detail.package,
            },
        )

        # Save symbol
        if detail.symbol_data:
            sym_path = comp_dir / f"{safe_mpn}.kicad_sym"
            sym_path.write_text(detail.symbol_data, encoding="utf-8")
            local.symbol_path = str(sym_path)

        # Save footprint
        if detail.footprint_data:
            fp_path = comp_dir / f"{safe_mpn}.kicad_mod"
            fp_path.write_text(detail.footprint_data, encoding="utf-8")
            local.footprint_path = str(fp_path)

        # Save 3D model
        if detail.model_3d_data:
            model_path = comp_dir / f"{safe_mpn}.step"
            model_path.write_bytes(detail.model_3d_data)
            local.model_3d_path = str(model_path)

        logger.info("Downloaded %s/%s to %s", source, component_id, comp_dir)
        return local

    # ------------------------------------------------------------------
    # Provider-specific search adapters
    # ------------------------------------------------------------------

    async def _search_snapeda(self, query: str, limit: int) -> list[ComponentResult]:
        """Adapt SnapEDA results to ComponentResult."""
        raw = await self._snapeda.search(query, limit)
        return [
            ComponentResult(
                mpn=r.part_number,
                manufacturer=r.manufacturer,
                description=r.description,
                category=r.category,
                package=r.package,
                source="snapeda",
                source_id=r.part_id,
                has_symbol=r.has_symbol,
                has_footprint=r.has_footprint,
                has_3d_model=r.has_3d_model,
                datasheet_url=None,
                price_usd=None,
                stock=None,
            )
            for r in raw
        ]

    async def _search_lcsc(self, query: str, limit: int) -> list[ComponentResult]:
        """Adapt LCSC results to ComponentResult."""
        raw = await self._lcsc.search(query, limit)
        return [
            ComponentResult(
                mpn=r.mpn,
                manufacturer=r.manufacturer,
                description=r.description,
                category=r.category,
                package=r.package,
                source="lcsc",
                source_id=r.lcsc_code,
                has_symbol=False,
                has_footprint=True,  # JLCPCB parts have footprints
                has_3d_model=False,
                datasheet_url=r.datasheet_url,
                price_usd=r.price_usd,
                stock=r.stock,
            )
            for r in raw
        ]

    async def _search_kicad(self, query: str, limit: int) -> list[ComponentResult]:
        """Adapt KiCad lib results to ComponentResult."""
        raw = await self._kicad.search(query, limit)
        return [
            ComponentResult(
                mpn=r.name,
                manufacturer="",
                description=r.description,
                category=r.category,
                package=r.footprint_suggestion,
                source="kicad",
                source_id=f"{r.lib_name}:{r.name}",
                has_symbol=True,
                has_footprint=bool(r.footprint_suggestion),
                has_3d_model=False,
                datasheet_url=None,
                price_usd=None,
                stock=None,
            )
            for r in raw
        ]

    async def _search_easyeda(self, query: str, limit: int) -> list[ComponentResult]:
        """Adapt EasyEDA results to ComponentResult."""
        raw = await self._easyeda.search(query, limit)
        return [
            ComponentResult(
                mpn=r.mpn or r.title,
                manufacturer=r.manufacturer,
                description=r.description,
                category="",
                package=r.package,
                source="easyeda",
                source_id=r.uuid,
                has_symbol=r.has_symbol,
                has_footprint=r.has_footprint,
                has_3d_model=r.has_3d_model,
                datasheet_url=r.datasheet_url,
                price_usd=None,
                stock=None,
            )
            for r in raw
        ]

    async def _search_eagle(self, query: str, limit: int) -> list[ComponentResult]:
        """Adapt Eagle lib results to ComponentResult (synchronous search)."""
        raw = self._eagle.search(query, limit)
        return [
            ComponentResult(
                mpn=r.name,
                manufacturer="",
                description=r.description,
                category=r.category,
                package=r.package,
                source="eagle",
                source_id=f"{r.lib_name}:{r.device_name}",
                has_symbol=r.has_symbol,
                has_footprint=r.has_footprint,
                has_3d_model=False,
                datasheet_url=None,
                price_usd=None,
                stock=None,
            )
            for r in raw
        ]

    # ------------------------------------------------------------------
    # Provider-specific detail adapters
    # ------------------------------------------------------------------

    async def _detail_snapeda(self, component_id: str) -> ComponentDetail | None:
        part = await self._snapeda.get_part(component_id)
        if part is None:
            return None

        symbol_data: str | None = None
        footprint_data: str | None = None
        model_3d_data: bytes | None = None

        if part.has_symbol:
            raw = await self._snapeda.download_symbol(part.part_id)
            if raw:
                symbol_data = raw.decode("utf-8", errors="replace")

        if part.has_footprint:
            raw = await self._snapeda.download_footprint(part.part_id)
            if raw:
                footprint_data = raw.decode("utf-8", errors="replace")

        if part.has_3d_model:
            model_3d_data = await self._snapeda.download_3d_model(part.part_id)

        pins = [
            PinInfo(
                number=p.get("number", ""),
                name=p.get("name", ""),
                type=p.get("type", "passive"),
            )
            for p in part.pins
        ]

        return ComponentDetail(
            mpn=part.part_number,
            manufacturer=part.manufacturer,
            description=part.description,
            category=part.category,
            package=part.package,
            source="snapeda",
            source_id=part.part_id,
            has_symbol=part.has_symbol,
            has_footprint=part.has_footprint,
            has_3d_model=part.has_3d_model,
            datasheet_url=part.datasheet_url,
            symbol_data=symbol_data,
            footprint_data=footprint_data,
            model_3d_data=model_3d_data,
            pins=pins,
        )

    async def _detail_lcsc(self, component_id: str) -> ComponentDetail | None:
        detail = await self._lcsc.get_part_detail(component_id)
        if detail is None:
            return None

        return ComponentDetail(
            mpn=detail.mpn,
            manufacturer=detail.manufacturer,
            description=detail.description,
            category=detail.category,
            package=detail.package,
            source="lcsc",
            source_id=detail.lcsc_code,
            has_symbol=False,
            has_footprint=True,
            has_3d_model=False,
            datasheet_url=detail.datasheet_url,
            price_usd=detail.price_breaks[0]["price"] if detail.price_breaks else None,
            stock=detail.stock,
            specs=detail.specs,
            pins=[],
        )

    async def _detail_kicad(self, component_id: str) -> ComponentDetail | None:
        # component_id is "lib_name:symbol_name"
        parts = component_id.split(":", 1)
        if len(parts) != 2:
            return None
        lib_name, symbol_name = parts

        symbol_data = await self._kicad.get_symbol(lib_name, symbol_name)
        footprint_data = ""

        # Try to find matching footprint
        local_results = self._kicad.search_local_index(symbol_name, 1)
        if local_results and local_results[0].footprint_suggestion:
            fp_suggestion = local_results[0].footprint_suggestion
            # Attempt to guess footprint lib from category
            fp_lib = local_results[0].category
            footprint_data = await self._kicad.get_footprint(fp_lib, fp_suggestion)

        return ComponentDetail(
            mpn=symbol_name,
            manufacturer="",
            description=local_results[0].description if local_results else "",
            category=local_results[0].category if local_results else "",
            package=local_results[0].footprint_suggestion if local_results else "",
            source="kicad",
            source_id=component_id,
            has_symbol=bool(symbol_data),
            has_footprint=bool(footprint_data),
            has_3d_model=False,
            symbol_data=symbol_data or None,
            footprint_data=footprint_data or None,
            pins=[],
        )

    async def _detail_easyeda(self, component_id: str) -> ComponentDetail | None:
        comp = await self._easyeda.get_component(component_id)
        if comp is None:
            return None

        symbol_sexpr, footprint_sexpr = await self._easyeda.convert_to_kicad(comp)

        pins = [
            PinInfo(
                number=p.get("number", ""),
                name=p.get("name", ""),
                type=p.get("type", "passive"),
            )
            for p in comp.pins
        ]

        return ComponentDetail(
            mpn=comp.mpn or comp.title,
            manufacturer=comp.manufacturer,
            description=comp.description,
            category="",
            package=comp.package,
            source="easyeda",
            source_id=comp.uuid,
            has_symbol=bool(symbol_sexpr),
            has_footprint=bool(footprint_sexpr),
            has_3d_model=bool(comp.model_3d_url),
            datasheet_url=comp.datasheet_url,
            symbol_data=symbol_sexpr or None,
            footprint_data=footprint_sexpr or None,
            pins=pins,
        )

    def _detail_eagle(self, component_id: str) -> ComponentDetail | None:
        # component_id is "lib_name:device_name"
        parts = component_id.split(":", 1)
        if len(parts) != 2:
            return None
        lib_name, device_name = parts

        comp = self._eagle.get_component(lib_name, device_name)
        if comp is None:
            return None

        pins = [
            PinInfo(
                number=str(i + 1),
                name=p.get("name", ""),
                type=p.get("direction", "passive"),
            )
            for i, p in enumerate(comp.pins)
        ]

        return ComponentDetail(
            mpn=comp.name,
            manufacturer="",
            description=comp.description,
            category="",
            package=comp.package,
            source="eagle",
            source_id=component_id,
            has_symbol=bool(comp.symbol_xml),
            has_footprint=bool(comp.package_xml),
            has_3d_model=False,
            symbol_data=comp.symbol_xml or None,
            footprint_data=comp.package_xml or None,
            pins=pins,
        )

    # ------------------------------------------------------------------
    # Deduplication and ranking
    # ------------------------------------------------------------------

    def _deduplicate(self, results: list[ComponentResult]) -> list[ComponentResult]:
        """Deduplicate results by normalised MPN + manufacturer.

        When duplicates are found, the one with more data (stock, price,
        datasheet, symbol/footprint) is kept, with missing fields merged
        from other copies.
        """
        seen: dict[str, ComponentResult] = {}

        for r in results:
            key = self._dedup_key(r)
            existing = seen.get(key)
            if existing is None:
                seen[key] = r
            else:
                # Merge: prefer the one with more useful data
                if r.price_usd is not None and existing.price_usd is None:
                    existing.price_usd = r.price_usd
                if r.stock is not None and existing.stock is None:
                    existing.stock = r.stock
                if r.datasheet_url and not existing.datasheet_url:
                    existing.datasheet_url = r.datasheet_url
                if r.has_symbol and not existing.has_symbol:
                    existing.has_symbol = True
                if r.has_footprint and not existing.has_footprint:
                    existing.has_footprint = True
                if r.has_3d_model and not existing.has_3d_model:
                    existing.has_3d_model = True
                if r.specs and not existing.specs:
                    existing.specs = r.specs

        return list(seen.values())

    @staticmethod
    def _dedup_key(r: ComponentResult) -> str:
        """Generate a normalised deduplication key."""
        mpn = r.mpn.lower().replace(" ", "").replace("-", "").replace("_", "")
        mfr = r.manufacturer.lower().replace(" ", "")
        return f"{mpn}|{mfr}"

    def _rank(self, results: list[ComponentResult]) -> list[ComponentResult]:
        """Rank results by: availability > datasheet > price > source reliability."""

        def score(r: ComponentResult) -> float:
            s = 0.0
            # Availability (in-stock parts ranked highest)
            if r.stock is not None and r.stock > 0:
                s += 4.0
                if r.stock > 1000:
                    s += 1.0
            # Datasheet available
            if r.datasheet_url:
                s += 2.0
            # Has symbol + footprint
            if r.has_symbol:
                s += 1.0
            if r.has_footprint:
                s += 1.0
            if r.has_3d_model:
                s += 0.5
            # Price (lower is better, normalized)
            if r.price_usd is not None and r.price_usd > 0:
                s += max(0.0, 1.0 - r.price_usd / 100.0)
            # Source reliability
            s += _SOURCE_RELIABILITY.get(r.source, 0.5)
            return s

        results.sort(key=score, reverse=True)
        return results

    def _apply_filters(
        self, results: list[ComponentResult], filters: dict[str, Any]
    ) -> list[ComponentResult]:
        """Apply user-specified filters to results."""
        filtered = results

        category = filters.get("category")
        if category:
            cat_lower = category.lower()
            filtered = [
                r for r in filtered
                if cat_lower in r.category.lower() or cat_lower in r.description.lower()
            ]

        package = filters.get("package")
        if package:
            pkg_lower = package.lower()
            filtered = [
                r for r in filtered
                if pkg_lower in r.package.lower()
            ]

        min_stock = filters.get("min_stock")
        if min_stock is not None:
            filtered = [
                r for r in filtered
                if r.stock is not None and r.stock >= min_stock
            ]

        max_price = filters.get("max_price")
        if max_price is not None:
            filtered = [
                r for r in filtered
                if r.price_usd is None or r.price_usd <= max_price
            ]

        return filtered

    # ------------------------------------------------------------------
    # Caching
    # ------------------------------------------------------------------

    def _cache_key(self, query: str, filters: dict[str, Any] | None) -> str:
        parts = [query.lower().strip()]
        if filters:
            for k in sorted(filters.keys()):
                parts.append(f"{k}={filters[k]}")
        return "|".join(parts)

    def _get_cached(self, key: str) -> list[ComponentResult] | None:
        entry = self._search_cache.get(key)
        if entry is None:
            return None
        ts, results = entry
        if time.time() - ts > _CACHE_TTL:
            del self._search_cache[key]
            return None
        return results

    def _set_cache(self, key: str, results: list[ComponentResult]) -> None:
        self._search_cache[key] = (time.time(), results)
        # Evict old entries if cache too large
        if len(self._search_cache) > _MAX_CACHE_SIZE:
            oldest_keys = sorted(
                self._search_cache.keys(),
                key=lambda k: self._search_cache[k][0],
            )
            for k in oldest_keys[: _MAX_CACHE_SIZE // 4]:
                del self._search_cache[k]

    def clear_cache(self) -> None:
        """Clear the search result cache."""
        self._search_cache.clear()

    # ------------------------------------------------------------------
    # Eagle library management
    # ------------------------------------------------------------------

    def load_eagle_library(self, lbr_path: str) -> None:
        """Load an Eagle .lbr file for offline searching.

        Args:
            lbr_path: Path to the .lbr file.
        """
        self._eagle.load_library(lbr_path)
