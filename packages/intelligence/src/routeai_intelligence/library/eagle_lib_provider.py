"""Eagle/Fusion library (.lbr) search provider.

Parses Eagle .lbr XML files (which contain <packages>, <symbols>, and
<devicesets> sections) and provides search across loaded libraries.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class EagleLibResult:
    """A search result from an Eagle library."""

    name: str
    lib_name: str
    description: str
    package: str
    has_symbol: bool
    has_footprint: bool
    device_name: str
    category: str = ""


@dataclass
class EagleComponent:
    """A component from an Eagle library with full detail."""

    name: str
    lib_name: str
    description: str
    package: str
    symbol_name: str
    symbol_xml: str  # Raw XML of the <symbol> element
    package_xml: str  # Raw XML of the <package> element
    pins: list[dict[str, str]] = field(default_factory=list)
    technologies: list[str] = field(default_factory=list)


class EagleLibProvider:
    """Parse and search Eagle .lbr library files.

    Eagle .lbr files are XML-based and contain three main sections:
    - ``<packages>``: Physical footprint definitions
    - ``<symbols>``: Schematic symbol definitions
    - ``<devicesets>``: Logical component definitions mapping symbols to packages

    Usage::

        provider = EagleLibProvider()
        provider.load_library("/path/to/my_lib.lbr")
        results = provider.search("STM32")
        comp = provider.get_component("my_lib", "STM32F103C8T6")
    """

    def __init__(self) -> None:
        self._libraries: dict[str, _ParsedLibrary] = {}

    def load_library(self, lbr_path: str) -> None:
        """Load an Eagle .lbr file into the search index.

        Args:
            lbr_path: Path to the .lbr file.

        Raises:
            FileNotFoundError: If the file does not exist.
            ValueError: If the file is not a valid Eagle .lbr file.
        """
        path = Path(lbr_path)
        if not path.exists():
            raise FileNotFoundError(f"Eagle library not found: {lbr_path}")

        try:
            tree = ET.parse(path)
            root = tree.getroot()
        except ET.ParseError as exc:
            raise ValueError(f"Invalid Eagle library XML: {exc}") from exc

        drawing = root.find("drawing")
        if drawing is None:
            raise ValueError("Not a valid Eagle .lbr file: missing <drawing>")

        library_el = drawing.find("library")
        if library_el is None:
            raise ValueError("Not a valid Eagle .lbr file: missing <library>")

        lib_name = library_el.get("name", path.stem)
        parsed = _ParsedLibrary(name=lib_name, path=str(path))

        # Parse packages
        packages_el = library_el.find("packages")
        if packages_el is not None:
            for pkg_el in packages_el.findall("package"):
                pkg_name = pkg_el.get("name", "")
                desc = pkg_el.get("description", "")
                if not desc:
                    desc_el = pkg_el.find("description")
                    desc = (desc_el.text or "") if desc_el is not None else ""
                parsed.packages[pkg_name] = _PackageInfo(
                    name=pkg_name,
                    description=_strip_html(desc),
                    xml=ET.tostring(pkg_el, encoding="unicode"),
                )

        # Parse symbols
        symbols_el = library_el.find("symbols")
        if symbols_el is not None:
            for sym_el in symbols_el.findall("symbol"):
                sym_name = sym_el.get("name", "")
                pins: list[dict[str, str]] = []
                for pin_el in sym_el.findall("pin"):
                    pins.append({
                        "name": pin_el.get("name", ""),
                        "direction": pin_el.get("direction", "io"),
                    })
                parsed.symbols[sym_name] = _SymbolInfo(
                    name=sym_name,
                    xml=ET.tostring(sym_el, encoding="unicode"),
                    pins=pins,
                )

        # Parse devicesets
        devicesets_el = library_el.find("devicesets")
        if devicesets_el is not None:
            for ds_el in devicesets_el.findall("deviceset"):
                ds_name = ds_el.get("name", "")
                desc = ds_el.get("description", "")
                if not desc:
                    desc_el = ds_el.find("description")
                    desc = (desc_el.text or "") if desc_el is not None else ""

                # Gates -> symbol mapping
                gate_symbols: list[str] = []
                gates_el = ds_el.find("gates")
                if gates_el is not None:
                    for gate_el in gates_el.findall("gate"):
                        gate_symbols.append(gate_el.get("symbol", ""))

                # Devices -> package mapping
                devices_el = ds_el.find("devices")
                device_list: list[_DeviceInfo] = []
                if devices_el is not None:
                    for dev_el in devices_el.findall("device"):
                        dev_name = dev_el.get("name", "")
                        dev_package = dev_el.get("package", "")
                        techs: list[str] = []
                        techs_el = dev_el.find("technologies")
                        if techs_el is not None:
                            for tech_el in techs_el.findall("technology"):
                                techs.append(tech_el.get("name", ""))
                        device_list.append(_DeviceInfo(
                            name=dev_name,
                            package=dev_package,
                            technologies=techs,
                        ))

                parsed.devicesets[ds_name] = _DeviceSetInfo(
                    name=ds_name,
                    description=_strip_html(desc),
                    gate_symbols=gate_symbols,
                    devices=device_list,
                )

        self._libraries[lib_name] = parsed
        logger.info(
            "Loaded Eagle library '%s': %d packages, %d symbols, %d devicesets",
            lib_name,
            len(parsed.packages),
            len(parsed.symbols),
            len(parsed.devicesets),
        )

    def search(self, query: str, limit: int = 20) -> list[EagleLibResult]:
        """Search across all loaded Eagle libraries.

        Performs token-based matching against deviceset names, descriptions,
        and package names.

        Args:
            query: Search string.
            limit: Maximum results.

        Returns:
            List of EagleLibResult ranked by relevance.
        """
        tokens = re.findall(r"\w+", query.lower())
        if not tokens:
            return []

        scored: list[tuple[float, EagleLibResult]] = []

        for lib_name, lib in self._libraries.items():
            for ds_name, ds in lib.devicesets.items():
                for dev in ds.devices:
                    full_name = f"{ds_name}{dev.name}" if dev.name else ds_name
                    searchable = (
                        f"{full_name} {ds.description} {dev.package}"
                    ).lower()

                    score = 0.0
                    for tok in tokens:
                        if tok in searchable:
                            score += 1.0
                            if tok in full_name.lower():
                                score += 2.0

                    if score > 0:
                        has_symbol = bool(ds.gate_symbols and any(
                            s in lib.symbols for s in ds.gate_symbols
                        ))
                        has_fp = dev.package in lib.packages

                        scored.append((
                            score / (len(tokens) * 3),
                            EagleLibResult(
                                name=full_name,
                                lib_name=lib_name,
                                description=ds.description,
                                package=dev.package,
                                has_symbol=has_symbol,
                                has_footprint=has_fp,
                                device_name=full_name,
                            ),
                        ))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored[:limit]]

    def get_component(self, lib_name: str, device_name: str) -> EagleComponent | None:
        """Get full component detail from a loaded Eagle library.

        Args:
            lib_name: The library name (as loaded).
            device_name: The full device name (deviceset + device suffix).

        Returns:
            EagleComponent with symbol/package XML, or None if not found.
        """
        lib = self._libraries.get(lib_name)
        if lib is None:
            logger.warning("Eagle library '%s' not loaded", lib_name)
            return None

        # Find deviceset that matches
        for ds_name, ds in lib.devicesets.items():
            for dev in ds.devices:
                full_name = f"{ds_name}{dev.name}" if dev.name else ds_name
                if full_name.lower() == device_name.lower():
                    # Get symbol
                    sym_name = ds.gate_symbols[0] if ds.gate_symbols else ""
                    sym_info = lib.symbols.get(sym_name)
                    sym_xml = sym_info.xml if sym_info else ""
                    pins = sym_info.pins if sym_info else []

                    # Get package
                    pkg_info = lib.packages.get(dev.package)
                    pkg_xml = pkg_info.xml if pkg_info else ""

                    return EagleComponent(
                        name=full_name,
                        lib_name=lib_name,
                        description=ds.description,
                        package=dev.package,
                        symbol_name=sym_name,
                        symbol_xml=sym_xml,
                        package_xml=pkg_xml,
                        pins=pins,
                        technologies=dev.technologies,
                    )

        logger.warning("Device '%s' not found in library '%s'", device_name, lib_name)
        return None

    @property
    def loaded_libraries(self) -> list[str]:
        """Return names of all loaded libraries."""
        return list(self._libraries.keys())


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------


@dataclass
class _PackageInfo:
    name: str
    description: str
    xml: str


@dataclass
class _SymbolInfo:
    name: str
    xml: str
    pins: list[dict[str, str]] = field(default_factory=list)


@dataclass
class _DeviceInfo:
    name: str
    package: str
    technologies: list[str] = field(default_factory=list)


@dataclass
class _DeviceSetInfo:
    name: str
    description: str
    gate_symbols: list[str] = field(default_factory=list)
    devices: list[_DeviceInfo] = field(default_factory=list)


@dataclass
class _ParsedLibrary:
    name: str
    path: str
    packages: dict[str, _PackageInfo] = field(default_factory=dict)
    symbols: dict[str, _SymbolInfo] = field(default_factory=dict)
    devicesets: dict[str, _DeviceSetInfo] = field(default_factory=dict)


def _strip_html(text: str) -> str:
    """Remove HTML tags from Eagle description strings."""
    return re.sub(r"<[^>]+>", "", text).strip()
