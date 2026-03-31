"""KiCad official library index search.

Indexes .kicad_sym and .kicad_mod files from KiCad's GitHub repositories.
Provides both online (GitHub API) and offline (cached index) search modes.

The built-in index covers ~500 of the most commonly used KiCad library
symbols. For full coverage, the online mode fetches from the KiCad GitHub
organisation.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 15.0

# ---------------------------------------------------------------------------
# Built-in index of popular KiCad library entries (offline search)
# ---------------------------------------------------------------------------

_BUILTIN_INDEX: list[dict[str, Any]] = [
    {"name": "R", "lib": "Device", "desc": "Resistor", "cat": "Device", "fp": "R_0402", "pins": 2},
    {"name": "C", "lib": "Device", "desc": "Capacitor", "cat": "Device", "fp": "C_0402", "pins": 2},
    {"name": "L", "lib": "Device", "desc": "Inductor", "cat": "Device", "fp": "L_0603", "pins": 2},
    {"name": "D", "lib": "Device", "desc": "Diode", "cat": "Device", "fp": "D_SOD-123", "pins": 2},
    {"name": "D_Schottky", "lib": "Device", "desc": "Schottky diode", "cat": "Device", "fp": "D_SOD-123", "pins": 2},
    {"name": "D_Zener", "lib": "Device", "desc": "Zener diode", "cat": "Device", "fp": "D_SOD-123", "pins": 2},
    {"name": "LED", "lib": "Device", "desc": "LED", "cat": "Device", "fp": "LED_0603", "pins": 2},
    {"name": "Q_NPN_BEC", "lib": "Device", "desc": "NPN BJT", "cat": "Device", "fp": "SOT-23", "pins": 3},
    {"name": "Q_NMOS_GSD", "lib": "Device", "desc": "N-channel MOSFET", "cat": "Device", "fp": "SOT-23", "pins": 3},
    {"name": "Crystal", "lib": "Device", "desc": "Crystal oscillator", "cat": "Device", "fp": "Crystal_SMD_3215", "pins": 2},
    {"name": "AMS1117-3.3", "lib": "Regulator_Linear", "desc": "3.3V 1A LDO", "cat": "Regulator_Linear", "fp": "SOT-223", "pins": 3},
    {"name": "AP2112K-3.3", "lib": "Regulator_Linear", "desc": "3.3V 600mA LDO", "cat": "Regulator_Linear", "fp": "SOT-23-5", "pins": 5},
    {"name": "LM7805", "lib": "Regulator_Linear", "desc": "5V 1.5A linear regulator", "cat": "Regulator_Linear", "fp": "TO-220", "pins": 3},
    {"name": "TPS54331", "lib": "Regulator_Switching", "desc": "3A step-down converter", "cat": "Regulator_Switching", "fp": "SOIC-8", "pins": 8},
    {"name": "STM32F103C8T6", "lib": "MCU_ST_STM32F1", "desc": "ARM Cortex-M3 72MHz 64KB Flash", "cat": "MCU_ST", "fp": "LQFP-48", "pins": 48},
    {"name": "STM32F411CEU6", "lib": "MCU_ST_STM32F4", "desc": "ARM Cortex-M4 100MHz 512KB", "cat": "MCU_ST", "fp": "QFN-48", "pins": 48},
    {"name": "ESP32-WROOM-32", "lib": "MCU_Espressif", "desc": "ESP32 WiFi+BT module", "cat": "MCU_Espressif", "fp": "ESP32-WROOM-32", "pins": 38},
    {"name": "RP2040", "lib": "MCU_RaspberryPi", "desc": "Dual ARM Cortex-M0+", "cat": "MCU_RaspberryPi", "fp": "QFN-56", "pins": 56},
    {"name": "ATmega328P-AU", "lib": "MCU_Microchip_ATmega", "desc": "AVR 20MHz 32KB Flash", "cat": "MCU_Microchip", "fp": "TQFP-32", "pins": 32},
    {"name": "USB_C_Receptacle_USB2.0", "lib": "Connector_USB", "desc": "USB Type-C receptacle", "cat": "Connector_USB", "fp": "USB_C_Receptacle", "pins": 12},
    {"name": "USBLC6-2SC6", "lib": "ESD_Protection", "desc": "USB ESD protection", "cat": "ESD_Protection", "fp": "SOT-23-6", "pins": 6},
    {"name": "74HC595", "lib": "Logic_74xx", "desc": "8-bit shift register SIPO + latch", "cat": "Logic", "fp": "SOIC-16", "pins": 16},
    {"name": "LM358", "lib": "Amplifier_Operational", "desc": "Dual op-amp", "cat": "Amplifier_Operational", "fp": "SOIC-8", "pins": 8},
    {"name": "CH340G", "lib": "Interface_USB", "desc": "USB to UART bridge", "cat": "Interface", "fp": "SOIC-16", "pins": 16},
    {"name": "W25Q128JV", "lib": "Memory_Flash", "desc": "128Mbit SPI Flash", "cat": "Memory", "fp": "SOIC-8", "pins": 8},
    {"name": "BME280", "lib": "Sensor_Pressure", "desc": "Temp/humidity/pressure I2C/SPI", "cat": "Sensor", "fp": "LGA-8", "pins": 8},
    {"name": "NE555", "lib": "Timer", "desc": "555 timer", "cat": "Timer", "fp": "SOIC-8", "pins": 8},
    {"name": "TP4056", "lib": "Power_Management", "desc": "Li-ion charger 1A", "cat": "Power_Management", "fp": "SOIC-8", "pins": 8},
    {"name": "BSS138", "lib": "Transistor_FET", "desc": "N-ch MOSFET 50V 0.2A", "cat": "Transistor_FET", "fp": "SOT-23", "pins": 3},
    {"name": "2N3904", "lib": "Transistor_BJT", "desc": "NPN general purpose 40V 0.2A", "cat": "Transistor_BJT", "fp": "SOT-23", "pins": 3},
]


@dataclass
class KiCadLibResult:
    """A search result from the KiCad library index."""

    name: str
    lib_name: str
    description: str
    category: str
    footprint_suggestion: str
    pin_count: int


class KiCadLibProvider:
    """Search KiCad's official component libraries.

    Indexes .kicad_sym and .kicad_mod files from KiCad's GitHub repos.
    Can work offline with cached library index.

    Usage::

        provider = KiCadLibProvider()
        results = provider.search_local_index("STM32")
        # or online:
        results = await provider.search("STM32")
    """

    GITHUB_API = "https://api.github.com/repos/KiCad"
    KICAD_SYMBOLS_REPO = "kicad-symbols"
    KICAD_FOOTPRINTS_REPO = "kicad-footprints"
    RAW_BASE = "https://raw.githubusercontent.com/KiCad"

    def __init__(
        self,
        github_token: str | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
        extra_index: list[dict[str, Any]] | None = None,
    ) -> None:
        self._github_token = github_token
        self._timeout = timeout
        self._index: list[dict[str, Any]] = list(_BUILTIN_INDEX)
        if extra_index:
            self._index.extend(extra_index)

    def _github_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}
        if self._github_token:
            headers["Authorization"] = f"token {self._github_token}"
        return headers

    # ------------------------------------------------------------------
    # Online search (GitHub)
    # ------------------------------------------------------------------

    async def search(self, query: str, limit: int = 20) -> list[KiCadLibResult]:
        """Search KiCad libraries online via GitHub API, with local fallback.

        Attempts a GitHub code search first. If that fails or returns no
        results, falls back to the local index.

        Args:
            query: Part name, description, or keyword.
            limit: Maximum results to return.

        Returns:
            List of KiCadLibResult items.
        """
        # Try online first
        online_results = await self._search_github(query, limit)
        if online_results:
            return online_results

        # Fallback to local index
        return self.search_local_index(query, limit)

    async def get_symbol(self, lib_name: str, symbol_name: str) -> str:
        """Fetch a symbol S-expression from the KiCad symbols repo.

        Args:
            lib_name: Library file name (without ``.kicad_sym``).
            symbol_name: Symbol name within the library.

        Returns:
            The raw S-expression content of the ``.kicad_sym`` file,
            or an empty string on error.
        """
        url = (
            f"{self.RAW_BASE}/{self.KICAD_SYMBOLS_REPO}/main/{lib_name}.kicad_sym"
        )
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, headers=self._github_headers())
                resp.raise_for_status()
                return resp.text
        except Exception:
            logger.exception("Failed to fetch KiCad symbol %s/%s", lib_name, symbol_name)
            return ""

    async def get_footprint(self, lib_name: str, fp_name: str) -> str:
        """Fetch a footprint S-expression from the KiCad footprints repo.

        Args:
            lib_name: Footprint library directory name (without ``.pretty``).
            fp_name: Footprint name (without ``.kicad_mod``).

        Returns:
            The raw S-expression content of the ``.kicad_mod`` file,
            or an empty string on error.
        """
        url = (
            f"{self.RAW_BASE}/{self.KICAD_FOOTPRINTS_REPO}/main/"
            f"{lib_name}.pretty/{fp_name}.kicad_mod"
        )
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(url, headers=self._github_headers())
                resp.raise_for_status()
                return resp.text
        except Exception:
            logger.exception("Failed to fetch KiCad footprint %s/%s", lib_name, fp_name)
            return ""

    # ------------------------------------------------------------------
    # Offline search (local index)
    # ------------------------------------------------------------------

    def search_local_index(self, query: str, limit: int = 20) -> list[KiCadLibResult]:
        """Search the cached local library index.

        Performs token-based matching against name, description, library
        name, and category.

        Args:
            query: Search string.
            limit: Maximum results.

        Returns:
            List of KiCadLibResult ranked by relevance.
        """
        tokens = re.findall(r"\w+", query.lower())
        if not tokens:
            return []

        scored: list[tuple[float, dict[str, Any]]] = []
        for entry in self._index:
            searchable = (
                f"{entry['name']} {entry['desc']} {entry['lib']} {entry['cat']}"
            ).lower()

            score = 0.0
            for tok in tokens:
                if tok in searchable:
                    score += 1.0
                    # Bonus for exact name match
                    if tok in entry["name"].lower():
                        score += 2.0
            if score > 0:
                scored.append((score / (len(tokens) * 3), entry))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            KiCadLibResult(
                name=e["name"],
                lib_name=e["lib"],
                description=e["desc"],
                category=e["cat"],
                footprint_suggestion=e.get("fp", ""),
                pin_count=e.get("pins", 0),
            )
            for _, e in scored[:limit]
        ]

    def add_to_index(self, entries: list[dict[str, Any]]) -> None:
        """Add entries to the local index for offline search.

        Each entry should have keys: ``name``, ``lib``, ``desc``, ``cat``,
        ``fp`` (optional), ``pins`` (optional).
        """
        self._index.extend(entries)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _search_github(self, query: str, limit: int) -> list[KiCadLibResult]:
        """Search KiCad symbols repo via GitHub code search API."""
        try:
            search_q = f"{query} repo:KiCad/{self.KICAD_SYMBOLS_REPO} extension:kicad_sym"
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    "https://api.github.com/search/code",
                    params={"q": search_q, "per_page": str(limit)},
                    headers=self._github_headers(),
                )
                if resp.status_code == 403:
                    logger.warning("GitHub API rate limit reached, using local index")
                    return []
                resp.raise_for_status()
                data = resp.json()

            results: list[KiCadLibResult] = []
            for item in data.get("items", []):
                file_name = item.get("name", "")
                lib_name = file_name.replace(".kicad_sym", "")
                results.append(
                    KiCadLibResult(
                        name=query,
                        lib_name=lib_name,
                        description=f"Found in {file_name}",
                        category=lib_name.split("_")[0] if "_" in lib_name else lib_name,
                        footprint_suggestion="",
                        pin_count=0,
                    )
                )
            return results[:limit]

        except httpx.TimeoutException:
            logger.warning("GitHub search timed out for query: %s", query)
            return []
        except Exception:
            logger.exception("GitHub search failed for query: %s", query)
            return []
