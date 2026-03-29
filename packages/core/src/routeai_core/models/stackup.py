"""Stack-up models for PCB layer definitions.

Defines the physical layer stack of the PCB including copper layers,
dielectric layers, and common preset configurations.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from routeai_core.units import Length


class LayerType(str, Enum):
    """Type of copper layer."""

    SIGNAL = "signal"
    POWER = "power"
    MIXED = "mixed"
    DIELECTRIC = "dielectric"


class CopperWeight(str, Enum):
    """Standard copper weight/thickness."""

    HALF_OZ = "0.5oz"
    ONE_OZ = "1oz"
    TWO_OZ = "2oz"


# Copper weight to thickness in mm
_COPPER_THICKNESS_MM = {
    CopperWeight.HALF_OZ: 0.0175,
    CopperWeight.ONE_OZ: 0.035,
    CopperWeight.TWO_OZ: 0.070,
}


class Layer(BaseModel):
    """A copper layer in the PCB stackup.

    Represents a conductive copper layer used for signals, power, or ground.
    """

    name: str = Field(description="Layer name (e.g. 'F.Cu', 'In1.Cu', 'B.Cu')")
    layer_type: LayerType = Field(
        default=LayerType.SIGNAL, description="Layer function type"
    )
    thickness_mm: float = Field(
        default=0.035, description="Copper thickness in mm"
    )
    copper_weight: CopperWeight = Field(
        default=CopperWeight.ONE_OZ, description="Copper weight"
    )
    material: str = Field(default="Copper", description="Material name")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def thickness(self) -> Length:
        """Layer thickness as a Length object."""
        return Length.from_mm(self.thickness_mm)


class DielectricLayer(BaseModel):
    """A dielectric (insulating) layer in the PCB stackup.

    Represents the insulating material between copper layers, typically
    FR-4 prepreg or core material.
    """

    name: str = Field(description="Layer name (e.g. 'Prepreg1', 'Core1')")
    thickness_mm: float = Field(
        default=0.2, description="Dielectric thickness in mm"
    )
    dielectric_constant: float = Field(
        default=4.5, description="Relative permittivity (Er)"
    )
    loss_tangent: float = Field(
        default=0.02, description="Dielectric loss tangent"
    )
    material: str = Field(default="FR-4", description="Material name")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def thickness(self) -> Length:
        """Layer thickness as a Length object."""
        return Length.from_mm(self.thickness_mm)


class StackupLayer(BaseModel):
    """A generic layer entry in the stackup, either copper or dielectric."""

    copper: Optional[Layer] = Field(default=None, description="Copper layer definition")
    dielectric: Optional[DielectricLayer] = Field(
        default=None, description="Dielectric layer definition"
    )

    model_config = {"arbitrary_types_allowed": True}

    @property
    def is_copper(self) -> bool:
        """Whether this is a copper layer."""
        return self.copper is not None

    @property
    def thickness_mm(self) -> float:
        """Thickness of this layer in mm."""
        if self.copper is not None:
            return self.copper.thickness_mm
        if self.dielectric is not None:
            return self.dielectric.thickness_mm
        return 0.0

    @property
    def name(self) -> str:
        """Name of this layer."""
        if self.copper is not None:
            return self.copper.name
        if self.dielectric is not None:
            return self.dielectric.name
        return ""


class StackUp(BaseModel):
    """Complete PCB layer stackup definition.

    Describes the full layer stack from top to bottom including
    copper layers, prepreg, and core materials.
    """

    layers: list[StackupLayer] = Field(
        default_factory=list, description="Ordered layers from top to bottom"
    )
    total_thickness: Optional[float] = Field(
        default=None, description="Total board thickness in mm (computed if None)"
    )
    layer_count: int = Field(default=2, description="Number of copper layers")
    is_symmetric: bool = Field(
        default=True, description="Whether the stackup is symmetric about center"
    )

    model_config = {"arbitrary_types_allowed": True}

    @property
    def computed_thickness(self) -> float:
        """Compute total thickness from individual layers."""
        return sum(layer.thickness_mm for layer in self.layers)

    @property
    def copper_layers(self) -> list[Layer]:
        """Return only the copper layers."""
        return [l.copper for l in self.layers if l.copper is not None]

    @property
    def dielectric_layers(self) -> list[DielectricLayer]:
        """Return only the dielectric layers."""
        return [l.dielectric for l in self.layers if l.dielectric is not None]


def make_2_layer_stackup() -> StackUp:
    """Create a standard 2-layer PCB stackup.

    Typical 1.6mm board: F.Cu / FR-4 Core / B.Cu
    """
    layers = [
        StackupLayer(copper=Layer(name="F.Cu", layer_type=LayerType.SIGNAL)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Core", thickness_mm=1.53, dielectric_constant=4.5, material="FR-4"
            )
        ),
        StackupLayer(copper=Layer(name="B.Cu", layer_type=LayerType.SIGNAL)),
    ]
    return StackUp(layers=layers, total_thickness=1.6, layer_count=2, is_symmetric=True)


def make_4_layer_stackup() -> StackUp:
    """Create a standard 4-layer PCB stackup.

    Typical 1.6mm board: F.Cu / Prepreg / In1.Cu (GND) / Core / In2.Cu (PWR) / Prepreg / B.Cu
    """
    layers = [
        StackupLayer(copper=Layer(name="F.Cu", layer_type=LayerType.SIGNAL)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Prepreg1", thickness_mm=0.2, dielectric_constant=4.5, material="FR-4 Prepreg"
            )
        ),
        StackupLayer(copper=Layer(name="In1.Cu", layer_type=LayerType.POWER)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Core", thickness_mm=1.0, dielectric_constant=4.5, material="FR-4"
            )
        ),
        StackupLayer(copper=Layer(name="In2.Cu", layer_type=LayerType.POWER)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Prepreg2", thickness_mm=0.2, dielectric_constant=4.5, material="FR-4 Prepreg"
            )
        ),
        StackupLayer(copper=Layer(name="B.Cu", layer_type=LayerType.SIGNAL)),
    ]
    return StackUp(layers=layers, total_thickness=1.6, layer_count=4, is_symmetric=True)


def make_6_layer_stackup() -> StackUp:
    """Create a standard 6-layer PCB stackup.

    Typical 1.6mm board:
    F.Cu (Signal) / Prepreg / In1.Cu (GND) / Core / In2.Cu (Signal) /
    Prepreg / In3.Cu (Signal) / Core / In4.Cu (PWR) / Prepreg / B.Cu (Signal)
    """
    layers = [
        StackupLayer(copper=Layer(name="F.Cu", layer_type=LayerType.SIGNAL)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Prepreg1", thickness_mm=0.1, dielectric_constant=4.5, material="FR-4 Prepreg"
            )
        ),
        StackupLayer(copper=Layer(name="In1.Cu", layer_type=LayerType.POWER)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Core1", thickness_mm=0.36, dielectric_constant=4.5, material="FR-4"
            )
        ),
        StackupLayer(copper=Layer(name="In2.Cu", layer_type=LayerType.SIGNAL)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Prepreg2", thickness_mm=0.36, dielectric_constant=4.5, material="FR-4 Prepreg"
            )
        ),
        StackupLayer(copper=Layer(name="In3.Cu", layer_type=LayerType.SIGNAL)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Core2", thickness_mm=0.36, dielectric_constant=4.5, material="FR-4"
            )
        ),
        StackupLayer(copper=Layer(name="In4.Cu", layer_type=LayerType.POWER)),
        StackupLayer(
            dielectric=DielectricLayer(
                name="Prepreg3", thickness_mm=0.1, dielectric_constant=4.5, material="FR-4 Prepreg"
            )
        ),
        StackupLayer(copper=Layer(name="B.Cu", layer_type=LayerType.SIGNAL)),
    ]
    return StackUp(layers=layers, total_thickness=1.6, layer_count=6, is_symmetric=True)
