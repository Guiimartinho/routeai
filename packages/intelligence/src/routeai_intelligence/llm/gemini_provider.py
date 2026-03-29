"""Google Gemini LLM provider for RouteAI.

Wraps the ``google-genai`` SDK and converts responses into the unified
``LLMResponse`` format.  Tool-use is handled via prompt injection and text
parsing (same approach as Ollama) since the Gemini tool API requires a
different schema format.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Any

from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
    TokenUsage,
    ToolCall,
)

logger = logging.getLogger(__name__)

# Reuse the text-based tool prompt and extraction logic from Ollama
from routeai_intelligence.llm.ollama_provider import OllamaProvider


class GeminiProvider(LLMProvider):
    """Google Gemini provider.

    Args:
        api_key: Google AI API key.  Falls back to ``GEMINI_API_KEY`` or
            ``GOOGLE_API_KEY`` env vars.
        model: Gemini model name (default: ``gemini-2.0-flash``).
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gemini-2.0-flash",
    ) -> None:
        self._api_key = (
            api_key
            or os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or ""
        )
        self._model = model

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def supports_native_tools(self) -> bool:
        return False

    @property
    def name(self) -> str:
        return f"gemini/{self._model}"

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
    ) -> LLMResponse:
        """Call the Gemini API with retry on rate limits."""
        from google import genai

        effective_system = system
        if tools:
            effective_system = (
                (system + "\n\n" if system else "")
                + OllamaProvider._build_tool_prompt(tools)
            )

        # Build a single prompt from system + messages
        contents = self._build_contents(messages, effective_system)

        client = genai.Client(api_key=self._api_key)

        last_exc: Exception | None = None
        for attempt in range(4):
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=self._model,
                    contents=contents,
                )
                text: str = response.text or ""

                # Parse tool calls if tools were provided
                tool_calls: list[ToolCall] = []
                if tools:
                    tool_calls = OllamaProvider._extract_tool_calls(text)

                stop_reason = "end_turn"
                if tool_calls:
                    stop_reason = "tool_use"

                # Gemini doesn't expose token counts in the same way
                usage = TokenUsage(input_tokens=0, output_tokens=0)
                try:
                    if hasattr(response, "usage_metadata") and response.usage_metadata:
                        usage = TokenUsage(
                            input_tokens=getattr(response.usage_metadata, "prompt_token_count", 0) or 0,
                            output_tokens=getattr(response.usage_metadata, "candidates_token_count", 0) or 0,
                        )
                except Exception:
                    pass

                return LLMResponse(
                    text=text,
                    tool_calls=tool_calls,
                    usage=usage,
                    stop_reason=stop_reason,
                )

            except Exception as exc:
                last_exc = exc
                exc_str = str(exc)
                if "429" in exc_str or "RESOURCE_EXHAUSTED" in exc_str:
                    wait = (attempt + 1) * 15
                    logger.warning(
                        "Gemini rate limited, waiting %ds (attempt %d/4)",
                        wait,
                        attempt + 1,
                    )
                    await asyncio.sleep(wait)
                else:
                    raise

        raise RuntimeError(
            f"Gemini rate limit exceeded after 4 retries: {last_exc}"
        )

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate structured JSON using Gemini."""
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
    def _build_contents(
        messages: list[dict[str, str]],
        system: str,
    ) -> str:
        """Concatenate system + messages into a single prompt string."""
        parts: list[str] = []
        if system:
            parts.append(system + "\n\n")
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if isinstance(content, list):
                text_bits = []
                for block in content:
                    if isinstance(block, dict):
                        text_bits.append(block.get("text", block.get("content", str(block))))
                    else:
                        text_bits.append(str(block))
                content = "\n".join(text_bits)
            role_label = "User" if role == "user" else "Assistant"
            parts.append(f"{role_label}: {content}\n\n")
        return "".join(parts)

    @staticmethod
    def _parse_json_output(text: str) -> dict[str, Any]:
        """Parse JSON from Gemini's text output."""
        cleaned = text.strip()

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

        logger.warning("Failed to parse JSON from Gemini output")
        return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}
