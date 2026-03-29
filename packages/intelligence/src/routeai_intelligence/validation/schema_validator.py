"""Gate 1: JSON Schema validation for LLM structured outputs.

Validates that LLM-generated JSON conforms to the expected schema for
constraint sets, design reviews, and routing strategies. Catches structural
errors before downstream processing.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_SCHEMAS_DIR = Path(__file__).parent.parent / "agent" / "schemas"

# Map of schema short names to file paths
_SCHEMA_FILES: dict[str, str] = {
    "constraint": "constraint_schema.json",
    "review": "review_schema.json",
    "routing": "routing_schema.json",
}


@dataclass
class ValidationResult:
    """Result of schema validation."""

    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class SchemaValidator:
    """Validates LLM JSON output against predefined JSON Schemas.

    Gate 1 of the 3-gate validation pipeline. Checks:
    - Valid JSON syntax
    - Required fields present
    - Correct types for all fields
    - Value ranges (min/max) respected
    - Enum values are from allowed sets

    Schemas are loaded lazily and cached.
    """

    def __init__(self, schemas_dir: Path | None = None) -> None:
        self._schemas_dir = schemas_dir or _SCHEMAS_DIR
        self._schema_cache: dict[str, dict[str, Any]] = {}

    def _load_schema(self, schema_name: str) -> dict[str, Any] | None:
        """Load and cache a JSON Schema by its short name."""
        if schema_name in self._schema_cache:
            return self._schema_cache[schema_name]

        filename = _SCHEMA_FILES.get(schema_name)
        if filename is None:
            return None

        schema_path = self._schemas_dir / filename
        if not schema_path.exists():
            logger.error("Schema file not found: %s", schema_path)
            return None

        with open(schema_path) as f:
            schema = json.load(f)

        self._schema_cache[schema_name] = schema
        return schema

    def validate(self, llm_output: str, schema_name: str) -> ValidationResult:
        """Validate LLM output string against a named schema.

        Args:
            llm_output: Raw string output from the LLM (expected to be JSON,
                possibly wrapped in markdown code fences).
            schema_name: Short name of the schema ('constraint', 'review', 'routing').

        Returns:
            ValidationResult with valid=True if all checks pass, or a list of
            error messages describing what failed.
        """
        errors: list[str] = []
        warnings: list[str] = []

        # Step 1: Parse JSON
        parsed = self._extract_json(llm_output)
        if parsed is None:
            return ValidationResult(
                valid=False,
                errors=["Failed to parse JSON from LLM output. The output must be valid JSON."],
            )

        # Step 2: Load schema
        schema = self._load_schema(schema_name)
        if schema is None:
            return ValidationResult(
                valid=False,
                errors=[f"Unknown schema name: '{schema_name}'. Available: {list(_SCHEMA_FILES.keys())}"],
            )

        # Step 3: Validate structure
        self._validate_object(parsed, schema, "", errors, warnings)

        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )

    def validate_dict(self, data: dict[str, Any], schema_name: str) -> ValidationResult:
        """Validate an already-parsed dict against a named schema.

        Args:
            data: Parsed dict to validate.
            schema_name: Short name of the schema.

        Returns:
            ValidationResult.
        """
        errors: list[str] = []
        warnings: list[str] = []

        schema = self._load_schema(schema_name)
        if schema is None:
            return ValidationResult(
                valid=False,
                errors=[f"Unknown schema name: '{schema_name}'"],
            )

        self._validate_object(data, schema, "", errors, warnings)

        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Internal validation engine
    # ------------------------------------------------------------------

    def _validate_object(
        self,
        data: Any,
        schema: dict[str, Any],
        path: str,
        errors: list[str],
        warnings: list[str],
    ) -> None:
        """Recursively validate data against a JSON Schema node."""
        schema_type = schema.get("type")

        # Handle union types (e.g., ["number", "null"])
        if isinstance(schema_type, list):
            if data is None and "null" in schema_type:
                return
            # Try validating against each non-null type
            non_null_types = [t for t in schema_type if t != "null"]
            if data is not None and non_null_types:
                # Create a sub-schema with a single type and validate
                for t in non_null_types:
                    sub_schema = {**schema, "type": t}
                    sub_errors: list[str] = []
                    sub_warnings: list[str] = []
                    self._validate_object(data, sub_schema, path, sub_errors, sub_warnings)
                    if not sub_errors:
                        warnings.extend(sub_warnings)
                        return
                # All types failed; report the error
                errors.append(
                    f"{path}: value has type '{type(data).__name__}', expected one of {non_null_types}"
                )
            return

        # Type checking
        if schema_type == "object":
            if not isinstance(data, dict):
                errors.append(f"{path}: expected object, got {type(data).__name__}")
                return
            self._validate_object_properties(data, schema, path, errors, warnings)

        elif schema_type == "array":
            if not isinstance(data, list):
                errors.append(f"{path}: expected array, got {type(data).__name__}")
                return
            self._validate_array(data, schema, path, errors, warnings)

        elif schema_type == "string":
            if not isinstance(data, str):
                errors.append(f"{path}: expected string, got {type(data).__name__}")
                return
            self._validate_string(data, schema, path, errors, warnings)

        elif schema_type == "number":
            if not isinstance(data, (int, float)):
                errors.append(f"{path}: expected number, got {type(data).__name__}")
                return
            self._validate_number(data, schema, path, errors, warnings)

        elif schema_type == "integer":
            if not isinstance(data, int) or isinstance(data, bool):
                errors.append(f"{path}: expected integer, got {type(data).__name__}")
                return
            self._validate_number(data, schema, path, errors, warnings)

        elif schema_type == "boolean":
            if not isinstance(data, bool):
                errors.append(f"{path}: expected boolean, got {type(data).__name__}")
                return

        elif schema_type == "null":
            if data is not None:
                errors.append(f"{path}: expected null, got {type(data).__name__}")

    def _validate_object_properties(
        self,
        data: dict[str, Any],
        schema: dict[str, Any],
        path: str,
        errors: list[str],
        warnings: list[str],
    ) -> None:
        """Validate object properties including required fields."""
        properties = schema.get("properties", {})
        required = schema.get("required", [])

        # Check required fields
        for field_name in required:
            if field_name not in data:
                errors.append(f"{path}.{field_name}: required field is missing")

        # Validate each present property
        for field_name, value in data.items():
            if field_name.startswith("_"):
                # Skip internal/meta fields
                continue

            field_path = f"{path}.{field_name}" if path else field_name
            if field_name in properties:
                field_schema = properties[field_name]
                # Resolve $ref if present
                field_schema = self._resolve_ref(field_schema, schema)
                self._validate_object(value, field_schema, field_path, errors, warnings)
            elif not schema.get("additionalProperties", True):
                warnings.append(f"{field_path}: unexpected additional property")

    def _validate_array(
        self,
        data: list[Any],
        schema: dict[str, Any],
        path: str,
        errors: list[str],
        warnings: list[str],
    ) -> None:
        """Validate array items and constraints."""
        min_items = schema.get("minItems")
        max_items = schema.get("maxItems")

        if min_items is not None and len(data) < min_items:
            errors.append(f"{path}: array has {len(data)} items, minimum is {min_items}")

        if max_items is not None and len(data) > max_items:
            errors.append(f"{path}: array has {len(data)} items, maximum is {max_items}")

        items_schema = schema.get("items")
        if items_schema:
            items_schema = self._resolve_ref(items_schema, schema)
            for i, item in enumerate(data):
                self._validate_object(item, items_schema, f"{path}[{i}]", errors, warnings)

    def _validate_string(
        self,
        data: str,
        schema: dict[str, Any],
        path: str,
        errors: list[str],
        warnings: list[str],
    ) -> None:
        """Validate string constraints."""
        min_length = schema.get("minLength")
        max_length = schema.get("maxLength")
        enum_values = schema.get("enum")
        pattern = schema.get("pattern")

        if min_length is not None and len(data) < min_length:
            errors.append(f"{path}: string length {len(data)} is below minimum {min_length}")

        if max_length is not None and len(data) > max_length:
            warnings.append(f"{path}: string length {len(data)} exceeds maximum {max_length}")

        if enum_values is not None and data not in enum_values:
            errors.append(f"{path}: value '{data}' is not in allowed values: {enum_values}")

        if pattern is not None:
            import re
            if not re.match(pattern, data):
                errors.append(f"{path}: value '{data}' does not match pattern '{pattern}'")

    def _validate_number(
        self,
        data: int | float,
        schema: dict[str, Any],
        path: str,
        errors: list[str],
        warnings: list[str],
    ) -> None:
        """Validate numeric constraints."""
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        enum_values = schema.get("enum")

        if minimum is not None and data < minimum:
            errors.append(f"{path}: value {data} is below minimum {minimum}")

        if maximum is not None and data > maximum:
            errors.append(f"{path}: value {data} exceeds maximum {maximum}")

        if enum_values is not None and data not in enum_values:
            errors.append(f"{path}: value {data} is not in allowed values: {enum_values}")

    def _resolve_ref(
        self, schema: dict[str, Any], root_schema: dict[str, Any]
    ) -> dict[str, Any]:
        """Resolve a $ref pointer within the schema."""
        ref = schema.get("$ref")
        if ref is None:
            return schema

        # Only support internal refs like "#/$defs/category_summary"
        if ref.startswith("#/"):
            parts = ref[2:].split("/")
            resolved = root_schema
            for part in parts:
                if isinstance(resolved, dict):
                    resolved = resolved.get(part, {})
                else:
                    return schema  # Cannot resolve
            if isinstance(resolved, dict):
                return resolved

        return schema

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any] | None:
        """Extract JSON from text, handling markdown code fences."""
        cleaned = text.strip()

        # Strip markdown code fences
        if cleaned.startswith("```"):
            first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
            cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        # Direct parse
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        # Find JSON object boundaries
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start:end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        return None
