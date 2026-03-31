"""Manufacturing output generators.

Provides Gerber, Excellon drill, BOM, pick-and-place, ODB++, IPC-2581,
and DFM analysis for PCB fabrication and assembly.
"""

from routeai_solver.manufacturing.bom_export import BOMExporter
from routeai_solver.manufacturing.dfm import DFMAnalyzer, DFMReport, FabProfile
from routeai_solver.manufacturing.drill import DrillExporter
from routeai_solver.manufacturing.gerber import GerberExporter
from routeai_solver.manufacturing.ipc2581_export import IPC2581Exporter
from routeai_solver.manufacturing.odb_export import ODBExporter
from routeai_solver.manufacturing.pick_and_place import PickAndPlaceExporter

__all__ = [
    "BOMExporter",
    "DFMAnalyzer",
    "DFMReport",
    "DrillExporter",
    "FabProfile",
    "GerberExporter",
    "IPC2581Exporter",
    "ODBExporter",
    "PickAndPlaceExporter",
]
