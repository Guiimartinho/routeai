"""Abstract LLM provider interface for RouteAI.

All LLM providers (Ollama, Anthropic, Gemini) implement this interface so the
agent core can work with any backend without coupling.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    """A single tool invocation requested by the LLM."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class TokenUsage:
    """Token consumption for a single LLM call."""

    input_tokens: int
    output_tokens: int


@dataclass
class LLMResponse:
    """Unified response from any LLM provider."""

    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: TokenUsage = field(default_factory=lambda: TokenUsage(0, 0))
    stop_reason: str = "end_turn"  # "end_turn", "tool_use", "max_tokens"


class LLMProvider(abc.ABC):
    """Abstract LLM provider interface for RouteAI.

    Every provider must implement ``generate`` (general purpose, with optional
    tool calling) and ``generate_json`` (structured JSON output).
    """

    @abc.abstractmethod
    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
    ) -> LLMResponse:
        """Generate a response, optionally with tool calling.

        Args:
            messages: Conversation history as ``[{"role": ..., "content": ...}]``.
            system: System prompt prepended to the conversation.
            tools: Tool schemas (Anthropic format with *name*, *description*,
                *input_schema*).  Providers that do not support native tool-use
                inject the schemas into the system prompt and parse tool calls
                from the text output.
            temperature: Sampling temperature (0.0 = deterministic).
            max_tokens: Maximum tokens in the response.

        Returns:
            Unified ``LLMResponse`` with text, tool_calls, usage, and stop_reason.
        """

    @abc.abstractmethod
    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON output.

        Args:
            messages: Conversation history.
            system: System prompt.
            schema: Optional JSON Schema that the output should conform to.
                Providers may use native JSON mode or prompt engineering.

        Returns:
            Parsed JSON dict.
        """

    @property
    @abc.abstractmethod
    def supports_native_tools(self) -> bool:
        """Whether this provider supports a native tool-use API."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Provider name for logging and display."""
