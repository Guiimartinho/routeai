"""Unified data models for the Universal Component Library.

These models provide a source-agnostic representation of components from
any provider (SnapEDA, LCSC, KiCad, Eagle, EasyEDA, local DB).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class PinInfo:
    """A single pin on a component."""

    number: str
    name: str
    type: str  # input, output, passive, power, bidirectional, etc.


@dataclass
class ComponentResult:
    """A component search result from any source.

    Provides enough information to display in a search result list and
    decide whether to download the full detail.
    """

    mpn: str
    manufacturer: str
    description: str
    category: str  # resistor, capacitor, ic, connector, etc.
    package: str  # 0402, SOIC-8, QFP-48, etc.
    source: str  # "snapeda", "lcsc", "kicad", "eagle", "easyeda", "local"
    source_id: str
    has_symbol: bool
    has_footprint: bool
    has_3d_model: bool
    datasheet_url: str | None = None
    price_usd: float | None = None
    stock: int | None = None
    specs: dict[str, str] = field(default_factory=dict)


@dataclass
class ComponentDetail(ComponentResult):
    """Full component detail including symbol/footprint data.

    Extended from ComponentResult with downloadable asset data and pin info.
    """

    symbol_data: str | None = None  # KiCad S-expression or SVG
    footprint_data: str | None = None  # KiCad S-expression
    model_3d_data: bytes | None = None  # STEP/WRL binary
    pins: list[PinInfo] = field(default_factory=list)


@dataclass
class LocalComponent:
    """A component downloaded and cached in the local library.

    After downloading from an external source, the symbol and footprint
    files are stored locally for offline use.
    """

    mpn: str
    manufacturer: str
    source: str
    source_id: str
    symbol_path: str | None = None  # Path to local .kicad_sym file
    footprint_path: str | None = None  # Path to local .kicad_mod file
    model_3d_path: str | None = None  # Path to local .step / .wrl file
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass
class Recommendation:
    """An LLM-generated component recommendation with reasoning."""

    component: ComponentResult
    reasoning: str  # "AMS1117 is cheaper but AP2112 has lower dropout voltage"
    trade_offs: list[str] = field(default_factory=list)
    confidence: float = 0.0
    source: str = ""  # "datasheet comparison", "engineering knowledge", etc.
