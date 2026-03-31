"""Ollama local LLM provider -- PRIMARY engine for RouteAI.

Connects to the Ollama HTTP API (``/api/chat``, ``/api/tags``) via ``httpx``.
Tool-use is implemented by injecting tool descriptions into the system prompt
and parsing JSON ``tool_calls`` blocks from the model output, which works with
any model (qwen2.5, llama3.1, mistral, deepseek-coder, etc.).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from typing import Any

import httpx

from routeai_intelligence.llm.provider import (
    LLMProvider,
    LLMResponse,
    TokenUsage,
    ToolCall,
)

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    """Ollama local LLM provider -- PRIMARY engine for RouteAI.

    Supports tool-use via JSON extraction from model output.
    Works with qwen2.5, llama3.1, mistral, deepseek-coder, etc.

    Args:
        host: Ollama server URL (default: ``http://127.0.0.1:11434``).
        model: Model tag to use (default: ``qwen2.5:7b``).
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        host: str | None = None,
        model: str | None = None,
        timeout: float = 300.0,
    ) -> None:
        self._host = (
            host
            or os.environ.get("OLLAMA_BASE_URL")
            or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
        )
        # Strip trailing slash for consistent URL building
        self._host = self._host.rstrip("/")
        self._model = model or os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
        self._timeout = timeout
        self._current_loaded_model: str | None = None

    # ------------------------------------------------------------------
    # LLMProvider interface
    # ------------------------------------------------------------------

    @property
    def supports_native_tools(self) -> bool:
        return False

    @property
    def name(self) -> str:
        return f"ollama/{self._model}"

    async def generate(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.0,
        max_tokens: int = 8192,
        model_override: str | None = None,
    ) -> LLMResponse:
        """Call Ollama ``/api/chat`` endpoint.

        For tool-use: injects tool descriptions into the system prompt and
        parses ``tool_calls`` JSON from the model output.
        """
        effective_system = system
        if tools:
            effective_system = (
                (system + "\n\n" if system else "")
                + self._build_tool_prompt(tools)
            )

        ollama_messages = self._build_messages(messages, effective_system)

        effective_model = model_override or self._model

        payload: dict[str, Any] = {
            "model": effective_model,
            "messages": ollama_messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        data = await self._post("/api/chat", payload)

        msg = data.get("message", {})
        text: str = msg.get("content", "")

        # Parse tool calls from text if tools were provided
        tool_calls: list[ToolCall] = []
        if tools:
            tool_calls = self._extract_tool_calls(text)

        # Determine stop reason
        stop_reason = "end_turn"
        if tool_calls:
            stop_reason = "tool_use"
        elif data.get("done_reason") == "length":
            stop_reason = "max_tokens"

        # Token usage
        usage = TokenUsage(
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
        )

        return LLMResponse(
            text=text,
            tool_calls=tool_calls,
            usage=usage,
            stop_reason=stop_reason,
        )

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        system: str = "",
        schema: dict[str, Any] | None = None,
        model_override: str | None = None,
    ) -> dict[str, Any]:
        """Use Ollama's JSON mode (``format: "json"``) for structured output."""
        schema_instruction = ""
        if schema:
            schema_instruction = (
                "\n\nYou MUST respond with a JSON object conforming to this schema:\n"
                f"```json\n{json.dumps(schema, indent=2)}\n```\n"
                "Respond ONLY with valid JSON. No markdown, no explanation."
            )

        effective_system = (system or "") + schema_instruction
        ollama_messages = self._build_messages(messages, effective_system)

        effective_model = model_override or self._model

        payload: dict[str, Any] = {
            "model": effective_model,
            "messages": ollama_messages,
            "stream": False,
            "format": "json",
            "options": {
                "temperature": 0.0,
                "num_predict": 8192,
            },
        }

        data = await self._post("/api/chat", payload)
        text: str = data.get("message", {}).get("content", "")

        return self._parse_json_output(text)

    # ------------------------------------------------------------------
    # Ollama-specific methods
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        """Check if the Ollama server is running and the model is loaded."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._host}/api/tags")
                if resp.status_code != 200:
                    return False
                tags = resp.json()
                model_names = [
                    m.get("name", "") for m in tags.get("models", [])
                ]
                # Check if our model is available (with or without tag suffix)
                base_model = self._model.split(":")[0]
                for mn in model_names:
                    if mn == self._model or mn.startswith(base_model):
                        return True
                # Model not found, but server is up -- Ollama can pull on
                # first use so we still consider it available.
                logger.info(
                    "Ollama is running but model '%s' not pre-loaded. "
                    "It will be pulled on first request.",
                    self._model,
                )
                return True
        except (httpx.ConnectError, httpx.TimeoutException, Exception) as exc:
            logger.debug("Ollama not available at %s: %s", self._host, exc)
            return False

    async def list_models(self) -> list[str]:
        """List available models on the Ollama server."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._host}/api/tags")
                if resp.status_code != 200:
                    return []
                tags = resp.json()
                return [m.get("name", "") for m in tags.get("models", [])]
        except Exception:
            return []

    async def ensure_model_loaded(self, model: str) -> float:
        """Pre-load a model into Ollama VRAM via a dummy generate call.

        If the model is already the current loaded model, returns immediately.
        Otherwise sends a minimal request to ``/api/generate`` which forces
        Ollama to load the model weights, and tracks the elapsed time.

        Args:
            model: Ollama model tag to load (e.g. ``qwen2.5:7b``).

        Returns:
            Wall-clock seconds spent loading.  ``0.0`` if no swap was needed.
        """
        if model == self._current_loaded_model:
            return 0.0

        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self._host}/api/generate",
                    json={
                        "model": model,
                        "prompt": " ",
                        "keep_alive": "10m",
                        "stream": False,
                    },
                )
                resp.raise_for_status()
            elapsed = time.monotonic() - start
            self._current_loaded_model = model
            logger.info(
                "Model swap complete: loaded '%s' in %.1fs", model, elapsed
            )
            return elapsed
        except (httpx.HTTPError, Exception) as exc:
            elapsed = time.monotonic() - start
            logger.warning(
                "Failed to pre-load model '%s' after %.1fs: %s",
                model,
                elapsed,
                exc,
            )
            return elapsed

    async def get_loaded_models(self) -> list[str]:
        """Return names of models currently loaded in Ollama VRAM.

        Queries the ``/api/ps`` endpoint which lists running models.

        Returns:
            List of model name strings, or empty list on failure.
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self._host}/api/ps")
                if resp.status_code != 200:
                    return []
                data = resp.json()
                return [
                    m.get("name", "")
                    for m in data.get("models", [])
                    if m.get("name")
                ]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Tool-use helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_tool_prompt(tools: list[dict[str, Any]]) -> str:
        """Convert tool schemas into text instructions for non-native-tool models.

        Produces a structured prompt that tells the model what tools are
        available and how to format tool calls as JSON.
        """
        lines = [
            "You have access to these tools:\n",
        ]
        for i, tool in enumerate(tools, 1):
            name = tool.get("name", "unknown")
            desc = tool.get("description", "")
            schema = tool.get("input_schema", {})
            props = schema.get("properties", {})
            required = schema.get("required", [])

            params_parts: list[str] = []
            for pname, pspec in props.items():
                ptype = pspec.get("type", "any")
                pdesc = pspec.get("description", "")
                req_marker = " (required)" if pname in required else ""
                default = pspec.get("default")
                default_str = f", default={default}" if default is not None else ""
                params_parts.append(
                    f"    - {pname}: {ptype}{req_marker}{default_str} -- {pdesc}"
                )

            params_block = "\n".join(params_parts) if params_parts else "    (no parameters)"
            lines.append(f"{i}. **{name}**\n   {desc}\n   Parameters:\n{params_block}\n")

        lines.append(
            "To use a tool, include a JSON block in your response like this:\n\n"
            '```tool_calls\n'
            '[{"name": "tool_name", "arguments": {"param1": "value1"}}]\n'
            '```\n\n'
            "You may call multiple tools in a single response by including "
            "multiple entries in the array.\n\n"
            "After the tool results are returned to you, continue your analysis. "
            "When you are done and have your final answer, respond normally "
            "WITHOUT any tool_calls block."
        )

        return "\n".join(lines)

    @staticmethod
    def _extract_tool_calls(text: str) -> list[ToolCall]:
        """Parse tool_calls JSON from LLM text output.

        Handles several common formats:
        1. Fenced: ```tool_calls\\n[...]\\n```
        2. Fenced json: ```json\\n{"tool_calls": [...]}\\n```
        3. Bare JSON with "tool_calls" key
        4. Bare JSON array starting with [{"name":...}]
        """
        calls: list[ToolCall] = []

        # Strategy 1: ```tool_calls ... ```
        pattern_fenced = r"```tool_calls\s*\n(.*?)```"
        for match in re.finditer(pattern_fenced, text, re.DOTALL):
            calls.extend(_parse_tool_call_json(match.group(1).strip()))

        if calls:
            return calls

        # Strategy 2: {"tool_calls": [...]} anywhere in fenced blocks
        pattern_json_block = r"```(?:json)?\s*\n(.*?)```"
        for match in re.finditer(pattern_json_block, text, re.DOTALL):
            block = match.group(1).strip()
            try:
                parsed = json.loads(block)
                if isinstance(parsed, dict) and "tool_calls" in parsed:
                    calls.extend(_parse_tool_call_json(json.dumps(parsed["tool_calls"])))
                elif isinstance(parsed, list):
                    calls.extend(_parse_tool_call_json(block))
            except json.JSONDecodeError:
                pass

        if calls:
            return calls

        # Strategy 3: Bare {"tool_calls": [...]} in text
        tc_match = re.search(r'\{\s*"tool_calls"\s*:\s*\[', text)
        if tc_match:
            start = tc_match.start()
            depth = 0
            end = start
            for i in range(start, len(text)):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > start:
                try:
                    parsed = json.loads(text[start:end])
                    if isinstance(parsed, dict) and "tool_calls" in parsed:
                        calls.extend(_parse_tool_call_json(json.dumps(parsed["tool_calls"])))
                except json.JSONDecodeError:
                    pass

        if calls:
            return calls

        # Strategy 4: Bare array [{"name": ...}]
        arr_match = re.search(r'\[\s*\{\s*"name"\s*:', text)
        if arr_match:
            start = arr_match.start()
            depth = 0
            end = start
            for i in range(start, len(text)):
                if text[i] == "[":
                    depth += 1
                elif text[i] == "]":
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end > start:
                calls.extend(_parse_tool_call_json(text[start:end]))

        return calls

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_messages(
        messages: list[dict[str, str]],
        system: str,
    ) -> list[dict[str, str]]:
        """Build the Ollama messages payload from a conversation and system prompt."""
        ollama_msgs: list[dict[str, str]] = []
        if system:
            ollama_msgs.append({"role": "system", "content": system})
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            # Ollama expects 'user' or 'assistant' roles. Flatten anything else.
            if isinstance(content, list):
                # Handle Anthropic-style content blocks
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", ""))
                        elif block.get("type") == "tool_result":
                            text_parts.append(
                                f"Tool result ({block.get('tool_use_id', '')}):\n"
                                f"{block.get('content', '')}"
                            )
                        elif block.get("type") == "tool_use":
                            text_parts.append(
                                f"[Calling tool: {block.get('name', '')} "
                                f"with {json.dumps(block.get('input', {}))}]"
                            )
                    elif isinstance(block, str):
                        text_parts.append(block)
                content = "\n".join(text_parts)
            ollama_msgs.append({"role": role, "content": content})
        return ollama_msgs

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a POST request to Ollama and return the JSON response."""
        url = f"{self._host}{path}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()

    @staticmethod
    def _parse_json_output(text: str) -> dict[str, Any]:
        """Attempt to parse JSON from Ollama output."""
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

        # Find JSON boundaries
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start : end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("Failed to parse JSON from Ollama output")
        return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}


def _parse_tool_call_json(raw: str) -> list[ToolCall]:
    """Parse a JSON string into a list of ToolCall objects."""
    calls: list[ToolCall] = []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return calls

    items: list[dict[str, Any]] = []
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        items = [parsed]

    for item in items:
        name = item.get("name", "")
        # Support both "arguments" and "args" keys
        arguments = item.get("arguments") or item.get("args") or {}
        if not name:
            continue
        calls.append(
            ToolCall(
                id=f"ollama_{uuid.uuid4().hex[:12]}",
                name=name,
                arguments=arguments,
            )
        )

    return calls
