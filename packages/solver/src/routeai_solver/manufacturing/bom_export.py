"""Bill of Materials (BOM) exporter.

Generates BOM files in CSV and JSON formats from board component
data, grouping by value and footprint, with support for MPN,
supplier information, and cost calculation.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class BOMItem:
    """A single component entry in the BOM."""

    reference: str  # e.g., "R1"
    value: str  # e.g., "10k"
    footprint: str  # e.g., "0402"
    description: str = ""
    mpn: str = ""  # Manufacturer Part Number
    manufacturer: str = ""
    supplier: str = ""
    supplier_pn: str = ""  # Supplier part number
    unit_price: float = 0.0  # Price per unit in USD
    quantity: int = 1
    dnp: bool = False  # Do Not Place


@dataclass
class BOMGroup:
    """A group of identical components in the BOM."""

    references: list[str]
    value: str
    footprint: str
    description: str
    mpn: str
    manufacturer: str
    supplier: str
    supplier_pn: str
    unit_price: float
    quantity: int
    dnp: bool

    @property
    def total_price(self) -> float:
        return self.unit_price * self.quantity

    @property
    def reference_string(self) -> str:
        """Comma-separated reference designators."""
        return ", ".join(sorted(self.references))


@dataclass
class BOM:
    """Complete Bill of Materials."""

    items: list[BOMItem] = field(default_factory=list)
    project_name: str = ""
    revision: str = ""
    date: str = ""
    notes: str = ""

    def grouped(self) -> list[BOMGroup]:
        """Group BOM items by value + footprint + MPN."""
        groups: dict[str, BOMGroup] = {}

        for item in self.items:
            if item.dnp:
                key = f"DNP:{item.value}:{item.footprint}:{item.mpn}"
            else:
                key = f"{item.value}:{item.footprint}:{item.mpn}"

            if key in groups:
                groups[key].references.append(item.reference)
                groups[key].quantity += 1
            else:
                groups[key] = BOMGroup(
                    references=[item.reference],
                    value=item.value,
                    footprint=item.footprint,
                    description=item.description,
                    mpn=item.mpn,
                    manufacturer=item.manufacturer,
                    supplier=item.supplier,
                    supplier_pn=item.supplier_pn,
                    unit_price=item.unit_price,
                    quantity=1,
                    dnp=item.dnp,
                )

        # Sort by reference prefix then number
        return sorted(groups.values(), key=lambda g: g.references[0])

    @property
    def total_cost(self) -> float:
        """Total cost of all non-DNP items."""
        return sum(
            item.unit_price for item in self.items if not item.dnp
        )

    @property
    def unique_parts(self) -> int:
        """Number of unique parts (grouped)."""
        return len(self.grouped())

    @property
    def total_components(self) -> int:
        """Total number of components."""
        return sum(1 for item in self.items if not item.dnp)


# ---------------------------------------------------------------------------
# BOM Exporter
# ---------------------------------------------------------------------------

class BOMExporter:
    """Exports BOM to CSV and JSON formats.

    Supports grouping by value+footprint, supplier links,
    and total cost calculation.
    """

    @staticmethod
    def export_csv(bom: BOM, filepath: str) -> str:
        """Export BOM to CSV file.

        Format: Reference, Value, Footprint, Quantity, MPN,
                Manufacturer, Supplier, Supplier PN, Unit Price,
                Total Price, DNP

        Items are grouped by value + footprint + MPN.

        Args:
            bom: The BOM to export.
            filepath: Output file path.

        Returns:
            The file path written.
        """
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)

        groups = bom.grouped()

        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)

            # Header comment
            writer.writerow([f"# BOM for {bom.project_name} rev {bom.revision}"])
            writer.writerow([f"# Date: {bom.date}"])
            writer.writerow([f"# Total unique parts: {bom.unique_parts}"])
            writer.writerow([f"# Total components: {bom.total_components}"])
            writer.writerow([f"# Estimated total cost: ${bom.total_cost:.2f}"])
            writer.writerow([])

            # Column headers
            writer.writerow([
                "Reference",
                "Value",
                "Footprint",
                "Quantity",
                "Description",
                "MPN",
                "Manufacturer",
                "Supplier",
                "Supplier PN",
                "Unit Price (USD)",
                "Total Price (USD)",
                "DNP",
            ])

            # Data rows
            for group in groups:
                writer.writerow([
                    group.reference_string,
                    group.value,
                    group.footprint,
                    group.quantity,
                    group.description,
                    group.mpn,
                    group.manufacturer,
                    group.supplier,
                    group.supplier_pn,
                    f"{group.unit_price:.4f}" if group.unit_price > 0 else "",
                    f"{group.total_price:.4f}" if group.unit_price > 0 else "",
                    "DNP" if group.dnp else "",
                ])

            # Summary row
            writer.writerow([])
            total = sum(g.total_price for g in groups if not g.dnp)
            writer.writerow([
                "", "", "", bom.total_components, "", "", "", "", "",
                "TOTAL:", f"${total:.2f}", "",
            ])

        return filepath

    @staticmethod
    def export_json(bom: BOM, filepath: str) -> str:
        """Export BOM to JSON file.

        Includes both individual items and grouped view with
        full metadata and cost summary.

        Args:
            bom: The BOM to export.
            filepath: Output file path.

        Returns:
            The file path written.
        """
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)

        groups = bom.grouped()

        data = {
            "metadata": {
                "project_name": bom.project_name,
                "revision": bom.revision,
                "date": bom.date,
                "notes": bom.notes,
                "generator": "RouteAI EDA",
            },
            "summary": {
                "unique_parts": bom.unique_parts,
                "total_components": bom.total_components,
                "total_cost_usd": round(bom.total_cost, 2),
            },
            "groups": [
                {
                    "references": group.references,
                    "reference_string": group.reference_string,
                    "value": group.value,
                    "footprint": group.footprint,
                    "quantity": group.quantity,
                    "description": group.description,
                    "mpn": group.mpn,
                    "manufacturer": group.manufacturer,
                    "supplier": group.supplier,
                    "supplier_pn": group.supplier_pn,
                    "unit_price_usd": group.unit_price,
                    "total_price_usd": round(group.total_price, 4),
                    "dnp": group.dnp,
                }
                for group in groups
            ],
            "items": [
                {
                    "reference": item.reference,
                    "value": item.value,
                    "footprint": item.footprint,
                    "description": item.description,
                    "mpn": item.mpn,
                    "manufacturer": item.manufacturer,
                    "supplier": item.supplier,
                    "supplier_pn": item.supplier_pn,
                    "unit_price_usd": item.unit_price,
                    "dnp": item.dnp,
                }
                for item in bom.items
            ],
        }

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return filepath
