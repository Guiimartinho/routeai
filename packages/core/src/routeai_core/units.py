"""Unit system with automatic conversion for PCB dimensional values.

Supports mm, mil, inch, and um for lengths; degrees and radians for angles.
All lengths are stored internally in millimeters.
All angles are stored internally in degrees.
"""

from __future__ import annotations

import math
from typing import Annotated, Any

from pydantic import GetCoreSchemaHandler, GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema, core_schema


# Conversion factors TO millimeters
_TO_MM = {
    "mm": 1.0,
    "mil": 0.0254,
    "inch": 25.4,
    "in": 25.4,
    "um": 0.001,
}

# Conversion factors FROM millimeters
_FROM_MM = {unit: 1.0 / factor for unit, factor in _TO_MM.items()}


class Length:
    """A length value that stores internally in millimeters and supports unit conversion.

    Create from any supported unit and convert freely between mm, mil, inch, and um.

    Examples:
        >>> l = Length(1.0, "inch")
        >>> l.mm
        25.4
        >>> l.mil
        1000.0
        >>> Length.from_mm(25.4).inch
        1.0
    """

    __slots__ = ("_mm",)

    def __init__(self, value: float, unit: str = "mm") -> None:
        """Create a Length from a value in the given unit.

        Args:
            value: Numeric length value.
            unit: One of 'mm', 'mil', 'inch', 'in', 'um'.
        """
        unit = unit.lower()
        if unit not in _TO_MM:
            raise ValueError(f"Unknown length unit '{unit}'. Supported: {list(_TO_MM.keys())}")
        self._mm = value * _TO_MM[unit]

    # ---- Factory methods ----

    @classmethod
    def from_mm(cls, value: float) -> Length:
        """Create a Length from millimeters."""
        return cls(value, "mm")

    @classmethod
    def from_mil(cls, value: float) -> Length:
        """Create a Length from mils (thousandths of an inch)."""
        return cls(value, "mil")

    @classmethod
    def from_inch(cls, value: float) -> Length:
        """Create a Length from inches."""
        return cls(value, "inch")

    @classmethod
    def from_um(cls, value: float) -> Length:
        """Create a Length from micrometers."""
        return cls(value, "um")

    # ---- Conversion properties ----

    @property
    def mm(self) -> float:
        """Value in millimeters."""
        return self._mm

    @property
    def mil(self) -> float:
        """Value in mils (thousandths of an inch)."""
        return self._mm * _FROM_MM["mil"]

    @property
    def inch(self) -> float:
        """Value in inches."""
        return self._mm * _FROM_MM["inch"]

    @property
    def um(self) -> float:
        """Value in micrometers."""
        return self._mm * _FROM_MM["um"]

    # ---- Arithmetic ----

    def __add__(self, other: Length) -> Length:
        if not isinstance(other, Length):
            return NotImplemented
        return Length.from_mm(self._mm + other._mm)

    def __sub__(self, other: Length) -> Length:
        if not isinstance(other, Length):
            return NotImplemented
        return Length.from_mm(self._mm - other._mm)

    def __mul__(self, scalar: float) -> Length:
        if isinstance(scalar, Length):
            return NotImplemented
        return Length.from_mm(self._mm * scalar)

    def __rmul__(self, scalar: float) -> Length:
        return self.__mul__(scalar)

    def __truediv__(self, other: float | Length) -> Length | float:
        if isinstance(other, Length):
            # Length / Length -> dimensionless float ratio
            return self._mm / other._mm
        if isinstance(other, (int, float)):
            return Length.from_mm(self._mm / other)
        return NotImplemented

    def __radd__(self, other: object) -> Length:
        # Support numeric + Length only when the numeric is a Length-like zero,
        # but for consistency with __add__ which requires Length, we return
        # NotImplemented for non-Length.  However, sum() starts with 0,
        # so we handle int/float 0 specially.
        if isinstance(other, (int, float)) and other == 0:
            return self
        if isinstance(other, Length):
            return Length.from_mm(other._mm + self._mm)
        return NotImplemented

    def __rsub__(self, other: object) -> Length:
        if isinstance(other, (int, float)) and other == 0:
            return -self
        if isinstance(other, Length):
            return Length.from_mm(other._mm - self._mm)
        return NotImplemented

    def __rtruediv__(self, other: float) -> float:
        """Numeric / Length -> float (dimensionless, in per-mm units)."""
        if isinstance(other, (int, float)):
            return other / self._mm
        return NotImplemented

    def __neg__(self) -> Length:
        return Length.from_mm(-self._mm)

    def __abs__(self) -> Length:
        return Length.from_mm(abs(self._mm))

    # ---- Comparison ----

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Length):
            return NotImplemented
        return math.isclose(self._mm, other._mm, rel_tol=1e-9, abs_tol=1e-12)

    def __lt__(self, other: Length) -> bool:
        if not isinstance(other, Length):
            return NotImplemented
        return self._mm < other._mm

    def __le__(self, other: Length) -> bool:
        if not isinstance(other, Length):
            return NotImplemented
        return self._mm <= other._mm or self == other

    def __gt__(self, other: Length) -> bool:
        if not isinstance(other, Length):
            return NotImplemented
        return self._mm > other._mm

    def __ge__(self, other: Length) -> bool:
        if not isinstance(other, Length):
            return NotImplemented
        return self._mm >= other._mm or self == other

    def __hash__(self) -> int:
        return hash(round(self._mm, 12))

    def __repr__(self) -> str:
        return f"Length({self._mm}mm)"

    def __str__(self) -> str:
        return f"{self._mm}mm"

    def __float__(self) -> float:
        return self._mm

    # ---- Pydantic v2 integration ----

    @classmethod
    def __get_pydantic_core_schema__(
        cls,
        source_type: Any,
        handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        """Allow Pydantic to serialize/deserialize Length as a float (mm)."""
        return core_schema.no_info_plain_validator_function(
            cls._pydantic_validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda v: v._mm,
                info_arg=False,
                return_schema=core_schema.float_schema(),
            ),
        )

    @classmethod
    def _pydantic_validate(cls, value: Any) -> Length:
        """Validate input for Pydantic: accepts float (mm), dict, or Length."""
        if isinstance(value, Length):
            return value
        if isinstance(value, (int, float)):
            return cls.from_mm(float(value))
        if isinstance(value, dict):
            return cls(value["value"], value.get("unit", "mm"))
        raise ValueError(f"Cannot convert {type(value)} to Length")

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        _source: Any,
        handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        return {"type": "number", "description": "Length in millimeters"}


class Angle:
    """An angle value that stores internally in degrees and converts to/from radians.

    Examples:
        >>> a = Angle(180.0)
        >>> round(a.radians, 6)
        3.141593
        >>> Angle.from_radians(math.pi).degrees
        180.0
    """

    __slots__ = ("_degrees",)

    def __init__(self, degrees: float = 0.0) -> None:
        """Create an Angle from degrees.

        Args:
            degrees: Angle in degrees.
        """
        self._degrees = float(degrees)

    @classmethod
    def from_degrees(cls, degrees: float) -> Angle:
        """Create an Angle from degrees."""
        return cls(degrees)

    @classmethod
    def from_radians(cls, radians: float) -> Angle:
        """Create an Angle from radians."""
        return cls(math.degrees(radians))

    @property
    def degrees(self) -> float:
        """Value in degrees."""
        return self._degrees

    @property
    def radians(self) -> float:
        """Value in radians."""
        return math.radians(self._degrees)

    def normalized(self) -> Angle:
        """Return angle normalized to [0, 360) degrees."""
        return Angle(self._degrees % 360.0)

    def __add__(self, other: Angle) -> Angle:
        if not isinstance(other, Angle):
            return NotImplemented
        return Angle(self._degrees + other._degrees)

    def __sub__(self, other: Angle) -> Angle:
        if not isinstance(other, Angle):
            return NotImplemented
        return Angle(self._degrees - other._degrees)

    def __mul__(self, scalar: float) -> Angle:
        if isinstance(scalar, Angle):
            return NotImplemented
        return Angle(self._degrees * scalar)

    def __rmul__(self, scalar: float) -> Angle:
        return self.__mul__(scalar)

    def __truediv__(self, other: float | Angle) -> Angle | float:
        if isinstance(other, Angle):
            # Angle / Angle -> dimensionless float ratio
            return self._degrees / other._degrees
        if isinstance(other, (int, float)):
            return Angle(self._degrees / other)
        return NotImplemented

    def __radd__(self, other: object) -> Angle:
        # Support sum() which starts with 0
        if isinstance(other, (int, float)) and other == 0:
            return self
        if isinstance(other, Angle):
            return Angle(other._degrees + self._degrees)
        return NotImplemented

    def __rsub__(self, other: object) -> Angle:
        if isinstance(other, (int, float)) and other == 0:
            return -self
        if isinstance(other, Angle):
            return Angle(other._degrees - self._degrees)
        return NotImplemented

    def __rtruediv__(self, other: float) -> float:
        """Numeric / Angle -> float (dimensionless, in per-degree units)."""
        if isinstance(other, (int, float)):
            return other / self._degrees
        return NotImplemented

    def __le__(self, other: Angle) -> bool:
        if not isinstance(other, Angle):
            return NotImplemented
        return self._degrees <= other._degrees or self == other

    def __gt__(self, other: Angle) -> bool:
        if not isinstance(other, Angle):
            return NotImplemented
        return self._degrees > other._degrees

    def __ge__(self, other: Angle) -> bool:
        if not isinstance(other, Angle):
            return NotImplemented
        return self._degrees >= other._degrees or self == other

    def __abs__(self) -> Angle:
        return Angle(abs(self._degrees))

    def __neg__(self) -> Angle:
        return Angle(-self._degrees)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Angle):
            return NotImplemented
        return math.isclose(self._degrees, other._degrees, rel_tol=1e-9, abs_tol=1e-12)

    def __lt__(self, other: Angle) -> bool:
        if not isinstance(other, Angle):
            return NotImplemented
        return self._degrees < other._degrees

    def __hash__(self) -> int:
        return hash(round(self._degrees, 12))

    def __repr__(self) -> str:
        return f"Angle({self._degrees}deg)"

    def __str__(self) -> str:
        return f"{self._degrees}deg"

    def __float__(self) -> float:
        return self._degrees

    # ---- Pydantic v2 integration ----

    @classmethod
    def __get_pydantic_core_schema__(
        cls,
        source_type: Any,
        handler: GetCoreSchemaHandler,
    ) -> CoreSchema:
        """Allow Pydantic to serialize/deserialize Angle as a float (degrees)."""
        return core_schema.no_info_plain_validator_function(
            cls._pydantic_validate,
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda v: v._degrees,
                info_arg=False,
                return_schema=core_schema.float_schema(),
            ),
        )

    @classmethod
    def _pydantic_validate(cls, value: Any) -> Angle:
        """Validate input for Pydantic: accepts float (degrees), dict, or Angle."""
        if isinstance(value, Angle):
            return value
        if isinstance(value, (int, float)):
            return cls(float(value))
        if isinstance(value, dict):
            if "radians" in value:
                return cls.from_radians(value["radians"])
            return cls(value.get("degrees", 0.0))
        raise ValueError(f"Cannot convert {type(value)} to Angle")

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        _source: Any,
        handler: GetJsonSchemaHandler,
    ) -> JsonSchemaValue:
        return {"type": "number", "description": "Angle in degrees"}
