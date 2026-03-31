"""EasyEDA/LCSC component library search and format conversion.

EasyEDA shares its component library with LCSC. This provider fetches
EasyEDA-format symbols and footprints and converts them to KiCad format
for use in RouteAI.

API: https://easyeda.com/api/components/search
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 10.0


@dataclass
class EasyEDAResult:
    """A search result from EasyEDA."""

    uuid: str
    title: str
    description: str
    manufacturer: str
    mpn: str
    package: str
    lcsc_code: str
    has_symbol: bool
    has_footprint: bool
    has_3d_model: bool
    datasheet_url: str | None = None
    image_url: str | None = None


@dataclass
class EasyEDAComponent:
    """Full EasyEDA component with raw symbol/footprint data."""

    uuid: str
    title: str
    description: str
    manufacturer: str
    mpn: str
    package: str
    lcsc_code: str
    symbol_json: dict[str, Any] = field(default_factory=dict)
    footprint_json: dict[str, Any] = field(default_factory=dict)
    model_3d_url: str | None = None
    pins: list[dict[str, str]] = field(default_factory=list)
    datasheet_url: str | None = None


class EasyEDAProvider:
    """EasyEDA component library search.

    EasyEDA shares component library with LCSC. This provider fetches
    EasyEDA-format symbols/footprints and converts them to KiCad format.

    Usage::

        provider = EasyEDAProvider()
        results = await provider.search("STM32F103")
        comp = await provider.get_component(results[0].uuid)
        symbol_sexpr, footprint_sexpr = await provider.convert_to_kicad(comp)
    """

    SEARCH_URL = "https://easyeda.com/api/components/search"
    COMPONENT_URL = "https://easyeda.com/api/components/{uuid}"
    # Alternative API endpoint (EasyEDA Pro / LCSC)
    LCSC_COMPONENT_URL = "https://pro.lceda.cn/api/eda/product/componentsInfoWithSvg"

    def __init__(self, timeout: float = _DEFAULT_TIMEOUT) -> None:
        self._timeout = timeout

    async def search(self, query: str, limit: int = 20) -> list[EasyEDAResult]:
        """Search EasyEDA component library.

        Args:
            query: Part number, description, or keyword.
            limit: Maximum results to return.

        Returns:
            List of EasyEDAResult items. Empty list on any error.
        """
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    self.SEARCH_URL,
                    params={
                        "keyword": query,
                        "limit": str(limit),
                        "type": "3",  # type 3 = components
                    },
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "RouteAI/1.0",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            components: list[dict[str, Any]] = (
                data.get("result", data.get("components", []))
                if isinstance(data.get("result"), list)
                else data.get("result", {}).get("componentList", [])
            )
            if not isinstance(components, list):
                components = []

            results: list[EasyEDAResult] = []
            for c in components[:limit]:
                uuid = str(c.get("uuid", c.get("componentUuid", "")))
                results.append(
                    EasyEDAResult(
                        uuid=uuid,
                        title=c.get("title", ""),
                        description=c.get("description", c.get("title", "")),
                        manufacturer=c.get("manufacturer", c.get("brandName", "")),
                        mpn=c.get("mpn", c.get("mfr", "")),
                        package=c.get("package", c.get("encapStandard", "")),
                        lcsc_code=c.get("lcsc", c.get("szlcsc", "")),
                        has_symbol=bool(c.get("has_symbol", True)),
                        has_footprint=bool(c.get("has_footprint", True)),
                        has_3d_model=bool(c.get("has_3d_model", False)),
                        datasheet_url=c.get("datasheet"),
                        image_url=c.get("image_url", c.get("imageUrl")),
                    )
                )
            return results

        except httpx.TimeoutException:
            logger.warning("EasyEDA search timed out for query: %s", query)
            return []
        except httpx.HTTPStatusError as exc:
            logger.warning("EasyEDA search HTTP %s for query: %s", exc.response.status_code, query)
            return []
        except Exception:
            logger.exception("EasyEDA search failed for query: %s", query)
            return []

    async def get_component(self, uuid: str) -> EasyEDAComponent | None:
        """Fetch full component detail from EasyEDA.

        Args:
            uuid: The EasyEDA component UUID.

        Returns:
            EasyEDAComponent with symbol/footprint JSON, or None on error.
        """
        try:
            url = self.COMPONENT_URL.format(uuid=uuid)
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.get(
                    url,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "RouteAI/1.0",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            result = data.get("result", data)
            if isinstance(result, list) and result:
                result = result[0]
            if not isinstance(result, dict):
                return None

            # Extract pins from symbol data
            pins: list[dict[str, str]] = []
            symbol_json = result.get("symbol", result.get("schematic", {}))
            if isinstance(symbol_json, str):
                try:
                    symbol_json = json.loads(symbol_json)
                except json.JSONDecodeError:
                    symbol_json = {}

            footprint_json = result.get("footprint", result.get("pcb", {}))
            if isinstance(footprint_json, str):
                try:
                    footprint_json = json.loads(footprint_json)
                except json.JSONDecodeError:
                    footprint_json = {}

            # Parse pin info from the symbol
            if isinstance(symbol_json, dict):
                for item in symbol_json.get("shape", []):
                    if isinstance(item, str) and item.startswith("P"):
                        parts = item.split("~")
                        if len(parts) >= 3:
                            pins.append({
                                "name": parts[1] if len(parts) > 1 else "",
                                "number": parts[2] if len(parts) > 2 else "",
                                "type": "passive",
                            })

            return EasyEDAComponent(
                uuid=uuid,
                title=result.get("title", ""),
                description=result.get("description", ""),
                manufacturer=result.get("manufacturer", ""),
                mpn=result.get("mpn", ""),
                package=result.get("package", ""),
                lcsc_code=result.get("lcsc", ""),
                symbol_json=symbol_json if isinstance(symbol_json, dict) else {},
                footprint_json=footprint_json if isinstance(footprint_json, dict) else {},
                model_3d_url=result.get("model_3d_url"),
                pins=pins,
                datasheet_url=result.get("datasheet"),
            )

        except Exception:
            logger.exception("EasyEDA get_component failed for uuid: %s", uuid)
            return None

    async def convert_to_kicad(
        self, component: EasyEDAComponent
    ) -> tuple[str, str]:
        """Convert an EasyEDA component to KiCad symbol + footprint S-expressions.

        This performs a best-effort conversion from EasyEDA's JSON-based
        format to KiCad's S-expression format. Complex shapes may be
        simplified.

        Args:
            component: The EasyEDA component to convert.

        Returns:
            Tuple of (symbol_sexpr, footprint_sexpr). Either may be empty
            if conversion fails.
        """
        symbol_sexpr = self._convert_symbol(component)
        footprint_sexpr = self._convert_footprint(component)
        return symbol_sexpr, footprint_sexpr

    # ------------------------------------------------------------------
    # Private conversion helpers
    # ------------------------------------------------------------------

    def _convert_symbol(self, comp: EasyEDAComponent) -> str:
        """Convert EasyEDA symbol JSON to KiCad .kicad_sym S-expression."""
        if not comp.symbol_json:
            return ""

        safe_name = re.sub(r"[^\w\-.]", "_", comp.mpn or comp.title)
        lines: list[str] = [
            '(kicad_symbol_lib (version 20220914) (generator routeai_easyeda_convert)',
            f'  (symbol "{safe_name}" (in_bom yes) (on_board yes)',
            '    (property "Reference" "U" (at 0 1.27 0)',
            '      (effects (font (size 1.27 1.27))))',
            f'    (property "Value" "{safe_name}" (at 0 -1.27 0)',
            '      (effects (font (size 1.27 1.27))))',
            f'    (property "Footprint" "{comp.package}" (at 0 -3.81 0)',
            '      (effects (font (size 1.27 1.27)) hide))',
        ]

        if comp.datasheet_url:
            lines.append(
                f'    (property "Datasheet" "{comp.datasheet_url}" (at 0 -6.35 0)'
            )
            lines.append('      (effects (font (size 1.27 1.27)) hide))')

        lines.append(f'    (symbol "{safe_name}_0_1"')

        # Add pins
        y_offset = len(comp.pins) * 1.27 / 2
        for i, pin in enumerate(comp.pins):
            pin_name = pin.get("name", f"P{i + 1}")
            pin_number = pin.get("number", str(i + 1))
            pin_type = _map_pin_type(pin.get("type", "passive"))
            y = y_offset - i * 2.54
            lines.append(
                f'      (pin {pin_type} line (at -7.62 {y:.2f} 0) (length 2.54)'
            )
            lines.append(f'        (name "{pin_name}" (effects (font (size 1.27 1.27))))')
            lines.append(f'        (number "{pin_number}" (effects (font (size 1.27 1.27)))))')

        lines.append("    )")  # close symbol_0_1
        lines.append("  )")  # close symbol
        lines.append(")")  # close lib

        return "\n".join(lines)

    def _convert_footprint(self, comp: EasyEDAComponent) -> str:
        """Convert EasyEDA footprint JSON to KiCad .kicad_mod S-expression."""
        if not comp.footprint_json:
            return ""

        safe_name = re.sub(r"[^\w\-.]", "_", comp.mpn or comp.title)
        lines: list[str] = [
            f'(footprint "{safe_name}" (version 20221018) (generator routeai_easyeda_convert)',
            '  (layer "F.Cu")',
            '  (attr smd)',
            '  (fp_text reference "REF**" (at 0 -2 0)',
            '    (layer "F.SilkS")',
            '    (effects (font (size 1 1) (thickness 0.15))))',
            f'  (fp_text value "{safe_name}" (at 0 2 0)',
            '    (layer "F.Fab")',
            '    (effects (font (size 1 1) (thickness 0.15))))',
        ]

        # Parse pads from footprint JSON shapes
        pad_shapes = comp.footprint_json.get("shape", [])
        if isinstance(pad_shapes, list):
            pad_idx = 0
            for shape_str in pad_shapes:
                if not isinstance(shape_str, str):
                    continue
                if shape_str.startswith("PAD"):
                    pad_idx += 1
                    pad_sexpr = self._parse_easyeda_pad(shape_str, pad_idx)
                    if pad_sexpr:
                        lines.append(f"  {pad_sexpr}")

        lines.append(")")
        return "\n".join(lines)

    def _parse_easyeda_pad(self, shape_str: str, pad_idx: int) -> str:
        """Parse a single EasyEDA PAD shape string into KiCad pad S-expression."""
        # EasyEDA PAD format: PAD~shape~x~y~width~height~layer~net~number~...
        parts = shape_str.split("~")
        if len(parts) < 9:
            return ""

        try:
            pad_shape = parts[1]
            x = float(parts[2]) * 0.254  # EasyEDA uses 10mil units
            y = float(parts[3]) * 0.254
            width = float(parts[4]) * 0.254
            height = float(parts[5]) * 0.254
            pad_number = parts[8] if len(parts) > 8 else str(pad_idx)

            kicad_shape = "rect"
            if pad_shape in ("ELLIPSE", "OVAL"):
                kicad_shape = "oval"
            elif pad_shape == "ROUND":
                kicad_shape = "circle"

            return (
                f'(pad "{pad_number}" smd {kicad_shape} '
                f'(at {x:.4f} {y:.4f}) '
                f'(size {width:.4f} {height:.4f}) '
                f'(layers "F.Cu" "F.Paste" "F.Mask"))'
            )
        except (ValueError, IndexError):
            return ""


def _map_pin_type(easyeda_type: str) -> str:
    """Map EasyEDA pin type to KiCad pin type."""
    mapping: dict[str, str] = {
        "input": "input",
        "output": "output",
        "bidirectional": "bidirectional",
        "passive": "passive",
        "power": "power_in",
        "power_in": "power_in",
        "power_out": "power_out",
        "open_collector": "open_collector",
        "open_emitter": "open_emitter",
        "unspecified": "unspecified",
        "tri_state": "tri_state",
        "no_connect": "no_connect",
    }
    return mapping.get(easyeda_type.lower(), "passive")
