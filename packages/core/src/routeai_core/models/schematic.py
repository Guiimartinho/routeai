"""Schematic data models for PCB design.

Defines the logical/schematic representation of a PCB design including
components, pins, nets, buses, sheets, and the top-level SchematicDesign.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from routeai_core.geometry import Point
from routeai_core.units import Angle, Length


class ElectricalType(str, Enum):
    """Electrical type of a pin."""

    INPUT = "input"
    OUTPUT = "output"
    BIDIRECTIONAL = "bidirectional"
    TRI_STATE = "tri_state"
    PASSIVE = "passive"
    POWER_IN = "power_in"
    POWER_OUT = "power_out"
    OPEN_COLLECTOR = "open_collector"
    OPEN_EMITTER = "open_emitter"
    UNCONNECTED = "unconnected"
    UNSPECIFIED = "unspecified"


class Pin(BaseModel):
    """A pin on a schematic component.

    Represents both the logical pin definition and its physical location
    within the component.
    """

    number: str = Field(description="Pin number or designator (e.g. '1', 'A1')")
    name: str = Field(default="", description="Pin name (e.g. 'VCC', 'GND', 'D0')")
    position: Point = Field(
        default_factory=Point, description="Pin position relative to component origin"
    )
    electrical_type: ElectricalType = Field(
        default=ElectricalType.UNSPECIFIED, description="Electrical type of the pin"
    )
    net_ref: Optional[str] = Field(default=None, description="Reference to connected net name")

    model_config = {"arbitrary_types_allowed": True}


class Component(BaseModel):
    """A schematic component (symbol instance).

    Represents a placed component in the schematic with its reference designator,
    value, and associated pins.
    """

    reference: str = Field(description="Reference designator (e.g. 'R1', 'U3', 'C10')")
    value: str = Field(default="", description="Component value (e.g. '10k', '100nF', 'ATmega328P')")
    footprint: str = Field(default="", description="Footprint library reference")
    position: Point = Field(default_factory=Point, description="Position on the schematic sheet")
    rotation: Angle = Field(default_factory=lambda: Angle(0.0), description="Rotation angle")
    layer: str = Field(default="F.Cu", description="Default placement layer")
    properties: dict[str, str] = Field(
        default_factory=dict, description="Additional key-value properties"
    )
    pins: list[Pin] = Field(default_factory=list, description="List of component pins")

    model_config = {"arbitrary_types_allowed": True}

    def get_pin_by_number(self, number: str) -> Optional[Pin]:
        """Find a pin by its number."""
        for pin in self.pins:
            if pin.number == number:
                return pin
        return None

    def get_pin_by_name(self, name: str) -> Optional[Pin]:
        """Find a pin by its name."""
        for pin in self.pins:
            if pin.name == name:
                return pin
        return None


class Net(BaseModel):
    """A net connecting multiple pins in the schematic.

    A net represents an electrical connection between two or more pins.
    """

    name: str = Field(description="Net name (e.g. 'GND', 'VCC', 'NET-R1-1')")
    net_class: str = Field(default="Default", description="Net class for design rules")
    pads: list[str] = Field(
        default_factory=list,
        description="List of pad references in 'component.pin' format",
    )
    traces: list[str] = Field(
        default_factory=list, description="Trace segment IDs belonging to this net"
    )
    zones: list[str] = Field(
        default_factory=list, description="Zone IDs belonging to this net"
    )

    model_config = {"arbitrary_types_allowed": True}


class Bus(BaseModel):
    """A bus grouping multiple related nets.

    Buses are used to represent multi-bit signal groups like data buses.
    """

    name: str = Field(description="Bus name (e.g. 'DATA[0..7]')")
    nets: list[str] = Field(default_factory=list, description="Net names in this bus")

    model_config = {"arbitrary_types_allowed": True}


class SheetInstance(BaseModel):
    """An instance of a hierarchical sheet."""

    path: str = Field(description="Instance path identifier")
    page: str = Field(default="", description="Page number or label")

    model_config = {"arbitrary_types_allowed": True}


class Sheet(BaseModel):
    """A hierarchical sheet in the schematic.

    Represents a sub-sheet that can be instantiated multiple times.
    """

    name: str = Field(description="Sheet name")
    filename: str = Field(default="", description="Sheet file name")
    instances: list[SheetInstance] = Field(
        default_factory=list, description="Sheet instances in the design"
    )

    model_config = {"arbitrary_types_allowed": True}


class SchematicDesign(BaseModel):
    """Top-level schematic design container.

    Aggregates all components, nets, buses, and sheets that make up
    a complete schematic design.
    """

    title: str = Field(default="Untitled", description="Design title")
    date: str = Field(default="", description="Design date")
    revision: str = Field(default="", description="Design revision")
    components: list[Component] = Field(
        default_factory=list, description="All components in the design"
    )
    nets: list[Net] = Field(default_factory=list, description="All nets in the design")
    buses: list[Bus] = Field(default_factory=list, description="All buses in the design")
    sheets: list[Sheet] = Field(
        default_factory=list, description="All hierarchical sheets"
    )

    model_config = {"arbitrary_types_allowed": True}

    def get_component(self, reference: str) -> Optional[Component]:
        """Find a component by reference designator."""
        for comp in self.components:
            if comp.reference == reference:
                return comp
        return None

    def get_net(self, name: str) -> Optional[Net]:
        """Find a net by name."""
        for net in self.nets:
            if net.name == name:
                return net
        return None

    @property
    def component_count(self) -> int:
        """Total number of components."""
        return len(self.components)

    @property
    def net_count(self) -> int:
        """Total number of nets."""
        return len(self.nets)
