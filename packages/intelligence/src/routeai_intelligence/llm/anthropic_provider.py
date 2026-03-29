"""Anthropic Claude LLM provider with native tool-use support.

Wraps the ``anthropic.AsyncAnthropic`` client and converts responses into the
unified ``LLMResponse`` format used by the RouteAI agent core.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
    TokenUsage,
    ToolCall,
)

logger = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider with native tool-use support.

    Args:
        api_key: Anthropic API key.  Falls back to ``ANTHROPIC_API_KEY`` env var.
        model: Model identifier (default: ``claude-sonnet-4-20250514``).
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
    ) -> None:
        import anthropic

        self._api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        self._model = model
        self._client = anthropic.AsyncAnthropic(api_key=self._api_key or None)

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def supports_native_tools(self) -> bool:
        return True

    @property
    def name(self) -> str:
        return f"anthropic/{self._model}"

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
    ) -> LLMResponse:
        """Call the Anthropic Messages API, with native tool-use when tools are provided."""
        import anthropic as anthropic_mod

        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools

        try:
            response = await self._client.messages.create(**kwargs)
        except anthropic_mod.APIError as exc:
            logger.error("Anthropic API error: %s", exc)
            raise

        # Convert response content blocks
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []

        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        arguments=block.input if isinstance(block.input, dict) else {},
                    )
                )

        # Map Anthropic stop reasons to our enum
        stop_reason_map = {
            "end_turn": "end_turn",
            "tool_use": "tool_use",
            "max_tokens": "max_tokens",
            "stop_sequence": "end_turn",
        }
        stop_reason = stop_reason_map.get(response.stop_reason or "end_turn", "end_turn")

        usage = TokenUsage(
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

        return LLMResponse(
            text="\n".join(text_parts),
            tool_calls=tool_calls,
            usage=usage,
            stop_reason=stop_reason,
        )

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON using Claude.

        Instructs Claude to produce pure JSON via the system prompt.
        """
        schema_instruction = ""
        if schema:
            schema_instruction = (
                "\n\nYou MUST respond with a JSON object conforming to this schema:\n"
                f"```json\n{json.dumps(schema, indent=2)}\n```\n"
                "Respond ONLY with valid JSON. No markdown fences, no explanation."
            )

        effective_system = (system or "") + schema_instruction

        response = await self.generate(
            messages=messages,
            system=effective_system,
            temperature=0.0,
            max_tokens=8192,
        )

        return self._parse_json_output(response.text)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_json_output(text: str) -> dict[str, Any]:
        """Parse JSON from Claude's text output."""
        cleaned = text.strip()

        # Strip markdown fences
        if cleaned.startswith("```"):
            first_nl = cleaned.find("\n")
            if first_nl != -1:
                cleaned = cleaned[first_nl + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start : end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("Failed to parse JSON from Anthropic output")
        return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}
