"""Eagle file format parsers for .brd and .sch files.

Provides parsers and exporters for Autodesk Eagle XML-based
board and schematic files, converting to/from RouteAI's unified data model.
"""

from routeai_parsers.eagle.brd_parser import EagleBrdParser
from routeai_parsers.eagle.exporter import EagleBrdExporter
from routeai_parsers.eagle.sch_exporter import EagleSchExporter
from routeai_parsers.eagle.sch_parser import EagleSchParser

__all__ = [
    "EagleBrdExporter",
    "EagleBrdParser",
    "EagleSchExporter",
    "EagleSchParser",
]
