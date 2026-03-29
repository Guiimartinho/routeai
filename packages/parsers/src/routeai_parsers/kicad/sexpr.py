"""S-expression tokenizer, parser, and serializer for KiCad file formats.

KiCad uses a Lisp-like S-expression syntax for its .kicad_pcb and .kicad_sch
files. This module provides a complete tokenizer, parser, and serializer that
handles all KiCad-specific syntax including quoted strings with escape
sequences, numeric values, symbols, and comments.

The parsed representation uses nested Python lists, where each S-expression
``(a b c)`` becomes ``["a", "b", "c"]`` and nested expressions produce
nested lists.
"""

from __future__ import annotations

import re
from typing import Any


class SExprError(Exception):
    """Raised when S-expression parsing encounters invalid syntax."""


# Token types
_TOKEN_LPAREN = "LPAREN"
_TOKEN_RPAREN = "RPAREN"
_TOKEN_STRING = "STRING"
_TOKEN_SYMBOL = "SYMBOL"
_TOKEN_NUMBER_INT = "INT"
_TOKEN_NUMBER_FLOAT = "FLOAT"

# Regex patterns for tokenization
_WHITESPACE_RE = re.compile(r"[ \t\r\n]+")
_COMMENT_RE = re.compile(r"#[^\n]*")
_NUMBER_RE = re.compile(
    r"[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)"
)
_SYMBOL_RE = re.compile(r"[^\s()\"]+")


def tokenize(text: str) -> list[tuple[str, Any]]:
    """Tokenize an S-expression string into a list of (type, value) tuples.

    Handles parentheses, quoted strings with escape sequences, integers,
    floating-point numbers, symbols, and comments (lines starting with #).

    Args:
        text: The raw S-expression text to tokenize.

    Returns:
        A list of (token_type, token_value) tuples.

    Raises:
        SExprError: If an unterminated string or unexpected character is found.
    """
    tokens: list[tuple[str, Any]] = []
    pos = 0
    length = len(text)

    while pos < length:
        ch = text[pos]

        # Skip whitespace
        if ch in " \t\r\n":
            m = _WHITESPACE_RE.match(text, pos)
            if m:
                pos = m.end()
            else:
                pos += 1
            continue

        # Skip comments (# to end of line)
        if ch == "#":
            m = _COMMENT_RE.match(text, pos)
            if m:
                pos = m.end()
            else:
                pos += 1
            continue

        # Left parenthesis
        if ch == "(":
            tokens.append((_TOKEN_LPAREN, "("))
            pos += 1
            continue

        # Right parenthesis
        if ch == ")":
            tokens.append((_TOKEN_RPAREN, ")"))
            pos += 1
            continue

        # Quoted string
        if ch == '"':
            string_val, new_pos = _read_quoted_string(text, pos)
            tokens.append((_TOKEN_STRING, string_val))
            pos = new_pos
            continue

        # Try number first (must check before symbol since symbols can start
        # with +/- but numbers like +3.14 should parse as numbers)
        m = _NUMBER_RE.match(text, pos)
        if m:
            num_str = m.group(0)
            # Make sure it's not followed by a symbol character (e.g., "3D" is a symbol)
            end = m.end()
            if end < length and text[end] not in " \t\r\n()\"":
                # It's actually part of a symbol
                m2 = _SYMBOL_RE.match(text, pos)
                if m2:
                    tokens.append((_TOKEN_SYMBOL, m2.group(0)))
                    pos = m2.end()
                else:
                    tokens.append((_TOKEN_SYMBOL, num_str))
                    pos = end
                continue

            if "." in num_str or "e" in num_str.lower():
                tokens.append((_TOKEN_NUMBER_FLOAT, float(num_str)))
            else:
                tokens.append((_TOKEN_NUMBER_INT, int(num_str)))
            pos = end
            continue

        # Symbol (any non-whitespace, non-paren, non-quote sequence)
        m = _SYMBOL_RE.match(text, pos)
        if m:
            tokens.append((_TOKEN_SYMBOL, m.group(0)))
            pos = m.end()
            continue

        raise SExprError(
            f"Unexpected character {ch!r} at position {pos}"
        )

    return tokens


def _read_quoted_string(text: str, pos: int) -> tuple[str, int]:
    """Read a quoted string starting at pos (which points to the opening quote).

    Handles escape sequences: \\\\, \\", \\n, \\t, \\r.

    Returns:
        A tuple of (decoded_string, position_after_closing_quote).

    Raises:
        SExprError: If the string is unterminated.
    """
    assert text[pos] == '"'
    pos += 1  # skip opening quote
    chars: list[str] = []
    length = len(text)

    while pos < length:
        ch = text[pos]
        if ch == "\\":
            pos += 1
            if pos >= length:
                raise SExprError("Unterminated escape sequence at end of input")
            esc = text[pos]
            if esc == "n":
                chars.append("\n")
            elif esc == "t":
                chars.append("\t")
            elif esc == "r":
                chars.append("\r")
            elif esc == "\\":
                chars.append("\\")
            elif esc == '"':
                chars.append('"')
            else:
                # Unknown escape - preserve as-is
                chars.append("\\")
                chars.append(esc)
            pos += 1
        elif ch == '"':
            pos += 1  # skip closing quote
            return "".join(chars), pos
        else:
            chars.append(ch)
            pos += 1

    raise SExprError("Unterminated string literal")


def parse(text: str) -> list[Any]:
    """Parse an S-expression string into a nested list structure.

    Each parenthesized group ``(a b c)`` becomes a Python list ``["a", "b", "c"]``.
    Nested groups produce nested lists. Numeric values are parsed as int or float.
    Quoted strings and symbols are both represented as Python str.

    Args:
        text: The S-expression text to parse.

    Returns:
        A nested list representing the parsed S-expression. If the input
        contains a single top-level expression, returns it as a list.
        If multiple top-level expressions exist, returns a list of them.

    Raises:
        SExprError: On syntax errors such as unmatched parentheses.
    """
    tokens = tokenize(text)
    if not tokens:
        return []

    result, pos = _parse_tokens(tokens, 0)
    # Collect all top-level expressions
    top_level = [result]
    while pos < len(tokens):
        if tokens[pos][0] == _TOKEN_RPAREN:
            raise SExprError(f"Unexpected ')' at token position {pos}")
        expr, pos = _parse_tokens(tokens, pos)
        top_level.append(expr)

    if len(top_level) == 1:
        return top_level[0]
    return top_level


def _parse_tokens(tokens: list[tuple[str, Any]], pos: int) -> tuple[Any, int]:
    """Parse tokens starting at the given position.

    Returns:
        A tuple of (parsed_expression, next_token_position).

    Raises:
        SExprError: On syntax errors.
    """
    if pos >= len(tokens):
        raise SExprError("Unexpected end of input")

    token_type, token_value = tokens[pos]

    if token_type == _TOKEN_LPAREN:
        # Parse a list
        pos += 1
        elements: list[Any] = []
        while pos < len(tokens) and tokens[pos][0] != _TOKEN_RPAREN:
            element, pos = _parse_tokens(tokens, pos)
            elements.append(element)
        if pos >= len(tokens):
            raise SExprError("Unmatched '(' - missing closing ')'")
        pos += 1  # skip the RPAREN
        return elements, pos

    if token_type == _TOKEN_RPAREN:
        raise SExprError(f"Unexpected ')' at token position {pos}")

    # Atom: string, symbol, int, or float
    return token_value, pos + 1


def serialize(ast: Any, indent: int = 0, compact: bool = False) -> str:
    """Serialize a parsed S-expression AST back into string form.

    Produces formatted output with indentation that follows KiCad conventions.

    Args:
        ast: The parsed S-expression (nested lists, strings, numbers).
        indent: Current indentation level (number of spaces).
        compact: If True, produce single-line output with no extra whitespace.

    Returns:
        A string representation of the S-expression.
    """
    if compact:
        return _serialize_compact(ast)
    return _serialize_formatted(ast, indent)


def _serialize_compact(ast: Any) -> str:
    """Serialize to a single-line compact string."""
    if isinstance(ast, list):
        parts = [_serialize_compact(item) for item in ast]
        return "(" + " ".join(parts) + ")"
    return _format_atom(ast)


def _serialize_formatted(ast: Any, indent: int) -> str:
    """Serialize with KiCad-style indentation."""
    if not isinstance(ast, list):
        return _format_atom(ast)

    if not ast:
        return "()"

    # Determine if this expression should be on one line or multiple lines
    # Short expressions with no nested lists go on one line
    has_nested = any(isinstance(item, list) for item in ast)
    compact_repr = _serialize_compact(ast)

    if not has_nested and len(compact_repr) <= 100:
        return compact_repr

    # Multi-line format
    prefix = "  " * indent
    inner_prefix = "  " * (indent + 1)
    lines: list[str] = []

    # First element (the keyword) and any simple atoms before the first list
    head_parts: list[str] = []
    first_list_idx = len(ast)
    for i, item in enumerate(ast):
        if isinstance(item, list):
            first_list_idx = i
            break
        head_parts.append(_format_atom(item))

    # If all elements are atoms, single line
    if first_list_idx == len(ast):
        return compact_repr

    # Build the head line
    # Gather simple atoms that come before the first nested list
    simple_head = head_parts[:first_list_idx] if first_list_idx <= len(head_parts) else head_parts
    head_line = " ".join(simple_head)

    # Check if there are simple atoms between head and first nested list
    # that should be on the head line
    lines.append(f"{prefix}({head_line}")

    # Now add remaining elements
    for i in range(first_list_idx, len(ast)):
        item = ast[i]
        if isinstance(item, list):
            lines.append(_serialize_formatted(item, indent + 1))
        else:
            lines.append(f"{inner_prefix}{_format_atom(item)}")

    lines.append(f"{prefix})")

    return "\n".join(lines)


def _format_atom(value: Any) -> str:
    """Format a single atom value for S-expression output.

    Strings that contain spaces, parentheses, or quotes are quoted.
    Numbers are formatted without unnecessary precision loss.
    """
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # Format floats to avoid unnecessary trailing zeros
        # but preserve precision
        if value == int(value) and abs(value) < 1e15:
            # Check if it was originally a float by its type
            return f"{value:.1f}" if abs(value) < 1e6 else str(value)
        formatted = f"{value:.6f}".rstrip("0").rstrip(".")
        if "." not in formatted:
            formatted += ".0"
        return formatted
    if isinstance(value, str):
        return _format_string(value)
    return str(value)


def _format_string(s: str) -> str:
    """Format a string value, quoting it if necessary.

    Strings are quoted if they contain whitespace, parentheses, quotes,
    or are empty. Otherwise they are output as bare symbols.
    """
    if not s:
        return '""'

    # Check if the string needs quoting
    needs_quoting = False
    for ch in s:
        if ch in ' \t\r\n()"\\':
            needs_quoting = True
            break

    if not needs_quoting:
        # Also quote if it looks like a number to avoid ambiguity
        try:
            float(s)
            needs_quoting = True
        except ValueError:
            pass

    if needs_quoting:
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        escaped = escaped.replace("\n", "\\n").replace("\t", "\\t").replace("\r", "\\r")
        return f'"{escaped}"'

    return s


def find_nodes(ast: list[Any], tag: str) -> list[list[Any]]:
    """Find all child nodes in an AST list that start with the given tag.

    Only searches direct children (not recursive). Each child must be a list
    whose first element equals the tag string.

    Args:
        ast: A parsed S-expression list to search within.
        tag: The tag name to match (first element of child lists).

    Returns:
        A list of matching child lists.
    """
    results = []
    for item in ast:
        if isinstance(item, list) and item and item[0] == tag:
            results.append(item)
    return results


def find_node(ast: list[Any], tag: str) -> list[Any] | None:
    """Find the first child node with the given tag, or None if not found.

    Args:
        ast: A parsed S-expression list to search within.
        tag: The tag name to match.

    Returns:
        The first matching child list, or None.
    """
    for item in ast:
        if isinstance(item, list) and item and item[0] == tag:
            return item
    return None


def node_value(node: list[Any] | None, default: Any = None) -> Any:
    """Get the single value from a node like ``["tag", value]``.

    Args:
        node: A parsed S-expression node (list) or None.
        default: Value to return if the node is None or has no value.

    Returns:
        The second element of the node, or default.
    """
    if node is None or len(node) < 2:
        return default
    return node[1]


def node_values(node: list[Any] | None) -> list[Any]:
    """Get all values from a node (everything after the tag).

    Args:
        node: A parsed S-expression node (list) or None.

    Returns:
        A list of values (elements after the first), or empty list.
    """
    if node is None or len(node) < 2:
        return []
    return node[1:]
