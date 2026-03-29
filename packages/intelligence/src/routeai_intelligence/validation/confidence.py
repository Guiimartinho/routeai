"""Gate 2: Confidence scoring for LLM-generated design constraints.

Checks that safety-critical parameters meet a higher confidence threshold
than general parameters. Flags or rejects items that fall below the
required thresholds.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Confidence thresholds
SAFETY_CRITICAL_THRESHOLD = 0.95
GENERAL_THRESHOLD = 0.80

# Parameters classified as safety-critical. These directly affect board
# safety and must have high-confidence values.
SAFETY_CRITICAL_PARAMS: frozenset[str] = frozenset({
    "clearance",
    "clearance_mm",
    "creepage",
    "creepage_mm",
    "impedance",
    "impedance_ohm",
    "current_capacity",
    "max_current_a",
    "voltage_rating",
    "isolation_voltage",
    "dielectric_withstand",
})

# Fields in constraint items that indicate they contain safety-critical data
_SAFETY_CRITICAL_INDICATOR_FIELDS: frozenset[str] = frozenset({
    "impedance_ohm",
    "max_current_a",
    "clearance_mm",
})

# Rule types that are inherently safety-critical
_SAFETY_CRITICAL_RULE_TYPES: frozenset[str] = frozenset({
    "clearance",
    "guard_ring",
})


@dataclass
class FlaggedItem:
    """A constraint item that failed the confidence check."""

    item_name: str
    confidence: float
    threshold: float
    is_safety_critical: bool
    reason: str
    action: str  # "flag" or "reject"

    def to_dict(self) -> dict[str, Any]:
        return {
            "item_name": self.item_name,
            "confidence": self.confidence,
            "threshold": self.threshold,
            "is_safety_critical": self.is_safety_critical,
            "reason": self.reason,
            "action": self.action,
        }


class ConfidenceChecker:
    """Checks confidence scores on LLM-generated constraints.

    Gate 2 of the 3-gate validation pipeline. For each constraint item:
    1. Determines if the item is safety-critical (based on parameter types)
    2. Applies the appropriate threshold (0.95 for safety-critical, 0.80 general)
    3. Flags items below threshold for review
    4. Rejects safety-critical items far below threshold (< 0.70)

    Args:
        safety_threshold: Confidence threshold for safety-critical parameters.
        general_threshold: Confidence threshold for general parameters.
    """

    def __init__(
        self,
        safety_threshold: float = SAFETY_CRITICAL_THRESHOLD,
        general_threshold: float = GENERAL_THRESHOLD,
    ) -> None:
        self.safety_threshold = safety_threshold
        self.general_threshold = general_threshold

    def check(self, suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Check confidence scores for a list of constraint items.

        Each item is expected to have at least a 'confidence' field (float 0-1)
        and optionally a 'name' field for identification.

        Args:
            suggestions: List of constraint dicts, each with a 'confidence' key.

        Returns:
            List of flagged item dicts for items that failed the check.
            Items that pass are not included.
        """
        flagged: list[dict[str, Any]] = []

        for item in suggestions:
            confidence = item.get("confidence")
            if confidence is None:
                # No confidence score at all - flag it
                flagged.append(FlaggedItem(
                    item_name=item.get("name", "unknown"),
                    confidence=0.0,
                    threshold=self.general_threshold,
                    is_safety_critical=False,
                    reason="No confidence score provided",
                    action="flag",
                ).to_dict())
                continue

            is_critical = self._is_safety_critical(item)
            threshold = self.safety_threshold if is_critical else self.general_threshold
            item_name = item.get("name", "unknown")

            if confidence < threshold:
                # Determine action: reject if safety-critical and very low
                if is_critical and confidence < 0.70:
                    action = "reject"
                    reason = (
                        f"Safety-critical parameter '{item_name}' has confidence "
                        f"{confidence:.2f}, which is far below the required threshold "
                        f"of {threshold:.2f}. This constraint MUST be verified by an "
                        f"engineer before use."
                    )
                elif is_critical:
                    action = "flag"
                    reason = (
                        f"Safety-critical parameter '{item_name}' has confidence "
                        f"{confidence:.2f}, below the required threshold of {threshold:.2f}. "
                        f"Engineer review recommended before fabrication."
                    )
                else:
                    action = "flag"
                    reason = (
                        f"Parameter '{item_name}' has confidence {confidence:.2f}, "
                        f"below the general threshold of {threshold:.2f}. "
                        f"Consider verifying against datasheet or standard."
                    )

                flagged.append(FlaggedItem(
                    item_name=item_name,
                    confidence=confidence,
                    threshold=threshold,
                    is_safety_critical=is_critical,
                    reason=reason,
                    action=action,
                ).to_dict())

                logger.info(
                    "Confidence check %s: %s (confidence=%.2f, threshold=%.2f, critical=%s)",
                    action,
                    item_name,
                    confidence,
                    threshold,
                    is_critical,
                )

        return flagged

    def _is_safety_critical(self, item: dict[str, Any]) -> bool:
        """Determine if a constraint item contains safety-critical parameters.

        An item is safety-critical if:
        1. It has fields matching known safety-critical parameter names, OR
        2. Its rule_type is inherently safety-critical (clearance, guard_ring), OR
        3. It explicitly sets impedance or current constraints
        """
        # Check for safety-critical fields with non-null values
        for key in item:
            if key in SAFETY_CRITICAL_PARAMS and item[key] is not None:
                return True

        # Check for indicator fields that imply safety criticality
        for indicator in _SAFETY_CRITICAL_INDICATOR_FIELDS:
            value = item.get(indicator)
            if value is not None:
                return True

        # Check rule_type for special rules
        rule_type = item.get("rule_type", "")
        if rule_type in _SAFETY_CRITICAL_RULE_TYPES:
            return True

        return False

    def get_summary(self, flagged_items: list[dict[str, Any]]) -> dict[str, Any]:
        """Produce a summary of flagged items.

        Args:
            flagged_items: List of flagged item dicts from check().

        Returns:
            Summary dict with counts and lists by action type.
        """
        rejected = [f for f in flagged_items if f.get("action") == "reject"]
        flagged_only = [f for f in flagged_items if f.get("action") == "flag"]

        return {
            "total_flagged": len(flagged_items),
            "rejected_count": len(rejected),
            "flagged_count": len(flagged_only),
            "rejected_items": [f["item_name"] for f in rejected],
            "flagged_items": [f["item_name"] for f in flagged_only],
            "safety_critical_issues": [
                f for f in flagged_items if f.get("is_safety_critical", False)
            ],
        }
