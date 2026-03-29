"""Manufacturing models for PCB fabrication and assembly.

Defines fabrication specifications, bill of materials, assembly data,
and pick-and-place information.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from routeai_core.models.stackup import CopperWeight
from routeai_core.units import Angle, Length


class SurfaceFinish(str, Enum):
    """PCB surface finish type."""

    HASL = "hasl"
    ENIG = "enig"
    OSP = "osp"
    IMMERSION_TIN = "immersion_tin"
    IMMERSION_SILVER = "immersion_silver"


class SolderMaskColor(str, Enum):
    """Solder mask color."""

    GREEN = "green"
    BLACK = "black"
    WHITE = "white"
    BLUE = "blue"
    RED = "red"
    YELLOW = "yellow"


class FabricationSpec(BaseModel):
    """Fabrication specification for manufacturing.

    Contains all the parameters needed to manufacture the bare PCB,
    typically provided to a PCB fabrication house.
    """

    layers: int = Field(default=2, ge=1, description="Number of copper layers")
    surface_finish: SurfaceFinish = Field(
        default=SurfaceFinish.HASL, description="Surface finish type"
    )
    solder_mask_color: SolderMaskColor = Field(
        default=SolderMaskColor.GREEN, description="Solder mask color"
    )
    min_trace: Length = Field(
        default_factory=lambda: Length.from_mm(0.15),
        description="Minimum trace width used in design",
    )
    min_space: Length = Field(
        default_factory=lambda: Length.from_mm(0.15),
        description="Minimum clearance used in design",
    )
    min_drill: Length = Field(
        default_factory=lambda: Length.from_mm(0.3),
        description="Minimum drill diameter used in design",
    )
    board_thickness: Length = Field(
        default_factory=lambda: Length.from_mm(1.6),
        description="Total board thickness",
    )
    copper_weight: CopperWeight = Field(
        default=CopperWeight.ONE_OZ, description="Outer copper weight"
    )
    material: str = Field(default="FR-4", description="Base material")
    has_impedance_control: bool = Field(
        default=False, description="Whether impedance-controlled manufacturing is required"
    )

    model_config = {"arbitrary_types_allowed": True}


class BOMEntry(BaseModel):
    """A single entry in the Bill of Materials.

    Represents one unique part in the design with sourcing and cost information.
    """

    reference: str = Field(
        description="Reference designator(s), comma-separated for grouped (e.g. 'R1,R2,R3')"
    )
    value: str = Field(default="", description="Component value (e.g. '10k', '100nF')")
    footprint: str = Field(default="", description="Footprint name")
    quantity: int = Field(default=1, ge=1, description="Number of this part in the design")
    manufacturer: str = Field(default="", description="Component manufacturer")
    mpn: str = Field(default="", description="Manufacturer part number")
    supplier: str = Field(default="", description="Distributor/supplier name")
    supplier_pn: str = Field(default="", description="Supplier part number")
    unit_price: Optional[float] = Field(
        default=None, ge=0.0, description="Unit price in USD"
    )
    description: str = Field(default="", description="Part description")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def total_price(self) -> Optional[float]:
        """Total price for all units of this part."""
        if self.unit_price is None:
            return None
        return self.unit_price * self.quantity


class BOM(BaseModel):
    """Bill of Materials for a PCB design.

    Contains all unique parts and their quantities, with optional cost data.
    """

    entries: list[BOMEntry] = Field(
        default_factory=list, description="BOM line items"
    )
    total_cost: Optional[float] = Field(
        default=None, description="Total BOM cost in USD (computed if None)"
    )

    model_config = {"arbitrary_types_allowed": True}

    @property
    def computed_total_cost(self) -> Optional[float]:
        """Compute total cost from entries that have pricing."""
        prices = [e.total_price for e in self.entries if e.total_price is not None]
        if not prices:
            return None
        return sum(prices)

    @property
    def unique_part_count(self) -> int:
        """Number of unique parts."""
        return len(self.entries)

    @property
    def total_quantity(self) -> int:
        """Total number of component placements."""
        return sum(e.quantity for e in self.entries)


class PickAndPlace(BaseModel):
    """Pick-and-place data for a single component placement.

    Used by assembly machines to place components on the board.
    """

    reference: str = Field(description="Reference designator (e.g. 'R1')")
    value: str = Field(default="", description="Component value")
    footprint: str = Field(default="", description="Footprint name")
    x: Length = Field(
        default_factory=lambda: Length.from_mm(0.0), description="X position on the board"
    )
    y: Length = Field(
        default_factory=lambda: Length.from_mm(0.0), description="Y position on the board"
    )
    rotation: Angle = Field(
        default_factory=lambda: Angle(0.0), description="Component rotation"
    )
    side: str = Field(default="top", description="Board side: 'top' or 'bottom'")

    model_config = {"arbitrary_types_allowed": True}


class SolderPasteLayer(BaseModel):
    """Solder paste layer (stencil) definition."""

    layer: str = Field(description="Layer name (e.g. 'F.Paste', 'B.Paste')")
    openings: list[str] = Field(
        default_factory=list,
        description="Pad references that have paste openings",
    )

    model_config = {"arbitrary_types_allowed": True}


class AssemblyData(BaseModel):
    """Assembly data for PCB manufacturing.

    Contains pick-and-place coordinates and solder paste information
    needed for automated assembly.
    """

    pick_and_place: list[PickAndPlace] = Field(
        default_factory=list, description="Pick-and-place entries for all components"
    )
    solder_paste_layers: list[SolderPasteLayer] = Field(
        default_factory=list, description="Solder paste layer definitions"
    )

    model_config = {"arbitrary_types_allowed": True}

    @property
    def top_side_count(self) -> int:
        """Number of components on the top side."""
        return sum(1 for p in self.pick_and_place if p.side == "top")

    @property
    def bottom_side_count(self) -> int:
        """Number of components on the bottom side."""
        return sum(1 for p in self.pick_and_place if p.side == "bottom")
