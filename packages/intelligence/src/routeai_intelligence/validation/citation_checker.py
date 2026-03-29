"""Gate 3: Citation verification for LLM-generated design constraints.

Every design decision from the LLM must reference at least one authoritative
source: an IPC standard clause, a datasheet page/section, or a physics
equation. Uncited suggestions are flagged as heuristic and may be rejected
for safety-critical parameters.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Patterns that indicate a valid citation
_CITATION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # IPC standards: "IPC-2221B", "IPC-2141A Section 4.3", "IPC-7351C"
    ("ipc_standard", re.compile(
        r"IPC[-\s]?\d{4}[A-Z]?(?:\s+(?:Table|Section|Clause|Figure|Eq\.?|Equation)\s*[\d\.\-]+)?",
        re.IGNORECASE,
    )),
    # JEDEC standards: "JEDEC JESD79-4", "JEDEC DDR4"
    ("jedec_standard", re.compile(
        r"JEDEC\s+(?:JESD\d+[-\d]*|DDR\d|LPDDR\d)",
        re.IGNORECASE,
    )),
    # Datasheet references: "datasheet p.42", "datasheet Rev.G Section 8"
    ("datasheet", re.compile(
        r"datasheet\s+(?:Rev\.?\s*[A-Z]?\s+)?(?:p\.?\s*\d+|[Ss]ection\s+[\d\.]+|[Tt]able\s+[\d\.]+|[Ff]igure\s+[\d\.]+|page\s+\d+)",
        re.IGNORECASE,
    )),
    # Interface specifications: "USB 3.2 Gen 1 spec", "PCIe Gen 4 specification"
    ("interface_spec", re.compile(
        r"(?:USB|PCIe|PCI\s+Express|HDMI|DisplayPort|Ethernet|SATA|MIPI|I2C|SPI)\s+[\d\.]+\s*(?:Gen\s*\d+)?\s*(?:spec(?:ification)?|standard)",
        re.IGNORECASE,
    )),
    # Physics equations: "Z0 = ...", any equation reference
    ("physics_equation", re.compile(
        r"(?:Z[0_]|impedance|capacitance|inductance|resistance)\s*[=~]\s*[\d\.\(\)]+|"
        r"(?:Hammerstad|Jensen|Wheeler|Wadell|Cohn|IPC-2141[A]?\s+Eq\.?\s*[\d\.\-]+)",
        re.IGNORECASE,
    )),
    # Named standards: "MIL-STD-275", "EN 60950", "UL 60950"
    ("safety_standard", re.compile(
        r"(?:MIL[-\s]STD[-\s]\d+|EN\s+\d+|UL\s+\d+|IEC\s+\d+)",
        re.IGNORECASE,
    )),
    # Application notes: "AN-xxxx", "Application Note"
    ("application_note", re.compile(
        r"(?:AN[-\s]?\d{3,}|[Aa]pplication\s+[Nn]ote\s+\w+)",
        re.IGNORECASE,
    )),
    # Engineering best practice (explicitly noted - lowest priority citation)
    ("best_practice", re.compile(
        r"(?:[Ee]ngineering\s+)?[Bb]est\s+[Pp]ractice|[Ii]ndustry\s+[Ss]tandard\s+[Pp]ractice",
        re.IGNORECASE,
    )),
]

# Citation types that are considered strong (authoritative)
_STRONG_CITATION_TYPES: frozenset[str] = frozenset({
    "ipc_standard",
    "jedec_standard",
    "datasheet",
    "interface_spec",
    "physics_equation",
    "safety_standard",
})

# Citation types that are weak (acceptable but noted)
_WEAK_CITATION_TYPES: frozenset[str] = frozenset({
    "application_note",
    "best_practice",
})


class CitationChecker:
    """Verifies that LLM design suggestions include proper citations.

    Gate 3 of the 3-gate validation pipeline. For each suggestion:
    1. Extracts the 'source' field
    2. Checks for recognized citation patterns
    3. Classifies citations as strong or weak
    4. Returns pass/fail with list of what's missing

    Uncited suggestions are flagged as heuristic. For safety-critical parameters,
    only strong citations are accepted.
    """

    def check(self, suggestion: dict[str, Any]) -> tuple[bool, list[str]]:
        """Check if a suggestion has adequate citations.

        Args:
            suggestion: A constraint dict with at least a 'source' field
                containing citation text.

        Returns:
            Tuple of (is_cited: bool, missing_citations: list[str]).
            is_cited is True if at least one valid citation was found.
            missing_citations lists the types of citations that are needed
            but not found.
        """
        source = suggestion.get("source", "")
        if not source or not isinstance(source, str):
            return False, ["No 'source' field found. Every constraint must cite at least one "
                          "IPC standard clause, datasheet page, or physics equation."]

        found_citations = self._find_citations(source)
        missing: list[str] = []

        if not found_citations:
            missing.append(
                "No recognized citation pattern found in source text. "
                "Expected: IPC standard (e.g., 'IPC-2221B Table 6-1'), "
                "datasheet reference (e.g., 'datasheet p.42'), "
                "or physics equation (e.g., 'Z0 = 87/sqrt(Er+1.41)...')."
            )
            return False, missing

        # Check citation strength for safety-critical items
        is_safety_critical = self._is_safety_critical_item(suggestion)
        found_types = {ct for ct, _ in found_citations}
        has_strong = bool(found_types & _STRONG_CITATION_TYPES)
        has_only_weak = found_types.issubset(_WEAK_CITATION_TYPES)

        if is_safety_critical and not has_strong:
            missing.append(
                "Safety-critical parameter requires a strong citation (IPC standard, "
                "datasheet, or physics equation). 'Best practice' alone is insufficient."
            )
            return False, missing

        if has_only_weak:
            # Acceptable but note it
            logger.info(
                "Suggestion '%s' has only weak citations (best practice/app note). "
                "Consider adding IPC or datasheet reference.",
                suggestion.get("name", "unknown"),
            )

        return True, []

    def check_batch(
        self, suggestions: list[dict[str, Any]]
    ) -> list[tuple[str, bool, list[str]]]:
        """Check citations for a batch of suggestions.

        Args:
            suggestions: List of constraint dicts.

        Returns:
            List of (item_name, is_cited, missing_citations) tuples.
        """
        results = []
        for item in suggestions:
            name = item.get("name", "unknown")
            is_cited, missing = self.check(item)
            results.append((name, is_cited, missing))
        return results

    def get_citation_details(self, source_text: str) -> list[dict[str, str]]:
        """Extract and classify all citations from a source text.

        Args:
            source_text: The source/citation text to analyze.

        Returns:
            List of dicts with 'type', 'match', and 'strength' for each citation found.
        """
        citations = self._find_citations(source_text)
        return [
            {
                "type": citation_type,
                "match": match,
                "strength": "strong" if citation_type in _STRONG_CITATION_TYPES else "weak",
            }
            for citation_type, match in citations
        ]

    @staticmethod
    def _find_citations(text: str) -> list[tuple[str, str]]:
        """Find all citation patterns in the given text.

        Returns list of (citation_type, matched_text) tuples.
        """
        found: list[tuple[str, str]] = []
        for citation_type, pattern in _CITATION_PATTERNS:
            matches = pattern.findall(text)
            for match in matches:
                found.append((citation_type, match if isinstance(match, str) else match[0]))
        return found

    @staticmethod
    def _is_safety_critical_item(suggestion: dict[str, Any]) -> bool:
        """Determine if a suggestion involves safety-critical parameters."""
        # Import the safety-critical param set from confidence module
        from routeai_intelligence.validation.confidence import (
            SAFETY_CRITICAL_PARAMS,
        )

        for key in suggestion:
            if key in SAFETY_CRITICAL_PARAMS and suggestion[key] is not None:
                return True

        rule_type = suggestion.get("rule_type", "")
        if rule_type in ("clearance", "guard_ring"):
            return True

        return False
