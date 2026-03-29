"""Tests for the Universal Component Library system.

Tests cover:
- Each provider individually (with mocked HTTP)
- The unified search (parallel execution, deduplication, ranking)
- The component recommender (built-in KB and LLM fallback)
- Eagle .lbr parsing
- EasyEDA format conversion
"""

from __future__ import annotations

import asyncio
import json
import textwrap
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.library.models import (
    ComponentDetail,
    ComponentResult,
    LocalComponent,
    PinInfo,
    Recommendation,
)
from routeai_intelligence.library.snapeda_provider import SnapEDAProvider, SnapEDAResult
from routeai_intelligence.library.lcsc_provider import LCSCProvider, LCSCResult
from routeai_intelligence.library.kicad_lib_provider import KiCadLibProvider, KiCadLibResult
from routeai_intelligence.library.eagle_lib_provider import EagleLibProvider, EagleLibResult
from routeai_intelligence.library.easyeda_provider import EasyEDAProvider, EasyEDAResult
from routeai_intelligence.library.unified_search import UnifiedComponentSearch
from routeai_intelligence.library.recommender import ComponentRecommender


# =========================================================================
# Fixtures
# =========================================================================


@pytest.fixture
def snapeda_search_response() -> dict[str, Any]:
    return {
        "results": [
            {
                "id": "12345",
                "part_number": "STM32F103C8T6",
                "manufacturer": {"name": "STMicroelectronics"},
                "short_description": "ARM Cortex-M3 MCU 72MHz 64KB Flash",
                "has_symbol": True,
                "has_footprint": True,
                "has_3d_model": False,
                "url": "https://www.snapeda.com/parts/STM32F103C8T6",
                "category": "MCU",
                "package": "LQFP-48",
            }
        ]
    }


@pytest.fixture
def jlcsearch_response() -> dict[str, Any]:
    return {
        "components": [
            {
                "lcsc": "C14259",
                "mfr": "STM32F103C8T6",
                "manufacturer": "STMicroelectronics",
                "description": "ARM Cortex-M3 MCU",
                "package": "LQFP-48",
                "stock": 50000,
                "category": "MCU",
                "subcategory": "ARM",
                "price": 2.50,
                "datasheet": "https://example.com/stm32.pdf",
                "prices": [{"qty": 1, "price": 2.50}],
            }
        ]
    }


@pytest.fixture
def easyeda_search_response() -> dict[str, Any]:
    return {
        "result": [
            {
                "uuid": "abc-123",
                "title": "STM32F103C8T6",
                "description": "ARM Cortex-M3",
                "manufacturer": "STMicroelectronics",
                "mpn": "STM32F103C8T6",
                "package": "LQFP-48",
                "lcsc": "C14259",
                "has_symbol": True,
                "has_footprint": True,
                "has_3d_model": False,
            }
        ]
    }


@pytest.fixture
def eagle_lbr_xml() -> str:
    return textwrap.dedent("""\
        <?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE eagle SYSTEM "eagle.dtd">
        <eagle>
        <drawing>
        <library name="test_lib">
            <packages>
                <package name="SOT-23">
                    <smd name="1" x="-0.95" y="-1" dx="0.55" dy="0.7" layer="1"/>
                    <smd name="2" x="0.95" y="-1" dx="0.55" dy="0.7" layer="1"/>
                    <smd name="3" x="0" y="1" dx="0.55" dy="0.7" layer="1"/>
                    <wire x1="-0.7" y1="-0.5" x2="0.7" y2="-0.5" width="0.1" layer="21"/>
                </package>
            </packages>
            <symbols>
                <symbol name="NPN">
                    <pin name="B" x="-5.08" y="0" direction="in"/>
                    <pin name="C" x="0" y="5.08" direction="out"/>
                    <pin name="E" x="0" y="-5.08" direction="out"/>
                </symbol>
            </symbols>
            <devicesets>
                <deviceset name="BC847">
                    <description>NPN transistor SOT-23</description>
                    <gates>
                        <gate name="G1" symbol="NPN"/>
                    </gates>
                    <devices>
                        <device name="" package="SOT-23">
                            <technologies>
                                <technology name=""/>
                            </technologies>
                        </device>
                    </devices>
                </deviceset>
            </devicesets>
        </library>
        </drawing>
        </eagle>
    """)


# =========================================================================
# Model tests
# =========================================================================


class TestModels:
    def test_component_result_creation(self) -> None:
        result = ComponentResult(
            mpn="STM32F103C8T6",
            manufacturer="STMicroelectronics",
            description="ARM Cortex-M3",
            category="MCU",
            package="LQFP-48",
            source="lcsc",
            source_id="C14259",
            has_symbol=True,
            has_footprint=True,
            has_3d_model=False,
            price_usd=2.50,
            stock=50000,
        )
        assert result.mpn == "STM32F103C8T6"
        assert result.source == "lcsc"
        assert result.price_usd == 2.50
        assert result.stock == 50000

    def test_component_detail_inherits(self) -> None:
        detail = ComponentDetail(
            mpn="R_0402",
            manufacturer="",
            description="Resistor",
            category="Device",
            package="0402",
            source="kicad",
            source_id="Device:R",
            has_symbol=True,
            has_footprint=True,
            has_3d_model=False,
            symbol_data="(kicad_symbol_lib ...)",
            footprint_data="(footprint ...)",
            pins=[PinInfo(number="1", name="1", type="passive")],
        )
        assert detail.symbol_data is not None
        assert len(detail.pins) == 1
        assert detail.pins[0].type == "passive"

    def test_recommendation_creation(self) -> None:
        comp = ComponentResult(
            mpn="AP2112K-3.3",
            manufacturer="Diodes Inc",
            description="3.3V 600mA LDO",
            category="voltage_regulator",
            package="SOT-23-5",
            source="local",
            source_id="AP2112K-3.3",
            has_symbol=False,
            has_footprint=False,
            has_3d_model=False,
        )
        rec = Recommendation(
            component=comp,
            reasoning="Low dropout, low Iq",
            trade_offs=["Limited to 600mA"],
            confidence=0.9,
            source="engineering_knowledge",
        )
        assert rec.confidence == 0.9
        assert rec.component.mpn == "AP2112K-3.3"

    def test_local_component(self) -> None:
        local = LocalComponent(
            mpn="STM32F103C8T6",
            manufacturer="STMicroelectronics",
            source="snapeda",
            source_id="12345",
            symbol_path="/tmp/STM32F103C8T6.kicad_sym",
            footprint_path="/tmp/STM32F103C8T6.kicad_mod",
        )
        assert local.symbol_path is not None
        assert local.model_3d_path is None


# =========================================================================
# SnapEDA provider tests
# =========================================================================


class TestSnapEDAProvider:
    @pytest.mark.asyncio
    async def test_search_success(self, snapeda_search_response: dict[str, Any]) -> None:
        provider = SnapEDAProvider(api_key="test-key")

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = snapeda_search_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            results = await provider.search("STM32F103C8T6")

        assert len(results) == 1
        assert results[0].part_number == "STM32F103C8T6"
        assert results[0].manufacturer == "STMicroelectronics"
        assert results[0].has_symbol is True
        assert results[0].part_id == "12345"

    @pytest.mark.asyncio
    async def test_search_timeout_returns_empty(self) -> None:
        provider = SnapEDAProvider(timeout=0.001)

        import httpx

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_client_cls.return_value = mock_client

            results = await provider.search("anything")

        assert results == []

    @pytest.mark.asyncio
    async def test_download_symbol(self) -> None:
        provider = SnapEDAProvider()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.content = b"(kicad_symbol_lib ...)"

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            data = await provider.download_symbol("12345", format="kicad")

        assert data == b"(kicad_symbol_lib ...)"

    @pytest.mark.asyncio
    async def test_download_3d_model_not_found(self) -> None:
        provider = SnapEDAProvider()

        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            data = await provider.download_3d_model("12345")

        assert data is None


# =========================================================================
# LCSC provider tests
# =========================================================================


class TestLCSCProvider:
    @pytest.mark.asyncio
    async def test_search_jlcsearch(self, jlcsearch_response: dict[str, Any]) -> None:
        provider = LCSCProvider()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = jlcsearch_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            results = await provider.search("STM32F103C8T6")

        assert len(results) >= 1
        assert results[0].lcsc_code == "C14259"
        assert results[0].mpn == "STM32F103C8T6"
        assert results[0].stock == 50000
        assert results[0].price_usd == 2.50

    @pytest.mark.asyncio
    async def test_get_part_detail(self, jlcsearch_response: dict[str, Any]) -> None:
        provider = LCSCProvider()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = jlcsearch_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            detail = await provider.get_part_detail("C14259")

        assert detail is not None
        assert detail.lcsc_code == "C14259"
        assert detail.mpn == "STM32F103C8T6"

    @pytest.mark.asyncio
    async def test_search_error_returns_empty(self) -> None:
        provider = LCSCProvider()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=Exception("network error"))
            mock_client_cls.return_value = mock_client

            results = await provider.search("anything")

        assert results == []


# =========================================================================
# KiCad library provider tests
# =========================================================================


class TestKiCadLibProvider:
    def test_search_local_index(self) -> None:
        provider = KiCadLibProvider()
        results = provider.search_local_index("STM32")

        assert len(results) >= 1
        assert any("STM32" in r.name for r in results)

    def test_search_local_index_resistor(self) -> None:
        provider = KiCadLibProvider()
        results = provider.search_local_index("resistor")

        assert len(results) >= 1
        assert results[0].name == "R"

    def test_search_local_index_empty_query(self) -> None:
        provider = KiCadLibProvider()
        results = provider.search_local_index("")
        assert results == []

    def test_add_to_index(self) -> None:
        provider = KiCadLibProvider()
        provider.add_to_index([
            {"name": "MY_CUSTOM_PART", "lib": "Custom", "desc": "Test part", "cat": "Test"},
        ])
        results = provider.search_local_index("MY_CUSTOM_PART")
        assert len(results) == 1
        assert results[0].name == "MY_CUSTOM_PART"

    @pytest.mark.asyncio
    async def test_search_online_fallback_to_local(self) -> None:
        """When GitHub API fails, should fall back to local index."""
        provider = KiCadLibProvider()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=Exception("rate limited"))
            mock_client_cls.return_value = mock_client

            results = await provider.search("STM32")

        assert len(results) >= 1

    @pytest.mark.asyncio
    async def test_get_symbol_error_returns_empty(self) -> None:
        provider = KiCadLibProvider()

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=Exception("not found"))
            mock_client_cls.return_value = mock_client

            result = await provider.get_symbol("Device", "R")

        assert result == ""


# =========================================================================
# Eagle library provider tests
# =========================================================================


class TestEagleLibProvider:
    def test_load_library(self, eagle_lbr_xml: str, tmp_path: Any) -> None:
        lbr_file = tmp_path / "test.lbr"
        lbr_file.write_text(eagle_lbr_xml)

        provider = EagleLibProvider()
        provider.load_library(str(lbr_file))

        assert "test_lib" in provider.loaded_libraries

    def test_search(self, eagle_lbr_xml: str, tmp_path: Any) -> None:
        lbr_file = tmp_path / "test.lbr"
        lbr_file.write_text(eagle_lbr_xml)

        provider = EagleLibProvider()
        provider.load_library(str(lbr_file))

        results = provider.search("BC847")
        assert len(results) >= 1
        assert results[0].name == "BC847"
        assert results[0].package == "SOT-23"
        assert results[0].has_symbol is True
        assert results[0].has_footprint is True

    def test_search_no_match(self, eagle_lbr_xml: str, tmp_path: Any) -> None:
        lbr_file = tmp_path / "test.lbr"
        lbr_file.write_text(eagle_lbr_xml)

        provider = EagleLibProvider()
        provider.load_library(str(lbr_file))

        results = provider.search("NONEXISTENT_PART")
        assert results == []

    def test_get_component(self, eagle_lbr_xml: str, tmp_path: Any) -> None:
        lbr_file = tmp_path / "test.lbr"
        lbr_file.write_text(eagle_lbr_xml)

        provider = EagleLibProvider()
        provider.load_library(str(lbr_file))

        comp = provider.get_component("test_lib", "BC847")
        assert comp is not None
        assert comp.name == "BC847"
        assert comp.symbol_name == "NPN"
        assert len(comp.pins) == 3
        assert comp.pins[0]["name"] == "B"

    def test_get_component_not_found(self, eagle_lbr_xml: str, tmp_path: Any) -> None:
        lbr_file = tmp_path / "test.lbr"
        lbr_file.write_text(eagle_lbr_xml)

        provider = EagleLibProvider()
        provider.load_library(str(lbr_file))

        comp = provider.get_component("test_lib", "DOES_NOT_EXIST")
        assert comp is None

    def test_load_nonexistent_file(self) -> None:
        provider = EagleLibProvider()
        with pytest.raises(FileNotFoundError):
            provider.load_library("/nonexistent/path.lbr")

    def test_search_empty_no_libraries(self) -> None:
        provider = EagleLibProvider()
        results = provider.search("anything")
        assert results == []


# =========================================================================
# EasyEDA provider tests
# =========================================================================


class TestEasyEDAProvider:
    @pytest.mark.asyncio
    async def test_search(self, easyeda_search_response: dict[str, Any]) -> None:
        provider = EasyEDAProvider()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = easyeda_search_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            results = await provider.search("STM32F103")

        assert len(results) == 1
        assert results[0].mpn == "STM32F103C8T6"
        assert results[0].uuid == "abc-123"

    @pytest.mark.asyncio
    async def test_search_timeout(self) -> None:
        provider = EasyEDAProvider(timeout=0.001)

        import httpx

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_client_cls.return_value = mock_client

            results = await provider.search("anything")

        assert results == []

    @pytest.mark.asyncio
    async def test_convert_to_kicad_empty_component(self) -> None:
        provider = EasyEDAProvider()
        from routeai_intelligence.library.easyeda_provider import EasyEDAComponent

        comp = EasyEDAComponent(
            uuid="test",
            title="Test",
            description="",
            manufacturer="",
            mpn="TEST",
            package="",
            lcsc_code="",
            symbol_json={},
            footprint_json={},
        )
        symbol, footprint = await provider.convert_to_kicad(comp)
        assert symbol == ""
        assert footprint == ""

    @pytest.mark.asyncio
    async def test_convert_to_kicad_with_data(self) -> None:
        provider = EasyEDAProvider()
        from routeai_intelligence.library.easyeda_provider import EasyEDAComponent

        comp = EasyEDAComponent(
            uuid="test",
            title="Test Part",
            description="A test",
            manufacturer="TestCo",
            mpn="TEST123",
            package="SOIC-8",
            lcsc_code="C12345",
            symbol_json={"shape": ["P~VCC~1~power"]},
            footprint_json={"shape": ["PAD~RECT~0~0~10~10~1~net~1~"]},
            pins=[{"name": "VCC", "number": "1", "type": "power"}],
        )
        symbol, footprint = await provider.convert_to_kicad(comp)
        assert "kicad_symbol_lib" in symbol
        assert "TEST123" in symbol
        assert "footprint" in footprint


# =========================================================================
# Unified search tests
# =========================================================================


class TestUnifiedComponentSearch:
    @pytest.mark.asyncio
    async def test_search_empty_query(self) -> None:
        search = UnifiedComponentSearch()
        results = await search.search("")
        assert results == []

    @pytest.mark.asyncio
    async def test_deduplication(self) -> None:
        search = UnifiedComponentSearch()

        r1 = ComponentResult(
            mpn="STM32F103C8T6",
            manufacturer="STMicroelectronics",
            description="ARM MCU",
            category="MCU",
            package="LQFP-48",
            source="lcsc",
            source_id="C14259",
            has_symbol=False,
            has_footprint=True,
            has_3d_model=False,
            price_usd=2.50,
            stock=50000,
        )
        r2 = ComponentResult(
            mpn="STM32F103C8T6",
            manufacturer="STMicroelectronics",
            description="ARM Cortex-M3",
            category="MCU",
            package="LQFP-48",
            source="snapeda",
            source_id="12345",
            has_symbol=True,
            has_footprint=True,
            has_3d_model=False,
            datasheet_url="https://example.com/ds.pdf",
        )

        deduped = search._deduplicate([r1, r2])
        assert len(deduped) == 1
        # Merged: should have both price and datasheet
        merged = deduped[0]
        assert merged.price_usd == 2.50
        assert merged.datasheet_url == "https://example.com/ds.pdf"
        assert merged.has_symbol is True

    @pytest.mark.asyncio
    async def test_ranking_prefers_in_stock(self) -> None:
        search = UnifiedComponentSearch()

        in_stock = ComponentResult(
            mpn="PART_A",
            manufacturer="Mfr",
            description="Part A",
            category="IC",
            package="SOIC-8",
            source="lcsc",
            source_id="C1",
            has_symbol=False,
            has_footprint=True,
            has_3d_model=False,
            stock=10000,
            price_usd=1.0,
        )
        out_of_stock = ComponentResult(
            mpn="PART_B",
            manufacturer="Mfr",
            description="Part B",
            category="IC",
            package="SOIC-8",
            source="kicad",
            source_id="Device:PART_B",
            has_symbol=True,
            has_footprint=True,
            has_3d_model=False,
            stock=0,
        )

        ranked = search._rank([out_of_stock, in_stock])
        assert ranked[0].mpn == "PART_A"  # In-stock should be first

    @pytest.mark.asyncio
    async def test_filters(self) -> None:
        search = UnifiedComponentSearch()

        results = [
            ComponentResult(
                mpn="R_0402",
                manufacturer="",
                description="Resistor 10k",
                category="resistor",
                package="0402",
                source="kicad",
                source_id="Device:R",
                has_symbol=True,
                has_footprint=True,
                has_3d_model=False,
            ),
            ComponentResult(
                mpn="C_0402",
                manufacturer="",
                description="Capacitor 100nF",
                category="capacitor",
                package="0402",
                source="kicad",
                source_id="Device:C",
                has_symbol=True,
                has_footprint=True,
                has_3d_model=False,
            ),
        ]

        filtered = search._apply_filters(results, {"category": "resistor"})
        assert len(filtered) == 1
        assert filtered[0].mpn == "R_0402"

    @pytest.mark.asyncio
    async def test_filter_by_package(self) -> None:
        search = UnifiedComponentSearch()

        results = [
            ComponentResult(
                mpn="R_0402", manufacturer="", description="Resistor",
                category="resistor", package="0402", source="kicad",
                source_id="a", has_symbol=True, has_footprint=True, has_3d_model=False,
            ),
            ComponentResult(
                mpn="R_0805", manufacturer="", description="Resistor",
                category="resistor", package="0805", source="kicad",
                source_id="b", has_symbol=True, has_footprint=True, has_3d_model=False,
            ),
        ]

        filtered = search._apply_filters(results, {"package": "0402"})
        assert len(filtered) == 1
        assert filtered[0].mpn == "R_0402"

    @pytest.mark.asyncio
    async def test_cache(self) -> None:
        search = UnifiedComponentSearch()
        key = "test_query"
        results = [
            ComponentResult(
                mpn="X", manufacturer="", description="", category="",
                package="", source="local", source_id="x",
                has_symbol=False, has_footprint=False, has_3d_model=False,
            )
        ]
        search._set_cache(key, results)
        cached = search._get_cached(key)
        assert cached is not None
        assert len(cached) == 1
        assert cached[0].mpn == "X"

    @pytest.mark.asyncio
    async def test_clear_cache(self) -> None:
        search = UnifiedComponentSearch()
        search._set_cache("key1", [])
        search.clear_cache()
        assert search._get_cached("key1") is None

    @pytest.mark.asyncio
    async def test_search_with_failing_providers(self) -> None:
        """Verify that one failing provider does not break the whole search."""
        search = UnifiedComponentSearch()

        # Mock all providers to fail except kicad
        with patch.object(search, "_search_snapeda", side_effect=Exception("fail")), \
             patch.object(search, "_search_lcsc", side_effect=Exception("fail")), \
             patch.object(search, "_search_easyeda", side_effect=Exception("fail")), \
             patch.object(search, "_search_eagle", return_value=[]), \
             patch.object(search, "_search_kicad", return_value=[
                 ComponentResult(
                     mpn="STM32F103C8T6", manufacturer="", description="MCU",
                     category="MCU", package="LQFP-48", source="kicad",
                     source_id="MCU_ST:STM32F103C8T6",
                     has_symbol=True, has_footprint=True, has_3d_model=False,
                 )
             ]):
            results = await search.search("STM32F103C8T6")

        assert len(results) >= 1
        assert results[0].mpn == "STM32F103C8T6"


# =========================================================================
# Recommender tests
# =========================================================================


class TestComponentRecommender:
    @pytest.mark.asyncio
    async def test_recommend_ldo(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend("3.3V LDO, 500mA, low noise")

        assert len(recs) >= 1
        # Should include AP2112K or AMS1117
        mpns = [r.component.mpn for r in recs]
        assert any("AP2112" in m or "AMS1117" in m for m in mpns)
        assert all(r.confidence > 0 for r in recs)
        assert all(r.reasoning for r in recs)

    @pytest.mark.asyncio
    async def test_recommend_buck(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend("buck converter 3A 12V to 3.3V")

        assert len(recs) >= 1
        mpns = [r.component.mpn for r in recs]
        assert any("TPS54331" in m or "MP2315" in m for m in mpns)

    @pytest.mark.asyncio
    async def test_recommend_esd(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend("USB ESD protection")

        assert len(recs) >= 1
        assert any("USBLC6" in r.component.mpn for r in recs)

    @pytest.mark.asyncio
    async def test_recommend_no_match_without_search(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend("quantum flux capacitor")
        assert recs == []

    @pytest.mark.asyncio
    async def test_recommend_with_constraints(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend(
            "3.3V LDO",
            constraints={"package_size": "SOT-23"},
        )
        # Should still return results (the built-in KB has SOT-23 packages)
        assert len(recs) >= 1

    @pytest.mark.asyncio
    async def test_suggest_alternatives_without_search(self) -> None:
        recommender = ComponentRecommender()
        comp = ComponentResult(
            mpn="AMS1117-3.3",
            manufacturer="AMS",
            description="3.3V LDO",
            category="voltage_regulator",
            package="SOT-223",
            source="local",
            source_id="AMS1117-3.3",
            has_symbol=False,
            has_footprint=False,
            has_3d_model=False,
        )
        alts = await recommender.suggest_alternatives(comp, reason="cost")
        # Without search or LLM, should return empty
        assert alts == []

    @pytest.mark.asyncio
    async def test_recommend_sorted_by_confidence(self) -> None:
        recommender = ComponentRecommender()
        recs = await recommender.recommend("3.3V LDO")

        if len(recs) >= 2:
            for i in range(len(recs) - 1):
                assert recs[i].confidence >= recs[i + 1].confidence
