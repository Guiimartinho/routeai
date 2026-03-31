"""RouteAI Parsers - KiCad and Eagle file format parsers.

Provides parsers for EDA file formats, converting them into RouteAI's
unified data model for LLM-powered PCB design assistance.
"""

from routeai_parsers.converter import BoardConverter, SchematicConverter
from routeai_parsers.eagle.brd_parser import EagleBrdParser
from routeai_parsers.eagle.exporter import EagleBrdExporter
from routeai_parsers.eagle.sch_exporter import EagleSchExporter
from routeai_parsers.eagle.sch_parser import EagleSchParser
from routeai_parsers.kicad.exporter import KiCadPcbExporter
from routeai_parsers.kicad.pcb_parser import KiCadPcbParser
from routeai_parsers.kicad.sch_exporter import KiCadSchExporter
from routeai_parsers.kicad.sch_parser import KiCadSchParser

__all__ = [
    "BoardConverter",
    "EagleBrdExporter",
    "EagleBrdParser",
    "EagleSchExporter",
    "EagleSchParser",
    "KiCadPcbExporter",
    "KiCadPcbParser",
    "KiCadSchExporter",
    "KiCadSchParser",
    "SchematicConverter",
]

__version__ = "0.1.0"
