"""Validation module - 3-gate pipeline for LLM output verification.

Gate 1: Schema validation - structural correctness of JSON output
Gate 2: Confidence scoring - threshold checks for safety-critical parameters
Gate 3: Citation verification - every design decision must be traceable
"""

from routeai_intelligence.validation.citation_checker import CitationChecker
from routeai_intelligence.validation.confidence import (
    ConfidenceChecker,
    LocalEscalationPolicy,
    physics_check,
)
from routeai_intelligence.validation.schema_validator import SchemaValidator

__all__ = [
    "CitationChecker",
    "ConfidenceChecker",
    "LocalEscalationPolicy",
    "SchemaValidator",
    "physics_check",
]
