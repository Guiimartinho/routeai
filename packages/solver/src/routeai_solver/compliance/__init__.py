"""IPC compliance checking and report generation.

Provides compliance checks against IPC-2221B, IPC-6012, and IPC-A-610
standards with detailed clause-by-clause results and PDF/HTML report
generation.
"""

from routeai_solver.compliance.ipc_checker import (
    IPCComplianceChecker,
    ComplianceReport,
    ComplianceCheck,
    CheckResult,
)
from routeai_solver.compliance.report_generator import (
    ComplianceReportGenerator,
)

__all__ = [
    "IPCComplianceChecker",
    "ComplianceReport",
    "ComplianceCheck",
    "CheckResult",
    "ComplianceReportGenerator",
]
